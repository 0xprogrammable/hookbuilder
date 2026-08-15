import path from "node:path";

import { canonicalJsonSha256V2, canonicalJsonV2 } from "./canonical-json-core.mjs";
import {
  PROJECT_SANDBOX_CONTAINER_ENVIRONMENT,
  PROJECT_SANDBOX_HOST_CONTRACT_VERSION,
  PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS,
  ProjectSandboxHostError,
  isProjectSandboxSha256,
  sandboxHostPolicyDigestsV1,
  sandboxHostProfileSha256V1
} from "./project-sandbox-host-contract.mjs";

export function createProjectSandboxDockerArgvV1({
  profile,
  containerName,
  sourceArchivePath,
  requestPath,
  planPath,
  outputRoot
}) {
  return [
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
    ...Object.entries(PROJECT_SANDBOX_CONTAINER_ENVIRONMENT)
      .sort(([left], [right]) => compareUtf8(left, right))
      .flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    "--mount", dockerBind(sourceArchivePath, profile.policy.filesystem.sourceMount, true),
    "--mount", dockerBind(requestPath, profile.policy.filesystem.requestMount, true),
    "--mount", dockerBind(planPath, profile.policy.filesystem.planMount, true),
    "--mount", dockerBind(outputRoot, profile.policy.filesystem.outputMount, false),
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
}

export function expectedProjectSandboxContainerNameV1(requestSha256) {
  return `programmable-${requestSha256.slice("sha256:".length, "sha256:".length + 20)}`;
}

export function assertProjectSandboxHostInvocationV1(invocation, profile) {
  exactKeys(invocation, ["schemaVersion", "kind", "status", "coverage", "profileSha256", "requestSha256", "adapter", "containerName", "imageReference", "imageSha256", "sourceArchiveSha256", "sourceArchiveByteLength", "planSha256", "argv", "argvSha256", "environmentKeysSha256", "mountSetSha256", "externalRequirements", "evidenceBoundary", "invocationSha256"], "Docker invocation");
  const { invocationSha256, ...payload } = invocation;
  if (invocation.schemaVersion !== PROJECT_SANDBOX_HOST_CONTRACT_VERSION
    || invocation.kind !== "programmable-project-sandbox-docker-invocation"
    || invocation.status !== "EXTERNAL_BLOCKED"
    || invocation.coverage !== "STRUCTURE_AND_COVERAGE_ONLY"
    || invocation.profileSha256 !== sandboxHostProfileSha256V1(profile)
    || invocation.imageReference !== profile.runtime.imageReference
    || invocation.imageSha256 !== profile.runtime.imageSha256
    || !isProjectSandboxSha256(invocation.requestSha256) || !isProjectSandboxSha256(invocation.sourceArchiveSha256)
    || !Number.isSafeInteger(invocation.sourceArchiveByteLength) || invocation.sourceArchiveByteLength < 1
    || !isProjectSandboxSha256(invocation.planSha256) || !argv(invocation.argv)
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
    || invocation.containerName !== expectedProjectSandboxContainerNameV1(invocation.requestSha256)
    || invocation.environmentKeysSha256 !== policyDigests.environmentKeysSha256
    || invocation.mountSetSha256 !== policyDigests.mountSetSha256
    || !Array.isArray(invocation.externalRequirements)
    || canonicalJsonV2(invocation.externalRequirements) !== canonicalJsonV2(PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS)
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
  const environmentItemCount = Object.keys(PROJECT_SANDBOX_CONTAINER_ENVIRONMENT).length * 2;
  const mountStart = 22 + environmentItemCount;
  const mountSpecifications = [
    [profile.policy.filesystem.sourceMount, true],
    [profile.policy.filesystem.requestMount, true],
    [profile.policy.filesystem.planMount, true],
    [profile.policy.filesystem.outputMount, false]
  ];
  const mountSources = mountSpecifications.map(([destination, readOnly], index) => (
    dockerMountSource(argvValue[mountStart + (index * 2) + 1], destination, readOnly)
  ));
  const expected = createProjectSandboxDockerArgvV1({
    profile,
    containerName: invocation.containerName,
    sourceArchivePath: mountSources[0],
    requestPath: mountSources[1],
    planPath: mountSources[2],
    outputRoot: mountSources[3]
  });
  if (canonicalJsonV2(argvValue) !== canonicalJsonV2(expected)) {
    fail("PROJECT_SANDBOX_HOST_INVOCATION_INVALID", "Docker argv differs from the exact selected planning profile");
  }
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

function dockerBind(source, destination, readOnly) {
  return `type=bind,src=${source},dst=${destination}${readOnly ? ",readonly" : ""}`;
}

function canonicalCpuString(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/u, "").replace(/\.$/u, "");
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

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function fail(code, message, details = {}) {
  throw new ProjectSandboxHostError(code, message, details);
}
