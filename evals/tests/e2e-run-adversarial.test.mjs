import assert from 'node:assert/strict';
import test from 'node:test';

import { loadHoldoutCorpus } from '../../scripts/evals/e2e-corpus-core.mjs';
import {
  compareEfficiencyBaseline,
  evaluateRunEfficiency,
  summarizeRuns,
} from '../../scripts/evals/e2e-score-core.mjs';
import { runFixture } from './e2e-run-fixture.mjs';
import { REPOSITORY_ROOT } from './e2e-run-fixture.mjs';

let cachedEfficiencyBase;
function efficiencyBase() {
  cachedEfficiencyBase ??= runFixture();
  return cachedEfficiencyBase;
}

test('agent score claims, judge-created evidence, and judge mutation cannot establish a pass', () => {
  const scoreGame = runFixture({ agentMode: 'score-game' });
  assert.equal(scoreGame.status, 'FAIL');
  assert.equal(scoreGame.reason, 'sealed-rubric-not-satisfied');
  assert.equal(scoreGame.judge.status, 'FAIL');

  const injected = runFixture({ judgeMode: 'inject-untracked' });
  assert.equal(injected.status, 'FAIL');
  assert.ok(['JUDGE_RESULT_INVALID', 'JUDGE_SNAPSHOT_MUTATED'].includes(injected.reason));

  const mutated = runFixture({ judgeMode: 'mutate-snapshot' });
  assert.equal(mutated.status, 'FAIL');
  assert.equal(mutated.reason, 'JUDGE_SNAPSHOT_MUTATED');

  const delayed = runFixture({ agentMode: 'delayed-stage-mutation', judgeMode: 'slow-pass' });
  assert.equal(delayed.status, 'FAIL');
  assert.equal(delayed.reason, 'VERIFICATION_MUTATED_SOURCE');

  for (const mode of ['delayed-out-mutation', 'delayed-dist-mutation', 'delayed-cache-mutation', 'delayed-nested-out-mutation']) {
    const postStageMutation = runFixture({ agentMode: mode, judgeMode: 'slow-pass' });
    assert.equal(postStageMutation.status, 'FAIL');
    // Under process-level concurrency the hostile writer can win just before
    // the stage boundary or just after it. Both observations must fail closed;
    // neither timing is evidence of a valid repository.
    assert.ok([
      'repository-stage-failed',
      'VERIFICATION_POST_STAGE_WORKSPACE_MUTATION',
    ].includes(postStageMutation.reason));
  }

  const symlinkTargetMutation = runFixture({ agentMode: 'delayed-contained-symlink-target-mutation', judgeMode: 'slow-pass' });
  assert.equal(symlinkTargetMutation.status, 'FAIL');
  assert.equal(symlinkTargetMutation.reason, 'VERIFICATION_POST_STAGE_WORKSPACE_MUTATION');
});

test('token excess, assistance, and judge outages stay non-green', () => {
  const overBudget = runFixture({ agentMode: 'over-budget' });
  assert.equal(overBudget.status, 'FAIL');
  assert.equal(overBudget.reason, 'standard-context-token-target-exceeded');

  const assisted = runFixture({ agentMode: 'assisted' });
  assert.equal(assisted.status, 'ASSISTED');
  assert.equal(assisted.telemetry.manualInterventions, 1);

  const blocked = runFixture({ judgeMode: 'external-blocked' });
  assert.equal(blocked.status, 'EXTERNAL_BLOCKED');
  assert.equal(blocked.judge.executionCompleted, false);
});

test('800M output, 900M total, 9M tool calls, and 8M retries cannot pass behind small context claims', () => {
  const abused = runFixture({ agentMode: 'efficiency-abuse' });
  assert.equal(abused.status, 'FAIL');
  assert.equal(abused.reason, 'efficiency-budget-exceeded');
  assert.equal(abused.efficiency.status, 'FAIL');
  assert.equal(abused.efficiency.measurements.totalOutputTokens.status, 'FAIL');
  assert.equal(abused.efficiency.measurements.combinedTokens.status, 'FAIL');
  assert.equal(abused.efficiency.measurements.toolCalls.status, 'FAIL');
  assert.equal(abused.efficiency.measurements.retries.status, 'FAIL');
  assert.equal(abused.efficiency.measurements.coldStartContextTokens.status, 'PASS');
  assert.equal(abused.efficiency.measurements.architectureContextTokens.status, 'PASS');
});

test('every canonical efficiency boundary passes at max and fails at max plus one', () => {
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const contract = corpus.manifest.efficiencyContract;
  const base = efficiencyBase();
  const boundary = structuredClone(base);
  boundary.declaredNovel = false;
  boundary.usage = {
    inputTokens: contract.maxTotalInputTokens - boundary.judge.usage.inputTokens,
    outputTokens: contract.maxTotalOutputTokens - boundary.judge.usage.outputTokens,
    totalTokens: contract.maxCombinedTokens - boundary.judge.usage.totalTokens,
    coldStartContextTokens: contract.coldStartContextTargetTokens,
    architectureContextTokens: contract.standardArchitectureContextTargetTokens,
  };
  boundary.telemetry = {
    ...boundary.telemetry,
    activatedReferenceBytes: contract.maxActivatedReferenceBytes - boundary.judge.telemetry.activatedReferenceBytes,
    descendantSubagentCount: 0,
    emittedBytes: contract.maxEmittedBytes - boundary.judge.telemetry.emittedBytes,
    retries: contract.maxRetries - boundary.judge.telemetry.retries,
    timeToUsefulMs: contract.maxTimeToUsefulMs,
    toolCalls: contract.maxToolCalls - boundary.judge.telemetry.toolCalls,
  };
  boundary.wallTimeMs = contract.maxWallTimeMs;
  assert.equal(boundary.usage.totalTokens, boundary.usage.inputTokens + boundary.usage.outputTokens);
  assert.equal(evaluateRunEfficiency(boundary, contract).status, 'PASS');

  const mutations = [
    ['coldStartContextTokens', (run) => { run.usage.coldStartContextTokens += 1; }],
    ['architectureContextTokens', (run) => { run.usage.architectureContextTokens += 1; }],
    ['totalInputTokens', (run) => { run.usage.inputTokens += 1; run.usage.totalTokens += 1; }],
    ['totalOutputTokens', (run) => { run.usage.outputTokens += 1; run.usage.totalTokens += 1; }],
    ['combinedTokens', (run) => { run.usage.outputTokens += 1; run.usage.totalTokens += 1; }],
    ['toolCalls', (run) => { run.telemetry.toolCalls += 1; }],
    ['retries', (run) => { run.telemetry.retries += 1; }],
    ['emittedBytes', (run) => { run.telemetry.emittedBytes += 1; }],
    ['wallTimeMs', (run) => { run.wallTimeMs += 1; }],
    ['timeToUsefulMs', (run) => { run.telemetry.timeToUsefulMs += 1; }],
    ['activatedReferenceBytes', (run) => { run.telemetry.activatedReferenceBytes += 1; }],
    ['descendantSubagents', (run) => { run.telemetry.descendantSubagentCount += 1; }],
  ];
  for (const [metric, mutate] of mutations) {
    const candidate = structuredClone(boundary);
    mutate(candidate);
    assert.equal(evaluateRunEfficiency(candidate, contract).measurements[metric].status, 'FAIL', metric);
  }
});

test('missing efficiency telemetry is UNMEASURED and cannot support a scorecard claim', () => {
  const invalidAdapterResult = runFixture({ agentMode: 'missing-efficiency-telemetry' });
  assert.equal(invalidAdapterResult.status, 'FAIL');
  assert.equal(invalidAdapterResult.reason, 'AGENT_RESULT_INVALID');

  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const run = structuredClone(efficiencyBase());
  delete run.telemetry.emittedBytes;
  const scorecard = summarizeRuns({
    runs: [run],
    corpus,
    selectedCaseIds: [run.caseId],
    selectedTierIds: [run.tier],
    repetitions: 1,
  });
  assert.equal(scorecard.efficiency.status, 'UNMEASURED');
  assert.equal(scorecard.releaseGates.efficiencyTelemetryMeasured, false);
  assert.equal(scorecard.releaseGates.efficiencyBudgetsSatisfied, false);
  assert.ok(scorecard.releaseBlockers.includes('EFFICIENCY_TELEMETRY_UNMEASURED'));
  assert.ok(scorecard.diagnostics.primary.length <= 3);
});

test('same-identity p50 baseline comparison passes equality and exposes regressions or missing telemetry', () => {
  const baseline = Array.from({ length: 3 }, (_, index) => {
    const run = structuredClone(efficiencyBase());
    run.repeat = index + 1;
    run.runId = `${run.caseId}:${run.tier}:${run.repeat}`;
    return run;
  });
  assert.equal(compareEfficiencyBaseline(structuredClone(baseline), baseline).status, 'PASS');

  const regressed = structuredClone(baseline);
  for (const run of regressed) run.telemetry.toolCalls += 1;
  const comparison = compareEfficiencyBaseline(regressed, baseline);
  assert.equal(comparison.status, 'REGRESSION');
  assert.ok(comparison.regressions.some(({ metric }) => metric === 'toolCalls'));

  const unmeasured = structuredClone(regressed);
  delete unmeasured[0].telemetry.timeToUsefulMs;
  assert.equal(compareEfficiencyBaseline(unmeasured, baseline).status, 'UNMEASURED');
});
