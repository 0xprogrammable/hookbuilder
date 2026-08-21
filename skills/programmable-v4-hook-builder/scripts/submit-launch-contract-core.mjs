import crypto from "node:crypto";

import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import {
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_POLICY_PATH,
  SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID
} from "./registry-intake-contract.mjs";
import { validateAgainstSchema } from "./restricted-json-schema-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { validateSubmitLaunchCompatibilityShape } from "./submit-launch-compatibility-validation.mjs";
import {
  currentSubmitLaunchRequirementsForProfile,
  normalizeSubmitLaunchPolicyBinding,
  normalizeSubmitLaunchPolicySchemaBinding,
  SubmitLaunchPolicyError
} from "./submit-launch-policy-contract.mjs";

export const SUBMIT_LAUNCH_ACTIVE_CONTRACT_V1_PATH = ".programmable/active-contract.json";
export const SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_PATH = ".programmable/active-contract.v2.json";
export const SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_SCHEMA_PATH =
  "intake/schemas/active-contract-manifest-v2.schema.json";
export const SUBMIT_LAUNCH_COMPATIBILITY_V2_PATH = ".programmable/applicant-compatibility.v2.json";
export const SUBMIT_LAUNCH_COMPATIBILITY_V2_SCHEMA_PATH =
  "intake/schemas/applicant-compatibility-v2.schema.json";
export const SUBMIT_LAUNCH_CONTRACT_SNAPSHOT_SCHEMA_VERSION =
  "programmable.submit-launch-contract-snapshot.v1";
export const SUBMIT_LAUNCH_STAGE_PLAN_SCHEMA_VERSION =
  "programmable.submit-launch-stage-plan.v1";

export const MAX_ACTIVE_CONTRACT_BYTES = 256 * 1024;
export const MAX_ACTIVE_CONTRACT_SCHEMA_BYTES = 256 * 1024;
export const MAX_COMPATIBILITY_BYTES = 256 * 1024;
export const MAX_COMPATIBILITY_SCHEMA_BYTES = 256 * 1024;

const ACTIVE_CONTRACT_V1_SCHEMA_ID = "urn:programmable:active-contract-manifest:1.0.0";
const ACTIVE_CONTRACT_V2_SCHEMA_ID = "urn:programmable:active-contract-manifest:2.0.0";
const COMPATIBILITY_V2_SCHEMA_ID = "urn:programmable:applicant-compatibility:2.0.0";
const OBJECT_ID = /^(?!0{40}$)[0-9a-f]{40}$/u;
const SHA256 = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.git(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const STAGES = new Set(["build", "submit", "launch-readiness", "production-promotion"]);
const ROUTE_STATES = new Set([
  "no-market",
  "external",
  "unresolved",
  "official-programmable-ethereum"
]);
const STAGE_PROFILE = Object.freeze({
  build: "build",
  submit: "build",
  "launch-readiness": "launch-readiness",
  "production-promotion": "production-launch"
});
const KNOWN_HANDLERS = new Map([
  ["ethereum-treasury-10-bps-v1", validTreasuryHandler],
  ["programmable-router-readiness-v1", validRouterReadinessHandler],
  ["programmable-router-promotion-v1", validRouterPromotionHandler]
]);

export function parseSubmitLaunchManifestBootstrap(bytes) {
  const value = parseDocument(bytes, MAX_ACTIVE_CONTRACT_BYTES, "active contract V1");
  validateManifest(value, "1.0.0", ACTIVE_CONTRACT_V1_SCHEMA_ID);
  const activeV2 = requireDeclaration(
    value,
    "policy",
    SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_PATH,
    "active contract V2"
  );
  return deepFreeze({ manifest: value, activeV2 });
}

export function parseSubmitLaunchManifestV2Bootstrap(bytes) {
  const value = parseDocument(bytes, MAX_ACTIVE_CONTRACT_BYTES, "active contract V2");
  validateManifest(value, "2.0.0", ACTIVE_CONTRACT_V2_SCHEMA_ID);
  return deepFreeze(value);
}

export function parseSubmitLaunchManifestV2({ bytes, schemaBytes }) {
  const value = parseDocument(bytes, MAX_ACTIVE_CONTRACT_BYTES, "active contract V2");
  const schema = parseSchema(
    schemaBytes,
    MAX_ACTIVE_CONTRACT_SCHEMA_BYTES,
    ACTIVE_CONTRACT_V2_SCHEMA_ID,
    "active contract V2 schema"
  );
  validateManifest(value, "2.0.0", ACTIVE_CONTRACT_V2_SCHEMA_ID);
  validateWithSchema(value, schema, "active contract V2");
  requireDeclaration(
    value,
    "package",
    SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_SCHEMA_PATH,
    "active contract V2 schema"
  );
  return deepFreeze({ manifest: value, schema });
}

export function discoverSubmitLaunchV2Artifacts(manifest) {
  validateManifest(manifest, "2.0.0", ACTIVE_CONTRACT_V2_SCHEMA_ID);
  return deepFreeze({
    activeContractV2Schema: requireDeclaration(
      manifest,
      "package",
      SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_SCHEMA_PATH,
      "active contract V2 schema"
    ),
    compatibility: requireDeclaration(
      manifest,
      "package",
      SUBMIT_LAUNCH_COMPATIBILITY_V2_PATH,
      "Applicant Compatibility V2"
    ),
    compatibilitySchema: requireDeclaration(
      manifest,
      "package",
      SUBMIT_LAUNCH_COMPATIBILITY_V2_SCHEMA_PATH,
      "Applicant Compatibility V2 schema"
    ),
    policy: requireDeclaration(manifest, "policy", SUBMIT_LAUNCH_POLICY_PATH, "launch policy"),
    policySchema: requireDeclaration(
      manifest,
      "package",
      SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
      "launch policy schema"
    )
  });
}

export function parseSubmitLaunchCompatibilityV2({ bytes, schemaBytes, manifest }) {
  validateManifest(manifest, "2.0.0", ACTIVE_CONTRACT_V2_SCHEMA_ID);
  const value = parseDocument(bytes, MAX_COMPATIBILITY_BYTES, "Applicant Compatibility V2");
  const schema = parseSchema(
    schemaBytes,
    MAX_COMPATIBILITY_SCHEMA_BYTES,
    COMPATIBILITY_V2_SCHEMA_ID,
    "Applicant Compatibility V2 schema"
  );
  validateSubmitLaunchCompatibilityShape(value);
  validateWithSchema(value, schema, "Applicant Compatibility V2");
  const applicationBindings = [value.application.current, ...value.application.legacy];
  const supportingBindings = [
    value.supportingContracts.submission,
    value.supportingContracts.tradeCapabilityManifest,
    value.supportingContracts.routerReadiness.schema
  ];
  for (const binding of [...applicationBindings, ...supportingBindings]) {
    const declaration = requireDeclaration(manifest, "package", binding.path, binding.contractId);
    if (declaration.sha256 !== binding.sha256) {
      fail(
        "SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED",
        `Applicant Compatibility V2 ${binding.contractId} disagrees with active contract V2.`
      );
    }
  }
  return deepFreeze({ compatibility: value, schema });
}

export function assertManifestArtifactBytes(declaration, bytes, label) {
  if (!validArtifactBinding(declaration) || sha256(bytes) !== declaration.sha256) {
    fail(
      "SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED",
      `${label} bytes disagree with the active contract manifest.`
    );
  }
  return true;
}

export function buildSubmitLaunchContractSnapshot({
  baseCommit,
  baseTree,
  artifacts,
  manifestV1,
  manifestV2,
  compatibility,
  policyContract,
  stage,
  routeState,
  currentness,
  includeFullSnapshot = false
}) {
  if (!OBJECT_ID.test(baseCommit ?? "") || !OBJECT_ID.test(baseTree ?? "")) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", "Submit Launch snapshot Git identity is invalid.");
  }
  if (!isPlainObject(artifacts) || !isPlainObject(currentness)) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", "Submit Launch snapshot inputs are incomplete.");
  }
  const snapshotWithoutDigest = {
    repository: SUBMIT_LAUNCH_REPOSITORY,
    numericRepositoryId: SUBMIT_LAUNCH_REPOSITORY_ID,
    branch: SUBMIT_LAUNCH_BASE_BRANCH,
    baseCommit,
    baseTree,
    activeContractV1: artifactBinding(artifacts.activeContractV1),
    activeContractV2: {
      ...artifactBinding(artifacts.activeContractV2),
      schema: artifactBinding(artifacts.activeContractV2Schema)
    },
    compatibility: artifactBinding(artifacts.compatibility),
    compatibilitySchema: artifactBinding(artifacts.compatibilitySchema),
    policy: policyContract.policyBinding,
    policySchema: policyContract.policySchemaBinding
  };
  const snapshotBinding = deepFreeze({
    ...snapshotWithoutDigest,
    snapshotSha256: digestCanonical(snapshotWithoutDigest)
  });
  const applicationContract = deepFreeze({
    current: structuredClone(compatibility.application.current),
    legacy: structuredClone(compatibility.application.legacy),
    supportingContracts: structuredClone(compatibility.supportingContracts),
    minimumBuilderProtocolVersion: compatibility.minimumBuilderProtocolVersion
  });
  const projectStage = projectSubmitLaunchStage({ policyContract, stage, routeState });
  const result = {
    schemaVersion: SUBMIT_LAUNCH_CONTRACT_SNAPSHOT_SCHEMA_VERSION,
    snapshotBinding,
    currentness: deepFreeze(structuredClone(currentness)),
    applicationContract,
    projectStage,
    authority: noAuthority()
  };
  if (includeFullSnapshot === true) {
    result.fullSnapshot = deepFreeze({
      activeContractV1: structuredClone(manifestV1),
      activeContractV2: structuredClone(manifestV2),
      compatibility: structuredClone(compatibility),
      policy: structuredClone(policyContract.policy),
      policySchema: structuredClone(policyContract.schema)
    });
  }
  return deepFreeze(result);
}

export function projectSubmitLaunchStage({ policyContract, stage, routeState }) {
  if (!STAGES.has(stage) || !ROUTE_STATES.has(routeState)) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", "Submit Launch stage or route state is unsupported.");
  }
  const profileId = STAGE_PROFILE[stage];
  const profiles = policyContract?.policy?.profiles?.filter(({ id }) => id === profileId) ?? [];
  if (profiles.length !== 1) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `Submit Launch policy does not declare ${profileId} exactly once.`);
  }
  const profile = profiles[0];
  const rules = currentSubmitLaunchRequirementsForProfile(policyContract, profileId);
  const selected = [];
  const unknownHandlerIds = new Set();
  let unresolvedApplicability = false;
  for (const rule of rules) {
    const applicability = resolveApplicability(rule.applicability, routeState);
    if (applicability === "NOT_APPLICABLE") continue;
    if (applicability === "UNRESOLVED") unresolvedApplicability = true;
    const handler = KNOWN_HANDLERS.get(rule.enforcement?.handlerId);
    if (handler === undefined || !handler(rule.parameters)) {
      unknownHandlerIds.add(rule.enforcement?.handlerId ?? "<missing>");
    }
    selected.push(compactRequirement(rule, applicability));
  }

  let status = "READY";
  if (profile.enabled !== true) {
    status = "PROFILE_DISABLED";
  } else if (stage === "launch-readiness" && new Set(["no-market", "external"]).has(routeState)) {
    status = "NOT_APPLICABLE";
  } else if (unknownHandlerIds.size > 0 || unresolvedApplicability) {
    status = "INTEGRATION_PENDING";
  }
  const planWithoutDigest = {
    schemaVersion: SUBMIT_LAUNCH_STAGE_PLAN_SCHEMA_VERSION,
    stage,
    profileId,
    profileEnabled: profile.enabled === true,
    routeState,
    status,
    requirementIds: selected.map(({ id }) => id),
    requirements: selected,
    unknownHandlerIds: [...unknownHandlerIds].sort(compareUtf8)
  };
  return deepFreeze({ ...planWithoutDigest, stageSha256: digestCanonical(planWithoutDigest) });
}

export function unresolvedSubmitLaunchStage({ stage, routeState = "unresolved" }) {
  if (!STAGES.has(stage) || !ROUTE_STATES.has(routeState)) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", "Submit Launch unresolved stage input is invalid.");
  }
  const planWithoutDigest = {
    schemaVersion: SUBMIT_LAUNCH_STAGE_PLAN_SCHEMA_VERSION,
    stage,
    profileId: STAGE_PROFILE[stage],
    profileEnabled: null,
    routeState,
    status: "POLICY_UNRESOLVED",
    requirementIds: [],
    requirements: [],
    unknownHandlerIds: []
  };
  return deepFreeze({ ...planWithoutDigest, stageSha256: digestCanonical(planWithoutDigest) });
}

export function assertSubmitLaunchSnapshotBindingIntegrity(value) {
  if (
    !isPlainObject(value)
    || !exactKeys(value, [
      "repository", "numericRepositoryId", "branch", "baseCommit", "baseTree",
      "activeContractV1", "activeContractV2", "compatibility", "compatibilitySchema",
      "policy", "policySchema", "snapshotSha256"
    ])
    || value.repository !== SUBMIT_LAUNCH_REPOSITORY
    || value.numericRepositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID
    || value.branch !== SUBMIT_LAUNCH_BASE_BRANCH
    || !OBJECT_ID.test(value.baseCommit ?? "")
    || !OBJECT_ID.test(value.baseTree ?? "")
    || !validSnapshotArtifact(value.activeContractV1, SUBMIT_LAUNCH_ACTIVE_CONTRACT_V1_PATH)
    || !isPlainObject(value.activeContractV2)
    || !exactKeys(value.activeContractV2, ["path", "gitBlobOid", "sha256", "schema"])
    || !validSnapshotArtifact(
      {
        path: value.activeContractV2.path,
        gitBlobOid: value.activeContractV2.gitBlobOid,
        sha256: value.activeContractV2.sha256
      },
      SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_PATH
    )
    || !validSnapshotArtifact(
      value.activeContractV2.schema,
      SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_SCHEMA_PATH
    )
    || !validSnapshotArtifact(value.compatibility, SUBMIT_LAUNCH_COMPATIBILITY_V2_PATH)
    || !validSnapshotArtifact(value.compatibilitySchema, SUBMIT_LAUNCH_COMPATIBILITY_V2_SCHEMA_PATH)
    || !SHA256.test(value.snapshotSha256 ?? "")
  ) fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Submit Launch snapshot binding is malformed.");
  const policy = normalizeSubmitLaunchPolicyBinding(value.policy);
  const policySchema = normalizeSubmitLaunchPolicySchemaBinding(value.policySchema);
  if (
    policy.baseCommit !== value.baseCommit
    || policy.baseTree !== value.baseTree
    || policySchema.baseCommit !== value.baseCommit
    || policySchema.baseTree !== value.baseTree
  ) fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Submit Launch snapshot policy Git identity is inconsistent.");
  const { snapshotSha256, ...preimage } = value;
  if (digestCanonical(preimage) !== snapshotSha256) {
    fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Submit Launch snapshot digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

function validateManifest(value, version, schemaId) {
  if (
    !isPlainObject(value)
    || !exactKeys(value, ["$schema", "artifacts", "contractId", "defaultBranch", "kind", "schemaVersion"])
    || value.$schema !== schemaId
    || value.kind !== "programmable-active-contract"
    || value.schemaVersion !== version
    || value.contractId !== "submit-launch"
    || value.defaultBranch !== SUBMIT_LAUNCH_BASE_BRANCH
    || !isPlainObject(value.artifacts)
    || !exactKeys(value.artifacts, ["package", "policy", "validator", "workflow"])
  ) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `Submit Launch active contract ${version} has an unsupported shape.`);
  }
  const paths = new Set();
  let count = 0;
  for (const role of ["package", "policy", "validator", "workflow"]) {
    const bindings = value.artifacts[role];
    if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 32) {
      fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `Submit Launch active contract ${version} role is invalid.`);
    }
    for (const binding of bindings) {
      count += 1;
      if (!validArtifactBinding(binding) || paths.has(binding.path)) {
        fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `Submit Launch active contract ${version} bindings are unsafe.`);
      }
      paths.add(binding.path);
    }
  }
  if (count > 128) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `Submit Launch active contract ${version} is too large.`);
  }
}

function parseSchema(bytes, maximum, schemaId, label) {
  const schema = parseDocument(bytes, maximum, label);
  if (!isPlainObject(schema) || schema.$id !== schemaId) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `${label} identity is unsupported.`);
  }
  return schema;
}

function validateWithSchema(value, schema, label) {
  let findings;
  try {
    findings = validateAgainstSchema(value, schema);
  } catch (cause) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `${label} schema cannot be evaluated.`, cause);
  }
  const actionableFindings = findings.filter(({ code }) => code !== "SCHEMA_PATTERN_UNSAFE");
  if (actionableFindings.length > 0) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `${label} does not satisfy its bound schema.`);
  }
}

function requireDeclaration(manifest, role, artifactPath, label) {
  const matches = manifest.artifacts[role].filter(({ path }) => path === artifactPath);
  if (matches.length !== 1) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `${label} is not declared exactly once by active contract V2.`);
  }
  return deepFreeze(structuredClone(matches[0]));
}

function validArtifactBinding(value) {
  return isPlainObject(value)
    && exactKeys(value, ["path", "sha256"])
    && typeof value.path === "string"
    && value.path.length <= 1024
    && Buffer.byteLength(value.path, "utf8") <= 4096
    && value.path.normalize("NFC") === value.path
    && !hasForbiddenInvisibleOrBidi(value.path)
    && SAFE_PATH.test(value.path)
    && SHA256.test(value.sha256 ?? "");
}

function validSnapshotArtifact(value, expectedPath) {
  return isPlainObject(value)
    && exactKeys(value, ["path", "gitBlobOid", "sha256"])
    && value.path === expectedPath
    && OBJECT_ID.test(value.gitBlobOid ?? "")
    && SHA256.test(value.sha256 ?? "");
}

function resolveApplicability(value, routeState) {
  if (isPlainObject(value) && exactKeys(value, ["mode"]) && value.mode === "always") return "APPLICABLE";
  if (
    !isPlainObject(value)
    || !exactKeys(value, ["equals", "field", "mode"])
    || value.mode !== "when"
    || value.field !== "routerProvenanceRequired"
    || value.equals !== true
  ) return "UNRESOLVED";
  if (routeState === "official-programmable-ethereum") return "APPLICABLE";
  if (routeState === "no-market" || routeState === "external") return "NOT_APPLICABLE";
  return "UNRESOLVED";
}

function compactRequirement(rule, applicability) {
  return deepFreeze({
    id: rule.id,
    severity: rule.severity,
    requirement: rule.requirement,
    applicability: structuredClone(rule.applicability),
    applicabilityStatus: applicability,
    enforcement: structuredClone(rule.enforcement),
    parameters: structuredClone(rule.parameters),
    evidence: structuredClone(rule.evidence)
  });
}

function validTreasuryHandler(value) {
  return isPlainObject(value)
    && Number.isSafeInteger(value.chainId)
    && value.chainId > 0
    && Number.isSafeInteger(value.hundredthsOfBip)
    && value.hundredthsOfBip > 0
    && value.hundredthsOfBip <= 1_000_000
    && EVM_ADDRESS.test(value.treasury ?? "")
    && nonEmptyString(value.basis, 128)
    && nonEmptyString(value.network, 128);
}

function validRouterReadinessHandler(value) {
  return isPlainObject(value)
    && Number.isSafeInteger(value.chainId)
    && value.chainId > 0
    && validHttpsUrl(value.discoveryDocumentUrl)
    && nonEmptyString(value.launchEntryPoint, 128)
    && nonEmptyString(value.routerManifestPointer, 256);
}

function validRouterPromotionHandler(value) {
  return isPlainObject(value)
    && Number.isSafeInteger(value.chainId)
    && value.chainId > 0
    && validHttpsUrl(value.discoveryDocumentUrl)
    && nonEmptyString(value.routerManifestPointer, 256)
    && Array.isArray(value.promotionTargets)
    && value.promotionTargets.length > 0
    && value.promotionTargets.length <= 32
    && value.promotionTargets.every((target) => nonEmptyString(target, 128))
    && new Set(value.promotionTargets).size === value.promotionTargets.length;
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === "";
  } catch {
    return false;
  }
}

function nonEmptyString(value, maximum) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value.normalize("NFC") === value
    && !hasForbiddenInvisibleOrBidi(value);
}

function artifactBinding(artifact) {
  if (
    !isPlainObject(artifact)
    || !validArtifactBinding({ path: artifact.filePath, sha256: artifact.sha256 })
    || !OBJECT_ID.test(artifact.gitBlobOid ?? "")
  ) fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", "Submit Launch artifact binding is invalid.");
  return deepFreeze({ path: artifact.filePath, gitBlobOid: artifact.gitBlobOid, sha256: artifact.sha256 });
}

function parseDocument(bytes, maximum, label) {
  try {
    return parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: maximum,
      maxDepth: 128,
      maxNodes: 100_000,
      maxNumberCharacters: maximum
    });
  } catch (cause) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", `${label} JSON is malformed or exceeds its bounded profile.`, cause);
  }
}

function noAuthority() {
  return deepFreeze({
    checkerOnly: true,
    independentAudit: false,
    launchAuthorized: false,
    productionDiscoveryAllowed: false,
    publicRoutingAllowed: false,
    realUserFundsAllowed: false,
    reviewAuthorized: false,
    externalWritesPerformed: false
  });
}

function digestCanonical(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(code, message, cause) {
  throw new SubmitLaunchPolicyError(code, message, cause === undefined ? undefined : { cause });
}
