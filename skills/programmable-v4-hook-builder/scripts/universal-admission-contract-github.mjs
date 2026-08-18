import { performance } from "node:perf_hooks";

import { createGitHubPublicFetchTransportV1 } from "./github-public-source-core.mjs";
import { SUBMIT_LAUNCH_INTAKE_CONTRACT } from "./registry-intake-contract.mjs";
import { RESOLVE_CONTRACT_V1 } from "./resolve-contract-definitions.mjs";
import {
  requestJson,
  resolveBlob,
  validateExactCommit,
  validateRecursiveTree,
  validateRepositoryMetadata
} from "./resolve-contract-github.mjs";
import { apiPrefix, sha256 } from "./resolve-contract-shared.mjs";
import { normalizeContractRepositoryV1 } from "./resolve-contract-validation.mjs";
import {
  UNIVERSAL_ADMISSION_CONTRACT_PATH,
  UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID,
  UniversalAdmissionContractError,
  digestBytes,
  parseUniversalAdmissionContractBytes,
  verifyUniversalAdmissionSchemaId
} from "./universal-admission-contract-core.mjs";
import { canonicalJson } from "./submission-core.mjs";

const MAXIMUM_CONTRACT_BYTES = 256 * 1024;
const MAXIMUM_CLOSURE_BLOB_BYTES = 2 * 1024 * 1024;
const FROZEN_SOURCE = SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.universalAdmissionContract;

export const PROTECTED_UNIVERSAL_ADMISSION_SOURCE = Object.freeze({
  repository: "0xprogrammable/submit-launch",
  repositoryId: "1320171831",
  defaultBranch: "main",
  revisionObjectId: FROZEN_SOURCE.revisionObjectId,
  treeObjectId: FROZEN_SOURCE.treeObjectId,
  contractPath: FROZEN_SOURCE.path,
  contractSha256: FROZEN_SOURCE.sha256
});

export async function resolveProtectedUniversalAdmissionContract({
  transport = undefined,
  timeoutMs = RESOLVE_CONTRACT_V1.defaultTimeoutMs
} = {}) {
  return resolveUniversalAdmissionContractAtExactSource({
    source: PROTECTED_UNIVERSAL_ADMISSION_SOURCE,
    timeoutMs,
    transport
  });
}

export async function resolveUniversalAdmissionContractAtExactSource({
  source,
  transport = undefined,
  timeoutMs = RESOLVE_CONTRACT_V1.defaultTimeoutMs
} = {}) {
  validateSource(source);
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < RESOLVE_CONTRACT_V1.minimumTimeoutMs
    || timeoutMs > RESOLVE_CONTRACT_V1.maximumTimeoutMs
    || (transport !== undefined && typeof transport !== "function")
  ) throw new TypeError("Universal Admission contract GitHub options are outside the supported bounds");

  const target = normalizeContractRepositoryV1(source.repository);
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
  const repository = validateRepositoryMetadata(metadata, target);
  if (
    repository.numericRepositoryId !== source.repositoryId
    || repository.defaultBranch !== source.defaultBranch
  ) fail("UNIVERSAL_ADMISSION_REPOSITORY_MISMATCH", "Protected Universal Admission repository identity does not match");

  const exactCommit = await requestJson(
    state,
    `${apiPrefix(target)}/git/commits/${source.revisionObjectId}`,
    "exact-contract-commit",
    RESOLVE_CONTRACT_V1.maximumJsonResponseBytes
  );
  validateExactCommit(exactCommit, {
    revisionObjectId: source.revisionObjectId,
    treeObjectId: source.treeObjectId
  }, target);
  const tree = await requestJson(
    state,
    `${apiPrefix(target)}/git/trees/${source.treeObjectId}?recursive=1`,
    "exact-contract-tree",
    RESOLVE_CONTRACT_V1.maximumTreeResponseBytes
  );
  const entries = new Map(validateRecursiveTree(tree, source.treeObjectId).map((entry) => [entry.path, entry]));
  const contractEntry = entries.get(source.contractPath);
  if (contractEntry === undefined) fail("UNIVERSAL_ADMISSION_CONTRACT_NOT_FOUND", "Protected Universal Admission contract is absent from the exact tree");
  const contractBytes = (await resolveBlob(state, target, contractEntry, MAXIMUM_CONTRACT_BYTES)).bytes;
  if (digestBytes(contractBytes) !== source.contractSha256) {
    fail("UNIVERSAL_ADMISSION_CONTRACT_BINDING_MISMATCH", "Protected Universal Admission contract bytes do not match the frozen source binding");
  }
  const parsed = parseUniversalAdmissionContractBytes(contractBytes);
  const declarations = closureDeclarations(parsed.contract);
  const closure = [];
  for (const declaration of declarations) {
    const entry = entries.get(declaration.path);
    if (entry === undefined) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_CLOSURE_MISMATCH", `${declaration.path} is absent from the exact protected tree`);
    }
    const bytes = (await resolveBlob(state, target, entry, MAXIMUM_CLOSURE_BLOB_BYTES)).bytes;
    const observedSha256 = sha256(bytes);
    if (observedSha256 !== declaration.sha256) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_CLOSURE_MISMATCH", `${declaration.path} does not match its declared SHA-256`);
    }
    if (declaration.schemaId !== null) {
      verifyUniversalAdmissionSchemaId(bytes, declaration.schemaId, declaration.path);
    }
    closure.push(Object.freeze({
      role: declaration.role,
      id: declaration.id,
      path: declaration.path,
      schemaId: declaration.schemaId,
      sha256: observedSha256,
      gitObjectId: entry.objectId,
      gitMode: entry.mode,
      byteLength: bytes.length
    }));
  }
  await verifyProtectedDefaultBranchReference(state, target, source);
  if (state.requests > RESOLVE_CONTRACT_V1.maximumRequests) {
    fail("UNIVERSAL_ADMISSION_REQUEST_BUDGET_EXHAUSTED", "Universal Admission contract resolution exceeded its request budget");
  }
  const closureSha256 = digestBytes(Buffer.from(`${canonicalJson(closure)}\n`, "utf8"));
  const evidence = Object.freeze({
    repository: source.repository,
    repositoryId: source.repositoryId,
    defaultBranch: source.defaultBranch,
    centralBaseCommit: source.revisionObjectId,
    centralBaseTree: source.treeObjectId,
    contractPath: source.contractPath,
    contractSha256: parsed.sha256,
    contractGitObjectId: contractEntry.objectId,
    contractByteLength: contractBytes.length,
    closureSha256,
    closureArtifactCount: closure.length,
    exactGitObjectsVerified: true,
    protectedRefVerified: true,
    contentsApiUsed: false
  });
  return Object.freeze({
    ok: true,
    binding: Object.freeze({
      contract: parsed.contract,
      closure: Object.freeze(closure),
      evidence,
      queueUsable: false,
      authority: parsed.contract.authority
    })
  });
}

async function verifyProtectedDefaultBranchReference(state, target, source) {
  const encodedBranch = source.defaultBranch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const reference = await requestJson(
    state,
    `${apiPrefix(target)}/git/ref/heads/${encodedBranch}`,
    "protected-default-branch-ref",
    RESOLVE_CONTRACT_V1.maximumJsonResponseBytes
  );
  if (
    reference?.ref !== `refs/heads/${source.defaultBranch}`
    || reference?.object?.type !== "commit"
    || reference?.object?.sha !== source.revisionObjectId
  ) {
    fail(
      "UNIVERSAL_ADMISSION_PROTECTED_REF_MISMATCH",
      "Protected Universal Admission default-branch ref does not match the frozen exact revision"
    );
  }
}

export async function preflightProtectedUniversalAdmissionContract(options = {}) {
  try {
    return await resolveProtectedUniversalAdmissionContract(options);
  } catch (error) {
    return Object.freeze({
      ok: false,
      code: error?.code ?? "UNIVERSAL_ADMISSION_CONTRACT_UNAVAILABLE",
      summary: "The frozen protected Universal Admission contract and its same-tree blob closure could not be verified exactly.",
      repair: "Retry or update the Builder only after the protected contract binding is available. No confirmation, workspace write, queue request, or GitHub mutation was attempted."
    });
  }
}

function closureDeclarations(contract) {
  const declarations = [
    declaration("contract-schema", null, contract.contractSchema, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID),
    declaration("contract-core", null, contract.contractCore, null),
    declaration("contract-publisher", null, contract.contractPublisher, null),
    ...contract.schemas.map((entry) => declaration("schema", entry.id, entry, entry.schemaId)),
    ...contract.referenceImplementation.artifacts.map((entry) => declaration("reference-artifact", null, entry, null))
  ];
  const paths = new Set();
  for (const item of declarations) {
    if (paths.has(item.path) || item.path === UNIVERSAL_ADMISSION_CONTRACT_PATH) {
      fail("UNIVERSAL_ADMISSION_CONTRACT_CLOSURE_MISMATCH", "Universal Admission contract closure paths are not unique");
    }
    paths.add(item.path);
  }
  return declarations;
}

function declaration(role, id, value, schemaId) {
  return Object.freeze({ role, id, path: value.path, sha256: value.sha256, schemaId });
}

function validateSource(value) {
  const expectedKeys = [
    "contractPath", "contractSha256", "defaultBranch", "repository", "repositoryId", "revisionObjectId", "treeObjectId"
  ];
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== expectedKeys.sort().join("\0")
    || value.repository !== SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.slug
    || value.repositoryId !== SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.numericId
    || value.defaultBranch !== SUBMIT_LAUNCH_INTAKE_CONTRACT.repository.defaultBranch
    || value.contractPath !== UNIVERSAL_ADMISSION_CONTRACT_PATH
    || !/^[0-9a-f]{40}$/u.test(value.revisionObjectId ?? "")
    || !/^[0-9a-f]{40}$/u.test(value.treeObjectId ?? "")
    || !/^sha256:[0-9a-f]{64}$/u.test(value.contractSha256 ?? "")
  ) throw new TypeError("Universal Admission exact source binding is invalid");
}

function fail(code, message) {
  throw new UniversalAdmissionContractError(code, message);
}
