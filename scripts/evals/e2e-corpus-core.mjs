import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  validateHoldoutPayloadEnvelope,
} from './e2e-holdout-crypto-core.mjs';

export {
  E2EHoldoutRevealError,
  revealHoldoutCase,
} from './e2e-holdout-crypto-core.mjs';

const HOLDOUT_MANIFEST = 'evals/holdout/manifest.json';
const DEV_MANIFEST = 'evals/suites/programmable-v4-hook-builder/suite.json';
const DEV_ROOT = 'evals/suites/programmable-v4-hook-builder';
const SKILL_ROOT = 'skills/programmable-v4-hook-builder';
const ROOT_KEYS = [
  'adapterContract',
  'bundleFiles',
  'combinedCorpusSha256',
  'coverageContract',
  'devCaseCount',
  'efficiencyContract',
  'hardGateCaseIds',
  'holdoutCaseCount',
  'holdoutCorpusSha256',
  'judgeContract',
  'kind',
  'minimumRepetitions',
  'novelMinimumPassBps',
  'publicCorpusSha256',
  'repositoryContract',
  'schemaVersion',
  'tierProfiles',
];
const CASE_KEYS = ['id', 'payloadEnvelope'];
const TIER_IDS = ['frontier', 'mid', 'small'];
const REQUIRED_HARD_GATE_CASE_IDS = Object.freeze([
  'hc-9e87089c8effb4c449813f66',
  'hc-e1b85d80d0e270e4cc8963da',
  'hc-0106c0aae2a65eeb1c35e488',
  'hc-d82f7573e91b4ce4f1789cd7',
  'hc-b0ae75fd49e4e414edecf6d8',
  'hc-24ea80d5f2284b14139e822e',
  'hc-08c1e8f8b889002b973801a7',
  'hc-8369aec1c981de5188b76d37',
]);
const REQUIRED_COVERAGE = Object.freeze({
  categories: Object.freeze([
    'async-swap',
    'basic-v4',
    'composed-game',
    'custom-accounting',
    'custom-curve',
    'hook-owned-liquidity',
    'nft-rwa',
    'no-pool-hybrid',
    'oracle',
    'prediction-market',
    'repair-manipulated',
    'treasury',
    'unknown-holdout',
    'upgrade-migration',
  ]),
  languages: Object.freeze(['de', 'en']),
  mutations: Object.freeze([
    'delta-sign',
    'fee-bypass',
    'intent-drift',
    'noop-rug',
    'open-deltas',
    'oracle-failure',
    'permission-bits',
    'poolmanager-auth',
    'rounding',
    'source-runtime-drift',
    'unbound-admin',
  ]),
  variants: Object.freeze([
    'adversarial',
    'colloquial',
    'irrelevant-change',
    'missing-details',
    'naive',
    'no-hook',
    'paraphrase',
    'repair',
    'typo',
    'unusual-combination',
  ]),
});
const STAGE_IDS = [
  'install',
  'compile',
  'typecheck',
  'lint',
  'unit',
  'negative',
  'fuzz',
  'invariant',
  'fork',
  'gas',
  'code-size',
  'deployment',
  'submission',
];
const ARTIFACT_IDS = ['intent', 'architecture', 'deploymentManifest', 'submission'];

export class E2EStructureError extends Error {
  constructor(issues) {
    super(`E2E holdout validation failed with ${issues.length} issue(s)`);
    this.name = 'E2EStructureError';
    this.issues = issues;
  }
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function exactKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function readJson(filePath, issues, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    issues.push(`${label}: ${error.message}`);
    return null;
  }
}

function safeBundlePath(holdoutRoot, relativePath, issues) {
  addIssue(
    issues,
    typeof relativePath === 'string' && /^bundles\/[a-z0-9-]+\.json$/u.test(relativePath),
    `holdout bundle path is invalid: ${String(relativePath)}`,
  );
  if (typeof relativePath !== 'string') return null;
  const absolutePath = path.resolve(holdoutRoot, relativePath);
  const relative = path.relative(holdoutRoot, absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    issues.push(`holdout bundle escapes root: ${relativePath}`);
    return null;
  }
  try {
    const stat = fs.lstatSync(absolutePath);
    addIssue(issues, stat.isFile() && !stat.isSymbolicLink(), `holdout bundle must be a regular file: ${relativePath}`);
  } catch (error) {
    issues.push(`holdout bundle cannot be read: ${relativePath}: ${error.message}`);
    return null;
  }
  return absolutePath;
}

function validateTierProfiles(manifest, issues) {
  addIssue(issues, Array.isArray(manifest.tierProfiles), 'tierProfiles must be an array');
  const tiers = new Map();
  for (const [index, profile] of (manifest.tierProfiles ?? []).entries()) {
    const label = `tierProfiles[${index}]`;
    addIssue(issues, exactKeys(profile, ['id', 'modelEnv', 'standardMinimumPassBps']), `${label}: keys drift`);
    addIssue(issues, TIER_IDS.includes(profile?.id), `${label}: unknown tier ${profile?.id}`);
    addIssue(issues, !tiers.has(profile?.id), `${label}: duplicate tier ${profile?.id}`);
    addIssue(
      issues,
      /^PROGRAMMABLE_E2E_(?:FRONTIER|MID|SMALL)_MODEL$/u.test(profile?.modelEnv ?? ''),
      `${label}: modelEnv is invalid`,
    );
    addIssue(
      issues,
      Number.isInteger(profile?.standardMinimumPassBps)
        && profile.standardMinimumPassBps >= 9000
        && profile.standardMinimumPassBps <= 10000,
      `${label}: standardMinimumPassBps is invalid`,
    );
    tiers.set(profile?.id, profile);
  }
  addIssue(issues, TIER_IDS.every((id) => tiers.has(id)) && tiers.size === TIER_IDS.length, 'frontier, mid and small tiers are required');
  if (tiers.has('small')) addIssue(issues, tiers.get('small').standardMinimumPassBps === 9000, 'small tier threshold must be 90%');
  return tiers;
}

function validateContracts(manifest, issues) {
  addIssue(
    issues,
    exactKeys(manifest.adapterContract, ['arguments', 'resultPath', 'resultSchemaVersion'])
      && JSON.stringify(manifest.adapterContract.arguments) === JSON.stringify(['installedSkillPath', 'naturalPrompt'])
      && manifest.adapterContract.resultPath === '.programmable-e2e/agent-result.json'
      && manifest.adapterContract.resultSchemaVersion === '1.1.0',
    'adapter contract must expose only installedSkillPath and naturalPrompt',
  );
  addIssue(
    issues,
    exactKeys(manifest.judgeContract, ['arguments', 'independentModelEnv', 'requestPath', 'resultPath', 'resultSchemaVersion'])
      && JSON.stringify(manifest.judgeContract.arguments) === JSON.stringify(['evaluationRequestPath', 'judgeResultPath'])
      && manifest.judgeContract.independentModelEnv === 'PROGRAMMABLE_E2E_JUDGE_MODEL'
      && manifest.judgeContract.requestPath === 'judge-request.json'
      && manifest.judgeContract.resultPath === 'judge-result.json'
      && manifest.judgeContract.resultSchemaVersion === '1.1.0',
    'judge contract must remain independent and hash-bind its request and result paths',
  );
  const contract = manifest.repositoryContract;
  addIssue(
    issues,
    exactKeys(contract, ['artifactIds', 'freshCheckout', 'path', 'rpcEnvironment', 'schemaVersion', 'stageIds']),
    'repositoryContract keys drift',
  );
  addIssue(issues, contract?.path === '.programmable-e2e/repository-contract.json', 'repository contract path drift');
  addIssue(issues, contract?.schemaVersion === '1.0.0', 'repository contract schemaVersion drift');
  addIssue(issues, contract?.freshCheckout === 'local-git-clone', 'repository verification must use a fresh local git clone');
  addIssue(issues, contract?.rpcEnvironment === 'PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL', 'fork RPC proxy environment contract drift');
  addIssue(issues, JSON.stringify(contract?.artifactIds) === JSON.stringify(ARTIFACT_IDS), 'repository artifact contract drift');
  addIssue(issues, JSON.stringify(contract?.stageIds) === JSON.stringify(STAGE_IDS), 'repository stage contract drift');
  addIssue(
    issues,
    exactKeys(manifest.efficiencyContract, [
      'assistedRunsCountAsPass',
      'coldStartContextTargetTokens',
      'escalatedRunsCountAsPass',
      'maxActivatedReferenceBytes',
      'maxCombinedTokens',
      'maxDescendantSubagents',
      'maxEmittedBytes',
      'maxRetries',
      'maxTimeToUsefulMs',
      'maxToolCalls',
      'maxTotalInputTokens',
      'maxTotalOutputTokens',
      'maxWallTimeMs',
      'standardArchitectureContextTargetTokens',
    ])
      && manifest.efficiencyContract.coldStartContextTargetTokens === 4000
      && manifest.efficiencyContract.standardArchitectureContextTargetTokens === 8000
      && manifest.efficiencyContract.assistedRunsCountAsPass === false
      && manifest.efficiencyContract.escalatedRunsCountAsPass === false
      && [
        'maxActivatedReferenceBytes',
        'maxCombinedTokens',
        'maxEmittedBytes',
        'maxRetries',
        'maxTimeToUsefulMs',
        'maxToolCalls',
        'maxTotalInputTokens',
        'maxTotalOutputTokens',
        'maxWallTimeMs',
      ].every((key) => Number.isSafeInteger(manifest.efficiencyContract[key]) && manifest.efficiencyContract[key] > 0)
      && manifest.efficiencyContract.maxDescendantSubagents === 0
      && manifest.efficiencyContract.maxCombinedTokens
        === manifest.efficiencyContract.maxTotalInputTokens + manifest.efficiencyContract.maxTotalOutputTokens,
    'efficiency contract must own complete positive run budgets, preserve measured 4k/8k targets, default descendants to zero, and exclude assisted or escalated runs from PASS',
  );
}

function validateCoverageContract(manifest, issues) {
  const coverage = manifest.coverageContract;
  addIssue(
    issues,
    exactKeys(coverage, ['categories', 'languages', 'mutations', 'variants']),
    'coverageContract keys drift',
  );
  for (const key of ['categories', 'languages', 'mutations', 'variants']) {
    addIssue(issues, Array.isArray(coverage?.[key]) && coverage[key].length > 0, `coverageContract.${key} must be non-empty`);
    addIssue(
      issues,
      JSON.stringify([...(coverage?.[key] ?? [])].sort()) === JSON.stringify(coverage?.[key] ?? []),
      `coverageContract.${key} must be sorted`,
    );
    addIssue(
      issues,
      JSON.stringify(coverage?.[key]) === JSON.stringify(REQUIRED_COVERAGE[key]),
      `coverageContract.${key} must exactly preserve the mission coverage floor`,
    );
  }
}

function validateSealedCase(item, label, bundlePath, issues) {
  addIssue(issues, exactKeys(item, CASE_KEYS), `${label}: keys drift`);
  addIssue(issues, /^hc-[0-9a-f]{24}$/u.test(item?.id ?? ''), `${label}: invalid opaque id`);
  validateHoldoutPayloadEnvelope(item?.payloadEnvelope, {
    caseId: item?.id,
    bundlePath,
    issues,
    label,
  });
}

function walkRegularFiles(root, issues) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['.git', 'broadcast', 'cache', 'coverage', 'node_modules', 'out'].includes(entry.name)) continue;
    const absolutePath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      issues.push(`shipped skill contains symbolic link: ${path.relative(root, absolutePath)}`);
    } else if (entry.isDirectory()) {
      files.push(...walkRegularFiles(absolutePath, issues));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function safeDevelopmentCorpusPath(developmentRoot, relativePath, issues, label) {
  addIssue(
    issues,
    typeof relativePath === 'string'
      && /^(?:cases\/[a-z0-9-]+\.md|rubrics\/[a-z0-9-]+\.txt)$/u.test(relativePath),
    `${label}: development corpus path is invalid`,
  );
  if (typeof relativePath !== 'string') return null;
  const absolutePath = path.resolve(developmentRoot, relativePath);
  const relative = path.relative(developmentRoot, absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    issues.push(`${label}: development corpus path escapes root`);
    return null;
  }
  try {
    const stat = fs.lstatSync(absolutePath);
    addIssue(issues, stat.isFile() && !stat.isSymbolicLink(), `${label}: development corpus file must be regular`);
  } catch (error) {
    issues.push(`${label}: development corpus file cannot be read: ${error.message}`);
    return null;
  }
  return absolutePath;
}

function loadPublicCorpus(repositoryRoot, issues) {
  const developmentRoot = path.join(repositoryRoot, DEV_ROOT);
  const manifestPath = path.join(repositoryRoot, DEV_MANIFEST);
  const manifest = readJson(manifestPath, issues, 'development eval manifest');
  const cases = Array.isArray(manifest?.cases) ? manifest.cases : [];
  const records = [{ path: 'suite.json', sha256: sha256(fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : Buffer.alloc(0)) }];
  const caseIds = new Set();
  for (const [index, item] of cases.entries()) {
    const label = `development eval manifest cases[${index}]`;
    addIssue(issues, typeof item?.id === 'string' && !caseIds.has(item.id), `${label}: duplicate or invalid id`);
    caseIds.add(item?.id);
    for (const key of ['prompt', 'rubric']) {
      const absolutePath = safeDevelopmentCorpusPath(developmentRoot, item?.[key], issues, `${label}.${key}`);
      if (!absolutePath) continue;
      records.push({ path: item[key], sha256: sha256(fs.readFileSync(absolutePath)) });
    }
  }
  const uniqueRecords = [...new Map(records.map((record) => [record.path, record])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
  addIssue(issues, uniqueRecords.length === 1 + cases.length * 2, 'development corpus paths must be unique and complete');
  return {
    manifest,
    cases,
    caseIds,
    sha256: sha256(uniqueRecords.map((record) => `${record.path}\0${record.sha256}\n`).join('')),
  };
}

function validateNoHoldoutLeakage(repositoryRoot, cases, publicCaseIds, issues) {
  const roots = [SKILL_ROOT, DEV_ROOT];
  for (const relativeRoot of roots) {
    const scanRoot = path.join(repositoryRoot, relativeRoot);
    const files = walkRegularFiles(scanRoot, issues);
    for (const filePath of files) {
      const bytes = fs.readFileSync(filePath);
      const relativePath = path.relative(repositoryRoot, filePath);
      if (bytes.includes(Buffer.from('programmable-e2e-sealed-holdout'))) {
        issues.push(`sealed holdout marker leaked into ${relativePath}`);
      }
      const content = bytes.toString('utf8');
      for (const item of cases) {
        if (content.includes(item.id)) {
          issues.push(`holdout ${item.id} leaked into ${relativePath}`);
        }
      }
    }
  }
  for (const item of cases) {
    addIssue(issues, !publicCaseIds.has(item.id), `holdout id duplicates public corpus id ${item.id}`);
  }
}

export function loadHoldoutCorpus({ repositoryRoot }) {
  const issues = [];
  const resolvedRoot = path.resolve(repositoryRoot);
  const manifestPath = path.join(resolvedRoot, HOLDOUT_MANIFEST);
  const holdoutRoot = path.dirname(manifestPath);
  const manifestBytes = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath) : Buffer.alloc(0);
  const manifest = readJson(manifestPath, issues, 'holdout manifest');
  addIssue(issues, exactKeys(manifest, ROOT_KEYS), 'holdout manifest root keys drift');
  addIssue(issues, manifest?.schemaVersion === '1.0.0', 'holdout manifest schemaVersion must be 1.0.0');
  addIssue(issues, manifest?.kind === 'programmable-e2e-sealed-holdout', 'holdout manifest kind drift');
  addIssue(issues, Number.isInteger(manifest?.minimumRepetitions) && manifest.minimumRepetitions >= 3, 'minimumRepetitions must be at least 3');
  addIssue(issues, manifest?.novelMinimumPassBps === 8500, 'novel holdout threshold must be 85%');
  validateTierProfiles(manifest ?? {}, issues);
  validateContracts(manifest ?? {}, issues);
  validateCoverageContract(manifest ?? {}, issues);

  const publicCorpus = loadPublicCorpus(resolvedRoot, issues);
  const devCaseCount = publicCorpus.cases.length;
  addIssue(issues, manifest?.devCaseCount === devCaseCount, 'holdout manifest devCaseCount drift');
  addIssue(issues, manifest?.publicCorpusSha256 === publicCorpus.sha256, 'publicCorpusSha256 mismatch');

  const bundleRecords = [];
  const cases = [];
  const caseIds = new Set();
  addIssue(issues, Array.isArray(manifest?.bundleFiles) && manifest.bundleFiles.length >= 2, 'holdout bundles must be split across bounded files');
  addIssue(
    issues,
    JSON.stringify((manifest?.bundleFiles ?? []).map(({ path: bundlePath }) => bundlePath))
      === JSON.stringify((manifest?.bundleFiles ?? []).map(({ path: bundlePath }) => bundlePath).sort()),
    'holdout bundle paths must be sorted',
  );
  for (const [bundleIndex, bundleRecord] of (manifest?.bundleFiles ?? []).entries()) {
    const label = `bundleFiles[${bundleIndex}]`;
    addIssue(issues, exactKeys(bundleRecord, ['path', 'sha256']), `${label}: keys drift`);
    addIssue(issues, /^[0-9a-f]{64}$/u.test(bundleRecord?.sha256 ?? ''), `${label}: sha256 is invalid`);
    const bundlePath = safeBundlePath(holdoutRoot, bundleRecord?.path, issues);
    if (!bundlePath) continue;
    const bundleBytes = fs.readFileSync(bundlePath);
    const digest = sha256(bundleBytes);
    addIssue(issues, digest === bundleRecord.sha256, `${label}: manifest hash mismatch for ${bundleRecord.path}`);
    const bundle = readJson(bundlePath, issues, `holdout bundle ${bundleRecord.path}`);
    addIssue(
      issues,
      exactKeys(bundle, ['cases', 'kind', 'schemaVersion'])
        && bundle.schemaVersion === '1.0.0'
        && bundle.kind === 'programmable-e2e-holdout-bundle',
      `${label}: bundle contract drift`,
    );
    addIssue(issues, Array.isArray(bundle?.cases) && bundle.cases.length > 0 && bundle.cases.length <= 8, `${label}: bundle must contain 1-8 cases`);
    for (const [caseIndex, item] of (bundle?.cases ?? []).entries()) {
      const caseLabel = `${label}.cases[${caseIndex}]`;
      validateSealedCase(item, caseLabel, bundleRecord.path, issues);
      addIssue(issues, !caseIds.has(item.id), `${caseLabel}: duplicate id ${item.id}`);
      caseIds.add(item.id);
      cases.push({ ...item, bundlePath: bundleRecord.path });
    }
    bundleRecords.push({ path: bundleRecord.path, sha256: digest });
  }

  const corpusDigest = sha256(bundleRecords.map(({ path: bundlePath, sha256: digest }) => `${bundlePath}\0${digest}\n`).join(''));
  const combinedCorpusSha256 = sha256(`public\0${publicCorpus.sha256}\nholdout\0${corpusDigest}\n`);
  addIssue(issues, corpusDigest === manifest?.holdoutCorpusSha256, 'holdoutCorpusSha256 mismatch');
  addIssue(issues, combinedCorpusSha256 === manifest?.combinedCorpusSha256, 'combinedCorpusSha256 mismatch');
  addIssue(issues, cases.length === manifest?.holdoutCaseCount, 'holdoutCaseCount drift');
  addIssue(
    issues,
    Array.isArray(manifest?.hardGateCaseIds)
      && new Set(manifest.hardGateCaseIds).size === manifest.hardGateCaseIds.length
      && JSON.stringify(manifest.hardGateCaseIds) === JSON.stringify(REQUIRED_HARD_GATE_CASE_IDS),
    'hardGateCaseIds must exactly preserve the foundational security invariant gate',
  );
  for (const hardGateCaseId of manifest?.hardGateCaseIds ?? []) {
    addIssue(issues, caseIds.has(hardGateCaseId), `hardGateCaseIds references missing holdout case ${hardGateCaseId}`);
  }
  if (fs.existsSync(path.join(resolvedRoot, SKILL_ROOT))) {
    validateNoHoldoutLeakage(resolvedRoot, cases, publicCorpus.caseIds, issues);
  }
  if (issues.length > 0) throw new E2EStructureError(issues);

  return {
    manifest,
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    publicCorpusSha256: publicCorpus.sha256,
    holdoutCorpusSha256: corpusDigest,
    combinedCorpusSha256,
    corpusSha256: combinedCorpusSha256,
    cases,
  };
}

export function validateRevealedHoldoutCases({ corpus, cases }) {
  const issues = [];
  const manifest = corpus?.manifest ?? {};
  const expectedIds = new Set((corpus?.cases ?? []).map(({ id }) => id));
  const observedIds = new Set((cases ?? []).map(({ id }) => id));
  addIssue(issues, Array.isArray(cases) && cases.length === expectedIds.size, 'revealed holdout case count drift');
  addIssue(
    issues,
    observedIds.size === expectedIds.size && [...expectedIds].every((id) => observedIds.has(id)),
    'revealed holdout ids drift',
  );
  const observed = {
    categories: new Set((cases ?? []).map(({ category }) => category)),
    languages: new Set((cases ?? []).map(({ language }) => language)),
    mutations: new Set((cases ?? []).flatMap(({ mutations }) => mutations)),
    variants: new Set((cases ?? []).flatMap(({ variants }) => variants)),
  };
  for (const [key, requiredValues] of Object.entries(manifest.coverageContract ?? {})) {
    for (const required of requiredValues) {
      addIssue(issues, observed[key]?.has(required), `revealed holdout corpus does not cover ${key}:${required}`);
    }
  }
  addIssue(issues, (cases ?? []).filter(({ novel }) => novel).length >= 8, 'revealed holdout corpus must contain at least eight declared novel cases');
  addIssue(issues, (cases ?? []).some(({ forkRequired }) => forkRequired), 'revealed holdout corpus must contain fork-required cases');
  addIssue(issues, (cases ?? []).some(({ forkRequired }) => !forkRequired), 'revealed holdout corpus must contain non-fork cases');
  const hardGateCases = (cases ?? []).filter(({ id }) => manifest.hardGateCaseIds?.includes(id));
  addIssue(issues, hardGateCases.length === manifest.hardGateCaseIds?.length, 'revealed hard-gate case set drift');
  for (const mutation of manifest.coverageContract?.mutations ?? []) {
    addIssue(
      issues,
      hardGateCases.some(({ mutations }) => mutations.includes(mutation)),
      `hard-gate cases do not cover mutation:${mutation}`,
    );
  }
  if (issues.length > 0) throw new E2EStructureError(issues);
  const records = [...cases].sort((left, right) => left.id.localeCompare(right.id)).map((item) => ({
    id: item.id,
    category: item.category,
    forkRequired: item.forkRequired,
    language: item.language,
    mutations: item.mutations,
    novel: item.novel,
    promptSha256: sha256(item.prompt),
    rubricSha256: sha256(canonicalJson(item.rubric)),
    variants: item.variants,
  }));
  return Object.freeze({
    caseCount: records.length,
    hardGateCaseCount: hardGateCases.length,
    declaredNovelCaseCount: cases.filter(({ novel }) => novel).length,
    forkCaseCount: cases.filter(({ forkRequired }) => forkRequired).length,
    revealedCoverageSha256: sha256(canonicalJson(records)),
  });
}

const validatedCorpusStateByStructure = new WeakMap();

function canonicalRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new E2EStructureError(['repositoryRoot must be a non-empty path']);
  }
  try {
    const canonicalRoot = fs.realpathSync.native(path.resolve(repositoryRoot));
    if (!fs.statSync(canonicalRoot).isDirectory()) {
      throw new Error('not a directory');
    }
    return canonicalRoot;
  } catch (error) {
    throw new E2EStructureError([`repositoryRoot cannot be resolved to a canonical directory: ${error.message}`]);
  }
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

export function validateE2EStructure({ repositoryRoot }) {
  const canonicalRoot = canonicalRepositoryRoot(repositoryRoot);
  const corpus = loadHoldoutCorpus({ repositoryRoot: canonicalRoot });
  const {
    manifest,
    manifestSha256,
    publicCorpusSha256,
    holdoutCorpusSha256,
    combinedCorpusSha256,
    cases,
  } = corpus;
  const structure = deepFreeze({
    status: 'E2E_ENVELOPES_VALID',
    publicResponseEvalCaseCount: manifest.devCaseCount,
    sealedRepositoryCaseEnvelopeCount: cases.length,
    comparableRepositoryPopulationAvailable: false,
    crossMethodRatioClaimed: false,
    payloadValidation: 'requires-external-key-and-trusted-execution',
    minimumRepetitions: manifest.minimumRepetitions,
    tierProfiles: manifest.tierProfiles.map(({ id }) => id),
    manifestSha256,
    publicResponseCorpusSha256: publicCorpusSha256,
    sealedRepositoryCorpusSha256: holdoutCorpusSha256,
    crossMethodInventorySha256: combinedCorpusSha256,
    modelExecution: 'not-run',
  });
  // The opaque structure object is a validated, root-bound token. Cache a
  // separate deeply immutable snapshot so callers cannot weaken validated
  // state and no second corpus walk can race the subsequent CLI run.
  validatedCorpusStateByStructure.set(structure, Object.freeze({
    canonicalRoot,
    corpus: deepFreeze(structuredClone(corpus)),
  }));
  return structure;
}

export function corpusFromValidatedE2EStructure({ structure, repositoryRoot }) {
  const state = validatedCorpusStateByStructure.get(structure);
  if (!state) throw new E2EStructureError(['validated E2E structure token is not recognized']);
  if (canonicalRepositoryRoot(repositoryRoot) !== state.canonicalRoot) {
    throw new E2EStructureError(['validated E2E structure token belongs to a different repositoryRoot']);
  }
  return state.corpus;
}

export const E2E_STAGE_IDS = Object.freeze([...STAGE_IDS]);
export const E2E_ARTIFACT_IDS = Object.freeze([...ARTIFACT_IDS]);
