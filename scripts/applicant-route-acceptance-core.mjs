import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseBoundedLosslessJson } from "../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import {
  CANONICAL_JSON_V2_PROFILE,
  canonicalJsonBytesV2
} from "../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";
import { checksumAddress } from "../skills/programmable-v4-hook-builder/scripts/evm-encoding-core.mjs";
import { validateAgainstSchema } from "../skills/programmable-v4-hook-builder/scripts/restricted-json-schema-core.mjs";
import {
  EXACT_SHARDS_APPLICANT_GITHUB_USER_ID,
  EXACT_SHARDS_REVIEWED_PLAN_SHA256,
  EXACT_SHARDS_REVIEWED_PLAN_V1,
  assessRouteCompatibility,
  isNormalizedRepositoryPath
} from "./route-compatibility-core.mjs";

export const APPLICANT_ROUTE_ACCEPTANCE_SCHEMA_VERSION = "1.0.0";
export const APPLICANT_ROUTE_ACCEPTANCE_CLAIM_TYPE =
  "urn:programmable:applicant-route-acceptance:1.0.0";
export const APPLICATION_ACCEPTANCE_SUBJECT_V1_TYPE =
  "programmable.application-acceptance-subject.v1";
export const APPLICANT_ROUTE_ACCEPTANCE_TRANSITION_TYPE =
  "programmable.applicant-route-acceptance-transition.v1";
export const APPLICANT_ROUTE_ACCEPTANCE_COMMAND_TYPE =
  "programmable.applicant-route-acceptance-command.v1";
export const APPLICANT_ROUTE_ACCEPTANCE_RECORD_CORE_TYPE =
  "programmable.applicant-route-acceptance-record-core.v1";
export const APPLICANT_ROUTE_ACCEPTANCE_CANONICAL_CLAIM_ENCODING =
  "canonical-json-v2-utf8-no-trailing-newline";
export const APPLICANT_ROUTE_ACCEPTANCE_PENDING_STATE = "pending";
export const APPLICANT_ROUTE_ACCEPTANCE_ACCEPTED_STATE = "accepted";
export const MAXIMUM_APPLICANT_ROUTE_ACCEPTANCE_BYTES = 64 * 1024;
export const APPLICANT_ROUTE_ACCEPTANCE_CANONICALIZATION = CANONICAL_JSON_V2_PROFILE.id;
const ZERO_GIT_OBJECT_ID = "0".repeat(40);

export function loadApplicantRouteAcceptanceSchema(repositoryRoot) {
  return JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "submissions", "schema", "applicant-route-acceptance-v1.schema.json"),
    "utf8"
  ));
}

export function parseApplicantRouteAcceptance(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("applicant route acceptance bytes must be a Buffer");
  if (bytes.length === 0 || bytes.length > MAXIMUM_APPLICANT_ROUTE_ACCEPTANCE_BYTES) {
    throw new Error(
      `applicant route acceptance must contain 1 to ${MAXIMUM_APPLICANT_ROUTE_ACCEPTANCE_BYTES} bytes`
    );
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseBoundedLosslessJson(source);
  return JSON.parse(source);
}

export function validateApplicantRouteAcceptance(value, schema) {
  const findings = validateAgainstSchema(value, schema).map((finding) => ({
    ...finding,
    remediation: "Make the claim match submissions/schema/applicant-route-acceptance-v1.schema.json."
  }));
  const add = (code, field, message, remediation) => findings.push({
    severity: "blocker",
    code,
    path: field,
    message,
    remediation
  });
  if (findings.length > 0 || value === null || typeof value !== "object" || Array.isArray(value)) {
    return findings;
  }

  const embeddedPlan = { $schema: "urn:programmable:reviewed-route-plan:1.0.0", ...value.reviewedPlan };
  try {
    const assessment = assessRouteCompatibility(value.acceptedRoute, embeddedPlan);
    if (
      assessment.capabilityClassification !== "exact-shards-nested-factory"
      || !sameJson(value.acceptedRoute, assessment.requiredRoute)
    ) {
      add(
        "ROUTE_ACCEPTANCE_CAPABILITY_UNSUPPORTED",
        "$.acceptedRoute",
        "Acceptance route does not match the exact published Shards nested-factory capability.",
        "Use nested-factory@1.0.0 on chain 1 with the exact frozen Shards capability."
      );
    } else if (!sameJson(value.routeCapability, assessment.capability)) {
      add(
        "ROUTE_ACCEPTANCE_CAPABILITY_MISMATCH",
        "$.routeCapability",
        "Acceptance capability catalog binding differs from the exact reviewed plan.",
        "Use the complete catalog capability emitted by the deterministic compatibility report."
      );
    }
    if (assessment.status === "ROUTE_CAPABILITY_DISABLED") {
      add(
        "ROUTE_ACCEPTANCE_CAPABILITY_DISABLED",
        "$.routeCapability.activationState",
        "Shards nested-factory acceptance is disabled until the exact production release attestation is frozen.",
        "Do not expose or persist Website acceptance until the published capability is explicitly activated."
      );
    }
  } catch {
    add(
      "ROUTE_ACCEPTANCE_REVIEWED_PLAN_UNSUPPORTED",
      "$.reviewedPlan",
      "Acceptance reviewed plan is not the exact published Shards nested-factory profile.",
      "Use the exact immutable reviewed plan without adding a generic nested-factory variant."
    );
  }

  if (!sameJson(value.reviewedRequest, EXACT_SHARDS_REVIEWED_PLAN_V1.reviewedRequest)) {
    add(
      "ROUTE_ACCEPTANCE_REVIEWED_REQUEST_MISMATCH",
      "$.reviewedRequest",
      "Acceptance does not bind the exact merged Shards request and PR author identity.",
      "Use the exact request path, canonical applicationManifest digest, PR head, and numeric GitHub author ID."
    );
  }
  if (!sameJson(value.source, EXACT_SHARDS_REVIEWED_PLAN_V1.source)) {
    add(
      "ROUTE_ACCEPTANCE_SOURCE_MISMATCH",
      "$.source",
      "Acceptance source differs from the reviewed Shards repository, commit, or tree.",
      "Use jesse-stahl/shards-v1 at the exact reviewed commit and root tree."
    );
  }
  if (!sameJson(value.originalRoute, {
    routeId: "custom-graph",
    routeVersion: "1.0.0",
    chainId: "1"
  })) {
    add(
      "ROUTE_ACCEPTANCE_ORIGINAL_ROUTE_MISMATCH",
      "$.originalRoute",
      "Acceptance does not preserve the custom-graph@1.0.0 route in the merged request.",
      "Bind the immutable reviewed route separately from the newly accepted nested-factory route."
    );
  }
  if (
    !sameJson(value.reviewedRequestedActions, ["review"])
    || value.authorizationGranted !== false
  ) {
    add(
      "ROUTE_ACCEPTANCE_SCOPE_ESCALATION",
      "$.acceptanceScope",
      "Route acceptance cannot grant launch authorization or alter the request's review-only action.",
      "Keep reviewedRequestedActions=[review], authorizationGranted=false, and the route-binding-review-only scope."
    );
  }
  if (
    value.applicant.githubLogin !== "jesse-stahl"
    || value.applicant.githubUserId !== EXACT_SHARDS_APPLICANT_GITHUB_USER_ID
    || value.applicant.launchWallet !== "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC"
  ) {
    add(
      "ROUTE_ACCEPTANCE_APPLICANT_MISMATCH",
      "$.applicant",
      "Acceptance applicant login, numeric GitHub identity, or launch wallet differs from the reviewed request.",
      "Bind GitHub user ID 155705664 and the exact public EIP-55 launch wallet from the merged request."
    );
  }
  if (value.reviewedRequest.pullRequest.authorGithubUserId !== value.applicant.githubUserId) {
    add(
      "ROUTE_ACCEPTANCE_GITHUB_IDENTITY_MISMATCH",
      "$.applicant.githubUserId",
      "Acceptance numeric GitHub identity differs from the reviewed-request PR author.",
      "Require the Website GitHub session numeric user ID to equal the reviewed PR author ID."
    );
  }

  for (const [field, address] of [
    ["$.applicant.launchWallet", value.applicant.launchWallet],
    ["$.router.address", value.router.address]
  ]) {
    const checksummed = checksumAddress(address, { label: field });
    if (checksummed !== address) {
      add(
        "ROUTE_ACCEPTANCE_ADDRESS_NOT_CANONICAL",
        field,
        `Address must use its exact EIP-55 form ${checksummed}.`,
        "Use the checksummed address from the frozen production binding."
      );
    }
  }
  if (!isNormalizedRepositoryPath(value.router.contractPath) || !value.router.contractPath.endsWith(".sol")) {
    add(
      "ROUTE_ACCEPTANCE_ROUTER_SOURCE_PATH_INVALID",
      "$.router.contractPath",
      "Router contract path must be one normalized repository-relative Solidity source path.",
      "Use the exact .sol path inside the pinned Router source tree."
    );
  }
  if (!value.router.source.repository.startsWith("https://github.com/0xprogrammable/")) {
    add(
      "ROUTE_ACCEPTANCE_ROUTER_SOURCE_OWNER_INVALID",
      "$.router.source.repository",
      "Production Router source must be pinned in an 0xprogrammable GitHub repository.",
      "Use the exact public production Router source repository."
    );
  }
  if (value.router.source.commit === ZERO_GIT_OBJECT_ID || value.router.source.tree === ZERO_GIT_OBJECT_ID) {
    add(
      "ROUTE_ACCEPTANCE_ROUTER_SOURCE_ZERO",
      "$.router.source",
      "Router source commit and tree cannot be zero object IDs.",
      "Bind the exact immutable production source commit and root tree."
    );
  }
  const occupied = new Set([
    value.reviewedPlan.routeTarget.address,
    value.reviewedPlan.poolManager.address,
    ...value.reviewedPlan.components.map(({ address }) => address)
  ].map((address) => address.toLowerCase()));
  if (occupied.has(value.router.address.toLowerCase())) {
    add(
      "ROUTE_ACCEPTANCE_ROUTER_ADDRESS_COLLISION",
      "$.router.address",
      "Router address collides with the factory, PoolManager, or one of the reviewed child addresses.",
      "Bind the distinct immutable production Router V2 deployment."
    );
  }
  if (value.routeBinding.routePayloadHash === value.routeBinding.expectedResultHash) {
    add(
      "ROUTE_ACCEPTANCE_ROUTE_HASH_COLLISION",
      "$.routeBinding",
      "routePayloadHash and expectedResultHash must bind distinct preimages.",
      "Use both independently derived hashes from the final frozen Router V2 compiler artifact."
    );
  }
  const predeployment = value.reviewedPlan.launchPlan.priorReleaseFactoryPredeployment;
  if (
    predeployment.status !== "completed-and-verified"
    || !isSha256(predeployment.predeploymentEvidenceSha256)
    || !isSha256(predeployment.gasCapReceiptSha256)
    || value.routeCapability.predeploymentEvidenceSha256 !== predeployment.predeploymentEvidenceSha256
    || value.routeCapability.gasCapReceiptSha256 !== predeployment.gasCapReceiptSha256
  ) {
    add(
      "ROUTE_ACCEPTANCE_PREDEPLOYMENT_EVIDENCE_PENDING",
      "$.reviewedPlan.launchPlan.priorReleaseFactoryPredeployment",
      "Applicant acceptance is unavailable until the platform has predeployed and verified the exact factory and renderer and published the gas-cap receipt.",
      "Rebind the frozen claim only after exact proxy, salt, initcode, factory and renderer evidence is complete; the applicant transaction remains launch-and-stamp only."
    );
  }
  if (containsExamplePlaceholder(value)) {
    add(
      "ROUTE_ACCEPTANCE_EXAMPLE_PLACEHOLDER",
      "$",
      "Acceptance still contains one or more test-only values from the example.",
      "Replace every Router source, address, runtime, payload, and result placeholder with frozen production values."
    );
  }
  return findings;
}

function isSha256(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

export function canonicalApplicantRouteAcceptanceBytes(value) {
  return canonicalJsonBytesV2(value, { trailingNewline: false });
}

export function canonicalApplicantRouteAcceptanceJsonUtf8(value) {
  return canonicalApplicantRouteAcceptanceBytes(value).toString("utf8");
}

export function applicantRouteAcceptanceClaimHash(value) {
  return sha256(canonicalApplicantRouteAcceptanceBytes(value));
}

export function applicationAcceptanceSubjectV1(value) {
  return deepFreeze({
    schemaVersion: APPLICATION_ACCEPTANCE_SUBJECT_V1_TYPE,
    applicantGithubUserId: value.applicant.githubUserId,
    reviewedRequest: {
      path: value.reviewedRequest.path,
      applicationManifestSha256: value.reviewedRequest.applicationManifestSha256
    }
  });
}

export function canonicalApplicationAcceptanceSubjectV1Bytes(subject) {
  assertApplicationAcceptanceSubjectV1(subject);
  return canonicalJsonBytesV2(subject, { trailingNewline: false });
}

export function applicationAcceptanceSubjectHash(subject) {
  return sha256(canonicalApplicationAcceptanceSubjectV1Bytes(subject));
}

export function applicantRouteAcceptanceTransition(value) {
  return deepFreeze({
    schemaVersion: APPLICANT_ROUTE_ACCEPTANCE_TRANSITION_TYPE,
    fromRoute: structuredClone(value.originalRoute),
    toRoute: structuredClone(value.acceptedRoute),
    routeCapability: structuredClone(value.routeCapability),
    router: structuredClone(value.router),
    routeBinding: structuredClone(value.routeBinding),
    reviewedPlanSha256: EXACT_SHARDS_REVIEWED_PLAN_SHA256,
    authorizationGranted: false
  });
}

export function createApplicantRouteAcceptanceCommand(value, { expectedStateVersion, schema }) {
  requireStateVersion(expectedStateVersion);
  requireReadyAcceptance(value, schema);
  return deepFreeze({
    schemaVersion: APPLICANT_ROUTE_ACCEPTANCE_COMMAND_TYPE,
    action: "accept-reviewed-route",
    expectedState: APPLICANT_ROUTE_ACCEPTANCE_PENDING_STATE,
    expectedStateVersion,
    claimSha256: applicantRouteAcceptanceClaimHash(value)
  });
}

export function createApplicantRouteAcceptanceRecordCore(
  value,
  { authenticatedGithubUserId, expectedStateVersion, acceptedAt, schema }
) {
  requireStateVersion(expectedStateVersion);
  requireAcceptedAt(acceptedAt);
  requireReadyAcceptance(value, schema);
  assertApplicantRouteAcceptanceSession(value, authenticatedGithubUserId);
  const applicationAcceptanceSubject = applicationAcceptanceSubjectV1(value);
  return deepFreeze({
    schemaVersion: APPLICANT_ROUTE_ACCEPTANCE_RECORD_CORE_TYPE,
    recordRevision: expectedStateVersion + 1,
    acceptedAt,
    previousState: APPLICANT_ROUTE_ACCEPTANCE_PENDING_STATE,
    previousStateVersion: expectedStateVersion,
    state: APPLICANT_ROUTE_ACCEPTANCE_ACCEPTED_STATE,
    stateVersion: expectedStateVersion + 1,
    authenticatedGithubUserId,
    expectedLaunchWallet: value.applicant.launchWallet,
    claimSha256: applicantRouteAcceptanceClaimHash(value),
    canonicalClaimEncoding: APPLICANT_ROUTE_ACCEPTANCE_CANONICAL_CLAIM_ENCODING,
    applicationAcceptanceSubject,
    acceptanceSubjectHash: applicationAcceptanceSubjectHash(applicationAcceptanceSubject),
    transition: applicantRouteAcceptanceTransition(value)
  });
}

export function canonicalApplicantRouteAcceptanceRecordCoreBytes(recordCore) {
  assertApplicantRouteAcceptanceRecordCore(recordCore);
  return canonicalJsonBytesV2(recordCore, { trailingNewline: false });
}

export function applicantAcceptanceRecordHash(recordCore) {
  return sha256(canonicalApplicantRouteAcceptanceRecordCoreBytes(recordCore));
}

export function assertApplicantRouteAcceptanceSession(value, authenticatedGithubUserId) {
  if (
    !Number.isSafeInteger(authenticatedGithubUserId)
    || authenticatedGithubUserId < 1
    || authenticatedGithubUserId !== value?.applicant?.githubUserId
  ) {
    throw new TypeError("authenticated GitHub numeric user ID does not match the acceptance subject");
  }
  return authenticatedGithubUserId;
}

function containsExamplePlaceholder(value) {
  return value.router.address === "0x1111111111111111111111111111111111111111"
    || value.router.source.repositoryId === 1
    || value.router.source.commit === "1".repeat(40)
    || value.router.source.tree === "2".repeat(40)
    || value.router.runtimeCodeHash === `0x${"9".repeat(64)}`
    || value.routeBinding.routePayloadHash === `0x${"a".repeat(64)}`
    || value.routeBinding.expectedResultHash === `0x${"b".repeat(64)}`;
}

function requireStateVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("expected acceptance state version must be a nonnegative safe integer");
  }
}

function requireReadyAcceptance(value, schema) {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError("applicant route acceptance schema is required");
  }
  const findings = validateApplicantRouteAcceptance(value, schema);
  if (findings.length > 0) {
    throw new TypeError(
      `applicant route acceptance is not ready: ${findings.map(({ code }) => code).join(",")}`
    );
  }
}

function requireAcceptedAt(value) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) throw new TypeError("acceptedAt must be an exact UTC RFC 3339 timestamp with milliseconds");
}

function assertApplicationAcceptanceSubjectV1(subject) {
  if (
    subject === null
    || typeof subject !== "object"
    || Array.isArray(subject)
    || subject.schemaVersion !== APPLICATION_ACCEPTANCE_SUBJECT_V1_TYPE
    || !Number.isSafeInteger(subject.applicantGithubUserId)
    || subject.applicantGithubUserId < 1
    || subject.reviewedRequest === null
    || typeof subject.reviewedRequest !== "object"
    || Array.isArray(subject.reviewedRequest)
    || !isNormalizedRepositoryPath(subject.reviewedRequest.path)
    || !isSha256(subject.reviewedRequest.applicationManifestSha256)
    || !hasExactKeys(subject, ["schemaVersion", "applicantGithubUserId", "reviewedRequest"])
    || !hasExactKeys(subject.reviewedRequest, ["path", "applicationManifestSha256"])
  ) {
    throw new TypeError("application acceptance subject must match applicationAcceptanceSubjectV1");
  }
}

function assertApplicantRouteAcceptanceRecordCore(recordCore) {
  if (
    recordCore === null
    || typeof recordCore !== "object"
    || Array.isArray(recordCore)
    || recordCore.schemaVersion !== APPLICANT_ROUTE_ACCEPTANCE_RECORD_CORE_TYPE
    || recordCore.transition === null
    || typeof recordCore.transition !== "object"
    || Array.isArray(recordCore.transition)
    || !hasExactKeys(recordCore, [
      "schemaVersion",
      "recordRevision",
      "acceptedAt",
      "previousState",
      "previousStateVersion",
      "state",
      "stateVersion",
      "authenticatedGithubUserId",
      "expectedLaunchWallet",
      "claimSha256",
      "canonicalClaimEncoding",
      "applicationAcceptanceSubject",
      "acceptanceSubjectHash",
      "transition"
    ])
    || !hasExactKeys(recordCore.transition, [
      "schemaVersion",
      "fromRoute",
      "toRoute",
      "routeCapability",
      "router",
      "routeBinding",
      "reviewedPlanSha256",
      "authorizationGranted"
    ])
  ) {
    throw new TypeError("applicant route acceptance record core has an unsupported shape");
  }
  requireAcceptedAt(recordCore.acceptedAt);
  requireStateVersion(recordCore.previousStateVersion);
  requireStateVersion(recordCore.stateVersion);
  assertApplicationAcceptanceSubjectV1(recordCore.applicationAcceptanceSubject);
  if (
    !Number.isSafeInteger(recordCore.recordRevision)
    || recordCore.recordRevision !== recordCore.stateVersion
    || recordCore.stateVersion !== recordCore.previousStateVersion + 1
    || recordCore.previousState !== APPLICANT_ROUTE_ACCEPTANCE_PENDING_STATE
    || recordCore.state !== APPLICANT_ROUTE_ACCEPTANCE_ACCEPTED_STATE
    || recordCore.authenticatedGithubUserId
      !== recordCore.applicationAcceptanceSubject.applicantGithubUserId
    || !isSha256(recordCore.claimSha256)
    || recordCore.canonicalClaimEncoding !== APPLICANT_ROUTE_ACCEPTANCE_CANONICAL_CLAIM_ENCODING
    || recordCore.acceptanceSubjectHash
      !== applicationAcceptanceSubjectHash(recordCore.applicationAcceptanceSubject)
    || recordCore.transition?.schemaVersion !== APPLICANT_ROUTE_ACCEPTANCE_TRANSITION_TYPE
    || !isSha256(recordCore.transition?.reviewedPlanSha256)
    || recordCore.transition?.authorizationGranted !== false
  ) {
    throw new TypeError("applicant route acceptance record core is internally inconsistent");
  }
  if (
    checksumAddress(recordCore.expectedLaunchWallet, { label: "expectedLaunchWallet" })
      !== recordCore.expectedLaunchWallet
  ) {
    throw new TypeError("applicant route acceptance record core launch wallet is not EIP-55 canonical");
  }
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function sameJson(left, right) {
  try {
    return canonicalJsonBytesV2(left, { trailingNewline: false })
      .equals(canonicalJsonBytesV2(right, { trailingNewline: false }));
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
