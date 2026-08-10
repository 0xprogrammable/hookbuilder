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
  assert.equal(assessment.status, "HOOKEMON_CAPABILITY_PENDING_FINAL_HASHES");
  assert.equal(assessment.activationAllowed, false);
  assert.equal(assessment.pendingFinalBindingPaths.length, HOOKEMON_FINAL_BINDING_PATHS.length);
  assert.equal(HOOKEMON_FROZEN_ACCEPTANCE_CLAIM_SHA256, null);
  assert.equal(HOOKEMON_ACTIVE_CAPABILITY_STATE, null);
  const publicClaim = hookemonPublicRouteAcceptanceClaimV1(pendingFixture);
  assert.equal(
    publicClaim.$schema,
    "urn:programmable:hookemon-applicant-route-acceptance:1.0.0"
  );
  assert.equal(publicClaim.transition.authorizationGranted, false);
  assert.deepEqual(publicClaim.transition.hook, pendingFixture.hook);
  assert.deepEqual(publicClaim.transition.economics, pendingFixture.economics);
  assert.equal(publicClaim.privateKeyRequested, false);
  assert.equal(publicClaim.broadcastAuthorized, false);
  assert.throws(
    () => assertHookemonRouteAcceptanceActive(pendingFixture, schema, { now: TEST_NOW }),
    /HOOKEMON_CAPABILITY_PENDING_FINAL_HASHES/u
  );

  assert.equal(
    SUPPORTED_ROUTE_BINDINGS.some(({ supported }) => supported.includes("hookemon")),
    false,
    "pending overlay must not enter the live route catalog"
  );
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
  assert.deepEqual(pendingHookemonFinalBindingPaths(candidate), []);

  const assessment = assessHookemonRouteAcceptance(candidate, schema, { now: TEST_NOW });
  assert.equal(assessment.status, "HOOKEMON_CAPABILITY_PENDING_FROZEN_CLAIM");
  assert.equal(assessment.activationAllowed, false);
  assert.throws(
    () => assertHookemonRouteAcceptanceActive(candidate, schema, { now: TEST_NOW }),
    /HOOKEMON_CAPABILITY_PENDING_FROZEN_CLAIM/u
  );
});

test("typed position, support graph, action currentness, and attestation rules fail closed", () => {
  const mutations = [
    ["position-owner", (value) => {
      value.immutableBindings.architecture.position.owner =
        "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
    }, "HOOKEMON_POSITION_CUSTODY_MISMATCH"],
    ["ticks", (value) => {
      value.immutableBindings.architecture.position.tickLower = 100;
      value.immutableBindings.architecture.position.tickUpper = 99;
    }, "HOOKEMON_POSITION_TICKS_INVALID"],
    ["graph-count", (value) => {
      value.immutableBindings.architecture.supportGraph.nodeCount = 22;
    }, "HOOKEMON_SUPPORT_GRAPH_COUNT_MISMATCH"],
    ["chunk-vector", (value) => {
      value.immutableBindings.architecture.supportGraph.codeChunkCount = 5;
    }, "HOOKEMON_CODE_CHUNK_VECTOR_INCOMPLETE"],
    ["nonce", (value) => {
      value.applicantActions[2].nonce = 14;
    }, "HOOKEMON_ACTION_NONCES_NOT_CONTIGUOUS"],
    ["selector", (value) => {
      value.applicantActions[2].selector = "0x1234";
    }, "HOOKEMON_ADOPTION_SELECTOR_INVALID"],
    ["attestation-lifetime", (value) => {
      value.immutableBindings.platformAttestation.expiresAt = "2026-10-01T00:00:00.000Z";
    }, "HOOKEMON_PLATFORM_ATTESTATION_LIFETIME_INVALID"],
    ["public-url", (value) => {
      value.immutableBindings.publicAcceptance.claimUrl = "http://example.invalid/claim.json";
    }, "HOOKEMON_PUBLIC_ARTIFACT_URL_INVALID"],
    ["zero-binding", (value) => {
      value.immutableBindings.route.routePayloadHash = `0x${"0".repeat(64)}`;
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

test("transaction identities, CREATE derivation, and Facade ABI bindings are inseparable", () => {
  const mutations = [
    ["approval-spender", (value) => {
      value.applicantActions[0].spender =
        "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
    }, "HOOKEMON_APPROVAL_SPENDER_MISMATCH"],
    ["create-address", (value) => {
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

  const create = populatedCandidate().applicantActions[1];
  assert.equal(
    create.expectedContractAddress,
    deriveCreateAddress(pendingFixture.applicant.launchWallet, create.nonce)
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
  for (const field of HOOKEMON_FINAL_BINDING_PATHS) {
    setPath(value, field, syntheticValue(field));
  }

  value.applicantActions[0].nonce = 11;
  value.applicantActions[1].nonce = 12;
  value.applicantActions[2].nonce = 13;
  value.applicantActions[1].expectedContractAddress =
    deriveCreateAddress(value.applicant.launchWallet, value.applicantActions[1].nonce);
  value.applicantActions[0].spender = value.applicantActions[1].expectedContractAddress;
  value.immutableBindings.architecture.position.owner =
    "0x52908400098527886E0F7030069857D2E4169EE7";
  value.immutableBindings.architecture.position.positionTimelock =
    value.immutableBindings.architecture.position.owner;
  value.immutableBindings.architecture.position.tickLower = -600;
  value.immutableBindings.architecture.position.tickUpper = 600;
  value.immutableBindings.architecture.supportGraph.nodeCount = 23;
  value.immutableBindings.architecture.supportGraph.exclusiveComponentCount = 9;
  value.immutableBindings.architecture.supportGraph.sharedSupportNodeCount = 8;
  value.immutableBindings.architecture.supportGraph.factoryCount = 6;
  value.immutableBindings.architecture.supportGraph.codeChunkCount = 6;
  value.applicantActions[2].to = value.immutableBindings.authorityFacade.facadeAddress;
  value.applicantActions[2].selector = value.immutableBindings.authorityFacade.adoptionSelector;
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
  if (field.endsWith("Sha256") || field.endsWith("sha256")) {
    return `sha256:${"1".repeat(64)}`;
  }
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
