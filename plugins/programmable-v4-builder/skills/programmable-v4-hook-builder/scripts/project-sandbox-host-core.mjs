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
import {
  PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES,
  exactGitTreeTarBytesV1,
  exactGitTreeTarIdentityV1
} from "./project-sandbox-source-archive-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import {
  PROJECT_SANDBOX_HOST_ATTESTATION_KIND,
  PROJECT_SANDBOX_HOST_CONTRACT_VERSION,
  PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS,
  PROJECT_SANDBOX_HOST_PROFILE_KIND,
  PROJECT_SANDBOX_TRUST_ROOT_KIND,
  ProjectSandboxHostError,
  assertProjectSandboxExpectedRequestV1 as assertExpectedRequest,
  assertProjectSandboxHostAttestationV1 as assertHostAttestation,
  assertProjectSandboxHostProfileV1 as assertHostProfile,
  assertProjectSandboxTrustRootV1 as assertTrustRoot,
  isProjectSandboxAuthoritySubject,
  isProjectSandboxSha256,
  projectSandboxAuthorityPublicKeyV1 as authorityPublicKey,
  sandboxHostPolicyDigestsV1,
  sandboxHostProfileSha256V1,
  validateProjectSandboxHostAttestationV1,
  validateProjectSandboxHostProfileV1,
  validateProjectSandboxTrustRootV1,
  verifyProjectSandboxSignatureV1 as verifySignature
} from "./project-sandbox-host-contract.mjs";
import {
  assertProjectSandboxHostInvocationV1 as assertInvocation,
  createProjectSandboxDockerArgvV1,
  expectedProjectSandboxContainerNameV1 as expectedContainerName
} from "./project-sandbox-host-invocation.mjs";

export {
  PROJECT_SANDBOX_HOST_ATTESTATION_KIND,
  PROJECT_SANDBOX_HOST_CONTRACT_VERSION,
  PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS,
  PROJECT_SANDBOX_HOST_PROFILE_KIND,
  PROJECT_SANDBOX_TRUST_ROOT_KIND,
  ProjectSandboxHostError,
  sandboxHostPolicyDigestsV1,
  sandboxHostProfileSha256V1,
  validateProjectSandboxHostAttestationV1,
  validateProjectSandboxHostProfileV1,
  validateProjectSandboxTrustRootV1
};

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
  const bytes = exactGitTreeTarBytesV1({ repositoryRoot: root, headCommit: source.headCommit });
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      fs.linkSync(temporary, absolute);
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("PROJECT_SANDBOX_SOURCE_ARCHIVE_EXISTS", "source archive output already exists");
      }
      throw error;
    }
    fs.unlinkSync(temporary);
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
  const sourceArchive = exactRegularFile(
    sourceArchivePath,
    "sourceArchivePath",
    PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES
  );
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
  const expectedArchive = exactGitTreeTarIdentityV1({ repositoryRoot: sourceRoot, headCommit: source.headCommit });
  if (sourceArchive.byteLength !== expectedArchive.byteLength || sourceArchive.sha256 !== expectedArchive.sha256) {
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
  const containerName = expectedContainerName(expectedRequest.requestSha256);
  const argv = createProjectSandboxDockerArgvV1({
    profile,
    containerName,
    sourceArchivePath: sourceArchive.path,
    requestPath: sidecar.path,
    planPath: planSidecar.path,
    outputRoot: outputDirectory
  });
  const policyDigests = sandboxHostPolicyDigestsV1(profile);
  const result = {
    schemaVersion: PROJECT_SANDBOX_HOST_CONTRACT_VERSION,
    kind: "programmable-project-sandbox-docker-invocation",
    status: "EXTERNAL_BLOCKED",
    coverage: "STRUCTURE_AND_COVERAGE_ONLY",
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
    externalRequirements: PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS,
    evidenceBoundary: {
      candidateCodeExecuted: false,
      isolationObserved: false,
      receiptCreated: false,
      externalActionsPerformed: []
    }
  };
  return deepFreeze({ ...result, invocationSha256: canonicalJsonSha256V2(result) });
}

export function inspectProjectSandboxHostEvidenceV1({
  receipt,
  expectedRequest,
  attestation,
  trustRoot,
  profile,
  expectedSubject,
  expectedInvocation
}) {
  assertExpectedRequest(expectedRequest);
  assertHostProfile(profile);
  assertTrustRoot(trustRoot);
  assertHostAttestation(attestation);
  assertInvocation(expectedInvocation, profile);
  if (!isProjectSandboxAuthoritySubject(expectedSubject)) fail("PROJECT_SANDBOX_AUTHORITY_SUBJECT_INVALID", "expected authority subject is invalid");
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
  const signatureKey = trustRoot.authorities.find((entry) => entry.keyId === keyId && entry.subject === expectedSubject);
  if (!signatureKey || signatureKey.status !== "active") {
    fail("PROJECT_SANDBOX_SIGNATURE_KEY_UNAVAILABLE", "caller-supplied key set does not contain the claimed signer");
  }
  if (signatureKey.profileSha256 !== sandboxHostProfileSha256V1(profile)
    || signatureKey.launcher.id !== receipt.payload.launcher.id
    || signatureKey.launcher.binarySha256 !== receipt.payload.launcher.binarySha256
    || signatureKey.runtime.id !== receipt.payload.runtime.id
    || signatureKey.runtime.imageSha256 !== receipt.payload.runtime.imageSha256
    || signatureKey.runtime.isolation !== receipt.payload.runtime.isolation) {
    fail("PROJECT_SANDBOX_SIGNATURE_SCOPE_MISMATCH", "receipt launcher, runtime, isolation, or host profile differs from the caller-supplied signature scope");
  }
  const publicKey = authorityPublicKey(signatureKey);
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
  assertClaimedCoverageMatches({ receipt, profile, payload, expectedInvocation });
  return deepFreeze({
    status: "EXTERNAL_BLOCKED",
    inspectionStatus: "PROJECT_SANDBOX_HOST_STRUCTURE_AND_SIGNATURES_VALID",
    coverage: "STRUCTURE_AND_COVERAGE_ONLY",
    callerSuppliedKeySet: { rootId: trustRoot.rootId, subject: signatureKey.subject, keyId: signatureKey.keyId },
    requestSha256: expectedRequest.requestSha256,
    receiptSha256: payload.receiptSha256,
    attestationSha256: canonicalJsonSha256V2(attestation),
    profileSha256: payload.hostProfileSha256,
    invocationSha256: payload.invocation.invocationSha256,
    cryptographicSignaturesValid: true,
    structuralBindingsValid: true,
    policyClaimsStructurallyConsistent: true,
    authorityTrusted: false,
    ownerPinnedTrustRootVerified: false,
    hostExecutionProven: false,
    executionCompleted: false,
    commandsExecuted: false,
    isolationProven: false,
    outputBytesVerified: false,
    processTeardownProven: false,
    completion: "NOT_COMPLETION",
    projectPreflightStatus: "NOT_PROJECT_PREFLIGHT_VALID",
    externalRequirements: PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS,
    evidenceBoundary: {
      completion: "NOT_COMPLETION",
      approvalCreated: false,
      auditClaimed: false,
      deploymentClaimed: false,
      productionClaimed: false,
      externalActionsPerformed: []
    }
  });
}

function assertClaimedCoverageMatches({ receipt, profile, payload, expectedInvocation }) {
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
    fail("PROJECT_SANDBOX_HOST_INVOCATION_MISMATCH", "claimed host invocation identity differs from the selected profile");
  }
  if (filesystem.sourceReadOnly !== true || filesystem.disposableWorkspace !== true
    || filesystem.allowedPathsSha256 !== expectedDigests.allowedPathsSha256
    || filesystem.deniedPathsSha256 !== expectedDigests.deniedPathsSha256
    || !isProjectSandboxSha256(filesystem.writesObservedSha256)
    || filesystem.allowedPathsSha256 !== receiptPolicy.filesystem.allowedPathsSha256
    || filesystem.deniedPathsSha256 !== receiptPolicy.filesystem.deniedPathsSha256) {
    fail("PROJECT_SANDBOX_FILESYSTEM_CLAIM_INVALID", "filesystem claims differ from the selected profile or receipt");
  }
  if (network.mode !== "forbidden" || network.allowlistSha256 !== null || network.accessObserved !== false
    || receiptPolicy.network.mode !== "forbidden"
    || receipt.payload.commands.some(({ networkAccessed }) => networkAccessed !== false)) {
    fail("PROJECT_SANDBOX_NETWORK_CLAIM_INVALID", "network claims do not state both forbidden and unobserved access");
  }
  if (secrets.inherited !== false || secrets.mounted !== false
    || secrets.environmentKeysSha256 !== expectedDigests.environmentKeysSha256
    || receiptPolicy.secrets.inherited !== false || receiptPolicy.secrets.mounted !== false) {
    fail("PROJECT_SANDBOX_SECRET_CLAIM_INVALID", "secret-handling claims differ or report inherited or mounted secrets");
  }
  if (writes.allowed !== false || writes.performed !== false
    || receiptPolicy.externalWrites.allowed !== false
    || receipt.payload.commands.some(({ externalWritesPerformed }) => externalWritesPerformed !== false)) {
    fail("PROJECT_SANDBOX_EXTERNAL_WRITE_CLAIM_INVALID", "external-write claims do not state both forbidden and unobserved writes");
  }
  if (processEvidence.init !== true || processEvidence.pidsLimit !== profile.policy.process.pidsLimit
    || !isProjectSandboxSha256(processEvidence.containerIdSha256)
    || processEvidence.runnerExitCode !== 0 || processEvidence.containerExitCode !== 0
    || processEvidence.containerRemoved !== true || processEvidence.postRemovalState !== "absent"
    || processEvidence.descendantsRemaining !== 0 || !isProjectSandboxSha256(processEvidence.teardownObservationSha256)
    || receiptPolicy.process.descendantsReaped !== true) {
    fail("PROJECT_SANDBOX_PROCESS_TEARDOWN_CLAIM_INVALID", "container exit, removal, or descendant teardown claims are inconsistent");
  }
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
  return { path: resolved, sha256: sha256RegularFile(resolved, stat.size, label), byteLength: stat.size };
}

function sha256RegularFile(filePath, expectedBytes, label) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let descriptor;
  let observedBytes = 0;
  try {
    descriptor = fs.openSync(filePath, "r");
    while (observedBytes < expectedBytes) {
      const byteLength = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, expectedBytes - observedBytes),
        null
      );
      if (byteLength === 0) fail("PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} changed while it was hashed`);
      hash.update(buffer.subarray(0, byteLength));
      observedBytes += byteLength;
    }
    if (fs.readSync(descriptor, buffer, 0, 1, null) !== 0) {
      fail("PROJECT_SANDBOX_HOST_PATH_INVALID", `${label} changed while it was hashed`);
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
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

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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
