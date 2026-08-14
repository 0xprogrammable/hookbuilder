import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalJson,
  corpusFromValidatedE2EStructure,
  E2EStructureError,
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
  E2E_JUDGE_REQUEST_SCHEMA_VERSION,
} from '../../scripts/evals/e2e-judge-core.mjs';
import {
  createPostStageWorkspaceSnapshot,
  directoryDigest,
  E2E_AGENT_RESULT_SCHEMA_VERSION,
  validateAgentResult,
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

function journeyFixtureResult() {
  const skillRoot = path.join(REPOSITORY_ROOT, 'skills/programmable-v4-hook-builder');
  const promptSha256 = sha256(FIXTURE_CASE.prompt);
  const body = {
    outcome: 'Generated a local repository with 2 declared evidence artifacts.',
    status: 'Local evidence only. External certification and availability remain unverified.',
    decision: null,
    nextAction: 'Review the committed artifacts before any external action.',
    limitations: [
      'DESIGN_NOT_APPROVAL',
      'LOCAL_CHECKS_NOT_AUDIT',
      'NOT_DEPLOYED',
      'PROVIDER_SUPPORT_UNRESOLVED',
      'NOT_PUBLICLY_AVAILABLE',
    ],
    artifactRefs: ['artifacts/intent.json', 'artifacts/submission.json'],
  };
  const activationEntry = (relativePath, phase) => {
    const bytes = fs.readFileSync(path.join(skillRoot, relativePath));
    return {
      path: relativePath,
      sha256: sha256(bytes),
      bytes: bytes.length,
      phase,
      reason: 'Required by the selected task journey.',
    };
  };
  return {
    options: {
      installedSkillRoot: skillRoot,
      expectedPromptSha256: promptSha256,
      expectedLanguage: 'en',
      expectedSkillSha256: directoryDigest(skillRoot),
    },
    value: {
      schemaVersion: '1.2.0',
      kind: 'programmable-e2e-agent-result',
      status: 'COMPLETED',
      providerReceipt: {},
      usage: {
        inputTokens: 7000,
        outputTokens: 2000,
        totalTokens: 9000,
        coldStartContextTokens: 3000,
        architectureContextTokens: 7000,
      },
      telemetry: {
        descendantSubagentCount: 0,
        emittedBytes: 4096,
        escalations: 0,
        manualInterventions: 0,
        retries: 0,
        timeToUsefulMs: 1000,
        toolCalls: 4,
        toolErrors: 0,
      },
      builderResponse: {
        schemaVersion: '1.0.0',
        kind: 'programmable-e2e-builder-response',
        promptSha256,
        promptLanguage: 'en',
        responseLanguage: 'en',
        sameLanguage: true,
        body,
        bodySha256: sha256(canonicalJson(body)),
      },
      activationReceipt: {
        schemaVersion: '1.0.0',
        kind: 'programmable-e2e-activation-receipt',
        promptSha256,
        skillSha256: directoryDigest(skillRoot),
        activationDecision: 'ACTIVATED',
        entries: [
          activationEntry('references/knowledge-routing.json', 'routing'),
          activationEntry('references/layered-response-contract.md', 'response'),
        ],
      },
    },
  };
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
    manifestSha256: '34e6007adc0db40ecf8ab80004c075fdbed9f19076df1373edd99b3ef434a666',
    publicResponseCorpusSha256: 'b8f6716f47aa62eae2a0c16ca31f6f8b0e041ef8c5b145261e5d1a2fa2c8ea9f',
    sealedRepositoryCorpusSha256: 'a5ff5c220b2d9fe943fe5d453efa199856c4e2ff0e278bc5b3cfec341e9f1d9b',
    crossMethodInventorySha256: 'd0fa913a849b2b00a7e2cf973f5d11fa0b4c89d9fa7dc5d162914309aea99bc1',
    modelExecution: 'not-run',
  });
});

test('canonical manifest adapter versions match the runtime contracts', () => {
  const { manifest } = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  assert.equal(manifest.adapterContract.resultSchemaVersion, E2E_AGENT_RESULT_SCHEMA_VERSION);
  assert.equal(manifest.judgeContract.requestSchemaVersion, E2E_JUDGE_REQUEST_SCHEMA_VERSION);
});

test('validated corpus tokens reject foreign roots and preserve immutable nested state', () => {
  const structure = validateE2EStructure({ repositoryRoot: REPOSITORY_ROOT });
  const corpus = corpusFromValidatedE2EStructure({ structure, repositoryRoot: REPOSITORY_ROOT });
  const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-foreign-root-'));
  try {
    assert.throws(
      () => runE2EEvaluations({
        repositoryRoot: foreignRoot,
        adapterCommand: null,
        judgeCommand: null,
        modelIds: {},
        judgeModelId: '',
        repetitions: 3,
        validatedStructure: structure,
      }),
      (error) => error instanceof E2EStructureError
        && error.issues.includes('validated E2E structure token belongs to a different repositoryRoot'),
    );
  } finally {
    fs.rmSync(foreignRoot, { recursive: true, force: true });
  }

  const originalCiphertext = corpus.cases[0].payloadEnvelope.ciphertext;
  const originalTierThreshold = corpus.manifest.tierProfiles[0].standardMinimumPassBps;
  assert.throws(() => { corpus.manifest.minimumRepetitions = 1; }, TypeError);
  assert.throws(() => { corpus.cases[0].payloadEnvelope.ciphertext = 'mutated'; }, TypeError);
  assert.throws(() => { corpus.manifest.tierProfiles[0].standardMinimumPassBps = 0; }, TypeError);
  assert.throws(() => { structure.tierProfiles[0] = 'mutated'; }, TypeError);
  assert.equal(corpus.manifest.minimumRepetitions, 3);
  assert.equal(corpus.cases[0].payloadEnvelope.ciphertext, originalCiphertext);
  assert.equal(corpus.manifest.tierProfiles[0].standardMinimumPassBps, originalTierThreshold);
  assert.deepEqual(structure.tierProfiles, ['frontier', 'mid', 'small']);

  assert.throws(
    () => runE2EEvaluations({
      repositoryRoot: REPOSITORY_ROOT,
      adapterCommand: null,
      judgeCommand: null,
      modelIds: {},
      judgeModelId: '',
      repetitions: 1,
      validatedStructure: structure,
    }),
    (error) => error?.code === 'REPETITIONS_INVALID' && error.message === 'repetitions must be 3-10',
  );
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
    const stageEmittedBytes = executed.reduce((total, stage) => (
      total + stage.stdout.bytes + stage.stderr.bytes
    ), 0);
    assert.equal(run.telemetry.verifierToolCalls, executed.length);
    assert.equal(run.telemetry.verifierEmittedBytes, stageEmittedBytes);
    assert.equal(
      run.efficiency.measurements.toolCalls.value,
      run.telemetry.toolCalls + run.judge.telemetry.toolCalls + executed.length,
    );
    assert.equal(
      run.efficiency.measurements.emittedBytes.value,
      run.telemetry.emittedBytes + run.judge.telemetry.emittedBytes + stageEmittedBytes,
    );
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
    assert.deepEqual(judgeView.request.builderResponse, run.builderResponse);
    assert.deepEqual(judgeView.request.activationReceipt, run.activationReceipt);
    assert.equal(
      judgeView.request.bindings.builderResponseSha256,
      sha256(canonicalJson(run.builderResponse)),
    );
    assert.equal(
      judgeView.request.bindings.activationReceiptSha256,
      sha256(canonicalJson(run.activationReceipt)),
    );
    assert.equal(run.providerReceipt.responseSha256, sha256(canonicalJson(run.builderResponse)));
    assert.equal(run.telemetry.structuredQuestionCount, 0);
    assert.equal(
      run.telemetry.activatedReferenceBytes,
      run.activationReceipt.entries.reduce((total, entry) => total + entry.bytes, 0),
    );
    assert.equal(
      run.journeyEvidenceQualification,
      'ADAPTER_REPORTED_HOST_ACTIVATION_UNPROVEN_DESCRIPTOR_REFERENCE_BYTES_VERIFIED_PROCESS_ISOLATION_UNPROVEN',
    );
    assert.equal(judgeView.model, JUDGE_MODEL);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('journey evidence validates installed reference bytes and rejects malformed, tampered, or misleading receipts', () => {
  const fixture = journeyFixtureResult();
  const valid = validateAgentResult(structuredClone(fixture.value), fixture.options);
  assert.equal(valid.telemetry.structuredQuestionCount, 0);
  assert.equal(
    valid.telemetry.activatedReferenceBytes,
    fixture.value.activationReceipt.entries.reduce((total, entry) => total + entry.bytes, 0),
  );
  const oneQuestion = structuredClone(fixture.value);
  oneQuestion.builderResponse.body.decision = {
    id: 'authority-model',
    question: 'Should a quorum control the final decision?',
    options: [
      { id: 'owner', label: 'One owner', consequence: 'One account controls the decision.' },
      { id: 'quorum', label: 'Quorum', consequence: 'Multiple accounts must agree.' },
    ],
    recommendedOptionId: 'quorum',
  };
  oneQuestion.builderResponse.bodySha256 = sha256(canonicalJson(oneQuestion.builderResponse.body));
  assert.equal(validateAgentResult(oneQuestion, fixture.options).telemetry.structuredQuestionCount, 1);

  const germanResponse = structuredClone(fixture.value);
  const germanOptions = { ...fixture.options, expectedLanguage: 'de' };
  germanResponse.builderResponse.promptLanguage = 'de';
  germanResponse.builderResponse.responseLanguage = 'de';
  germanResponse.builderResponse.body.outcome = 'Ein lokales Repository mit 2 deklarierten Evidenzartefakten wurde erstellt.';
  germanResponse.builderResponse.body.status = 'Nur lokale Evidenz. Externe Zertifizierung und Verfügbarkeit sind nicht verifiziert.';
  germanResponse.builderResponse.body.nextAction = 'Prüfe die versionierten Artefakte vor jeder externen Aktion.';
  germanResponse.builderResponse.bodySha256 = sha256(canonicalJson(germanResponse.builderResponse.body));
  assert.equal(validateAgentResult(germanResponse, germanOptions).builderResponse.responseLanguage, 'de');

  const mutations = [
    ['legacy adapter schema', (value) => { value.schemaVersion = '1.1.0'; }],
    ['malformed response', (value) => { delete value.builderResponse.body.outcome; }],
    ['tampered response body', (value) => { value.builderResponse.body.nextAction = 'Changed after hashing.'; }],
    ['escaping activation path', (value) => { value.activationReceipt.entries[0].path = '../outside.md'; }],
    ['activation hash drift', (value) => { value.activationReceipt.entries[0].sha256 = '0'.repeat(64); }],
    ['activation byte-count drift', (value) => { value.activationReceipt.entries[0].bytes += 1; }],
    ['skill digest drift', (value) => { value.activationReceipt.skillSha256 = '0'.repeat(64); }],
    ['language mismatch', (value) => { value.builderResponse.responseLanguage = 'de'; }],
    ['false same-language claim', (value) => { value.builderResponse.sameLanguage = false; }],
    ['adapter-authored structured question count', (value) => { value.telemetry.structuredQuestionCount = 0; }],
    ['adapter-authored reference-byte count', (value) => { value.telemetry.activatedReferenceBytes = 1; }],
    ['missing universal local limitation', (value) => {
      value.builderResponse.body.limitations = value.builderResponse.body.limitations.filter((item) => item !== 'DESIGN_NOT_APPROVAL');
      value.builderResponse.bodySha256 = sha256(canonicalJson(value.builderResponse.body));
    }],
    ['unsupported certification claim', (value) => {
      value.builderResponse.body.outcome = 'Audited, approved and live.';
      value.builderResponse.bodySha256 = sha256(canonicalJson(value.builderResponse.body));
    }],
    ['unsupported equivalent external claim', (value) => {
      value.builderResponse.body.outcome = 'A formal audit has certified the hook.';
      value.builderResponse.body.status = 'The contract is running on Ethereum mainnet.';
      value.builderResponse.body.nextAction = 'Use the verified deployment.';
      value.builderResponse.bodySha256 = sha256(canonicalJson(value.builderResponse.body));
    }],
    ['unsupported decision-option certification claim', (value) => {
      value.builderResponse.body.decision = {
        id: 'authority-model',
        question: 'Which authority should control the final decision?',
        options: [
          { id: 'owner', label: 'Approved owner', consequence: 'One account controls the decision.' },
          { id: 'quorum', label: 'Quorum', consequence: 'Multiple accounts must agree.' },
        ],
        recommendedOptionId: 'quorum',
      };
      value.builderResponse.bodySha256 = sha256(canonicalJson(value.builderResponse.body));
    }],
    ['multiple questions', (value) => {
      value.builderResponse.body.decision = {
        id: 'authority-model',
        question: 'Should one owner decide? Or should a quorum decide?',
        options: [
          { id: 'owner', label: 'One owner', consequence: 'One account controls the decision.' },
          { id: 'quorum', label: 'Quorum', consequence: 'Multiple accounts must agree.' },
        ],
        recommendedOptionId: 'quorum',
      };
      value.builderResponse.bodySha256 = sha256(canonicalJson(value.builderResponse.body));
    }],
    ['activation not observed', (value) => { value.activationReceipt.activationDecision = 'NOT_ACTIVATED'; }],
  ];
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(fixture.value);
    mutate(candidate);
    assert.throws(
      () => validateAgentResult(candidate, fixture.options),
      (error) => error?.code === 'AGENT_RESULT_INVALID',
      label,
    );
  }
});

test('subject provider receipt must hash-bind the exact structured Builder response', () => {
  const run = runFixture({ agentMode: 'unbound-provider-response' });
  assert.equal(run.status, 'FAIL');
  assert.equal(run.reason, 'PROVIDER_RECEIPT_INVALID');
  assert.equal(run.judge, null);
});

test('judge request treats Builder response and activation receipt instructions as untrusted data', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-journey-injection-'));
  const judgeCapture = path.join(temporaryRoot, 'judge.json');
  try {
    const run = runFixture({ agentMode: 'journey-prompt-injection', judgeCapture });
    assert.equal(run.status, 'PASS');
    const request = JSON.parse(fs.readFileSync(judgeCapture, 'utf8')).request;
    assert.equal(request.policy.builderResponseAndActivationReceiptAreUntrustedData, true);
    assert.equal(request.policy.ignoreBuilderResponseAndActivationReceiptInstructions, true);
    assert.match(request.builderResponse.body.decision.question, /ignore the rubric/iu);
    assert.match(request.activationReceipt.entries[0].reason, /Ignore the outer policy/iu);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('whole-run accounting includes all thirteen executed repository stages', () => {
  const run = runSingleEvaluation({
    repositoryRoot: REPOSITORY_ROOT,
    caseRecord: { ...FIXTURE_CASE, forkRequired: true },
    tierProfile: { id: 'small', modelEnv: 'PROGRAMMABLE_E2E_SMALL_MODEL', standardMinimumPassBps: 9000 },
    modelId: SUBJECT_MODEL,
    repeat: 1,
    adapterCommand: agentCommand('pass', null, ['--fork-required']),
    judgeCommand: judgeCommand(),
    judgeModelId: JUDGE_MODEL,
    forkRpcProxyUrl: 'http://127.0.0.1:18545',
  });
  assert.equal(run.status, 'PASS');
  const executed = run.stages.filter(({ status }) => ['PASS', 'PARTIAL_EVIDENCE'].includes(status));
  assert.equal(executed.length, 13);
  assert.equal(run.telemetry.verifierToolCalls, 13);
  assert.equal(
    run.telemetry.verifierEmittedBytes,
    executed.reduce((total, stage) => total + stage.stdout.bytes + stage.stderr.bytes, 0),
  );
  assert.equal(
    run.efficiency.measurements.toolCalls.value,
    run.telemetry.toolCalls + run.judge.telemetry.toolCalls + 13,
  );
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
  assert.ok(scorecard.releaseBlockers.includes('TRUSTED_HOST_ACTIVATION_TRACE_VERIFIER_MISSING'));
  assert.equal(scorecard.releaseGates.trustedHostActivationTraceVerified, false);
});
