#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runModelEvals } from './run-model-evals-core.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  process.umask(0o077);
  const { exitCode } = runModelEvals({
    argv: process.argv.slice(2),
    repositoryRoot: REPOSITORY_ROOT,
    writeStdout: (value) => process.stdout.write(value),
    writeStderr: (value) => process.stderr.write(value),
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}
