import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson, E2E_ARTIFACT_IDS, E2E_STAGE_IDS, sha256 } from './e2e-corpus-core.mjs';
import { E2ERunError } from './e2e-errors.mjs';
import { spawnIsolated } from './e2e-sandbox-core.mjs';
import {
  assertStageEvidenceAbsent,
  isApprovedStageOutput,
  validateStageContracts,
  writeAndValidateStageEvidence,
} from './e2e-stage-contract-core.mjs';

const AGENT_RESULT_PATH = '.programmable-e2e/agent-result.json';
const REPOSITORY_CONTRACT_PATH = '.programmable-e2e/repository-contract.json';
const MAX_STAGE_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_POST_STAGE_WORKSPACE_RECORDS = 500_000;
const MAX_POST_STAGE_WORKSPACE_BYTES = 4 * 1024 * 1024 * 1024;
const TRANSIENT_DIRECTORIES = new Set([
  '.git',
  '.next',
  'broadcast',
  'build',
  'cache',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);
const BUILD_MANIFEST_NAMES = new Set(['Cargo.toml', 'Makefile', 'foundry.toml', 'go.mod', 'package.json', 'pyproject.toml']);
const LOCKFILE_NAMES = new Set([
  'Cargo.lock',
  'foundry.lock',
  'go.sum',
  'package-lock.json',
  'pnpm-lock.yaml',
  'requirements.lock',
  'uv.lock',
  'yarn.lock',
]);
const SOURCE_EXTENSIONS = new Set(['.cairo', '.go', '.js', '.jsx', '.mjs', '.py', '.rs', '.sol', '.ts', '.tsx']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new E2ERunError('INVALID_JSON', `${label}: ${error.message}`);
  }
}

export function logRecord(value) {
  const bytes = Buffer.from(String(value ?? ''), 'utf8');
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

export function safeChildEnvironment({ isolatedHome, extra = {} } = {}) {
  const inherited = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT']) {
    if (typeof process.env[key] === 'string') inherited[key] = process.env[key];
  }
  const environment = {
    ...inherited,
    CI: '1',
    NO_COLOR: '1',
    FOUNDRY_COLOR: 'never',
    FOUNDRY_FFI: 'false',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  };
  if (isolatedHome) {
    fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
    environment.HOME = isolatedHome;
    environment.XDG_CACHE_HOME = path.join(isolatedHome, '.cache');
    environment.XDG_CONFIG_HOME = path.join(isolatedHome, '.config');
  }
  return environment;
}

export function copyInstalledSkill(sourceRoot, targetRoot) {
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true, mode: 0o700 });
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter(source) {
      const name = path.basename(source);
      if (TRANSIENT_DIRECTORIES.has(name)) return false;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new E2ERunError('SKILL_SYMLINK', `installed skill source contains symlink: ${source}`);
      return true;
    },
  });
}

export function directoryDigest(root) {
  const records = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new E2ERunError('SYMLINK_FORBIDDEN', `symlink forbidden in digest: ${absolutePath}`);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.isFile()) {
        records.push(`${path.relative(root, absolutePath).split(path.sep).join('/')}\0${sha256(fs.readFileSync(absolutePath))}\n`);
      }
    }
  };
  walk(root);
  return sha256(records.join(''));
}

export function validateAgentResult(value) {
  if (!exactKeys(value, ['kind', 'providerReceipt', 'schemaVersion', 'status', 'telemetry', 'usage'])) {
    throw new E2ERunError('AGENT_RESULT_INVALID', 'agent result keys drift');
  }
  if (value.schemaVersion !== '1.1.0' || value.kind !== 'programmable-e2e-agent-result' || value.status !== 'COMPLETED') {
    throw new E2ERunError('AGENT_RESULT_INVALID', 'agent result identity or status is invalid');
  }
  if (!exactKeys(value.usage, [
    'architectureContextTokens',
    'coldStartContextTokens',
    'inputTokens',
    'outputTokens',
    'totalTokens',
  ])) {
    throw new E2ERunError('AGENT_RESULT_INVALID', 'agent token usage keys drift');
  }
  for (const key of Object.keys(value.usage)) {
    if (!Number.isSafeInteger(value.usage[key]) || value.usage[key] < 0) {
      throw new E2ERunError('AGENT_RESULT_INVALID', `agent usage.${key} must be a non-negative integer`);
    }
  }
  if (value.usage.totalTokens !== value.usage.inputTokens + value.usage.outputTokens) {
    throw new E2ERunError('AGENT_RESULT_INVALID', 'agent totalTokens must equal inputTokens plus outputTokens');
  }
  if (
    value.usage.coldStartContextTokens > value.usage.inputTokens
    || value.usage.architectureContextTokens > value.usage.inputTokens
  ) {
    throw new E2ERunError('AGENT_RESULT_INVALID', 'phase context tokens cannot exceed measured input tokens');
  }
  if (!exactKeys(value.telemetry, [
    'activatedReferenceBytes',
    'descendantSubagentCount',
    'emittedBytes',
    'escalations',
    'manualInterventions',
    'questions',
    'retries',
    'timeToUsefulMs',
    'toolCalls',
    'toolErrors',
  ])) {
    throw new E2ERunError('AGENT_RESULT_INVALID', 'agent telemetry keys drift');
  }
  for (const key of Object.keys(value.telemetry)) {
    if (!Number.isSafeInteger(value.telemetry[key]) || value.telemetry[key] < 0) {
      throw new E2ERunError('AGENT_RESULT_INVALID', `agent telemetry.${key} must be a non-negative integer`);
    }
  }
  if (value.telemetry.toolErrors > value.telemetry.toolCalls) {
    throw new E2ERunError('AGENT_RESULT_INVALID', 'agent toolErrors cannot exceed toolCalls');
  }
  return value;
}

function safeRelativePath(relativePath, label, { json = false } = {}) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.length > 240
    || relativePath.includes('\0')
    || relativePath.includes('\\')
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new E2ERunError('ARTIFACT_PATH_INVALID', `${label}: path is invalid`);
  }
  if (json && (!relativePath.startsWith('artifacts/') || !relativePath.endsWith('.json'))) {
    throw new E2ERunError('ARTIFACT_PATH_INVALID', `${label}: artifacts must be JSON below artifacts/`);
  }
  return relativePath;
}

export function safeWorkspaceFile(workspace, relativePath, label, { mustExist = true, json = false } = {}) {
  safeRelativePath(relativePath, label, { json });
  const absolutePath = path.resolve(workspace, relativePath);
  const relative = path.relative(workspace, absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new E2ERunError('ARTIFACT_PATH_INVALID', `${label}: path escapes workspace`);
  }
  if (!mustExist) return absolutePath;
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    throw new E2ERunError('ARTIFACT_MISSING', `${label}: ${error.message}`);
  }
  const realPath = fs.realpathSync(absolutePath);
  const realRelative = path.relative(fs.realpathSync(workspace), realPath);
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new E2ERunError('ARTIFACT_PATH_INVALID', `${label}: real path escapes workspace`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_ARTIFACT_BYTES) {
    throw new E2ERunError('ARTIFACT_INVALID', `${label}: must be a non-empty bounded regular file`);
  }
  return absolutePath;
}

export function validateRepositoryContract(value, caseRecord, { workspace, frozenFiles }) {
  if (!exactKeys(value, ['artifacts', 'forkRequired', 'kind', 'schemaVersion', 'stages'])) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'repository contract root keys drift');
  }
  if (
    value.schemaVersion !== '1.0.0'
    || value.kind !== 'programmable-e2e-repository-contract'
    || value.forkRequired !== caseRecord.forkRequired
  ) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'repository contract identity or fork requirement drift');
  }
  if (!exactKeys(value.artifacts, E2E_ARTIFACT_IDS)) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'repository artifact inventory drift');
  }
  const artifactPaths = E2E_ARTIFACT_IDS.map((id) => safeRelativePath(value.artifacts[id], `artifact:${id}`, { json: true }));
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'repository artifacts must use distinct paths');
  }
  if (!exactKeys(value.stages, E2E_STAGE_IDS)) {
    throw new E2ERunError('REPOSITORY_CONTRACT_INVALID', 'repository stage inventory drift');
  }
  const stages = validateStageContracts({ value: value.stages, caseRecord, workspace, frozenFiles });
  return { artifacts: { ...value.artifacts }, stages };
}

function runGit(args, cwd, isolatedHome, { allowFailure = false } = {}) {
  const result = childProcess.spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: safeChildEnvironment({ isolatedHome }),
    maxBuffer: MAX_STAGE_OUTPUT_BYTES,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  if (!allowFailure && (result.status !== 0 || result.error || result.signal)) {
    throw new E2ERunError('FRESH_CHECKOUT_FAILED', `git ${args[0]} failed: ${String(result.stderr ?? result.error?.message ?? '').trim()}`);
  }
  return result;
}

function parseStatusPath(line) {
  const raw = line.slice(3);
  const renameIndex = raw.lastIndexOf(' -> ');
  return renameIndex === -1 ? raw : raw.slice(renameIndex + 4);
}

export function createFreshVerificationCheckout({ agentWorkspace, verificationWorkspace, isolatedHome }) {
  const gitDirectory = path.join(agentWorkspace, '.git');
  let gitStat;
  try {
    gitStat = fs.lstatSync(gitDirectory);
  } catch (error) {
    throw new E2ERunError('GENERATED_REVISION_INVALID', `agent repository has no .git directory: ${error.message}`);
  }
  if (!gitStat.isDirectory() || gitStat.isSymbolicLink()) {
    throw new E2ERunError('GENERATED_REVISION_INVALID', 'agent .git must be a regular directory');
  }
  const head = runGit(['rev-parse', '--verify', 'HEAD'], agentWorkspace, isolatedHome).stdout.trim();
  const tree = runGit(['rev-parse', '--verify', 'HEAD^{tree}'], agentWorkspace, isolatedHome).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/u.test(head) || !/^[0-9a-f]{40,64}$/u.test(tree)) {
    throw new E2ERunError('GENERATED_REVISION_INVALID', 'agent repository HEAD or tree is invalid');
  }
  const statusLines = runGit(['status', '--porcelain=v1', '--untracked-files=all'], agentWorkspace, isolatedHome)
    .stdout.split(/\r?\n/u).filter(Boolean);
  const disallowed = statusLines.filter((line) => !(line.startsWith('?? ') && parseStatusPath(line) === AGENT_RESULT_PATH));
  if (disallowed.length > 0) {
    throw new E2ERunError('GENERATED_REVISION_DIRTY', 'agent repository must commit every generated source, test, contract, and artifact');
  }
  const tracked = runGit(['ls-files', '--stage', '-z'], agentWorkspace, isolatedHome).stdout
    .split('\0').filter(Boolean);
  if (tracked.length < 8) throw new E2ERunError('GENERATED_REVISION_INVALID', 'generated revision has too few tracked files');
  if (tracked.some((record) => /^(?:120000|160000) /u.test(record))) {
    throw new E2ERunError('GENERATED_REVISION_INVALID', 'generated revision cannot contain symlinks or unmaterialized submodules');
  }
  fs.mkdirSync(path.dirname(verificationWorkspace), { recursive: true, mode: 0o700 });
  runGit(['clone', '--no-hardlinks', '--quiet', agentWorkspace, verificationWorkspace], path.dirname(verificationWorkspace), isolatedHome);
  const clonedHead = runGit(['rev-parse', '--verify', 'HEAD'], verificationWorkspace, isolatedHome).stdout.trim();
  const clonedTree = runGit(['rev-parse', '--verify', 'HEAD^{tree}'], verificationWorkspace, isolatedHome).stdout.trim();
  if (clonedHead !== head || clonedTree !== tree) {
    throw new E2ERunError('FRESH_CHECKOUT_FAILED', 'fresh clone does not match the generated revision');
  }
  return {
    mode: 'local-git-clone',
    commit: head,
    tree,
    trackedFileCount: tracked.length,
    initialStatusSha256: sha256(''),
  };
}

function walkRepository(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      // A fresh clone contains only committed material. Tracked files remain
      // evidence even when a project chose a transient-looking directory name.
      if (entry.name === '.git') continue;
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', `repository symlink is forbidden: ${path.relative(root, absolutePath)}`);
      if (stat.isDirectory()) visit(absolutePath);
      else if (stat.isFile()) files.push(absolutePath);
    }
  };
  visit(root);
  return files;
}

function isTestPath(relativePath) {
  return /(?:^|\/)(?:test|tests)(?:\/|$)|(?:\.|-)(?:spec|test)\.[^.]+$/iu.test(relativePath);
}

export function inventoryRepository(workspace, { forkRequired }) {
  const files = walkRepository(workspace);
  const records = files.map((absolutePath) => {
    const relativePath = path.relative(workspace, absolutePath).split(path.sep).join('/');
    const bytes = fs.readFileSync(absolutePath);
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const names = new Set(records.map(({ path: relativePath }) => path.posix.basename(relativePath)));
  const manifests = [...names].filter((name) => BUILD_MANIFEST_NAMES.has(name)).sort();
  const lockfiles = [...names].filter((name) => LOCKFILE_NAMES.has(name)).sort();
  const sourceRecords = records.filter(({ path: relativePath }) => {
    const extension = path.posix.extname(relativePath);
    return SOURCE_EXTENSIONS.has(extension)
      && !isTestPath(relativePath)
      && !relativePath.startsWith('tools/')
      && !relativePath.startsWith('artifacts/')
      && !relativePath.startsWith('.programmable-e2e/');
  });
  const tests = records.filter(({ path: relativePath }) => isTestPath(relativePath));
  const testText = tests.map(({ path: relativePath }) => {
    const absolutePath = path.join(workspace, relativePath);
    const stat = fs.statSync(absolutePath);
    return stat.size <= 2 * 1024 * 1024 ? `${relativePath}\n${fs.readFileSync(absolutePath, 'utf8')}` : relativePath;
  }).join('\n');
  const testCoverage = {
    unit: /unit|\btest\b/iu.test(testText),
    negative: /negative|revert|reject|failure/iu.test(testText),
    fuzz: /fuzz/iu.test(testText),
    invariant: /invariant/iu.test(testText),
    fork: /fork/iu.test(testText),
  };
  if (records.length < 12) throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', 'generated repository has too few material files');
  if (manifests.length === 0) throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', 'generated repository has no build manifest');
  if (lockfiles.length === 0) throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', 'generated repository has no dependency lockfile');
  if (!names.has('.gitignore')) throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', 'generated repository has no .gitignore');
  if (sourceRecords.length === 0 || sourceRecords.reduce((total, record) => total + record.bytes, 0) < 256) {
    throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', 'generated repository has no substantive production source');
  }
  if (tests.length < 4 || !testCoverage.unit || !testCoverage.negative || !testCoverage.fuzz || !testCoverage.invariant) {
    throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', 'generated repository lacks unit, negative, fuzz, or invariant test inventory');
  }
  if (forkRequired && !testCoverage.fork) {
    throw new E2ERunError('REPOSITORY_INVENTORY_INVALID', 'fork-required repository has no fork test inventory');
  }
  const summary = {
    fileCount: records.length,
    sourceFileCount: sourceRecords.length,
    testFileCount: tests.length,
    manifests,
    lockfiles,
    testCoverage,
    treeContentSha256: sha256(records.map((record) => `${record.path}\0${record.sha256}\n`).join('')),
  };
  return {
    summary,
    frozenFiles: new Map(records.map((record) => [record.path, Object.freeze({ ...record })])),
  };
}

export function runRepositoryStages({
  workspace,
  stages,
  isolatedHome,
  forkRpcProxyUrl,
  generatedRevision,
  frozenFiles,
  sandbox = null,
  sandboxControlDirectory,
}) {
  const records = [];
  let verifierToolErrors = 0;
  for (const stageId of E2E_STAGE_IDS) {
    if (records.some(({ status }) => status === 'FAIL' || status === 'EXTERNAL_BLOCKED')) {
      records.push({ id: stageId, status: 'NOT_RUN', reason: 'prior-stage-did-not-pass' });
      continue;
    }
    const specification = stages[stageId];
    if (specification.kind === 'not-applicable') {
      records.push({
        id: stageId,
        status: 'NOT_APPLICABLE',
        reason: specification.reason,
        reasonSha256: sha256(specification.reason),
      });
      continue;
    }
    const [command, ...args] = specification.command;
    try {
      assertStageEvidenceAbsent(workspace, specification, stageId);
      verifyFreshRevisionUnchanged({ workspace, generatedRevision, isolatedHome });
    } catch (error) {
      verifierToolErrors += 1;
      records.push({ id: stageId, status: 'FAIL', reason: error.code ?? 'stage-precondition-failed' });
      continue;
    }
    const started = Date.now();
    let execution;
    try {
      execution = spawnIsolated({
        sandbox,
        role: `repository-stage:${stageId}`,
        command,
        args,
        cwd: workspace,
        env: safeChildEnvironment({
        isolatedHome,
          extra: stageId === 'fork' ? { PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL: forkRpcProxyUrl } : {},
        }),
        controlDirectory: sandboxControlDirectory,
        maxBuffer: MAX_STAGE_OUTPUT_BYTES,
        timeout: specification.timeoutMs,
      });
    } catch (error) {
      verifierToolErrors += 1;
      records.push({ id: stageId, status: 'FAIL', reason: error.code ?? 'sandbox-receipt-invalid' });
      continue;
    }
    const { child, sandboxReceipt } = execution;
    const toolMissing = child.error?.code === 'ENOENT';
    let status = toolMissing
      ? 'EXTERNAL_BLOCKED'
      : child.status === 0 && !child.error && !child.signal
        ? 'PASS'
        : 'FAIL';
    let evidence = null;
    let reason = toolMissing ? 'required-stage-tool-not-found' : null;
    if (status === 'PASS') {
      try {
        verifyFreshRevisionUnchanged({ workspace, generatedRevision, isolatedHome });
        evidence = writeAndValidateStageEvidence({
          workspace,
          stageId,
          specification,
          repositoryTree: generatedRevision.tree,
          frozenFiles,
          stdout: child.stdout,
          stderr: child.stderr,
        });
        verifyFreshRevisionUnchanged({ workspace, generatedRevision, isolatedHome });
        if (evidence.semanticTestAdequacy === 'UNPROVEN') status = 'PARTIAL_EVIDENCE';
      } catch (error) {
        status = 'FAIL';
        reason = error.code ?? 'stage-evidence-invalid';
      }
    }
    if (status === 'FAIL') verifierToolErrors += 1;
    records.push({
      id: stageId,
      status,
      command: [...specification.command],
      timeoutMs: specification.timeoutMs,
      executionRoot: 'fresh-local-git-clone',
      exitCode: child.status ?? (toolMissing ? null : 1),
      signal: child.signal ?? null,
      durationMs: Date.now() - started,
      stdout: logRecord(child.stdout),
      stderr: logRecord(`${child.stderr ?? ''}${child.error ? `\n${child.error.message}` : ''}`),
      evidence,
      sandboxReceipt,
      ...(reason ? { reason } : {}),
    });
  }
  return {
    stages: records,
    verifierToolErrors,
    stageEvidenceQualification: records.some(({ status }) => status === 'PARTIAL_EVIDENCE')
      ? 'SEMANTIC_TEST_ADEQUACY_UNPROVEN'
      : 'NO_EXECUTED_TEST_STAGE',
  };
}

export function artifactRecords(workspace, artifactPaths) {
  const records = E2E_ARTIFACT_IDS.map((id) => {
    const absolutePath = safeWorkspaceFile(workspace, artifactPaths[id], `artifact:${id}`, { json: true });
    const bytes = fs.readFileSync(absolutePath);
    if (bytes.length < 64) throw new E2ERunError('ARTIFACT_INVALID', `artifact:${id} is not substantive`);
    let value;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new E2ERunError('ARTIFACT_INVALID', `artifact:${id} is not valid JSON: ${error.message}`);
    }
    if (!isObject(value) || Object.keys(value).length < 2) {
      throw new E2ERunError('ARTIFACT_INVALID', `artifact:${id} must be a substantive JSON object`);
    }
    return {
      id,
      path: artifactPaths[id],
      bytes: bytes.length,
      sha256: sha256(bytes),
      declaredSchema: typeof value.$schema === 'string'
        ? value.$schema
        : typeof value.schemaVersion === 'string'
          ? `schemaVersion:${value.schemaVersion}`
          : null,
    };
  });
  if (new Set(records.map(({ sha256: digest }) => digest)).size !== records.length) {
    throw new E2ERunError('ARTIFACT_INVALID', 'intent, architecture, deployment, and submission artifacts must be distinct');
  }
  return records;
}

export function verifyFreshRevisionUnchanged({ workspace, generatedRevision, isolatedHome }) {
  const head = runGit(['rev-parse', '--verify', 'HEAD'], workspace, isolatedHome).stdout.trim();
  const tree = runGit(['rev-parse', '--verify', 'HEAD^{tree}'], workspace, isolatedHome).stdout.trim();
  const status = runGit(['status', '--porcelain=v1', '--untracked-files=all'], workspace, isolatedHome).stdout;
  const disallowed = status.split(/\r?\n/u).filter(Boolean).filter((line) => {
    if (!line.startsWith('?? ')) return true;
    const relativePath = parseStatusPath(line).split(path.sep).join('/');
    return !isApprovedStageOutput(relativePath) && ![...TRANSIENT_DIRECTORIES].some((directory) => (
      relativePath === directory || relativePath.startsWith(`${directory}/`)
    ));
  });
  if (head !== generatedRevision.commit || tree !== generatedRevision.tree || disallowed.length > 0) {
    throw new E2ERunError('VERIFICATION_MUTATED_SOURCE', 'verification stages changed committed source or produced unapproved files');
  }
  return {
    finalHead: head,
    finalTree: tree,
    trackedSourceUnchanged: true,
    ignoredOrTransientStatusSha256: sha256(status),
  };
}

function capturePostStageWorkspace(workspace) {
  const workspaceReal = fs.realpathSync.native(workspace);
  const records = [];
  let totalBytes = 0;
  const add = (record, contentBytes = 0) => {
    totalBytes += contentBytes;
    records.push(record);
    if (records.length > MAX_POST_STAGE_WORKSPACE_RECORDS || totalBytes > MAX_POST_STAGE_WORKSPACE_BYTES) {
      throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_LIMIT', 'post-stage workspace exceeds the bounded snapshot limit');
    }
  };
  const stableRegularFile = (absolutePath, relativePath, before) => {
    if (before.size > MAX_POST_STAGE_WORKSPACE_BYTES - totalBytes) {
      throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_LIMIT', 'post-stage workspace exceeds the bounded byte limit');
    }
    const bytes = fs.readFileSync(absolutePath);
    const after = fs.lstatSync(absolutePath);
    if (
      !after.isFile() || after.isSymbolicLink() || bytes.length !== before.size || after.size !== before.size
      || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs
    ) throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_MUTATION', `post-stage workspace changed while captured: ${relativePath}`);
    return bytes;
  };
  const visit = (absolutePath, relativePath) => {
    const before = fs.lstatSync(absolutePath);
    if (before.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(absolutePath);
      let resolvedTarget;
      try {
        resolvedTarget = fs.realpathSync.native(absolutePath);
      } catch (error) {
        throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_INVALID', `post-stage workspace contains a broken or cyclic symlink: ${relativePath}: ${error.message}`);
      }
      const targetRelative = path.relative(workspaceReal, resolvedTarget);
      if (targetRelative === '..' || targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)) {
        throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_INVALID', `post-stage workspace symlink escapes the workspace: ${relativePath}`);
      }
      const targetStat = fs.lstatSync(resolvedTarget);
      if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
        throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_INVALID', `post-stage workspace symlink must resolve directly to a regular file: ${relativePath}`);
      }
      const targetBytes = stableRegularFile(resolvedTarget, `${relativePath} -> ${targetRelative}`, targetStat);
      const after = fs.lstatSync(absolutePath);
      if (
        !after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs
        || fs.readlinkSync(absolutePath) !== linkTarget
      ) throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_MUTATION', `post-stage workspace symlink changed while captured: ${relativePath}`);
      add({
        path: relativePath,
        type: 'symlink-to-regular-file',
        linkTargetSha256: sha256(linkTarget),
        resolvedPathSha256: sha256(targetRelative.split(path.sep).join('/')),
        resolvedBytes: targetBytes.length,
        resolvedSha256: sha256(targetBytes),
      }, targetBytes.length);
      return;
    }
    if (before.isDirectory()) {
      add({ path: relativePath, type: 'directory' });
      for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        visit(path.join(absolutePath, entry.name), `${relativePath}/${entry.name}`);
      }
      return;
    }
    if (!before.isFile()) {
      throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_INVALID', `post-stage workspace contains a special file: ${relativePath}`);
    }
    const bytes = stableRegularFile(absolutePath, relativePath, before);
    add({ path: relativePath, type: 'file', bytes: bytes.length, sha256: sha256(bytes) }, bytes.length);
  };
  for (const entry of fs.readdirSync(workspaceReal, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === '.git') continue;
    visit(path.join(workspaceReal, entry.name), entry.name);
  }
  return {
    records,
    totalBytes,
    sha256: sha256(canonicalJson(records)),
  };
}

export function createPostStageWorkspaceSnapshot(workspace) {
  let captured;
  try {
    captured = capturePostStageWorkspace(workspace);
  } catch (error) {
    if (error instanceof E2ERunError) throw error;
    throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_INVALID', `post-stage workspace could not be frozen: ${error.message}`);
  }
  return Object.freeze({
    workspace,
    records: Object.freeze(captured.records.map((record) => Object.freeze(record))),
    summary: Object.freeze({
      state: 'FULL_POST_STAGE_WORKSPACE_FROZEN_EXCLUDING_ROOT_GIT',
      recordCount: captured.records.length,
      totalBytes: captured.totalBytes,
      sha256: captured.sha256,
    }),
  });
}

export function verifyPostStageWorkspaceSnapshot(snapshot) {
  let observed;
  try {
    observed = capturePostStageWorkspace(snapshot.workspace);
  } catch (error) {
    if (error instanceof E2ERunError) throw error;
    throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_MUTATION', `post-stage workspace could not be recaptured: ${error.message}`);
  }
  if (observed.sha256 !== snapshot.summary.sha256 || canonicalJson(observed.records) !== canonicalJson(snapshot.records)) {
    throw new E2ERunError('VERIFICATION_POST_STAGE_WORKSPACE_MUTATION', 'post-stage workspace changed after the pre-judge freeze');
  }
  return Object.freeze({
    state: 'FULL_POST_STAGE_WORKSPACE_UNCHANGED_AFTER_JUDGE',
    recordCount: observed.records.length,
    totalBytes: observed.totalBytes,
    sha256: observed.sha256,
    unchanged: true,
  });
}

export function createFrozenJudgeSnapshot({ workspace, target, frozenFiles }) {
  fs.mkdirSync(target, { recursive: false, mode: 0o700 });
  const records = [];
  for (const [relativePath, frozen] of [...frozenFiles.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const source = path.join(workspace, relativePath);
    const bytes = fs.readFileSync(source);
    if (sha256(bytes) !== frozen.sha256) {
      throw new E2ERunError('VERIFICATION_MUTATED_SOURCE', `frozen judge source changed: ${relativePath}`);
    }
    const destination = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o400 });
    records.push({ path: relativePath, bytes: bytes.length, sha256: frozen.sha256 });
  }
  for (const directory of [...new Set(records.map(({ path: relativePath }) => path.dirname(path.join(target, relativePath))))]
    .sort((left, right) => right.length - left.length)) {
    if (directory !== target) fs.chmodSync(directory, 0o500);
  }
  fs.chmodSync(target, 0o500);
  return {
    root: target,
    files: new Map(records.map((record) => [record.path, Object.freeze({ ...record })])),
    sha256: sha256(records.map((record) => `${record.path}\0${record.sha256}\n`).join('')),
  };
}

function walkSnapshotAll(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (stat.isSymbolicLink()) throw new E2ERunError('JUDGE_SNAPSHOT_MUTATED', `judge injected a symlink: ${relativePath}`);
      if (stat.isDirectory()) visit(absolutePath);
      else if (stat.isFile()) files.push(absolutePath);
      else throw new E2ERunError('JUDGE_SNAPSHOT_MUTATED', `judge injected a special file: ${relativePath}`);
    }
  };
  visit(root);
  return files;
}

export function verifyFrozenJudgeSnapshot(snapshot) {
  const observed = walkSnapshotAll(snapshot.root).map((absolutePath) => {
    const relativePath = path.relative(snapshot.root, absolutePath).split(path.sep).join('/');
    const stat = fs.lstatSync(absolutePath);
    const bytes = fs.readFileSync(absolutePath);
    if ((stat.mode & 0o222) !== 0) {
      throw new E2ERunError('JUDGE_SNAPSHOT_MUTATED', `judge snapshot file became writable: ${relativePath}`);
    }
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const digest = sha256(observed.map((record) => `${record.path}\0${record.sha256}\n`).join(''));
  if (
    digest !== snapshot.sha256
    || observed.length !== snapshot.files.size
    || observed.some((record) => snapshot.files.get(record.path)?.sha256 !== record.sha256)
  ) throw new E2ERunError('JUDGE_SNAPSHOT_MUTATED', 'judge changed or injected frozen evidence');
  return { snapshotSha256: digest, trackedEvidenceFileCount: observed.length, unchanged: true };
}

export const E2E_AGENT_RESULT_PATH = AGENT_RESULT_PATH;
export const E2E_REPOSITORY_CONTRACT_PATH = REPOSITORY_CONTRACT_PATH;
