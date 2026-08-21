import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CliFailure, requireJsonResult, runBundledCommand } from "./cli-runtime.mjs";
import { canonicalJson } from "./submission-core.mjs";
import {
  applicantSourceRootArgs as sourceRootArgs,
  bindApplicantApplicationSources as bindApplicationSources,
  inspectApplicantSource as inspectSource,
  isExactApplicantKind as isExactKind,
  isRealDirectoryWithFile,
  loadApplicantApplicationDraftSource as loadApplicationDraftSource,
  projectTrustedTransportFailureEffects
} from "./submit-project-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const SUBMIT_PROJECT_WORKSPACE_FILE = "applicant-workspace.v1.json";

const MAX_STATE_BYTES = 256 * 1024;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CONTRACT_HISTORY_DIRECTORY = "submit-launch-contract";
const CONTRACT_SNAPSHOT_DIRECTORY = "snapshots";
const CONTRACT_EVALUATION_DIRECTORY = "evaluations";

export function projectAdoptedDraftTransport(previousTransport, pullRequest, lastStatus) {
  return { ...(previousTransport ?? {}), operation: "update", pullRequest, confirmationDigest: null, lastStatus };
}

export function prepareApplicationPackage({ pointer, repositoryRoot, workspace, applicationPackage, runTransport }) {
  const required = [
    [pointer.applicationDraft, "file"],
    [pointer.reviewPackage, "directory"],
    [pointer.securityAssessment, "file"],
    [pointer.securityEvidenceBindings, "file"]
  ];
  const missing = required.filter(([target, kind]) => !isExactKind(target, kind)).map(([target]) => path.relative(workspace, target));
  if (missing.length > 0) return { ok: false, missing };
  const preparedRevision = path.join(workspace, "prepared-revision");
  const initialDraft = loadApplicationDraftSource(pointer.applicationDraft);
  const sourceRoots = bindApplicationSources(initialDraft, repositoryRoot, workspace, inspectSource(repositoryRoot));
  if (!isRealDirectoryWithFile(preparedRevision, "application.v3.json")) {
    const prepared = runTransport([
      "prepare-revision",
      pointer.applicationDraft,
      ...sourceRootArgs(sourceRoots),
      "--output",
      preparedRevision,
      "--repository-root",
      repositoryRoot,
      "--write"
    ], repositoryRoot);
    if (!prepared.ok) return { ok: false, code: prepared.code, details: prepared.details };
  }
  if (!isRealDirectoryWithFile(applicationPackage, "application.v3.json")) {
    const assembled = runTransport([
      "application",
      path.dirname(path.join(repositoryRoot, pointer.submissionV2)),
      "--application-draft",
      path.join(preparedRevision, "application.v3.json"),
      "--review-package",
      pointer.reviewPackage,
      "--security-assessment",
      pointer.securityAssessment,
      "--security-evidence-bindings",
      pointer.securityEvidenceBindings,
      ...sourceRootArgs(sourceRoots),
      "--output",
      applicationPackage,
      "--repository-root",
      repositoryRoot,
      "--write"
    ], repositoryRoot);
    if (!assembled.ok) return { ok: false, code: assembled.code, details: assembled.details };
  }
  return { ok: true };
}

export function validateSubmissionV2(repositoryRoot, submissionPath) {
  const packageDirectory = path.dirname(path.join(repositoryRoot, submissionPath));
  try {
    const payload = requireJsonResult(runBundledCommand("open-world.mjs", ["validate", packageDirectory, "--repository-root", repositoryRoot], {
      cwd: repositoryRoot,
      failureCode: "PROJECT_PACKAGE_INVALID"
    }), "open-world.mjs");
    return { ok: payload?.result?.valid === true, report: payload?.result ?? payload };
  } catch (error) {
    const code = nestedErrorCode(error) ?? "PROJECT_PACKAGE_INVALID";
    return { ok: false, code, repair: repairForCode(code) };
  }
}

export function loadSubmissionDocument(repositoryRoot, submissionPath) {
  const target = path.join(repositoryRoot, submissionPath);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 8 * 1024 * 1024) {
    throw new CliFailure("PROJECT_PACKAGE_INVALID", "Submission V2 must be one bounded regular tracked file", { exitCode: 1 });
  }
  try {
    return parseBoundedStrictJsonBytes(fs.readFileSync(target), {
      maxSourceBytes: 8 * 1024 * 1024,
      maxDepth: 256,
      maxNodes: 250_000
    });
  } catch {
    throw new CliFailure("PROJECT_PACKAGE_INVALID", "Submission V2 must be bounded duplicate-free UTF-8 JSON", { exitCode: 1 });
  }
}

export function validateApplication(applicationPackage, sourceRoots, repositoryRoot, runTransport = runOpenWorld) {
  const status = runTransport(["validate-application", applicationPackage, ...sourceRootArgs(sourceRoots)], repositoryRoot);
  if (status.ok) return { ok: true, report: status.result };
  const code = status.code;
  return {
    ok: false,
    code,
    causeClass: code.includes("INTEGRATION") ? "INTEGRATION" : "PROJECT",
    state: code.includes("INTEGRATION") ? "INTEGRATION_PENDING" : "NEEDS_PROJECT_PACKAGE",
    summary: code.includes("INTEGRATION")
      ? "The closed package needs an unavailable or mismatched integration binding."
      : "The closed Application V3.1 package is not valid for its exact source revision.",
    repair: repairForCode(code)
  };
}

export function runOpenWorld(args, repositoryRoot) {
  try {
    const payload = requireJsonResult(runBundledCommand("open-world.mjs", args, {
      cwd: repositoryRoot,
      failureCode: "APPLICATION_TRANSPORT_FAILED",
      githubTransport: new Set(["prepare-revision", "status", "submit", "update"]).has(args[0])
    }), "open-world.mjs");
    return { ok: true, result: payload.result ?? payload };
  } catch (error) {
    return { ok: false, code: nestedErrorCode(error) ?? "APPLICATION_TRANSPORT_FAILED", details: error.details ?? null };
  }
}

export function transportFailure({ status, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, writePerformed = false, compatibility = null }) {
  const code = status.code;
  const trustedEffects = projectTrustedTransportFailureEffects(status);
  const effectiveWritePerformed = writePerformed || trustedEffects.writePerformed;
  const causeClass = classifyTransportCause(code);
  const currentState = causeClass === "AUTHORITY"
    ? "NEEDS_GITHUB_AUTH"
    : "INTEGRATION_PENDING";
  const diagnostic = finding(
    code,
    causeClass,
    summaryForCode(code),
    repairForCode(code),
    command,
    effectiveWritePerformed
  );
  const transport = trustedEffects.partialWrite === null
    ? null
    : {
        ...(previous?.transport ?? {}),
        failure: trustedEffects.partialWrite
      };
  const state = createState({ repositoryRoot, workspace, source, previous, submissionPaths, currentState, diagnostics: [diagnostic], compatibility, transport });
  persistWorkspaceState(statePath, state);
  return blockedResult(state, [diagnostic], command, verbose, status.details, effectiveWritePerformed);
}

export function createState({ repositoryRoot, workspace, source, previous, submissionPaths = [], currentState, diagnostics, transport = null, compatibility = null, submitLaunchEvaluation = null, workspacePersisted = true }) {
  const state = {
    schemaVersion: "1.0.0",
    kind: "programmable-applicant-workspace",
    state: currentState,
    source: {
      repositoryRoot,
      branch: source.branch,
      commit: source.headCommit,
      tree: source.tree,
      gitStatusSha256: source.gitStatusSha256
    },
    paths: {
      submissionV2: submissionPaths.length === 1 ? path.join(repositoryRoot, submissionPaths[0]) : null,
      applicationPackage: path.join(workspace, "application-package"),
      mutationReceipt: path.join(workspace, "application-v3-mutation-receipt.json")
    },
    diagnostics: diagnostics.slice(0, 3),
    compatibility: compatibility ?? previous?.compatibility ?? null,
    submitLaunch: submitLaunchEvaluation?.history ?? previous?.submitLaunch ?? null,
    transport: transport ?? previous?.transport ?? null,
    authority: {
      reviewGranted: false,
      approvalGranted: false,
      deploymentGranted: false,
      launchGranted: false
    }
  };
  Object.defineProperty(state, "workspacePersisted", { value: workspacePersisted, enumerable: false });
  Object.defineProperty(state, "submitLaunchRecords", {
    value: submitLaunchEvaluation?.records ?? previous?.submitLaunchRecords ?? null,
    enumerable: false
  });
  return state;
}

export function createSubmitLaunchEvaluation({ previous, snapshot, workspace, event, status, code }) {
  if (
    snapshot?.schemaVersion !== "programmable.submit-launch-contract-snapshot.v1"
    || !SHA256_PATTERN.test(snapshot?.snapshotBinding?.snapshotSha256 ?? "")
    || !SHA256_PATTERN.test(snapshot?.projectStage?.stageSha256 ?? "")
    || snapshot?.projectStage?.stage !== "submit"
    || !new Set(["CURRENT", "DRIFT"]).has(status)
  ) {
    throw new CliFailure("WORKSPACE_SNAPSHOT_INVALID", "Submit Launch evaluation input is invalid", { exitCode: 2 });
  }
  const historyRoot = path.join(workspace, CONTRACT_HISTORY_DIRECTORY);
  const snapshotWithoutDigest = {
    schemaVersion: "programmable.submit-launch-workspace-snapshot.v1",
    contractSchemaVersion: snapshot.schemaVersion,
    snapshotSha256: snapshot.snapshotBinding.snapshotSha256,
    snapshotBinding: snapshot.snapshotBinding,
    applicationContract: snapshot.applicationContract,
    authority: snapshot.authority
  };
  const snapshotRecord = {
    ...snapshotWithoutDigest,
    recordSha256: sha256CanonicalValue(snapshotWithoutDigest)
  };
  const snapshotPath = path.join(
    historyRoot,
    CONTRACT_SNAPSHOT_DIRECTORY,
    `${snapshotRecord.recordSha256.slice("sha256:".length)}.json`
  );
  const priorHead = previous?.evaluationHead ?? null;
  if (
    priorHead !== null
    && (
      !Number.isSafeInteger(priorHead.sequence)
      || priorHead.sequence < 1
      || !SHA256_PATTERN.test(priorHead.evaluationSha256 ?? "")
    )
  ) throw new CliFailure("WORKSPACE_EVALUATION_HISTORY_INVALID", "Applicant evaluation head is invalid", { exitCode: 2 });
  const receiptWithoutDigest = {
    schemaVersion: "programmable.submit-launch-evaluation-receipt.v1",
    sequence: (priorHead?.sequence ?? 0) + 1,
    previousEvaluationSha256: priorHead?.evaluationSha256 ?? null,
    event,
    status,
    code,
    snapshotSha256: snapshot.snapshotBinding.snapshotSha256,
    snapshotRecordSha256: snapshotRecord.recordSha256,
    stageSha256: snapshot.projectStage.stageSha256,
    stage: snapshot.projectStage.stage,
    routeState: snapshot.projectStage.routeState,
    currentness: snapshot.currentness,
    projectStage: snapshot.projectStage
  };
  const evaluationReceipt = {
    ...receiptWithoutDigest,
    evaluationSha256: sha256CanonicalValue(receiptWithoutDigest)
  };
  const evaluationPath = path.join(
    historyRoot,
    CONTRACT_EVALUATION_DIRECTORY,
    `${evaluationReceipt.evaluationSha256.slice("sha256:".length)}.json`
  );
  const snapshots = Array.isArray(previous?.snapshots)
    ? previous.snapshots.map((record) => structuredClone(record))
    : [];
  const existing = snapshots.find(({ recordSha256 }) => recordSha256 === snapshotRecord.recordSha256);
  const snapshotMetadata = {
    snapshotSha256: snapshotRecord.snapshotSha256,
    recordSha256: snapshotRecord.recordSha256,
    path: snapshotPath
  };
  if (existing === undefined) snapshots.push(snapshotMetadata);
  else if (canonicalJson(existing) !== canonicalJson(snapshotMetadata)) {
    throw new CliFailure("WORKSPACE_SNAPSHOT_COLLISION", "Submit Launch snapshot metadata changed for one content digest", { exitCode: 2 });
  }
  const evaluationHead = {
    sequence: evaluationReceipt.sequence,
    evaluationSha256: evaluationReceipt.evaluationSha256,
    previousEvaluationSha256: evaluationReceipt.previousEvaluationSha256,
    event,
    status,
    code,
    snapshotSha256: evaluationReceipt.snapshotSha256,
    snapshotRecordSha256: evaluationReceipt.snapshotRecordSha256,
    stageSha256: evaluationReceipt.stageSha256,
    stage: evaluationReceipt.stage,
    routeState: evaluationReceipt.routeState,
    path: evaluationPath
  };
  return {
    history: {
      schemaVersion: "programmable.submit-launch-workspace-history.v1",
      activeSnapshotSha256: snapshot.snapshotBinding.snapshotSha256,
      activeSnapshotRecordSha256: snapshotRecord.recordSha256,
      activeStageSha256: snapshot.projectStage.stageSha256,
      snapshots,
      evaluationHead
    },
    records: {
      snapshot: { path: snapshotPath, value: snapshotRecord },
      evaluation: { path: evaluationPath, value: evaluationReceipt }
    }
  };
}

function persistSubmitLaunchRecords(records) {
  if (records === null || records === undefined) return;
  for (const record of [records.snapshot, records.evaluation]) {
    const directory = path.dirname(record.path);
    ensurePrivateRecordDirectory(directory);
    const bytes = Buffer.from(`${canonicalJson(record.value)}\n`, "utf8");
    if (fs.existsSync(record.path)) {
      const stat = fs.lstatSync(record.path);
      if (!stat.isFile() || stat.isSymbolicLink() || !fs.readFileSync(record.path).equals(bytes)) {
        throw new CliFailure("WORKSPACE_IMMUTABLE_RECORD_CHANGED", "a content-addressed Submit Launch record already exists with different bytes", { exitCode: 2 });
      }
      continue;
    }
    const descriptor = fs.openSync(record.path, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const directoryDescriptor = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  }
}

function ensurePrivateRecordDirectory(directory) {
  const missing = [];
  let cursor = directory;
  while (!fs.existsSync(cursor)) {
    missing.push(cursor);
    cursor = path.dirname(cursor);
  }
  const parent = fs.lstatSync(cursor);
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new CliFailure("WORKSPACE_PATH_INVALID", "Submit Launch record parent is not one real directory", { exitCode: 2 });
  }
  for (const target of missing.reverse()) {
    fs.mkdirSync(target, { mode: 0o700 });
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("WORKSPACE_PATH_INVALID", "Submit Launch record directory is unsafe", { exitCode: 2 });
    }
  }
}

function sha256CanonicalValue(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function loadWorkspaceState(statePath, repositoryRoot, workspace) {
  const stat = fs.lstatSync(statePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_STATE_BYTES) {
    throw new CliFailure("WORKSPACE_STATE_INVALID", "Applicant workspace state must be one bounded regular non-symlink file", { exitCode: 2 });
  }
  let value;
  try {
    value = parseBoundedStrictJsonBytes(fs.readFileSync(statePath), { maxSourceBytes: MAX_STATE_BYTES });
  } catch {
    throw new CliFailure("WORKSPACE_STATE_INVALID", "Applicant workspace state must be duplicate-free canonical JSON", { exitCode: 2 });
  }
  if (
    value?.schemaVersion !== "1.0.0"
    || value?.kind !== "programmable-applicant-workspace"
    || value?.source?.repositoryRoot !== repositoryRoot
    || value?.paths?.applicationPackage !== path.join(workspace, "application-package")
    || value?.paths?.mutationReceipt !== path.join(workspace, "application-v3-mutation-receipt.json")
  ) {
    throw new CliFailure("WORKSPACE_STATE_INVALID", "Applicant workspace state does not match this exact repository and workspace", { exitCode: 2 });
  }
  return value;
}

export function persistWorkspaceState(statePath, state) {
  persistSubmitLaunchRecords(state.submitLaunchRecords);
  const bytes = Buffer.from(`${canonicalJson(state)}\n`, "utf8");
  if (bytes.length > MAX_STATE_BYTES) throw new CliFailure("WORKSPACE_STATE_INVALID", "Applicant workspace state exceeds its bounded size", { exitCode: 2 });
  const workspace = path.dirname(statePath);
  const temporary = path.join(workspace, `.applicant-workspace-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`);
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, statePath);
  const directory = fs.openSync(workspace, "r");
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

export function blockedResult(state, diagnostics, safeNextCommand, verbose, details = null, writePerformed = false) {
  return {
    exitCode: 1,
    result: renderResult(state, diagnostics, safeNextCommand, verbose, details, writePerformed)
  };
}

export function usefulResult(state, safeNextCommand, verbose, details = null, writePerformed = false) {
  return {
    exitCode: 0,
    result: renderResult(state, [], safeNextCommand, verbose, details, writePerformed)
  };
}

function renderResult(state, diagnostics, safeNextCommand, verbose, details, writePerformed) {
  const summary = diagnostics[0]?.summary ?? summaryForState(state.state);
  const result = {
    state: state.state,
    summary,
    nextAction: safeNextCommand,
    diagnostics: diagnostics.slice(0, 3),
    writePerformed,
    safeNextCommand,
    workspace: {
      root: path.dirname(state.paths.applicationPackage),
      stateFile: path.join(path.dirname(state.paths.applicationPackage), SUBMIT_PROJECT_WORKSPACE_FILE),
      statePersisted: state.workspacePersisted !== false,
      sourceCommit: state.source.commit,
      sourceTree: state.source.tree,
      confirmationDigest: state.transport?.confirmationDigest ?? null,
      pullRequest: state.transport?.pullRequest ?? null
    }
  };
  if (verbose) result.details = details;
  return result;
}

export function enrichJourneyOutcome(outcome) {
  const safeNextCommand = outcome?.result?.safeNextCommand ?? "node \"$BUILDER_CLI\" submit-project --help";
  return {
    ...outcome,
    result: {
      ...outcome.result,
      summary: outcome.result.summary ?? outcome.result.diagnostics?.[0]?.summary ?? summaryForState(outcome.result.state),
      nextAction: outcome.result.nextAction ?? safeNextCommand
    }
  };
}

export function finding(code, causeClass, summary, repair, safeNextCommand, writePerformed = false) {
  return { code, causeClass, summary, repair, safeNextCommand, writePerformed };
}

export function projectRemoteState(status) {
  const projected = JSON.stringify(status ?? {});
  if (/changes.requested/iu.test(projected)) return "CHANGES_REQUESTED";
  if (/checks.running|pending|queued|in.progress/iu.test(projected)) return "CHECKS_RUNNING";
  if (/review.required|unreviewed|draft/iu.test(projected)) return "REVIEW_REQUIRED";
  return "DRAFT_OPEN";
}

export function planBindsSubmitLaunchContract(plan, snapshot) {
  return plan?.submitLaunchContract?.snapshotSha256 === snapshot?.snapshotBinding?.snapshotSha256
    && plan?.submitLaunchContract?.stageSha256 === snapshot?.projectStage?.stageSha256;
}

function summaryForState(state) {
  if (state === "READY_FOR_CONFIRMATION") return "The current Submit Launch snapshot and Draft plan are ready for exact confirmation.";
  if (state === "DRAFT_OPEN") return "The Applicant Draft is open and bound to the recorded Submit Launch snapshot.";
  if (state === "CHECKS_RUNNING") return "The Applicant Draft is open and its protected checks are still running.";
  if (state === "REVIEW_REQUIRED") return "The Applicant Draft is waiting for maintainer review.";
  if (state === "CHANGES_REQUESTED") return "The Applicant Draft needs the requested project changes before it can continue.";
  if (state === "NEEDS_PROJECT_PACKAGE") return "The project needs one exact package repair before submission can continue.";
  if (state === "NEEDS_PUBLIC_SOURCE") return "The project needs its exact public source closure before submission can continue.";
  if (state === "NEEDS_GITHUB_AUTH") return "GitHub Applicant authority is required before the Draft can be opened.";
  return "The Submit Launch integration needs the named prerequisite before it can continue.";
}

export function compactPlan(plan) {
  return {
    action: plan?.action ?? null,
    applicationId: plan?.applicationId ?? null,
    applicationRevision: plan?.applicationRevision ?? null,
    confirmationDigest: plan?.confirmationDigest ?? null,
    submitLaunchContract: plan?.submitLaunchContract ?? null,
    target: plan?.target ?? null,
    externalWrites: plan?.externalWrites ?? []
  };
}

export function safeCommand(repositoryRoot, workspace, { confirmation = null, resume = false, transport = "auto" } = {}) {
  const parts = [
    "node", "\"$BUILDER_CLI\"", "submit-project", shellQuote(repositoryRoot),
    "--workspace-root", shellQuote(workspace)
  ];
  if (transport !== "auto") parts.push("--transport", transport);
  if (resume) parts.push("--resume");
  if (confirmation !== null) parts.push("--confirm-external-write", confirmation);
  return parts.join(" ");
}

function classifyTransportCause(code) {
  if (/AUTH|LOGIN|PERMISSION|FORK_AUTHORITY/iu.test(code)) return "AUTHORITY";
  if (/PACKAGE|SOURCE|APPLICATION_V3_MATERIALIZATION/iu.test(code)) return "PROJECT";
  if (/GITHUB|INTEGRATION|CENTRAL|CONTRACT|NETWORK|TRANSPORT/iu.test(code)) return "INTEGRATION";
  return "PLATFORM";
}

function summaryForCode(code) {
  if (/AUTH|LOGIN/iu.test(code)) return "GitHub authentication or Applicant fork authority is unavailable.";
  if (/CENTRAL|CONTRACT|SCHEMA/iu.test(code)) return "The installed Builder and protected Submit Launch contract are not compatible at the exact current base.";
  if (/NETWORK|GITHUB_GET|REQUEST/iu.test(code)) return "The protected GitHub read could not be completed unambiguously.";
  if (/RECEIPT|PARTIAL_EXTERNAL_WRITE/iu.test(code)) return "A prior mutation needs exact read-only reconciliation before any retry.";
  return "The protected Applicant transport cannot continue at the current exact binding.";
}

function repairForCode(code) {
  if (/AUTH|LOGIN/iu.test(code)) return "Authenticate GitHub with an account that can create its own fork and Draft branch, then resume the same workspace.";
  if (/CENTRAL|CONTRACT|SCHEMA/iu.test(code)) return "Update to a Builder release compatible with the protected central contract, then recompute the plan.";
  if (/RECEIPT|PARTIAL_EXTERNAL_WRITE/iu.test(code)) return "Resume the same workspace so the immutable receipt is reconciled through read-only GitHub observations.";
  if (/PACKAGE|APPLICATION|SOURCE/iu.test(code)) return "Repair the exact named project or Application package binding, then resume; do not substitute evidence.";
  return "Resume after the named integration is available. The Builder will recompute every binding before any write.";
}

function nestedErrorCode(error) {
  return error?.details?.error?.code ?? error?.details?.result?.error?.code ?? error?.code ?? null;
}

export function normalizeFailure(error) {
  if (error instanceof CliFailure) return error;
  if (error?.code === "MULTI_REPOSITORY_WORKSPACE_INCOMPLETE" || error?.code === "PROJECT_SOURCE_CHANGED") {
    return new CliFailure(error.code, error.message, { exitCode: 1 });
  }
  return new CliFailure("SUBMIT_PROJECT_FAILED", "the Applicant journey failed without a safe diagnostic", { exitCode: 2 });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
