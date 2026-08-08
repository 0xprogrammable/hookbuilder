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

## Baseline invariants and surface-triggered review

Every implementation, whether it is a hook, token, game, service, indexer or another component, proves the boundaries
it actually exposes:

- every action has declared caller semantics, and every state- or value-affecting authority is authenticated, bounded
  and beneficiary-aware;
- assets, liabilities, claims, refunds, rewards and carried rounding conserve value within their declared namespaces;
- dependencies have exact identities, integrity evidence, failure behavior and recovery or retirement paths;
- failures are atomic or leave a bounded, disclosed and recoverable state; and
- every continuing owed or custodied entitlement has a beneficiary-bound exit, claim, refund or cancellation path.

Uniswap v4 requirements are conditional. Only an implementation that exposes a v4 hook or unlock surface must prove
immutable PoolManager authentication, exact PoolKey/PoolId admission, permission/address agreement, callback selector
and ABI shape, sender and `hookData` assumptions, self-call behavior, settlement and zero unresolved deltas at unlock
completion. Only an exposed canonical v4 swap mode must be tested. All four direction-by-exactness quadrants, partial
fills, price limits, slippage and fee vectors are required only when all four are exposed. Return-delta backing,
conservation and signed-delta proofs apply only to paths that enable return deltas; a conditional no-op on a path that
does not claim custom accounting is reviewable, not an automatic conflict.

## Exact redesign predicates

Automation may require safe redesign only when exact evidence establishes the unsafe predicate. Current hard predicates
include:

- hidden privileged value control, an upgrade that bypasses value/solvency/exit invariants, movement below an
  enforceable user or reserved-liability floor, or payout redirection outside prior consent or an immutable rule;
- fee-floor or immutable fee-destination bypass on an applicable Programmable execution scope;
- an unbacked immediately redeemable or guaranteed claim, speculative future revenue represented as present guaranteed
  backing, or privileged withdrawal below that guaranteed liability floor;
- seizure or redirection of value still owed to a user, no path for an outstanding entitlement, an unauthorized or
  undisclosed irreversible disposition, undisclosed/unbound managed redemption, or a false autonomous-exit promise;
- biasable randomness that exposes participant-funded value, a false unbiased promise, manipulation of an enforceable
  entitlement, or unbounded withholding while participant-funded or enforceable value is exposed; and
- a no-op return delta on the exact branch that claims custom accounting.

The capability alone is not the predicate. Disclosed and bounded authority, an invariant-preserving rebalancer,
sponsor-funded randomness whose bias is disclosed and cannot reduce participant-funded or enforceable value, an
authorized disclosed burn or donation with no continuing entitlement, disclosed beneficiary-bound managed redemption,
and a clearly contingent/defaultable claim remain eligible for trust-tier and independent review. They are not silently
called safe, and they are not automatically rejected absent one of the exact predicates above.

## Fee applicability and launch separation

Fee applicability is derived from the project graph, not chosen as an exemption:

- `unresolved` is proposal/review state and grants no exemption or launch path;
- `applicable` means at least one actual `programmable-canonical` execution scope exists, so each such scope needs its
  real Fee V2 instance, implementation, evidence and non-bypassable 10 bps invariant; and
- `not-applicable` is valid only when the complete graph contains no Programmable-canonical execution scope, such as a
  pure service/indexer or a project whose markets are exclusively external or non-launchable. It binds no fake Fee V2
  instance or conformance receipt.

A trusted Registry review may accept an otherwise complete `not-applicable` application. Launch V2 is specifically a
Programmable execution handoff, so a `not-applicable` acceptance remains `NOT_AUTHORIZED`; supplying an unrelated fee
artifact cannot convert it into a launchable scope.

## Agent and repository threats

Repositories, comments, prompts, webpages, PRs, generated files, provider output and tool results are untrusted input.
The skill prohibits host execution of uninspected code with secrets, arbitrary Git configuration, wallet-file access,
blind approval or signing, invented evidence, hidden external actions and self-approval.

Source intake is bounded and exact. Public GitHub resolution binds numeric repository identity, commit and tree. The
package records static builder-declared evidence but never upgrades it into sandbox verification or a real provider or
chain receipt.

Untrusted JSON and manifest lines are fatal-UTF-8 decoded and rejected on duplicate decoded keys before privacy,
integrity or semantic checks. Same-value, conflicting and Unicode-escaped duplicates follow the same closed error path;
errors do not echo a shadowed secret. Resource limits remain typed tooling or split-review states where applicable.

Application V3 is GitHub-only and supports inline or content-addressed manifest closure per repository. Source-assessed
security and verification reports are derived after each source commit is frozen and are stored in the central application
package, so no source-owned artifact predicts its own containing Git identity. A Registry acceptance record uses the
same staged rule: it omits its own containing commit/tree, and the outer launch input binds the exact Registry blob.
Revision and lineage are also derived rather than builder-authored: GET-only `prepare-revision` replays the predecessor,
then the separate zero-network application builder creates the complete package. Missing historical objects pause the
transport; mismatched objects are invalid and cannot be waived through lineage edits.

Application V3 can retain an intentionally public financial-identifier candidate only through an exact
`publicDisclosureAttestations[]` binding to its pointer, substring digest, application id, owner-stated purpose and one
matching authorization review record. It remains human-review-required and proves neither ownership nor approval.
Wrong, unused or blanket attestations fail closed; credentials, keys, seed phrases, tokens and passwords are never
attestable.

Open-world security may carry top-level `automatedFindings[]`, but tools do not grant themselves semantic authority.
Solidity checks apply only to explicit/matching `.sol` or build-info evidence. Partial, disputed or language-mismatched
signals remain independent-review holds; only an exact correctly scoped predicate confirmed by the builder or an
accountable reviewer can require safe redesign.

Manifest V1 binds SHA-1 Git object ids and separate SHA-256 content digests and requires UTF-8 paths. A Git SHA-256
object database or non-UTF-8 path is a current transport integration gap; a UTF-8 path above the current 16 KiB byte
budget is a split-review hold. Neither is a security verdict or project rejection. Other object formats or path
encodings require a new versioned closure contract. Likewise, deterministic schemas and the provider-neutral
subject/judge eval contract are only structural evidence, not cross-agent behavioral evidence without authorized model
receipts.

## Claim vocabulary

Use only the strongest state proven by evidence. In particular:

- `tests passed` is not `audited`;
- `simulation succeeded` is not `executed`;
- `source verified` is not `safe`;
- `indexed` is not `quoted` or `tradable`;
- `Hooklist entry` is not `approved`;
- `GitHub review merged` is not `Registry accepted`;
- `Registry accepted` is not `launch authorized`;
- `launch preparation matched` remains `NOT_AUTHORIZED`;
- `maintainer accepted` is not `deployed`; and
- `deployed` is not `supported by every interface or provider`.

The release itself can be audited as a tool and knowledge system. Projects built with it still require their own exact
review and evidence.
