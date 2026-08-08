#!/usr/bin/env node

import process from "node:process";
import { once } from "node:events";
import { handleRequest } from "./server-core.mjs";

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_QUEUED_MESSAGES = 32;
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;
const MAX_OUTBOUND_MESSAGES = 1;
const MAX_OUTBOUND_BYTES = 16 * 1024 * 1024;
const OUTBOUND_STALL_TIMEOUT_MS = 1_000;

let currentLineChunks = [];
let currentLineBytes = 0;
let queuedBytes = 0;
let pendingOutboundMessages = 0;
let pendingOutboundBytes = 0;
let stdoutBackpressured = false;
let activeRequests = 0;
let exitWhenIdle = false;
let draining = false;
let failedClosed = false;
const messageQueue = [];

function closeOutputTransport() {
  exitWhenIdle = true;
  process.exitCode = 1;
  if (!process.stdout.destroyed) process.stdout.destroy();
  if (activeRequests === 0) process.exit(1);
}

function outboundDeadline(promise) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error("stdout remained backpressured"), { code: "OUTBOUND_STALL" }));
    }, OUTBOUND_STALL_TIMEOUT_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function writeMessage(message, { terminal = false } = {}) {
  if (message === null) return true;
  if (failedClosed && !terminal) return false;
  let payload;
  try {
    payload = Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
  } catch {
    if (terminal || failedClosed) closeOutputTransport();
    else failClosed(-32603, "Response serialization failed", undefined, { emit: false });
    return false;
  }
  if (
    payload.length > MAX_OUTBOUND_BYTES
    || pendingOutboundMessages >= MAX_OUTBOUND_MESSAGES
    || pendingOutboundBytes + payload.length > MAX_OUTBOUND_BYTES
  ) {
    if (terminal || failedClosed) closeOutputTransport();
    else {
      failClosed(-32000, "Outbound response limit exceeded", {
        maxOutboundMessages: MAX_OUTBOUND_MESSAGES,
        maxOutboundBytes: MAX_OUTBOUND_BYTES
      });
    }
    return false;
  }

  pendingOutboundMessages += 1;
  pendingOutboundBytes += payload.length;
  let requiresDrain = false;
  try {
    let completeWrite;
    const completed = new Promise((resolve, reject) => {
      completeWrite = (error) => error ? reject(error) : resolve();
    });
    process.stdin.pause();
    requiresDrain = !process.stdout.write(payload, completeWrite);
    if (requiresDrain) {
      stdoutBackpressured = true;
    }
    await outboundDeadline(Promise.all([
      completed,
      requiresDrain ? once(process.stdout, "drain") : Promise.resolve()
    ]));
    if (requiresDrain) stdoutBackpressured = false;
    if (!failedClosed && !process.stdin.destroyed) process.stdin.resume();
    return true;
  } catch {
    if (terminal || failedClosed) closeOutputTransport();
    else {
      failClosed(-32000, "Output transport stalled", {
        maxOutboundMessages: MAX_OUTBOUND_MESSAGES,
        maxOutboundBytes: MAX_OUTBOUND_BYTES,
        stallTimeoutMs: OUTBOUND_STALL_TIMEOUT_MS
      }, { emit: false });
    }
    return false;
  } finally {
    pendingOutboundMessages -= 1;
    pendingOutboundBytes -= payload.length;
  }
}

function jsonRpcError(code, message, data = undefined) {
  return {
    jsonrpc: "2.0",
    id: null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function failClosed(code, message, data = undefined, { emit = true } = {}) {
  if (failedClosed) return;
  failedClosed = true;
  currentLineChunks = [];
  currentLineBytes = 0;
  messageQueue.length = 0;
  queuedBytes = 0;
  process.exitCode = 1;
  process.stdin.pause();
  process.stdin.destroy();
  if (
    emit
    && pendingOutboundMessages === 0
    && !stdoutBackpressured
    && !process.stdout.destroyed
  ) {
    void writeMessage(jsonRpcError(code, message, data), { terminal: true });
  } else {
    closeOutputTransport();
  }
}

function takeCurrentLine() {
  const line = Buffer.concat(currentLineChunks, currentLineBytes);
  currentLineChunks = [];
  currentLineBytes = 0;
  return line.length > 0 && line.at(-1) === 0x0d ? line.subarray(0, -1) : line;
}

function responseForLine(line) {
  let message;
  try {
    message = JSON.parse(line.toString("utf8"));
  } catch {
    return jsonRpcError(-32700, "Parse error");
  }
  return handleRequest(message);
}

async function drainQueue() {
  if (draining || failedClosed) return;
  draining = true;
  try {
    while (!failedClosed && messageQueue.length > 0) {
      const { line, byteLength } = messageQueue.shift();
      queuedBytes -= byteLength;
      try {
        activeRequests += 1;
        let response;
        try {
          response = await responseForLine(line);
        } finally {
          activeRequests -= 1;
          if (exitWhenIdle && activeRequests === 0) process.exit(1);
        }
        if (!failedClosed && !await writeMessage(response)) return;
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
      }
    }
  } finally {
    draining = false;
    if (!failedClosed && messageQueue.length > 0) void drainQueue();
  }
}

function enqueueLine(line) {
  if (failedClosed) return;
  const countExceeded = messageQueue.length >= MAX_QUEUED_MESSAGES;
  const bytesExceeded = queuedBytes + line.length > MAX_QUEUED_BYTES;
  if (countExceeded || bytesExceeded) {
    failClosed(-32000, "Request queue limit exceeded", {
      limit: countExceeded ? "queued-message-count" : "queued-byte-count",
      maxQueuedMessages: MAX_QUEUED_MESSAGES,
      maxQueuedBytes: MAX_QUEUED_BYTES
    });
    return;
  }
  messageQueue.push({ line, byteLength: line.length });
  queuedBytes += line.length;
  void drainQueue();
}

function consumeChunk(inputChunk) {
  const chunk = Buffer.isBuffer(inputChunk) ? inputChunk : Buffer.from(inputChunk);
  let offset = 0;
  while (!failedClosed && offset < chunk.length) {
    const newline = chunk.indexOf(0x0a, offset);
    const end = newline === -1 ? chunk.length : newline;
    const segmentLength = end - offset;
    if (currentLineBytes + segmentLength > MAX_MESSAGE_BYTES) {
      failClosed(-32700, "Message exceeds 4 MiB", { maxMessageBytes: MAX_MESSAGE_BYTES });
      return;
    }
    if (segmentLength > 0) {
      currentLineChunks.push(chunk.subarray(offset, end));
      currentLineBytes += segmentLength;
    }
    if (newline === -1) return;
    enqueueLine(takeCurrentLine());
    offset = newline + 1;
  }
}

process.stdin.on("data", consumeChunk);

process.stdin.on("end", () => {
  if (!failedClosed && currentLineBytes > 0) enqueueLine(takeCurrentLine());
});

process.stdin.on("error", (error) => {
  if (failedClosed) return;
  failedClosed = true;
  messageQueue.length = 0;
  queuedBytes = 0;
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
