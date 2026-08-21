import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  APPLICANT_COMPATIBILITY_PATH,
  LEGACY_APPLICANT_COMPATIBILITY_PATH,
  ApplicantCompatibilityError,
  LOCAL_APPLICANT_VALIDATOR_PACKAGE,
  parseApplicantCompatibilityContract,
  resolveApplicantCompatibilityContract
} from "../../skills/programmable-v4-hook-builder/scripts/applicant-compatibility-contract-core.mjs";
import {
  parseApplicationContractFromSnapshot,
  projectApplicationRouteState,
  selectApplicationAdapter,
  validateApplicationContractDocument
} from "../../skills/programmable-v4-hook-builder/scripts/application-v3-contract-adapter.mjs";
import {
  OpenWorldV2ContractAdapterError,
  adaptOpenWorldSubmissionToCurrent,
  validateTradeCapabilityManifestV2,
  validateOpenWorldSubmissionContract
} from "../../skills/programmable-v4-hook-builder/scripts/open-world-v2-contract-adapter.mjs";
import { canonicalJson } from "../../skills/programmable-v4-hook-builder/scripts/submission-core.mjs";
import { createApplicableOpenWorldV2PrototypeFixture } from "./open-world-v2-prototype-fixture.mjs";

const schemaSha256 = `sha256:${"2".repeat(64)}`;
const closureSha256 = `sha256:${"3".repeat(64)}`;
const currentApplicationSha256 = "sha256:69fd860c82c0426d853f96fbf8df53c70de0e824a258da940a5ef09a68c72988";
const legacyApplicationSha256 = "sha256:2d51837bbbfe52672ecca334596243bebcec78e8e0a885d67084dfd98955bcb7";
const currentSubmissionSha256 = "sha256:fb30065f906903530ba74cb0a20cd398d36bb387143cb0bae30326450e88ea23";
const currentTradeSha256 = "sha256:a466baae3111a33cc33a2651b13f37da7dcc2d13d2cedce993896d289a82950f";
const compatibilitySchemaSha256 = "sha256:01de8cd2e99c1e7d76b701377b42ee33df492bcebdb869d6d71a3d2a148a9df8";
const openWorldSubmissionV2 = JSON.parse(fs.readFileSync(
  new URL("../../skills/programmable-v4-hook-builder/assets/templates/open-world-v2/new-idea/submission.v2.json", import.meta.url),
  "utf8"
));
const legacyApplicationV31 = JSON.parse(fs.readFileSync(
  new URL("../../skills/programmable-v4-hook-builder/assets/templates/open-world-v2/public-pr-application-v3.example.json", import.meta.url),
  "utf8"
));
const expected = Object.freeze({
  repositoryNumericId: "1320171831",
  defaultBranch: "main",
  applicationContractId: "public-pr-application-v3.1",
  applicationSchemaPath: "intake/schemas/public-pr-application-v3.schema.json",
  applicationSchemaSha256: schemaSha256,
  builderProtocolVersion: "1.2.0",
  legacyActiveContractId: "submit-launch",
  validatorPackage: {
    ...LOCAL_APPLICANT_VALIDATOR_PACKAGE,
    closureSha256
  }
});

const expectedV2 = Object.freeze({
  repositoryNumericId: "1320171831",
  defaultBranch: "main",
  builderProtocolVersion: "1.0.0",
  application: {
    current: {
      contractId: "public-pr-application-v3.2",
      path: "intake/schemas/public-pr-application-v3.2.schema.json",
      sha256: currentApplicationSha256
    },
    legacy: [{
      contractId: "public-pr-application-v3.1",
      path: "intake/schemas/public-pr-application-v3.schema.json",
      sha256: legacyApplicationSha256
    }]
  },
  supportingContracts: {
    submission: {
      contractId: "open-world-submission-v2.1",
      path: "intake/schemas/open-world-submission-v2.1.schema.json",
      sha256: currentSubmissionSha256
    },
    tradeCapabilityManifest: {
      contractId: "trade-capability-manifest-v2",
      path: "intake/schemas/trade-capability-manifest-v2.schema.json",
      sha256: currentTradeSha256
    },
    routerReadinessSchema: {
      contractId: "programmable-launch-router-readiness-v1",
      path: "intake/schemas/programmable-launch-router-readiness-v1.schema.json",
      sha256: `sha256:${"4".repeat(64)}`
    }
  }
});

function compatibilityContract(overrides = {}) {
  return {
    $schema: "urn:programmable:applicant-compatibility:1.0.0",
    application: {
      contractId: expected.applicationContractId,
      schemaPath: expected.applicationSchemaPath,
      schemaSha256
    },
    capabilities: {
      sourceClosureModes: ["inline", "manifest"],
      draftTransportOperations: ["create", "update"],
      missingObjectRecovery: true,
      unreviewedDraftOnly: true
    },
    kind: "programmable-applicant-compatibility",
    minimumBuilderProtocolVersion: "1.1.0",
    schemaVersion: "1.0.0",
    trustedRepository: {
      numericId: expected.repositoryNumericId,
      defaultBranch: expected.defaultBranch
    },
    validatorPackage: {
      rootPath: "vendor/programmable-applicant-validator",
      entrypointPath: "vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs",
      receiptPath: "vendor/programmable-applicant-validator/validator-package-receipt.v1.json",
      closureSha256
    },
    ...overrides
  };
}

function compatibilityContractV2(overrides = {}) {
  return {
    $schema: "urn:programmable:applicant-compatibility:2.0.0",
    application: structuredClone(expectedV2.application),
    authority: {
      candidateCodeExecuted: false,
      credentialsUsed: false,
      externalWritesPerformed: false,
      launchAuthorized: false,
      networkAccessed: false,
      promotionAuthorized: false,
      reviewAuthorized: false,
      rpcAccessed: false
    },
    capabilities: {
      draftTransportOperations: ["create", "update"],
      launchReadiness: "offline-check-only",
      unreviewedDraftOnly: true
    },
    kind: "programmable-applicant-compatibility",
    minimumBuilderProtocolVersion: "1.0.0",
    schemaVersion: "2.0.0",
    supportingContracts: {
      routerReadiness: {
        schema: structuredClone(expectedV2.supportingContracts.routerReadinessSchema),
        validatorClosure: {
          algorithm: "sha256-path-nul-size-nul-content-nul-v1",
          closureSha256: `sha256:${"5".repeat(64)}`,
          files: [{
            path: "scripts/remote-validator-not-imported.mjs",
            sha256: `sha256:${"6".repeat(64)}`
          }]
        }
      },
      submission: structuredClone(expectedV2.supportingContracts.submission),
      tradeCapabilityManifest: structuredClone(expectedV2.supportingContracts.tradeCapabilityManifest)
    },
    trustedRepository: {
      numericId: expectedV2.repositoryNumericId,
      defaultBranch: expectedV2.defaultBranch
    },
    ...overrides
  };
}

function activeContract({ declaredSchemaSha256 = schemaSha256 } = {}) {
  return {
    $schema: "urn:programmable:active-contract-manifest:1.0.0",
    artifacts: {
      package: [{ path: expected.applicationSchemaPath, sha256: declaredSchemaSha256 }],
      policy: [],
      validator: [],
      workflow: []
    },
    contractId: expected.legacyActiveContractId,
    defaultBranch: expected.defaultBranch,
    kind: "programmable-active-contract",
    schemaVersion: "1.0.0"
  };
}

const bytes = (value) => Buffer.from(JSON.stringify(value), "utf8");

test("the compatibility path and exact contract bind Builder to protected central bytes", () => {
  assert.equal(APPLICANT_COMPATIBILITY_PATH, ".programmable/applicant-compatibility.v2.json");
  assert.equal(LEGACY_APPLICANT_COMPATIBILITY_PATH, ".programmable/applicant-compatibility.v1.json");
  const parsed = parseApplicantCompatibilityContract(bytes(compatibilityContract()), expected);
  assert.equal(parsed.minimumBuilderProtocolVersion, "1.1.0");
  assert.equal(parsed.validatorPackage.closureSha256, closureSha256);
  assert.ok(Object.isFrozen(parsed));
});

test("the resolver prefers the compatibility contract and reports its mode", () => {
  const result = resolveApplicantCompatibilityContract({
    compatibilityBytes: bytes(compatibilityContract()),
    activeContractBytes: bytes(activeContract({ declaredSchemaSha256: `sha256:${"9".repeat(64)}` })),
    expected
  });
  assert.equal(result.mode, "COMPATIBILITY_V1");
  assert.equal(result.path, LEGACY_APPLICANT_COMPATIBILITY_PATH);
  assert.equal(result.contract.validatorPackage.entrypointPath.endsWith("public-applicant-validator.mjs"), true);
});

test("Compatibility V2 is the normal manifest and binds current plus byte-identical legacy schemas", () => {
  const parsed = parseApplicantCompatibilityContract(bytes(compatibilityContractV2()), expectedV2);
  assert.equal(parsed.application.current.contractId, "public-pr-application-v3.2");
  assert.equal(parsed.application.legacy[0].sha256, legacyApplicationSha256);
  assert.equal(parsed.supportingContracts.submission.sha256, currentSubmissionSha256);
  assert.equal(parsed.supportingContracts.tradeCapabilityManifest.sha256, currentTradeSha256);
  assert.ok(Object.isFrozen(parsed));

  const resolution = resolveApplicantCompatibilityContract({
    compatibilityBytes: bytes(compatibilityContractV2()),
    expected: expectedV2
  });
  assert.equal(resolution.mode, "COMPATIBILITY_V2");
  assert.equal(resolution.path, APPLICANT_COMPATIBILITY_PATH);

  const differentRemoteClosure = compatibilityContractV2();
  differentRemoteClosure.supportingContracts.routerReadiness.validatorClosure.closureSha256 = `sha256:${"9".repeat(64)}`;
  assert.doesNotThrow(() => parseApplicantCompatibilityContract(bytes(differentRemoteClosure), expectedV2));
  assert.throws(
    () => parseApplicantCompatibilityContract(bytes(compatibilityContractV2({
      application: {
        ...structuredClone(expectedV2.application),
        current: { ...expectedV2.application.current, sha256: `sha256:${"9".repeat(64)}` }
      }
    })), expectedV2),
    (error) => error.code === "APPLICATION_CONTRACT_BINDING_MISMATCH"
  );
  assert.throws(
    () => parseApplicantCompatibilityContract(bytes(compatibilityContractV2({
      minimumBuilderProtocolVersion: "2.0.0"
    })), expectedV2),
    (error) => error.code === "BUILDER_PROTOCOL_TOO_OLD"
  );
});

test("one protected snapshot selects V3.2, Submission 2.1 and Trade V2 without importing readiness JS", () => {
  const snapshot = currentSnapshot({ routeState: "official-programmable-ethereum" });
  const contract = parseApplicationContractFromSnapshot(snapshot);
  assert.equal(contract.current.version, "3.2.0");
  assert.equal(contract.current.schemaSha256, currentApplicationSha256);
  assert.equal(contract.legacy[0].schemaSha256, legacyApplicationSha256);
  assert.equal(contract.supportingContracts.submission.version, "2.1.0");
  assert.equal(contract.supportingContracts.tradeCapabilityManifest.version, "2.0.0");
  assert.equal(contract.supportingContracts.routerReadiness.executionMode, "not-imported-data-binding-only");

  const selected = selectApplicationAdapter({
    applicationContract: contract,
    requestedRoute: "programmable-ethereum-mainnet",
    priorVersion: "3.1.0"
  });
  assert.equal(selected.mode, "current-schema-migration");
  assert.deepEqual(selected.transition, {
    kind: "schema-migration",
    fromVersion: "3.1.0",
    toVersion: "3.2.0",
    appendOnlyRevision: true
  });
  assert.equal(selected.launchReadiness.state, "offline-check-required");
  assert.equal(selected.launchReadiness.officialRouteClaimAllowed, false);
  assert.equal(selected.launchReadiness.readinessEvidenceVerified, false);
  assert.equal(selected.launchReadiness.validatorClosureImported, false);
  const noMarketContract = parseApplicationContractFromSnapshot(currentSnapshot({ routeState: "no-market" }));
  assert.equal(selectApplicationAdapter({
    applicationContract: noMarketContract,
    requestedRoute: "none"
  }).launchReadiness.state, "analysis-pending");
  assert.throws(
    () => selectApplicationAdapter({
      applicationContract: { ...contract },
      requestedRoute: "none"
    }),
    (error) => error.code === "APPLICATION_CONTRACT_ADAPTER_REQUIRED"
  );
  assert.throws(
    () => selectApplicationAdapter({
      applicationContract: noMarketContract,
      requestedRoute: "programmable-ethereum-mainnet"
    }),
    (error) => error.code === "APPLICATION_ROUTE_SNAPSHOT_MISMATCH"
  );
  const forgedSnapshot = structuredClone(snapshot);
  forgedSnapshot.snapshotBinding.snapshotSha256 = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => parseApplicationContractFromSnapshot(deepFreeze(forgedSnapshot)),
    (error) => error.code === "APPLICATION_CONTRACT_SNAPSHOT_INVALID"
  );
  const forgedStage = structuredClone(snapshot);
  forgedStage.projectStage.routeState = "external";
  assert.throws(
    () => parseApplicationContractFromSnapshot(deepFreeze(forgedStage)),
    (error) => error.code === "APPLICATION_CONTRACT_SNAPSHOT_INVALID"
  );
  const tooNew = currentSnapshot();
  const tooNewProjection = structuredClone(tooNew);
  tooNewProjection.applicationContract.minimumBuilderProtocolVersion = "2.0.0";
  assert.throws(
    () => parseApplicationContractFromSnapshot(deepFreeze(tooNewProjection)),
    (error) => error.code === "BUILDER_PROTOCOL_TOO_OLD"
  );
  const mismatchedOlder = currentSnapshot();
  const mismatchedOlderProjection = structuredClone(mismatchedOlder);
  mismatchedOlderProjection.applicationContract.minimumBuilderProtocolVersion = "0.9.0";
  assert.throws(
    () => parseApplicationContractFromSnapshot(deepFreeze(mismatchedOlderProjection)),
    (error) => error.code === "APPLICATION_CONTRACT_SNAPSHOT_UNSUPPORTED"
  );
});

test("route-state projection is table-driven and never turns caller uncertainty into N/A", () => {
  const application = (requestedRoute, version = "3.2.0") => ({
    contract: { version },
    launchRequest: { requestedRoute }
  });
  const submission = (applicability, version = "2.1.0") => ({
    standardVersion: version,
    tradeCapability: { applicability }
  });
  for (const [requestedRoute, applicability, expectedRouteState] of [
    ["none", "no-market", "no-market"],
    ["none", "unresolved", "unresolved"],
    ["other", "tradable", "external"],
    ["other", "unresolved", "unresolved"],
    ["programmable-ethereum-mainnet", "tradable", "official-programmable-ethereum"],
    ["programmable-ethereum-mainnet", "unresolved", "unresolved"]
  ]) {
    assert.equal(
      projectApplicationRouteState({ application: application(requestedRoute), submission: submission(applicability) }),
      expectedRouteState,
      `${requestedRoute}:${applicability}`
    );
  }
  assert.equal(
    projectApplicationRouteState({ application: application("programmable-ethereum-mainnet", "3.1.0"), submission: submission("tradable", "2.0.0") }),
    "unresolved"
  );
  for (const [requestedRoute, applicability] of [
    ["none", "tradable"],
    ["other", "no-market"],
    ["programmable-ethereum-mainnet", "no-market"]
  ]) {
    assert.throws(
      () => projectApplicationRouteState({ application: application(requestedRoute), submission: submission(applicability) }),
      (error) => error.code === "APPLICATION_ROUTE_STATE_CONTRADICTION",
      `${requestedRoute}:${applicability}`
    );
  }
});

test("legacy V3.1 remains exact compatibility data and cannot claim official readiness", () => {
  const snapshot = currentSnapshot();
  const applicationContract = parseApplicationContractFromSnapshot(snapshot);
  const legacyReport = validateApplicationContractDocument({
    application: structuredClone(legacyApplicationV31),
    applicationContract
  });
  assert.equal(legacyReport.valid, true);
  assert.equal(legacyReport.mode, "legacy-compatibility");
  assert.equal(legacyReport.launchReadiness, "ineligible");

  const forgedReadiness = structuredClone(legacyApplicationV31);
  forgedReadiness.launchRequest = {
    requestedRoute: "programmable-ethereum-mainnet",
    category: "custom",
    launchKind: 1,
    routePlan: null,
    routerReadinessSchema: null
  };
  const forgedReport = validateApplicationContractDocument({
    application: forgedReadiness,
    applicationContract
  });
  assert.equal(forgedReport.valid, false);
  assert.equal(forgedReport.launchReadiness, "ineligible");
  assert.ok(forgedReport.findings.some(({ code, path }) => (
    code === "SCHEMA_ADDITIONAL_PROPERTY" && path === "$.launchRequest"
  )));
});

test("policy-neutral no-market and unresolved Submission 2.0 data migrate to exact Submission 2.1", () => {
  const applicationSelection = currentSelection("none");
  const migrated = adaptOpenWorldSubmissionToCurrent({
    submission: structuredClone(openWorldSubmissionV2),
    tradeCapabilityManifests: [],
    applicationSelection
  });
  assert.equal(migrated.submission.$schema, "urn:programmable:v4-hook-submission:2.1.0");
  assert.equal(migrated.submission.standardVersion, "2.1.0");
  assert.equal(migrated.policyNeutral, true);
  assert.equal(migrated.candidateCodeExecuted, false);
  assert.equal(validateOpenWorldSubmissionContract({
    submission: migrated.submission,
    tradeCapabilityManifests: [],
    applicationSelection
  }).valid, true);
  assert.throws(
    () => validateOpenWorldSubmissionContract({
      submission: migrated.submission,
      tradeCapabilityManifests: []
    }),
    (error) => error.code === "OPEN_WORLD_CURRENT_CONTRACT_ADAPTER_REQUIRED"
  );

  const feeBranded = structuredClone(openWorldSubmissionV2);
  feeBranded.programmableFee = {};
  assert.throws(
    () => adaptOpenWorldSubmissionToCurrent({ submission: feeBranded, applicationSelection }),
    (error) => error instanceof OpenWorldV2ContractAdapterError
      && error.code === "OPEN_WORLD_POLICY_NEUTRAL_REBUILD_REQUIRED"
  );
});

test("tradable migration requires exact policy-neutral Trade Manifest V2 bytes", () => {
  const applicationSelection = currentSelection("other");
  const fixture = policyNeutralTradableV2Fixture();
  const migrated = adaptOpenWorldSubmissionToCurrent({
    submission: fixture.submission,
    tradeCapabilityManifests: [fixture.manifestRecord],
    applicationSelection
  });
  assert.equal(migrated.tradeCapabilityManifests.length, 1);
  assert.equal(migrated.tradeCapabilityManifests[0].schemaId, "urn:programmable:trade-capability-manifest:2.0.0");
  assert.equal(migrated.submission.tradeCapability.markets[0].manifest.sha256, migrated.tradeCapabilityManifests[0].sha256);
  assert.equal(validateOpenWorldSubmissionContract({
    submission: migrated.submission,
    tradeCapabilityManifests: [fixture.manifestRecord],
    applicationSelection
  }).valid, true);
  assert.throws(
    () => validateOpenWorldSubmissionContract({
      submission: migrated.submission,
      tradeCapabilityManifests: [fixture.manifestRecord],
      applicationSelection: currentSelection("none")
    }),
    (error) => error.code === "OPEN_WORLD_ROUTE_SELECTION_MISMATCH"
  );

  const substituted = structuredClone(migrated.submission);
  substituted.tradeCapability.markets[0].manifest.sha256 = `sha256:${"f".repeat(64)}`;
  const report = validateOpenWorldSubmissionContract({
    submission: substituted,
    tradeCapabilityManifests: [fixture.manifestRecord],
    applicationSelection
  });
  assert.equal(report.valid, false);
  assert.equal(report.findings[0].code, "OPEN_WORLD_TRADE_MANIFEST_BINDING_MISMATCH");

  const manifest = JSON.parse(fixture.manifestRecord.bytes.toString("utf8"));
  assert.deepEqual(validateTradeCapabilityManifestV2(manifest), []);
  manifest.contract.version = "1.0.0";
  assert.ok(validateTradeCapabilityManifestV2(manifest).length > 0);
});

test("released legacy bases remain usable only with the exact active contract schema binding", () => {
  const result = resolveApplicantCompatibilityContract({
    compatibilityBytes: null,
    activeContractBytes: bytes(activeContract()),
    expected
  });
  assert.deepEqual(result, {
    mode: "LEGACY_ACTIVE_CONTRACT",
    path: ".programmable/active-contract.json",
    application: {
      contractId: expected.applicationContractId,
      schemaPath: expected.applicationSchemaPath,
      schemaSha256
    },
    trustedRepository: {
      numericId: expected.repositoryNumericId,
      defaultBranch: expected.defaultBranch
    },
    validatorPackage: null
  });

  assert.throws(
    () => resolveApplicantCompatibilityContract({
      compatibilityBytes: null,
      activeContractBytes: bytes(activeContract({ declaredSchemaSha256: `sha256:${"4".repeat(64)}` })),
      expected
    }),
    (error) => error instanceof ApplicantCompatibilityError
      && error.code === "LEGACY_APPLICATION_SCHEMA_BINDING_MISMATCH"
  );
});

test("malformed, duplicate-key, drifted and too-new contracts fail closed", () => {
  assert.throws(
    () => parseApplicantCompatibilityContract(
      Buffer.from('{"kind":"programmable-applicant-compatibility","kind":"other"}', "utf8"),
      expected
    ),
    (error) => error.code === "APPLICANT_COMPATIBILITY_JSON_INVALID"
  );
  assert.throws(
    () => parseApplicantCompatibilityContract(bytes(compatibilityContract({ extra: true })), expected),
    (error) => error.code === "APPLICANT_COMPATIBILITY_SHAPE_INVALID"
  );
  assert.throws(
    () => parseApplicantCompatibilityContract(bytes(compatibilityContract({
      minimumBuilderProtocolVersion: "2.0.0"
    })), expected),
    (error) => error.code === "BUILDER_PROTOCOL_TOO_OLD"
  );
  assert.throws(
    () => parseApplicantCompatibilityContract(bytes(compatibilityContract({
      trustedRepository: { numericId: "1", defaultBranch: "main" }
    })), expected),
    (error) => error.code === "TRUSTED_REPOSITORY_BINDING_MISMATCH"
  );
  assert.throws(
    () => parseApplicantCompatibilityContract(bytes(compatibilityContract({
      validatorPackage: { ...expected.validatorPackage, closureSha256: `sha256:${"9".repeat(64)}` }
    })), expected),
    (error) => error.code === "VALIDATOR_PACKAGE_BINDING_MISMATCH"
  );
});

function currentSnapshot({ routeState = "unresolved" } = {}) {
  const baseCommit = "a".repeat(40);
  const baseTree = "b".repeat(40);
  const snapshotWithoutDigest = {
    repository: "0xprogrammable/submit-launch",
    numericRepositoryId: "1320171831",
    branch: "main",
    baseCommit,
    baseTree,
    activeContractV1: { path: ".programmable/active-contract.json", gitBlobOid: "1".repeat(40), sha256: `sha256:${"1".repeat(64)}` },
    activeContractV2: {
      path: ".programmable/active-contract.v2.json",
      gitBlobOid: "2".repeat(40),
      sha256: `sha256:${"2".repeat(64)}`,
      schema: {
        path: "intake/schemas/active-contract-manifest-v2.schema.json",
        gitBlobOid: "3".repeat(40),
        sha256: `sha256:${"3".repeat(64)}`
      }
    },
    compatibility: {
      path: ".programmable/applicant-compatibility.v2.json",
      gitBlobOid: "4".repeat(40),
      sha256: `sha256:${"4".repeat(64)}`
    },
    compatibilitySchema: {
      path: "intake/schemas/applicant-compatibility-v2.schema.json",
      gitBlobOid: "5".repeat(40),
      sha256: compatibilitySchemaSha256
    },
    policy: {
      schemaVersion: "programmable.launch-policy-binding.v1",
      repository: "0xprogrammable/submit-launch",
      numericRepositoryId: "1320171831",
      baseCommit,
      baseTree,
      path: "policy/launch-policy.v1.json",
      gitBlobOid: "6".repeat(40),
      policyId: "programmable-launch-policy",
      policyVersion: "1.0.0",
      profileId: "workflow-canary",
      sha256: `sha256:${"6".repeat(64)}`
    },
    policySchema: {
      schemaVersion: "programmable.submit-launch-policy-schema-binding.v1",
      repository: "0xprogrammable/submit-launch",
      numericRepositoryId: "1320171831",
      baseCommit,
      baseTree,
      path: "policy/schemas/launch-policy.v1.schema.json",
      gitBlobOid: "7".repeat(40),
      schemaId: "https://programmable.money/schemas/launch-policy.v1.schema.json",
      sha256: `sha256:${"7".repeat(64)}`
    }
  };
  const stageWithoutDigest = {
    schemaVersion: "programmable.submit-launch-stage-plan.v1",
    stage: "submit",
    profileId: "build",
    profileEnabled: true,
    routeState,
    status: routeState === "unresolved" ? "INTEGRATION_PENDING" : "READY",
    requirementIds: [],
    requirements: [],
    unknownHandlerIds: []
  };
  return deepFreeze({
    schemaVersion: "programmable.submit-launch-contract-snapshot.v1",
    snapshotBinding: {
      ...snapshotWithoutDigest,
      snapshotSha256: canonicalDigest(snapshotWithoutDigest)
    },
    currentness: {
      status: "CURRENT",
      refCheckedBefore: true,
      refCheckedAfter: true,
      retryCount: 0,
      cacheStatus: "DISABLED"
    },
    applicationContract: {
      current: structuredClone(expectedV2.application.current),
      legacy: structuredClone(expectedV2.application.legacy),
      supportingContracts: {
        routerReadiness: structuredClone(compatibilityContractV2().supportingContracts.routerReadiness),
        submission: structuredClone(expectedV2.supportingContracts.submission),
        tradeCapabilityManifest: structuredClone(expectedV2.supportingContracts.tradeCapabilityManifest)
      },
      minimumBuilderProtocolVersion: "1.0.0"
    },
    projectStage: {
      ...stageWithoutDigest,
      stageSha256: canonicalDigest(stageWithoutDigest)
    },
    authority: {
      checkerOnly: true,
      launchAuthorized: false,
      externalWritesPerformed: false
    }
  });
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function currentSelection(requestedRoute) {
  const routeState = requestedRoute === "none"
    ? "no-market"
    : requestedRoute === "other"
      ? "external"
      : requestedRoute === "programmable-ethereum-mainnet"
        ? "official-programmable-ethereum"
        : "unresolved";
  const applicationContract = parseApplicationContractFromSnapshot(currentSnapshot({ routeState }));
  return selectApplicationAdapter({ applicationContract, requestedRoute });
}

function policyNeutralTradableV2Fixture() {
  const original = createApplicableOpenWorldV2PrototypeFixture("legacy-open-world-example");
  const submission = structuredClone(original.submission);
  delete submission.programmableFee;
  delete submission.supportingPackage.feePolicy;
  delete submission.supportingPackage.feePolicySchema;
  submission.authorities = submission.authorities.filter(({ id }) => id !== "programmable-fee-owner");
  submission.valueFlows = submission.valueFlows.filter(({ authorityRefs, to }) => (
    !authorityRefs.includes("programmable-fee-owner")
    && !(to.collection === "authorities" && to.id === "programmable-fee-owner")
  ));
  for (const phase of submission.lifecyclePhases) {
    phase.valueFlowRefs = phase.valueFlowRefs.filter((ref) => ref !== "platform-fee-flow");
  }
  for (const market of submission.markets) market.canonicalScopes = [];

  const market = submission.tradeCapability.markets[0];
  const manifest = JSON.parse(original.files.get(market.manifest.path));
  const routeDefinedCurrency = manifest.feeBehavior.programmableFeeV2?.quoteCurrency
    ?? manifest.poolKey.currency0;
  delete manifest.feeBehavior.programmableFeeV2;
  manifest.$schema = "urn:programmable:trade-capability-manifest:2.0.0";
  manifest.schemaVersion = "2.0.0";
  manifest.contract = { id: "trade-capability-manifest-v2", version: "2.0.0" };
  manifest.testEvidence.contract = "source-test-contracts-v2";
  for (const component of manifest.feeBehavior.components) {
    if (component.currencyRole === "programmable-quote-currency") {
      component.currencyRole = "route-defined";
      component.routeDefinedCurrency = routeDefinedCurrency;
    }
  }
  for (const testDeclaration of manifest.testEvidence.quoteTests) {
    testDeclaration.resultContract = "trade-quote-test-result-v2";
    testDeclaration.resultBindings = testDeclaration.resultBindings
      .map((binding) => binding === "fee-conformance" ? "declared-fees" : binding);
  }
  for (const testDeclaration of manifest.testEvidence.executionTests) {
    testDeclaration.resultContract = "trade-execution-test-result-v2";
    testDeclaration.resultBindings = testDeclaration.resultBindings
      .map((binding) => binding === "fee-conformance" ? "declared-fees" : binding);
  }
  return {
    submission,
    manifestRecord: {
      path: market.manifest.path,
      bytes: Buffer.from(`${canonicalJson(manifest)}\n`, "utf8")
    }
  };
}
