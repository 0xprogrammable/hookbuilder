import crypto from "node:crypto";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";

export const PROJECT_REPAIR_ATTEMPT_SCHEMA_VERSION = "1.0.0";
export const PROJECT_REPAIR_ATTEMPT_KIND = "programmable-project-repair-attempt";
export const PROJECT_REPAIR_MAXIMUM_ATTEMPTS = 3;

const PROJECT_REPAIR_TRUSTED_PUBLIC_KEYS = Object.freeze({});
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GIT_OBJECT = /^(?!0{40}$)[0-9a-f]{40}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const KEY_ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const SIGNAL = /^SIG[A-Z0-9]{1,24}$/u;
const TRUSTED_ISOLATION = new Set(["container-separate-user", "remote-vm", "separate-uid"]);
const COMMAND_STATUSES = new Set(["passed", "failed", "not-run", "tooling-blocked"]);
const ROOT_STATUSES = new Set(["failed", "tooling-blocked"]);
const MAXIMUM_STREAM_BYTES = 134_217_728;
const EMPTY_SHA256 = `sha256:${crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`;

export class ProjectRepairAttemptError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectRepairAttemptError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function validateProjectRepairAttemptV1(attempt) {
  try {
    assertAttempt(attempt);
    return [];
  } catch (error) {
    return [{
      code: error?.code ?? "PROJECT_REPAIR_ATTEMPT_INVALID",
      path: "$",
      severity: "blocker",
      message: error instanceof Error ? error.message : String(error)
    }];
  }
}

export function verifyProjectRepairAttemptV1(input) {
  requireExactKeys(input, ["attempt", "expectedRequest"], "repair attempt verification input", "PROJECT_REPAIR_VERIFICATION_INPUT_INVALID");
  const { attempt, expectedRequest } = input;
  assertAttempt(attempt);
  requirePlainObject(expectedRequest, "expectedRequest");
  if (canonicalJsonV2(attempt.payload.request) !== canonicalJsonV2(expectedRequest)) {
    fail("PROJECT_REPAIR_SUBJECT_MISMATCH", "repair attempt does not bind the expected sandbox request bytes");
  }
  const keyMaterial = PROJECT_REPAIR_TRUSTED_PUBLIC_KEYS[attempt.signature.keyId];
  if (typeof keyMaterial !== "string" && !Buffer.isBuffer(keyMaterial)) {
    fail("PROJECT_REPAIR_AUTHORITY_UNTRUSTED", "repair attempt signer is not in the independently configured trust root");
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(keyMaterial);
  } catch {
    fail("PROJECT_REPAIR_AUTHORITY_INVALID", "trusted repair authority public key is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    fail("PROJECT_REPAIR_AUTHORITY_INVALID", "trusted repair authority public key must be Ed25519");
  }
  const signature = decodeCanonicalBase64(attempt.signature.value);
  if (signature.length !== 64 || !crypto.verify(null, Buffer.from(canonicalJsonV2(attempt.payload), "utf8"), publicKey, signature)) {
    fail("PROJECT_REPAIR_SIGNATURE_INVALID", "repair attempt signature verification failed");
  }
  return deepFreeze({
    status: "PROJECT_REPAIR_ATTEMPT_VERIFIED_NOT_COMPLETION",
    payloadSha256: attempt.payloadSha256,
    requestSha256: attempt.payload.request.requestSha256,
    keyId: attempt.signature.keyId,
    completion: "NOT_COMPLETION",
    approval: "NOT_APPROVAL",
    preflightUnlock: false
  });
}

export function diagnoseProjectRepairAttemptV1(input) {
  requireExactKeys(input, ["attempt", "expectedRequest", "previousAttempts"], "repair diagnosis input", "PROJECT_REPAIR_DIAGNOSIS_INPUT_INVALID");
  const { attempt, expectedRequest, previousAttempts } = input;
  if (!Array.isArray(previousAttempts) || previousAttempts.length > PROJECT_REPAIR_MAXIMUM_ATTEMPTS - 1) {
    fail("PROJECT_REPAIR_HISTORY_INVALID", "repair history must contain at most two previous attempts");
  }
  const attempts = [...previousAttempts, attempt];
  for (const candidate of attempts) assertAttempt(candidate);
  requirePlainObject(expectedRequest, "expectedRequest");
  if (canonicalJsonV2(attempt.payload.request) !== canonicalJsonV2(expectedRequest)) {
    fail("PROJECT_REPAIR_SUBJECT_MISMATCH", "current repair attempt does not bind the exact current sandbox request");
  }
  assertAttemptHistory(attempts);

  const root = rootObservation(attempt);
  const diagnosis = classifyRoot(root);
  const priorBlindRetry = previousAttempts.some((candidate) => {
    const previousRoot = rootObservation(candidate);
    return candidate.payload.request.requestSha256 === attempt.payload.request.requestSha256
      && ["TIMEOUT", "SIGNAL"].includes(classifyRoot(previousRoot));
  });
  const repairAttemptsRemaining = Math.max(0, PROJECT_REPAIR_MAXIMUM_ATTEMPTS - attempt.payload.attemptNumber);
  const budgetExhausted = repairAttemptsRemaining === 0;
  const blindRetryCandidate = ["TIMEOUT", "SIGNAL"].includes(diagnosis);
  const blindRetryAllowed = !budgetExhausted && blindRetryCandidate && !priorBlindRetry;
  const status = budgetExhausted
    ? "PROJECT_REPAIR_BUDGET_EXHAUSTED"
    : root.status === "tooling-blocked"
      ? "PROJECT_TOOLING_PREREQUISITE_REQUIRED"
      : "PROJECT_REPAIR_REQUIRED";
  const next = nextAction({ status, root, diagnosis, blindRetryAllowed });
  const rootRecord = {
    commandId: root.id,
    status: root.status,
    diagnosis,
    semanticRootCause: "UNDETERMINED",
    timedOut: root.timedOut,
    signal: root.signal,
    outputExceeded: root.outputExceeded,
    stdoutSha256: root.stdoutSha256,
    stdoutByteLength: root.stdoutByteLength,
    stderrSha256: root.stderrSha256,
    stderrByteLength: root.stderrByteLength,
    suppressedCommandIds: [...attempt.payload.result.suppressedCommandIds]
  };
  const payload = {
    schemaVersion: "1.0.0",
    kind: "project-repair-diagnosis",
    status,
    canonicalOutput: false,
    root: rootRecord,
    next,
    attemptHistory: {
      sessionId: attempt.payload.sessionId,
      attemptNumber: attempt.payload.attemptNumber,
      failureCount: attempts.length,
      payloadSha256: attempts.map((candidate) => candidate.payloadSha256),
      earlierFailuresPreserved: attempts.length > 1
    },
    retryPolicy: {
      initialAttempts: 1,
      maximumRepairAttempts: PROJECT_REPAIR_MAXIMUM_ATTEMPTS - 1,
      repairAttemptsUsed: attempt.payload.attemptNumber - 1,
      repairAttemptsRemaining,
      blindRetryLimit: 1,
      blindRetryAllowed,
      blindRetryReason: blindRetryAllowed ? diagnosis : null
    },
    evidenceBoundary: {
      completion: "NOT_COMPLETION",
      approval: "NOT_APPROVAL",
      preflightUnlock: false,
      projectPreflightStatus: "NOT_PROJECT_PREFLIGHT_VALID",
      signaturePresent: true,
      signatureVerified: false,
      signerTrusted: false,
      authenticationStatus: "INDEPENDENT_TRUST_ROOT_REQUIRED",
      commandsExecutedByDiagnose: false,
      networkAccessedByDiagnose: false,
      externalWritesPerformed: false,
      externalActionsPerformed: []
    }
  };
  return deepFreeze({ ...payload, reportSha256: canonicalJsonSha256V2(payload) });
}

function assertAttempt(attempt) {
  requireExactKeys(attempt, ["schemaVersion", "kind", "payload", "payloadSha256", "signature"], "repair attempt");
  if (attempt.schemaVersion !== PROJECT_REPAIR_ATTEMPT_SCHEMA_VERSION || attempt.kind !== PROJECT_REPAIR_ATTEMPT_KIND) {
    fail("PROJECT_REPAIR_SCHEMA_UNSUPPORTED", "repair attempt schema or kind is unsupported");
  }
  requireExactKeys(attempt.signature, ["algorithm", "keyId", "value"], "repair attempt signature");
  if (attempt.signature.algorithm !== "ed25519" || !KEY_ID.test(attempt.signature.keyId ?? "")) {
    fail("PROJECT_REPAIR_SIGNATURE_INVALID", "repair attempt signature metadata is invalid");
  }
  const signatureBytes = decodeCanonicalBase64(attempt.signature.value);
  if (signatureBytes.length !== 64) fail("PROJECT_REPAIR_SIGNATURE_INVALID", "repair attempt signature must contain 64 Ed25519 bytes");
  requireExactKeys(attempt.payload, [
    "status", "sessionId", "attemptNumber", "previousAttemptPayloadSha256", "request", "launcher", "runtime",
    "policy", "commands", "result", "authorization"
  ], "repair attempt payload");
  if (!SHA256.test(attempt.payloadSha256 ?? "") || canonicalJsonSha256V2(attempt.payload) !== attempt.payloadSha256) {
    fail("PROJECT_REPAIR_PAYLOAD_MISMATCH", "repair attempt canonical payload digest does not match");
  }
  if (!allTrue([
    ROOT_STATUSES.has(attempt.payload.status),
    slug(attempt.payload.sessionId),
    Number.isSafeInteger(attempt.payload.attemptNumber),
    attempt.payload.attemptNumber >= 1,
    attempt.payload.attemptNumber <= PROJECT_REPAIR_MAXIMUM_ATTEMPTS
  ])) {
    fail("PROJECT_REPAIR_IDENTITY_INVALID", "repair attempt identity or root status is invalid");
  }
  const wantsPrevious = attempt.payload.attemptNumber > 1;
  if (wantsPrevious !== SHA256.test(attempt.payload.previousAttemptPayloadSha256 ?? "")) {
    fail("PROJECT_REPAIR_HISTORY_INVALID", "repair attempt previous payload binding does not match its attempt number");
  }
  validateRequest(attempt.payload.request);
  validateLauncher(attempt.payload.launcher);
  validateRuntime(attempt.payload.runtime);
  validatePolicy(attempt.payload.policy, attempt.payload.request);
  validateCommandObservations(attempt.payload.commands, attempt.payload.request, attempt.payload.policy, attempt.payload.status);
  validateResult(attempt.payload.result, attempt.payload.commands, attempt.payload.request, attempt.payload.status);
  validateAuthorization(attempt.payload.authorization);
}

function validateRequest(request) {
  requireExactKeys(request, [
    "schemaVersion", "kind", "applicationId", "revision", "source", "executionPlanSha256", "commandsSha256",
    "commands", "inputArtifactsSha256", "inputArtifacts", "outputPlanPath", "requestSha256"
  ], "repair sandbox request");
  requireExactKeys(request.source, ["headCommit", "tree", "branch", "gitStatusSha256"], "repair sandbox request source");
  if (!allTrue([
    request.schemaVersion === "1.0.0",
    request.kind === "programmable-project-external-sandbox-request",
    slug(request.applicationId),
    Number.isSafeInteger(request.revision),
    request.revision >= 1,
    GIT_OBJECT.test(request.source.headCommit ?? ""),
    GIT_OBJECT.test(request.source.tree ?? ""),
    request.source.branch === null || boundedString(request.source.branch, 1, 300),
    SHA256.test(request.source.gitStatusSha256 ?? ""),
    SHA256.test(request.executionPlanSha256 ?? ""),
    SHA256.test(request.commandsSha256 ?? ""),
    SHA256.test(request.inputArtifactsSha256 ?? ""),
    request.outputPlanPath === ".programmable/repository-plan.v1.json",
    SHA256.test(request.requestSha256 ?? "")
  ])) {
    fail("PROJECT_REPAIR_REQUEST_INVALID", "repair attempt sandbox request identity is invalid");
  }
  if (!Array.isArray(request.commands) || request.commands.length < 1 || request.commands.length > 128) {
    fail("PROJECT_REPAIR_REQUEST_INVALID", "repair attempt requires between one and 128 requested commands");
  }
  for (const command of request.commands) {
    requireExactKeys(command, ["id", "commandSha256", "argvSha256", "networkAccess", "externalWrites"], "repair requested command");
    if (!allTrue([
      slug(command.id),
      SHA256.test(command.commandSha256 ?? ""),
      SHA256.test(command.argvSha256 ?? ""),
      ["forbidden", "read-only"].includes(command.networkAccess),
      command.externalWrites === false
    ])) {
      fail("PROJECT_REPAIR_REQUEST_INVALID", `repair requested command ${command.id ?? "<unknown>"} is invalid`);
    }
  }
  if (!Array.isArray(request.inputArtifacts) || request.inputArtifacts.length < 1 || request.inputArtifacts.length > 4096) {
    fail("PROJECT_REPAIR_REQUEST_INVALID", "repair attempt requires exact input artifacts");
  }
  for (const artifact of request.inputArtifacts) {
    requireExactKeys(artifact, ["id", "kind", "path", "sha256", "byteLength"], "repair input artifact");
    if (!allTrue([
      slug(artifact.id),
      slug(artifact.kind),
      repositoryPath(artifact.path),
      SHA256.test(artifact.sha256 ?? ""),
      Number.isSafeInteger(artifact.byteLength),
      artifact.byteLength >= 1
    ])) {
      fail("PROJECT_REPAIR_REQUEST_INVALID", `repair input artifact ${artifact.id ?? "<unknown>"} is invalid`);
    }
  }
  if (canonicalJsonSha256V2(request.inputArtifacts) !== request.inputArtifactsSha256) {
    fail("PROJECT_REPAIR_INPUT_MISMATCH", "repair input artifact inventory digest does not match");
  }
  const { requestSha256: _requestSha256, ...requestPayload } = request;
  if (canonicalJsonSha256V2(requestPayload) !== request.requestSha256) {
    fail("PROJECT_REPAIR_REQUEST_MISMATCH", "repair sandbox request digest does not match its canonical payload");
  }
}

function validateLauncher(launcher) {
  requireExactKeys(launcher, ["id", "version", "binarySha256", "configurationSha256"], "repair launcher");
  if (!allTrue([
    slug(launcher.id),
    boundedString(launcher.version, 1, 120),
    SHA256.test(launcher.binarySha256 ?? ""),
    SHA256.test(launcher.configurationSha256 ?? "")
  ])) {
    fail("PROJECT_REPAIR_LAUNCHER_INVALID", "repair launcher identity is invalid");
  }
}

function validateRuntime(runtime) {
  requireExactKeys(runtime, ["id", "version", "imageSha256", "isolation"], "repair runtime");
  if (!allTrue([
    slug(runtime.id),
    boundedString(runtime.version, 1, 120),
    SHA256.test(runtime.imageSha256 ?? ""),
    TRUSTED_ISOLATION.has(runtime.isolation)
  ])) {
    fail("PROJECT_REPAIR_RUNTIME_INVALID", "repair runtime does not establish a separate authority boundary");
  }
}

function validatePolicy(policy, request) {
  requireExactKeys(policy, ["filesystem", "network", "secrets", "externalWrites", "process"], "repair policy");
  requireExactKeys(policy.filesystem, ["enforced", "sourceReadOnly", "disposableWorkspace", "writeScope", "allowedPathsSha256", "deniedPathsSha256"], "repair filesystem policy");
  requireExactKeys(policy.network, ["enforced", "mode", "allowlistSha256"], "repair network policy");
  requireExactKeys(policy.secrets, ["enforced", "inherited", "mounted"], "repair secret policy");
  requireExactKeys(policy.externalWrites, ["enforced", "allowed"], "repair external write policy");
  requireExactKeys(policy.process, ["descendantsReaped"], "repair process policy");
  const networkAllowlistShapeValid = policy.network.mode === "forbidden"
    ? policy.network.allowlistSha256 === null
    : SHA256.test(policy.network.allowlistSha256 ?? "");
  if (!allTrue([
    policy.filesystem.enforced === true,
    policy.filesystem.sourceReadOnly === true,
    policy.filesystem.disposableWorkspace === true,
    policy.filesystem.writeScope === "disposable-output-only",
    SHA256.test(policy.filesystem.allowedPathsSha256 ?? ""),
    SHA256.test(policy.filesystem.deniedPathsSha256 ?? ""),
    policy.network.enforced === true,
    ["forbidden", "read-only-allowlist"].includes(policy.network.mode),
    networkAllowlistShapeValid,
    policy.secrets.enforced === true,
    policy.secrets.inherited === false,
    policy.secrets.mounted === false,
    policy.externalWrites.enforced === true,
    policy.externalWrites.allowed === false,
    policy.process.descendantsReaped === true
  ])) {
    fail("PROJECT_REPAIR_POLICY_NOT_ENFORCED", "repair attempt does not prove filesystem, network, secret, write, and process isolation");
  }
  const needsNetwork = request.commands.some(({ networkAccess }) => networkAccess === "read-only");
  if (needsNetwork !== (policy.network.mode === "read-only-allowlist")) {
    fail("PROJECT_REPAIR_NETWORK_POLICY_MISMATCH", "repair network policy does not match planned command authority");
  }
}

function validateCommandObservations(commands, request, policy, payloadStatus) {
  if (!Array.isArray(commands) || commands.length !== request.commands.length) {
    fail("PROJECT_REPAIR_COMMAND_RESULT_MISMATCH", "repair command observations must cover the exact requested command order");
  }
  const roots = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const requested = request.commands[index];
    requireExactKeys(command, [
      "id", "commandSha256", "argvSha256", "status", "exitCode", "signal", "timedOut", "outputExceeded",
      "stdoutSha256", "stdoutByteLength", "stderrSha256", "stderrByteLength", "networkAccessed",
      "externalWritesPerformed", "filesystemWritesSha256"
    ], "repair command observation");
    const exitCodeValid = command.exitCode === null
      || allTrue([Number.isSafeInteger(command.exitCode), command.exitCode >= 0, command.exitCode <= 255]);
    if (!allTrue([
      command.id === requested.id,
      command.commandSha256 === requested.commandSha256,
      command.argvSha256 === requested.argvSha256,
      COMMAND_STATUSES.has(command.status),
      exitCodeValid,
      command.signal === null || SIGNAL.test(command.signal ?? ""),
      typeof command.timedOut === "boolean",
      typeof command.outputExceeded === "boolean",
      SHA256.test(command.stdoutSha256 ?? ""),
      boundedByteLength(command.stdoutByteLength),
      SHA256.test(command.stderrSha256 ?? ""),
      boundedByteLength(command.stderrByteLength),
      typeof command.networkAccessed === "boolean",
      SHA256.test(command.filesystemWritesSha256 ?? "")
    ])) {
      fail("PROJECT_REPAIR_COMMAND_OBSERVATION_INVALID", `repair observation for command ${requested.id} is invalid`);
    }
    if (command.externalWritesPerformed !== false) {
      fail("PROJECT_REPAIR_EXTERNAL_WRITE_OBSERVED", `repair command ${requested.id} performed an external write`);
    }
    if ((requested.networkAccess === "forbidden" || policy.network.mode === "forbidden") && command.networkAccessed !== false) {
      fail("PROJECT_REPAIR_NETWORK_POLICY_VIOLATED", `repair command ${requested.id} accessed the network despite a forbidden policy`);
    }
    if (ROOT_STATUSES.has(command.status)) roots.push(index);
  }
  if (roots.length === 0) fail("PROJECT_REPAIR_ATTEMPT_HAS_NO_FAILURE", "all-pass evidence must use the completion receipt, never a repair attempt");
  if (roots.length !== 1) fail("PROJECT_REPAIR_ROOT_COUNT_INVALID", "repair attempt must contain exactly one failed or tooling-blocked root");
  const rootIndex = roots[0];
  if (commands.slice(0, rootIndex).some(({ status }) => status !== "passed")) {
    fail("PROJECT_REPAIR_PREFIX_INVALID", "every command before the repair root must be passed");
  }
  if (commands.slice(rootIndex + 1).some(({ status }) => status !== "not-run")) {
    fail("PROJECT_REPAIR_CASCADE_FORBIDDEN", "every command after the repair root must be suppressed as not-run");
  }
  if (commands[rootIndex].status !== payloadStatus) {
    fail("PROJECT_REPAIR_ROOT_STATUS_MISMATCH", "repair payload status must match the exact root command status");
  }
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command.status === "passed" && !allTrue([
      command.exitCode === 0,
      command.signal === null,
      !command.timedOut,
      !command.outputExceeded
    ])) {
      fail("PROJECT_REPAIR_COMMAND_OBSERVATION_INVALID", `passed repair command ${command.id} has failure evidence`);
    }
    if (command.status === "not-run" && !allTrue([
      command.exitCode === null,
      command.signal === null,
      !command.timedOut,
      !command.outputExceeded,
      command.stdoutSha256 === EMPTY_SHA256,
      command.stdoutByteLength === 0,
      command.stderrSha256 === EMPTY_SHA256,
      command.stderrByteLength === 0,
      command.networkAccessed === false,
      command.filesystemWritesSha256 === EMPTY_SHA256
    ])) {
      fail("PROJECT_REPAIR_SUPPRESSION_INVALID", `suppressed repair command ${command.id} must carry exact empty observations`);
    }
  }
  const root = commands[rootIndex];
  if (root.status === "failed" && root.exitCode === 0 && root.signal === null && !root.timedOut && !root.outputExceeded) {
    fail("PROJECT_REPAIR_ROOT_OBSERVATION_INVALID", "failed repair root has no nonzero exit, signal, timeout, or output-limit evidence");
  }
  if (root.status === "tooling-blocked" && (root.signal !== null || root.timedOut || root.outputExceeded)) {
    fail("PROJECT_REPAIR_ROOT_OBSERVATION_INVALID", "tooling-blocked repair root cannot claim process execution failure");
  }
}

function validateResult(result, commands, request, payloadStatus) {
  requireExactKeys(result, [
    "executionCompleted", "rootCommandId", "rootStatus", "commandsSha256", "suppressedCommandIds",
    "completionEligible", "approvalEligible", "preflightUnlock"
  ], "repair attempt result");
  const rootIndex = commands.findIndex(({ status }) => ROOT_STATUSES.has(status));
  const suppressedCommandIds = request.commands.slice(rootIndex + 1).map(({ id }) => id);
  if (!allTrue([
    result.executionCompleted === false,
    result.rootCommandId === commands[rootIndex]?.id,
    result.rootStatus === payloadStatus,
    canonicalJsonSha256V2(commands) === result.commandsSha256,
    canonicalJsonV2(result.suppressedCommandIds) === canonicalJsonV2(suppressedCommandIds),
    result.completionEligible === false,
    result.approvalEligible === false,
    result.preflightUnlock === false
  ])) {
    fail("PROJECT_REPAIR_RESULT_INVALID", "repair attempt result does not bind its one non-completion root and suppressed suffix");
  }
}

function validateAuthorization(authorization) {
  requireExactKeys(authorization, ["completion", "approval", "audit", "deployment", "publication", "submission", "registryWrite", "externalWrites"], "repair authorization");
  if (Object.values(authorization).some((value) => value !== false)) {
    fail("PROJECT_REPAIR_AUTHORITY_CLAIM_FORBIDDEN", "repair attempts cannot authorize completion, approval, audit, deployment, publication, submission, Registry writes, or external writes");
  }
}

function assertAttemptHistory(attempts) {
  const sessionId = attempts.at(-1).payload.sessionId;
  const applicationId = attempts.at(-1).payload.request.applicationId;
  const revision = attempts.at(-1).payload.request.revision;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (attempt.payload.sessionId !== sessionId || attempt.payload.attemptNumber !== index + 1
      || attempt.payload.request.applicationId !== applicationId || attempt.payload.request.revision !== revision) {
      fail("PROJECT_REPAIR_HISTORY_INVALID", "repair attempt history must be one ordered application revision session");
    }
    const expectedPrevious = index === 0 ? null : attempts[index - 1].payloadSha256;
    if (attempt.payload.previousAttemptPayloadSha256 !== expectedPrevious) {
      fail("PROJECT_REPAIR_HISTORY_INVALID", "repair attempt history payload chain is broken");
    }
  }
}

function rootObservation(attempt) {
  return attempt.payload.commands.find(({ status }) => ROOT_STATUSES.has(status));
}

function classifyRoot(root) {
  if (root.status === "tooling-blocked") return "TOOLING_PREREQUISITE";
  if (root.timedOut) return "TIMEOUT";
  if (root.signal !== null) return "SIGNAL";
  if (root.outputExceeded) return "OUTPUT_LIMIT";
  if (root.status === "failed") return "COMMAND_FAILURE";
  return "UNKNOWN_OBSERVED_FAILURE";
}

function nextAction({ status, root, diagnosis, blindRetryAllowed }) {
  if (status === "PROJECT_REPAIR_BUDGET_EXHAUSTED") {
    return { action: "STOP_REPAIR_BUDGET_EXHAUSTED", targetedCommandIds: [], sourceChangeAllowed: false, fullGateRequiredAfterRootPasses: true };
  }
  if (diagnosis === "TOOLING_PREREQUISITE") {
    return { action: "RESTORE_TOOLING_PREREQUISITE", targetedCommandIds: [root.id], sourceChangeAllowed: false, fullGateRequiredAfterRootPasses: true };
  }
  if (blindRetryAllowed) {
    return { action: "RERUN_ROOT_ONCE_UNCHANGED", targetedCommandIds: [root.id], sourceChangeAllowed: false, fullGateRequiredAfterRootPasses: true };
  }
  return { action: "INSPECT_ROOT_AND_APPLY_MINIMUM_REPAIR", targetedCommandIds: [root.id], sourceChangeAllowed: true, fullGateRequiredAfterRootPasses: true };
}

function decodeCanonicalBase64(value) {
  if (typeof value !== "string" || value.length < 80 || value.length > 128) {
    fail("PROJECT_REPAIR_SIGNATURE_INVALID", "repair attempt signature is not bounded base64");
  }
  let bytes;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    fail("PROJECT_REPAIR_SIGNATURE_INVALID", "repair attempt signature is not base64");
  }
  if (bytes.toString("base64") !== value) fail("PROJECT_REPAIR_SIGNATURE_INVALID", "repair attempt signature is not canonical base64");
  return bytes;
}

function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("PROJECT_REPAIR_ATTEMPT_INVALID", `${label} must be an object`);
  }
}

function requireExactKeys(value, expected, label, code = "PROJECT_REPAIR_ATTEMPT_INVALID") {
  requirePlainObject(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(code, `${label} keys drift`);
  }
}

function repositoryPath(value) {
  return boundedString(value, 1, 500) && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0")
    && !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function boundedString(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !value.includes("\0");
}

function slug(value) {
  return boundedString(value, 1, 120) && SLUG.test(value);
}

function boundedByteLength(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAXIMUM_STREAM_BYTES;
}

function allTrue(checks) {
  return checks.every(Boolean);
}

function fail(code, message, details = {}) {
  throw new ProjectRepairAttemptError(code, message, details);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
