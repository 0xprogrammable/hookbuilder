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
  sealProjectState, validateProjectState, validateFrozenLegacyTradeManifestV1RepositoryPlan, validateRepositoryPlan, validateAgainstSchema,
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

test("repository plans cannot claim COMPLETE from hashes alone or omit contract and v4 proof", () => {
  const bundle = makeArchitectureBundle();
  const plan = makePlanningRepositoryPlan(bundle);
  plan.completionStatus = "COMPLETE";
  const hashOnly = validateRepositoryPlan(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, plan);
  assert.ok(hashOnly.some(({ code }) => code === "REPOSITORY_FILES_NOT_VERIFIED"));
  assert.ok(hashOnly.some(({ code }) => code === "COMPLETE_ARTIFACT_NOT_VERIFIED"));

  const forcedRoute = makePlanningRepositoryPlan(bundle);
  forcedRoute.artifacts.configuration.push({ ...forcedRoute.artifacts.configuration[0], id: "forced-route", path: ".programmable/trade-capabilities/fake-market.v1.json", kind: "trade-capability-manifest" });
  assert.ok(validateRepositoryPlan(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, forcedRoute).some(({ code }) => code === "NO_MARKET_TRADE_EVIDENCE_FORBIDDEN"));

  const mismatchedDisposition = makePlanningRepositoryPlan(bundle);
  mismatchedDisposition.tradeCapability.applicability = "unresolved";
  assert.ok(validateRepositoryPlan(bundle.projectSpec, bundle.productGraph, bundle.architectureCandidates, mismatchedDisposition).some(({ code }) => code === "TRADE_APPLICABILITY_MISMATCH"));

  const unresolvedSpec = makeProjectSpec();
  unresolvedSpec.facets.routing.applicability = "unresolved";
  unresolvedSpec.facets.routing.entries[0].applicability = "unresolved";
  const unresolvedGraph = makeProductGraph(unresolvedSpec);
  const unresolvedArchitectures = makeArchitectures(unresolvedSpec, unresolvedGraph);
  const unresolvedPlan = makePlanningRepositoryPlan({ projectSpec: unresolvedSpec, productGraph: unresolvedGraph, architectureCandidates: unresolvedArchitectures });
  unresolvedPlan.tradeCapability.applicability = "unresolved";
  unresolvedPlan.completionStatus = "COMPLETE";
  assert.ok(validateRepositoryPlan(unresolvedSpec, unresolvedGraph, unresolvedArchitectures, unresolvedPlan).some(({ code }) => code === "UNRESOLVED_TRADE_CAPABILITY_COMPLETE_FORBIDDEN"));

  const contractGraph = structuredClone(bundle.productGraph);
  contractGraph.graphs.system.nodes[0].type = "contract";
  contractGraph.graphs.system.nodes[0].protocolRole = "uniswap-v4-hook";
  contractGraph.graphs.component.components[0].type = "hook";
  contractGraph.graphs.deployment.targets[0].type = "contract";
  const v4Architectures = makeArchitectures(bundle.projectSpec, contractGraph);
  v4Architectures.candidates[0].v4Usage.customHook = {
    disposition: "required",
    systemNodeRefs: ["settlement-service"],
    rationale: "The selected candidate requires atomic pool callbacks."
  };
  v4Architectures.productGraphSha256 = projectArtifactSha256(contractGraph);
  const v4Plan = makePlanningRepositoryPlan({ ...bundle, productGraph: contractGraph, architectureCandidates: v4Architectures });
  const v4Findings = validateRepositoryPlan(bundle.projectSpec, contractGraph, v4Architectures, v4Plan);
  assert.ok(v4Findings.some(({ code }) => code === "PROJECT_TOOLCHAIN_LOCK_CARDINALITY_INVALID"));
  assert.ok(v4Findings.some(({ code }) => code === "V4_SEMANTIC_CONTRACT_REQUIRED"));
  assert.ok(v4Findings.some(({ code, details }) => code === "REPOSITORY_COMMAND_KIND_MISSING" && details.kind === "fork"));
});


test("tradable RepositoryPlans project selected standard-v4 and canonical-adapter markets bijectively", () => {
  for (const routeType of ["standard-uniswap-v4", "canonical-programmable-adapter"]) {
    const fixture = makeTradablePlanningBundle(routeType);
    assert.deepEqual(validateProjectSpec(fixture.projectSpec), []);
    assert.deepEqual(validateProductGraph(fixture.projectSpec, fixture.productGraph), []);
    assert.deepEqual(validateArchitectureCandidates(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates), []);
    assert.ok(validateRepositoryPlan(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates, fixture.repositoryPlan).some(({ code }) => code === "FROZEN_TRADE_MANIFEST_V1_FORBIDDEN"));
    assert.deepEqual(validateFrozenLegacyTradeManifestV1RepositoryPlan(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates, fixture.repositoryPlan), []);

    const missingManifest = structuredClone(fixture.repositoryPlan);
    missingManifest.artifacts.configuration = missingManifest.artifacts.configuration.filter(({ kind }) => kind !== "trade-capability-manifest");
    assert.ok(validateFrozenLegacyTradeManifestV1RepositoryPlan(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates, missingManifest).some(({ code }) => code === "TRADE_CAPABILITY_MANIFEST_REQUIRED"));

    const orphanResult = structuredClone(fixture.repositoryPlan);
    orphanResult.artifacts.evidence.push({ ...orphanResult.artifacts.evidence.find(({ kind }) => kind === "trade-test-result"), id: "orphan-trade-result", path: ".programmable/trade-test-results/orphan.v1.json" });
    assert.ok(validateFrozenLegacyTradeManifestV1RepositoryPlan(fixture.projectSpec, fixture.productGraph, fixture.architectureCandidates, orphanResult).some(({ code }) => code === "TRADE_RESULT_ARTIFACT_CARDINALITY_INVALID"));

    const unresolvedMarket = structuredClone(fixture.productGraph);
    unresolvedMarket.graphs.system.nodes.find(({ id }) => id === "primary-market").implementationStatus = "external-unresolved";
    assert.ok(validateProductGraph(fixture.projectSpec, unresolvedMarket).some(({ code }) => code === "TRADE_MARKET_GRAPH_REQUIRED"));
  }
});


test("v4 semantic RepositoryPlan records require the exact version and bundled validator path", () => {
  const repositoryPlanSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/repository-plan-v1.schema.json"), "utf8"));
  const schema = { $schema: repositoryPlanSchema.$schema, $id: "urn:programmable:test:v4-semantic-record", $ref: "#/$defs/v4HookSemanticContract", $defs: repositoryPlanSchema.$defs };
  const record = { systemRef: "v4-hook-system", contractVersion: "1.0.0", validatorPath: "scripts/v4-hook-semantic-contract-core.mjs", profileArtifactId: "primary-market-v4-hook-semantic", sourceArtifactIds: ["programmable-volume-fee-hook-v2"], deploymentArtifactIds: ["primary-market-v4-deployment-preimage", "primary-market-v4-deployment-manifest", "primary-market-v4-runtime-code"], evidenceArtifactIds: ["primary-market-mainnet-fork-canary"] };
  assert.deepEqual(validateAgainstSchema(record, schema), []);
  for (const field of ["contractVersion", "validatorPath"]) {
    const missing = structuredClone(record); delete missing[field];
    assert.notDeepEqual(validateAgainstSchema(missing, schema), [], field);
  }
});


test("productive standard-v4 fee return API exposes its local vector-set reference", () => {
  const source = fs.readFileSync(path.join(skillRoot, "scripts/open-world-v2-draft-core.mjs"), "utf8");
  assert.match(source, /const vectorSetRef = `fee-vector-set-\$\{trade\.marketRef\}`;/u);
  assert.match(source, /feeConformance: Object\.freeze\(\{[^}]*vectorSet, vectorSetRef, vectorSetBytes,/u);
});


test("productive tradable plan preserves Foundry artifacts until every typed trade replay completes", () => {
  const source = fs.readFileSync(path.join(skillRoot, "scripts/project-tradable-authoring-core.mjs"), "utf8"), trade = source.indexOf("for (const evidenceCommand of tradeEvidence.commands)"), slither = source.indexOf('commands.push(command("slither-command"', trade);
  assert.ok(trade >= 0 && slither > trade); assert.match(source, /full:\["forge",\["test","--offline","-q","--no-match-path","\$\{forkTest\}"\]\]/u);
});
