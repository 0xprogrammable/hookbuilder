import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  preflightProtectedApplicantCompatibility,
  resolveProtectedApplicantCompatibility
} from "../../skills/programmable-v4-hook-builder/scripts/applicant-compatibility-github.mjs";
import { LOCAL_APPLICANT_VALIDATOR_PACKAGE } from "../../skills/programmable-v4-hook-builder/scripts/applicant-compatibility-contract-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..", "skills", "programmable-v4-hook-builder");
const API = "https://api.github.com/repos/0xprogrammable/submit-launch";
const REPOSITORY = "https://github.com/0xprogrammable/submit-launch";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const NEXT_COMMIT = "c".repeat(40);
const NEXT_TREE = "d".repeat(40);
const SCHEMA_PATH = "intake/schemas/public-pr-application-v3.schema.json";
const COMPATIBILITY_PATH = ".programmable/applicant-compatibility.v1.json";

test("protected Applicant compatibility binds one exact stable central contract", async () => {
  const fixture = createFixture();
  const resolved = await resolveProtectedApplicantCompatibility({ transport: fixture.transport });
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.binding, {
    mode: "COMPATIBILITY_CONTRACT",
    repository: "0xprogrammable/submit-launch",
    repositoryId: "1320171831",
    defaultBranch: "main",
    centralBaseCommit: COMMIT,
    centralBaseTree: TREE,
    contractPath: COMPATIBILITY_PATH,
    contractSha256: sha256(fixture.compatibilityBytes),
    applicationContractId: "public-pr-application-v3.1",
    applicationSchemaPath: SCHEMA_PATH,
    applicationSchemaSha256: "sha256:2d51837bbbfe52672ecca334596243bebcec78e8e0a885d67084dfd98955bcb7",
    validatorPackage: LOCAL_APPLICANT_VALIDATOR_PACKAGE,
    capabilities: {
      sourceClosureModes: ["inline", "manifest"],
      draftTransportOperations: ["create", "update"],
      missingObjectRecovery: true,
      unreviewedDraftOnly: true
    },
    minimumBuilderProtocolVersion: "1.0.0"
  });
  assert.equal(fixture.requests.filter((url) => url.includes("/git/blobs/")).length, 2);
});

test("protected Applicant compatibility fails closed when central main changes during resolution", async () => {
  const fixture = createFixture({ changeHead: true });
  const preflight = await preflightProtectedApplicantCompatibility({ transport: fixture.transport });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.code, "BUILDER_CENTRAL_COMPATIBILITY_MISMATCH");
  assert.match(preflight.repair, /No Draft write was attempted/u);
});

function createFixture({ changeHead = false } = {}) {
  const schemaBytes = fs.readFileSync(path.join(skillRoot, "references", "public-pr-application-v3.schema.json"));
  assert.equal(sha256(schemaBytes), "sha256:2d51837bbbfe52672ecca334596243bebcec78e8e0a885d67084dfd98955bcb7");
  const compatibilityBytes = Buffer.from(`${JSON.stringify({
    $schema: "urn:programmable:applicant-compatibility:1.0.0",
    application: {
      contractId: "public-pr-application-v3.1",
      schemaPath: SCHEMA_PATH,
      schemaSha256: sha256(schemaBytes)
    },
    capabilities: {
      sourceClosureModes: ["inline", "manifest"],
      draftTransportOperations: ["create", "update"],
      missingObjectRecovery: true,
      unreviewedDraftOnly: true
    },
    kind: "programmable-applicant-compatibility",
    minimumBuilderProtocolVersion: "1.0.0",
    schemaVersion: "1.0.0",
    trustedRepository: { numericId: "1320171831", defaultBranch: "main" },
    validatorPackage: {
      rootPath: "vendor/programmable-applicant-validator",
      entrypointPath: "vendor/programmable-applicant-validator/scripts/public-applicant-validator.mjs",
      receiptPath: "vendor/programmable-applicant-validator/validator-package-receipt.v1.json",
      closureSha256: LOCAL_APPLICANT_VALIDATOR_PACKAGE.closureSha256
    }
  })}\n`, "utf8");
  const blobs = new Map([
    [SCHEMA_PATH, schemaBytes],
    [COMPATIBILITY_PATH, compatibilityBytes]
  ]);
  const entries = [...blobs].map(([entryPath, bytes]) => ({
    path: entryPath,
    mode: "100644",
    type: "blob",
    sha: gitBlobObjectId(bytes),
    size: bytes.length
  }));
  const byObjectId = new Map(entries.map((entry) => [entry.sha, blobs.get(entry.path)]));
  const requests = [];
  let headReads = 0;
  const transport = async (request) => {
    requests.push(request.url);
    let value;
    if (request.url === API) value = {
      id: "1320171831",
      private: false,
      visibility: "public",
      full_name: "0xprogrammable/submit-launch",
      default_branch: "main",
      html_url: REPOSITORY
    };
    else if (request.url === `${API}/git/ref/heads/main`) {
      headReads += 1;
      value = {
        ref: "refs/heads/main",
        object: { type: "commit", sha: changeHead && headReads > 1 ? NEXT_COMMIT : COMMIT }
      };
    } else if (request.url === `${API}/git/commits/${COMMIT}`) value = {
      sha: COMMIT,
      tree: { sha: TREE },
      html_url: `${REPOSITORY}/commit/${COMMIT}`
    };
    else if (request.url === `${API}/git/commits/${NEXT_COMMIT}`) value = {
      sha: NEXT_COMMIT,
      tree: { sha: NEXT_TREE },
      html_url: `${REPOSITORY}/commit/${NEXT_COMMIT}`
    };
    else if (request.url === `${API}/git/trees/${TREE}?recursive=1`) value = { sha: TREE, truncated: false, tree: entries };
    else if (request.url.startsWith(`${API}/git/blobs/`)) {
      const objectId = request.url.slice(`${API}/git/blobs/`.length);
      const bytes = byObjectId.get(objectId);
      if (bytes !== undefined) value = { sha: objectId, size: bytes.length, encoding: "base64", content: bytes.toString("base64") };
    }
    const status = value === undefined ? 404 : 200;
    return { status, headers: {}, body: JSON.stringify(value ?? {}), redirected: false, responseUrl: request.url };
  };
  return { compatibilityBytes, requests, transport };
}

function gitBlobObjectId(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
