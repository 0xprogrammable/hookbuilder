import crypto from "node:crypto";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { projectCommandExecutionPlanSha256 } from "./project-command-executor-core.mjs";

export const PROJECT_SANDBOX_RECEIPT_SCHEMA_VERSION = "1.0.0";
export const PROJECT_SANDBOX_RECEIPT_KIND = "programmable-project-external-sandbox-receipt";
export const PROJECT_SANDBOX_REQUEST_KIND = "programmable-project-external-sandbox-request";
// This private constant is the sole production trust store. The portable
// release deliberately ships it empty; callers cannot import or extend it.
const PROJECT_SANDBOX_TRUSTED_PUBLIC_KEYS = Object.freeze({});

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GIT_OBJECT = /^(?!0{40}$)[0-9a-f]{40}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const KEY_ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const TRUSTED_ISOLATION = new Set(["container-separate-user", "remote-vm", "separate-uid"]);

export class ProjectSandboxReceiptError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectSandboxReceiptError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function createProjectSandboxRequestV1({ repositoryPlan, source }) {
  requirePlainObject(repositoryPlan, "repositoryPlan");
  requirePlainObject(source, "source");
  if (!SLUG.test(repositoryPlan.applicationId ?? "") || !Number.isSafeInteger(repositoryPlan.revision) || repositoryPlan.revision < 1) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "repository plan application identity or revision is invalid");
  }
  if (!GIT_OBJECT.test(source.headCommit ?? "") || !GIT_OBJECT.test(source.tree ?? "") || !SHA256.test(source.gitStatusSha256 ?? "")) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "sandbox request requires an exact clean source commit, tree, and status digest");
  }
  if (source.headCommit !== repositoryPlan.repository?.headCommit || source.branch !== repositoryPlan.repository?.branch) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "sandbox request source does not match the repository plan");
  }
  const inputArtifacts = Object.values(repositoryPlan.artifacts ?? {}).flat()
    .filter((artifact) => !["command-receipt", "trade-test-result"].includes(artifact?.kind))
    .map((artifact) => {
      if (!SLUG.test(artifact?.id ?? "") || !repositoryPath(artifact?.path)
        || !SLUG.test(artifact?.kind ?? "") || artifact.status !== "verified"
        || !SHA256.test(artifact.sha256 ?? "") || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1) {
        fail("PROJECT_SANDBOX_REQUEST_INVALID", `input artifact ${artifact?.id ?? "<unknown>"} is not exactly hash-bound`);
      }
      return {
        id: artifact.id,
        kind: artifact.kind,
        path: artifact.path,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (inputArtifacts.length === 0) fail("PROJECT_SANDBOX_REQUEST_INVALID", "sandbox request requires verified input artifacts");
  if (!Array.isArray(repositoryPlan.commands) || repositoryPlan.commands.length === 0) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "sandbox request requires planned commands");
  }
  const commands = repositoryPlan.commands.map((command) => ({
    id: command.id,
    commandSha256: canonicalJsonSha256V2(command),
    argvSha256: canonicalJsonSha256V2(command.argv),
    networkAccess: command.executionPolicy?.networkAccess,
    externalWrites: command.executionPolicy?.externalWrites
  }));
  for (const command of commands) {
    if (!SLUG.test(command.id ?? "") || !["forbidden", "read-only"].includes(command.networkAccess)
      || command.externalWrites !== false) {
      fail("PROJECT_SANDBOX_REQUEST_INVALID", `command ${command.id ?? "<unknown>"} has no enforceable policy`);
    }
  }
  const request = {
    schemaVersion: PROJECT_SANDBOX_RECEIPT_SCHEMA_VERSION,
    kind: PROJECT_SANDBOX_REQUEST_KIND,
    applicationId: repositoryPlan.applicationId,
    revision: repositoryPlan.revision,
    source: {
      headCommit: source.headCommit,
      tree: source.tree,
      branch: source.branch,
      gitStatusSha256: source.gitStatusSha256
    },
    executionPlanSha256: projectCommandExecutionPlanSha256(repositoryPlan),
    commandsSha256: canonicalJsonSha256V2(repositoryPlan.commands),
    commands,
    inputArtifactsSha256: canonicalJsonSha256V2(inputArtifacts),
    inputArtifacts,
    outputPlanPath: ".programmable/repository-plan.v1.json"
  };
  return deepFreeze({ ...request, requestSha256: canonicalJsonSha256V2(request) });
}

export function validateProjectSandboxReceiptV1(receipt) {
  try {
    validateReceiptStructure(receipt);
    return [];
  } catch (error) {
    return [{
      code: error?.code ?? "PROJECT_SANDBOX_RECEIPT_INVALID",
      path: "$",
      severity: "blocker",
      message: error instanceof Error ? error.message : String(error)
    }];
  }
}

export function verifyProjectSandboxReceiptV1(input) {
  requireExactKeys(input, ["receipt", "expectedRequest"], "sandbox receipt verification input", "PROJECT_SANDBOX_VERIFICATION_INPUT_INVALID");
  const { receipt, expectedRequest } = input;
  validateReceiptStructure(receipt);
  requirePlainObject(expectedRequest, "expectedRequest");
  if (canonicalJsonV2(receipt.payload.request) !== canonicalJsonV2(expectedRequest)) {
    fail("PROJECT_SANDBOX_SUBJECT_MISMATCH", "sandbox receipt does not bind the expected request bytes");
  }
  const keyMaterial = PROJECT_SANDBOX_TRUSTED_PUBLIC_KEYS[receipt.signature.keyId];
  if (typeof keyMaterial !== "string" && !Buffer.isBuffer(keyMaterial)) {
    fail("PROJECT_SANDBOX_AUTHORITY_UNTRUSTED", "sandbox receipt signer is not in the independently configured trust root");
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(keyMaterial);
  } catch {
    fail("PROJECT_SANDBOX_AUTHORITY_INVALID", "trusted sandbox authority public key is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    fail("PROJECT_SANDBOX_AUTHORITY_INVALID", "trusted sandbox authority public key must be Ed25519");
  }
  const signature = decodeCanonicalBase64(receipt.signature.value);
  if (signature.length !== 64 || !crypto.verify(null, canonicalPayloadBytes(receipt.payload), publicKey, signature)) {
    fail("PROJECT_SANDBOX_SIGNATURE_INVALID", "sandbox receipt signature verification failed");
  }
  return deepFreeze({
    status: "PROJECT_EXTERNAL_SANDBOX_RECEIPT_VERIFIED",
    keyId: receipt.signature.keyId,
    payloadSha256: receipt.payloadSha256,
    requestSha256: receipt.payload.request.requestSha256,
    executionCompleted: true,
    commandsExecuted: true,
    networkAccessed: receipt.payload.commands.some(({ networkAccessed }) => networkAccessed),
    externalWritesPerformed: false,
    outputArtifactsSha256: receipt.payload.result.outputArtifactsSha256
  });
}

function validateReceiptStructure(receipt) {
  requireExactKeys(receipt, ["schemaVersion", "kind", "payload", "payloadSha256", "signature"], "sandbox receipt");
  if (receipt.schemaVersion !== PROJECT_SANDBOX_RECEIPT_SCHEMA_VERSION || receipt.kind !== PROJECT_SANDBOX_RECEIPT_KIND) {
    fail("PROJECT_SANDBOX_SCHEMA_UNSUPPORTED", "sandbox receipt schema or kind is unsupported");
  }
  requireExactKeys(receipt.signature, ["algorithm", "keyId", "value"], "sandbox receipt signature");
  if (receipt.signature.algorithm !== "ed25519" || !KEY_ID.test(receipt.signature.keyId ?? "")
    || typeof receipt.signature.value !== "string" || receipt.signature.value.length < 80 || receipt.signature.value.length > 128) {
    fail("PROJECT_SANDBOX_SIGNATURE_INVALID", "sandbox receipt signature metadata is invalid");
  }
  validatePayload(receipt.payload);
  if (!SHA256.test(receipt.payloadSha256 ?? "")
    || canonicalJsonSha256V2(receipt.payload) !== receipt.payloadSha256) {
    fail("PROJECT_SANDBOX_PAYLOAD_MISMATCH", "sandbox receipt canonical payload digest does not match");
  }
}

function validatePayload(payload) {
  requireExactKeys(payload, ["status", "request", "launcher", "runtime", "policy", "commands", "result"], "sandbox payload");
  if (payload.status !== "completed") fail("PROJECT_SANDBOX_EXECUTION_INCOMPLETE", "sandbox receipt must record completed execution");
  validateRequest(payload.request);
  validateLauncher(payload.launcher);
  validateRuntime(payload.runtime);
  validatePolicy(payload.policy, payload.request);
  validateCommands(payload.commands, payload.request, payload.policy);
  validateResult(payload.result, payload.commands);
}

function validateRequest(request) {
  requireExactKeys(request, [
    "schemaVersion", "kind", "applicationId", "revision", "source", "executionPlanSha256", "commandsSha256",
    "commands", "inputArtifactsSha256", "inputArtifacts", "outputPlanPath", "requestSha256"
  ], "sandbox request");
  requireExactKeys(request.source, ["headCommit", "tree", "branch", "gitStatusSha256"], "sandbox request source");
  if (request.schemaVersion !== PROJECT_SANDBOX_RECEIPT_SCHEMA_VERSION || request.kind !== PROJECT_SANDBOX_REQUEST_KIND
    || !SLUG.test(request.applicationId ?? "") || !Number.isSafeInteger(request.revision) || request.revision < 1
    || !GIT_OBJECT.test(request.source.headCommit ?? "") || !GIT_OBJECT.test(request.source.tree ?? "")
    || !(request.source.branch === null || boundedString(request.source.branch, 1, 300))
    || !SHA256.test(request.source.gitStatusSha256 ?? "") || !SHA256.test(request.executionPlanSha256 ?? "")
    || !SHA256.test(request.commandsSha256 ?? "") || !SHA256.test(request.inputArtifactsSha256 ?? "")
    || request.outputPlanPath !== ".programmable/repository-plan.v1.json" || !SHA256.test(request.requestSha256 ?? "")) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "sandbox request identity is invalid");
  }
  if (!Array.isArray(request.commands) || request.commands.length === 0 || request.commands.length > 128) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "sandbox request command inventory is invalid");
  }
  for (const command of request.commands) {
    requireExactKeys(command, ["id", "commandSha256", "argvSha256", "networkAccess", "externalWrites"], "sandbox request command");
    if (!SLUG.test(command.id ?? "") || !SHA256.test(command.commandSha256 ?? "") || !SHA256.test(command.argvSha256 ?? "")
      || !["forbidden", "read-only"].includes(command.networkAccess) || command.externalWrites !== false) {
      fail("PROJECT_SANDBOX_REQUEST_INVALID", `sandbox request command ${command.id ?? "<unknown>"} is invalid`);
    }
  }
  if (!Array.isArray(request.inputArtifacts) || request.inputArtifacts.length === 0 || request.inputArtifacts.length > 4096) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "sandbox request input artifact inventory is invalid");
  }
  for (const artifact of request.inputArtifacts) {
    requireExactKeys(artifact, ["id", "kind", "path", "sha256", "byteLength"], "sandbox request input artifact");
    if (!SLUG.test(artifact.id ?? "") || !SLUG.test(artifact.kind ?? "") || !repositoryPath(artifact.path)
      || !SHA256.test(artifact.sha256 ?? "") || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1) {
      fail("PROJECT_SANDBOX_REQUEST_INVALID", `sandbox input artifact ${artifact.id ?? "<unknown>"} is invalid`);
    }
  }
  if (canonicalJsonSha256V2(request.inputArtifacts) !== request.inputArtifactsSha256) {
    fail("PROJECT_SANDBOX_INPUT_MISMATCH", "sandbox input artifact inventory digest does not match");
  }
  const { requestSha256: _requestSha256, ...requestPayload } = request;
  if (canonicalJsonSha256V2(requestPayload) !== request.requestSha256) {
    fail("PROJECT_SANDBOX_REQUEST_MISMATCH", "sandbox request digest does not match its canonical payload");
  }
}

function validateLauncher(launcher) {
  requireExactKeys(launcher, ["id", "version", "binarySha256", "configurationSha256"], "sandbox launcher");
  const valid = [
    SLUG.test(launcher.id ?? ""),
    boundedString(launcher.version, 1, 120),
    SHA256.test(launcher.binarySha256 ?? ""),
    SHA256.test(launcher.configurationSha256 ?? "")
  ].every(Boolean);
  if (!valid) {
    fail("PROJECT_SANDBOX_LAUNCHER_INVALID", "sandbox launcher identity is invalid");
  }
}

function validateRuntime(runtime) {
  requireExactKeys(runtime, ["id", "version", "imageSha256", "isolation"], "sandbox runtime");
  const valid = [
    SLUG.test(runtime.id ?? ""),
    boundedString(runtime.version, 1, 120),
    SHA256.test(runtime.imageSha256 ?? ""),
    TRUSTED_ISOLATION.has(runtime.isolation)
  ].every(Boolean);
  if (!valid) {
    fail("PROJECT_SANDBOX_RUNTIME_INVALID", "sandbox runtime does not establish a separate authority boundary");
  }
}

function validatePolicy(policy, request) {
  requireExactKeys(policy, ["filesystem", "network", "secrets", "externalWrites", "process"], "sandbox policy");
  requireExactKeys(policy.filesystem, [
    "enforced", "sourceReadOnly", "disposableWorkspace", "writeScope", "allowedPathsSha256", "deniedPathsSha256"
  ], "sandbox filesystem policy");
  requireExactKeys(policy.network, ["enforced", "mode", "allowlistSha256"], "sandbox network policy");
  requireExactKeys(policy.secrets, ["enforced", "inherited", "mounted"], "sandbox secret policy");
  requireExactKeys(policy.externalWrites, ["enforced", "allowed"], "sandbox external write policy");
  requireExactKeys(policy.process, ["descendantsReaped"], "sandbox process policy");
  if (policy.filesystem.enforced !== true || policy.filesystem.sourceReadOnly !== true
    || policy.filesystem.disposableWorkspace !== true || policy.filesystem.writeScope !== "disposable-output-only"
    || !SHA256.test(policy.filesystem.allowedPathsSha256 ?? "") || !SHA256.test(policy.filesystem.deniedPathsSha256 ?? "")
    || policy.network.enforced !== true || !["forbidden", "read-only-allowlist"].includes(policy.network.mode)
    || !(policy.network.allowlistSha256 === null || SHA256.test(policy.network.allowlistSha256 ?? ""))
    || (policy.network.mode === "forbidden" ? policy.network.allowlistSha256 !== null : policy.network.allowlistSha256 === null)
    || policy.secrets.enforced !== true || policy.secrets.inherited !== false || policy.secrets.mounted !== false
    || policy.externalWrites.enforced !== true || policy.externalWrites.allowed !== false
    || policy.process.descendantsReaped !== true) {
    fail("PROJECT_SANDBOX_POLICY_NOT_ENFORCED", "sandbox receipt does not prove all filesystem, network, secret, write, and process policies");
  }
  const needsNetwork = request.commands.some(({ networkAccess }) => networkAccess === "read-only");
  if (needsNetwork !== (policy.network.mode === "read-only-allowlist")) {
    fail("PROJECT_SANDBOX_NETWORK_POLICY_MISMATCH", "sandbox network policy does not match planned command authority");
  }
}

function validateCommands(commands, request, policy) {
  if (!Array.isArray(commands) || commands.length !== request.commands.length) {
    fail("PROJECT_SANDBOX_COMMAND_RESULT_MISMATCH", "sandbox command results do not match the request cardinality");
  }
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const requested = request.commands[index];
    requireExactKeys(command, [
      "id", "commandSha256", "argvSha256", "status", "exitCode", "signal", "timedOut", "outputExceeded",
      "stdoutSha256", "stdoutByteLength", "stderrSha256", "stderrByteLength", "networkAccessed",
      "externalWritesPerformed", "filesystemWritesSha256"
    ], "sandbox command result");
    if (command.id !== requested.id || command.commandSha256 !== requested.commandSha256 || command.argvSha256 !== requested.argvSha256
      || command.status !== "passed" || command.exitCode !== 0 || command.signal !== null || command.timedOut !== false
      || command.outputExceeded !== false || !SHA256.test(command.stdoutSha256 ?? "")
      || !Number.isSafeInteger(command.stdoutByteLength) || command.stdoutByteLength < 0
      || !SHA256.test(command.stderrSha256 ?? "") || !Number.isSafeInteger(command.stderrByteLength) || command.stderrByteLength < 0
      || typeof command.networkAccessed !== "boolean" || command.externalWritesPerformed !== false
      || !SHA256.test(command.filesystemWritesSha256 ?? "")) {
      fail("PROJECT_SANDBOX_COMMAND_RESULT_INVALID", `sandbox result for command ${requested.id} is invalid`);
    }
    if ((requested.networkAccess === "forbidden" || policy.network.mode === "forbidden") && command.networkAccessed !== false) {
      fail("PROJECT_SANDBOX_NETWORK_POLICY_VIOLATED", `command ${requested.id} accessed the network despite a forbidden policy`);
    }
  }
}

function validateResult(result, commands) {
  requireExactKeys(result, ["executionCompleted", "commandsSha256", "outputArtifacts", "outputArtifactsSha256"], "sandbox result");
  if (result.executionCompleted !== true || !SHA256.test(result.commandsSha256 ?? "")
    || !SHA256.test(result.outputArtifactsSha256 ?? "") || !Array.isArray(result.outputArtifacts)
    || result.outputArtifacts.length === 0 || result.outputArtifacts.length > 4096) {
    fail("PROJECT_SANDBOX_RESULT_INVALID", "sandbox completion result is invalid");
  }
  if (canonicalJsonSha256V2(commands) !== result.commandsSha256) {
    fail("PROJECT_SANDBOX_RESULT_MISMATCH", "sandbox command result digest does not match");
  }
  for (const artifact of result.outputArtifacts) {
    requireExactKeys(artifact, ["id", "kind", "path", "sha256", "byteLength"], "sandbox output artifact");
    if (!SLUG.test(artifact.id ?? "") || !SLUG.test(artifact.kind ?? "") || !repositoryPath(artifact.path)
      || !SHA256.test(artifact.sha256 ?? "") || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1) {
      fail("PROJECT_SANDBOX_RESULT_INVALID", `sandbox output artifact ${artifact.id ?? "<unknown>"} is invalid`);
    }
  }
  if (canonicalJsonSha256V2(result.outputArtifacts) !== result.outputArtifactsSha256) {
    fail("PROJECT_SANDBOX_RESULT_MISMATCH", "sandbox output artifact digest does not match");
  }
}

function canonicalPayloadBytes(payload) {
  return Buffer.from(canonicalJsonV2(payload), "utf8");
}

function decodeCanonicalBase64(value) {
  let bytes;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    fail("PROJECT_SANDBOX_SIGNATURE_INVALID", "sandbox receipt signature is not base64");
  }
  if (bytes.toString("base64") !== value) fail("PROJECT_SANDBOX_SIGNATURE_INVALID", "sandbox receipt signature is not canonical base64");
  return bytes;
}

function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("PROJECT_SANDBOX_RECEIPT_INVALID", `${label} must be an object`);
  }
}

function requireExactKeys(value, expected, label, code = "PROJECT_SANDBOX_RECEIPT_INVALID") {
  requirePlainObject(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(code, `${label} keys drift`);
  }
}

function repositoryPath(value) {
  return boundedString(value, 1, 500)
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.includes("\0")
    && !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function boundedString(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !value.includes("\0");
}

function fail(code, message, details = {}) {
  throw new ProjectSandboxReceiptError(code, message, details);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
