import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICANT_CAUSE_CLASSES,
  APPLICANT_DIAGNOSTIC_CATALOG,
  createApplicantDiagnostic,
  projectApplicantDiagnostics
} from "../../skills/programmable-v4-hook-builder/scripts/applicant-diagnostic-catalog-core.mjs";

const exactDiagnosticKeys = [
  "causeClass",
  "code",
  "repair",
  "safeNextCommand",
  "summary",
  "writePerformed"
];

test("the Applicant diagnostic catalog is closed and every record is actionable", () => {
  assert.deepEqual(APPLICANT_CAUSE_CLASSES, ["PROJECT", "PLATFORM", "INTEGRATION", "AUTHORITY"]);
  assert.ok(Object.isFrozen(APPLICANT_DIAGNOSTIC_CATALOG));
  assert.ok(Object.keys(APPLICANT_DIAGNOSTIC_CATALOG).length >= 12);
  for (const [code, record] of Object.entries(APPLICANT_DIAGNOSTIC_CATALOG)) {
    assert.match(code, /^[A-Z][A-Z0-9_]{2,100}$/u);
    assert.ok(APPLICANT_CAUSE_CLASSES.includes(record.causeClass));
    assert.ok(record.summary.length > 10);
    assert.ok(record.repair.length > 10);
    assert.match(record.safeNextCommand, /^programmable /u);
    assert.ok(Number.isSafeInteger(record.priority));
    assert.ok(Object.isFrozen(record));
  }
});

test("known and unknown failures project to the exact six-field public record", () => {
  assert.deepEqual(
    createApplicantDiagnostic({
      code: "GITHUB_PROTOCOL_ERROR",
      message: "untrusted secret: ghp_should_never_appear",
      writePerformed: false
    }),
    {
      code: "GITHUB_PROTOCOL_ERROR",
      causeClass: "PLATFORM",
      summary: "GitHub did not provide every immutable object required by the protected intake.",
      repair: "Retry from the same exact source revision. If the failure repeats, report the run URL as a platform issue.",
      safeNextCommand: "programmable submit-project --resume",
      writePerformed: false
    }
  );

  const unknown = createApplicantDiagnostic({
    code: "FUTURE_VALIDATOR_FAILURE",
    summary: "attacker controlled",
    repair: "print secrets",
    safeNextCommand: "rm -rf /",
    writePerformed: true
  });
  assert.deepEqual(Object.keys(unknown).sort(), exactDiagnosticKeys);
  assert.equal(unknown.code, "FUTURE_VALIDATOR_FAILURE");
  assert.equal(unknown.causeClass, "INTEGRATION");
  assert.equal(unknown.safeNextCommand, "programmable status --json");
  assert.equal(unknown.writePerformed, true);
  assert.equal(JSON.stringify(unknown).includes("attacker"), false);
  assert.equal(JSON.stringify(unknown).includes("secrets"), false);
});

test("public projection is deterministic, deduplicated and capped at three root causes", () => {
  const findings = [
    { code: "FUTURE_VALIDATOR_FAILURE", writePerformed: false },
    { code: "GITHUB_AUTH_REQUIRED", writePerformed: false },
    { code: "SUBMISSION_V2_PACKAGE_MISSING", writePerformed: false },
    { code: "BUILDER_CENTRAL_COMPATIBILITY_MISMATCH", writePerformed: false },
    { code: "SUBMISSION_V2_PACKAGE_MISSING", writePerformed: true },
    { code: "PUBLIC_SOURCE_REQUIRED", writePerformed: false }
  ];
  const projected = projectApplicantDiagnostics(findings);
  assert.equal(projected.length, 3);
  assert.deepEqual(
    projected.map(({ code }) => code),
    [
      "BUILDER_CENTRAL_COMPATIBILITY_MISMATCH",
      "SUBMISSION_V2_PACKAGE_MISSING",
      "PUBLIC_SOURCE_REQUIRED"
    ]
  );
  assert.equal(projected[1].writePerformed, true);
  assert.ok(projected.every((record) => Object.keys(record).sort().join("|") === exactDiagnosticKeys.join("|")));
  assert.ok(Object.isFrozen(projected));
});

test("invalid diagnostic inputs fail closed without reflecting untrusted values", () => {
  assert.throws(() => createApplicantDiagnostic({ code: "bad code" }), /Applicant diagnostic code is invalid/u);
  assert.throws(() => projectApplicantDiagnostics("not-an-array"), /must be an array/u);
});
