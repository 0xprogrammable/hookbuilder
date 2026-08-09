import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseBoundedLosslessJson } from "../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import { validateAgainstSchema } from "../skills/programmable-v4-hook-builder/scripts/restricted-json-schema-core.mjs";

export const APPLICANT_SUBMISSION_SCHEMA_VERSION = "1.0.0";
export const APPLICANT_INTAKE_REPOSITORY = "0xprogrammable/hookbuilder";
export const APPLICANT_INTAKE_REPOSITORY_ID = 1320085947;
export const MAXIMUM_APPLICANT_SUBMISSION_BYTES = 64 * 1024;
const CANONICAL_SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const MAXIMUM_UINT256 = (1n << 256n) - 1n;

export const PERMISSION_BITS = Object.freeze({
  beforeInitialize: 0x2000,
  afterInitialize: 0x1000,
  beforeAddLiquidity: 0x0800,
  afterAddLiquidity: 0x0400,
  beforeRemoveLiquidity: 0x0200,
  afterRemoveLiquidity: 0x0100,
  beforeSwap: 0x0080,
  afterSwap: 0x0040,
  beforeDonate: 0x0020,
  afterDonate: 0x0010,
  beforeSwapReturnDelta: 0x0008,
  afterSwapReturnDelta: 0x0004,
  afterAddLiquidityReturnDelta: 0x0002,
  afterRemoveLiquidityReturnDelta: 0x0001
});

export function loadApplicantSubmissionSchema(repositoryRoot) {
  return JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "submissions", "schema", "applicant-submission-v1.schema.json"),
    "utf8"
  ));
}

export function parseApplicantSubmission(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("applicant submission bytes must be a Buffer");
  if (bytes.length === 0 || bytes.length > MAXIMUM_APPLICANT_SUBMISSION_BYTES) {
    throw new Error(`applicant submission must contain 1 to ${MAXIMUM_APPLICANT_SUBMISSION_BYTES} bytes`);
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseBoundedLosslessJson(source);
  return JSON.parse(source);
}

export function permissionMask(permissions) {
  if (permissions === null || typeof permissions !== "object" || Array.isArray(permissions)) return null;
  let mask = 0;
  for (const [name, bit] of Object.entries(PERMISSION_BITS)) {
    if (typeof permissions[name] !== "boolean") return null;
    if (permissions[name]) mask |= bit;
  }
  return `0x${mask.toString(16).padStart(4, "0")}`;
}

export function listApplicantRequestFiles(requestsRoot) {
  const entries = fs.readdirSync(requestsRoot, { withFileTypes: true });
  let readmeFound = false;
  const files = [];
  for (const entry of entries) {
    if (entry.name === "README.md" && entry.isFile()) {
      readmeFound = true;
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new Error("submissions/requests may contain only README.md and direct JSON request files");
    }
    files.push(path.join(requestsRoot, entry.name));
  }
  if (!readmeFound) throw new Error("submissions/requests/README.md is required");
  return files.sort((left, right) => left.localeCompare(right));
}

export function validateApplicantSubmission(value, schema, { relativePath = null } = {}) {
  const findings = validateAgainstSchema(value, schema).map((finding) => ({
    ...finding,
    remediation: "Make the request match submissions/schema/applicant-submission-v1.schema.json."
  }));
  const add = (code, field, message, remediation) => findings.push({
    severity: "blocker",
    code,
    path: field,
    message,
    remediation
  });

  if (findings.length > 0 || value === null || typeof value !== "object" || Array.isArray(value)) return findings;

  const actualMask = permissionMask(value.hook.permissions);
  if (actualMask !== value.hook.addressFlagMask) {
    add(
      "APPLICANT_PERMISSION_MASK_MISMATCH",
      "$.hook.addressFlagMask",
      `Declared address mask ${value.hook.addressFlagMask} does not match permissions mask ${actualMask}.`,
      "Recompute the low 14 hook-address bits from the 14 permission booleans."
    );
  }

  for (const [field, version] of [
    ["$.identifiers.hookVersion", value.identifiers.hookVersion],
    ["$.identifiers.templateVersion", value.identifiers.templateVersion],
    ["$.identifiers.modelVersion", value.identifiers.modelVersion],
    ["$.requestedRoute.routeVersion", value.requestedRoute.routeVersion]
  ]) {
    if (!CANONICAL_SEMVER.test(version)) {
      add(
        "APPLICANT_VERSION_NOT_CANONICAL_SEMVER",
        field,
        `${version} is not a canonical major.minor.patch SemVer version.`,
        "Use an exact major.minor.patch version without leading zeroes or a mutable range."
      );
    }
  }

  if (BigInt(value.requestedRoute.chainId) > MAXIMUM_UINT256) {
    add(
      "APPLICANT_CHAIN_ID_OUT_OF_RANGE",
      "$.requestedRoute.chainId",
      `${value.requestedRoute.chainId} exceeds uint256.`,
      "Use the exact canonical positive uint256 chain ID."
    );
  }

  if (value.fee.amountPips === 0) {
    if (value.fee.currencyBasis !== "none" || value.fee.recipient !== null) {
      add(
        "APPLICANT_ZERO_FEE_INCONSISTENT",
        "$.fee",
        "A zero fee must use currencyBasis none and a null recipient.",
        "Set the zero-fee basis and recipient consistently, or declare the exact nonzero fee."
      );
    }
  } else if (value.fee.currencyBasis === "none" || value.fee.recipient === null) {
    add(
      "APPLICANT_NONZERO_FEE_INCOMPLETE",
      "$.fee",
      "A nonzero fee requires a currency basis and recipient.",
      "Declare the exact input, output, or quote basis and the exact recipient address."
    );
  }

  if (relativePath !== null) validateRequestPath(value, relativePath, add);
  return findings;
}

export function applicantSubmissionEvidence(value, bytes, relativePath) {
  return Object.freeze({
    path: relativePath,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sourceRepositoryId: value.source.repositoryId,
    sourceCommit: value.source.commit,
    sourceTree: value.source.tree,
    hookId: value.identifiers.hookId,
    requestedRoute: `${value.requestedRoute.routeId}@${value.requestedRoute.routeVersion}`
  });
}

function validateRequestPath(value, relativePath, add) {
  const normalized = relativePath.split(path.sep).join("/");
  if (!normalized.startsWith("submissions/requests/")) return;
  const expected = `${value.source.repositoryId}-${value.identifiers.hookId}.json`;
  if (path.posix.basename(normalized) !== expected || path.posix.dirname(normalized) !== "submissions/requests") {
    add(
      "APPLICANT_REQUEST_PATH_MISMATCH",
      "$",
      `Submission filename must be submissions/requests/${expected}.`,
      "Rename the request to bind the source repository ID and hook ID in its path."
    );
  }
}
