import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  corpusFromValidatedE2EStructure,
  canonicalJson,
  loadHoldoutCorpus,
  revealHoldoutCase,
  sha256,
  validateRevealedHoldoutCases,
} from './e2e-corpus-core.mjs';
import { E2ERunError } from './e2e-errors.mjs';
import { runIndependentJudge } from './e2e-judge-core.mjs';
import {
  commandIdentity,
  evaluatorSourceIdentity,
  assertNoReservedArguments,
  validateProviderReceipt,
} from './e2e-provenance-core.mjs';
import {
  artifactRecords,
  copyInstalledSkill,
  createFreshVerificationCheckout,
  createFrozenJudgeSnapshot,
  createPostStageWorkspaceSnapshot,
  directoryDigest,
  E2E_AGENT_RESULT_PATH,
  E2E_REPOSITORY_CONTRACT_PATH,
  inventoryRepository,
  logRecord,
  readJson,
  runRepositoryStages,
  safeChildEnvironment,
  safeWorkspaceFile,
  validateAgentResult,
  validateRepositoryContract,
  verifyFreshRevisionUnchanged,
  verifyFrozenJudgeSnapshot,
  verifyPostStageWorkspaceSnapshot,
} from './e2e-repository-core.mjs';
import { spawnIsolated, loadSubjectSandbox } from './e2e-sandbox-core.mjs';
import { evaluateRunEfficiency, externalBlockedScorecard, summarizeRuns } from './e2e-score-core.mjs';

const MAX_ADAPTER_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_ADAPTER_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_REPETITIONS = 10;

export { E2ERunError } from './e2e-errors.mjs';
export { externalBlockedScorecard, summarizeRuns } from './e2e-score-core.mjs';

function stableRunPayload(run) {
  const stableAdapter = run.adapter ? { ...run.adapter } : null;
  if (stableAdapter) delete stableAdapter.durationMs;
  const stableJudge = run.judge ? { ...run.judge } : null;
  if (stableJudge?.adapter) {
    stableJudge.adapter = { ...stableJudge.adapter };
    delete stableJudge.adapter.durationMs;
  }
  return {
    ...run,
    adapter: stableAdapter,
    judge: stableJudge,
    stages: (run.stages ?? []).map(({ durationMs, ...stage }) => stage),
    debugAgentWorkspace: undefined,
    debugRunRoot: undefined,
    debugVerificationWorkspace: undefined,
  };
}

function finalizeRun(run) {
  return { ...run, scorecardSha256: sha256(canonicalJson(stableRunPayload(run))) };
}

export function parseAdapterCommand(value, label = 'adapter') {
  if (typeof value !== 'string' || value.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new E2ERunError('ADAPTER_COMMAND_INVALID', `${label} command must be a JSON string array: ${error.message}`);
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > 16
    || parsed.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 4096 || item.includes('\0'))
  ) throw new E2ERunError('ADAPTER_COMMAND_INVALID', `${label} command must contain 1-16 bounded string arguments`);
  assertNoReservedArguments(parsed, /judge/iu.test(label) ? 'judge' : 'agent');
  return parsed;
}

function revealedCase(caseRecord, holdoutKeyFilePath) {
  if (caseRecord?.payloadEnvelope) {
    try {
      return revealHoldoutCase({ caseRecord, keyFilePath: holdoutKeyFilePath });
    } catch (error) {
      throw new E2ERunError('HOLDOUT_REVEAL_FAILED', error.message);
    }
  }
  if (typeof caseRecord?.prompt !== 'string' || !caseRecord?.rubric) {
    throw new E2ERunError('HOLDOUT_REVEAL_FAILED', 'evaluation case is neither a sealed envelope nor a revealed case');
  }
  return caseRecord;
}

function initialRunRecord({ evalCase, tierProfile, modelId, repeat, suiteBinding, adapter, sandboxReceipt, runStartedAtMs }) {
  return {
    _runStartedAtMs: runStartedAtMs,
    runId: `${evalCase.id}:${tierProfile.id}:${repeat}`,
    caseId: evalCase.id,
    casePromptSha256: sha256(evalCase.prompt),
    rubricSha256: sha256(canonicalJson(evalCase.rubric)),
    tier: tierProfile.id,
    modelId,
    modelSha256: sha256(modelId),
    repeat,
    declaredNovel: evalCase.novel,
    skillSha256: suiteBinding.skillSha256,
    sourceIdentity: suiteBinding.sourceIdentity,
    adapterIdentity: suiteBinding.adapterIdentity,
    judgeAdapterIdentity: suiteBinding.judgeAdapterIdentity,
    adapter,
    sandboxReceipt,
    telemetryProvenance: 'adapter-reported-not-provider-verified',
  };
}

function timedRunPayload(common, value, wallTimeMs = Date.now() - common._runStartedAtMs) {
  const { _runStartedAtMs, ...publicCommon } = common;
  return { ...publicCommon, ...value, wallTimeMs };
}

function terminalRun(common, status, reason, partial = {}) {
  return finalizeRun(timedRunPayload(common, {
    status,
    reason,
    usage: partial.usage ?? null,
    telemetry: partial.telemetry ?? null,
    providerReceipt: partial.providerReceipt ?? null,
    stages: partial.stages ?? [],
    artifacts: partial.artifacts ?? [],
    generatedRevision: partial.generatedRevision ?? null,
    verificationRevision: partial.verificationRevision ?? null,
    repositoryInventory: partial.repositoryInventory ?? null,
    stageEvidenceQualification: partial.stageEvidenceQualification ?? 'NOT_REACHED',
    judge: partial.judge ?? null,
  }));
}

function failedRun(common, reason, partial) {
  return terminalRun(common, 'FAIL', reason, partial);
}

function blockedRun(common, reason, partial) {
  return terminalRun(common, 'EXTERNAL_BLOCKED', reason, partial);
}

function makeTreeDisposable(root) {
  if (!fs.existsSync(root)) return;
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return;
  fs.chmodSync(root, 0o700);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    const child = fs.lstatSync(absolutePath);
    if (child.isDirectory() && !child.isSymbolicLink()) makeTreeDisposable(absolutePath);
    else if (child.isFile()) fs.chmodSync(absolutePath, 0o600);
  }
}

function directSuiteBinding({ repositoryRoot, adapterCommand, judgeCommand, installedSkill }) {
  return Object.freeze({
    skillSha256: directoryDigest(installedSkill),
    sourceIdentity: evaluatorSourceIdentity(repositoryRoot),
    adapterIdentity: commandIdentity(adapterCommand, 'agent'),
    judgeAdapterIdentity: commandIdentity(judgeCommand, 'judge'),
  });
}

export function runSingleEvaluation({
  repositoryRoot,
  caseRecord,
  holdoutKeyFilePath = null,
  tierProfile,
  modelId,
  repeat,
  adapterCommand,
  judgeCommand,
  judgeModelId,
  forkRpcProxyUrl = '',
  adapterTimeoutMs = DEFAULT_ADAPTER_TIMEOUT_MS,
  keepWorkspace = false,
  pinnedSkillRoot = null,
  suiteBinding = null,
  sandbox = null,
}) {
  if (!Array.isArray(adapterCommand) || adapterCommand.length === 0) throw new E2ERunError('ADAPTER_COMMAND_MISSING', 'agent adapter command is required');
  if (!Array.isArray(judgeCommand) || judgeCommand.length === 0) throw new E2ERunError('JUDGE_COMMAND_MISSING', 'independent judge adapter command is required');
  assertNoReservedArguments(adapterCommand, 'agent');
  assertNoReservedArguments(judgeCommand, 'judge');
  if (typeof judgeModelId !== 'string' || judgeModelId.length === 0 || judgeModelId === modelId) {
    throw new E2ERunError('JUDGE_MODEL_INVALID', 'judge model must be configured and independent from the subject model');
  }
  if (!Number.isInteger(repeat) || repeat < 1) throw new E2ERunError('REPEAT_INVALID', 'repeat must be a positive integer');
  const resolvedEfficiencyContract = loadHoldoutCorpus({ repositoryRoot }).manifest.efficiencyContract;
  const runStartedAtMs = Date.now();

  const evalCase = revealedCase(caseRecord, holdoutKeyFilePath);
  if (evalCase.forkRequired && !loopbackRpcProxy(forkRpcProxyUrl)) {
    throw new E2ERunError('FORK_RPC_INVALID', 'fork-required run needs a credential-free loopback RPC proxy');
  }
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-run-'));
  const agentWorkspace = path.join(runRoot, 'agent-workspace');
  const verificationWorkspace = path.join(runRoot, 'verification', 'repository');
  const installedSkill = path.join(runRoot, 'installed', 'programmable-v4-hook-builder');
  const agentHome = path.join(runRoot, 'homes', 'agent');
  const gitHome = path.join(runRoot, 'homes', 'git');
  const verificationHome = path.join(runRoot, 'homes', 'verification');
  const judgeHome = path.join(runRoot, 'homes', 'judge');
  const judgeDirectory = path.join(runRoot, 'sealed-judge');
  const judgeSnapshotRoot = path.join(runRoot, 'judge-snapshot');
  const sandboxControlDirectory = path.join(runRoot, 'sandbox-control');
  fs.mkdirSync(agentWorkspace, { recursive: false, mode: 0o700 });
  let returned;
  try {
    copyInstalledSkill(pinnedSkillRoot ?? path.join(repositoryRoot, 'skills/programmable-v4-hook-builder'), installedSkill);
    const binding = suiteBinding ?? directSuiteBinding({ repositoryRoot, adapterCommand, judgeCommand, installedSkill });
    if (directoryDigest(installedSkill) !== binding.skillSha256) {
      throw new E2ERunError('PINNED_SKILL_DRIFT', 'installed skill differs from the suite-pinned snapshot');
    }
    const [adapterExecutable, ...adapterBaseArgs] = adapterCommand;
    const adapterArgs = [...adapterBaseArgs, '--skill', installedSkill, '--prompt', evalCase.prompt];
    const started = Date.now();
    let execution;
    try {
      execution = spawnIsolated({
        sandbox,
        role: 'subject-generation',
        command: adapterExecutable,
        args: adapterArgs,
        cwd: agentWorkspace,
        env: safeChildEnvironment({
          isolatedHome: agentHome,
          extra: {
            PROGRAMMABLE_E2E_TIER: tierProfile.id,
            PROGRAMMABLE_E2E_MODEL: modelId,
            PROGRAMMABLE_E2E_REPEAT: String(repeat),
          },
        }),
        controlDirectory: sandboxControlDirectory,
        maxBuffer: MAX_ADAPTER_OUTPUT_BYTES,
        timeout: adapterTimeoutMs,
      });
    } catch (error) {
      const common = initialRunRecord({
        evalCase,
        tierProfile,
        modelId,
        repeat,
        suiteBinding: binding,
        adapter: null,
        sandboxReceipt: null,
        runStartedAtMs,
      });
      returned = blockedRun(common, error.code ?? 'subject-sandbox-receipt-invalid');
      return returned;
    }
    const { child, sandboxReceipt } = execution;
    const adapter = {
      exitCode: child.status ?? null,
      signal: child.signal ?? null,
      durationMs: Date.now() - started,
      stdout: logRecord(child.stdout),
      stderr: logRecord(`${child.stderr ?? ''}${child.error ? `\n${child.error.message}` : ''}`),
    };
    const common = initialRunRecord({
      evalCase,
      tierProfile,
      modelId,
      repeat,
      suiteBinding: binding,
      adapter,
      sandboxReceipt,
      runStartedAtMs,
    });
    const agentResultAbsolutePath = path.join(agentWorkspace, E2E_AGENT_RESULT_PATH);
    if (child.error?.code === 'ENOENT' || child.status === 75) {
      returned = blockedRun(common, child.error?.code === 'ENOENT' ? 'agent-adapter-not-found' : 'agent-provider-unavailable');
      return returned;
    }
    if (child.status !== 0 || child.error || child.signal) {
      returned = failedRun(common, 'agent-adapter-failed');
      return returned;
    }
    if (!fs.existsSync(agentResultAbsolutePath)) {
      returned = failedRun(common, 'agent-result-missing');
      return returned;
    }

    let agentResult;
    let providerReceipt;
    let generatedRevision;
    let repositoryInventory;
    let frozenFiles;
    let repositoryContract;
    let artifacts;
    try {
      safeWorkspaceFile(agentWorkspace, E2E_AGENT_RESULT_PATH, 'agent result');
      agentResult = validateAgentResult(readJson(agentResultAbsolutePath, 'agent result'));
      providerReceipt = validateProviderReceipt(agentResult.providerReceipt, {
        role: 'subject',
        modelId,
        inputSha256: common.casePromptSha256,
      });
      generatedRevision = createFreshVerificationCheckout({ agentWorkspace, verificationWorkspace, isolatedHome: gitHome });
      const inventory = inventoryRepository(verificationWorkspace, { forkRequired: evalCase.forkRequired });
      repositoryInventory = inventory.summary;
      frozenFiles = inventory.frozenFiles;
      repositoryContract = validateRepositoryContract(
        readJson(path.join(verificationWorkspace, E2E_REPOSITORY_CONTRACT_PATH), 'repository contract'),
        evalCase,
        { workspace: verificationWorkspace, frozenFiles },
      );
      artifacts = artifactRecords(verificationWorkspace, repositoryContract.artifacts);
    } catch (error) {
      if (!(error instanceof E2ERunError)) throw error;
      const telemetry = agentResult ? { ...agentResult.telemetry, verifierToolErrors: 1 } : null;
      returned = failedRun(common, error.code, {
        usage: agentResult?.usage,
        telemetry,
        providerReceipt,
        generatedRevision,
        repositoryInventory,
        artifacts,
      });
      return returned;
    }

    const stageResult = runRepositoryStages({
      workspace: verificationWorkspace,
      stages: repositoryContract.stages,
      isolatedHome: verificationHome,
      forkRpcProxyUrl,
      generatedRevision,
      frozenFiles,
      sandbox,
      sandboxControlDirectory,
    });
    const telemetry = { ...agentResult.telemetry, verifierToolErrors: stageResult.verifierToolErrors };
    const partial = {
      usage: { ...agentResult.usage },
      telemetry,
      providerReceipt,
      stages: stageResult.stages,
      stageEvidenceQualification: stageResult.stageEvidenceQualification,
      artifacts,
      generatedRevision,
      repositoryInventory,
    };
    if (stageResult.stages.some(({ status }) => status === 'EXTERNAL_BLOCKED')) {
      returned = blockedRun(common, 'required-stage-tool-unavailable', partial);
      return returned;
    }
    if (stageResult.stages.some(({ status }) => status === 'FAIL')) {
      returned = failedRun(common, 'repository-stage-failed', partial);
      return returned;
    }

    let verificationRevision;
    let judgeSnapshot;
    let postStageWorkspaceSnapshot;
    try {
      verificationRevision = verifyFreshRevisionUnchanged({ workspace: verificationWorkspace, generatedRevision, isolatedHome: gitHome });
      postStageWorkspaceSnapshot = createPostStageWorkspaceSnapshot(verificationWorkspace);
      judgeSnapshot = createFrozenJudgeSnapshot({ workspace: verificationWorkspace, target: judgeSnapshotRoot, frozenFiles });
      verificationRevision = {
        ...verificationRevision,
        postStageWorkspaceAtJudgeStart: postStageWorkspaceSnapshot.summary,
      };
      partial.verificationRevision = verificationRevision;
    } catch (error) {
      if (!(error instanceof E2ERunError)) throw error;
      returned = failedRun(common, error.code, partial);
      return returned;
    }

    const judge = runIndependentJudge({
      workspace: judgeSnapshot.root,
      judgeDirectory,
      judgeCommand,
      judgeModelId,
      isolatedHome: judgeHome,
      caseRecord: evalCase,
      bindings: {
        runId: common.runId,
        casePromptSha256: common.casePromptSha256,
        rubricSha256: common.rubricSha256,
        skillSha256: binding.skillSha256,
        repositoryCommit: generatedRevision.commit,
        repositoryTree: generatedRevision.tree,
        judgeSnapshotSha256: judgeSnapshot.sha256,
      },
      artifacts,
      stages: stageResult.stages,
      repositoryInventory,
      evidenceIndex: judgeSnapshot.files,
      sandbox,
      sandboxControlDirectory,
    });
    partial.judge = judge;
    try {
      const snapshotVerification = verifyFrozenJudgeSnapshot(judgeSnapshot);
      const postJudgeRevision = verifyFreshRevisionUnchanged({ workspace: verificationWorkspace, generatedRevision, isolatedHome: gitHome });
      const postStageWorkspaceVerification = verifyPostStageWorkspaceSnapshot(postStageWorkspaceSnapshot);
      partial.verificationRevision = {
        ...verificationRevision,
        postJudgeRevision,
        snapshotVerification,
        postStageWorkspaceVerification,
      };
    } catch (error) {
      if (!(error instanceof E2ERunError)) throw error;
      returned = failedRun(common, error.code, partial);
      return returned;
    }
    if (judge.status === 'EXTERNAL_BLOCKED') {
      returned = blockedRun(common, judge.reason, partial);
      return returned;
    }
    if (judge.executionCompleted !== true || judge.status === 'FAIL') {
      returned = failedRun(common, judge.reason ?? 'sealed-rubric-not-satisfied', partial);
      return returned;
    }

    const assisted = agentResult.telemetry.manualInterventions > 0 || agentResult.telemetry.escalations > 0;
    const wallTimeMs = Date.now() - runStartedAtMs;
    const completed = timedRunPayload(common, {
      usage: { ...agentResult.usage },
      telemetry,
      providerReceipt,
      stages: stageResult.stages,
      stageEvidenceQualification: stageResult.stageEvidenceQualification,
      artifacts,
      generatedRevision,
      verificationRevision: partial.verificationRevision,
      repositoryInventory,
      judge,
    }, wallTimeMs);
    const efficiency = evaluateRunEfficiency(completed, resolvedEfficiencyContract);
    const contextTargetExceeded = [
      efficiency.measurements.coldStartContextTokens,
      efficiency.measurements.architectureContextTokens,
    ].some(({ status }) => status === 'FAIL');
    const efficiencyFailed = efficiency.status === 'FAIL';
    const efficiencyUnmeasured = efficiency.status === 'UNMEASURED';
    returned = finalizeRun({
      ...completed,
      status: efficiencyFailed || efficiencyUnmeasured ? 'FAIL' : assisted ? 'ASSISTED' : 'PASS',
      ...(contextTargetExceeded
        ? { reason: 'standard-context-token-target-exceeded' }
        : efficiencyFailed
          ? { reason: 'efficiency-budget-exceeded' }
          : efficiencyUnmeasured
            ? { reason: 'efficiency-telemetry-unmeasured' }
            : {}),
      efficiency,
    });
    return returned;
  } finally {
    if (keepWorkspace) {
      if (returned) {
        returned.debugRunRoot = runRoot;
        returned.debugAgentWorkspace = agentWorkspace;
        returned.debugVerificationWorkspace = verificationWorkspace;
      }
    } else {
      makeTreeDisposable(runRoot);
      fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
}

function loopbackRpcProxy(value) {
  try {
    const url = new URL(value);
    return ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
      && ['http:', 'https:'].includes(url.protocol)
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

export function runE2EEvaluations({
  repositoryRoot,
  adapterCommand,
  judgeCommand,
  modelIds,
  judgeModelId,
  holdoutKeyFilePath = '',
  sandboxWrapperCommand = null,
  sandboxContractPath = '',
  forkRpcProxyUrl = '',
  caseIds = [],
  tierIds = [],
  repetitions,
  validatedStructure = null,
  baselineRuns = null,
}) {
  const corpus = validatedStructure === null
    ? loadHoldoutCorpus({ repositoryRoot })
    : corpusFromValidatedE2EStructure({ structure: validatedStructure, repositoryRoot });
  if (new Set(caseIds).size !== caseIds.length) throw new E2ERunError('CASE_DUPLICATE', 'selected holdout case ids must be unique');
  if (new Set(tierIds).size !== tierIds.length) throw new E2ERunError('TIER_DUPLICATE', 'selected tier ids must be unique');
  const selectedSealedCases = caseIds.length === 0 ? corpus.cases : caseIds.map((id) => {
    const item = corpus.cases.find((candidate) => candidate.id === id);
    if (!item) throw new E2ERunError('CASE_UNKNOWN', `unknown sealed holdout case ${id}`);
    return item;
  });
  const selectedTiers = tierIds.length === 0 ? corpus.manifest.tierProfiles : tierIds.map((id) => {
    const item = corpus.manifest.tierProfiles.find((candidate) => candidate.id === id);
    if (!item) throw new E2ERunError('TIER_UNKNOWN', `unknown tier ${id}`);
    return item;
  });
  if (!Number.isInteger(repetitions) || repetitions < corpus.manifest.minimumRepetitions || repetitions > MAX_REPETITIONS) {
    throw new E2ERunError('REPETITIONS_INVALID', `repetitions must be ${corpus.manifest.minimumRepetitions}-${MAX_REPETITIONS}`);
  }
  const selection = {
    corpus,
    selectedCaseIds: selectedSealedCases.map(({ id }) => id),
    selectedTierIds: selectedTiers.map(({ id }) => id),
    repetitions,
  };
  const blockers = [];
  if (!adapterCommand) blockers.push('PROGRAMMABLE_E2E_AGENT_ADAPTER_JSON');
  if (!judgeCommand) blockers.push('PROGRAMMABLE_E2E_JUDGE_ADAPTER_JSON');
  if (!judgeModelId) blockers.push(corpus.manifest.judgeContract.independentModelEnv);
  if (!holdoutKeyFilePath) blockers.push('PROGRAMMABLE_E2E_HOLDOUT_KEY_FILE');
  if (!sandboxWrapperCommand) blockers.push('PROGRAMMABLE_E2E_SUBJECT_SANDBOX_WRAPPER');
  if (!sandboxContractPath) blockers.push('PROGRAMMABLE_E2E_SUBJECT_SANDBOX_RECEIPT');
  for (const profile of selectedTiers) if (!modelIds?.[profile.id]) blockers.push(profile.modelEnv);
  const selectedModels = selectedTiers.map((profile) => modelIds?.[profile.id]).filter(Boolean);
  if (selectedTiers.length > 1 && new Set(selectedModels).size !== selectedModels.length) blockers.push('tier-model-ids-must-be-distinct');
  if (judgeModelId && selectedModels.includes(judgeModelId)) blockers.push('judge-model-must-be-independent');
  if (blockers.length > 0) return externalBlockedScorecard({ ...selection, blockers });

  let selectedCases;
  let revealedCoverage;
  try {
    const allRevealedCases = corpus.cases.map((item) => revealHoldoutCase({ caseRecord: item, keyFilePath: holdoutKeyFilePath }));
    revealedCoverage = validateRevealedHoldoutCases({ corpus, cases: allRevealedCases });
    selectedCases = selectedSealedCases.map(({ id }) => allRevealedCases.find((item) => item.id === id));
  } catch (error) {
    throw new E2ERunError('HOLDOUT_REVEAL_FAILED', error.message);
  }
  if (selectedCases.some(({ forkRequired }) => forkRequired) && !loopbackRpcProxy(forkRpcProxyUrl)) {
    return externalBlockedScorecard({ ...selection, blockers: ['PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL'] });
  }
  const sourceIdentity = evaluatorSourceIdentity(repositoryRoot);
  if (!sourceIdentity.clean) return externalBlockedScorecard({ ...selection, blockers: ['EVALUATOR_SOURCE_WORKTREE_DIRTY'] });
  let sandbox;
  try {
    sandbox = loadSubjectSandbox({
      wrapperCommand: sandboxWrapperCommand,
      contractPath: sandboxContractPath,
      repositoryRoot,
      holdoutKeyFilePath,
    });
  } catch (error) {
    return externalBlockedScorecard({ ...selection, blockers: [error.code ?? 'SUBJECT_SANDBOX_INVALID'] });
  }

  const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-suite-'));
  try {
    const pinnedSkillRoot = path.join(suiteRoot, 'pinned-skill');
    copyInstalledSkill(path.join(repositoryRoot, 'skills/programmable-v4-hook-builder'), pinnedSkillRoot);
    const suiteBinding = Object.freeze({
      skillSha256: directoryDigest(pinnedSkillRoot),
      sourceIdentity,
      adapterIdentity: commandIdentity(adapterCommand, 'agent'),
      judgeAdapterIdentity: commandIdentity(judgeCommand, 'judge'),
      revealedCoverage,
      sandboxContractSha256: sandbox.contractSha256,
    });
    const runs = [];
    for (const caseRecord of selectedCases) {
      for (const profile of selectedTiers) {
        for (let repeat = 1; repeat <= repetitions; repeat += 1) {
          runs.push(runSingleEvaluation({
            repositoryRoot,
            caseRecord,
            tierProfile: profile,
            modelId: modelIds[profile.id],
            repeat,
            adapterCommand,
            judgeCommand,
            judgeModelId,
            forkRpcProxyUrl,
            pinnedSkillRoot,
            suiteBinding,
            sandbox,
          }));
        }
      }
    }
    return summarizeRuns({ runs, ...selection, suiteBinding, revealedCoverage, baselineRuns });
  } finally {
    makeTreeDisposable(suiteRoot);
    fs.rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
