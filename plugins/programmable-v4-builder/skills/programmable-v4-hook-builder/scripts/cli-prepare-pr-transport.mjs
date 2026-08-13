import { spawnSafeGitSync } from "./repository-root.mjs";
import { CliFailure } from "./cli-runtime.mjs";

export function runGit(repositoryRoot, args) {
  return spawnSafeGitSync(["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 2_000_000
  });
}

export function runGitBinary(repositoryRoot, args, options = {}) {
  return spawnSafeGitSync(["-C", repositoryRoot, ...args], {
    encoding: null,
    timeout: options.timeout ?? 5_000,
    maxBuffer: options.maxBuffer ?? 2_000_001,
    ...(options.input === undefined ? {} : { input: options.input })
  });
}

export function git(repositoryRoot, args, implementation, failure = {}) {
  const result = implementation(repositoryRoot, args);
  if (result?.status !== 0) {
    if (typeof result?.safeGitBlocker === "string") {
      throw new CliFailure("TOOLING_BLOCKED", result.safeGitBlocker, { exitCode: 1 });
    }
    throw new CliFailure(
      failure.code ?? "GIT_STATE_INVALID",
      failure.message ?? `Git command failed: ${args[0]}`,
      { exitCode: 1 }
    );
  }
  return String(result.stdout ?? "").trim();
}

export function gitBinary(repositoryRoot, args, implementation, failure = {}, options = {}) {
  const result = implementation(repositoryRoot, args, options);
  if (result?.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    if (typeof result?.safeGitBlocker === "string") {
      throw new CliFailure("TOOLING_BLOCKED", result.safeGitBlocker, { exitCode: 1 });
    }
    throw new CliFailure(
      failure.code ?? "GIT_STATE_INVALID",
      failure.message ?? "Git could not read an exact review-target blob",
      { exitCode: 1 }
    );
  }
  return result.stdout;
}
