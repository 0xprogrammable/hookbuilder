import crypto from "node:crypto";

import { normalizeContent } from "./github-application-normalizers.mjs";
import {
  normalizeGitCommit,
  normalizeRef,
  normalizeRepository,
  validateCentralRepository
} from "./github-application-normalizers.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import {
  SUBMIT_LAUNCH_POLICY_PATH,
  SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_REPOSITORY
} from "./registry-intake-contract.mjs";
import {
  MAX_SUBMIT_LAUNCH_POLICY_BYTES,
  MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
  parseAndBindSubmitLaunchPolicyContract,
  SubmitLaunchPolicyError
} from "./submit-launch-policy-contract.mjs";

const OBJECT_ID = /^[0-9a-f]{40}$/u;
const REGULAR_BLOB_MODE = "100644";

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
