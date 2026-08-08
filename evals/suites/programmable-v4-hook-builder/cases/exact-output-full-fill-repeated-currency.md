# Exact-output full fill with repeated currency

I am building an exact-output v4 route A to B to A to C. The final PoolManager currency deltas look correct, so I plan
to accept success even if the B to A middle hop hits its price limit and returns less output than requested. The
contracts registry currently points at both the latest Universal Router and v4-periphery heads. Tell me whether that is
enough, which exact invariant and dependency distinction I need, and the regression tests the client and router need.
