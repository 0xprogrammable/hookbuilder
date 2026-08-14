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

test("project materialize writes an idea-specific no-market source plan without executing candidate bytes", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-no-market-authoring-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const ideaPath = path.join(parent, "idea.txt");
  const sourcePath = path.join(parent, "cooperative-riddle.mjs");
  const testPath = path.join(parent, "cooperative-riddle.test.mjs");
  fs.writeFileSync(ideaPath, "A cooperative commit and reveal riddle game where every player must reveal before scoring.\n");
  fs.writeFileSync(sourcePath, `import crypto from "node:crypto";\nexport const commitment = (answer, salt) => crypto.createHash("sha256").update(answer + "\\0" + salt).digest("hex");\nexport class CooperativeRiddle {\n  #players; #answer; #commits = new Map(); #reveals = new Map();\n  constructor(players, answerDigest) { if (new Set(players).size !== players.length || players.length < 2) throw new Error("players"); this.#players = [...players]; this.#answer = answerDigest; }\n  commit(player, digest) { if (!this.#players.includes(player) || this.#commits.has(player)) throw new Error("commit"); this.#commits.set(player, digest); }\n  reveal(player, answer, salt) { if (this.#commits.size !== this.#players.length || this.#reveals.has(player) || this.#commits.get(player) !== commitment(answer, salt)) throw new Error("reveal"); this.#reveals.set(player, answer); }\n  score() { if (this.#reveals.size !== this.#players.length) throw new Error("incomplete"); return this.#players.filter((player) => commitment(this.#reveals.get(player), "answer") === this.#answer); }\n}\n`);
  fs.writeFileSync(testPath, `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { commitment, CooperativeRiddle } from "../src/cooperative-riddle.mjs";\ntest("all players commit and reveal before deterministic scoring", () => { const game = new CooperativeRiddle(["alice", "bob"], commitment("moss", "answer")); game.commit("alice", commitment("moss", "a")); assert.throws(() => game.reveal("alice", "moss", "a")); game.commit("bob", commitment("stone", "b")); game.reveal("alice", "moss", "a"); assert.throws(() => game.score()); game.reveal("bob", "stone", "b"); assert.deepEqual(game.score(), ["alice"]); });\ntest("a reveal must match its commitment", () => { const game = new CooperativeRiddle(["alice", "bob"], commitment("moss", "answer")); game.commit("alice", commitment("moss", "a")); game.commit("bob", commitment("stone", "b")); assert.throws(() => game.reveal("alice", "fern", "a")); });\n`);
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
