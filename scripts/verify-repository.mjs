#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const checks = [
  ["plugin-manifests", [process.execPath, "scripts/generate-plugin-manifests.mjs", "--check"]],
  ["portable-skill", [process.execPath, "skills/programmable-v4-hook-builder/scripts/verify-skill.mjs"]],
  ["eval-structure", [process.execPath, "scripts/evals/validate-evals.mjs"]],
  ["repository-contract", [process.execPath, "--test", "test/repository-contract.test.mjs"]]
];

const results = [];
for (const [id, [command, ...args]] of checks) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  results.push({ id, exitCode: result.status });
  if (result.status !== 0) {
    if (result.stdout) fsWrite(1, result.stdout);
    if (result.stderr) fsWrite(2, result.stderr);
    fsWrite(2, `repository check failed: ${id}\n`);
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (process.exitCode === undefined) {
  process.stdout.write(`${JSON.stringify({
    status: "REPOSITORY_VALID",
    version: "0.4.4",
    networkAccessed: false,
    externalActionsPerformed: [],
    checks: results
  }, null, 2)}\n`);
}

function fsWrite(fd, contents) {
  fs.writeSync(fd, contents);
}
