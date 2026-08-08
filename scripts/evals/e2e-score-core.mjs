import { canonicalJson, E2E_STAGE_IDS, sha256 } from './e2e-corpus-core.mjs';
import { providerReceiptReleaseGate } from './e2e-provenance-core.mjs';
import { sandboxReleaseGate } from './e2e-sandbox-core.mjs';

const METHODOLOGY_BLOCKERS = Object.freeze([
  'BLIND_OPTIMIZATION_ISOLATION_NOT_PROVEN_FOR_THIS_CORPUS',
  'INDEPENDENT_NOVEL_HOLDOUT_MISSING',
  'PREVIOUS_RELEASE_BASELINE_MISSING',
  'PUBLIC_REPOSITORY_E2E_POPULATION_MISSING',
  'SEMANTIC_TEST_ADEQUACY_UNPROVEN',
  'TRUSTED_PROVIDER_RECEIPT_VERIFIER_MISSING',
  'TRUSTED_SANDBOX_ATTESTATION_VERIFIER_MISSING',
]);

function percentile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(probability * sorted.length) - 1];
}

function metricDistribution(runs, selector) {
  const values = runs.map(selector).filter((value) => Number.isSafeInteger(value) && value >= 0);
  return { samples: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function combinedToolMetric(run, key) {
  const generation = run.telemetry?.[key];
  const judge = run.judge?.telemetry?.[key];
  if (!Number.isSafeInteger(generation) && !Number.isSafeInteger(judge)) return null;
  return (generation ?? 0) + (judge ?? 0);
}

function metricsForRuns(runs) {
  const distributions = {
    generationInputTokens: metricDistribution(runs, (run) => run.usage?.inputTokens),
    generationOutputTokens: metricDistribution(runs, (run) => run.usage?.outputTokens),
    generationTotalTokens: metricDistribution(runs, (run) => run.usage?.totalTokens),
    coldStartContextTokens: metricDistribution(runs, (run) => run.usage?.coldStartContextTokens),
    architectureContextTokens: metricDistribution(runs, (run) => run.usage?.architectureContextTokens),
    judgeInputTokens: metricDistribution(runs, (run) => run.judge?.usage?.inputTokens),
    judgeOutputTokens: metricDistribution(runs, (run) => run.judge?.usage?.outputTokens),
    judgeTotalTokens: metricDistribution(runs, (run) => run.judge?.usage?.totalTokens),
    combinedTotalTokens: metricDistribution(runs, (run) => (
      Number.isSafeInteger(run.usage?.totalTokens) && Number.isSafeInteger(run.judge?.usage?.totalTokens)
        ? run.usage.totalTokens + run.judge.usage.totalTokens
        : null
    )),
    toolCalls: metricDistribution(runs, (run) => combinedToolMetric(run, 'toolCalls')),
    toolErrors: metricDistribution(runs, (run) => (
      run.telemetry
        ? run.telemetry.toolErrors + run.telemetry.verifierToolErrors + (run.judge?.telemetry?.toolErrors ?? 0)
        : null
    )),
    retries: metricDistribution(runs, (run) => combinedToolMetric(run, 'retries')),
    questions: metricDistribution(runs, (run) => run.telemetry?.questions),
    escalations: metricDistribution(runs, (run) => run.telemetry?.escalations),
    manualInterventions: metricDistribution(runs, (run) => run.telemetry?.manualInterventions),
    adapterDurationMs: metricDistribution(runs, (run) => run.adapter?.durationMs),
    judgeDurationMs: metricDistribution(runs, (run) => run.judge?.adapter?.durationMs),
  };
  distributions.stageDurationMs = Object.fromEntries(E2E_STAGE_IDS.map((stageId) => [
    stageId,
    metricDistribution(runs, (run) => run.stages?.find(({ id }) => id === stageId)?.durationMs),
  ]));
  return {
    provenance: 'adapter-and-local-harness-reported-not-provider-verified',
    statisticalQualification: 'repeated-executions-not-independent-samples-unless-provider-receipts-are-externally-verified',
    distributions,
  };
}

function groupedMetrics(runs, keys, selector) {
  return Object.fromEntries(keys.map((key) => [key, metricsForRuns(runs.filter((run) => selector(run) === key))]));
}

function passRateBps(runs) {
  return runs.length === 0 ? 0 : Math.floor((runs.filter(({ status }) => status === 'PASS').length * 10000) / runs.length);
}

function tierScorecards(runs, manifest, selectedTierIds) {
  return selectedTierIds.map((tierId) => {
    const profile = manifest.tierProfiles.find(({ id }) => id === tierId);
    const tierRuns = runs.filter(({ tier }) => tier === tierId);
    const standardRuns = tierRuns.filter(({ declaredNovel }) => !declaredNovel);
    const declaredNovelRuns = tierRuns.filter(({ declaredNovel }) => declaredNovel);
    const standardPassBps = passRateBps(standardRuns);
    const declaredNovelPassBps = passRateBps(declaredNovelRuns);
    return {
      id: tierId,
      runCount: tierRuns.length,
      sealedStandard: {
        runCount: standardRuns.length,
        passBps: standardPassBps,
        minimumPassBps: profile.standardMinimumPassBps,
        satisfied: standardRuns.length > 0 && standardPassBps >= profile.standardMinimumPassBps,
      },
      declaredNovelNotIndependentlyEstablished: {
        runCount: declaredNovelRuns.length,
        passBps: declaredNovelPassBps,
        minimumPassBps: manifest.novelMinimumPassBps,
        thresholdSatisfied: declaredNovelRuns.length > 0 && declaredNovelPassBps >= manifest.novelMinimumPassBps,
        independentNoveltyEstablished: false,
      },
    };
  });
}

function stableRun(run) {
  const { debugAgentWorkspace, debugRunRoot, debugVerificationWorkspace, ...copy } = run;
  return copy;
}

function sameSet(observed, expected) {
  return observed.length === expected.length
    && new Set(observed).size === observed.length
    && expected.every((value) => observed.includes(value));
}

function expectedRunIds(selectedCaseIds, selectedTierIds, repetitions) {
  const ids = new Set();
  for (const caseId of selectedCaseIds) {
    for (const tierId of selectedTierIds) {
      for (let repeat = 1; repeat <= repetitions; repeat += 1) ids.add(`${caseId}:${tierId}:${repeat}`);
    }
  }
  return ids;
}

function exactRunMatrixCompleted(runs, selectedCaseIds, selectedTierIds, repetitions) {
  const expected = expectedRunIds(selectedCaseIds, selectedTierIds, repetitions);
  if (runs.length !== expected.size) return false;
  const observed = new Set();
  for (const run of runs) {
    const derived = `${run.caseId}:${run.tier}:${run.repeat}`;
    if (run.runId !== derived || !expected.has(derived) || observed.has(derived)) return false;
    observed.add(derived);
  }
  return observed.size === expected.size;
}

function uniformBinding(runs, selector) {
  const values = runs.map(selector).filter((value) => value !== undefined && value !== null);
  return values.length === runs.length && new Set(values.map((value) => canonicalJson(value))).size === 1;
}

function failureSummary(runs, hardGateCaseIds) {
  const failures = runs.filter(({ status }) => status !== 'PASS');
  return {
    total: failures.length,
    hardGate: failures.filter(({ caseId }) => hardGateCaseIds.includes(caseId)).length,
    declaredNovel: failures.filter(({ declaredNovel }) => declaredNovel).length,
    sealedStandardThresholdEligible: failures.filter((run) => !run.declaredNovel && !hardGateCaseIds.includes(run.caseId)).length,
    byOutcome: Object.fromEntries(['FAIL', 'ASSISTED', 'EXTERNAL_BLOCKED'].map((status) => [status, failures.filter((run) => run.status === status).length])),
    byTier: Object.fromEntries([...new Set(runs.map(({ tier }) => tier))].sort().map((tier) => [tier, failures.filter((run) => run.tier === tier).length])),
    failedRunIds: failures.map(({ runId }) => runId).sort(),
  };
}

export function summarizeRuns({ runs, corpus, selectedCaseIds, selectedTierIds, repetitions, suiteBinding = null, revealedCoverage = null }) {
  const exactCaseSelection = sameSet(selectedCaseIds, corpus.cases.map(({ id }) => id));
  const exactTierSelection = sameSet(selectedTierIds, corpus.manifest.tierProfiles.map(({ id }) => id));
  const completeSealedRepositoryCorpus = exactCaseSelection
    && exactTierSelection
    && repetitions >= corpus.manifest.minimumRepetitions;
  const allPlannedRunsCompleted = exactRunMatrixCompleted(runs, selectedCaseIds, selectedTierIds, repetitions);
  const tiers = tierScorecards(runs, corpus.manifest, selectedTierIds);
  const tierThresholdsSatisfied = tiers.every(({ sealedStandard, declaredNovelNotIndependentlyEstablished }) => (
    sealedStandard.satisfied && declaredNovelNotIndependentlyEstablished.thresholdSatisfied
  ));
  const hardGateRuns = runs.filter(({ caseId }) => corpus.manifest.hardGateCaseIds.includes(caseId));
  const expectedHardGateRunCount = corpus.manifest.hardGateCaseIds.length * selectedTierIds.length * repetitions;
  const hardGateCasesPassed100Percent = completeSealedRepositoryCorpus
    && hardGateRuns.length === expectedHardGateRunCount
    && hardGateRuns.every(({ status }) => status === 'PASS');
  const allJudgeExecutionsCompleted = allPlannedRunsCompleted
    && runs.length > 0
    && runs.every((run) => run.judge?.executionCompleted === true);
  const allJudgeVerdictsPass = allJudgeExecutionsCompleted && runs.every((run) => run.judge?.status === 'PASS');
  const allRunsPassed = allPlannedRunsCompleted && runs.every(({ status }) => status === 'PASS');
  const tokenTargetsSatisfied = runs.filter(({ declaredNovel }) => !declaredNovel).every((run) => (
    Number.isSafeInteger(run.usage?.coldStartContextTokens)
    && Number.isSafeInteger(run.usage?.architectureContextTokens)
    && run.usage.coldStartContextTokens <= corpus.manifest.efficiencyContract.coldStartContextTargetTokens
    && run.usage.architectureContextTokens <= corpus.manifest.efficiencyContract.standardArchitectureContextTargetTokens
  ));
  const noAssistedOrEscalated = runs.every((run) => (
    run.status !== 'ASSISTED'
    && (run.telemetry?.manualInterventions ?? 0) === 0
    && (run.telemetry?.escalations ?? 0) === 0
  ));
  const pinnedSuiteIdentity = runs.length > 0
    && uniformBinding(runs, (run) => run.skillSha256)
    && uniformBinding(runs, (run) => run.sourceIdentity)
    && uniformBinding(runs, (run) => run.adapterIdentity)
    && uniformBinding(runs, (run) => run.judgeAdapterIdentity)
    && runs.every((run) => run.sourceIdentity?.clean === true)
    && (!suiteBinding || runs.every((run) => run.skillSha256 === suiteBinding.skillSha256));
  const providerReceipts = providerReceiptReleaseGate(runs);
  const trustedSubjectAndStageSandbox = sandboxReleaseGate(runs);
  const failureClasses = failureSummary(runs, corpus.manifest.hardGateCaseIds);
  const executionHasBlockedRun = runs.some((run) => run.status === 'EXTERNAL_BLOCKED' || run.judge?.status === 'EXTERNAL_BLOCKED');
  const sealedCorpusThresholdOutcome = allPlannedRunsCompleted
    && tierThresholdsSatisfied
    && hardGateCasesPassed100Percent
    && allJudgeExecutionsCompleted
    && tokenTargetsSatisfied
    && noAssistedOrEscalated
      ? 'PASS'
      : 'FAIL';
  const releaseBlockers = [...METHODOLOGY_BLOCKERS];
  if (!trustedSubjectAndStageSandbox) releaseBlockers.push('TRUSTED_SUBJECT_AND_STAGE_SANDBOX_MISSING');
  if (!pinnedSuiteIdentity) releaseBlockers.push('PINNED_EVALUATOR_IDENTITY_INCOMPLETE');
  if (!allJudgeExecutionsCompleted) releaseBlockers.push('SEALED_JUDGE_EXECUTION_INCOMPLETE');
  const status = executionHasBlockedRun || releaseBlockers.length > 0 ? 'EXTERNAL_BLOCKED' : sealedCorpusThresholdOutcome;
  const caseIds = [...selectedCaseIds].sort();
  const tierIds = [...selectedTierIds].sort();
  const summary = {
    schemaVersion: '2.0.0',
    kind: 'programmable-sealed-repository-e2e-scorecard',
    status,
    sealedCorpusThresholdOutcome,
    stageEvidenceQualification: 'STRUCTURAL_EXECUTION_ONLY_SEMANTIC_TEST_ADEQUACY_UNPROVEN',
    corpusQualification: 'sealed-after-design-regression-and-adversarial-corpus-not-independent-blind-or-unseen',
    populationBoundary: {
      publicResponseEvalCaseCount: corpus.manifest.devCaseCount,
      sealedRepositoryE2ECaseCount: corpus.cases.length,
      comparablePublicRepositoryE2ECaseCount: 0,
      crossMethodPassRateOrHoldoutFractionClaimed: false,
    },
    completeSealedRepositoryCorpus,
    manifestSha256: corpus.manifestSha256,
    publicResponseCorpusSha256: corpus.publicCorpusSha256,
    sealedRepositoryCorpusSha256: corpus.holdoutCorpusSha256,
    crossMethodCombinedInventorySha256: corpus.combinedCorpusSha256,
    revealedCoverage: revealedCoverage ?? suiteBinding?.revealedCoverage ?? null,
    selectedCaseCount: selectedCaseIds.length,
    selectedTierIds,
    repetitions,
    plannedRunCount: selectedCaseIds.length * selectedTierIds.length * repetitions,
    completedRunCount: runs.length,
    outcomes: Object.fromEntries(['PASS', 'FAIL', 'ASSISTED', 'EXTERNAL_BLOCKED'].map((key) => [key, runs.filter(({ status: outcome }) => outcome === key).length])),
    failureClasses,
    releaseBlockers: [...new Set(releaseBlockers)].sort(),
    releaseGates: {
      completeSealedRepositoryCorpus,
      allPlannedRunsCompleted,
      multipleConfiguredRepetitions: repetitions >= corpus.manifest.minimumRepetitions,
      providerAttestedFreshInvocations: providerReceipts.adapterAttestationsFresh,
      providerReceiptsCryptographicallyVerified: providerReceipts.cryptographicallyProviderVerified,
      tierThresholdsSatisfied,
      hardGateCasesPassed100Percent,
      standardTokenTargetsSatisfied: tokenTargetsSatisfied,
      noAssistedOrEscalatedRuns: noAssistedOrEscalated,
      allJudgeExecutionsCompleted,
      allJudgeVerdictsPass,
      allRunsPassed,
      pinnedSuiteIdentity,
      trustedSubjectAndStageSandbox,
      semanticTestAdequacyEstablished: false,
      independentNovelHoldoutEstablished: false,
      comparablePublicRepositoryPopulationAvailable: false,
      previousReleaseRegressionCompared: false,
      releaseCandidate: false,
    },
    metrics: {
      overall: metricsForRuns(runs),
      byTier: groupedMetrics(runs, tierIds, (run) => run.tier),
      byCase: groupedMetrics(runs, caseIds, (run) => run.caseId),
    },
    tiers,
    runs,
  };
  const digestPayload = { ...summary, runs: summary.runs.map(stableRun) };
  return { ...summary, scorecardSha256: sha256(canonicalJson(digestPayload)) };
}

export function externalBlockedScorecard({ corpus, selectedCaseIds, selectedTierIds, repetitions, blockers }) {
  const releaseBlockers = [...new Set([...METHODOLOGY_BLOCKERS, ...blockers])].sort();
  const value = {
    schemaVersion: '2.0.0',
    kind: 'programmable-sealed-repository-e2e-scorecard',
    status: 'EXTERNAL_BLOCKED',
    sealedCorpusThresholdOutcome: 'NOT_RUN',
    stageEvidenceQualification: 'NOT_RUN_SEMANTIC_TEST_ADEQUACY_UNPROVEN',
    corpusQualification: 'sealed-after-design-regression-and-adversarial-corpus-not-independent-blind-or-unseen',
    populationBoundary: {
      publicResponseEvalCaseCount: corpus.manifest.devCaseCount,
      sealedRepositoryE2ECaseCount: corpus.cases.length,
      comparablePublicRepositoryE2ECaseCount: 0,
      crossMethodPassRateOrHoldoutFractionClaimed: false,
    },
    completeSealedRepositoryCorpus: false,
    manifestSha256: corpus.manifestSha256,
    publicResponseCorpusSha256: corpus.publicCorpusSha256,
    sealedRepositoryCorpusSha256: corpus.holdoutCorpusSha256,
    crossMethodCombinedInventorySha256: corpus.combinedCorpusSha256,
    selectedCaseCount: selectedCaseIds.length,
    selectedTierIds,
    repetitions,
    plannedRunCount: selectedCaseIds.length * selectedTierIds.length * repetitions,
    completedRunCount: 0,
    blockers: [...new Set(blockers)].sort(),
    releaseBlockers,
    outcomes: { PASS: 0, FAIL: 0, ASSISTED: 0, EXTERNAL_BLOCKED: 0 },
    failureClasses: { total: 0, hardGate: 0, declaredNovel: 0, sealedStandardThresholdEligible: 0, byOutcome: {}, byTier: {}, failedRunIds: [] },
    releaseGates: {
      completeSealedRepositoryCorpus: false,
      allPlannedRunsCompleted: false,
      multipleConfiguredRepetitions: repetitions >= corpus.manifest.minimumRepetitions,
      providerAttestedFreshInvocations: false,
      providerReceiptsCryptographicallyVerified: false,
      tierThresholdsSatisfied: false,
      hardGateCasesPassed100Percent: false,
      standardTokenTargetsSatisfied: false,
      noAssistedOrEscalatedRuns: false,
      allJudgeExecutionsCompleted: false,
      allJudgeVerdictsPass: false,
      allRunsPassed: false,
      pinnedSuiteIdentity: false,
      trustedSubjectAndStageSandbox: false,
      semanticTestAdequacyEstablished: false,
      independentNovelHoldoutEstablished: false,
      comparablePublicRepositoryPopulationAvailable: false,
      previousReleaseRegressionCompared: false,
      releaseCandidate: false,
    },
    metrics: null,
    tiers: [],
    runs: [],
  };
  return { ...value, scorecardSha256: sha256(canonicalJson(value)) };
}
