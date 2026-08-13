import assert from 'node:assert/strict';
import test from 'node:test';

import { runFixture } from './e2e-run-fixture.mjs';

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
