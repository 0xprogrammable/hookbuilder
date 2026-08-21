import {
  parseApplicationContractFromSnapshot,
  selectApplicationAdapter
} from "./application-v3-contract-adapter.mjs";
import { resolveCurrentSubmitLaunchContract } from "./submit-launch-policy-github.mjs";

const ROUTE_TO_REQUEST = Object.freeze({
  "no-market": "none",
  external: "other",
  unresolved: null,
  "official-programmable-ethereum": "programmable-ethereum-mainnet"
});

/**
 * Resolve exactly one protected Submit Launch snapshot, then select its local
 * data-only Application adapter. No second ref/commit read occurs here.
 */
export async function resolveProtectedApplicantCompatibility(options = {}) {
  const normalized = normalizeOptions(options);
  const snapshot = await resolveCurrentSubmitLaunchContract({
    stage: normalized.stage,
    routeState: normalized.routeState,
    ...(normalized.authenticatedTransport === undefined
      ? {}
      : { authenticatedTransport: normalized.authenticatedTransport }),
    ...(normalized.publicTransport === undefined
      ? {}
      : { publicTransport: normalized.publicTransport }),
    ...(normalized.cacheDirectory === undefined
      ? {}
      : { cacheDirectory: normalized.cacheDirectory }),
    includeFullSnapshot: normalized.includeFullSnapshot
  });
  return bindProtectedApplicantCompatibilitySnapshot({
    snapshot,
    priorVersion: normalized.priorVersion
  });
}

/** Pure binder used after the one authoritative resolver call. */
export function bindProtectedApplicantCompatibilitySnapshot({
  snapshot,
  priorVersion = null
} = {}) {
  const applicationContract = parseApplicationContractFromSnapshot(snapshot);
  const requestedRoute = ROUTE_TO_REQUEST[snapshot.projectStage?.routeState];
  if (requestedRoute === undefined) {
    throw applicantCompatibilityFailure("APPLICATION_ROUTE_UNSUPPORTED");
  }
  const selection = selectApplicationAdapter({
    applicationContract,
    requestedRoute,
    priorVersion
  });
  return Object.freeze({
    ok: true,
    binding: deepFreeze({
      mode: "COMPATIBILITY_V2",
      repository: applicationContract.snapshot.repository,
      repositoryId: applicationContract.snapshot.numericRepositoryId,
      defaultBranch: applicationContract.snapshot.branch,
      centralBaseCommit: applicationContract.snapshot.baseCommit,
      centralBaseTree: applicationContract.snapshot.baseTree,
      snapshotSha256: applicationContract.snapshot.snapshotSha256,
      contractPath: applicationContract.snapshot.compatibilityPath,
      contractSha256: applicationContract.snapshot.compatibilitySha256,
      applicationContractId: selection.application.contractId,
      applicationContractVersion: selection.application.version,
      applicationSchemaPath: selection.application.schemaPath,
      applicationSchemaSha256: selection.application.schemaSha256,
      legacy: applicationContract.legacy,
      supportingContracts: applicationContract.supportingContracts,
      minimumBuilderProtocolVersion: applicationContract.minimumBuilderProtocolVersion,
      selectedAdapter: selection,
      projectStage: snapshot.projectStage,
      currentness: snapshot.currentness,
      validatorClosureImported: false,
      authority: applicationContract.authority
    })
  });
}

export async function preflightProtectedApplicantCompatibility(options = {}) {
  try {
    return await resolveProtectedApplicantCompatibility(options);
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: error?.code ?? "APPLICANT_COMPATIBILITY_PENDING",
      summary: error?.code === "BUILDER_PROTOCOL_TOO_OLD"
        ? "The installed Builder is older than the protected Applicant protocol."
        : "The current protected Submit Launch contract could not be bound to one stable exact snapshot.",
      repair: "Update the Builder or retry the same exact project after the protected contract snapshot is available. No Draft write was attempted."
    });
  }
}

function normalizeOptions(value) {
  const allowed = new Set([
    "authenticatedTransport",
    "cacheDirectory",
    "includeFullSnapshot",
    "priorVersion",
    "publicTransport",
    "repositoryRoot",
    "routeState",
    "source",
    "stage",
    "timeoutMs",
    "transport"
  ]);
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || (value.authenticatedTransport !== undefined
      && (value.authenticatedTransport === null || typeof value.authenticatedTransport !== "object"))
    || (value.publicTransport !== undefined && typeof value.publicTransport !== "function")
    || (value.transport !== undefined && typeof value.transport !== "function")
    || (value.publicTransport !== undefined && value.transport !== undefined)
    || (value.includeFullSnapshot !== undefined && typeof value.includeFullSnapshot !== "boolean")
    || (value.priorVersion !== undefined
      && value.priorVersion !== null
      && !new Set(["3.1.0", "3.2.0"]).has(value.priorVersion))
    || !new Set(["build", "submit", "launch-readiness", "production-promotion"])
      .has(value.stage ?? "submit")
    || !Object.hasOwn(ROUTE_TO_REQUEST, value.routeState ?? "unresolved")
  ) throw new TypeError("Applicant compatibility GitHub options are outside the supported bounds");
  return Object.freeze({
    authenticatedTransport: value.authenticatedTransport,
    cacheDirectory: value.cacheDirectory,
    includeFullSnapshot: value.includeFullSnapshot === true,
    priorVersion: value.priorVersion ?? null,
    publicTransport: value.publicTransport ?? value.transport,
    routeState: value.routeState ?? "unresolved",
    stage: value.stage ?? "submit"
  });
}

function applicantCompatibilityFailure(code) {
  const error = new Error("The protected Applicant compatibility binding is invalid");
  error.code = code;
  return error;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
