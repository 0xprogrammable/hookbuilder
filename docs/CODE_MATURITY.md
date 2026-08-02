# Code maturity snapshot

This is a Trail of Bits-inspired nine-category self-assessment of release `0.4.0`. Scores are `0` (absent) through `4`
(strong, independently evidenced). They are prioritization signals, not safety percentages, audit grades, or approval.

| Category | Score | Current evidence | Most important next step |
| --- | ---: | --- | --- |
| Arithmetic | 3/4 | FullMath and SafeCast; explicit rounding model; unit, fuzz and stateful invariants over fee conservation and exact output | independent property campaign or formal specification |
| Auditing | 1/4 | review maps, security properties, CodeQL, Slither 0.11.5 with 101 detectors and explicit dispositions | independent protocol, agent and supply-chain audit |
| Authentication and access control | 3/4 | immutable PoolManager, registrar and fee-owner boundaries; canonical-pool and cross-owner adversarial tests | verify the same properties on final deployed bytecode and configuration |
| Complexity management | 3/4 | canonical ownership map, closed schemas, generated manifests, progressive router and composable packs | reduce remaining large validators into separately specified modules |
| Decentralization | 1/4 | authority separation and immutable fee claim owner are explicit | document governance and recovery model; central review and fee authority remain intentional dependencies |
| Documentation | 4/4 | operating contract, protocol/platform references, source receipts, security properties, release and migration rules | keep every public release synchronized with upstream drift and implementation changes |
| Transaction ordering and MEV | 2/4 | partial-fill atomicity, per-hop bounds, slippage semantics, donation/MEV and subscriber hazards are modeled | fork-based adversarial ordering and builder-specific economic review |
| Low-level and EVM safety | 3/4 | no custom assembly in the reference kernel; permission-bit, callback, delta, native/ERC-20 settlement and reentrancy boundaries tested | independent bytecode-level and differential review |
| Testing and verification | 3/4 | deterministic package suite, 17 adversarial agent cases, 34 Solidity tests, fuzzing, invariants, three-host install canaries | model-backed evals, Echidna/symbolic campaigns, forks and production monitoring evidence |

The profile is intentionally uneven. Documentation and deterministic construction are mature enough for a public
Builder release; external audit, decentralization, live bytecode evidence and production operations are not. A project
created with this skill starts its own maturity assessment from zero and must earn evidence for its exact source,
configuration and runtime.

See [`SECURITY_AUDIT_READINESS.md`](SECURITY_AUDIT_READINESS.md) for commands, results, limitations and reviewer entry
points.
