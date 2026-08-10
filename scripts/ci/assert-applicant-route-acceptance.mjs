#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJsonBytesV2 } from "../../skills/programmable-v4-hook-builder/scripts/canonical-json-core.mjs";
import { parseBoundedLosslessJson } from "../../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import { ApplicantFastLaneError, sha256 } from "./applicant-fast-lane-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = readJson(options.routeReport, "route capability report");
    const receipt = await assertWebsiteAcceptance(report, {
      claim: options.claim === null ? null : readBytes(options.claim, "Website acceptance claim"),
      record: options.record === null ? null : readJson(options.record, "Website acceptance record"),
      acceptanceCore: report.status === "ROUTE_ACCEPTANCE_REQUIRED"
        ? await loadCanonicalAcceptanceCore(repositoryRoot)
        : null
    });
    writeNewJson(options.output, receipt);
    writeNewJson(options.acceptedRouteReport, receipt.acceptedRouteCapabilityReport);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof ApplicantFastLaneError ? error.code : "WEBSITE_ROUTE_ACCEPTANCE_CHECK_FAILED";
    process.stderr.write(`assert-applicant-route-acceptance: ${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export async function assertWebsiteAcceptance(report, { claim, record, acceptanceCore }) {
  if (report?.status === "ROUTE_CAPABILITY_DISABLED") {
    throw new ApplicantFastLaneError("ROUTE_CAPABILITY_DISABLED", "Website acceptance cannot enable a disabled route capability");
  }
  if (report?.status === "ROUTE_UNSUPPORTED") {
    throw new ApplicantFastLaneError("ROUTE_UNSUPPORTED", "the applicant revision has no supported exact route");
  }
  if (report?.status === "ROUTE_SUPPORTED") {
    return receiptFor(report, "WEBSITE_ROUTE_ACCEPTANCE_NOT_REQUIRED", null, null, report);
  }
  if (report?.status !== "ROUTE_ACCEPTANCE_REQUIRED") {
    throw new ApplicantFastLaneError("ROUTE_CAPABILITY_MISMATCH", "route capability report status is invalid");
  }
  if (!Buffer.isBuffer(claim) || record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new ApplicantFastLaneError(
      "WEBSITE_ROUTE_ACCEPTANCE_RECORD_MISSING",
      "a canonical Website claim and accepted record are required for an accepted route transformation"
    );
  }
  requireAcceptanceCore(acceptanceCore);
  let acceptance;
  try {
    acceptance = acceptanceCore.parseApplicantRouteAcceptance(claim);
    const findings = acceptanceCore.validateApplicantRouteAcceptance(
      acceptance,
      acceptanceCore.loadApplicantRouteAcceptanceSchema(repositoryRoot)
    );
    if (!Array.isArray(findings) || findings.length !== 0) {
      throw new Error("canonical Website claim is not ready");
    }
    acceptanceCore.verifyApplicantRouteAcceptanceRecordCore(record, acceptance);
  } catch (error) {
    throw new ApplicantFastLaneError(
      "WEBSITE_ROUTE_ACCEPTANCE_INVALID",
      `canonical Website claim or record failed verification: ${error.message}`
    );
  }
  const acceptedRouteCapabilityReport = transformAcceptedRouteReport(report, acceptance);
  return receiptFor(
    acceptedRouteCapabilityReport,
    "WEBSITE_ROUTE_ACCEPTANCE_VERIFIED",
    acceptanceCore.applicantAcceptanceRecordHash(record),
    acceptanceCore.applicationAcceptanceSubjectHash(acceptanceCore.applicationAcceptanceSubjectV1(acceptance)),
    report
  );
}

export function transformAcceptedRouteReport(report, acceptance) {
  if (!Array.isArray(report?.requests) || report.requests.length !== 1) {
    throw new ApplicantFastLaneError(
      "WEBSITE_ROUTE_ACCEPTANCE_MISMATCH",
      "one canonical Website acceptance may transform exactly one route request"
    );
  }
  const [request] = report.requests;
  if (
    request?.status !== "ROUTE_ACCEPTANCE_REQUIRED"
    || request.acceptanceRequired !== true
    || !sameJson(acceptance?.originalRoute, request.requestedRoute)
    || !sameJson(acceptance?.acceptedRoute, request.requiredRoute)
    || acceptance?.reviewedRequest?.path !== request.path
    || acceptance?.reviewedRequest?.applicationManifestSha256 !== request.applicationManifestSha256
    || !sameJson(acceptance?.routeCapability, request.routeCapability)
  ) {
    throw new ApplicantFastLaneError(
      "WEBSITE_ROUTE_ACCEPTANCE_MISMATCH",
      "canonical Website acceptance does not bind this exact route subject, claim, and capability"
    );
  }
  return Object.freeze({
    schemaVersion: report.schemaVersion,
    status: "ROUTE_SUPPORTED",
    requests: Object.freeze([Object.freeze({
      ...structuredClone(request),
      status: "ROUTE_SUPPORTED",
      requestedRoute: structuredClone(request.requiredRoute),
      acceptanceRequired: false
    })])
  });
}

function receiptFor(acceptedRouteCapabilityReport, status, recordSha256, acceptanceSubjectHash, sourceReport) {
  return Object.freeze({
    schemaVersion: "1.0.0",
    status,
    sourceRouteCapabilityReportSha256: sha256(canonicalJsonBytesV2(sourceReport, { trailingNewline: false })),
    routeCapabilityReportSha256: sha256(canonicalJsonBytesV2(acceptedRouteCapabilityReport, { trailingNewline: false })),
    acceptedRouteCapabilityReport,
    recordSha256,
    acceptanceSubjectHash,
    networkAccessed: false,
    externalActionsPerformed: []
  });
}

async function loadCanonicalAcceptanceCore(root) {
  const absolutePath = path.join(root, "scripts", "applicant-route-acceptance-core.mjs");
  if (!fs.existsSync(absolutePath) || !fs.lstatSync(absolutePath).isFile() || fs.lstatSync(absolutePath).isSymbolicLink()) {
    throw new ApplicantFastLaneError(
      "WEBSITE_ACCEPTANCE_CORE_UNAVAILABLE",
      "canonical Website acceptance core and schema are not available in the protected control plane"
    );
  }
  return import(pathToFileURL(fs.realpathSync(absolutePath)).href);
}

function requireAcceptanceCore(value) {
  for (const name of [
    "applicantAcceptanceRecordHash",
    "applicationAcceptanceSubjectHash",
    "applicationAcceptanceSubjectV1",
    "loadApplicantRouteAcceptanceSchema",
    "parseApplicantRouteAcceptance",
    "validateApplicantRouteAcceptance",
    "verifyApplicantRouteAcceptanceRecordCore"
  ]) {
    if (typeof value?.[name] !== "function") {
      throw new ApplicantFastLaneError("WEBSITE_ACCEPTANCE_CORE_INVALID", `canonical Website acceptance core is missing ${name}`);
    }
  }
}

function parseArgs(args) {
  const values = { routeReport: null, claim: null, record: null, output: null, acceptedRouteReport: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--route-report") values.routeReport = take(args, ++index, flag);
    else if (flag === "--claim") values.claim = take(args, ++index, flag);
    else if (flag === "--record") values.record = take(args, ++index, flag);
    else if (flag === "--output") values.output = take(args, ++index, flag);
    else if (flag === "--accepted-route-report") values.acceptedRouteReport = take(args, ++index, flag);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (values.routeReport === null || values.output === null || values.acceptedRouteReport === null) {
    throw new Error("usage: assert-applicant-route-acceptance.mjs --route-report <json> --output <new-file> --accepted-route-report <new-file> [--claim <json> --record <json>]");
  }
  return values;
}

function readBytes(file, label) {
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > 128 * 1024) {
    throw new Error(`${label} size or file type is invalid`);
  }
  return fs.readFileSync(file);
}

function readJson(file, label) {
  const bytes = readBytes(file, label);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  parseBoundedLosslessJson(source);
  return JSON.parse(source);
}

function take(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

function writeNewJson(output, value) {
  if (fs.existsSync(output)) throw new Error("output must identify a new file");
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
