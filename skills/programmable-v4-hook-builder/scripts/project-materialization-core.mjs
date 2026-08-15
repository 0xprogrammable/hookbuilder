import fs from "node:fs";
import childProcess from "node:child_process";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import { validateArchitectureCandidates, validateProductGraph, validateProjectSpec } from "./project-contracts-core.mjs";
import {
  CUSTOM_TRADABLE_PROJECT_PROFILES,
  normalizeNoMarketAuthoringFiles,
  readCustomTradableSurface,
  readLocalAuthoringInputs,
  revalidateCustomTradableSurface,
  renderCustomTradableSurfaceConfig
} from "./project-no-market-authoring-core.mjs";
import { createNoMarketProjectAuthoring } from "./project-state-core.mjs";
import { bindTradableReferenceIntent, TRADABLE_REFERENCE_PROFILE_ID } from "./project-tradable-authoring-core.mjs";
import { validateRepositoryPlan } from "./repository-completion-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceKernelRoot = path.join(skillRoot, "assets/reference-kernels/programmable-volume-fee-v2");
const planPath = ".programmable/custom-tradable-build-plan.v1.json";
const receiptPath = ".programmable/custom-tradable-materialization-receipt.v1.json";
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

export function createCustomTradableProjectAuthoring({ applicationId, ideaText, marketRef, compilerVersion, sourceFiles, testFiles, projectProfile = "foundry", surface = null } = {}) {
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
  const fileModes = new Map();
  if ((projectProfile === "foundry") !== (surface === null)) throw new TypeError("custom tradable surface must exactly match its multi-surface project profile");
  if (surface !== null) {
    for (const { path: filePath, bytes, mode } of surface.files) {
      addAuthoredFile(files, filePath, bytes);
      fileModes.set(filePath, mode);
    }
    addAuthoredFile(files, `${surface.outputRoot}/programmable-surface.json`, jsonBytes(renderCustomTradableSurfaceConfig(surface)));
  }
  files.set("package.json", jsonBytes(packageJson));
  files.set("package-lock.json", jsonBytes(packageLock));
  files.set("remappings.txt", fs.readFileSync(path.join(referenceKernelRoot, "remappings.txt")));
  files.set("foundry.toml", Buffer.from(foundryToml(compilerVersion)));
  files.set(".gitignore", Buffer.from("node_modules/\ncache/\nout/\nbroadcast/\nsurfaces/*/node_modules/\nsurfaces/*/build/\nsurfaces/*/dist/\nsurfaces/*/coverage/\n.programmable/custom-tradable-materialization-receipt.v1.json\n.programmable/project-repair-attempt-*.v1.json\n"));
  files.set("LICENSE", Buffer.from(MIT_LICENSE));
  files.set("evidence/architecture.md", Buffer.from(architectureEvidence(applicationId, marketRef, sha256Bytes(ideaBytes), projectProfile, surface)));
  files.set("GITHUB-SUBMISSION.md", Buffer.from("# GitHub submission handoff\n\nStatus: **NOT_SUBMITTED**.\n\nThis repository is a local custom-tradable implementation. It creates no approval, audit, deployment, publication, Registry write, or launch.\n"));

  const plan = {
    schemaVersion: "1.0.0",
    kind: "custom-tradable-local-build-plan",
    status: "SOURCE_AND_TESTS_MATERIALIZED",
    applicationId,
    classification: "tradable",
    architecture: "custom",
    projectProfile,
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
    surfaces: surface === null ? [] : [{
      id: surface.id,
      kind: surface.kind,
      layoutLabel: surface.layoutLabel,
      root: surface.outputRoot,
      buildProfiles: surface.buildProfiles,
      source: surface.source,
      tests: surface.tests,
      configuration: surface.configuration,
      inventorySha256: surface.inventorySha256,
      generatedConfig: `${surface.outputRoot}/programmable-surface.json`
    }],
    materializationReceipt: { path: receiptPath, status: "LOCAL_TRANSIENT_GENERATED_AFTER_COMMIT" },
    commands: [
      command("install", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], ".", "read-only"),
      command("format", ["forge", "fmt", "--check"]),
      command("build", ["forge", "build", "--offline"]),
      command("test", ["forge", "test", "--offline"]),
      command("fuzz", ["forge", "test", "--offline", "--match-test", "testFuzz"]),
      command("invariant", ["forge", "test", "--offline", "--match-test", "invariant"]),
      command("gas", ["forge", "test", "--offline", "--gas-report"]),
      command("code-size", ["forge", "build", "--offline", "--sizes"]),
      command("deployment-test", ["forge", "test", "--offline", "--match-test", "testDeployment"]),
      ...(surface?.commands ?? [])
    ],
    authorization: { approval: false, signature: false, deployment: false, publication: false, execution: false, registryWrite: false },
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
  const planBytes = jsonBytes(plan);
  files.set(planPath, planBytes);
  files.set("README.md", Buffer.from(readme(applicationId, marketRef, plan.intent.sha256, projectProfile, surface)));
  return {
    files,
    fileModes,
    plan,
    ideaSha256: plan.intent.sha256,
    sourcePaths: sources.map(({ path: filePath }) => filePath),
    testPaths: tests.map(({ path: filePath }) => filePath),
    surface
  };
}

function materializeTradableSelection({ options, ideaBytes, ideaText, outputRoot, failUsage }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.marketRef ?? "") || options.marketRef.length > 120) failUsage("tradable materialize requires --market-ref as a lowercase slug of at most 120 characters");
  if (options.referenceProfile !== null) {
    if (options.referenceProfile !== TRADABLE_REFERENCE_PROFILE_ID) failUsage(`unknown frozen legacy reference profile: ${options.referenceProfile}`);
    if ([options.projectProfile, options.sourceRoot, options.testRoot, options.surfaceRoot, options.sourceContract, options.testSource].some((value) => value !== null)) failUsage("legacy tradable materialize does not accept custom authoring profile, root, source, or test options");
    bindTradableReferenceIntent(ideaText, options.referenceProfile);
    return materializeLegacyTradable({ ...options, ideaBytes, outputRoot });
  }
  if (!CUSTOM_TRADABLE_PROJECT_PROFILES.includes(options.projectProfile) || options.sourceContract !== null || options.testSource !== null) {
    failUsage(`custom tradable materialize requires --project-profile ${CUSTOM_TRADABLE_PROJECT_PROFILES.join(", ")} with --source-root and --test-root`);
  }
  let surface;
  try { surface = readCustomTradableSurface(options); } catch (error) {
    if (error?.code === "PROJECT_SURFACE_OPTIONS_INVALID") failUsage(error.message);
    throw error;
  }
  const { compilerVersion, sourceFiles, testFiles } = readLocalAuthoringInputs({ ...options, projectProfile: "foundry" });
  const authored = createCustomTradableProjectAuthoring({ applicationId: options.applicationId, ideaText, marketRef: options.marketRef, compilerVersion, sourceFiles, testFiles, projectProfile: options.projectProfile, surface });
  return materializeCustomTradable({ ...options, authored, compilerVersion, outputRoot });
}

function materializeNoMarket({ options, ideaText, outputRoot, failUsage }) {
  if (options.marketRef !== null) failUsage("no-market materialize does not accept --market-ref");
  if (options.referenceProfile !== null) failUsage("no-market materialize does not accept --reference-profile");
  if (options.surfaceRoot !== null) failUsage("no-market materialize does not accept --surface-root");
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
  authored.files.set(".programmable/project-spec.v1.json", jsonBytes(authored.projectSpec));
  authored.files.set(".programmable/product-graph.v1.json", jsonBytes(authored.productGraph));
  authored.files.set(".programmable/architecture-candidates.v1.json", jsonBytes(authored.architectureCandidates));
  const common = {
    applicationId: options.applicationId,
    classification: "no-market",
    projectProfile,
    compilerVersion,
    outputRoot,
    ideaSha256: authored.projectSpec.intent.sha256,
    sourcePaths,
    testPaths,
    inventory: fileInventory(authored.files, authored.fileModes),
    blockers: []
  };
  if (!options.write) return emitMaterialization({ ...common, status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", writeRequested: false, writePerformed: false }, options.brief);
  return exportAuthoredRepository({
    authored,
    outputRoot,
    temporaryPrefix: ".programmable-project-materialize-",
    commitMessage: "materialize intent-bound local source",
    beforeExport(root) {
      authored.repositoryPlan.repository.branch = git(root, ["branch", "--show-current"]);
      authored.repositoryPlan.repository.headCommit = git(root, ["rev-parse", "HEAD"]);
    },
    afterClone(root) {
      const transientPath = ".programmable/repository-plan.materializing.v1.json", bytes = jsonBytes(authored.repositoryPlan);
      writeOutputFile(root, transientPath, bytes);
      if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") throw Object.assign(new Error("plan-only export must remain clean with its transient plan ignored"), { code: "PROJECT_PLAN_EXPORT_DIRTY" });
      return [{ path: transientPath, sha256: sha256Bytes(bytes), byteLength: bytes.length, mode: "100644" }];
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

function materializeCustomTradable({ applicationId, marketRef, projectProfile, authored, compilerVersion, outputRoot, write, brief }) {
  const common = {
    applicationId,
    classification: "tradable",
    projectProfile,
    compilerVersion,
    marketRef,
    outputRoot,
    ideaSha256: authored.ideaSha256,
    sourcePaths: authored.sourcePaths,
    testPaths: authored.testPaths,
    inventory: fileInventory(authored.files, authored.fileModes),
    planPath,
    planSha256: canonicalJsonSha256V2(authored.plan),
    receiptPath,
    receiptSha256: null,
    blockers: []
  };
  if (!write) return emitMaterialization({ ...common, status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", operation: "CUSTOM_TRADABLE_SOURCE_DRY_RUN", writeRequested: false, writePerformed: false }, brief);
  const report = { ...common, operation: "CUSTOM_TRADABLE_SOURCE_AND_PLAN_MATERIALIZED" };
  return exportAuthoredRepository({
    authored,
    outputRoot,
    temporaryPrefix: ".programmable-custom-tradable-materialize-",
    commitMessage: "materialize intent-bound custom tradable source",
    afterClone(root, binding) {
      const receipt = customTradableMaterializationReceipt({ authored, applicationId, projectProfile, marketRef, binding });
      writeOutputJson(root, receiptPath, receipt);
      validateCustomTradableMaterializationReceipt(receipt, { repositoryRoot: root });
      if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") throw Object.assign(new Error("custom tradable export must remain clean"), { code: "PROJECT_CUSTOM_TRADABLE_EXPORT_DIRTY" });
      revalidateCustomTradableSurface(authored.surface);
      report.receiptSha256 = canonicalJsonSha256V2(receipt);
      const bytes = jsonBytes(receipt);
      return [{ path: receiptPath, sha256: sha256Bytes(bytes), byteLength: bytes.length, mode: "100644" }];
    },
    report,
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

function exportAuthoredRepository({ authored, outputRoot, temporaryPrefix, commitMessage, beforeExport = () => {}, afterClone = () => {}, report, brief }) {
  const temporaryRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), temporaryPrefix));
  const inventory = fileInventory(authored.files, authored.fileModes);
  let reservation = null, completed = false;
  try {
    for (const [relativePath, bytes] of authored.files) writeOutputFile(temporaryRoot, relativePath, bytes, authored.fileModes?.get(relativePath));
    git(temporaryRoot, ["init", "-q", "-b", "main"]);
    git(temporaryRoot, ["config", "user.name", "Programmable Local Builder"]);
    git(temporaryRoot, ["config", "user.email", "local-builder@example.invalid"]);
    git(temporaryRoot, ["config", "core.autocrlf", "false"]);
    git(temporaryRoot, ["config", "core.safecrlf", "true"]);
    git(temporaryRoot, ["config", "core.attributesFile", "/dev/null"]);
    verifyWorkingInventory(temporaryRoot, inventory);
    stageExactInventory(temporaryRoot, inventory);
    const indexedTree = git(temporaryRoot, ["write-tree"]);
    verifyGitInventory(temporaryRoot, indexedTree, inventory);
    git(temporaryRoot, ["commit", "-qm", commitMessage]);
    beforeExport(temporaryRoot);
    const sourceCommit = git(temporaryRoot, ["rev-parse", "HEAD"]);
    const sourceTree = git(temporaryRoot, ["rev-parse", "HEAD^{tree}"]);
    if (sourceTree !== indexedTree) materializationIntegrityError("committed tree differs from the exact staged inventory");
    verifyGitInventory(temporaryRoot, sourceTree, inventory);
    verifyWorkingInventory(temporaryRoot, inventory);
    reservation = reserveOutputDirectory(outputRoot);
    git(path.dirname(outputRoot), ["clone", "-q", "--no-hardlinks", temporaryRoot, outputRoot]);
    assertOwnedOutputDirectory(outputRoot, reservation);
    git(outputRoot, ["remote", "remove", "origin"]);
    if (git(outputRoot, ["rev-parse", "HEAD"]) !== sourceCommit || git(outputRoot, ["rev-parse", "HEAD^{tree}"]) !== sourceTree) materializationIntegrityError("cloned commit or tree differs from the emitted source binding");
    verifyGitInventory(outputRoot, sourceTree, inventory);
    verifyWorkingInventory(outputRoot, inventory);
    const transientInventory = afterClone(outputRoot, { sourceCommit, sourceTree, inventory }) ?? [];
    verifyGitInventory(outputRoot, sourceTree, inventory);
    verifyWorkingInventory(outputRoot, [...inventory, ...transientInventory].sort((left, right) => comparePaths(left.path, right.path)));
    assertOwnedOutputDirectory(outputRoot, reservation);
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
    completed = true;
  } finally {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (!completed && reservation !== null) removeOwnedOutputDirectory(outputRoot, reservation);
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
    receiptPath: report.receiptPath ?? null,
    receiptSha256: report.receiptSha256 ?? null,
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

function writeOutputFile(root, relativePath, bytes, mode = "100644") {
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) throw Object.assign(new Error("unsafe generated output path"), { code: "PROJECT_OUTPUT_PATH_INVALID" });
  if (!["100644", "100755"].includes(mode)) throw Object.assign(new Error("unsafe generated output mode"), { code: "PROJECT_OUTPUT_MODE_INVALID" });
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { mode: mode === "100755" ? 0o755 : 0o644 });
  fs.chmodSync(target, mode === "100755" ? 0o755 : 0o644);
}

function writeOutputJson(root, relativePath, value) {
  writeOutputFile(root, relativePath, Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"));
}

function git(root, args, { input = undefined, encoding = "utf8", trim = true } = {}) {
  const isolatedArgs = ["-c", "core.autocrlf=false", "-c", "core.attributesFile=/dev/null", "-c", "core.hooksPath=/dev/null", ...args];
  const result = childProcess.spawnSync("git", isolatedArgs, { cwd: root, encoding, input, maxBuffer: 70_000_000, shell: false, env: { PATH: process.env.PATH ?? "", HOME: path.join(root, ".git", "programmable-home"), LANG: "C", LC_ALL: "C", GIT_ATTR_NOSYSTEM: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" } });
  if (result.status !== 0) throw Object.assign(new Error(Buffer.from(result.stderr ?? "").toString("utf8").trim() || `git ${args[0]} failed`), { code: "PROJECT_LOCAL_GIT_FAILED" });
  if (encoding === null) return Buffer.from(result.stdout);
  return trim ? result.stdout.trim() : result.stdout;
}

function fileInventory(files, modes = new Map()) {
  return [...files].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256Bytes(bytes), byteLength: bytes.length, mode: modes?.get(filePath) ?? "100644" })).sort((left, right) => comparePaths(left.path, right.path));
}

function stageExactInventory(root, inventory) {
  const pathspec = Buffer.from(`${inventory.map(({ path: filePath }) => filePath).join("\0")}\0`, "utf8");
  git(root, ["add", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"], { input: pathspec });
}

function verifyGitInventory(root, treeish, expected) {
  const records = git(root, ["ls-tree", "-r", "-z", treeish], { trim: false }).split("\0").filter(Boolean);
  const observed = records.map((record) => {
    const match = /^(100644|100755) blob ([0-9a-f]{40,64})\t([\x20-\x7e]+)$/u.exec(record);
    if (match === null) materializationIntegrityError("Git tree contains a non-regular, non-portable, or unsupported entry");
    const bytes = git(root, ["cat-file", "blob", match[2]], { encoding: null, trim: false });
    return { path: match[3], sha256: sha256Bytes(bytes), byteLength: bytes.length, mode: match[1] };
  }).sort((left, right) => comparePaths(left.path, right.path));
  assertExactInventory(observed, expected, "Git tree");
  return observed;
}

function verifyWorkingInventory(root, expected) {
  const observed = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (relativeDirectory === "" && entry.name === ".git") continue;
      const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolutePath = path.join(directory, entry.name), before = fs.lstatSync(absolutePath);
      if (before.isSymbolicLink() || (!before.isDirectory() && !before.isFile())) materializationIntegrityError(`working tree contains an unsupported entry: ${relativePath}`);
      if (before.isDirectory()) { visit(absolutePath, relativePath); continue; }
      const bytes = fs.readFileSync(absolutePath), after = fs.lstatSync(absolutePath);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || (after.mode & 0o777) !== (before.mode & 0o777)) materializationIntegrityError(`working tree file changed while verified: ${relativePath}`);
      observed.push({ path: relativePath, sha256: sha256Bytes(bytes), byteLength: bytes.length, mode: before.mode & 0o111 ? "100755" : "100644" });
    }
  };
  visit(root);
  observed.sort((left, right) => comparePaths(left.path, right.path));
  assertExactInventory(observed, expected, "working tree");
  return observed;
}

function assertExactInventory(observed, expected, label) {
  if (canonicalJsonV2(observed) !== canonicalJsonV2(expected)) materializationIntegrityError(`${label} does not exactly match the planned path, mode, byte-length, and hash inventory`);
}

function reserveOutputDirectory(outputRoot) {
  try { fs.mkdirSync(outputRoot, { mode: 0o700 }); } catch (error) {
    if (error?.code === "EEXIST") throw Object.assign(new Error("--output must name a new directory"), { code: "PROJECT_OUTPUT_EXISTS" });
    throw error;
  }
  const stat = fs.lstatSync(outputRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) materializationIntegrityError("output reservation is not an owned directory");
  return { dev: stat.dev, ino: stat.ino };
}

function assertOwnedOutputDirectory(outputRoot, reservation) {
  const stat = fs.lstatSync(outputRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== reservation.dev || stat.ino !== reservation.ino) materializationIntegrityError("owned output reservation changed during materialization");
}

function removeOwnedOutputDirectory(outputRoot, reservation) {
  try {
    assertOwnedOutputDirectory(outputRoot, reservation);
    fs.rmSync(outputRoot, { recursive: true, force: true });
  } catch { /* A replaced reservation is not ours to remove. */ }
}

function materializationIntegrityError(message) {
  throw Object.assign(new Error(message), { code: "PROJECT_MATERIALIZATION_INTEGRITY_FAILED" });
}

function comparePaths(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

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

function command(id, argv, cwd = ".", networkAccess = "forbidden") {
  return { id, kind: id, argv, cwd, required: true, timeoutMs: 600_000, executionPolicy: { networkAccess, externalWrites: false }, status: "NOT_RUN", externalActionsPerformed: [] };
}

function foundryToml(compilerVersion) {
  return `[profile.default]\nsrc = "src"\ntest = "test"\nout = "out"\ncache_path = "cache"\nlibs = ["node_modules"]\nsolc_version = "${compilerVersion}"\nevm_version = "cancun"\noffline = true\noptimizer = true\noptimizer_runs = 1000\nvia_ir = false\nbytecode_hash = "none"\ncbor_metadata = false\nffi = false\nfs_permissions = []\n\n[profile.default.fuzz]\nruns = 256\n\n[profile.default.invariant]\nruns = 64\ndepth = 32\nfail_on_revert = false\n`;
}

function architectureEvidence(applicationId, marketRef, ideaSha256, projectProfile, surface) {
  const surfaceText = surface === null ? "No additional application surface was supplied." : `The accepted regular-file tree is byte-and-mode-bound at \`${surface.outputRoot}\`; \`${surface.layoutLabel}\` is an owner-declared layout label, not a semantic product certification.`;
  return `# Architecture evidence\n\nApplication: \`${applicationId}\`  \nMarket: \`${marketRef}\`  \nIntent: \`${ideaSha256}\`\n\nThe complete supplied custom source and tests are byte-bound in the local build plan. ${surfaceText} Architecture is not restricted to bundled profiles. Launch policy is evaluated later for submission and does not decide which technically viable source may be authored.\n\nNo command, network request, deployment, approval, audit, publication, Registry write, or launch was performed.\n`;
}

function readme(applicationId, marketRef, ideaSha256, projectProfile, surface) {
  const surfaceText = surface === null ? "" : ` The accepted regular-file source, tests, configuration, caller-supplied lock bytes and modes are preserved under \`${surface.outputRoot}\` with owner-declared layout label \`${surface.layoutLabel}\`; empty directories are omitted and no web/service/game semantics are certified.`;
  return `# ${applicationId}\n\nIdea-bound custom tradable Uniswap v4 implementation for \`${marketRef}\`. Intent SHA-256: \`${ideaSha256}\`.\n\nCustom tradable source is not restricted to bundled profiles or templates. The Builder may implement any technically viable architecture and preserve it with tests.${surfaceText} All planned commands remain \`NOT_RUN\`; dependency acquisition and candidate execution require an authorized external sandbox.\n\nLaunch policy is checked at submission time. This source repository is **NOT_SUBMITTED** and **NOT_APPROVED** and makes no audit, deployment, production, publication, Registry, or launch claim.\n`;
}

function customTradableMaterializationReceipt({ authored, applicationId, projectProfile, marketRef, binding }) {
  const plan = binding.inventory.find(({ path: filePath }) => filePath === planPath);
  return {
    schemaVersion: "1.0.0",
    kind: "custom-tradable-materialization-receipt",
    status: "LOCAL_SOURCE_BINDING_VERIFIED_NOT_EXECUTED",
    applicationId,
    classification: "tradable",
    projectProfile,
    marketRef,
    intent: authored.plan.intent,
    source: { commit: binding.sourceCommit, tree: binding.sourceTree },
    plan,
    repository: { inventoryProfile: "exact-regular-files-git-modes-v1", emptyDirectories: "OMITTED", files: binding.inventory, inventorySha256: canonicalJsonSha256V2(binding.inventory) },
    surfaces: authored.surface === null ? [] : [{ id: authored.surface.id, kind: authored.surface.kind, layoutLabel: authored.surface.layoutLabel, root: authored.surface.outputRoot, inventorySha256: authored.surface.inventorySha256, semanticValidationPerformed: false, lockEvidence: "CALLER_SUPPLIED_LOCK_BYTES_ONLY" }],
    artifact: { path: receiptPath, tracked: false, ignored: true },
    observations: { commandsExecuted: false, networkAccessed: false, externalWritesPerformed: false, externalActionsPerformed: [] },
    authority: { approval: false, audit: false, deployment: false, publication: false, execution: false, registryWrite: false, launch: false },
    validation: { status: "VERIFIED", profile: "exact-commit-tree-clone-working-files-v1" }
  };
}

export function validateCustomTradableMaterializationReceipt(receipt, { repositoryRoot } = {}) {
  const fail = (message) => { throw Object.assign(new Error(`PROJECT_MATERIALIZATION_RECEIPT_INVALID: ${message}`), { code: "PROJECT_MATERIALIZATION_RECEIPT_INVALID" }); };
  if (receipt?.kind !== "custom-tradable-materialization-receipt" || receipt?.status !== "LOCAL_SOURCE_BINDING_VERIFIED_NOT_EXECUTED" || receipt?.validation?.status !== "VERIFIED") fail("identity or validation status is invalid");
  const commit = git(repositoryRoot, ["rev-parse", "HEAD"]), tree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  if (receipt?.source?.commit !== commit || receipt?.source?.tree !== tree) fail("source commit or tree does not match the emitted repository");
  if (!Array.isArray(receipt?.repository?.files) || receipt.repository.inventorySha256 !== canonicalJsonSha256V2(receipt.repository.files)) fail("repository inventory binding is invalid");
  try { verifyGitInventory(repositoryRoot, tree, receipt.repository.files); } catch (error) { fail(error.message); }
  const plan = receipt.repository.files.find(({ path: filePath }) => filePath === planPath);
  if (canonicalJsonV2(plan) !== canonicalJsonV2(receipt.plan)) fail("plan binding is invalid");
  if (canonicalJsonV2(receipt.artifact) !== canonicalJsonV2({ path: receiptPath, tracked: false, ignored: true })) fail("receipt artifact boundary is invalid");
  const expectedAuthority = { approval: false, audit: false, deployment: false, publication: false, execution: false, registryWrite: false, launch: false };
  if (canonicalJsonV2(receipt.authority) !== canonicalJsonV2(expectedAuthority)) fail("authority boundary is invalid");
  const receiptBytes = jsonBytes(receipt), receiptFile = path.join(repositoryRoot, receiptPath);
  let observedReceipt;
  try { observedReceipt = fs.readFileSync(receiptFile); } catch { fail("receipt file is missing"); }
  if (!observedReceipt.equals(receiptBytes) || git(repositoryRoot, ["check-ignore", "--", receiptPath]) !== receiptPath || git(repositoryRoot, ["ls-files", "--", receiptPath]) !== "") fail("receipt file is not the exact ignored local artifact");
  const workingInventory = [...receipt.repository.files, { path: receiptPath, sha256: sha256Bytes(receiptBytes), byteLength: receiptBytes.length, mode: "100644" }].sort((left, right) => comparePaths(left.path, right.path));
  try { verifyWorkingInventory(repositoryRoot, workingInventory); } catch (error) { fail(error.message); }
  return true;
}

function addAuthoredFile(files, filePath, bytes) {
  if (files.has(filePath)) throw Object.assign(new Error(`authored output path collision: ${filePath}`), { code: "PROJECT_SURFACE_TREE_COLLISION" });
  files.set(filePath, Buffer.from(bytes));
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8");
}

const MIT_LICENSE = `MIT License\n\nCopyright (c) 2026 Programmable\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
