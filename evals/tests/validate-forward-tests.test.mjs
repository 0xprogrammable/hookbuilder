import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ForwardTestValidationError,
  validateForwardTests,
} from '../../scripts/evals/forward-test-core.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');

function withTemporaryForwardTests(mutate, assertion) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-forward-tests-'));
  try {
    fs.mkdirSync(path.join(temporaryRoot, 'evals'), { recursive: true });
    fs.cpSync(
      path.join(REPOSITORY_ROOT, 'evals/forward-tests'),
      path.join(temporaryRoot, 'evals/forward-tests'),
      { recursive: true },
    );
    const contractTarget = path.join(
      temporaryRoot,
      'skills/programmable-v4-hook-builder/references/layered-response-v1.schema.json',
    );
    fs.mkdirSync(path.dirname(contractTarget), { recursive: true });
    fs.copyFileSync(
      path.join(
        REPOSITORY_ROOT,
        'skills/programmable-v4-hook-builder/references/layered-response-v1.schema.json',
      ),
      contractTarget,
    );
    for (const sourceCase of [
      'german-plain-language-sell-burn-intent',
      'pure-service-indexer-zero-scope',
      'unsafe-drain-safe-redesign-intent',
    ]) {
      const target = path.join(
        temporaryRoot,
        `evals/suites/programmable-v4-hook-builder/cases/${sourceCase}.md`,
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(
        path.join(
          REPOSITORY_ROOT,
          `evals/suites/programmable-v4-hook-builder/cases/${sourceCase}.md`,
        ),
        target,
      );
    }
    mutate(temporaryRoot);
    assertion(temporaryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function mutateCase(temporaryRoot, caseId, mutate) {
  const filePath = path.join(temporaryRoot, `evals/forward-tests/cases/${caseId}.json`);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(value);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function expectInvalid(temporaryRoot, pattern) {
  assert.throws(
    () => validateForwardTests({ repositoryRoot: temporaryRoot }),
    (error) => {
      assert.ok(error instanceof ForwardTestValidationError);
      assert.match(error.issues.join('\n'), pattern);
      return true;
    },
  );
}

test('canonical deterministic forward tests satisfy the layered response contract', () => {
  assert.deepEqual(validateForwardTests({ repositoryRoot: REPOSITORY_ROOT }), {
    status: 'FORWARD_TESTS_VALID',
    caseCount: 6,
    decisionCaseCount: 3,
    modelEvaluation: 'not-run',
    operationsImplementation: 'design-only',
  });
});

test('the layered response schema uses the canonical urn identifier', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => {
      const schemaPath = path.join(
        temporaryRoot,
        'skills/programmable-v4-hook-builder/references/layered-response-v1.schema.json',
      );
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      schema.$id = 'https://placeholder.example/layered-response.json';
      fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /expected \$id urn:programmable:layered-response:1\.0\.0/,
    ),
  );
});

test('a decision array fails the one-decision-at-a-time contract', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => mutateCase(temporaryRoot, 'wild-multi-repo-game', (value) => {
      value.response.user.decision = [value.response.user.decision, value.response.user.decision];
    }),
    (temporaryRoot) => expectInvalid(temporaryRoot, /decision must be one object or null/),
  );
});

test('forward-test manifest paths cannot traverse outside the suite', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => {
      const manifestPath = path.join(temporaryRoot, 'evals/forward-tests/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.cases[0].path = '../outside.json';
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /path must match case id|disallowed path|traversal is forbidden/,
    ),
  );
});

test('positive approval and live claims fail the non-certifying response contract', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => mutateCase(temporaryRoot, 'zero-scope-service', (value) => {
      value.response.user.outcome = 'This project is approved and live.';
    }),
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /approval or acceptance claim lacks state evidence|live or availability claim lacks state evidence/,
    ),
  );
});

test('design-only operations cannot be promoted to a live monitoring service', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => mutateCase(temporaryRoot, 'unknown-novelty', (value) => {
      value.response.artifact.operations.monitoring = 'LIVE';
    }),
    (temporaryRoot) => expectInvalid(temporaryRoot, /monitoring must remain DESIGN_ONLY/),
  );
});

test('state histories cannot skip application preparation', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => mutateCase(temporaryRoot, 'state-status-journey', (value) => {
      value.response.artifact.statusJourney.application = [
        'NOT_PREPARED',
        'APPLIED_WAITING_REVIEW',
      ];
    }),
    (temporaryRoot) => expectInvalid(temporaryRoot, /invalid transition NOT_PREPARED -> APPLIED_WAITING_REVIEW/),
  );
});

test('a deployed but unverified state requires its specific non-certifying limitation', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => mutateCase(temporaryRoot, 'state-status-journey', (value) => {
      value.expected.currentStates.runtime = 'DEPLOYED_UNVERIFIED';
      value.response.artifact.statusJourney.runtime = [
        'NOT_DEPLOYED',
        'DEPLOYED_UNVERIFIED',
      ];
    }),
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /limitations must exactly match current independent states|missing limitation DEPLOYMENT_NOT_RUNTIME_VERIFIED/,
    ),
  );
});

test('a passed gate cannot cite missing evidence', () => {
  withTemporaryForwardTests(
    (temporaryRoot) => mutateCase(temporaryRoot, 'zero-scope-service', (value) => {
      value.response.artifact.gates.find((gate) => gate.id === 'intent-fidelity').evidenceRefs = [
        'implementation-evidence',
      ];
    }),
    (temporaryRoot) => expectInvalid(temporaryRoot, /passed gate evidence implementation-evidence must be recorded/),
  );
});
