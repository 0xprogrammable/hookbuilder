#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const baselinePath = path.join(repositoryRoot, "config/maintainability-coverage-baseline.json");
const minimumNodeVersion = Object.freeze({ major: 22, minor: 0, patch: 0 });
const maximumOutputBytes = 64 * 1024 * 1024;
const testTimeoutMs = 120_000;
const REQUIRED_TESTS = Object.freeze([
  "skills/programmable-v4-hook-builder/scripts/test/canonical-json-core.test.mjs",
  "skills/programmable-v4-hook-builder/scripts/test/strict-json-core.test.mjs",
  "skills/programmable-v4-hook-builder/scripts/test/public-claims.test.mjs",
  "skills/programmable-v4-hook-builder/scripts/test/github-application.test.mjs",
  "skills/programmable-v4-hook-builder/scripts/test/trade-capability-manifest.test.mjs",
  "skills/programmable-v4-hook-builder/scripts/test/v4-hook-semantic-contract.test.mjs"
]);
const REQUIRED_COVERAGE_GROUPS = Object.freeze([
  coverageGroupContract({
    id: "canonical-json-core",
    exactPaths: ["skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs"],
    minimumFound: { lines: 165, functions: 14, branches: 77 },
    minimumBasisPoints: { lines: 9000, functions: 9500, branches: 8500 }
  }),
  coverageGroupContract({
    id: "github-application-responsibility",
    directory: "skills/programmable-v4-hook-builder/scripts",
    filePrefix: "github-application-",
    minimumFound: { lines: 2909, functions: 194, branches: 726 },
    minimumBasisPoints: { lines: 7700, functions: 8000, branches: 6500 }
  }),
  coverageGroupContract({
    id: "public-claims-responsibility",
    directory: "skills/programmable-v4-hook-builder/scripts",
    filePrefix: "public-claims-",
    minimumFound: { lines: 879, functions: 53, branches: 376 },
    minimumBasisPoints: { lines: 9200, functions: 9300, branches: 7200 }
  }),
  coverageGroupContract({
    id: "strict-json-core",
    exactPaths: ["skills/programmable-v4-hook-builder/scripts/strict-json-core.mjs"],
    minimumFound: { lines: 226, functions: 15, branches: 97 },
    minimumBasisPoints: { lines: 8500, functions: 9000, branches: 8000 }
  }),
  coverageGroupContract({
    id: "trade-routing-responsibility",
    exactPaths: [
      "skills/programmable-v4-hook-builder/scripts/trade-capability-manifest-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/v4-deployment-evidence-core.mjs",
      "skills/programmable-v4-hook-builder/scripts/v4-hook-semantic-contract-core.mjs"
    ],
    minimumFound: { lines: 1435, functions: 147, branches: 578 },
    minimumBasisPoints: { lines: 7700, functions: 7800, branches: 8000 }
  })
]);

export function runCoverageBaselineGate(root = repositoryRoot) {
  assertSupportedNodeVersion(process.versions.node);
  const baseline = loadCoverageBaseline(root);
  assertSourceBindings(baseline.groups, root);
  const coverage = collectBuiltInCoverage(baseline.tests, root);
  return evaluateCoverage(baseline, coverage);
}

export function loadCoverageBaseline(root = repositoryRoot) {
  const filePath = root === repositoryRoot ? baselinePath : path.join(root, "config/maintainability-coverage-baseline.json");
  const bytes = readBoundedRegularFile(filePath, 512 * 1024, "coverage baseline");
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("coverage baseline must be valid JSON");
  }
  return validateCoverageBaseline(value, { repositoryRoot: root });
}

export function validateCoverageBaseline(value, { repositoryRoot: root = repositoryRoot } = {}) {
  if (
    !isPlainObject(value)
    || value.$schema !== "urn:programmable:maintainability-coverage-baseline:2.0.0"
    || value.schemaVersion !== "2.0.0"
    || value.engine !== "node-built-in-test-coverage-lcov"
    || !Array.isArray(value.tests)
    || value.tests.length === 0
    || !Array.isArray(value.groups)
    || value.groups.length !== REQUIRED_COVERAGE_GROUPS.length
  ) {
    throw new Error("coverage baseline has an unsupported shape or identity");
  }
  requireExactKeys(value, ["$schema", "schemaVersion", "engine", "observation", "tests", "groups"], "coverage baseline");
  requireExactKeys(value.observation, ["nodeVersion", "scope", "repositoryWideCoverageClaimed"], "coverage baseline observation");
  if (value.observation.scope !== "exact-working-tree-source-bytes" || value.observation.repositoryWideCoverageClaimed !== false) {
    throw new Error("coverage baseline observation must remain narrowly scoped and must not claim repository-wide coverage");
  }
  const tests = value.tests.map((entry, index) => safeRepositoryFile(entry, `tests[${index}]`, ".test.mjs", root));
  if (new Set(tests).size !== tests.length) throw new Error("coverage baseline test paths must be unique");
  if (!sameArray(tests, REQUIRED_TESTS)) throw new Error("coverage baseline must retain the exact reviewed critical test set");
  const groups = value.groups.map((entry, index) => normalizeCoverageGroup(entry, index, root));
  const configuredModulePaths = groups.flatMap(({ modules }) => modules.map(({ path: modulePath }) => modulePath));
  if (new Set(configuredModulePaths).size !== configuredModulePaths.length) {
    throw new Error("coverage group module ownership must be globally unique");
  }
  for (const [index, contract] of REQUIRED_COVERAGE_GROUPS.entries()) {
    if (groups[index].id !== contract.id) throw new Error("coverage groups must retain the reviewed identity and order");
    const requiredPaths = discoverCoverageGroupModules(contract, root);
    const configuredPaths = groups[index].modules.map(({ path: modulePath }) => modulePath);
    if (!sameArray(configuredPaths, requiredPaths)) {
      throw new Error(`${contract.id} coverage group module inventory must exactly match its complete responsibility surface`);
    }
    for (const metricName of ["lines", "functions", "branches"]) {
      if (groups[index].minimumBasisPoints[metricName] < contract.minimumBasisPoints[metricName]) {
        throw new Error(`${contract.id} coverage threshold cannot be lower than its historical group threshold`);
      }
      if (groups[index].observed[metricName].found < contract.minimumFound[metricName]) {
        throw new Error(`${contract.id} observed surface cannot be smaller than its historical responsibility surface`);
      }
      const observed = groups[index].observed[metricName];
      const observedBasisPoints = Math.floor((observed.covered * 10_000) / observed.found);
      if (observedBasisPoints < contract.minimumBasisPoints[metricName]) {
        throw new Error(`${contract.id} observed coverage cannot be lower than its historical group threshold`);
      }
    }
  }
  return Object.freeze({ ...value, tests: Object.freeze(tests), groups: Object.freeze(groups) });
}

function normalizeCoverageGroup(entry, index, root) {
  const label = `groups[${index}]`;
  if (!isPlainObject(entry)) throw new Error(`${label} must be an object`);
  requireExactKeys(entry, ["id", "modules", "observed", "minimumBasisPoints"], label);
  if (typeof entry.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id)) {
    throw new Error(`${label}.id must be a canonical lowercase identifier`);
  }
  if (!Array.isArray(entry.modules) || entry.modules.length === 0) {
    throw new Error(`${label}.modules must be a non-empty array`);
  }
  const modules = entry.modules.map((module, moduleIndex) => normalizeSourceBinding(
    module,
    `${label}.modules[${moduleIndex}]`,
    root
  ));
  const modulePaths = modules.map(({ path: modulePath }) => modulePath);
  if (new Set(modulePaths).size !== modulePaths.length) throw new Error(`${label} module paths must be unique`);
  if (!sameArray(modulePaths, [...modulePaths].sort())) throw new Error(`${label} modules must be sorted by path`);
  if (!isPlainObject(entry.observed) || !isPlainObject(entry.minimumBasisPoints)) {
    throw new Error(`${label} must record aggregate observed counts and minimum basis points`);
  }
  requireExactKeys(entry.observed, ["lines", "functions", "branches"], `${label}.observed`);
  requireExactKeys(entry.minimumBasisPoints, ["lines", "functions", "branches"], `${label}.minimumBasisPoints`);
  const observed = {};
  const minimumBasisPoints = {};
  for (const metricName of ["lines", "functions", "branches"]) {
    const counts = entry.observed[metricName];
    requireExactKeys(counts, ["covered", "found"], `${label}.observed.${metricName}`);
    if (
      !Number.isSafeInteger(counts.covered)
      || !Number.isSafeInteger(counts.found)
      || counts.covered < 0
      || counts.found <= 0
      || counts.covered > counts.found
    ) {
      throw new Error(`${label}.observed.${metricName} has invalid counts`);
    }
    const minimum = entry.minimumBasisPoints[metricName];
    if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > 10_000) {
      throw new Error(`${label}.minimumBasisPoints.${metricName} must be an integer from 0 to 10000`);
    }
    observed[metricName] = Object.freeze({ covered: counts.covered, found: counts.found });
    minimumBasisPoints[metricName] = minimum;
  }
  return Object.freeze({
    id: entry.id,
    modules: Object.freeze(modules),
    observed: Object.freeze(observed),
    minimumBasisPoints: Object.freeze(minimumBasisPoints)
  });
}

function normalizeSourceBinding(entry, label, root) {
  if (!isPlainObject(entry)) throw new Error(`${label} must be an object`);
  requireExactKeys(entry, ["path", "sourceSha256"], label);
  const modulePath = safeRepositoryFile(entry.path, `${label}.path`, ".mjs", root);
  if (!/^sha256:[0-9a-f]{64}$/u.test(entry.sourceSha256 ?? "")) {
    throw new Error(`${label}.sourceSha256 must be a lowercase SHA-256 digest`);
  }
  return Object.freeze({ path: modulePath, sourceSha256: entry.sourceSha256 });
}

function discoverCoverageGroupModules(contract, root) {
  if (contract.exactPaths !== null) {
    for (const modulePath of contract.exactPaths) {
      readBoundedRegularFile(path.join(root, modulePath), 2 * 1024 * 1024, modulePath);
    }
    return contract.exactPaths;
  }
  const absoluteDirectory = path.join(root, contract.directory);
  const directoryStat = fs.lstatSync(absoluteDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`${contract.id} coverage responsibility directory must be a non-symlink directory`);
  }
  const modulePaths = [];
  for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
    if (!entry.name.startsWith(contract.filePrefix) || !entry.name.endsWith(".mjs")) continue;
    const modulePath = path.posix.join(contract.directory, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`${contract.id} coverage responsibility module ${modulePath} must be a regular non-symlink file`);
    }
    readBoundedRegularFile(path.join(root, modulePath), 2 * 1024 * 1024, modulePath);
    modulePaths.push(modulePath);
  }
  if (modulePaths.length === 0) throw new Error(`${contract.id} coverage responsibility surface is empty`);
  return Object.freeze(modulePaths.sort());
}

function assertSourceBindings(groups, root) {
  for (const group of groups) {
    for (const module of group.modules) {
      const bytes = readBoundedRegularFile(path.join(root, module.path), 2 * 1024 * 1024, module.path);
      const actual = sha256(bytes);
      if (actual !== module.sourceSha256) {
        throw new Error(`${module.path} changed after the coverage observation; measure and review a new baseline before updating its sourceSha256`);
      }
    }
  }
}

function collectBuiltInCoverage(tests, root) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-node-coverage-"));
  const lcovPath = path.join(temporaryDirectory, "coverage.lcov");
  try {
    const result = childProcess.spawnSync(process.execPath, [
      "--test",
      "--experimental-test-coverage",
      "--test-reporter=lcov",
      `--test-reporter-destination=${lcovPath}`,
      ...tests
    ], {
      cwd: root,
      encoding: "utf8",
      env: testChildEnvironment(),
      maxBuffer: maximumOutputBytes,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: testTimeoutMs
    });
    if (result.error !== undefined || result.signal !== null || result.status !== 0) {
      const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`.trim();
      throw new Error(`coverage test run failed${diagnostic ? `:\n${diagnostic}` : ""}`);
    }
    const lcovBytes = readBoundedRegularFile(lcovPath, maximumOutputBytes, "Node LCOV report");
    return parseLcov(lcovBytes.toString("utf8"), root);
  } finally {
    removeOwnedTemporaryDirectory(temporaryDirectory, "programmable-node-coverage-");
  }
}

function parseLcov(source, root) {
  const records = new Map();
  for (const block of source.split("end_of_record")) {
    const fields = new Map();
    for (const line of block.split(/\r?\n/u)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      fields.set(line.slice(0, separator), line.slice(separator + 1));
    }
    if (!fields.has("SF")) continue;
    const modulePath = repositoryRelativePath(fields.get("SF"), root);
    if (records.has(modulePath)) throw new Error(`Node LCOV report contains duplicate records for ${modulePath}`);
    records.set(modulePath, Object.freeze({
      lines: metric(fields, "LH", "LF", modulePath),
      functions: metric(fields, "FNH", "FNF", modulePath),
      branches: metric(fields, "BRH", "BRF", modulePath)
    }));
  }
  return records;
}

function metric(fields, coveredKey, foundKey, modulePath) {
  const covered = Number(fields.get(coveredKey));
  const found = Number(fields.get(foundKey));
  if (!Number.isSafeInteger(covered) || !Number.isSafeInteger(found) || covered < 0 || found < 0 || covered > found) {
    throw new Error(`Node LCOV report has invalid ${coveredKey}/${foundKey} counts for ${modulePath}`);
  }
  return Object.freeze({ covered, found, basisPoints: found === 0 ? 10_000 : Math.floor((covered * 10_000) / found) });
}

function evaluateCoverage(baseline, coverage) {
  const groups = [];
  let passed = true;
  for (const expectedGroup of baseline.groups) {
    const contract = REQUIRED_COVERAGE_GROUPS.find(({ id }) => id === expectedGroup.id);
    if (contract === undefined) throw new Error(`coverage group ${expectedGroup.id} has no immutable contract`);
    const aggregate = {
      lines: { covered: 0, found: 0 },
      functions: { covered: 0, found: 0 },
      branches: { covered: 0, found: 0 }
    };
    const modules = [];
    for (const expectedModule of expectedGroup.modules) {
      const actual = coverage.get(expectedModule.path);
      if (actual === undefined) throw new Error(`Node LCOV report omitted critical module ${expectedModule.path}`);
      for (const metricName of ["lines", "functions", "branches"]) {
        aggregate[metricName].covered += actual[metricName].covered;
        aggregate[metricName].found += actual[metricName].found;
      }
      modules.push({
        path: expectedModule.path,
        sourceSha256: expectedModule.sourceSha256,
        metrics: actual
      });
    }
    const metrics = {};
    for (const metricName of ["lines", "functions", "branches"]) {
      const current = aggregateMetric(aggregate[metricName]);
      const minimum = expectedGroup.minimumBasisPoints[metricName];
      const minimumFound = contract.minimumFound[metricName];
      const thresholdPassed = current.basisPoints >= minimum;
      const surfacePassed = current.found >= minimumFound;
      const metricPassed = thresholdPassed && surfacePassed;
      if (!metricPassed) passed = false;
      metrics[metricName] = {
        covered: current.covered,
        found: current.found,
        percent: basisPointsText(current.basisPoints),
        minimumPercent: basisPointsText(minimum),
        historicalMinimumFound: minimumFound,
        thresholdPassed,
        surfacePassed,
        passed: metricPassed,
        observed: expectedGroup.observed[metricName]
      };
    }
    groups.push({
      id: expectedGroup.id,
      moduleCount: modules.length,
      modules,
      metrics
    });
  }
  return {
    schemaVersion: "2.0.0",
    kind: "programmable-maintainability-coverage",
    status: passed ? "COVERAGE_BASELINE_PASSED" : "COVERAGE_BASELINE_FAILED",
    engine: "node-built-in-test-coverage-lcov",
    nodeVersion: process.versions.node,
    scope: "listed-critical-responsibility-groups-only",
    repositoryWideCoverageClaimed: false,
    groups
  };
}

function aggregateMetric(counts) {
  return Object.freeze({
    covered: counts.covered,
    found: counts.found,
    basisPoints: counts.found === 0 ? 10_000 : Math.floor((counts.covered * 10_000) / counts.found)
  });
}

function safeRepositoryFile(value, label, suffix, root = repositoryRoot) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value.startsWith("/")
    || value.includes("\\")
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || !value.endsWith(suffix)
  ) {
    throw new Error(`${label} must be a safe repository-relative ${suffix} path`);
  }
  const absolutePath = path.resolve(root, value);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escapes the repository`);
  return value;
}

function repositoryRelativePath(value, root) {
  const absolutePath = path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
  const relative = path.relative(root, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Node LCOV source path escapes the repository: ${value}`);
  }
  return relative.split(path.sep).join("/");
}

function coverageGroupContract({
  id,
  exactPaths = null,
  directory = null,
  filePrefix = null,
  minimumFound,
  minimumBasisPoints
}) {
  const hasExactPaths = Array.isArray(exactPaths) && exactPaths.length > 0;
  const hasDiscoveredPrefix = typeof directory === "string" && typeof filePrefix === "string" && filePrefix.length > 0;
  if (hasExactPaths === hasDiscoveredPrefix) throw new Error(`coverage group contract ${id} must define exactly one inventory strategy`);
  return Object.freeze({
    id,
    exactPaths: hasExactPaths ? Object.freeze([...exactPaths].sort()) : null,
    directory,
    filePrefix,
    minimumFound: Object.freeze({ ...minimumFound }),
    minimumBasisPoints: Object.freeze({ ...minimumBasisPoints })
  });
}

function requireExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (!sameArray(actual, expected)) throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readBoundedRegularFile(filePath, maximumBytes, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if (stat.size > maximumBytes) throw new Error(`${label} exceeds its ${maximumBytes}-byte limit`);
  return fs.readFileSync(filePath);
}

function removeOwnedTemporaryDirectory(directory, prefix) {
  const realParent = fs.realpathSync(path.dirname(directory));
  const realTemporaryRoot = fs.realpathSync(os.tmpdir());
  if (realParent !== realTemporaryRoot || !path.basename(directory).startsWith(prefix)) {
    throw new Error("refusing to remove an unowned coverage temporary directory");
  }
  fs.rmSync(directory, { recursive: true, force: false });
}

function assertSupportedNodeVersion(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  const supported = major > minimumNodeVersion.major
    || (major === minimumNodeVersion.major && minor > minimumNodeVersion.minor)
    || (major === minimumNodeVersion.major && minor === minimumNodeVersion.minor && patch >= minimumNodeVersion.patch);
  if (!supported) throw new Error("coverage gate requires Node.js 22 or newer for built-in test coverage");
}

function assertNoArguments(args) {
  if (args.length !== 0) throw new Error("usage: coverage-baseline.mjs");
}

function testChildEnvironment() {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...environment } = process.env;
  return { ...environment, CI: "1", NO_COLOR: "1" };
}

function basisPointsText(value) {
  return (value / 100).toFixed(2);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDirectExecution() {
  return typeof process.argv[1] === "string" && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    assertNoArguments(process.argv.slice(2));
    const report = runCoverageBaselineGate();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "COVERAGE_BASELINE_PASSED") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
