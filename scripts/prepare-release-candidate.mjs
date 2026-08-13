#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  verifyExternalEvidenceBundle
} from "./evals/e2e-external-evidence-core.mjs";
import { parseBoundedStrictJsonBytes } from "../skills/programmable-v4-hook-builder/scripts/strict-json-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const skillName = "programmable-v4-hook-builder";
const skillRoot = path.join(repositoryRoot, "skills", skillName);
const hostAgents = ["codex", "claude-code", "github-copilot"];
const localRehearsalStatus = "LOCAL_INFRASTRUCTURE_AND_PACKAGING_REHEARSAL_VERIFIED";
const externalBlockers = [
  {
    id: "REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE",
    state: "EXTERNAL_BLOCKED",
    requirement: "Run the real repository-E2E matrix across the named model tiers with an independent judge."
  },
  {
    id: "TRUSTED_SEPARATE_UID_OR_CONTAINER_SANDBOX",
    state: "EXTERNAL_BLOCKED",
    requirement: "Run subjects and generated-repository stages in a trusted separate-UID or container sandbox."
  },
  {
    id: "PUBLIC_COMPARABLE_REPOSITORY_E2E_POPULATION",
    state: "EXTERNAL_BLOCKED",
    requirement: "Establish the comparable public repository-E2E population required by the release scorecard."
  },
  {
    id: "INDEPENDENT_NOVEL_HOLDOUT_AND_PRIOR_RELEASE_COMPARATOR",
    state: "EXTERNAL_BLOCKED",
    requirement: "Evaluate an independently created novel holdout and an immutable prior-release comparator."
  },
  {
    id: "FORK_RPC_FOR_FORK_DEPENDENT_CASES",
    state: "EXTERNAL_BLOCKED",
    requirement: "Provide a pinned fork RPC and execute every fork-dependent case."
  },
  {
    id: "INSTALLED_HOST_NATURAL_LANGUAGE_TO_SUBMISSION",
    state: "EXTERNAL_BLOCKED",
    requirement: "Invoke installed hosts from natural-language intent through repository generation and submission."
  }
];
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(`Usage: prepare-release-candidate.mjs --tag <vX.Y.Z> --output-dir <absolute-new-directory> [--external-evidence <absolute-bundle.json> --external-evidence-operator-policy-sha256 <sha256:...>]\n\n`);
  process.stdout.write(`Run the complete local repository gate, mandatory V1/V2 high-confidence kernel campaign and Slither,\n`);
  process.stdout.write(`Agent Skills publication dry run, routing canaries, three clean host installations, installed-package verification,\n`);
  process.stdout.write(`and two independent deterministic release-artifact builds with byte-for-byte comparison.\n`);
  process.stdout.write(`An operator-selected policy digest can validate signatures but cannot independently clear a release gate.\n`);
  process.stdout.write(`The command performs no push, tag, release, deployment, signing, submission, or other external write.\n`);
  process.exit(0);
}

assertSafeOutputDirectory(options.outputDirectory);
if (fs.existsSync(options.outputDirectory)) fail("--output-dir must not already exist");

if (git(["status", "--porcelain=v1", "--untracked-files=all"]).trim() !== "") {
  fail("release candidate verification requires a clean Git worktree");
}

const commit = git(["rev-parse", "HEAD"]).trim();
const tree = git(["rev-parse", `${commit}^{tree}`]).trim();
const skillTree = git(["rev-parse", `${commit}:skills/${skillName}`]).trim();
const commitTime = new Date(git(["show", "-s", "--format=%cI", commit]).trim()).toISOString();
const versionAuthority = parseJsonBytes(
  git(["show", `${commit}:config/plugin.json`], { encoding: null }),
  "committed config/plugin.json"
);
const packageDocument = parseJsonBytes(
  git(["show", `${commit}:package.json`], { encoding: null }),
  "committed package.json"
);
const candidateVersion = requireCanonicalCandidateVersion(versionAuthority, packageDocument);
const expectedTag = `v${candidateVersion}`;
if (options.tag !== expectedTag) fail(`expected --tag ${expectedTag}`);
let externalEvidenceVerification;
try {
  externalEvidenceVerification = verifyExternalEvidenceBundle({
    evidencePath: options.externalEvidencePath ?? null,
    operatorSelectedPolicySha256: options.externalEvidenceOperatorPolicySha256 ?? null,
    repositoryRoot,
    sourceBinding: { commit, tree, skillTree }
  });
} catch (error) {
  const code = typeof error?.code === "string" ? ` (${error.code})` : "";
  fail(`--external-evidence rejected${code}: ${error instanceof Error ? error.message : String(error)}`);
}
const remainingExternalBlockers = externalBlockers.filter(({ id }) => (
  externalEvidenceVerification.remainingBlockedGateIds.includes(id)
));
const modelEvidence = externalEvidenceVerification.gateResults.find(({ gateId }) => (
  gateId === "REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE"
));
const partialDirectory = `${options.outputDirectory}.partial-${process.pid}`;
const installProbeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-v4-builder-release-install-"));
const checks = [];
let partialCreated = false;
let terminalError = null;
let successSummary = null;

try {
  if (fs.existsSync(partialDirectory)) throw new Error(`temporary candidate path already exists: ${partialDirectory}`);
  fs.mkdirSync(partialDirectory, { recursive: false, mode: 0o755 });
  partialCreated = true;

  const kernelEvidencePath = path.join(partialDirectory, "kernel-release-evidence.json");
  runCheck("repository-and-kernel-release-gate", process.execPath, [
    "scripts/verify-repository.mjs",
    "--kernel-evidence-out", kernelEvidencePath
  ], repositoryRoot);
  const kernelEvidence = readJson(kernelEvidencePath);
  if (kernelEvidence.status !== "KERNEL_RELEASE_EVIDENCE_VERIFIED" || kernelEvidence.releaseEligible !== true) {
    throw new Error("repository gate did not produce release-eligible kernel evidence");
  }
  if (
    kernelEvidence.source?.commit !== commit
    || kernelEvidence.source?.tree !== tree
    || kernelEvidence.source?.skillTree !== skillTree
    || kernelEvidence.source?.worktreeClean !== true
    || kernelEvidence.createdFromCommitTime !== commitTime
  ) {
    throw new Error("repository gate evidence does not match the pinned candidate source");
  }
  runCheck("agent-skills-publication-dry-run", "gh", ["skill", "publish", "--dry-run"], repositoryRoot);

  const ordinary = runCheck("ordinary-routing-canary", process.execPath, [
    path.join(skillRoot, "scripts", "cli.mjs"),
    "context",
    "--mode", "preflight",
    "--pack", "programmable-volume-fee",
    "--pack", "automatic-liquidity"
  ], repositoryRoot);
  assertOrdinaryCanary(ordinary.stdout);

  const novelCapability = "orbital-sport-market-with-live-map-and-signed-rewards";
  const novel = runCheck("novel-routing-canary", process.execPath, [
    path.join(skillRoot, "scripts", "cli.mjs"),
    "context",
    "--mode", "preflight",
    "--capability", novelCapability
  ], repositoryRoot);
  assertNovelCanary(novel.stdout, novelCapability);

  const installations = [];
  for (const agent of hostAgents) {
    const hostRoot = path.join(installProbeRoot, agent);
    fs.mkdirSync(hostRoot, { recursive: true, mode: 0o755 });
    runCheck(`install-${agent}`, "gh", [
      "skill", "install", repositoryRoot, skillName,
      "--from-local", "--agent", agent, "--scope", "project"
    ], hostRoot);
    const installedRoot = findInstalledSkill(hostRoot);
    runCheck(`verify-installed-${agent}`, process.execPath, [
      path.join(installedRoot, "scripts", "verify-skill.mjs"), "--installed"
    ], installedRoot);
    installations.push({ agent, installedPath: path.relative(hostRoot, installedRoot).split(path.sep).join("/") });
  }

  const firstArtifactsDirectory = path.join(partialDirectory, "artifacts-build-1");
  const secondArtifactsDirectory = path.join(partialDirectory, "artifacts-build-2");
  const externalEvidenceArguments = options.externalEvidencePath ? [
    "--external-evidence", options.externalEvidencePath,
    "--external-evidence-operator-policy-sha256", options.externalEvidenceOperatorPolicySha256
  ] : [];
  runCheck("release-artifacts-build-1", process.execPath, [
    "scripts/generate-release-artifacts.mjs",
    "--tag", options.tag,
    "--output-dir", firstArtifactsDirectory,
    "--kernel-evidence", kernelEvidencePath,
    ...externalEvidenceArguments
  ], repositoryRoot);
  runCheck("release-artifacts-build-2", process.execPath, [
    "scripts/generate-release-artifacts.mjs",
    "--tag", options.tag,
    "--output-dir", secondArtifactsDirectory,
    "--kernel-evidence", kernelEvidencePath,
    ...externalEvidenceArguments
  ], repositoryRoot);
  const reproducibilityStarted = Date.now();
  const reproducibility = assertArtifactDirectoriesEqual(firstArtifactsDirectory, secondArtifactsDirectory);
  checks.push({
    id: "release-artifacts-two-build-reproducibility",
    command: "byte-for-byte-comparison",
    exitCode: 0,
    durationMs: Date.now() - reproducibilityStarted,
    evidenceSha256: sha256(JSON.stringify(reproducibility))
  });
  process.stderr.write("passed: release-artifacts-two-build-reproducibility\n");
  fs.rmSync(secondArtifactsDirectory, { recursive: true, force: false });
  const artifactsDirectory = path.join(partialDirectory, "artifacts");
  fs.renameSync(firstArtifactsDirectory, artifactsDirectory);

  runCheck("verify-release-checksums", "shasum", ["-a", "256", "-c", "SHA256SUMS"], artifactsDirectory);
  const archive = path.join(artifactsDirectory, `${skillName}-${options.tag}.tar.gz`);
  const archiveListing = runCheck("inspect-release-archive", "tar", ["-tzf", archive], repositoryRoot);
  assertArchiveListing(archiveListing.stdout);
  const extractedRoot = path.join(installProbeRoot, "release-archive");
  fs.mkdirSync(extractedRoot, { recursive: false, mode: 0o755 });
  runCheck("extract-release-archive", "tar", ["-xzf", archive, "-C", extractedRoot], repositoryRoot);
  const extractedEntries = fs.readdirSync(extractedRoot).sort();
  if (extractedEntries.length !== 1 || extractedEntries[0] !== skillName) {
    throw new Error("release archive must extract to exactly one canonical skill directory");
  }
  const extractedSkill = findInstalledSkill(extractedRoot);
  runCheck("verify-extracted-release-archive", process.execPath, [
    path.join(extractedSkill, "scripts", "verify-skill.mjs"), "--installed"
  ], extractedSkill);

  const finalStatus = runCheck(
    "source-worktree-unchanged",
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repositoryRoot
  );
  if (finalStatus.stdout.trim() !== "") {
    throw new Error("local candidate checks changed the source worktree");
  }
  if (git(["rev-parse", "HEAD"]).trim() !== commit) {
    throw new Error("HEAD changed while the release candidate was being verified");
  }

  const receipt = {
    schemaVersion: "2.0.0",
    status: localRehearsalStatus,
    releaseCandidate: false,
    product: "Programmable v4 Builder",
    version: candidateVersion,
    tag: options.tag,
    commit,
    tree,
    skillTree,
    commitTime,
    verifiedAt: new Date().toISOString(),
    installations,
    checks,
    artifacts: artifactRecords(artifactsDirectory),
    kernelEvidence: {
      path: "kernel-release-evidence.json",
      bytes: fs.statSync(kernelEvidencePath).size,
      sha256: sha256(fs.readFileSync(kernelEvidencePath)),
      status: kernelEvidence.status,
      verifiedAt: kernelEvidence.verifiedAt,
      selection: kernelEvidence.selection,
      tools: Object.fromEntries(kernelEvidence.tools.map(({ id, version }) => [id, version])),
      kernels: kernelEvidence.kernels.map(({ id, lockfile, testInventory, checks: kernelChecks }) => ({
        id,
        lockfileSha256: lockfile.sha256,
        testInventory,
        checks: kernelChecks.map(({ id: checkId, command, environment, executionMode, timeoutMs, stdout, stderr }) => ({
          id: checkId,
          command,
          environment,
          executionMode,
          timeoutMs,
          stdoutSha256: stdout.sha256,
          stderrSha256: stderr.sha256
        }))
      }))
    },
    reproducibility,
    externalActionsPerformed: [],
    publicationPerformed: false,
    publicationEvidence: {
      candidate: {
        state: "NOT_A_RELEASE_CANDIDATE_LOCAL_REHEARSAL_ONLY",
        receipt: "local-release-verification.json",
        commit,
        tree,
        skillTree,
        releaseCandidate: false
      },
      stable: {
        state: "NOT_PUBLISHED",
        tagEvidence: null,
        publicCiEvidence: null,
        releaseEvidence: null,
        registryEvidence: null
      }
    },
    externalEvidenceVerification,
    modelEvalState: modelEvidence?.status === "VERIFIED_EXTERNAL_EVIDENCE" ? "EXTERNALLY_VERIFIED" : "EXTERNAL_BLOCKED",
    repositoryE2eScorecard: {
      state: modelEvidence?.status === "VERIFIED_EXTERNAL_EVIDENCE" ? "EXTERNALLY_VERIFIED" : "EXTERNAL_BLOCKED",
      requiredExecutionKind: "REAL_REPOSITORY_E2E",
      requiredVerdict: "PASS",
      requiredSourceBinding: { commit, tree, skillTree },
      evidence: modelEvidence?.status === "VERIFIED_EXTERNAL_EVIDENCE" ? modelEvidence : null
    },
    externalBlockers: remainingExternalBlockers,
    deferredGates: [
      ...remainingExternalBlockers.map(({ id }) => `EXTERNAL_BLOCKED:${id}`),
      "owner release authorization",
      "protected public push and tag",
      "public CI",
      "public-tag installation canaries",
      "Registry intake activation",
      "platform integration and deployment",
      "independent security review"
    ]
  };
  fs.writeFileSync(
    path.join(partialDirectory, "local-release-verification.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o644 }
  );
  fs.renameSync(partialDirectory, options.outputDirectory);
  partialCreated = false;

  successSummary = {
    status: receipt.status,
    releaseCandidate: false,
    modelEvalState: receipt.modelEvalState,
    version: receipt.version,
    tag: receipt.tag,
    commit: receipt.commit,
    tree: receipt.tree,
    skillTree: receipt.skillTree,
    outputDirectory: options.outputDirectory,
    checks: checks.map(({ id }) => id),
    externalBlockedGateIds: remainingExternalBlockers.map(({ id }) => id),
    externallyVerifiedGateIds: externalEvidenceVerification.verifiedGateIds,
    signatureValidExternalEvidenceGateIds: externalEvidenceVerification.signatureValidGateIds,
    externalActionsPerformed: []
  };
} catch (error) {
  terminalError = error instanceof Error ? error.message : String(error);
} finally {
  fs.rmSync(installProbeRoot, { recursive: true, force: true });
  if (partialCreated) fs.rmSync(partialDirectory, { recursive: true, force: true });
}

if (terminalError !== null) fail(terminalError);
process.stdout.write(`${JSON.stringify(successSummary, null, 2)}\n`);

function runCheck(id, command, args, cwd) {
  const started = Date.now();
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw new Error(`${id}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${id} failed\n${String(result.stdout)}\n${String(result.stderr)}`.trim());
  }
  const record = {
    id,
    command: path.basename(command),
    exitCode: result.status,
    durationMs: Date.now() - started,
    stdoutSha256: sha256(String(result.stdout)),
    stderrSha256: sha256(String(result.stderr))
  };
  checks.push(record);
  process.stderr.write(`passed: ${id}\n`);
  return { ...record, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function assertOrdinaryCanary(stdout) {
  const result = parseCommandResult(stdout, "ordinary-routing-canary");
  if (result.automaticAdverseDecision !== false) throw new Error("ordinary routing canary produced an adverse decision");
  if (result.unknownCapabilities.length !== 0) throw new Error("ordinary routing canary produced an unknown capability");
  for (const pack of ["automatic-liquidity", "programmable-volume-fee"]) {
    if (!result.packs.includes(pack)) throw new Error(`ordinary routing canary omitted ${pack}`);
  }
}

function assertNovelCanary(stdout, capability) {
  const result = parseCommandResult(stdout, "novel-routing-canary");
  if (result.automaticAdverseDecision !== false) throw new Error("novel routing canary produced an adverse decision");
  if (result.reviewRoute !== "architecture-review-required") throw new Error("novel routing canary omitted architecture review");
  if (!result.unknownCapabilities.includes(capability)) throw new Error("novel routing canary discarded the unknown capability");
}

function assertArchiveListing(stdout) {
  const entries = stdout.split("\n").filter(Boolean);
  if (entries.length === 0) throw new Error("release archive is empty");
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes("..")) {
      throw new Error(`unsafe release archive path: ${entry}`);
    }
    if (entry !== `${skillName}/` && !entry.startsWith(`${skillName}/`)) {
      throw new Error(`release archive path escapes the canonical skill directory: ${entry}`);
    }
  }
}

function parseCommandResult(stdout, id) {
  let document;
  try {
    document = JSON.parse(stdout);
  } catch {
    throw new Error(`${id} did not return JSON`);
  }
  if (document?.ok !== true || typeof document.result !== "object" || document.result === null) {
    throw new Error(`${id} returned an invalid command envelope`);
  }
  return document.result;
}

function findInstalledSkill(hostRoot) {
  const matches = [];
  walk(hostRoot, (absolutePath, entry) => {
    if (entry.isFile() && entry.name === "SKILL.md" && path.basename(path.dirname(absolutePath)) === skillName) {
      matches.push(path.dirname(absolutePath));
    }
  });
  if (matches.length !== 1) throw new Error(`expected one installed ${skillName} package, found ${matches.length}`);
  return matches[0];
}

function artifactRecords(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.length === 0 || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error("release artifact directory must contain only regular files");
  }
  return entries
    .map((entry) => {
      const contents = fs.readFileSync(path.join(directory, entry.name));
      return { name: entry.name, bytes: contents.length, sha256: sha256(contents) };
    })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
}

function assertArtifactDirectoriesEqual(firstDirectory, secondDirectory) {
  const first = artifactRecords(firstDirectory);
  const second = artifactRecords(secondDirectory);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("independent release-artifact builds are not byte-for-byte reproducible");
  }
  for (const record of first) {
    const firstBytes = fs.readFileSync(path.join(firstDirectory, record.name));
    const secondBytes = fs.readFileSync(path.join(secondDirectory, record.name));
    if (!firstBytes.equals(secondBytes)) {
      throw new Error(`release artifact is not byte-for-byte reproducible: ${record.name}`);
    }
  }
  return {
    status: "TWO_BUILD_REPRODUCIBILITY_VERIFIED",
    buildCount: 2,
    comparison: "filename-byte-count-sha256-and-exact-bytes",
    artifacts: first
  };
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    visit(absolutePath, entry);
    if (entry.isDirectory()) walk(absolutePath, visit);
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") values.help = true;
    else if (argument === "--tag") {
      if (values.tag !== undefined) fail("--tag cannot be repeated");
      values.tag = args[++index];
    }
    else if (argument === "--output-dir") {
      if (values.outputDirectory !== undefined) fail("--output-dir cannot be repeated");
      const value = args[++index];
      if (!value || !path.isAbsolute(value)) fail("--output-dir must be an absolute path");
      values.outputDirectory = path.normalize(value);
    } else if (argument === "--external-evidence") {
      if (values.externalEvidencePath !== undefined) fail("--external-evidence cannot be repeated");
      const value = args[++index];
      if (!value || !path.isAbsolute(value)) fail("--external-evidence must be an absolute file path");
      values.externalEvidencePath = path.normalize(value);
    } else if (argument === "--external-evidence-operator-policy-sha256") {
      if (values.externalEvidenceOperatorPolicySha256 !== undefined) fail("--external-evidence-operator-policy-sha256 cannot be repeated");
      const value = args[++index];
      if (!/^sha256:[0-9a-f]{64}$/u.test(value ?? "")) fail("--external-evidence-operator-policy-sha256 must be sha256:<64 lowercase hex>");
      values.externalEvidenceOperatorPolicySha256 = value;
    } else fail(`unknown argument: ${argument}`);
  }
  if (values.help) return values;
  if (!values.tag || !values.outputDirectory) {
    fail("usage: prepare-release-candidate.mjs --tag <vX.Y.Z> --output-dir <absolute-new-directory> [--external-evidence <absolute-bundle.json> --external-evidence-operator-policy-sha256 <sha256:...>]");
  }
  if ((values.externalEvidencePath === undefined) !== (values.externalEvidenceOperatorPolicySha256 === undefined)) {
    fail("--external-evidence and --external-evidence-operator-policy-sha256 must be provided together");
  }
  return values;
}

function assertSafeOutputDirectory(outputDirectory) {
  const parent = path.dirname(outputDirectory);
  if (!fs.existsSync(parent)) fail("--output-dir parent must already exist");
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    fail("--output-dir parent must be a real directory, not a symlink");
  }
  const resolvedRepository = fs.realpathSync(repositoryRoot);
  const resolvedOutput = path.join(fs.realpathSync(parent), path.basename(outputDirectory));
  const relative = path.relative(resolvedRepository, resolvedOutput);
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!outside) fail("--output-dir must resolve outside the repository");
}

function git(args, options = {}) {
  const result = childProcess.spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr);
  return result.stdout;
}

function readJson(file) {
  return parseJsonBytes(fs.readFileSync(file), file);
}

function parseJsonBytes(bytes, label) {
  try {
    return parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: 32 * 1024 * 1024,
      maxNodes: 250_000,
      maxDepth: 128,
      maxNumberCharacters: 128
    });
  } catch (error) {
    const code = typeof error?.code === "string" ? ` (${error.code})` : "";
    throw new Error(`${label} is not strict bounded JSON${code}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireCanonicalCandidateVersion(metadata, packageDocument) {
  const version = metadata?.version;
  if (typeof version !== "string" || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(version)) {
    fail("committed config/plugin.json version authority must be stable semver");
  }
  if (packageDocument?.version !== version) {
    fail("committed package.json version must match canonical config/plugin.json version");
  }
  return version;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message) {
  process.stderr.write(`${String(message).trim()}\n`);
  process.exit(1);
}
