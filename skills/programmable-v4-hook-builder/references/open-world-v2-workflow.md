# Open-world v2 workflow

Use this workflow after the idea compiler selects an architecture, or to repair/review an existing v2 project. Treat v2
as a candidate contract until every applicable gate passes. Local validity never means audit, approval, Registry
acceptance, launch authority, deployment, availability, or provider support.

## 1. Preserve and compile

Store only the public-safe verbatim UTF-8 idea. `open-world init` below creates only an unconfirmed Explore proposal; it
does not create a canonical Autopilot repository:

```bash
node "$SKILL_ROOT/scripts/open-world.mjs" init \
  --application-id "$APPLICATION_ID" \
  --idea-file "$IDEA_FILE" \
  --output "$PACKAGE_DIRECTORY" \
  --repository-root "$REPOSITORY_ROOT"
```

Review the preview, then repeat with `--write` only when an unconfirmed proposal is the intended output. For an
Autopilot build use the productive `project materialize` command after the architecture and implementation inputs are
ready. Perform no network or GitHub action.

Custom tradable implementation is open-ended. Once architecture is selected, author the complete Solidity and Foundry
test roots and materialize them without choosing a bundled profile:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" project materialize --idea-file "$IDEA_FILE" --application-id "$APPLICATION_ID" --classification tradable --market-ref "$MARKET_REF" --project-profile foundry --source-root "$SOURCE_ROOT" --test-root "$TEST_ROOT" --output "$NEW_REPOSITORY"
```

Dry-run first, then repeat with `--write`. This writes inert source, tests, exact dependencies and a local build plan;
it executes no candidate bytes. A missing trusted sandbox may leave test evidence unverified, but it must never block
source implementation. Central launch policy is evaluated later and is not an architecture or source allowlist.

When the selected architecture includes an application surface, replace `foundry` with the owner-declared layout label
`foundry-web`, `foundry-service`, or `foundry-game` and add `--surface-root "$SURFACE_ROOT"`. Accepted regular files,
tests, build manifests, caller-supplied lock bytes and assets are copied byte-for-byte with executable modes below
`surfaces/<label>`; empty directories are omitted. The label does not certify web, service or game semantics. Git
control paths, non-portable names, symlinks, path escapes, component-level secret risks, generated/dependency
directories, unresolved root build profiles and portable path collisions fail before output. Profile detection uses
the frozen input inventory, and the materializer rechecks the input plus exact committed and cloned inventories before
success. It runs none of those bytes.

The one bundled tradable profile is frozen legacy compatibility, not a current platform requirement. Require a natural
idea that independently names a Uniswap v4 hook, fees on executed gross quote volume, buy/sell rates immutable after
registration, policy `programmable-volume-fee-v2@2.0.0`, its inclusive 10 bps Programmable platform share, and claimant
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. Preview this legacy command without `--write`; never add or infer missing
intent. Its exact profile replay remains dry-run-only:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" project materialize --idea-file "$IDEA_FILE" --application-id "$APPLICATION_ID" --classification tradable --market-ref "$MARKET_REF" --reference-profile programmable-volume-fee-v2 --output "$NEW_REPOSITORY"
```

Use [business-system-compiler.md](business-system-compiler.md) to produce and validate `project-spec.v1.json`, all nine
graphs in `product-graph.v1.json`, the required three-role `architecture-candidates.v1.json`, and
`repository-plan.v1.json`. Process schemas through the project compiler; inspect only a failing section. Preserve
unresolved facts and owner/external blockers instead of inventing them.

Classify the ProjectSpec routing entry as `tradable`, `no-market`, or `unresolved`. Every selected tradable market needs
content-addressed, policy-neutral route and quote/execution evidence; `no-market` gets neither. The bundled
`trade-capability.v1.json` carries the frozen Fee V2 projection and is emitted only by the exact intent-bound legacy
profile. Custom tradable source and tests still materialize; only canonical launch-manifest, route evidence and approval
remain unresolved until their later submission gates are satisfied.

Validate the hash-bound phase without executing its planned commands:

```bash
node "$SKILL_ROOT/scripts/project-compiler.mjs" validate \
  --brief \
  --repository-root "$REPOSITORY_ROOT" \
  --state "$PROJECT_STATE_PATH"
```

After no-market source materialization, the output contains one clean source commit plus a `materializing` plan bound to
that exact commit and branch. The plan is transient on one specifically ignored path and every command declares
`executionPolicy.externalWrites: false`. The portable command below never executes its argv; it validates the source and
plan boundary, then exits 2 with `PROJECT_EXTERNAL_SANDBOX_REQUIRED`:

Custom tradable materialization commits `.programmable/custom-tradable-build-plan.v1.json`. It then emits the ignored,
local-only `.programmable/custom-tradable-materialization-receipt.v1.json` outside the commit so the receipt can bind the
actual emitted commit/tree without a self-reference. Validation checks that receipt against every committed path, byte,
Git mode and cloned working file, and reconstructs its closed semantic schema from the tracked plan and declared profile.
Commands remain `NOT_RUN`; absence of execution evidence does not erase the
implemented repository or turn its source status into `EXTERNAL_BLOCKED`.

For iterative developer feedback only, an already active workspace sandbox may run the generated plan's explicit
offline format/test commands. Treat that output as unauthenticated `LOCAL_ONLY` evidence: it cannot complete the plan.
On failure, edit the authored input roots and rematerialize; never patch generated output. Do not invoke `project execute`
merely to observe its expected external-sandbox blocker, and do not repeat a green command on unchanged bytes.

```bash
node "$SKILL_ROOT/scripts/project-compiler.mjs" execute \
  --repository-root "$REPOSITORY_ROOT" \
  --plan ".programmable/repository-plan.materializing.v1.json" \
  --output-plan ".programmable/repository-plan.v1.json"
```

Completion requires an external launcher/runtime isolated by a separate UID, container or VM and a receipt conforming to
`project-sandbox-receipt-v1.schema.json`. Verification binds the exact commit/tree, plan/command/input hashes,
launcher/runtime identities, enforced filesystem/network/secret/external-write/process policies, boolean network/write
observations and command/output hashes. It also verifies Ed25519 provenance against an independently configured trust
root. This release configures no production key, so a local unsigned or self-signed JSON file cannot satisfy the gate.
Only after trusted evidence exists may a host integration author a completed plan and immutable states; the portable CLI
does not provide that integration.

For the opt-in Docker planning format and structural signature inspection boundary, use `project-sandbox-host.md`.
Caller-supplied keys remain untrusted, outputs are not traversed, and both commands return `EXTERNAL_BLOCKED`; neither
executes candidate bytes, observes isolation, proves teardown, or imports completion.

Before showing or handing off ProjectSpec, ProductGraph, RepositoryPlan, ProjectState, Submission, or trade manifests,
require them as one byte-bound output. `--submission-root` is repository-relative and must contain only files declared
by the Open World package:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" project require-output \
  --brief \
  --repository-root "$REPOSITORY_ROOT" \
  --state "$PROJECT_STATE_PATH" \
  --previous-state "$PREVIOUS_STATE_PATH" \
  --submission-root "$SUBMISSION_PACKAGE_PATH"
```

Proceed only when the command exits zero with `PROJECT_PREFLIGHT_VALID`; `CLEAR` is source-only and
`DRAFT_UNRESOLVED` remains a noncanonical proposal. The report binds every project artifact plus the sorted complete submission
inventory. It rejects invented contracts, adjacent unbound files, identity/facet/applicability/market/route drift,
manufactured no-market evidence, unresolved completion, and non-byte-identical tradable manifests. It remains local
deterministic validation: commands are not reexecuted and no approval, audit, deployment, production, or issuer trust is
created.

Retain an immutable repository-relative chain:

```text
.programmable/project-states/000001-project-spec.v1.json
.programmable/project-states/000002-product-graphs.v1.json
.programmable/project-states/000003-architecture-selection.v1.json
.programmable/project-states/000004-repository-materialization.v1.json
.programmable/project-states/000005-verification.v1.json
.programmable/project-states/000006-submission-evidence.v1.json
```

Never overwrite a checkpoint. For sequence greater than one pass the immediately preceding path as
`--previous-state "$PREVIOUS_STATE_PATH"`. Each phase is one of `project-spec`, `product-graphs`, `architecture-selection`,
`repository-materialization`, `verification`, and `submission-evidence`. Increment its sequence and bind artifact hashes,
provenance classes, graph obligations, repository head, command receipts, blockers, next action, exact argv resume
command, and every approval/signature/deployment/publication/execution/Registry-write authorization as false.

## 2. Preflight the selected system

Derive `capability-composition-v1.json` with one schema-valid capability contract per component. Check it before code,
after every composition change, and before release evidence:

```bash
node "$SKILL_ROOT/scripts/composition-checker.mjs" \
  --input "$PACKAGE_DIRECTORY/capability-composition-v1.json" \
  --output "$COMPOSITION_REPORT_PATH"
```

Use a new sequence- or digest-bound report path for every run; the checker never overwrites. Resolve permission,
storage/namespace, delta, fee, authority, lifecycle, router, settlement, and dependency conflicts.
Route `INDEPENDENT_REVIEW_REQUIRED`. Every report keeps implementation, security, and deployment authorization
`NOT_GRANTED` and `independentReviewerRequired: true`; `NO_KNOWN_CONFLICT` never means safety or approval.

Do not derive a Programmable fee requirement from the graph. Load and derive the frozen Fee V2 package only when the
preserved project intent or an applicable current central-policy Rule ID selects that exact kernel. Otherwise create no
Fee V2 applicability, hook, pool, fee instance, or receipt. A local `Programmable-canonical` label is never sufficient.

For each v4 hook, require the typed semantic profile in `submission.v2.json`; permission booleans alone are
insufficient. Proposal gaps route to review; prototype gaps block. Bind PoolManager authentication/address, PoolId
isolation, callback/router/end-user identity, hookData domain and replay rules, all swap quadrants, delta signs and
closure, settlement, rounding, reentrancy/nested unlocks, router parity, deploy preimage, runtime hash, and evidence.

## 3. Materialize the whole repository

Build the selected product in a new isolated repository, not as snippets or a contract-only demo. Complete every
required repository-plan group: source, configuration, exact dependency locks, tests, deployment inputs, evidence, and
documentation. Include the app, router, service, indexer, game, oracle, keeper, vault, escrow, or other component only
when its graph node serves the user loop, a protected property, operations, or evidence.

For each tradable market, the configuration inventory contains its schema-valid trade manifest. It binds the exact
chain and PoolKey, router, quoter, Permit2 funding profile, hookData contract, supported and rejected direction/exactness
modes, slippage/deadline limits, fee behavior, dependencies, source and test contracts. Choose either the standard
Uniswap v4 route or an adapter bound to the canonical Programmable trade-execution contract and conformance evidence.
Neither form implies interface allowlisting, routing approval, deployment or availability.

Before choosing or changing a dependency, read [upstream-sources.md](upstream-sources.md). Use
`upstream-snapshot-2026-08-07.json` only as an observed exact-source snapshot and `builder-toolchain-lock-v1.json` as the
reproducible candidate lock; neither proves mutual compatibility. Select one coherent profile and bind compiler binary
hash, EVM target, optimizer/metadata settings, package integrity, full closure, CREATE2 deployer, final creation code,
constructor arguments, initcode hash, permission mask, HookMiner salt, expected address/runtime hash, PoolManager, and
chain profile. Invalidate the preimage after any relevant change.

## 4. Verify fresh behavior

Run reviewed argv commands from a clean checkout/install. Record declared, blocked, simulated, and executed evidence
separately. Require applicable build, compile, typecheck, lint, unit, negative, fuzz, invariant, fork, gas/code-size,
deployment, and submission checks. For v4 execution, exercise the real Universal Router/V4Planner/Permit2 or the exact
custom router, native ETH, exact-input/output, single/multi-hop, per-hop hookData, settlement/refund, and
quote-to-execution path. For no-pool/hybrid systems, test their actual settlement path instead.

Every supported manifest mode needs executor-authored quote and execution domain evidence from its exact declared test
command; every unsupported mode needs a pre-effects rejection test. Bind quote and execution to identical PoolKey,
hookData, direction/exactness, amounts, recipient, block context, route, slippage/deadline and fee model. Local or
read-only fork evidence remains untrusted deterministic evidence after static validation and never authorizes a trade.

Apply [security-and-evidence.md](security-and-evidence.md) to every selected trust/value surface. Require adverse tests
for wrong permissions/manager/sender/domain, malformed or replayed data, open or inverted deltas, NoOp behavior,
rounding, partial fills, cross-pool effects, unbound authority, fee bypass, oracle/keeper/bridge failure, token quirks,
source/runtime drift, and intent drift when applicable. Builder counter-evidence may dispute a finding but never waive it.

Validate the complete local package without network access or candidate-code execution:

```bash
node "$SKILL_ROOT/scripts/open-world.mjs" validate "$PACKAGE_DIRECTORY" \
  --repository-root "$REPOSITORY_ROOT"
```

`COMPLETE` means that durable deterministic receipt content matches the exact local commands and artifacts. Because the
receipts are unsigned and `validate` does not re-execute commands, the compiler reports repository completion as
`NOT_PROVEN` and receipt issuer trust as unverified. Arbitrary package scripts can also be semantically empty. Functional
completeness, unknown-idea quality, thresholds, and install-to-submission remain model-backed E2E release gates.

## 5. Freeze source and prepare evidence

Bind every primary and companion public GitHub repository by numeric id, exact commit, tree, and complete source closure.
Never execute candidate hooks, filters, submodules, or build scripts during closure. Route unsupported object/path forms
or verifier budgets to an exact split-review/tooling hold without rejecting the idea.

After source freeze, derive source-assessed security and verification reports against the already-existing commit; do
not create a Git self-reference. Current Applicant handoff uses only the protected top-level Submit Launch client and
its exact central policy binding. Read [github-application-v3.md](github-application-v3.md) and rerun V3 generation only
for an explicitly identified frozen Fee V2/Application V3 replay. Do not write to GitHub without exact authority, and
never treat a PR, merge, label, or Builder verdict as canonical acceptance. Without a public GitHub numeric repository
id, URI, commit, and tree, emit only a validated local transport plan marked `NOT_SUBMITTED`; never manufacture an
Application V3 package for current work.

## 6. Run release-only E2E evidence

Do not use response-only or self-judged evals as release evidence. From the Builder repository root, run the sealed
fresh-repository corpus across frontier, mid, and small model tiers with at least three fresh repetitions:

```bash
node scripts/evals/run-e2e-evals.mjs \
  --require-provider \
  --repetitions 3 \
  --output /absolute/new/path/e2e-scorecard.json
```

Use a new absolute scorecard path outside the repository. Configure the external subject and independent-judge
adapters/model ids from `--help`; keep the judge model distinct
from every subject. Give the subject only the installed skill and natural prompt; never reveal rubric, expected
architecture, mutation, or known weakness. Require full corpus, all tiers, holdouts, fresh
install/build/test/fuzz/invariant/fork/deployment/submission stages, p50/p95 token use, retries,
tool errors, questions, and manual intervention for release evidence. Treat filters as `PARTIAL_EVIDENCE`; treat missing
model/provider/RPC access as `EXTERNAL_BLOCKED`, never as a pass. Release only from the declared hard-gate scorecard and
an install-to-submission run; a harness validation proves only harness structure.

## 7. Report or hand off

Read [open-world-v2-output-contract.md](open-world-v2-output-contract.md). Report preserved intent, selected architecture,
exact repositories/revisions/trees, source closure, toolchain/dependencies, fee/security states, phase checkpoint,
commands and results, findings/counter-evidence, E2E evidence state, external actions, blockers, and next owner. Keep
application, independent review, Registry acceptance, launch authorization, deployment, and live availability separate.
Require an authenticated unchanged accepted revision before any later handoff; otherwise restart analysis.
