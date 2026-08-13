import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "../canonical-json-core.mjs";
import { keccak256Hex } from "../evm-encoding-core.mjs";
import { PROJECT_COMMAND_MAXIMUM_OUTPUT_BYTES, PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES,
  createProjectCommandReceipt, executeProjectCommands, projectCommandEnvironmentSha256,
  projectCommandMaximumOutputBytes, resolveProjectCommandCwd, resolveProjectCommandTool, sha256Bytes } from "../project-command-executor-core.mjs";
import { compileProjectBundle, preflightProjectOutput, validateProjectOutput } from "../project-compiler-core.mjs";
import { TRADABLE_LEGACY_POLICY_INTENT_CLAUSE, TRADABLE_REFERENCE_PROFILE_ID, bindTradableReferenceIntent } from "../project-tradable-authoring-core.mjs";
import {
  ARCHITECTURE_ROLES,
  PRODUCT_GRAPH_NAMES,
  PROJECT_SPEC_FACETS,
  projectArtifactSha256,
  validateArchitectureCandidates,
  validateProductGraph,
  validateProjectSpec
} from "../project-contracts-core.mjs";
import { bindLocalReleaseHandoffV1, createNoMarketProjectAuthoring, renderGitHubSubmissionHandoffV1, sealProjectState, validateProjectState } from "../project-state-core.mjs";
import { validateRepositoryPlan } from "../repository-completion-core.mjs";
import { validateAgainstSchema } from "../submission-core.mjs";
import { architectureSnapshotSha256, createOpenWorldDraftPackage } from "../open-world-v2-core.mjs";
import { expectedTradeRunnerCallsV1, inspectForgeTradeTestRunnerOutputV1, validateV4DeploymentEvidence } from "../v4-deployment-evidence-core.mjs";
import { canonicalV4PermissionMask } from "../v4-hook-semantic-contract-core.mjs";
import { TRADE_TEST_SEMANTIC_ADEQUACY_V1, tradeCapabilityManifestSha256V1 } from "../trade-capability-manifest-core.mjs";
import {
  TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1,
  TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1,
  TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1,
  createApplicableOpenWorldV2PrototypeFixture,
  createNoMarketOpenWorldV2PrototypeFixture,
  createStandardTradeCapabilityManifestFixtureV1,
  createTradeTestResultFixturesV1,
  tradeTestRevertDataFixtureV1
} from "./open-world-v2-prototype-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
export const skillRoot = path.resolve(testDirectory, "../..");
export const compilerCli = path.join(skillRoot, "scripts/project-compiler.mjs");
export const unifiedCli = path.join(skillRoot, "scripts/cli.mjs");


export {
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
  TRADE_TEST_SEMANTIC_ADEQUACY_V1, tradeCapabilityManifestSha256V1,
  TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1, TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1,
  TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1, createApplicableOpenWorldV2PrototypeFixture,
  createNoMarketOpenWorldV2PrototypeFixture, createStandardTradeCapabilityManifestFixtureV1,
  createTradeTestResultFixturesV1, tradeTestRevertDataFixtureV1
};

export function makeProjectSpec() {
  const verbatimText = "Alice wants a bounded service that records rewards and lets users exit safely.";
  const facets = Object.fromEntries(PROJECT_SPEC_FACETS.map((name) => [name, {
    applicability: "applicable",
    summary: `${name} is explicitly modeled for this fixture.`,
    entries: [facetEntry(`${slug(name)}-fact`, "product-fact", "confirmed", verbatimText)]
  }]));
  facets.lifecycle.entries = [
    facetEntry("lifecycle-creation", "creation", "confirmed", verbatimText),
    facetEntry("lifecycle-use", "use", "builder-assumption", verbatimText),
    facetEntry("lifecycle-claim", "claim", "builder-assumption", verbatimText),
    facetEntry("lifecycle-exit", "exit", "confirmed", verbatimText),
    facetEntry("lifecycle-decommissioning", "decommissioning", "builder-assumption", verbatimText)
  ];
  facets.parameters.entries = [
    facetEntry("parameter-mutable", "mutable-parameter", "builder-assumption", verbatimText),
    facetEntry("parameter-immutable", "immutable-parameter", "builder-assumption", verbatimText)
  ];
  facets.assumptions.entries = [
    facetEntry("assumption-confirmed", "confirmed-assumption", "confirmed", verbatimText),
    facetEntry("assumption-builder", "builder-assumption", "builder-assumption", verbatimText)
  ];
  facets.priceAndMarketMechanics = {
    applicability: "not-applicable",
    summary: "This fixture has no market or price discovery.",
    entries: [{
      ...facetEntry("market-not-applicable", "market-applicability", "builder-assumption", verbatimText),
      applicability: "not-applicable"
    }]
  };
  facets.routing = {
    applicability: "not-applicable",
    summary: "This fixture is a no-market reward service and must not manufacture a trade route.",
    entries: [{
      ...facetEntry("trade-capability-not-applicable", "trade-capability", "builder-assumption", verbatimText),
      applicability: "not-applicable"
    }]
  };
  facets.ownerDecisions = {
    applicability: "not-applicable",
    summary: "No material owner decision remains open in this fixture.",
    entries: [{
      ...facetEntry("owner-decision-none", "no-owner-decision", "builder-assumption", verbatimText),
      applicability: "not-applicable"
    }]
  };
  return {
    schemaVersion: "1.0.0",
    applicationId: "reward-service",
    revision: 1,
    intent: {
      encoding: "utf-8",
      verbatimText,
      byteLength: Buffer.byteLength(verbatimText),
      sha256: sha256(Buffer.from(verbatimText))
    },
    facets,
    extensions: []
  };
}

export function facetEntry(id, kind, provenance, intent) {
  return {
    id,
    kind,
    applicability: "applicable",
    statement: `${id} is explicit.`,
    provenance,
    sourceSpans: provenance === "confirmed" ? [sourceSpan(intent)] : [],
    rationale: `${id} is required for complete product modeling.`,
    ownerQuestion: provenance === "owner-required" ? `Should ${id} be enabled?` : null,
    externalDependencyRefs: provenance === "external-unresolved" ? ["external-dependency"] : [],
    evidenceRefs: []
  };
}

export function sourceSpan(intent) {
  const bytes = Buffer.from(intent);
  return { startByte: 0, endByte: bytes.length, sha256: sha256(bytes) };
}

export function makeProductGraph(spec) {
  const applicableFacetRefs = Object.values(spec.facets).flatMap(({ entries }) => entries.filter(({ applicability }) => applicability !== "not-applicable").map(({ id }) => id));
  const failure = "service-unavailable";
  const recovery = "restore-service";
  const invariant = "reward-conservation";
  return {
    schemaVersion: "1.0.0",
    applicationId: spec.applicationId,
    revision: spec.revision,
    projectSpecSha256: projectArtifactSha256(spec),
    graphs: {
      system: {
        applicability: "applicable",
        justification: "The user and service form the smallest correct no-pool system.",
        nodes: [{ id: "settlement-service", label: "Reward service", type: "service", protocolRole: "none", implementationStatus: "planned", facetEntryRefs: applicableFacetRefs }],
        edges: []
      },
      state: {
        applicability: "applicable",
        justification: "Use and exit have explicit states.",
        states: [
          { id: "active-state", label: "Active", initial: true, terminal: false, entryAuthorityRefs: ["user-authority"], invariantRefs: [invariant] },
          { id: "exited-state", label: "Exited", initial: false, terminal: true, entryAuthorityRefs: ["user-authority"], invariantRefs: [invariant] }
        ],
        transitions: [{ id: "exit-transition", from: "active-state", to: "exited-state", trigger: "User requests exit.", guards: ["User is authenticated."], effects: ["Liability is settled."], authorityRefs: ["user-authority"], failureRef: failure }]
      },
      value: {
        applicability: "applicable",
        justification: "Reward liabilities and exits are explicit.",
        nodes: [
          { id: "reward-account", label: "Reward account", type: "liability", assetRefs: ["reward-unit"], custodyRef: null },
          { id: "user-account", label: "User account", type: "sink", assetRefs: ["reward-unit"], custodyRef: null }
        ],
        edges: [{ id: "reward-exit-flow", from: "reward-account", to: "user-account", assetRef: "reward-unit", amountModel: "Exact recorded reward amount.", purpose: "Exit settlement.", authorityRefs: ["user-authority"], liabilityEffect: "settles", backingRef: null, failureDestinationRef: null, conservationInvariantRef: invariant }]
      },
      authority: {
        applicability: "applicable",
        justification: "Only the user may exit their record.",
        nodes: [{ id: "user-authority", label: "Authenticated user", type: "user", mutable: false, trustAssumption: "Authentication binds the record owner." }],
        edges: [{ id: "user-controls-service", authorityRef: "user-authority", targetRef: "settlement-service", capability: "exit", scope: "Only the caller's record.", revocable: false, delayModel: "Immediate." }]
      },
      trust: {
        applicability: "applicable",
        justification: "User input crosses into the service trust zone.",
        zones: [
          { id: "user-zone", label: "User", trustModel: "Untrusted input.", memberRefs: ["user-authority"] },
          { id: "service-zone", label: "Service", trustModel: "Locally verified implementation.", memberRefs: ["settlement-service"] }
        ],
        boundaries: [{ id: "user-service-boundary", fromZone: "user-zone", toZone: "service-zone", assumption: "Input is authenticated and validated.", failureRef: failure, mitigationRefs: [invariant] }]
      },
      component: {
        applicability: "applicable",
        justification: "One service is the minimum implementation.",
        components: [{ id: "service-component", label: "Reward service component", type: "backend", disposition: "build", systemRefs: ["settlement-service"], responsibilities: ["Record rewards and settle exits."], interfaceRefs: [], authorityRefs: ["user-authority"], valueNodeRefs: ["reward-account", "user-account"], artifactRefs: ["src/app.mjs"] }],
        edges: []
      },
      deployment: {
        applicability: "applicable",
        justification: "The service has one locally verifiable deployment target.",
        targets: [{ id: "service-deployment", label: "Service target", type: "service", systemRef: "settlement-service", chainRef: null, artifactPath: "deploy/service.json", addressStatus: "not-applicable", address: null, evidenceRefs: [] }],
        edges: []
      },
      invariant: {
        applicability: "applicable",
        justification: "Reward accounting cannot create value on exit.",
        invariants: [{ id: invariant, kind: "accounting", statement: "Every exit reduces the recorded liability by exactly the delivered amount.", scopeRefs: ["service-component", "reward-account", "user-account"], testRefs: ["test/app.test.mjs"], failureRef: failure }],
        dependencies: []
      },
      failureRecovery: {
        applicability: "applicable",
        justification: "Service failure has an explicit manual recovery path.",
        failures: [{ id: failure, label: "Service unavailable", severity: "high", trigger: "The service cannot complete an exit.", affectedRefs: ["service-component", "settlement-service"], detection: "The required exit command fails.", recoveryRef: recovery }],
        recoveries: [{ id: recovery, label: "Restore service", authorityRefs: ["user-authority"], steps: ["Preserve the record and retry after service restoration."], restoresInvariantRefs: [invariant], terminalDisposition: "resume" }],
        edges: [{ id: "service-recovery-edge", failureRef: failure, recoveryRef: recovery, preconditions: ["The preserved record is intact."] }]
      }
    },
    extensions: []
  };
}

export function makeArchitectures(spec, graph) {
  const dimensions = (rating) => Object.fromEntries(["trust", "capital", "liquidity", "latency", "gas", "operations", "review"].map((name) => [name, { rating, rationale: `${name} is explicitly compared.` }]));
  const noV4 = { pool: { disposition: "not-required", systemNodeRefs: [], rationale: "No pool is needed." }, customHook: { disposition: "not-required", systemNodeRefs: [], rationale: "No hook is needed." } };
  const candidate = (id, role, disposition, rating) => ({
    id,
    role,
    disposition,
    summary: `${role} candidate.`,
    justification: disposition === "modeled" ? "This is the smallest correct product architecture." : "This role was investigated and would add machinery without product value.",
    graphNodeRefs: disposition === "modeled" ? ["settlement-service", "service-component"] : [],
    facetEntryRefs: [],
    v4Usage: structuredClone(noV4),
    dimensions: dimensions(rating),
    gates: [{ id: `${id}-gate`, criterion: "Preserve intent without unnecessary custody or protocol machinery.", nonCompensable: true, result: disposition === "modeled" ? "pass" : "inapplicable", rationale: "The graph and design evidence establish the disposition.", evidenceRefs: disposition === "modeled" ? ["evidence/architecture.md"] : [] }]
  });
  return {
    schemaVersion: "1.0.0",
    applicationId: spec.applicationId,
    revision: spec.revision,
    projectSpecSha256: projectArtifactSha256(spec),
    productGraphSha256: projectArtifactSha256(graph),
    candidates: [
      candidate("minimum-correct-candidate", "minimum-correct", "modeled", "lower"),
      candidate("v4-native-candidate", "v4-native", "inapplicable", "not-applicable"),
      candidate("hybrid-candidate", "hybrid", "inapplicable", "not-applicable")
    ],
    selection: { candidateId: "minimum-correct-candidate", rationale: "The no-hook, no-pool service is the smallest architecture that preserves the product intent.", decisiveGateRefs: ["minimum-correct-candidate-gate"] }
  };
}

export function makeTradablePlanningBundle(routeType, { marketRef = "primary-market", tradeFacetEntryRef = "primary-trade-capability" } = {}) {
  const projectSpec = makeProjectSpec();
  projectSpec.facets.routing = {
    applicability: "applicable",
    summary: "The selected market requires a declared executable trade route.",
    entries: [facetEntry(tradeFacetEntryRef, "trade-capability", "builder-assumption", projectSpec.intent.verbatimText)]
  };
  projectSpec.facets.priceAndMarketMechanics = {
    applicability: "applicable",
    summary: "The selected market supplies bounded price discovery.",
    entries: [facetEntry("primary-market-mechanics", "market-mechanics", "builder-assumption", projectSpec.intent.verbatimText)]
  };
  const productGraph = makeProductGraph(projectSpec);
  const standard = routeType === "standard-uniswap-v4";
  productGraph.graphs.system.nodes.push({
    id: marketRef, label: "Primary market", type: "market",
    protocolRole: standard ? "uniswap-v4-pool" : "external-protocol",
    implementationStatus: "planned", facetEntryRefs: [tradeFacetEntryRef, "primary-market-mechanics"]
  });
  const architectureCandidates = makeArchitectures(projectSpec, productGraph);
  const selected = architectureCandidates.candidates[0];
  selected.graphNodeRefs.push(marketRef);
  if (standard) selected.v4Usage.pool = { disposition: "required", systemNodeRefs: [marketRef], rationale: "The standard route executes against this selected v4 pool." };
  architectureCandidates.productGraphSha256 = projectArtifactSha256(productGraph);
  const bundle = { projectSpec, productGraph, architectureCandidates };
  const repositoryPlan = makePlanningRepositoryPlan(bundle);
  const tradeCommands = [
    { id: "primary-quote-command", kind: "quote-test", argv: [process.execPath, "tools/project-stage.mjs", "quote-primary"] },
    { id: "primary-execution-command", kind: "execution-test", argv: [process.execPath, "tools/project-stage.mjs", "execute-primary"] }
  ].map((command) => ({ ...command, cwd: ".", required: true, timeoutMs: 30000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } }));
  if (standard) tradeCommands.push({ id: "fork-command", kind: "fork", argv: [process.execPath, "tools/project-stage.mjs", "fork-primary"], cwd: ".", required: true, timeoutMs: 30000, executionPolicy: { networkAccess: "forbidden", externalWrites: false } });
  repositoryPlan.commands.push(...tradeCommands);
  const planned = (id, artifactPath, kind) => ({ id, path: artifactPath, kind, systemRefs: [marketRef], required: true, status: "planned", sha256: null, byteLength: null });
  repositoryPlan.artifacts.configuration.push(planned("primary-trade-manifest", `.programmable/trade-capabilities/${marketRef}.v1.json`, "trade-capability-manifest"));
  for (const command of tradeCommands) {
    repositoryPlan.artifacts.evidence.push(planned(`${command.id}-receipt`, `.programmable/command-receipts/${command.id}.v1.json`, "command-receipt"));
    if (["quote-test", "execution-test"].includes(command.kind)) repositoryPlan.artifacts.evidence.push(planned(`${command.id}-result`, `.programmable/trade-test-results/${command.id}.v1.json`, "trade-test-result"));
  }
  repositoryPlan.tradeCapability = {
    applicability: "tradable",
    markets: [{ marketSystemRef: marketRef, routeType, manifestArtifactId: "primary-trade-manifest", quoteCommandIds: ["primary-quote-command"], executionCommandIds: ["primary-execution-command"] }]
  };
  return { ...bundle, repositoryPlan };
}

export function makeArchitectureBundle() {
  const projectSpec = makeProjectSpec();
  const productGraph = makeProductGraph(projectSpec);
  const architectureCandidates = makeArchitectures(projectSpec, productGraph);
  const first = makeState({ projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec, productGraph }, "product-graphs", 2, first);
  const projectState = makeState({ projectSpec, productGraph, architectureCandidates }, "architecture-selection", 3, second);
  return { projectSpec, productGraph, architectureCandidates, projectState, previousState: second };
}

export function makeState(bundle, phase, sequence, previousState, repositoryPlan = undefined) {
  const spec = bundle.projectSpec;
  const graph = bundle.productGraph;
  const architectures = bundle.architectureCandidates;
  const plan = repositoryPlan ?? bundle.repositoryPlan;
  const entries = Object.values(spec.facets).flatMap(({ entries: values }) => values);
  const group = (provenance) => entries.filter((entry) => entry.provenance === provenance).map(({ id }) => id);
  const binding = (value, filePath) => value ? { path: filePath, sha256: projectArtifactSha256(value) } : null;
  return sealProjectState({
    schemaVersion: "1.0.0",
    applicationId: spec.applicationId,
    sequence,
    phase,
    status: "locally-complete",
    intentSha256: spec.intent.sha256,
    artifacts: {
      projectSpec: binding(spec, ".programmable/project-spec.v1.json"),
      productGraph: binding(graph, ".programmable/product-graph.v1.json"),
      architectureCandidates: binding(architectures, ".programmable/architecture-candidates.v1.json"),
      repositoryPlan: binding(plan, ".programmable/repository-plan.v1.json")
    },
    selectedArchitectureId: architectures?.selection?.candidateId ?? null,
    provenanceRefs: { confirmed: group("confirmed"), builderAssumptions: group("builder-assumption"), ownerRequired: group("owner-required"), externalUnresolved: group("external-unresolved") },
    graphRefs: {
      invariants: (graph?.graphs?.invariant?.invariants ?? []).map(({ id }) => id),
      failures: (graph?.graphs?.failureRecovery?.failures ?? []).map(({ id }) => id),
      recoveries: (graph?.graphs?.failureRecovery?.recoveries ?? []).map(({ id }) => id)
    },
    repository: { root: ".", branch: plan?.repository?.branch ?? null, headCommit: plan?.repository?.headCommit ?? null, generatedPaths: plan ? Object.values(plan.artifacts).flat().map(({ path: artifactPath }) => artifactPath) : [] },
    commandResults: plan?.commandResults ?? [],
    blockers: [],
    next: { action: `Continue after ${phase}.`, workingDirectory: ".", resumeCommand: ["node", "scripts/project-compiler.mjs", "validate", "--repository-root", ".", "--state", `.programmable/project-states/${String(sequence).padStart(6, "0")}-${phase}.v1.json`] },
    authorization: disabledReleaseActions()
  }, { previousState });
}

export function statePayload(bundle, phase, sequence) {
  const state = makeState(bundle, "architecture-selection", 3, bundle.previousState);
  const { integrity: _integrity, ...payload } = state;
  return { ...payload, phase, sequence };
}

export function makePlanningRepositoryPlan(bundle) {
  const artifact = (id, artifactPath, kind) => ({ id, path: artifactPath, kind, systemRefs: ["service-component"], required: true, status: "planned", sha256: null, byteLength: null });
  const commands = ["install", "build", "typecheck", "lint", "simulation", "test", "evidence"].map((kind) => ({
    id: `${kind}-command`,
    kind,
    argv: ["node", "tools/project-stage.mjs", kind],
    cwd: ".",
    required: true,
    timeoutMs: 30000,
    executionPolicy: { networkAccess: "forbidden", externalWrites: false }
  }));
  return {
    schemaVersion: "1.0.0",
    applicationId: bundle.projectSpec.applicationId,
    revision: bundle.projectSpec.revision,
    projectSpecSha256: projectArtifactSha256(bundle.projectSpec),
    architectureCandidatesSha256: projectArtifactSha256(bundle.architectureCandidates),
    productGraphSha256: projectArtifactSha256(bundle.productGraph),
    selectedArchitectureId: bundle.architectureCandidates.selection.candidateId,
    repository: { root: ".", branch: null, headCommit: null },
    completionStatus: "planning",
    artifacts: {
      source: [
        artifact("source-artifact", "src/app.mjs", "application-source"),
        artifact("stage-tool-artifact", "tools/project-stage.mjs", "verification-source")
      ],
      configuration: [artifact("configuration-artifact", ".gitignore", "repository-configuration")],
      dependencyLocks: [artifact("dependency-lock-artifact", "package-lock.json", "dependency-lock")],
      tests: [artifact("test-artifact", "test/app.test.mjs", "unit-test")],
      deploymentInputs: [artifact("deployment-artifact", "deploy/service.json", "service-deployment-input")],
      evidence: [
        artifact("evidence-artifact", "evidence/architecture.md", "architecture-evidence"),
        ...commands.map(({ id }) => artifact(`${id}-receipt`, `.programmable/command-receipts/${id}.v1.json`, "command-receipt"))
      ],
      documentation: [artifact("documentation-artifact", "README.md", "readme")]
    },
    tradeCapability: { applicability: "no-market", markets: [] },
    v4HookSemanticContracts: [],
    commands,
    commandResults: [],
    completionClaim: { scope: "local-repository-evidence-only", approvalCreated: false, auditClaimed: false, productionClaimed: false, externalActionsPerformed: [] },
    authorization: disabledReleaseActions()
  };
}

export function createMaterializedTradableRepository(t, {
  marketRef = "primary-market",
  tradeFacetEntryRef = "primary-trade-capability",
  manifestTemplate = null,
  feeReceiptBytes = null,
  preserveFeeBinding = false
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-trade-executor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = makeTradablePlanningBundle("standard-uniswap-v4", { marketRef, tradeFacetEntryRef });
  const plan = bundle.repositoryPlan;
  const placeholderCommands = new Set(["primary-quote-command", "primary-execution-command"]);
  plan.commands = plan.commands.filter(({ id }) => !placeholderCommands.has(id));
  plan.artifacts.configuration = plan.artifacts.configuration.filter(({ kind }) => kind !== "trade-capability-manifest");
  plan.artifacts.evidence = plan.artifacts.evidence.filter(({ id }) => ![...placeholderCommands].some((commandId) => id === `${commandId}-receipt` || id === `${commandId}-result`));

  const manifest = manifestTemplate === null
    ? createStandardTradeCapabilityManifestFixtureV1({ applicationId: bundle.projectSpec.applicationId, marketRef })
    : structuredClone(manifestTemplate);
  if (manifestTemplate === null) manifest.manifestId = "primary-trade-manifest";
  const declarations = [...manifest.testEvidence.quoteTests, ...manifest.testEvidence.executionTests];
  const testFunctions = declarations.map((declaration) => {
    const functionName = declaration.runnerTestSignature.slice(0, -2);
    const fixturePath = `fixtures/trade/${declaration.commandId}.v1.json`;
    if (declaration.resultContract === "trade-quote-test-result-v1") return `  function ${functionName}() external { _quote("${fixturePath}"); }`;
    if (declaration.expectedOutcome === "swap-succeeds") return `  function ${functionName}() external { _execute("${fixturePath}"); }`;
    return `  function ${functionName}() external { _reject("${fixturePath}", hex"${tradeTestRevertDataFixtureV1(declaration.scenario).slice(2)}"); }`;
  }).join("\n");
  const testSource = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\ninterface Vm {\n  function readFile(string calldata path) external view returns (string memory);\n  function etch(address target, bytes calldata code) external;\n  function mockCallRevert(address callee, bytes calldata data, bytes calldata revertData) external;\n}\n\ncontract TraceTarget {\n  fallback() external { assembly { mstore(0, shl(224, ${TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1})) return(0, 4) } }\n}\n\ncontract TradeCapabilityRouteTest {\n  bool public constant IS_TEST = true;\n  event log_string(string value);\n  Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));\n  address private constant ROUTER = ${manifest.route.router.address};\n  address private constant QUOTER = ${manifest.route.quoter.address};\n  bytes4 private constant QUOTE_CALLDATA = ${TRADE_TEST_QUOTE_CALLDATA_FIXTURE_V1};\n  bytes4 private constant EXECUTION_CALLDATA = ${TRADE_TEST_EXECUTION_CALLDATA_FIXTURE_V1};\n\n  function setUp() external {\n    TraceTarget implementation = new TraceTarget();\n    vm.etch(ROUTER, address(implementation).code);\n    vm.etch(QUOTER, address(implementation).code);\n  }\n\n  function _emit(string memory fixturePath) private {\n    emit log_string(string.concat("PROGRAMMABLE_TRADE_RESULT_V1:", vm.readFile(fixturePath)));\n  }\n\n  function _quote(string memory fixturePath) private {\n    (bool ok, bytes memory output) = QUOTER.call(abi.encodePacked(QUOTE_CALLDATA));\n    require(ok && keccak256(output) == keccak256(hex"${TRADE_TEST_QUOTE_RETURN_DATA_FIXTURE_V1.slice(2)}"), "quote trace mismatch");\n    _emit(fixturePath);\n  }\n\n  function _execute(string memory fixturePath) private {\n    (bool ok,) = ROUTER.call(abi.encodePacked(EXECUTION_CALLDATA));\n    require(ok, "execution trace mismatch");\n    _emit(fixturePath);\n  }\n\n  function _reject(string memory fixturePath, bytes memory expectedRevertData) private {\n    bytes memory callData = abi.encodePacked(EXECUTION_CALLDATA);\n    vm.mockCallRevert(ROUTER, callData, expectedRevertData);\n    (bool ok, bytes memory output) = ROUTER.call(callData);\n    require(!ok && keccak256(output) == keccak256(expectedRevertData), "revert trace mismatch");\n    _emit(fixturePath);\n  }\n\n${testFunctions}\n}\n`;
  const stageTool = `import fs from "node:fs";\nconst stage = process.argv[2];\nconst targets = { install: "package-lock.json", build: "src/app.mjs", typecheck: "src/app.mjs", lint: ".gitignore", simulation: "deploy/service.json", test: "test/app.test.mjs", evidence: "evidence/architecture.md", "fork-primary": "src/TradeCapabilityRoute.sol" };\nconst target = targets[stage];\nif (!target) throw new Error("unknown stage");\nconst bytes = fs.readFileSync(target);\nif (bytes.length === 0) throw new Error("empty stage target");\nprocess.stdout.write(stage + ":" + target + ":" + bytes.length + "\\n");\n`;
  const defaultFeeReceiptPath = "evidence/fee-conformance-main-market.receipt.v1.json";
  const preservedFeeReceiptPath = manifest.feeBehavior.programmableFeeV2.receiptPath;
  const selectedFeeReceiptPath = preserveFeeBinding ? preservedFeeReceiptPath : defaultFeeReceiptPath;
  const files = new Map([
    ["src/app.mjs", "export const rewardService = true;\n"],
    ["src/TradeCapabilityRoute.sol", "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract TradeCapabilityRoute { function route(bytes calldata) external pure returns (bytes memory) { return hex\"01\"; } }\n"],
    ["tools/project-stage.mjs", stageTool],
    [".gitignore", "cache/\nnode_modules/\nout/\nsubmission/\n.programmable/repository-plan.materializing.v1.json\n"],
    ["foundry.toml", "[profile.default]\nsrc = \"src\"\ntest = \"test\"\nout = \"out\"\nlibs = []\nfs_permissions = [{ access = \"read\", path = \"./fixtures\" }]\n"],
    ["package-lock.json", "{\"lockfileVersion\":3}\n"],
    ["test/app.test.mjs", "import assert from 'node:assert/strict';\nimport { rewardService } from '../src/app.mjs';\nassert.equal(rewardService, true);\n"],
    ["test/TradeCapabilityRoute.t.sol", testSource],
    ["deploy/service.json", "{\"service\":\"local\"}\n"],
    ["evidence/architecture.md", "# Architecture evidence\n\nThe selected market has a bounded local v4 route.\n"],
    ["evidence/trade/route-implementation-closure.v1.json", "{\"paths\":[\"package-lock.json\",\"src/TradeCapabilityRoute.sol\",\"test/TradeCapabilityRoute.t.sol\"]}\n"],
    ["evidence/deployments/universal-router.json", "{\"deployment\":\"local-universal-router-fixture\"}\n"],
    ["evidence/deployments/v4-quoter.json", "{\"deployment\":\"local-v4-quoter-fixture\"}\n"],
    ["evidence/deployments/permit2.json", "{\"deployment\":\"local-permit2-fixture\"}\n"],
    [selectedFeeReceiptPath, feeReceiptBytes ?? "{\"status\":\"local-fixture-not-approval\"}\n"],
    ["README.md", "# Tradable reward service\n"]
  ]);
  for (const [relativePath, contents] of files) writeFile(root, relativePath, contents);

  const fileBinding = (relativePath) => {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    return { path: relativePath, sha256: sha256(bytes), byteLength: bytes.length };
  };
  Object.assign(manifest.source, {
    repositoryUri: "https://github.com/example/tradable-reward-service",
    routeImplementationSha256: fileBinding(manifest.source.routeImplementationPath).sha256,
    routeImplementationClosureSha256: fileBinding(manifest.source.routeImplementationClosurePath).sha256
  });
  manifest.dependencies.lockfilePath = "package-lock.json";
  manifest.dependencies.lockfileSha256 = fileBinding("package-lock.json").sha256;
  const feeBinding = fileBinding(selectedFeeReceiptPath);
  if (!preserveFeeBinding) Object.assign(manifest.feeBehavior.programmableFeeV2, { receiptArtifactId: "fee-conformance-main-market", receiptPath: feeBinding.path, receiptSha256: feeBinding.sha256 });
  const sourceBinding = fileBinding("test/TradeCapabilityRoute.t.sol");
  const tradeCommands = [];
  for (const [tests, kind] of [[manifest.testEvidence.quoteTests, "quote-test"], [manifest.testEvidence.executionTests, "execution-test"]]) {
    for (const declaration of tests) {
      const command = {
        id: declaration.commandId,
        kind,
        argv: [...declaration.command.argv],
        cwd: ".",
        required: true,
        timeoutMs: 30000,
        executionPolicy: { networkAccess: "forbidden", externalWrites: false }
      };
      declaration.command = { argv: [...command.argv], workingDirectory: command.cwd, environmentSha256: projectCommandEnvironmentSha256(command) };
      declaration.testSourceArtifact = { ...sourceBinding };
      declaration.resultArtifactPath = `.programmable/trade-test-results/${command.id}.v1.json`;
      tradeCommands.push(command);
    }
  }
  const results = createTradeTestResultFixturesV1(manifest);
  for (const declaration of declarations) writeFile(root, `fixtures/trade/${declaration.commandId}.v1.json`, `${canonicalJsonV2(results.get(declaration.resultArtifactPath))}\n`);
  writeFile(root, `.programmable/trade-capabilities/${marketRef}.v1.json`, `${canonicalJsonV2(manifest)}\n`);

  const planned = (id, artifactPath, kind, systemRefs = [marketRef]) => ({ id, path: artifactPath, kind, systemRefs, required: true, status: "planned", sha256: null, byteLength: null });
  plan.artifacts.source.push(planned("trade-route-source", manifest.source.routeImplementationPath, "trade-route-source"));
  plan.artifacts.configuration.push(planned("foundry-configuration", "foundry.toml", "repository-configuration"));
  plan.artifacts.configuration.push(planned(manifest.manifestId, `.programmable/trade-capabilities/${marketRef}.v1.json`, "trade-capability-manifest"));
  plan.artifacts.tests.push(planned("trade-route-test-source", sourceBinding.path, "trade-route-test"));
  plan.artifacts.tests.push(...declarations.map(({ commandId }) => planned(`${commandId}-fixture`, `fixtures/trade/${commandId}.v1.json`, "trade-result-fixture")));
  plan.artifacts.deploymentInputs.push(
    planned("universal-router-deployment", manifest.route.router.deploymentEvidenceRef, "route-deployment-evidence"),
    planned("v4-quoter-deployment", manifest.route.quoter.deploymentEvidenceRef, "route-deployment-evidence"),
    planned("permit2-deployment", manifest.route.fundingProfiles.find(({ permit2 }) => permit2.mode === "used").permit2.deploymentEvidenceRef, "route-deployment-evidence")
  );
  plan.artifacts.evidence.push(
    planned("trade-route-closure", manifest.source.routeImplementationClosurePath, "trade-route-source-closure"),
    planned(preserveFeeBinding ? manifest.feeBehavior.programmableFeeV2.receiptArtifactId : "fee-conformance-main-market", feeBinding.path, "fee-conformance-receipt")
  );
  plan.commands.push(...tradeCommands);
  for (const command of tradeCommands) {
    plan.artifacts.evidence.push(planned(`${command.id}-receipt`, `.programmable/command-receipts/${command.id}.v1.json`, "command-receipt"));
    plan.artifacts.evidence.push(planned(`${command.id}-result`, `.programmable/trade-test-results/${command.id}.v1.json`, "trade-test-result"));
  }
  plan.tradeCapability.markets[0] = {
    marketSystemRef: marketRef,
    routeType: manifest.route.type,
    manifestArtifactId: manifest.manifestId,
    quoteCommandIds: manifest.testEvidence.quoteTests.map(({ commandId }) => commandId),
    executionCommandIds: manifest.testEvidence.executionTests.map(({ commandId }) => commandId)
  };
  for (const group of Object.keys(plan.artifacts)) plan.artifacts[group] = plan.artifacts[group].map((artifact) => {
    if (["command-receipt", "trade-test-result"].includes(artifact.kind)) return artifact;
    const binding = fileBinding(artifact.path);
    return { ...artifact, status: "verified", sha256: binding.sha256, byteLength: binding.byteLength };
  });
  plan.completionStatus = "materializing";

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Trade Executor Test"]);
  git(root, ["config", "user.email", "trade-executor@example.invalid"]);
  git(root, ["add", "."]);
  if (preserveFeeBinding && selectedFeeReceiptPath.startsWith("submission/")) git(root, ["add", "-f", "--", selectedFeeReceiptPath]);
  git(root, ["commit", "-qm", "tradable source fixture"]);
  plan.repository.branch = git(root, ["branch", "--show-current"]);
  plan.repository.headCommit = git(root, ["rev-parse", "HEAD"]);
  return { root, bundle, plan, manifest };
}

// Static completion fixtures deliberately exercise only receipt validation.
// They never run repository or candidate bytes and remain explicitly
// unauthenticated (`UNTRUSTED_DETERMINISTIC_RECEIPT_CONTENT_MATCH`).
export function materializeStaticUntrustedEvidenceFixture(repositoryRoot, repositoryPlan, { manifest = null } = {}) {
  const planned = structuredClone(repositoryPlan);
  const source = {
    headCommit: git(repositoryRoot, ["rev-parse", "HEAD"]),
    tree: git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
    branch: git(repositoryRoot, ["branch", "--show-current"]),
    gitStatusSha256: sha256Bytes(Buffer.alloc(0))
  };
  const artifacts = Object.values(planned.artifacts).flat();
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const declarationsByCommand = manifest === null ? new Map() : new Map([
    ...manifest.testEvidence.quoteTests,
    ...manifest.testEvidence.executionTests
  ].map((declaration) => [declaration.commandId, declaration]));
  const emitted = [];

  for (const command of planned.commands) {
    const receiptArtifact = artifactsById.get(`${command.id}-receipt`);
    assert.equal(receiptArtifact?.kind, "command-receipt");
    const declaration = declarationsByCommand.get(command.id) ?? null;
    let domainEvidence = null;
    let resultRecord = null;
    const stdout = `STATIC_UNTRUSTED_FIXTURE_ONLY:${command.id}\n`;
    if (declaration !== null) {
      const resultArtifact = artifactsById.get(`${command.id}-result`);
      assert.equal(resultArtifact?.kind, "trade-test-result");
      const result = JSON.parse(fs.readFileSync(path.join(repositoryRoot, `fixtures/trade/${command.id}.v1.json`), "utf8"));
      const resultBytes = Buffer.from(`${canonicalJsonV2(result)}\n`, "utf8");
      const calls = expectedTradeRunnerCallsV1(result, declaration).map((call) => ({
        ...call,
        outputSha256: call.outputSha256 ?? sha256Bytes(Buffer.alloc(0)),
        occurrences: 1
      }));
      const stdoutBytes = Buffer.from(stdout, "utf8");
      const runnerEvidence = {
        contract: "forge-test-json-v1",
        matchPath: declaration.command.argv[declaration.command.argv.indexOf("--match-path") + 1],
        testSignature: declaration.runnerTestSignature,
        sourcePath: declaration.testSourceArtifact.path,
        sourceArtifactSha256: declaration.testSourceArtifact.sha256,
        sourceArtifactByteLength: declaration.testSourceArtifact.byteLength,
        suitesObserved: 1,
        testsObserved: 1,
        passedTests: 1,
        failedTests: 0,
        resultLogsObserved: 1,
        unitGas: 1,
        callEvidence: calls,
        runnerOutputSha256: sha256Bytes(stdoutBytes),
        runnerOutputByteLength: stdoutBytes.length
      };
      domainEvidence = {
        contract: "trade-command-domain-evidence-v1",
        manifestArtifactId: manifest.manifestId,
        manifestSha256: tradeCapabilityManifestSha256V1(manifest),
        marketRef: manifest.marketRef,
        testId: declaration.id,
        modeRef: declaration.modeRef,
        semanticAdequacy: TRADE_TEST_SEMANTIC_ADEQUACY_V1,
        runnerEvidence,
        resultContract: declaration.resultContract,
        resultArtifactId: resultArtifact.id,
        resultArtifactPath: resultArtifact.path,
        resultArtifactSha256: sha256(resultBytes),
        resultArtifactByteLength: resultBytes.length
      };
      resultRecord = { artifact: resultArtifact, value: result, bytes: resultBytes };
    }
    const commandCwd = resolveProjectCommandCwd(repositoryRoot, command.cwd);
    const receipt = createProjectCommandReceipt({
      repositoryPlan: planned,
      command,
      source,
      tool: resolveProjectCommandTool(command.argv[0], commandCwd),
      executionResult: { stdout, stderr: "" },
      maximumOutputBytes: projectCommandMaximumOutputBytes(command),
      domainEvidence,
      tradeExecution: null
    });
    emitted.push({ command, receiptArtifact, receipt, resultRecord });
  }

  const completed = structuredClone(planned);
  completed.completionStatus = "COMPLETE";
  const completedById = new Map(Object.values(completed.artifacts).flat().map((artifact) => [artifact.id, artifact]));
  for (const { receiptArtifact, receipt, resultRecord } of emitted) {
    const receiptBytes = Buffer.from(`${canonicalJsonV2(receipt)}\n`, "utf8");
    writeFile(repositoryRoot, receiptArtifact.path, receiptBytes);
    Object.assign(completedById.get(receiptArtifact.id), { status: "verified", sha256: sha256(receiptBytes), byteLength: receiptBytes.length });
    if (resultRecord !== null) {
      writeFile(repositoryRoot, resultRecord.artifact.path, resultRecord.bytes);
      Object.assign(completedById.get(resultRecord.artifact.id), {
        status: "verified",
        sha256: sha256(resultRecord.bytes),
        byteLength: resultRecord.bytes.length
      });
    }
  }
  completed.commandResults = emitted.map(({ command, receiptArtifact, receipt }) => ({
    commandId: command.id,
    argvSha256: receipt.argvSha256,
    status: "passed",
    exitCode: 0,
    stdoutSha256: receipt.stdoutSha256,
    stderrSha256: receipt.stderrSha256,
    evidenceArtifactId: receiptArtifact.id
  }));
  writeFile(repositoryRoot, ".programmable/repository-plan.v1.json", `${canonicalJsonV2(completed)}\n`);
  return {
    status: "UNTRUSTED_STATIC_FIXTURE_MATERIALIZED",
    repositoryPlan: completed,
    receiptPaths: emitted.map(({ receiptArtifact }) => receiptArtifact.path),
    tradeResultPaths: emitted.flatMap(({ resultRecord }) => resultRecord === null ? [] : [resultRecord.artifact.path])
  };
}

export async function createCompleteRepository(t, options = {}) {
  const ready = createMaterializedRepository(t, options);
  const execution = materializeStaticUntrustedEvidenceFixture(ready.root, ready.plan);
  assert.equal(execution.status, "UNTRUSTED_STATIC_FIXTURE_MATERIALIZED");
  const plan = execution.repositoryPlan;
  const first = makeState({ projectSpec: ready.bundle.projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec: ready.bundle.projectSpec, productGraph: ready.bundle.productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec: ready.bundle.projectSpec, productGraph: ready.bundle.productGraph, architectureCandidates: ready.bundle.architectureCandidates }, "architecture-selection", 3, second);
  const fourth = makeState({ ...ready.bundle, repositoryPlan: plan }, "repository-materialization", 4, third, plan);
  const fifth = makeState({ ...ready.bundle, repositoryPlan: plan }, "verification", 5, fourth, plan);
  const jsonFiles = new Map([
    [".programmable/project-spec.v1.json", ready.bundle.projectSpec],
    [".programmable/product-graph.v1.json", ready.bundle.productGraph],
    [".programmable/architecture-candidates.v1.json", ready.bundle.architectureCandidates],
    [".programmable/project-states/000004-repository-materialization.v1.json", fourth],
    [".programmable/project-states/000005-verification.v1.json", fifth]
  ]);
  for (const [relativePath, value] of jsonFiles) writeFile(ready.root, relativePath, `${canonicalJsonV2(value)}\n`);
  git(ready.root, ["add", ".programmable"]);
  git(ready.root, ["commit", "-qm", "record deterministic execution evidence"]);
  return {
    root: ready.root,
    statePath: ".programmable/project-states/000005-verification.v1.json",
    previousStatePath: ".programmable/project-states/000004-repository-materialization.v1.json",
    bundle: { ...ready.bundle, repositoryPlan: plan, projectState: fifth, previousState: fourth }
  };
}

export function createMaterializedRepository(t, { extraFiles = [], mutatePlan = null, setup = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-compiler-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = makeArchitectureBundle();
  const plan = makePlanningRepositoryPlan(bundle);
  const fileContents = new Map([
    ["src/app.mjs", "export const rewardService = true;\n"],
    ["tools/project-stage.mjs", `import fs from "node:fs";\nconst stage = process.argv[2];\nconst targets = { install: "package-lock.json", build: "src/app.mjs", typecheck: "src/app.mjs", lint: ".gitignore", simulation: "deploy/service.json", test: "test/app.test.mjs", evidence: "evidence/architecture.md" };\nconst target = targets[stage];\nif (!target) throw new Error("unknown stage");\nconst bytes = fs.readFileSync(target);\nif (bytes.length === 0) throw new Error("empty stage target");\nprocess.stdout.write(stage + ":" + target + ":" + bytes.length + "\\n");\n`],
    [".gitignore", "node_modules/\n.programmable/repository-plan.materializing.v1.json\n"],
    ["package-lock.json", "{\"lockfileVersion\":3}\n"],
    ["test/app.test.mjs", "import assert from 'node:assert/strict';\nimport { rewardService } from '../src/app.mjs';\nassert.equal(rewardService, true);\n"],
    ["deploy/service.json", "{\"service\":\"local\"}\n"],
    ["evidence/architecture.md", "# Architecture evidence\n\nNo hook and no pool are required.\n"],
    ["README.md", "# Reward service\n"],
    ...extraFiles
  ]);
  for (const [relativePath, contents] of fileContents) writeFile(root, relativePath, contents);
  const materialize = (artifact) => {
    if (artifact.kind === "command-receipt") return artifact;
    const bytes = fs.readFileSync(path.join(root, artifact.path));
    return { ...artifact, status: "verified", sha256: sha256(bytes), byteLength: bytes.length };
  };
  for (const group of Object.keys(plan.artifacts)) plan.artifacts[group] = plan.artifacts[group].map(materialize);
  plan.completionStatus = "materializing";

  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Project Compiler Test"]);
  git(root, ["config", "user.email", "project-compiler@example.invalid"]);
  if (setup) setup(root, plan);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  plan.repository.branch = git(root, ["branch", "--show-current"]);
  plan.repository.headCommit = git(root, ["rev-parse", "HEAD"]);
  if (mutatePlan) mutatePlan(plan);
  return { root, bundle, plan };
}

export function createUnresolvedOutputFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-project-output-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectSpec = makeProjectSpec();
  projectSpec.facets.routing.applicability = "unresolved";
  projectSpec.facets.routing.entries[0].id = "routing-trade-capability";
  projectSpec.facets.routing.entries[0].applicability = "unresolved";
  const productGraph = makeProductGraph(projectSpec);
  const architectureCandidates = makeArchitectures(projectSpec, productGraph);
  const repositoryPlan = makePlanningRepositoryPlan({ projectSpec, productGraph, architectureCandidates });
  repositoryPlan.tradeCapability.applicability = "unresolved";
  const first = makeState({ projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec, productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec, productGraph, architectureCandidates }, "architecture-selection", 3, second);
  const materializationState = makeState({ projectSpec, productGraph, architectureCandidates, repositoryPlan }, "repository-materialization", 4, third, repositoryPlan);
  const { integrity: _integrity, ...stateWithoutIntegrity } = materializationState;
  const projectState = sealProjectState({ ...stateWithoutIntegrity, status: "in-progress" }, { previousState: third });
  const projectFiles = new Map([
    [".programmable/project-spec.v1.json", projectSpec],
    [".programmable/product-graph.v1.json", productGraph],
    [".programmable/architecture-candidates.v1.json", architectureCandidates],
    [".programmable/repository-plan.v1.json", repositoryPlan],
    [".programmable/project-states/000003-architecture-selection.v1.json", third],
    [".programmable/project-states/000004-repository-materialization.v1.json", projectState]
  ]);
  for (const [relativePath, value] of projectFiles) writeFile(root, relativePath, `${canonicalJsonV2(value)}\n`);
  const draft = createOpenWorldDraftPackage({
    applicationId: projectSpec.applicationId,
    publicIdeaText: "Build a reward service; whether it needs a trade market remains unresolved.",
    sourceRef: "blind-natural-idea"
  });
  assert.equal(draft.materializationAllowed, true);
  for (const file of draft.files) writeFile(root, `submission/${file.path}`, file.content);
  return {
    root,
    input: {
      repositoryRoot: root,
      submissionRoot: path.join(root, "submission"),
      projectSpec,
      productGraph,
      architectureCandidates,
      repositoryPlan,
      projectState,
      previousState: third
    }
  };
}

export async function createTradableOutputFixture(t) {
  const applicationId = "reward-service";
  const prototype = createApplicableOpenWorldV2PrototypeFixture(applicationId);
  const submission = structuredClone(prototype.submission);
  const declaration = submission.tradeCapability.markets[0];
  const originalManifest = JSON.parse(prototype.files.get(declaration.manifest.path).toString("utf8"));
  const originalResultPaths = [
    ...originalManifest.testEvidence.quoteTests,
    ...originalManifest.testEvidence.executionTests
  ].map(({ resultArtifactPath }) => resultArtifactPath);
  const feeReceiptPath = submission.programmableFee.conformance.scopeArtifacts[0].receipt.path;
  const project = createMaterializedTradableRepository(t, {
    marketRef: declaration.marketRef,
    tradeFacetEntryRef: declaration.facetEntryRef ?? submission.tradeCapability.facetEntryRef,
    manifestTemplate: originalManifest,
    feeReceiptBytes: prototype.files.get(feeReceiptPath),
    preserveFeeBinding: true
  });
  const execution = materializeStaticUntrustedEvidenceFixture(project.root, project.plan, { manifest: project.manifest });
  assert.equal(execution.status, "UNTRUSTED_STATIC_FIXTURE_MATERIALIZED");
  const repositoryPlan = execution.repositoryPlan;
  const first = makeState({ projectSpec: project.bundle.projectSpec }, "project-spec", 1, null);
  const second = makeState({ projectSpec: project.bundle.projectSpec, productGraph: project.bundle.productGraph }, "product-graphs", 2, first);
  const third = makeState({ projectSpec: project.bundle.projectSpec, productGraph: project.bundle.productGraph, architectureCandidates: project.bundle.architectureCandidates }, "architecture-selection", 3, second);
  const fourth = makeState({ ...project.bundle, repositoryPlan }, "repository-materialization", 4, third, repositoryPlan);
  const projectState = makeState({ ...project.bundle, repositoryPlan }, "verification", 5, fourth, repositoryPlan);
  const projectFiles = new Map([
    [".programmable/project-spec.v1.json", project.bundle.projectSpec],
    [".programmable/product-graph.v1.json", project.bundle.productGraph],
    [".programmable/architecture-candidates.v1.json", project.bundle.architectureCandidates],
    [".programmable/project-states/000004-repository-materialization.v1.json", fourth],
    [".programmable/project-states/000005-verification.v1.json", projectState]
  ]);
  for (const [relativePath, value] of projectFiles) writeFile(project.root, relativePath, `${canonicalJsonV2(value)}\n`);
  git(project.root, ["add", ".programmable"]);
  git(project.root, ["commit", "-qm", "record tradable project output evidence"]);

  const submissionRoot = path.join(project.root, "submission");
  const packageFiles = new Map([...prototype.files].map(([relativePath, bytes]) => [relativePath, Buffer.from(bytes)]));
  for (const resultPath of originalResultPaths) packageFiles.delete(resultPath);
  const manifestBytes = Buffer.from(`${canonicalJsonV2(project.manifest)}\n`, "utf8");
  packageFiles.set(declaration.manifest.path, manifestBytes);
  declaration.manifest.sha256 = sha256(manifestBytes);
  declaration.manifest.byteLength = manifestBytes.length;
  for (const testDeclaration of [...project.manifest.testEvidence.quoteTests, ...project.manifest.testEvidence.executionTests]) {
    packageFiles.set(testDeclaration.resultArtifactPath, fs.readFileSync(path.join(project.root, testDeclaration.resultArtifactPath)));
  }
  const fidelityBinding = submission.intentPackage.intentFidelity;
  const fidelity = JSON.parse(packageFiles.get(fidelityBinding.path).toString("utf8"));
  fidelity.inputDigests.architectureSnapshotSha256 = architectureSnapshotSha256(submission);
  const fidelityBytes = Buffer.from(`${canonicalJsonV2(fidelity)}\n`, "utf8");
  packageFiles.set(fidelityBinding.path, fidelityBytes);
  fidelityBinding.sha256 = sha256(fidelityBytes);
  fidelityBinding.byteLength = fidelityBytes.length;
  packageFiles.set("submission.v2.json", Buffer.from(`${canonicalJsonV2(submission)}\n`, "utf8"));
  for (const [relativePath, bytes] of packageFiles) writeFile(submissionRoot, relativePath, bytes);
  return {
    input: {
      repositoryRoot: project.root,
      submissionRoot,
      projectSpec: project.bundle.projectSpec,
      productGraph: project.bundle.productGraph,
      architectureCandidates: project.bundle.architectureCandidates,
      repositoryPlan,
      projectState,
      previousState: fourth
    }
  };
}

export function structuredCloneProjectOutputInput(input) {
  return {
    repositoryRoot: input.repositoryRoot,
    submissionRoot: input.submissionRoot,
    projectSpec: structuredClone(input.projectSpec),
    productGraph: structuredClone(input.productGraph),
    architectureCandidates: structuredClone(input.architectureCandidates),
    repositoryPlan: structuredClone(input.repositoryPlan),
    projectState: structuredClone(input.projectState),
    previousState: structuredClone(input.previousState)
  };
}

export const deterministicTarget = "0x1111111111111111111111111111111111111111";
export const deterministicCallData = "0xaabb";
export const deterministicReturnData = "0xcc";
export const deterministicSuite = "test/Route.t.sol:RouteTest";
export const deterministicResult = Object.freeze({
  contract: "trade-quote-test-result-v1", status: "LOCAL_EVIDENCE_NOT_APPROVAL", value: "17",
  context: Object.freeze({ route: Object.freeze({ type: "standard-uniswap-v4" }) }),
  observation: Object.freeze({
    callBinding: Object.freeze({ target: deterministicTarget }),
    callDataSha256: sha256Bytes(Buffer.from(deterministicCallData.slice(2), "hex")),
    returnDataSha256: sha256Bytes(Buffer.from(deterministicReturnData.slice(2), "hex"))
  })
});
export const deterministicResultLog = `PROGRAMMABLE_TRADE_RESULT_V1:${canonicalJsonV2(deterministicResult)}`;
export const deterministicCommand = Object.freeze({
  id: "quote-primary", kind: "quote-test",
  argv: ["forge", "test", "--offline", "--json", "-vvvv", "--match-path", "test/Route.t.sol", "--match-test", "^testQuote\\(\\)$"],
  cwd: ".", required: true, timeoutMs: 30000,
  executionPolicy: Object.freeze({ networkAccess: "forbidden", externalWrites: false })
});
export const deterministicPlan = Object.freeze({
  schemaVersion: "1.0.0", applicationId: "receipt-determinism", revision: 1,
  completionStatus: "materializing", commands: [deterministicCommand], commandResults: [], artifacts: {},
  repository: Object.freeze({ branch: "main", headCommit: "1".repeat(40) }), authorization: Object.freeze({ approvalCreated: false })
});
export const deterministicSource = Object.freeze({ headCommit: "1".repeat(40), tree: "2".repeat(40), branch: "main", gitStatusSha256: sha256Bytes(Buffer.alloc(0)) });
export const deterministicTool = Object.freeze({ requested: "forge", resolvedPath: "/usr/local/bin/forge", byteLength: 1, sha256: `sha256:${"3".repeat(64)}` });
export const commandReceiptSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/command-receipt-v1.schema.json"), "utf8"));

export function deterministicTradeReceipt(stdout, parserBoundStdout = stdout) {
  const bytes = Buffer.from(parserBoundStdout, "utf8");
  const runnerEvidence = {
    contract: "forge-test-json-v1", matchPath: "test/Route.t.sol", testSignature: "testQuote()",
    sourcePath: "test/Route.t.sol", sourceArtifactSha256: `sha256:${"4".repeat(64)}`, sourceArtifactByteLength: 1,
    suitesObserved: 1, testsObserved: 1, passedTests: 1, failedTests: 0, resultLogsObserved: 1, unitGas: 123,
    callEvidence: [{ role: "quote-target", target: deterministicTarget, callKind: "CALL", calldataSha256: sha256Bytes(Buffer.from(deterministicCallData.slice(2), "hex")), outcome: "succeeded", outputSha256: sha256Bytes(Buffer.from(deterministicReturnData.slice(2), "hex")), occurrences: 1 }],
    runnerOutputSha256: sha256Bytes(bytes), runnerOutputByteLength: bytes.length
  };
  const domainEvidence = {
    contract: "trade-command-domain-evidence-v1", manifestArtifactId: "primary-market", manifestSha256: `sha256:${"5".repeat(64)}`,
    marketRef: "primary-market", testId: "quote-primary", modeRef: "zero-for-one-exact-input", semanticAdequacy: "PARTIAL_EVIDENCE",
    runnerEvidence, resultContract: "trade-quote-test-result-v1", resultArtifactId: "quote-primary-result",
    resultArtifactPath: ".programmable/trade-test-results/quote-primary.v1.json", resultArtifactSha256: `sha256:${"6".repeat(64)}`, resultArtifactByteLength: 1
  };
  return createProjectCommandReceipt({
    repositoryPlan: deterministicPlan, command: deterministicCommand, source: deterministicSource, tool: deterministicTool,
    executionResult: { stdout, stderr: "" }, maximumOutputBytes: PROJECT_TRADE_COMMAND_MAXIMUM_OUTPUT_BYTES,
    domainEvidence, tradeExecution: Object.freeze({ result: deterministicResult, runnerEvidence: Object.freeze(runnerEvidence) })
  });
}

export function deterministicForgeOutput({ suiteName = deterministicSuite, suiteDuration = "1ms", testDuration = "2ms", warning = "none", unrelatedFirst = true, reverseKeys = false, mutate = null } = {}) {
  const relevant = { trace: { address: deterministicTarget, kind: "CALL", data: deterministicCallData, success: true, status: "Return", output: deterministicReturnData } };
  const unrelated = { trace: { address: "0x2222222222222222222222222222222222222222", kind: "STATICCALL", data: "0x", success: true, status: "Return", output: "0x" } };
  const observed = { duration: testDuration, status: "Success", reason: null, decoded_logs: [deterministicResultLog], kind: { Unit: { gas: 123 } }, traces: [["Execution", { arena: unrelatedFirst ? [unrelated, relevant] : [relevant, unrelated] }]] };
  const suite = reverseKeys ? { warnings: [warning], test_results: { "testQuote()": observed }, duration: suiteDuration } : { duration: suiteDuration, test_results: { "testQuote()": observed }, warnings: [warning] };
  const output = { [suiteName]: suite };
  if (mutate) mutate(output);
  return `${JSON.stringify(output)}\n`;
}

export function deterministicRelevantTrace(output) {
  return output[deterministicSuite].test_results["testQuote()"].traces[0][1].arena.find(({ trace }) => trace.address === deterministicTarget).trace;
}

export function disabledReleaseActions() {
  return { approval: false, signature: false, deployment: false, publication: false, execution: false, registryWrite: false };
}

export function writeFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

export function artifactRecord(id, artifactPath, kind) {
  return { id, path: artifactPath, kind, status: "verified" };
}

export function git(root, args) {
  const result = childProcess.spawnSync("git", ["-C", root, ...args], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function slug(value) {
  return value.replaceAll(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
