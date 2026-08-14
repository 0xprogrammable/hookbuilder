# Maintainability ownership and decomposition map

The current local source tree has one reviewed production JavaScript module above 750 physical lines:
`scripts/cli-central-base.mjs` at 827 lines. It passes an exact no-growth baseline but remains reported legacy size debt;
the other former orchestrator monoliths remain stable public facades over responsibility-specific modules. Public
exports, diagnostic identities, ordering, and authority stops are regression-tested at each boundary.

| Facade family | Responsibility owners | Required proof for later changes |
| --- | --- | --- |
| `scripts/open-world.mjs` | Command, application, GitHub, materialization, reporting, runtime, and source-verification modules | CLI/golden regressions, atomic output and authority-stop tests, exact export and import-graph checks |
| `scripts/submission-core.mjs` | Contract, graph, fee, hook, source, identity, operations, reporting, and target-validation modules | Finding code/order, schema-negative corpus, V4 semantic contract, and dependent launch/application tests |
| `scripts/launch-bundle-v2-core.mjs` | Domain, execution, registry, security, artifact, and shared-validation modules | Wrong-binding negatives, unchanged unsigned/`NOT_AUTHORIZED` result, exact public API, and dependent CLI tests |
| GitHub/Application and Public Claims | Complete namespace groups discovered by the coverage gate | Per-module source hashes, aggregate historical coverage floors, and omission/facade-only anti-gaming tests |
| Project Compiler and Contract Registry | Typed contracts, bounded local executor, repository-completion validation, and transitive validator closure | Exact receipt trust state, mutation/unresolved/cycle failures, and frozen source/closure digests |

The machine gate currently discovers 328 production modules across its two closed roots. It evaluates immutable-baseline,
exact reviewed-override, and new-file hard-cap classes; rejects cycles and unresolved relative imports; and applies a
portable package ceiling. Reviewed overrides lock decomposed facades to their post-split metrics so they cannot regrow
to historical monolith sizes.

These controls are intentionally narrow. The complexity score is a dependency-free lexical proxy, coverage is bound to
five reviewed responsibility groups comprising 23 source-hashed modules rather than the whole repository, and mutation
testing covers six selected failure classes. The routing group owns the trade-manifest contract, V4 deployment/trace
evidence and V4 semantic contract together. Passing them does not establish broad code quality, semantic completeness,
security, runtime behavior, or production readiness.
