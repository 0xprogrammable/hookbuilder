# Community journey benchmark

`v1/corpus.json` is a frozen public regression and comparison corpus. It reproduces the reported Mizu
design-to-implementation failure, then covers 20 natural English/German positive and adjacent-negative prompts plus
malformed input, missing Foundry, denied deployment/GitHub authority, and untrusted repository instructions. It is
deliberately public and must never be described as a blind holdout.

The existing encrypted `evals/holdout/` population remains a separate evidence lane. This directory contains no
holdout plaintext, key, decrypted metadata, membership oracle, or derived case list. `v1/corpus.sha256` freezes the
public bytes independently.

## What the harness measures

Every subject runs the same case and repetition matrix. The scorecard records:

- exact skill `SKILL.md` and full-directory inventory hashes before and after the run;
- per-turn activation decisions, activation-evidence class, activated references and their verified installed bytes;
- response, result inventory and optional Git commit/tree hashes;
- input/output/total tokens when available, tool calls, tool errors, retries, elapsed time and time to useful output;
- reported local writes, network calls, external writes and authority requests;
- an independent judge verdict with four bounded human-readable score dimensions;
- candidate or competitor deltas against the frozen baseline for correctness and efficiency metrics.

The subject sees only the public messages, run identity, frozen skill identity and an empty workspace. It does
not receive the expected activation decision, outcome, behaviors or rubric. The judge receives those fields only after
the subject has finished.

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
ABSOLUTE_NEW_JSON` arguments. Provider authentication belongs to the trusted external adapter; only explicitly named
environment variables in `environmentAllowlist` are forwarded.

```json
{
  "schemaVersion": "1.0.0",
  "evidenceMode": "PROVIDER_BACKED_UNVERIFIED",
  "concurrency": 3,
  "repetitions": 3,
  "timeoutMs": 900000,
  "environmentAllowlist": ["CODEX_HOME"],
  "subjects": [
    {
      "id": "v0-9-1-baseline",
      "role": "baseline",
      "skillPath": "/absolute/frozen/v0.9.1/skill",
      "adapterArgv": ["/absolute/trusted/subject-adapter", "--host", "codex"],
      "host": { "name": "codex", "version": "exact-host-version", "provider": "exact-provider", "model": "subject-model-a" }
    },
    {
      "id": "v0-10-candidate",
      "role": "candidate",
      "skillPath": "/absolute/frozen/v0.10.0/skill",
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
judge requests/results, generated workspaces and `scorecard.json`. The harness invokes adapters without a shell, caps
concurrency at four, limits captures and result inventories, rejects symlinked evidence, and verifies that every skill
inventory is unchanged after execution.

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
