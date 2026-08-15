import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import { assertSafeVisibleText, compareUtf8 } from "./build-profile-catalog.mjs";
import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_FILES = 256;
const MAX_ENTRIES = 512;
const MAX_DIRECTORY_ENTRIES = 512;
const MAX_DIRECTORIES = 256;
const MAX_FILE_BYTES = 4_000_000;
const MAX_TOTAL_BYTES = 16_000_000;
const MAX_DEPTH = 16;
const requiredPaths = Object.freeze(["foundry.toml", "package-lock.json", "package.json", "remappings.txt"]);
const rejectedDirectories = new Set([".git", ".hg", ".programmable", ".svn", "broadcast", "build", "cache", "coverage", "dist", "node_modules", "out", "target", "vendor"]);
const rejectedGitControls = new Set([".git", ".git-blame-ignore-revs", ".gitattributes", ".gitconfig", ".gitignore", ".gitmodules"]);
const rejectedSecretNames = new Set([".env", ".netrc", ".npmrc", ".pypirc", "application_default_credentials.json", "id_ed25519", "id_rsa"]);
const rejectedSecretComponents = new Set([".aws", ".azure", ".direnv", ".docker", ".gnupg", ".kube", ".ssh", ".secrets", ".terraform", "credentials", "secrets"]);
const reservedRoots = new Set([".programmable", "evidence", "src", "surfaces", "test"]);
const reservedFiles = new Set(["github-submission.md", "license", "readme.md"]);
const windowsReservedNames = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\..*)?$/iu;

export const CUSTOM_TRADABLE_REQUIRED_CONTRACT_CONFIGURATION_PATHS = requiredPaths;

export function readCustomTradableContractConfiguration({ contractConfigRoot } = {}) {
  if (contractConfigRoot === null || contractConfigRoot === undefined) throw configurationError("contract configuration root is required");
  const frozenInput = readConfigurationTree(contractConfigRoot);
  validateRequiredConfigurationContent(frozenInput.files);
  const inventory = bindings(frozenInput.files);
  const configuration = Object.freeze({
    source: "caller-supplied",
    root: ".",
    inputRoot: frozenInput.root,
    inputInventory: inventory,
    inputInventorySha256: canonicalJsonSha256V2(inventory),
    files: frozenInput.files,
    inventory,
    inventorySha256: canonicalJsonSha256V2(inventory),
    requiredPaths: [...requiredPaths],
    semanticValidationPerformed: false
  });
  validateCustomTradableContractConfiguration(configuration);
  return configuration;
}

export function createDefaultCustomTradableContractConfiguration({ applicationId, compilerVersion, referenceKernelRoot }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(applicationId ?? "") || !/^0\.[0-9]+\.[0-9]+$/u.test(compilerVersion ?? "")) {
    throw new TypeError("default contract configuration requires an application slug and exact compiler version");
  }
  const packageLock = JSON.parse(fs.readFileSync(path.join(referenceKernelRoot, "package-lock.json"), "utf8"));
  packageLock.name = applicationId;
  packageLock.version = "0.0.0";
  packageLock.packages[""].name = applicationId;
  packageLock.packages[""].version = "0.0.0";
  packageLock.packages[""].description = "Intent-bound custom Uniswap v4 implementation.";
  const packageJson = {
    name: applicationId,
    version: "0.0.0",
    private: true,
    description: "Intent-bound custom Uniswap v4 implementation.",
    license: "MIT",
    scripts: { build: "forge build --offline", test: "forge test --offline" },
    dependencies: packageLock.packages[""].dependencies
  };
  const files = [
    { path: "foundry.toml", bytes: Buffer.from(defaultFoundryToml(compilerVersion)), mode: "100644" },
    { path: "package-lock.json", bytes: jsonBytes(packageLock), mode: "100644" },
    { path: "package.json", bytes: jsonBytes(packageJson), mode: "100644" },
    { path: "remappings.txt", bytes: fs.readFileSync(path.join(referenceKernelRoot, "remappings.txt")), mode: "100644" }
  ].sort((left, right) => compareUtf8(left.path, right.path));
  const inventory = bindings(files);
  const configuration = Object.freeze({
    source: "builder-convenience-default",
    root: ".",
    inputRoot: null,
    inputInventory: null,
    inputInventorySha256: null,
    files,
    inventory,
    inventorySha256: canonicalJsonSha256V2(inventory),
    requiredPaths: [...requiredPaths],
    semanticValidationPerformed: false
  });
  validateCustomTradableContractConfiguration(configuration);
  return configuration;
}

export function validateCustomTradableContractConfiguration(configuration) {
  if (!["caller-supplied", "builder-convenience-default"].includes(configuration?.source) || configuration.root !== "."
    || !Array.isArray(configuration.files) || configuration.files.length < requiredPaths.length
    || !Array.isArray(configuration.inventory) || typeof configuration.inventorySha256 !== "string"
    || !Array.isArray(configuration.requiredPaths) || !closedJsonEqual(configuration.requiredPaths, [...requiredPaths])
    || configuration.semanticValidationPerformed !== false) throw configurationError("contract configuration object is not a closed supported binding");
  const seen = new Map();
  for (const file of configuration.files) {
    if (typeof file?.path !== "string" || !Buffer.isBuffer(file.bytes) || !["100644", "100755"].includes(file.mode)) throw configurationError("contract configuration file binding is invalid");
    assertSafeConfigurationPath(file.path, seen);
  }
  const missing = requiredPaths.filter((filePath) => !configuration.files.some(({ path: candidate }) => candidate === filePath));
  if (missing.length > 0) throw incompleteError(missing);
  const inventory = bindings(configuration.files);
  if (!closedJsonEqual(inventory, configuration.inventory) || canonicalJsonSha256V2(inventory) !== configuration.inventorySha256) {
    throw configurationError("contract configuration inventory does not match its files, bytes, and modes");
  }
  return true;
}

export function revalidateCustomTradableContractConfiguration(configuration) {
  if (configuration?.source === "builder-convenience-default") return true;
  if (configuration?.source !== "caller-supplied" || typeof configuration.inputRoot !== "string"
    || !Array.isArray(configuration.inputInventory) || typeof configuration.inputInventorySha256 !== "string") {
    throw new TypeError("contract configuration revalidation requires a frozen caller input inventory");
  }
  let observed;
  try { observed = readConfigurationTree(configuration.inputRoot); } catch (error) {
    throw Object.assign(new Error(`PROJECT_CONTRACT_CONFIGURATION_INPUT_CHANGED: caller contract configuration changed after binding: ${error.message}`), { code: "PROJECT_CONTRACT_CONFIGURATION_INPUT_CHANGED", cause: error });
  }
  const inventory = bindings(observed.files);
  if (canonicalJsonSha256V2(inventory) !== configuration.inputInventorySha256 || !closedJsonEqual(inventory, configuration.inputInventory)) {
    throw Object.assign(new Error("PROJECT_CONTRACT_CONFIGURATION_INPUT_CHANGED: caller contract configuration changed after binding"), { code: "PROJECT_CONTRACT_CONFIGURATION_INPUT_CHANGED" });
  }
  return true;
}

export function contractConfigurationPlan(configuration) {
  validateCustomTradableContractConfiguration(configuration);
  return {
    source: configuration.source,
    root: ".",
    inventoryProfile: "exact-regular-files-git-modes-v1",
    requiredPaths: [...requiredPaths],
    files: configuration.inventory,
    inventorySha256: configuration.inventorySha256,
    semanticValidationPerformed: false
  };
}

export function deriveReceiptContractConfiguration({ trackedPlan, repositoryFiles, generatedPaths, referenceKernelRoot, fail }) {
  const configuration = trackedPlan?.contractConfiguration;
  const header = {
    source: configuration?.source,
    root: configuration?.root,
    inventoryProfile: configuration?.inventoryProfile,
    requiredPaths: configuration?.requiredPaths,
    files: configuration?.files,
    inventorySha256: configuration?.inventorySha256,
    semanticValidationPerformed: configuration?.semanticValidationPerformed
  };
  if (!closedJsonEqual(configuration, header) || !["caller-supplied", "builder-convenience-default"].includes(header.source)
    || header.root !== "." || header.inventoryProfile !== "exact-regular-files-git-modes-v1"
    || !closedJsonEqual(header.requiredPaths, [...requiredPaths]) || header.semanticValidationPerformed !== false || !Array.isArray(header.files)) {
    fail("tracked contract configuration identity is invalid");
  }
  const seen = new Map();
  for (const binding of header.files) {
    const normalized = { path: binding?.path, sha256: binding?.sha256, byteLength: binding?.byteLength, mode: binding?.mode };
    if (!closedJsonEqual(binding, normalized) || !validConfigurationPath(normalized.path)
      || !/^sha256:[0-9a-f]{64}$/u.test(normalized.sha256 ?? "") || !Number.isSafeInteger(normalized.byteLength) || normalized.byteLength < 0
      || !["100644", "100755"].includes(normalized.mode)) fail("tracked contract configuration file binding is invalid");
    const collisionKey = normalized.path.normalize("NFC").toLowerCase();
    if (seen.has(collisionKey)) fail("tracked contract configuration paths collide portably");
    seen.set(collisionKey, normalized.path);
  }
  if (requiredPaths.some((filePath) => !header.files.some(({ path: candidate }) => candidate === filePath))) fail("tracked contract configuration is missing required files");
  const generated = new Set(generatedPaths);
  const repositoryConfiguration = repositoryFiles.filter(({ path: filePath }) => !generated.has(filePath)
    && !filePath.startsWith("src/") && !filePath.startsWith("test/") && !filePath.startsWith("surfaces/"));
  if (!closedJsonEqual(header.files, repositoryConfiguration) || canonicalJsonSha256V2(header.files) !== header.inventorySha256) {
    fail("tracked contract configuration inventory does not match the committed repository");
  }
  const dependencyLock = header.files.find(({ path: filePath }) => filePath === "package-lock.json");
  const toolchain = {
    profile: "foundry",
    solidity: trackedPlan?.toolchain?.solidity,
    dependencyLock: dependencyLock === undefined ? null : { path: dependencyLock.path, sha256: dependencyLock.sha256, byteLength: dependencyLock.byteLength },
    configurationSource: header.source,
    configurationInventorySha256: header.inventorySha256,
    networkRequiredForInstall: true
  };
  if (!/^0\.[0-9]+\.[0-9]+$/u.test(toolchain.solidity ?? "") || !closedJsonEqual(trackedPlan.toolchain, toolchain)) fail("tracked toolchain does not match its contract configuration");
  if (header.source === "builder-convenience-default") {
    const expected = contractConfigurationPlan(createDefaultCustomTradableContractConfiguration({ applicationId: trackedPlan.applicationId, compilerVersion: toolchain.solidity, referenceKernelRoot }));
    if (!closedJsonEqual(header, expected)) fail("tracked convenience default differs from the exact builder default");
  }
  return header;
}

function readConfigurationTree(inputRoot) {
  const requestedRoot = path.resolve(inputRoot);
  let rootStat;
  try { rootStat = fs.lstatSync(requestedRoot); } catch { throw configurationError("contract configuration root must exist as a real non-symlink directory"); }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw configurationError("contract configuration root must be a real non-symlink directory");
  const root = fs.realpathSync(requestedRoot), files = [], collisionKeys = new Map();
  let remainingBytes = MAX_TOTAL_BYTES, totalEntries = 0, totalDirectories = 0;
  const visit = (directory, relativeDirectory = "", depth = 0) => {
    if (depth > MAX_DEPTH) throw configurationError(`contract configuration exceeds the ${MAX_DEPTH}-level depth cap`);
    const entries = [], handle = fs.opendirSync(directory, { bufferSize: 32 });
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        if (entries.length >= MAX_DIRECTORY_ENTRIES) throw configurationError(`contract configuration exceeds the ${MAX_DIRECTORY_ENTRIES}-entry per-directory cap`);
        if (totalEntries >= MAX_ENTRIES) throw configurationError(`contract configuration exceeds the ${MAX_ENTRIES}-entry cap`);
        totalEntries += 1;
        entries.push(entry);
      }
    } finally { handle.closeSync(); }
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      try { assertSafeVisibleText(entry.name, "contract configuration path entry", 255); } catch { throw configurationError(`contract configuration contains an unsafe path segment: ${entry.name}`); }
      const absolute = path.join(directory, entry.name), relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      assertSafeConfigurationPath(relative, collisionKeys);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw configurationError(`contract configuration contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        if (rejectedDirectories.has(entry.name.toLowerCase())) throw configurationError(`contract configuration contains a generated, dependency, or authority directory: ${relative}`);
        totalDirectories += 1;
        if (totalDirectories > MAX_DIRECTORIES) throw configurationError(`contract configuration exceeds the ${MAX_DIRECTORIES}-directory cap`);
        visit(absolute, relative, depth + 1);
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw configurationError(`contract configuration file is not a bounded regular file: ${relative}`);
      if (files.length >= MAX_FILES) throw configurationError(`contract configuration exceeds the ${MAX_FILES}-file cap`);
      if (stat.size > remainingBytes) throw configurationError(`contract configuration exceeds the ${MAX_TOTAL_BYTES}-byte cap`);
      const bytes = readStableFile(root, absolute, relative, stat);
      remainingBytes -= bytes.length;
      files.push({ path: relative, bytes, mode: stat.mode & 0o111 ? "100755" : "100644" });
    }
  };
  visit(root);
  if (files.length === 0) throw configurationError("contract configuration root must contain at least one file");
  return { root, files: files.sort((left, right) => compareUtf8(left.path, right.path)) };
}

function validateRequiredConfigurationContent(files) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const missing = requiredPaths.filter((filePath) => !byPath.has(filePath));
  if (missing.length > 0) throw incompleteError(missing);
  for (const filePath of ["package.json", "package-lock.json"]) {
    let document;
    try { document = parseBoundedStrictJsonBytes(byPath.get(filePath).bytes, { maxSourceBytes: MAX_FILE_BYTES, maxDepth: 128, maxNodes: 100_000 }); } catch {
      throw configurationError(`${filePath} must be bounded duplicate-free UTF-8 JSON`);
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) throw configurationError(`${filePath} must contain one JSON object`);
    if (filePath === "package-lock.json" && (!Number.isSafeInteger(document.lockfileVersion) || document.lockfileVersion < 1)) throw configurationError("package-lock.json must declare a positive integer lockfileVersion");
  }
  for (const filePath of ["foundry.toml", "remappings.txt"]) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(byPath.get(filePath).bytes); } catch { throw configurationError(`${filePath} must be UTF-8 text`); }
    if (filePath === "foundry.toml" && text.trim() === "") throw configurationError("foundry.toml must not be empty");
  }
}

function readStableFile(root, absolute, relative, stat) {
  const real = fs.realpathSync(absolute);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw configurationError(`contract configuration file escapes its root: ${relative}`);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || (opened.mode & 0o777) !== (stat.mode & 0o777)) throw configurationError(`contract configuration file changed before it was bound: ${relative}`);
    bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (bytes.length !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || (after.mode & 0o777) !== (opened.mode & 0o777) || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw configurationError(`contract configuration file changed while it was read: ${relative}`);
  } finally { fs.closeSync(descriptor); }
  const pathAfter = fs.lstatSync(absolute);
  if (pathAfter.isSymbolicLink() || pathAfter.dev !== stat.dev || pathAfter.ino !== stat.ino || pathAfter.size !== stat.size || (pathAfter.mode & 0o777) !== (stat.mode & 0o777) || pathAfter.mtimeMs !== stat.mtimeMs || pathAfter.ctimeMs !== stat.ctimeMs) throw configurationError(`contract configuration file changed after it was bound: ${relative}`);
  return bytes;
}

function assertSafeConfigurationPath(filePath, seen) {
  const segments = typeof filePath === "string" ? filePath.split("/") : [], lower = segments.map((segment) => segment.toLowerCase());
  const basename = lower.at(-1);
  if (lower.some((segment) => rejectedGitControls.has(segment))) throw configurationError(`contract configuration contains a Git control path: ${filePath}`);
  if (lower.some((segment) => rejectedSecretComponents.has(segment) || segment === ".env" || segment.startsWith(".env."))
    || rejectedSecretNames.has(basename) || /\.(?:key|p12|pfx|pem)$/u.test(basename ?? "")) {
    throw configurationError(`contract configuration contains a secret-risk path: ${filePath}`);
  }
  if (reservedRoots.has(lower[0]) || (segments.length === 1 && reservedFiles.has(basename))) throw configurationError(`contract configuration collides with a generated output path: ${filePath}`);
  if (!validConfigurationPath(filePath)) throw configurationError(`contract configuration path must use safe portable ASCII names: ${filePath}`);
  const collisionKey = filePath.normalize("NFC").toLowerCase();
  if (seen.has(collisionKey)) throw Object.assign(new Error(`contract configuration paths collide portably: ${seen.get(collisionKey)} and ${filePath}`), { code: "PROJECT_CONTRACT_CONFIGURATION_COLLISION" });
  seen.set(collisionKey, filePath);
}

function validConfigurationPath(filePath) {
  if (typeof filePath !== "string" || filePath.length < 1 || Buffer.byteLength(filePath, "utf8") > 240 || path.posix.normalize(filePath) !== filePath
    || path.posix.isAbsolute(filePath) || filePath.includes("\\") || filePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  const segments = filePath.split("/"), lower = segments.map((segment) => segment.toLowerCase());
  if (segments.some((segment) => !/^[\x20-\x7e]+$/u.test(segment) || /[<>:"|?*]/u.test(segment) || /^ |[. ]$/u.test(segment) || windowsReservedNames.test(segment))) return false;
  if (lower.some((segment) => rejectedGitControls.has(segment) || rejectedSecretComponents.has(segment) || segment === ".env" || segment.startsWith(".env."))) return false;
  const basename = lower.at(-1);
  if (rejectedSecretNames.has(basename) || /\.(?:key|p12|pfx|pem)$/u.test(basename)) return false;
  if (reservedRoots.has(lower[0]) || (segments.length === 1 && reservedFiles.has(basename))) return false;
  return true;
}

function defaultFoundryToml(compilerVersion) {
  return `[profile.default]\nsrc = "src"\ntest = "test"\nout = "out"\ncache_path = "cache"\nlibs = ["node_modules"]\nsolc_version = "${compilerVersion}"\nevm_version = "cancun"\noffline = true\noptimizer = true\noptimizer_runs = 1000\nvia_ir = false\nbytecode_hash = "none"\ncbor_metadata = false\nffi = false\nfs_permissions = []\n\n[profile.default.fuzz]\nruns = 256\n\n[profile.default.invariant]\nruns = 64\ndepth = 32\nfail_on_revert = false\n`;
}

function bindings(files) {
  return files.map(({ path: filePath, bytes, mode }) => ({ path: filePath, sha256: sha256Bytes(bytes), byteLength: bytes.length, mode }));
}

export function closedJsonEqual(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => closedJsonEqual(actual[index], value));
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    const actualKeys = Object.keys(actual).sort(compareUtf8), expectedKeys = Object.keys(expected).sort(compareUtf8);
    return closedJsonEqual(actualKeys, expectedKeys) && expectedKeys.every((key) => closedJsonEqual(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

function jsonBytes(value) { return Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"); }
function configurationError(message) { return Object.assign(new Error(message), { code: "PROJECT_CONTRACT_CONFIGURATION_INVALID" }); }
function incompleteError(missing) { return Object.assign(new Error(`caller contract configuration is missing required paths: ${missing.join(", ")}`), { code: "PROJECT_CONTRACT_CONFIGURATION_INCOMPLETE" }); }
