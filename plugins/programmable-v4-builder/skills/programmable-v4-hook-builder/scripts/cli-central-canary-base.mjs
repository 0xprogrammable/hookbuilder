import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";

import {
  createGitHubPublicFetchTransportV1,
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError,
  parseBoundedLosslessJson
} from "./github-public-source-core.mjs";
import { LosslessJsonNumber } from "./github-public-source-lossless-json.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import {
  SUBMIT_LAUNCH_INTAKE_CONTRACT as INTAKE,
  SUBMIT_LAUNCH_WORKFLOW_CANARY_APPLICATION_SCHEMA_PATH
} from "./registry-intake-contract.mjs";
import { CliFailure } from "./cli-runtime.mjs";
import {
  normalizeSubmitLaunchPolicyBinding,
  normalizeSubmitLaunchPolicySchemaBinding,
  SubmitLaunchPolicyError,
  submitLaunchPolicyContentMatches
} from "./submit-launch-policy-contract.mjs";
import { resolveSubmitLaunchPolicyFromVerifiedGitObjects } from "./submit-launch-policy-github.mjs";
import {
  normalizeWorkflowCanaryApplicationSchemaBinding,
  parseAndBindWorkflowCanaryApplicationSchema,
  WorkflowCanaryApplicationError
} from "./workflow-canary-application-client.mjs";

const repository = INTAKE.repository;
export const CENTRAL_CANARY_GITHUB_TARGET = Object.freeze({
  owner: repository.owner,
  repository: repository.name,
  repositorySlug: repository.slug,
  repositoryUrl: repository.url
});

const OBJECT_ID = /^[0-9a-f]{40}$/u;
const APPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEFAULT_ATTEMPTS = 3;
const MAX_REQUESTS = 24;
const MAX_REPOSITORY_BYTES = 256 * 1024;
const MAX_COMMIT_BYTES = 256 * 1024;
const MAX_TREE_BYTES = 2 * 1024 * 1024;
const MAX_BLOB_BYTES = 768 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function resolveCentralCanaryBase({
  applicationId,
  fetchImplementation = globalThis.fetch,
  sleepImplementation = sleep,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs
}) {
  validateOptions({ applicationId, fetchImplementation, sleepImplementation, attempts, timeoutMs });
  const state = createState({ fetchImplementation, sleepImplementation, attempts, timeoutMs });
  await readRepository(state);
  const branch = await readBranchHead(state);
  const [policy, canarySchema, canaryApplicationExists] = await Promise.all([
    readPolicy(branch, state),
    readCanarySchema(branch, state),
    readCanaryApplicationOccupation(applicationId, branch.tree, state)
  ]);
  if (
    policy.policyBinding.baseCommit !== canarySchema.binding.baseCommit
    || policy.policyBinding.baseTree !== canarySchema.binding.baseTree
  ) {
    fail("CENTRAL_BASE_INVALID", "protected policy and canary schema do not share one exact base");
  }
  return Object.freeze({
    ...CENTRAL_CANARY_GITHUB_TARGET,
    baseBranch: repository.defaultBranch,
    baseCommit: branch.commit,
    baseTree: branch.tree,
    policyBinding: policy.policyBinding,
    policySchemaBinding: policy.policySchemaBinding,
    canaryApplicationSchema: canarySchema,
    canaryApplicationSchemaBinding: canarySchema.binding,
    applicationDirectory: `canary-submissions/${applicationId}`,
    applicationPath: `canary-submissions/${applicationId}/application.json`,
    canaryApplicationExists
  });
}

export async function assertCentralCanaryBaseUnchanged({
  observation,
  fetchImplementation = globalThis.fetch,
  sleepImplementation = sleep,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs
}) {
  const applicationId = validateObservation(observation);
  const current = await resolveCentralCanaryBase({
    applicationId,
    fetchImplementation,
    sleepImplementation,
    attempts,
    timeoutMs
  });
  if (!sameCanarySchema(observation, current)) {
    fail("CANARY_SCHEMA_DRIFT", "the protected workflow-canary application schema changed");
  }
  if (!samePolicy(observation, current)) {
    fail("POLICY_DRIFT", "the protected Submit Launch policy changed while preparing the canary");
  }
  if (current.baseCommit !== observation.baseCommit || current.baseTree !== observation.baseTree) {
    fail("CENTRAL_BASE_MOVED", "the protected Submit Launch base moved while preparing the canary");
  }
  if (current.canaryApplicationExists) {
    fail("CANARY_APPLICATION_EXISTS", "the protected canary application path is already occupied");
  }
  return true;
}

function validateObservation(observation) {
  const directory = observation?.applicationDirectory;
  const applicationId = typeof directory === "string" ? directory.split("/").at(-1) : null;
  if (
    observation === null
    || typeof observation !== "object"
    || Array.isArray(observation)
    || observation.repositorySlug !== repository.slug
    || observation.baseBranch !== repository.defaultBranch
    || !OBJECT_ID.test(observation.baseCommit ?? "")
    || !OBJECT_ID.test(observation.baseTree ?? "")
    || !validApplicationId(applicationId)
    || directory !== `canary-submissions/${applicationId}`
    || observation.applicationPath !== `${directory}/application.json`
    || observation.canaryApplicationExists !== false
  ) {
    fail("CENTRAL_BASE_INVALID", "the central canary observation is unavailable");
  }
  try {
    const policy = normalizeSubmitLaunchPolicyBinding(observation.policyBinding);
    const policySchema = normalizeSubmitLaunchPolicySchemaBinding(observation.policySchemaBinding);
    const canarySchema = normalizeWorkflowCanaryApplicationSchemaBinding(
      observation.canaryApplicationSchemaBinding
    );
    if ([policy, policySchema, canarySchema].some(
      (binding) => binding.baseCommit !== observation.baseCommit || binding.baseTree !== observation.baseTree
    )) {
      fail("CENTRAL_BASE_INVALID", "the central canary bindings do not match their observed base");
    }
  } catch (error) {
    if (error instanceof CliFailure) throw error;
    if (error instanceof SubmitLaunchPolicyError || error instanceof WorkflowCanaryApplicationError) {
      fail("CENTRAL_BASE_INVALID", "the central canary bindings are unavailable");
    }
    throw error;
  }
  return applicationId;
}

function sameCanarySchema(expected, observed) {
  try {
    const left = normalizeWorkflowCanaryApplicationSchemaBinding(expected.canaryApplicationSchemaBinding);
    const right = normalizeWorkflowCanaryApplicationSchemaBinding(observed.canaryApplicationSchemaBinding);
    return ["path", "gitBlobOid", "schemaId", "sha256"].every((key) => left[key] === right[key]);
  } catch (error) {
    if (error instanceof WorkflowCanaryApplicationError) {
      fail("CENTRAL_BASE_INVALID", "the protected canary schema observation is unavailable");
    }
    throw error;
  }
}

function samePolicy(expected, observed) {
  try {
    return submitLaunchPolicyContentMatches({
      expectedPolicyBinding: expected.policyBinding,
      observedPolicyBinding: observed.policyBinding,
      expectedPolicySchemaBinding: expected.policySchemaBinding,
      observedPolicySchemaBinding: observed.policySchemaBinding
    });
  } catch (error) {
    if (error instanceof SubmitLaunchPolicyError) {
      fail("CENTRAL_BASE_INVALID", "the protected policy observation is unavailable");
    }
    throw error;
  }
}

async function readRepository(state) {
  const value = await requestJson(
    `/repos/${repository.owner}/${repository.name}`,
    MAX_REPOSITORY_BYTES,
    state
  );
  if (
    !(value.id instanceof LosslessJsonNumber)
    || value.id.source !== repository.numericId
    || value.full_name !== repository.slug
    || value.private !== false
    || value.visibility !== "public"
    || value.default_branch !== repository.defaultBranch
    || value.html_url !== repository.url
  ) {
    fail("CENTRAL_REPOSITORY_MISMATCH", "the fixed Submit Launch repository identity is unavailable or changed");
  }
}

async function readBranchHead(state) {
  const encodedBranch = repository.defaultBranch.split("/").map(encodeURIComponent).join("/");
  const reference = await requestJson(
    `/repos/${repository.owner}/${repository.name}/git/ref/heads/${encodedBranch}`,
    MAX_COMMIT_BYTES,
    state
  );
  const commit = reference?.object?.sha;
  if (
    reference?.ref !== `refs/heads/${repository.defaultBranch}`
    || reference?.object?.type !== "commit"
    || !OBJECT_ID.test(commit ?? "")
  ) {
    fail("CENTRAL_BASE_INVALID", "GitHub returned an invalid fixed central branch reference");
  }
  const value = await requestJson(
    `/repos/${repository.owner}/${repository.name}/git/commits/${commit}`,
    MAX_COMMIT_BYTES,
    state
  );
  if (value?.sha !== commit || !OBJECT_ID.test(value?.tree?.sha ?? "")) {
    fail("CENTRAL_BASE_INVALID", "GitHub returned an invalid central base commit identity");
  }
  return { commit, tree: value.tree.sha };
}

async function readPolicy(branch, state) {
  try {
    return await resolveSubmitLaunchPolicyFromVerifiedGitObjects({
      baseCommit: branch.commit,
      baseTree: branch.tree,
      readTree: async (treeObjectId) => ({
        sha: treeObjectId,
        truncated: false,
        tree: [...(await readTree(treeObjectId, state)).values()]
      }),
      readBlob: (blobObjectId) => readBlob(blobObjectId, state)
    });
  } catch (error) {
    if (error instanceof SubmitLaunchPolicyError) fail(error.code, error.message);
    throw error;
  }
}

async function readCanarySchema(branch, state) {
  try {
    const entry = await resolveRegularBlobPath(
      branch.tree,
      SUBMIT_LAUNCH_WORKFLOW_CANARY_APPLICATION_SCHEMA_PATH,
      state
    );
    return parseAndBindWorkflowCanaryApplicationSchema({
      baseCommit: branch.commit,
      baseTree: branch.tree,
      schemaBytes: await readBlob(entry.sha, state),
      schemaGitBlobOid: entry.sha
    });
  } catch (error) {
    if (error instanceof WorkflowCanaryApplicationError) fail(error.code, error.message);
    throw error;
  }
}

async function readCanaryApplicationOccupation(applicationId, rootTree, state) {
  const root = await readTree(rootTree, state);
  const namespace = root.get("canary-submissions");
  if (namespace === undefined) return false;
  if (namespace.type !== "tree" || namespace.mode !== "040000") {
    fail("CENTRAL_BASE_INVALID", "the central canary namespace is not a canonical Git directory");
  }
  return (await readTree(namespace.sha, state)).has(applicationId);
}

async function resolveRegularBlobPath(rootTree, filePath, state) {
  let treeObjectId = rootTree;
  const segments = filePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const entry = (await readTree(treeObjectId, state)).get(segments[index]);
    const final = index === segments.length - 1;
    if (
      entry === undefined
      || (final && (entry.type !== "blob" || entry.mode !== "100644"))
      || (!final && (entry.type !== "tree" || entry.mode !== "040000"))
    ) {
      fail("CENTRAL_BASE_INVALID", `protected path ${filePath} is not one regular Git blob`);
    }
    if (final) return entry;
    treeObjectId = entry.sha;
  }
  fail("CENTRAL_BASE_INVALID", `protected path ${filePath} is unavailable`);
}

async function readTree(treeObjectId, state) {
  if (!OBJECT_ID.test(treeObjectId ?? "")) fail("CENTRAL_BASE_INVALID", "the central tree identity is invalid");
  if (state.treeReads.has(treeObjectId)) return state.treeReads.get(treeObjectId);
  const pending = readTreeUncached(treeObjectId, state);
  state.treeReads.set(treeObjectId, pending);
  try {
    return await pending;
  } catch (error) {
    state.treeReads.delete(treeObjectId);
    throw error;
  }
}

async function readTreeUncached(treeObjectId, state) {
  const value = await requestJson(
    `/repos/${repository.owner}/${repository.name}/git/trees/${treeObjectId}`,
    MAX_TREE_BYTES,
    state
  );
  if (value?.sha !== treeObjectId || value?.truncated !== false || !Array.isArray(value.tree)) {
    fail("CENTRAL_BASE_INVALID", "GitHub returned an incomplete or mismatched central tree");
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
      fail("CENTRAL_BASE_INVALID", "the central Git tree contains an unsafe or duplicate entry");
    }
    entries.set(entry.path, { path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha });
  }
  return entries;
}

async function readBlob(blobObjectId, state) {
  const value = await requestJson(
    `/repos/${repository.owner}/${repository.name}/git/blobs/${blobObjectId}`,
    MAX_BLOB_BYTES,
    state
  );
  if (value?.sha !== blobObjectId || value?.encoding !== "base64" || typeof value.content !== "string") {
    fail("CENTRAL_BASE_INVALID", "GitHub returned an invalid central file blob");
  }
  const compact = value.content.replace(/\n/gu, "");
  if (
    compact.length === 0
    || compact.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)
  ) {
    fail("CENTRAL_BASE_INVALID", "GitHub returned malformed base64 central file bytes");
  }
  const bytes = Buffer.from(compact, "base64");
  const identity = crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
  if (identity !== blobObjectId) {
    fail("CENTRAL_BASE_INVALID", "central file bytes do not match their immutable Git blob identity");
  }
  return bytes;
}

async function requestJson(pathAndQuery, maximumBytes, state) {
  if (state.requests >= MAX_REQUESTS) {
    fail("CENTRAL_BASE_CHECK_FAILED", "the central GitHub read exceeded its fixed request budget");
  }
  state.requests += 1;
  let lastError;
  for (let attempt = 1; attempt <= state.attempts; attempt += 1) {
    const remainingMs = Math.floor(state.deadline - performance.now());
    if (remainingMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs) {
      fail("CENTRAL_BASE_CHECK_FAILED", "the central GitHub read exceeded its absolute timeout");
    }
    const controller = new AbortController();
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("central GitHub request timed out"));
      }, remainingMs);
    });
    try {
      const response = await Promise.race([
        state.transport({
          method: "GET",
          url: `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}${pathAndQuery}`,
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
            "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
          },
          redirect: "error",
          signal: controller.signal,
          maxResponseBytes: maximumBytes
        }),
        timeoutPromise
      ]);
      if (response.status === 404) {
        fail("CENTRAL_BASE_UNAVAILABLE", "the fixed central base branch or immutable object is unavailable");
      }
      if ([403, 429].includes(response.status) || response.status >= 500) {
        lastError = new Error(`transient GitHub status ${response.status}`);
      } else if (response.status < 200 || response.status >= 300) {
        fail("CENTRAL_BASE_CHECK_FAILED", "GitHub rejected the fixed central read");
      } else {
        try {
          const parsed = parseBoundedLosslessJson(decoder.decode(response.body));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
          return parsed;
        } catch {
          fail("CENTRAL_BASE_INVALID", "GitHub returned invalid or ambiguous central JSON");
        }
      }
    } catch (error) {
      if (error instanceof CliFailure) throw error;
      if (error instanceof GitHubPublicSourceError && error.retryable !== true) {
        throw new CliFailure(
          "CENTRAL_BASE_CHECK_FAILED",
          "the fixed central GitHub transport rejected the response",
          { exitCode: 1, details: { reason: error.code } }
        );
      }
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < state.attempts) await state.sleepImplementation(250 * (2 ** (attempt - 1)));
  }
  throw new CliFailure("CENTRAL_BASE_CHECK_FAILED", "the bounded central GitHub read failed", {
    exitCode: 1,
    details: { reason: lastError instanceof GitHubPublicSourceError ? lastError.code : "unavailable" }
  });
}

function createState({ fetchImplementation, sleepImplementation, attempts, timeoutMs }) {
  return {
    attempts,
    deadline: performance.now() + timeoutMs,
    requests: 0,
    treeReads: new Map(),
    sleepImplementation,
    transport: createGitHubPublicFetchTransportV1(fetchImplementation)
  };
}

function validateOptions({ applicationId, fetchImplementation, sleepImplementation, attempts, timeoutMs }) {
  if (
    !validApplicationId(applicationId)
    || typeof fetchImplementation !== "function"
    || typeof sleepImplementation !== "function"
    || !Number.isInteger(attempts)
    || attempts < 1
    || attempts > 5
    || !Number.isInteger(timeoutMs)
    || timeoutMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs
    || timeoutMs > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
  ) {
    fail("CENTRAL_BASE_INVALID", "central canary resolver options are invalid");
  }
}

function validApplicationId(value) {
  return typeof value === "string" && value.length <= 80 && APPLICATION_ID.test(value);
}

function fail(code, message) {
  throw new CliFailure(code, message, { exitCode: 1 });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
