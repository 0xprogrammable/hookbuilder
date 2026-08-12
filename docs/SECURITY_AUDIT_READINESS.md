# Security and audit readiness

This is the review entry point for the private Open-World V2 / Application V3 / Fee V2 and routing development scope. It records
the intended review surface, controls already present in local code and the evidence still required. It is not an
independent audit report, deployment approval or claim that the Builder or an arbitrary generated project is safe.

Exact results are authoritative only in a generated receipt bound to one clean commit, repository tree and portable
skill tree. The ledger below does not assert public CI, independent audit, real provider/model execution, live GitHub
submission, deployment, publication or release-candidate status.

## Review surfaces

In the table below, unprefixed `references/`, `scripts/`, `assets/`, `evals/` and `config/` paths resolve under
`skills/programmable-v4-hook-builder/`. Root-level paths are named explicitly.

| Surface | Canonical path | Primary risk |
| --- | --- | --- |
| Agent operating contract | `skills/programmable-v4-hook-builder/SKILL.md` | unsafe authority, hidden action, stale routing or overclaim |
| Knowledge routing | `skills/programmable-v4-hook-builder/references/knowledge-routing.json` | loading V1 policy for new work, missing required security context or excessive prompt context |
| Historical Submission/Fee V1 | `references/submission.schema.json`, `references/programmable-fee-policy.md`, `assets/reference-kernels/programmable-volume-fee-v1/` | accidental reinterpretation of frozen evidence or migration drift |
| Open-World V2 intent package | `references/idea-source-v1.schema.json`, `intent-contract-v1.schema.json`, `architecture-decisions-v1.schema.json`, `intent-fidelity-v1.schema.json` | lost provenance, invented confirmation, silent intent drift or secret disclosure |
| Open-World V2 submission | `references/submission-v2.schema.json`, `submission-schema-catalog.json`, `scripts/open-world-v2-core.mjs` | false acceptance/rejection, dangling graph references, unsafe extensions or resource exhaustion |
| Layered security | `references/open-world-security-v1.schema.json`, `scripts/open-world-security-core.mjs`, `open-world-source-signals-core.mjs` | absence misread as safety, later declarations erasing observed risk or automated self-approval |
| Fee V2 policy and math | `references/programmable-fee-policy-v2.md`, `fee-policy-v2.schema.json`, `scripts/fee-policy-v2-core.mjs` | incorrect basis, rounding, double charging, fragmentation, unfunded liabilities or cross-scope leakage |
| Fee V2 Solidity kernel | `assets/reference-kernels/programmable-volume-fee-v2/` | callback/delta error, fee bypass, insolvent custody, claim theft, witness griefing or pool confusion |
| Trade capability | `references/trade-capability-manifest-v1.schema.json`, `programmable-trade-execution-v1.schema.json`, `scripts/trade-capability-manifest-core.mjs` | invented route for a no-market project, PoolKey or hook-data drift, adapter spoofing, wrong Permit2 spender, fabricated quote/execution result, or approval/live overclaim |
| Application V3 | `references/public-pr-application-v3.schema.json`, `scripts/public-pr-application-v3-core.mjs` | source substitution, inherited approval, incomplete evidence or application/schema skew |
| Multi-repository source closure | `references/source-closure-manifest-v1.schema.json` and the Application V3 local verifier | missing/duplicate paths, fragment drift, Git object substitution, unsafe subprocesses or denial of service |
| Registry Acceptance V3 | `references/registry-acceptance-v3.schema.json` and Launch Bundle V2 validation | forged maintainer decision, stale external review, reviewed-head/package splice, revision/evidence mismatch, self-reference or acceptance becoming admin authorization |
| GitHub transport and Registry | `scripts/github-*.mjs`, `scripts/registry-discovery*.mjs` | repository replacement, stale refs, prompt injection, unintended write or false novelty decisions |
| Launch Bundle V2 | `references/launch-bundle-input-v2.schema.json`, `launch-bundle-output-v2.schema.json`, `scripts/launch-bundle-v2*.mjs` | mixed revisions, unverified local roots, fee/admin authority confusion or structural success becoming authorization |
| Composition system | `assets/starter-catalog/` | unsafe defaults, evidence inheritance or templates becoming a product allowlist |
| Host packaging and release | `config/plugin.json`, generated manifests, CI and release artifacts | policy duplication, omitted files, supply-chain drift or non-reproducible installation |
| External E2E evidence | `scripts/evals/e2e-external-evidence-core.mjs` | source substitution, self-selected authority policy, incomplete population, or cryptographic validity misread as independent trust |

## Version and evidence ownership

Historical V1 evidence remains attached to the exact V1 submission, Fee V1 kernel, source commit and toolchain that
produced it. Earlier private notes recorded green V1 checks, but those results are not reasserted as current candidate
evidence here and cannot prove Fee V2, Application V3, Open-World V2 or any generated custom project.

New work uses Submission V2 and derives conditional Fee V2 applicability. Application V3 transports the exact V2
intent, security, fee-applicability/conditional instance, review and source closure. Launch Bundle V2 consumes one
reviewed applicable revision but always remains unsigned and `NOT_AUTHORIZED`; a Registry-accepted `not-applicable`
revision is not a launch input. A migration creates a new versioned package with explicit lineage; it never upgrades an
old receipt in place.

Trade applicability is independently `tradable`, `no-market`, or `unresolved`. A tradable market binds one
`NOT_APPROVED` standard-v4 or canonical-adapter manifest plus typed quote/execution evidence. `no-market` binds no route
artifacts, while `unresolved` blocks completion. No route result grants approval, deployment or live-trading status.

## Development evidence ledger

| Check | Evidence state and scope | Public or independent evidence |
| --- | --- | --- |
| Complete deterministic repository gate | The gate and clean-tree rehearsal emit commit/tree/skill-tree-bound receipts; source or generated-artifact drift invalidates prior results | Public Node 22/24 CI pending for the same frozen revision |
| Open-World V2 schemas, V4 semantics, security, composition, routing, and Project Compiler | Focused local suites exercise no-market absence, standard-v4/canonical-adapter contracts, exact Forge runner/source/signature binding and call/revert traces; static receipts remain unauthenticated and `NOT_PROVEN`, runtime traces remain `PARTIAL_EVIDENCE` | Independent adversarial validator, compiler, adapter, and protocol review pending |
| Application V3 and multi-repository dependency/source closure | Local suites and transitive Contract Registry closure tests cover exact-byte carry-through | Trusted central-intake parity and a public large-repository canary pending |
| Registry Acceptance V3 and Launch Bundle V2 | Local suites preserve exact trade manifests/results; every launch result remains unsigned and `NOT_AUTHORIZED` | Exact trusted-review substitution and authority-boundary review pending |
| Fee V1 reference kernel | Historical/local format, build, unit, gas, fuzz, invariant, and Slither evidence is retained for exact V1 bytes only | V1 public CI/reproduction receipt pending for a frozen commit |
| Fee V2 policy, receipt/vector contracts and `standard-amm` kernel | The pinned local campaign covers SDK/Solidity parity and 58 Forge tests, including eight ERC-20/native buy/sell exact-in/out V4Quoter-to-Universal-Router modes, fuzz, invariants, binding slippage, deadline and hook-data negatives | Pinned-fork receipt, Permit2 signatures, deployed bytecode/configuration, public CI, independent conformance, and protocol review pending |
| Other Fee V2 profiles | No evidence may be inherited from `standard-amm` | Profile-specific implementation, custody proof, tests and review required |
| Agent evaluation harness | Seven local test files cover the encrypted sealed-after-design corpus, hard gates, fresh repositories, workspace/symlink mutation, wrapper closure and caller-policy distrust; no real model run was made | Real provider/model and judge receipts, trusted sandbox, comparable public repository E2Es, independent novel holdout/prior comparator, pinned fork, and installed-host behavior remain `EXTERNAL_BLOCKED` |
| Agent Skills publication shape | Canonical and generated payloads must be regenerated and byte-compared after every portable-source change; the dry run publishes nothing | Public tag install and independent multi-host reproduction pending |
| Release checksums, manifest and SBOM | A clean local rehearsal generates commit-bound artifacts twice and compares bytes; only the resulting receipt can assert that run | Independent checksum reproduction pending |

None of this evidence automatically applies after source drift. CI configuration, a test name, configured
fuzz/invariant profile, schema-valid fixture, or builder-authored receipt is not an immutable pass until the exact
command, result, commit, dependency lock, timestamp, and artifact digest are recorded on the frozen revision.

## Candidate controls already present

These are code and contract properties to review, not claims that the final gate passed:

- New-project routing initially loads only compact fee-applicability guidance. Full Fee V2 policy activates after an
  actual `programmable-canonical` or otherwise explicit fee-bearing surface is confirmed; Fee V1 remains a historical
  compatibility contract, and an exact zero-scope project receives no fake fee instance.
- Repository-extension schemas are content-addressed. Malformed schemas and disproven assertions fail invalid;
  unsupported vocabulary routes to tooling review with automatic materialization disabled, resource exhaustion routes
  to split review, and no unsupported assertion is silently ignored or treated as passed.
- Open-world validation runs the semantic security analyzer and never turns schema success into implementation
  authorization.
- Fee applicability is derived as `unresolved`, `applicable` or `not-applicable`. Unknown or canonical surfaces cannot
  claim exemption; an exact zero-scope `not-applicable` prototype binds no fee instance, conformance or fee review.
- Trade applicability is derived separately. `no-market` forbids manifests and trade-result artifacts, while each
  selected tradable market must close PoolKey, route, funding, hook-data, direction, slippage, deadline, fee and test
  bindings. Every manifest stays `NOT_APPROVED`.
- Source scanning is monotone: observed risk survives later contradiction, while missing coverage remains `unknown`.
- Automated findings are language-scoped. Solidity rules run only on matching `.sol` or build-info evidence;
  partial/disputed/language-mismatched signals remain independent-review holds, and only exact confirmed drain or
  deception behavior routes to safe redesign.
- Potential secrets remain held. Only an exact owner-stated, content-bound financial-identifier disclosure can move
  its matched candidate to human review; it proves neither ownership nor approval, and credentials are never attestable.
- Raw V2/V3 submissions, supporting records, manifests, JSONL entries, revision drafts and launch artifacts pass fatal
  UTF-8 plus bounded duplicate-decoded-key parsing before privacy, integrity or semantic review. Same-value,
  conflicting and Unicode-escaped duplicates fail without echoing shadowed secrets.
- Public-copy inspection reconstructs only bounded, statically provable JavaScript string composition, including
  literal-only addition, static templates and literal-array joins. It executes no candidate expressions, getters or
  calls; genuinely runtime-dynamic copy remains a declared human-review boundary instead of being guessed safe. A
  parser or resource-bound failure becomes an explicit tooling blocker while already extracted text is still scanned.
- Application V3 separates small inline closure from ordered, content-addressed multi-repository manifests and fragments.
- `open-world prepare-revision` alone derives Application V3 revision/lineage through exact local replay plus GET-only
  GitHub discovery; `open-world application` separately creates the full package without network access. Both preview by
  default and refuse output inside inputs, worktrees, linked/common Git control, the primary object store or recursively
  referenced external Git alternate object stores. Initial unsafe alternate metadata fails before network access;
  bounded root snapshots are revalidated before staging and atomic rename so later drift fails before final output.
- Application V3, Registry Acceptance V3 and Launch V2 use canonical positive decimal-string revisions; V1 retains its
  historical integer representation.
- Local Git verification uses hardened read-only subprocess configuration, bounded output and explicit time/resource
  limits; candidate code, build scripts, filters and submodules are not intended to execute during intake.
- Manifest V1 supports SHA-1 Git object databases, separate SHA-256 content digests and UTF-8 committed paths. Git
  SHA-256 object databases and non-UTF-8 paths are explicit `INTEGRATION_PENDING` transport gaps; a UTF-8 path above the
  current 16 KiB byte budget is a `HOLD_SPLIT_REVIEW` resource case. Other object formats or path encodings require a
  new versioned closure contract.
- Registry acceptance is nullable before maintainer decision, omits its own containing commit/tree and is bound later by
  the outer launch input; it never supplies admin authorization.
- Registry may accept an exact `not-applicable` application, but Launch V2 must keep it `NOT_AUTHORIZED` because no
  canonical Programmable execution scope exists.
- Fee recipient, maintainer decision and independent admin authorization remain separate authorities.
- Launch Bundle V2 emits no transaction or signature, performs no network action and cannot change `NOT_AUTHORIZED`.
- The CI definition includes separate V1 and V2 reference-kernel jobs so V1 history cannot stand in for V2 execution.

## High-value invariants

- Unknown product categories, many assets, zero-AMM accounting, games, services and unfamiliar architectures remain
  eligible for bounded architecture review; openness does not waive concrete security or evidence requirements.
- Exact public-safe idea bytes precede agent interpretation. Every material intent fact remains confirmed, unresolved or
  visibly changed through fidelity records.
- A later security layer can reveal a conflict but cannot erase an observed capability, authority or risk.
- Every component proves its actual authorization, conservation, dependency, failure and exit boundaries. PoolManager
  callback/unlock authentication and permission/address bits apply only to a confirmed v4 hook; zero unresolved deltas
  applies only to an exposed unlock path, and return-delta/quadrant evidence only to the corresponding exposed modes.
- For every declared Programmable fee scope, the inclusive platform entitlement is exactly 10 bps of executed gross
  quote volume; deposits, cancellations, refunds, LP fees and unrelated markets are not volume.
- Platform and project liabilities use independent cumulative remainders, remain fully funded and cannot be claimed or
  redirected across owner, pool, chain or quote-currency boundaries.
- The bundled Fee V2 Solidity kernel proves only the `standard-amm` profile if its exact final evidence passes. Zero-AMM,
  async, sponsored, collateralized and custom-reviewed profiles require their own runtime implementation and evidence.
- Standard-v4 and canonical-adapter manifests prove only declared local contracts. Provider quoteability, hosted routing,
  signing, broadcast, deployed code, transaction receipts, indexing and live market availability remain independent.
- Exact unsafe predicates, not capability labels, drive redesign: owed-value seizure, unauthorized/undisclosed
  disposition, undisclosed/unbound managed redemption, liability-floor or fee-floor/destination bypass, false exit/guarantee, participant-value or entitlement
  exposure to biasable/unbounded-withholding randomness, and no-op claimed custom accounting. Disclosed bounded controls,
  invariant-preserving rebalancing, sponsor-funded disclosed bias, authorized burn/donation, managed redemption and
  contingent claims remain trust/review cases absent those predicates.
- Every Application V3 repository binds immutable identity, commit, tree and complete source closure. One companion
  repository cannot satisfy another repository's paths or evidence.
- A Git object-format or path-encoding/length limitation blocks only current source transport. It cannot become a
  product/security finding or be repaired by silently widening a published closure schema.
- An agent, local validator, prior application or generated report cannot grant maintainer acceptance or launch
  authorization to new bytes.
- A matched Launch Bundle V2 remains preparation evidence only; signing, deployment, configuration verification,
  indexing and availability are separate external states.

## Remaining release and production gates

### Candidate freeze and deterministic proof

- Freeze one clean commit and tree after all V2/V3 changes, generated files and docs agree.
- Run the full repository gate and publication dry run; record exact output and artifact digests instead of pass counts
  copied from an earlier worktree.
- Reinstall the exact candidate into clean Codex, Claude Code and an additional supported Agent Skills host, then compare
  installed bytes with the release archive.
- Generate and independently reproduce checksums, file manifest, SPDX SBOM and release-state receipt.

### Fee V2 and smart-contract assurance

- Reproduce pinned format, compile, unit, native/ERC-20 integration, boundary, fuzz/property, stateful invariant, static
  analysis, bytecode size and gas/performance campaigns for the exact V2 kernel.
- Add or reproduce adversarial transaction ordering, stale exact-output witness, partial-fill, reentrancy/nested-call,
  token-quirk, router-parity and mainnet-fork evidence.
- Independently review v4 permission bits, return-delta signs, PoolManager claim-token custody, rounding, claims and the
  complete deployed configuration.
- Treat every non-`standard-amm` collection profile as a separate implementation and threat model; policy arithmetic or
  declared sponsor/collateral values are not custody proof.

### Application V3 and trusted intake

- Demonstrate deterministic Application V3 generation and trusted validation from the same positive and negative
  corpus.
- Reproduce source A to source B revision derivation, same-repository historical replay, explicit removed/replaced
  predecessor roots, mixed manifest/inline removal and V1-to-V3 migration. Confirm that unavailable historical objects
  are integration-pending while corrupt objects are invalid and neither can inherit acceptance.
- Exercise a source closure above the inline limit, multiple fragments and at least one companion repository against raw
  objects from the pinned Git commits.
- Reproduce path, symlink, object replacement, malicious Git configuration, parser budget, timeout, duplicate/range,
  hash and repository-substitution failures without executing candidate code.
- Reproduce same-value, conflicting and Unicode-escaped duplicate keys at every public raw-JSON boundary before privacy
  scanning, including a shadowed-secret case whose error/output contains no secret bytes.
- Prove public GitHub reachability, application revision/update lineage and status reads separately from local closure.
- Add a new versioned source-closure contract and cross-format/path-encoding corpus before claiming Git SHA-256 object
  database or non-UTF-8 path support. Treat paths above the current 16 KiB byte budget as explicit split-review resource
  cases until a reviewed implementation raises or removes that operational limit.

### Agent/provider neutrality

- Preserve provider selection in the explicit subject/judge run contract outside semantic eval cases and rubrics. The
  provider-neutral definitions are not evidence of behavioral parity across hosts.
- Structurally prove that adding a provider does not mutate or invalidate the semantic suite.
- When credential and cost authority are separately granted, record isolated OpenAI and third-provider/host results with
  model id, provider, suite digest, timestamp, cost and raw receipt. No such model-backed result is currently claimed.

### Independent audit, deployment and runtime

- Complete an independent audit covering the portable agent contract, schema/validator logic, Git/source transport,
  Fee V2 Solidity, supply chain and admin handoff. No independent audit is currently claimed.
- Record source commit, compiler/settings, dependency locks, creation/runtime bytecode, constructor and registration
  values, transaction receipts and explorer verification for any deployment. No production V2 deployment is claimed.
- Verify the final configuration and every admin/fee authority from two independent finalized RPC providers before any
  signing or activation.
- Establish monitoring, alerts, indexer reconstruction, claim reconciliation, incident response, key compromise,
  recovery and retirement procedures before public availability.
- Verify wallet, router, quote, provider, explorer, chain and platform compatibility independently. No provider support,
  indexing, quotation, tradability or live availability follows from this repository alone.
- External games, apps, servers, keepers, oracles, bridges and legal/economic claims retain their own threat models,
  evidence and accountable reviewers.

## Suggested independent review order

1. Freeze the exact candidate and reproduce checksums, manifest and SBOM.
2. Review version ownership and prove V1 evidence cannot satisfy a V2/V3 gate.
3. Review intent provenance, schema-engine bounds, security-layer monotonicity and privacy holds.
4. Challenge hardened Git execution, multi-repository manifests and Application V3 trusted-intake parity.
5. Re-derive Fee V2 economics, value flow, rounding, custody, permissions and claim separation before line review.
6. Re-run deterministic, static, fuzz, invariant, fork, gas and model-backed campaigns independently, recording skips as
   `NOT_RUN` rather than passes.
7. Trace every authority transition from agent output through maintainer decision, Launch Bundle V2 and external admin.
8. Verify final deployed bytecode/configuration, provider behavior, monitoring and incident procedures separately.
9. Record findings against exact commits and distinguish Builder defects from defects in generated projects.

Security reports follow [`SECURITY.md`](../SECURITY.md). The maturity snapshot is in
[`CODE_MATURITY.md`](CODE_MATURITY.md), and the V2-specific release contract is in
[`OPEN_WORLD_V2_RELEASE_GATES.md`](OPEN_WORLD_V2_RELEASE_GATES.md).
