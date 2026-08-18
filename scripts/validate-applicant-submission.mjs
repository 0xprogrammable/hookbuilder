#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  applicantSubmissionEvidence,
  assertApplicantRequestBounds,
  listApplicantRequestFiles,
  loadApplicantSubmissionSchema,
  parseApplicantSubmission,
  readApplicantRequestFile,
  validateApplicantSubmission
} from "./applicant-submission-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

try {
  const files = resolveFiles(process.argv.slice(2));
  const schema = loadApplicantSubmissionSchema(repositoryRoot);
  const reports = files.map((file) => validateFile(file, schema));
  const valid = reports.every(({ findings }) => findings.length === 0);
  process.stdout.write(`${JSON.stringify({
    status: valid ? "APPLICANT_SUBMISSIONS_VALID" : "APPLICANT_SUBMISSIONS_INVALID",
    networkAccessed: false,
    externalActionsPerformed: [],
    files: reports
  }, null, 2)}\n`);
  if (!valid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`validate-applicant-submission: ${error.message}\n`);
  process.exitCode = 2;
}

function resolveFiles(args) {
  if (args.length === 1 && args[0] === "--all") {
    const requestsRoot = resolveInsideRepository("submissions/requests");
    return listApplicantRequestFiles(requestsRoot);
  }
  if (args.length === 0 || args.some((argument) => argument.startsWith("--"))) {
    throw new Error("usage: validate-applicant-submission.mjs --all | <submission.json> [...]");
  }
  return assertApplicantRequestBounds(
    [...new Set(args.map(resolveInsideRepository))].sort((left, right) => left.localeCompare(right))
  );
}

function resolveInsideRepository(input) {
  if (typeof input !== "string" || input.length === 0 || path.isAbsolute(input) || input.includes("\\")) {
    throw new Error("submission path must be a normalized repository-relative path");
  }
  const normalizedInput = path.posix.normalize(input);
  if (
    normalizedInput !== input
    || normalizedInput === "."
    || normalizedInput === ".."
    || normalizedInput.startsWith("../")
  ) {
    throw new Error("submission path must be a normalized repository-relative path");
  }
  const resolved = path.resolve(repositoryRoot, normalizedInput);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("submission path must resolve to a file inside this repository");
  }
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(fs.realpathSync(repositoryRoot), real);
  if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error("submission path escapes this repository");
  }
  if (realRelative.split(path.sep).join("/") !== normalizedInput) {
    throw new Error("submission path must identify the exact repository-relative file without aliases");
  }
  return real;
}

function validateFile(file, schema) {
  const relativePath = path.relative(repositoryRoot, file).split(path.sep).join("/");
  const bytes = readApplicantRequestFile(file);
  const value = parseApplicantSubmission(bytes);
  const findings = validateApplicantSubmission(value, schema, { relativePath });
  return {
    ...(findings.length === 0 ? applicantSubmissionEvidence(value, bytes, relativePath) : { path: relativePath }),
    findings
  };
}
