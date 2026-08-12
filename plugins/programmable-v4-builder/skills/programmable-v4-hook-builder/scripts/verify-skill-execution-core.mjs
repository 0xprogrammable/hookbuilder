import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { runBoundedChildProcess } from "./bounded-child-process-core.mjs";

const TEST_BATCH_COUNT = 2;
const TEST_TIMEOUT_MS = 15 * 60 * 1000;
const TEST_OUTPUT_BYTES = 128 * 1024 * 1024;
const SYNTAX_CHECK_TIMEOUT_MS = 2 * 60 * 1000;
const SYNTAX_CHECK_OUTPUT_BYTES = 16 * 1024 * 1024;
const SYNTAX_CHECK_WORKER = [
  'import fs from "node:fs";',
  'import vm from "node:vm";',
  'const entries = JSON.parse(fs.readFileSync(0, "utf8"));',
  "let failed = false;",
  "for (const entry of entries) {",
  "  try {",
  '    const source = fs.readFileSync(entry.path, "utf8");',
  "    new vm.SourceTextModule(source, { identifier: entry.label });",
  "  } catch (error) {",
  "    failed = true;",
  "    process.stderr.write(JSON.stringify({",
  "      label: entry.label,",
  "      message: error instanceof Error ? error.message : String(error)",
  '    }) + "\\n");',
  "  }",
  "}",
  "if (failed) process.exitCode = 1;"
].join("\n");
const monotonicNow = () => performance.now();

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

  // The suites do most of their expensive work in synchronous child processes.
  // Parallelize at the isolated Node-process boundary instead of scheduling more
  // tests inside one blocked event loop. Per-shard caps preserve the aggregate
  // output bound and the common deadline preserves the aggregate time bound.
  const results = await Promise.all(batches.map((batch) => runChildProcess({
    command,
    args: ["--test", "--test-concurrency=2", ...batch],
    cwd,
    env,
    maximumOutputBytes: batchOutputBytes,
    timeoutMs: batchTimeoutMs
  })));

  for (const [batchIndex, result] of results.entries()) {
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
  const scripts = walk(path.join(skillRoot, "scripts"))
    .filter((entry) => entry.stat.isFile() && entry.path.endsWith(".mjs"))
    .map((entry) => ({ label: relative(entry.path), path: entry.path }));
  errors.push(...validateModuleSyntax(scripts));

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
      } else {
        errors.push(`deterministic tests failed in ${shard} (status ${status ?? "null"}, signal ${signal ?? "none"}):\n${stdout}${stderr}`.trim());
      }
    }
  }
}

export function validateModuleSyntax(entries, {
  nodeExecutable = process.execPath,
  runChildProcess = childProcess.spawnSync
} = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const result = runChildProcess(
    nodeExecutable,
    [
      "--no-warnings",
      "--experimental-vm-modules",
      "--input-type=module",
      "--eval",
      SYNTAX_CHECK_WORKER
    ],
    {
      encoding: "utf8",
      input: JSON.stringify(entries),
      maxBuffer: SYNTAX_CHECK_OUTPUT_BYTES,
      shell: false,
      timeout: SYNTAX_CHECK_TIMEOUT_MS
    }
  );
  if (result.error) {
    return [`module syntax checker failed: ${result.error.message}`];
  }
  if (result.status === 0) return [];

  const findings = [];
  for (const line of String(result.stderr).split("\n").filter(Boolean)) {
    try {
      const finding = JSON.parse(line);
      if (typeof finding.label !== "string" || typeof finding.message !== "string") throw new Error("invalid finding");
      findings.push(`${finding.label}: ${finding.message}`);
    } catch {
      return [`module syntax checker failed with status ${result.status ?? "null"}: ${String(result.stderr).trim()}`];
    }
  }
  return findings.length > 0
    ? findings
    : [`module syntax checker failed with status ${result.status ?? "null"} without a diagnostic`];
}
