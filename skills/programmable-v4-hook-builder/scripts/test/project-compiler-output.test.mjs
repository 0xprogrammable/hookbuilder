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

test("project output gate closes unresolved artifacts and rejects identity, facet, applicability, contract, and package drift deterministically", (t) => {
  const fixture = createUnresolvedOutputFixture(t);
  const reportA = validateProjectOutput(fixture.input);
  const reportB = validateProjectOutput(structuredCloneProjectOutputInput(fixture.input));
  assert.equal(reportA.status, "PROJECT_OUTPUT_DRAFT_UNRESOLVED", canonicalJsonV2(reportA));
  assert.equal(reportA.projection.applicability, "unresolved");
  assert.equal(reportA.submissionPackageStatus, "REVIEW_REQUIRED");
  assert.equal(reportA.evidenceBoundary.approvalCreated, false);
  assert.equal(reportA.evidenceBoundary.auditClaimed, false);
  assert.equal(canonicalJsonV2(reportA), canonicalJsonV2(reportB));
  assert.equal(reportA.reportSha256, reportB.reportSha256);
  assert.match(reportA.artifactHashes.submissionPackageInventory, /^sha256:[0-9a-f]{64}$/u);
  const delegated = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "validate-output",
    "--repository-root",
    fixture.root,
    "--state",
    ".programmable/project-states/000004-repository-materialization.v1.json",
    "--previous-state",
    ".programmable/project-states/000003-architecture-selection.v1.json",
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(delegated.status, 1, delegated.stderr || delegated.stdout);
  const delegatedReport = JSON.parse(delegated.stdout);
  assert.equal(delegatedReport.status, "PROJECT_OUTPUT_DRAFT_UNRESOLVED");

  const delegatedBrief = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "validate-output",
    "--brief",
    "--repository-root",
    fixture.root,
    "--state",
    ".programmable/project-states/000004-repository-materialization.v1.json",
    "--previous-state",
    ".programmable/project-states/000003-architecture-selection.v1.json",
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(delegatedBrief.status, delegated.status, delegatedBrief.stderr || delegatedBrief.stdout);
  assert.equal(delegatedBrief.stderr, "");
  const delegatedBriefReport = JSON.parse(delegatedBrief.stdout);
  assert.equal(delegatedBriefReport.operation, "validate-output");
  assert.equal(delegatedBriefReport.status, delegatedReport.status);
  assert.equal(delegatedBriefReport.reportSha256, delegatedReport.reportSha256);
  assert.deepEqual(delegatedBriefReport.findingCounts, delegatedReport.findingCounts);
  assert.deepEqual(delegatedBriefReport.evidenceBoundary, delegatedReport.evidenceBoundary);
  assert.equal(Object.hasOwn(delegatedBriefReport, "inventory"), false);
  assert.equal(Object.hasOwn(delegatedBriefReport, "findings"), false);

  const unsupportedBrief = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "execute",
    "--brief",
    "--repository-root",
    fixture.root
  ], { encoding: "utf8", shell: false });
  assert.equal(unsupportedBrief.status, 2);
  assert.equal(unsupportedBrief.stdout, "");
  assert.match(unsupportedBrief.stderr, /--brief is accepted only by validate, validate-output, preflight, require-output or diagnose/u);

  const mutate = (change) => {
    const input = structuredCloneProjectOutputInput(fixture.input);
    change(input);
    return validateProjectOutput(input);
  };
  const inventedContract = mutate(({ repositoryPlan }) => { repositoryPlan.schemaVersion = "programmable-mini-repository-plan-v1"; });
  assert.equal(inventedContract.status, "PROJECT_OUTPUT_INVALID");
  assert.ok(inventedContract.findings.some(({ code }) => code === "REPOSITORY_PLAN_SCHEMA_INVALID"));

  const applicationMismatch = mutate(({ projectSpec }) => { projectSpec.applicationId = "invented-application"; });
  assert.ok(applicationMismatch.findings.some(({ code }) => code === "PROJECT_OUTPUT_APPLICATION_ID_MISMATCH"));

  const facetMismatch = mutate(({ projectSpec }) => { projectSpec.facets.routing.entries[0].id = "invented-trade-facet"; });
  assert.ok(facetMismatch.findings.some(({ code }) => code === "PROJECT_OUTPUT_TRADE_FACET_MISMATCH"));

  const applicabilityMismatch = mutate(({ repositoryPlan }) => { repositoryPlan.tradeCapability.applicability = "no-market"; });
  assert.ok(applicabilityMismatch.findings.some(({ code }) => code === "PROJECT_OUTPUT_TRADE_APPLICABILITY_MISMATCH"));

  const boundIdeaPath = path.join(fixture.root, "submission/idea-source.v1.json"), boundIdeaBytes = fs.readFileSync(boundIdeaPath);
  fs.writeFileSync(boundIdeaPath, Buffer.concat([boundIdeaBytes, Buffer.from("\n")]));
  const identityDrift = validateProjectOutput(fixture.input);
  assert.ok(identityDrift.findings.some(({ code, details }) => code === "PROJECT_OUTPUT_SUBMISSION_UNREADABLE" && details?.code === "SUBMISSION_BOUND_FILE_IDENTITY_MISMATCH"));
  fs.writeFileSync(boundIdeaPath, boundIdeaBytes);
  writeFile(fixture.root, "submission/unbound-agent-output.json", "{\"contract\":\"invented\"}\n");
  const orphan = validateProjectOutput(fixture.input);
  assert.ok(orphan.findings.some(({ code }) => code === "PROJECT_OUTPUT_SUBMISSION_ORPHAN_FILE"));
});


test("project output gate blocks legacy-receipt completion and forbids manufactured no-market route evidence", async (t) => {
  const prototype = createNoMarketOpenWorldV2PrototypeFixture("reward-service");
  const project = await createCompleteRepository(t, {
    extraFiles: [...prototype.files].map(([relativePath, bytes]) => [`submission/${relativePath}`, bytes])
  });
  const submissionRoot = path.join(project.root, "submission");
  const input = { ...project.bundle, repositoryRoot: project.root, submissionRoot };
  const report = validateProjectOutput(input);
  assert.equal(report.status, "PROJECT_OUTPUT_INVALID", canonicalJsonV2(report));
  assert.equal(report.projectCompilationStatus, "PROJECT_COMPILATION_VALID");
  assert.equal(report.repositoryCompletion, "NOT_PROVEN");
  assert.equal(report.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");
  assert.ok(report.findings.some(({ code }) => code === "PROJECT_OUTPUT_REPOSITORY_COMPLETION_NOT_PROVEN"));
  assert.equal(report.projection.applicability, "no-market");
  assert.deepEqual(report.projection.markets, []);
  const preflight = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    project.root,
    "--state",
    project.statePath,
    "--previous-state",
    project.previousStatePath,
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(preflight.status, 1, preflight.stderr || preflight.stdout);
  const preflightReport = JSON.parse(preflight.stdout);
  assert.equal(preflightReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.equal(preflightReport.canonicalOutput, false);
  assert.equal(preflightReport.outputBinding.repositoryCompletion, "NOT_PROVEN");
  assert.equal(preflightReport.outputBinding.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");
  assert.equal(preflightReport.outputBinding.reportSha256, report.reportSha256);
  const directPreflight = preflightProjectOutput({
    repositoryRoot: project.root,
    statePath: project.statePath,
    previousStatePath: project.previousStatePath,
    submissionRoot: "submission"
  });
  assert.equal(canonicalJsonV2(directPreflight), canonicalJsonV2(preflightReport));
  assert.equal(preflight.stdout, `${canonicalJsonV2(directPreflight)}\n`);

  const strictFull = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "require-output",
    "--repository-root",
    project.root,
    "--state",
    project.statePath,
    "--previous-state",
    project.previousStatePath,
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  const strictBrief = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "require-output",
    "--brief",
    "--repository-root",
    project.root,
    "--state",
    project.statePath,
    "--previous-state",
    project.previousStatePath,
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(strictFull.status, preflight.status, strictFull.stderr || strictFull.stdout);
  assert.equal(strictFull.stdout, preflight.stdout);
  assert.equal(strictBrief.status, strictFull.status, strictBrief.stderr || strictBrief.stdout);
  assert.equal(strictBrief.stderr, "");
  assert.ok(Buffer.byteLength(strictBrief.stdout) < 2_500, `brief blocked require-output emitted ${Buffer.byteLength(strictBrief.stdout)} bytes`);
  const strictBriefReport = JSON.parse(strictBrief.stdout);
  assert.equal(strictBriefReport.operation, "require-output");
  assert.equal(strictBriefReport.status, preflightReport.status);
  assert.equal(strictBriefReport.reportSha256, preflightReport.reportSha256);
  assert.deepEqual(strictBriefReport.findingCounts, preflightReport.findingCounts);
  assert.deepEqual(strictBriefReport.evidenceBoundary, preflightReport.evidenceBoundary);
  assert.equal(Object.hasOwn(strictBriefReport, "inventory"), false);
  assert.equal(Object.hasOwn(strictBriefReport, "findings"), false);

  const materializing = structuredCloneProjectOutputInput(input);
  materializing.repositoryPlan.completionStatus = "materializing";
  const materializingReport = validateProjectOutput(materializing);
  assert.equal(materializingReport.status, "PROJECT_OUTPUT_INVALID");
  assert.equal(materializingReport.repositoryCompletion, "NOT_PROVEN");
  assert.ok(materializingReport.findings.some(({ code, details }) => code === "PROJECT_OUTPUT_REPOSITORY_COMPLETION_NOT_PROVEN" && details?.planCompletionStatus === "materializing"));

  const manufactured = structuredCloneProjectOutputInput(input);
  manufactured.repositoryPlan.commands.push({
    id: "invented-quote-command",
    kind: "quote-test",
    argv: [process.execPath, "tools/project-stage.mjs", "quote"],
    cwd: ".",
    required: true,
    timeoutMs: 30000,
    executionPolicy: { networkAccess: "forbidden", externalWrites: false }
  });
  const rejected = validateProjectOutput(manufactured);
  assert.ok(rejected.findings.some(({ code }) => code === "PROJECT_OUTPUT_NONTRADABLE_EVIDENCE_FORBIDDEN"));

  const foreignSpec = makeProjectSpec();
  foreignSpec.applicationId = "foreign-reward-service";
  const duplicateGraph = makeProductGraph(makeProjectSpec());
  const foreignManifest = createStandardTradeCapabilityManifestFixtureV1({ applicationId: "foreign-market-app", marketRef: "foreign-market" });
  const poison = new Map([
    ["extras/project-spec.v1.json", Buffer.from(`${canonicalJsonV2(foreignSpec)}\n`)],
    ["extras/product-graph.v1.json", Buffer.from(`${canonicalJsonV2(duplicateGraph)}\n`)],
    ["extras/foreign.trade-capability.v1.json", Buffer.from(`${canonicalJsonV2(foreignManifest)}\n`)]
  ]);
  const poisoned = await createCompleteRepository(t, {
    extraFiles: [
      ...[...prototype.files].map(([relativePath, bytes]) => [`submission/${relativePath}`, bytes]),
      ...poison
    ],
    mutatePlan: (plan) => plan.artifacts.documentation.push(...[...poison].map(([artifactPath, bytes], index) => ({
      id: `foreign-project-metadata-${index}`,
      path: artifactPath,
      kind: "project-metadata",
      systemRefs: ["service-component"],
      required: true,
      status: "verified",
      sha256: sha256(bytes),
      byteLength: bytes.length
    })))
  });
  const poisonedOutput = validateProjectOutput({ ...poisoned.bundle, repositoryRoot: poisoned.root, submissionRoot: path.join(poisoned.root, "submission") });
  assert.equal(poisonedOutput.status, "PROJECT_OUTPUT_INVALID", canonicalJsonV2(poisonedOutput));
  assert.ok(poisonedOutput.findings.some(({ code }) => code === "PROJECT_OUTPUT_REPOSITORY_COMPLETION_NOT_PROVEN"));
  const poisonedPreflight = childProcess.spawnSync(process.execPath, [
    unifiedCli, "project", "preflight", "--repository-root", poisoned.root,
    "--state", poisoned.statePath, "--previous-state", poisoned.previousStatePath, "--submission-root", "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(poisonedPreflight.status, 1, poisonedPreflight.stderr || poisonedPreflight.stdout);
  const poisonedReport = JSON.parse(poisonedPreflight.stdout);
  assert.equal(poisonedReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.deepEqual(poisonedReport.findings.filter(({ code }) => code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_EXTRA").map(({ path: findingPath }) => findingPath), [
    "$.files.extras/product-graph.v1.json",
    "$.files.extras/project-spec.v1.json"
  ]);
  assert.ok(poisonedReport.findings.some(({ code, path: findingPath, details }) => code === "PROJECT_PREFLIGHT_MACHINE_ARTIFACT_INVALID"
    && findingPath === "$.files.extras/foreign.trade-capability.v1.json"
    && details?.validatorCodes?.includes("FROZEN_TRADE_MANIFEST_V1_CURRENT_PREFLIGHT_FORBIDDEN_SCHEMA_INVALID")));

  const poisonedBrief = childProcess.spawnSync(process.execPath, [
    unifiedCli, "project", "preflight", "--brief", "--repository-root", poisoned.root,
    "--state", poisoned.statePath, "--previous-state", poisoned.previousStatePath, "--submission-root", "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(poisonedBrief.status, poisonedPreflight.status, poisonedBrief.stderr || poisonedBrief.stdout);
  assert.equal(poisonedBrief.stderr, "");
  assert.ok(Buffer.byteLength(poisonedBrief.stdout) < 2_500, `brief blocked preflight emitted ${Buffer.byteLength(poisonedBrief.stdout)} bytes`);
  assert.ok(Buffer.byteLength(poisonedBrief.stdout) < Buffer.byteLength(poisonedPreflight.stdout));
  const briefReport = JSON.parse(poisonedBrief.stdout);
  assert.equal(briefReport.kind, "project-compiler-brief");
  assert.equal(briefReport.operation, "preflight");
  assert.equal(briefReport.status, poisonedReport.status);
  assert.equal(briefReport.reportSha256, poisonedReport.reportSha256);
  assert.deepEqual(briefReport.findingCounts, poisonedReport.findingCounts);
  assert.deepEqual(briefReport.evidenceBoundary, poisonedReport.evidenceBoundary);
  assert.equal(briefReport.canonicalOutput, poisonedReport.canonicalOutput);
  assert.ok(briefReport.findingGroups.items.length <= 3);
  assert.equal(new Set(briefReport.findingGroups.items.map(({ code }) => code)).size, briefReport.findingGroups.items.length);
  assert.equal(briefReport.findingGroups.displayed, briefReport.findingGroups.items.length);
  assert.equal(briefReport.findingGroups.distinct, new Set(poisonedReport.findings.map(({ code }) => code)).size);
  assert.equal(briefReport.findingGroups.omitted, briefReport.findingGroups.distinct - briefReport.findingGroups.displayed);
  assert.equal(Object.hasOwn(briefReport, "inventory"), false);
  assert.equal(Object.hasOwn(briefReport, "findings"), false);
  assert.deepEqual(briefReport.fullReport, {
    available: true,
    instruction: "Rerun the same command without --brief for the complete canonical JSON report."
  });
});


test("project output gate blocks a legacy-receipt COMPLETE tradable prototype and fails closed on all drift", async (t) => {
  const fixture = await createTradableOutputFixture(t);
  const report = validateProjectOutput(fixture.input);
  assert.equal(report.status, "PROJECT_OUTPUT_INVALID", canonicalJsonV2(report));
  assert.equal(report.projectCompilationStatus, "PROJECT_COMPILATION_INVALID");
  assert.equal(report.repositoryCompletion, "NOT_PROVEN");
  assert.equal(report.commandExecutionEvidence, "NOT_PROVEN");
  assert.ok(report.findings.some(({ code }) => code === "FROZEN_TRADE_MANIFEST_V1_FORBIDDEN"));
  assert.ok(report.findings.some(({ code }) => code === "PROJECT_OUTPUT_REPOSITORY_COMPLETION_NOT_PROVEN"));
  assert.equal(report.projection.applicability, "tradable");
  assert.deepEqual(report.projection.markets, ["main-market"]);
  assert.equal(report.evidenceBoundary.commandsReexecuted, false);
  assert.equal(report.evidenceBoundary.approvalCreated, false);
  const preflight = childProcess.spawnSync(process.execPath, [
    unifiedCli,
    "project",
    "preflight",
    "--repository-root",
    fixture.input.repositoryRoot,
    "--state",
    ".programmable/project-states/000005-verification.v1.json",
    "--previous-state",
    ".programmable/project-states/000004-repository-materialization.v1.json",
    "--submission-root",
    "submission"
  ], { encoding: "utf8", shell: false });
  assert.equal(preflight.status, 1, preflight.stderr || preflight.stdout);
  const preflightReport = JSON.parse(preflight.stdout);
  assert.equal(preflightReport.status, "PROJECT_PREFLIGHT_BLOCKED");
  assert.equal(preflightReport.canonicalOutput, false);
  assert.equal(preflightReport.outputBinding.repositoryCompletion, "NOT_PROVEN");
  assert.equal(preflightReport.outputBinding.reportSha256, report.reportSha256);

  const mutate = (change) => {
    const input = structuredCloneProjectOutputInput(fixture.input);
    change(input);
    return validateProjectOutput(input);
  };
  const incomplete = mutate(({ repositoryPlan }) => { repositoryPlan.completionStatus = "materializing"; });
  assert.ok(incomplete.findings.some(({ code }) => code === "PROJECT_OUTPUT_TRADABLE_COMPLETE_REQUIRED"));

  const marketDrift = mutate(({ repositoryPlan }) => { repositoryPlan.tradeCapability.markets[0].marketSystemRef = "invented-market"; });
  assert.ok(marketDrift.findings.some(({ code }) => code === "PROJECT_OUTPUT_PLAN_MARKET_BIJECTION_INVALID"));

  const routeDrift = mutate(({ repositoryPlan }) => { repositoryPlan.tradeCapability.markets[0].routeType = "canonical-programmable-adapter"; });
  assert.ok(routeDrift.findings.some(({ code }) => code === "PROJECT_OUTPUT_ROUTE_TYPE_MISMATCH"));

  const manifestDrift = mutate(({ repositoryPlan }) => {
    const artifact = repositoryPlan.artifacts.configuration.find(({ kind }) => kind === "trade-capability-manifest");
    artifact.sha256 = `sha256:${"0".repeat(64)}`;
  });
  assert.ok(manifestDrift.findings.some(({ code }) => code === "PROJECT_OUTPUT_MANIFEST_BYTES_MISMATCH"));
});
