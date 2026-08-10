#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  applicantSubmissionEvidence,
  loadApplicantSubmissionSchema,
  parseApplicantSubmission,
  validateApplicantSubmission
} from "../applicant-submission-core.mjs";
import {
  ApplicantFastLaneError,
  parseRequestPathsJson
} from "./applicant-fast-lane-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");

try {
  const options = parseArgs(process.argv.slice(2));
  const requestPaths = parseRequestPathsJson(options.requestsJson);
  const schema = loadApplicantSubmissionSchema(repositoryRoot);
  const requests = requestPaths.map((relativePath) => {
    const absolutePath = resolveRequest(relativePath, options.candidateRoot);
    const bytes = fs.readFileSync(absolutePath);
    const value = parseApplicantSubmission(bytes);
    const findings = validateApplicantSubmission(value, schema, { relativePath });
    return findings.length === 0
      ? { ...applicantSubmissionEvidence(value, bytes, relativePath), findings }
      : { path: relativePath, findings };
  });
  const valid = requests.every(({ findings }) => findings.length === 0);
  const report = {
    schemaVersion: "1.0.0",
    status: valid ? "APPLICANT_INTAKE_VALID" : "APPLICANT_INTAKE_INVALID",
    networkAccessed: false,
    externalActionsPerformed: [],
    requests
  };
  writeNewJson(options.output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!valid) process.exitCode = 1;
} catch (error) {
  const code = error instanceof ApplicantFastLaneError ? error.code : "APPLICANT_INTAKE_FAILED";
  process.stderr.write(`run-applicant-intake: ${code}: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = { requestsJson: null, output: null, candidateRoot: repositoryRoot };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--requests-json") values.requestsJson = take(args, ++index, args[index - 1]);
    else if (args[index] === "--output") values.output = take(args, ++index, args[index - 1]);
    else if (args[index] === "--candidate-root") values.candidateRoot = take(args, ++index, args[index - 1]);
    else throw new Error(`unknown argument: ${args[index]}`);
  }
  if (values.requestsJson === null || values.output === null) {
    throw new Error("usage: run-applicant-intake.mjs --requests-json <json> --output <new-file>");
  }
  return values;
}

function resolveRequest(relativePath, candidateRoot) {
  const root = path.resolve(candidateRoot);
  const rootEntry = fs.lstatSync(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new Error("candidate root must be one real directory");
  }
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("applicant request resolves outside the repository");
  }
  const entry = fs.lstatSync(absolutePath);
  if (!entry.isFile() || entry.isSymbolicLink() || fs.realpathSync(absolutePath) !== absolutePath) {
    throw new Error("applicant request path alias is forbidden");
  }
  return absolutePath;
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
