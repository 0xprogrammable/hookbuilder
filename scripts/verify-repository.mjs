#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createLogRecord,
  inventorySolidityTests,
  RELEASE_KERNEL_CHECKS,
  RELEASE_KERNEL_EVIDENCE_KIND,
  RELEASE_KERNEL_EVIDENCE_SCHEMA_VERSION,
  RELEASE_KERNEL_EVIDENCE_STATUS,
  RELEASE_KERNELS,
  RELEASE_TOOL_VERSIONS,
  sha256,
  toolVersionAccepted
} from "./release-evidence-core.mjs";
import {
  createRepositoryCheckPlan,
  RepositoryCheckError,
  runBoundedRepositoryCheck
} from "./repository-check-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const versionAuthority = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "plugin.json"), "utf8"));
const packageDocument = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
if (packageDocument.version !== versionAuthority.version) {
  throw new Error("package.json version must match canonical config/plugin.json version");
}
const repositoryVersion = versionAuthority.version;
const options = parseArgs(process.argv.slice(2));
const releaseCommandTimeoutMs = options.kernelEvidenceOutput === null ? null : kernelTimeoutMs();
const repositoryTests = fs.readdirSync(path.join(repositoryRoot, "test"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `test/${name}`);
const e2eTests = fs.readdirSync(path.join(repositoryRoot, "evals", "tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `evals/tests/${name}`);
const mcpTests = fs.readdirSync(path.join(repositoryRoot, "mcp", "test"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `mcp/test/${name}`);
const checks = createRepositoryCheckPlan({
  nodeExecutable: process.execPath,
  npmExecutable: process.platform === "win32" ? "npm.cmd" : "npm",
  e2eTests,
  mcpTests,
  repositoryTests
});

const results = [];
for (const check of checks) {
  try {
    results.push(await runBoundedRepositoryCheck(check, { cwd: repositoryRoot }));
  } catch (error) {
    if (!(error instanceof RepositoryCheckError)) throw error;
    results.push({
      durationMs: error.durationMs ?? null,
      id: check.id,
      exitCode: error.exitCode ?? 1,
      timeoutMs: check.timeoutMs,
      errorCode: error.code
    });
    if (error.stdout) fsWrite(1, error.stdout);
    if (error.stderr) fsWrite(2, error.stderr);
    fsWrite(2, `${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
    break;
  }
}

if (process.exitCode === undefined) {
  let kernelEvidence = null;
  if (options.kernelEvidenceOutput) {
    kernelEvidence = collectKernelEvidence(options);
    writeNewJson(options.kernelEvidenceOutput, kernelEvidence);
    if (kernelEvidence.status === "KERNEL_RELEASE_EVIDENCE_FAILED") process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify({
    status: process.exitCode === undefined ? "REPOSITORY_VALID" : "REPOSITORY_INVALID",
    version: repositoryVersion,
    networkAccessed: options.kernelEvidenceOutput
      ? "not-measured-package-install-network-permitted"
      : false,
    externalActionsPerformed: [],
    checks: results,
    ...(kernelEvidence ? {
      kernelEvidence: {
        path: options.kernelEvidenceOutput,
        status: kernelEvidence.status,
        releaseEligible: kernelEvidence.releaseEligible,
        sha256: sha256(fs.readFileSync(options.kernelEvidenceOutput))
      }
    } : {})
  }, null, 2)}\n`);
}

function collectKernelEvidence(values) {
  const selectedKernels = values.kernels ?? RELEASE_KERNELS.map(({ id }) => id);
  const selectedChecks = values.kernelChecks ?? RELEASE_KERNEL_CHECKS.map(({ id }) => id);
  const focused = values.kernels !== null || values.kernelChecks !== null;
  const commit = git(["rev-parse", "HEAD"]).trim();
  const initialWorktreeStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const source = {
    commit,
    tree: git(["rev-parse", `${commit}^{tree}`]).trim(),
    skillTree: git(["rev-parse", `${commit}:skills/programmable-v4-hook-builder`]).trim(),
    worktreeClean: false,
    worktreeStatusSha256: sha256(initialWorktreeStatus)
  };
  const tools = RELEASE_TOOL_VERSIONS.map(runToolVersion);
  const kernels = RELEASE_KERNELS
    .filter(({ id }) => selectedKernels.includes(id))
    .map((specification) => runKernelChecks(specification, selectedChecks));
  const finalHead = git(["rev-parse", "HEAD"]).trim();
  const finalWorktreeStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const sourceUnchanged = finalHead === commit
    && initialWorktreeStatus.length === 0
    && finalWorktreeStatus.length === 0;
  const statusEvidence = initialWorktreeStatus.length > 0
    ? initialWorktreeStatus
    : finalWorktreeStatus.length > 0
      ? finalWorktreeStatus
      : finalHead === commit
        ? ""
        : `HEAD_CHANGED:${commit}:${finalHead}`;
  source.worktreeClean = sourceUnchanged;
  source.worktreeStatusSha256 = sha256(statusEvidence);
  const allToolsPass = tools.every(({ accepted, exitCode }) => accepted && exitCode === 0);
  const allChecksPass = kernels.every(({ checks: kernelChecks }) => (
    kernelChecks.length === selectedChecks.length
    && kernelChecks.every(({ result, exitCode }) => result === "PASS" && exitCode === 0)
  ));
  const inventoriesPass = kernels.every(({ id, testInventory }) => (
    testInventory.unit > 0
    && testInventory.fuzz > 0
    && testInventory.invariant > 0
  ));
  const releaseEligible = !focused
    && source.worktreeClean
    && allToolsPass
    && allChecksPass
    && inventoriesPass;
  return {
    schemaVersion: RELEASE_KERNEL_EVIDENCE_SCHEMA_VERSION,
    kind: RELEASE_KERNEL_EVIDENCE_KIND,
    status: releaseEligible
      ? RELEASE_KERNEL_EVIDENCE_STATUS
      : focused && allToolsPass && allChecksPass && inventoriesPass
        ? "KERNEL_FOCUSED_EVIDENCE_COMPLETED"
        : "KERNEL_RELEASE_EVIDENCE_FAILED",
    releaseEligible,
    source,
    createdFromCommitTime: new Date(git(["show", "-s", "--format=%cI", commit]).trim()).toISOString(),
    verifiedAt: new Date().toISOString(),
    selection: {
      mode: focused ? "focused" : "release",
      kernels: selectedKernels,
      checks: selectedChecks
    },
    tools,
    kernels,
    externalActionsPerformed: []
  };
}

function runToolVersion(specification) {
  const [recordedCommand, ...args] = specification.command;
  const command = recordedCommand === "node" ? process.execPath : recordedCommand;
  const result = runCaptured(command, args, repositoryRoot);
  const stdout = String(result.stdout);
  const stderr = String(result.stderr);
  const version = `${stdout}${stderr}`.trim();
  return {
    id: specification.id,
    command: [...specification.command],
    policy: specification.policy,
    version,
    accepted: result.status === 0 && toolVersionAccepted(specification.id, version),
    timeoutMs: result.timeoutMs,
    durationMs: result.durationMs,
    exitCode: result.status,
    stdout: createLogRecord(stdout),
    stderr: createLogRecord(stderr)
  };
}

function runKernelChecks(specification, selectedChecks) {
  const sourceKernelRoot = path.join(repositoryRoot, specification.sourcePath);
  const lockfilePath = path.join(sourceKernelRoot, "package-lock.json");
  const lockfile = fs.readFileSync(lockfilePath);
  const testInventory = inventorySolidityTests(path.join(sourceKernelRoot, "test"));
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), `programmable-release-kernel-${specification.id}-`));
  const isolatedKernelRoot = path.join(isolatedRoot, "kernel");
  try {
    const transientNames = new Set(["broadcast", "cache", "coverage", "node_modules", "out"]);
    fs.cpSync(sourceKernelRoot, isolatedKernelRoot, {
      recursive: true,
      filter: (source) => !transientNames.has(path.basename(source))
    });
    const kernelChecks = RELEASE_KERNEL_CHECKS
      .filter(({ id }) => selectedChecks.includes(id))
      .map((check) => {
        const [command, ...args] = check.command;
        const result = runCaptured(command, args, isolatedKernelRoot, check.environment);
        const stdout = String(result.stdout);
        const stderr = String(result.stderr);
        process.stderr.write(`${result.status === 0 ? "passed" : "failed"}: kernel-${specification.id}-${check.id}\n`);
        return {
          id: check.id,
          command: [...check.command],
          environment: { ...check.environment },
          workingDirectory: specification.sourcePath,
          executionMode: "isolated-temporary-copy",
          timeoutMs: result.timeoutMs,
          durationMs: result.durationMs,
          exitCode: result.status,
          result: result.status === 0 ? "PASS" : "FAIL",
          stdout: createLogRecord(stdout),
          stderr: createLogRecord(stderr)
        };
      });
    return {
      id: specification.id,
      sourcePath: specification.sourcePath,
      historicalFrozen: specification.historicalFrozen,
      lockfile: {
        path: `${specification.sourcePath}/package-lock.json`,
        bytes: lockfile.length,
        sha256: sha256(lockfile)
      },
      testInventory,
      checks: kernelChecks
    };
  } finally {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

function runCaptured(command, args, cwd, environment = {}) {
  const started = Date.now();
  const timeoutMs = releaseCommandTimeoutMs;
  if (timeoutMs === null) throw new Error("kernel command timeout was not initialized");
  const inheritedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    !key.startsWith("FOUNDRY_") && !key.startsWith("DAPP_")
  )));
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...inheritedEnvironment, ...environment },
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs
  });
  const diagnostic = result.error ? `${result.stderr ?? ""}\n${result.error.message}`.trim() : result.stderr;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: diagnostic ?? "",
    timeoutMs,
    durationMs: Date.now() - started
  };
}

function parseArgs(args) {
  const values = { kernelEvidenceOutput: null, kernels: null, kernelChecks: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--kernel-evidence-out") {
      if (values.kernelEvidenceOutput !== null) fail("--kernel-evidence-out cannot be repeated");
      const value = args[++index];
      if (!value || !path.isAbsolute(value)) fail("--kernel-evidence-out must be an absolute new file outside the repository");
      values.kernelEvidenceOutput = path.normalize(value);
    } else if (argument === "--kernel") {
      values.kernels ??= [];
      addSelection(values.kernels, args[++index], RELEASE_KERNELS.map(({ id }) => id), "--kernel");
    } else if (argument === "--kernel-check") {
      values.kernelChecks ??= [];
      addSelection(values.kernelChecks, args[++index], RELEASE_KERNEL_CHECKS.map(({ id }) => id), "--kernel-check");
    } else fail(`unknown argument: ${argument}`);
  }
  if ((values.kernels !== null || values.kernelChecks !== null) && values.kernelEvidenceOutput === null) {
    fail("focused kernel selections require --kernel-evidence-out");
  }
  if (values.kernelEvidenceOutput !== null) assertSafeEvidenceOutput(values.kernelEvidenceOutput);
  if (values.kernelChecks !== null && !values.kernelChecks.includes("dependencies")) {
    values.kernelChecks.push("dependencies");
  }
  if (values.kernels !== null) {
    values.kernels = RELEASE_KERNELS.map(({ id }) => id).filter((id) => values.kernels.includes(id));
  }
  if (values.kernelChecks !== null) {
    values.kernelChecks = RELEASE_KERNEL_CHECKS.map(({ id }) => id).filter((id) => values.kernelChecks.includes(id));
  }
  return values;
}

function addSelection(selection, value, allowed, flag) {
  if (!allowed.includes(value)) fail(`${flag} must be one of: ${allowed.join(", ")}`);
  if (selection.includes(value)) fail(`${flag} cannot repeat ${value}`);
  selection.push(value);
}

function assertSafeEvidenceOutput(outputFile) {
  if (fs.existsSync(outputFile)) fail("--kernel-evidence-out must not already exist");
  const parent = path.dirname(outputFile);
  if (!fs.existsSync(parent)) fail("--kernel-evidence-out parent must already exist");
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("--kernel-evidence-out parent must be a real directory");
  const relative = path.relative(fs.realpathSync(repositoryRoot), path.join(fs.realpathSync(parent), path.basename(outputFile)));
  if (!(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    fail("--kernel-evidence-out must resolve outside the repository");
  }
}

function writeNewJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o644 });
}

function git(args) {
  const result = childProcess.spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(result.stderr);
  return result.stdout;
}

function kernelTimeoutMs() {
  const raw = process.env.PROGRAMMABLE_RELEASE_KERNEL_TIMEOUT_MS;
  if (raw === undefined) return 20 * 60 * 1000;
  if (!/^[0-9]+$/u.test(raw)) fail("PROGRAMMABLE_RELEASE_KERNEL_TIMEOUT_MS must be an integer");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60 * 60 * 1000) {
    fail("PROGRAMMABLE_RELEASE_KERNEL_TIMEOUT_MS must be between 1000 and 3600000");
  }
  return value;
}

function fail(message) {
  fsWrite(2, `${String(message).trim()}\n`);
  process.exit(1);
}

function fsWrite(fd, contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), "utf8");
  const waitCell = new Int32Array(new SharedArrayBuffer(4));
  let offset = 0;
  let backpressureRetries = 0;
  while (offset < bytes.length) {
    try {
      const written = fs.writeSync(fd, bytes, offset, Math.min(64 * 1024, bytes.length - offset));
      if (written < 1) throw Object.assign(new Error("diagnostic output made no progress"), { code: "EIO" });
      offset += written;
      backpressureRetries = 0;
    } catch (error) {
      if (error?.code === "EINTR") continue;
      if ((error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") && backpressureRetries < 2_000) {
        backpressureRetries += 1;
        Atomics.wait(waitCell, 0, 0, 5);
        continue;
      }
      throw error;
    }
  }
}
