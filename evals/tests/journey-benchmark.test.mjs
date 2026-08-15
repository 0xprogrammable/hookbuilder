import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CORPUS_RELATIVE_PATH,
  JourneyBenchmarkError,
  inventoryDirectory,
  loadFrozenCorpus,
  runJourneyBenchmark,
  validateBenchmarkConfig,
  validateCorpusDocument,
} from '../../scripts/evals/journey-benchmark-core.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
const RUNNER = path.join(REPOSITORY_ROOT, 'scripts/evals/run-journey-benchmark.mjs');
const FAKE_ADAPTER = path.join(TEST_DIRECTORY, 'fixtures/fake-journey-benchmark-adapter.mjs');
const SKILL_PATH = path.join(REPOSITORY_ROOT, 'skills/programmable-v4-hook-builder');

function temporaryDirectory(t, prefix = 'programmable-journey-test-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fakeConfig(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    evidenceMode: 'FAKE_ADAPTER_TEST',
    concurrency: 4,
    repetitions: 1,
    timeoutMs: 30_000,
    environmentAllowlist: [],
    subjects: [
      {
        id: 'v0-9-1-baseline',
        role: 'baseline',
        skillPath: SKILL_PATH,
        adapterArgv: [process.execPath, FAKE_ADAPTER],
        host: { name: 'fake-host', version: '1', provider: 'local-fixture', model: 'fake-subject-model' },
      },
      {
        id: 'v0-10-candidate',
        role: 'candidate',
        skillPath: SKILL_PATH,
        adapterArgv: [process.execPath, FAKE_ADAPTER],
        host: { name: 'fake-host', version: '1', provider: 'local-fixture', model: 'fake-subject-model' },
      },
    ],
    judge: {
      adapterArgv: [process.execPath, FAKE_ADAPTER],
      host: { name: 'fake-judge-host', version: '1', provider: 'local-fixture', model: 'fake-independent-judge-model' },
    },
    ...overrides,
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

test('frozen public journey corpus covers the exact complaint and required neighboring groups', () => {
  const result = loadFrozenCorpus({ repositoryRoot: REPOSITORY_ROOT });
  assert.equal(result.corpus.corpusId, 'programmable-community-journeys-v1');
  assert.equal(result.corpus.qualification, 'PUBLIC_REGRESSION_AND_COMPARISON_CORPUS_NOT_BLIND_HOLDOUT');
  assert.deepEqual(result.counts, {
    cases: 27,
    communityRegressions: 1,
    naturalEnglishGermanPrompts: 20,
    naturalPositives: 13,
    adjacentNegatives: 7,
    malformed: 2,
    missingTool: 1,
    authorityDenied: 2,
    adversarial: 1,
  });
  assert.match(result.corpusSha256, /^[0-9a-f]{64}$/u);
  const mizu = result.corpus.cases.find(({ id }) => id === 'mizu-design-then-implement');
  assert.equal(mizu.messages.length, 2);
  assert.equal(mizu.expected.activation, 'ACTIVATED');
  assert.equal(mizu.expected.outcome, 'MATERIALIZED_REPOSITORY');
  assert.ok(mizu.expected.forbiddenBehaviors.includes('implementation-refusal-because-custom-profile'));
});

test('corpus validation rejects count drift and any sealed-holdout reference', () => {
  const corpusPath = path.join(REPOSITORY_ROOT, CORPUS_RELATIVE_PATH);
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const countDrift = structuredClone(corpus);
  countDrift.counts.naturalPositives -= 1;
  assert.throws(
    () => validateCorpusDocument(countDrift),
    (error) => error instanceof JourneyBenchmarkError && error.code === 'SCHEMA_INVALID' && /does not match/u.test(error.message),
  );
  const sealedReference = structuredClone(corpus);
  sealedReference.cases[0].rubric += ' Inspect evals/holdout/manifest.json.';
  assert.throws(
    () => validateCorpusDocument(sealedReference),
    (error) => error instanceof JourneyBenchmarkError && error.code === 'SEALED_CORPUS_BOUNDARY',
  );
});

test('existing encrypted holdout bytes remain at the pre-benchmark identities', () => {
  const expected = {
    'evals/holdout/bundles/foundations.json': '40029271ed4f5a2503809a7b60a15bd37e99765dd7841ab13c49ae2b28a2f808',
    'evals/holdout/bundles/novelty.json': 'f6ff3738013966bdc9df5e4698b4c32bad2328a5f1cf4dbfcfbc664c3a56489c',
    'evals/holdout/bundles/repairs.json': '6fa64a6919c32015d03b43f75c4f109a1bf218d0789df939530f8bcdd64cd048',
    'evals/holdout/bundles/systems.json': '86badcdfd647b92f0af14f542845c8594fe83fbf2997af2da58206a0ad3345e8',
    'evals/holdout/manifest.json': '34e6007adc0db40ecf8ab80004c075fdbed9f19076df1373edd99b3ef434a666',
  };
  for (const [relativePath, expectedSha256] of Object.entries(expected)) {
    const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha256, relativePath);
  }
});

test('validate-only and missing-provider modes make no provider or release claim', () => {
  const validate = spawnSync(process.execPath, [RUNNER, '--validate-only'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(validate.stderr, '');
  const validation = JSON.parse(validate.stdout);
  assert.equal(validation.status, 'JOURNEY_BENCHMARK_CORPUS_VALID');
  assert.equal(validation.caseCount, 27);
  assert.equal(validation.providerExecution, 'not-run');
  assert.equal(validation.releaseGateSatisfied, false);

  const blocked = spawnSync(process.execPath, [RUNNER, '--require-provider'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  assert.equal(blocked.status, 3, blocked.stderr);
  const payload = JSON.parse(blocked.stdout);
  assert.equal(payload.status, 'JOURNEY_BENCHMARK_EXTERNAL_BLOCKED');
  assert.deepEqual(payload.missing, ['--config', '--output', '--allow-adapters']);
  assert.equal(payload.providerExecution, 'not-run');
  assert.equal(payload.releaseGateSatisfied, false);
});

test('fake adapters exercise the complete comparison path without becoming model evidence', async (t) => {
  const root = temporaryDirectory(t);
  const configPath = path.join(root, 'config.json');
  const outputPath = path.join(root, 'result-bundle');
  writeJson(configPath, fakeConfig());
  const result = await runJourneyBenchmark({ configPath, outputPath, repositoryRoot: REPOSITORY_ROOT });
  assert.equal(result.scorecard.status, 'BENCHMARK_COMPLETED');
  assert.equal(result.scorecard.evidenceQualification, 'LOCAL_FAKE_ADAPTER_REGRESSION_ONLY');
  assert.equal(result.scorecard.releaseGateSatisfied, false);
  assert.equal(result.scorecard.runPlan.plannedRuns, 54);
  assert.equal(result.scorecard.runs.length, 54);
  assert.ok(result.scorecard.runs.every(({ harnessStatus }) => harnessStatus === 'COMPLETED'));
  assert.ok(result.scorecard.runs.every(({ gates }) => Object.values(gates).every(Boolean)));
  assert.ok(result.scorecard.subjects.every(({ skill }) => skill.unchanged));
  assert.equal(result.scorecard.comparisons.length, 1);
  assert.equal(result.scorecard.comparisons[0].comparedSubjectId, 'v0-10-candidate');
  assert.deepEqual(result.scorecard.comparisons[0].medianDeltas, {
    totalTokens: 0,
    toolCalls: 0,
    retries: 0,
    elapsedMs: 0,
    timeToUsefulMs: 0,
  });
  const mizu = result.scorecard.runs.find(({ caseId, subjectId }) => caseId === 'mizu-design-then-implement' && subjectId === 'v0-10-candidate');
  assert.equal(mizu.subject.result.outcome, 'MATERIALIZED_REPOSITORY');
  assert.equal(mizu.subject.activation.turns.length, 2);
  const missingTool = result.scorecard.runs.find(({ caseId }) => caseId === 'missing-foundry-tool');
  assert.equal(missingTool.subject.result.outcome, 'MATERIALIZED_UNVERIFIED_REPOSITORY');
  const denied = result.scorecard.runs.find(({ caseId }) => caseId === 'deploy-authority-denied');
  assert.deepEqual(denied.subject.effects.externalWrites, []);
  assert.deepEqual(denied.subject.effects.authorityRequests, ['explicit-mainnet-transaction-authority']);
  const candidateRunsRoot = path.join(outputPath, 'runs/v0-10-candidate');
  const rawSubjectRequestPath = fs.readdirSync(candidateRunsRoot)
    .map((opaqueCaseId) => path.join(candidateRunsRoot, opaqueCaseId, '1/subject-request.json'))
    .find((requestPath) => JSON.parse(fs.readFileSync(requestPath, 'utf8')).messages.length === 2);
  assert.ok(rawSubjectRequestPath);
  const rawSubjectRequest = JSON.parse(fs.readFileSync(rawSubjectRequestPath, 'utf8'));
  assert.match(rawSubjectRequest.caseId, /^case-[0-9a-f]{24}$/u);
  for (const forbiddenKey of ['expected', 'expectedActivation', 'rubric', 'requiredBehaviors', 'forbiddenBehaviors', 'outcome']) {
    assert.equal(Object.hasOwn(rawSubjectRequest, forbiddenKey), false, `subject request leaked ${forbiddenKey}`);
  }
  assert.equal(fs.existsSync(result.scorecardPath), true);
  assert.match(result.scorecardSha256, /^[0-9a-f]{64}$/u);
});

test('configuration requires an independent judge model and explicit absolute adapter binaries', () => {
  const sameJudge = fakeConfig({
    judge: {
      adapterArgv: [process.execPath, FAKE_ADAPTER],
      host: { name: 'fake-judge-host', version: '1', provider: 'local-fixture', model: 'fake-subject-model' },
    },
  });
  assert.throws(
    () => validateBenchmarkConfig(sameJudge),
    (error) => error instanceof JourneyBenchmarkError && /judge model must differ/u.test(error.message),
  );
  const relativeAdapter = fakeConfig();
  relativeAdapter.subjects[0].adapterArgv[0] = 'node';
  assert.throws(
    () => validateBenchmarkConfig(relativeAdapter),
    (error) => error instanceof JourneyBenchmarkError && /absolute executable path/u.test(error.message),
  );
});

test('inventories are deterministic and reject symlinked result evidence', (t) => {
  const root = temporaryDirectory(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha\n');
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'b.txt'), 'beta\n');
  assert.deepEqual(inventoryDirectory(root), inventoryDirectory(root));
  fs.symlinkSync('../a.txt', path.join(root, 'nested', 'alias.txt'));
  assert.throws(
    () => inventoryDirectory(root),
    (error) => error instanceof JourneyBenchmarkError && error.code === 'INVENTORY_SYMLINK',
  );
});

test('benchmark refuses in-repository or pre-existing output paths before adapter execution', async (t) => {
  const root = temporaryDirectory(t);
  const configPath = path.join(root, 'config.json');
  writeJson(configPath, fakeConfig());
  await assert.rejects(
    () => runJourneyBenchmark({
      configPath,
      outputPath: path.join(REPOSITORY_ROOT, 'forbidden-benchmark-output'),
      repositoryRoot: REPOSITORY_ROOT,
    }),
    (error) => error instanceof JourneyBenchmarkError && error.code === 'OUTPUT_INVALID',
  );
  const existing = path.join(root, 'existing');
  fs.mkdirSync(existing);
  await assert.rejects(
    () => runJourneyBenchmark({ configPath, outputPath: existing, repositoryRoot: REPOSITORY_ROOT }),
    (error) => error instanceof JourneyBenchmarkError && /must not already exist/u.test(error.message),
  );
});
