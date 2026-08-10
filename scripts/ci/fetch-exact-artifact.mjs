#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

import { readResponseBodyBounded } from "./applicant-fast-lane-core.mjs";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

try {
  const options = parseArgs(process.argv.slice(2));
  const bytes = await fetchExact(options);
  if (fs.existsSync(options.output)) throw new Error("--output must identify a new file");
  fs.writeFileSync(options.output, bytes, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    status: "EXACT_ARTIFACT_FETCHED",
    bytes: bytes.length,
    sha256: digest(bytes),
    externalActionsPerformed: []
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`fetch-exact-artifact: ${error.message}\n`);
  process.exitCode = 1;
}

async function fetchExact({ url, expectedSha256, output, attempts, maximumBytes }) {
  const target = validateUrl(url);
  let lastFailure = "provider request failed";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(target, {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/json, application/octet-stream;q=0.9",
          "user-agent": "programmable-platform-attestation-fetch/1.0"
        }
      });
      validateUrl(response.url);
      if (!response.ok) {
        lastFailure = `provider returned HTTP ${response.status}`;
        if (!TRANSIENT_STATUS.has(response.status) || attempt === attempts) throw new Error(lastFailure);
        await delay(retryDelay(response.headers.get("retry-after"), attempt));
        continue;
      }
      const bytes = await readResponseBodyBounded(response, maximumBytes);
      if (bytes.length < 1) throw new Error("provider artifact size is invalid");
      const observed = digest(bytes);
      if (observed !== expectedSha256) {
        throw new Error(`provider artifact digest mismatch: expected ${expectedSha256}, observed ${observed}`);
      }
      return bytes;
    } catch (error) {
      lastFailure = error.message;
      if (attempt === attempts || !isRetryableNetworkError(error)) break;
      await delay(retryDelay(null, attempt));
    }
  }
  throw new Error(`bounded provider retries exhausted: ${lastFailure}`);
}

function parseArgs(args) {
  const values = { url: null, expectedSha256: null, output: null, attempts: 3, maximumBytes: 256 * 1024 };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--url") values.url = take(args, ++index, flag);
    else if (flag === "--sha256") values.expectedSha256 = take(args, ++index, flag);
    else if (flag === "--output") values.output = take(args, ++index, flag);
    else if (flag === "--attempts") values.attempts = Number(take(args, ++index, flag));
    else if (flag === "--maximum-bytes") values.maximumBytes = Number(take(args, ++index, flag));
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (values.url === null || values.output === null || !SHA256.test(values.expectedSha256 ?? "")) {
    throw new Error("usage: fetch-exact-artifact.mjs --url <https-url> --sha256 <sha256:digest> --output <new-file>");
  }
  if (!Number.isSafeInteger(values.attempts) || values.attempts < 1 || values.attempts > 5) {
    throw new Error("--attempts must be between 1 and 5");
  }
  if (!Number.isSafeInteger(values.maximumBytes) || values.maximumBytes < 1 || values.maximumBytes > 2 * 1024 * 1024) {
    throw new Error("--maximum-bytes must be between 1 and 2097152");
  }
  return values;
}

function validateUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("artifact URL is invalid");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.hostname === "localhost"
    || parsed.hostname.endsWith(".localhost")
    || /^127\./u.test(parsed.hostname)
    || parsed.hostname === "::1"
  ) throw new Error("artifact URL must be credential-free public HTTPS");
  return parsed;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function retryDelay(retryAfter, attempt) {
  if (retryAfter !== null && /^[0-9]+$/u.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, 5000);
  return Math.min(250 * (2 ** (attempt - 1)), 5000);
}

function isRetryableNetworkError(error) {
  return error instanceof TypeError || /fetch|network|socket|timed out|HTTP (?:408|425|429|5[0-9]{2})/iu.test(error.message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function take(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}
