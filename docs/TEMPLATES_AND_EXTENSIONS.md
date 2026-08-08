# Templates and extensions

The catalog is a Lego system for planning and review. It avoids rebuilding common machinery while keeping the product
space open.

## Foundations

- `ordinary-launch` for a standard token and canonical fee hook.
- `custom-token-standard-fee-hook` for visible token-side mechanics with the standard pool fee hook.
- `custom-hook` for project-specific v4 behavior with one non-bypassable Programmable fee path integrated into each
  declared canonical execution scope's actual hook/settlement architecture.
- `blank-custom` for ideas that do not fit an existing foundation.

Mandatory metadata and evidence packs are added through declared dependencies. A compact fee-applicability preflight is
universal; the full Fee V2 pack is added only after an actual `programmable-canonical` or explicit fee-bearing surface
is confirmed. A zero-scope `not-applicable` project receives no fake fee instance. A starter is a planning foundation,
not an approval tier.

## Capability packs

Packs cover recurring concerns such as dynamic fees, async swaps, custom curves, hook-owned fees or liquidity, auctions,
MEV protection, transfer taxes, automatic liquidity, games, maps, wallet quests, signed outcomes, randomness, oracles,
keepers, permissioned assets, staking, multi-pool hooks, multi-repository products, swap clients, liquidity positions,
subscribers, wrapped assets, external liquidity, idle yield and active-liquidity markets.

Each pack can declare:

- capabilities and project surfaces;
- required facts and files;
- executable tests and adversarial scenarios;
- dependencies and objective conflicts; and
- risks and review route.

Catalog entries are hash-bound and the complete catalog has a deterministic digest. Materialization records the starter,
requested and dependency packs, custom capabilities, local discovery tags and selection digest so choices cannot vanish
between planning and review.

## Hash-bound implementation Legos

The planning packs are not code mixins. A separate implementation-Lego manifest provides exact-trigger reusable source
for token/supply modes, contract/custom curves, zero-AMM and async/batch fee adapters, signed reward claims,
oracle/keeper guards, reorg-safe indexing, game settlement, and v4 swap/position/claim clients.

Every descriptor and source file is hash-bound through the top-level catalog. Selection is deterministic and
composable, dependencies are explicit, and a missing Lego preserves the project capability instead of rejecting it.
`blank-custom` remains the escape hatch for any architecture the catalog does not yet know.

`code-ready` means only that deterministic reusable source is packaged; `experimental` means a scaffold. Neither label
claims integrated behavior, fee conformance, audit, deployment, production readiness or provider support. Exact unsafe
behavior predicates route review; product categories never act as bans.

Each materialized plan records the immutable 0.1% Programmable share for
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c` and the 10-basis-point effective total-fee floor for every applicable
canonical execution scope, even when the selected total fee is zero. Standard-AMM, zero-AMM, async/batched and
custom-reviewed paths remain explicitly unresolved until their actual collection and claim code passes scope-specific
tests. Supporting source never silently creates a fee exemption.

## Add a new pack

1. Confirm the behavior is recurring enough to accelerate. One novel project does not require a permanent category.
2. Add one closed JSON definition under `assets/starter-catalog/packs/`.
3. Describe the product outcome and value-flow questions, not merely callback names.
4. Add every required fact, file, test, failure mode and review burden.
5. Compute its SHA-256 and add the sorted catalog entry.
6. Update the catalog digest expectation, human catalog table and scenario matrix.
7. Add composition, conflict, determinism and unknown-capability tests.
8. Route only the additional knowledge that agents using this pack need.

Never make the pack an allowlist, provider-support claim or inherited audit label.

Implementation-Lego changes additionally require source, descriptor and manifest hash updates; exact-trigger,
dependency, byte-identity and tamper tests; and an honest maturity/fee-applicability receipt. Do not add audited,
deployed or production-ready claims without separate attributable evidence and the corresponding release gates.

## Build without a matching pack

Use `blank-custom` and add one or more owner-defined capability ids. The materialized plan retains them, the knowledge
router loads the architecture-review profile, and the submission records their interfaces, value flow, authorities,
failure modes, tests and evidence. The correct output is a focused review question, not a generic rejection.

Only exact objective behavior conflicts can stop or redesign a mechanism: for example an unauthenticated callback that
actually exists, hidden privileged value control, movement below an enforceable liability floor, owed-value seizure,
fee-floor or immutable-destination bypass, false exit/guarantee, unauthorized or undisclosed irreversible disposition,
undisclosed/unbound managed redemption,
participant-funded or entitlement-reducing biasable randomness, unbounded withholding of exposed value, or a no-op on
a branch claiming custom accounting. High complexity, a disclosed bounded authority, invariant-preserving rebalancer,
sponsor-funded disclosed bias, authorized burn/donation, managed redemption or a contingent/defaultable claim is a
trust/review trigger, not by itself a conflict.
