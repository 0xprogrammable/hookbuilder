import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  assertCentralBaseUnchanged,
  deriveApplicationRevision,
  resolveCentralApplicationBase
} from "../cli-central-base.mjs";
import { CENTRAL_APPLICATION_FILES } from "../cli-central-package.mjs";
import { CliFailure } from "../cli-runtime.mjs";
import { canonicalJson } from "../submission-core.mjs";
import {
  canonicalApplicationBytes,
  canonicalLaunchBytes
} from "../autonomous-admission-contract.mjs";

const baseCommit = "a".repeat(40);
const baseTree = "b".repeat(40);
const movedCommit = "c".repeat(40);
const primaryCommit = "d".repeat(40);
const primaryTree = "e".repeat(40);
const builderIdentity = Object.freeze({ githubUserId: "9007199254740993", githubLogin: "example" });

test("resolves a first revision from the fixed central ref and immutable tree without credentials", async () => {
  const fixture = createCentralFetch();
  const observed = await resolveCentralApplicationBase({
    baseBranch: "main",
    applicationId: "example-app",
    fetchImplementation: fixture.fetch,
    sleepImplementation: async () => {}
  });

  assert.equal(observed.repositorySlug, "0xprogrammable/programmable");
  assert.equal(observed.baseCommit, baseCommit);
  assert.equal(observed.baseTree, baseTree);
  assert.equal(observed.existingApplication, false);
  assert.equal(observed.priorApplication, null);
  assert.equal(observed.priorCentralPackage, null);
  assert.equal(deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: null,
    nextBuilder: builderIdentity,
    nextSource: makeSource()
  }), 1);
  assert.equal(fixture.calls.length, 3);
  for (const { options } of fixture.calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "User-Agent", "X-GitHub-Api-Version"].sort());
  }
});

test("loads one exact canonical prior package and derives the next revision", async () => {
  const prior = makePriorPackage({ applicationRevision: 7 });
  const fixture = createCentralFetch({ files: prior.files });
  const observed = await resolveCentralApplicationBase({
    baseBranch: "main",
    applicationId: "example-app",
    fetchImplementation: fixture.fetch,
    sleepImplementation: async () => {}
  });

  assert.equal(observed.existingApplication, true);
  assert.equal(observed.priorApplicationRevision, 7);
  assert.deepEqual(observed.priorCentralPackage.fileOrder, CENTRAL_APPLICATION_FILES);
  assert.deepEqual(
    observed.priorCentralPackage.files.map(({ content }) => content),
    CENTRAL_APPLICATION_FILES.map((name) => prior.files.get(name).toString("utf8"))
  );

  const nextSource = makeSource({
    primary: makeRepository({ commit: "f".repeat(40), tree: "1".repeat(40) })
  });
  assert.equal(deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: observed.priorApplication,
    nextBuilder: builderIdentity,
    nextSource
  }), 8);
});

test("rejects malformed autonomous prior bytes even when Git blob identities are self-consistent", async () => {
  const prior = makePriorPackage();
  prior.files.set("launch.json", Buffer.from("{}"));
  const fixture = createCentralFetch({ files: prior.files });
  await rejectsCode(
    () => resolveCentralApplicationBase({
      baseBranch: "main",
      applicationId: "example-app",
      fetchImplementation: fixture.fetch,
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_INVALID"
  );

  const noncanonical = makePriorPackage();
  const application = JSON.parse(noncanonical.files.get("application.json").toString("utf8"));
  noncanonical.files.set("application.json", Buffer.from(`${JSON.stringify(application, null, 2)}\n`));
  await rejectsCode(
    () => resolveCentralApplicationBase({
      baseBranch: "main",
      applicationId: "example-app",
      fetchImplementation: createCentralFetch({ files: noncanonical.files }).fetch,
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_INVALID"
  );
});

test("accepts source revision changes but blocks unchanged or replaced source lineages", () => {
  const companionBefore = makeRepository({
    id: "22",
    uri: "https://github.com/example/companion",
    commit: "2".repeat(40),
    tree: "3".repeat(40)
  });
  const priorSource = makeSource({ companions: [companionBefore] });
  const prior = makePriorPackage({ source: priorSource, applicationRevision: 3 }).application;
  const companionAfter = makeRepository({
    id: "22",
    uri: "https://github.com/example/companion",
    commit: "4".repeat(40),
    tree: "5".repeat(40)
  });

  assert.equal(deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: { ...builderIdentity, githubLogin: "renamed-example" },
    nextSource: makeSource({ companions: [companionAfter] })
  }), 4);
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: priorSource
  }), "SOURCE_REVISION_UNCHANGED");
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: makeSource({
      primary: makeRepository({ uri: "https://github.com/renamed/project" }),
      companions: [companionBefore]
    })
  }), "PRIMARY_SOURCE_LINEAGE_CHANGED");
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: makeSource({
      primary: makeRepository({ id: "999", commit: "6".repeat(40), tree: "7".repeat(40) }),
      companions: [companionBefore]
    })
  }), "PRIMARY_SOURCE_LINEAGE_CHANGED");
});

test("detects a central base ref move before materialization", async () => {
  const fixture = createCentralFetch({ refCommits: [baseCommit, movedCommit] });
  const observed = await resolveCentralApplicationBase({
    baseBranch: "main",
    applicationId: "example-app",
    fetchImplementation: fixture.fetch,
    sleepImplementation: async () => {}
  });
  await rejectsCode(
    () => assertCentralBaseUnchanged({
      observation: observed,
      fetchImplementation: fixture.fetch,
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_MOVED"
  );
});

test("rejects unsafe central branch input before network access", async () => {
  let fetches = 0;
  await rejectsCode(
    () => resolveCentralApplicationBase({
      baseBranch: "refs/heads/main",
      applicationId: "example-app",
      fetchImplementation: async () => {
        fetches += 1;
        throw new Error("must not fetch");
      },
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_INVALID"
  );
  assert.equal(fetches, 0);
});

function makePriorPackage({ applicationRevision = 1, source = makeSource() } = {}) {
  const files = new Map([
    ["launch.json", canonicalLaunchBytes(makeLaunch())],
    ["PROPOSAL.md", Buffer.from("# Proposal\nA substantive canonical proposal body for central revision testing.\n")],
    ["TEST_PLAN.md", Buffer.from("# Test plan\nA substantive canonical test plan body for central revision testing.\n")],
    ["THREAT_MODEL.md", Buffer.from("# Threat model\nA substantive canonical threat model body for central revision testing.\n")],
    ["compatibility-report.json", Buffer.from("{\"result\":\"test\"}\n")],
    ["evidence-index.json", Buffer.from("{\"evidence\":[]}\n")]
  ]);
  const sourceRecords = [source.primary, ...source.companions];
  const githubSources = sourceRecords.map((repository, index) => {
    const parsed = new URL(repository.repositoryUri);
    return {
      sourceId: index === 0 ? "source:primary" : `source:companion-${index}`,
      ownerHint: parsed.pathname.split("/")[1],
      repositoryHint: parsed.pathname.split("/")[2],
      repositoryIdHint: repository.numericRepositoryId,
      requestedRevisionHint: repository.revisionObjectId,
      visibilityHint: "public",
      purposeHint: index === 0 ? "project.primary" : "project.companion",
      executionRoots: ["."],
      rightsDeclaration: {
        basis: "applicant-original",
        licenseBindings: [],
        authorizationGrantId: null
      }
    };
  });
  const application = {
    schemaVersion: "1.0.0",
    applicationId: "example-app",
    applicationRevision,
    project: {
      title: "Example App",
      summary: "A sufficiently complete summary for deterministic central revision tests."
    },
    primarySourceId: "source:primary",
    githubSources,
    chainProfileRequests: [{
      requestId: "chain:launch",
      namespaceHint: "eip155",
      referenceHint: "1",
      profileHint: "ethereum-mainnet-v1"
    }],
    components: [{
      componentId: "component:root",
      kindHint: "evm.contract",
      summary: "Canonical root deployment target.",
      sourceIds: ["source:primary"],
      chainRequestIds: ["chain:launch"],
      visibilityHint: "public-source",
      reviewRelevanceHint: "unknown"
    }],
    capabilityHints: [{
      capabilityId: "capability:project",
      kindHint: "project.source-defined",
      summary: "Deploy the canonical root target.",
      componentIds: ["component:root"],
      chainRequestIds: ["chain:launch"],
      movesUserValueHint: null,
      controlsUserValueHint: null
    }]
  };
  files.set("application.json", canonicalApplicationBytes(application));
  return {
    application,
    files: new Map(CENTRAL_APPLICATION_FILES.map((name) => [name, files.get(name)]))
  };
}

function makeLaunch() {
  return {
    schemaVersion: "programmable.launch-specification.v1",
    applicationId: "example-app",
    language: "solidity",
    compiler: {
      profileId: "programmable:solidity-solc-0.8.26-v1",
      family: "solc",
      version: "0.8.26",
      settings: {}
    },
    chain: { namespace: "eip155", reference: "1", profileId: "ethereum-mainnet-v1" },
    launcher: { route: { kind: "evm.create2", adapterId: "adapter:create2" } },
    rootComponentId: "component:root",
    rootTargetId: "target:root",
    components: [{
      componentId: "component:root",
      kind: "evm.contract",
      sourceIds: ["source:primary"],
      targetIds: ["target:root"],
      attributes: {}
    }],
    targets: [{
      targetId: "target:root",
      componentId: "component:root",
      sourceId: "source:primary",
      sourceUnitName: "src/Root.sol",
      sourceSha256: `sha256:${"1".repeat(64)}`,
      contractName: "Root",
      deploymentMode: "create2",
      saltStrategy: "compiler-deterministic-v1",
      deploymentValueWei: "0",
      constructor: { abiEncodedArguments: "0x", addressLocators: [] },
      initializer: null,
      initializerValueWei: "0",
      libraries: [],
      declaredHookPermissions: null
    }],
    edges: [],
    externalOnchainDependencies: [],
    internalChildDeployments: [],
    releaseModules: [],
    declaredIdentities: [],
    extensions: {}
  };
}

function makeSource({ primary = makeRepository(), companions = [] } = {}) {
  return {
    schemaVersion: "1.0.0",
    primary,
    companions
  };
}

function makeRepository({
  id = "11",
  uri = "https://github.com/example/project",
  commit = primaryCommit,
  tree = primaryTree
} = {}) {
  return {
    repositoryUri: uri,
    numericRepositoryId: id,
    revisionObjectId: commit,
    treeObjectId: tree,
    sourcePaths: [],
    contractPaths: [],
    githubActionsRunIds: []
  };
}

function createCentralFetch({ files = null, refCommits = [baseCommit] } = {}) {
  const calls = [];
  let refReads = 0;
  const submissionsTree = "7".repeat(40);
  const applicationTree = "8".repeat(40);
  const blobs = files === null
    ? new Map()
    : new Map([...files].map(([name, bytes]) => [name, { bytes, sha: gitBlobDigest(bytes) }]));
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const prefix = "https://api.github.com/repos/0xprogrammable/programmable";
    if (url === `${prefix}/git/ref/heads/main`) {
      const commit = refCommits[Math.min(refReads, refCommits.length - 1)];
      refReads += 1;
      return response(200, {
        ref: "refs/heads/main",
        object: { type: "commit", sha: commit }
      });
    }
    if (url === `${prefix}/git/commits/${baseCommit}`) {
      return response(200, { sha: baseCommit, tree: { sha: baseTree } });
    }
    if (url === `${prefix}/git/trees/${baseTree}`) {
      return response(200, {
        sha: baseTree,
        truncated: false,
        tree: files === null ? [] : [treeEntry("submissions", "040000", "tree", submissionsTree)]
      });
    }
    if (url === `${prefix}/git/trees/${submissionsTree}`) {
      return response(200, {
        sha: submissionsTree,
        truncated: false,
        tree: [treeEntry("example-app", "040000", "tree", applicationTree)]
      });
    }
    if (url === `${prefix}/git/trees/${applicationTree}`) {
      return response(200, {
        sha: applicationTree,
        truncated: false,
        tree: CENTRAL_APPLICATION_FILES.map((name) => treeEntry(name, "100644", "blob", blobs.get(name).sha))
      });
    }
    for (const { bytes, sha } of blobs.values()) {
      if (url === `${prefix}/git/blobs/${sha}`) {
        return response(200, { sha, encoding: "base64", content: bytes.toString("base64") });
      }
    }
    throw new Error(`unexpected central URL: ${url}`);
  };
  return { calls, fetch };
}

function treeEntry(path, mode, type, sha) {
  return { path, mode, type, sha };
}

function response(status, value) {
  const source = canonicalJson(value);
  return {
    status,
    redirected: false,
    url: "",
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-length") return String(Buffer.byteLength(source));
        if (name.toLowerCase() === "content-type") return "application/json";
        return null;
      }
    },
    async arrayBuffer() {
      return Buffer.from(source);
    }
  };
}

function gitBlobDigest(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

async function rejectsCode(operation, code) {
  await assert.rejects(Promise.resolve().then(operation), (error) => {
    assert.ok(error instanceof CliFailure, error?.stack ?? String(error));
    assert.equal(error.code, code);
    return true;
  });
}

function rejectsSyncCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof CliFailure, error?.stack ?? String(error));
    assert.equal(error.code, code);
    return true;
  });
}
