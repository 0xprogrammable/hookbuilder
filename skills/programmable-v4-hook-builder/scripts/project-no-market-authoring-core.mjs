import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

import { compareUtf8, assertSafeVisibleText } from "./build-profile-catalog.mjs";
import { inspectBuildProfiles } from "./build-profile-core.mjs";
import { canonicalJsonSha256V2 } from "./canonical-json-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import { canonicalJson } from "./open-world-v2-primitives.mjs";
import { projectArtifactSha256 } from "./project-contracts-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_TREE_FILES = 64;
const MAX_TOTAL_FILES = 128;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 2_000_000;
const MAX_SURFACE_FILES = 1_024;
const MAX_SURFACE_FILE_BYTES = 16_000_000;
const MAX_SURFACE_TOTAL_BYTES = 64_000_000;
const MAX_SURFACE_DEPTH = 32;
const GENERATED_SURFACE_CONFIG = "programmable-surface.json";
const rejectedSurfaceDirectories = new Set([".git", ".hg", ".programmable", ".svn", "broadcast", "build", "cache", "coverage", "dist", "node_modules", "out", "target", "vendor"]);
const rejectedSurfaceSecretNames = new Set([".env", ".netrc", ".npmrc", ".pypirc", "id_ed25519", "id_rsa"]);
const rejectedSurfaceGitControls = new Set([".git", ".git-blame-ignore-revs", ".gitattributes", ".gitconfig", ".gitignore", ".gitmodules"]);
const rejectedSurfaceSecretComponents = new Set([".aws", ".azure", ".direnv", ".docker", ".gnupg", ".kube", ".ssh", ".secrets", ".terraform", "credentials", "secrets"]);
const windowsReservedNames = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\..*)?$/iu;
const surfaceProfiles = Object.freeze({
  "foundry-web": Object.freeze({ id: "web", layoutLabel: "web" }),
  "foundry-service": Object.freeze({ id: "service", layoutLabel: "service" }),
  "foundry-game": Object.freeze({ id: "game", layoutLabel: "game" })
});

export const CUSTOM_TRADABLE_PROJECT_PROFILES = Object.freeze(["foundry", ...Object.keys(surfaceProfiles)]);

export function readLocalAuthoringInputs({ projectProfile, sourceRoot, testRoot, sourceContract, testSource } = {}) {
  const rootsRequested = [sourceRoot, testRoot].some((value) => value !== null && value !== undefined);
  const legacyRequested = [sourceContract, testSource].some((value) => value !== null && value !== undefined);
  if (rootsRequested && legacyRequested) throw authoringError("materialize cannot mix source/test roots with legacy source/test files");
  if (rootsRequested) {
    if (projectProfile !== "foundry") throw authoringError("source/test roots require --project-profile foundry");
    if ([sourceRoot, testRoot].some((value) => value === null || value === undefined)) throw authoringError("Foundry materialize requires both --source-root and --test-root");
    const sourceFiles = readAuthoredTree(sourceRoot, "src", false);
    const testFiles = readAuthoredTree(testRoot, "test", true);
    if (sourceFiles.length + testFiles.length > MAX_TOTAL_FILES) throw treeError(`Foundry source and test trees exceed the ${MAX_TOTAL_FILES}-file authoring cap`);
    const totalBytes = [...sourceFiles, ...testFiles].reduce((sum, file) => sum + file.bytes.length, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw treeError(`Foundry source and test trees exceed the ${MAX_TOTAL_BYTES}-byte authoring cap`);
    const compilerVersion = exactSolidityCompilerVersion([...sourceFiles, ...testFiles]);
    assertFoundryTestGates(testFiles);
    return { projectProfile: "foundry", compilerVersion, sourceFiles, testFiles };
  }
  if (projectProfile !== null && projectProfile !== undefined && projectProfile !== "node") throw authoringError("legacy source/test files accept only --project-profile node");
  if ([sourceContract, testSource].some((value) => value === null || value === undefined)) throw authoringError("materialize requires either Foundry source/test roots or --source-contract and --test-source");
  const sourceInput = readAuthoredModule(sourceContract, false);
  const testInput = readAuthoredModule(testSource, true);
  return {
    projectProfile: "node",
    compilerVersion: null,
    sourceFiles: [{ path: `src/${sourceInput.basename}`, bytes: sourceInput.bytes }],
    testFiles: [{ path: `test/${testInput.basename}`, bytes: testInput.bytes }]
  };
}

export const readNoMarketAuthoringInputs = readLocalAuthoringInputs;

export function normalizeNoMarketAuthoringFiles(files, legacyPath, legacyBytes, requiredPrefix) {
  if (files !== null && (legacyPath !== undefined || legacyBytes !== undefined)) throw new TypeError("authoring file arrays cannot be mixed with legacy file arguments");
  const values = files === null ? [{ path: legacyPath, bytes: legacyBytes }] : files;
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_TREE_FILES) throw new TypeError("authoring files must be a non-empty bounded array");
  const seen = new Set();
  return values.map((value) => {
    const filePath = value?.path;
    const bytes = value?.bytes;
    if (typeof filePath !== "string" || !filePath.startsWith(requiredPrefix) || path.posix.normalize(filePath) !== filePath
      || filePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      || filePath.includes("\\") || filePath.includes("\0")) throw new TypeError("authoring file path is invalid");
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_FILE_BYTES) throw new TypeError("authoring file bytes are invalid");
    if (seen.has(filePath)) throw new TypeError("authoring file path is duplicated");
    seen.add(filePath);
    return { path: filePath, bytes: Buffer.from(bytes) };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export function authorNoMarketRepositoryFilesV1({ applicationId, projectSpec, projectProfile, compilerVersion, sources, tests, submissionPackage }) {
  const files = new Map([...sources, ...tests].map(({ path: filePath, bytes }) => [filePath, Buffer.from(bytes)]));
  const sourcePath = sources[0].path, testPath = tests[0].path;
  const stageTarget = projectProfile === "foundry" ? "foundry.toml" : "package-lock.json";
  const stageTool = `import crypto from "node:crypto";\nimport fs from "node:fs";\nconst stage = process.argv[2];\nconst targets = { install: ${JSON.stringify(stageTarget)}, typecheck: ${JSON.stringify(sourcePath)}, evidence: "evidence/architecture.md" };\nconst target = targets[stage];\nif (!target) throw new Error("unknown stage");\nconst bytes = fs.readFileSync(target);\nif (bytes.length === 0) throw new Error("empty required artifact");\nprocess.stdout.write(stage + ":" + target + ":sha256:" + crypto.createHash("sha256").update(bytes).digest("hex") + "\\n");\n`;
  files.set("tools/project-stage.mjs", Buffer.from(stageTool));
  if (projectProfile === "node") {
    const simulationTool = `const moduleValue = await import(new URL(${JSON.stringify(`../${sourcePath}`)}, import.meta.url));\nif (Object.keys(moduleValue).length === 0) throw new Error("source contract exports no behavior");\nprocess.stdout.write("simulation:module-load-and-export-boundary:ok\\n");\n`;
    const packageJson = { name: applicationId, version: "0.0.0", private: true, type: "module", license: "MIT", scripts: { test: `node --test ${testPath}` } };
    const packageLock = { name: applicationId, version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: applicationId, version: "0.0.0", license: "MIT" } } };
    files.set("tools/project-simulation.mjs", Buffer.from(simulationTool));
    files.set("package.json", jsonBytes(packageJson));
    files.set("package-lock.json", jsonBytes(packageLock));
  } else {
    files.set("foundry.toml", Buffer.from(`[profile.default]\nsrc = "src"\ntest = "test"\nout = "out"\nlibs = ["lib"]\nsolc_version = "${compilerVersion}"\noffline = true\nffi = false\nfs_permissions = []\noptimizer = true\noptimizer_runs = 200\n`));
  }
  files.set(".gitignore", Buffer.from(`${projectProfile === "node" ? "node_modules/\n" : "cache/\nout/\n"}.programmable/repository-plan.materializing.v1.json\n.programmable/project-repair-attempt-*.v1.json\n`));
  files.set("deploy/local-service.json", jsonBytes({ schemaVersion: "1.0.0", status: "LOCAL_REFERENCE_NOT_DEPLOYED", applicationId, networkAccessed: false, externalActionsPerformed: [] }));
  files.set("evidence/architecture.md", Buffer.from("# Architecture evidence\n\nThe supplied source and tests are byte-bound as one local no-market reference. No token, market, pool, hook, quote, execution route, deployment, approval, or audit is claimed.\n"));
  files.set("README.md", Buffer.from(`# ${applicationId}\n\nIdea-bound local no-market reference output. Intent SHA-256: ${projectSpec.intent.sha256}.\n\nRun \`${projectProfile === "foundry" ? "forge test --offline" : "npm test"}\` for the supplied behavioral tests. This repository is not an approval, audit, deployment, or production claim.\n`));
  files.set("GITHUB-SUBMISSION.md", Buffer.from("# GitHub submission handoff\n\nstatus: NOT_SUBMITTED\nrequiresHumanConfirmation: true\n\nA public Application V3 transport cannot be authored until a real GitHub numeric repository ID, canonical repository URI, commit object ID, and tree object ID exist. This local output performs no GitHub write, submission, publication, approval, or launch action.\n"));
  files.set("LICENSE", Buffer.from(MIT_LICENSE));
  for (const [relativePath, bytes] of submissionPackage.files) files.set(`submission/${relativePath}`, Buffer.from(bytes));
  return files;
}

export function authorNoMarketRepositoryPlanV1({ projectSpec, productGraph, architectureCandidates, files, projectProfile, sourcePaths, testPaths }) {
  const artifact = (id, artifactPath, kind) => ({ id, path: artifactPath, kind, systemRefs: ["service-component"], required: true, status: "verified", sha256: sha256Bytes(files.get(artifactPath)), byteLength: files.get(artifactPath).length });
  const planned = (id, artifactPath, kind, systemRefs = ["service-component"]) => ({ id, path: artifactPath, kind, systemRefs, required: true, status: "planned", sha256: null, byteLength: null });
  const receipt = (id) => planned(`${id}-receipt`, `.programmable/command-receipts/${id}.v1.json`, "command-receipt");
  const command = (id, kind, argv, timeoutMs = 30000) => ({ id, kind, argv, cwd: ".", required: true, timeoutMs, executionPolicy: { networkAccess: "forbidden", externalWrites: false } });
  const commands = projectProfile === "node" ? nodeCommands(command, sourcePaths[0], testPaths[0]) : foundryCommands(command);
  const submissionPaths = [...files.keys()].filter((filePath) => filePath.startsWith("submission/")).sort();
  return {
    schemaVersion: "1.0.0", applicationId: projectSpec.applicationId, revision: projectSpec.revision,
    projectSpecSha256: projectArtifactSha256(projectSpec), architectureCandidatesSha256: projectArtifactSha256(architectureCandidates), productGraphSha256: projectArtifactSha256(productGraph), selectedArchitectureId: architectureCandidates.selection.candidateId,
    repository: { root: ".", branch: null, headCommit: null }, completionStatus: "materializing",
    artifacts: {
      source: [...sourcePaths.map((artifactPath, index) => artifact(`source-${String(index + 1).padStart(3, "0")}`, artifactPath, "application-source")), artifact("stage-tool", "tools/project-stage.mjs", "verification-source"), ...(projectProfile === "node" ? [artifact("simulation-tool", "tools/project-simulation.mjs", "simulation-source")] : [])],
      configuration: [artifact("gitignore", ".gitignore", "repository-configuration"), artifact(projectProfile === "node" ? "package-configuration" : "foundry-configuration", projectProfile === "node" ? "package.json" : "foundry.toml", "repository-configuration")],
      dependencyLocks: projectProfile === "node" ? [artifact("dependency-lock", "package-lock.json", "dependency-lock")] : [planned("project-toolchain-lock", ".programmable/project-toolchain-lock.v1.json", "project-toolchain-lock", ["local-kernel", "service-component"])],
      tests: testPaths.map((artifactPath, index) => artifact(`test-${String(index + 1).padStart(3, "0")}`, artifactPath, "unit-test")),
      deploymentInputs: [artifact("local-deployment-input", "deploy/local-service.json", "service-deployment-input")],
      evidence: [artifact("architecture-evidence", "evidence/architecture.md", "architecture-evidence"), ...commands.map(({ id }) => receipt(id))],
      documentation: [artifact("readme", "README.md", "readme"), artifact("github-submission-handoff", "GITHUB-SUBMISSION.md", "submission-transport-plan"), artifact("mit-license", "LICENSE", "license"), ...submissionPaths.map((artifactPath, index) => artifact(`submission-package-${String(index + 1).padStart(2, "0")}`, artifactPath, artifactPath.endsWith("submission.v2.json") ? "submission-v2" : "submission-package-artifact"))]
    },
    tradeCapability: { applicability: "no-market", markets: [] }, v4HookSemanticContracts: [], commands, commandResults: [],
    completionClaim: { scope: "local-repository-evidence-only", approvalCreated: false, auditClaimed: false, productionClaimed: false, externalActionsPerformed: [] },
    authorization: { approval: false, signature: false, deployment: false, publication: false, execution: false, registryWrite: false }
  };
}

function nodeCommands(command, sourcePath, testPath) {
  return [
    command("install-command", "install", ["node", "tools/project-stage.mjs", "install"]), command("build-command", "build", ["node", "--check", sourcePath]),
    command("typecheck-command", "typecheck", ["node", "tools/project-stage.mjs", "typecheck"]), command("lint-command", "lint", ["node", "--check", testPath]),
    command("simulation-command", "simulation", ["node", "tools/project-simulation.mjs"]), command("test-command", "test", ["node", "--test", "--test-reporter=dot", testPath]),
    command("evidence-command", "evidence", ["node", "tools/project-stage.mjs", "evidence"])
  ];
}

function foundryCommands(command) {
  const forge = (id, kind, args, timeout = 600000) => command(id, kind, ["forge", ...args], timeout);
  return [
    command("install-command", "install", ["node", "tools/project-stage.mjs", "install"]), forge("build-command", "build", ["build", "--offline"]),
    forge("typecheck-command", "typecheck", ["build", "--offline", "--skip", "test"]), forge("lint-command", "lint", ["fmt", "--check"], 300000),
    forge("simulation-command", "simulation", ["test", "--offline", "--match-test", "testSimulation"]), forge("test-command", "test", ["test", "--offline"]),
    command("evidence-command", "evidence", ["node", "tools/project-stage.mjs", "evidence"]), forge("fuzz-command", "fuzz", ["test", "--offline", "--match-test", "testFuzz"]),
    forge("invariant-command", "invariant", ["test", "--offline", "--match-test", "invariant"]), forge("gas-command", "gas", ["test", "--offline", "--gas-report"]),
    forge("code-size-command", "code-size", ["build", "--offline", "--sizes"]), forge("deployment-test-command", "deployment-test", ["test", "--offline", "--match-test", "testDeployment"])
  ];
}

function readAuthoredTree(inputRoot, outputPrefix, testTree) {
  const requestedRoot = path.resolve(inputRoot);
  const rootStat = fs.lstatSync(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw treeError("authoring root must be a real non-symlink directory");
  const root = fs.realpathSync(requestedRoot), files = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(entry.name) || [".git", ".programmable"].includes(entry.name)) throw treeError(`authoring tree contains an unsafe path segment: ${entry.name}`);
      const absolute = path.join(directory, entry.name), relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw treeError(`authoring tree contains a symbolic link: ${relative}`);
      if (stat.isDirectory()) { visit(absolute, relative); continue; }
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FILE_BYTES) throw treeError(`authoring tree file is not a bounded regular file: ${relative}`);
      if (!relative.endsWith(".sol")) throw treeError(`Foundry authoring trees accept only Solidity files: ${relative}`);
      files.push({ path: `${outputPrefix}/${relative}`, bytes: readStableTreeFile(root, absolute, relative, stat) });
      if (files.length > MAX_TREE_FILES) throw treeError(`authoring tree exceeds the ${MAX_TREE_FILES}-file per-tree cap`);
    }
  };
  visit(root);
  const solidityPaths = files.filter(({ path: filePath }) => filePath.endsWith(".sol")).map(({ path: filePath }) => filePath);
  if (solidityPaths.length === 0 || (testTree && !solidityPaths.some((filePath) => filePath.endsWith(".t.sol")))) throw treeError(testTree ? "Foundry test root requires at least one *.t.sol file" : "Foundry source root requires at least one *.sol file");
  return files;
}

function readStableTreeFile(root, absolute, relative, stat) {
  const real = fs.realpathSync(absolute);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw treeError(`authoring tree file escapes its root: ${relative}`);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw treeError(`authoring tree file changed before it was bound: ${relative}`);
    bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw treeError(`authoring tree file changed while it was read: ${relative}`);
  } finally { fs.closeSync(descriptor); }
  const pathAfter = fs.lstatSync(absolute);
  if (pathAfter.isSymbolicLink() || pathAfter.dev !== stat.dev || pathAfter.ino !== stat.ino || pathAfter.size !== stat.size || pathAfter.mtimeMs !== stat.mtimeMs || pathAfter.ctimeMs !== stat.ctimeMs) throw treeError(`authoring tree file changed after it was bound: ${relative}`);
  return bytes;
}

function exactSolidityCompilerVersion(files) {
  const versions = new Set();
  for (const { path: filePath, bytes } of files.filter(({ path: candidatePath }) => candidatePath.endsWith(".sol"))) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const matches = [...text.matchAll(/^\s*pragma\s+solidity\s+(?:=\s*)?(0\.[0-9]+\.[0-9]+)\s*;\s*$/gmu)];
    if (matches.length !== 1) throw treeError(`Foundry Solidity file requires one exact compiler pragma: ${filePath}`);
    versions.add(matches[0][1]);
  }
  if (versions.size !== 1) throw treeError("Foundry Solidity files must share one exact compiler version");
  return [...versions][0];
}

function assertFoundryTestGates(files) {
  const text = files.map(({ bytes }) => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).join("\n");
  const required = ["testSimulation", "testFuzz", "invariant", "testDeployment"];
  const missing = required.filter((prefix) => !new RegExp(`\\bfunction\\s+${prefix}[A-Za-z0-9_]*\\s*\\(`, "u").test(text));
  if (missing.length > 0) throw treeError(`Foundry test root is missing required gate functions: ${missing.join(", ")}`);
}

function readAuthoredModule(inputPath, testSource) {
  const bytes = readRegularInput(inputPath, testSource ? "test source" : "source contract"), basename = path.basename(inputPath);
  const pattern = testSource ? /^[a-z0-9]+(?:-[a-z0-9]+)*\.test\.mjs$/u : /^[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u;
  if (!pattern.test(basename)) throw authoringError(testSource ? "--test-source basename must be a lowercase *.test.mjs file" : "--source-contract basename must be a lowercase *.mjs file");
  if (testSource && !bytes.toString("utf8").includes("node:test")) throw authoringError("--test-source must use node:test");
  return { basename, bytes };
}

function readRegularInput(inputPath, label) {
  const resolved = path.resolve(inputPath), stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FILE_BYTES) throw Object.assign(new Error(`${label} must be a bounded regular non-symlink file`), { code: "PROJECT_AUTHORING_INPUT_INVALID" });
  return fs.readFileSync(resolved);
}

export function readCustomTradableSurface({ projectProfile, surfaceRoot } = {}) {
  if (projectProfile === "foundry") {
    if (surfaceRoot !== null && surfaceRoot !== undefined) throw surfaceOptionsError("foundry custom tradable materialize does not accept --surface-root");
    return null;
  }
  const specification = surfaceProfiles[projectProfile];
  if (specification === undefined) throw surfaceOptionsError(`--project-profile must be ${CUSTOM_TRADABLE_PROJECT_PROFILES.join(", ")}`);
  if (surfaceRoot === null || surfaceRoot === undefined) throw surfaceOptionsError(`${projectProfile} custom tradable materialize requires --surface-root`);
  const frozenInput = readSurfaceTree(surfaceRoot);
  const inputFiles = frozenInput.files;
  const detection = inspectFrozenSurfaceBuildProfiles(inputFiles);
  const buildProfiles = detection.profiles
    .filter(({ projectRoot, status, id }) => projectRoot === "." && status === "recognized" && id !== "foundry")
    .map(({ id, label, profileDigest, projectRoot, status, manifests, locks, pins, suggestedChecks, packageManager, yarnGeneration }) => ({
      id, label, profileDigest, projectRoot, status, manifests, locks, pins, suggestedChecks,
      ...(packageManager ? { packageManager } : {}),
      ...(yarnGeneration ? { yarnGeneration } : {})
    }))
    .sort((left, right) => compareUtf8(left.id, right.id));
  const blockingFindings = detection.findings.filter(({ code }) => code !== "SCAN_BOUND_REACHED" || detection.scan.entryLimitReached);
  if (blockingFindings.length > 0 || buildProfiles.length === 0) {
    throw Object.assign(new Error("surface root requires one complete root-bound non-Foundry build profile, caller-supplied lock bytes, and no unresolved scan findings"), {
      code: "PROJECT_SURFACE_BUILD_PROFILE_UNRESOLVED",
      findings: blockingFindings.map(({ code, profileId = null, projectRoot = null }) => ({ code, profileId, projectRoot }))
    });
  }
  const outputRoot = `surfaces/${specification.id}`;
  const mapped = inputFiles.map(({ path: inputPath, bytes, mode }) => ({ path: `${outputRoot}/${inputPath}`, inputPath, bytes, mode }));
  const tests = mapped.filter(({ inputPath }) => isSurfaceTestPath(inputPath));
  const configurationPaths = new Set(buildProfiles.flatMap(({ manifests, locks }) => [...manifests, ...locks]));
  const configuration = mapped.filter(({ inputPath }) => configurationPaths.has(inputPath));
  const sources = mapped.filter(({ inputPath }) => !isSurfaceTestPath(inputPath) && !configurationPaths.has(inputPath));
  if (sources.length === 0 || tests.length === 0 || configuration.length === 0) {
    throw Object.assign(new Error("surface root must contain source, tests, build configuration, and caller-supplied dependency lock bytes"), { code: "PROJECT_SURFACE_TREE_INCOMPLETE" });
  }
  const inventory = surfaceBindings(mapped);
  const normalizedProfiles = buildProfiles.map((profile) => ({
    ...profile,
    manifests: profile.manifests.map((filePath) => `${outputRoot}/${filePath}`),
    locks: profile.locks.map((filePath) => `${outputRoot}/${filePath}`)
  }));
  const suggestedCommands = normalizedProfiles.flatMap((profile) => profile.suggestedChecks.map((check) => ({
    id: `surface-${specification.id}-${profile.id}-${check.id}`,
    kind: surfaceCommandKind(check.argv), argv: [...check.argv]
  })));
  const commands = uniqueSurfaceCommands([
    ...suggestedCommands,
    ...packageScriptCommands(inputFiles, normalizedProfiles, specification.id)
  ]).map(({ id, kind, argv }) => ({
    id,
    kind,
    argv: [...argv],
    cwd: outputRoot,
    required: true,
    timeoutMs: 600_000,
    executionPolicy: { networkAccess: kind === "install" ? "read-only" : "forbidden", externalWrites: false },
    status: "NOT_RUN",
    externalActionsPerformed: []
  }));
  return Object.freeze({
    id: specification.id,
    kind: "application-surface",
    layoutLabel: specification.layoutLabel,
    projectProfile,
    inputRoot: frozenInput.root,
    inputInventory: surfaceBindings(inputFiles),
    inputInventorySha256: canonicalJsonSha256V2(surfaceBindings(inputFiles)),
    outputRoot,
    files: mapped,
    source: surfaceBindings(sources),
    tests: surfaceBindings(tests),
    configuration: surfaceBindings(configuration),
    inventory,
    inventorySha256: canonicalJsonSha256V2(inventory),
    buildProfiles: normalizedProfiles,
    commands
  });
}

export function renderCustomTradableSurfaceConfig(surface) {
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-custom-tradable-surface",
    status: "SOURCE_TEST_CONFIG_AND_CALLER_LOCK_BYTES_BOUND",
    id: surface.id,
    surfaceKind: surface.kind,
    layoutLabel: surface.layoutLabel,
    semanticValidationPerformed: false,
    lockEvidence: "CALLER_SUPPLIED_LOCK_BYTES_ONLY",
    projectProfile: surface.projectProfile,
    root: surface.outputRoot,
    buildProfiles: surface.buildProfiles,
    source: surface.source,
    tests: surface.tests,
    configuration: surface.configuration,
    inputInventorySha256: surface.inventorySha256,
    execution: { commandsPlanned: surface.commands.length, commandsExecuted: false, externalActionsPerformed: [] },
    authority: { approval: false, deployment: false, publication: false, execution: false, registryWrite: false }
  };
}

export function revalidateCustomTradableSurface(surface) {
  if (surface === null) return true;
  if (typeof surface?.inputRoot !== "string" || !Array.isArray(surface.inputInventory) || typeof surface.inputInventorySha256 !== "string") throw new TypeError("surface revalidation requires a frozen input inventory");
  let observed;
  try { observed = readSurfaceTree(surface.inputRoot); } catch (error) {
    throw Object.assign(new Error(`PROJECT_SURFACE_INPUT_CHANGED: surface input changed after binding: ${error.message}`), { code: "PROJECT_SURFACE_INPUT_CHANGED", cause: error });
  }
  const inventory = surfaceBindings(observed.files);
  if (canonicalJsonSha256V2(inventory) !== surface.inputInventorySha256 || canonicalJson(inventory) !== canonicalJson(surface.inputInventory)) {
    throw Object.assign(new Error("PROJECT_SURFACE_INPUT_CHANGED: surface input changed after binding"), { code: "PROJECT_SURFACE_INPUT_CHANGED" });
  }
  return true;
}

function readSurfaceTree(inputRoot) {
  const requestedRoot = path.resolve(inputRoot);
  let rootStat;
  try { rootStat = fs.lstatSync(requestedRoot); } catch { throw surfaceTreeError("surface root must exist as a real non-symlink directory"); }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw surfaceTreeError("surface root must be a real non-symlink directory");
  const root = fs.realpathSync(requestedRoot), files = [], collisionKeys = new Map();
  let totalBytes = 0;
  const visit = (directory, relativeDirectory = "", depth = 0) => {
    if (depth > MAX_SURFACE_DEPTH) throw surfaceTreeError(`surface tree exceeds the ${MAX_SURFACE_DEPTH}-level depth cap`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name))) {
      try { assertSafeVisibleText(entry.name, "surface path entry", 255); } catch { throw surfaceTreeError(`surface tree contains an unsafe path segment: ${entry.name}`); }
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      assertPortableSurfaceSegment(entry.name, relative);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw surfaceTreeError(`surface tree contains a symbolic link: ${relative}`);
      if (surfaceGitControlPath(relative)) throw surfaceTreeError(`surface tree contains a Git control path: ${relative}`);
      if (surfaceSecretRiskPath(relative)) throw surfaceTreeError(`surface tree contains a secret-risk path that cannot enter a generated repository: ${relative}`);
      const collisionKey = relative.normalize("NFC").toLowerCase();
      if (collisionKeys.has(collisionKey)) throw Object.assign(new Error(`surface paths collide portably: ${collisionKeys.get(collisionKey)} and ${relative}`), { code: "PROJECT_SURFACE_TREE_COLLISION" });
      collisionKeys.set(collisionKey, relative);
      if (relativeDirectory === "" && collisionKey === GENERATED_SURFACE_CONFIG) throw Object.assign(new Error(`surface input collides with generated ${GENERATED_SURFACE_CONFIG}`), { code: "PROJECT_SURFACE_TREE_COLLISION" });
      if (entry.isDirectory()) {
        if (rejectedSurfaceDirectories.has(entry.name.toLowerCase())) throw surfaceTreeError(`surface tree contains a generated, dependency, or authority directory: ${relative}`);
        visit(absolute, relative, depth + 1);
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_SURFACE_FILE_BYTES) throw surfaceTreeError(`surface tree file is not a bounded regular file: ${relative}`);
      const bytes = readStableSurfaceFile(root, absolute, relative, stat);
      totalBytes += bytes.length;
      if (totalBytes > MAX_SURFACE_TOTAL_BYTES) throw surfaceTreeError(`surface tree exceeds the ${MAX_SURFACE_TOTAL_BYTES}-byte cap`);
      files.push({ path: relative, bytes, mode: stat.mode & 0o111 ? "100755" : "100644" });
      if (files.length > MAX_SURFACE_FILES) throw surfaceTreeError(`surface tree exceeds the ${MAX_SURFACE_FILES}-file cap`);
    }
  };
  visit(root);
  if (files.length === 0) throw surfaceTreeError("surface root must contain at least one file");
  return { root, files: files.sort((left, right) => compareUtf8(left.path, right.path)) };
}

function inspectFrozenSurfaceBuildProfiles(inputFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-frozen-surface-profile-"));
  try {
    for (const { path: relativePath, bytes, mode } of inputFiles) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { mode: mode === "100755" ? 0o755 : 0o644 });
      fs.chmodSync(target, mode === "100755" ? 0o755 : 0o644);
    }
    return inspectBuildProfiles(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function readStableSurfaceFile(root, absolute, relative, stat) {
  const real = fs.realpathSync(absolute);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw surfaceTreeError(`surface tree file escapes its root: ${relative}`);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || (opened.mode & 0o777) !== (stat.mode & 0o777)) throw surfaceTreeError(`surface tree file changed before it was bound: ${relative}`);
    bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || (after.mode & 0o777) !== (opened.mode & 0o777) || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw surfaceTreeError(`surface tree file changed while it was read: ${relative}`);
  } finally { fs.closeSync(descriptor); }
  const pathAfter = fs.lstatSync(absolute);
  if (pathAfter.isSymbolicLink() || pathAfter.dev !== stat.dev || pathAfter.ino !== stat.ino || pathAfter.size !== stat.size || (pathAfter.mode & 0o777) !== (stat.mode & 0o777) || pathAfter.mtimeMs !== stat.mtimeMs || pathAfter.ctimeMs !== stat.ctimeMs) throw surfaceTreeError(`surface tree file changed after it was bound: ${relative}`);
  return bytes;
}

function isSurfaceTestPath(filePath) {
  const segments = filePath.split("/").map((segment) => segment.toLowerCase());
  const basename = segments.at(-1);
  return segments.some((segment) => ["__tests__", "test", "tests"].includes(segment)) || /(?:^|\.)(?:spec|test)\./u.test(basename);
}

function surfaceSecretRiskPath(filePath) {
  const segments = filePath.split("/").map((segment) => segment.toLowerCase());
  const basename = segments.at(-1);
  return segments.some((segment) => rejectedSurfaceSecretComponents.has(segment)
    || segment === ".env"
    || segment.startsWith(".env.")
    || segment.includes("credential"))
    || rejectedSurfaceSecretNames.has(basename)
    || /\.(?:key|p12|pfx|pem)$/u.test(basename);
}

function surfaceGitControlPath(filePath) {
  return filePath.split("/").some((segment) => rejectedSurfaceGitControls.has(segment.toLowerCase()));
}

function assertPortableSurfaceSegment(segment, relativePath) {
  if (!/^[\x20-\x7e]+$/u.test(segment)
    || /[<>:"\\|?*]/u.test(segment)
    || /^ |[. ]$/u.test(segment)
    || Buffer.byteLength(relativePath, "utf8") > 240
    || windowsReservedNames.test(segment)) {
    throw surfaceTreeError(`surface tree path must use portable ASCII names: ${relativePath}`);
  }
}

function surfaceCommandKind(argv) {
  const value = argv.join(" ").toLowerCase();
  if (/\b(?:ci|install|restore)\b/u.test(value)) return "install";
  if (/\btest\b/u.test(value)) return "test";
  if (/\b(?:build|compile)\b/u.test(value)) return "build";
  return "verify";
}

function packageScriptCommands(inputFiles, profiles, surfaceId) {
  const packageFile = inputFiles.find(({ path: filePath }) => filePath === "package.json");
  const profile = profiles.find(({ packageManager }) => typeof packageManager === "string");
  if (packageFile === undefined || profile === undefined) return [];
  let packageDocument;
  try { packageDocument = parseBoundedStrictJsonBytes(packageFile.bytes, { maxSourceBytes: 1_000_000, maxDepth: 128, maxNodes: 50_000 }); } catch {
    throw Object.assign(new Error("surface package.json must be bounded duplicate-free UTF-8 JSON"), { code: "PROJECT_SURFACE_BUILD_PROFILE_UNRESOLVED" });
  }
  const scripts = packageDocument?.scripts;
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  return ["build", "test"].filter((name) => typeof scripts[name] === "string" && scripts[name].trim() !== "").map((name) => ({
    id: `surface-${surfaceId}-${profile.packageManager}-${name}`,
    kind: name,
    argv: name === "test" ? [profile.packageManager, "test"] : [profile.packageManager, "run", name]
  }));
}

function uniqueSurfaceCommands(commands) {
  const seen = new Set(), ids = new Set(), result = [];
  for (const command of commands) {
    const signature = command.argv.join("\0");
    if (seen.has(signature)) continue;
    if (ids.has(command.id)) throw Object.assign(new Error(`surface command id collides: ${command.id}`), { code: "PROJECT_SURFACE_TREE_COLLISION" });
    seen.add(signature); ids.add(command.id); result.push(command);
  }
  return result;
}

function surfaceBindings(files) {
  return files.map(({ path: filePath, bytes, mode = "100644" }) => ({ path: filePath, sha256: sha256Bytes(bytes), byteLength: bytes.length, mode }));
}

function surfaceOptionsError(message) { return Object.assign(new Error(message), { code: "PROJECT_SURFACE_OPTIONS_INVALID" }); }
function surfaceTreeError(message) { return Object.assign(new Error(message), { code: "PROJECT_SURFACE_TREE_INVALID" }); }

function jsonBytes(value) { return Buffer.from(`${canonicalJson(value)}\n`, "utf8"); }
function authoringError(message) { return Object.assign(new Error(message), { code: "PROJECT_AUTHORING_OPTIONS_INVALID" }); }
function treeError(message) { return Object.assign(new Error(message), { code: "PROJECT_AUTHORING_TREE_INVALID" }); }

const MIT_LICENSE = "MIT License\n\nCopyright (c) 2026 Output Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n";
