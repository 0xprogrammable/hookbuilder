#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  ApplicationHandoffError,
  buildApplicationHandoffPreviewV1
} from "./application-handoff-core.mjs";
import {
  canonicalJsonSha256V2,
  canonicalJsonV2
} from "./canonical-json-core.mjs";
import { parseCli, renderHelp } from "./cli-args.mjs";
import { CliFailure, emitFailure, emitSuccess } from "./cli-runtime.mjs";
import { inspectCleanProjectSource } from "./project-command-executor-core.mjs";
import { spawnSafeGitSync } from "./repository-root.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAXIMUM_INPUT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 4 * 1024 * 1024;
const spec = {
  command: "application-handoff",
  usage: "application-handoff preview --input <json> --repository-root <path> [--output <absolute-new-file>] [--write --confirm-local-write <sha256:...>]",
  summary: "Build an exact policy/source/draft-PR handoff preview. Read-only by default; never writes GitHub, approves, deploys, or launches.",
  positionals: { min: 1, max: 1, names: ["command"] },
  options: [
    { name: "--input", key: "input", type: "value", valueName: "absolute-json", description: "Separately retained application-handoff-v1 input outside the frozen source repository." },
    { name: "--repository-root", key: "repositoryRoot", type: "value", valueName: "path", description: "Exact clean local source worktree whose revision is rebound read-only." },
    { name: "--output", key: "output", type: "value", valueName: "absolute-new-file", description: "Optional new local file outside the source repository; previewing it performs no write." },
    { name: "--write", key: "write", type: "boolean", description: "Request the guarded local writer. The portable release currently fails closed without writing." },
    { name: "--confirm-local-write", key: "confirmation", type: "value", valueName: "sha256:...", description: "Exact digest returned by a prior no-write preview for the same output." }
  ]
};

if (process.argv.slice(2).some((value) => value === "--help" || value === "-h")) {
  process.stdout.write(`${renderHelp(spec)}\n`);
} else {
  try {
    const { options, positionals } = parseCli(spec, process.argv.slice(2));
    if (positionals[0] !== "preview") usage("the only supported command is preview");
    if (options.input === null || options.repositoryRoot === null) usage("preview requires --input and --repository-root");
    if (options.write && (options.output === null || options.confirmation === null)) usage("--write requires --output and --confirm-local-write");
    if (!options.write && options.confirmation !== null) usage("--confirm-local-write is accepted only with --write");

    const repositoryRoot = realDirectory(options.repositoryRoot, "REPOSITORY_REQUIRED");
    const input = snapshotInput(repositoryRoot, options.input);
    const preview = buildApplicationHandoffPreviewV1(input.document);
    const localSourceValidation = validateLocalSource(repositoryRoot, preview.source);
    const bytes = Buffer.from(`${canonicalJsonV2(preview)}\n`, "utf8");
    if (bytes.length > MAXIMUM_OUTPUT_BYTES) throw new CliFailure("HANDOFF_OUTPUT_TOO_LARGE", "application handoff preview exceeds its bounded output", { exitCode: 1 });
    const outputPlan = options.output === null ? null : planOutput(repositoryRoot, options.output, preview, bytes);
    const writePerformed = false;
    if (options.write) {
      if (options.confirmation !== outputPlan.confirmationDigest) {
        throw new CliFailure("LOCAL_WRITE_CONFIRMATION_MISMATCH", "local handoff write confirmation does not match the exact current preview and output target", { exitCode: 1 });
      }
      assertInputUnchanged(input);
      assertOutputParentUnchanged(outputPlan);
      validateLocalSource(repositoryRoot, preview.source);
      throw new CliFailure("LOCAL_WRITE_UNAVAILABLE", "the portable handoff client has no reviewed descriptor-bound local writer; use the canonical preview bytes without claiming a materialized file", { exitCode: 1 });
    }
    emitSuccess("handoff", {
      preview,
      localSourceValidation,
      handoffBytes: { byteLength: bytes.length, sha256: sha256(bytes) },
      localWritePlan: outputPlan === null ? null : {
        outputPath: outputPlan.outputPath,
        confirmationDigest: outputPlan.confirmationDigest,
        outputMustRemainNew: true
      },
      writeRequested: options.write,
      writePerformed,
      networkAccessed: false,
      externalActionsPerformed: []
    });
  } catch (error) {
    const failure = error instanceof ApplicationHandoffError
      ? new CliFailure(error.code, error.message, { exitCode: 1 })
      : error instanceof CliFailure
        ? error
        : new CliFailure("HANDOFF_PREVIEW_FAILED", error instanceof Error ? error.message : "application handoff preview failed", { exitCode: 2 });
    process.exitCode = emitFailure("handoff", failure);
  }
}

function snapshotInput(repositoryRoot, inputPath) {
  if (!path.isAbsolute(inputPath)) {
    throw new CliFailure("HANDOFF_INPUT_PATH_INVALID", "handoff input must be one absolute file outside the source repository", { exitCode: 1 });
  }
  const requested = path.resolve(inputPath);
  let requestedStat;
  let resolved;
  try {
    requestedStat = fs.lstatSync(requested, { bigint: true });
    resolved = fs.realpathSync(requested);
  } catch {
    throw new CliFailure("HANDOFF_INPUT_UNAVAILABLE", "handoff input file is unavailable", { exitCode: 1 });
  }
  const relative = path.relative(repositoryRoot, resolved);
  if (!isOutsideRoot(relative)) {
    throw new CliFailure("HANDOFF_INPUT_PATH_INVALID", "handoff input must remain completely outside the source repository", { exitCode: 1 });
  }
  if (!requestedStat.isFile() || requestedStat.isSymbolicLink() || requestedStat.size < 2n || requestedStat.size > BigInt(MAXIMUM_INPUT_BYTES)) {
    throw new CliFailure("HANDOFF_INPUT_INVALID", "handoff input must be a bounded regular non-symlink file", { exitCode: 1 });
  }
  const stat = fs.lstatSync(resolved, { bigint: true });
  const bytes = fs.readFileSync(resolved);
  let document;
  try {
    document = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: MAXIMUM_INPUT_BYTES });
  } catch {
    throw new CliFailure("HANDOFF_INPUT_INVALID", "handoff input must be duplicate-free strict UTF-8 JSON", { exitCode: 1 });
  }
  return {
    path: resolved,
    bytes,
    sha256: sha256(bytes),
    identity: statIdentity(stat),
    document
  };
}

function validateLocalSource(repositoryRoot, source) {
  let local;
  try {
    local = inspectCleanProjectSource(repositoryRoot);
  } catch (error) {
    throw new CliFailure("PROJECT_SOURCE_DRIFT", error instanceof Error ? error.message : "local source revision could not be verified", { exitCode: 1 });
  }
  if (
    local.headCommit !== source.revisionObjectId
    || local.tree !== source.treeObjectId
    || local.branch !== source.branch
  ) {
    throw new CliFailure("PROJECT_SOURCE_DRIFT", "local source commit, tree, or branch differs from the exact handoff binding", { exitCode: 1 });
  }
  const remote = spawnSafeGitSync(["remote", "get-url", "--push", "origin"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024
  });
  const repositoryUri = remote.status === 0 ? canonicalGitHubRemote(remote.stdout.trim()) : null;
  if (repositoryUri !== source.repositoryUri) {
    throw new CliFailure("SOURCE_ORIGIN_INVALID", "local origin does not equal the exact canonical public GitHub source binding", { exitCode: 1 });
  }
  return {
    status: "LOCAL_SOURCE_REVISION_VALID",
    repositoryUri,
    branch: local.branch,
    revisionObjectId: local.headCommit,
    treeObjectId: local.tree,
    worktreeClean: true,
    networkAccessed: false
  };
}

function assertInputUnchanged(snapshot) {
  const stat = fs.lstatSync(snapshot.path, { bigint: true });
  const bytes = fs.readFileSync(snapshot.path);
  if (!stat.isFile() || stat.isSymbolicLink() || statIdentity(stat) !== snapshot.identity || sha256(bytes) !== snapshot.sha256 || !bytes.equals(snapshot.bytes)) {
    throw new CliFailure("HANDOFF_INPUT_DRIFT", "handoff input changed after preview", { exitCode: 1 });
  }
}

function planOutput(repositoryRoot, outputPath, preview, bytes) {
  if (!path.isAbsolute(outputPath)) usage("--output must be one absolute path");
  const parent = realDirectory(path.dirname(outputPath), "HANDOFF_OUTPUT_PARENT_INVALID");
  const target = path.join(parent, path.basename(outputPath));
  const relative = path.relative(repositoryRoot, target);
  if (!isOutsideRoot(relative)) {
    throw new CliFailure("HANDOFF_OUTPUT_PATH_INVALID", "handoff output must remain completely outside the source repository", { exitCode: 1 });
  }
  if (fs.existsSync(target)) throw new CliFailure("HANDOFF_OUTPUT_EXISTS", "handoff output must name one new file", { exitCode: 1 });
  const parentStat = fs.statSync(parent, { bigint: true });
  const payload = {
    schemaVersion: "programmable.application-handoff-local-write-plan.v1",
    previewDigest: preview.previewDigest,
    handoffSha256: sha256(bytes),
    outputPath: target,
    outputParent: { dev: parentStat.dev.toString(), ino: parentStat.ino.toString() },
    externalActionsPerformed: []
  };
  return {
    ...payload,
    confirmationDigest: canonicalJsonSha256V2(payload)
  };
}

function canonicalGitHubRemote(value) {
  let match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/iu.exec(value);
  if (match === null) match = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/iu.exec(value);
  if (match === null) match = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/iu.exec(value);
  if (match === null) return null;
  const repositoryUri = `https://github.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
  return /^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9._-]+$/u.test(repositoryUri)
    ? repositoryUri
    : null;
}

function isOutsideRoot(relative) {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function assertOutputParentUnchanged(plan) {
  if (fs.existsSync(plan.outputPath)) throw new CliFailure("HANDOFF_OUTPUT_EXISTS", "handoff output no longer names a new file", { exitCode: 1 });
  const parent = fs.realpathSync(path.dirname(plan.outputPath));
  const stat = fs.statSync(parent, { bigint: true });
  if (stat.dev.toString() !== plan.outputParent.dev || stat.ino.toString() !== plan.outputParent.ino) {
    throw new CliFailure("HANDOFF_OUTPUT_PARENT_DRIFT", "handoff output parent changed after preview", { exitCode: 1 });
  }
}

function realDirectory(value, code) {
  let resolved;
  try {
    resolved = fs.realpathSync(value);
  } catch {
    throw new CliFailure(code, "required directory is unavailable", { exitCode: 1 });
  }
  if (!fs.statSync(resolved).isDirectory()) throw new CliFailure(code, "required path is not a directory", { exitCode: 1 });
  return resolved;
}

function statIdentity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function usage(message) {
  throw new CliFailure("USAGE_ERROR", message, { exitCode: 2 });
}
