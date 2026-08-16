# Submit a Launch

Submit a Launch is the canonical public review path for every completed one-off Programmable project. Application V3.1
accepts hooks, applications, services, games, multi-repository systems and unfamiliar custom architectures without a
project allowlist. Novelty can require independent review, but it does not make a project ineligible to submit.

Project source stays in the builder's own public GitHub repository. Hookbuilder binds its exact repository identity,
commit, tree, source closure, tests and evidence into one immutable Application V3 revision, then opens a protected
Draft pull request in [`0xprogrammable/submit-launch`](https://github.com/0xprogrammable/submit-launch), immutable
GitHub repository ID `1320171831`.

## Complete journey

Finish the project and reach exact-byte `PROJECT_PREFLIGHT_VALID` before submission. Every generic project then uses:

```text
prepare-revision -> application -> submit plan -> explicit confirmation -> protected Draft PR -> status
```

`prepare-revision` resolves the exact next application revision and lineage. `application` replays the fixed local Git
objects and creates the closed review package. Both commands preview before an explicit local `--write`.

```bash
node "$SKILL_ROOT/scripts/cli.mjs" open-world prepare-revision \
  "/absolute/outside-source/application-v3-draft.json" \
  --source-root "primary=$REPOSITORY_ROOT" \
  --output "/absolute/outside-source/prepared-revision" \
  --write

node "$SKILL_ROOT/scripts/cli.mjs" open-world application \
  "$V2_PACKAGE" \
  --application-draft "/absolute/outside-source/prepared-revision/application.v3.json" \
  --review-package "$REVIEW_PACKAGE" \
  --security-assessment "$SECURITY_ASSESSMENT" \
  --security-evidence-bindings "$SECURITY_EVIDENCE_BINDINGS" \
  --source-root "primary=$REPOSITORY_ROOT" \
  --output "$APPLICATION_V3_PACKAGE" \
  --write

node "$SKILL_ROOT/scripts/cli.mjs" open-world submit "$APPLICATION_V3_PACKAGE" --dry-run
```

Repeat `--source-root <repository-ref>=<git-root>` for every companion repository. Inspect each command's `--help` for
the complete current input contract.

The first submit call is read-only. It returns the exact base revision, fork branch, Draft PR action, package digests,
external writes and one fresh confirmation digest. Only after explicit user authority for that digest may the same
package be submitted:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" open-world submit "$APPLICATION_V3_PACKAGE" \
  --mutation-receipt "/absolute/outside-package/application-v3-mutation-receipt.json" \
  --confirm-external-write "sha256:<exact-fresh-confirmation-digest>"
```

The confirmed client may create or use the authenticated builder's fork, create one application branch and create one
Draft PR against `0xprogrammable/submit-launch:main`. It never marks the PR ready, approves, merges, deploys, signs,
routes, launches, changes an account or moves funds. `open-world update` uses the same confirmation boundary for a new
immutable revision; `open-world status` is read-only.

## Protected intake contract

| Field | Value |
| --- | --- |
| Repository | `0xprogrammable/submit-launch` |
| Immutable GitHub ID | `1320171831` |
| Base branch | `main` |
| Revision directory | `submissions/<application-id>/v3/revisions/<application-revision>/` |
| Root document | `application.v3.json` |
| Pull-request state | Draft only |

One application PR adds exactly one immutable revision directory containing `application.v3.json` and its exact bound
application-package records. Trusted base workflow code fetches and validates bounded candidate data without executing
the applicant repository, package hooks, Git hooks, workflows or scripts. A changed central base, source revision,
package, identity, intake state or planned write invalidates confirmation.

Do not hand-create or reshape the package in the central repository. Regenerate it from the exact source revision and
use the namespaced V3.1 transport. The old six-file `prepare-pr` path remains legacy compatibility only and must not be
used for a generic project. `handoff preview` is a diagnostic fallback when V3.1 preparation is blocked, not a parallel
submission format.

## What a Draft proves

Remote readback of the exact Draft PR proves only that a revision was submitted for review. Keep these states separate:

- submitted is not reviewed;
- reviewed is not approved;
- approved is not deployed;
- deployed is not indexed, routed, available or launched; and
- a green check or merged review thread is not an audit or safety guarantee.

Unknown mechanics stay eligible and can be routed to architecture or independent review. Findings must bind the exact
revision and evidence; the Builder cannot disposition its own findings or issue launch authority.

## Historical paths

Existing V1 and six-file V2 application records remain immutable compatibility history. New generic projects use
Application V3.1 in Submit a Launch. New Applicant PRs never target Hookbuilder, and template intake remains a separate
contract.
