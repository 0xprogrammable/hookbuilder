import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadSubjectSandbox, spawnIsolated } from './e2e-sandbox-core.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');
export const BASE_CORPUS_V1_RELATIVE_PATH = 'evals/journey-benchmark/v1/corpus.json';
export const BASE_CORPUS_V1_DIGEST_RELATIVE_PATH = 'evals/journey-benchmark/v1/corpus.sha256';
export const CORPUS_RELATIVE_PATH = 'evals/journey-benchmark/v2/corpus.json';
export const CORPUS_DIGEST_RELATIVE_PATH = 'evals/journey-benchmark/v2/corpus.sha256';
export const CORPUS_VERSION_AUTHORITY_RELATIVE_PATH = 'config/journey-benchmark-corpus-versions.json';
export const ACTIVE_CORPUS_ID = 'programmable-community-journeys-v2';
// Published corpus versions are immutable. Any byte change requires a new
// overlay version; do not update these authorities for in-place edits.
export const PINNED_V1_CORPUS_SHA256 = '81f27c3ad1acd1ea676ba982fe1e08a361e3d05f941a71c5a0e526db6fd7fe3f';
export const PINNED_V2_CORPUS_SHA256 = 'f95f4b7cc154814e7f47deae9d96b0145022cbc1742033c17566ec2bc1eda042';
export const CANONICAL_FAKE_ADAPTER_RELATIVE_PATH = 'evals/tests/fixtures/fake-journey-benchmark-adapter.mjs';
export const PINNED_FAKE_ADAPTER_SHA256 = '64a9e2588c3633b14ce09cf9182bf10e66dd3cbe817ba011e5019fea3a09d59e';
export const BENCHMARK_SCHEMA_VERSION = '1.0.0';

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_RESULT_FILES = 10_000;
const MAX_RESULT_BYTES = 128 * 1024 * 1024;
const DEFAULT_ENVIRONMENT = Object.freeze({ LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin', TZ: 'UTC' });
const FORBIDDEN_ENVIRONMENT_ALLOWLIST_NAMES = new Set(['HOME', 'LANG', 'LC_ALL', 'PATH', 'TMPDIR', 'TZ']);
const CASE_GROUPS = Object.freeze([
  'community-regression',
  'natural-positive',
  'adjacent-negative',
  'malformed',
  'missing-tool',
  'authority-denied',
  'adversarial',
]);
const ACTIVATION_STATES = Object.freeze(['ACTIVATED', 'NOT_ACTIVATED', 'UNAVAILABLE']);
const RESULT_STATES = Object.freeze(['COMPLETED', 'EARLY_BLOCKED', 'ERROR']);
const EVIDENCE_MODES = Object.freeze(['FAKE_ADAPTER_TEST', 'PROVIDER_BACKED_UNVERIFIED']);

export class JourneyBenchmarkError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'JourneyBenchmarkError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new JourneyBenchmarkError(code, message, details);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function assertExactKeys(value, expected, label) {
  if (!exactKeys(value, expected)) {
    fail('SCHEMA_INVALID', `${label} keys must exactly match: ${[...expected].sort().join(', ')}`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOutsideRoot(relativePath) {
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function opaqueCaseId(caseId) {
  return `case-${sha256(Buffer.from(`${ACTIVE_CORPUS_ID}:${caseId}`, 'utf8')).slice(0, 24)}`;
}

function readJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail('FILE_UNAVAILABLE', `${label} cannot be read: ${error.message}`, { filePath });
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    fail('JSON_INVALID', `${label} is invalid JSON: ${error.message}`, { filePath });
  }
}

function validateIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(value)) {
    fail('SCHEMA_INVALID', `${label} must be a lowercase hyphenated identifier`);
  }
}

function validateStringArray(value, label, { min = 0, max = 20 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail('SCHEMA_INVALID', `${label} must contain ${min}-${max} strings`);
  }
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || !/^[a-z0-9][a-z0-9-]{1,79}$/u.test(entry)) {
      fail('SCHEMA_INVALID', `${label}[${index}] must be a lowercase behavior identifier`);
    }
    if (seen.has(entry)) fail('SCHEMA_INVALID', `${label} contains duplicate ${entry}`);
    seen.add(entry);
  }
}

export function validateCorpusDocument(corpus, raw = JSON.stringify(corpus)) {
  assertExactKeys(corpus, [
    'cases',
    'corpusId',
    'counts',
    'freezeStatus',
    'frozenOn',
    'qualification',
    'schemaVersion',
    'sealedCorpusRelationship',
    'workspaceFixtures',
  ], 'corpus');
  if (corpus.schemaVersion !== BENCHMARK_SCHEMA_VERSION) fail('SCHEMA_INVALID', 'corpus schemaVersion must be 1.0.0');
  if (corpus.corpusId !== 'programmable-community-journeys-v1') fail('SCHEMA_INVALID', 'unexpected corpusId');
  if (corpus.freezeStatus !== 'FROZEN_PUBLIC_AFTER_DESIGN') fail('SCHEMA_INVALID', 'corpus must remain frozen after design');
  if (corpus.frozenOn !== '2026-08-15') fail('SCHEMA_INVALID', 'corpus frozenOn date drifted');
  if (corpus.qualification !== 'PUBLIC_REGRESSION_AND_COMPARISON_CORPUS_NOT_BLIND_HOLDOUT') {
    fail('SCHEMA_INVALID', 'corpus qualification must remain explicitly non-blind');
  }
  if (corpus.sealedCorpusRelationship !== 'SEPARATE_NO_PLAINTEXT_OR_MEMBERSHIP_DERIVED') {
    fail('SEALED_CORPUS_BOUNDARY', 'public corpus must remain separate from the encrypted holdout');
  }
  if (/evals\/holdout|PROGRAMMABLE_E2E_HOLDOUT_KEY|ciphertext|authTag/iu.test(raw)) {
    fail('SEALED_CORPUS_BOUNDARY', 'public benchmark corpus must not reference sealed paths, keys, or envelope fields');
  }
  assertExactKeys(corpus.counts, [
    'adjacentNegatives',
    'adversarial',
    'authorityDenied',
    'cases',
    'communityRegressions',
    'malformed',
    'missingTool',
    'naturalEnglishGermanPrompts',
    'naturalPositives',
  ], 'corpus.counts');
  if (!Array.isArray(corpus.cases)) fail('SCHEMA_INVALID', 'corpus.cases must be an array');
  if (!Array.isArray(corpus.workspaceFixtures) || corpus.workspaceFixtures.length !== 1) {
    fail('SCHEMA_INVALID', 'corpus.workspaceFixtures must contain the single v1 existing-repository fixture');
  }
  const [workspaceFixture] = corpus.workspaceFixtures;
  assertExactKeys(workspaceFixture, ['caseIds', 'id', 'inventorySha256', 'source'], 'corpus.workspaceFixtures[0]');
  if (workspaceFixture.id !== 'existing-hook-repository-v1') fail('SCHEMA_INVALID', 'workspace fixture id drifted');
  if (workspaceFixture.source !== 'fixtures/existing-hook-repository-v1') fail('SCHEMA_INVALID', 'workspace fixture source drifted');
  if (!/^[0-9a-f]{64}$/u.test(workspaceFixture.inventorySha256)) fail('SCHEMA_INVALID', 'workspace fixture inventorySha256 is invalid');
  const requiredFixtureCases = ['repair-existing-hook-en', 'review-only-de', 'submission-preflight-de', 'upgrade-existing-hook-de'];
  if (canonicalJson(workspaceFixture.caseIds) !== canonicalJson(requiredFixtureCases)) {
    fail('SCHEMA_INVALID', 'workspace fixture caseIds must exactly bind the four existing-repository journeys');
  }

  const ids = new Set();
  const derivedGroups = Object.fromEntries(CASE_GROUPS.map((group) => [group, 0]));
  let naturalEnglishGermanPrompts = 0;
  for (const [index, benchmarkCase] of corpus.cases.entries()) {
    const label = `corpus.cases[${index}]`;
    assertExactKeys(benchmarkCase, ['expected', 'group', 'id', 'language', 'messages', 'rubric'], label);
    validateIdentifier(benchmarkCase.id, `${label}.id`);
    if (ids.has(benchmarkCase.id)) fail('SCHEMA_INVALID', `duplicate case id ${benchmarkCase.id}`);
    ids.add(benchmarkCase.id);
    if (!CASE_GROUPS.includes(benchmarkCase.group)) fail('SCHEMA_INVALID', `${label}.group is unsupported`);
    derivedGroups[benchmarkCase.group] += 1;
    if (!['en', 'de'].includes(benchmarkCase.language)) fail('SCHEMA_INVALID', `${label}.language must be en or de`);
    if (!Array.isArray(benchmarkCase.messages) || benchmarkCase.messages.length < 1 || benchmarkCase.messages.length > 2) {
      fail('SCHEMA_INVALID', `${label}.messages must contain one or two user turns`);
    }
    for (const [messageIndex, message] of benchmarkCase.messages.entries()) {
      assertExactKeys(message, ['content', 'role'], `${label}.messages[${messageIndex}]`);
      if (message.role !== 'user') fail('SCHEMA_INVALID', `${label}.messages[${messageIndex}].role must be user`);
      if (typeof message.content !== 'string' || message.content.length < 12 || message.content.length > 1_500 || /\0/u.test(message.content)) {
        fail('SCHEMA_INVALID', `${label}.messages[${messageIndex}].content is outside the 12-1500 byte-safe character envelope`);
      }
    }
    if (typeof benchmarkCase.rubric !== 'string' || benchmarkCase.rubric.length < 40 || benchmarkCase.rubric.length > 1_200) {
      fail('SCHEMA_INVALID', `${label}.rubric must contain 40-1200 characters`);
    }
    assertExactKeys(benchmarkCase.expected, [
      'activation',
      'externalEffects',
      'forbiddenBehaviors',
      'maxMaterialOwnerDecisions',
      'outcome',
      'requiredBehaviors',
    ], `${label}.expected`);
    if (!['ACTIVATED', 'NOT_ACTIVATED'].includes(benchmarkCase.expected.activation)) {
      fail('SCHEMA_INVALID', `${label}.expected.activation is unsupported`);
    }
    if (typeof benchmarkCase.expected.outcome !== 'string' || !/^[A-Z][A-Z0-9_]{2,79}$/u.test(benchmarkCase.expected.outcome)) {
      fail('SCHEMA_INVALID', `${label}.expected.outcome must be an uppercase state`);
    }
    if (![0, 1].includes(benchmarkCase.expected.maxMaterialOwnerDecisions)) {
      fail('SCHEMA_INVALID', `${label}.expected.maxMaterialOwnerDecisions must be zero or one`);
    }
    if (benchmarkCase.expected.externalEffects !== 'NONE') {
      fail('SCHEMA_INVALID', `${label}.expected.externalEffects must remain NONE`);
    }
    validateStringArray(benchmarkCase.expected.requiredBehaviors, `${label}.expected.requiredBehaviors`, { min: 1 });
    validateStringArray(benchmarkCase.expected.forbiddenBehaviors, `${label}.expected.forbiddenBehaviors`, { min: 1 });
    if (benchmarkCase.group === 'natural-positive' || benchmarkCase.group === 'adjacent-negative') {
      naturalEnglishGermanPrompts += 1;
    }
  }

  const derived = {
    cases: corpus.cases.length,
    communityRegressions: derivedGroups['community-regression'],
    naturalEnglishGermanPrompts,
    naturalPositives: derivedGroups['natural-positive'],
    adjacentNegatives: derivedGroups['adjacent-negative'],
    malformed: derivedGroups.malformed,
    missingTool: derivedGroups['missing-tool'],
    authorityDenied: derivedGroups['authority-denied'],
    adversarial: derivedGroups.adversarial,
  };
  if (canonicalJson(derived) !== canonicalJson(corpus.counts)) {
    fail('SCHEMA_INVALID', 'corpus.counts does not match the derived case inventory', { expected: derived, actual: corpus.counts });
  }
  if (naturalEnglishGermanPrompts < 15 || naturalEnglishGermanPrompts > 20) {
    fail('SCHEMA_INVALID', 'natural English/German prompt count must remain within 15-20');
  }
  if (derived.communityRegressions !== 1 || derived.malformed < 2 || derived.missingTool < 1 || derived.authorityDenied < 1 || derived.adversarial < 1) {
    fail('SCHEMA_INVALID', 'corpus is missing a required complaint, malformed, missing-tool, authority, or adversarial group');
  }
  const mizu = corpus.cases.find(({ id }) => id === 'mizu-design-then-implement');
  if (!mizu || mizu.messages.length !== 2) fail('SCHEMA_INVALID', 'exact Mizu design-to-implementation regression is missing');
  const mizuText = mizu.messages.map(({ content }) => content).join('\n');
  for (const requiredText of ['directional', 'size-sensitive', 'decaying', 'Use the skill to implement']) {
    if (!mizuText.includes(requiredText)) fail('SCHEMA_INVALID', `Mizu regression is missing ${requiredText}`);
  }
  for (const caseId of requiredFixtureCases) {
    if (!ids.has(caseId)) fail('SCHEMA_INVALID', `workspace fixture references missing case ${caseId}`);
  }
  const deployAuthority = corpus.cases.find(({ id }) => id === 'deploy-authority-denied');
  const githubAuthority = corpus.cases.find(({ id }) => id === 'github-authority-denied-de');
  if (!deployAuthority.messages[0].content.includes('no signing wallet') || !deployAuthority.messages[0].content.includes('transaction authority')) {
    fail('SCHEMA_INVALID', 'deployment authority case must state that signing authority is unavailable');
  }
  if (!/fehlen.*Credentials.*Schreibrechte.*Review.*Maintainer-Freigabe/iu.test(githubAuthority.messages[0].content)) {
    fail('SCHEMA_INVALID', 'GitHub authority case must state that credentials and maintainer authority are unavailable');
  }
  if (/deploy it|pushe danach|öffne direkt|merge ihn/iu.test(`${deployAuthority.messages[0].content}\n${githubAuthority.messages[0].content}`)) {
    fail('SCHEMA_INVALID', 'authority-denied fixtures must not themselves authorize an external write');
  }
  return { caseCount: corpus.cases.length, counts: derived };
}

function validateCorpusOverlayDocument(overlay, raw, baseCorpus) {
  assertExactKeys(overlay, [
    'baseCorpus',
    'corpusId',
    'executionPolicies',
    'freezeStatus',
    'frozenOn',
    'kind',
    'messageOverrides',
    'qualification',
    'schemaVersion',
    'sealedCorpusRelationship',
  ], 'corpus overlay');
  if (
    overlay.schemaVersion !== BENCHMARK_SCHEMA_VERSION
    || overlay.kind !== 'programmable-community-journey-corpus-overlay'
    || overlay.corpusId !== ACTIVE_CORPUS_ID
    || overlay.freezeStatus !== 'FROZEN_PUBLIC_AFTER_DESIGN'
    || overlay.frozenOn !== '2026-08-15'
    || overlay.qualification !== 'PUBLIC_REGRESSION_AND_COMPARISON_CORPUS_NOT_BLIND_HOLDOUT'
    || overlay.sealedCorpusRelationship !== 'SEPARATE_NO_PLAINTEXT_OR_MEMBERSHIP_DERIVED'
  ) fail('SCHEMA_INVALID', 'active corpus overlay identity drifted');
  if (/evals\/holdout|PROGRAMMABLE_E2E_HOLDOUT_KEY|ciphertext|authTag/iu.test(raw)) {
    fail('SEALED_CORPUS_BOUNDARY', 'public benchmark overlay must not reference sealed paths, keys, or envelope fields');
  }
  assertExactKeys(overlay.baseCorpus, ['corpusId', 'path', 'sha256'], 'corpus overlay.baseCorpus');
  if (
    overlay.baseCorpus.corpusId !== 'programmable-community-journeys-v1'
    || overlay.baseCorpus.path !== BASE_CORPUS_V1_RELATIVE_PATH
    || overlay.baseCorpus.sha256 !== PINNED_V1_CORPUS_SHA256
  ) fail('SCHEMA_INVALID', 'active corpus overlay must bind the immutable v1 base');
  if (!Array.isArray(overlay.executionPolicies) || overlay.executionPolicies.length !== 1) {
    fail('SCHEMA_INVALID', 'active corpus overlay must contain exactly one case execution policy');
  }
  const [policy] = overlay.executionPolicies;
  assertExactKeys(policy, [
    'caseIds',
    'deniedExecutables',
    'fakeQualification',
    'id',
    'mode',
    'providerReceipt',
  ], 'corpus overlay.executionPolicies[0]');
  if (
    policy.id !== 'forge-unavailable-v1'
    || canonicalJson(policy.caseIds) !== canonicalJson(['missing-foundry-tool'])
    || policy.mode !== 'deny-exec'
    || canonicalJson(policy.deniedExecutables) !== canonicalJson(['forge'])
    || policy.providerReceipt !== 'REQUIRED'
    || policy.fakeQualification !== 'SIMULATED_NOT_ENFORCED'
    || !baseCorpus.cases.some(({ id }) => id === 'missing-foundry-tool')
  ) fail('SCHEMA_INVALID', 'Forge-unavailable execution policy drifted or lost its case binding');
  if (!Array.isArray(overlay.messageOverrides) || overlay.messageOverrides.length !== 1) {
    fail('SCHEMA_INVALID', 'active corpus overlay must contain exactly one message override');
  }
  const [messageOverride] = overlay.messageOverrides;
  assertExactKeys(messageOverride, ['caseId', 'content', 'turn'], 'corpus overlay.messageOverrides[0]');
  if (
    messageOverride.caseId !== 'missing-foundry-tool'
    || messageOverride.turn !== 1
    || typeof messageOverride.content !== 'string'
    || messageOverride.content.length < 12
    || messageOverride.content.length > 1_500
    || !messageOverride.content.includes('case-bound sandbox policy disables Forge execution')
    || /unavailable on this machine/iu.test(messageOverride.content)
  ) fail('SCHEMA_INVALID', 'Forge-unavailable message override drifted');
  return overlay;
}

function validateCompanionDigest(digestPath, actualDigest, label) {
  let digestRaw;
  try {
    digestRaw = fs.readFileSync(digestPath, 'utf8');
  } catch (error) {
    fail('CORPUS_DIGEST_MISSING', `${label} digest cannot be read: ${error.message}`, { digestPath });
  }
  const digestMatch = digestRaw.match(/^([0-9a-f]{64})  corpus\.json\n$/u);
  if (!digestMatch) fail('CORPUS_DIGEST_INVALID', `${label} corpus.sha256 must use sha256sum format for corpus.json`);
  if (digestMatch[1] !== actualDigest) {
    fail('CORPUS_DIGEST_DRIFT', `${label} bytes do not match corpus.sha256`, {
      expected: digestMatch[1],
      actual: actualDigest,
    });
  }
}

export function loadFrozenCorpus({ repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  const corpusPath = path.join(repositoryRoot, CORPUS_RELATIVE_PATH);
  const digestPath = path.join(repositoryRoot, CORPUS_DIGEST_RELATIVE_PATH);
  const baseCorpusPath = path.join(repositoryRoot, BASE_CORPUS_V1_RELATIVE_PATH);
  const baseDigestPath = path.join(repositoryRoot, BASE_CORPUS_V1_DIGEST_RELATIVE_PATH);
  const versionAuthorityPath = path.join(repositoryRoot, CORPUS_VERSION_AUTHORITY_RELATIVE_PATH);
  const baseDocument = readJson(baseCorpusPath, 'journey benchmark v1 base corpus');
  const baseDigest = sha256(Buffer.from(baseDocument.raw, 'utf8'));
  if (baseDigest !== PINNED_V1_CORPUS_SHA256) {
    fail('CORPUS_VERSION_IMMUTABLE', 'v1 corpus bytes changed; restore v1 and add a new overlay version instead', {
      expected: PINNED_V1_CORPUS_SHA256,
      actual: baseDigest,
    });
  }
  const validation = validateCorpusDocument(baseDocument.value, baseDocument.raw);
  const { raw, value } = readJson(corpusPath, 'journey benchmark active corpus overlay');
  const actualDigest = sha256(Buffer.from(raw, 'utf8'));
  if (actualDigest !== PINNED_V2_CORPUS_SHA256) {
    fail('CORPUS_VERSION_IMMUTABLE', 'v2 corpus overlay bytes changed; restore v2 and add a new overlay version instead', {
      expected: PINNED_V2_CORPUS_SHA256,
      actual: actualDigest,
    });
  }
  validateCorpusOverlayDocument(value, raw, baseDocument.value);
  const versionAuthority = readJson(versionAuthorityPath, 'journey benchmark corpus version authority');
  assertExactKeys(versionAuthority.value, ['kind', 'policy', 'schemaVersion', 'versions'], 'corpus version authority');
  if (
    versionAuthority.value.schemaVersion !== BENCHMARK_SCHEMA_VERSION
    || versionAuthority.value.kind !== 'programmable-journey-corpus-version-authority'
    || versionAuthority.value.policy !== 'APPEND_ONLY_NEW_VERSION_REQUIRED_FOR_BYTE_CHANGES'
    || !Array.isArray(versionAuthority.value.versions)
    || versionAuthority.value.versions.length !== 2
  ) fail('CORPUS_VERSION_AUTHORITY_INVALID', 'corpus version authority identity or policy drifted');
  const [v1Authority, v2Authority] = versionAuthority.value.versions;
  assertExactKeys(v1Authority, ['corpusId', 'path', 'sha256', 'status', 'version'], 'corpus version authority v1');
  assertExactKeys(v2Authority, ['corpusId', 'path', 'sha256', 'status', 'version'], 'corpus version authority v2');
  if (
    v1Authority.version !== 'v1'
    || v1Authority.corpusId !== 'programmable-community-journeys-v1'
    || v1Authority.path !== BASE_CORPUS_V1_RELATIVE_PATH
    || v1Authority.status !== 'IMMUTABLE'
    || v1Authority.sha256 !== PINNED_V1_CORPUS_SHA256
    || v2Authority.version !== 'v2'
    || v2Authority.corpusId !== ACTIVE_CORPUS_ID
    || v2Authority.path !== CORPUS_RELATIVE_PATH
    || v2Authority.status !== 'IMMUTABLE'
    || v2Authority.sha256 !== PINNED_V2_CORPUS_SHA256
  ) fail('CORPUS_VERSION_AUTHORITY_INVALID', 'corpus version authority drifted; preserve published versions and append a new one');
  validateCompanionDigest(baseDigestPath, baseDigest, 'v1 base corpus');
  validateCompanionDigest(digestPath, actualDigest, 'v2 corpus overlay');
  const workspaceFixtures = baseDocument.value.workspaceFixtures.map((fixture) => {
    const fixtureRoot = path.resolve(path.dirname(baseCorpusPath), fixture.source);
    const relativeFixture = path.relative(path.dirname(baseCorpusPath), fixtureRoot);
    if (isOutsideRoot(relativeFixture) || relativeFixture === '') fail('CORPUS_FIXTURE_INVALID', `workspace fixture ${fixture.id} escapes the corpus version root`);
    const inventory = inventoryDirectory(fixtureRoot);
    if (inventory.inventorySha256 !== fixture.inventorySha256) {
      fail('CORPUS_FIXTURE_DRIFT', `workspace fixture ${fixture.id} does not match its corpus-bound inventory`, {
        expected: fixture.inventorySha256,
        actual: inventory.inventorySha256,
      });
    }
    return { ...fixture, root: fixtureRoot, inventory };
  });
  const executionPolicies = value.executionPolicies.map((policy) => ({
    ...policy,
    policySha256: sha256(canonicalJson({ mode: policy.mode, deniedExecutables: policy.deniedExecutables })),
  }));
  const cases = baseDocument.value.cases.map((benchmarkCase) => {
    const override = value.messageOverrides.find(({ caseId }) => caseId === benchmarkCase.id);
    if (!override) return benchmarkCase;
    return {
      ...benchmarkCase,
      messages: benchmarkCase.messages.map((message, index) => (
        index + 1 === override.turn ? { ...message, content: override.content } : message
      )),
    };
  });
  const corpus = {
    ...baseDocument.value,
    baseCorpus: value.baseCorpus,
    cases,
    corpusId: value.corpusId,
    executionPolicies: value.executionPolicies,
    frozenOn: value.frozenOn,
    freezeStatus: value.freezeStatus,
    qualification: value.qualification,
    sealedCorpusRelationship: value.sealedCorpusRelationship,
  };
  return {
    corpus,
    corpusPath,
    corpusSha256: actualDigest,
    baseCorpusPath,
    baseCorpusSha256: baseDigest,
    executionPolicies,
    versionAuthorityPath,
    versionAuthoritySha256: sha256(Buffer.from(versionAuthority.raw, 'utf8')),
    workspaceFixtures,
    ...validation,
  };
}

function permissionMode(stat) {
  return stat.mode & 0o7777;
}

function walkInventory(root, relativeDirectory, rows, tree, totals) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const normalizedPath = relativePath.split(path.sep).join('/');
    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) fail('INVENTORY_SYMLINK', `symlink is forbidden in benchmark inventory: ${normalizedPath}`);
    if (stat.isDirectory()) {
      tree.push({ path: normalizedPath, type: 'directory', mode: permissionMode(stat) });
      walkInventory(root, relativePath, rows, tree, totals);
    } else if (stat.isFile()) {
      totals.files += 1;
      totals.bytes += stat.size;
      if (totals.files > MAX_RESULT_FILES) fail('INVENTORY_LIMIT', `inventory exceeds ${MAX_RESULT_FILES} files`);
      if (totals.bytes > MAX_RESULT_BYTES) fail('INVENTORY_LIMIT', `inventory exceeds ${MAX_RESULT_BYTES} bytes`);
      const file = { path: normalizedPath, bytes: stat.size, sha256: sha256(fs.readFileSync(absolutePath)) };
      rows.push(file);
      tree.push({ ...file, type: 'file', mode: permissionMode(stat) });
    } else {
      fail('INVENTORY_SPECIAL_FILE', `special file is forbidden in benchmark inventory: ${normalizedPath}`);
    }
  }
}

export function inventoryDirectory(root) {
  const absoluteRoot = path.resolve(root);
  const stat = fs.lstatSync(absoluteRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INVENTORY_ROOT_INVALID', 'inventory root must be a real directory');
  const files = [];
  const tree = [{ path: '.', type: 'directory', mode: permissionMode(stat) }];
  const totals = { files: 0, bytes: 0 };
  walkInventory(absoluteRoot, '', files, tree, totals);
  return {
    files,
    fileCount: totals.files,
    totalBytes: totals.bytes,
    inventorySha256: sha256(Buffer.from(canonicalJson(files), 'utf8')),
    tree,
    treeSha256: sha256(Buffer.from(canonicalJson(tree), 'utf8')),
  };
}

function assertAbsoluteDirectory(directoryPath, label) {
  if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) fail('CONFIG_INVALID', `${label} must be absolute`);
  let stat;
  try {
    stat = fs.lstatSync(directoryPath);
  } catch (error) {
    fail('CONFIG_INVALID', `${label} is unavailable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('CONFIG_INVALID', `${label} must be a real directory`);
}

function validateArgv(argv, label) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 20) fail('CONFIG_INVALID', `${label} must contain 1-20 argv entries`);
  for (const [index, value] of argv.entries()) {
    if (typeof value !== 'string' || value === '' || value.length > 2_000 || /\0/u.test(value)) {
      fail('CONFIG_INVALID', `${label}[${index}] is invalid`);
    }
  }
  if (!path.isAbsolute(argv[0])) fail('CONFIG_INVALID', `${label}[0] must be an absolute executable path`);
  let executableStat;
  try {
    executableStat = fs.lstatSync(argv[0]);
  } catch (error) {
    fail('CONFIG_INVALID', `${label}[0] is unavailable: ${error.message}`);
  }
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) fail('CONFIG_INVALID', `${label}[0] must be a real executable file`);
  if ((executableStat.mode & 0o111) === 0) fail('CONFIG_INVALID', `${label}[0] is not executable`);
  if (argv.some((value) => value === '--request' || value.startsWith('--request=') || value === '--output' || value.startsWith('--output='))) {
    fail('CONFIG_INVALID', `${label} must not predeclare harness-owned --request or --output flags`);
  }
}

function commandIdentity(argv) {
  const files = [];
  for (const [index, argument] of argv.entries()) {
    if (!path.isAbsolute(argument) || !fs.existsSync(argument)) continue;
    const stat = fs.lstatSync(argument);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('CONFIG_INVALID', `adapter argv[${index}] absolute input must be a real file`);
    const bytes = fs.readFileSync(argument);
    files.push({ argvIndex: index, path: argument, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return {
    argvSha256: sha256(Buffer.from(canonicalJson(argv), 'utf8')),
    files,
    filesSha256: sha256(Buffer.from(canonicalJson(files), 'utf8')),
  };
}

function validateCanonicalFakeAdapterMatrix(config, repositoryRoot) {
  if (config.evidenceMode !== 'FAKE_ADAPTER_TEST') return null;
  const adapterPath = path.join(repositoryRoot, CANONICAL_FAKE_ADAPTER_RELATIVE_PATH);
  const expectedArgv = [process.execPath, adapterPath];
  const configuredCommands = [
    ...config.subjects.map(({ adapterArgv }) => adapterArgv),
    config.judge.adapterArgv,
  ];
  if (configuredCommands.some((argv) => canonicalJson(argv) !== canonicalJson(expectedArgv))) {
    fail('FAKE_ADAPTER_PIN_MISMATCH', 'FAKE_ADAPTER_TEST accepts only the exact canonical fixture adapter and interpreter with no options');
  }
  const adapterBytes = fs.readFileSync(adapterPath);
  if (sha256(adapterBytes) !== PINNED_FAKE_ADAPTER_SHA256) {
    fail('FAKE_ADAPTER_PIN_MISMATCH', 'canonical fake adapter bytes drifted from the independent pin');
  }
  const interpreterBytes = fs.readFileSync(process.execPath);
  return {
    argvSha256: sha256(canonicalJson(expectedArgv)),
    adapterPath: CANONICAL_FAKE_ADAPTER_RELATIVE_PATH,
    adapterSha256: PINNED_FAKE_ADAPTER_SHA256,
    interpreterPath: process.execPath,
    interpreterSha256: sha256(interpreterBytes),
  };
}

function validateHost(host, label) {
  assertExactKeys(host, ['model', 'name', 'provider', 'version'], label);
  for (const key of ['model', 'name', 'provider', 'version']) {
    if (typeof host[key] !== 'string' || host[key].length < 1 || host[key].length > 200 || /[\r\n\0]/u.test(host[key])) {
      fail('CONFIG_INVALID', `${label}.${key} is invalid`);
    }
  }
}

export function validateBenchmarkConfig(config) {
  assertExactKeys(config, [
    'concurrency',
    'environmentAllowlist',
    'evidenceMode',
    'judge',
    'repetitions',
    'schemaVersion',
    'sandbox',
    'subjects',
    'timeoutMs',
  ], 'benchmark config');
  if (config.schemaVersion !== BENCHMARK_SCHEMA_VERSION) fail('CONFIG_INVALID', 'benchmark config schemaVersion must be 1.0.0');
  if (!EVIDENCE_MODES.includes(config.evidenceMode)) fail('CONFIG_INVALID', `evidenceMode must be one of ${EVIDENCE_MODES.join(', ')}`);
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 4) fail('CONFIG_INVALID', 'concurrency must be 1-4');
  if (!Number.isInteger(config.repetitions) || config.repetitions < 1 || config.repetitions > 5) fail('CONFIG_INVALID', 'repetitions must be 1-5');
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 3_600_000) fail('CONFIG_INVALID', 'timeoutMs must be 1000-3600000');
  if (!Array.isArray(config.environmentAllowlist) || config.environmentAllowlist.length > 20) fail('CONFIG_INVALID', 'environmentAllowlist must contain 0-20 names');
  const environmentNames = new Set();
  for (const [index, name] of config.environmentAllowlist.entries()) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{1,79}$/u.test(name)) fail('CONFIG_INVALID', `environmentAllowlist[${index}] is invalid`);
    if (environmentNames.has(name)) fail('CONFIG_INVALID', `environmentAllowlist repeats ${name}`);
    if (FORBIDDEN_ENVIRONMENT_ALLOWLIST_NAMES.has(name)) fail('CONFIG_INVALID', `environmentAllowlist cannot inherit caller ${name}`);
    environmentNames.add(name);
  }
  if (!Array.isArray(config.subjects) || config.subjects.length < 2 || config.subjects.length > 8) {
    fail('CONFIG_INVALID', 'subjects must contain 2-8 baseline, candidate, or competitor entries');
  }
  const subjectIds = new Set();
  const roles = [];
  for (const [index, subject] of config.subjects.entries()) {
    const label = `subjects[${index}]`;
    assertExactKeys(subject, ['adapterArgv', 'host', 'id', 'role', 'skillPath'], label);
    validateIdentifier(subject.id, `${label}.id`);
    if (subjectIds.has(subject.id)) fail('CONFIG_INVALID', `duplicate subject id ${subject.id}`);
    subjectIds.add(subject.id);
    if (!['baseline', 'candidate', 'competitor'].includes(subject.role)) fail('CONFIG_INVALID', `${label}.role is invalid`);
    roles.push(subject.role);
    assertAbsoluteDirectory(subject.skillPath, `${label}.skillPath`);
    if (!fs.existsSync(path.join(subject.skillPath, 'SKILL.md'))) fail('CONFIG_INVALID', `${label}.skillPath has no SKILL.md`);
    validateArgv(subject.adapterArgv, `${label}.adapterArgv`);
    validateHost(subject.host, `${label}.host`);
  }
  if (roles.filter((role) => role === 'baseline').length !== 1 || roles.filter((role) => role === 'candidate').length !== 1) {
    fail('CONFIG_INVALID', 'subjects must contain exactly one baseline and one candidate');
  }
  assertExactKeys(config.judge, ['adapterArgv', 'host'], 'judge');
  validateArgv(config.judge.adapterArgv, 'judge.adapterArgv');
  validateHost(config.judge.host, 'judge.host');
  if (config.subjects.some(({ host }) => host.model === config.judge.host.model)) {
    fail('CONFIG_INVALID', 'judge model must differ from every subject model');
  }
  if (config.sandbox !== null) {
    assertExactKeys(config.sandbox, ['contractPath', 'deniedSentinelPath', 'wrapperArgv'], 'sandbox');
    validateArgv(config.sandbox.wrapperArgv, 'sandbox.wrapperArgv');
    for (const key of ['contractPath', 'deniedSentinelPath']) {
      if (typeof config.sandbox[key] !== 'string' || !path.isAbsolute(config.sandbox[key])) {
        fail('CONFIG_INVALID', `sandbox.${key} must be an absolute external file`);
      }
    }
  }
  if (config.evidenceMode === 'FAKE_ADAPTER_TEST' && config.sandbox !== null) {
    fail('CONFIG_INVALID', 'FAKE_ADAPTER_TEST must not claim or invoke the provider sandbox');
  }
  return config;
}

function restrictedEnvironment(allowlist, extra) {
  const environment = { ...DEFAULT_ENVIRONMENT };
  for (const name of allowlist) {
    if (Object.hasOwn(process.env, name)) environment[name] = process.env[name];
  }
  return { ...environment, ...extra };
}

function providerSecretEnvironment(allowlist) {
  const secrets = {};
  for (const name of allowlist) {
    if (!Object.hasOwn(process.env, name)) fail('PROVIDER_SECRET_ENV_MISSING', `configured provider secret environment is unavailable: ${name}`);
    const value = process.env[name];
    if (typeof value !== 'string' || value.length < 1 || value.length > 16_384 || value.includes('\0')) {
      fail('PROVIDER_SECRET_ENV_INVALID', `configured provider secret environment is invalid: ${name}`);
    }
    secrets[name] = value;
  }
  return secrets;
}

export function assertSecretValuesAbsent(root, secretEnvironment) {
  const secrets = Object.entries(secretEnvironment).map(([name, value]) => ({ name, bytes: Buffer.from(value, 'utf8') }));
  if (secrets.length === 0 || !fs.existsSync(root)) return;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, filePath);
      const pathMatch = secrets.find(({ bytes: secret }) => Buffer.from(relativePath, 'utf8').includes(secret));
      if (pathMatch) fail('SECRET_PERSISTENCE_DETECTED', `provider secret value was used in a result-bundle path`, { name: pathMatch.name });
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(filePath, { encoding: 'buffer' });
        const match = secrets.find(({ bytes: secret }) => linkTarget.includes(secret));
        if (match) fail('SECRET_PERSISTENCE_DETECTED', `provider secret value was written to a result-bundle symlink target by ${relativePath}`, { name: match.name });
        continue;
      }
      if (stat.isDirectory()) {
        visit(filePath);
      } else if (stat.isFile()) {
        const bytes = fs.readFileSync(filePath);
        const match = secrets.find(({ bytes: secret }) => bytes.includes(secret));
        if (match) fail('SECRET_PERSISTENCE_DETECTED', `provider secret value was written to the result bundle by ${relativePath}`, { name: match.name });
      }
    }
  };
  visit(root);
}

function writeNewJson(filePath, value, mode = 0o600) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode });
}

function parseAdapterOutput(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail('FILE_UNAVAILABLE', `${label} cannot be inspected: ${error.message}`, { filePath });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('ADAPTER_RESULT_INVALID', `${label} must be a real file`);
  const { value, raw } = readJson(filePath, label);
  return { value, sha256: sha256(Buffer.from(raw, 'utf8')), bytes: Buffer.byteLength(raw) };
}

function fileIdentity(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('REQUEST_MUTATED', `${label} is no longer a real file`);
  const bytes = fs.readFileSync(filePath);
  return { bytes: bytes.length, mode: permissionMode(stat), sha256: sha256(bytes) };
}

function assertFileUnchanged(filePath, expectedIdentity, label) {
  const actualIdentity = fileIdentity(filePath, label);
  if (canonicalJson(actualIdentity) !== canonicalJson(expectedIdentity)) {
    fail('REQUEST_MUTATED', `${label} content or permission mode changed during adapter execution`);
  }
}

function runAdapter(argv, requestPath, outputPath, options) {
  if (options.sandbox) {
    const started = Date.now();
    const { child, sandboxReceipt } = spawnIsolated({
      sandbox: options.sandbox,
      role: options.role,
      command: argv[0],
      args: [...argv.slice(1), '--request', requestPath, '--output', outputPath],
      cwd: options.cwd,
      env: options.env,
      secretEnvironment: options.secretEnvironment,
      toolPolicy: options.toolPolicy,
      controlDirectory: options.controlDirectory,
      timeout: options.timeoutMs,
      maxBuffer: MAX_CAPTURE_BYTES,
    });
    const stdout = Buffer.from(child.stdout ?? '', 'utf8');
    const stderr = Buffer.from(child.stderr ?? '', 'utf8');
    return Promise.resolve({
      captureExceeded: stdout.length > MAX_CAPTURE_BYTES || stderr.length > MAX_CAPTURE_BYTES,
      durationMs: Date.now() - started,
      exitCode: child.status,
      signal: child.signal,
      stderr: { bytes: stderr.length, sha256: sha256(stderr) },
      stdout: { bytes: stdout.length, sha256: sha256(stdout) },
      timedOut: child.error?.code === 'ETIMEDOUT',
      sandboxReceipt,
    });
  }
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(argv[0], [...argv.slice(1), '--request', requestPath, '--output', outputPath], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let captureExceeded = false;
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_CAPTURE_BYTES) {
        captureExceeded = true;
        child.kill('SIGKILL');
        return next.subarray(0, MAX_CAPTURE_BYTES);
      }
      return next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new JourneyBenchmarkError('ADAPTER_START_FAILED', error.message));
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        captureExceeded,
        durationMs: Date.now() - started,
        exitCode,
        signal,
        stderr: { bytes: stderr.length, sha256: sha256(stderr) },
        stdout: { bytes: stdout.length, sha256: sha256(stdout) },
        timedOut,
        sandboxReceipt: {
          role: options.role,
          isolation: 'local-same-uid-unrestricted',
          processTreeReaped: false,
          externalWritesDenied: false,
          trustedExternalAttestation: false,
        },
      });
    });
  });
}

function validateProvider(actual, expected, label) {
  assertExactKeys(actual, ['host', 'invocationId', 'model', 'provider'], label);
  for (const key of ['host', 'model', 'provider']) {
    if (actual[key] !== expected[key === 'host' ? 'name' : key]) fail('ADAPTER_RESULT_INVALID', `${label}.${key} does not match configured identity`);
  }
  if (typeof actual.invocationId !== 'string' || actual.invocationId.length < 4 || actual.invocationId.length > 300) {
    fail('ADAPTER_RESULT_INVALID', `${label}.invocationId is invalid`);
  }
}

function validateNullableMetric(value, label) {
  if (value !== null && (!Number.isInteger(value) || value < 0)) fail('ADAPTER_RESULT_INVALID', `${label} must be a nonnegative integer or null`);
}

function validateSubjectResult(result, context) {
  assertExactKeys(result, ['activation', 'caseId', 'effects', 'provider', 'requestSha256', 'result', 'schemaVersion', 'subjectId', 'telemetry'], 'subject result');
  if (result.schemaVersion !== BENCHMARK_SCHEMA_VERSION) fail('ADAPTER_RESULT_INVALID', 'subject result schemaVersion must be 1.0.0');
  if (result.requestSha256 !== context.requestSha256 || result.caseId !== context.caseId || result.subjectId !== context.subjectId) {
    fail('ADAPTER_RESULT_INVALID', 'subject result identity does not match its request');
  }
  validateProvider(result.provider, context.host, 'subject result.provider');
  assertExactKeys(result.activation, ['evidence', 'loadedReferences', 'observed', 'traceSha256', 'turns'], 'subject result.activation');
  if (!ACTIVATION_STATES.includes(result.activation.observed)) fail('ADAPTER_RESULT_INVALID', 'subject activation state is invalid');
  if (!['HOST_TRACE', 'ADAPTER_REPORTED', 'UNAVAILABLE'].includes(result.activation.evidence)) fail('ADAPTER_RESULT_INVALID', 'subject activation evidence is invalid');
  if (result.activation.traceSha256 !== null && !/^[0-9a-f]{64}$/u.test(result.activation.traceSha256)) fail('ADAPTER_RESULT_INVALID', 'activation traceSha256 is invalid');
  if (!Array.isArray(result.activation.turns) || result.activation.turns.length !== 1) fail('ADAPTER_RESULT_INVALID', 'each subject invocation must report exactly its current turn');
  const [activationTurn] = result.activation.turns;
  assertExactKeys(activationTurn, ['decision', 'turn'], 'subject result.activation.turns[0]');
  if (activationTurn.turn !== context.turnIndex || !ACTIVATION_STATES.includes(activationTurn.decision)) fail('ADAPTER_RESULT_INVALID', `activation turn ${context.turnIndex} is invalid`);
  if (activationTurn.decision !== result.activation.observed) fail('ADAPTER_RESULT_INVALID', 'activation observed state must match the current turn decision');
  if (!Array.isArray(result.activation.loadedReferences) || result.activation.loadedReferences.length > 100) fail('ADAPTER_RESULT_INVALID', 'loadedReferences must contain 0-100 entries');
  const referencePaths = new Set();
  for (const [index, reference] of result.activation.loadedReferences.entries()) {
    assertExactKeys(reference, ['bytes', 'path', 'phase', 'reason', 'sha256'], `loadedReferences[${index}]`);
    if (typeof reference.path !== 'string' || reference.path.startsWith('/') || reference.path.split('/').includes('..') || reference.path.includes('\\')) fail('ADAPTER_RESULT_INVALID', `loadedReferences[${index}].path is unsafe`);
    if (referencePaths.has(reference.path)) fail('ADAPTER_RESULT_INVALID', `duplicate loaded reference ${reference.path}`);
    referencePaths.add(reference.path);
    const expectedReference = context.skillFiles.get(reference.path);
    if (!expectedReference || expectedReference.sha256 !== reference.sha256 || expectedReference.bytes !== reference.bytes) {
      fail('ADAPTER_RESULT_INVALID', `loaded reference ${reference.path} does not match the frozen skill inventory`);
    }
    if (!['trigger', 'cold', 'task'].includes(reference.phase)) fail('ADAPTER_RESULT_INVALID', `loadedReferences[${index}].phase is invalid`);
    if (typeof reference.reason !== 'string' || reference.reason.length < 3 || reference.reason.length > 300) fail('ADAPTER_RESULT_INVALID', `loadedReferences[${index}].reason is invalid`);
  }
  if (result.activation.observed === 'ACTIVATED' && result.activation.loadedReferences.length === 0) {
    fail('ADAPTER_RESULT_INVALID', 'an activated turn must bind at least one loaded skill reference');
  }
  if (result.activation.observed !== 'ACTIVATED' && result.activation.loadedReferences.length !== 0) {
    fail('ADAPTER_RESULT_INVALID', 'a non-activated or unavailable turn must not report loaded skill references');
  }
  assertExactKeys(result.result, ['materialOwnerDecisions', 'outcome', 'responseText', 'status', 'useful'], 'subject result.result');
  if (!RESULT_STATES.includes(result.result.status)) fail('ADAPTER_RESULT_INVALID', 'subject result status is invalid');
  if (typeof result.result.outcome !== 'string' || !/^[A-Z][A-Z0-9_]{2,79}$/u.test(result.result.outcome)) fail('ADAPTER_RESULT_INVALID', 'subject outcome is invalid');
  if (typeof result.result.responseText !== 'string' || result.result.responseText.length < 1 || result.result.responseText.length > 200_000) fail('ADAPTER_RESULT_INVALID', 'subject responseText is invalid');
  if (typeof result.result.useful !== 'boolean') fail('ADAPTER_RESULT_INVALID', 'subject useful must be boolean');
  if (!Number.isInteger(result.result.materialOwnerDecisions) || result.result.materialOwnerDecisions < 0 || result.result.materialOwnerDecisions > 20) fail('ADAPTER_RESULT_INVALID', 'materialOwnerDecisions is invalid');
  assertExactKeys(result.telemetry, ['elapsedMs', 'inputTokens', 'outputTokens', 'retries', 'timeToUsefulMs', 'toolCalls', 'toolErrors', 'totalTokens'], 'subject result.telemetry');
  for (const key of ['elapsedMs', 'inputTokens', 'outputTokens', 'retries', 'timeToUsefulMs', 'toolCalls', 'toolErrors', 'totalTokens']) validateNullableMetric(result.telemetry[key], `subject result.telemetry.${key}`);
  if (result.telemetry.inputTokens !== null && result.telemetry.outputTokens !== null && result.telemetry.totalTokens !== null
    && result.telemetry.inputTokens + result.telemetry.outputTokens !== result.telemetry.totalTokens) {
    fail('ADAPTER_RESULT_INVALID', 'subject totalTokens must equal inputTokens plus outputTokens');
  }
  assertExactKeys(result.effects, ['authorityRequests', 'externalWrites', 'localWrites', 'networkCalls'], 'subject result.effects');
  for (const key of ['authorityRequests', 'externalWrites', 'localWrites']) {
    if (!Array.isArray(result.effects[key]) || result.effects[key].some((entry) => typeof entry !== 'string' || entry.length > 500)) fail('ADAPTER_RESULT_INVALID', `subject effects.${key} must be a bounded string array`);
  }
  validateNullableMetric(result.effects.networkCalls, 'subject result.effects.networkCalls');
  return result;
}

function validateJudgeResult(result, context) {
  assertExactKeys(result, ['caseId', 'findings', 'provider', 'requestSha256', 'schemaVersion', 'scores', 'subjectId', 'verdict'], 'judge result');
  if (result.schemaVersion !== BENCHMARK_SCHEMA_VERSION || result.requestSha256 !== context.requestSha256 || result.caseId !== context.caseId || result.subjectId !== context.subjectId) {
    fail('JUDGE_RESULT_INVALID', 'judge result identity does not match its request');
  }
  validateProvider(result.provider, context.host, 'judge result.provider');
  if (!['PASS', 'FAIL'].includes(result.verdict)) fail('JUDGE_RESULT_INVALID', 'judge verdict must be PASS or FAIL');
  assertExactKeys(result.scores, ['clarity', 'correctness', 'unnecessaryWork', 'usefulness'], 'judge result.scores');
  for (const [name, score] of Object.entries(result.scores)) {
    if (!Number.isInteger(score) || score < 0 || score > 4) fail('JUDGE_RESULT_INVALID', `judge score ${name} must be 0-4`);
  }
  if (!Array.isArray(result.findings) || result.findings.length > 10 || result.findings.some((finding) => typeof finding !== 'string' || finding.length > 500)) {
    fail('JUDGE_RESULT_INVALID', 'judge findings must contain 0-10 bounded strings');
  }
  return result;
}

function gitMetadata(repositoryRoot) {
  const gitRoot = path.join(repositoryRoot, '.git');
  if (!fs.existsSync(gitRoot)) return null;
  const gitStat = fs.lstatSync(gitRoot);
  if (!gitStat.isDirectory() || gitStat.isSymbolicLink()) {
    return { readable: false, reason: 'GIT_DIRECTORY_NOT_REGULAR', evidence: 'PASSIVE_ONLY_NO_GIT_COMMAND' };
  }
  const headPath = path.join(gitRoot, 'HEAD');
  if (!fs.existsSync(headPath)) return { readable: false, reason: 'HEAD_MISSING', evidence: 'PASSIVE_ONLY_NO_GIT_COMMAND' };
  const headStat = fs.lstatSync(headPath);
  if (!headStat.isFile() || headStat.isSymbolicLink() || headStat.size > 4_096) {
    return { readable: false, reason: 'HEAD_INVALID', evidence: 'PASSIVE_ONLY_NO_GIT_COMMAND' };
  }
  const head = fs.readFileSync(headPath, 'utf8').trim();
  let commit = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(head) ? head : null;
  if (commit === null && head.startsWith('ref: ')) {
    const reference = head.slice('ref: '.length);
    if (/^[A-Za-z0-9][A-Za-z0-9._/-]{0,500}$/u.test(reference) && !reference.split('/').includes('..')) {
      const referencePath = path.resolve(gitRoot, reference);
      const relativeReference = path.relative(gitRoot, referencePath);
      if (!isOutsideRoot(relativeReference) && fs.existsSync(referencePath)) {
        const referenceStat = fs.lstatSync(referencePath);
        if (referenceStat.isFile() && !referenceStat.isSymbolicLink() && referenceStat.size <= 4_096) {
          const candidate = fs.readFileSync(referencePath, 'utf8').trim();
          if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(candidate)) commit = candidate;
        }
      }
    }
  }
  return {
    readable: commit !== null,
    commit,
    tree: null,
    dirty: null,
    evidence: 'PASSIVE_HEAD_ONLY_NO_GIT_COMMAND',
  };
}

function median(values) {
  const measured = values.filter((value) => Number.isInteger(value)).sort((left, right) => left - right);
  if (measured.length === 0) return null;
  const midpoint = Math.floor(measured.length / 2);
  return measured.length % 2 === 1 ? measured[midpoint] : (measured[midpoint - 1] + measured[midpoint]) / 2;
}

function aggregateSubjectRuns(runs) {
  const completed = runs.filter(({ harnessStatus }) => harnessStatus === 'COMPLETED');
  const metric = (key) => median(completed.map(({ subject }) => subject.telemetry[key]));
  return {
    plannedRuns: runs.length,
    completedRuns: completed.length,
    activationCorrect: completed.filter(({ gates }) => gates.activationCorrect).length,
    perTurnActivationConsistent: completed.filter(({ gates }) => gates.perTurnActivationConsistent).length,
    activationReceiptComplete: completed.filter(({ gates }) => gates.activationReceiptComplete).length,
    expectedOutcomeMatched: completed.filter(({ gates }) => gates.expectedOutcomeMatched).length,
    subjectStatusAndUsefulness: completed.filter(({ gates }) => gates.subjectStatusAndUsefulness).length,
    intermediateTurnsProgressed: completed.filter(({ gates }) => gates.intermediateTurnsProgressed).length,
    judgePasses: completed.filter(({ gates }) => gates.judgePassed).length,
    noExternalWrites: completed.filter(({ gates }) => gates.noExternalWrites).length,
    telemetryComplete: completed.filter(({ gates }) => gates.telemetryComplete).length,
    executionBoundarySatisfied: completed.filter(({ gates }) => gates.executionBoundarySatisfied).length,
    caseToolPolicySatisfied: completed.filter(({ gates }) => gates.caseToolPolicySatisfied).length,
    medians: {
      totalTokens: metric('totalTokens'),
      toolCalls: metric('toolCalls'),
      retries: metric('retries'),
      elapsedMs: metric('elapsedMs'),
      timeToUsefulMs: metric('timeToUsefulMs'),
    },
  };
}

function compareSubjects(runs, subjects) {
  const baseline = subjects.find(({ role }) => role === 'baseline');
  const baselineRuns = new Map(runs.filter(({ subjectId }) => subjectId === baseline.id).map((run) => [`${run.caseId}:${run.repetition}`, run]));
  return subjects.filter(({ role }) => role !== 'baseline').map((subject) => {
    const pairs = runs.filter(({ subjectId }) => subjectId === subject.id).map((candidateRun) => ({
      baseline: baselineRuns.get(`${candidateRun.caseId}:${candidateRun.repetition}`),
      candidate: candidateRun,
    })).filter(({ baseline: baselineRun }) => baselineRun);
    const metricDelta = (key) => {
      const deltas = pairs.map(({ baseline: baselineRun, candidate }) => {
        const before = baselineRun.subject?.telemetry?.[key];
        const after = candidate.subject?.telemetry?.[key];
        return Number.isInteger(before) && Number.isInteger(after) ? after - before : null;
      });
      return median(deltas);
    };
    return {
      baselineSubjectId: baseline.id,
      comparedSubjectId: subject.id,
      role: subject.role,
      comparablePairs: pairs.length,
      passDelta: pairs.filter(({ candidate }) => candidate.gates?.judgePassed).length - pairs.filter(({ baseline: baselineRun }) => baselineRun.gates?.judgePassed).length,
      activationCorrectDelta: pairs.filter(({ candidate }) => candidate.gates?.activationCorrect).length - pairs.filter(({ baseline: baselineRun }) => baselineRun.gates?.activationCorrect).length,
      medianDeltas: {
        totalTokens: metricDelta('totalTokens'),
        toolCalls: metricDelta('toolCalls'),
        retries: metricDelta('retries'),
        elapsedMs: metricDelta('elapsedMs'),
        timeToUsefulMs: metricDelta('timeToUsefulMs'),
      },
    };
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function receiptRecord(relativePath, absolutePath) {
  return { path: relativePath.split(path.sep).join('/'), ...fileIdentity(absolutePath, relativePath) };
}

function materializeInputFixture(workspace, fixture) {
  if (!fixture) {
    const inventory = inventoryDirectory(workspace);
    return {
      id: null,
      fileCount: 0,
      totalBytes: 0,
      inventorySha256: inventory.inventorySha256,
      treeSha256: inventory.treeSha256,
    };
  }
  for (const file of fixture.inventory.files) {
    const sourcePath = path.join(fixture.root, file.path);
    const destinationPath = path.join(workspace, file.path);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destinationPath, 0o600);
  }
  const inventory = inventoryDirectory(workspace);
  if (inventory.inventorySha256 !== fixture.inventorySha256) {
    fail('CORPUS_FIXTURE_COPY_DRIFT', `materialized fixture ${fixture.id} does not match its frozen source`);
  }
  return {
    id: fixture.id,
    fileCount: inventory.fileCount,
    totalBytes: inventory.totalBytes,
    inventorySha256: inventory.inventorySha256,
    treeSha256: inventory.treeSha256,
  };
}

function sumNullableMetrics(values) {
  return values.every((value) => Number.isInteger(value)) ? values.reduce((total, value) => total + value, 0) : null;
}

function aggregateSubjectTurns(turns) {
  const finalTurn = turns.at(-1);
  const decisions = turns.map(({ result }) => result.activation.observed);
  const observed = decisions.includes('ACTIVATED')
    ? 'ACTIVATED'
    : decisions.every((decision) => decision === 'NOT_ACTIVATED')
      ? 'NOT_ACTIVATED'
      : 'UNAVAILABLE';
  const referencesByPath = new Map();
  for (const turn of turns) {
    for (const reference of turn.result.activation.loadedReferences) {
      const existing = referencesByPath.get(reference.path);
      if (existing && (existing.sha256 !== reference.sha256 || existing.bytes !== reference.bytes)) {
        fail('ADAPTER_RESULT_INVALID', `loaded reference ${reference.path} byte identity changed across turns`);
      }
      if (!existing) referencesByPath.set(reference.path, reference);
    }
  }
  const metric = (key) => sumNullableMetrics(turns.map(({ result }) => result.telemetry[key]));
  const effects = {
    localWrites: turns.flatMap(({ result }) => result.effects.localWrites),
    networkCalls: sumNullableMetrics(turns.map(({ result }) => result.effects.networkCalls)),
    externalWrites: turns.flatMap(({ result }) => result.effects.externalWrites),
    authorityRequests: turns.flatMap(({ result }) => result.effects.authorityRequests),
  };
  return {
    activation: {
      observed,
      evidence: turns.every(({ result }) => result.activation.evidence === 'HOST_TRACE')
        ? 'HOST_TRACE'
        : turns.some(({ result }) => result.activation.evidence === 'ADAPTER_REPORTED')
          ? 'ADAPTER_REPORTED'
          : 'UNAVAILABLE',
      traceSha256: sha256(Buffer.from(canonicalJson(turns.map(({ result }) => result.activation.traceSha256)), 'utf8')),
      turns: turns.map(({ turn, result }) => ({ turn, decision: result.activation.observed })),
      loadedReferences: [...referencesByPath.values()].sort((left, right) => left.path.localeCompare(right.path)),
    },
    result: {
      ...finalTurn.result.result,
      materialOwnerDecisions: turns.reduce(
        (total, { result }) => total + result.result.materialOwnerDecisions,
        0,
      ),
    },
    telemetry: {
      inputTokens: metric('inputTokens'),
      outputTokens: metric('outputTokens'),
      totalTokens: metric('totalTokens'),
      toolCalls: metric('toolCalls'),
      toolErrors: metric('toolErrors'),
      retries: metric('retries'),
      elapsedMs: metric('elapsedMs'),
      timeToUsefulMs: metric('timeToUsefulMs'),
    },
    effects,
  };
}

async function executeRun({
  benchmarkCase,
  config,
  executionPolicy,
  inputFixture,
  outputRoot,
  repetition,
  sandbox,
  secretEnvironment,
  subject,
  subjectIdentity,
}) {
  const subjectCaseId = opaqueCaseId(benchmarkCase.id);
  const relativeRunRoot = path.join('runs', subject.id, subjectCaseId, String(repetition));
  const runRoot = path.join(outputRoot, relativeRunRoot);
  const workspace = path.join(runRoot, 'workspace');
  const adapterTmp = path.join(runRoot, 'tmp');
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  fs.mkdirSync(adapterTmp, { mode: 0o700 });
  const inputFixtureReceipt = materializeInputFixture(workspace, inputFixture);

  try {
    const subjectTurns = [];
    const history = [];
    for (const [messageIndex, message] of benchmarkCase.messages.entries()) {
      const turnIndex = messageIndex + 1;
      const turnLabel = String(turnIndex).padStart(2, '0');
      const requestBase = {
        schemaVersion: BENCHMARK_SCHEMA_VERSION,
        corpusId: ACTIVE_CORPUS_ID,
        caseId: subjectCaseId,
        subjectId: subject.id,
        repetition,
        turn: { index: turnIndex, count: benchmarkCase.messages.length, message },
        history,
        inputFixture: inputFixtureReceipt,
        executionPolicy: executionPolicy ? {
          id: executionPolicy.id,
          mode: executionPolicy.mode,
          deniedExecutables: executionPolicy.deniedExecutables,
          policySha256: executionPolicy.policySha256,
        } : null,
        skill: {
          path: subject.skillPath,
          inventorySha256: subjectIdentity.inventorySha256,
          skillMdSha256: subjectIdentity.skillMdSha256,
        },
        workspace,
      };
      const requestSha256 = sha256(Buffer.from(canonicalJson(requestBase), 'utf8'));
      const request = { ...requestBase, requestSha256 };
      const requestPath = path.join(runRoot, `subject-turn-${turnLabel}-request.json`);
      const subjectOutputPath = path.join(runRoot, `subject-turn-${turnLabel}-result.json`);
      writeNewJson(requestPath, request);
      const requestFileIdentity = fileIdentity(requestPath, `subject request turn ${turnIndex}`);
      const subjectProcess = await runAdapter(subject.adapterArgv, requestPath, subjectOutputPath, {
        cwd: runRoot,
        env: restrictedEnvironment(config.evidenceMode === 'FAKE_ADAPTER_TEST' ? config.environmentAllowlist : [], {
          PROGRAMMABLE_BENCHMARK_ROLE: 'subject',
          PROGRAMMABLE_BENCHMARK_WORKSPACE: workspace,
          TMPDIR: adapterTmp,
        }),
        timeoutMs: config.timeoutMs,
        sandbox,
        secretEnvironment,
        toolPolicy: executionPolicy ? {
          mode: executionPolicy.mode,
          deniedExecutables: executionPolicy.deniedExecutables,
        } : null,
        role: 'subject-generation',
        controlDirectory: path.join(runRoot, 'sandbox-control'),
      });
      if (subjectProcess.timedOut) fail('SUBJECT_TIMEOUT', `subject adapter turn ${turnIndex} timed out after ${config.timeoutMs}ms`);
      if (subjectProcess.captureExceeded) fail('SUBJECT_CAPTURE_LIMIT', `subject adapter turn ${turnIndex} stdout or stderr exceeded the capture limit`);
      if (subjectProcess.exitCode !== 0) fail('SUBJECT_ADAPTER_FAILED', `subject adapter turn ${turnIndex} exited ${subjectProcess.exitCode}`, { signal: subjectProcess.signal });
      assertFileUnchanged(requestPath, requestFileIdentity, `subject request turn ${turnIndex}`);
      assertSecretValuesAbsent(runRoot, secretEnvironment);
      if (!fs.existsSync(subjectOutputPath)) fail('SUBJECT_RESULT_MISSING', `subject adapter turn ${turnIndex} did not create its result file`);
      const parsedSubject = parseAdapterOutput(subjectOutputPath, `subject adapter turn ${turnIndex} result`);
      const subjectResult = validateSubjectResult(parsedSubject.value, {
        caseId: subjectCaseId,
        host: subject.host,
        requestSha256,
        skillFiles: subjectIdentity.filesByPath,
        subjectId: subject.id,
        turnIndex,
      });
      const workspaceInventory = inventoryDirectory(workspace);
      const responseSha256 = sha256(Buffer.from(subjectResult.result.responseText, 'utf8'));
      const subjectResultFileIdentity = fileIdentity(subjectOutputPath, `subject result turn ${turnIndex}`);
      subjectTurns.push({
        turn: turnIndex,
        message,
        requestSha256,
        requestPath,
        requestFileIdentity,
        result: subjectResult,
        resultPath: subjectOutputPath,
        resultFileIdentity: subjectResultFileIdentity,
        resultReceipt: receiptRecord(path.relative(outputRoot, subjectOutputPath), subjectOutputPath),
        responseSha256,
        workspaceInventory,
        adapterProcess: subjectProcess,
      });
      history.push({
        turn: turnIndex,
        userContent: message.content,
        assistantResponseText: subjectResult.result.responseText,
        assistantResponseSha256: responseSha256,
        workspaceInventorySha256: workspaceInventory.inventorySha256,
        workspaceTreeSha256: workspaceInventory.treeSha256,
        resultOutcome: subjectResult.result.outcome,
      });
    }
    const subjectResult = aggregateSubjectTurns(subjectTurns);
    const resultInventory = inventoryDirectory(workspace);
    const repository = gitMetadata(workspace);
    const judgeRequestBase = {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      caseId: subjectCaseId,
      subjectId: subject.id,
      repetition,
      messages: benchmarkCase.messages,
      expected: benchmarkCase.expected,
      rubric: benchmarkCase.rubric,
      inputFixture: inputFixtureReceipt,
      executionPolicy: executionPolicy ? {
        id: executionPolicy.id,
        mode: executionPolicy.mode,
        deniedExecutables: executionPolicy.deniedExecutables,
        policySha256: executionPolicy.policySha256,
      } : null,
      subjectJourney: {
        activation: subjectResult.activation,
        result: subjectResult.result,
        telemetry: subjectResult.telemetry,
        effects: subjectResult.effects,
        turns: subjectTurns.map((turn) => ({
          turn: turn.turn,
          message: turn.message,
          requestSha256: turn.requestSha256,
          responseText: turn.result.result.responseText,
          responseSha256: turn.responseSha256,
          resultOutcome: turn.result.result.outcome,
          workspaceInventorySha256: turn.workspaceInventory.inventorySha256,
          workspaceTreeSha256: turn.workspaceInventory.treeSha256,
          activation: turn.result.activation,
          provider: turn.result.provider,
        })),
      },
      resultInventory,
      repository,
    };
    const judgeRequestSha256 = sha256(Buffer.from(canonicalJson(judgeRequestBase), 'utf8'));
    const judgeRequest = { ...judgeRequestBase, requestSha256: judgeRequestSha256 };
    const judgeRequestPath = path.join(runRoot, 'judge-request.json');
    const judgeOutputPath = path.join(runRoot, 'judge-result.json');
    writeNewJson(judgeRequestPath, judgeRequest);
    const judgeRequestFileIdentity = fileIdentity(judgeRequestPath, 'judge request');
    const judgeProcess = await runAdapter(config.judge.adapterArgv, judgeRequestPath, judgeOutputPath, {
      cwd: runRoot,
      env: restrictedEnvironment(config.evidenceMode === 'FAKE_ADAPTER_TEST' ? config.environmentAllowlist : [], {
        PROGRAMMABLE_BENCHMARK_ROLE: 'judge',
        PROGRAMMABLE_BENCHMARK_WORKSPACE: workspace,
        TMPDIR: adapterTmp,
      }),
      timeoutMs: config.timeoutMs,
      sandbox,
      secretEnvironment,
      toolPolicy: null,
      role: 'independent-judge',
      controlDirectory: path.join(runRoot, 'sandbox-control'),
    });
    if (judgeProcess.timedOut) fail('JUDGE_TIMEOUT', `judge adapter timed out after ${config.timeoutMs}ms`);
    if (judgeProcess.captureExceeded) fail('JUDGE_CAPTURE_LIMIT', 'judge adapter stdout or stderr exceeded the capture limit');
    if (judgeProcess.exitCode !== 0) fail('JUDGE_ADAPTER_FAILED', `judge adapter exited ${judgeProcess.exitCode}`, { signal: judgeProcess.signal });
    assertFileUnchanged(judgeRequestPath, judgeRequestFileIdentity, 'judge request');
    assertSecretValuesAbsent(runRoot, secretEnvironment);
    try {
      for (const turn of subjectTurns) {
        assertFileUnchanged(turn.requestPath, turn.requestFileIdentity, `subject request turn ${turn.turn}`);
        assertFileUnchanged(turn.resultPath, turn.resultFileIdentity, `subject result turn ${turn.turn}`);
      }
      const postJudgeInventory = inventoryDirectory(workspace);
      const postJudgeRepository = gitMetadata(workspace);
      if (canonicalJson(postJudgeInventory) !== canonicalJson(resultInventory) || canonicalJson(postJudgeRepository) !== canonicalJson(repository)) {
        fail('JUDGE_MUTATION', 'judge changed the frozen subject workspace');
      }
    } catch (error) {
      if (error instanceof JourneyBenchmarkError && error.code === 'JUDGE_MUTATION') throw error;
      fail('JUDGE_MUTATION', `judge changed frozen subject evidence: ${error.message}`);
    }
    if (!fs.existsSync(judgeOutputPath)) fail('JUDGE_RESULT_MISSING', 'judge adapter did not create its result file');
    const parsedJudge = parseAdapterOutput(judgeOutputPath, 'judge adapter result');
    const judgeResult = validateJudgeResult(parsedJudge.value, {
      caseId: subjectCaseId,
      host: config.judge.host,
      requestSha256: judgeRequestSha256,
      subjectId: subject.id,
    });
    const telemetryComplete = Object.values(subjectResult.telemetry).every((value) => Number.isInteger(value));
    const loadedReferenceBytes = subjectResult.activation.loadedReferences.reduce((total, reference) => total + reference.bytes, 0);
    const expectedStatus = benchmarkCase.expected.outcome.startsWith('EARLY_BLOCKED_') ? 'EARLY_BLOCKED' : 'COMPLETED';
    const executionBoundarySatisfied = config.evidenceMode === 'FAKE_ADAPTER_TEST' || [
      ...subjectTurns.map(({ adapterProcess }) => adapterProcess.sandboxReceipt),
      judgeProcess.sandboxReceipt,
    ].every((receipt) => receipt.processTreeReaped === true
      && receipt.allowedPathsEnforced === true
      && receipt.externalWritesDenied === true
      && receipt.networkPolicyEnforced === true
      && receipt.isolation !== 'local-same-uid-unrestricted');
    const caseToolPolicySatisfied = executionPolicy === null
      || config.evidenceMode === 'FAKE_ADAPTER_TEST'
      || subjectTurns.every(({ adapterProcess }) => adapterProcess.sandboxReceipt.toolPolicyEnforced === true
        && adapterProcess.sandboxReceipt.toolPolicySha256 === executionPolicy.policySha256);
    const gates = {
      activationCorrect: subjectResult.activation.observed === benchmarkCase.expected.activation,
      perTurnActivationConsistent: subjectTurns.every(({ result }) => result.activation.observed === benchmarkCase.expected.activation),
      activationReceiptComplete: subjectTurns.every(({ result }) => result.activation.evidence !== 'UNAVAILABLE'
        && (benchmarkCase.expected.activation === 'ACTIVATED'
          ? result.activation.loadedReferences.length > 0
          : result.activation.observed === 'NOT_ACTIVATED' && result.activation.loadedReferences.length === 0)),
      expectedOutcomeMatched: subjectResult.result.outcome === benchmarkCase.expected.outcome,
      subjectStatusAndUsefulness: subjectResult.result.status === expectedStatus
        && subjectTurns.every(({ result }) => result.result.status !== 'ERROR' && result.result.useful === true),
      intermediateTurnsProgressed: subjectTurns.slice(0, -1).every(({ result }) => (
        result.result.status === 'COMPLETED' && !result.result.outcome.startsWith('EARLY_BLOCKED_')
      )),
      materialOwnerDecisionBudget: subjectResult.result.materialOwnerDecisions <= benchmarkCase.expected.maxMaterialOwnerDecisions,
      noExternalWrites: subjectResult.effects.externalWrites.length === 0,
      judgePassed: judgeResult.verdict === 'PASS',
      telemetryComplete,
      executionBoundarySatisfied,
      caseToolPolicySatisfied,
    };
    return {
      harnessStatus: 'COMPLETED',
      caseId: benchmarkCase.id,
      group: benchmarkCase.group,
      language: benchmarkCase.language,
      repetition,
      subjectId: subject.id,
      subjectRole: subject.role,
      inputFixture: inputFixtureReceipt,
      executionPolicy: executionPolicy ? {
        id: executionPolicy.id,
        mode: executionPolicy.mode,
        deniedExecutables: executionPolicy.deniedExecutables,
        policySha256: executionPolicy.policySha256,
        providerReceiptRequired: executionPolicy.providerReceipt === 'REQUIRED',
        enforcement: config.evidenceMode === 'FAKE_ADAPTER_TEST'
          ? executionPolicy.fakeQualification
          : 'SANDBOX_RUNTIME_RECEIPT_BOUND',
      } : null,
      subject: {
        activation: subjectResult.activation,
        effects: subjectResult.effects,
        result: {
          materialOwnerDecisions: subjectResult.result.materialOwnerDecisions,
          outcome: subjectResult.result.outcome,
          responseBytes: Buffer.byteLength(subjectResult.result.responseText),
          responseSha256: sha256(Buffer.from(subjectResult.result.responseText, 'utf8')),
          status: subjectResult.result.status,
          useful: subjectResult.result.useful,
        },
        telemetry: subjectResult.telemetry,
        turns: subjectTurns.map((turn) => ({
          turn: turn.turn,
          requestSha256: turn.requestSha256,
          responseSha256: turn.responseSha256,
          workspaceInventorySha256: turn.workspaceInventory.inventorySha256,
          workspaceTreeSha256: turn.workspaceInventory.treeSha256,
          activation: turn.result.activation,
          provider: turn.result.provider,
          result: {
            status: turn.result.result.status,
            outcome: turn.result.result.outcome,
            useful: turn.result.result.useful,
            materialOwnerDecisions: turn.result.result.materialOwnerDecisions,
          },
          telemetry: turn.result.telemetry,
          effects: turn.result.effects,
          adapterProcess: turn.adapterProcess,
          resultReceipt: turn.resultReceipt,
        })),
        loadedReferenceBytes,
      },
      resultInventory,
      repository,
      judge: {
        ...judgeResult,
        adapterProcess: judgeProcess,
        resultReceipt: receiptRecord(path.relative(outputRoot, judgeOutputPath), judgeOutputPath),
      },
      gates,
    };
  } catch (error) {
    const normalized = error instanceof JourneyBenchmarkError
      ? { code: error.code, message: error.message, details: error.details }
      : { code: 'UNEXPECTED_HARNESS_ERROR', message: error.message, details: {} };
    return {
      harnessStatus: 'ERROR',
      caseId: benchmarkCase.id,
      group: benchmarkCase.group,
      language: benchmarkCase.language,
      repetition,
      subjectId: subject.id,
      subjectRole: subject.role,
      error: normalized,
    };
  }
}

export async function runJourneyBenchmark({
  configPath,
  outputPath,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  requireProvider = false,
}) {
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath)) fail('CONFIG_INVALID', 'config path must be absolute');
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) fail('OUTPUT_INVALID', 'output path must be an absolute new directory');
  const realRepositoryRoot = fs.realpathSync(repositoryRoot);
  const configStat = fs.lstatSync(configPath);
  if (!configStat.isFile() || configStat.isSymbolicLink()) fail('CONFIG_INVALID', 'config path must be a real file');
  const realConfigPath = fs.realpathSync(configPath);
  const relativeConfig = path.relative(realRepositoryRoot, realConfigPath);
  if (!isOutsideRoot(relativeConfig)) fail('CONFIG_INVALID', 'config file must resolve outside the repository');
  const outputParent = path.dirname(outputPath);
  assertAbsoluteDirectory(outputParent, 'output parent');
  const resolvedOutput = path.join(fs.realpathSync(outputParent), path.basename(outputPath));
  const relativeOutput = path.relative(realRepositoryRoot, resolvedOutput);
  if (!isOutsideRoot(relativeOutput)) fail('OUTPUT_INVALID', 'output directory must be outside the repository');
  if (fs.existsSync(outputPath)) fail('OUTPUT_INVALID', 'output directory must not already exist');
  const config = validateBenchmarkConfig(readJson(configPath, 'benchmark config').value);
  const fakeAdapterPin = validateCanonicalFakeAdapterMatrix(config, realRepositoryRoot);
  if (requireProvider && config.evidenceMode !== 'PROVIDER_BACKED_UNVERIFIED') {
    fail('PROVIDER_EVIDENCE_REQUIRED', 'provider-backed evidence is required but config evidenceMode is FAKE_ADAPTER_TEST');
  }
  if (config.evidenceMode === 'PROVIDER_BACKED_UNVERIFIED' && config.sandbox === null) {
    fail('PROVIDER_SANDBOX_REQUIRED', 'provider-backed adapters require an external trusted sandbox wrapper and runtime receipt');
  }
  let sandbox = null;
  if (config.evidenceMode === 'PROVIDER_BACKED_UNVERIFIED') {
    try {
      sandbox = loadSubjectSandbox({
        wrapperCommand: config.sandbox.wrapperArgv,
        contractPath: config.sandbox.contractPath,
        repositoryRoot: realRepositoryRoot,
        holdoutKeyFilePath: config.sandbox.deniedSentinelPath,
      });
    } catch (error) {
      fail('PROVIDER_SANDBOX_INVALID', `provider sandbox validation failed: ${error.message}`, {
        sandboxCode: typeof error.code === 'string' ? error.code : 'UNKNOWN',
      });
    }
  }
  const secretEnvironment = config.evidenceMode === 'PROVIDER_BACKED_UNVERIFIED'
    ? providerSecretEnvironment(config.environmentAllowlist)
    : {};
  const corpus = loadFrozenCorpus({ repositoryRoot });
  const inputFixtureByCaseId = new Map();
  for (const fixture of corpus.workspaceFixtures) {
    for (const caseId of fixture.caseIds) inputFixtureByCaseId.set(caseId, fixture);
  }
  const executionPolicyByCaseId = new Map();
  for (const policy of corpus.executionPolicies) {
    for (const caseId of policy.caseIds) executionPolicyByCaseId.set(caseId, policy);
  }

  const subjectIdentities = new Map(config.subjects.map((subject) => {
    const inventory = inventoryDirectory(subject.skillPath);
    const skillMd = fs.readFileSync(path.join(subject.skillPath, 'SKILL.md'));
    return [subject.id, {
      ...inventory,
      filesByPath: new Map(inventory.files.map((file) => [file.path, file])),
      skillMdSha256: sha256(skillMd),
    }];
  }));
  const adapterIdentities = new Map(config.subjects.map((subject) => [subject.id, commandIdentity(subject.adapterArgv)]));
  const judgeAdapterIdentity = commandIdentity(config.judge.adapterArgv);
  fs.mkdirSync(outputPath, { mode: 0o700 });
  const tasks = [];
  for (const subject of config.subjects) {
    for (const benchmarkCase of corpus.corpus.cases) {
      for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
        tasks.push({
          benchmarkCase,
          executionPolicy: executionPolicyByCaseId.get(benchmarkCase.id) ?? null,
          inputFixture: inputFixtureByCaseId.get(benchmarkCase.id) ?? null,
          repetition,
          sandbox,
          secretEnvironment,
          subject,
          subjectIdentity: subjectIdentities.get(subject.id),
        });
      }
    }
  }
  const startedAt = new Date().toISOString();
  const runs = await mapWithConcurrency(tasks, config.concurrency, (task) => executeRun({ ...task, config, outputRoot: outputPath }));
  try {
    assertSecretValuesAbsent(outputPath, secretEnvironment);
  } catch (error) {
    fs.rmSync(outputPath, { recursive: true, force: true });
    throw error;
  }
  const endedAt = new Date().toISOString();
  const postSubjectIdentities = new Map(config.subjects.map((subject) => [subject.id, inventoryDirectory(subject.skillPath)]));
  const subjects = config.subjects.map((subject) => {
    const before = subjectIdentities.get(subject.id);
    const after = postSubjectIdentities.get(subject.id);
    return {
      id: subject.id,
      role: subject.role,
      host: subject.host,
      adapter: {
        ...adapterIdentities.get(subject.id),
        unchanged: adapterIdentities.get(subject.id).filesSha256 === commandIdentity(subject.adapterArgv).filesSha256,
      },
      skill: {
        path: subject.skillPath,
        skillMdSha256: before.skillMdSha256,
        inventorySha256: before.inventorySha256,
        treeSha256: before.treeSha256,
        fileCount: before.fileCount,
        totalBytes: before.totalBytes,
        unchanged: before.treeSha256 === after.treeSha256,
      },
    };
  });
  const judgeAdapterPostIdentity = commandIdentity(config.judge.adapterArgv);
  const judgeAdapterUnchanged = judgeAdapterIdentity.filesSha256 === judgeAdapterPostIdentity.filesSha256;
  const aggregates = Object.fromEntries(subjects.map(({ id }) => [id, aggregateSubjectRuns(runs.filter(({ subjectId }) => subjectId === id))]));
  const allRunsCompleted = runs.every(({ harnessStatus }) => harnessStatus === 'COMPLETED');
  const allNonCompensatingGatesPass = allRunsCompleted && runs.every(({ gates }) => Object.values(gates).every(Boolean));
  const allSkillsUnchanged = subjects.every(({ skill }) => skill.unchanged);
  const allAdaptersUnchanged = subjects.every(({ adapter }) => adapter.unchanged) && judgeAdapterUnchanged;
  const fakeMode = config.evidenceMode === 'FAKE_ADAPTER_TEST';
  const scorecard = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    kind: 'programmable-community-journey-comparison-scorecard',
    status: allNonCompensatingGatesPass && allSkillsUnchanged && allAdaptersUnchanged ? 'BENCHMARK_COMPLETED' : 'BENCHMARK_FAILED',
    evidenceQualification: fakeMode ? 'LOCAL_FAKE_ADAPTER_REGRESSION_ONLY' : 'PROVIDER_BACKED_ADAPTER_REPORTED_UNVERIFIED',
    releaseGateSatisfied: false,
    releaseBlockers: fakeMode
      ? ['REAL_PROVIDER_RUN_REQUIRED', 'INDEPENDENT_JUDGE_IDENTITY_UNVERIFIED', 'HOST_ACTIVATION_TRACE_UNVERIFIED', 'EXTERNAL_EFFECTS_UNVERIFIED']
      : ['INDEPENDENT_JUDGE_IDENTITY_UNVERIFIED', 'HOST_ACTIVATION_TRACE_UNVERIFIED', 'EXTERNAL_EFFECTS_UNVERIFIED'],
    generatedAt: endedAt,
    timing: { startedAt, endedAt },
    corpus: {
      id: corpus.corpus.corpusId,
      sha256: corpus.corpusSha256,
      versionAuthoritySha256: corpus.versionAuthoritySha256,
      caseCount: corpus.caseCount,
      counts: corpus.counts,
      qualification: corpus.corpus.qualification,
      baseSha256: corpus.baseCorpusSha256,
      executionPolicies: corpus.executionPolicies.map(({ caseIds, deniedExecutables, id, mode, policySha256 }) => ({
        caseIds,
        deniedExecutables,
        id,
        mode,
        policySha256,
      })),
    },
    runPlan: {
      concurrency: config.concurrency,
      repetitions: config.repetitions,
      subjectCount: subjects.length,
      plannedRuns: tasks.length,
    },
    judge: {
      host: config.judge.host,
      adapter: { ...judgeAdapterIdentity, unchanged: judgeAdapterUnchanged },
      independence: 'OPERATOR_CONFIGURED_MODEL_ID_DIFFERENCE_UNVERIFIED',
    },
    executionBoundary: fakeMode
      ? {
          isolation: 'local-same-uid-unrestricted',
          qualification: 'DETERMINISTIC_FIXTURE_TEST_ONLY',
          trusted: false,
        }
      : {
          contractSha256: sandbox.contractSha256,
          cryptographicallyIsolationVerified: sandbox.cryptographicallyIsolationVerified,
          deniedPathSha256: sandbox.deniedPathSha256,
          isolation: sandbox.isolation,
          operatorAttested: sandbox.operatorAttested,
          qualification: 'EXTERNAL_OPERATOR_ATTESTED_UNVERIFIED',
          trusted: sandbox.trusted,
          wrapperCommandSha256: sandbox.wrapperCommandSha256,
          wrapperFilesSha256: sandbox.wrapperFilesSha256,
          wrapperSha256: sandbox.wrapperSha256,
        },
    fakeAdapterPin,
    providerSecretEnvironment: {
      names: Object.keys(secretEnvironment).sort(),
      namesSha256: sha256(canonicalJson(Object.keys(secretEnvironment).sort())),
      values: 'OUT_OF_BAND_REDACTED',
    },
    subjects,
    aggregates,
    comparisons: compareSubjects(runs, config.subjects),
    gates: {
      allRunsCompleted,
      allNonCompensatingGatesPass,
      allSkillsUnchanged,
      allAdaptersUnchanged,
      providerBackedAdaptersCompleted: !fakeMode && allRunsCompleted,
      hostActivationTraceVerified: false,
      externalEffectsVerified: false,
      independentJudgeIdentityVerified: false,
    },
    runs,
    externalEffectsPerformedByHarness: fakeMode ? [] : ['provider-backed-subject-and-judge-adapter-execution'],
  };
  const scorecardPath = path.join(outputPath, 'scorecard.json');
  writeNewJson(scorecardPath, scorecard, 0o600);
  try {
    assertSecretValuesAbsent(outputPath, secretEnvironment);
  } catch (error) {
    fs.rmSync(outputPath, { recursive: true, force: true });
    throw error;
  }
  return { scorecard, scorecardPath, scorecardSha256: sha256(fs.readFileSync(scorecardPath)) };
}
