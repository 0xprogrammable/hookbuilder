import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256 } from './e2e-corpus-core.mjs';
import { E2ERunError } from './e2e-errors.mjs';

const REQUIRED_COVERAGE = Object.freeze(['independent-judge', 'repository-stages', 'subject-generation']);
const TRUSTED_ISOLATION = new Set(['container-separate-user', 'remote-vm', 'separate-uid']);
const MAX_WRAPPER_OUTPUT_BYTES = 16 * 1024 * 1024;
const INTERPRETER_NAMES = new Set(['bash', 'bun', 'deno', 'node', 'perl', 'python', 'python3', 'ruby', 'sh', 'zsh']);
const INLINE_INTERPRETER_ARGUMENTS = new Set(['--eval', '--print', '-c', '-e', '-p']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function regularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `${label} is unavailable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `${label} must be a regular non-symbolic file`);
  }
  return { stat, realPath: fs.realpathSync.native(filePath) };
}

function containedBy(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function wrapperFileRecord(filePath, argumentIndex, label) {
  const file = regularFile(filePath, label);
  const bytes = fs.readFileSync(file.realPath);
  return Object.freeze({
    argumentIndex,
    pathSha256: sha256(file.realPath),
    bytes: bytes.length,
    sha256: sha256(bytes),
    realPath: file.realPath,
  });
}

function wrapperClosure(wrapperCommand) {
  const files = [];
  for (const [index, argument] of wrapperCommand.entries()) {
    let referencedPath = path.isAbsolute(argument) ? argument : null;
    if (!referencedPath && argument.startsWith('file://')) {
      try {
        referencedPath = fileURLToPath(argument);
      } catch {
        throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `sandbox wrapper file URL argument ${index} is invalid`);
      }
    }
    if (!referencedPath && argument.startsWith('@') && path.isAbsolute(argument.slice(1))) {
      referencedPath = argument.slice(1);
    }
    const separator = argument.indexOf('=');
    if (!referencedPath && separator !== -1 && path.isAbsolute(argument.slice(separator + 1))) {
      referencedPath = argument.slice(separator + 1);
    }
    if (referencedPath) {
      if (!fs.existsSync(referencedPath)) {
        throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `sandbox wrapper absolute argument ${index} is unavailable`);
      }
      files.push(wrapperFileRecord(referencedPath, index, `sandbox wrapper file argument ${index}`));
    } else if (index > 0 && (argument.startsWith('.') || argument.includes(path.sep))) {
      throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `sandbox wrapper path argument ${index} must be absolute`);
    }
  }
  const executableName = path.basename(wrapperCommand[0]).replace(/\.(?:exe|cmd)$/iu, '');
  if (INTERPRETER_NAMES.has(executableName)) {
    const inlineArgument = wrapperCommand.slice(1).find((argument) => (
      INLINE_INTERPRETER_ARGUMENTS.has(argument)
      || [...INLINE_INTERPRETER_ARGUMENTS].some((flag) => argument.startsWith(`${flag}=`))
      || ['-c', '-e', '-p'].some((flag) => argument.startsWith(flag) && argument.length > flag.length)
    ));
    if (inlineArgument) {
      throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `inline interpreter sandbox wrappers are forbidden: ${inlineArgument}`);
    }
    if (!files.some(({ argumentIndex }) => argumentIndex > 0)) {
      throw new E2ERunError('SUBJECT_SANDBOX_INVALID', 'interpreter sandbox wrappers must bind at least one absolute regular script file');
    }
  }
  const publicFiles = files.map(({ realPath: _realPath, ...record }) => record);
  return Object.freeze({
    commandSha256: sha256(canonicalJson(wrapperCommand)),
    filesSha256: sha256(canonicalJson(publicFiles)),
    files: Object.freeze(files),
  });
}

function verifyWrapperClosure(sandbox) {
  const observed = sandbox.wrapperFiles.map((expected) => {
    const bytes = fs.readFileSync(expected.realPath);
    const observed = {
      argumentIndex: expected.argumentIndex,
      pathSha256: sha256(fs.realpathSync.native(expected.realPath)),
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
    if (canonicalJson(observed) !== canonicalJson({
      argumentIndex: expected.argumentIndex,
      pathSha256: expected.pathSha256,
      bytes: expected.bytes,
      sha256: expected.sha256,
    })) throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `sandbox wrapper file argument ${expected.argumentIndex} changed`);
    return observed;
  });
  if (
    sha256(canonicalJson(sandbox.wrapperCommand)) !== sandbox.wrapperCommandSha256
    || sha256(canonicalJson(observed)) !== sandbox.wrapperFilesSha256
  ) throw new E2ERunError('SUBJECT_SANDBOX_INVALID', 'sandbox wrapper command closure changed');
}

export function loadSubjectSandbox({ wrapperCommand, contractPath, repositoryRoot, holdoutKeyFilePath }) {
  if (
    !Array.isArray(wrapperCommand) || wrapperCommand.length === 0 || wrapperCommand.length > 16
    || wrapperCommand.some((argument) => typeof argument !== 'string' || argument.length === 0 || argument.length > 4096 || argument.includes('\0'))
    || !path.isAbsolute(wrapperCommand[0])
  ) {
    throw new E2ERunError('SUBJECT_SANDBOX_INVALID', 'sandbox wrapper command must begin with an absolute executable path');
  }
  if (!path.isAbsolute(contractPath ?? '')) {
    throw new E2ERunError('SUBJECT_SANDBOX_INVALID', 'sandbox contract path must be absolute');
  }
  const repositoryReal = fs.realpathSync.native(repositoryRoot);
  const wrapper = regularFile(wrapperCommand[0], 'sandbox wrapper executable');
  const closure = wrapperClosure(wrapperCommand);
  const contractFile = regularFile(contractPath, 'sandbox contract');
  const key = regularFile(holdoutKeyFilePath, 'holdout key');
  if ([...closure.files.map(({ realPath }) => realPath), contractFile.realPath, key.realPath]
    .some((candidate) => containedBy(candidate, repositoryReal))) {
    throw new E2ERunError('SUBJECT_SANDBOX_INVALID', 'sandbox wrapper files, contract, and holdout key must remain outside the repository');
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(contractFile.realPath, 'utf8'));
  } catch (error) {
    throw new E2ERunError('SUBJECT_SANDBOX_INVALID', `sandbox contract is invalid JSON: ${error.message}`);
  }
  if (!exactKeys(value, [
    'allowedPaths', 'coverage', 'deniedPathSha256', 'externalWrites', 'isolation', 'kind', 'network', 'processTree',
    'schemaVersion', 'trust', 'wrapperCommandSha256', 'wrapperFilesSha256', 'wrapperSha256',
  ])) throw new E2ERunError('SUBJECT_SANDBOX_INVALID', 'sandbox contract keys drift');
  const deniedPaths = [repositoryReal, key.realPath].sort();
  const deniedPathSha256 = sha256(canonicalJson(deniedPaths));
  if (
    value.schemaVersion !== '2.0.0'
    || value.kind !== 'programmable-e2e-subject-sandbox-contract'
    || value.trust !== 'external-operator-attested'
    || !TRUSTED_ISOLATION.has(value.isolation)
    || JSON.stringify(value.coverage) !== JSON.stringify(REQUIRED_COVERAGE)
    || value.deniedPathSha256 !== deniedPathSha256
    || value.wrapperSha256 !== sha256(fs.readFileSync(wrapper.realPath))
    || value.wrapperCommandSha256 !== closure.commandSha256
    || value.wrapperFilesSha256 !== closure.filesSha256
    || value.processTree !== 'all-descendants-reaped-before-return'
    || value.allowedPaths !== 'role-minimal-workspace-and-installed-skill-only'
    || value.externalWrites !== 'deny-outside-disposable-workspace'
    || value.network !== 'role-scoped-egress-allowlist-no-raw-rpc-secrets'
  ) throw new E2ERunError('SUBJECT_SANDBOX_INVALID', 'sandbox contract does not establish the required isolation boundary');
  return Object.freeze({
    wrapperCommand: Object.freeze([...wrapperCommand]),
    wrapperSha256: value.wrapperSha256,
    wrapperCommandSha256: value.wrapperCommandSha256,
    wrapperFilesSha256: value.wrapperFilesSha256,
    wrapperFiles: closure.files,
    wrapperFileCount: closure.files.length,
    contractSha256: sha256(fs.readFileSync(contractFile.realPath)),
    contractPathSha256: sha256(contractFile.realPath),
    deniedPathSha256,
    isolation: value.isolation,
    operatorAttested: true,
    cryptographicallyIsolationVerified: false,
    trusted: false,
  });
}

function validateRuntimeReceipt(value, { requestSha256, role, sandbox }) {
  if (!exactKeys(value, [
    'allowedPathsEnforced', 'completedAt', 'deniedPathSha256', 'externalWritesDenied', 'invocationId', 'isolation', 'kind',
    'networkPolicyEnforced', 'processTreeReaped', 'requestSha256', 'role', 'schemaVersion', 'startedAt',
    'wrapperCommandSha256', 'wrapperFilesSha256', 'wrapperSha256',
  ])) throw new E2ERunError('SUBJECT_SANDBOX_RECEIPT_INVALID', `${role}: runtime sandbox receipt keys drift`);
  const started = Date.parse(value.startedAt);
  const completed = Date.parse(value.completedAt);
  if (
    value.schemaVersion !== '2.0.0'
    || value.kind !== 'programmable-e2e-subject-sandbox-receipt'
    || value.requestSha256 !== requestSha256
    || value.role !== role
    || value.wrapperSha256 !== sandbox.wrapperSha256
    || value.wrapperCommandSha256 !== sandbox.wrapperCommandSha256
    || value.wrapperFilesSha256 !== sandbox.wrapperFilesSha256
    || value.deniedPathSha256 !== sandbox.deniedPathSha256
    || value.isolation !== sandbox.isolation
    || value.processTreeReaped !== true
    || value.allowedPathsEnforced !== true
    || value.externalWritesDenied !== true
    || value.networkPolicyEnforced !== true
    || typeof value.invocationId !== 'string'
    || value.invocationId.length < 16
    || !Number.isFinite(started)
    || !Number.isFinite(completed)
    || completed < started
  ) throw new E2ERunError('SUBJECT_SANDBOX_RECEIPT_INVALID', `${role}: runtime sandbox receipt binding drift`);
  return Object.freeze({
    ...value,
    operatorAttested: true,
    trustedExternalAttestation: false,
    cryptographicallyIsolationVerified: false,
  });
}

export function spawnIsolated({
  sandbox = null,
  role,
  command,
  args,
  cwd,
  env,
  controlDirectory,
  timeout,
  maxBuffer = MAX_WRAPPER_OUTPUT_BYTES,
}) {
  if (!sandbox) {
    const child = childProcess.spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env,
      maxBuffer,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    return {
      child,
      sandboxReceipt: Object.freeze({
        role,
        trustedExternalAttestation: false,
        isolation: 'local-same-uid-unrestricted',
        processTreeReaped: false,
      }),
    };
  }
  fs.mkdirSync(controlDirectory, { recursive: true, mode: 0o700 });
  verifyWrapperClosure(sandbox);
  const nonce = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const requestPath = path.join(controlDirectory, `${role}-${nonce}.request.json`);
  const receiptPath = path.join(controlDirectory, `${role}-${nonce}.receipt.json`);
  const request = {
    schemaVersion: '2.0.0',
    kind: 'programmable-e2e-subject-sandbox-request',
    role,
    command: [command, ...args],
    cwd,
    environment: env,
    receiptPath,
    sandboxWrapper: {
      commandSha256: sandbox.wrapperCommandSha256,
      filesSha256: sandbox.wrapperFilesSha256,
      executableSha256: sandbox.wrapperSha256,
    },
    policy: {
      allowedPaths: 'role-minimal-workspace-and-installed-skill-only',
      deniedPathSha256: sandbox.deniedPathSha256,
      externalWrites: 'deny-outside-disposable-workspace',
      network: 'role-scoped-egress-allowlist-no-raw-rpc-secrets',
      processTree: 'all-descendants-reaped-before-return',
    },
  };
  const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`, 'utf8');
  const requestSha256 = sha256(requestBytes);
  fs.writeFileSync(requestPath, requestBytes, { flag: 'wx', mode: 0o600 });
  const [wrapper, ...wrapperArgs] = sandbox.wrapperCommand;
  const child = childProcess.spawnSync(wrapper, [...wrapperArgs, '--request', requestPath], {
    cwd: controlDirectory,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', LANG: process.env.LANG ?? 'C', LC_ALL: process.env.LC_ALL ?? 'C' },
    maxBuffer,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  verifyWrapperClosure(sandbox);
  if (!fs.existsSync(receiptPath)) {
    throw new E2ERunError('SUBJECT_SANDBOX_RECEIPT_INVALID', `${role}: trusted wrapper did not produce a runtime receipt`);
  }
  const sandboxReceipt = validateRuntimeReceipt(
    JSON.parse(fs.readFileSync(receiptPath, 'utf8')),
    { requestSha256, role, sandbox },
  );
  return { child, sandboxReceipt };
}

export function sandboxReleaseGate(runs) {
  void runs;
  // Contract and runtime receipts are authored by the configured wrapper. This
  // repository has no independent trust root or cryptographic verifier for
  // those claims, so they can support a local rehearsal but never a release
  // isolation gate.
  return false;
}
