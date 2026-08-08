# Open-world v2 release gates

This checklist controls promotion of the local open-world v2 candidate. It does not record a current pass. A gate is
green only when an exact candidate commit and its generated receipt contain the named evidence. Passing local checks
does not publish the Builder, accept an application, approve a project, deploy a hook, activate a Registry contract, or
prove production safety.

Use [`OPEN_WORLD_V2_ARCHITECTURE.md`](OPEN_WORLD_V2_ARCHITECTURE.md) as the design contract and
[`RELEASING.md`](RELEASING.md) for the repository's general immutable release process.

## Evidence rules

- Record `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, or `NOT_APPLICABLE` with an exact command, commit, artifact digest and
  timestamp. Do not convert absence into a pass.
- A generated schema-valid object is structural evidence only.
- A declared or referenced test is not evidence that it ran.
- A local pass is not public CI, an independent audit, a provider result, an onchain receipt, or human approval.
- Model-backed evals require explicit provider credential and cost authority. If they are not run, record `NOT_RUN`.
- Historical v1 evidence stays attached to v1. A v2 implementation needs v2 evidence.
- A release blocker must identify the concrete failed invariant or missing authority; novelty and lack of a template are
  not blockers.

## Gate 1 — versioned machine-contract closure

Release only when all changed contracts move as one coherent versioned set:

- idea source, intent contract, architecture decisions, open project submission, intent fidelity and layered security
  schemas are present and referenced by stable repository paths;
- `submission.v2.json` validates against
  [`submission-v2.schema.json`](../skills/programmable-v4-hook-builder/references/submission-v2.schema.json), declares
  `schemaVersion: 2` and `standardVersion: 2.0.0`, and content-binds all four intent-package artifacts;
- every V2 `chainId` round-trips as a canonical positive `uint256` decimal string across submission, fee, application
  and launch contracts; JSON numbers, zero, signs, whitespace, leading zeros, fractions and values above `2^256 - 1`
  fail closed;
- `applicationRevision` round-trips as a canonical positive decimal string across Application V3, Registry Acceptance
  V3 and Launch V2, including values above `1,000,000` and JavaScript's safe-integer range; V3 starts at `"1"`, updates
  advance by exactly one from content-bound lineage, and V1 remains frozen as integer;
- examples validate against the exact schemas without private data, executable payloads or placeholder proof;
- any security-assessment artifact validates against the open-world security schema without being treated as an intent
  source, audit result or approval; a source-owned submission may keep this binding null or pending until derivation;
- source-owned proposal submissions may keep the security assessment null or explicitly pending/unassessed, and no
  source-committed artifact claims the Git revision that would have to contain that same artifact;
- fee-policy and security schema bytes remain distinct from their project instances; proposals do not fabricate a fee
  instance and keep fee applicability `unresolved`; an `applicable` prototype binds a real `fee-policy.v2.json`, an exact
  zero-scope `not-applicable` prototype keeps the instance/conformance/review binding null, and no schema file can satisfy
  an evidence-instance role;
- the repository contains at least one complete, schema-valid fresh-idea v2 starter package, and the scaffold can
  create that package without inheriting legacy intent, approval or evidence; templates remain optional accelerators;
- `open-world init` is dry-run by default, preserves the exact public-safe idea, refuses unsafe paths and existing
  destinations, and only an explicit `--write` atomically creates the eight unconfirmed v2 artifacts without network,
  submission, approval or readiness claims; that bootstrap shape is not a project file-count limit;
- validator, materializer, CLI, package generator, trusted central validator and documentation agree on schema,
  standard, application-contract and fee-profile versions;
- Registry acceptance validates against
  [`registry-acceptance-v3.schema.json`](../skills/programmable-v4-hook-builder/references/registry-acceptance-v3.schema.json),
  remains a distinct maintainer-owned record, and is never embedded in the source/application commit whose own Git
  identity it would need to predict;
- the Builder's authorizing V3 resolver uses only its closed production transport, while injected/mock transports are
  inspection-only; it double-snapshots current central main and raw-Git replays the exact acceptance, canonical index
  and digest-bound project there. The index and project must still select that acceptance, remain launch-eligible,
  match the accepted source and preserve the exact applicable Fee V2 projection; a superseded, suspended, retired or
  orphan acceptance therefore fails even though its immutable historical file remains on main. A live
  external canary and independent platform re-verification remain required for `MATCHED`;
- generated plugin manifests and knowledge routing reference only files included in the portable skill;
- every new required field has migration semantics and negative tests;
- the restricted schema engine evaluates every keyword used by the bundled stable contracts or rejects that bundled
  schema definition. For a syntactically valid content-addressed repository extension, unsupported vocabulary routes
  to `INTEGRATION_PENDING` with the idea eligible and automatic materialization disabled; malformed schemas or
  disproven assertions remain invalid, resource exhaustion routes to split review, and no assertion is silently ignored;
- no published tag, exact historical application bytes, frozen fee-v1 policy/kernel, receipt or evidence bundle is
  reinterpreted or overwritten; new semantics use a new version or explicit forward migration; and
- repository tests fail on version skew, missing routed files, stale digests and hand-edited generated artifacts.

Required result: one exact candidate cannot mix a v1 submission, v2 intent claim, v1 fee receipt and v2 application
status without an explicit compatibility projection that fails closed.

## Gate 2 — intent fidelity and language neutrality

The deterministic and agent-behavior suites must demonstrate:

- verbatim public-safe idea capture before archive or template selection;
- secret and private-data redaction without publishing or hashing the sensitive original;
- exact public-financial-identifier attestations bind the RFC 6901 pointer, matched-substring digest, application,
  owner confirmation and one authorization review record, remain human-review-required, prove neither ownership nor
  approval, and can never waive credentials, keys, passwords or tokens;
- byte-accurate provenance from intent facts to the source entry;
- German and English plain-language cases produce equivalent semantic facts without requiring protocol keywords;
- at least one additional non-English case and spelling-imperfect input remain eligible;
- explicit structured facts override absent or conflicting keyword heuristics;
- only material owner choices cause a question; derived v4 and repository choices do not;
- delegated reversible defaults are visible and do not expand beyond the delegation;
- every material fact traces through architecture, source and executable test or remains visibly unresolved;
- unconfirmed economic, trust, custody, failure or exit drift blocks promotion; and
- archive similarity and starter selection cannot overwrite the intent contract.

Agent eval definitions must include binary rubrics for a contract-priced sell-and-burn model, an unfamiliar app or game,
an unsafe mechanism with a close safe redesign, and an idea that fits no catalog entry. Structural validation of those
definitions and actual model execution are reported separately.

## Gate 3 — open-world graph coverage

The versioned submission and validator must accept and correctly review, without product-category allowlists:

- multiple project assets and open asset roles, with exact currencies and quote basis bound per canonical v4 scope;
- additional pools or markets with distinct price formation and settlement;
- every market has one explicit execution class; proposal-only `unknown` keeps fee applicability `unresolved` and grants
  no fee exemption, `programmable-canonical` makes it `applicable` and binds exactly one Fee V2 scope, while a complete
  graph of only `external` and `non-launchable` markets can be `not-applicable`, binds no fake Fee V2 instance and cannot
  be used to disguise a Programmable execution path;
- multi-hook, composed-hook and non-hook components where protocol constraints are explicit;
- a project spanning contracts, a web or game client, service, indexer, keeper, metadata and companion repositories;
- new, fixed, dynamic, rebasing, minting, burning, redeeming and externally created assets when their actual behavior is
  modeled;
- positive-liquidity AMM, partial custom accounting and reviewed full-consumption zero-AMM accounting;
- lifecycle graphs where token creation, a PoolKey or AMM liquidity formation is inapplicable, without fabricating v4
  transitions; any transition required by the chosen architecture remains explicit;
- transparent custom auto-liquidity triggers and other owner-defined mechanisms routed to review; and
- unknown entity, fact, capability and decision kinds with bound non-executable schemas.

Bounded parser, file, graph and transport limits may exist for denial-of-service resistance. Exceeding one must produce
a precise `SPLIT_REVIEW_REQUIRED`, tooling or architecture-review result and an explicit fragment path, not a claim
that the product idea is unsafe.

Negative tests must also prove that openness does not admit duplicate ids, dangling references, identical PoolKey
currencies, ambiguous canonical-scope or quote-currency bindings, unbound schemas, executable intent payloads, path
traversal, hash mismatch, or contradictory lifecycle states.

## Gate 4 — surface-triggered safety and safe-redesign behavior

Every architecture covers its real authorization, conservation, dependency-integrity, failure and exit boundaries.
Tests bind actors, assets, liabilities, beneficiaries, trust, outage behavior, recovery and retirement without inventing
a hook, token, pool or user entitlement that the product does not have.

Only a confirmed v4 hook or unlock surface additionally requires immutable PoolManager authentication,
router-versus-user identity, permission-mask/address agreement, callback selectors/return lengths, settlement and zero
unresolved deltas after each successful unlock. Only exposed canonical v4 swap modes require direction/exactness,
partial-fill, slippage and price-limit coverage. Return-delta backing, signed bounds, conservation and NoOp branch tests
apply only where return deltas are enabled; a conditional no-op on a branch that does not claim custom accounting is a
review case, while a no-op on the branch claiming custom accounting is a redesign predicate. Four-quadrant and Fee V2
vectors are not fabricated for a pure service, indexer, async non-hook settlement or an unexposed mode.

When present, native/ERC-20 quirks, reentrancy, nested calls, donation, MEV, oracle, randomness, game result, keeper,
bridge, server, upgrade, pause, sweep, custody and claim surfaces receive their own exact tests and review.

Source-signal extraction must remain monotone: an observed control or risk survives later contradictory declarations,
and an absent source match remains `unknown`. Scanner limits, unsupported syntax and missing build information must be
reported as incomplete evidence, never as proof that a behavior is absent or safe. Solidity rules run only on explicit
matching `.sol` or build-info evidence; other languages and mismatched paths cannot inherit Solidity conclusions.

Every adverse automated finding must name its exact rule, bound artifact location, observed evidence and remediation.
Tests must prove that unsupported or conflicting analysis remains submit-able as `INDEPENDENT_REVIEW` or `HOLD` rather
than becoming a product-level unsafe verdict or an authorization. Builder-controlled artifacts may attach
counter-evidence but cannot self-waive a finding. Partial, disputed and language-mismatched automated findings remain
review holds; only exact correctly scoped builder/reviewer-confirmed drain or deception behavior can require safe
redesign. Any later confirmed, remediated, not-applicable or false-positive disposition belongs to the trusted Registry
or maintainer review plane and must bind one exact application revision, finding identity, evidence and reviewer without
deleting the original evidence or carrying the decision into a later commit.

Adversarial cases must exercise the exact hard predicates: unauthorized or undisclosed irreversible disposition;
undisclosed/unbound managed redemption; seizure/redirection of owed value; privileged movement below enforceable backing or reserved-liability floors; payout
outside prior consent/immutable rule; fee-floor or immutable destination bypass; an unbacked immediately redeemable or
falsely guaranteed claim; false autonomous exit; participant-funded or enforceable-entitlement exposure to biasable or
unbounded-withholding randomness; and no-op return delta on a path claiming custom accounting.

Positive counter-cases must remain reviewable rather than automatically rejected: disclosed bounded controls,
invariant-preserving rebalancing, sponsor-funded disclosed-bias randomness without participant/enforceable value at risk,
authorized disclosed burn/donation with no continuing entitlement, beneficiary-bound disclosed managed redemption and
contingent/defaultable claims. The report preserves legitimate intent and every material difference. No automated result
may label an arbitrary candidate safe, audited, rug-free, approved or launch-ready.

## Gate 5 — fee-v2 profile and economic invariants

Keep `programmable-volume-fee-v1` and its historical receipts frozen. A new fee profile must have a distinct id,
version, schema, reference implementation, vectors and conformance receipt.

The project-level applicability derivation must first prove exactly one state. `unresolved` is review-only and grants no
exemption. `applicable` requires the Fee V2 instance and evidence below for every canonical scope. `not-applicable`
requires a complete zero-scope graph, no unknown/canonical surface and null fee instance, conformance and fee-review
bindings. Classification cannot be self-declared to evade an observed Programmable surface.

Fee V2 `complete` conformance must resolve the closed `fee-conformance-receipt-v1` and exact canonical
`fee-conformance-vector-set-v1` bytes through the submission evidence index. Free-form strings, screenshots and untyped
logs cannot complete the gate. The receipt binds implementation/source, exact scope/profile, execution-surface digest,
surface/mode mapping, vector digest and every supporting evidence digest; all math is recomputed by the authoritative
core.

For an `applicable` project, the v2 evidence set must prove for every declared fee scope:

- the cumulative whole-unit entitlement and carried numerator remainder equal exactly 10 bps (0.10%) of executed gross
  quote-side volume for the immutable Programmable fee owner;
- the platform share is inclusive in the effective hook charge and is never added twice;
- zero selected project fee still produces the platform share;
- a selected project fee produces the exact disclosed remainder after the platform share;
- every accepted user-funded rate is below the mathematical 100% ceiling, and an atomic execution either leaves a
  positive quote residual or routes to a fully funded alternative profile without negative output or insolvency;
- a custom rate at or above 100% uses only exact segregated sponsor/collateral funding and proves prefunding solvency,
  underfunded-no-state-change and refund/cancellation obligations for every exposed mode;
- every actually exposed execution mode uses the same declared basis; a canonical v4 scope exposing all direction and
  exactness modes proves all four quadrants, exact input/output and partial fills, while another profile proves its own
  real surface rather than synthetic v4 callbacks;
- cumulative rounding is fragmentation-resistant across tiny trades, split versus unsplit execution and claims;
- the minimum supported positive gross quote amount is exercised, including coarse-decimal assets;
- platform and project liabilities remain nonnegative, conserved, separately claimable and isolated by exact chain,
  pool, quote currency and beneficiary;
- the set of Fee V2 scopes equals the set of `programmable-canonical` markets one-for-one, with no missing, duplicate,
  external or non-launchable scope and no execution-class relabeling bypass;
- claims do not reset rounding state, cross-pool netting is disabled and same-pool nested actions cannot bypass accrual;
  and
- fee bounds, disclosure, failure and claim authority match the exact runtime implementation.

The immutable fee wallet and independent platform-admin wallet must be tested as separate authorities. Admin
authorization must not claim, replace, redirect, sweep or net the Programmable liability; fee ownership must not grant
launch administration.

Required local evidence includes pinned formatting and compilation, unit tests, boundary vectors, differential tests,
fuzzing, stateful invariants and static analysis. The bundled `standard-amm` implementation also runs its exact
reference-kernel conformance suite; every other collection profile supplies equivalent profile-specific implementation
and evidence instead of inheriting that result. An independent reviewer should reproduce value-flow, rounding and
claim results before release. Schema acceptance alone is a failure of this gate.

## Gate 6 — migration and historical evidence

The historical recheck and forward-migration paths must prove:

- an exact six-file historical application package and bound source checkout are verified by hashes and Git objects;
- the historical bytes, declared result, schema version and provenance are preserved;
- the old validator result is not represented as replayed unless it actually ran under the historical environment;
- no v2 approval, fidelity result or readiness state is inherited;
- unavailable original intent becomes an explicit data gap requiring recapture or owner confirmation;
- a v2 target is a separate revision with lineage, not an in-place rewrite;
- every source/closure/evidence/recheck change runs through a revision draft that omits `applicationRevision` and
  `lineage`, followed by GET-only `open-world prepare-revision`; source A to source B must produce the unique next
  content-bound revision rather than reuse or manually increment history;
- the current object database can replay commit A when the same numeric repository advances to B; removed or replaced
  predecessor repositories use an explicit old root only when their objects are otherwise unavailable, including a
  removed inline companion in mixed manifest/inline history, while fully remote-replayable all-inline history rejects
  an unnecessary mapping;
- missing historical objects report `INTEGRATION_PENDING` without idea rejection, while wrong commit/tree/blob,
  duplicate JSON, schema drift or corrupted closure remains invalid;
- dry-run performs no repository write, network request, PR update, submission or external action;
- explicit local materialization creates only one new destination by verified staging and atomic rename, never
  overwrites the source or an existing directory, creates exactly the nine versioned migration artifacts, leaves the
  proposal fee-policy instance null and applicability unresolved until architecture resolves the complete graph, and
  does not invent confirmed intent or
  fidelity; and
- malformed, non-canonical, replaced, symlinked, oversized or mismatched packages fail closed with stable codes.

The command and core implementation are
[`application-recheck.mjs`](../skills/programmable-v4-hook-builder/scripts/application-recheck.mjs) and
[`open-world-migration-core.mjs`](../skills/programmable-v4-hook-builder/scripts/open-world-migration-core.mjs).

## Gate 7 — GitHub application and human review

Before announcing v2 application compatibility:

- `open-world prepare-revision` is dry-run by default, derives revision/lineage from exact local sources plus only
  authenticated GET requests, accepts no hand-authored revision/lineage, and with `--write` creates only a new atomic
  root containing `application.v3.json`;
- `open-world application` is a separate zero-network operation, is dry-run by default, reads only explicit exact source roots, validates the complete v2
  submission/intent/fidelity/fee/evidence closure and materializes only through explicit atomic `--write` into a new
  destination outside every source repository;
- both local output planners reject containment in the Builder worktree, an input/draft root, every current or
  historical source worktree, linked-worktree Git directories, shared Git common directories, the primary object store
  and recursively referenced external Git alternate object stores; initial malformed or unstable metadata fails before
  network access, and bounded root snapshots are revalidated before staging and atomic rename so later drift fails
  before final output;
- Application V3 accepts exact public GitHub repositories only; private repositories, other Git hosts, ZIPs, pasted
  source and upload forms report `INTEGRATION_PENDING`, preserve idea eligibility and perform no public-package or
  external write, without becoming product-category findings;
- the separate versioned, namespaced `open-world` GitHub preparation path resolves public repository identity and
  reachability, preserves the
  locally verified commits/trees and produces a read-only external-write plan before any submit/update action;
- `open-world submit` and `open-world update` require explicit confirmation of the exact current plan digest, while
  `open-world status` is read-only; top-level submit/update/status remain historical V1 and reject V3 packages;
- the generated central package and trusted base-branch validator both implement
  [`public-pr-application-v3.schema.json`](../skills/programmable-v4-hook-builder/references/public-pr-application-v3.schema.json);
- the local
  [`public-pr-application-v3-core.mjs`](../skills/programmable-v4-hook-builder/scripts/public-pr-application-v3-core.mjs)
  checker and the trusted base-branch validator agree on the same negative and positive corpus, while local structural
  success is not misreported as remote Git verification;
- the v3 root application artifact is named `application.v3.json` consistently in generation, package closure, trusted
  validation, update and status paths;
- after every source commit is frozen, the generator derives the source-assessed security instance and one exact
  source-verification report per bound repository into the central application package with `repositoryRef: null`;
  launch and acceptance consume those application records, while tests reject source-bound self-reference;
- the Application V3 package binds fee applicability derived by replaying the exact source submission: `applicable`
  requires the real fee instance and review artifact, `not-applicable` forbids both, and `unresolved` cannot masquerade
  as either;
- pull-request path isolation prevents application data from modifying trusted validators, workflows or product code;
- small source closures use the bounded inline path, while larger primary or companion repositories use the
  content-addressed
  [`source-closure-manifest-v1.schema.json`](../skills/programmable-v4-hook-builder/references/source-closure-manifest-v1.schema.json)
  path; crossing the inline limit is never an idea rejection or safety finding;
- manifest verification fails closed on repository/commit/tree mismatch, non-canonical order, duplicate or missing
  entries, sequence or range gaps, path traversal, symlinks outside the reviewed tree, blob mismatch, digest or byte
  count mismatch, role mismatch and unbound fragments;
- commit and tree remain in the outer application repository binding; the root manifest does not embed the containing
  commit/tree or require a cryptographic fixed point;
- one local read-only verifier walks the root manifest to every fragment and canonical JSON-Lines entry against the
  exact pinned Git commit, tree and blob objects, without network access, writes or candidate-code execution; validating
  only the root manifest is a failed gate;
- every raw Application V3, Submission V2, supporting record, extension schema, source manifest, JSONL entry, revision
  draft and launch artifact is fatal-UTF-8 and duplicate-key checked before semantic, privacy or integrity processing;
  positive/negative tests cover same-value, conflicting and Unicode-escaped duplicate keys, secret shadowing without
  secret echo, and typed resource-limit split-review behavior;
- positive tests cover a source closure larger than 4,096 paths, multiple fragments, a companion repository and
  deterministic regeneration, while inline and manifest representations of the same closure resolve to the same
  reviewed file set;
- Manifest V1 accepts only SHA-1 Git object databases, separately verifies SHA-256 content digests and requires UTF-8
  committed paths; a Git SHA-256 object database or non-UTF-8 path produces no write and reports
  `INTEGRATION_PENDING`, `ideaEligibility: ELIGIBLE_FOR_REVIEW`, classification `tooling-transport`. A UTF-8 path above
  the current 16 KiB byte budget reports `HOLD_SPLIT_REVIEW` and `tooling-split-review`. Other object formats or path
  encodings require a separately versioned closure schema, generator, verifier, migration and cross-format corpus;
- untrusted candidate code, hooks, Git filters, submodules and build scripts are never executed by the trusted intake
  path;
- builder identity, application lineage, revision/update rules and status reads are tested against substitution and
  replay;
- application status distinguishes architecture review, required changes, tooling blockage, maintainer acceptance,
  deployment and availability; and
- unresolved or disputed automated findings can enter independent review without self-approval; a trusted disposition
  record binds the exact revision, finding identity, evidence and reviewer and cannot be authored by the builder-owned
  package or inherited by another commit; and
- an accountable human reviewer decides intent, economics, custom math, custody, authority, trust, disclosure, legal
  rights, residual risk and whether evidence represents the promised behavior.

The post-review launch request must validate against
[`launch-bundle-input-v2.schema.json`](../skills/programmable-v4-hook-builder/references/launch-bundle-input-v2.schema.json),
content-bind the exact application, submission, fee policy, security assessment, evidence and source revisions, and
keep the fee recipient separate from the independent admin authorizer. An input bundle has no inherited approval and
no human authorization; the separately reviewed authorization path must fail closed on every unresolved, conflicting,
stale or mismatched binding.

It must also bind the exact `execution-surface-coverage-v1` artifact and verify its Application V3 revision,
source-verifier aggregate, derived security hash, entrypoint artifacts, candidate/declared closure, canonical Fee V2
scope, and external reachability/control. A decoy, hidden route, declaration-only external venue or missing scope is a
conflict, not a route around fee or launch review.

The request also carries nullable canonical Registry acceptance. Null means pre-acceptance and must produce
`UNRESOLVED` plus `NOT_AUTHORIZED`. A non-null record must bind the exact application, source, submission, fee, security,
verification reports and maintainer decision; it omits its own containing commit/tree, while the outer launch input
binds the exact Registry repository, commit, tree, path, blob and digest. A merged pull request or builder-authored
acceptance object cannot satisfy this gate.

Registry Acceptance V3 may accept an exact `not-applicable` zero-scope application with null fee paths and hashes. The
Launch V2 gate must still return `NOT_AUTHORIZED`, because it authorizes only an applicable Programmable execution
handoff. Supplying an irrelevant fee artifact, changing the acceptance state or relabeling a surface must fail closed.

Its deterministic preparation report must validate against
[`launch-bundle-output-v2.schema.json`](../skills/programmable-v4-hook-builder/references/launch-bundle-output-v2.schema.json),
remain `NOT_AUTHORIZED`, contain no transaction, signature or external action, and report every binding as matched,
unresolved or conflicting without converting structural success into launch authority.

The Builder and the agent that produced a project cannot approve their own output. Maintainer acceptance binds one exact
revision and evidence set; it does not automatically deploy, index, quote or launch the project.

## Gate 8 — repository, host and token-efficiency verification

At minimum, run from the exact candidate:

```bash
npm test
gh skill publish --dry-run
```

Then complete the release rehearsal from [`RELEASING.md`](RELEASING.md), including clean installations for Codex,
Claude Code and at least one additional Agent Skills host, installed-package verification, deterministic archive,
manifest, checksums and SBOM.

Also verify:

- the entry `SKILL.md` stays within its documented line and context budget;
- ordinary ideas do not load advanced unrelated knowledge;
- complex and owner-defined ideas load the necessary intent, architecture and security references;
- every routed path exists in the portable archive and no repository-only path is required at runtime;
- deterministic scripts handle fragile hashing, validation, migration and packaging instead of relying on prompt prose;
- unknown ideas route to architecture review without a token-expensive full-catalog scan; and
- no mode infers an ordinary one-token launch or standard implementation from a single prompt word; routing follows
  confirmed capabilities, surfaces and explicit packs;
- fresh-agent forward tests receive raw user prompts and do not receive the intended answer or private implementation
  discussion;
- model provider selection is external to semantic prompts/rubrics, an explicit provider matrix can add lanes without
  invalidating the suite, and cross-agent claims require separate authorized receipts for OpenAI and at least one third
  provider/host in addition to any reproducible example lane.

Model-backed eval execution, when authorized, must record model id, provider, prompt suite digest, cost, timestamp and
raw result artifact outside the repository. Do not describe a structurally valid eval suite as a model pass.

## Gate 9 — independent and external release states

The following are separate from local product completion and must remain explicit:

| State | Required authority or evidence |
| --- | --- |
| Candidate locally reproducible | Exact clean commit plus local receipts and artifacts |
| Public CI green | Protected workflow results for that commit |
| Independently reviewed | Reviewer identity, scope, exact revision and findings disposition |
| Builder release published | Explicit owner authority, protected tag, GitHub release and checksum verification |
| Installed release verified | Clean install from the public immutable tag and matching tree |
| Application V3 Registry intake active | Trusted Registry contract/workflow deployment and live canary |
| Project accepted | Maintainer decision for the exact project revision and evidence |
| Project deployed | Authorized chain transaction, source/runtime matching and configuration receipts |
| Project available | Indexer, interface, routing/provider and monitoring evidence for the exact runtime |

None of these states can be inferred from another. In particular, a published Builder is not a project audit, an
accepted application is not deployed, a deployed hook is not necessarily routed by external interfaces, and observed
availability is not an endorsement or guarantee of economic safety.

## Final go/no-go record

Before release authority is requested, create one candidate receipt with the following matrix. Do not edit this
document to manufacture a pass; link immutable artifacts from the receipt.

| Gate | Required status |
| --- | --- |
| Versioned machine-contract closure | `PASS` |
| Intent fidelity and language neutrality | `PASS` |
| Open-world graph coverage | `PASS` |
| v4 safety and safe-redesign behavior | `PASS` |
| Fee-v2 profile and economic invariants | `PASS` |
| Migration and historical evidence | `PASS` |
| GitHub application and human-review path | `PASS` |
| Repository and host portability | `PASS` |
| Model-backed evals | `PASS` for any behavioral/model claim; authorized `NOT_RUN` permits only a reduced package/docs claim that says model behavior is unverified |
| Independent audit/review | recorded truthfully; release owner decides whether a documented deferral is acceptable |
| External publication, Registry activation and deployment | outside local candidate; never implied |

Any failed core invariant, version skew, untraceable material intent, fee-evidence mismatch, self-approved state or
historical-evidence rewrite is a no-go. A novel but fully disclosed idea is not.
