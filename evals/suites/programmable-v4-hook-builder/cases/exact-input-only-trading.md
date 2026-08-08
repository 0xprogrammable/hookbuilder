# Exact-input trades only

The custom pool supports buys and sells where the trader fixes the input amount and receives at least a quoted minimum
output. It intentionally has no exact-output path because the reserve and rounding model cannot promise an arbitrary
requested output safely. The app should quote and route only those two exact-input directions and reject every
exact-output request before funds or approvals are touched. Build the launch and swap integration without adding trade
modes we did not ask for.
