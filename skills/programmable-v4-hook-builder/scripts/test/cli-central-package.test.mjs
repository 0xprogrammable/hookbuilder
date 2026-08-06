import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCentralApplicationPackage } from "../cli-central-package.mjs";
import { materializeExample } from "../example-materializer-core.mjs";
import { analyzeSubmission, canonicalJson } from "../submission-core.mjs";
import { builderTemplateFromPlan } from "../builder-template-contract.mjs";
import { composeTemplate, loadTemplateCatalog } from "../template-catalog-core.mjs";
import {
  validateAutonomousApplicationManifest,
  validateAutonomousLaunchSpecification
} from "../autonomous-admission-contract.mjs";

const trustedHostValidatorUrl = new URL("../../../../scripts/verify-public-hook-application-core.mjs", import.meta.url);
const trustedHostValidator = fs.existsSync(fileURLToPath(trustedHostValidatorUrl))
  ? await import(trustedHostValidatorUrl.href)
  : null;
const validatePublicApplicationPackageFiles = trustedHostValidator?.validatePublicApplicationPackageFiles;
const trustedHostSkipReason = "trusted host validator unavailable outside the canonical repository";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const submissionSchema = JSON.parse(
  fs.readFileSync(path.join(skillRoot, "references", "submission.schema.json"), "utf8")
);
const templateCatalog = loadTemplateCatalog({ skillRoot });

function trustedHostTest(name, implementation) {
  return test(name, implementation);
}

trustedHostTest("official analyzer output cannot project a pending platform-fee integration as ready", () => {
  const submission = materializeExample({
    skillRoot,
    exampleId: "dynamic-lp-fee"
  });
  const localReport = analyzeSubmission(submission, { schema: submissionSchema });
  assert.equal(localReport.decision, "REDESIGN_REQUIRED", JSON.stringify(localReport.findings));
  assert.ok(localReport.findings.some(({ code }) => code === "PROGRAMMABLE_FEE_INTEGRATION_PENDING"));

  const central = buildFixture(localReport, {
    completedGateIds: localReport.requiredGates
      .filter(({ stage }) => stage === "prototype")
      .map(({ id }) => id)
  });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "changes-required");
  assert.notEqual(validated.compatibility.result, "prototype-ready");
  assert.ok(validated.compatibility.findings.some(({ code }) => code === "PROGRAMMABLE_FEE_INTEGRATION_PENDING"));
  assert.equal(validated.application.schemaVersion, "1.0.0");
  assert.equal(validated.launch.schemaVersion, "programmable.launch-specification.v1");
  assert.equal(validated.evidenceIndex.evidence.some(({ id }) => id === "launch-specification"), true);
});

trustedHostTest("a manual candidate gate survives central projection as architecture review", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: [
      { id: "static-analysis", stage: "prototype", reason: "Static analysis is required." },
      {
        id: "human-economic-and-security-review",
        stage: "candidate",
        reason: "Automation cannot accept its own output."
      }
    ]
  };
  const central = buildFixture(localReport, {
    completedGateIds: ["static-analysis"]
  });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.deepEqual(
    validated.compatibility.findings.map(({ code, path }) => ({ code, path })),
    [{
      code: "REQUIRED_REVIEW_GATE",
      path: "$.requiredGates.candidate.human-economic-and-security-review"
    }]
  );
  assert.equal(validated.evidenceIndex.evidence[0].status, "blocked");
});

trustedHostTest("unknown language proposals survive central projection as architecture review", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [{
      severity: "warning",
      code: "DECLARED_FILE_TOOLING_REVIEW_REQUIRED",
      path: "$.implementation.sourcePaths[1]",
      message: "service/settlement.py is byte-bound but has no deterministic dependency scanner.",
      remediation: "Add a pinned language scanner or an attributable manual review for the exact file."
    }],
    requiredGates: [{
      id: "declared-file-tooling-or-manual-review",
      stage: "candidate",
      reason: "The declared Python source needs supported tooling or attributable manual review."
    }]
  };
  const central = buildFixture(localReport, { stage: "proposal" });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.deepEqual(
    validated.compatibility.findings.map(({ code }) => code),
    ["DECLARED_FILE_TOOLING_REVIEW_REQUIRED", "REQUIRED_REVIEW_GATE"]
  );
  assert.equal(validated.evidenceIndex.evidence[0].status, "blocked");
});

trustedHostTest("a proposal companion remains visible as explicit closure architecture review", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    closure: { status: "complete", diagnostics: [] },
    findings: [],
    requiredGates: []
  };
  const reviewTarget = {
    closure: {
      status: "incomplete",
      diagnostics: [{
        code: "COMPANION_CLOSURE_REVIEW_REQUIRED",
        detail: "The exact companion revision is bound, but its semantic dependency and build closure is not proven.",
        path: ".programmable/companions/game-server.json"
      }]
    }
  };
  const central = buildFixture(localReport, { stage: "proposal", reviewTarget });
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.ok(validated.compatibility.findings.some(({ code }) => code === "COMPANION_CLOSURE_REVIEW_REQUIRED"));
  assert.ok(validated.compatibility.findings.some(({ path }) => path.includes("review-target-closure-architecture-review")));
});

trustedHostTest("a non-Mainnet application projects to architecture review rather than changes required", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [{
      severity: "warning",
      code: "PROGRAMMABLE_PLATFORM_CHAIN_NOT_CURRENTLY_INTEGRATED",
      path: "$.target.chainId",
      message: "Base is application-eligible, but the current Programmable launch runtime is Ethereum Mainnet-only.",
      remediation: "Continue review without a launch claim and wait for a maintainer-owned chain integration release."
    }],
    requiredGates: [{
      id: "programmable-platform-target-chain-integration",
      stage: "release",
      reason: "The exact target chain must be integrated and released before launch."
    }]
  };
  const central = buildFixture(localReport);
  const validated = validateCentral(central);

  assert.equal(validated.compatibility.result, "architecture-review-required");
  assert.equal(validated.compatibility.result === "changes-required", false);
  assert.ok(validated.compatibility.findings.some(({ code }) => code === "PROGRAMMABLE_PLATFORM_CHAIN_NOT_CURRENTLY_INTEGRATED"));
  assert.equal(validated.evidenceIndex.evidence[0].status, "blocked");
});

trustedHostTest("central projection rejects default-ignorable Unicode but preserves legitimate non-Latin text", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: [{
      id: "human-economic-and-security-review",
      stage: "candidate",
      reason: "Automation cannot accept its own output."
    }]
  };
  for (const character of ["\u034f", "\ufe0f", "\u{e0001}"]) {
    assert.throws(
      () => buildFixture(localReport, {
        mutateSubmission(submission) {
          submission.model.name = `Central${character}Model`;
        }
      }),
      (error) => error?.code === "CENTRAL_PACKAGE_INVALID"
    );
  }
  const central = buildFixture(localReport, {
    mutateSubmission(submission) {
      submission.model.name = "日本語モデル";
    }
  });
  assert.equal(validateCentral(central).application.project.title, "日本語モデル");
});

trustedHostTest("central projection keeps builder-template provenance out of the autonomous public manifest", () => {
  const localReport = {
    decision: "PROTOTYPE_READY",
    findings: [],
    requiredGates: [{
      id: "human-economic-and-security-review",
      stage: "candidate",
      reason: "Automation cannot accept its own output."
    }]
  };
  const builderTemplate = catalogBuilderTemplate();
  const central = buildFixture(localReport, { builderTemplate });
  assert.equal(Object.hasOwn(validateCentral(central).application, "builderTemplate"), false);
});

function buildFixture(localReport, {
  builderTemplate = manualBuilderTemplate(),
  completedGateIds = [],
  reviewTarget = null,
  stage = "prototype",
  mutateSubmission = null
} = {}) {
  const applicationId = "central-model";
  const packagePath = `submissions/${applicationId}`;
  const gateStatusPath = `${packagePath}/evidence/gate-status.json`;
  const compatibilityPath = `${packagePath}/compatibility-report.json`;
  const submissionPath = `${packagePath}/submission.json`;
  const feeSourcePath = "src/ProgrammableFeeHook.sol";
  const feeTestPath = "test/ProgrammableFeeHook.t.sol";
  const launchPath = `${packagePath}/launch.json`;
  const feeSourceBytes = Buffer.from("// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract ProgrammableFeeHook {}\n");
  const revisionObjectId = "a".repeat(40);
  const treeObjectId = "b".repeat(40);
  const source = {
    schemaVersion: "1.0.0",
    primary: {
      repositoryUri: "https://github.com/example/central-model",
      numericRepositoryId: "123456789",
      revisionObjectId,
      treeObjectId,
      sourcePaths: [compatibilityPath, feeTestPath, gateStatusPath, launchPath, submissionPath].sort(),
      contractPaths: [feeSourcePath],
      githubActionsRunIds: []
    },
    companions: []
  };
  const programmableFee = implementedProgrammableFee({ feeSourcePath, feeTestPath });
  const submission = {
    schemaVersion: 1,
    standardVersion: "1.5.0",
    stage,
    model: {
      id: applicationId,
      name: "Central Model",
      summary: "A deterministic central compatibility projection fixture.",
      userOutcome: "Deploy one deterministic fee hook from exact public source."
    },
    builder: { github: "example-builder", contact: "@example-builder" },
    builderTemplate: structuredClone(builderTemplate),
    target: { chainId: 1, solidityVersion: "0.8.26" },
    implementation: { gateStatusPath, specificationPath: launchPath },
    programmableFee
  };
  mutateSubmission?.(submission);
  const launch = launchFixture({ applicationId, feeSourcePath, feeSourceBytes });
  const headFiles = new Map([
    [`${packagePath}/PROPOSAL.md`, markdown("Proposal")],
    [`${packagePath}/TEST_PLAN.md`, markdown("Test plan")],
    [`${packagePath}/THREAT_MODEL.md`, markdown("Threat model")],
    [compatibilityPath, jsonBytes(localReport)],
    [launchPath, jsonBytes(launch)],
    [feeSourcePath, feeSourceBytes],
    [submissionPath, jsonBytes(submission)],
    [gateStatusPath, jsonBytes({
      schemaVersion: 1,
      gates: completedGateIds.map((id) => ({ id, status: "completed", evidence: [] }))
    })]
  ]);
  return buildCentralApplicationPackage({
    packagePath,
    applicationRevision: 1,
    builderIdentity: {
      githubUserId: "9007199254740993",
      githubLogin: "example-builder",
      profileUrl: "https://github.com/example-builder"
    },
    submission,
    source,
    packageResult: { preflightDecision: localReport.decision },
    reviewTarget,
    headFiles,
    sourceTopology: {
      primary: {
        executionRoots: ["."],
        rightsDeclaration: {
          basis: "applicant-original",
          licenseBindings: [],
          authorizationGrantId: null
        }
      },
      companions: []
    }
  });
}

function launchFixture({ applicationId, feeSourcePath, feeSourceBytes }) {
  return {
    schemaVersion: "programmable.launch-specification.v1",
    applicationId,
    language: "solidity",
    compiler: {
      profileId: "programmable:solidity-solc-0.8.26-v1",
      family: "solc",
      version: "0.8.26",
      settings: {}
    },
    chain: { namespace: "eip155", reference: "1", profileId: "ethereum-mainnet-v1" },
    launcher: { route: { kind: "evm.create2", adapterId: "adapter:create2" } },
    rootComponentId: "component:root",
    rootTargetId: "target:root",
    components: [{
      componentId: "component:root",
      kind: "evm.contract",
      sourceIds: ["source:primary"],
      targetIds: ["target:root"],
      attributes: { summary: "Canonical root fee hook target." }
    }],
    targets: [{
      targetId: "target:root",
      componentId: "component:root",
      sourceId: "source:primary",
      sourceUnitName: feeSourcePath,
      sourceSha256: `sha256:${crypto.createHash("sha256").update(feeSourceBytes).digest("hex")}`,
      contractName: "ProgrammableFeeHook",
      deploymentMode: "create2",
      saltStrategy: "compiler-deterministic-v1",
      deploymentValueWei: "0",
      constructor: { abiEncodedArguments: "0x", addressLocators: [] },
      initializer: null,
      initializerValueWei: "0",
      libraries: [],
      declaredHookPermissions: null
    }],
    edges: [],
    externalOnchainDependencies: [],
    internalChildDeployments: [],
    releaseModules: [],
    declaredIdentities: [],
    extensions: {}
  };
}

function implementedProgrammableFee({ feeSourcePath, feeTestPath }) {
  return {
    policyId: "programmable-volume-fee-v1",
    policyVersion: "1.1.0",
    poolScope: "canonical-launch-pool-key",
    rates: {
      unit: "hundredths-of-bip",
      selectedHundredthsOfBip: 30000,
      minimumEffectiveHundredthsOfBip: 1000,
      effectiveHundredthsOfBip: 30000,
      platformHundredthsOfBip: 1000,
      projectHundredthsOfBip: 29000,
      formula: "effective=max(selected,1000);platform=1000;project=effective-1000",
      lpFeeExcluded: true
    },
    basis: {
      volume: "gross-quote-side-swap-volume",
      quoteAsset: "canonical-pool-quote-asset"
    },
    ownership: {
      owner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      immutable: true,
      claimAuthority: "owner-only",
      claimAvailability: "anytime",
      claimDestinationPolicy: "owner-or-owner-selected-per-claim",
      storedMutableRecipient: false,
      builderCanMutate: false,
      projectCanMutate: false,
      administratorCanMutate: false
    },
    collection: {
      status: "implemented",
      integration: "canonical-pool-hook",
      enforcement: "non-bypassable",
      hookFeeMechanismBinding: "hook.feeMechanism",
      supportedSwapModes: [
        "zeroForOne-exactInput",
        "zeroForOne-exactOutput",
        "oneForZero-exactInput",
        "oneForZero-exactOutput"
      ],
      swapModePaths: {
        zeroForOneExactInput: "after-swap-return-delta",
        zeroForOneExactOutput: "after-swap-return-delta",
        oneForZeroExactInput: "after-swap-return-delta",
        oneForZeroExactOutput: "after-swap-return-delta"
      },
      selfCallPolicy: "same-pool-swap-forbidden"
    },
    accounting: {
      accrualMode: "claimable-liability",
      liabilityKeyDimensions: ["poolId", "currency", "owner"],
      crossPoolNetting: false,
      roundingPolicy: "cumulative-independent-platform-project-remainders",
      remainderScope: "canonical-pool-lifetime",
      claimResetsRemainders: false,
      minimumGrossQuoteUnits: 1000,
      fragmentationResistant: true,
      valueFlowId: "programmable-volume-fee",
      collectionEvent: "ProgrammableFeeAccrued(bytes32,address,uint256)",
      claimEvent: "ProgrammableFeeClaimed(address,address,uint256)"
    },
    evidence: {
      sourcePaths: [feeSourcePath],
      testPaths: [feeTestPath]
    }
  };
}

function manualBuilderTemplate() {
  return {
    schemaVersion: "1.0.0",
    source: "manual",
    templateSelection: null
  };
}

function catalogBuilderTemplate() {
  return builderTemplateFromPlan(composeTemplate({
    catalog: templateCatalog,
    starterId: "blank-custom",
    customCapabilities: [{ id: "gravity-arena", label: "Gravity Arena" }],
    localTags: ["browser-fps"]
  }));
}

function validateCentral(central) {
  const packageFiles = new Map(
    central.files.map(({ path, content }) => [path, Buffer.from(content, "utf8")])
  );
  assert.deepEqual([...packageFiles.keys()], [
    "application.json",
    "launch.json",
    "PROPOSAL.md",
    "TEST_PLAN.md",
    "THREAT_MODEL.md",
    "compatibility-report.json",
    "evidence-index.json"
  ]);
  const application = JSON.parse(packageFiles.get("application.json"));
  const launch = JSON.parse(packageFiles.get("launch.json"));
  validateAutonomousApplicationManifest(application, { requireImmutableSourceHints: true });
  validateAutonomousLaunchSpecification(launch);
  assert.equal(packageFiles.get("application.json").toString("utf8"), canonicalJson(application));
  assert.equal(packageFiles.get("launch.json").toString("utf8"), canonicalJson(launch));
  return {
    application,
    launch,
    compatibility: JSON.parse(packageFiles.get("compatibility-report.json")),
    evidenceIndex: JSON.parse(packageFiles.get("evidence-index.json"))
  };
}

function markdown(title) {
  return Buffer.from(`# ${title}\nThis exact-revision fixture contains a substantive bounded review body for validation.\n`);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}
