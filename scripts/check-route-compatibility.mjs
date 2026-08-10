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
} from "./applicant-submission-core.mjs";
import {
  assessRouteCompatibility,
  loadReviewedRoutePlanSchema,
  parseReviewedRoutePlan,
  validateExactShardsApplicantRequest,
  validateReviewedRoutePlanRequestBinding,
  validateReviewedRoutePlan
} from "./route-compatibility-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

try {
  const [requestInput, planInput, ...rest] = process.argv.slice(2);
  if (requestInput === undefined || planInput === undefined || rest.length > 0) {
    throw new Error("usage: check-route-compatibility.mjs <submission-request.json> <reviewed-route-plan.json>");
  }
  const requestFile = resolveInsideRepository(requestInput);
  const planFile = resolveInsideRepository(planInput);
  const requestPath = repositoryRelativePath(requestFile);
  const planPath = repositoryRelativePath(planFile);
  const requestBytes = fs.readFileSync(requestFile);
  const request = parseApplicantSubmission(requestBytes);
  const requestFindings = validateApplicantSubmission(
    request,
    loadApplicantSubmissionSchema(repositoryRoot),
    { relativePath: requestPath }
  );
  if (requestFindings.length === 0) {
    requestFindings.push(...validateExactShardsApplicantRequest(
      request,
      applicantSubmissionEvidence(request, requestBytes, requestPath)
    ));
  }
  const reviewedPlan = parseReviewedRoutePlan(fs.readFileSync(planFile));
  const planFindings = validateReviewedRoutePlan(reviewedPlan, loadReviewedRoutePlanSchema(repositoryRoot));
  if (requestFindings.length === 0 && planFindings.length === 0) {
    planFindings.push(...validateReviewedRoutePlanRequestBinding(
      request,
      applicantSubmissionEvidence(request, requestBytes, requestPath),
      reviewedPlan
    ));
  }
  if (requestFindings.length > 0 || planFindings.length > 0) {
    process.stdout.write(`${JSON.stringify({
      status: "ROUTE_COMPATIBILITY_INPUT_INVALID",
      networkAccessed: false,
      externalActionsPerformed: [],
      request: { path: requestPath, findings: requestFindings },
      reviewedPlan: { path: planPath, findings: planFindings }
    }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const assessment = assessRouteCompatibility(request.requestedRoute, reviewedPlan);
    process.stdout.write(`${JSON.stringify({
      ...assessment,
      networkAccessed: false,
      externalActionsPerformed: [],
      requestPath,
      reviewedPlanPath: planPath
    }, null, 2)}\n`);
    if (assessment.status !== "ROUTE_SUPPORTED") process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`check-route-compatibility: ${error.message}\n`);
  process.exitCode = 2;
}

function resolveInsideRepository(input) {
  if (typeof input !== "string" || input.length === 0 || path.isAbsolute(input) || input.includes("\\")) {
    throw new Error("input path must be a normalized repository-relative path");
  }
  const normalizedInput = path.posix.normalize(input);
  if (
    normalizedInput !== input
    || normalizedInput === "."
    || normalizedInput === ".."
    || normalizedInput.startsWith("../")
  ) throw new Error("input path must be a normalized repository-relative path");
  const resolved = path.resolve(repositoryRoot, normalizedInput);
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(fs.realpathSync(repositoryRoot), real);
  if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error("input path escapes this repository");
  }
  if (realRelative.split(path.sep).join("/") !== normalizedInput) {
    throw new Error("input path must identify the exact repository-relative file without aliases");
  }
  return real;
}

function repositoryRelativePath(file) {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}
