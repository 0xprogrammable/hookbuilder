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

test("tradable execution authors distinct typed quote and execution results with closed receipt bindings", async (t) => {
  const fixture = createMaterializedTradableRepository(t);
  assert.deepEqual(validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    fixture.plan
  ), []);

  const execution = await executeProjectCommands({
    repositoryRoot: fixture.root,
    repositoryPlan: fixture.plan,
    outputPlanPath: ".programmable/repository-plan.v1.json"
  });
  assert.equal(execution.status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");
  assert.equal(execution.approvalCreated, false);
  assert.equal(execution.externalActionsPerformed.length, 0);
  assert.equal(execution.tradeResultPaths.length, fixture.manifest.testEvidence.quoteTests.length + fixture.manifest.testEvidence.executionTests.length);
  assert.equal(new Set([...execution.receiptPaths, ...execution.tradeResultPaths]).size, execution.receiptPaths.length + execution.tradeResultPaths.length);

  git(fixture.root, ["add", ".programmable"]);
  git(fixture.root, ["commit", "-qm", "record typed trade execution evidence"]);
  const completed = execution.repositoryPlan;
  assert.deepEqual(validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    completed,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  ), []);

  const resultArtifact = completed.artifacts.evidence.find(({ kind }) => kind === "trade-test-result");
  const commandId = resultArtifact.id.slice(0, -"-result".length);
  const receiptArtifact = completed.artifacts.evidence.find(({ id }) => id === `${commandId}-receipt`);
  const receipt = JSON.parse(fs.readFileSync(path.join(fixture.root, receiptArtifact.path), "utf8"));
  assert.equal(receipt.domainEvidence.contract, "trade-command-domain-evidence-v1");
  assert.equal(receipt.domainEvidence.semanticAdequacy, "PARTIAL_EVIDENCE");
  assert.equal(receipt.domainEvidence.runnerEvidence.contract, "forge-test-json-v1");
  assert.equal(receipt.domainEvidence.runnerEvidence.testsObserved, 1);
  assert.equal(receipt.domainEvidence.runnerEvidence.passedTests, 1);
  assert.equal(receipt.domainEvidence.runnerEvidence.callEvidence[0].role, commandId.startsWith("quote-") ? "quote-target" : "execution-target");
  assert.equal(receipt.domainEvidence.resultArtifactPath, resultArtifact.path);
  assert.notEqual(receipt.stdoutSha256, resultArtifact.sha256);
  const negativeTest = fixture.manifest.testEvidence.executionTests.find(({ scenario }) => scenario === "expired-deadline-revert");
  const negativeReceiptArtifact = completed.artifacts.evidence.find(({ id }) => id === `${negativeTest.commandId}-receipt`);
  const negativeReceipt = JSON.parse(fs.readFileSync(path.join(fixture.root, negativeReceiptArtifact.path), "utf8"));
  const negativeCall = negativeReceipt.domainEvidence.runnerEvidence.callEvidence.find(({ role }) => role === "execution-target");
  assert.equal(negativeCall.outcome, "reverted");
  assert.equal(negativeCall.outputSha256, negativeTest.expectedRevertDataSha256);
  receipt.domainEvidence.resultArtifactSha256 = sha256(Buffer.from("tampered trade result"));
  writeFile(fixture.root, receiptArtifact.path, `${canonicalJsonV2(receipt)}\n`);
  const mutationFindings = validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    completed,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  );
  assert.ok(mutationFindings.some(({ code }) => code === "TRADE_DOMAIN_RECEIPT_BINDING_MISMATCH"));
});


test("executor batches tracking inspection across bounded artifact path groups", async (t) => {
  const extraFiles = Array.from({ length: 129 }, (_, index) => [`evidence/batch-${index}.txt`, `batch ${index}\n`]);
  const fixture = createMaterializedRepository(t, {
    extraFiles,
    setup: (root, plan) => {
      for (const [index, [artifactPath]] of extraFiles.entries()) {
        const bytes = fs.readFileSync(path.join(root, artifactPath));
        plan.artifacts.evidence.push({
          id: `batch-artifact-${index}`,
          path: artifactPath,
          kind: "batch-evidence",
          systemRefs: ["service-component"],
          required: true,
          status: "verified",
          sha256: sha256(bytes),
          byteLength: bytes.length
        });
      }
    }
  });
  const execution = await executeProjectCommands({
    repositoryRoot: fixture.root,
    repositoryPlan: fixture.plan,
    outputPlanPath: ".programmable/repository-plan.v1.json"
  });
  assert.equal(execution.status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");
});


test("Forge runner evidence rejects zero tests and a one-PASS canonical result printer without route calls", () => {
  const manifest = createStandardTradeCapabilityManifestFixtureV1({ applicationId: "runner-regression", marketRef: "primary-market" });
  const declaration = manifest.testEvidence.quoteTests[0];
  const zero = inspectForgeTradeTestRunnerOutputV1("{}\n", declaration);
  assert.equal(zero.valid, false);
  assert.equal(zero.error.code, "TRADE_TEST_RUNNER_ZERO_TESTS");

  const result = createTradeTestResultFixturesV1(manifest).get(declaration.resultArtifactPath);
  const fabricated = {
    [`${declaration.command.argv[6]}:FabricatedTradeTest`]: {
      duration: "1ms",
      test_results: {
        [declaration.runnerTestSignature]: {
          status: "Success",
          reason: null,
          decoded_logs: [`PROGRAMMABLE_TRADE_RESULT_V1:${canonicalJsonV2(result)}\n`],
          kind: { Unit: { gas: 1 } },
          traces: []
        }
      },
      warnings: []
    }
  };
  const printer = inspectForgeTradeTestRunnerOutputV1(`${canonicalJsonV2(fabricated)}\n`, declaration);
  assert.equal(printer.valid, false);
  assert.equal(printer.error.code, "TRADE_TEST_TRACE_EVIDENCE_MISSING");
});


test("standard V4Quoter evidence requires a real CALL trace while adapter quotes retain STATICCALL", () => {
  const manifest = createStandardTradeCapabilityManifestFixtureV1({ applicationId: "v4-quoter-call-regression", marketRef: "primary-market" });
  const declaration = structuredClone(manifest.testEvidence.quoteTests[0]);
  const result = structuredClone(createTradeTestResultFixturesV1(manifest).get(declaration.resultArtifactPath));
  // Captured from the byte-identical V2 kernel's pinned V4Quoter during a clean Forge -vvvv run.
  const quoterAddress = "0x13aa49bac059d709dd0a18d6bb63290076a702d7";
  const quoteCalldata = "0xaa9d21cb0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000015cf58144ef33af1e14b5208015d11f9143e27b90000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000000003c00000000000000000000000010fd02f4021ee8a06ce487fb32658969090e60cc00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000";
  const quoteOutput = "0x0000000000000000000000000000000000000000000000000d68796fa838ac9b00000000000000000000000000000000000000000000000000000000000310cb";
  declaration.targetAddress = quoterAddress;
  result.context.route.quoteTarget = quoterAddress;
  result.observation.callBinding.target = quoterAddress;
  result.observation.callDataSha256 = sha256(Buffer.from(quoteCalldata.slice(2), "hex"));
  result.observation.returnDataSha256 = sha256(Buffer.from(quoteOutput.slice(2), "hex"));
  result.observation.callBinding.calldataSha256 = result.observation.callDataSha256;
  result.observation.callBinding.reencodedCalldataSha256 = result.observation.callDataSha256;
  assert.equal(expectedTradeRunnerCallsV1(result, declaration)[0].callKind, "CALL");

  const forgeOutput = (callKind) => ({
    [`${declaration.command.argv[6]}:RealV4QuoterTraceTest`]: {
      duration: "1ms",
      test_results: {
        [declaration.runnerTestSignature]: {
          status: "Success",
          reason: null,
          decoded_logs: [`PROGRAMMABLE_TRADE_RESULT_V1:${canonicalJsonV2(result)}\n`],
          kind: { Unit: { gas: 1 } },
          traces: [["Execution", {
            arena: [{
              trace: {
                kind: callKind,
                address: declaration.targetAddress,
                data: quoteCalldata,
                output: quoteOutput,
                success: true,
                status: "Return"
              }
            }]
          }]]
        }
      },
      warnings: []
    }
  });

  const call = inspectForgeTradeTestRunnerOutputV1(`${canonicalJsonV2(forgeOutput("CALL"))}\n`, declaration);
  assert.equal(call.valid, true, call.error?.message);
  assert.equal(call.execution.runnerEvidence.callEvidence[0].callKind, "CALL");

  const staticcall = inspectForgeTradeTestRunnerOutputV1(`${canonicalJsonV2(forgeOutput("STATICCALL"))}\n`, declaration);
  assert.equal(staticcall.valid, false);
  assert.equal(staticcall.error.code, "TRADE_TEST_TRACE_BINDING_INVALID");

  const adapterResult = structuredClone(result);
  adapterResult.context.route.type = "canonical-programmable-adapter";
  assert.equal(expectedTradeRunnerCallsV1(adapterResult, declaration)[0].callKind, "STATICCALL");
});


test("validated trade receipts normalize duration, warning, object-order, and trace-order drift", () => {
  const firstRaw = deterministicForgeOutput({ suiteDuration: "1ms", testDuration: "2ms", warning: "first", unrelatedFirst: true });
  const secondRaw = deterministicForgeOutput({ suiteDuration: "99ms", testDuration: "101ms", warning: "second", unrelatedFirst: false, reverseKeys: true });
  assert.notEqual(sha256Bytes(Buffer.from(firstRaw)), sha256Bytes(Buffer.from(secondRaw)));
  const first = deterministicTradeReceipt(firstRaw);
  const second = deterministicTradeReceipt(secondRaw);
  assert.equal(first.stdoutSha256, second.stdoutSha256);
  assert.equal(first.stdoutByteLength, second.stdoutByteLength);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(first.domainEvidence.runnerEvidence.runnerOutputSha256, first.stdoutSha256);
  assert.equal(first.domainEvidence.runnerEvidence.runnerOutputByteLength, first.stdoutByteLength);
  assert.equal(first.executionPolicy.maximumOutputBytes, PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.deepEqual(validateAgainstSchema(first, commandReceiptSchema), []);
});


test("validated trade receipt identity binds exact suite and rejects gas, decoded-log, and relevant-call drift", () => {
  const baseline = deterministicTradeReceipt(deterministicForgeOutput({}));
  const renamed = deterministicTradeReceipt(deterministicForgeOutput({ suiteName: "test/Route.t.sol:RenamedRouteTest" }));
  assert.notEqual(renamed.stdoutSha256, baseline.stdoutSha256);
  for (const mutate of [
    (output) => { output[deterministicSuite].test_results["testQuote()"].kind.Unit.gas = 124; },
    (output) => { output[deterministicSuite].test_results["testQuote()"].decoded_logs[0] += " "; }
  ]) assert.throws(() => deterministicTradeReceipt(deterministicForgeOutput({ mutate })), ({ code }) => code === "TRADE_RECEIPT_NORMALIZATION_DRIFT");
  const parserBoundRaw = deterministicForgeOutput({});
  for (const mutate of [
    (output) => { deterministicRelevantTrace(output).output = "0xdd"; },
    (output) => { output[deterministicSuite].test_results["testQuote()"].traces[0][1].arena.push({ trace: { ...deterministicRelevantTrace(output) } }); }
  ]) assert.throws(() => deterministicTradeReceipt(deterministicForgeOutput({ mutate }), parserBoundRaw), ({ code }) => code === "TRADE_RECEIPT_NORMALIZATION_DRIFT");
});


test("non-trade receipts retain exact raw stdout identity and cannot claim the trade output cap", () => {
  const nonTrade = { ...deterministicCommand, id: "build-primary", kind: "build", argv: ["npm", "run", "build"] };
  const make = (stdout) => createProjectCommandReceipt({
    repositoryPlan: { ...deterministicPlan, commands: [nonTrade] }, command: nonTrade,
    source: deterministicSource, tool: deterministicTool, executionResult: { stdout, stderr: "" },
    maximumOutputBytes: PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES
  });
  const first = make("first\n");
  assert.equal(projectCommandMaximumOutputBytes(nonTrade), PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.equal(first.executionPolicy.maximumOutputBytes, PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.notEqual(first.stdoutSha256, make("second\n").stdoutSha256);
  const oversized = structuredClone(first);
  oversized.executionPolicy.maximumOutputBytes = PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES;
  assert.ok(validateAgainstSchema(oversized, commandReceiptSchema).some(({ path: issuePath }) => issuePath.endsWith(".executionPolicy.maximumOutputBytes")));
});


test("validated Forge trade parser accepts an explicit narrow high-volume bound", () => {
  const raw = deterministicForgeOutput({});
  const declaration = {
    commandId: deterministicCommand.id, runnerContract: "forge-test-json-v1", runnerTestSignature: "testQuote()", resultContract: "trade-quote-test-result-v1",
    command: { argv: deterministicCommand.argv, workingDirectory: "." },
    testSourceArtifact: { path: "test/Route.t.sol", sha256: `sha256:${"4".repeat(64)}`, byteLength: 1 }
  };
  const boundedOut = inspectForgeTradeTestRunnerOutputV1(raw, declaration, deterministicCommand.id, { maxSourceBytes: Buffer.byteLength(raw) - 1, maxNodes: 1000 });
  assert.equal(boundedOut.valid, false);
  assert.equal(boundedOut.error.cause, "STRICT_JSON_SOURCE_LIMIT");
  assert.equal(inspectForgeTradeTestRunnerOutputV1(raw, declaration, deterministicCommand.id, { maxSourceBytes: Buffer.byteLength(raw), maxNodes: 1000 }).valid, true);
});


test("executor receipts survive an evidence-only commit while static completion stays unproven", async (t) => {
  const fixture = await createCompleteRepository(t);
  const planFindings = validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    fixture.bundle.repositoryPlan,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  );
  assert.deepEqual(planFindings, []);

  const result = childProcess.spawnSync(process.execPath, [
    compilerCli,
    "validate",
    "--repository-root",
    fixture.root,
    "--state",
    fixture.statePath,
    "--previous-state",
    fixture.previousStatePath
  ], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "PROJECT_COMPILATION_VALID");
  assert.equal(report.repositoryCompletion, "NOT_PROVEN");
  assert.equal(report.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");
  assert.equal(report.evidenceBoundary.commandsReexecuted, false);
  assert.equal(report.evidenceBoundary.receiptIssuerAuthenticated, false);
  assert.deepEqual(report.evidenceBoundary.externalActionsPerformed, []);
  assert.equal(report.evidenceBoundary.approvalCreated, false);
  assert.equal(report.evidenceBoundary.auditClaimed, false);

  const cloneParent = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-clone-"));
  t.after(() => fs.rmSync(cloneParent, { recursive: true, force: true }));
  const cloneRoot = path.join(cloneParent, "project");
  const clone = childProcess.spawnSync("git", ["clone", "-q", fixture.root, cloneRoot], { encoding: "utf8", shell: false });
  assert.equal(clone.status, 0, clone.stderr);
  const clonedValidation = childProcess.spawnSync(process.execPath, [
    compilerCli,
    "validate",
    "--repository-root",
    cloneRoot,
    "--state",
    fixture.statePath,
    "--previous-state",
    fixture.previousStatePath
  ], { encoding: "utf8", shell: false });
  assert.equal(clonedValidation.status, 0, clonedValidation.stderr || clonedValidation.stdout);
  const clonedReport = JSON.parse(clonedValidation.stdout);
  assert.equal(clonedReport.repositoryCompletion, "NOT_PROVEN");
  assert.equal(clonedReport.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");

  const changed = path.join(fixture.root, "src/app.mjs");
  fs.appendFileSync(changed, "// drift\n");
  const driftFindings = validateRepositoryPlan(
    fixture.bundle.projectSpec,
    fixture.bundle.productGraph,
    fixture.bundle.architectureCandidates,
    fixture.bundle.repositoryPlan,
    { repositoryRoot: fixture.root, verifyRepositoryFiles: true }
  );
  assert.ok(driftFindings.some(({ code }) => ["REPOSITORY_ARTIFACT_HASH_MISMATCH", "PROJECT_SOURCE_DIRTY"].includes(code)));
});


test("executor and COMPLETE validation reject repeated, no-op, symlinked, timed-out, drifted, and fabricated evidence", async (t) => {
  const cliFixture = createMaterializedRepository(t);
  const materializingPlanPath = ".programmable/repository-plan.materializing.v1.json";
  writeFile(cliFixture.root, materializingPlanPath, `${canonicalJsonV2(cliFixture.plan)}\n`);
  const executed = childProcess.spawnSync(process.execPath, [
    compilerCli,
    "execute",
    "--repository-root",
    cliFixture.root,
    "--plan",
    materializingPlanPath,
    "--output-plan",
    ".programmable/repository-plan.v1.json"
  ], { encoding: "utf8", shell: false, timeout: 30000 });
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.equal(JSON.parse(executed.stdout).status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");

  const repeated = createMaterializedRepository(t, { mutatePlan: (plan) => { plan.commands[1].argv = [...plan.commands[0].argv]; } });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: repeated.root, repositoryPlan: repeated.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_REPEATED"
  );

  const noOp = createMaterializedRepository(t, { mutatePlan: (plan) => { plan.commands[0].argv = [process.execPath, "--version"]; } });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: noOp.root, repositoryPlan: noOp.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_NOOP_FORBIDDEN"
  );

  const symlinked = createMaterializedRepository(t, {
    setup: (root, plan) => { fs.symlinkSync(".", path.join(root, "linked")); plan.commands[0].cwd = "linked"; }
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: symlinked.root, repositoryPlan: symlinked.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_CWD_SYMLINK"
  );

  const timedOut = createMaterializedRepository(t, {
    extraFiles: [["tools/slow-stage.mjs", "setTimeout(() => {}, 10000);\n"]],
    mutatePlan: (plan) => { plan.commands[0].argv = [process.execPath, "tools/slow-stage.mjs"]; plan.commands[0].timeoutMs = 100; }
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: timedOut.root, repositoryPlan: timedOut.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_TIMEOUT"
  );

  const drifted = createMaterializedRepository(t, {
    extraFiles: [["tools/drift-stage.mjs", "import fs from 'node:fs';\nfs.appendFileSync('src/app.mjs', '// changed\\n');\n"]],
    mutatePlan: (plan) => { plan.commands[0].argv = [process.execPath, "tools/drift-stage.mjs"]; }
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: drifted.root, repositoryPlan: drifted.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => ["PROJECT_SOURCE_DIRTY", "PROJECT_SOURCE_DRIFT"].includes(code)
  );

  const ignoredEvidence = createMaterializedRepository(t, {
    extraFiles: [[".gitignore", "node_modules/\n.programmable/repository-plan.materializing.v1.json\n.programmable/repository-plan.v1.json\n"]]
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: ignoredEvidence.root, repositoryPlan: ignoredEvidence.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_EXECUTION_OUTPUT_IGNORED"
  );

  const fabricated = await createCompleteRepository(t);
  const forgedPlan = structuredClone(fabricated.bundle.repositoryPlan);
  const receiptArtifact = forgedPlan.artifacts.evidence.find(({ kind }) => kind === "command-receipt");
  const receiptPath = path.join(fabricated.root, receiptArtifact.path);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  delete receipt.executor;
  const forgedBytes = Buffer.from(`${canonicalJsonV2(receipt)}\n`);
  fs.writeFileSync(receiptPath, forgedBytes);
  receiptArtifact.sha256 = sha256(forgedBytes);
  receiptArtifact.byteLength = forgedBytes.length;
  writeFile(fabricated.root, ".programmable/repository-plan.v1.json", `${canonicalJsonV2(forgedPlan)}\n`);
  git(fabricated.root, ["add", ".programmable"]);
  git(fabricated.root, ["commit", "-qm", "attempt fabricated receipt"]);
  const forgedFindings = validateRepositoryPlan(
    fabricated.bundle.projectSpec,
    fabricated.bundle.productGraph,
    fabricated.bundle.architectureCandidates,
    forgedPlan,
    { repositoryRoot: fabricated.root, verifyRepositoryFiles: true }
  );
  assert.ok(forgedFindings.some(({ code }) => ["COMMAND_RECEIPT_SCHEMA_INVALID", "COMMAND_RECEIPT_EXECUTOR_BINDING_MISMATCH"].includes(code)));
});


test("executor resolves portable node argv through sanitized PATH and binds the exact runtime identity", async (t) => {
  const fixture = createMaterializedRepository(t);
  const shimRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-node-path-shim-"));
  t.after(() => fs.rmSync(shimRoot, { recursive: true, force: true }));
  fs.symlinkSync(process.execPath, path.join(shimRoot, process.platform === "win32" ? "node.exe" : "node"));
  const previousPath = process.env.PATH;
  process.env.PATH = [shimRoot, previousPath].filter(Boolean).join(path.delimiter);
  let execution;
  try {
    execution = await executeProjectCommands({ repositoryRoot: fixture.root, repositoryPlan: fixture.plan, outputPlanPath: ".programmable/repository-plan.v1.json" });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  assert.equal(execution.status, "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT");
  assert.ok(execution.repositoryPlan.commands.every(({ argv }) => argv[0] === "node"));
  const nodeBytes = fs.readFileSync(process.execPath);
  for (const receiptPath of execution.receiptPaths) {
    const receipt = JSON.parse(fs.readFileSync(path.join(fixture.root, receiptPath), "utf8"));
    assert.equal(receipt.tool.requested, "node");
    assert.equal(receipt.tool.resolvedPath, fs.realpathSync(process.execPath));
    assert.equal(receipt.tool.byteLength, nodeBytes.length);
    assert.equal(receipt.tool.sha256, sha256(nodeBytes));
    assert.equal(childProcess.spawnSync(receipt.tool.resolvedPath, ["--version"], { encoding: "utf8", shell: false }).stdout.trim(), process.version);
  }
});


test("valid no-op package receipts and self-consistent forgeries remain statically untrusted", async (t) => {
  const fixture = await createCompleteRepository(t, {
    extraFiles: [["package.json", '{"scripts":{"pretend":"node -e \\"process.exit(0)\\""}}\n']],
    mutatePlan: (plan) => { plan.commands[0].argv = ["npm", "run", "--silent", "pretend"]; }
  });
  const plan = structuredClone(fixture.bundle.repositoryPlan);
  const receiptArtifact = plan.artifacts.evidence.find(({ id }) => id === "install-command-receipt");
  const receiptPath = path.join(fixture.root, receiptArtifact.path);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  const forgedStdout = Buffer.from("forged output never emitted by the package script\n");
  receipt.stdoutSha256 = sha256(forgedStdout);
  receipt.stdoutByteLength = forgedStdout.length;
  const { receiptSha256: _receiptSha256, ...receiptPayload } = receipt;
  receipt.receiptSha256 = canonicalJsonSha256V2(receiptPayload);
  const receiptBytes = Buffer.from(`${canonicalJsonV2(receipt)}\n`);
  fs.writeFileSync(receiptPath, receiptBytes);
  receiptArtifact.sha256 = sha256(receiptBytes);
  receiptArtifact.byteLength = receiptBytes.length;
  plan.commandResults.find(({ commandId }) => commandId === receipt.commandId).stdoutSha256 = receipt.stdoutSha256;
  writeFile(fixture.root, ".programmable/repository-plan.v1.json", `${canonicalJsonV2(plan)}\n`);

  const first = makeState({ projectSpec: fixture.bundle.projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec: fixture.bundle.projectSpec, productGraph: fixture.bundle.productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec: fixture.bundle.projectSpec, productGraph: fixture.bundle.productGraph, architectureCandidates: fixture.bundle.architectureCandidates }, "architecture-selection", 3, second);
  const fourth = makeState({ ...fixture.bundle, repositoryPlan: plan }, "repository-materialization", 4, third, plan);
  const fifth = makeState({ ...fixture.bundle, repositoryPlan: plan }, "verification", 5, fourth, plan);
  writeFile(fixture.root, ".programmable/project-states/000004-repository-materialization.v1.json", `${canonicalJsonV2(fourth)}\n`);
  writeFile(fixture.root, ".programmable/project-states/000005-verification.v1.json", `${canonicalJsonV2(fifth)}\n`);
  git(fixture.root, ["add", ".programmable"]);
  git(fixture.root, ["commit", "-qm", "forge self-consistent unsigned receipt"]);

  const report = compileProjectBundle({ ...fixture.bundle, repositoryPlan: plan, projectState: fifth, previousState: fourth }, {
    repositoryRoot: fixture.root,
    verifyRepositoryFiles: true
  });
  assert.equal(report.status, "PROJECT_COMPILATION_VALID");
  assert.equal(report.repositoryCompletion, "NOT_PROVEN");
  assert.equal(report.commandExecutionEvidence, "UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH");
  assert.equal(report.evidenceBoundary.receiptIssuerAuthenticated, false);
  assert.equal(report.evidenceBoundary.commandsReexecuted, false);
});
