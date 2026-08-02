import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CENTRAL_APPLICATION_FILES,
  createGhTransport,
  executeGitHubApplication,
  GitHubApplicationError,
  normalizePreparedApplication,
  planGitHubApplication,
  projectGitHubStatus,
  readGitHubApplicationStatus,
  writeLocalReceipt
} from "../github-application-core.mjs";
import { canonicalJson } from "../submission-core.mjs";

const SOURCE_COMMIT = "1".repeat(40);
const SOURCE_TREE = "2".repeat(40);
const COMPANION_COMMIT = "a".repeat(40);
const COMPANION_TREE = "b".repeat(40);
const CENTRAL_COMMIT = "3".repeat(40);
const CENTRAL_TREE = "4".repeat(40);
const FORK_TREE = "5".repeat(40);
const CREATED_COMMIT = "6".repeat(40);
const UPDATED_COMMIT = "7".repeat(40);
const VIEWER_ID = "101";
const SOURCE_REPOSITORY_ID = "202";
const COMPANION_REPOSITORY_ID = "203";
const CENTRAL_REPOSITORY_ID = "303";
const FORK_REPOSITORY_ID = "404";
const APPLICATION_ID = "example-hook";

test("the prepared six-file package is closed, hash-bound, and path-bound", () => {
  const prepared = normalizePreparedApplication(makePrepared());
  assert.equal(prepared.applicationId, APPLICATION_ID);
  assert.equal(prepared.package.files.length, 6);
  assert.deepEqual(
    prepared.package.files.map(({ relativePath }) => relativePath),
    CENTRAL_APPLICATION_FILES
  );
  assert.match(prepared.package.digest, /^sha256:[0-9a-f]{64}$/u);

  const changedHash = structuredClone(makePrepared());
  changedHash.centralPackage.files[1].content += "tampered\n";
  assert.throws(
    () => normalizePreparedApplication(changedHash),
    errorCode("PREPARED_RESULT_INVALID")
  );

  const escaped = structuredClone(makePrepared());
  escaped.centralPackage.targetDirectory = "../example-hook";
  assert.throws(
    () => normalizePreparedApplication(escaped),
    errorCode("PREPARED_RESULT_INVALID")
  );
});

test("submit is read-only by default and emits a stable confirmation digest", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  const first = await planGitHubApplication({ operation: "submit", prepared, transport });
  const second = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.equal(first.confirmationDigest, second.confirmationDigest);
  assert.deepEqual(first.externalWrites, [
    "create-viewer-fork",
    "create-application-branch-commit",
    "open-draft-pull-request"
  ]);
  assert.equal(transport.writeCalls.length, 0);
  assert.equal(first.source.repositoryAdministratorOwnershipProven, false);
  assert.equal(first.source.observedPermission.push, true);
  assert.equal(first.source.observedPermission.admin, false);
});

test("an exact confirmation creates only a fork, branch commit, and draft PR", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    sleep: async () => {}
  });
  assert.deepEqual(result.actions, [
    "created-viewer-fork",
    "created-application-branch",
    "opened-draft-pull-request"
  ]);
  assert.equal(result.status.status, "submitted");
  assert.equal(result.status.packageMatchesPrepared, true);
  assert.equal(transport.pull.draft, true);
  assert.equal(transport.pull.state, "open");
  assert.equal(transport.writeCalls.includes("approve"), false);
  assert.equal(transport.writeCalls.includes("merge"), false);
});

test("a wrong or stale confirmation performs no writes", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  await assert.rejects(
    () => executeGitHubApplication({
      operation: "submit",
      prepared,
      transport,
      confirmationDigest: `sha256:${"0".repeat(64)}`,
      sleep: async () => {}
    }),
    errorCode("EXTERNAL_WRITE_CONFIRMATION_REQUIRED")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("a central-main race invalidates the confirmed plan before any write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  transport.centralCommit = "9".repeat(40);
  await assert.rejects(
    () => executeGitHubApplication({
      operation: "submit",
      prepared,
      transport,
      confirmationDigest: plan.confirmationDigest,
      sleep: async () => {}
    }),
    errorCode("PREPARE_PR_STALE")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("the active gh account must match the immutable prepared builder id", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, viewerId: "999" });
  await assert.rejects(
    () => planGitHubApplication({ operation: "submit", prepared, transport }),
    errorCode("WRONG_GITHUB_ACCOUNT")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("source push access is required but source admin access is not claimed", async () => {
  const prepared = makePrepared();
  const blocked = new FakeTransport({ prepared, sourcePush: false, sourceAdmin: true });
  await assert.rejects(
    () => planGitHubApplication({ operation: "submit", prepared, transport: blocked }),
    errorCode("SOURCE_WRITE_ACCESS_REQUIRED")
  );

  const permitted = new FakeTransport({ prepared, sourcePush: true, sourceAdmin: false });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport: permitted });
  assert.equal(plan.source.observedPermission.push, true);
  assert.equal(plan.source.observedPermission.admin, false);
  assert.equal(plan.source.repositoryAdministratorOwnershipProven, false);
});

test("public companion sources are bound to their exact repository, commit, and tree", async () => {
  const companion = {
    repositoryUri: "https://github.com/library/dependency",
    numericRepositoryId: COMPANION_REPOSITORY_ID,
    revisionObjectId: COMPANION_COMMIT,
    treeObjectId: COMPANION_TREE,
    sourcePaths: ["src/Dependency.sol"],
    contractPaths: ["src/Dependency.sol"]
  };
  const prepared = makePrepared({ companions: [companion] });
  const transport = new FakeTransport({ prepared });
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.deepEqual(plan.source.companions, [{
    repositorySlug: "library/dependency",
    repositoryUrl: "https://github.com/library/dependency",
    numericRepositoryId: COMPANION_REPOSITORY_ID,
    commit: COMPANION_COMMIT,
    tree: COMPANION_TREE,
    public: true,
    exactCommitReachable: true
  }]);

  const originalGetCommit = transport.getGitCommit.bind(transport);
  transport.getGitCommit = async (slug, commit) => (
    slug === "library/dependency"
      ? { sha: COMPANION_COMMIT, tree: { sha: "c".repeat(40) } }
      : originalGetCommit(slug, commit)
  );
  await assert.rejects(
    () => planGitHubApplication({ operation: "submit", prepared, transport }),
    errorCode("SOURCE_COMPANION_REVISION_CHANGED")
  );
});

test("prelaunch, paused-new, and paused-all stop a new draft before writes", async (t) => {
  for (const [state, code] of [
    ["prelaunch", "INTAKE_PRELAUNCH"],
    ["paused-new", "INTAKE_PAUSED_NEW"],
    ["paused-all", "INTAKE_PAUSED_ALL"]
  ]) {
    await t.test(state, async () => {
      const prepared = makePrepared();
      const transport = new FakeTransport({ prepared, intakeState: state });
      await assert.rejects(
        () => planGitHubApplication({ operation: "submit", prepared, transport }),
        errorCode(code)
      );
      assert.equal(transport.writeCalls.length, 0);
    });
  }
});

test("paused-new permits only the exact trusted unmerged continuation", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, intakeState: "open" });
  transport.seedExactPull();
  transport.intakeState = "paused-new";
  transport.continuations = [{
    applicationId: APPLICATION_ID,
    builderGitHubUserId: VIEWER_ID,
    companionNumericRepositoryIds: [],
    primaryNumericRepositoryId: SOURCE_REPOSITORY_ID,
    pullRequestNumber: String(transport.pull.number)
  }];
  const plan = await planGitHubApplication({
    operation: "update",
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(plan.externalWrites, []);

  transport.continuations[0].builderGitHubUserId = "999";
  await assert.rejects(
    () => planGitHubApplication({
      operation: "update",
      prepared,
      transport,
      pullRequestNumber: transport.pull.number
    }),
    errorCode("INTAKE_PAUSED_NEW")
  );
});

test("duplicate application pull requests fail closed", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.extraPull = transport.makePull({ number: 8 });
  await assert.rejects(
    () => planGitHubApplication({ operation: "update", prepared, transport }),
    errorCode("DUPLICATE_APPLICATION_PULL_REQUESTS")
  );
});

test("a pull-request path traversal record fails closed before any write", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const originalGetPullFiles = transport.getPullFiles.bind(transport);
  transport.getPullFiles = async (...args) => {
    const files = await originalGetPullFiles(...args);
    files[0].filename = `submissions/${APPLICATION_ID}/../outside.json`;
    return files;
  };
  await assert.rejects(
    () => planGitHubApplication({ operation: "update", prepared, transport }),
    errorCode("GITHUB_OUTPUT_INVALID")
  );
  assert.equal(transport.writeCalls.length, 0);
});

test("update is idempotent and never opens a second pull request", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const plan = await planGitHubApplication({
    operation: "update",
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(plan.externalWrites, []);
  const result = await executeGitHubApplication({
    operation: "update",
    prepared,
    transport,
    confirmationDigest: null,
    pullRequestNumber: transport.pull.number
  });
  assert.equal(result.alreadyApplied, true);
  assert.equal(transport.writeCalls.length, 0);
  assert.equal(transport.pull.number, 7);
});

test("update fast-forwards the existing draft and refreshes its metadata without duplication", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const oldFiles = new Map(transport.commitFiles.get(CREATED_COMMIT));
  oldFiles.set(`submissions/${APPLICATION_ID}/PROPOSAL.md`, "# Proposal\n\nSuperseded bytes.\n");
  transport.commitFiles.set(CREATED_COMMIT, oldFiles);
  transport.pull.body = "superseded public body";

  const plan = await planGitHubApplication({
    operation: "update",
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(plan.externalWrites, [
    "append-application-branch-commit-and-fast-forward",
    "update-draft-pull-request-metadata"
  ]);
  const result = await executeGitHubApplication({
    operation: "update",
    prepared,
    transport,
    confirmationDigest: plan.confirmationDigest,
    pullRequestNumber: transport.pull.number
  });
  assert.deepEqual(result.actions, [
    "updated-application-branch",
    "updated-draft-pull-request-metadata"
  ]);
  assert.equal(transport.branchCommit, UPDATED_COMMIT);
  assert.equal(transport.pull.number, 7);
  assert.equal(transport.pull.body, normalizePreparedApplication(prepared).body);
  assert.equal(transport.writeCalls.filter((value) => value === "createDraftPull").length, 0);
});

test("a failed PR creation resumes from the exact branch without another commit", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared, failCreatePullOnce: true });
  const firstPlan = await planGitHubApplication({ operation: "submit", prepared, transport });
  await assert.rejects(
    () => executeGitHubApplication({
      operation: "submit",
      prepared,
      transport,
      confirmationDigest: firstPlan.confirmationDigest,
      sleep: async () => {}
    }),
    errorCode("GITHUB_REQUEST_FAILED")
  );
  assert.equal(transport.branchCommit, CREATED_COMMIT);
  const commitWrites = transport.writeCalls.filter((value) => value === "createCommit").length;

  const recoveryPlan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.deepEqual(recoveryPlan.externalWrites, ["open-draft-pull-request"]);
  const result = await executeGitHubApplication({
    operation: "submit",
    prepared,
    transport,
    confirmationDigest: recoveryPlan.confirmationDigest,
    sleep: async () => {}
  });
  assert.equal(result.status.status, "submitted");
  assert.equal(transport.writeCalls.filter((value) => value === "createCommit").length, commitWrites);
});

test("an unverified matching branch is rebuilt instead of opened as a pull request", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.forkExists = true;
  transport.branchCommit = CREATED_COMMIT;
  transport.commitFiles.set(
    CREATED_COMMIT,
    new Map(transport.prepared.package.files.map((record) => [record.path, record.content]))
  );
  const exactComparison = transport.compareBranch.bind(transport);
  transport.compareBranch = async (...args) => {
    const comparison = await exactComparison(...args);
    comparison.files.push({ filename: "unexpected/public.txt", status: "added", sha: "d".repeat(40) });
    return comparison;
  };
  const plan = await planGitHubApplication({ operation: "submit", prepared, transport });
  assert.deepEqual(plan.externalWrites, [
    "append-application-branch-commit-and-fast-forward",
    "open-draft-pull-request"
  ]);
});

test("status maps GitHub signals without inventing approval", async (t) => {
  const base = rawPull({ draft: true });
  for (const [name, mutate, expected] of [
    ["draft", () => ({ pull: base, reviews: [], checks: [] }), "submitted"],
    ["running checks", () => ({ pull: base, reviews: [], checks: [rawCheck({ status: "in_progress" })] }), "checks-running"],
    ["failed check", () => ({ pull: base, reviews: [], checks: [rawCheck({ status: "completed", conclusion: "failure" })] }), "changes-requested"],
    ["review change request", () => ({ pull: base, reviews: [rawReview("CHANGES_REQUESTED")], checks: [] }), "changes-requested"],
    ["ready", () => ({ pull: rawPull({ draft: false }), reviews: [], checks: [rawCheck()] }), "waiting-review"],
    ["merged record", () => ({ pull: rawPull({ state: "closed", draft: false, mergedAt: "2026-08-02T01:02:03Z" }), reviews: [], checks: [] }), "review-record-merged"],
    ["closed", () => ({ pull: rawPull({ state: "closed", draft: false }), reviews: [], checks: [] }), "closed"]
  ]) {
    await t.test(name, () => {
      assert.equal(projectGitHubStatus(mutate()), expected);
    });
  }
});

test("status re-reads the PR and reports a different prepared package without calling it approved", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  transport.reviews = [rawReview("CHANGES_REQUESTED")];
  const status = await readGitHubApplicationStatus({
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.equal(status.status, "changes-requested");
  assert.equal(status.packageMatchesPrepared, true);
  assert.match(status.authorityBoundary, /not W2 application status/iu);
  assert.equal(transport.writeCalls.length, 0);
});

test("status exposes a changed remote six-file hash without accepting it as the prepared target", async () => {
  const prepared = makePrepared();
  const transport = new FakeTransport({ prepared });
  transport.seedExactPull();
  const changed = new Map(transport.commitFiles.get(CREATED_COMMIT));
  changed.set(`submissions/${APPLICATION_ID}/TEST_PLAN.md`, "# Test plan\n\nDifferent remote bytes.\n");
  transport.commitFiles.set(CREATED_COMMIT, changed);
  const status = await readGitHubApplicationStatus({
    prepared,
    transport,
    pullRequestNumber: transport.pull.number
  });
  assert.equal(status.packageMatchesPrepared, false);
  assert.equal(status.status, "submitted");
});

test("the gh command transport rejects malicious or ambiguous output", async (t) => {
  await t.test("two JSON values", async () => {
    const transport = createGhTransport({
      runner: async () => ({ status: 0, stdout: '{"id":101,"login":"builder"}\n{"id":202}', stderr: "" })
    });
    await assert.rejects(() => transport.getViewer(), errorCode("GITHUB_OUTPUT_INVALID"));
  });

  await t.test("oversized output", async () => {
    const transport = createGhTransport({
      runner: async () => ({ status: 0, stdout: "x".repeat(4_000_001), stderr: "" })
    });
    await assert.rejects(() => transport.getViewer(), errorCode("GITHUB_OUTPUT_INVALID"));
  });

  await t.test("runner uses argument arrays and no shell string", async () => {
    let invocation;
    const transport = createGhTransport({
      runner: async (value) => {
        invocation = value;
        return {
          status: 0,
          stdout: canonicalJson({ id: 101, login: "builder", html_url: "https://github.com/builder" }),
          stderr: ""
        };
      }
    });
    await transport.getViewer();
    assert.equal(invocation.command, "gh");
    assert.ok(Array.isArray(invocation.args));
    assert.equal(Object.hasOwn(invocation, "shell"), false);
    assert.ok(invocation.args.includes("github.com"));
  });
});

test("receipts are bounded, idempotent, and cannot enter the source repo", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-github-receipt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const receipts = path.join(root, "receipts");
  fs.mkdirSync(source);
  fs.mkdirSync(receipts);
  const payload = {
    applicationId: APPLICATION_ID,
    applicationRevision: 1,
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/0xprogrammable/programmable/pull/7",
    githubStatus: "submitted",
    headCommit: CREATED_COMMIT,
    packageMatchesPrepared: true,
    preparedPackageDigest: `sha256:${"a".repeat(64)}`,
    confirmationDigest: `sha256:${"b".repeat(64)}`,
    externalActionsPerformed: ["opened-draft-pull-request"]
  };
  const first = writeLocalReceipt({ receiptDirectory: receipts, sourceRepositoryRoot: source, receipt: payload });
  const second = writeLocalReceipt({ receiptDirectory: receipts, sourceRepositoryRoot: source, receipt: payload });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.path, second.path);
  assert.ok(fs.statSync(first.path).size < 65_536);
  assert.throws(
    () => writeLocalReceipt({ receiptDirectory: source, sourceRepositoryRoot: source, receipt: payload }),
    errorCode("RECEIPT_PATH_INVALID")
  );
});

function makePrepared({ priorRevision = null, companions = [] } = {}) {
  const source = {
    schemaVersion: "1.0.0",
    primary: {
      repositoryUri: "https://github.com/builder/project",
      numericRepositoryId: SOURCE_REPOSITORY_ID,
      revisionObjectId: SOURCE_COMMIT,
      treeObjectId: SOURCE_TREE,
      sourcePaths: ["submissions/example-hook/submission.json"],
      contractPaths: []
    },
    companions: structuredClone(companions)
  };
  const reviewContents = new Map([
    ["PROPOSAL.md", "# Proposal\n\nA concrete proposal.\n"],
    ["TEST_PLAN.md", "# Test plan\n\nA concrete test plan.\n"],
    ["THREAT_MODEL.md", "# Threat model\n\nA concrete threat model.\n"],
    ["compatibility-report.json", `${canonicalJson({ result: "architecture-review-required", schemaVersion: 1 })}\n`],
    ["evidence-index.json", `${canonicalJson({ evidence: [], schemaVersion: 1 })}\n`]
  ]);
  const reviewPackage = [...reviewContents].map(([filePath, content]) => fileRecord(filePath, content));
  const application = {
    schemaVersion: 2,
    applicationId: APPLICATION_ID,
    applicationRevision: priorRevision === null ? 1 : priorRevision + 1,
    stage: "proposal",
    title: "Example hook",
    summary: "An example hook with concrete public review evidence.",
    builder: {
      githubUserId: VIEWER_ID,
      githubLogin: "builder",
      contact: "https://github.com/builder"
    },
    builderTemplate: {
      schemaVersion: "1.0.0",
      source: "manual",
      templateSelection: null
    },
    source,
    companionClosure: [],
    programmableFee: { policyId: "programmable-volume-fee-v1" },
    reviewPackage: reviewPackage.map(({ path: filePath, byteLength, sha256 }) => ({
      path: filePath,
      byteLength,
      sha256
    })),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  };
  const filesByPath = new Map(reviewPackage.map((record) => [record.path, record]));
  filesByPath.set("application.json", fileRecord("application.json", `${canonicalJson(application)}\n`));
  const files = CENTRAL_APPLICATION_FILES.map((filePath) => filesByPath.get(filePath));
  const revision = application.applicationRevision;
  return {
    title: `[Builder Beta] ${APPLICATION_ID}`,
    body: [
      "## Builder submission",
      "",
      `- Model: \`${APPLICATION_ID}\``,
      `- Source head commit: \`${SOURCE_COMMIT}\``,
      "",
      "## Confirmation checklist",
      "",
      "- [x] The exact revision was prepared from a clean Git worktree.",
      "- [ ] I reviewed the generated title, body, source and evidence.",
      "- [ ] I explicitly authorize opening the draft pull request.",
      "",
      "Passing intake checks is not acceptance, an audit, deployment evidence, routing approval, or availability."
    ].join("\n"),
    sourceHead: {
      repositorySlug: "builder/project",
      repositoryUrl: "https://github.com/builder/project",
      branch: "main",
      upstreamBranch: "main",
      remote: "origin",
      commit: SOURCE_COMMIT,
      tree: SOURCE_TREE
    },
    centralPullRequestTarget: {
      repositorySlug: "0xprogrammable/programmable",
      repositoryUrl: "https://github.com/0xprogrammable/programmable",
      baseBranch: "main",
      baseCommit: CENTRAL_COMMIT,
      baseTree: CENTRAL_TREE,
      applicationDirectory: `submissions/${APPLICATION_ID}`,
      applicationPath: `submissions/${APPLICATION_ID}/application.json`,
      priorApplicationRevision: priorRevision,
      nextApplicationRevision: revision,
      pullRequestHeadCreated: false
    },
    github: {
      owner: "builder",
      repository: "project",
      repositorySlug: "builder/project",
      repositoryId: SOURCE_REPOSITORY_ID,
      repositoryUrl: "https://github.com/builder/project",
      configuredRemoteUrl: "https://github.com/builder/project.git",
      commitUrl: `https://github.com/builder/project/commit/${SOURCE_COMMIT}`,
      publicCommitReachable: true,
      sourceRequest: source,
      sourceResolutionHash: `sha256:${"7".repeat(64)}`,
      sourceResolution: {},
      companionClosure: []
    },
    submission: {
      package: `submissions/${APPLICATION_ID}`,
      modelId: APPLICATION_ID,
      stage: "proposal",
      hash: `sha256:${"8".repeat(64)}`,
      reviewTargetHash: `sha256:${"9".repeat(64)}`,
      preflightDecision: "PROTOTYPE_READY",
      intakeValidated: true
    },
    applicationAdapter: {
      targetPath: `submissions/${APPLICATION_ID}/application.json`,
      applicationRevision: revision,
      schemaStatus: "validator-compatible-six-file-package",
      publicGitHubApplicationReady: true
    },
    centralPackage: {
      targetDirectory: `submissions/${APPLICATION_ID}`,
      stage: "proposal",
      applicationRevision: revision,
      fileCount: 6,
      fileOrder: [...CENTRAL_APPLICATION_FILES],
      encoding: "utf8",
      generated: true,
      validatorContract: "public-pr-application-v2",
      files
    },
    requiresHumanConfirmation: true,
    localWritesPerformed: [],
    externalReadChecksPerformed: [],
    externalActionsPerformed: []
  };
}

function fileRecord(filePath, content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    path: filePath,
    content,
    byteLength: bytes.length,
    sha256: digest(bytes)
  };
}

class FakeTransport {
  constructor({
    prepared,
    viewerId = VIEWER_ID,
    sourcePush = true,
    sourceAdmin = false,
    intakeState = "open",
    failCreatePullOnce = false
  }) {
    this.prepared = normalizePreparedApplication(prepared);
    this.viewer = { id: viewerId, login: "builder", html_url: "https://github.com/builder" };
    this.sourcePush = sourcePush;
    this.sourceAdmin = sourceAdmin;
    this.intakeState = intakeState;
    this.continuations = [];
    this.centralCommit = CENTRAL_COMMIT;
    this.forkExists = false;
    this.branchCommit = null;
    this.commitFiles = new Map();
    this.pendingFiles = null;
    this.pull = null;
    this.extraPull = null;
    this.reviews = [];
    this.checks = [];
    this.writeCalls = [];
    this.failCreatePullOnce = failCreatePullOnce;
  }

  async getViewer() {
    return structuredClone(this.viewer);
  }

  async getRepository(slug, { allowNotFound = false } = {}) {
    if (slug === "0xprogrammable/programmable") return repository({
      slug,
      id: CENTRAL_REPOSITORY_ID,
      ownerId: "1",
      ownerLogin: "0xprogrammable",
      permissions: { push: false, admin: false, maintain: false }
    });
    if (slug === "builder/project") return repository({
      slug,
      id: SOURCE_REPOSITORY_ID,
      ownerId: VIEWER_ID,
      ownerLogin: "builder",
      permissions: { push: this.sourcePush, admin: this.sourceAdmin, maintain: this.sourcePush }
    });
    const companion = this.prepared.companions.find((record) => record.repositorySlug === slug);
    if (companion !== undefined) return repository({
      slug,
      id: companion.numericRepositoryId,
      ownerId: "2",
      ownerLogin: slug.split("/")[0],
      permissions: { push: false, admin: false, maintain: false }
    });
    if (slug.toLowerCase() === "builder/programmable") {
      if (!this.forkExists) {
        if (allowNotFound) return null;
        throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "fork missing");
      }
      return repository({
        slug: "builder/programmable",
        id: FORK_REPOSITORY_ID,
        ownerId: VIEWER_ID,
        ownerLogin: "builder",
        fork: true,
        parent: { id: CENTRAL_REPOSITORY_ID, full_name: "0xprogrammable/programmable" },
        permissions: { push: true, admin: true, maintain: true }
      });
    }
    if (allowNotFound) return null;
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "repository missing");
  }

  async getGitCommit(slug, commit) {
    if (slug === "builder/project" && commit === SOURCE_COMMIT) {
      return { sha: SOURCE_COMMIT, tree: { sha: SOURCE_TREE } };
    }
    if (slug === "0xprogrammable/programmable" && commit === CENTRAL_COMMIT) {
      return { sha: CENTRAL_COMMIT, tree: { sha: CENTRAL_TREE } };
    }
    const companion = this.prepared.companions.find((record) => (
      record.repositorySlug === slug && record.commit === commit
    ));
    if (companion !== undefined) {
      return { sha: companion.commit, tree: { sha: companion.tree } };
    }
    if (slug.toLowerCase() === "builder/programmable" && commit === CREATED_COMMIT) {
      return { sha: CREATED_COMMIT, tree: { sha: FORK_TREE } };
    }
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "commit missing");
  }

  async getRef(slug, branch, { allowNotFound = false } = {}) {
    if (slug === "builder/project" && branch === "main") return gitRef("main", SOURCE_COMMIT);
    if (slug === "0xprogrammable/programmable" && branch === "main") return gitRef("main", this.centralCommit);
    if (slug.toLowerCase() === "builder/programmable" && branch === this.prepared.branch) {
      if (this.branchCommit === null) {
        if (allowNotFound) return null;
        throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "branch missing");
      }
      return gitRef(branch, this.branchCommit);
    }
    if (allowNotFound) return null;
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "ref missing");
  }

  async getContent(slug, filePath, ref) {
    if (slug === "0xprogrammable/programmable" && filePath === "docs/builder/intake-status.json") {
      const content = `${canonicalJson({
        continuingPullRequests: this.continuations,
        schemaVersion: 2,
        state: this.intakeState
      })}\n`;
      return contentResponse(filePath, content);
    }
    if (slug.toLowerCase() === "builder/programmable") {
      const files = this.commitFiles.get(ref);
      const content = files?.get(filePath);
      if (content === undefined) throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "content missing");
      return contentResponse(filePath, content);
    }
    throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "content missing");
  }

  async listPullsByHead() {
    return [this.pull, this.extraPull]
      .filter((pull) => pull?.state === "open")
      .map((pull) => ({ number: pull.number }));
  }

  async searchOpenPulls() {
    return {
      total_count: [this.pull, this.extraPull].filter((pull) => pull?.state === "open").length,
      items: [this.pull, this.extraPull]
        .filter((pull) => pull?.state === "open")
        .map((pull) => ({ number: pull.number }))
    };
  }

  async getPull(_repository, number) {
    const pull = [this.pull, this.extraPull].find((record) => record?.number === Number(number));
    if (!pull) throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "pull missing");
    return structuredClone(pull);
  }

  async getPullFiles(_repository, number) {
    const pull = [this.pull, this.extraPull].find((record) => record?.number === Number(number));
    if (!pull) throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "pull missing");
    return this.prepared.package.files.map(({ path: filePath }) => ({
      filename: filePath,
      status: "added",
      sha: "a".repeat(40)
    }));
  }

  async getPullReviews() {
    return structuredClone(this.reviews);
  }

  async getCheckRuns() {
    return { total_count: this.checks.length, check_runs: structuredClone(this.checks) };
  }

  async compareBranch({ baseCommit }) {
    return {
      base_commit: { sha: baseCommit },
      merge_base_commit: { sha: baseCommit },
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      commits: [{ sha: this.branchCommit }],
      files: this.prepared.package.files.map(({ path: filePath }) => ({
        filename: filePath,
        status: "added",
        sha: "a".repeat(40)
      }))
    };
  }

  async createFork() {
    this.writeCalls.push("createFork");
    this.forkExists = true;
    return this.getRepository("builder/programmable");
  }

  async createTree(_repository, { files }) {
    this.writeCalls.push("createTree");
    this.pendingFiles = new Map(files.map((record) => [record.path, record.content]));
    return { sha: FORK_TREE };
  }

  async createCommit(_repository, { tree }) {
    this.writeCalls.push("createCommit");
    assert.equal(tree, FORK_TREE);
    const commit = this.branchCommit === null ? CREATED_COMMIT : UPDATED_COMMIT;
    this.commitFiles.set(commit, this.pendingFiles);
    return { sha: commit, tree: { sha: FORK_TREE } };
  }

  async createRef(_repository, { branch, commit }) {
    this.writeCalls.push("createRef");
    this.branchCommit = commit;
    return gitRef(branch, commit);
  }

  async updateRef(_repository, { branch, commit }) {
    this.writeCalls.push("updateRef");
    this.branchCommit = commit;
    if (this.pull !== null) this.pull.head.sha = commit;
    return gitRef(branch, commit);
  }

  async createDraftPull(_repository, { title, body }) {
    this.writeCalls.push("createDraftPull");
    if (this.failCreatePullOnce) {
      this.failCreatePullOnce = false;
      throw new GitHubApplicationError("GITHUB_REQUEST_FAILED", "simulated pull failure");
    }
    this.pull = this.makePull({ title, body });
    return { number: this.pull.number };
  }

  async updatePull(_repository, number, { title, body }) {
    this.writeCalls.push("updatePull");
    assert.equal(this.pull.number, Number(number));
    this.pull.title = title;
    this.pull.body = body;
    return { number: this.pull.number };
  }

  seedExactPull() {
    this.forkExists = true;
    this.branchCommit = CREATED_COMMIT;
    this.commitFiles.set(
      CREATED_COMMIT,
      new Map(this.prepared.package.files.map((record) => [record.path, record.content]))
    );
    this.pull = this.makePull();
  }

  makePull({ number = 7, title = this.prepared.title, body = this.prepared.body } = {}) {
    return rawPull({
      number,
      title,
      body,
      headSha: this.branchCommit ?? CREATED_COMMIT,
      headRef: this.prepared.branch
    });
  }
}

function repository({
  slug,
  id,
  ownerId,
  ownerLogin,
  fork = false,
  parent = null,
  permissions
}) {
  return {
    id,
    full_name: slug,
    html_url: `https://github.com/${slug}`,
    private: false,
    fork,
    default_branch: "main",
    owner: { id: ownerId, login: ownerLogin },
    parent,
    permissions
  };
}

function gitRef(branch, commit) {
  return { ref: `refs/heads/${branch}`, object: { type: "commit", sha: commit } };
}

function contentResponse(filePath, content) {
  const bytes = Buffer.from(content, "utf8");
  return {
    type: "file",
    path: filePath,
    encoding: "base64",
    content: bytes.toString("base64"),
    size: bytes.length,
    sha: "a".repeat(40)
  };
}

function rawPull({
  number = 7,
  state = "open",
  draft = true,
  mergedAt = null,
  title = `[Builder Beta] ${APPLICATION_ID}`,
  body = "body",
  headSha = CREATED_COMMIT,
  headRef = `programmable-builder/${APPLICATION_ID}`
} = {}) {
  return {
    number,
    state,
    draft,
    merged_at: mergedAt,
    html_url: `https://github.com/0xprogrammable/programmable/pull/${number}`,
    title,
    body,
    changed_files: 6,
    user: { id: VIEWER_ID, login: "builder" },
    head: {
      ref: headRef,
      sha: headSha,
      repo: { id: FORK_REPOSITORY_ID, full_name: "builder/programmable" }
    },
    base: {
      ref: "main",
      sha: CENTRAL_COMMIT,
      repo: { id: CENTRAL_REPOSITORY_ID, full_name: "0xprogrammable/programmable" }
    }
  };
}

function rawReview(state) {
  return {
    id: "901",
    state,
    user: { id: "902", login: "reviewer" },
    submitted_at: "2026-08-02T01:02:03Z"
  };
}

function rawCheck({ status = "completed", conclusion = "success" } = {}) {
  return { id: "801", name: "public-intake", status, conclusion: status === "completed" ? conclusion : null };
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function errorCode(code) {
  return (error) => error instanceof GitHubApplicationError && error.code === code;
}
