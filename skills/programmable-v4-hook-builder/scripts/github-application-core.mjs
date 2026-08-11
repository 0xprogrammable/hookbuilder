import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { normalizeBuilderTemplate } from "./builder-template-contract.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";

export const GITHUB_APPLICATION_CLIENT_VERSION = "1.0.0-beta.1";
export const CENTRAL_REPOSITORY = "0xprogrammable/submit-launch";
export const CENTRAL_REPOSITORY_ID = "1320171831";
export const CENTRAL_REPOSITORY_NAME = "submit-launch";
export const CENTRAL_BASE_BRANCH = "main";
export const INTAKE_STATUS_PATH = "docs/builder/intake-status.json";
export const CENTRAL_APPLICATION_FILES = Object.freeze([
  "application.json",
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);
export const GITHUB_APPLICATION_STATUSES = Object.freeze([
  "submitted",
  "checks-running",
  "changes-requested",
  "waiting-review",
  "review-record-merged",
  "closed"
]);

const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BRANCH_PATTERN = /^(?!\/)(?!.*(?:\.\.|\/\/|@\{|\\|[\u0000-\u0020\u007f~^:?*\[]))[A-Za-z0-9._/-]{1,255}(?<![\/.])$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const OPAQUE_DECIMAL_PATTERN = /^[1-9][0-9]{0,63}$/u;
const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/u;
const MAX_PREPARED_BYTES = 2_000_000;
const MAX_CENTRAL_PACKAGE_BYTES = 512 * 1024;
const MAX_CENTRAL_FILE_BYTES = Object.freeze({
  "application.json": 64 * 1024,
  "compatibility-report.json": 160 * 1024,
  "evidence-index.json": 160 * 1024,
  "PROPOSAL.md": 64 * 1024,
  "THREAT_MODEL.md": 64 * 1024,
  "TEST_PLAN.md": 64 * 1024
});
const MAX_API_OUTPUT_BYTES = 4_000_000;
const MAX_API_INPUT_BYTES = 1_000_000;
const MAX_INTAKE_BYTES = 32_768;
const MAX_RECEIPT_BYTES = 65_536;
const MAX_SEARCH_RESULTS = 20;
const MAX_PULL_FILES = 100;
const MAX_REVIEWS = 100;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const normalizedPreparedValues = new WeakSet();

export class GitHubApplicationError extends Error {
  constructor(code, message, { exitCode = 1, details = null } = {}) {
    super(sanitizeMessage(message));
    this.name = "GitHubApplicationError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function loadPreparedApplication(inputPath, { sourceRepositoryRoot = null } = {}) {
  const preparedPath = resolveRegularFile(inputPath, "prepared application result");
  const stat = fs.statSync(preparedPath);
  if (stat.size < 2 || stat.size > MAX_PREPARED_BYTES) {
    fail("PREPARED_RESULT_INVALID", "the prepared application result exceeds the bounded input size");
  }
  if (sourceRepositoryRoot !== null) {
    const repositoryRoot = resolveDirectory(sourceRepositoryRoot, "source repository root");
    if (pathsOverlap(repositoryRoot, preparedPath)) {
      fail(
        "PREPARED_RESULT_PATH_INVALID",
        "the prepare-pr result must be stored completely outside the source repository"
      );
    }
  }
  let document;
  let source;
  try {
    source = utf8Decoder.decode(fs.readFileSync(preparedPath));
    document = JSON.parse(source);
  } catch {
    fail("PREPARED_RESULT_INVALID", "the prepared application result is not valid UTF-8 JSON");
  }
  if (source !== `${canonicalJson(document)}\n`) {
    fail("PREPARED_RESULT_INVALID", "the prepared application result must be canonical JSON with one final newline");
  }
  return normalizePreparedApplication(document);
}

export function normalizePreparedApplication(input) {
  if (isPlainObject(input) && normalizedPreparedValues.has(input)) return input;
  const document = unwrapPreparePrResult(input);
  if (!isPlainObject(document)) invalidPrepared("the prepare-pr result is not an object");
  if (document.requiresHumanConfirmation !== true) {
    invalidPrepared("the prepare-pr result does not retain the human-confirmation boundary");
  }
  if (!Array.isArray(document.externalActionsPerformed) || document.externalActionsPerformed.length !== 0) {
    invalidPrepared("the prepare-pr result already claims an external action");
  }

  const sourceHead = requireObject(document.sourceHead, "sourceHead");
  const centralTarget = requireObject(document.centralPullRequestTarget, "centralPullRequestTarget");
  const github = requireObject(document.github, "github");
  const submission = requireObject(document.submission, "submission");
  const centralPackage = requireObject(document.centralPackage, "centralPackage");
  const applicationAdapter = requireObject(document.applicationAdapter, "applicationAdapter");
  const applicationId = requireApplicationId(submission.modelId, "submission.modelId");
  const applicationDirectory = `submissions/${applicationId}`;

  if (
    centralTarget.repositorySlug !== CENTRAL_REPOSITORY
    || centralTarget.repositoryUrl !== `https://github.com/${CENTRAL_REPOSITORY}`
    || centralTarget.baseBranch !== CENTRAL_BASE_BRANCH
    || centralTarget.applicationDirectory !== applicationDirectory
    || centralTarget.applicationPath !== `${applicationDirectory}/application.json`
  ) {
    invalidPrepared("the prepare-pr result does not target the fixed Submit a Launch repository and path");
  }
  const centralBaseCommit = requireCommit(centralTarget.baseCommit, "central base commit");
  const centralBaseTree = requireCommit(centralTarget.baseTree, "central base tree");
  const sourceCommit = requireCommit(sourceHead.commit, "source commit");
  const sourceTree = requireCommit(sourceHead.tree, "source tree");
  const sourceBranch = requireBranch(sourceHead.upstreamBranch, "source upstream branch");
  const sourceRepository = requireRepositorySlug(sourceHead.repositorySlug, "source repository");
  const sourceRepositoryUrl = requireGitHubRepositoryUrl(sourceHead.repositoryUrl, sourceRepository);

  if (
    github.repositorySlug !== sourceRepository
    || github.repositoryUrl !== sourceRepositoryUrl
    || github.publicCommitReachable !== true
  ) {
    invalidPrepared("the GitHub source projection disagrees with sourceHead");
  }
  const sourceRepositoryId = requireOpaqueDecimal(github.repositoryId, "source repository id");
  const sourceRequest = requireObject(github.sourceRequest, "github.sourceRequest");
  if (sourceRequest.schemaVersion !== "1.0.0") {
    invalidPrepared("the public GitHub source request schema version is unsupported");
  }
  const primarySource = requireObject(sourceRequest.primary, "github.sourceRequest.primary");
  if (
    primarySource.repositoryUri !== sourceRepositoryUrl
    || requireOpaqueDecimal(primarySource.numericRepositoryId, "primary source repository id") !== sourceRepositoryId
    || requireCommit(primarySource.revisionObjectId, "primary source commit") !== sourceCommit
    || requireCommit(primarySource.treeObjectId, "primary source tree") !== sourceTree
  ) {
    invalidPrepared("the primary source request disagrees with the exact source repository, commit, or tree");
  }

  if (
    centralPackage.targetDirectory !== applicationDirectory
    || centralPackage.fileCount !== CENTRAL_APPLICATION_FILES.length
    || !arraysEqual(centralPackage.fileOrder, CENTRAL_APPLICATION_FILES)
    || centralPackage.encoding !== "utf8"
    || centralPackage.generated !== true
    || centralPackage.validatorContract !== "public-pr-application-v2"
    || !Array.isArray(centralPackage.files)
    || centralPackage.files.length !== CENTRAL_APPLICATION_FILES.length
  ) {
    invalidPrepared("the central package is not the closed six-file public beta package");
  }

  const files = centralPackage.files.map((record, index) => normalizeCentralFile(record, CENTRAL_APPLICATION_FILES[index]));
  if (files.reduce((total, record) => total + record.byteLength, 0) > MAX_CENTRAL_PACKAGE_BYTES) {
    invalidPrepared("the central package exceeds the trusted public beta package limit");
  }
  const fileMap = new Map(files.map((record) => [record.path, record]));
  const application = parseJsonFile(fileMap.get("application.json"), "application.json");
  validateApplicationProjection({
    application,
    applicationId,
    files: fileMap,
    sourceRepository,
    sourceRepositoryUrl,
    sourceRepositoryId,
    sourceCommit,
    sourceTree,
    sourceRequest,
    centralPackage,
    centralTarget,
    submission,
    applicationAdapter
  });

  const title = requireBoundedText(document.title, "pull-request title", 200);
  if (title !== `[Builder Beta] ${applicationId}`) {
    invalidPrepared("the pull-request title is not the canonical Builder Beta title");
  }
  const body = requireBoundedMultilineText(document.body, "pull-request body", 64_000);
  const confirmedBody = confirmPreparedBody(body);
  const applicationRevision = application.applicationRevision;
  const branch = requireBranch(`programmable-builder/${applicationId}`, "application branch");
  const companionSources = normalizeCompanionSources(sourceRequest.companions, sourceRepositoryId);
  const packageFiles = files.map((record) => Object.freeze({
    path: `${applicationDirectory}/${record.path}`,
    relativePath: record.path,
    content: record.content,
    byteLength: record.byteLength,
    sha256: record.sha256
  }));
  const packageDigest = sha256Canonical({
    applicationDirectory,
    applicationRevision,
    files: packageFiles.map(({ relativePath, byteLength, sha256 }) => ({
      path: relativePath,
      byteLength,
      sha256
    }))
  });

  const normalized = Object.freeze({
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    applicationId,
    applicationRevision,
    applicationDirectory,
    title,
    body: confirmedBody,
    bodySha256: sha256Bytes(Buffer.from(confirmedBody, "utf8")),
    branch,
    source: Object.freeze({
      repositorySlug: sourceRepository,
      repositoryUrl: sourceRepositoryUrl,
      numericRepositoryId: sourceRepositoryId,
      branch: sourceBranch,
      commit: sourceCommit,
      tree: sourceTree,
      writeAccessMeaning: "revision-control-evidence-only-not-repository-admin-ownership"
    }),
    builder: Object.freeze({
      githubUserId: requireOpaqueDecimal(application.builder?.githubUserId, "builder GitHub user id"),
      githubLogin: requireGitHubLogin(application.builder?.githubLogin, "builder GitHub login")
    }),
    companions: Object.freeze(companionSources),
    central: Object.freeze({
      repositorySlug: CENTRAL_REPOSITORY,
      repositoryUrl: `https://github.com/${CENTRAL_REPOSITORY}`,
      baseBranch: CENTRAL_BASE_BRANCH,
      baseCommit: centralBaseCommit,
      baseTree: centralBaseTree,
      priorApplicationRevision: normalizeNullableRevision(centralTarget.priorApplicationRevision),
      nextApplicationRevision: requireRevision(centralTarget.nextApplicationRevision, "next application revision")
    }),
    package: Object.freeze({
      digest: packageDigest,
      files: Object.freeze(packageFiles)
    })
  });
  normalizedPreparedValues.add(normalized);
  return normalized;
}

export function createGhTransport({ runner = defaultCommandRunner } = {}) {
  if (typeof runner !== "function") throw new TypeError("runner must be a function");
  const request = async ({ method = "GET", endpoint, body = null, allowNotFound = false }) => {
    if (!/^(?:GET|POST|PATCH)$/u.test(method)) fail("INTERNAL_ERROR", "unsupported GitHub API method");
    if (typeof endpoint !== "string" || !/^[A-Za-z0-9_./?%=&:+-]+$/u.test(endpoint) || endpoint.includes("..")) {
      fail("INTERNAL_ERROR", "unsafe GitHub API endpoint");
    }
    const args = [
      "api",
      "--hostname", "github.com",
      "--method", method,
      "--header", "Accept: application/vnd.github+json",
      "--header", "X-GitHub-Api-Version: 2022-11-28",
      endpoint
    ];
    let stdin = "";
    if (body !== null) {
      stdin = canonicalJson(body);
      if (Buffer.byteLength(stdin, "utf8") > MAX_API_INPUT_BYTES) {
        fail("GITHUB_REQUEST_TOO_LARGE", "the bounded GitHub request body is too large");
      }
      args.push("--input", "-");
    }
    const result = await runner({
      command: "gh",
      args,
      stdin,
      timeoutMs: 30_000,
      maxOutputBytes: MAX_API_OUTPUT_BYTES
    });
    const stdout = String(result?.stdout ?? "");
    const stderr = String(result?.stderr ?? "");
    if (Buffer.byteLength(stdout, "utf8") > MAX_API_OUTPUT_BYTES) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned an oversized response");
    }
    if (result?.status !== 0) {
      if (allowNotFound && /(?:HTTP\s*404|Not Found)/iu.test(stderr)) return null;
      fail("GITHUB_REQUEST_FAILED", sanitizeMessage(stderr) || "the GitHub request failed");
    }
    if (stdout.length === 0) return null;
    try {
      return JSON.parse(stdout);
    } catch {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned malformed JSON");
    }
  };

  return Object.freeze({
    async getViewer() {
      return request({ method: "GET", endpoint: "user" });
    },
    async getRepository(slug, { allowNotFound = false } = {}) {
      return request({ method: "GET", endpoint: `repos/${apiSlug(slug)}`, allowNotFound });
    },
    async getGitCommit(slug, commit) {
      return request({ method: "GET", endpoint: `repos/${apiSlug(slug)}/git/commits/${apiCommit(commit)}` });
    },
    async getRef(slug, branch, { allowNotFound = false } = {}) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(slug)}/git/ref/heads/${encodeURIComponent(requireBranch(branch, "GitHub branch"))}`,
        allowNotFound
      });
    },
    async getContent(slug, filePath, ref) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(slug)}/contents/${apiRepositoryPath(filePath)}?ref=${encodeURIComponent(apiCommit(ref))}`
      });
    },
    async listPullsByHead({ centralRepository, baseBranch, head }) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls?state=open&base=${encodeURIComponent(requireBranch(baseBranch, "base branch"))}&head=${encodeURIComponent(requireBoundedText(head, "pull-request head", 200))}&per_page=100`
      });
    },
    async searchOpenPulls({ centralRepository, login, title }) {
      requireGitHubLogin(login, "active GitHub account");
      const query = `repo:${requireRepositorySlug(centralRepository, "central repository")} is:pr is:open in:title \"${requireBoundedText(title, "pull-request title", 200)}\"`;
      return request({
        method: "GET",
        endpoint: `search/issues?q=${encodeURIComponent(query)}&per_page=${MAX_SEARCH_RESULTS}`
      });
    },
    async getPull(centralRepository, number) {
      return request({ method: "GET", endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}` });
    },
    async getPullFiles(centralRepository, number) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}/files?per_page=${MAX_PULL_FILES}`
      });
    },
    async getPullReviews(centralRepository, number) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}/reviews?per_page=${MAX_REVIEWS}`
      });
    },
    async getCheckRuns(centralRepository, commit) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(centralRepository)}/commits/${apiCommit(commit)}/check-runs?per_page=100`
      });
    },
    async compareBranch({ centralRepository, baseCommit, headLogin, headBranch }) {
      const head = `${requireGitHubLogin(headLogin, "comparison head login")}:${requireBranch(headBranch, "comparison head branch")}`;
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(centralRepository)}/compare/${apiCommit(baseCommit)}...${encodeURIComponent(head)}?per_page=100`
      });
    },
    async createFork(centralRepository) {
      return request({ method: "POST", endpoint: `repos/${apiSlug(centralRepository)}/forks`, body: {} });
    },
    async createTree(repository, { baseTree, files }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(repository)}/git/trees`,
        body: {
          base_tree: apiCommit(baseTree),
          tree: files.map(({ path: filePath, content }) => ({
            path: apiRepositoryPath(filePath),
            mode: "100644",
            type: "blob",
            content
          }))
        }
      });
    },
    async createCommit(repository, { message, tree, parents }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(repository)}/git/commits`,
        body: {
          message: requireBoundedMultilineText(message, "commit message", 500),
          tree: apiCommit(tree),
          parents: parents.map(apiCommit)
        }
      });
    },
    async createRef(repository, { branch, commit }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(repository)}/git/refs`,
        body: { ref: `refs/heads/${requireBranch(branch, "application branch")}`, sha: apiCommit(commit) }
      });
    },
    async updateRef(repository, { branch, commit }) {
      return request({
        method: "PATCH",
        endpoint: `repos/${apiSlug(repository)}/git/refs/heads/${encodeURIComponent(requireBranch(branch, "application branch"))}`,
        body: { sha: apiCommit(commit), force: false }
      });
    },
    async createDraftPull(centralRepository, { title, body, head, base }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls`,
        body: {
          title: requireBoundedText(title, "pull-request title", 200),
          body: requireBoundedMultilineText(body, "pull-request body", 64_000),
          head: requireBoundedText(head, "pull-request head", 200),
          base: requireBranch(base, "pull-request base"),
          draft: true,
          maintainer_can_modify: false
        }
      });
    },
    async updatePull(centralRepository, number, { title, body }) {
      return request({
        method: "PATCH",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}`,
        body: {
          title: requireBoundedText(title, "pull-request title", 200),
          body: requireBoundedMultilineText(body, "pull-request body", 64_000)
        }
      });
    }
  });
}

export async function planGitHubApplication({
  operation,
  prepared,
  transport,
  pullRequestNumber = null
}) {
  if (!new Set(["submit", "update"]).has(operation)) {
    fail("USAGE_ERROR", "operation must be submit or update", { exitCode: 2 });
  }
  assertTransport(transport);
  const normalizedPrepared = normalizePreparedApplication(prepared);
  const explicitPull = normalizeOptionalPullNumber(pullRequestNumber);
  const snapshot = await inspectRemoteState({ prepared: normalizedPrepared, transport, explicitPull });
  enforceIntake({ prepared: normalizedPrepared, snapshot, operation });

  const existingPull = snapshot.pullRequest;
  const exactRemotePackage = existingPull === null ? false : snapshot.remotePackage.matchesPrepared;
  if (operation === "update" && existingPull === null) {
    fail("APPLICATION_PULL_REQUEST_NOT_FOUND", "update requires the existing draft application pull request");
  }
  if (operation === "update" && (existingPull.state !== "open" || existingPull.draft !== true)) {
    fail("APPLICATION_PULL_REQUEST_NOT_DRAFT", "update requires one open draft application pull request");
  }
  if (operation === "submit" && existingPull !== null && !exactRemotePackage) {
    fail(
      "APPLICATION_ALREADY_OPEN_USE_UPDATE",
      "an application pull request already exists for this id; use update with its exact pull-request number"
    );
  }

  const externalWrites = [];
  const fork = snapshot.fork;
  const branchRef = snapshot.branchRef;
  const exactBranchPackage = snapshot.branchPackage?.matchesPrepared === true
    && (existingPull !== null || snapshot.branchRecovery?.matchesPrepared === true);
  if (!exactRemotePackage && !exactBranchPackage) {
    if (fork === null) externalWrites.push("create-viewer-fork");
    if (branchRef === null) externalWrites.push("create-application-branch-commit");
    else externalWrites.push("append-application-branch-commit-and-fast-forward");
  }
  if (existingPull === null) externalWrites.push("open-draft-pull-request");
  else if (existingPull.title !== normalizedPrepared.title || existingPull.body !== normalizedPrepared.body) {
    externalWrites.push("update-draft-pull-request-metadata");
  }

  const planWithoutDigest = {
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    operation,
    transport: "github-public-pr-beta-not-w2-application",
    activeAccount: snapshot.viewer,
    source: {
      ...normalizedPrepared.source,
      companions: snapshot.companionSources,
      observedPermission: snapshot.sourcePermission,
      repositoryAdministratorOwnershipProven: false,
      note: "GitHub push access proves revision-control capability only; it does not prove repository administrator ownership."
    },
    central: {
      ...normalizedPrepared.central,
      numericRepositoryId: snapshot.centralRepository.id,
      intake: snapshot.intake
    },
    application: {
      id: normalizedPrepared.applicationId,
      revision: normalizedPrepared.applicationRevision,
      directory: normalizedPrepared.applicationDirectory,
      packageDigest: normalizedPrepared.package.digest,
      files: normalizedPrepared.package.files.map(({ path: filePath, byteLength, sha256 }) => ({
        path: filePath,
        byteLength,
        sha256
      }))
    },
    pullRequest: existingPull === null ? null : publicPullProjection(existingPull, snapshot.remotePackage),
    fork: fork === null ? null : {
      numericRepositoryId: fork.id,
      repositorySlug: fork.fullName,
      branch: normalizedPrepared.branch,
      branchHead: branchRef?.commit ?? null,
      branchRecovery: snapshot.branchRecovery
    },
    proposedPullRequest: {
      title: normalizedPrepared.title,
      bodySha256: normalizedPrepared.bodySha256,
      base: `${CENTRAL_REPOSITORY}:${CENTRAL_BASE_BRANCH}`,
      head: `${snapshot.viewer.login}:${normalizedPrepared.branch}`,
      draft: true,
      maintainerCanModify: false
    },
    externalWrites,
    noAutomaticActions: [
      "no-approval",
      "no-merge",
      "no-ready-for-review-transition",
      "no-w2-application",
      "no-launch",
      "no-deployment"
    ],
    confirmation: {
      required: externalWrites.length > 0,
      flag: "--confirm-external-write",
      warning: "A confirmed run creates public Git history. Closing a pull request does not erase that history."
    }
  };
  const confirmationDigest = sha256Canonical(planWithoutDigest);
  return Object.freeze({ ...planWithoutDigest, confirmationDigest });
}

export async function executeGitHubApplication({
  operation,
  prepared,
  transport,
  confirmationDigest,
  pullRequestNumber = null,
  sleep = defaultSleep
}) {
  const normalizedPrepared = normalizePreparedApplication(prepared);
  const plan = await planGitHubApplication({ operation, prepared: normalizedPrepared, transport, pullRequestNumber });
  if (plan.externalWrites.length === 0) {
    const status = await readGitHubApplicationStatus({
      prepared: normalizedPrepared,
      transport,
      pullRequestNumber: plan.pullRequest?.number ?? pullRequestNumber
    });
    return executionResult({ plan, status, actions: [], alreadyApplied: true });
  }
  if (!DIGEST_PATTERN.test(confirmationDigest ?? "") || confirmationDigest !== plan.confirmationDigest) {
    fail(
      "EXTERNAL_WRITE_CONFIRMATION_REQUIRED",
      "rerun the read-only plan and pass its exact confirmation digest with --confirm-external-write",
      { details: { currentConfirmationDigest: plan.confirmationDigest } }
    );
  }

  await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
  const actions = [];
  let fork = plan.fork === null ? null : {
    id: plan.fork.numericRepositoryId,
    fullName: plan.fork.repositorySlug
  };
  if (plan.externalWrites.includes("create-viewer-fork")) {
    normalizeForkWriteResponse(await transport.createFork(CENTRAL_REPOSITORY));
    actions.push("created-viewer-fork");
    fork = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const observed = await transport.getRepository(`${plan.activeAccount.login}/${CENTRAL_REPOSITORY_NAME}`, { allowNotFound: true });
      if (observed !== null) {
        fork = normalizeRepository(observed, "viewer fork");
        validateFork(fork, plan.activeAccount, plan.central.numericRepositoryId);
        break;
      }
      await sleep(500);
    }
    if (fork === null) fail("FORK_NOT_READY", "the new GitHub fork is not readable yet; rerun with a fresh plan");
  }
  if (fork === null) fail("FORK_NOT_READY", "the viewer fork is unavailable");
  const forkSlug = fork.fullName;

  let branchRef = normalizeNullableRef(
    await transport.getRef(forkSlug, normalizedPrepared.branch, { allowNotFound: true }),
    normalizedPrepared.branch
  );
  if (!plan.externalWrites.includes("create-application-branch-commit")
      && !plan.externalWrites.includes("append-application-branch-commit-and-fast-forward")) {
    if (branchRef === null || branchRef.commit !== plan.fork?.branchHead) {
      fail("APPLICATION_BRANCH_CHANGED", "the confirmed application branch disappeared or changed");
    }
    if (plan.pullRequest === null) {
      const recovery = await inspectRecoverableBranch({
        prepared: normalizedPrepared,
        transport,
        viewer: plan.activeAccount,
        branchCommit: branchRef.commit
      });
      if (recovery.matchesPrepared !== true) {
        fail("APPLICATION_BRANCH_RECOVERY_INVALID", "the existing branch is not the exact one-commit recovery package");
      }
      await verifyPackageAtRef({
        prepared: normalizedPrepared,
        transport,
        repository: forkSlug,
        commit: branchRef.commit
      });
    }
  } else {
    const expectedHead = plan.fork?.branchHead ?? null;
    if ((branchRef?.commit ?? null) !== expectedHead) {
      fail("APPLICATION_BRANCH_CHANGED", "the application branch changed after confirmation; create a fresh plan");
    }
    await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
    const tree = normalizeCreatedTree(await transport.createTree(forkSlug, {
      baseTree: normalizedPrepared.central.baseTree,
      files: normalizedPrepared.package.files
    }));
    const parents = branchRef === null
      ? [normalizedPrepared.central.baseCommit]
      : uniqueStrings([branchRef.commit, normalizedPrepared.central.baseCommit]);
    const commit = normalizeCreatedCommit(await transport.createCommit(forkSlug, {
      message: `chore(builder): ${operation} ${normalizedPrepared.applicationId} revision ${normalizedPrepared.applicationRevision}\n\nPackage: ${normalizedPrepared.package.digest}`,
      tree: tree.sha,
      parents
    }), tree.sha);
    const preRef = normalizeNullableRef(
      await transport.getRef(forkSlug, normalizedPrepared.branch, { allowNotFound: true }),
      normalizedPrepared.branch
    );
    if ((preRef?.commit ?? null) !== (branchRef?.commit ?? null)) {
      fail("APPLICATION_BRANCH_CHANGED", "the application branch raced the confirmed write; no ref was updated");
    }
    await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
    if (branchRef === null) {
      normalizeRef(await transport.createRef(forkSlug, {
        branch: normalizedPrepared.branch,
        commit: commit.sha
      }), normalizedPrepared.branch);
      actions.push("created-application-branch");
    } else {
      normalizeRef(await transport.updateRef(forkSlug, {
        branch: normalizedPrepared.branch,
        commit: commit.sha
      }), normalizedPrepared.branch);
      actions.push("updated-application-branch");
    }
    branchRef = normalizeRef(
      await transport.getRef(forkSlug, normalizedPrepared.branch),
      normalizedPrepared.branch
    );
    if (branchRef.commit !== commit.sha) {
      fail("APPLICATION_BRANCH_VERIFY_FAILED", "GitHub did not retain the exact application commit");
    }
    await verifyPackageAtRef({
      prepared: normalizedPrepared,
      transport,
      repository: forkSlug,
      commit: commit.sha
    });
  }

  await assertAuthoritySnapshotUnchanged({ prepared: normalizedPrepared, transport, plan });
  let pull = plan.pullRequest === null
    ? null
    : normalizePull(await transport.getPull(CENTRAL_REPOSITORY, plan.pullRequest.number));
  if (pull === null) {
    const duplicateSnapshot = await discoverApplicationPull({
      prepared: normalizedPrepared,
      transport,
      viewer: plan.activeAccount,
      explicitPull: null
    });
    if (duplicateSnapshot.pullRequest !== null) {
      fail("APPLICATION_PULL_REQUEST_RACE", "an application pull request appeared after confirmation; no duplicate was opened");
    }
    const prePullRef = normalizeRef(
      await transport.getRef(forkSlug, normalizedPrepared.branch),
      normalizedPrepared.branch
    );
    if (prePullRef.commit !== branchRef.commit) {
      fail("APPLICATION_BRANCH_CHANGED", "the application branch changed before draft creation");
    }
    const createdPullNumber = normalizePullWriteResponse(await transport.createDraftPull(CENTRAL_REPOSITORY, {
      title: normalizedPrepared.title,
      body: normalizedPrepared.body,
      head: `${plan.activeAccount.login}:${normalizedPrepared.branch}`,
      base: CENTRAL_BASE_BRANCH
    }));
    pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, createdPullNumber));
    actions.push("opened-draft-pull-request");
  } else if (plan.externalWrites.includes("update-draft-pull-request-metadata")) {
    assertOpenDraftPullTarget({
      pull,
      plan,
      prepared: normalizedPrepared,
      fork,
      requireMetadataMatch: false
    });
    if (pull.head.sha !== branchRef.commit) {
      fail("APPLICATION_BRANCH_CHANGED", "the application pull request head changed before its metadata update");
    }
    const updatedPullNumber = normalizePullWriteResponse(await transport.updatePull(CENTRAL_REPOSITORY, pull.number, {
      title: normalizedPrepared.title,
      body: normalizedPrepared.body
    }));
    if (updatedPullNumber !== pull.number) {
      fail("GITHUB_WRITE_VERIFY_FAILED", "GitHub updated a different pull request");
    }
    pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, updatedPullNumber));
    actions.push("updated-draft-pull-request-metadata");
  }

  const finalPull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, pull.number));
  assertOpenDraftPullTarget({ pull: finalPull, plan, prepared: normalizedPrepared, fork });
  if (finalPull.head.sha !== branchRef.commit) {
    fail("PULL_REQUEST_VERIFY_FAILED", "the draft pull request does not point to the exact application branch commit");
  }
  const remotePackage = await verifyPullPackage({
    prepared: normalizedPrepared,
    transport,
    pull: finalPull,
    requireMatch: true
  });
  const status = await buildStatus({ prepared: normalizedPrepared, transport, pull: finalPull, remotePackage });
  return executionResult({ plan, status, actions, alreadyApplied: false });
}

export async function readGitHubApplicationStatus({
  prepared,
  transport,
  pullRequestNumber = null
}) {
  assertTransport(transport);
  const normalizedPrepared = normalizePreparedApplication(prepared);
  const explicitPull = normalizeOptionalPullNumber(pullRequestNumber);
  const viewer = normalizeViewer(await transport.getViewer());
  assertViewerMatchesBuilder(viewer, normalizedPrepared.builder);
  const centralRepository = normalizeRepository(
    await transport.getRepository(CENTRAL_REPOSITORY),
    "central repository"
  );
  validateCentralRepository(centralRepository);
  const discovered = await discoverApplicationPull({
    prepared: normalizedPrepared,
    transport,
    viewer,
    explicitPull,
    explicitOnly: explicitPull !== null
  });
  if (discovered.pullRequest === null) {
    fail("APPLICATION_PULL_REQUEST_NOT_FOUND", "no GitHub application pull request was found for this prepared package");
  }
  if (discovered.pullRequest.base.repositoryId !== centralRepository.id) {
    fail("APPLICATION_PULL_REQUEST_MISMATCH", "the selected pull request targets a different central repository id");
  }
  const remotePackage = await verifyPullPackage({
    prepared: normalizedPrepared,
    transport,
    pull: discovered.pullRequest,
    requireMatch: false
  });
  return buildStatus({
    prepared: normalizedPrepared,
    transport,
    pull: discovered.pullRequest,
    remotePackage
  });
}

export function writeLocalReceipt({ receiptDirectory, sourceRepositoryRoot, receipt }) {
  if (!isPlainObject(receipt)) fail("RECEIPT_INVALID", "receipt payload is invalid");
  const repositoryRoot = resolveDirectory(sourceRepositoryRoot, "source repository root");
  const directory = resolveDirectory(receiptDirectory, "receipt directory");
  if (pathsOverlap(repositoryRoot, directory)) {
    fail("RECEIPT_PATH_INVALID", "the receipt directory must be completely outside the source repository");
  }
  const applicationId = requireApplicationId(receipt.applicationId, "receipt application id");
  const pullRequestNumber = apiPullNumber(receipt.pullRequestNumber);
  const pullRequestUrl = requirePullUrl(receipt.pullRequestUrl);
  if (!pullRequestUrl.endsWith(`/pull/${pullRequestNumber}`)) {
    fail("RECEIPT_INVALID", "receipt pull-request URL and number disagree");
  }
  if (!GITHUB_APPLICATION_STATUSES.includes(receipt.githubStatus)) {
    fail("RECEIPT_INVALID", "receipt GitHub status is unsupported");
  }
  if (!Array.isArray(receipt.externalActionsPerformed) || receipt.externalActionsPerformed.length > 10) {
    fail("RECEIPT_INVALID", "receipt external-action list is malformed");
  }
  const externalActionsPerformed = receipt.externalActionsPerformed.map((value) => (
    requireBoundedText(value, "receipt external action", 100)
  ));
  const confirmationDigest = receipt.confirmationDigest === null
    ? null
    : requireDigest(receipt.confirmationDigest, "receipt confirmation digest");
  const contentWithoutDigest = {
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    kind: "programmable-public-github-pr-beta-local-receipt",
    applicationId,
    applicationRevision: requireRevision(receipt.applicationRevision, "receipt application revision"),
    pullRequestNumber: Number(pullRequestNumber),
    pullRequestUrl,
    githubStatus: receipt.githubStatus,
    headCommit: requireCommit(receipt.headCommit, "receipt head commit"),
    packageMatchesPrepared: requireBoolean(receipt.packageMatchesPrepared, "receipt package match"),
    preparedPackageDigest: requireDigest(receipt.preparedPackageDigest, "receipt package digest"),
    confirmationDigest,
    externalActionsPerformed,
    authorityBoundary: "GitHub PR transport receipt only; not W2 submission, approval, audit, deployment, launch, or repository-admin ownership."
  };
  const receiptDigest = sha256Canonical(contentWithoutDigest);
  const content = `${canonicalJson({ ...contentWithoutDigest, receiptDigest })}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_RECEIPT_BYTES) {
    fail("RECEIPT_INVALID", "the local receipt exceeds the bounded receipt size");
  }
  const filename = `${applicationId}-pr-${pullRequestNumber}-${receiptDigest.slice("sha256:".length, "sha256:".length + 16)}.json`;
  const target = path.join(directory, filename);
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || fs.readFileSync(target, "utf8") !== content) {
      fail("RECEIPT_EXISTS", "a different receipt already occupies the deterministic receipt path");
    }
    return { path: target, receiptDigest, created: false };
  }
  const temporary = path.join(directory, `.${filename}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // The primary bounded receipt error is reported below.
    }
    fail("RECEIPT_WRITE_FAILED", error?.message ?? "the local receipt could not be written");
  }
  return { path: target, receiptDigest, created: true };
}

async function inspectRemoteState({ prepared, transport, explicitPull }) {
  const viewer = normalizeViewer(await transport.getViewer());
  assertViewerMatchesBuilder(viewer, prepared.builder);
  const centralRepository = normalizeRepository(await transport.getRepository(CENTRAL_REPOSITORY), "central repository");
  validateCentralRepository(centralRepository);
  const sourceRepository = normalizeRepository(await transport.getRepository(prepared.source.repositorySlug), "source repository");
  if (
    sourceRepository.fullName.toLowerCase() !== prepared.source.repositorySlug.toLowerCase()
    || sourceRepository.id !== prepared.source.numericRepositoryId
    || sourceRepository.htmlUrl !== prepared.source.repositoryUrl
    || sourceRepository.private !== false
  ) {
    fail("SOURCE_REPOSITORY_CHANGED", "the exact source repository identity changed after prepare-pr");
  }
  if (sourceRepository.permissions.push !== true) {
    fail("SOURCE_WRITE_ACCESS_REQUIRED", "the active GitHub account no longer has write access to the exact source repository");
  }
  const sourceCommit = normalizeGitCommit(
    await transport.getGitCommit(prepared.source.repositorySlug, prepared.source.commit),
    "source commit"
  );
  if (sourceCommit.sha !== prepared.source.commit || sourceCommit.tree !== prepared.source.tree) {
    fail("SOURCE_REVISION_CHANGED", "GitHub does not resolve the exact prepared source commit and tree");
  }
  const sourceRef = normalizeRef(
    await transport.getRef(prepared.source.repositorySlug, prepared.source.branch),
    prepared.source.branch
  );
  if (sourceRef.commit !== prepared.source.commit) {
    fail("SOURCE_BRANCH_ADVANCED", "the prepared source branch no longer points to the exact prepared commit");
  }
  const companionSources = await inspectCompanionSources({ prepared, transport });
  const baseRef = normalizeRef(
    await transport.getRef(CENTRAL_REPOSITORY, CENTRAL_BASE_BRANCH),
    CENTRAL_BASE_BRANCH
  );
  if (baseRef.commit !== prepared.central.baseCommit) {
    fail("PREPARE_PR_STALE", "Submit a Launch main changed after prepare-pr; regenerate the six-file package");
  }
  const centralCommit = normalizeGitCommit(
    await transport.getGitCommit(CENTRAL_REPOSITORY, prepared.central.baseCommit),
    "central base commit"
  );
  if (centralCommit.tree !== prepared.central.baseTree) {
    fail("PREPARE_PR_STALE", "the prepared central base tree no longer matches GitHub");
  }
  const intake = await readIntakeStatus({ transport, commit: prepared.central.baseCommit });
  const forkValue = await transport.getRepository(`${viewer.login}/${CENTRAL_REPOSITORY_NAME}`, { allowNotFound: true });
  const fork = forkValue === null ? null : normalizeRepository(forkValue, "viewer fork");
  if (fork !== null) validateFork(fork, viewer, centralRepository.id);
  const branchRef = fork === null
    ? null
    : normalizeNullableRef(
      await transport.getRef(fork.fullName, prepared.branch, { allowNotFound: true }),
      prepared.branch
    );
  const discovered = await discoverApplicationPull({ prepared, transport, viewer, explicitPull });
  if (discovered.pullRequest !== null && discovered.pullRequest.base.repositoryId !== centralRepository.id) {
    fail("APPLICATION_PULL_REQUEST_MISMATCH", "the application pull request targets a different central repository id");
  }
  const remotePackage = discovered.pullRequest === null
    ? null
    : await verifyPullPackage({
      prepared,
      transport,
      pull: discovered.pullRequest,
      requireMatch: false
    });
  const branchPackage = branchRef === null
    ? null
    : await inspectPackageAtRef({
      prepared,
      transport,
      repository: fork.fullName,
      commit: branchRef.commit
    });
  const branchRecovery = (
    branchRef !== null
    && discovered.pullRequest === null
    && branchPackage.matchesPrepared === true
  ) ? await inspectRecoverableBranch({
      prepared,
      transport,
      viewer,
      branchCommit: branchRef.commit
    }) : null;
  if (discovered.pullRequest !== null && fork !== null) {
    if (
      discovered.pullRequest.head.repositoryId !== fork.id
      || discovered.pullRequest.head.repositorySlug.toLowerCase() !== fork.fullName.toLowerCase()
      || discovered.pullRequest.head.ref !== prepared.branch
    ) {
      fail("APPLICATION_PULL_REQUEST_TARGET_INVALID", "the existing application pull request uses a different fork or branch");
    }
    if (branchRef === null || discovered.pullRequest.head.sha !== branchRef.commit) {
      fail("APPLICATION_BRANCH_CHANGED", "the existing pull request and application branch disagree");
    }
  }
  return {
    viewer,
    centralRepository,
    sourcePermission: {
      push: true,
      admin: sourceRepository.permissions.admin,
      maintain: sourceRepository.permissions.maintain
    },
    companionSources,
    intake,
    fork,
    branchRef,
    branchPackage,
    branchRecovery,
    pullRequest: discovered.pullRequest,
    remotePackage
  };
}

async function inspectCompanionSources({ prepared, transport }) {
  const observed = [];
  for (const companion of prepared.companions) {
    const repository = normalizeRepository(
      await transport.getRepository(companion.repositorySlug),
      "companion source repository"
    );
    if (
      repository.fullName.toLowerCase() !== companion.repositorySlug.toLowerCase()
      || repository.id !== companion.numericRepositoryId
      || repository.htmlUrl !== companion.repositoryUrl
      || repository.private !== false
    ) {
      fail("SOURCE_COMPANION_CHANGED", "an exact public companion repository identity changed after prepare-pr");
    }
    const commit = normalizeGitCommit(
      await transport.getGitCommit(companion.repositorySlug, companion.commit),
      "companion source commit"
    );
    if (commit.sha !== companion.commit || commit.tree !== companion.tree) {
      fail("SOURCE_COMPANION_REVISION_CHANGED", "GitHub does not resolve an exact prepared companion commit and tree");
    }
    observed.push(Object.freeze({
      ...companion,
      public: true,
      exactCommitReachable: true
    }));
  }
  return Object.freeze(observed);
}

async function discoverApplicationPull({ prepared, transport, viewer, explicitPull, explicitOnly = false }) {
  const candidates = new Map();
  if (explicitPull !== null) {
    const pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, explicitPull));
    candidates.set(pull.number, pull);
  }
  if (!explicitOnly) {
    const byHead = normalizePullNumberList(await transport.listPullsByHead({
      centralRepository: CENTRAL_REPOSITORY,
      baseBranch: CENTRAL_BASE_BRANCH,
      head: `${viewer.login}:${prepared.branch}`
    }));
    for (const number of byHead) {
      if (!candidates.has(number)) {
        const pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, number));
        candidates.set(number, pull);
      }
    }
    const search = normalizeSearch(await transport.searchOpenPulls({
      centralRepository: CENTRAL_REPOSITORY,
      login: viewer.login,
      title: prepared.title
    }));
    for (const number of search) {
      if (!candidates.has(number)) {
        const pull = normalizePull(await transport.getPull(CENTRAL_REPOSITORY, number));
        candidates.set(number, pull);
      }
    }
  }

  const collisions = [];
  for (const pull of candidates.values()) {
    const files = normalizePullFiles(
      await transport.getPullFiles(CENTRAL_REPOSITORY, pull.number),
      pull.changedFiles
    );
    const touchesApplication = files.some((record) => (
      record.filename === prepared.applicationDirectory
      || record.filename.startsWith(`${prepared.applicationDirectory}/`)
      || record.previousFilename === prepared.applicationDirectory
      || record.previousFilename?.startsWith(`${prepared.applicationDirectory}/`)
    ));
    const deterministicHead = pull.head.ref === prepared.branch;
    const canonicalTitle = pull.title === prepared.title;
    if (touchesApplication || deterministicHead || canonicalTitle || pull.number === explicitPull) {
      validatePullIdentity({ pull, files, prepared, viewer, explicit: pull.number === explicitPull });
      collisions.push(pull);
    }
  }
  if (collisions.length > 1) {
    fail("DUPLICATE_APPLICATION_PULL_REQUESTS", "multiple pull requests claim the same application id or deterministic branch");
  }
  if (explicitPull !== null && collisions.length !== 1) {
    fail("APPLICATION_PULL_REQUEST_MISMATCH", "the selected pull request is not the exact prepared application");
  }
  return { pullRequest: collisions[0] ?? null };
}

function validatePullIdentity({ pull, files, prepared, viewer, explicit }) {
  if (
    pull.user.id !== viewer.id
    || pull.user.login.toLowerCase() !== viewer.login.toLowerCase()
    || pull.base.repositorySlug !== CENTRAL_REPOSITORY
    || pull.base.ref !== CENTRAL_BASE_BRANCH
    || pull.base.sha !== prepared.central.baseCommit
    || pull.head.ref !== prepared.branch
    || pull.title !== prepared.title
  ) {
    fail(
      explicit ? "APPLICATION_PULL_REQUEST_MISMATCH" : "APPLICATION_PULL_REQUEST_COLLISION",
      "a pull request claims the application id but has a different author, title, base, or deterministic branch"
    );
  }
  const expected = new Set(prepared.package.files.map(({ path: filePath }) => filePath));
  if (
    files.length !== expected.size
    || files.some((record) => !expected.has(record.filename) || record.status === "removed" || record.previousFilename !== null)
  ) {
    fail("APPLICATION_PULL_REQUEST_PATHS_INVALID", "the application pull request must change exactly the six frozen application paths");
  }
}

async function verifyPullPackage({ prepared, transport, pull, requireMatch }) {
  const files = normalizePullFiles(
    await transport.getPullFiles(CENTRAL_REPOSITORY, pull.number),
    pull.changedFiles
  );
  const expected = new Map(prepared.package.files.map((record) => [record.path, record]));
  if (
    files.length !== expected.size
    || files.some((record) => !expected.has(record.filename) || record.status === "removed" || record.previousFilename !== null)
  ) {
    fail("APPLICATION_PULL_REQUEST_PATHS_INVALID", "the pull request does not contain exactly the six frozen application paths");
  }
  const repository = pull.head.repositorySlug;
  const observed = [];
  for (const [filePath, expectedRecord] of expected) {
    const bytes = normalizeContent(
      await transport.getContent(repository, filePath, pull.head.sha),
      filePath
    );
    observed.push({ path: filePath, byteLength: bytes.length, sha256: sha256Bytes(bytes) });
    if (
      bytes.length !== expectedRecord.byteLength
      || sha256Bytes(bytes) !== expectedRecord.sha256
      || utf8Decoder.decode(bytes) !== expectedRecord.content
    ) {
      if (requireMatch) {
        fail("REMOTE_PACKAGE_MISMATCH", "the pull request does not contain the exact confirmed six-file package");
      }
    }
  }
  const matchesPrepared = observed.every((record) => {
    const expectedRecord = expected.get(record.path);
    return record.byteLength === expectedRecord.byteLength && record.sha256 === expectedRecord.sha256;
  });
  return {
    matchesPrepared,
    preparedPackageDigest: prepared.package.digest,
    observedFiles: observed
  };
}

async function verifyPackageAtRef({ prepared, transport, repository, commit }) {
  for (const record of prepared.package.files) {
    const bytes = normalizeContent(await transport.getContent(repository, record.path, commit), record.path);
    if (
      bytes.length !== record.byteLength
      || sha256Bytes(bytes) !== record.sha256
      || utf8Decoder.decode(bytes) !== record.content
    ) {
      fail("APPLICATION_BRANCH_VERIFY_FAILED", "the application branch does not contain the exact six-file package");
    }
  }
}

async function inspectPackageAtRef({ prepared, transport, repository, commit }) {
  const observed = [];
  for (const record of prepared.package.files) {
    const bytes = normalizeContent(await transport.getContent(repository, record.path, commit), record.path);
    observed.push({ path: record.path, byteLength: bytes.length, sha256: sha256Bytes(bytes) });
  }
  return {
    matchesPrepared: observed.every((record) => {
      const expected = prepared.package.files.find(({ path: filePath }) => filePath === record.path);
      return expected.byteLength === record.byteLength && expected.sha256 === record.sha256;
    }),
    observedFiles: observed
  };
}

async function inspectRecoverableBranch({ prepared, transport, viewer, branchCommit }) {
  const comparison = await transport.compareBranch({
    centralRepository: CENTRAL_REPOSITORY,
    baseCommit: prepared.central.baseCommit,
    headLogin: viewer.login,
    headBranch: prepared.branch
  });
  if (
    !isPlainObject(comparison)
    || !isPlainObject(comparison.base_commit)
    || !isPlainObject(comparison.merge_base_commit)
    || !Array.isArray(comparison.commits)
    || !Array.isArray(comparison.files)
  ) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub branch comparison output is malformed");
  }
  const baseCommit = requireCommit(comparison.base_commit.sha, "comparison base commit");
  const mergeBaseCommit = requireCommit(comparison.merge_base_commit.sha, "comparison merge-base commit");
  if (baseCommit !== prepared.central.baseCommit || mergeBaseCommit !== prepared.central.baseCommit) {
    fail("APPLICATION_BRANCH_BASE_CHANGED", "the existing recovery branch is not based on the exact prepared central commit");
  }
  const aheadBy = requireApiInteger(comparison.ahead_by, "comparison ahead count", 0, 1_000_000);
  const behindBy = requireApiInteger(comparison.behind_by, "comparison behind count", 0, 1_000_000);
  const totalCommits = requireApiInteger(comparison.total_commits, "comparison commit count", 0, 1_000_000);
  if (comparison.commits.length > 100 || comparison.commits.length > totalCommits) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub returned an invalid or oversized comparison commit list");
  }
  const commitIds = comparison.commits.map((record) => requireCommit(record?.sha, "comparison commit"));
  const files = normalizePullFiles(comparison.files, comparison.files.length);
  const expectedPaths = new Set(prepared.package.files.map(({ path: filePath }) => filePath));
  const filesMatch = files.length === expectedPaths.size && files.every((record) => (
    expectedPaths.has(record.filename)
    && record.status !== "removed"
    && record.status !== "renamed"
    && record.previousFilename === null
  ));
  const matchesPrepared = aheadBy === 1
    && behindBy === 0
    && totalCommits === 1
    && commitIds.length === 1
    && commitIds[0] === branchCommit
    && filesMatch;
  return Object.freeze({
    matchesPrepared,
    baseCommit,
    headCommit: branchCommit,
    aheadBy,
    behindBy,
    totalCommits,
    files: Object.freeze(files.map(({ filename, status }) => ({ path: filename, status })))
  });
}

async function buildStatus({ prepared, transport, pull, remotePackage }) {
  const reviews = normalizeReviews(await transport.getPullReviews(CENTRAL_REPOSITORY, pull.number));
  const checks = normalizeCheckRuns(await transport.getCheckRuns(CENTRAL_REPOSITORY, pull.head.sha));
  const status = projectNormalizedGitHubStatus({ pull, reviews, checks });
  return Object.freeze({
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    applicationId: prepared.applicationId,
    applicationRevision: prepared.applicationRevision,
    status,
    pullRequestNumber: pull.number,
    pullRequestUrl: pull.htmlUrl,
    pullRequestState: pull.state,
    draft: pull.draft,
    mergedAt: pull.mergedAt,
    headCommit: pull.head.sha,
    packageMatchesPrepared: remotePackage.matchesPrepared,
    preparedPackageDigest: prepared.package.digest,
    checks: {
      total: checks.length,
      running: checks.filter((check) => check.status !== "completed").map((check) => check.name),
      failed: checks.filter((check) => check.status === "completed" && !new Set(["success", "neutral", "skipped"]).has(check.conclusion)).map((check) => check.name)
    },
    reviews: {
      changesRequested: latestChangesRequested(reviews),
      count: reviews.length
    },
    authorityBoundary: "GitHub review status only; not W2 application status, approval, audit, deployment, launch, provider support, or Uniswap endorsement."
  });
}

export function projectGitHubStatus({ pull, reviews, checks }) {
  const normalizedPull = normalizePull(pull);
  const normalizedReviews = normalizeReviews(reviews);
  const normalizedChecks = normalizeCheckRuns(checks);
  return projectNormalizedGitHubStatus({
    pull: normalizedPull,
    reviews: normalizedReviews,
    checks: normalizedChecks
  });
}

function projectNormalizedGitHubStatus({ pull: normalizedPull, reviews: normalizedReviews, checks: normalizedChecks }) {
  if (normalizedPull.mergedAt !== null) return "review-record-merged";
  if (normalizedPull.state === "closed") return "closed";
  if (latestChangesRequested(normalizedReviews).length > 0) return "changes-requested";
  if (normalizedChecks.some((check) => (
    check.status === "completed"
    && !new Set(["success", "neutral", "skipped"]).has(check.conclusion)
  ))) return "changes-requested";
  if (normalizedChecks.some((check) => check.status !== "completed")) return "checks-running";
  if (normalizedPull.draft === true) return "submitted";
  return "waiting-review";
}

async function assertAuthoritySnapshotUnchanged({ prepared, transport, plan }) {
  const viewer = normalizeViewer(await transport.getViewer());
  if (canonicalJson(viewer) !== canonicalJson(plan.activeAccount)) {
    fail("ACTIVE_ACCOUNT_CHANGED", "the active GitHub account changed after confirmation");
  }
  const sourceRepository = normalizeRepository(await transport.getRepository(prepared.source.repositorySlug), "source repository");
  if (
    sourceRepository.fullName.toLowerCase() !== prepared.source.repositorySlug.toLowerCase()
    || sourceRepository.id !== prepared.source.numericRepositoryId
    || sourceRepository.htmlUrl !== prepared.source.repositoryUrl
    || sourceRepository.private !== false
    || sourceRepository.permissions.push !== true
  ) {
    fail("SOURCE_REPOSITORY_CHANGED", "source identity or write access changed after confirmation");
  }
  const sourceCommit = normalizeGitCommit(
    await transport.getGitCommit(prepared.source.repositorySlug, prepared.source.commit),
    "source commit"
  );
  if (sourceCommit.sha !== prepared.source.commit || sourceCommit.tree !== prepared.source.tree) {
    fail("SOURCE_REVISION_CHANGED", "the exact source commit or tree changed after confirmation");
  }
  const sourceRef = normalizeRef(
    await transport.getRef(prepared.source.repositorySlug, prepared.source.branch),
    prepared.source.branch
  );
  if (sourceRef.commit !== prepared.source.commit) {
    fail("SOURCE_BRANCH_ADVANCED", "the exact source branch changed after confirmation");
  }
  await inspectCompanionSources({ prepared, transport });
  const centralRepository = normalizeRepository(
    await transport.getRepository(CENTRAL_REPOSITORY),
    "central repository"
  );
  validateCentralRepository(centralRepository);
  if (centralRepository.id !== plan.central.numericRepositoryId) {
    fail("CENTRAL_REPOSITORY_MISMATCH", "the fixed central repository identity changed after confirmation");
  }
  const baseRef = normalizeRef(
    await transport.getRef(CENTRAL_REPOSITORY, CENTRAL_BASE_BRANCH),
    CENTRAL_BASE_BRANCH
  );
  if (baseRef.commit !== prepared.central.baseCommit) {
    fail("PREPARE_PR_STALE", "Submit a Launch main changed after confirmation; the public pull request was not opened");
  }
  const centralCommit = normalizeGitCommit(
    await transport.getGitCommit(CENTRAL_REPOSITORY, prepared.central.baseCommit),
    "central base commit"
  );
  if (centralCommit.tree !== prepared.central.baseTree) {
    fail("PREPARE_PR_STALE", "the exact central base tree changed after confirmation");
  }
  const intake = await readIntakeStatus({ transport, commit: prepared.central.baseCommit });
  if (canonicalJson(intake) !== canonicalJson(plan.central.intake)) {
    fail("INTAKE_STATE_CHANGED", "the trusted intake state changed after confirmation");
  }
}

async function readIntakeStatus({ transport, commit }) {
  const bytes = normalizeContent(
    await transport.getContent(CENTRAL_REPOSITORY, INTAKE_STATUS_PATH, commit),
    INTAKE_STATUS_PATH,
    MAX_INTAKE_BYTES
  );
  let source;
  let document;
  try {
    source = utf8Decoder.decode(bytes);
    document = JSON.parse(source);
  } catch {
    fail("INTAKE_STATUS_INVALID", "the trusted intake status is not valid canonical UTF-8 JSON");
  }
  if (
    source !== `${canonicalJson(document)}\n`
    || !hasExactKeys(document, ["continuingPullRequests", "schemaVersion", "state"])
    || document.schemaVersion !== 2
    || !new Set(["prelaunch", "open", "paused-new", "paused-all"]).has(document.state)
    || !Array.isArray(document.continuingPullRequests)
    || document.continuingPullRequests.length > 32
  ) {
    fail("INTAKE_STATUS_INVALID", "the trusted intake status is malformed or unsupported");
  }
  let continuations;
  try {
    continuations = document.continuingPullRequests.map(normalizeContinuation);
  } catch {
    fail("INTAKE_STATUS_INVALID", "a trusted intake continuation record is malformed");
  }
  if (document.state !== "paused-new" && continuations.length !== 0) {
    fail("INTAKE_STATUS_INVALID", "trusted continuations may exist only while new application ids are paused");
  }
  for (let index = 1; index < continuations.length; index += 1) {
    if (compareContinuations(continuations[index - 1], continuations[index]) >= 0) {
      fail("INTAKE_STATUS_INVALID", "trusted intake continuations are not uniquely and canonically ordered");
    }
  }
  if (
    new Set(continuations.map((record) => record.pullRequestNumber)).size !== continuations.length
    || new Set(continuations.map((record) => record.applicationId)).size !== continuations.length
  ) {
    fail("INTAKE_STATUS_INVALID", "trusted intake continuations contain duplicate identities");
  }
  return Object.freeze({
    schemaVersion: 2,
    state: document.state,
    sha256: sha256Bytes(bytes),
    continuingPullRequests: Object.freeze(continuations)
  });
}

function enforceIntake({ prepared, snapshot, operation }) {
  const state = snapshot.intake.state;
  if (state === "open") return;
  if (state === "prelaunch") fail("INTAKE_PRELAUNCH", "Public Builder Beta applications are not open yet");
  if (state === "paused-all") fail("INTAKE_PAUSED_ALL", "Public Builder Beta intake is paused for every application change");
  const existingOnBase = prepared.central.priorApplicationRevision !== null;
  if (state === "paused-new" && existingOnBase) return;
  if (state === "paused-new" && snapshot.pullRequest !== null) {
    const exact = snapshot.intake.continuingPullRequests.find((record) => (
      record.pullRequestNumber === String(snapshot.pullRequest.number)
      && record.applicationId === prepared.applicationId
      && record.builderGitHubUserId === prepared.builder.githubUserId
      && record.primaryNumericRepositoryId === prepared.source.numericRepositoryId
      && arraysEqual(
        record.companionNumericRepositoryIds,
        prepared.companions.map(({ numericRepositoryId }) => numericRepositoryId)
      )
    ));
    if (exact) return;
  }
  fail(
    "INTAKE_PAUSED_NEW",
    operation === "update"
      ? "this draft is not an exact trusted continuation while new application ids are paused"
      : "new application ids are paused; no new draft pull request will be opened"
  );
}

function executionResult({ plan, status, actions, alreadyApplied }) {
  return Object.freeze({
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    operation: plan.operation,
    applicationId: plan.application.id,
    applicationRevision: plan.application.revision,
    confirmationDigest: plan.confirmationDigest,
    actions,
    alreadyApplied,
    status,
    externalActionsPerformed: actions,
    neverPerformed: ["approve", "merge", "mark-ready", "create-w2-application", "deploy", "launch"]
  });
}

function publicPullProjection(pull, remotePackage) {
  return {
    number: pull.number,
    url: pull.htmlUrl,
    state: pull.state,
    draft: pull.draft,
    author: pull.user,
    head: pull.head,
    base: pull.base,
    title: pull.title,
    bodySha256: sha256Bytes(Buffer.from(pull.body, "utf8")),
    packageMatchesPrepared: remotePackage.matchesPrepared
  };
}

function assertOpenDraftPullTarget({ pull, plan, prepared, fork, requireMetadataMatch = true }) {
  if (
    pull.state !== "open"
    || pull.draft !== true
    || pull.user.id !== plan.activeAccount.id
    || pull.user.login.toLowerCase() !== plan.activeAccount.login.toLowerCase()
    || pull.base.repositoryId !== plan.central.numericRepositoryId
    || pull.base.repositorySlug !== CENTRAL_REPOSITORY
    || pull.base.ref !== CENTRAL_BASE_BRANCH
    || pull.base.sha !== prepared.central.baseCommit
    || pull.head.repositoryId !== fork.id
    || pull.head.repositorySlug.toLowerCase() !== fork.fullName.toLowerCase()
    || pull.head.ref !== prepared.branch
    || (requireMetadataMatch && pull.title !== prepared.title)
    || (requireMetadataMatch && pull.body !== prepared.body)
  ) {
    fail("PULL_REQUEST_VERIFY_FAILED", "the opened or updated pull request does not match the confirmed draft target");
  }
}

function validateApplicationProjection({
  application,
  applicationId,
  files,
  sourceRepositoryUrl,
  sourceRepositoryId,
  sourceCommit,
  sourceTree,
  sourceRequest,
  centralPackage,
  centralTarget,
  submission,
  applicationAdapter
}) {
  if (
    !isPlainObject(application)
    || application.schemaVersion !== 2
    || application.applicationId !== applicationId
    || requireRevision(application.applicationRevision, "application revision") !== centralPackage.applicationRevision
    || application.applicationRevision !== centralTarget.nextApplicationRevision
    || application.applicationRevision !== applicationAdapter.applicationRevision
    || submission.intakeValidated !== true
    || applicationAdapter.publicGitHubApplicationReady !== true
    || applicationAdapter.schemaStatus !== "validator-compatible-six-file-package"
  ) {
    invalidPrepared("application.json disagrees with the prepare-pr application projection");
  }
  try {
    application.builderTemplate = normalizeBuilderTemplate(application.builderTemplate);
  } catch {
    invalidPrepared("application.json contains invalid builder-template provenance");
  }
  const primary = requireObject(application.source, "application source").primary;
  if (
    !isPlainObject(primary)
    || primary.repositoryUri !== sourceRepositoryUrl
    || requireOpaqueDecimal(primary.numericRepositoryId, "application source repository id") !== sourceRepositoryId
    || requireCommit(primary.revisionObjectId, "application source commit") !== sourceCommit
    || requireCommit(primary.treeObjectId, "application source tree") !== sourceTree
    || canonicalJson(application.source) !== canonicalJson(sourceRequest)
  ) {
    invalidPrepared("application.json is not bound to the exact prepared source request");
  }
  if (!Array.isArray(application.reviewPackage) || application.reviewPackage.length !== 5) {
    invalidPrepared("application.json does not bind the five review-package files");
  }
  const expectedReviewFiles = CENTRAL_APPLICATION_FILES.slice(1);
  for (let index = 0; index < expectedReviewFiles.length; index += 1) {
    const record = application.reviewPackage[index];
    const expected = files.get(expectedReviewFiles[index]);
    if (
      !isPlainObject(record)
      || record.path !== expected.path
      || record.byteLength !== expected.byteLength
      || record.sha256 !== expected.sha256
    ) {
      invalidPrepared("application.json review-package hashes disagree with the six-file package");
    }
  }
}

function normalizeCentralFile(record, expectedPath) {
  if (
    !isPlainObject(record)
    || record.path !== expectedPath
    || typeof record.content !== "string"
    || hasForbiddenInvisibleOrBidi(record.path)
    || !Number.isInteger(record.byteLength)
    || record.byteLength < 1
    || record.byteLength > MAX_CENTRAL_FILE_BYTES[expectedPath]
    || !DIGEST_PATTERN.test(record.sha256 ?? "")
  ) {
    invalidPrepared(`the central package file ${expectedPath} is malformed`);
  }
  const bytes = Buffer.from(record.content, "utf8");
  if (bytes.length !== record.byteLength || sha256Bytes(bytes) !== record.sha256) {
    invalidPrepared(`the central package file ${expectedPath} does not match its byte length and SHA-256`);
  }
  if (expectedPath.endsWith(".json")) {
    let document;
    try {
      document = JSON.parse(record.content);
    } catch {
      invalidPrepared(`the central package file ${expectedPath} is not valid JSON`);
    }
    if (record.content !== `${canonicalJson(document)}\n`) {
      invalidPrepared(`the central package file ${expectedPath} is not canonical JSON`);
    }
  }
  return Object.freeze({
    path: expectedPath,
    content: record.content,
    byteLength: record.byteLength,
    sha256: record.sha256
  });
}

function parseJsonFile(record, label) {
  try {
    return JSON.parse(record.content);
  } catch {
    invalidPrepared(`${label} is not valid JSON`);
  }
}

function unwrapPreparePrResult(input) {
  if (
    isPlainObject(input)
    && input.command === "prepare-pr"
    && input.ok === true
    && isPlainObject(input.result)
  ) return input.result;
  return input;
}

function confirmPreparedBody(body) {
  const replacements = [
    [
      "- [ ] I reviewed the generated title, body, source and evidence.",
      "- [x] I reviewed the generated title, body, source and evidence."
    ],
    [
      "- [ ] I explicitly authorize opening the draft pull request.",
      "- [x] I explicitly authorize opening the draft pull request."
    ]
  ];
  let result = body;
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) {
      invalidPrepared("the prepare-pr confirmation checklist is missing or ambiguous");
    }
    result = result.replace(before, after);
  }
  return result;
}

function normalizeCompanionSources(companions, primaryRepositoryId) {
  if (!Array.isArray(companions) || companions.length > 8) {
    invalidPrepared("the source request contains an invalid companion list");
  }
  const normalized = companions.map((record) => {
    if (!isPlainObject(record)) invalidPrepared("a companion source request is malformed");
    const repositorySlug = repositorySlugFromCanonicalUri(record.repositoryUri, "companion repository URI");
    return Object.freeze({
      repositorySlug,
      repositoryUrl: record.repositoryUri,
      numericRepositoryId: requireOpaqueDecimal(record.numericRepositoryId, "companion repository id"),
      commit: requireCommit(record.revisionObjectId, "companion source commit"),
      tree: requireCommit(record.treeObjectId, "companion source tree")
    });
  });
  for (let index = 0; index < normalized.length; index += 1) {
    if (
      normalized[index].numericRepositoryId === primaryRepositoryId
      || (index > 0 && compareUtf8(
        normalized[index - 1].numericRepositoryId,
        normalized[index].numericRepositoryId
      ) >= 0)
    ) {
      invalidPrepared("companion repository ids are not unique and canonically ordered");
    }
  }
  return normalized;
}

function repositorySlugFromCanonicalUri(value, label) {
  if (typeof value !== "string" || !value.startsWith("https://github.com/")) {
    invalidPrepared(`${label} is not a canonical public GitHub repository URI`);
  }
  const repositorySlug = value.slice("https://github.com/".length);
  try {
    requireRepositorySlug(repositorySlug, label);
  } catch {
    invalidPrepared(`${label} is not a canonical public GitHub repository URI`);
  }
  if (value !== `https://github.com/${repositorySlug}`) {
    invalidPrepared(`${label} is not a canonical public GitHub repository URI`);
  }
  return repositorySlug;
}

function normalizeViewer(value) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", "GitHub viewer output is malformed");
  return Object.freeze({
    id: normalizeApiId(value.id, "GitHub viewer id"),
    login: requireGitHubLogin(value.login, "GitHub viewer login"),
    url: requireGitHubUserUrl(value.html_url, value.login)
  });
}

function assertViewerMatchesBuilder(viewer, builder) {
  if (
    viewer.id !== builder.githubUserId
    || viewer.login.toLowerCase() !== builder.githubLogin.toLowerCase()
  ) {
    fail(
      "WRONG_GITHUB_ACCOUNT",
      `the active gh account ${viewer.login} does not match the prepared builder GitHub identity`
    );
  }
}

function normalizeRepository(value, label) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", `${label} output is malformed`);
  const fullName = requireRepositorySlug(value.full_name, `${label} full name`);
  const owner = requireApiObject(value.owner, `${label} owner`);
  const permissions = isPlainObject(value.permissions) ? value.permissions : {};
  return Object.freeze({
    id: normalizeApiId(value.id, `${label} id`),
    fullName,
    htmlUrl: requireGitHubRepositoryUrl(value.html_url, fullName),
    private: requireBoolean(value.private, `${label} private state`),
    fork: requireBoolean(value.fork, `${label} fork state`),
    defaultBranch: requireBranch(value.default_branch, `${label} default branch`),
    owner: Object.freeze({
      id: normalizeApiId(owner.id, `${label} owner id`),
      login: requireGitHubLogin(owner.login, `${label} owner login`)
    }),
    parent: value.parent === undefined || value.parent === null ? null : Object.freeze({
      id: normalizeApiId(value.parent.id, `${label} parent id`),
      fullName: requireRepositorySlug(value.parent.full_name, `${label} parent full name`)
    }),
    permissions: Object.freeze({
      push: permissions.push === true,
      admin: permissions.admin === true,
      maintain: permissions.maintain === true
    })
  });
}

function validateFork(fork, viewer, centralRepositoryId) {
  if (
    fork.fullName.toLowerCase() !== `${viewer.login}/${CENTRAL_REPOSITORY_NAME}`.toLowerCase()
    || fork.owner.id !== viewer.id
    || fork.fork !== true
    || fork.parent?.id !== centralRepositoryId
    || fork.parent?.fullName !== CENTRAL_REPOSITORY
    || (fork.permissions !== undefined && fork.permissions.push !== true)
  ) {
    fail("FORK_COLLISION", "the viewer's submit-launch repository is not the exact fork of Submit a Launch");
  }
}

function validateCentralRepository(repository) {
  if (
    repository.id !== CENTRAL_REPOSITORY_ID
    || repository.fullName !== CENTRAL_REPOSITORY
    || repository.private !== false
    || repository.defaultBranch !== CENTRAL_BASE_BRANCH
  ) {
    fail("CENTRAL_REPOSITORY_MISMATCH", "the fixed Submit a Launch repository is unavailable or changed");
  }
}

function normalizeForkWriteResponse(value) {
  if (!isPlainObject(value)) {
    fail("GITHUB_OUTPUT_INVALID", "created fork output is malformed");
  }
  if (value.id !== undefined) normalizeApiId(value.id, "created fork id");
  if (value.full_name !== undefined) requireRepositorySlug(value.full_name, "created fork name");
  return true;
}

function normalizeGitCommit(value, label) {
  if (!isPlainObject(value) || !isPlainObject(value.tree)) {
    fail("GITHUB_OUTPUT_INVALID", `${label} output is malformed`);
  }
  return Object.freeze({
    sha: requireCommit(value.sha, `${label} SHA`),
    tree: requireCommit(value.tree.sha, `${label} tree`)
  });
}

function normalizeCreatedTree(value) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", "created tree output is malformed");
  return { sha: requireCommit(value.sha, "created tree SHA") };
}

function normalizeCreatedCommit(value, expectedTree) {
  const commit = normalizeGitCommit(value, "created commit");
  if (commit.tree !== expectedTree) {
    fail("GITHUB_WRITE_VERIFY_FAILED", "GitHub created a commit for a different tree");
  }
  return commit;
}

function normalizeNullableRef(value, branch) {
  return value === null ? null : normalizeRef(value, branch);
}

function normalizeRef(value, branch) {
  if (!isPlainObject(value) || !isPlainObject(value.object)) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub ref output is malformed");
  }
  if (value.ref !== `refs/heads/${branch}` || value.object.type !== "commit") {
    fail("GITHUB_OUTPUT_INVALID", "GitHub ref output names a different branch or object type");
  }
  return Object.freeze({ branch, commit: requireCommit(value.object.sha, "GitHub ref commit") });
}

function normalizePullNumberList(value) {
  if (!Array.isArray(value) || value.length > 100) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request list is malformed");
  return [...new Set(value.map((record) => Number(apiPullNumber(record?.number))))];
}

function normalizePullWriteResponse(value) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request write output is malformed");
  return Number(apiPullNumber(value.number));
}

function normalizeSearch(value) {
  if (!isPlainObject(value) || !Array.isArray(value.items) || value.items.length > MAX_SEARCH_RESULTS) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request search output is malformed");
  }
  const total = requireApiInteger(value.total_count, "GitHub pull-request search count", 0, 1_000_000);
  if (total !== value.items.length) {
    fail("APPLICATION_SEARCH_INCOMPLETE", "GitHub returned an incomplete open application pull-request search");
  }
  const numbers = value.items.map((item) => apiPullNumber(item?.number)).map(Number);
  return [...new Set(numbers)];
}

function normalizePull(value) {
  if (!isPlainObject(value) || !isPlainObject(value.user) || !isPlainObject(value.head) || !isPlainObject(value.base)) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request output is malformed");
  }
  const headRepo = requireApiObject(value.head.repo, "pull-request head repository");
  const baseRepo = requireApiObject(value.base.repo, "pull-request base repository");
  const state = value.state;
  if (!new Set(["open", "closed"]).has(state)) fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request state is unsupported");
  return Object.freeze({
    number: Number(apiPullNumber(value.number)),
    state,
    draft: requireBoolean(value.draft, "pull-request draft state"),
    mergedAt: value.merged_at === null ? null : requireIsoTimestamp(value.merged_at, "pull-request merged time"),
    htmlUrl: requirePullUrl(value.html_url),
    title: requireBoundedText(value.title, "pull-request title", 200),
    body: typeof value.body === "string" ? requireBoundedMultilineText(value.body, "pull-request body", 64_000, { allowEmpty: true }) : "",
    changedFiles: requireApiInteger(value.changed_files, "pull-request changed-file count", 0, MAX_PULL_FILES),
    user: Object.freeze({
      id: normalizeApiId(value.user.id, "pull-request user id"),
      login: requireGitHubLogin(value.user.login, "pull-request user login")
    }),
    head: Object.freeze({
      ref: requireBranch(value.head.ref, "pull-request head ref"),
      sha: requireCommit(value.head.sha, "pull-request head SHA"),
      repositoryId: normalizeApiId(headRepo.id, "pull-request head repository id"),
      repositorySlug: requireRepositorySlug(headRepo.full_name, "pull-request head repository")
    }),
    base: Object.freeze({
      ref: requireBranch(value.base.ref, "pull-request base ref"),
      sha: requireCommit(value.base.sha, "pull-request base SHA"),
      repositoryId: normalizeApiId(baseRepo.id, "pull-request base repository id"),
      repositorySlug: requireRepositorySlug(baseRepo.full_name, "pull-request base repository")
    })
  });
}

function normalizePullFiles(value, declaredCount) {
  if (!Array.isArray(value) || value.length > MAX_PULL_FILES || value.length !== declaredCount) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub returned an incomplete or oversized pull-request file list");
  }
  const seen = new Set();
  return value.map((record) => {
    if (!isPlainObject(record) || typeof record.filename !== "string") {
      fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request file output is malformed");
    }
    const filename = requireRepositoryPath(record.filename, "pull-request file path");
    if (seen.has(filename)) fail("GITHUB_OUTPUT_INVALID", "GitHub returned duplicate pull-request file paths");
    seen.add(filename);
    const status = record.status;
    if (!new Set(["added", "modified", "removed", "renamed", "copied", "changed", "unchanged"]).has(status)) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned an unsupported pull-request file status");
    }
    return Object.freeze({
      filename,
      status,
      previousFilename: record.previous_filename === undefined
        ? null
        : requireRepositoryPath(record.previous_filename, "previous pull-request file path")
    });
  });
}

function normalizeReviews(value) {
  if (!Array.isArray(value) || value.length > MAX_REVIEWS) fail("GITHUB_OUTPUT_INVALID", "GitHub review output is malformed");
  if (value.length === MAX_REVIEWS) {
    fail("GITHUB_REVIEW_HISTORY_TOO_LARGE", "GitHub review history exceeds the bounded status projection");
  }
  return value.map((review) => {
    if (!isPlainObject(review) || !isPlainObject(review.user)) fail("GITHUB_OUTPUT_INVALID", "GitHub review output is malformed");
    const state = String(review.state ?? "").toUpperCase();
    if (!new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]).has(state)) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned an unsupported review state");
    }
    return Object.freeze({
      id: normalizeApiId(review.id, "review id"),
      state,
      user: Object.freeze({
        id: normalizeApiId(review.user.id, "review user id"),
        login: requireGitHubLogin(review.user.login, "review user login")
      }),
      submittedAt: review.submitted_at === null || review.submitted_at === undefined
        ? null
        : requireIsoTimestamp(review.submitted_at, "review submitted time")
    });
  });
}

function normalizeCheckRuns(value) {
  const records = Array.isArray(value) ? value : value?.check_runs;
  if (!Array.isArray(records) || records.length > 100) fail("GITHUB_OUTPUT_INVALID", "GitHub check-run output is malformed");
  if (!Array.isArray(value)) {
    const total = requireApiInteger(value?.total_count, "GitHub check-run count", 0, 1_000_000);
    if (total !== records.length) {
      fail("GITHUB_CHECK_HISTORY_TOO_LARGE", "GitHub returned an incomplete bounded check-run history");
    }
  }
  return records.map((check) => {
    if (!isPlainObject(check)) fail("GITHUB_OUTPUT_INVALID", "GitHub check-run output is malformed");
    const status = check.status;
    if (!new Set(["queued", "in_progress", "completed", "waiting", "requested", "pending"]).has(status)) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned an unsupported check-run state");
    }
    return Object.freeze({
      id: normalizeApiId(check.id, "check-run id"),
      name: requireBoundedText(check.name, "check-run name", 200),
      status,
      conclusion: check.conclusion === null ? null : requireBoundedText(check.conclusion, "check-run conclusion", 40)
    });
  });
}

function latestChangesRequested(reviews) {
  const latest = new Map();
  for (const review of reviews) latest.set(review.user.id, review);
  return [...latest.values()]
    .filter((review) => review.state === "CHANGES_REQUESTED")
    .map((review) => review.user.login)
    .sort(compareUtf8);
}

function normalizeContent(value, expectedPath, maximum = 200_000) {
  if (
    !isPlainObject(value)
    || value.type !== "file"
    || value.path !== expectedPath
    || value.encoding !== "base64"
    || typeof value.content !== "string"
    || !Number.isInteger(value.size)
    || value.size < 0
    || value.size > maximum
  ) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content output is malformed for ${expectedPath}`);
  }
  let bytes;
  const encoded = value.content.replace(/\s+/gu, "");
  if (
    encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content is not valid base64 for ${expectedPath}`);
  }
  bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content is not canonical base64 for ${expectedPath}`);
  }
  if (bytes.length !== value.size || bytes.length > maximum) {
    fail("GITHUB_OUTPUT_INVALID", `GitHub content size disagrees for ${expectedPath}`);
  }
  return bytes;
}

function normalizeContinuation(record) {
  if (!hasExactKeys(record, [
    "applicationId",
    "builderGitHubUserId",
    "companionNumericRepositoryIds",
    "primaryNumericRepositoryId",
    "pullRequestNumber"
  ])) fail("INTAKE_STATUS_INVALID", "a trusted continuation record is malformed");
  const companions = record.companionNumericRepositoryIds;
  if (!Array.isArray(companions) || companions.length > 8) fail("INTAKE_STATUS_INVALID", "a continuation companion list is malformed");
  const normalizedCompanions = companions.map((value) => requireOpaqueDecimal(value, "continuation companion id"));
  for (let index = 1; index < normalizedCompanions.length; index += 1) {
    if (compareUtf8(normalizedCompanions[index - 1], normalizedCompanions[index]) >= 0) {
      fail("INTAKE_STATUS_INVALID", "continuation companion ids are not unique and canonically ordered");
    }
  }
  const primary = requireOpaqueDecimal(record.primaryNumericRepositoryId, "continuation primary repository id");
  if (normalizedCompanions.includes(primary)) fail("INTAKE_STATUS_INVALID", "a continuation repeats its primary repository as a companion");
  return Object.freeze({
    applicationId: requireApplicationId(record.applicationId, "continuation application id"),
    builderGitHubUserId: requireOpaqueDecimal(record.builderGitHubUserId, "continuation builder id"),
    companionNumericRepositoryIds: Object.freeze(normalizedCompanions),
    primaryNumericRepositoryId: primary,
    pullRequestNumber: String(apiPullNumber(record.pullRequestNumber))
  });
}

function compareContinuations(left, right) {
  const numberOrder = compareDecimalStrings(left.pullRequestNumber, right.pullRequestNumber);
  return numberOrder || compareUtf8(left.applicationId, right.applicationId);
}

function compareDecimalStrings(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeApiId(value, label) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) fail("GITHUB_OUTPUT_INVALID", `${label} is not a lossless positive integer`);
    return String(value);
  }
  if (typeof value === "string" && OPAQUE_DECIMAL_PATTERN.test(value)) return value;
  fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
}

function normalizeOptionalPullNumber(value) {
  return value === null || value === undefined ? null : Number(apiPullNumber(value));
}

function normalizeNullableRevision(value) {
  return value === null || value === undefined ? null : requireRevision(value, "prior application revision");
}

function requireRevision(value, label) {
  return requireBoundedInteger(value, label, 1, 1_000_000);
}

function requireBoundedInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalidPrepared(`${label} is outside its allowed range`);
  return value;
}

function requireOpaqueDecimal(value, label) {
  if (typeof value !== "string" || !OPAQUE_DECIMAL_PATTERN.test(value)) invalidPrepared(`${label} is malformed`);
  return value;
}

function requireApplicationId(value, label) {
  if (typeof value !== "string" || value.length > 80 || !APPLICATION_ID_PATTERN.test(value)) invalidPrepared(`${label} is malformed`);
  return value;
}

function requireRepositorySlug(value, label) {
  if (typeof value !== "string" || !REPOSITORY_SLUG_PATTERN.test(value) || hasForbiddenInvisibleOrBidi(value)) {
    fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  }
  return value;
}

function requireGitHubLogin(value, label) {
  if (typeof value !== "string" || !GITHUB_LOGIN_PATTERN.test(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireBranch(value, label) {
  if (typeof value !== "string" || !BRANCH_PATTERN.test(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireCommit(value, label) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) fail("RECEIPT_INVALID", `${label} is malformed`);
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireBoundedText(value, label, maximumBytes, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || hasForbiddenInvisibleOrBidi(value)
    || value.normalize("NFC") !== value
  ) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireBoundedMultilineText(value, label, maximumBytes, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || hasForbiddenInvisibleOrBidi(value.replaceAll("\n", ""))
    || value.includes("\r")
    || value.normalize("NFC") !== value
  ) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireApiInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("GITHUB_OUTPUT_INVALID", `${label} is outside its allowed range`);
  }
  return value;
}

function requireApiObject(value, label) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) {
    fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  }
  return value;
}

function requireGitHubRepositoryUrl(value, slug) {
  if (value !== `https://github.com/${slug}`) fail("GITHUB_OUTPUT_INVALID", "GitHub repository URL is noncanonical");
  return value;
}

function requireGitHubUserUrl(value, login) {
  if (value !== `https://github.com/${login}`) fail("GITHUB_OUTPUT_INVALID", "GitHub user URL is noncanonical");
  return value;
}

function requirePullUrl(value) {
  if (typeof value !== "string" || !/^https:\/\/github\.com\/0xprogrammable\/submit-launch\/pull\/[1-9][0-9]*$/u.test(value)) {
    fail("GITHUB_OUTPUT_INVALID", "pull-request URL is noncanonical");
  }
  return value;
}

function requireRepositoryPath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 1_024
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("\\")
    || value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    || hasForbiddenInvisibleOrBidi(value)
    || value.normalize("NFC") !== value
  ) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) invalidPrepared(`${label} is malformed`);
  return value;
}

function resolveRegularFile(value, label) {
  if (typeof value !== "string" || value.length === 0 || hasForbiddenInvisibleOrBidi(value)) {
    fail("INVALID_PATH", `${label} path is invalid`, { exitCode: 2 });
  }
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isFile()) {
    fail("INVALID_PATH", `${label} must be an existing regular file`, { exitCode: 2 });
  }
  const real = fs.realpathSync(absolute);
  assertNoSymlinkComponents(real);
  return real;
}

function resolveDirectory(value, label) {
  if (typeof value !== "string" || value.length === 0 || hasForbiddenInvisibleOrBidi(value)) {
    fail("INVALID_PATH", `${label} path is invalid`, { exitCode: 2 });
  }
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isDirectory()) {
    fail("INVALID_PATH", `${label} must be an existing directory`, { exitCode: 2 });
  }
  const real = fs.realpathSync(absolute);
  assertNoSymlinkComponents(real);
  return real;
}

function assertNoSymlinkComponents(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const segment of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) fail("INVALID_PATH", "symbolic path components are not allowed");
  }
}

function pathsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  const contains = (relative) => relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return contains(leftToRight) || contains(rightToLeft);
}

function apiSlug(value) {
  return requireRepositorySlug(value, "GitHub repository").split("/").map(encodeURIComponent).join("/");
}

function apiCommit(value) {
  return requireCommit(value, "GitHub commit");
}

function apiRepositoryPath(value) {
  return requireRepositoryPath(value, "GitHub repository path").split("/").map(encodeURIComponent).join("/");
}

function apiPullNumber(value) {
  const string = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof string !== "string" || !/^[1-9][0-9]{0,9}$/u.test(string)) {
    fail("GITHUB_OUTPUT_INVALID", "pull-request number is malformed");
  }
  return string;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return arraysEqual(Object.keys(value).sort(compareUtf8), [...keys].sort(compareUtf8));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arraysEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function sanitizeMessage(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_000);
}

function invalidPrepared(message) {
  fail("PREPARED_RESULT_INVALID", message);
}

function fail(code, message, options = {}) {
  throw new GitHubApplicationError(code, message, options);
}

function assertTransport(transport) {
  const methods = [
    "getViewer", "getRepository", "getGitCommit", "getRef", "getContent",
    "listPullsByHead", "searchOpenPulls", "getPull", "getPullFiles",
    "getPullReviews", "getCheckRuns", "compareBranch", "createFork", "createTree", "createCommit",
    "createRef", "updateRef", "createDraftPull", "updatePull"
  ];
  if (!isPlainObject(transport) || methods.some((method) => typeof transport[method] !== "function")) {
    throw new TypeError("transport does not implement the GitHub application contract");
  }
}

function defaultCommandRunner({ command, args, stdin, timeoutMs, maxOutputBytes }) {
  if (command !== "gh" || !Array.isArray(args)) throw new TypeError("unsupported command runner input");
  const environment = { ...process.env };
  delete environment.GH_HOST;
  delete environment.GH_REPO;
  environment.GH_PROMPT_DISABLED = "1";
  environment.GH_PAGER = "cat";
  environment.PAGER = "cat";
  const result = childProcess.spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    env: environment,
    input: stdin,
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes
  });
  if (result.error) {
    return { status: 1, stdout: "", stderr: result.error.message };
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
