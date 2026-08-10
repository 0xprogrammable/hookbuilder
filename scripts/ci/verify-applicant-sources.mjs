#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  loadApplicantSubmissionSchema,
  parseApplicantSubmission,
  validateApplicantSubmission
} from "../applicant-submission-core.mjs";
import {
  ApplicantFastLaneError,
  parseRequestPathsJson,
  verifyApplicantSources
} from "./applicant-fast-lane-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");

try {
  const options = parseArgs(process.argv.slice(2));
  const requestPaths = parseRequestPathsJson(options.requestsJson);
  const schema = loadApplicantSubmissionSchema(repositoryRoot);
  const requests = requestPaths.map((relativePath) => {
    const absolutePath = resolveRequest(options.candidateRoot, relativePath);
    const bytes = fs.readFileSync(absolutePath);
    const value = parseApplicantSubmission(bytes);
    const findings = validateApplicantSubmission(value, schema, { relativePath });
    if (findings.length > 0) {
      throw new ApplicantFastLaneError("SOURCE_INPUT_INVALID", `applicant request failed intake: ${relativePath}`);
    }
    return value;
  });
  const report = await verifyApplicantSources(requests, {
    token: null
  });
  writeNewJson(options.output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const code = error instanceof ApplicantFastLaneError ? error.code : "APPLICANT_SOURCE_CHECK_FAILED";
  process.stderr.write(`verify-applicant-sources: ${code}: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = { requestsJson: null, output: null, candidateRoot: repositoryRoot };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--requests-json") values.requestsJson = take(args, ++index, flag);
    else if (flag === "--output") values.output = take(args, ++index, flag);
    else if (flag === "--candidate-root") values.candidateRoot = take(args, ++index, flag);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (values.requestsJson === null || values.output === null) {
    throw new Error("usage: verify-applicant-sources.mjs --requests-json <json> --output <new-file>");
  }
  return values;
}

function resolveRequest(candidateRoot, relativePath) {
  const root = path.resolve(candidateRoot);
  const rootEntry = fs.lstatSync(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new Error("candidate root must be one real directory");
  }
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  const entry = fs.lstatSync(absolutePath);
  if (
    relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || !entry.isFile()
    || entry.isSymbolicLink()
    || fs.realpathSync(absolutePath) !== absolutePath
  ) throw new Error("applicant request must be one direct regular file inside the candidate root");
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
