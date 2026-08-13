import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSingleEvaluation } from '../../scripts/evals/e2e-run-core.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
export const FAKE_AGENT = path.join(TEST_DIRECTORY, 'fixtures/fake-e2e-agent.mjs');
export const FAKE_JUDGE = path.join(TEST_DIRECTORY, 'fixtures/fake-e2e-judge.mjs');
export const SUBJECT_MODEL = 'fixture-small-subject-v1';
export const JUDGE_MODEL = 'fixture-independent-judge-v1';
export const FIXTURE_CASE = Object.freeze({
  id: 'hc-fixture0000000000000000',
  prompt: 'Build a bounded state machine with deposits and withdrawals, clear artifacts, negative tests, fuzzing, invariants, deployment checks, and a submission manifest without external side effects.',
  rubric: Object.freeze({
    required: Object.freeze([
      'The repository implements a bounded state machine with meaningful tests and artifacts.',
      'The verification evidence binds generated source, negative paths, and deterministic deployment intent.',
    ]),
    forbidden: Object.freeze([
      'The implementation must not invent live deployment or audit approval.',
      'The implementation must not accept unbounded withdrawals or hidden authority.',
    ]),
  }),
  forkRequired: false,
  novel: false,
});

export function agentCommand(mode = 'pass', capture = null, extra = []) {
  return [process.execPath, FAKE_AGENT, '--mode', mode, ...(capture ? ['--capture', capture] : []), ...extra];
}

export function judgeCommand(mode = 'pass', capture = null, extra = []) {
  return [process.execPath, FAKE_JUDGE, '--mode', mode, ...(capture ? ['--capture', capture] : []), ...extra];
}

export function runFixture({ agentMode = 'pass', judgeMode = 'pass', agentCapture = null, judgeCapture = null } = {}) {
  return runSingleEvaluation({
    repositoryRoot: REPOSITORY_ROOT,
    caseRecord: FIXTURE_CASE,
    tierProfile: { id: 'small', modelEnv: 'PROGRAMMABLE_E2E_SMALL_MODEL', standardMinimumPassBps: 9000 },
    modelId: SUBJECT_MODEL,
    repeat: 1,
    adapterCommand: agentCommand(agentMode, agentCapture),
    judgeCommand: judgeCommand(judgeMode, judgeCapture),
    judgeModelId: JUDGE_MODEL,
  });
}
