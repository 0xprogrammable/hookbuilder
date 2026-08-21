import {
  SUBMIT_PROJECT_SHA256_PATTERN as SHA256_PATTERN,
  appendContractEvaluation,
  bindApplicationToContract,
  planBindsContract,
  resolveJourneyContract,
  trustedTargetFromContract
} from "./submit-project-contract-core.mjs";

export {
  applicantSourceRootArgs,
  bindApplicantApplicationSources,
  canonicalApplicantWorkspaceJson,
  defaultApplicantWorkspacePath,
  discoverTrackedApplicantFiles,
  ensureApplicantWorkspaceDirectory,
  inspectApplicantSource,
  isExactApplicantKind,
  isRealDirectoryWithFile,
  loadApplicantApplicationDraftSource,
  loadApplicantApplicationPackageSnapshot,
  loadApplicantPackagePointer,
  projectTrustedTransportFailureEffects,
  resolveApplicantRepository,
  resolveApplicantWorkspace,
  sameApplicantSource
} from "./submit-project-workspace-core.mjs";

const STATES = new Set([
  "NEEDS_PROJECT_PACKAGE",
  "NEEDS_PUBLIC_SOURCE",
  "NEEDS_GITHUB_AUTH",
  "INTEGRATION_PENDING",
  "READY_FOR_CONFIRMATION",
  "DRAFT_OPEN",
  "CHECKS_RUNNING",
  "REVIEW_REQUIRED",
  "CHANGES_REQUESTED"
]);

/**
 * Pure Applicant journey seam. Adapters own every filesystem, GitHub and mutation
 * effect, so tests can prove ordering without candidate-code or network execution.
 */
export async function runSubmitProjectJourney(input, adapters) {
  assertInput(input);
  assertAdapters(adapters);
  const workspaceBase = workspaceProjection(input, null);

  // One protected-main resolver owns compatibility, policy, application
  // contract and stage projection. Consumers never resolve either half again.
  const resolved = await resolveJourneyContract(input, adapters);
  if (resolved.ok !== true) {
    return blocked(input, workspaceBase, resolved, "INTEGRATION_PENDING", false);
  }
  const contract = resolved.binding;
  const trustedTarget = trustedTargetFromContract(contract);

  const persisted = await adapters.readWorkspace({
    repositoryRoot: input.repositoryRoot,
    workspaceRoot: input.workspaceRoot
  });
  const submitLaunch = appendContractEvaluation(persisted?.submitLaunch, contract, {
    event: "resolve",
    status: "CURRENT",
    code: null
  });
  const project = await adapters.validateProjectPackage({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    contractSnapshot: contract,
    applicationContract: contract.applicationContract,
    stagePlan: contract.projectStage
  });
  if (project?.ok !== true) return await persistBlocked(input, adapters, persisted, contract, submitLaunch, project, "NEEDS_PROJECT_PACKAGE");

  const source = await adapters.discoverPublicSource({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    project: project.binding,
    contractSnapshot: contract,
    applicationContract: contract.applicationContract,
    stagePlan: contract.projectStage
  });
  if (source?.ok !== true) return await persistBlocked(input, adapters, persisted, contract, submitLaunch, source, "NEEDS_PUBLIC_SOURCE");

  const prepared = await adapters.prepareApplicationPackage({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    project: project.binding,
    source: source.binding,
    contractSnapshot: contract,
    applicationContract: contract.applicationContract,
    stagePlan: contract.projectStage
  });
  if (prepared?.ok !== true) return await persistBlocked(input, adapters, persisted, contract, submitLaunch, prepared, "NEEDS_PROJECT_PACKAGE");
  const applicationPackage = bindApplicationToContract(prepared.binding, contract);

  const closed = await adapters.validateClosedPackage({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    project: project.binding,
    source: source.binding,
    applicationPackage,
    contractSnapshot: contract,
    applicationContract: contract.applicationContract,
    stagePlan: contract.projectStage
  });
  if (closed?.ok !== true) return await persistBlocked(input, adapters, persisted, contract, submitLaunch, closed, "NEEDS_PROJECT_PACKAGE");

  const auth = await adapters.readGithubAuth({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    source: source.binding,
    target: trustedTarget
  });
  if (auth?.ok !== true) return await persistBlocked(input, adapters, persisted, contract, submitLaunch, auth, "NEEDS_GITHUB_AUTH");

  const plan = await adapters.planDraft({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    contractSnapshot: contract,
    applicationContract: contract.applicationContract,
    stagePlan: contract.projectStage,
    compatibility: { ...contract.snapshotBinding.compatibility, ...trustedTarget },
    target: trustedTarget,
    project: project.binding,
    source: source.binding,
    applicationPackage,
    closedPackage: closed.binding,
    githubAuth: auth.binding
  });
  if (plan?.ok !== true || !SHA256_PATTERN.test(plan.confirmationDigest ?? "") || !planBindsContract(plan, contract)) {
    return await persistBlocked(input, adapters, persisted, contract, submitLaunch, {
      ...plan,
      code: plan?.code ?? "SUBMISSION_PLAN_CONTRACT_MISMATCH"
    }, "INTEGRATION_PENDING");
  }

  const workspaceValue = buildWorkspace({
    input,
    previous: persisted,
    source: source.binding,
    contract,
    submitLaunch,
    project: project.binding,
    applicationPackage,
    closedPackage: closed.binding,
    plan
  });
  await adapters.writeWorkspaceAtomically({ workspace: workspaceValue });

  if (input.confirmExternalWrite === null) {
    return readyResult(input, workspaceValue, plan, []);
  }
  if (input.confirmExternalWrite !== plan.confirmationDigest) {
    return blocked(
      input,
      workspaceProjection(input, workspaceValue),
      { diagnostics: [diagnostic(
        "EXTERNAL_WRITE_CONFIRMATION_REQUIRED",
        "AUTHORITY",
        "The supplied digest does not match the exact current Draft plan.",
        "Review and confirm only the freshly recomputed digest.",
        confirmationCommand(input, plan.confirmationDigest)
      )] },
      "READY_FOR_CONFIRMATION",
      false,
      plan.confirmationDigest
    );
  }

  let currentReceipt;
  try {
    currentReceipt = await adapters.assertCurrentContract({
      snapshotBinding: contract.snapshotBinding,
      repositoryRoot: input.repositoryRoot,
      workspaceRoot: input.workspaceRoot,
      target: trustedTarget
    });
  } catch (error) {
    return await persistContractDrift(input, adapters, workspaceValue, contract, error, plan.confirmationDigest);
  }
  if ((currentReceipt?.currentness?.status ?? currentReceipt?.status) !== "CURRENT") {
    return await persistContractDrift(input, adapters, workspaceValue, contract, {
      code: "SUBMIT_LAUNCH_CONTRACT_DRIFT",
      message: "The protected Submit Launch head changed before the external write."
    }, plan.confirmationDigest);
  }
  const recheckedSubmitLaunch = appendContractEvaluation(workspaceValue.submitLaunch, contract, {
    event: "pre-write-recheck",
    status: "CURRENT",
    code: null
  });

  const mutation = await adapters.mutateDraft({
    repositoryRoot: input.repositoryRoot,
    workspace: { ...workspaceValue, submitLaunch: recheckedSubmitLaunch },
    target: trustedTarget,
    contractSnapshot: contract,
    applicationContract: contract.applicationContract,
    stagePlan: contract.projectStage,
    plan,
    confirmationDigest: plan.confirmationDigest
  });
  const remote = await adapters.reconcileRemoteStatus({
    repositoryRoot: input.repositoryRoot,
    workspace: workspaceValue,
    target: trustedTarget,
    contractSnapshot: contract,
    applicationContract: contract.applicationContract,
    stagePlan: contract.projectStage,
    plan,
    mutation,
    readOnly: true
  });
  const remoteState = STATES.has(remote?.state) ? remote.state : "INTEGRATION_PENDING";
  const finalWorkspace = {
    ...workspaceValue,
    submitLaunch: recheckedSubmitLaunch,
    state: remoteState,
    pullRequest: remote?.pullRequest ?? mutation?.pullRequest ?? null
  };
  await adapters.writeWorkspaceAtomically({ workspace: finalWorkspace });
  return {
    exitCode: remoteState === "INTEGRATION_PENDING" ? 1 : 0,
    result: resultShape({
      input,
      state: remoteState,
      diagnostics: remoteState === "INTEGRATION_PENDING"
        ? normalizedDiagnostics(remote, "INTEGRATION_PENDING", input)
        : [],
      workspace: finalWorkspace,
      writePerformed: true,
      safeNextCommand: resumeCommand(input),
      confirmationDigest: plan.confirmationDigest
    })
  };
}

async function persistBlocked(input, adapters, previous, contract, submitLaunch, phase, fallbackState) {
  const state = STATES.has(phase?.state) ? phase.state : fallbackState;
  const findings = normalizedDiagnostics(phase, state, input);
  const workspace = buildWorkspace({
    input,
    previous,
    source: null,
    contract,
    submitLaunch,
    project: null,
    applicationPackage: null,
    closedPackage: null,
    plan: null,
    state,
    diagnostics: findings
  });
  await adapters.writeWorkspaceAtomically({ workspace });
  return blocked(input, workspaceProjection(input, workspace), { diagnostics: findings }, state, false);
}

async function persistContractDrift(input, adapters, workspace, contract, error, confirmationDigest) {
  const code = typeof error?.code === "string" ? error.code : "SUBMIT_LAUNCH_CONTRACT_DRIFT";
  const command = resumeCommand(input);
  const finding = diagnostic(
    code,
    "INTEGRATION",
    "The protected Submit Launch contract changed after confirmation and before the external write.",
    "Resolve the new protected snapshot and confirm its newly computed plan. No external write was attempted.",
    command
  );
  const driftWorkspace = {
    ...workspace,
    state: "INTEGRATION_PENDING",
    diagnostics: [finding],
    submitLaunch: appendContractEvaluation(workspace.submitLaunch, contract, {
      event: "pre-write-recheck",
      status: "DRIFT",
      code
    })
  };
  await adapters.writeWorkspaceAtomically({ workspace: driftWorkspace });
  return blocked(input, workspaceProjection(input, driftWorkspace), { diagnostics: [finding] }, "INTEGRATION_PENDING", false, confirmationDigest);
}

function readyResult(input, workspace, plan, diagnostics) {
  return {
    exitCode: 0,
    result: resultShape({
      input,
      state: "READY_FOR_CONFIRMATION",
      diagnostics,
      workspace,
      writePerformed: false,
      safeNextCommand: confirmationCommand(input, plan.confirmationDigest),
      confirmationDigest: plan.confirmationDigest
    })
  };
}

function blocked(input, workspace, phase, fallbackState, writePerformed, confirmationDigest = null) {
  const state = STATES.has(phase?.state) ? phase.state : fallbackState;
  const allDiagnostics = normalizedDiagnostics(phase, state, input);
  return {
    exitCode: 1,
    result: resultShape({
      input,
      state,
      diagnostics: allDiagnostics,
      workspace,
      writePerformed,
      safeNextCommand: allDiagnostics[0]?.safeNextCommand ?? resumeCommand(input),
      confirmationDigest,
      allDiagnostics
    })
  };
}

function resultShape({ input, state, diagnostics, workspace, writePerformed, safeNextCommand, confirmationDigest, allDiagnostics = diagnostics }) {
  const projectedWorkspace = workspaceProjection(input, workspace);
  const summary = diagnostics[0]?.summary ?? summaryForJourneyState(state);
  const result = {
    state,
    summary,
    nextAction: safeNextCommand,
    diagnostics: diagnostics.slice(0, 3),
    writePerformed,
    safeNextCommand,
    workspace: projectedWorkspace,
    confirmationDigest: confirmationDigest ?? projectedWorkspace.confirmationDigest
  };
  if (input.verbose) result.details = { diagnostics: allDiagnostics };
  return result;
}

function buildWorkspace({ input, previous, source, contract, submitLaunch, project, applicationPackage, closedPackage, plan, state = "READY_FOR_CONFIRMATION", diagnostics = [] }) {
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-applicant-workspace",
    root: input.workspaceRoot,
    stateFile: `${input.workspaceRoot}/applicant-workspace.v1.json`,
    state,
    sourceCommit: source?.commit ?? previous?.sourceCommit ?? null,
    sourceTree: source?.tree ?? previous?.sourceTree ?? null,
    confirmationDigest: plan?.confirmationDigest ?? previous?.confirmationDigest ?? null,
    pullRequest: previous?.pullRequest ?? null,
    compatibility: contract?.snapshotBinding?.compatibility ?? previous?.compatibility ?? null,
    submitLaunch: submitLaunch ?? previous?.submitLaunch ?? null,
    project: project ?? previous?.project ?? null,
    applicationPackage: applicationPackage ?? previous?.applicationPackage ?? null,
    closedPackage: closedPackage ?? previous?.closedPackage ?? null,
    plan: plan ?? previous?.plan ?? null,
    diagnostics: diagnostics.slice(0, 3)
  };
}

function workspaceProjection(input, workspace) {
  return {
    root: input.workspaceRoot,
    stateFile: `${input.workspaceRoot}/applicant-workspace.v1.json`,
    statePersisted: typeof workspace?.statePersisted === "boolean" ? workspace.statePersisted : workspace !== null,
    sourceCommit: workspace?.sourceCommit ?? null,
    sourceTree: workspace?.sourceTree ?? null,
    confirmationDigest: workspace?.confirmationDigest ?? null,
    pullRequest: workspace?.pullRequest ?? null
  };
}

function summaryForJourneyState(state) {
  if (state === "READY_FOR_CONFIRMATION") return "The current Submit Launch snapshot and Draft plan are ready for exact confirmation.";
  if (state === "DRAFT_OPEN") return "The Applicant Draft is open and bound to the recorded Submit Launch snapshot.";
  if (state === "CHECKS_RUNNING") return "The Applicant Draft is open and its protected checks are still running.";
  if (state === "REVIEW_REQUIRED") return "The Applicant Draft is waiting for maintainer review.";
  if (state === "CHANGES_REQUESTED") return "The Applicant Draft needs the requested project changes before it can continue.";
  return "The Applicant journey needs one named prerequisite before it can continue.";
}

function normalizedDiagnostics(phase, fallbackState, input) {
  const supplied = Array.isArray(phase?.diagnostics) ? phase.diagnostics : [];
  if (supplied.length > 0) return supplied.map(normalizeDiagnostic);
  const causeClass = fallbackState === "NEEDS_GITHUB_AUTH"
    ? "AUTHORITY"
    : fallbackState === "INTEGRATION_PENDING"
      ? "INTEGRATION"
      : "PROJECT";
  return [diagnostic(
    phase?.code ?? fallbackState,
    causeClass,
    "The exact prerequisite is not available.",
    "Restore the exact prerequisite and rerun the same command.",
    resumeCommand(input)
  )];
}

function normalizeDiagnostic(value) {
  return diagnostic(
    String(value?.code ?? "INTEGRATION_PENDING"),
    ["PROJECT", "PLATFORM", "INTEGRATION", "AUTHORITY"].includes(value?.causeClass) ? value.causeClass : "INTEGRATION",
    String(value?.summary ?? "The exact prerequisite is not available."),
    String(value?.repair ?? "Restore the exact prerequisite and rerun the same command."),
    String(value?.safeNextCommand ?? "node cli.mjs submit-project /project --workspace-root /workspace --resume"),
    value?.writePerformed === true
  );
}

function diagnostic(code, causeClass, summary, repair, safeNextCommand, writePerformed = false) {
  return { code, causeClass, summary, repair, safeNextCommand, writePerformed };
}

function confirmationCommand(input, digest) {
  return `node cli.mjs submit-project ${shellQuote(input.repositoryRoot)} --workspace-root ${shellQuote(input.workspaceRoot)} --confirm-external-write ${digest}`;
}

function resumeCommand(input) {
  return `node cli.mjs submit-project ${shellQuote(input.repositoryRoot)} --workspace-root ${shellQuote(input.workspaceRoot)} --resume`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function assertInput(input) {
  const routeStates = new Set(["no-market", "external", "unresolved", "official-programmable-ethereum"]);
  if (
    input === null
    || typeof input !== "object"
    || typeof input.repositoryRoot !== "string"
    || typeof input.workspaceRoot !== "string"
    || (input.confirmExternalWrite !== null && !SHA256_PATTERN.test(input.confirmExternalWrite ?? ""))
    || (input.routeState !== undefined && !routeStates.has(input.routeState))
  ) throw new TypeError("submit-project journey input is invalid");
}

function assertAdapters(adapters) {
  const required = [
    "readWorkspace",
    "writeWorkspaceAtomically",
    "validateProjectPackage",
    "discoverPublicSource",
    "prepareApplicationPackage",
    "validateClosedPackage",
    "readGithubAuth",
    "planDraft",
    "mutateDraft",
    "reconcileRemoteStatus"
  ];
  if (
    adapters === null
    || typeof adapters !== "object"
    || typeof adapters.resolveCurrentContract !== "function"
    || typeof adapters.assertCurrentContract !== "function"
    || required.some((name) => typeof adapters[name] !== "function")
  ) {
    throw new TypeError("submit-project journey adapters are incomplete");
  }
}
