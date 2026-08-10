#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseBoundedLosslessJson } from "../../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import {
  ApplicantFastLaneError,
  APPLICANT_FAST_LANE_SCHEMA_VERSION,
  fetchJsonWithRetry,
  normalizeRouteCapabilityReport,
  parseRequestPathsJson,
  sha256
} from "./applicant-fast-lane-core.mjs";
import {
  loadCandidateRequest,
  loadRouteReviewProvider,
  resolveCandidateRouteReview,
  verifyApplicantProfileSecurity
} from "./applicant-route-review-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { provider } = await loadRouteReviewProvider(repositoryRoot, options.provider);
    const routeReport = readJson(options.routeReport, 512 * 1024, "route capability report");
    normalizeRouteCapabilityReport(routeReport);
    const requestPaths = parseRequestPathsJson(options.requestsJson);
    const routeRequests = new Map((routeReport.requests ?? []).map((request) => [request.path, request]));
    const records = requestPaths.map((relativePath) => {
      const candidate = loadCandidateRequest({
        repositoryRoot,
        candidateRoot: options.candidateRoot,
        relativePath
      });
      const capability = resolveCandidateRouteReview({ provider, repositoryRoot, candidate });
      if (!sameJson(capability, routeRequests.get(relativePath)) && !matchesAcceptedRouteTransform(capability, routeRequests.get(relativePath))) {
        throw new ApplicantFastLaneError(
          "APPLICANT_REVISION_BINDING_MISMATCH",
          `route capability changed before ${options.check} verification for ${relativePath}`
        );
      }
      return Object.freeze({ candidate, capability });
    });
    let report;
    if (options.check === "security") {
      report = {
        schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
        status: "APPLICANT_SECURITY_SHARD_PASSED",
        checks: records.map(({ candidate }) => verifyApplicantProfileSecurity({
          provider,
          repositoryRoot,
          candidate
        })),
        networkAccessed: false,
        externalActionsPerformed: []
      };
    } else {
      report = await verifyReproducibility(records, { fetchImpl: globalThis.fetch });
    }
    writeNewJson(options.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof ApplicantFastLaneError ? error.code : "APPLICANT_REVISION_CHECK_FAILED";
    process.stderr.write(`verify-applicant-revision-inputs: ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function matchesAcceptedRouteTransform(original, accepted) {
  if (original === null || typeof original !== "object" || accepted === null || typeof accepted !== "object") return false;
  if (original.status !== "ROUTE_ACCEPTANCE_REQUIRED" || original.acceptanceRequired !== true) return false;
  const expected = {
    ...structuredClone(original),
    status: "ROUTE_SUPPORTED",
    requestedRoute: structuredClone(original.requiredRoute),
    acceptanceRequired: false
  };
  return sameJson(expected, accepted);
}

export async function verifyReproducibility(records, { fetchImpl }) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 32) {
    throw new ApplicantFastLaneError("REPRODUCIBILITY_INPUT_INVALID", "reproducibility records are invalid");
  }
  const treeCache = new Map();
  const blobCache = new Map();
  const receipts = [];
  for (const { candidate, capability } of records) {
    const repository = githubRepository(candidate.request.source.repository);
    const treeKey = `${repository.slug}\0${candidate.request.source.tree}`;
    let tree = treeCache.get(treeKey);
    if (tree === undefined) {
      const response = await fetchJsonWithRetry(
        `https://api.github.com/repos/${repository.slug}/git/trees/${candidate.request.source.tree}?recursive=1`,
        { attempts: 3, maximumBytes: 8 * 1024 * 1024, fetchImpl }
      );
      tree = normalizeTree(response.value, candidate.request.source.tree);
      treeCache.set(treeKey, tree);
    }
    const entries = tree.filter(({ path: entryPath }) => entryPath === capability.sourceManifestPath);
    if (entries.length !== 1) {
      throw new ApplicantFastLaneError(
        "REPRODUCIBILITY_MANIFEST_MISSING",
        `exact reviewed source manifest is not one regular blob: ${capability.sourceManifestPath}`
      );
    }
    const entry = entries[0];
    if (entry.type !== "blob" || entry.mode !== "100644" || entry.size !== capability.sourceManifestBytes) {
      throw new ApplicantFastLaneError(
        "REPRODUCIBILITY_MANIFEST_MISMATCH",
        "reviewed source manifest Git object identity or size differs from the compiler-owned plan"
      );
    }
    const blobKey = `${repository.slug}\0${entry.sha}`;
    let bytes = blobCache.get(blobKey);
    if (bytes === undefined) {
      const response = await fetchJsonWithRetry(
        `https://api.github.com/repos/${repository.slug}/git/blobs/${entry.sha}`,
        { attempts: 3, maximumBytes: 24 * 1024 * 1024, fetchImpl }
      );
      bytes = decodeBlob(response.value, entry);
      blobCache.set(blobKey, bytes);
    }
    const observedSha256 = sha256(bytes);
    if (observedSha256 !== capability.sourceManifestSha256 || bytes.length !== capability.sourceManifestBytes) {
      throw new ApplicantFastLaneError(
        "REPRODUCIBILITY_MANIFEST_MISMATCH",
        "reviewed source manifest bytes differ from the compiler-owned exact revision"
      );
    }
    receipts.push(Object.freeze({
      path: candidate.relativePath,
      source: structuredClone(candidate.request.source),
      sourceManifestPath: capability.sourceManifestPath,
      sourceManifestGitBlob: entry.sha,
      sourceManifestBytes: bytes.length,
      sourceManifestSha256: observedSha256,
      reviewBindingSha256: capability.reviewBindingSha256,
      codeHashesSha256: capability.codeHashesSha256
    }));
  }
  return Object.freeze({
    schemaVersion: APPLICANT_FAST_LANE_SCHEMA_VERSION,
    status: "APPLICANT_REPRODUCIBILITY_INPUTS_VERIFIED",
    networkAccessed: true,
    provider: "api.github.com",
    uniqueTrees: treeCache.size,
    uniqueBlobs: blobCache.size,
    receipts,
    externalActionsPerformed: []
  });
}

function normalizeTree(value, expectedTree) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || value.sha !== expectedTree
    || value.truncated !== false
    || !Array.isArray(value.tree)
    || value.tree.length > 100_000
  ) {
    throw new ApplicantFastLaneError(
      "REPRODUCIBILITY_TREE_INVALID",
      "provider did not return the complete exact source tree"
    );
  }
  return value.tree.map((entry) => {
    if (
      entry === null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || typeof entry.path !== "string"
      || !GIT_OBJECT_ID.test(entry.sha ?? "")
      || typeof entry.mode !== "string"
      || !new Set(["blob", "tree", "commit"]).has(entry.type)
      || (entry.type === "blob" && (!Number.isSafeInteger(entry.size) || entry.size < 0))
    ) {
      throw new ApplicantFastLaneError("REPRODUCIBILITY_TREE_INVALID", "provider tree entry is invalid");
    }
    return Object.freeze({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      sha: entry.sha,
      size: entry.type === "blob" ? entry.size : null
    });
  });
}

function decodeBlob(value, expected) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || value.sha !== expected.sha
    || value.size !== expected.size
    || value.encoding !== "base64"
    || typeof value.content !== "string"
    || /[^A-Za-z0-9+/=\r\n]/u.test(value.content)
  ) {
    throw new ApplicantFastLaneError("REPRODUCIBILITY_BLOB_INVALID", "provider Git blob response is invalid");
  }
  const base64 = value.content.replace(/[\r\n]/gu, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(base64)) {
    throw new ApplicantFastLaneError("REPRODUCIBILITY_BLOB_INVALID", "provider Git blob base64 is invalid");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== expected.size || bytes.toString("base64") !== base64) {
    throw new ApplicantFastLaneError("REPRODUCIBILITY_BLOB_INVALID", "provider Git blob bytes are not canonical");
  }
  return bytes;
}

function githubRepository(value) {
  const match = typeof value === "string"
    ? value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/u)
    : null;
  if (match === null || match[2].endsWith(".git")) {
    throw new ApplicantFastLaneError("REPRODUCIBILITY_INPUT_INVALID", "source repository URL is invalid");
  }
  return Object.freeze({ slug: `${match[1]}/${match[2]}` });
}

function parseArgs(args) {
  const values = {
    check: null,
    requestsJson: null,
    routeReport: null,
    output: null,
    provider: "scripts/route-compatibility-core.mjs",
    candidateRoot: repositoryRoot
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--check") values.check = take(args, ++index, flag);
    else if (flag === "--requests-json") values.requestsJson = take(args, ++index, flag);
    else if (flag === "--route-report") values.routeReport = take(args, ++index, flag);
    else if (flag === "--output") values.output = take(args, ++index, flag);
    else if (flag === "--provider") values.provider = take(args, ++index, flag);
    else if (flag === "--candidate-root") values.candidateRoot = take(args, ++index, flag);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (
    !new Set(["reproducibility", "security"]).has(values.check)
    || values.requestsJson === null
    || values.routeReport === null
    || values.output === null
  ) {
    throw new Error(
      "usage: verify-applicant-revision-inputs.mjs --check <reproducibility|security> --requests-json <json> --route-report <json> --output <new-file>"
    );
  }
  return values;
}

function readJson(file, maximumBytes, label) {
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > maximumBytes) {
    throw new Error(`${label} size or file type is invalid`);
  }
  const bytes = fs.readFileSync(file);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseBoundedLosslessJson(source);
  return JSON.parse(source);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function take(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

function writeNewJson(output, value) {
  if (fs.existsSync(output)) throw new Error("--output must identify a new file");
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) await main();
