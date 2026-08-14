import test from "node:test";

import {
  assert, childProcess, crypto, fs, path, process,
  canonicalJsonSha256V2, canonicalJsonV2, sha256Bytes,
  createMaterializedRepository, unifiedCli
} from "./project-compiler-fixture.mjs";
import { inspectCleanProjectSource } from "../project-command-executor-core.mjs";
import { createProjectSandboxRequestV1 } from "../project-sandbox-receipt-core.mjs";
import {
  diagnoseProjectRepairAttemptV1,
  validateProjectRepairAttemptV1,
  verifyProjectRepairAttemptV1
} from "../project-repair-attempt-core.mjs";

const EMPTY_SHA256 = sha256Bytes(Buffer.alloc(0));

function createFixture(t) {
  const fixture = createMaterializedRepository(t);
  const source = inspectCleanProjectSource(fixture.root);
  const request = createProjectSandboxRequestV1({ repositoryPlan: fixture.plan, source });
  return { ...fixture, source, request };
}

function signedAttempt(request, privateKey, {
  attemptNumber = 1,
  previousAttemptPayloadSha256 = null,
  rootIndex = 1,
  rootStatus = "failed",
  root = {},
  sessionId = "repair-session-v1",
  keyId = "independent-sandbox-authority-v1"
} = {}) {
  const commands = request.commands.map((command, index) => {
    const shared = {
      id: command.id,
      commandSha256: command.commandSha256,
      argvSha256: command.argvSha256,
      signal: null,
      timedOut: false,
      outputExceeded: false,
      stdoutSha256: EMPTY_SHA256,
      stdoutByteLength: 0,
      stderrSha256: EMPTY_SHA256,
      stderrByteLength: 0,
      networkAccessed: false,
      externalWritesPerformed: false,
      filesystemWritesSha256: EMPTY_SHA256
    };
    if (index < rootIndex) return { ...shared, status: "passed", exitCode: 0 };
    if (index > rootIndex) return { ...shared, status: "not-run", exitCode: null };
    const defaultRoot = rootStatus === "tooling-blocked"
      ? { status: rootStatus, exitCode: null, stderrSha256: sha256Bytes(Buffer.from("tool unavailable\n")), stderrByteLength: 17 }
      : { status: rootStatus, exitCode: 1, stderrSha256: sha256Bytes(Buffer.from("command failed\n")), stderrByteLength: 15 };
    return { ...shared, ...defaultRoot, ...root };
  });
  const payload = {
    status: rootStatus,
    sessionId,
    attemptNumber,
    previousAttemptPayloadSha256,
    request,
    launcher: {
      id: "programmable-external-launcher",
      version: "1.0.0",
      binarySha256: sha256Bytes(Buffer.from("launcher-binary")),
      configurationSha256: sha256Bytes(Buffer.from("launcher-config"))
    },
    runtime: {
      id: "programmable-sandbox-runtime",
      version: "1.0.0",
      imageSha256: sha256Bytes(Buffer.from("runtime-image")),
      isolation: "remote-vm"
    },
    policy: {
      filesystem: {
        enforced: true,
        sourceReadOnly: true,
        disposableWorkspace: true,
        writeScope: "disposable-output-only",
        allowedPathsSha256: sha256Bytes(Buffer.from("allowed-paths")),
        deniedPathsSha256: sha256Bytes(Buffer.from("denied-paths"))
      },
      network: { enforced: true, mode: "forbidden", allowlistSha256: null },
      secrets: { enforced: true, inherited: false, mounted: false },
      externalWrites: { enforced: true, allowed: false },
      process: { descendantsReaped: true }
    },
    commands,
    result: {
      executionCompleted: false,
      rootCommandId: request.commands[rootIndex].id,
      rootStatus,
      commandsSha256: canonicalJsonSha256V2(commands),
      suppressedCommandIds: request.commands.slice(rootIndex + 1).map(({ id }) => id),
      completionEligible: false,
      approvalEligible: false,
      preflightUnlock: false
    },
    authorization: {
      completion: false,
      approval: false,
      audit: false,
      deployment: false,
      publication: false,
      submission: false,
      registryWrite: false,
      externalWrites: false
    }
  };
  return signPayload(payload, privateKey, keyId);
}

function signPayload(payload, privateKey, keyId = "independent-sandbox-authority-v1") {
  return {
    schemaVersion: "1.0.0",
    kind: "programmable-project-repair-attempt",
    payload,
    payloadSha256: canonicalJsonSha256V2(payload),
    signature: {
      algorithm: "ed25519",
      keyId,
      value: crypto.sign(null, Buffer.from(canonicalJsonV2(payload), "utf8"), privateKey).toString("base64")
    }
  };
}

function resign(attempt, privateKey) {
  return signPayload(structuredClone(attempt.payload), privateKey, attempt.signature.keyId);
}

test("a signed failed attempt preserves one root and suppresses every dependent command", (t) => {
  const fixture = createFixture(t);
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const attempt = signedAttempt(fixture.request, privateKey);

  assert.deepEqual(validateProjectRepairAttemptV1(attempt), []);
  const report = diagnoseProjectRepairAttemptV1({
    attempt,
    previousAttempts: [],
    expectedRequest: fixture.request
  });
  assert.equal(report.status, "PROJECT_REPAIR_REQUIRED");
  assert.equal(report.root.commandId, "build-command");
  assert.equal(report.root.status, "failed");
  assert.equal(report.root.diagnosis, "COMMAND_FAILURE");
  assert.deepEqual(report.root.suppressedCommandIds, fixture.request.commands.slice(2).map(({ id }) => id));
  assert.deepEqual(report.next.targetedCommandIds, ["build-command"]);
  assert.equal(report.retryPolicy.maximumRepairAttempts, 2);
  assert.equal(report.retryPolicy.blindRetryAllowed, false);
  assert.equal(report.canonicalOutput, false);
  assert.equal(report.evidenceBoundary.completion, "NOT_COMPLETION");
  assert.equal(report.evidenceBoundary.approval, "NOT_APPROVAL");
  assert.equal(report.evidenceBoundary.preflightUnlock, false);
  assert.equal(report.evidenceBoundary.externalWritesPerformed, false);
  assert.equal(report.evidenceBoundary.signaturePresent, true);
  assert.equal(report.evidenceBoundary.signerTrusted, false);
  assert.match(report.reportSha256, /^sha256:[0-9a-f]{64}$/u);
});

test("cascade, multiple roots, all-pass claims, network violations, and external writes fail closed", (t) => {
  const fixture = createFixture(t);
  const { privateKey } = crypto.generateKeyPairSync("ed25519");

  const cascade = signedAttempt(fixture.request, privateKey);
  cascade.payload.commands[2].status = "passed";
  cascade.payload.commands[2].exitCode = 0;
  cascade.payload.result.commandsSha256 = canonicalJsonSha256V2(cascade.payload.commands);
  assert.ok(validateProjectRepairAttemptV1(resign(cascade, privateKey)).some(({ code }) => code === "PROJECT_REPAIR_CASCADE_FORBIDDEN"));

  const multiple = signedAttempt(fixture.request, privateKey);
  multiple.payload.commands[2].status = "failed";
  multiple.payload.commands[2].exitCode = 1;
  multiple.payload.result.commandsSha256 = canonicalJsonSha256V2(multiple.payload.commands);
  assert.ok(validateProjectRepairAttemptV1(resign(multiple, privateKey)).some(({ code }) => code === "PROJECT_REPAIR_ROOT_COUNT_INVALID"));

  const allPass = signedAttempt(fixture.request, privateKey);
  for (const command of allPass.payload.commands) {
    command.status = "passed";
    command.exitCode = 0;
  }
  allPass.payload.result.commandsSha256 = canonicalJsonSha256V2(allPass.payload.commands);
  assert.ok(validateProjectRepairAttemptV1(resign(allPass, privateKey)).some(({ code }) => code === "PROJECT_REPAIR_ATTEMPT_HAS_NO_FAILURE"));

  const network = signedAttempt(fixture.request, privateKey);
  network.payload.commands[1].networkAccessed = true;
  network.payload.result.commandsSha256 = canonicalJsonSha256V2(network.payload.commands);
  assert.ok(validateProjectRepairAttemptV1(resign(network, privateKey)).some(({ code }) => code === "PROJECT_REPAIR_NETWORK_POLICY_VIOLATED"));

  const write = signedAttempt(fixture.request, privateKey);
  write.payload.commands[1].externalWritesPerformed = true;
  write.payload.result.commandsSha256 = canonicalJsonSha256V2(write.payload.commands);
  assert.ok(validateProjectRepairAttemptV1(resign(write, privateKey)).some(({ code }) => code === "PROJECT_REPAIR_EXTERNAL_WRITE_OBSERVED"));
});

test("retry policy permits one blind timeout or signal retry and preserves every earlier failure", (t) => {
  const fixture = createFixture(t);
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const first = signedAttempt(fixture.request, privateKey, {
    root: { status: "failed", exitCode: null, timedOut: true, stderrSha256: EMPTY_SHA256, stderrByteLength: 0 }
  });
  const firstReport = diagnoseProjectRepairAttemptV1({ attempt: first, previousAttempts: [], expectedRequest: fixture.request });
  assert.equal(firstReport.root.diagnosis, "TIMEOUT");
  assert.equal(firstReport.retryPolicy.blindRetryAllowed, true);

  const changedBeforeBlindRetry = structuredClone(fixture.request);
  changedBeforeBlindRetry.source.headCommit = "a".repeat(40);
  changedBeforeBlindRetry.source.tree = "b".repeat(40);
  changedBeforeBlindRetry.executionPlanSha256 = sha256Bytes(Buffer.from("changed-before-blind-retry"));
  const { requestSha256: _changedBeforeBlindRetrySha256, ...changedBeforeBlindRetryPayload } = changedBeforeBlindRetry;
  changedBeforeBlindRetry.requestSha256 = canonicalJsonSha256V2(changedBeforeBlindRetryPayload);
  const changedSecond = signedAttempt(changedBeforeBlindRetry, privateKey, {
    attemptNumber: 2,
    previousAttemptPayloadSha256: first.payloadSha256
  });
  assert.throws(
    () => diagnoseProjectRepairAttemptV1({
      attempt: changedSecond,
      previousAttempts: [first],
      expectedRequest: changedBeforeBlindRetry
    }),
    ({ code }) => code === "PROJECT_REPAIR_HISTORY_INVALID"
  );

  const second = signedAttempt(fixture.request, privateKey, {
    attemptNumber: 2,
    previousAttemptPayloadSha256: first.payloadSha256,
    rootIndex: 2,
    root: { status: "failed", exitCode: null, signal: "SIGTERM", stderrSha256: EMPTY_SHA256, stderrByteLength: 0 }
  });
  const secondReport = diagnoseProjectRepairAttemptV1({ attempt: second, previousAttempts: [first], expectedRequest: fixture.request });
  assert.equal(secondReport.root.diagnosis, "SIGNAL");
  assert.equal(secondReport.retryPolicy.blindRetryAllowed, false);
  assert.equal(secondReport.attemptHistory.failureCount, 2);
  assert.equal(secondReport.attemptHistory.earlierFailuresPreserved, true);

  const repairedRequest = structuredClone(fixture.request);
  repairedRequest.source.headCommit = "c".repeat(40);
  repairedRequest.source.tree = "d".repeat(40);
  repairedRequest.executionPlanSha256 = sha256Bytes(Buffer.from("changed-after-blind-retry"));
  const { requestSha256: _repairedRequestSha256, ...repairedRequestPayload } = repairedRequest;
  repairedRequest.requestSha256 = canonicalJsonSha256V2(repairedRequestPayload);
  const third = signedAttempt(repairedRequest, privateKey, {
    attemptNumber: 3,
    previousAttemptPayloadSha256: second.payloadSha256
  });
  const thirdReport = diagnoseProjectRepairAttemptV1({ attempt: third, previousAttempts: [first, second], expectedRequest: repairedRequest });
  assert.equal(thirdReport.status, "PROJECT_REPAIR_BUDGET_EXHAUSTED");
  assert.equal(thirdReport.retryPolicy.repairAttemptsRemaining, 0);
  assert.deepEqual(thirdReport.next.targetedCommandIds, []);
  assert.equal(thirdReport.attemptHistory.failureCount, 3);
});

test("repair history cannot switch branch or command plan within one application revision", (t) => {
  const fixture = createFixture(t);
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const first = signedAttempt(fixture.request, privateKey);
  const mutations = [
    (request) => { request.source.branch = "unrelated-repair-branch"; },
    (request) => {
      request.commands[0].commandSha256 = sha256Bytes(Buffer.from("unrelated-command"));
      request.commandsSha256 = sha256Bytes(Buffer.from("unrelated-command-plan"));
    }
  ];
  for (const mutate of mutations) {
    const driftedRequest = structuredClone(fixture.request);
    mutate(driftedRequest);
    const { requestSha256: _requestSha256, ...requestPayload } = driftedRequest;
    driftedRequest.requestSha256 = canonicalJsonSha256V2(requestPayload);
    const second = signedAttempt(driftedRequest, privateKey, {
      attemptNumber: 2,
      previousAttemptPayloadSha256: first.payloadSha256
    });

    assert.throws(
      () => diagnoseProjectRepairAttemptV1({
        attempt: second,
        previousAttempts: [first],
        expectedRequest: driftedRequest
      }),
      ({ code }) => code === "PROJECT_REPAIR_HISTORY_INVALID"
    );
  }
});

test("tooling-blocked history requires an unchanged source request before source repair", (t) => {
  const fixture = createFixture(t);
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const first = signedAttempt(fixture.request, privateKey, { rootStatus: "tooling-blocked" });
  const changedSourceRequest = structuredClone(fixture.request);
  changedSourceRequest.source.headCommit = "a".repeat(40);
  changedSourceRequest.source.tree = "b".repeat(40);
  changedSourceRequest.executionPlanSha256 = sha256Bytes(Buffer.from("changed-source-plan"));
  const { requestSha256: _requestSha256, ...requestPayload } = changedSourceRequest;
  changedSourceRequest.requestSha256 = canonicalJsonSha256V2(requestPayload);
  const second = signedAttempt(changedSourceRequest, privateKey, {
    attemptNumber: 2,
    previousAttemptPayloadSha256: first.payloadSha256
  });

  assert.throws(
    () => diagnoseProjectRepairAttemptV1({
      attempt: second,
      previousAttempts: [first],
      expectedRequest: changedSourceRequest
    }),
    ({ code }) => code === "PROJECT_REPAIR_HISTORY_INVALID"
  );
});

test("tooling blocks source repair and the portable trust root rejects caller authority injection", (t) => {
  const fixture = createFixture(t);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const attempt = signedAttempt(fixture.request, privateKey, { rootStatus: "tooling-blocked" });
  const report = diagnoseProjectRepairAttemptV1({ attempt, previousAttempts: [], expectedRequest: fixture.request });
  assert.equal(report.status, "PROJECT_TOOLING_PREREQUISITE_REQUIRED");
  assert.equal(report.root.diagnosis, "TOOLING_PREREQUISITE");
  assert.equal(report.next.sourceChangeAllowed, false);
  assert.equal(report.retryPolicy.blindRetryAllowed, false);

  assert.throws(
    () => verifyProjectRepairAttemptV1({ attempt, expectedRequest: fixture.request }),
    ({ code }) => code === "PROJECT_REPAIR_AUTHORITY_UNTRUSTED"
  );
  const callerKey = publicKey.export({ type: "spki", format: "pem" });
  assert.throws(
    () => verifyProjectRepairAttemptV1({ attempt, expectedRequest: fixture.request, trustedPublicKey: callerKey }),
    ({ code }) => code === "PROJECT_REPAIR_VERIFICATION_INPUT_INVALID"
  );
});

test("project diagnose is read-only, deterministic, bound to the clean subject, and brief stays below 2499 bytes", (t) => {
  const legacy = createMaterializedRepository(t, {
    extraFiles: [[".gitignore", "node_modules/\n.programmable/repository-plan.materializing.v1.json\n"]]
  });
  const source = inspectCleanProjectSource(legacy.root);
  const fixture = { ...legacy, source, request: createProjectSandboxRequestV1({ repositoryPlan: legacy.plan, source }) };
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const attempt = signedAttempt(fixture.request, privateKey);
  const sidecarRoot = fs.mkdtempSync(path.join(path.dirname(fixture.root), "programmable-project-repair-sidecar-"));
  t.after(() => fs.rmSync(sidecarRoot, { recursive: true, force: true }));
  const attemptPath = path.join(sidecarRoot, "project-repair-attempt-1.v1.json");
  fs.mkdirSync(path.join(fixture.root, ".programmable"), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, ".programmable/repository-plan.materializing.v1.json"), `${canonicalJsonV2(fixture.plan)}\n`);
  fs.writeFileSync(attemptPath, `${canonicalJsonV2(attempt)}\n`);
  const before = childProcess.spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: fixture.root, encoding: "utf8", shell: false });
  assert.equal(before.status, 0);
  assert.equal(before.stdout, "");

  const args = [
    unifiedCli, "project", "diagnose", "--brief",
    "--repository-root", fixture.root,
    "--plan", ".programmable/repository-plan.materializing.v1.json",
    "--attempt", attemptPath
  ];
  const first = childProcess.spawnSync(process.execPath, args, { encoding: "utf8", shell: false });
  const second = childProcess.spawnSync(process.execPath, args, { encoding: "utf8", shell: false });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  assert.ok(Buffer.byteLength(first.stdout, "utf8") < 2_499, Buffer.byteLength(first.stdout, "utf8"));
  const report = JSON.parse(first.stdout);
  assert.equal(report.status, "PROJECT_REPAIR_REQUIRED");
  assert.equal(report.root.commandId, "build-command");
  assert.equal(report.evidenceBoundary.completion, "NOT_COMPLETION");
  assert.equal(report.evidenceBoundary.approval, "NOT_APPROVAL");
  assert.equal(report.evidenceBoundary.preflightUnlock, false);

  const linkedAttemptPath = path.join(sidecarRoot, "linked-attempt.v1.json");
  fs.symlinkSync(attemptPath, linkedAttemptPath);
  const linked = childProcess.spawnSync(process.execPath, [...args.slice(0, -1), linkedAttemptPath], { encoding: "utf8", shell: false });
  assert.equal(linked.status, 2);
  assert.match(linked.stderr, /PROJECT_REPAIR_INPUT_INVALID/u);

  const after = childProcess.spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: fixture.root, encoding: "utf8", shell: false });
  assert.equal(after.status, 0);
  assert.equal(after.stdout, before.stdout);
});
