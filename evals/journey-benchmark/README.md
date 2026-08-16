# Community journey benchmark

`v1/corpus.json` is the immutable public base corpus. The immutable `v2/corpus.json` overlay binds that exact v1 digest
and adds the case-specific Forge-denial execution policy without editing v1. The active `v3/corpus.json` overlay binds
both predecessors and records the Mizu journey's exact per-turn activation boundary: design-only stays inactive, then
the explicit implementation continuation activates. Together they reproduce the reported Mizu
design-to-implementation failure, then cover 20 natural English/German positive and adjacent-negative prompts plus
malformed input, missing Foundry, denied deployment/GitHub authority, and untrusted repository instructions. It is
deliberately public and must never be described as a blind holdout.

The existing encrypted `evals/holdout/` population remains a separate evidence lane. This directory contains no
holdout plaintext, key, decrypted metadata, membership oracle, or derived case list. Each adjacent `corpus.sha256` is a
co-versioned tamper-detection checksum, not an independent freeze. The independent in-repository version authority is
`config/journey-benchmark-corpus-versions.json`, backed by a hard-coded loader/test pin. The pinned v1 bytes are
immutable: changing v1, v2 or v3 requires a new overlay version instead of regenerating an adjacent checksum.

## What the harness measures

Every subject runs the same case and repetition matrix. The scorecard records:

- exact skill `SKILL.md` and full-directory inventory hashes before and after the run;
- separately invoked per-turn activation decisions, activation-evidence class, activated references and their verified
  installed bytes;
- intermediate response and full workspace-tree hashes carried into the next turn;
- response, result inventory including permission modes and empty directories, and optional Git commit/tree hashes;
- input/output/total tokens when available, tool calls, tool errors, retries, elapsed time and time to useful output;
- reported local writes, network calls, external writes and authority requests;
- the sum of material owner decisions across every turn, so a multi-turn run cannot reset its budget;
- an independent judge verdict with four bounded human-readable score dimensions;
- candidate or competitor deltas against the frozen baseline for correctness and efficiency metrics.

The subject sees only the current public user turn, prior response/state receipts, run identity, frozen skill identity,
and a case-specific deterministic workspace. Existing-repository repair, upgrade, review and submission cases receive
the pinned non-empty v1 fixture; all other cases start empty. The subject does not receive the expected activation
decision, outcome, behaviors or rubric. The judge receives those fields only after the final subject turn and cannot
change a subject request/result's content or permission mode, or the workspace's files, modes or directory topology,
without failing the run.

Adapter reports are not a trusted host trace. Even a successful provider-backed scorecard remains
`PROVIDER_BACKED_ADAPTER_REPORTED_UNVERIFIED` until an external trust root authenticates model identity, activation,
tool telemetry, isolation and effects. Fake-adapter runs are always `LOCAL_FAKE_ADAPTER_REGRESSION_ONLY`. Neither mode
satisfies the release gate by itself.

## Keyless validation

```bash
node scripts/evals/run-journey-benchmark.mjs --validate-only
```

Calling the runner without an explicitly authorized adapter matrix produces
`JOURNEY_BENCHMARK_EXTERNAL_BLOCKED`. Add `--require-provider` in release automation to map that state to exit code 3.

## Provider-backed comparison

Create a private configuration file outside the repository. Do not put credentials or secret values in it. Every
adapter executable must be an absolute path and accept harness-appended `--request ABSOLUTE_JSON --output
ABSOLUTE_NEW_JSON` arguments. Names in `environmentAllowlist` are treated as provider secrets: their values are passed
only in the trusted wrapper process environment and never serialized into request, result or scorecard JSON. Persisted
requests contain bounded names, a name-list digest and `OUT_OF_BAND_REDACTED`; a detected value in a result-bundle
path, regular file or symlink target fails closed and removes that newly created bundle.

```json
{
  "schemaVersion": "1.0.0",
  "evidenceMode": "PROVIDER_BACKED_UNVERIFIED",
  "concurrency": 3,
  "repetitions": 3,
  "timeoutMs": 900000,
  "environmentAllowlist": ["CODEX_HOME"],
  "sandbox": {
    "wrapperArgv": ["/absolute/external/sandbox-wrapper"],
    "contractPath": "/absolute/external/sandbox-contract.json",
    "deniedSentinelPath": "/absolute/external/denied-sentinel"
  },
  "subjects": [
    {
      "id": "v0-10-1-baseline",
      "role": "baseline",
      "skillPath": "/absolute/frozen/v0.10.1/skill",
      "adapterArgv": ["/absolute/trusted/subject-adapter", "--host", "codex"],
      "host": { "name": "codex", "version": "exact-host-version", "provider": "exact-provider", "model": "subject-model-a" }
    },
    {
      "id": "v0-10-2-candidate",
      "role": "candidate",
      "skillPath": "/absolute/frozen/v0.10.2/skill",
      "adapterArgv": ["/absolute/trusted/subject-adapter", "--host", "codex"],
      "host": { "name": "codex", "version": "exact-host-version", "provider": "exact-provider", "model": "subject-model-a" }
    },
    {
      "id": "comparison-skill",
      "role": "competitor",
      "skillPath": "/absolute/frozen/comparison/skill",
      "adapterArgv": ["/absolute/trusted/subject-adapter", "--host", "claude-code"],
      "host": { "name": "claude-code", "version": "exact-host-version", "provider": "exact-provider", "model": "subject-model-b" }
    }
  ],
  "judge": {
    "adapterArgv": ["/absolute/trusted/judge-adapter"],
    "host": { "name": "independent-judge", "version": "exact-host-version", "provider": "different-provider", "model": "judge-model-c" }
  }
}
```

Run the complete matrix only after reviewing the adapters, provider cost and output location:

```bash
node scripts/evals/run-journey-benchmark.mjs \
  --config /absolute/private/benchmark-config.json \
  --output /absolute/new/benchmark-result-bundle \
  --allow-adapters \
  --require-provider
```

The output directory must not exist and must resolve outside the repository. It contains raw subject requests/results,
judge requests/results, generated workspaces and `scorecard.json`. Provider mode refuses to execute until the existing
external subject-sandbox contract validates the wrapper, denied repository/sentinel paths, separate UID/container/VM
boundary, path restrictions, role-scoped network policy and descendant teardown. Each runtime receipt must bind those
claims to its exact invocation. Adapters receive fixed runtime-owned PATH/locale/timezone fields and never inherit the
caller's HOME, PATH or TMPDIR; those runtime names cannot be repurposed as provider-secret names.

Fake mode invokes only the deterministic fixture adapters directly, without a shell, but it runs under the caller's UID
and provides no filesystem, network or process isolation. The harness pins the exact canonical fixture path and bytes,
the current Node interpreter path and bytes, and rejects every alternate executable or option before creating output.
It is therefore only a local harness regression. The external
wrapper and its runtime receipts are operator-authored rather than cryptographically verified, so even provider mode
remains `PROVIDER_BACKED_ADAPTER_REPORTED_UNVERIFIED` and cannot satisfy the release gate. Both modes cap concurrency at
four, limit captures and result inventories, reject symlinked evidence, and verify that every skill inventory remains
unchanged. The parent harness never runs Git commands against a subject-created repository; it inventories `.git` bytes
and reads only a bounded regular `HEAD`/loose-ref value passively, leaving tree and dirty-state fields unmeasured.

The `missing-foundry-tool` case is not inferred from the fixed PATH. In provider mode its v2 case policy sends an exact
`deny-exec` policy for `forge` to the external sandbox, and every subject-turn runtime receipt must bind the policy hash
and `toolPolicyEnforced: true`. Fake mode records `SIMULATED_NOT_ENFORCED`; that run can test harness behavior but is not
evidence that Forge was unavailable to a real model.

## Adapter result contracts

Subject output uses schema `1.0.0` with these closed top-level fields:

```text
schemaVersion, requestSha256, caseId, subjectId, provider,
activation, result, telemetry, effects
```

Activation receipts bind every loaded reference to the selected skill inventory. Unavailable telemetry must be `null`,
never zero. The subject result reports external effects; it does not prove their absence.

Judge output uses schema `1.0.0` with these closed top-level fields:

```text
schemaVersion, requestSha256, caseId, subjectId, provider,
verdict, scores, findings
```

The configured judge model ID must differ from every subject model ID. That check prevents an obvious self-judge but is
still operator-configured, not cryptographic identity proof.
