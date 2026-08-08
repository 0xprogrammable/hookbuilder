import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EvalValidationError,
  isOutsideRootRelative,
  validateSuite,
} from '../../scripts/evals/validate-evals.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');

function withTemporaryRepository(mutate, assertion) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-evals-test-'));
  try {
    fs.cpSync(path.join(REPOSITORY_ROOT, 'evals'), path.join(temporaryRoot, 'evals'), { recursive: true });
    fs.cpSync(path.join(REPOSITORY_ROOT, 'scripts/evals'), path.join(temporaryRoot, 'scripts/evals'), { recursive: true });
    fs.mkdirSync(path.join(temporaryRoot, 'skills'), { recursive: true });
    fs.cpSync(
      path.join(REPOSITORY_ROOT, 'skills/programmable-v4-hook-builder'),
      path.join(temporaryRoot, 'skills/programmable-v4-hook-builder'),
      { recursive: true },
    );
    mutate(temporaryRoot);
    assertion(temporaryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function expectInvalid(temporaryRoot, messagePattern) {
  assert.throws(
    () => validateSuite({ repositoryRoot: temporaryRoot }),
    (error) => {
      assert.ok(error instanceof EvalValidationError);
      assert.match(error.issues.join('\n'), messagePattern);
      return true;
    },
  );
}

test('canonical eval suite passes deterministic structure validation', () => {
  const result = validateSuite({ repositoryRoot: REPOSITORY_ROOT });
  assert.deepEqual(result, {
    status: 'EVAL_STRUCTURE_VALID',
    suiteId: 'programmable-v4-hook-builder',
    caseCount: 47,
    safetyCaseCount: 46,
    forwardTestCaseCount: 6,
    forwardTestDecisionCaseCount: 3,
    e2ePublicResponseCaseCount: 47,
    e2eSealedRepositoryEnvelopeCount: 24,
    e2eComparablePublicRepositoryCaseCount: 0,
    e2eCrossMethodRatioClaimed: false,
    e2ePayloadValidation: 'requires-external-key-and-trusted-execution',
    e2eTierProfiles: ['frontier', 'mid', 'small'],
    e2ePublicResponseCorpusSha256: '8531f0dc8221b894b77486f8c5663f67d56fb73f0ee707b88bb9af2c286839be',
    e2eSealedRepositoryCorpusSha256: 'a5ff5c220b2d9fe943fe5d453efa199856c4e2ff0e278bc5b3cfec341e9f1d9b',
    e2eCrossMethodInventorySha256: 'cc320a4ba6ecb1d269c1821ad94b6d315d8c3bf712256cc032abea479c7b6a8c',
    e2eModelExecution: 'not-run',
    modelEvaluation: 'not-run',
    upstreamCommit: '9660491dc662fea76c2f8565c2f7ba2abf6e8840',
  });
});

test('blind open-world corpus stays registered as exact binary safety cases', () => {
  const manifestPath = path.join(
    REPOSITORY_ROOT,
    'evals/suites/programmable-v4-hook-builder/suite.json',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const requiredBlindCases = [
    'zero-core-amm-custom-accounting',
    'standing-allowance-delegated-payer',
    'rwa-nav-redemption-insolvency',
    'scientific-score-value-link',
    'prediction-wagering-market',
    'participant-funded-redistribution',
    'independent-evidence-degraded-tooling',
    'exact-input-only-trading',
    'novelty-positive-control',
  ];

  for (const caseId of requiredBlindCases) {
    const evalCase = manifest.cases.find((candidate) => candidate.id === caseId);
    assert.ok(evalCase, `missing blind case ${caseId}`);
    assert.equal(evalCase.safetyCritical, true, `${caseId} must stay safety-critical`);
    assert.equal(evalCase.threshold, 1, `${caseId} must keep a binary threshold`);
  }
});

test('blind prompt, rubric and suite mutation fails the policy-bound mirror', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const promptPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/cases/exact-input-only-trading.md',
      );
      fs.appendFileSync(promptPath, '\nChanged blind prompt.\n');
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /policy-bound eval mirror content drift: cases\/exact-input-only-trading\.md/,
    ),
  );
});

test('eval validators distinguish a harmless ..x segment from exact parent traversal', () => {
  assert.equal(isOutsideRootRelative(path.join('..x-suite', 'case.md')), false);
  assert.equal(isOutsideRootRelative(path.join('..', 'case.md')), true);

  withTemporaryRepository(
    (temporaryRoot) => {
      const receiptPath = path.join(temporaryRoot, 'evals/source-receipts.json');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.files.push({
        gitBlob: '1'.repeat(40),
        path: 'packages/plugins/..x-skill/SKILL.md',
        sha256: '2'.repeat(64),
        use: 'Harmless dot-prefixed source receipt regression.',
      });
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    },
    (temporaryRoot) => assert.equal(validateSuite({ repositoryRoot: temporaryRoot }).status, 'EVAL_STRUCTURE_VALID'),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const receiptPath = path.join(temporaryRoot, 'evals/source-receipts.json');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.files.push({
        gitBlob: '1'.repeat(40),
        path: 'packages/plugins/../escaped/SKILL.md',
        sha256: '2'.repeat(64),
        use: 'This exact parent segment must remain rejected.',
      });
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /path traversal is forbidden/),
  );
});

test('safety threshold below 1.0 fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const manifestPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/suite.json',
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.cases.find((evalCase) => evalCase.id === 'hidden-fee-hard-fail').threshold = 0.99;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /safety-critical threshold must be exactly 1\.0/),
  );
});

test('promptfoo registration drift fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const configPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/promptfoo.yaml',
      );
      const config = fs.readFileSync(configPath, 'utf8');
      fs.writeFileSync(configPath, config.replace('context_profile: claims', 'context_profile: security'));
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /provider-routing-approval-separation context profile drift/),
  );
});

test('every model context profile must load the layered response contract', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const wrapperPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/prompt-wrapper.cjs',
      );
      const wrapper = fs.readFileSync(wrapperPath, 'utf8');
      fs.writeFileSync(
        wrapperPath,
        wrapper.replace("    'references/layered-response-contract.md',\n", ''),
      );
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /every context profile must load the layered response contract/,
    ),
  );
});

test('hard-coded model provider fails the provider-neutral suite contract', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const configPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/promptfoo.yaml',
      );
      const config = fs.readFileSync(configPath, 'utf8');
      fs.writeFileSync(
        configPath,
        config.replace("'{{ env.PROGRAMMABLE_EVAL_SUBJECT_PROVIDER }}'", 'anthropic:claude-sonnet-4-6'),
      );
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /must not hard-code one model provider|subject-provider template is missing/),
  );
});

test('committed model result artifact fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      fs.writeFileSync(path.join(temporaryRoot, 'evals/results.json'), '{}\n');
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /generated model result\/cache must not be committed/),
  );
});

test('official source receipt mutation fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const receiptPath = path.join(temporaryRoot, 'evals/source-receipts.json');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.commit = '0000000000000000000000000000000000000000';
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /commit must be the reviewed official snapshot/),
  );
});
