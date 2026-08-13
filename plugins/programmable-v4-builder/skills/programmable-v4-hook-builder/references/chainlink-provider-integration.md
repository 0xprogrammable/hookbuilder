# Chainlink provider integration

Load this chapter only after the architecture explicitly names a Chainlink product. This is an EVM-only provider specialization. It never selects Chainlink automatically and never replaces the generic capability contract: VRF must declare `randomness`, Data Feeds and Data Streams `oracle-data`, CRE `keeper-automation`, and CCIP `cross-chain-messaging`.

The source review is a date-pinned observation from `2026-08-13T07:10:57Z`, not a current-branch or latest-release claim. Its exact revisions, selected deep references, license decisions and rejected claims are bound in `provider-knowledge-source-receipt-2026-08-13.json`. A refresh requires a new content-addressed receipt and independent review; it never mutates this snapshot in place. Load the receipt only for provenance, license or source-drift work. Process `chainlink-provider-profile-v1.schema.json` with the validator instead of putting the schema in the model context.

Validate a project-owned profile from any candidate repository with:

`node "$SKILL_ROOT/scripts/chainlink-provider-profile.mjs" check --root "$REPOSITORY_ROOT" --profile <profile.json>`

Select the exact product before materialization with `--chainlink-product ccip`, `cre`, `data-feeds`, `data-streams`,
or `vrf-v2-5`. The generic `--pack chainlink-provider` path intentionally fails before materialization because it would
omit the exact product-requirement closure. Product aliases fail with the exact replacement while unknown project capabilities remain
eligible through the ordinary owner-defined architecture-review path.

For the smallest closed VRF starting point, create a planning-only example in one new local directory, then run its
reported check command:

`node "$SKILL_ROOT/scripts/chainlink-provider-profile.mjs" init --root "$REPOSITORY_ROOT" --output chainlink-vrf-plan --product vrf-v2-5 --chain-id 1`

The initializer uses explicit planning values and placeholder source, writes no existing path, and claims no
implementation, deployment, provider availability, audit, approval, transaction authority, or launch readiness.

The command is offline. It verifies the profile shape, semantic composition, the installed source-receipt digest and every declared candidate artifact path/digest. `CHAINLINK_PROFILE_STRUCTURALLY_VALID` still does not verify provider availability, a remote deployment, DON execution, funding, an audit, a transaction or launch approval.

## Common boundary

- Bind the exact EVM chain IDs, product mode, contract roles, addresses, runtime-code hashes, dependency locks and content-addressed deployment artifacts. Moving documentation and product names are not deployment evidence.
- Keep credentials in a backend secret boundary. Never put keys, subscriptions, private endpoints or wallet material in bytecode, browser bundles, manifests, logs or public evidence.
- Model operations, not blanket product placement. Async callbacks and cross-chain delivery remain outside v4 callbacks. A bounded synchronous feed read can be declared separately. Heavy report verification stays outside the callback.
- Define provider replacement, outage, stale-data, billing, beneficiary recovery, total work and terminal exit behavior before implementation. Silent fallback that changes the trust model is forbidden.
- Use only `planned`, `implemented-structure` or `deployment-evidence-declared`. A planned integration declares configuration and requirements; it cannot claim tested, enforced, simulated, deployed or provider-executed behavior. The structural profile deliberately has no `verified` status.
- Every production-invariant section is either `requirements-declared` or `not-applicable-with-evidence`. N/A needs a reason and the digest of a bound review or test artifact; absence, convenience or an unknown is not N/A evidence.

## VRF v2.5

Use VRF through an asynchronous consumer separated from swap and liquidity callbacks. Bind:

- subscription versus direct-funding mode;
- coordinator, consumer and, for direct funding, wrapper runtime identities;
- key hash, subscription ID when applicable, funding asset, confirmations, callback-gas limit and word count;
- every request ID to frozen chain, consumer, purpose, input and beneficiary.

Fulfillment must authenticate the coordinator, record a minimal idempotent result, tolerate duplicate, unknown and reordered IDs without reverting, and defer business work to a separately callable bounded transition. A timeout may unlock a predeclared cancel/refund or beneficiary exit, but may not reroll the same commitment. Prove application-level withholding, selection, timing and authority risks; do not claim that a provider removes all bias.

## Data Feeds

Bind the pair, unit, inversion, decimals, proxy, current aggregator, exact maximum age and economic answer range. Completeness means at least `updatedAt != 0`; reject future timestamps, non-positive answers and stale data without treating `answeredInRound` as a freshness oracle.

When the target chain has an official sequencer-uptime feed, bind its deployment and a justified grace period. A fallback must be explicit, independently bound and visible to downstream value logic. Another provider or a cached value cannot silently become current Chainlink evidence.

## CCIP

Bind one source-to-destination lane independently: EIP-155 chain ID, uint64 Chainlink chain selector, router runtime, sender/receiver, payload schema, application domain, finality, rate-limit and fee-funding policies. A reverse lane needs a separate profile; this schema does not compress two directions into one claim.

Send and receive outside `PoolManager` callbacks. Prove replay rejection, duplicate and out-of-order delivery, bounded pending messages/payloads, source inclusion, destination execution and terminal recovery to a pre-bound beneficiary. An owner must not be able to redirect arbitrary user funds after failure.

## Data Streams

Bind verifier runtime, feed ID, report schema/version, valid-from and expiry enforcement, observation-age/future bounds, maximum report bytes, maximum verification gas, billing route, market-status and ripcord policies. Credentials stay backend-only. Reject wrong feed/schema, not-yet-valid, expired, stale, future, oversized, malformed or replayed reports before value effects; perform report verification outside v4 callbacks.

## CRE

CRE supports Go and TypeScript workflows. Bind the selected language, SDK/compiler versions, workflow artifact/config hashes, workflow/target/DON identity and trigger.

- TypeScript uses QuickJS/WASM, not Node.js; Node built-ins are unavailable. This profile requires `randomnessSource: not-used` for TypeScript rather than inventing a TypeScript runtime-random API.
- Go may bind documented CRE runtime randomness or explicitly use none. Runtime time/randomness, consensus aggregation and scaled integer/decimal arithmetic remain deterministic inputs.

Local simulation is single-node tooling evidence only. It is not DON execution or consensus evidence. Bind report verification, bounded network/data work, retry/idempotency, secrets by reference and terminal recovery.

## Exclusions

The reviewed source revision has no dedicated Automation or Functions skill. Generic keeper/service rules remain available, but this profile cannot claim product coverage for them. Confidential AI alpha material and ACE are excluded: ACE requires a separate legal, product-license, policy-authority, target-deployment and security review.

Non-EVM Chainlink products are also outside this profile. They require a separately designed chain-family schema rather than EVM addresses, runtime-code hashes or EIP-155 IDs.
