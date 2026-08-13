# Changelog

All notable Builder changes are recorded here. Historical releases remain immutable.

## 0.6.0 - 2026-08-13

### Added

- Added source-receipted, EVM-scoped Chainlink capability profiles and atomic packs for CCIP, CRE, Data Feeds, Data
  Streams, and VRF v2.5. Provider knowledge remains filtered guidance rather than availability, compatibility,
  deployment, approval, or audit evidence.
- Added independently authored Ethereum production invariants derived from a date-pinned ETHSkills review without
  copying its unlicensed source text.
- Added deterministic end-to-end budgets for total tokens, emitted bytes, tool calls, retries, latency, activated
  references, repository stages, and descendant agents. Missing required telemetry fails as `UNMEASURED`.
- Added a signed external-sandbox receipt contract for future separately trusted execution environments.

### Changed

- Reduced common CLI output to at most three primary root causes while retaining exhaustive machine-readable reports
  behind explicit output paths or `--json`.
- Reworked Chainlink selection into product-specific routing and project surfaces so unrelated provider context does not
  load by default.
- Revalidated the complete local Solidity compiler source closure before any compiler execution and report typed drift
  before executing changed bytes.
- Made the generated Codex plugin MCP resolve its identity from the payload manifest, including package layouts without
  a root `package.json`.

### Security

- Removed same-user candidate command execution from the portable Builder. Execution now fails closed with
  `PROJECT_EXTERNAL_SANDBOX_REQUIRED`; the bundled trust store is empty and caller-supplied keys cannot establish
  completion authority.
- Require independently proven repository completion before any output or preflight result can become canonical.
  Legacy or self-consistent command receipts remain structural evidence only.
- Preserved the immutable v0.5.1 release, historical V1 policy bytes, and fee-policy evidence while advancing the
  active package through a new minor version.

### Evidence boundary

- The public package release binds one exact commit, repository tree, portable Skill tree, release artifacts, checksums,
  SBOM, reference-kernel campaign, protected CI, and post-publication install canaries.
- Real model tiers and an independent judge, a trusted external sandbox, comparable public-repository E2Es, an
  independently novel holdout and prior comparator, pinned-fork cases, installed-host natural-language behavior,
  independent audit, deployment, Registry activation, and project approval remain separately unverified. The release
  does not convert those gates into passes.

## 0.5.1 - 2026-08-13

### Added

- One canonical Submit a Launch intake contract for repository ID `1320171831`, status schema `2`, generated six-file
  applications, and draft-only two-step GitHub writes.
- A schema-bound open-world project compiler for verbatim intent, complete product graphs, three comparable architecture
  roles, repository plans, and resumable phase state.
- Closed capability contracts and an executable composition checker for permission, namespace, delta, fee, authority,
  lifecycle, routing, settlement, and dependency conflicts.
- A complete v4 hook semantic contract binding all permission bits, PoolManager and identity models, hookData,
  swap quadrants, return-delta backing, routing, deployment preimages, and executable evidence.
- A sealed-after-design, versioned adversarial repository-evaluation corpus and fresh-repository harness with honest
  external-provider blocking, per-tier telemetry, leakage defenses, and nontrivial stage evidence. The corpus is not an
  independently novel blind holdout and its harness checks are not a substitute for the unexecuted provider/model matrix.
- A stable semantic-rule registry, all-module maintainability discovery, complexity and cycle checks, an exact local
  toolchain lock, and a current upstream provenance snapshot.

### Changed

- Raised the repository, portable Skill, generated plugin, Doctor, CI, and Submit a Launch application-check contract
  to a single Node.js 24 runtime line.
- New public Applicant requests target `0xprogrammable/submit-launch`; Hookbuilder pull requests #10, #11, #12, #14,
  #15, #18, #19, and #20 remain legacy continuations only. Neither path requests a Registry or Router write.
- Source-assessed prototypes without source-derived semantic coverage now require independent review instead of passing
  through an empty declared profile set.
- The free custom/no-pool starter no longer fabricates a Programmable canonical fee scope; fee applicability follows
  the selected graph and an explicit execution scope.
- The central skill is a compact router with measured cold and standard context budgets and phase-specific disclosure.
- Plugin and MCP version identity now derive from the canonical `0.5.1` package source.

### Security

- Historical V1 schema and fee-policy bytes are explicitly frozen from this release forward without rewriting earlier
  history.
- The reference-kernel campaign adds real Universal Router/V4Planner/Permit2 route parity while retaining the documented
  exact-output stale-witness ordering limitation.

## 0.5.0 - Unreleased private candidate

### Added

- Open-world Submission V2 contracts for verbatim multilingual idea provenance, semantic intent, append-only
  architecture decisions, intent-to-code fidelity, arbitrary product graphs and owner-defined non-executable profiles.
- Fee Policy V2 with exact inclusive 10 bps Programmable economics across standard-AMM, synchronous zero-AMM,
  asynchronous/batched and custom-reviewed collection profiles, plus a separately evidenced Solidity reference kernel.
- Closed Fee V2 conformance receipt and vector-set contracts that bind the exact implementation, source revision,
  scope/profile, execution-surface mapping, exposed modes and evidence digests, with authoritative math recomputation and
  segregated sponsor/collateral proofs for custom rates at or above 100%.
- First-class layered security assessments that distinguish idea, configuration, source and runtime observations,
  preserve disputed findings, and never treat novelty or missing templates as a security verdict.
- Public Application V3 with exact multi-repository commit/tree bindings, inline source closure for small projects and
  content-addressed fragmented manifests for large projects.
- GET-only `open-world prepare-revision` derivation for canonical Application V3 revision/lineage, followed by a
  separate zero-network full-package build; current object databases and explicit historical roots support exact
  predecessor replay without mutating old applications.
- A bounded strict JSON parser across current V2/V3 application, manifest, migration and launch boundaries that rejects
  same-value, conflicting and Unicode-escaped duplicate decoded keys before privacy, integrity or semantic handling.
- Source-derived fee applicability across Application V3 and Registry Acceptance V3: proposals are `unresolved`,
  canonical-scope prototypes are `applicable` with a real instance, and exact zero-scope prototypes are
  `not-applicable` with null instance fields and no fabricated market or receipt. Launch Bundle V2 remains a separate
  fee-bearing contract and cannot turn N/A into launch authority.
- A staged source-evidence model: source-owned submissions remain free of cryptographic fixed points, while derived
  post-commit assessments and verifier reports bind the exact immutable revision in the application package.
- Exact Application V3 disclosure attestations for intentionally public financial identifiers, with pointer, substring
  digest, application, owner-confirmation and review-record bindings that remain human-review-required and never waive
  credentials or claim ownership/approval.
- Language-scoped automated security findings: Solidity heuristics run only on matching source/build evidence, while
  partial, disputed or language-mismatched signals remain independent-review holds rather than automatic redesigns.
- Exact behavior-based hard predicates for unauthorized value disposition, backing/destination bypass, owed-value
  seizure, false exit or solvency promises, dishonest/no-op custom accounting and value-bearing randomness abuse;
  disclosed bounded controls, authorized dispositions, managed redemption, contingent claims and invariant-preserving
  rebalancing remain trust/review paths when no exact predicate matches.
- Canonical positive `uint256` decimal-string `chainId` values across V2 submission, fee, application, and launch
  bindings, without JavaScript safe-integer truncation.
- Canonical positive decimal-string `applicationRevision` values across Application V3, Registry Acceptance V3 and
  Launch V2, without the V1 integer, `1,000,000` or JavaScript safe-integer ceiling.
- A nullable, content-bound Registry acceptance binding for Launch Bundle V2: pre-acceptance remains unresolved and
  `NOT_AUTHORIZED`; an accepted record omits its own containing commit/tree while the outer launch input binds the exact
  Registry blob.
- A bounded Registry Acceptance V3 GitHub/raw-Git resolver that replays the central `refs/pull/<number>/head`, exact
  added-only package, latest current-head OWNER approval, and the exact acceptance blob at a double-snapshotted central
  `refs/heads/main`. Only the closed production transport can mint a short-lived
  process-local preflight receipt; mocked or dependency-injected transports remain inspection-only, and the platform
  must re-verify independently.
- A closed execution-surface coverage artifact for Launch Bundle V2, binding the exact Application V3 revision,
  verifier/security projection, entrypoints, candidate and declared closure, canonical Fee V2 scope and independently
  controlled external surfaces.
- Deterministic open-world initialization, validation, legacy migration, source-manifest generation, application
  preparation and unsigned Launch Bundle V2 tooling with preview-first local writes.
- Open lifecycle graphs that permit real recurring product cycles while keeping intent provenance, artifact lineage and
  application revision history acyclic and append-only.
- Explicit dependency-closure treatment for Git submodules, Git LFS, generated or remote artifacts and unsupported build
  systems. Local LFS bytes do not prove public object availability; unresolved required objects stay tooling/dependency
  holds rather than product-category rejection.
- Adversarial cases for contract-priced sell-and-burn mechanics, full-consumption zero-AMM curves, maps and games,
  high transparent charges, multi-asset/multi-pool designs, bounded admin powers and unsafe-drain redesigns.
- Live, bounded search, inspection, and comparison of the canonical public Programmable project Registry.
- A hash-verified offline Registry snapshot, used only when explicitly requested or explicitly allowed as a labeled
  stale fallback, with a portable raw-Git receipt binding one already-public Registry commit, root tree, exact paths,
  commit/tree/blob objects, blob ids, bytes, and SHA-256 digests.
- Prior-release template catalog, manifest, skill-tree, and definition receipts for exact future migrations.
- Submission standard 1.6.0 launch plans and a deterministic, fail-closed post-acceptance launch-bundle candidate for
  Admin handoff, with closed input/output schemas and no network access, runtime claims, deployment or signing.
- A one-command local release-candidate rehearsal that runs the complete repository gate, publication-shape validation,
  mandatory V1/V2 format/build/unit/10,000-run fuzz/extended-invariant/gas/Slither evidence, ordinary and novel routing
  canaries, clean Codex, Claude Code and GitHub Copilot installations, installed-package verification, two-build byte
  reproducibility, and provenance-aware archive, manifest, SBOM and checksum generation.
- Pinned primary-source GitHub Actions templates for Foundry and npm projects, plus source-owned workflow evidence in
  application status and review scope.

### Changed

- Context routing now lists exact capability, surface and pack selectors, returns typed non-adverse guidance for
  internal route-family names, preserves genuinely novel owner-defined ids, and accounts for the complete emitted JSON
  envelope in its deterministic context budget.
- Application V3 status now returns typed package-preparation guidance when it receives a Submission V2 directory
  instead of exposing a raw missing-file error.
- New open-world applications target the dedicated `0xprogrammable/programmable-registry` repository through the
  versioned Application V3 transport; historical six-file v1 applications remain immutable.
- Application V3 uses the namespaced `open-world` GitHub plan/submit/update/status flow. The unnamespaced client remains
  historical V1 only; no V3 package is routed through `prepare-pr`.
- Templates are accelerators rather than an allowlist. Unknown mechanisms, languages, chains, repositories and product
  surfaces remain eligible for intent capture and architecture review.
- Starter and capability packs are planning accelerators and review checklists, not code-ready implementations or
  inherited audits. Only a bundled fee reference kernel can be reused as code, and only within its exact documented
  collection profile and evidence boundary.
- Operational file, schema and verifier budgets now produce explicit content-addressed split-review holds instead of
  product-category rejection.
- Model-eval subject and judge providers are supplied through an explicit provider-neutral run contract instead of
  hard-coded semantic cases or rubrics; model quality remains unclaimed until authorized runs produce receipts.
- Source Closure Manifest V1 is explicitly limited to SHA-1 Git object databases with separate SHA-256 content digests
  and UTF-8 committed paths. Git SHA-256 object databases and non-UTF-8 paths route to `INTEGRATION_PENDING`; a UTF-8
  path above the current 16 KiB byte budget routes to `HOLD_SPLIT_REVIEW`. In every case the idea stays
  `ELIGIBLE_FOR_REVIEW`; other object formats or path encodings require a new versioned closure contract.
- Application, independent review, launch authorization, deployment and public availability are represented as
  separate evidence-bound states.
- The immutable fee-claim wallet and independent platform-administration wallet remain separate authorities; an admin
  authorization cannot claim, replace, redirect, sweep or net the Programmable fee liability.
- Registry similarity is an informational hint and can never reject an unfamiliar idea or silently call it unsafe.
- Existing application pull requests in the platform repository remain on their original review threads.
- A higher revision of an accepted project remains a pending update. The previously accepted exact revision stays
  launch-bound until maintainers separately accept the new bytes; approval is never inherited across revisions.
- Post-acceptance handoff now carries bounded exact ABI-call and storage-read expectations for independent Admin replay
  at one finalized block before signing.
- Cross-chain applications now describe inbound, outbound, or explicitly reviewed bidirectional flows with generic
  CAIP network identities and receiver encodings instead of assuming every destination is EVM-shaped.

### Fixed

- Public claims split across static JavaScript additions, templates or literal-array joins can no longer bypass the
  bounded copy scanner; candidate code is never executed, exact dead Boolean branches do not cause false findings,
  runtime-dynamic copy remains a human-review boundary and incomplete analysis becomes an explicit tooling blocker.
- Application V3 output planning now protects recursively referenced external Git alternate object stores as well as
  worktrees, Git/common directories and the primary object store, with bounded root snapshots revalidated before
  staging and atomic rename.
- The historical V1 trusted public intake validator matches submission standard 1.6.0, Builder template provenance, and
  fee policy 1.1.0 exactly; those V1 receipts do not establish V2/V3 compatibility.
- Release archives now retain the exact `programmable-v4-hook-builder` package directory name after extraction and bind
  the portable skill subtree separately from the repository tree.
- Deterministic test concurrency is bounded so the full gate remains reliable on ordinary developer machines.
- The public PR body, application status, local receipt, Registry summary, and Admin projection now use the central
  compatibility result as the authoritative overall result; the legacy preflight decision is labeled design-only.
- Foundry `.gas-snapshot` files are accepted as bounded text evidence, missing primary source CI is reported as a
  tooling gap, and unfamiliar fee implementations route to human architecture review instead of automatic rejection.
- Pending, cancelled, skipped, or failed GitHub Actions runs can no longer be supplied as successful source evidence;
  only a completed successful run for the exact repository, commit, tree, and workflow blob is accepted.
- The confirmed GitHub client now reconstructs the complete pull-request description from validated package facts and
  rejects locally altered summaries before any fork, branch, or draft pull request can be created.
- Proposal-stage implementation files remain visible as unverified evidence without pretending the proposal has
  passed prototype gates.

Historical candidate note: this candidate was local and unpublished, and its public predecessor at preparation time
was `v0.4.0`. That announcement was later superseded by `v0.5.1`; current stable public guidance is `v0.6.0`.

Compatibility note: a package prepared by `v0.4.0` remains bound to its original platform-repository pull request.
Continue its status and update journey with the pinned `v0.4.0` client; do not silently move its Git history or package
to the Registry. `v0.5.0` creates new applications only in the dedicated Registry.

## 0.4.0 - 2026-08-02

### Added

- Deterministic minimum-sufficient knowledge router with mode, capability, surface and template-plan profiles.
- Direct catalog-pack routing that expands public pack ids without misclassifying them as novel capabilities.
- Compact protocol-mechanics, liquidity/state, hook-Lego and v4 SDK integration references.
- Swap-client and liquidity-position starters plus active-liquidity, external-liquidity, idle-yield, subscriber and
  wrapped-asset capability packs.
- Submission standard 1.5 SDK safety profile, including root-only imports, executable hooked quotes, explicit router
  generation, per-hop hookData and price bounds, current slippage semantics, and deprecated liquidity-action exclusion.
- Adversarial evals for hooked local quotes, router/hookData drift, sandwich-vulnerable liquidity actions, subscriber
  fee inflation/liveness, and blind calldata/Permit2 signing.
- Standalone repository, neutral generated host manifests, public documentation, CI and release contract.
- Reproducible release archive, file manifest, SPDX SBOM and checksum generator.
- Slither CI, audit-readiness record and nine-category code-maturity snapshot.

### Preserved

- Open-ended architecture review for unknown ideas.
- Mandatory inclusive Programmable 10 bps fee policy 1.1.0.
- GitHub-only public application transport and strict separation of local, maintainer, deployment and provider states.

## Earlier versions

Earlier release records remain in the original Programmable repository. They are not rewritten or relabeled by this
standalone project.
