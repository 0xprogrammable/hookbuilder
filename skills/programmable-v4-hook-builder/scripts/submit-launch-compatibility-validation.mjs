import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import {
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_REPOSITORY_ID
} from "./registry-intake-contract.mjs";
import { SubmitLaunchPolicyError } from "./submit-launch-policy-contract.mjs";

const COMPATIBILITY_V2_SCHEMA_ID = "urn:programmable:applicant-compatibility:2.0.0";
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const SHA256 = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.git(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const ROUTER_VALIDATOR_PATHS = new Set([
  "scripts/programmable-launch-router-readiness-core.mjs",
  "scripts/programmable-launch-router-readiness.mjs",
  "vendor/programmable-applicant-validator/scripts/evm-encoding-core.mjs",
  "vendor/programmable-v4-hook-builder/scripts/github-public-source-lossless-json.mjs"
]);

export function validateSubmitLaunchCompatibilityShape(value) {
  if (
    !isPlainObject(value)
    || !exactKeys(value, [
      "$schema", "application", "authority", "capabilities", "kind",
      "minimumBuilderProtocolVersion", "schemaVersion", "supportingContracts", "trustedRepository"
    ])
    || value.$schema !== COMPATIBILITY_V2_SCHEMA_ID
    || value.kind !== "programmable-applicant-compatibility"
    || value.schemaVersion !== "2.0.0"
    || !SEMVER.test(value.minimumBuilderProtocolVersion ?? "")
    || !isPlainObject(value.trustedRepository)
    || !exactKeys(value.trustedRepository, ["defaultBranch", "numericId"])
    || value.trustedRepository.numericId !== SUBMIT_LAUNCH_REPOSITORY_ID
    || value.trustedRepository.defaultBranch !== SUBMIT_LAUNCH_BASE_BRANCH
    || !isPlainObject(value.application)
    || !exactKeys(value.application, ["current", "legacy"])
    || !validContractBinding(value.application.current)
    || !Array.isArray(value.application.legacy)
    || value.application.legacy.length !== 1
    || !value.application.legacy.every(validContractBinding)
    || !knownContractBinding(
      value.application.current,
      "public-pr-application-v3.2",
      "intake/schemas/public-pr-application-v3.2.schema.json"
    )
    || !knownContractBinding(
      value.application.legacy[0],
      "public-pr-application-v3.1",
      "intake/schemas/public-pr-application-v3.schema.json"
    )
    || !validCompatibilityAuthority(value.authority)
    || !validCompatibilityCapabilities(value.capabilities)
    || !isPlainObject(value.supportingContracts)
    || !exactKeys(value.supportingContracts, ["routerReadiness", "submission", "tradeCapabilityManifest"])
    || !validContractBinding(value.supportingContracts.submission)
    || !validContractBinding(value.supportingContracts.tradeCapabilityManifest)
    || !isPlainObject(value.supportingContracts.routerReadiness)
    || !exactKeys(value.supportingContracts.routerReadiness, ["schema", "validatorClosure"])
    || !validContractBinding(value.supportingContracts.routerReadiness.schema)
    || !validValidatorClosure(value.supportingContracts.routerReadiness.validatorClosure)
    || !knownContractBinding(
      value.supportingContracts.submission,
      "open-world-submission-v2.1",
      "intake/schemas/open-world-submission-v2.1.schema.json"
    )
    || !knownContractBinding(
      value.supportingContracts.tradeCapabilityManifest,
      "trade-capability-manifest-v2",
      "intake/schemas/trade-capability-manifest-v2.schema.json"
    )
    || !knownContractBinding(
      value.supportingContracts.routerReadiness.schema,
      "programmable-launch-router-readiness-v1",
      "intake/schemas/programmable-launch-router-readiness-v1.schema.json"
    )
  ) {
    fail("SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", "Applicant Compatibility V2 has an unsupported shape.");
  }
}

function validValidatorClosure(value) {
  return isPlainObject(value)
    && exactKeys(value, ["algorithm", "closureSha256", "files"])
    && value.algorithm === "sha256-path-nul-size-nul-content-nul-v1"
    && SHA256.test(value.closureSha256 ?? "")
    && Array.isArray(value.files)
    && value.files.length === ROUTER_VALIDATOR_PATHS.size
    && value.files.every(validArtifactBinding)
    && new Set(value.files.map(({ path }) => path)).size === ROUTER_VALIDATOR_PATHS.size
    && value.files.every(({ path }) => ROUTER_VALIDATOR_PATHS.has(path));
}

function validCompatibilityAuthority(value) {
  const keys = [
    "candidateCodeExecuted", "credentialsUsed", "externalWritesPerformed", "launchAuthorized",
    "networkAccessed", "promotionAuthorized", "reviewAuthorized", "rpcAccessed"
  ];
  return isPlainObject(value) && exactKeys(value, keys) && keys.every((key) => value[key] === false);
}

function validCompatibilityCapabilities(value) {
  return isPlainObject(value)
    && exactKeys(value, ["draftTransportOperations", "launchReadiness", "unreviewedDraftOnly"])
    && Array.isArray(value.draftTransportOperations)
    && value.draftTransportOperations.length === 2
    && value.draftTransportOperations[0] === "create"
    && value.draftTransportOperations[1] === "update"
    && value.launchReadiness === "offline-check-only"
    && value.unreviewedDraftOnly === true;
}

function knownContractBinding(value, contractId, artifactPath) {
  return value.contractId === contractId && value.path === artifactPath;
}

function validContractBinding(value) {
  return isPlainObject(value)
    && exactKeys(value, ["contractId", "path", "sha256"])
    && typeof value.contractId === "string"
    && value.contractId.length > 2
    && value.contractId.length <= 128
    && validArtifactBinding({ path: value.path, sha256: value.sha256 });
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

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message) {
  throw new SubmitLaunchPolicyError(code, message);
}
