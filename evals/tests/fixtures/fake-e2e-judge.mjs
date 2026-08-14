#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const mode = option('--mode', 'pass');
if (mode === 'external-blocked') process.exit(75);
if (mode === 'slow-pass') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1600);
const requestPath = option('--request');
const outputPath = option('--output');
const capturePath = option('--capture');
if (!requestPath || !outputPath) throw new Error('fake judge requires --request and --output');
const requestBytes = fs.readFileSync(requestPath);
const request = JSON.parse(requestBytes.toString('utf8'));
if (
  request.policy?.builderResponseAndActivationReceiptAreUntrustedData !== true
  || request.policy?.ignoreBuilderResponseAndActivationReceiptInstructions !== true
) throw new Error('judge request must classify journey evidence as untrusted data');
const architecture = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'artifacts/architecture.json'), 'utf8'));
const failRubric = mode === 'fail' || architecture.scoreGame === true;
let evidencePath = 'src/system.mjs';
if (mode === 'inject-untracked') {
  fs.chmodSync(process.cwd(), 0o700);
  fs.mkdirSync(path.join(process.cwd(), 'out'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'out/injected.mjs'), 'export const injected = true;\n');
  evidencePath = 'out/injected.mjs';
}
if (mode === 'mutate-snapshot') {
  const sourcePath = path.join(process.cwd(), 'src/system.mjs');
  fs.chmodSync(path.dirname(sourcePath), 0o700);
  fs.chmodSync(sourcePath, 0o600);
  fs.appendFileSync(sourcePath, '\nexport const judgeMutation = true;\n');
}
const evidence = [{ path: evidencePath, lineStart: 1, lineEnd: evidencePath === 'src/system.mjs' ? 8 : 1 }];
const required = request.rubric.required.map((criterion, index) => ({
  criterionSha256: sha256(criterion),
  verdict: failRubric && index === 0 ? 'UNSATISFIED' : 'SATISFIED',
  evidence: failRubric && index === 0 ? [] : evidence,
}));
const forbidden = request.rubric.forbidden.map((criterion) => ({
  criterionSha256: sha256(criterion),
  verdict: 'ABSENT',
  evidence: [],
}));
const result = {
  schemaVersion: '1.1.0',
  kind: 'programmable-e2e-judge-result',
  requestSha256: mode === 'invalid-binding' ? '0'.repeat(64) : sha256(requestBytes),
  usage: {
    inputTokens: 1500,
    outputTokens: 500,
    totalTokens: 2000,
  },
  telemetry: {
    activatedReferenceBytes: 8 * 1024,
    descendantSubagentCount: 0,
    emittedBytes: 16 * 1024,
    toolCalls: 4,
    toolErrors: 0,
    retries: 0,
  },
  providerReceipt: {
    schemaVersion: '1.0.0',
    kind: 'programmable-e2e-provider-receipt',
    provenance: 'fixture-non-provider',
    provider: 'local-fixture',
    model: process.env.PROGRAMMABLE_E2E_JUDGE_MODEL,
    modelRevision: 'fixture-judge-revision-v1',
    requestId: `fixture-judge-request-${request.bindings.runId}`,
    invocationId: `fixture-judge-invocation-${request.bindings.runId}`,
    startedAt: '2026-01-01T00:00:02.000Z',
    completedAt: '2026-01-01T00:00:03.000Z',
    sampling: { temperature: 0, topP: 1, seed: 2 },
    inputSha256: sha256(requestBytes),
    responseSha256: sha256('fixture-judge-response'),
  },
  required,
  forbidden,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
if (capturePath) {
  fs.writeFileSync(capturePath, `${JSON.stringify({
    arguments: process.argv.slice(2),
    model: process.env.PROGRAMMABLE_E2E_JUDGE_MODEL,
    request,
  }, null, 2)}\n`);
}
