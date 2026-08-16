import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.resolve(scriptDirectory, "..");
const EVIDENCE_KEYS = ["$schema", "schemaVersion", "kind", "files"];
const FILE_KEYS = ["repositoryPath", "portablePath", "bytes", "sha256"];
const SHA256 = /^[0-9a-f]{64}$/u;

export const SEMANTIC_RULE_TEST_EVIDENCE_V1_PATH = "references/semantic-rule-test-evidence-v1.json";
export const SEMANTIC_RULE_TEST_EVIDENCE_V1_SCHEMA_ID = "urn:programmable:semantic-rule-test-evidence-v1:1.0.0";
export const SEMANTIC_RULE_TEST_EVIDENCE_V1_SHA256 = "4de8458486a2dc6a7d242d5918d784b80f42c249537a132082b2cf789dab9e95";

export function createSemanticRuleTestEvidenceReader({
  repositoryRoot = null,
  skillRoot = defaultSkillRoot
} = {}) {
  const loaded = loadSemanticRuleTestEvidence(skillRoot);
  const repositoryTestRoot = repositoryRoot === null
    ? null
    : path.join(repositoryRoot, "test", "portable-skill");
  const repositoryEvidenceAvailable = repositoryTestRoot !== null
    && realDirectoryExists(repositoryTestRoot);
  return Object.freeze({
    mode: repositoryEvidenceAvailable
      ? "repository-source-and-portable-digest"
      : "portable-digest-backed",
    read(repositoryPath) {
      const record = loaded.byRepositoryPath.get(repositoryPath);
      if (record === undefined) {
        throw evidenceError(
          "SEMANTIC_RULE_TEST_EVIDENCE_PATH_UNBOUND",
          `test path is absent from the portable semantic evidence closure: ${repositoryPath}`
        );
      }
      const target = repositoryEvidenceAvailable
        ? resolveRegularFile(repositoryRoot, record.repositoryPath)
        : resolveRegularFile(skillRoot, record.portablePath);
      const bytes = fs.readFileSync(target);
      assertSemanticEvidenceFile(bytes, record, repositoryPath);
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (error) {
        throw evidenceError(
          "SEMANTIC_RULE_TEST_EVIDENCE_FILE_INVALID",
          `${repositoryPath} is not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}

export function loadSemanticRuleTestEvidence(skillRoot = defaultSkillRoot) {
  const evidencePath = resolveRegularFile(skillRoot, SEMANTIC_RULE_TEST_EVIDENCE_V1_PATH);
  const bytes = fs.readFileSync(evidencePath);
  if (sha256(bytes) !== SEMANTIC_RULE_TEST_EVIDENCE_V1_SHA256) {
    throw evidenceError(
      "SEMANTIC_RULE_TEST_EVIDENCE_DIGEST_MISMATCH",
      "semantic rule test evidence manifest digest mismatch"
    );
  }
  let evidence;
  try {
    evidence = parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: 128 * 1024,
      maxDepth: 12,
      maxNodes: 512,
      maxNumberCharacters: 32
    });
  } catch (error) {
    throw evidenceError(
      "SEMANTIC_RULE_TEST_EVIDENCE_INVALID",
      error instanceof Error ? error.message : String(error)
    );
  }
  if (`${JSON.stringify(evidence, null, 2)}\n` !== bytes.toString("utf8")) {
    throw evidenceError(
      "SEMANTIC_RULE_TEST_EVIDENCE_INVALID",
      "semantic rule test evidence must be canonical two-space JSON with one trailing newline"
    );
  }
  validateEvidence(evidence);
  const byRepositoryPath = new Map();
  for (const record of evidence.files) {
    const portableBytes = fs.readFileSync(resolveRegularFile(skillRoot, record.portablePath));
    assertSemanticEvidenceFile(portableBytes, record, record.portablePath);
    byRepositoryPath.set(record.repositoryPath, Object.freeze({ ...record }));
  }
  return Object.freeze({
    evidence: deepFreeze(evidence),
    byRepositoryPath
  });
}

function validateEvidence(value) {
  if (!isPlainObject(value)) invalid("evidence manifest must be one plain object");
  requireExactKeys(value, EVIDENCE_KEYS, "manifest");
  if (value.$schema !== SEMANTIC_RULE_TEST_EVIDENCE_V1_SCHEMA_ID || value.schemaVersion !== "1.0.0") {
    invalid("evidence manifest schema identity is invalid");
  }
  if (value.kind !== "programmable-semantic-rule-test-evidence") invalid("evidence manifest kind is invalid");
  if (!Array.isArray(value.files) || value.files.length === 0) invalid("evidence files must be a non-empty array");
  const repositoryPaths = [];
  const portablePaths = [];
  for (const [index, record] of value.files.entries()) {
    if (!isPlainObject(record)) invalid(`files[${index}] must be one plain object`);
    requireExactKeys(record, FILE_KEYS, `files[${index}]`);
    requireSafePath(record.repositoryPath, `files[${index}].repositoryPath`);
    requireSafePath(record.portablePath, `files[${index}].portablePath`);
    if (!record.repositoryPath.startsWith("test/portable-skill/") || !record.repositoryPath.endsWith(".test.mjs")) {
      invalid(`files[${index}].repositoryPath must name one portable-skill source test`);
    }
    if (!record.portablePath.startsWith("assets/semantic-rule-test-evidence-v1/") || !record.portablePath.endsWith(".test.mjs")) {
      invalid(`files[${index}].portablePath must stay inside the semantic evidence asset root`);
    }
    if (path.posix.basename(record.repositoryPath) !== path.posix.basename(record.portablePath)) {
      invalid(`files[${index}] source and portable basenames must match`);
    }
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 1) invalid(`files[${index}].bytes must be positive`);
    if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) {
      invalid(`files[${index}].sha256 must be one lowercase SHA-256 digest`);
    }
    repositoryPaths.push(record.repositoryPath);
    portablePaths.push(record.portablePath);
  }
  requireUniqueAndSorted(repositoryPaths, "repository paths");
  requireUniqueAndSorted(portablePaths, "portable paths");
}

function assertSemanticEvidenceFile(bytes, record, label) {
  if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
    throw evidenceError(
      "SEMANTIC_RULE_TEST_EVIDENCE_FILE_MISMATCH",
      `semantic rule test evidence file does not match its digest receipt: ${label}`
    );
  }
}

function resolveRegularFile(root, relativePath) {
  requireSafePath(relativePath, "path");
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...relativePath.split("/"));
  const relative = path.relative(absoluteRoot, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    invalid(`path escapes its root: ${relativePath}`);
  }
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw evidenceError("SEMANTIC_RULE_TEST_EVIDENCE_FILE_MISSING", `semantic evidence file is missing: ${relativePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw evidenceError("SEMANTIC_RULE_TEST_EVIDENCE_FILE_INVALID", `semantic evidence path must be a regular non-symlink file: ${relativePath}`);
  }
  return target;
}

function realDirectoryExists(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw evidenceError(
      "SEMANTIC_RULE_TEST_EVIDENCE_REPOSITORY_ROOT_INVALID",
      `repository semantic test root must be a real directory: ${target}`
    );
  }
  return true;
}

function requireSafePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || value.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || value.startsWith("/")
    || value.endsWith("/")
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) invalid(`${label} must be one safe POSIX relative path`);
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) invalid(`${label} keys are invalid`);
}

function requireUniqueAndSorted(values, label) {
  if (new Set(values).size !== values.length) invalid(`${label} must be unique`);
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(values) !== JSON.stringify(sorted)) invalid(`${label} must be sorted`);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function invalid(message) {
  throw evidenceError("SEMANTIC_RULE_TEST_EVIDENCE_INVALID", message);
}

function evidenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
