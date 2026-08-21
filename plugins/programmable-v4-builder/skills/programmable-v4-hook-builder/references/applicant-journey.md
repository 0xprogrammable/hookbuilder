# Applicant journey

Use one visible command for a completed project with exact public GitHub source:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

The command resolves one Current Contract Snapshot, applies the `submit` Stage Plan, selects the current accepted
Application contract and returns one repair or one safe next action. Reinvoke the same command for status. Do not expose
internal package assembly, queue experiments or legacy transport as the normal journey.

## Preconditions

Require:

- one clean source commit and tree;
- one complete tracked project package;
- exact public GitHub source for every repository in the review target; and
- only the tests and evidence that actually exist.

Do not require `PROJECT_PREFLIGHT_VALID` or a trusted external sandbox to create an unreviewed Applicant Draft. Both are
optional stronger evidence. Local or applicant-supplied test evidence remains unverified until independent review.

## Current contract

Use only the manifest-bound snapshot returned by the resolver. Never combine policy, compatibility, schema or
application artifacts from different commits or trees. Never substitute bundled or remembered requirements.

The `submit` Stage Plan uses the current application contract plus any applicable build requirements. It is not a
separate policy profile. If the snapshot changes before the Draft plan or write, discard the old plan and resolve again.

The current official-route path uses Application V3.2 with Submission 2.1. A V3.1 package remains a legacy compatibility
input; it cannot establish the current official route or launch readiness. Continue it through a new linked V3.2
revision without changing old bytes.

## Results

Return one concise state and its next action:

| State | Next action |
| --- | --- |
| `NEEDS_PROJECT_PACKAGE` | Complete the named project or application input. |
| `POLICY_UNRESOLVED` | Retry after the current contract can be resolved; do not use stale policy. |
| `INTEGRATION_PENDING` | Add support for the named contract or handler; unrelated stages may continue. |
| `READY_FOR_CONFIRMATION` | Review the exact plan and authorize only its fresh digest. |
| `CHECKS_RUNNING` | Wait for the protected checks on the existing Draft. |
| `REVIEW_REQUIRED` | Wait for independent review of the exact revision. |
| `CHANGES_REQUESTED` | Repair the named issue and prepare a new bound plan. |

Show at most three root diagnostics. Each diagnostic states what failed, how to repair it, whether a write occurred and
the safe next command. Keep complete bindings in the machine-readable workspace rather than the visible response.

## Confirmation boundary

Before any GitHub write, recompute the Current Contract Snapshot, exact source and read-only Draft plan. Require the
owner to authorize the freshly returned confirmation digest.

The confirmed path may create or update one Draft pull request. It cannot review, approve, mark ready, merge, deploy,
sign, route, register, promote, launch or move funds. An interrupted or ambiguous write must reconcile its stored receipt
through read-only observations before any retry.

## Detailed contracts

Load [submit-launch-resolver.md](submit-launch-resolver.md) only for snapshot, drift or unsupported-contract diagnosis.
Load [application-compatibility-and-migration.md](application-compatibility-and-migration.md) only for application-version
selection or migration. Internal transport details remain in [github-application-v3.md](github-application-v3.md).
