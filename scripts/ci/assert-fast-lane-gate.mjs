#!/usr/bin/env node

import process from "node:process";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.plan !== "success") fail("fast-lane planning did not complete successfully");
  if (options.gate === "applicant") {
    if (options.mode === "platform") pass("APPLICANT_GATE_NOT_APPLICABLE");
    requireSuccess(options.acceptance, "Website route acceptance");
    requireSuccess(options.mutable, "applicant mutable checks");
    pass("APPLICANT_GATE_PASSED");
  } else {
    if (options.mode === "applicant") {
      requireSuccess(options.attestation, "platform profile attestation");
      pass("PLATFORM_PROFILE_GATE_PASSED");
    }
    requireSuccess(options.repository, "repository matrix");
    requireSuccess(options.referenceKernel, "reference-kernel matrix");
    requireSuccess(options.codeql, "CodeQL");
    if (options.mode === "mixed") requireSuccess(options.attestation, "platform profile attestation");
    pass("PLATFORM_PROFILE_GATE_PASSED");
  }
} catch (error) {
  process.stderr.write(`assert-fast-lane-gate: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = {
    gate: null,
    mode: null,
    plan: null,
    acceptance: null,
    mutable: null,
    repository: null,
    referenceKernel: null,
    codeql: null,
    attestation: null
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = take(args, ++index, flag);
    if (flag === "--gate") values.gate = value;
    else if (flag === "--mode") values.mode = value;
    else if (flag === "--plan") values.plan = value;
    else if (flag === "--acceptance") values.acceptance = value;
    else if (flag === "--mutable") values.mutable = value;
    else if (flag === "--repository") values.repository = value;
    else if (flag === "--reference-kernel") values.referenceKernel = value;
    else if (flag === "--codeql") values.codeql = value;
    else if (flag === "--attestation") values.attestation = value;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!new Set(["applicant", "platform"]).has(values.gate)) throw new Error("--gate is invalid");
  if (!new Set(["applicant", "mixed", "platform"]).has(values.mode)) throw new Error("--mode is invalid");
  return values;
}

function requireSuccess(result, label) {
  if (result !== "success") fail(`${label} result was ${result ?? "missing"}`);
}

function pass(status) {
  process.stdout.write(`${JSON.stringify({ status, externalActionsPerformed: [] }, null, 2)}\n`);
  process.exit(0);
}

function fail(message) {
  throw new Error(message);
}

function take(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}
