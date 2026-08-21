import assert from "node:assert/strict";
import test from "node:test";

import { runSubmitProjectJourney } from "../../skills/programmable-v4-hook-builder/scripts/submit-project-core.mjs";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const CONFIRMATION = `sha256:${"d".repeat(64)}`;
const SNAPSHOT_DIGEST = `sha256:${"e".repeat(64)}`;
const STAGE_DIGEST = `sha256:${"f".repeat(64)}`;

test("core fails the single current-contract resolution before reading or writing a workspace", async () => {
  const harness = createHarness({
    async resolveCurrentContract() {
      harness.calls.push("resolveCurrentContract");
      return { ok: false, state: "INTEGRATION_PENDING", diagnostics: [finding("SUBMIT_LAUNCH_CONTRACT_UNSTABLE", "INTEGRATION")] };
    }
  });
  const result = await runSubmitProjectJourney(input(), harness.adapters);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.state, "INTEGRATION_PENDING");
  assert.equal(result.result.writePerformed, false);
  assert.equal(result.result.workspace.statePersisted, false);
  assert.deepEqual(harness.calls, ["resolveCurrentContract"]);
});

test("core uses one snapshot object across the application, plan and workspace and appends immutable resume receipts", async () => {
  const snapshot = contractSnapshot();
  const seen = [];
  const harness = createHarness({
    async resolveCurrentContract() {
      harness.calls.push("resolveCurrentContract");
      return snapshot;
    },
    async prepareApplicationPackage({ contractSnapshot }) {
      harness.calls.push("prepareApplicationPackage");
      seen.push(contractSnapshot);
      return { ok: true, binding: { applicationId: "example", sha256: DIGEST } };
    },
    async planDraft({ contractSnapshot, applicationPackage }) {
      harness.calls.push("planDraft");
      seen.push(contractSnapshot);
      assert.equal(applicationPackage.submitLaunchContract.snapshotSha256, SNAPSHOT_DIGEST);
      assert.equal(applicationPackage.submitLaunchContract.stageSha256, STAGE_DIGEST);
      return planFor(contractSnapshot);
    }
  });
  const first = await runSubmitProjectJourney(input(), harness.adapters);
  assert.equal(first.exitCode, 0);
  assert.equal(first.result.state, "READY_FOR_CONFIRMATION");
  assert.equal(first.result.confirmationDigest, CONFIRMATION);
  assert.equal(harness.workspace.submitLaunch.activeSnapshotSha256, SNAPSHOT_DIGEST);
  assert.equal(harness.workspace.submitLaunch.activeStageSha256, STAGE_DIGEST);
  assert.equal(first.result.writePerformed, false);
  assert.equal(first.result.summary.length > 0, true);
  assert.equal(first.result.nextAction, first.result.safeNextCommand);
  assert.ok(seen.every((value) => value === snapshot));
  assert.equal(harness.calls.filter((name) => name === "resolveCurrentContract").length, 1);
  const originalSnapshotRecord = structuredClone(harness.workspace.submitLaunch.snapshots[0]);
  const originalEvaluation = structuredClone(harness.workspace.submitLaunch.evaluations[0]);

  const second = await runSubmitProjectJourney(input({ resume: true }), harness.adapters);
  assert.equal(second.result.confirmationDigest, CONFIRMATION);
  assert.equal(harness.calls.filter((name) => name === "mutateDraft").length, 0);
  assert.equal(harness.workspace.submitLaunch.snapshots.length, 1);
  assert.deepEqual(harness.workspace.submitLaunch.snapshots[0], originalSnapshotRecord);
  assert.deepEqual(harness.workspace.submitLaunch.evaluations[0], originalEvaluation);
  assert.equal(
    harness.workspace.submitLaunch.evaluations[1].previousEvaluationSha256,
    originalEvaluation.evaluationSha256
  );
});

test("core performs the exact-head recheck immediately before one confirmed mutation", async () => {
  const harness = createHarness({
    async assertCurrentContract({ snapshotBinding }) {
      harness.calls.push("assertCurrentContract");
      assert.equal(snapshotBinding.snapshotSha256, SNAPSHOT_DIGEST);
      return { currentness: { status: "CURRENT" }, snapshotBinding };
    },
    async mutateDraft({ confirmationDigest }) {
      harness.calls.push("mutateDraft");
      return { status: "ambiguous", receipt: { confirmationDigest } };
    },
    async reconcileRemoteStatus({ readOnly }) {
      harness.calls.push("reconcileRemoteStatus");
      assert.equal(readOnly, true);
      return { state: "DRAFT_OPEN", pullRequest: { number: 7, draft: true } };
    }
  });
  const result = await runSubmitProjectJourney(input({ confirmExternalWrite: CONFIRMATION }), harness.adapters);
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.state, "DRAFT_OPEN");
  assert.equal(result.result.writePerformed, true);
  assert.equal(harness.calls.filter((name) => name === "mutateDraft").length, 1);
  assert.deepEqual(
    harness.calls.slice(harness.calls.indexOf("assertCurrentContract"), harness.calls.indexOf("mutateDraft") + 1),
    ["assertCurrentContract", "mutateDraft"]
  );
  assert.equal(harness.workspace.submitLaunch.evaluations.at(-1).event, "pre-write-recheck");
  assert.equal(harness.workspace.submitLaunch.evaluations.at(-1).status, "CURRENT");
});

test("contract drift appends a chained receipt and causes zero external writes", async () => {
  let firstReceipt;
  const harness = createHarness({
    async assertCurrentContract() {
      harness.calls.push("assertCurrentContract");
      firstReceipt = structuredClone(harness.workspace.submitLaunch.evaluations[0]);
      const error = new Error("protected main moved");
      error.code = "SUBMIT_LAUNCH_CONTRACT_DRIFT";
      throw error;
    },
    async mutateDraft() {
      assert.fail("drift must stop before the external write adapter");
    }
  });
  const result = await runSubmitProjectJourney(input({ confirmExternalWrite: CONFIRMATION }), harness.adapters);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.state, "INTEGRATION_PENDING");
  assert.equal(result.result.writePerformed, false);
  assert.equal(result.result.diagnostics[0].code, "SUBMIT_LAUNCH_CONTRACT_DRIFT");
  assert.equal(harness.calls.includes("mutateDraft"), false);
  assert.deepEqual(harness.workspace.submitLaunch.evaluations[0], firstReceipt);
  const drift = harness.workspace.submitLaunch.evaluations[1];
  assert.equal(drift.status, "DRIFT");
  assert.equal(drift.previousEvaluationSha256, firstReceipt.evaluationSha256);
});

test("core forwards the closed route table without adding version or market heuristics", async () => {
  for (const routeState of ["no-market", "external", "unresolved", "official-programmable-ethereum"]) {
    const snapshot = contractSnapshot(routeState);
    const harness = createHarness({
      async resolveCurrentContract(options) {
        harness.calls.push("resolveCurrentContract");
        assert.equal(options.stage, "submit");
        assert.equal(options.routeState, routeState);
        return snapshot;
      }
    });
    const result = await runSubmitProjectJourney(input({ routeState }), harness.adapters);
    assert.equal(result.exitCode, 0, routeState);
    assert.equal(harness.workspace.submitLaunch.evaluations[0].routeState, routeState);
  }
});

test("core preserves resolver error classes and rejects malformed snapshots", async () => {
  for (const [expected, resolver] of [
    ["POLICY_UNRESOLVED", async () => { const error = new Error("offline"); error.code = "POLICY_UNRESOLVED"; throw error; }],
    ["SUBMIT_LAUNCH_CONTRACT_UNSTABLE", async () => { const error = new Error("moving ref"); error.code = "SUBMIT_LAUNCH_CONTRACT_UNSTABLE"; throw error; }],
    ["SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED", async () => ({ schemaVersion: "unknown" })]
  ]) {
    const harness = createHarness({
      async resolveCurrentContract(...args) {
        harness.calls.push("resolveCurrentContract");
        return await resolver(...args);
      }
    });
    const result = await runSubmitProjectJourney(input(), harness.adapters);
    assert.equal(result.exitCode, 1, expected);
    assert.equal(result.result.diagnostics[0].code, expected);
    assert.equal(result.result.writePerformed, false);
    assert.deepEqual(harness.calls, ["resolveCurrentContract"]);
  }
});

test("core caps concise diagnostics at three while verbose retains all findings", async () => {
  const diagnostics = Array.from({ length: 5 }, (_, index) => finding(`BLOCKER_${index}`, "PROJECT"));
  const harness = createHarness({
    async validateProjectPackage() {
      harness.calls.push("validateProjectPackage");
      return { ok: false, state: "NEEDS_PROJECT_PACKAGE", diagnostics };
    }
  });
  const result = await runSubmitProjectJourney(input({ verbose: true }), harness.adapters);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.diagnostics.length, 3);
  assert.equal(result.result.details.diagnostics.length, 5);
});

function createHarness(overrides = {}) {
  const calls = [];
  let workspace = null;
  const adapters = {
    async readWorkspace() { calls.push("readWorkspace"); return workspace; },
    async writeWorkspaceAtomically({ workspace: value }) { calls.push("writeWorkspaceAtomically"); workspace = structuredClone(value); },
    async resolveCurrentContract() { calls.push("resolveCurrentContract"); return contractSnapshot(); },
    async assertCurrentContract({ snapshotBinding }) { calls.push("assertCurrentContract"); return { currentness: { status: "CURRENT" }, snapshotBinding }; },
    async validateProjectPackage() { calls.push("validateProjectPackage"); return { ok: true, binding: { path: "submission.v2.json", sha256: DIGEST } }; },
    async discoverPublicSource() { calls.push("discoverPublicSource"); return { ok: true, binding: { repository: "example/project", repositoryId: "42", commit: COMMIT, tree: TREE } }; },
    async prepareApplicationPackage() { calls.push("prepareApplicationPackage"); return { ok: true, binding: { applicationId: "example", sha256: DIGEST } }; },
    async validateClosedPackage() { calls.push("validateClosedPackage"); return { ok: true, binding: { sha256: DIGEST } }; },
    async readGithubAuth() { calls.push("readGithubAuth"); return { ok: true, binding: { login: "applicant", userId: "42", forkAllowed: true } }; },
    async planDraft({ target, contractSnapshot }) {
      calls.push("planDraft");
      assert.equal(target.repository, "0xprogrammable/submit-launch");
      return planFor(contractSnapshot, target);
    },
    async mutateDraft() { calls.push("mutateDraft"); return { status: "submitted", pullRequest: { number: 7, draft: true } }; },
    async reconcileRemoteStatus() { calls.push("reconcileRemoteStatus"); return { state: "DRAFT_OPEN", pullRequest: { number: 7, draft: true } }; }
  };
  Object.assign(adapters, overrides);
  return { adapters, calls, get workspace() { return workspace; } };
}

function contractSnapshot(routeState = "unresolved") {
  return {
    schemaVersion: "programmable.submit-launch-contract-snapshot.v1",
    snapshotBinding: {
      repository: "0xprogrammable/submit-launch",
      numericRepositoryId: "1320171831",
      branch: "main",
      baseCommit: COMMIT,
      baseTree: TREE,
      compatibility: { protocolVersion: "2.0.0" },
      snapshotSha256: SNAPSHOT_DIGEST
    },
    currentness: {
      status: "CURRENT",
      refCheckedBefore: true,
      refCheckedAfter: true,
      retryCount: 0,
      cacheStatus: "MISS"
    },
    applicationContract: {
      current: { id: "public-pr-application-v3.2" },
      legacy: [{ id: "public-pr-application-v3.1", officialReadiness: false }],
      supportingContracts: [],
      minimumBuilderProtocolVersion: "2.0.0"
    },
    projectStage: {
      schemaVersion: "programmable.submit-launch-stage-plan.v1",
      stage: "submit",
      profileId: "submission",
      profileEnabled: true,
      routeState,
      status: routeState === "official-programmable-ethereum" ? "REQUIRED" : "ELIGIBLE",
      requirementIds: [],
      requirements: [],
      unknownHandlerIds: [],
      stageSha256: STAGE_DIGEST
    },
    authority: {
      approvalGranted: false,
      deploymentGranted: false,
      launchGranted: false
    }
  };
}

function planFor(contractSnapshot, target = { repository: "0xprogrammable/submit-launch" }) {
  return {
    ok: true,
    confirmationDigest: CONFIRMATION,
    operation: "submit",
    target,
    submitLaunchContract: {
      snapshotSha256: contractSnapshot.snapshotBinding.snapshotSha256,
      stageSha256: contractSnapshot.projectStage.stageSha256
    }
  };
}

function input(overrides = {}) {
  return { repositoryRoot: "/project", workspaceRoot: "/workspace", confirmExternalWrite: null, resume: false, verbose: false, routeState: "unresolved", ...overrides };
}

function finding(code, causeClass) {
  return {
    code,
    causeClass,
    summary: "The exact prerequisite is not available.",
    repair: "Restore it and resume.",
    safeNextCommand: "node cli.mjs submit-project /project --workspace-root /workspace --resume",
    writePerformed: false
  };
}
