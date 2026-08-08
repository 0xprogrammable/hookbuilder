#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  EvalValidationError,
  isOutsideRootRelative,
  validateSuite,
} from './validate-evals.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');
const DEFAULT_SUITE = 'programmable-v4-hook-builder';
const EXPECTED_PROMPTFOO_VERSION = '0.121.11';
const SUBJECT_PROVIDER_ENV = 'PROGRAMMABLE_EVAL_SUBJECT_PROVIDER';
const JUDGE_PROVIDER_ENV = 'PROGRAMMABLE_EVAL_JUDGE_PROVIDER';
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+~=-]{0,499}$/u;

process.umask(0o077);

function parseArguments(argv) {
  const options = {
    suiteId: DEFAULT_SUITE,
    requireProvider: false,
    output: null,
    subjectProvider: null,
    judgeProvider: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--suite') {
      options.suiteId = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--suite=')) {
      options.suiteId = argument.slice('--suite='.length);
    } else if (argument === '--require-provider') {
      options.requireProvider = true;
    } else if (argument === '--subject-provider') {
      options.subjectProvider = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--subject-provider=')) {
      options.subjectProvider = argument.slice('--subject-provider='.length);
    } else if (argument === '--judge-provider') {
      options.judgeProvider = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--judge-provider=')) {
      options.judgeProvider = argument.slice('--judge-provider='.length);
    } else if (argument === '--output') {
      options.output = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--output=')) {
      options.output = argument.slice('--output='.length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function emit(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(message, details = {}) {
  emit({ status: 'MODEL_EVALS_ERROR', message, ...details }, process.stderr);
  process.exitCode = 2;
}

function resolveProvider(explicitValue, environmentVariable) {
  const value = explicitValue ?? process.env[environmentVariable] ?? '';
  if (value === '') return null;
  if (!PROVIDER_ID_PATTERN.test(value)) {
    throw new Error(`${environmentVariable} must be one explicit Promptfoo provider ID without whitespace or template syntax`);
  }
  return value;
}

function resolveOutputPath(requestedOutput, suiteId) {
  if (requestedOutput) {
    const outputPath = path.resolve(requestedOutput);
    const relativeToRepository = path.relative(REPOSITORY_ROOT, outputPath);
    if (!isOutsideRootRelative(relativeToRepository)) {
      throw new Error('result output must be outside the repository worktree');
    }
    return outputPath;
  }
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-hook-evals-'));
  fs.chmodSync(outputDirectory, 0o700);
  return path.join(outputDirectory, `${suiteId}-${Date.now()}.results.json`);
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
  validateSuite({ repositoryRoot: REPOSITORY_ROOT, suiteId: options.suiteId });
  options.subjectProvider = resolveProvider(options.subjectProvider, SUBJECT_PROVIDER_ENV);
  options.judgeProvider = resolveProvider(options.judgeProvider, JUDGE_PROVIDER_ENV);
  if (options.output !== null) options.output = resolveOutputPath(options.output, options.suiteId);
} catch (error) {
  if (error instanceof EvalValidationError) {
    fail('offline-structure-validation-failed', { issues: error.issues });
  } else {
    fail(error.message);
  }
}

if (!process.exitCode && (!options.subjectProvider || !options.judgeProvider)) {
  const missing = [
    !options.subjectProvider ? SUBJECT_PROVIDER_ENV : null,
    !options.judgeProvider ? JUDGE_PROVIDER_ENV : null,
  ].filter(Boolean);
  emit({
    status: 'MODEL_EVALS_SKIPPED',
    suiteId: options.suiteId,
    reason: 'explicit subject and judge providers are not configured',
    missing,
    offlineStructure: 'valid',
    modelQuality: 'not-evaluated',
    resultArtifact: null,
    releaseGateSatisfied: false,
  });
  if (options.requireProvider) process.exitCode = 3;
}

if (!process.exitCode && options.subjectProvider && options.judgeProvider) {
  const promptfooBinary = path.join(REPOSITORY_ROOT, 'node_modules/.bin/promptfoo');
  const promptfooPackage = path.join(REPOSITORY_ROOT, 'node_modules/promptfoo/package.json');
  if (!fs.existsSync(promptfooBinary)) {
    fail('local-promptfoo-installation-missing', {
      expectedPath: 'node_modules/.bin/promptfoo',
      networkInstallAttempted: false,
    });
  } else if (!fs.existsSync(promptfooPackage)) {
    fail('local-promptfoo-package-metadata-missing', {
      expectedPath: 'node_modules/promptfoo/package.json',
    });
  } else {
    let installedPromptfooVersion;
    try {
      installedPromptfooVersion = JSON.parse(fs.readFileSync(promptfooPackage, 'utf8')).version;
    } catch (error) {
      fail('local-promptfoo-package-metadata-invalid', { error: error.message });
    }

    if (process.exitCode) process.exit();
    if (installedPromptfooVersion !== EXPECTED_PROMPTFOO_VERSION) {
      fail('local-promptfoo-version-mismatch', {
        expectedVersion: EXPECTED_PROMPTFOO_VERSION,
        installedVersion: installedPromptfooVersion,
      });
    }

    if (process.exitCode) process.exit();
    let outputPath;
    try {
      outputPath = options.output ?? resolveOutputPath(null, options.suiteId);
    } catch (error) {
      fail(error.message);
    }

    if (process.exitCode) process.exit();
    const outputParent = path.dirname(outputPath);
    fs.mkdirSync(outputParent, { recursive: true, mode: 0o700 });

    const configPath = `suites/${options.suiteId}/promptfoo.yaml`;
    const child = spawnSync(
      promptfooBinary,
      ['eval', '-c', configPath, '--output', outputPath, '--no-progress-bar'],
      {
        cwd: path.join(REPOSITORY_ROOT, 'evals'),
        env: {
          ...process.env,
          [SUBJECT_PROVIDER_ENV]: options.subjectProvider,
          [JUDGE_PROVIDER_ENV]: options.judgeProvider,
          PROMPTFOO_DISABLE_TELEMETRY: '1',
          PROMPTFOO_CACHE_ENABLED: 'false',
        },
        stdio: 'inherit',
      },
    );

    if (child.error) {
      fail('promptfoo-process-failed-to-start', { error: child.error.message });
    } else if (child.status !== 0) {
      fail('model-evaluation-failed', { exitCode: child.status, resultArtifact: outputPath });
    } else if (!fs.existsSync(outputPath)) {
      fail('promptfoo-returned-success-without-result-artifact');
    } else {
      emit({
        status: 'MODEL_EVALS_COMPLETED',
        suiteId: options.suiteId,
        resultArtifact: outputPath,
        providers: {
          subject: options.subjectProvider,
          judge: options.judgeProvider,
        },
        offlineStructure: 'valid',
        note: 'Promptfoo assertions passed; this is not approval, deployment, routing, or endorsement evidence.',
      });
    }
  }
}
