#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildStaticModuleGraph, lexicalComplexity } from "./module-maintainability-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, "../..");
const PRODUCTION_ROOT_SPECS = Object.freeze([
  Object.freeze({ path: "scripts/quality", extension: ".mjs", excludedDirectoryNames: Object.freeze([]) }),
  Object.freeze({ path: "skills/programmable-v4-hook-builder/scripts", extension: ".mjs", excludedDirectoryNames: Object.freeze(["test"]) })
]);
const LEGACY_DEBT_THRESHOLD_LINES = 750;
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function evaluateSizeBudget({ repositoryRoot, budget }) {
  validateSizeBudget(budget);
  const discoveredPaths = discoverProductionModules(repositoryRoot, budget.productionModules);
  const currentSources = new Map(discoveredPaths.map((modulePath) => [modulePath, strictUtf8Decoder.decode(readRegularFile(repositoryRoot, modulePath))]));
  const legacyBaseline = loadLegacyBaseline(repositoryRoot, budget.productionModules);
  const reviewedOverrides = new Map(budget.productionModules.legacyBaseline.reviewedOverrides.map((entry) => [entry.path, entry]));
  const discoveredSet = new Set(discoveredPaths);
  const violations = [];
  const modules = discoveredPaths.map((modulePath) => {
    const source = currentSources.get(modulePath);
    const bytes = Buffer.byteLength(source, "utf8");
    const lines = countLines(Buffer.from(source, "utf8"));
    const complexity = lexicalComplexity(source);
    const baseline = legacyBaseline.modules.get(modulePath) ?? null;
    const override = reviewedOverrides.get(modulePath) ?? null;
    const maxLines = override?.observedLines ?? (baseline === null ? budget.productionModules.newFileHardCaps.maxLines : baseline.observedLines);
    const maxBytes = override?.observedBytes ?? (baseline === null ? budget.productionModules.newFileHardCaps.maxBytes : baseline.observedBytes);
    const maxComplexityScore = override?.observedComplexityScore ?? (baseline === null ? budget.productionModules.newFileHardCaps.maxComplexityScore : baseline.observedComplexityScore);
    const maxBlockDepth = override?.observedMaxBlockDepth ?? (baseline === null ? budget.productionModules.newFileHardCaps.maxBlockDepth : baseline.observedMaxBlockDepth);
    const moduleViolations = [];
    if (lines > maxLines) {
      moduleViolations.push(baseline === null ? "NEW_MODULE_LINE_CAP_EXCEEDED" : "LEGACY_BASELINE_LINE_GROWTH");
    }
    if (bytes > maxBytes) {
      moduleViolations.push(baseline === null ? "NEW_MODULE_BYTE_CAP_EXCEEDED" : "LEGACY_BASELINE_BYTE_GROWTH");
    }
    if (complexity.score > maxComplexityScore) moduleViolations.push(baseline === null ? "NEW_MODULE_COMPLEXITY_CAP_EXCEEDED" : "LEGACY_BASELINE_COMPLEXITY_GROWTH");
    if (complexity.maxBlockDepth > maxBlockDepth) moduleViolations.push(baseline === null ? "NEW_MODULE_BLOCK_DEPTH_CAP_EXCEEDED" : "LEGACY_BASELINE_BLOCK_DEPTH_GROWTH");
    const uniqueViolations = [...new Set(moduleViolations)].sort();
    for (const code of uniqueViolations) violations.push({ code, path: modulePath });
    return {
      path: modulePath,
      classification: baseline === null ? "new-file-hard-cap" : override === null ? "manifest-baseline-no-growth" : "reviewed-baseline-no-growth",
      lines,
      bytes,
      complexity,
      maxLines,
      maxBytes,
      maxComplexityScore,
      maxBlockDepth,
      lineGrowth: baseline === null ? null : lines - (override?.observedLines ?? baseline.observedLines),
      byteGrowth: baseline === null ? null : bytes - (override?.observedBytes ?? baseline.observedBytes),
      complexityGrowth: baseline === null ? null : complexity.score - (override?.observedComplexityScore ?? baseline.observedComplexityScore),
      violations: uniqueViolations,
      passed: uniqueViolations.length === 0
    };
  });
  const staleBaselines = [...legacyBaseline.modules.keys()]
    .filter((modulePath) => !discoveredSet.has(modulePath))
    .sort();
  for (const modulePath of staleBaselines) violations.push({ code: "LEGACY_BASELINE_MODULE_NOT_DISCOVERED", path: modulePath });
  const staleOverrides = [...reviewedOverrides.keys()].filter((modulePath) => !legacyBaseline.modules.has(modulePath)).sort();
  for (const modulePath of staleOverrides) violations.push({ code: "REVIEWED_OVERRIDE_NOT_IN_GIT_BASELINE", path: modulePath });

  const moduleGraph = buildStaticModuleGraph({ modulePaths: discoveredPaths, sourceByPath: currentSources });
  for (const unresolved of moduleGraph.unresolvedRelativeImports) violations.push({ code: "STATIC_RELATIVE_IMPORT_UNRESOLVED", path: unresolved.importer, detail: unresolved });
  for (const cycle of moduleGraph.cycles) violations.push({ code: "STATIC_IMPORT_CYCLE", path: cycle[0], detail: { modules: cycle } });

  const legacyModules = modules
    .filter(({ lines }) => lines > budget.productionModules.legacyDebtThresholdLines)
    .map(({ path: modulePath, lines, bytes, classification, passed }) => ({
      path: modulePath,
      lines,
      bytes,
      excessLines: lines - budget.productionModules.legacyDebtThresholdLines,
      classification,
      passedNoGrowthGate: passed
    }));
  const machineDebt = {
    status: legacyModules.length === 0 ? "NO_LEGACY_SIZE_DEBT_AT_THRESHOLD" : "LEGACY_SIZE_DEBT_REPORTED",
    definition: `Every discovered production .mjs file above ${budget.productionModules.legacyDebtThresholdLines} physical lines.`,
    broadMaintainabilityClaimed: false,
    legacyDebtThresholdLines: budget.productionModules.legacyDebtThresholdLines,
    moduleCount: legacyModules.length,
    totalLines: legacyModules.reduce((total, entry) => total + entry.lines, 0),
    excessLines: legacyModules.reduce((total, entry) => total + entry.excessLines, 0),
    modules: legacyModules,
    staticComplexity: {
      measured: true,
      profile: "dependency-free-lexical-branch-proxy-v1",
      broadCyclomaticComplexityClaimed: false,
      totalScore: modules.reduce((total, entry) => total + entry.complexity.score, 0),
      highestScore: Math.max(0, ...modules.map((entry) => entry.complexity.score)),
      highestBlockDepth: Math.max(0, ...modules.map((entry) => entry.complexity.maxBlockDepth))
    },
    importCycles: {
      measured: true,
      profile: moduleGraph.profile,
      moduleCount: moduleGraph.modules.length,
      cycleCount: moduleGraph.cycles.length,
      unresolvedRelativeImportCount: moduleGraph.unresolvedRelativeImports.length,
      cycles: moduleGraph.cycles,
      unresolvedRelativeImports: moduleGraph.unresolvedRelativeImports
    }
  };

  const portable = packageInventory(repositoryRoot, budget.portablePackage.path);
  const portablePackage = {
    path: budget.portablePackage.path,
    inventoryProfile: "git-cached-and-nonignored-untracked-files-v1",
    files: portable.files,
    bytes: portable.bytes,
    observedFiles: budget.portablePackage.observedFiles,
    observedBytes: budget.portablePackage.observedBytes,
    fileGrowthFromObservation: portable.files - budget.portablePackage.observedFiles,
    byteGrowthFromObservation: portable.bytes - budget.portablePackage.observedBytes,
    maxFiles: budget.portablePackage.maxFiles,
    maxBytes: budget.portablePackage.maxBytes,
    passed: portable.files <= budget.portablePackage.maxFiles && portable.bytes <= budget.portablePackage.maxBytes
  };
  if (portable.files > budget.portablePackage.maxFiles) violations.push({ code: "PORTABLE_PACKAGE_FILE_CAP_EXCEEDED", path: budget.portablePackage.path });
  if (portable.bytes > budget.portablePackage.maxBytes) violations.push({ code: "PORTABLE_PACKAGE_BYTE_CAP_EXCEEDED", path: budget.portablePackage.path });

  const passed = modules.every((entry) => entry.passed)
    && staleBaselines.length === 0
    && staleOverrides.length === 0
    && moduleGraph.cycles.length === 0
    && moduleGraph.unresolvedRelativeImports.length === 0
    && portablePackage.passed;
  return {
    schemaVersion: "2.0.0",
    kind: "programmable-maintainability-size-report",
    status: passed ? "SIZE_BUDGET_PASSED" : "SIZE_BUDGET_EXCEEDED",
    broadQualityClaimed: false,
    discovery: {
      roots: budget.productionModules.roots.map((entry) => ({
        path: entry.path,
        extension: entry.extension,
        excludedDirectoryNames: [...entry.excludedDirectoryNames]
      })),
      discoveredFiles: discoveredPaths.length,
      baselineCommit: legacyBaseline.sourceCommit,
      baselineManifest: budget.productionModules.legacyBaseline.manifestPath,
      baselineManifestSha256: budget.productionModules.legacyBaseline.manifestSha256,
      baselineFiles: legacyBaseline.modules.size,
      reviewedOverrideFiles: reviewedOverrides.size,
      newFiles: modules.filter(({ classification }) => classification === "new-file-hard-cap").length,
      staleBaselineFiles: staleBaselines.length,
      staleOverrideFiles: staleOverrides.length,
      allDiscoveredFilesEvaluated: modules.length === discoveredPaths.length
    },
    modules,
    staleBaselines,
    staleOverrides,
    machineDebt,
    portablePackage,
    violations: violations.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code))
  };
}

export function loadSizeBudget(repositoryRoot = defaultRepositoryRoot) {
  const budgetPath = path.join(repositoryRoot, "config/maintainability-size-budget.json");
  const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  validateSizeBudget(budget);
  return budget;
}

export function validateSizeBudget(budget) {
  if (
    budget?.$schema !== "urn:programmable:maintainability-size-budget:2.0.0"
    || budget?.schemaVersion !== "2.0.0"
    || budget?.kind !== "programmable-maintainability-size-budget"
    || budget?.observation?.scope !== "discovered-builder-production-mjs-and-portable-package-bytes"
    || budget?.observation?.broadQualityClaimed !== false
  ) throw new Error("maintainability size budget has an unsupported identity or observation scope");
  const production = budget.productionModules;
  if (
    !Array.isArray(production?.roots)
    || production.roots.length !== PRODUCTION_ROOT_SPECS.length
    || production.legacyDebtThresholdLines !== LEGACY_DEBT_THRESHOLD_LINES
    || typeof production.legacyBaseline !== "object"
    || production.legacyBaseline === null
  ) throw new Error("production module budget must discover every configured builder production root");
  for (const [index, expected] of PRODUCTION_ROOT_SPECS.entries()) {
    const observed = production.roots[index];
    if (
      observed?.path !== expected.path
      || observed?.extension !== expected.extension
      || !Array.isArray(observed.excludedDirectoryNames)
      || observed.excludedDirectoryNames.length !== expected.excludedDirectoryNames.length
      || observed.excludedDirectoryNames.some((entry, entryIndex) => entry !== expected.excludedDirectoryNames[entryIndex])
    ) throw new Error("production module roots must match the closed reviewed root set");
  }
  if (production.legacyBaseline.manifestPath !== "config/maintainability-production-baseline-v2.json") throw new Error("legacy baseline must use the canonical manifest path");
  if (!/^sha256:[0-9a-f]{64}$/u.test(production.legacyBaseline.manifestSha256 ?? "")) throw new Error("legacy baseline must bind one exact manifest sha256");
  if (!Array.isArray(production.legacyBaseline.reviewedOverrides)) throw new Error("legacy baseline reviewedOverrides must be an array");
  const hardCaps = production.newFileHardCaps;
  validateNonNegativeInteger(hardCaps?.maxLines, "new file maxLines");
  validateNonNegativeInteger(hardCaps?.maxBytes, "new file maxBytes");
  validateNonNegativeInteger(hardCaps?.maxComplexityScore, "new file maxComplexityScore");
  validateNonNegativeInteger(hardCaps?.maxBlockDepth, "new file maxBlockDepth");
  if (hardCaps.maxLines === 0 || hardCaps.maxLines > LEGACY_DEBT_THRESHOLD_LINES) throw new Error("new production modules must have a positive line cap no greater than the legacy debt threshold");
  if (hardCaps.maxBytes === 0 || hardCaps.maxComplexityScore === 0 || hardCaps.maxBlockDepth === 0) throw new Error("new production module byte and complexity caps must be positive");

  const overridePaths = new Set();
  let previousPath = null;
  for (const entry of production.legacyBaseline.reviewedOverrides) {
    validateBudgetEntry(entry, { override: true });
    if (!matchesProductionPath(entry.path, production.roots)) {
      throw new Error("reviewed override must target a production .mjs file under the canonical scripts root");
    }
    if (overridePaths.has(entry.path)) throw new Error(`duplicate reviewed override ${entry.path}`);
    if (previousPath !== null && previousPath.localeCompare(entry.path) >= 0) throw new Error("reviewed overrides must be sorted by path");
    overridePaths.add(entry.path);
    previousPath = entry.path;
  }
  if (typeof budget.portablePackage !== "object" || budget.portablePackage === null) throw new Error("portable package budget is required");
  validateBudgetEntry(budget.portablePackage, { packageBudget: true });
  return budget;
}

function validateBudgetEntry(entry, { override = false, baseline = false, packageBudget = false } = {}) {
  if (typeof entry?.path !== "string") throw new Error("size budget path must be a string");
  safeRelative(entry.path);
  const keys = override
    ? ["observedLines", "observedBytes", "observedComplexityScore", "observedMaxBlockDepth"]
    : packageBudget
      ? ["observedFiles", "observedBytes", "maxFiles", "maxBytes"]
      : [];
  for (const key of keys) validateNonNegativeInteger(entry[key], `size budget ${key}`);
  if (override && !baseline && (typeof entry.reviewRef !== "string" || entry.reviewRef.length < 12)) throw new Error("reviewed override must carry a bounded reviewRef");
  if (baseline && Object.hasOwn(entry, "reviewRef")) throw new Error("immutable baseline entries cannot carry reviewed override metadata");
  if (packageBudget && entry.observedFiles > entry.maxFiles) throw new Error("observed package files exceed their own cap");
  if (packageBudget && entry.observedBytes > entry.maxBytes) throw new Error("observed package bytes exceed their own cap");
}

function validateNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function discoverProductionModules(repositoryRoot, production) {
  const discovered = [];
  const visit = (absoluteDirectory, relativeDirectory, specification) => {
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(absoluteDirectory, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`production scripts contain symlink ${relative}`);
      if (stat.isDirectory()) {
        if (!specification.excludedDirectoryNames.includes(entry.name)) visit(absolute, relative, specification);
      } else if (stat.isFile() && entry.name.endsWith(specification.extension)) {
        discovered.push(relative);
      }
    }
  };
  for (const specification of production.roots) {
    const productionRoot = safeAbsolute(repositoryRoot, specification.path);
    const rootStat = fs.lstatSync(productionRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("production scripts root must be a regular non-symlink directory");
    visit(productionRoot, specification.path, specification);
  }
  return discovered.sort((left, right) => left.localeCompare(right));
}

function loadLegacyBaseline(repositoryRoot, production) {
  const relativePath = production.legacyBaseline.manifestPath;
  const bytes = readRegularFile(repositoryRoot, relativePath);
  const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== production.legacyBaseline.manifestSha256) throw new Error("legacy baseline manifest sha256 mismatch");
  const manifest = JSON.parse(strictUtf8Decoder.decode(bytes));
  if (
    manifest?.$schema !== "urn:programmable:maintainability-production-baseline:2.0.0"
    || manifest?.schemaVersion !== "2.0.0"
    || manifest?.kind !== "programmable-maintainability-production-baseline"
    || !/^[0-9a-f]{40}$/u.test(manifest?.sourceCommit ?? "")
    || manifest?.observation?.profile !== "exact-git-source-bytes-and-lexical-complexity-v1"
    || !Array.isArray(manifest?.modules)
    || manifest.modules.length === 0
  ) throw new Error("legacy baseline manifest identity is invalid");
  requireExactObjectKeys(manifest, ["$schema", "schemaVersion", "kind", "sourceCommit", "observation", "modules"], "legacy baseline manifest");
  requireExactObjectKeys(manifest.observation, ["recordedAt", "profile"], "legacy baseline observation");
  if (!/^20[0-9]{2}-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]Z$/u.test(manifest.observation.recordedAt ?? "")) throw new Error("legacy baseline observation timestamp is invalid");
  const modules = new Map();
  let previousPath = null;
  for (const entry of manifest.modules) {
    requireExactObjectKeys(entry, ["path", "observedLines", "observedBytes", "observedComplexityScore", "observedMaxBlockDepth"], "legacy baseline module");
    validateBudgetEntry(entry, { override: true, baseline: true });
    if (!matchesProductionPath(entry.path, production.roots)) throw new Error("legacy baseline module path is outside configured production roots");
    if (modules.has(entry.path)) throw new Error(`duplicate legacy baseline module ${entry.path}`);
    if (previousPath !== null && previousPath.localeCompare(entry.path) >= 0) throw new Error("legacy baseline modules must be sorted by path");
    modules.set(entry.path, entry);
    previousPath = entry.path;
  }
  return { sourceCommit: manifest.sourceCommit, modules };
}

function matchesProductionPath(relativePath, roots) {
  if (!validProductionPath(relativePath)) return false;
  return roots.some((specification) => (
    relativePath.startsWith(`${specification.path}/`)
    && relativePath.endsWith(specification.extension)
    && !relativePath.slice(specification.path.length + 1).split("/").some((part) => specification.excludedDirectoryNames.includes(part))
  ));
}

function validProductionPath(value) {
  try {
    safeRelative(value);
    return true;
  } catch {
    return false;
  }
}

function requireExactObjectKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be one object`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}`);
}

function readRegularFile(repositoryRoot, relativePath) {
  const absolute = safeAbsolute(repositoryRoot, relativePath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relativePath} must be a regular non-symlink file`);
  return fs.readFileSync(absolute);
}

function packageInventory(repositoryRoot, relativeRoot) {
  safeAbsolute(repositoryRoot, relativeRoot);
  const result = childProcess.spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", relativeRoot], {
    cwd: repositoryRoot,
    encoding: "buffer",
    shell: false,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ls-files failed: ${String(result.stderr).trim()}`);
  const files = result.stdout.toString("utf8").split("\u0000").filter(Boolean).sort((left, right) => left.localeCompare(right));
  let bytes = 0;
  for (const relativePath of files) {
    const absolute = safeAbsolute(repositoryRoot, relativePath);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`portable package inventory contains non-regular file ${relativePath}`);
    bytes += stat.size;
  }
  return { files: files.length, bytes };
}

function countLines(bytes) {
  if (bytes.length === 0) return 0;
  const source = strictUtf8Decoder.decode(bytes);
  const separators = source.match(/\r\n|[\n\r\u2028\u2029]/gu) ?? [];
  return separators.length + (/(?:\r\n|[\n\r\u2028\u2029])$/u.test(source) ? 0 : 1);
}

function safeAbsolute(root, relativePath) {
  safeRelative(relativePath);
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("size budget path escapes repository");
  return absolute;
}

function safeRelative(value) {
  if (
    typeof value !== "string"
    || value.startsWith("/")
    || value.includes("\\")
    || path.posix.normalize(value) !== value
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new Error("size budget path must be safe and repository-relative");
}

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    if (process.argv.length !== 2) throw new Error("usage: size-budget.mjs");
    const report = evaluateSizeBudget({ repositoryRoot: defaultRepositoryRoot, budget: loadSizeBudget() });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "SIZE_BUDGET_PASSED") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
