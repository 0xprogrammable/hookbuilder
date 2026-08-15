import test from "node:test";
import {
  assert, childProcess, crypto, fs, os, path, process,
  canonicalJsonSha256V2, canonicalJsonV2, keccak256Hex,
  PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES, PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES,
  createProjectCommandReceipt, executeProjectCommands, projectCommandEnvironmentSha256,
  projectCommandMaximumOutputBytes, sha256Bytes,
  compileProjectBundle, preflightProjectOutput, validateProjectOutput,
  TRADABLE_REFERENCE_PROFILE_ID, bindTradableReferenceIntent,
  ARCHITECTURE_ROLES, PRODUCT_GRAPH_NAMES, PROJECT_SPEC_FACETS, projectArtifactSha256,
  validateArchitectureCandidates, validateProductGraph, validateProjectSpec,
  bindLocalReleaseHandoffV1, createNoMarketProjectAuthoring, renderGitHubSubmissionHandoffV1,
  sealProjectState, validateProjectState, validateRepositoryPlan, validateAgainstSchema,
  architectureSnapshotSha256, createOpenWorldDraftPackage, expectedTradeRunnerCallsV1,
  inspectForgeTradeTestRunnerOutputV1, validateV4DeploymentEvidence, canonicalV4PermissionMask,
  TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1, TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1,
  TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1, createApplicableOpenWorldV2PrototypeFixture,
  createNoMarketOpenWorldV2PrototypeFixture, createStandardTradeCapabilityManifestFixtureV1,
  createTradeTestResultFixturesV1, tradeTestRevertDataFixtureV1,
  skillRoot, compilerCli, unifiedCli,
  makeProjectSpec, facetEntry, sourceSpan, makeProductGraph, makeArchitectures,
  makeTradablePlanningBundle, makeArchitectureBundle, makeState, statePayload,
  makePlanningRepositoryPlan, createMaterializedTradableRepository, createCompleteRepository,
  createMaterializedRepository, createUnresolvedOutputFixture, createTradableOutputFixture,
  structuredCloneProjectOutputInput, deterministicTarget, deterministicCallData,
  deterministicReturnData, deterministicSuite, deterministicResult, deterministicResultLog,
  deterministicCommand, deterministicPlan, deterministicSource, deterministicTool,
  commandReceiptSchema, deterministicTradeReceipt, deterministicForgeOutput,
  deterministicRelevantTrace, disabledReleaseActions, writeFile, artifactRecord, git, sha256, slug
} from "./project-compiler-fixture.mjs";
import { validateCustomTradableMaterializationReceipt } from "../../skills/programmable-v4-hook-builder/scripts/project-materialization-core.mjs";
import { readCustomTradableSurface, readLocalAuthoringInputs, revalidateCustomTradableSurface } from "../../skills/programmable-v4-hook-builder/scripts/project-no-market-authoring-core.mjs";
import { readCustomTradableContractConfiguration, revalidateCustomTradableContractConfiguration, validateCustomTradableContractConfiguration } from "../../skills/programmable-v4-hook-builder/scripts/project-contract-configuration-core.mjs";

test("project materialize authors an arbitrary tradable Foundry hook without requiring a bundled profile", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-custom-tradable-authoring-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "mizu-idea.txt");
  const sourceRoot = path.join(parent, "src");
  const testRoot = path.join(parent, "test");
  const output = path.join(parent, "mizu");
  const marker = path.join(parent, "candidate-executed");
  const sourceText = `// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract MizuDynamicFeeHook {\n  function feePips(bool sell, uint128 size, uint128 decayedVolume) external pure returns (uint24) {\n    uint256 pressure = uint256(size) / 1e15 + uint256(decayedVolume) / 1e16;\n    return uint24((sell ? 3_000 : 1_000) + (pressure > 97_000 ? 97_000 : pressure));\n  }\n}\n`;
  const testText = `// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract MizuDynamicFeeHookTest {\n  function testSimulationDirectionalFee() external {}\n  function testFuzzFeeBound(uint128 size, uint128 volume) external { size; volume; }\n  function invariantLiquidityChangesUntaxed() external pure returns (bool) { return true; }\n  function testDeploymentPermissionBits() external {}\n}\n// Candidate bytes are inert during materialization: ${marker}\n`;
  fs.mkdirSync(sourceRoot); fs.mkdirSync(testRoot);
  fs.writeFileSync(ideaPath, "Build Mizu as a canonical Uniswap v4 dynamic LP-fee hook. Buys cost less than sells; the fee is directional, size-sensitive, and decays with recent volume. Liquidity modifications are untaxed.\n");
  fs.writeFileSync(path.join(sourceRoot, "MizuDynamicFeeHook.sol"), sourceText);
  fs.writeFileSync(path.join(testRoot, "MizuDynamicFeeHook.t.sol"), testText);
  const args = [
    unifiedCli, "project", "materialize",
    "--idea-file", ideaPath,
    "--application-id", "mizu",
    "--classification", "tradable",
    "--market-ref", "mizu-eth",
    "--project-profile", "foundry",
    "--contract-config-profile", "foundry-default",
    "--source-root", sourceRoot,
    "--test-root", testRoot,
    "--output", output
  ];

  const dry = childProcess.spawnSync(process.execPath, [...args, "--brief"], { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const dryReport = JSON.parse(dry.stdout);
  assert.equal(dryReport.status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
  assert.equal(dryReport.classification, "tradable");
  assert.equal(dryReport.marketRef, "mizu-eth");
  assert.equal(fs.existsSync(output), false);

  const written = childProcess.spawnSync(process.execPath, [...args, "--write", "--brief"], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const report = JSON.parse(written.stdout);
  assert.equal(report.status, "PROJECT_MATERIALIZATION_PLAN_WRITTEN");
  assert.equal(report.classification, "tradable");
  assert.equal(report.projectProfile, "foundry");
  assert.equal(report.executionStatus, "EXTERNAL_SANDBOX_REQUIRED");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.evidenceBoundary.planCreated, true);
  assert.equal(report.evidenceBoundary.executionCompleted, false);
  assert.equal(report.evidenceBoundary.approvalCreated, false);
  assert.equal(report.evidenceBoundary.auditClaimed, false);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(path.join(output, "src/MizuDynamicFeeHook.sol"), "utf8"), sourceText);
  assert.equal(fs.readFileSync(path.join(output, "test/MizuDynamicFeeHook.t.sol"), "utf8"), testText);
  const plan = JSON.parse(fs.readFileSync(path.join(output, ".programmable/custom-tradable-build-plan.v1.json"), "utf8"));
  assert.equal(plan.kind, "custom-tradable-local-build-plan");
  assert.equal(plan.status, "SOURCE_AND_TESTS_MATERIALIZED");
  assert.equal(plan.marketRef, "mizu-eth");
  assert.equal(plan.launch.status, "NOT_SUBMITTED");
  assert.equal(plan.launch.approval, false);
  assert.equal(plan.launch.policyIsSourceAllowlist, false);
  assert.equal(Object.hasOwn(plan, "referenceProfile"), false);
  assert.equal(plan.contractConfiguration.source, "builder-convenience-default");
  assert.equal(plan.contractConfiguration.semanticValidationPerformed, false);
  assert.deepEqual(plan.source.map(({ path: filePath }) => filePath), ["src/MizuDynamicFeeHook.sol"]);
  assert.deepEqual(plan.tests.map(({ path: filePath }) => filePath), ["test/MizuDynamicFeeHook.t.sol"]);
  assert.match(fs.readFileSync(path.join(output, "README.md"), "utf8"), /custom tradable.*not restricted to bundled profiles/isu);
  assert.equal(fs.existsSync(path.join(output, "submission")), false);
  assert.equal(git(output, ["status", "--porcelain", "--untracked-files=all"]), "");
  const receiptPath = path.join(output, ".programmable/custom-tradable-materialization-receipt.v1.json");
  const receipt = readMultiSurfaceJson(receiptPath);
  assert.equal(validateCustomTradableMaterializationReceipt(receipt, { repositoryRoot: output }), true);
  commitTrackedTestFile(output, "surfaces/game/undeclared.txt");
  const topologyTamper = rewriteReceiptForCurrentHead(output, receipt);
  assert.throws(() => validateCustomTradableMaterializationReceipt(topologyTamper, { repositoryRoot: output }), /PROJECT_MATERIALIZATION_RECEIPT_INVALID.*reserved surfaces namespace/iu);
});

test("custom tradable materializes a complete caller-supplied contract configuration without executing it", (t) => {
  const fixture = createCustomContractConfigurationFixture(t);
  const args = customContractConfigurationArgs(fixture);

  const dry = childProcess.spawnSync(process.execPath, [...args, "--brief"], { encoding: "utf8", shell: false, timeout: 30_000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  assert.equal(JSON.parse(dry.stdout).status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
  assert.equal(fs.existsSync(fixture.output), false);
  assert.equal(fs.existsSync(fixture.marker), false);

  const written = childProcess.spawnSync(process.execPath, [...args, "--write", "--brief"], { encoding: "utf8", shell: false, timeout: 60_000 });
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const report = JSON.parse(written.stdout);
  assert.equal(report.status, "PROJECT_MATERIALIZATION_PLAN_WRITTEN");
  assert.equal(fs.existsSync(fixture.marker), false);
  for (const relativePath of fixture.configurationPaths) {
    assert.deepEqual(fs.readFileSync(path.join(fixture.output, relativePath)), fs.readFileSync(path.join(fixture.contractConfigRoot, relativePath)), `changed ${relativePath}`);
  }
  assert.notEqual(fs.statSync(path.join(fixture.output, "hardhat.config.ts")).mode & 0o111, 0);
  assert.match(fs.readFileSync(path.join(fixture.output, "foundry.toml"), "utf8"), /evm_version = "prague"[\s\S]*via_ir = true/u);
  assert.match(fs.readFileSync(path.join(fixture.output, "remappings.txt"), "utf8"), /custom-v4-core/u);

  const planPath = path.join(fixture.output, ".programmable/custom-tradable-build-plan.v1.json");
  const plan = readMultiSurfaceJson(planPath);
  assert.equal(plan.contractConfiguration.source, "caller-supplied");
  assert.equal(plan.contractConfiguration.root, ".");
  assert.equal(plan.contractConfiguration.inventoryProfile, "exact-regular-files-git-modes-v1");
  assert.equal(plan.contractConfiguration.semanticValidationPerformed, false);
  assert.deepEqual(plan.contractConfiguration.requiredPaths, ["foundry.toml", "package-lock.json", "package.json", "remappings.txt"]);
  assert.deepEqual(plan.contractConfiguration.files.map(({ path: filePath }) => filePath), fixture.configurationPaths);
  assert.equal(plan.contractConfiguration.files.find(({ path: filePath }) => filePath === "hardhat.config.ts").mode, "100755");
  assert.equal(plan.toolchain.configurationInventorySha256, plan.contractConfiguration.inventorySha256);
  assert.equal(plan.toolchain.dependencyLock.sha256, sha256Bytes(fs.readFileSync(path.join(fixture.contractConfigRoot, "package-lock.json"))));
  assert.ok(plan.commands.every(({ status, externalActionsPerformed }) => status === "NOT_RUN" && externalActionsPerformed.length === 0));

  const receiptPath = path.join(fixture.output, ".programmable/custom-tradable-materialization-receipt.v1.json");
  const receiptBytes = fs.readFileSync(receiptPath);
  const receipt = readMultiSurfaceJson(receiptPath);
  assert.deepEqual(receipt.contractConfiguration, plan.contractConfiguration);
  assert.equal(validateCustomTradableMaterializationReceipt(receipt, { repositoryRoot: fixture.output }), true);
  const tampered = structuredClone(receipt);
  tampered.contractConfiguration.files[0].sha256 = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(receiptPath, `${canonicalJsonV2(tampered)}\n`);
  assert.throws(() => validateCustomTradableMaterializationReceipt(tampered, { repositoryRoot: fixture.output }), /PROJECT_MATERIALIZATION_RECEIPT_INVALID.*closed semantic schema/iu);
  fs.writeFileSync(receiptPath, receiptBytes);
  assert.equal(git(fixture.output, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
});

test("custom tradable contract configuration preserves the legacy default and accepts a safe complete caller root", (t) => {
  const fixture = createCustomContractConfigurationFixture(t);
  const withoutChoice = customContractConfigurationArgs(fixture).filter((argument, index, values) => argument !== "--contract-config-root" && values[index - 1] !== "--contract-config-root");
  const implicit = childProcess.spawnSync(process.execPath, withoutChoice, { encoding: "utf8", shell: false, timeout: 30_000 });
  assert.equal(implicit.status, 0, implicit.stderr || implicit.stdout);
  const implicitReport = JSON.parse(implicit.stdout);
  assert.equal(implicitReport.status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
  assert.equal(implicitReport.contractConfigurationSource, "builder-convenience-default");
  assert.equal(fs.existsSync(fixture.output), false);

  fs.rmSync(path.join(fixture.contractConfigRoot, "remappings.txt"));
  const incomplete = childProcess.spawnSync(process.execPath, customContractConfigurationArgs(fixture), { encoding: "utf8", shell: false, timeout: 30_000 });
  assert.equal(incomplete.status, 2, incomplete.stderr || incomplete.stdout);
  assert.match(incomplete.stderr, /PROJECT_CONTRACT_CONFIGURATION_INCOMPLETE.*remappings\.txt/iu);
  assert.equal(fs.existsSync(fixture.output), false);
  fs.writeFileSync(path.join(fixture.contractConfigRoot, "remappings.txt"), "custom-v4-core/=node_modules/@custom/v4-core/src/\n");

  const rejectFile = (relativePath, expected) => {
    const target = path.join(fixture.contractConfigRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "must not enter output\n");
    const result = childProcess.spawnSync(process.execPath, customContractConfigurationArgs(fixture), { encoding: "utf8", shell: false, timeout: 30_000 });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, expected);
    assert.equal(fs.existsSync(fixture.output), false);
    fs.rmSync(target);
  };
  rejectFile(".env", /PROJECT_CONTRACT_CONFIGURATION_INVALID.*secret-risk/iu);
  rejectFile(".gitignore", /PROJECT_CONTRACT_CONFIGURATION_INVALID.*Git control/iu);
  rejectFile("README.md", /PROJECT_CONTRACT_CONFIGURATION_INVALID.*generated output path/iu);
  const accepted = readCustomTradableContractConfiguration({ contractConfigRoot: fixture.contractConfigRoot });
  const collision = { ...accepted, files: [...accepted.files, { ...accepted.files.find(({ path: filePath }) => filePath === "foundry.toml"), path: "Foundry.toml" }] };
  assert.throws(() => validateCustomTradableContractConfiguration(collision), /contract configuration paths collide portably.*foundry\.toml/iu);
  const symlinkTarget = path.join(fixture.parent, "outside.toml");
  fs.writeFileSync(symlinkTarget, "outside = true\n");
  fs.symlinkSync(symlinkTarget, path.join(fixture.contractConfigRoot, "linked.toml"));
  assert.throws(() => readCustomTradableContractConfiguration({ contractConfigRoot: fixture.contractConfigRoot }), /symbolic link/iu);
  fs.rmSync(path.join(fixture.contractConfigRoot, "linked.toml"));
  fs.appendFileSync(path.join(fixture.contractConfigRoot, "foundry.toml"), "# drift\n");
  assert.throws(() => revalidateCustomTradableContractConfiguration(accepted), /PROJECT_CONTRACT_CONFIGURATION_INPUT_CHANGED/iu);
});

test("materializer walkers stream bounded single-directory fanout before retaining entries", (t) => {
  const configuration = createCustomContractConfigurationFixture(t);
  createEmptyDirectoryFanout(configuration.contractConfigRoot, "empty-config", 257);
  const authoring = createCustomContractConfigurationFixture(t);
  createEmptyDirectoryFanout(authoring.sourceRoot, "empty-source", 257);
  const surface = createMultiSurfaceFixture(t, multiSurfaceProfiles[0]);
  createEmptyDirectoryFanout(surface.surfaceRoot, "empty-surface", 257);
  withSynchronousReaddirForbidden(() => {
    assert.throws(
      () => readCustomTradableContractConfiguration({ contractConfigRoot: configuration.contractConfigRoot }),
      /(?:entry|director).*cap/iu
    );
    assert.throws(
      () => readLocalAuthoringInputs({ projectProfile: "foundry", sourceRoot: authoring.sourceRoot, testRoot: authoring.testRoot }),
      /(?:entry|director).*cap/iu
    );
    assert.throws(
      () => readCustomTradableSurface({ projectProfile: "foundry-web", surfaceRoot: surface.surfaceRoot }),
      /(?:entry|director).*cap/iu
    );
  });
});

test("Foundry source and test walkers reject excessive empty-directory depth", (t) => {
  const fixture = createCustomContractConfigurationFixture(t);
  createEmptyDirectoryChain(fixture.sourceRoot, 17);
  assert.throws(
    () => readLocalAuthoringInputs({ projectProfile: "foundry", sourceRoot: fixture.sourceRoot, testRoot: fixture.testRoot }),
    /depth cap/iu
  );
});

test("Foundry source and test trees share one byte budget before retaining 64 large files", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-shared-authoring-byte-budget-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const sourceRoot = path.join(parent, "src"), testRoot = path.join(parent, "test");
  fs.mkdirSync(sourceRoot); fs.mkdirSync(testRoot);
  writeSparseFile(path.join(sourceRoot, "Source.sol"), 1_000_000);
  for (let index = 0; index < 64; index += 1) writeSparseFile(path.join(testRoot, `Huge${String(index).padStart(2, "0")}.t.sol`), 1_000_000);
  const reads = captureDescriptorReadLengths(() => assert.throws(
    () => readLocalAuthoringInputs({ projectProfile: "foundry", sourceRoot, testRoot }),
    /source and test trees exceed the 2000000-byte authoring cap/iu
  ));
  assert.deepEqual(reads, [1_000_000, 1_000_000]);
});

test("Foundry per-tree file cap rejects the 65th file before opening it", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-authoring-file-budget-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const sourceRoot = path.join(parent, "src"), testRoot = path.join(parent, "test");
  fs.mkdirSync(sourceRoot); fs.mkdirSync(testRoot);
  for (let index = 0; index < 65; index += 1) fs.writeFileSync(path.join(sourceRoot, `Source${String(index).padStart(2, "0")}.sol`), "x");
  fs.writeFileSync(path.join(testRoot, "Source.t.sol"), "x");
  const reads = captureDescriptorReadLengths(() => assert.throws(
    () => readLocalAuthoringInputs({ projectProfile: "foundry", sourceRoot, testRoot }),
    /64-file per-tree cap/iu
  ));
  assert.equal(reads.length, 64);
});

test("contract configuration file cap rejects the 257th file before opening it", (t) => {
  const fixture = createCustomContractConfigurationFixture(t);
  for (let index = 0; index < 251; index += 1) fs.writeFileSync(path.join(fixture.contractConfigRoot, `extra-${String(index).padStart(3, "0")}.txt`), "x");
  const reads = captureDescriptorReadLengths(() => assert.throws(
    () => readCustomTradableContractConfiguration({ contractConfigRoot: fixture.contractConfigRoot }),
    /256-file cap/iu
  ));
  assert.equal(reads.length, 256);
});

test("surface aggregate byte cap rejects the 65th megabyte before opening it", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-surface-byte-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 65; index += 1) writeSparseFile(path.join(root, `asset-${String(index).padStart(2, "0")}.bin`), 1_000_000);
  const reads = captureDescriptorReadLengths(() => assert.throws(
    () => readCustomTradableSurface({ projectProfile: "foundry-web", surfaceRoot: root }),
    /surface tree exceeds the 64000000-byte cap/iu
  ));
  assert.equal(reads.length, 64);
  assert.equal(reads.reduce((sum, byteLength) => sum + byteLength, 0), 64_000_000);
});

test("surface file cap rejects the 1025th file before opening it", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-surface-file-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 1_025; index += 1) fs.writeFileSync(path.join(root, `asset-${String(index).padStart(4, "0")}.txt`), "x");
  const reads = captureDescriptorReadLengths(() => assert.throws(
    () => readCustomTradableSurface({ projectProfile: "foundry-web", surfaceRoot: root }),
    /surface tree exceeds the 1024-file cap/iu
  ));
  assert.equal(reads.length, 1_024);
});

test("project materialize writes an idea-specific no-market source plan without executing candidate bytes", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-no-market-authoring-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt");
  const sourcePath = path.join(parent, "cooperative-riddle.mjs");
  const testPath = path.join(parent, "cooperative-riddle.test.mjs");
  fs.writeFileSync(ideaPath, "A cooperative commit and reveal riddle game where every player must reveal before scoring.\n");
  fs.writeFileSync(sourcePath, `import crypto from "node:crypto";\nexport const commitment = (answer, salt) => crypto.createHash("sha256").update(answer + "\\0" + salt).digest("hex");\nexport class CooperativeRiddle {\n  #players; #answer; #commits = new Map(); #reveals = new Map();\n  constructor(players, answerDigest) { if (new Set(players).size !== players.length || players.length < 2) throw new Error("players"); this.#players = [...players]; this.#answer = answerDigest; }\n  commit(player, digest) { if (!this.#players.includes(player) || this.#commits.has(player)) throw new Error("commit"); this.#commits.set(player, digest); }\n  reveal(player, answer, salt) { if (this.#commits.size !== this.#players.length || this.#reveals.has(player) || this.#commits.get(player) !== commitment(answer, salt)) throw new Error("reveal"); this.#reveals.set(player, answer); }\n  score() { if (this.#reveals.size !== this.#players.length) throw new Error("incomplete"); return this.#players.filter((player) => commitment(this.#reveals.get(player), "answer") === this.#answer); }\n}\n`);
  fs.writeFileSync(testPath, `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { commitment, CooperativeRiddle } from "../../src/cooperative-riddle.mjs";\ntest("all players commit and reveal before deterministic scoring", () => { const game = new CooperativeRiddle(["alice", "bob"], commitment("moss", "answer")); game.commit("alice", commitment("moss", "a")); assert.throws(() => game.reveal("alice", "moss", "a")); game.commit("bob", commitment("stone", "b")); game.reveal("alice", "moss", "a"); assert.throws(() => game.score()); game.reveal("bob", "stone", "b"); assert.deepEqual(game.score(), ["alice"]); });\ntest("a reveal must match its commitment", () => { const game = new CooperativeRiddle(["alice", "bob"], commitment("moss", "answer")); game.commit("alice", commitment("moss", "a")); game.commit("bob", commitment("stone", "b")); assert.throws(() => game.reveal("alice", "fern", "a")); });\n`);
  const output = path.join(parent, "riddle-circle");
  const args = [unifiedCli, "project", "materialize", "--idea-file", ideaPath, "--application-id", "riddle-circle", "--classification", "no-market", "--source-contract", sourcePath, "--test-source", testPath, "--output", output];
  const dry = childProcess.spawnSync(process.execPath, args, { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  const dryReport = JSON.parse(dry.stdout);
  assert.equal(dryReport.status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
  assert.equal(fs.existsSync(output), false);

  const dryBrief = childProcess.spawnSync(process.execPath, [...args, "--brief"], { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(dryBrief.status, 0, dryBrief.stderr || dryBrief.stdout);
  assert.equal(dryBrief.stderr, "");
  const dryBriefReport = JSON.parse(dryBrief.stdout);
  assert.equal(dryBriefReport.kind, "project-materialization-brief");
  assert.equal(dryBriefReport.status, dryReport.status);
  assert.equal(dryBriefReport.reportSha256, dryReport.reportSha256);
  assert.deepEqual(dryBriefReport.evidenceBoundary, dryReport.evidenceBoundary);
  assert.deepEqual(dryBriefReport.inventory, {
    fileCount: dryReport.inventory.length,
    totalBytes: dryReport.inventory.reduce((sum, file) => sum + file.byteLength, 0),
    sha256: canonicalJsonSha256V2(dryReport.inventory)
  });
  assert.equal(dryBriefReport.canonicalOutput, false);
  assert.equal(Object.hasOwn(dryBriefReport, "files"), false);
  assert.equal(Buffer.byteLength(dryBrief.stdout, "utf8") <= 2_499, true);
  assert.equal(Buffer.byteLength(dryBrief.stdout, "utf8") < Buffer.byteLength(dry.stdout, "utf8"), true);
  assert.equal(fs.existsSync(output), false);

  const written = childProcess.spawnSync(process.execPath, [...args, "--write"], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const materialization = JSON.parse(written.stdout);
  assert.equal(materialization.status, "PROJECT_MATERIALIZATION_PLAN_WRITTEN");
  assert.equal(materialization.executionStatus, "EXTERNAL_SANDBOX_REQUIRED");
  assert.equal(materialization.canonicalOutput, false);
  assert.equal(materialization.evidenceBoundary.approvalCreated, false);
  assert.equal(materialization.evidenceBoundary.planCreated, true);
  assert.equal(materialization.evidenceBoundary.executionCompleted, false);
  assert.equal(materialization.evidenceBoundary.commandsExecuted, false);
  assert.equal(materialization.evidenceBoundary.networkAccessed, false);
  assert.equal(materialization.evidenceBoundary.externalWritesObserved, false);
  assert.equal(materialization.evidenceBoundary.executionIsolationEnforced, false);
  const authoredPlan = JSON.parse(fs.readFileSync(path.join(output, ".programmable/repository-plan.materializing.v1.json"), "utf8"));
  assert.equal(authoredPlan.completionStatus, "materializing");
  assert.ok(authoredPlan.commands.every(({ argv }) => argv[0] === "node"));
  assert.equal(fs.existsSync(path.join(output, ".programmable/repository-plan.v1.json")), false);
  assert.equal(fs.existsSync(path.join(output, ".programmable/command-receipts")), false);
  assert.equal(fs.existsSync(path.join(output, ".programmable/project-states")), false);
  assert.equal(git(output, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(git(output, ["status", "--porcelain"]), "");
  assert.equal(git(output, ["check-ignore", ".programmable/repository-plan.materializing.v1.json"]), ".programmable/repository-plan.materializing.v1.json");
});

test("project materialize preserves a nested Foundry source and test tree in one inert source-bound plan", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-foundry-authoring-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt");
  const sourceRoot = path.join(parent, "authored-src");
  const testRoot = path.join(parent, "authored-test");
  const output = path.join(parent, "four-player-riddle");
  fs.mkdirSync(path.join(sourceRoot, "libraries"), { recursive: true });
  fs.mkdirSync(path.join(testRoot, "invariant"), { recursive: true });
  fs.writeFileSync(ideaPath, "A four-player signed-hint riddle on Ethereum with no token, pool, swap, liquidity or payment.\n");
  fs.writeFileSync(path.join(sourceRoot, "FourPlayerRiddle.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract FourPlayerRiddle {}\n");
  fs.writeFileSync(path.join(sourceRoot, "libraries", "HintVerifier.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\nlibrary HintVerifier {}\n");
  fs.writeFileSync(path.join(testRoot, "FourPlayerRiddle.t.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract FourPlayerRiddleTest { function testFourPlayers() external {} function testSimulationFourPlayers() external {} function testFuzzHint(bytes32) external {} function testDeploymentLocal() external {} }\n");
  fs.writeFileSync(path.join(testRoot, "invariant", "FourPlayerRiddle.invariant.t.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract FourPlayerRiddleInvariant { function invariantNoValue() external pure returns (bool) { return true; } }\n");

  const result = childProcess.spawnSync(process.execPath, [
    unifiedCli, "project", "materialize",
    "--idea-file", ideaPath,
    "--application-id", "four-player-riddle",
    "--classification", "no-market",
    "--project-profile", "foundry",
    "--source-root", sourceRoot,
    "--test-root", testRoot,
    "--output", output,
    "--write",
    "--brief"
  ], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const materialization = JSON.parse(result.stdout);
  assert.equal(materialization.status, "PROJECT_MATERIALIZATION_PLAN_WRITTEN");
  assert.equal(materialization.kind, "project-materialization-brief");
  assert.equal(materialization.projectProfile, "foundry");
  assert.equal(materialization.compilerVersion, "0.8.24");
  assert.equal(materialization.writeRequested, true);
  assert.equal(materialization.writePerformed, true);
  assert.equal(materialization.canonicalOutput, false);
  assert.equal(materialization.evidenceBoundary.planCreated, true);
  assert.equal(materialization.evidenceBoundary.executionCompleted, false);
  assert.equal(materialization.evidenceBoundary.commandsExecuted, false);
  assert.equal(materialization.fullReport.available, true);
  assert.equal(Buffer.byteLength(result.stdout, "utf8") <= 2_499, true);
  assert.deepEqual(materialization.sourcePaths.items, ["src/FourPlayerRiddle.sol", "src/libraries/HintVerifier.sol"]);
  assert.deepEqual(materialization.testPaths.items, ["test/FourPlayerRiddle.t.sol", "test/invariant/FourPlayerRiddle.invariant.t.sol"]);
  assert.equal(fs.readFileSync(path.join(output, "src", "libraries", "HintVerifier.sol"), "utf8").includes("library HintVerifier"), true);
  const foundryConfig = fs.readFileSync(path.join(output, "foundry.toml"), "utf8");
  assert.match(foundryConfig, /offline = true/u);
  assert.match(foundryConfig, /ffi = false/u);
  assert.match(foundryConfig, /fs_permissions = \[\]/u);
  assert.equal(fs.existsSync(path.join(output, "package.json")), false);
  const productGraph = JSON.parse(fs.readFileSync(path.join(output, ".programmable", "product-graph.v1.json"), "utf8"));
  assert.equal(productGraph.graphs.system.nodes[0].type, "contract");
  assert.equal(productGraph.graphs.component.components[0].type, "game-contract");
  assert.deepEqual(productGraph.graphs.component.components[0].artifactRefs, materialization.sourcePaths.items);
  const submission = JSON.parse(fs.readFileSync(path.join(output, "submission", "submission.v2.json"), "utf8"));
  assert.deepEqual(submission.implementation.sourcePaths, materialization.sourcePaths.items);
  assert.deepEqual(submission.implementation.testPaths, materialization.testPaths.items);
  const handoff = JSON.parse(fs.readFileSync(path.join(output, "GITHUB-SUBMISSION.md"), "utf8").split("\n").slice(2).join("\n"));
  assert.equal(handoff.localVerificationCommands.check, "forge test --offline");
  const plan = JSON.parse(fs.readFileSync(path.join(output, ".programmable", "repository-plan.materializing.v1.json"), "utf8"));
  assert.deepEqual(plan.artifacts.source.filter(({ kind }) => kind === "application-source").map(({ path: artifactPath }) => artifactPath), materialization.sourcePaths.items);
  assert.deepEqual(plan.artifacts.tests.map(({ path: artifactPath }) => artifactPath), materialization.testPaths.items);
  assert.deepEqual(plan.artifacts.dependencyLocks, [{ id: "project-toolchain-lock", path: ".programmable/project-toolchain-lock.v1.json", kind: "project-toolchain-lock", systemRefs: ["local-kernel", "service-component"], required: true, status: "planned", sha256: null, byteLength: null }]);
  assert.equal(fs.existsSync(path.join(output, ".programmable", "project-toolchain-lock.v1.json")), false);
  assert.deepEqual(new Set(plan.commands.map(({ kind }) => kind)), new Set(["install", "build", "typecheck", "lint", "simulation", "test", "evidence", "fuzz", "invariant", "gas", "code-size", "deployment-test"]));
  assert.ok(plan.commands.every(({ executionPolicy }) => executionPolicy.networkAccess === "forbidden" && executionPolicy.externalWrites === false));
  assert.equal(git(output, ["status", "--porcelain", "--untracked-files=all"]), "");
});

test("project materialize brief falls back to bound path digests for the largest accepted Foundry trees", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-foundry-brief-budget-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt");
  const sourceRoot = path.join(parent, "src");
  const testRoot = path.join(parent, "test");
  fs.mkdirSync(sourceRoot); fs.mkdirSync(testRoot);
  fs.writeFileSync(ideaPath, "A bounded local Ethereum state-machine collection with no market.\n");
  for (let index = 0; index < 64; index += 1) {
    const suffix = String(index).padStart(2, "0");
    fs.writeFileSync(path.join(sourceRoot, `BoundedStateMachine${suffix}.sol`), `// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract BoundedStateMachine${suffix} {}\n`);
    const gates = index === 0
      ? " function testSimulationAll() external {} function testFuzzAll(uint256) external {} function invariantAll() external pure returns (bool) { return true; } function testDeploymentAll() external {}"
      : " function testBehavior() external {}";
    fs.writeFileSync(path.join(testRoot, `BoundedStateMachine${suffix}.t.sol`), `// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract BoundedStateMachine${suffix}Test {${gates} }\n`);
  }
  const result = childProcess.spawnSync(process.execPath, [
    unifiedCli, "project", "materialize", "--brief",
    "--idea-file", ideaPath,
    "--application-id", "bounded-state-machine-collection",
    "--classification", "no-market",
    "--project-profile", "foundry",
    "--source-root", sourceRoot,
    "--test-root", testRoot,
    "--output", path.join(parent, "output")
  ], { encoding: "utf8", shell: false, timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const brief = JSON.parse(result.stdout);
  assert.equal(brief.status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
  assert.equal(brief.sourcePaths.count, 64);
  assert.equal(brief.testPaths.count, 64);
  assert.deepEqual(brief.sourcePaths.items, []);
  assert.deepEqual(brief.testPaths.items, []);
  assert.equal(brief.budgetFallback.applied, true);
  assert.equal(brief.budgetFallback.reason, "PATH_DETAILS_EXCEEDED_BRIEF_OUTPUT_BUDGET");
  assert.equal(Buffer.byteLength(result.stdout, "utf8") <= 2_499, true);
});

test("Foundry root materialization rejects symlinks and mixed legacy source flags before writing", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-foundry-authoring-reject-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt");
  const sourceRoot = path.join(parent, "src");
  const testRoot = path.join(parent, "test");
  const outside = path.join(parent, "outside.sol");
  const output = path.join(parent, "output");
  fs.mkdirSync(sourceRoot); fs.mkdirSync(testRoot);
  fs.writeFileSync(ideaPath, "A local no-market Ethereum game.\n");
  fs.writeFileSync(outside, "pragma solidity 0.8.24; contract Outside {}\n");
  fs.symlinkSync(outside, path.join(sourceRoot, "Outside.sol"));
  fs.writeFileSync(path.join(testRoot, "Game.t.sol"), "pragma solidity 0.8.24;\ncontract GameTest {}\n");
  const base = [
    unifiedCli, "project", "materialize", "--idea-file", ideaPath, "--application-id", "safe-game",
    "--classification", "no-market", "--project-profile", "foundry", "--source-root", sourceRoot,
    "--test-root", testRoot, "--output", output, "--write"
  ];
  const symlink = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(symlink.status, 2, symlink.stderr || symlink.stdout);
  assert.match(symlink.stderr, /PROJECT_AUTHORING_TREE_INVALID|symbolic link/u);
  assert.equal(fs.existsSync(output), false);

  fs.rmSync(path.join(sourceRoot, "Outside.sol"));
  fs.writeFileSync(path.join(sourceRoot, "Game.sol"), "pragma solidity 0.8.24;\ncontract Game {}\n");
  const legacySource = path.join(parent, "legacy.mjs");
  fs.writeFileSync(legacySource, "export const legacy = true;\n");
  const mixed = childProcess.spawnSync(process.execPath, [...base, "--source-contract", legacySource], { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(mixed.status, 2, mixed.stderr || mixed.stdout);
  assert.match(mixed.stderr, /cannot mix .*root.*legacy|cannot mix legacy.*root/iu);
  assert.equal(fs.existsSync(output), false);

  fs.writeFileSync(path.join(testRoot, "Game.t.sol"), "pragma solidity 0.8.25;\ncontract GameTest {}\n");
  const compilerDrift = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(compilerDrift.status, 2, compilerDrift.stderr || compilerDrift.stdout);
  assert.match(compilerDrift.stderr, /PROJECT_AUTHORING_TREE_INVALID: Foundry Solidity files must share one exact compiler version/u);
  assert.equal(fs.existsSync(output), false);

  fs.writeFileSync(path.join(testRoot, "Game.t.sol"), "pragma solidity 0.8.24;\ncontract GameTest { function testSimulationGame() external {} function testFuzzGame(uint256) external {} function testDeploymentGame() external {} }\n");
  const missingInvariant = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(missingInvariant.status, 2, missingInvariant.stderr || missingInvariant.stdout);
  assert.match(missingInvariant.stderr, /PROJECT_AUTHORING_TREE_INVALID: Foundry test root is missing required gate functions: invariant/u);
  assert.equal(fs.existsSync(output), false);
});

test("no-market write treats supplied source and tests as bytes and never imports them", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-plan-only-authoring-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt");
  const sourcePath = path.join(parent, "hostile-source.mjs");
  const testPath = path.join(parent, "hostile-source.test.mjs");
  const marker = path.join(parent, "candidate-executed");
  const output = path.join(parent, "output");
  fs.writeFileSync(ideaPath, "A local no-market state machine with a deterministic transition.\n");
  fs.writeFileSync(sourcePath, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "source-ran"); export const state = true;\n`);
  fs.writeFileSync(testPath, `import fs from "node:fs"; import test from "node:test"; fs.writeFileSync(${JSON.stringify(marker)}, "test-ran"); test("fails if run", () => { throw new Error("must not run"); });\n`);
  const result = childProcess.spawnSync(process.execPath, [
    unifiedCli, "project", "materialize",
    "--idea-file", ideaPath,
    "--application-id", "plan-only-state-machine",
    "--classification", "no-market",
    "--source-contract", sourcePath,
    "--test-source", testPath,
    "--output", output,
    "--write"
  ], { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).status, "PROJECT_MATERIALIZATION_PLAN_WRITTEN");
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(output, "src/hostile-source.mjs")), true);
  assert.equal(fs.existsSync(path.join(output, "test/hostile-source.test.mjs")), true);
  assert.equal(git(output, ["status", "--porcelain", "--untracked-files=all"]), "");
});


test("project preflight rejects forged authority and frozen trade-manifest V1 claims while ignoring unrelated JSON", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-adapter-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "config/settings.json", `${canonicalJsonV2({ feature: true })}\n`);
  writeFile(root, "config/trade-capability.v1.json", `${canonicalJsonV2({
    $schema: "urn:programmable:trade-capability-manifest:1.0.0",
    schemaVersion: "1.0.0",
    manifestId: "bilateral-intent-market-local",
    applicationId: "programmable-bilateral-intent-venue",
    marketRef: "token0-token1-local",
    status: "NOT_APPROVED",
    routeType: "canonical-adapter",
    interface: {
      quote: "quote(bytes)",
      quoteSelector: "0xedfa3568",
      buildExecution: "buildExecution(bytes)",
      buildExecutionSelector: "0x21be7c85"
    },
    modes: ["zero-for-one-exact-input", "zero-for-one-exact-output", "one-for-zero-exact-input", "one-for-zero-exact-output"],
    slippageBps: { minimum: 0, maximum: 500 },
    deadline: "required-and-enforced",
    hookData: "required-nonempty-sha256-bound-adapter-consumed",
    funding: "test-permit2-allowance-transfer",
    fee: { quoteCurrency: "token1", totalHundredthsBip: 3000, programmableHundredthsBip: 1000, projectHundredthsBip: 2000 },
    assurance: "LOCAL_TEST_FIXTURE_ONLY_NOT_APPROVED_OR_DEPLOYED"
  })}\n`);
  const run = (repositoryRoot) => childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    repositoryRoot
  ], { encoding: "utf8", shell: false });
  const first = run(root);
  const second = run(root);
  assert.equal(first.status, 1, first.stderr || first.stdout);
  assert.equal(second.status, 1, second.stderr || second.stdout);
  assert.equal(first.stdout, second.stdout);
  const report = JSON.parse(first.stdout);
  assert.equal(report.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.equal(report.canonicalOutput, false);
  assert.deepEqual(report.inventory.map(({ path: artifactPath }) => artifactPath), ["config/trade-capability.v1.json"]);
  assert.ok(report.findings.some(({ code, details }) => (
    code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_INVALID"
    && details.kind === "frozen-trade-capability-manifest-v1"
    && details.validatorCodes.includes("FROZEN_TRADE_MANIFEST_V1_CURRENT_PREFLIGHT_FORBIDDEN_SCHEMA_INVALID")
  )));
  assert.match(report.reportSha256, /^sha256:[0-9a-f]{64}$/u);

  const forgedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-forged-"));
  t.after(() => fs.rmSync(forgedRoot, { recursive: true, force: true }));
  const forgedPayload = {
    schemaVersion: "1.0.0",
    validatorVersion: "1.0.0",
    status: "PROJECT_OUTPUT_VALID",
    artifactHashes: {
      projectSpec: `sha256:${"1".repeat(64)}`,
      productGraph: `sha256:${"2".repeat(64)}`,
      architectureCandidates: `sha256:${"3".repeat(64)}`,
      repositoryPlan: `sha256:${"4".repeat(64)}`,
      projectState: `sha256:${"5".repeat(64)}`,
      submissionPackageInventory: canonicalJsonSha256V2([])
    },
    submissionPackageInventory: { fileCount: 0, totalByteLength: 0, files: [] },
    projection: { applicationId: "forged", tradeFacetEntryRef: "forged", applicability: "no-market", markets: [] }
  };
  const forgedReport = { ...forgedPayload, reportSha256: canonicalJsonSha256V2(forgedPayload) };
  const forged = preflightProjectOutput({
    repositoryRoot: forgedRoot,
    boundPaths: ["project-spec.v1.json", "product-graph.v1.json", "architecture-candidates.v1.json", "repository-plan.v1.json", "project-state.v1.json", "submission.v2.json"],
    outputReport: forgedReport
  });
  assert.equal(forged.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.equal(forged.canonicalOutput, false);
  assert.deepEqual(forged.inventory, []);
  assert.ok(forged.findings.some(({ code }) => code === "PROJECT_PREFLIGHT_CALLER_BINDING_FORBIDDEN"));

  const standardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-standard-"));
  t.after(() => fs.rmSync(standardRoot, { recursive: true, force: true }));
  writeFile(standardRoot, "config/trade-capability.json", `${canonicalJsonV2({
    status: "NOT_APPROVED",
    classification: "tradable",
    marketCount: 1,
    market: { currency0: "native-eth", currency1: "FARM", lpFeePips: 3000, tickSpacing: 60, poolIdSource: "FarmMarket.poolId()" },
    quote: "FarmMarket.quote",
    execution: "FarmMarket.execute (Universal-Router-shaped)",
    permit2: "MockPermit2 locally; pinned canonical Permit2 required for deployment",
    hookData: "abi.encode(uint8(1)) exactly",
    modes: ["eth-farm-exact-input", "eth-farm-exact-output", "farm-eth-exact-input", "farm-eth-exact-output"],
    limits: { slippage: "finite caller bound", deadline: "finite caller timestamp" },
    fee: { policy: "programmable-volume-fee-v2", quoteCurrency: "native-eth", programmableRate: 1000, totalRate: 3000 },
    claims: { audit: false, deployed: false, routeApproved: false, registryAccepted: false }
  })}\n`);
  const standard = run(standardRoot);
  assert.equal(standard.status, 1, standard.stderr || standard.stdout);
  const standardReport = JSON.parse(standard.stdout);
  assert.equal(standardReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.deepEqual(standardReport.inventory.map(({ path: artifactPath }) => artifactPath), ["config/trade-capability.json"]);
  assert.ok(standardReport.findings.some(({ code, details }) => (
    code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_INVALID"
    && details.kind === "frozen-trade-capability-manifest-v1"
    && details.validatorCodes.includes("FROZEN_TRADE_MANIFEST_V1_CURRENT_PREFLIGHT_FORBIDDEN_SCHEMA_INVALID")
  )));
});


test("project preflight keeps a valid unresolved proposal noncanonical and blocks adjacent no-market machine drift", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-preflight-unresolved-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const draft = createOpenWorldDraftPackage({
    applicationId: "community-repair-credits",
    publicIdeaText: "Build community repair credits; I have not decided whether they should ever be tradable or have a pool.",
    sourceRef: "blind-natural-idea"
  });
  for (const file of draft.files) writeFile(root, `programmable/community-repair-credits/${file.path}`, file.content);
  const run = () => childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    root
  ], { encoding: "utf8", shell: false });
  const unresolved = run();
  assert.equal(unresolved.status, 1, unresolved.stderr || unresolved.stdout);
  const draftReport = JSON.parse(unresolved.stdout);
  assert.equal(draftReport.status, "PROJECT_PREFLIGHT_DRAFT_UNRESOLVED");
  assert.equal(draftReport.canonicalOutput, false);
  assert.ok(draftReport.findings.some(({ code }) => code === "PROJECT_PREFLIGHT_DRAFT_UNRESOLVED"));

  const noMarketSpec = makeProjectSpec();
  noMarketSpec.applicationId = "community-repair-credits";
  writeFile(root, ".programmable/project-spec.v1.json", `${canonicalJsonV2(noMarketSpec)}\n`);
  const drifted = run();
  assert.equal(drifted.status, 1, drifted.stderr || drifted.stdout);
  const driftReport = JSON.parse(drifted.stdout);
  assert.equal(driftReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.ok(driftReport.findings.some(({ code, details }) => (
    code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_UNBOUND" && details.kind === "project-spec-v1"
  )));
});

const multiSurfaceProfiles = Object.freeze([
  Object.freeze({ profile: "foundry-web", id: "web", kind: "web-app" }),
  Object.freeze({ profile: "foundry-service", id: "service", kind: "api-service" }),
  Object.freeze({ profile: "foundry-game", id: "game", kind: "game-client" })
]);

test("custom tradable multi-surface profiles bind complete Mizu contract and application trees without executing candidate bytes", (t) => {
  for (const specification of multiSurfaceProfiles) {
    const fixture = createMultiSurfaceFixture(t, specification);
    const args = multiSurfaceMaterializeArgs(fixture, specification.profile);
    const dry = childProcess.spawnSync(process.execPath, [...args, "--brief"], { encoding: "utf8", shell: false, timeout: 30_000 });
    assert.equal(dry.status, 0, dry.stderr || dry.stdout);
    const dryReport = JSON.parse(dry.stdout);
    assert.equal(dryReport.status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
    assert.equal(dryReport.projectProfile, specification.profile);
    assert.equal(fs.existsSync(fixture.output), false);
    assert.equal(fs.existsSync(fixture.marker), false);

    const written = childProcess.spawnSync(process.execPath, [...args, "--write", "--brief"], { encoding: "utf8", shell: false, timeout: 60_000 });
    assert.equal(written.status, 0, written.stderr || written.stdout);
    const report = JSON.parse(written.stdout);
    assert.equal(report.status, "PROJECT_MATERIALIZATION_PLAN_WRITTEN");
    assert.equal(report.projectProfile, specification.profile);
    assert.equal(report.executionStatus, "EXTERNAL_SANDBOX_REQUIRED");
    assert.equal(report.evidenceBoundary.commandsExecuted, false);
    assert.equal(report.evidenceBoundary.approvalCreated, false);
    assert.equal(fs.existsSync(fixture.marker), false);

    const surfaceOutput = path.join(fixture.output, "surfaces", specification.id);
    for (const relativePath of fixture.surfacePaths) {
      assert.deepEqual(fs.readFileSync(path.join(surfaceOutput, relativePath)), fs.readFileSync(path.join(fixture.surfaceRoot, relativePath)), `${specification.profile} changed ${relativePath}`);
    }
    assert.equal(fs.readFileSync(path.join(fixture.output, "src/MizuDynamicFeeHook.sol"), "utf8"), fixture.contractSource);
    assert.equal(fs.readFileSync(path.join(fixture.output, "test/MizuDynamicFeeHook.t.sol"), "utf8"), fixture.contractTest);

    const surfaceConfig = readMultiSurfaceJson(path.join(surfaceOutput, "programmable-surface.json"));
    assert.equal(surfaceConfig.id, specification.id);
    assert.equal(surfaceConfig.kind, "programmable-custom-tradable-surface");
    assert.equal(surfaceConfig.layoutLabel, specification.id);
    assert.equal(surfaceConfig.semanticValidationPerformed, false);
    assert.equal(surfaceConfig.status, "SOURCE_TEST_CONFIG_AND_CALLER_LOCK_BYTES_BOUND");
    assert.ok(surfaceConfig.buildProfiles.some(({ id, status }) => id === "npm" && status === "recognized"));
    assert.ok(surfaceConfig.source.some(({ path: filePath }) => filePath.endsWith("/src/index.mjs")));
    assert.ok(surfaceConfig.tests.some(({ path: filePath }) => filePath.endsWith("/test/index.test.mjs")));
    assert.ok(surfaceConfig.configuration.some(({ path: filePath }) => filePath.endsWith("/package-lock.json")));

    const planPath = path.join(fixture.output, ".programmable/custom-tradable-build-plan.v1.json");
    const plan = readMultiSurfaceJson(planPath);
    assert.equal(plan.projectProfile, specification.profile);
    assert.equal(plan.surfaces.length, 1);
    assert.equal(plan.surfaces[0].id, specification.id);
    assert.equal(plan.surfaces[0].inventorySha256, surfaceConfig.inputInventorySha256);
    assert.ok(plan.commands.some(({ cwd, argv }) => cwd === `surfaces/${specification.id}` && argv[0] === "npm"));
    assert.ok(plan.commands.every(({ status, externalActionsPerformed }) => status === "NOT_RUN" && externalActionsPerformed.length === 0));
    assert.equal(plan.authorization.execution, false);
    assert.equal(plan.launch.approval, false);

    const receiptPath = path.join(fixture.output, ".programmable/custom-tradable-materialization-receipt.v1.json");
    const receipt = readMultiSurfaceJson(receiptPath);
    assert.equal(receipt.status, "LOCAL_SOURCE_BINDING_VERIFIED_NOT_EXECUTED");
    assert.equal(receipt.projectProfile, specification.profile);
    assert.equal(receipt.plan.sha256, sha256Bytes(fs.readFileSync(planPath)));
    assert.equal(receipt.source.commit, report.sourceCommit);
    assert.equal(receipt.source.tree, report.sourceTree);
    assert.equal(receipt.validation.status, "VERIFIED");
    assert.equal(receipt.artifact.path, ".programmable/custom-tradable-materialization-receipt.v1.json");
    assert.equal(receipt.artifact.tracked, false);
    assert.equal(receipt.artifact.ignored, true);
    assert.ok(receipt.repository.files.some(({ path: filePath }) => filePath === ".gitignore"));
    assert.ok(receipt.repository.files.some(({ path: filePath }) => filePath === "foundry.toml"));
    assert.ok(receipt.repository.files.some(({ path: filePath }) => filePath === "package-lock.json"));
    assert.ok(receipt.repository.files.some(({ path: filePath }) => filePath === `surfaces/${specification.id}/programmable-surface.json`));
    assert.deepEqual(git(fixture.output, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").sort(), receipt.repository.files.map(({ path: filePath }) => filePath).sort());
    const executable = receipt.repository.files.find(({ path: filePath }) => filePath === `surfaces/${specification.id}/bin/tool.sh`);
    assert.equal(executable.mode, "100755");
    assert.match(git(fixture.output, ["ls-tree", "HEAD", `surfaces/${specification.id}/bin/tool.sh`]), /^100755 blob /u);
    assert.notEqual(fs.statSync(path.join(surfaceOutput, "bin/tool.sh")).mode & 0o111, 0);
    assert.equal(receipt.observations.commandsExecuted, false);
    assert.equal(receipt.observations.networkAccessed, false);
    assert.equal(receipt.authority.approval, false);
    assert.equal(report.receiptSha256, canonicalJsonSha256V2(receipt));
    assert.equal(git(fixture.output, ["check-ignore", ".programmable/custom-tradable-materialization-receipt.v1.json"]), ".programmable/custom-tradable-materialization-receipt.v1.json");
    assert.equal(git(fixture.output, ["ls-files", ".programmable/custom-tradable-materialization-receipt.v1.json"]), "");
    assert.equal(validateCustomTradableMaterializationReceipt(receipt, { repositoryRoot: fixture.output }), true);
    const receiptBytes = fs.readFileSync(receiptPath);
    const assertSemanticTamperRejected = (mutate) => {
      const tampered = structuredClone(receipt);
      mutate(tampered);
      fs.writeFileSync(receiptPath, `${canonicalJsonV2(tampered)}\n`);
      try {
        assert.throws(() => validateCustomTradableMaterializationReceipt(tampered, { repositoryRoot: fixture.output }), /PROJECT_MATERIALIZATION_RECEIPT_INVALID.*closed semantic schema/iu);
      } finally { fs.writeFileSync(receiptPath, receiptBytes); }
    };
    if (specification.id === "web") {
      assertSemanticTamperRejected((value) => { value.source.tree = "0".repeat(40); });
      assertSemanticTamperRejected((value) => { value.applicationId = "other-application"; });
      assertSemanticTamperRejected((value) => { value.classification = "no-market"; });
      assertSemanticTamperRejected((value) => { value.projectProfile = "foundry"; });
      assertSemanticTamperRejected((value) => { value.marketRef = "other-market"; });
      assertSemanticTamperRejected((value) => { value.intent.sha256 = `sha256:${"0".repeat(64)}`; });
      assertSemanticTamperRejected((value) => { value.surfaces[0].semanticValidationPerformed = true; });
      for (const key of ["commandsExecuted", "networkAccessed", "externalWritesPerformed"]) assertSemanticTamperRejected((value) => { value.observations[key] = true; });
      assertSemanticTamperRejected((value) => { value.observations.externalActionsPerformed = ["forged-action"]; });
      for (const key of ["approval", "audit", "deployment", "publication", "execution", "registryWrite", "launch"]) assertSemanticTamperRejected((value) => { value.authority[key] = true; });
      assertSemanticTamperRejected((value) => { value.validation.profile = "forged-profile"; });
      assertSemanticTamperRejected((value) => { value.unexpected = true; });
      assertSemanticTamperRejected((value) => { value.observations.unexpected = false; });
    }
    fs.appendFileSync(receiptPath, " ");
    assert.throws(() => validateCustomTradableMaterializationReceipt(receipt, { repositoryRoot: fixture.output }), /PROJECT_MATERIALIZATION_RECEIPT_INVALID.*exact ignored local artifact/iu);
    fs.writeFileSync(receiptPath, receiptBytes);
    if (specification.id === "web") {
      commitTrackedTestFile(fixture.output, "surfaces/game/undeclared.txt");
      const topologyTamper = rewriteReceiptForCurrentHead(fixture.output, receipt);
      assert.throws(() => validateCustomTradableMaterializationReceipt(topologyTamper, { repositoryRoot: fixture.output }), /PROJECT_MATERIALIZATION_RECEIPT_INVALID.*reserved surfaces namespace/iu);
    }
    assert.equal(git(fixture.output, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
  }
});

test("multi-surface materialization rejects missing, malformed, legacy-mixed, and generated-path-colliding roots before output", (t) => {
  const fixture = createMultiSurfaceFixture(t, multiSurfaceProfiles[0]);
  const withoutSurface = multiSurfaceMaterializeArgs(fixture, "foundry-web").filter((argument, index, values) => argument !== "--surface-root" && values[index - 1] !== "--surface-root");
  const missing = runMultiSurface(withoutSurface);
  assert.equal(missing.status, 2, missing.stderr || missing.stdout);
  assert.match(missing.stderr, /foundry-web.*requires --surface-root/iu);
  assert.equal(fs.existsSync(fixture.output), false);

  const ordinaryWithSurface = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry"));
  assert.equal(ordinaryWithSurface.status, 2, ordinaryWithSurface.stderr || ordinaryWithSurface.stdout);
  assert.match(ordinaryWithSurface.stderr, /foundry.*does not accept --surface-root/iu);
  assert.equal(fs.existsSync(fixture.output), false);

  const unknown = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-metaverse"));
  assert.equal(unknown.status, 2, unknown.stderr || unknown.stdout);
  assert.match(unknown.stderr, /project-profile.*foundry-web.*foundry-service.*foundry-game/iu);
  assert.equal(fs.existsSync(fixture.output), false);

  fs.writeFileSync(path.join(fixture.surfaceRoot, "programmable-surface.json"), "{}\n");
  const collision = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-web"));
  assert.equal(collision.status, 2, collision.stderr || collision.stdout);
  assert.match(collision.stderr, /PROJECT_SURFACE_TREE_COLLISION.*programmable-surface\.json/u);
  assert.equal(fs.existsSync(fixture.output), false);
  fs.rmSync(path.join(fixture.surfaceRoot, "programmable-surface.json"));

  fs.writeFileSync(path.join(fixture.surfaceRoot, "Programmable-Surface.json"), "{}\n");
  const portableCollision = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-web"));
  assert.equal(portableCollision.status, 2, portableCollision.stderr || portableCollision.stdout);
  assert.match(portableCollision.stderr, /PROJECT_SURFACE_TREE_COLLISION.*programmable-surface\.json/iu);
  assert.equal(fs.existsSync(fixture.output), false);
  fs.rmSync(path.join(fixture.surfaceRoot, "Programmable-Surface.json"));

  const outside = path.join(fixture.parent, "outside.mjs");
  fs.writeFileSync(outside, "export const escaped = true;\n");
  fs.symlinkSync(outside, path.join(fixture.surfaceRoot, "src/escape.mjs"));
  const symlink = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-web"));
  assert.equal(symlink.status, 2, symlink.stderr || symlink.stdout);
  assert.match(symlink.stderr, /PROJECT_SURFACE_TREE_INVALID.*symbolic link/u);
  assert.equal(fs.existsSync(fixture.output), false);
  fs.rmSync(path.join(fixture.surfaceRoot, "src/escape.mjs"));

  fs.rmSync(path.join(fixture.surfaceRoot, "package-lock.json"));
  const missingLock = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-web"));
  assert.equal(missingLock.status, 2, missingLock.stderr || missingLock.stdout);
  assert.match(missingLock.stderr, /PROJECT_SURFACE_BUILD_PROFILE_UNRESOLVED.*caller-supplied lock/u);
  assert.equal(fs.existsSync(fixture.output), false);

  fs.writeFileSync(path.join(fixture.surfaceRoot, ".env"), "PRIVATE_KEY=must-not-enter-output\n");
  const secretRisk = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-web"));
  assert.equal(secretRisk.status, 2, secretRisk.stderr || secretRisk.stdout);
  assert.match(secretRisk.stderr, /PROJECT_SURFACE_TREE_INVALID.*secret-risk/u);
  assert.equal(fs.existsSync(fixture.output), false);
});

test("multi-surface input rejects Git controls, component-level secret risks, and non-portable names", (t) => {
  const fixture = createMultiSurfaceFixture(t, multiSurfaceProfiles[0]);
  const accepted = readCustomTradableSurface({ projectProfile: "foundry-web", surfaceRoot: fixture.surfaceRoot });
  for (const allowedPath of ["src/CredentialsProvider.ts", "test/credential-validator.test.ts", "src/credentials-form.tsx"]) {
    assert.ok(accepted.files.some(({ inputPath }) => inputPath === allowedPath), `${allowedPath} must remain an accepted ordinary source path`);
  }
  const rejectFile = (relativePath, expected) => {
    const target = path.join(fixture.surfaceRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "adversarial\n");
    const result = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-web"));
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, expected);
    assert.equal(fs.existsSync(fixture.output), false);
    fs.rmSync(target);
  };
  rejectFile(".gitignore", /PROJECT_SURFACE_TREE_INVALID.*Git control/iu);
  rejectFile("nested/.gitattributes", /PROJECT_SURFACE_TREE_INVALID.*Git control/iu);
  rejectFile("src/.git", /PROJECT_SURFACE_TREE_INVALID.*Git control/iu);
  rejectFile(".aws/credentials", /PROJECT_SURFACE_TREE_INVALID.*secret-risk/iu);
  fs.rmSync(path.join(fixture.surfaceRoot, ".aws"), { recursive: true });
  rejectFile(".ssh/id_ed25519", /PROJECT_SURFACE_TREE_INVALID.*secret-risk/iu);
  fs.rmSync(path.join(fixture.surfaceRoot, ".ssh"), { recursive: true });
  rejectFile(".config/gcloud/application_default_credentials.json", /PROJECT_SURFACE_TREE_INVALID.*secret-risk/iu);
  rejectFile("config/credentials", /PROJECT_SURFACE_TREE_INVALID.*secret-risk/iu);
  rejectFile("nested/.env.local", /PROJECT_SURFACE_TREE_INVALID.*secret-risk/iu);
  rejectFile("public/CON.txt", /PROJECT_SURFACE_TREE_INVALID.*portable ASCII/iu);
});

test("frozen multi-surface inventory detects input drift without rebuilding its profile model", (t) => {
  const fixture = createMultiSurfaceFixture(t, multiSurfaceProfiles[1]);
  const surface = readCustomTradableSurface({ projectProfile: "foundry-service", surfaceRoot: fixture.surfaceRoot });
  assert.equal(revalidateCustomTradableSurface(surface), true);
  fs.appendFileSync(path.join(fixture.surfaceRoot, "src/index.mjs"), "// changed after binding\n");
  assert.throws(() => revalidateCustomTradableSurface(surface), /PROJECT_SURFACE_INPUT_CHANGED/u);
});

test("multi-surface output collisions fail closed and portable execute cannot run its authored commands", (t) => {
  const fixture = createMultiSurfaceFixture(t, multiSurfaceProfiles[2]);
  fs.mkdirSync(fixture.output);
  fs.writeFileSync(path.join(fixture.output, "owner.txt"), "must survive\n");
  const collision = runMultiSurface(multiSurfaceMaterializeArgs(fixture, "foundry-game"));
  assert.equal(collision.status, 2, collision.stderr || collision.stdout);
  assert.match(collision.stderr, /PROJECT_OUTPUT_EXISTS.*new directory/u);
  assert.equal(fs.existsSync(fixture.marker), false);
  assert.equal(fs.readFileSync(path.join(fixture.output, "owner.txt"), "utf8"), "must survive\n");
  fs.rmSync(fixture.output, { recursive: true, force: true });

  const written = runMultiSurface([...multiSurfaceMaterializeArgs(fixture, "foundry-game"), "--write"]);
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const execute = childProcess.spawnSync(process.execPath, [
    unifiedCli, "project", "execute", "--repository-root", fixture.output,
    "--plan", ".programmable/custom-tradable-build-plan.v1.json",
    "--output-plan", ".programmable/repository-plan.v1.json"
  ], { encoding: "utf8", shell: false, timeout: 30_000 });
  assert.equal(execute.status, 2, execute.stderr || execute.stdout);
  assert.match(execute.stderr, /PROJECT_SOURCE_HEAD_MISMATCH|PROJECT_PLAN_NOT_MATERIALIZING|PROJECT_EXTERNAL_SANDBOX_REQUIRED/u);
  assert.equal(fs.existsSync(fixture.marker), false);
  assert.equal(fs.existsSync(path.join(fixture.output, ".programmable/repository-plan.v1.json")), false);
});

function createMultiSurfaceFixture(t, { id }) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `programmable-${id}-surface-`));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "mizu-idea.txt"), sourceRoot = path.join(parent, "contract-src");
  const testRoot = path.join(parent, "contract-test"), surfaceRoot = path.join(parent, `${id}-surface`);
  const output = path.join(parent, "mizu-output"), marker = path.join(parent, "candidate-executed");
  fs.mkdirSync(sourceRoot); fs.mkdirSync(testRoot);
  fs.mkdirSync(path.join(surfaceRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(surfaceRoot, "test"), { recursive: true });
  fs.mkdirSync(path.join(surfaceRoot, "bin"), { recursive: true });
  fs.mkdirSync(path.join(surfaceRoot, "public", "nested"), { recursive: true });
  fs.mkdirSync(path.join(surfaceRoot, "public", "a", "b", "c", "d", "e"), { recursive: true });
  fs.writeFileSync(ideaPath, "Build Mizu as a canonical Uniswap v4 dynamic LP-fee hook with a complete application surface. Buys cost less than sells; fee pressure is size-sensitive and decays with recent volume.\n");
  const contractSource = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract MizuDynamicFeeHook { function feePips(bool sell, uint128 size, uint128 volume) external pure returns (uint24) { uint256 p = uint256(size) / 1e15 + uint256(volume) / 1e16; return uint24((sell ? 3000 : 1000) + (p > 97000 ? 97000 : p)); } }\n";
  const contractTest = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract MizuDynamicFeeHookTest { function testSimulationDirectionalFee() external {} function testFuzzFeeBound(uint128, uint128) external {} function invariantLiquidityChangesUntaxed() external pure returns (bool) { return true; } function testDeploymentPermissionBits() external {} }\n";
  fs.writeFileSync(path.join(sourceRoot, "MizuDynamicFeeHook.sol"), contractSource);
  fs.writeFileSync(path.join(testRoot, "MizuDynamicFeeHook.t.sol"), contractTest);
  const packageDocument = { name: `mizu-${id}`, version: "0.0.0", private: true, type: "module", packageManager: "npm@11.16.0", scripts: { build: "node --check src/index.mjs", test: "node --test test/index.test.mjs" } };
  const lockDocument = { name: `mizu-${id}`, version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: `mizu-${id}`, version: "0.0.0" } } };
  fs.writeFileSync(path.join(surfaceRoot, "package.json"), `${JSON.stringify(packageDocument, null, 2)}\n`);
  fs.writeFileSync(path.join(surfaceRoot, "package-lock.json"), `${JSON.stringify(lockDocument, null, 2)}\n`);
  fs.writeFileSync(path.join(surfaceRoot, "src/index.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "surface-ran"); export const surface = ${JSON.stringify(id)};\n`);
  fs.writeFileSync(path.join(surfaceRoot, "src/CredentialsProvider.ts"), "export class CredentialsProvider {}\n");
  fs.writeFileSync(path.join(surfaceRoot, "src/credentials-form.tsx"), "export const CredentialsForm = () => null;\n");
  fs.writeFileSync(path.join(surfaceRoot, "test/index.test.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "test-ran"); throw new Error("candidate tests must remain inert");\n`);
  fs.writeFileSync(path.join(surfaceRoot, "test/credential-validator.test.ts"), "export const credentialValidatorTestFixture = true;\n");
  fs.writeFileSync(path.join(surfaceRoot, "bin/tool.sh"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  fs.chmodSync(path.join(surfaceRoot, "bin/tool.sh"), 0o755);
  fs.writeFileSync(path.join(surfaceRoot, "public/nested/state.json"), "{\"network\":\"ethereum\"}\n");
  fs.writeFileSync(path.join(surfaceRoot, "public/[literal].txt"), Buffer.from("literal\r\nbytes\r\n", "utf8"));
  fs.writeFileSync(path.join(surfaceRoot, "--literal.txt"), "leading dash remains literal\n");
  fs.writeFileSync(path.join(surfaceRoot, "public/a/b/c/d/e/empty.dat"), "");
  return { parent, ideaPath, sourceRoot, testRoot, surfaceRoot, output, marker, contractSource, contractTest, surfacePaths: ["--literal.txt", "bin/tool.sh", "package-lock.json", "package.json", "public/[literal].txt", "public/a/b/c/d/e/empty.dat", "public/nested/state.json", "src/CredentialsProvider.ts", "src/credentials-form.tsx", "src/index.mjs", "test/credential-validator.test.ts", "test/index.test.mjs"] };
}

function multiSurfaceMaterializeArgs(fixture, projectProfile) {
  return [
    unifiedCli, "project", "materialize", "--idea-file", fixture.ideaPath,
    "--application-id", "mizu", "--classification", "tradable", "--market-ref", "mizu-eth",
    "--project-profile", projectProfile, "--contract-config-profile", "foundry-default",
    "--source-root", fixture.sourceRoot, "--test-root", fixture.testRoot,
    "--surface-root", fixture.surfaceRoot, "--output", fixture.output
  ];
}

function createCustomContractConfigurationFixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-custom-contract-configuration-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt"), sourceRoot = path.join(parent, "contract-src"), testRoot = path.join(parent, "contract-test");
  const contractConfigRoot = path.join(parent, "contract-config"), output = path.join(parent, "output"), marker = path.join(parent, "candidate-executed");
  fs.mkdirSync(sourceRoot); fs.mkdirSync(testRoot); fs.mkdirSync(path.join(contractConfigRoot, "config"), { recursive: true });
  fs.writeFileSync(ideaPath, "Build a custom directional, size-sensitive and decaying Uniswap v4 LP-fee hook with an independently selected build configuration.\n");
  fs.writeFileSync(path.join(sourceRoot, "CustomDynamicFeeHook.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract CustomDynamicFeeHook {}\n");
  fs.writeFileSync(path.join(testRoot, "CustomDynamicFeeHook.t.sol"), "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract CustomDynamicFeeHookTest { function testSimulationCustomFee() external {} function testFuzzCustomFee(uint256) external {} function invariantCustomFee() external pure returns (bool) { return true; } function testDeploymentCustomFee() external {} }\n");
  const packageDocument = { name: "custom-dynamic-fee", version: "0.0.0", private: true, scripts: { build: "forge build", test: "forge test" }, dependencies: { "@custom/v4-core": "1.2.3", "forge-std": "1.9.7" } };
  const lockDocument = { name: "custom-dynamic-fee", version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "custom-dynamic-fee", version: "0.0.0", dependencies: packageDocument.dependencies }, "node_modules/@custom/v4-core": { version: "1.2.3", resolved: "https://registry.example.invalid/custom-v4-core-1.2.3.tgz", integrity: "sha512-inert-test-fixture" }, "node_modules/forge-std": { version: "1.9.7", resolved: "https://registry.example.invalid/forge-std-1.9.7.tgz", integrity: "sha512-inert-test-fixture" } } };
  fs.writeFileSync(path.join(contractConfigRoot, "package.json"), `${JSON.stringify(packageDocument, null, 2)}\r\n`);
  fs.writeFileSync(path.join(contractConfigRoot, "package-lock.json"), `${JSON.stringify(lockDocument)}\n`);
  fs.writeFileSync(path.join(contractConfigRoot, "remappings.txt"), "custom-v4-core/=node_modules/@custom/v4-core/src/\nforge-std/=node_modules/forge-std/src/\n");
  fs.writeFileSync(path.join(contractConfigRoot, "foundry.toml"), "[profile.default]\nsrc = \"src\"\ntest = \"test\"\nlibs = [\"node_modules\"]\nsolc_version = \"0.8.26\"\nevm_version = \"prague\"\noptimizer = true\noptimizer_runs = 777\nvia_ir = true\nffi = true\n");
  fs.writeFileSync(path.join(contractConfigRoot, "hardhat.config.ts"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "executed"); export default { solidity: "0.8.26" };\n`, { mode: 0o755 });
  fs.chmodSync(path.join(contractConfigRoot, "hardhat.config.ts"), 0o755);
  fs.writeFileSync(path.join(contractConfigRoot, "config/compiler.json"), "{\"profile\":\"custom\",\"viaIR\":true}\n");
  return {
    parent, ideaPath, sourceRoot, testRoot, contractConfigRoot, output, marker,
    configurationPaths: ["config/compiler.json", "foundry.toml", "hardhat.config.ts", "package-lock.json", "package.json", "remappings.txt"]
  };
}

function customContractConfigurationArgs(fixture) {
  return [
    unifiedCli, "project", "materialize", "--idea-file", fixture.ideaPath,
    "--application-id", "custom-dynamic-fee", "--classification", "tradable", "--market-ref", "custom-eth",
    "--project-profile", "foundry", "--contract-config-root", fixture.contractConfigRoot,
    "--source-root", fixture.sourceRoot, "--test-root", fixture.testRoot, "--output", fixture.output
  ];
}

function createEmptyDirectoryFanout(root, prefix, count) {
  for (let index = 0; index < count; index += 1) fs.mkdirSync(path.join(root, `${prefix}-${String(index).padStart(4, "0")}`));
}

function createEmptyDirectoryChain(root, depth) {
  let directory = root;
  for (let index = 0; index < depth; index += 1) {
    directory = path.join(directory, `level-${String(index).padStart(2, "0")}`);
    fs.mkdirSync(directory);
  }
}

function withSynchronousReaddirForbidden(operation) {
  const original = fs.readdirSync;
  fs.readdirSync = () => { throw new Error("unbounded readdirSync retention is forbidden"); };
  try { return operation(); } finally { fs.readdirSync = original; }
}

function captureDescriptorReadLengths(operation) {
  const original = fs.readFileSync, lengths = [];
  fs.readFileSync = (target, ...rest) => {
    const result = original(target, ...rest);
    if (typeof target === "number") lengths.push(result.length);
    return result;
  };
  try { operation(); } finally { fs.readFileSync = original; }
  return lengths;
}

function writeSparseFile(filePath, byteLength) {
  const descriptor = fs.openSync(filePath, "w");
  try { fs.ftruncateSync(descriptor, byteLength); } finally { fs.closeSync(descriptor); }
}

function commitTrackedTestFile(repositoryRoot, relativePath) {
  writeFile(repositoryRoot, relativePath, "must not enter an undeclared surface root\n");
  git(repositoryRoot, ["config", "user.name", "Materializer Test"]);
  git(repositoryRoot, ["config", "user.email", "materializer-test@example.invalid"]);
  git(repositoryRoot, ["add", "--", relativePath]);
  git(repositoryRoot, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "add undeclared surface fixture"]);
}

function rewriteReceiptForCurrentHead(repositoryRoot, originalReceipt) {
  const receipt = structuredClone(originalReceipt);
  receipt.source.commit = git(repositoryRoot, ["rev-parse", "HEAD"]);
  receipt.source.tree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  receipt.repository.files = git(repositoryRoot, ["ls-tree", "-r", "HEAD"]).split("\n").filter(Boolean).map((record) => {
    const match = /^(100644|100755) blob [0-9a-f]{40,64}\t(.+)$/u.exec(record);
    assert.notEqual(match, null, record);
    const bytes = fs.readFileSync(path.join(repositoryRoot, match[2]));
    return { path: match[2], sha256: sha256Bytes(bytes), byteLength: bytes.length, mode: match[1] };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  receipt.repository.inventorySha256 = canonicalJsonSha256V2(receipt.repository.files);
  receipt.plan = receipt.repository.files.find(({ path: filePath }) => filePath === ".programmable/custom-tradable-build-plan.v1.json");
  fs.writeFileSync(path.join(repositoryRoot, ".programmable/custom-tradable-materialization-receipt.v1.json"), `${canonicalJsonV2(receipt)}\n`);
  return receipt;
}

function runMultiSurface(args) {
  return childProcess.spawnSync(process.execPath, args, { encoding: "utf8", shell: false, timeout: 60_000 });
}

function readMultiSurfaceJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
