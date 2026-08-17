import { canonicalJson } from "./submission-core.mjs";

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
const TRUSTED_TARGET = Object.freeze({
  repository: "0xprogrammable/submit-launch",
  repositoryId: "1320171831",
  base: "main",
  draft: true
});

/**
 * Pure Applicant journey seam. Adapters own every filesystem, GitHub and mutation
 * effect, so tests can prove ordering without candidate-code or network execution.
 */
export async function runSubmitProjectJourney(input, adapters) {
  assertInput(input);
  assertAdapters(adapters);
  const workspaceBase = workspaceProjection(input, null);

  // Compatibility is a protected-base prerequisite. It intentionally precedes
  // local state writes and all project-derived package reads.
  const compatibility = await adapters.resolveCompatibility({
    repositoryRoot: input.repositoryRoot,
    workspaceRoot: input.workspaceRoot,
    target: TRUSTED_TARGET
  });
  if (compatibility?.ok !== true) {
    return blocked(input, workspaceBase, compatibility, "INTEGRATION_PENDING", false);
  }
  const trustedTarget = trustedTargetFromCompatibility(compatibility.binding);

  const persisted = await adapters.readWorkspace({
    repositoryRoot: input.repositoryRoot,
    workspaceRoot: input.workspaceRoot
  });
  const project = await adapters.validateProjectPackage({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    compatibility: compatibility.binding
  });
  if (project?.ok !== true) return await persistBlocked(input, adapters, persisted, compatibility, project, "NEEDS_PROJECT_PACKAGE");

  const source = await adapters.discoverPublicSource({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    project: project.binding,
    compatibility: compatibility.binding
  });
  if (source?.ok !== true) return await persistBlocked(input, adapters, persisted, compatibility, source, "NEEDS_PUBLIC_SOURCE");

  const prepared = await adapters.prepareApplicationPackage({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    project: project.binding,
    source: source.binding,
    compatibility: compatibility.binding
  });
  if (prepared?.ok !== true) return await persistBlocked(input, adapters, persisted, compatibility, prepared, "NEEDS_PROJECT_PACKAGE");

  const closed = await adapters.validateClosedPackage({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    project: project.binding,
    source: source.binding,
    applicationPackage: prepared.binding,
    compatibility: compatibility.binding
  });
  if (closed?.ok !== true) return await persistBlocked(input, adapters, persisted, compatibility, closed, "NEEDS_PROJECT_PACKAGE");

  const auth = await adapters.readGithubAuth({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    source: source.binding,
    target: trustedTarget
  });
  if (auth?.ok !== true) return await persistBlocked(input, adapters, persisted, compatibility, auth, "NEEDS_GITHUB_AUTH");

  const plan = await adapters.planDraft({
    repositoryRoot: input.repositoryRoot,
    workspace: persisted,
    compatibility: { ...compatibility.binding, ...trustedTarget },
    target: trustedTarget,
    project: project.binding,
    source: source.binding,
    applicationPackage: prepared.binding,
    closedPackage: closed.binding,
    githubAuth: auth.binding
  });
  if (plan?.ok !== true || !/^sha256:[0-9a-f]{64}$/u.test(plan.confirmationDigest ?? "")) {
    return await persistBlocked(input, adapters, persisted, compatibility, plan, "INTEGRATION_PENDING");
  }

  const workspaceValue = buildWorkspace({
    input,
    previous: persisted,
    source: source.binding,
    compatibility: compatibility.binding,
    project: project.binding,
    applicationPackage: prepared.binding,
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

  const mutation = await adapters.mutateDraft({
    repositoryRoot: input.repositoryRoot,
    workspace: workspaceValue,
    target: trustedTarget,
    compatibility: compatibility.binding,
    plan,
    confirmationDigest: plan.confirmationDigest
  });
  const remote = await adapters.reconcileRemoteStatus({
    repositoryRoot: input.repositoryRoot,
    workspace: workspaceValue,
    target: trustedTarget,
    compatibility: compatibility.binding,
    plan,
    mutation,
    readOnly: true
  });
  const remoteState = STATES.has(remote?.state) ? remote.state : "INTEGRATION_PENDING";
  const finalWorkspace = {
    ...workspaceValue,
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

async function persistBlocked(input, adapters, previous, compatibility, phase, fallbackState) {
  const state = STATES.has(phase?.state) ? phase.state : fallbackState;
  const findings = normalizedDiagnostics(phase, state, input);
  const workspace = buildWorkspace({
    input,
    previous,
    source: null,
    compatibility: compatibility.binding,
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
  const result = {
    state,
    diagnostics: diagnostics.slice(0, 3),
    writePerformed,
    safeNextCommand,
    workspace: projectedWorkspace,
    confirmationDigest: confirmationDigest ?? projectedWorkspace.confirmationDigest
  };
  if (input.verbose) result.details = { diagnostics: allDiagnostics };
  return result;
}

function buildWorkspace({ input, previous, source, compatibility, project, applicationPackage, closedPackage, plan, state = "READY_FOR_CONFIRMATION", diagnostics = [] }) {
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
    compatibility: compatibility ?? previous?.compatibility ?? null,
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

function trustedTargetFromCompatibility(binding) {
  if (
    binding?.repository !== TRUSTED_TARGET.repository
    || binding?.repositoryId !== TRUSTED_TARGET.repositoryId
    || binding?.defaultBranch !== TRUSTED_TARGET.base
  ) {
    return TRUSTED_TARGET;
  }
  return TRUSTED_TARGET;
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
  if (
    input === null
    || typeof input !== "object"
    || typeof input.repositoryRoot !== "string"
    || typeof input.workspaceRoot !== "string"
    || (input.confirmExternalWrite !== null && !/^sha256:[0-9a-f]{64}$/u.test(input.confirmExternalWrite ?? ""))
  ) throw new TypeError("submit-project journey input is invalid");
}

function assertAdapters(adapters) {
  const required = [
    "readWorkspace",
    "writeWorkspaceAtomically",
    "resolveCompatibility",
    "validateProjectPackage",
    "discoverPublicSource",
    "prepareApplicationPackage",
    "validateClosedPackage",
    "readGithubAuth",
    "planDraft",
    "mutateDraft",
    "reconcileRemoteStatus"
  ];
  if (adapters === null || typeof adapters !== "object" || required.some((name) => typeof adapters[name] !== "function")) {
    throw new TypeError("submit-project journey adapters are incomplete");
  }
}

export function canonicalApplicantWorkspaceJson(value) {
  return `${canonicalJson(value)}\n`;
}
