import crypto from "node:crypto";
import path from "node:path";

import {
  canonicalJsonBytesV2
} from "../../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";

export const APPLICANT_FAST_LANE_SCHEMA_VERSION = "1.0.0";
export const APPLICANT_REQUEST_PATH = /^submissions\/requests\/[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/u;
const APPLICANT_REQUESTS_README_PATH = "submissions/requests/README.md";
const CI_REF = /^[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,253}[A-Za-z0-9])?$/u;
const LIGHTWEIGHT_ROOT_PATHS = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "LICENSE",
  "NOTICE.md",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md"
]);
const LIGHTWEIGHT_NESTED_PATHS = new Set([
  ".github/PULL_REQUEST_TEMPLATE.md",
  "submissions/README.md",
  APPLICANT_REQUESTS_README_PATH
]);
const LIGHTWEIGHT_EXTENSION = /\.(?:gif|jpe?g|md|png|svg|txt|webp)$/iu;
const REFERENCE_KERNEL_PATH = /^(?:skills\/programmable-v4-hook-builder|plugins\/programmable-v4-builder\/skills\/programmable-v4-hook-builder)\/assets\/reference-kernels\/programmable-volume-fee-v([12])(?:\/|$)/u;
const SHARED_KERNEL_CONTROL_PATHS = new Set([
  ".github/workflows/ci.yml",
  "scripts/ci/applicant-fast-lane-core.mjs",
  "scripts/ci/plan-applicant-fast-lane.mjs",
  "scripts/generate-release-artifacts.mjs",
  "scripts/prepare-release-candidate.mjs",
  "scripts/release-evidence-core.mjs",
  "scripts/verify-repository.mjs",
  "test/applicant-fast-lane.test.mjs",
  "test/release-evidence.test.mjs",
  "test/repository-contract.test.mjs"
]);
const APPLICANT_SOURCE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
export const PLATFORM_ATTESTATION_KIND = "programmable-platform-profile-release-attestation";
export const PLATFORM_ATTESTATION_SCHEMA_VERSION = "1.0.0";
export const PLATFORM_RELEASE_REPOSITORY = "0xprogrammable/programmable";
export const REQUIRED_PLATFORM_GATE_IDS = Object.freeze([
  "authority-compiler",
  "mainnet-currentness",
  "profile-security",
  "router-contract",
  "stage",
  "website-build"
]);

const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const CANONICAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CANONICAL_SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAXIMUM_ATTESTATION_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const MAXIMUM_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_CAPABILITIES = new Set(["direct-graph", "exact-shards-nested-factory"]);

export class ApplicantFastLaneError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ApplicantFastLaneError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function classifyChangedPaths(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return freezePlan("platform", "no-changed-paths", [], []);
  }
  const normalized = entries.map(normalizeDiffEntry);
  const paths = normalized.map(({ path: repositoryPath }) => repositoryPath);
  const invalidApplicantChange = normalized.some(({ status, path: repositoryPath }) => (
    repositoryPath.startsWith("submissions/requests/")
    && !(status === "M" && repositoryPath === APPLICANT_REQUESTS_README_PATH)
    && ((status !== "A" && status !== "M") || !APPLICANT_REQUEST_PATH.test(repositoryPath))
  ));
  const requestPaths = normalized
    .filter(({ status, path: repositoryPath }) => (
      (status === "A" || status === "M") && APPLICANT_REQUEST_PATH.test(repositoryPath)
    ))
    .map(({ path: repositoryPath }) => repositoryPath);
  const applicantOnly = requestPaths.length > 0 && requestPaths.length === normalized.length;
  const mixed = requestPaths.length > 0 && requestPaths.length < normalized.length;
  if (invalidApplicantChange) {
    return freezePlan("invalid", "applicant-request-delete-rename-or-unsupported-status", paths, requestPaths);
  }
  return freezePlan(
    applicantOnly ? "applicant" : mixed ? "mixed" : "platform",
    applicantOnly ? "applicant-request-only" : mixed ? "applicant-and-platform-change" : "platform-profile-or-code-change",
    paths,
    requestPaths
  );
}

export function classifyPlatformChecks({ event, ref, mode, paths }) {
  if (!new Set(["pull_request", "push", "workflow_dispatch"]).has(event)) {
    throw new ApplicantFastLaneError("CI_ROUTING_INPUT_INVALID", "CI routing event is invalid");
  }
  if (
    typeof ref !== "string"
    || !CI_REF.test(ref)
    || ref.startsWith("/")
    || ref.endsWith("/")
    || ref.includes("//")
    || ref.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new ApplicantFastLaneError("CI_ROUTING_INPUT_INVALID", "CI routing ref is invalid");
  }
  if (!new Set(["applicant", "invalid", "mixed", "platform"]).has(mode)) {
    throw new ApplicantFastLaneError("CI_ROUTING_INPUT_INVALID", "CI routing mode is invalid");
  }
  if (!Array.isArray(paths)) {
    throw new ApplicantFastLaneError("CI_ROUTING_INPUT_INVALID", "CI routing paths are invalid");
  }

  const canonicalPaths = paths.map((repositoryPath) => normalizeRepositoryPath(
    repositoryPath,
    "CI_ROUTING_INPUT_INVALID",
    "CI routing path"
  ));
  const platformPaths = [...new Set(canonicalPaths)]
    .filter((repositoryPath) => !APPLICANT_REQUEST_PATH.test(repositoryPath))
    .sort(compareUtf8);
  const protectedBranchRun = event !== "pull_request";
  const releaseCompatibility = ref.startsWith("release/");
  const nonLightweightPaths = platformPaths.filter((repositoryPath) => !isLightweightPlatformPath(repositoryPath));
  const fullNodeCompatibility = protectedBranchRun || releaseCompatibility || nonLightweightPaths.length > 0;
  const referenceKernels = new Set();

  if (protectedBranchRun || releaseCompatibility || platformPaths.some((repositoryPath) => SHARED_KERNEL_CONTROL_PATHS.has(repositoryPath))) {
    referenceKernels.add("v1");
    referenceKernels.add("v2");
  } else {
    for (const repositoryPath of platformPaths) {
      const match = REFERENCE_KERNEL_PATH.exec(repositoryPath);
      if (match) referenceKernels.add(`v${match[1]}`);
    }
  }

  const domains = [];
  if (platformPaths.length === 0) domains.push("none");
  if (platformPaths.some(isLightweightPlatformPath)) domains.push("documentation-or-metadata");
  if (nonLightweightPaths.length > 0) domains.push("executable-or-structured");
  if (referenceKernels.has("v1")) domains.push("reference-kernel-v1");
  if (referenceKernels.has("v2")) domains.push("reference-kernel-v2");
  if (protectedBranchRun) domains.push("protected-branch");
  if (releaseCompatibility) domains.push("release-compatibility");

  const routing = {
    schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
    event,
    ref,
    mode,
    platformPaths,
    domains,
    repositoryNodes: fullNodeCompatibility ? [22, 24] : [24],
    referenceKernels: [...referenceKernels].sort(compareUtf8),
    codeqlRequired: protectedBranchRun || releaseCompatibility || nonLightweightPaths.length > 0,
    fullNodeCompatibility,
    platformLaneRequired: protectedBranchRun || releaseCompatibility || mode === "platform" || mode === "mixed"
  };
  return deepFreeze({
    ...routing,
    routingPlanSha256: sha256(canonicalJsonBytesV2(routing, { trailingNewline: false }))
  });
}

function isLightweightPlatformPath(repositoryPath) {
  if (LIGHTWEIGHT_ROOT_PATHS.has(repositoryPath)) return true;
  if (LIGHTWEIGHT_NESTED_PATHS.has(repositoryPath)) return true;
  if (/^\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\//u.test(repositoryPath)) {
    return /\.(?:md|ya?ml)$/iu.test(repositoryPath);
  }
  return /^(?:assets|docs)\//u.test(repositoryPath) && LIGHTWEIGHT_EXTENSION.test(repositoryPath);
}

export function parseRequestPathsJson(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ApplicantFastLaneError("FAST_LANE_INPUT_INVALID", "request path input must be valid JSON");
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new ApplicantFastLaneError("FAST_LANE_INPUT_INVALID", "request path input must contain 1 to 32 paths");
  }
  const unique = new Set();
  for (const repositoryPath of value) {
    if (typeof repositoryPath !== "string" || !APPLICANT_REQUEST_PATH.test(repositoryPath)) {
      throw new ApplicantFastLaneError("FAST_LANE_INPUT_INVALID", "request path input contains a non-canonical applicant path");
    }
    if (unique.has(repositoryPath)) {
      throw new ApplicantFastLaneError("FAST_LANE_INPUT_INVALID", "request path input contains a duplicate path");
    }
    unique.add(repositoryPath);
  }
  return [...unique].sort(compareUtf8);
}

export function normalizeRouteCapabilityReport(report) {
  requirePlainObject(report, "route capability report");
  requireExactKeys(report, ["schemaVersion", "status", "requests"], "route capability report");
  if (report.schemaVersion !== APPLICANT_FAST_LANE_SCHEMA_VERSION || report.status !== "ROUTE_SUPPORTED") {
    throw new ApplicantFastLaneError("ROUTE_CAPABILITY_MISMATCH", "route capability report is not supported");
  }
  if (!Array.isArray(report.requests) || report.requests.length === 0 || report.requests.length > 32) {
    throw new ApplicantFastLaneError("ROUTE_CAPABILITY_MISMATCH", "route capability report requests are invalid");
  }
  const paths = new Set();
  const requests = report.requests.map((request, index) => {
    const context = `route capability report request ${index}`;
    requirePlainObject(request, context);
    requireExactKeys(request, [
      "path", "status", "supported", "requestedRoute", "requiredRoute", "bindingSha256", "revenuePolicyHash",
      "reviewBindingSha256", "revenuePolicySemantics", "source", "applicationManifestSha256",
      "sourceManifestPath", "sourceManifestBytes", "sourceManifestSha256", "codeHashesSha256", "routeCapability",
      "acceptanceRequired"
    ], context);
    if (!APPLICANT_REQUEST_PATH.test(request.path ?? "") || paths.has(request.path)) {
      throw new ApplicantFastLaneError("ROUTE_CAPABILITY_MISMATCH", `${context} path is invalid or duplicated`);
    }
    paths.add(request.path);
    if (
      request.status !== "ROUTE_SUPPORTED"
      || !ALLOWED_CAPABILITIES.has(request.supported)
      || request.acceptanceRequired !== false
      || !SHA256.test(request.bindingSha256 ?? "")
      || !SHA256.test(request.reviewBindingSha256 ?? "")
      || typeof request.sourceManifestPath !== "string"
      || !APPLICANT_SOURCE_PATH.test(request.sourceManifestPath ?? "")
      || request.sourceManifestPath.split("/").some((segment) => segment === "." || segment === "..")
      || !Number.isSafeInteger(request.sourceManifestBytes)
      || request.sourceManifestBytes < 1
      || request.sourceManifestBytes > 16 * 1024 * 1024
      || !SHA256.test(request.sourceManifestSha256 ?? "")
      || !SHA256.test(request.codeHashesSha256 ?? "")
      || request.routeCapability === null
      || typeof request.routeCapability !== "object"
      || Array.isArray(request.routeCapability)
      || !BYTES32.test(request.revenuePolicyHash ?? "")
      || (
        request.supported === "exact-shards-nested-factory"
          ? request.revenuePolicySemantics !== "exact-profile-typed-v1"
          : request.revenuePolicySemantics !== "artifact-required/profile-specific"
      )
    ) {
      throw new ApplicantFastLaneError("ROUTE_CAPABILITY_MISMATCH", `${context} is not an accepted exact capability`);
    }
    const requestedRoute = normalizeRoute(request.requestedRoute, `${context} requestedRoute`);
    const requiredRoute = normalizeRoute(request.requiredRoute, `${context} requiredRoute`);
    if (!routesEqual(requestedRoute, requiredRoute)) {
      throw new ApplicantFastLaneError("ROUTE_CAPABILITY_MISMATCH", `${context} has not accepted its required exact route`);
    }
    return Object.freeze({
      path: request.path,
      capability: request.supported,
      ...requiredRoute,
      bindingSha256: request.bindingSha256,
      revenuePolicyHash: request.revenuePolicyHash,
      revenuePolicySemantics: request.revenuePolicySemantics
    });
  }).sort((left, right) => compareUtf8(left.path, right.path));
  return Object.freeze(requests);
}

export function createPlatformAttestationPayload({ release, issuedAt, expiresAt, profiles, gates }) {
  const payload = { release, issuedAt, expiresAt, profiles, gates };
  validatePlatformAttestationPayload(payload, { now: null });
  return deepFreeze(structuredClone(payload));
}

export function createSignedPlatformAttestation(payload, { privateKey, keyId }) {
  validatePlatformAttestationPayload(payload, { now: null });
  if (!KEY_ID.test(keyId ?? "")) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_SIGNING_INVALID", "attestation key ID is invalid");
  }
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_SIGNING_INVALID", "attestation signing key must be Ed25519");
  }
  const payloadBytes = canonicalJsonBytesV2(payload, { trailingNewline: false });
  return deepFreeze({
    schemaVersion: PLATFORM_ATTESTATION_SCHEMA_VERSION,
    kind: PLATFORM_ATTESTATION_KIND,
    payload: structuredClone(payload),
    payloadSha256: sha256(payloadBytes),
    signature: {
      algorithm: "ed25519",
      keyId,
      value: crypto.sign(null, payloadBytes, key).toString("base64")
    }
  });
}

export function verifyPlatformAttestation(attestation, {
  routeCapabilityReport,
  trustedPublicKeys,
  now = new Date(),
  expectedAttestationSha256 = null,
  attestationBytes = null
}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_INPUT_INVALID", "verification time is invalid");
  }
  if (expectedAttestationSha256 !== null) {
    if (!SHA256.test(expectedAttestationSha256) || !Buffer.isBuffer(attestationBytes)) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_INPUT_INVALID", "expected attestation digest input is invalid");
    }
    const observed = sha256(attestationBytes);
    if (observed !== expectedAttestationSha256) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_DIGEST_MISMATCH", "platform attestation bytes do not match the pinned digest", {
        expected: expectedAttestationSha256,
        observed
      });
    }
  }
  requirePlainObject(attestation, "platform attestation");
  requireExactKeys(attestation, ["schemaVersion", "kind", "payload", "payloadSha256", "signature"], "platform attestation");
  if (
    attestation.schemaVersion !== PLATFORM_ATTESTATION_SCHEMA_VERSION
    || attestation.kind !== PLATFORM_ATTESTATION_KIND
  ) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_SCHEMA_UNSUPPORTED", "platform attestation schema or kind is unsupported");
  }
  validatePlatformAttestationPayload(attestation.payload, { now });
  if (!SHA256.test(attestation.payloadSha256 ?? "")) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_PAYLOAD_INVALID", "platform attestation payload digest is invalid");
  }
  requirePlainObject(attestation.signature, "platform attestation signature");
  requireExactKeys(attestation.signature, ["algorithm", "keyId", "value"], "platform attestation signature");
  if (
    attestation.signature.algorithm !== "ed25519"
    || !KEY_ID.test(attestation.signature.keyId ?? "")
    || typeof attestation.signature.value !== "string"
    || attestation.signature.value.length < 80
    || attestation.signature.value.length > 128
  ) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_SIGNATURE_INVALID", "platform attestation signature metadata is invalid");
  }
  const payloadBytes = canonicalJsonBytesV2(attestation.payload, { trailingNewline: false });
  const observedPayloadSha256 = sha256(payloadBytes);
  if (observedPayloadSha256 !== attestation.payloadSha256) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_PAYLOAD_MISMATCH", "platform attestation payload digest does not match its canonical payload");
  }
  const keyMaterial = trustedPublicKeys?.[attestation.signature.keyId];
  if (typeof keyMaterial !== "string" && !Buffer.isBuffer(keyMaterial)) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_KEY_UNTRUSTED", "platform attestation signing key is not trusted");
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(keyMaterial);
  } catch {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_KEY_INVALID", "trusted platform attestation public key is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_KEY_INVALID", "trusted platform attestation public key must be Ed25519");
  }
  let signature;
  try {
    signature = Buffer.from(attestation.signature.value, "base64");
  } catch {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_SIGNATURE_INVALID", "platform attestation signature is not base64");
  }
  if (signature.length !== 64 || !crypto.verify(null, payloadBytes, publicKey, signature)) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_SIGNATURE_INVALID", "platform attestation signature verification failed");
  }

  const expectedProfiles = normalizeRouteCapabilityReport(routeCapabilityReport);
  const availableProfiles = new Map(attestation.payload.profiles.map((profile) => [profileKey(profile), profile]));
  const matchedProfiles = expectedProfiles.map((expected) => {
    const matched = availableProfiles.get(profileKey(expected));
    if (
      !matched
      || matched.bindingSha256 !== expected.bindingSha256
      || matched.revenuePolicySemantics !== expected.revenuePolicySemantics
      || (matched.revenuePolicyHash !== null && matched.revenuePolicyHash !== expected.revenuePolicyHash)
    ) {
      throw new ApplicantFastLaneError(
        "PLATFORM_ATTESTATION_PROFILE_MISMATCH",
        `platform attestation does not bind ${expected.capability} ${expected.routeId}@${expected.routeVersion} on chain ${expected.chainId}`
      );
    }
    return Object.freeze({ ...expected });
  });
  return deepFreeze({
    status: "PLATFORM_PROFILE_ATTESTATION_VERIFIED",
    schemaVersion: PLATFORM_ATTESTATION_SCHEMA_VERSION,
    payloadSha256: attestation.payloadSha256,
    keyId: attestation.signature.keyId,
    release: structuredClone(attestation.payload.release),
    expiresAt: attestation.payload.expiresAt,
    profiles: matchedProfiles,
    gates: attestation.payload.gates.map(({ id, receiptSha256 }) => ({ id, receiptSha256 }))
  });
}

export async function fetchJsonWithRetry(url, {
  token = null,
  attempts = 3,
  baseDelayMs = 250,
  attemptTimeoutMs = 15_000,
  maximumBytes = 2 * 1024 * 1024,
  fetchImpl = globalThis.fetch,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const target = validateHttpsUrl(url);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new ApplicantFastLaneError("PROVIDER_INPUT_INVALID", "provider retry attempts must be between 1 and 5");
  }
  if (!Number.isSafeInteger(attemptTimeoutMs) || attemptTimeoutMs < 1 || attemptTimeoutMs > 30_000) {
    throw new ApplicantFastLaneError("PROVIDER_INPUT_INVALID", "provider attempt timeout must be between 1 and 30000ms");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 24 * 1024 * 1024) {
    throw new ApplicantFastLaneError("PROVIDER_INPUT_INVALID", "provider response limit must be between 1 and 25165824 bytes");
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(target, {
        redirect: "follow",
        signal: AbortSignal.timeout(attemptTimeoutMs),
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "programmable-applicant-fast-lane/1.0",
          "x-github-api-version": "2022-11-28",
          ...(token ? { authorization: `Bearer ${token}` } : {})
        }
      });
      // Undici exposes the final URL, while lightweight test and provider adapters may not.
      // The requested URL was already validated; validate a reported redirect when available.
      if (typeof response.url === "string" && response.url.length > 0) validateHttpsUrl(response.url);
      if (!response.ok) {
        const transient = TRANSIENT_HTTP_STATUS.has(response.status);
        const error = new ApplicantFastLaneError(
          transient ? "PROVIDER_TRANSIENT" : "PROVIDER_REJECTED",
          `provider returned HTTP ${response.status}`,
          { status: response.status, transient }
        );
        if (!transient || attempt === attempts) throw error;
        lastError = error;
        await sleep(retryDelayMs(response.headers.get("retry-after"), baseDelayMs, attempt));
        continue;
      }
      const bytes = await readResponseBodyBounded(response, maximumBytes);
      if (bytes.length === 0) {
        throw new ApplicantFastLaneError("PROVIDER_RESPONSE_INVALID", "provider response size is invalid");
      }
      let value;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new ApplicantFastLaneError("PROVIDER_RESPONSE_INVALID", "provider response is not valid UTF-8 JSON");
      }
      return { value, attemptsUsed: attempt, bytes: bytes.length };
    } catch (error) {
      if (error instanceof ApplicantFastLaneError && error.code !== "PROVIDER_TRANSIENT") throw error;
      lastError = error instanceof ApplicantFastLaneError
        ? error
        : new ApplicantFastLaneError("PROVIDER_TRANSIENT", "provider request failed transiently", { transient: true });
      if (attempt === attempts) break;
      await sleep(retryDelayMs(null, baseDelayMs, attempt));
    }
  }
  throw new ApplicantFastLaneError("PROVIDER_RETRY_EXHAUSTED", "provider request failed after bounded retries", {
    causeCode: lastError?.code ?? "PROVIDER_TRANSIENT"
  });
}

export async function readResponseBodyBounded(response, maximumBytes) {
  if (
    response === null
    || typeof response !== "object"
    || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 1
    || maximumBytes > 24 * 1024 * 1024
  ) {
    throw new ApplicantFastLaneError("PROVIDER_INPUT_INVALID", "bounded response input is invalid");
  }
  const declaredLength = response.headers?.get?.("content-length") ?? null;
  if (
    declaredLength !== null
    && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new ApplicantFastLaneError("PROVIDER_RESPONSE_INVALID", "provider response exceeds the byte limit");
  }
  if (response.body === null || typeof response.body?.getReader !== "function") {
    throw new ApplicantFastLaneError("PROVIDER_RESPONSE_INVALID", "provider response has no bounded byte stream");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        throw new ApplicantFastLaneError("PROVIDER_RESPONSE_INVALID", "provider response stream is invalid");
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response byte limit exceeded");
        throw new ApplicantFastLaneError("PROVIDER_RESPONSE_INVALID", "provider response exceeds the byte limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function verifyApplicantSources(requests, { token = null, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 32) {
    throw new ApplicantFastLaneError("SOURCE_INPUT_INVALID", "source verification needs 1 to 32 applicant requests");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new ApplicantFastLaneError("SOURCE_INPUT_INVALID", "source verification time is invalid");
  }
  const cache = new Map();
  const receipts = [];
  for (const request of requests) {
    requirePlainObject(request, "applicant request");
    const repository = parseGitHubRepository(request.source?.repository);
    const repositoryId = request.source?.repositoryId;
    const commit = request.source?.commit;
    const tree = request.source?.tree;
    if (!Number.isSafeInteger(repositoryId) || repositoryId < 1 || !GIT_OBJECT_ID.test(commit ?? "") || !GIT_OBJECT_ID.test(tree ?? "")) {
      throw new ApplicantFastLaneError("SOURCE_INPUT_INVALID", "applicant source binding is invalid");
    }
    const dedupeKey = `${repository.slug}\0${repositoryId}\0${commit}\0${tree}`;
    let receipt = cache.get(dedupeKey);
    if (!receipt) {
      const repositoryResponse = await fetchJsonWithRetry(
        `https://api.github.com/repos/${repository.slug}`,
        { token, fetchImpl }
      );
      const repositoryValue = repositoryResponse.value;
      if (
        repositoryValue?.id !== repositoryId
        || String(repositoryValue?.full_name ?? "").toLowerCase() !== repository.slug.toLowerCase()
        || repositoryValue?.private !== false
      ) {
        throw new ApplicantFastLaneError("SOURCE_REPOSITORY_MISMATCH", "public source repository identity does not match the request");
      }
      const commitResponse = await fetchJsonWithRetry(
        `https://api.github.com/repos/${repository.slug}/git/commits/${commit}`,
        { token, fetchImpl }
      );
      if (commitResponse.value?.sha !== commit || commitResponse.value?.tree?.sha !== tree) {
        throw new ApplicantFastLaneError("SOURCE_REVISION_MISMATCH", "public source commit or tree does not match the request");
      }
      receipt = deepFreeze({
        repository: `https://github.com/${repositoryValue.full_name}`,
        repositoryId,
        commit,
        tree,
        observedAt: now.toISOString(),
        provider: "api.github.com",
        providerAttempts: repositoryResponse.attemptsUsed + commitResponse.attemptsUsed,
        sourceBindingSha256: sha256(canonicalJsonBytesV2({ repositoryId, commit, tree }, { trailingNewline: false }))
      });
      cache.set(dedupeKey, receipt);
    }
    receipts.push({ ...receipt });
  }
  return deepFreeze({
    status: "APPLICANT_SOURCES_VERIFIED",
    schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
    networkAccessed: true,
    provider: "api.github.com",
    uniqueSources: cache.size,
    requests: requests.length,
    receipts
  });
}

function freezePlan(mode, reason, paths, requestPaths) {
  const normalizedPaths = [...new Set(paths)].sort(compareUtf8);
  const normalizedRequests = [...new Set(requestPaths)].sort(compareUtf8);
  const digestInput = { mode, reason, paths: normalizedPaths, requestPaths: normalizedRequests };
  return deepFreeze({
    schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
    mode,
    reason,
    paths: normalizedPaths,
    requestPaths: normalizedRequests,
    changePlanSha256: sha256(canonicalJsonBytesV2(digestInput, { trailingNewline: false }))
  });
}

function normalizeDiffEntry(entry) {
  requirePlainObject(entry, "changed path entry");
  requireExactKeys(entry, ["status", "path"], "changed path entry");
  if (!/^[AMDTU]$/u.test(entry.status ?? "")) {
    throw new ApplicantFastLaneError("FAST_LANE_DIFF_INVALID", "changed path status is unsupported");
  }
  const normalized = normalizeRepositoryPath(entry.path, "FAST_LANE_DIFF_INVALID", "changed path");
  return Object.freeze({ status: entry.status, path: normalized });
}

function normalizeRepositoryPath(repositoryPath, code, label) {
  if (typeof repositoryPath !== "string" || repositoryPath.length === 0 || repositoryPath.includes("\\")) {
    throw new ApplicantFastLaneError(code, `${label} is invalid`);
  }
  const normalized = path.posix.normalize(repositoryPath);
  if (
    normalized !== repositoryPath
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || path.posix.isAbsolute(normalized)
  ) {
    throw new ApplicantFastLaneError(code, `${label} is not canonical repository-relative form`);
  }
  return normalized;
}

function validatePlatformAttestationPayload(payload, { now }) {
  requirePlainObject(payload, "platform attestation payload");
  requireExactKeys(payload, ["release", "issuedAt", "expiresAt", "profiles", "gates"], "platform attestation payload");
  requirePlainObject(payload.release, "platform attestation release");
  requireExactKeys(payload.release, ["repository", "commit", "tree", "manifestSha256"], "platform attestation release");
  if (
    payload.release.repository !== PLATFORM_RELEASE_REPOSITORY
    || !GIT_OBJECT_ID.test(payload.release.commit ?? "")
    || !GIT_OBJECT_ID.test(payload.release.tree ?? "")
    || !SHA256.test(payload.release.manifestSha256 ?? "")
  ) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_RELEASE_INVALID", "platform attestation release binding is invalid");
  }
  const issuedAt = parseCanonicalInstant(payload.issuedAt, "platform attestation issuedAt");
  const expiresAt = parseCanonicalInstant(payload.expiresAt, "platform attestation expiresAt");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAXIMUM_ATTESTATION_LIFETIME_MS) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_TIME_INVALID", "platform attestation lifetime is invalid");
  }
  if (now !== null) {
    const observed = now.getTime();
    if (issuedAt > observed + MAXIMUM_CLOCK_SKEW_MS) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_NOT_YET_VALID", "platform attestation was issued in the future");
    }
    if (expiresAt <= observed) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_EXPIRED", "platform attestation has expired");
    }
  }
  if (!Array.isArray(payload.profiles) || payload.profiles.length === 0 || payload.profiles.length > 16) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_PROFILES_INVALID", "platform attestation profiles are invalid");
  }
  const profileKeys = new Set();
  let priorProfileKey = null;
  for (const profile of payload.profiles) {
    requirePlainObject(profile, "platform attestation profile");
    requireExactKeys(
      profile,
      [
        "capability", "routeId", "routeVersion", "chainId", "bindingSha256", "revenuePolicyHash",
        "revenuePolicySemantics"
      ],
      "platform attestation profile"
    );
    normalizeProfile(profile, "platform attestation profile");
    const key = profileKey(profile);
    if (profileKeys.has(key) || (priorProfileKey !== null && compareUtf8(priorProfileKey, key) >= 0)) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_PROFILES_INVALID", "platform attestation profiles must be unique and UTF-8 sorted");
    }
    profileKeys.add(key);
    priorProfileKey = key;
  }
  if (!Array.isArray(payload.gates) || payload.gates.length < REQUIRED_PLATFORM_GATE_IDS.length || payload.gates.length > 32) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_GATES_INVALID", "platform attestation gate receipts are invalid");
  }
  const gateIds = new Set();
  let priorGateId = null;
  for (const gate of payload.gates) {
    requirePlainObject(gate, "platform attestation gate");
    requireExactKeys(gate, ["id", "releaseManifestSha256", "receiptSha256", "completedAt"], "platform attestation gate");
    if (
      !CANONICAL_ID.test(gate.id ?? "")
      || gate.releaseManifestSha256 !== payload.release.manifestSha256
      || !SHA256.test(gate.receiptSha256 ?? "")
    ) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_GATES_INVALID", "platform attestation gate binding is invalid");
    }
    const completedAt = parseCanonicalInstant(gate.completedAt, "platform attestation gate completedAt");
    if (completedAt > issuedAt) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_GATES_INVALID", "platform attestation gate completed after issuance");
    }
    if (gateIds.has(gate.id) || (priorGateId !== null && compareUtf8(priorGateId, gate.id) >= 0)) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_GATES_INVALID", "platform attestation gates must be unique and UTF-8 sorted");
    }
    gateIds.add(gate.id);
    priorGateId = gate.id;
  }
  for (const required of REQUIRED_PLATFORM_GATE_IDS) {
    if (!gateIds.has(required)) {
      throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_GATE_MISSING", `platform attestation is missing required gate ${required}`);
    }
  }
}

function normalizeProfile(profile, label) {
  const revenueBindingValid = profile.capability === "exact-shards-nested-factory"
    ? BYTES32.test(profile.revenuePolicyHash ?? "") && profile.revenuePolicySemantics === "exact-profile-typed-v1"
    : profile.revenuePolicyHash === null && profile.revenuePolicySemantics === "artifact-required/profile-specific";
  if (
    !ALLOWED_CAPABILITIES.has(profile.capability)
    || !CANONICAL_ID.test(profile.routeId ?? "")
    || !CANONICAL_SEMVER.test(profile.routeVersion ?? "")
    || !/^[1-9][0-9]*$/u.test(profile.chainId ?? "")
    || !SHA256.test(profile.bindingSha256 ?? "")
    || !revenueBindingValid
  ) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_PROFILES_INVALID", `${label} is invalid`);
  }
  return profile;
}

function normalizeRoute(route, label) {
  requirePlainObject(route, label);
  requireExactKeys(route, ["routeId", "routeVersion", "chainId"], label);
  if (
    !CANONICAL_ID.test(route.routeId ?? "")
    || !CANONICAL_SEMVER.test(route.routeVersion ?? "")
    || !/^[1-9][0-9]*$/u.test(route.chainId ?? "")
  ) {
    throw new ApplicantFastLaneError("ROUTE_CAPABILITY_MISMATCH", `${label} is invalid`);
  }
  return Object.freeze({ routeId: route.routeId, routeVersion: route.routeVersion, chainId: route.chainId });
}

function routesEqual(left, right) {
  return left.routeId === right.routeId && left.routeVersion === right.routeVersion && left.chainId === right.chainId;
}

function profileKey(profile) {
  return `${profile.capability}\0${profile.routeId}\0${profile.routeVersion}\0${profile.chainId}`;
}

function parseGitHubRepository(repository) {
  if (typeof repository !== "string") {
    throw new ApplicantFastLaneError("SOURCE_INPUT_INVALID", "source repository URL is invalid");
  }
  const match = repository.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/u);
  if (!match || match[2].endsWith(".git")) {
    throw new ApplicantFastLaneError("SOURCE_INPUT_INVALID", "source repository must be an exact public GitHub URL");
  }
  return Object.freeze({ owner: match[1], name: match[2], slug: `${match[1]}/${match[2]}` });
}

function validateHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApplicantFastLaneError("PROVIDER_INPUT_INVALID", "provider URL is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new ApplicantFastLaneError("PROVIDER_INPUT_INVALID", "provider URL must be credential-free HTTPS");
  }
  return parsed;
}

function retryDelayMs(retryAfter, baseDelayMs, attempt) {
  const seconds = retryAfter !== null && /^[0-9]+$/u.test(retryAfter) ? Number(retryAfter) : null;
  if (seconds !== null && Number.isSafeInteger(seconds)) return Math.min(seconds * 1000, 5000);
  return Math.min(baseDelayMs * (2 ** (attempt - 1)), 5000);
}

function parseCanonicalInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_TIME_INVALID", `${label} must be canonical UTC milliseconds`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new ApplicantFastLaneError("PLATFORM_ATTESTATION_TIME_INVALID", `${label} is invalid`);
  }
  return timestamp;
}

function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ApplicantFastLaneError("FAST_LANE_OBJECT_INVALID", `${label} must be a plain object`);
  }
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const canonicalExpected = [...expected].sort(compareUtf8);
  if (actual.length !== canonicalExpected.length || actual.some((key, index) => key !== canonicalExpected[index])) {
    throw new ApplicantFastLaneError("FAST_LANE_OBJECT_INVALID", `${label} keys are invalid`);
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
