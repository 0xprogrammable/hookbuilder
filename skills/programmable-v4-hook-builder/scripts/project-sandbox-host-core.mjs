import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import {
  inspectCleanProjectSource,
  projectCommandExecutionPlanSha256,
  sha256Bytes
} from "./project-command-executor-core.mjs";
import { validateProjectSandboxReceiptV1 } from "./project-sandbox-receipt-core.mjs";
import { spawnSafeGitSync } from "./repository-root.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const PROJECT_SANDBOX_HOST_PROFILE_KIND = "programmable-project-sandbox-host-profile";
export const PROJECT_SANDBOX_HOST_ATTESTATION_KIND = "programmable-project-sandbox-host-attestation";
export const PROJECT_SANDBOX_TRUST_ROOT_KIND = "programmable-project-sandbox-trust-root";
export const PROJECT_SANDBOX_HOST_CONTRACT_VERSION = "1.0.0";

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
const explicitContainerEnvironment = Object.freeze({ CI: "1", HOME: "/tmp", NO_COLOR: "1", TZ: "UTC" });
const shellNames = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);

export class ProjectSandboxHostError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProjectSandboxHostError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function validateProjectSandboxHostProfileV1(profile) {
  return capture(() => assertHostProfile(profile));
}

export function validateProjectSandboxTrustRootV1(trustRoot) {
  return capture(() => assertTrustRoot(trustRoot));
}

export function validateProjectSandboxHostAttestationV1(attestation) {
  return capture(() => assertHostAttestation(attestation));
}

export function sandboxHostProfileSha256V1(profile) {
  assertHostProfile(profile);
  return canonicalJsonSha256V2(profile);
}

export function sandboxHostPolicyDigestsV1(profile) {
  assertHostProfile(profile);
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
    environmentKeysSha256: canonicalJsonSha256V2(Object.keys(explicitContainerEnvironment).sort(compareUtf8)),
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

export function createProjectSandboxSourceArchiveV1({ repositoryRoot, expectedRequest, outputPath }) {
  assertExpectedRequest(expectedRequest);
  const root = exactDirectory(repositoryRoot, "repositoryRoot", { mustBeEmpty: false });
  const source = inspectCleanProjectSource(root);
  if (canonicalJsonV2(source) !== canonicalJsonV2(expectedRequest.source)) {
    fail("PROJECT_SANDBOX_SOURCE_DRIFT", "repository source identity differs from the sandbox request");
  }
  if (typeof outputPath !== "string" || outputPath.length === 0 || outputPath.includes("\0")) {
    fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_PATH_INVALID", "source archive output path is invalid");
  }
  const requestedAbsolute = path.resolve(outputPath);
  const parent = exactDirectory(path.dirname(requestedAbsolute), "sourceArchiveParent", { mustBeEmpty: false });
  const absolute = path.join(parent, path.basename(requestedAbsolute));
  if (isInside(root, absolute)) fail("PROJECT_SANDBOX_HOST_PATH_OVERLAP", "source archive must be outside the source repository");
  if (fs.existsSync(absolute)) fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_EXISTS", "source archive output already exists");
  const bytes = gitArchiveBytes(root, source.headCommit);
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, absolute);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return deepFreeze({
    status: "PROJECT_SANDBOX_SOURCE_ARCHIVE_READY",
    source,
    requestSha256: expectedRequest.requestSha256,
    path: absolute,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length,
    networkAccessed: false,
    candidateCodeExecuted: false,
    externalActionsPerformed: []
  });
}

export function createDockerSandboxInvocationV1({
  profile,
  expectedRequest,
  repositoryRoot,
  sourceArchivePath,
  requestPath,
  outputRoot,
  planPath,
  dockerExecutable
}) {
  assertHostProfile(profile);
  assertExpectedRequest(expectedRequest);
  if (profile.adapter.kind !== "docker-cli" || profile.runtime.isolation !== "container-separate-user") {
    fail("PROJECT_SANDBOX_HOST_PROFILE_UNSUPPORTED", "only the container-separate-user Docker host profile is supported");
  }
  if (expectedRequest.commands.some(({ networkAccess }) => networkAccess !== "forbidden")) {
    fail(
      "PROJECT_SANDBOX_NETWORK_PROFILE_UNSUPPORTED",
      "the local Docker profile supports only network-forbidden commands; read-only network needs a separately enforced allowlist runtime"
    );
  }
  const sourceRoot = exactDirectory(repositoryRoot, "repositoryRoot", { mustBeEmpty: false });
  const source = inspectCleanProjectSource(sourceRoot);
  if (canonicalJsonV2(source) !== canonicalJsonV2(expectedRequest.source)) {
    fail("PROJECT_SANDBOX_SOURCE_DRIFT", "repository source identity differs from the sandbox request");
  }
  const sourceArchive = exactRegularFile(sourceArchivePath, "sourceArchivePath", 512 * 1024 * 1024);
  const sidecar = exactRegularFile(requestPath, "requestPath", 8 * 1024 * 1024);
  const planSidecar = exactRegularFile(planPath, "planPath", 64 * 1024 * 1024);
  const outputDirectory = exactDirectory(outputRoot, "outputRoot", { mustBeEmpty: true });
  const tool = exactRegularFile(dockerExecutable, "dockerExecutable", 512 * 1024 * 1024);
  if (tool.sha256 !== profile.adapter.binarySha256) {
    fail("PROJECT_SANDBOX_DOCKER_TOOL_DRIFT", "Docker executable bytes differ from the host profile", {
      expected: profile.adapter.binarySha256,
      observed: tool.sha256
    });
  }
  const expectedArchive = gitArchiveBytes(sourceRoot, source.headCommit);
  if (sourceArchive.byteLength !== expectedArchive.length || sourceArchive.sha256 !== sha256Bytes(expectedArchive)) {
    fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_DRIFT", "source archive differs from the exact requested Git commit");
  }
  for (const hostPath of [sourceArchive.path, sidecar.path, planSidecar.path, outputDirectory]) {
    if (hostPath.includes(",")) fail("PROJECT_SANDBOX_HOST_PATH_UNSUPPORTED", "Docker bind paths containing commas are unsupported");
  }
  if ([sourceArchive.path, sidecar.path, planSidecar.path, outputDirectory].some((hostPath) => isInside(sourceRoot, hostPath))) {
    fail("PROJECT_SANDBOX_HOST_PATH_OVERLAP", "source archive, request, plan, and output sidecars must remain outside the source repository");
  }
  if (isInside(sourceRoot, tool.path) || isInside(outputDirectory, tool.path)) {
    fail("PROJECT_SANDBOX_HOST_TOOL_UNTRUSTED", "Docker executable must remain outside candidate source and output roots");
  }
  const observedRequest = readStrictJson(sidecar.path, 8 * 1024 * 1024, "sandbox request");
  if (canonicalJsonV2(observedRequest) !== canonicalJsonV2(expectedRequest)) {
    fail("PROJECT_SANDBOX_REQUEST_DRIFT", "request sidecar bytes do not bind the expected sandbox request");
  }
  const repositoryPlan = readStrictJson(planSidecar.path, 64 * 1024 * 1024, "repository plan");
  if (projectCommandExecutionPlanSha256(repositoryPlan) !== expectedRequest.executionPlanSha256) {
    fail("PROJECT_SANDBOX_PLAN_DRIFT", "repository plan differs from the requested execution plan");
  }
  if (canonicalJsonSha256V2(repositoryPlan.commands) !== expectedRequest.commandsSha256) {
    fail("PROJECT_SANDBOX_COMMAND_DRIFT", "repository plan commands differ from the sandbox request");
  }
  const requestContainerPath = profile.policy.filesystem.requestMount;
  const containerName = expectedContainerName(expectedRequest.requestSha256);
  const argv = [
    "run", "--rm", "--name", containerName,
    "--pull", "never",
    "--init",
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", String(profile.policy.process.pidsLimit),
    "--memory", String(profile.limits.memoryBytes),
    "--cpus", canonicalCpuString(profile.limits.cpus),
    "--user", `${profile.runtime.user.uid}:${profile.runtime.user.gid}`,
    ...Object.entries(explicitContainerEnvironment).sort(([left], [right]) => compareUtf8(left, right))
      .flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    "--mount", dockerBind(sourceArchive.path, profile.policy.filesystem.sourceMount, true),
    "--mount", dockerBind(sidecar.path, requestContainerPath, true),
    "--mount", dockerBind(planSidecar.path, profile.policy.filesystem.planMount, true),
    "--mount", dockerBind(outputDirectory, profile.policy.filesystem.outputMount, false),
    "--tmpfs", `${profile.policy.filesystem.workspaceMount}:rw,nosuid,nodev,size=${profile.limits.workspaceBytes}`,
    "--tmpfs", `${profile.policy.filesystem.temporaryMount}:rw,noexec,nosuid,nodev,size=${profile.limits.temporaryBytes}`,
    "--workdir", profile.policy.filesystem.workspaceMount,
    "--entrypoint", profile.launcher.entrypoint[0],
    profile.runtime.imageReference,
    ...profile.launcher.entrypoint.slice(1),
    "--request", requestContainerPath,
    "--source-archive", profile.policy.filesystem.sourceMount,
    "--workspace", profile.policy.filesystem.workspaceMount,
    "--output", profile.policy.filesystem.outputMount,
    "--plan", profile.policy.filesystem.planMount,
    "--maximum-output-bytes", String(profile.limits.maximumOutputBytes)
  ];
  const policyDigests = sandboxHostPolicyDigestsV1(profile);
  const result = {
    schemaVersion: PROJECT_SANDBOX_HOST_CONTRACT_VERSION,
    kind: "programmable-project-sandbox-docker-invocation",
    status: "PLAN_ONLY_NOT_EXECUTED",
    profileSha256: sandboxHostProfileSha256V1(profile),
    requestSha256: expectedRequest.requestSha256,
    adapter: {
      kind: profile.adapter.kind,
      executablePath: tool.path,
      executableSha256: tool.sha256
    },
    containerName,
    imageReference: profile.runtime.imageReference,
    imageSha256: profile.runtime.imageSha256,
    sourceArchiveSha256: sourceArchive.sha256,
    sourceArchiveByteLength: sourceArchive.byteLength,
    planSha256: planSidecar.sha256,
    argv,
    argvSha256: canonicalJsonSha256V2(argv),
    environmentKeysSha256: policyDigests.environmentKeysSha256,
    mountSetSha256: policyDigests.mountSetSha256,
    evidenceBoundary: {
      candidateCodeExecuted: false,
      isolationObserved: false,
      receiptCreated: false,
      externalActionsPerformed: []
    }
  };
  return deepFreeze({ ...result, invocationSha256: canonicalJsonSha256V2(result) });
}

export function projectSandboxHostAttestationPayloadV1({
  authoritySubject,
  receipt,
  profile,
  invocation,
  writesObservedSha256,
  containerIdSha256,
  teardownObservationSha256
}) {
  assertHostProfile(profile);
  assertInvocation(invocation, profile);
  const receiptFindings = validateProjectSandboxReceiptV1(receipt);
  if (receiptFindings.length > 0) fail(receiptFindings[0].code, receiptFindings[0].message);
  if (authoritySubject !== profile.authoritySubject) fail("PROJECT_SANDBOX_AUTHORITY_SUBJECT_MISMATCH", "host profile authority subject differs");
  for (const digest of [writesObservedSha256, containerIdSha256, teardownObservationSha256]) {
    if (!SHA256.test(digest ?? "")) fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host observation digests are required");
  }
  const digests = sandboxHostPolicyDigestsV1(profile);
  return deepFreeze({
    status: "completed",
    authoritySubject,
    requestSha256: receipt.payload.request.requestSha256,
    receiptSha256: canonicalJsonSha256V2(receipt),
    hostProfileSha256: sandboxHostProfileSha256V1(profile),
    invocation: {
      adapter: "docker-cli",
      dockerBinarySha256: profile.adapter.binarySha256,
      argvSha256: invocation.argvSha256,
      invocationSha256: invocation.invocationSha256,
      imageSha256: profile.runtime.imageSha256,
      sourceArchiveSha256: invocation.sourceArchiveSha256,
      planSha256: invocation.planSha256,
      environmentKeysSha256: digests.environmentKeysSha256,
      mountSetSha256: digests.mountSetSha256
    },
    enforcement: {
      filesystem: {
        sourceReadOnly: true,
        disposableWorkspace: true,
        allowedPathsSha256: digests.allowedPathsSha256,
        deniedPathsSha256: digests.deniedPathsSha256,
        writesObservedSha256
      },
      network: { mode: "forbidden", allowlistSha256: null, accessObserved: false },
      secrets: { inherited: false, mounted: false, environmentKeysSha256: digests.environmentKeysSha256 },
      externalWrites: { allowed: false, performed: false },
      process: {
        init: true,
        pidsLimit: profile.policy.process.pidsLimit,
        containerIdSha256,
        runnerExitCode: 0,
        containerExitCode: 0,
        containerRemoved: true,
        postRemovalState: "absent",
        descendantsRemaining: 0,
        teardownObservationSha256
      }
    },
    outputArtifactsSha256: receipt.payload.result.outputArtifactsSha256,
    evidenceBoundary: {
      approvalCreated: false,
      auditClaimed: false,
      deploymentClaimed: false,
      productionClaimed: false,
      externalActionsPerformed: []
    }
  });
}

export function signProjectSandboxHostAttestationV1({ payload, keyId, privateKey }) {
  assertAttestationPayload(payload);
  if (!KEY_ID.test(keyId ?? "")) fail("PROJECT_SANDBOX_SIGNATURE_INVALID", "attestation keyId is invalid");
  let key;
  try {
    key = privateKey instanceof crypto.KeyObject ? privateKey : crypto.createPrivateKey(privateKey);
  } catch {
    fail("PROJECT_SANDBOX_SIGNING_KEY_INVALID", "host signing key is invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") fail("PROJECT_SANDBOX_SIGNING_KEY_INVALID", "host signing key must be Ed25519");
  const signature = crypto.sign(null, canonicalBytes(payload), key).toString("base64");
  const attestation = {
    schemaVersion: PROJECT_SANDBOX_HOST_CONTRACT_VERSION,
    kind: PROJECT_SANDBOX_HOST_ATTESTATION_KIND,
    payload,
    payloadSha256: canonicalJsonSha256V2(payload),
    signature: { algorithm: "ed25519", keyId, value: signature }
  };
  assertHostAttestation(attestation);
  return deepFreeze(attestation);
}

export function verifyProjectSandboxHostCompletionV1({
  receipt,
  expectedRequest,
  attestation,
  trustRoot,
  profile,
  expectedSubject,
  expectedInvocation,
  outputRoot
}) {
  assertExpectedRequest(expectedRequest);
  assertHostProfile(profile);
  assertTrustRoot(trustRoot);
  assertHostAttestation(attestation);
  assertInvocation(expectedInvocation, profile);
  assertInvocationOutputRoot(expectedInvocation, outputRoot);
  if (!SUBJECT.test(expectedSubject ?? "")) fail("PROJECT_SANDBOX_AUTHORITY_SUBJECT_INVALID", "expected authority subject is invalid");
  const receiptFindings = validateProjectSandboxReceiptV1(receipt);
  if (receiptFindings.length > 0) fail(receiptFindings[0].code, receiptFindings[0].message);
  if (canonicalJsonV2(receipt.payload.request) !== canonicalJsonV2(expectedRequest)) {
    fail("PROJECT_SANDBOX_SUBJECT_MISMATCH", "sandbox receipt does not bind the expected request bytes");
  }
  if (profile.authoritySubject !== expectedSubject || attestation.payload.authoritySubject !== expectedSubject) {
    fail("PROJECT_SANDBOX_AUTHORITY_SUBJECT_MISMATCH", "sandbox authority subject differs from the expected host subject");
  }
  const keyId = receipt.signature.keyId;
  if (attestation.signature.keyId !== keyId) {
    fail("PROJECT_SANDBOX_AUTHORITY_KEY_MISMATCH", "receipt and host attestation use different authority keys");
  }
  const authority = trustRoot.authorities.find((entry) => entry.keyId === keyId && entry.subject === expectedSubject);
  if (!authority || authority.status !== "active") {
    fail("PROJECT_SANDBOX_AUTHORITY_UNTRUSTED", "sandbox signer is not active in the independently supplied trust root");
  }
  if (authority.profileSha256 !== sandboxHostProfileSha256V1(profile)
    || authority.launcher.id !== receipt.payload.launcher.id
    || authority.launcher.binarySha256 !== receipt.payload.launcher.binarySha256
    || authority.runtime.id !== receipt.payload.runtime.id
    || authority.runtime.imageSha256 !== receipt.payload.runtime.imageSha256
    || authority.runtime.isolation !== receipt.payload.runtime.isolation) {
    fail("PROJECT_SANDBOX_AUTHORITY_SCOPE_MISMATCH", "receipt launcher, runtime, isolation, or host profile is outside authority scope");
  }
  const publicKey = authorityPublicKey(authority);
  verifySignature(receipt.payload, receipt.signature, publicKey, "PROJECT_SANDBOX_SIGNATURE_INVALID");
  verifySignature(attestation.payload, attestation.signature, publicKey, "PROJECT_SANDBOX_HOST_SIGNATURE_INVALID");
  const payload = attestation.payload;
  if (payload.requestSha256 !== expectedRequest.requestSha256
    || expectedInvocation.requestSha256 !== expectedRequest.requestSha256
    || payload.receiptSha256 !== canonicalJsonSha256V2(receipt)
    || payload.hostProfileSha256 !== sandboxHostProfileSha256V1(profile)
    || payload.invocation.argvSha256 !== expectedInvocation.argvSha256
    || payload.invocation.invocationSha256 !== expectedInvocation.invocationSha256
    || payload.outputArtifactsSha256 !== receipt.payload.result.outputArtifactsSha256) {
    fail("PROJECT_SANDBOX_HOST_BINDING_MISMATCH", "host attestation request, receipt, profile, invocation, or output binding drifted");
  }
  assertEnforcementMatches({ receipt, profile, payload, expectedInvocation });
  const output = verifyOutputArtifacts(
    outputRoot,
    receipt.payload.result.outputArtifacts,
    profile.limits.maximumOutputBytes
  );
  return deepFreeze({
    status: "PROJECT_SANDBOX_HOST_COMPLETION_VERIFIED",
    authority: { rootId: trustRoot.rootId, subject: authority.subject, keyId: authority.keyId },
    requestSha256: expectedRequest.requestSha256,
    receiptSha256: payload.receiptSha256,
    attestationSha256: canonicalJsonSha256V2(attestation),
    profileSha256: payload.hostProfileSha256,
    invocationSha256: payload.invocation.invocationSha256,
    executionCompleted: true,
    isolation: receipt.payload.runtime.isolation,
    networkAccessed: false,
    externalWritesPerformed: false,
    descendantsRemaining: 0,
    outputArtifactsSha256: output.inventorySha256,
    outputArtifactCount: output.count,
    evidenceBoundary: {
      approvalCreated: false,
      auditClaimed: false,
      deploymentClaimed: false,
      productionClaimed: false,
      externalActionsPerformed: []
    }
  });
}

function assertEnforcementMatches({ receipt, profile, payload, expectedInvocation }) {
  const expectedDigests = sandboxHostPolicyDigestsV1(profile);
  const filesystem = payload.enforcement.filesystem;
  const network = payload.enforcement.network;
  const secrets = payload.enforcement.secrets;
  const writes = payload.enforcement.externalWrites;
  const processEvidence = payload.enforcement.process;
  const receiptPolicy = receipt.payload.policy;
  if (payload.invocation.adapter !== "docker-cli"
    || payload.invocation.dockerBinarySha256 !== profile.adapter.binarySha256
    || payload.invocation.imageSha256 !== profile.runtime.imageSha256
    || payload.invocation.sourceArchiveSha256 !== expectedInvocation.sourceArchiveSha256
    || payload.invocation.planSha256 !== expectedInvocation.planSha256
    || payload.invocation.environmentKeysSha256 !== expectedDigests.environmentKeysSha256
    || payload.invocation.mountSetSha256 !== expectedDigests.mountSetSha256) {
    fail("PROJECT_SANDBOX_HOST_INVOCATION_MISMATCH", "host invocation identity differs from the trusted profile");
  }
  if (filesystem.sourceReadOnly !== true || filesystem.disposableWorkspace !== true
    || filesystem.allowedPathsSha256 !== expectedDigests.allowedPathsSha256
    || filesystem.deniedPathsSha256 !== expectedDigests.deniedPathsSha256
    || !SHA256.test(filesystem.writesObservedSha256 ?? "")
    || filesystem.allowedPathsSha256 !== receiptPolicy.filesystem.allowedPathsSha256
    || filesystem.deniedPathsSha256 !== receiptPolicy.filesystem.deniedPathsSha256) {
    fail("PROJECT_SANDBOX_FILESYSTEM_POLICY_VIOLATED", "filesystem enforcement differs from the trusted profile or receipt");
  }
  if (network.mode !== "forbidden" || network.allowlistSha256 !== null || network.accessObserved !== false
    || receiptPolicy.network.mode !== "forbidden"
    || receipt.payload.commands.some(({ networkAccessed }) => networkAccessed !== false)) {
    fail("PROJECT_SANDBOX_NETWORK_POLICY_VIOLATED", "network access was not both forbidden and unobserved");
  }
  if (secrets.inherited !== false || secrets.mounted !== false
    || secrets.environmentKeysSha256 !== expectedDigests.environmentKeysSha256
    || receiptPolicy.secrets.inherited !== false || receiptPolicy.secrets.mounted !== false) {
    fail("PROJECT_SANDBOX_SECRET_POLICY_VIOLATED", "host or receipt carried inherited or mounted secrets");
  }
  if (writes.allowed !== false || writes.performed !== false
    || receiptPolicy.externalWrites.allowed !== false
    || receipt.payload.commands.some(({ externalWritesPerformed }) => externalWritesPerformed !== false)) {
    fail("PROJECT_SANDBOX_EXTERNAL_WRITE_POLICY_VIOLATED", "external writes were not both forbidden and unobserved");
  }
  if (processEvidence.init !== true || processEvidence.pidsLimit !== profile.policy.process.pidsLimit
    || !SHA256.test(processEvidence.containerIdSha256 ?? "")
    || processEvidence.runnerExitCode !== 0 || processEvidence.containerExitCode !== 0
    || processEvidence.containerRemoved !== true || processEvidence.postRemovalState !== "absent"
    || processEvidence.descendantsRemaining !== 0 || !SHA256.test(processEvidence.teardownObservationSha256 ?? "")
    || receiptPolicy.process.descendantsReaped !== true) {
    fail("PROJECT_SANDBOX_PROCESS_TEARDOWN_UNPROVEN", "container exit, removal, or descendant teardown is not proven");
  }
}

function verifyOutputArtifacts(outputRoot, artifacts, maximumOutputBytes) {
  const root = exactDirectory(outputRoot, "outputRoot", { mustBeEmpty: false });
  const observed = inventoryOutputTree(root, maximumOutputBytes);
  const expectedPaths = artifacts.map(({ path: artifactPath }) => repositoryPath(artifactPath, "output artifact path"));
  const expectedDirectories = [...new Set(expectedPaths.flatMap(parentRepositoryPaths))].sort(compareUtf8);
  if (canonicalJsonV2(observed.files) !== canonicalJsonV2([...expectedPaths].sort(compareUtf8))
    || canonicalJsonV2(observed.directories) !== canonicalJsonV2(expectedDirectories)) {
    fail("PROJECT_SANDBOX_OUTPUT_DRIFT", "output directory contains missing, extra, or unreceipted paths");
  }
  if (new Set(artifacts.map(({ id }) => id)).size !== artifacts.length
    || new Set(expectedPaths).size !== expectedPaths.length) {
    fail("PROJECT_SANDBOX_OUTPUT_DRIFT", "signed output artifact identifiers and paths must be unique");
  }
  const inventory = [];
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const relativePath = expectedPaths[index];
    const absolute = resolveInside(root, relativePath, "output artifact path");
    assertNoSymlinkComponents(root, absolute, "output artifact path");
    const file = exactRegularFile(absolute, `output artifact ${artifact.id}`, maximumOutputBytes);
    if (file.sha256 !== artifact.sha256 || file.byteLength !== artifact.byteLength) {
      fail("PROJECT_SANDBOX_OUTPUT_DRIFT", `output artifact ${artifact.id} bytes differ from the signed receipt`);
    }
    inventory.push({ id: artifact.id, kind: artifact.kind, path: relativePath, sha256: file.sha256, byteLength: file.byteLength });
  }
  if (canonicalJsonSha256V2(inventory) !== canonicalJsonSha256V2(artifacts)) {
    fail("PROJECT_SANDBOX_OUTPUT_DRIFT", "verified output inventory order or identity differs from the signed receipt");
  }
  return { count: inventory.length, inventorySha256: canonicalJsonSha256V2(inventory) };
}

function inventoryOutputTree(root, maximumOutputBytes) {
  const files = [];
  const directories = [];
  let totalBytes = 0;
  const visit = (directory, prefix) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      repositoryPath(relativePath, "output path");
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) fail("PROJECT_SANDBOX_OUTPUT_DRIFT", `output path ${relativePath} is a symlink`);
      if (stat.isDirectory()) {
        directories.push(relativePath);
        visit(absolute, relativePath);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumOutputBytes) {
          fail("PROJECT_SANDBOX_OUTPUT_LIMIT_EXCEEDED", "output directory exceeds the trusted profile byte limit");
        }
        files.push(relativePath);
      } else {
        fail("PROJECT_SANDBOX_OUTPUT_DRIFT", `output path ${relativePath} is not a regular file or directory`);
      }
    }
  };
  visit(root, "");
  return { files: files.sort(compareUtf8), directories: directories.sort(compareUtf8), totalBytes };
}

function parentRepositoryPaths(relativePath) {
  const segments = relativePath.split("/");
  const parents = [];
  for (let index = 1; index < segments.length; index += 1) parents.push(segments.slice(0, index).join("/"));
  return parents;
}

function assertHostProfile(profile) {
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

function assertTrustRoot(trustRoot) {
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
    authorityPublicKey(authority);
  }
}

function assertHostAttestation(attestation) {
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

function assertAttestationPayload(payload) {
  exactKeys(payload, ["status", "authoritySubject", "requestSha256", "receiptSha256", "hostProfileSha256", "invocation", "enforcement", "outputArtifactsSha256", "evidenceBoundary"], "host attestation payload");
  if (payload.status !== "completed" || !SUBJECT.test(payload.authoritySubject ?? "")
    || ![payload.requestSha256, payload.receiptSha256, payload.hostProfileSha256, payload.outputArtifactsSha256].every((value) => SHA256.test(value ?? ""))) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host attestation payload identity is invalid");
  }
  exactKeys(payload.invocation, ["adapter", "dockerBinarySha256", "argvSha256", "invocationSha256", "imageSha256", "sourceArchiveSha256", "planSha256", "environmentKeysSha256", "mountSetSha256"], "host invocation evidence");
  if (payload.invocation.adapter !== "docker-cli"
    || !Object.entries(payload.invocation).filter(([key]) => key !== "adapter").every(([, value]) => SHA256.test(value ?? ""))) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host invocation digests are invalid");
  }
  exactKeys(payload.enforcement, ["filesystem", "network", "secrets", "externalWrites", "process"], "host enforcement evidence");
  exactKeys(payload.enforcement.filesystem, ["sourceReadOnly", "disposableWorkspace", "allowedPathsSha256", "deniedPathsSha256", "writesObservedSha256"], "host filesystem evidence");
  exactKeys(payload.enforcement.network, ["mode", "allowlistSha256", "accessObserved"], "host network evidence");
  exactKeys(payload.enforcement.secrets, ["inherited", "mounted", "environmentKeysSha256"], "host secret evidence");
  exactKeys(payload.enforcement.externalWrites, ["allowed", "performed"], "host external-write evidence");
  exactKeys(payload.enforcement.process, ["init", "pidsLimit", "containerIdSha256", "runnerExitCode", "containerExitCode", "containerRemoved", "postRemovalState", "descendantsRemaining", "teardownObservationSha256"], "host process evidence");
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
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host enforcement evidence is incomplete or records a policy violation");
  }
  exactKeys(payload.evidenceBoundary, ["approvalCreated", "auditClaimed", "deploymentClaimed", "productionClaimed", "externalActionsPerformed"], "host evidence boundary");
  if (payload.evidenceBoundary.approvalCreated !== false || payload.evidenceBoundary.auditClaimed !== false
    || payload.evidenceBoundary.deploymentClaimed !== false || payload.evidenceBoundary.productionClaimed !== false
    || !Array.isArray(payload.evidenceBoundary.externalActionsPerformed) || payload.evidenceBoundary.externalActionsPerformed.length !== 0) {
    fail("PROJECT_SANDBOX_HOST_ATTESTATION_INVALID", "host attestation cannot carry approval, audit, deployment, production, or external-action authority");
  }
}

function assertInvocation(invocation, profile) {
  exactKeys(invocation, ["schemaVersion", "kind", "status", "profileSha256", "requestSha256", "adapter", "containerName", "imageReference", "imageSha256", "sourceArchiveSha256", "sourceArchiveByteLength", "planSha256", "argv", "argvSha256", "environmentKeysSha256", "mountSetSha256", "evidenceBoundary", "invocationSha256"], "Docker invocation");
  const { invocationSha256, ...payload } = invocation;
  if (invocation.schemaVersion !== PROJECT_SANDBOX_HOST_CONTRACT_VERSION
    || invocation.kind !== "programmable-project-sandbox-docker-invocation"
    || invocation.status !== "PLAN_ONLY_NOT_EXECUTED"
    || invocation.profileSha256 !== sandboxHostProfileSha256V1(profile)
    || invocation.imageReference !== profile.runtime.imageReference
    || invocation.imageSha256 !== profile.runtime.imageSha256
    || !SHA256.test(invocation.requestSha256 ?? "") || !SHA256.test(invocation.sourceArchiveSha256 ?? "")
    || !Number.isSafeInteger(invocation.sourceArchiveByteLength) || invocation.sourceArchiveByteLength < 1
    || !SHA256.test(invocation.planSha256 ?? "") || !argv(invocation.argv)
    || invocation.argvSha256 !== canonicalJsonSha256V2(invocation.argv)
    || invocationSha256 !== canonicalJsonSha256V2(payload)) {
    fail("PROJECT_SANDBOX_HOST_INVOCATION_INVALID", "Docker invocation identity or digest is invalid");
  }
  exactKeys(invocation.adapter, ["kind", "executablePath", "executableSha256"], "Docker invocation adapter");
  exactKeys(invocation.evidenceBoundary, ["candidateCodeExecuted", "isolationObserved", "receiptCreated", "externalActionsPerformed"], "Docker invocation evidence boundary");
  const policyDigests = sandboxHostPolicyDigestsV1(profile);
  if (invocation.adapter.kind !== "docker-cli"
    || !bounded(invocation.adapter.executablePath, 1, 4096) || !path.isAbsolute(invocation.adapter.executablePath)
    || invocation.adapter.executableSha256 !== profile.adapter.binarySha256
    || invocation.containerName !== expectedContainerName(invocation.requestSha256)
    || invocation.environmentKeysSha256 !== policyDigests.environmentKeysSha256
    || invocation.mountSetSha256 !== policyDigests.mountSetSha256
    || invocation.evidenceBoundary.candidateCodeExecuted !== false
    || invocation.evidenceBoundary.isolationObserved !== false
    || invocation.evidenceBoundary.receiptCreated !== false
    || !Array.isArray(invocation.evidenceBoundary.externalActionsPerformed)
    || invocation.evidenceBoundary.externalActionsPerformed.length !== 0) {
    fail("PROJECT_SANDBOX_HOST_INVOCATION_INVALID", "Docker invocation adapter, policy, or evidence boundary is invalid");
  }
  assertDockerArgv(invocation.argv, invocation, profile);
}

function assertDockerArgv(argvValue, invocation, profile) {
  const expectedEnvironment = Object.entries(explicitContainerEnvironment)
    .sort(([left], [right]) => compareUtf8(left, right))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  const mountStart = 22 + expectedEnvironment.length;
  const mountSpecifications = [
    [profile.policy.filesystem.sourceMount, true],
    [profile.policy.filesystem.requestMount, true],
    [profile.policy.filesystem.planMount, true],
    [profile.policy.filesystem.outputMount, false]
  ];
  const mountSources = mountSpecifications.map(([destination, readOnly], index) => (
    dockerMountSource(argvValue[mountStart + (index * 2) + 1], destination, readOnly)
  ));
  const expected = [
    "run", "--rm", "--name", invocation.containerName,
    "--pull", "never",
    "--init",
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", String(profile.policy.process.pidsLimit),
    "--memory", String(profile.limits.memoryBytes),
    "--cpus", canonicalCpuString(profile.limits.cpus),
    "--user", `${profile.runtime.user.uid}:${profile.runtime.user.gid}`,
    ...expectedEnvironment,
    ...mountSpecifications.flatMap(([destination, readOnly], index) => ["--mount", dockerBind(mountSources[index], destination, readOnly)]),
    "--tmpfs", `${profile.policy.filesystem.workspaceMount}:rw,nosuid,nodev,size=${profile.limits.workspaceBytes}`,
    "--tmpfs", `${profile.policy.filesystem.temporaryMount}:rw,noexec,nosuid,nodev,size=${profile.limits.temporaryBytes}`,
    "--workdir", profile.policy.filesystem.workspaceMount,
    "--entrypoint", profile.launcher.entrypoint[0],
    profile.runtime.imageReference,
    ...profile.launcher.entrypoint.slice(1),
    "--request", profile.policy.filesystem.requestMount,
    "--source-archive", profile.policy.filesystem.sourceMount,
    "--workspace", profile.policy.filesystem.workspaceMount,
    "--output", profile.policy.filesystem.outputMount,
    "--plan", profile.policy.filesystem.planMount,
    "--maximum-output-bytes", String(profile.limits.maximumOutputBytes)
  ];
  if (canonicalJsonV2(argvValue) !== canonicalJsonV2(expected)) {
    fail("PROJECT_SANDBOX_HOST_INVOCATION_INVALID", "Docker argv differs from the exact trusted profile");
  }
}

function assertInvocationOutputRoot(invocation, outputRoot) {
  const root = exactDirectory(outputRoot, "outputRoot", { mustBeEmpty: false });
  const outputMount = invocation.argv.find((value) => (
    typeof value === "string" && value.endsWith(`,dst=${containerPaths.output}`)
  ));
  const mountedRoot = dockerMountSource(outputMount, containerPaths.output, false);
  if (mountedRoot !== root) fail("PROJECT_SANDBOX_OUTPUT_ROOT_MISMATCH", "verified output root differs from the signed Docker invocation");
}

function dockerMountSource(value, destination, readOnly) {
  const prefix = "type=bind,src=";
  const suffix = `,dst=${destination}${readOnly ? ",readonly" : ""}`;
  if (!bounded(value, prefix.length + suffix.length + 1, 8192)
    || !value.startsWith(prefix) || !value.endsWith(suffix)) {
    fail("PROJECT_SANDBOX_HOST_INVOCATION_INVALID", `Docker mount for ${destination} is invalid`);
  }
  const source = value.slice(prefix.length, -suffix.length);
  if (!path.isAbsolute(source) || source.includes(",") || source.includes("\0")) {
    fail("PROJECT_SANDBOX_HOST_INVOCATION_INVALID", `Docker mount source for ${destination} is invalid`);
  }
  return source;
}

function expectedContainerName(requestSha256) {
  return `programmable-${requestSha256.slice("sha256:".length, "sha256:".length + 20)}`;
}

function assertExpectedRequest(request) {
  if (!plainObject(request) || request.schemaVersion !== "1.0.0"
    || request.kind !== "programmable-project-external-sandbox-request"
    || !SHA256.test(request.requestSha256 ?? "") || !Array.isArray(request.commands) || request.commands.length === 0) {
    fail("PROJECT_SANDBOX_REQUEST_INVALID", "expected sandbox request is invalid");
  }
  const { requestSha256, ...payload } = request;
  if (canonicalJsonSha256V2(payload) !== requestSha256) fail("PROJECT_SANDBOX_REQUEST_MISMATCH", "expected request digest differs");
}

function authorityPublicKey(authority) {
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

function verifySignature(payload, signature, publicKey, code) {
  if (!canonicalBase64(signature.value, 64)
    || !crypto.verify(null, canonicalBytes(payload), publicKey, Buffer.from(signature.value, "base64"))) {
    fail(code, "sandbox signature verification failed");
  }
}

function canonicalBase64(value, byteLength) {
  if (typeof value !== "string") return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === byteLength && bytes.toString("base64") === value;
}

function exactDirectory(value, label, { mustBeEmpty }) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail("PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} must be a path`);
  let resolved;
  try {
    resolved = fs.realpathSync(value);
  } catch {
    fail(label === "outputRoot" ? "PROJECT_SANDBOX_OUTPUT_ROOT_INVALID" : "PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} is unavailable`);
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} must be a real non-symlink directory`);
  if (mustBeEmpty && fs.readdirSync(resolved).length !== 0) fail("PROJECT_SANDBOX_OUTPUT_ROOT_NOT_EMPTY", "outputRoot must be empty before a Docker run is planned");
  return resolved;
}

function exactRegularFile(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail("PROJECT_SANDBOX_HOST_TOOL_MISSING", `${label} must be a path`);
  let resolved;
  try {
    resolved = fs.realpathSync(value);
  } catch {
    fail(label === "dockerExecutable" ? "PROJECT_SANDBOX_HOST_TOOL_MISSING" : "PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} is unavailable`);
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) fail("PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} must be a bounded regular non-symlink file`);
  return { path: resolved, sha256: sha256Bytes(fs.readFileSync(resolved)), byteLength: stat.size };
}

function readStrictJson(filePath, maximumBytes, label) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > maximumBytes) fail("PROJECT_SANDBOX_HOST_INPUT_TOO_LARGE", `${label} exceeds its byte limit`);
  let value;
  try {
    value = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: maximumBytes, maxNodes: 500_000, maxDepth: 256 });
  } catch (error) {
    fail("PROJECT_SANDBOX_HOST_JSON_INVALID", `${label} is invalid: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJsonV2(value)}\n`, "utf8"))) fail("PROJECT_SANDBOX_HOST_JSON_NOT_CANONICAL", `${label} must be canonical JSON plus one LF`);
  return value;
}

function gitArchiveBytes(root, headCommit) {
  const result = spawnSafeGitSync(["-C", root, "archive", "--format=tar", headCommit], {
    encoding: null,
    timeout: 120_000,
    maxBuffer: 512 * 1024 * 1024
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length === 0) {
    fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_FAILED", "exact Git source archive could not be generated", {
      error: Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8").trim() : String(result.stderr ?? "")
    });
  }
  return result.stdout;
}

function resolveInside(root, relativePath, label) {
  const target = path.resolve(root, relativePath);
  if (!isInside(root, target)) fail("PROJECT_SANDBOX_HOST_PATH_ESCAPE", `${label} escapes its declared root`);
  assertNoSymlinkComponents(root, target, label);
  return target;
}

function assertNoSymlinkComponents(root, target, label) {
  const relative = path.relative(root, target);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) fail("PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} is missing`);
    if (fs.lstatSync(cursor).isSymbolicLink()) fail("PROJECT_SANDBOX_HOST_PATH_SYMLINK", `${label} traverses a symlink`);
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function repositoryPath(value, label) {
  if (!bounded(value, 1, 500) || path.posix.isAbsolute(value) || value.includes("\\")
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} must be a portable repository path`);
  }
  return value;
}

function dockerBind(source, destination, readOnly) {
  return `type=bind,src=${source},dst=${destination}${readOnly ? ",readonly" : ""}`;
}

function canonicalCpuString(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/u, "").replace(/\.$/u, "");
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJsonV2(value), "utf8");
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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
