import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  bindProtectedApplicantCompatibilitySnapshot,
  preflightProtectedApplicantCompatibility,
} from "../../skills/programmable-v4-hook-builder/scripts/applicant-compatibility-github.mjs";
import {
  PROTECTED_UNIVERSAL_ADMISSION_SOURCE,
  resolveUniversalAdmissionContractAtExactSource
} from "../../skills/programmable-v4-hook-builder/scripts/universal-admission-contract-github.mjs";
import {
  UNIVERSAL_ADMISSION_AUTHORITY_KEYS,
  UNIVERSAL_ADMISSION_CONTRACT_PATH,
  UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID,
  UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH,
  UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS,
  UNIVERSAL_ADMISSION_SCHEMA_BINDINGS,
  parseUniversalAdmissionContractBytes
} from "../../skills/programmable-v4-hook-builder/scripts/universal-admission-contract-core.mjs";
import { canonicalJson } from "../../skills/programmable-v4-hook-builder/scripts/submission-core.mjs";

const API = "https://api.github.com/repos/0xprogrammable/submit-launch";
const REPOSITORY = "https://github.com/0xprogrammable/submit-launch";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const NEXT_COMMIT = "c".repeat(40);
const NEXT_TREE = "d".repeat(40);
test("protected Applicant compatibility binds one Resolver snapshot to current local adapters", () => {
  const snapshot = applicantSnapshot({ routeState: "official-programmable-ethereum" });
  const resolved = bindProtectedApplicantCompatibilitySnapshot({
    snapshot,
    priorVersion: "3.1.0"
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.binding.mode, "COMPATIBILITY_V2");
  assert.equal(resolved.binding.centralBaseCommit, COMMIT);
  assert.equal(resolved.binding.centralBaseTree, TREE);
  assert.equal(resolved.binding.applicationContractId, "public-pr-application-v3.2");
  assert.equal(resolved.binding.applicationContractVersion, "3.2.0");
  assert.equal(resolved.binding.applicationSchemaSha256, "sha256:69fd860c82c0426d853f96fbf8df53c70de0e824a258da940a5ef09a68c72988");
  assert.equal(resolved.binding.supportingContracts.submission.version, "2.1.0");
  assert.equal(resolved.binding.supportingContracts.tradeCapabilityManifest.version, "2.0.0");
  assert.equal(resolved.binding.selectedAdapter.transition.kind, "schema-migration");
  assert.equal(resolved.binding.selectedAdapter.launchReadiness.state, "offline-check-required");
  assert.equal(resolved.binding.validatorClosureImported, false);
  assert.ok(Object.isFrozen(resolved.binding));
});

test("protected Applicant compatibility preflight fails closed before network on invalid consumer options", async () => {
  const preflight = await preflightProtectedApplicantCompatibility({ routeState: "caller-asserted-not-applicable" });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.code, "APPLICANT_COMPATIBILITY_PENDING");
  assert.match(preflight.repair, /No Draft write was attempted/u);
});

test("protected Universal Admission source is frozen to the reviewed exact commit, tree, path, and contract bytes", () => {
  assert.deepEqual(PROTECTED_UNIVERSAL_ADMISSION_SOURCE, {
    repository: "0xprogrammable/submit-launch",
    repositoryId: "1320171831",
    defaultBranch: "main",
    revisionObjectId: "5a150612203b836e62cbc954a3fdef30e30546ca",
    treeObjectId: "193a6d15f830c2ca24213ab1283c2bec3fc22510",
    contractPath: ".programmable/universal-admission-contract.v1.json",
    contractSha256: "sha256:6e7a274a2d4a14376937ab49a7d1462cb2456035139dbcd8417b59226967ce32"
  });
});

test("Universal Admission resolver verifies the complete closure through exact Git tree and blob objects only", async () => {
  const fixture = createUniversalAdmissionFixture();
  const resolved = await resolveUniversalAdmissionContractAtExactSource({
    source: fixture.source,
    transport: fixture.transport
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.binding.queueUsable, false);
  assert.equal(resolved.binding.closure.length, 19);
  assert.equal(resolved.binding.evidence.centralBaseCommit, COMMIT);
  assert.equal(resolved.binding.evidence.centralBaseTree, TREE);
  assert.equal(resolved.binding.evidence.contractSha256, fixture.source.contractSha256);
  assert.equal(resolved.binding.evidence.exactGitObjectsVerified, true);
  assert.equal(resolved.binding.evidence.protectedRefVerified, true);
  assert.equal(resolved.binding.evidence.contentsApiUsed, false);
  assert.equal(fixture.requests.length, 24);
  assert.equal(fixture.requests.at(-1), `${API}/git/ref/heads/main`);
  assert.equal(fixture.requests.some((url) => url.includes("/contents/")), false);
  assert.deepEqual(Object.keys(resolved.binding.authority).sort(), [...UNIVERSAL_ADMISSION_AUTHORITY_KEYS].sort());
  assert.ok(Object.values(resolved.binding.authority).every((value) => value === false));
});

test("Universal Admission resolver rejects a protected main ref that no longer names the frozen revision", async (t) => {
  for (const protectedRef of [
    { objectId: NEXT_COMMIT, type: "commit" },
    { objectId: COMMIT, type: "tag" }
  ]) {
    await t.test(`${protectedRef.type}:${protectedRef.objectId}`, async () => {
      const fixture = createUniversalAdmissionFixture({ protectedRef });
      await assert.rejects(
        resolveUniversalAdmissionContractAtExactSource({ source: fixture.source, transport: fixture.transport }),
        (error) => error?.code === "UNIVERSAL_ADMISSION_PROTECTED_REF_MISMATCH"
      );
      assert.equal(fixture.requests.length, 24);
      assert.equal(fixture.requests.at(-1), `${API}/git/ref/heads/main`);
    });
  }
});

test("Universal Admission resolver rejects exact commit, tree, and blob substitutions", async (t) => {
  for (const mode of ["commit", "tree", "blob"]) {
    await t.test(mode, async () => {
      const fixture = createUniversalAdmissionFixture({ substitution: mode });
      await assert.rejects(
        resolveUniversalAdmissionContractAtExactSource({ source: fixture.source, transport: fixture.transport }),
        (error) => error?.code === (mode === "tree" ? "GITHUB_TREE_INCOMPLETE" : "GITHUB_PROTOCOL_ERROR")
      );
    });
  }
});

test("Universal Admission resolver rejects declared schema and artifact closure drift", async (t) => {
  const schemaPath = UNIVERSAL_ADMISSION_SCHEMA_BINDINGS[0].path;
  const artifactPath = UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS[0];
  for (const driftPath of [schemaPath, artifactPath]) {
    await t.test(driftPath, async () => {
      const fixture = createUniversalAdmissionFixture({ driftPath });
      await assert.rejects(
        resolveUniversalAdmissionContractAtExactSource({ source: fixture.source, transport: fixture.transport }),
        (error) => error?.code === "UNIVERSAL_ADMISSION_CONTRACT_CLOSURE_MISMATCH"
      );
    });
  }
  const wrongId = createUniversalAdmissionFixture({ wrongSchemaIdPath: schemaPath });
  await assert.rejects(
    resolveUniversalAdmissionContractAtExactSource({ source: wrongId.source, transport: wrongId.transport }),
    (error) => error?.code === "UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID_MISMATCH"
  );
});

test("Universal Admission contract rejects enabled deployment and authority tampering", () => {
  const fixture = createUniversalAdmissionFixture();
  const enabled = structuredClone(fixture.contract);
  enabled.deployment.enabled = true;
  assert.throws(
    () => parseUniversalAdmissionContractBytes(canonicalBytes(enabled)),
    (error) => error?.code === "UNIVERSAL_ADMISSION_CONTRACT_INVALID"
  );
  const approved = structuredClone(fixture.contract);
  approved.authority.approvalGranted = true;
  assert.throws(
    () => parseUniversalAdmissionContractBytes(canonicalBytes(approved)),
    (error) => error?.code === "UNIVERSAL_ADMISSION_CONTRACT_INVALID"
  );
});

test("Universal Admission contract snapshots intrinsic bytes without observing hostile binary hooks", () => {
  const bytes = canonicalBytes(createUniversalAdmissionFixture().contract);
  let getterReads = 0;
  class HostileBytes extends Uint8Array {}
  const hostile = new HostileBytes(bytes);
  for (const property of [
    "buffer", "byteLength", "byteOffset", "constructor", "length", "valueOf",
    Symbol.iterator, Symbol.toStringTag
  ]) {
    Object.defineProperty(hostile, property, {
      configurable: true,
      get() {
        getterReads += 1;
        throw new Error(`caller-owned ${String(property)} getter must remain unobserved`);
      }
    });
  }
  assert.equal(parseUniversalAdmissionContractBytes(hostile).contract.kind, "programmable-universal-admission-contract");
  assert.equal(getterReads, 0);

  let proxyTraps = 0;
  const proxied = new Proxy(new Uint8Array(bytes), {
    get() {
      proxyTraps += 1;
      throw new Error("binary proxy get trap must remain unobserved");
    },
    getPrototypeOf() {
      proxyTraps += 1;
      throw new Error("binary proxy prototype trap must remain unobserved");
    }
  });
  assert.throws(
    () => parseUniversalAdmissionContractBytes(proxied),
    (error) => error?.code === "UNIVERSAL_ADMISSION_CONTRACT_BYTES_INVALID"
  );
  assert.equal(proxyTraps, 0);

  let oversizedGetterReads = 0;
  const oversized = new Uint8Array((256 * 1024) + 1);
  for (const property of ["buffer", "byteLength", "byteOffset", "length", "valueOf"]) {
    Object.defineProperty(oversized, property, {
      configurable: true,
      get() {
        oversizedGetterReads += 1;
        throw new Error(`oversized caller-owned ${property} getter must remain unobserved`);
      }
    });
  }
  assert.throws(
    () => parseUniversalAdmissionContractBytes(oversized),
    (error) => error?.code === "UNIVERSAL_ADMISSION_CONTRACT_BYTES_INVALID"
  );
  assert.equal(oversizedGetterReads, 0);
});

function applicantSnapshot({ routeState = "unresolved" } = {}) {
  const snapshotWithoutDigest = {
    repository: "0xprogrammable/submit-launch",
    numericRepositoryId: "1320171831",
    branch: "main",
    baseCommit: COMMIT,
    baseTree: TREE,
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
    compatibility: { path: ".programmable/applicant-compatibility.v2.json", gitBlobOid: "4".repeat(40), sha256: `sha256:${"4".repeat(64)}` },
    compatibilitySchema: {
      path: "intake/schemas/applicant-compatibility-v2.schema.json",
      gitBlobOid: "5".repeat(40),
      sha256: "sha256:01de8cd2e99c1e7d76b701377b42ee33df492bcebdb869d6d71a3d2a148a9df8"
    },
    policy: {
      schemaVersion: "programmable.launch-policy-binding.v1",
      repository: "0xprogrammable/submit-launch",
      numericRepositoryId: "1320171831",
      baseCommit: COMMIT,
      baseTree: TREE,
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
      baseCommit: COMMIT,
      baseTree: TREE,
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
      current: {
        contractId: "public-pr-application-v3.2",
        path: "intake/schemas/public-pr-application-v3.2.schema.json",
        sha256: "sha256:69fd860c82c0426d853f96fbf8df53c70de0e824a258da940a5ef09a68c72988"
      },
      legacy: [{
        contractId: "public-pr-application-v3.1",
        path: "intake/schemas/public-pr-application-v3.schema.json",
        sha256: "sha256:2d51837bbbfe52672ecca334596243bebcec78e8e0a885d67084dfd98955bcb7"
      }],
      supportingContracts: {
        routerReadiness: {
          schema: {
            contractId: "programmable-launch-router-readiness-v1",
            path: "intake/schemas/programmable-launch-router-readiness-v1.schema.json",
            sha256: `sha256:${"8".repeat(64)}`
          },
          validatorClosure: {
            algorithm: "sha256-path-nul-size-nul-content-nul-v1",
            closureSha256: `sha256:${"9".repeat(64)}`,
            files: []
          }
        },
        submission: {
          contractId: "open-world-submission-v2.1",
          path: "intake/schemas/open-world-submission-v2.1.schema.json",
          sha256: "sha256:fb30065f906903530ba74cb0a20cd398d36bb387143cb0bae30326450e88ea23"
        },
        tradeCapabilityManifest: {
          contractId: "trade-capability-manifest-v2",
          path: "intake/schemas/trade-capability-manifest-v2.schema.json",
          sha256: "sha256:a466baae3111a33cc33a2651b13f37da7dcc2d13d2cedce993896d289a82950f"
        }
      },
      minimumBuilderProtocolVersion: "1.0.0"
    },
    projectStage: {
      ...stageWithoutDigest,
      stageSha256: canonicalDigest(stageWithoutDigest)
    },
    authority: { checkerOnly: true, launchAuthorized: false, externalWritesPerformed: false }
  });
}

function createUniversalAdmissionFixture({
  driftPath = null,
  protectedRef = { objectId: COMMIT, type: "commit" },
  substitution = null,
  wrongSchemaIdPath = null
} = {}) {
  const closureBytes = new Map();
  closureBytes.set(
    UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH,
    schemaDocument(UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID)
  );
  closureBytes.set("scripts/universal-admission-contract-core.mjs", artifactDocument("contract-core"));
  closureBytes.set("scripts/universal-admission-contract.mjs", artifactDocument("contract-publisher"));
  for (const binding of UNIVERSAL_ADMISSION_SCHEMA_BINDINGS) {
    closureBytes.set(
      binding.path,
      schemaDocument(binding.path === wrongSchemaIdPath ? `${binding.schemaId}:wrong` : binding.schemaId)
    );
  }
  for (const artifactPath of UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS) {
    closureBytes.set(artifactPath, artifactDocument(artifactPath));
  }
  const authority = Object.fromEntries(UNIVERSAL_ADMISSION_AUTHORITY_KEYS.map((key) => [key, false]));
  const contract = {
    $schema: UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_ID,
    authority,
    contractCore: artifactBinding(closureBytes, "scripts/universal-admission-contract-core.mjs"),
    contractPublisher: artifactBinding(closureBytes, "scripts/universal-admission-contract.mjs"),
    contractSchema: artifactBinding(closureBytes, UNIVERSAL_ADMISSION_CONTRACT_SCHEMA_PATH),
    deployment: {
      audience: null,
      enabled: false,
      endpoint: null,
      state: "reference-only-disabled",
      trustSnapshot: null
    },
    kind: "programmable-universal-admission-contract",
    minimumClientProtocolVersion: "1.0.0",
    publicDataOnly: true,
    referenceImplementation: {
      artifacts: UNIVERSAL_ADMISSION_REFERENCE_ARTIFACT_PATHS.map((artifactPath) => artifactBinding(closureBytes, artifactPath)),
      distributed: false,
      enabled: false,
      kind: "node-sqlite-single-host-v1",
      referenceOnly: true,
      topology: "single-host-single-writer"
    },
    schemaVersion: "1.0.0",
    schemas: UNIVERSAL_ADMISSION_SCHEMA_BINDINGS.map((binding) => ({
      ...binding,
      sha256: sha256(closureBytes.get(binding.path))
    })),
    transport: {
      authentication: "detached-ed25519",
      id: "authenticated-admission-queue-v1",
      operation: "enqueue"
    },
    trustedRepository: { defaultBranch: "main", numericId: "1320171831" }
  };
  const contractBytes = canonicalBytes(contract);
  const blobs = new Map([[UNIVERSAL_ADMISSION_CONTRACT_PATH, contractBytes], ...closureBytes]);
  if (driftPath !== null) blobs.set(driftPath, Buffer.from(`${blobs.get(driftPath).toString("utf8")}drift\n`, "utf8"));
  const entries = [...blobs].map(([entryPath, bytes]) => ({
    path: entryPath,
    mode: "100644",
    type: "blob",
    sha: gitBlobObjectId(bytes),
    size: bytes.length
  }));
  const byObjectId = new Map(entries.map((entry) => [entry.sha, blobs.get(entry.path)]));
  const source = {
    repository: "0xprogrammable/submit-launch",
    repositoryId: "1320171831",
    defaultBranch: "main",
    revisionObjectId: COMMIT,
    treeObjectId: TREE,
    contractPath: UNIVERSAL_ADMISSION_CONTRACT_PATH,
    contractSha256: sha256(contractBytes)
  };
  const requests = [];
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
    else if (request.url === `${API}/git/commits/${COMMIT}`) value = {
      sha: substitution === "commit" ? NEXT_COMMIT : COMMIT,
      tree: { sha: TREE },
      html_url: `${REPOSITORY}/commit/${COMMIT}`
    };
    else if (request.url === `${API}/git/trees/${TREE}?recursive=1`) value = {
      sha: substitution === "tree" ? NEXT_TREE : TREE,
      truncated: false,
      tree: entries
    };
    else if (request.url === `${API}/git/ref/heads/main`) value = {
      ref: "refs/heads/main",
      object: { type: protectedRef.type, sha: protectedRef.objectId }
    };
    else if (request.url.startsWith(`${API}/git/blobs/`)) {
      const objectId = request.url.slice(`${API}/git/blobs/`.length);
      const bytes = byObjectId.get(objectId);
      if (bytes !== undefined) {
        const returned = substitution === "blob" && request.url === `${API}/git/blobs/${entries[0].sha}`
          ? Buffer.alloc(bytes.length, 0x78)
          : bytes;
        value = { sha: objectId, size: bytes.length, encoding: "base64", content: returned.toString("base64") };
      }
    }
    return {
      status: value === undefined ? 404 : 200,
      headers: {},
      body: JSON.stringify(value ?? {}),
      redirected: false,
      responseUrl: request.url
    };
  };
  return { contract, requests, source, transport };
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function schemaDocument(id) {
  return Buffer.from(`${JSON.stringify({ $id: id })}\n`, "utf8");
}

function artifactDocument(id) {
  return Buffer.from(`export const fixture = ${JSON.stringify(id)};\n`, "utf8");
}

function artifactBinding(bytesByPath, artifactPath) {
  return { path: artifactPath, sha256: sha256(bytesByPath.get(artifactPath)) };
}

function gitBlobObjectId(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
