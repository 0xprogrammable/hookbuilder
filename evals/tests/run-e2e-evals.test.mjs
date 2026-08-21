import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
const RUNNER = path.join(REPOSITORY_ROOT, 'scripts/evals/run-e2e-evals.mjs');
const E2E_ENVIRONMENT_KEYS = [
  'PROGRAMMABLE_E2E_AGENT_ADAPTER_JSON',
  'PROGRAMMABLE_E2E_JUDGE_ADAPTER_JSON',
  'PROGRAMMABLE_E2E_FRONTIER_MODEL',
  'PROGRAMMABLE_E2E_MID_MODEL',
  'PROGRAMMABLE_E2E_SMALL_MODEL',
  'PROGRAMMABLE_E2E_JUDGE_MODEL',
  'PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL',
  'PROGRAMMABLE_E2E_HOLDOUT_KEY_FILE',
  'PROGRAMMABLE_E2E_SUBJECT_SANDBOX_RECEIPT',
  'PROGRAMMABLE_E2E_SUBJECT_SANDBOX_WRAPPER',
];

function cleanEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra };
  for (const key of E2E_ENVIRONMENT_KEYS) {
    if (!Object.hasOwn(extra, key)) delete environment[key];
  }
  return environment;
}

function run(arguments_, environment = cleanEnvironment()) {
  return childProcess.spawnSync(process.execPath, [RUNNER, ...arguments_], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    env: environment,
  });
}

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
}

test('validate-only reports deterministic corpus hashes without model execution', () => {
  const result = run(['--validate-only']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'E2E_ENVELOPES_VALID');
  assert.equal(payload.publicResponseEvalCaseCount, 47);
  assert.equal(payload.sealedRepositoryCaseEnvelopeCount, 24);
  assert.equal(payload.comparableRepositoryPopulationAvailable, false);
  assert.equal(payload.crossMethodRatioClaimed, false);
  assert.match(payload.publicResponseCorpusSha256, /^[0-9a-f]{64}$/u);
  assert.match(payload.sealedRepositoryCorpusSha256, /^[0-9a-f]{64}$/u);
  assert.match(payload.crossMethodInventorySha256, /^[0-9a-f]{64}$/u);
  assert.equal(payload.modelExecution, 'not-run');
});

test('eval CLIs execute through a symlinked repository path', () => {
  const temporaryRoot = temporaryDirectory('programmable-eval-cli-alias-test-');
  const repositoryAlias = path.join(temporaryRoot, 'repository-alias');
  try {
    fs.symlinkSync(REPOSITORY_ROOT, repositoryAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const cases = [
      {
        id: 'e2e',
        relativePath: 'scripts/evals/run-e2e-evals.mjs',
        arguments: ['--validate-only'],
      },
      {
        id: 'suite',
        relativePath: 'scripts/evals/validate-evals.mjs',
        arguments: [],
      },
      {
        id: 'forward',
        relativePath: 'scripts/evals/forward-test-core.mjs',
        arguments: [],
      },
      {
        id: 'blind-forward',
        relativePath: 'scripts/evals/run-blind-forward-tests.mjs',
        arguments: [],
      },
    ];
    const observations = cases.map((testCase) => {
      const result = childProcess.spawnSync(
        process.execPath,
        [path.join(repositoryAlias, testCase.relativePath), ...testCase.arguments],
        {
          cwd: REPOSITORY_ROOT,
          encoding: 'utf8',
          env: cleanEnvironment(),
        },
      );
      const stdout = result.stdout === '' ? null : JSON.parse(result.stdout);
      const stderr = result.stderr === '' ? null : JSON.parse(result.stderr);
      return {
        id: testCase.id,
        exitCode: result.status,
        stdoutStatus: stdout?.status ?? null,
        stderrStatus: stderr?.status ?? null,
        stderrCode: stderr?.code ?? null,
      };
    });
    assert.deepEqual(observations, [
      {
        id: 'e2e',
        exitCode: 0,
        stdoutStatus: 'E2E_ENVELOPES_VALID',
        stderrStatus: null,
        stderrCode: null,
      },
      {
        id: 'suite',
        exitCode: 0,
        stdoutStatus: 'EVAL_STRUCTURE_VALID',
        stderrStatus: null,
        stderrCode: null,
      },
      {
        id: 'forward',
        exitCode: 0,
        stdoutStatus: 'FORWARD_TESTS_VALID',
        stderrStatus: null,
        stderrCode: null,
      },
      {
        id: 'blind-forward',
        exitCode: 2,
        stdoutStatus: null,
        stderrStatus: 'BLIND_FORWARD_ERROR',
        stderrCode: 'ARGUMENT_INVALID',
      },
    ]);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('importing the E2E runner does not execute its CLI', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(RUNNER).href)}); process.stdout.write('IMPORTED_ONLY\\n');`,
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      env: cleanEnvironment(),
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'IMPORTED_ONLY\n');
  assert.equal(result.stderr, '');
});

test('missing external execution configuration writes an explicit non-green scorecard', () => {
  const temporaryRoot = temporaryDirectory('programmable-e2e-cli-test-');
  const output = path.join(temporaryRoot, 'scorecard.json');
  try {
    const result = run([
      '--case', 'hc-9e87089c8effb4c449813f66',
      '--tier', 'small',
      '--repetitions', '3',
      '--output', output,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, 'EXTERNAL_BLOCKED');
    assert.equal(summary.releaseGateSatisfied, false);
    assert.equal(summary.resultArtifact, output);
    assert.equal(summary.exhaustiveDiagnosticsArtifact, output);
    assert.ok(summary.primaryDiagnostics.length > 0 && summary.primaryDiagnostics.length <= 3);
    const scorecard = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(scorecard.status, 'EXTERNAL_BLOCKED');
    assert.deepEqual(scorecard.blockers, [
      'PROGRAMMABLE_E2E_AGENT_ADAPTER_JSON',
      'PROGRAMMABLE_E2E_HOLDOUT_KEY_FILE',
      'PROGRAMMABLE_E2E_JUDGE_ADAPTER_JSON',
      'PROGRAMMABLE_E2E_JUDGE_MODEL',
      'PROGRAMMABLE_E2E_SMALL_MODEL',
      'PROGRAMMABLE_E2E_SUBJECT_SANDBOX_RECEIPT',
      'PROGRAMMABLE_E2E_SUBJECT_SANDBOX_WRAPPER',
    ]);
    assert.equal(scorecard.metrics, null);
    assert.equal(scorecard.diagnostics.primaryLimit, 3);
    assert.ok(scorecard.diagnostics.primary.length <= 3);
    assert.equal(scorecard.releaseGates.releaseCandidate, false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('output preflight rejects a symlink ancestor before the subject adapter can run', () => {
  const temporaryRoot = temporaryDirectory('programmable-e2e-cli-preflight-test-');
  const repositoryLink = path.join(temporaryRoot, 'repository-link');
  const adapterScript = path.join(temporaryRoot, 'side-effect-adapter.mjs');
  const marker = path.join(temporaryRoot, 'adapter-ran');
  const escapedName = `preflight-side-effect-${path.basename(temporaryRoot)}.json`;
  const escapedOutput = path.join(repositoryLink, escapedName);
  try {
    fs.symlinkSync(REPOSITORY_ROOT, repositoryLink, 'dir');
    fs.writeFileSync(
      adapterScript,
      "import fs from 'node:fs'; fs.writeFileSync(process.env.E2E_PREFLIGHT_MARKER, 'ran');\n",
      { mode: 0o700 },
    );
    const command = JSON.stringify([process.execPath, adapterScript]);
    const result = run(
      [
        '--case', 'hc-9e87089c8effb4c449813f66',
        '--tier', 'small',
        '--repetitions', '3',
        '--output', escapedOutput,
      ],
      cleanEnvironment({
        E2E_PREFLIGHT_MARKER: marker,
        PROGRAMMABLE_E2E_AGENT_ADAPTER_JSON: command,
        PROGRAMMABLE_E2E_JUDGE_ADAPTER_JSON: command,
        PROGRAMMABLE_E2E_SMALL_MODEL: 'fixture-small',
        PROGRAMMABLE_E2E_JUDGE_MODEL: 'fixture-independent-judge',
      }),
    );
    assert.equal(result.status, 2);
    const error = JSON.parse(result.stderr);
    assert.equal(error.status, 'E2E_HARNESS_ERROR');
    assert.equal(error.code, 'OUTPUT_INVALID');
    assert.match(error.message, /non-symbolic directories/u);
    assert.equal(fs.existsSync(marker), false, 'adapter must not execute before output preflight succeeds');
    assert.equal(fs.existsSync(path.join(REPOSITORY_ROOT, escapedName)), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('unsafe repetition counts fail before reserving an output', () => {
  const temporaryRoot = temporaryDirectory('programmable-e2e-cli-limit-test-');
  const output = path.join(temporaryRoot, 'scorecard.json');
  try {
    const result = run(['--repetitions', '11', '--output', output]);
    assert.equal(result.status, 2);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, 'REPETITIONS_INVALID');
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('oversized planned matrices fail before reserving an output', () => {
  const temporaryRoot = temporaryDirectory('programmable-e2e-cli-matrix-limit-test-');
  const output = path.join(temporaryRoot, 'scorecard.json');
  const arguments_ = [];
  for (let index = 0; index < 73; index += 1) arguments_.push('--case', `synthetic-case-${index}`);
  arguments_.push('--tier', 'small', '--repetitions', '10', '--output', output);
  try {
    const result = run(arguments_);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).code, 'PLANNED_RUNS_INVALID');
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('a run-core validation failure removes the exclusive output reservation', () => {
  const temporaryRoot = temporaryDirectory('programmable-e2e-cli-cleanup-test-');
  const output = path.join(temporaryRoot, 'scorecard.json');
  try {
    const result = run([
      '--case', 'not-a-real-holdout-case',
      '--tier', 'small',
      '--repetitions', '3',
      '--output', output,
    ]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).code, 'CASE_UNKNOWN');
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('release mode fails closed on EXTERNAL_BLOCKED and malformed adapter configuration', () => {
  const blocked = run([
    '--case', 'hc-9e87089c8effb4c449813f66',
    '--tier', 'small',
    '--repetitions', '3',
    '--require-provider',
  ]);
  assert.equal(blocked.status, 3, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).status, 'EXTERNAL_BLOCKED');

  const malformed = run(
    ['--case', 'hc-9e87089c8effb4c449813f66', '--tier', 'small', '--repetitions', '3'],
    cleanEnvironment({ PROGRAMMABLE_E2E_JUDGE_ADAPTER_JSON: '{bad-json' }),
  );
  assert.equal(malformed.status, 2);
  const error = JSON.parse(malformed.stderr);
  assert.equal(error.status, 'E2E_HARNESS_ERROR');
  assert.equal(error.code, 'ADAPTER_COMMAND_INVALID');
});
