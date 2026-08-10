import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOOKEMON_ACTIVE_CAPABILITY_STATE,
  HOOKEMON_FINAL_BINDING_PATHS,
  HOOKEMON_FROZEN_ACCEPTANCE_CLAIM_SHA256,
  HOOKEMON_PENDING_ACCEPTANCE_FIXTURE_SHA256,
  HOOKEMON_POST_LAUNCH_RUNTIME_BINDING_PATHS,
  HOOKEMON_PRELAUNCH_BINDING_PATHS,
  assertHookemonRouteAcceptanceActive,
  assessHookemonRouteAcceptance,
  deriveCreateAddress,
  hookemonPublicRouteAcceptanceClaimHash,
  hookemonPublicRouteAcceptanceClaimV1,
  hookemonPublicRouteAcceptanceTransitionHash,
  hookemonRouteAcceptanceClaimHash,
  loadHookemonRouteAcceptanceSchema,
  parseHookemonRouteAcceptance,
  pendingHookemonFinalBindingPaths,
  pendingHookemonPrelaunchBindingPaths,
  validateHookemonRouteAcceptance
} from "../scripts/hookemon-applicant-route-acceptance-core.mjs";
import { SUPPORTED_ROUTE_BINDINGS } from "../scripts/route-compatibility-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  repositoryRoot,
  "submissions",
  "examples",
  "hookemon-applicant-route-acceptance-v1.pending.json"
);
const schema = loadHookemonRouteAcceptanceSchema(repositoryRoot);
const pendingFixture = parseHookemonRouteAcceptance(fs.readFileSync(fixturePath));
const TEST_NOW = "2026-08-10T12:00:00.000Z";

test("pending Hookemon capability is canonical, complete in shape, and mechanically inactive", () => {
  assert.deepEqual(validateHookemonRouteAcceptance(pendingFixture, schema), []);
  assert.equal(
    hookemonRouteAcceptanceClaimHash(pendingFixture),
    HOOKEMON_PENDING_ACCEPTANCE_FIXTURE_SHA256
  );
  assert.deepEqual(
    pendingHookemonFinalBindingPaths(pendingFixture),
    HOOKEMON_FINAL_BINDING_PATHS
  );

  const assessment = assessHookemonRouteAcceptance(pendingFixture, schema, { now: TEST_NOW });
  assert.equal(assessment.status, "HOOKEMON_CAPABILITY_PENDING_FINAL_PRELAUNCH_BINDINGS");
  assert.equal(assessment.activationAllowed, false);
  assert.equal(assessment.launchCompleted, false);
  assert.equal(assessment.grantState, "PENDING_FINAL_PRELAUNCH_BINDINGS");
  assert.equal(assessment.completionState, "PENDING_GRAPH_EXECUTION");
  assert.equal(assessment.pendingPrelaunchBindingPaths.length, HOOKEMON_PRELAUNCH_BINDING_PATHS.length);
  assert.equal(assessment.pendingFinalBindingPaths.length, HOOKEMON_FINAL_BINDING_PATHS.length);
  assert.equal(HOOKEMON_FROZEN_ACCEPTANCE_CLAIM_SHA256, null);
  assert.equal(HOOKEMON_ACTIVE_CAPABILITY_STATE, null);
  const publicClaim = hookemonPublicRouteAcceptanceClaimV1(pendingFixture);
  assert.equal(
    publicClaim.$schema,
    "urn:programmable:hookemon-applicant-route-acceptance:1.1.0"
  );
  assert.equal(publicClaim.transition.authorizationGranted, false);
  assert.deepEqual(publicClaim.transition.hook, pendingFixture.hook);
  assert.deepEqual(publicClaim.transition.economics, pendingFixture.economics);
  assert.equal(publicClaim.privateKeyRequested, false);
  assert.equal(publicClaim.broadcastAuthorized, false);
  assert.throws(
    () => assertHookemonRouteAcceptanceActive(pendingFixture, schema, { now: TEST_NOW }),
    /HOOKEMON_CAPABILITY_PENDING_FINAL_PRELAUNCH_BINDINGS/u
  );

  assert.equal(
    SUPPORTED_ROUTE_BINDINGS.some(({ supported }) => supported.includes("hookemon")),
    false,
    "pending overlay must not enter the live route catalog"
  );
});

test("the two-state contract keeps durable approval static and execution evidence receipt-only", () => {
  for (const field of [
    "$.source.commit",
    "$.source.tree",
    "$.immutableBindings.prelaunchGrant.approvalScopeHash",
    "$.immutableBindings.prelaunchGrant.launchConfigTemplateHash",
    "$.immutableBindings.prelaunchGrant.graphTemplateHash",
    "$.immutableBindings.prelaunchGrant.securityReleaseHash",
    "$.immutableBindings.prelaunchGrant.profileIdentityHash",
    "$.immutableBindings.prelaunchGrant.kernelIdentityHash",
    "$.immutableBindings.prelaunchGrant.registryIdentityHash",
    "$.immutableBindings.prelaunchGrant.authorityIdentityHash",
    "$.immutableBindings.prelaunchGrant.permitAuthorityKeyEpoch",
    "$.immutableBindings.prelaunchGrant.receiptAuthorityKeyEpoch",
    "$.immutableBindings.postLaunchRuntimeResult.receiptSchemaSha256",
    "$.immutableBindings.postLaunchRuntimeResult.receiptAuthorizerBindingSha256"
  ]) {
    assert.ok(HOOKEMON_PRELAUNCH_BINDING_PATHS.includes(field), field);
  }

  for (const field of [
    "$.immutableBindings.reviewedPlan.reviewedPlanSha256",
    "$.immutableBindings.route.actionPlanSha256",
    "$.immutableBindings.route.expectedResultHash",
    "$.immutableBindings.route.stampRequestHash",
    "$.applicantActions[2].to",
    "$.applicantActions[2].selector",
    "$.applicantActions[2].nonce",
    "$.applicantActions[2].gasLimit",
    "$.applicantActions[2].calldataSha256",
    "$.applicantActions[2].permitDigest",
    "$.applicantActions[2].currentnessHash",
    "$.immutableBindings.architecture.position.tokenId",
    "$.immutableBindings.publicAcceptance.recordUrl",
    "$.immutableBindings.publicAcceptance.recordSha256"
  ]) {
    assert.ok(HOOKEMON_POST_LAUNCH_RUNTIME_BINDING_PATHS.includes(field), field);
  }
});

test("the static receipt verifier address is EIP-55 bound", () => {
  const candidate = populatedCandidate();
  candidate.immutableBindings.postLaunchRuntimeResult.receiptVerifierAddress =
    candidate.immutableBindings.postLaunchRuntimeResult.receiptVerifierAddress.toLowerCase();
  const findings = validateHookemonRouteAcceptance(candidate, schema);
  assert.ok(findings.some(({ code, path: findingPath }) => (
    code === "HOOKEMON_ADDRESS_NOT_CANONICAL"
      && findingPath === "$.immutableBindings.postLaunchRuntimeResult.receiptVerifierAddress"
  )));
});

test("every declared runtime binding is rejected from an otherwise complete prelaunch grant", () => {
  for (const field of HOOKEMON_POST_LAUNCH_RUNTIME_BINDING_PATHS) {
    const candidate = populatedCandidate();
    setPath(candidate, field, syntheticValue(field));
    const findings = validateHookemonRouteAcceptance(candidate, schema);
    const expectedCode = field === "$.immutableBindings.architecture.position.tokenId"
      ? "HOOKEMON_PRELAUNCH_POSITION_TOKEN_ID_FORBIDDEN"
      : "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT";
    assert.ok(findings.some(({ code }) => code === expectedCode), field);
  }
});

test("Hookemon invariants reject route/profile substitution, fee drift, and a wrapped CREATE", () => {
  const cases = [
    ["route", (value) => { value.capability.acceptedRoute.routeId = "nested-factory"; }],
    ["profile", (value) => { value.capability.profile.profileId = "direct-graph"; }],
    ["fee", (value) => { value.economics.hookemonFeeBps = 280; }],
    ["mask", (value) => { value.hook.addressFlagMask = "0x20c8"; }],
    ["stale-source", (value) => {
      value.source.commit = "23336e60ae5859dbb0ae9c0db3399af4ef4af8e8";
      value.source.tree = "7624bde3bb09f654e77881880c419e356ed85c29";
    }],
    ["stale-pr-head", (value) => {
      value.reviewedRequest.finalHeadCommit = "1ffc1fd19a9d890760911629942fbb109b7ec183";
    }],
    ["create-to", (value) => {
      value.applicantActions[1].to = "0x52908400098527886E0F7030069857D2E4169EE7";
    }]
  ];

  for (const [label, mutate] of cases) {
    const candidate = structuredClone(pendingFixture);
    mutate(candidate);
    const assessment = assessHookemonRouteAcceptance(candidate, schema, { now: TEST_NOW });
    assert.equal(assessment.status, "HOOKEMON_CAPABILITY_INVALID", label);
    assert.equal(assessment.activationAllowed, false, label);
    assert.ok(assessment.findings.length > 0, label);
  }
});

test("even a synthetically populated candidate remains blocked until a reviewed frozen claim activates it", () => {
  const candidate = populatedCandidate();
  assert.deepEqual(validateHookemonRouteAcceptance(candidate, schema), []);
  assert.equal(candidate.immutableBindings.architecture.position.tokenId, null);
  assert.deepEqual(pendingHookemonPrelaunchBindingPaths(candidate), []);
  assert.deepEqual(
    pendingHookemonFinalBindingPaths(candidate),
    HOOKEMON_POST_LAUNCH_RUNTIME_BINDING_PATHS
  );

  const assessment = assessHookemonRouteAcceptance(candidate, schema, { now: TEST_NOW });
  assert.equal(assessment.status, "HOOKEMON_CAPABILITY_PENDING_FROZEN_CLAIM");
  assert.equal(assessment.activationAllowed, false);
  assert.equal(assessment.launchCompleted, false);
  assert.equal(assessment.completionState, "PENDING_GRAPH_EXECUTION");
  assert.throws(
    () => assertHookemonRouteAcceptanceActive(candidate, schema, { now: TEST_NOW }),
    /HOOKEMON_CAPABILITY_PENDING_FROZEN_CLAIM/u
  );
});

test("the shared position token is a typed post-launch adoption result, never a prelaunch binding", () => {
  const candidate = populatedCandidate();
  assert.deepEqual(candidate.immutableBindings.postLaunchRuntimeResult, {
    receiptSchema: "programmable.hookemon-mainnet-launch-authority-receipt.v3",
    receiptSchemaSha256: `sha256:${"1".repeat(64)}`,
    receiptVerifierContractPath: "src/HookemonReceiptVerifier.sol",
    receiptVerifierAbiSha256: `sha256:${"1".repeat(64)}`,
    receiptVerifierRuntimeCodeHash: `0x${"1".repeat(64)}`,
    receiptVerifierAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
    receiptAuthorizerBindingSha256: `sha256:${"1".repeat(64)}`,
    positionResultDomain: "HookemonPostLaunchResult:v1",
    positionTokenIdPath: "$.position.tokenId",
    requiredAtAdoption: true,
    requiredBeforeState: "GRAPH_EXECUTED_AND_STAMPED",
    kernelEnforced: true,
    profileEnforced: true,
    registryStampEnforced: true,
    oneWinnerEnforced: true,
    revocationEnforced: true,
    requiredRuntimeFields: [
      "positionTokenId",
      "launcherRuntimeCodeHash",
      "architectureResultHash",
      "currentArchitectureStateHash",
      "expectedResultHash",
      "stampRequestHash",
      "stampHash",
      "adoptionTransactionHash",
      "adoptionNonce",
      "adoptionGasLimit",
      "adoptionCalldataSha256",
      "permitDigest",
      "currentnessHash",
      "finalityEvidenceHash",
      "recordUrl",
      "recordSha256"
    ]
  });
  assert.deepEqual(validateHookemonRouteAcceptance(candidate, schema), []);

  const prebound = structuredClone(candidate);
  prebound.immutableBindings.architecture.position.tokenId = "1";
  const findings = validateHookemonRouteAcceptance(prebound, schema);
  assert.ok(findings.some(({ code }) => (
    code === "HOOKEMON_PRELAUNCH_POSITION_TOKEN_ID_FORBIDDEN"
      || code === "SCHEMA_VALIDATION_FAILED"
  )));
  assert.equal(
    assessHookemonRouteAcceptance(prebound, schema, { now: TEST_NOW }).activationAllowed,
    false
  );

  const completedClaim = structuredClone(candidate);
  completedClaim.capability.completionState = "GRAPH_EXECUTED_AND_STAMPED";
  assert.ok(validateHookemonRouteAcceptance(completedClaim, schema).length > 0);
});

test("post-launch observations and JIT action fields cannot enter the durable prelaunch grant", () => {
  const mutations = [
    ["position-owner", (value) => {
      value.immutableBindings.architecture.position.owner =
        "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
    }, "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT"],
    ["ticks", (value) => {
      value.immutableBindings.architecture.position.tickLower = 100;
      value.immutableBindings.architecture.position.tickUpper = 99;
    }, "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT"],
    ["graph-count", (value) => {
      value.immutableBindings.architecture.supportGraph.nodeCount = 22;
    }, "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT"],
    ["chunk-vector", (value) => {
      value.immutableBindings.architecture.supportGraph.codeChunkCount = 5;
    }, "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT"],
    ["postlaunch-nonce", (value) => {
      value.applicantActions[2].nonce = 14;
    }, "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT"],
    ["postlaunch-gas", (value) => {
      value.applicantActions[2].gasLimit = 250000;
    }, "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT"],
    ["selector", (value) => {
      value.applicantActions[2].selector = "0x1234";
    }, "HOOKEMON_ADOPTION_SELECTOR_INVALID"],
    ["attestation-lifetime", (value) => {
      value.immutableBindings.platformAttestation.issuedAt = "2026-08-10T00:00:00.000Z";
      value.immutableBindings.platformAttestation.expiresAt = "2026-10-01T00:00:00.000Z";
    }, "HOOKEMON_PLATFORM_ATTESTATION_LIFETIME_INVALID"],
    ["public-url", (value) => {
      value.immutableBindings.publicAcceptance.claimUrl = "http://example.invalid/claim.json";
    }, "HOOKEMON_PUBLIC_ARTIFACT_URL_INVALID"],
    ["zero-binding", (value) => {
      value.immutableBindings.prelaunchGrant.approvalScopeHash = `0x${"0".repeat(64)}`;
    }, "HOOKEMON_ZERO_FINAL_BINDING"]
  ];

  for (const [label, mutate, expectedCode] of mutations) {
    const candidate = populatedCandidate();
    mutate(candidate);
    const findings = validateHookemonRouteAcceptance(candidate, schema);
    assert.ok(findings.some(({ code }) => code === expectedCode), label);
    assert.equal(
      assessHookemonRouteAcceptance(candidate, schema, { now: TEST_NOW }).activationAllowed,
      false,
      label
    );
  }
});

test("transaction identities stay JIT-only while CREATE derivation remains deterministic", () => {
  const mutations = [
    ["approval-spender", (value) => {
      value.applicantActions[0].spender =
        "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
    }, "HOOKEMON_POST_LAUNCH_VALUE_IN_PRELAUNCH_GRANT"],
    ["create-address", (value) => {
      value.applicantActions[1].nonce = 12;
      value.applicantActions[1].expectedContractAddress =
        "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
      value.applicantActions[0].spender = value.applicantActions[1].expectedContractAddress;
    }, "HOOKEMON_CREATE_ADDRESS_MISMATCH"],
    ["adoption-target", (value) => {
      value.applicantActions[2].to =
        "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
    }, "HOOKEMON_ADOPTION_TARGET_MISMATCH"],
    ["adoption-selector", (value) => {
      value.applicantActions[2].selector = "0x87654321";
    }, "HOOKEMON_ADOPTION_SELECTOR_MISMATCH"],
    ["zero-selector", (value) => {
      value.applicantActions[2].selector = "0x00000000";
      value.immutableBindings.authorityFacade.adoptionSelector = "0x00000000";
    }, "HOOKEMON_ADOPTION_SELECTOR_ZERO"]
  ];

  for (const [label, mutate, expectedCode] of mutations) {
    const candidate = populatedCandidate();
    mutate(candidate);
    const findings = validateHookemonRouteAcceptance(candidate, schema);
    assert.ok(findings.some(({ code }) => code === expectedCode), label);
  }

  assert.equal(
    deriveCreateAddress(pendingFixture.applicant.launchWallet, 12),
    "0x86a155D49C74AfB2a006f3992E095E9456998bd2"
  );
});

test("public claim commits Hookemon mask, return deltas, and exact inclusive fee split", () => {
  const baseline = hookemonPublicRouteAcceptanceClaimHash(pendingFixture);
  const maskDrift = structuredClone(pendingFixture);
  maskDrift.hook.addressFlagMask = "0x20c8";
  assert.notEqual(hookemonPublicRouteAcceptanceClaimHash(maskDrift), baseline);
  const feeDrift = structuredClone(pendingFixture);
  feeDrift.economics.hookemonFeeBps = 280;
  assert.notEqual(hookemonPublicRouteAcceptanceClaimHash(feeDrift), baseline);
});

test("expired currentness and zero economic placeholders cannot complete the overlay", () => {
  const expired = populatedCandidate();
  expired.immutableBindings.platformAttestation.issuedAt = "2025-08-10T00:00:00.000Z";
  expired.immutableBindings.platformAttestation.expiresAt = "2025-08-11T00:00:00.000Z";
  refreshPublicClaimBindings(expired);
  const expiredAssessment = assessHookemonRouteAcceptance(expired, schema, { now: TEST_NOW });
  assert.equal(expiredAssessment.activationAllowed, false);
  assert.ok(expiredAssessment.findings.some(
    ({ code }) => code === "HOOKEMON_PLATFORM_ATTESTATION_EXPIRED"
  ));

  for (const mutate of [
    (value) => { value.applicantActions[0].amountBaseUnits = "0"; },
    (value) => { value.immutableBindings.architecture.position.liquidity = "0"; }
  ]) {
    const candidate = populatedCandidate();
    mutate(candidate);
    assert.equal(
      assessHookemonRouteAcceptance(candidate, schema, { now: TEST_NOW }).activationAllowed,
      false
    );
    assert.ok(validateHookemonRouteAcceptance(candidate, schema).length > 0);
  }
});

function populatedCandidate() {
  const value = structuredClone(pendingFixture);
  for (const field of HOOKEMON_PRELAUNCH_BINDING_PATHS) {
    setPath(value, field, syntheticValue(field));
  }

  refreshPublicClaimBindings(value);
  return value;
}

function refreshPublicClaimBindings(value) {
  value.immutableBindings.publicAcceptance.claimSha256 =
    hookemonPublicRouteAcceptanceClaimHash(value);
  value.immutableBindings.publicAcceptance.transitionHash =
    hookemonPublicRouteAcceptanceTransitionHash(value);
}

function syntheticValue(field) {
  if (field.endsWith("receiptSchema")) {
    return "programmable.hookemon-mainnet-launch-authority-receipt.v3";
  }
  if (field.endsWith("receiptVerifierContractPath")) {
    return "src/HookemonReceiptVerifier.sol";
  }
  if (field.endsWith("routeVersion") || field.endsWith("profileVersion")) return "1.0.0";
  if (field.endsWith("profileId")) return "exact-hookemon-profile-v1";
  if (field.endsWith("planSchemaId")) {
    return "urn:programmable:hookemon-reviewed-route-plan:1.0.0";
  }
  if (field.endsWith("kernelContractPath")) return "src/HookemonAdoptionKernel.sol";
  if (field.endsWith("routerContractPath")) return "src/ProgrammableRouter.sol";
  if (field.endsWith("profileContractPath")) return "src/HookemonArchitectureProfile.sol";
  if (field.endsWith("registryContractPath")) return "src/ProgrammableRegistry.sol";
  if (field.endsWith("authorityContractPath")) return "src/HookemonAuthority.sol";
  if (field.endsWith("facadeContractPath")) return "src/HookemonFacade.sol";
  if (field.endsWith("ContractPath")) return "src/HookemonContract.sol";
  if (field.endsWith("sourceRepository")) {
    return "https://github.com/0xprogrammable/programmable";
  }
  if (field.endsWith("sourceRepositoryId")) return 1314365508;
  if (field.endsWith("claimUrl")) return "https://example.invalid/hookemon-claim.json";
  if (field.endsWith("recordUrl")) return "https://example.invalid/hookemon-record.json";
  if (field.endsWith("platformAttestation.url")) {
    return "https://example.invalid/hookemon-platform-attestation.json";
  }
  if (field.endsWith("keyId")) return "hookemon-key-v1";
  if (field.endsWith("issuedAt")) return "2026-08-10T00:00:00.000Z";
  if (field.endsWith("expiresAt")) return "2026-08-11T00:00:00.000Z";
  if (
    field.endsWith("finalHeadCommit")
    || field.endsWith("mergeCommit")
    || field.endsWith("mergeTree")
    || field.endsWith("source.commit")
    || field.endsWith("source.tree")
    || field.endsWith("sourceCommit")
    || field.endsWith("sourceTree")
    || field.endsWith("releaseCommit")
    || field.endsWith("releaseTree")
  ) return "1".repeat(40);
  if (
    field.endsWith("Sha256")
    || field.endsWith("sha256")
    || field.endsWith("IdentityHash")
    || field.endsWith("securityReleaseHash")
  ) {
    return `sha256:${"1".repeat(64)}`;
  }
  if (field.endsWith("KeyEpoch")) return "1";
  if (
    field.endsWith("Address")
    || field.endsWith(".spender")
    || field.endsWith(".manager")
    || field.endsWith(".owner")
    || field.endsWith(".positionTimelock")
    || field.endsWith("[2].to")
  ) return "0x52908400098527886E0F7030069857D2E4169EE7";
  if (field.endsWith("selector") || field.endsWith("Selector")) return "0x12345678";
  if (
    field.endsWith("amountBaseUnits")
    || field.endsWith("tokenId")
    || field.endsWith("liquidity")
  ) return "1";
  if (
    field.endsWith("nonce")
    || field.endsWith("gasLimit")
    || field.endsWith("finalityBlocks")
    || field.endsWith("tickLower")
    || field.endsWith("tickUpper")
    || field.endsWith("nodeCount")
    || field.endsWith("ComponentCount")
    || field.endsWith("SupportNodeCount")
    || field.endsWith("factoryCount")
    || field.endsWith("codeChunkCount")
  ) return 1;
  return `0x${"1".repeat(64)}`;
}

function setPath(value, jsonPath, replacement) {
  const tokens = jsonPath
    .replace(/^\$\.?/u, "")
    .replace(/\[(\d+)\]/gu, ".$1")
    .split(".")
    .filter(Boolean);
  const key = tokens.pop();
  const parent = tokens.reduce((node, token) => node[token], value);
  parent[key] = replacement;
}
