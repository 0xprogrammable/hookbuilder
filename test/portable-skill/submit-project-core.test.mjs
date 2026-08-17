import assert from "node:assert/strict";
import test from "node:test";

import { runSubmitProjectJourney } from "../../skills/programmable-v4-hook-builder/scripts/submit-project-core.mjs";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const DIGEST = `sha256:${"c".repeat(64)}`;
const CONFIRMATION = `sha256:${"d".repeat(64)}`;

test("core fails compatibility before reading or writing a workspace", async () => {
  const harness = createHarness({
    async resolveCompatibility() {
      harness.calls.push("resolveCompatibility");
      return { ok: false, state: "INTEGRATION_PENDING", diagnostics: [finding("CONTRACT_MISMATCH", "INTEGRATION")] };
    }
  });
  const result = await runSubmitProjectJourney(input(), harness.adapters);
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.state, "INTEGRATION_PENDING");
  assert.equal(result.result.writePerformed, false);
  assert.equal(result.result.workspace.statePersisted, false);
  assert.deepEqual(harness.calls, ["resolveCompatibility"]);
});

test("core persists one exact plan and resumes without mutation before confirmation", async () => {
  const harness = createHarness();
  const first = await runSubmitProjectJourney(input(), harness.adapters);
  assert.equal(first.exitCode, 0);
  assert.equal(first.result.state, "READY_FOR_CONFIRMATION");
  assert.equal(first.result.confirmationDigest, CONFIRMATION);
  assert.equal(first.result.workspace.confirmationDigest, CONFIRMATION);
  assert.equal(first.result.writePerformed, false);
  assert.equal(harness.calls.filter((name) => name === "mutateDraft").length, 0);
  assert.match(first.result.safeNextCommand, /--confirm-external-write/u);

  const second = await runSubmitProjectJourney(input({ resume: true }), harness.adapters);
  assert.equal(second.result.confirmationDigest, CONFIRMATION);
  assert.equal(harness.calls.filter((name) => name === "mutateDraft").length, 0);
});

test("core performs one confirmed mutation then one GET-only reconciliation", async () => {
  const harness = createHarness({
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
  assert.equal(harness.calls.filter((name) => name === "reconcileRemoteStatus").length, 1);
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
    async resolveCompatibility() {
      calls.push("resolveCompatibility");
      return { ok: true, binding: { repository: "0xprogrammable/submit-launch", repositoryId: "1320171831", defaultBranch: "main", centralBaseCommit: COMMIT, centralBaseTree: TREE } };
    },
    async validateProjectPackage() { calls.push("validateProjectPackage"); return { ok: true, binding: { path: "submission.v2.json", sha256: DIGEST } }; },
    async discoverPublicSource() { calls.push("discoverPublicSource"); return { ok: true, binding: { repository: "example/project", repositoryId: "42", commit: COMMIT, tree: TREE } }; },
    async prepareApplicationPackage() { calls.push("prepareApplicationPackage"); return { ok: true, binding: { applicationId: "example", sha256: DIGEST } }; },
    async validateClosedPackage() { calls.push("validateClosedPackage"); return { ok: true, binding: { sha256: DIGEST } }; },
    async readGithubAuth() { calls.push("readGithubAuth"); return { ok: true, binding: { login: "applicant", userId: "42", forkAllowed: true } }; },
    async planDraft({ target }) {
      calls.push("planDraft");
      assert.equal(target.repository, "0xprogrammable/submit-launch");
      return { ok: true, confirmationDigest: CONFIRMATION, operation: "submit", target };
    },
    async mutateDraft() { calls.push("mutateDraft"); return { status: "submitted", pullRequest: { number: 7, draft: true } }; },
    async reconcileRemoteStatus() { calls.push("reconcileRemoteStatus"); return { state: "DRAFT_OPEN", pullRequest: { number: 7, draft: true } }; }
  };
  Object.assign(adapters, overrides);
  return { adapters, calls, get workspace() { return workspace; } };
}

function input(overrides = {}) {
  return { repositoryRoot: "/project", workspaceRoot: "/workspace", confirmExternalWrite: null, resume: false, verbose: false, ...overrides };
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
