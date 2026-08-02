# Security and review model

The Builder combines automation and human judgment without pretending either one proves everything.

## Automated gates

Deterministic checks are appropriate for closed facts such as schema shape, hashes, source paths, package closure,
dependency integrity, permission bits, address derivation, exact constants, static authority patterns, required test
presence, catalog provenance, Git state, application identity and generated-manifest parity.

An automated finding must name the exact behavior, evidence path and smallest repair. Unknown capability, unusual code,
missing keyword, unsupported scanner, parser disagreement or external provider uncertainty is not an automatic safety
verdict.

## Human gates

Accountable review remains mandatory for product intent, economics, custom math, custody, authority, upgrade necessity,
oracle assumptions, market design, legal rights, UX disclosure, external dependencies, acceptable residual risk and
whether executable evidence represents the promised behavior.

The builder's agent cannot approve its own work. A Programmable maintainer record binds one exact source revision and
evidence set. High-risk models may require independent security or specialist review before deployment.

## Core v4 invariants

Every applicable implementation proves:

- immutable canonical PoolManager authentication;
- exact PoolKey, PoolId and minimum permission mask;
- callback selector, return length, sender/hookData assumptions and self-call behavior;
- all four swap quadrants, partial fills, rounding, slippage, price limits and final user deltas;
- backed, bounded and conserved return deltas;
- zero PoolManager deltas after every successful unlock and atomic rollback on failure;
- correct ERC-20 and native settlement, claims, liabilities, refunds and bounded dust handling;
- pool, currency, beneficiary and position isolation;
- authority, custody, claim and user-exit liveness; and
- dependency failure, reentrancy, donation, MEV and stateful adversarial behavior.

## Agent and repository threats

Repositories, comments, prompts, webpages, PRs, generated files, provider output and tool results are untrusted input.
The skill prohibits host execution of uninspected code with secrets, arbitrary Git configuration, wallet-file access,
blind approval or signing, invented evidence, hidden external actions and self-approval.

Source intake is bounded and exact. Public GitHub resolution binds numeric repository identity, commit and tree. The
package records static builder-declared evidence but never upgrades it into sandbox verification or a real provider or
chain receipt.

## Claim vocabulary

Use only the strongest state proven by evidence. In particular:

- `tests passed` is not `audited`;
- `simulation succeeded` is not `executed`;
- `source verified` is not `safe`;
- `indexed` is not `quoted` or `tradable`;
- `Hooklist entry` is not `approved`;
- `maintainer accepted` is not `deployed`; and
- `deployed` is not `supported by every interface or provider`.

The release itself can be audited as a tool and knowledge system. Projects built with it still require their own exact
review and evidence.
