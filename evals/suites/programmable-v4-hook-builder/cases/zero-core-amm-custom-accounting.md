# Contract-priced swaps without core liquidity

I want a token whose buy and sell price comes entirely from a reserve-backed formula in the hook. The v4 pool is the
public execution entry, but I do not want to seed a concentrated-liquidity position or let the core curve price any
part of the trade. Buys deposit the quote token into the reserve; sells return quote token and burn the sold project
tokens. The formula changes continuously with circulating supply. Build this as a Programmable launch and tell me what
must be decided before implementation.
