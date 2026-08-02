# Uniswap v4 protocol mechanics

Use this reference when designing, implementing, repairing, or reviewing a hook, router, launcher, or other component
that calls the v4 singleton. It is a compact operating map, not a replacement for exact pinned source. Resolve the
compatible source set in `upstream-sources.json` before copying an interface or relying on an implementation detail.

## Source boundary

The observations below were checked against these upstream heads on 2026-08-01:

- Uniswap v4 Core `46c6834698c48bc4a463a86d8420f4eb1d7f3b75`;
- Uniswap v4 Periphery `3245c3cb99c48fa1dc2459c3b60abc37d4294aba`;
- Uniswap v4 Hooks Public `7da5210f2c81a700820a6b4f585264233d91f349`; and
- Uniswap docs `a0da460b1becfe920330adfab5d11f2f3f63863a`.

These are observed sources, not one compatible dependency lock. The current periphery and hooks repositories pin
different core or periphery revisions. Use the project's exact package lock, source trees, compiler input, deployment
records, and runtime hashes as the executable authority. Run the drift checker before a release or migration.

## Singleton and unlock accounting

- One `PoolManager` holds the accounting for many pools. Every state and liability key must include the full canonical
  `PoolKey` or `PoolId`; a currency pair alone is not a pool identity.
- `initialize` and `updateDynamicLPFee` are the exceptional manager entry points that do not require an unlock. Swap,
  liquidity, donate, take, settle, mint, burn, and clear actions occur in a valid unlock flow.
- During an unlock, every currency delta created by the caller's actions must return to zero before the unlock ends.
  Model the complete action plan, not each transfer in isolation.
- For ERC-20 settlement, call `sync(currency)` before transferring tokens to the manager, then call `settle`. Native
  currency settlement follows the payable path and must not reuse the ERC-20 sequence blindly.
- `take` moves a currency out and makes the caller's delta more negative. It is not free withdrawal authority.
- `settleFor` credits the named recipient, not automatically the transaction sender. Bind and test the beneficiary.
- `clear(currency, amount)` permanently discards an exact positive delta without transferring assets. Allow it only for
  an explicit, bounded dust policy; an amount mismatch reverts and a successful clear is value-destructive.
- ERC-6909 `mint` and `burn` use the currency address cast to a `uint160` id. Never derive an id from arbitrary upper
  bytes or treat claims as a second currency namespace.

Prove with invariants that every successful and reverting path ends with zero manager deltas, preserves solvency per
currency and per pool, and cannot settle or take for an unintended actor.

## Pool identity and initialization

A `PoolKey` binds sorted `currency0`, `currency1`, LP fee, tick spacing, and hook address. Any changed member identifies
a different pool. Record all five members and the derived `PoolId` in source, tests, application metadata, quote input,
router calldata, indexer keys, and runtime evidence.

- Sort currencies by canonical address ordering. Native currency is represented by the zero address.
- Validate fee and tick-spacing relationships with the exact installed core libraries.
- The hook address low bits declare callback permissions. Mine or deploy only after final creation code, constructor
  args, compiler settings, metadata, deployer, and permission mask are fixed.
- Initialization can call the before/after-initialize hooks. Treat supplied hook data as untrusted and prove replay,
  sender, pool, version, and length behavior.
- Never infer that an initialized pool is the canonical Programmable pool. Canonical admission is a separate factory or
  registry rule bound to one PoolKey.

## Hook permission and callback rules

The address uses 14 low permission bits. A return-delta permission is valid only with its parent callback. Start with
all permissions false and enable the minimum proven mask.

For every enabled callback:

1. authenticate `msg.sender` as the immutable canonical PoolManager;
2. bind the exact PoolKey or an explicit pool-admission rule;
3. remember that the callback's `sender` argument is commonly a router or PositionManager, not the end user;
4. decode versioned, bounded hook data and authenticate any claimed identity;
5. return the exact selector and exact ABI return length;
6. document which revert rolls back the parent action; and
7. test direct, routed, nested, self-initiated, malformed, and replayed calls.

The core hook library suppresses callbacks when the hook itself initiates the manager action. Do not assume a hook's
own nested swap, donate, or liquidity action recursively enforces the same policy. Test the explicit self-call policy.

Before-swap return deltas cannot change an exact-input request into exact-output or the reverse. Prove sign, bound,
conservation, backing, and settlement for each enabled return-delta quadrant. Leave `beforeSwapReturnDelta` disabled
unless the product needs custom accounting and the highest review path accepts the exact math.

## Swap execution

- A low-liquidity swap can partially fill. Enforce user bounds against the returned final delta and actual executed
  amounts, not the requested amount or an intermediate quote.
- Exact-output swaps are impossible at a 100% LP fee. Either cap the fee below 100% or reject exact-output routes.
- Dynamic fees require the dynamic-fee pool flag and an authorized hook update path. The override-fee flag changes a
  swap's fee; it does not mutate the stored LP fee.
- Hook fees, Programmable's mandatory 10 bps, project fees, LP fees, token transfer taxes, and router charges are
  different mechanisms. Account and disclose them separately.
- Quote and execution must bind the same block context, PoolKey, sender assumptions, hook data, router generation,
  action plan, native value, deadline, Permit2 intent, and final slippage bounds.

Use `v4-sdk-integration.md` for client construction. Local no-hook pool math is not a quote for a hooked pool.

## Liquidity, fees, and donations

`modifyLiquidity` returns principal change and fees accrued. The core interface warns that `feesAccrued` can be
artificially inflated: a single-position pool can donate to itself, and atomic donate-then-collect behavior can amplify
the observation. Therefore:

- never use `feesAccrued` as authenticated revenue, reward, eligibility, score, or oracle input;
- compute slippage on principal change after separating accrued fees exactly as the pinned periphery does;
- reconcile final balances and liabilities rather than trusting a callback parameter; and
- adversarially test donation before and within the same unlock.

`donate` can be front-run by just-in-time liquidity. Its beneficiary tick also has a boundary nuance when price sits on
a tick boundary. Do not use donation as a fair distribution, timing oracle, or proof of organic fees without a separate
mechanism and MEV analysis.

Use `v4-liquidity-and-state.md` for PositionManager actions, subscribers, position discovery, and coherent state reads.

## Native currency and token behavior

- Native ETH support removes the need to wrap every manager action, but application routers still need exact `msg.value`,
  refund, failure, and recipient rules.
- Fee-on-transfer, rebasing, permissioned, callback-capable, pausable, blocklisted, or otherwise non-standard tokens can
  break ordinary settlement assumptions. Keep them eligible, but route the exact behavior through the token mechanics,
  value-flow, provider, and custom review profiles.
- Never assume symbol, decimals, name, logo, or address labels establish asset identity or legal rights.

## Minimum executable evidence

At minimum, bind and test:

- exact source and dependency closure, compiler input, creation code, deployed runtime, constructor args, and hook mask;
- PoolManager authentication and unauthorized direct callbacks;
- all four swap quadrants, zero and boundary amounts, rounding, partial fills, full-fee limits, and price limits;
- nested and self-initiated actions, reentrancy, hook-data mutation, callback return shape, and revert atomicity;
- `sync -> transfer -> settle` for ERC-20, native settlement, `take`, claims, and bounded dust clearing;
- principal versus accrued fees, donation inflation, JIT donation capture, and cross-pool isolation;
- final zero deltas and solvency after success, revert, claim, rescue, retirement, and dependency failure; and
- route, indexer, provider, deployment, and monitoring evidence as separate gates.

Passing these checks is implementation evidence, not an audit, approval, deployment, or availability claim.
