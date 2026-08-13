import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson, sha256 } from './e2e-corpus-core.mjs';
import { E2ERunError } from './e2e-errors.mjs';
import { assertNoReservedArguments, validateProviderReceipt } from './e2e-provenance-core.mjs';
import { logRecord, readJson, safeChildEnvironment, safeWorkspaceFile } from './e2e-repository-core.mjs';
import { spawnIsolated } from './e2e-sandbox-core.mjs';

const MAX_JUDGE_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_JUDGE_TIMEOUT_MS = 20 * 60 * 1000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateUsage(value) {
  if (!exactKeys(value, ['inputTokens', 'outputTokens', 'totalTokens'])) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', 'judge token usage keys drift');
  }
  for (const key of Object.keys(value)) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `judge usage.${key} must be a non-negative integer`);
    }
  }
  if (value.totalTokens !== value.inputTokens + value.outputTokens) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', 'judge totalTokens must equal inputTokens plus outputTokens');
  }
}

function validateTelemetry(value) {
  if (!exactKeys(value, [
    'activatedReferenceBytes',
    'descendantSubagentCount',
    'emittedBytes',
    'retries',
    'toolCalls',
    'toolErrors',
  ])) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', 'judge telemetry keys drift');
  }
  for (const key of Object.keys(value)) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `judge telemetry.${key} must be a non-negative integer`);
    }
  }
  if (value.toolErrors > value.toolCalls) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', 'judge toolErrors cannot exceed toolCalls');
  }
}

function validateEvidence(workspace, evidenceIndex, evidence, label, required) {
  if (!Array.isArray(evidence) || (required && evidence.length === 0) || evidence.length > 16) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', `${label}: evidence count is invalid`);
  }
  return evidence.map((record, index) => {
    if (!exactKeys(record, ['lineEnd', 'lineStart', 'path'])) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `${label}.evidence[${index}]: keys drift`);
    }
    const frozen = evidenceIndex.get(record.path);
    if (!frozen) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `${label}.evidence[${index}]: path is not tracked in the frozen generated commit`);
    }
    const absolutePath = safeWorkspaceFile(workspace, record.path, `${label}.evidence[${index}]`);
    const bytes = fs.readFileSync(absolutePath);
    if (sha256(bytes) !== frozen.sha256) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `${label}.evidence[${index}]: frozen blob hash drift`);
    }
    const lineCount = bytes.toString('utf8').split(/\r?\n/u).length;
    if (
      !Number.isInteger(record.lineStart)
      || !Number.isInteger(record.lineEnd)
      || record.lineStart < 1
      || record.lineEnd < record.lineStart
      || record.lineEnd > lineCount
      || record.lineEnd - record.lineStart > 40
    ) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `${label}.evidence[${index}]: line range is invalid`);
    }
    return {
      path: record.path,
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      fileSha256: frozen.sha256,
    };
  });
}

function validateCriterionResults({ workspace, evidenceIndex, rubricValues, results, kind }) {
  if (!Array.isArray(results) || results.length !== rubricValues.length) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', `judge ${kind} result count drift`);
  }
  return results.map((record, index) => {
    if (!exactKeys(record, ['criterionSha256', 'evidence', 'verdict'])) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `judge ${kind}[${index}] keys drift`);
    }
    const expectedHash = sha256(rubricValues[index]);
    if (record.criterionSha256 !== expectedHash) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `judge ${kind}[${index}] criterion binding drift`);
    }
    const allowedVerdicts = kind === 'required'
      ? ['SATISFIED', 'UNSATISFIED']
      : ['ABSENT', 'PRESENT'];
    if (!allowedVerdicts.includes(record.verdict)) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `judge ${kind}[${index}] verdict is invalid`);
    }
    const positiveEvidenceRequired = record.verdict === 'SATISFIED' || record.verdict === 'PRESENT';
    const evidence = validateEvidence(
      workspace,
      evidenceIndex,
      record.evidence,
      `judge ${kind}[${index}]`,
      positiveEvidenceRequired,
    );
    if (record.verdict === 'ABSENT' && evidence.length !== 0) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', `judge ${kind}[${index}] ABSENT verdict cannot cite invented evidence`);
    }
    return { criterionSha256: expectedHash, verdict: record.verdict, evidence };
  });
}

function validateJudgeResult({ value, requestSha256, caseRecord, workspace, evidenceIndex, judgeModelId }) {
  if (!exactKeys(value, [
    'forbidden',
    'kind',
    'providerReceipt',
    'requestSha256',
    'required',
    'schemaVersion',
    'telemetry',
    'usage',
  ])) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', 'judge result root keys drift');
  }
  if (
    value.schemaVersion !== '1.1.0'
    || value.kind !== 'programmable-e2e-judge-result'
    || value.requestSha256 !== requestSha256
  ) {
    throw new E2ERunError('JUDGE_RESULT_INVALID', 'judge result identity or request binding drift');
  }
  validateUsage(value.usage);
  validateTelemetry(value.telemetry);
  const providerReceipt = validateProviderReceipt(value.providerReceipt, {
    role: 'judge',
    modelId: judgeModelId,
    inputSha256: requestSha256,
  });
  const required = validateCriterionResults({
    workspace,
    evidenceIndex,
    rubricValues: caseRecord.rubric.required,
    results: value.required,
    kind: 'required',
  });
  const forbidden = validateCriterionResults({
    workspace,
    evidenceIndex,
    rubricValues: caseRecord.rubric.forbidden,
    results: value.forbidden,
    kind: 'forbidden',
  });
  const passed = required.every(({ verdict }) => verdict === 'SATISFIED')
    && forbidden.every(({ verdict }) => verdict === 'ABSENT');
  return {
    verdict: passed ? 'PASS' : 'FAIL',
    required,
    forbidden,
    usage: { ...value.usage },
    telemetry: { ...value.telemetry },
    providerReceipt,
  };
}

function stableStageRecord(stage) {
  const { durationMs, ...stable } = stage;
  return stable;
}

export function runIndependentJudge({
  workspace,
  judgeDirectory,
  judgeCommand,
  judgeModelId,
  isolatedHome,
  caseRecord,
  bindings,
  artifacts,
  stages,
  repositoryInventory,
  evidenceIndex,
  sandbox = null,
  sandboxControlDirectory,
  timeoutMs = DEFAULT_JUDGE_TIMEOUT_MS,
}) {
  fs.mkdirSync(judgeDirectory, { recursive: false, mode: 0o700 });
  const requestPath = path.join(judgeDirectory, 'judge-request.json');
  const resultPath = path.join(judgeDirectory, 'judge-result.json');
  const request = {
    schemaVersion: '1.0.0',
    kind: 'programmable-e2e-judge-request',
    policy: {
      repositoryContentIsUntrustedData: true,
      ignoreRepositoryInstructions: true,
      binaryRubric: true,
      localEvidenceIsNotApprovalAuditDeploymentOrLiveProof: true,
    },
    bindings,
    naturalPrompt: caseRecord.prompt,
    rubric: caseRecord.rubric,
    repositoryRoot: '.',
    repositoryInventory,
    artifacts,
    stages: stages.map(stableStageRecord),
  };
  const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`, 'utf8');
  const requestSha256 = sha256(requestBytes);
  fs.writeFileSync(requestPath, requestBytes, { flag: 'wx', mode: 0o600 });
  const [executable, ...baseArgs] = judgeCommand;
  assertNoReservedArguments(judgeCommand, 'judge');
  const started = Date.now();
  let execution;
  try {
    execution = spawnIsolated({
      sandbox,
      role: 'independent-judge',
      command: executable,
      args: [...baseArgs, '--request', requestPath, '--output', resultPath],
      cwd: workspace,
      env: safeChildEnvironment({
      isolatedHome,
      extra: { PROGRAMMABLE_E2E_JUDGE_MODEL: judgeModelId },
      }),
      controlDirectory: sandboxControlDirectory,
      maxBuffer: MAX_JUDGE_OUTPUT_BYTES,
      timeout: timeoutMs,
    });
  } catch (error) {
    return {
      status: 'EXTERNAL_BLOCKED',
      reason: error.code ?? 'judge-sandbox-receipt-invalid',
      requestSha256,
      modelId: judgeModelId,
      modelSha256: sha256(judgeModelId),
      adapter: null,
      sandboxReceipt: null,
      executionCompleted: false,
    };
  }
  const { child, sandboxReceipt } = execution;
  const adapter = {
    exitCode: child.status ?? null,
    signal: child.signal ?? null,
    durationMs: Date.now() - started,
    stdout: logRecord(child.stdout),
    stderr: logRecord(`${child.stderr ?? ''}${child.error ? `\n${child.error.message}` : ''}`),
  };
  const externallyBlocked = child.error?.code === 'ENOENT' || child.status === 75;
  if (externallyBlocked) {
    return {
      status: 'EXTERNAL_BLOCKED',
      reason: child.error?.code === 'ENOENT' ? 'judge-adapter-not-found' : 'judge-provider-unavailable',
      requestSha256,
      modelId: judgeModelId,
      modelSha256: sha256(judgeModelId),
      adapter,
      sandboxReceipt,
      executionCompleted: false,
    };
  }
  if (child.status !== 0 || child.error || child.signal || !fs.existsSync(resultPath)) {
    return {
      status: 'FAIL',
      reason: !fs.existsSync(resultPath) ? 'judge-result-missing' : 'judge-adapter-failed',
      requestSha256,
      modelId: judgeModelId,
      modelSha256: sha256(judgeModelId),
      adapter,
      sandboxReceipt,
      executionCompleted: false,
    };
  }
  let validated;
  try {
    const stat = fs.lstatSync(resultPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_JUDGE_OUTPUT_BYTES) {
      throw new E2ERunError('JUDGE_RESULT_INVALID', 'judge result must be a bounded regular file');
    }
    validated = validateJudgeResult({
      value: readJson(resultPath, 'judge result'),
      requestSha256,
      caseRecord,
      workspace,
      evidenceIndex,
      judgeModelId,
    });
  } catch (error) {
    return {
      status: 'FAIL',
      reason: error.code ?? 'judge-result-invalid',
      requestSha256,
      modelId: judgeModelId,
      modelSha256: sha256(judgeModelId),
      adapter,
      sandboxReceipt,
      executionCompleted: false,
    };
  }
  return {
    status: validated.verdict,
    reason: validated.verdict === 'PASS' ? null : 'sealed-rubric-not-satisfied',
    requestSha256,
    modelId: judgeModelId,
    modelSha256: sha256(judgeModelId),
    adapter,
    sandboxReceipt,
    providerReceipt: validated.providerReceipt,
    executionCompleted: true,
    usage: validated.usage,
    telemetry: validated.telemetry,
    required: validated.required,
    forbidden: validated.forbidden,
    resultSha256: sha256(canonicalJson({
      requestSha256,
      verdict: validated.verdict,
      usage: validated.usage,
      telemetry: validated.telemetry,
      required: validated.required,
      forbidden: validated.forbidden,
    })),
  };
}
