# Consumer DeFi game exploration

Use this reference in Explore after the intended product includes a game surface. Its job is to improve the concept
before architecture or implementation: make the player experience, strategic incentives, economic sustainability and
fair-play target explicit. It is not proof that a game is fun, fair, incentive-compatible, legally eligible or at a
Nash equilibrium.

## Discussion contract

Preserve the creator's fantasy and intended player experience. Derive reversible design hypotheses from the idea and
label them as hypotheses. Ask only the first question whose answer would materially change the player promise, value at
risk, payout, fairness target, authority or terminal outcome. Do not make the creator choose protocol details that can
be derived later.

Produce one compact Game Design Card and the next material decision. State each instruction and conclusion once. Do not
request hidden reasoning, tell a model to think harder, or encode reasoning effort or Pro mode in the discussion prompt;
model and effort selection belong to the host and must be evaluated separately from the semantic result.

## Explore in this order

### 1. Player promise and core loop

State what the player should feel and repeatedly do, what ends one session or round, and what makes continued play
meaningfully different from repeating a transaction. Separate intrinsic reasons to play from financial rewards. Record
the intended balance of skill, knowledge, coordination, randomness, time and spending.

Do not treat retention, transaction volume or token price as a substitute for fun. Identify the smallest playable loop
that can be tested without a token, pool or hook when those mechanisms are not essential to the experience.

### 2. Players, actions and information

Identify only archetypes that can change the design: for example a casual player, skilled player, spender, new entrant,
bot operator, colluding group, sponsor, market participant and game operator. For each relevant archetype record:

- available actions and when they occur;
- information visible before and after acting;
- money, time, attention, reputation or opportunity placed at risk;
- possible rewards, losses and externalized costs; and
- whether the action can be repeated, automated, delegated, split across wallets or coordinated.

Use a payoff table when two or more actors can strategically change one another's outcomes. A payoff may remain a
direction or bounded range during Explore; do not invent precise utilities.

### 3. Strategic stability

Describe the desired stable behavior in plain language: what should a rational participant keep doing when other
participants also adapt? Then look for a cheaper or safer strategy that dominates intended play, including inactivity,
late entry, farming, wash activity, multi-accounting, griefing, bribery, collusion, front-running and exit before loss.

Call the result a `strategic-stability hypothesis` until players, actions, information, timing and utilities are
sufficiently specified. Use `Nash equilibrium` only for a stated model and assumptions. Distinguish:

- an equilibrium that exists from one that is desirable;
- individual deviations from coalition or Sybil deviations;
- a one-round result from repeated-game behavior;
- modeled rational behavior from observed human play; and
- equilibrium analysis from mechanism safety, solvency or fairness.

If the intended loop survives only because players overlook a dominant strategy, new entrants subsidize earlier users,
or an operator can selectively change outcomes, return a design risk and the smallest faithful alternative.

### 4. Fair play target

Define fairness rather than claiming it. Cover only applicable dimensions:

| Dimension | Explore question |
| --- | --- |
| Rules | Are the same committed rules applied to comparable players and rounds? |
| Opportunity | Do skill, device, latency, capital, geography or accessibility create intended or unintended advantages? |
| Information | Who learns odds, state changes, prices or opponent actions first? |
| Matching | Who can choose opponents, avoid losses, smurf, multi-account or manufacture easy matches? |
| Spending | What can money buy, what cannot it buy, and when does spending become a dominant strategy? |
| Randomness | Are odds, source, bias, rerolls, scarcity and exhausted-supply behavior disclosed? |
| Adjudication | Who determines results, detects cheating, handles disputes and proves equivocation? |
| Recourse | Can a player cancel, refund, appeal, withdraw and understand a terminal unresolved state? |

Separate equal rules, equal opportunity and equal outcomes. A game may intentionally be asymmetric, difficult or
sponsor-biased if the exact design is disclosed and does not create a hidden authority, loss or guaranteed-return claim.

### 5. Consumer DeFi economy

Trace each asset, right, liability and loss through the recurring game loop. Record:

- who funds rewards and the maximum committed liability;
- token or reward sources, sinks, caps, expiry and unclaimed-value treatment;
- entry payments, fees, treasury flows, prize escrow, liquidity and redemption promises;
- what gives an asset utility inside the game apart from resale expectations;
- how whales, bots, liquidity providers and thin markets can change gameplay or exit value; and
- what happens when participation, revenue, liquidity or external funding falls to zero.

Prefer a bounded season or simulation hypothesis over an unsupported steady-state claim. Do not use projected growth,
future entrants, token appreciation or secondary-market liquidity as proof of solvency or sustainable rewards.

### 6. Authority, failure and evolution

Keep client rendering and non-authoritative play separate from the service or proof that can affect value. Identify who
may change rules, odds, matchmaking, emissions, rewards, bans, results or season parameters; which changes are committed
before exposure; and how players exit under the rules they accepted.

Cover disconnects, draws, timeouts, unavailable services, conflicting results, cheating reports, depleted rewards,
market disruption, season end and retirement. Live-operations flexibility is a disclosed authority with bounds and
recourse, not automatic evidence of fairness.

## Evidence ladder

Report the strongest state actually reached:

1. `design-intent`: the creator's desired experience or fairness target;
2. `model-hypothesis`: predicted behavior under stated actors, strategies and assumptions;
3. `simulation-observed`: reproducible results for an exact model, parameters, seed set and scenarios;
4. `playtest-observed`: attributable human behavior from a defined build and cohort; or
5. `production-observed`: version-bound telemetry with known selection and measurement limits.

One state does not imply the next. Generated examples and agent prose remain design hypotheses. Simulations do not prove
human behavior; playtests do not prove production equilibrium; production metrics do not by themselves prove fair play.

## Game Design Card

Return the smallest card that preserves the material design:

```text
Player promise and core loop
Session, progression and terminal states
Player archetypes, actions and information
Assets, value at risk and source of rewards
Desired strategic behavior
Dominant, degenerate and coalition strategies
Skill, randomness, time and spending balance
Fair-play target and player recourse
Economic sources, sinks, caps and zero-growth behavior
Outcome authority and live-operations powers
Evidence state and hypotheses to simulate or playtest
Assumptions, non-goals and next material decision
```

After the card is stable, feed its facts into ProjectSpec, product graphs and architecture comparison. A game-design
discussion does not select a token, hook, pool, signer, oracle, randomness provider, legal classification or deployment
route by itself.
