#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { parseBoundedLosslessJson } from "../../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import {
  ApplicantFastLaneError,
  verifyPlatformAttestation
} from "./applicant-fast-lane-core.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const attestationBytes = readBounded(options.attestation, 256 * 1024, "platform attestation");
  const routeReportBytes = readBounded(options.routeReport, 256 * 1024, "route capability report");
  const attestation = parseJson(attestationBytes, "platform attestation");
  const routeCapabilityReport = parseJson(routeReportBytes, "route capability report");
  const keyId = process.env.APPLICANT_PLATFORM_ATTESTATION_KEY_ID;
  const keyBase64 = process.env.APPLICANT_PLATFORM_ATTESTATION_PUBLIC_KEY_PEM_BASE64;
  const expectedAttestationSha256 = process.env.APPLICANT_PLATFORM_ATTESTATION_SHA256;
  if (!keyId || !keyBase64 || !expectedAttestationSha256) {
    throw new ApplicantFastLaneError(
      "PLATFORM_ATTESTATION_CONFIGURATION_MISSING",
      "trusted attestation key ID, public key, and exact artifact digest must all be configured"
    );
  }
  const publicKey = decodeCanonicalBase64(keyBase64);
  const report = verifyPlatformAttestation(attestation, {
    routeCapabilityReport,
    trustedPublicKeys: { [keyId]: publicKey },
    expectedAttestationSha256,
    attestationBytes,
    now: options.now === null ? new Date() : new Date(options.now)
  });
  writeNewJson(options.output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const code = error instanceof ApplicantFastLaneError ? error.code : "PLATFORM_ATTESTATION_VERIFICATION_FAILED";
  process.stderr.write(`verify-platform-profile-attestation: ${code}: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = { attestation: null, routeReport: null, output: null, now: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--attestation") values.attestation = take(args, ++index, flag);
    else if (flag === "--route-report") values.routeReport = take(args, ++index, flag);
    else if (flag === "--output") values.output = take(args, ++index, flag);
    else if (flag === "--now") values.now = take(args, ++index, flag);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (values.attestation === null || values.routeReport === null || values.output === null) {
    throw new Error("usage: verify-platform-profile-attestation.mjs --attestation <json> --route-report <json> --output <new-file>");
  }
  return values;
}

function readBounded(file, maximumBytes, label) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) throw new Error(`${label} size is invalid`);
  return fs.readFileSync(file);
}

function parseJson(bytes, label) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseBoundedLosslessJson(source);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function decodeCanonicalBase64(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_KEY_INVALID", "trusted public key is not canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_KEY_INVALID", "trusted public key base64 is invalid");
  }
  return bytes;
}

function take(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

function writeNewJson(output, value) {
  if (fs.existsSync(output)) throw new Error("--output must identify a new file");
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
