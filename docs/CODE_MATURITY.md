# Code maturity snapshot

This is a Trail of Bits-inspired nine-category self-assessment of the Open-World V2 / Application V3 / Fee V2 and
first-class routing source. Scores are `0` (absent) through `4` (strong and independently evidenced). They are prioritization
signals, not safety percentages, audit grades, approval, deployment evidence, or release readiness.

Exact command outcomes belong in a separate clean commit/tree/skill-tree-bound receipt; this document does not turn
source or test inventory into execution evidence. Historical V1 evidence and optional implementation Legos do not raise
the maturity of Fee V2, routing, or generated projects.

| Category | Score | Current evidence | Evidence still required |
| --- | ---: | --- | --- |
| Arithmetic safety | 3/4 | Fee V2 bounds rates, uses `FullMath` and checked casts, separates project/platform remainders and liabilities, and exercises arithmetic with fuzz and stateful invariant tests | Independent differential reproduction or formal properties over the exact frozen implementation |
| Auditing and observability | 2/4 | Versioned security properties, events, Slither/CodeQL configuration, review states, and an incident runbook exist | Independent audit, public CI receipts, deployed monitoring, and an incident rehearsal |
| Authentication and access control | 2/4 | PoolManager, pool, registrar, owner, fee-recipient, and claim boundaries are explicit and negatively tested | Verified deployment configuration, multisig/key rotation/recovery, and independent review of every authority path |
| Complexity and maintainability | 2/4 | The maintainability gate discovers 329 production modules; bounded size/import checks, five source-bound responsibility groups, and six targeted mutations cover selected critical owners | Repository-wide semantic-rule and coverage inventories, stronger semantic complexity measures, and broader mutation testing |
| Decentralization and trust | 2/4 | Fee ownership, maintainer review, and launch administration are separated; the reference kernel is not upgradeable | Published governance, recovery, and key-compromise procedures for central registrar, owner, signer, reviewer, and admin dependencies |
| Documentation | 3/4 | Architecture, security properties, release boundaries, operations, E2E methodology, routing limitations, and evidence states are documented | Freeze all documents and generated receipts against the final immutable revision and independently reproduce them |
| MEV and transaction ordering | 3/4 | Slippage/deadline obligations, partial-fill rollback and exact-output witnesses are paired with real pinned local V4Quoter-to-Universal-Router execution, Permit2/native funding, and atomic stale-bound negatives | Fork-based adversarial ordering, stale-witness griefing analysis, and deployed router/economic review |
| Low-level and EVM safety | 3/4 | Productive Solidity avoids custom assembly, unchecked arithmetic, delegatecall, and arbitrary calls; the bounded low-level `staticcall` validates success and exact return length | Bytecode-level review, non-standard-token analysis, cross-language differential evidence, and independent v4 settlement review |
| Testing and verification | 3/4 | Local unit, negative, fuzz, invariant, compiler, registry, routing, schema and maintainability lanes exist; the release generator inventories 58 Fee V2 Solidity test functions in source, while execution outcomes require a clean revision-bound receipt | Real provider/model execution, trusted external sandbox, comparable public repository E2Es, independent novel holdout, prior comparator, pinned fork, and installed-host natural-language-to-submission evidence |

**Total: 23/36, mean 2.56/4 — Moderate maturity.**

## Strongest local evidence

- Maintainability: 329 production modules, bounded size/import checks, five source-bound responsibility groups and six
  targeted mutation classes. These remain narrow proxies, not repository-wide coverage or mutation claims.
- Contract Registry: 51 portable contracts, 26 validator closures, 1,036 transitive module bindings, 177 distinct modules, and
  fail-closed mutation, unresolved-import, and cycle tests.
- Reference kernel: pinned local Uniswap/OpenZeppelin dependencies, eight ERC-20/native buy/sell exact-in/exact-out
  V4Quoter-to-Universal-Router modes, Permit2/native funding and SDK/Solidity encoding parity. The release generator's
  source inventory contains 54 unit, one fuzz and three invariant functions; only an exact receipt can claim execution.
- Trade capability: each selected tradable market binds a machine-readable `NOT_APPROVED` standard-v4 or canonical
  adapter manifest plus typed quote/execution contracts; `no-market` emits none and `unresolved` cannot complete.
- Project Compiler: the portable path never executes candidate commands under the host UID. No-market authoring writes
  inert source/test bytes plus a source-bound materializing plan; tradable write and `project execute` fail closed with
  `PROJECT_EXTERNAL_SANDBOX_REQUIRED`. The external receipt contract binds source/plan/input, launcher/runtime,
  enforced filesystem/network/secret/write/process policy and result hashes to an independently trusted Ed25519 signer.
  No production trust root is configured, so local receipts remain `NOT_PROVEN` and unauthenticated.
- E2E harness: the repository gate dynamically discovers 9 local test files covering encrypted sealed-after-design
  cases, hard gates, fresh checkouts, immutable
  judge evidence, workspace/symlink mutation, wrapper closure and external-evidence trust. These are harness tests; all
  six real external evidence classes remain `EXTERNAL_BLOCKED` and `releaseCandidate` remains false.

## Findings and assurance boundary

A bounded source review confirmed no source-level P0 and no exploitable P1 in the Fee V2 runtime. This is not an
independent audit result and does not prove absence.

Release-blocking evidence remains external or unexecuted:

- the real 216-run three-tier model matrix and provider-verified usage receipts;
- a trusted separate-UID, container, or VM sandbox with descendant teardown;
- a comparable public repository-E2E population, independently novel holdout, and prior-release comparator;
- pinned fork execution and deployed configuration/bytecode verification;
- installed-host execution from natural-language idea through complete repository and submission.

Additional assurance limits include stale exact-output witness ordering/gas griefing, fixed owner/admin/signer roles
without proven recovery, absent Permit2-signature and deployed/fork routing evidence, non-standard-token assumptions,
narrow coverage/mutation gates, design-only monitoring, and known transitive advisories in the pinned offline SDK/test
dependency tree.

## Interpretation

The source and harness support a clean, commit-bound local rehearsal and handoff for external evaluation. A successful
receipt may state `LOCAL_INFRASTRUCTURE_AND_PACKAGING_REHEARSAL_VERIFIED`; it must still state
`releaseCandidate: false`. Stable release, production deployment, audit, provider, fork or onchain-safety claims remain
blocked until independent evidence closes the external gates for the exact same immutable revision.

A generated project inherits no score from this repository. Each project must earn evidence for its exact intent,
source, dependency closure, fee profile, custody, authorities, deployment, and runtime.

## State separation

- Candidate code present does not mean the aggregate repository gate passed.
- CI configured does not mean public CI executed successfully.
- Schema-valid does not mean intent-preserving, secure, or approved.
- Source closure verified locally does not mean public reachability, successful build, or trusted intake.
- Registry application accepted does not mean launch authorized.
- Launch Bundle V2 matched still means `NOT_AUTHORIZED`.
- Compiled or locally tested does not mean independently audited, deployed, or bytecode-verified.
- Local quote/execution artifacts do not prove provider routing, signing, broadcast, transaction receipt or live trading.
- Deployed would not by itself mean indexed, monitored, provider-supported, or publicly available.

See [`SECURITY_AUDIT_READINESS.md`](SECURITY_AUDIT_READINESS.md) for the evidence ledger, limitations, and independent
review order, and [`RELEASING.md`](RELEASING.md) for the release-state contract.
