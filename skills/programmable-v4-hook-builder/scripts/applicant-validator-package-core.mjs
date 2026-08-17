import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJsonV2 } from "./canonical-json-core.mjs";

const safePackagePathPattern = /^(?!\/)(?!.*(?:^|\/)\.git(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const importPattern = /(?:^|\n)\s*import\s+(?:[^;]*?\s+from\s+)?["']([^"'\r\n]+)["']\s*;/gu;
const exportPattern = /(?:^|\n)\s*export\s+(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?|\{[^;]*\}\s*)from\s*["']([^"'\r\n]+)["']\s*;/gu;
const staticUrlPattern = /new\s+URL\(\s*["']([^"'\r\n]+)["']\s*,\s*import\.meta\.url\s*\)/gu;
const dynamicImportPattern = /\bimport\s*\(/u;

export const PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS = deepFreeze({
  files: 256,
  fileBytes: 4 * 1024 * 1024,
  aggregateBytes: 16 * 1024 * 1024
});

export const DEFAULT_PUBLIC_APPLICANT_VALIDATOR_PROFILE = deepFreeze({
  entrypoints: ["scripts/public-applicant-validator.mjs"],
  assets: [
    "assets/starter-catalog/catalog.json",
    "references/architecture-decisions-v1.schema.json",
    "references/fee-policy-v2.schema.json",
    "references/idea-source-v1.schema.json",
    "references/intent-contract-v1.schema.json",
    "references/intent-fidelity-v1.schema.json",
    "references/open-world-security-v1.schema.json",
    "references/programmable-trade-execution-v1.schema.json",
    "references/submission-schema-catalog.json",
    "references/submission-v2.schema.json",
    "references/trade-capability-manifest-v1.schema.json"
  ]
});

export class ValidatorPackageError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ValidatorPackageError";
    this.code = code;
    this.details = details;
  }
}

export function generateApplicantValidatorPackageClosure({
  skillRoot,
  profile = DEFAULT_PUBLIC_APPLICANT_VALIDATOR_PROFILE
} = {}) {
  const root = validateSkillRoot(skillRoot);
  const selected = validateProfile(profile);
  const pending = [...selected.entrypoints];
  const entrypointSet = new Set(selected.entrypoints);
  const discovered = new Map();

  for (const assetPath of selected.assets) addFile(assetPath, roleFor(assetPath, entrypointSet));

  while (pending.length > 0) {
    const current = pending.shift();
    if (discovered.has(current)) continue;
    const bytes = addFile(current, roleFor(current, entrypointSet));
    if (!current.endsWith(".mjs")) {
      fail("VALIDATOR_PACKAGE_ENTRYPOINT_INVALID", "Validator package entrypoints must be ESM modules", { path: current });
    }
    const source = bytes.toString("utf8");
    if (dynamicImportPattern.test(source)) {
      fail("VALIDATOR_PACKAGE_DYNAMIC_IMPORT_FORBIDDEN", "Validator package modules must use a closed static dependency graph", { path: current });
    }
    for (const specifier of staticModuleSpecifiers(source)) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        fail("VALIDATOR_PACKAGE_BARE_IMPORT_FORBIDDEN", "Validator package modules cannot depend on an ambient package", { path: current });
      }
      const resolved = resolveRelativePackagePath(current, specifier);
      pending.push(resolved);
    }
    for (const specifier of staticAssetSpecifiers(source)) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const resolved = resolveRelativePackagePath(current, specifier);
      addFile(resolved, roleFor(resolved, entrypointSet));
    }
  }

  const sorted = [...discovered.values()].sort((left, right) => compareUtf8(left.path, right.path));
  const { closureSha256, fileRecords, totalBytes } = describeClosure(sorted);
  const receipt = deepFreeze({
    $schema: "urn:programmable:applicant-validator-package-receipt:1.0.0",
    algorithm: "sha256-path-nul-size-nul-content-nul-v1",
    authority: {
      candidateCodeExecuted: false,
      credentialsUsed: false,
      externalWritesPerformed: false,
      networkAccessed: false
    },
    closureSha256,
    entrypoint: selected.entrypoints[0],
    files: fileRecords,
    fileCount: fileRecords.length,
    kind: "programmable-applicant-validator-package-receipt",
    schemaVersion: "1.0.0",
    totalBytes
  });
  const receiptBytes = Buffer.from(`${canonicalJsonV2(receipt)}\n`, "utf8");
  return Object.freeze({
    receipt,
    receiptBytes,
    receiptSha256: sha256(receiptBytes),
    files: Object.freeze(sorted.map(({ path: filePath, bytes }) => Object.freeze({
      path: filePath,
      bytes: Buffer.from(bytes)
    })))
  });

  function addFile(filePath, role) {
    validatePackagePath(filePath);
    if (discovered.has(filePath)) return discovered.get(filePath).bytes;
    if (discovered.size >= PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS.files) {
      fail("VALIDATOR_PACKAGE_FILE_LIMIT", "Validator package dependency closure exceeds its file limit");
    }
    const absolute = path.resolve(root, ...filePath.split("/"));
    if (!isWithinRoot(root, absolute)) {
      fail("VALIDATOR_PACKAGE_PATH_ESCAPE", "Validator package dependency escapes the Skill root", { path: filePath });
    }
    const bytes = readStableRegularFile(root, filePath, PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS.fileBytes);
    const observedBytes = [...discovered.values()].reduce((sum, file) => sum + file.bytes.length, 0) + bytes.length;
    if (observedBytes > PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS.aggregateBytes) {
      fail("VALIDATOR_PACKAGE_SIZE_LIMIT", "Validator package dependency closure exceeds its aggregate byte limit");
    }
    discovered.set(filePath, Object.freeze({ path: filePath, role, bytes }));
    return bytes;
  }
}

export function materializeApplicantValidatorPackage({ closure, outputRoot } = {}) {
  validateGeneratedClosure(closure);
  const target = validateOutputRoot(outputRoot);
  if (fs.existsSync(target)) {
    fail("VALIDATOR_PACKAGE_OUTPUT_EXISTS", "Validator package output already exists and will not be overwritten");
  }
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, ".programmable-validator-package-"));
  try {
    for (const file of closure.files) {
      const destination = path.resolve(temporary, ...file.path.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, file.bytes, { flag: "wx", mode: 0o644 });
    }
    const receiptPath = path.join(temporary, "validator-package-receipt.v1.json");
    fs.writeFileSync(receiptPath, closure.receiptBytes, { flag: "wx", mode: 0o644 });
    fs.renameSync(temporary, target);
    return Object.freeze({
      outputRoot: target,
      receiptPath: path.join(target, "validator-package-receipt.v1.json"),
      closureSha256: closure.receipt.closureSha256,
      receiptSha256: closure.receiptSha256
    });
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function verifyApplicantValidatorPackage({
  skillRoot,
  packageRoot,
  profile = DEFAULT_PUBLIC_APPLICANT_VALIDATOR_PROFILE
} = {}) {
  const expected = generateApplicantValidatorPackageClosure({ skillRoot, profile });
  const root = validateExistingOutputRoot(packageRoot);
  const actualPaths = collectOutputPaths(root);
  const expectedPaths = [
    ...expected.files.map(({ path: filePath }) => filePath),
    "validator-package-receipt.v1.json"
  ].sort(compareUtf8);
  if (actualPaths.length !== expectedPaths.length
    || actualPaths.some((filePath, index) => filePath !== expectedPaths[index])) {
    fail("VALIDATOR_PACKAGE_FILE_SET_MISMATCH", "Validator package file set differs from the generated closed dependency set");
  }
  for (const file of expected.files) {
    const actual = readStableRegularFile(root, file.path, PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS.fileBytes);
    if (!actual.equals(file.bytes)) {
      fail("VALIDATOR_PACKAGE_CONTENT_MISMATCH", "Validator package file bytes differ from the generated closure", { path: file.path });
    }
  }
  const actualReceipt = readStableRegularFile(root, "validator-package-receipt.v1.json", 2 * 1024 * 1024);
  if (!actualReceipt.equals(expected.receiptBytes)) {
    fail("VALIDATOR_PACKAGE_RECEIPT_MISMATCH", "Validator package receipt bytes differ from the generated receipt");
  }
  const finalPaths = collectOutputPaths(root);
  if (finalPaths.length !== expectedPaths.length
    || finalPaths.some((filePath, index) => filePath !== expectedPaths[index])) {
    fail("VALIDATOR_PACKAGE_FILE_SET_MISMATCH", "Validator package file set changed during verification");
  }
  return Object.freeze({
    closureSha256: expected.receipt.closureSha256,
    receiptSha256: expected.receiptSha256,
    fileCount: expected.receipt.fileCount,
    totalBytes: expected.receipt.totalBytes
  });
}

function validateSkillRoot(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("VALIDATOR_PACKAGE_ROOT_INVALID", "Validator package generation requires one absolute Skill root");
  }
  const root = path.resolve(value);
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch (cause) {
    fail("VALIDATOR_PACKAGE_ROOT_INVALID", "Validator package Skill root is unavailable", { causeCode: cause?.code ?? null });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("VALIDATOR_PACKAGE_ROOT_INVALID", "Validator package Skill root must be a regular directory");
  }
  return requireCanonicalDirectory(root, "VALIDATOR_PACKAGE_ROOT_INVALID", "Validator package Skill root");
}

function validateGeneratedClosure(value) {
  if (
    value === null
    || typeof value !== "object"
    || value.receipt?.kind !== "programmable-applicant-validator-package-receipt"
    || value.receipt?.schemaVersion !== "1.0.0"
    || !Array.isArray(value.receipt?.files)
    || !Array.isArray(value.files)
    || value.files.length !== value.receipt.fileCount
    || !Buffer.isBuffer(value.receiptBytes)
    || typeof value.receiptSha256 !== "string"
  ) fail("VALIDATOR_PACKAGE_CLOSURE_INVALID", "Validator package materialization requires one generated closure");
  const files = value.files.map((file) => {
    if (
      file === null
      || typeof file !== "object"
      || typeof file.path !== "string"
      || !Buffer.isBuffer(file.bytes)
    ) fail("VALIDATOR_PACKAGE_CLOSURE_INVALID", "Validator package closure contains a malformed file");
    validatePackagePath(file.path);
    const receiptRecord = value.receipt.files?.find(({ path: filePath }) => filePath === file.path);
    if (receiptRecord === undefined) {
      fail("VALIDATOR_PACKAGE_CLOSURE_INVALID", "Validator package closure file is absent from its receipt", { path: file.path });
    }
    return { path: file.path, role: receiptRecord.role, bytes: file.bytes };
  }).sort((left, right) => compareUtf8(left.path, right.path));
  if (new Set(files.map(({ path: filePath }) => filePath)).size !== files.length) {
    fail("VALIDATOR_PACKAGE_CLOSURE_INVALID", "Validator package closure contains duplicate paths");
  }
  const described = describeClosure(files);
  const recordsMatch = Array.isArray(value.receipt.files)
    && value.receipt.files.length === described.fileRecords.length
    && described.fileRecords.every((record, index) => canonicalJsonV2(record) === canonicalJsonV2(value.receipt.files[index]));
  if (
    !recordsMatch
    || value.receipt.fileCount !== described.fileRecords.length
    || value.receipt.totalBytes !== described.totalBytes
    || value.receipt.closureSha256 !== described.closureSha256
    || described.totalBytes > PUBLIC_APPLICANT_VALIDATOR_PACKAGE_LIMITS.aggregateBytes
    || !value.receiptBytes.equals(Buffer.from(`${canonicalJsonV2(value.receipt)}\n`, "utf8"))
    || value.receiptSha256 !== sha256(value.receiptBytes)
  ) fail("VALIDATOR_PACKAGE_CLOSURE_INVALID", "Validator package closure and receipt are not self-consistent");
}

function validateOutputRoot(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("VALIDATOR_PACKAGE_OUTPUT_INVALID", "Validator package output root must be one explicit path");
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    fail("VALIDATOR_PACKAGE_OUTPUT_INVALID", "Validator package output root cannot be the filesystem root");
  }
  const parent = path.dirname(resolved);
  const canonicalParent = requireCanonicalDirectory(
    parent,
    "VALIDATOR_PACKAGE_OUTPUT_INVALID",
    "Validator package output parent"
  );
  return path.join(canonicalParent, path.basename(resolved));
}

function validateExistingOutputRoot(value) {
  const resolved = validateOutputRoot(value);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (cause) {
    fail("VALIDATOR_PACKAGE_OUTPUT_INVALID", "Validator package output root is unavailable", { causeCode: cause?.code ?? null });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("VALIDATOR_PACKAGE_OUTPUT_INVALID", "Validator package output root must be a regular directory");
  }
  return requireCanonicalDirectory(resolved, "VALIDATOR_PACKAGE_OUTPUT_INVALID", "Validator package output root");
}

function collectOutputPaths(root) {
  const files = [];
  visit(root, "");
  return files.sort(compareUtf8);

  function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      validatePackagePath(relative);
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        fail("VALIDATOR_PACKAGE_FILE_INVALID", "Validator package output cannot contain symlinks", { path: relative });
      }
      if (stat.isDirectory()) visit(absolute, relative);
      else if (stat.isFile()) files.push(relative);
      else fail("VALIDATOR_PACKAGE_FILE_INVALID", "Validator package output contains a non-regular entry", { path: relative });
    }
  }
}

function validateProfile(value) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).sort().join("|") !== "assets|entrypoints"
    || !Array.isArray(value.entrypoints)
    || value.entrypoints.length !== 1
    || !Array.isArray(value.assets)
    || value.assets.length > 64
  ) fail("VALIDATOR_PACKAGE_PROFILE_INVALID", "Validator package profile must select one stable entrypoint and a bounded asset list");
  const entrypoints = uniqueSorted(value.entrypoints, "entrypoint");
  const assets = uniqueSorted(value.assets, "asset");
  return Object.freeze({ entrypoints, assets });
}

function uniqueSorted(values, label) {
  for (const value of values) validatePackagePath(value, label);
  const sorted = [...new Set(values)].sort(compareUtf8);
  if (sorted.length !== values.length) fail("VALIDATOR_PACKAGE_PROFILE_INVALID", `Validator package ${label} paths must be unique`);
  return Object.freeze(sorted);
}

function staticModuleSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [importPattern, exportPattern]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return [...new Set(specifiers)].sort(compareUtf8);
}

function staticAssetSpecifiers(source) {
  staticUrlPattern.lastIndex = 0;
  return [...new Set([...source.matchAll(staticUrlPattern)].map((match) => match[1]))].sort(compareUtf8);
}

function resolveRelativePackagePath(importer, specifier) {
  if (specifier.includes("?") || specifier.includes("#") || specifier.includes("\\")) {
    fail("VALIDATOR_PACKAGE_DEPENDENCY_INVALID", "Validator package dependency specifier is not one canonical relative path", { path: importer });
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    fail("VALIDATOR_PACKAGE_PATH_ESCAPE", "Validator package dependency escapes the Skill root", { path: importer });
  }
  validatePackagePath(resolved);
  return resolved;
}

function validatePackagePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || !safePackagePathPattern.test(value)) {
    fail("VALIDATOR_PACKAGE_PATH_INVALID", `Validator package ${label} is not a safe canonical path`);
  }
}

function roleFor(filePath, entrypoints) {
  if (entrypoints.has(filePath)) return "entrypoint";
  if (filePath.endsWith(".mjs")) return "module";
  if (filePath.endsWith(".schema.json")) return "schema";
  return "data";
}

function describeClosure(files) {
  const closureHash = crypto.createHash("sha256");
  let totalBytes = 0;
  const fileRecords = files.map(({ path: filePath, role, bytes }) => {
    validatePackagePath(filePath);
    if (!Buffer.isBuffer(bytes) || !["entrypoint", "module", "schema", "data"].includes(role)) {
      fail("VALIDATOR_PACKAGE_CLOSURE_INVALID", "Validator package closure contains invalid bytes or role", { path: filePath });
    }
    totalBytes += bytes.length;
    closureHash.update(Buffer.from(filePath, "utf8"));
    closureHash.update(Buffer.from([0]));
    closureHash.update(Buffer.from(String(bytes.length), "utf8"));
    closureHash.update(Buffer.from([0]));
    closureHash.update(bytes);
    closureHash.update(Buffer.from([0]));
    return Object.freeze({
      path: filePath,
      role,
      byteLength: bytes.length,
      sha256: sha256(bytes)
    });
  });
  return Object.freeze({
    closureSha256: `sha256:${closureHash.digest("hex")}`,
    fileRecords: Object.freeze(fileRecords),
    totalBytes
  });
}

function readStableRegularFile(root, filePath, maximumBytes) {
  validatePackagePath(filePath);
  const absolute = path.resolve(root, ...filePath.split("/"));
  if (!isWithinRoot(root, absolute)) {
    fail("VALIDATOR_PACKAGE_PATH_ESCAPE", "Validator package file escapes its declared root", { path: filePath });
  }
  assertNoSymlinkSegments(root, filePath);
  let resolved;
  try {
    resolved = fs.realpathSync.native(absolute);
  } catch (cause) {
    fail("VALIDATOR_PACKAGE_FILE_MISSING", "Validator package file is unavailable", { path: filePath, causeCode: cause?.code ?? null });
  }
  if (resolved !== absolute || !isWithinRoot(root, resolved)) {
    fail("VALIDATOR_PACKAGE_FILE_INVALID", "Validator package file resolves through an unexpected path", { path: filePath });
  }
  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const nonBlock = fs.constants.O_NONBLOCK ?? 0;
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow | nonBlock);
  } catch (cause) {
    const code = cause?.code === "ENOENT" ? "VALIDATOR_PACKAGE_FILE_MISSING" : "VALIDATOR_PACKAGE_FILE_INVALID";
    fail(code, "Validator package file could not be opened without following links", { path: filePath, causeCode: cause?.code ?? null });
  }
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      fail("VALIDATOR_PACKAGE_FILE_INVALID", "Validator package file descriptor is not a regular file", { path: filePath });
    }
    if (before.size > BigInt(maximumBytes)) {
      fail("VALIDATOR_PACKAGE_FILE_SIZE_LIMIT", "Validator package file exceeds its byte limit", { path: filePath });
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    let current;
    try {
      current = fs.lstatSync(absolute, { bigint: true });
    } catch (cause) {
      fail("VALIDATOR_PACKAGE_FILE_CHANGED", "Validator package file path changed during its descriptor read", { path: filePath, causeCode: cause?.code ?? null });
    }
    if (
      bytes.length !== Number(before.size)
      || !current.isFile()
      || current.isSymbolicLink()
      || statIdentity(before) !== statIdentity(after)
      || statIdentity(after) !== statIdentity(current)
    ) {
      fail("VALIDATOR_PACKAGE_FILE_CHANGED", "Validator package file changed during its descriptor read", { path: filePath });
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertNoSymlinkSegments(root, filePath) {
  let current = root;
  const segments = filePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (cause) {
      fail("VALIDATOR_PACKAGE_FILE_MISSING", "Validator package path segment is unavailable", { path: filePath, causeCode: cause?.code ?? null });
    }
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
      fail("VALIDATOR_PACKAGE_FILE_INVALID", "Validator package paths cannot traverse symlinks or non-directories", { path: filePath });
    }
  }
}

function requireCanonicalDirectory(directory, code, label) {
  let stat;
  let resolved;
  try {
    stat = fs.lstatSync(directory);
    resolved = fs.realpathSync.native(directory);
  } catch (cause) {
    fail(code, `${label} is unavailable`, { causeCode: cause?.code ?? null });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(code, `${label} must be one regular directory`);
  }
  return resolved;
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map((value) => value.toString())
    .join(":");
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(code, message, details = undefined) {
  throw new ValidatorPackageError(code, message, details);
}
