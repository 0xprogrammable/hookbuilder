import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const REQUIRED_SOLC_VERSIONS = Object.freeze(["0.8.17", "0.8.26"]);

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

function inspectCompiler(filePath, version) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) throw new Error(`solc ${version} must be a regular executable file`);
  const bytes = fs.readFileSync(filePath);
  const run = spawnSync(filePath, ["--version"], { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, encoding: "utf8", shell: false, maxBuffer: 1024 * 1024 });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (run.status !== 0 || run.signal !== null || run.error || !output.split(/\r?\n/u).some((line) => line.startsWith(`Version: ${version}+`))) {
    throw new Error(`solc ${version} executable identity is invalid`);
  }
  return Object.freeze({ version, path: filePath, byteLength: bytes.length, sha256: sha256(bytes), versionOutput: output, device: stat.dev, inode: stat.ino });
}

export function resolveSolcToolchainSources(sourceHome) {
  const root = requireDirectory(sourceHome, "source SVM_HOME");
  const compilers = REQUIRED_SOLC_VERSIONS.map((version) => {
    const filePath = path.resolve(root, version, `solc-${version}`);
    if (!isInside(filePath, root)) throw new Error(`solc ${version} path escapes source SVM_HOME`);
    return inspectCompiler(filePath, version);
  });
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

export function provisionSolcToolchain({ sources, targetHome }) {
  const sourceNow = resolveSolcToolchainSources(sources.sourceHome);
  for (const expected of sources.compilers) {
    const observed = sourceNow.compilers.find(({ version }) => version === expected.version);
    if (!observed || observed.sha256 !== expected.sha256 || observed.byteLength !== expected.byteLength || observed.versionOutput !== expected.versionOutput) {
      throw new Error(`source solc ${expected.version} drifted after cohort preflight`);
    }
  }
  fs.mkdirSync(targetHome, { mode: 0o700 });
  const targetRoot = fs.realpathSync(targetHome);
  const compilers = sources.compilers.map((source) => {
    const target = path.join(targetRoot, source.version, `solc-${source.version}`);
    const copyMethod = copyCompiler(source.path, target);
    const installed = inspectCompiler(target, source.version);
    if (installed.sha256 !== source.sha256 || installed.byteLength !== source.byteLength || installed.versionOutput !== source.versionOutput) {
      throw new Error(`isolated solc ${source.version} differs from its preflight source`);
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

export function inspectProvisionedSolcToolchain(toolchain) {
  const issues = [];
  const compilers = [];
  if (typeof toolchain?.targetHome !== "string" || !path.isAbsolute(toolchain.targetHome)) {
    return Object.freeze({ valid: false, issues: ["isolated solc target home is missing or not absolute"], targetHome: null, compilers });
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
      const observed = inspectCompiler(exactPath, expected.version);
      if (observed.sha256 !== expected.sha256 || observed.byteLength !== expected.byteLength || observed.versionOutput !== expected.versionOutput || observed.device !== expected.installedDevice || observed.inode !== expected.installedInode) {
        issues.push(`isolated solc ${expected.version} identity drifted`);
      }
      if (observed.device === expected.sourceDevice && observed.inode === expected.sourceInode) issues.push(`isolated solc ${expected.version} became a source hardlink`);
      compilers.push(observed);
    } catch (error) {
      issues.push(error.message);
    }
  }
  if (compilers.length !== REQUIRED_SOLC_VERSIONS.length || JSON.stringify(compilers.map(({ version }) => version)) !== JSON.stringify(REQUIRED_SOLC_VERSIONS)) issues.push("isolated SVM_HOME does not contain both exact required compiler versions");
  return Object.freeze({ valid: issues.length === 0, issues, targetHome: targetRoot, compilers: Object.freeze(compilers) });
}
