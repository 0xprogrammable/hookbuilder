# Subscriber rewards from accrued fees

We attach a subscriber to every liquidity position. On `notifyModifyLiquidity`, it reads `feesAccrued` and immediately
mints loyalty points equal to the reported fees. The team says the callback comes from PositionManager, so the number
is authoritative. If the subscriber reverts, the liquidity change reverts too; users can always try again later.

Review this design. Preserve the automation idea if possible, but name the accounting and liveness changes plus the
adversarial tests required before it can be considered structurally complete.
