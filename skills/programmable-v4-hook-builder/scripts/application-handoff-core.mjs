import {
  canonicalJsonSha256V2,
  canonicalJsonV2
} from "./canonical-json-core.mjs";
import {
  currentSubmitLaunchBuildRequirements,
  MAX_SUBMIT_LAUNCH_POLICY_BYTES,
  MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
  normalizeSubmitLaunchBuildPolicyBinding,
  normalizeSubmitLaunchPolicySchemaBinding,
  parseAndBindSubmitLaunchPolicyContract
} from "./submit-launch-policy-contract.mjs";
import {
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION,
  SUBMIT_LAUNCH_INTAKE_STATES,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  SUBMIT_LAUNCH_REPOSITORY_URL
} from "./registry-intake-contract.mjs";

const OBJECT_ID = /^(?!0{40}$)[0-9a-f]{40}$/u;
const SHA256 = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
const DECIMAL_ID = /^[1-9][0-9]{0,63}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BRANCH = /^(?![./])(?!.*(?:\.\.|\/\/|@\{|\\|[\x00-\x20~^:?*\[]))(?!.*[/.]$)[A-Za-z0-9._/-]{1,255}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/u;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;
const CLASSIFICATIONS = new Set(["no-market", "tradable"]);
const INTAKE_STATES = new Set(SUBMIT_LAUNCH_INTAKE_STATES);
const MAXIMUM_SURFACES = 32;
const MAXIMUM_PATHS_PER_SURFACE = 1_024;

export class ApplicationHandoffError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "ApplicationHandoffError";
    this.code = code;
  }
}

export function buildApplicationHandoffPreviewV1(input) {
  const normalized = normalizeApplicationHandoffInputV1(input);
  const { project, source, builder, policy, pullRequest } = normalized;

  const projectProjection = {
    completion: project.completion,
    surfaces: project.surfaces,
    inventorySha256: canonicalJsonSha256V2(project.surfaces)
  };
  const policyProjection = {
    binding: policy.binding,
    schemaBinding: policy.schemaBinding,
    content: policy.content,
    requirements: policy.requirements,
    requirementsSha256: canonicalJsonSha256V2(policy.requirements)
  };
  const payload = {
    schemaVersion: "programmable.application-handoff-preview.v1",
    kind: "programmable-application-handoff-preview",
    status: pullRequest.target.intakeState === "open"
      ? "APPLICATION_HANDOFF_PREVIEW_READY"
      : "APPLICATION_HANDOFF_PREVIEW_BLOCKED_INTAKE",
    application: {
      applicationId: project.applicationId,
      classification: project.classification,
      projectProfile: project.projectProfile,
      ideaSha256: project.ideaSha256,
      surfaceCount: project.surfaces.length
    },
    project: projectProjection,
    source: {
      repositoryUri: source.repositoryUri,
      numericRepositoryId: source.numericRepositoryId,
      branch: source.branch,
      revisionObjectId: source.revisionObjectId,
      treeObjectId: source.treeObjectId,
      public: true,
      worktreeClean: true,
      builder: {
        githubUserId: builder.githubUserId,
        githubLogin: builder.githubLogin,
        profileUrl: builder.profileUrl,
        sourcePushPermission: true
      }
    },
    policy: policyProjection,
    pullRequest,
    authority: {
      sourceCompletion: "PROJECT_PREFLIGHT_VALID_BOUND_NOT_REVALIDATED",
      submission: pullRequest.observed === null ? "NOT_SUBMITTED" : "DRAFT_OPEN_BOUND_NOT_REVALIDATED",
      review: "NOT_REVIEWED",
      approval: "NOT_APPROVED",
      deployment: "NOT_DEPLOYED",
      launch: "NOT_LAUNCHED"
    },
    transport: {
      mode: "github-draft-pull-request",
      status: "HANDOFF_ONLY_EXTERNAL_WRITE_NOT_AUTHORIZED",
      applicationPackageStatus: "GENERIC_HANDOFF_PREVIEW_ONLY",
      existingDraftAdapterEligible: false,
      confirmationDigestAccepted: null,
      writesRequireFreshExactPlanAndExplicitAuthority: true
    },
    evidenceBoundary: {
      sourceCompletionRevalidatedByThisPreview: false,
      sourceAuthorityRevalidatedByThisPreview: false,
      policyContentValidatedByThisPreview: true,
      policyRequirementsDerivedByThisPreview: true,
      policyRemoteMembershipRevalidatedByThisPreview: false,
      projectPolicyComplianceEvaluatedByThisPreview: false,
      policyAndTargetRevalidatedByThisPreview: false,
      pullRequestRevalidatedByThisPreview: false,
      applicationPackageMaterialized: false,
      githubWriteAuthorized: false,
      approvalGranted: false,
      auditClaimed: false,
      deploymentPerformed: false,
      launchPerformed: false
    },
    networkAccessed: false,
    externalActionsPerformed: []
  };
  return deepFreeze({ ...payload, previewDigest: canonicalJsonSha256V2(payload) });
}

export function normalizeApplicationHandoffInputV1(input) {
  exactObject(input, ["schemaVersion", "project", "source", "builder", "policy", "pullRequest"], "HANDOFF_INPUT_INVALID");
  if (input.schemaVersion !== "programmable.application-handoff-input.v1") {
    fail("HANDOFF_INPUT_INVALID", "application handoff input uses an unsupported schema identity");
  }

  const project = normalizeProject(input.project);
  const source = normalizeSource(input.source);
  const builder = normalizeBuilder(input.builder);
  const policy = normalizePolicy(input.policy);
  const pullRequest = normalizePullRequest(input.pullRequest, project.applicationId, builder.githubUserId);

  if (
    project.completion.sourceCommit !== source.revisionObjectId
    || project.completion.sourceTree !== source.treeObjectId
    || source.observedBranchHead !== source.revisionObjectId
  ) {
    fail("PROJECT_SOURCE_DRIFT", "project completion and current public source do not identify the same commit and tree");
  }
  if (
    policy.binding.baseCommit !== policy.schemaBinding.baseCommit
    || policy.binding.baseTree !== policy.schemaBinding.baseTree
    || policy.binding.baseCommit !== pullRequest.target.baseCommit
    || policy.binding.baseTree !== pullRequest.target.baseTree
  ) {
    fail("POLICY_TARGET_DRIFT", "policy, schema, and pull-request target must bind one exact Submit a Launch base commit and tree");
  }
  if (builder.sourcePushPermission !== true) {
    fail("SOURCE_AUTHORITY_REQUIRED", "the authenticated builder must have current push authority over the exact public source revision");
  }

  return deepFreeze({
    schemaVersion: "programmable.application-handoff-input.v1",
    project,
    source,
    builder,
    policy,
    pullRequest
  });
}

function normalizeProject(value) {
  exactObject(value, ["applicationId", "classification", "projectProfile", "ideaSha256", "completion", "surfaces"], "PROJECT_HANDOFF_INVALID");
  if (!SLUG.test(value.applicationId ?? "") || value.applicationId.length > 80) {
    fail("PROJECT_HANDOFF_INVALID", "applicationId must be one lowercase slug of at most 80 characters");
  }
  if (!CLASSIFICATIONS.has(value.classification) || !SLUG.test(value.projectProfile ?? "") || !SHA256.test(value.ideaSha256 ?? "")) {
    fail("PROJECT_HANDOFF_INVALID", "project classification, profile, or idea identity is invalid");
  }
  exactObject(value.completion, ["status", "canonicalOutput", "receipt", "sourceCommit", "sourceTree"], "PROJECT_COMPLETION_INVALID");
  exactObject(value.completion.receipt, ["sha256", "byteLength"], "PROJECT_COMPLETION_INVALID");
  if (
    value.completion.status !== "PROJECT_PREFLIGHT_VALID"
    || value.completion.canonicalOutput !== true
    || !SHA256.test(value.completion.receipt.sha256 ?? "")
    || !Number.isSafeInteger(value.completion.receipt.byteLength)
    || value.completion.receipt.byteLength < 1
    || value.completion.receipt.byteLength > 8 * 1024 * 1024
    || !OBJECT_ID.test(value.completion.sourceCommit ?? "")
    || !OBJECT_ID.test(value.completion.sourceTree ?? "")
  ) {
    fail("PROJECT_COMPLETION_INVALID", "a canonical PROJECT_PREFLIGHT_VALID receipt and exact source commit/tree are required");
  }
  if (!Array.isArray(value.surfaces) || value.surfaces.length < 1 || value.surfaces.length > MAXIMUM_SURFACES) {
    fail("PROJECT_SURFACES_INVALID", "application handoff requires one to 32 complete project surfaces");
  }
  const surfaces = value.surfaces.map(normalizeSurface);
  assertSortedUnique(surfaces.map(({ id }) => id), "PROJECT_SURFACES_INVALID", "project surface ids");
  return clone({ ...value, surfaces });
}

function normalizeSurface(value) {
  exactObject(value, ["id", "kind", "sourcePaths", "testPaths", "evidencePaths"], "PROJECT_SURFACES_INVALID");
  if (!SLUG.test(value.id ?? "") || value.id.length > 120 || !SLUG.test(value.kind ?? "") || value.kind.length > 120) {
    fail("PROJECT_SURFACES_INVALID", "surface id and kind must be bounded lowercase slugs");
  }
  const sourcePaths = normalizePaths(value.sourcePaths, 1, "sourcePaths");
  const testPaths = normalizePaths(value.testPaths, 1, "testPaths");
  const evidencePaths = normalizePaths(value.evidencePaths, 0, "evidencePaths");
  return { id: value.id, kind: value.kind, sourcePaths, testPaths, evidencePaths };
}

function normalizeSource(value) {
  exactObject(value, ["repositoryUri", "numericRepositoryId", "branch", "revisionObjectId", "treeObjectId", "observedBranchHead", "public", "worktreeClean"], "SOURCE_IDENTITY_INVALID");
  let url;
  try {
    url = new URL(value.repositoryUri);
  } catch {
    fail("SOURCE_ORIGIN_INVALID", "source repository must be one canonical public github.com URL");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || !/^\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9._-]+$/u.test(url.pathname)
    || url.pathname.endsWith(".git")
    || value.repositoryUri !== `https://github.com${url.pathname}`
    || value.repositoryUri.toLowerCase() === SUBMIT_LAUNCH_REPOSITORY_URL.toLowerCase()
  ) {
    fail("SOURCE_ORIGIN_INVALID", "source repository must be a distinct canonical public github.com repository URL");
  }
  if (
    !DECIMAL_ID.test(value.numericRepositoryId ?? "")
    || !BRANCH.test(value.branch ?? "")
    || !OBJECT_ID.test(value.revisionObjectId ?? "")
    || !OBJECT_ID.test(value.treeObjectId ?? "")
    || !OBJECT_ID.test(value.observedBranchHead ?? "")
    || value.public !== true
    || value.worktreeClean !== true
  ) {
    fail("SOURCE_IDENTITY_INVALID", "source identity must bind a clean public branch, numeric repository id, commit, and tree");
  }
  return clone(value);
}

function normalizeBuilder(value) {
  exactObject(value, ["githubUserId", "githubLogin", "profileUrl", "sourcePushPermission"], "SOURCE_AUTHORITY_REQUIRED");
  if (
    !DECIMAL_ID.test(value.githubUserId ?? "")
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value.githubLogin ?? "")
    || value.profileUrl !== `https://github.com/${value.githubLogin}`
    || typeof value.sourcePushPermission !== "boolean"
  ) {
    fail("SOURCE_AUTHORITY_REQUIRED", "builder identity and current source authority are missing or malformed");
  }
  return clone(value);
}

function normalizePolicy(value) {
  exactObject(value, ["binding", "schemaBinding", "policyBytesBase64", "schemaBytesBase64"], "POLICY_HANDOFF_INVALID");
  let binding;
  let schemaBinding;
  let contract;
  let policyBytes;
  let schemaBytes;
  try {
    binding = normalizeSubmitLaunchBuildPolicyBinding(value.binding);
    schemaBinding = normalizeSubmitLaunchPolicySchemaBinding(value.schemaBinding);
    policyBytes = decodeCanonicalBase64(value.policyBytesBase64, MAX_SUBMIT_LAUNCH_POLICY_BYTES);
    schemaBytes = decodeCanonicalBase64(value.schemaBytesBase64, MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES);
    contract = parseAndBindSubmitLaunchPolicyContract({
      baseCommit: binding.baseCommit,
      baseTree: binding.baseTree,
      policyBytes,
      policyGitBlobOid: binding.gitBlobOid,
      schemaBytes,
      schemaGitBlobOid: schemaBinding.gitBlobOid
    });
  } catch (error) {
    fail("POLICY_HANDOFF_INVALID", "handoff requires exact validated policy and schema preimages matching their Git bindings", error);
  }
  if (
    canonicalJsonV2(binding) !== canonicalJsonV2(contract.buildPolicyBinding)
    || canonicalJsonV2(schemaBinding) !== canonicalJsonV2(contract.policySchemaBinding)
  ) {
    fail("POLICY_HANDOFF_INVALID", "policy and schema bindings must be derived from the supplied exact preimages");
  }
  const requirements = clone(currentSubmitLaunchBuildRequirements(contract));
  requirements.sort((left, right) => compareUtf8(left.id, right.id));
  if (requirements.length < 1 || requirements.length > 256) {
    fail("POLICY_HANDOFF_INVALID", "handoff requires the bounded current build-rule list");
  }
  for (const requirement of requirements) {
    if (!isPlainObject(requirement) || !/^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/u.test(requirement.id ?? "") || requirement.status !== "active") {
      fail("POLICY_HANDOFF_INVALID", "each derived handoff policy requirement must be one active identified build rule");
    }
  }
  assertSortedUnique(requirements.map(({ id }) => id), "POLICY_HANDOFF_INVALID", "policy requirement ids");
  return {
    binding,
    schemaBinding,
    content: {
      policy: {
        byteLength: policyBytes.length,
        gitBlobOid: binding.gitBlobOid,
        sha256: binding.sha256
      },
      schema: {
        byteLength: schemaBytes.length,
        gitBlobOid: schemaBinding.gitBlobOid,
        sha256: schemaBinding.sha256
      }
    },
    requirements
  };
}

function decodeCanonicalBase64(value, maximumBytes) {
  const maximumCharacters = Math.ceil(maximumBytes / 3) * 4;
  if (
    typeof value !== "string"
    || value.length < 4
    || value.length > maximumCharacters
    || value.length % 4 !== 0
    || !BASE64.test(value)
  ) {
    fail("POLICY_HANDOFF_INVALID", "policy preimages must use bounded canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 2 || bytes.length > maximumBytes || bytes.toString("base64") !== value) {
    fail("POLICY_HANDOFF_INVALID", "policy preimages must decode losslessly within their byte bounds");
  }
  return bytes;
}

function normalizePullRequest(value, applicationId, builderUserId) {
  exactObject(value, ["target", "observed"], "PULL_REQUEST_IDENTITY_MISMATCH");
  const target = value.target;
  exactObject(target, ["repository", "numericRepositoryId", "baseBranch", "baseCommit", "baseTree", "intakeSchemaVersion", "intakeState", "applicationDirectory", "headOwnerGitHubUserId", "headBranch", "draftOnly"], "PULL_REQUEST_TARGET_INVALID");
  if (
    target.repository !== SUBMIT_LAUNCH_REPOSITORY
    || target.numericRepositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID
    || target.baseBranch !== SUBMIT_LAUNCH_BASE_BRANCH
    || !OBJECT_ID.test(target.baseCommit ?? "")
    || !OBJECT_ID.test(target.baseTree ?? "")
    || target.intakeSchemaVersion !== SUBMIT_LAUNCH_INTAKE_SCHEMA_VERSION
    || !INTAKE_STATES.has(target.intakeState)
    || target.applicationDirectory !== `submissions/${applicationId}`
    || target.headOwnerGitHubUserId !== builderUserId
    || target.headBranch !== `programmable-builder/${applicationId}`
    || target.draftOnly !== true
  ) {
    fail("PULL_REQUEST_TARGET_INVALID", "handoff pull-request target differs from the fixed Submit a Launch draft contract");
  }
  let observed = null;
  if (value.observed !== null) {
    exactObject(value.observed, ["number", "url", "state", "draft", "baseRepositoryId", "baseBranch", "baseCommit", "headRepositoryId", "headBranch", "headCommit", "authorGitHubUserId"], "PULL_REQUEST_IDENTITY_MISMATCH");
    if (
      !Number.isSafeInteger(value.observed.number)
      || value.observed.number < 1
      || value.observed.url !== `${SUBMIT_LAUNCH_REPOSITORY_URL}/pull/${value.observed.number}`
      || value.observed.state !== "open"
      || value.observed.draft !== true
      || value.observed.baseRepositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID
      || value.observed.baseBranch !== SUBMIT_LAUNCH_BASE_BRANCH
      || value.observed.baseCommit !== target.baseCommit
      || !DECIMAL_ID.test(value.observed.headRepositoryId ?? "")
      || value.observed.headBranch !== target.headBranch
      || !OBJECT_ID.test(value.observed.headCommit ?? "")
      || value.observed.authorGitHubUserId !== builderUserId
    ) {
      fail("PULL_REQUEST_IDENTITY_MISMATCH", "observed pull request does not match the exact builder, target repository, base, branch, and draft state");
    }
    observed = clone(value.observed);
  }
  return { target: clone(target), observed };
}

function normalizePaths(value, minimum, label) {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAXIMUM_PATHS_PER_SURFACE) {
    fail("PROJECT_SURFACES_INVALID", `${label} count is outside the bounded handoff contract`);
  }
  for (const entry of value) if (!safePath(entry)) fail("PROJECT_SURFACES_INVALID", `${label} contains an unsafe repository path`);
  assertSortedUnique(value, "PROJECT_SURFACES_INVALID", label);
  return [...value];
}

function safePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && SAFE_PATH.test(value);
}

function assertSortedUnique(values, code, label) {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && compareUtf8(values[index - 1], values[index]) >= 0) {
      fail(code, `${label} must be UTF-8 bytewise sorted and unique`);
    }
  }
}

function exactObject(value, keys, code) {
  if (!isPlainObject(value)) fail(code, "handoff field must be one closed object");
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (canonicalJsonV2(actual) !== canonicalJsonV2(expected)) fail(code, "handoff object has missing or unsupported fields");
}

function clone(value) {
  try {
    return JSON.parse(canonicalJsonV2(value));
  } catch (error) {
    fail("HANDOFF_INPUT_INVALID", "handoff input must be canonicalizable plain JSON data", error);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message, cause = undefined) {
  throw new ApplicationHandoffError(code, message, cause === undefined ? undefined : { cause });
}
