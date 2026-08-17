# Applicant journey

Use one visible command for a completed Programmable project:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

It binds a clean public Git revision, resolves the protected Submit Launch compatibility contract, validates one
Submission V2 subject, prepares or resumes one closed Application V3.1 package, returns one read-only Draft plan, and
persists the exact safe next action. Reinvoke the same command for status. Never expose the internal phase sequence as
the normal user journey.

Do not require `PROJECT_PREFLIGHT_VALID` or a trusted external sandbox to create an unreviewed Applicant Draft.
Local or applicant-supplied test evidence remains unverified until independent review: an existing completed project may create or repair its complete
`submission.v2.json`, then continue through `prepare-revision`, `application`, and the confirmation-gated Draft transport behind this one command.

The persistent workspace is outside every source repository. Its canonical state is
`applicant-workspace.v1.json`; the Application package, exact confirmation digest, mutation receipt, central base,
source commit and tree, Draft identity, and safe next action stay bound there. An interrupted confirmed mutation must
resume from that receipt through GET-only reconciliation. Never repeat an ambiguous write.

## Project discovery

Search only tracked files at the exact source commit. Auto-select exactly one `submission.v2.json`. If several exist,
use exactly one tracked `applicant-package.v1.json` pointer with this closed shape:

```json
{
  "applicationDraft": "inputs/application-draft.v3.json",
  "kind": "programmable-applicant-package-pointer",
  "reviewPackage": "inputs/review-package",
  "schemaVersion": "1.0.0",
  "securityAssessment": "inputs/security-assessment.v1.json",
  "securityEvidenceBindings": "inputs/security-evidence-bindings.v1.json",
  "submissionV2": "submission/submission.v2.json"
}
```

`submissionV2` is repository-relative and tracked. Every other pointer path is below the outside-source workspace
`inputs/` directory. The command may call the existing deterministic `prepare-revision`, `application`, and
`validate-application` implementations when all exact inputs exist. Missing review or security semantics become one
`NEEDS_PROJECT_PACKAGE` blocker. Do not invent evidence, Fee V2 selection, prototype state, trade capability, source
roots, repository identities, or test results.

The primary source maps to the given repository only when commit and tree match. Each companion maps to
`$WORKSPACE_ROOT/sources/<repository-ref>` and must independently match its declared commit and tree. A missing mapping
is one consolidated blocker; it is never a reason to omit that repository.

## Confirmation boundary

Before any external write, recompute the protected-base compatibility binding and read-only GitHub plan. Show at most
three diagnostics. Every diagnostic includes `code`, `causeClass`, `summary`, `repair`, `safeNextCommand`, and
`writePerformed`. Full detail is opt-in with `--verbose`.

Only repeat the command with the exact returned digest:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT" \
  --workspace-root "$WORKSPACE_ROOT" \
  --confirm-external-write "sha256:<exact-current-digest>"
```

The confirmed path may create or update one Draft PR. It cannot review, approve, mark ready, merge, deploy, sign,
launch, route, list, or move funds. `READY_FOR_CONFIRMATION`, `DRAFT_OPEN`, `CHECKS_RUNNING`, `REVIEW_REQUIRED`, and
`CHANGES_REQUESTED` describe transport only.

Use `advanced` or `legacy` only to diagnose a specific internal failure or reproduce an old contract. They remain
callable but do not belong in normal Applicant instructions.
