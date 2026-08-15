#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

import {
  DEFAULT_REPOSITORY_ROOT,
  JourneyBenchmarkError,
  loadFrozenCorpus,
  runJourneyBenchmark,
} from './journey-benchmark-core.mjs';

process.umask(0o077);

function parseArguments(argv) {
  const options = {
    allowAdapters: false,
    configPath: null,
    outputPath: null,
    requireProvider: false,
    validateOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--allow-adapters') {
      options.allowAdapters = true;
    } else if (argument === '--require-provider') {
      options.requireProvider = true;
    } else if (argument === '--validate-only') {
      options.validateOnly = true;
    } else if (argument === '--config') {
      options.configPath = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--config=')) {
      options.configPath = argument.slice('--config='.length);
    } else if (argument === '--output') {
      options.outputPath = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--output=')) {
      options.outputPath = argument.slice('--output='.length);
    } else {
      throw new JourneyBenchmarkError('ARGUMENT_INVALID', `unknown argument: ${argument}`);
    }
  }
  return options;
}

function emit(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const corpus = loadFrozenCorpus({ repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  if (options.validateOnly) {
    if (options.configPath !== null || options.outputPath !== null || options.allowAdapters) {
      throw new JourneyBenchmarkError('ARGUMENT_INVALID', '--validate-only cannot be combined with config, output, or adapter execution');
    }
    emit({
      status: 'JOURNEY_BENCHMARK_CORPUS_VALID',
      corpusId: corpus.corpus.corpusId,
      corpusSha256: corpus.corpusSha256,
      caseCount: corpus.caseCount,
      counts: corpus.counts,
      providerExecution: 'not-run',
      releaseGateSatisfied: false,
    });
    return;
  }
  if (options.configPath === null || options.outputPath === null || !options.allowAdapters) {
    emit({
      status: 'JOURNEY_BENCHMARK_EXTERNAL_BLOCKED',
      corpusId: corpus.corpus.corpusId,
      corpusSha256: corpus.corpusSha256,
      reason: 'real execution requires an absolute external config, an absolute new output directory, and --allow-adapters',
      missing: [
        options.configPath === null ? '--config' : null,
        options.outputPath === null ? '--output' : null,
        !options.allowAdapters ? '--allow-adapters' : null,
      ].filter(Boolean),
      providerExecution: 'not-run',
      releaseGateSatisfied: false,
    });
    if (options.requireProvider) process.exitCode = 3;
    return;
  }
  if (!path.isAbsolute(options.configPath) || !path.isAbsolute(options.outputPath)) {
    throw new JourneyBenchmarkError('ARGUMENT_INVALID', '--config and --output must be absolute paths');
  }
  const result = await runJourneyBenchmark({
    configPath: options.configPath,
    outputPath: options.outputPath,
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  emit({
    status: result.scorecard.status,
    evidenceQualification: result.scorecard.evidenceQualification,
    releaseGateSatisfied: result.scorecard.releaseGateSatisfied,
    scorecard: result.scorecardPath,
    scorecardSha256: result.scorecardSha256,
    plannedRuns: result.scorecard.runPlan.plannedRuns,
    completedRuns: result.scorecard.runs.filter(({ harnessStatus }) => harnessStatus === 'COMPLETED').length,
    primaryDiagnostics: [
      ...(!result.scorecard.gates.allRunsCompleted ? ['one or more subject or judge adapter runs failed'] : []),
      ...(!result.scorecard.gates.allNonCompensatingGatesPass ? ['one or more non-compensating correctness or evidence gates failed'] : []),
      ...result.scorecard.releaseBlockers,
    ].slice(0, 3),
  });
  if (result.scorecard.status !== 'BENCHMARK_COMPLETED') process.exitCode = 1;
}

main().catch((error) => {
  const payload = error instanceof JourneyBenchmarkError
    ? { status: 'JOURNEY_BENCHMARK_ERROR', code: error.code, message: error.message, details: error.details }
    : { status: 'JOURNEY_BENCHMARK_ERROR', code: 'UNEXPECTED_ERROR', message: error.message };
  emit(payload, process.stderr);
  process.exitCode = 2;
});
