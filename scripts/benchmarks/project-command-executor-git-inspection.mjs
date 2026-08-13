#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { executeProjectCommands } from "../../skills/programmable-v4-hook-builder/scripts/project-command-executor-core.mjs";
import { createMaterializedRepository } from "../../skills/programmable-v4-hook-builder/scripts/test/project-compiler-fixture.mjs";

const iterations = parseIterations(process.argv.slice(2));
const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const proxySource = path.join(benchmarkDirectory, "git-counting-proxy.mjs");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-executor-benchmark-"));
const proxyPath = path.join(temporaryRoot, "git");
const logPath = path.join(temporaryRoot, "git-calls.jsonl");
const repositoryRoots = [];
const inheritedPath = process.env.PATH ?? "";
const realGit = childProcess.execFileSync("/usr/bin/env", ["which", "git"], { encoding: "utf8" }).trim();

try {
  fs.copyFileSync(proxySource, proxyPath);
  fs.chmodSync(proxyPath, 0o700);
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    samples.push(await runExecution({ instrumentGit: false }));
  }
  const inspection = await runExecution({ instrumentGit: true });

  const durations = samples.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
  process.stdout.write(`${JSON.stringify({
    benchmark: "project-command-executor-git-inspection-v1",
    commandsPerPlan: 7,
    iterations,
    medianDurationMs: durations[Math.floor(durations.length / 2)],
    minimumDurationMs: durations[0],
    maximumDurationMs: durations.at(-1),
    gitProcessesPerIteration: inspection.gitProcesses,
    gitCommandsPerIteration: inspection.gitCommands
  }, null, 2)}\n`);
} finally {
  process.env.PATH = inheritedPath;
  delete process.env.PROJECT_EXECUTOR_BENCHMARK_REAL_GIT;
  delete process.env.PROJECT_EXECUTOR_BENCHMARK_LOG;
  for (const repositoryRoot of repositoryRoots) fs.rmSync(repositoryRoot, { force: true, recursive: true });
  fs.rmSync(temporaryRoot, { force: true, recursive: true });
}

async function runExecution({ instrumentGit }) {
  process.env.PATH = instrumentGit ? `${temporaryRoot}${path.delimiter}${inheritedPath}` : inheritedPath;
  if (instrumentGit) {
    process.env.PROJECT_EXECUTOR_BENCHMARK_REAL_GIT = realGit;
    process.env.PROJECT_EXECUTOR_BENCHMARK_LOG = logPath;
  } else {
    delete process.env.PROJECT_EXECUTOR_BENCHMARK_REAL_GIT;
    delete process.env.PROJECT_EXECUTOR_BENCHMARK_LOG;
  }
  const fixture = createMaterializedRepository({ after: () => {} });
  repositoryRoots.push(fixture.root);
  if (instrumentGit) fs.writeFileSync(logPath, "");
  const startedAt = process.hrtime.bigint();
  const result = await executeProjectCommands({
    repositoryRoot: fixture.root,
    repositoryPlan: fixture.plan,
    outputPlanPath: ".programmable/repository-plan.v1.json"
  });
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  if (result.status !== "PROJECT_COMMAND_EVIDENCE_READY_TO_COMMIT") throw new Error(`unexpected executor status: ${result.status}`);
  const calls = instrumentGit ? fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { durationMs, gitProcesses: calls.length, gitCommands: countCommands(calls) };
}

function countCommands(calls) {
  const counts = {};
  for (const args of calls) {
    const command = args.find((argument) => ["check-ignore", "ls-files", "rev-parse", "status", "symbolic-ref"].includes(argument)) ?? "other";
    counts[command] = (counts[command] ?? 0) + 1;
  }
  return counts;
}

function parseIterations(args) {
  const index = args.indexOf("--iterations");
  if (index === -1) return 7;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("--iterations must be a positive integer");
  return value;
}
