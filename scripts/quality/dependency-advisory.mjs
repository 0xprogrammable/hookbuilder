#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dependencyAdvisoryMarkdown,
  normalizeNpmAuditReport
} from "./dependency-advisory-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const maximumAuditOutputBytes = 32 * 1024 * 1024;
const auditTimeoutMs = 120_000;
const packages = Object.freeze([
  Object.freeze({ id: "repository", directory: "." }),
  Object.freeze({
    id: "reference-kernel-v1",
    directory: "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v1"
  }),
  Object.freeze({
    id: "reference-kernel-v2",
    directory: "skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v2"
  })
]);

try {
  const options = parseArguments(process.argv.slice(2));
  const report = collectDependencyAdvisories();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output !== null) writeNewOutsideRepository(options.output, json, "advisory output");
  if (options.githubSummary !== null) appendOutsideRepository(options.githubSummary, dependencyAdvisoryMarkdown(report));
  process.stdout.write(json);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function collectDependencyAdvisories() {
  const results = [];
  for (const specification of packages) {
    const packageRoot = resolvePackageRoot(specification.directory);
    const before = snapshotPackageFiles(packageRoot, specification.id);
    const audit = childProcess.spawnSync(npmCommand, [
      "audit",
      "--json",
      "--package-lock-only",
      "--ignore-scripts"
    ], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_audit: "true",
        npm_config_fund: "false",
        npm_config_ignore_scripts: "true",
        npm_config_update_notifier: "false"
      },
      maxBuffer: maximumAuditOutputBytes,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: auditTimeoutMs
    });
    if (audit.error !== undefined || audit.signal !== null || ![0, 1].includes(audit.status)) {
      throw new Error(`${specification.id}: npm advisory query failed: ${sanitizeDiagnostic(audit)}`);
    }
    let rawReport;
    try {
      rawReport = JSON.parse(audit.stdout);
    } catch {
      throw new Error(`${specification.id}: npm advisory query did not return JSON`);
    }
    const after = snapshotPackageFiles(packageRoot, specification.id);
    if (before.packageJsonSha256 !== after.packageJsonSha256 || before.lockfileSha256 !== after.lockfileSha256) {
      throw new Error(`${specification.id}: npm advisory query mutated package metadata`);
    }
    results.push({
      ...normalizeNpmAuditReport(rawReport, specification.id),
      directory: specification.directory,
      packageJsonSha256: before.packageJsonSha256,
      lockfileSha256: before.lockfileSha256
    });
  }
  const total = results.reduce((sum, result) => sum + result.counts.total, 0);
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-dependency-advisory-report",
    status: total === 0 ? "NO_ADVISORIES_REPORTED" : "ADVISORIES_REPORTED",
    observedAt: new Date().toISOString(),
    reportOnly: true,
    automaticRemediation: false,
    repositoryMutations: [],
    externalReadsPerformed: ["npm-registry-advisory-query"],
    scanner: "npm audit --json --package-lock-only --ignore-scripts",
    packages: results
  };
}

function snapshotPackageFiles(packageRoot, packageId) {
  const packageJson = readBoundedRegularFile(path.join(packageRoot, "package.json"), 2 * 1024 * 1024, `${packageId} package.json`);
  const lockfile = readBoundedRegularFile(path.join(packageRoot, "package-lock.json"), 16 * 1024 * 1024, `${packageId} package-lock.json`);
  return Object.freeze({
    packageJsonSha256: sha256(packageJson),
    lockfileSha256: sha256(lockfile)
  });
}

function resolvePackageRoot(relativePath) {
  if (
    typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath.includes("\\")
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("dependency advisory package path is invalid");
  }
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("dependency advisory package path escapes the repository");
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${relativePath} must be a real package directory`);
  return absolutePath;
}

function parseArguments(args) {
  const options = { output: null, githubSummary: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output" || argument === "--github-summary") {
      const value = args[index + 1];
      if (typeof value !== "string" || !path.isAbsolute(value)) {
        throw new Error(`${argument} requires an absolute path outside the repository`);
      }
      const key = argument === "--output" ? "output" : "githubSummary";
      if (options[key] !== null) throw new Error(`${argument} cannot be repeated`);
      options[key] = path.normalize(value);
      index += 1;
    } else {
      throw new Error("usage: dependency-advisory.mjs [--output <absolute-new-file>] [--github-summary <absolute-file>]");
    }
  }
  return Object.freeze(options);
}

function writeNewOutsideRepository(filePath, content, label) {
  assertOutsideRepository(filePath, label);
  if (fs.existsSync(filePath)) throw new Error(`${label} must be a new file`);
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function appendOutsideRepository(filePath, content) {
  assertOutsideRepository(filePath, "GitHub step summary");
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("GitHub step summary must be a regular file");
  }
  fs.appendFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
}

function assertOutsideRepository(filePath, label) {
  const parent = path.dirname(filePath);
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} parent must be a real directory`);
  const resolved = path.join(fs.realpathSync(parent), path.basename(filePath));
  const relative = path.relative(fs.realpathSync(repositoryRoot), resolved);
  if (!(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    throw new Error(`${label} must resolve outside the repository`);
  }
}

function readBoundedRegularFile(filePath, maximumBytes, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (stat.size > maximumBytes) throw new Error(`${label} exceeds its ${maximumBytes}-byte limit`);
  return fs.readFileSync(filePath);
}

function sanitizeDiagnostic(result) {
  return `${result.stderr ?? ""}\n${result.error?.message ?? ""}`
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_000) || `exit ${String(result.status)}`;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
