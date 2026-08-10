#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ApplicantFastLaneError,
  APPLICANT_FAST_LANE_SCHEMA_VERSION,
  parseRequestPathsJson
} from "./applicant-fast-lane-core.mjs";
import {
  loadCandidateRequest,
  loadRouteReviewProvider,
  resolveCandidateRouteReview
} from "./applicant-route-review-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const defaultProvider = "scripts/route-compatibility-core.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const requestPaths = parseRequestPathsJson(options.requestsJson);
  let provider;
  try {
    ({ provider } = await loadRouteReviewProvider(repositoryRoot, options.provider));
  } catch (error) {
    if (!(error instanceof ApplicantFastLaneError) || error.code !== "ROUTE_CAPABILITY_PROVIDER_MISSING") throw error;
    const report = disabledReport(requestPaths);
    writeNewJson(options.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    throw new ApplicantFastLaneError(
      "ROUTE_CAPABILITY_DISABLED",
      "canonical route capability provider is unavailable; applicant capability remains disabled"
    );
  }
  const requests = requestPaths.map((relativePath) => resolveCandidateRouteReview({
    provider,
    repositoryRoot,
    candidate: loadCandidateRequest({
      repositoryRoot,
      candidateRoot: options.candidateRoot,
      relativePath
    })
  }));
  const status = requests.every(({ status: requestStatus }) => requestStatus === "ROUTE_SUPPORTED")
    ? "ROUTE_SUPPORTED"
    : requests.some(({ status: requestStatus }) => requestStatus === "ROUTE_CAPABILITY_DISABLED")
      ? "ROUTE_CAPABILITY_DISABLED"
      : requests.some(({ status: requestStatus }) => requestStatus === "ROUTE_ACCEPTANCE_REQUIRED")
        ? "ROUTE_ACCEPTANCE_REQUIRED"
        : "ROUTE_UNSUPPORTED";
  const report = {
    schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
    status,
    requests
  };
  writeNewJson(options.output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (status === "ROUTE_UNSUPPORTED" || status === "ROUTE_CAPABILITY_DISABLED") process.exitCode = 1;
} catch (error) {
  const code = error instanceof ApplicantFastLaneError ? error.code : "ROUTE_CAPABILITY_CHECK_FAILED";
  process.stderr.write(`check-applicant-route-capability: ${code}: ${error.message}\n`);
  process.exitCode = 1;
}

function disabledReport(requestPaths) {
  return Object.freeze({
    schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
    status: "ROUTE_CAPABILITY_DISABLED",
    reason: "CANONICAL_ROUTE_PROVIDER_UNAVAILABLE",
    requests: requestPaths.map((requestPath) => Object.freeze({
      path: requestPath,
      status: "ROUTE_CAPABILITY_DISABLED",
      supported: null,
      acceptanceRequired: false
    }))
  });
}

function parseArgs(args) {
  const values = {
    requestsJson: null,
    output: null,
    provider: defaultProvider,
    candidateRoot: repositoryRoot
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--requests-json") values.requestsJson = take(args, ++index, flag);
    else if (flag === "--output") values.output = take(args, ++index, flag);
    else if (flag === "--provider") values.provider = take(args, ++index, flag);
    else if (flag === "--candidate-root") values.candidateRoot = take(args, ++index, flag);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (values.requestsJson === null || values.output === null) {
    throw new Error(
      "usage: check-applicant-route-capability.mjs --requests-json <json> --output <new-file> [--candidate-root <dir>]"
    );
  }
  return values;
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
