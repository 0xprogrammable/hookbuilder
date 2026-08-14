import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { callTool, handleRequest, repositoryRoot, runBoundedProcess, toolDefinitions } from "../server-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(testDirectory, "..", "server.mjs");

test("MCP tool inventory separates read-only planning from digest-bound writes", () => {
  assert.deepEqual(toolDefinitions.map((tool) => tool.name), [
    "programmable_doctor",
    "programmable_discover",
    "programmable_application_validate",
    "programmable_application_status",
    "programmable_application_plan",
    "programmable_application_reconcile",
    "programmable_application_execute"
  ]);
  assert.equal(toolDefinitions.at(-1).annotations.destructiveHint, true);
  assert.equal(toolDefinitions.at(-2).annotations.readOnlyHint, true);
});

test("MCP plan and execute preserve the CLI two-phase confirmation boundary", async () => {
  const seen = [];
  const runCommand = async (argumentsList) => {
    seen.push(argumentsList);
    return { ok: true, argumentsList };
  };
  const common = {
    action: "update",
    packageDirectory: "/tmp/application-v3",
    pullRequest: 123,
    sourceRoots: [{ repositoryRef: "primary", path: "/tmp/source" }]
  };
  await callTool("programmable_application_plan", common, { runCommand });
  await callTool("programmable_application_execute", {
    ...common,
    mutationReceiptPath: "/tmp/application-v3-mutation.json",
    acknowledgeExternalWrite: true,
    confirmationDigest: `sha256:${"a".repeat(64)}`
  }, { runCommand });
  assert.deepEqual(seen[0].slice(-1), ["--dry-run"]);
  assert.deepEqual(seen[1].slice(-4), [
    "--mutation-receipt",
    "/tmp/application-v3-mutation.json",
    "--confirm-external-write",
    `sha256:${"a".repeat(64)}`
  ]);
  await callTool("programmable_application_reconcile", {
    ...common,
    mutationReceiptPath: "/tmp/application-v3-mutation.json"
  }, { runCommand });
  assert.deepEqual(seen[2].slice(-4), [
    "--mutation-receipt",
    "/tmp/application-v3-mutation.json",
    "--resume",
    "--dry-run"
  ]);
});

test("MCP execute rejects missing acknowledgement, malformed digests, and submit PR numbers", async () => {
  const unreachable = async () => assert.fail("command must not run");
  await assert.rejects(
    callTool("programmable_application_execute", {
      action: "submit",
      packageDirectory: "/tmp/application-v3",
      mutationReceiptPath: "/tmp/application-v3-mutation.json",
      confirmationDigest: `sha256:${"a".repeat(64)}`
    }, { runCommand: unreachable }),
    /acknowledgeExternalWrite/u
  );
  await assert.rejects(
    callTool("programmable_application_execute", {
      action: "submit",
      packageDirectory: "/tmp/application-v3",
      mutationReceiptPath: "/tmp/application-v3-mutation.json",
      confirmationDigest: "sha256:nope",
      acknowledgeExternalWrite: true
    }, { runCommand: unreachable }),
    /confirmationDigest/u
  );
  await assert.rejects(
    callTool("programmable_application_plan", {
      action: "submit",
      packageDirectory: "/tmp/application-v3",
      pullRequest: 1
    }, { runCommand: unreachable }),
    /pullRequest is valid only for update/u
  );
});

test("MCP status and discovery arguments remain closed and bounded", async () => {
  const seen = [];
  const runCommand = async (argumentsList) => {
    seen.push(argumentsList);
    return { ok: true };
  };
  await callTool("programmable_discover", {
    operation: "search",
    values: ["three.js weapon game"],
    allowOfflineFallback: true,
    limit: 5
  }, { runCommand });
  assert.deepEqual(seen[0], [
    "discover",
    "search",
    "three.js weapon game",
    "--allow-offline-fallback",
    "--limit",
    "5"
  ]);
  await assert.rejects(
    callTool("programmable_discover", { operation: "list", offline: true, allowOfflineFallback: true }, { runCommand }),
    /mutually exclusive/u
  );
  await assert.rejects(
    callTool("programmable_application_status", {
      packageDirectory: "relative/path",
      pullRequest: 1
    }, { runCommand }),
    /must be absolute/u
  );
});

test("MCP Application V3 validation dispatches the closed package validator", async () => {
  const seen = [];
  const runCommand = async (argumentsList) => {
    seen.push(argumentsList);
    return { ok: true };
  };
  await callTool("programmable_application_validate", {
    packageDirectory: "/tmp/application-v3",
    sourceRoots: [
      { repositoryRef: "primary", path: "/tmp/source" },
      { repositoryRef: "game", path: "/tmp/game" }
    ]
  }, { runCommand });
  assert.deepEqual(seen[0], [
    "open-world",
    "validate-application",
    "/tmp/application-v3",
    "--source-root",
    "primary=/tmp/source",
    "--source-root",
    "game=/tmp/game"
  ]);
  await assert.rejects(
    callTool("programmable_application_validate", {
      packageDirectory: "/tmp/application-v3",
      repositoryRoot: "/tmp/source"
    }, { runCommand }),
    /unexpected argument/u
  );
});

test("MCP JSON-RPC handler exposes tools and returns bounded tool errors as results", async () => {
  const listed = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.equal(listed.result.tools.length, 7);
  const failed = await handleRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "programmable_discover", arguments: { operation: "show", values: [] } }
  });
  assert.equal(failed.result.isError, true);
  assert.equal(failed.result.structuredContent.error.code, "INVALID_ARGUMENT");
});

test("stdio server performs initialize, list, ping, and an actual read-only doctor", async (context) => {
  const child = childProcess.spawn(process.execPath, [serverPath], {
    cwd: repositoryRoot,
    env: { HOME: process.env.HOME, LANG: "C.UTF-8", PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "pipe"]
  });
  context.after(() => child.kill("SIGKILL"));
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  async function exchange(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
    const result = await iterator.next();
    assert.equal(result.done, false);
    return JSON.parse(result.value);
  }
  const initialized = await exchange({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } }
  });
  assert.equal(initialized.result.serverInfo.name, "programmable-v4-builder");
  assert.equal(initialized.result.serverInfo.version, "0.8.0");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  const ping = await exchange({ jsonrpc: "2.0", id: 2, method: "ping", params: {} });
  assert.deepEqual(ping.result, {});
  const doctor = await exchange({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "programmable_doctor", arguments: { repositoryRoot } }
  });
  assert.equal(doctor.result.isError, false);
  assert.equal(typeof doctor.result.structuredContent, "object");
  child.stdin.end();
});

test("stdio server fails closed before buffering an oversized unterminated message", async (context) => {
  const child = childProcess.spawn(process.execPath, [serverPath], {
    cwd: repositoryRoot,
    env: { HOME: process.env.HOME, LANG: "C.UTF-8", PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.on("error", () => {});
  context.after(() => child.kill("SIGKILL"));
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const closed = once(child, "close");

  child.stdin.end(Buffer.alloc((4 * 1024 * 1024) + 1, 0x20));
  const response = await iterator.next();
  assert.equal(response.done, false);
  const payload = JSON.parse(response.value);
  assert.equal(payload.error.code, -32700);
  assert.equal(payload.error.message, "Message exceeds 4 MiB");
  assert.equal(payload.error.data.maxMessageBytes, 4 * 1024 * 1024);
  const [exitCode] = await closed;
  assert.equal(exitCode, 1);
});

test("stdio server bounds both queued request count and queued bytes while a tool runs", async (context) => {
  if (process.platform === "win32") {
    context.skip("the deterministic slow-tool fixture uses a POSIX shell");
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-mcp-queue-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const fakeGh = path.join(temporary, "gh");
  fs.writeFileSync(fakeGh, "#!/bin/sh\nsleep 1\nprintf 'gh version 0.0.0\\n'\n", { mode: 0o700 });
  const doctor = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "programmable_doctor", arguments: { repositoryRoot } }
  });

  const scenarios = [
    {
      expectedLimit: "queued-message-count",
      requests: Array.from({ length: 34 }, (_, index) => JSON.stringify({
        jsonrpc: "2.0",
        id: index + 2,
        method: "ping",
        params: {}
      }))
    },
    {
      expectedLimit: "queued-byte-count",
      requests: Array.from({ length: 3 }, (_, index) => JSON.stringify({
        jsonrpc: "2.0",
        id: index + 2,
        method: "ping",
        params: { padding: "x".repeat(3 * 1024 * 1024) }
      }))
    }
  ];

  for (const scenario of scenarios) {
    const child = childProcess.spawn(process.execPath, [serverPath], {
      cwd: repositoryRoot,
      env: {
        HOME: process.env.HOME,
        LANG: "C.UTF-8",
        PATH: `${temporary}:${process.env.PATH}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.on("error", () => {});
    context.after(() => child.kill("SIGKILL"));
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    const closed = once(child, "close");

    child.stdin.end(`${[doctor, ...scenario.requests].join("\n")}\n`);
    const response = await iterator.next();
    assert.equal(response.done, false, scenario.expectedLimit);
    const payload = JSON.parse(response.value);
    assert.equal(payload.error.code, -32000, scenario.expectedLimit);
    assert.equal(payload.error.message, "Request queue limit exceeded", scenario.expectedLimit);
    assert.equal(payload.error.data.limit, scenario.expectedLimit);
    assert.equal(payload.error.data.maxQueuedMessages, 32);
    assert.equal(payload.error.data.maxQueuedBytes, 8 * 1024 * 1024);
    const [exitCode] = await closed;
    assert.equal(exitCode, 1, scenario.expectedLimit);
  }
});

test("stdio server terminates boundedly when a peer stops reading outbound responses", {
  timeout: 10_000
}, async (context) => {
  if (process.platform === "win32") {
    context.skip("the resident-set probe uses POSIX ps output");
    return;
  }
  const child = childProcess.spawn(process.execPath, [serverPath], {
    cwd: repositoryRoot,
    env: { HOME: process.env.HOME, LANG: "C.UTF-8", PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.on("error", () => {});
  child.stderr.resume();
  context.after(() => child.kill("SIGKILL"));
  const closed = once(child, "close");
  let closeResult = null;
  void closed.then((result) => { closeResult = result; });

  await delay(50);
  const baselineRssKiB = residentSetKiB(child.pid);
  let peakRssKiB = baselineRssKiB;
  const request = (id) => `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" })}\n`;
  for (let index = 0; index < 512 && closeResult === null; index += 1) {
    child.stdin.write(request(index + 1));
    if (index % 4 === 3) {
      peakRssKiB = Math.max(peakRssKiB, residentSetKiB(child.pid));
      await delay(1);
    }
  }
  if (closeResult === null) {
    child.stdin.end(Array.from({ length: 2_488 }, (_, index) => request(index + 513)).join(""));
  }

  const deadline = Date.now() + 5_000;
  while (closeResult === null && Date.now() < deadline) {
    peakRssKiB = Math.max(peakRssKiB, residentSetKiB(child.pid));
    await delay(25);
  }
  if (closeResult === null) {
    child.kill("SIGKILL");
    await closed;
    assert.fail("server did not terminate after bounded stdout backpressure");
  }
  assert.equal(closeResult[0], 1);
  assert.equal(closeResult[1], null);
  context.diagnostic(JSON.stringify({
    requestsWritten: 3_000,
    baselineRssKiB,
    peakRssKiB,
    rssGrowthKiB: peakRssKiB - baselineRssKiB
  }));
});

test("bounded MCP execution terminates its process group and descendants disappear boundedly after rejection", async (context) => {
  if (process.platform === "win32") {
    context.skip("process-group termination is currently claimed only on macOS/Linux");
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-mcp-tree-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const pidPath = path.join(temporary, "descendant.pid");
  const source = [
    "const cp = require('node:child_process');",
    "const fs = require('node:fs');",
    "const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "fs.writeFileSync(process.argv[1], String(child.pid));",
    "setInterval(() => {}, 1000);"
  ].join("\n");
  await assert.rejects(
    runBoundedProcess({
      command: process.execPath,
      argumentsList: ["-e", source, pidPath],
      cwd: temporary,
      environment: { PATH: process.env.PATH },
      // Give a contended CI runner enough time to start the fixture and persist
      // the descendant identity before exercising bounded process-group cleanup.
      timeoutMs: 2_000
    }),
    (error) => error?.code === "COMMAND_TIMEOUT"
  );
  const descendantPid = Number(fs.readFileSync(pidPath, "utf8"));
  context.after(() => {
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  });
  await assertProcessGoneWithin(descendantPid, 2_000);
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertProcessGoneWithin(pid, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    if (performance.now() >= deadline) {
      assert.fail(`descendant process ${pid} remained observable after ${timeoutMs} ms`);
    }
    await delay(10);
  }
}

function residentSetKiB(pid) {
  if (!Number.isSafeInteger(pid)) return 0;
  try {
    const output = childProcess.execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {
      encoding: "utf8"
    }).trim();
    const value = Number(output);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}
