import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  E2EHoldoutRevealError,
  E2EStructureError,
  loadHoldoutCorpus,
  revealHoldoutCase,
  sha256,
} from '../../scripts/evals/e2e-corpus-core.mjs';
import {
  buildHoldoutCaseAuthenticatedData,
} from '../../scripts/evals/e2e-holdout-crypto-core.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
const TRANSIENT = new Set(['broadcast', 'cache', 'coverage', 'node_modules', 'out']);

function withTemporaryRepository(mutate, assertion) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-corpus-test-'));
  try {
    fs.cpSync(path.join(REPOSITORY_ROOT, 'evals'), path.join(temporaryRoot, 'evals'), { recursive: true });
    fs.mkdirSync(path.join(temporaryRoot, 'skills'), { recursive: true });
    fs.cpSync(
      path.join(REPOSITORY_ROOT, 'skills/programmable-v4-hook-builder'),
      path.join(temporaryRoot, 'skills/programmable-v4-hook-builder'),
      { recursive: true, filter: (source) => !TRANSIENT.has(path.basename(source)) },
    );
    mutate(temporaryRoot);
    assertion(temporaryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function expectIssue(temporaryRoot, pattern) {
  assert.throws(
    () => loadHoldoutCorpus({ repositoryRoot: temporaryRoot }),
    (error) => {
      assert.ok(error instanceof E2EStructureError);
      assert.match(error.issues.join('\n'), pattern);
      return true;
    },
  );
}

function sealSyntheticCase({ caseId, bundlePath, key, payload }) {
  const plaintext = Buffer.from(canonicalJson(payload), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(buildHoldoutCaseAuthenticatedData({ caseId, bundlePath }));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    ciphertext: ciphertext.toString('base64'),
    ciphertextSha256: sha256(ciphertext),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function withEphemeralKey(assertion) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-e2e-key-test-'));
  const keyFilePath = path.join(temporaryRoot, 'holdout.key');
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyFilePath, key, { mode: 0o600 });
    fs.chmodSync(keyFilePath, 0o600);
    assertion({ key, keyFilePath, temporaryRoot });
  } finally {
    key.fill(0);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test('holdout bundle mutation breaks the byte-bound holdout and combined hashes', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const bundlePath = path.join(temporaryRoot, 'evals/holdout/bundles/foundations.json');
      fs.appendFileSync(bundlePath, ' ');
    },
    (temporaryRoot) => expectIssue(temporaryRoot, /manifest hash mismatch|holdoutCorpusSha256 mismatch|combinedCorpusSha256 mismatch/),
  );
});

test('validate-only detects ciphertext envelope hash drift without decrypting', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const bundlePath = path.join(temporaryRoot, 'evals/holdout/bundles/foundations.json');
      const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
      const ciphertext = Buffer.from(bundle.cases[0].payloadEnvelope.ciphertext, 'base64');
      ciphertext[0] ^= 1;
      bundle.cases[0].payloadEnvelope.ciphertext = ciphertext.toString('base64');
      fs.writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
    },
    (temporaryRoot) => expectIssue(temporaryRoot, /payloadEnvelope ciphertextSha256 mismatch/),
  );
});

test('public prompt mutation breaks the independently recorded public corpus hash', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const promptPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/cases/ordinary-coin-official-launchpad.md',
      );
      fs.appendFileSync(promptPath, '\nPublic corpus drift.\n');
    },
    (temporaryRoot) => expectIssue(temporaryRoot, /publicCorpusSha256 mismatch|combinedCorpusSha256 mismatch/),
  );
});

test('hard-gate IDs are manifest-bound to exact existing foundational cases', () => {
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  assert.deepEqual(corpus.manifest.hardGateCaseIds, [
    'hc-9e87089c8effb4c449813f66',
    'hc-e1b85d80d0e270e4cc8963da',
    'hc-0106c0aae2a65eeb1c35e488',
    'hc-d82f7573e91b4ce4f1789cd7',
    'hc-b0ae75fd49e4e414edecf6d8',
    'hc-24ea80d5f2284b14139e822e',
    'hc-08c1e8f8b889002b973801a7',
    'hc-8369aec1c981de5188b76d37',
  ]);
  const caseIds = new Set(corpus.cases.map(({ id }) => id));
  assert.ok(corpus.manifest.hardGateCaseIds.every((id) => caseIds.has(id)));

  withTemporaryRepository(
    (temporaryRoot) => {
      const manifestPath = path.join(temporaryRoot, 'evals/holdout/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.hardGateCaseIds[0] = 'missing-hard-gate-case';
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    (temporaryRoot) => expectIssue(
      temporaryRoot,
      /hardGateCaseIds must exactly preserve|hardGateCaseIds references missing holdout case/,
    ),
  );
});

test('committed bundles expose only opaque IDs and complete payload envelopes', () => {
  const corpus = loadHoldoutCorpus({ repositoryRoot: REPOSITORY_ROOT });
  assert.equal(corpus.cases.length, 24);
  for (const item of corpus.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['bundlePath', 'id', 'payloadEnvelope']);
    assert.match(item.id, /^hc-[0-9a-f]{24}$/u);
    assert.deepEqual(Object.keys(item.payloadEnvelope).sort(), [
      'algorithm',
      'ciphertext',
      'ciphertextSha256',
      'iv',
      'tag',
    ]);
  }
  for (const name of fs.readdirSync(path.join(REPOSITORY_ROOT, 'evals/holdout/bundles')).sort()) {
    const bundle = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'evals/holdout/bundles', name), 'utf8'));
    for (const item of bundle.cases) assert.deepEqual(Object.keys(item).sort(), ['id', 'payloadEnvelope']);
  }
});

test('lazy reveal decrypts a complete synthetic case without plaintext or base64 leakage', () => {
  withEphemeralKey(({ key, keyFilePath }) => {
    const payload = {
      category: 'basic-v4',
      forkRequired: false,
      language: 'en',
      mutations: ['permission-bits'],
      novel: false,
      prompt: 'Build a synthetic local v4 repository with deterministic deployment evidence, explicit permission validation, complete tests, safe defaults, documented assumptions, and no external publication or network mutation.',
      rubric: {
        required: [
          'Synthetic required criterion alpha remains secret until reveal.',
          'Synthetic required criterion beta is also substantive and private.',
        ],
        forbidden: [
          'Synthetic forbidden criterion gamma must not be exposed early.',
          'Synthetic forbidden criterion delta must remain authenticated.',
        ],
      },
      variants: ['no-hook'],
    };
    const caseRecord = {
      id: 'hc-111111111111111111111111',
      bundlePath: 'bundles/synthetic.json',
      payloadEnvelope: sealSyntheticCase({
        caseId: 'hc-111111111111111111111111',
        bundlePath: 'bundles/synthetic.json',
        key,
        payload,
      }),
    };
    const encodedEnvelope = JSON.stringify(caseRecord.payloadEnvelope);
    const privateStrings = [
      payload.prompt,
      ...payload.rubric.required,
      ...payload.rubric.forbidden,
    ];
    for (const value of privateStrings) {
      assert.equal(encodedEnvelope.includes(value), false);
      assert.equal(encodedEnvelope.includes(Buffer.from(value).toString('base64')), false);
    }
    assert.equal(
      encodedEnvelope.includes(Buffer.from(canonicalJson(payload)).toString('base64')),
      false,
    );
    assert.deepEqual(revealHoldoutCase({ caseRecord, keyFilePath }), {
      id: caseRecord.id,
      bundlePath: caseRecord.bundlePath,
      ...payload,
    });
  });
});

test('lazy reveal rejects wrong keys, tampering, identity drift, and unsafe key files', () => {
  withEphemeralKey(({ key, keyFilePath, temporaryRoot }) => {
    const payload = {
      category: 'basic-v4',
      forkRequired: false,
      language: 'en',
      mutations: [],
      novel: false,
      prompt: 'Build a synthetic local v4 repository with deterministic deployment evidence, explicit permission validation, complete tests, safe defaults, documented assumptions, and no external publication or network mutation.',
      rubric: {
        required: ['Synthetic required criterion one is substantive.', 'Synthetic required criterion two is substantive.'],
        forbidden: ['Synthetic forbidden criterion one is substantive.', 'Synthetic forbidden criterion two is substantive.'],
      },
      variants: [],
    };
    const caseRecord = {
      id: 'hc-222222222222222222222222',
      bundlePath: 'bundles/synthetic.json',
      payloadEnvelope: sealSyntheticCase({
        caseId: 'hc-222222222222222222222222',
        bundlePath: 'bundles/synthetic.json',
        key,
        payload,
      }),
    };

    const wrongKeyPath = path.join(temporaryRoot, 'wrong.key');
    fs.writeFileSync(wrongKeyPath, crypto.randomBytes(32), { mode: 0o600 });
    fs.chmodSync(wrongKeyPath, 0o600);
    assert.throws(
      () => revealHoldoutCase({ caseRecord, keyFilePath: wrongKeyPath }),
      (error) => error instanceof E2EHoldoutRevealError && /authentication failed/u.test(error.message),
    );

    const tampered = structuredClone(caseRecord);
    const tag = Buffer.from(tampered.payloadEnvelope.tag, 'base64');
    tag[0] ^= 1;
    tampered.payloadEnvelope.tag = tag.toString('base64');
    assert.throws(
      () => revealHoldoutCase({ caseRecord: tampered, keyFilePath }),
      (error) => error instanceof E2EHoldoutRevealError && /authentication failed/u.test(error.message),
    );

    assert.throws(
      () => revealHoldoutCase({
        caseRecord: { ...caseRecord, id: 'hc-333333333333333333333333' },
        keyFilePath,
      }),
      (error) => error instanceof E2EHoldoutRevealError && /authentication failed/u.test(error.message),
    );

    fs.chmodSync(keyFilePath, 0o644);
    assert.throws(
      () => revealHoldoutCase({ caseRecord, keyFilePath }),
      (error) => error instanceof E2EHoldoutRevealError && /0600/u.test(error.message),
    );
  });
});
