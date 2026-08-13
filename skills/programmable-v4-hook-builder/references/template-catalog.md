# Starter and capability-pack catalog

## Contents

- [Purpose](#purpose)
- [Selection model](#selection-model)
- [Commands](#commands)
- [Starters](#starters)
- [Capability packs](#capability-packs)
- [Implementation Legos](#implementation-legos)
- [Owner-defined capabilities](#owner-defined-capabilities)
- [Owner-defined local tags](#owner-defined-local-tags)
- [Composition rules](#composition-rules)
- [Materialized files](#materialized-files)
- [Adding a catalog entry](#adding-a-catalog-entry)
- [Evidence boundary](#evidence-boundary)
- [Release history](#release-history)

## Release history

`template-catalog-history.json` preserves each prior released Builder commit, skill tree, catalog digest, raw manifest
digest, and every starter or pack definition digest. Old template bytes remain reconstructable from the immutable
release tag; a later Builder never silently rewrites an old definition. A project plan retains its catalog and
definition digests, so migration can compare the exact prior composition before changing anything.

## Purpose

Use the catalog to start common projects faster and ask the right architecture, security, evidence and disclosure
questions. A catalog entry is an accelerator only. It is not an allowlist, implementation, acceptance decision, audit,
deployment receipt, provider promise or launch permit.

Never infer that an idea is unsafe, rejected or unsupported because its category is absent. Preserve every owner-defined
capability, describe its actors, assets, authorities, value flows, dependencies and failure behavior, and route it to
architecture review. Objective hard findings still come from the main policy and evidence workflow, not this catalog.

Every starter includes the Programmable fee-applicability, metadata/disclosure and test/evidence planning packs. The fee
pack first derives whether any `programmable-canonical` execution scope exists. Canonical scopes require the real Fee V2
instance and evidence; an exact zero-scope plan remains `not-applicable` and must not invent a market, PoolKey, hook or
receipt. Generated artifacts prove no integrated implementation or runtime behavior.

## Selection model

Choose one starter, then add any number of capability packs:

1. Use `ordinary-launch` for the smallest conventional fixed-supply token and canonical-pool path.
2. Use `custom-token-standard-fee-hook` when special behavior belongs in the token while the Programmable fee hook
   remains standard.
3. Use `custom-hook` when the canonical pool needs custom callbacks; token-side packs can still be added.
4. Use `blank-custom` when a known starter would distort the idea.
5. Add packs when their complete behavior and dependency closure applies.
6. Add a known behavior atomically with repeatable `--capability` when sibling capabilities from its source pack do not
   apply. The selection keeps exact definition receipts, requirements and digests without pack expansion.
7. Add every unlisted behavior with `--custom-capability` rather than omitting or renaming it.
8. Add any safe project-specific discovery slugs with repeatable `--local-tag`; catalog membership is not required.
9. Resolve a template-composition conflict by selecting a better foundation. A composition conflict is not a safety or
   eligibility decision.

Pack dependencies are included automatically. Output ordering, definition hashes, catalog digest and selection digest
are deterministic. The same catalog and selection produce byte-identical files.

## Commands

Resolve `SKILL_ROOT` to the directory containing the loaded `SKILL.md`.

Start with the concise canonical inventory, then filter before loading detail:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" templates list
node "$SKILL_ROOT/scripts/cli.mjs" templates list --kind pack --filter randomness
```

Add `--json` only when labels, summaries, routes and definition digests are required. Inspect one selected definition
instead of loading every definition:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" templates list --kind starter --json
node "$SKILL_ROOT/scripts/cli.mjs" templates show verifiable-randomness
```

Create one deterministic plan with the host-neutral command:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" start --starter blank-custom --capability randomness --target /absolute/path/to/new-plan
```

Use `templates list-legos`, `templates show-lego <id>` and command-specific `--help` only after a source accelerator is
actually relevant. `start` creates only the new target. It does not initialize Git, fetch dependencies, run project code,
connect a wallet, submit, deploy or publish.

## Starters

The JSON catalog is the only current starter and pack inventory. Never copy its ids or summaries into this reference.
Use `templates list --kind starter` and `templates show <id>` so the displayed selection stays bound to the catalog
digest. The selection rules above explain when a foundation applies; the catalog owns its current definition.

The ordinary starter cannot accept `custom-hook-behavior`, whether selected directly or through a dependency. The
command returns `CUSTOM_HOOK_STARTER_REQUIRED` with `recommendedStarterId: custom-hook`; preserve the idea and selected
packs, then change only the foundation. Token-side special packs similarly redirect ordinary composition to
`custom-token-standard-fee-hook`, while behavior requiring custom callbacks redirects that foundation to `custom-hook`.

A permissioned or external asset does not conflict with `ordinary-launch` merely because it is external. Record whether
its PoolKey role is `launched`, `quote` or `both`, then derive the actual architecture and review obligations.
Foundation routing is not a rejection or safety decision.

## Capability packs

The canonical inventory, summaries, requirements, surfaces, risks and definition hashes live in
`assets/starter-catalog/catalog.json` and its bound definition files. Query them through `templates list --filter <text>`
and `templates show <id>`. This reference intentionally contains no hand-maintained pack table.

Packs are composable planning contracts, not code mixins. Selecting one still requires a project-specific implementation
and the main compatibility, security, source-binding and review gates. Add an optional trust-model pack only after the
owner chooses that model; do not infer a signer, oracle, provider, keeper, market, pool or hook from an adjacent feature.

Token-side tax or liquidity packs require matching Submission V2 assets, components, value flows, authorities and
capability-profile records. Historical V1 `tokenMechanics` and `noHookArchitecture` fields are only for identified V1
reproduction or migration.

## Implementation Legos

Implementation Legos are a separate, hash-bound source layer under
`assets/starter-catalog/implementation-legos/`. They never change whether an idea is eligible. Exact starter, pack or
known-capability triggers may select a reusable source file; dependencies add only the explicitly required Lego. When
no Lego matches, the project and every owner-defined capability remain intact and route through the normal custom
architecture review.

Each closed descriptor binds its source bytes, materialized target path, integration facts, dependency requirements,
exact unsafe behavior predicates, review route and fee-applicability state. The top-level catalog digest binds the Lego
manifest, every descriptor and every source hash. Extra, missing, traversing, duplicated or modified source files fail
before composition.

Maturity has only these meanings:

- `code-ready`: deterministic reusable source is packaged and hash-bound; project integration, compilation, tests and
  review are still required.
- `experimental`: reference scaffold only; project-specific implementation and evidence are required before prototype
  readiness.

Neither label claims fee conformance, safety, audit, deployment, production readiness or provider support. Every
descriptor records those claims as false or not claimed. Exact hard-conflict predicates address concrete unsafe
behavior; they are never category bans.

Every materialized plan also carries the immutable Programmable fee owner
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`, the 10-basis-point platform share and the 10-basis-point effective total
fee floor for each applicable canonical execution scope, including a selected total fee of zero. Until each actual
standard-AMM, zero-AMM, async/batched or custom-reviewed path has scope-specific code and tests, fee conformance remains
explicitly unresolved. A supporting Lego marked `not-a-fee-enforcement-component` never creates an exemption.

## Owner-defined capabilities

Known catalog capabilities use `--capability <known-id>`. This selects one exact Lego without adding sibling
capabilities or pack dependencies. Its hash-bound definition receipts and any atomic capability requirements are stored
under `directCapabilityLegos`; when the catalog does not yet have an atomic requirement definition, the capability is
still preserved but visibly routes to capability-specific architecture review.

Unlisted behavior uses `--custom-capability` with a lowercase hyphenated id and a visible NFC label:

```text
--custom-capability capability-id='Plain visible label'
```

The materialized manifest records:

- `catalogStatus: unlisted`
- `automaticDecision: none`
- `reviewRoute: architecture-review-required`
- `eligibilityEffect: none`

The generated checklist asks for actors and assets, authority and trust, value flow and conservation, failure and exit,
and exact source and tests. Continue the normal architecture conversation to derive more specific obligations. Do not
invent a near-enough known label merely to avoid review.

## Owner-defined local tags

Use repeatable lowercase slug-safe tags for local discovery without waiting for a catalog update:

```text
--local-tag weird-squid-market --local-tag community-lore
```

These values are deliberately not checked against a tag allowlist. They are NFC-safe lowercase slugs, required to be
unique, sorted, included in the selection digest, stored as `tagSuggestions.ownerProvidedLocalTags`, and rendered in
`TAGS.md`. `catalogMembershipRequired` is `false`, `machineCapabilityInference` is `forbidden`, and
`providerSupportInference` is `forbidden`.

Starter, pack, security and capability ids live separately under `machineCapabilities`. They support internal planning
and review routing, but never become public local tags automatically. Owner-defined capabilities also remain machine
capabilities until the owner separately chooses a `--local-tag`. Therefore `ownerProvidedLocalTags` is the only list of
explicit public local discovery suggestions in a materialized plan.

A local tag describes the owner's project only. It never proves or claims GMGN, Fomo, Dexscreener, Uniswap, wallet,
router, marketplace or search-provider support. Track each external provider separately from attributable evidence.

## Composition rules

The loader rejects malformed packaged data before materialization:

- unknown or missing fields in the closed catalog objects;
- noncanonical ids or paths;
- duplicate or unsorted ids;
- hash mismatches, unlisted files or missing definitions;
- invalid, non-NFC, invisible, control, bidirectional, private-use or noncharacter label text;
- missing mandatory packs, dangling requirements or requirement cycles;
- a selected starter/pack pair with contradictory template assumptions.

In addition, `ordinary-launch` composition stops with a specific `custom-hook` redirect whenever dependency closure
contains `custom-hook-behavior`. The selected behavior remains eligible and can be composed unchanged on the
`custom-hook` starter. Token-side special packs redirect ordinary composition to
`custom-token-standard-fee-hook`. Selecting custom-hook behavior from that token foundation redirects to
`custom-hook`, which can combine both behavior families.

A composition conflict means only that the selected templates cannot describe one coherent foundation. It returns
`eligibilityEffect: none` and `adverseDecision: false`. Change the selection while preserving the original idea.

## Materialized files

The materializer is the only current file-inventory owner. Its result reports every created path and its receipts; do
not duplicate that list in documentation. The target groups a machine selection contract, human planning/evidence
prompts, metadata/disclosures and any exact-trigger implementation sources. Replace every prompt with project-specific
facts. Unchanged template text is neither implementation nor evidence.

## Adding a catalog entry

Keep additions data-only and reviewable:

1. Add one closed JSON definition under `assets/starter-catalog/starters/` or `assets/starter-catalog/packs/`.
2. Use a unique lowercase hyphenated id and visible NFC text.
3. State required facts, files, tests and risks without claiming approval.
4. Add only real composition dependencies or conflicts. Do not use conflicts as a disguised product allowlist.
5. Add the sorted manifest entry with the exact raw-file SHA-256.
6. Add focused tests for selection, dependency closure, conflicts and unknown-capability preservation.
7. Run the complete catalog test and the skill verification gates before a release candidate.

Do not add executable downloads, remote URLs, credentials, wallet actions or provider assertions to the catalog.

Add or change an implementation Lego only as a separate reviewed source change: update its source hash, descriptor hash,
sorted Lego manifest, top-level Lego-manifest hash, catalog digest expectation, exact-trigger tests, tamper tests and
materialization receipts. Keep the blank/custom escape hatch and `missingLegoOutcome: preserve-project-capability`.

## Evidence boundary

A valid catalog and deterministic materialization prove only that packaged template/source bytes, selection rules and
receipts are self-consistent. They do not prove integrated source behavior, fee correctness, security review, clean
builds, deployment, source verification, lifecycle operation, provider indexing, routing or public availability. Track
those states independently through the main Programmable workflow.
