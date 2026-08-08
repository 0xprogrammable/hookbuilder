# Uniswap master-skill adoption record

Private maintainer record for the Programmable v4 Builder `v0.5.1` candidate. This document records what was inspected,
what became portable skill guidance, and what still requires live or human evidence. It is not part of the agent's
default context and is not an Uniswap endorsement, audit, deployment record, or public release announcement.

## Intended outcome

The Builder should let an agent turn an ordinary or unfamiliar idea into the smallest sound Programmable project, add
Uniswap v4 only where the intended architecture uses it, test the parts that can be checked deterministically, preserve
novel ideas for architecture review, and prepare one exact GitHub application revision. It should know enough protocol,
SDK, routing, liquidity, security, Programmable economics, packaging, and review workflow to avoid rebuilding standard
machinery from memory or forcing a non-v4 product into a pool or hook.

No finite skill can contain every future Uniswap change. The durable guarantee is therefore a pinned source map,
minimum-sufficient context routing, deterministic drift detection, versioned migrations, and fail-closed evidence when
the current chain or provider state is not bundled.

## Initial official source snapshot inspected

These heads were read as research inputs. They are not one compatible dependency set; released code remains bound to
exact package versions, integrity hashes, lockfiles, and the separately tested Programmable baseline in
`upstream-sources.json`.

| Source | Inspected revision | What it informed |
| --- | --- | --- |
| `Uniswap/docs` | `a0da460b1becfe920330adfab5d11f2f3f63863a` | v4 concepts, SDK journeys, official AI distribution and contributions |
| `Uniswap/v4-core` | `46c6834698c48bc4a463a86d8420f4eb1d7f3b75` | singleton PoolManager, unlock/delta settlement, hook bits, swap/fee behavior |
| `Uniswap/v4-periphery` | `3245c3cb99c48fa1dc2459c3b60abc37d4294aba` | PositionManager actions, subscribers, StateView and reserve lenses |
| `Uniswap/v4-hooks-public` | `7da5210f2c81a700820a6b4f585264233d91f349` | current BaseHook/HookMiner home and advanced public hook patterns |
| `Uniswap/sdks` | `1e30c3265f3cfb818ed912833f3e65630c8b3490` | v4 SDK exports, quote limits, route encoding, router generations and slippage semantics |
| `Uniswap/universal-router` | `fa3f856951967abd7e0cf33901f6cead31eb5469` | v4 planner/action integration and separately pinned router generations |
| `Uniswap/permit2` | `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` | signature/allowance integration boundary |
| `Uniswap/contracts` | `d47f0f73407c1b0b9d8959bf460a612cdc4a516e` | current deployment-registry source boundary |
| `Uniswap/uniswap-ai` | `9660491dc662fea76c2f8565c2f7ba2abf6e8840` | modular skill layout, v4 generator/security/SDK companions, eval conventions |
| `OpenZeppelin/uniswap-hooks` | `26dc8e53f812a1ca390d470342adb6cd8c3286ad` | reusable base families, generator boundary, version and audit-scope traps |

The exact package records, historical tested baseline, deployment-feed hashes, licenses, dependency edges, and additional
official repositories remain machine-readable in the bundled upstream source map. A repository head is observation,
not a source lock or deployment receipt.

## Current reviewed source drift

<!-- reviewed-drift-v1:start -->
Current reviewed upstream range receipt: `upstream-drift-2026-08-03-launchpad-discovery`, captured `2026-08-03T22:10:41Z`. These are observed source heads, not a tested compatibility set or deployment claim.

| Repository | Reviewed range | Files | Impact | Adopted guidance | Baseline action |
| --- | --- | ---: | --- | --- | --- |
| Uniswap AI Toolkit | `9b405c71e42d..f0812c1d0a52` | 33 | General agent workflow, release and plugin guidance changed; no protocol-specific v4 guidance changed. | `references/upstream-sources.md` | unchanged-observed-only |
| Uniswap Contracts Deployment Registry | `580e74a1e1bc..0ecb1fcaed7c` | 2 | Only two repository gitlinks advanced; this is not a deployment update or a resolved compatibility set. | `references/official-model-patterns.md`<br>`references/upstream-sources.md` | unchanged-observed-only |
| Uniswap Hooklist | `8488c73fd604..43ca58a8ca62` | 5 | Registry discovery data changed; inclusion remains neither audit, approval, endorsement nor routing evidence. | `references/official-model-patterns.md`<br>`references/routing-and-discovery.md`<br>`references/upstream-sources.md` | unchanged-observed-only |
| Uniswap UniRoute Public | `2cf851e7bb5e..0e002a0bcb35` | 2 | Robinhood-V4 pool caching can apply a capped one-hop spot-derived TVL top-up to one unpriced side and report servable parity; this is neither Ethereum nor hosted routing evidence. | `references/official-model-patterns.md`<br>`references/routing-and-discovery.md`<br>`references/upstream-sources.md` | unchanged-observed-only |
| Uniswap AI | `9660491dc662..86820b932572` | 4 | Repository review automation changed while all eight historically receipted evaluation source blobs stayed unchanged. | `references/upstream-sources.md` | unchanged-observed-only |
| Uniswap Universal Router | `9e9a780a3c17..d203e7f5525a` | 18 | Command-input decoding is bounded and signed route context now requires both PoolManager and Universal Router identity; deployment remains unproven. | `assets/starter-catalog/packs/v4-swap-client.json`<br>`references/official-model-patterns.md`<br>`references/upstream-sources.md`<br>`references/v4-protocol-mechanics.md`<br>`references/v4-sdk-integration.md` | unchanged-observed-only |
| Uniswap v4 Periphery | `3245c3cb99c4..545a5d2a8722` | 7 | Exact-output routes now require full fill at every hop, including repeated-currency multihop routes where PoolManager netting could hide intermediate underfill. | `assets/starter-catalog/packs/v4-swap-client.json`<br>`references/official-model-patterns.md`<br>`references/upstream-sources.md`<br>`references/v4-protocol-mechanics.md`<br>`references/v4-sdk-integration.md` | unchanged-observed-only |
<!-- reviewed-drift-v1:end -->

## Knowledge adopted into the portable Builder

### Protocol mechanics

- PoolManager-only callback authentication and PoolId-namespaced state.
- All 14 permission bits, parent/return-delta pairing, address-bit mining, selector and return-length checks.
- Unlock, flash accounting, zero-sum deltas, `sync -> transfer -> settle`, native-currency differences, `take`, `mint`,
  `burn`, and destructive `clear` semantics.
- Partial-fill checks, exact-input/output quadrants, price limits, dynamic and override fee constraints, donation
  manipulation, 100% LP-fee exact-output failure, self-call behavior, and quote/execution parity.
- Hook-owned ERC-6909 claims and liabilities remain distinct from underlying tokens, vault shares, and LP fees.

### SDK, router, positions, and state

- Root package imports only for the pinned v4 SDK package.
- Hooked pools cannot rely on local SDK pool math as an authoritative quote.
- Router generation must be explicit; supported price-bound fields follow the selected generation.
- Multihop `hookData` is bound per hop instead of silently accepting a helper that encodes empty bytes.
- Slippage meaning is stated explicitly and tested against final output behavior.
- PositionManager is not treated as enumerable. Discovery uses events or a reorg-aware indexer and reconciles chain
  ownership and position state.
- Deprecated `MINT_POSITION_FROM_DELTAS` and `INCREASE_LIQUIDITY_FROM_DELTAS` are blocked. Liquidity actions use explicit
  amounts, price bounds, deadlines, owner/token identity and hook data.
- Subscriber callbacks are treated as liveness dependencies. Manipulable `feesAccrued` values cannot alone drive
  rewards, risk, or automation.

### Reusable Lego without an allowlist

The catalog keeps ordinary launch, custom hook, custom-token standard-fee-hook, and blank custom foundations and composes capability packs on top. New
families cover swap clients, liquidity-position clients, active-liquidity markets, external-liquidity aggregation,
hook-owned idle yield, subscriber automation, and wrapped-asset conversion in addition to games, maps, wallet quests,
taxes, automatic liquidity, auctions, permissioned assets, randomness, services, keepers, oracles, metadata and evidence.

Templates and packs remain planning accelerators and review checklists; selecting either does not inherit code,
integration evidence, or an audit. A separate hash-bound implementation-Lego manifest can package deterministic
reusable source for exact capability triggers. In that manifest, `code-ready` means only that the packaged source is
available, deterministic, and passes its documented repository checks. It does **not** claim project integration,
security review, audit, deployment, provider support, or production readiness. `experimental` remains a reference
scaffold whose unresolved architecture and conformance questions require project-specific design before even
prototype-readiness claims. The Programmable fee reference kernels retain their own narrower profile and evidence
boundaries. An unlisted capability stays intact, receives a blank custom plan and an architecture-review route, and is
never marked unsafe merely because a classifier does not recognize it.

A known capability may also be selected atomically without expanding its source pack. The materialized plan keeps the
complete catalog definition receipts, exact requirements, review route, catalog provenance, and selection digest for
that direct Lego. Builder validation and rendering recompute those fields from the installed catalog before use; a
changed label, requirement, route, receipt, or digest fails closed. Historical plan bytes remain inspectable only as
labeled architecture-review input and do not acquire current-catalog claims.

### Programmable platform contract

- Every Programmable-canonical Fee V2 execution scope enforces one non-bypassable inclusive 10 bps collection path in
  the market's actual hook/settlement architecture.
- The immutable fee claim authority remains `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`; the admin wallet is separate and
  cannot claim or redirect this liability.
- Every V2 EVM `chainId` is a canonical positive `uint256` decimal string, not a JSON number.
- Application V3, Registry Acceptance V3 and Launch V2 use canonical positive decimal-string revisions without the
  historical V1 integer, `1,000,000` or JavaScript safe-integer ceiling.
- GitHub is the only Application V3 transport. GET-only revision/lineage derivation and separate zero-network package
  preparation are implemented in the candidate; namespaced submit/update/status and trusted Registry intake must pass
  the release gates before the public path is called active.
- Design, implementation, maintainer approval, deployment, source/runtime verification, provider support and public
  availability remain separate states.

## Token-efficiency architecture

The agent first asks the deterministic local `context` command for a knowledge plan. The router uses the selected mode,
template plan, capabilities and project surfaces to return:

- `loadNow`: the minimum initial chapters needed for the current step;
- `loadLater`: exact chapters plus the condition that justifies loading them;
- a deterministic profile digest;
- byte and approximate token totals; and
- explicit unknown-capability handling with no network call or automatic adverse verdict.

The initial target is 18,000 estimated tokens. Required safety context may exceed the target; the router reports that
fact instead of dropping a relevant chapter. Large schema, deployment and upstream-source files are deferred until the
specific field, dependency, deployment, license, drift, or evidence question exists.

Representative deterministic profiles for this candidate:

| Work item | Initial context behavior |
| --- | --- |
| Mode-only exploration | Intent contract and project-surface applicability now; full Fee V2, intake, scenarios, templates and Lego stay deferred until their trigger |
| Ordinary launch preflight | Open-world workflow plus confirmed canonical v4/Fee V2 context; no game, SDK or advanced-hook chapters |
| Three.js reward game preflight | Adds runtime, service and trust-boundary chapters |
| Swap plus liquidity-position prototype | Adds SDK, protocol, state and periphery safety chapters; full upstream map remains deferred until source selection or proof |
| Unlisted idea | Keeps the idea eligible; loads only the mode baseline, then adds scenario, surface, Lego and security chapters when architecture work triggers them |

The estimate is deliberately simple and reproducible: UTF-8 bytes divided by four, rounded up. It is a routing budget,
not a claim about the exact tokenizer of every host model.

## Deterministic and adversarial coverage

The release gates cover catalog closure, context routing, host-neutral CLI behavior, submission schema and semantics,
package closure, source resolution, fee conformance, GitHub application records, generated plugin byte parity, upstream
drift, and installed-package verification. The eval suite includes ordinary and novel ideas plus targeted failures for:

- local quoting of a hooked pool;
- router-generation and multihop-hookData drift;
- deprecated liquidity actions and sandwich exposure;
- subscriber liveness and artificial fee inflation;
- hidden fees, callback authentication, unsafe deltas and source/evidence fabrication; and
- arbitrary games, maps, wallet actions, transfer taxes and automatic-liquidity compositions.

Prompt evaluations complement code and invariant tests; they never replace compilation, static analysis, fork/fixture
tests, deployment evidence, provider observations, independent security review, or human approval.

## Deliberately not copied or claimed

- No PoolManager, router, SDK, official hook, proprietary service, unlicensed Hooklist text, or external skill was copied
  wholesale into this package.
- Official examples are research patterns, not automatic compatibility profiles or inherited audits.
- No public Uniswap interface, API, router, indexer, explorer, Hooklist or other provider support is inferred from local
  checks.
- No result is called safe, rug-free, audited, approved, deployed, tradable, live, or endorsed without the exact
  independent evidence required for that claim.
- No wallet access, signing, deployment, merge, public push, tag, marketplace publication, or website activation is
  part of this private candidate.

## Upgrade path

Future daily releases update the observed source snapshot, inspect every drift item, change only a coherent candidate
dependency set, run migrations and the complete gates, and preserve old protected tags and evidence. Security hotfixes
remain separate exceptions. The frozen `v0.3.0` private bundle is never rewritten; this work produces a new `v0.5.1`
candidate.
