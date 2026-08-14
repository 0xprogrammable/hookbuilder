#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseCli, renderHelp } from "./cli-args.mjs";
import {
  assertCentralCanaryBaseUnchanged,
  resolveCentralCanaryBase
} from "./cli-central-canary-base.mjs";
import {
  parseGitHubRemote,
  resolvePublicGitHubSource
} from "./cli-github-source.mjs";
import {
  normalizeGitCommit,
  normalizeRef,
  normalizeViewer
} from "./github-application-normalizers.mjs";
import {
  normalizeApiId,
  requireBranch,
  requireRepositorySlug
} from "./github-application-primitives.mjs";
import { createGhTransport } from "./github-application-transport-core.mjs";
import { preflightCentralPackageOutput } from "./cli-output-dir.mjs";
import {
  assertOutputOutsideRepository,
  resolveRoot
} from "./cli-prepare-pr-preflight.mjs";
import { git, runGit } from "./cli-prepare-pr-transport.mjs";
import { CliFailure, emitFailure, emitSuccess } from "./cli-runtime.mjs";
import { canonicalJson } from "./submission-core.mjs";
import {
  buildWorkflowCanaryApplication,
  canonicalWorkflowCanaryApplicationBytes
} from "./workflow-canary-application-client.mjs";

const COMMAND = "prepare-canary";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPTIONS = Object.freeze([
  "acknowledgeLocalWrite",
  "applicationId",
  "outputDirectory",
  "repositoryRoot",
  "summary",
  "title",
  "write"
]);
const DEPENDENCIES = new Set([
  "authenticatedBuilderResolver",
  "centralBaseResolver",
  "centralBaseStabilityChecker",
  "fetchImplementation",
  "gitImplementation",
  "githubTransport",
  "publicSourceResolver",
  "sourceHeadResolver",
  "sleepImplementation"
]);

export async function prepareWorkflowCanary(options, dependencies = {}) {
  requireExactObject(options, OPTIONS, "USAGE_ERROR");
  if (!isPlainObject(dependencies) || Object.keys(dependencies).some((key) => !DEPENDENCIES.has(key))) {
    throw new CliFailure("INTERNAL_ERROR", "prepare-canary dependencies are closed");
  }
  const {
    repositoryRoot: repositoryRootInput,
    applicationId,
    title,
    summary,
    outputDirectory,
    write,
    acknowledgeLocalWrite
  } = options;
  if (typeof write !== "boolean") usage("write mode must be an explicit boolean");
  if (acknowledgeLocalWrite !== null && !DIGEST.test(acknowledgeLocalWrite ?? "")) {
    usage("--acknowledge-local-write requires one sha256 plan digest");
  }
  if (!write && acknowledgeLocalWrite !== null) {
    usage("--acknowledge-local-write is accepted only together with --write");
  }
  const repositoryRoot = resolveRoot(repositoryRootInput);
  const gitImplementation = dependencies.gitImplementation ?? runGit;
  const initialSource = inspectExactPushedSource(repositoryRoot, gitImplementation);
  const output = preflightCentralPackageOutput({
    outputDirectory,
    baseDirectory: repositoryRoot,
    applicationId
  });
  assertOutputOutsideRepository(repositoryRoot, output.targetDirectory);
  const outputObservation = observeOutput(output);
  const configuredGitHub = parseGitHubRemote(initialSource.remoteUrl);
  const sharedNetwork = {
    fetchImplementation: dependencies.fetchImplementation ?? globalThis.fetch,
    sleepImplementation: dependencies.sleepImplementation ?? sleep
  };
  const githubTransport = dependencies.githubTransport ?? createGhTransport();
  const authenticatedBuilderResolver = dependencies.authenticatedBuilderResolver ?? resolveAuthenticatedGitHubBuilder;
  const publicSourceResolver = dependencies.publicSourceResolver ?? resolvePublicGitHubSource;
  const sourceHeadResolver = dependencies.sourceHeadResolver ?? resolveFreshGitHubSourceHead;
  const centralBaseResolver = dependencies.centralBaseResolver ?? resolveCentralCanaryBase;
  const centralBaseStabilityChecker = dependencies.centralBaseStabilityChecker ?? assertCentralCanaryBaseUnchanged;
  const [builder, publicSource, central] = await Promise.all([
    authenticatedBuilderResolver({ transport: githubTransport }),
    resolveCanarySource({
      publicSourceResolver,
      configuredGitHub,
      snapshot: initialSource,
      sharedNetwork
    }),
    centralBaseResolver({ applicationId, ...sharedNetwork })
  ]);
  const source = bindFreshSourceHead(
    publicSource,
    await sourceHeadResolver({ transport: githubTransport, source: publicSource, snapshot: initialSource }),
    initialSource,
    "HEAD_NOT_PUSHED"
  );
  if (central.canaryApplicationExists === true) {
    throw new CliFailure("CANARY_APPLICATION_EXISTS", "the protected canary application path is already occupied", { exitCode: 1 });
  }
  const application = buildWorkflowCanaryApplication({
    applicationId,
    applicationRevision: 1,
    builder: { githubLogin: builder.githubLogin, githubUserId: builder.githubUserId },
    source: {
      repository: source.repositorySlug,
      numericRepositoryId: source.repositoryId,
      commit: source.commit,
      tree: source.tree
    },
    expectedPolicyBinding: central.policyBinding,
    title,
    summary
  }, central.canaryApplicationSchema);
  const applicationBytes = canonicalWorkflowCanaryApplicationBytes(
    application,
    central.canaryApplicationSchema
  );
  const plan = buildPlan({
    application,
    applicationBytes,
    builder,
    source,
    central,
    output: outputObservation
  });

  if (!write) return result("PREVIEW_READY", plan, application, applicationBytes);
  if (acknowledgeLocalWrite === null) {
    throw new CliFailure(
      "LOCAL_WRITE_ACKNOWLEDGEMENT_REQUIRED",
      "rerun the current read-only preview and pass its exact digest with --write --acknowledge-local-write",
      { exitCode: 1, details: { planDigest: plan.planDigest } }
    );
  }
  if (acknowledgeLocalWrite !== plan.planDigest) {
    throw new CliFailure("LOCAL_WRITE_PLAN_CHANGED", "the acknowledged local-write plan is not the freshly resolved plan", {
      exitCode: 1,
      details: { planDigest: plan.planDigest }
    });
  }

  const finalSourceSnapshot = assertSourceSnapshotUnchanged(repositoryRoot, gitImplementation, initialSource);
  const [finalBuilder, finalPublicSource, finalSourceHead] = await Promise.all([
    authenticatedBuilderResolver({ transport: githubTransport }),
    resolveCanarySource({
      publicSourceResolver,
      configuredGitHub,
      snapshot: finalSourceSnapshot,
      sharedNetwork
    }),
    sourceHeadResolver({ transport: githubTransport, source, snapshot: finalSourceSnapshot }),
    centralBaseStabilityChecker({ observation: central, ...sharedNetwork })
  ]);
  const finalSource = bindFreshSourceHead(
    finalPublicSource,
    finalSourceHead,
    finalSourceSnapshot,
    "SOURCE_DRIFT"
  );
  if (
    canonicalJson(finalBuilder) !== canonicalJson(builder)
    || canonicalJson(sourceIdentity(finalSource)) !== canonicalJson(sourceIdentity(source))
  ) {
    throw new CliFailure("SOURCE_DRIFT", "public builder or source identity changed before the local canary write", { exitCode: 1 });
  }
  assertSourceSnapshotUnchanged(repositoryRoot, gitImplementation, initialSource);
  return materializeWorkflowCanaryApplication({
    repositoryRoot,
    outputDirectory,
    applicationId,
    applicationBytes,
    expectedOutput: outputObservation
  });
}

export async function resolveAuthenticatedGitHubBuilder({ transport }) {
  if (transport === null || typeof transport !== "object" || typeof transport.getViewer !== "function") {
    throw new CliFailure("GITHUB_AUTH_REQUIRED", "prepare-canary requires the current authenticated GitHub actor", { exitCode: 1 });
  }
  const viewer = normalizeViewer(await transport.getViewer());
  return Object.freeze({
    githubLogin: viewer.login,
    githubUserId: viewer.id,
    profileUrl: viewer.url
  });
}

export async function resolveFreshGitHubSourceHead({ transport, source, snapshot }) {
  if (
    transport === null
    || typeof transport !== "object"
    || typeof transport.getRef !== "function"
    || typeof transport.getGitCommit !== "function"
  ) {
    throw new CliFailure("GITHUB_AUTH_REQUIRED", "prepare-canary requires fresh GitHub upstream reads", { exitCode: 1 });
  }
  const repositorySlug = requireRepositorySlug(source?.repositorySlug, "public source repository");
  const repositoryId = normalizeApiId(source?.repositoryId, "public source repository id");
  const upstreamBranch = requireBranch(snapshot?.upstreamBranch, "configured source upstream branch");
  const refName = `refs/heads/${upstreamBranch}`;
  if (snapshot?.mergeRef !== refName) {
    throw new CliFailure("UPSTREAM_REQUIRED", "configured source upstream ref changed", { exitCode: 1 });
  }
  const ref = normalizeRef(await transport.getRef(repositorySlug, upstreamBranch), upstreamBranch);
  const commit = normalizeGitCommit(
    await transport.getGitCommit(repositorySlug, ref.commit),
    "configured GitHub upstream commit"
  );
  if (commit.sha !== ref.commit) {
    throw new CliFailure("GITHUB_OUTPUT_INVALID", "GitHub upstream commit response names a different commit", { exitCode: 1 });
  }
  return Object.freeze({
    repositorySlug,
    repositoryId,
    upstreamBranch,
    refName,
    commit: ref.commit,
    tree: commit.tree
  });
}

export function materializeWorkflowCanaryApplication({
  repositoryRoot,
  outputDirectory,
  applicationId,
  applicationBytes,
  expectedOutput
}) {
  if (!(Buffer.isBuffer(applicationBytes) || applicationBytes instanceof Uint8Array)) {
    throw new CliFailure("OUTPUT_PACKAGE_INVALID", "canary application output requires exact bytes", { exitCode: 1 });
  }
  const bytes = Buffer.from(applicationBytes);
  const plan = preflightCentralPackageOutput({ outputDirectory, baseDirectory: repositoryRoot, applicationId });
  assertOutputOutsideRepository(repositoryRoot, plan.targetDirectory);
  const currentOutput = observeOutput(plan);
  if (canonicalJson(currentOutput) !== canonicalJson(expectedOutput)) {
    throw new CliFailure("OUTPUT_PARENT_CHANGED", "canary output parent changed after the acknowledged preview", { exitCode: 1 });
  }
  throw new CliFailure(
    "LOCAL_WRITE_UNAVAILABLE",
    "automated canary materialization is disabled until a bundled portable descriptor-bound writer is available",
    {
      exitCode: 1,
      details: {
        writePerformed: false,
        repositoryPath: `canary-submissions/${applicationId}/application.json`,
        byteLength: bytes.length,
        sha256: digest(bytes)
      }
    }
  );
}

function inspectExactPushedSource(repositoryRoot, gitImplementation) {
  let realRoot;
  try {
    realRoot = fs.realpathSync(repositoryRoot);
  } catch {
    realRoot = null;
  }
  const topLevel = git(repositoryRoot, ["rev-parse", "--show-toplevel"], gitImplementation, {
    code: "REPOSITORY_REQUIRED",
    message: "prepare-canary requires the exact Git worktree root"
  });
  if (realRoot === null || fs.realpathSync(topLevel) !== realRoot) {
    throw new CliFailure("REPOSITORY_REQUIRED", "prepare-canary requires the exact Git worktree root", { exitCode: 1 });
  }
  const status = git(repositoryRoot, [
    "status",
    "--porcelain=v2",
    "--untracked-files=all",
    "--ignore-submodules=none"
  ], gitImplementation);
  const indexState = git(repositoryRoot, ["ls-files", "-v"], gitImplementation);
  const hiddenIndexState = indexState.split("\n").some((line) => line !== "" && !line.startsWith("H "));
  if (status !== "" || hiddenIndexState) {
    throw new CliFailure("WORKTREE_NOT_CLEAN", "prepare-canary requires a clean source worktree", { exitCode: 1 });
  }
  const branch = requireBranch(
    git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitImplementation, {
      code: "BRANCH_REQUIRED", message: "prepare-canary requires a named source branch"
    }),
    "source branch"
  );
  const commit = git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], gitImplementation);
  const tree = git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"], gitImplementation);
  const remoteName = git(repositoryRoot, ["config", "--get", `branch.${branch}.remote`], gitImplementation, {
    code: "UPSTREAM_REQUIRED", message: "prepare-canary requires a configured source upstream"
  });
  const mergeRef = git(repositoryRoot, ["config", "--get", `branch.${branch}.merge`], gitImplementation, {
    code: "UPSTREAM_REQUIRED", message: "prepare-canary requires a configured source upstream"
  });
  if (!mergeRef.startsWith("refs/heads/")) {
    throw new CliFailure("UPSTREAM_REQUIRED", "source upstream is not a Git branch", { exitCode: 1 });
  }
  const upstreamCommit = git(repositoryRoot, ["rev-parse", "--verify", "@{upstream}^{commit}"], gitImplementation, {
    code: "UPSTREAM_REQUIRED", message: "source upstream revision is unavailable"
  });
  if (upstreamCommit !== commit) {
    throw new CliFailure("HEAD_NOT_PUSHED", "source HEAD does not equal its configured upstream revision", { exitCode: 1 });
  }
  const remoteUrl = git(repositoryRoot, ["config", "--get", `remote.${remoteName}.url`], gitImplementation, {
    code: "UPSTREAM_REQUIRED", message: "source upstream URL is unavailable"
  });
  const upstreamBranch = mergeRef.slice("refs/heads/".length);
  requireBranch(upstreamBranch, "configured source upstream branch");
  return Object.freeze({ branch, commit, tree, remoteName, mergeRef, upstreamBranch, upstreamCommit, remoteUrl });
}

async function resolveCanarySource({ publicSourceResolver, configuredGitHub, snapshot, sharedNetwork }) {
  const resolved = await publicSourceResolver({
    ...configuredGitHub,
    commit: snapshot.commit,
    tree: snapshot.tree,
    sourcePaths: [],
    contractPaths: [],
    githubActionsRunIds: [],
    primaryBlobBytes: null,
    companions: [],
    ...sharedNetwork
  });
  const identity = sourceIdentity(resolved);
  if (
    identity.repositorySlug !== configuredGitHub.repositorySlug
    || identity.commit !== snapshot.commit
    || identity.tree !== snapshot.tree
    || resolved.publicRepositoryReachable !== true
    || resolved.publicCommitReachable !== true
  ) {
    throw new CliFailure("PUBLIC_SOURCE_INVALID", "public source resolution did not bind the exact pushed worktree", { exitCode: 1 });
  }
  return resolved;
}

function sourceIdentity(source) {
  return {
    repositorySlug: source?.repositorySlug,
    repositoryId: source?.repositoryId,
    upstreamBranch: source?.upstreamBranch,
    refName: source?.refName,
    commit: source?.commit,
    tree: source?.tree
  };
}

function assertSourceSnapshotUnchanged(repositoryRoot, gitImplementation, expected) {
  let observed;
  try {
    observed = inspectExactPushedSource(repositoryRoot, gitImplementation);
  } catch (error) {
    if (!(error instanceof CliFailure)) throw error;
    throw new CliFailure("SOURCE_DRIFT", "the exact clean pushed source changed before the local canary write", {
      exitCode: 1
    });
  }
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new CliFailure("SOURCE_DRIFT", "the exact clean pushed source changed before the local canary write", {
      exitCode: 1
    });
  }
  return observed;
}

function bindFreshSourceHead(source, head, snapshot, mismatchCode) {
  const expected = {
    repositorySlug: source?.repositorySlug,
    repositoryId: source?.repositoryId,
    upstreamBranch: snapshot?.upstreamBranch,
    refName: snapshot?.mergeRef,
    commit: snapshot?.commit,
    tree: snapshot?.tree
  };
  if (canonicalJson(head) !== canonicalJson(expected)) {
    throw new CliFailure(
      mismatchCode,
      "source HEAD does not equal the freshly resolved configured GitHub upstream",
      { exitCode: 1 }
    );
  }
  return Object.freeze({ ...source, ...head });
}

function buildPlan({ application, applicationBytes, builder, source, central, output }) {
  const withoutDigest = {
    schemaVersion: "programmable.workflow-canary-local-write-plan.v1",
    operation: "write-one-local-workflow-canary-application",
    applicationId: application.applicationId,
    applicationRevision: application.applicationRevision,
    builder: { githubLogin: builder.githubLogin, githubUserId: builder.githubUserId },
    source: sourceIdentity(source),
    central: {
      repository: central.repositorySlug,
      baseBranch: central.baseBranch,
      baseCommit: central.baseCommit,
      baseTree: central.baseTree,
      policyBinding: central.policyBinding,
      policySchemaBinding: central.policySchemaBinding,
      canaryApplicationSchemaBinding: central.canaryApplicationSchemaBinding
    },
    output: {
      directory: output.targetDirectory,
      parentIdentity: output.parentIdentity,
      repositoryPath: central.applicationPath,
      byteLength: applicationBytes.length,
      sha256: digest(applicationBytes)
    },
    authority: {
      githubWrite: false,
      launchAuthorization: false,
      productionRouting: false,
      publicDiscovery: false,
      realUserFunds: false
    }
  };
  return Object.freeze({
    ...withoutDigest,
    planDigest: digest(Buffer.from(`programmable.workflow-canary-local-write-plan.v1\0${canonicalJson(withoutDigest)}`, "utf8"))
  });
}

function observeOutput(output) {
  if (
    output === null
    || typeof output !== "object"
    || typeof output.targetDirectory !== "string"
    || typeof output.parentDirectory !== "string"
  ) {
    throw new CliFailure("OUTPUT_PATH_INVALID", "canary output observation is unavailable", { exitCode: 1 });
  }
  return Object.freeze({
    targetDirectory: output.targetDirectory,
    parentDirectory: output.parentDirectory,
    parentIdentity: inodeIdentity(fs.lstatSync(output.parentDirectory, { bigint: true }))
  });
}

function result(status, plan, application, applicationBytes) {
  return Object.freeze({
    status,
    planDigest: plan.planDigest,
    plan,
    application,
    canonicalApplicationJson: Buffer.from(applicationBytes).toString("utf8"),
    localWritePerformed: false,
    githubWritePerformed: false,
    sourceExecuted: false,
    launchAuthorized: false,
    nextStep: "Keep these exact canonical bytes with their digest. Automated local writing remains fail-closed until a bundled portable descriptor-bound writer is available."
  });
}

function inodeIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function requireExactObject(value, keys, code) {
  if (!isPlainObject(value)) throw new CliFailure(code, "prepare-canary options are closed");
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !actual.every((key) => keys.includes(key))) {
    throw new CliFailure(code, "prepare-canary does not accept caller-selected authority fields");
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function usage(message) {
  throw new CliFailure("USAGE_ERROR", message, { exitCode: 2 });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const cliSpec = {
  command: "prepare-canary",
  usage: "prepare-canary.mjs <application-id> --title <text> --summary <text> --output-dir <.../canary-submissions/application-id> [--dry-run | --write --acknowledge-local-write <sha256:...>] [--repository-root <path>]",
  summary: "Preview exact hidden non-production workflow-canary bytes; automated local writing fails closed and GitHub is never written.",
  options: [
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Use this exact clean pushed source worktree." },
    { name: "--title", key: "title", type: "value", valueName: "text", description: "Set the canary title." },
    { name: "--summary", key: "summary", type: "value", valueName: "text", description: "Set the canary summary." },
    { name: "--output-dir", key: "outputDirectory", type: "value", valueName: "path", description: "New application-id directory below an existing external canary-submissions directory." },
    { name: "--dry-run", key: "dryRun", type: "boolean", description: "State the default read-only mode explicitly." },
    { name: "--write", key: "write", type: "boolean", description: "Request the guarded local-write boundary; it currently fails closed without filesystem mutation." },
    { name: "--acknowledge-local-write", key: "acknowledgeLocalWrite", type: "value", valueName: "sha256:...", description: "Acknowledge only the exact freshly recomputed preview digest; this does not enable a write." }
  ],
  positionals: { min: 1, max: 1, names: ["application-id"] }
};

async function runCli(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${renderHelp(cliSpec)}\n`);
    return 0;
  }
  try {
    let parsed;
    try {
      parsed = parseCli(cliSpec, argv);
    } catch {
      usage("arguments are invalid; use --help for the closed command contract");
    }
    const { options, positionals } = parsed;
    if (options.write && options.dryRun) usage("--write and --dry-run are mutually exclusive");
    const resultValue = await prepareWorkflowCanary({
      repositoryRoot: options.repositoryRoot,
      applicationId: positionals[0],
      title: options.title,
      summary: options.summary,
      outputDirectory: options.outputDirectory,
      write: options.write,
      acknowledgeLocalWrite: options.acknowledgeLocalWrite
    });
    emitSuccess(COMMAND, resultValue);
    return 0;
  } catch (error) {
    return emitFailure(COMMAND, error);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
