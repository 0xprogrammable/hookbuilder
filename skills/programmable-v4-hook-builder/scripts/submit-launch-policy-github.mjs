import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import { normalizeContent } from "./github-application-normalizers.mjs";
import {
  normalizeGitCommit,
  normalizeRef,
  normalizeRepository,
  validateCentralRepository
} from "./github-application-normalizers.mjs";
import { createGhTransport } from "./github-application-transport-core.mjs";
import { createBoundedSemaphore, requestGitHubJson } from "./github-public-source-api.mjs";
import {
  createGitHubPublicFetchTransportV1,
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError
} from "./github-public-source-core.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  SUBMIT_LAUNCH_POLICY_PATH,
  SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID
} from "./registry-intake-contract.mjs";
import {
  MAX_SUBMIT_LAUNCH_POLICY_BYTES,
  MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
  parseAndBindSubmitLaunchPolicyContract,
  SubmitLaunchPolicyError
} from "./submit-launch-policy-contract.mjs";
import {
  assertManifestArtifactBytes,
  assertSubmitLaunchSnapshotBindingIntegrity,
  buildSubmitLaunchContractSnapshot,
  discoverSubmitLaunchV2Artifacts,
  MAX_ACTIVE_CONTRACT_BYTES,
  MAX_ACTIVE_CONTRACT_SCHEMA_BYTES,
  MAX_COMPATIBILITY_BYTES,
  MAX_COMPATIBILITY_SCHEMA_BYTES,
  parseSubmitLaunchCompatibilityV2,
  parseSubmitLaunchManifestBootstrap,
  parseSubmitLaunchManifestV2,
  parseSubmitLaunchManifestV2Bootstrap,
  SUBMIT_LAUNCH_ACTIVE_CONTRACT_V1_PATH,
  SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_PATH,
  unresolvedSubmitLaunchStage
} from "./submit-launch-contract-core.mjs";
import { createSubmitLaunchVerifiedCache } from "./submit-launch-policy-cache.mjs";
import {
  authenticatedReadUnavailable,
  MAX_RECURSIVE_TREE_BYTES,
  normalizeCurrentContractOptions,
  normalizePublicBlob,
  normalizeRecheckOptions,
  normalizeRecursiveTree,
  normalizeTree,
  publicRepositoryPath,
  readExactBlob,
  requireExactOptions,
  resolutionKey,
  resolvePath,
  validatePublicCommit,
  validatePublicReference,
  validatePublicRepository
} from "./submit-launch-policy-github-validation.mjs";

const OBJECT_ID = /^[0-9a-f]{40}$/u;
const REGULAR_BLOB_MODE = "100644";
const PUBLIC_POLICY_REQUEST_BUDGET = 8;
const PUBLIC_POLICY_RESPONSE_BYTE_BUDGET = 16 * 1024 * 1024;
const PUBLIC_CONTRACT_REQUEST_BUDGET = 24;
const PREFLIGHT_CONTEXT_KEYS = new Set([
  "authenticatedTransport",
  "cacheDirectory",
  "includeFullSnapshot",
  "publicTransport",
  "repositoryRoot",
  "routeState",
  "source",
  "stage"
]);
const inFlightContractResolutions = new Map();

export async function resolveSubmitLaunchPolicyFromVerifiedGitObjects(options) {
  requireExactOptions(options, ["baseCommit", "baseTree", "readTree", "readBlob"]);
  const { baseCommit, baseTree, readTree, readBlob } = options;
  if (
    !OBJECT_ID.test(baseCommit ?? "")
    || !OBJECT_ID.test(baseTree ?? "")
    || typeof readTree !== "function"
    || typeof readBlob !== "function"
  ) {
    fail("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID", "Exact base Git identity and bounded object readers are required.");
  }
  const [policyArtifact, schemaArtifact] = await resolveSubmitLaunchProtectedArtifactsFromVerifiedGitObjects({
    baseTree,
    requests: [
      { filePath: SUBMIT_LAUNCH_POLICY_PATH, maximumBytes: MAX_SUBMIT_LAUNCH_POLICY_BYTES },
      { filePath: SUBMIT_LAUNCH_POLICY_SCHEMA_PATH, maximumBytes: MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES }
    ],
    readTree,
    readBlob
  });
  return parseAndBindSubmitLaunchPolicyContract({
    baseCommit,
    baseTree,
    policyBytes: policyArtifact.bytes,
    policyGitBlobOid: policyArtifact.gitBlobOid,
    schemaBytes: schemaArtifact.bytes,
    schemaGitBlobOid: schemaArtifact.gitBlobOid
  });
}

export async function resolveSubmitLaunchProtectedArtifactsFromVerifiedGitObjects(options) {
  requireExactOptions(options, ["baseTree", "requests", "readTree", "readBlob"]);
  const { baseTree, requests, readTree, readBlob } = options;
  if (
    !OBJECT_ID.test(baseTree ?? "")
    || !Array.isArray(requests)
    || requests.length < 1
    || requests.length > 8
    || typeof readTree !== "function"
    || typeof readBlob !== "function"
  ) {
    fail("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID", "Exact protected-tree artifact readers are required.");
  }
  const normalizedRequests = requests.map((request) => {
    requireExactOptions(request, ["filePath", "maximumBytes"]);
    const { filePath, maximumBytes } = request;
    const segments = typeof filePath === "string" ? filePath.split("/") : [];
    if (
      typeof filePath !== "string"
      || filePath.length < 1
      || filePath.length > 1024
      || Buffer.byteLength(filePath, "utf8") > 4096
      || filePath.startsWith("/")
      || filePath.endsWith("/")
      || filePath.includes("\\")
      || filePath.normalize("NFC") !== filePath
      || hasForbiddenInvisibleOrBidi(filePath)
      || segments.some((segment) => segment.length < 1 || segment === "." || segment === "..")
      || !Number.isSafeInteger(maximumBytes)
      || maximumBytes < 2
      || maximumBytes > 16 * 1024 * 1024
    ) {
      fail("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID", "Protected-tree artifact requests are invalid.");
    }
    return Object.freeze({ filePath, maximumBytes });
  });
  if (new Set(normalizedRequests.map(({ filePath }) => filePath)).size !== normalizedRequests.length) {
    fail("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID", "Protected-tree artifact paths must be unique.");
  }
  const treeCache = new Map();
  const loadTree = async (treeObjectId) => {
    if (treeCache.has(treeObjectId)) return treeCache.get(treeObjectId);
    const tree = normalizeTree(await readTree(treeObjectId), treeObjectId);
    treeCache.set(treeObjectId, tree);
    return tree;
  };
  const artifacts = [];
  for (const { filePath, maximumBytes } of normalizedRequests) {
    const entry = await resolvePath({ baseTree, filePath, loadTree });
    const bytes = await readExactBlob({ entry, filePath, maximumBytes, readBlob });
    artifacts.push(Object.freeze({ filePath, gitBlobOid: entry.sha, bytes }));
  }
  return Object.freeze(artifacts);
}

export async function resolveSubmitLaunchPolicyWithTransport(options) {
  requireExactOptions(options, ["transport"]);
  const { transport } = options;
  if (
    transport === null
    || typeof transport !== "object"
    || typeof transport.getRepository !== "function"
    || typeof transport.getRef !== "function"
    || typeof transport.getGitCommit !== "function"
    || typeof transport.getGitTree !== "function"
    || typeof transport.getContent !== "function"
  ) {
    fail("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID", "The fixed Submit Launch GitHub read transport is required.");
  }
  let baseCommit;
  let baseTree;
  try {
    const repository = normalizeRepository(
      await transport.getRepository(SUBMIT_LAUNCH_REPOSITORY),
      "Submit Launch policy repository"
    );
    validateCentralRepository(repository);
    const reference = normalizeRef(
      await transport.getRef(SUBMIT_LAUNCH_REPOSITORY, SUBMIT_LAUNCH_BASE_BRANCH),
      SUBMIT_LAUNCH_BASE_BRANCH
    );
    const commit = normalizeGitCommit(
      await transport.getGitCommit(SUBMIT_LAUNCH_REPOSITORY, reference.commit),
      "Submit Launch policy base commit"
    );
    if (commit.sha !== reference.commit) {
      fail(
        "SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID",
        "The fixed Submit Launch branch ref and commit response disagree."
      );
    }
    baseCommit = commit.sha;
    baseTree = commit.tree;
  } catch (error) {
    if (error instanceof SubmitLaunchPolicyError) throw error;
    fail(
      "SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID",
      "The fixed Submit Launch repository, branch, commit, or tree identity is invalid.",
      error
    );
  }
  return resolveSubmitLaunchPolicyFromVerifiedGitObjects({
    baseCommit,
    baseTree,
    readTree: (tree) => transport.getGitTree(SUBMIT_LAUNCH_REPOSITORY, tree, { recursive: false }),
    readBlob: async (blob, filePath) => {
      const maximum = filePath === SUBMIT_LAUNCH_POLICY_PATH
        ? MAX_SUBMIT_LAUNCH_POLICY_BYTES
        : MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES;
      const response = await transport.getContent(SUBMIT_LAUNCH_REPOSITORY, filePath, baseCommit);
      if (response?.sha !== blob) {
        fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "GitHub content identity disagrees with the protected tree.");
      }
      return normalizeContent(response, filePath, maximum);
    }
  });
}

export async function resolveSubmitLaunchPolicyWithPublicTransport(options = {}) {
  if (
    options === null
    || typeof options !== "object"
    || Array.isArray(options)
    || Object.keys(options).some((key) => key !== "transport")
    || (options.transport !== undefined && typeof options.transport !== "function")
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "public Submit Launch policy options are invalid");
  }
  const state = {
    deadline: performance.now() + GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs,
    requestsRemaining: PUBLIC_POLICY_REQUEST_BUDGET,
    responseBytesRemaining: PUBLIC_POLICY_RESPONSE_BYTE_BUDGET,
    treeRequestSemaphore: createBoundedSemaphore(1),
    transport: options.transport ?? createGitHubPublicFetchTransportV1()
  };
  const repository = await requestGitHubJson(publicRepositoryPath(), "repository", state);
  validatePublicRepository(repository);
  const reference = await requestGitHubJson(
    `${publicRepositoryPath()}/git/ref/heads/${SUBMIT_LAUNCH_BASE_BRANCH}`,
    "commit",
    state
  );
  const baseCommit = validatePublicReference(reference);
  const commit = await requestGitHubJson(
    `${publicRepositoryPath()}/git/commits/${baseCommit}`,
    "commit",
    state
  );
  const baseTree = validatePublicCommit(commit, baseCommit);

  return resolveSubmitLaunchPolicyFromVerifiedGitObjects({
    baseCommit,
    baseTree,
    readTree: (tree) => requestGitHubJson(`${publicRepositoryPath()}/git/trees/${tree}`, "tree", state),
    readBlob: async (blob, filePath) => normalizePublicBlob(
      await requestGitHubJson(`${publicRepositoryPath()}/git/blobs/${blob}`, "blob", state),
      blob,
      filePath
    )
  });
}

export async function resolveCurrentSubmitLaunchPolicy(options = {}) {
  const detailed = await resolveCurrentSubmitLaunchContractDetailed({
    ...options,
    includeFullSnapshot: false,
    routeState: "unresolved",
    stage: "build"
  });
  return detailed.policyContract;
}

export async function resolveCurrentSubmitLaunchContract(options = {}) {
  const normalized = normalizeCurrentContractOptions(options);
  const key = resolutionKey(normalized);
  if (inFlightContractResolutions.has(key)) return inFlightContractResolutions.get(key);
  const promise = resolveCurrentSubmitLaunchContractDetailed(normalized).then(({ snapshot }) => snapshot);
  inFlightContractResolutions.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlightContractResolutions.get(key) === promise) inFlightContractResolutions.delete(key);
  }
}

export async function assertCurrentSubmitLaunchContractCurrent(snapshotOrBinding, options = {}) {
  const binding = assertSubmitLaunchSnapshotBindingIntegrity(
    snapshotOrBinding?.snapshotBinding ?? snapshotOrBinding
  );
  const normalized = normalizeRecheckOptions(options);
  let observed;
  try {
    observed = await readRecheckedIdentity(createAuthenticatedContractReader(
      normalized.authenticatedTransport ?? createGhTransport()
    ));
  } catch (error) {
    if (!authenticatedReadUnavailable(error)) throw error;
    observed = await readRecheckedIdentity(createPublicContractReader(normalized.publicTransport));
  }
  if (observed.baseCommit !== binding.baseCommit || observed.baseTree !== binding.baseTree) {
    fail(
      "SUBMIT_LAUNCH_CONTRACT_DRIFT",
      "Submit Launch main changed after evaluation; resolve and evaluate the current contract again."
    );
  }
  return Object.freeze({
    status: "CURRENT",
    repository: SUBMIT_LAUNCH_REPOSITORY,
    numericRepositoryId: SUBMIT_LAUNCH_REPOSITORY_ID,
    branch: SUBMIT_LAUNCH_BASE_BRANCH,
    baseCommit: observed.baseCommit,
    baseTree: observed.baseTree,
    snapshotSha256: binding.snapshotSha256,
    refChecked: true
  });
}

export async function preflightCurrentSubmitLaunchRequirements(options = {}) {
  if (!isOptionObject(options) || Object.keys(options).some((key) => !PREFLIGHT_CONTEXT_KEYS.has(key))) {
    return preflightFailure("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID");
  }
  const stage = options.stage ?? "submit";
  const routeState = options.routeState ?? "unresolved";
  try {
    const resolved = await resolveCurrentSubmitLaunchContract(Object.fromEntries(
      Object.entries({
        authenticatedTransport: options.authenticatedTransport,
        cacheDirectory: options.cacheDirectory,
        includeFullSnapshot: options.includeFullSnapshot,
        publicTransport: options.publicTransport,
        routeState,
        stage
      }).filter(([, value]) => value !== undefined)
    ));
    return Object.freeze({
      ok: true,
      binding: resolved.snapshotBinding,
      currentness: resolved.currentness,
      applicationContract: resolved.applicationContract,
      projectStage: resolved.projectStage,
      authority: resolved.authority
    });
  } catch (error) {
    if (stage === "build") {
      return Object.freeze({
        ok: true,
        binding: null,
        currentness: Object.freeze({ status: "UNRESOLVED", refCheckedBefore: false, refCheckedAfter: false }),
        applicationContract: null,
        projectStage: unresolvedSubmitLaunchStage({ stage, routeState }),
        authority: unresolvedAuthority(),
        warning: Object.freeze({
          code: typeof error?.code === "string" ? error.code : "CURRENT_POLICY_UNAVAILABLE",
          summary: "Current Submit Launch requirements are unresolved; local build work may continue without launch claims."
        })
      });
    }
    return preflightFailure(typeof error?.code === "string" ? error.code : "CURRENT_POLICY_UNAVAILABLE");
  }
}

async function resolveCurrentSubmitLaunchContractDetailed(options) {
  const normalized = normalizeCurrentContractOptions(options);
  try {
    return await resolveContractWithReader(
      createAuthenticatedContractReader(normalized.authenticatedTransport ?? createGhTransport()),
      normalized,
      0
    );
  } catch (error) {
    if (!authenticatedReadUnavailable(error)) throw error;
    return resolveContractWithReader(createPublicContractReader(normalized.publicTransport), normalized, 0);
  }
}

async function resolveContractWithReader(reader, options, retryCount) {
  const identity = await readCurrentIdentity(reader);
  const cache = createSubmitLaunchVerifiedCache({ directory: options.cacheDirectory });
  let protectedTree;
  const cachedTreeBytes = await cache.readTree(identity.baseTree, MAX_RECURSIVE_TREE_BYTES);
  if (cachedTreeBytes !== null) {
    try {
      protectedTree = normalizeRecursiveTree(parseBoundedStrictJsonBytes(cachedTreeBytes, {
        maxSourceBytes: MAX_RECURSIVE_TREE_BYTES,
        maxDepth: 16,
        maxNodes: 600_000,
        maxNumberCharacters: 128
      }), identity.baseTree);
    } catch {
      cache.rejectHit();
      protectedTree = null;
    }
  }
  if (protectedTree === undefined || protectedTree === null) {
    protectedTree = normalizeRecursiveTree(
      await reader.readRecursiveTree(identity.baseTree),
      identity.baseTree
    );
    await cache.writeTree(identity.baseTree, protectedTree.cacheBytes);
  }
  const readArtifact = async (filePath, maximumBytes) => {
    const entry = protectedTree.entries.get(filePath);
    if (entry === undefined || entry.type !== "blob" || entry.mode !== REGULAR_BLOB_MODE) {
      fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", `Protected path ${filePath} is not one regular Git blob.`);
    }
    let bytes = await cache.read(entry.sha, maximumBytes);
    if (bytes === null) {
      bytes = await readExactBlob({
        entry,
        filePath,
        maximumBytes,
        readBlob: (blob) => reader.readBlob(blob, filePath, maximumBytes, identity.baseCommit)
      });
      await cache.write(entry.sha, bytes);
    }
    return Object.freeze({
      filePath,
      gitBlobOid: entry.sha,
      bytes,
      sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`
    });
  };

  const activeContractV1 = await readArtifact(
    SUBMIT_LAUNCH_ACTIVE_CONTRACT_V1_PATH,
    MAX_ACTIVE_CONTRACT_BYTES
  );
  const manifestV1Result = parseSubmitLaunchManifestBootstrap(activeContractV1.bytes);
  const activeContractV2 = await readArtifact(
    SUBMIT_LAUNCH_ACTIVE_CONTRACT_V2_PATH,
    MAX_ACTIVE_CONTRACT_BYTES
  );
  assertManifestArtifactBytes(manifestV1Result.activeV2, activeContractV2.bytes, "active contract V2");
  const manifestV2Bootstrap = parseSubmitLaunchManifestV2Bootstrap(activeContractV2.bytes);
  const discovered = discoverSubmitLaunchV2Artifacts(manifestV2Bootstrap);
  const activeContractV2Schema = await readArtifact(
    discovered.activeContractV2Schema.path,
    MAX_ACTIVE_CONTRACT_SCHEMA_BYTES
  );
  assertManifestArtifactBytes(
    discovered.activeContractV2Schema,
    activeContractV2Schema.bytes,
    "active contract V2 schema"
  );
  const manifestV2Result = parseSubmitLaunchManifestV2({
    bytes: activeContractV2.bytes,
    schemaBytes: activeContractV2Schema.bytes
  });
  const verifiedDiscovery = discoverSubmitLaunchV2Artifacts(manifestV2Result.manifest);

  const compatibilityArtifact = await readArtifact(verifiedDiscovery.compatibility.path, MAX_COMPATIBILITY_BYTES);
  const compatibilitySchemaArtifact = await readArtifact(
    verifiedDiscovery.compatibilitySchema.path,
    MAX_COMPATIBILITY_SCHEMA_BYTES
  );
  const policyArtifact = await readArtifact(verifiedDiscovery.policy.path, MAX_SUBMIT_LAUNCH_POLICY_BYTES);
  const policySchemaArtifact = await readArtifact(
    verifiedDiscovery.policySchema.path,
    MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES
  );
  for (const [declaration, artifact, label] of [
    [verifiedDiscovery.compatibility, compatibilityArtifact, "Applicant Compatibility V2"],
    [verifiedDiscovery.compatibilitySchema, compatibilitySchemaArtifact, "Applicant Compatibility V2 schema"],
    [verifiedDiscovery.policy, policyArtifact, "launch policy"],
    [verifiedDiscovery.policySchema, policySchemaArtifact, "launch policy schema"]
  ]) assertManifestArtifactBytes(declaration, artifact.bytes, label);

  const compatibilityResult = parseSubmitLaunchCompatibilityV2({
    bytes: compatibilityArtifact.bytes,
    schemaBytes: compatibilitySchemaArtifact.bytes,
    manifest: manifestV2Result.manifest
  });
  const policyContract = parseAndBindSubmitLaunchPolicyContract({
    baseCommit: identity.baseCommit,
    baseTree: identity.baseTree,
    policyBytes: policyArtifact.bytes,
    policyGitBlobOid: policyArtifact.gitBlobOid,
    schemaBytes: policySchemaArtifact.bytes,
    schemaGitBlobOid: policySchemaArtifact.gitBlobOid
  });

  const finalCommit = await reader.readRef();
  if (finalCommit !== identity.baseCommit) {
    if (retryCount === 0) return resolveContractWithReader(reader, options, 1);
    fail(
      "SUBMIT_LAUNCH_CONTRACT_UNSTABLE",
      "Submit Launch main moved during both bounded resolution attempts."
    );
  }
  const receipt = cache.receipt();
  const snapshot = buildSubmitLaunchContractSnapshot({
    baseCommit: identity.baseCommit,
    baseTree: identity.baseTree,
    artifacts: {
      activeContractV1,
      activeContractV2,
      activeContractV2Schema,
      compatibility: compatibilityArtifact,
      compatibilitySchema: compatibilitySchemaArtifact
    },
    manifestV1: manifestV1Result.manifest,
    manifestV2: manifestV2Result.manifest,
    compatibility: compatibilityResult.compatibility,
    policyContract,
    stage: options.stage,
    routeState: options.routeState,
    currentness: {
      status: "CURRENT",
      refCheckedBefore: true,
      refCheckedAfter: true,
      retryCount,
      cacheStatus: receipt.cacheStatus,
      cacheHits: receipt.cacheHits,
      cacheMisses: receipt.cacheMisses,
      cacheWrites: receipt.cacheWrites
    },
    includeFullSnapshot: options.includeFullSnapshot
  });
  return Object.freeze({ snapshot, policyContract });
}

function createAuthenticatedContractReader(transport) {
  if (
    transport === null
    || typeof transport !== "object"
    || typeof transport.getRepository !== "function"
    || typeof transport.getRef !== "function"
    || typeof transport.getGitCommit !== "function"
    || typeof transport.getGitTree !== "function"
    || typeof transport.getContent !== "function"
  ) fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Authenticated Submit Launch transport is invalid.");
  let repositoryCheck;
  const ensureRepository = () => {
    if (repositoryCheck === undefined) {
      repositoryCheck = Promise.resolve(transport.getRepository(SUBMIT_LAUNCH_REPOSITORY)).then((response) => {
        const repository = normalizeRepository(response, "Submit Launch contract repository");
        validateCentralRepository(repository);
        return true;
      });
    }
    return repositoryCheck;
  };
  const readRef = async () => {
    const reference = normalizeRef(
      await transport.getRef(SUBMIT_LAUNCH_REPOSITORY, SUBMIT_LAUNCH_BASE_BRANCH),
      SUBMIT_LAUNCH_BASE_BRANCH
    );
    return reference.commit;
  };
  return Object.freeze({
    async readIdentity() {
      try {
        await ensureRepository();
        const referenceCommit = await readRef();
        const commit = normalizeGitCommit(
          await transport.getGitCommit(SUBMIT_LAUNCH_REPOSITORY, referenceCommit),
          "Submit Launch contract commit"
        );
        if (commit.sha !== referenceCommit) {
          fail("SUBMIT_LAUNCH_CONTRACT_TRUST_ROOT_MISMATCH", "Submit Launch ref and commit disagree.");
        }
        return Object.freeze({ baseCommit: commit.sha, baseTree: commit.tree });
      } catch (error) {
        if (error instanceof SubmitLaunchPolicyError) throw error;
        fail("SUBMIT_LAUNCH_CONTRACT_TRUST_ROOT_MISMATCH", "Submit Launch trust root is unavailable or changed.", error);
      }
    },
    readRef,
    readRecursiveTree(tree) {
      return transport.getGitTree(SUBMIT_LAUNCH_REPOSITORY, tree, { recursive: true });
    },
    async readBlob(blob, filePath, maximumBytes, baseCommit) {
      const response = await transport.getContent(SUBMIT_LAUNCH_REPOSITORY, filePath, baseCommit);
      if (response?.sha !== blob) {
        fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", `GitHub content identity disagrees for ${filePath}.`);
      }
      return normalizeContent(response, filePath, maximumBytes);
    }
  });
}

function createPublicContractReader(publicTransport) {
  if (publicTransport !== undefined && typeof publicTransport !== "function") {
    fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Public Submit Launch transport is invalid.");
  }
  const state = {
    deadline: performance.now() + GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs,
    requestsRemaining: PUBLIC_CONTRACT_REQUEST_BUDGET,
    responseBytesRemaining: PUBLIC_POLICY_RESPONSE_BYTE_BUDGET,
    treeRequestSemaphore: createBoundedSemaphore(1),
    transport: publicTransport ?? createGitHubPublicFetchTransportV1()
  };
  let repositoryCheck;
  const ensureRepository = () => {
    if (repositoryCheck === undefined) {
      repositoryCheck = requestGitHubJson(publicRepositoryPath(), "repository", state).then((repository) => {
        validatePublicRepository(repository);
        return true;
      });
    }
    return repositoryCheck;
  };
  const readRef = async () => {
    const reference = await requestGitHubJson(
      `${publicRepositoryPath()}/git/ref/heads/${SUBMIT_LAUNCH_BASE_BRANCH}`,
      "commit",
      state
    );
    return validatePublicReference(reference);
  };
  return Object.freeze({
    async readIdentity() {
      await ensureRepository();
      const baseCommit = await readRef();
      const commit = await requestGitHubJson(
        `${publicRepositoryPath()}/git/commits/${baseCommit}`,
        "commit",
        state
      );
      return Object.freeze({ baseCommit, baseTree: validatePublicCommit(commit, baseCommit) });
    },
    readRef,
    readRecursiveTree(tree) {
      return requestGitHubJson(`${publicRepositoryPath()}/git/trees/${tree}?recursive=1`, "tree", state);
    },
    async readBlob(blob, filePath, maximumBytes) {
      return normalizePublicBlob(
        await requestGitHubJson(`${publicRepositoryPath()}/git/blobs/${blob}`, "blob", state),
        blob,
        filePath,
        maximumBytes
      );
    }
  });
}

async function readCurrentIdentity(reader) {
  const identity = await reader.readIdentity();
  if (!OBJECT_ID.test(identity?.baseCommit ?? "") || !OBJECT_ID.test(identity?.baseTree ?? "")) {
    fail("SUBMIT_LAUNCH_CONTRACT_TRUST_ROOT_MISMATCH", "Submit Launch exact commit and tree are invalid.");
  }
  return identity;
}

async function readRecheckedIdentity(reader) {
  const identity = await readCurrentIdentity(reader);
  if (await reader.readRef() !== identity.baseCommit) {
    fail("SUBMIT_LAUNCH_CONTRACT_DRIFT", "Submit Launch main moved during the final currentness check.");
  }
  return identity;
}

function preflightFailure(code) {
  return Object.freeze({
    ok: false,
    code,
    summary: "The exact current Submit Launch contract could not be bound to one protected main revision.",
    repair: "Retry the same project after Submit Launch requirements are available. No Draft write was attempted."
  });
}

function unresolvedAuthority() {
  return Object.freeze({
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

function isOptionObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message, cause) {
  throw new SubmitLaunchPolicyError(code, message, cause === undefined ? undefined : { cause });
}
