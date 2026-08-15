import crypto from "node:crypto";

import { canonicalJson } from "../../skills/programmable-v4-hook-builder/scripts/submission-core.mjs";

export function makeSubmitLaunchPolicyFixture({
  baseTree = "2".repeat(40),
  policyTree = "3".repeat(40),
  schemasTree = "4".repeat(40),
  policyVersion = "1.0.0"
} = {}) {
  const authority = {
    checkerOnly: true,
    independentAudit: false,
    launchAuthorized: false,
    productionDiscoveryAllowed: false,
    publicRoutingAllowed: false,
    realUserFundsAllowed: false
  };
  const policy = {
    effective: { startsAt: "2026-08-13T00:00:00Z", state: "current" },
    migration: {
      emergencyAction: null,
      openApplications: "re-evaluate-current-policy",
      previouslyAcceptedRevisions: "preserve-unless-explicit-emergency"
    },
    policyId: "programmable-central-launch-policy",
    policyVersion,
    profiles: [
      { authority, enabled: true, id: "build", outcome: "BUILT_NOT_REVIEWED" },
      {
        authority: {
          checkerOnly: false,
          independentAudit: false,
          launchAuthorized: false,
          productionDiscoveryAllowed: false,
          publicRoutingAllowed: false,
          realUserFundsAllowed: false
        },
        enabled: false,
        id: "production-launch",
        outcome: null
      },
      { authority, enabled: true, id: "workflow-canary", outcome: "CANARY_WORKFLOW_PASSED" }
    ],
    repository: {
      branch: "main",
      name: "0xprogrammable/submit-launch",
      numericRepositoryId: "1320171831",
      path: "policy/launch-policy.v1.json"
    },
    rules: [{
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
    }],
    schemaVersion: "programmable.launch-policy.v1"
  };
  const schema = fixtureSchema();
  const policyBytes = Buffer.from(`${canonicalJson(policy)}\n`);
  const schemaBytes = Buffer.from(`${JSON.stringify(schema, null, 2)}\n`);
  const policyBlob = gitBlob(policyBytes);
  const schemaBlob = gitBlob(schemaBytes);
  const treeReads = [];
  const blobReads = [];
  const trees = new Map([
    [baseTree, [treeEntry("policy", "040000", "tree", policyTree)]],
    [policyTree, [
      treeEntry("launch-policy.v1.json", "100644", "blob", policyBlob),
      treeEntry("schemas", "040000", "tree", schemasTree)
    ]],
    [schemasTree, [treeEntry("launch-policy.v1.schema.json", "100644", "blob", schemaBlob)]]
  ]);
  const blobs = new Map([[policyBlob, policyBytes], [schemaBlob, schemaBytes]]);
  return {
    policy,
    schema,
    policyBytes,
    schemaBytes,
    policyBlob,
    schemaBlob,
    policyTree,
    schemasTree,
    treeReads,
    blobReads,
    trees,
    blobs,
    async readTree(tree) {
      treeReads.push(tree);
      return { sha: tree, truncated: false, tree: structuredClone(trees.get(tree)) };
    },
    async readBlob(blob) {
      blobReads.push(blob);
      return Buffer.from(blobs.get(blob));
    }
  };
}

export function fixtureSchema() {
  const profile = {
    type: "object",
    required: ["authority", "enabled", "id", "outcome"],
    properties: {
      authority: { type: "object" },
      enabled: { type: "boolean" },
      id: { type: "string" },
      outcome: { type: ["string", "null"] }
    }
  };
  return {
    $id: "https://programmable.money/schemas/launch-policy.v1.schema.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: {
      semver: { type: "string", pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" },
      policyId: { type: "string", pattern: "^[a-z0-9][a-z0-9.-]{2,79}$" },
      timestamp: { type: "string", pattern: "^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$" },
      ruleId: { type: "string", pattern: "^[A-Z][A-Z0-9_]*(\\.[A-Z][A-Z0-9_]*)+$" },
      evidenceId: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,79}$" },
      fieldPath: { type: "string", pattern: "^[a-z][A-Za-z0-9]*(\\.[a-z][A-Za-z0-9]*)*$" }
    },
    type: "object",
    additionalProperties: false,
    required: [
      "effective", "migration", "policyId", "policyVersion", "profiles", "repository", "rules", "schemaVersion"
    ],
    properties: {
      effective: { type: "object" },
      migration: { type: "object" },
      policyId: { type: "string" },
      policyVersion: { type: "string" },
      profiles: { type: "array", minItems: 3, maxItems: 3, items: profile },
      repository: { type: "object" },
      rules: { type: "array", minItems: 1 },
      schemaVersion: { const: "programmable.launch-policy.v1" }
    }
  };
}

export function treeEntry(path, mode, type, sha) {
  return { path, mode, type, sha };
}

export function contentResponse(filePath, bytes) {
  return {
    type: "file",
    path: filePath,
    encoding: "base64",
    content: bytes.toString("base64"),
    size: bytes.length,
    sha: gitBlob(bytes)
  };
}

export function gitBlob(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
