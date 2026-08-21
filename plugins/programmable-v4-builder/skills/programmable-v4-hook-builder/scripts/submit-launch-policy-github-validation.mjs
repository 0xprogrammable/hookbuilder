import crypto from "node:crypto";
import path from "node:path";

import {
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
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_POLICY_PATH,
  SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  SUBMIT_LAUNCH_REPOSITORY_NAME,
  SUBMIT_LAUNCH_REPOSITORY_OWNER
} from "./registry-intake-contract.mjs";
import {
  MAX_SUBMIT_LAUNCH_POLICY_BYTES,
  MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
  SubmitLaunchPolicyError
} from "./submit-launch-policy-contract.mjs";

const OBJECT_ID = /^[0-9a-f]{40}$/u;
const REGULAR_BLOB_MODE = "100644";
const MAX_RECURSIVE_TREE_ENTRIES = 100_000;
const AUTHENTICATED_READ_FALLBACK_CODES = new Set([
  "GITHUB_GET_RETRY_EXHAUSTED",
  "GITHUB_RATE_LIMITED",
  "GITHUB_REQUEST_FAILED"
]);
const CURRENT_CONTRACT_OPTION_KEYS = new Set([
  "authenticatedTransport",
  "cacheDirectory",
  "includeFullSnapshot",
  "publicTransport",
  "routeState",
  "stage"
]);
const objectIdentities = new WeakMap();
let nextObjectIdentity = 1;

export const MAX_RECURSIVE_TREE_BYTES = 8 * 1024 * 1024;

export function normalizeCurrentContractOptions(options) {
  if (!isOptionObject(options) || Object.keys(options).some((key) => !CURRENT_CONTRACT_OPTION_KEYS.has(key))) {
    fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Current Submit Launch contract options are closed.");
  }
  const stage = options.stage ?? "build";
  const routeState = options.routeState ?? "unresolved";
  if (
    !new Set(["build", "submit", "launch-readiness", "production-promotion"]).has(stage)
    || !new Set(["no-market", "external", "unresolved", "official-programmable-ethereum"]).has(routeState)
    || (options.authenticatedTransport !== undefined
      && (options.authenticatedTransport === null || typeof options.authenticatedTransport !== "object"))
    || (options.publicTransport !== undefined && typeof options.publicTransport !== "function")
    || (options.cacheDirectory !== undefined
      && options.cacheDirectory !== false
      && options.cacheDirectory !== null
      && (
        typeof options.cacheDirectory !== "string"
        || options.cacheDirectory.length < 1
        || options.cacheDirectory.length > 4096
        || options.cacheDirectory.includes("\0")
        || !path.isAbsolute(options.cacheDirectory)
      ))
    || (options.includeFullSnapshot !== undefined && typeof options.includeFullSnapshot !== "boolean")
  ) fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Current Submit Launch contract options are invalid.");
  return Object.freeze({
    stage,
    routeState,
    authenticatedTransport: options.authenticatedTransport,
    publicTransport: options.publicTransport,
    cacheDirectory: options.cacheDirectory,
    includeFullSnapshot: options.includeFullSnapshot === true
  });
}

export function normalizeRecheckOptions(options) {
  if (
    !isOptionObject(options)
    || Object.keys(options).some((key) => !new Set(["authenticatedTransport", "publicTransport"]).has(key))
    || (options.authenticatedTransport !== undefined
      && (options.authenticatedTransport === null || typeof options.authenticatedTransport !== "object"))
    || (options.publicTransport !== undefined && typeof options.publicTransport !== "function")
  ) fail("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID", "Submit Launch currentness options are invalid.");
  return options;
}

export function resolutionKey(options) {
  return [
    options.stage,
    options.routeState,
    options.cacheDirectory ?? "<default>",
    options.includeFullSnapshot,
    objectIdentity(options.authenticatedTransport),
    objectIdentity(options.publicTransport)
  ].join("\0");
}

export function authenticatedReadUnavailable(error) {
  let current = error;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (AUTHENTICATED_READ_FALLBACK_CODES.has(current.code)) return true;
    current = current.cause;
  }
  return false;
}

export function publicRepositoryPath() {
  return new URL(SUBMIT_LAUNCH_API_URL).pathname;
}

export function validatePublicRepository(value) {
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

export function validatePublicReference(value) {
  assertPlainObject(value, "GITHUB_PROTOCOL_ERROR", "Submit Launch branch response must be an object");
  assertPlainObject(value.object, "GITHUB_PROTOCOL_ERROR", "Submit Launch branch object must be an object");
  if (value.ref !== `refs/heads/${SUBMIT_LAUNCH_BASE_BRANCH}` || value.object.type !== "commit") {
    throw new GitHubPublicSourceError("GITHUB_COMMIT_MISMATCH", "Submit Launch branch did not resolve to its exact commit");
  }
  return normalizeGitObjectId(value.object.sha, "Submit Launch branch commit", "GITHUB_PROTOCOL_ERROR");
}

export function validatePublicCommit(value, expectedCommit) {
  assertPlainObject(value, "GITHUB_PROTOCOL_ERROR", "Submit Launch commit response must be an object");
  assertPlainObject(value.tree, "GITHUB_PROTOCOL_ERROR", "Submit Launch commit tree must be an object");
  const commit = normalizeGitObjectId(value.sha, "Submit Launch commit", "GITHUB_PROTOCOL_ERROR");
  if (commit !== expectedCommit) {
    throw new GitHubPublicSourceError("GITHUB_COMMIT_MISMATCH", "Submit Launch commit response did not match its branch");
  }
  return normalizeGitObjectId(value.tree.sha, "Submit Launch root tree", "GITHUB_PROTOCOL_ERROR");
}

export function normalizePublicBlob(value, expectedBlob, filePath, maximumBytes = undefined) {
  assertPlainObject(value, "GITHUB_PROTOCOL_ERROR", `Submit Launch blob ${filePath} must be an object`);
  const blob = normalizeGitObjectId(value.sha, `Submit Launch blob ${filePath}`, "GITHUB_PROTOCOL_ERROR");
  if (blob !== expectedBlob || value.encoding !== "base64" || typeof value.content !== "string") {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", `Submit Launch blob ${filePath} identity was invalid`);
  }
  const size = Number(normalizeOpaqueId(value.size, `Submit Launch blob ${filePath} size`, "GITHUB_PROTOCOL_ERROR", true));
  const maximum = maximumBytes ?? (filePath === SUBMIT_LAUNCH_POLICY_PATH
    ? MAX_SUBMIT_LAUNCH_POLICY_BYTES
    : filePath === SUBMIT_LAUNCH_POLICY_SCHEMA_PATH
      ? MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES
      : 0);
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

export function normalizeRecursiveTree(value, expectedTree) {
  if (
    value === null
    || typeof value !== "object"
    || value.sha !== expectedTree
    || value.truncated !== false
    || !Array.isArray(value.tree)
    || value.tree.length > MAX_RECURSIVE_TREE_ENTRIES
  ) {
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "GitHub returned an incomplete or mismatched recursive tree.");
  }
  let responseBytes;
  try {
    responseBytes = Buffer.from(JSON.stringify(value), "utf8");
  } catch (cause) {
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "GitHub recursive tree is not serializable JSON.", cause);
  }
  if (responseBytes.length > MAX_RECURSIVE_TREE_BYTES) {
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "GitHub recursive tree exceeds its byte boundary.");
  }
  const entries = new Map();
  for (const candidate of value.tree) {
    const filePath = candidate?.path;
    const segments = typeof filePath === "string" ? filePath.split("/") : [];
    const validModeAndType = (
      (candidate?.type === "tree" && candidate?.mode === "040000")
      || (candidate?.type === "blob" && new Set(["100644", "100755", "120000"]).has(candidate?.mode))
      || (candidate?.type === "commit" && candidate?.mode === "160000")
    );
    if (
      typeof filePath !== "string"
      || filePath.length < 1
      || filePath.length > 4096
      || Buffer.byteLength(filePath, "utf8") > 4096
      || filePath.startsWith("/")
      || filePath.endsWith("/")
      || filePath.includes("\\")
      || filePath.normalize("NFC") !== filePath
      || hasForbiddenInvisibleOrBidi(filePath)
      || segments.some((segment) => (
        segment.length < 1
        || segment === "."
        || segment === ".."
        || segment.toLowerCase() === ".git"
        || Buffer.byteLength(segment, "utf8") > 255
        || segment.normalize("NFC") !== segment
        || hasForbiddenInvisibleOrBidi(segment)
      ))
      || !validModeAndType
      || !OBJECT_ID.test(candidate?.sha ?? "")
      || entries.has(filePath)
    ) {
      fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "Recursive Git tree contains an unsafe or duplicate entry.");
    }
    entries.set(filePath, Object.freeze({
      path: filePath,
      mode: candidate.mode,
      type: candidate.type,
      sha: candidate.sha
    }));
  }

  const directories = new Map([["", []]]);
  const expectedTrees = new Map([["", expectedTree]]);
  for (const entry of entries.values()) {
    if (entry.type === "tree") {
      directories.set(entry.path, []);
      expectedTrees.set(entry.path, entry.sha);
    }
  }
  for (const entry of entries.values()) {
    const separator = entry.path.lastIndexOf("/");
    const parent = separator === -1 ? "" : entry.path.slice(0, separator);
    const name = separator === -1 ? entry.path : entry.path.slice(separator + 1);
    const parentEntry = parent === "" ? null : entries.get(parent);
    if (
      !directories.has(parent)
      || (parent !== "" && (parentEntry?.type !== "tree" || parentEntry.mode !== "040000"))
    ) {
      fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "Recursive Git tree omits an exact parent tree.");
    }
    directories.get(parent).push({ ...entry, name });
  }
  for (const [directory, children] of directories) {
    if (gitTree(children) !== expectedTrees.get(directory)) {
      fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "Recursive Git tree disagrees with a Git tree object identity.");
    }
  }
  const normalizedTree = {
    sha: expectedTree,
    truncated: false,
    tree: [...entries.values()].sort((left, right) => compareUtf8(left.path, right.path))
  };
  const cacheBytes = Buffer.from(JSON.stringify(normalizedTree), "utf8");
  if (cacheBytes.length > MAX_RECURSIVE_TREE_BYTES) {
    fail("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID", "Normalized recursive Git tree exceeds its byte boundary.");
  }
  return Object.freeze({ entries, cacheBytes });
}

export async function resolvePath({ baseTree, filePath, loadTree }) {
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

export function normalizeTree(value, expectedTree) {
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

export async function readExactBlob({ entry, filePath, maximumBytes, readBlob }) {
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

export function requireExactOptions(value, keys) {
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

function objectIdentity(value) {
  if (value === undefined) return "default";
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return String(value);
  if (!objectIdentities.has(value)) objectIdentities.set(value, nextObjectIdentity++);
  return String(objectIdentities.get(value));
}

function gitTree(entries) {
  const sorted = [...entries].sort((left, right) => compareUtf8(
    `${left.name}${left.type === "tree" ? "/" : ""}`,
    `${right.name}${right.type === "tree" ? "/" : ""}`
  ));
  const payload = Buffer.concat(sorted.flatMap((entry) => [
    Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.name}\0`, "utf8"),
    Buffer.from(entry.sha, "hex")
  ]));
  return crypto.createHash("sha1").update(`tree ${payload.length}\0`, "utf8").update(payload).digest("hex");
}

function gitBlob(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isOptionObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message, cause) {
  throw new SubmitLaunchPolicyError(code, message, cause === undefined ? undefined : { cause });
}
