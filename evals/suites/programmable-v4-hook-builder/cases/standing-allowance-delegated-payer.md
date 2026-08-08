# Enter a tournament for another wallet

Our game contract has `enterFor(player, amount)`. To make sponsorship easy, it calls
`entryToken.transferFrom(player, prizeVault, amount)` and records the caller as the sponsor. Many players already gave
the game contract an unlimited allowance for earlier matches, so a sponsor can start a new paid match for any of those
players without another signature. The winner receives the pooled entries. Is this launch-ready, or what should the
payment flow look like?
