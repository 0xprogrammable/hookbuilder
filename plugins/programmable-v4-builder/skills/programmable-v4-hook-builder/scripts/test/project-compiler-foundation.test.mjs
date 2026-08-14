import test from "node:test";
import {
  assert, childProcess, crypto, fs, os, path, process,
  canonicalJsonSha256V2, canonicalJsonV2, keccak256Hex,
  PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES, PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES,
  createProjectCommandReceipt, executeProjectCommands, projectCommandEnvironmentSha256,
  projectCommandMaximumOutputBytes, sha256Bytes,
  compileProjectBundle, preflightProjectOutput, validateProjectOutput,
  TRADABLE_LEGACY_POLICY_INTENT_CLAUSE, TRADABLE_REFERENCE_PROFILE_ID, bindTradableReferenceIntent,
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

test("unified CLI grants the long bound only to written project materialization", () => {
  const source = fs.readFileSync(unifiedCli, "utf8");
  assert.match(source, /timeout:120_000\+2_580_000\*\+\(command\+args\[0\]\+args\.includes\("--write"\)==="projectmaterializetrue"\)/u);
  assert.equal((source.match(/2_580_000/gu) ?? []).length, 1);
  assert.equal((source.match(/120_000/gu) ?? []).length, 1);
});


test("local GitHub handoff binds exact no-market Submission bytes, report, commands, and RepositoryPlan artifact", () => {
  const build = (ideaText) => createNoMarketProjectAuthoring({ applicationId: "local-handoff", ideaText, sourcePath: "src/local.mjs", sourceBytes: Buffer.from("export const ok = true;\n"), testPath: "test/local.test.mjs", testBytes: Buffer.from('import test from "node:test"; test("ok", () => {});\n') });
  const authored = build("Preserve one bounded local record."), bytes = authored.files.get("GITHUB-SUBMISSION.md");
  const payload = JSON.parse(bytes.toString("utf8").split("\n\n")[1]);
  assert.deepEqual(payload.application, { applicationId: "local-handoff", classification: "no-market", ideaSha256: authored.projectSpec.intent.sha256, marketRef: null, tradeStatus: "NOT_APPLICABLE" });
  assert.deepEqual(payload.submission, { automaticMaterialization: false, byteLength: authored.files.get("submission/submission.v2.json").length, path: "submission/submission.v2.json", reportSha256: canonicalJsonSha256V2(authored.submissionReport), reportStatus: "REVIEW_REQUIRED", sha256: sha256Bytes(authored.files.get("submission/submission.v2.json")) });
  assert.equal(payload.status, "NOT_SUBMITTED"); assert.equal(payload.requiresHumanConfirmation, true);
  assert.equal(payload.externalRepository.numericRepositoryId.status, "UNRESOLVED_EXTERNAL_REQUIRED"); assert.equal(payload.externalRepository.canonicalRepositoryUri.status, "UNRESOLVED_EXTERNAL_REQUIRED");
  assert.equal(payload.localVerificationCommands.install, "node tools/project-stage.mjs install"); assert.equal(payload.localVerificationCommands.check, "npm test"); assert.match(payload.localVerificationCommands.requireOutput, /project require-output --brief .*submission-evidence.*verification.*submission/u);
  assert.deepEqual(payload.evidenceBoundary, { approvalCreated: false, auditClaimed: false, deploymentPerformed: false, externalActionsPerformed: [], githubWritePerformed: false, launchPerformed: false, publicationPerformed: false });
  const artifact = authored.repositoryPlan.artifacts.documentation.find(({ path: artifactPath }) => artifactPath === "GITHUB-SUBMISSION.md");
  assert.equal(artifact.sha256, sha256Bytes(bytes)); assert.equal(artifact.byteLength, bytes.length);
  assert.deepEqual(validateRepositoryPlan(authored.projectSpec, authored.productGraph, authored.architectureCandidates, authored.repositoryPlan).filter(({ severity }) => severity === "blocker"), []);
  const changed = build("Preserve two bounded local records."), changedBytes = changed.files.get("GITHUB-SUBMISSION.md");
  assert.notEqual(sha256Bytes(changedBytes), sha256Bytes(bytes)); assert.notEqual(JSON.parse(changedBytes.toString("utf8").split("\n\n")[1]).submission.sha256, payload.submission.sha256);
  const driftedSubmission = Buffer.concat([authored.files.get("submission/submission.v2.json"), Buffer.from("\n")]);
  const drifted = renderGitHubSubmissionHandoffV1({ applicationId: "local-handoff", classification: "no-market", ideaSha256: authored.projectSpec.intent.sha256, submissionBytes: driftedSubmission, report: authored.submissionReport, tradeStatus: "NOT_APPLICABLE" });
  assert.notEqual(JSON.parse(drifted.toString("utf8").split("\n\n")[1]).submission.sha256, payload.submission.sha256);
  const poisoned = build("Preserve three bounded local records."), sourcePath = "submission/idea-source.v1.json", source = JSON.parse(poisoned.files.get(sourcePath)), submission = JSON.parse(poisoned.files.get("submission/submission.v2.json"));
  source.entries[0].sha256 = authored.projectSpec.intent.sha256; const sourceBytes = Buffer.from(JSON.stringify(source)); poisoned.files.set(sourcePath, sourceBytes); submission.intentPackage.ideaSource.sha256 = sha256Bytes(sourceBytes); submission.intentPackage.ideaSource.byteLength = sourceBytes.length; poisoned.files.set("submission/submission.v2.json", Buffer.from(JSON.stringify(submission)));
  assert.throws(() => bindLocalReleaseHandoffV1({ authored: poisoned, applicationId: "local-handoff", classification: "no-market", ideaSha256: poisoned.projectSpec.intent.sha256 }), /identity mismatch/u);
  const changedReport = renderGitHubSubmissionHandoffV1({ applicationId: "local-handoff", classification: "no-market", ideaSha256: authored.projectSpec.intent.sha256, submissionBytes: authored.files.get("submission/submission.v2.json"), report: { ...authored.submissionReport, findings: [{ code: "DRIFT" }] }, tradeStatus: "NOT_APPLICABLE" });
  assert.notEqual(sha256Bytes(changedReport), sha256Bytes(bytes));
});


test("tradable local handoff replaces the stale README boundary with exact NOT_APPROVED evidence bindings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-tradable-handoff-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stale = "The local quoter/router matrix is not RPC-backed `eth_call` evidence, fork evidence,\ndeployed-address verification, signature-based Permit2 coverage, a quoter/router audit or proof for a different package\nrevision.";
  fs.writeFileSync(path.join(root, "README.md"), `# Kernel\n\nThe example JSON under \`evidence/\` remains a placeholder checklist, not a complete receipt.\n\n${stale}\n`);
  const digest = (value) => sha256Bytes(Buffer.from(value)), ideaText = "idea", ideaSha256 = digest(ideaText), ideaSourceBytes = Buffer.from(JSON.stringify({ originalEntryId: "original-idea", entries: [{ id: "original-idea", publicTextUtf8: ideaText, sha256: ideaSha256 }] }) + "\n"), ideaBinding = { path: "idea-source.v1.json", sha256: sha256Bytes(ideaSourceBytes), byteLength: ideaSourceBytes.length }, submissionBytes = Buffer.from(JSON.stringify({ applicationId: "tradable-handoff", intentPackage: { ideaSource: ideaBinding }, tradeCapability: { applicability: "tradable", markets: [{ marketRef: "primary-market" }] } }) + "\n"), paths = { profile: "evidence/v4/primary-market.hook-semantic.v1.json", preimage: "evidence/v4/primary-market.deployment-preimage.v1.json", manifest: "evidence/v4/primary-market.deployment-manifest.v1.json", runtime: "evidence/v4/primary-market.runtime.bin" };
  const evidenceFiles = Object.values(paths).map((artifactPath, index) => ({ path: artifactPath, sha256: digest(`v4-${index}`) }));
  const tradeEvidence = { status: "NOT_APPROVED", manifest: { path: ".programmable/trade-capabilities/primary-market.v1.json", sha256: digest("manifest") }, feeConformance: { receiptPath: "submission/review/fee-conformance/primary-market.receipt.v1.json", receiptSha256: digest("receipt"), vectorSetPath: "submission/review/fee-conformance/primary-market.vectors.v1.json", vectorSetSha256: digest("vectors") }, forkEvidence: { path: "evidence/v4/primary-market.mainnet-fork-canary.v1.json", sha256: digest("fork") }, v4: { paths }, evidenceFiles };
  const authored = { projectSpec: { intent: { sha256: ideaSha256, verbatimText: ideaText } }, files: new Map([["submission/submission.v2.json", submissionBytes], ["submission/idea-source.v1.json", ideaSourceBytes]]), submissionReport: { status: "REVIEW_REQUIRED", automaticMaterialization: true } };
  bindLocalReleaseHandoffV1({ authored, applicationId: "tradable-handoff", classification: "tradable", marketRef: "primary-market", ideaSha256, repositoryRoot: root, tradeEvidence });
  const handoff = JSON.parse(authored.files.get("GITHUB-SUBMISSION.md").toString("utf8").split("\n\n")[1]), readme = authored.files.get("README.md").toString("utf8");
  assert.deepEqual(handoff.application, { applicationId: "tradable-handoff", classification: "tradable", ideaSha256, marketRef: "primary-market", tradeStatus: "NOT_APPROVED" });
  assert.equal(handoff.submission.automaticMaterialization, true); assert.equal(handoff.localVerificationCommands.install, "npm ci --ignore-scripts --prefer-offline --no-audit --no-fund"); assert.equal(handoff.localVerificationCommands.check, "node tools/run-project-gate.mjs evidence");
  assert.doesNotMatch(readme, /not RPC-backed `eth_call` evidence, fork evidence|placeholder checklist, not a complete receipt/u); assert.match(readme, /## Materialized local evidence[\s\S]*Status: \*\*NOT_APPROVED\*\*/u);
  for (const binding of [tradeEvidence.manifest, { path: tradeEvidence.feeConformance.receiptPath, sha256: tradeEvidence.feeConformance.receiptSha256 }, { path: tradeEvidence.feeConformance.vectorSetPath, sha256: tradeEvidence.feeConformance.vectorSetSha256 }, tradeEvidence.forkEvidence, ...evidenceFiles]) { assert.match(readme, new RegExp(binding.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")); assert.match(readme, new RegExp(binding.sha256, "u")); }
  assert.match(readme, /no audit, approval, production deployment, transaction broadcast, GitHub publication or launch is claimed/u);
  const compilerSource = fs.readFileSync(compilerCli, "utf8");
  assert.match(compilerSource, /tradable source generation requires candidate dependency and test execution/u);
  assert.doesNotMatch(compilerSource, /createTradableProjectAuthoring|installProjectDependencies/u);
  assert.throws(() => bindLocalReleaseHandoffV1({ authored, applicationId: "tradable-handoff", classification: "tradable", marketRef: "primary-market", ideaSha256: digest("different-idea"), repositoryRoot: root, tradeEvidence }), /identity mismatch/u);
});


test("tradable frozen legacy profile binds exact policy economics and UTF-8 intent bytes", () => {
  const selectLegacyPolicy = (idea, handoff = "") => `${idea} ${TRADABLE_LEGACY_POLICY_INTENT_CLAUSE}${handoff === "" ? "" : ` ${handoff}`}`;
  const blindIdea = selectLegacyPolicy("Please use the installed Programmable Hookbuilder to build a closed Uniswap v4 hook that charges a fixed fee on each swap's executed gross quote volume. Keep the buy and sell rates immutable after registration.", "Turn the idea into a complete local Git repository for later human review, and perform no publication or external write.");
  const secondBlindIdea = selectLegacyPolicy("Use the installed Programmable Hookbuilder to create a Uniswap v4 hook that collects a fee from each swap's executed gross quote volume. Make the buy and sell rates fixed after registration.", "Build the complete project in this fresh local Git repository for human review, and do not publish or write to external systems.");
  const ideas = [
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration.",
    "Make a Uniswap’s v4 hook that takes a fee from executed gross quote volume; make the buy and sell rates fixed after registration.",
    "Create a Uniswap version 4 hook which collects its fee from executed gross quote volume. Keep buy and sell rates unchanged after registration.",
    "✨ Build a Uniswap v4 hook that charges a fixed fee on each swap’s executed gross quote volume. Keep the buy and sell rates immutable after registration."
  ].map((idea) => selectLegacyPolicy(idea));
  ideas.push(blindIdea, secondBlindIdea, selectLegacyPolicy("Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration.", "Produce a complete local Git repository for human review. Do not publish or perform any external writes."));
  for (const idea of ideas) {
    const binding = bindTradableReferenceIntent(idea, TRADABLE_REFERENCE_PROFILE_ID), bytes = Buffer.from(idea);
    assert.equal(binding.normalizedCapability.feeBasis, "executed-gross-quote-volume");
    assert.equal(binding.normalizedCapability.legacyPolicy, "programmable-volume-fee-v2@2.0.0");
    assert.equal(binding.normalizedCapability.legacyPlatformRateBps, 10);
    assert.equal(binding.normalizedCapability.legacyPlatformOwner, "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c");
    assert.deepEqual(binding.normalizedCapability.extraMaterialClauses, []);
    assert.deepEqual(binding.capabilitySpans.map(({ capabilityId }) => capabilityId), ["uniswap-v4", "hook", "executed-gross-quote-volume-fee", "immutable-selected-buy-sell-rate", "frozen-legacy-policy", "inclusive-programmable-platform-share", "immutable-programmable-claimant"]);
    for (const span of binding.capabilitySpans) assert.equal(sha256Bytes(bytes.subarray(span.startByte, span.endByte)), span.textSha256);
  }
  const blindBinding = bindTradableReferenceIntent(blindIdea, TRADABLE_REFERENCE_PROFILE_ID);
  assert.equal(Buffer.byteLength(blindIdea, "utf8"), blindBinding.ideaByteLength);
  assert.equal(blindBinding.ideaSha256, sha256Bytes(Buffer.from(blindIdea)));
  const secondBlindBinding = bindTradableReferenceIntent(secondBlindIdea, TRADABLE_REFERENCE_PROFILE_ID);
  assert.equal(Buffer.byteLength(secondBlindIdea, "utf8"), secondBlindBinding.ideaByteLength);
  assert.equal(secondBlindBinding.ideaSha256, sha256Bytes(Buffer.from(secondBlindIdea)));
  for (const idea of [
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Use frozen legacy policy programmable-volume-fee-v2@2.0.0 with an inclusive 10 bps Programmable platform share claimable only by 0x0000000000000000000000000000000000000000.",
    "Build a Uniswap v4 hook that charges a fee on executed volume for token holders.",
    "Build a Uniswap v4 hook that charges dynamic fees on executed volume.",
    "Build a Uniswap v4 hook that charges a fee on executed trading volume. Keep buy and sell rates immutable after registration.",
    "Build a Uniswap v4 hook that charges a fee on gross quote volume. Keep buy and sell rates immutable after registration.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume.",
    "Build a Uniswap v4 hook that charges a fee for quote swaps and shows volume.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Turn the idea into a complete local Git repository for later human review, and add token-holder rewards.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Produce a complete local Git repository for human review. Do not publish or perform external writes. Add an oracle-adjusted rate.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not publish until review or write to external systems.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not publish or write to external systems except GitHub.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not publish and write to external systems.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and never publish and write to external systems.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, and do not release the project and perform any external writes.",
    "Build a Uniswap v4 hook that charges a fee on executed gross quote volume. Keep buy and sell rates immutable after registration. Build the complete project in this fresh local Git repository for human review, then deploy it.",
    "A cooperative commit-reveal riddle game for two players."
  ]) assert.throws(() => bindTradableReferenceIntent(idea, TRADABLE_REFERENCE_PROFILE_ID), ({ code }) => code === "TRADABLE_REFERENCE_PROFILE_MISMATCH");
});


test("generated build gate binds both exact Solidity settings and source partitions before reporting pass", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-build-info-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "out/build-info"), { recursive: true });
  const authoringSource = fs.readFileSync(path.join(skillRoot, "scripts/project-tradable-authoring-core.mjs"), "utf8");
  const segment = authoringSource.slice(authoringSource.indexOf("function renderProjectGateTool")), tick = String.fromCharCode(96);
  const start = segment.indexOf("return " + tick) + 8, end = segment.indexOf(tick + ";\n}\n\nfunction mitLicense");
  assert.ok(start >= 8 && end > start);
  const render = Function("forkTest", "marketRef", "return " + tick + segment.slice(start, end) + tick + ";");
  const baseSource = render("test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol", "primary-market")
    .replace('build:["forge",["build","--offline"]]', 'build:["node",["-e",""]]');
  const roots26 = [
    "src/ProgrammableVolumeFeeHookFactoryV2.sol", "src/ProgrammableVolumeFeeHookV2.sol", "test/MockReferenceToken.sol", "test/MockWETH9.sol",
    "test/ProgrammableTradeEvidenceRunnerV1.t.sol", "test/ProgrammableVolumeFeeHookV2.t.sol", "test/ProgrammableVolumeFeeHookV2Erc20.t.sol",
    "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol", "test/ProgrammableVolumeFeeHookV2Parity.t.sol",
    "test/ProgrammableVolumeFeeHookV2UniversalRouterErc20.t.sol", "test/ProgrammableVolumeFeeHookV2UniversalRouterNative.t.sol",
    "test/V4PlannerEncodingParity.t.sol", "test/helpers/ProgrammableVolumeFeeHookV2Erc20Fixture.sol",
    "test/helpers/UniversalRouterV4Fixture.sol", "test/invariant/ProgrammableVolumeFeeHookV2.invariant.t.sol"
  ];
  const profile = (componentRefs, compilerVersion, evmTarget, cborMetadata) => ({ componentRefs, compilerVersion, evmTarget, optimizer: { enabled: true, runs: 200 }, viaIr: true, bytecodeHash: "none", cborMetadata });
  const baseLock = {
    tools: [{ id: "node", version: process.version, resolvedExecutableSha256: sha256Bytes(fs.readFileSync(process.execPath)) }],
    solidityProfiles: [
      profile(["pinned-route-component"], "0.8.17", "london", true),
      profile(["service-component", "factory-component", "v4-hook-system", "v4-hook-factory-system"], "0.8.26", "cancun", false)
    ]
  };
  const writeUnit = (name, solcVersion, evmVersion, appendCBOR, roots) => fs.writeFileSync(path.join(root, "out/build-info", name), JSON.stringify({
    solcVersion, input: { settings: { evmVersion, optimizer: { enabled: true, runs: 200 }, viaIR: true, metadata: { bytecodeHash: "none", ...(appendCBOR === undefined ? {} : { appendCBOR }) } }, sources: Object.fromEntries([...roots, "node_modules/dependency.sol"].map((sourcePath) => [sourcePath, {}])) }
  }));
  const run = (lock, roots = roots26) => {
    writeUnit("17.json", "0.8.17", "london", undefined, ["test/vendor/PinnedPermit2Artifact.sol"]);
    writeUnit("26.json", "0.8.26", "cancun", false, roots);
    const source = baseSource.replace('JSON.parse(fs.readFileSync(".programmable/project-toolchain-lock.v1.json","utf8"))', JSON.stringify(lock));
    return childProcess.spawnSync(process.execPath, ["--input-type=module", "-", "build"], { cwd: root, input: source, encoding: "utf8", shell: false });
  };
  const accepted = run(baseLock);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stdout, "build:passed\n");
  const wrongCbor = structuredClone(baseLock);
  wrongCbor.solidityProfiles[0].cborMetadata = false;
  const rejectedCbor = run(wrongCbor);
  assert.notEqual(rejectedCbor.status, 0);
  assert.equal(rejectedCbor.stdout, "");
  assert.match(rejectedCbor.stderr, /build-info lock or source partition mismatch/u);
  const rejectedPartition = run(baseLock, roots26.slice(0, -1));
  assert.notEqual(rejectedPartition.status, 0);
  assert.equal(rejectedPartition.stdout, "");
  assert.match(rejectedPartition.stderr, /build-info lock or source partition mismatch/u);
});


test("tradable materialize profile mismatch fails before output and aligned dry-run stays write-free", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-tradable-intent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const idea = path.join(root, "idea.txt"), output = path.join(root, "output"), base = [unifiedCli, "project", "materialize", "--idea-file", idea, "--application-id", "volume-fee-reference", "--classification", "tradable", "--market-ref", "primary-market", "--reference-profile", TRADABLE_REFERENCE_PROFILE_ID, "--output", output];
  fs.writeFileSync(idea, "A cooperative commit-reveal riddle game for two players.\n");
  const rejected = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false });
  assert.equal(rejected.status, 2); assert.match(rejected.stderr, /TRADABLE_REFERENCE_PROFILE_MISMATCH/u); assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(idea, "Build a Uniswap v4 hook that charges a fixed fee on executed gross quote volume. Keep buy and sell rates immutable after registration.\n");
  const missingLegacyPolicy = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false });
  assert.equal(missingLegacyPolicy.status, 2); assert.match(missingLegacyPolicy.stderr, /TRADABLE_REFERENCE_PROFILE_MISMATCH/u); assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(idea, `Build a Uniswap v4 hook that charges a fixed fee on executed gross quote volume. Keep buy and sell rates immutable after registration. ${TRADABLE_LEGACY_POLICY_INTENT_CLAUSE}\n`);
  const dry = childProcess.spawnSync(process.execPath, base, { encoding: "utf8", shell: false });
  assert.equal(dry.status, 0, dry.stderr || dry.stdout); assert.equal(JSON.parse(dry.stdout).status, "PROJECT_MATERIALIZATION_DRY_RUN_READY"); assert.equal(fs.existsSync(output), false);
  const blockedWrite = childProcess.spawnSync(process.execPath, [...base, "--write"], { encoding: "utf8", shell: false });
  assert.equal(blockedWrite.status, 2, blockedWrite.stderr || blockedWrite.stdout);
  assert.match(blockedWrite.stderr, /PROJECT_EXTERNAL_SANDBOX_REQUIRED/u);
  assert.equal(fs.existsSync(output), false);
});


test("ProjectSpec preserves intent bytes and classifies every required open-world facet", () => {
  const spec = makeProjectSpec();
  assert.deepEqual(validateProjectSpec(spec), []);
  assert.deepEqual(Object.keys(spec.facets), [...PROJECT_SPEC_FACETS]);

  const missingLifecycle = structuredClone(spec);
  missingLifecycle.facets.lifecycle.entries = missingLifecycle.facets.lifecycle.entries.filter(({ kind }) => kind !== "decommissioning");
  assert.ok(validateProjectSpec(missingLifecycle).some(({ code }) => code === "PROJECT_FACET_CLASSIFICATION_MISSING"));

  const disguisedAssumption = structuredClone(spec);
  disguisedAssumption.facets.assumptions.entries.find(({ provenance }) => provenance === "builder-assumption").sourceSpans = [sourceSpan(spec.intent.verbatimText)];
  assert.ok(validateProjectSpec(disguisedAssumption).some(({ code }) => code === "BUILDER_ASSUMPTION_MASQUERADES_AS_INTENT"));

  const duplicateTradeOwner = structuredClone(spec);
  duplicateTradeOwner.facets.valueFlow.entries[0].kind = "trade-capability";
  assert.ok(validateProjectSpec(duplicateTradeOwner).some(({ code }) => code === "TRADE_CAPABILITY_OWNER_INVALID"));
});


test("all nine product graphs are typed, reference-closed, and trace applicable intent", () => {
  const spec = makeProjectSpec();
  const graph = makeProductGraph(spec);
  assert.deepEqual(validateProductGraph(spec, graph), []);
  assert.deepEqual(Object.keys(graph.graphs), [...PRODUCT_GRAPH_NAMES]);

  const untraced = structuredClone(graph);
  untraced.graphs.system.nodes[0].facetEntryRefs.pop();
  assert.ok(validateProductGraph(spec, untraced).some(({ code }) => code === "PROJECT_FACET_GRAPH_TRACE_MISSING"));

  const missingComponent = structuredClone(graph);
  missingComponent.graphs.component.components = [];
  assert.ok(validateProductGraph(spec, missingComponent).some(({ code }) => ["APPLICABLE_GRAPH_EMPTY", "SYSTEM_COMPONENT_UNMAPPED"].includes(code)));

  const unknownFailure = structuredClone(graph);
  unknownFailure.graphs.state.transitions[0].failureRef = "failure-does-not-exist";
  assert.ok(validateProductGraph(spec, unknownFailure).some(({ code }) => code === "PRODUCT_GRAPH_SCHEMA_INVALID" || code === "FAILURE_REF_UNKNOWN"));

  const nonTradeMarket = structuredClone(graph);
  nonTradeMarket.graphs.system.nodes.push({ id: "price-reference", label: "Price reference", type: "market", protocolRole: "none", implementationStatus: "planned", facetEntryRefs: ["user-experience-fact"] });
  assert.deepEqual(validateProductGraph(spec, nonTradeMarket), []);
  const nonTradeArchitectures = makeArchitectures(spec, nonTradeMarket);
  nonTradeArchitectures.candidates[0].graphNodeRefs.push("price-reference");
  nonTradeArchitectures.productGraphSha256 = projectArtifactSha256(nonTradeMarket);
  const nonTradePlan = makePlanningRepositoryPlan({ projectSpec: spec, productGraph: nonTradeMarket, architectureCandidates: nonTradeArchitectures });
  assert.deepEqual(validateRepositoryPlan(spec, nonTradeMarket, nonTradeArchitectures, nonTradePlan), []);
  nonTradeMarket.graphs.system.nodes.at(-1).facetEntryRefs = ["trade-capability-not-applicable"];
  assert.ok(validateProductGraph(spec, nonTradeMarket).some(({ code }) => code === "NO_MARKET_TRADE_NODE_FORBIDDEN"));
});


test("architecture comparison requires exactly minimum-correct, v4-native, and hybrid before selection", () => {
  const spec = makeProjectSpec();
  const graph = makeProductGraph(spec);
  const architectures = makeArchitectures(spec, graph);
  assert.deepEqual(validateArchitectureCandidates(spec, graph, architectures), []);
  assert.deepEqual(architectures.candidates.map(({ role }) => role), [...ARCHITECTURE_ROLES]);

  const duplicatedRole = structuredClone(architectures);
  duplicatedRole.candidates[2].role = "v4-native";
  const roleFindings = validateArchitectureCandidates(spec, graph, duplicatedRole);
  assert.ok(roleFindings.some(({ code }) => code === "ARCHITECTURE_ROLE_CARDINALITY_INVALID"));

  const unresolvedSelection = structuredClone(architectures);
  unresolvedSelection.candidates[0].dimensions.gas.rating = "unknown";
  assert.ok(validateArchitectureCandidates(spec, graph, unresolvedSelection).some(({ code }) => code === "SELECTED_ARCHITECTURE_DIMENSION_UNKNOWN"));

  const placeholder = structuredClone(architectures);
  graph.graphs.system.nodes.push({
    id: "placeholder-hook",
    label: "Placeholder hook",
    type: "contract",
    protocolRole: "uniswap-v4-hook",
    implementationStatus: "planned",
    facetEntryRefs: []
  });
  placeholder.productGraphSha256 = projectArtifactSha256(graph);
  placeholder.candidates[0].graphNodeRefs.push("placeholder-hook");
  assert.ok(validateArchitectureCandidates(spec, graph, placeholder).some(({ code }) => code === "PLACEHOLDER_HOOK_FORBIDDEN"));
});


test("deterministic phase checkpoints bind immutable state and reject skipped or tampered transitions", () => {
  const bundle = makeArchitectureBundle();
  const reportA = compileProjectBundle(bundle, { verifyRepositoryFiles: false });
  const reportB = compileProjectBundle(structuredClone(bundle), { verifyRepositoryFiles: false });
  assert.equal(reportA.status, "PROJECT_COMPILATION_VALID");
  assert.equal(reportA.phaseDisposition, "PHASE_LOCALLY_COMPLETE");
  assert.equal(canonicalJsonV2(reportA), canonicalJsonV2(reportB));
  assert.equal(reportA.reportSha256, reportB.reportSha256);

  const tampered = structuredClone(bundle.projectState);
  tampered.next.action = "Different unbound action";
  const tamperFindings = validateProjectState(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, undefined, tampered, { previousState: bundle.previousState });
  assert.ok(tamperFindings.some(({ code }) => code === "PROJECT_STATE_HASH_MISMATCH"));

  const skipped = sealProjectState({ ...statePayload(bundle, "verification", 1), artifacts: bundle.projectState.artifacts });
  assert.ok(validateProjectState(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, undefined, skipped).some(({ code }) => ["INITIAL_STATE_PHASE_INVALID", "STATE_PHASE_SEQUENCE_PREMATURE"].includes(code)));
});
