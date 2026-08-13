import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertInsideRepository } from "./repository-root.mjs";
import {
  CliFailure,
  sanitizeMessage
} from "./cli-runtime.mjs";
import { canonicalJson, submissionHash } from "./submission-core.mjs";
import { isExternalPackageReviewRecord } from "./package-dependency-contract.mjs";
import {
  isCanonicalReviewTargetPath,
  isGitLfsPointer,
  isSourceOrTestReviewKind,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { gitBinary } from "./cli-prepare-pr-transport.mjs";
import { compareUtf8 } from "./cli-prepare-pr-values.mjs";

const HEAD_PATH_BATCH_SIZE = 128;
const HEAD_SNAPSHOT_MAX_BYTES = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes
  + (2 * REVIEW_TARGET_CONTRACT_V1.maximumFileBytes);

export function selectDeclaredHeadBytes({
  repositoryRoot,
  commit,
  headFiles,
  declaredPaths,
  gitBinaryImplementation
}) {
  const selected = new Map();
  for (const filePath of [...declaredPaths.sourcePaths, ...declaredPaths.contractPaths]) {
    const bytes = headFiles.get(filePath) ?? gitBinary(
      repositoryRoot,
      ["cat-file", "blob", `${commit}:${filePath}`],
      gitBinaryImplementation,
      { code: "GIT_STATE_INVALID", message: "declared source bytes were absent from the exact HEAD snapshot" }
    );
    if (!(bytes instanceof Uint8Array)) {
      throw new CliFailure("GIT_STATE_INVALID", "declared source bytes were absent from the exact HEAD snapshot", {
        exitCode: 1
      });
    }
    selected.set(filePath, bytes);
  }
  return selected;
}

export function assertReviewTargetBoundToHead({
  repositoryRoot,
  commit,
  reviewTarget,
  gitBinaryImplementation
}) {
  const records = reviewTarget.files.filter((record) => !isExternalPackageReviewRecord(record));
  const snapshot = readHeadPathSnapshot({
    repositoryRoot,
    commit,
    paths: records.map((record) => record.path),
    gitBinaryImplementation,
    unavailableMessage: "review target tree or index state is unavailable"
  });
  const files = new Map();
  for (const record of records) {
    const entry = snapshot.get(record.path);
    if (entry === undefined || !["100644", "100755"].includes(entry.mode)) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "every review target entry must be a regular blob in the exact HEAD tree",
        { exitCode: 1 }
      );
    }
    if (entry.indexState !== "H") {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "prepare-pr rejects review files with hidden index flags or noncanonical index state",
        { exitCode: 1 }
      );
    }
    const { bytes } = entry;
    if (
      (isSourceOrTestReviewKind(record.kind) || record.path.toLowerCase().endsWith(".sol"))
      && isGitLfsPointer(bytes)
    ) {
      throw new CliFailure(
        "TOOLING_BLOCKED",
        `declared source/test Git LFS content is not materialized in HEAD: ${record.path}`,
        { exitCode: 1 }
      );
    }
    const observed = crypto.createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== record.bytes || observed !== record.sha256) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "review target bytes differ from the exact HEAD revision",
        { exitCode: 1 }
      );
    }
    files.set(record.path, bytes);
  }
  return { files };
}

export function resolvePrimaryAuthorityPaths(submission, reviewTarget) {
  const declared = [
    ["gate-status", submission?.implementation?.gateStatusPath],
    ["review-target", submission?.implementation?.reviewTargetPath]
  ];
  if (
    submission?.stage === "prototype"
    && declared.some(([, repositoryPath]) => typeof repositoryPath !== "string")
  ) {
    throw new CliFailure(
      "PACKAGE_INVALID",
      "prototype preparation requires exact gate-status and review-target authority paths",
      { exitCode: 1 }
    );
  }
  const reviewPaths = new Set(reviewTarget.files.map((record) => record.path));
  const authorityPaths = [];
  const seen = new Set();
  for (const [label, repositoryPath] of declared) {
    if (repositoryPath === null || repositoryPath === undefined) continue;
    if (
      !isCanonicalReviewTargetPath(repositoryPath)
      || seen.has(repositoryPath)
      || reviewPaths.has(repositoryPath)
    ) {
      throw new CliFailure(
        "REVIEW_TARGET_INVALID",
        `${label} must be one unique primary authority path outside the review-target subject`,
        { exitCode: 1 }
      );
    }
    seen.add(repositoryPath);
    authorityPaths.push(repositoryPath);
  }
  return Object.freeze(authorityPaths.sort(compareUtf8));
}

export function assertPrimaryAuthorityPathsBoundToHead({
  repositoryRoot,
  commit,
  authorityPaths,
  gitBinaryImplementation
}) {
  const snapshot = readHeadPathSnapshot({
    repositoryRoot,
    commit,
    paths: authorityPaths,
    gitBinaryImplementation,
    unavailableMessage: "primary authority tree or index state is unavailable"
  });
  const files = new Map();
  for (const repositoryPath of authorityPaths) {
    let worktreePath;
    try {
      const lexicalPath = path.resolve(repositoryRoot, repositoryPath);
      worktreePath = assertInsideRepository(repositoryRoot, lexicalPath);
      if (worktreePath !== lexicalPath) throw new Error("symbolic aliases are not allowed");
    } catch {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "primary authority path is not one regular in-repository file",
        { exitCode: 1 }
      );
    }
    const worktreeBytes = readStableAuthorityFile(worktreePath, repositoryPath);
    const entry = snapshot.get(repositoryPath);
    if (entry === undefined || !["100644", "100755"].includes(entry.mode)) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "every primary authority file must be one regular blob in the exact HEAD tree",
        { exitCode: 1 }
      );
    }
    if (entry.indexState !== "H") {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "prepare-pr rejects primary authority files with hidden index flags or noncanonical index state",
        { exitCode: 1 }
      );
    }
    const headBytes = entry.bytes;
    if (!headBytes.equals(worktreeBytes)) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "primary authority bytes differ from the exact HEAD revision",
        { exitCode: 1 }
      );
    }
    files.set(repositoryPath, headBytes);
  }
  return { files };
}

function readHeadPathSnapshot({
  repositoryRoot,
  commit,
  paths,
  gitBinaryImplementation,
  unavailableMessage
}) {
  if (paths.length === 0) return new Map();
  const uniquePaths = [...new Set(paths)].sort(compareUtf8);
  if (uniquePaths.length !== paths.length) {
    throw new CliFailure("GIT_STATE_INVALID", "exact HEAD snapshot paths must be unique", { exitCode: 1 });
  }
  const treeEntries = new Map();
  const indexEntries = new Map();
  for (let offset = 0; offset < uniquePaths.length; offset += HEAD_PATH_BATCH_SIZE) {
    const batch = uniquePaths.slice(offset, offset + HEAD_PATH_BATCH_SIZE);
    const treeBytes = gitBinary(
      repositoryRoot,
      ["ls-tree", "-z", "--full-tree", commit, "--", ...batch],
      gitBinaryImplementation,
      { message: unavailableMessage },
      { maxBuffer: HEAD_SNAPSHOT_MAX_BYTES }
    );
    for (const record of splitNulRecords(treeBytes)) {
      const match = /^(100644|100755|120000|160000|040000) (blob|commit|tree) ([0-9a-f]{40})\t(.+)$/u.exec(record);
      if (!match || treeEntries.has(match[4])) {
        throw new CliFailure("GIT_STATE_INVALID", unavailableMessage, { exitCode: 1 });
      }
      treeEntries.set(match[4], { mode: match[1], type: match[2], objectId: match[3] });
    }

    const indexBytes = gitBinary(
      repositoryRoot,
      ["ls-files", "-v", "-z", "--", ...batch],
      gitBinaryImplementation,
      { message: unavailableMessage },
      { maxBuffer: HEAD_SNAPSHOT_MAX_BYTES }
    );
    for (const record of splitNulRecords(indexBytes)) {
      const match = /^(.?) (.+)$/u.exec(record);
      if (!match || indexEntries.has(match[2])) {
        throw new CliFailure("GIT_STATE_INVALID", unavailableMessage, { exitCode: 1 });
      }
      indexEntries.set(match[2], match[1]);
    }
  }

  const objectIds = [...new Set(
    [...treeEntries.values()].filter(({ type }) => type === "blob").map(({ objectId }) => objectId)
  )];
  const objectBytes = readBatchBlobs({
    repositoryRoot,
    objectIds,
    gitBinaryImplementation,
    unavailableMessage
  });
  const snapshot = new Map();
  for (const repositoryPath of uniquePaths) {
    const treeEntry = treeEntries.get(repositoryPath);
    const bytes = treeEntry === undefined ? undefined : objectBytes.get(treeEntry.objectId);
    if (treeEntry === undefined || bytes === undefined || !indexEntries.has(repositoryPath)) continue;
    snapshot.set(repositoryPath, {
      ...treeEntry,
      indexState: indexEntries.get(repositoryPath),
      bytes
    });
  }
  return snapshot;
}

function readBatchBlobs({ repositoryRoot, objectIds, gitBinaryImplementation, unavailableMessage }) {
  if (objectIds.length === 0) return new Map();
  const input = Buffer.from(`${objectIds.join("\n")}\n`, "ascii");
  const output = gitBinary(
    repositoryRoot,
    ["cat-file", "--batch"],
    gitBinaryImplementation,
    { message: unavailableMessage },
    { input, maxBuffer: HEAD_SNAPSHOT_MAX_BYTES, timeout: 10_000 }
  );
  const blobs = new Map();
  let offset = 0;
  for (const expectedObjectId of objectIds) {
    const lineEnd = output.indexOf(0x0a, offset);
    if (lineEnd < 0) throw new CliFailure("GIT_STATE_INVALID", unavailableMessage, { exitCode: 1 });
    const header = output.subarray(offset, lineEnd).toString("ascii");
    const match = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(header);
    const byteLength = match === null ? NaN : Number(match[2]);
    const bodyStart = lineEnd + 1;
    const bodyEnd = bodyStart + byteLength;
    if (
      match === null
      || match[1] !== expectedObjectId
      || !Number.isSafeInteger(byteLength)
      || byteLength < 0
      || bodyEnd >= output.length
      || output[bodyEnd] !== 0x0a
    ) {
      throw new CliFailure("GIT_STATE_INVALID", unavailableMessage, { exitCode: 1 });
    }
    blobs.set(expectedObjectId, output.subarray(bodyStart, bodyEnd));
    offset = bodyEnd + 1;
  }
  if (offset !== output.length) {
    throw new CliFailure("GIT_STATE_INVALID", unavailableMessage, { exitCode: 1 });
  }
  return blobs;
}

function splitNulRecords(bytes) {
  if (bytes.length === 0) return [];
  if (bytes.at(-1) !== 0) {
    throw new CliFailure("GIT_STATE_INVALID", "Git returned a malformed NUL-delimited snapshot", { exitCode: 1 });
  }
  return bytes.subarray(0, -1).toString("utf8").split("\0");
}

export function readStableAuthorityFile(target, repositoryPath) {
  let expectedStat;
  try {
    expectedStat = fs.lstatSync(target);
  } catch {
    throw new CliFailure("WORKTREE_NOT_HEAD", "primary authority file is unavailable", { exitCode: 1 });
  }
  if (
    !expectedStat.isFile()
    || expectedStat.isSymbolicLink()
    || expectedStat.size > REVIEW_TARGET_CONTRACT_V1.maximumFileBytes
  ) {
    throw new CliFailure(
      "WORKTREE_NOT_HEAD",
      "primary authority file is not one bounded regular file",
      { exitCode: 1 }
    );
  }
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(descriptor);
    if (
      !openedStat.isFile()
      || openedStat.dev !== expectedStat.dev
      || openedStat.ino !== expectedStat.ino
      || openedStat.size !== expectedStat.size
    ) {
      throw new Error("identity changed");
    }
    const bytes = fs.readFileSync(descriptor);
    const finalStat = fs.fstatSync(descriptor);
    if (bytes.length !== openedStat.size || finalStat.size !== openedStat.size) {
      throw new Error("bytes changed");
    }
    return bytes;
  } catch {
    throw new CliFailure(
      "WORKTREE_NOT_HEAD",
      `primary authority file changed while it was read: ${repositoryPath}`,
      { exitCode: 1 }
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function assertPrimaryAuthorityDocuments({ submission, reviewTarget, files }) {
  const gateStatusPath = submission?.implementation?.gateStatusPath;
  if (typeof gateStatusPath === "string") {
    const gateStatus = parsePrimaryAuthorityJson(files.get(gateStatusPath), "gate status");
    if (gateStatus.reviewTargetHash !== reviewTarget.reviewTargetHash || !Array.isArray(gateStatus.gates)) {
      throw new CliFailure(
        "PACKAGE_INVALID",
        "the exact HEAD gate status does not bind the current review-target hash",
        { exitCode: 1 }
      );
    }
    for (const gate of gateStatus.gates) {
      if (gate?.status !== "completed") continue;
      if (
        !Array.isArray(gate.evidence)
        || gate.evidence.length === 0
        || gate.evidence.some((evidence) => evidence?.reviewTargetHash !== reviewTarget.reviewTargetHash)
      ) {
        throw new CliFailure(
          "PACKAGE_INVALID",
          "every completed gate evidence record in exact HEAD must bind the current review-target hash",
          { exitCode: 1 }
        );
      }
    }
  }

  const reviewTargetPath = submission?.implementation?.reviewTargetPath;
  if (typeof reviewTargetPath === "string") {
    const recorded = parsePrimaryAuthorityJson(files.get(reviewTargetPath), "review target");
    if (canonicalJson(recorded) !== canonicalJson(reviewTarget)) {
      throw new CliFailure(
        "PACKAGE_INVALID",
        "the exact HEAD review-target record differs from the current review subject",
        { exitCode: 1 }
      );
    }
  }
}

export function parsePrimaryAuthorityJson(bytes, label) {
  if (!Buffer.isBuffer(bytes)) {
    throw new CliFailure("PACKAGE_INVALID", `${label} is absent from the exact HEAD authority snapshot`, {
      exitCode: 1
    });
  }
  try {
    return parseBoundedStrictJsonBytes(bytes);
  } catch {
    throw new CliFailure("PACKAGE_INVALID", `${label} must be exact UTF-8 JSON in HEAD`, { exitCode: 1 });
  }
}

export function mergeHeadFileSnapshots(...snapshots) {
  const files = new Map();
  for (const snapshot of snapshots) {
    for (const [repositoryPath, bytes] of snapshot.files) {
      const previous = files.get(repositoryPath);
      if (previous !== undefined && !previous.equals(bytes)) {
        throw new CliFailure("GIT_STATE_CHANGED", "exact HEAD file snapshots disagree", { exitCode: 1 });
      }
      files.set(repositoryPath, bytes);
    }
  }
  return { files };
}

export function assertSameHeadFileSnapshot(expected, observed) {
  if (
    expected.files.size !== observed.files.size
    || [...expected.files].some(([repositoryPath, bytes]) => !observed.files.get(repositoryPath)?.equals(bytes))
  ) {
    throw new CliFailure(
      "GIT_STATE_CHANGED",
      "primary authority bytes changed while prepare-pr was building the bundle",
      { exitCode: 1 }
    );
  }
}

export function parseHeadSubmission(headFiles, submissionPath) {
  const bytes = headFiles.get(submissionPath);
  if (!Buffer.isBuffer(bytes)) {
    throw new CliFailure("PACKAGE_INVALID", "submission.json is absent from the exact HEAD review target", { exitCode: 1 });
  }
  try {
    return parseBoundedStrictJsonBytes(bytes);
  } catch {
    throw new CliFailure("PACKAGE_INVALID", "submission.json must be bounded duplicate-free UTF-8 JSON in HEAD", { exitCode: 1 });
  }
}

export function assertSubmissionIdentity(submission, reviewTarget) {
  let observed;
  try {
    observed = submissionHash(submission);
  } catch (error) {
    throw new CliFailure("PACKAGE_INVALID", `submission.json: ${sanitizeMessage(error.message)}`, { exitCode: 1 });
  }
  if (observed !== reviewTarget.submissionHash) {
    throw new CliFailure("GIT_STATE_CHANGED", "review target and exact HEAD submission identities differ", { exitCode: 1 });
  }
}

export function assertSameReviewTarget(expected, observed) {
  if (canonicalJson(expected) !== canonicalJson(observed)) {
    throw new CliFailure("GIT_STATE_CHANGED", "the review target changed while prepare-pr was building the bundle", { exitCode: 1 });
  }
}

export function partitionDeclaredPaths(files, additionalSourcePaths = []) {
  const sourcePaths = [];
  const contractPaths = [];
  for (const record of files) {
    if (isExternalPackageReviewRecord(record)) continue;
    const repositoryPath = record.path;
    (repositoryPath.endsWith(".sol") ? contractPaths : sourcePaths).push(repositoryPath);
  }
  sourcePaths.push(...additionalSourcePaths);
  sourcePaths.sort(compareUtf8);
  contractPaths.sort(compareUtf8);
  for (let index = 1; index < sourcePaths.length; index += 1) {
    if (sourcePaths[index - 1] === sourcePaths[index]) sourcePaths.splice(index--, 1);
  }
  if (sourcePaths.length + contractPaths.length > REVIEW_TARGET_CONTRACT_V1.maximumFiles) {
    throw new CliFailure(
      "REVIEW_TARGET_INVALID",
      `the public beta supports at most ${REVIEW_TARGET_CONTRACT_V1.maximumFiles} total review paths per exact revision`,
      { exitCode: 1 }
    );
  }
  return { sourcePaths, contractPaths };
}
