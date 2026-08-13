# Ethereum production invariants

Use this chapter when routing selects an offchain-trust capability or an indexer, keeper, connected-service or external-provider surface. Within those projects, apply the account-execution and chain-capability sections whenever those concerns are present. The topic inventory was informed by the date-pinned advisory receipt in `provider-knowledge-source-receipt-2026-08-13.json`; it makes no current or latest upstream claim. All rules below are independently authored for Programmable and must be resolved against primary EIPs, ERCs, execution specifications, target-chain documentation and runtime evidence. Pure account- or chain-specific contract projects are not claimed as covered by this route.

## State-transition liveness

For every transition that can block value, exit or finality, bind:

- who can call it and how authorization is checked;
- who pays gas and who funds any provider, keeper or relayer;
- the incentive to execute it when its outcome is unfavorable;
- earliest time, deadline and terminal timeout;
- an upper bound for per-call and total work;
- retry and idempotency behavior for duplicates, reordering and partial progress;
- a permissionless completion, beneficiary exit or other mechanically enforceable stuck-state recovery.

Chunking one call is not a liveness proof when total history is unbounded. Admin discretion is not a permissionless fallback.

## Account execution and signatures

- Classify supported signers and callers: EOA, ERC-1271 contract account, EIP-7702 delegated account, ERC-4337 smart account, relayer or session key.
- Bind chain, verifying contract, action, parameters, nonce, validity window and domain into every authorization. Reject cross-chain, cross-contract, cross-action and stale replay.
- Do not infer account type or trust from `tx.origin`, `extcodesize`, code length or whether code exists at one historical block.
- ERC-1271 validity can change with contract state. Record the block and runtime identity used for evidence and revalidate at execution when required.
- EIP-7702 delegation can persist beyond one transaction. Specify installation, replacement and revocation semantics and test delegated code changes.
- Bind ERC-4337 entry point, account implementation, validation gas, paymaster/sponsor policy, bundler assumptions and failure/refund behavior when used.

## Indexer and RPC evidence

- Bind deployment/runtime code hash, ABI, event signature/topic, start block number and start block hash.
- Declare exact block tags and distinguish latest, safe and finalized. A confirmation count must be chain-specific and justified.
- Bound log ranges, response bytes, retry count, concurrency and total replay work.
- Process removed logs and reorgs with rollback to a known block hash. Replaying the same canonical chain segment must produce the same state.
- Fail closed on provider disagreement, stale heads, missing receipts, incomplete pages and chain-id mismatch. A successful HTTP response is not consensus evidence.
- Persist source block number/hash and observation time with derived values so freshness and provenance are machine-checkable.

## Chain capability profile

- Separate execution inclusion, target-chain finality, L1 settlement finality and bridge withdrawal delay. Never use withdrawal delay as a synonym for consensus finality.
- Bind fee model, block and timestamp semantics, sequencer or proposer outage behavior, reorg policy and forced-inclusion or escape paths.
- Bind required opcodes, precompiles, compiler/EVM target and deployed runtime proof. Similar EVM branding is not compatibility evidence.
- For bridges and cross-chain messages, bind source/destination domains, finality assumptions, replay domain, messenger/runtime identities and recovery.
- For CREATE, derive the address from the exact deployer and nonce, then prove the target address state and deployment transaction.
- For CREATE2, derive the address from the exact deployer, salt and init-code hash. Separately prove factory runtime/authority, target-address occupancy and successful deployment. Never mix CREATE nonce inputs into the CREATE2 formula or infer cross-chain equality from a salt alone.

## Future protocol changes

An EIP/ERC status or documentation page is not runtime availability. Before depending on a future feature, require all of:

1. inclusion in the target fork or protocol release;
2. an exact execution-specification or client implementation revision;
3. target-chain activation evidence;
4. a runtime probe or deployed artifact proving the required behavior;
5. fallback or migration semantics if support is absent or later differs.

## Evidence boundary

These invariants produce requirements and findings, never deployment or launch authority. Unknown provider, account or chain behavior remains reviewable and must not be manufactured into a passing claim.
