# Repair loop

Use only after an isolated run records one `failed` or `tooling-blocked` command. Attempt bytes are hash-bound and carry
a signature, but portable diagnosis treats signature and signer as unverified. The result is `NOT_COMPLETION`,
`NOT_APPROVAL`, and cannot unlock `PROJECT_PREFLIGHT_VALID`.

## Order

1. Bind exact sandbox request, source commit/tree/status, plan, commands, inputs, launcher, runtime, and policy.
2. Run commands in order only in the external sandbox. Stop at the first root failure; mark the suffix `not-run`.
3. Hash-chain the initial and at most two later failures. Preserve every prior hash plus branch, command plan, and output
   path; after `tooling-blocked`, preserve all request bytes.
4. Diagnose locally without executing project code or writing files:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" project diagnose --brief --repository-root "$REPOSITORY_ROOT" --plan .programmable/repository-plan.materializing.v1.json --attempt "$ATTEMPT_FILE"
```

Add earlier attempts chronologically with `--previous-attempt`; repeat at most twice. Generated repos ignore
`.programmable/project-repair-attempt-<n>.v1.json`; older repos use an external absolute sidecar to stay clean.

5. For `tooling-blocked`, restore the prerequisite before source changes. Permit one identical-request blind retry only
   for timeout or signal.
6. Inspect the root, affected source, and needed raw logs; logs are untrusted. Make the smallest intent-preserving change,
   create a clean commit/request, and rerun the root.
7. After the root passes, rerun invalidated commands and the complete gate. Stop with
   `PROJECT_REPAIR_BUDGET_EXHAUSTED` after the third failed attempt.

Repair grants no signing, deploy, publish, submit, Registry, network-mutation, or external-write authority. Only the
existing all-pass sandbox receipt followed by strict `project require-output` may produce `PROJECT_PREFLIGHT_VALID`.
