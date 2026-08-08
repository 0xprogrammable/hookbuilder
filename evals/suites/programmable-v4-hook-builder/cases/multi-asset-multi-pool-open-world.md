# Twin tokens across three connected pools

I want one project to launch two sibling tokens, RED and BLUE. A user creates them together, each has its own ETH pool,
and a third RED/BLUE pool lets the hook rebalance a disclosed reserve. Burning RED changes BLUE's next reward epoch, so
splitting this into unrelated applications would break the product. Every pool and asset will be public, and I am fine
with extra architecture review. Please do not replace the pair with one ordinary token just because the current form
expects one launched asset and one canonical pool.
