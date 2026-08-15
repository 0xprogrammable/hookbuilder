#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArguments(argv) {
  let request = null;
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--request') {
      request = argv[index + 1] ?? null;
      index += 1;
    } else if (argv[index] === '--output') {
      output = argv[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`unknown argument ${argv[index]}`);
    }
  }
  if (!request || !output) throw new Error('--request and --output are required');
  return { request, output };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

const OUTCOMES = Object.freeze({
  'mizu-design-then-implement': 'MATERIALIZED_REPOSITORY',
  'dynamic-fee-build-en': 'MATERIALIZED_REPOSITORY',
  'dynamic-fee-build-de': 'MATERIALIZED_REPOSITORY',
  'onchain-game-build-en': 'MATERIALIZED_REPOSITORY',
  'onchain-game-build-de': 'MATERIALIZED_REPOSITORY',
  'hook-and-web-build-en': 'MATERIALIZED_MULTI_SURFACE_PROJECT',
  'hook-and-service-build-de': 'MATERIALIZED_MULTI_SURFACE_PROJECT',
  'repair-existing-hook-en': 'REPAIRED_REPOSITORY',
  'upgrade-existing-hook-de': 'UPGRADED_REPOSITORY',
  'no-market-service-en': 'MATERIALIZED_NO_MARKET_PROJECT',
  'submission-preflight-de': 'PREPARED_SUBMISSION',
  'custom-curve-build-en': 'MATERIALIZED_REPOSITORY',
  'brainstorm-to-build-en': 'MATERIALIZED_REPOSITORY',
  'review-only-de': 'REVIEWED_REPOSITORY',
  'generic-v4-explanation-en': 'ANSWERED_WITHOUT_BUILDER',
  'generic-v4-explanation-de': 'ANSWERED_WITHOUT_BUILDER',
  'generic-erc20-build-en': 'HANDLED_WITHOUT_BUILDER',
  'find-skill-en': 'ROUTED_TO_SKILL_DISCOVERY',
  'install-skill-de': 'ROUTED_TO_SKILL_INSTALLATION',
  'rpg-skill-tree-en': 'ANSWERED_WITHOUT_BUILDER',
  'generic-repository-review-de': 'HANDLED_WITHOUT_BUILDER',
  'missing-design-context': 'EARLY_BLOCKED_MISSING_INTENT',
  'missing-repository-path': 'EARLY_BLOCKED_MISSING_INPUT',
  'missing-foundry-tool': 'MATERIALIZED_UNVERIFIED_REPOSITORY',
  'deploy-authority-denied': 'LOCAL_BUILD_WITH_EXTERNAL_ACTION_BLOCKED',
  'github-authority-denied-de': 'LOCAL_BUILD_WITH_EXTERNAL_ACTION_BLOCKED',
  'malicious-repository-instructions': 'SAFE_REVIEW_OR_REPAIR',
});

const NEGATIVE_CASES = new Set([
  'generic-v4-explanation-en',
  'generic-v4-explanation-de',
  'generic-erc20-build-en',
  'find-skill-en',
  'install-skill-de',
  'rpg-skill-tree-en',
  'generic-repository-review-de',
]);

function opaqueCaseId(caseId) {
  return `case-${sha256(Buffer.from(`programmable-community-journeys-v1:${caseId}`, 'utf8')).slice(0, 24)}`;
}

const OUTCOMES_BY_OPAQUE_CASE = new Map(Object.entries(OUTCOMES).map(([caseId, outcome]) => [opaqueCaseId(caseId), outcome]));
const NEGATIVE_OPAQUE_CASES = new Set([...NEGATIVE_CASES].map(opaqueCaseId));

function subjectResult(request) {
  const mode = process.env.PROGRAMMABLE_FAKE_BENCHMARK_MODE ?? 'pass';
  const expectedActivation = NEGATIVE_OPAQUE_CASES.has(request.caseId) ? 'NOT_ACTIVATED' : 'ACTIVATED';
  const activated = expectedActivation === 'ACTIVATED';
  const turnIndex = request.turn?.index ?? 1;
  const turnCount = request.turn?.count ?? request.messages?.length ?? 1;
  const messages = request.messages ?? [request.turn.message];
  const isMizu = request.caseId === opaqueCaseId('mizu-design-then-implement');
  const outcome = isMizu && turnIndex < turnCount
    ? 'DESIGN_SELECTED'
    : OUTCOMES_BY_OPAQUE_CASE.get(request.caseId);
  if (!outcome) throw new Error(`fake fixture has no outcome for ${request.caseId}`);
  const earlyBlocked = outcome.startsWith('EARLY_BLOCKED_');
  const shouldWrite = activated && !earlyBlocked && !['REVIEWED_REPOSITORY', 'SAFE_REVIEW_OR_REPAIR'].includes(outcome);
  const localWrites = [];
  if (shouldWrite) {
    if (isMizu && turnIndex === 1) {
      fs.mkdirSync(path.join(request.workspace, '.programmable'), { recursive: true });
      fs.writeFileSync(
        path.join(request.workspace, '.programmable', 'selected-design.json'),
        '{"architecture":"directional-size-sensitive-decaying-fee"}\n',
      );
      localWrites.push('.programmable/selected-design.json');
    } else {
      fs.mkdirSync(path.join(request.workspace, 'src'), { recursive: true });
      fs.writeFileSync(path.join(request.workspace, 'src', 'Result.sol'), `// deterministic fake fixture for ${request.caseId}\n`);
      localWrites.push('src/Result.sol');
    }
  }
  const skillMd = fs.readFileSync(path.join(request.skill.path, 'SKILL.md'));
  const authorityRequests = [];
  const inputTokens = 200 + messages.reduce((total, message) => total + message.content.split(/\s+/u).length, 0);
  const outputTokens = 80;
  const observedActivation = mode === 'turn-inconsistent' && turnIndex === 1 ? 'NOT_ACTIVATED' : expectedActivation;
  const loadedReferences = observedActivation === 'ACTIVATED' ? [{
    path: 'SKILL.md',
    sha256: sha256(skillMd),
    bytes: skillMd.length,
    phase: 'trigger',
    reason: 'deterministic fake activation fixture',
  }] : [];
  if (mode === 'negative-loaded-reference' && !activated) loadedReferences.push({
    path: 'SKILL.md',
    sha256: sha256(skillMd),
    bytes: skillMd.length,
    phase: 'trigger',
    reason: 'invalid negative activation fixture',
  });
  return {
    schemaVersion: '1.0.0',
    requestSha256: request.requestSha256,
    caseId: request.caseId,
    subjectId: request.subjectId,
    provider: {
      host: 'fake-host',
      model: 'fake-subject-model',
      provider: 'local-fixture',
      invocationId: `fake-subject-${request.subjectId}-${request.caseId}-${request.repetition}-${turnIndex}`,
    },
    activation: {
      observed: observedActivation,
      evidence: 'ADAPTER_REPORTED',
      traceSha256: null,
      turns: [{ turn: turnIndex, decision: observedActivation }],
      loadedReferences,
    },
    result: {
      status: mode === 'bad-status-useful' ? 'ERROR' : earlyBlocked ? 'EARLY_BLOCKED' : 'COMPLETED',
      outcome,
      responseText: isMizu && turnIndex === 1
        ? 'Selected the directional, size-sensitive, decaying dynamic-fee architecture for the next turn.'
        : `Deterministic fake response for ${request.caseId}. This is local fixture evidence only.`,
      useful: mode !== 'bad-status-useful',
      materialOwnerDecisions: earlyBlocked ? 1 : 0,
    },
    telemetry: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      toolCalls: shouldWrite ? 2 : 1,
      toolErrors: 0,
      retries: 0,
      elapsedMs: 12,
      timeToUsefulMs: 8,
    },
    effects: {
      localWrites,
      networkCalls: 0,
      externalWrites: [],
      authorityRequests,
    },
  };
}

function judgeResult(request) {
  if (process.env.PROGRAMMABLE_FAKE_BENCHMARK_MODE === 'judge-mutation') {
    for (const name of fs.readdirSync(process.cwd()).filter((entry) => /^subject(?:-turn-\d+)?-result\.json$/u.test(entry))) {
      fs.appendFileSync(path.join(process.cwd(), name), '\n');
    }
    fs.writeFileSync(path.join(process.env.PROGRAMMABLE_BENCHMARK_WORKSPACE, 'judge-created.txt'), 'mutation\n');
  }
  return {
    schemaVersion: '1.0.0',
    requestSha256: request.requestSha256,
    caseId: request.caseId,
    subjectId: request.subjectId,
    provider: {
      host: 'fake-judge-host',
      model: 'fake-independent-judge-model',
      provider: 'local-fixture',
      invocationId: `fake-judge-${request.subjectId}-${request.caseId}-${request.repetition}`,
    },
    verdict: 'PASS',
    scores: {
      correctness: 4,
      usefulness: 4,
      clarity: 4,
      unnecessaryWork: 4,
    },
    findings: [],
  };
}

const options = parseArguments(process.argv.slice(2));
const request = JSON.parse(fs.readFileSync(options.request, 'utf8'));
const role = process.env.PROGRAMMABLE_BENCHMARK_ROLE;
if (role === 'subject') writeJson(options.output, subjectResult(request));
else if (role === 'judge') writeJson(options.output, judgeResult(request));
else throw new Error('PROGRAMMABLE_BENCHMARK_ROLE must be subject or judge');
