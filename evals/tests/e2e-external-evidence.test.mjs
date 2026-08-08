import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EXTERNAL_EVIDENCE_GATE_IDS,
  externalEvidenceAuthorityPolicySha256,
  externalEvidenceNotProvided,
  externalEvidenceStatementSigningBytes,
  verifyExternalEvidenceBundle,
} from '../../scripts/evals/e2e-external-evidence-core.mjs';
import { canonicalJson, sha256 } from '../../scripts/evals/e2e-corpus-core.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
const NOW = new Date('2026-08-07T12:00:00.000Z');
const SOURCE = Object.freeze({
  commit: '1'.repeat(40),
  tree: '2'.repeat(40),
  skillTree: '3'.repeat(40),
});
const REQUIRED_ROLES = Object.freeze({
  REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE: ['independent-judge-verifier', 'provider-receipt-verifier'],
  TRUSTED_SEPARATE_UID_OR_CONTAINER_SANDBOX: ['sandbox-attestation-verifier'],
  PUBLIC_COMPARABLE_REPOSITORY_E2E_POPULATION: ['public-comparator-verifier'],
  INDEPENDENT_NOVEL_HOLDOUT_AND_PRIOR_RELEASE_COMPARATOR: ['independent-holdout-verifier', 'prior-release-verifier'],
  FORK_RPC_FOR_FORK_DEPENDENT_CASES: ['fork-execution-verifier'],
  INSTALLED_HOST_NATURAL_LANGUAGE_TO_SUBMISSION: ['host-behavior-verifier'],
});
const GATE_ARTIFACTS = Object.freeze({
  REAL_MODEL_TIERS_AND_INDEPENDENT_JUDGE: [
    ['judge-scorecard', 'independent-judge-scorecard'],
    ['provider-receipts', 'provider-session-receipts'],
  ],
  TRUSTED_SEPARATE_UID_OR_CONTAINER_SANDBOX: [['sandbox-receipts', 'sandbox-attestation-receipts']],
  PUBLIC_COMPARABLE_REPOSITORY_E2E_POPULATION: [['public-population', 'public-repository-e2e-population']],
  INDEPENDENT_NOVEL_HOLDOUT_AND_PRIOR_RELEASE_COMPARATOR: [
    ['holdout-scorecard', 'independent-holdout-scorecard'],
    ['prior-comparator', 'prior-release-comparator'],
  ],
  FORK_RPC_FOR_FORK_DEPENDENT_CASES: [['fork-receipts', 'pinned-fork-execution-receipts']],
  INSTALLED_HOST_NATURAL_LANGUAGE_TO_SUBMISSION: [['host-receipts', 'installed-host-behavior-receipts']],
});

function digest(value) {
  return `sha256:${sha256(value)}`;
}

function payloadFor(gateId, artifactIds) {
  if (gateId === EXTERNAL_EVIDENCE_GATE_IDS[0]) return {
    executionKind: 'REAL_REPOSITORY_E2E',
    scorecardVerdict: 'PASS',
    providerEnvironment: 'external-provider-production',
    providerReceiptVerification: 'cryptographic-provider-receipts-verified',
    judgeReceiptVerification: 'cryptographic-provider-receipts-verified',
    judgeIndependence: 'separate-model-no-subject-output-authority',
    allHardGatesPassed: true,
    thresholdsPassed: true,
    caseCount: 24,
    repetitionsPerCase: 3,
    subjectModelTiers: [
      { id: 'frontier', modelId: 'frontier-model@immutable-1', provider: 'provider-a' },
      { id: 'mid', modelId: 'mid-model@immutable-1', provider: 'provider-b' },
      { id: 'small', modelId: 'small-model@immutable-1', provider: 'provider-c' },
    ],
    judgeModelId: 'judge-model@immutable-1',
    judgeProvider: 'provider-d',
    expectedExecutionCount: 216,
    completedExecutionCount: 216,
    receiptArtifactIds: artifactIds,
  };
  if (gateId === EXTERNAL_EVIDENCE_GATE_IDS[1]) return {
    executionEnvironment: 'trusted-external-sandbox',
    isolation: 'container-separate-user',
    attestationVerification: 'cryptographic-external-attestation',
    coveredRoles: ['independent-judge', 'repository-stages', 'subject-generation'],
    invocationCount: 240,
    allowedPathsEnforced: true,
    deniedSourceAndHoldoutAccess: true,
    externalWritesDenied: true,
    networkPolicyEnforced: true,
    operatorIndependentOfCandidate: true,
    processTreesReaped: true,
    receiptArtifactIds: artifactIds,
  };
  if (gateId === EXTERNAL_EVIDENCE_GATE_IDS[2]) return {
    populationKind: 'public-comparable-repository-e2e',
    populationVisibility: 'public',
    comparatorMethodology: 'same-evaluator-contract-and-thresholds',
    candidateVerdict: 'PASS',
    receiptVerification: 'cryptographic-external-receipts',
    repositoryCount: 12,
    caseCount: 12,
    immutableRepositoryRevisions: true,
    receiptArtifactIds: artifactIds,
  };
  if (gateId === EXTERNAL_EVIDENCE_GATE_IDS[3]) return {
    holdout: {
      origin: 'independently-authored-unseen',
      noveltyVerification: 'independently-verified',
      receiptVerification: 'cryptographic-external-receipts',
      verdict: 'PASS',
      candidateHadPreRevealAccess: false,
      revealAfterGeneration: true,
      caseCount: 24,
    },
    priorComparator: {
      baselineSelection: 'immediate-predecessor-public-release-at-candidate-freeze',
      tag: 'v0.5.0',
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      skillTree: 'c'.repeat(40),
      immutableReleaseReference: true,
      sameEvaluatorContract: true,
      samePopulation: true,
      verdict: 'NO_REGRESSION',
    },
    receiptArtifactIds: artifactIds,
  };
  if (gateId === EXTERNAL_EVIDENCE_GATE_IDS[4]) return {
    providerEnvironment: 'external-archive-rpc',
    receiptVerification: 'cryptographic-external-receipts',
    rpcCredentialExposure: 'none-loopback-proxy-only',
    allForkCasesPassed: true,
    forks: [{ chainId: 1, blockNumber: 23_000_000, blockHash: `0x${'d'.repeat(64)}`, caseCount: 4, passedCaseCount: 4 }],
    receiptArtifactIds: artifactIds,
  };
  return {
    executionEnvironment: 'installed-host-external-provider',
    receiptVerification: 'cryptographic-external-receipts',
    hosts: [
      { host: 'claude-code', hostVersion: '1.2.3', installedSkillTree: SOURCE.skillTree, invocation: 'natural-language-intent-to-generated-repository-and-submission', manualInterventions: 0, modelId: 'claude@immutable-1', provider: 'anthropic', status: 'PASS' },
      { host: 'codex', hostVersion: '4.5.6', installedSkillTree: SOURCE.skillTree, invocation: 'natural-language-intent-to-generated-repository-and-submission', manualInterventions: 0, modelId: 'codex@immutable-1', provider: 'openai', status: 'PASS' },
      { host: 'github-copilot', hostVersion: '7.8.9', installedSkillTree: SOURCE.skillTree, invocation: 'natural-language-intent-to-generated-repository-and-submission', manualInterventions: 0, modelId: 'copilot@immutable-1', provider: 'github', status: 'PASS' },
    ],
    receiptArtifactIds: artifactIds,
  };
}

function buildEvidence(root, {
  gateIds = EXTERNAL_EVIDENCE_GATE_IDS,
  mutatePayload = null,
  mutatePolicy = null,
} = {}) {
  const roles = [...new Set(Object.values(REQUIRED_ROLES).flat())].sort();
  const privateKeys = new Map();
  const authorities = roles.map((role) => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    privateKeys.set(role, privateKey);
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    return {
      id: `authority:${role}`,
      algorithm: 'ed25519',
      publicKeyPem,
      publicKeySpkiSha256: digest(publicKey.export({ type: 'spki', format: 'der' })),
      roles: [role],
      trustBasis: 'independent-external-authority',
    };
  });
  const policy = {
    schemaVersion: '1.0.0',
    kind: 'programmable-release-external-evidence-authority-policy',
    policyId: 'external-release-authorities-2026-08',
    authorities,
  };
  mutatePolicy?.(policy);
  const artifactDirectory = path.join(root, 'artifacts');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const selectedArtifacts = gateIds.flatMap((gateId) => GATE_ARTIFACTS[gateId]);
  const artifacts = selectedArtifacts.map(([id, kind]) => {
    const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: '1.0.0', id, kind, externallyCaptured: true })}\n`);
    fs.writeFileSync(path.join(artifactDirectory, `${id}.json`), bytes);
    return { id, kind, path: `artifacts/${id}.json`, bytes: bytes.length, sha256: digest(bytes) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const artifactMap = new Map(artifacts.map((record) => [record.id, record]));
  const statements = gateIds.map((gateId) => {
    const artifactBindings = GATE_ARTIFACTS[gateId].map(([id]) => {
      const record = artifactMap.get(id);
      return { id: record.id, kind: record.kind, bytes: record.bytes, sha256: record.sha256 };
    }).sort((left, right) => left.id.localeCompare(right.id));
    const artifactIds = artifactBindings.map(({ id }) => id);
    const payload = payloadFor(gateId, artifactIds);
    mutatePayload?.(gateId, payload);
    const statement = {
      schemaVersion: '1.0.0',
      kind: 'programmable-release-external-evidence-statement',
      gateId,
      sourceBinding: { ...SOURCE },
      observedAt: '2026-08-06T12:00:00.000Z',
      payload,
      artifactBindings,
      signatures: [],
    };
    statement.signatures = REQUIRED_ROLES[gateId].map((role) => ({
      authorityId: `authority:${role}`,
      role,
      algorithm: 'ed25519',
      signatureBase64: crypto.sign(null, externalEvidenceStatementSigningBytes(statement), privateKeys.get(role)).toString('base64'),
    }));
    return statement;
  });
  const policySha256 = externalEvidenceAuthorityPolicySha256(policy);
  const bundle = {
    $schema: 'urn:programmable:release-external-evidence:1.0.0',
    schemaVersion: '1.0.0',
    kind: 'programmable-release-external-evidence-bundle',
    evidenceId: 'release-evidence-campaign-2026-08',
    sourceBinding: { ...SOURCE },
    createdAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-09-01T00:00:00.000Z',
    authorityPolicy: policy,
    authorityPolicySha256: policySha256,
    artifacts,
    statements,
  };
  const bundlePath = path.join(root, 'external-evidence.json');
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  return { bundle, bundlePath, policySha256 };
}

function verify(evidence) {
  return verifyExternalEvidenceBundle({
    evidencePath: evidence.bundlePath,
    operatorSelectedPolicySha256: evidence.policySha256,
    repositoryRoot: REPOSITORY_ROOT,
    sourceBinding: SOURCE,
    now: NOW,
  });
}

test('missing external evidence deterministically leaves every exact release gate blocked', () => {
  const result = externalEvidenceNotProvided(SOURCE);
  assert.equal(result.status, 'NOT_PROVIDED');
  assert.equal(result.releaseCandidate, false);
  assert.deepEqual(result.verifiedGateIds, []);
  assert.deepEqual(result.signatureValidGateIds, []);
  assert.equal(result.policyTrust.independenceEstablished, false);
  assert.deepEqual(result.remainingBlockedGateIds, EXTERNAL_EVIDENCE_GATE_IDS);
  assert.ok(result.gateResults.every(({ status, statementSha256 }) => status === 'EXTERNAL_BLOCKED' && statementSha256 === null));
});

test('caller-selected policy can validate signatures but cannot establish independence or clear any release gate', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-external-evidence-valid-'));
  try {
    const result = verify(buildEvidence(root));
    assert.equal(result.status, 'VALID_UNTRUSTED_POLICY');
    assert.equal(result.releaseCandidate, false);
    assert.equal(result.policyTrust.state, 'CALLER_SUPPLIED_UNESTABLISHED');
    assert.equal(result.policyTrust.selection, 'adjacent-command-line-argument');
    assert.equal(result.policyTrust.independenceEstablished, false);
    assert.equal(result.independentlyPinnedPolicySha256, null);
    assert.deepEqual(result.signatureValidGateIds, EXTERNAL_EVIDENCE_GATE_IDS);
    assert.deepEqual(result.verifiedGateIds, []);
    assert.deepEqual(result.remainingBlockedGateIds, EXTERNAL_EVIDENCE_GATE_IDS);
    assert.match(result.bundleSha256, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(result.gateResults.every(({ status, evidenceStatus, authorityIds, artifactBindings }) => (
      status === 'EXTERNAL_BLOCKED' && evidenceStatus === 'VALID_UNTRUSTED_POLICY'
      && authorityIds.length >= 1 && artifactBindings.length >= 1
    )));
    assert.equal(canonicalJson(result).includes(root), false);
    context.diagnostic(`projection ${JSON.stringify({
      status: result.status,
      policyTrust: result.policyTrust.state,
      independenceEstablished: result.policyTrust.independenceEstablished,
      signatureValidGateCount: result.signatureValidGateIds.length,
      verifiedGateCount: result.verifiedGateIds.length,
      blockedGateCount: result.remainingBlockedGateIds.length,
      releaseCandidate: result.releaseCandidate,
    })}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a partial caller-policy bundle validates only its signed statement while every release gate remains blocked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-external-evidence-partial-'));
  try {
    const result = verify(buildEvidence(root, { gateIds: [EXTERNAL_EVIDENCE_GATE_IDS[0]] }));
    assert.equal(result.status, 'VALID_UNTRUSTED_POLICY');
    assert.deepEqual(result.signatureValidGateIds, [EXTERNAL_EVIDENCE_GATE_IDS[0]]);
    assert.deepEqual(result.verifiedGateIds, []);
    assert.deepEqual(result.remainingBlockedGateIds, EXTERNAL_EVIDENCE_GATE_IDS);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('untrusted policies, local fixture claims, omnibus self-attestation, tampering, and source drift fail closed', () => {
  const roots = [];
  const make = (name, options) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `programmable-external-evidence-${name}-`));
    roots.push(root);
    return buildEvidence(root, options);
  };
  try {
    const untrusted = make('untrusted');
    assert.throws(() => verifyExternalEvidenceBundle({
      evidencePath: untrusted.bundlePath,
      operatorSelectedPolicySha256: `sha256:${'0'.repeat(64)}`,
      repositoryRoot: REPOSITORY_ROOT,
      sourceBinding: SOURCE,
      now: NOW,
    }), (error) => error?.code === 'EXTERNAL_EVIDENCE_POLICY_BINDING_MISMATCH');

    const local = make('local', {
      gateIds: [EXTERNAL_EVIDENCE_GATE_IDS[0]],
      mutatePayload(gateId, payload) {
        if (gateId === EXTERNAL_EVIDENCE_GATE_IDS[0]) payload.providerEnvironment = 'local-fixture';
      },
    });
    assert.throws(() => verify(local), (error) => error?.code === 'EXTERNAL_EVIDENCE_GATE_UNSATISFIED');

    const omnibus = make('omnibus', {
      mutatePolicy(policy) {
        policy.authorities[0].roles.push('provider-receipt-verifier');
        policy.authorities[0].roles.sort();
      },
    });
    assert.throws(() => verify(omnibus), (error) => error?.code === 'EXTERNAL_EVIDENCE_POLICY_INVALID');

    const tampered = make('tampered');
    fs.appendFileSync(path.join(path.dirname(tampered.bundlePath), tampered.bundle.artifacts[0].path), 'tampered');
    assert.throws(() => verify(tampered), (error) => error?.code === 'EXTERNAL_EVIDENCE_ARTIFACT_MISMATCH');

    const drift = make('source-drift');
    assert.throws(() => verifyExternalEvidenceBundle({
      evidencePath: drift.bundlePath,
      operatorSelectedPolicySha256: drift.policySha256,
      repositoryRoot: REPOSITORY_ROOT,
      sourceBinding: { ...SOURCE, tree: 'f'.repeat(40) },
      now: NOW,
    }), (error) => error?.code === 'EXTERNAL_EVIDENCE_SOURCE_MISMATCH');
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
});
