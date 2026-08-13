import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalJson,
  loadHoldoutCorpus,
  sha256,
  validateE2EStructure,
} from '../../scripts/evals/e2e-corpus-core.mjs';
import {
  parseAdapterCommand,
  runE2EEvaluations,
  runSingleEvaluation,
  summarizeRuns,
} from '../../scripts/evals/e2e-run-core.mjs';
import {
  loadSubjectSandbox,
  sandboxReleaseGate,
  spawnIsolated,
} from '../../scripts/evals/e2e-sandbox-core.mjs';
import {
  createPostStageWorkspaceSnapshot,
  verifyPostStageWorkspaceSnapshot,
} from '../../scripts/evals/e2e-repository-core.mjs';
import {
  agentCommand,
  FAKE_AGENT,
  FAKE_JUDGE,
  FIXTURE_CASE,
  JUDGE_MODEL,
  judgeCommand,
  REPOSITORY_ROOT,
  runFixture,
  SUBJECT_MODEL,
} from './e2e-run-fixture.mjs';

let cachedScoringBase;
function scoringBase() {
  cachedScoringBase ??= runFixture();
  return cachedScoringBase;
}

test('keyless validation reports envelope hashes and distinct response/repository populations', () => {
  assert.deepEqual(validateE2EStructure({ repositoryRoot: REPOSITORY_ROOT }), {
    status: 'E2E_ENVELOPES_VALID',
    publicResponseEvalCaseCount: 47,
    sealedRepositoryCaseEnvelopeCount: 24,
    comparableRepositoryPopulationAvailable: false,
    crossMethodRatioClaimed: false,
    payloadValidation: 'requires-external-key-and-trusted-execution',
    minimumRepetitions: 3,
    tierProfiles: ['frontier', 'mid', 'small'],
    manifestSha256: 'fd16f34e34cf911c692e1466e3f1c78ca6fc1fa88fddabb7759a01e8763619ce',
    publicResponseCorpusSha256: '8531f0dc8221b894b77486f8c5663f67d56fb73f0ee707b88bb9af2c286839be',
    sealedRepositoryCorpusSha256: 'a5ff5c220b2d9fe943fe5d453efa199856c4e2ff0e278bc5b3cfec341e9f1d9b',
    crossMethodInventorySha256: 'cc320a4ba6ecb1d269c1821ad94b6d315d8c3bf712256cc032abea479c7b6a8c',
    modelExecution: 'not-run',
  });
});

test('local fixture receives only skill and idea, executes real distinct stages, but is explicitly non-blind', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-leakage-test-'));
  const agentCapture = path.join(temporaryRoot, 'agent.json');
  const judgeCapture = path.join(temporaryRoot, 'judge.json');
  try {
    const run = runFixture({ agentCapture, judgeCapture });
    assert.equal(run.status, 'PASS');
    assert.equal(run.generatedRevision.mode, 'local-git-clone');
    assert.equal(run.verificationRevision.trackedSourceUnchanged, true);
    assert.equal(run.verificationRevision.snapshotVerification.unchanged, true);
    assert.equal(run.sandboxReceipt.trustedExternalAttestation, false);
    assert.equal(run.sandboxReceipt.isolation, 'local-same-uid-unrestricted');
    assert.equal(run.stages.length, 13);
    assert.equal(run.stages.find(({ id }) => id === 'fork').status, 'NOT_APPLICABLE');
    const executed = run.stages.filter(({ status }) => ['PASS', 'PARTIAL_EVIDENCE'].includes(status));
    assert.equal(executed.length, 12);
    assert.ok(executed.every(({ evidence }) => evidence?.sha256 && evidence.subjectCount > 0));
    assert.equal(run.stageEvidenceQualification, 'SEMANTIC_TEST_ADEQUACY_UNPROVEN');
    assert.ok(run.stages
      .filter(({ id }) => ['unit', 'negative', 'fuzz', 'invariant', 'gas', 'code-size', 'deployment', 'submission'].includes(id))
      .every(({ status, evidence }) => status === 'PARTIAL_EVIDENCE' && evidence.semanticTestAdequacy === 'UNPROVEN'));
    assert.equal(new Set(executed.map(({ command }) => JSON.stringify(command))).size, executed.length);

    const agentView = JSON.parse(fs.readFileSync(agentCapture, 'utf8'));
    const serializedAgentView = JSON.stringify(agentView);
    assert.equal(agentView.arguments.filter((value) => value === '--skill').length, 1);
    assert.equal(agentView.arguments.filter((value) => value === '--prompt').length, 1);
    assert.ok(agentView.arguments.includes(FIXTURE_CASE.prompt));
    assert.doesNotMatch(serializedAgentView, /rubric|expected solution|judge-request/iu);
    for (const criterion of [...FIXTURE_CASE.rubric.required, ...FIXTURE_CASE.rubric.forbidden]) {
      assert.ok(!serializedAgentView.includes(criterion));
    }
    assert.deepEqual(Object.keys(agentView.programmableEnvironment).sort(), [
      'PROGRAMMABLE_E2E_MODEL', 'PROGRAMMABLE_E2E_REPEAT', 'PROGRAMMABLE_E2E_TIER',
    ]);

    const judgeView = JSON.parse(fs.readFileSync(judgeCapture, 'utf8'));
    assert.deepEqual(judgeView.request.rubric, FIXTURE_CASE.rubric);
    assert.equal(judgeView.request.bindings.repositoryTree, run.generatedRevision.tree);
    assert.equal(judgeView.model, JUDGE_MODEL);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('0600 and temporary HOME do not make a same-UID local subject blind', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-same-uid-test-'));
  const capture = path.join(temporaryRoot, 'agent.json');
  const probe = path.join(temporaryRoot, 'same-uid-probe');
  try {
    fs.writeFileSync(probe, 'non-secret synthetic probe', { mode: 0o600 });
    fs.chmodSync(probe, 0o600);
    const run = runFixture({ agentMode: 'filesystem-probe', agentCapture: capture });
    assert.equal(run.status, 'PASS');
    assert.equal(JSON.parse(fs.readFileSync(capture, 'utf8')).sameUid0600ProbeReadable, true);
    assert.equal(run.sandboxReceipt.trustedExternalAttestation, false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('self-authored sandbox contracts and receipts cannot forge release isolation', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-forged-sandbox-test-'));
  const syntheticKey = path.join(temporaryRoot, 'synthetic-holdout.key');
  const wrapperPath = path.join(temporaryRoot, 'operator-wrapper.mjs');
  const contractPath = path.join(temporaryRoot, 'operator-contract.json');
  const controlDirectory = path.join(temporaryRoot, 'control');
  try {
    fs.writeFileSync(syntheticKey, Buffer.alloc(32, 7), { mode: 0o600 });
    fs.chmodSync(syntheticKey, 0o600);
    const wrapperSource = `#!/usr/bin/env node
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const requestIndex = process.argv.indexOf('--request');
const requestBytes = fs.readFileSync(process.argv[requestIndex + 1]);
const request = JSON.parse(requestBytes.toString('utf8'));
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const startedAt = new Date().toISOString();
const [command, ...args] = request.command;
const child = childProcess.spawnSync(command, args, {
  cwd: request.cwd,
  encoding: 'utf8',
  env: request.environment,
  shell: false,
});
fs.writeFileSync(request.receiptPath, JSON.stringify({
  schemaVersion: '2.0.0',
  kind: 'programmable-e2e-subject-sandbox-receipt',
  requestSha256: digest(requestBytes),
  role: request.role,
  wrapperSha256: request.sandboxWrapper.executableSha256,
  wrapperCommandSha256: request.sandboxWrapper.commandSha256,
  wrapperFilesSha256: request.sandboxWrapper.filesSha256,
  deniedPathSha256: request.policy.deniedPathSha256,
  isolation: 'separate-uid',
  processTreeReaped: true,
  allowedPathsEnforced: true,
  externalWritesDenied: true,
  networkPolicyEnforced: true,
  invocationId: 'self-authored-wrapper-invocation',
  startedAt,
  completedAt: new Date().toISOString(),
}));
process.stdout.write(child.stdout ?? '');
process.stderr.write(child.stderr ?? '');
process.exit(child.status ?? 1);
`;
    fs.writeFileSync(wrapperPath, wrapperSource, { mode: 0o755 });
    fs.chmodSync(wrapperPath, 0o755);
    const repositoryReal = fs.realpathSync.native(REPOSITORY_ROOT);
    const keyReal = fs.realpathSync.native(syntheticKey);
    const deniedPathSha256 = sha256(canonicalJson([repositoryReal, keyReal].sort()));
    const wrapperCommand = [process.execPath, wrapperPath];
    const wrapperFiles = wrapperCommand.map((file, argumentIndex) => {
      const realPath = fs.realpathSync.native(file);
      const bytes = fs.readFileSync(realPath);
      return { argumentIndex, pathSha256: sha256(realPath), bytes: bytes.length, sha256: sha256(bytes) };
    });
    const finalWrapperSha256 = wrapperFiles[0].sha256;
    fs.writeFileSync(contractPath, `${JSON.stringify({
      schemaVersion: '2.0.0',
      kind: 'programmable-e2e-subject-sandbox-contract',
      trust: 'external-operator-attested',
      isolation: 'separate-uid',
      coverage: ['independent-judge', 'repository-stages', 'subject-generation'],
      deniedPathSha256,
      wrapperSha256: finalWrapperSha256,
      wrapperCommandSha256: sha256(canonicalJson(wrapperCommand)),
      wrapperFilesSha256: sha256(canonicalJson(wrapperFiles)),
      processTree: 'all-descendants-reaped-before-return',
      allowedPaths: 'role-minimal-workspace-and-installed-skill-only',
      externalWrites: 'deny-outside-disposable-workspace',
      network: 'role-scoped-egress-allowlist-no-raw-rpc-secrets',
    }, null, 2)}\n`, { mode: 0o600 });

    const inertInlineProgram = 'void 0';
    assert.throws(() => loadSubjectSandbox({
      wrapperCommand: [process.execPath, '--eval', inertInlineProgram],
      contractPath,
      repositoryRoot: REPOSITORY_ROOT,
      holdoutKeyFilePath: syntheticKey,
    }), (error) => error?.code === 'SUBJECT_SANDBOX_INVALID' && /inline interpreter/u.test(error.message));

    const sandbox = loadSubjectSandbox({
      wrapperCommand,
      contractPath,
      repositoryRoot: REPOSITORY_ROOT,
      holdoutKeyFilePath: syntheticKey,
    });
    const probeSource = `import fs from 'node:fs';
const keyReadable = (() => { try { fs.accessSync(${JSON.stringify(syntheticKey)}, fs.constants.R_OK); return true; } catch { return false; } })();
process.stdout.write(JSON.stringify({ uid: process.getuid?.() ?? null, keyReadable }));`;
    const { child, sandboxReceipt } = spawnIsolated({
      sandbox,
      role: 'subject-generation',
      command: process.execPath,
      args: ['--input-type=module', '--eval', probeSource],
      cwd: temporaryRoot,
      env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' },
      controlDirectory,
      timeout: 30_000,
    });
    assert.equal(child.status, 0);
    assert.equal(JSON.parse(child.stdout).keyReadable, true);
    assert.equal(sandbox.operatorAttested, true);
    assert.equal(sandbox.wrapperFileCount, 2);
    assert.equal(sandbox.cryptographicallyIsolationVerified, false);
    assert.equal(sandbox.trusted, false);
    assert.equal(sandboxReceipt.operatorAttested, true);
    assert.equal(sandboxReceipt.trustedExternalAttestation, false);
    assert.equal(sandboxReceipt.cryptographicallyIsolationVerified, false);
    assert.equal(sandboxReleaseGate([{ sandboxReceipt }]), false);
    fs.appendFileSync(wrapperPath, '\n// delayed wrapper mutation\n');
    assert.throws(() => spawnIsolated({
      sandbox,
      role: 'subject-generation',
      command: process.execPath,
      args: ['--input-type=module', '--eval', probeSource],
      cwd: temporaryRoot,
      env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' },
      controlDirectory,
      timeout: 30_000,
    }), (error) => error?.code === 'SUBJECT_SANDBOX_INVALID' && /argument 1 changed/u.test(error.message));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('post-stage workspace freeze binds contained package-bin targets and rejects directory or escaping links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-transient-symlink-'));
  const workspace = path.join(root, 'workspace');
  const packageDirectory = path.join(workspace, 'node_modules', 'fixture-package');
  const binDirectory = path.join(workspace, 'node_modules', '.bin');
  const packageBinary = path.join(packageDirectory, 'cli.mjs');
  try {
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.mkdirSync(binDirectory, { recursive: true });
    fs.writeFileSync(packageBinary, 'export const cli = true;\n');
    fs.symlinkSync('../fixture-package/cli.mjs', path.join(binDirectory, 'fixture-cli'));
    const snapshot = createPostStageWorkspaceSnapshot(workspace);
    assert.equal(verifyPostStageWorkspaceSnapshot(snapshot).unchanged, true);
    assert.ok(snapshot.records.some(({ path: relativePath, type }) => (
      relativePath === 'node_modules/.bin/fixture-cli' && type === 'symlink-to-regular-file'
    )));

    fs.appendFileSync(packageBinary, 'export const mutation = true;\n');
    assert.throws(() => verifyPostStageWorkspaceSnapshot(snapshot), (error) => error?.code === 'VERIFICATION_POST_STAGE_WORKSPACE_MUTATION');

    const outside = path.join(root, 'outside-cli.mjs');
    fs.writeFileSync(outside, 'export const outside = true;\n');
    fs.symlinkSync(outside, path.join(binDirectory, 'escaping-cli'));
    assert.throws(() => createPostStageWorkspaceSnapshot(workspace), (error) => (
      error?.code === 'VERIFICATION_POST_STAGE_WORKSPACE_INVALID' && /escapes the workspace/u.test(error.message)
    ));

    fs.rmSync(path.join(binDirectory, 'escaping-cli'));
    fs.symlinkSync(packageDirectory, path.join(binDirectory, 'directory-cli'));
    assert.throws(() => createPostStageWorkspaceSnapshot(workspace), (error) => (
      error?.code === 'VERIFICATION_POST_STAGE_WORKSPACE_INVALID' && /regular file/u.test(error.message)
    ));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('one-noop and constant-assertion stage games fail before judge scoring', () => {
  const oneScript = runFixture({ agentMode: 'stage-game' });
  assert.equal(oneScript.status, 'FAIL');
  assert.equal(oneScript.reason, 'REPOSITORY_CONTRACT_INVALID');
  assert.equal(oneScript.judge, null);

  const trivialAssertions = runFixture({ agentMode: 'trivial-stage-game' });
  assert.equal(trivialAssertions.status, 'FAIL');
  assert.equal(trivialAssertions.reason, 'repository-stage-failed');
  assert.ok(trivialAssertions.stages.some(({ status, reason }) => status === 'FAIL' && reason === 'STAGE_EVIDENCE_INVALID'));
  assert.equal(trivialAssertions.judge, null);
});

test('correlated self-comparison tests remain partial evidence and block semantic release claims', () => {
  const correlated = runFixture({ agentMode: 'correlated-stage-game' });
  assert.equal(correlated.status, 'PASS');
  assert.equal(correlated.stageEvidenceQualification, 'SEMANTIC_TEST_ADEQUACY_UNPROVEN');
  for (const id of ['unit', 'fuzz', 'invariant']) {
    const stage = correlated.stages.find((record) => record.id === id);
    assert.equal(stage.status, 'PARTIAL_EVIDENCE');
    assert.equal(stage.evidence.semanticTestAdequacy, 'UNPROVEN');
  }
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const scorecard = summarizeRuns({
    runs: matrixRuns(corpus, correlated),
    corpus,
    selectedCaseIds: corpus.cases.map(({ id }) => id),
    selectedTierIds: ['frontier', 'mid', 'small'],
    repetitions: 3,
  });
  assert.equal(scorecard.releaseGates.semanticTestAdequacyEstablished, false);
  assert.ok(scorecard.releaseBlockers.includes('SEMANTIC_TEST_ADEQUACY_UNPROVEN'));
  assert.equal(scorecard.releaseGates.releaseCandidate, false);
});

test('inline commands and dirty generated repositories fail before scoring', () => {
  const inline = runFixture({ agentMode: 'inline-command' });
  assert.equal(inline.status, 'FAIL');
  assert.equal(inline.reason, 'REPOSITORY_CONTRACT_INVALID');
  assert.equal(inline.judge, null);

  const dirty = runFixture({ agentMode: 'dirty-repository' });
  assert.equal(dirty.status, 'FAIL');
  assert.equal(dirty.reason, 'GENERATED_REVISION_DIRTY');
  assert.equal(dirty.judge, null);
});

test('harness-owned adapter arguments reject first-value prompt/request overrides', () => {
  assert.throws(
    () => parseAdapterCommand(JSON.stringify([process.execPath, FAKE_AGENT, '--prompt', 'easy override'])),
    (error) => error.code === 'ADAPTER_COMMAND_INVALID' && /--prompt/u.test(error.message),
  );
  assert.throws(
    () => parseAdapterCommand(JSON.stringify([process.execPath, FAKE_JUDGE, '--request=override.json']), 'judge adapter'),
    (error) => error.code === 'ADAPTER_COMMAND_INVALID' && /--request/u.test(error.message),
  );
  assert.throws(
    () => runSingleEvaluation({
      repositoryRoot: REPOSITORY_ROOT,
      caseRecord: FIXTURE_CASE,
      tierProfile: { id: 'small' },
      modelId: SUBJECT_MODEL,
      repeat: 1,
      adapterCommand: agentCommand('pass', null, ['--skill=override']),
      judgeCommand: judgeCommand(),
      judgeModelId: JUDGE_MODEL,
    }),
    (error) => error.code === 'ADAPTER_COMMAND_INVALID',
  );
});

test('direct fork execution rejects raw external provider URLs', () => {
  assert.throws(
    () => runSingleEvaluation({
      repositoryRoot: REPOSITORY_ROOT,
      caseRecord: { ...FIXTURE_CASE, forkRequired: true },
      tierProfile: { id: 'small' },
      modelId: SUBJECT_MODEL,
      repeat: 1,
      adapterCommand: agentCommand(),
      judgeCommand: judgeCommand(),
      judgeModelId: JUDGE_MODEL,
      forkRpcProxyUrl: 'https://rpc-provider.example.invalid/project-secret',
    }),
    (error) => error.code === 'FORK_RPC_INVALID' && /loopback RPC proxy/u.test(error.message),
  );
});

function matrixRuns(corpus, base, mutate = () => ({})) {
  const novelIds = new Set(corpus.cases
    .map(({ id }) => id)
    .filter((id) => !corpus.manifest.hardGateCaseIds.includes(id))
    .slice(0, 8));
  const runs = [];
  for (const { id: caseId } of corpus.cases) {
    for (const tier of ['frontier', 'mid', 'small']) {
      for (let repeat = 1; repeat <= 3; repeat += 1) {
        const runId = `${caseId}:${tier}:${repeat}`;
        runs.push({
          ...base,
          runId,
          caseId,
          tier,
          repeat,
          declaredNovel: novelIds.has(caseId),
          status: 'PASS',
          judge: { ...base.judge, status: 'PASS', executionCompleted: true },
          ...mutate({ caseId, tier, repeat, runId, novelIds }),
        });
      }
    }
  }
  return runs;
}

test('207 PASS / 9 valid judge FAIL cannot masquerade as complete judging failure or hidden miss', () => {
  const base = scoringBase();
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const nonHard = corpus.cases.find(({ id }) => !corpus.manifest.hardGateCaseIds.includes(id)).id;
  const runs = matrixRuns(corpus, base, ({ caseId }) => caseId === nonHard
    ? { status: 'FAIL', judge: { ...base.judge, status: 'FAIL', executionCompleted: true } }
    : {});
  const scorecard = summarizeRuns({
    runs,
    corpus,
    selectedCaseIds: corpus.cases.map(({ id }) => id),
    selectedTierIds: ['frontier', 'mid', 'small'],
    repetitions: 3,
  });
  assert.deepEqual(scorecard.outcomes, { PASS: 207, FAIL: 9, ASSISTED: 0, EXTERNAL_BLOCKED: 0 });
  assert.equal(scorecard.releaseGates.allJudgeExecutionsCompleted, true);
  assert.equal(scorecard.releaseGates.allJudgeVerdictsPass, false);
  assert.equal(scorecard.releaseGates.allRunsPassed, false);
  assert.equal(scorecard.releaseGates.releaseCandidate, false);
  assert.equal(scorecard.status, 'EXTERNAL_BLOCKED');
});

test('hard gates require 100 percent while one threshold-eligible miss remains transparent', () => {
  const base = scoringBase();
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const selection = {
    corpus,
    selectedCaseIds: corpus.cases.map(({ id }) => id),
    selectedTierIds: ['frontier', 'mid', 'small'],
    repetitions: 3,
  };
  const hardId = corpus.manifest.hardGateCaseIds[0];
  const hardFailRuns = matrixRuns(corpus, base, ({ caseId, tier, repeat }) => (
    caseId === hardId && tier === 'frontier' && repeat === 1
      ? { status: 'FAIL', judge: { ...base.judge, status: 'FAIL', executionCompleted: true } }
      : {}
  ));
  const hardFail = summarizeRuns({ runs: hardFailRuns, ...selection });
  assert.equal(hardFail.releaseGates.hardGateCasesPassed100Percent, false);
  assert.equal(hardFail.failureClasses.hardGate, 1);
  assert.equal(hardFail.sealedCorpusThresholdOutcome, 'FAIL');

  const nonHardId = corpus.cases.find(({ id }) => !corpus.manifest.hardGateCaseIds.includes(id)).id;
  const thresholdRuns = matrixRuns(corpus, base, ({ caseId, tier, repeat, novelIds }) => (
    caseId === nonHardId && novelIds.has(caseId) && tier === 'frontier' && repeat === 1
      ? { status: 'FAIL', judge: { ...base.judge, status: 'FAIL', executionCompleted: true } }
      : {}
  ));
  const threshold = summarizeRuns({ runs: thresholdRuns, ...selection });
  assert.equal(threshold.releaseGates.hardGateCasesPassed100Percent, true);
  assert.equal(threshold.releaseGates.tierThresholdsSatisfied, true);
  assert.equal(threshold.failureClasses.declaredNovel, 1);
  assert.equal(threshold.sealedCorpusThresholdOutcome, 'PASS');
  assert.equal(threshold.releaseGates.releaseCandidate, false);
});

test('mixed skill, duplicate receipts, mixed models, and duplicate selection fail provenance gates', () => {
  const base = scoringBase();
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const runs = matrixRuns(corpus, base);
  runs[1] = { ...runs[1], skillSha256: '0'.repeat(64) };
  const scorecard = summarizeRuns({
    runs,
    corpus,
    selectedCaseIds: corpus.cases.map(({ id }) => id),
    selectedTierIds: ['frontier', 'mid', 'small'],
    repetitions: 3,
  });
  assert.equal(scorecard.releaseGates.pinnedSuiteIdentity, false);
  assert.ok(scorecard.releaseBlockers.includes('PINNED_EVALUATOR_IDENTITY_INCOMPLETE'));

  const attestedRuns = matrixRuns(corpus, base).map((run, index) => {
    const modelId = `fixture-${run.tier}-model`;
    return {
      ...run,
      modelId,
      providerReceipt: {
        ...run.providerReceipt,
        provenance: 'provider-adapter-attested',
        model: modelId,
        requestId: `provider-request-${index}`,
        invocationId: `provider-subject-invocation-${index}`,
      },
      judge: {
        ...run.judge,
        providerReceipt: {
          ...run.judge.providerReceipt,
          provenance: 'provider-adapter-attested',
          requestId: `judge-request-${index}`,
          invocationId: `provider-judge-invocation-${index}`,
        },
      },
    };
  });
  attestedRuns[1] = {
    ...attestedRuns[1],
    providerReceipt: {
      ...attestedRuns[1].providerReceipt,
      invocationId: attestedRuns[0].providerReceipt.invocationId,
      model: 'wrong-mixed-model',
    },
  };
  const receiptScore = summarizeRuns({
    runs: attestedRuns,
    corpus,
    selectedCaseIds: corpus.cases.map(({ id }) => id),
    selectedTierIds: ['frontier', 'mid', 'small'],
    repetitions: 3,
  });
  assert.equal(receiptScore.releaseGates.providerAttestedFreshInvocations, false);
  assert.equal(receiptScore.releaseGates.providerReceiptsCryptographicallyVerified, false);

  const duplicated = [...corpus.cases.map(({ id }) => id)];
  duplicated[1] = duplicated[0];
  const duplicateSelection = summarizeRuns({
    runs,
    corpus,
    selectedCaseIds: duplicated,
    selectedTierIds: ['frontier', 'mid', 'small'],
    repetitions: 3,
  });
  assert.equal(duplicateSelection.completeSealedRepositoryCorpus, false);
  assert.equal(duplicateSelection.releaseGates.allPlannedRunsCompleted, false);
});

test('metrics expose adapter-reported p50/p95 without promoting filtered evidence', () => {
  const base = scoringBase();
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const totals = [9000, 10000, 20000];
  const runs = totals.map((totalTokens, index) => ({
    ...base,
    repeat: index + 1,
    runId: `${base.caseId}:small:${index + 1}`,
    usage: { ...base.usage, inputTokens: totalTokens - 2000, outputTokens: 2000, totalTokens },
  }));
  const scorecard = summarizeRuns({
    runs,
    corpus,
    selectedCaseIds: [base.caseId],
    selectedTierIds: ['small'],
    repetitions: 3,
  });
  assert.equal(scorecard.status, 'EXTERNAL_BLOCKED');
  assert.equal(scorecard.releaseGates.releaseCandidate, false);
  assert.equal(scorecard.metrics.overall.provenance, 'adapter-and-local-harness-reported-not-provider-verified');
  assert.deepEqual(scorecard.metrics.overall.distributions.generationTotalTokens, { samples: 3, p50: 10000, p95: 20000 });
});

test('missing key, adapters, models, and trusted sandbox are explicit EXTERNAL_BLOCKED gates', () => {
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  const scorecard = runE2EEvaluations({
    repositoryRoot: REPOSITORY_ROOT,
    adapterCommand: null,
    judgeCommand: null,
    modelIds: {},
    judgeModelId: '',
    caseIds: [corpus.cases[0].id],
    tierIds: ['small'],
    repetitions: 3,
  });
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
  assert.ok(scorecard.releaseBlockers.includes('INDEPENDENT_NOVEL_HOLDOUT_MISSING'));
  assert.ok(scorecard.releaseBlockers.includes('PUBLIC_REPOSITORY_E2E_POPULATION_MISSING'));
  assert.ok(scorecard.releaseBlockers.includes('PREVIOUS_RELEASE_BASELINE_MISSING'));
});
