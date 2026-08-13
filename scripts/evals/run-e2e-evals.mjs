#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { E2EStructureError, validateE2EStructure } from './e2e-corpus-core.mjs';
import { E2ERunError, parseAdapterCommand, runE2EEvaluations } from './e2e-run-core.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');
const MAX_REPETITIONS = 10;
const MAX_PLANNED_RUNS = 720;
const EXTERNAL_INPUT_PATH_ENVIRONMENTS = Object.freeze([
  'PROGRAMMABLE_E2E_HOLDOUT_KEY_FILE',
  'PROGRAMMABLE_E2E_SUBJECT_SANDBOX_RECEIPT',
  'PROGRAMMABLE_E2E_SUBJECT_SANDBOX_WRAPPER',
]);

function parseArguments(argv) {
  const options = {
    validateOnly: false,
    requireProvider: false,
    repetitions: 3,
    cases: [],
    tiers: [],
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--validate-only') options.validateOnly = true;
    else if (argument === '--require-provider') options.requireProvider = true;
    else if (argument === '--case') options.cases.push(requiredValue(argv, ++index, '--case'));
    else if (argument.startsWith('--case=')) options.cases.push(argument.slice('--case='.length));
    else if (argument === '--tier') options.tiers.push(requiredValue(argv, ++index, '--tier'));
    else if (argument.startsWith('--tier=')) options.tiers.push(argument.slice('--tier='.length));
    else if (argument === '--repetitions') options.repetitions = parseCount(requiredValue(argv, ++index, '--repetitions'));
    else if (argument.startsWith('--repetitions=')) options.repetitions = parseCount(argument.slice('--repetitions='.length));
    else if (argument === '--output') options.output = requiredValue(argv, ++index, '--output');
    else if (argument.startsWith('--output=')) options.output = argument.slice('--output='.length);
    else if (argument === '--help') options.help = true;
    else throw new E2ERunError('ARGUMENT_INVALID', `unknown argument: ${argument}`);
  }
  options.cases = unique(options.cases, '--case');
  options.tiers = unique(options.tiers, '--tier');
  return options;
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new E2ERunError('ARGUMENT_INVALID', `${option} requires a value`);
  return value;
}

function parseCount(value) {
  if (!/^[0-9]+$/u.test(value)) throw new E2ERunError('ARGUMENT_INVALID', '--repetitions must be an integer');
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_REPETITIONS) {
    throw new E2ERunError(
      'REPETITIONS_INVALID',
      `--repetitions must be a safe integer between 1 and ${MAX_REPETITIONS}`,
    );
  }
  return count;
}

function unique(values, option) {
  if (new Set(values).size !== values.length) throw new E2ERunError('ARGUMENT_INVALID', `${option} cannot repeat the same value`);
  return values;
}

function isContainedBy(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertPlainDirectory(directory, label = '--output parent') {
  const stat = lstatOrNull(directory);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new E2ERunError('OUTPUT_INVALID', `${label} must be a non-symbolic directory: ${directory}`);
  }
  return stat;
}

function createAndInventoryParent(parent) {
  const normalized = path.normalize(parent);
  const root = path.parse(normalized).root;
  const identities = [{ path: root, stat: assertPlainDirectory(root) }];
  const relative = path.relative(root, normalized);
  let cursor = root;
  for (const component of relative === '' ? [] : relative.split(path.sep)) {
    cursor = path.join(cursor, component);
    let stat = lstatOrNull(cursor);
    if (!stat) {
      try {
        fs.mkdirSync(cursor, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      stat = lstatOrNull(cursor);
    }
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new E2ERunError(
        'OUTPUT_INVALID',
        `--output parent chain must contain only non-symbolic directories: ${cursor}`,
      );
    }
    identities.push({ path: cursor, stat });
  }
  return identities;
}

function canonicalInputRecord(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.length === 0) return null;
  const absolute = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(REPOSITORY_ROOT, inputPath);
  if (!lstatOrNull(absolute)) return null;
  let canonicalPath;
  let stat;
  try {
    canonicalPath = fs.realpathSync.native(absolute);
    stat = fs.statSync(canonicalPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return {
    path: canonicalPath,
    directory: stat.isDirectory(),
  };
}

function commandInputPaths(command) {
  if (!command) return [];
  return command.filter((argument) => (
    path.isAbsolute(argument)
    || argument.startsWith(`.${path.sep}`)
    || argument.includes(path.sep)
  ));
}

function evaluationInputRecords({ adapterCommand, judgeCommand, sandboxWrapperCommand }) {
  const candidates = [
    REPOSITORY_ROOT,
    ...commandInputPaths(adapterCommand),
    ...commandInputPaths(judgeCommand),
    ...commandInputPaths(sandboxWrapperCommand),
    ...EXTERNAL_INPUT_PATH_ENVIRONMENTS.map((name) => process.env[name] ?? ''),
  ];
  const records = candidates.map(canonicalInputRecord).filter(Boolean);
  return records.filter((record, index) => (
    records.findIndex((candidate) => candidate.path === record.path) === index
  ));
}

function assertOutsideInputs(destination, inputRecords) {
  for (const input of inputRecords) {
    const overlaps = input.directory
      ? isContainedBy(destination, input.path)
      : destination === input.path;
    if (overlaps) {
      throw new E2ERunError(
        'OUTPUT_INVALID',
        `--output must remain outside evaluation inputs: ${input.path}`,
      );
    }
  }
}

function recheckParentIdentities(identities, canonicalParent) {
  for (const record of identities) {
    const observed = assertPlainDirectory(record.path);
    if (!sameIdentity(observed, record.stat)) {
      throw new E2ERunError('OUTPUT_INVALID', `--output parent identity changed: ${record.path}`);
    }
  }
  if (fs.realpathSync.native(identities.at(-1).path) !== canonicalParent) {
    throw new E2ERunError('OUTPUT_INVALID', '--output canonical parent changed during evaluation');
  }
}

function outputCandidate(requested) {
  if (requested !== null) {
    if (!path.isAbsolute(requested)) throw new E2ERunError('OUTPUT_INVALID', '--output must be an absolute path');
    return { destination: path.normalize(requested), disposableParent: null };
  }
  const canonicalTemporaryRoot = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(canonicalTemporaryRoot, 'programmable-e2e-scorecard-'));
  fs.chmodSync(directory, 0o700);
  return { destination: path.join(directory, 'scorecard.json'), disposableParent: directory };
}

function reserveOutput(requested, inputRecords) {
  const { destination, disposableParent } = outputCandidate(requested);
  const parent = path.dirname(destination);
  let identities;
  let canonicalDestination;
  let descriptor;
  let reservationIdentity;
  let committed = false;
  let temporaryArtifact = null;
  try {
    assertOutsideInputs(destination, inputRecords);
    identities = createAndInventoryParent(parent);
    const canonicalParent = fs.realpathSync.native(parent);
    canonicalDestination = path.join(canonicalParent, path.basename(destination));
    assertOutsideInputs(canonicalDestination, inputRecords);
    if (lstatOrNull(canonicalDestination)) {
      throw new E2ERunError('OUTPUT_INVALID', '--output must be a new file');
    }
    recheckParentIdentities(identities, canonicalParent);
    descriptor = fs.openSync(
      canonicalDestination,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600,
    );
    reservationIdentity = fs.fstatSync(descriptor);

    function assertReservationUnchanged() {
      recheckParentIdentities(identities, canonicalParent);
      const observed = lstatOrNull(canonicalDestination);
      const opened = fs.fstatSync(descriptor);
      if (
        !observed
        || observed.isSymbolicLink()
        || !observed.isFile()
        || !sameIdentity(observed, reservationIdentity)
        || !sameIdentity(opened, reservationIdentity)
      ) {
        throw new E2ERunError('OUTPUT_INVALID', '--output reservation changed during evaluation');
      }
    }

    return {
      destination: canonicalDestination,
      commit(contents) {
        assertReservationUnchanged();
        temporaryArtifact = path.join(
          canonicalParent,
          `.${path.basename(canonicalDestination)}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`,
        );
        const temporaryDescriptor = fs.openSync(
          temporaryArtifact,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
          0o600,
        );
        try {
          fs.writeFileSync(temporaryDescriptor, contents, { encoding: 'utf8' });
          fs.fsyncSync(temporaryDescriptor);
        } finally {
          fs.closeSync(temporaryDescriptor);
        }
        assertReservationUnchanged();
        fs.renameSync(temporaryArtifact, canonicalDestination);
        temporaryArtifact = null;
        committed = true;
        fs.closeSync(descriptor);
        descriptor = undefined;
      },
      cleanup() {
        if (descriptor !== undefined) {
          fs.closeSync(descriptor);
          descriptor = undefined;
        }
        if (temporaryArtifact) {
          try {
            fs.unlinkSync(temporaryArtifact);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          temporaryArtifact = null;
        }
        if (!committed) {
          const observed = lstatOrNull(canonicalDestination);
          if (observed && reservationIdentity && sameIdentity(observed, reservationIdentity)) {
            fs.unlinkSync(canonicalDestination);
          }
          if (disposableParent) {
            try {
              fs.rmdirSync(disposableParent);
            } catch (error) {
              if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
            }
          }
        }
      },
    };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (canonicalDestination && reservationIdentity) {
      const observed = lstatOrNull(canonicalDestination);
      if (observed && sameIdentity(observed, reservationIdentity)) fs.unlinkSync(canonicalDestination);
    }
    if (disposableParent) {
      try {
        fs.rmdirSync(disposableParent);
      } catch (cleanupError) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(cleanupError.code)) throw cleanupError;
      }
    }
    throw error;
  }
}

function assertPlannedRunLimit(options, structure) {
  if (options.repetitions < structure.minimumRepetitions) {
    throw new E2ERunError(
      'REPETITIONS_INVALID',
      `repetitions must be at least ${structure.minimumRepetitions}`,
    );
  }
  const caseCount = options.cases.length || structure.sealedRepositoryCaseEnvelopeCount;
  const tierCount = options.tiers.length || structure.tierProfiles.length;
  const plannedRuns = caseCount * tierCount * options.repetitions;
  if (!Number.isSafeInteger(plannedRuns) || plannedRuns > MAX_PLANNED_RUNS) {
    throw new E2ERunError(
      'PLANNED_RUNS_INVALID',
      `planned run count must not exceed ${MAX_PLANNED_RUNS}`,
    );
  }
  return plannedRuns;
}

function printHelp() {
  process.stdout.write(
    'Usage: run-e2e-evals.mjs [--validate-only] [--require-provider] [--case <id>] [--tier <frontier|mid|small>] [--repetitions <n>=3] [--output <absolute-new-file>]\n\n'
      + 'Execution requires agent and independent-judge adapters plus the selected tier and judge model environment variables.\n'
      + 'The adapter command is a JSON string array. The harness appends only --skill <installed-path> and --prompt <natural-prompt>.\n'
      + 'The judge receives a frozen-commit request; its model must differ from every subject model.\n'
      + 'Execution also requires an external 0600 holdout key and a separate-UID/container/VM wrapper contract covering generation, every stage, and judge teardown.\n'
      + 'Fork cases require a loopback PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL; raw provider URLs are not passed to generated code.\n'
      + 'The 47 public response evals and 24 sealed-after-design repository cases are distinct methods and never combined into a pass rate.\n'
      + 'Independent novel holdouts, comparable public repository E2Es, trusted provider receipt verification, and a prior-release comparator remain explicit release blockers.\n',
  );
}

function modelIdsFromEnvironment() {
  return {
    frontier: process.env.PROGRAMMABLE_E2E_FRONTIER_MODEL ?? '',
    mid: process.env.PROGRAMMABLE_E2E_MID_MODEL ?? '',
    small: process.env.PROGRAMMABLE_E2E_SMALL_MODEL ?? '',
  };
}

export function runCli(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    printHelp();
    return { exitCode: 0, result: null };
  }
  const structure = validateE2EStructure({ repositoryRoot: REPOSITORY_ROOT });
  if (options.validateOnly) {
    process.stdout.write(`${JSON.stringify(structure)}\n`);
    return { exitCode: 0, result: structure };
  }
  assertPlannedRunLimit(options, structure);
  const adapterCommand = parseAdapterCommand(process.env.PROGRAMMABLE_E2E_AGENT_ADAPTER_JSON ?? '');
  const judgeCommand = parseAdapterCommand(
    process.env.PROGRAMMABLE_E2E_JUDGE_ADAPTER_JSON ?? '',
    'judge adapter',
  );
  const sandboxWrapperCommand = parseAdapterCommand(
    process.env.PROGRAMMABLE_E2E_SUBJECT_SANDBOX_WRAPPER ?? '',
    'sandbox wrapper',
  );
  const output = reserveOutput(
    options.output,
    evaluationInputRecords({ adapterCommand, judgeCommand, sandboxWrapperCommand }),
  );
  let scorecard;
  try {
    scorecard = runE2EEvaluations({
      repositoryRoot: REPOSITORY_ROOT,
      adapterCommand,
      judgeCommand,
      modelIds: modelIdsFromEnvironment(),
      judgeModelId: process.env.PROGRAMMABLE_E2E_JUDGE_MODEL ?? '',
      holdoutKeyFilePath: process.env.PROGRAMMABLE_E2E_HOLDOUT_KEY_FILE ?? '',
      sandboxWrapperCommand,
      sandboxContractPath: process.env.PROGRAMMABLE_E2E_SUBJECT_SANDBOX_RECEIPT ?? '',
      forkRpcProxyUrl: process.env.PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL ?? '',
      caseIds: options.cases,
      tierIds: options.tiers,
      repetitions: options.repetitions,
      validatedStructure: structure,
    });
    output.commit(`${JSON.stringify(scorecard, null, 2)}\n`);
  } finally {
    output.cleanup();
  }
  const result = {
    status: scorecard.status,
    scorecardSha256: scorecard.scorecardSha256,
    resultArtifact: output.destination,
    primaryDiagnostics: scorecard.diagnostics.primary,
    exhaustiveDiagnosticsArtifact: output.destination,
    plannedRunCount: scorecard.plannedRunCount,
    completedRunCount: scorecard.completedRunCount,
    releaseGateSatisfied: scorecard.status === 'PASS',
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const exitCode = scorecard.sealedCorpusThresholdOutcome === 'FAIL' && scorecard.completedRunCount > 0
    ? 1
    : scorecard.status === 'EXTERNAL_BLOCKED' && options.requireProvider
      ? 3
      : 0;
  return { exitCode, result };
}

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  process.umask(0o077);
  try {
    const { exitCode } = runCli(process.argv.slice(2));
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (error) {
    const details = error instanceof E2EStructureError ? { issues: error.issues } : {};
    process.stderr.write(`${JSON.stringify({
      status: 'E2E_HARNESS_ERROR',
      code: error.code ?? error.name ?? 'ERROR',
      message: error.message,
      ...details,
    })}\n`);
    process.exitCode = 2;
  }
}
