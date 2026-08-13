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
  assert.equal(JSON.parse(dry.stdout).status, "PROJECT_MATERIALIZATION_DRY_RUN_READY");
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


test("project preflight rejects forged authority and exact blind trade claims while ignoring unrelated JSON", (t) => {
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
    && details.kind === "trade-capability-manifest-v1"
    && details.validatorCodes.includes("TRADE_CAPABILITY_MANIFEST_SCHEMA_INVALID")
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
    code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_INVALID" && details.kind === "trade-capability-manifest-v1"
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
