import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ApplicantFastLaneError,
  classifyChangedPaths,
  fetchJsonWithRetry,
  readResponseBodyBounded
} from "../scripts/ci/applicant-fast-lane-core.mjs";
import { assertWebsiteAcceptance } from "../scripts/ci/assert-applicant-route-acceptance.mjs";
import {
  EXACT_SHARDS_REVIEWED_PLAN_V1,
  PRODUCTION_GRAPH_FACTORY_ADDRESS,
  PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH,
  assessRouteCompatibility,
  classifyReviewedRoutePlan
} from "../scripts/route-compatibility-core.mjs";
import {
  loadApplicantRouteAcceptanceSchema,
  verifyApplicantRouteAcceptanceRecordCore
} from "../scripts/applicant-route-acceptance-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestPath = "submissions/requests/123456789-example-fee-hook.json";
const DIRECT_GRAPH_REVIEWED_PLAN_FIXTURE = Object.freeze({
  $schema: "urn:programmable:reviewed-route-plan:1.0.0",
  profile: "direct-graph",
  routeTarget: Object.freeze({
    role: "platform-graph-factory",
    address: PRODUCTION_GRAPH_FACTORY_ADDRESS,
    runtimeCodeHash: PRODUCTION_GRAPH_FACTORY_RUNTIME_CODE_HASH
  }),
  // The compatibility classifier only trusts the immutable target binding for this
  // profile; child fields are intentionally absent so this fixture cannot be used as
  // a Shards/nested-factory plan by accident.
  components: Object.freeze([])
});

test("only added or modified canonical request files use the applicant lane", () => {
  assert.equal(classifyChangedPaths([{ status: "A", path: requestPath }]).mode, "applicant");
  assert.equal(classifyChangedPaths([{ status: "M", path: requestPath }]).mode, "applicant");
  assert.equal(classifyChangedPaths([{ status: "D", path: requestPath }]).mode, "invalid");
  assert.equal(classifyChangedPaths([
    { status: "M", path: requestPath },
    { status: "M", path: "scripts/applicant-submission-core.mjs" }
  ]).mode, "mixed");
});

test("canonical direct-graph catalog is positive while exact Shards stays disabled", () => {
  const direct = assessRouteCompatibility(
    { routeId: "custom-graph", routeVersion: "1.0.0", chainId: "1" },
    DIRECT_GRAPH_REVIEWED_PLAN_FIXTURE
  );
  assert.equal(classifyReviewedRoutePlan(DIRECT_GRAPH_REVIEWED_PLAN_FIXTURE), "direct-graph");
  assert.equal(direct.status, "ROUTE_SUPPORTED");
  assert.equal(direct.supported, "direct-graph");

  const unsupportedRoute = assessRouteCompatibility(
    { routeId: "not-published", routeVersion: "1.0.0", chainId: "1" },
    DIRECT_GRAPH_REVIEWED_PLAN_FIXTURE
  );
  assert.equal(unsupportedRoute.status, "ROUTE_UNSUPPORTED");

  const shards = assessRouteCompatibility(
    { routeId: "custom-graph", routeVersion: "1.0.0", chainId: "1" },
    EXACT_SHARDS_REVIEWED_PLAN_V1
  );
  assert.equal(shards.status, "ROUTE_CAPABILITY_DISABLED");
  assert.equal(shards.supported, null);
});

test("the protected control plane contains the canonical Website acceptance core and schema", () => {
  assert.equal(typeof verifyApplicantRouteAcceptanceRecordCore, "function");
  assert.equal(
    loadApplicantRouteAcceptanceSchema(repositoryRoot).$id,
    "urn:programmable:applicant-route-acceptance:1.0.0"
  );
});

test("provider JSON reads are streaming, bounded, and retry only transient failures", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ok":'));
      controller.enqueue(new TextEncoder().encode("true}"));
      controller.close();
    }
  });
  let calls = 0;
  const result = await fetchJsonWithRetry("https://api.github.com/example", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("retry", { status: 503 });
      return new Response(body, { status: 200, headers: { "content-length": "11" } });
    },
    sleep: async () => {}
  });
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.attemptsUsed, 2);

  const tooLarge = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(9));
      controller.close();
    }
  }));
  await assert.rejects(() => readResponseBodyBounded(tooLarge, 8), (error) => (
    error instanceof ApplicantFastLaneError && error.code === "PROVIDER_RESPONSE_INVALID"
  ));
});

test("missing canonical route provider yields a persisted disabled capability report", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fast-lane-capability-"));
  const output = path.join(temporary, "report.json");
  const result = childProcess.spawnSync(process.execPath, [
    "scripts/ci/check-applicant-route-capability.mjs",
    "--requests-json", JSON.stringify([requestPath]),
    "--provider", "scripts/missing-route-provider.mjs",
    "--output", output
  ], { cwd: repositoryRoot, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).status, "ROUTE_CAPABILITY_DISABLED");
});

test("the canonical Shards record remains capability-disabled before the final platform release", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fast-lane-shards-"));
  const output = path.join(temporary, "report.json");
  const result = childProcess.spawnSync(process.execPath, [
    "scripts/ci/check-applicant-route-capability.mjs",
    "--requests-json", JSON.stringify(["submissions/requests/1329073878-shards-v1.json"]),
    "--output", output
  ], { cwd: repositoryRoot, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.status, "ROUTE_CAPABILITY_DISABLED");
  assert.equal(report.requests[0].reviewBindingSha256, "sha256:cfe926c42918ce1ca23efe8fa7352c2b6ed7090002f62a0d6d64481883205591");
  assert.equal(report.requests[0].routeCapability.activationState, "disabled-pending-production-release-attestation");
});

test("Website acceptance transforms only a claim-and-record-bound route into supported", async () => {
  const directGraph = {
    schemaVersion: "1.0.0",
    status: "ROUTE_SUPPORTED",
    requests: [{ path: requestPath, supported: "direct-graph" }]
  };
  const supported = await assertWebsiteAcceptance(directGraph, { claim: null, record: null, acceptanceCore: null });
  assert.equal(supported.status, "WEBSITE_ROUTE_ACCEPTANCE_NOT_REQUIRED");
  assert.deepEqual(supported.acceptedRouteCapabilityReport, directGraph);

  const originalRoute = { routeId: "custom-graph", routeVersion: "1.0.0", chainId: "1" };
  const acceptedRoute = { routeId: "nested-factory", routeVersion: "1.0.0", chainId: "1" };
  const routeCapability = { profileId: "exact-shards-nested-factory", profileVersion: "1.0.0" };
  const required = {
    schemaVersion: "1.0.0",
    status: "ROUTE_ACCEPTANCE_REQUIRED",
    requests: [{
      path: requestPath,
      status: "ROUTE_ACCEPTANCE_REQUIRED",
      supported: "exact-shards-nested-factory",
      requestedRoute: originalRoute,
      requiredRoute: acceptedRoute,
      applicationManifestSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      routeCapability,
      acceptanceRequired: true
    }]
  };
  const claim = {
    originalRoute,
    acceptedRoute,
    routeCapability,
    applicant: { githubUserId: 155705664 },
    reviewedRequest: {
      path: requestPath,
      applicationManifestSha256: required.requests[0].applicationManifestSha256
    }
  };
  const calls = [];
  const acceptanceCore = {
    parseApplicantRouteAcceptance(bytes) { calls.push("parse"); return JSON.parse(bytes); },
    loadApplicantRouteAcceptanceSchema() { calls.push("schema"); return {}; },
    validateApplicantRouteAcceptance() { calls.push("validate"); return []; },
    applicantAcceptanceRecordHash(record) {
      calls.push("record");
      assert.equal(record.id, "accepted");
      return "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    },
    verifyApplicantRouteAcceptanceRecordCore(record, value) {
      calls.push("verify");
      assert.equal(record.id, "accepted");
      assert.equal(value.reviewedRequest.path, requestPath);
    },
    applicationAcceptanceSubjectV1(value) { return { applicantGithubUserId: value.applicant.githubUserId, reviewedRequest: value.reviewedRequest }; },
    applicationAcceptanceSubjectHash() { return "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"; }
  };
  const accepted = await assertWebsiteAcceptance(required, {
    claim: Buffer.from(JSON.stringify(claim)),
    record: {
      id: "accepted",
      claimSha256: `claim:${requestPath}`
    },
    acceptanceCore
  });
  assert.equal(accepted.status, "WEBSITE_ROUTE_ACCEPTANCE_VERIFIED");
  assert.equal(accepted.acceptedRouteCapabilityReport.status, "ROUTE_SUPPORTED");
  assert.deepEqual(accepted.acceptedRouteCapabilityReport.requests[0].requestedRoute, acceptedRoute);
  assert.deepEqual(calls, ["parse", "schema", "validate", "verify", "record"]);

  const mismatchedClaim = structuredClone(claim);
  mismatchedClaim.reviewedRequest.applicationManifestSha256 = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  await assert.rejects(() => assertWebsiteAcceptance(required, {
    claim: Buffer.from(JSON.stringify(mismatchedClaim)), record: { id: "accepted" }, acceptanceCore
  }), (error) => error instanceof ApplicantFastLaneError && error.code === "WEBSITE_ROUTE_ACCEPTANCE_MISMATCH");
  await assert.rejects(() => assertWebsiteAcceptance({ status: "ROUTE_CAPABILITY_DISABLED" }, {
    claim: null, record: null, acceptanceCore: null
  }), /cannot enable a disabled route capability/u);
});

test("workflow keeps two independent stable contexts and never executes a PR head as applicant control plane", () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /name: Applicant gate/u);
  assert.match(workflow, /name: Platform\/profile gate/u);
  assert.match(workflow, /needs: \[plan, applicant-acceptance, applicant-mutable\]/u);
  assert.match(workflow, /needs: \[plan, repository, reference-kernel-required, codeql, platform-attestation\]/u);
  assert.match(workflow, /ref: \$\{\{ needs\.plan\.outputs\.trusted_revision \}\}/u);
  assert.doesNotMatch(workflow, /applicant-capability/u);
  assert.doesNotMatch(workflow, /applicant-revision-evidence|fetch-applicant-evidence|acceptance-resolver/u);
  assert.match(workflow, /WEBSITE_APPLICANT_ROUTE_ACCEPTANCE_CLAIM_URL/u);
  assert.match(workflow, /WEBSITE_APPLICANT_ROUTE_ACCEPTANCE_RECORD_URL/u);
  assert.match(workflow, /accepted-route-report\.json/u);
  assert.match(workflow, /applicant-acceptance:[\s\S]*?timeout-minutes: 2/u);
  assert.match(workflow, /applicant-mutable:[\s\S]*?timeout-minutes: 8/u);
  assert.match(fs.readFileSync(path.join(repositoryRoot, "scripts/ci/plan-applicant-fast-lane.mjs"), "utf8"), /git", \["merge-base", base, head\]/u);
});

test("the two stable gates remain disjoint in applicant, mixed, and platform modes", () => {
  const runGate = (args) => childProcess.spawnSync(process.execPath, ["scripts/ci/assert-fast-lane-gate.mjs", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  assert.equal(runGate([
    "--gate", "applicant", "--mode", "applicant", "--plan", "success",
    "--acceptance", "success", "--mutable", "success"
  ]).status, 0);
  assert.equal(runGate([
    "--gate", "platform", "--mode", "applicant", "--plan", "success",
    "--attestation", "success"
  ]).status, 0);
  assert.notEqual(runGate([
    "--gate", "applicant", "--mode", "mixed", "--plan", "success",
    "--acceptance", "success", "--mutable", "skipped"
  ]).status, 0);
});
