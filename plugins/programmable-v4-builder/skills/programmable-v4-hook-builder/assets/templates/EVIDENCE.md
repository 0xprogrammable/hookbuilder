# Evidence

> Authoring scaffold: replace every instruction and empty row below with attributable evidence, a truthful pending/
> blocked state, or an explicit not-applicable reason. Do not retain the instructional prose in the completed artifact.

Use this file to record structured evidence and review notes for one exact submission revision.

Every completed gate records its gate id, exact command, tool version, 40-character evidence-origin commit, artifact
path, content hash, result, scope, and exact review-target hash. The origin commit is provenance and may precede the
later packaging HEAD; exact intake identity comes from the committed review target and primary GitHub source binding.

## Authority and package provenance

| Authority | Exact immutable revision, id, digest, or allowed files | Revalidation result |
| --- | --- | --- |
| Trusted intake workflow or service |  |  |
| Pull-request target base |  |  |
| Validator and package contract |  |  |
| Builder skill revision, engineering guidance only |  |  |
| Exact central policy, schema, binding, and selected profile |  |  |
| Optional implementation kernel selected by intent or applicable central Rule ID |  |  |
| Primary numeric repository id, commit, tree, retained bundle digest |  |  |
| Companion numeric repository ids, commits, trees |  |  |

Record `PACKAGE_CONTRACT_DRIFT` when these authorities disagree. Do not convert platform release drift into an
applicant security finding or hand-edit one package generation into another.

Dependency evidence uses stable ids. For an onchain dependency, record chain, address, interface, source revision,
runtime hash, block, RPC class, and trusted deployment record when available. For an offchain dependency, record source
revision, integrity where available, operator, authentication, freshness, funding, failure, and fallback.

Separate builder statements, agent derivations, local tool results, independent review, deployment receipts, source
verification, runtime matching, lifecycle proof, routing review, and product availability.

## Tool coverage and independence

| Property or scope | Tool or method | Exact command/version | Result taxonomy | Artifact/hash | Code author | Test/assertion author | Independent reproducer |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  | passed / failed / tooling-blocked / no-data / not-applicable-with-reason / inconclusive |  |  |  |  |

All tools unavailable, parser failure, or empty output is not clean. Trace scanner candidates to reachability, attacker
control, impact, and a focused reproduction. Same-run agent-generated code and tests are builder evidence, not
independent confirmation. For intermittent failures, cluster up to the last five comparable runs by normalized signature
and preserve the cause of every earlier attributable failure.

## Run-scoped manifest and attestation

Record the unique run id/attempt, immutable subject path and sha256, manifest digest, source/review-target digest,
workflow/service and revision, trigger and environment, skill/central-policy/package/validator/tool/ruleset/suppression
digests, commands and outcomes, signer identity and scheme, transparency/retention reference, verification result, and
superseded record. A valid attestation proves exact-byte provenance only; it does not prove correctness, audit,
approval, deployment, or launchability. Shared mutable `latest` output cannot be the attested authority.

## Central policy evidence

Resolve the exact central policy and selected profile described in `references/approval-criteria.md`. Add one row for
each applicable current Rule ID; do not copy a local gate list or invent a severity, outcome, or evidence demand.

| Central Rule ID | Result | Exact evidence or unresolved fact | Responsible party | Next action |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

This table is applicant or agent evidence only. It is not an audit, approval, deployment, routing decision, or launch
permit.

## Prototype evidence

List the exact compatibility report, review-target hash, compiler and dependency closure, test runs, static-analysis
dispositions, applicable fork block, gas and size results, permission mask, CREATE2 plan, and review layers. Mark missing,
skipped, flaky, reverted, or unavailable methods truthfully. A missing tool blocks only when no attributable alternative
method covers the same triggered property; never relabel its own run as passed.

Re-resolve the primary and companion repositories anonymously immediately before the result. Prove the same numeric
repository ids still expose the exact commits, trees, declared blobs, submodules, and LFS objects. A familiar slug with
a new numeric id is a new authority and invalidates the prior result.

## Change-impact and decision-rendering check

| Changed input | Invalidated results | Rerun evidence | Current disposition |
| --- | --- | --- | --- |
| Source, compiler, or dependency |  |  |  |
| Launch plan, configuration, or address derivation |  |  |  |
| Tests, analysis, or evidence |  |  |  |
| Proposal, threat model, specification, or public claim |  |  |  |
| Repository identity, visibility, or retained object |  |  |  |
| Package, validator, skill, central policy/schema, or selected implementation kernel |  |  |  |
| Tool, ruleset, suppression, prompt/model, workflow, manifest, or attested artifact |  |  |  |

Before handoff, render the full decision and reject it if a required PR head, repository id, commit, tree, digest,
verdict, owner, timestamp, or reachability result is blank, placeholder, malformed, or mixed with another revision.

When project intent or an applicable current central-policy Rule ID selects the legacy Programmable fee kernel, record
its complete policy object, canonical PoolKey and quote asset, rates, exact source/test paths, hook mechanism binding,
supported/rejected quadrants, executed gross quote-side cases, rounding, liabilities, events, claims, isolation, and
bypass tests. Record its immutable-owner claim tests and the quote-asset-derived before/after return-delta path. Otherwise
mark this optional kernel not applicable; this template cannot create a fee or launch requirement.

For delegated funding, record the payer/authenticated actor relationship, allowance/Permit2 mode, typed domain and every
bound field, plus victim-allowance, field-mutation, replay, ERC-1271, revocation, partial-spend, residual-allowance, refund,
and front-running results. For custom accounting, record final combined caller limits, backing/conservation, valid zero-
core-AMM completion, invalid unbacked/no-op deltas, operation-specific settlement, and forbidden `clear` of owed value.

For a `tokenMechanics` transfer tax or automatic liquidity lifecycle with either hook route, also record the exact token source and
constructor, direction rates and immutable maximum, recipient conservation, authority/delay result, requested-versus-
received and actual-user-receipt cases, automatic-liquidity threshold/cap/slippage/deadline, reentrancy and failure
atomicity, LP position identity/custody/exit, and every declared `testScenarios` result. Record provider tests and
provider-owned confirmations separately; a canary, HTTP response, local route, or documentation page is not approval.

## Accepted-model integration evidence

Use this section only when a maintainer acceptance record exists. Bind its path and content hash, model id, version,
prototype commit, submission hash, review-target hash, accepted scope, and open conditions. Do not create or edit the
acceptance record here.

For UI, API, indexer, quote, trade, claim, and monitoring, record:

- Owner, exact source paths, source of truth, dependencies, and accepted model version
- Executable command or manual protocol, tool version, commit, result, artifact, and content hash
- Covered inputs, outputs, errors, unsupported states, stale or reorg behavior, and recovery
- Remaining blocker and next owner action

## Release gate ledger

Track maintainer acceptance, platform implementation review, deployment authorization, deployment execution, source
verification, runtime matching, lifecycle verification, Hooklist/routing/discovery decisions, and product availability
separately. Each row needs its human owner, exact evidence, current state, blocker, and next action.

Contributor-owned `gate-status.json` can record prototype checks only. It cannot complete any row in this release
ledger. A completed row points to a maintainer-owned record bound to the accepted release, relevant commits, chain and
deployment identity where applicable, evidence hashes, reviewer, and decision time.

Use `programmable-registry-integration-review`, `programmable-ui-integration-review`,
`programmable-api-integration-review`, `programmable-indexer-integration-review`, and
`programmable-integration-test-review` for maintainer-owned candidate review. Keep `uniswap-hook-routing-review` and,
when applicable, `permissioned-pool-routing-allowlist` external.

Do not add credentials, signing material, unpatched vulnerability details, generated build directories, or claims that a
local check proves audit, acceptance, product integration, deployment, live fee collection, verification, routing
approval, provider support, or production availability.
