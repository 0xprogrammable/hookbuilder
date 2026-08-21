#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCli, renderHelp } from "./cli-args.mjs";
import {
  normalizeSubmitProjectTransport,
  runSubmitProjectQueuePreflight
} from "./submit-project-queue.mjs";
import {
  parseApplicationContractFromSnapshot,
  projectApplicationRouteState,
  validateApplicationContractDocument
} from "./application-v3-contract-adapter.mjs";
import { CliFailure, emitFailure, emitSuccess } from "./cli-runtime.mjs";
import {
  assertCurrentSubmitLaunchContractCurrent,
  resolveCurrentSubmitLaunchContract
} from "./submit-launch-policy-github.mjs";
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
  projectTrustedTransportFailureEffects,
  resolveApplicantRepository as resolveRepository,
  resolveApplicantWorkspace as resolveWorkspace,
  sameApplicantSource as sameSource
} from "./submit-project-core.mjs";
import {
  SUBMIT_PROJECT_WORKSPACE_FILE as WORKSPACE_FILE,
  blockedResult,
  compactPlan,
  createState,
  createSubmitLaunchEvaluation,
  enrichJourneyOutcome,
  finding,
  loadSubmissionDocument,
  loadWorkspaceState,
  normalizeFailure,
  persistWorkspaceState,
  planBindsSubmitLaunchContract,
  prepareApplicationPackage,
  projectAdoptedDraftTransport,
  projectRemoteState,
  runOpenWorld,
  safeCommand,
  transportFailure,
  usefulResult,
  validateApplication,
  validateSubmissionV2
} from "./submit-project-cli-support.mjs";

export { projectAdoptedDraftTransport, projectTrustedTransportFailureEffects };

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PUBLIC_TRANSPORT_OPTION = Object.freeze({
  name: "--transport",
  key: "transport",
  type: "value",
  valueName: "auto|github-draft",
  description: "Select the protected GitHub Draft adapter explicitly; auto is the default. Queue diagnostics remain an advanced-only compatibility path."
});

const spec = {
  command: "submit-project",
  usage: "cli.mjs submit-project <repository-root> [--transport <auto|github-draft>] [--workspace-root <absolute-dir>] [--confirm-external-write <sha256:...>] [--resume] [--verbose]",
  summary: "Validate the project, bind one current Submit Launch snapshot, then plan, submit, or read its Applicant Draft.",
  positionals: { min: 1, max: 1, names: ["repository-root"] },
  options: [
    PUBLIC_TRANSPORT_OPTION,
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
    normalizeSubmitProjectTransport(options.transport);
    const outcome = await runSubmitProjectJourney({ repositoryInput: positionals[0], ...options });
    emitSuccess("submit-project", outcome.result);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.exitCode = emitFailure("submit-project", normalizeFailure(error));
  }
}

export async function runSubmitProjectJourney({ repositoryInput, workspaceRoot, confirmation, resume, verbose, transport = null }, adapters = {}) {
  const selectedTransport = normalizeSubmitProjectTransport(transport);
  const runtime = {
    readProjectDiscovery: ({ repositoryRoot, commit }) => ({
      submissionPaths: discoverTrackedFiles(repositoryRoot, commit, "submission.v2.json"),
      pointerPaths: discoverTrackedFiles(repositoryRoot, commit, "applicant-package.v1.json")
    }),
    atomicWorkspaceWrite: persistWorkspaceState,
    adoptExistingDraft: discoverExistingDraft,
    recoverExistingDraftPackage: recoverExistingDraftPackageForProject,
    runTransport: runOpenWorld,
    resolveCurrentContract: resolveCurrentSubmitLaunchContract,
    assertCurrentContract: assertCurrentSubmitLaunchContractCurrent,
    parseApplicationContract: parseApplicationContractFromSnapshot,
    projectRouteState: projectApplicationRouteState,
    validateApplicationContract: validateApplicationContractDocument,
    loadApplicationPackageSnapshot,
    bindApplicationSources,
    loadSubmissionDocument,
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
    const command = safeCommand(repositoryRoot, unboundWorkspace, {
      resume: selectedTransport !== "queue",
      transport: selectedTransport
    });
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
        summary: diagnostic.summary,
        nextAction: command,
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
  const previous = selectedTransport === "queue"
    ? null
    : fs.existsSync(statePath)
      ? loadWorkspaceState(statePath, repositoryRoot, workspace)
      : null;
  if (selectedTransport !== "queue" && resume && previous === null) {
    throw new CliFailure("WORKSPACE_STATE_NOT_FOUND", "--resume requires an existing exact applicant workspace state", { exitCode: 1 });
  }

  const command = safeCommand(repositoryRoot, workspace, {
    resume: selectedTransport !== "queue",
    transport: selectedTransport
  });
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
  if (selectedTransport === "queue") {
    return enrichJourneyOutcome(await runSubmitProjectQueuePreflight({
      contractPreflight: runtime.queueContractPreflight,
      repositoryRoot,
      source,
      validation,
      verbose,
      workspace
    }));
  }
  ensureWorkspaceDirectory(repositoryRoot, workspace);

  const applicationPackage = path.join(workspace, "application-package");
  if (!isRealDirectoryWithFile(applicationPackage, "application.v3.json")) {
    const recovery = pointer === null ? await runtime.recoverExistingDraftPackage({ applicationPackagePath: applicationPackage, repositoryRoot, source, submissionPath }) : null;
    if (recovery?.status) return transportFailure({ status: recovery.status, repositoryRoot, workspace, source, previous, submissionPaths, statePath, command, verbose });
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
      compatibility: null
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], diagnostic.safeNextCommand, verbose, { validation });
  }

  let applicationSnapshot;
  let sourceRoots;
  try {
    applicationSnapshot = runtime.loadApplicationPackageSnapshot(applicationPackage);
    sourceRoots = runtime.bindApplicationSources(applicationSnapshot.application, repositoryRoot, workspace, source);
  } catch (error) {
    const missingRoots = error?.code === "MULTI_REPOSITORY_WORKSPACE_INCOMPLETE";
    const diagnostic = finding(
      error?.code ?? "APPLICATION_PACKAGE_INVALID",
      "PROJECT",
      missingRoots
        ? "One or more exact source repositories are not mapped in the persistent Applicant workspace."
        : "The closed Application package is invalid or changed.",
      missingRoots
        ? "Place each clean companion at workspace/sources/<repository-ref> with the exact declared commit and tree, then resume."
        : "Regenerate the exact closed package through the current deterministic Application adapter, then resume.",
      command
    );
    const currentState = missingRoots ? "NEEDS_PUBLIC_SOURCE" : "NEEDS_PROJECT_PACKAGE";
    const state = createState({ repositoryRoot, workspace, source, previous, submissionPaths, currentState, diagnostics: [diagnostic] });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], command, verbose);
  }

  let routeState;
  let contractSnapshot;
  let parsedApplicationContract;
  let contractEvaluation;
  try {
    const submission = runtime.loadSubmissionDocument(repositoryRoot, submissionPath);
    routeState = runtime.projectRouteState({
      application: applicationSnapshot.application,
      submission
    });
    contractSnapshot = await runtime.resolveCurrentContract({
      stage: "submit",
      routeState,
      cacheDirectory: path.join(workspace, "submit-launch-cache"),
      includeFullSnapshot: false
    });
    parsedApplicationContract = runtime.parseApplicationContract(contractSnapshot);
    contractEvaluation = createSubmitLaunchEvaluation({
      previous: previous?.submitLaunch ?? null,
      snapshot: contractSnapshot,
      workspace,
      event: "submit-evaluation",
      status: "CURRENT",
      code: null
    });
  } catch (error) {
    const code = error?.code ?? "POLICY_UNRESOLVED";
    const diagnostic = finding(
      code,
      "INTEGRATION",
      code === "APPLICATION_ROUTE_STATE_CONTRADICTION"
        ? "The Application and Submission route declarations contradict each other."
        : "The exact current Submit Launch contract is unavailable for this submission.",
      code === "APPLICATION_ROUTE_STATE_CONTRADICTION"
        ? "Repair the data-only route declarations and regenerate the Application revision."
        : "Retry after the protected main contract is stable and reachable; local build artifacts remain unchanged.",
      command
    );
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous,
      submissionPaths,
      currentState: code === "APPLICATION_ROUTE_STATE_CONTRADICTION" ? "NEEDS_PROJECT_PACKAGE" : "INTEGRATION_PENDING",
      diagnostics: [diagnostic]
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], command, verbose, {
      validation,
      routeState: routeState ?? "unresolved",
      contractCode: code
    });
  }
  const compatibilityBinding = contractSnapshot.snapshotBinding.compatibility;
  const adapterValidation = runtime.validateApplicationContract({
    application: applicationSnapshot.application,
    applicationContract: parsedApplicationContract
  });
  if (adapterValidation?.valid !== true) {
    const diagnostic = finding(
      adapterValidation?.findings?.[0]?.code ?? "APPLICATION_CONTRACT_UNSUPPORTED",
      "PROJECT",
      "The closed Application package does not match the current or supported legacy data contract.",
      "Regenerate a V3.2 revision through the current adapter. A legacy V3.1 package cannot claim official launch readiness.",
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
      compatibility: compatibilityBinding,
      submitLaunchEvaluation: contractEvaluation
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], command, verbose, { validation, adapterValidation, routeState });
  }
  const evaluatedState = createState({
    repositoryRoot,
    workspace,
    source,
    previous,
    submissionPaths,
    currentState: "INTEGRATION_PENDING",
    diagnostics: [],
    compatibility: compatibilityBinding,
    submitLaunchEvaluation: contractEvaluation
  });
  runtime.atomicWorkspaceWrite(statePath, evaluatedState);

  const applicationValidation = validateApplication(applicationPackage, sourceRoots, repositoryRoot, runtime.runTransport);
  if (!applicationValidation.ok) {
    const diagnostic = finding(
      applicationValidation.code,
      applicationValidation.causeClass,
      applicationValidation.summary,
      applicationValidation.repair,
      command
    );
    const state = createState({ repositoryRoot, workspace, source, previous: evaluatedState, submissionPaths, currentState: applicationValidation.state, diagnostics: [diagnostic], compatibility: compatibilityBinding });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], command, verbose, { validation, applicationValidation });
  }
  let pullRequest = evaluatedState.transport?.pullRequest ?? null;
  let initialPlan = null;
  if (pullRequest === null) {
    const selection = await planSubmitOrAdoptExistingDraft({ applicationPackage: applicationSnapshot, applicationPackagePath: applicationPackage, repositoryRoot, sourceRoots, runTransport: runtime.runTransport, adoptExistingDraft: runtime.adoptExistingDraft });
    if (selection.status?.ok === false) return transportFailure({ status: selection.status, repositoryRoot, workspace, source, previous: evaluatedState, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
    pullRequest = selection.pullRequest;
    initialPlan = selection.status;
  }
  if (pullRequest !== null && confirmation === null) {
    const status = runtime.runTransport(["status", applicationPackage, "--pull-request", String(pullRequest), ...sourceRootArgs(sourceRoots)], repositoryRoot);
    if (!status.ok) return transportFailure({ status, repositoryRoot, workspace, source, previous: evaluatedState, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
    const currentState = projectRemoteState(status.result);
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous: evaluatedState,
      submissionPaths,
      currentState,
      diagnostics: [],
      compatibility: compatibilityBinding,
      transport: projectAdoptedDraftTransport(evaluatedState.transport, pullRequest, status.result)
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return usefulResult(state, command, verbose, { validation, applicationValidation, remoteStatus: status.result });
  }
  const operation = pullRequest === null ? "submit" : "update";
  const operationArgs = [operation, applicationPackage];
  if (pullRequest !== null) operationArgs.push("--pull-request", String(pullRequest));
  operationArgs.push(...sourceRootArgs(sourceRoots), "--dry-run");
  const plan = initialPlan ?? runtime.runTransport(operationArgs, repositoryRoot);
  if (!plan.ok) return transportFailure({ status: plan, repositoryRoot, workspace, source, previous: evaluatedState, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
  if (!planBindsSubmitLaunchContract(plan.result, contractSnapshot)) {
    return transportFailure({
      status: { ok: false, code: "SUBMISSION_PLAN_CONTRACT_MISMATCH", details: { writePerformed: false } },
      repositoryRoot,
      workspace,
      source,
      previous: evaluatedState,
      submissionPaths,
      statePath,
      command,
      verbose,
      compatibility: compatibilityBinding
    });
  }
  const confirmationDigest = plan.result?.confirmationDigest;
  if (!SHA256_PATTERN.test(confirmationDigest)) {
    throw new CliFailure("SUBMISSION_PLAN_INVALID", "the protected transport returned no canonical confirmation digest", { exitCode: 2 });
  }
  if (confirmation === null) {
    const next = safeCommand(repositoryRoot, workspace, { confirmation: confirmationDigest, transport: selectedTransport });
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous: evaluatedState,
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
      safeCommand(repositoryRoot, workspace, { confirmation: confirmationDigest, transport: selectedTransport })
    );
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous: evaluatedState,
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
  let recheckedEvaluation;
  try {
    const current = await runtime.assertCurrentContract(contractSnapshot.snapshotBinding);
    if ((current?.currentness?.status ?? current?.status) !== "CURRENT") {
      throw Object.assign(new Error("Submit Launch contract is not current"), { code: "SUBMIT_LAUNCH_CONTRACT_DRIFT" });
    }
    recheckedEvaluation = createSubmitLaunchEvaluation({
      previous: evaluatedState.submitLaunch,
      snapshot: contractSnapshot,
      workspace,
      event: "pre-write-recheck",
      status: "CURRENT",
      code: null
    });
  } catch (error) {
    const code = error?.code ?? "SUBMIT_LAUNCH_CONTRACT_DRIFT";
    const diagnostic = finding(
      code,
      "INTEGRATION",
      "Submit Launch main changed after confirmation and before the external write.",
      "Resolve the new snapshot and confirm its newly computed plan. No external write was attempted.",
      command
    );
    const driftEvaluation = createSubmitLaunchEvaluation({
      previous: evaluatedState.submitLaunch,
      snapshot: contractSnapshot,
      workspace,
      event: "pre-write-recheck",
      status: "DRIFT",
      code
    });
    const state = createState({
      repositoryRoot,
      workspace,
      source,
      previous: evaluatedState,
      submissionPaths,
      currentState: "INTEGRATION_PENDING",
      diagnostics: [diagnostic],
      compatibility: compatibilityBinding,
      submitLaunchEvaluation: driftEvaluation,
      transport: { operation, pullRequest, confirmationDigest, plan: compactPlan(plan.result) }
    });
    runtime.atomicWorkspaceWrite(statePath, state);
    return blockedResult(state, [diagnostic], command, verbose, { validation, applicationValidation, routeState }, false);
  }
  const recheckedState = createState({
    repositoryRoot,
    workspace,
    source,
    previous: evaluatedState,
    submissionPaths,
    currentState: "READY_FOR_CONFIRMATION",
    diagnostics: [],
    compatibility: compatibilityBinding,
    submitLaunchEvaluation: recheckedEvaluation,
    transport: { operation, pullRequest, confirmationDigest, plan: compactPlan(plan.result) }
  });
  const mutation = runtime.runTransport(mutationArgs, repositoryRoot);
  if (!mutation.ok) return transportFailure({ status: mutation, repositoryRoot, workspace, source, previous: recheckedState, submissionPaths, statePath, command, verbose, compatibility: compatibilityBinding });
  const newPullRequest = mutation.result?.target?.pullRequestNumber ?? pullRequest;
  if (!Number.isSafeInteger(newPullRequest) || newPullRequest < 1) {
    throw new CliFailure("SUBMISSION_READBACK_INVALID", "the confirmed Draft transport returned no exact pull request identity", { exitCode: 2 });
  }
  const status = runtime.runTransport(["status", applicationPackage, "--pull-request", String(newPullRequest), ...sourceRootArgs(sourceRoots)], repositoryRoot);
  if (!status.ok) return transportFailure({ status, repositoryRoot, workspace, source, previous: recheckedState, submissionPaths, statePath, command, verbose, writePerformed: true, compatibility: compatibilityBinding });
  const currentState = projectRemoteState(status.result);
  const state = createState({
    repositoryRoot,
    workspace,
    source,
    previous: recheckedState,
    submissionPaths,
    currentState,
    diagnostics: [],
    compatibility: compatibilityBinding,
    transport: { operation, pullRequest: newPullRequest, confirmationDigest: confirmation, lastStatus: status.result }
  });
  runtime.atomicWorkspaceWrite(statePath, state);
  return usefulResult(state, command, verbose, { validation, applicationValidation, mutation: mutation.result, remoteStatus: status.result }, true);
}
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
