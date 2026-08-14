import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPostStageWorkspaceSnapshot,
  verifyPostStageWorkspaceSnapshot,
} from '../../scripts/evals/e2e-repository-core.mjs';
import { runFixture } from './e2e-run-fixture.mjs';

test('delayed ignored output mutation cannot establish a pass', () => {
  const postStageMutation = runFixture({
    agentMode: 'delayed-out-mutation',
    judgeMode: 'wait-for-delayed-mutation',
  });
  assert.equal(postStageMutation.status, 'FAIL');
  // Under process-level concurrency the hostile writer can win just before
  // the stage boundary or just after it. Both observations must fail closed;
  // neither timing is evidence of a valid repository.
  assert.ok([
    'repository-stage-failed',
    'VERIFICATION_POST_STAGE_WORKSPACE_MUTATION',
  ].includes(postStageMutation.reason));
});

test('post-stage snapshots reject every ignored output directory shape', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-ignored-output-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  try {
    const snapshot = createPostStageWorkspaceSnapshot(workspace);
    for (const relativePath of [
      'out/delayed-output.json',
      'dist/delayed-output.json',
      'cache/delayed-output.json',
      'packages/app/out/delayed-output.json',
    ]) {
      const absolutePath = path.join(workspace, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, '{}\n');
      assert.throws(
        () => verifyPostStageWorkspaceSnapshot(snapshot),
        (error) => error?.code === 'VERIFICATION_POST_STAGE_WORKSPACE_MUTATION',
        relativePath,
      );
      fs.rmSync(path.join(workspace, relativePath.split('/', 1)[0]), { recursive: true, force: true });
      assert.equal(verifyPostStageWorkspaceSnapshot(snapshot).unchanged, true, relativePath);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
