#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  generateApplicantValidatorPackageClosure,
  materializeApplicantValidatorPackage,
  verifyApplicantValidatorPackage
} from "./applicant-validator-package-core.mjs";

const defaultSkillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function main(argv) {
  const [command, ...argumentsList] = argv;
  const options = parseOptions(argumentsList);
  const skillRoot = options.get("--skill-root") ?? defaultSkillRoot;
  if (command === "generate") {
    const outputRoot = requireOption(options, "--output-root");
    const closure = generateApplicantValidatorPackageClosure({ skillRoot });
    return materializeApplicantValidatorPackage({ closure, outputRoot });
  }
  if (command === "check") {
    const packageRoot = requireOption(options, "--package-root");
    return verifyApplicantValidatorPackage({ skillRoot, packageRoot });
  }
  throw new TypeError([
    "Usage:",
    "  applicant-validator-package.mjs generate --output-root <path> [--skill-root <path>]",
    "  applicant-validator-package.mjs check --package-root <path> [--skill-root <path>]"
  ].join("\n"));
}

function parseOptions(argv) {
  const allowed = new Set(["--output-root", "--package-root", "--skill-root"]);
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new TypeError("Applicant validator package options are invalid");
    }
    if (result.has(name)) throw new TypeError(`Applicant validator package option is duplicated: ${name}`);
    result.set(name, value);
  }
  if (result.has("--output-root") && result.has("--package-root")) {
    throw new TypeError("Select exactly one Applicant validator package output mode");
  }
  return result;
}

function requireOption(options, name) {
  const value = options.get(name);
  if (value === undefined) throw new TypeError(`Missing required option: ${name}`);
  return value;
}

try {
  const result = main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    name: error?.name ?? "Error",
    code: error?.code ?? "APPLICANT_VALIDATOR_PACKAGE_COMMAND_FAILED",
    message: error?.message ?? "Applicant validator package command failed"
  })}\n`);
  process.exitCode = 1;
}
