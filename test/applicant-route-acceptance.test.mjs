import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytesV2 } from "../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";
import {
  APPLICANT_ROUTE_ACCEPTANCE_CANONICAL_CLAIM_ENCODING,
  MAXIMUM_APPLICANT_ROUTE_ACCEPTANCE_BYTES,
  applicantAcceptanceRecordHash,
  applicantRouteAcceptanceClaimHash,
  applicantRouteAcceptanceTransition,
  applicationAcceptanceSubjectHash,
  applicationAcceptanceSubjectV1,
  assertApplicantRouteAcceptanceSession,
  canonicalApplicantRouteAcceptanceRecordCoreBytes,
  canonicalApplicationAcceptanceSubjectV1Bytes,
  canonicalApplicantRouteAcceptanceBytes,
  canonicalApplicantRouteAcceptanceJsonUtf8,
  createApplicantRouteAcceptanceCommand,
  createApplicantRouteAcceptanceRecordCore,
  loadApplicantRouteAcceptanceSchema,
  parseApplicantRouteAcceptance,
  reviewedPlanSupersessionHash,
  verifyApplicantRouteAcceptanceRecordCore,
  validateApplicantRouteAcceptance
} from "../scripts/applicant-route-acceptance-core.mjs";
import {
  applicantSubmissionEvidence,
  parseApplicantSubmission
} from "../scripts/applicant-submission-core.mjs";
import {
  EXACT_SHARDS_PROFILE_ID_HASH,
  EXACT_SHARDS_PROFILE_KEY,
  EXACT_SHARDS_PROFILE_VERSION_HASH,
  EXACT_SHARDS_REVENUE_POLICY_HASH,
  EXACT_SHARDS_REVENUE_POLICY_V1,
  EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_SHA256,
  EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1,
  EXACT_SHARDS_REVIEWED_PLAN_V1,
  EXACT_SHARDS_REVIEWED_PLAN_SHA256,
  EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1,
  PRODUCTION_GRAPH_FACTORY_ADDRESS,
  PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH,
  SUPPORTED_ROUTE_BINDINGS,
  assessRouteCompatibility,
  classifyReviewedRoutePlan,
  deriveNestedFactoryProfileKeyV1,
  deriveRevenuePolicyV1,
  isExactShardsApplicantRequest,
  loadReviewedRoutePlanSchema,
  parseReviewedRoutePlan,
  resolveApplicantRouteReview,
  validateReviewedRoutePlan,
  validateReviewedRoutePlanRequestBinding
} from "../scripts/route-compatibility-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestPath = "submissions/requests/1329073878-shards-v1.json";
const planPath = "submissions/examples/shards-reviewed-route-plan-v1.example.json";
const acceptanceExamplePath = "submissions/examples/applicant-route-acceptance-v1.example.json";
const acceptanceGoldenPath = "submissions/examples/applicant-route-acceptance-v1.golden.json";
const requestBytes = fs.readFileSync(path.join(repositoryRoot, requestPath));
const request = parseApplicantSubmission(requestBytes);
const requestEvidence = applicantSubmissionEvidence(request, requestBytes, requestPath);
const plan = parseReviewedRoutePlan(fs.readFileSync(path.join(repositoryRoot, planPath)));
const planSchema = loadReviewedRoutePlanSchema(repositoryRoot);
const acceptanceSchema = loadApplicantRouteAcceptanceSchema(repositoryRoot);
const acceptanceExample = parseApplicantRouteAcceptance(
  fs.readFileSync(path.join(repositoryRoot, acceptanceExamplePath))
);
const acceptanceGolden = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, acceptanceGoldenPath),
  "utf8"
));

function productionShapedAcceptance() {
  const value = structuredClone(acceptanceExample);
  value.router = {
    address: "0x52908400098527886E0F7030069857D2E4169EE7",
    deploymentKind: "immutable",
    source: {
      repository: "https://github.com/0xprogrammable/programmable",
      repositoryId: 1314365508,
      commit: EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routerSource.commit,
      tree: EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routerSource.tree
    },
    contractPath: "src/ProgrammableLaunchStampRouterV2.sol",
    runtimeCodeHash: `0x${"5".repeat(64)}`
  };
  value.routeBinding = structuredClone(EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routeBinding);
  return value;
}

function acceptanceRecordCoreHashFixture(value) {
  const applicationAcceptanceSubject = applicationAcceptanceSubjectV1(value);
  return {
    schemaVersion: "programmable.applicant-route-acceptance-record-core.v1",
    recordRevision: 8,
    acceptedAt: "2026-08-10T12:34:56.000Z",
    previousState: "pending",
    previousStateVersion: 7,
    state: "accepted",
    stateVersion: 8,
    authenticatedGithubUserId: value.applicant.githubUserId,
    expectedLaunchWallet: value.applicant.launchWallet,
    claimSha256: applicantRouteAcceptanceClaimHash(value),
    canonicalClaimEncoding: APPLICANT_ROUTE_ACCEPTANCE_CANONICAL_CLAIM_ENCODING,
    applicationAcceptanceSubject,
    acceptanceSubjectHash: applicationAcceptanceSubjectHash(applicationAcceptanceSubject),
    transition: applicantRouteAcceptanceTransition(value)
  };
}

function directGraphPlan() {
  const value = structuredClone(plan);
  value.profile = "direct-graph";
  delete value.reviewedRequest;
  delete value.poolManager;
  delete value.pool;
  delete value.revenuePolicy;
  delete value.factoryInterface;
  delete value.artifactCode;
  delete value.launchPlan;
  delete value.reviewedPlanSupersessionSha256;
  delete value.routerArtifactBinding;
  value.routeTarget = {
    role: "platform-graph-factory",
    address: PRODUCTION_GRAPH_FACTORY_ADDRESS,
    runtimeCodeHash: PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH
  };
  value.components = value.components.map((component) => ({
    ...component,
    deployer: PRODUCTION_GRAPH_FACTORY_ADDRESS
  }));
  return value;
}

test("capability catalog publishes only direct graph and the exact Shards nested profile", () => {
  assert.deepEqual(
    SUPPORTED_ROUTE_BINDINGS.map(({ supported }) => supported),
    ["direct-graph", "exact-shards-nested-factory"]
  );
  const derived = deriveNestedFactoryProfileKeyV1("exact-shards-nested-factory", "1.0.0");
  assert.equal(derived.profileIdHash, EXACT_SHARDS_PROFILE_ID_HASH);
  assert.equal(derived.profileVersionHash, EXACT_SHARDS_PROFILE_VERSION_HASH);
  assert.equal(derived.profileKey, EXACT_SHARDS_PROFILE_KEY);
  assert.equal(
    SUPPORTED_ROUTE_BINDINGS[0].platformAttestation.getterBundleSha256,
    "sha256:6e6e8a93193bbe2f79f98594a1af32c27bae0746f8297dd13592d9608e2feb20"
  );
  assert.equal(SUPPORTED_ROUTE_BINDINGS[1].platformAttestation, null);
  assert.equal(
    SUPPORTED_ROUTE_BINDINGS[1].activationState,
    "disabled-pending-production-release-attestation"
  );
  assert.equal(
    SUPPORTED_ROUTE_BINDINGS[1].routeTargetRuntimeCodeHash,
    null
  );
  assert.equal(
    SUPPORTED_ROUTE_BINDINGS[1].factoryRuntimeCodeHash,
    "0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5"
  );
  assert.equal(SUPPORTED_ROUTE_BINDINGS[1].factoryInitialStateRequirement, "exact-predeployed-pair");
  assert.equal(SUPPORTED_ROUTE_BINDINGS[1].predeploymentEvidenceSha256, null);
  assert.equal(SUPPORTED_ROUTE_BINDINGS[1].gasCapReceiptSha256, null);
  assert.equal(
    SUPPORTED_ROUTE_BINDINGS[1].revenuePolicyHash,
    "0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2"
  );
  assert.equal(SUPPORTED_ROUTE_BINDINGS[0].revenuePolicyHash, null);
  assert.equal(
    SUPPORTED_ROUTE_BINDINGS[0].revenuePolicySemantics,
    "artifact-required/profile-specific"
  );
});

test("applicant review resolver uses only the immutable compiler-owned catalog entry", () => {
  const resolved = resolveApplicantRouteReview(request, requestEvidence);
  assert.equal(resolved.reviewedPlan, EXACT_SHARDS_REVIEWED_PLAN_V1);
  assert.equal(resolved.bindingSha256, EXACT_SHARDS_REVIEWED_PLAN_SHA256);
  assert.equal(resolved.applicantRevenuePolicyHash, EXACT_SHARDS_REVENUE_POLICY_HASH);

  const uncataloged = structuredClone(request);
  uncataloged.source.repositoryId += 1;
  assert.equal(resolveApplicantRouteReview(uncataloged, requestEvidence), null);
  const routeOnly = structuredClone(request);
  routeOnly.source.commit = "0".repeat(40);
  assert.deepEqual(routeOnly.requestedRoute, request.requestedRoute);
  assert.equal(resolveApplicantRouteReview(routeOnly, requestEvidence), null);
});

test("exact Shards plan validates and its canonical codehash-bound profile digest is frozen", () => {
  assert.deepEqual(validateReviewedRoutePlan(plan, planSchema), []);
  assert.equal(classifyReviewedRoutePlan(plan), "exact-shards-nested-factory");
  const { $schema: _schema, ...profile } = plan;
  const sha256 = `sha256:${crypto.createHash("sha256")
    .update(canonicalJsonBytesV2(profile, { trailingNewline: false }))
    .digest("hex")}`;
  assert.equal(sha256, EXACT_SHARDS_REVIEWED_PLAN_SHA256);
  assert.deepEqual(validateReviewedRoutePlanRequestBinding(request, requestEvidence, plan), []);
  assert.equal(isExactShardsApplicantRequest(request, requestEvidence), true);
  const nonShards = structuredClone(request);
  nonShards.source.repositoryId += 1;
  assert.equal(isExactShardsApplicantRequest(nonShards, requestEvidence), false);
});

test("exact Shards decoded 100/10/10/80 economics reproduce the typed revenue Golden", () => {
  const derived = deriveRevenuePolicyV1(EXACT_SHARDS_REVENUE_POLICY_V1);
  assert.equal(derived.revenuePolicyHash, EXACT_SHARDS_REVENUE_POLICY_HASH);
  assert.equal(derived.legsHash, EXACT_SHARDS_REVENUE_POLICY_V1.legsHash);
  assert.deepEqual(
    derived.legs.map(({ legHash }) => legHash),
    [
      "0x10c851ca78aa2bf257e924b5b4b1a471b8f091e5d971f1a2422165a60bd325ac",
      "0xccc9d7a84cef40c38d165ba1ce0f1817f77172bc97b49155ac6a14fcc5e6cff5",
      "0x30cf730abcc37ad7db1d6e91abad8c1564fc624c777c456da987f0e006b9ff9e"
    ]
  );
  assert.deepEqual(
    EXACT_SHARDS_REVENUE_POLICY_V1.legs.map(({ feeBps }) => feeBps),
    [10, 10, 80]
  );
  assert.equal(EXACT_SHARDS_REVENUE_POLICY_V1.totalFeeBps, 100);
  assert.equal(
    EXACT_SHARDS_REVENUE_POLICY_V1.legs[1].recipient,
    "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"
  );
  assert.match(
    EXACT_SHARDS_REVENUE_POLICY_V1.legs[0].recipientModeLabel,
    /current-builder-may-rotate-to-successor/u
  );
  assert.match(
    EXACT_SHARDS_REVENUE_POLICY_V1.legs[1].recipientModeLabel,
    /immutable-launcher-recipient/u
  );
});

test("exact Shards profile requires predeployment and binds one applicant launch-and-stamp transaction", () => {
  assert.equal(EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.transactionCount, 1);
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.transactionSender,
    request.applicant.launchWallet
  );
  assert.equal(EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.executionEntry, "acceptance-bound-router");
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.reviewedPlanSupersessionSha256,
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_SHA256
  );
  assert.equal(
    reviewedPlanSupersessionHash(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1),
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_SHA256
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.routerArtifactBinding.artifact.sha256,
    "sha256:7385a806d831e7b89e598dca16de1c6107590659375d43d97d4d6ab30292f6d0"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.routerArtifactBinding.routerSource.commit,
    "3d71e9243dd1b604099c79038c4c52a36062b0e4"
  );
  assert.deepEqual(
    EXACT_SHARDS_REVIEWED_PLAN_V1.routerArtifactBinding.routeBinding,
    EXACT_SHARDS_ROUTER_ARTIFACT_BINDING_V1.routeBinding
  );
  assert.deepEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes.map(({ executionMode }) => (
      executionMode
    )),
    ["EXACT_FACTORY_LAUNCH_EXECUTED", "EXACT_EXISTING_LAUNCH_ADOPTED"]
  );
  assert.deepEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes.map(({ abiOrdinal }) => (
      abiOrdinal
    )),
    [1, 2]
  );
  assert.deepEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes[0].preState,
    { tokenCode: "empty", hookCode: "empty", nftCode: "empty", poolSlot0: "zero" }
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes[1]
      .preState.completedIdentity,
    "exact-reviewed-shards-identity"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes[1].factoryCall,
    "none"
  );
  assert.deepEqual(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.allowedExecutionModes[1].ignoredMutableState,
    ["current-builder-fee-recipient", "mutable-balances", "current-market-price"]
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.expectedResultHashPolicy,
    "same-configured-identity-hash-for-both-modes"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.modeRecording,
    "stamp-hash-events-and-record"
  );
  assert.deepEqual(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.adoptionDisclosure.doesNotAttest, [
    "The launch wallet called the Shards factory.",
    "The market remained pristine or untraded."
  ]);
  assert.equal(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.acceptanceChannel, "programmable-website-only");
  assert.deepEqual(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.reviewedRequestedActions, ["review"]);
  assert.equal(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.authorizationGranted, false);
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .plannedDeploymentSender,
    "0x2Bb333d48DFAF1596D9036671d2E43168994249E"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .acceptedObservedDeploymentSender,
    "any-eoa"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .acceptedObservedDeploymentSenderCondition,
    "exact-canonical-create2-proxy-salt-initcode-calldata-factory-renderer-only"
  );
  assert.match(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .senderDisclosure.acceptedObserved,
    /another EOA.*every canonical CREATE2 binding.*runtime matches exactly/u
  );
  assert.equal(EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.revenue.change, "none");
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.revenue.revenuePolicyHash,
    EXACT_SHARDS_REVENUE_POLICY_HASH
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.priorReleaseFactoryPredeployment
      .reviewedManifestExpectedTransactionSender,
    "0x2Bb333d48DFAF1596D9036671d2E43168994249E"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.priorReleaseFactoryPredeployment.applicantAction,
    false
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.priorReleaseFactoryPredeployment.productionExecutionPhase,
    "platform-release-before-applicant-acceptance"
  );
  assert.equal(Object.hasOwn(EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan, "factoryLaunchExecution"), false);
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.priorReleaseFactoryPredeployment.factoryInitCodeBytes,
    37942
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.priorReleaseFactoryPredeployment.factoryInitCodeHash,
    "0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.priorReleaseFactoryPredeployment
      .factoryDeploymentCalldataBytes,
    37974
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.launchPlan.priorReleaseFactoryPredeployment
      .factoryDeploymentCalldataHash,
    "0xf37ce9748abe4d5243cbd26f48c6ea5789ab1ebe8e19ea96d2198693e957c4ec"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite
      .vacantAtomicRoute.status,
    "unsupported"
  );
  assert.ok(
    EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite.vacantAtomicRoute
      .candidateGas
      > EXACT_SHARDS_REVIEWED_PLAN_SUPERSESSION_V1.factoryPredeploymentPrerequisite.vacantAtomicRoute
        .mainnetTransactionGasCap
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.components.find(({ kind }) => kind === "renderer").address,
    "0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.pool.poolId,
    "0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d"
  );
  assert.equal(
    EXACT_SHARDS_REVIEWED_PLAN_V1.pool.poolKeyHash,
    "0x95c1d301b4a0be5bf2ec99270902aae6e8d8bd16a96a005d5985583c0b49835a"
  );
});

test("merged Shards request stays custom graph and requires exact nested-factory acceptance", () => {
  assert.equal(
    crypto.createHash("sha256").update(requestBytes).digest("hex"),
    "5df0061500df503d3f23115ef9099fd4a9ebe7900eec3f3360ec9ab811f28246"
  );
  assert.equal(
    requestEvidence.applicationManifest.sha256,
    "sha256:e069926d380e56bee001dd7cfeda591db56164b1acf7478b478dd62a6e119ec2"
  );
  assert.deepEqual(request.requestedRoute, {
    routeId: "custom-graph",
    routeVersion: "1.0.0",
    chainId: "1"
  });
  const assessment = assessRouteCompatibility(request.requestedRoute, plan);
  assert.equal(assessment.status, "ROUTE_CAPABILITY_DISABLED");
  assert.equal(assessment.supported, null);
  assert.equal(assessment.capabilityClassification, "exact-shards-nested-factory");
  assert.equal(assessment.acceptanceRequired, true);
  assert.deepEqual(assessment.requiredRoute, {
    routeId: "nested-factory",
    routeVersion: "1.0.0",
    chainId: "1"
  });
  assert.equal(assessment.capability.profileKey, EXACT_SHARDS_PROFILE_KEY);
  assert.equal(
    assessRouteCompatibility(assessment.requiredRoute, plan).status,
    "ROUTE_CAPABILITY_DISABLED"
  );
});

test("preapproval CLI fails closed on the original Shards route and points to its acceptance", () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts/check-route-compatibility.mjs"), requestPath, planPath],
    { cwd: repositoryRoot, encoding: "utf8", shell: false }
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "ROUTE_CAPABILITY_DISABLED");
  assert.equal(report.supported, null);
  assert.equal(report.capabilityClassification, "exact-shards-nested-factory");
  assert.equal(report.acceptanceRequired, true);
  assert.equal(report.requiredRoute.routeId, "nested-factory");
  assert.equal(report.networkAccessed, false);
  assert.deepEqual(report.externalActionsPerformed, []);
});

test("direct graph support requires the exact production GraphFactory address and runtime", () => {
  const direct = directGraphPlan();
  assert.deepEqual(validateReviewedRoutePlan(direct, planSchema), []);
  assert.equal(classifyReviewedRoutePlan(direct), "direct-graph");
  assert.equal(assessRouteCompatibility(request.requestedRoute, direct).status, "ROUTE_SUPPORTED");
  for (const mutate of [
    (value) => { value.routeTarget.address = "0x52908400098527886E0F7030069857D2E4169EE7"; },
    (value) => { value.routeTarget.runtimeCodeHash = `0x${"8".repeat(64)}`; },
    (value) => { delete value.routeTarget.runtimeCodeHash; }
  ]) {
    const candidate = structuredClone(direct);
    mutate(candidate);
    assert.ok(validateReviewedRoutePlan(candidate, planSchema).some(({ code }) => (
      code === "DIRECT_GRAPH_TARGET_MISMATCH"
    )));
    assert.throws(() => classifyReviewedRoutePlan(candidate), /no supported route-target role/u);
  }
});

test("all non-published nested factory variants fail closed", () => {
  for (const mutate of [
    (value) => { value.source.tree = "0".repeat(40); },
    (value) => { value.artifact.sha256 = `sha256:${"1".repeat(64)}`; },
    (value) => { value.poolManager.runtimeCodeHash = `0x${"1".repeat(64)}`; },
    (value) => { value.factoryInterface.descriptor.launch.selector = "0x00000000"; },
    (value) => { value.factoryInterface.descriptor.launch.returns.reverse(); },
    (value) => { value.artifactCode[0].expectedRuntimeCodeHash = `0x${"1".repeat(64)}`; },
    (value) => { value.configurationHash = `0x${"1".repeat(64)}`; },
    (value) => { value.revenuePolicy.totalFeeBps = 10; },
    (value) => { value.revenuePolicy.legs[1].feeBps = 1; },
    (value) => { value.revenuePolicy.revenuePolicyHash = `0x${"1".repeat(64)}`; },
    (value) => { value.launchPlan.priorReleaseFactoryPredeployment.factoryInitCodeHash = `0x${"1".repeat(64)}`; },
    (value) => { value.launchPlan.priorReleaseFactoryPredeployment.factoryDeploymentCalldataBytes += 1; },
    (value) => { value.launchPlan.priorReleaseFactoryPredeployment.status = "completed"; },
    (value) => { value.launchPlan.transactionCount = 2; },
    (value) => { value.launchPlan.transactionSender = value.launchPlan.launcherFeeRecipient; },
    (value) => { value.launchPlan.executionEntry = "factory"; },
    (value) => { value.reviewedPlanSupersessionSha256 = `sha256:${"1".repeat(64)}`; },
    (value) => { value.routerArtifactBinding.artifact.sha256 = `sha256:${"1".repeat(64)}`; },
    (value) => { value.launchPlan.factoryLaunchExecution = { applicantAction: "deploy-and-launch" }; },
    (value) => { value.launchPlan.tickUpper += 1; },
    (value) => { value.pool.poolId = `0x${"1".repeat(64)}`; },
    (value) => { value.components.shift(); },
    (value) => { value.components[0].expectedRuntimeCodeHash = `0x${"1".repeat(64)}`; },
    (value) => { value.components[1].deployer = value.components[1].address; },
    (value) => { value.profile = "direct-graph"; }
  ]) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    assert.ok(validateReviewedRoutePlan(candidate, planSchema).length > 0);
    assert.throws(() => classifyReviewedRoutePlan(candidate));
  }
  const unknownRoute = assessRouteCompatibility({
    routeId: "nested-factory",
    routeVersion: "2.0.0",
    chainId: "1"
  }, plan);
  assert.equal(unknownRoute.status, "ROUTE_UNSUPPORTED");
  assert.equal(unknownRoute.supported, null);
});

test("acceptance example is schema-shaped but blocked until every production placeholder is replaced", () => {
  const findings = validateApplicantRouteAcceptance(acceptanceExample, acceptanceSchema);
  assert.ok(findings.some(({ code }) => code === "ROUTE_ACCEPTANCE_EXAMPLE_PLACEHOLDER"));
  assert.ok(findings.some(({ code }) => code === "ROUTE_ACCEPTANCE_CAPABILITY_DISABLED"));
  assert.ok(findings.some(({ code }) => code === "ROUTE_ACCEPTANCE_PREDEPLOYMENT_EVIDENCE_PENDING"));

  const value = productionShapedAcceptance();
  assert.deepEqual(
    validateApplicantRouteAcceptance(value, acceptanceSchema).map(({ code }) => code),
    ["ROUTE_ACCEPTANCE_CAPABILITY_DISABLED", "ROUTE_ACCEPTANCE_PREDEPLOYMENT_EVIDENCE_PENDING"]
  );
  const canonicalBytes = canonicalApplicantRouteAcceptanceBytes(value);
  assert.equal(canonicalBytes.at(-1), "}".charCodeAt(0));
  assert.doesNotMatch(canonicalBytes.toString("utf8"), /\n/u);
  const manifestDigest = crypto.createHash("sha256").update(canonicalBytes).digest("hex");
  assert.equal(applicantRouteAcceptanceClaimHash(value), `sha256:${manifestDigest}`);
});

test("canonical acceptance UTF-8 bytes and SHA-256 match the portable Golden", () => {
  const canonicalBytes = canonicalApplicantRouteAcceptanceBytes(acceptanceExample);
  assert.equal(acceptanceGolden.claimPath, acceptanceExamplePath);
  assert.equal(
    acceptanceGolden.canonicalClaimEncoding,
    APPLICANT_ROUTE_ACCEPTANCE_CANONICAL_CLAIM_ENCODING
  );
  assert.equal(canonicalBytes.length, acceptanceGolden.canonicalByteLength);
  assert.equal(
    applicantRouteAcceptanceClaimHash(acceptanceExample),
    acceptanceGolden.claimSha256
  );
  assert.equal(
    reviewedPlanSupersessionHash(acceptanceExample.reviewedPlanSupersession),
    acceptanceGolden.reviewedPlanSupersessionSha256
  );
  assert.equal(
    `sha256:${crypto.createHash("sha256")
      .update(canonicalJsonBytesV2(acceptanceExample.routerArtifactBinding, { trailingNewline: false }))
      .digest("hex")}`,
    acceptanceGolden.routerArtifactBindingSha256
  );
  assert.deepEqual(
    acceptanceExample.reviewedPlanSupersession.allowedExecutionModes.map(({ executionMode }) => (
      executionMode
    )),
    acceptanceGolden.allowedExecutionModes
  );
  assert.deepEqual(
    acceptanceExample.reviewedPlanSupersession.adoptionDisclosure,
    acceptanceGolden.adoptionDisclosure
  );
  assert.deepEqual(
    {
      plannedDeploymentSender: acceptanceExample.reviewedPlanSupersession
        .factoryPredeploymentPrerequisite.plannedDeploymentSender,
      acceptedObservedDeploymentSender: acceptanceExample.reviewedPlanSupersession
        .factoryPredeploymentPrerequisite.acceptedObservedDeploymentSender,
      acceptedObservedDeploymentSenderCondition: acceptanceExample.reviewedPlanSupersession
        .factoryPredeploymentPrerequisite.acceptedObservedDeploymentSenderCondition
    },
    acceptanceGolden.factoryDeploymentSenderPolicy
  );
  assert.equal(acceptanceGolden.authorizationGranted, false);
  const subject = applicationAcceptanceSubjectV1(acceptanceExample);
  assert.deepEqual(subject, acceptanceGolden.applicationAcceptanceSubjectV1);
  assert.equal(
    canonicalApplicationAcceptanceSubjectV1Bytes(subject).length,
    acceptanceGolden.canonicalSubjectByteLength
  );
  assert.equal(
    applicationAcceptanceSubjectHash(subject),
    acceptanceGolden.acceptanceSubjectHash
  );
  assert.deepEqual(
    validateApplicantRouteAcceptance(acceptanceExample, acceptanceSchema).map(({ code }) => code),
    acceptanceGolden.expectedValidationBlockers
  );
});

test("application acceptance subject is stable across claim revisions and route reacceptance", () => {
  const subject = applicationAcceptanceSubjectV1(acceptanceExample);
  const subjectHash = applicationAcceptanceSubjectHash(subject);
  const revisedClaim = structuredClone(acceptanceExample);
  revisedClaim.acceptedRoute.routeVersion = "2.0.0";
  revisedClaim.routeBinding.routePayloadHash = `0x${"8".repeat(64)}`;
  revisedClaim.router.runtimeCodeHash = `0x${"7".repeat(64)}`;
  revisedClaim.source.commit = "0".repeat(40);
  revisedClaim.applicant.launchWallet = "0x52908400098527886E0F7030069857D2E4169EE7";
  assert.equal(
    applicationAcceptanceSubjectHash(applicationAcceptanceSubjectV1(revisedClaim)),
    subjectHash
  );

  const differentApplicant = structuredClone(acceptanceExample);
  differentApplicant.applicant.githubUserId += 1;
  assert.notEqual(
    applicationAcceptanceSubjectHash(applicationAcceptanceSubjectV1(differentApplicant)),
    subjectHash
  );
  const differentApplication = structuredClone(acceptanceExample);
  differentApplication.reviewedRequest.applicationManifestSha256 = `sha256:${"0".repeat(64)}`;
  assert.notEqual(
    applicationAcceptanceSubjectHash(applicationAcceptanceSubjectV1(differentApplication)),
    subjectHash
  );
});

test("acceptance validator freezes applicant, request, route, capability and exact plan", () => {
  const original = productionShapedAcceptance();
  for (const mutate of [
    (value) => { value.applicant.githubUserId += 1; },
    (value) => { value.applicant.launchWallet = "0x52908400098527886E0F7030069857D2E4169EE7"; },
    (value) => { value.reviewedRequest.pullRequest.headCommit = "0".repeat(40); },
    (value) => { value.source.tree = "0".repeat(40); },
    (value) => { value.acceptedRoute.routeVersion = "2.0.0"; },
    (value) => { value.routeCapability.profileKey = `0x${"1".repeat(64)}`; },
    (value) => { value.routeCapability.reviewedPlanSupersessionSha256 = `sha256:${"1".repeat(64)}`; },
    (value) => { value.reviewedPlanSupersession.allowedExecutionModes.pop(); },
    (value) => { value.reviewedPlanSupersession.adoptionDisclosure.doesNotAttest.pop(); },
    (value) => { value.reviewedPlanSupersession.factoryPredeploymentPrerequisite.acceptedObservedDeploymentSender = "planned-only"; },
    (value) => { value.reviewedPlanSupersession.revenue.change = "changed"; },
    (value) => { value.routerArtifactBinding.routeBinding.launchId = `0x${"1".repeat(64)}`; },
    (value) => { value.reviewedPlan.configurationHash = `0x${"1".repeat(64)}`; },
    (value) => { value.reviewedPlan.reviewedPlanSupersessionSha256 = `sha256:${"1".repeat(64)}`; },
    (value) => { value.reviewedPlan.routerArtifactBinding.integrity.sha256 = `sha256:${"1".repeat(64)}`; },
    (value) => { value.router.source.repositoryId += 1; },
    (value) => { value.router.source.commit = "0".repeat(40); },
    (value) => { value.router.contractPath = "../Router.sol"; },
    (value) => { value.routeBinding.expectedResultHash = value.routeBinding.routePayloadHash; }
  ]) {
    const candidate = structuredClone(original);
    mutate(candidate);
    assert.ok(validateApplicantRouteAcceptance(candidate, acceptanceSchema).length > 0);
  }

  const newPayload = structuredClone(original);
  newPayload.routeBinding.routePayloadHash = `0x${"8".repeat(64)}`;
  assert.ok(validateApplicantRouteAcceptance(newPayload, acceptanceSchema).some(({ code }) => (
    code === "ROUTE_ACCEPTANCE_ROUTE_BINDING_MISMATCH"
  )));
  assert.notEqual(applicantRouteAcceptanceClaimHash(newPayload), applicantRouteAcceptanceClaimHash(original));
});

test("portable acceptance parser rejects ambiguous bytes", () => {
  assert.throws(
    () => parseApplicantRouteAcceptance(Buffer.from('{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}')),
    /duplicate key/u
  );
  assert.throws(() => parseApplicantRouteAcceptance(Buffer.alloc(0)), /must contain 1 to 65536 bytes/u);
  assert.throws(
    () => parseApplicantRouteAcceptance(Buffer.alloc(MAXIMUM_APPLICANT_ROUTE_ACCEPTANCE_BYTES + 1, 0x20)),
    /must contain 1 to 65536 bytes/u
  );
  assert.throws(() => parseApplicantRouteAcceptance(Buffer.from([0xc3, 0x28])), /not valid/u);
});

test("Website acceptance and CAS record creation stay terminally disabled before release", () => {
  const value = productionShapedAcceptance();
  assert.ok(validateApplicantRouteAcceptance(value, acceptanceSchema).some(({ code }) => (
    code === "ROUTE_ACCEPTANCE_CAPABILITY_DISABLED"
  )));
  assert.equal(assertApplicantRouteAcceptanceSession(value, 155705664), 155705664);
  assert.throws(
    () => assertApplicantRouteAcceptanceSession(value, 155705665),
    /does not match the acceptance subject/u
  );
  assert.throws(
    () => createApplicantRouteAcceptanceCommand(value, {
      expectedStateVersion: 7,
      schema: acceptanceSchema
    }),
    /ROUTE_ACCEPTANCE_CAPABILITY_DISABLED/u
  );
  const activated = structuredClone(value);
  activated.routeCapability.activationState = "enabled";
  assert.throws(
    () => createApplicantRouteAcceptanceCommand(activated, {
      expectedStateVersion: 7,
      schema: acceptanceSchema
    }),
    /applicant route acceptance is not ready/u
  );
  const subject = applicationAcceptanceSubjectV1(activated);
  assert.equal(subject.applicantGithubUserId, 155705664);
  assert.deepEqual(subject.reviewedRequest, {
    path: requestPath,
    applicationManifestSha256:
      "sha256:e069926d380e56bee001dd7cfeda591db56164b1acf7478b478dd62a6e119ec2"
  });
  assert.equal(
    applicationAcceptanceSubjectHash(subject),
    applicationAcceptanceSubjectHash(applicationAcceptanceSubjectV1(value))
  );
  const transition = applicantRouteAcceptanceTransition(activated);
  assert.deepEqual(transition.fromRoute, request.requestedRoute);
  assert.deepEqual(transition.toRoute, value.acceptedRoute);
  assert.equal(transition.authorizationGranted, false);
  assert.throws(
    () => createApplicantRouteAcceptanceRecordCore(activated, {
      authenticatedGithubUserId: 155705664,
      expectedStateVersion: 7,
      acceptedAt: "2026-08-10T12:34:56.000Z",
      schema: acceptanceSchema
    }),
    /applicant route acceptance is not ready/u
  );
  assert.throws(
    () => createApplicantRouteAcceptanceRecordCore(activated, {
      authenticatedGithubUserId: 155705664,
      expectedStateVersion: 7,
      acceptedAt: "2026-08-10T12:34:56Z",
      schema: acceptanceSchema
    }),
    /exact UTC RFC 3339/u
  );
  assert.throws(
    () => createApplicantRouteAcceptanceCommand(value, {
      expectedStateVersion: -1,
      schema: acceptanceSchema
    }),
    /nonnegative/u
  );
  assert.equal(
    canonicalApplicantRouteAcceptanceJsonUtf8(value),
    canonicalApplicantRouteAcceptanceBytes(value).toString("utf8")
  );
});

test("immutable acceptance record core has one strict content-addressed hash", () => {
  const recordCore = acceptanceRecordCoreHashFixture(acceptanceExample);
  const canonicalBytes = canonicalApplicantRouteAcceptanceRecordCoreBytes(recordCore);
  assert.equal(canonicalBytes.at(-1), "}".charCodeAt(0));
  assert.equal(canonicalBytes.length, 3488);
  assert.equal(
    applicantAcceptanceRecordHash(recordCore),
    "sha256:d4b08661a90cff595368d5a3be2ae62380bd59293764c478ef2b27b415f437dc"
  );
  assert.equal(
    applicantAcceptanceRecordHash(recordCore),
    `sha256:${crypto.createHash("sha256").update(canonicalBytes).digest("hex")}`
  );
  assert.deepEqual(verifyApplicantRouteAcceptanceRecordCore(recordCore, acceptanceExample), {
    recordSha256: "sha256:d4b08661a90cff595368d5a3be2ae62380bd59293764c478ef2b27b415f437dc",
    claimSha256: acceptanceGolden.claimSha256,
    acceptanceSubjectHash: acceptanceGolden.acceptanceSubjectHash,
    stateVersion: 8,
    authenticatedGithubUserId: 155705664,
    expectedLaunchWallet: "0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC"
  });

  const wrongSubjectHash = structuredClone(recordCore);
  wrongSubjectHash.acceptanceSubjectHash = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => applicantAcceptanceRecordHash(wrongSubjectHash),
    /internally inconsistent/u
  );

  const pointerField = structuredClone(recordCore);
  pointerField.previousAcceptanceHash = null;
  assert.throws(
    () => applicantAcceptanceRecordHash(pointerField),
    /unsupported shape/u
  );

  const wrongTransition = structuredClone(recordCore);
  wrongTransition.transition.routeBinding.routePayloadHash = `0x${"0".repeat(64)}`;
  assert.throws(
    () => verifyApplicantRouteAcceptanceRecordCore(wrongTransition, acceptanceExample),
    /does not bind the supplied canonical claim/u
  );
});
