import fs from 'node:fs';
import path from 'node:path';

import { E2E_STAGE_IDS, sha256 } from './e2e-corpus-core.mjs';
import { E2ERunError } from './e2e-errors.mjs';

const STAGE_EVIDENCE_ROOT = '.programmable-e2e/stage-evidence';
const MAX_STAGE_EVIDENCE_BYTES = 1024 * 1024;
const PACKAGE_RUNNERS = new Set(['npm', 'npm.cmd', 'pnpm', 'yarn']);
const DIRECT_PROJECT_TOOLS = new Set(['cargo', 'forge', 'go', 'make', 'npx', 'slither']);
const TEST_STAGE_IDS = new Set(['unit', 'negative', 'fuzz', 'invariant', 'fork', 'gas', 'code-size', 'deployment', 'submission']);
const SOURCE_STAGE_IDS = new Set(['compile', 'typecheck', 'lint']);
const FORBIDDEN_ARGUMENT = /(^|[\/])\.\.([\/]|$)|--broadcast|--private-key|--mnemonic|--keystore|(?:https?|wss?):\/\//iu;
const SHELL_CONTROL = /(?:&&|\|\||[;|<>`]|\$\()/u;

const STAGE_TOOL_PATTERNS = Object.freeze({
  install: Object.freeze([
    ['npm:ci', /\bnpm\s+ci\b/iu],
    ['npm:install', /\bnpm\s+install\b/iu],
    ['pnpm:install', /\bpnpm\s+install\b/iu],
    ['yarn:install', /\byarn\s+(?:install|--immutable)\b/iu],
    ['cargo:fetch', /\bcargo\s+fetch\b/iu],
    ['go:download', /\bgo\s+mod\s+download\b/iu],
  ]),
  compile: Object.freeze([
    ['node:check', /\bnode\s+--check\s+\S+/iu],
    ['typescript:compile', /\b(?:tsc|typescript)\b/iu],
    ['forge:build', /\bforge\s+build\b/iu],
    ['cargo:build', /\bcargo\s+build\b/iu],
    ['go:build', /\bgo\s+build\b/iu],
    ['hardhat:compile', /\bhardhat\s+compile\b/iu],
  ]),
  typecheck: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*type-?check/iu],
    ['typescript:typecheck', /\b(?:tsc|typescript)\b/iu],
    ['cargo:check', /\bcargo\s+check\b/iu],
    ['go:vet', /\bgo\s+vet\b/iu],
    ['python:typecheck', /\b(?:mypy|pyright)\b/iu],
  ]),
  lint: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*lint/iu],
    ['eslint', /\beslint\b/iu],
    ['biome', /\bbiome\b/iu],
    ['forge:fmt', /\bforge\s+fmt\b[^\n;&|]*--check/iu],
    ['cargo:clippy', /\bcargo\s+clippy\b/iu],
    ['python:lint', /\b(?:ruff|pylint)\b/iu],
  ]),
  unit: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*(?:unit|test)/iu],
    ['forge:test', /\bforge\s+test\b/iu],
    ['cargo:test', /\bcargo\s+test\b/iu],
    ['go:test', /\bgo\s+test\b/iu],
    ['python:test', /\bpytest\b/iu],
  ]),
  negative: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*(?:negative|failure|revert|reject)/iu],
    ['forge:test', /\bforge\s+test\b[^\n;&|]*(?:negative|failure|revert|reject)/iu],
    ['cargo:test', /\bcargo\s+test\b[^\n;&|]*(?:negative|failure|revert|reject)/iu],
    ['go:test', /\bgo\s+test\b[^\n;&|]*(?:negative|failure|revert|reject)/iu],
    ['python:test', /\bpytest\b[^\n;&|]*(?:negative|failure|revert|reject)/iu],
  ]),
  fuzz: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*fuzz/iu],
    ['forge:fuzz', /\bforge\s+test\b[^\n;&|]*fuzz/iu],
    ['cargo:fuzz', /\bcargo\s+(?:fuzz|test)\b[^\n;&|]*fuzz/iu],
    ['go:fuzz', /\bgo\s+test\b[^\n;&|]*fuzz/iu],
    ['python:fuzz', /\bpytest\b[^\n;&|]*(?:fuzz|property)/iu],
  ]),
  invariant: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*invariant/iu],
    ['forge:invariant', /\bforge\s+test\b[^\n;&|]*invariant/iu],
    ['cargo:invariant', /\bcargo\s+test\b[^\n;&|]*invariant/iu],
    ['go:invariant', /\bgo\s+test\b[^\n;&|]*invariant/iu],
    ['python:invariant', /\bpytest\b[^\n;&|]*invariant/iu],
  ]),
  fork: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*fork/iu],
    ['forge:fork', /\bforge\s+test\b[^\n;&|]*fork/iu],
  ]),
  gas: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*gas/iu],
    ['forge:gas', /\bforge\s+test\b[^\n;&|]*gas/iu],
    ['cargo:bench', /\bcargo\s+bench\b/iu],
  ]),
  'code-size': Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*(?:code-?size|size)/iu],
    ['forge:size', /\bforge\s+build\b[^\n;&|]*--sizes\b/iu],
    ['hardhat:size', /\bhardhat\b[^\n;&|]*size/iu],
  ]),
  deployment: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*(?:deployment|deploy)/iu],
    ['forge:script', /\bforge\s+script\b/iu],
    ['hardhat:run', /\bhardhat\s+run\b/iu],
  ]),
  submission: Object.freeze([
    ['node:test', /\bnode\s+--test\b[^\n;&|]*(?:submission|validate|verify)/iu],
  ]),
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function safeRelativePath(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 240
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.includes('\\')
    || path.posix.normalize(value) !== value
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${label}: path is invalid`);
  return value;
}

function readPackageScripts(workspace) {
  const packagePath = path.join(workspace, 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `package.json is not valid JSON: ${error.message}`);
  }
  if (!isObject(value.scripts)) return { path: 'package.json', scripts: {} };
  return { path: 'package.json', scripts: value.scripts };
}

function resolvePackageScript(command, workspace) {
  const [runner, ...args] = command;
  const packageScripts = readPackageScripts(workspace);
  if (!packageScripts) throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${runner}: package.json is required`);
  let scriptName;
  if (runner === 'yarn') {
    scriptName = args[0] === 'run' ? args[1] : args[0];
  } else if (args[0] === 'run' || args[0] === 'run-script') {
    scriptName = args[1];
  }
  if (typeof scriptName !== 'string' || scriptName.length === 0) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${runner}: stages must invoke a named project script`);
  }
  const script = packageScripts.scripts[scriptName];
  if (typeof script !== 'string' || script.trim().length === 0 || Buffer.byteLength(script, 'utf8') > 8192) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${runner}: project script ${scriptName} is missing or invalid`);
  }
  if (SHELL_CONTROL.test(script)) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${runner}: project verification scripts must execute one tool without shell chaining or redirection`);
  }
  return {
    manifestPath: packageScripts.path,
    resolved: script.trim(),
    implementation: `${runner}\0${script.trim()}`,
  };
}

function directProjectCommand(command, workspace) {
  const [tool] = command;
  const manifestByTool = {
    cargo: 'Cargo.toml',
    forge: 'foundry.toml',
    go: 'go.mod',
    make: 'Makefile',
    npx: 'package.json',
    slither: 'foundry.toml',
  };
  const manifestPath = manifestByTool[tool];
  if (!manifestPath || !fs.existsSync(path.join(workspace, manifestPath))) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${tool}: project manifest ${manifestPath ?? 'unknown'} is missing`);
  }
  return { manifestPath, resolved: command.join(' '), implementation: command.join('\0') };
}

function stageProducer(stageId, resolvedCommand) {
  for (const [producer, pattern] of STAGE_TOOL_PATTERNS[stageId]) {
    if (pattern.test(resolvedCommand)) return producer;
  }
  throw new E2ERunError(
    'REPOSITORY_CONTRACT_INVALID',
    `${stageId}: project script does not execute a recognized ${stageId} tool or test`,
  );
}

function frozenSubject(relativePath, workspace, frozenFiles, stageId) {
  safeRelativePath(relativePath, `${stageId}: subject`);
  const frozen = frozenFiles.get(relativePath);
  if (!frozen) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: subject is not tracked in the generated commit: ${relativePath}`);
  }
  const absolutePath = path.join(workspace, relativePath);
  if (sha256(fs.readFileSync(absolutePath)) !== frozen.sha256) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: subject differs from the generated commit: ${relativePath}`);
  }
  return { path: relativePath, sha256: frozen.sha256 };
}

function validateCommandSpec(value, stageId, workspace, frozenFiles) {
  if (stageId === 'fork' && exactKeys(value, ['reason', 'status'])) {
    if (value.status !== 'NOT_APPLICABLE' || typeof value.reason !== 'string' || value.reason.length < 12) {
      throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'fork NOT_APPLICABLE requires a substantive reason');
    }
    return { kind: 'not-applicable', reason: value.reason };
  }
  if (!exactKeys(value, ['command', 'subjects', 'timeoutMs'])) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: stage keys drift`);
  }
  if (
    !Array.isArray(value.command)
    || value.command.length === 0
    || value.command.length > 32
    || value.command.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 2048)
  ) throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: command must be a bounded string array`);
  if (value.command.some((item) => FORBIDDEN_ARGUMENT.test(item))) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: command contains an escape, secret, URL, or external-write argument`);
  }
  if (value.command.some((item) => SHELL_CONTROL.test(`${item} `))) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: shell control operators are forbidden`);
  }
  if (!Array.isArray(value.subjects) || value.subjects.length === 0 || value.subjects.length > 32) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: tracked stage subjects are required`);
  }
  const subjects = value.subjects.map((relativePath) => frozenSubject(relativePath, workspace, frozenFiles, stageId));
  if (new Set(subjects.map(({ path: relativePath }) => relativePath)).size !== subjects.length) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: stage subjects must be unique`);
  }
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 1000 || value.timeoutMs > 20 * 60 * 1000) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', `${stageId}: timeoutMs is outside the allowed range`);
  }
  const tool = value.command[0];
  const projectCommand = PACKAGE_RUNNERS.has(tool)
    ? resolvePackageScript(value.command, workspace)
    : DIRECT_PROJECT_TOOLS.has(tool)
      ? directProjectCommand(value.command, workspace)
      : null;
  if (!projectCommand) {
    throw new E2ERunError(
      'REPOSITORY_CONTRACT_INVALID',
      `${stageId}: direct ${tool} execution is not a project-bound verification command`,
    );
  }
  const producer = stageProducer(stageId, projectCommand.resolved);
  return {
    kind: 'command',
    command: [...value.command],
    timeoutMs: value.timeoutMs,
    projectManifest: projectCommand.manifestPath,
    implementationSha256: sha256(projectCommand.implementation),
    commandSha256: sha256(JSON.stringify(value.command)),
    producer,
    subjects,
    evidencePath: `${STAGE_EVIDENCE_ROOT}/${stageId}.json`,
  };
}

export function validateStageContracts({ value, caseRecord, workspace, frozenFiles }) {
  if (!isObject(value) || !exactKeys(value, E2E_STAGE_IDS)) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'repository stage inventory drift');
  }
  const stages = Object.fromEntries(E2E_STAGE_IDS.map((id) => [id, validateCommandSpec(value[id], id, workspace, frozenFiles)]));
  if (caseRecord.forkRequired && stages.fork.kind !== 'command') {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'fork-required case must declare an executable fork stage');
  }
  if (!caseRecord.forkRequired && stages.fork.kind !== 'not-applicable') {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'non-fork case must declare fork as NOT_APPLICABLE');
  }
  const implementations = Object.values(stages)
    .filter(({ kind }) => kind === 'command')
    .map(({ implementationSha256 }) => implementationSha256);
  if (new Set(implementations).size !== implementations.length) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'every executable stage must use a distinct project command implementation');
  }
  return stages;
}

export function stageEvidenceEnvironment({ stageId, specification, repositoryTree }) {
  return {
    PROGRAMMABLE_E2E_STAGE_ID: stageId,
    PROGRAMMABLE_E2E_STAGE_COMMAND_SHA256: specification.commandSha256,
    PROGRAMMABLE_E2E_STAGE_REPOSITORY_TREE: repositoryTree,
    PROGRAMMABLE_E2E_STAGE_EVIDENCE_PATH: specification.evidencePath,
  };
}

export function assertStageEvidenceAbsent(workspace, specification, stageId) {
  const evidencePath = path.join(workspace, specification.evidencePath);
  if (fs.existsSync(evidencePath)) {
    throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: stage evidence must be created by that stage`);
  }
}

function substantiveTestSource(stageId, source) {
  const assertions = source.match(/\b(?:assert\.(?:equal|notEqual|deepEqual|ok|throws|rejects|match)|assertEq|assertTrue|assertFalse|expect(?:Revert)?|require)\b|\.to(?:Be|Equal|Throw)\b/giu) ?? [];
  const hasAssertion = assertions.length >= 2;
  const hasTestDeclaration = /\b(?:test|it)\s*\(|\bfunction\s+(?:test|invariant)|#\[test\]|\bfunc\s+(?:Test|Fuzz)|\bdef\s+test_/u.test(source);
  const stageSignal = stageId === 'unit'
    ? /\b(?:unit|test)\b/iu
    : stageId === 'negative'
      ? /negative|revert|reject|failure/iu
      : stageId === 'code-size'
        ? /code.?size|bytecode|size/iu
        : new RegExp(stageId, 'iu');
  const behavioralSignal = {
    unit: /(?:deposit|withdraw|balance|state|amount|value)/iu,
    negative: /assert\.(?:throws|rejects)|expectRevert|revert|reject/iu,
    fuzz: /\b(?:for|while)\s*\(|fast.?check|property|fuzz/iu,
    invariant: /\b(?:for|while|reduce)\b|invariant/iu,
    fork: /PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL|chain.?id|block.?number/iu,
    gas: /gas.{0,40}(?:<|<=|budget|limit)/iu,
    'code-size': /(?:code.?size|bytecode).{0,40}(?:<|<=|limit)/iu,
    deployment: /(?:deployment|deploy).{0,80}(?:address|runtime|chain|determin)/iu,
    submission: /(?:submission|manifest|schema).{0,80}(?:valid|verify|bound)/iu,
  }[stageId];
  return Buffer.byteLength(source, 'utf8') >= 180
    && hasAssertion
    && hasTestDeclaration
    && stageSignal.test(source)
    && behavioralSignal.test(source);
}

function isTestPath(relativePath) {
  return /(?:^|\/)(?:test|tests)(?:\/|$)|(?:\.|-)(?:spec|test)\.[^.]+$/iu.test(relativePath);
}

function isProductionSourcePath(relativePath) {
  return /\.(?:cairo|go|js|jsx|mjs|py|rs|sol|ts|tsx)$/iu.test(relativePath)
    && !isTestPath(relativePath)
    && !relativePath.startsWith('tools/')
    && !relativePath.startsWith('artifacts/')
    && !relativePath.startsWith('.programmable-e2e/');
}

function jsTestExercisesProduction(testPath, testSource, productionPaths) {
  const imports = [...testSource.matchAll(/\bimport\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]/gu)];
  for (const match of imports) {
    const importPath = match[3];
    if (!importPath.startsWith('.')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(testPath), importPath));
    if (!productionPaths.includes(resolved)) continue;
    const identifiers = (match[1] ? match[1].split(',').map((value) => value.trim().split(/\s+as\s+/u).at(-1)) : [match[2]])
      .filter((value) => /^[A-Za-z_$][\w$]*$/u.test(value));
    const withoutImport = testSource.replace(match[0], '');
    const constructsProduction = identifiers.some((identifier) => (
      new RegExp(`\\b(?:new\\s+${identifier}|${identifier}\\s*\\()`, 'u').test(withoutImport)
    ));
    const callsBehavior = /\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(/u.test(withoutImport);
    const nonConstantAssertion = /\bassert\.(?:equal|notEqual|deepEqual|ok|throws|rejects|match)\s*\([^\n;]{0,240}(?:\.[A-Za-z_$][\w$]*\s*\(|[A-Za-z_$][\w$]*\s*\()/u.test(withoutImport);
    if (constructsProduction && callsBehavior && nonConstantAssertion) return true;
  }
  return false;
}

function testExercisesProduction(test, productionPaths) {
  if (/\.(?:js|jsx|mjs|ts|tsx)$/iu.test(test.path)) {
    return jsTestExercisesProduction(test.path, test.source, productionPaths);
  }
  return productionPaths.some((productionPath) => (
    new RegExp(`(?:import|from|use|mod)[^\n]{0,160}${path.posix.basename(productionPath).replaceAll('.', '\\.')}`, 'iu').test(test.source)
  ));
}

function trustedToolChecks(stageId, specification, stdout, stderr) {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
  if (specification.producer === 'node:test') {
    const tests = Number(combined.match(/(?:#|ℹ) tests (\d+)/u)?.[1] ?? 0);
    const passed = Number(combined.match(/(?:#|ℹ) pass (\d+)/u)?.[1] ?? 0);
    const failed = Number(combined.match(/(?:#|ℹ) fail (\d+)/u)?.[1] ?? -1);
    if (tests < 1 || passed !== tests || failed !== 0) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: node test runner did not report a complete passing test set`);
    }
    return [`node-test-count:${tests}`, `node-test-pass:${passed}`, 'node-test-fail:0'];
  }
  if (/^forge:(?:test|fuzz|invariant|fork|gas)$/u.test(specification.producer)) {
    const tests = [...combined.matchAll(/Ran (\d+) tests?/gu)].reduce((total, match) => total + Number(match[1]), 0);
    if (tests < 1 || !/Suite result:\s*ok/iu.test(combined) || /Suite result:\s*failed/iu.test(combined)) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: forge did not report a nonzero passing test set`);
    }
    return [`forge-test-count:${tests}`, 'forge-suite:ok'];
  }
  if (/^cargo:(?:test|fuzz|invariant)$/u.test(specification.producer)) {
    const match = combined.match(/test result:\s*ok\.\s*(\d+) passed;\s*0 failed/iu);
    if (!match || Number(match[1]) < 1) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: cargo did not report a nonzero passing test set`);
    }
    return [`cargo-test-count:${match[1]}`, 'cargo-fail:0'];
  }
  if (/^go:(?:test|fuzz|invariant)$/u.test(specification.producer)) {
    if (!/(?:^|\n)ok\s+\S+/u.test(combined) || /\bFAIL\b/u.test(combined)) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: go did not report a passing package test`);
    }
    return ['go-package:ok', 'go-fail:0'];
  }
  if (/^python:(?:test|fuzz|invariant)$/u.test(specification.producer)) {
    const match = combined.match(/(\d+) passed/iu);
    if (!match || Number(match[1]) < 1 || /\bfailed\b/iu.test(combined)) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: pytest did not report a nonzero passing test set`);
    }
    return [`python-test-count:${match[1]}`, 'python-fail:0'];
  }
  if (TEST_STAGE_IDS.has(stageId)) {
    const attested = specification.producer === 'cargo:bench'
      ? /test result:\s*ok|bench:/iu.test(combined)
      : specification.producer === 'forge:size'
        ? /runtime size|contract size|deployed size/iu.test(combined)
        : specification.producer === 'hardhat:size'
          ? /contract size|deployed size/iu.test(combined)
          : specification.producer === 'forge:script'
            ? /script ran successfully|simulation complete/iu.test(combined)
            : specification.producer === 'hardhat:run'
              ? /deployment|deployed|simulation/iu.test(combined)
              : false;
    if (!attested) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: tool output does not attest a substantive stage result`);
    }
    return [`producer-output-attested:${specification.producer}`, 'tool-exit:0'];
  }
  return [`tool-exit:0`, `producer:${specification.producer}`];
}

export function writeAndValidateStageEvidence({ workspace, stageId, specification, repositoryTree, frozenFiles, stdout, stderr }) {
  const subjects = specification.subjects.map(({ path: relativePath, sha256: digest }) => ({ path: relativePath, sha256: digest }));
  const checks = trustedToolChecks(stageId, specification, stdout, stderr);
  const evidencePath = path.join(workspace, specification.evidencePath);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: '1.0.0',
    kind: 'programmable-e2e-stage-evidence',
    stageId,
    commandSha256: specification.commandSha256,
    repositoryTree,
    producer: specification.producer,
    result: 'PASS',
    checks,
    subjects,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return validateStageEvidence({ workspace, stageId, specification, repositoryTree, frozenFiles });
}

export function validateStageEvidence({ workspace, stageId, specification, repositoryTree, frozenFiles }) {
  const evidencePath = path.join(workspace, specification.evidencePath);
  let stat;
  try {
    stat = fs.lstatSync(evidencePath);
  } catch (error) {
    throw new E2ERunError('STAGE_EVIDENCE_MISSING', `${stageId}: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_STAGE_EVIDENCE_BYTES) {
    throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence must be one bounded regular file`);
  }
  const bytes = fs.readFileSync(evidencePath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence is not valid JSON: ${error.message}`);
  }
  if (!exactKeys(value, ['checks', 'commandSha256', 'kind', 'producer', 'repositoryTree', 'result', 'schemaVersion', 'stageId', 'subjects'])) {
    throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence keys drift`);
  }
  if (
    value.schemaVersion !== '1.0.0'
    || value.kind !== 'programmable-e2e-stage-evidence'
    || value.stageId !== stageId
    || value.commandSha256 !== specification.commandSha256
    || value.repositoryTree !== repositoryTree
    || value.producer !== specification.producer
    || value.result !== 'PASS'
  ) throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence binding drift`);
  if (
    !Array.isArray(value.checks)
    || value.checks.length === 0
    || value.checks.length > 32
    || value.checks.some((check) => typeof check !== 'string' || check.length < 3 || check.length > 160)
    || new Set(value.checks).size !== value.checks.length
  ) throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence checks are not substantive and unique`);
  if (!Array.isArray(value.subjects) || value.subjects.length === 0 || value.subjects.length > 64) {
    throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence subjects are missing or unbounded`);
  }
  const subjects = value.subjects.map((record, index) => {
    if (!exactKeys(record, ['path', 'sha256'])) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: subjects[${index}] keys drift`);
    }
    const relativePath = safeRelativePath(record.path, `${stageId}: subjects[${index}]`);
    const frozen = frozenFiles.get(relativePath);
    if (!frozen || record.sha256 !== frozen.sha256) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: subject is not bound to the generated commit: ${relativePath}`);
    }
    const observed = fs.readFileSync(path.join(workspace, relativePath));
    if (sha256(observed) !== frozen.sha256) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: subject changed during verification: ${relativePath}`);
    }
    return { path: relativePath, sha256: frozen.sha256, source: observed.toString('utf8') };
  });
  if (new Set(subjects.map(({ path: relativePath }) => relativePath)).size !== subjects.length) {
    throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence subjects must be unique`);
  }
  if (SOURCE_STAGE_IDS.has(stageId) && !subjects.some(({ path: relativePath }) => isProductionSourcePath(relativePath))) {
    throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence must bind substantive production source`);
  }
  if (TEST_STAGE_IDS.has(stageId)) {
    const testSubjects = subjects.filter(({ path: relativePath }) => isTestPath(relativePath));
    const productionPaths = subjects.filter(({ path: relativePath }) => isProductionSourcePath(relativePath)).map(({ path: relativePath }) => relativePath);
    if (
      productionPaths.length === 0
      || testSubjects.length === 0
      || !testSubjects.some((test) => substantiveTestSource(stageId, test.source) && testExercisesProduction(test, productionPaths))
    ) {
      throw new E2ERunError('STAGE_EVIDENCE_INVALID', `${stageId}: evidence must bind an executable stage-specific test with assertions`);
    }
  }
  return {
    path: specification.evidencePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
    producer: specification.producer,
    subjectCount: subjects.length,
    checkCount: value.checks.length,
    semanticTestAdequacy: TEST_STAGE_IDS.has(stageId) ? 'UNPROVEN' : 'NOT_APPLICABLE',
  };
}

export function isApprovedStageOutput(relativePath) {
  return relativePath === STAGE_EVIDENCE_ROOT || relativePath.startsWith(`${STAGE_EVIDENCE_ROOT}/`);
}
