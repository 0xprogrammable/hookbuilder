import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CORPUS_DIGEST_RELATIVE_PATH,
  CORPUS_RELATIVE_PATH,
  CORPUS_VERSION_AUTHORITY_RELATIVE_PATH,
  JourneyBenchmarkError,
  PINNED_V1_CORPUS_SHA256,
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
    sandbox: null,
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
  assert.equal(result.corpusSha256, PINNED_V1_CORPUS_SHA256);
  assert.equal(PINNED_V1_CORPUS_SHA256, '81f27c3ad1acd1ea676ba982fe1e08a361e3d05f941a71c5a0e526db6fd7fe3f');
  const authority = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, CORPUS_VERSION_AUTHORITY_RELATIVE_PATH), 'utf8'));
  assert.equal(authority.versions[0].sha256, PINNED_V1_CORPUS_SHA256);
});

test('v1 rejects an in-place corpus edit even when its co-versioned digest is regenerated', (t) => {
  const repositoryRoot = temporaryDirectory(t, 'programmable-corpus-version-test-');
  const sourceVersionRoot = path.dirname(path.join(REPOSITORY_ROOT, CORPUS_RELATIVE_PATH));
  const targetVersionRoot = path.dirname(path.join(repositoryRoot, CORPUS_RELATIVE_PATH));
  fs.mkdirSync(path.dirname(targetVersionRoot), { recursive: true });
  fs.cpSync(sourceVersionRoot, targetVersionRoot, { recursive: true });
  const authorityTarget = path.join(repositoryRoot, CORPUS_VERSION_AUTHORITY_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(authorityTarget), { recursive: true });
  fs.copyFileSync(path.join(REPOSITORY_ROOT, CORPUS_VERSION_AUTHORITY_RELATIVE_PATH), authorityTarget);
  const corpusTarget = path.join(repositoryRoot, CORPUS_RELATIVE_PATH);
  const corpus = JSON.parse(fs.readFileSync(corpusTarget, 'utf8'));
  corpus.cases[0].rubric += ' This in-place edit must require v2.';
  writeJson(corpusTarget, corpus);
  const mutatedDigest = crypto.createHash('sha256').update(fs.readFileSync(corpusTarget)).digest('hex');
  fs.writeFileSync(path.join(repositoryRoot, CORPUS_DIGEST_RELATIVE_PATH), `${mutatedDigest}  corpus.json\n`);
  assert.throws(
    () => loadFrozenCorpus({ repositoryRoot }),
    (error) => error instanceof JourneyBenchmarkError && error.code === 'CORPUS_VERSION_IMMUTABLE',
  );
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
  assert.deepEqual(denied.subject.effects.authorityRequests, []);
  const candidateRunsRoot = path.join(outputPath, 'runs/v0-10-candidate');
  const rawSubjectRequestPaths = fs.readdirSync(candidateRunsRoot)
    .flatMap((opaqueCaseId) => {
      const runRoot = path.join(candidateRunsRoot, opaqueCaseId, '1');
      return fs.readdirSync(runRoot)
        .filter((name) => /^subject-turn-\d+-request\.json$/u.test(name))
        .map((name) => path.join(runRoot, name));
    });
  const mizuRequests = rawSubjectRequestPaths
    .map((requestPath) => JSON.parse(fs.readFileSync(requestPath, 'utf8')))
    .filter((request) => request.turn.count === 2)
    .sort((left, right) => left.turn.index - right.turn.index);
  assert.equal(mizuRequests.length, 2, 'Mizu must execute as two distinct subject invocations');
  assert.equal(mizuRequests[0].history.length, 0);
  assert.equal(mizuRequests[1].history.length, 1);
  assert.match(mizuRequests[1].history[0].assistantResponseSha256, /^[0-9a-f]{64}$/u);
  assert.match(mizuRequests[1].history[0].workspaceInventorySha256, /^[0-9a-f]{64}$/u);
  assert.equal(mizuRequests[1].history[0].assistantResponseSha256, mizu.subject.turns[0].responseSha256);
  assert.equal(mizuRequests[1].history[0].workspaceInventorySha256, mizu.subject.turns[0].workspaceInventorySha256);
  assert.notEqual(mizu.subject.turns[0].workspaceInventorySha256, mizu.subject.turns[1].workspaceInventorySha256);
  assert.notEqual(mizu.subject.turns[0].provider.invocationId, mizu.subject.turns[1].provider.invocationId);
  const rawSubjectRequest = mizuRequests[1];
  assert.match(rawSubjectRequest.caseId, /^case-[0-9a-f]{24}$/u);
  for (const forbiddenKey of ['expected', 'expectedActivation', 'rubric', 'requiredBehaviors', 'forbiddenBehaviors', 'outcome']) {
    assert.equal(Object.hasOwn(rawSubjectRequest, forbiddenKey), false, `subject request leaked ${forbiddenKey}`);
  }
  assert.equal(fs.existsSync(result.scorecardPath), true);
  assert.match(result.scorecardSha256, /^[0-9a-f]{64}$/u);
});

test('existing-repository journeys receive a deterministic non-empty fixture', async (t) => {
  const root = temporaryDirectory(t);
  const configPath = path.join(root, 'config.json');
  const outputPath = path.join(root, 'result-bundle');
  writeJson(configPath, fakeConfig());
  const result = await runJourneyBenchmark({ configPath, outputPath, repositoryRoot: REPOSITORY_ROOT });
  for (const caseId of ['repair-existing-hook-en', 'upgrade-existing-hook-de', 'review-only-de', 'submission-preflight-de']) {
    const run = result.scorecard.runs.find(({ subjectId, caseId: runCaseId }) => subjectId === 'v0-10-candidate' && runCaseId === caseId);
    assert.ok(run.resultInventory.files.some(({ path: filePath }) => filePath === 'src/LegacyDirectionalHook.sol'), caseId);
    assert.ok(run.resultInventory.files.some(({ path: filePath }) => filePath === 'test/LegacyDirectionalHook.t.sol'), caseId);
    assert.equal(run.inputFixture.id, 'existing-hook-repository-v1');
    assert.equal(run.inputFixture.fileCount, 6);
    assert.match(run.inputFixture.inventorySha256, /^[0-9a-f]{64}$/u);
  }
});

test('authority-denied corpus cases state unavailable authority and do not authorize remote execution', () => {
  const { corpus } = loadFrozenCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const deployment = corpus.cases.find(({ id }) => id === 'deploy-authority-denied');
  const github = corpus.cases.find(({ id }) => id === 'github-authority-denied-de');
  assert.match(deployment.messages[0].content, /no signing wallet.*transaction authority/iu);
  assert.match(deployment.messages[0].content, /stop before any signing or broadcast/iu);
  assert.ok(deployment.expected.requiredBehaviors.includes('record-unavailable-transaction-authority'));
  assert.match(github.messages[0].content, /fehlen.*Credentials.*Schreibrechte.*Review.*Maintainer-Freigabe/iu);
  assert.match(github.messages[0].content, /stoppe vor Push, Pull Request oder Merge/iu);
  assert.ok(github.expected.requiredBehaviors.includes('record-unavailable-github-authority'));
});

test('invalid subject status, usefulness, negative references, and turn decisions keep benchmark non-green', async (t) => {
  const root = temporaryDirectory(t);
  for (const mode of ['bad-status-useful', 'negative-loaded-reference', 'turn-inconsistent']) {
    const configPath = path.join(root, `${mode}.json`);
    const outputPath = path.join(root, `${mode}-result`);
    const config = fakeConfig({ environmentAllowlist: ['PROGRAMMABLE_FAKE_BENCHMARK_MODE'] });
    writeJson(configPath, config);
    process.env.PROGRAMMABLE_FAKE_BENCHMARK_MODE = mode;
    try {
      const result = await runJourneyBenchmark({ configPath, outputPath, repositoryRoot: REPOSITORY_ROOT });
      assert.equal(result.scorecard.status, 'BENCHMARK_FAILED', mode);
    } finally {
      delete process.env.PROGRAMMABLE_FAKE_BENCHMARK_MODE;
    }
  }
});

test('--require-provider rejects fake evidence before adapter execution', (t) => {
  const root = temporaryDirectory(t);
  const configPath = path.join(root, 'config.json');
  const outputPath = path.join(root, 'result-bundle');
  writeJson(configPath, fakeConfig());
  const result = spawnSync(process.execPath, [
    RUNNER,
    '--config', configPath,
    '--output', outputPath,
    '--allow-adapters',
    '--require-provider',
  ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 3, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'JOURNEY_BENCHMARK_EXTERNAL_BLOCKED');
  assert.equal(payload.reason, 'provider-backed evidence is required but config evidenceMode is FAKE_ADAPTER_TEST');
  assert.equal(fs.existsSync(outputPath), false);
});

test('provider mode fails before adapters when no trusted sandbox wrapper is configured', async (t) => {
  const root = temporaryDirectory(t);
  const configPath = path.join(root, 'config.json');
  const outputPath = path.join(root, 'result-bundle');
  writeJson(configPath, fakeConfig({ evidenceMode: 'PROVIDER_BACKED_UNVERIFIED' }));
  await assert.rejects(
    () => runJourneyBenchmark({ configPath, outputPath, repositoryRoot: REPOSITORY_ROOT }),
    (error) => error instanceof JourneyBenchmarkError && error.code === 'PROVIDER_SANDBOX_REQUIRED',
  );
  assert.equal(fs.existsSync(outputPath), false);
});

test('judge mutation of subject receipts or workspace fails the run', async (t) => {
  const root = temporaryDirectory(t);
  const configPath = path.join(root, 'config.json');
  const outputPath = path.join(root, 'result-bundle');
  const config = fakeConfig({ environmentAllowlist: ['PROGRAMMABLE_FAKE_BENCHMARK_MODE'] });
  writeJson(configPath, config);
  process.env.PROGRAMMABLE_FAKE_BENCHMARK_MODE = 'judge-mutation';
  try {
    const result = await runJourneyBenchmark({ configPath, outputPath, repositoryRoot: REPOSITORY_ROOT });
    assert.equal(result.scorecard.status, 'BENCHMARK_FAILED');
    assert.ok(result.scorecard.runs.every(({ harnessStatus, error }) => harnessStatus === 'ERROR' && error.code === 'JUDGE_MUTATION'));
  } finally {
    delete process.env.PROGRAMMABLE_FAKE_BENCHMARK_MODE;
  }
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
  for (const inheritedName of ['HOME', 'PATH', 'TMPDIR']) {
    const inheritedEnvironment = fakeConfig({ environmentAllowlist: [inheritedName] });
    assert.throws(
      () => validateBenchmarkConfig(inheritedEnvironment),
      (error) => error instanceof JourneyBenchmarkError && new RegExp(`cannot inherit caller ${inheritedName}`, 'u').test(error.message),
    );
  }
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

test('adapter result parsing rejects symlinked output and request mutation', async (t) => {
  const root = temporaryDirectory(t);
  const maliciousAdapter = path.join(root, 'malicious-adapter.mjs');
  fs.writeFileSync(maliciousAdapter, [
    "import fs from 'node:fs';",
    "import process from 'node:process';",
    "const requestIndex = process.argv.indexOf('--request');",
    "const outputIndex = process.argv.indexOf('--output');",
    "const requestPath = process.argv[requestIndex + 1];",
    "const outputPath = process.argv[outputIndex + 1];",
    "fs.writeFileSync(requestPath, '{}\\n');",
    "fs.symlinkSync(requestPath, outputPath);",
  ].join('\n'));
  const config = fakeConfig();
  config.subjects[0].adapterArgv = [process.execPath, maliciousAdapter];
  const configPath = path.join(root, 'config.json');
  const outputPath = path.join(root, 'result-bundle');
  writeJson(configPath, config);
  const result = await runJourneyBenchmark({ configPath, outputPath, repositoryRoot: REPOSITORY_ROOT });
  assert.equal(result.scorecard.status, 'BENCHMARK_FAILED');
  const maliciousRuns = result.scorecard.runs.filter(({ subjectId }) => subjectId === 'v0-9-1-baseline');
  assert.ok(maliciousRuns.every(({ harnessStatus, error }) => harnessStatus === 'ERROR' && error.code === 'REQUEST_MUTATED'));
  assert.ok(result.scorecard.runs.filter(({ subjectId }) => subjectId === 'v0-10-candidate').every(({ harnessStatus }) => harnessStatus === 'COMPLETED'));
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
