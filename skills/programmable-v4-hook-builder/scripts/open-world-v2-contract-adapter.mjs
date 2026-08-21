import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertApplicationAdapterSelection } from "./application-v3-contract-adapter.mjs";
import { canonicalJson, validateAgainstSchema } from "./submission-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const referencesDirectory = path.resolve(moduleDirectory, "../references");
const legacySubmissionSchema = readSchema("submission-v2.schema.json");
const currentSubmissionSchema = readSchema("open-world-submission-v2.1.schema.json");
const legacyTradeSchema = readSchema("trade-capability-manifest-v1.schema.json");
const currentTradeSchema = readSchema("trade-capability-manifest-v2.schema.json");
const CURRENT_SUBMISSION_SCHEMA_ID = "urn:programmable:v4-hook-submission:2.1.0";
const CURRENT_TRADE_SCHEMA_ID = "urn:programmable:trade-capability-manifest:2.0.0";
const MAX_RECORD_BYTES = 8 * 1024 * 1024;

export class OpenWorldV2ContractAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OpenWorldV2ContractAdapterError";
    this.code = code;
  }
}

/** Schema-level validator for the policy-neutral Trade Manifest V2 document. */
export function validateTradeCapabilityManifestV2(manifest) {
  return validateAgainstSchema(manifest, currentTradeSchema);
}

/**
 * Upgrade only policy-neutral Submission 2.0 data. Tradable migrations must
 * supply explicit V2 manifest bytes; the adapter never invents provenance.
 */
export function adaptOpenWorldSubmissionToCurrent({
  submission,
  tradeCapabilityManifests = [],
  applicationSelection
} = {}) {
  if (!isPlainObject(submission) || !Array.isArray(tradeCapabilityManifests)) {
    fail("OPEN_WORLD_ADAPTER_INPUT_INVALID", "Open-world adapter input is malformed");
  }
  if (
    Object.hasOwn(submission, "programmableFee")
    || Object.hasOwn(submission.supportingPackage ?? {}, "feePolicy")
    || Object.hasOwn(submission.supportingPackage ?? {}, "feePolicySchema")
  ) {
    fail("OPEN_WORLD_POLICY_NEUTRAL_REBUILD_REQUIRED", "A frozen Fee V2 submission cannot be silently rewritten as policy-neutral Submission 2.1");
  }
  const legacyFindings = validateAgainstSchema(submission, legacySubmissionSchema);
  if (legacyFindings.length > 0) {
    fail("OPEN_WORLD_LEGACY_SUBMISSION_INVALID", "The legacy Submission 2.0 document is invalid");
  }

  const current = structuredClone(submission);
  current.$schema = CURRENT_SUBMISSION_SCHEMA_ID;
  current.standardVersion = "2.1.0";
  const applicability = current.tradeCapability?.applicability;
  const markets = current.tradeCapability?.markets;
  if (!new Set(["tradable", "no-market", "unresolved"]).has(applicability) || !Array.isArray(markets)) {
    fail("OPEN_WORLD_ADAPTER_INPUT_INVALID", "Trade capability is malformed");
  }
  requireCurrentSelection(applicationSelection, applicability);

  const manifestRecords = parseCurrentManifestRecords(tradeCapabilityManifests, current.applicationId);
  if (applicability === "tradable") {
    if (markets.length === 0 || manifestRecords.length !== markets.length) {
      fail("OPEN_WORLD_TRADE_MANIFEST_V2_REQUIRED", "Every tradable market requires one explicit Trade Manifest V2 record");
    }
    const byMarketRef = new Map(manifestRecords.map((record) => [record.document.marketRef, record]));
    if (byMarketRef.size !== manifestRecords.length) {
      fail("OPEN_WORLD_TRADE_MANIFEST_V2_REQUIRED", "Trade Manifest V2 market bindings must be unique");
    }
    for (const market of markets) {
      const record = byMarketRef.get(market.marketRef);
      if (record === undefined) {
        fail("OPEN_WORLD_TRADE_MANIFEST_V2_REQUIRED", "A tradable market is missing its explicit Trade Manifest V2 record");
      }
      market.manifest = {
        artifactType: "trade-capability-manifest",
        byteLength: record.bytes.length,
        path: record.path,
        schemaId: CURRENT_TRADE_SCHEMA_ID,
        sha256: record.sha256
      };
    }
  } else if (markets.length !== 0 || manifestRecords.length !== 0) {
    fail("OPEN_WORLD_NONTRADABLE_MANIFEST_FORBIDDEN", "No-market and unresolved submissions cannot bind a trade manifest");
  }

  const findings = validateAgainstSchema(current, currentSubmissionSchema);
  if (findings.length > 0) {
    fail("OPEN_WORLD_CURRENT_SUBMISSION_INVALID", "The adapted document does not satisfy Submission 2.1");
  }
  const submissionBytes = canonicalBytes(current);
  return deepFreeze({
    schemaVersion: "programmable.open-world-v2-contract-adapter.v1",
    mode: "submission-2.0-to-2.1",
    submission: current,
    submissionContent: submissionBytes.toString("utf8"),
    submissionByteLength: submissionBytes.length,
    submissionSha256: sha256(submissionBytes),
    tradeCapabilityManifests: manifestRecords.map(projectManifestRecord),
    policyNeutral: true,
    candidateCodeExecuted: false,
    externalActionsPerformed: []
  });
}

/** Exact version dispatch. Legacy bytes are never validated through current schemas. */
export function validateOpenWorldSubmissionContract({
  submission,
  tradeCapabilityManifests = [],
  applicationSelection
} = {}) {
  if (!isPlainObject(submission) || !Array.isArray(tradeCapabilityManifests)) {
    fail("OPEN_WORLD_ADAPTER_INPUT_INVALID", "Open-world adapter input is malformed");
  }
  const current = submission.$schema === CURRENT_SUBMISSION_SCHEMA_ID
    && submission.schemaVersion === 2
    && submission.standardVersion === "2.1.0";
  const legacy = submission.$schema === "urn:programmable:v4-hook-submission:2.0.0"
    && submission.schemaVersion === 2
    && submission.standardVersion === "2.0.0";
  if (!current && !legacy) {
    return invalidReport("OPEN_WORLD_SUBMISSION_VERSION_UNSUPPORTED", "$.standardVersion");
  }
  const schema = current ? currentSubmissionSchema : legacySubmissionSchema;
  const schemaFindings = validateAgainstSchema(submission, schema);
  if (schemaFindings.length > 0) {
    return report({
      valid: false,
      mode: current ? "current" : "legacy-compatibility",
      submissionStandard: current ? "2.1.0" : "2.0.0",
      tradeManifestContract: current ? "trade-capability-manifest-v2" : "trade-capability-manifest-v1",
      findings: schemaFindings
    });
  }
  if (current) requireCurrentSelection(applicationSelection, submission.tradeCapability.applicability);

  const records = current
    ? parseCurrentManifestRecords(tradeCapabilityManifests, submission.applicationId)
    : parseLegacyManifestRecords(tradeCapabilityManifests, submission.applicationId);
  const semanticFindings = manifestBindingFindings(submission, records, {
    schemaId: current ? CURRENT_TRADE_SCHEMA_ID : "urn:programmable:trade-capability-manifest:1.0.0"
  });
  return report({
    valid: semanticFindings.length === 0,
    mode: current ? "current" : "legacy-compatibility",
    submissionStandard: current ? "2.1.0" : "2.0.0",
    tradeManifestContract: current ? "trade-capability-manifest-v2" : "trade-capability-manifest-v1",
    findings: semanticFindings
  });
}

function parseCurrentManifestRecords(records, applicationId) {
  return parseManifestRecords(records, applicationId, currentTradeSchema, CURRENT_TRADE_SCHEMA_ID, "2.0.0");
}

function requireCurrentSelection(value, applicability) {
  let selection;
  try {
    selection = assertApplicationAdapterSelection(value);
  } catch {
    fail(
      "OPEN_WORLD_CURRENT_CONTRACT_ADAPTER_REQUIRED",
      "Submission 2.1 and Trade Manifest V2 require one exact manifest-bound current Application adapter selection"
    );
  }
  if (
    selection.application?.version !== "3.2.0"
    || selection.submission?.version !== "2.1.0"
    || selection.tradeCapabilityManifest?.version !== "2.0.0"
  ) {
    fail(
      "OPEN_WORLD_CURRENT_CONTRACT_ADAPTER_REQUIRED",
      "Submission 2.1 and Trade Manifest V2 require one exact manifest-bound current Application adapter selection"
    );
  }
  const applicabilityByRoute = {
    none: new Set(["no-market", "unresolved"]),
    other: new Set(["tradable", "unresolved"]),
    "programmable-ethereum-mainnet": new Set(["tradable", "unresolved"])
  };
  const allowed = selection.requestedRoute === null
    ? new Set(["unresolved"])
    : applicabilityByRoute[selection.requestedRoute];
  if (!(allowed instanceof Set) || !allowed.has(applicability)) {
    fail(
      "OPEN_WORLD_ROUTE_SELECTION_MISMATCH",
      "The current Submission trade applicability contradicts the protected Resolver route selection"
    );
  }
}

function parseLegacyManifestRecords(records, applicationId) {
  return parseManifestRecords(records, applicationId, legacyTradeSchema, "urn:programmable:trade-capability-manifest:1.0.0", "1.0.0");
}

function parseManifestRecords(records, applicationId, schema, schemaId, version) {
  return records.map((record) => {
    if (!isPlainObject(record) || typeof record.path !== "string" || !isSafePath(record.path)) {
      fail("OPEN_WORLD_TRADE_MANIFEST_RECORD_INVALID", "Trade manifest record path is invalid");
    }
    const bytes = intrinsicBytes(record.bytes);
    let document;
    try {
      document = parseBoundedStrictJsonBytes(bytes, { maxSourceBytes: MAX_RECORD_BYTES });
    } catch {
      fail("OPEN_WORLD_TRADE_MANIFEST_RECORD_INVALID", "Trade manifest record bytes are malformed");
    }
    if (`${canonicalJson(document)}\n` !== bytes.toString("utf8")) {
      fail("OPEN_WORLD_TRADE_MANIFEST_RECORD_INVALID", "Trade manifest record bytes are not canonical JSON");
    }
    const findings = validateAgainstSchema(document, schema);
    if (
      findings.length > 0
      || document.$schema !== schemaId
      || document.schemaVersion !== version
      || document.applicationId !== applicationId
    ) fail("OPEN_WORLD_TRADE_MANIFEST_RECORD_INVALID", "Trade manifest record does not satisfy its exact versioned data contract");
    return deepFreeze({ path: record.path, bytes, sha256: sha256(bytes), document });
  });
}

function manifestBindingFindings(submission, records, { schemaId }) {
  const findings = [];
  const markets = submission.tradeCapability.markets;
  if (submission.tradeCapability.applicability !== "tradable") {
    if (markets.length !== 0 || records.length !== 0) {
      findings.push({ code: "OPEN_WORLD_NONTRADABLE_MANIFEST_FORBIDDEN", path: "$.tradeCapability.markets" });
    }
    return findings;
  }
  if (markets.length !== records.length) {
    findings.push({ code: "OPEN_WORLD_TRADE_MANIFEST_COUNT_MISMATCH", path: "$.tradeCapability.markets" });
    return findings;
  }
  const recordsByPath = new Map(records.map((record) => [record.path, record]));
  if (recordsByPath.size !== records.length) {
    findings.push({ code: "OPEN_WORLD_TRADE_MANIFEST_PATH_DUPLICATE", path: "$.tradeCapability.markets" });
    return findings;
  }
  for (const [index, market] of markets.entries()) {
    const record = recordsByPath.get(market.manifest?.path);
    if (
      record === undefined
      || market.manifest.schemaId !== schemaId
      || market.manifest.sha256 !== record.sha256
      || market.manifest.byteLength !== record.bytes.length
      || record.document.marketRef !== market.marketRef
    ) findings.push({ code: "OPEN_WORLD_TRADE_MANIFEST_BINDING_MISMATCH", path: `$.tradeCapability.markets[${index}].manifest` });
  }
  return findings;
}

function projectManifestRecord(record) {
  return {
    path: record.path,
    content: record.bytes.toString("utf8"),
    byteLength: record.bytes.length,
    sha256: record.sha256,
    applicationId: record.document.applicationId,
    marketRef: record.document.marketRef,
    schemaId: record.document.$schema
  };
}

function report({ valid, mode, submissionStandard, tradeManifestContract, findings }) {
  return deepFreeze({
    valid,
    status: valid ? "VALID" : "INVALID",
    mode,
    submissionStandard,
    tradeManifestContract,
    findings: structuredClone(findings),
    approvalGranted: false,
    launchAuthorized: false
  });
}

function invalidReport(code, findingPath) {
  return report({
    valid: false,
    mode: "unsupported",
    submissionStandard: null,
    tradeManifestContract: null,
    findings: [{ code, path: findingPath }]
  });
}

function readSchema(file) {
  return JSON.parse(fs.readFileSync(path.join(referencesDirectory, file), "utf8"));
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function intrinsicBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail("OPEN_WORLD_TRADE_MANIFEST_RECORD_INVALID", "Trade manifest record bytes are missing");
  }
  const bytes = Buffer.from(value);
  if (bytes.length < 2 || bytes.length > MAX_RECORD_BYTES) {
    fail("OPEN_WORLD_TRADE_MANIFEST_RECORD_INVALID", "Trade manifest record bytes exceed their bounded profile");
  }
  return bytes;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isSafePath(value) {
  return value.length > 0
    && value.length <= 512
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.includes("//")
    && !value.includes("\\")
    && value.split("/").every((part) => !new Set(["", ".", "..", ".git"]).has(part));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function fail(code, message) {
  throw new OpenWorldV2ContractAdapterError(code, message);
}
