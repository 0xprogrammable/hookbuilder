import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { CENTRAL_APPLICATION_FILES } from "./cli-central-package.mjs";
import { CliFailure, sanitizeMessage } from "./cli-runtime.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import {
  AUTONOMOUS_ADMISSION_FILE_LIMITS,
  validateAutonomousApplicationManifest,
  validateAutonomousLaunchSpecification
} from "./autonomous-admission-contract.mjs";
import { AUTONOMOUS_APPLICATION_INPUT_DISCLAIMER } from "./application-input-contract.mjs";

const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_PACKAGE_BYTES = 768 * 1024;
const MAX_FILE_BYTES = AUTONOMOUS_ADMISSION_FILE_LIMITS;
const PUBLIC_BETA_DISCLAIMER = AUTONOMOUS_APPLICATION_INPUT_DISCLAIMER;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function snapshotLocalDraftPackage({ targetDirectory, applicationId, expectedDirectoryIdentity }) {
  validateApplicationId(applicationId);
  const directoryIdentity = readDirectoryIdentity(targetDirectory, "OUTPUT_DRAFT_INVALID");
  if (!sameIdentity(directoryIdentity, expectedDirectoryIdentity)) {
    invalidDraft("the local draft directory changed before its snapshot");
  }
  const names = fs.readdirSync(targetDirectory).sort(compareUtf8);
  if (!arraysEqual(names, [...CENTRAL_APPLICATION_FILES].sort(compareUtf8))) {
    invalidDraft("the local draft must contain exactly the frozen seven files");
  }

  const files = new Map();
  const fileIdentities = [];
  let totalBytes = 0;
  for (const fileName of CENTRAL_APPLICATION_FILES) {
    const observed = readRegularFileNoFollow(
      path.join(targetDirectory, fileName),
      MAX_FILE_BYTES[fileName]
    );
    totalBytes += observed.bytes.length;
    if (totalBytes > MAX_PACKAGE_BYTES) invalidDraft("the local draft exceeds the aggregate byte limit");
    files.set(fileName, observed.bytes);
    fileIdentities.push(Object.freeze({
      path: fileName,
      dev: observed.identity.dev,
      ino: observed.identity.ino
    }));
  }
  if (!sameIdentity(readDirectoryIdentity(targetDirectory, "OUTPUT_DRAFT_INVALID"), directoryIdentity)) {
    invalidDraft("the local draft directory changed during its snapshot");
  }

  const validated = validateClosedPackageFiles({ applicationId, files });
  const centralPackage = centralPackageFromFiles({ applicationId, files, application: validated.application });
  return Object.freeze({
    kind: "local-unmerged-application-draft-v1",
    applicationId,
    directoryIdentity: Object.freeze(directoryIdentity),
    fileIdentities: Object.freeze(fileIdentities),
    packageDigest: packageDigest(centralPackage),
    centralPackage: Object.freeze(centralPackage)
  });
}

export function validateLocalDraftReplacement({
  draftSnapshot,
  nextCentralPackage,
  applicationId,
  centralBaseCommit,
  centralBaseExistingApplication,
  centralBasePriorApplication
}) {
  validateApplicationId(applicationId);
  if (
    !COMMIT_PATTERN.test(centralBaseCommit ?? "")
    || typeof centralBaseExistingApplication !== "boolean"
    || (centralBaseExistingApplication && centralBasePriorApplication === null)
    || (!centralBaseExistingApplication && centralBasePriorApplication !== null)
  ) {
    throw new CliFailure(
      "OUTPUT_DRAFT_BASE_INVALID",
      "replace-draft requires one internally consistent immutable central base observation",
      { exitCode: 1 }
    );
  }
  const prior = validateSnapshot(draftSnapshot, applicationId);
  const next = validateClosedCentralPackage(nextCentralPackage, applicationId);
  const expectedRevision = centralBaseExistingApplication
    ? centralBasePriorApplication.applicationRevision + 1
    : 1;
  if (prior.application.applicationRevision !== expectedRevision) {
    invalidDraft("the local draft revision is not the single next revision authorized by immutable main");
  }
  if (next.application.applicationRevision !== expectedRevision) {
    invalidDraft("the replacement must remain on the same single next revision authorized by immutable main");
  }
  assertSameAutonomousSourceLineage(prior.application, next.application);
  if (centralBaseExistingApplication) {
    assertSameAutonomousSourceLineage(centralBasePriorApplication, prior.application);
  }
  if (prior.packageDigest === next.packageDigest) {
    invalidDraft("replace-draft requires materially different canonical package bytes");
  }
  return Object.freeze({
    priorApplication: prior.application,
    nextApplication: next.application,
    priorRecords: prior.records,
    priorDirectoryIdentity: draftSnapshot.directoryIdentity,
    priorFileIdentities: draftSnapshot.fileIdentities,
    priorPackageDigest: prior.packageDigest,
    nextPackageDigest: next.packageDigest
  });
}

function validateSnapshot(snapshot, applicationId) {
  if (
    !isExactObject(snapshot, [
      "applicationId",
      "centralPackage",
      "directoryIdentity",
      "fileIdentities",
      "kind",
      "packageDigest"
    ])
    || snapshot.kind !== "local-unmerged-application-draft-v1"
    || snapshot.applicationId !== applicationId
    || !DIGEST_PATTERN.test(snapshot.packageDigest ?? "")
    || !validIdentity(snapshot.directoryIdentity)
    || !Array.isArray(snapshot.fileIdentities)
    || snapshot.fileIdentities.length !== CENTRAL_APPLICATION_FILES.length
  ) {
    invalidDraft("the pre-network local draft snapshot is malformed");
  }
  const identities = snapshot.fileIdentities;
  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index];
    if (
      !isExactObject(identity, ["dev", "ino", "path"])
      || identity.path !== CENTRAL_APPLICATION_FILES[index]
      || !validIdentity(identity)
    ) {
      invalidDraft("the local draft snapshot contains an invalid file identity");
    }
  }
  const validated = validateClosedCentralPackage(snapshot.centralPackage, applicationId);
  if (validated.packageDigest !== snapshot.packageDigest) {
    invalidDraft("the local draft snapshot digest does not match its frozen package bytes");
  }
  return validated;
}

function validateClosedCentralPackage(centralPackage, applicationId) {
  if (
    !isExactObject(centralPackage, [
      "applicationRevision",
      "encoding",
      "fileCount",
      "fileOrder",
      "files",
      "generated",
      "stage",
      "targetDirectory",
      "validatorContract"
    ])
    || centralPackage.generated !== true
    || centralPackage.encoding !== "utf8"
    || centralPackage.validatorContract !== "autonomous-public-pr-application-v1"
    || centralPackage.targetDirectory !== `submissions/${applicationId}`
    || centralPackage.fileCount !== CENTRAL_APPLICATION_FILES.length
    || !arraysEqual(centralPackage.fileOrder, CENTRAL_APPLICATION_FILES)
    || !Array.isArray(centralPackage.files)
    || centralPackage.files.length !== CENTRAL_APPLICATION_FILES.length
  ) {
    invalidDraft("the local draft does not use the complete generated central-package contract");
  }
  const files = new Map();
  let totalBytes = 0;
  for (let index = 0; index < CENTRAL_APPLICATION_FILES.length; index += 1) {
    const fileName = CENTRAL_APPLICATION_FILES[index];
    const record = centralPackage.files[index];
    if (
      !isExactObject(record, ["byteLength", "content", "path", "sha256"])
      || record.path !== fileName
      || typeof record.content !== "string"
      || !Number.isInteger(record.byteLength)
      || record.byteLength < 1
      || record.byteLength > MAX_FILE_BYTES[fileName]
      || !DIGEST_PATTERN.test(record.sha256 ?? "")
    ) {
      invalidDraft("the local draft contains an invalid frozen file record");
    }
    const bytes = Buffer.from(record.content, "utf8");
    if (bytes.length !== record.byteLength || digest(bytes) !== record.sha256) {
      invalidDraft("a local draft file does not match its frozen byte length and SHA-256 digest");
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_PACKAGE_BYTES) invalidDraft("the local draft exceeds the aggregate byte limit");
    files.set(fileName, bytes);
  }
  const validated = validateClosedPackageFiles({ applicationId, files });
  if (
    centralPackage.applicationRevision !== validated.application.applicationRevision
    || centralPackage.stage !== "proposal"
  ) {
    invalidDraft("the central-package summary does not match application.json");
  }
  const records = CENTRAL_APPLICATION_FILES.map((fileName) => {
    const bytes = files.get(fileName);
    return Object.freeze({ path: fileName, bytes, byteLength: bytes.length, sha256: digest(bytes) });
  });
  return Object.freeze({
    ...validated,
    records: Object.freeze(records),
    packageDigest: packageDigest(centralPackage)
  });
}

function validateClosedPackageFiles({ applicationId, files }) {
  if (!(files instanceof Map) || !arraysEqual([...files.keys()], CENTRAL_APPLICATION_FILES)) {
    invalidDraft("the local draft package is incomplete or unordered");
  }
  const application = parseCanonicalJson(files.get("application.json"), "application.json", { trailingNewline: false });
  validateApplication(application, applicationId);
  const launch = parseCanonicalJson(files.get("launch.json"), "launch.json", { trailingNewline: false });
  try {
    validateAutonomousLaunchSpecification(launch);
  } catch {
    invalidDraft("the local draft launch specification is invalid");
  }
  if (launch.applicationId !== applicationId) invalidDraft("the local draft launch specification has another application id");
  validateMarkdown(files.get("PROPOSAL.md"), "PROPOSAL.md", "# Proposal");
  validateMarkdown(files.get("TEST_PLAN.md"), "TEST_PLAN.md", "# Test plan");
  validateMarkdown(files.get("THREAT_MODEL.md"), "THREAT_MODEL.md", "# Threat model");
  const compatibility = parseCanonicalJson(files.get("compatibility-report.json"), "compatibility-report.json");
  const evidence = parseCanonicalJson(files.get("evidence-index.json"), "evidence-index.json");
  validateCompatibility(compatibility, application);
  validateEvidence(evidence, application);
  return Object.freeze({ application, launch, compatibility, evidence });
}

function validateApplication(application, applicationId) {
  try {
    validateAutonomousApplicationManifest(application, { requireImmutableSourceHints: true });
  } catch {
    invalidDraft("the local draft application does not satisfy the autonomous manifest contract");
  }
  if (application.applicationId !== applicationId) invalidDraft("the local draft application id does not match its directory");
}

function validateCompatibility(report, application) {
  if (
    !isExactObject(report, ["applicationId", "disclaimer", "findings", "result", "schemaVersion", "source"])
    || report.schemaVersion !== 1
    || report.applicationId !== application.applicationId
    || report.disclaimer !== PUBLIC_BETA_DISCLAIMER
    || !new Set(["prototype-ready", "changes-required", "architecture-review-required", "tooling-blocked"])
      .has(report.result)
    || !Array.isArray(report.findings)
    || report.findings.length > 128
  ) {
    invalidDraft("the local draft compatibility report is malformed or overclaims its result");
  }
  validateSourceProjection(report.source, autonomousPrimarySource(application), "compatibility report");
  let previous = null;
  for (const finding of report.findings) {
    if (
      !isExactObject(finding, ["code", "evidenceIds", "path", "remediation", "severity", "summary"])
      || typeof finding.code !== "string"
      || typeof finding.path !== "string"
      || !boundedText(finding.remediation, 12, 800)
      || !boundedText(finding.summary, 12, 800)
      || !new Set(["informational", "warning", "blocker", "hard"]).has(finding.severity)
      || !Array.isArray(finding.evidenceIds)
    ) {
      invalidDraft("the local draft contains a malformed compatibility finding");
    }
    const key = `${finding.code}\0${finding.path}`;
    if (previous !== null && compareUtf8(previous, key) >= 0) invalidDraft("compatibility findings are not unique and sorted");
    previous = key;
  }
}

function validateEvidence(index, application) {
  if (
    !isExactObject(index, ["applicationId", "attestation", "evidence", "schemaVersion", "source"])
    || index.schemaVersion !== 1
    || index.applicationId !== application.applicationId
    || index.attestation !== "builder-declared-untrusted"
    || !Array.isArray(index.evidence)
    || index.evidence.length < 1
    || index.evidence.length > 128
  ) {
    invalidDraft("the local draft evidence index is malformed or does not remain explicitly untrusted");
  }
  validateSourceProjection(index.source, autonomousPrimarySource(application), "evidence index");
  let previous = null;
  for (const record of index.evidence) {
    if (
      !isExactObject(record, ["id", "kind", "scope", "sha256", "status", "url"])
      || typeof record.id !== "string"
      || !boundedText(record.scope, 12, 500)
      || typeof record.url !== "string"
      || (record.sha256 !== null && !DIGEST_PATTERN.test(record.sha256 ?? ""))
      || !new Set(["passed", "failed", "blocked", "not-run"]).has(record.status)
    ) {
      invalidDraft("the local draft contains a malformed evidence record");
    }
    if (previous !== null && compareUtf8(previous, record.id) >= 0) invalidDraft("evidence records are not unique and sorted");
    previous = record.id;
  }
}

function validateSourceProjection(projection, primary, label) {
  if (
    !isExactObject(projection, ["numericRepositoryId", "revisionObjectId", "treeObjectId"])
    || projection.numericRepositoryId !== primary.repositoryIdHint
    || projection.revisionObjectId !== primary.requestedRevisionHint
    || !COMMIT_PATTERN.test(projection.treeObjectId ?? "")
  ) {
    invalidDraft(`the local draft ${label} is not bound to the exact primary source authority`);
  }
}

function validateMarkdown(bytes, name, heading) {
  const source = decodeUtf8(bytes, name);
  if (
    !source.endsWith("\n")
    || source.includes("\r")
    || source.includes("\t")
    || hasForbiddenInvisibleOrBidi(source.replaceAll("\n", ""))
    || source.split("\n", 1)[0] !== heading
    || source.slice(heading.length + 1).trim().length < 40
    || /<[!/?A-Za-z]/u.test(source)
    || /&(?:#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/u.test(source)
    || /!\[[^\]]*\]\s*(?:\([^)]*\)|\[[^\]]*\])/su.test(source)
    || /(?:javascript|data|file|vbscript)\s*:/iu.test(source)
  ) {
    invalidDraft(`${name} is not a closed substantive public review document`);
  }
}

function parseCanonicalJson(bytes, name, { trailingNewline = true } = {}) {
  const source = decodeUtf8(bytes, name);
  if (source.includes("\r") || hasForbiddenInvisibleOrBidi(source.replaceAll("\n", ""))) invalidDraft(`${name} contains unsafe text`);
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    invalidDraft(`${name} is not valid JSON`);
  }
  const expected = `${canonicalJson(value)}${trailingNewline ? "\n" : ""}`;
  if (source !== expected) invalidDraft(`${name} is not exact canonical JSON`);
  return value;
}

function centralPackageFromFiles({ applicationId, files, application }) {
  const records = CENTRAL_APPLICATION_FILES.map((fileName) => {
    const bytes = files.get(fileName);
    return Object.freeze({
      path: fileName,
      content: decodeUtf8(bytes, fileName),
      byteLength: bytes.length,
      sha256: digest(bytes)
    });
  });
  return {
    targetDirectory: `submissions/${applicationId}`,
    stage: "proposal",
    applicationRevision: application.applicationRevision,
    fileCount: records.length,
    fileOrder: [...CENTRAL_APPLICATION_FILES],
    encoding: "utf8",
    generated: true,
    validatorContract: "autonomous-public-pr-application-v1",
    files: records
  };
}

function autonomousPrimarySource(application) {
  const primary = application.githubSources.find(({ sourceId }) => sourceId === application.primarySourceId);
  if (primary === undefined) invalidDraft("the local draft primary source is missing");
  return primary;
}

function assertSameAutonomousSourceLineage(left, right) {
  const project = (application) => [...application.githubSources]
    .map(({ sourceId, ownerHint, repositoryHint, repositoryIdHint }) => ({
      sourceId,
      ownerHint: ownerHint.toLowerCase(),
      repositoryHint: repositoryHint.toLowerCase(),
      repositoryIdHint
    }))
    .sort((a, b) => compareUtf8(a.sourceId, b.sourceId));
  if (canonicalJson(project(left)) !== canonicalJson(project(right))) {
    invalidDraft("replace-draft cannot change the primary or companion repository lineage");
  }
}

function packageDigest(centralPackage) {
  const hash = crypto.createHash("sha256");
  hash.update("programmable.local-unmerged-application-draft.v1\0", "utf8");
  for (const record of centralPackage.files) {
    hash.update(record.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(record.sha256, "utf8");
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function readRegularFileNoFollow(target, maximumBytes) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    const lexical = fs.lstatSync(target);
    if (lexical.isSymbolicLink() || !lexical.isFile() || lexical.nlink !== 1) {
      invalidDraft("a local draft file is not a singly-linked regular file");
    }
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(descriptor);
    if (
      !sameIdentity(lexical, before)
      || lexical.mode !== before.mode
      || !before.isFile()
      || before.nlink !== 1
      || (before.mode & 0o111) !== 0
      || before.size < 1
      || before.size > maximumBytes
    ) {
      invalidDraft("a local draft file is not a bounded, non-executable, singly-linked regular file");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      !sameIdentity(before, after)
      || before.mode !== after.mode
      || (after.mode & 0o111) !== 0
      || before.size !== after.size
      || bytes.length !== after.size
    ) {
      invalidDraft("a local draft file changed while it was being snapshotted");
    }
    return { bytes, identity: { dev: after.dev, ino: after.ino } };
  } catch (error) {
    if (error instanceof CliFailure) throw error;
    throw new CliFailure(
      "OUTPUT_DRAFT_INVALID",
      `a local draft file could not be read safely: ${sanitizeMessage(error?.message ?? "read failed")}`,
      { exitCode: 1 }
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readDirectoryIdentity(target, code) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new CliFailure(code, "the local draft directory is unavailable", { exitCode: 1 });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliFailure(code, "the local draft target must be a real directory", { exitCode: 1 });
  }
  return { dev: stat.dev, ino: stat.ino };
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string"
    && value.length >= minimum
    && value.length <= maximum
    && value.trim() === value
    && !hasForbiddenInvisibleOrBidi(value);
}

function decodeUtf8(bytes, name) {
  try {
    return decoder.decode(bytes);
  } catch {
    invalidDraft(`${name} is not valid UTF-8`);
  }
}

function validateApplicationId(applicationId) {
  if (typeof applicationId !== "string" || applicationId.length > 80 || !APPLICATION_ID_PATTERN.test(applicationId)) {
    invalidDraft("the local draft application id is not canonical");
  }
}

function isExactObject(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && arraysEqual(Object.keys(value).sort(compareUtf8), [...keys].sort(compareUtf8));
}

function validIdentity(value) {
  return value !== null
    && typeof value === "object"
    && Number.isInteger(value.dev)
    && Number.isInteger(value.ino)
    && value.dev >= 0
    && value.ino > 0;
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function invalidDraft(message) {
  throw new CliFailure("OUTPUT_DRAFT_INVALID", message, { exitCode: 1 });
}
