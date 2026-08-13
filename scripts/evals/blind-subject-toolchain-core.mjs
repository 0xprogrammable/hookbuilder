import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const REQUIRED_SOLC_VERSIONS = Object.freeze(["0.8.17", "0.8.26"]);
const SAFE_SYSTEM_ERROR_CODES = new Set([
  "E2BIG", "EACCES", "EAGAIN", "EBUSY", "EIO", "EISDIR", "EINVAL", "ELOOP", "EMFILE", "ENFILE",
  "ENOENT", "ENOEXEC", "ENOMEM", "ENOTDIR", "EPERM", "ETXTBSY",
]);
const SAFE_SIGNALS = new Set([
  "SIGABRT", "SIGALRM", "SIGBUS", "SIGCHLD", "SIGCONT", "SIGFPE", "SIGHUP", "SIGILL", "SIGINFO", "SIGINT",
  "SIGIO", "SIGKILL", "SIGPIPE", "SIGPROF", "SIGQUIT", "SIGSEGV", "SIGSTOP", "SIGSYS", "SIGTERM", "SIGTRAP",
  "SIGTSTP", "SIGTTIN", "SIGTTOU", "SIGURG", "SIGUSR1", "SIGUSR2", "SIGVTALRM", "SIGWINCH", "SIGXCPU", "SIGXFSZ",
]);

export class SolcToolchainError extends Error {
  constructor(code, message, { execution = null } = {}) {
    super(message);
    this.name = "SolcToolchainError";
    this.code = code;
    if (execution !== null) this.execution = Object.freeze({ ...execution });
  }
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requireDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink directory`);
  return fs.realpathSync(directory);
}

function safeErrorCode(value) {
  return SAFE_SYSTEM_ERROR_CODES.has(value) ? value : "SPAWN_ERROR";
}

function safeSignal(value) {
  if (value === null || value === undefined) return null;
  return SAFE_SIGNALS.has(value) ? value : "UNKNOWN_SIGNAL";
}

function compilerStructure(filePath, version) {
  let stat;
  let bytes;
  try {
    stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) {
      throw new SolcToolchainError("SOLC_STRUCTURE_INVALID", `solc ${version} must be a regular executable file`);
    }
    bytes = fs.readFileSync(filePath);
    const after = fs.lstatSync(filePath);
    if (
      !after.isFile() || after.isSymbolicLink() || (after.mode & 0o111) === 0
      || stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== bytes.length || after.size !== bytes.length
    ) throw new SolcToolchainError("SOLC_STRUCTURE_INVALID", `solc ${version} structural identity changed while reading`);
  } catch (error) {
    if (error instanceof SolcToolchainError) throw error;
    throw new SolcToolchainError("SOLC_STRUCTURE_INVALID", `solc ${version} structural identity is unavailable (${safeErrorCode(error?.code)})`);
  }
  return Object.freeze({ version, path: filePath, byteLength: bytes.length, sha256: sha256(bytes), device: stat.dev, inode: stat.ino });
}

function assertCompilerBytes(observed, expected, code, message) {
  if (!expected || observed.sha256 !== expected.sha256 || observed.byteLength !== expected.byteLength) {
    throw new SolcToolchainError(code, message);
  }
}

function executeCompilerIdentity(structure, spawnCompiler) {
  let run;
  try {
    run = spawnCompiler(structure.path, ["--version"], {
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      encoding: "utf8",
      shell: false,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const execution = { errorCode: safeErrorCode(error?.code), status: null, signal: null };
    throw new SolcToolchainError("SOLC_EXECUTION_FAILED", `solc ${structure.version} version execution failed`, { execution });
  }
  const execution = {
    errorCode: run?.error ? safeErrorCode(run.error.code) : null,
    status: Number.isSafeInteger(run?.status) ? run.status : null,
    signal: safeSignal(run?.signal),
  };
  if (execution.errorCode !== null || execution.status !== 0 || execution.signal !== null) {
    throw new SolcToolchainError("SOLC_EXECUTION_FAILED", `solc ${structure.version} version execution failed`, { execution });
  }
  const stdout = typeof run.stdout === "string" ? run.stdout : Buffer.isBuffer(run.stdout) ? run.stdout.toString("utf8") : "";
  const stderr = typeof run.stderr === "string" ? run.stderr : Buffer.isBuffer(run.stderr) ? run.stderr.toString("utf8") : "";
  const output = `${stdout}${stderr}`.trim();
  if (!output.split(/\r?\n/u).some((line) => line.startsWith(`Version: ${structure.version}+`))) {
    throw new SolcToolchainError("SOLC_EXECUTION_IDENTITY_INVALID", `solc ${structure.version} version output is invalid`, { execution });
  }
  return Object.freeze({ ...structure, versionOutput: output });
}

export function resolveSolcToolchainSources(sourceHome, { expectedCompilers = null, spawnCompiler = spawnSync } = {}) {
  const root = requireDirectory(sourceHome, "source SVM_HOME");
  const structures = REQUIRED_SOLC_VERSIONS.map((version) => {
    const filePath = path.resolve(root, version, `solc-${version}`);
    if (!isInside(filePath, root)) throw new Error(`solc ${version} path escapes source SVM_HOME`);
    return compilerStructure(filePath, version);
  });
  if (expectedCompilers !== null) for (const observed of structures) {
    const expected = expectedCompilers.find(({ version }) => version === observed.version);
    assertCompilerBytes(observed, expected, "SOURCE_SOLC_DRIFT", `source solc ${observed.version} drifted after cohort preflight`);
  }
  const compilers = structures.map((structure) => executeCompilerIdentity(structure, spawnCompiler));
  if (expectedCompilers !== null) for (const observed of compilers) {
    const expected = expectedCompilers.find(({ version }) => version === observed.version);
    if (observed.versionOutput !== expected?.versionOutput) {
      throw new SolcToolchainError("SOURCE_SOLC_EXECUTION_DRIFT", `source solc ${observed.version} execution identity drifted after cohort preflight`);
    }
  }
  return Object.freeze({ sourceHome: root, compilers });
}

function copyCompiler(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  let copyMethod = "independent-copy";
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE_FORCE);
    copyMethod = "copy-on-write-clone";
  } catch (error) {
    if (!["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EINVAL"].includes(error.code)) throw error;
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
  fs.chmodSync(target, 0o700);
  return copyMethod;
}

export function provisionSolcToolchain({ sources, targetHome, spawnCompiler = spawnSync }) {
  const sourceNow = resolveSolcToolchainSources(sources.sourceHome, { expectedCompilers: sources.compilers, spawnCompiler });
  for (const expected of sources.compilers) {
    const observed = sourceNow.compilers.find(({ version }) => version === expected.version);
    if (!observed || observed.sha256 !== expected.sha256 || observed.byteLength !== expected.byteLength || observed.versionOutput !== expected.versionOutput) {
      throw new SolcToolchainError("SOURCE_SOLC_DRIFT", `source solc ${expected.version} drifted after cohort preflight`);
    }
  }
  fs.mkdirSync(targetHome, { mode: 0o700 });
  const targetRoot = fs.realpathSync(targetHome);
  const compilers = sources.compilers.map((source) => {
    const target = path.join(targetRoot, source.version, `solc-${source.version}`);
    const copyMethod = copyCompiler(source.path, target);
    const installedStructure = compilerStructure(target, source.version);
    assertCompilerBytes(installedStructure, source, "ISOLATED_SOLC_DRIFT", `isolated solc ${source.version} differs from its preflight source`);
    const installed = executeCompilerIdentity(installedStructure, spawnCompiler);
    if (installed.versionOutput !== source.versionOutput) {
      throw new SolcToolchainError("ISOLATED_SOLC_EXECUTION_DRIFT", `isolated solc ${source.version} execution identity differs from its preflight source`);
    }
    if (source.device === installed.device && source.inode === installed.inode) throw new Error(`isolated solc ${source.version} must not hardlink its source`);
    return Object.freeze({ version: source.version, sourcePath: source.path, sourceDevice: source.device, sourceInode: source.inode, installedPath: target, installedDevice: installed.device, installedInode: installed.inode, byteLength: installed.byteLength, sha256: installed.sha256, versionOutput: installed.versionOutput, copyMethod });
  });
  return Object.freeze({
    targetHome: targetRoot,
    compilers,
    isolation: { separateWritablePaths: true, hardlinksUsed: false, sourceHomeExposedToSubject: false, samePhysicalHost: true, copyOnWriteMaySharePhysicalExtentsUntilMutation: compilers.some(({ copyMethod }) => copyMethod === "copy-on-write-clone") },
  });
}

export function inspectProvisionedSolcToolchain(toolchain, { spawnCompiler = spawnSync } = {}) {
  const issues = [];
  const diagnostics = [];
  const compilers = [];
  if (typeof toolchain?.targetHome !== "string" || !path.isAbsolute(toolchain.targetHome)) {
    return Object.freeze({ valid: false, issues: ["isolated solc target home is missing or not absolute"], diagnostics, targetHome: null, compilers });
  }
  let targetRoot = null;
  try { targetRoot = requireDirectory(toolchain.targetHome, "isolated SVM_HOME"); }
  catch (error) { issues.push(error.message); }
  for (const expected of toolchain.compilers ?? []) {
    const exactPath = targetRoot === null ? null : path.join(targetRoot, expected.version, `solc-${expected.version}`);
    if (exactPath === null || expected.installedPath !== exactPath || !isInside(exactPath, targetRoot)) {
      issues.push(`isolated solc ${expected.version} path differs from the conventional SVM layout`);
      continue;
    }
    try {
      const structure = compilerStructure(exactPath, expected.version);
      assertCompilerBytes(structure, expected, "ISOLATED_SOLC_DRIFT", `isolated solc ${expected.version} identity drifted`);
      const observed = executeCompilerIdentity(structure, spawnCompiler);
      if (observed.versionOutput !== expected.versionOutput || observed.device !== expected.installedDevice || observed.inode !== expected.installedInode) {
        issues.push(`isolated solc ${expected.version} identity drifted`);
      }
      if (observed.device === expected.sourceDevice && observed.inode === expected.sourceInode) issues.push(`isolated solc ${expected.version} became a source hardlink`);
      compilers.push(observed);
    } catch (error) {
      const diagnostic = {
        code: error?.code ?? "SOLC_INSPECTION_FAILED",
        message: error.message,
        ...(error?.execution === undefined ? {} : { execution: error.execution }),
      };
      diagnostics.push(Object.freeze(diagnostic));
      issues.push(error?.code ? `${error.code}: ${error.message}` : error.message);
    }
  }
  if (compilers.length !== REQUIRED_SOLC_VERSIONS.length || JSON.stringify(compilers.map(({ version }) => version)) !== JSON.stringify(REQUIRED_SOLC_VERSIONS)) issues.push("isolated SVM_HOME does not contain both exact required compiler versions");
  return Object.freeze({ valid: issues.length === 0, issues, diagnostics: Object.freeze(diagnostics), targetHome: targetRoot, compilers: Object.freeze(compilers) });
}
