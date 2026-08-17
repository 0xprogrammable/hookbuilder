#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCli, renderHelp } from "./cli-args.mjs";
import { preflightProtectedApplicantCompatibility } from "./applicant-compatibility-github.mjs";
import { CliFailure, emitFailure, emitSuccess, requireJsonResult, runBundledCommand } from "./cli-runtime.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { discoverExistingDraft, planSubmitOrAdoptExistingDraft } from "./submit-project-draft-adoption.mjs";
import { PREPARATION_HELP_COMMAND, recoverExistingDraftPackageForProject } from "./submit-project-existing-draft-package.mjs";
import {
  applicantSourceRootArgs as sourceRootArgs,
  bindApplicantApplicationSources as bindApplicationSources,
  defaultApplicantWorkspacePath as defaultWorkspacePath,
  discoverTrackedApplicantFiles as discoverTrackedFiles,
  ensureApplicantWorkspaceDirectory as ensureWorkspaceDirectory,
  inspectApplicantSource as inspectSource,
  isExactApplicantKind as isExactKind,
  isRealDirectoryWithFile,
  loadApplicantApplicationDraftSource as loadApplicationDraftSource,
  loadApplicantApplicationPackageSnapshot as loadApplicationPackageSnapshot,
  loadApplicantPackagePointer,
  resolveApplicantRepository as resolveRepository,
  resolveApplicantWorkspace as resolveWorkspace,
  sameApplicantSource as sameSource
} from "./submit-project-core.mjs";

const WORKSPACE_FILE = "applicant-workspace.v1.json";
const MAX_STATE_BYTES = 256 * 1024;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const spec = {
  command: "submit-project",
  usage: "cli.mjs submit-project <repository-root> [--workspace-root <absolute-dir>] [--confirm-external-write <sha256:...>] [--resume] [--verbose]",
  summary: "Validate, resume, plan, submit, or read the status of one protected unreviewed Application V3.1 Draft. Only an exact fresh confirmation digest permits the existing trusted GitHub transport to write.",
  positionals: { min: 1, max: 1, names: ["repository-root"] },
  options: [
    { name: "--workspace-root", key: "workspaceRoot", type: "value", valueName: "absolute-dir", description: "Use one persistent outside-source workspace; the default is a repository-adjacent content-bound directory." },
    { name: "--confirm-external-write", key: "confirmation", type: "value", valueName: "sha256:...", description: "Authorize only the exact freshly recomputed Draft mutation plan." },
    { name: "--resume", key: "resume", type: "boolean", description: "Resume the exact persisted workspace and reconcile any mutation receipt before continuing." },
    { name: "--verbose", key: "verbose", type: "boolean", description: "Include bound internal phase details; the default stays concise." }
  ]
};

if (isMainModule()) await main();

async function main() {
  if (process.argv.slice(2).some((value) => value === "--help" || value === "-h")) {
    process.stdout.write(`${renderHelp(spec)}\n`);
    return;
  }
  try {
    const { options, positionals } = parseCli(spec, process.argv.slice(2));
    if (options.confirmation !== null && !SHA256_PATTERN.test(options.confirmation)) {
      throw new CliFailure("USAGE_ERROR", "--confirm-external-write must be one canonical sha256 digest", { exitCode: 2 });
    }
    const outcome = await runSubmitProjectJourney({ repositoryInput: positionals[0], ...options });
    emitSuccess("submit-project", outcome.result);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.exitCode = emitFailure("submit-project", normalizeFailure(error));
  }
}

export async function runSubmitProjectJourney({ repositoryInput, workspaceRoot, confirmation, resume, verbose }, adapters = {}) {
  const runtime = {
    readProjectDiscovery: ({ repositoryRoot, commit }) => ({
      submissionPaths: discoverTrackedFiles(repositoryRoot, commit, "submission.v2.json"),
      pointerPaths: discoverTrackedFiles(repositoryRoot, commit, "applicant-package.v1.json")
    }),
    atomicWorkspaceWrite: persistWorkspaceState,
    adoptExistingDraft: discoverExistingDraft,
    recoverExistingDraftPackage: recoverExistingDraftPackageForProject,
    runTransport: runOpenWorld,
    compatibilityPreflight: preflightProtectedApplicantCompatibility,
    ...adapters
  };
  const repositoryRoot = resolveRepository(repositoryInput);
  let source;
  try {
    source = inspectSource(repositoryRoot);
  } catch {
    const unboundWorkspace = workspaceRoot === null
      ? defaultWorkspacePath(repositoryRoot)
      : path.resolve(workspaceRoot);
    const command = safeCommand(repositoryRoot, unboundWorkspace, { resume: true });
    const diagnostic = finding(
      "PROJECT_PACKAGE_NOT_FOUND",
      "PROJECT",
      "The repository is not yet one clean exact Git source revision with a tracked project package.",
      "Create or select the exact public Git worktree and complete one Submission V2 package, then rerun.",
      command
    );
    return {
      exitCode: 1,
      result: {
        state: "NEEDS_PROJECT_PACKAGE",
        diagnostics: [diagnostic],
        writePerformed: false,
        safeNextCommand: command,
        workspace: {
          root: unboundWorkspace,
          stateFile: path.join(unboundWorkspace, WORKSPACE_FILE),
          statePersisted: false,
          sourceCommit: null,
          sourceTree: null,
          confirmationDigest: null,
          pullRequest: null
        }
      }
    };
  }
  const workspace = resolveWorkspace(repositoryRoot, workspaceRoot);
  const statePath = path.join(workspace, WORKSPACE_FILE);
  const previous = fs.existsSync(statePath) ? loadWorkspaceState(statePath, repositoryRoot, workspace) : null;
  if (resume && previous === null) {
    throw new CliFailure("WORKSPACE_STATE_NOT_FOUND", "--resume requires an existing exact applicant workspace state", { exitCode: 1 });
  }

  const command = safeCommand(repositoryRoot, workspace, { resume: true });
  if (previous !== null && !sameSource(previous.source, source)) {
    const diagnostic = finding(
      "PROJECT_SOURCE_CHANGED",
      "PROJECT",
      "The repository commit or root tree changed after this Applicant workspace was bound.",
      "Prepare or regenerate the project package for the new exact revision. The prior Draft plan is not reused.",
      command
    );
    const state = createState({ repositoryRoot, workspace, source, previous, currentState: "NEEDS_PROJECT_PACKAGE", diagnostics: [diagnostic], workspacePersisted: false });
    return blockedResult(state, [diagnostic], command, verbose);
  }

  const discovery = await runtime.readProjectDiscovery({ repositoryRoot, commit: source.headCommit, workspace, source });
  const pointerPaths = Array.isArray(discovery?.pointerPaths) ? discovery.pointerPaths : [];
  let submissionPaths = Array.isArray(discovery?.submissionPaths) ? discovery.submissionPaths : [];
  if (pointerPaths.length > 1) submissionPaths = [];
  let pointer = null;
  if (pointerPaths.length === 1) {
    try {
      pointer = loadApplicantPackagePointer(repositoryRoot, pointerPaths[0], workspace, submissionPaths);
    } catch (error) {
      const diagnostic = finding(
        error?.code ?? "PROJECT_PACKAGE_POINTER_INVALID",
        "PROJECT",
        "The tracked Applicant package pointer is invalid or unsafe.",
        "Repair the closed pointer without adding absolute, traversal, Git-control, or non-workspace semantic input paths.",
        command
      );
      const state = createState({ repositoryRoot, workspace, source, previous, submissionPaths, currentState: "NEEDS_PROJECT_PACKAGE", diagnostics: [diagnostic], workspacePersisted: false });
      return blockedResult(state, [diagnostic], command, verbose);
    }
  }
  if (pointer !== null) submissionPaths = [pointer.submissionV2];
  if (submissionPaths.length !== 1) {
    const ambiguous = pointerPaths.length > 1 || submissionPaths.length > 1;
    const diagnostic = !ambiguous
      ? finding(
          "PROJECT_PACKAGE_NOT_FOUND",
          "PROJECT",
          "No tracked Submission V2 package was found at the exact source commit.",
          "Complete one source-bound Submission V2 package. The Builder will not invent missing semantic inputs or evidence.",
          command
        )
      : finding(
          "PROJECT_PACKAGE_AMBIGUOUS",
          "PROJECT",
          "More than one tracked Submission V2 package was found, so the Applicant subject is ambiguous.",
          "Retain exactly one Applicant package pointer or one Submission V2 subject for this repository before resuming.",
          command
        );
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState: "NEEDS_PROJECT_PACKAGE",
      diagnostics: [diagnostic],
      workspacePersisted: false
    });
    return blockedResult(state, [diagnostic], command, verbose);
  }

  const submissionPath = submissionPaths[0];
  const validation = validateSubmissionV2(repositoryRoot, submissionPath);
  if (!validation.ok) {
    const diagnostic = finding(
      validation.code,
      "PROJECT",
      "The selected Submission V2 package is not valid and complete.",
      validation.repair,
      command
    );
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState: "NEEDS_PROJECT_PACKAGE",
      diagnostics: [diagnostic],
      workspacePersisted: false
    });
    return blockedResult(state, [diagnostic], command, verbose);
  }
  const compatibility = await runtime.compatibilityPreflight({ repositoryRoot, source });
  if (compatibility?.ok !== true) {
    const diagnostic = finding(
      compatibility?.code ?? "APPLICANT_COMPATIBILITY_PENDING",
      "INTEGRATION",
      compatibility?.summary ?? "The protected central compatibility contract could not be bound exactly.",
      compatibility?.repair ?? "Resume after the exact Builder and protected Submit Launch contract binding is available.",
      command
    );
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState: "INTEGRATION_PENDING",
      diagnostics: [diagnostic],
      workspacePersisted: false
    });
    return blockedResult(state, [diagnostic], command, verbose, { validation, compatibility });
  }
  ensureWorkspaceDirectory(repositoryRoot, workspace);
  const compatibilityBinding = compatibility.binding ?? null;

  const applicationPackage = path.join(workspace, "application-package");
  if (!isRealDirectoryWithFile(applicationPackage, "application.v3.json")) {
    const recovery = pointer === null ? await runtime.recoverExistingDraftPackage({ applicationPackagePath: applicationPackage, repositoryRoot, source, submissionPath }) : null;
    if (recovery?.status) return transportFailure({ status: recovery.status, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
    if (recovery?.found === true && recovery.materialized !== true) throw new CliFailure("APPLICATION_DRAFT_ADOPTION_FAILED", "existing Draft recovery returned no closed Application package", { exitCode: 2 });
    const prepared = pointer === null
      ? { ok: false, missing: ["tracked applicant-package.v1.json pointer"] }
      : prepareApplicationPackage({ pointer, repositoryRoot, workspace, applicationPackage, runTransport: runtime.runTransport });
    if (prepared.ok && !isRealDirectoryWithFile(applicationPackage, "application.v3.json")) {
      throw new CliFailure("APPLICATION_PACKAGE_INVALID", "Application preparation completed without one closed package", { exitCode: 2 });
    }
  }
  if (!isRealDirectoryWithFile(applicationPackage, "application.v3.json")) {
    const diagnostic = finding(
      "APPLICATION_PACKAGE_INPUTS_REQUIRED",
      "PROJECT",
      "Submission V2 is valid, but the closed Application V3.1 package has not been prepared in this workspace.",
      "Prepare the exact revision, review package, security inputs, and source bindings in the workspace. Missing evidence remains missing and is never synthesized.",
      PREPARATION_HELP_COMMAND
    );
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState: "NEEDS_PROJECT_PACKAGE",
      diagnostics: [diagnostic],
      compatibility: compatibilityBinding
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], diagnostic.safeNextCommand, verbose, { validation });
  }

  let applicationSnapshot;
  let sourceRoots;
  try {
    applicationSnapshot = loadApplicationPackageSnapshot(applicationPackage);
    sourceRoots = bindApplicationSources(applicationSnapshot.application, repositoryRoot, workspace, source);
  } catch (error) {
    const missingRoots = error?.code === "MULTI_REPOSITORY_WORKSPACE_INCOMPLETE";
    const diagnostic = finding(
      error?.code ?? "APPLICATION_PACKAGE_INVALID",
      "PROJECT",
      missingRoots
        ? "One or more exact source repositories are not mapped in the persistent Applicant workspace."
        : "The closed Application V3.1 package is invalid or changed.",
      missingRoots
        ? "Place each clean companion at workspace/sources/<repository-ref> with the exact declared commit and tree, then resume."
        : "Regenerate the exact closed package through the existing deterministic Application V3.1 generator, then resume.",
      command
    );
    const currentState = missingRoots ? "NEEDS_PUBLIC_SOURCE" : "NEEDS_PROJECT_PACKAGE";
    const state = createState({ repositoryRoot, workspace, source, previous, submissionPaths, currentState, diagnostics: [diagnostic], compatibility: compatibilityBinding });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], command, verbose);
  }
  const applicationValidation = validateApplication(applicationPackage, sourceRoots, repositoryRoot, runtime.runTransport);
  if (!applicationValidation.ok) {
    const diagnostic = finding(
      applicationValidation.code,
      applicationValidation.causeClass,
      applicationValidation.summary,
      applicationValidation.repair,
      command
    );
    const state = createState({ repositoryRoot, workspace, source, previous, submissionPaths, currentState: applicationValidation.state, diagnostics: [diagnostic], compatibility: compatibilityBinding });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], command, verbose, { validation, applicationValidation });
  }
  let pullRequest = previous?.transport?.pullRequest ?? null;
  let initialPlan = null;
  if (pullRequest === null) {
    const selection = await planSubmitOrAdoptExistingDraft({ applicationPackage: applicationSnapshot, applicationPackagePath: applicationPackage, repositoryRoot, sourceRoots, runTransport: runtime.runTransport, adoptExistingDraft: runtime.adoptExistingDraft });
    if (selection.status?.ok === false) return transportFailure({ status: selection.status, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
    pullRequest = selection.pullRequest;
    initialPlan = selection.status;
  }
  if (pullRequest !== null && confirmation === null) {
    const status = runtime.runTransport(["status", applicationPackage, "--pull-request", String(pullRequest), ...sourceRootArgs(sourceRoots)], repositoryRoot);
    if (!status.ok) return transportFailure({ status, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
    const currentState = projectRemoteState(status.result);
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState,
      diagnostics: [],
      compatibility: compatibilityBinding,
      transport: projectAdoptedDraftTransport(previous?.transport, pullRequest, status.result)
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return usefulResult(state, command, verbose, { validation, applicationValidation, remoteStatus: status.result });
  }
  const operation = pullRequest === null ? "submit" : "update";
  const operationArgs = [operation, applicationPackage];
  if (pullRequest !== null) operationArgs.push("--pull-request", String(pullRequest));
  operationArgs.push(...sourceRootArgs(sourceRoots), "--dry-run");
  const plan = initialPlan ?? runtime.runTransport(operationArgs, repositoryRoot);
  if (!plan.ok) return transportFailure({ status: plan, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
  const confirmationDigest = plan.result?.confirmationDigest;
  if (!SHA256_PATTERN.test(confirmationDigest)) {
    throw new CliFailure("SUBMISSION_PLAN_INVALID", "the protected transport returned no canonical confirmation digest", { exitCode: 2 });
  }
  if (confirmation === null) {
    const next = safeCommand(repositoryRoot, workspace, { confirmation: confirmationDigest });
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState: "READY_FOR_CONFIRMATION",
      diagnostics: [],
      compatibility: compatibilityBinding,
      transport: { operation, pullRequest, confirmationDigest, plan: compactPlan(plan.result) }
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return usefulResult(state, next, verbose, { validation, applicationValidation, plan: plan.result });
  }

  if (confirmation !== confirmationDigest) {
    const diagnostic = finding(
      "EXTERNAL_WRITE_CONFIRMATION_REQUIRED",
      "AUTHORITY",
      "The supplied confirmation digest does not match the exact freshly recomputed Draft plan.",
      "Review and confirm only the new current digest. No external write was attempted.",
      safeCommand(repositoryRoot, workspace, { confirmation: confirmationDigest })
    );
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState: "READY_FOR_CONFIRMATION",
      diagnostics: [diagnostic],
      compatibility: compatibilityBinding,
      transport: { operation, pullRequest, confirmationDigest, plan: compactPlan(plan.result) }
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], diagnostic.safeNextCommand, verbose, { validation, applicationValidation });
  }
  const receipt = path.join(workspace, "application-v3-mutation-receipt.json");
  const mutationArgs = [operation, applicationPackage];
  if (pullRequest !== null) mutationArgs.push("--pull-request", String(pullRequest));
  mutationArgs.push(...sourceRootArgs(sourceRoots), "--mutation-receipt", receipt);
  if (resume || fs.existsSync(receipt)) mutationArgs.push("--resume");
  mutationArgs.push("--confirm-external-write", confirmation);
  const mutation = runtime.runTransport(mutationArgs, repositoryRoot);
  if (!mutation.ok) return transportFailure({ status: mutation, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
  const newPullRequest = mutation.result?.target?.pullRequestNumber ?? pullRequest;
  if (!Number.isSafeInteger(newPullRequest) || newPullRequest < 1) {
    throw new CliFailure("SUBMISSION_READBACK_INVALID", "the confirmed Draft transport returned no exact pull request identity", { exitCode: 2 });
  }
  const status = runtime.runTransport(["status", applicationPackage, "--pull-request", String(newPullRequest), ...sourceRootArgs(sourceRoots)], repositoryRoot);
  if (!status.ok) return transportFailure({ status, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, writePerformed: true, compatibility: compatibilityBinding });
  const currentState = projectRemoteState(status.result);
  const state = createState({
    repositoryRoot,
    workspace,
    source,
    previous,
    submissionPaths,
    currentState,
    diagnostics: [],
    compatibility: compatibilityBinding,
    transport: { operation, pullRequest: newPullRequest, confirmationDigest: confirmation, lastStatus: status.result }
  });
  runtime.atomicWorkspaceWrite(statePath, state);
  return usefulResult(state, command, verbose, { validation, applicationValidation, mutation: mutation.result, remoteStatus: status.result }, true);
}
export function projectAdoptedDraftTransport(previousTransport, pullRequest, lastStatus) {
  return { ...(previousTransport ?? {}), operation: "update", pullRequest, confirmationDigest: null, lastStatus };
}
function prepareApplicationPackage({ pointer, repositoryRoot, workspace, applicationPackage, runTransport }) {
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
function validateSubmissionV2(repositoryRoot, submissionPath) {
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

function validateApplication(applicationPackage, sourceRoots, repositoryRoot, runTransport = runOpenWorld) {
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

function runOpenWorld(args, repositoryRoot) {
  try {
    const payload = requireJsonResult(runBundledCommand("open-world.mjs", args, {
      cwd: repositoryRoot,
      failureCode: "APPLICATION_TRANSPORT_FAILED"
    }), "open-world.mjs");
    return { ok: true, result: payload.result ?? payload };
  } catch (error) {
    return { ok: false, code: nestedErrorCode(error) ?? "APPLICATION_TRANSPORT_FAILED", details: error.details ?? null };
  }
}

function transportFailure({ status, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose, writePerformed = false, compatibility = null }) {
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

export function projectTrustedTransportFailureEffects(status) {
  if (status?.code !== "PARTIAL_EXTERNAL_WRITE") {
    return Object.freeze({ writePerformed: false, partialWrite: null });
  }
  const details = status?.details?.error?.details
    ?? status?.details?.result?.error?.details
    ?? status?.details;
  if (details?.partialExternalWrite !== true || details?.writePerformed !== true) {
    return Object.freeze({ writePerformed: false, partialWrite: null });
  }
  const mutationReceipt = details.mutationReceipt;
  const receipt = mutationReceipt !== null
    && typeof mutationReceipt === "object"
    && !Array.isArray(mutationReceipt)
    && typeof mutationReceipt.path === "string"
    && mutationReceipt.state === "RECONCILIATION_REQUIRED"
    && SHA256_PATTERN.test(mutationReceipt.receiptDigest ?? "")
      ? Object.freeze({
          path: mutationReceipt.path,
          state: mutationReceipt.state,
          receiptDigest: mutationReceipt.receiptDigest
        })
      : null;
  return Object.freeze({
    writePerformed: true,
    partialWrite: Object.freeze({
      code: "PARTIAL_EXTERNAL_WRITE",
      writePerformed: true,
      recoveryStatus: details.recoveryStatus === "MANUAL_RECONCILIATION_REQUIRED"
        ? details.recoveryStatus
        : "MANUAL_RECONCILIATION_REQUIRED",
      mutationReceipt: receipt
    })
  });
}

function createState({ repositoryRoot, workspace, source, previous, submissionPaths = [], currentState, diagnostics, transport = null, compatibility = null, workspacePersisted = true }) {
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
    transport: transport ?? previous?.transport ?? null,
    authority: {
      reviewGranted: false,
      approvalGranted: false,
      deploymentGranted: false,
      launchGranted: false
    }
  };
  Object.defineProperty(state, "workspacePersisted", { value: workspacePersisted, enumerable: false });
  return state;
}

function loadWorkspaceState(statePath, repositoryRoot, workspace) {
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

function persistWorkspaceState(statePath, state) {
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

function blockedResult(state, diagnostics, safeNextCommand, verbose, details = null, writePerformed = false) {
  return {
    exitCode: 1,
    result: renderResult(state, diagnostics, safeNextCommand, verbose, details, writePerformed)
  };
}

function usefulResult(state, safeNextCommand, verbose, details = null, writePerformed = false) {
  return {
    exitCode: 0,
    result: renderResult(state, [], safeNextCommand, verbose, details, writePerformed)
  };
}

function renderResult(state, diagnostics, safeNextCommand, verbose, details, writePerformed) {
  const result = {
    state: state.state,
    diagnostics: diagnostics.slice(0, 3),
    writePerformed,
    safeNextCommand,
    workspace: {
      root: path.dirname(state.paths.applicationPackage),
      stateFile: path.join(path.dirname(state.paths.applicationPackage), WORKSPACE_FILE),
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

function finding(code, causeClass, summary, repair, safeNextCommand, writePerformed = false) {
  return { code, causeClass, summary, repair, safeNextCommand, writePerformed };
}

function projectRemoteState(status) {
  const projected = JSON.stringify(status ?? {});
  if (/changes.requested/iu.test(projected)) return "CHANGES_REQUESTED";
  if (/checks.running|pending|queued|in.progress/iu.test(projected)) return "CHECKS_RUNNING";
  if (/review.required|unreviewed|draft/iu.test(projected)) return "REVIEW_REQUIRED";
  return "DRAFT_OPEN";
}

function compactPlan(plan) {
  return {
    action: plan?.action ?? null,
    applicationId: plan?.applicationId ?? null,
    applicationRevision: plan?.applicationRevision ?? null,
    confirmationDigest: plan?.confirmationDigest ?? null,
    target: plan?.target ?? null,
    externalWrites: plan?.externalWrites ?? []
  };
}

function safeCommand(repositoryRoot, workspace, { confirmation = null, resume = false } = {}) {
  const parts = [
    "node", "\"$BUILDER_CLI\"", "submit-project", shellQuote(repositoryRoot),
    "--workspace-root", shellQuote(workspace)
  ];
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

function normalizeFailure(error) {
  if (error instanceof CliFailure) return error;
  if (error?.code === "MULTI_REPOSITORY_WORKSPACE_INCOMPLETE" || error?.code === "PROJECT_SOURCE_CHANGED") {
    return new CliFailure(error.code, error.message, { exitCode: 1 });
  }
  return new CliFailure("SUBMIT_PROJECT_FAILED", "the Applicant journey failed without a safe diagnostic", { exitCode: 2 });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
