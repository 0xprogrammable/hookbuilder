import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CliFailure } from "./cli-runtime.mjs";
import { createOpenWorldRuntime } from "./open-world-runtime.mjs";
import { inspectCleanProjectSource } from "./project-command-executor-core.mjs";
import { spawnSafeRawGitSync } from "./repository-root.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_TREE_BYTES = 8 * 1024 * 1024;
const MAX_TREE_ENTRIES = 100_000;

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

export function resolveApplicantRepository(input) {
  if (typeof input !== "string" || input.length === 0 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(input)) {
    throw new CliFailure("REPOSITORY_REQUIRED", "repository root is invalid", { exitCode: 2 });
  }
  let root;
  try {
    root = fs.realpathSync(input);
  } catch {
    throw new CliFailure("REPOSITORY_REQUIRED", "repository root is unavailable", { exitCode: 2 });
  }
  if (!fs.statSync(root).isDirectory()) throw new CliFailure("REPOSITORY_REQUIRED", "repository root must be a directory", { exitCode: 2 });
  return root;
}

export function inspectApplicantSource(repositoryRoot) {
  try {
    return inspectCleanProjectSource(repositoryRoot);
  } catch (error) {
    throw new CliFailure("PROJECT_SOURCE_INVALID", error?.message ?? "the exact project source could not be inspected", { exitCode: 1 });
  }
}

export function resolveApplicantWorkspace(repositoryRoot, input) {
  const requested = input === null ? defaultApplicantWorkspacePath(repositoryRoot) : input;
  if (!path.isAbsolute(requested)) throw new CliFailure("WORKSPACE_PATH_INVALID", "--workspace-root must be absolute", { exitCode: 2 });
  const target = path.resolve(requested);
  if (pathsOverlap(repositoryRoot, target)) {
    throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace must remain completely outside the source repository", { exitCode: 2 });
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace must be one real non-symlink directory", { exitCode: 2 });
    }
    const realTarget = fs.realpathSync(target);
    if (pathsOverlap(repositoryRoot, realTarget)) {
      throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace resolves inside the source repository", { exitCode: 2 });
    }
    return realTarget;
  }
  const parent = nearestExisting(path.dirname(target));
  const realParent = fs.realpathSync(parent);
  const rebuilt = path.resolve(realParent, path.relative(parent, target));
  if (pathsOverlap(repositoryRoot, rebuilt)) {
    throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace resolves inside the source repository", { exitCode: 2 });
  }
  return rebuilt;
}

export function ensureApplicantWorkspaceDirectory(repositoryRoot, workspace) {
  if (fs.existsSync(workspace)) {
    const stat = fs.lstatSync(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace must be one real non-symlink directory", { exitCode: 2 });
    }
    const realWorkspace = fs.realpathSync(workspace);
    if (realWorkspace !== workspace || pathsOverlap(repositoryRoot, realWorkspace)) {
      throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace identity changed before creation", { exitCode: 2 });
    }
    return;
  }
  const parent = nearestExisting(path.dirname(workspace));
  const realParent = fs.realpathSync(parent);
  const relative = path.relative(realParent, workspace);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace parent binding is invalid", { exitCode: 2 });
  }
  let cursor = realParent;
  for (const segment of relative.split(path.sep)) {
    const candidate = path.join(cursor, segment);
    try {
      fs.mkdirSync(candidate, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = fs.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace creation encountered a non-directory or symlink", { exitCode: 2 });
    }
    const realCandidate = fs.realpathSync(candidate);
    if (realCandidate !== candidate || pathsOverlap(repositoryRoot, realCandidate)) {
      throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace creation changed identity", { exitCode: 2 });
    }
    cursor = realCandidate;
  }
  if (cursor !== workspace) {
    throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace was not created at the exact requested path", { exitCode: 2 });
  }
}

export function defaultApplicantWorkspacePath(repositoryRoot) {
  const repositoryParent = path.dirname(repositoryRoot);
  const leaf = `${path.basename(repositoryRoot)}-${sha256(Buffer.from(repositoryRoot, "utf8")).slice(7, 19)}`;
  return path.join(repositoryParent, ".programmable-applicant-workspaces", leaf);
}

export function discoverTrackedApplicantFiles(repositoryRoot, commit, basename) {
  const result = spawnSafeRawGitSync(["-C", repositoryRoot, "ls-tree", "-r", "-z", "--full-tree", commit, "--", "."], {
    timeout: 10_000,
    maxBuffer: MAX_TREE_BYTES
  });
  if (result.status !== 0) throw new CliFailure("PROJECT_SOURCE_INVALID", "tracked project files could not be read from the exact commit", { exitCode: 1 });
  const bytes = Buffer.from(result.stdout ?? Buffer.alloc(0));
  if (bytes.length > MAX_TREE_BYTES) throw new CliFailure("PROJECT_SOURCE_TOO_LARGE", "tracked project tree exceeds the bounded discovery budget", { exitCode: 1 });
  const records = bytes.toString("utf8").split("\0").filter(Boolean);
  if (records.length > MAX_TREE_ENTRIES) throw new CliFailure("PROJECT_SOURCE_TOO_LARGE", "tracked project tree has too many entries for bounded discovery", { exitCode: 1 });
  return records.map((record) => record.slice(record.indexOf("\t") + 1))
    .filter((repositoryPath) => repositoryPath === basename || repositoryPath.endsWith(`/${basename}`))
    .sort(compareUtf8);
}

export function loadApplicantPackagePointer(repositoryRoot, pointerPath, workspace, trackedSubmissionPaths) {
  const absolute = path.join(repositoryRoot, pointerPath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 64 * 1024) {
    throw new CliFailure("PROJECT_PACKAGE_POINTER_INVALID", "Applicant package pointer must be one bounded tracked regular file", { exitCode: 1 });
  }
  const bytes = fs.readFileSync(absolute);
  let value;
  try {
    value = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: 64 * 1024 });
  } catch {
    throw new CliFailure("PROJECT_PACKAGE_POINTER_INVALID", "Applicant package pointer must be duplicate-free UTF-8 JSON", { exitCode: 1 });
  }
  const keys = Object.keys(value ?? {}).sort();
  const expected = [
    "applicationDraft",
    "kind",
    "reviewPackage",
    "schemaVersion",
    "securityAssessment",
    "securityEvidenceBindings",
    "submissionV2"
  ].sort();
  if (canonicalJson(keys) !== canonicalJson(expected) || value.schemaVersion !== "1.0.0" || value.kind !== "programmable-applicant-package-pointer") {
    throw new CliFailure("PROJECT_PACKAGE_POINTER_INVALID", "Applicant package pointer has an unsupported closed shape", { exitCode: 1 });
  }
  if (!safeRepositoryPath(value.submissionV2)) {
    throw new CliFailure("PROJECT_PACKAGE_POINTER_INVALID", "submissionV2 must be one safe repository-relative tracked path", { exitCode: 1 });
  }
  if (!Array.isArray(trackedSubmissionPaths) || !trackedSubmissionPaths.includes(value.submissionV2)) {
    throw new CliFailure("PROJECT_PACKAGE_POINTER_INVALID", "submissionV2 must select one discovered tracked submission.v2.json", { exitCode: 1 });
  }
  const semantic = {};
  for (const field of ["applicationDraft", "reviewPackage", "securityAssessment", "securityEvidenceBindings"]) {
    if (!safeWorkspaceInputPath(value[field])) {
      throw new CliFailure("PROJECT_PACKAGE_POINTER_INVALID", `${field} must be one safe path below the workspace inputs directory`, { exitCode: 1 });
    }
    semantic[field] = path.join(workspace, ...value[field].split("/"));
  }
  return { pointerPath, submissionV2: value.submissionV2, ...semantic };
}

export function bindApplicantApplicationSources(application, repositoryRoot, workspace, source) {
  const repositories = [application?.source?.primary, ...(application?.source?.companions ?? [])];
  const roots = [];
  const missing = [];
  for (const repository of repositories) {
    const candidate = repository?.revisionObjectId === source.headCommit && repository?.treeObjectId === source.tree
      ? repositoryRoot
      : path.join(workspace, "sources", String(repository?.id ?? "invalid"));
    try {
      const observed = inspectApplicantSource(candidate);
      if (observed.headCommit !== repository?.revisionObjectId || observed.tree !== repository?.treeObjectId) {
        missing.push(repository?.id ?? "unknown");
        continue;
      }
      roots.push({ repositoryRef: repository.id, root: candidate });
    } catch {
      missing.push(repository?.id ?? "unknown");
    }
  }
  if (missing.length > 0 || roots.length !== repositories.length) {
    throw new CliFailure("MULTI_REPOSITORY_WORKSPACE_INCOMPLETE", `exact local source roots are missing for: ${missing.slice(0, 8).join(", ")}`, { exitCode: 1 });
  }
  return roots;
}

export function loadApplicantApplicationPackageSnapshot(applicationPackage) {
  try {
    return createOpenWorldRuntime().loadApplicationV3TransportPackage(applicationPackage);
  } catch (error) {
    if (error instanceof CliFailure) throw error;
    throw new CliFailure("APPLICATION_PACKAGE_INVALID", "Application V3.1 package could not be loaded through the hardened package validator", { exitCode: 1 });
  }
}

export function loadApplicantApplicationDraftSource(draftPath) {
  const stat = fs.lstatSync(draftPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 256 * 1024) {
    throw new CliFailure("APPLICATION_INPUT_INVALID", "application draft must be one bounded regular file", { exitCode: 1 });
  }
  try {
    return parseBoundedStrictJsonBytes(fs.readFileSync(draftPath), { maxSourceBytes: 256 * 1024, maxDepth: 256, maxNodes: 250_000 });
  } catch {
    throw new CliFailure("APPLICATION_INPUT_INVALID", "application draft must be bounded duplicate-free UTF-8 JSON", { exitCode: 1 });
  }
}

export function applicantSourceRootArgs(sourceRoots) {
  return sourceRoots.flatMap(({ repositoryRef, root }) => ["--source-root", `${repositoryRef}=${root}`]);
}

export function sameApplicantSource(left, right) {
  return left?.commit === right.headCommit && left?.tree === right.tree && left?.branch === right.branch;
}

export function isRealDirectoryWithFile(directory, filename) {
  try {
    const directoryStat = fs.lstatSync(directory);
    const file = path.join(directory, filename);
    const fileStat = fs.lstatSync(file);
    return directoryStat.isDirectory() && !directoryStat.isSymbolicLink()
      && fileStat.isFile() && !fileStat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function isExactApplicantKind(target, kind) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return false;
    return kind === "file" ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
}

function safeRepositoryPath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1024
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment !== ".git")
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function safeWorkspaceInputPath(value) {
  return safeRepositoryPath(value) && value.startsWith("inputs/");
}

function nearestExisting(input) {
  let current = path.resolve(input);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace parent is unavailable", { exitCode: 2 });
    current = parent;
  }
  const stat = fs.lstatSync(current);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CliFailure("WORKSPACE_PATH_INVALID", "Applicant workspace parent must be a real directory", { exitCode: 2 });
  return current;
}

function pathsOverlap(left, right) {
  const relativeLeft = path.relative(left, right);
  const relativeRight = path.relative(right, left);
  return inside(relativeLeft) || inside(relativeRight);
}

function inside(relativePath) {
  return relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath));
}

function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
