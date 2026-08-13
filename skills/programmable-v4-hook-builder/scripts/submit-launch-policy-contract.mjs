import crypto from "node:crypto";
import { TextDecoder } from "node:util";

import {
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_POLICY_PATH,
  SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID
} from "./registry-intake-contract.mjs";
import { validateAgainstSchema } from "./restricted-json-schema-core.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";

export const SUBMIT_LAUNCH_POLICY_PROFILE_ID = "workflow-canary";
export const SUBMIT_LAUNCH_POLICY_SCHEMA_ID =
  "https://programmable.money/schemas/launch-policy.v1.schema.json";
export const SUBMIT_LAUNCH_POLICY_BINDING_SCHEMA_VERSION =
  "programmable.launch-policy-binding.v1";
export const SUBMIT_LAUNCH_POLICY_SCHEMA_BINDING_VERSION =
  "programmable.submit-launch-policy-schema-binding.v1";
export const MAX_SUBMIT_LAUNCH_POLICY_BYTES = 512 * 1024;
export const MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES = 256 * 1024;

const OBJECT_ID = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const POLICY_ID = /^[a-z0-9][a-z0-9.-]{2,79}$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

const POLICY_BINDING_KEYS = Object.freeze([
  "schemaVersion",
  "repository",
  "numericRepositoryId",
  "baseCommit",
  "baseTree",
  "path",
  "gitBlobOid",
  "policyId",
  "policyVersion",
  "profileId",
  "sha256"
]);
const POLICY_SCHEMA_BINDING_KEYS = Object.freeze([
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

export class SubmitLaunchPolicyError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SubmitLaunchPolicyError";
    this.code = code;
  }
}

export function parseSubmitLaunchPolicyContract(options) {
  requireExactOptions(options, ["policyBytes", "schemaBytes"]);
  const policyBytes = requireBoundedBytes(
    options.policyBytes,
    MAX_SUBMIT_LAUNCH_POLICY_BYTES,
    "SUBMIT_LAUNCH_POLICY_SIZE_INVALID"
  );
  const schemaBytes = requireBoundedBytes(
    options.schemaBytes,
    MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
    "SUBMIT_LAUNCH_POLICY_SCHEMA_SIZE_INVALID"
  );
  if (policyBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    fail(
      "SUBMIT_LAUNCH_POLICY_NONCANONICAL",
      "Submit Launch policy bytes must not contain a UTF-8 byte-order mark."
    );
  }
  const policySource = decode(policyBytes, "SUBMIT_LAUNCH_POLICY_INVALID");
  const schemaSource = decode(schemaBytes, "SUBMIT_LAUNCH_POLICY_SCHEMA_INVALID");
  const policy = parseJson(policySource, MAX_SUBMIT_LAUNCH_POLICY_BYTES, "SUBMIT_LAUNCH_POLICY_INVALID");
  const schema = parseJson(
    schemaSource,
    MAX_SUBMIT_LAUNCH_POLICY_SCHEMA_BYTES,
    "SUBMIT_LAUNCH_POLICY_SCHEMA_INVALID"
  );

  if (policySource !== `${canonicalSubmitPolicyJson(policy)}\n`) {
    fail(
      "SUBMIT_LAUNCH_POLICY_NONCANONICAL",
      "Submit Launch policy bytes must be sorted compact canonical JSON followed by one LF."
    );
  }
  if (!isPlainObject(schema) || schema.$id !== SUBMIT_LAUNCH_POLICY_SCHEMA_ID) {
    fail("SUBMIT_LAUNCH_POLICY_SCHEMA_INVALID", "Submit Launch returned an unsupported policy schema identity.");
  }
  const findings = validateAgainstSchema(policy, schema);
  if (findings.length > 0) {
    fail("SUBMIT_LAUNCH_POLICY_INVALID", "Submit Launch policy bytes do not satisfy their protected schema.");
  }
  validateBootstrapIdentity(policy);
  validateSelectedProfile(policy);
  deepFreeze(policy);
  deepFreeze(schema);
  return Object.freeze({
    policy,
    schema,
    policySha256: sha256(policyBytes),
    schemaSha256: sha256(schemaBytes)
  });
}

export function parseAndBindSubmitLaunchPolicyContract(options) {
  requireExactOptions(options, [
    "baseCommit",
    "baseTree",
    "policyBytes",
    "policyGitBlobOid",
    "schemaBytes",
    "schemaGitBlobOid"
  ]);
  const contract = parseSubmitLaunchPolicyContract({
    policyBytes: options.policyBytes,
    schemaBytes: options.schemaBytes
  });
  const bindings = buildSubmitLaunchPolicyBindings({
    baseCommit: options.baseCommit,
    baseTree: options.baseTree,
    policyBytes: options.policyBytes,
    policyGitBlobOid: options.policyGitBlobOid,
    schemaBytes: options.schemaBytes,
    schemaGitBlobOid: options.schemaGitBlobOid,
    contract
  });
  return Object.freeze({ ...contract, ...bindings });
}

function buildSubmitLaunchPolicyBindings({
  baseCommit,
  baseTree,
  policyBytes,
  policyGitBlobOid,
  schemaBytes,
  schemaGitBlobOid,
  contract
}) {
  if (
    !OBJECT_ID.test(baseCommit ?? "")
    || !OBJECT_ID.test(baseTree ?? "")
    || !OBJECT_ID.test(policyGitBlobOid ?? "")
    || !OBJECT_ID.test(schemaGitBlobOid ?? "")
    || !isPlainObject(contract)
    || !isPlainObject(contract.policy)
    || !SHA256.test(contract.policySha256 ?? "")
    || !SHA256.test(contract.schemaSha256 ?? "")
    || !(Buffer.isBuffer(policyBytes) || policyBytes instanceof Uint8Array)
    || !(Buffer.isBuffer(schemaBytes) || schemaBytes instanceof Uint8Array)
    || gitBlobOid(policyBytes) !== policyGitBlobOid
    || gitBlobOid(schemaBytes) !== schemaGitBlobOid
  ) {
    fail("SUBMIT_LAUNCH_POLICY_BINDING_INVALID", "Exact Submit Launch policy Git identities are required.");
  }
  const policyBinding = Object.freeze({
    schemaVersion: SUBMIT_LAUNCH_POLICY_BINDING_SCHEMA_VERSION,
    repository: SUBMIT_LAUNCH_REPOSITORY,
    numericRepositoryId: SUBMIT_LAUNCH_REPOSITORY_ID,
    baseCommit,
    baseTree,
    path: SUBMIT_LAUNCH_POLICY_PATH,
    gitBlobOid: policyGitBlobOid,
    policyId: contract.policy.policyId,
    policyVersion: contract.policy.policyVersion,
    profileId: SUBMIT_LAUNCH_POLICY_PROFILE_ID,
    sha256: contract.policySha256
  });
  const policySchemaBinding = Object.freeze({
    schemaVersion: SUBMIT_LAUNCH_POLICY_SCHEMA_BINDING_VERSION,
    repository: SUBMIT_LAUNCH_REPOSITORY,
    numericRepositoryId: SUBMIT_LAUNCH_REPOSITORY_ID,
    baseCommit,
    baseTree,
    path: SUBMIT_LAUNCH_POLICY_SCHEMA_PATH,
    gitBlobOid: schemaGitBlobOid,
    schemaId: SUBMIT_LAUNCH_POLICY_SCHEMA_ID,
    sha256: contract.schemaSha256
  });
  normalizeSubmitLaunchPolicyBinding(policyBinding);
  normalizeSubmitLaunchPolicySchemaBinding(policySchemaBinding);
  return Object.freeze({ policyBinding, policySchemaBinding });
}

export function normalizeSubmitLaunchPolicyBinding(value) {
  requireExactObject(value, POLICY_BINDING_KEYS, "SUBMIT_LAUNCH_POLICY_BINDING_INVALID");
  if (
    value.schemaVersion !== SUBMIT_LAUNCH_POLICY_BINDING_SCHEMA_VERSION
    || value.repository !== SUBMIT_LAUNCH_REPOSITORY
    || value.numericRepositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID
    || value.path !== SUBMIT_LAUNCH_POLICY_PATH
    || !OBJECT_ID.test(value.baseCommit ?? "")
    || !OBJECT_ID.test(value.baseTree ?? "")
    || !OBJECT_ID.test(value.gitBlobOid ?? "")
    || !POLICY_ID.test(value.policyId ?? "")
    || !SEMVER.test(value.policyVersion ?? "")
    || value.profileId !== SUBMIT_LAUNCH_POLICY_PROFILE_ID
    || !SHA256.test(value.sha256 ?? "")
  ) {
    fail("SUBMIT_LAUNCH_POLICY_BINDING_INVALID", "Submit Launch policy binding is malformed or exceeds consumer authority.");
  }
  return Object.freeze({ ...value });
}

export function normalizeSubmitLaunchPolicySchemaBinding(value) {
  requireExactObject(value, POLICY_SCHEMA_BINDING_KEYS, "SUBMIT_LAUNCH_POLICY_SCHEMA_BINDING_INVALID");
  if (
    value.schemaVersion !== SUBMIT_LAUNCH_POLICY_SCHEMA_BINDING_VERSION
    || value.repository !== SUBMIT_LAUNCH_REPOSITORY
    || value.numericRepositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID
    || value.path !== SUBMIT_LAUNCH_POLICY_SCHEMA_PATH
    || value.schemaId !== SUBMIT_LAUNCH_POLICY_SCHEMA_ID
    || !OBJECT_ID.test(value.baseCommit ?? "")
    || !OBJECT_ID.test(value.baseTree ?? "")
    || !OBJECT_ID.test(value.gitBlobOid ?? "")
    || !SHA256.test(value.sha256 ?? "")
  ) {
    fail("SUBMIT_LAUNCH_POLICY_SCHEMA_BINDING_INVALID", "Submit Launch policy schema binding is malformed.");
  }
  return Object.freeze({ ...value });
}

export function assertSubmitLaunchPolicyBindingsEqual(options) {
  requireExactOptions(options, [
    "expectedPolicyBinding",
    "observedPolicyBinding",
    "expectedPolicySchemaBinding",
    "observedPolicySchemaBinding"
  ]);
  const expectedPolicyBinding = normalizeSubmitLaunchPolicyBinding(options.expectedPolicyBinding);
  const observedPolicyBinding = normalizeSubmitLaunchPolicyBinding(options.observedPolicyBinding);
  const expectedPolicySchemaBinding = normalizeSubmitLaunchPolicySchemaBinding(options.expectedPolicySchemaBinding);
  const observedPolicySchemaBinding = normalizeSubmitLaunchPolicySchemaBinding(options.observedPolicySchemaBinding);
  if (
    !sameObject(expectedPolicyBinding, observedPolicyBinding, POLICY_BINDING_KEYS)
    || !sameObject(expectedPolicySchemaBinding, observedPolicySchemaBinding, POLICY_SCHEMA_BINDING_KEYS)
  ) {
    fail("POLICY_DRIFT", "The protected Submit Launch policy or its schema changed; resolve and evaluate the current policy again.");
  }
  return true;
}

export function submitLaunchPolicyContentMatches({
  expectedPolicyBinding,
  observedPolicyBinding,
  expectedPolicySchemaBinding,
  observedPolicySchemaBinding
}) {
  const expectedPolicy = normalizeSubmitLaunchPolicyBinding(expectedPolicyBinding);
  const observedPolicy = normalizeSubmitLaunchPolicyBinding(observedPolicyBinding);
  const expectedSchema = normalizeSubmitLaunchPolicySchemaBinding(expectedPolicySchemaBinding);
  const observedSchema = normalizeSubmitLaunchPolicySchemaBinding(observedPolicySchemaBinding);
  return ["gitBlobOid", "policyId", "policyVersion", "profileId", "sha256"]
    .every((key) => expectedPolicy[key] === observedPolicy[key])
    && ["gitBlobOid", "schemaId", "sha256"].every((key) => expectedSchema[key] === observedSchema[key]);
}

function validateBootstrapIdentity(policy) {
  if (
    !isPlainObject(policy)
    || policy.schemaVersion !== "programmable.launch-policy.v1"
    || !POLICY_ID.test(policy.policyId ?? "")
    || !SEMVER.test(policy.policyVersion ?? "")
    || !isPlainObject(policy.repository)
    || policy.repository.name !== SUBMIT_LAUNCH_REPOSITORY
    || policy.repository.numericRepositoryId !== SUBMIT_LAUNCH_REPOSITORY_ID
    || policy.repository.branch !== SUBMIT_LAUNCH_BASE_BRANCH
    || policy.repository.path !== SUBMIT_LAUNCH_POLICY_PATH
  ) {
    fail("SUBMIT_LAUNCH_POLICY_INVALID", "Submit Launch policy repository or version identity is invalid.");
  }
}

function validateSelectedProfile(policy) {
  const selected = Array.isArray(policy.profiles)
    ? policy.profiles.filter((profile) => isPlainObject(profile) && profile.id === SUBMIT_LAUNCH_POLICY_PROFILE_ID)
    : [];
  if (selected.length !== 1 || selected[0].enabled !== true) {
    fail(
      "SUBMIT_LAUNCH_POLICY_INVALID",
      "Submit Launch policy must enable the fixed workflow-canary consumer profile exactly once."
    );
  }
}

function requireBoundedBytes(value, maximum, code) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
    fail(code, "Submit Launch policy inputs must be exact bytes.");
  }
  const bytes = Buffer.from(value);
  if (bytes.length < 2 || bytes.length > maximum) {
    fail(code, "Submit Launch policy input exceeds its closed byte boundary.");
  }
  return bytes;
}

function decode(bytes, code) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    fail(code, "Submit Launch policy input must be valid UTF-8.", error);
  }
}

function parseJson(source, maximum, code) {
  try {
    return parseBoundedStrictJson(source, {
      maxSourceBytes: maximum,
      maxDepth: 128,
      maxNodes: 100_000,
      maxNumberCharacters: maximum
    });
  } catch (error) {
    fail(code, "Submit Launch policy input must be duplicate-free lossless JSON.", error);
  }
}

function requireExactOptions(value, keys) {
  if (!isPlainObject(value) || !sameKeys(value, keys)) {
    fail("SUBMIT_LAUNCH_POLICY_ARGUMENTS_INVALID", "Submit Launch policy options are closed and do not accept caller-selected authority.");
  }
}

function requireExactObject(value, keys, code) {
  if (!isPlainObject(value) || !sameKeys(value, keys)) {
    fail(code, "Submit Launch policy binding must use the exact closed field set.");
  }
}

function sameObject(left, right, keys) {
  return keys.every((key) => left[key] === right[key]);
}

function sameKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function gitBlobOid(bytes) {
  return crypto
    .createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function canonicalSubmitPolicyJson(value) {
  return JSON.stringify(sortSubmitPolicyValue(value));
}

function sortSubmitPolicyValue(value) {
  if (Array.isArray(value)) return value.map(sortSubmitPolicyValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
      .map((key) => [key, sortSubmitPolicyValue(value[key])])
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function fail(code, message, cause) {
  throw new SubmitLaunchPolicyError(code, message, cause === undefined ? undefined : { cause });
}
