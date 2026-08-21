import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePublicPrApplicationV3 } from "./public-pr-application-v3-core.mjs";
import { canonicalJson } from "./submission-core.mjs";
import {
  assertSubmitLaunchSnapshotBindingIntegrity,
  SUBMIT_LAUNCH_STAGE_PLAN_SCHEMA_VERSION
} from "./submit-launch-contract-core.mjs";

const BUILDER_PROTOCOL_VERSION = "1.0.0";
const SNAPSHOT_VERSION = "programmable.submit-launch-contract-snapshot.v1";
const ADAPTER_VERSION = "programmable.application-contract-adapter.v1";
const SELECTION_VERSION = "programmable.application-contract-selection.v1";
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const REQUESTED_ROUTES = new Set([null, "none", "other", "programmable-ethereum-mainnet"]);
const STAGE_ROUTE_TO_REQUEST = Object.freeze({
  "no-market": "none",
  external: "other",
  unresolved: null,
  "official-programmable-ethereum": "programmable-ethereum-mainnet"
});
const trustedApplicationContracts = new WeakSet();
const trustedApplicationSelections = new WeakSet();

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const referencesDirectory = path.resolve(moduleDirectory, "../references");

const localContracts = Object.freeze({
  compatibilitySchema: localSchema({
    contractId: "programmable-applicant-compatibility-v2",
    localFile: "applicant-compatibility-v2.schema.json",
    remotePath: "intake/schemas/applicant-compatibility-v2.schema.json"
  }),
  current: localSchema({
    contractId: "public-pr-application-v3.2",
    localFile: "public-pr-application-v3.2.schema.json",
    remotePath: "intake/schemas/public-pr-application-v3.2.schema.json",
    version: "3.2.0"
  }),
  legacy: localSchema({
    contractId: "public-pr-application-v3.1",
    localFile: "public-pr-application-v3.schema.json",
    remotePath: "intake/schemas/public-pr-application-v3.schema.json",
    version: "3.1.0"
  }),
  submission: localSchema({
    contractId: "open-world-submission-v2.1",
    localFile: "open-world-submission-v2.1.schema.json",
    remotePath: "intake/schemas/open-world-submission-v2.1.schema.json",
    version: "2.1.0"
  }),
  tradeCapabilityManifest: localSchema({
    contractId: "trade-capability-manifest-v2",
    localFile: "trade-capability-manifest-v2.schema.json",
    remotePath: "intake/schemas/trade-capability-manifest-v2.schema.json",
    version: "2.0.0"
  })
});

export class ApplicationContractAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApplicationContractAdapterError";
    this.code = code;
  }
}

/**
 * Bind the local, data-only adapters to one already resolved protected snapshot.
 * This function performs no network I/O and imports no protected validator code.
 */
export function parseApplicationContractFromSnapshot(snapshot) {
  if (
    !isPlainObject(snapshot)
    || snapshot.schemaVersion !== SNAPSHOT_VERSION
    || snapshot.currentness?.status !== "CURRENT"
    || snapshot.currentness?.refCheckedBefore !== true
    || snapshot.currentness?.refCheckedAfter !== true
    || !isDeepFrozen(snapshot)
    || !isPlainObject(snapshot.snapshotBinding)
    || snapshot.snapshotBinding.repository !== "0xprogrammable/submit-launch"
    || snapshot.snapshotBinding.numericRepositoryId !== "1320171831"
    || snapshot.snapshotBinding.branch !== "main"
    || !GIT_OBJECT_PATTERN.test(snapshot.snapshotBinding.baseCommit ?? "")
    || !GIT_OBJECT_PATTERN.test(snapshot.snapshotBinding.baseTree ?? "")
    || !DIGEST_PATTERN.test(snapshot.snapshotBinding.snapshotSha256 ?? "")
    || !isPlainObject(snapshot.applicationContract)
  ) fail("APPLICATION_CONTRACT_SNAPSHOT_INVALID", "The protected Submit Launch snapshot is malformed or not current");

  let snapshotBinding;
  try {
    snapshotBinding = assertSubmitLaunchSnapshotBindingIntegrity(snapshot.snapshotBinding);
    assertProjectStageIntegrity(snapshot.projectStage);
  } catch {
    fail("APPLICATION_CONTRACT_SNAPSHOT_INVALID", "The protected Submit Launch snapshot integrity check failed");
  }

  const compatibility = snapshotBinding.compatibility;
  const compatibilitySchema = snapshotBinding.compatibilitySchema;
  requireArtifactPath(compatibility, ".programmable/applicant-compatibility.v2.json");
  requireLocalSchemaArtifact(compatibilitySchema, localContracts.compatibilitySchema);

  const manifest = snapshot.applicationContract;
  if (
    !SEMVER_PATTERN.test(manifest.minimumBuilderProtocolVersion ?? "")
    || !Array.isArray(manifest.legacy)
    || manifest.legacy.length !== 1
    || !isPlainObject(manifest.supportingContracts)
  ) fail("APPLICATION_CONTRACT_SNAPSHOT_UNSUPPORTED", "The protected Applicant compatibility projection is unsupported by this Builder");
  if (compareSemver(BUILDER_PROTOCOL_VERSION, manifest.minimumBuilderProtocolVersion) < 0) {
    fail("BUILDER_PROTOCOL_TOO_OLD", "The installed Builder protocol is older than the protected Applicant minimum");
  }
  if (manifest.minimumBuilderProtocolVersion !== BUILDER_PROTOCOL_VERSION) {
    fail("APPLICATION_CONTRACT_SNAPSHOT_UNSUPPORTED", "The protected Applicant protocol does not match this exact local adapter release");
  }

  requireLocalBinding(manifest.current, localContracts.current);
  requireLocalBinding(manifest.legacy[0], localContracts.legacy);
  requireLocalBinding(manifest.supportingContracts.submission, localContracts.submission);
  requireLocalBinding(manifest.supportingContracts.tradeCapabilityManifest, localContracts.tradeCapabilityManifest);

  const routerReadiness = manifest.supportingContracts.routerReadiness;
  const routerSchema = routerReadiness?.schema ?? routerReadiness;
  if (
    !isPlainObject(routerSchema)
    || routerSchema.contractId !== "programmable-launch-router-readiness-v1"
    || routerSchema.path !== "intake/schemas/programmable-launch-router-readiness-v1.schema.json"
    || !DIGEST_PATTERN.test(routerSchema.sha256 ?? "")
  ) fail("APPLICATION_CONTRACT_SNAPSHOT_UNSUPPORTED", "The protected Router-readiness schema binding is unsupported");

  const parsed = deepFreeze({
    schemaVersion: ADAPTER_VERSION,
    snapshot: {
      repository: snapshotBinding.repository,
      numericRepositoryId: snapshotBinding.numericRepositoryId,
      branch: snapshotBinding.branch,
      baseCommit: snapshotBinding.baseCommit,
      baseTree: snapshotBinding.baseTree,
      snapshotSha256: snapshotBinding.snapshotSha256,
      compatibilityPath: compatibility.path,
      compatibilitySha256: compatibility.sha256
    },
    projectStage: structuredClone(snapshot.projectStage),
    minimumBuilderProtocolVersion: manifest.minimumBuilderProtocolVersion,
    current: adapterBinding(localContracts.current, {
      officialRouteContractSupported: true,
      officialRouteClaimsAllowed: false,
      launchReadiness: "offline-check-only"
    }),
    legacy: [adapterBinding(localContracts.legacy, {
      officialRouteClaimsAllowed: false,
      launchReadiness: "ineligible"
    })],
    supportingContracts: {
      submission: adapterBinding(localContracts.submission),
      tradeCapabilityManifest: adapterBinding(localContracts.tradeCapabilityManifest),
      routerReadiness: {
        contractId: routerSchema.contractId,
        path: routerSchema.path,
        sha256: routerSchema.sha256,
        executionMode: "not-imported-data-binding-only"
      }
    },
    authority: {
      approvalGranted: false,
      launchAuthorized: false,
      promotionAuthorized: false,
      reviewAuthorized: false
    }
  });
  trustedApplicationContracts.add(parsed);
  return parsed;
}

/** Select the preferred current adapter and derive the only permitted transition. */
export function selectApplicationAdapter({
  applicationContract,
  requestedRoute = null,
  priorVersion = null
} = {}) {
  if (!isPlainObject(applicationContract) || !trustedApplicationContracts.has(applicationContract)) {
    fail("APPLICATION_CONTRACT_ADAPTER_REQUIRED", "An exact parsed Application contract snapshot is required");
  }
  if (!REQUESTED_ROUTES.has(requestedRoute)) {
    fail("APPLICATION_ROUTE_UNSUPPORTED", "The requested launch route is unsupported");
  }
  const snapshotRequestedRoute = STAGE_ROUTE_TO_REQUEST[applicationContract.projectStage.routeState];
  if (snapshotRequestedRoute === undefined || requestedRoute !== snapshotRequestedRoute) {
    fail("APPLICATION_ROUTE_SNAPSHOT_MISMATCH", "The requested Application route does not match the protected Resolver stage projection");
  }
  if (priorVersion !== null && !new Set(["3.1.0", "3.2.0"]).has(priorVersion)) {
    fail("APPLICATION_PRIOR_CONTRACT_UNSUPPORTED", "The prior Application contract version is unsupported");
  }

  const transition = priorVersion === null
    ? { kind: "new", fromVersion: null, toVersion: "3.2.0", appendOnlyRevision: false }
    : priorVersion === "3.1.0"
      ? { kind: "schema-migration", fromVersion: "3.1.0", toVersion: "3.2.0", appendOnlyRevision: true }
      : { kind: "revision", fromVersion: "3.2.0", toVersion: "3.2.0", appendOnlyRevision: true };
  const official = requestedRoute === "programmable-ethereum-mainnet";
  const selection = deepFreeze({
    schemaVersion: SELECTION_VERSION,
    mode: transition.kind === "schema-migration" ? "current-schema-migration" : "current",
    application: applicationContract.current,
    submission: applicationContract.supportingContracts.submission,
    tradeCapabilityManifest: applicationContract.supportingContracts.tradeCapabilityManifest,
    launchReadiness: {
      state: official ? "offline-check-required" : "analysis-pending",
      officialRouteContractSupported: true,
      officialRouteClaimAllowed: false,
      readinessEvidenceVerified: false,
      routePlanRequired: official,
      validatorClosureImported: false,
      schema: applicationContract.supportingContracts.routerReadiness
    },
    requestedRoute,
    transition,
    snapshotSha256: applicationContract.snapshot.snapshotSha256,
    authority: applicationContract.authority
  });
  trustedApplicationSelections.add(selection);
  return selection;
}

/** Preserve the opaque selection identity across local current-contract adapters. */
export function assertApplicationAdapterSelection(value) {
  if (!isPlainObject(value) || !trustedApplicationSelections.has(value)) {
    fail("APPLICATION_CONTRACT_ADAPTER_REQUIRED", "An exact manifest-bound Application adapter selection is required");
  }
  return value;
}

/**
 * Project package data to the resolver route-state vocabulary. V3.1 and
 * unresolved V3.2 evidence can only remain pending; they never imply N/A.
 */
export function projectApplicationRouteState({ application, submission } = {}) {
  if (!isPlainObject(application) || !isPlainObject(submission)) {
    fail("APPLICATION_ROUTE_STATE_INPUT_INVALID", "Application route-state input is malformed");
  }
  if (application.contract?.version === "3.1.0") return "unresolved";
  if (
    application.contract?.version !== "3.2.0"
    || submission.standardVersion !== "2.1.0"
  ) return "unresolved";
  const requestedRoute = application.launchRequest?.requestedRoute;
  const applicability = submission.tradeCapability?.applicability;
  if (requestedRoute === "none") {
    if (applicability === "no-market") return "no-market";
    if (applicability === "unresolved") return "unresolved";
    fail("APPLICATION_ROUTE_STATE_CONTRADICTION", "A no-route Application cannot bind a tradable Submission");
  }
  if (requestedRoute === "other") {
    if (applicability === "tradable") return "external";
    if (applicability === "unresolved") return "unresolved";
    fail("APPLICATION_ROUTE_STATE_CONTRADICTION", "An external tradable route cannot bind a no-market Submission");
  }
  if (requestedRoute === "programmable-ethereum-mainnet") {
    if (applicability === "tradable") return "official-programmable-ethereum";
    if (applicability === "unresolved") return "unresolved";
    fail("APPLICATION_ROUTE_STATE_CONTRADICTION", "An official Programmable route cannot bind a no-market Submission");
  }
  return "unresolved";
}

/** Validate either exact legacy V3.1 bytes or the current V3.2 data contract. */
export function validateApplicationContractDocument({
  application,
  applicationContract,
  applicationSelection
} = {}) {
  if (applicationContract !== undefined && (!isPlainObject(applicationContract) || !trustedApplicationContracts.has(applicationContract))) {
    fail("APPLICATION_CONTRACT_ADAPTER_REQUIRED", "An exact parsed Application contract snapshot is required");
  }
  const version = application?.contract?.version;
  if (version === "3.2.0") {
    const contractBound = isPlainObject(applicationContract)
      && trustedApplicationContracts.has(applicationContract);
    const selectionBound = isPlainObject(applicationSelection)
      && trustedApplicationSelections.has(applicationSelection)
      && applicationSelection.application?.version === "3.2.0";
    if (!contractBound && !selectionBound) {
      return deepFreeze({
        valid: false,
        status: "INVALID",
        contractVersion: version,
        mode: "current-unbound",
        manifestBound: false,
        launchReadiness: "ineligible",
        findings: [{ code: "APPLICATION_CONTRACT_ADAPTER_REQUIRED", path: "$" }]
      });
    }
  }
  const adapter = version === "3.2.0"
    ? localContracts.current
    : version === "3.1.0" ? localContracts.legacy : null;
  if (adapter === null) {
    return deepFreeze({
      valid: false,
      status: "INVALID",
      contractVersion: typeof version === "string" ? version : null,
      mode: "unsupported",
      launchReadiness: "ineligible",
      findings: [{ code: "APPLICATION_CONTRACT_VERSION_UNSUPPORTED", path: "$.contract.version" }]
    });
  }
  const report = validatePublicPrApplicationV3(application, { schema: adapter.schema });
  const official = version === "3.2.0"
    && application?.launchRequest?.requestedRoute === "programmable-ethereum-mainnet";
  return deepFreeze({
    valid: report.valid === true,
    status: report.valid === true ? "VALID" : "INVALID",
    contractVersion: version,
    mode: version === "3.2.0" ? "current" : "legacy-compatibility",
    manifestBound: applicationContract !== undefined,
    launchReadiness: version === "3.1.0"
      ? "ineligible"
      : official ? "offline-check-required" : "analysis-pending",
    findings: structuredClone(report.findings ?? [])
  });
}

function assertProjectStageIntegrity(value) {
  const keys = [
    "profileEnabled",
    "profileId",
    "requirementIds",
    "requirements",
    "routeState",
    "schemaVersion",
    "stage",
    "stageSha256",
    "status",
    "unknownHandlerIds"
  ];
  if (
    !isPlainObject(value)
    || !exactKeys(value, keys)
    || value.schemaVersion !== SUBMIT_LAUNCH_STAGE_PLAN_SCHEMA_VERSION
    || !new Set(["build", "submit", "launch-readiness", "production-promotion"]).has(value.stage)
    || !new Set(["no-market", "external", "unresolved", "official-programmable-ethereum"]).has(value.routeState)
    || !new Set(["READY", "NOT_APPLICABLE", "INTEGRATION_PENDING", "POLICY_UNRESOLVED", "PROFILE_DISABLED"]).has(value.status)
    || !Array.isArray(value.requirementIds)
    || !Array.isArray(value.requirements)
    || !Array.isArray(value.unknownHandlerIds)
    || !DIGEST_PATTERN.test(value.stageSha256 ?? "")
  ) fail("APPLICATION_CONTRACT_SNAPSHOT_INVALID", "The protected Submit Launch project-stage projection is malformed");
  const { stageSha256, ...preimage } = value;
  const observed = `sha256:${crypto.createHash("sha256").update(canonicalJson(preimage)).digest("hex")}`;
  if (observed !== stageSha256) {
    fail("APPLICATION_CONTRACT_SNAPSHOT_INVALID", "The protected Submit Launch project-stage digest is invalid");
  }
}

function localSchema({ contractId, localFile, remotePath, version = null }) {
  const bytes = fs.readFileSync(path.join(referencesDirectory, localFile));
  const schema = JSON.parse(bytes.toString("utf8"));
  return deepFreeze({
    contractId,
    version,
    localPath: `references/${localFile}`,
    remotePath,
    sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    schema
  });
}

function requireLocalBinding(binding, local) {
  if (
    !isPlainObject(binding)
    || binding.contractId !== local.contractId
    || binding.path !== local.remotePath
    || binding.sha256 !== local.sha256
  ) fail("APPLICATION_LOCAL_SCHEMA_BINDING_MISMATCH", "The protected contract does not bind the installed local data-only adapter bytes");
}

function requireLocalSchemaArtifact(binding, local) {
  if (
    !isPlainObject(binding)
    || binding.path !== local.remotePath
    || binding.sha256 !== local.sha256
  ) fail("APPLICATION_LOCAL_SCHEMA_BINDING_MISMATCH", "The protected contract does not bind the installed local data-only adapter bytes");
}

function requireArtifactPath(binding, expectedPath) {
  if (
    !isPlainObject(binding)
    || binding.path !== expectedPath
    || !DIGEST_PATTERN.test(binding.sha256 ?? "")
  ) fail("APPLICATION_CONTRACT_SNAPSHOT_INVALID", "The protected compatibility artifact binding is malformed");
}

function adapterBinding(local, extra = {}) {
  return {
    contractId: local.contractId,
    version: local.version,
    schemaPath: local.remotePath,
    localSchemaPath: local.localPath,
    schemaSha256: local.sha256,
    ...extra
  };
}

function compareSemver(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function isDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(value).every((child) => isDeepFrozen(child, seen));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function fail(code, message) {
  throw new ApplicationContractAdapterError(code, message);
}
