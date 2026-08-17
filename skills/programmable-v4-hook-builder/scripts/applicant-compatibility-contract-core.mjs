import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const identifierPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const semverPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const safePathPattern = /^(?!\/)(?!.*(?:^|\/)\.git(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const exactCapabilityModes = Object.freeze(["inline", "manifest"]);
const exactDraftOperations = Object.freeze(["create", "update"]);

export const APPLICANT_COMPATIBILITY_PATH = ".programmable/applicant-compatibility.v1.json";
export const LEGACY_ACTIVE_CONTRACT_PATH = ".programmable/active-contract.json";

export class ApplicantCompatibilityError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApplicantCompatibilityError";
    this.code = code;
  }
}

export function parseApplicantCompatibilityContract(bytes, expected) {
  const binding = validateExpectedBinding(expected);
  const value = parseDocument(
    bytes,
    "APPLICANT_COMPATIBILITY_JSON_INVALID",
    "Applicant compatibility JSON is malformed or exceeds its bounded profile"
  );
  validateCompatibilityShape(value);
  if (
    value.trustedRepository.numericId !== binding.repositoryNumericId
    || value.trustedRepository.defaultBranch !== binding.defaultBranch
  ) {
    fail("TRUSTED_REPOSITORY_BINDING_MISMATCH", "Applicant compatibility does not bind the expected protected repository identity");
  }
  if (
    value.application.contractId !== binding.applicationContractId
    || value.application.schemaPath !== binding.applicationSchemaPath
    || value.application.schemaSha256 !== binding.applicationSchemaSha256
  ) {
    fail("APPLICATION_CONTRACT_BINDING_MISMATCH", "Applicant compatibility does not bind the expected Application contract and schema bytes");
  }
  if (compareSemver(binding.builderProtocolVersion, value.minimumBuilderProtocolVersion) < 0) {
    fail("BUILDER_PROTOCOL_TOO_OLD", "The installed Builder protocol is older than the protected minimum");
  }
  return deepFreeze(value);
}

export function resolveApplicantCompatibilityContract({
  compatibilityBytes = null,
  activeContractBytes = null,
  expected
} = {}) {
  const binding = validateExpectedBinding(expected);
  if (compatibilityBytes !== null && compatibilityBytes !== undefined) {
    return deepFreeze({
      mode: "COMPATIBILITY_CONTRACT",
      path: APPLICANT_COMPATIBILITY_PATH,
      contract: parseApplicantCompatibilityContract(compatibilityBytes, binding)
    });
  }
  if (activeContractBytes === null || activeContractBytes === undefined) {
    fail("APPLICANT_COMPATIBILITY_NOT_FOUND", "Neither the Applicant compatibility contract nor its legacy active-contract fallback is available");
  }
  const manifest = parseDocument(
    activeContractBytes,
    "LEGACY_ACTIVE_CONTRACT_JSON_INVALID",
    "The legacy active-contract JSON is malformed or exceeds its bounded profile"
  );
  validateLegacyActiveContract(manifest, binding);
  return deepFreeze({
    mode: "LEGACY_ACTIVE_CONTRACT",
    path: LEGACY_ACTIVE_CONTRACT_PATH,
    application: {
      contractId: binding.applicationContractId,
      schemaPath: binding.applicationSchemaPath,
      schemaSha256: binding.applicationSchemaSha256
    },
    trustedRepository: {
      numericId: binding.repositoryNumericId,
      defaultBranch: binding.defaultBranch
    },
    validatorPackage: null
  });
}

function validateCompatibilityShape(value) {
  if (
    !isPlainObject(value)
    || !exactKeys(value, [
      "$schema",
      "application",
      "capabilities",
      "kind",
      "minimumBuilderProtocolVersion",
      "schemaVersion",
      "trustedRepository",
      "validatorPackage"
    ])
    || value.$schema !== "urn:programmable:applicant-compatibility:1.0.0"
    || value.kind !== "programmable-applicant-compatibility"
    || value.schemaVersion !== "1.0.0"
    || !semverPattern.test(value.minimumBuilderProtocolVersion ?? "")
    || !validTrustedRepository(value.trustedRepository)
    || !validApplication(value.application)
    || !validCapabilities(value.capabilities)
    || !validValidatorPackage(value.validatorPackage)
  ) fail("APPLICANT_COMPATIBILITY_SHAPE_INVALID", "Applicant compatibility does not match the closed v1 contract");
}

function validateLegacyActiveContract(value, expected) {
  if (
    !isPlainObject(value)
    || !exactKeys(value, ["$schema", "artifacts", "contractId", "defaultBranch", "kind", "schemaVersion"])
    || value.$schema !== "urn:programmable:active-contract-manifest:1.0.0"
    || value.kind !== "programmable-active-contract"
    || value.schemaVersion !== "1.0.0"
    || value.contractId !== expected.legacyActiveContractId
    || value.defaultBranch !== expected.defaultBranch
    || !validActiveContractArtifacts(value.artifacts)
  ) fail("LEGACY_ACTIVE_CONTRACT_INVALID", "The legacy active-contract fallback does not match its closed released shape");
  const matches = value.artifacts.package.filter(({ path }) => path === expected.applicationSchemaPath);
  if (matches.length !== 1 || matches[0].sha256 !== expected.applicationSchemaSha256) {
    fail("LEGACY_APPLICATION_SCHEMA_BINDING_MISMATCH", "The legacy active contract does not bind the exact expected Application schema bytes");
  }
}

function validateExpectedBinding(value) {
  if (
    !isPlainObject(value)
    || !exactKeys(value, [
      "applicationContractId",
      "applicationSchemaPath",
      "applicationSchemaSha256",
      "builderProtocolVersion",
      "defaultBranch",
      "legacyActiveContractId",
      "repositoryNumericId"
    ])
    || !decimalPattern.test(value.repositoryNumericId ?? "")
    || !validBranch(value.defaultBranch)
    || !identifierPattern.test(value.applicationContractId ?? "")
    || !safePath(value.applicationSchemaPath)
    || !digestPattern.test(value.applicationSchemaSha256 ?? "")
    || !semverPattern.test(value.builderProtocolVersion ?? "")
    || !identifierPattern.test(value.legacyActiveContractId ?? "")
  ) fail("APPLICANT_COMPATIBILITY_EXPECTATION_INVALID", "Expected Applicant compatibility bindings are malformed");
  return value;
}

function validTrustedRepository(value) {
  return isPlainObject(value)
    && exactKeys(value, ["defaultBranch", "numericId"])
    && decimalPattern.test(value.numericId ?? "")
    && validBranch(value.defaultBranch);
}

function validApplication(value) {
  return isPlainObject(value)
    && exactKeys(value, ["contractId", "schemaPath", "schemaSha256"])
    && identifierPattern.test(value.contractId ?? "")
    && safePath(value.schemaPath)
    && digestPattern.test(value.schemaSha256 ?? "");
}

function validCapabilities(value) {
  return isPlainObject(value)
    && exactKeys(value, [
      "draftTransportOperations",
      "missingObjectRecovery",
      "sourceClosureModes",
      "unreviewedDraftOnly"
    ])
    && sameStringList(value.sourceClosureModes, exactCapabilityModes)
    && sameStringList(value.draftTransportOperations, exactDraftOperations)
    && value.missingObjectRecovery === true
    && value.unreviewedDraftOnly === true;
}

function validValidatorPackage(value) {
  if (
    !isPlainObject(value)
    || !exactKeys(value, ["closureSha256", "entrypointPath", "receiptPath", "rootPath"])
    || !safePath(value.rootPath)
    || !safePath(value.entrypointPath)
    || !safePath(value.receiptPath)
    || !digestPattern.test(value.closureSha256 ?? "")
  ) return false;
  const prefix = `${value.rootPath}/`;
  return value.entrypointPath.startsWith(prefix)
    && value.entrypointPath.endsWith(".mjs")
    && value.receiptPath.startsWith(prefix)
    && value.receiptPath.endsWith(".json");
}

function validActiveContractArtifacts(value) {
  if (!isPlainObject(value) || !exactKeys(value, ["package", "policy", "validator", "workflow"])) return false;
  return Object.values(value).every((declarations) => Array.isArray(declarations)
    && declarations.length <= 128
    && declarations.every((declaration) => isPlainObject(declaration)
      && exactKeys(declaration, ["path", "sha256"])
      && safePath(declaration.path)
      && digestPattern.test(declaration.sha256 ?? "")));
}

function parseDocument(bytes, code, message) {
  try {
    return parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: 256 * 1024,
      maxNodes: 20_000,
      maxDepth: 64,
      maxNumberCharacters: 128
    });
  } catch (cause) {
    fail(code, message, cause);
  }
}

function compareSemver(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function safePath(value) {
  return typeof value === "string" && value.length <= 512 && safePathPattern.test(value);
}

function validBranch(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u.test(value)
    && !value.includes("..")
    && !value.includes("//");
}

function sameStringList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(code, message, cause = undefined) {
  throw new ApplicantCompatibilityError(code, message, cause);
}
