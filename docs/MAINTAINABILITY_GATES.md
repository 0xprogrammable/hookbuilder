# Maintainability evidence

The repository records three narrow kinds of maintainability evidence. They are designed to reveal drift without
claiming that automated checks replace review, audits or runtime proof.

## Critical responsibility-group coverage

Run:

```bash
npm run quality:coverage
```

This uses Node's built-in test coverage and measures exactly five reviewed responsibility groups comprising 23 current
modules: one canonical-JSON module, all nine `github-application-*` modules, all nine `public-claims-*` modules, one
strict-JSON module, and the three trade-routing owners for manifest semantics, V4 deployment/trace evidence and the V4
semantic contract. For the two decomposed namespace surfaces, the gate discovers the complete current inventory and
requires an exact sorted match. `config/maintainability-coverage-baseline.json` binds every listed module's source bytes,
records aggregate line/function/branch counts and retains both the reviewed group thresholds and historical surface-size
floors. A matching module addition or omission, a facade-only rebaseline, or a source change therefore fails closed until
the complete group is freshly measured and reviewed.

This is not repository-wide coverage. The machine report says so explicitly. Node.js 24 or newer is required.

## Targeted mutation evidence

Run:

```bash
npm run quality:mutations
```

The gate copies the relevant skill files into an owned temporary directory and applies six real, reviewed mutations:

- change the canonical digest algorithm;
- bypass duplicate-key rejection;
- bypass the prelaunch application stop;
- bypass unsupported-public-claim detection;
- let a standard-v4 ERC-20 mode escape its required Permit2 funding profile;
- make a nested canonical adapter ignore the Universal Router as Permit2 spender.

Each mutation must make its named assertion fail. The repository does not convert these six checks into a broad
mutation percentage or claim that untested mutations were killed.

## Size non-regression budget

Run:

```bash
npm run quality:size
```

The gate discovers every production `.mjs` module below `scripts/quality` and the builder's `scripts` directory, excluding
the builder test directory: 318 modules in the current reviewed observation. It evaluates every discovered module against
an immutable historical no-growth manifest, an exact reviewed override or the stricter new-file line, byte, lexical-
complexity and block-depth caps in `config/maintainability-size-budget.json`. It also reports static relative-import cycles
and unresolved relative imports, and measures the complete portable package against its reviewed file/byte limits while
rejecting symlinks. The report keeps `broadQualityClaimed: false`; passing these bounded proxies is not a broad
maintainability, code-quality or security claim.

`npm run quality:maintainability` runs all three deterministic gates. The canonical `npm test` repository plan invokes this
combined gate exactly once under a bounded child-process timeout; CI runs `npm test` rather than invoking either
maintainability sub-gate again.

## Dependency advisories

Run a point-in-time query with:

```bash
npm run quality:advisories
```

The command reads npm's advisory service for the root package and both reference kernels. It snapshots every
`package.json` and `package-lock.json` before and after the query and fails if npm changes them. Advisory findings are
reported, not automatically fixed.

`.github/workflows/dependency-advisory.yml` runs the same query weekly and on manual request. It has read-only
repository permission, does not retain checkout credentials and creates no commits, branches, issues or pull
requests. This deliberately preserves the single-human-contributor model: dependency decisions remain explicit
review work rather than bot-authored history.

The scheduled result is a current advisory observation, not proof that a future advisory does not exist and not a
security audit.
