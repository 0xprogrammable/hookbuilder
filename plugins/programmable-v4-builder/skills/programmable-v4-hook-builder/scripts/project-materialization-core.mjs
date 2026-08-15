import fs from "node:fs";
import childProcess from "node:child_process";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import { validateArchitectureCandidates, validateProductGraph, validateProjectSpec } from "./project-contracts-core.mjs";
import { normalizeNoMarketAuthoringFiles, readLocalAuthoringInputs } from "./project-no-market-authoring-core.mjs";
import { createNoMarketProjectAuthoring } from "./project-state-core.mjs";
import { bindTradableReferenceIntent, TRADABLE_REFERENCE_PROFILE_ID } from "./project-tradable-authoring-core.mjs";
import { validateRepositoryPlan } from "./repository-completion-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceKernelRoot = path.join(skillRoot, "assets/reference-kernels/programmable-volume-fee-v2");
const planPath = ".programmable/custom-tradable-build-plan.v1.json";
const BRIEF_MAX_OUTPUT_BYTES = 2_499;

export const CUSTOM_TRADABLE_BUILD_PLAN_PATH = planPath;

export async function materializeProject(options, failUsage) {
  const prohibited = [options.repositoryRoot, options.state, options.previousState, options.submissionRoot, options.plan, options.outputPlan, options.attempt];
  if (prohibited.some((value) => value !== null) || options.previousAttempts.length > 0) failUsage("materialize does not accept repository validation, execution, or diagnosis options");
  for (const key of ["ideaFile", "applicationId", "classification", "output"]) if (options[key] === null) failUsage(`materialize requires --${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.applicationId) || options.applicationId.length > 120) failUsage("--application-id must be a lowercase slug");
  if (!["no-market", "tradable"].includes(options.classification)) failUsage("--classification must be no-market or tradable");
  const ideaBytes = readInputBytes(options.ideaFile, 1_000_000, "idea file");
  const ideaText = new TextDecoder("utf-8", { fatal: true }).decode(ideaBytes);
  if (ideaText.trim().length === 0) failUsage("--idea-file must contain non-whitespace UTF-8 text");
  const outputRoot = resolveNewOutput(options.output);
  if (options.classification === "tradable") return materializeTradableSelection({ options, ideaBytes, ideaText, outputRoot, failUsage });
  return materializeNoMarket({ options, ideaText, outputRoot, failUsage });
}

export function createCustomTradableProjectAuthoring({ applicationId, ideaText, marketRef, compilerVersion, sourceFiles, testFiles } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(applicationId ?? "") || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(marketRef ?? "")) {
    throw new TypeError("custom tradable authoring requires exact application and market slugs");
  }
  if (typeof ideaText !== "string" || ideaText.trim() === "" || !/^0\.[0-9]+\.[0-9]+$/u.test(compilerVersion ?? "")) {
    throw new TypeError("custom tradable authoring requires preserved intent and an exact Solidity compiler version");
  }
  const sources = normalizeNoMarketAuthoringFiles(sourceFiles, undefined, undefined, "src/");
  const tests = normalizeNoMarketAuthoringFiles(testFiles, undefined, undefined, "test/");
  if (!sources.some(({ path: filePath }) => filePath.endsWith(".sol")) || !tests.some(({ path: filePath }) => filePath.endsWith(".t.sol"))) {
    throw new TypeError("custom tradable authoring requires Solidity source and Foundry tests");
  }

  const ideaBytes = Buffer.from(ideaText, "utf8");
  const packageLock = customPackageLock(applicationId);
  const packageJson = customPackageJson(applicationId, packageLock.packages[""].dependencies);
  const files = new Map([...sources, ...tests].map(({ path: filePath, bytes }) => [filePath, Buffer.from(bytes)]));
  files.set("package.json", jsonBytes(packageJson));
  files.set("package-lock.json", jsonBytes(packageLock));
  files.set("remappings.txt", fs.readFileSync(path.join(referenceKernelRoot, "remappings.txt")));
  files.set("foundry.toml", Buffer.from(foundryToml(compilerVersion)));
  files.set(".gitignore", Buffer.from("node_modules/\ncache/\nout/\nbroadcast/\n.programmable/project-repair-attempt-*.v1.json\n"));
  files.set("LICENSE", Buffer.from(MIT_LICENSE));
  files.set("evidence/architecture.md", Buffer.from(architectureEvidence(applicationId, marketRef, sha256Bytes(ideaBytes))));
  files.set("GITHUB-SUBMISSION.md", Buffer.from("# GitHub submission handoff\n\nStatus: **NOT_SUBMITTED**.\n\nThis repository is a local custom-tradable implementation. It creates no approval, audit, deployment, publication, Registry write, or launch.\n"));

  const plan = {
    schemaVersion: "1.0.0",
    kind: "custom-tradable-local-build-plan",
    status: "SOURCE_AND_TESTS_MATERIALIZED",
    applicationId,
    classification: "tradable",
    architecture: "custom",
    marketRef,
    intent: { encoding: "utf-8", byteLength: ideaBytes.length, sha256: sha256Bytes(ideaBytes) },
    toolchain: {
      profile: "foundry",
      solidity: compilerVersion,
      dependencyLock: { path: "package-lock.json", sha256: sha256Bytes(files.get("package-lock.json")), byteLength: files.get("package-lock.json").length },
      networkRequiredForInstall: true
    },
    source: bindings(sources),
    tests: bindings(tests),
    commands: [
      command("install", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]),
      command("format", ["forge", "fmt", "--check"]),
      command("build", ["forge", "build", "--offline"]),
      command("test", ["forge", "test", "--offline"]),
      command("fuzz", ["forge", "test", "--offline", "--match-test", "testFuzz"]),
      command("invariant", ["forge", "test", "--offline", "--match-test", "invariant"]),
      command("gas", ["forge", "test", "--offline", "--gas-report"]),
      command("code-size", ["forge", "build", "--offline", "--sizes"]),
      command("deployment-test", ["forge", "test", "--offline", "--match-test", "testDeployment"])
    ],
    launch: {
      status: "NOT_SUBMITTED",
      tradeManifest: "UNRESOLVED_UNTIL_SUBMISSION",
      policyEvaluationStage: "submission",
      policyIsSourceAllowlist: false,
      approval: false,
      audit: false,
      deployment: false,
      publication: false,
      externalActionsPerformed: []
    }
  };
  files.set(planPath, jsonBytes(plan));
  files.set("README.md", Buffer.from(readme(applicationId, marketRef, plan.intent.sha256)));
  return { files, plan, ideaSha256: plan.intent.sha256, sourcePaths: sources.map(({ path: filePath }) => filePath), testPaths: tests.map(({ path: filePath }) => filePath) };
}

function materializeTradableSelection({ options, ideaBytes, ideaText, outputRoot, failUsage }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.marketRef ?? "") || options.marketRef.length > 120) failUsage("tradable materialize requires --market-ref as a lowercase slug of at most 120 characters");
  if (options.referenceProfile !== null) {
    if (options.referenceProfile !== TRADABLE_REFERENCE_PROFILE_ID) failUsage(`unknown frozen legacy reference profile: ${options.referenceProfile}`);
    if ([options.projectProfile, options.sourceRoot, options.testRoot, options.sourceContract, options.testSource].some((value) => value !== null)) failUsage("legacy tradable materialize does not accept custom authoring profile, root, source, or test options");
    bindTradableReferenceIntent(ideaText, options.referenceProfile);
    return materializeLegacyTradable({ ...options, ideaBytes, outputRoot });
  }
  if (options.projectProfile !== "foundry" || options.sourceContract !== null || options.testSource !== null) failUsage("custom tradable materialize requires --project-profile foundry with --source-root and --test-root");
  const { compilerVersion, sourceFiles, testFiles } = readLocalAuthoringInputs(options);
  const authored = createCustomTradableProjectAuthoring({ applicationId: options.applicationId, ideaText, marketRef: options.marketRef, compilerVersion, sourceFiles, testFiles });
  return materializeCustomTradable({ ...options, authored, compilerVersion, outputRoot });
}

function materializeNoMarket({ options, ideaText, outputRoot, failUsage }) {
  if (options.marketRef !== null) failUsage("no-market materialize does not accept --market-ref");
  if (options.referenceProfile !== null) failUsage("no-market materialize does not accept --reference-profile");
  const { projectProfile, compilerVersion, sourceFiles, testFiles } = readLocalAuthoringInputs(options);
  const sourcePaths = sourceFiles.map(({ path: filePath }) => filePath);
  const testPaths = testFiles.map(({ path: filePath }) => filePath);
  const authored = createNoMarketProjectAuthoring({ applicationId: options.applicationId, ideaText, projectProfile, compilerVersion, sourceFiles, testFiles });
  const findings = [
    ...validateProjectSpec(authored.projectSpec),
    ...validateProductGraph(authored.projectSpec, authored.productGraph),
    ...validateArchitectureCandidates(authored.projectSpec, authored.productGraph, authored.architectureCandidates),
    ...validateRepositoryPlan(authored.projectSpec, authored.productGraph, authored.architectureCandidates, authored.repositoryPlan)
  ];
  if (findings.some(({ severity }) => severity === "blocker")) throw Object.assign(new Error("generated project artifacts fail bundled validation"), { code: "PROJECT_AUTHORING_INVALID", findings });
  const common = {
    applicationId: options.applicationId,
    classification: "no-market",
    projectProfile,
    compilerVersion,
    outputRoot,
    ideaSha256: authored.projectSpec.intent.sha256,
    sourcePaths,
    testPaths,
    inventory: fileInventory(authored.files),
    blockers: []
  };
  if (!options.write) return emitMaterialization({ ...common, status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", writeRequested: false, writePerformed: false }, options.brief);
  return exportAuthoredRepository({
    authored,
    outputRoot,
    temporaryPrefix: ".programmable-project-materialize-",
    exportPrefix: ".programmable-project-export-",
    commitMessage: "materialize intent-bound local source",
    beforeCommit(root) {
      writeOutputJson(root, ".programmable/project-spec.v1.json", authored.projectSpec);
      writeOutputJson(root, ".programmable/product-graph.v1.json", authored.productGraph);
      writeOutputJson(root, ".programmable/architecture-candidates.v1.json", authored.architectureCandidates);
    },
    beforeExport(root) {
      authored.repositoryPlan.repository.branch = git(root, ["branch", "--show-current"]);
      authored.repositoryPlan.repository.headCommit = git(root, ["rev-parse", "HEAD"]);
    },
    afterClone(root) {
      writeOutputJson(root, ".programmable/repository-plan.materializing.v1.json", authored.repositoryPlan);
      if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") throw Object.assign(new Error("plan-only export must remain clean with its transient plan ignored"), { code: "PROJECT_PLAN_EXPORT_DIRTY" });
    },
    report: {
      ...common,
      operation: "PROJECT_SOURCE_AND_PLAN_MATERIALIZED",
      planPath: ".programmable/repository-plan.materializing.v1.json",
      get planSha256() { return canonicalJsonSha256V2(authored.repositoryPlan); },
      blockers: ["PROJECT_EXTERNAL_SANDBOX_REQUIRED"]
    },
    brief: options.brief
  });
}

function materializeCustomTradable({ applicationId, marketRef, authored, compilerVersion, outputRoot, write, brief }) {
  const common = {
    applicationId,
    classification: "tradable",
    projectProfile: "foundry",
    compilerVersion,
    marketRef,
    outputRoot,
    ideaSha256: authored.ideaSha256,
    sourcePaths: authored.sourcePaths,
    testPaths: authored.testPaths,
    inventory: fileInventory(authored.files),
    planPath,
    planSha256: canonicalJsonSha256V2(authored.plan),
    blockers: []
  };
  if (!write) return emitMaterialization({ ...common, status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", operation: "CUSTOM_TRADABLE_SOURCE_DRY_RUN", writeRequested: false, writePerformed: false }, brief);
  return exportAuthoredRepository({
    authored,
    outputRoot,
    temporaryPrefix: ".programmable-custom-tradable-materialize-",
    exportPrefix: ".programmable-custom-tradable-export-",
    commitMessage: "materialize intent-bound custom tradable source",
    afterClone(root) {
      if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") throw Object.assign(new Error("custom tradable export must remain clean"), { code: "PROJECT_CUSTOM_TRADABLE_EXPORT_DIRTY" });
    },
    report: { ...common, operation: "CUSTOM_TRADABLE_SOURCE_AND_PLAN_MATERIALIZED" },
    brief
  });
}

function materializeLegacyTradable({ applicationId, marketRef, ideaBytes, outputRoot, write, brief }) {
  if (!write) return emitMaterialization({ status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", applicationId, classification: "tradable", marketRef, writeRequested: false, writePerformed: false, outputRoot, ideaSha256: sha256Bytes(ideaBytes), blockers: [] }, brief);
  throw Object.assign(new Error("frozen legacy tradable source generation requires candidate dependency and test execution in an external sandbox"), {
    code: "PROJECT_EXTERNAL_SANDBOX_REQUIRED",
    status: "PROJECT_EXECUTION_BLOCKED",
    planCreated: false,
    executionCompleted: false,
    commandsExecuted: false,
    networkAccessed: false,
    externalWritesPerformed: false,
    trustedSandboxAuthorityConfigured: false
  });
}

function exportAuthoredRepository({ authored, outputRoot, temporaryPrefix, exportPrefix, commitMessage, beforeCommit = () => {}, beforeExport = () => {}, afterClone = () => {}, report, brief }) {
  const temporaryRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), temporaryPrefix));
  let exportRoot = null;
  try {
    for (const [relativePath, bytes] of authored.files) writeOutputFile(temporaryRoot, relativePath, bytes);
    beforeCommit(temporaryRoot);
    git(temporaryRoot, ["init", "-q", "-b", "main"]);
    git(temporaryRoot, ["config", "user.name", "Programmable Local Builder"]);
    git(temporaryRoot, ["config", "user.email", "local-builder@example.invalid"]);
    git(temporaryRoot, ["add", "."]);
    git(temporaryRoot, ["commit", "-qm", commitMessage]);
    beforeExport(temporaryRoot);
    const sourceCommit = git(temporaryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(temporaryRoot, ["rev-parse", "HEAD^{tree}"]);
    exportRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), exportPrefix));
    git(path.dirname(outputRoot), ["clone", "-q", "--no-hardlinks", temporaryRoot, exportRoot]);
    git(exportRoot, ["remote", "remove", "origin"]);
    afterClone(exportRoot);
    fs.renameSync(exportRoot, outputRoot);
    exportRoot = null;
    emitMaterialization({
      ...report,
      status: "PROJECT_MATERIALIZATION_PLAN_WRITTEN",
      writeRequested: true,
      writePerformed: true,
      sourceCommit,
      sourceTree,
      executionStatus: "EXTERNAL_SANDBOX_REQUIRED",
      commandsExecuted: false
    }, brief);
  } finally {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (exportRoot !== null && fs.existsSync(exportRoot)) fs.rmSync(exportRoot, { recursive: true, force: true });
  }
}

function emitMaterialization(fields, brief) {
  const { outputRoot: _environmentSpecificOutputRoot, ...stableFields } = fields;
  const payload = {
    schemaVersion: "1.0.0",
    kind: "project-materialization-report",
    ...stableFields,
    outputLocationBound: false,
    canonicalOutput: fields.status === "PROJECT_PREFLIGHT_VALID",
    evidenceBoundary: {
      scope: "local-project-authoring",
      planCreated: fields.status === "PROJECT_MATERIALIZATION_PLAN_WRITTEN",
      executionCompleted: false,
      commandsExecuted: fields.commandsExecuted === true,
      executionPolicy: "external-sandbox-required-fail-closed",
      executionIsolationEnforced: false,
      networkAccessed: false,
      externalWritesObserved: false,
      authoredCommandExternalActionsObserved: false,
      builderExternalActionsPerformed: [],
      approvalCreated: false,
      auditClaimed: false,
      deploymentClaimed: false,
      productionClaimed: false
    }
  };
  const report = { ...payload, reportSha256: canonicalJsonSha256V2(payload) };
  if (!brief) {
    process.stdout.write(`${canonicalJsonV2(report)}\n`);
    return;
  }
  const inventory = Array.isArray(report.inventory) ? report.inventory : [];
  const sourcePaths = Array.isArray(report.sourcePaths) ? report.sourcePaths : [];
  const testPaths = Array.isArray(report.testPaths) ? report.testPaths : [];
  const summary = {
    schemaVersion: "1.0.0",
    kind: "project-materialization-brief",
    status: report.status,
    applicationId: report.applicationId,
    classification: report.classification,
    projectProfile: report.projectProfile ?? null,
    compilerVersion: report.compilerVersion ?? null,
    marketRef: report.marketRef ?? null,
    writeRequested: report.writeRequested,
    writePerformed: report.writePerformed,
    ideaSha256: report.ideaSha256,
    sourcePaths: pathSummary(sourcePaths),
    testPaths: pathSummary(testPaths),
    inventory: { fileCount: inventory.length, totalBytes: inventory.reduce((sum, file) => sum + file.byteLength, 0), sha256: canonicalJsonSha256V2(inventory) },
    sourceCommit: report.sourceCommit ?? null,
    sourceTree: report.sourceTree ?? null,
    planPath: report.planPath ?? null,
    planSha256: report.planSha256 ?? null,
    executionStatus: report.executionStatus ?? null,
    blockers: report.blockers,
    outputLocationBound: false,
    canonicalOutput: false,
    evidenceBoundary: report.evidenceBoundary,
    reportSha256: report.reportSha256,
    fullReport: { available: true, instruction: "Rerun the same command without --brief for the complete canonical JSON report." }
  };
  let bytes = Buffer.from(`${canonicalJsonV2(summary)}\n`, "utf8");
  if (bytes.length > BRIEF_MAX_OUTPUT_BYTES) bytes = Buffer.from(`${canonicalJsonV2({ ...summary, sourcePaths: { ...summary.sourcePaths, items: [] }, testPaths: { ...summary.testPaths, items: [] }, budgetFallback: { applied: true, reason: "PATH_DETAILS_EXCEEDED_BRIEF_OUTPUT_BUDGET", maximumOutputBytes: BRIEF_MAX_OUTPUT_BYTES } })}\n`, "utf8");
  if (bytes.length > BRIEF_MAX_OUTPUT_BYTES) throw new Error("project materialization brief fallback exceeds its complete output budget");
  process.stdout.write(bytes);
}

function pathSummary(paths) {
  return { count: paths.length, sha256: canonicalJsonSha256V2(paths), items: paths };
}

function readInputBytes(inputPath, maximumBytes, label) {
  const resolved = path.resolve(inputPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) throw Object.assign(new Error(`${label} must be a bounded regular non-symlink file`), { code: "PROJECT_AUTHORING_INPUT_INVALID" });
  return fs.readFileSync(resolved);
}

function resolveNewOutput(outputPath) {
  const requested = path.resolve(outputPath);
  const parent = fs.realpathSync(path.dirname(requested));
  const resolved = path.join(parent, path.basename(requested));
  if (fs.existsSync(resolved)) throw Object.assign(new Error("--output must name a new directory"), { code: "PROJECT_OUTPUT_EXISTS" });
  return resolved;
}

function writeOutputFile(root, relativePath, bytes) {
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) throw Object.assign(new Error("unsafe generated output path"), { code: "PROJECT_OUTPUT_PATH_INVALID" });
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function writeOutputJson(root, relativePath, value) {
  writeOutputFile(root, relativePath, Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"));
}

function git(root, args) {
  const result = childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, env: { PATH: process.env.PATH ?? "", HOME: path.join(root, ".git", "programmable-home"), LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" } });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr.trim() || `git ${args[0]} failed`), { code: "PROJECT_LOCAL_GIT_FAILED" });
  return result.stdout.trim();
}

function fileInventory(files) {
  return [...files].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256Bytes(bytes), byteLength: bytes.length })).sort((left, right) => left.path.localeCompare(right.path));
}

function customPackageLock(applicationId) {
  const lock = JSON.parse(fs.readFileSync(path.join(referenceKernelRoot, "package-lock.json"), "utf8"));
  lock.name = applicationId;
  lock.version = "0.0.0";
  lock.packages[""].name = applicationId;
  lock.packages[""].version = "0.0.0";
  lock.packages[""].description = "Intent-bound custom Uniswap v4 implementation.";
  return lock;
}

function customPackageJson(applicationId, dependencies) {
  return {
    name: applicationId,
    version: "0.0.0",
    private: true,
    description: "Intent-bound custom Uniswap v4 implementation.",
    license: "MIT",
    scripts: { build: "forge build --offline", test: "forge test --offline" },
    dependencies
  };
}

function bindings(files) {
  return files.map(({ path: filePath, bytes }) => ({ path: filePath, sha256: sha256Bytes(bytes), byteLength: bytes.length }));
}

function command(id, argv) {
  return { id, argv, status: "NOT_RUN", externalActionsPerformed: [] };
}

function foundryToml(compilerVersion) {
  return `[profile.default]\nsrc = "src"\ntest = "test"\nout = "out"\ncache_path = "cache"\nlibs = ["node_modules"]\nsolc_version = "${compilerVersion}"\nevm_version = "cancun"\noffline = true\noptimizer = true\noptimizer_runs = 1000\nvia_ir = false\nbytecode_hash = "none"\ncbor_metadata = false\nffi = false\nfs_permissions = []\n\n[profile.default.fuzz]\nruns = 256\n\n[profile.default.invariant]\nruns = 64\ndepth = 32\nfail_on_revert = false\n`;
}

function architectureEvidence(applicationId, marketRef, ideaSha256) {
  return `# Architecture evidence\n\nApplication: \`${applicationId}\`  \nMarket: \`${marketRef}\`  \nIntent: \`${ideaSha256}\`\n\nThe complete supplied custom source and tests are byte-bound in the local build plan. Architecture is not restricted to bundled profiles. Launch policy is evaluated later for submission and does not decide which technically viable source may be authored.\n\nNo command, network request, deployment, approval, audit, publication, Registry write, or launch was performed.\n`;
}

function readme(applicationId, marketRef, ideaSha256) {
  return `# ${applicationId}\n\nIdea-bound custom tradable Uniswap v4 implementation for \`${marketRef}\`. Intent SHA-256: \`${ideaSha256}\`.\n\nCustom tradable source is not restricted to bundled profiles or templates. The Builder may implement any technically viable architecture and preserve it with tests. Run \`npm ci --ignore-scripts --no-audit --no-fund\` in an authorized sandbox, then \`forge test --offline\`.\n\nLaunch policy is checked at submission time. This source repository is **NOT_SUBMITTED** and **NOT_APPROVED** and makes no audit, deployment, production, publication, Registry, or launch claim.\n`;
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8");
}

const MIT_LICENSE = `MIT License\n\nCopyright (c) 2026 Programmable\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
