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
import {
  assertPlainObject,
  normalizeDisplayText,
  normalizeGitObjectId,
  normalizeOpaqueId,
  validateRepositoryHtmlUrl
} from "./github-public-source-shared.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import {
  SUBMIT_LAUNCH_API_URL,
  SUBMIT_LAUNCH_POLICY_PATH,
  SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  SUBMIT_LAUNCH_REPOSITORY_NAME,
  SUBMIT_LAUNCH_REPOSITORY_OWNER
} from "./registry-intake-contract.mjs";
import {
  MAX_SUBMIT_LAUNCH_POLICY_BYTES,
  MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
  parseAndBindSubmitLaunchPolicyContract,
  SubmitLaunchPolicyError
} from "./submit-launch-policy-contract.mjs";

const OBJECT_ID = /^[0-9a-f]{40}$/u;
const REGULAR_BLOB_MODE = "100644";
const PUBLIC_POLICY_REQUEST_BUDGET = 8;
const PUBLIC_POLICY_RESPONSE_BYTE_BUDGET = 16 * 1024 * 1024;
const AUTHENTICATED_READ_FALLBACK_CODES = new Set([
  "GITHUB_GET_RETRY_EXHAUSTED",
  "GITHUB_RATE_LIMITED",
  "GITHUB_REQUEST_FAILED"
]);

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
  const treeCache = new Map();
  const loadTree = async (treeObjectId) => {
    if (treeCache.has(treeObjectId)) return treeCache.get(treeObjectId);
    const tree = normalizeTree(await readTree(treeObjectId), treeObjectId);
    treeCache.set(treeObjectId, tree);
    return tree;
  };
  const policyEntry = await resolvePath({ baseTree, filePath: SUBMIT_LAUNCH_POLICY_PATH, loadTree });
  const schemaEntry = await resolvePath({ baseTree, filePath: SUBMIT_LAUNCH_POLICY_SCHEMA_PATH, loadTree });
  const policyBytes = await readExactBlob({
    entry: policyEntry,
    filePath: SUBMIT_LAUNCH_POLICY_PATH,
    maximumBytes: MAX_SUBMIT_LAUNCH_POLICY_BYTES,
    readBlob
  });
  const schemaBytes = await readExactBlob({
    entry: schemaEntry,
    filePath: SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
    maximumBytes: MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
    readBlob
  });
  return parseAndBindSubmitLaunchPolicyContract({
    baseCommit,
    baseTree,
    policyBytes,
    policyGitBlobOid: policyEntry.sha,
    schemaBytes,
    schemaGitBlobOid: schemaEntry.sha
  });
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
  if (
    options === null
    || typeof options !== "object"
    || Array.isArray(options)
    || Object.keys(options).some((key) => !new Set(["authenticatedTransport", "publicTransport"]).has(key))
    || (options.authenticatedTransport !== undefined && (options.authenticatedTransport === null || typeof options.authenticatedTransport !== "object"))
    || (options.publicTransport !== undefined && typeof options.publicTransport !== "function")
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "current Submit Launch policy options are invalid");
  }
  try {
    return await resolveSubmitLaunchPolicyWithTransport({
      transport: options.authenticatedTransport ?? createGhTransport()
    });
  } catch (error) {
    if (!AUTHENTICATED_READ_FALLBACK_CODES.has(error?.cause?.code)) throw error;
    return resolveSubmitLaunchPolicyWithPublicTransport(
      options.publicTransport === undefined ? {} : { transport: options.publicTransport }
    );
  }
}

function publicRepositoryPath() {
  return new URL(SUBMIT_LAUNCH_API_URL).pathname;
}

function validatePublicRepository(value) {
  assertPlainObject(value, "GITHUB_PROTOCOL_ERROR", "Submit Launch repository response must be an object");
  const repositoryId = normalizeOpaqueId(value.id, "Submit Launch repository id", "GITHUB_PROTOCOL_ERROR", true);
  if (repositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID) {
    throw new GitHubPublicSourceError("GITHUB_REPOSITORY_ID_MISMATCH", "Submit Launch repository identity did not match");
  }
  if (value.private !== false || value.visibility !== "public") {
    throw new GitHubPublicSourceError("GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE", "Submit Launch public repository is unavailable");
  }
  if (value.full_name !== SUBMIT_LAUNCH_REPOSITORY) {
    throw new GitHubPublicSourceError("GITHUB_REPOSITORY_LOCATOR_MISMATCH", "Submit Launch repository locator did not match");
  }
  validateRepositoryHtmlUrl(value.html_url, SUBMIT_LAUNCH_REPOSITORY_OWNER, SUBMIT_LAUNCH_REPOSITORY_NAME);
  if (normalizeDisplayText(value.default_branch, 255, "Submit Launch default branch") !== SUBMIT_LAUNCH_BASE_BRANCH) {
    throw new GitHubPublicSourceError("GITHUB_REPOSITORY_LOCATOR_MISMATCH", "Submit Launch default branch did not match");
  }
}

function validatePublicReference(value) {
  assertPlainObject(value, "GITHUB_PROTOCOL_ERROR", "Submit Launch branch response must be an object");
  assertPlainObject(value.object, "GITHUB_PROTOCOL_ERROR", "Submit Launch branch object must be an object");
  if (value.ref !== `refs/heads/${SUBMIT_LAUNCH_BASE_BRANCH}` || value.object.type !== "commit") {
    throw new GitHubPublicSourceError("GITHUB_COMMIT_MISMATCH", "Submit Launch branch did not resolve to its exact commit");
  }
  return normalizeGitObjectId(value.object.sha, "Submit Launch branch commit", "GITHUB_PROTOCOL_ERROR");
}

function validatePublicCommit(value, expectedCommit) {
  assertPlainObject(value, "GITHUB_PROTOCOL_ERROR", "Submit Launch commit response must be an object");
  assertPlainObject(value.tree, "GITHUB_PROTOCOL_ERROR", "Submit Launch commit tree must be an object");
  const commit = normalizeGitObjectId(value.sha, "Submit Launch commit", "GITHUB_PROTOCOL_ERROR");
  if (commit !== expectedCommit) {
    throw new GitHubPublicSourceError("GITHUB_COMMIT_MISMATCH", "Submit Launch commit response did not match its branch");
  }
  return normalizeGitObjectId(value.tree.sha, "Submit Launch root tree", "GITHUB_PROTOCOL_ERROR");
}

function normalizePublicBlob(value, expectedBlob, filePath) {
  assertPlainObject(value, "GITHUB_PROTOCOL_ERROR", `Submit Launch blob ${filePath} must be an object`);
  const blob = normalizeGitObjectId(value.sha, `Submit Launch blob ${filePath}`, "GITHUB_PROTOCOL_ERROR");
  if (blob !== expectedBlob || value.encoding !== "base64" || typeof value.content !== "string") {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", `Submit Launch blob ${filePath} identity was invalid`);
  }
  const size = Number(normalizeOpaqueId(value.size, `Submit Launch blob ${filePath} size`, "GITHUB_PROTOCOL_ERROR", true));
  const maximum = filePath === SUBMIT_LAUNCH_POLICY_PATH
    ? MAX_SUBMIT_LAUNCH_POLICY_BYTES
    : filePath === SUBMIT_LAUNCH_POLICY_SCHEMA_PATH
      ? MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES
      : 0;
  const encoded = value.content.replace(/\s+/gu, "");
  if (
    maximum === 0
    || size > maximum
    || encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", `Submit Launch blob ${filePath} encoding was invalid`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== size || bytes.length > maximum || bytes.toString("base64") !== encoded) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", `Submit Launch blob ${filePath} size was invalid`);
  }
  return bytes;
}

async function resolvePath({ baseTree, filePath, loadTree }) {
  const segments = filePath.split("/");
  let treeObjectId = baseTree;
  for (let index = 0; index < segments.length; index += 1) {
    const entries = await loadTree(treeObjectId);
    const entry = entries.get(segments[index]);
    const final = index === segments.length - 1;
    if (
      entry === undefined
      || (final && (entry.type !== "blob" || entry.mode !== REGULAR_BLOB_MODE))
      || (!final && (entry.type !== "tree" || entry.mode !== "040000"))
    ) {
      fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", `Protected path ${filePath} is not one regular Git blob.`);
    }
    if (final) return entry;
    treeObjectId = entry.sha;
  }
  fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", `Protected path ${filePath} is unavailable.`);
}

function normalizeTree(value, expectedTree) {
  if (
    value === null
    || typeof value !== "object"
    || value.sha !== expectedTree
    || value.truncated !== false
    || !Array.isArray(value.tree)
    || value.tree.length > 100_000
  ) {
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "GitHub returned an incomplete or mismatched protected tree.");
  }
  const entries = new Map();
  for (const entry of value.tree) {
    if (
      entry === null
      || typeof entry !== "object"
      || typeof entry.path !== "string"
      || entry.path.length < 1
      || entry.path.length > 255
      || Buffer.byteLength(entry.path, "utf8") > 255
      || entry.path.includes("/")
      || entry.path.normalize("NFC") !== entry.path
      || hasForbiddenInvisibleOrBidi(entry.path)
      || !new Set(["blob", "tree", "commit"]).has(entry.type)
      || !/^(?:040000|100644|100755|120000|160000)$/u.test(entry.mode ?? "")
      || !OBJECT_ID.test(entry.sha ?? "")
      || entries.has(entry.path)
    ) {
      fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "Protected Git tree contains an unsafe or duplicate entry.");
    }
    entries.set(entry.path, Object.freeze({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      sha: entry.sha
    }));
  }
  return entries;
}

async function readExactBlob({ entry, filePath, maximumBytes, readBlob }) {
  let value;
  try {
    value = await readBlob(entry.sha, filePath);
  } catch (error) {
    if (error instanceof SubmitLaunchPolicyError) throw error;
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", `Protected blob ${filePath} could not be read.`, error);
  }
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", `Protected blob ${filePath} did not return exact bytes.`);
  }
  const bytes = Buffer.from(value);
  if (bytes.length < 2 || bytes.length > maximumBytes || gitBlob(bytes) !== entry.sha) {
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", `Protected blob ${filePath} disagrees with its Git identity or byte limit.`);
  }
  return bytes;
}

function gitBlob(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function requireExactOptions(value, keys) {
  const actualKeys = value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || actualKeys.length !== keys.length
    || !actualKeys.every((key) => keys.includes(key))
  ) {
    fail("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID", "Submit Launch GitHub policy options are closed.");
  }
}

function fail(code, message, cause) {
  throw new SubmitLaunchPolicyError(code, message, cause === undefined ? undefined : { cause });
}
