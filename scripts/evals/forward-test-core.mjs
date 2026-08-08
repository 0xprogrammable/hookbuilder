#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');
const FORWARD_TEST_ROOT = 'evals/forward-tests';
const CONTRACT_PATH = 'skills/programmable-v4-hook-builder/references/layered-response-v1.schema.json';
const CONTRACT_ID = 'urn:programmable:layered-response:1.0.0';

const REQUIRED_CASE_IDS = Object.freeze([
  'novice-german-contract-curve',
  'wild-multi-repo-game',
  'zero-scope-service',
  'unknown-novelty',
  'unsafe-redesign',
  'state-status-journey',
]);

const REQUIRED_LIMITATIONS = Object.freeze([
  'DESIGN_NOT_APPROVAL',
  'LOCAL_CHECKS_NOT_AUDIT',
  'NOT_DEPLOYED',
  'PROVIDER_SUPPORT_UNRESOLVED',
  'NOT_PUBLICLY_AVAILABLE',
]);

const ALLOWED_LIMITATIONS = Object.freeze([
  ...REQUIRED_LIMITATIONS,
  'DEPLOYMENT_NOT_RUNTIME_VERIFIED',
]);

const ROUTES = Object.freeze([
  null,
  'DIRECT_BUILD',
  'CUSTOM_ARCHITECTURE',
  'INTEGRATION_PENDING',
  'SAFE_REDESIGN',
]);

const FEE_APPLICABILITY = Object.freeze(['unresolved', 'not-applicable', 'applicable']);
const FACT_STATES = Object.freeze(['confirmed', 'inferred', 'default-proposed', 'unresolved']);
const EVIDENCE_STATES = Object.freeze(['recorded', 'not-run', 'missing']);
const GATE_STATES = Object.freeze(['passed', 'failed', 'blocked', 'not-run', 'not-applicable']);
const MODES = Object.freeze(['explore', 'preflight', 'prototype', 'repair', 'review', 'submit', 'handoff']);

const STATE_LANES = Object.freeze({
  design: Object.freeze({
    initial: 'IDEA_CAPTURED',
    states: Object.freeze(['IDEA_CAPTURED', 'DESIGN_REVIEW_REQUIRED', 'DESIGN_CHANGES_REQUIRED', 'DESIGN_READY']),
    transitions: Object.freeze({
      IDEA_CAPTURED: Object.freeze(['DESIGN_REVIEW_REQUIRED', 'DESIGN_CHANGES_REQUIRED', 'DESIGN_READY']),
      DESIGN_REVIEW_REQUIRED: Object.freeze(['DESIGN_CHANGES_REQUIRED', 'DESIGN_READY']),
      DESIGN_CHANGES_REQUIRED: Object.freeze(['DESIGN_REVIEW_REQUIRED', 'DESIGN_READY']),
      DESIGN_READY: Object.freeze([]),
    }),
  }),
  implementation: Object.freeze({
    initial: 'NOT_STARTED',
    states: Object.freeze(['NOT_STARTED', 'IN_PROGRESS', 'STRUCTURALLY_COMPLETE']),
    transitions: Object.freeze({
      NOT_STARTED: Object.freeze(['IN_PROGRESS']),
      IN_PROGRESS: Object.freeze(['STRUCTURALLY_COMPLETE']),
      STRUCTURALLY_COMPLETE: Object.freeze([]),
    }),
  }),
  application: Object.freeze({
    initial: 'NOT_PREPARED',
    states: Object.freeze(['NOT_PREPARED', 'PREPARED_NOT_SUBMITTED', 'APPLIED_WAITING_REVIEW', 'ACCEPTED']),
    transitions: Object.freeze({
      NOT_PREPARED: Object.freeze(['PREPARED_NOT_SUBMITTED']),
      PREPARED_NOT_SUBMITTED: Object.freeze(['APPLIED_WAITING_REVIEW']),
      APPLIED_WAITING_REVIEW: Object.freeze(['ACCEPTED']),
      ACCEPTED: Object.freeze([]),
    }),
  }),
  runtime: Object.freeze({
    initial: 'NOT_DEPLOYED',
    states: Object.freeze(['NOT_DEPLOYED', 'DEPLOYED_UNVERIFIED', 'DEPLOYED_VERIFIED']),
    transitions: Object.freeze({
      NOT_DEPLOYED: Object.freeze(['DEPLOYED_UNVERIFIED']),
      DEPLOYED_UNVERIFIED: Object.freeze(['DEPLOYED_VERIFIED']),
      DEPLOYED_VERIFIED: Object.freeze([]),
    }),
  }),
  availability: Object.freeze({
    initial: 'NOT_AVAILABLE',
    states: Object.freeze(['NOT_AVAILABLE', 'PROVIDER_PENDING', 'AVAILABLE', 'SUSPENDED', 'RETIRED']),
    transitions: Object.freeze({
      NOT_AVAILABLE: Object.freeze(['PROVIDER_PENDING']),
      PROVIDER_PENDING: Object.freeze(['AVAILABLE']),
      AVAILABLE: Object.freeze(['SUSPENDED', 'RETIRED']),
      SUSPENDED: Object.freeze(['AVAILABLE', 'RETIRED']),
      RETIRED: Object.freeze([]),
    }),
  }),
});

const OPERATIONS_KEYS = Object.freeze([
  'auditLog',
  'incidentResponse',
  'monitoring',
  'privacyRetentionTakedown',
  'rbac',
  'reviewQueue',
]);

const USER_KEYS = Object.freeze([
  'artifactRefs',
  'decision',
  'limitations',
  'nextAction',
  'outcome',
  'status',
]);

const ARTIFACT_KEYS = Object.freeze([
  'architecture',
  'deferredDecisions',
  'evidence',
  'facts',
  'feeApplicability',
  'findings',
  'gates',
  'hardConflictCode',
  'operations',
  'primaryRoute',
  'statusJourney',
]);

export class ForwardTestValidationError extends Error {
  constructor(issues) {
    super(`Forward-test validation failed with ${issues.length} issue(s)`);
    this.name = 'ForwardTestValidationError';
    this.issues = issues;
  }
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readJson(filePath, issues, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    issues.push(`${label}: cannot read ${filePath}: ${error.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    issues.push(`${label}: invalid JSON in ${filePath}: ${error.message}`);
    return null;
  }
}

function isOutsideRoot(relativePath) {
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

function safeFile(root, relativePath, pattern, issues, label) {
  addIssue(issues, typeof relativePath === 'string', `${label}: path must be a string`);
  if (typeof relativePath !== 'string') return null;
  const allowedPattern = pattern.test(relativePath);
  const hasNoTraversal = !relativePath.split('/').includes('..');
  const hasNoBackslash = !relativePath.includes('\\');
  addIssue(issues, allowedPattern, `${label}: disallowed path ${relativePath}`);
  addIssue(issues, hasNoTraversal, `${label}: traversal is forbidden`);
  addIssue(issues, hasNoBackslash, `${label}: backslashes are forbidden`);
  if (!allowedPattern || !hasNoTraversal || !hasNoBackslash) return null;

  const absolutePath = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, absolutePath);
  const remainsInsideRoot = relativeToRoot !== '' && !isOutsideRoot(relativeToRoot);
  addIssue(issues, remainsInsideRoot, `${label}: path escapes root`);
  if (!remainsInsideRoot) return null;

  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    issues.push(`${label}: missing file ${relativePath}: ${error.message}`);
    return null;
  }
  addIssue(issues, stat.isFile(), `${label}: expected regular file ${relativePath}`);
  addIssue(issues, !stat.isSymbolicLink(), `${label}: symlink is forbidden ${relativePath}`);
  return absolutePath;
}

function wordCount(value) {
  const text = String(value ?? '').trim();
  return text === '' ? 0 : text.split(/\s+/u).length;
}

function validateIdentifier(value, issues, label) {
  addIssue(issues, typeof value === 'string' && /^[a-z0-9-]+$/u.test(value), `${label}: invalid identifier`);
}

function validateUniqueIdentifiers(entries, issues, label) {
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const id = entry?.id;
    validateIdentifier(id, issues, `${label}[${index}].id`);
    addIssue(issues, !seen.has(id), `${label}: duplicate id ${id}`);
    seen.add(id);
  }
  return seen;
}

function validateDecision(decision, expectedDecisionId, issues, label) {
  if (decision === null) {
    addIssue(issues, expectedDecisionId === null, `${label}: expected decision ${expectedDecisionId}`);
    return 0;
  }

  addIssue(issues, decision && typeof decision === 'object' && !Array.isArray(decision), `${label}: decision must be one object or null`);
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return 0;
  addIssue(
    issues,
    exactKeys(decision, ['id', 'options', 'question', 'recommendedOptionId']),
    `${label}: decision keys must match the closed one-decision shape`,
  );
  validateIdentifier(decision.id, issues, `${label}.id`);
  addIssue(issues, decision.id === expectedDecisionId, `${label}: decision id does not match expected ${expectedDecisionId}`);
  addIssue(issues, typeof decision.question === 'string' && wordCount(decision.question) <= 30, `${label}: question exceeds 30 words`);
  addIssue(issues, (String(decision.question ?? '').match(/\?/gu) ?? []).length === 1, `${label}: decision question must contain exactly one question mark`);
  addIssue(issues, Array.isArray(decision.options) && decision.options.length >= 2 && decision.options.length <= 3, `${label}: decision must have two or three options`);

  const options = Array.isArray(decision.options) ? decision.options : [];
  const optionIds = validateUniqueIdentifiers(options, issues, `${label}.options`);
  for (const [index, option] of options.entries()) {
    addIssue(
      issues,
      exactKeys(option, ['consequence', 'id', 'label']),
      `${label}.options[${index}]: keys must match the closed option shape`,
    );
    addIssue(issues, wordCount(`${option?.label ?? ''} ${option?.consequence ?? ''}`) <= 30, `${label}.options[${index}]: label and consequence exceed 30 words`);
    addIssue(issues, !/[?？]/u.test(`${option?.label ?? ''}${option?.consequence ?? ''}`), `${label}.options[${index}]: only the decision question may ask a question`);
  }
  addIssue(issues, optionIds.has(decision.recommendedOptionId), `${label}: recommended option must reference one option`);
  return 1;
}

function validateUserResponse(user, expected, caseId, casePath, issues) {
  const label = `forward:${caseId}:user`;
  addIssue(issues, exactKeys(user, USER_KEYS), `${label}: keys must match the closed user-response shape`);
  if (!user || typeof user !== 'object' || Array.isArray(user)) return 0;

  addIssue(issues, wordCount(user.outcome) >= 1 && wordCount(user.outcome) <= 45, `${label}: outcome must contain 1-45 words`);
  addIssue(issues, wordCount(user.status) >= 1 && wordCount(user.status) <= 35, `${label}: status must contain 1-35 words`);
  addIssue(issues, wordCount(user.nextAction) >= 1 && wordCount(user.nextAction) <= 35, `${label}: nextAction must contain 1-35 words`);
  for (const field of ['outcome', 'status', 'nextAction']) {
    addIssue(issues, !/[?？]/u.test(String(user[field] ?? '')), `${label}: only decision.question may contain a question mark`);
  }

  const decisionCount = validateDecision(user.decision, expected.decisionId, issues, `${label}.decision`);
  const limitations = Array.isArray(user.limitations) ? user.limitations : [];
  addIssue(issues, new Set(limitations).size === limitations.length, `${label}: limitations must be unique`);
  for (const limitation of limitations) {
    addIssue(issues, ALLOWED_LIMITATIONS.includes(limitation), `${label}: unknown limitation ${limitation}`);
  }

  const states = expected.currentStates ?? {};
  const requiredLimitations = ['LOCAL_CHECKS_NOT_AUDIT'];
  if (states.application !== 'ACCEPTED') requiredLimitations.push('DESIGN_NOT_APPROVAL');
  if (states.runtime === 'NOT_DEPLOYED') requiredLimitations.push('NOT_DEPLOYED');
  if (states.runtime === 'DEPLOYED_UNVERIFIED') requiredLimitations.push('DEPLOYMENT_NOT_RUNTIME_VERIFIED');
  if (states.availability === 'NOT_AVAILABLE' || states.availability === 'PROVIDER_PENDING') {
    requiredLimitations.push('PROVIDER_SUPPORT_UNRESOLVED');
  }
  if (states.availability !== 'AVAILABLE') requiredLimitations.push('NOT_PUBLICLY_AVAILABLE');
  addIssue(issues, limitations.length === requiredLimitations.length, `${label}: limitations must exactly match current independent states`);
  for (const limitation of requiredLimitations) {
    addIssue(issues, limitations.includes(limitation), `${label}: missing limitation ${limitation}`);
  }

  const expectedRef = `${FORWARD_TEST_ROOT}/${casePath}#/response/artifact`;
  const artifactRefs = Array.isArray(user.artifactRefs) ? user.artifactRefs : [];
  addIssue(issues, artifactRefs.length >= 1 && artifactRefs.length <= 5, `${label}: one to five artifact references are required`);
  addIssue(issues, artifactRefs.includes(expectedRef), `${label}: missing self-contained artifact reference ${expectedRef}`);
  addIssue(issues, new Set(artifactRefs).size === artifactRefs.length, `${label}: artifact references must be unique`);

  const visibleText = [user.outcome, user.status, user.nextAction, user.decision?.question]
    .filter(Boolean)
    .join(' ');
  const absoluteCertification = /\b(?:is|are|ist|sind)\s+(?:safe|secure|audited|production[- ]ready|sicher|auditiert)\b/iu;
  addIssue(issues, !absoluteCertification.test(visibleText), `${label}: positive safety or audit certification is forbidden`);
  if (states.application !== 'ACCEPTED') {
    addIssue(issues, !/\b(?:is|are|ist|sind)\s+(?:approved|accepted|genehmigt|akzeptiert)\b/iu.test(visibleText), `${label}: approval or acceptance claim lacks state evidence`);
  }
  if (states.runtime === 'NOT_DEPLOYED') {
    addIssue(issues, !/\b(?:is|are|ist|sind)\s+(?:deployed|bereitgestellt)\b/iu.test(visibleText), `${label}: deployment claim lacks state evidence`);
  }
  if (states.runtime !== 'DEPLOYED_VERIFIED') {
    addIssue(issues, !/\b(?:runtime|laufzeit)\s+(?:is|ist)\s+(?:verified|verifiziert)\b/iu.test(visibleText), `${label}: runtime verification claim lacks state evidence`);
  }
  if (states.availability !== 'AVAILABLE') {
    addIssue(issues, !/\b(?:is|are|ist|sind)\s+(?:live|publicly available|öffentlich verfügbar)\b/iu.test(visibleText), `${label}: live or availability claim lacks state evidence`);
  }
  addIssue(issues, !/\b(?:unruggable|guaranteed safe|garantiert sicher)\b/iu.test(visibleText), `${label}: absolute safety claim is forbidden`);
  return decisionCount;
}

function validateFacts(facts, issues, label) {
  addIssue(issues, Array.isArray(facts) && facts.length >= 3, `${label}: at least three facts are required`);
  const entries = Array.isArray(facts) ? facts : [];
  validateUniqueIdentifiers(entries, issues, label);
  for (const [index, fact] of entries.entries()) {
    addIssue(issues, exactKeys(fact, ['id', 'source', 'state', 'statement']), `${label}[${index}]: keys must match closed fact shape`);
    addIssue(issues, FACT_STATES.includes(fact?.state), `${label}[${index}]: invalid fact state`);
    addIssue(issues, typeof fact?.statement === 'string' && fact.statement.length >= 12, `${label}[${index}]: statement is too short`);
    addIssue(issues, typeof fact?.source === 'string' && fact.source.length >= 3, `${label}[${index}]: source is too short`);
  }
}

function validateFindings(findings, issues, label) {
  addIssue(issues, Array.isArray(findings) && findings.length >= 1, `${label}: at least one finding is required`);
  const entries = Array.isArray(findings) ? findings : [];
  validateUniqueIdentifiers(entries, issues, label);
  for (const [index, finding] of entries.entries()) {
    addIssue(issues, exactKeys(finding, ['effect', 'id', 'repair']), `${label}[${index}]: keys must match closed finding shape`);
    addIssue(issues, typeof finding?.effect === 'string' && finding.effect.length >= 12, `${label}[${index}]: effect is too short`);
    addIssue(issues, typeof finding?.repair === 'string' && finding.repair.length >= 12, `${label}[${index}]: repair is too short`);
  }
}

function validateEvidence(evidence, issues, label) {
  addIssue(issues, Array.isArray(evidence) && evidence.length >= 2, `${label}: at least two evidence entries are required`);
  const entries = Array.isArray(evidence) ? evidence : [];
  const ids = validateUniqueIdentifiers(entries, issues, label);
  const byId = new Map();
  for (const [index, entry] of entries.entries()) {
    addIssue(issues, exactKeys(entry, ['id', 'locator', 'meaning', 'state']), `${label}[${index}]: keys must match closed evidence shape`);
    addIssue(issues, EVIDENCE_STATES.includes(entry?.state), `${label}[${index}]: invalid evidence state`);
    addIssue(issues, typeof entry?.meaning === 'string' && entry.meaning.length >= 12, `${label}[${index}]: meaning is too short`);
    if (entry?.state === 'recorded') {
      addIssue(issues, typeof entry.locator === 'string' && entry.locator.length >= 3, `${label}[${index}]: recorded evidence needs a locator`);
    } else {
      addIssue(issues, entry?.locator === null, `${label}[${index}]: missing or not-run evidence must use a null locator`);
    }
    byId.set(entry?.id, entry);
  }
  return { byId, ids };
}

function validateGates(gates, evidenceById, issues, label) {
  addIssue(issues, Array.isArray(gates) && gates.length >= 3, `${label}: at least three gates are required`);
  const entries = Array.isArray(gates) ? gates : [];
  validateUniqueIdentifiers(entries, issues, label);
  for (const [index, gate] of entries.entries()) {
    addIssue(issues, exactKeys(gate, ['evidenceRefs', 'id', 'reason', 'state']), `${label}[${index}]: keys must match closed gate shape`);
    addIssue(issues, GATE_STATES.includes(gate?.state), `${label}[${index}]: invalid gate state`);
    addIssue(issues, typeof gate?.reason === 'string' && gate.reason.length >= 12, `${label}[${index}]: reason is too short`);
    addIssue(issues, Array.isArray(gate?.evidenceRefs), `${label}[${index}]: evidenceRefs must be an array`);
    const refs = Array.isArray(gate?.evidenceRefs) ? gate.evidenceRefs : [];
    addIssue(issues, new Set(refs).size === refs.length, `${label}[${index}]: evidenceRefs must be unique`);
    for (const ref of refs) addIssue(issues, evidenceById.has(ref), `${label}[${index}]: unknown evidence ref ${ref}`);
    if (gate?.state === 'passed') {
      addIssue(issues, refs.length >= 1, `${label}[${index}]: a passed gate needs evidence`);
      for (const ref of refs) {
        addIssue(issues, evidenceById.get(ref)?.state === 'recorded', `${label}[${index}]: passed gate evidence ${ref} must be recorded`);
      }
    }
  }
}

function validateStatusJourney(statusJourney, expectedStates, issues, label) {
  const lanes = Object.keys(STATE_LANES).sort();
  addIssue(issues, exactKeys(statusJourney, lanes), `${label}: keys must match independent state lanes`);
  if (!statusJourney || typeof statusJourney !== 'object' || Array.isArray(statusJourney)) return;

  for (const [lane, contract] of Object.entries(STATE_LANES)) {
    const history = statusJourney[lane];
    addIssue(issues, Array.isArray(history) && history.length >= 1, `${label}.${lane}: non-empty history required`);
    if (!Array.isArray(history) || history.length === 0) continue;
    addIssue(issues, history[0] === contract.initial, `${label}.${lane}: history must start at ${contract.initial}`);
    for (const [index, state] of history.entries()) {
      addIssue(issues, contract.states.includes(state), `${label}.${lane}[${index}]: unknown state ${state}`);
      if (index === 0) continue;
      const previous = history[index - 1];
      addIssue(
        issues,
        contract.transitions[previous]?.includes(state),
        `${label}.${lane}: invalid transition ${previous} -> ${state}`,
      );
    }
    addIssue(issues, history.at(-1) === expectedStates[lane], `${label}.${lane}: current state does not match expected ${expectedStates[lane]}`);
  }
}

function validateArtifact(artifact, expected, caseId, issues) {
  const label = `forward:${caseId}:artifact`;
  addIssue(issues, exactKeys(artifact, ARTIFACT_KEYS), `${label}: keys must match the closed evidence-artifact shape`);
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return;

  addIssue(issues, ROUTES.includes(artifact.primaryRoute), `${label}: invalid primary route`);
  addIssue(issues, artifact.primaryRoute === expected.primaryRoute, `${label}: primary route does not match expected`);
  addIssue(issues, FEE_APPLICABILITY.includes(artifact.feeApplicability), `${label}: invalid fee applicability`);
  addIssue(issues, artifact.feeApplicability === expected.feeApplicability, `${label}: fee applicability does not match expected`);
  addIssue(issues, artifact.hardConflictCode === expected.hardConflictCode, `${label}: hard conflict does not match expected`);
  addIssue(issues, artifact.hardConflictCode === null || /^[A-Z0-9_]+$/u.test(artifact.hardConflictCode), `${label}: invalid hard-conflict code`);
  if (artifact.hardConflictCode !== null) {
    addIssue(issues, artifact.primaryRoute === 'SAFE_REDESIGN', `${label}: a hard conflict must route to SAFE_REDESIGN`);
  }
  if (artifact.primaryRoute === 'SAFE_REDESIGN') {
    addIssue(issues, artifact.hardConflictCode !== null, `${label}: SAFE_REDESIGN needs a concrete hard-conflict code`);
  }
  if (artifact.primaryRoute === null) {
    addIssue(issues, expected.decisionId !== null, `${label}: an unresolved route needs the next material decision`);
  }

  validateFacts(artifact.facts, issues, `${label}.facts`);
  addIssue(issues, Array.isArray(artifact.deferredDecisions), `${label}: deferredDecisions must be an array`);
  const deferred = Array.isArray(artifact.deferredDecisions) ? artifact.deferredDecisions : [];
  addIssue(issues, new Set(deferred).size === deferred.length, `${label}: deferred decisions must be unique`);
  for (const decisionId of deferred) validateIdentifier(decisionId, issues, `${label}.deferredDecisions`);
  addIssue(issues, !deferred.includes(expected.decisionId), `${label}: current decision must not be duplicated as deferred`);

  const architecture = Array.isArray(artifact.architecture) ? artifact.architecture : [];
  addIssue(issues, architecture.length >= 1, `${label}: architecture details are required`);
  for (const [index, item] of architecture.entries()) {
    addIssue(issues, typeof item === 'string' && item.length >= 12, `${label}.architecture[${index}]: detail is too short`);
  }
  validateFindings(artifact.findings, issues, `${label}.findings`);
  const { byId: evidenceById } = validateEvidence(artifact.evidence, issues, `${label}.evidence`);
  validateGates(artifact.gates, evidenceById, issues, `${label}.gates`);
  validateStatusJourney(artifact.statusJourney, expected.currentStates ?? {}, issues, `${label}.statusJourney`);

  addIssue(issues, exactKeys(artifact.operations, OPERATIONS_KEYS), `${label}: operations keys must match the design-only model`);
  for (const key of OPERATIONS_KEYS) {
    addIssue(issues, artifact.operations?.[key] === 'DESIGN_ONLY', `${label}: ${key} must remain DESIGN_ONLY`);
  }

  if (artifact.feeApplicability === 'not-applicable') {
    const scopeText = JSON.stringify(artifact.facts);
    addIssue(
      issues,
      /zero|no programmable-canonical|no token, pool, hook, swap/iu.test(scopeText),
      `${label}: not-applicable fees need an explicit zero-scope fact`,
    );
  }

  const operationsClaims = JSON.stringify(artifact);
  addIssue(
    issues,
    !/queue is live|live reviewer queue|rbac is enforced|immutable audit log|monitoring is active|on-call is active/iu.test(operationsClaims),
    `${label}: design-only operations must not be described as live`,
  );
}

function validateCase(value, caseEntry, repositoryRoot, issues) {
  const label = `forward:${caseEntry.id}`;
  addIssue(
    issues,
    exactKeys(value, ['expected', 'id', 'input', 'locale', 'mode', 'response', 'schemaVersion', 'title']),
    `${label}: case keys must match the closed forward-test shape`,
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { decisionCount: 0 };
  addIssue(issues, value.schemaVersion === '1.0.0', `${label}: schemaVersion must be 1.0.0`);
  addIssue(issues, value.id === caseEntry.id, `${label}: id does not match manifest`);
  addIssue(issues, typeof value.title === 'string' && value.title.length >= 12, `${label}: realistic title required`);
  addIssue(issues, MODES.includes(value.mode), `${label}: invalid mode ${value.mode}`);
  addIssue(issues, typeof value.locale === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(value.locale), `${label}: invalid locale`);
  addIssue(issues, exactKeys(value.input, ['sourceCase', 'summary']), `${label}: input keys must match closed shape`);
  addIssue(issues, typeof value.input?.summary === 'string' && wordCount(value.input.summary) >= 15, `${label}: input summary is too small`);
  if (value.input?.sourceCase !== null) {
    safeFile(repositoryRoot, value.input.sourceCase, /^evals\/suites\/programmable-v4-hook-builder\/cases\/[a-z0-9-]+\.md$/u, issues, `${label}: sourceCase`);
  }

  addIssue(
    issues,
    exactKeys(value.expected, ['currentStates', 'decisionId', 'feeApplicability', 'hardConflictCode', 'primaryRoute']),
    `${label}: expected keys must match closed shape`,
  );
  const expected = value.expected ?? {};
  addIssue(issues, ROUTES.includes(expected.primaryRoute), `${label}: invalid expected route`);
  addIssue(issues, FEE_APPLICABILITY.includes(expected.feeApplicability), `${label}: invalid expected fee applicability`);
  addIssue(issues, expected.decisionId === null || /^[a-z0-9-]+$/u.test(expected.decisionId), `${label}: invalid expected decision id`);
  addIssue(issues, expected.hardConflictCode === null || /^[A-Z0-9_]+$/u.test(expected.hardConflictCode), `${label}: invalid expected hard conflict`);
  addIssue(issues, exactKeys(expected.currentStates, Object.keys(STATE_LANES).sort()), `${label}: expected current states must include every lane`);

  addIssue(issues, exactKeys(value.response, ['artifact', 'schemaVersion', 'user']), `${label}: response keys must match layered contract`);
  addIssue(issues, value.response?.schemaVersion === '1.0.0', `${label}: response schemaVersion must be 1.0.0`);
  const decisionCount = validateUserResponse(value.response?.user, expected, caseEntry.id, caseEntry.path, issues);
  validateArtifact(value.response?.artifact, expected, caseEntry.id, issues);
  return { decisionCount };
}

export function validateForwardTests({ repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  const issues = [];
  const root = path.resolve(repositoryRoot);
  const forwardRoot = path.join(root, FORWARD_TEST_ROOT);
  const manifest = readJson(path.join(forwardRoot, 'manifest.json'), issues, 'forward manifest');
  const contract = readJson(path.join(root, CONTRACT_PATH), issues, 'layered response contract');

  addIssue(issues, contract?.$id === CONTRACT_ID, `layered response contract: expected $id ${CONTRACT_ID}`);
  addIssue(
    issues,
    exactKeys(manifest, ['cases', 'kind', 'responseContract', 'schemaVersion']),
    'forward manifest: keys must match closed shape',
  );
  addIssue(issues, manifest?.schemaVersion === '1.0.0', 'forward manifest: schemaVersion must be 1.0.0');
  addIssue(issues, manifest?.kind === 'programmable-layered-response-forward-tests', 'forward manifest: kind mismatch');
  addIssue(issues, manifest?.responseContract === CONTRACT_PATH, 'forward manifest: response contract path mismatch');
  addIssue(issues, Array.isArray(manifest?.cases), 'forward manifest: cases must be an array');

  const cases = Array.isArray(manifest?.cases) ? manifest.cases : [];
  addIssue(issues, cases.length === REQUIRED_CASE_IDS.length, `forward manifest: expected exactly ${REQUIRED_CASE_IDS.length} cases`);
  const seen = new Set();
  let decisionCaseCount = 0;
  for (const [index, entry] of cases.entries()) {
    const label = `forward manifest: cases[${index}]`;
    addIssue(issues, exactKeys(entry, ['id', 'path']), `${label}: keys must match closed case entry`);
    validateIdentifier(entry?.id, issues, `${label}.id`);
    addIssue(issues, !seen.has(entry?.id), `${label}: duplicate id ${entry?.id}`);
    seen.add(entry?.id);
    addIssue(issues, entry?.path === `cases/${entry?.id}.json`, `${label}: path must match case id`);
    const casePath = safeFile(forwardRoot, entry?.path, /^cases\/[a-z0-9-]+\.json$/u, issues, label);
    if (!casePath) continue;
    const value = readJson(casePath, issues, label);
    decisionCaseCount += validateCase(value, entry, root, issues).decisionCount;
  }
  for (const requiredId of REQUIRED_CASE_IDS) {
    addIssue(issues, seen.has(requiredId), `forward manifest: missing required case ${requiredId}`);
  }

  if (issues.length > 0) throw new ForwardTestValidationError(issues);
  return {
    status: 'FORWARD_TESTS_VALID',
    caseCount: cases.length,
    decisionCaseCount,
    modelEvaluation: 'not-run',
    operationsImplementation: 'design-only',
  };
}

function isDirectExecution() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    process.stdout.write(`${JSON.stringify(validateForwardTests())}\n`);
  } catch (error) {
    if (error instanceof ForwardTestValidationError) {
      for (const issue of error.issues) process.stderr.write(`FORWARD_TEST_INVALID: ${issue}\n`);
    } else {
      process.stderr.write(`FORWARD_TEST_INVALID: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
