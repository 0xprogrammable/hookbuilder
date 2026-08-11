import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBoundedChildProcess } from "../skills/programmable-v4-hook-builder/scripts/bounded-child-process-core.mjs";
import { SUBMIT_LAUNCH_REPOSITORY } from "../skills/programmable-v4-hook-builder/scripts/registry-intake-contract.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(moduleDirectory, "..");
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
).version;
if (typeof packageVersion !== "string" || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(packageVersion)) {
  throw new Error("package.json version must be stable semver");
}
const cliPath = path.join(
  repositoryRoot,
  "skills",
  "programmable-v4-hook-builder",
  "scripts",
  "cli.mjs"
);

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const SAFE_CHILD_ENVIRONMENT_KEYS = Object.freeze([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GIT_CONFIG_NOSYSTEM",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TMPDIR",
  "XDG_CONFIG_HOME"
]);

const stringSchema = Object.freeze({ type: "string", minLength: 1 });
const absolutePathSchema = Object.freeze({
  type: "string",
  minLength: 1,
  description: "Absolute local path. The Builder applies its own repository and symlink boundaries."
});
const sourceRootsSchema = Object.freeze({
  type: "array",
  maxItems: 33,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["repositoryRef", "path"],
    properties: {
      repositoryRef: stringSchema,
      path: absolutePathSchema
    }
  }
});

export const toolDefinitions = Object.freeze([
  {
    name: "programmable_doctor",
    title: "Check Programmable Builder readiness",
    description: "Read local Node, Git, package, and Git-worktree readiness without changing files or GitHub. This does not prove GitHub authentication.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { repositoryRoot: absolutePathSchema }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "programmable_discover",
    title: "Search the Programmable Registry",
    description: "Read the canonical Registry, or an explicitly labeled bundled snapshot. Similarity never rejects a new idea.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operation"],
      properties: {
        operation: { type: "string", enum: ["list", "search", "show", "compare"] },
        values: { type: "array", maxItems: 2, items: stringSchema },
        offline: { type: "boolean", default: false },
        allowOfflineFallback: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 }
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "programmable_application_validate",
    title: "Validate an Application V3 package",
    description: "Validate one closed local Application V3 package, with optional exact local source replay, without executing project code, using the network, or writing files.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["packageDirectory"],
      properties: {
        packageDirectory: absolutePathSchema,
        sourceRoots: sourceRootsSchema
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "programmable_application_status",
    title: "Read Application V3 status",
    description: `Read ${SUBMIT_LAUNCH_REPOSITORY} transport/review status for an exact Application V3 revision. This never approves, merges, deploys, or launches.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["packageDirectory", "pullRequest"],
      properties: {
        packageDirectory: absolutePathSchema,
        pullRequest: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
        sourceRoots: sourceRootsSchema
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "programmable_application_plan",
    title: "Plan an Application V3 GitHub action",
    description: `Recompute a read-only ${SUBMIT_LAUNCH_REPOSITORY} submit or update plan and return its exact confirmation digest. It performs no GitHub mutation.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action", "packageDirectory"],
      properties: {
        action: { type: "string", enum: ["submit", "update"] },
        packageDirectory: absolutePathSchema,
        pullRequest: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
        sourceRoots: sourceRootsSchema
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: "programmable_application_reconcile",
    title: "Reconcile an interrupted Application V3 action",
    description: `Use GET-only GitHub reads to reconcile a crash-safe ${SUBMIT_LAUNCH_REPOSITORY} mutation receipt and return the exact resumable state. It performs no GitHub mutation.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action", "packageDirectory", "mutationReceiptPath"],
      properties: {
        action: { type: "string", enum: ["submit", "update"] },
        packageDirectory: absolutePathSchema,
        pullRequest: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
        sourceRoots: sourceRootsSchema,
        mutationReceiptPath: absolutePathSchema
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "programmable_application_execute",
    title: "Execute one digest-bound Application V3 GitHub action",
    description: `Recompute and execute only the exact ${SUBMIT_LAUNCH_REPOSITORY} submit/update plan authorized by confirmationDigest. This can create a fork, branch, commit, Git ref, and draft pull request; it never approves, merges, deploys, launches, signs, or moves funds.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["action", "packageDirectory", "mutationReceiptPath", "confirmationDigest", "acknowledgeExternalWrite"],
      properties: {
        action: { type: "string", enum: ["submit", "update"] },
        packageDirectory: absolutePathSchema,
        pullRequest: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
        sourceRoots: sourceRootsSchema,
        mutationReceiptPath: absolutePathSchema,
        resume: {
          type: "boolean",
          default: false,
          description: "Reconcile and continue the exact original attempt recorded at mutationReceiptPath."
        },
        confirmationDigest: {
          type: "string",
          pattern: "^sha256:[0-9a-f]{64}$"
        },
        acknowledgeExternalWrite: {
          type: "boolean",
          const: true,
          description: "Must be true after the owner sees and accepts the freshly recomputed plan."
        }
      }
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  }
]);

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function assertObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_ARGUMENT", `${name} must be an object`);
  }
  return value;
}

function assertClosedKeys(value, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail("INVALID_ARGUMENT", `unexpected argument: ${key}`);
  }
}

function assertSafeString(value, name, options = {}) {
  if (typeof value !== "string" || value.length === 0) fail("INVALID_ARGUMENT", `${name} must be a non-empty string`);
  if (value.includes("\0") || /[\r\n]/u.test(value)) fail("INVALID_ARGUMENT", `${name} contains a forbidden control character`);
  if (options.absolute === true && !path.isAbsolute(value)) fail("INVALID_ARGUMENT", `${name} must be absolute`);
  return value;
}

function assertInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_ARGUMENT", `${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function sourceRootArguments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 33) fail("INVALID_ARGUMENT", "sourceRoots must be an array with at most 33 entries");
  const seen = new Set();
  const result = [];
  for (const [index, entry] of value.entries()) {
    const item = assertObject(entry, `sourceRoots[${index}]`);
    assertClosedKeys(item, new Set(["repositoryRef", "path"]));
    const repositoryRef = assertSafeString(item.repositoryRef, `sourceRoots[${index}].repositoryRef`);
    if (repositoryRef.includes("=")) fail("INVALID_ARGUMENT", "repositoryRef cannot contain '='");
    if (seen.has(repositoryRef)) fail("INVALID_ARGUMENT", `duplicate source root: ${repositoryRef}`);
    seen.add(repositoryRef);
    const sourcePath = assertSafeString(item.path, `sourceRoots[${index}].path`, { absolute: true });
    result.push("--source-root", `${repositoryRef}=${sourcePath}`);
  }
  return result;
}

function childEnvironment(environment = process.env) {
  const result = Object.create(null);
  for (const key of SAFE_CHILD_ENVIRONMENT_KEYS) {
    if (typeof environment[key] === "string" && environment[key].length > 0) result[key] = environment[key];
  }
  result.GIT_CONFIG_NOSYSTEM = "1";
  return result;
}

export async function runBuilderCommand(argumentsList, options = {}) {
  if (!fs.existsSync(cliPath)) fail("BUILDER_PACKAGE_INVALID", "canonical Builder CLI is missing");
  return await runBoundedProcess({
    command: process.execPath,
    argumentsList: [cliPath, ...argumentsList],
    cwd: repositoryRoot,
    environment: childEnvironment(options.environment),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  });
}

export async function runBoundedProcess({ command, argumentsList, cwd, environment, timeoutMs }) {
  const result = await runBoundedChildProcess({
    command,
    args: argumentsList,
    cwd,
    env: environment,
    timeoutMs,
    maximumOutputBytes: MAX_OUTPUT_BYTES
  });
  if (result.timedOut) {
    throw Object.assign(new Error(`Builder command exceeded ${timeoutMs} ms`), { code: "COMMAND_TIMEOUT" });
  }
  if (result.outputExceeded) {
    throw Object.assign(new Error("Builder command output exceeded the 4 MiB bound"), { code: "OUTPUT_LIMIT_EXCEEDED" });
  }
  if (result.status !== 0) {
    throw Object.assign(new Error(result.stderr.trim() || result.stdout.trim() || `Builder command exited ${result.status}`), {
      code: "BUILDER_COMMAND_FAILED",
      details: { exitCode: result.status, signal: result.signal }
    });
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw Object.assign(new Error("Builder command did not emit one JSON document"), { code: "BUILDER_OUTPUT_INVALID" });
  }
}

function applicationArguments(input, mode) {
  const allowed = new Set([
    "acknowledgeExternalWrite",
    "action",
    "confirmationDigest",
    "mutationReceiptPath",
    "packageDirectory",
    "pullRequest",
    "resume",
    "sourceRoots"
  ]);
  assertClosedKeys(input, allowed);
  const action = assertSafeString(input.action, "action");
  if (!new Set(["submit", "update"]).has(action)) fail("INVALID_ARGUMENT", "action must be submit or update");
  const packageDirectory = assertSafeString(input.packageDirectory, "packageDirectory", { absolute: true });
  const result = ["open-world", action, packageDirectory];
  if (action === "update") {
    result.push("--pull-request", String(assertInteger(input.pullRequest, "pullRequest", 1, 2_147_483_647)));
  } else if (input.pullRequest !== undefined) {
    fail("INVALID_ARGUMENT", "pullRequest is valid only for update");
  }
  result.push(...sourceRootArguments(input.sourceRoots));
  if (mode === "execute") {
    if (input.acknowledgeExternalWrite !== true) fail("EXTERNAL_WRITE_NOT_ACKNOWLEDGED", "acknowledgeExternalWrite must be true");
    const mutationReceiptPath = assertSafeString(input.mutationReceiptPath, "mutationReceiptPath", { absolute: true });
    result.push("--mutation-receipt", mutationReceiptPath);
    if (input.resume === true) result.push("--resume");
    else if (input.resume !== undefined && input.resume !== false) fail("INVALID_ARGUMENT", "resume must be boolean");
    const digest = assertSafeString(input.confirmationDigest, "confirmationDigest");
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) fail("INVALID_ARGUMENT", "confirmationDigest must be one lowercase sha256 digest");
    result.push("--confirm-external-write", digest);
  } else if (mode === "reconcile") {
    if (input.confirmationDigest !== undefined || input.acknowledgeExternalWrite !== undefined || input.resume !== undefined) {
      fail("INVALID_ARGUMENT", "confirmation and resume fields are not accepted by reconcile");
    }
    const mutationReceiptPath = assertSafeString(input.mutationReceiptPath, "mutationReceiptPath", { absolute: true });
    result.push("--mutation-receipt", mutationReceiptPath, "--resume", "--dry-run");
  } else {
    if (
      input.confirmationDigest !== undefined
      || input.acknowledgeExternalWrite !== undefined
      || input.mutationReceiptPath !== undefined
      || input.resume !== undefined
    ) {
      fail("INVALID_ARGUMENT", "receipt and confirmation fields are valid only for reconcile or execute");
    }
    result.push("--dry-run");
  }
  return result;
}

export async function callTool(name, rawArguments, options = {}) {
  const input = assertObject(rawArguments ?? {}, "arguments");
  let commandArguments;
  switch (name) {
    case "programmable_doctor": {
      assertClosedKeys(input, new Set(["repositoryRoot"]));
      commandArguments = ["doctor"];
      if (input.repositoryRoot !== undefined) {
        commandArguments.push("--repository-root", assertSafeString(input.repositoryRoot, "repositoryRoot", { absolute: true }));
      }
      break;
    }
    case "programmable_discover": {
      assertClosedKeys(input, new Set(["allowOfflineFallback", "limit", "offline", "operation", "values"]));
      const operation = assertSafeString(input.operation, "operation");
      if (!new Set(["list", "search", "show", "compare"]).has(operation)) fail("INVALID_ARGUMENT", "unsupported discovery operation");
      const expectedValues = operation === "list" ? 0 : operation === "compare" ? 2 : 1;
      const values = input.values ?? [];
      if (!Array.isArray(values) || values.length !== expectedValues) {
        fail("INVALID_ARGUMENT", `${operation} requires exactly ${expectedValues} value(s)`);
      }
      commandArguments = ["discover", operation, ...values.map((value, index) => assertSafeString(value, `values[${index}]`))];
      if (input.offline === true && input.allowOfflineFallback === true) fail("INVALID_ARGUMENT", "offline modes are mutually exclusive");
      if (input.offline === true) commandArguments.push("--offline");
      if (input.allowOfflineFallback === true) commandArguments.push("--allow-offline-fallback");
      if (input.limit !== undefined) commandArguments.push("--limit", String(assertInteger(input.limit, "limit", 1, 20)));
      break;
    }
    case "programmable_application_validate": {
      assertClosedKeys(input, new Set(["packageDirectory", "sourceRoots"]));
      commandArguments = [
        "open-world",
        "validate-application",
        assertSafeString(input.packageDirectory, "packageDirectory", { absolute: true }),
        ...sourceRootArguments(input.sourceRoots)
      ];
      break;
    }
    case "programmable_application_status": {
      assertClosedKeys(input, new Set(["packageDirectory", "pullRequest", "sourceRoots"]));
      commandArguments = [
        "open-world",
        "status",
        assertSafeString(input.packageDirectory, "packageDirectory", { absolute: true }),
        "--pull-request",
        String(assertInteger(input.pullRequest, "pullRequest", 1, 2_147_483_647)),
        ...sourceRootArguments(input.sourceRoots)
      ];
      break;
    }
    case "programmable_application_plan":
      commandArguments = applicationArguments(input, "plan");
      break;
    case "programmable_application_reconcile":
      commandArguments = applicationArguments(input, "reconcile");
      break;
    case "programmable_application_execute":
      commandArguments = applicationArguments(input, "execute");
      break;
    default:
      fail("UNKNOWN_TOOL", `unknown tool: ${String(name)}`);
  }
  return await (options.runCommand ?? runBuilderCommand)(commandArguments, options);
}

function toolSuccess(document) {
  return {
    content: [{ type: "text", text: JSON.stringify(document) }],
    structuredContent: document,
    isError: false
  };
}

function toolFailure(error) {
  const document = {
    ok: false,
    error: {
      code: typeof error?.code === "string" ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error)
    }
  };
  if (error?.details !== undefined) document.error.details = error.details;
  return {
    content: [{ type: "text", text: JSON.stringify(document) }],
    structuredContent: document,
    isError: true
  };
}

export async function handleRequest(message, options = {}) {
  if (message === null || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  if (!("id" in message)) return null;
  try {
    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "programmable-v4-builder", version: packageVersion },
            instructions: "Use read-only discovery and planning first. Execute an Application action only after the owner accepts the exact freshly returned digest. No tool approves, merges, deploys, launches, signs, or moves funds."
          }
        };
      case "ping":
        return { jsonrpc: "2.0", id: message.id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id: message.id, result: { tools: toolDefinitions } };
      case "tools/call": {
        const params = assertObject(message.params, "params");
        assertClosedKeys(params, new Set(["arguments", "name", "_meta"]));
        const name = assertSafeString(params.name, "name");
        try {
          const document = await callTool(name, params.arguments ?? {}, options);
          return { jsonrpc: "2.0", id: message.id, result: toolSuccess(document) };
        } catch (error) {
          return { jsonrpc: "2.0", id: message.id, result: toolFailure(error) };
        }
      }
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
    }
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32602,
        message: error instanceof Error ? error.message : String(error),
        data: { code: typeof error?.code === "string" ? error.code : "INVALID_ARGUMENT" }
      }
    };
  }
}
