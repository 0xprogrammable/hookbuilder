import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const PORTABLE_PACKAGE_MANIFEST_PATH = "portable-package.json";
export const PORTABLE_PACKAGE_SCHEMA_ID = "urn:programmable:portable-skill-package-inclusion:1.0.0";

const TOP_LEVEL_KEYS = ["$schema", "schemaVersion", "kind", "sourceRoot", "includes", "executablePaths", "exclusions"];
const INCLUDE_KEYS = ["path", "recursive", "role"];
const EXCLUSION_KEYS = [
  "classification",
  "path",
  "recursive",
  "repositoryPath",
  "repositoryDigestAlgorithm",
  "repositoryFiles",
  "repositoryBytes",
  "repositorySha256"
];
const ROLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_ROOT = "skills/programmable-v4-hook-builder";
const MAX_MANIFEST_BYTES = 64 * 1024;
const REPOSITORY_DIGEST_ALGORITHM = "sha256-path-nul-size-nul-content-nul-v1";

export class PortablePackageManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortablePackageManifestError";
    this.code = code;
  }
}

export function loadPortablePackageManifest({ skillRoot }) {
  requireDirectory(skillRoot, "PORTABLE_PACKAGE_SKILL_ROOT_INVALID", "skill root");
  const manifestPath = resolveInside(skillRoot, PORTABLE_PACKAGE_MANIFEST_PATH, "manifest path");
  const bytes = fs.readFileSync(manifestPath);
  let manifest;
  try {
    manifest = parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: MAX_MANIFEST_BYTES,
      maxDepth: 16,
      maxNodes: 512,
      maxNumberCharacters: 32
    });
  } catch (error) {
    throw new PortablePackageManifestError(
      "PORTABLE_PACKAGE_MANIFEST_INVALID",
      `portable package manifest is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (`${JSON.stringify(manifest, null, 2)}\n` !== bytes.toString("utf8")) {
    throw new PortablePackageManifestError(
      "PORTABLE_PACKAGE_MANIFEST_NONCANONICAL",
      "portable package manifest must be canonical two-space JSON with one trailing newline"
    );
  }
  validateManifest(manifest);
  return deepFreeze(manifest);
}

export function buildPortablePackageInventory({ manifest, repositoryRoot = null, skillRoot }) {
  validateManifest(manifest);
  requireDirectory(skillRoot, "PORTABLE_PACKAGE_SKILL_ROOT_INVALID", "skill root");
  const packageFiles = walkRegularFiles(skillRoot).map((absolutePath) => {
    const stat = fs.statSync(absolutePath);
    return {
      absolutePath,
      path: relativePortablePath(skillRoot, absolutePath),
      bytes: stat.size,
      mode: stat.mode & 0o777
    };
  });

  const exclusionLeaks = packageFiles
    .filter(({ path: relativePath }) => manifest.exclusions.some((rule) => matchesRule(relativePath, rule)))
    .map(({ path: relativePath }) => relativePath);
  if (exclusionLeaks.length > 0) {
    throw new PortablePackageManifestError(
      "PORTABLE_PACKAGE_EXCLUSION_LEAK",
      `excluded repository-only files leaked into the portable package: ${exclusionLeaks.join(", ")}`
    );
  }

  const unclassified = packageFiles
    .filter(({ path: relativePath }) => !manifest.includes.some((rule) => matchesRule(relativePath, rule)))
    .map(({ path: relativePath }) => relativePath);
  if (unclassified.length > 0) {
    throw new PortablePackageManifestError(
      "PORTABLE_PACKAGE_FILE_UNCLASSIFIED",
      `portable files are outside the canonical inclusion manifest: ${unclassified.join(", ")}`
    );
  }
  for (const include of manifest.includes) {
    const matches = packageFiles.filter(({ path: relativePath }) => matchesRule(relativePath, include));
    if (matches.length === 0) {
      throw new PortablePackageManifestError(
        "PORTABLE_PACKAGE_INCLUDE_EMPTY",
        `portable include does not resolve to a regular file: ${include.path}`
      );
    }
  }
  const executablePaths = new Set(manifest.executablePaths);
  for (const entry of packageFiles) {
    const expectedMode = executablePaths.has(entry.path) ? 0o755 : 0o644;
    if (entry.mode !== expectedMode) {
      throw new PortablePackageManifestError(
        "PORTABLE_PACKAGE_MODE_MISMATCH",
        `portable package mode for ${entry.path} is ${octal(entry.mode)}; expected ${octal(expectedMode)}`
      );
    }
  }
  for (const executablePath of executablePaths) {
    if (!packageFiles.some(({ path: relativePath }) => relativePath === executablePath)) {
      throw new PortablePackageManifestError(
        "PORTABLE_PACKAGE_EXECUTABLE_MISSING",
        `declared portable executable is missing: ${executablePath}`
      );
    }
  }

  const repositoryOnly = inventoryRepositoryOnly({ manifest, repositoryRoot, skillRoot });
  return deepFreeze({
    packageBytes: packageFiles.reduce((total, entry) => total + entry.bytes, 0),
    packageFiles: packageFiles.map(({ absolutePath: _absolutePath, ...entry }) => entry),
    repositoryOnly
  });
}

export function portablePackageAbsoluteFiles({ manifest, repositoryRoot = null, skillRoot }) {
  const inventory = buildPortablePackageInventory({ manifest, repositoryRoot, skillRoot });
  return inventory.packageFiles.map(({ path: relativePath }) => resolveInside(skillRoot, relativePath, "package file"));
}

function inventoryRepositoryOnly({ manifest, repositoryRoot, skillRoot }) {
  if (repositoryRoot === null) {
    return {
      bytes: manifest.exclusions.reduce((total, exclusion) => total + exclusion.repositoryBytes, 0),
      files: manifest.exclusions.reduce((total, exclusion) => total + exclusion.repositoryFiles, 0),
      sources: manifest.exclusions.map(repositorySourceReceipt),
      sourcesVerified: false
    };
  }
  requireDirectory(repositoryRoot, "PORTABLE_PACKAGE_REPOSITORY_ROOT_INVALID", "repository root");
  const expectedSkillRoot = resolveInside(repositoryRoot, manifest.sourceRoot, "manifest source root");
  if (fs.realpathSync(expectedSkillRoot) !== fs.realpathSync(skillRoot)) {
    throw new PortablePackageManifestError(
      "PORTABLE_PACKAGE_SOURCE_ROOT_MISMATCH",
      `manifest source root does not resolve to the selected skill: ${manifest.sourceRoot}`
    );
  }
  const sources = [];
  for (const exclusion of manifest.exclusions) {
    const source = resolveInside(repositoryRoot, exclusion.repositoryPath, "repository-only source");
    let stat;
    try {
      stat = fs.lstatSync(source);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      throw new PortablePackageManifestError(
        "PORTABLE_PACKAGE_REPOSITORY_SOURCE_MISSING",
        `repository-only source is missing: ${exclusion.repositoryPath}`
      );
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new PortablePackageManifestError(
        "PORTABLE_PACKAGE_REPOSITORY_SOURCE_INVALID",
        `repository-only source must be a regular file or directory without symlinks: ${exclusion.repositoryPath}`
      );
    }
    const sourceFiles = stat.isDirectory() ? walkRegularFiles(source) : [source];
    if (sourceFiles.length === 0) {
      throw new PortablePackageManifestError(
        "PORTABLE_PACKAGE_REPOSITORY_SOURCE_EMPTY",
        `repository-only source is empty: ${exclusion.repositoryPath}`
      );
    }
    const receipt = repositorySourceReceipt(exclusion);
    const actual = {
      ...receipt,
      bytes: sourceFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
      files: sourceFiles.length,
      sha256: digestRepositoryFiles(source, sourceFiles)
    };
    if (
      actual.files !== receipt.files
      || actual.bytes !== receipt.bytes
      || actual.sha256 !== receipt.sha256
    ) {
      throw new PortablePackageManifestError(
        "PORTABLE_PACKAGE_REPOSITORY_SOURCE_DRIFT",
        `repository-only source does not match its declared receipt: ${exclusion.repositoryPath}`
      );
    }
    sources.push(actual);
  }
  return {
    bytes: sources.reduce((total, source) => total + source.bytes, 0),
    files: sources.reduce((total, source) => total + source.files, 0),
    sources,
    sourcesVerified: true
  };
}

function repositorySourceReceipt(exclusion) {
  return {
    classification: exclusion.classification,
    path: exclusion.repositoryPath,
    digestAlgorithm: exclusion.repositoryDigestAlgorithm,
    files: exclusion.repositoryFiles,
    bytes: exclusion.repositoryBytes,
    sha256: exclusion.repositorySha256
  };
}

function digestRepositoryFiles(source, sourceFiles) {
  const sourceRoot = fs.lstatSync(source).isDirectory() ? source : path.dirname(source);
  const digest = crypto.createHash("sha256");
  for (const absolutePath of sourceFiles) {
    const bytes = fs.readFileSync(absolutePath);
    const relativePath = fs.lstatSync(source).isDirectory()
      ? relativePortablePath(sourceRoot, absolutePath)
      : path.basename(absolutePath);
    digest.update(relativePath, "utf8");
    digest.update("\0", "utf8");
    digest.update(String(bytes.length), "utf8");
    digest.update("\0", "utf8");
    digest.update(bytes);
    digest.update("\0", "utf8");
  }
  return digest.digest("hex");
}

function validateManifest(value) {
  if (!isPlainObject(value)) invalid("manifest must be one plain object");
  requireExactKeys(value, TOP_LEVEL_KEYS, "manifest");
  if (value.$schema !== PORTABLE_PACKAGE_SCHEMA_ID || value.schemaVersion !== "1.0.0") {
    invalid("manifest schema identity is invalid");
  }
  if (value.kind !== "programmable-portable-skill-package-inclusion") invalid("manifest kind is invalid");
  if (value.sourceRoot !== SOURCE_ROOT) invalid(`manifest sourceRoot must be ${SOURCE_ROOT}`);
  validateRules(value.includes, INCLUDE_KEYS, "includes", true);
  if (!Array.isArray(value.executablePaths) || value.executablePaths.length === 0) {
    invalid("executablePaths must be a non-empty array");
  }
  for (const [index, executablePath] of value.executablePaths.entries()) {
    requireSafeRelativePath(executablePath, `executablePaths[${index}]`);
    if (!executablePath.startsWith("scripts/") || !executablePath.endsWith(".mjs")) {
      invalid(`executablePaths[${index}] must name one portable script`);
    }
  }
  requireUnique(value.executablePaths, "executable paths");
  const sortedExecutablePaths = [...value.executablePaths].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(value.executablePaths) !== JSON.stringify(sortedExecutablePaths)) {
    invalid("executable paths must be sorted");
  }
  validateRules(value.exclusions, EXCLUSION_KEYS, "exclusions", false);
  const includePaths = value.includes.map(({ path: rulePath }) => rulePath);
  const exclusionPaths = value.exclusions.map(({ path: rulePath }) => rulePath);
  const repositoryPaths = value.exclusions.map(({ repositoryPath }) => repositoryPath);
  requireUnique(includePaths, "include paths");
  requireUnique(exclusionPaths, "exclusion paths");
  requireUnique(repositoryPaths, "repository-only paths");
  if (!includePaths.includes(PORTABLE_PACKAGE_MANIFEST_PATH)) invalid("manifest must include itself");
  for (const exclusion of value.exclusions) {
    if (!value.includes.some((include) => include.recursive && matchesRule(exclusion.path, include))) {
      invalid(`exclusion must refine one recursive include: ${exclusion.path}`);
    }
    if (exclusion.repositoryPath === value.sourceRoot || exclusion.repositoryPath.startsWith(`${value.sourceRoot}/`)) {
      invalid(`repository-only source must stay outside the portable skill: ${exclusion.repositoryPath}`);
    }
  }
}

function validateRules(value, exactKeys, label, includeRole) {
  if (!Array.isArray(value) || value.length === 0) invalid(`${label} must be a non-empty array`);
  for (const [index, rule] of value.entries()) {
    if (!isPlainObject(rule)) invalid(`${label}[${index}] must be one plain object`);
    requireExactKeys(rule, exactKeys, `${label}[${index}]`);
    requireSafeRelativePath(rule.path, `${label}[${index}].path`);
    if (typeof rule.recursive !== "boolean") invalid(`${label}[${index}].recursive must be boolean`);
    if (includeRole) {
      if (typeof rule.role !== "string" || !ROLE.test(rule.role)) invalid(`${label}[${index}].role is invalid`);
    } else {
      if (rule.classification !== "test-only" && rule.classification !== "dev-only" && rule.classification !== "release-only") {
        invalid(`${label}[${index}].classification is invalid`);
      }
      requireSafeRelativePath(rule.repositoryPath, `${label}[${index}].repositoryPath`);
      if (rule.repositoryDigestAlgorithm !== REPOSITORY_DIGEST_ALGORITHM) {
        invalid(`${label}[${index}].repositoryDigestAlgorithm is invalid`);
      }
      if (!Number.isSafeInteger(rule.repositoryFiles) || rule.repositoryFiles < 1) {
        invalid(`${label}[${index}].repositoryFiles must be a positive safe integer`);
      }
      if (!Number.isSafeInteger(rule.repositoryBytes) || rule.repositoryBytes < 1) {
        invalid(`${label}[${index}].repositoryBytes must be a positive safe integer`);
      }
      if (typeof rule.repositorySha256 !== "string" || !SHA256.test(rule.repositorySha256)) {
        invalid(`${label}[${index}].repositorySha256 must be one lowercase SHA-256 digest`);
      }
    }
  }
}

function walkRegularFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort(compareDirectoryEntries)) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new PortablePackageManifestError("PORTABLE_PACKAGE_SYMLINK_FORBIDDEN", `portable package source contains a symlink: ${target}`);
      }
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) files.push(target);
      else throw new PortablePackageManifestError("PORTABLE_PACKAGE_FILE_TYPE_INVALID", `portable package source contains a non-regular entry: ${target}`);
    }
  };
  visit(root);
  return files;
}

function matchesRule(relativePath, rule) {
  return relativePath === rule.path || (rule.recursive && relativePath.startsWith(`${rule.path}/`));
}

function resolveInside(root, relativePath, label) {
  requireSafeRelativePath(relativePath, label);
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new PortablePackageManifestError("PORTABLE_PACKAGE_PATH_INVALID", `${label} escapes its root: ${relativePath}`);
  }
  return target;
}

function requireSafeRelativePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || value.includes("\\")
    || value.includes("\0")
    || value.startsWith("/")
    || value.endsWith("/")
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) invalid(`${label} must be one safe POSIX relative path`);
}

function requireDirectory(target, code, label) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw new PortablePackageManifestError(code, `${label} is missing: ${target}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PortablePackageManifestError(code, `${label} must be a real directory: ${target}`);
  }
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) invalid(`${label} keys are invalid`);
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) invalid(`${label} must be unique`);
}

function relativePortablePath(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function octal(mode) {
  return mode.toString(8).padStart(4, "0");
}

function compareDirectoryEntries(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalid(message) {
  throw new PortablePackageManifestError("PORTABLE_PACKAGE_MANIFEST_INVALID", message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
