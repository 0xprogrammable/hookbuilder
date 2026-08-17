import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  APPLICANT_COMPATIBILITY_PATH,
  LEGACY_ACTIVE_CONTRACT_PATH,
  LOCAL_APPLICANT_VALIDATOR_PACKAGE,
  resolveApplicantCompatibilityContract
} from "./applicant-compatibility-contract-core.mjs";
import { createGitHubPublicFetchTransportV1 } from "./github-public-source-core.mjs";
import { SUBMIT_LAUNCH_INTAKE_CONTRACT } from "./registry-intake-contract.mjs";
import { RESOLVE_CONTRACT_V1 } from "./resolve-contract-definitions.mjs";
import {
  requestJson,
  resolveBlob,
  resolveDefaultBranchHead,
  validateRecursiveTree,
  validateRepositoryMetadata
} from "./resolve-contract-github.mjs";
import { apiPrefix } from "./resolve-contract-shared.mjs";
import { normalizeContractRepositoryV1 } from "./resolve-contract-validation.mjs";

const BUILDER_PROTOCOL_VERSION = "1.0.0";
const MAXIMUM_COMPATIBILITY_BYTES = 256 * 1024;
const MAXIMUM_SCHEMA_BYTES = 2 * 1024 * 1024;

export async function resolveProtectedApplicantCompatibility({
  transport = undefined,
  timeoutMs = RESOLVE_CONTRACT_V1.defaultTimeoutMs
} = {}) {
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < RESOLVE_CONTRACT_V1.minimumTimeoutMs
    || timeoutMs > RESOLVE_CONTRACT_V1.maximumTimeoutMs
    || (transport !== undefined && typeof transport !== "function")
  ) throw new TypeError("Applicant compatibility GitHub options are outside the supported bounds");

  const repository = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository;
  const target = normalizeContractRepositoryV1(repository.slug);
  const state = {
    deadline: performance.now() + timeoutMs,
    requests: 0,
    responseBytes: 0,
    transport: transport ?? createGitHubPublicFetchTransportV1()
  };
  const metadata = await requestJson(
    state,
    apiPrefix(target),
    "repository",
    RESOLVE_CONTRACT_V1.maximumJsonResponseBytes
  );
  const repositoryBinding = validateRepositoryMetadata(metadata, target);
  if (
    repositoryBinding.numericRepositoryId !== repository.numericId
    || repositoryBinding.defaultBranch !== repository.defaultBranch
  ) throw applicantCompatibilityFailure("BUILDER_CENTRAL_COMPATIBILITY_MISMATCH");

  const firstHead = await resolveDefaultBranchHead(state, target, repositoryBinding.defaultBranch);
  const tree = await requestJson(
    state,
    `${apiPrefix(target)}/git/trees/${firstHead.treeObjectId}?recursive=1`,
    "tree",
    RESOLVE_CONTRACT_V1.maximumTreeResponseBytes
  );
  const entries = new Map(validateRecursiveTree(tree, firstHead.treeObjectId).map((entry) => [entry.path, entry]));
  const schemaEntry = entries.get(repository.applicationV3SchemaPath);
  const compatibilityEntry = entries.get(APPLICANT_COMPATIBILITY_PATH) ?? null;
  const activeContractEntry = entries.get(LEGACY_ACTIVE_CONTRACT_PATH) ?? null;
  if (schemaEntry === undefined || (compatibilityEntry === null && activeContractEntry === null)) {
    throw applicantCompatibilityFailure("BUILDER_CENTRAL_COMPATIBILITY_MISMATCH");
  }

  const schemaBytes = (await resolveBlob(state, target, schemaEntry, MAXIMUM_SCHEMA_BYTES)).bytes;
  if (sha256(schemaBytes) !== repository.applicationV3SchemaSha256) {
    throw applicantCompatibilityFailure("BUILDER_CENTRAL_COMPATIBILITY_MISMATCH");
  }
  const compatibilityBytes = compatibilityEntry === null
    ? null
    : (await resolveBlob(state, target, compatibilityEntry, MAXIMUM_COMPATIBILITY_BYTES)).bytes;
  const activeContractBytes = compatibilityEntry !== null || activeContractEntry === null
    ? null
    : (await resolveBlob(state, target, activeContractEntry, MAXIMUM_COMPATIBILITY_BYTES)).bytes;
  const resolution = resolveApplicantCompatibilityContract({
    compatibilityBytes,
    activeContractBytes,
    expected: {
      applicationContractId: "public-pr-application-v3.1",
      applicationSchemaPath: repository.applicationV3SchemaPath,
      applicationSchemaSha256: repository.applicationV3SchemaSha256,
      builderProtocolVersion: BUILDER_PROTOCOL_VERSION,
      defaultBranch: repository.defaultBranch,
      legacyActiveContractId: "submit-launch",
      repositoryNumericId: repository.numericId,
      validatorPackage: LOCAL_APPLICANT_VALIDATOR_PACKAGE
    }
  });

  const finalHead = await resolveDefaultBranchHead(state, target, repositoryBinding.defaultBranch);
  if (
    finalHead.revisionObjectId !== firstHead.revisionObjectId
    || finalHead.treeObjectId !== firstHead.treeObjectId
  ) throw applicantCompatibilityFailure("BUILDER_CENTRAL_COMPATIBILITY_MISMATCH");
  const selectedBytes = compatibilityBytes ?? activeContractBytes;
  const contract = resolution.contract ?? resolution;
  return Object.freeze({
    ok: true,
    binding: Object.freeze({
      mode: resolution.mode,
      repository: repository.slug,
      repositoryId: repository.numericId,
      defaultBranch: repository.defaultBranch,
      centralBaseCommit: firstHead.revisionObjectId,
      centralBaseTree: firstHead.treeObjectId,
      contractPath: resolution.path,
      contractSha256: sha256(selectedBytes),
      applicationContractId: contract.application?.contractId ?? resolution.application.contractId,
      applicationSchemaPath: repository.applicationV3SchemaPath,
      applicationSchemaSha256: repository.applicationV3SchemaSha256,
      validatorPackage: contract.validatorPackage ?? null,
      capabilities: contract.capabilities ?? null,
      minimumBuilderProtocolVersion: contract.minimumBuilderProtocolVersion ?? null
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
        : "The protected Submit Launch compatibility contract could not be bound to one stable exact base.",
      repair: "Update the Builder or retry the same exact project after the protected compatibility read is available. No Draft write was attempted."
    });
  }
}

function applicantCompatibilityFailure(code) {
  const error = new Error("The protected Applicant compatibility binding is invalid or changed during resolution");
  error.code = code;
  return error;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
