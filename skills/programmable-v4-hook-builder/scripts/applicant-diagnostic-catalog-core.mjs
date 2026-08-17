const diagnosticCodePattern = /^[A-Z][A-Z0-9_]{2,100}$/u;

export const APPLICANT_CAUSE_CLASSES = Object.freeze([
  "PROJECT",
  "PLATFORM",
  "INTEGRATION",
  "AUTHORITY"
]);

const catalog = {
  BUILDER_CENTRAL_COMPATIBILITY_MISMATCH: entry(
    "INTEGRATION",
    0,
    "The installed Builder and the protected Submit Launch contract do not describe the same Applicant protocol.",
    "Update the Builder or use the protected base identified by the compatibility result before preparing another Draft.",
    "programmable doctor"
  ),
  APPLICATION_PROTOTYPE_EVIDENCE_REQUIRED: entry(
    "PLATFORM",
    1,
    "The protected transport incorrectly requires prototype evidence for a proposal stage Applicant Draft.",
    "Keep the proposal truthful and report the protected run URL. Do not invent prototype, trade, or fee evidence.",
    "programmable submit-project --resume --verbose"
  ),
  SUBMISSION_V2_PACKAGE_MISSING: entry(
    "PROJECT",
    10,
    "The repository does not contain one complete Submission V2 package.",
    "Generate or restore the source bound Submission V2 package before preparing the Application Draft.",
    "programmable submit-project --resume"
  ),
  SUBMISSION_V2_PACKAGE_INVALID: entry(
    "PROJECT",
    11,
    "The Submission V2 package is malformed or internally inconsistent.",
    "Repair the first reported package field and rerun the same persistent submission workspace.",
    "programmable submit-project --resume"
  ),
  PUBLIC_SOURCE_REQUIRED: entry(
    "PROJECT",
    12,
    "The project is not bound to one publicly resolvable GitHub commit and tree.",
    "Publish the intended source revision without secrets, then resume from that exact commit and tree.",
    "programmable submit-project --resume"
  ),
  SOURCE_CLOSURE_INCOMPLETE: entry(
    "PROJECT",
    13,
    "The declared source closure omits or cannot resolve a required project file.",
    "Bind every required file through the exact inline or manifest closure without changing the project target.",
    "programmable submit-project --resume"
  ),
  PACKAGE_BINDING_MISMATCH: entry(
    "PROJECT",
    14,
    "A package digest, path, commit, or tree differs from its declared immutable binding.",
    "Regenerate the package from the intended exact source revision and confirm the newly computed digest.",
    "programmable submit-project --resume"
  ),
  GITHUB_AUTH_REQUIRED: entry(
    "AUTHORITY",
    20,
    "GitHub authentication is unavailable for the requested Draft transport.",
    "Authenticate the intended Applicant account, verify its numeric identity, and resume without changing the package.",
    "programmable doctor"
  ),
  GITHUB_FORK_PERMISSION_REQUIRED: entry(
    "AUTHORITY",
    21,
    "The authenticated Applicant cannot create or update the required fork branch.",
    "Restore fork and branch write permission for the same Applicant identity, then resume the existing plan.",
    "programmable doctor"
  ),
  EXTERNAL_WRITE_CONFIRMATION_REQUIRED: entry(
    "AUTHORITY",
    22,
    "The Draft transport is ready but no current exact confirmation digest was supplied.",
    "Review the read only plan and confirm its freshly recomputed digest once to permit only the listed Draft writes.",
    "programmable submit-project --resume"
  ),
  EXTERNAL_WRITE_DENIED: entry(
    "AUTHORITY",
    23,
    "The Applicant denied the external GitHub writes in the current transport plan.",
    "Keep the local workspace and plan unchanged, or rerun later when Draft creation is explicitly authorized.",
    "programmable submit-project --resume"
  ),
  MUTATION_RECEIPT_RECONCILIATION_REQUIRED: entry(
    "AUTHORITY",
    24,
    "A GitHub write may have completed but its exact result has not been reconciled.",
    "Read back the existing fork, branch, commit, and Draft before authorizing or repeating any mutation.",
    "programmable submit-project --resume"
  ),
  GITHUB_PROTOCOL_ERROR: entry(
    "PLATFORM",
    30,
    "GitHub did not provide every immutable object required by the protected intake.",
    "Retry from the same exact source revision. If the failure repeats, report the run URL as a platform issue.",
    "programmable submit-project --resume"
  ),
  PR_MERGE_PARENT_MISMATCH: entry(
    "PLATFORM",
    31,
    "The protected intake event is bound to an obsolete base or merge parent.",
    "Refresh the Draft against the current protected base without rewriting the Applicant source revision.",
    "programmable submit-project --resume"
  ),
  CENTRAL_VALIDATOR_FAILURE: entry(
    "PLATFORM",
    32,
    "The protected validator failed before it could classify the Applicant package.",
    "Preserve the package and report the protected run URL so the platform failure can be reproduced independently.",
    "programmable submit-project --resume --verbose"
  ),
  CHECKS_RUNNING: entry(
    "PLATFORM",
    40,
    "The Draft exists and its protected checks have not reached a terminal result.",
    "Wait for the current checks and read their status without opening or updating another Draft.",
    "programmable submit-project --resume"
  ),
  CHANGES_REQUESTED: entry(
    "PROJECT",
    41,
    "The independent review requested changes to the current Applicant revision.",
    "Apply only the requested project changes, bind a new exact revision, and update the same Draft thread.",
    "programmable submit-project --resume"
  ),
  UNKNOWN_APPLICANT_FAILURE: entry(
    "INTEGRATION",
    90,
    "The Applicant workflow returned a code that this Builder does not yet classify.",
    "Preserve the exact package, workspace, code, and run URL, then inspect structured status before any retry.",
    "programmable submit-project --resume --verbose"
  )
};

export const APPLICANT_DIAGNOSTIC_CATALOG = Object.freeze(catalog);

export function createApplicantDiagnostic(finding) {
  if (finding === null || typeof finding !== "object" || Array.isArray(finding)) {
    throw new TypeError("Applicant diagnostic input must be an object");
  }
  if (typeof finding.code !== "string" || !diagnosticCodePattern.test(finding.code)) {
    throw new TypeError("Applicant diagnostic code is invalid");
  }
  const selected = APPLICANT_DIAGNOSTIC_CATALOG[finding.code]
    ?? APPLICANT_DIAGNOSTIC_CATALOG.UNKNOWN_APPLICANT_FAILURE;
  return Object.freeze({
    code: finding.code,
    causeClass: selected.causeClass,
    summary: selected.summary,
    repair: selected.repair,
    safeNextCommand: selected.safeNextCommand,
    writePerformed: finding.writePerformed === true
  });
}

export function projectApplicantDiagnostics(findings) {
  if (!Array.isArray(findings)) throw new TypeError("Applicant diagnostic findings must be an array");
  const grouped = new Map();
  for (const finding of findings) {
    const diagnostic = createApplicantDiagnostic(finding);
    const prior = grouped.get(diagnostic.code);
    if (prior === undefined || (!prior.writePerformed && diagnostic.writePerformed)) {
      grouped.set(diagnostic.code, diagnostic);
    }
  }
  const projected = [...grouped.values()]
    .sort((left, right) => priorityFor(left.code) - priorityFor(right.code)
      || compareUtf8(left.code, right.code))
    .slice(0, 3);
  return Object.freeze(projected);
}

function entry(causeClass, priority, summary, repair, safeNextCommand) {
  if (!APPLICANT_CAUSE_CLASSES.includes(causeClass)) throw new TypeError("Applicant cause class is invalid");
  return Object.freeze({ causeClass, priority, summary, repair, safeNextCommand });
}

function priorityFor(code) {
  return (APPLICANT_DIAGNOSTIC_CATALOG[code]
    ?? APPLICANT_DIAGNOSTIC_CATALOG.UNKNOWN_APPLICANT_FAILURE).priority;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
