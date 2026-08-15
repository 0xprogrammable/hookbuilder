import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ApplicationHandoffError,
  buildApplicationHandoffPreviewV1,
  normalizeApplicationHandoffInputV1
} from "../application-handoff-core.mjs";
import { validateAgainstSchema } from "../restricted-json-schema-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const cli = path.join(skillRoot, "scripts", "cli.mjs");
const inputSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "application-handoff-input-v1.schema.json"), "utf8"));
const commit = "1".repeat(40);
const tree = "2".repeat(40);
const baseCommit = "3".repeat(40);
const baseTree = "4".repeat(40);
const digest = (digit) => `sha256:${digit.repeat(64)}`;
const policyFixtureRoot = path.join(testDirectory, "fixtures", "submit-launch-policy");
const policyBytes = fs.readFileSync(path.join(policyFixtureRoot, "launch-policy.v1.json"));
const policySchemaBytes = fs.readFileSync(path.join(policyFixtureRoot, "launch-policy.v1.schema.json"));
const policyDocument = JSON.parse(policyBytes.toString("utf8"));

test("application handoff previews exact no-market and tradable projects without changing authority state", () => {
  for (const classification of ["no-market", "tradable"]) {
    const input = fixture({ classification });
    assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
    const normalized = normalizeApplicationHandoffInputV1(input);
    assert.equal(normalized.policy.content.policy.byteLength, policyBytes.length);
    assert.equal(normalized.policy.content.schema.byteLength, policySchemaBytes.length);
    const result = buildApplicationHandoffPreviewV1(input);
    assert.equal(result.status, "APPLICATION_HANDOFF_PREVIEW_READY");
    assert.equal(result.application.classification, classification);
    assert.equal(result.application.surfaceCount, 1);
    assert.equal(result.source.revisionObjectId, commit);
    assert.equal(result.source.treeObjectId, tree);
    assert.equal(result.policy.binding.baseCommit, baseCommit);
    assert.equal(result.policy.binding.sha256, bytesDigest(policyBytes));
    assert.equal(result.policy.schemaBinding.sha256, bytesDigest(policySchemaBytes));
    assert.deepEqual(result.policy.requirements, policyDocument.rules.filter(
      (rule) => rule.status === "active" && rule.profiles.includes("build")
    ));
    assert.equal(result.pullRequest.target.numericRepositoryId, "1320171831");
    assert.equal(result.pullRequest.target.baseCommit, baseCommit);
    assert.equal(result.pullRequest.target.headOwnerGitHubUserId, "123456789");
    assert.equal(result.pullRequest.target.applicationDirectory, "submissions/example-project");
    assert.equal(result.pullRequest.observed, null);
    assert.equal(result.transport.status, "HANDOFF_ONLY_EXTERNAL_WRITE_NOT_AUTHORIZED");
    assert.equal(result.transport.existingDraftAdapterEligible, false);
    assert.deepEqual(result.externalActionsPerformed, []);
    assert.equal(result.evidenceBoundary.policyContentValidatedByThisPreview, true);
    assert.equal(result.evidenceBoundary.policyRequirementsDerivedByThisPreview, true);
    assert.equal(result.evidenceBoundary.policyRemoteMembershipRevalidatedByThisPreview, false);
    assert.equal(result.evidenceBoundary.projectPolicyComplianceEvaluatedByThisPreview, false);
    assert.deepEqual(result.authority, {
      sourceCompletion: "PROJECT_PREFLIGHT_VALID_BOUND_NOT_REVALIDATED",
      submission: "NOT_SUBMITTED",
      review: "NOT_REVIEWED",
      approval: "NOT_APPROVED",
      deployment: "NOT_DEPLOYED",
      launch: "NOT_LAUNCHED"
    });
    assert.match(result.previewDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(buildApplicationHandoffPreviewV1(input).previewDigest, result.previewDigest);
  }
});

test("application handoff derives requirements from exact policy preimages and rejects substituted or placeholder bindings", () => {
  const selected = fixture();
  selected.policy.requirements = [{ id: "CALLER.SELECTED_RULE", status: "active" }];
  assert.notDeepEqual(validateAgainstSchema(selected, inputSchema), []);
  assert.throws(
    () => buildApplicationHandoffPreviewV1(selected),
    (error) => error instanceof ApplicationHandoffError && error.code === "POLICY_HANDOFF_INVALID"
  );

  const alteredPolicy = structuredClone(policyDocument);
  alteredPolicy.rules[0].parameters.chainId = 8453;
  const substituted = fixture();
  substituted.policy.policyBytesBase64 = Buffer.from(`${JSON.stringify(alteredPolicy)}\n`, "utf8").toString("base64");
  assert.throws(
    () => buildApplicationHandoffPreviewV1(substituted),
    (error) => error instanceof ApplicationHandoffError && error.code === "POLICY_HANDOFF_INVALID"
  );

  for (const mutate of [
    (input) => { input.policy.binding.gitBlobOid = "0".repeat(40); },
    (input) => { input.policy.binding.sha256 = `sha256:${"0".repeat(64)}`; },
    (input) => { input.policy.schemaBinding.gitBlobOid = "0".repeat(40); },
    (input) => { input.policy.schemaBinding.sha256 = `sha256:${"0".repeat(64)}`; }
  ]) {
    const placeholder = fixture();
    mutate(placeholder);
    assert.notDeepEqual(validateAgainstSchema(placeholder, inputSchema), []);
    assert.throws(
      () => buildApplicationHandoffPreviewV1(placeholder),
      (error) => error instanceof ApplicationHandoffError && error.code === "POLICY_HANDOFF_INVALID"
    );
  }
});

test("application handoff preserves a complete multi-surface inventory instead of collapsing it to a hook", () => {
  const input = fixture();
  input.project.surfaces = [
    surface("contracts", "onchain-contract", ["src/Hook.sol"], ["test/Hook.t.sol"]),
    surface("game", "game-client", ["apps/game/src/main.ts"], ["apps/game/test/main.test.ts"]),
    surface("indexer", "indexer", ["services/indexer/src/index.ts"], ["services/indexer/test/index.test.ts"])
  ];
  const result = buildApplicationHandoffPreviewV1(input);
  assert.equal(result.application.surfaceCount, 3);
  assert.deepEqual(result.project.surfaces.map(({ id }) => id), ["contracts", "game", "indexer"]);
  assert.deepEqual(result.project.surfaces[1].sourcePaths, ["apps/game/src/main.ts"]);
  assert.notEqual(result.project.inventorySha256, buildApplicationHandoffPreviewV1(fixture()).project.inventorySha256);
});

test("application handoff fails closed on source, policy, PR, origin, and authority drift", () => {
  const cases = [
    ["PROJECT_SOURCE_DRIFT", (value) => { value.project.completion.sourceCommit = "9".repeat(40); }],
    ["POLICY_TARGET_DRIFT", (value) => { value.pullRequest.target.baseCommit = "8".repeat(40); }],
    ["SOURCE_ORIGIN_INVALID", (value) => { value.source.repositoryUri = "https://gitlab.com/example/example-project"; }],
    ["SOURCE_AUTHORITY_REQUIRED", (value) => { value.builder.sourcePushPermission = false; }],
    ["PULL_REQUEST_IDENTITY_MISMATCH", (value) => {
      value.pullRequest.observed = observedPullRequest();
      value.pullRequest.observed.authorGitHubUserId = "999";
    }]
  ];
  for (const [code, mutate] of cases) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => buildApplicationHandoffPreviewV1(input),
      (error) => error instanceof ApplicationHandoffError && error.code === code,
      code
    );
  }
});

test("existing draft identity is bound but never treated as submission approval", () => {
  const input = fixture();
  input.pullRequest.observed = observedPullRequest();
  assert.deepEqual(validateAgainstSchema(input, inputSchema), []);
  const result = buildApplicationHandoffPreviewV1(input);
  assert.equal(result.pullRequest.observed.number, 42);
  assert.equal(result.transport.status, "HANDOFF_ONLY_EXTERNAL_WRITE_NOT_AUTHORIZED");
  assert.equal(result.authority.submission, "DRAFT_OPEN_BOUND_NOT_REVALIDATED");
  assert.equal(result.authority.review, "NOT_REVIEWED");
  assert.equal(result.authority.approval, "NOT_APPROVED");
});

test("CLI dry-run emits a deterministic preview and performs no local or external write", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-application-handoff-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  childProcess.execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "# exact source\n");
  childProcess.execFileSync("git", ["add", "README.md"], { cwd: root });
  childProcess.execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], { cwd: root });
  childProcess.execFileSync("git", ["remote", "add", "origin", "https://github.com/example/example-project.git"], { cwd: root });
  const localCommit = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const localTree = childProcess.execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
  const inputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-application-handoff-input-"));
  t.after(() => fs.rmSync(inputRoot, { recursive: true, force: true }));
  const inputPath = path.join(inputRoot, "handoff-input.json");
  fs.writeFileSync(inputPath, `${JSON.stringify(fixture({ sourceCommit: localCommit, sourceTree: localTree }))}\n`);
  const outputPath = path.join(os.tmpdir(), `application-handoff-${process.pid}-${Date.now()}.json`);
  t.after(() => fs.rmSync(outputPath, { force: true }));
  const result = childProcess.spawnSync(process.execPath, [
    cli, "handoff", "preview", "--input", inputPath, "--output", outputPath,
    "--repository-root", root
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.result.writeRequested, false);
  assert.equal(report.result.writePerformed, false);
  assert.equal(report.result.networkAccessed, false);
  assert.deepEqual(report.result.externalActionsPerformed, []);
  assert.equal(report.result.localSourceValidation.status, "LOCAL_SOURCE_REVISION_VALID");
  assert.equal(report.result.localSourceValidation.revisionObjectId, localCommit);
  assert.equal(fs.existsSync(outputPath), false);
  assert.match(report.result.localWritePlan.confirmationDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(report.result.localWritePlan.futureWriterBoundary, {
    createExclusive: true,
    descriptorBound: true,
    noFollow: true
  });
  const canonicalArtifact = report.result.canonicalApplicationHandoffJson;
  assert.equal(typeof canonicalArtifact, "string");
  assert.equal(canonicalArtifact.endsWith("\n"), true);
  assert.equal(Buffer.byteLength(canonicalArtifact, "utf8"), report.result.handoffBytes.byteLength);
  assert.equal(bytesDigest(Buffer.from(canonicalArtifact, "utf8")), report.result.handoffBytes.sha256);
  assert.deepEqual(JSON.parse(canonicalArtifact), report.result.preview);

  const danglingOutputPath = path.join(inputRoot, "dangling-handoff.json");
  fs.symlinkSync(path.join(inputRoot, "missing-handoff-target.json"), danglingOutputPath);
  const dangling = childProcess.spawnSync(process.execPath, [
    cli, "handoff", "preview", "--input", inputPath, "--output", danglingOutputPath,
    "--repository-root", root
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(dangling.status, 1, dangling.stdout || dangling.stderr);
  assert.equal(JSON.parse(dangling.stdout).error.code, "HANDOFF_OUTPUT_EXISTS");
  assert.equal(fs.lstatSync(danglingOutputPath).isSymbolicLink(), true);

  const denied = childProcess.spawnSync(process.execPath, [
    cli, "handoff", "preview", "--input", inputPath, "--output", outputPath,
    "--repository-root", root, "--write", "--confirm-local-write", digest("f")
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(denied.status, 1, denied.stdout || denied.stderr);
  assert.equal(JSON.parse(denied.stdout).error.code, "LOCAL_WRITE_CONFIRMATION_MISMATCH");
  assert.equal(fs.existsSync(outputPath), false);

  const unavailable = childProcess.spawnSync(process.execPath, [
    cli, "handoff", "preview", "--input", inputPath, "--output", outputPath,
    "--repository-root", root, "--write", "--confirm-local-write", report.result.localWritePlan.confirmationDigest
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(unavailable.status, 1, unavailable.stdout || unavailable.stderr);
  assert.equal(JSON.parse(unavailable.stdout).error.code, "LOCAL_WRITE_UNAVAILABLE");
  assert.equal(fs.existsSync(outputPath), false);

  fs.appendFileSync(path.join(root, "README.md"), "dirty\n");
  const drifted = childProcess.spawnSync(process.execPath, [
    cli, "handoff", "preview", "--input", inputPath, "--repository-root", root
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(drifted.status, 1, drifted.stdout || drifted.stderr);
  assert.equal(JSON.parse(drifted.stdout).error.code, "PROJECT_SOURCE_DRIFT");
  fs.writeFileSync(path.join(root, "README.md"), "# exact source\n");

  childProcess.execFileSync("git", ["remote", "set-url", "--push", "origin", "https://github.com/example/wrong-origin"], { cwd: root });
  const wrongOrigin = childProcess.spawnSync(process.execPath, [
    cli, "handoff", "preview", "--input", inputPath, "--repository-root", root
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(wrongOrigin.status, 1, wrongOrigin.stdout || wrongOrigin.stderr);
  assert.equal(JSON.parse(wrongOrigin.stdout).error.code, "SOURCE_ORIGIN_INVALID");
  assert.equal(fs.existsSync(outputPath), false);
});

function fixture({ classification = "no-market", sourceCommit = commit, sourceTree = tree } = {}) {
  return {
    schemaVersion: "programmable.application-handoff-input.v1",
    project: {
      applicationId: "example-project",
      classification,
      projectProfile: classification === "tradable" ? "foundry" : "node",
      ideaSha256: digest("a"),
      completion: {
        status: "PROJECT_PREFLIGHT_VALID",
        canonicalOutput: true,
        receipt: { sha256: digest("b"), byteLength: 1024 },
        sourceCommit,
        sourceTree
      },
      surfaces: [surface(
        classification === "tradable" ? "canonical-market" : "local-service",
        classification === "tradable" ? "onchain-contract" : "service",
        [classification === "tradable" ? "src/Hook.sol" : "src/service.mjs"],
        [classification === "tradable" ? "test/Hook.t.sol" : "test/service.test.mjs"]
      )]
    },
    source: {
      repositoryUri: "https://github.com/example/example-project",
      numericRepositoryId: "987654321",
      branch: "main",
      revisionObjectId: sourceCommit,
      treeObjectId: sourceTree,
      observedBranchHead: sourceCommit,
      public: true,
      worktreeClean: true
    },
    builder: {
      githubUserId: "123456789",
      githubLogin: "example",
      profileUrl: "https://github.com/example",
      sourcePushPermission: true
    },
    policy: {
      binding: {
        schemaVersion: "programmable.launch-policy-binding.v1",
        repository: "0xprogrammable/submit-launch",
        numericRepositoryId: "1320171831",
        baseCommit,
        baseTree,
        path: "policy/launch-policy.v1.json",
        gitBlobOid: gitBlobOid(policyBytes),
        policyId: "programmable-central-launch-policy",
        policyVersion: "1.2.0",
        profileId: "build",
        sha256: bytesDigest(policyBytes)
      },
      schemaBinding: {
        schemaVersion: "programmable.submit-launch-policy-schema-binding.v1",
        repository: "0xprogrammable/submit-launch",
        numericRepositoryId: "1320171831",
        baseCommit,
        baseTree,
        path: "policy/schemas/launch-policy.v1.schema.json",
        gitBlobOid: gitBlobOid(policySchemaBytes),
        schemaId: "https://programmable.money/schemas/launch-policy.v1.schema.json",
        sha256: bytesDigest(policySchemaBytes)
      },
      policyBytesBase64: policyBytes.toString("base64"),
      schemaBytesBase64: policySchemaBytes.toString("base64")
    },
    pullRequest: {
      target: {
        repository: "0xprogrammable/submit-launch",
        numericRepositoryId: "1320171831",
        baseBranch: "main",
        baseCommit,
        baseTree,
        intakeSchemaVersion: 2,
        intakeState: "open",
        applicationDirectory: "submissions/example-project",
        headOwnerGitHubUserId: "123456789",
        headBranch: "programmable-builder/example-project",
        draftOnly: true
      },
      observed: null
    }
  };
}

function bytesDigest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function gitBlobOid(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function surface(id, kind, sourcePaths, testPaths) {
  return { id, kind, sourcePaths, testPaths, evidencePaths: [`.programmable/evidence/${id}.json`] };
}

function observedPullRequest() {
  return {
    number: 42,
    url: "https://github.com/0xprogrammable/submit-launch/pull/42",
    state: "open",
    draft: true,
    baseRepositoryId: "1320171831",
    baseBranch: "main",
    baseCommit,
    headRepositoryId: "777777777",
    headBranch: "programmable-builder/example-project",
    headCommit: "7".repeat(40),
    authorGitHubUserId: "123456789"
  };
}
