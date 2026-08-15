import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
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
  resolveCurrentSubmitLaunchPolicy,
  resolveSubmitLaunchPolicyFromVerifiedGitObjects,
  resolveSubmitLaunchPolicyWithPublicTransport,
  resolveSubmitLaunchPolicyWithTransport
} from "../../skills/programmable-v4-hook-builder/scripts/submit-launch-policy-github.mjs";
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

  const unavailableAuthenticatedTransport = authenticatedPolicyTransport({
    getRepository: async () => {
      throw Object.assign(new Error("authenticated read unavailable"), { code: "GITHUB_GET_RETRY_EXHAUSTED" });
    }
  });
  const fallback = await resolveCurrentSubmitLaunchPolicy({
    authenticatedTransport: unavailableAuthenticatedTransport,
    publicTransport: transport
  });
  assert.equal(fallback.policyBinding.sha256, digest(fixture.policyBytes));
  assert.equal(requests.length, 16);

  const mismatchedAuthenticatedTransport = authenticatedPolicyTransport({
    getRepository: async () => ({ ...centralRepositoryResponse(), id: 999999999 })
  });
  await assert.rejects(
    () => resolveCurrentSubmitLaunchPolicy({
      authenticatedTransport: mismatchedAuthenticatedTransport,
      publicTransport: transport
    }),
    hasCode("SUBMIT_LAUNCH_POLICY_GIT_OBJECT_INVALID")
  );
  assert.equal(requests.length, 16);
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
