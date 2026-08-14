# v4 contract reasoning kernel

Load this compact foundation only after an exact v4 contract capability is confirmed. It is the first reasoning stage,
before hook-pattern, scenario, security, SDK, or broad protocol chapters. It does not replace pinned source, compilation,
tests, review, or the full `v4-protocol-mechanics.md` chapter when an exact mechanism remains unresolved.

## Resolve identity before behavior

Bind the exact compatible v4 Core and Periphery source closure, lockfiles, compiler input, chain, PoolManager, PoolKey,
PoolId, hook address, constructor arguments, creation/runtime bytecode, and 14-bit permission mask. A currency pair is not
a pool identity. The PoolKey also binds fee, tick spacing, and hook. Start with every hook permission disabled and enable
only callbacks required by the confirmed behavior. Mine or deploy the address only after all permission-affecting bytes
are final.

For each enabled callback, prove the PoolManager caller, admitted PoolKey/PoolId, bounded versioned hookData, selector and
callback-specific return shape. The callback `sender` is commonly a router or PositionManager, not the end user. A hook's
own manager action can suppress its recursive callback; specify and test that self-call path instead of assuming the
outer policy repeats.

## Derive accounting, never guess signs

An unlock is complete only when every caller currency delta returns to zero. Model the whole action plan and every actor,
currency, pool, liability, recipient, revert, and settlement step. `take` increases what the caller owes; `settleFor`
credits its named recipient; `clear` destroys an exact positive delta and is acceptable only under an explicit bounded
dust rule. ERC-6909 claims are transferable currency claims: operator and allowance authority can transfer or burn a
holder's claim and affect the external caller's unlock delta.

For ERC-20 settlement the order is `sync(currency) -> transfer -> settle`. The transient sync slot is PoolManager-wide,
not caller- or currency-namespaced, so test overwrite and nested-action reordering. For native value, reset the slot with
`sync(address(0))` immediately before payable settlement. Prove zero final deltas and solvency after success, revert,
claim, rescue, retirement, and dependency failure.

Hook-returned deltas use the hook's perspective: positive means the hook is owed; negative means the hook owes. Core
accounts the hook delta to the hook and subtracts it from the caller. For `beforeSwap`, derive the specified and
unspecified currencies separately for all four direction/exactness quadrants. The specified return delta may reduce the
residual AMM leg to zero but must not cross zero and invert exact-input/exact-output semantics. Bind and test:

```text
residualAmmAmount = amountSpecified + beforeSpecifiedDelta
combinedUnspecifiedDelta = beforeUnspecifiedDelta + afterUnspecifiedDelta
finalCallerDelta = ammDelta - map(beforeSpecifiedDelta, combinedUnspecifiedDelta)
```

Leave `beforeSwapReturnDelta` disabled unless custom accounting needs it and tests prove signs, currency mapping,
rounding, bounds, backing, conservation, settlement, NoOp behavior, and adversarial inputs.

## Custom curve proof order

For a custom curve, write the mathematical domain and invariants before selecting a base or authoring code:

1. define state, units, precision, rounding direction, valid price/liquidity ranges, and terminal states;
2. derive quote and execution from the same transition function and exact hookData/sender assumptions;
3. prove monotonicity or state the intended exception, conservation/solvency, bounded price impact, and no free cycle;
4. cover zero, minimum, maximum, boundary, partial-fill, exact-output, price-limit, repeated-call, and adversarial ordering;
5. prove every externally reachable state has an exit, recovery, or explicit terminal rule; and
6. only then compare a pinned `BaseCustomCurve`/custom-accounting primitive with a purpose-built implementation.

Do not treat a similar class name as semantic proof. One PoolKey has one hook. Multiple behaviors must compose inside
that exact hook or explicit modules without double-owning a callback delta, settlement step, inventory, or authority.

## Execution and evidence boundary

Quotes do not prove execution. Bind quote and transaction to the same block context, PoolKey, sender assumptions,
hookData, router generation, action plan, native value, deadline, Permit2 intent, and final limits. A low-liquidity swap
may partially fill; exact output must receive the full requested output at every relevant hop or revert. A 100% LP fee
cannot support exact output. Separate LP, protocol, hook, project, router, and token fees; this kernel creates no fee or
Programmable-policy requirement.

Minimum evidence includes unauthorized direct callbacks; malformed/replayed hookData; exact callback return lengths;
all four swap quadrants; nested/self actions; sync-slot overwrite; claim operator/allowance paths; partial fills and
per-hop exact output; rounding and price limits; state isolation by PoolId; fuzzed invariants; revert atomicity; and exact
source, compiler, deployment, runtime, configuration, and receipt bindings. Passing them is implementation evidence, not
an audit, approval, deployment, submission, or live-state claim.
