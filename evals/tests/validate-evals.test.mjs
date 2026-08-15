import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyCompleteProjectDeliveryActions,
  EvalValidationError,
  isOutsideRootRelative,
  validateSuite,
} from '../../scripts/evals/validate-evals.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
const buildPrompt = createRequire(import.meta.url)(path.join(
  REPOSITORY_ROOT,
  'evals/suites/programmable-v4-hook-builder/prompt-wrapper.cjs',
));

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

function writePromptWrapperAndMirror(temporaryRoot, wrapper) {
  const wrapperPath = path.join(
    temporaryRoot,
    'evals/suites/programmable-v4-hook-builder/prompt-wrapper.cjs',
  );
  fs.writeFileSync(wrapperPath, wrapper);

  const archivePath = path.join(
    temporaryRoot,
    'skills/programmable-v4-hook-builder/assets/test-vectors/blind-eval-definitions-v1.json',
  );
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  const wrapperEntry = archive.files.find(({ path: relativePath }) => relativePath === 'prompt-wrapper.cjs');
  wrapperEntry.content = wrapper;
  wrapperEntry.sha256 = `sha256:${crypto.createHash('sha256').update(wrapper).digest('hex')}`;
  fs.writeFileSync(archivePath, `${JSON.stringify(archive, null, 2)}\n`);
}

function writeSuiteAndMirror(temporaryRoot, manifest) {
  const suite = `${JSON.stringify(manifest, null, 2)}\n`;
  const suitePath = path.join(
    temporaryRoot,
    'evals/suites/programmable-v4-hook-builder/suite.json',
  );
  fs.writeFileSync(suitePath, suite);

  const archivePath = path.join(
    temporaryRoot,
    'skills/programmable-v4-hook-builder/assets/test-vectors/blind-eval-definitions-v1.json',
  );
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  const suiteEntry = archive.files.find(({ path: relativePath }) => relativePath === 'suite.json');
  suiteEntry.content = suite;
  suiteEntry.sha256 = `sha256:${crypto.createHash('sha256').update(suite).digest('hex')}`;
  fs.writeFileSync(archivePath, `${JSON.stringify(archive, null, 2)}\n`);
}

function writeContextProfilesAndMirror(temporaryRoot, value) {
  const content = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const contextProfilesPath = path.join(
    temporaryRoot,
    'evals/suites/programmable-v4-hook-builder/context-profiles.json',
  );
  fs.writeFileSync(contextProfilesPath, content);

  const archivePath = path.join(
    temporaryRoot,
    'skills/programmable-v4-hook-builder/assets/test-vectors/blind-eval-definitions-v1.json',
  );
  const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  let contextProfilesEntry = archive.files.find(
    ({ path: relativePath }) => relativePath === 'context-profiles.json',
  );
  if (!contextProfilesEntry) {
    contextProfilesEntry = { path: 'context-profiles.json', sha256: '', content: '' };
    archive.files.push(contextProfilesEntry);
    archive.files.sort((left, right) => left.path.localeCompare(right.path));
  }
  contextProfilesEntry.content = content;
  contextProfilesEntry.sha256 = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  fs.writeFileSync(archivePath, `${JSON.stringify(archive, null, 2)}\n`);
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
    dailySentinelPublicCaseCount: 5,
    dailySentinelPositiveTriggerCount: 5,
    dailySentinelNegativeTriggerCount: 6,
    dailySentinelQualification: 'STRUCTURE_AND_COVERAGE_ONLY',
    dailySentinelSha256: '0b6a97b2ec1a938a6ff5fe2b30c92664b89e53d62de5b14bb6047b3916cace53',
    e2ePublicResponseCaseCount: 47,
    e2eSealedRepositoryEnvelopeCount: 24,
    e2eComparablePublicRepositoryCaseCount: 0,
    e2eCrossMethodRatioClaimed: false,
    e2ePayloadValidation: 'requires-external-key-and-trusted-execution',
    e2eTierProfiles: ['frontier', 'mid', 'small'],
    e2ePublicResponseCorpusSha256: 'b8f6716f47aa62eae2a0c16ca31f6f8b0e041ef8c5b145261e5d1a2fa2c8ea9f',
    e2eSealedRepositoryCorpusSha256: 'a5ff5c220b2d9fe943fe5d453efa199856c4e2ff0e278bc5b3cfec341e9f1d9b',
    e2eCrossMethodInventorySha256: 'd0fa913a849b2b00a7e2cf973f5d11fa0b4c89d9fa7dc5d162914309aea99bc1',
    e2eModelExecution: 'not-run',
    modelEvaluation: 'not-run',
    upstreamCommit: '9660491dc662fea76c2f8565c2f7ba2abf6e8840',
  });
});

test('daily sentinel reuses public cases and keeps balanced trigger coverage', () => {
  const sentinel = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'evals/daily-sentinel.json'), 'utf8'));
  assert.equal(sentinel.qualification, 'STRUCTURE_AND_COVERAGE_ONLY');
  assert.equal(sentinel.runner, 'reuse-public-response-suite');
  assert.equal(sentinel.publicCaseIds.length, 5);
  assert.equal(sentinel.triggerPrompts.positive.length, 5);
  assert.equal(sentinel.triggerPrompts.negative.length, 6);
  assert.equal(
    sentinel.triggerPrompts.positive.filter(({ prompt }) => /\bProgrammable\b/u.test(prompt)).length,
    1,
    'exactly one explicit branded trigger must remain covered',
  );
  assert.equal(
    sentinel.triggerPrompts.positive.filter(({ prompt }) => !/\bProgrammable\b/u.test(prompt)).length,
    4,
    'the trigger corpus must contain exactly four natural v4 build intents without the brand name',
  );
  for (const { prompt } of sentinel.triggerPrompts.positive.filter(({ prompt }) => !/\bProgrammable\b/u.test(prompt))) {
    assert.match(prompt, /\bUniswap(?:[\s-]+)v4\b/iu);
    assert.match(prompt, /\b(?:build|implement|repair|review|test|upgrade|prepare|bau(?:e|en|t)?|implementier(?:e|en|t)?|reparier(?:e|en|t)?|prüf(?:e|en|t)?|test(?:e|en|t)?|verbesser(?:e|n|t)?|bereit(?:e|en|t)?|reich(?:e|en|t)?)\b/iu);
  }
  assert.ok(
    sentinel.triggerPrompts.negative.some(({ prompt }) => /\bProgrammable\b/u.test(prompt) && /\bexplanation\b/iu.test(prompt)),
    'a branded explanation-only request must stay outside the skill',
  );
  assert.ok(
    sentinel.triggerPrompts.negative.some(({ prompt }) => /\bUniswap(?:[\s-]+)v4\b/iu.test(prompt) && /\b(?:brainstorm|ideen)\b/iu.test(prompt)),
    'an unbranded v4 brainstorming-only request must stay outside the skill',
  );
  assert.ok(
    sentinel.triggerPrompts.negative.some(({ id }) => id === 'single-v4-bit-review-en'),
    'a single v4 permission-bit review must stay outside complete-project delivery',
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      candidate.publicCaseIds[0] = 'invented-daily-case';
      candidate.triggerPrompts.negative[0].expectedActivation = 'ACTIVATED';
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /daily sentinel: publicCaseIds\[0\].*existing public case id|daily sentinel: negative\[0\] activation decision drift/u,
    ),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      candidate.triggerPrompts.positive.find(({ id }) => id === 'game-theory-then-build-en').prompt =
        'Do not build or implement anything; only brainstorm possible Uniswap v4 game architectures.';
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /positive\[\d+\] must express affirmative complete-project delivery intent/u,
    ),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      candidate.triggerPrompts.negative.find(({ id }) => id === 'brainstorm-only-de').prompt =
        'Build a complete Uniswap v4 hook project with source and tests for this fee idea.';
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /negative\[\d+\] mislabels affirmative complete-project delivery as not activated/u,
    ),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      candidate.triggerPrompts.negative.find(({ id }) => id === 'single-v4-bit-review-en').prompt =
        'Review this complete Uniswap v4 hook repository and report every concrete problem.';
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /negative\[\d+\] mislabels affirmative complete-project delivery as not activated/u,
    ),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      candidate.triggerPrompts.positive.find(({ id }) => id === 'implicit-design-then-build-de').prompt =
        'Entwirf mir ein paar mögliche Architekturen für einen Uniswap-v4-Hook; wir wollen heute nur brainstormen.';
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /positive\[\d+\] must express affirmative complete-project delivery intent/u,
    ),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      candidate.triggerPrompts.positive.find(({ id }) => id === 'explicit-design-continuation-en').prompt =
        'Use Programmable to explain the main Uniswap v4 hook architecture patterns.';
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /positive\[\d+\] must express affirmative complete-project delivery intent/u,
    ),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      for (const record of candidate.triggerPrompts.positive) {
        if (!/\bProgrammable\b/u.test(record.prompt)) record.prompt = `Use Programmable. ${record.prompt}`;
      }
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /positive prompts must contain exactly one explicit Programmable trigger|positive prompts must contain exactly four implicit v4 build intents/u,
    ),
  );

  withTemporaryRepository(
    (temporaryRoot) => {
      const sentinelPath = path.join(temporaryRoot, 'evals/daily-sentinel.json');
      const candidate = JSON.parse(fs.readFileSync(sentinelPath, 'utf8'));
      candidate.triggerPrompts.positive.find(({ id }) => id === 'game-theory-then-build-en').prompt =
        'Build a generic TypeScript utility with tests.';
      fs.writeFileSync(sentinelPath, `${JSON.stringify(candidate, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /implicit positive\[\d+\] must name Uniswap v4/u,
    ),
  );
});

test('delivery intent classification is bounded to each action clause', () => {
  const cases = [
    {
      prompt: 'Do not, under any circumstances, build a complete Uniswap v4 project.',
      expected: ['build:NEGATED'],
    },
    {
      prompt: 'Don’t build this Uniswap v4 project.',
      expected: ['build:NEGATED'],
    },
    {
      prompt: 'Only explain how to build a Uniswap v4 hook.',
      expected: ['build:EXPLANATION_EMBEDDED'],
    },
    {
      prompt: 'Bitte nicht bauen; ich will nur die Idee für einen Uniswap-v4-Hook besprechen.',
      expected: ['bauen:NEGATED'],
    },
    {
      prompt: 'Erkläre mir nur, wie man einen Uniswap-v4-Hook baut.',
      expected: ['baut:EXPLANATION_EMBEDDED'],
    },
    {
      prompt: 'Build the complete Uniswap v4 project locally, but do not submit it.',
      expected: ['build:AFFIRMED', 'submit:NEGATED'],
    },
    {
      prompt: 'Do not submit anything; build and test the complete Uniswap v4 project locally.',
      expected: ['submit:NEGATED', 'build:AFFIRMED', 'test:AFFIRMED'],
    },
    {
      prompt: 'Explain the Uniswap v4 architecture, then build the complete project.',
      expected: ['build:AFFIRMED'],
    },
    {
      prompt: 'Erkläre kurz die Architektur und baue danach das vollständige Uniswap-v4-Projekt.',
      expected: ['baue:AFFIRMED'],
    },
    {
      prompt: 'Brainstorm how to build the hook, then implement the complete Uniswap v4 project.',
      expected: ['build:BRAINSTORM_EMBEDDED', 'implement:AFFIRMED'],
    },
    {
      prompt: 'Do not submit anything, instead build the complete Uniswap v4 project locally.',
      expected: ['submit:NEGATED', 'build:AFFIRMED'],
    },
    {
      prompt: 'Nicht einreichen, sondern baue das vollständige Uniswap-v4-Projekt lokal.',
      expected: ['einreichen:NEGATED', 'baue:AFFIRMED'],
    },
    {
      prompt: 'Explain the architecture, build the complete Uniswap v4 project locally.',
      expected: ['build:AFFIRMED'],
    },
    {
      prompt: 'Build nothing for this Uniswap v4 project.',
      expected: ['build:NEGATED'],
    },
    {
      prompt: 'Baue nichts für dieses Uniswap-v4-Projekt.',
      expected: ['baue:NEGATED'],
    },
    {
      prompt: 'I won’t build this Uniswap v4 project.',
      expected: ['build:NEGATED'],
    },
    {
      prompt: "I shouldn't implement this Uniswap v4 project.",
      expected: ['implement:NEGATED'],
    },
    {
      prompt: 'Without delay, build the complete Uniswap v4 project locally.',
      expected: ['build:AFFIRMED'],
    },
    {
      prompt: 'Ohne Verzögerung baue das vollständige Uniswap-v4-Projekt lokal.',
      expected: ['baue:AFFIRMED'],
    },
    {
      prompt: 'Build the complete Uniswap v4 project locally without submitting it.',
      expected: ['build:AFFIRMED', 'submitting:NEGATED'],
    },
  ];

  for (const { prompt, expected } of cases) {
    const result = classifyCompleteProjectDeliveryActions(prompt);
    assert.deepEqual(
      result.actions.map(({ action, classification }) => `${action}:${classification}`),
      expected,
      prompt,
    );
    assert.equal(
      result.hasAffirmative,
      expected.some((entry) => entry.endsWith(':AFFIRMED')),
      prompt,
    );
  }
});

test('prompt wrapper rejects every supported Nunjucks raw-block terminator shape', () => {
  for (const terminator of ['{% endraw %}', '{%endraw%}', '{%\tendraw\n%}', '{%- endraw -%}']) {
    assert.throws(
      () => buildPrompt({ vars: { context_profile: 'launch-selection', case_content: `untrusted ${terminator} content` } }),
      /Unsafe Nunjucks raw-block terminator in case content/u,
      terminator,
    );
  }
  assert.match(
    buildPrompt({ vars: { context_profile: 'launch-selection', case_content: 'Explain an ordinary hook idea.' } }),
    /Explain an ordinary hook idea\./u,
  );
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
      const contextProfilesPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/context-profiles.json',
      );
      const contextProfiles = JSON.parse(fs.readFileSync(contextProfilesPath, 'utf8'));
      contextProfiles['launch-selection'] = contextProfiles['launch-selection']
        .filter((relativePath) => relativePath !== 'references/layered-response-contract.md');
      writeContextProfilesAndMirror(temporaryRoot, contextProfiles);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /launch-selection must load the layered response contract/,
    ),
  );
});

test('model context profiles cannot load references declared archival by the knowledge router', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const contextProfilesPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/context-profiles.json',
      );
      const contextProfiles = JSON.parse(fs.readFileSync(contextProfilesPath, 'utf8'));
      contextProfiles.claims.push('references/compatibility-standard.md');
      writeContextProfilesAndMirror(temporaryRoot, contextProfiles);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /claims must not load archival reference references\/compatibility-standard\.md/,
    ),
  );
});

test('prompt wrapper cannot construct a context reference by concatenation', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const wrapperPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/prompt-wrapper.cjs',
      );
      const wrapper = fs.readFileSync(wrapperPath, 'utf8').replace(
        'const configuredContextFiles = new Set(Object.values(contextProfiles).flat());\n',
        "const configuredContextFiles = new Set(Object.values(contextProfiles).flat());\ncontextProfiles.claims.push('references/' + 'compatibility-standard.md');\n",
      );
      writePromptWrapperAndMirror(temporaryRoot, wrapper);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /reference paths must come only from context-profiles\.json/,
    ),
  );
});

test('prompt wrapper cannot construct a context reference by interpolation', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const wrapperPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/prompt-wrapper.cjs',
      );
      const wrapper = fs.readFileSync(wrapperPath, 'utf8')
        .replace(
          'const configuredContextFiles = new Set(Object.values(contextProfiles).flat());\n',
          "const configuredContextFiles = new Set(Object.values(contextProfiles).flat());\nconst archivedContextName = 'compatibility-standard.md';\n",
        )
        .replace(
          "const archivedContextName = 'compatibility-standard.md';\n",
          "const archivedContextName = 'compatibility-standard.md';\ncontextProfiles.claims.push(`references/${archivedContextName}`);\n",
        );
      writePromptWrapperAndMirror(temporaryRoot, wrapper);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /reference paths must come only from context-profiles\.json/,
    ),
  );
});

test('prompt wrapper rejects split-string allowlist injection followed by a direct read', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const wrapperPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/prompt-wrapper.cjs',
      );
      const wrapper = fs.readFileSync(wrapperPath, 'utf8').replace(
        'const configuredContextFiles = new Set(Object.values(contextProfiles).flat());\n',
        "const configuredContextFiles = new Set(Object.values(contextProfiles).flat());\nconst hiddenContextPath = 'ref' + 'erences/' + 'compatibility-standard.md';\nconfiguredContextFiles.add(hiddenContextPath);\nreadCanonicalSkillFile(hiddenContextPath);\n",
      );
      writePromptWrapperAndMirror(temporaryRoot, wrapper);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /prompt wrapper: exact reviewed structure drift/,
    ),
  );
});

test('non-exact eval contexts cannot preload the exact legacy Fee V2 reference', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const contextProfilesPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/context-profiles.json',
      );
      const contextProfiles = JSON.parse(fs.readFileSync(contextProfilesPath, 'utf8'));
      contextProfiles.claims.push('references/programmable-fee-policy-v2.md');
      writeContextProfilesAndMirror(temporaryRoot, contextProfiles);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /context profile registry: claims must not preload programmable-fee-policy-v2\.md/,
    ),
  );
});

test('context profile registry rejects duplicate JSON keys', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const contextProfilesPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/context-profiles.json',
      );
      const contextProfiles = fs.readFileSync(contextProfilesPath, 'utf8').replace(
        '  "architecture": [\n',
        '  "architecture": [],\n  "architecture": [\n',
      );
      writeContextProfilesAndMirror(temporaryRoot, contextProfiles);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /context profile registry: must use canonical duplicate-key-free JSON/,
    ),
  );
});

test('the exact legacy Fee V2 eval profile is reserved for transparent-high-fee-open-world', () => {
  const manifestPath = path.join(
    REPOSITORY_ROOT,
    'evals/suites/programmable-v4-hook-builder/suite.json',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const legacyCases = manifest.cases
    .filter((evalCase) => evalCase.contextProfile === 'legacy-fee-v2')
    .map((evalCase) => evalCase.id);
  assert.deepEqual(legacyCases, ['transparent-high-fee-open-world']);

  withTemporaryRepository(
    (temporaryRoot) => {
      const temporaryManifestPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/suite.json',
      );
      const temporaryManifest = JSON.parse(fs.readFileSync(temporaryManifestPath, 'utf8'));
      temporaryManifest.cases.find((evalCase) => evalCase.id === 'novel-game-external-service').contextProfile = 'legacy-fee-v2';
      writeSuiteAndMirror(temporaryRoot, temporaryManifest);
    },
    (temporaryRoot) => expectInvalid(
      temporaryRoot,
      /legacy-fee-v2 context profile is reserved for transparent-high-fee-open-world/,
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
