#!/usr/bin/env node

import fs from "node:fs";
import childProcess from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { parseCliOrExit } from "./cli-args.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import { executeProjectCommands } from "./project-command-executor-core.mjs";
import { compileProjectBundle, preflightProjectOutput, validateProjectOutput } from "./project-compiler-core.mjs";
import { validateArchitectureCandidates, validateProductGraph, validateProjectSpec } from "./project-contracts-core.mjs";
import { createNoMarketProjectAuthoring } from "./project-state-core.mjs";
import { bindTradableReferenceIntent, TRADABLE_REFERENCE_PROFILE_ID } from "./project-tradable-authoring-core.mjs";
import { validateRepositoryPlan } from "./repository-completion-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { sha256 } from "./template-catalog-shared.mjs";

const MAINNET_FORK_CANARY = Object.freeze({
  relativePath: "test/ProgrammableVolumeFeeHookV2MainnetForkCanary.t.sol",
  testName: "testPinnedMainnetRuntimesAndLocalHookRegistration",
  provider: "https://eth.drpc.org",
  blockNumber: 25708543,
  forkBlockNumber: 25708544,
  blockHash: "0x87dd2497fb2c5fba0f2c513fe1b441ae5660e8360bde1be308875be27c336162",
  rawContentSha256: "sha256:3082709a049a0117c3f1ff132529a06f3f6e595eae93c31907936737d9d7ae1f"
});
const MAINNET_FORK_RUNTIMES = Object.freeze([
  Object.freeze({ address: "0x000000000022d473030f116ddee9f6b43ac78ba3", codeByteLength: 9152, codeKeccak256: "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131", id: "permit2" }),
  Object.freeze({ address: "0x000000000004444c5dc75cb358380d2e3de08a90", codeByteLength: 24009, codeKeccak256: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293", id: "pool-manager" }),
  Object.freeze({ address: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", codeByteLength: 19499, codeKeccak256: "0x6a5f46971b50c6e1b7eef97902311444e479d734e4f80ad88367783cf373fe7f", id: "universal-router" }),
  Object.freeze({ address: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203", codeByteLength: 5820, codeKeccak256: "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441", id: "v4-quoter" })
]);
const MAINNET_FORK_RAW_RESULT = Object.freeze({
  blockHash: MAINNET_FORK_CANARY.blockHash,
  blockNumber: MAINNET_FORK_CANARY.blockNumber,
  chainId: "1",
  contentSha256: MAINNET_FORK_CANARY.rawContentSha256,
  kind: "mainnet-fork-canary-result",
  evidenceBoundary: Object.freeze({ approvalCreated: false, auditClaimed: false, externalActionsPerformed: Object.freeze([]), productionClaimed: false }),
  localFork: Object.freeze({ canonicalPoolManagerBound: true, forkBlockNumber: MAINNET_FORK_CANARY.forkBlockNumber, hookDeploymentLocalOnly: true, poolRegistrationLocalOnly: true, transactionBroadcast: false }),
  provider: Object.freeze({ credentialMode: "none", networkAccess: "read-only", url: MAINNET_FORK_CANARY.provider }),
  runtimes: MAINNET_FORK_RUNTIMES,
  schemaVersion: "1.0.0",
  status: "LOCAL_READ_ONLY_FORK_EVIDENCE_NOT_APPROVAL"
});
const PROJECT_COMPILER_BRIEF_MAX_OUTPUT_BYTES = 2_499;
const PROJECT_COMPILER_BRIEF_FIELD_JSON_BYTES = Object.freeze({
  severity: 64,
  code: 160,
  path: 768,
  message: 768
});

const cli = parseCliOrExit({
  command: "project-compiler",
  usage: "project-compiler <validate|validate-output|preflight|require-output|execute|materialize> [command options]",
  summary: "Validate project phases and outputs, author a source-bound plan, or fail closed before untrusted execution.",
  positionals: { min: 1, max: 1, names: ["command"] },
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Existing project repository root." },
    { name: "--state", key: "state", type: "value", valueName: "repository-path", description: "Repository-relative project-state-v1 JSON path." },
    { name: "--previous-state", key: "previousState", type: "value", valueName: "repository-path", description: "Repository-relative preceding checkpoint when sequence is greater than one." },
    { name: "--submission-root", key: "submissionRoot", type: "value", valueName: "repository-path", description: "Repository-relative Open World submission package directory for validate-output." },
    { name: "--plan", key: "plan", type: "value", valueName: "repository-path", description: "Repository-relative materializing repository-plan-v1 JSON path." },
    { name: "--output-plan", key: "outputPlan", type: "value", valueName: "repository-path", description: "Reserved completed-plan path; portable execute validates then requires an external sandbox." },
    { name: "--idea-file", key: "ideaFile", type: "value", valueName: "utf8-file", description: "Exact natural-language idea source for materialize." },
    { name: "--application-id", key: "applicationId", type: "value", valueName: "slug", description: "Application identity for materialize." },
    { name: "--classification", key: "classification", type: "value", valueName: "no-market|tradable", description: "Explicit trade classification for materialize." },
    { name: "--market-ref", key: "marketRef", type: "value", valueName: "slug", description: "Exact selected market identity for tradable materialize." },
    { name: "--reference-profile", key: "referenceProfile", type: "value", valueName: "profile-id", description: "Exact frozen legacy compatibility profile requested by preserved tradable intent." },
    { name: "--source-contract", key: "sourceContract", type: "value", valueName: "mjs-file", description: "Idea-specific local source module for materialize." },
    { name: "--test-source", key: "testSource", type: "value", valueName: "test-mjs-file", description: "Real node:test source for materialize." },
    { name: "--output", key: "output", type: "value", valueName: "new-directory", description: "New repository directory for materialize." },
    { name: "--write", key: "write", type: "boolean", description: "Write no-market source and a materializing plan; tradable write requires an external sandbox." },
    { name: "--brief", key: "brief", type: "boolean", description: "Return status, counts, up to three distinct finding-code groups, report identity and evidence boundary; omit for complete canonical JSON." }
  ]
});

if (cli.positionals[0] !== "materialize" && cli.options.repositoryRoot === null) failUsage("missing required option --repository-root");
if (cli.options.brief && !["validate", "validate-output", "preflight", "require-output"].includes(cli.positionals[0])) failUsage("--brief is accepted only by validate, validate-output, preflight or require-output");

try {
  const repositoryRoot = cli.options.repositoryRoot === null ? null : fs.realpathSync(cli.options.repositoryRoot);
  if (cli.positionals[0] !== "materialize") rejectMaterializeOptions(cli.options);
  if (cli.positionals[0] === "materialize") {
    await materializeProject(cli.options);
  } else if (cli.positionals[0] === "validate") {
    if (cli.options.state === null) failUsage("validate requires --state");
    if (cli.options.submissionRoot !== null || cli.options.plan !== null || cli.options.outputPlan !== null) failUsage("validate does not accept --submission-root, --plan or --output-plan");
    const projectState = readRepositoryJson(repositoryRoot, cli.options.state);
    const previousState = cli.options.previousState === null ? null : readRepositoryJson(repositoryRoot, cli.options.previousState);
    const bound = Object.fromEntries(Object.entries(projectState.artifacts ?? {}).map(([name, binding]) => [
      name,
      binding === null ? undefined : readRepositoryJson(repositoryRoot, binding.path)
    ]));
    const report = compileProjectBundle({ ...bound, projectState, previousState }, { repositoryRoot, verifyRepositoryFiles: true });
    writeProjectReport(report, "validate", cli.options.brief);
    if (report.status !== "PROJECT_COMPILATION_VALID") process.exitCode = 1;
  } else if (cli.positionals[0] === "validate-output") {
    if (cli.options.state === null || cli.options.submissionRoot === null) failUsage("validate-output requires --state and --submission-root");
    if (cli.options.plan !== null || cli.options.outputPlan !== null) failUsage("validate-output does not accept --plan or --output-plan");
    const projectState = readRepositoryJson(repositoryRoot, cli.options.state);
    const previousState = cli.options.previousState === null ? null : readRepositoryJson(repositoryRoot, cli.options.previousState);
    const bound = Object.fromEntries(Object.entries(projectState.artifacts ?? {}).map(([name, binding]) => [
      name,
      binding === null ? undefined : readRepositoryJson(repositoryRoot, binding.path)
    ]));
    const report = validateProjectOutput({
      ...bound,
      projectState,
      previousState,
      repositoryRoot,
      submissionRoot: resolveRepositoryDirectory(repositoryRoot, cli.options.submissionRoot)
    });
    writeProjectReport(report, "validate-output", cli.options.brief);
    if (report.status !== "PROJECT_OUTPUT_VALID") process.exitCode = 1;
  } else if (["preflight", "require-output"].includes(cli.positionals[0])) {
    const strict = cli.positionals[0] === "require-output";
    if (cli.options.plan !== null || cli.options.outputPlan !== null) failUsage(`${cli.positionals[0]} does not accept --plan or --output-plan`);
    const hasState = cli.options.state !== null;
    const hasSubmission = cli.options.submissionRoot !== null;
    if (hasState !== hasSubmission) failUsage("preflight accepts --state and --submission-root only together");
    if (!hasState && cli.options.previousState !== null) failUsage(`${cli.positionals[0]} --previous-state requires --state and --submission-root`);
    const report = preflightProjectOutput({
      repositoryRoot,
      statePath: cli.options.state,
      previousStatePath: cli.options.previousState,
      submissionRoot: cli.options.submissionRoot
    });
    writeProjectReport(report, cli.positionals[0], cli.options.brief);
    if (strict ? report.status !== "PROJECT_PREFLIGHT_VALID" : !["PROJECT_PREFLIGHT_VALID", "PROJECT_PREFLIGHT_CLEAR"].includes(report.status)) process.exitCode = 1;
  } else if (cli.positionals[0] === "execute") {
    if (cli.options.plan === null || cli.options.outputPlan === null) failUsage("execute requires --plan and --output-plan");
    if (cli.options.state !== null || cli.options.previousState !== null || cli.options.submissionRoot !== null) failUsage("execute does not accept --state, --previous-state or --submission-root");
    const repositoryPlan = readRepositoryJson(repositoryRoot, cli.options.plan);
    const result = await executeProjectCommands({ repositoryRoot, repositoryPlan, outputPlanPath: cli.options.outputPlan });
    const { repositoryPlan: _repositoryPlan, ...summary } = result;
    process.stdout.write(`${canonicalJsonV2(summary)}\n`);
  } else {
    failUsage(`unknown command ${cli.positionals[0]}`);
  }
} catch (error) {
  const code = typeof error?.code === "string" ? `${error.code}: ` : "";
  process.stderr.write(`project-compiler: ${code}${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

async function materializeProject(options) {
  const prohibited = [options.repositoryRoot, options.state, options.previousState, options.submissionRoot, options.plan, options.outputPlan];
  if (prohibited.some((value) => value !== null)) failUsage("materialize does not accept repository validation or execution options");
  for (const key of ["ideaFile", "applicationId", "classification", "output"]) if (options[key] === null) failUsage(`materialize requires --${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.applicationId) || options.applicationId.length > 120) failUsage("--application-id must be a lowercase slug");
  if (!["no-market", "tradable"].includes(options.classification)) failUsage("--classification must be no-market or tradable");
  const ideaBytes = readInputBytes(options.ideaFile, 1_000_000, "idea file");
  const ideaText = new TextDecoder("utf-8", { fatal: true }).decode(ideaBytes);
  if (ideaText.trim().length === 0) failUsage("--idea-file must contain non-whitespace UTF-8 text");
  const outputRoot = resolveNewOutput(options.output);
  if (options.classification === "tradable") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(options.marketRef ?? "")) failUsage("tradable materialize requires --market-ref as a lowercase slug");
    if (options.referenceProfile !== TRADABLE_REFERENCE_PROFILE_ID) failUsage(`tradable materialize requires --reference-profile ${TRADABLE_REFERENCE_PROFILE_ID}`);
    if (options.sourceContract !== null || options.testSource !== null) failUsage("tradable materialize does not accept --source-contract or --test-source");
    return materializeTradableProject({ ...options, ideaText, ideaBytes, intentProfileBinding: bindTradableReferenceIntent(ideaText, options.referenceProfile), outputRoot });
  }
  if (options.marketRef !== null) failUsage("no-market materialize does not accept --market-ref");
  if (options.referenceProfile !== null) failUsage("no-market materialize does not accept --reference-profile");
  if (options.sourceContract === null || options.testSource === null) failUsage("no-market materialize requires --source-contract and --test-source");
  const sourceInput = readAuthoredModule(options.sourceContract, false);
  const testInput = readAuthoredModule(options.testSource, true);
  const sourcePath = `src/${sourceInput.basename}`;
  const testPath = `test/${testInput.basename}`;
  const authored = createNoMarketProjectAuthoring({ applicationId: options.applicationId, ideaText, sourcePath, sourceBytes: sourceInput.bytes, testPath, testBytes: testInput.bytes });
  const authoringFindings = [
    ...validateProjectSpec(authored.projectSpec),
    ...validateProductGraph(authored.projectSpec, authored.productGraph),
    ...validateArchitectureCandidates(authored.projectSpec, authored.productGraph, authored.architectureCandidates),
    ...validateRepositoryPlan(authored.projectSpec, authored.productGraph, authored.architectureCandidates, authored.repositoryPlan)
  ];
  if (authoringFindings.some(({ severity }) => severity === "blocker")) throw Object.assign(new Error("generated project artifacts fail bundled validation"), { code: "PROJECT_AUTHORING_INVALID", findings: authoringFindings });
  const inventory = fileInventory(authored.files);
  if (!options.write) {
    const payload = materializationReport({ status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", applicationId: options.applicationId, classification: "no-market", writeRequested: false, writePerformed: false, outputRoot, ideaSha256: authored.projectSpec.intent.sha256, sourcePath, testPath, inventory, blockers: [] });
    process.stdout.write(`${canonicalJsonV2(payload)}\n`);
    return;
  }
  const temporaryRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), ".programmable-project-materialize-"));
  let exportRoot = null;
  try {
    for (const [relativePath, bytes] of authored.files) writeOutputFile(temporaryRoot, relativePath, bytes);
    writeOutputJson(temporaryRoot, ".programmable/project-spec.v1.json", authored.projectSpec);
    writeOutputJson(temporaryRoot, ".programmable/product-graph.v1.json", authored.productGraph);
    writeOutputJson(temporaryRoot, ".programmable/architecture-candidates.v1.json", authored.architectureCandidates);
    git(temporaryRoot, ["init", "-q", "-b", "main"]);
    git(temporaryRoot, ["config", "user.name", "Programmable Local Builder"]);
    git(temporaryRoot, ["config", "user.email", "local-builder@example.invalid"]);
    git(temporaryRoot, ["add", "."]);
    git(temporaryRoot, ["commit", "-qm", "materialize intent-bound local source"]);
    authored.repositoryPlan.repository.branch = git(temporaryRoot, ["branch", "--show-current"]);
    authored.repositoryPlan.repository.headCommit = git(temporaryRoot, ["rev-parse", "HEAD"]);
    const sourceCommit = authored.repositoryPlan.repository.headCommit;
    const sourceTree = git(temporaryRoot, ["rev-parse", "HEAD^{tree}"]);
    exportRoot = fs.mkdtempSync(path.join(path.dirname(outputRoot), ".programmable-project-export-"));
    git(path.dirname(outputRoot), ["clone", "-q", "--no-hardlinks", temporaryRoot, exportRoot]);
    git(exportRoot, ["remote", "remove", "origin"]);
    const planPath = ".programmable/repository-plan.materializing.v1.json";
    writeOutputJson(exportRoot, planPath, authored.repositoryPlan);
    if (git(exportRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
      throw Object.assign(new Error("plan-only export must remain clean with its transient plan ignored"), { code: "PROJECT_PLAN_EXPORT_DIRTY" });
    }
    fs.renameSync(exportRoot, outputRoot);
    exportRoot = null;
    const payload = materializationReport({
      status: "PROJECT_MATERIALIZATION_PLAN_WRITTEN",
      operation: "PROJECT_SOURCE_AND_PLAN_MATERIALIZED",
      applicationId: options.applicationId,
      classification: "no-market",
      writeRequested: true,
      writePerformed: true,
      outputRoot,
      ideaSha256: authored.projectSpec.intent.sha256,
      sourcePath,
      testPath,
      inventory: fileInventory(authored.files),
      sourceCommit,
      sourceTree,
      planPath,
      planSha256: canonicalJsonSha256V2(authored.repositoryPlan),
      executionStatus: "EXTERNAL_SANDBOX_REQUIRED",
      commandsExecuted: false,
      blockers: ["PROJECT_EXTERNAL_SANDBOX_REQUIRED"]
    });
    process.stdout.write(`${canonicalJsonV2(payload)}\n`);
  } finally {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive: true, force: true });
    if (exportRoot !== null && fs.existsSync(exportRoot)) fs.rmSync(exportRoot, { recursive: true, force: true });
  }
}

async function materializeTradableProject({ applicationId, marketRef, ideaText, ideaBytes, intentProfileBinding, outputRoot, write }) {
  void ideaText;
  void intentProfileBinding;
  if (!write) {
    process.stdout.write(`${canonicalJsonV2(materializationReport({ status: "PROJECT_MATERIALIZATION_DRY_RUN_READY", applicationId, classification: "tradable", marketRef, writeRequested: false, writePerformed: false, outputRoot, ideaSha256: sha256Bytes(ideaBytes), blockers: [] }))}\n`);
    return;
  }
  throw Object.assign(
    new Error("tradable source generation requires candidate dependency and test execution, so portable same-UID materialization is disabled"),
    {
      code: "PROJECT_EXTERNAL_SANDBOX_REQUIRED",
      status: "PROJECT_EXECUTION_BLOCKED",
      planCreated: false,
      executionCompleted: false,
      commandsExecuted: false,
      networkAccessed: false,
      externalWritesPerformed: false,
      trustedSandboxAuthorityConfigured: false
    }
  );
}

export function renderForkCanary() {
  const runtimeNames = { permit2: "PERMIT2", "pool-manager": "POOL_MANAGER", "universal-router": "UNIVERSAL_ROUTER", "v4-quoter": "V4_QUOTER" };
  const solidityNumber = (value) => value >= 10_000 ? String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, "_") : String(value);
  const runtimeAssertions = MAINNET_FORK_RUNTIMES.map(({ id, codeByteLength, codeKeccak256 }) =>
    `        _assertRuntime(${runtimeNames[id]}, ${solidityNumber(codeByteLength)}, ${codeKeccak256});`
  ).join("\n");
  const rawResultLiteral = JSON.stringify(canonicalJsonV2(MAINNET_FORK_RAW_RESULT));
  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

${"import"} { Test } from "forge-std/Test.sol";
${"import"} { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
${"import"} { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
${"import"} { ProgrammableVolumeFeeHookFactoryV2 } ${"from"} "../src/ProgrammableVolumeFeeHookFactoryV2.sol";
${"import"} { ProgrammableVolumeFeeHookV2 } ${"from"} "../src/ProgrammableVolumeFeeHookV2.sol";
${"import"} { MockReferenceToken } ${"from"} "./MockReferenceToken.sol";

contract ProgrammableVolumeFeeHookV2MainnetForkCanaryTest is Test {
    bytes32 private constant BLOCK_HASH = ${MAINNET_FORK_CANARY.blockHash};
    string private constant RAW_RESULT =
        ${rawResultLiteral};
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address private constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    address private constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;

    function testPinnedMainnetRuntimesAndLocalHookRegistration() public {
        assertEq(block.chainid, 1, "fork chain mismatch");
        assertEq(block.number, ${solidityNumber(MAINNET_FORK_CANARY.forkBlockNumber)}, "fork block mismatch");
        assertEq(blockhash(${solidityNumber(MAINNET_FORK_CANARY.blockNumber)}), BLOCK_HASH, "fork parent block hash mismatch");
${runtimeAssertions}
        ProgrammableVolumeFeeHookFactoryV2 factory = new ProgrammableVolumeFeeHookFactoryV2();
        MockReferenceToken token = new MockReferenceToken("Fork Canary", "FCAN");
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config =
            ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig({
                poolManager: IPoolManager(POOL_MANAGER),
                currency0: CurrencyLibrary.ADDRESS_ZERO,
                currency1: Currency.wrap(address(token)),
                lpFeePips: 3000,
                tickSpacing: 60,
                quoteCurrency: address(0),
                projectFeeOwner: address(0xBEEF),
                selectedBuyHundredthsOfBip: 30_000,
                selectedSellHundredthsOfBip: 30_000,
                initialSqrtPriceX96: uint160(1) << 96
            });
        (address predicted, bytes32 userSalt) = _mineHook(factory, config);
        (ProgrammableVolumeFeeHookV2 hook, bytes32 poolId, int24 initialTick, bytes32 factoryReceipt) =
            factory.deployAndRegister(userSalt, config);
        assertEq(address(hook), predicted, "mined hook prediction mismatch");
        assertEq(address(hook.poolManager()), POOL_MANAGER, "canonical mainnet PoolManager mismatch");
        assertEq(uint160(address(hook)) & factory.ALL_HOOK_MASK(), factory.REQUIRED_HOOK_FLAGS(), "hook flags mismatch");
        assertTrue(hook.canonicalPoolRegistered(), "canonical pool unregistered");
        assertEq(poolId, hook.canonicalPoolId(), "canonical pool id mismatch");
        assertTrue(poolId != bytes32(0), "canonical pool id missing");
        assertEq(initialTick, 0, "initial tick mismatch");
        assertEq(hook.canonicalPoolInitialTick(), 0, "stored initial tick mismatch");
        assertEq(
            factory.runtimeConfigurationHashOf(address(hook)),
            hook.runtimeConfigurationHash(),
            "runtime receipt mismatch"
        );
        assertTrue(factory.runtimeConfigurationHashOf(address(hook)) != bytes32(0), "runtime receipt missing");
        assertEq(factory.factoryConfigurationHashOf(address(hook)), factoryReceipt, "factory receipt mismatch");
        assertTrue(factoryReceipt != bytes32(0), "factory receipt missing");
        emit log_string(string.concat("PROGRAMMABLE_MAINNET_FORK_CANARY_V1:", RAW_RESULT));
    }

    function _mineHook(
        ProgrammableVolumeFeeHookFactoryV2 factory,
        ProgrammableVolumeFeeHookFactoryV2.RegistrationConfig memory config
    ) private view returns (address predicted, bytes32 userSalt) {
        for (uint256 candidate; candidate < 1_000_000; ++candidate) {
            userSalt = bytes32(candidate);
            (predicted,,) = factory.predictHookAddress(userSalt, config);
            if ((uint160(predicted) & factory.ALL_HOOK_MASK()) == factory.REQUIRED_HOOK_FLAGS()) {
                return (predicted, userSalt);
            }
        }
        revert("valid mainnet fork hook salt not found");
    }

    function _assertRuntime(address target, uint256 expectedLength, bytes32 expectedCodehash) private view {
        assertEq(target.code.length, expectedLength, "mainnet runtime length mismatch");
        assertEq(target.codehash, expectedCodehash, "mainnet runtime codehash mismatch");
    }
}
`;
}

export function inspectForkCanary(stdout, context = {}) {
  const { marketRef, sourceRevision, sourceTree, sourceArtifactSha256, testArtifact, argv, forgeVersion, providerUriSha256 } = context;
  const objectId = /^(?!0{40}$)[0-9a-f]{40}$/u;
  const digest = /^(?!0{64}$)[0-9a-f]{64}$/u;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(marketRef ?? "")) throw new Error("Fork evidence requires an explicit canonical marketRef.");
  if (!objectId.test(sourceRevision ?? "") || !objectId.test(sourceTree ?? "")) throw new Error("Fork evidence requires exact nonzero lowercase Git commit and tree identities.");
  if (![sourceArtifactSha256, testArtifact?.sha256, providerUriSha256].every((value) => digest.test(value ?? ""))) throw new Error("Fork evidence requires exact non-placeholder source, test and provider SHA-256 identities.");
  if (testArtifact?.path !== MAINNET_FORK_CANARY.relativePath || Object.keys(testArtifact ?? {}).sort().join(",") !== "path,sha256") throw new Error("Fork evidence requires the exact tracked canary test artifact binding.");
  const expectedArgv = ["forge", "test", "--match-path", MAINNET_FORK_CANARY.relativePath, "--match-test", MAINNET_FORK_CANARY.testName, "--fork-url", MAINNET_FORK_CANARY.provider, "--fork-block-number", String(MAINNET_FORK_CANARY.forkBlockNumber), "--json", "-vv"];
  if (canonicalJsonV2(argv) !== canonicalJsonV2(expectedArgv)) throw new Error("Fork evidence argv differs from the frozen read-only canary command.");
  if (providerUriSha256 !== sha256(Buffer.from(MAINNET_FORK_CANARY.provider, "utf8"))) throw new Error("Fork evidence provider URI digest mismatch.");
  const expectedTestSha256 = sha256(Buffer.from(renderForkCanary(), "utf8"));
  if (testArtifact.sha256 !== expectedTestSha256) throw new Error("Fork evidence test source digest mismatch.");
  if (typeof forgeVersion !== "string" || forgeVersion.length === 0 || forgeVersion.length > 500 || forgeVersion.trim() !== forgeVersion || forgeVersion.includes("\u0000")) throw new Error("Fork evidence requires one bounded exact Forge version identity.");

  const parsed = parseBoundedStrictJsonBytes(Buffer.from(stdout, "utf8"));
  const suiteKey = `${MAINNET_FORK_CANARY.relativePath}:ProgrammableVolumeFeeHookV2MainnetForkCanaryTest`;
  if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, suiteKey)) throw new Error("Fork canary must report exactly its frozen test suite.");
  const suite = parsed[suiteKey];
  const testKey = `${MAINNET_FORK_CANARY.testName}()`;
  if (Object.keys(suite?.test_results ?? {}).length !== 1 || !Object.hasOwn(suite.test_results, testKey)) throw new Error("Fork canary must report exactly its frozen test.");
  const test = suite.test_results[testKey];
  if (test?.status !== "Success" || test?.reason !== null) throw new Error("Fork canary did not pass without a failure reason.");
  const expectedLog = `PROGRAMMABLE_MAINNET_FORK_CANARY_V1:${canonicalJsonV2(MAINNET_FORK_RAW_RESULT)}`;
  if (!Array.isArray(test.decoded_logs) || test.decoded_logs.length !== 1 || test.decoded_logs[0] !== expectedLog) throw new Error("Fork canary must emit exactly one byte-exact structured observation.");
  const rawResult = parseBoundedStrictJsonBytes(Buffer.from(test.decoded_logs[0].slice("PROGRAMMABLE_MAINNET_FORK_CANARY_V1:".length), "utf8"));
  const { contentSha256: rawContentSha256, ...rawPayload } = rawResult;
  if (rawContentSha256 !== MAINNET_FORK_CANARY.rawContentSha256 || canonicalJsonSha256V2(rawPayload) !== rawContentSha256 || canonicalJsonV2(rawResult) !== canonicalJsonV2(MAINNET_FORK_RAW_RESULT)) throw new Error("Fork canary observation content binding mismatch.");

  const payload = {
    schemaVersion: "1.0.0", kind: "mainnet-fork-canary-evidence", status: "LOCAL_READ_ONLY_FORK_EVIDENCE_NOT_APPROVAL",
    sourceRevision, sourceTree, sourceArtifactSha256,
    testArtifact: { path: testArtifact.path, sha256: testArtifact.sha256 },
    execution: { argv: [...argv], argvSha256: canonicalJsonSha256V2(argv), forgeVersion, providerUriSha256, networkAccess: "read-only", externalWrites: false, transactionBroadcast: false, exitCode: 0, suitesObserved: 1, testsObserved: 1, passedTests: 1, failedTests: 0 },
    observation: rawResult,
    evidenceBoundary: { approvalCreated: false, auditClaimed: false, externalActionsPerformed: [], productionClaimed: false }
  };
  const value = { ...payload, contentSha256: canonicalJsonSha256V2(payload) };
  const bytes = Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8");
  return Object.freeze({ valid: true, evidenceRef: `${marketRef}-mainnet-fork-canary`, path: `evidence/v4/${marketRef}.mainnet-fork-canary.v1.json`, value: Object.freeze(value), bytes, sha256: `sha256:${sha256(bytes)}`, byteLength: bytes.length, rawResult: Object.freeze(rawResult) });
}

function rejectMaterializeOptions(options) {
  if ([options.ideaFile, options.applicationId, options.classification, options.marketRef, options.referenceProfile, options.sourceContract, options.testSource, options.output].some((value) => value !== null) || options.write) failUsage("materialize authoring options are accepted only by the materialize command");
}
function summarizeProjectCompilerReport(report, operation) {
  const findings = Array.isArray(report.findings)
    ? report.findings.filter((finding) => finding !== null && typeof finding === "object" && !Array.isArray(finding))
    : [];
  const groups = new Map();
  for (const finding of findings) {
    const code = typeof finding.code === "string" && finding.code.length > 0
      ? finding.code
      : "UNCLASSIFIED_FINDING";
    const existing = groups.get(code);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }
    groups.set(code, {
      severity: boundedBriefFindingText(typeof finding.severity === "string" ? finding.severity : "unknown", PROJECT_COMPILER_BRIEF_FIELD_JSON_BYTES.severity),
      code: boundedBriefFindingText(code, PROJECT_COMPILER_BRIEF_FIELD_JSON_BYTES.code),
      path: typeof finding.path === "string" ? boundedBriefFindingText(finding.path, PROJECT_COMPILER_BRIEF_FIELD_JSON_BYTES.path) : null,
      message: boundedBriefFindingText(typeof finding.message === "string" ? finding.message : "Inspect the complete canonical report.", PROJECT_COMPILER_BRIEF_FIELD_JSON_BYTES.message),
      occurrences: 1
    });
  }
  const primary = [...groups.values()].slice(0, 3).map((finding) => ({
    ...finding,
    additionalLocations: finding.occurrences - 1
  }));
  return {
    schemaVersion: "1.0.0",
    kind: "project-compiler-brief",
    operation,
    status: report.status ?? null,
    canonicalOutput: typeof report.canonicalOutput === "boolean" ? report.canonicalOutput : null,
    reportSha256: report.reportSha256 ?? null,
    findingCounts: report.findingCounts ?? null,
    findingGroups: {
      distinct: groups.size,
      displayed: primary.length,
      omitted: Math.max(0, groups.size - primary.length),
      items: primary
    },
    evidenceBoundary: report.evidenceBoundary ?? null,
    fullReport: {
      available: true,
      instruction: "Rerun the same command without --brief for the complete canonical JSON report."
    }
  };
}
function boundedBriefFindingText(value, maximumJsonBytes) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") <= maximumJsonBytes) return value;
  const suffix = `…[${sha256Bytes(Buffer.from(value, "utf8"))}]`;
  let bounded = "";
  let encodedBytes = Buffer.byteLength(JSON.stringify(suffix), "utf8");
  for (const scalar of value) {
    const scalarBytes = Buffer.byteLength(JSON.stringify(scalar), "utf8") - 2;
    if (encodedBytes + scalarBytes > maximumJsonBytes) break;
    bounded += scalar;
    encodedBytes += scalarBytes;
  }
  const result = `${bounded}${suffix}`;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maximumJsonBytes) throw new Error("project compiler brief field budget invariant failed");
  return result;
}
function projectCompilerBriefBytes(report, operation) {
  const summary = summarizeProjectCompilerReport(report, operation);
  let bytes = Buffer.from(`${canonicalJsonV2(summary)}\n`, "utf8");
  if (bytes.length <= PROJECT_COMPILER_BRIEF_MAX_OUTPUT_BYTES) return bytes;
  const fallback = {
    ...summary,
    findingGroups: {
      distinct: summary.findingGroups.distinct,
      displayed: 0,
      omitted: summary.findingGroups.distinct,
      items: []
    },
    budgetFallback: {
      applied: true,
      reason: "FINDING_GROUP_DETAILS_EXCEEDED_BRIEF_OUTPUT_BUDGET",
      maximumOutputBytes: PROJECT_COMPILER_BRIEF_MAX_OUTPUT_BYTES,
      attemptedOutputBytes: bytes.length
    }
  };
  bytes = Buffer.from(`${canonicalJsonV2(fallback)}\n`, "utf8");
  if (bytes.length > PROJECT_COMPILER_BRIEF_MAX_OUTPUT_BYTES) throw new Error("project compiler brief fallback exceeds its complete output budget");
  return bytes;
}
function writeProjectReport(report, operation, brief) {
  if (brief) {
    process.stdout.write(projectCompilerBriefBytes(report, operation));
    return;
  }
  process.stdout.write(`${canonicalJsonV2(report)}\n`);
}
function readInputBytes(inputPath, maximumBytes, label) {
  const resolved = path.resolve(inputPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) throw Object.assign(new Error(`${label} must be a bounded regular non-symlink file`), { code: "PROJECT_AUTHORING_INPUT_INVALID" });
  return fs.readFileSync(resolved);
}
function readAuthoredModule(inputPath, testSource) {
  const bytes = readInputBytes(inputPath, 1_000_000, testSource ? "test source" : "source contract");
  const basename = path.basename(inputPath);
  const pattern = testSource ? /^[a-z0-9]+(?:-[a-z0-9]+)*\.test\.mjs$/u : /^[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u;
  if (!pattern.test(basename)) failUsage(testSource ? "--test-source basename must be a lowercase *.test.mjs file" : "--source-contract basename must be a lowercase *.mjs file");
  if (testSource && !bytes.toString("utf8").includes("node:test")) failUsage("--test-source must use node:test");
  return { basename, bytes };
}
function resolveNewOutput(outputPath) {
  const requested = path.resolve(outputPath);
  const parent = fs.realpathSync(path.dirname(requested));
  const resolved = path.join(parent, path.basename(requested));
  if (fs.existsSync(resolved)) throw Object.assign(new Error("--output must name a new directory"), { code: "PROJECT_OUTPUT_EXISTS" });
  return resolved;
}
function writeOutputFile(root, relativePath, bytes) {
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) throw Object.assign(new Error("unsafe generated output path"), { code: "PROJECT_OUTPUT_PATH_INVALID" });
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
function writeOutputJson(root, relativePath, value) {
  writeOutputFile(root, relativePath, Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"));
}
function git(root, args) {
  const result = childProcess.spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, env: { PATH: process.env.PATH ?? "", HOME: path.join(root, ".git", "programmable-home"), LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" } });
  if (result.status !== 0) throw Object.assign(new Error(result.stderr.trim() || `git ${args[0]} failed`), { code: "PROJECT_LOCAL_GIT_FAILED" });
  return result.stdout.trim();
}
function fileInventory(files) {
  return [...files].map(([filePath, bytes]) => ({ path: filePath, sha256: sha256Bytes(bytes), byteLength: bytes.length })).sort((left, right) => left.path.localeCompare(right.path));
}
function materializationReport(fields) {
  const { outputRoot: _environmentSpecificOutputRoot, ...stableFields } = fields;
  const commandsExecuted = fields.commandsExecuted === true;
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
      commandsExecuted,
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
  return { ...payload, reportSha256: canonicalJsonSha256V2(payload) };
}

function resolveRepositoryDirectory(repositoryRoot, repositoryPath) {
  if (typeof repositoryPath !== "string" || repositoryPath.length === 0 || path.isAbsolute(repositoryPath)) {
    throw new Error("submission root must be non-empty and repository-relative");
  }
  const resolved = path.resolve(repositoryRoot, repositoryPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes repository root: ${repositoryPath}`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`submission root must be a non-symlink directory: ${repositoryPath}`);
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(repositoryRoot, real);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error(`path resolves outside repository root: ${repositoryPath}`);
  return real;
}

function readRepositoryJson(repositoryRoot, repositoryPath) {
  if (typeof repositoryPath !== "string" || repositoryPath.length === 0 || path.isAbsolute(repositoryPath)) {
    throw new Error("JSON paths must be non-empty and repository-relative");
  }
  const resolved = path.resolve(repositoryRoot, repositoryPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`path escapes repository root: ${repositoryPath}`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`JSON input must be a regular non-symlink file: ${repositoryPath}`);
  const real = fs.realpathSync(resolved);
  const realRelative = path.relative(repositoryRoot, real);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error(`path resolves outside repository root: ${repositoryPath}`);
  return parseBoundedStrictJsonBytes(fs.readFileSync(real));
}

function failUsage(message) {
  process.stderr.write(`project-compiler: ${message}\n`);
  process.stderr.write("Try 'project-compiler --help' for usage.\n");
  process.exit(2);
}
