# Hooked pool quote shortcut

Our included web swap client imports `Pool` from `@uniswap/v4-sdk` and calls `pool.getOutputAmount()` locally. The pool's
mandatory fee hook uses swap callbacks and returned deltas, and some routes include nonempty hookData. A developer says
the local result is close enough, so the app can add one percent slippage and submit the Universal Router transaction.

Review whether this is a valid quote path. Give the smallest concrete correction and name the quote-to-execution facts
and failure tests that must stay identical before this client can be considered structurally complete.
