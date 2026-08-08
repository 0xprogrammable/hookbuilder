import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parseBoundedStrictJsonBytes } from '../../skills/programmable-v4-hook-builder/scripts/strict-json-core.mjs';
import { canonicalJson, sha256 } from './e2e-corpus-core.mjs';

const SCHEMA_VERSION = '1.0.0';
const BUNDLE_KIND = 'programmable-release-external-evidence-bundle';
const POLICY_KIND = 'programmable-release-external-evidence-authority-policy';
const STATEMENT_KIND = 'programmable-release-external-evidence-statement';
const SIGNING_DOMAIN = 'programmable.release.external-evidence.statement.v1';
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACTS = 64;
// Trust anchors may be added only by a separately reviewed source change. A
// digest supplied beside a bundle on the command line is never a release
// trust root. No external-evidence policy is independently pinned today.
const INDEPENDENTLY_PINNED_POLICY_SHA256 = new Set();

export const EXTERNAL_EVIDENCE_GATE_IDS = Object.freeze([
  'REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE',
  'TRUSTED_SEPARATE_UID_OR_CONTAINER_SANDBOX',
  'PUBLIC_COMPARABLE_REPOSITORY_E2E_POPULATION',
  'INDEPENDENT_NOVEL_HOLDOUT_AND_PRIOR_RELEASE_COMPARATOR',
  'FORK_RPC_FOR_FORK_DEPENDENT_CASES',
  'INSTALLED_HOST_NATURAL_LANGUAGE_TO_SUBMISSION',
]);

const GATE_REQUIREMENTS = Object.freeze({
  REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE: Object.freeze({
    roles: Object.freeze(['independent-judge-verifier', 'provider-receipt-verifier']),
    artifactKinds: Object.freeze(['independent-judge-scorecard', 'provider-session-receipts']),
  }),
  TRUSTED_SEPARATE_UID_OR_CONTAINER_SANDBOX: Object.freeze({
    roles: Object.freeze(['sandbox-attestation-verifier']),
    artifactKinds: Object.freeze(['sandbox-attestation-receipts']),
  }),
  PUBLIC_COMPARABLE_REPOSITORY_E2E_POPULATION: Object.freeze({
    roles: Object.freeze(['public-comparator-verifier']),
    artifactKinds: Object.freeze(['public-repository-e2e-population']),
  }),
  INDEPENDENT_NOVEL_HOLDOUT_AND_PRIOR_RELEASE_COMPARATOR: Object.freeze({
    roles: Object.freeze(['independent-holdout-verifier', 'prior-release-verifier']),
    artifactKinds: Object.freeze(['independent-holdout-scorecard', 'prior-release-comparator']),
  }),
  FORK_RPC_FOR_FORK_DEPENDENT_CASES: Object.freeze({
    roles: Object.freeze(['fork-execution-verifier']),
    artifactKinds: Object.freeze(['pinned-fork-execution-receipts']),
  }),
  INSTALLED_HOST_NATURAL_LANGUAGE_TO_SUBMISSION: Object.freeze({
    roles: Object.freeze(['host-behavior-verifier']),
    artifactKinds: Object.freeze(['installed-host-behavior-receipts']),
  }),
});

export class ExternalEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExternalEvidenceError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ExternalEvidenceError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isObject(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label} keys drift`);
  }
}

function boundedString(value, label, { minimum = 1, maximum = 4096, pattern = null } = {}) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || (pattern && !pattern.test(value))) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label} is invalid`);
  }
  return value;
}

function positiveInteger(value, label, { minimum = 1 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label} is invalid`);
  return value;
}

function trueValue(value, label) {
  if (value !== true) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${label} must be true`);
}

function exactValue(value, expected, label) {
  if (value !== expected) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${label} must equal ${expected}`);
}

function sortedUniqueStrings(value, label, { minimum = 1 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label} must be a non-empty string array`);
  }
  const sorted = [...value].sort();
  if (new Set(value).size !== value.length || canonicalJson(value) !== canonicalJson(sorted)) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label} must be sorted and unique`);
  }
  return value;
}

function validateSourceBinding(value, expected, label) {
  exactKeys(value, ['commit', 'skillTree', 'tree'], label);
  for (const key of ['commit', 'tree', 'skillTree']) {
    boundedString(value[key], `${label}.${key}`, { pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u });
    if (expected && value[key] !== expected[key]) fail('EXTERNAL_EVIDENCE_SOURCE_MISMATCH', `${label}.${key} does not match the candidate`);
  }
  return Object.freeze({ commit: value.commit, tree: value.tree, skillTree: value.skillTree });
}

function parseTimestamp(value, label) {
  boundedString(value, label, { maximum: 64 });
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function digest(value) {
  return `sha256:${sha256(value)}`;
}

function validateDigest(value, label) {
  return boundedString(value, label, { pattern: /^sha256:[0-9a-f]{64}$/u, maximum: 71 });
}

function outsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function containedBy(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function readStableRegularFile(filePath, label, maximumBytes) {
  let before;
  try {
    before = fs.lstatSync(filePath);
  } catch (error) {
    fail('EXTERNAL_EVIDENCE_FILE_INVALID', `${label} is unavailable: ${error.message}`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximumBytes) {
    fail('EXTERNAL_EVIDENCE_FILE_INVALID', `${label} must be a bounded regular non-symbolic file`);
  }
  const realPath = fs.realpathSync.native(filePath);
  const bytes = fs.readFileSync(realPath);
  const after = fs.lstatSync(realPath);
  if (
    bytes.length !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino
    || after.mtimeMs !== before.mtimeMs
  ) fail('EXTERNAL_EVIDENCE_FILE_INVALID', `${label} changed while it was being read`);
  return { bytes, realPath, stat: after };
}

function safeArtifactPath(root, relativePath, label) {
  boundedString(relativePath, `${label}.path`, { maximum: 240 });
  if (
    path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0')
    || relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) fail('EXTERNAL_EVIDENCE_FILE_INVALID', `${label}.path must be a safe relative path`);
  const absolutePath = path.join(root, ...relativePath.split('/'));
  let cursor = root;
  for (const component of relativePath.split('/')) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      fail('EXTERNAL_EVIDENCE_FILE_INVALID', `${label}.path is unavailable: ${error.message}`);
    }
    if (stat.isSymbolicLink()) fail('EXTERNAL_EVIDENCE_FILE_INVALID', `${label}.path traverses a symlink`);
  }
  const realPath = fs.realpathSync.native(absolutePath);
  if (!containedBy(realPath, root)) fail('EXTERNAL_EVIDENCE_FILE_INVALID', `${label}.path escapes the evidence directory`);
  return absolutePath;
}

export function externalEvidenceAuthorityPolicySha256(policy) {
  return digest(canonicalJson(policy));
}

export function externalEvidenceStatementSigningBytes(statement) {
  if (!isObject(statement)) throw new TypeError('statement must be an object');
  const { signatures: _signatures, ...unsigned } = statement;
  return Buffer.from(canonicalJson({ domain: SIGNING_DOMAIN, statement: unsigned }), 'utf8');
}

function validatePolicy(policy, operatorSelectedPolicySha256) {
  exactKeys(policy, ['authorities', 'kind', 'policyId', 'schemaVersion'], 'authorityPolicy');
  exactValue(policy.schemaVersion, SCHEMA_VERSION, 'authorityPolicy.schemaVersion');
  exactValue(policy.kind, POLICY_KIND, 'authorityPolicy.kind');
  boundedString(policy.policyId, 'authorityPolicy.policyId', { maximum: 160 });
  if (!Array.isArray(policy.authorities) || policy.authorities.length < 8 || policy.authorities.length > 32) {
    fail('EXTERNAL_EVIDENCE_POLICY_INVALID', 'authorityPolicy.authorities must contain 8-32 purpose-restricted authorities');
  }
  const authorityMap = new Map();
  const authorityFingerprints = new Set();
  for (const [index, authority] of policy.authorities.entries()) {
    const label = `authorityPolicy.authorities[${index}]`;
    exactKeys(authority, ['algorithm', 'id', 'publicKeyPem', 'publicKeySpkiSha256', 'roles', 'trustBasis'], label);
    boundedString(authority.id, `${label}.id`, { maximum: 160, pattern: /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/u });
    if (authorityMap.has(authority.id)) fail('EXTERNAL_EVIDENCE_POLICY_INVALID', `duplicate authority ${authority.id}`);
    exactValue(authority.algorithm, 'ed25519', `${label}.algorithm`);
    exactValue(authority.trustBasis, 'independent-external-authority', `${label}.trustBasis`);
    sortedUniqueStrings(authority.roles, `${label}.roles`);
    if (authority.roles.length !== 1 || !Object.values(GATE_REQUIREMENTS).some(({ roles }) => roles.includes(authority.roles[0]))) {
      fail('EXTERNAL_EVIDENCE_POLICY_INVALID', `${label} must have exactly one recognized evidence role`);
    }
    let publicKey;
    try {
      publicKey = crypto.createPublicKey(authority.publicKeyPem);
    } catch (error) {
      fail('EXTERNAL_EVIDENCE_POLICY_INVALID', `${label}.publicKeyPem is invalid: ${error.message}`);
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') fail('EXTERNAL_EVIDENCE_POLICY_INVALID', `${label} must use an Ed25519 key`);
    const fingerprint = digest(publicKey.export({ type: 'spki', format: 'der' }));
    validateDigest(authority.publicKeySpkiSha256, `${label}.publicKeySpkiSha256`);
    if (authority.publicKeySpkiSha256 !== fingerprint) fail('EXTERNAL_EVIDENCE_POLICY_INVALID', `${label} key fingerprint drift`);
    if (authorityFingerprints.has(fingerprint)) fail('EXTERNAL_EVIDENCE_POLICY_INVALID', `${label} reuses another evidence authority key`);
    authorityFingerprints.add(fingerprint);
    authorityMap.set(authority.id, { ...authority, publicKey });
  }
  for (const { roles } of Object.values(GATE_REQUIREMENTS)) {
    for (const role of roles) {
      if (![...authorityMap.values()].some((authority) => authority.roles.includes(role))) {
        fail('EXTERNAL_EVIDENCE_POLICY_INVALID', `authority policy has no ${role}`);
      }
    }
  }
  const policySha256 = externalEvidenceAuthorityPolicySha256(policy);
  if (policySha256 !== operatorSelectedPolicySha256) {
    fail('EXTERNAL_EVIDENCE_POLICY_BINDING_MISMATCH', 'authority policy does not match the operator-selected policy digest');
  }
  return { authorityMap, policySha256 };
}

function validateArtifacts(records, evidenceRoot) {
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_ARTIFACTS) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `artifacts must contain 1-${MAX_ARTIFACTS} records`);
  }
  const artifactMap = new Map();
  for (const [index, record] of records.entries()) {
    const label = `artifacts[${index}]`;
    exactKeys(record, ['bytes', 'id', 'kind', 'path', 'sha256'], label);
    boundedString(record.id, `${label}.id`, { maximum: 160, pattern: /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/u });
    boundedString(record.kind, `${label}.kind`, { maximum: 160, pattern: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u });
    positiveInteger(record.bytes, `${label}.bytes`);
    validateDigest(record.sha256, `${label}.sha256`);
    if (artifactMap.has(record.id)) fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `duplicate artifact ${record.id}`);
    const artifact = readStableRegularFile(safeArtifactPath(evidenceRoot, record.path, label), label, MAX_ARTIFACT_BYTES);
    if (artifact.bytes.length !== record.bytes || digest(artifact.bytes) !== record.sha256) {
      fail('EXTERNAL_EVIDENCE_ARTIFACT_MISMATCH', `${label} bytes or digest drift`);
    }
    artifactMap.set(record.id, Object.freeze({ ...record }));
  }
  const ids = [...artifactMap.keys()];
  if (canonicalJson(ids) !== canonicalJson([...ids].sort())) fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', 'artifacts must be sorted by id');
  return artifactMap;
}

function validateArtifactBindings(statement, artifactMap, requiredKinds) {
  if (!Array.isArray(statement.artifactBindings) || statement.artifactBindings.length !== requiredKinds.length) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${statement.gateId} artifact binding count drift`);
  }
  const observedKinds = [];
  const observedIds = [];
  for (const [index, binding] of statement.artifactBindings.entries()) {
    const label = `${statement.gateId}.artifactBindings[${index}]`;
    exactKeys(binding, ['bytes', 'id', 'kind', 'sha256'], label);
    const record = artifactMap.get(binding.id);
    if (!record || canonicalJson(binding) !== canonicalJson({
      id: record.id, kind: record.kind, bytes: record.bytes, sha256: record.sha256,
    })) fail('EXTERNAL_EVIDENCE_ARTIFACT_MISMATCH', `${label} does not match its hashed artifact`);
    observedKinds.push(binding.kind);
    observedIds.push(binding.id);
  }
  sortedUniqueStrings(observedIds, `${statement.gateId}.artifactBindings.ids`);
  if (canonicalJson([...observedKinds].sort()) !== canonicalJson([...requiredKinds].sort())) {
    fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${statement.gateId} required artifact kinds are missing`);
  }
  return observedIds;
}

function validateReceiptIds(payload, artifactIds, gateId) {
  sortedUniqueStrings(payload.receiptArtifactIds, `${gateId}.payload.receiptArtifactIds`);
  if (canonicalJson(payload.receiptArtifactIds) !== canonicalJson(artifactIds)) {
    fail('EXTERNAL_EVIDENCE_ARTIFACT_MISMATCH', `${gateId} receiptArtifactIds drift`);
  }
}

function validateModelPayload(payload, artifactIds) {
  const gate = EXTERNAL_EVIDENCE_GATE_IDS[0];
  exactKeys(payload, [
    'allHardGatesPassed', 'caseCount', 'completedExecutionCount', 'executionKind', 'expectedExecutionCount',
    'judgeIndependence', 'judgeModelId', 'judgeProvider', 'judgeReceiptVerification', 'providerEnvironment',
    'providerReceiptVerification', 'receiptArtifactIds', 'repetitionsPerCase', 'scorecardVerdict', 'subjectModelTiers',
    'thresholdsPassed',
  ], `${gate}.payload`);
  exactValue(payload.executionKind, 'REAL_REPOSITORY_E2E', `${gate}.executionKind`);
  exactValue(payload.scorecardVerdict, 'PASS', `${gate}.scorecardVerdict`);
  exactValue(payload.providerEnvironment, 'external-provider-production', `${gate}.providerEnvironment`);
  exactValue(payload.providerReceiptVerification, 'cryptographic-provider-receipts-verified', `${gate}.providerReceiptVerification`);
  exactValue(payload.judgeReceiptVerification, 'cryptographic-provider-receipts-verified', `${gate}.judgeReceiptVerification`);
  exactValue(payload.judgeIndependence, 'separate-model-no-subject-output-authority', `${gate}.judgeIndependence`);
  trueValue(payload.allHardGatesPassed, `${gate}.allHardGatesPassed`);
  trueValue(payload.thresholdsPassed, `${gate}.thresholdsPassed`);
  positiveInteger(payload.caseCount, `${gate}.caseCount`, { minimum: 24 });
  positiveInteger(payload.repetitionsPerCase, `${gate}.repetitionsPerCase`, { minimum: 3 });
  if (!Array.isArray(payload.subjectModelTiers) || payload.subjectModelTiers.length !== 3) {
    fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate}.subjectModelTiers must contain frontier, mid, and small`);
  }
  const models = new Set();
  for (const [index, tier] of payload.subjectModelTiers.entries()) {
    exactKeys(tier, ['id', 'modelId', 'provider'], `${gate}.subjectModelTiers[${index}]`);
    exactValue(tier.id, ['frontier', 'mid', 'small'][index], `${gate}.subjectModelTiers[${index}].id`);
    models.add(boundedString(tier.modelId, `${gate}.subjectModelTiers[${index}].modelId`, { maximum: 240 }));
    boundedString(tier.provider, `${gate}.subjectModelTiers[${index}].provider`, { maximum: 160 });
  }
  if (models.size !== 3) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate} subject tier models must be distinct`);
  boundedString(payload.judgeModelId, `${gate}.judgeModelId`, { maximum: 240 });
  boundedString(payload.judgeProvider, `${gate}.judgeProvider`, { maximum: 160 });
  if (models.has(payload.judgeModelId)) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate} judge model must be independent`);
  const expected = payload.caseCount * payload.repetitionsPerCase * payload.subjectModelTiers.length;
  if (payload.expectedExecutionCount !== expected || payload.completedExecutionCount !== expected) {
    fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate} execution matrix is incomplete`);
  }
  validateReceiptIds(payload, artifactIds, gate);
}

function validateSandboxPayload(payload, artifactIds) {
  const gate = EXTERNAL_EVIDENCE_GATE_IDS[1];
  exactKeys(payload, [
    'allowedPathsEnforced', 'attestationVerification', 'coveredRoles', 'deniedSourceAndHoldoutAccess', 'executionEnvironment',
    'externalWritesDenied', 'invocationCount', 'isolation', 'networkPolicyEnforced', 'operatorIndependentOfCandidate',
    'processTreesReaped', 'receiptArtifactIds',
  ], `${gate}.payload`);
  exactValue(payload.executionEnvironment, 'trusted-external-sandbox', `${gate}.executionEnvironment`);
  if (!['container-separate-user', 'remote-vm', 'separate-uid'].includes(payload.isolation)) {
    fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate}.isolation is not trusted`);
  }
  exactValue(payload.attestationVerification, 'cryptographic-external-attestation', `${gate}.attestationVerification`);
  const roles = ['independent-judge', 'repository-stages', 'subject-generation'];
  if (canonicalJson(payload.coveredRoles) !== canonicalJson(roles)) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate}.coveredRoles drift`);
  positiveInteger(payload.invocationCount, `${gate}.invocationCount`);
  for (const key of ['allowedPathsEnforced', 'deniedSourceAndHoldoutAccess', 'externalWritesDenied', 'networkPolicyEnforced', 'operatorIndependentOfCandidate', 'processTreesReaped']) {
    trueValue(payload[key], `${gate}.${key}`);
  }
  validateReceiptIds(payload, artifactIds, gate);
}

function validatePublicPayload(payload, artifactIds) {
  const gate = EXTERNAL_EVIDENCE_GATE_IDS[2];
  exactKeys(payload, [
    'candidateVerdict', 'caseCount', 'comparatorMethodology', 'immutableRepositoryRevisions', 'populationKind',
    'populationVisibility', 'receiptArtifactIds', 'repositoryCount', 'receiptVerification',
  ], `${gate}.payload`);
  exactValue(payload.populationKind, 'public-comparable-repository-e2e', `${gate}.populationKind`);
  exactValue(payload.populationVisibility, 'public', `${gate}.populationVisibility`);
  exactValue(payload.comparatorMethodology, 'same-evaluator-contract-and-thresholds', `${gate}.comparatorMethodology`);
  exactValue(payload.candidateVerdict, 'PASS', `${gate}.candidateVerdict`);
  exactValue(payload.receiptVerification, 'cryptographic-external-receipts', `${gate}.receiptVerification`);
  positiveInteger(payload.repositoryCount, `${gate}.repositoryCount`);
  positiveInteger(payload.caseCount, `${gate}.caseCount`);
  trueValue(payload.immutableRepositoryRevisions, `${gate}.immutableRepositoryRevisions`);
  validateReceiptIds(payload, artifactIds, gate);
}

function validateHoldoutPayload(payload, artifactIds, sourceBinding) {
  const gate = EXTERNAL_EVIDENCE_GATE_IDS[3];
  exactKeys(payload, ['holdout', 'priorComparator', 'receiptArtifactIds'], `${gate}.payload`);
  exactKeys(payload.holdout, [
    'candidateHadPreRevealAccess', 'caseCount', 'noveltyVerification', 'origin', 'receiptVerification', 'revealAfterGeneration', 'verdict',
  ], `${gate}.payload.holdout`);
  exactValue(payload.holdout.origin, 'independently-authored-unseen', `${gate}.holdout.origin`);
  exactValue(payload.holdout.noveltyVerification, 'independently-verified', `${gate}.holdout.noveltyVerification`);
  exactValue(payload.holdout.receiptVerification, 'cryptographic-external-receipts', `${gate}.holdout.receiptVerification`);
  exactValue(payload.holdout.verdict, 'PASS', `${gate}.holdout.verdict`);
  if (payload.holdout.candidateHadPreRevealAccess !== false) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate} holdout was not sealed`);
  trueValue(payload.holdout.revealAfterGeneration, `${gate}.holdout.revealAfterGeneration`);
  positiveInteger(payload.holdout.caseCount, `${gate}.holdout.caseCount`, { minimum: 24 });
  exactKeys(payload.priorComparator, [
    'baselineSelection', 'commit', 'immutableReleaseReference', 'sameEvaluatorContract', 'samePopulation', 'skillTree', 'tag', 'tree', 'verdict',
  ], `${gate}.payload.priorComparator`);
  boundedString(payload.priorComparator.tag, `${gate}.priorComparator.tag`, { maximum: 80, pattern: /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u });
  exactValue(payload.priorComparator.baselineSelection, 'immediate-predecessor-public-release-at-candidate-freeze', `${gate}.priorComparator.baselineSelection`);
  for (const key of ['commit', 'tree', 'skillTree']) {
    boundedString(payload.priorComparator[key], `${gate}.priorComparator.${key}`, { pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u });
    if (payload.priorComparator[key] === sourceBinding[key]) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate} prior ${key} matches candidate`);
  }
  trueValue(payload.priorComparator.immutableReleaseReference, `${gate}.priorComparator.immutableReleaseReference`);
  trueValue(payload.priorComparator.sameEvaluatorContract, `${gate}.priorComparator.sameEvaluatorContract`);
  trueValue(payload.priorComparator.samePopulation, `${gate}.priorComparator.samePopulation`);
  exactValue(payload.priorComparator.verdict, 'NO_REGRESSION', `${gate}.priorComparator.verdict`);
  validateReceiptIds(payload, artifactIds, gate);
}

function validateForkPayload(payload, artifactIds) {
  const gate = EXTERNAL_EVIDENCE_GATE_IDS[4];
  exactKeys(payload, [
    'allForkCasesPassed', 'forks', 'providerEnvironment', 'receiptArtifactIds', 'receiptVerification', 'rpcCredentialExposure',
  ], `${gate}.payload`);
  exactValue(payload.providerEnvironment, 'external-archive-rpc', `${gate}.providerEnvironment`);
  exactValue(payload.receiptVerification, 'cryptographic-external-receipts', `${gate}.receiptVerification`);
  exactValue(payload.rpcCredentialExposure, 'none-loopback-proxy-only', `${gate}.rpcCredentialExposure`);
  trueValue(payload.allForkCasesPassed, `${gate}.allForkCasesPassed`);
  if (!Array.isArray(payload.forks) || payload.forks.length === 0) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate}.forks is empty`);
  for (const [index, fork] of payload.forks.entries()) {
    const label = `${gate}.forks[${index}]`;
    exactKeys(fork, ['blockHash', 'blockNumber', 'caseCount', 'chainId', 'passedCaseCount'], label);
    positiveInteger(fork.chainId, `${label}.chainId`);
    positiveInteger(fork.blockNumber, `${label}.blockNumber`, { minimum: 0 });
    boundedString(fork.blockHash, `${label}.blockHash`, { pattern: /^0x[0-9a-f]{64}$/u, maximum: 66 });
    positiveInteger(fork.caseCount, `${label}.caseCount`);
    if (fork.passedCaseCount !== fork.caseCount) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${label} has failing or missing cases`);
  }
  validateReceiptIds(payload, artifactIds, gate);
}

function validateHostPayload(payload, artifactIds, sourceBinding) {
  const gate = EXTERNAL_EVIDENCE_GATE_IDS[5];
  exactKeys(payload, ['executionEnvironment', 'hosts', 'receiptArtifactIds', 'receiptVerification'], `${gate}.payload`);
  exactValue(payload.executionEnvironment, 'installed-host-external-provider', `${gate}.executionEnvironment`);
  exactValue(payload.receiptVerification, 'cryptographic-external-receipts', `${gate}.receiptVerification`);
  if (!Array.isArray(payload.hosts) || payload.hosts.length !== 3) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate}.hosts drift`);
  const providers = new Set();
  for (const [index, host] of payload.hosts.entries()) {
    const label = `${gate}.hosts[${index}]`;
    exactKeys(host, ['host', 'hostVersion', 'installedSkillTree', 'invocation', 'manualInterventions', 'modelId', 'provider', 'status'], label);
    exactValue(host.host, ['claude-code', 'codex', 'github-copilot'][index], `${label}.host`);
    boundedString(host.hostVersion, `${label}.hostVersion`, { maximum: 160 });
    boundedString(host.modelId, `${label}.modelId`, { maximum: 240 });
    providers.add(boundedString(host.provider, `${label}.provider`, { maximum: 160 }));
    exactValue(host.installedSkillTree, sourceBinding.skillTree, `${label}.installedSkillTree`);
    exactValue(host.invocation, 'natural-language-intent-to-generated-repository-and-submission', `${label}.invocation`);
    exactValue(host.status, 'PASS', `${label}.status`);
    if (host.manualInterventions !== 0) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${label} required manual intervention`);
  }
  if (providers.size < 2) fail('EXTERNAL_EVIDENCE_GATE_UNSATISFIED', `${gate} needs at least two independent providers`);
  validateReceiptIds(payload, artifactIds, gate);
}

const PAYLOAD_VALIDATORS = Object.freeze({
  REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE: validateModelPayload,
  TRUSTED_SEPARATE_UID_OR_CONTAINER_SANDBOX: validateSandboxPayload,
  PUBLIC_COMPARABLE_REPOSITORY_E2E_POPULATION: validatePublicPayload,
  INDEPENDENT_NOVEL_HOLDOUT_AND_PRIOR_RELEASE_COMPARATOR: validateHoldoutPayload,
  FORK_RPC_FOR_FORK_DEPENDENT_CASES: validateForkPayload,
  INSTALLED_HOST_NATURAL_LANGUAGE_TO_SUBMISSION: validateHostPayload,
});

function validateSignatures(statement, authorityMap, requiredRoles) {
  if (!Array.isArray(statement.signatures) || statement.signatures.length !== requiredRoles.length) {
    fail('EXTERNAL_EVIDENCE_SIGNATURE_INVALID', `${statement.gateId} signature count drift`);
  }
  const signingBytes = externalEvidenceStatementSigningBytes(statement);
  const signers = new Set();
  const observedRoles = [];
  for (const [index, signature] of statement.signatures.entries()) {
    const label = `${statement.gateId}.signatures[${index}]`;
    exactKeys(signature, ['algorithm', 'authorityId', 'role', 'signatureBase64'], label);
    exactValue(signature.algorithm, 'ed25519', `${label}.algorithm`);
    const authority = authorityMap.get(signature.authorityId);
    if (!authority || !authority.roles.includes(signature.role)) fail('EXTERNAL_EVIDENCE_SIGNATURE_INVALID', `${label} authority is not trusted for ${signature.role}`);
    if (signers.has(signature.authorityId)) fail('EXTERNAL_EVIDENCE_SIGNATURE_INVALID', `${statement.gateId} requires distinct signing authorities`);
    signers.add(signature.authorityId);
    observedRoles.push(signature.role);
    let bytes;
    try {
      bytes = Buffer.from(signature.signatureBase64, 'base64');
    } catch {
      fail('EXTERNAL_EVIDENCE_SIGNATURE_INVALID', `${label}.signatureBase64 is invalid`);
    }
    if (bytes.length !== 64 || bytes.toString('base64') !== signature.signatureBase64 || !crypto.verify(null, signingBytes, authority.publicKey, bytes)) {
      fail('EXTERNAL_EVIDENCE_SIGNATURE_INVALID', `${label} signature verification failed`);
    }
  }
  if (canonicalJson(observedRoles) !== canonicalJson(requiredRoles)) {
    fail('EXTERNAL_EVIDENCE_SIGNATURE_INVALID', `${statement.gateId} signature roles drift`);
  }
  return [...signers];
}

function blockedGateResult(gateId) {
  return Object.freeze({
    gateId,
    status: 'EXTERNAL_BLOCKED',
    evidenceStatus: 'NOT_PROVIDED',
    cryptographicStatus: 'NOT_PROVIDED',
    policyTrust: 'NOT_ESTABLISHED',
    independenceEstablished: false,
    statementSha256: null,
    authorityIds: Object.freeze([]),
    artifactBindings: Object.freeze([]),
  });
}

export function externalEvidenceNotProvided(sourceBinding) {
  const gateResults = EXTERNAL_EVIDENCE_GATE_IDS.map(blockedGateResult);
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    status: 'NOT_PROVIDED',
    releaseCandidate: false,
    sourceBinding: Object.freeze({ ...sourceBinding }),
    bundleSha256: null,
    operatorSelectedPolicySha256: null,
    independentlyPinnedPolicySha256: null,
    policyTrust: Object.freeze({
      state: 'NOT_PROVIDED',
      selection: 'none',
      independenceEstablished: false,
    }),
    evidenceId: null,
    createdAt: null,
    expiresAt: null,
    gateResults: Object.freeze(gateResults),
    signatureValidGateIds: Object.freeze([]),
    verifiedGateIds: Object.freeze([]),
    remainingBlockedGateIds: Object.freeze([...EXTERNAL_EVIDENCE_GATE_IDS]),
  });
}

export function verifyExternalEvidenceBundle({
  evidencePath = null,
  operatorSelectedPolicySha256 = null,
  repositoryRoot,
  sourceBinding,
  now = new Date(),
}) {
  if (evidencePath === null && operatorSelectedPolicySha256 === null) return externalEvidenceNotProvided(sourceBinding);
  if (typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath) || operatorSelectedPolicySha256 === null) {
    fail('EXTERNAL_EVIDENCE_ARGUMENT_INVALID', 'external evidence requires an absolute path and an operator-selected policy SHA-256 binding');
  }
  validateDigest(operatorSelectedPolicySha256, 'operatorSelectedPolicySha256');
  const repositoryReal = fs.realpathSync.native(repositoryRoot);
  const bundleFile = readStableRegularFile(evidencePath, 'external evidence bundle', MAX_BUNDLE_BYTES);
  if (!outsideRoot(bundleFile.realPath, repositoryReal)) {
    fail('EXTERNAL_EVIDENCE_FILE_INVALID', 'external evidence bundle must resolve outside the repository');
  }
  let bundle;
  try {
    bundle = parseBoundedStrictJsonBytes(bundleFile.bytes, {
      maxSourceBytes: MAX_BUNDLE_BYTES, maxNodes: 250_000, maxDepth: 128, maxNumberCharacters: 128,
    });
  } catch (error) {
    fail('EXTERNAL_EVIDENCE_JSON_INVALID', `external evidence bundle is not strict bounded JSON: ${error.message}`);
  }
  exactKeys(bundle, [
    '$schema', 'artifacts', 'authorityPolicy', 'authorityPolicySha256', 'createdAt', 'evidenceId', 'expiresAt', 'kind',
    'schemaVersion', 'sourceBinding', 'statements',
  ], 'bundle');
  exactValue(bundle.$schema, 'urn:programmable:release-external-evidence:1.0.0', 'bundle.$schema');
  exactValue(bundle.schemaVersion, SCHEMA_VERSION, 'bundle.schemaVersion');
  exactValue(bundle.kind, BUNDLE_KIND, 'bundle.kind');
  boundedString(bundle.evidenceId, 'bundle.evidenceId', { maximum: 160, pattern: /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/u });
  const boundSource = validateSourceBinding(bundle.sourceBinding, sourceBinding, 'bundle.sourceBinding');
  const created = parseTimestamp(bundle.createdAt, 'bundle.createdAt');
  const expires = parseTimestamp(bundle.expiresAt, 'bundle.expiresAt');
  const evaluatedAt = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(evaluatedAt) || expires <= created || evaluatedAt < created || evaluatedAt > expires) {
    fail('EXTERNAL_EVIDENCE_EXPIRED', 'external evidence is not valid at the verification time');
  }
  const { authorityMap, policySha256 } = validatePolicy(bundle.authorityPolicy, operatorSelectedPolicySha256);
  const independenceEstablished = INDEPENDENTLY_PINNED_POLICY_SHA256.has(policySha256);
  validateDigest(bundle.authorityPolicySha256, 'bundle.authorityPolicySha256');
  if (bundle.authorityPolicySha256 !== policySha256) fail('EXTERNAL_EVIDENCE_POLICY_INVALID', 'bundle authority policy hash drift');
  const artifactMap = validateArtifacts(bundle.artifacts, path.dirname(bundleFile.realPath));
  if (!Array.isArray(bundle.statements) || bundle.statements.length > EXTERNAL_EVIDENCE_GATE_IDS.length) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', 'bundle.statements count is invalid');
  }
  const results = new Map();
  const referencedArtifacts = new Set();
  let lastGateIndex = -1;
  for (const [index, statement] of bundle.statements.entries()) {
    const label = `bundle.statements[${index}]`;
    exactKeys(statement, [
      'artifactBindings', 'gateId', 'kind', 'observedAt', 'payload', 'schemaVersion', 'signatures', 'sourceBinding',
    ], label);
    exactValue(statement.schemaVersion, SCHEMA_VERSION, `${label}.schemaVersion`);
    exactValue(statement.kind, STATEMENT_KIND, `${label}.kind`);
    if (!EXTERNAL_EVIDENCE_GATE_IDS.includes(statement.gateId) || results.has(statement.gateId)) {
      fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label}.gateId is unknown or repeated`);
    }
    const gateIndex = EXTERNAL_EVIDENCE_GATE_IDS.indexOf(statement.gateId);
    if (gateIndex <= lastGateIndex) fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', 'bundle.statements must follow canonical gate order');
    lastGateIndex = gateIndex;
    validateSourceBinding(statement.sourceBinding, sourceBinding, `${label}.sourceBinding`);
    const observed = parseTimestamp(statement.observedAt, `${label}.observedAt`);
    if (observed < created || observed > evaluatedAt) fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', `${label}.observedAt is outside the evidence window`);
    const requirement = GATE_REQUIREMENTS[statement.gateId];
    const artifactIds = validateArtifactBindings(statement, artifactMap, requirement.artifactKinds);
    for (const id of artifactIds) referencedArtifacts.add(id);
    PAYLOAD_VALIDATORS[statement.gateId](statement.payload, artifactIds, boundSource);
    const authorityIds = validateSignatures(statement, authorityMap, requirement.roles);
    results.set(statement.gateId, Object.freeze({
      gateId: statement.gateId,
      status: independenceEstablished ? 'VERIFIED_EXTERNAL_EVIDENCE' : 'EXTERNAL_BLOCKED',
      evidenceStatus: independenceEstablished ? 'VERIFIED_EXTERNAL_EVIDENCE' : 'VALID_UNTRUSTED_POLICY',
      cryptographicStatus: 'SIGNATURE_VALID',
      policyTrust: independenceEstablished ? 'INDEPENDENTLY_PINNED' : 'CALLER_SUPPLIED_UNESTABLISHED',
      independenceEstablished,
      statementSha256: digest(externalEvidenceStatementSigningBytes(statement)),
      authorityIds: Object.freeze(authorityIds),
      artifactBindings: Object.freeze(statement.artifactBindings.map((binding) => Object.freeze({ ...binding }))),
    }));
  }
  if ([...artifactMap.keys()].some((id) => !referencedArtifacts.has(id))) {
    fail('EXTERNAL_EVIDENCE_SCHEMA_INVALID', 'bundle contains an unsigned or unused artifact');
  }
  const gateResults = EXTERNAL_EVIDENCE_GATE_IDS.map((gateId) => results.get(gateId) ?? blockedGateResult(gateId));
  const signatureValidGateIds = gateResults.filter(({ cryptographicStatus }) => cryptographicStatus === 'SIGNATURE_VALID').map(({ gateId }) => gateId);
  const verifiedGateIds = gateResults.filter(({ status }) => status === 'VERIFIED_EXTERNAL_EVIDENCE').map(({ gateId }) => gateId);
  const remainingBlockedGateIds = EXTERNAL_EVIDENCE_GATE_IDS.filter((gateId) => !verifiedGateIds.includes(gateId));
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    status: independenceEstablished
      ? remainingBlockedGateIds.length === 0 ? 'ALL_GATES_VERIFIED' : 'PARTIAL'
      : 'VALID_UNTRUSTED_POLICY',
    releaseCandidate: false,
    sourceBinding: boundSource,
    bundleSha256: digest(bundleFile.bytes),
    operatorSelectedPolicySha256: policySha256,
    independentlyPinnedPolicySha256: independenceEstablished ? policySha256 : null,
    policyTrust: Object.freeze({
      state: independenceEstablished ? 'INDEPENDENTLY_PINNED' : 'CALLER_SUPPLIED_UNESTABLISHED',
      selection: independenceEstablished ? 'reviewed-source-pin' : 'adjacent-command-line-argument',
      independenceEstablished,
    }),
    evidenceId: bundle.evidenceId,
    createdAt: bundle.createdAt,
    expiresAt: bundle.expiresAt,
    gateResults: Object.freeze(gateResults),
    signatureValidGateIds: Object.freeze(signatureValidGateIds),
    verifiedGateIds: Object.freeze(verifiedGateIds),
    remainingBlockedGateIds: Object.freeze(remainingBlockedGateIds),
  });
}
