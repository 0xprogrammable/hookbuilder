import { TextDecoder } from "node:util";
import fs from "node:fs";
import path from "node:path";

import { createGhTransport } from "./github-application-core.mjs";
import {
  CENTRAL_GITHUB_BASE_BRANCH,
  CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID,
  CENTRAL_GITHUB_REPOSITORY,
  CliFailure,
  MAX_APPLICATION_BYTES,
  MAX_GITHUB_PACKAGE_FILES,
  MAX_OUTPUT_FILE_BYTES,
  MAX_OUTPUT_PACKAGE_BYTES,
  SHA256_PATTERN,
  canonicalJson,
  sha256Bytes
} from "./open-world-shared.mjs";
import { createOpenWorldRuntime } from "./open-world-runtime.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const MAX_SUBMISSION_BYTES = 4 * 1024 * 1024;

export const PREPARATION_HELP_COMMAND = 'node "$BUILDER_CLI" advanced open-world application --help';

/**
 * Recovers a pre-v0.11 Applicant Draft only when it is the unique, public,
 * exact V3 package for the selected clean Submission V2 source. This performs
 * GitHub GETs and writes only the already hash-bound package bytes into the
 * private Applicant workspace. It never evaluates candidate code or writes
 * to GitHub.
 */
export async function recoverExistingDraftPackageForProject({
  applicationPackagePath,
  repositoryRoot,
  source,
  submissionPath,
  transport,
  runtime
}) {
  try {
    const { applicationId, bytes } = loadExactSubmissionIdentity(repositoryRoot, submissionPath);
    return await recoverExistingDraftPackageFromBoundSource({
      applicationId,
      applicationPackagePath,
      repositoryRoot,
      source,
      submissionBytes: bytes,
      submissionPath,
      ...(transport === undefined ? {} : { transport }),
      ...(runtime === undefined ? {} : { runtime })
    });
  } catch (error) {
    return Object.freeze({
      found: false,
      materialized: false,
      status: Object.freeze({ ok: false, code: error?.code ?? "APPLICATION_DRAFT_ADOPTION_FAILED", details: error?.details ?? null })
    });
  }
}

export async function recoverExistingDraftPackageFromBoundSource({
  applicationId,
  applicationPackagePath,
  repositoryRoot,
  source,
  submissionBytes,
  submissionPath,
  transport = createGhTransport(),
  runtime = createOpenWorldRuntime()
}) {
  const viewer = runtime.normalizeGitHubViewer(await transport.getViewer());
  const central = runtime.normalizeGitHubRepository(
    await transport.getRepository(CENTRAL_GITHUB_REPOSITORY),
    "central repository"
  );
  if (
    central.fullName.toLowerCase() !== CENTRAL_GITHUB_REPOSITORY
    || central.id !== CENTRAL_GITHUB_NUMERIC_REPOSITORY_ID
    || central.private
    || central.fork
  ) {
    throw new CliFailure("CENTRAL_REPOSITORY_CHANGED", "the fixed public Submit Launch identity is unavailable", { exitCode: 1 });
  }

  const search = await transport.searchOpenPulls({
    centralRepository: CENTRAL_GITHUB_REPOSITORY,
    login: viewer.login,
    title: `[Application V3] ${applicationId}`
  });
  const candidate = selectUniqueDraftSearchCandidate({ search, applicationId, viewerId: viewer.id });
  if (candidate === null) return Object.freeze({ found: false, materialized: false });

  const pull = runtime.normalizeApplicationV3Pull(
    await transport.getPull(CENTRAL_GITHUB_REPOSITORY, candidate.number)
  );
  const revision = applicationRevisionFromTitle(pull.title, applicationId);
  if (
    revision === null
    || pull.number !== candidate.number
    || pull.user.id !== viewer.id
    || pull.state !== "open"
    || pull.draft !== true
    || pull.maintainerCanModify !== false
    || pull.base.ref !== CENTRAL_GITHUB_BASE_BRANCH
    || pull.base.repositoryId !== central.id
    || pull.base.repositorySlug.toLowerCase() !== CENTRAL_GITHUB_REPOSITORY
    || pull.head.repositorySlug === null
  ) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique prior Draft does not preserve its exact Applicant identity, Draft state, and fixed central target", { exitCode: 1 });
  }
  runtime.assertApplicationV3ReviewBranch(pull.head.ref, applicationId);
  const fork = runtime.normalizeGitHubRepository(
    await transport.getRepository(pull.head.repositorySlug),
    "Applicant Draft fork"
  );
  if (
    fork.id !== pull.head.repositoryId
    || fork.private
    || !fork.fork
    || fork.owner.id !== viewer.id
    || fork.parentId !== central.id
    || fork.permissions.push !== true
  ) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique prior Draft does not use the Applicant's exact public writable fork", { exitCode: 1 });
  }
  const head = runtime.normalizeGitHubRef(
    await transport.getRef(fork.fullName, pull.head.ref),
    pull.head.ref
  );
  if (head.commit !== pull.head.sha) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique prior Draft branch no longer resolves to its observed pull-request head", { exitCode: 1 });
  }

  const pullFiles = await runtime.readBoundedApplicationV3PullFiles(transport, pull);
  const targetDirectory = `submissions/${applicationId}/v3/revisions/${revision}`;
  const applicationPath = `${targetDirectory}/application.v3.json`;
  const roots = pullFiles.filter((record) => record.filename === applicationPath);
  if (
    roots.length !== 1
    || roots[0].status !== "added"
    || roots[0].previousFilename !== null
    || pullFiles.some((record) => (
      record.status !== "added"
      || record.previousFilename !== null
      || !record.filename.startsWith(`submissions/${applicationId}/v3/revisions/`)
    ))
  ) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique prior Draft does not contain one immutable Application V3 revision package", { exitCode: 1 });
  }

  const applicationBytes = runtime.decodeGitHubContent(
    await transport.getContent(fork.fullName, applicationPath, head.commit),
    applicationPath
  );
  const application = parseCanonicalApplication({ runtime, applicationBytes, applicationPath });
  if (
    application.applicationId !== applicationId
    || String(application.applicationRevision) !== revision
    || application?.builder?.githubUserId !== viewer.id
    || application?.source?.primary?.revisionObjectId !== source.headCommit
    || application?.source?.primary?.treeObjectId !== source.tree
    || application?.policyBindings?.submissionPath !== submissionPath
    || application?.policyBindings?.submissionSha256 !== sha256Bytes(submissionBytes)
  ) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique prior Draft does not bind this exact local Submission V2 source revision", { exitCode: 1 });
  }

  const records = boundPackageRecords({ runtime, application, applicationBytes, applicationPath, targetDirectory });
  for (const record of records) {
    if (record.bytes !== null) continue;
    const remotePath = `${targetDirectory}/${record.path}`;
    const bytes = runtime.decodeGitHubContent(
      await transport.getContent(fork.fullName, remotePath, head.commit),
      remotePath
    );
    if (bytes.length !== record.byteLength || sha256Bytes(bytes) !== record.sha256) {
      throw new CliFailure("APPLICATION_DRAFT_ADOPTION_PACKAGE_MISMATCH", `the prior Draft record ${record.path} differs from its immutable Application V3 binding`, { exitCode: 1 });
    }
    record.bytes = bytes;
  }

  const outputPlan = runtime.planNewExternalOutputDirectory(
    applicationPackagePath,
    [repositoryRoot],
    [repositoryRoot]
  );
  runtime.materializePackage(
    outputPlan,
    records,
    "verified existing Application V3 Draft package",
    () => {}
  );
  return Object.freeze({
    found: true,
    materialized: true,
    pullRequest: pull.number,
    applicationId,
    applicationRevision: revision,
    readOnly: true,
    writePerformed: false,
    candidateCodeExecuted: false,
    approvalGranted: false,
    launchAuthorizationGranted: false
  });
}

export function selectUniqueDraftSearchCandidate({ search, applicationId, viewerId }) {
  if (
    search === null
    || typeof search !== "object"
    || Array.isArray(search)
    || !Number.isSafeInteger(search.total_count)
    || search.total_count < 0
    || !Array.isArray(search.items)
    || search.items.length > 100
    || search.total_count !== search.items.length
  ) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_AMBIGUOUS", "GitHub returned an unbounded or inconsistent prior Draft discovery set", { exitCode: 1 });
  }
  if (search.items.length === 0) return null;
  if (search.items.length !== 1) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_AMBIGUOUS", "more than one open Applicant Draft may match this Application", { exitCode: 1 });
  }
  const candidate = search.items[0];
  if (
    applicationRevisionFromTitle(candidate?.title, applicationId) === null
    || String(candidate?.user?.id ?? "") !== String(viewerId)
    || !Number.isSafeInteger(candidate?.number)
    || candidate.number < 1
  ) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the unique prior Draft search result does not bind the exact Application title and Applicant", { exitCode: 1 });
  }
  return Object.freeze({ number: candidate.number });
}

function loadExactSubmissionIdentity(repositoryRoot, submissionPath) {
  const absolute = path.join(repositoryRoot, submissionPath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_SUBMISSION_BYTES) {
    throw new CliFailure("PROJECT_PACKAGE_INVALID", "the selected Submission V2 must remain one bounded regular source file", { exitCode: 1 });
  }
  const bytes = fs.readFileSync(absolute);
  let value;
  try {
    value = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: MAX_SUBMISSION_BYTES, maxDepth: 256, maxNodes: 250_000 });
  } catch {
    throw new CliFailure("PROJECT_PACKAGE_INVALID", "the selected Submission V2 must remain canonical duplicate-free JSON", { exitCode: 1 });
  }
  const applicationId = value?.applicationId;
  if (typeof applicationId !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(applicationId)) {
    throw new CliFailure("PROJECT_PACKAGE_INVALID", "the selected Submission V2 has no safe Application identity", { exitCode: 1 });
  }
  return Object.freeze({ applicationId, bytes });
}

function applicationRevisionFromTitle(title, applicationId) {
  const prefix = `[Application V3] ${applicationId} revision `;
  if (typeof title !== "string" || !title.startsWith(prefix)) return null;
  const revision = title.slice(prefix.length);
  return /^[1-9][0-9]*$/u.test(revision) ? revision : null;
}

function parseCanonicalApplication({ runtime, applicationBytes, applicationPath }) {
  if (applicationBytes.length > MAX_APPLICATION_BYTES) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the prior Draft Application V3 root exceeds the bounded review window", { exitCode: 1 });
  }
  let text;
  let application;
  try {
    text = utf8.decode(applicationBytes);
    application = runtime.parseStrictCliJson(text, MAX_APPLICATION_BYTES);
  } catch {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the prior Draft Application V3 root is not canonical UTF-8 JSON", { exitCode: 1 });
  }
  if (text !== `${canonicalJson(application)}\n`) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the prior Draft Application V3 root is not canonical JSON", { exitCode: 1 });
  }
  return application;
}

function boundPackageRecords({ runtime, application, applicationBytes, applicationPath, targetDirectory }) {
  const reviewRecords = application?.reviewPackage?.records;
  if (!Array.isArray(reviewRecords)) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the prior Draft Application V3 root has no review-package records", { exitCode: 1 });
  }
  const records = [{
    path: "application.v3.json",
    bytes: applicationBytes,
    byteLength: applicationBytes.length,
    sha256: sha256Bytes(applicationBytes)
  }];
  let totalBytes = applicationBytes.length;
  for (const record of reviewRecords.filter((record) => record?.source === "application-package")) {
    if (
      typeof record?.path !== "string"
      || record.path.includes("/")
      || !Number.isSafeInteger(record.byteLength)
      || record.byteLength < 1
      || record.byteLength > MAX_OUTPUT_FILE_BYTES
      || !SHA256_PATTERN.test(record.sha256 ?? "")
    ) {
      throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the prior Draft declares an unsafe or unsupported Application-package record", { exitCode: 1 });
    }
    runtime.assertSafeApplicationPackagePath(record.path);
    if (record.path === "application.v3.json" || records.some((existing) => existing.path === record.path)) {
      throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the prior Draft reuses an Application-package record path", { exitCode: 1 });
    }
    totalBytes += record.byteLength;
    if (totalBytes > MAX_OUTPUT_PACKAGE_BYTES || records.length + 1 > MAX_GITHUB_PACKAGE_FILES) {
      throw new CliFailure("APPLICATION_GITHUB_SPLIT_REVIEW_REQUIRED", "the prior Draft Application V3 package exceeds the bounded recovery window", { exitCode: 1 });
    }
    records.push({ path: record.path, bytes: null, byteLength: record.byteLength, sha256: record.sha256 });
  }
  if (records.length < 2) {
    throw new CliFailure("APPLICATION_DRAFT_ADOPTION_MISMATCH", "the prior Draft has no bounded closed Application-package records", { exitCode: 1 });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}
