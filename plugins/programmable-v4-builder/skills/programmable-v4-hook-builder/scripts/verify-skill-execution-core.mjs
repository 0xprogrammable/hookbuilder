import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { runBoundedChildProcess } from "./bounded-child-process-core.mjs";

const TEST_BATCH_COUNT = 2;
const TEST_TIMEOUT_MS = 15 * 60 * 1000;
const TEST_OUTPUT_BYTES = 128 * 1024 * 1024;
const monotonicNow = () => performance.now();
export const REQUIRED_PORTABLE_TESTS = Object.freeze(`
application-api-schema application-dependency-core application-v3-prepare-revision-core build-info
build-profile builder-lifecycle canonical-json-core central-policy-authority-boundary cli
cli-central-base cli-central-package cli-entry cli-open-world
cli-open-world-github cli-output-dir cli-prepare-pr companion-manifest-v2
composition-checker contract-registry cross-chain-policy dependency-pointer-core
example-materializer fee-conformance fee-conformance-receipt-v1 fee-conformance-vector-set-v1
fee-policy-v2 fee-policy-v2-vector-parity github-application github-exact-object-resolver
github-public-source-core golden-scenarios historical-v1-freeze implementation-legos-runtime
knowledge-router launch-bundle launch-bundle-v2 launch-bundle-v2-cli
launch-plan-graph legacy-strict-json-boundaries official-launchpad open-world-migration
open-world-regressions open-world-runtime open-world-security open-world-source-signals
open-world-v2 open-world-v2-module-boundaries ordinary-launch-cli package-dependency-contract
policy-bundle project-compiler-foundation project-compiler-materialization
prepare-canary project-compiler-output project-compiler-plan project-compiler-receipts project-executor-safety project-repair-attempt
project-compiler-v4-deployment project-surfaces public-claims
raw-git-integrity-core registry-acceptance-v3-github registry-discovery residual-json-boundaries
resolve-contract-core review-target review-target-contract reviewed-drift-receipt
runtime-assets-core schema-security semantic-rule-registry source-closure-verifier
source-evidence-workflow source-manifest strict-json-core submission submit-launch-policy-client
template-catalog trade-capability-manifest typed-launch-contracts-v1 upstream-drift
v4-hook-semantic-contract verify-package-build-info verify-skill-static
`.trim().split(/\s+/u).map((stem) => `scripts/test/${stem}.test.mjs`));

export function createDeterministicTestBatches(testFiles) {
  return Array.from({ length: TEST_BATCH_COUNT }, (_, batchIndex) =>
    testFiles.filter((_, testIndex) => testIndex % TEST_BATCH_COUNT === batchIndex)
  ).filter((batch) => batch.length > 0);
}

export async function runDeterministicTestBatches({
  command,
  cwd,
  env,
  maximumOutputBytes = TEST_OUTPUT_BYTES,
  now = monotonicNow,
  runChildProcess = runBoundedChildProcess,
  testFiles,
  timeoutMs = TEST_TIMEOUT_MS
}) {
  const batches = createDeterministicTestBatches(testFiles);
  const deadline = now() + timeoutMs;
  const batchTimeoutMs = Math.floor(deadline - now());
  if (batchTimeoutMs < 1) {
    return { batches, failure: { batchIndex: 0, kind: "timeout", signal: null, status: null }, results: [] };
  }
  const batchOutputBytes = Math.floor(maximumOutputBytes / batches.length);
  if (batchOutputBytes < 1) {
    return { batches, failure: { batchIndex: 0, kind: "output", signal: null, status: null }, results: [] };
  }

  const settlements = await Promise.allSettled(batches.map((batch) => runChildProcess({
    command,
    args: ["--test", "--test-concurrency=2", ...batch],
    cwd,
    env,
    maximumOutputBytes: batchOutputBytes,
    timeoutMs: batchTimeoutMs
  })));
  const results = settlements.map((settlement) => settlement.status === "fulfilled"
    ? settlement.value
    : {
        outputExceeded: false,
        runnerRejected: true,
        signal: null,
        status: null,
        stderr: settlement.reason instanceof Error
          ? settlement.reason.message
          : "child runner rejected without an Error",
        stdout: "",
        timedOut: false
      });

  for (const [batchIndex, result] of results.entries()) {
    if (result.runnerRejected) return { batches, failure: { ...result, batchIndex, kind: "runner" }, results };
    if (result.timedOut) return { batches, failure: { ...result, batchIndex, kind: "timeout" }, results };
    if (result.outputExceeded) return { batches, failure: { ...result, batchIndex, kind: "output" }, results };
    if (result.status !== 0) return { batches, failure: { ...result, batchIndex, kind: "status" }, results };
  }
  return { batches, failure: null, results };
}

export async function validateScriptsAndTests({
  errors,
  installedMode,
  relative,
  skillRoot,
  untrustedDataMode,
  walk
}) {
  for (const script of walk(path.join(skillRoot, "scripts")).filter((entry) => entry.stat.isFile() && entry.path.endsWith(".mjs")).map((entry) => entry.path)) {
    const result = childProcess.spawnSync(process.execPath, ["--check", script], { encoding: "utf8", shell: false });
    if (result.status !== 0) errors.push(`${relative(script)}: ${result.stderr.trim()}`);
  }

  const testDirectory = path.join(skillRoot, "scripts", "test");
  if (!untrustedDataMode) {
    const testFiles = fs.readdirSync(testDirectory)
      .filter((name) => name.endsWith(".test.mjs") && (!installedMode || name === "cli.test.mjs"))
      .sort()
      .map((name) => path.join(testDirectory, name));
    const tests = await runDeterministicTestBatches({
      command: process.execPath,
      cwd: skillRoot,
      env: process.env,
      testFiles
    });
    if (tests.failure) {
      const { batchIndex, kind, signal, status, stderr = "", stdout = "" } = tests.failure;
      const shard = `shard ${batchIndex + 1}/${tests.batches.length}`;
      if (kind === "timeout") {
        errors.push(`deterministic tests exceeded the shared 15-minute aggregate bound in ${shard}:\n${stdout}${stderr}`.trim());
      } else if (kind === "output") {
        errors.push(`deterministic tests exceeded the shared 128 MiB aggregate output bound in ${shard}`);
      } else if (kind === "runner") {
        errors.push(`deterministic test runner failed in ${shard}: ${stderr}`.trim());
      } else {
        errors.push(`deterministic tests failed in ${shard} (status ${status ?? "null"}, signal ${signal ?? "none"}):\n${stdout}${stderr}`.trim());
      }
    }
  }
}
