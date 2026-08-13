#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { verifyExternalEvidenceBundle } from "./evals/e2e-external-evidence-core.mjs";
import {
  buildReleaseSpdx,
  MAX_RELEASE_EVIDENCE_BYTES,
  RELEASE_KERNELS,
  sha256,
  validateReleaseKernelEvidence
} from "./release-evidence-core.mjs";
import { parseBoundedStrictJsonBytes } from "../skills/programmable-v4-hook-builder/scripts/strict-json-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const options = parseArgs(process.argv.slice(2));

assertSafeOutputDirectory(options.outputDirectory);
assertSafeEvidenceFile(options.kernelEvidencePath);
if (git(["status", "--porcelain=v1", "--untracked-files=all"]).trim() !== "") {
  fail("release artifacts require a clean Git worktree");
}

const commit = git(["rev-parse", "HEAD"]).trim();
const tree = git(["rev-parse", `${commit}^{tree}`]).trim();
const created = new Date(git(["show", "-s", "--format=%cI", commit]).trim()).toISOString();
const commitEpoch = git(["show", "-s", "--format=%ct", commit]).trim();
const versionAuthority = readCommitJson(commit, "config/plugin.json");
const packageDocument = readCommitJson(commit, "package.json");
const candidateVersion = requireCanonicalCandidateVersion(versionAuthority, packageDocument);
const expectedTag = `v${candidateVersion}`;
if (options.tag !== expectedTag) fail(`expected --tag ${expectedTag}`);
const skillRoot = "skills/programmable-v4-hook-builder";
const skillTree = git(["rev-parse", `${commit}:${skillRoot}`]).trim();
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
const kernelLocks = RELEASE_KERNELS.map((specification) => {
  const repositoryPath = `${specification.sourcePath}/package-lock.json`;
  const bytes = git(["show", `${commit}:${repositoryPath}`], { encoding: null });
  return {
    id: specification.id,
    path: repositoryPath,
    bytes,
    lock: parseStrictJson(bytes, `committed ${repositoryPath}`, 8 * 1024 * 1024)
  };
});
const kernelEvidenceBytes = readBoundedEvidence(options.kernelEvidencePath);
const kernelEvidence = parseStrictJson(
  kernelEvidenceBytes,
  "--kernel-evidence",
  MAX_RELEASE_EVIDENCE_BYTES
);
let validatedKernelEvidence;
try {
  validatedKernelEvidence = validateReleaseKernelEvidence(kernelEvidence, {
    commit,
    tree,
    skillTree,
    createdFromCommitTime: created,
    lockfiles: Object.fromEntries(kernelLocks.map(({ id, path: lockPath, bytes }) => [id, { path: lockPath, bytes }]))
  });
} catch (error) {
  fail(`--kernel-evidence rejected: ${error instanceof Error ? error.message : String(error)}`);
}
const trackedFiles = git(["ls-tree", "-r", "-z", "--full-tree", commit, "--", `${skillRoot}/`], { encoding: null })
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .map((entry) => {
    const match = entry.match(/^(\d+) blob ([0-9a-f]{40})\t(.+)$/u);
    if (!match) fail(`cannot parse tracked file record: ${entry}`);
    const repositoryPath = match[3];
    const contents = git(["cat-file", "blob", match[2]], { encoding: null });
    return {
      path: repositoryPath.slice(`${skillRoot}/`.length),
      mode: match[1],
      bytes: contents.length,
      sha256: sha256(contents)
    };
  })
  .sort((left, right) => compareCodeUnits(left.path, right.path));

if (trackedFiles.length === 0) fail("portable skill contains no tracked files");

fs.mkdirSync(options.outputDirectory, { recursive: true });
if (fs.readdirSync(options.outputDirectory).length !== 0) fail("--output-dir must be empty");

const baseName = `programmable-v4-hook-builder-${expectedTag}`;
const archiveRoot = "programmable-v4-hook-builder";
const archiveName = `${baseName}.tar.gz`;
const manifestName = `${baseName}.manifest.json`;
const sbomName = `${baseName}.spdx.json`;
const receiptName = `${baseName}.release.json`;
const kernelEvidenceName = `${baseName}.kernel-evidence.json`;

const tar = git([
  "-c",
  "tar.umask=0022",
  "archive",
  "--format=tar",
  `--mtime=@${commitEpoch}`,
  `--prefix=${archiveRoot}/`,
  `${commit}:${skillRoot}`
], { encoding: null });
const archive = zlib.gzipSync(tar, { level: 9, mtime: 0 });
writeBinary(archiveName, archive);

const manifest = {
  schemaVersion: "2.0.0",
  product: "Programmable v4 Builder",
  skill: "programmable-v4-hook-builder",
  version: candidateVersion,
  tag: expectedTag,
  commit,
  tree,
  skillTree,
  archiveRoot,
  createdFromCommitTime: created,
  fileCount: trackedFiles.length,
  files: trackedFiles
};
writeJson(manifestName, manifest);

const sbom = buildReleaseSpdx(kernelLocks, { commit, created, version: candidateVersion });
writeJson(sbomName, sbom);
writeBinary(kernelEvidenceName, kernelEvidenceBytes);

const receipt = {
  schemaVersion: "2.0.0",
  releaseCandidate: false,
  product: "Programmable v4 Builder",
  version: candidateVersion,
  tag: expectedTag,
  commit,
  tree,
  skillTree,
  createdFromCommitTime: created,
  sourcePath: skillRoot,
  archiveRoot,
  archive: archiveName,
  manifest: manifestName,
  sbom: sbomName,
  kernelEvidence: {
    artifact: kernelEvidenceName,
    sha256: sha256(kernelEvidenceBytes),
    status: validatedKernelEvidence.status,
    verifiedAt: validatedKernelEvidence.verifiedAt,
    tools: validatedKernelEvidence.tools,
    kernels: validatedKernelEvidence.kernels
  },
  publicationEvidence: {
    candidate: {
      state: "LOCAL_ARTIFACTS_GENERATED_NOT_A_RELEASE_CANDIDATE",
      commit,
      tree,
      skillTree,
      releaseCandidate: false
    },
    stable: {
      state: "NOT_PUBLISHED",
      tagEvidence: null,
      releaseEvidence: null,
      registryEvidence: null
    }
  },
  externalEvidenceVerification,
  releaseCandidateBlockers: {
    externalEvidenceGateIds: externalEvidenceVerification.remainingBlockedGateIds,
    authorityAndPublication: [
      "owner release authorization",
      "protected public push and tag",
      "public CI",
      "public-tag installation canaries",
      "Registry intake activation",
      "platform integration and deployment",
      "independent security review"
    ]
  },
  modelEvalState: externalEvidenceVerification.verifiedGateIds.includes("REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE")
    ? "externally-verified"
    : "external-blocked",
  securityEvidenceBoundary: "recorded-kernel-checks-passed-independent-audit-deployment-and-live-operation-not-evidenced"
};
writeJson(receiptName, receipt);

const checksummedNames = [archiveName, manifestName, sbomName, kernelEvidenceName, receiptName];
const checksumLines = checksummedNames
  .map((name) => `${sha256(fs.readFileSync(path.join(options.outputDirectory, name)))}  ${name}`)
  .join("\n");
fs.writeFileSync(path.join(options.outputDirectory, "SHA256SUMS"), `${checksumLines}\n`, { mode: 0o644 });

process.stdout.write(`${JSON.stringify({
  status: "RELEASE_ARTIFACTS_GENERATED",
  version: candidateVersion,
  tag: expectedTag,
  commit,
  tree,
  outputDirectory: options.outputDirectory,
  artifacts: [...checksummedNames, "SHA256SUMS"]
}, null, 2)}\n`);

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--tag") {
      if (values.tag !== undefined) fail("--tag cannot be repeated");
      values.tag = args[++index];
    }
    else if (argument === "--output-dir") {
      if (values.outputDirectory !== undefined) fail("--output-dir cannot be repeated");
      const value = args[++index];
      if (!value) fail("--output-dir requires a value");
      values.outputDirectory = path.resolve(value);
    } else if (argument === "--kernel-evidence") {
      if (values.kernelEvidencePath !== undefined) fail("--kernel-evidence cannot be repeated");
      const value = args[++index];
      if (!value || !path.isAbsolute(value)) fail("--kernel-evidence must be an absolute file path");
      values.kernelEvidencePath = path.normalize(value);
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
    }
    else fail(`unknown argument: ${argument}`);
  }
  if (!values.tag || !values.outputDirectory || !values.kernelEvidencePath) {
    fail("usage: generate-release-artifacts.mjs --tag <tag> --output-dir <absolute-empty-directory> --kernel-evidence <absolute-verified-evidence-file> [--external-evidence <absolute-bundle.json> --external-evidence-operator-policy-sha256 <sha256:...>]");
  }
  if ((values.externalEvidencePath === undefined) !== (values.externalEvidenceOperatorPolicySha256 === undefined)) {
    fail("--external-evidence and --external-evidence-operator-policy-sha256 must be provided together");
  }
  return values;
}

function assertSafeEvidenceFile(file) {
  if (!path.isAbsolute(file) || !fs.existsSync(file)) fail("--kernel-evidence must name an existing absolute file");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("--kernel-evidence must be a regular file, not a symlink");
  const relative = path.relative(fs.realpathSync(repositoryRoot), fs.realpathSync(file));
  if (!(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    fail("--kernel-evidence must resolve outside the repository");
  }
}

function assertSafeOutputDirectory(outputDirectory) {
  if (!path.isAbsolute(outputDirectory)) fail("--output-dir must be an absolute path outside the repository");
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
  if (!outside) fail("--output-dir must be outside the repository");
  if (fs.existsSync(outputDirectory)) {
    const outputStat = fs.lstatSync(outputDirectory);
    if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
      fail("--output-dir must be a real directory, not a symlink");
    }
  }
}

function readBoundedEvidence(file) {
  const stat = fs.statSync(file);
  if (stat.size <= 0 || stat.size > MAX_RELEASE_EVIDENCE_BYTES) {
    fail(`--kernel-evidence must be between 1 and ${MAX_RELEASE_EVIDENCE_BYTES} bytes`);
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size || bytes.length > MAX_RELEASE_EVIDENCE_BYTES) {
    fail("--kernel-evidence changed while it was being read");
  }
  return bytes;
}

function git(args, options = {}) {
  const result = childProcess.spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr);
  return result.stdout;
}

function readCommitJson(commit, repositoryPath) {
  return parseStrictJson(
    git(["show", `${commit}:${repositoryPath}`], { encoding: null }),
    `committed ${repositoryPath}`,
    1024 * 1024
  );
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

function parseStrictJson(bytes, label, maxSourceBytes) {
  try {
    return parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes,
      maxNodes: 250_000,
      maxDepth: 128,
      maxNumberCharacters: 128
    });
  } catch (error) {
    const code = typeof error?.code === "string" ? ` (${error.code})` : "";
    fail(`${label} is not strict bounded JSON${code}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(options.outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function writeBinary(name, value) {
  fs.writeFileSync(path.join(options.outputDirectory, name), value, { mode: 0o644 });
}

function fail(message) {
  process.stderr.write(`${String(message).trim()}\n`);
  process.exit(1);
}
