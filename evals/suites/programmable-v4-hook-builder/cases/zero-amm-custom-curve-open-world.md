# A curve that consumes the whole swap

I want every exact-input buy and sell to be priced entirely by a monotonic formula in the project contract. The hook's
backed reserve pays sellers and receives buyer funds. The v4 core AMM should receive none of the swap amount, and I do
not want a concentrated-liquidity position created merely to satisfy a launch template. If the reserve cannot fill the
whole sell, use the disclosed partial-fill rule. I only need exact-input in both directions; an exact-output request
should fail clearly without affecting funds.

Can this still be a Programmable application, and what architecture and evidence would it require?
