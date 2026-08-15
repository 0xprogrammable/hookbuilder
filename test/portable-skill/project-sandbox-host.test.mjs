import test from "node:test";

import * as sandboxHostCore from "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-host-core.mjs";

import {
  assert, crypto, fs, os, path,
  canonicalJsonSha256V2, canonicalJsonV2, git,
  createMaterializedRepository, executeProjectCommands, sha256Bytes
} from "./project-compiler-fixture.mjs";
import { inspectCleanProjectSource } from "../../skills/programmable-v4-hook-builder/scripts/project-command-executor-core.mjs";
import {
  createProjectSandboxRequestV1,
  verifyProjectSandboxReceiptV1
} from "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-receipt-core.mjs";
import {
  PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES,
  PROJECT_SANDBOX_SOURCE_UNIQUE_BLOB_MAXIMUM_BYTES,
  exactGitTreeTarBytesV1,
  exactGitTreeTarIdentityV1
} from "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-source-archive-core.mjs";
import {
  PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS,
  createDockerSandboxInvocationV1,
  createProjectSandboxSourceArchiveV1,
  inspectProjectSandboxHostEvidenceV1,
  sandboxHostPolicyDigestsV1,
  sandboxHostProfileSha256V1,
  validateProjectSandboxHostAttestationV1,
  validateProjectSandboxHostProfileV1,
  validateProjectSandboxTrustRootV1
} from "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-host-core.mjs";

const authoritySubject = "urn:programmable:sandbox:test-authority";
const authorityKeyId = "test-sandbox-authority-v1";

test("portable host module exposes no completion verifier or signing helper", () => {
  assert.equal(Object.hasOwn(sandboxHostCore, "verifyProjectSandboxHostCompletionV1"), false);
  assert.equal(Object.hasOwn(sandboxHostCore, "signProjectSandboxHostAttestationV1"), false);
  assert.equal(Object.hasOwn(sandboxHostCore, "projectSandboxHostAttestationPayloadV1"), false);
  const sources = [
    "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-host-contract.mjs",
    "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-host-core.mjs",
    "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-host-invocation.mjs"
  ].map((relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
  const cliSource = fs.readFileSync(new URL("../../skills/programmable-v4-hook-builder/scripts/project-sandbox-host.mjs", import.meta.url), "utf8");
  for (const source of sources) {
    assert.doesNotMatch(source, /PROJECT_SANDBOX_HOST_COMPLETION_VERIFIED/u);
    assert.doesNotMatch(source, /executionCompleted:\s*true/u);
  }
  assert.doesNotMatch(cliSource, /operation === "verify"/u);
  assert.match(cliSource, /operation === "inspect-evidence"/u);
});

test("source archive finalization never replaces a concurrently created output", (t) => {
  const project = createMaterializedRepository(t);
  const source = inspectCleanProjectSource(project.root);
  const request = createProjectSandboxRequestV1({ repositoryPlan: project.plan, source });
  const sidecarRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-sandbox-archive-race-"));
  const outputPath = path.join(sidecarRoot, "source.tar");
  const competingBytes = Buffer.from("CONCURRENT_OUTPUT_MUST_SURVIVE\n", "utf8");
  const originalLinkSync = fs.linkSync;
  t.after(() => {
    fs.linkSync = originalLinkSync;
    fs.rmSync(sidecarRoot, { recursive: true, force: true });
  });
  fs.linkSync = (...arguments_) => {
    fs.writeFileSync(outputPath, competingBytes, { flag: "wx", mode: 0o600 });
    return originalLinkSync(...arguments_);
  };

  assert.throws(
    () => createProjectSandboxSourceArchiveV1({
      repositoryRoot: project.root,
      expectedRequest: request,
      outputPath
    }),
    ({ code }) => code === "PROJECT_SANDBOX_SOURCE_ARCHIVE_EXISTS"
  );
  assert.deepEqual(fs.readFileSync(outputPath), competingBytes);
  assert.deepEqual(fs.readdirSync(sidecarRoot), ["source.tar"]);
});

test("source archive maps exact Git tree bytes without applying candidate export attributes", (t) => {
  const ignoredBytes = Buffer.from("EXPORTED_EVEN_WITH_EXPORT_IGNORE\n", "utf8");
  const substitutionBytes = Buffer.from("literal-$Format:%H$-bytes\n", "utf8");
  const longPath = `long/${"a".repeat(90)}/${"b".repeat(90)}/${"c".repeat(90)}.txt`;
  const longPathBytes = Buffer.from("LONG_PATH_BYTES\n", "utf8");
  const project = createMaterializedRepository(t, {
    extraFiles: [
      ["export-ignored.txt", ignoredBytes],
      ["export-substituted.txt", substitutionBytes],
      ["bin/executable", "#!/bin/sh\nexit 0\n"],
      [longPath, longPathBytes]
    ],
    setup(root) {
      fs.writeFileSync(
        path.join(root, ".gitattributes"),
        "export-ignored.txt export-ignore\nexport-substituted.txt export-subst\n"
      );
      fs.chmodSync(path.join(root, "bin/executable"), 0o755);
    }
  });
  const source = inspectCleanProjectSource(project.root);
  const request = createProjectSandboxRequestV1({ repositoryPlan: project.plan, source });
  const sidecarRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-sandbox-exact-tree-"));
  t.after(() => fs.rmSync(sidecarRoot, { recursive: true, force: true }));
  const firstPath = path.join(sidecarRoot, "source-a.tar");
  const secondPath = path.join(sidecarRoot, "source-b.tar");

  createProjectSandboxSourceArchiveV1({ repositoryRoot: project.root, expectedRequest: request, outputPath: firstPath });
  createProjectSandboxSourceArchiveV1({ repositoryRoot: project.root, expectedRequest: request, outputPath: secondPath });
  const first = fs.readFileSync(firstPath);
  const second = fs.readFileSync(secondPath);

  assert.deepEqual(second, first, "the same tree must produce byte-identical deterministic tar bytes");
  assert.deepEqual(exactGitTreeTarIdentityV1({ repositoryRoot: project.root, headCommit: source.headCommit }), {
    sha256: sha256Bytes(first),
    byteLength: first.length
  }, "hash-only identity must cover the same USTAR/PAX stream without materializing another tar");
  assert.equal(first.includes(ignoredBytes), true, "export-ignore must not remove a committed blob");
  assert.equal(first.includes(substitutionBytes), true, "export-subst must not rewrite committed blob bytes");
  assert.equal(first.includes(Buffer.from(source.headCommit, "utf8")), false, "archive metadata must not inject the commit id");
  const entries = parseTarEntries(first);
  assert.deepEqual(entries.get("export-ignored.txt")?.bytes, ignoredBytes);
  assert.deepEqual(entries.get("export-substituted.txt")?.bytes, substitutionBytes);
  assert.deepEqual(entries.get(longPath)?.bytes, longPathBytes, "PAX path must preserve an exact long tree path");
  assert.equal(entries.get("bin/executable")?.mode, 0o755);
  assert.equal(entries.get("README.md")?.mode, 0o644);
  for (const entry of entries.values()) {
    assert.equal(entry.uid, 0);
    assert.equal(entry.gid, 0);
    assert.equal(entry.mtime, 0);
  }
});

test("source archive rejects symbolic-link tree entries", (t) => {
  const project = createMaterializedRepository(t, {
    setup(root) {
      fs.symlinkSync("README.md", path.join(root, "readme-link"));
    }
  });
  assertUnsupportedSourceTree(t, project, "symlink-source", "120000");
});

test("source archive rejects gitlink tree entries", (t) => {
  const project = createMaterializedRepository(t, {
    setup(root) {
      const nested = path.join(root, "vendor", "embedded");
      fs.mkdirSync(nested, { recursive: true });
      git(nested, ["init", "-q"]);
      git(nested, ["config", "user.name", "Embedded Fixture"]);
      git(nested, ["config", "user.email", "embedded@example.invalid"]);
      fs.writeFileSync(path.join(nested, "README.md"), "# Embedded\n");
      git(nested, ["add", "."]);
      git(nested, ["commit", "-qm", "embedded fixture"]);
    }
  });
  assertUnsupportedSourceTree(t, project, "gitlink-source", "160000");
});

test("combined file and inferred-directory cap fails before retaining an excess deep entry", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-sandbox-entry-cap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deepDirectory = path.join(root, "a", "b", "c", "d", "e");
  fs.mkdirSync(deepDirectory, { recursive: true });
  fs.writeFileSync(path.join(deepDirectory, "source.txt"), "bounded tree\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Entry Cap Fixture"]);
  git(root, ["config", "user.email", "entry-cap@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "deep tree fixture"]);
  const headCommit = git(root, ["rev-parse", "HEAD"]);

  assert.throws(
    () => exactGitTreeTarBytesV1({ repositoryRoot: root, headCommit, maximumTreeEntries: 4 }),
    ({ code, maximumEntries, retainedEntries, attemptedEntryKind, attemptedPath }) => (
      code === "PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED"
      && maximumEntries === 4
      && retainedEntries === 4
      && attemptedEntryKind === "directory"
      && attemptedPath === "a/b/c/d/e/"
    )
  );
});

test("source archive enforces bounded unique-blob and final-tar bytes while hash-only identity stays exact", (t) => {
  assert.equal(PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES, 64 * 1024 * 1024);
  assert.equal(PROJECT_SANDBOX_SOURCE_UNIQUE_BLOB_MAXIMUM_BYTES, 48 * 1024 * 1024);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-sandbox-byte-cap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceBytes = Buffer.alloc(1_024, 0x61);
  fs.writeFileSync(path.join(root, "source.bin"), sourceBytes);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Byte Cap Fixture"]);
  git(root, ["config", "user.email", "byte-cap@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "bounded byte fixture"]);
  const headCommit = git(root, ["rev-parse", "HEAD"]);
  const exactArchiveBytes = 2_560;

  const archive = exactGitTreeTarBytesV1({
    repositoryRoot: root,
    headCommit,
    maximumArchiveBytes: exactArchiveBytes,
    maximumUniqueBlobBytes: sourceBytes.length
  });
  assert.equal(archive.length, exactArchiveBytes);
  assert.deepEqual(exactGitTreeTarIdentityV1({
    repositoryRoot: root,
    headCommit,
    maximumArchiveBytes: exactArchiveBytes,
    maximumUniqueBlobBytes: sourceBytes.length
  }), {
    sha256: sha256Bytes(archive),
    byteLength: exactArchiveBytes
  });

  assert.throws(
    () => exactGitTreeTarBytesV1({
      repositoryRoot: root,
      headCommit,
      maximumArchiveBytes: exactArchiveBytes,
      maximumUniqueBlobBytes: sourceBytes.length - 1
    }),
    ({ code, maximumBytes, retainedBytes, attemptedBytes }) => (
      code === "PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED"
      && maximumBytes === sourceBytes.length - 1
      && retainedBytes === 0
      && attemptedBytes === sourceBytes.length
    )
  );
  assert.throws(
    () => exactGitTreeTarBytesV1({
      repositoryRoot: root,
      headCommit,
      maximumArchiveBytes: exactArchiveBytes - 1,
      maximumUniqueBlobBytes: sourceBytes.length
    }),
    ({ code, maximumBytes, requiredBytes }) => (
      code === "PROJECT_SANDBOX_SOURCE_TREE_LIMIT_EXCEEDED"
      && maximumBytes === exactArchiveBytes - 1
      && requiredBytes === exactArchiveBytes
    )
  );
  assert.throws(
    () => exactGitTreeTarBytesV1({
      repositoryRoot: root,
      headCommit,
      maximumArchiveBytes: PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES + 1
    }),
    ({ code, maximumAllowedBytes }) => (
      code === "PROJECT_SANDBOX_SOURCE_TREE_LIMIT_INVALID"
      && maximumAllowedBytes === PROJECT_SANDBOX_SOURCE_ARCHIVE_MAXIMUM_BYTES
    )
  );
});

test("Docker planning emits restrictive desired argv but remains externally blocked", (t) => {
  const fixture = hostFixture(t);
  assert.deepEqual(validateProjectSandboxHostProfileV1(fixture.profile), []);
  const { argv, evidenceBoundary } = fixture.invocation;
  assert.equal(fixture.invocation.status, "EXTERNAL_BLOCKED");
  assert.equal(fixture.invocation.coverage, "STRUCTURE_AND_COVERAGE_ONLY");
  assert.deepEqual(fixture.invocation.externalRequirements, PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS);
  for (const requirement of [
    "NATIVE_LINUX_UID_GID_MOUNT_ACCESS_REQUIRED",
    "HOST_DEADLINE_KILL_AND_REAP_REQUIRED",
    "KERNEL_OUTPUT_BYTES_INODES_ENTRIES_DEPTH_QUOTA_REQUIRED",
    "DOCKER_CLIENT_DAEMON_PLATFORM_RESOLVED_IMAGE_IDENTITY_REQUIRED",
    "PINNED_SECCOMP_AND_USER_NAMESPACE_REQUIRED",
    "DESCRIPTOR_SAFE_NOFOLLOW_OUTPUT_VERIFICATION_REQUIRED"
  ]) assert.ok(fixture.invocation.externalRequirements.includes(requirement));
  assert.equal(evidenceBoundary.candidateCodeExecuted, false);
  assert.equal(evidenceBoundary.isolationObserved, false);
  for (const pair of [
    ["--pull", "never"],
    ["--network", "none"],
    ["--cap-drop", "ALL"],
    ["--security-opt", "no-new-privileges:true"],
    ["--user", "65532:65532"],
    ["--entrypoint", "node"]
  ]) assert.deepEqual(argv.slice(argv.indexOf(pair[0]), argv.indexOf(pair[0]) + 2), pair);
  for (const standalone of ["--rm", "--init", "--read-only"]) assert.ok(argv.includes(standalone));
  assert.ok(argv.includes(`type=bind,src=${fs.realpathSync(fixture.sourceArchivePath)},dst=/input/source.tar,readonly`));
  assert.ok(argv.includes(`type=bind,src=${fs.realpathSync(fixture.requestPath)},dst=/request/request.v1.json,readonly`));
  assert.ok(argv.includes(`type=bind,src=${fs.realpathSync(fixture.planPath)},dst=/request/repository-plan.v1.json,readonly`));
  assert.ok(argv.includes(`type=bind,src=${fs.realpathSync(fixture.outputRoot)},dst=/output`));
  assert.equal(argv.some((value) => /TOKEN|SECRET|PASSWORD|PRIVATE_KEY/u.test(value)), false);
  assert.equal(argv[argv.indexOf("--source-archive") + 1], "/input/source.tar");
  assert.equal(argv[argv.indexOf("--plan") + 1], "/request/repository-plan.v1.json");
  assert.equal(fs.readFileSync(fixture.sourceArchivePath).includes(Buffer.from("IGNORED_SECRET_MUST_NOT_MOUNT", "utf8")), false);

  assert.throws(
    () => createDockerSandboxInvocationV1({
      profile: fixture.profile,
      expectedRequest: fixture.request,
      repositoryRoot: fixture.project.root,
      sourceArchivePath: fixture.sourceArchivePath,
      requestPath: fixture.requestPath,
      outputRoot: fixture.anotherEmptyOutput,
      planPath: fixture.planPath,
      dockerExecutable: path.join(fixture.sidecarRoot, "missing-docker")
    }),
    ({ code }) => code === "PROJECT_SANDBOX_HOST_TOOL_MISSING"
  );

  const driftedArchive = path.join(fixture.sidecarRoot, "drifted-source.tar");
  fs.copyFileSync(fixture.sourceArchivePath, driftedArchive);
  fs.appendFileSync(driftedArchive, "drift");
  assert.throws(
    () => createDockerSandboxInvocationV1({
      profile: fixture.profile,
      expectedRequest: fixture.request,
      repositoryRoot: fixture.project.root,
      sourceArchivePath: driftedArchive,
      requestPath: fixture.requestPath,
      outputRoot: fixture.anotherEmptyOutput,
      planPath: fixture.planPath,
      dockerExecutable: fixture.invocation.adapter.executablePath
    }),
    ({ code }) => code === "PROJECT_SANDBOX_SOURCE_ARCHIVE_DRIFT"
  );

  const driftedPlan = structuredClone(fixture.project.plan);
  driftedPlan.commands[0].argv = ["node", "tools/project-stage.mjs", "changed"];
  const driftedPlanPath = path.join(fixture.sidecarRoot, "drifted-plan.json");
  fs.writeFileSync(driftedPlanPath, `${canonicalJsonV2(driftedPlan)}\n`);
  assert.throws(
    () => createDockerSandboxInvocationV1({
      profile: fixture.profile,
      expectedRequest: fixture.request,
      repositoryRoot: fixture.project.root,
      sourceArchivePath: fixture.sourceArchivePath,
      requestPath: fixture.requestPath,
      outputRoot: fixture.anotherEmptyOutput,
      planPath: driftedPlanPath,
      dockerExecutable: fixture.invocation.adapter.executablePath
    }),
    ({ code }) => code === "PROJECT_SANDBOX_PLAN_DRIFT"
  );

  const oversizedEntrypoint = structuredClone(fixture.profile);
  oversizedEntrypoint.launcher.entrypoint = Array.from({ length: 33 }, (_, index) => `launcher-${index}`);
  assert.ok(validateProjectSandboxHostProfileV1(oversizedEntrypoint).some(({ code }) => code === "PROJECT_SANDBOX_HOST_PROFILE_INVALID"));
});

test("caller-supplied signatures remain structure-only and can never produce completion", (t) => {
  const fixture = hostFixture(t);
  const inspected = inspectProjectSandboxHostEvidenceV1(fixture.inspectionInput);
  assert.equal(inspected.status, "EXTERNAL_BLOCKED");
  assert.equal(inspected.inspectionStatus, "PROJECT_SANDBOX_HOST_STRUCTURE_AND_SIGNATURES_VALID");
  assert.equal(inspected.coverage, "STRUCTURE_AND_COVERAGE_ONLY");
  assert.equal(inspected.cryptographicSignaturesValid, true);
  assert.equal(inspected.authorityTrusted, false);
  assert.equal(inspected.ownerPinnedTrustRootVerified, false);
  assert.equal(inspected.hostExecutionProven, false);
  assert.equal(inspected.executionCompleted, false);
  assert.equal(inspected.commandsExecuted, false);
  assert.equal(inspected.isolationProven, false);
  assert.equal(inspected.outputBytesVerified, false);
  assert.equal(inspected.processTeardownProven, false);
  assert.equal(inspected.completion, "NOT_COMPLETION");
  assert.equal(inspected.projectPreflightStatus, "NOT_PROJECT_PREFLIGHT_VALID");
  assert.deepEqual(inspected.externalRequirements, PROJECT_SANDBOX_HOST_EXTERNAL_REQUIREMENTS);
  assert.deepEqual(inspected.evidenceBoundary, {
    completion: "NOT_COMPLETION",
    approvalCreated: false,
    auditClaimed: false,
    deploymentClaimed: false,
    productionClaimed: false,
    externalActionsPerformed: []
  });
  assert.deepEqual(validateProjectSandboxTrustRootV1(fixture.trustRoot), []);
  assert.deepEqual(validateProjectSandboxHostAttestationV1(fixture.attestation), []);
  assert.equal(fs.readFileSync(fixture.invocation.adapter.executablePath, "utf8"), "#!/bin/false\n");
  assert.throws(
    () => verifyProjectSandboxReceiptV1({ receipt: fixture.receipt, expectedRequest: fixture.request }),
    ({ code }) => code === "PROJECT_SANDBOX_AUTHORITY_UNTRUSTED"
  );
});

test("structure inspector rejects mismatches but self-issued matching keys still remain external blocked", (t) => {
  const fixture = hostFixture(t);
  const inspect = (overrides = {}) => inspectProjectSandboxHostEvidenceV1({ ...fixture.inspectionInput, ...overrides });

  assert.throws(
    () => inspect({ trustRoot: { ...fixture.trustRoot, authorities: [] } }),
    ({ code }) => code === "PROJECT_SANDBOX_SIGNATURE_KEY_UNAVAILABLE"
  );
  assert.throws(
    () => inspect({ expectedSubject: "urn:programmable:sandbox:wrong-authority" }),
    ({ code }) => code === "PROJECT_SANDBOX_AUTHORITY_SUBJECT_MISMATCH"
  );

  const alternate = crypto.generateKeyPairSync("ed25519");
  const selfSignedReceipt = resignReceipt(fixture.receipt, alternate.privateKey);
  const selfSignedPayload = claimedHostAttestationPayload({ receipt: selfSignedReceipt, profile: fixture.profile, invocation: fixture.invocation });
  const selfSignedAttestation = rawSignAttestation(selfSignedPayload, alternate.privateKey);
  assert.throws(
    () => inspect({ receipt: selfSignedReceipt, attestation: selfSignedAttestation }),
    ({ code }) => code === "PROJECT_SANDBOX_SIGNATURE_INVALID"
  );
  const selfIssued = inspect({
    receipt: selfSignedReceipt,
    attestation: selfSignedAttestation,
    trustRoot: trustRootFor(alternate.publicKey, fixture.profile)
  });
  assert.equal(selfIssued.status, "EXTERNAL_BLOCKED");
  assert.equal(selfIssued.authorityTrusted, false);
  assert.equal(selfIssued.executionCompleted, false);
  assert.equal(selfIssued.completion, "NOT_COMPLETION");

  const networkReceipt = mutateAndResignReceipt(fixture.receipt, fixture.privateKey, (receipt) => {
    receipt.payload.commands[0].networkAccessed = true;
  });
  assert.throws(
    () => inspect({ receipt: networkReceipt }),
    ({ code }) => ["PROJECT_SANDBOX_NETWORK_POLICY_VIOLATED", "PROJECT_SANDBOX_NETWORK_CLAIM_INVALID"].includes(code)
  );

  const networkedInvocation = structuredClone(fixture.invocation);
  networkedInvocation.argv[networkedInvocation.argv.indexOf("--network") + 1] = "bridge";
  networkedInvocation.argvSha256 = canonicalJsonSha256V2(networkedInvocation.argv);
  const { invocationSha256: _invocationDigest, ...networkedInvocationPayload } = networkedInvocation;
  networkedInvocation.invocationSha256 = canonicalJsonSha256V2(networkedInvocationPayload);
  assert.throws(
    () => inspect({ expectedInvocation: networkedInvocation }),
    ({ code }) => code === "PROJECT_SANDBOX_HOST_INVOCATION_INVALID"
  );

  const writeReceipt = mutateAndResignReceipt(fixture.receipt, fixture.privateKey, (receipt) => {
    receipt.payload.commands[0].externalWritesPerformed = true;
  });
  assert.throws(
    () => inspect({ receipt: writeReceipt }),
    ({ code }) => ["PROJECT_SANDBOX_COMMAND_RESULT_INVALID", "PROJECT_SANDBOX_EXTERNAL_WRITE_CLAIM_INVALID"].includes(code)
  );

  const leakedPayload = structuredClone(fixture.attestation.payload);
  leakedPayload.enforcement.process.descendantsRemaining = 1;
  const leakedAttestation = rawSignAttestation(leakedPayload, fixture.privateKey);
  assert.ok(validateProjectSandboxHostAttestationV1(leakedAttestation).some(({ code }) => code === "PROJECT_SANDBOX_HOST_ATTESTATION_INVALID"));
  assert.throws(
    () => inspect({ attestation: leakedAttestation }),
    ({ code }) => code === "PROJECT_SANDBOX_HOST_ATTESTATION_INVALID"
  );

  const driftedRequest = structuredClone(fixture.request);
  driftedRequest.applicationId = "drifted-application";
  const { requestSha256: _digest, ...requestPayload } = driftedRequest;
  driftedRequest.requestSha256 = canonicalJsonSha256V2(requestPayload);
  assert.throws(
    () => inspect({ expectedRequest: driftedRequest }),
    ({ code }) => code === "PROJECT_SANDBOX_SUBJECT_MISMATCH"
  );
});

test("portable project execute remains fail-closed even beside a valid opt-in host contract", async (t) => {
  const fixture = createMaterializedRepository(t);
  await assert.rejects(
    executeProjectCommands({
      repositoryRoot: fixture.root,
      repositoryPlan: fixture.plan,
      outputPlanPath: ".programmable/repository-plan.v1.json"
    }),
    ({ code, commandsExecuted, trustedSandboxAuthorityConfigured }) => (
      code === "PROJECT_EXTERNAL_SANDBOX_REQUIRED"
      && commandsExecuted === false
      && trustedSandboxAuthorityConfigured === false
    )
  );
});

function hostFixture(t) {
  const project = createMaterializedRepository(t);
  const source = inspectCleanProjectSource(project.root);
  const request = createProjectSandboxRequestV1({ repositoryPlan: project.plan, source });
  const sidecarRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-sandbox-host-test-"));
  t.after(() => fs.rmSync(sidecarRoot, { recursive: true, force: true }));
  const planPath = path.join(sidecarRoot, "repository-plan.materializing.v1.json");
  fs.writeFileSync(planPath, `${canonicalJsonV2(project.plan)}\n`);
  const requestPath = path.join(sidecarRoot, "request.v1.json");
  fs.writeFileSync(requestPath, `${canonicalJsonV2(request)}\n`);
  fs.mkdirSync(path.join(project.root, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(project.root, "node_modules/ignored-secret.txt"), "IGNORED_SECRET_MUST_NOT_MOUNT\n");
  const sourceArchivePath = path.join(sidecarRoot, "source.tar");
  createProjectSandboxSourceArchiveV1({ repositoryRoot: project.root, expectedRequest: request, outputPath: sourceArchivePath });
  const outputRoot = path.join(sidecarRoot, "output");
  const anotherEmptyOutput = path.join(sidecarRoot, "empty-output");
  fs.mkdirSync(outputRoot);
  fs.mkdirSync(anotherEmptyOutput);
  const dockerExecutable = path.join(sidecarRoot, "docker");
  fs.writeFileSync(dockerExecutable, "#!/bin/false\n", { mode: 0o700 });
  const dockerSha256 = sha256Bytes(fs.readFileSync(dockerExecutable));
  const runtimeDigest = digest("runtime-image");
  const launcherDigest = digest("launcher-binary");
  const profile = {
    schemaVersion: "1.0.0",
    kind: "programmable-project-sandbox-host-profile",
    profileId: "docker-networkless-test",
    authoritySubject,
    adapter: { kind: "docker-cli", binarySha256: dockerSha256 },
    launcher: {
      id: "programmable-sandbox-launcher",
      version: "1.0.0",
      binarySha256: launcherDigest,
      entrypoint: ["node", "/opt/programmable/sandbox-launcher.mjs"]
    },
    runtime: {
      id: "programmable-node-foundry-runtime",
      version: "1.0.0",
      imageReference: `example.invalid/programmable/runner@${runtimeDigest}`,
      imageSha256: runtimeDigest,
      isolation: "container-separate-user",
      user: { uid: 65532, gid: 65532 }
    },
    policy: {
      filesystem: {
        sourceMount: "/input/source.tar",
        requestMount: "/request/request.v1.json",
        planMount: "/request/repository-plan.v1.json",
        outputMount: "/output",
        workspaceMount: "/workspace",
        temporaryMount: "/tmp"
      },
      network: { mode: "forbidden", allowlist: [] },
      secrets: { inherit: false, mounts: [] },
      externalWrites: { allowed: false },
      process: { init: true, pidsLimit: 256 }
    },
    limits: {
      memoryBytes: 2 * 1024 * 1024 * 1024,
      cpus: 2,
      workspaceBytes: 2 * 1024 * 1024 * 1024,
      temporaryBytes: 256 * 1024 * 1024,
      maximumOutputBytes: 128 * 1024 * 1024
    }
  };
  const invocation = createDockerSandboxInvocationV1({
    profile,
    expectedRequest: request,
    repositoryRoot: project.root,
    sourceArchivePath,
    requestPath,
    outputRoot,
    planPath,
    dockerExecutable
  });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const outputBytes = Buffer.from("completed plan fixture\n", "utf8");
  const outputRelativePath = ".programmable/repository-plan.v1.json";
  const receipt = signedReceipt({ request, profile, privateKey, outputRelativePath, outputBytes });
  const attestationPayload = claimedHostAttestationPayload({ receipt, profile, invocation });
  const attestation = rawSignAttestation(attestationPayload, privateKey);
  const trustRoot = trustRootFor(publicKey, profile);
  return {
    project, request, sidecarRoot, planPath, requestPath, sourceArchivePath, outputRoot, anotherEmptyOutput,
    profile, invocation, receipt, attestation, trustRoot, privateKey, outputBytes,
    inspectionInput: {
      receipt,
      expectedRequest: request,
      attestation,
      trustRoot,
      profile,
      expectedSubject: authoritySubject,
      expectedInvocation: invocation
    }
  };
}

function claimedHostAttestationPayload({ receipt, profile, invocation }) {
  const digests = sandboxHostPolicyDigestsV1(profile);
  return {
    status: "claimed-completed",
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
        writesObservedSha256: digest("opaque-writes-claim")
      },
      network: { mode: "forbidden", allowlistSha256: null, accessObserved: false },
      secrets: { inherited: false, mounted: false, environmentKeysSha256: digests.environmentKeysSha256 },
      externalWrites: { allowed: false, performed: false },
      process: {
        init: true,
        pidsLimit: profile.policy.process.pidsLimit,
        containerIdSha256: digest("opaque-container-claim"),
        runnerExitCode: 0,
        containerExitCode: 0,
        containerRemoved: true,
        postRemovalState: "absent",
        descendantsRemaining: 0,
        teardownObservationSha256: digest("opaque-teardown-claim")
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
  };
}

function trustRootFor(publicKey, profile) {
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-project-sandbox-trust-root",
    rootId: "caller-supplied-test-keys",
    authorities: [{
      subject: authoritySubject,
      keyId: authorityKeyId,
      status: "active",
      algorithm: "ed25519",
      publicKeySpkiBase64: publicDer.toString("base64"),
      publicKeySha256: sha256Bytes(publicDer),
      profileSha256: sandboxHostProfileSha256V1(profile),
      launcher: { id: profile.launcher.id, binarySha256: profile.launcher.binarySha256 },
      runtime: { id: profile.runtime.id, imageSha256: profile.runtime.imageSha256, isolation: profile.runtime.isolation }
    }]
  };
}

function signedReceipt({ request, profile, privateKey, outputRelativePath, outputBytes }) {
  const policyDigests = sandboxHostPolicyDigestsV1(profile);
  const commands = request.commands.map((command) => ({
    id: command.id,
    commandSha256: command.commandSha256,
    argvSha256: command.argvSha256,
    status: "passed",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputExceeded: false,
    stdoutSha256: digest(`${command.id}:stdout`),
    stdoutByteLength: Buffer.byteLength(`${command.id}:stdout`),
    stderrSha256: sha256Bytes(Buffer.alloc(0)),
    stderrByteLength: 0,
    networkAccessed: false,
    externalWritesPerformed: false,
    filesystemWritesSha256: digest(`${command.id}:writes`)
  }));
  const outputArtifacts = [{
    id: "completed-repository-plan",
    kind: "repository-plan",
    path: outputRelativePath,
    sha256: sha256Bytes(outputBytes),
    byteLength: outputBytes.length
  }];
  const payload = {
    status: "completed",
    request,
    launcher: {
      id: profile.launcher.id,
      version: profile.launcher.version,
      binarySha256: profile.launcher.binarySha256,
      configurationSha256: sandboxHostProfileSha256V1(profile)
    },
    runtime: {
      id: profile.runtime.id,
      version: profile.runtime.version,
      imageSha256: profile.runtime.imageSha256,
      isolation: profile.runtime.isolation
    },
    policy: {
      filesystem: {
        enforced: true,
        sourceReadOnly: true,
        disposableWorkspace: true,
        writeScope: "disposable-output-only",
        allowedPathsSha256: policyDigests.allowedPathsSha256,
        deniedPathsSha256: policyDigests.deniedPathsSha256
      },
      network: { enforced: true, mode: "forbidden", allowlistSha256: null },
      secrets: { enforced: true, inherited: false, mounted: false },
      externalWrites: { enforced: true, allowed: false },
      process: { descendantsReaped: true }
    },
    commands,
    result: {
      executionCompleted: true,
      commandsSha256: canonicalJsonSha256V2(commands),
      outputArtifacts,
      outputArtifactsSha256: canonicalJsonSha256V2(outputArtifacts)
    }
  };
  const receipt = {
    schemaVersion: "1.0.0",
    kind: "programmable-project-external-sandbox-receipt",
    payload,
    payloadSha256: canonicalJsonSha256V2(payload),
    signature: { algorithm: "ed25519", keyId: authorityKeyId, value: "" }
  };
  return resignReceipt(receipt, privateKey);
}

function mutateAndResignReceipt(receipt, privateKey, mutate) {
  const copy = structuredClone(receipt);
  mutate(copy);
  copy.payload.result.commandsSha256 = canonicalJsonSha256V2(copy.payload.commands);
  return resignReceipt(copy, privateKey);
}

function resignReceipt(receipt, privateKey) {
  const copy = structuredClone(receipt);
  copy.payloadSha256 = canonicalJsonSha256V2(copy.payload);
  copy.signature.value = crypto.sign(null, Buffer.from(canonicalJsonV2(copy.payload), "utf8"), privateKey).toString("base64");
  return copy;
}

function rawSignAttestation(payload, privateKey) {
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-project-sandbox-host-attestation",
    payload,
    payloadSha256: canonicalJsonSha256V2(payload),
    signature: {
      algorithm: "ed25519",
      keyId: authorityKeyId,
      value: crypto.sign(null, Buffer.from(canonicalJsonV2(payload), "utf8"), privateKey).toString("base64")
    }
  };
}

function digest(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function assertUnsupportedSourceTree(t, project, archiveName, expectedMode) {
  const source = inspectCleanProjectSource(project.root);
  const request = createProjectSandboxRequestV1({ repositoryPlan: project.plan, source });
  const sidecarRoot = fs.mkdtempSync(path.join(os.tmpdir(), `programmable-sandbox-${archiveName}-`));
  t.after(() => fs.rmSync(sidecarRoot, { recursive: true, force: true }));
  const outputPath = path.join(sidecarRoot, "source.tar");
  assert.throws(
    () => createProjectSandboxSourceArchiveV1({
      repositoryRoot: project.root,
      expectedRequest: request,
      outputPath
    }),
    ({ code, mode }) => (
      code === "PROJECT_SANDBOX_SOURCE_TREE_ENTRY_UNSUPPORTED"
      && mode === expectedMode
    )
  );
  assert.equal(fs.existsSync(outputPath), false);
}

function parseTarEntries(bytes) {
  const entries = new Map();
  let offset = 0;
  let paxPath = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const type = String.fromCharCode(header[156] || 0x30);
    const size = Number.parseInt(tarString(header.subarray(124, 136)).trim() || "0", 8);
    const mode = Number.parseInt(tarString(header.subarray(100, 108)).trim() || "0", 8);
    const uid = Number.parseInt(tarString(header.subarray(108, 116)).trim() || "0", 8);
    const gid = Number.parseInt(tarString(header.subarray(116, 124)).trim() || "0", 8);
    const mtime = Number.parseInt(tarString(header.subarray(136, 148)).trim() || "0", 8);
    const recordedChecksum = Number.parseInt(tarString(header.subarray(148, 156)).trim() || "0", 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    assert.equal(checksumHeader.reduce((sum, byte) => sum + byte, 0), recordedChecksum, "valid tar header checksum");
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    assert.ok(Number.isSafeInteger(size) && size >= 0 && bodyEnd <= bytes.length, "valid bounded tar entry");
    const body = Buffer.from(bytes.subarray(bodyStart, bodyEnd));
    offset = bodyStart + Math.ceil(size / 512) * 512;
    if (type === "x") {
      paxPath = parsePaxPath(body);
      continue;
    }
    const headerPath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const entryPath = paxPath ?? headerPath;
    paxPath = null;
    if (type === "0" || type === "\0") entries.set(entryPath, { bytes: body, mode, uid, gid, mtime, type });
  }
  return entries;
}

function parsePaxPath(bytes) {
  let offset = 0;
  let pathValue = null;
  while (offset < bytes.length) {
    const separator = bytes.indexOf(0x20, offset);
    assert.ok(separator > offset, "valid PAX length separator");
    const length = Number.parseInt(bytes.subarray(offset, separator).toString("ascii"), 10);
    assert.ok(Number.isSafeInteger(length) && length > 0 && offset + length <= bytes.length, "valid PAX record length");
    const record = bytes.subarray(separator + 1, offset + length - 1).toString("utf8");
    if (record.startsWith("path=")) pathValue = record.slice("path=".length);
    offset += length;
  }
  assert.equal(typeof pathValue, "string");
  return pathValue;
}

function tarString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}
