import crypto from "node:crypto";
import { types } from "node:util";

import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const UNIVERSAL_ADMISSION_CONTRACT_PATH = ".programmable/universal-admission-contract.v1.json";
export const UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID = "urn:programmable:universal-admission-contract:1.0.0";
export const UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH = "intake/schemas/universal-admission-contract-v1.schema.json";

export const UNIVERSAL_ADMISSION_SCHEMA_BINDINGS = Object.freeze([
  binding("admission", "intake/schemas/universal-admission-v1.schema.json", "urn:programmable:universal-admission:1.0.0"),
  binding("command", "intake/schemas/universal-admission-command-v1.schema.json", "urn:programmable:universal-admission-command:1.0.0"),
  binding("event-receipt", "intake/schemas/universal-admission-event-receipt-v1.schema.json", "urn:programmable:universal-admission-event-receipt:1.0.0"),
  binding("runtime-policy", "intake/schemas/universal-admission-runtime-policy-v1.schema.json", "urn:programmable:universal-admission-runtime-policy:1.0.0"),
  binding("snapshot", "intake/schemas/universal-admission-snapshot-v1.schema.json", "urn:programmable:universal-admission-snapshot:1.0.0"),
  binding("transport-receipt", "intake/schemas/authenticated-admission-transport-receipt-v1.schema.json", "urn:programmable:authenticated-admission-transport-receipt:1.0.0"),
  binding("trust", "intake/schemas/universal-admission-trust-v1.schema.json", "urn:programmable:universal-admission-trust:1.0.0"),
  binding("worker-result", "intake/schemas/universal-admission-worker-result-v1.schema.json", "urn:programmable:universal-admission-worker-result:1.0.0")
]);

export const UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS = Object.freeze([
  "scripts/universal-admission-command-core.mjs",
  "scripts/universal-admission-core.mjs",
  "scripts/universal-admission-protocol-core.mjs",
  "scripts/universal-admission-service-core.mjs",
  "scripts/universal-admission-sqlite-store.mjs",
  "scripts/universal-admission-sqlite.mjs",
  "vendor/programmable-applicant-validator/scripts/github-public-source-lossless-json.mjs",
  "vendor/programmable-applicant-validator/scripts/open-world-v2-primitives.mjs"
]);

export const UNIVERSAL_ADMISSION_AUTHORITY_KEYS = Object.freeze([
  "admissionDecisionGranted",
  "approvalGranted",
  "auditCompleted",
  "deploymentPerformed",
  "fundMovementAuthorized",
  "fundMovementPerformed",
  "independentAudit",
  "launchAuthorized",
  "repositoryOwnershipProven",
  "reviewCompleted",
  "safetyCertified",
  "safetyGuaranteed"
]);

export const UNIVERSAL_ADMISSION_INERT_AUTHORITY = deepFreeze(Object.fromEntries(
  UNIVERSAL_ADMISSION_AUTHORITY_KEYS.map((key) => [key, false])
));

const CONTRACT_CORE_PATH = "scripts/universal-admission-contract-core.mjs";
const CONTRACT_PUBLISHER_PATH = "scripts/universal-admission-contract.mjs";
const MAXIMUM_CONTRACT_BYTES = 256 * 1024;
const MAXIMUM_SCHEMA_BYTES = 2 * 1024 * 1024;
const ROOT_UINT8_ARRAY = Uint8Array;
const ROOT_TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(ROOT_UINT8_ARRAY.prototype);
const ROOT_TYPED_ARRAY_BUFFER = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "buffer").get
);
const ROOT_TYPED_ARRAY_BYTE_OFFSET = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "byteOffset").get
);
const ROOT_TYPED_ARRAY_BYTE_LENGTH = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(ROOT_TYPED_ARRAY_PROTOTYPE, "byteLength").get
);
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export class UniversalAdmissionContractError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UniversalAdmissionContractError";
    this.code = code;
  }
}

export function parseUniversalAdmissionContractBytes(bytes) {
  const snapshot = boundedByteCopy(bytes, MAXIMUM_CONTRACT_BYTES, "UNIVERSAL_ADMISSION_CONTRACT_BYTES_INVALID");
  let value;
  try {
    value = parseBoundedStrictJsonBytes(snapshot, {
      maxSourceBytes: MAXIMUM_CONTRACT_BYTES,
      maxNodes: 4_096,
      maxDepth: 32,
      maxNumberCharacters: 128
    });
  } catch (cause) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_JSON_INVALID", "Universal Admission contract must be bounded duplicate-free UTF-8 JSON", cause);
  }
  const contract = validateUniversalAdmissionContract(value);
  if (!snapshot.equals(Buffer.from(`${canonicalJson(contract)}\n`, "utf8"))) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_NONCANONICAL", "Universal Admission contract must be canonical JSON followed by one LF");
  }
  return deepFreeze({ contract, sha256: digestBytes(snapshot) });
}

export function validateUniversalAdmissionContract(value) {
  object(value, "$", [
    "$schema", "authority", "contractCore", "contractPublisher", "contractSchema", "deployment", "kind",
    "minimumClientProtocolVersion", "publicDataOnly", "referenceImplementation", "schemaVersion", "schemas",
    "transport", "trustedRepository"
  ]);
  exact(value.$schema, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID, "$.$schema");
  exact(value.kind, "programmable-universal-admission-contract", "$.kind");
  exact(value.schemaVersion, "1.0.0", "$.schemaVersion");
  exact(value.minimumClientProtocolVersion, "1.0.0", "$.minimumClientProtocolVersion");
  exact(value.publicDataOnly, true, "$.publicDataOnly");

  artifact(value.contractCore, "$.contractCore", CONTRACT_CORE_PATH);
  artifact(value.contractPublisher, "$.contractPublisher", CONTRACT_PUBLISHER_PATH);
  artifact(value.contractSchema, "$.contractSchema", UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH);

  object(value.trustedRepository, "$.trustedRepository", ["defaultBranch", "numericId"]);
  exact(value.trustedRepository.defaultBranch, "main", "$.trustedRepository.defaultBranch");
  exact(value.trustedRepository.numericId, "1320171831", "$.trustedRepository.numericId");

  object(value.transport, "$.transport", ["authentication", "id", "operation"]);
  exact(value.transport.authentication, "detached-ed25519", "$.transport.authentication");
  exact(value.transport.id, "authenticated-admission-queue-v1", "$.transport.id");
  exact(value.transport.operation, "enqueue", "$.transport.operation");

  object(value.deployment, "$.deployment", ["audience", "enabled", "endpoint", "state", "trustSnapshot"]);
  exact(value.deployment.audience, null, "$.deployment.audience");
  exact(value.deployment.enabled, false, "$.deployment.enabled");
  exact(value.deployment.endpoint, null, "$.deployment.endpoint");
  exact(value.deployment.state, "reference-only-disabled", "$.deployment.state");
  exact(value.deployment.trustSnapshot, null, "$.deployment.trustSnapshot");

  object(value.authority, "$.authority", UNIVERSAL_ADMISSION_AUTHORITY_KEYS);
  for (const key of UNIVERSAL_ADMISSION_AUTHORITY_KEYS) exact(value.authority[key], false, `$.authority.${key}`);

  if (!Array.isArray(value.schemas) || value.schemas.length !== UNIVERSAL_ADMISSION_SCHEMA_BINDINGS.length) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", "$.schemas must contain the exact closed schema binding set");
  }
  for (const [index, expected] of UNIVERSAL_ADMISSION_SCHEMA_BINDINGS.entries()) {
    const observed = value.schemas[index];
    object(observed, `$.schemas[${index}]`, ["id", "path", "schemaId", "sha256"]);
    exact(observed.id, expected.id, `$.schemas[${index}].id`);
    exact(observed.path, expected.path, `$.schemas[${index}].path`);
    exact(observed.schemaId, expected.schemaId, `$.schemas[${index}].schemaId`);
    digest(observed.sha256, `$.schemas[${index}].sha256`);
  }

  object(value.referenceImplementation, "$.referenceImplementation", [
    "artifacts", "distributed", "enabled", "kind", "referenceOnly", "topology"
  ]);
  exact(value.referenceImplementation.distributed, false, "$.referenceImplementation.distributed");
  exact(value.referenceImplementation.enabled, false, "$.referenceImplementation.enabled");
  exact(value.referenceImplementation.kind, "node-sqlite-single-host-v1", "$.referenceImplementation.kind");
  exact(value.referenceImplementation.referenceOnly, true, "$.referenceImplementation.referenceOnly");
  exact(value.referenceImplementation.topology, "single-host-single-writer", "$.referenceImplementation.topology");
  if (
    !Array.isArray(value.referenceImplementation.artifacts)
    || value.referenceImplementation.artifacts.length !== UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS.length
  ) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", "$.referenceImplementation.artifacts must contain the exact closed artifact set");
  }
  for (const [index, expectedPath] of UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS.entries()) {
    artifact(value.referenceImplementation.artifacts[index], `$.referenceImplementation.artifacts[${index}]`, expectedPath);
  }
  return deepFreeze(value);
}

export function verifyUniversalAdmissionSchemaId(bytes, expectedSchemaId, schemaPath) {
  let value;
  try {
    value = parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: MAXIMUM_SCHEMA_BYTES,
      maxNodes: 250_000,
      maxDepth: 256,
      maxNumberCharacters: 1_024
    });
  } catch (cause) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_INVALID", `${schemaPath} is not bounded duplicate-free UTF-8 JSON`, cause);
  }
  if (!isPlainObject(value) || value.$id !== expectedSchemaId) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID_MISMATCH", `${schemaPath} does not publish ${expectedSchemaId}`);
  }
  return true;
}

export function universalAdmissionQueueStatus(binding) {
  if (binding?.contract?.deployment?.state !== "reference-only-disabled") {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", "Only the reviewed disabled V1 deployment state is supported");
  }
  return deepFreeze({
    transport: "authenticated-admission-queue-v1",
    operation: "enqueue",
    queueUsable: false,
    deploymentState: "reference-only-disabled",
    endpoint: null,
    audience: null,
    trustSnapshot: null,
    contract: binding.evidence,
    applicationV3: {
      contractId: "public-pr-application-v3.1",
      bytesMutated: false,
      admissionEnvelopeMaterialized: false,
      admissionBinding: null
    },
    effects: {
      confirmationRequested: false,
      candidateCodeExecuted: false,
      externalWriteAttempted: false,
      networkMutationAttempted: false,
      fallbackAttempted: false
    },
    authority: UNIVERSAL_ADMISSION_INERT_AUTHORITY
  });
}

export function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function boundedByteCopy(value, maximumBytes, code) {
  // Native proxy/brand checks and prebound root %TypedArray% accessors inspect
  // internal slots without consulting caller-owned binary properties.
  if (
    value === null
    || typeof value !== "object"
    || types.isProxy(value)
    || !types.isUint8Array(value)
  ) {
    fail(code, "Input must be one non-proxy bounded byte sequence");
  }
  const before = rootUint8ArrayRegion(value, code);
  if (before.byteLength < 2 || before.byteLength > maximumBytes) {
    fail(code, "Input exceeds its closed byte boundary");
  }

  let snapshot;
  try {
    const safeView = new ROOT_UINT8_ARRAY(before.buffer, before.byteOffset, before.byteLength);
    snapshot = Buffer.from(safeView);
  } catch (cause) {
    fail(code, "Input bytes could not be snapshotted exactly once", cause);
  }
  const after = rootUint8ArrayRegion(value, code);
  if (
    after.buffer !== before.buffer
    || after.byteOffset !== before.byteOffset
    || after.byteLength !== before.byteLength
    || snapshot.byteLength !== before.byteLength
    || snapshot.byteLength < 2
    || snapshot.byteLength > maximumBytes
  ) {
    fail(code, "Input backing region changed while it was being snapshotted");
  }
  return snapshot;
}

function rootUint8ArrayRegion(value, code) {
  try {
    const buffer = ROOT_TYPED_ARRAY_BUFFER(value);
    const byteOffset = ROOT_TYPED_ARRAY_BYTE_OFFSET(value);
    const byteLength = ROOT_TYPED_ARRAY_BYTE_LENGTH(value);
    if (
      !Number.isSafeInteger(byteOffset)
      || byteOffset < 0
      || !Number.isSafeInteger(byteLength)
      || byteLength < 0
    ) {
      fail(code, "Input has an invalid backing byte region");
    }
    return { buffer, byteLength, byteOffset };
  } catch (cause) {
    if (cause instanceof UniversalAdmissionContractError) throw cause;
    fail(code, "Input backing byte region could not be inspected", cause);
  }
}

function binding(id, path, schemaId) {
  return Object.freeze({ id, path, schemaId });
}

function artifact(value, location, expectedPath) {
  object(value, location, ["path", "sha256"]);
  exact(value.path, expectedPath, `${location}.path`);
  digest(value.sha256, `${location}.sha256`);
}

function digest(value, location) {
  if (!SHA256.test(value ?? "")) fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be a lowercase SHA-256 binding`);
}

function object(value, location, expectedKeys) {
  if (!isPlainObject(value)) fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must be a plain object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...expectedKeys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must contain the exact closed key set`);
  }
}

function exact(actual, expected, location) {
  if (actual !== expected) fail("UNIVERSAL_ADMISSION_CONTRACT_INVALID", `${location} must equal ${JSON.stringify(expected)}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code, message, cause = undefined) {
  throw new UniversalAdmissionContractError(code, message, cause);
}
