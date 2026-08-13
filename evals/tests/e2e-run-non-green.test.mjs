import assert from 'node:assert/strict';
import test from 'node:test';

import { runFixture } from './e2e-run-fixture.mjs';

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
