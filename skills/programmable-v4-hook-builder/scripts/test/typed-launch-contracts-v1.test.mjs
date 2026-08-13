import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAgainstSchema } from "../submission-core.mjs";
import {
  CHAINLINK_INTEGRATION_IDS_V1,
  CHAINLINK_KNOWLEDGE_RECEIPT_SHA256_V1,
  collectChainlinkProviderArtifactBindingsV1,
  validateChainlinkProviderProfileV1
} from "../chainlink-provider-profile-core.mjs";
import {
  APPLICANT_GATE_IDS_V1,
  PERMIT2_LAUNCH_WITNESS_TYPE_STRING_V1,
  PLATFORM_GATE_IDS_V1,
  SWAP_MODE_IDS_V1,
  validateDelegatedPayerSponsorIntentV1,
  validateLaunchAdmissionDecisionV1,
  validatePermit2LaunchWitnessV1,
  validateRwaEvidenceProfileV1,
  validateScientificDataEvidenceProfileV1,
  validateSwapModeClassificationV1,
  validateTestEvidenceOutcomeV1
} from "../typed-launch-contracts-v1-core.mjs";
import { composeTemplate, loadTemplateCatalog } from "../template-catalog-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "../..");
const referenceRoot = path.join(skillRoot, "references");

const H = (character = "1") => `sha256:${character.repeat(64)}`;
const B = (character = "1") => `0x${character.repeat(64)}`;
const A = (character = "1") => `0x${character.repeat(40)}`;
const G = (character = "1") => character.repeat(40);

const schemaByName = Object.fromEntries([
  "chainlink-provider-profile-v1.schema.json",
  "swap-mode-classification-v1.schema.json",
  "delegated-payer-sponsor-intent-v1.schema.json",
  "permit2-launch-witness-v1.schema.json",
  "test-evidence-outcome-v1.schema.json",
  "scientific-data-evidence-profile-v1.schema.json",
  "rwa-evidence-profile-v1.schema.json",
  "launch-admission-decision-v1.schema.json"
].map((name) => [name, JSON.parse(fs.readFileSync(path.join(referenceRoot, name), "utf8"))]));

function assertValid(name, value, validator) {
  assert.deepEqual(validateAgainstSchema(value, schemaByName[name]), [], `schema ${name}`);
  assert.deepEqual(validator(value), [], `semantic ${name}`);
}

function swapFixture() {
  return {
    schemaVersion: "1.0.0",
    subject: {
      applicationId: "exact-input-game",
      revisionObjectId: G("1"),
      treeObjectId: G("2"),
      chainId: "1",
      marketRef: "main-market",
      poolKeySha256: H("3")
    },
    modes: SWAP_MODE_IDS_V1.map((id) => {
      const supported = id.endsWith("exact-input");
      return {
        id,
        direction: id.startsWith("zero-for-one") ? "zero-for-one" : "one-for-zero",
        exactness: id.endsWith("exact-input") ? "exact-input" : "exact-output",
        disposition: supported ? "supported" : "rejected",
        supportedProof: supported ? {
          positiveNetOutput: true,
          finalUserLimits: true,
          deltaConservation: true,
          feeConformance: true,
          partialFillBehavior: "bounded-partial-fill",
          evidenceRefs: [`quadrant-${id}`]
        } : null,
        rejectionProof: supported ? null : {
          rejectionStage: "input-validation",
          beforeValueMovement: true,
          beforeStateMutation: true,
          beforeLiabilityCreation: true,
          beforeQuoteOrOffer: true,
          coveredSurfaces: ["direct", "router", "quoter", "ui", "api"],
          evidenceRefs: [`rejection-${id}`]
        }
      };
    })
  };
}

function payerFixture(role = "delegated-payer") {
  return {
    schemaVersion: "1.0.0",
    intentId: B("1"),
    fundingRole: role,
    payer: A("1"),
    authorizedCaller: A("2"),
    beneficiary: A("3"),
    refundRecipient: A("1"),
    chainId: "1",
    verifyingContract: A("4"),
    spender: A("4"),
    action: "launch",
    token: A("5"),
    amountMode: "maximum",
    amount: "1000000",
    launchConfigurationSha256: H("1"),
    poolKeySha256: H("2"),
    hook: A("6"),
    router: A("7"),
    nonce: "9",
    validAfter: "1700000000",
    deadline: "1700003600",
    residualAllowanceDisposition: "decrement-only",
    sponsorPolicySha256: role === "sponsor" ? H("3") : null,
    authorization: {
      scheme: "eip712-eoa",
      signer: A("1"),
      domainSeparator: B("2"),
      structHash: B("3"),
      digest: B("4"),
      signature: "0x1234"
    }
  };
}

function permitFixture() {
  return {
    schemaVersion: "1.0.0",
    permit2Domain: {
      name: "Permit2",
      chainId: "1",
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      domainSeparator: B("1")
    },
    permit: {
      mode: "permit-witness-transfer-from",
      owner: A("1"),
      permittedToken: A("2"),
      permittedAmount: "1000000",
      requestedAmount: "900000",
      spender: A("3"),
      nonce: "44",
      signatureDeadline: "1700003600"
    },
    launchWitness: {
      witnessTypeString: PERMIT2_LAUNCH_WITNESS_TYPE_STRING_V1,
      witnessTypeHash: B("2"),
      witnessHash: B("3"),
      applicationId: "permit2-launch",
      revisionObjectId: G("4"),
      action: "launch",
      launchConfigurationSha256: H("4"),
      poolKeySha256: H("5"),
      hook: A("4"),
      router: A("5"),
      beneficiary: A("6"),
      recipient: A("6"),
      refundRecipient: A("1"),
      transactionTarget: A("3"),
      transactionSelector: "0x12345678",
      transactionDataSha256: H("6"),
      nativeValue: "0",
      payerIntentSha256: H("7")
    },
    replayProtection: {
      chainBound: true,
      permit2Bound: true,
      ownerBound: true,
      spenderBound: true,
      nonceBound: true,
      deadlineBound: true,
      witnessBound: true,
      singleUseNonce: true,
      crossChainReplayRejected: true,
      crossContractReplayRejected: true,
      crossLaunchReplayRejected: true,
      digest: B("4")
    },
    signature: { scheme: "eip712-eoa", signer: A("1"), bytes: "0x1234" }
  };
}

function evidenceFixture(status = "passed") {
  const variants = {
    passed: { exitCode: 0, counts: { passed: 12, failed: 0, skipped: 1 }, reasonCode: null, reason: null },
    failed: { exitCode: 1, counts: { passed: 11, failed: 1, skipped: 1 }, reasonCode: "invariant-failed", reason: "A stateful conservation invariant failed." },
    "tooling-blocked": { exitCode: null, counts: null, reasonCode: "tool-not-installed", reason: "The pinned analyzer is not installed in this environment." },
    "no-data": { exitCode: 0, counts: { passed: 0, failed: 0, skipped: 0 }, reasonCode: "empty-report", reason: "The run completed but returned no usable records." },
    inconclusive: { exitCode: 0, counts: { passed: 3, failed: 0, skipped: 2 }, reasonCode: "scope-incomplete", reason: "The available output does not cover the complete property." },
    "not-applicable-with-reason": { exitCode: null, counts: null, reasonCode: "surface-unreachable", reason: "Reachability proof shows that the capability does not exist." }
  };
  return {
    schemaVersion: "1.0.0",
    subjectSha256: H("1"),
    methodId: "foundry-invariants",
    methodKind: "invariant",
    authorship: {
      codeAuthor: "Applicant",
      testAuthor: "Applicant",
      assertionAuthor: "Applicant",
      runner: "Programmable review worker",
      interpreter: "Programmable review worker",
      independence: "independent-reproduction"
    },
    invocation: {
      tool: "forge",
      toolVersion: "1.3.0",
      command: ["forge", "test", "--match-contract", "LaunchInvariant"],
      rulesetSha256: H("2"),
      startedAt: "2026-08-06T10:00:00Z",
      completedAt: "2026-08-06T10:01:00Z"
    },
    outcome: { status, ...variants[status], propertyRefs: ["delta-conservation"] },
    artifacts: [{ path: "evidence/invariant.json", mediaType: "application/json", byteLength: 42, sha256: H("3") }]
  };
}

function authority(name) {
  return {
    operator: name,
    authorityRef: `${name.toLowerCase().replaceAll(" ", "-")}-authority`,
    scope: `Exact ${name} authority scope.`,
    continuity: `Documented ${name} succession and outage process.`,
    conflicts: `Disclosed ${name} conflicts and controls.`
  };
}

function scientificFixture(role = "value-influencing") {
  return {
    schemaVersion: "1.0.0",
    profileId: "signed-lab-score",
    subjectSha256: H("1"),
    dataRole: role,
    source: {
      producer: "Public research laboratory",
      operator: "Signed data service",
      schemaId: "urn:example:lab-score:1",
      schemaSha256: H("2"),
      transport: "signed-api",
      authentication: "eip712",
      signature: { required: true, scheme: "eip712", signerIdentity: A("1") },
      provenanceChainSha256: H("3")
    },
    measurement: {
      quantity: "Replicated experimental score",
      unit: "dimensionless score",
      method: "Pre-registered bounded aggregation",
      methodRevision: "method-v3",
      calibration: "Monthly reference-sample calibration",
      sampling: "Every completed experiment with exclusion reasons retained",
      uncertaintyModel: "Published confidence interval and sample count",
      correctionPolicy: "Corrections supersede but never erase prior signed observations"
    },
    quality: {
      validationRulesSha256: H("4"),
      outlierPolicy: "Outliers remain attributable and follow the pre-registered rule.",
      missingDataPolicy: "Missing inputs stop value effects.",
      disputeAuthority: "Independent laboratory review board",
      reproductionRefs: ["evidence/lab-reproduction.json"]
    },
    freshness: {
      observedAtRequired: true,
      maximumAge: "PT1H",
      updateCadence: "PT10M",
      staleBehavior: role === "value-influencing" ? "reject" : "display-stale-with-warning",
      clockSource: "Ethereum finalized block timestamp"
    },
    valueInfluence: role === "value-influencing" ? {
      effect: "payout",
      formulaSha256: H("5"),
      inputBounds: "Score from 0 through 100 with sample count above the declared floor.",
      outputBounds: "Payout multiplier from 0 through 2 inclusive.",
      staleInputEffect: "reject",
      fallback: "No payout state change until a fresh valid observation exists.",
      manipulationTests: ["test/lab-score-manipulation.t.sol"],
      authorityRefs: ["signed-data-service", "lab-review-board"]
    } : null,
    failurePolicy: {
      unavailable: "Stop new value effects and preserve existing claims.",
      invalidSignature: "Reject the observation.",
      schemaMismatch: "Reject the observation.",
      conflictingSources: "Enter the disclosed dispute state without selecting a value.",
      recovery: "Accept only a fresh signed superseding observation under the same schema."
    },
    evidenceRefs: ["evidence/scientific-profile.json"]
  };
}

function rwaFixture() {
  return {
    schemaVersion: "1.0.0",
    profileId: "permissioned-treasury-share",
    subjectSha256: H("1"),
    assetIdentity: {
      instrument: "Permissioned beneficial interest in a segregated treasury portfolio",
      issuer: authority("Issuer"),
      custodian: authority("Custodian"),
      legalOwner: "Segregated special-purpose vehicle",
      beneficialEntitlement: "Pro-rata net asset entitlement subject to the disclosed terms",
      jurisdiction: "Switzerland",
      identifier: "CH-PROGRAMMABLE-TEST-1",
      termsSha256: H("2")
    },
    nav: {
      source: authority("NAV administrator"),
      schemaSha256: H("3"),
      currency: "USD",
      valuationMethod: "Close-of-business independently reconciled fair value.",
      asOfRequired: true,
      publicationCadence: "P1D",
      maximumAge: "P2D",
      staleBehavior: "reject-new-risk",
      correctionPolicy: "Signed corrections supersede and retain prior published NAV records.",
      independentCheckRefs: ["evidence/nav-reconciliation.json"]
    },
    reserve: {
      backingModel: "fully-reserved",
      assetScope: "Cash and eligible treasury securities in the segregated custody account.",
      liabilityScope: "All outstanding tokenized beneficial interests and pending redemptions.",
      segregation: "Legally and operationally segregated custody account.",
      reconciliation: "Daily asset, liability, token-supply, and pending-redemption reconciliation.",
      attestation: "Monthly independent reserve report plus signed daily operator record.",
      shortfallPolicy: "Suspend new exposure, preserve claims, disclose shortfall, and apply loss priority.",
      withdrawalAuthority: authority("Reserve controller"),
      evidenceRefs: ["evidence/reserve-attestation.json"]
    },
    calendar: {
      timezone: "Europe/Zurich",
      calendarSource: "calendar/six-swiss-exchange-2026.json",
      tradingWindows: "Published weekday processing window.",
      holidays: "SIX holiday calendar and issuer closure notices.",
      valuationCutoff: "17:00 Europe/Zurich.",
      subscriptionCutoff: "14:00 Europe/Zurich.",
      redemptionCutoff: "14:00 Europe/Zurich.",
      settlementConvention: "T+2 business days.",
      changeNotice: "Signed calendar revisions published before the affected cutoff."
    },
    corporateActions: {
      supportedActions: ["interest", "maturity", "default", "other"],
      source: authority("Corporate action administrator"),
      entitlementRule: "Snapshot the beneficial entitlement at the signed record date.",
      recordDateRule: "Signed source date and finalized chain snapshot.",
      paymentDateRule: "Payment after custodian receipt and reconciliation.",
      fractionalTreatment: "Retain fractional entitlement in exact fixed-point units.",
      withholdingTreatment: "Apply disclosed holder-specific withholding outside protocol price math.",
      mutationPolicy: "Corrections supersede with a complete audit trail.",
      reconciliationRefs: ["evidence/corporate-action-reconciliation.json"]
    },
    redemption: {
      mode: "managed",
      authority: authority("Redemption administrator"),
      eligibility: "Verified eligible beneficial holder under the published terms.",
      beneficiaryBinding: "Request, burned amount, bank beneficiary, and holder identity bind together.",
      pricing: "Next valid published NAV after the applicable cutoff.",
      fees: "Published fixed processing fee and no undisclosed spread.",
      minimumAmount: "1",
      maximumAmount: "1000000000000",
      window: "Business-day submission window from the signed calendar.",
      queue: "FIFO per valid cutoff with liabilities reserved on acceptance.",
      denialStates: "Ineligible, frozen by lawful order, malformed, or reserve shortfall states.",
      outage: "No claim erasure; queue and reserved liability persist.",
      recourse: "Published administrator appeal and external legal claim process.",
      maximumCompletionTime: "P10D",
      evidenceRefs: ["evidence/redemption-rehearsal.json"]
    },
    insolvency: {
      events: ["issuer-default", "custodian-default", "reserve-shortfall", "legal-freeze"],
      lossAllocation: "Losses apply pro rata after protected senior expenses under the terms.",
      priority: "Custody asset claims, reserved redemptions, then residual token interests.",
      poolIsolation: "Each instrument and custody account reconciles without cross-pool netting.",
      freezeEffect: "Stop new risk while preserving the exact holder entitlement record.",
      issuerDefault: "Independent administrator invokes the disclosed wind-down process.",
      custodianDefault: "Assert segregated beneficial claims through the successor process.",
      reserveShortfall: "Publish shortfall and apply the contractual loss allocation.",
      recoveryAuthority: authority("Insolvency administrator"),
      holderRecourse: "Contractual, administrator, and court claim paths remain documented.",
      publicDisclosure: "No promise of unconditional liquidity, redemption, or principal guarantee.",
      evidenceRefs: ["evidence/insolvency-scenarios.json"]
    },
    evidenceRefs: ["evidence/rwa-profile.json"]
  };
}

function gate(id, result = "passed") {
  const p9 = id === "P9";
  return {
    id,
    assessment: {
      result,
      decisionMethod: p9 ? "human-product-legal" : "deterministic-reproduction",
      reason: `${id} exact property assessment.`,
      evidenceRefs: [ `evidence/${id.toLowerCase()}.json` ],
      findingRefs: [],
      resolutionOwner: "none"
    }
  };
}

function decisionFixture() {
  return {
    schemaVersion: "1.0.0",
    recordId: B("1"),
    recordClass: "agent-prepared-policy-assessment",
    reviewIntent: "launch-admission",
    subject: {
      applicationId: "reviewed-launch",
      centralPullRequest: 42,
      centralHeadObjectId: G("1"),
      primary: { repositoryId: "123", uri: "https://github.com/example/project", revisionObjectId: G("2"), treeObjectId: G("3") },
      companions: [],
      sourceBundleSha256: H("1"),
      submissionSha256: H("2"),
      reviewTargetSha256: H("3"),
      launchPlanPath: "launch/plan.json",
      launchPlanSha256: H("4"),
      chainId: "1",
      launchConfigurationSha256: H("5")
    },
    policy: {
      skillRevisionObjectId: G("4"),
      criteriaSha256: H("6"),
      feePolicySha256: H("7"),
      packageContractSha256: H("8"),
      validatorRevisionObjectId: G("5"),
      toolPolicySha256: H("9")
    },
    applicantGates: APPLICANT_GATE_IDS_V1.map((id) => gate(id)),
    platformGates: PLATFORM_GATE_IDS_V1.map((id) => gate(id)),
    findings: [],
    reviewTooling: { status: "available", reason: "The exact review toolchain completed.", evidenceRefs: ["evidence/toolchain.json"] },
    verdict: "READY FOR FINAL VERIFICATION",
    authority: { basis: "agent-prepared", authorityEffect: "none", githubProjectionAuthoritative: false, signedAuthority: null },
    revalidatedAt: "2026-08-06T10:02:00Z"
  };
}

const chainlinkArtifact = (name, kind = "test", character = "1") => ({ path: `evidence/chainlink/${name}.json`, sha256: H(character), kind });

function chainlinkDeployment(id, chainId, roles) {
  return {
    chainId,
    dependencyLock: chainlinkArtifact(`${id}-${chainId}-dependencies`, "dependency-lock", "2"),
    contractRoles: [...roles].sort().map((role, index) => ({
      role,
      address: A(String((index % 8) + 1)),
      runtimeCodeKeccak256: B(String((index % 8) + 1)),
      deploymentEvidence: chainlinkArtifact(`${id}-${chainId}-${role}-deployment`, "deployment", "3")
    }))
  };
}

function chainlinkFixture() {
  const artifact = chainlinkArtifact;
  const deployment = chainlinkDeployment;
  const integrations = [
    {
      id: "ccip",
      status: "planned",
      genericCapabilities: ["cross-chain-messaging"],
      executionOperations: ["async-callback-outside-hook"],
      deployments: [],
      properties: {
        direction: "source-to-destination",
        sourceChainId: "1",
        sourceChainSelector: "5009297550715157269",
        destinationChainId: "10",
        destinationChainSelector: "3734403246176062136",
        sender: A("1"),
        receiver: A("2"),
        payloadSchemaSha256: H("3"),
        applicationDomain: B("4"),
        maximumPayloadBytes: "16384",
        maximumPendingMessages: "256",
        finalityPolicySha256: H("4"),
        rateLimitPolicySha256: H("5"),
        feeFundingPolicySha256: H("6"),
        recoveryBeneficiary: A("3"),
        replayRejected: true,
        reorderingHandled: true,
        ownerRedirectAllowed: false
      },
      evidence: [
        artifact("ccip-design"),
        artifact("ccip-fee-funding-policy", "config", "6"),
        artifact("ccip-finality-policy", "config", "4"),
        artifact("ccip-payload-schema", "schema", "3"),
        artifact("ccip-rate-limit-policy", "config", "5")
      ]
    },
    {
      id: "cre",
      status: "planned",
      genericCapabilities: ["keeper-automation"],
      executionOperations: ["offchain-deterministic-runtime"],
      deployments: [],
      properties: {
        language: "typescript",
        typescriptRuntime: "quickjs-wasm",
        sdkVersion: "1.2.3",
        compilerVersion: "1.2.3",
        workflowId: "bounded-market-observer",
        workflowArtifactSha256: H("1"),
        configSha256: H("2"),
        targetId: "staging",
        donId: "reviewed-don",
        triggerType: "cron",
        randomnessSource: "not-used",
        runtimeTimeOnly: true,
        floatingPointEconomicArithmeticForbidden: true,
        networkWorkBounded: true,
        reportVerificationBound: true,
        retryIdempotent: true,
        localSimulationProof: "single-node-only"
      },
      evidence: [
        artifact("cre-config", "config", "2"),
        artifact("cre-design"),
        artifact("cre-workflow", "source", "1")
      ]
    },
    {
      id: "data-feeds",
      status: "planned",
      genericCapabilities: ["oracle-data"],
      executionOperations: ["bounded-sync-read-in-hook"],
      deployments: [],
      properties: {
        chainId: "1",
        pair: "ETH / USD",
        quoteUnit: "USD with 8 decimals",
        inversion: "direct",
        decimals: 8,
        maximumAgeSeconds: "3600",
        minimumAnswer: "1",
        maximumAnswer: "100000000000000",
        roundCompleteness: "updated-at-nonzero",
        sequencerPolicy: "not-applicable-with-chain-proof",
        sequencerGracePeriodSeconds: null,
        futureTimestampRejected: true,
        nonPositiveRejected: true,
        silentFallbackAllowed: false
      },
      evidence: [artifact("data-feeds-design")]
    },
    {
      id: "data-streams",
      status: "planned",
      genericCapabilities: ["oracle-data"],
      executionOperations: ["report-verification-outside-hook"],
      deployments: [],
      properties: {
        chainId: "1",
        feedId: B("1"),
        reportSchemaSha256: H("2"),
        reportSchemaVersion: "v3",
        maximumObservationAgeSeconds: "30",
        maximumFutureSeconds: "2",
        maximumReportBytes: "16384",
        maximumVerificationGas: "500000",
        validFromEnforced: true,
        expiresAtEnforced: true,
        marketStatusPolicy: "bound-and-reject-unsupported",
        ripcordPolicy: "bound-and-fail-closed",
        billingRoute: "backend-billing",
        credentials: "backend-only"
      },
      evidence: [artifact("data-streams-design"), artifact("data-streams-report-schema", "schema", "2")]
    },
    {
      id: "vrf-v2-5",
      status: "planned",
      genericCapabilities: ["randomness"],
      executionOperations: ["async-callback-outside-hook"],
      deployments: [],
      properties: {
        chainId: "1",
        paymentMode: "subscription",
        coordinatorKeyHash: B("1"),
        subscriptionId: "42",
        minimumRequestConfirmations: "3",
        callbackGasLimit: "500000",
        numWords: "2",
        coordinatorMaximumNumWords: "500",
        fundingAsset: A("4"),
        requestIdentityBound: true,
        frozenInputBound: true,
        replacementRerollAllowed: false,
        callbackCanRevert: false,
        callbackWorkPolicy: "minimal-store-only",
        duplicateFulfillmentPolicy: "idempotent-ignore",
        unknownRequestPolicy: "record-and-return",
        timeoutPolicy: "cancel-or-refund-without-reroll",
        outOfOrderFulfillmentTested: true,
        storageBounded: true
      },
      evidence: [artifact("vrf-design")]
    }
  ];
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-chainlink-provider-profile",
    profileId: "chainlink-multi-product",
    subject: artifact("subject", "source"),
    projectPlan: artifact("programmable-template", "config"),
    runtimeCoverage: { executionFamily: "evm", scope: "EVM_ONLY" },
    targetChainIds: ["1", "10"],
    sourceReceipt: {
      path: "references/provider-knowledge-source-receipt-2026-08-13.json",
      sha256: CHAINLINK_KNOWLEDGE_RECEIPT_SHA256_V1
    },
    authorityBoundary: {
      executionAuthorityEffect: "NONE",
      validationNetworkAccess: "forbidden",
      secrets: "backend-only",
      automaticDeployment: false,
      automaticApproval: false
    },
    sourceCoverage: {
      automation: "not-covered-by-reviewed-source",
      functions: "not-covered-by-reviewed-source",
      confidentialAi: "excluded-alpha",
      ace: "excluded-separate-legal-license-security-review",
      nonEvm: "out-of-scope"
    },
    productionInvariants: {
      liveness: {
        callerBound: true,
        authorizationBound: true,
        gasPayerBound: true,
        fundingAndIncentiveBound: true,
        deadlineBound: true,
        workBounded: true,
        retryIdempotent: true,
        stuckExitBound: true
      },
      accountExecution: {
        supportedModels: ["eip7702", "eoa", "erc1271", "erc4337", "relayer-session-key"],
        nonceBound: true,
        deadlineBound: true,
        domainBound: true,
        replayRejected: true,
        codeLengthAssumptionsForbidden: true,
        mutableSignatureValidityHandled: true,
        persistentDelegationHandled: true
      },
      indexerRpc: {
        runtimeHashBound: true,
        abiAndTopicBound: true,
        startBlockHashBound: true,
        blockTagBound: true,
        boundedLogChunks: true,
        removedLogsHandled: true,
        deterministicReplay: true,
        providerDisagreementFailsClosed: true,
        freshnessBound: true
      },
      chainCapability: {
        inclusionFinalityWithdrawalSeparated: true,
        feeAndTimeSemanticsBound: true,
        sequencerPolicy: "not-applicable-with-chain-proof",
        opcodePrecompileCompilerBound: true,
        bridgeReplayDomainBound: true,
        deterministicAddressAssumptionsForbidden: true
      },
      futureProtocol: {
        forkInclusionRequired: true,
        executionSpecCommitRequired: true,
        targetRuntimeProofRequired: true,
        fallbackOrMigrationBound: true
      }
    },
    integrations,
    evidence: [artifact("profile-review", "review")]
  };
}

test("closed swap-mode contract permits a deliberately exact-input-only design and rejects bypass ambiguity", () => {
  const fixture = swapFixture();
  assertValid("swap-mode-classification-v1.schema.json", fixture, validateSwapModeClassificationV1);

  const moved = structuredClone(fixture);
  moved.modes[1].rejectionProof.beforeValueMovement = false;
  assert.match(validateSwapModeClassificationV1(moved).join("\n"), /beforeValueMovement/);

  const duplicate = structuredClone(fixture);
  duplicate.modes[3] = structuredClone(duplicate.modes[2]);
  assert.match(validateSwapModeClassificationV1(duplicate).join("\n"), /repeat|missing/);
});

test("delegated payer and sponsor intent requires payer-originated exact typed authority", () => {
  assertValid("delegated-payer-sponsor-intent-v1.schema.json", payerFixture(), validateDelegatedPayerSponsorIntentV1);
  assertValid("delegated-payer-sponsor-intent-v1.schema.json", payerFixture("sponsor"), validateDelegatedPayerSponsorIntentV1);

  const victim = payerFixture();
  victim.authorization.signer = A("9");
  assert.match(validateDelegatedPayerSponsorIntentV1(victim).join("\n"), /exact payer or sponsor/);

  const stale = payerFixture();
  stale.deadline = stale.validAfter;
  assert.match(validateDelegatedPayerSponsorIntentV1(stale).join("\n"), /later than validAfter/);
});

test("Permit2 witness binds the complete launch and rejects replay-domain weakening", () => {
  const fixture = permitFixture();
  assertValid("permit2-launch-witness-v1.schema.json", fixture, validatePermit2LaunchWitnessV1);

  const oversized = structuredClone(fixture);
  oversized.permit.requestedAmount = "1000001";
  assert.match(validatePermit2LaunchWitnessV1(oversized).join("\n"), /cannot exceed/);

  const incompleteType = structuredClone(fixture);
  incompleteType.launchWitness.witnessTypeString = "LaunchWitness witness)LaunchWitness(address beneficiary)TokenPermissions(address token,uint256 amount)";
  assert.match(validatePermit2LaunchWitnessV1(incompleteType).join("\n"), /witnessTypeString/);

  for (const field of ["chainBound", "permit2Bound", "ownerBound", "spenderBound", "nonceBound", "deadlineBound", "witnessBound", "singleUseNonce", "crossChainReplayRejected", "crossContractReplayRejected", "crossLaunchReplayRejected"]) {
    const weakened = structuredClone(fixture);
    weakened.replayProtection[field] = false;
    assert.match(validatePermit2LaunchWitnessV1(weakened).join("\n"), new RegExp(field));
  }
});

test("test evidence preserves every non-boolean outcome without treating outage or no data as passed", () => {
  for (const status of ["passed", "failed", "tooling-blocked", "no-data", "inconclusive", "not-applicable-with-reason"]) {
    assertValid("test-evidence-outcome-v1.schema.json", evidenceFixture(status), validateTestEvidenceOutcomeV1);
  }
  const fakePass = evidenceFixture("tooling-blocked");
  fakePass.outcome.status = "passed";
  assert.match(validateTestEvidenceOutcomeV1(fakePass).join("\n"), /passed requires|exitCode/);
});

test("scientific evidence separates display-only data from bounded value-influencing data", () => {
  assertValid("scientific-data-evidence-profile-v1.schema.json", scientificFixture(), validateScientificDataEvidenceProfileV1);
  assertValid("scientific-data-evidence-profile-v1.schema.json", scientificFixture("display-only"), validateScientificDataEvidenceProfileV1);

  const staleValue = scientificFixture();
  staleValue.freshness.staleBehavior = "display-stale-with-warning";
  assert.match(validateScientificDataEvidenceProfileV1(staleValue).join("\n"), /stale data/);

  const hiddenEffect = scientificFixture("display-only");
  hiddenEffect.valueInfluence = scientificFixture().valueInfluence;
  assert.match(validateScientificDataEvidenceProfileV1(hiddenEffect).join("\n"), /must be null/);
});

test("RWA evidence closes NAV reserve calendar corporate-action redemption and insolvency boundaries", () => {
  const fixture = rwaFixture();
  assertValid("rwa-evidence-profile-v1.schema.json", fixture, validateRwaEvidenceProfileV1);

  const noExitBound = structuredClone(fixture);
  noExitBound.redemption.maximumCompletionTime = null;
  assert.match(validateRwaEvidenceProfileV1(noExitBound).join("\n"), /maximumCompletionTime/);

  const reversedLimits = structuredClone(fixture);
  reversedLimits.redemption.minimumAmount = "100";
  reversedLimits.redemption.maximumAmount = "99";
  assert.match(validateRwaEvidenceProfileV1(reversedLimits).join("\n"), /cannot be lower/);
});

test("Chainlink profile composes provider-specific evidence with production liveness and runtime boundaries", () => {
  const fixture = chainlinkFixture();
  assertValid("chainlink-provider-profile-v1.schema.json", fixture, validateChainlinkProviderProfileV1);
  assert.deepEqual(fixture.integrations.map(({ id }) => id), CHAINLINK_INTEGRATION_IDS_V1);
  assert.equal(fixture.integrations.every(({ status, deployments }) => status !== "planned" || deployments.length === 0), true);

  const reroll = structuredClone(fixture);
  reroll.integrations.find(({ id }) => id === "vrf-v2-5").properties.replacementRerollAllowed = true;
  assert.match(validateChainlinkProviderProfileV1(reroll).join("\n"), /replacementRerollAllowed/);

  const callback = structuredClone(fixture);
  callback.integrations.find(({ id }) => id === "vrf-v2-5").properties.callbackCanRevert = true;
  assert.match(validateChainlinkProviderProfileV1(callback).join("\n"), /callbackCanRevert/);

  const fallback = structuredClone(fixture);
  fallback.integrations.find(({ id }) => id === "data-feeds").properties.silentFallbackAllowed = true;
  assert.match(validateChainlinkProviderProfileV1(fallback).join("\n"), /silentFallbackAllowed/);

  const poolCallback = structuredClone(fixture);
  poolCallback.integrations.find(({ id }) => id === "ccip").executionOperations = ["bounded-sync-read-in-hook"];
  assert.match(validateChainlinkProviderProfileV1(poolCallback).join("\n"), /executionOperations/);

  const fakeCoverage = structuredClone(fixture);
  fakeCoverage.sourceCoverage.automation = "covered";
  assert.match(validateChainlinkProviderProfileV1(fakeCoverage).join("\n"), /sourceCoverage\.automation/);

  const wrongComposition = structuredClone(fixture);
  wrongComposition.integrations.find(({ id }) => id === "vrf-v2-5").genericCapabilities = ["oracle-data"];
  assert.match(validateChainlinkProviderProfileV1(wrongComposition).join("\n"), /genericCapabilities/);

  const productOutsideRootChains = structuredClone(fixture);
  productOutsideRootChains.integrations.find(({ id }) => id === "vrf-v2-5").properties.chainId = "999";
  assert.match(validateChainlinkProviderProfileV1(productOutsideRootChains).join("\n"), /root targetChainIds/);

  const compressedBidirectionalLane = structuredClone(fixture);
  compressedBidirectionalLane.integrations.find(({ id }) => id === "ccip").properties.direction = "bidirectional";
  assert.match(validateChainlinkProviderProfileV1(compressedBidirectionalLane).join("\n"), /source-to-destination/);

  const oversizedSelector = structuredClone(fixture);
  oversizedSelector.integrations.find(({ id }) => id === "ccip").properties.sourceChainSelector = (1n << 64n).toString();
  assert.match(validateChainlinkProviderProfileV1(oversizedSelector).join("\n"), /18446744073709551615/);

  const duplicateLaneSelector = structuredClone(fixture);
  const duplicateSelectorProperties = duplicateLaneSelector.integrations.find(({ id }) => id === "ccip").properties;
  duplicateSelectorProperties.destinationChainSelector = duplicateSelectorProperties.sourceChainSelector;
  assert.match(validateChainlinkProviderProfileV1(duplicateLaneSelector).join("\n"), /differ from sourceChainSelector/);

  const unclosedClaim = structuredClone(fixture);
  const feed = unclosedClaim.integrations.find(({ id }) => id === "data-feeds");
  feed.status = "deployment-evidence-declared";
  assert.match(validateChainlinkProviderProfileV1(unclosedClaim).join("\n"), /at least two content-addressed artifacts/);

  const noReorg = structuredClone(fixture);
  noReorg.productionInvariants.indexerRpc.removedLogsHandled = false;
  assert.match(validateChainlinkProviderProfileV1(noReorg).join("\n"), /removedLogsHandled/);

  const mutableReceipt = structuredClone(fixture);
  mutableReceipt.sourceReceipt.sha256 = H("9");
  assert.match(validateChainlinkProviderProfileV1(mutableReceipt).join("\n"), /sourceReceipt\.sha256/);

  const go = structuredClone(fixture);
  const cre = go.integrations.find(({ id }) => id === "cre").properties;
  cre.language = "go";
  cre.typescriptRuntime = null;
  cre.randomnessSource = "cre-runtime-rand";
  assertValid("chainlink-provider-profile-v1.schema.json", go, validateChainlinkProviderProfileV1);

  const fakeTsRandom = structuredClone(fixture);
  fakeTsRandom.integrations.find(({ id }) => id === "cre").properties.randomnessSource = "cre-runtime-rand";
  assert.match(validateChainlinkProviderProfileV1(fakeTsRandom).join("\n"), /randomnessSource/);

  const oneLaneCcip = structuredClone(fixture);
  const ccip = oneLaneCcip.integrations.find(({ id }) => id === "ccip");
  ccip.status = "deployment-evidence-declared";
  ccip.deployments = [
    chainlinkDeployment("ccip", "1", ["sender", "source-router"]),
    chainlinkDeployment("ccip", "10", ["destination-router", "receiver"])
  ];
  ccip.evidence.push(chainlinkArtifact("ccip-dependency", "dependency-lock"), chainlinkArtifact("ccip-source", "source"));
  ccip.deployments.pop();
  assert.match(validateChainlinkProviderProfileV1(oneLaneCcip).join("\n"), /destinationChainId|requires deployment/);

  const directWithoutWrapper = structuredClone(fixture);
  const vrf = directWithoutWrapper.integrations.find(({ id }) => id === "vrf-v2-5");
  vrf.status = "deployment-evidence-declared";
  vrf.deployments = [chainlinkDeployment("vrf", "1", ["consumer", "coordinator"])];
  vrf.evidence = [
    chainlinkArtifact("vrf-config", "config"),
    chainlinkArtifact("vrf-dependency", "dependency-lock"),
    chainlinkArtifact("vrf-source", "source"),
    chainlinkArtifact("vrf-test", "test")
  ];
  vrf.properties.paymentMode = "direct-funding";
  vrf.properties.subscriptionId = null;
  assert.match(validateChainlinkProviderProfileV1(directWithoutWrapper).join("\n"), /wrapper deployment role/);

  const declaredVrfDeployment = structuredClone(fixture);
  declaredVrfDeployment.integrations = [declaredVrfDeployment.integrations.find(({ id }) => id === "vrf-v2-5")];
  const declaredVrf = declaredVrfDeployment.integrations[0];
  declaredVrf.status = "deployment-evidence-declared";
  declaredVrf.deployments = [chainlinkDeployment("vrf", "1", ["consumer", "coordinator"])];
  declaredVrf.evidence = [
    chainlinkArtifact("vrf-config", "config"),
    chainlinkArtifact("vrf-dependency", "dependency-lock"),
    chainlinkArtifact("vrf-deployment", "deployment"),
    chainlinkArtifact("vrf-source", "source"),
    chainlinkArtifact("vrf-test", "test")
  ];
  assertValid("chainlink-provider-profile-v1.schema.json", declaredVrfDeployment, validateChainlinkProviderProfileV1);

  const vagueFeed = structuredClone(fixture);
  vagueFeed.integrations.find(({ id }) => id === "data-feeds").properties.maximumAgeSeconds = "0";
  assert.match(validateChainlinkProviderProfileV1(vagueFeed).join("\n"), /maximumAgeSeconds/);

  const unboundedStream = structuredClone(fixture);
  unboundedStream.integrations.find(({ id }) => id === "data-streams").properties.maximumReportBytes = "0";
  assert.match(validateChainlinkProviderProfileV1(unboundedStream).join("\n"), /maximumReportBytes/);

  const expiredStreamAccepted = structuredClone(fixture);
  expiredStreamAccepted.integrations.find(({ id }) => id === "data-streams").properties.expiresAtEnforced = false;
  assert.match(validateChainlinkProviderProfileV1(expiredStreamAccepted).join("\n"), /expiresAtEnforced/);

  const excessiveWords = structuredClone(fixture);
  excessiveWords.integrations.find(({ id }) => id === "vrf-v2-5").properties.numWords = "501";
  assert.match(validateChainlinkProviderProfileV1(excessiveWords).join("\n"), /coordinatorMaximumNumWords/);

  const maximumChain = structuredClone(fixture);
  maximumChain.targetChainIds = [((1n << 256n) - 1n).toString()];
  maximumChain.integrations = [maximumChain.integrations.find(({ id }) => id === "cre")];
  assertValid("chainlink-provider-profile-v1.schema.json", maximumChain, validateChainlinkProviderProfileV1);
  maximumChain.targetChainIds = [(1n << 256n).toString()];
  assert.match(validateChainlinkProviderProfileV1(maximumChain).join("\n"), /uint256 range/);

  const oversizedDeploymentChain = structuredClone(fixture);
  oversizedDeploymentChain.integrations.find(({ id }) => id === "data-feeds").deployments = [
    chainlinkDeployment("data-feeds", (1n << 256n).toString(), ["current-aggregator", "feed-proxy"])
  ];
  assert.match(validateChainlinkProviderProfileV1(oversizedDeploymentChain).join("\n"), /uint256 range/);

  const malformed = structuredClone(fixture);
  malformed.integrations[0].id = { hostile: true };
  assert.doesNotThrow(() => validateChainlinkProviderProfileV1(malformed));
  assert.match(validateChainlinkProviderProfileV1(malformed).join("\n"), /integrations/);
});

test("provider CLI validates the exact profile offline and reports no authority", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-chainlink-profile-"));
  try {
    const profile = path.join(directory, "profile.json");
    const validProfile = chainlinkFixture();
    for (const binding of collectChainlinkProviderArtifactBindingsV1(validProfile)) {
      const target = path.join(directory, binding.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.writeFileSync(target, `artifact:${binding.path}\n`);
      binding.sha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex")}`;
    }
    const evidenceDigest = (integrationId, suffix) => validProfile.integrations
      .find(({ id }) => id === integrationId).evidence
      .find(({ path: artifactPath }) => artifactPath.endsWith(`/${suffix}.json`)).sha256;
    const ccipProperties = validProfile.integrations.find(({ id }) => id === "ccip").properties;
    ccipProperties.payloadSchemaSha256 = evidenceDigest("ccip", "ccip-payload-schema");
    ccipProperties.finalityPolicySha256 = evidenceDigest("ccip", "ccip-finality-policy");
    ccipProperties.rateLimitPolicySha256 = evidenceDigest("ccip", "ccip-rate-limit-policy");
    ccipProperties.feeFundingPolicySha256 = evidenceDigest("ccip", "ccip-fee-funding-policy");
    const creProperties = validProfile.integrations.find(({ id }) => id === "cre").properties;
    creProperties.workflowArtifactSha256 = evidenceDigest("cre", "cre-workflow");
    creProperties.configSha256 = evidenceDigest("cre", "cre-config");
    validProfile.integrations.find(({ id }) => id === "data-streams").properties.reportSchemaSha256 = evidenceDigest("data-streams", "data-streams-report-schema");
    const projectPlanPath = path.join(directory, validProfile.projectPlan.path);
    const projectPlan = composeTemplate({
      catalog: loadTemplateCatalog({ skillRoot }),
      starterId: "blank-custom",
      packIds: ["chainlink-provider"],
      capabilityIds: ["cross-chain-messaging", "keeper-automation", "oracle-data", "randomness"]
    });
    const projectPlanBytes = `${JSON.stringify(projectPlan, null, 2)}\n`;
    fs.writeFileSync(projectPlanPath, projectPlanBytes);
    validProfile.projectPlan.sha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(projectPlanPath)).digest("hex")}`;
    fs.writeFileSync(profile, `${JSON.stringify(validProfile, null, 2)}\n`);
    const script = path.join(skillRoot, "scripts", "chainlink-provider-profile.mjs");
    const result = childProcess.spawnSync(process.execPath, [script, "check", "--root", directory, "--profile", "profile.json"], {
      encoding: "utf8",
      env: { ...process.env, NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:1" },
      shell: false
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "CHAINLINK_PROFILE_STRUCTURALLY_VALID");
    assert.equal(output.artifactBindingsVerified, true);
    assert.equal(output.deploymentOrRuntimeVerified, false);
    assert.equal(output.networkAccessed, false);
    assert.deepEqual(output.externalActionsPerformed, []);
    assert.equal(output.executionAuthorityEffect, "NONE");

    const incompletePlan = composeTemplate({
      catalog: loadTemplateCatalog({ skillRoot }),
      starterId: "blank-custom",
      packIds: ["chainlink-provider"]
    });
    fs.writeFileSync(projectPlanPath, `${JSON.stringify(incompletePlan, null, 2)}\n`);
    const missingComposition = structuredClone(validProfile);
    missingComposition.projectPlan.sha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(projectPlanPath)).digest("hex")}`;
    fs.writeFileSync(profile, `${JSON.stringify(missingComposition, null, 2)}\n`);
    const missingCompositionResult = childProcess.spawnSync(process.execPath, [script, "check", "--root", directory, "--profile", "profile.json"], {
      encoding: "utf8",
      env: { ...process.env, NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:1" },
      shell: false
    });
    assert.equal(missingCompositionResult.status, 1, missingCompositionResult.stderr || missingCompositionResult.stdout);
    assert.match(JSON.parse(missingCompositionResult.stdout).findings.map(({ code }) => code).join("\n"), /CHAINLINK_PROJECT_PLAN_INVALID/);
    fs.writeFileSync(projectPlanPath, projectPlanBytes);
    fs.writeFileSync(profile, `${JSON.stringify(validProfile, null, 2)}\n`);

    const overBudget = structuredClone(validProfile);
    for (const integration of overBudget.integrations) {
      for (let index = 0; index < 30; index += 1) integration.evidence.push(chainlinkArtifact(`zz-${integration.id}-${String(index).padStart(2, "0")}`));
      integration.evidence.sort((left, right) => left.path.localeCompare(right.path));
    }
    fs.writeFileSync(profile, `${JSON.stringify(overBudget, null, 2)}\n`);
    const overBudgetResult = childProcess.spawnSync(process.execPath, [script, "check", "--root", directory, "--profile", "profile.json"], {
      encoding: "utf8",
      env: { ...process.env, NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:1" },
      shell: false
    });
    assert.equal(overBudgetResult.status, 1, overBudgetResult.stderr || overBudgetResult.stdout);
    assert.match(JSON.parse(overBudgetResult.stdout).findings.map(({ code }) => code).join("\n"), /CHAINLINK_ARTIFACT_BUDGET_EXCEEDED/);
    fs.writeFileSync(profile, `${JSON.stringify(validProfile, null, 2)}\n`);

    const weakened = structuredClone(validProfile);
    weakened.authorityBoundary.automaticDeployment = true;
    fs.writeFileSync(profile, `${JSON.stringify(weakened, null, 2)}\n`);
    const rejected = childProcess.spawnSync(process.execPath, [script, "check", "--root", directory, "--profile", "profile.json"], {
      encoding: "utf8",
      env: { ...process.env, NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:1" },
      shell: false
    });
    assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
    assert.equal(JSON.parse(rejected.stdout).status, "CHAINLINK_PROFILE_INVALID");

    const missing = structuredClone(validProfile);
    const missingBinding = collectChainlinkProviderArtifactBindingsV1(missing)[0];
    fs.rmSync(path.join(directory, missingBinding.path));
    fs.writeFileSync(profile, `${JSON.stringify(missing, null, 2)}\n`);
    const missingResult = childProcess.spawnSync(process.execPath, [script, "check", "--root", directory, "--profile", "profile.json"], {
      encoding: "utf8",
      env: { ...process.env, NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:1" },
      shell: false
    });
    assert.equal(missingResult.status, 1, missingResult.stderr || missingResult.stdout);
    assert.match(JSON.parse(missingResult.stdout).findings.map(({ code }) => code).join("\n"), /CHAINLINK_ARTIFACT_BINDING_INVALID/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("provider validation plan closure excludes materialization and child-process authority", () => {
  const profileCli = fs.readFileSync(path.join(skillRoot, "scripts", "chainlink-provider-profile.mjs"), "utf8");
  assert.doesNotMatch(profileCli, /node:child_process|template-catalog-materializer/u);
  assert.match(profileCli, /template-catalog-composition\.mjs/u);
  assert.match(profileCli, /template-catalog-loader\.mjs/u);
});

test("typed A1-A11 and P1-P9 decision derives verdict but never authority from GitHub projection state", () => {
  const fixture = decisionFixture();
  assertValid("launch-admission-decision-v1.schema.json", fixture, validateLaunchAdmissionDecisionV1);

  const missingGate = structuredClone(fixture);
  missingGate.applicantGates.pop();
  assert.match(validateLaunchAdmissionDecisionV1(missingGate).join("\n"), /exactly A1/);

  const applicantFailure = structuredClone(fixture);
  applicantFailure.findings.push({
    id: "a5-delta-gap",
    gateIds: ["A5"],
    classification: "evidence-gap",
    artifact: "evidence/delta.json",
    location: "evidence/delta.json#/quadrants",
    evidenceRefs: [],
    impact: "The exact-output conservation property is unproved.",
    smallestRepair: "Add the missing exact-output stateful property.",
    exactRerun: "forge test --match-test testExactOutputConservation",
    resolutionOwner: "applicant",
    preventionCause: "applicant-deviation"
  });
  Object.assign(applicantFailure.applicantGates[4].assessment, {
    result: "failed",
    evidenceRefs: [],
    findingRefs: ["a5-delta-gap"],
    resolutionOwner: "applicant"
  });
  applicantFailure.verdict = "PLATFORM PENDING";
  assert.match(validateLaunchAdmissionDecisionV1(applicantFailure).join("\n"), /CHANGES REQUIRED/);

  const githubAuthority = structuredClone(fixture);
  githubAuthority.authority.githubProjectionAuthoritative = true;
  assert.match(validateLaunchAdmissionDecisionV1(githubAuthority).join("\n"), /projections only/);

  const forged = structuredClone(fixture);
  forged.authority.basis = "signed-immutable-final-verification";
  forged.authority.authorityEffect = "launch-admission-input";
  assert.match(validateLaunchAdmissionDecisionV1(forged).join("\n"), /cannot create launch authority/);
});
