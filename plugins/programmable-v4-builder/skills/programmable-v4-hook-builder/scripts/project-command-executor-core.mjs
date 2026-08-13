import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { spawnSafeGitSync } from "./repository-root.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const PROJECT_COMMAND_EXECUTOR_ID = "programmable-project-command-executor";
export const PROJECT_COMMAND_EXECUTOR_VERSION = "1.0.0";
export const PROJECT_COMMAND_ENVIRONMENT_PROFILE = "sanitized-local-v1";
export const PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES = 8 * 1024 * 1024;
export const PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const executorModulePath = fileURLToPath(import.meta.url);
const legacyRunnerModulePath = path.join(moduleDirectory, "bounded-child-process-core.mjs");
const emptySha256 = sha256Bytes(Buffer.alloc(0));
const shellExecutables = new Set([
  "bash", "cmd", "cmd.exe", "dash", "fish", "ksh", "powershell", "powershell.exe", "pwsh", "sh", "zsh"
]);
const trivialExecutables = new Set(["echo", "false", "printf", "pwd", "true", "whoami"]);
const credentialFlags = new Set(["--api-key", "--mnemonic", "--password", "--private-key", "--secret", "--token"]);

export class ProjectCommandExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectCommandExecutionError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function projectCommandExecutionPlanSha256(repositoryPlan) {
  const artifacts = Object.fromEntries(Object.entries(coalesce(repositoryPlan?.artifacts, {})).map(([group, records]) => [
    group,
    coalesce(records, []).map((record) => ["command-receipt", "trade-test-result"].includes(record?.kind)
      ? { ...record, status: "planned", sha256: null, byteLength: null }
      : record)
  ]));
  return canonicalJsonSha256V2({
    schemaVersion: coalesce(repositoryPlan?.schemaVersion, null),
    applicationId: coalesce(repositoryPlan?.applicationId, null),
    revision: coalesce(repositoryPlan?.revision, null),
    projectSpecSha256: coalesce(repositoryPlan?.projectSpecSha256, null),
    architectureCandidatesSha256: coalesce(repositoryPlan?.architectureCandidatesSha256, null),
    productGraphSha256: coalesce(repositoryPlan?.productGraphSha256, null),
    selectedArchitectureId: coalesce(repositoryPlan?.selectedArchitectureId, null),
    repository: coalesce(repositoryPlan?.repository, null),
    completionStatus: "materializing",
    artifacts,
    tradeCapability: coalesce(repositoryPlan?.tradeCapability, null),
    v4HookSemanticContracts: coalesce(repositoryPlan?.v4HookSemanticContracts, []),
    commands: coalesce(repositoryPlan?.commands, []),
    commandResults: [],
    completionClaim: coalesce(repositoryPlan?.completionClaim, null),
    authorization: coalesce(repositoryPlan?.authorization, null)
  });
}

// This identity remains only so legacy unsigned receipt fixtures can still be
// parsed. The portable build no longer invokes this same-UID runner.
export function projectCommandExecutorIdentity() {
  return Object.freeze({
    id: PROJECT_COMMAND_EXECUTOR_ID,
    version: PROJECT_COMMAND_EXECUTOR_VERSION,
    modulePath: "scripts/project-command-executor-core.mjs",
    moduleSha256: sha256RegularFile(executorModulePath),
    runnerModulePath: "scripts/bounded-child-process-core.mjs",
    runnerModuleSha256: sha256RegularFile(legacyRunnerModulePath)
  });
}

export function inspectCleanProjectSource(repositoryRoot) {
  const root = fs.realpathSync(repositoryRoot);
  const topLevel = git(root, ["rev-parse", "--show-toplevel"]);
  if (!topLevel.ok || fs.realpathSync(topLevel.output) !== root) {
    throw executionError("PROJECT_SOURCE_ROOT_INVALID", "repository root must be the exact Git worktree root");
  }
  const headCommit = requiredGit(root, ["rev-parse", "HEAD"], "PROJECT_SOURCE_HEAD_UNAVAILABLE");
  const tree = requiredGit(root, ["rev-parse", "HEAD^{tree}"], "PROJECT_SOURCE_TREE_UNAVAILABLE");
  const status = requiredGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], "PROJECT_SOURCE_STATUS_UNAVAILABLE");
  if (status !== "") {
    throw executionError("PROJECT_SOURCE_DIRTY", "project command execution requires a clean Git worktree", {
      porcelain: status.split("\n").slice(0, 32)
    });
  }
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (all(!branch.ok, branch.status !== 1)) {
    throw executionError("PROJECT_SOURCE_BRANCH_UNAVAILABLE", "project source branch cannot be resolved", { error: branch.error });
  }
  return Object.freeze({ headCommit, tree, branch: branch.ok ? branch.output : null, gitStatusSha256: emptySha256 });
}

export function resolveProjectCommandCwd(repositoryRoot, repositoryCwd) {
  const root = fs.realpathSync(repositoryRoot);
  if (typeof repositoryCwd !== "string" || repositoryCwd.length === 0 || path.isAbsolute(repositoryCwd)) {
    throw executionError("PROJECT_COMMAND_CWD_INVALID", "command cwd must be repository-relative");
  }
  let current = root;
  for (const segment of repositoryCwd === "." ? [] : repositoryCwd.split("/")) {
    if (any(segment === "", segment === ".", segment === "..", segment.includes("\\"))) {
      throw executionError("PROJECT_COMMAND_CWD_INVALID", "command cwd contains an unsafe path segment");
    }
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw executionError("PROJECT_COMMAND_CWD_SYMLINK", "command cwd must not traverse a symbolic link", { cwd: repositoryCwd });
    }
    if (!stat.isDirectory()) {
      throw executionError("PROJECT_COMMAND_CWD_INVALID", "command cwd must resolve to a directory", { cwd: repositoryCwd });
    }
  }
  return current;
}

// Tool resolution is a read-only helper for legacy receipt inspection. It is
// deliberately not called by executeProjectCommands.
export function resolveProjectCommandTool(requested, cwd, environmentPath = coalesce(process.env.PATH, "")) {
  if (typeof requested !== "string" || requested.length === 0 || requested.includes("\0")) {
    throw executionError("PROJECT_COMMAND_TOOL_INVALID", "command executable is invalid");
  }
  const candidates = [];
  if (path.isAbsolute(requested)) candidates.push(requested);
  else if (any(requested.includes("/"), requested.includes("\\"))) candidates.push(path.resolve(cwd, requested));
  else {
    const extensions = process.platform === "win32" ? coalesce(process.env.PATHEXT, ".EXE;.CMD;.BAT;.COM").split(";") : [""];
    for (const directory of environmentPath.split(path.delimiter).filter(Boolean)) {
      for (const extension of extensions) candidates.push(path.join(directory, `${requested}${extension}`));
    }
  }
  for (const candidate of candidates) {
    try {
      const stat = fs.lstatSync(candidate);
      if (all(!stat.isFile(), !stat.isSymbolicLink())) continue;
      const resolvedPath = fs.realpathSync(candidate);
      const resolvedStat = fs.lstatSync(resolvedPath);
      if (any(!resolvedStat.isFile(), resolvedStat.isSymbolicLink())) continue;
      return Object.freeze({ requested, resolvedPath, byteLength: resolvedStat.size, sha256: sha256RegularFile(resolvedPath) });
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error?.code)) throw error;
    }
  }
  throw executionError("PROJECT_COMMAND_TOOL_UNRESOLVED", `command executable cannot be resolved: ${requested}`);
}

export function validateProjectCommandSafety(command) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  if (!isPlainObject(command)) return [{ code: "PROJECT_COMMAND_INVALID", message: "command must be an object" }];
  if (!Array.isArray(command.argv) || command.argv.length === 0
    || command.argv.some((argument) => typeof argument !== "string" || argument.length === 0 || argument.includes("\0"))) {
    return [{ code: "PROJECT_COMMAND_ARGV_INVALID", message: "command argv must be a non-empty string array" }];
  }
  if (!isPlainObject(command.executionPolicy)
    || Object.keys(command.executionPolicy).sort().join("\0") !== ["externalWrites", "networkAccess"].sort().join("\0")
    || command.executionPolicy.externalWrites !== false
    || !["forbidden", "read-only"].includes(command.executionPolicy.networkAccess)) {
    add("PROJECT_COMMAND_POLICY_INVALID", "command executionPolicy must forbid external writes and declare bounded network access");
  }
  const executable = path.basename(command.argv[0]).toLowerCase();
  const args = command.argv.slice(1);
  const first = coalesce(args[0], "").toLowerCase();
  if (shellExecutables.has(executable)) add("PROJECT_COMMAND_SHELL_FORBIDDEN", "shell interpreters are forbidden in repository plans");
  if (any(
    trivialExecutables.has(executable),
    all(args.length <= 1, ["--help", "--version", "-h", "-v", "help", "version"].includes(first)),
    looksLikeTrivialInlineProgram(executable, args)
  )) add("PROJECT_COMMAND_NOOP_FORBIDDEN", "version, help, echo, and trivial exit commands cannot prove a repository gate");
  if (args.some((argument) => any(credentialFlags.has(argument.toLowerCase()), argument.toLowerCase() === "--broadcast"))) {
    add("PROJECT_COMMAND_EXTERNAL_WRITE_FLAG_FORBIDDEN", "credential and external-write flags are forbidden");
  }
  if (externalMutationCommand(executable, args)) {
    add("PROJECT_COMMAND_EXTERNAL_MUTATION_FORBIDDEN", "the planned command can mutate an external system");
  }
  if (all(command.kind === "install", packageInstallRunsLifecycleScripts(executable, args))) {
    add("PROJECT_COMMAND_INSTALL_SCRIPTS_FORBIDDEN", "dependency installation must disable package lifecycle scripts");
  }
  return issues;
}

export function projectCommandSignature(command) {
  return canonicalJsonSha256V2({ argv: coalesce(command?.argv, null), cwd: coalesce(command?.cwd, null) });
}

export function projectCommandEnvironmentSha256(command) {
  return canonicalJsonSha256V2({
    contract: "project-command-environment-v1",
    shell: false,
    environmentProfile: PROJECT_COMMAND_ENVIRONMENT_PROFILE,
    credentialsInherited: false,
    externalWrites: coalesce(command?.executionPolicy?.externalWrites, null),
    networkAccess: coalesce(command?.executionPolicy?.networkAccess, null),
    maximumOutputBytes: projectCommandMaximumOutputBytes(command)
  });
}

export function projectCommandMaximumOutputBytes(command) {
  return ["quote-test", "execution-test"].includes(command?.kind)
    ? PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES
    : PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES;
}

// Legacy deterministic receipt constructor. These receipts are intentionally
// unauthenticated and cannot satisfy the external sandbox gate.
export function createProjectCommandReceipt({
  repositoryPlan, command, source, tool, executionResult, maximumOutputBytes, domainEvidence = null, tradeExecution = null
}) {
  const rawStdout = Buffer.from(executionResult.stdout, "utf8");
  const normalized = normalizeValidatedTradeReceiptOutput(rawStdout, command, tradeExecution, domainEvidence);
  const stdout = normalized.stdout;
  const stderr = Buffer.from(executionResult.stderr, "utf8");
  const payload = {
    schemaVersion: "1.0.0",
    kind: "programmable-project-command-receipt",
    executor: projectCommandExecutorIdentity(),
    executionPolicy: {
      shell: false,
      environmentProfile: PROJECT_COMMAND_ENVIRONMENT_PROFILE,
      credentialsInherited: false,
      externalWrites: command.executionPolicy.externalWrites,
      networkAccess: command.executionPolicy.networkAccess,
      maximumOutputBytes
    },
    source: {
      ...source,
      executionPlanSha256: projectCommandExecutionPlanSha256(repositoryPlan),
      commandsSha256: canonicalJsonSha256V2(repositoryPlan.commands),
      commandSha256: canonicalJsonSha256V2(command)
    },
    commandId: command.id,
    commandKind: command.kind,
    argv: command.argv,
    argvSha256: canonicalJsonSha256V2(command.argv),
    cwd: command.cwd,
    timeoutMs: command.timeoutMs,
    tool,
    status: "passed",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputExceeded: false,
    stdoutSha256: sha256Bytes(stdout),
    stdoutByteLength: stdout.length,
    stderrSha256: sha256Bytes(stderr),
    stderrByteLength: stderr.length,
    domainEvidence: normalized.domainEvidence,
    networkAccessed: null,
    externalActionsPerformed: []
  };
  return Object.freeze({ ...payload, receiptSha256: canonicalJsonSha256V2(payload) });
}

function normalizeValidatedTradeReceiptOutput(raw, command, execution, evidence) {
  if (execution === null) return { stdout: raw, domainEvidence: evidence };
  if (!["quote-test", "execution-test"].includes(command.kind)) {
    throw executionError("TRADE_RECEIPT_NORMALIZATION_INVALID", `trade command ${command.id} has an invalid kind`);
  }
  if (!isPlainObject(evidence?.runnerEvidence)
    || canonicalJsonSha256V2(execution.runnerEvidence) !== canonicalJsonSha256V2(evidence.runnerEvidence)) {
    throw executionError("TRADE_RECEIPT_NORMALIZATION_INVALID", `trade command ${command.id} lacks validated runner evidence`);
  }
  if (execution.runnerEvidence.runnerOutputSha256 !== sha256Bytes(raw)
    || execution.runnerEvidence.runnerOutputByteLength !== raw.length) {
    throw executionError("TRADE_RECEIPT_NORMALIZATION_DRIFT", `trade command ${command.id} raw parser binding drifted`);
  }
  let output;
  try {
    output = parseBoundedStrictJsonBytes(raw, {
      maxSourceBytes: PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES,
      maxNodes: 5_000_000
    });
  } catch (error) {
    throw executionError("TRADE_RECEIPT_NORMALIZATION_INVALID", `trade command ${command.id} stdout cannot be normalized`, {
      cause: error.code
    });
  }
  const [[suiteName, suite]] = Object.entries(output);
  const [[testSignature, observed]] = Object.entries(suite.test_results);
  const logPrefix = "PROGRAMMABLE_TRADE_RESULT_V1:";
  const resultLog = `${logPrefix}${canonicalJsonV2(execution.result)}`;
  const observedResultLogs = observed.decoded_logs
    .filter((value) => value?.startsWith?.(logPrefix) === true)
    .map((value) => value.replace(/\n$/u, ""));
  const expectedIdentity = {
    testSignature: execution.runnerEvidence.testSignature,
    status: "Success",
    unitGas: execution.runnerEvidence.unitGas,
    decodedResultLogs: [resultLog]
  };
  if (canonicalJsonSha256V2({
    testSignature,
    status: observed.status,
    unitGas: observed.kind.Unit.gas,
    decodedResultLogs: observedResultLogs
  }) !== canonicalJsonSha256V2(expectedIdentity)) {
    throw executionError("TRADE_RECEIPT_NORMALIZATION_DRIFT", `trade command ${command.id} suite, test, status, gas, or result log drifted`);
  }
  const stdout = Buffer.from(`${canonicalJsonV2({
    contract: "forge-trade-stdout-identity-v1",
    suiteName,
    ...expectedIdentity,
    callEvidence: execution.runnerEvidence.callEvidence
  })}\n`, "utf8");
  const runnerEvidence = {
    ...evidence.runnerEvidence,
    runnerOutputSha256: sha256Bytes(stdout),
    runnerOutputByteLength: stdout.length
  };
  return { stdout, domainEvidence: Object.freeze({ ...evidence, runnerEvidence: Object.freeze(runnerEvidence) }) };
}

export async function executeProjectCommands({ repositoryRoot, repositoryPlan, outputPlanPath }) {
  const root = normalizeRoot(repositoryRoot);
  const source = inspectCleanProjectSource(root);
  assertProjectSourceBinding(source, repositoryPlan);
  if (repositoryPlan?.completionStatus !== "materializing") {
    throw executionError("PROJECT_PLAN_NOT_MATERIALIZING", "executor accepts only materializing repository plans");
  }
  if (!Array.isArray(repositoryPlan.commands) || repositoryPlan.commands.length === 0) {
    throw executionError("PROJECT_COMMANDS_REQUIRED", "repository plan must contain at least one command");
  }
  if (outputPlanPath !== ".programmable/repository-plan.v1.json") {
    throw executionError("PROJECT_OUTPUT_PLAN_PATH_INVALID", "completed repository plan path is fixed");
  }
  const commandIds = new Set();
  const signatures = new Set();
  for (const command of repositoryPlan.commands) {
    const issues = validateProjectCommandSafety(command);
    if (issues.length > 0) throw executionError(issues[0].code, issues[0].message, { commandId: command?.id });
    if (command.required !== true) throw executionError("PROJECT_COMMAND_REQUIRED", `command ${command.id} must be required`);
    if (commandIds.has(command.id)) throw executionError("PROJECT_COMMAND_ID_DUPLICATE", `command id ${command.id} is duplicated`);
    commandIds.add(command.id);
    const signature = projectCommandSignature(command);
    if (signatures.has(signature)) throw executionError("PROJECT_COMMAND_REPEATED", `command ${command.id} repeats an earlier argv and cwd`);
    signatures.add(signature);
    resolveProjectCommandCwd(root, command.cwd);
  }
  throw executionError(
    "PROJECT_EXTERNAL_SANDBOX_REQUIRED",
    "candidate commands are not executed by the portable same-UID process; an independently trusted external sandbox verifier is required",
    {
      status: "PROJECT_EXECUTION_BLOCKED",
      executionPlanSha256: projectCommandExecutionPlanSha256(repositoryPlan),
      source,
      outputPlanPath,
      planCreated: true,
      executionCompleted: false,
      commandsExecuted: false,
      networkAccessed: false,
      externalWritesPerformed: false,
      trustedSandboxAuthorityConfigured: false
    }
  );
}

function normalizeRoot(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0 || repositoryRoot.includes("\0")) {
    throw executionError("PROJECT_SOURCE_ROOT_INVALID", "repositoryRoot must be a non-empty path");
  }
  const stat = fs.lstatSync(repositoryRoot);
  if (any(!stat.isDirectory(), stat.isSymbolicLink())) {
    throw executionError("PROJECT_SOURCE_ROOT_INVALID", "repositoryRoot must be a real directory");
  }
  return fs.realpathSync(repositoryRoot);
}

export function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256RegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (any(!stat.isFile(), stat.isSymbolicLink(), stat.size > 512 * 1024 * 1024)) {
    throw executionError("PROJECT_COMMAND_TOOL_INVALID", "bound executable must be a regular bounded file", { filePath });
  }
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let offset = 0;
    while (offset < stat.size) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (bytesRead === 0) {
        throw executionError("PROJECT_COMMAND_TOOL_INVALID", "bound executable changed while hashing", { filePath });
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function requiredGit(root, args, code) {
  const result = git(root, args);
  if (!result.ok) throw executionError(code, `Git evidence command failed: git ${args.join(" ")}`, { error: result.error });
  return result.output;
}

function assertProjectSourceBinding(source, repositoryPlan) {
  if (repositoryPlan?.repository?.headCommit !== source.headCommit) {
    throw executionError("PROJECT_SOURCE_HEAD_MISMATCH", "repository plan is not bound to the executing HEAD");
  }
  if (repositoryPlan?.repository?.branch !== source.branch) {
    throw executionError("PROJECT_SOURCE_BRANCH_MISMATCH", "repository plan is not bound to the executing branch");
  }
}

function looksLikeTrivialInlineProgram(executable, args) {
  if (!new Set(["node", "node.exe", "python", "python3", "python.exe"]).has(executable)) return false;
  if (!["-c", "-e", "--eval"].includes(args[0])) return false;
  const program = coalesce(args[1], "").replaceAll(/\s+/gu, "");
  return ["", "0", "pass", "exit(0)", "process.exit(0);", "process.exit(0)"].includes(program);
}

function externalMutationCommand(executable, args) {
  const first = coalesce(args[0], "").toLowerCase();
  if (["gh", "gh.exe", "scp", "scp.exe", "ssh", "ssh.exe"].includes(executable)) return true;
  if (all(executable === "git", ["push", "send-email"].includes(first))) return true;
  if (all(["npm", "npm.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"].includes(executable),
    ["deprecate", "dist-tag", "login", "owner", "publish", "star", "team", "token", "unpublish"].includes(first))) return true;
  if (all(executable === "cast", ["publish", "send", "wallet"].includes(first))) return true;
  if (all(executable === "forge", first === "script")) return true;
  if (["kubectl", "terraform", "vercel"].includes(executable)) return true;
  if (all(executable === "docker", ["login", "push"].includes(first))) return true;
  if (["curl", "wget"].includes(executable)) {
    return args.some((argument) => /^(?:--data|--form|--request|--upload-file|-d|-f|-t|-x)$/iu.test(argument));
  }
  return false;
}

function packageInstallRunsLifecycleScripts(executable, args) {
  if (!["npm", "npm.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd"].includes(executable)) return false;
  if (!["ci", "install"].includes(coalesce(args[0], "").toLowerCase())) return false;
  return !args.includes("--ignore-scripts");
}

function git(root, args) {
  const result = spawnSafeGitSync(["-C", root, ...args], { encoding: "utf8", timeout: 10_000 });
  return result.status === 0
    ? { ok: true, status: 0, output: result.stdout.trim() }
    : { ok: false, status: result.status, error: (result.stderr || result.error?.message || `exit ${result.status}`).trim() };
}

function executionError(code, message, details = {}) {
  return new ProjectCommandExecutionError(code, message, details);
}

function coalesce(value, fallback) {
  return value == null ? fallback : value;
}

function any(...conditions) {
  return conditions.some(Boolean);
}

function all(...conditions) {
  return conditions.every(Boolean);
}

function isPlainObject(value) {
  return all(value !== null, typeof value === "object", !Array.isArray(value));
}
