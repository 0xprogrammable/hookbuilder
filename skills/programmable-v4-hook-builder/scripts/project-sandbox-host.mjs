#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { canonicalJsonV2 } from "./canonical-json-core.mjs";
import {
  createDockerSandboxInvocationV1,
  createProjectSandboxSourceArchiveV1,
  verifyProjectSandboxHostCompletionV1
} from "./project-sandbox-host-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const usage = `Usage:
  project-sandbox-host.mjs source-archive --request <json> --repository-root <git-root> --output <new-tar>
  project-sandbox-host.mjs plan-docker --profile <json> --request <json> --repository-root <git-root> --source-archive <tar> --output-root <empty-dir> --plan <json> --docker <absolute-binary>
  project-sandbox-host.mjs verify --profile <json> --request <json> --receipt <json> --attestation <json> --trust-root <json> --invocation <json> --output-root <dir> --subject <urn>

This opt-in host adapter never executes Docker. plan-docker emits exact argv with candidateCodeExecuted=false.
An independently operated launcher may execute that argv and sign the receipt plus teardown attestation.
verify authenticates those exact bytes against the separately supplied Ed25519 trust root. The portable
project execute command remains blocked, and no approval, audit, deployment, or production authority is created.`;

try {
  const [operation, ...argumentsList] = process.argv.slice(2);
  if ([undefined, "--help", "-h"].includes(operation)) {
    process.stdout.write(`${usage}\n`);
  } else if (operation === "source-archive") {
    const options = parseOptions(argumentsList, ["--request", "--repository-root", "--output"]);
    const result = createProjectSandboxSourceArchiveV1({
      expectedRequest: readCanonicalJson(options.get("--request"), "request", 8 * 1024 * 1024),
      repositoryRoot: options.get("--repository-root"),
      outputPath: options.get("--output")
    });
    process.stdout.write(`${canonicalJsonV2(result)}\n`);
  } else if (operation === "plan-docker") {
    const options = parseOptions(argumentsList, [
      "--profile", "--request", "--repository-root", "--source-archive", "--output-root", "--plan", "--docker"
    ]);
    const profile = readCanonicalJson(options.get("--profile"), "profile", 4 * 1024 * 1024);
    const request = readCanonicalJson(options.get("--request"), "request", 8 * 1024 * 1024);
    const result = createDockerSandboxInvocationV1({
      profile,
      expectedRequest: request,
      repositoryRoot: options.get("--repository-root"),
      sourceArchivePath: options.get("--source-archive"),
      requestPath: options.get("--request"),
      outputRoot: options.get("--output-root"),
      planPath: options.get("--plan"),
      dockerExecutable: options.get("--docker")
    });
    process.stdout.write(`${canonicalJsonV2(result)}\n`);
  } else if (operation === "verify") {
    const options = parseOptions(argumentsList, [
      "--profile", "--request", "--receipt", "--attestation", "--trust-root", "--invocation", "--output-root", "--subject"
    ]);
    const result = verifyProjectSandboxHostCompletionV1({
      profile: readCanonicalJson(options.get("--profile"), "profile", 4 * 1024 * 1024),
      expectedRequest: readCanonicalJson(options.get("--request"), "request", 8 * 1024 * 1024),
      receipt: readCanonicalJson(options.get("--receipt"), "receipt", 64 * 1024 * 1024),
      attestation: readCanonicalJson(options.get("--attestation"), "attestation", 8 * 1024 * 1024),
      trustRoot: readCanonicalJson(options.get("--trust-root"), "trust root", 4 * 1024 * 1024),
      expectedInvocation: readCanonicalJson(options.get("--invocation"), "invocation", 8 * 1024 * 1024),
      outputRoot: options.get("--output-root"),
      expectedSubject: options.get("--subject")
    });
    process.stdout.write(`${canonicalJsonV2(result)}\n`);
  } else {
    throw hostCliError("PROJECT_SANDBOX_HOST_USAGE", `unknown operation ${operation}`);
  }
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "PROJECT_SANDBOX_HOST_FAILED";
  process.stderr.write(`project-sandbox-host: ${code}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

function parseOptions(argumentsList, expected) {
  if (argumentsList.length !== expected.length * 2) throw hostCliError("PROJECT_SANDBOX_HOST_USAGE", "required options are missing or repeated");
  const allowed = new Set(expected);
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(name) || options.has(name) || typeof value !== "string" || value.length === 0 || value.includes("\0") || value.startsWith("--")) {
      throw hostCliError("PROJECT_SANDBOX_HOST_USAGE", `invalid option ${String(name)}`);
    }
    options.set(name, value);
  }
  for (const name of expected) if (!options.has(name)) throw hostCliError("PROJECT_SANDBOX_HOST_USAGE", `missing ${name}`);
  return options;
}

function readCanonicalJson(filePath, label, maximumBytes) {
  let bytes;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) throw new Error("not a bounded regular file");
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    throw hostCliError("PROJECT_SANDBOX_HOST_INPUT_INVALID", `${label} is unavailable: ${error.message}`);
  }
  let value;
  try {
    value = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: maximumBytes, maxDepth: 256, maxNodes: 500_000 });
  } catch (error) {
    throw hostCliError("PROJECT_SANDBOX_HOST_INPUT_INVALID", `${label} is invalid JSON: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"))) {
    throw hostCliError("PROJECT_SANDBOX_HOST_INPUT_INVALID", `${label} must be canonical JSON plus one LF`);
  }
  return value;
}

function hostCliError(code, message) {
  return Object.assign(new Error(message), { code });
}
