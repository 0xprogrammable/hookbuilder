import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJsonBytesV2 } from "../../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";
import {
  applicantSubmissionEvidence,
  loadApplicantSubmissionSchema,
  parseApplicantSubmission,
  validateApplicantSubmission
} from "../applicant-submission-core.mjs";
import {
  ApplicantFastLaneError,
  APPLICANT_FAST_LANE_SCHEMA_VERSION,
  sha256
} from "./applicant-fast-lane-core.mjs";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;

export async function loadRouteReviewProvider(repositoryRoot, providerPath) {
  const root = realDirectory(repositoryRoot, "trusted repository root");
  const absolutePath = path.resolve(root, providerPath);
  const relative = path.relative(root, absolutePath);
  if (
    relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || !fs.existsSync(absolutePath)
    || fs.lstatSync(absolutePath).isSymbolicLink()
    || !fs.lstatSync(absolutePath).isFile()
  ) {
    throw new ApplicantFastLaneError(
      "ROUTE_CAPABILITY_PROVIDER_MISSING",
      "canonical route capability provider is missing; merge the acceptance lane before enabling the fast lane"
    );
  }
  const provider = await import(pathToFileURL(fs.realpathSync(absolutePath)).href);
  for (const name of [
    "assessRouteCompatibility",
    "classifyReviewedRoutePlan",
    "loadReviewedRoutePlanSchema",
    "resolveApplicantRouteReview",
    "validateReviewedRoutePlan",
    "validateReviewedRoutePlanRequestBinding"
  ]) {
    if (typeof provider[name] !== "function") {
      throw new ApplicantFastLaneError(
        "ROUTE_CAPABILITY_PROVIDER_INVALID",
        `canonical route capability provider is missing ${name}`
      );
    }
  }
  return Object.freeze({ provider, repositoryRoot: root });
}

export function loadCandidateRequest({ repositoryRoot, candidateRoot, relativePath }) {
  const trustedRoot = realDirectory(repositoryRoot, "trusted repository root");
  const dataRoot = realDirectory(candidateRoot, "candidate data root");
  const absolutePath = path.resolve(dataRoot, relativePath);
  const relative = path.relative(dataRoot, absolutePath);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ApplicantFastLaneError("FAST_LANE_INPUT_INVALID", "candidate request resolves outside its data root");
  }
  const entry = fs.lstatSync(absolutePath);
  if (!entry.isFile() || entry.isSymbolicLink() || fs.realpathSync(absolutePath) !== absolutePath) {
    throw new ApplicantFastLaneError("FAST_LANE_INPUT_INVALID", "candidate request must be one direct regular file");
  }
  const bytes = fs.readFileSync(absolutePath);
  const request = parseApplicantSubmission(bytes);
  const schema = loadApplicantSubmissionSchema(trustedRoot);
  const findings = validateApplicantSubmission(request, schema, { relativePath });
  return Object.freeze({
    relativePath,
    bytes,
    request,
    findings: Object.freeze(findings),
    evidence: findings.length === 0
      ? applicantSubmissionEvidence(request, bytes, relativePath)
      : null
  });
}

export function resolveCandidateRouteReview({ provider, repositoryRoot, candidate }) {
  if (candidate.findings.length > 0 || candidate.evidence === null) {
    return failedCapability(candidate, "ROUTE_UNSUPPORTED", candidate.findings);
  }
  const resolved = provider.resolveApplicantRouteReview(candidate.request, candidate.evidence);
  if (resolved === null) {
    return failedCapability(candidate, "ROUTE_UNSUPPORTED", [{
      code: "REVIEWED_ROUTE_PLAN_REQUIRED",
      message: "No platform/compiler-owned exact reviewed-plan catalog entry matches this applicant revision."
    }]);
  }
  if (
    resolved === null
    || typeof resolved !== "object"
    || Array.isArray(resolved)
    || !sameKeys(resolved, ["applicantRevenuePolicyHash", "bindingSha256", "reviewedPlan"])
    || !SHA256.test(resolved.bindingSha256 ?? "")
    || !BYTES32.test(resolved.applicantRevenuePolicyHash ?? "")
  ) {
    throw new ApplicantFastLaneError(
      "ROUTE_CAPABILITY_PROVIDER_INVALID",
      "canonical route review resolver returned an invalid exact binding"
    );
  }
  const reviewedPlan = resolved.reviewedPlan;
  const planSchema = provider.loadReviewedRoutePlanSchema(repositoryRoot);
  // The catalog constant is schema-free by design; validate the same immutable bytes
  // under its declared transport schema without changing the reviewed binding.
  const planFindings = provider.validateReviewedRoutePlan({
    $schema: "urn:programmable:reviewed-route-plan:1.0.0",
    ...reviewedPlan
  }, planSchema);
  const bindingFindings = provider.validateReviewedRoutePlanRequestBinding(
    candidate.request,
    candidate.evidence,
    reviewedPlan
  );
  const allFindings = [...planFindings, ...bindingFindings];
  if (allFindings.length > 0) return failedCapability(candidate, "ROUTE_UNSUPPORTED", allFindings);

  const assessment = provider.assessRouteCompatibility(candidate.request.requestedRoute, reviewedPlan);
  const classification = provider.classifyReviewedRoutePlan(reviewedPlan);
  if (
    assessment.capabilityClassification !== classification
    || (assessment.capability.revenuePolicyHash !== null
      && assessment.capability.revenuePolicyHash !== resolved.applicantRevenuePolicyHash)
  ) {
    throw new ApplicantFastLaneError(
      "ROUTE_CAPABILITY_PROVIDER_INVALID",
      "reviewed plan, route capability, or exact applicant revenue binding disagrees"
    );
  }
  const profileBindingSha256 = sha256(canonicalJsonBytesV2(assessment.capability, { trailingNewline: false }));
  const artifactCode = Array.isArray(reviewedPlan.artifactCode) ? reviewedPlan.artifactCode : [];
  return Object.freeze({
    path: candidate.relativePath,
    status: assessment.status,
    supported: assessment.supported,
    requestedRoute: structuredClone(candidate.request.requestedRoute),
    requiredRoute: structuredClone(assessment.requiredRoute),
    bindingSha256: profileBindingSha256,
    reviewBindingSha256: resolved.bindingSha256,
    revenuePolicyHash: resolved.applicantRevenuePolicyHash,
    revenuePolicySemantics: assessment.capability.revenuePolicySemantics,
    source: structuredClone(candidate.request.source),
    applicationManifestSha256: candidate.evidence.applicationManifest.sha256,
    sourceManifestPath: reviewedPlan.artifact.path,
    sourceManifestBytes: reviewedPlan.artifact.bytes,
    sourceManifestSha256: reviewedPlan.artifact.sha256,
    codeHashesSha256: sha256(canonicalJsonBytesV2(artifactCode, { trailingNewline: false })),
    routeCapability: structuredClone(assessment.capability),
    acceptanceRequired: assessment.acceptanceRequired
  });
}

export function verifyApplicantProfileSecurity({ provider, repositoryRoot, candidate }) {
  const capability = resolveCandidateRouteReview({ provider, repositoryRoot, candidate });
  if (capability.status === "ROUTE_UNSUPPORTED") {
    throw new ApplicantFastLaneError("APPLICANT_SECURITY_UNSUPPORTED", "applicant has no exact reviewed security profile");
  }
  const resolved = provider.resolveApplicantRouteReview(candidate.request, candidate.evidence);
  const plan = resolved.reviewedPlan;
  const classification = provider.classifyReviewedRoutePlan(plan);
  const hook = plan.components.find(({ kind }) => kind === "hook");
  if (hook === undefined) {
    throw new ApplicantFastLaneError("APPLICANT_SECURITY_MISMATCH", "reviewed plan has no exact hook component");
  }
  const observedMask = `0x${(BigInt(hook.address) & 0x3fffn).toString(16).padStart(4, "0")}`;
  if (observedMask !== candidate.request.hook.addressFlagMask.toLowerCase()) {
    throw new ApplicantFastLaneError(
      "APPLICANT_SECURITY_MISMATCH",
      "reviewed hook address flags differ from the applicant permission declaration"
    );
  }
  const componentAddresses = plan.components.map(({ address }) => address.toLowerCase());
  if (
    new Set(componentAddresses).size !== componentAddresses.length
    || componentAddresses.includes(plan.routeTarget.address.toLowerCase())
    || plan.components.some(({ deployer }) => deployer.toLowerCase() !== plan.routeTarget.address.toLowerCase())
  ) {
    throw new ApplicantFastLaneError(
      "APPLICANT_SECURITY_MISMATCH",
      "reviewed route target and child deployment topology is inconsistent"
    );
  }
  if (
    classification === "exact-shards-nested-factory"
    && plan.revenuePolicy?.revenuePolicyHash !== resolved.applicantRevenuePolicyHash
  ) {
    throw new ApplicantFastLaneError(
      "APPLICANT_SECURITY_MISMATCH",
      "exact Shards reviewed economics differ from the applicant revenue binding"
    );
  }
  return Object.freeze({
    schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
    status: "APPLICANT_PROFILE_SECURITY_BINDINGS_VERIFIED",
    path: candidate.relativePath,
    capability: classification,
    reviewBindingSha256: resolved.bindingSha256,
    profileBindingSha256: capability.bindingSha256,
    revenuePolicyHash: resolved.applicantRevenuePolicyHash,
    hookAddressFlagMask: observedMask,
    componentCount: plan.components.length,
    networkAccessed: false,
    externalActionsPerformed: []
  });
}

function failedCapability(candidate, status, findings) {
  return Object.freeze({
    path: candidate.relativePath,
    status,
    supported: null,
    requestedRoute: candidate.request?.requestedRoute && typeof candidate.request.requestedRoute === "object"
      ? structuredClone(candidate.request.requestedRoute)
      : null,
    requiredRoute: null,
    bindingSha256: null,
    reviewBindingSha256: null,
    revenuePolicyHash: null,
    revenuePolicySemantics: null,
    source: null,
    applicationManifestSha256: null,
    sourceManifestPath: null,
    sourceManifestBytes: null,
    sourceManifestSha256: null,
    codeHashesSha256: null,
    routeCapability: null,
    acceptanceRequired: false,
    findings: findings.map(({ code, message, path: findingPath = null }) => ({
      code,
      message,
      path: findingPath
    }))
  });
}

function realDirectory(value, label) {
  const absolute = path.resolve(value);
  const entry = fs.lstatSync(absolute);
  if (!entry.isDirectory() || entry.isSymbolicLink() || fs.realpathSync(absolute) !== absolute) {
    throw new ApplicantFastLaneError("FAST_LANE_INPUT_INVALID", `${label} must be one real directory`);
  }
  return absolute;
}

function sameKeys(value, keys) {
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
