import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICANT_COMPATIBILITY_PATH,
  ApplicantCompatibilityError,
  parseApplicantCompatibilityContract,
  resolveApplicantCompatibilityContract
} from "../../skills/programmable-v4-hook-builder/scripts/applicant-compatibility-contract-core.mjs";

const schemaSha256 = `sha256:${"2".repeat(64)}`;
const closureSha256 = `sha256:${"3".repeat(64)}`;
const expected = Object.freeze({
  repositoryNumericId: "1320171831",
  defaultBranch: "main",
  applicationContractId: "public-pr-application-v3.1",
  applicationSchemaPath: "intake/schemas/public-pr-application-v3.schema.json",
  applicationSchemaSha256: schemaSha256,
  builderProtocolVersion: "1.2.0",
  legacyActiveContractId: "submit-launch"
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
  assert.equal(APPLICANT_COMPATIBILITY_PATH, ".programmable/applicant-compatibility.v1.json");
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
  assert.equal(result.mode, "COMPATIBILITY_CONTRACT");
  assert.equal(result.path, APPLICANT_COMPATIBILITY_PATH);
  assert.equal(result.contract.validatorPackage.entrypointPath.endsWith("public-applicant-validator.mjs"), true);
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
});
