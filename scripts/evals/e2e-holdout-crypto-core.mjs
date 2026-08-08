import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const AUTHENTICATED_DATA_PREFIX = 'programmable-e2e-holdout-case-v1';
const ENVELOPE_KEYS = [
  'algorithm',
  'ciphertext',
  'ciphertextSha256',
  'iv',
  'tag',
];
const RUBRIC_KEYS = ['forbidden', 'required'];
const PAYLOAD_KEYS = [
  'category',
  'forkRequired',
  'language',
  'mutations',
  'novel',
  'prompt',
  'rubric',
  'variants',
];
const ALLOWED_CATEGORIES = new Set([
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
]);
const ALLOWED_LANGUAGES = new Set(['de', 'en']);
const ALLOWED_MUTATIONS = new Set([
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
]);
const ALLOWED_VARIANTS = new Set([
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
]);

export class E2EHoldoutRevealError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'E2EHoldoutRevealError';
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function validateRubricShape(rubric) {
  if (!exactKeys(rubric, RUBRIC_KEYS)) return false;
  return RUBRIC_KEYS.every((key) => Array.isArray(rubric[key])
    && rubric[key].length >= 2
    && rubric[key].every((entry) => typeof entry === 'string' && entry.length >= 20));
}

function hasUniqueAllowedValues(values, allowed) {
  return Array.isArray(values)
    && new Set(values).size === values.length
    && values.every((value) => allowed.has(value));
}

function validatePayloadShape(payload) {
  if (!exactKeys(payload, PAYLOAD_KEYS)
    || !ALLOWED_CATEGORIES.has(payload.category)
    || !ALLOWED_LANGUAGES.has(payload.language)
    || typeof payload.novel !== 'boolean'
    || typeof payload.forkRequired !== 'boolean'
    || !hasUniqueAllowedValues(payload.mutations, ALLOWED_MUTATIONS)
    || !hasUniqueAllowedValues(payload.variants, ALLOWED_VARIANTS)
    || typeof payload.prompt !== 'string'
    || payload.prompt.trim().split(/\s+/u).length < 25
    || /(expected solution|expected answer|rubric|pass\s*=|fail\s*=)/iu.test(payload.prompt)
    || !validateRubricShape(payload.rubric)) {
    return false;
  }
  return [...payload.rubric.required, ...payload.rubric.forbidden]
    .every((criterion) => !payload.prompt.includes(criterion));
}

export function buildHoldoutCaseAuthenticatedData({ caseId, bundlePath }) {
  if (typeof caseId !== 'string' || typeof bundlePath !== 'string') {
    throw new TypeError('caseId and bundlePath are required for holdout case authentication');
  }
  return Buffer.from(`${AUTHENTICATED_DATA_PREFIX}\0${bundlePath}\0${caseId}`, 'utf8');
}

export function validateHoldoutPayloadEnvelope(envelope, { caseId, bundlePath, issues, label }) {
  addIssue(issues, exactKeys(envelope, ENVELOPE_KEYS), `${label}: payloadEnvelope keys drift`);
  addIssue(issues, envelope?.algorithm === ALGORITHM, `${label}: payloadEnvelope algorithm must be ${ALGORITHM}`);

  const iv = decodeCanonicalBase64(envelope?.iv);
  const tag = decodeCanonicalBase64(envelope?.tag);
  const ciphertext = decodeCanonicalBase64(envelope?.ciphertext);
  addIssue(issues, iv?.length === 12, `${label}: payloadEnvelope iv must be 96 bits`);
  addIssue(issues, tag?.length === 16, `${label}: payloadEnvelope tag must be 128 bits`);
  addIssue(issues, (ciphertext?.length ?? 0) > 0, `${label}: payloadEnvelope ciphertext is invalid`);
  addIssue(
    issues,
    /^[0-9a-f]{64}$/u.test(envelope?.ciphertextSha256 ?? '')
      && ciphertext !== null
      && sha256(ciphertext) === envelope.ciphertextSha256,
    `${label}: payloadEnvelope ciphertextSha256 mismatch`,
  );
  // Constructing the AAD here verifies that validation has all identity fields
  // needed for a later authenticated reveal, without loading any decryption key.
  buildHoldoutCaseAuthenticatedData({ caseId, bundlePath });
}

function readExternalKey(keyFilePath) {
  if (typeof keyFilePath !== 'string' || !path.isAbsolute(keyFilePath)) {
    throw new E2EHoldoutRevealError('holdout key file path must be absolute');
  }
  let stat;
  try {
    stat = fs.lstatSync(keyFilePath);
  } catch (error) {
    throw new E2EHoldoutRevealError('holdout key file cannot be read', { cause: error });
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new E2EHoldoutRevealError('holdout key file must be a regular non-symbolic file');
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new E2EHoldoutRevealError('holdout key file permissions must be 0600');
  }
  const key = fs.readFileSync(keyFilePath);
  if (key.length !== 32) {
    key.fill(0);
    throw new E2EHoldoutRevealError('holdout key must contain exactly 32 bytes');
  }
  return key;
}

export function revealHoldoutCase({ caseRecord, keyFilePath }) {
  if (!isObject(caseRecord)
    || typeof caseRecord.id !== 'string'
    || typeof caseRecord.bundlePath !== 'string'
    || !isObject(caseRecord.payloadEnvelope)) {
    throw new E2EHoldoutRevealError('sealed holdout case record is invalid');
  }

  const issues = [];
  validateHoldoutPayloadEnvelope(caseRecord.payloadEnvelope, {
    caseId: caseRecord.id,
    bundlePath: caseRecord.bundlePath,
    issues,
    label: `holdout ${caseRecord.id}`,
  });
  if (issues.length > 0) throw new E2EHoldoutRevealError('sealed holdout payload envelope is invalid');

  const key = readExternalKey(keyFilePath);
  let plaintext;
  try {
    const envelope = caseRecord.payloadEnvelope;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'), {
      authTagLength: 16,
    });
    decipher.setAAD(buildHoldoutCaseAuthenticatedData({
      caseId: caseRecord.id,
      bundlePath: caseRecord.bundlePath,
    }));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
  } catch (error) {
    throw new E2EHoldoutRevealError('holdout case authentication failed', { cause: error });
  } finally {
    key.fill(0);
  }

  try {
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (!validatePayloadShape(payload)) throw new E2EHoldoutRevealError('holdout case payload is invalid');
    const canonical = Buffer.from(canonicalJson(payload), 'utf8');
    try {
      if (canonical.length !== plaintext.length || !crypto.timingSafeEqual(canonical, plaintext)) {
        throw new E2EHoldoutRevealError('holdout case canonical encoding mismatch');
      }
    } finally {
      canonical.fill(0);
    }
    return Object.freeze({
      id: caseRecord.id,
      bundlePath: caseRecord.bundlePath,
      category: payload.category,
      forkRequired: payload.forkRequired,
      language: payload.language,
      mutations: Object.freeze([...payload.mutations]),
      novel: payload.novel,
      prompt: payload.prompt,
      rubric: Object.freeze({
        forbidden: Object.freeze([...payload.rubric.forbidden]),
        required: Object.freeze([...payload.rubric.required]),
      }),
      variants: Object.freeze([...payload.variants]),
    });
  } catch (error) {
    if (error instanceof E2EHoldoutRevealError) throw error;
    throw new E2EHoldoutRevealError('holdout case payload is invalid', { cause: error });
  } finally {
    plaintext?.fill(0);
  }
}

export const HOLDOUT_PAYLOAD_ENVELOPE_ALGORITHM = ALGORITHM;
