# Programmable Hook Builder Evaluations

This directory evaluates the canonical `programmable-v4-hook-builder` skill as an agent workflow. It follows the
declarative Promptfoo and Nx project shape used by the official `Uniswap/uniswap-ai` repository, while keeping
Programmable's cases, rubrics, and release decisions independent.

The local evaluation tooling has three separate boundaries:

1. `npm run test:evals` deterministically validates the complete suite structure, registrations,
   source receipts, safety thresholds, context routing, the six layered-response forward tests, and absence of committed
   model results.
2. `npm run test:evals:e2e` runs all seven local Node test files for the validators, encrypted-corpus contract,
   fresh-repository runner, external-evidence fail closure, and fake-adapter regressions. It calls no provider and proves
   no model quality.
3. `node scripts/evals/run-model-evals.mjs --suite programmable-v4-hook-builder` runs the probabilistic model evaluation
   only when the configured provider credential and the exact reviewed local Promptfoo `0.121.11` installation are
   available.

Missing model credentials produce an explicit `MODEL_EVALS_SKIPPED` result and no result artifact. Release automation
must add `--require-provider`; with that flag a skipped model run fails instead of appearing green. An offline structure
pass is never represented as a model-quality pass, security review, Programmable approval, Uniswap endorsement, deploy,
routing result, or provider support.

All cases marked `safetyCritical` in the suite manifest use an exact `1.0` LLM-rubric threshold. Their rubrics are
binary: every required behavior must be present and no forbidden behavior may appear. Less critical selection quality
may use a lower documented threshold.

`evals/forward-tests/` is a separate deterministic contract suite. Its static fixtures cover a novice German
contract-priced curve, a wild multi-repository browser game, a zero-scope service, an unknown capability, a concrete
unsafe mechanism with safe redesign, and independent state/status journeys. The validator enforces a concise
builder-facing layer with at most one material decision while retaining facts, findings, evidence, gates, and operations
assumptions in the artifact layer. These fixtures are authored test data, not generated model results.

The prompt wrapper loads the main skill plus only the reference profile required by each case. A case cannot choose an
arbitrary path. This mirrors progressive skill loading without allowing test input to read files outside the canonical
skill package.

The official-source observations that informed the framework and adversarial cases are pinned in
`source-receipts.json`. They are provenance for this suite, not proof that an upstream deployment, recommendation, or
policy is still current.

## Versioned end-to-end repository evaluation

There are two different evaluation populations, and their pass rates are never combined:

- 47 public response evaluations exercise the installed skill through Promptfoo.
- 24 encrypted, sealed-after-design repository scenarios exercise fresh-repository generation. A complete configured
  sealed matrix is 24 cases x 3 model tiers x 3 repetitions = 216 runs.

The public response cases are not a comparable public fresh-repository population. No cross-method holdout fraction or
repository-E2E denominator is claimed. The cross-method inventory hash binds both populations for change detection only.

`node scripts/evals/run-e2e-evals.mjs --validate-only` is keyless. It validates opaque case IDs, AES-256-GCM envelope
shape and ciphertext hashes, bundle hashes, corpus counts, and manifest identity without calling a model. It does not
claim to validate the encrypted prompt, language, category, fork requirement, mutation, variant, novelty, or rubric.
Provider-backed execution decrypts all 24 payloads in the trusted parent, validates their exact coverage and eight
hard-gate memberships, and passes only the natural prompt to the subject boundary.

Every committed case payload is encrypted: prompt, metadata, fork flag, declared novelty, mutations, variants, and
rubric. The 32-byte AES key must be provisioned as a regular `0600` file at an absolute path outside the repository, for
example with a restrictive umask and a cryptographically secure 32-byte generator. The key is never committed, copied
into a fixture, printed, hashed into a public plaintext-membership oracle, or passed through subject argv, environment,
or working directory. Deleting the only provisioned key makes the corpus unrecoverable; key rotation therefore requires
an authenticated decrypt-and-reseal operation and fresh bundle/manifest hashes.

Provider-backed execution uses:

```text
PROGRAMMABLE_E2E_AGENT_ADAPTER_JSON='["agent-adapter", "..."]'
PROGRAMMABLE_E2E_JUDGE_ADAPTER_JSON='["judge-adapter", "..."]'
PROGRAMMABLE_E2E_FRONTIER_MODEL='subject-model-id'
PROGRAMMABLE_E2E_MID_MODEL='subject-model-id'
PROGRAMMABLE_E2E_SMALL_MODEL='subject-model-id'
PROGRAMMABLE_E2E_JUDGE_MODEL='independent-judge-model-id'
PROGRAMMABLE_E2E_HOLDOUT_KEY_FILE='/absolute/outside-repository/holdout.key'
PROGRAMMABLE_E2E_SUBJECT_SANDBOX_WRAPPER='["/absolute/node", "/absolute/trusted/sandbox-wrapper.mjs"]'
PROGRAMMABLE_E2E_SUBJECT_SANDBOX_RECEIPT='/absolute/trusted/sandbox-contract.json'
PROGRAMMABLE_E2E_FORK_RPC_PROXY_URL='http://127.0.0.1:PORT'
node scripts/evals/run-e2e-evals.mjs --repetitions 3 --output /absolute/new/path/scorecard.json
```

The wrapper contract is mandatory for real execution. It must be outside the repository and bind the complete wrapper
argv plus the content identity of its executable, absolute interpreter script, and absolute file/config arguments to a
separate UID, container user, or remote VM. Inline interpreter programs (`--eval`, `-e`, `-c`, or equivalents) are
rejected because command text alone cannot close their dynamically reconstructed file dependencies. The wrapper must
cover subject generation, every install/build/test/fuzz/
fork/deployment/submission process, and the independent judge; deny the source repository and key; deny external writes;
enforce role-scoped network egress; and reap every descendant before returning. A temporary HOME, environment scrubbing,
or `0600` alone does not isolate same-UID hostile code. Without the wrapper and per-invocation receipts the result is
`EXTERNAL_BLOCKED`. The current generic contract and runtime receipts are wrapper-authored operator claims, not a
provider signature or a cryptographic proof supplied by this repository. This harness therefore keeps
`trustedSubjectAndStageSandbox: false` and `TRUSTED_SANDBOX_ATTESTATION_VERIFIER_MISSING` even when such a wrapper runs.
A future release-grade verifier needs an independent trust root and must authenticate the isolation identity, policy,
request, receipt, and process-tree teardown; self-authored JSON plus a wrapper hash is never sufficient.

The subject receives a suite-pinned copy of one skill revision plus the natural prompt. Harness-owned arguments such as
`--prompt`, `--skill`, `--request`, and `--output` are rejected in base adapter commands, including `--flag=value`
forms. The adapter must commit the generated source, tests, repository contract, intent, architecture, deployment
manifest, and submission artifact. A fresh clone then executes, in exact order: install, compile, typecheck, lint, unit,
negative, fuzz, invariant, fork when applicable, gas, code-size, deployment, and submission.

Each executable stage must invoke a distinct project-bound command. The harness validates tracked stage-specific source
and tests, nonzero runner results for supported test tools, source immutability checks, and a harness-authored evidence
receipt bound to the generated Git tree. One no-op script reused for all stages, inline evaluation, constant-assertion
fixtures, dirty revisions, untracked evidence, symlinks, missing lockfiles, or duplicate placeholder artifacts fail.
Test-like stages that meet these structural and runner checks are logged as `PARTIAL_EVIDENCE`, never as a semantic
test pass. Correlated self-comparisons can still exercise production code without testing an independent expected
behavior. The scorecard therefore emits `SEMANTIC_TEST_ADEQUACY_UNPROVEN` and keeps
`semanticTestAdequacyEstablished: false` until an independent behavioral/mutation verifier exists. These structural
checks do not prove semantic callback, fuzz, or invariant coverage; the rubric judge and external review remain
separate evidence.

The judge runs against a file-for-file snapshot of the frozen generated commit. Every citation must be a member of the
pre-judge tracked inventory with the exact frozen hash and bounded line range. After repository stages finish, the
harness also takes a bounded file/hash snapshot of the complete verification workspace except its root `.git`
directory, then compares it again after judging. This includes transient directories at any depth and harness stage
receipts. Symlinks are accepted only when they resolve inside the workspace directly to a regular file; the link target,
resolved path, byte count, and resolved file hash are bound. Directory, escaping, broken, cyclic, and special-file
symlinks fail. Judge-created files, source mutation, symlink-target mutation, or delayed leftovers fail. The judge model
identity must differ from every selected subject model.

The scorecard logs commands, exit states, durations, evidence hashes, stdout/stderr hashes, generation and judge token
claims, context-token claims, tool calls/errors, retries, questions, escalations, manual interventions, and p50/p95
distributions overall, by tier, and by opaque scenario. Token/tool telemetry and provider receipts are explicitly
adapter-reported unless an external verifier establishes them. Duplicate provider request/invocation IDs, mixed models,
mixed skill hashes, or mixed evaluator identities cannot establish repetition provenance.

The sealed-regression thresholds remain visible: frontier/mid sealed-standard 95%, small sealed-standard 90%, and the
declared-novel bucket 85% per tier. A valid judge `FAIL` counts as a run failure within those thresholds; a missing or
invalid judge execution does not. The eight manifest-bound foundational/security/invariant cases require 100% across
every tier and repetition. `allRunsPassed`, `allJudgeExecutionsCompleted`, `allJudgeVerdictsPass`, and failure classes are
reported separately so an aggregate threshold cannot hide a hard-gate miss.

This corpus was visible earlier in its design cycle and is now sealed after design; encryption is not retroactive proof
of blind optimization isolation or independent novelty. Release remains `EXTERNAL_BLOCKED` until all of the following
exist outside this repository: an independently designed novel holdout, a comparable public fresh-repository population,
a cryptographically/provider-verified receipt path, an immutable previous-release baseline/comparator, and the trusted
sandbox described above. Local fake-adapter runs are regression tests only and never provider, blind, or release proof.

Release rehearsal can ingest an absolute external-evidence bundle together with an operator-selected policy digest.
That adjacent digest binds and verifies the bundle's signatures, but it is not an independent trust root. Such evidence
is reported as `VALID_UNTRUSTED_POLICY` with `policyTrust: CALLER_SUPPLIED_UNESTABLISHED` and
`independenceEstablished: false`; every named external release blocker remains `EXTERNAL_BLOCKED`. `VERIFIED` is
reserved for a future policy digest independently pinned by a separately reviewed source change. No such policy is
pinned today, and external evidence never makes the local receipt a release candidate.

Missing adapters, key, model IDs, judge, sandbox, loopback fork proxy, or stage tools is also `EXTERNAL_BLOCKED`.
`--require-provider` maps that state to exit code 3; a measured sealed-corpus failure exits 1 and a harness/contract error
exits 2. Output is preflighted before provider calls, reserved exclusively, written atomically to a new absolute path
outside repository/input trees, and rejects symlink ancestors. Repetitions are capped at 10 and planned runs at 720.
