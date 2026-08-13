#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import process from "node:process";

const executable = process.env.PROJECT_EXECUTOR_BENCHMARK_REAL_GIT;
const logPath = process.env.PROJECT_EXECUTOR_BENCHMARK_LOG;
if (!executable || !logPath) throw new Error("benchmark Git proxy environment is unavailable");

fs.appendFileSync(logPath, `${JSON.stringify(process.argv.slice(2))}\n`);
const result = childProcess.spawnSync(executable, process.argv.slice(2), {
  encoding: "buffer",
  env: process.env,
  shell: false
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
