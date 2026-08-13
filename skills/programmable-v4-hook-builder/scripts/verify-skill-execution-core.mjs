import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import vm from "node:vm";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { runBoundedChildProcess } from "./bounded-child-process-core.mjs";

const MODULE_SYNTAX_TIMEOUT_MS = 60_000;
const MODULE_SYNTAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TEST_BATCH_COUNT = 2;
const TEST_TIMEOUT_MS = 15 * 60 * 1000;
const TEST_OUTPUT_BYTES = 128 * 1024 * 1024;
const monotonicNow = () => performance.now();

if (!isMainThread && workerData?.kind === "module-syntax-parser") {
  if (!Array.isArray(workerData.scripts) || typeof vm.SourceTextModule !== "function") {
    throw new Error("module syntax parser requires Node 24 vm.SourceTextModule and a script inventory");
  }
  const diagnostics = [];
  for (const script of workerData.scripts) {
    try {
      const source = fs.readFileSync(script, "utf8");
      new vm.SourceTextModule(source, { identifier: script });
    } catch (error) {
      const name = typeof error?.name === "string" ? error.name : "Error";
      const message = typeof error?.message === "string" ? error.message : String(error);
      diagnostics.push({ message: `${name}: ${message}`.slice(0, 4_096), script });
    }
  }
  parentPort.postMessage({ diagnostics });
}

export async function parseModuleSyntax({
  scripts,
  timeoutMs = MODULE_SYNTAX_TIMEOUT_MS
}) {
  return await new Promise((resolve) => {
    let payload = null;
    let settled = false;
    let deadline = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (deadline !== null) clearTimeout(deadline);
      resolve(result);
    };
    let worker;
    try {
      worker = new Worker(new URL(import.meta.url), {
        execArgv: ["--experimental-vm-modules", "--no-warnings"],
        resourceLimits: {
          codeRangeSizeMb: 16,
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4
        },
        type: "module",
        workerData: { kind: "module-syntax-parser", scripts }
      });
    } catch (error) {
      finish({ diagnostics: [], failure: `module syntax parser could not start: ${error.message}` });
      return;
    }
    deadline = setTimeout(() => {
      void worker.terminate();
      finish({ diagnostics: [], failure: `module syntax parser exceeded its ${timeoutMs}ms bound` });
    }, timeoutMs);

    worker.once("message", (message) => {
      let outputBytes;
      try {
        outputBytes = Buffer.byteLength(JSON.stringify(message));
      } catch {
        void worker.terminate();
        finish({ diagnostics: [], failure: "module syntax parser returned an invalid result" });
        return;
      }
      if (outputBytes > MODULE_SYNTAX_OUTPUT_BYTES) {
        void worker.terminate();
        finish({ diagnostics: [], failure: "module syntax parser exceeded its 4 MiB output bound" });
        return;
      }
      payload = message;
    });
    worker.once("error", (error) => {
      finish({ diagnostics: [], failure: `module syntax parser failed: ${error.message}` });
    });
    worker.once("exit", (status) => {
      if (status !== 0) {
        finish({ diagnostics: [], failure: `module syntax parser exited with status ${status}` });
        return;
      }
      if (!Array.isArray(payload?.diagnostics) || payload.diagnostics.some((diagnostic) =>
        typeof diagnostic?.script !== "string" || typeof diagnostic?.message !== "string"
      )) {
        finish({ diagnostics: [], failure: "module syntax parser returned an invalid result" });
        return;
      }
      finish({ diagnostics: payload.diagnostics, failure: null });
    });
  });
}

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
  const scripts = walk(path.join(skillRoot, "scripts"))
    .filter((entry) => entry.stat.isFile() && entry.path.endsWith(".mjs"))
    .map((entry) => entry.path);
  const syntax = await parseModuleSyntax({ scripts });
  if (syntax.failure) {
    errors.push(syntax.failure);
  } else {
    for (const diagnostic of syntax.diagnostics) {
      errors.push(`${relative(diagnostic.script)}: ${diagnostic.message}`);
    }
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
