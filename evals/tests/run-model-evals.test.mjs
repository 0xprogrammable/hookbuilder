import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
const RUNNER = path.join(REPOSITORY_ROOT, 'scripts/evals/run-model-evals.mjs');
const require = createRequire(import.meta.url);
const promptWrapper = require('../suites/programmable-v4-hook-builder/prompt-wrapper.cjs');

function runWithoutProvider(extraArguments = []) {
  const environment = { ...process.env };
  delete environment.PROGRAMMABLE_EVAL_SUBJECT_PROVIDER;
  delete environment.PROGRAMMABLE_EVAL_JUDGE_PROVIDER;
  return spawnSync(process.execPath, [RUNNER, '--suite', 'programmable-v4-hook-builder', ...extraArguments], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    encoding: 'utf8',
  });
}

test('missing explicit provider matrix emits an agent-neutral non-green skip with no artifact', () => {
  const result = runWithoutProvider();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'MODEL_EVALS_SKIPPED',
    suiteId: 'programmable-v4-hook-builder',
    reason: 'explicit subject and judge providers are not configured',
    missing: [
      'PROGRAMMABLE_EVAL_SUBJECT_PROVIDER',
      'PROGRAMMABLE_EVAL_JUDGE_PROVIDER',
    ],
    offlineStructure: 'valid',
    modelQuality: 'not-evaluated',
    resultArtifact: null,
    releaseGateSatisfied: false,
  });
});

test('eval path containment accepts harmless ..x names but keeps real parent paths outside', () => {
  assert.equal(promptWrapper.isOutsideRootRelative(path.join('..x-context', 'reference.md')), false);
  assert.equal(promptWrapper.isOutsideRootRelative(path.join('..', 'reference.md')), true);

  const inside = runWithoutProvider([
    '--output',
    path.join(REPOSITORY_ROOT, '..x-eval-results.json'),
  ]);
  assert.equal(inside.status, 2);
  assert.match(JSON.parse(inside.stderr).message, /result output must be outside the repository worktree/);

  const outside = runWithoutProvider([
    '--output',
    path.join(path.dirname(REPOSITORY_ROOT), 'parent-eval-results.json'),
  ]);
  assert.equal(outside.status, 0, outside.stderr);
  assert.equal(JSON.parse(outside.stdout).status, 'MODEL_EVALS_SKIPPED');
});

test('malformed provider IDs fail before Promptfoo or any network call', () => {
  const result = runWithoutProvider([
    '--subject-provider',
    '{{ injected }}',
    '--judge-provider',
    'openai:gpt-5',
  ]);
  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.status, 'MODEL_EVALS_ERROR');
  assert.match(payload.message, /explicit Promptfoo provider ID/);
  assert.equal(result.stdout, '');
});

test('release mode fails when provider-backed model quality was not evaluated', () => {
  const result = runWithoutProvider(['--require-provider']);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'MODEL_EVALS_SKIPPED');
  assert.equal(payload.releaseGateSatisfied, false);
  assert.equal(payload.resultArtifact, null);
});
