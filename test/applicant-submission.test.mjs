import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPLICANT_INTAKE_REPOSITORY,
  APPLICANT_INTAKE_REPOSITORY_ID,
  APPLICANT_MANIFEST_CANONICALIZATION,
  APPLICANT_REQUESTED_ROUTE,
  APPLICANT_SUBMISSION_SCHEMA_VERSION,
  MAXIMUM_APPLICANT_SUBMISSION_BYTES,
  applicantSubmissionEvidence,
  canonicalApplicantRequestPath,
  canonicalApplicantSubmissionBytes,
  listApplicantRequestFiles,
  loadApplicantSubmissionSchema,
  parseApplicantSubmission,
  permissionMask,
  validateApplicantSubmission
} from "../scripts/applicant-submission-core.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = path.join(
  repositoryRoot,
  "submissions",
  "examples",
  "applicant-submission-v1.example.json"
);
const schema = loadApplicantSubmissionSchema(repositoryRoot);
const exampleBytes = fs.readFileSync(examplePath);
const example = parseApplicantSubmission(exampleBytes);

function createApplicantCliFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-applicant-cli-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.cpSync(path.join(repositoryRoot, "scripts"), path.join(fixtureRoot, "scripts"), { recursive: true });
  fs.cpSync(
    path.join(repositoryRoot, "skills", "programmable-v4-hook-builder", "scripts"),
    path.join(fixtureRoot, "skills", "programmable-v4-hook-builder", "scripts"),
    { recursive: true }
  );
  fs.mkdirSync(path.join(fixtureRoot, "submissions", "schema"), { recursive: true });
  fs.copyFileSync(
    path.join(repositoryRoot, "submissions", "schema", "applicant-submission-v1.schema.json"),
    path.join(fixtureRoot, "submissions", "schema", "applicant-submission-v1.schema.json")
  );
  fs.mkdirSync(path.join(fixtureRoot, "submissions", "requests"), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "submissions", "requests", "README.md"), "# Requests\n");
  return fixtureRoot;
}

function runApplicantCli(fixtureRoot, input) {
  return childProcess.spawnSync(
    process.execPath,
    [path.join(fixtureRoot, "scripts", "validate-applicant-submission.mjs"), input],
    { cwd: fixtureRoot, encoding: "utf8", shell: false }
  );
}

test("legacy example keeps its frozen Hookbuilder intake and passes schema plus semantic validation", () => {
  assert.equal(example.schemaVersion, APPLICANT_SUBMISSION_SCHEMA_VERSION);
  assert.equal(example.intake.repository, APPLICANT_INTAKE_REPOSITORY);
  assert.equal(example.intake.repositoryId, APPLICANT_INTAKE_REPOSITORY_ID);
  assert.deepEqual(Object.keys(example.intake).sort(), ["repository", "repositoryId"]);
  assert.equal(example.applicant.launchWallet, "0x52908400098527886E0F7030069857D2E4169EE7");
  assert.deepEqual(example.requestedRoute, APPLICANT_REQUESTED_ROUTE);
  assert.equal(permissionMask(example.hook.permissions), "0x2044");
  assert.deepEqual(validateApplicantSubmission(example, schema), []);
});

test("every active Applicant surface routes new applications to Submit a Launch", () => {
  const activeSurfaces = [
    "README.md",
    "docs/AGENT_SKILL.md",
    "docs/ARCHITECTURE.md",
    "docs/PUBLIC_GITHUB_PR_BETA.md",
    "skills/programmable-v4-hook-builder/SKILL.md",
    "skills/programmable-v4-hook-builder/references/agent-entry-and-application.md"
  ];
  for (const relativePath of activeSurfaces) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(contents, /0xprogrammable\/submit-launch/u, relativePath);
    assert.doesNotMatch(contents, /0xprogrammable\/programmable-registry/u, relativePath);
  }
});

test("Hookbuilder Applicant surfaces are frozen to the exact eight legacy continuations", () => {
  for (const relativePath of [
    ".github/PULL_REQUEST_TEMPLATE/applicant-submission.md",
    "submissions/README.md",
    "submissions/requests/README.md"
  ]) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(contents, /0xprogrammable\/submit-launch/u, relativePath);
    for (const pullRequest of [10, 11, 12, 14, 15, 18, 19, 20]) {
      assert.match(contents, new RegExp(`#${pullRequest}(?:\\b|,)`, "u"), relativePath);
    }
    assert.match(contents, /(?:legacy|former|existing)/iu, relativePath);
  }
});

test("legacy Hookbuilder contract keeps the 1.1.0 canonical applicationManifest", () => {
  const legacyReadme = fs.readFileSync(path.join(repositoryRoot, "submissions/README.md"), "utf8");
  for (const pattern of [
    /applicationManifest/u,
    /Canonical JSON V2/u,
    /no\s+trailing newline/u,
    /custom-graph@1\.0\.0/u
  ]) {
    assert.match(legacyReadme, pattern);
  }
  assert.equal(schema.$id, "urn:programmable:applicant-submission:1.1.0");
  assert.deepEqual(schema.properties.intake.required, ["repository", "repositoryId"]);
  assert.deepEqual(schema.properties.applicant.required, ["githubLogin", "launchWallet"]);
  assert.equal(schema.properties.intake.properties.githubAppInstallationScope, undefined);
  assert.equal(schema.properties.requestedRoute.properties.routeId.const, APPLICANT_REQUESTED_ROUTE.routeId);
  assert.equal(schema.properties.requestedRoute.properties.routeVersion.const, APPLICANT_REQUESTED_ROUTE.routeVersion);
  assert.equal(schema.properties.requestedRoute.properties.chainId.const, APPLICANT_REQUESTED_ROUTE.chainId);
});

test("current install and Builder identity surfaces use the canonical Hookbuilder repository", () => {
  for (const relativePath of [
    "docs/AGENT_SKILL.md",
    "docs/PORTABILITY_AND_LIFECYCLE.md",
    "docs/releases/v0.5.0-public-post.md",
    "skills/programmable-v4-hook-builder/references/registry-acceptance-v3.schema.json",
    "skills/programmable-v4-hook-builder/scripts/launch-bundle-v2-registry-projections.mjs"
  ]) {
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(contents, /0xprogrammable\/hookbuilder/u, relativePath);
    assert.doesNotMatch(contents, /0xprogrammable\/programmable-v4-builder/u, relativePath);
  }
});

test("historical and generic transports keep the canonical Submit a Launch target", () => {
  const transportSurfaces = [
    "github-application-journey.md",
    "github-application-v3.md",
    "output-contract.md",
    "submission-workflow.md",
    "workflow.md"
  ];
  for (const filename of transportSurfaces) {
    const relativePath = path.join("skills", "programmable-v4-hook-builder", "references", filename);
    const contents = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(contents, /0xprogrammable\/submit-launch:main/u, relativePath);
    assert.doesNotMatch(contents, /0xprogrammable\/(?:hookbuilder|programmable-registry):main/u, relativePath);
  }
  const genericApplication = fs.readFileSync(path.join(
    repositoryRoot,
    "skills",
    "programmable-v4-hook-builder",
    "references",
    "github-application-v3.md"
  ), "utf8");
  assert.match(genericApplication.slice(0, 1_200), /accepted generic Applicant contract/u);
  assert.doesNotMatch(genericApplication.slice(0, 1_200), /unreleased candidate/iu);

  const cli = fs.readFileSync(path.join(
    repositoryRoot,
    "skills",
    "programmable-v4-hook-builder",
    "scripts",
    "cli.mjs"
  ), "utf8");
  assert.match(cli, /Prepare frozen V1 transport metadata without a GitHub write\./u);
  assert.match(cli, /\["submit", \{ script: "github-application\.mjs", prefix: \["submit"\] \}\]/u);
  assert.doesNotMatch(cli, /Historical V1 GitHub transport/u);

  const submitTransport = fs.readFileSync(path.join(
    repositoryRoot,
    "skills",
    "programmable-v4-hook-builder",
    "scripts",
    "github-application.mjs"
  ), "utf8");
  const submitFlow = fs.readFileSync(path.join(
    repositoryRoot,
    "skills",
    "programmable-v4-hook-builder",
    "scripts",
    "github-application-flow-core.mjs"
  ), "utf8");
  assert.match(submitTransport, /draft pull request/u);
  assert.match(submitFlow, /draft: true/u);
  assert.match(submitFlow, /maintainerCanModify: false/u);
});

test("schema rejects intake drift, mutable source refs, missing versions, and direct-write requests", () => {
  for (const mutate of [
    (value) => { value.intake.repositoryId += 1; },
    (value) => { value.intake.githubAppInstallationScope = "single-repository"; },
    (value) => { delete value.$schema; },
    (value) => { value.source.commit = "main"; },
    (value) => { delete value.applicant.launchWallet; },
    (value) => { value.applicant.launchWallet = "0x0000000000000000000000000000000000000000"; },
    (value) => { delete value.identifiers.modelVersion; },
    (value) => { value.identifiers.hookVersion = "01.0.0"; },
    (value) => { value.requestedActions = ["review", "deploy"]; }
  ]) {
    const candidate = structuredClone(example);
    mutate(candidate);
    assert.ok(validateApplicantSubmission(candidate, schema).length > 0);
  }
});

test("schema and semantic validation fail closed outside the one live Applicant route", () => {
  for (const mutate of [
    (value) => { value.requestedRoute.routeId = "ordinary-launch"; },
    (value) => { value.requestedRoute.routeVersion = "1.1.0"; },
    (value) => { value.requestedRoute.chainId = "8453"; }
  ]) {
    const candidate = structuredClone(example);
    mutate(candidate);
    const findings = validateApplicantSubmission(candidate, schema);
    assert.ok(findings.some(({ code }) => code === "SCHEMA_CONST"));
    assert.ok(findings.some(({ code }) => code === "APPLICANT_REQUESTED_ROUTE_UNSUPPORTED"));
  }
});

test("semantic validation requires the exact EIP-55 launch wallet", () => {
  const lowercaseWallet = structuredClone(example);
  lowercaseWallet.applicant.launchWallet = example.applicant.launchWallet.toLowerCase();
  const finding = validateApplicantSubmission(lowercaseWallet, schema).find(({ code }) => (
    code === "APPLICANT_LAUNCH_WALLET_NOT_CANONICAL"
  ));
  assert.equal(finding.path, "$.applicant.launchWallet");
  assert.match(finding.message, /0x52908400098527886E0F7030069857D2E4169EE7/u);
  assert.match(finding.remediation, /public checksummed address/u);
});

test("semantic validation rejects permission-mask and fee contradictions", () => {
  const wrongMask = structuredClone(example);
  wrongMask.hook.addressFlagMask = "0x2000";
  assert.ok(validateApplicantSubmission(wrongMask, schema).some(({ code }) => (
    code === "APPLICANT_PERMISSION_MASK_MISMATCH"
  )));

  const incompleteFee = structuredClone(example);
  incompleteFee.fee.recipient = null;
  assert.ok(validateApplicantSubmission(incompleteFee, schema).some(({ code }) => (
    code === "APPLICANT_NONZERO_FEE_INCOMPLETE"
  )));

  const zeroRecipientFee = structuredClone(example);
  zeroRecipientFee.fee.recipient = "0x0000000000000000000000000000000000000000";
  const zeroRecipientFinding = validateApplicantSubmission(zeroRecipientFee, schema).find(({ code }) => (
    code === "APPLICANT_NONZERO_FEE_ZERO_RECIPIENT"
  ));
  assert.equal(zeroRecipientFinding.path, "$.fee.recipient");
  assert.match(zeroRecipientFinding.remediation, /exact nonzero Ethereum address/u);

  const inconsistentZeroFee = structuredClone(example);
  inconsistentZeroFee.fee.amountPips = 0;
  assert.ok(validateApplicantSubmission(inconsistentZeroFee, schema).some(({ code }) => (
    code === "APPLICANT_ZERO_FEE_INCONSISTENT"
  )));

  const outOfRangeChain = structuredClone(example);
  outOfRangeChain.requestedRoute.chainId = (1n << 256n).toString();
  assert.ok(validateApplicantSubmission(outOfRangeChain, schema).some(({ code }) => (
    code === "APPLICANT_CHAIN_ID_OUT_OF_RANGE"
  )));
});

test("request discovery fails closed on nested or unexpected files", (t) => {
  const requestsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-applicant-requests-"));
  t.after(() => fs.rmSync(requestsRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(requestsRoot, "README.md"), "# Requests\n");
  fs.writeFileSync(path.join(requestsRoot, "1-example.json"), "{}\n");
  assert.deepEqual(listApplicantRequestFiles(requestsRoot), [path.join(requestsRoot, "1-example.json")]);
  fs.mkdirSync(path.join(requestsRoot, "nested"));
  assert.throws(
    () => listApplicantRequestFiles(requestsRoot),
    /may contain only README\.md and direct JSON request files/u
  );
});

test("request filename binds source repository ID and hook ID", () => {
  assert.equal(
    canonicalApplicantRequestPath(example),
    "submissions/requests/123456789-example-fee-hook.json"
  );
  assert.deepEqual(validateApplicantSubmission(example, schema, {
    relativePath: "submissions/requests/123456789-example-fee-hook.json"
  }), []);
  assert.ok(validateApplicantSubmission(example, schema, {
    relativePath: "submissions/requests/wrong.json"
  }).some(({ code }) => code === "APPLICANT_REQUEST_PATH_MISMATCH"));
  for (const relativePath of [
    "submissions/examples/applicant-submission-v1.example.json",
    "arbitrary.json",
    "submissions/requests/999-example-fee-hook.json",
    "submissions/requests/123456789-wrong-hook.json",
    "submissions/requests/../requests/123456789-example-fee-hook.json",
    "/submissions/requests/123456789-example-fee-hook.json"
  ]) {
    assert.ok(validateApplicantSubmission(example, schema, { relativePath }).some(({ code }) => (
      code === "APPLICANT_REQUEST_PATH_MISMATCH"
    )), relativePath);
  }
});

test("applicationManifest binds deterministic canonical JSON v2 bytes independently of file formatting", () => {
  const canonicalBytes = canonicalApplicantSubmissionBytes(example);
  assert.equal(canonicalBytes.at(-1), "}".charCodeAt(0));
  assert.doesNotMatch(canonicalBytes.toString("utf8"), /\n/u);
  assert.equal(canonicalBytes.length, 1438);
  assert.equal(
    crypto.createHash("sha256").update(canonicalBytes).digest("hex"),
    "6575ab84fe93f388e96a7f042a7377859dfcd435e9c2810704e621b6a78a5794"
  );

  const compactBytes = Buffer.from(JSON.stringify(example), "utf8");
  const reparsed = parseApplicantSubmission(compactBytes);
  assert.deepEqual(canonicalApplicantSubmissionBytes(reparsed), canonicalBytes);
  assert.notEqual(
    crypto.createHash("sha256").update(compactBytes).digest("hex"),
    crypto.createHash("sha256").update(exampleBytes).digest("hex")
  );

  const evidence = applicantSubmissionEvidence(
    example,
    exampleBytes,
    "submissions/requests/123456789-example-fee-hook.json"
  );
  assert.deepEqual(evidence.applicationManifest, {
    path: "submissions/requests/123456789-example-fee-hook.json",
    canonicalization: APPLICANT_MANIFEST_CANONICALIZATION,
    bytes: canonicalBytes.length,
    sha256: `sha256:${crypto.createHash("sha256").update(canonicalBytes).digest("hex")}`
  });
  assert.equal(evidence.launchWallet, example.applicant.launchWallet);
  assert.equal(evidence.path, evidence.applicationManifest.path);
  assert.notEqual(evidence.sha256, evidence.applicationManifest.sha256.slice("sha256:".length));
  assert.equal(Object.isFrozen(evidence.applicationManifest), true);
  assert.throws(
    () => applicantSubmissionEvidence(
      example,
      exampleBytes,
      "submissions/examples/applicant-submission-v1.example.json"
    ),
    /applicant evidence path must be submissions\/requests\/123456789-example-fee-hook\.json/u
  );

  const differentWallet = structuredClone(example);
  differentWallet.applicant.launchWallet = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
  assert.notEqual(
    applicantSubmissionEvidence(differentWallet, exampleBytes, evidence.path).applicationManifest.sha256,
    evidence.applicationManifest.sha256
  );
});

test("CLI all-mode is offline and accepts an isolated empty request directory", (t) => {
  const fixtureRoot = createApplicantCliFixture(t);
  const result = runApplicantCli(fixtureRoot, "--all");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "APPLICANT_SUBMISSIONS_VALID");
  assert.equal(report.networkAccessed, false);
  assert.deepEqual(report.externalActionsPerformed, []);
  assert.deepEqual(report.files, []);
});

test("CLI all-mode discovers and validates canonical requests in its repository", (t) => {
  const fixtureRoot = createApplicantCliFixture(t);
  const canonicalPath = "submissions/requests/123456789-example-fee-hook.json";
  fs.writeFileSync(path.join(fixtureRoot, canonicalPath), exampleBytes);

  const result = runApplicantCli(fixtureRoot, "--all");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "APPLICANT_SUBMISSIONS_VALID");
  assert.equal(report.networkAccessed, false);
  assert.deepEqual(report.externalActionsPerformed, []);
  assert.deepEqual(report.files, [{
    ...applicantSubmissionEvidence(example, exampleBytes, canonicalPath),
    findings: []
  }]);
});

test("CLI accepts only the exact canonical request path without path substitution", (t) => {
  const fixtureRoot = createApplicantCliFixture(t);
  const canonicalPath = "submissions/requests/123456789-example-fee-hook.json";
  fs.writeFileSync(path.join(fixtureRoot, canonicalPath), exampleBytes);

  const accepted = runApplicantCli(fixtureRoot, canonicalPath);
  assert.equal(accepted.status, 0, accepted.stderr);
  const acceptedReport = JSON.parse(accepted.stdout);
  assert.equal(acceptedReport.status, "APPLICANT_SUBMISSIONS_VALID");
  assert.equal(acceptedReport.files.length, 1);
  assert.equal(acceptedReport.files[0].path, canonicalPath);
  assert.equal(acceptedReport.files[0].applicationManifest.path, canonicalPath);
  assert.deepEqual(acceptedReport.files[0].applicationManifest, applicantSubmissionEvidence(
    example,
    exampleBytes,
    canonicalPath
  ).applicationManifest);

  for (const invalidPath of [
    "submissions/examples/applicant-submission-v1.example.json",
    "arbitrary.json",
    "submissions/requests/999-example-fee-hook.json",
    "submissions/requests/123456789-wrong-hook.json"
  ]) {
    fs.mkdirSync(path.dirname(path.join(fixtureRoot, invalidPath)), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, invalidPath), exampleBytes);
    const rejected = runApplicantCli(fixtureRoot, invalidPath);
    assert.equal(rejected.status, 1, `${invalidPath}: ${rejected.stderr}`);
    const rejectedReport = JSON.parse(rejected.stdout);
    assert.equal(rejectedReport.status, "APPLICANT_SUBMISSIONS_INVALID");
    assert.equal(rejectedReport.files[0].path, invalidPath);
    assert.equal("applicationManifest" in rejectedReport.files[0], false);
    assert.ok(rejectedReport.files[0].findings.some(({ code }) => (
      code === "APPLICANT_REQUEST_PATH_MISMATCH"
    )), invalidPath);
  }

  for (const aliasedPath of [
    "submissions/requests/../requests/123456789-example-fee-hook.json",
    path.join(fixtureRoot, canonicalPath)
  ]) {
    const rejected = runApplicantCli(fixtureRoot, aliasedPath);
    assert.equal(rejected.status, 2, aliasedPath);
    assert.match(rejected.stderr, /normalized repository-relative path/u);
    assert.equal(rejected.stdout, "");
  }
});

test("lossless parser rejects duplicate decoded keys", () => {
  assert.throws(
    () => parseApplicantSubmission(Buffer.from('{"schemaVersion":"1.1.0","schemaVersion":"1.1.0"}\n')),
    /duplicate key/u
  );
});

test("parser rejects empty, oversized, and invalid UTF-8 request bytes", () => {
  assert.throws(() => parseApplicantSubmission(Buffer.alloc(0)), /must contain 1 to 65536 bytes/u);
  assert.throws(
    () => parseApplicantSubmission(Buffer.alloc(MAXIMUM_APPLICANT_SUBMISSION_BYTES + 1, 0x20)),
    /must contain 1 to 65536 bytes/u
  );
  assert.throws(() => parseApplicantSubmission(Buffer.from([0xc3, 0x28])), /encoded data was not valid/u);
});
