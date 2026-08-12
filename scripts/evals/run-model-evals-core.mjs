import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { EvalValidationError, isOutsideRootRelative, validateSuite } from './validate-evals.mjs';

export const DEFAULT_MODEL_EVAL_SUITE = 'programmable-v4-hook-builder';
export const MODEL_EVAL_SUBJECT_PROVIDER_ENV = 'PROGRAMMABLE_EVAL_SUBJECT_PROVIDER';
export const MODEL_EVAL_JUDGE_PROVIDER_ENV = 'PROGRAMMABLE_EVAL_JUDGE_PROVIDER';

const EXPECTED_PROMPTFOO_VERSION = '0.121.11';
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+~=-]{0,499}$/u;

function parseArguments(argv) {
  const options = {
    suiteId: DEFAULT_MODEL_EVAL_SUITE,
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

function resolveProvider(explicitValue, environmentVariable, environment) {
  const value = explicitValue ?? environment[environmentVariable] ?? '';
  if (value === '') return null;
  if (!PROVIDER_ID_PATTERN.test(value)) {
    throw new Error(`${environmentVariable} must be one explicit Promptfoo provider ID without whitespace or template syntax`);
  }
  return value;
}

function resolveOutputPath(requestedOutput, suiteId, { repositoryRoot, filesystem, now }) {
  if (requestedOutput) {
    const outputPath = path.resolve(requestedOutput);
    const relativeToRepository = path.relative(repositoryRoot, outputPath);
    if (!isOutsideRootRelative(relativeToRepository)) {
      throw new Error('result output must be outside the repository worktree');
    }
    return outputPath;
  }
  const outputDirectory = filesystem.mkdtempSync(path.join(os.tmpdir(), 'programmable-hook-evals-'));
  filesystem.chmodSync(outputDirectory, 0o700);
  return path.join(outputDirectory, `${suiteId}-${now()}.results.json`);
}

function encode(value) {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Executes the model-evaluation CLI policy with injectable side effects. The
 * production entry point supplies real process and filesystem dependencies;
 * tests use this seam for decision coverage without revalidating the immutable
 * corpus once per argument branch.
 */
export function runModelEvals({
  argv,
  repositoryRoot,
  environment = process.env,
  filesystem = fs,
  validate = validateSuite,
  spawn = spawnSync,
  now = Date.now,
  writeStdout = () => {},
  writeStderr = () => {},
}) {
  let options;
  try {
    options = parseArguments(argv);
    validate({ repositoryRoot, suiteId: options.suiteId });
    options.subjectProvider = resolveProvider(options.subjectProvider, MODEL_EVAL_SUBJECT_PROVIDER_ENV, environment);
    options.judgeProvider = resolveProvider(options.judgeProvider, MODEL_EVAL_JUDGE_PROVIDER_ENV, environment);
    if (options.output !== null) {
      options.output = resolveOutputPath(options.output, options.suiteId, { repositoryRoot, filesystem, now });
    }
  } catch (error) {
    const payload = error instanceof EvalValidationError
      ? { status: 'MODEL_EVALS_ERROR', message: 'offline-structure-validation-failed', issues: error.issues }
      : { status: 'MODEL_EVALS_ERROR', message: error.message };
    writeStderr(encode(payload));
    return { exitCode: 2, result: payload };
  }

  if (!options.subjectProvider || !options.judgeProvider) {
    const missing = [
      !options.subjectProvider ? MODEL_EVAL_SUBJECT_PROVIDER_ENV : null,
      !options.judgeProvider ? MODEL_EVAL_JUDGE_PROVIDER_ENV : null,
    ].filter(Boolean);
    const result = {
      status: 'MODEL_EVALS_SKIPPED',
      suiteId: options.suiteId,
      reason: 'explicit subject and judge providers are not configured',
      missing,
      offlineStructure: 'valid',
      modelQuality: 'not-evaluated',
      resultArtifact: null,
      releaseGateSatisfied: false,
    };
    writeStdout(encode(result));
    return { exitCode: options.requireProvider ? 3 : 0, result };
  }

  const promptfooBinary = path.join(repositoryRoot, 'node_modules/.bin/promptfoo');
  const promptfooPackage = path.join(repositoryRoot, 'node_modules/promptfoo/package.json');
  if (!filesystem.existsSync(promptfooBinary)) {
    const result = {
      status: 'MODEL_EVALS_ERROR',
      message: 'local-promptfoo-installation-missing',
      expectedPath: 'node_modules/.bin/promptfoo',
      networkInstallAttempted: false,
    };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }
  if (!filesystem.existsSync(promptfooPackage)) {
    const result = {
      status: 'MODEL_EVALS_ERROR',
      message: 'local-promptfoo-package-metadata-missing',
      expectedPath: 'node_modules/promptfoo/package.json',
    };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }

  let installedPromptfooVersion;
  try {
    installedPromptfooVersion = JSON.parse(filesystem.readFileSync(promptfooPackage, 'utf8')).version;
  } catch (error) {
    const result = { status: 'MODEL_EVALS_ERROR', message: 'local-promptfoo-package-metadata-invalid', error: error.message };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }
  if (installedPromptfooVersion !== EXPECTED_PROMPTFOO_VERSION) {
    const result = {
      status: 'MODEL_EVALS_ERROR',
      message: 'local-promptfoo-version-mismatch',
      expectedVersion: EXPECTED_PROMPTFOO_VERSION,
      installedVersion: installedPromptfooVersion,
    };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }

  let outputPath;
  try {
    outputPath = options.output ?? resolveOutputPath(null, options.suiteId, { repositoryRoot, filesystem, now });
  } catch (error) {
    const result = { status: 'MODEL_EVALS_ERROR', message: error.message };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }
  const outputParent = path.dirname(outputPath);
  filesystem.mkdirSync(outputParent, { recursive: true, mode: 0o700 });

  const configPath = `suites/${options.suiteId}/promptfoo.yaml`;
  const child = spawn(
    promptfooBinary,
    ['eval', '-c', configPath, '--output', outputPath, '--no-progress-bar'],
    {
      cwd: path.join(repositoryRoot, 'evals'),
      env: {
        ...environment,
        [MODEL_EVAL_SUBJECT_PROVIDER_ENV]: options.subjectProvider,
        [MODEL_EVAL_JUDGE_PROVIDER_ENV]: options.judgeProvider,
        PROMPTFOO_DISABLE_TELEMETRY: '1',
        PROMPTFOO_CACHE_ENABLED: 'false',
      },
      stdio: 'inherit',
    },
  );
  if (child.error) {
    const result = { status: 'MODEL_EVALS_ERROR', message: 'promptfoo-process-failed-to-start', error: child.error.message };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }
  if (child.status !== 0) {
    const result = { status: 'MODEL_EVALS_ERROR', message: 'model-evaluation-failed', exitCode: child.status, resultArtifact: outputPath };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }
  if (!filesystem.existsSync(outputPath)) {
    const result = { status: 'MODEL_EVALS_ERROR', message: 'promptfoo-returned-success-without-result-artifact' };
    writeStderr(encode(result));
    return { exitCode: 2, result };
  }
  const result = {
    status: 'MODEL_EVALS_COMPLETED',
    suiteId: options.suiteId,
    resultArtifact: outputPath,
    providers: { subject: options.subjectProvider, judge: options.judgeProvider },
    offlineStructure: 'valid',
    note: 'Promptfoo assertions passed; this is not approval, deployment, routing, or endorsement evidence.',
  };
  writeStdout(encode(result));
  return { exitCode: 0, result };
}
