import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson, sha256 } from './e2e-corpus-core.mjs';
import { E2ERunError } from './e2e-errors.mjs';

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const AGENT_RESERVED = new Set([
  '--case', '--case-id', '--model', '--output', '--prompt', '--repository', '--request', '--result',
  '--rubric', '--skill', '--tier', '--repeat',
]);
const JUDGE_RESERVED = new Set([
  '--case', '--case-id', '--model', '--output', '--prompt', '--repository', '--request', '--result',
  '--rubric', '--skill',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function assertNoReservedArguments(command, role) {
  const reserved = role === 'judge' ? JUDGE_RESERVED : AGENT_RESERVED;
  for (const argument of command.slice(1)) {
    const name = argument.split('=', 1)[0];
    if (reserved.has(name)) {
      throw new E2ERunError('ADAPTER_COMMAND_INVALID', `${role} base command cannot predeclare harness-owned argument ${name}`);
    }
  }
}

function resolveExecutable(command) {
  if (path.isAbsolute(command) || command.includes(path.sep)) return path.resolve(command);
  const result = childProcess.spawnSync('which', [command], { encoding: 'utf8', shell: false });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function fileIdentity(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return { pathSha256: sha256(path.resolve(filePath)), sha256: sha256(fs.readFileSync(filePath)), bytes: stat.size };
  } catch {
    return null;
  }
}

export function commandIdentity(command, role) {
  assertNoReservedArguments(command, role);
  const executable = resolveExecutable(command[0]);
  const executableIdentity = executable ? fileIdentity(executable) : null;
  const referencedFiles = command.slice(1).map((argument, index) => {
    const identity = (path.isAbsolute(argument) || argument.includes(path.sep)) ? fileIdentity(argument) : null;
    return identity ? { argumentIndex: index + 1, ...identity } : null;
  }).filter(Boolean);
  return Object.freeze({
    role,
    commandSha256: sha256(canonicalJson(command)),
    executable: executableIdentity,
    referencedFiles,
  });
}

function git(args, repositoryRoot) {
  const result = childProcess.spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new E2ERunError('EVALUATOR_SOURCE_INVALID', `git ${args[0]} failed while binding evaluator source`);
  }
  return result.stdout;
}

export function evaluatorSourceIdentity(repositoryRoot) {
  const commit = git(['rev-parse', '--verify', 'HEAD'], repositoryRoot).trim();
  const tree = git(['rev-parse', '--verify', 'HEAD^{tree}'], repositoryRoot).trim();
  const status = git([
    'status', '--porcelain=v1', '--untracked-files=all', '--',
    'evals', 'scripts/evals', 'skills/programmable-v4-hook-builder',
  ], repositoryRoot);
  return Object.freeze({
    commit,
    tree,
    clean: status.length === 0,
    scopedStatusSha256: sha256(status),
  });
}

function boundedString(value, label, { min = 1, max = 256 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new E2ERunError('PROVIDER_RECEIPT_INVALID', `${label} is invalid`);
  }
  return value;
}

export function validateProviderReceipt(value, { role, modelId, inputSha256 }) {
  if (!exactKeys(value, [
    'completedAt', 'inputSha256', 'invocationId', 'kind', 'model', 'modelRevision', 'provenance',
    'provider', 'requestId', 'responseSha256', 'sampling', 'schemaVersion', 'startedAt',
  ])) throw new E2ERunError('PROVIDER_RECEIPT_INVALID', `${role} provider receipt keys drift`);
  if (
    value.schemaVersion !== '1.0.0'
    || value.kind !== 'programmable-e2e-provider-receipt'
    || !['provider-adapter-attested', 'fixture-non-provider'].includes(value.provenance)
    || value.model !== modelId
    || value.inputSha256 !== inputSha256
    || !HASH_PATTERN.test(value.responseSha256 ?? '')
  ) throw new E2ERunError('PROVIDER_RECEIPT_INVALID', `${role} provider receipt binding drift`);
  for (const key of ['provider', 'model', 'modelRevision', 'requestId', 'invocationId']) boundedString(value[key], `${role}.${key}`);
  if (!exactKeys(value.sampling, ['seed', 'temperature', 'topP'])) {
    throw new E2ERunError('PROVIDER_RECEIPT_INVALID', `${role} provider sampling keys drift`);
  }
  if (
    !(value.sampling.seed === null || Number.isSafeInteger(value.sampling.seed))
    || !(value.sampling.temperature === null || (typeof value.sampling.temperature === 'number' && Number.isFinite(value.sampling.temperature)))
    || !(value.sampling.topP === null || (typeof value.sampling.topP === 'number' && Number.isFinite(value.sampling.topP)))
  ) throw new E2ERunError('PROVIDER_RECEIPT_INVALID', `${role} provider sampling values are invalid`);
  const started = Date.parse(value.startedAt);
  const completed = Date.parse(value.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    throw new E2ERunError('PROVIDER_RECEIPT_INVALID', `${role} provider receipt timestamps are invalid`);
  }
  return Object.freeze({
    ...value,
    sampling: Object.freeze({ ...value.sampling }),
    verification: value.provenance === 'provider-adapter-attested'
      ? 'trusted-adapter-attestation-required'
      : 'fixture-only-not-provider-evidence',
  });
}

export function providerReceiptReleaseGate(runs) {
  const receipts = runs.flatMap((run) => [
    { run, role: 'subject', receipt: run.providerReceipt },
    { run, role: 'judge', receipt: run.judge?.providerReceipt },
  ]);
  const allPresent = receipts.length > 0 && receipts.every(({ receipt }) => receipt?.provenance === 'provider-adapter-attested');
  const identities = receipts.map(({ receipt }) => receipt?.invocationId).filter(Boolean);
  const requests = receipts.map(({ receipt }) => `${receipt?.provider}\0${receipt?.requestId}`).filter((value) => !value.includes('undefined'));
  const modelBound = receipts.every(({ run, role, receipt }) => receipt?.model === (role === 'subject' ? run.modelId : run.judge?.modelId));
  return {
    allPresent,
    uniqueInvocations: allPresent && new Set(identities).size === identities.length,
    uniqueProviderRequests: allPresent && new Set(requests).size === requests.length,
    modelBound,
    adapterAttestationsFresh: allPresent
      && modelBound
      && new Set(identities).size === identities.length
      && new Set(requests).size === requests.length,
    cryptographicallyProviderVerified: false,
    satisfied: false,
  };
}
