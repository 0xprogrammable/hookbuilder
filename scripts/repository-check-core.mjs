import { runBoundedChildProcess } from "../skills/programmable-v4-hook-builder/scripts/bounded-child-process-core.mjs";

const CHECK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAXIMUM_CHECK_TIMEOUT_MS = 20 * 60 * 1000;
const MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024;

export class RepositoryCheckError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RepositoryCheckError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function createRepositoryCheckPlan({
  nodeExecutable,
  npmExecutable,
  e2eTests,
  mcpTests,
  repositoryTests
}) {
  requireCommand(nodeExecutable, "Node executable");
  requireCommand(npmExecutable, "npm executable");
  requireTestFiles(e2eTests, "E2E harness tests");
  requireTestFiles(mcpTests, "MCP tests");
  requireTestFiles(repositoryTests, "repository tests");

  return validateRepositoryCheckPlan([
    {
      id: "plugin-manifests",
      command: nodeExecutable,
      args: ["scripts/generate-plugin-manifests.mjs", "--check"],
      timeoutMs: 120_000
    },
    {
      id: "applicant-submissions",
      command: nodeExecutable,
      args: ["scripts/validate-applicant-submission.mjs", "--all"],
      timeoutMs: 120_000
    },
    {
      id: "route-capabilities",
      command: nodeExecutable,
      args: ["scripts/validate-route-capability-catalog.mjs"],
      timeoutMs: 120_000
    },
    {
      id: "mcp-server",
      command: nodeExecutable,
      args: ["--test", ...mcpTests],
      timeoutMs: 300_000
    },
    {
      id: "portable-skill",
      command: nodeExecutable,
      args: ["skills/programmable-v4-hook-builder/scripts/verify-skill.mjs"],
      // The inner aggregate owns a 15-minute cleanup deadline. Keep the outer
      // release gate later so it can report and reap that result itself.
      timeoutMs: 16 * 60 * 1000
    },
    {
      id: "eval-structure",
      command: nodeExecutable,
      args: ["scripts/evals/validate-evals.mjs"],
      timeoutMs: 120_000
    },
    {
      id: "eval-e2e-harness",
      command: nodeExecutable,
      args: ["--test", ...e2eTests],
      timeoutMs: 10 * 60 * 1000
    },
    {
      id: "maintainability",
      command: npmExecutable,
      args: ["run", "quality:maintainability"],
      timeoutMs: 600_000
    },
    {
      id: "repository-contract",
      command: nodeExecutable,
      args: ["--test", ...repositoryTests],
      timeoutMs: 600_000
    }
  ]);
}

export function validateRepositoryCheckPlan(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_PLAN_INVALID", "repository check plan must not be empty");
  }
  const ids = new Set();
  const validated = checks.map((check) => validateCheck(check, ids));
  if (!ids.has("maintainability")) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_PLAN_INVALID", "repository check plan must run maintainability exactly once");
  }
  return Object.freeze(validated);
}

export async function runBoundedRepositoryCheck(check, { cwd } = {}) {
  const effectiveCheck = validateCheck(check, new Set());
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_INPUT_INVALID", "repository check execution input is invalid");
  }

  let result;
  try {
    result = await runBoundedChildProcess({
      command: effectiveCheck.command,
      args: effectiveCheck.args,
      cwd,
      env: process.env,
      timeoutMs: effectiveCheck.timeoutMs,
      maximumOutputBytes: MAXIMUM_OUTPUT_BYTES
    });
  } catch (error) {
    throw new RepositoryCheckError(
      "REPOSITORY_CHECK_EXECUTION_FAILED",
      `repository check could not run: ${effectiveCheck.id}: ${error.message}`,
      { id: effectiveCheck.id, timeoutMs: effectiveCheck.timeoutMs }
    );
  }
  const details = {
    id: effectiveCheck.id,
    timeoutMs: effectiveCheck.timeoutMs,
    stdout: result.stdout,
    stderr: result.stderr
  };
  if (result.timedOut) {
    throw new RepositoryCheckError(
      "REPOSITORY_CHECK_TIMEOUT",
      `repository check timed out: ${effectiveCheck.id} after ${effectiveCheck.timeoutMs}ms`,
      details
    );
  }
  if (result.outputExceeded) {
    throw new RepositoryCheckError(
      "REPOSITORY_CHECK_OUTPUT_LIMIT",
      `repository check exceeded its output limit: ${effectiveCheck.id}`,
      details
    );
  }
  if (result.status !== 0) {
    throw new RepositoryCheckError(
      "REPOSITORY_CHECK_FAILED",
      `repository check failed: ${effectiveCheck.id}`,
      { ...details, exitCode: result.status, signal: result.signal ?? null }
    );
  }
  return Object.freeze({
    id: effectiveCheck.id,
    exitCode: result.status,
    timeoutMs: effectiveCheck.timeoutMs
  });
}

function validateCheck(check, ids) {
  if (
    check === null
    || typeof check !== "object"
    || Object.getPrototypeOf(check) !== Object.prototype
    || !CHECK_ID.test(check.id ?? "")
    || ids.has(check.id)
  ) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_PLAN_INVALID", "repository check ids must be unique canonical identifiers");
  }
  ids.add(check.id);
  requireCommand(check.command, `${check.id} command`);
  if (!Array.isArray(check.args) || check.args.some((argument) => typeof argument !== "string")) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_PLAN_INVALID", `${check.id} arguments are invalid`);
  }
  if (
    !Number.isSafeInteger(check.timeoutMs)
    || check.timeoutMs < 1
    || check.timeoutMs > MAXIMUM_CHECK_TIMEOUT_MS
  ) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_PLAN_INVALID", `${check.id} timeout is invalid`);
  }
  return Object.freeze({ ...check, args: Object.freeze([...check.args]) });
}

function requireCommand(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_PLAN_INVALID", `${label} is invalid`);
  }
}

function requireTestFiles(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !entry.endsWith(".test.mjs"))) {
    throw new RepositoryCheckError("REPOSITORY_CHECK_PLAN_INVALID", `${label} are invalid`);
  }
}
