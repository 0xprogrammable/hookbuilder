# Templates and extensions

The catalog is a Lego system for planning and review. It avoids rebuilding common machinery while keeping the product
space open.

## Foundations

- `ordinary-launch` for a standard token and canonical fee hook.
- `custom-token-standard-fee-hook` for visible token-side mechanics with the standard pool fee hook.
- `custom-hook` for project-specific v4 behavior with the Programmable fee policy integrated into the one hook.
- `blank-custom` for ideas that do not fit an existing foundation.

Mandatory metadata, fee and evidence packs are added through declared dependencies. A starter is a planning foundation,
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

## Build without a matching pack

Use `blank-custom` and add one or more owner-defined capability ids. The materialized plan retains them, the knowledge
router loads the architecture-review profile, and the submission records their interfaces, value flow, authorities,
failure modes, tests and evidence. The correct output is a focused review question, not a generic rejection.

Only objective behavior conflicts can stop a design: for example an unauthenticated privileged callback, unrestricted
drain, hidden mint or fee, unbacked delta, arbitrary privileged delegatecall, sell block, unverifiable custody, or a
request to hide behavior from users and reviewers. High complexity by itself is not a conflict.
