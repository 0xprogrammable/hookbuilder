# PositionManager from-deltas shortcut

Our app lets users add liquidity after a swap. The developer uses `MINT_POSITION_FROM_DELTAS` for new positions and
`INCREASE_LIQUIDITY_FROM_DELTAS` for existing positions because the actions automatically consume the open deltas and
save us from calculating a liquidity amount. The UI still shows a token maximum and transaction deadline.

Review whether these actions are acceptable for a production-facing v4 liquidity client. Give the smallest safe
replacement and name the evidence that proves the replacement is what the final client actually emits.
