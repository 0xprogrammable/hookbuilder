import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildWorkflowCanaryApplication,
  parseAndBindWorkflowCanaryApplicationSchema
} from "../../skills/programmable-v4-hook-builder/scripts/workflow-canary-application-client.mjs";
import { canonicalJson } from "../../skills/programmable-v4-hook-builder/scripts/submission-core.mjs";
import { CliFailure } from "../../skills/programmable-v4-hook-builder/scripts/cli-runtime.mjs";
import {
  prepareWorkflowCanary,
  resolveAuthenticatedGitHubBuilder,
  resolveFreshGitHubSourceHead
} from "../../skills/programmable-v4-hook-builder/scripts/prepare-canary.mjs";
import { gitBlob, digest } from "./submit-launch-policy-fixture.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaBytes = fs.readFileSync(path.join(
  testDirectory,
  "fixtures",
  "submit-launch-policy",
  "workflow-canary-application-v1.schema.json"
));
const baseCommit = "a".repeat(40);
const baseTree = "b".repeat(40);
const cliPath = path.join(testDirectory, "..", "..", "skills", "programmable-v4-hook-builder", "scripts", "cli.mjs");

test("builds exactly one canonical hidden workflow-canary application from protected schema bytes", () => {
  const schemaRecord = parseAndBindWorkflowCanaryApplicationSchema({
    baseCommit,
    baseTree,
    schemaBytes,
    schemaGitBlobOid: gitBlob(schemaBytes)
  });
  const application = buildWorkflowCanaryApplication({
    applicationId: "example-hook",
    applicationRevision: 1,
    builder: { githubLogin: "example", githubUserId: "9007199254740993" },
    source: {
      repository: "example/example-hook",
      numericRepositoryId: "12345678901234567",
      commit: "c".repeat(40),
      tree: "d".repeat(40)
    },
    expectedPolicyBinding: policyBinding(),
    title: "Example Hook",
    summary: "A hidden workflow test for the exact public source revision."
  }, schemaRecord);

  assert.deepEqual(application.declarations, {
    hiddenFromPublicRoutingAndDiscovery: true,
    independentAudit: false,
    productionRouting: false,
    realUserFunds: false
  });
  assert.equal(`${canonicalJson(application)}\n`.endsWith("\n"), true);
  assert.equal(schemaRecord.binding.path, "canary/schemas/workflow-canary-application-v1.schema.json");
  assert.equal(schemaRecord.binding.sha256, digest(schemaBytes));
});

test("rejects caller authority fields, invalid text and altered protected schema identity", () => {
  const schemaRecord = parseAndBindWorkflowCanaryApplicationSchema({
    baseCommit,
    baseTree,
    schemaBytes,
    schemaGitBlobOid: gitBlob(schemaBytes)
  });
  const valid = {
    applicationId: "example-hook",
    applicationRevision: 1,
    builder: { githubLogin: "example", githubUserId: "1" },
    source: {
      repository: "example/example-hook",
      numericRepositoryId: "2",
      commit: "c".repeat(40),
      tree: "d".repeat(40)
    },
    expectedPolicyBinding: policyBinding(),
    title: "Example Hook",
    summary: "Exact hidden workflow canary."
  };
  assert.throws(
    () => buildWorkflowCanaryApplication({ ...valid, declarations: {} }, schemaRecord),
    hasCode("CANARY_APPLICATION_ARGUMENTS_INVALID")
  );
  assert.throws(
    () => buildWorkflowCanaryApplication({ ...valid, title: " bad" }, schemaRecord),
    hasCode("CANARY_APPLICATION_INVALID")
  );
  const changed = Buffer.from(schemaBytes);
  changed[changed.indexOf(Buffer.from("programmable.money"))] = "x".charCodeAt(0);
  assert.throws(
    () => parseAndBindWorkflowCanaryApplicationSchema({
      baseCommit,
      baseTree,
      schemaBytes: changed,
      schemaGitBlobOid: gitBlob(changed)
    }),
    hasCode("CANARY_APPLICATION_SCHEMA_INVALID")
  );
  const unsafeSchema = JSON.parse(schemaBytes.toString("utf8"));
  unsafeSchema.properties.title.pattern = "^(a+)+$";
  const unsafeSchemaBytes = Buffer.from(JSON.stringify(unsafeSchema), "utf8");
  assert.throws(
    () => parseAndBindWorkflowCanaryApplicationSchema({
      baseCommit,
      baseTree,
      schemaBytes: unsafeSchemaBytes,
      schemaGitBlobOid: gitBlob(unsafeSchemaBytes)
    }),
    hasCode("CANARY_APPLICATION_SCHEMA_INVALID")
  );
});

test("prepare-canary previews exact bytes and keeps acknowledged automated writing fail-closed", async (t) => {
  const fixture = makePreparationFixture(t);
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  assert.equal(preview.status, "PREVIEW_READY");
  assert.match(preview.planDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(preview.canonicalApplicationJson, `${canonicalJson(preview.application)}\n`);
  assert.equal(preview.localWritePerformed, false);
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
  assert.equal(fixture.stabilityChecks, 0);

  await assert.rejects(
    prepareWorkflowCanary({ ...fixture.options(), write: true }, fixture.dependencies()),
    hasCode("LOCAL_WRITE_ACKNOWLEDGEMENT_REQUIRED")
  );
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: preview.planDigest
    }, fixture.dependencies()),
    hasCode("LOCAL_WRITE_UNAVAILABLE")
  );
  assert.equal(fixture.stabilityChecks, 1);
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("programmatic dependencies cannot override the fail-closed local-write boundary", async (t) => {
  const fixture = makePreparationFixture(t);
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  let overrideCalled = false;
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: preview.planDigest
    }, {
      ...fixture.dependencies(),
      outputMaterializer() {
        overrideCalled = true;
      }
    }),
    hasCode("INTERNAL_ERROR")
  );
  assert.equal(overrideCalled, false);
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("policy drift and acknowledgement mismatch fail before any local write", async (t) => {
  const fixture = makePreparationFixture(t);
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: `sha256:${"0".repeat(64)}`
    }, fixture.dependencies()),
    hasCode("LOCAL_WRITE_PLAN_CHANGED")
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);

  fixture.failStability = true;
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: preview.planDigest
    }, fixture.dependencies()),
    hasCode("POLICY_DRIFT")
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("an acknowledged preview cannot write after its output parent is replaced", async (t) => {
  const fixture = makePreparationFixture(t);
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  const parent = path.dirname(fixture.outputDirectory);
  fs.renameSync(parent, `${parent}-stale`);
  fs.mkdirSync(parent);
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: preview.planDigest
    }, fixture.dependencies()),
    hasCode("LOCAL_WRITE_PLAN_CHANGED")
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("prepare-canary exposes no caller-selected builder or source authority flags", () => {
  for (const forbidden of ["--builder-json", "--source-json", "--base", "--revision"]) {
    const result = childProcess.spawnSync(process.execPath, [cliPath, "prepare-canary", "example-hook", forbidden, "x"], {
      cwd: testDirectory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(result.status, 2);
    const failure = JSON.parse(result.stderr || result.stdout);
    assert.equal(failure.command, "prepare-canary");
    assert.equal(failure.error.code, "USAGE_ERROR");
  }
});

test("uses the authenticated GitHub actor when the exact public source belongs to an organization", async (t) => {
  const fixture = makePreparationFixture(t, { sourceOwner: "example-org", builderLogin: "example-builder" });
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  assert.equal(preview.application.builder.githubLogin, "example-builder");
  assert.equal(preview.application.source.repository, "example-org/example-hook");
  assert.notEqual(preview.application.builder.githubLogin, preview.application.source.repository.split("/")[0]);
});

test("fresh configured GitHub upstream drift fails before any acknowledged local write", async (t) => {
  const fixture = makePreparationFixture(t);
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  fixture.driftHeadAfterRead = fixture.sourceHeadChecks + 2;
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: preview.planDigest
    }, fixture.dependencies()),
    hasCode("SOURCE_DRIFT")
  );
  assert.equal(fixture.sourceHeadChecks, 3);
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("stale local upstream tracking state cannot produce a preview", async (t) => {
  const fixture = makePreparationFixture(t);
  fixture.driftHeadAfterRead = 1;
  await assert.rejects(
    prepareWorkflowCanary(fixture.options(), fixture.dependencies()),
    hasCode("HEAD_NOT_PUSHED")
  );
  assert.equal(fixture.sourceHeadChecks, 1);
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("local source drift during final remote checks produces no file", async (t) => {
  const fixture = makePreparationFixture(t);
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  fixture.mutateSourceAfterHeadRead = fixture.sourceHeadChecks + 2;
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: preview.planDigest
    }, fixture.dependencies()),
    hasCode("SOURCE_DRIFT")
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("output parent drift during final remote checks produces no file", async (t) => {
  const fixture = makePreparationFixture(t);
  const preview = await prepareWorkflowCanary(fixture.options(), fixture.dependencies());
  fixture.replaceOutputParentDuringStability = true;
  await assert.rejects(
    prepareWorkflowCanary({
      ...fixture.options(),
      write: true,
      acknowledgeLocalWrite: preview.planDigest
    }, fixture.dependencies()),
    hasCode("OUTPUT_PARENT_CHANGED")
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("assume-unchanged and skip-worktree flags cannot hide local source drift", async (t) => {
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
    await t.test(flag, async (t) => {
      const fixture = makePreparationFixture(t);
      runGit(fixture.repositoryRoot, ["update-index", flag, "README.md"]);
      fs.writeFileSync(path.join(fixture.repositoryRoot, "README.md"), `hidden by ${flag}\n`);
      await assert.rejects(
        prepareWorkflowCanary(fixture.options(), fixture.dependencies()),
        hasCode("WORKTREE_NOT_CLEAN")
      );
      assert.equal(fs.existsSync(fixture.outputDirectory), false);
    });
  }
});

test("submodule ignore configuration cannot hide a dirty checked-out source", async (t) => {
  const fixture = makePreparationFixture(t);
  const submoduleSource = path.join(path.dirname(fixture.repositoryRoot), "submodule-source");
  fs.mkdirSync(submoduleSource);
  runGit(submoduleSource, ["init", "-b", "main"]);
  runGit(submoduleSource, ["config", "user.name", "Fixture"]);
  runGit(submoduleSource, ["config", "user.email", "fixture@example.invalid"]);
  fs.writeFileSync(path.join(submoduleSource, "README.md"), "submodule\n");
  runGit(submoduleSource, ["add", "README.md"]);
  runGit(submoduleSource, ["commit", "-m", "fixture submodule"]);
  runGit(fixture.repositoryRoot, [
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    submoduleSource,
    "vendor/submodule"
  ]);
  runGit(fixture.repositoryRoot, ["commit", "-am", "add fixture submodule"]);
  runGit(fixture.repositoryRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  runGit(fixture.repositoryRoot, ["config", "submodule.vendor/submodule.ignore", "all"]);
  fs.writeFileSync(path.join(fixture.repositoryRoot, "vendor/submodule/README.md"), "dirty submodule\n");

  await assert.rejects(
    prepareWorkflowCanary(fixture.options(), fixture.dependencies()),
    hasCode("WORKTREE_NOT_CLEAN")
  );
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test("authenticated builder resolution reads only the current gh viewer identity", async () => {
  let reads = 0;
  const builder = await resolveAuthenticatedGitHubBuilder({
    transport: {
      async getViewer() {
        reads += 1;
        return { id: 1234567, login: "example-builder", html_url: "https://github.com/example-builder" };
      }
    }
  });
  assert.deepEqual(builder, {
    githubLogin: "example-builder",
    githubUserId: "1234567",
    profileUrl: "https://github.com/example-builder"
  });
  assert.equal(reads, 1);
});

test("fresh GitHub source head binds repository id, configured ref, commit and tree", async () => {
  const calls = [];
  const commit = "c".repeat(40);
  const tree = "d".repeat(40);
  const head = await resolveFreshGitHubSourceHead({
    transport: {
      async getRef(slug, branch) {
        calls.push(["ref", slug, branch]);
        return { ref: "refs/heads/release", object: { type: "commit", sha: commit } };
      },
      async getGitCommit(slug, revision) {
        calls.push(["commit", slug, revision]);
        return { sha: commit, tree: { sha: tree } };
      }
    },
    source: {
      repositorySlug: "example-org/example-hook",
      repositoryId: "12345678901234567",
      commit,
      tree
    },
    snapshot: {
      upstreamBranch: "release",
      mergeRef: "refs/heads/release",
      commit,
      tree
    }
  });
  assert.deepEqual(head, {
    repositorySlug: "example-org/example-hook",
    repositoryId: "12345678901234567",
    upstreamBranch: "release",
    refName: "refs/heads/release",
    commit,
    tree
  });
  assert.deepEqual(calls, [
    ["ref", "example-org/example-hook", "release"],
    ["commit", "example-org/example-hook", commit]
  ]);
});

function policyBinding() {
  return {
    schemaVersion: "programmable.launch-policy-binding.v1",
    repository: "0xprogrammable/submit-launch",
    numericRepositoryId: "1320171831",
    baseCommit,
    baseTree,
    path: "policy/launch-policy.v1.json",
    gitBlobOid: "e".repeat(40),
    policyId: "programmable-central-launch-policy",
    policyVersion: "1.1.0",
    profileId: "workflow-canary",
    sha256: `sha256:${"f".repeat(64)}`
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function makePreparationFixture(t, { sourceOwner = "example", builderLogin = "example" } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "programmable-canary-client-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "source");
  const outputParent = path.join(root, "output", "canary-submissions");
  const outputDirectory = path.join(outputParent, "example-hook");
  fs.mkdirSync(repositoryRoot, { recursive: true });
  fs.mkdirSync(outputParent, { recursive: true });
  runGit(repositoryRoot, ["init", "-b", "main"]);
  runGit(repositoryRoot, ["config", "user.name", "Fixture"]);
  runGit(repositoryRoot, ["config", "user.email", "fixture@example.invalid"]);
  fs.writeFileSync(path.join(repositoryRoot, "README.md"), "fixture\n");
  runGit(repositoryRoot, ["add", "README.md"]);
  runGit(repositoryRoot, ["commit", "-m", "fixture"]);
  runGit(repositoryRoot, ["remote", "add", "origin", `https://github.com/${sourceOwner}/example-hook.git`]);
  runGit(repositoryRoot, ["config", "branch.main.remote", "origin"]);
  runGit(repositoryRoot, ["config", "branch.main.merge", "refs/heads/main"]);
  runGit(repositoryRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const commit = runGit(repositoryRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const tree = runGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
  const schemaRecord = parseAndBindWorkflowCanaryApplicationSchema({
    baseCommit,
    baseTree,
    schemaBytes,
    schemaGitBlobOid: gitBlob(schemaBytes)
  });
  const fixture = {
    repositoryRoot,
    outputDirectory,
    stabilityChecks: 0,
    sourceHeadChecks: 0,
    driftHeadAfterRead: null,
    mutateSourceAfterHeadRead: null,
    replaceOutputParentDuringStability: false,
    failStability: false,
    options() {
      return {
        repositoryRoot,
        applicationId: "example-hook",
        title: "Example Hook",
        summary: "A hidden workflow test for the exact public source revision.",
        outputDirectory,
        write: false,
        acknowledgeLocalWrite: null
      };
    },
    dependencies() {
      return {
        authenticatedBuilderResolver: async () => ({
          githubLogin: builderLogin,
          githubUserId: "9007199254740993",
          profileUrl: `https://github.com/${builderLogin}`
        }),
        publicSourceResolver: async () => ({
          repositorySlug: `${sourceOwner}/example-hook`,
          repositoryId: "12345678901234567",
          commit,
          tree,
          publicRepositoryReachable: true,
          publicCommitReachable: true
        }),
        sourceHeadResolver: async ({ source, snapshot }) => {
          fixture.sourceHeadChecks += 1;
          if (fixture.sourceHeadChecks === fixture.mutateSourceAfterHeadRead) {
            fs.writeFileSync(path.join(repositoryRoot, "source-drift.txt"), "drift\n");
          }
          return {
            repositorySlug: source.repositorySlug,
            repositoryId: source.repositoryId,
            upstreamBranch: snapshot.upstreamBranch,
            refName: snapshot.mergeRef,
            commit: fixture.sourceHeadChecks === fixture.driftHeadAfterRead ? "e".repeat(40) : commit,
            tree
          };
        },
        centralBaseResolver: async () => ({
          repositorySlug: "0xprogrammable/submit-launch",
          baseBranch: "main",
          baseCommit,
          baseTree,
          policyBinding: policyBinding(),
          policySchemaBinding: {
            schemaVersion: "programmable.submit-launch-policy-schema-binding.v1",
            repository: "0xprogrammable/submit-launch",
            numericRepositoryId: "1320171831",
            baseCommit,
            baseTree,
            path: "policy/schemas/launch-policy.v1.schema.json",
            gitBlobOid: "1".repeat(40),
            schemaId: "https://programmable.money/schemas/launch-policy.v1.schema.json",
            sha256: `sha256:${"2".repeat(64)}`
          },
          canaryApplicationSchema: schemaRecord,
          canaryApplicationSchemaBinding: schemaRecord.binding,
          applicationDirectory: "canary-submissions/example-hook",
          applicationPath: "canary-submissions/example-hook/application.json",
          canaryApplicationExists: false
        }),
        centralBaseStabilityChecker: async () => {
          fixture.stabilityChecks += 1;
          if (fixture.failStability) throw new CliFailure("POLICY_DRIFT", "fixture drift", { exitCode: 1 });
          if (fixture.replaceOutputParentDuringStability) {
            const parent = path.dirname(outputDirectory);
            fs.renameSync(parent, `${parent}-stale`);
            fs.mkdirSync(parent);
          }
          return true;
        }
      };
    }
  };
  return fixture;
}

function runGit(repositoryRoot, args) {
  const result = childProcess.spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
