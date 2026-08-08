# Build a complete measurement-driven market in one run

Build this locally end to end and prepare it for review, but do not publish, deploy, sign, or open a pull request. A
community climate challenge has one fully collateralized weekly yes/no market. Users deposit USDC on Ethereum before
Friday 18:00 UTC on whether the median temperature at station set `ALPINE-7` exceeds 30.0 Celsius during the fixed
Saturday 12:00-13:00 UTC window. Five named station operators sign raw tenth-degree Celsius observations in a versioned
EIP-712 domain; at least three valid operators are required. The estimator is the deterministic median of accepted raw
readings. Market price comes only from the trading mechanism and must not be called the forecast probability. Resolution
uses the estimator threshold, has a 24-hour dispute window, and refunds all collateral pro rata if quorum is absent,
signatures conflict, a correction remains unresolved, or finalization misses seven days. Rules cannot change after the
first position. Payouts are winner-takes-collateral pro rata after the dispute window, with no admin redirection. Use the
smallest complete architecture, apply Programmable fees only where actually applicable, and create the first complete
vertical slice with tests and a predicted A1-A11/P1-P9 result.
