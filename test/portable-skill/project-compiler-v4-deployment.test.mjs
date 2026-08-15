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

test("v4 deployment proof recomputes Ethereum CREATE2, permission bits, runtime, manager, and chain bindings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-v4-preimage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const creationCode = Buffer.from("60006000", "hex");
  const constructorArgs = Buffer.alloc(0);
  const salt = Buffer.alloc(32, 0x11);
  const runtime = Buffer.from("6000", "hex");
  const deployer = "0x2222222222222222222222222222222222222222";
  const manager = "0x3333333333333333333333333333333333333333";
  const initcodeHash = keccak256Hex(Buffer.concat([creationCode, constructorArgs]));
  const create2Digest = keccak256Hex(Buffer.concat([Buffer.from([0xff]), Buffer.from(deployer.slice(2), "hex"), salt, Buffer.from(initcodeHash.slice(2), "hex")]));
  const expectedAddress = `0x${create2Digest.slice(-40)}`;
  const addressMask = Number(BigInt(expectedAddress) & 0x3fffn);
  const permissionNames = [
    "beforeInitialize", "afterInitialize", "beforeAddLiquidity", "afterAddLiquidity", "beforeRemoveLiquidity", "afterRemoveLiquidity",
    "beforeSwap", "afterSwap", "beforeDonate", "afterDonate", "beforeSwapReturnDelta", "afterSwapReturnDelta",
    "afterAddLiquidityReturnDelta", "afterRemoveLiquidityReturnDelta"
  ];
  const permissions = Object.fromEntries(permissionNames.map((name, index) => [name, (addressMask & (1 << (13 - index))) !== 0]));
  const permissionMask = canonicalV4PermissionMask(permissions);
  const preimage = { schemaVersion: "1.0.0", systemRef: "hook-system", creationCode: `0x${creationCode.toString("hex")}`, constructorArgs: "0x", salt: `0x${salt.toString("hex")}` };
  const manifest = {
    schemaVersion: "1.0.0",
    systemRef: "hook-system",
    preimageArtifactId: "hook-preimage",
    runtimeArtifactId: "hook-runtime",
    chainProfile: { id: "ethereum-fork", chainId: 1, blockNumber: 1, blockHash: `0x${"44".repeat(32)}`, poolManager: manager, evidenceRef: "evidence/chain.json" },
    create2Deployer: { address: deployer, runtimeCodeKeccak256: `0x${"55".repeat(32)}`, evidenceRef: "evidence/deployer.json" },
    hookMiner: { repository: "https://github.com/Uniswap/v4-periphery", commit: "a".repeat(40), sourceSha256: `sha256:${"66".repeat(32)}`, saltSha256: sha256(salt) },
    hashes: { creationCodeKeccak256: keccak256Hex(creationCode), constructorArgsKeccak256: keccak256Hex(constructorArgs), initcodeKeccak256: initcodeHash },
    permissions: { permissionMask, getHookPermissionsMask: permissionMask, addressLowBitsMask: permissionMask },
    addresses: { expected: expectedAddress, actual: expectedAddress },
    runtime: { byteLength: runtime.length, codeSha256: sha256(runtime), codeKeccak256: keccak256Hex(runtime) },
    proof: { expectedEqualsActual: true, permissionsMatch: true, runtimeMatches: true, poolManagerMatches: true, chainProfileMatches: true }
  };
  writeFile(root, "deploy/preimage.json", `${canonicalJsonV2(preimage)}\n`);
  writeFile(root, "deploy/manifest.json", `${canonicalJsonV2(manifest)}\n`);
  writeFile(root, "deploy/runtime.bin", runtime);
  writeFile(root, "evidence/chain.json", "{}\n");
  writeFile(root, "evidence/deployer.json", "{}\n");
  const artifacts = [
    artifactRecord("hook-preimage", "deploy/preimage.json", "v4-deployment-preimage"),
    artifactRecord("hook-manifest", "deploy/manifest.json", "v4-deployment-manifest"),
    artifactRecord("hook-runtime", "deploy/runtime.bin", "v4-runtime-code"),
    artifactRecord("chain-evidence", "evidence/chain.json", "chain-profile"),
    artifactRecord("deployer-evidence", "evidence/deployer.json", "create2-deployer-evidence")
  ];
  const inventory = { byId: new Map(artifacts.map((artifact) => [artifact.id, artifact])), byPath: new Map(artifacts.map((artifact) => [artifact.path, artifact])) };
  const hook = {
    permissions,
    profile: {
      poolManager: { address: manager },
      deployment: {
        creationCodeHash: sha256(creationCode), constructorArgsHash: sha256(constructorArgs), initcodeHash: sha256(Buffer.concat([creationCode, constructorArgs])),
        hookMinerSaltSha256: sha256(salt), expectedAddress, runtimeCodeHash: sha256(runtime), permissionMask, poolManagerAddress: manager
      }
    }
  };
  const record = { deploymentArtifactIds: ["hook-preimage", "hook-manifest", "hook-runtime"], systemRef: "hook-system" };
  assert.deepEqual(validateV4DeploymentEvidence(record, hook, inventory, root, 0), []);

  manifest.hashes.initcodeKeccak256 = `0x${"00".repeat(32)}`;
  writeFile(root, "deploy/manifest.json", `${canonicalJsonV2(manifest)}\n`);
  assert.ok(validateV4DeploymentEvidence(record, hook, inventory, root, 0).some(({ code }) => code === "V4_ETHEREUM_PREIMAGE_HASH_MISMATCH"));
});
