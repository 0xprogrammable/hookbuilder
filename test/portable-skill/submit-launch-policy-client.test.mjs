import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertSubmitLaunchPolicyBindingsEqual,
  currentSubmitLaunchBuildRequirements,
  normalizeSubmitLaunchBuildPolicyBinding,
  normalizeSubmitLaunchPolicyBinding,
  parseAndBindSubmitLaunchPolicyContract,
  parseSubmitLaunchPolicyContract
} from "../../skills/programmable-v4-hook-builder/scripts/submit-launch-policy-contract.mjs";
import {
  assertCurrentSubmitLaunchContractCurrent,
  preflightCurrentSubmitLaunchRequirements,
  resolveCurrentSubmitLaunchContract,
  resolveCurrentSubmitLaunchPolicy,
  resolveSubmitLaunchPolicyFromVerifiedGitObjects,
  resolveSubmitLaunchPolicyWithPublicTransport,
  resolveSubmitLaunchPolicyWithTransport
} from "../../skills/programmable-v4-hook-builder/scripts/submit-launch-policy-github.mjs";
import { createSubmitLaunchVerifiedCache } from "../../skills/programmable-v4-hook-builder/scripts/submit-launch-policy-cache.mjs";
import { canonicalJson } from "../../skills/programmable-v4-hook-builder/scripts/submission-core.mjs";
import { validateAgainstSchema } from "../../skills/programmable-v4-hook-builder/scripts/restricted-json-schema-core.mjs";
import {
  contentResponse,
  digest,
  makeSubmitLaunchPolicyFixture
} from "./submit-launch-policy-fixture.mjs";

const BASE_COMMIT = "1".repeat(40);
const BASE_TREE = "2".repeat(40);
const POLICY_TREE = "3".repeat(40);
const SCHEMAS_TREE = "4".repeat(40);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const authoritativeFixtureDirectory = path.join(testDirectory, "fixtures", "submit-launch-policy");

test("fixed Git objects produce the exact Submit binding and a separate schema binding", async () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const resolved = await resolveSubmitLaunchPolicyFromVerifiedGitObjects({
    baseCommit: BASE_COMMIT,
    baseTree: BASE_TREE,
    readTree: fixture.readTree,
    readBlob: fixture.readBlob
  });

  assert.deepEqual(Object.keys(resolved.policyBinding), [
    "schemaVersion",
    "repository",
    "numericRepositoryId",
    "baseCommit",
    "baseTree",
    "path",
    "gitBlobOid",
    "policyId",
    "policyVersion",
    "profileId",
    "sha256"
  ]);
  assert.deepEqual(resolved.policyBinding, {
    schemaVersion: "programmable.launch-policy-binding.v1",
    repository: "0xprogrammable/submit-launch",
    numericRepositoryId: "1320171831",
    baseCommit: BASE_COMMIT,
    baseTree: BASE_TREE,
    path: "policy/launch-policy.v1.json",
    gitBlobOid: fixture.policyBlob,
    policyId: "programmable-central-launch-policy",
    policyVersion: "1.0.0",
    profileId: "workflow-canary",
    sha256: digest(fixture.policyBytes)
  });
  assert.deepEqual(resolved.buildPolicyBinding, {
    ...resolved.policyBinding,
    profileId: "build"
  });
  assert.deepEqual(normalizeSubmitLaunchBuildPolicyBinding(resolved.buildPolicyBinding), resolved.buildPolicyBinding);
  assert.deepEqual(currentSubmitLaunchBuildRequirements(resolved), [{
    applicability: { mode: "always" },
    enforcement: { handlerId: "ethereum-treasury-10-bps-v1", mode: "deterministic", owner: "applicant" },
    evidence: ["programmable-launch-requirement"],
    id: "LAUNCH.ETHEREUM_AND_TREASURY_10_BPS",
    introducedIn: "1.2.0",
    parameters: {
      basis: "gross-canonical-pool-volume",
      chainId: 1,
      hundredthsOfBip: 1000,
      network: "ethereum-mainnet",
      treasury: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"
    },
    profiles: ["build", "production-launch"],
    requirement: "A launch must be on Ethereum and route 10 bps of trading volume to the Programmable treasury.",
    retiredIn: null,
    severity: "blocker",
    status: "active"
  }]);
  assert.deepEqual(resolved.policySchemaBinding, {
    schemaVersion: "programmable.submit-launch-policy-schema-binding.v1",
    repository: "0xprogrammable/submit-launch",
    numericRepositoryId: "1320171831",
    baseCommit: BASE_COMMIT,
    baseTree: BASE_TREE,
    path: "policy/schemas/launch-policy.v1.schema.json",
    gitBlobOid: fixture.schemaBlob,
    schemaId: "https://programmable.money/schemas/launch-policy.v1.schema.json",
    sha256: digest(fixture.schemaBytes)
  });
  assert.equal(Object.hasOwn(resolved.policyBinding, "schemaSha256"), false);
  assert.equal(Object.hasOwn(resolved.policyBinding, "policySchemaBinding"), false);
  assert.deepEqual(fixture.treeReads, [BASE_TREE, POLICY_TREE, SCHEMAS_TREE]);
  assert.deepEqual(fixture.blobReads, [fixture.policyBlob, fixture.schemaBlob]);
});

test("exact Submit policy, policy schema, and Task-1 binding-schema snapshots stay compatible", () => {
  const policyBytes = readAuthoritativeFixture(
    "launch-policy.v1.json",
    "868c7a647238461f5bbc6afd15bd974d78a1a77f9a13aa1b81044d0e1ffe01dc"
  );
  const schemaBytes = readAuthoritativeFixture(
    "launch-policy.v1.schema.json",
    "23be8a0be27712c58eb4d70ea64547fe652a402618ed8606fe07e3b8077676e4"
  );
  const bindingSchemaBytes = readAuthoritativeFixture(
    "launch-policy-binding.v1.schema.json",
    "5ce7e6e9cc5b8321f164b6d1469212fdf9c8b7ac74bf2311bc3991efcb903eab"
  );
  const policyGitBlobOid = gitBlobOid(policyBytes);
  const schemaGitBlobOid = gitBlobOid(schemaBytes);
  const resolved = parseAndBindSubmitLaunchPolicyContract({
    baseCommit: BASE_COMMIT,
    baseTree: BASE_TREE,
    policyBytes,
    policyGitBlobOid,
    schemaBytes,
    schemaGitBlobOid
  });
  const bindingSchema = JSON.parse(bindingSchemaBytes.toString("utf8"));

  assert.deepEqual(validateAgainstSchema(resolved.policyBinding, bindingSchema), []);
  assert.deepEqual(validateAgainstSchema(resolved.buildPolicyBinding, bindingSchema), []);
  assert.deepEqual(Object.keys(resolved.policyBinding), bindingSchema.required);
  assert.equal(Object.hasOwn(resolved.policyBinding, "schemaSha256"), false);
  assert.equal(Object.hasOwn(resolved, "policyBytes"), false);
  assert.equal(Object.hasOwn(resolved, "schemaBytes"), false);
});

test("the policy contract rejects noncanonical policy bytes and disabled required profiles", () => {
  const valid = makeSubmitLaunchPolicyFixture();
  const prettyPolicy = Buffer.from(`${JSON.stringify(valid.policy, null, 2)}\n`);
  assert.throws(
    () => parseSubmitLaunchPolicyContract({ policyBytes: prettyPolicy, schemaBytes: valid.schemaBytes }),
    hasCode("SUBMIT_LAUNCH_POLICY_NONCANONICAL")
  );

  const bomPolicy = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid.policyBytes]);
  assert.throws(
    () => parseSubmitLaunchPolicyContract({ policyBytes: bomPolicy, schemaBytes: valid.schemaBytes }),
    hasCode("SUBMIT_LAUNCH_POLICY_NONCANONICAL")
  );

  const disabledCanary = structuredClone(valid.policy);
  disabledCanary.profiles[2].enabled = false;
  const disabledBytes = Buffer.from(`${canonicalJson(disabledCanary)}\n`);
  assert.throws(
    () => parseSubmitLaunchPolicyContract({ policyBytes: disabledBytes, schemaBytes: valid.schemaBytes }),
    hasCode("SUBMIT_LAUNCH_POLICY_INVALID")
  );

  const disabledBuild = structuredClone(valid.policy);
  disabledBuild.profiles[0].enabled = false;
  assert.throws(
    () => parseSubmitLaunchPolicyContract({
      policyBytes: Buffer.from(`${canonicalJson(disabledBuild)}\n`),
      schemaBytes: valid.schemaBytes
    }),
    hasCode("SUBMIT_LAUNCH_POLICY_INVALID")
  );
});

test("the client has no caller-selected repository path or production profile", async () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  let reads = 0;
  await assert.rejects(
    () => resolveSubmitLaunchPolicyFromVerifiedGitObjects({
      baseCommit: BASE_COMMIT,
      baseTree: BASE_TREE,
      readTree: async (...args) => {
        reads += 1;
        return fixture.readTree(...args);
      },
      readBlob: fixture.readBlob,
      profileId: "production-launch"
    }),
    hasCode("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID")
  );
  assert.equal(reads, 0);
});

test("closed option and binding fields are order-independent but reject extras", async () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const resolved = await resolveSubmitLaunchPolicyFromVerifiedGitObjects({
    readBlob: fixture.readBlob,
    readTree: fixture.readTree,
    baseTree: BASE_TREE,
    baseCommit: BASE_COMMIT
  });
  const reversedBinding = Object.fromEntries(Object.entries(resolved.policyBinding).reverse());
  assert.deepEqual(normalizeSubmitLaunchPolicyBinding(reversedBinding), reversedBinding);
  assert.throws(
    () => normalizeSubmitLaunchPolicyBinding({ ...reversedBinding, schemaSha256: digest(fixture.schemaBytes) }),
    hasCode("SUBMIT_LAUNCH_POLICY_BINDING_INVALID")
  );
  assert.throws(
    () => currentSubmitLaunchBuildRequirements({ policy: fixture.policy }),
    hasCode("SUBMIT_LAUNCH_POLICY_CONTRACT_REQUIRED")
  );
});

test("fixed repository bootstrap stays closed even if protected schema bytes are weakened", () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const replacedRepository = structuredClone(fixture.policy);
  replacedRepository.repository.numericRepositoryId = "999999999";
  const replacedRepositoryBytes = Buffer.from(`${canonicalJson(replacedRepository)}\n`);
  const weakenedSchema = structuredClone(fixture.schema);
  weakenedSchema.additionalProperties = true;
  const weakenedSchemaBytes = Buffer.from(`${JSON.stringify(weakenedSchema, null, 2)}\n`);
  assert.throws(
    () => parseSubmitLaunchPolicyContract({ policyBytes: replacedRepositoryBytes, schemaBytes: weakenedSchemaBytes }),
    hasCode("SUBMIT_LAUNCH_POLICY_INVALID")
  );
});

test("protected policy and schema may reorder or extend profiles and change canary outcome", () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const changedPolicy = structuredClone(fixture.policy);
  const canary = changedPolicy.profiles.find((profile) => profile.id === "workflow-canary");
  canary.outcome = "CANARY_CHECK_COMPLETE";
  changedPolicy.profiles = [
    {
      authority: structuredClone(canary.authority),
      enabled: true,
      id: "research",
      outcome: "RESEARCH_CHECK_COMPLETE"
    },
    canary,
    changedPolicy.profiles.find((profile) => profile.id === "production-launch"),
    changedPolicy.profiles.find((profile) => profile.id === "build")
  ];
  const changedSchema = structuredClone(fixture.schema);
  changedSchema.properties.profiles.maxItems = 4;
  const changedPolicyBytes = Buffer.from(`${canonicalJson(changedPolicy)}\n`);
  const changedSchemaBytes = Buffer.from(`${JSON.stringify(changedSchema, null, 2)}\n`);

  const parsed = parseSubmitLaunchPolicyContract({
    policyBytes: changedPolicyBytes,
    schemaBytes: changedSchemaBytes
  });
  assert.equal(
    parsed.policy.profiles.find((profile) => profile.id === "workflow-canary").outcome,
    "CANARY_CHECK_COMPLETE"
  );
  assert.equal(parsed.policy.profiles.length, 4);
});

test("policy canonicalization uses the Submit authority UTF-8 byte comparator", () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const policy = structuredClone(fixture.policy);
  policy.rules[0].parameters = { "\ue000": 1, "\u{10000}": 2 };
  const policyBytes = Buffer.from(`${canonicalUtf8Json(policy)}\n`);
  const parsed = parseSubmitLaunchPolicyContract({ policyBytes, schemaBytes: fixture.schemaBytes });
  assert.deepEqual(parsed.policy.rules[0].parameters, { "\ue000": 1, "\u{10000}": 2 });
});

test("parse-and-bind recomputes each Git blob identity from the exact bytes", () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  assert.throws(
    () => parseAndBindSubmitLaunchPolicyContract({
      baseCommit: BASE_COMMIT,
      baseTree: BASE_TREE,
      policyBytes: fixture.policyBytes,
      policyGitBlobOid: "f".repeat(40),
      schemaBytes: fixture.schemaBytes,
      schemaGitBlobOid: fixture.schemaBlob
    }),
    hasCode("SUBMIT_LAUNCH_POLICY_BINDING_INVALID")
  );
});

test("Git tree traversal rejects invisible sibling names before selecting protected paths", async () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  await assert.rejects(
    () => resolveSubmitLaunchPolicyFromVerifiedGitObjects({
      baseCommit: BASE_COMMIT,
      baseTree: BASE_TREE,
      readTree: async (tree) => {
        const result = await fixture.readTree(tree);
        if (tree === BASE_TREE) {
          result.tree.push({ path: "policy\u202e", mode: "040000", type: "tree", sha: "f".repeat(40) });
        }
        return result;
      },
      readBlob: fixture.readBlob
    }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );
  assert.deepEqual(fixture.blobReads, []);
});

test("GitHub transport resolution uses fixed paths and verifies Git blob identities", async () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const contentReads = [];
  const transport = {
    getRepository: async (slug) => {
      assert.equal(slug, "0xprogrammable/submit-launch");
      return centralRepositoryResponse();
    },
    getRef: async (slug, branch) => {
      assert.equal(slug, "0xprogrammable/submit-launch");
      assert.equal(branch, "main");
      return { ref: "refs/heads/main", object: { type: "commit", sha: BASE_COMMIT } };
    },
    getGitCommit: async (slug, commit) => {
      assert.equal(slug, "0xprogrammable/submit-launch");
      assert.equal(commit, BASE_COMMIT);
      return { sha: BASE_COMMIT, tree: { sha: BASE_TREE } };
    },
    getGitTree: async (_slug, tree, options) => {
      assert.equal(_slug, "0xprogrammable/submit-launch");
      assert.deepEqual(options, { recursive: false });
      return fixture.readTree(tree);
    },
    getContent: async (slug, filePath, ref) => {
      assert.equal(slug, "0xprogrammable/submit-launch");
      assert.equal(ref, BASE_COMMIT);
      contentReads.push(filePath);
      const bytes = filePath === "policy/launch-policy.v1.json"
        ? fixture.policyBytes
        : fixture.schemaBytes;
      return contentResponse(filePath, bytes);
    }
  };

  const resolved = await resolveSubmitLaunchPolicyWithTransport({ transport });
  assert.equal(resolved.policyBinding.sha256, digest(fixture.policyBytes));
  assert.deepEqual(contentReads, [
    "policy/launch-policy.v1.json",
    "policy/schemas/launch-policy.v1.schema.json"
  ]);

  transport.getContent = async (_slug, filePath) => {
    const bytes = filePath.endsWith("schema.json") ? fixture.schemaBytes : fixture.policyBytes;
    return { ...contentResponse(filePath, bytes), sha: "f".repeat(40) };
  };
  await assert.rejects(
    () => resolveSubmitLaunchPolicyWithTransport({ transport }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );

  transport.getContent = async (_slug, filePath) => {
    const bytes = filePath.endsWith("schema.json") ? fixture.schemaBytes : fixture.policyBytes;
    return { ...contentResponse(filePath, bytes), encoding: "hex" };
  };
  await assert.rejects(
    () => resolveSubmitLaunchPolicyWithTransport({ transport }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );

  transport.getRepository = async () => ({ ...centralRepositoryResponse(), id: 999999999 });
  await assert.rejects(
    () => resolveSubmitLaunchPolicyWithTransport({ transport }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );
});

test("public policy resolution needs no gh login and keeps every request anonymous and read-only", async () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const requests = [];
  const routes = new Map([
    ["https://api.github.com/repos/0xprogrammable/submit-launch", centralPublicRepositoryResponse()],
    ["https://api.github.com/repos/0xprogrammable/submit-launch/git/ref/heads/main", {
      ref: "refs/heads/main",
      object: { type: "commit", sha: BASE_COMMIT }
    }],
    ["https://api.github.com/repos/0xprogrammable/submit-launch/git/commits/1111111111111111111111111111111111111111", {
      sha: BASE_COMMIT,
      tree: { sha: BASE_TREE }
    }],
    ["https://api.github.com/repos/0xprogrammable/submit-launch/git/trees/2222222222222222222222222222222222222222", await fixture.readTree(BASE_TREE)],
    ["https://api.github.com/repos/0xprogrammable/submit-launch/git/trees/3333333333333333333333333333333333333333", await fixture.readTree(POLICY_TREE)],
    ["https://api.github.com/repos/0xprogrammable/submit-launch/git/trees/4444444444444444444444444444444444444444", await fixture.readTree(SCHEMAS_TREE)],
    [`https://api.github.com/repos/0xprogrammable/submit-launch/git/blobs/${fixture.policyBlob}`, gitBlobResponse(fixture.policyBlob, fixture.policyBytes)],
    [`https://api.github.com/repos/0xprogrammable/submit-launch/git/blobs/${fixture.schemaBlob}`, gitBlobResponse(fixture.schemaBlob, fixture.schemaBytes)]
  ]);
  const transport = async (request) => {
    requests.push(request);
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    assert.deepEqual(Object.keys(request.headers).sort(), ["Accept", "User-Agent", "X-GitHub-Api-Version"].sort());
    assert.equal(Object.keys(request.headers).some((name) => /auth|cookie|token/iu.test(name)), false);
    assert.equal(routes.has(request.url), true, request.url);
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify(routes.get(request.url)), "utf8"),
      redirected: false,
      responseUrl: request.url
    };
  };

  const resolved = await resolveSubmitLaunchPolicyWithPublicTransport({ transport });

  assert.equal(resolved.policyBinding.sha256, digest(fixture.policyBytes));
  assert.equal(resolved.policyBinding.baseCommit, BASE_COMMIT);
  assert.equal(resolved.policyBinding.baseTree, BASE_TREE);
  assert.equal(requests.length, 8);

  const mismatchedAuthenticatedTransport = authenticatedPolicyTransport({
    getRepository: async () => ({ ...centralRepositoryResponse(), id: 999999999 })
  });
  await assert.rejects(
    () => resolveCurrentSubmitLaunchPolicy({
      authenticatedTransport: mismatchedAuthenticatedTransport,
      publicTransport: transport
    }),
    hasCode("SUBMIT_LAUNCH_CONTRACT_TRUST_ROOT_MISMATCH")
  );
  assert.equal(requests.length, 8);
});

test("manifest-first contract resolution binds one commit/tree and executes no remote code", async () => {
  const fixture = makeSubmitLaunchContractFixture({ salt: "manifest-first" });
  const resolved = await resolveCurrentSubmitLaunchContract({
    authenticatedTransport: fixture.transport,
    cacheDirectory: false,
    stage: "launch-readiness",
    routeState: "official-programmable-ethereum"
  });

  assert.equal(resolved.schemaVersion, "programmable.submit-launch-contract-snapshot.v1");
  assert.equal(resolved.snapshotBinding.baseCommit, BASE_COMMIT);
  assert.equal(resolved.snapshotBinding.baseTree, fixture.baseTree);
  assert.equal(resolved.applicationContract.current.contractId, "public-pr-application-v3.2");
  assert.deepEqual(resolved.applicationContract.legacy.map(({ contractId }) => contractId), [
    "public-pr-application-v3.1"
  ]);
  assert.equal(resolved.projectStage.status, "READY");
  assert.deepEqual(resolved.projectStage.requirementIds, [
    "LAUNCH.ETHEREUM_AND_TREASURY_10_BPS",
    "LAUNCH.ETHEREUM_ROUTER_PROVENANCE_READINESS"
  ]);
  assert.equal(Object.hasOwn(resolved, "fullSnapshot"), false);
  assert.equal(fixture.repositoryReads, 1);
  assert.equal(fixture.refReads, 2);
  assert.equal(fixture.commitReads, 1);
  assert.equal(fixture.treeReads, 1);
  assert.equal(fixture.contentReads.length, 7);
  assert.equal(fixture.contentReads.every((filePath) => filePath.endsWith(".json")), true);
  assert.equal(fixture.contentReads.some((filePath) => filePath.endsWith(".mjs")), false);
  const protectedPaths = [
    resolved.snapshotBinding.activeContractV1.path,
    resolved.snapshotBinding.activeContractV2.path,
    resolved.snapshotBinding.activeContractV2.schema.path,
    resolved.snapshotBinding.compatibility.path,
    resolved.snapshotBinding.compatibilitySchema.path,
    resolved.snapshotBinding.policy.path,
    resolved.snapshotBinding.policySchema.path
  ];
  assert.equal(new Set(protectedPaths).size, 7);
  assert.equal(resolved.snapshotBinding.policy.baseCommit, resolved.snapshotBinding.baseCommit);
  assert.equal(resolved.snapshotBinding.policy.baseTree, resolved.snapshotBinding.baseTree);
  assert.equal(resolved.snapshotBinding.policySchema.baseCommit, resolved.snapshotBinding.baseCommit);
  assert.equal(resolved.snapshotBinding.policySchema.baseTree, resolved.snapshotBinding.baseTree);

  const snapshotPreimage = structuredClone(resolved.snapshotBinding);
  delete snapshotPreimage.snapshotSha256;
  assert.equal(
    resolved.snapshotBinding.snapshotSha256,
    digest(Buffer.from(canonicalUtf8Json(snapshotPreimage), "utf8"))
  );
  const stagePreimage = structuredClone(resolved.projectStage);
  delete stagePreimage.stageSha256;
  assert.equal(
    resolved.projectStage.stageSha256,
    digest(Buffer.from(canonicalUtf8Json(stagePreimage), "utf8"))
  );

  const compatibilityProjection = await resolveCurrentSubmitLaunchPolicy({
    authenticatedTransport: fixture.transport,
    cacheDirectory: false
  });
  assert.equal(compatibilityProjection.policyBinding.baseCommit, BASE_COMMIT);
});

test("current contract options reject relative cache authority before any GitHub read", async () => {
  const fixture = makeSubmitLaunchContractFixture({ salt: "invalid-options" });
  await assert.rejects(
    () => resolveCurrentSubmitLaunchContract({
      authenticatedTransport: fixture.transport,
      cacheDirectory: "relative/cache",
      stage: "build",
      routeState: "unresolved"
    }),
    hasCode("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID")
  );
  assert.equal(fixture.repositoryReads, 0);
  assert.equal(fixture.refReads, 0);
});

test("stage projection is route-aware and unknown handlers affect only their stage", async () => {
  const fixture = makeSubmitLaunchContractFixture({ salt: "stage-table" });
  const resolve = (stage, routeState) => resolveCurrentSubmitLaunchContract({
    authenticatedTransport: fixture.transport,
    cacheDirectory: false,
    stage,
    routeState
  });
  assert.equal((await resolve("build", "unresolved")).projectStage.status, "READY");
  assert.equal((await resolve("submit", "unresolved")).projectStage.status, "READY");
  assert.equal((await resolve("launch-readiness", "no-market")).projectStage.status, "NOT_APPLICABLE");
  assert.equal((await resolve("launch-readiness", "external")).projectStage.status, "NOT_APPLICABLE");
  assert.equal((await resolve("launch-readiness", "unresolved")).projectStage.status, "INTEGRATION_PENDING");
  assert.equal(
    (await resolve("production-promotion", "official-programmable-ethereum")).projectStage.status,
    "PROFILE_DISABLED"
  );

  const unknown = makeSubmitLaunchContractFixture({
    salt: "unknown-handler",
    readinessHandlerId: "future-router-readiness-v9"
  });
  const readiness = await resolveCurrentSubmitLaunchContract({
    authenticatedTransport: unknown.transport,
    cacheDirectory: false,
    stage: "launch-readiness",
    routeState: "official-programmable-ethereum"
  });
  const build = await resolveCurrentSubmitLaunchContract({
    authenticatedTransport: unknown.transport,
    cacheDirectory: false,
    stage: "build",
    routeState: "unresolved"
  });
  assert.equal(readiness.projectStage.status, "INTEGRATION_PENDING");
  assert.deepEqual(readiness.projectStage.unknownHandlerIds, ["future-router-readiness-v9"]);
  assert.equal(build.projectStage.status, "READY");
  assert.deepEqual(build.projectStage.unknownHandlerIds, []);
});

test("resolution deduplicates promises, retries one moving ref, and emits an exact drift receipt", async () => {
  const deduped = makeSubmitLaunchContractFixture({ salt: "dedupe" });
  const options = {
    authenticatedTransport: deduped.transport,
    cacheDirectory: false,
    stage: "submit",
    routeState: "unresolved"
  };
  const [left, right] = await Promise.all([
    resolveCurrentSubmitLaunchContract(options),
    resolveCurrentSubmitLaunchContract(options)
  ]);
  assert.equal(left, right);
  assert.equal(deduped.refReads, 2);
  const receipt = await assertCurrentSubmitLaunchContractCurrent(left.snapshotBinding, {
    authenticatedTransport: deduped.transport
  });
  assert.equal(receipt.status, "CURRENT");
  assert.equal(receipt.snapshotSha256, left.snapshotBinding.snapshotSha256);
  const tamperedBinding = structuredClone(left.snapshotBinding);
  tamperedBinding.compatibility.sha256 = `sha256:${"9".repeat(64)}`;
  await assert.rejects(
    () => assertCurrentSubmitLaunchContractCurrent(tamperedBinding, {
      authenticatedTransport: deduped.transport
    }),
    hasCode("SUBMIT_LAUNCH_CONTRACT_OPTIONS_INVALID")
  );
  deduped.setCommit("9".repeat(40));
  await assert.rejects(
    () => assertCurrentSubmitLaunchContractCurrent(left.snapshotBinding, {
      authenticatedTransport: deduped.transport
    }),
    hasCode("SUBMIT_LAUNCH_CONTRACT_DRIFT")
  );

  const moving = makeSubmitLaunchContractFixture({
    salt: "one-retry",
    refSequence: [BASE_COMMIT, "8".repeat(40), "8".repeat(40), "8".repeat(40)]
  });
  const retried = await resolveCurrentSubmitLaunchContract({
    authenticatedTransport: moving.transport,
    cacheDirectory: false,
    stage: "build",
    routeState: "unresolved"
  });
  assert.equal(retried.currentness.retryCount, 1);
  assert.equal(retried.snapshotBinding.baseCommit, "8".repeat(40));
  assert.equal(moving.repositoryReads, 1);
  assert.equal(moving.refReads, 4);
  assert.equal(moving.commitReads, 2);
  assert.equal(moving.treeReads, 1);

  const unstable = makeSubmitLaunchContractFixture({
    salt: "unstable",
    refSequence: [BASE_COMMIT, "7".repeat(40), "6".repeat(40), "5".repeat(40)]
  });
  await assert.rejects(
    () => resolveCurrentSubmitLaunchContract({
      authenticatedTransport: unstable.transport,
      cacheDirectory: false,
      stage: "build",
      routeState: "unresolved"
    }),
    hasCode("SUBMIT_LAUNCH_CONTRACT_UNSTABLE")
  );
});

test("verified cache reuse and offline preflight preserve stage-specific semantics", async () => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "submit-launch-contract-cache-"));
  const fixture = makeSubmitLaunchContractFixture({ salt: "cache" });
  try {
    const first = await resolveCurrentSubmitLaunchContract({
      authenticatedTransport: fixture.transport,
      cacheDirectory,
      stage: "build",
      routeState: "unresolved"
    });
    const contentReads = fixture.contentReads.length;
    const coldCounts = {
      repository: fixture.repositoryReads,
      refs: fixture.refReads,
      commits: fixture.commitReads,
      trees: fixture.treeReads,
      blobs: fixture.contentReads.length
    };
    const second = await resolveCurrentSubmitLaunchContract({
      authenticatedTransport: fixture.transport,
      cacheDirectory,
      stage: "build",
      routeState: "unresolved"
    });
    assert.equal(first.snapshotBinding.snapshotSha256, second.snapshotBinding.snapshotSha256);
    assert.equal(second.currentness.cacheStatus, "HIT");
    assert.equal(fixture.contentReads.length, contentReads);
    assert.deepEqual(coldCounts, { repository: 1, refs: 2, commits: 1, trees: 1, blobs: 7 });
    assert.equal(Object.values(coldCounts).reduce((sum, count) => sum + count, 0), 12);
    const warmCounts = {
      repository: fixture.repositoryReads - coldCounts.repository,
      refs: fixture.refReads - coldCounts.refs,
      commits: fixture.commitReads - coldCounts.commits,
      trees: fixture.treeReads - coldCounts.trees,
      blobs: fixture.contentReads.length - coldCounts.blobs
    };
    assert.deepEqual(warmCounts, { repository: 1, refs: 2, commits: 1, trees: 0, blobs: 0 });
    assert.equal(Object.values(warmCounts).reduce((sum, count) => sum + count, 0), 4);
  } finally {
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }

  const unavailable = authenticatedPolicyTransport({
    getRepository: async () => {
      throw Object.assign(new Error("offline"), { code: "GITHUB_GET_RETRY_EXHAUSTED" });
    }
  });
  const publicTransport = async () => {
    throw new Error("offline");
  };
  const build = await preflightCurrentSubmitLaunchRequirements({
    authenticatedTransport: unavailable,
    publicTransport,
    cacheDirectory: false,
    stage: "build",
    repositoryRoot: "/ignored/consumer/context",
    source: "submit-project"
  });
  const submit = await preflightCurrentSubmitLaunchRequirements({
    authenticatedTransport: unavailable,
    publicTransport,
    cacheDirectory: false,
    stage: "submit"
  });
  assert.equal(build.ok, true);
  assert.equal(build.projectStage.status, "POLICY_UNRESOLVED");
  assert.equal(submit.ok, false);
});

test("verified cache ignores corrupted files and symlink substitutions", async () => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "submit-launch-cache-tamper-"));
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "submit-launch-cache-outside-"));
  try {
    const expected = Buffer.from("expected protected JSON bytes\n", "utf8");
    const expectedOid = gitBlobOid(expected);
    const corruptTarget = path.join(
      cacheDirectory,
      "git-blobs-v1",
      expectedOid.slice(0, 2),
      expectedOid.slice(2)
    );
    fs.mkdirSync(path.dirname(corruptTarget), { recursive: true, mode: 0o700 });
    fs.writeFileSync(corruptTarget, Buffer.from("tampered\n", "utf8"), { mode: 0o600 });
    const corruptCache = createSubmitLaunchVerifiedCache({ directory: cacheDirectory });
    assert.equal(await corruptCache.read(expectedOid, 1024), null);

    const linked = Buffer.from("different expected JSON bytes\n", "utf8");
    const linkedOid = gitBlobOid(linked);
    const linkedTarget = path.join(
      cacheDirectory,
      "git-blobs-v1",
      linkedOid.slice(0, 2),
      linkedOid.slice(2)
    );
    const outside = path.join(outsideDirectory, "outside.bin");
    fs.mkdirSync(path.dirname(linkedTarget), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outside, linked, { mode: 0o600 });
    fs.symlinkSync(outside, linkedTarget);
    const symlinkCache = createSubmitLaunchVerifiedCache({ directory: cacheDirectory });
    assert.equal(await symlinkCache.read(linkedOid, 1024), null);
  } finally {
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
});

test("recursive tree discovery rejects truncation and oversized responses before blob reads", async () => {
  const truncated = makeSubmitLaunchContractFixture({ salt: "truncated-recursive-tree" });
  const readTruncatedTree = truncated.transport.getGitTree;
  truncated.transport.getGitTree = async (...args) => ({
    ...await readTruncatedTree(...args),
    truncated: true
  });
  await assert.rejects(
    () => resolveCurrentSubmitLaunchContract({
      authenticatedTransport: truncated.transport,
      cacheDirectory: false,
      stage: "build",
      routeState: "unresolved"
    }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );
  assert.equal(truncated.contentReads.length, 0);

  const oversized = makeSubmitLaunchContractFixture({ salt: "oversized-recursive-tree" });
  const readOversizedTree = oversized.transport.getGitTree;
  oversized.transport.getGitTree = async (...args) => ({
    ...await readOversizedTree(...args),
    padding: "x".repeat(8 * 1024 * 1024)
  });
  await assert.rejects(
    () => resolveCurrentSubmitLaunchContract({
      authenticatedTransport: oversized.transport,
      cacheDirectory: false,
      stage: "build",
      routeState: "unresolved"
    }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );
  assert.equal(oversized.contentReads.length, 0);
});

test("binding comparison reports policy drift for any exact policy or schema change", () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const first = makeResolvedContract(fixture);
  const changedPolicy = structuredClone(first.policyBinding);
  changedPolicy.sha256 = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => assertSubmitLaunchPolicyBindingsEqual({
      expectedPolicyBinding: first.policyBinding,
      observedPolicyBinding: changedPolicy,
      expectedPolicySchemaBinding: first.policySchemaBinding,
      observedPolicySchemaBinding: first.policySchemaBinding
    }),
    hasCode("POLICY_DRIFT")
  );

  const changedSchema = structuredClone(first.policySchemaBinding);
  changedSchema.sha256 = `sha256:${"e".repeat(64)}`;
  assert.throws(
    () => assertSubmitLaunchPolicyBindingsEqual({
      expectedPolicyBinding: first.policyBinding,
      observedPolicyBinding: first.policyBinding,
      expectedPolicySchemaBinding: first.policySchemaBinding,
      observedPolicySchemaBinding: changedSchema
    }),
    hasCode("POLICY_DRIFT")
  );
});

test("fixed transport rejects a branch ref and commit response that disagree", async () => {
  const fixture = makeSubmitLaunchPolicyFixture();
  const transport = {
    getRepository: async () => centralRepositoryResponse(),
    getRef: async () => ({ ref: "refs/heads/main", object: { type: "commit", sha: BASE_COMMIT } }),
    getGitCommit: async () => ({ sha: "9".repeat(40), tree: { sha: BASE_TREE } }),
    getGitTree: async (_slug, tree) => fixture.readTree(tree),
    getContent: async (_slug, filePath) => contentResponse(
      filePath,
      filePath.endsWith("schema.json") ? fixture.schemaBytes : fixture.policyBytes
    )
  };
  await assert.rejects(
    () => resolveSubmitLaunchPolicyWithTransport({ transport }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );
  assert.deepEqual(fixture.treeReads, []);
});

function makeSubmitLaunchContractFixture({
  salt = "default",
  readinessHandlerId = "programmable-router-readiness-v1",
  refSequence = []
} = {}) {
  const legacy = makeSubmitLaunchPolicyFixture();
  const checkerAuthority = structuredClone(legacy.policy.profiles[0].authority);
  const disabledAuthority = {
    checkerOnly: false,
    independentAudit: false,
    launchAuthorized: false,
    productionDiscoveryAllowed: false,
    publicRoutingAllowed: false,
    realUserFundsAllowed: false
  };
  const policy = structuredClone(legacy.policy);
  policy.effective.startsAt = "2026-08-20T00:00:00Z";
  policy.policyVersion = "2.0.0";
  policy.profiles = [
    { authority: checkerAuthority, enabled: true, id: "build", outcome: "BUILT_NOT_REVIEWED" },
    {
      authority: checkerAuthority,
      enabled: true,
      id: "launch-readiness",
      outcome: "LAUNCH_READINESS_CHECKED_NOT_AUTHORIZED"
    },
    { authority: disabledAuthority, enabled: false, id: "production-launch", outcome: null },
    { authority: checkerAuthority, enabled: true, id: "workflow-canary", outcome: "CANARY_WORKFLOW_PASSED" }
  ];
  policy.rules = [
    {
      applicability: { equals: true, field: "routerProvenanceRequired", mode: "when" },
      enforcement: { handlerId: "ethereum-treasury-10-bps-v1", mode: "deterministic", owner: "platform" },
      evidence: ["programmable-launch-requirement"],
      id: "LAUNCH.ETHEREUM_AND_TREASURY_10_BPS",
      introducedIn: "1.3.0",
      parameters: {
        basis: "gross-canonical-pool-volume",
        chainId: 1,
        hundredthsOfBip: 1000,
        network: "ethereum-mainnet",
        treasury: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c"
      },
      profiles: ["launch-readiness", "production-launch"],
      requirement: `Route the manifest-bound fee for ${salt}.`,
      retiredIn: null,
      severity: "blocker",
      status: "active"
    },
    {
      applicability: { equals: true, field: "routerProvenanceRequired", mode: "when" },
      enforcement: { handlerId: readinessHandlerId, mode: "deterministic", owner: "applicant" },
      evidence: ["programmable-router-readiness"],
      id: "LAUNCH.ETHEREUM_ROUTER_PROVENANCE_READINESS",
      introducedIn: "2.0.0",
      parameters: {
        chainId: 1,
        discoveryDocumentUrl: "https://developers.programmable.family/.well-known/programmable.json",
        launchEntryPoint: "launchAndStampV1",
        routerManifestPointer: "/launchStampRouter"
      },
      profiles: ["launch-readiness", "production-launch"],
      requirement: "Bind the exact reviewed revision to canonical Router evidence.",
      retiredIn: null,
      severity: "blocker",
      status: "active"
    },
    {
      applicability: { equals: true, field: "routerProvenanceRequired", mode: "when" },
      enforcement: { handlerId: "programmable-router-promotion-v1", mode: "deterministic", owner: "platform" },
      evidence: ["programmable-router-promotion"],
      id: "LAUNCH.ETHEREUM_FINALIZED_ROUTER_STAMP_BEFORE_PROMOTION",
      introducedIn: "2.0.0",
      parameters: {
        chainId: 1,
        discoveryDocumentUrl: "https://developers.programmable.family/.well-known/programmable.json",
        promotionTargets: ["api-v2", "indexer", "public-discovery", "registry"],
        routerManifestPointer: "/launchStampRouter"
      },
      profiles: ["production-launch"],
      requirement: "Require finalized Router evidence before promotion.",
      retiredIn: null,
      severity: "blocker",
      status: "active"
    }
  ];
  const policySchema = structuredClone(legacy.schema);
  policySchema.properties.profiles.minItems = 4;
  policySchema.properties.profiles.maxItems = 4;
  policySchema.$comment = salt;
  const policyBytes = Buffer.from(`${canonicalJson(policy)}\n`);
  const policySchemaBytes = Buffer.from(`${JSON.stringify(policySchema, null, 2)}\n`);
  const activeV2Schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:programmable:active-contract-manifest:2.0.0",
    $comment: salt,
    type: "object"
  };
  const compatibilitySchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:programmable:applicant-compatibility:2.0.0",
    $comment: salt,
    type: "object"
  };
  const activeV2SchemaBytes = Buffer.from(`${JSON.stringify(activeV2Schema)}\n`);
  const compatibilitySchemaBytes = Buffer.from(`${JSON.stringify(compatibilitySchema)}\n`);
  const compatibility = {
    $schema: "urn:programmable:applicant-compatibility:2.0.0",
    application: {
      current: {
        contractId: "public-pr-application-v3.2",
        path: "intake/schemas/public-pr-application-v3.2.schema.json",
        sha256: `sha256:${"a".repeat(64)}`
      },
      legacy: [{
        contractId: "public-pr-application-v3.1",
        path: "intake/schemas/public-pr-application-v3.schema.json",
        sha256: `sha256:${"b".repeat(64)}`
      }]
    },
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
        schema: {
          contractId: "programmable-launch-router-readiness-v1",
          path: "intake/schemas/programmable-launch-router-readiness-v1.schema.json",
          sha256: `sha256:${"c".repeat(64)}`
        },
        validatorClosure: {
          algorithm: "sha256-path-nul-size-nul-content-nul-v1",
          closureSha256: digest(Buffer.from(salt, "utf8")),
          files: [
            {
              path: "scripts/programmable-launch-router-readiness-core.mjs",
              sha256: `sha256:${"e".repeat(64)}`
            },
            {
              path: "scripts/programmable-launch-router-readiness.mjs",
              sha256: `sha256:${"7".repeat(64)}`
            },
            {
              path: "vendor/programmable-applicant-validator/scripts/evm-encoding-core.mjs",
              sha256: `sha256:${"8".repeat(64)}`
            },
            {
              path: "vendor/programmable-v4-hook-builder/scripts/github-public-source-lossless-json.mjs",
              sha256: `sha256:${"9".repeat(64)}`
            }
          ]
        }
      },
      submission: {
        contractId: "open-world-submission-v2.1",
        path: "intake/schemas/open-world-submission-v2.1.schema.json",
        sha256: `sha256:${"f".repeat(64)}`
      },
      tradeCapabilityManifest: {
        contractId: "trade-capability-manifest-v2",
        path: "intake/schemas/trade-capability-manifest-v2.schema.json",
        sha256: `sha256:${"1".repeat(64)}`
      }
    },
    trustedRepository: { defaultBranch: "main", numericId: "1320171831" }
  };
  const compatibilityBytes = Buffer.from(`${JSON.stringify(compatibility)}\n`);
  const v2 = {
    $schema: "urn:programmable:active-contract-manifest:2.0.0",
    artifacts: {
      package: [
        binding(".programmable/applicant-compatibility.v2.json", compatibilityBytes),
        binding("intake/schemas/active-contract-manifest-v2.schema.json", activeV2SchemaBytes),
        binding("intake/schemas/applicant-compatibility-v2.schema.json", compatibilitySchemaBytes),
        compatibility.application.current,
        ...compatibility.application.legacy,
        compatibility.supportingContracts.routerReadiness.schema,
        compatibility.supportingContracts.submission,
        compatibility.supportingContracts.tradeCapabilityManifest,
        binding("policy/schemas/launch-policy.v1.schema.json", policySchemaBytes)
      ].map(({ contractId: _contractId, ...artifact }) => artifact),
      policy: [binding("policy/launch-policy.v1.json", policyBytes)],
      validator: [{ path: "scripts/active-contract-manifest-core.mjs", sha256: `sha256:${"2".repeat(64)}` }],
      workflow: [{ path: ".github/workflows/verify-hook-builder.yml", sha256: `sha256:${"3".repeat(64)}` }]
    },
    contractId: "submit-launch",
    defaultBranch: "main",
    kind: "programmable-active-contract",
    schemaVersion: "2.0.0"
  };
  const v2Bytes = Buffer.from(`${JSON.stringify(v2)}\n`);
  const v1 = {
    $schema: "urn:programmable:active-contract-manifest:1.0.0",
    artifacts: {
      package: [{ path: "intake/schemas/public-pr-application-v3.schema.json", sha256: `sha256:${"4".repeat(64)}` }],
      policy: [binding(".programmable/active-contract.v2.json", v2Bytes)],
      validator: [{ path: "scripts/verify-public-hook-application.mjs", sha256: `sha256:${"5".repeat(64)}` }],
      workflow: [{ path: ".github/workflows/legacy.yml", sha256: `sha256:${"6".repeat(64)}` }]
    },
    contractId: "submit-launch",
    defaultBranch: "main",
    kind: "programmable-active-contract",
    schemaVersion: "1.0.0"
  };
  const documents = new Map([
    [".programmable/active-contract.json", Buffer.from(`${JSON.stringify(v1)}\n`)],
    [".programmable/active-contract.v2.json", v2Bytes],
    [".programmable/applicant-compatibility.v2.json", compatibilityBytes],
    ["intake/schemas/active-contract-manifest-v2.schema.json", activeV2SchemaBytes],
    ["intake/schemas/applicant-compatibility-v2.schema.json", compatibilitySchemaBytes],
    ["policy/launch-policy.v1.json", policyBytes],
    ["policy/schemas/launch-policy.v1.schema.json", policySchemaBytes]
  ]);
  const git = buildFlatGitFixture(documents);
  let repositoryReads = 0;
  let refReads = 0;
  let commitReads = 0;
  let treeReads = 0;
  let currentCommit = BASE_COMMIT;
  const commits = [...refSequence];
  const contentReads = [];
  const transport = {
    async getRepository() {
      repositoryReads += 1;
      return centralRepositoryResponse();
    },
    async getRef() {
      refReads += 1;
      const commit = commits.length > 0 ? commits.shift() : currentCommit;
      currentCommit = commit;
      return { ref: "refs/heads/main", object: { type: "commit", sha: commit } };
    },
    async getGitCommit(_slug, commit) {
      commitReads += 1;
      return { sha: commit, tree: { sha: git.rootTree } };
    },
    async getGitTree(_slug, tree, options) {
      treeReads += 1;
      assert.equal(tree, git.rootTree);
      assert.deepEqual(options, { recursive: true });
      return structuredClone(git.recursiveTree);
    },
    async getContent(_slug, filePath) {
      contentReads.push(filePath);
      return contentResponse(filePath, documents.get(filePath));
    }
  };
  return {
    transport,
    baseTree: git.rootTree,
    contentReads,
    get repositoryReads() { return repositoryReads; },
    get refReads() { return refReads; },
    get commitReads() { return commitReads; },
    get treeReads() { return treeReads; },
    setCommit(commit) {
      currentCommit = commit;
      commits.length = 0;
    }
  };
}

function binding(filePath, bytes) {
  return { path: filePath, sha256: digest(bytes) };
}

function buildFlatGitFixture(documents) {
  const root = { children: new Map(), path: "" };
  for (const [filePath, bytes] of documents) {
    const segments = filePath.split("/");
    let node = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index];
      if (!node.children.has(name)) {
        const childPath = node.path === "" ? name : `${node.path}/${name}`;
        node.children.set(name, {
          children: new Map(),
          path: childPath
        });
      }
      node = node.children.get(name);
    }
    node.children.set(segments.at(-1), { blob: gitBlobOid(bytes) });
  }
  const recursiveEntries = [];
  const visit = (node) => {
    const entries = [];
    for (const [name, child] of node.children) {
      if (child.children !== undefined) {
        const childTree = visit(child);
        child.tree = childTree;
        entries.push({ path: name, mode: "040000", type: "tree", sha: child.tree });
      } else {
        entries.push({ path: name, mode: "100644", type: "blob", sha: child.blob });
      }
    }
    const tree = testTreeOid(entries);
    for (const entry of entries) {
      recursiveEntries.push({
        ...entry,
        path: node.path === "" ? entry.path : `${node.path}/${entry.path}`
      });
    }
    return tree;
  };
  const rootTree = visit(root);
  return {
    rootTree,
    recursiveTree: { sha: rootTree, truncated: false, tree: recursiveEntries }
  };
}

function testTreeOid(entries) {
  const sorted = [...entries].sort((left, right) => Buffer.compare(
    Buffer.from(`${left.path}${left.type === "tree" ? "/" : ""}`, "utf8"),
    Buffer.from(`${right.path}${right.type === "tree" ? "/" : ""}`, "utf8")
  ));
  const payload = Buffer.concat(sorted.flatMap((entry) => [
    Buffer.from(`${entry.mode === "040000" ? "40000" : entry.mode} ${entry.path}\0`, "utf8"),
    Buffer.from(entry.sha, "hex")
  ]));
  return crypto.createHash("sha1").update(`tree ${payload.length}\0`, "utf8").update(payload).digest("hex");
}

function makeResolvedContract(fixture) {
  const parsed = parseSubmitLaunchPolicyContract({
    policyBytes: fixture.policyBytes,
    schemaBytes: fixture.schemaBytes
  });
  return {
    policyBinding: {
      schemaVersion: "programmable.launch-policy-binding.v1",
      repository: "0xprogrammable/submit-launch",
      numericRepositoryId: "1320171831",
      baseCommit: BASE_COMMIT,
      baseTree: BASE_TREE,
      path: "policy/launch-policy.v1.json",
      gitBlobOid: fixture.policyBlob,
      policyId: parsed.policy.policyId,
      policyVersion: parsed.policy.policyVersion,
      profileId: "workflow-canary",
      sha256: digest(fixture.policyBytes)
    },
    policySchemaBinding: {
      schemaVersion: "programmable.submit-launch-policy-schema-binding.v1",
      repository: "0xprogrammable/submit-launch",
      numericRepositoryId: "1320171831",
      baseCommit: BASE_COMMIT,
      baseTree: BASE_TREE,
      path: "policy/schemas/launch-policy.v1.schema.json",
      gitBlobOid: fixture.schemaBlob,
      schemaId: fixture.schema.$id,
      sha256: digest(fixture.schemaBytes)
    }
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function centralRepositoryResponse() {
  return {
    id: 1320171831,
    full_name: "0xprogrammable/submit-launch",
    html_url: "https://github.com/0xprogrammable/submit-launch",
    private: false,
    fork: false,
    default_branch: "main",
    owner: { id: 309941960, login: "0xprogrammable" },
    permissions: {}
  };
}

function authenticatedPolicyTransport(overrides = {}) {
  return {
    getRepository: async () => centralRepositoryResponse(),
    getRef: async () => ({ ref: "refs/heads/main", object: { type: "commit", sha: BASE_COMMIT } }),
    getGitCommit: async () => ({ sha: BASE_COMMIT, tree: { sha: BASE_TREE } }),
    getGitTree: async () => ({ sha: BASE_TREE, truncated: false, tree: [] }),
    getContent: async () => null,
    ...overrides
  };
}

function centralPublicRepositoryResponse() {
  return {
    id: 1320171831,
    full_name: "0xprogrammable/submit-launch",
    html_url: "https://github.com/0xprogrammable/submit-launch",
    private: false,
    visibility: "public",
    default_branch: "main"
  };
}

function gitBlobResponse(sha, bytes) {
  return {
    sha,
    size: bytes.length,
    encoding: "base64",
    content: bytes.toString("base64")
  };
}

function readAuthoritativeFixture(name, expectedSha256) {
  const bytes = fs.readFileSync(path.join(authoritativeFixtureDirectory, name));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), expectedSha256);
  return bytes;
}

function gitBlobOid(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function canonicalUtf8Json(value) {
  return JSON.stringify(sortUtf8(value));
}

function sortUtf8(value) {
  if (Array.isArray(value)) return value.map(sortUtf8);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
      .map((key) => [key, sortUtf8(value[key])])
  );
}
