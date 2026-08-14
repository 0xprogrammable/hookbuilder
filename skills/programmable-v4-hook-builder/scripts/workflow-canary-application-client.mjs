import crypto from "node:crypto";
import { TextDecoder } from "node:util";

import {
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  SUBMIT_LAUNCH_WORKFLOW_CANARY_APPLICATION_SCHEMA_PATH
} from "./registry-intake-contract.mjs";
import { canonicalJson } from "./submission-core.mjs";
import {
  normalizeSubmitLaunchPolicyBinding,
  SubmitLaunchPolicyError
} from "./submit-launch-policy-contract.mjs";
import { inspectSchemaDefinition } from "./restricted-json-schema-definition-core.mjs";
import { validateAgainstSchema } from "./restricted-json-schema-core.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";

export const WORKFLOW_CANARY_APPLICATION_SCHEMA_ID =
  "https://programmable.money/schemas/workflow-canary-application-v1.schema.json";
export const WORKFLOW_CANARY_APPLICATION_SCHEMA_BINDING_VERSION =
  "programmable.workflow-canary-application-schema-binding.v1";
export const MAX_WORKFLOW_CANARY_APPLICATION_SCHEMA_BYTES = 64 * 1024;

const APPLICATION_OPTIONS = Object.freeze([
  "applicationId",
  "applicationRevision",
  "builder",
  "expectedPolicyBinding",
  "source",
  "summary",
  "title"
]);
const SCHEMA_BINDING_KEYS = Object.freeze([
  "schemaVersion",
  "repository",
  "numericRepositoryId",
  "baseCommit",
  "baseTree",
  "path",
  "gitBlobOid",
  "schemaId",
  "sha256"
]);
const OBJECT_ID = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const trustedSchemaRecords = new WeakSet();

export class WorkflowCanaryApplicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "WorkflowCanaryApplicationError";
    this.code = code;
  }
}

export function parseAndBindWorkflowCanaryApplicationSchema(options) {
  requireExactObject(options, ["baseCommit", "baseTree", "schemaBytes", "schemaGitBlobOid"]);
  const { baseCommit, baseTree, schemaBytes: input, schemaGitBlobOid } = options;
  if (
    !OBJECT_ID.test(baseCommit ?? "")
    || !OBJECT_ID.test(baseTree ?? "")
    || !OBJECT_ID.test(schemaGitBlobOid ?? "")
    || !(Buffer.isBuffer(input) || input instanceof Uint8Array)
  ) {
    fail("CANARY_APPLICATION_SCHEMA_BINDING_INVALID", "Exact protected canary schema Git identity is required.");
  }
  const schemaBytes = Buffer.from(input);
  if (
    schemaBytes.length < 2
    || schemaBytes.length > MAX_WORKFLOW_CANARY_APPLICATION_SCHEMA_BYTES
    || gitBlobOid(schemaBytes) !== schemaGitBlobOid
  ) {
    fail("CANARY_APPLICATION_SCHEMA_BINDING_INVALID", "Protected canary schema bytes disagree with their Git identity or byte limit.");
  }
  if (schemaBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    fail("CANARY_APPLICATION_SCHEMA_INVALID", "Protected canary schema must not contain a UTF-8 byte-order mark.");
  }
  let source;
  let schema;
  try {
    source = decoder.decode(schemaBytes);
    schema = parseBoundedStrictJson(source, {
      maxSourceBytes: MAX_WORKFLOW_CANARY_APPLICATION_SCHEMA_BYTES,
      maxDepth: 128,
      maxNodes: 40_000,
      maxNumberCharacters: MAX_WORKFLOW_CANARY_APPLICATION_SCHEMA_BYTES
    });
  } catch (error) {
    fail("CANARY_APPLICATION_SCHEMA_INVALID", "Protected canary schema must be duplicate-free UTF-8 JSON.", error);
  }
  if (
    !isPlainObject(schema)
    || schema.$id !== WORKFLOW_CANARY_APPLICATION_SCHEMA_ID
    || schema.$schema !== "https://json-schema.org/draft/2020-12/schema"
    || schema.type !== "object"
    || schema.additionalProperties !== false
  ) {
    fail("CANARY_APPLICATION_SCHEMA_INVALID", "Submit Launch returned an unsupported workflow-canary application schema.");
  }
  assertSupportedSchema(schema);
  const binding = normalizeWorkflowCanaryApplicationSchemaBinding({
    schemaVersion: WORKFLOW_CANARY_APPLICATION_SCHEMA_BINDING_VERSION,
    repository: SUBMIT_LAUNCH_REPOSITORY,
    numericRepositoryId: SUBMIT_LAUNCH_REPOSITORY_ID,
    baseCommit,
    baseTree,
    path: SUBMIT_LAUNCH_WORKFLOW_CANARY_APPLICATION_SCHEMA_PATH,
    gitBlobOid: schemaGitBlobOid,
    schemaId: WORKFLOW_CANARY_APPLICATION_SCHEMA_ID,
    sha256: digest(schemaBytes)
  });
  deepFreeze(schema);
  const record = Object.freeze({ schema, binding });
  trustedSchemaRecords.add(record);
  return record;
}

export function normalizeWorkflowCanaryApplicationSchemaBinding(value) {
  requireExactObject(value, SCHEMA_BINDING_KEYS, "CANARY_APPLICATION_SCHEMA_BINDING_INVALID");
  if (
    value.schemaVersion !== WORKFLOW_CANARY_APPLICATION_SCHEMA_BINDING_VERSION
    || value.repository !== SUBMIT_LAUNCH_REPOSITORY
    || value.numericRepositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID
    || value.path !== SUBMIT_LAUNCH_WORKFLOW_CANARY_APPLICATION_SCHEMA_PATH
    || value.schemaId !== WORKFLOW_CANARY_APPLICATION_SCHEMA_ID
    || !OBJECT_ID.test(value.baseCommit ?? "")
    || !OBJECT_ID.test(value.baseTree ?? "")
    || !OBJECT_ID.test(value.gitBlobOid ?? "")
    || !SHA256.test(value.sha256 ?? "")
  ) {
    fail("CANARY_APPLICATION_SCHEMA_BINDING_INVALID", "Workflow-canary application schema binding is malformed.");
  }
  return Object.freeze({ ...value });
}

export function buildWorkflowCanaryApplication(options, schemaRecord) {
  requireExactObject(options, APPLICATION_OPTIONS, "CANARY_APPLICATION_ARGUMENTS_INVALID");
  if (!trustedSchemaRecords.has(schemaRecord)) {
    fail("CANARY_APPLICATION_SCHEMA_INVALID", "Application construction requires the exact parsed protected schema record.");
  }
  let expectedPolicyBinding;
  try {
    expectedPolicyBinding = normalizeSubmitLaunchPolicyBinding(options.expectedPolicyBinding);
  } catch (error) {
    if (error instanceof SubmitLaunchPolicyError) {
      fail("CANARY_APPLICATION_INVALID", "Expected policy binding is not the fixed workflow-canary binding.", error);
    }
    throw error;
  }
  if (
    expectedPolicyBinding.baseCommit !== schemaRecord.binding.baseCommit
    || expectedPolicyBinding.baseTree !== schemaRecord.binding.baseTree
  ) {
    fail("CANARY_APPLICATION_INVALID", "Policy and canary schema must come from the same protected base tree.");
  }
  const application = {
    schemaVersion: "programmable.workflow-canary-application.v1",
    applicationId: options.applicationId,
    applicationRevision: options.applicationRevision,
    builder: clonePlainObject(options.builder),
    source: clonePlainObject(options.source),
    expectedPolicyBinding: { ...expectedPolicyBinding },
    title: options.title,
    summary: options.summary,
    declarations: {
      hiddenFromPublicRoutingAndDiscovery: true,
      independentAudit: false,
      productionRouting: false,
      realUserFunds: false
    }
  };
  if (!matchesSchema(application, schemaRecord.schema)) {
    fail("CANARY_APPLICATION_INVALID", "Workflow-canary application does not satisfy the current protected Submit Launch schema.");
  }
  // Round-trip through canonical bytes so the returned value cannot retain
  // caller prototypes, getters, references, or non-JSON values.
  const normalized = JSON.parse(canonicalJson(application));
  deepFreeze(normalized);
  return normalized;
}

export function canonicalWorkflowCanaryApplicationBytes(application, schemaRecord) {
  if (!trustedSchemaRecords.has(schemaRecord)) {
    fail("CANARY_APPLICATION_SCHEMA_INVALID", "Canonicalization requires the exact parsed protected schema record.");
  }
  if (!matchesSchema(application, schemaRecord.schema)) {
    fail("CANARY_APPLICATION_INVALID", "Workflow-canary application no longer satisfies its protected schema.");
  }
  return Buffer.from(`${canonicalJson(application)}\n`, "utf8");
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) return value;
  return { ...value };
}

function assertSupportedSchema(schema) {
  const findings = [];
  const inspection = inspectSchemaDefinition(schema, (code, path, message) => {
    findings.push({ code, path, message });
  });
  if (!inspection.valid || findings.length > 0) {
    fail("CANARY_APPLICATION_SCHEMA_INVALID", "Protected canary schema exceeds the reviewed bounded validator.");
  }
}

function matchesSchema(value, schema) {
  return validateAgainstSchema(value, schema).length === 0;
}

function requireExactObject(value, keys, code = "CANARY_APPLICATION_SCHEMA_ARGUMENTS_INVALID") {
  if (!isPlainObject(value)) fail(code, "Workflow-canary options are closed objects.");
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !actual.every((key) => keys.includes(key))) {
    fail(code, "Workflow-canary options do not accept caller-selected authority fields.");
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function gitBlobOid(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, cause) {
  throw new WorkflowCanaryApplicationError(code, message, cause === undefined ? undefined : { cause });
}
