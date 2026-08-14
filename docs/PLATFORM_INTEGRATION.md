# Programmable platform boundary

This repository owns the portable Builder and its versioned application contracts. It does not contain the live
website, admin panel, database, deployment keys, provider accounts, production indexer or a wallet-connected launch
service.

The open-world v2 and public-application v3 files in this repository are a local development implementation. A green
local infrastructure-and-packaging rehearsal would still not make them a mission-defined release candidate. Their
presence is not evidence that the public Registry accepts v3, that intake is open, or that any reviewed project can
launch. The current state and promotion requirements are defined in
[`OPEN_WORLD_V2_RELEASE_GATES.md`](OPEN_WORLD_V2_RELEASE_GATES.md).

## Candidate builder journey

1. A builder gives any compatible coding agent a public-safe idea in their own language, or points it at an existing
   public project.
2. The agent preserves that idea before searching templates or the Registry, asks only material product questions and
   chooses direct build, custom architecture, integration pending or safe redesign.
3. The project is built in one or more builder-controlled public GitHub repositories. Application V3 is GitHub-only;
   another host, a ZIP, pasted source or a private repository can support local exploration but not public application.
   It remains idea-eligible as `INTEGRATION_PENDING`; no public package or external write occurs.
   Hooks, tokens, games, interfaces,
   services, indexers, keepers, custom pricing and owner-defined components are first-class; templates are optional
   accelerators, not an allowlist.
4. Deterministic local checks bind intent, architecture, source, tests, fee behavior, security evidence and unresolved
   review questions without granting approval.
5. The v3 application binds an exact repository id, commit, tree and complete source closure for every primary or
   companion repository. Small closures can be inline; larger closures use content-addressed, ordered fragments rather
   than becoming ineligible.
6. After source commits are frozen, a revision draft omits revision and lineage. GET-only `open-world prepare-revision`
   derives both from exact current sources and the highest eligible predecessor. Zero-network `open-world application`
   then derives source-assessed security and one verification report per repository into the complete package; no
   source-committed artifact predicts its own containing commit.
7. After V3 intake activation, namespaced `open-world submit` or `update` remains a later, explicitly confirmed
   GitHub write; `open-world status` is read-only. The pull request is transport and a public review thread, not
   self-approval, canonical acceptance or launch authorization. Top-level application commands remain V1-only.
8. Programmable maintainers review the exact revision and evidence. Unknown or disputed findings can enter independent
   review; builder-controlled artifacts cannot waive their own findings.
9. Canonical acceptance requires a Registry-controlled record for the exact revision. Acceptance, launch authorization,
   deployment, runtime verification, indexing and provider availability remain
   separate later states with separate evidence.

The target machine contracts are
[`submission-v2.schema.json`](../skills/programmable-v4-hook-builder/references/submission-v2.schema.json) and
[`public-pr-application-v3.schema.json`](../skills/programmable-v4-hook-builder/references/public-pr-application-v3.schema.json).
The v3 generator, trusted Registry validator and status/update path must land and pass the same corpus before this
journey may be described as publicly active.

Every V2 EVM `chainId` is serialized as a canonical positive `uint256` decimal string (`"1"`, never the JSON number
`1`). This applies across submission, fee and launch bindings; it is not limited by JavaScript's safe-integer range.
Application V3, Registry Acceptance V3 and Launch V2 also carry `applicationRevision` as a canonical positive decimal
string with no V1 `1,000,000` or safe-integer ceiling. Historical V1 application revisions remain integers.

Source-closure-manifest V1 binds SHA-1 Git object ids plus separate SHA-256 content digests and requires UTF-8 committed
paths. A Git SHA-256 object database or non-UTF-8 path is `INTEGRATION_PENDING` for current Application V3 transport;
a UTF-8 path above the current 16 KiB byte budget is `HOLD_SPLIT_REVIEW`. Both remain eligible for design/build/review.
Other object formats or path encodings need a new versioned closure contract rather than silent V1 schema widening.

Every untrusted JSON/JSONL boundary is strict before privacy or meaning: fatal UTF-8, bounded syntax and no duplicate
decoded keys, including escaped equivalents. Verifier resource ceilings remain typed tooling/split-review states; they
do not narrow what users may build.

## Historical v1 transport

Published v1 applications remain immutable. Their closed six-file central package, `application.json`, bounded source
arrays and limit of eight companion repositories describe the historical v1 intake only. They must not be presented as
limits on open-world v2, silently rewritten into v3, or used as evidence that a v2 application was accepted. A v2/v3
migration creates a new revision with explicit lineage and no inherited approval.

## Optional legacy economic and administrative identities

Current Programmable requirements come only from the exact central Submit Launch policy and applicable Rule IDs. The
identities and economics below belong to the frozen Fee V2 package and apply only when preserved intent or a current
Rule explicitly selects that exact package. They are not universal launch requirements.

Inside that selected package, the immutable fee owner and sole claim authority is:

```text
0x4957f49620AFf3Adbbe8195a4f633E49cc93376c
```

The separate platform administration wallet is:

```text
0x2Bb333d48DFAF1596D9036671d2E43168994249E
```

For every `programmable-canonical` Fee V2 execution scope inside that selected package, exactly 10 bps of executed gross quote-side volume belongs
to the immutable fee owner. A builder-selected total charge is inclusive: a selected 3% is split into 0.1% for
Programmable and 2.9% for the project, not raised to 3.1%; a zero project fee still produces the 0.1% platform share.
The admin may operate only explicitly assigned platform controls and may never claim, redirect, sweep or replace that
liability. External or descriptive markets bind no Programmable fee scope and cannot be used to relabel a Programmable
execution path to evade the fee.

## Runtime and provider states

Eligibility to design and submit is broader than current platform integration. A missing chain, provider, adapter or
runtime capability produces `INTEGRATION_PENDING`, architecture review or a tooling hold; it is not a product-category
rejection. The complete project can still be built and reviewed in GitHub.

Launch support is a separate exact claim. It requires an approved revision, authorized deployment, source/runtime
matching, configuration receipts, indexing, monitoring and provider-specific evidence. Discovery, metadata, charting,
quoting, simulation and execution remain independent provider states; one observation cannot populate all of them.

## Platform consumption

The website and future admin panel should consume immutable Builder and Registry versions, never duplicate their
policy in UI code. An adapter may show intent, source, review and runtime state or invoke a documented command, but it
may not:

- rewrite the original idea or its provenance;
- interpret an unknown capability as rejection;
- fork the fee or security policy;
- turn structural validity into approval;
- let a builder disposition its own finding;
- combine review acceptance, deployment and availability into one status; or
- sign, deploy or move funds from a generated or locally valid package.

The later platform review record must content-bind the exact application revision, findings, evidence and accountable
reviewer. A disposition never transfers to a new commit. The separate Registry acceptance record binds that exact
application plus its source, submission, fee, security and verification-report closure. It omits its own containing
commit/tree to avoid self-reference; the outer launch input binds the exact Registry repository, commit, tree, path,
blob and digest. Before acceptance, this binding is null and launch remains `UNRESOLVED` and `NOT_AUTHORIZED`. A launch
handoff uses the separate unsigned V2 launch-bundle contract and stays `NOT_AUTHORIZED` until the independent admin path
supplies its own authority and all runtime gates pass.

Treat Builder Registry Acceptance V3 resolution as preflight. The production Builder path uses a closed, captured
read-only GitHub transport to issue a short-lived process-local receipt; dependency-injected or mocked transport results
are inspection-only. At the platform boundary, independently re-run the central Registry numeric-ID lookup,
`refs/pull/<number>/head` replay, merged Application-PR lifecycle, immutable author/reviewer-ID checks, latest current-head
OWNER approval, exact package inventory/change-set digest verification, and a double-snapshotted `refs/heads/main`
raw-Git replay of the exact acceptance path, blob and SHA-256. Never promote a Builder receipt or stored
acceptance bytes directly into admin, deployment or runtime authority.

The platform should consume this repository by immutable release tag or full commit and verify the skill tree digest.
Migration from GitHub PR transport to a connected service requires a new explicit versioned contract and must preserve
all historical application bytes and review history.
