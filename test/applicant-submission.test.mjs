import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPLICANT_INTAKE_REPOSITORY,
  APPLICANT_INTAKE_REPOSITORY_ID,
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

test("example binds the singleton hookbuilder intake and passes schema plus semantic validation", () => {
  assert.equal(example.intake.repository, APPLICANT_INTAKE_REPOSITORY);
  assert.equal(example.intake.repositoryId, APPLICANT_INTAKE_REPOSITORY_ID);
  assert.equal(permissionMask(example.hook.permissions), "0x2044");
  assert.deepEqual(validateApplicantSubmission(example, schema), []);
});

test("schema rejects intake drift, mutable source refs, missing versions, and direct-write requests", () => {
  for (const mutate of [
    (value) => { value.intake.repositoryId += 1; },
    (value) => { delete value.$schema; },
    (value) => { value.source.commit = "main"; },
    (value) => { delete value.identifiers.modelVersion; },
    (value) => { value.identifiers.hookVersion = "01.0.0"; },
    (value) => { value.requestedActions = ["review", "deploy"]; }
  ]) {
    const candidate = structuredClone(example);
    mutate(candidate);
    assert.ok(validateApplicantSubmission(candidate, schema).length > 0);
  }
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
  assert.deepEqual(validateApplicantSubmission(example, schema, {
    relativePath: "submissions/requests/123456789-example-fee-hook.json"
  }), []);
  assert.ok(validateApplicantSubmission(example, schema, {
    relativePath: "submissions/requests/wrong.json"
  }).some(({ code }) => code === "APPLICANT_REQUEST_PATH_MISMATCH"));
});

test("CLI all-mode is offline and accepts an empty request directory", () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "validate-applicant-submission.mjs"), "--all"],
    { cwd: repositoryRoot, encoding: "utf8", shell: false }
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "APPLICANT_SUBMISSIONS_VALID");
  assert.equal(report.networkAccessed, false);
  assert.deepEqual(report.externalActionsPerformed, []);
  assert.deepEqual(report.files, []);
});

test("lossless parser rejects duplicate decoded keys", () => {
  assert.throws(
    () => parseApplicantSubmission(Buffer.from('{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}\n')),
    /duplicate key/u
  );
});
