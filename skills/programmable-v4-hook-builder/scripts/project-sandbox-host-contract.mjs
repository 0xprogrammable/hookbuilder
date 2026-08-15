import crypto from "node:crypto";
import path from "node:path";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import { sha256Bytes } from "./project-command-executor-core.mjs";

export const PROJECT_SANDBOX_HOST_PROFILE_KIND = "programmable-project-sandbox-host-profile";
export const PROJECT_SANDBOX_HOST_ATTESTATION_KIND = "programmable-project-sandbox-host-attestation";
export const PROJECT_SANDBOX_TRUST_ROOT_KIND = "programmable-project-sandbox-trust-root";
export const PROJECT_SANDBOX_HOST_CONTRACT_VERSION = "1.0.0";
export const PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS = Object.freeze([
  "OWNER_PINNED_TRUST_ROOT_REQUIRED",
  "OWNER_CONTROLLED_COMPLETION_IMPORT_REQUIRED",
  "ACTUAL_HOST_RUN_PROVENANCE_REQUIRED",
  "NATIVE_LINUX_UID_GID_MOUNT_ACCESS_REQUIRED",
  "HOST_DEADLINE_KILL_AND_REAP_REQUIRED",
  "KERNEL_OUTPUT_BYTES_INODES_ENTRIES_DEPTH_QUOTA_REQUIRED",
  "BOUNDED_STDOUT_STDERR_LOGS_REQUIRED",
  "MEMORY_SWAP_PID_CPU_ENFORCEMENT_REQUIRED",
  "DOCKER_CLIENT_DAEMON_PLATFORM_RESOLVED_IMAGE_IDENTITY_REQUIRED",
  "PINNED_SECCOMP_AND_USER_NAMESPACE_REQUIRED",
  "CLEAN_CANDIDATE_ENVIRONMENT_REQUIRED",
  "DESCRIPTOR_SAFE_NOFOLLOW_OUTPUT_VERIFICATION_REQUIRED",
  "RECEIPT_OBSERVATIONS_CROSS_BINDING_REQUIRED"
]);
export const PROJECT_SANDBOX_CONTAINER_ENVIRONMENT = Object.freeze({
  CI: "1",
  HOME: "/tmp",
  NO_COLOR: "1",
  TZ: "UTC"
});

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const KEY_ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const SUBJECT = /^urn:programmable:sandbox:[a-z0-9]+(?:[.:_-][a-z0-9]+)*$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const IMAGE = /^(?!.*\s)[^@]+@sha256:[0-9a-f]{64}$/u;
const containerPaths = Object.freeze({
  source: "/input/source.tar",
  request: "/request/request.v1.json",
  plan: "/request/repository-plan.v1.json",
  output: "/output",
  workspace: "/workspace",
  temporary: "/tmp"
});
const shellNames = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);
const MAX_LAUNCHER_ENTRYPOINT_ITEMS = 32;

export class ProjectSandboxHostError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectSandboxHostError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function validateProjectSandboxHostProfileV1(profile) {
  return capture(() => assertProjectSandboxHostProfileV1(profile));
}

export function validateProjectSandboxTrustRootV1(trustRoot) {
  return capture(() => assertProjectSandboxTrustRootV1(trustRoot));
}

export function validateProjectSandboxHostAttestationV1(attestation) {
  return capture(() => assertProjectSandboxHostAttestationV1(attestation));
}

export function sandboxHostProfileSha256V1(profile) {
  assertProjectSandboxHostProfileV1(profile);
  return canonicalJsonSha256V2(profile);
}

export function sandboxHostPolicyDigestsV1(profile) {
  assertProjectSandboxHostProfileV1(profile);
  return Object.freeze({
    allowedPathsSha256: canonicalJsonSha256V2([
      profile.policy.filesystem.outputMount,
      profile.policy.filesystem.temporaryMount,
      profile.policy.filesystem.workspaceMount
    ].sort(compareUtf8)),
    deniedPathsSha256: canonicalJsonSha256V2([
      profile.policy.filesystem.planMount,
      profile.policy.filesystem.requestMount,
      profile.policy.filesystem.sourceMount
    ].sort(compareUtf8)),
    environmentKeysSha256: canonicalJsonSha256V2(Object.keys(PROJECT_SANDBOX_CONTAINER_ENVIRONMENT).sort(compareUtf8)),
    mountSetSha256: canonicalJsonSha256V2([
      { destination: profile.policy.filesystem.sourceMount, mode: "read-only", purpose: "source" },
      { destination: profile.policy.filesystem.requestMount, mode: "read-only", purpose: "request" },
      { destination: profile.policy.filesystem.planMount, mode: "read-only", purpose: "plan" },
      { destination: profile.policy.filesystem.outputMount, mode: "read-write", purpose: "bounded-output" },
      { destination: profile.policy.filesystem.workspaceMount, mode: "tmpfs", purpose: "disposable-workspace" },
      { destination: profile.policy.filesystem.temporaryMount, mode: "tmpfs", purpose: "temporary" }
    ])
  });
}

export function assertProjectSandboxHostProfileV1(profile) {
  exactKeys(profile, ["schemaVersion", "kind", "profileId", "authoritySubject", "adapter", "launcher", "runtime", "policy", "limits"], "host profile");
  if (profile.schemaVersion !== PROJECT_SANDBOX_HOST_CONTRACT_VERSION || profile.kind !== PROJECT_SANDBOX_HOST_PROFILE_KIND
    || !SLUG.test(profile.profileId ?? "") || !SUBJECT.test(profile.authoritySubject ?? "")) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "host profile identity is invalid");
  }
  exactKeys(profile.adapter, ["kind", "binarySha256"], "host profile adapter");
  if (profile.adapter.kind !== "docker-cli" || !SHA256.test(profile.adapter.binarySha256 ?? "")) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "host profile requires one exact Docker CLI binary");
  }
  exactKeys(profile.launcher, ["id", "version", "binarySha256", "entrypoint"], "host profile launcher");
  if (!SLUG.test(profile.launcher.id ?? "") || !bounded(profile.launcher.version, 1, 120)
    || !SHA256.test(profile.launcher.binarySha256 ?? "") || !argv(profile.launcher.entrypoint)
    || profile.launcher.entrypoint.length > MAX_LAUNCHER_ENTRYPOINT_ITEMS
    || shellNames.has(path.posix.basename(profile.launcher.entrypoint[0]).toLowerCase())) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "host launcher identity or shell-free entrypoint is invalid");
  }
  exactKeys(profile.runtime, ["id", "version", "imageReference", "imageSha256", "isolation", "user"], "host profile runtime");
  exactKeys(profile.runtime.user, ["uid", "gid"], "host profile runtime user");
  const imageDigest = IMAGE.test(profile.runtime.imageReference ?? "")
    ? `sha256:${profile.runtime.imageReference.split("@sha256:")[1]}`
    : null;
  if (!SLUG.test(profile.runtime.id ?? "") || !bounded(profile.runtime.version, 1, 120)
    || imageDigest === null || imageDigest !== profile.runtime.imageSha256
    || profile.runtime.isolation !== "container-separate-user"
    || !positiveInteger(profile.runtime.user.uid) || !positiveInteger(profile.runtime.user.gid)) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "runtime must pin a digest image and a non-root container user");
  }
  exactKeys(profile.policy, ["filesystem", "network", "secrets", "externalWrites", "process"], "host profile policy");
  exactKeys(profile.policy.filesystem, ["sourceMount", "requestMount", "planMount", "outputMount", "workspaceMount", "temporaryMount"], "host filesystem policy");
  if (canonicalJsonV2(profile.policy.filesystem) !== canonicalJsonV2({
    sourceMount: containerPaths.source,
    requestMount: containerPaths.request,
    planMount: containerPaths.plan,
    outputMount: containerPaths.output,
    workspaceMount: containerPaths.workspace,
    temporaryMount: containerPaths.temporary
  })) fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "host filesystem mounts must use the fixed isolated layout");
  exactKeys(profile.policy.network, ["mode", "allowlist"], "host network policy");
  if (profile.policy.network.mode !== "forbidden" || !Array.isArray(profile.policy.network.allowlist) || profile.policy.network.allowlist.length !== 0) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "local Docker network must be forbidden with an empty allowlist");
  }
  exactKeys(profile.policy.secrets, ["inherit", "mounts"], "host secret policy");
  if (profile.policy.secrets.inherit !== false || !Array.isArray(profile.policy.secrets.mounts) || profile.policy.secrets.mounts.length !== 0) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "container secrets must not be inherited or mounted");
  }
  exactKeys(profile.policy.externalWrites, ["allowed"], "host external-write policy");
  if (profile.policy.externalWrites.allowed !== false) fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "external writes must be forbidden");
  exactKeys(profile.policy.process, ["init", "pidsLimit"], "host process policy");
  if (profile.policy.process.init !== true || !integerBetween(profile.policy.process.pidsLimit, 16, 4096)) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "container init and a bounded PID limit are required");
  }
  exactKeys(profile.limits, ["memoryBytes", "cpus", "workspaceBytes", "temporaryBytes", "maximumOutputBytes"], "host limits");
  if (!integerBetween(profile.limits.memoryBytes, 256 * 1024 * 1024, 64 * 1024 * 1024 * 1024)
    || typeof profile.limits.cpus !== "number" || !Number.isFinite(profile.limits.cpus) || profile.limits.cpus < 0.25 || profile.limits.cpus > 64
    || !integerBetween(profile.limits.workspaceBytes, 64 * 1024 * 1024, 64 * 1024 * 1024 * 1024)
    || !integerBetween(profile.limits.temporaryBytes, 16 * 1024 * 1024, 16 * 1024 * 1024 * 1024)
    || !integerBetween(profile.limits.maximumOutputBytes, 1024, 512 * 1024 * 1024)) {
    fail("PROJECT_SANDBOX_HOST_PROFILE_INVALID", "host resource limits are invalid");
  }
}

export function assertProjectSandboxTrustRootV1(trustRoot) {
  exactKeys(trustRoot, ["schemaVersion", "kind", "rootId", "authorities"], "sandbox trust root");
  if (trustRoot.schemaVersion !== PROJECT_SANDBOX_HOST_CONTRACT_VERSION || trustRoot.kind !== PROJECT_SANDBOX_TRUST_ROOT_KIND
    || !SLUG.test(trustRoot.rootId ?? "") || !Array.isArray(trustRoot.authorities) || trustRoot.authorities.length > 32) {
    fail("PROJECT_SANDBOX_TRUST_ROOT_INVALID", "sandbox trust root identity or authority list is invalid");
  }
  const identities = new Set();
  for (const authority of trustRoot.authorities) {
    exactKeys(authority, ["subject", "keyId", "status", "algorithm", "publicKeySpkiBase64", "publicKeySha256", "profileSha256", "launcher", "runtime"], "sandbox authority");
    exactKeys(authority.launcher, ["id", "binarySha256"], "sandbox authority launcher");
    exactKeys(authority.runtime, ["id", "imageSha256", "isolation"], "sandbox authority runtime");
    if (!SUBJECT.test(authority.subject ?? "") || !KEY_ID.test(authority.keyId ?? "")
      || !["active", "revoked"].includes(authority.status) || authority.algorithm !== "ed25519"
      || !bounded(authority.publicKeySpkiBase64, 32, 4096) || !SHA256.test(authority.publicKeySha256 ?? "")
      || !SHA256.test(authority.profileSha256 ?? "") || !SLUG.test(authority.launcher.id ?? "")
      || !SHA256.test(authority.launcher.binarySha256 ?? "") || !SLUG.test(authority.runtime.id ?? "")
      || !SHA256.test(authority.runtime.imageSha256 ?? "") || authority.runtime.isolation !== "container-separate-user") {
      fail("PROJECT_SANDBOX_TRUST_ROOT_INVALID", "sandbox authority fields are invalid");
    }
    const identity = `${authority.subject}\0${authority.keyId}`;
    if (identities.has(identity)) fail("PROJECT_SANDBOX_TRUST_ROOT_INVALID", "sandbox authority subject and keyId are duplicated");
    identities.add(identity);
    projectSandboxAuthorityPublicKeyV1(authority);
  }
}

export function assertProjectSandboxHostAttestationV1(attestation) {
  exactKeys(attestation, ["schemaVersion", "kind", "payload", "payloadSha256", "signature"], "host attestation");
  if (attestation.schemaVersion !== PROJECT_SANDBOX_HOST_CONTRACT_VERSION || attestation.kind !== PROJECT_SANDBOX_HOST_ATTESTATION_KIND) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host attestation identity is invalid");
  }
  assertAttestationPayload(attestation.payload);
  if (attestation.payloadSha256 !== canonicalJsonSha256V2(attestation.payload)) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_MISMATCH", "host attestation payload digest differs");
  }
  exactKeys(attestation.signature, ["algorithm", "keyId", "value"], "host attestation signature");
  if (attestation.signature.algorithm !== "ed25519" || !KEY_ID.test(attestation.signature.keyId ?? "")
    || !canonicalBase64(attestation.signature.value, 64)) {
    fail("PROJECT_SANDBOX_HOST_SIGNATURE_INVALID", "host attestation signature metadata is invalid");
  }
}

export function assertProjectSandboxExpectedRequestV1(request) {
  if (!plainObject(request) || request.schemaVersion !== "1.0.0"
    || request.kind !== "programmable-project-external-sandbox-request"
    || !SHA256.test(request.requestSha256 ?? "") || !Array.isArray(request.commands) || request.commands.length === 0) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "expected sandbox request is invalid");
  }
  const { requestSha256, ...payload } = request;
  if (canonicalJsonSha256V2(payload) !== requestSha256) fail("PROJECT_SANDBOX_REQUEST_MISMATCH", "expected request digest differs");
}

export function projectSandboxAuthorityPublicKeyV1(authority) {
  let der;
  try {
    der = Buffer.from(authority.publicKeySpkiBase64, "base64");
  } catch {
    fail("PROJECT_SANDBOX_AUTHORITY_INVALID", "sandbox authority public key is not base64");
  }
  if (der.toString("base64") !== authority.publicKeySpkiBase64 || sha256Bytes(der) !== authority.publicKeySha256) {
    fail("PROJECT_SANDBOX_AUTHORITY_INVALID", "sandbox authority public-key encoding or digest differs");
  }
  let key;
  try {
    key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    fail("PROJECT_SANDBOX_AUTHORITY_INVALID", "sandbox authority public key is invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") fail("PROJECT_SANDBOX_AUTHORITY_INVALID", "sandbox authority public key must be Ed25519");
  return key;
}

export function verifyProjectSandboxSignatureV1(payload, signature, publicKey, code) {
  if (!canonicalBase64(signature.value, 64)
    || !crypto.verify(null, Buffer.from(canonicalJsonV2(payload), "utf8"), publicKey, Buffer.from(signature.value, "base64"))) {
    fail(code, "sandbox signature verification failed");
  }
}

export function isProjectSandboxAuthoritySubject(value) {
  return SUBJECT.test(value ?? "");
}

export function isProjectSandboxSha256(value) {
  return SHA256.test(value ?? "");
}

function assertAttestationPayload(payload) {
  exactKeys(payload, ["status", "authoritySubject", "requestSha256", "receiptSha256", "hostProfileSha256", "invocation", "enforcement", "outputArtifactsSha256", "evidenceBoundary"], "host attestation payload");
  if (payload.status !== "claimed-completed" || !SUBJECT.test(payload.authoritySubject ?? "")
    || ![payload.requestSha256, payload.receiptSha256, payload.hostProfileSha256, payload.outputArtifactsSha256].every((value) => SHA256.test(value ?? ""))) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host attestation payload identity is invalid");
  }
  exactKeys(payload.invocation, ["adapter", "dockerBinarySha256", "argvSha256", "invocationSha256", "imageSha256", "sourceArchiveSha256", "planSha256", "environmentKeysSha256", "mountSetSha256"], "host invocation evidence");
  if (payload.invocation.adapter !== "docker-cli"
    || !Object.entries(payload.invocation).filter(([key]) => key !== "adapter").every(([, value]) => SHA256.test(value ?? ""))) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host invocation digests are invalid");
  }
  exactKeys(payload.enforcement, ["filesystem", "network", "secrets", "externalWrites", "process"], "host enforcement claims");
  exactKeys(payload.enforcement.filesystem, ["sourceReadOnly", "disposableWorkspace", "allowedPathsSha256", "deniedPathsSha256", "writesObservedSha256"], "host filesystem claims");
  exactKeys(payload.enforcement.network, ["mode", "allowlistSha256", "accessObserved"], "host network claims");
  exactKeys(payload.enforcement.secrets, ["inherited", "mounted", "environmentKeysSha256"], "host secret claims");
  exactKeys(payload.enforcement.externalWrites, ["allowed", "performed"], "host external-write claims");
  exactKeys(payload.enforcement.process, ["init", "pidsLimit", "containerIdSha256", "runnerExitCode", "containerExitCode", "containerRemoved", "postRemovalState", "descendantsRemaining", "teardownObservationSha256"], "host process claims");
  if (payload.enforcement.filesystem.sourceReadOnly !== true || payload.enforcement.filesystem.disposableWorkspace !== true
    || ![payload.enforcement.filesystem.allowedPathsSha256, payload.enforcement.filesystem.deniedPathsSha256, payload.enforcement.filesystem.writesObservedSha256].every((value) => SHA256.test(value ?? ""))
    || payload.enforcement.network.mode !== "forbidden" || payload.enforcement.network.allowlistSha256 !== null || payload.enforcement.network.accessObserved !== false
    || payload.enforcement.secrets.inherited !== false || payload.enforcement.secrets.mounted !== false || !SHA256.test(payload.enforcement.secrets.environmentKeysSha256 ?? "")
    || payload.enforcement.externalWrites.allowed !== false || payload.enforcement.externalWrites.performed !== false
    || payload.enforcement.process.init !== true || !integerBetween(payload.enforcement.process.pidsLimit, 16, 4096)
    || !SHA256.test(payload.enforcement.process.containerIdSha256 ?? "")
    || payload.enforcement.process.runnerExitCode !== 0 || payload.enforcement.process.containerExitCode !== 0
    || payload.enforcement.process.containerRemoved !== true || payload.enforcement.process.postRemovalState !== "absent"
    || payload.enforcement.process.descendantsRemaining !== 0 || !SHA256.test(payload.enforcement.process.teardownObservationSha256 ?? "")) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host enforcement claims are incomplete or report noncompliance");
  }
  exactKeys(payload.evidenceBoundary, ["approvalCreated", "auditClaimed", "deploymentClaimed", "productionClaimed", "externalActionsPerformed"], "host evidence boundary");
  if (payload.evidenceBoundary.approvalCreated !== false || payload.evidenceBoundary.auditClaimed !== false
    || payload.evidenceBoundary.deploymentClaimed !== false || payload.evidenceBoundary.productionClaimed !== false
    || !Array.isArray(payload.evidenceBoundary.externalActionsPerformed) || payload.evidenceBoundary.externalActionsPerformed.length !== 0) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host attestation cannot carry approval, audit, deployment, production, or external-action authority");
  }
}

function exactKeys(value, keys, label) {
  if (!plainObject(value)) fail("PROJECT_SANDBOX_HOST_CONTRACT_INVALID", `${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("PROJECT_SANDBOX_HOST_CONTRACT_INVALID", `${label} keys drift`);
  }
}

function argv(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 128
    && value.every((entry) => bounded(entry, 1, 1000));
}

function bounded(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !value.includes("\0");
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647;
}

function integerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalBase64(value, byteLength) {
  if (typeof value !== "string") return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === byteLength && bytes.toString("base64") === value;
}

function capture(callback) {
  try {
    callback();
    return [];
  } catch (error) {
    return [{
      severity: "blocker",
      code: typeof error?.code === "string" ? error.code : "PROJECT_SANDBOX_HOST_CONTRACT_INVALID",
      path: "$",
      message: error instanceof Error ? error.message : String(error)
    }];
  }
}

function fail(code, message, details = {}) {
  throw new ProjectSandboxHostError(code, message, details);
}
