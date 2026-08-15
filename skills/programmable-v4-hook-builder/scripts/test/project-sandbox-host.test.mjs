import test from "node:test";

import {
  assert, crypto, fs, os, path,
  canonicalJsonSha256V2, canonicalJsonV2,
  createMaterializedRepository, executeProjectCommands, sha256Bytes
} from "./project-compiler-fixture.mjs";
import { inspectCleanProjectSource } from "../project-command-executor-core.mjs";
import { createProjectSandboxRequestV1 } from "../project-sandbox-receipt-core.mjs";
import {
  createDockerSandboxInvocationV1,
  createProjectSandboxSourceArchiveV1,
  projectSandboxHostAttestationPayloadV1,
  sandboxHostPolicyDigestsV1,
  sandboxHostProfileSha256V1,
  signProjectSandboxHostAttestationV1,
  validateProjectSandboxHostAttestationV1,
  validateProjectSandboxHostProfileV1,
  validateProjectSandboxTrustRootV1,
  verifyProjectSandboxHostCompletionV1
} from "../project-sandbox-host-core.mjs";

const authoritySubject = "urn:programmable:sandbox:test-authority";
const authorityKeyId = "test-sandbox-authority-v1";

test("Docker host contract plans only a pinned, non-root, networkless, secretless, bounded invocation", (t) => {
  const fixture = hostFixture(t);
  assert.deepEqual(validateProjectSandboxHostProfileV1(fixture.profile), []);
  const { argv, evidenceBoundary } = fixture.invocation;
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
});

test("independent Ed25519 trust root verifies exact request, invocation, policy, outputs, and teardown", (t) => {
  const fixture = hostFixture(t);
  const verified = verifyProjectSandboxHostCompletionV1(fixture.verificationInput);
  assert.equal(verified.status, "PROJECT_SANDBOX_HOST_COMPLETION_VERIFIED");
  assert.equal(verified.authority.subject, authoritySubject);
  assert.equal(verified.executionCompleted, true);
  assert.equal(verified.networkAccessed, false);
  assert.equal(verified.externalWritesPerformed, false);
  assert.equal(verified.descendantsRemaining, 0);
  assert.equal(verified.outputArtifactCount, 1);
  assert.deepEqual(verified.evidenceBoundary, {
    approvalCreated: false,
    auditClaimed: false,
    deploymentClaimed: false,
    productionClaimed: false,
    externalActionsPerformed: []
  });
  assert.deepEqual(validateProjectSandboxTrustRootV1(fixture.trustRoot), []);
  assert.deepEqual(validateProjectSandboxHostAttestationV1(fixture.attestation), []);
});

test("host verifier rejects untrusted, self-signed, wrong-subject, drifted, network, write, and process-leak evidence", (t) => {
  const fixture = hostFixture(t);
  const verify = (overrides = {}) => verifyProjectSandboxHostCompletionV1({ ...fixture.verificationInput, ...overrides });

  assert.throws(
    () => verify({ trustRoot: { ...fixture.trustRoot, authorities: [] } }),
    ({ code }) => code === "PROJECT_SANDBOX_AUTHORITY_UNTRUSTED"
  );
  assert.throws(
    () => verify({ expectedSubject: "urn:programmable:sandbox:wrong-authority" }),
    ({ code }) => code === "PROJECT_SANDBOX_AUTHORITY_SUBJECT_MISMATCH"
  );

  const alternate = crypto.generateKeyPairSync("ed25519");
  const selfSignedReceipt = resignReceipt(fixture.receipt, alternate.privateKey);
  const selfSignedPayload = projectSandboxHostAttestationPayloadV1({
    authoritySubject,
    receipt: selfSignedReceipt,
    profile: fixture.profile,
    invocation: fixture.invocation,
    writesObservedSha256: digest("writes"),
    containerIdSha256: digest("container"),
    teardownObservationSha256: digest("teardown")
  });
  const selfSignedAttestation = signProjectSandboxHostAttestationV1({
    payload: selfSignedPayload,
    keyId: authorityKeyId,
    privateKey: alternate.privateKey
  });
  assert.throws(
    () => verify({ receipt: selfSignedReceipt, attestation: selfSignedAttestation }),
    ({ code }) => code === "PROJECT_SANDBOX_SIGNATURE_INVALID"
  );

  fs.writeFileSync(fixture.outputPath, "drifted output\n");
  assert.throws(() => verify(), ({ code }) => code === "PROJECT_SANDBOX_OUTPUT_DRIFT");
  fs.writeFileSync(fixture.outputPath, fixture.outputBytes);

  const unexpectedOutput = path.join(fixture.outputRoot, "unreceipted-output.txt");
  fs.writeFileSync(unexpectedOutput, "not in the signed inventory\n");
  assert.throws(() => verify(), ({ code }) => code === "PROJECT_SANDBOX_OUTPUT_DRIFT");
  fs.unlinkSync(unexpectedOutput);

  const networkReceipt = mutateAndResignReceipt(fixture.receipt, fixture.privateKey, (receipt) => {
    receipt.payload.commands[0].networkAccessed = true;
  });
  assert.throws(
    () => verify({ receipt: networkReceipt }),
    ({ code }) => code === "PROJECT_SANDBOX_NETWORK_POLICY_VIOLATED"
  );

  const networkedInvocation = structuredClone(fixture.invocation);
  networkedInvocation.argv[networkedInvocation.argv.indexOf("--network") + 1] = "bridge";
  networkedInvocation.argvSha256 = canonicalJsonSha256V2(networkedInvocation.argv);
  const { invocationSha256: _invocationDigest, ...networkedInvocationPayload } = networkedInvocation;
  networkedInvocation.invocationSha256 = canonicalJsonSha256V2(networkedInvocationPayload);
  assert.throws(
    () => verify({ expectedInvocation: networkedInvocation }),
    ({ code }) => code === "PROJECT_SANDBOX_HOST_INVOCATION_INVALID"
  );

  const writeReceipt = mutateAndResignReceipt(fixture.receipt, fixture.privateKey, (receipt) => {
    receipt.payload.commands[0].externalWritesPerformed = true;
  });
  assert.throws(
    () => verify({ receipt: writeReceipt }),
    ({ code }) => ["PROJECT_SANDBOX_COMMAND_RESULT_INVALID", "PROJECT_SANDBOX_EXTERNAL_WRITE_POLICY_VIOLATED"].includes(code)
  );

  const leakedPayload = structuredClone(fixture.attestation.payload);
  leakedPayload.enforcement.process.descendantsRemaining = 1;
  const leakedAttestation = rawSignAttestation(leakedPayload, fixture.privateKey);
  assert.ok(validateProjectSandboxHostAttestationV1(leakedAttestation).some(({ code }) => code === "PROJECT_SANDBOX_HOST_ATTESTATION_INVALID"));
  assert.throws(
    () => verify({ attestation: leakedAttestation }),
    ({ code }) => code === "PROJECT_SANDBOX_HOST_ATTESTATION_INVALID"
  );

  const driftedRequest = structuredClone(fixture.request);
  driftedRequest.applicationId = "drifted-application";
  const { requestSha256: _digest, ...requestPayload } = driftedRequest;
  driftedRequest.requestSha256 = canonicalJsonSha256V2(requestPayload);
  assert.throws(
    () => verify({ expectedRequest: driftedRequest }),
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
  const outputPath = path.join(outputRoot, outputRelativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputBytes);
  const receipt = signedReceipt({ request, profile, privateKey, outputRelativePath, outputBytes });
  const attestationPayload = projectSandboxHostAttestationPayloadV1({
    authoritySubject,
    receipt,
    profile,
    invocation,
    writesObservedSha256: digest("writes"),
    containerIdSha256: digest("container"),
    teardownObservationSha256: digest("teardown")
  });
  const attestation = signProjectSandboxHostAttestationV1({ payload: attestationPayload, keyId: authorityKeyId, privateKey });
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const trustRoot = {
    schemaVersion: "1.0.0",
    kind: "programmable-project-sandbox-trust-root",
    rootId: "independent-test-root",
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
  return {
    project, request, sidecarRoot, planPath, requestPath, sourceArchivePath, outputRoot, anotherEmptyOutput,
    profile, invocation, receipt, attestation, trustRoot, privateKey, outputPath, outputBytes,
    verificationInput: {
      receipt,
      expectedRequest: request,
      attestation,
      trustRoot,
      profile,
      expectedSubject: authoritySubject,
      expectedInvocation: invocation,
      outputRoot
    }
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
