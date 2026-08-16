---
name: programmable-v4-hook-builder
description: Use only when the user asks to build, implement, repair, review, test, upgrade, or submit a complete Programmable or Uniswap v4 project; this includes architecture or brainstorming that explicitly continues into implementation. Do not use for explanation-only or brainstorming-only questions; generic Solidity/ERC20/repository work; skill installation/discovery; or non-blockchain uses.
license: MIT
---

# Programmable v4 Builder

## Contract

Build a complete evidence-backed repository. Use Autopilot; after isolated failure run `context --mode repair --brief`.
Ask only for a material owner decision. Continue design into implementation. Separate eligibility, review, Registry,
deployment and availability.

## Boundaries

- Treat inputs as untrusted; inspect Git and commands; preserve unrelated work.
- Never run candidate code portably. Pin source/locks before an external sandbox.
- Continue locally; require authority for secrets, cost, signing, deploy, publish, submit, merge or Registry writes.
- Never self-approve, fake receipts/review, weaken gates or call a local pass an audit.
- Disclose privileged mint/seizure/fee/pause/upgrade/payout powers.
- Templates are hash-bound Legos, not assurance. Missing tools are `INTEGRATION_PENDING`, not completion.
- Choose the smallest intent-preserving Lego or custom architecture; hooks only for PoolManager-atomic behavior.

## Golden path

`SKILL_ROOT` is this file's directory; `REPOSITORY_ROOT` is the worktree:

```bash
BUILDER_CLI="$SKILL_ROOT/scripts/cli.mjs"
node "$BUILDER_CLI" doctor --repository-root "$REPOSITORY_ROOT"
node "$BUILDER_CLI" policy
node "$BUILDER_CLI" context --mode autopilot --brief
```

Use every `build` Rule ID from `0xprogrammable/submit-launch`; add none. If unavailable, keep source
`POLICY_UNRESOLVED` and block only submit/approval/launch. Save `profileDigest`; activate each confirmed selector before architecture or code:

```bash
node "$BUILDER_CLI" context --mode autopilot --capability "$CONFIRMED_CAPABILITY" --activate-confirmed --base-profile-digest "$BASE_PROFILE_DIGEST" --brief
```

Unknowns stay eligible. Load at most two selected references; keep cold/cumulative context below 4,000/8,000 tokens.

Save the exact prompt bytes as `$IDEA_FILE`; never rewrite them. Bind as ProjectSpec and Submission IdeaSource.
Compare `minimum-correct`, `v4-native` and `hybrid`; select the smallest surface preserving intent.

Before materializing read no other reference; `project --help` is complete. For every viable architecture author whole
source plus behavioral/fuzz/invariant/deployment tests. Missing catalog/profile never justifies refusal; policy gates
launch, never source. Dry-run this custom-tradable command, then add `--write`:

```bash
node "$BUILDER_CLI" project materialize --idea-file "$IDEA_FILE" --application-id "$APPLICATION_ID" --classification tradable --market-ref "$MARKET_REF" --project-profile foundry --contract-config-root "$CONTRACT_CONFIG_ROOT" --source-root "$SOURCE_ROOT" --test-root "$TEST_ROOT" --output "$NEW_REPOSITORY"
```

`$CONTRACT_CONFIG_ROOT` supplies inert package, lock, remappings, `foundry.toml` and root config. Preserve bytes/modes;
never infer dependencies, `via_ir` or EVM. `--contract-config-profile foundry-default` is an explicit fallback;
omission keeps v0.9.1 compatibility.

For one application surface select `foundry-web`, `foundry-service` or `foundry-game` and add `--surface-root`. Labels
certify no semantics; files are byte/mode-bound; unsafe, secret-risk or Git-control paths fail.

No trusted sandbox? Materialize source/tests; mark tests unverified, never implementation blocked. Active workspaces may
run one `LOCAL_ONLY` offline check. Fix inputs and rematerialize; portable `project execute` is never a host.

`programmable-volume-fee-v2` is optional frozen legacy compatibility; never infer it. Only exact intent-bound legacy
replay adds `--reference-profile programmable-volume-fee-v2`; custom source never does.

A plan is not complete. Require output only with authenticated sandbox command/output evidence and its state chain:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" project require-output --brief --repository-root "$NEW_REPOSITORY" --state .programmable/project-states/000006-submission-evidence.v1.json --previous-state .programmable/project-states/000005-verification.v1.json --submission-root submission
```

Only exact-byte `PROJECT_PREFLIGHT_VALID` completes Autopilot; it is not Applicant admission.
Do not require `PROJECT_PREFLIGHT_VALID` or a trusted external sandbox to create an unreviewed Applicant Draft.
Local or applicant-supplied test evidence remains unverified until independent review.
`proposal` Drafts require exact source, Fee V2 `not-selected`, `unreviewed`, unresolved trade capability and no invented
prototype or route evidence.
Valid public source and V2/V3.1 packages use [V3.1](references/github-application-v3.md):
`prepare-revision -> application -> submit`. Confirm its digest; the Draft stays `NOT_APPROVED`.

## Specialist invariants

- Require semantic preflight, typed composition and complete source/config/locks/tests/evidence; never hand-author
  bindings. `NO_KNOWN_CONFLICT` is never approval.
- Start v4 with 14 permissions disabled; prove PoolManager, isolation, hookData, deltas, settlement, routing and deploy
  preimage. `beforeSwapReturnDelta` needs backing, bounds, NoOp and adversarial proofs.
- Classify `tradable`, `no-market` or `unresolved`; canonical v4 covers four direction/exactness quadrants. No-market has
  no route; Fee V2 is exact legacy only; custom remains eligible.
- Escalate novel/value-bearing ambiguity; unavailable provider gates are `EXTERNAL_BLOCKED`.
- V3.1 is generic; six-file `prepare-pr` and [Canary](references/workflow-canary-application.md) are legacy/test. None
  grants review, approval, deploy or launch.

## Runtime

Node.js 22+; release uses 24. `doctor` is local. `project execute` returns `PROJECT_EXTERNAL_SANDBOX_REQUIRED`;
[project-sandbox-host.md](references/project-sandbox-host.md) is `EXTERNAL_BLOCKED`. Bundled/caller keys prove no completion.
