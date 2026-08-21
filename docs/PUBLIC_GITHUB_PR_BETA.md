# Submit a Launch

Submit a Launch is the public review path for completed Programmable projects. Hooks, apps, services, games,
multi-repository systems and unfamiliar custom architectures use the same open application contract.

Hookbuilder is optional. A project built with another tool or by hand follows the same
[Submit a Launch requirements](https://github.com/0xprogrammable/submit-launch/blob/main/docs/COMPLETE_LAUNCH_REQUIREMENTS.md).

## Before submission

Prepare:

- one complete project package;
- exact public GitHub source for every repository in scope;
- a clean, immutable source commit and tree;
- the tests and evidence that actually exist; and
- an honest route state: no market, external, unresolved or official Programmable Ethereum.

Do not require `PROJECT_PREFLIGHT_VALID` or a trusted external sandbox to create an unreviewed Applicant Draft. Both are
optional stronger evidence. Local or applicant-supplied test evidence remains unverified until independent review.

## Use one command

From a completed project built with this Skill, run:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

The command:

1. binds the clean public source revision;
2. resolves one current Submit Launch contract snapshot;
3. selects the current accepted application contract;
4. applies the `submit` stage plan;
5. validates or resumes one application package; and
6. returns one read-only Draft plan or one repair.

Run only the safe next command it returns. Reinvoke the same command for status. Internal package assembly, queue
experiments and legacy transports are not part of the normal journey.

## Confirm the exact Draft

The first plan performs no GitHub write. It identifies the target, proposed change and one fresh confirmation digest.
Review that plan before authorizing the exact returned command.

The confirmed path may create or update one Draft pull request in
[`0xprogrammable/submit-launch`](https://github.com/0xprogrammable/submit-launch). It cannot mark the Draft ready,
approve, merge, deploy, sign, route, promote, launch or move funds.

A changed source revision or current contract invalidates the old plan. Resolve the new state and review a new digest;
never reuse a stale confirmation.

## Current and legacy application contracts

The current official-route path uses Application V3.2 with Submission 2.1. The protected Active Contract V2 binds the
current Applicant Compatibility V2 contract, which identifies the accepted application, submission and validation
artifacts.

V3.1 remains accepted as a legacy compatibility input. It does not establish the current official Programmable route or
launch readiness. Continue a V3.1 application by adding a new V3.2 revision linked through schema-migration lineage.
Keep the prior revision and its reports byte-for-byte unchanged.

An unknown future application major version is not guessed. The affected submission stage becomes
`INTEGRATION_PENDING` until a versioned adapter exists; unrelated local source work remains eligible.

Read [Application compatibility and migration](../skills/programmable-v4-hook-builder/references/application-compatibility-and-migration.md)
for the complete boundary.

## Route outcomes

| Route | Submit result |
| --- | --- |
| No market | Eligible without a fabricated fee route, Router plan or stamp. |
| External | Eligible without a Programmable Classic or Custom label. |
| Unresolved | Eligible as an honest Draft; route-dependent readiness remains pending. |
| Official Programmable Ethereum | Uses the current application contract and must satisfy the returned launch-readiness plan before launch. |

Submit a Launch owns the current requirements. Neither the Skill nor this guide copies fee, treasury, Router or Rule-ID
values.

## Read the result

| State | Meaning |
| --- | --- |
| `NEEDS_PROJECT_PACKAGE` | Complete the named project or application input. |
| `POLICY_UNRESOLVED` | The current central contract is unavailable; no stale checklist is substituted. |
| `INTEGRATION_PENDING` | The named contract, handler or integration is unsupported for this stage. |
| `READY_FOR_CONFIRMATION` | Review the exact read-only plan and confirmation digest. |
| `CHECKS_RUNNING` | Protected checks are still running on the Draft. |
| `REVIEW_REQUIRED` | The Draft is waiting for independent review. |
| `CHANGES_REQUESTED` | Repair the exact submitted revision and prepare a new bound plan. |

The result should expose at most the root causes needed for the next action. Full source, contract, policy and transport
bindings remain available as machine-readable evidence rather than a wall of console text.

## What a Draft proves

A verified Draft readback proves only that one exact application revision was submitted for review:

- submitted is not reviewed;
- reviewed is not approved;
- approved is not deployed;
- deployed is not indexed, routed, promoted or publicly available; and
- a green check is not an audit or safety guarantee.

A new source commit, contract snapshot or application revision creates a new review target. Old applications and reports
remain immutable.

For transport and trust details, read [Applicant journey](../skills/programmable-v4-hook-builder/references/applicant-journey.md)
and [Submit Launch resolver](../skills/programmable-v4-hook-builder/references/submit-launch-resolver.md).
