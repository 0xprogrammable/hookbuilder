import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createBoundedChildTerminationPlan,
  runBoundedChildProcess
} from "../skills/programmable-v4-hook-builder/scripts/bounded-child-process-core.mjs";
import {
  createRepositoryCheckPlan,
  RepositoryCheckError,
  runBoundedRepositoryCheck,
  validateRepositoryCheckPlan
} from "../scripts/repository-check-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("repository check plan runs maintainability once and bounds every child suite", () => {
  const plan = createRepositoryCheckPlan({
    nodeExecutable: process.execPath,
    npmExecutable: "npm",
    e2eTests: ["evals/tests/e2e-corpus.test.mjs"],
    mcpTests: ["mcp/test/server.test.mjs"],
    repositoryTests: ["test/repository-contract.test.mjs"]
  });
  assert.deepEqual(plan.map(({ id }) => id), [
    "plugin-manifests",
    "applicant-submissions",
    "route-capabilities",
    "mcp-server",
    "portable-skill",
    "eval-structure",
    "eval-e2e-harness",
    "maintainability",
    "repository-contract"
  ]);
  assert.equal(plan.filter(({ id }) => id === "maintainability").length, 1);
  const evalStructure = plan.find(({ id }) => id === "eval-structure");
  assert.deepEqual(evalStructure.args, ["scripts/evals/validate-evals.mjs"]);
  assert.ok(plan.indexOf(evalStructure) < plan.findIndex(({ id }) => id === "eval-e2e-harness"));
  for (const check of plan) {
    assert.ok(Number.isSafeInteger(check.timeoutMs));
    assert.ok(check.timeoutMs > 0);
    assert.ok(check.timeoutMs <= 20 * 60 * 1000);
  }
  assert.throws(
    () => validateRepositoryCheckPlan(plan.filter(({ id }) => id !== "maintainability")),
    (error) => error instanceof RepositoryCheckError
      && error.code === "REPOSITORY_CHECK_PLAN_INVALID"
      && /maintainability exactly once/u.test(error.message)
  );
  assert.throws(
    () => validateRepositoryCheckPlan([...plan, plan[0]]),
    (error) => error instanceof RepositoryCheckError
      && error.code === "REPOSITORY_CHECK_PLAN_INVALID"
      && /unique canonical identifiers/u.test(error.message)
  );
});

test("repository verifier pins and schedules every eval test exactly once", () => {
  const expectedEvalTestFiles = [
    "e2e-corpus.test.mjs",
    "e2e-external-evidence.test.mjs",
    "e2e-run-adversarial.test.mjs",
    "e2e-run-delayed-output-mutation.test.mjs",
    "e2e-run-delayed-workspace-mutation.test.mjs",
    "e2e-run-non-green.test.mjs",
    "e2e-run.test.mjs",
    "run-blind-forward-tests.test.mjs",
    "run-e2e-evals.test.mjs",
    "run-model-evals.test.mjs",
    "validate-evals.test.mjs",
    "validate-forward-tests.test.mjs"
  ];
  const evalTestFiles = fs.readdirSync(path.join(repositoryRoot, "evals", "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const verifierSource = fs.readFileSync(path.join(repositoryRoot, "scripts", "verify-repository.mjs"), "utf8");
  assert.deepEqual(evalTestFiles, expectedEvalTestFiles);
  assert.match(
    verifierSource,
    /const e2eTests = fs\.readdirSync\(path\.join\(repositoryRoot, "evals", "tests"\)\)\s+\.filter\(\(name\) => name\.endsWith\("\.test\.mjs"\)\)\s+\.sort\(\)\s+\.map\(\(name\) => `evals\/tests\/\$\{name\}`\);/u
  );

  const evalTestPaths = evalTestFiles.map((name) => `evals/tests/${name}`);
  const packageDocument = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(packageDocument.scripts["test:evals:e2e"], `node --test --test-concurrency=2 ${evalTestPaths.join(" ")}`);
  const plan = createRepositoryCheckPlan({
    nodeExecutable: process.execPath,
    npmExecutable: "npm",
    e2eTests: evalTestPaths,
    mcpTests: ["mcp/test/server.test.mjs"],
    repositoryTests: ["test/repository-contract.test.mjs"]
  });
  const evalCheck = plan.find(({ id }) => id === "eval-e2e-harness");
  assert.deepEqual(evalCheck.args, ["--test", "--test-concurrency=2", ...evalTestPaths]);
});

test("Windows cleanup selects taskkill for the live process tree as its initial action", () => {
  assert.deepEqual(createBoundedChildTerminationPlan("win32"), {
    initialAction: "windows-taskkill-tree",
    forcedAction: null
  });
  assert.deepEqual(createBoundedChildTerminationPlan("linux"), {
    initialAction: "posix-term-group",
    forcedAction: "posix-kill-group"
  });
});

test("bounded repository runner records the enforced timeout on success", async () => {
  const result = await runBoundedRepositoryCheck({
    id: "success-probe",
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    timeoutMs: 2_000
  }, { cwd: repositoryRoot });
  assert.deepEqual(result, {
    durationMs: result.durationMs,
    id: "success-probe",
    exitCode: 0,
    timeoutMs: 2_000
  });
  assert.ok(Number.isSafeInteger(result.durationMs));
  assert.ok(result.durationMs >= 0);
});

test("bounded repository runner kills a stalled child and reports one fail-closed diagnostic", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    runBoundedRepositoryCheck({
      id: "stall-probe",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1_000)"],
      timeoutMs: 100
    }, { cwd: repositoryRoot }),
    (error) => error instanceof RepositoryCheckError
      && error.code === "REPOSITORY_CHECK_TIMEOUT"
      && error.id === "stall-probe"
      && error.timeoutMs === 100
      && error.message === "repository check timed out: stall-probe after 100ms"
  );
  assert.ok(Date.now() - startedAt < 5_000, "stalled child was not killed promptly");
});

test("bounded repository runner maps a nonzero child result without losing its diagnostics", async () => {
  await assert.rejects(
    runBoundedRepositoryCheck({
      id: "failure-probe",
      command: process.execPath,
      args: ["-e", "process.stderr.write('expected failure');process.exit(7)"],
      timeoutMs: 2_000
    }, { cwd: repositoryRoot }),
    (error) => error instanceof RepositoryCheckError
      && error.code === "REPOSITORY_CHECK_FAILED"
      && error.exitCode === 7
      && error.stderr === "expected failure"
  );
});

test("bounded process ownership reaps descendants after success, failure, and timeout", async (context) => {
  if (process.platform === "win32") {
    context.skip("Node does not expose Windows Job Objects for descendant ownership");
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-bounded-child-"));
  const fallbackPids = new Set();
  context.after(() => {
    for (const pid of fallbackPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  for (const scenario of [
    { name: "success", exitCode: 0, timeoutMs: 2_000, timedOut: false },
    { name: "failure", exitCode: 7, timeoutMs: 2_000, timedOut: false },
    { name: "timeout", exitCode: null, timeoutMs: 150, timedOut: true }
  ]) {
    const fixture = await runLeakingFixture(temporary, scenario);
    fallbackPids.add(fixture.descendantPid);
    assert.equal(fixture.result.timedOut, scenario.timedOut, scenario.name);
    if (scenario.exitCode !== null) assert.equal(fixture.result.status, scenario.exitCode, scenario.name);
    await assertProcessGone(fixture.descendantPid);
    fallbackPids.delete(fixture.descendantPid);
  }
});

test("bounded process ownership fails closed on its combined output bound", async () => {
  const result = await runBoundedChildProcess({
    command: process.execPath,
    args: ["-e", "process.on('SIGTERM', () => {});process.stdout.write('x'.repeat(8192));setInterval(() => {}, 1000)"],
    cwd: os.tmpdir(),
    timeoutMs: 500,
    maximumOutputBytes: 1024,
    terminationGraceMs: 750
  });
  assert.equal(result.outputExceeded, true);
  assert.equal(result.timedOut, false);
  assert.ok(Buffer.byteLength(result.stdout) <= 1024);
});

async function runLeakingFixture(temporary, { name, exitCode, timeoutMs }) {
  const pidPath = path.join(temporary, `${name}.pid`);
  const source = [
    "const cp = require('node:child_process');",
    "const fs = require('node:fs');",
    "const descendant = cp.spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {});setInterval(() => {}, 1000)`], { stdio: 'ignore' });",
    "fs.writeFileSync(process.argv[1], String(descendant.pid));",
    exitCode === null
      ? "process.on('SIGTERM', () => {});setInterval(() => {}, 1000);"
      : `process.exit(${exitCode});`
  ].join("\n");
  const result = await runBoundedChildProcess({
    command: process.execPath,
    args: ["-e", source, pidPath],
    cwd: temporary,
    timeoutMs,
    terminationGraceMs: 25
  });
  const descendantPid = Number(fs.readFileSync(pidPath, "utf8"));
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  return { descendantPid, result };
}

async function assertProcessGone(pid) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`descendant process ${pid} survived bounded cleanup`);
}
