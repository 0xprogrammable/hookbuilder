import test from "node:test";

import {
  assert, crypto, fs, path, process,
  canonicalJsonSha256V2, canonicalJsonV2,
  executeProjectCommands, sha256Bytes,
  createMaterializedRepository
} from "./project-compiler-fixture.mjs";
import { inspectCleanProjectSource } from "../../skills/programmable-v4-hook-builder/scripts/project-command-executor-core.mjs";
import {
  createProjectSandboxRequestV1,
  validateProjectSandboxReceiptV1,
  verifyProjectSandboxReceiptV1
} from "../../skills/programmable-v4-hook-builder/scripts/project-sandbox-receipt-core.mjs";

function signedReceipt(request, privateKey, keyId = "independent-sandbox-authority-v1") {
  const commands = request.commands.map((command) => ({
    id: command.id,
    commandSha256: command.commandSha256,
    argvSha256: command.argvSha256,
    status: "passed",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputExceeded: false,
    stdoutSha256: sha256Bytes(Buffer.from(`${command.id}:ok\n`, "utf8")),
    stdoutByteLength: Buffer.byteLength(`${command.id}:ok\n`),
    stderrSha256: sha256Bytes(Buffer.alloc(0)),
    stderrByteLength: 0,
    networkAccessed: false,
    externalWritesPerformed: false,
    filesystemWritesSha256: sha256Bytes(Buffer.from(`${command.id}:disposable-output`, "utf8"))
  }));
  const outputArtifacts = [{
    id: "completed-repository-plan",
    kind: "repository-plan",
    path: ".programmable/repository-plan.v1.json",
    sha256: sha256Bytes(Buffer.from("completed-plan", "utf8")),
    byteLength: Buffer.byteLength("completed-plan")
  }];
  const payload = {
    status: "completed",
    request,
    launcher: {
      id: "programmable-external-launcher",
      version: "1.0.0",
      binarySha256: sha256Bytes(Buffer.from("launcher-binary", "utf8")),
      configurationSha256: sha256Bytes(Buffer.from("launcher-config", "utf8"))
    },
    runtime: {
      id: "programmable-sandbox-runtime",
      version: "1.0.0",
      imageSha256: sha256Bytes(Buffer.from("runtime-image", "utf8")),
      isolation: "remote-vm"
    },
    policy: {
      filesystem: {
        enforced: true,
        sourceReadOnly: true,
        disposableWorkspace: true,
        writeScope: "disposable-output-only",
        allowedPathsSha256: sha256Bytes(Buffer.from("allowed-paths", "utf8")),
        deniedPathsSha256: sha256Bytes(Buffer.from("denied-host-and-secret-paths", "utf8"))
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
  const payloadBytes = Buffer.from(canonicalJsonV2(payload), "utf8");
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-project-external-sandbox-receipt",
    payload,
    payloadSha256: canonicalJsonSha256V2(payload),
    signature: {
      algorithm: "ed25519",
      keyId,
      value: crypto.sign(null, payloadBytes, privateKey).toString("base64")
    }
  };
}

test("portable executor blocks arbitrary Node, Python, shell, cwd escape, and symlink escape without side effects", async (t) => {
  const cases = [
    { id: "node", argv: [process.execPath, "tools/candidate-node.mjs"], expected: "PROJECT_EXTERNAL_SANDBOX_REQUIRED" },
    { id: "python", argv: ["python3", "tools/candidate.py"], expected: "PROJECT_EXTERNAL_SANDBOX_REQUIRED" },
    { id: "shell", argv: ["sh", "tools/candidate.sh"], expected: "PROJECT_COMMAND_SHELL_FORBIDDEN" }
  ];
  for (const entry of cases) {
    const markerName = `${entry.id}-ran`;
    const fixture = createMaterializedRepository(t, {
      extraFiles: [
        ["tools/candidate-node.mjs", `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(markerName)}, "unsafe");\n`],
        ["tools/candidate.py", `open(${JSON.stringify(markerName)}, "w").write("unsafe")\n`],
        ["tools/candidate.sh", `#!/bin/sh\nprintf unsafe > ${markerName}\n`]
      ],
      mutatePlan: (plan) => { plan.commands[0].argv = entry.argv; }
    });
    await assert.rejects(
      executeProjectCommands({ repositoryRoot: fixture.root, repositoryPlan: fixture.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
      ({ code }) => code === entry.expected
    );
    assert.equal(fs.existsSync(path.join(fixture.root, markerName)), false);
  }

  const escaped = createMaterializedRepository(t, { mutatePlan: (plan) => { plan.commands[0].cwd = "../outside"; } });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: escaped.root, repositoryPlan: escaped.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_CWD_INVALID"
  );

  const symlinked = createMaterializedRepository(t, {
    setup: (root, plan) => {
      fs.symlinkSync(path.dirname(root), path.join(root, "outside-link"));
      plan.commands[0].cwd = "outside-link";
    }
  });
  await assert.rejects(
    executeProjectCommands({ repositoryRoot: symlinked.root, repositoryPlan: symlinked.plan, outputPlanPath: ".programmable/repository-plan.v1.json" }),
    ({ code }) => code === "PROJECT_COMMAND_CWD_SYMLINK"
  );
});

test("production receipt verification rejects caller authority injection and remains fail-closed with an empty trust store", async (t) => {
  const fixture = createMaterializedRepository(t);
  const source = inspectCleanProjectSource(fixture.root);
  const request = createProjectSandboxRequestV1({ repositoryPlan: fixture.plan, source });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const receipt = signedReceipt(request, privateKey);
  assert.deepEqual(validateProjectSandboxReceiptV1(receipt), []);

  assert.throws(
    () => verifyProjectSandboxReceiptV1({ receipt, expectedRequest: request }),
    ({ code }) => code === "PROJECT_SANDBOX_AUTHORITY_UNTRUSTED"
  );
  const callerKey = publicKey.export({ type: "spki", format: "pem" });
  for (const forbidden of [
    { trustedPublicKeys: { "independent-sandbox-authority-v1": callerKey } },
    { trustedPublicKey: callerKey },
    { trustedPublicKeyPath: "/tmp/caller-authority.pem" },
    { authorityReportPath: "/tmp/caller-authority.json" }
  ]) {
    assert.throws(
      () => verifyProjectSandboxReceiptV1({ receipt, expectedRequest: request, ...forbidden }),
      ({ code }) => code === "PROJECT_SANDBOX_VERIFICATION_INPUT_INVALID"
    );
  }

  const wrongSubject = structuredClone(request);
  wrongSubject.applicationId = "different-subject";
  assert.throws(
    () => verifyProjectSandboxReceiptV1({
      receipt,
      expectedRequest: wrongSubject
    }),
    ({ code }) => code === "PROJECT_SANDBOX_SUBJECT_MISMATCH"
  );

  const unsigned = structuredClone(receipt);
  delete unsigned.signature;
  assert.ok(validateProjectSandboxReceiptV1(unsigned).some(({ code }) => code === "PROJECT_SANDBOX_RECEIPT_INVALID"));

  const selfSigned = signedReceipt(request, crypto.generateKeyPairSync("ed25519").privateKey, "self-asserted-local-key");
  assert.throws(
    () => verifyProjectSandboxReceiptV1({ receipt: selfSigned, expectedRequest: request }),
    ({ code }) => code === "PROJECT_SANDBOX_AUTHORITY_UNTRUSTED"
  );
});

test("receipt semantics reject policy and output-hash claims even before signature authority", (t) => {
  const fixture = createMaterializedRepository(t);
  const request = createProjectSandboxRequestV1({ repositoryPlan: fixture.plan, source: inspectCleanProjectSource(fixture.root) });
  const { privateKey } = crypto.generateKeyPairSync("ed25519");

  const network = signedReceipt(request, privateKey);
  network.payload.commands[0].networkAccessed = true;
  network.payload.result.commandsSha256 = canonicalJsonSha256V2(network.payload.commands);
  network.payloadSha256 = canonicalJsonSha256V2(network.payload);
  assert.ok(validateProjectSandboxReceiptV1(network).some(({ code }) => code === "PROJECT_SANDBOX_NETWORK_POLICY_VIOLATED"));

  const secrets = signedReceipt(request, privateKey);
  secrets.payload.policy.secrets.inherited = true;
  secrets.payloadSha256 = canonicalJsonSha256V2(secrets.payload);
  assert.ok(validateProjectSandboxReceiptV1(secrets).some(({ code }) => code === "PROJECT_SANDBOX_POLICY_NOT_ENFORCED"));

  const output = signedReceipt(request, privateKey);
  output.payload.result.outputArtifacts[0].sha256 = sha256Bytes(Buffer.from("tampered-output", "utf8"));
  output.payloadSha256 = canonicalJsonSha256V2(output.payload);
  assert.ok(validateProjectSandboxReceiptV1(output).some(({ code }) => code === "PROJECT_SANDBOX_RESULT_MISMATCH"));
});
