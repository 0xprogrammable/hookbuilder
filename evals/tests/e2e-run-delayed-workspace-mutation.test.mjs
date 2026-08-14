import assert from 'node:assert/strict';
import test from 'node:test';

import { runFixture } from './e2e-run-fixture.mjs';

test('delayed source and contained symlink target mutations cannot establish a pass', () => {
  const delayed = runFixture({ agentMode: 'delayed-stage-mutation', judgeMode: 'wait-for-delayed-mutation' });
  assert.equal(delayed.status, 'FAIL');
  assert.equal(delayed.reason, 'VERIFICATION_MUTATED_SOURCE');

  const symlinkTargetMutation = runFixture({ agentMode: 'delayed-contained-symlink-target-mutation', judgeMode: 'wait-for-delayed-mutation' });
  assert.equal(symlinkTargetMutation.status, 'FAIL');
  assert.equal(symlinkTargetMutation.reason, 'VERIFICATION_POST_STAGE_WORKSPACE_MUTATION');
});
