# Sandbox host planning boundary

This release provides deterministic planning and structural evidence inspection only. It does not run Docker, establish
a trusted host, verify output bytes, prove isolation or teardown, import completion, or unlock `PROJECT_PREFLIGHT_VALID`.
Both `plan-docker` and `inspect-evidence` end at `EXTERNAL_BLOCKED`.

## What the portable tools do

The existing sandbox request binds the clean Git commit/tree/status, materializing RepositoryPlan, command inventory,
policy, and input artifacts. `source-archive` exports only that committed Git tree, so ignored worktree files and `.git`
are not included. `plan-docker` then checks the canonical request and plan sidecars, exact archive bytes, selected Docker
CLI digest, digest-addressed image reference, non-root requested UID/GID, fixed mount layout, and exact planned argv.

The argv describes a networkless, read-only-root container with dropped capabilities, `no-new-privileges`, init, PID,
memory, CPU, tmpfs, and explicit launcher options. This is a desired invocation, not proof that the Docker client,
daemon, image, mounts, namespace, seccomp policy, environment, resource limits, or process lifecycle actually matched it.
The plan therefore reports:

- `status: EXTERNAL_BLOCKED`
- `coverage: STRUCTURE_AND_COVERAGE_ONLY`
- `candidateCodeExecuted: false`
- `isolationObserved: false`

`inspect-evidence` checks closed JSON structure, canonical hashes, request/profile/invocation/receipt/attestation bindings,
and both Ed25519 signatures against a caller-supplied key set. A caller-supplied key set is not a trust root. Even a
fully self-issued, internally consistent signature set returns `EXTERNAL_BLOCKED`, `NOT_COMPLETION`,
`executionCompleted: false`, `hostExecutionProven: false`, `isolationProven: false`, and
`outputBytesVerified: false`. The portable package contains no signing helper and no production key.

## External requirements

No host result can become completion until a separately implemented and independently reviewed owner-controlled path
provides every requirement emitted in `externalRequirements`:

1. A trust-root identity pinned by repository owners, outside caller input, and the existing non-injectable completion
   authority path.
2. Actual host-run provenance cross-binding the Docker client and daemon identities, OS and platform, resolved local
   image identity, launcher bytes, seccomp profile, user-namespace mode, and candidate environment.
3. A native-Linux preflight proving that the selected UID/GID can read every input mount and create files in the output
   mount without widening permissions or exposing unrelated host paths. The generated `0600` source archive and an
   unrelated container UID are explicitly not assumed compatible.
4. Host-enforced wall-clock deadline, graceful-stop interval, unconditional kill and reap, plus kernel-enforced CPU,
   PID, memory, and zero/unambiguous swap bounds.
5. Kernel- or filesystem-enforced output byte and inode quotas, bounded entry count and depth, and bounded stdout/stderr
   logs. Passing numeric limits to an in-container process is not enforcement.
6. Descriptor-relative, no-follow output collection after teardown, rejecting symlinks, hard-link aliasing, special
   files, mount crossings, races, missing or extra paths, and every byte or inventory mismatch.
7. Exact observation records—not opaque signer booleans—for filesystem writes, network attempts, secret exposure,
   command outputs, container identity, exit, removal, and remaining descendants, all cross-bound to receipt fields.
8. An owner-controlled completion importer that consumes the authenticated host provenance through the existing
   completion authority path. Portable/local inspection must never perform that import.

Until all eight exist, the only honest outcome is `EXTERNAL_BLOCKED`.

## Commands

Create an exact committed-source archive outside the candidate repository:

```bash
node "$SKILL_ROOT/scripts/project-sandbox-host.mjs" source-archive \
  --request "$SANDBOX_REQUEST" \
  --repository-root "$PROJECT_ROOT" \
  --output "$NEW_SOURCE_ARCHIVE"
```

Create the deterministic, non-executing Docker plan:

```bash
node "$SKILL_ROOT/scripts/project-sandbox-host.mjs" plan-docker \
  --profile "$HOST_PROFILE" \
  --request "$SANDBOX_REQUEST" \
  --repository-root "$PROJECT_ROOT" \
  --source-archive "$NEW_SOURCE_ARCHIVE" \
  --output-root "$EMPTY_OUTPUT_ROOT" \
  --plan "$MATERIALIZING_PLAN" \
  --docker "$SELECTED_DOCKER_BINARY"
```

Inspect an externally produced evidence envelope without granting it authority:

```bash
node "$SKILL_ROOT/scripts/project-sandbox-host.mjs" inspect-evidence \
  --profile "$HOST_PROFILE" \
  --request "$SANDBOX_REQUEST" \
  --receipt "$SANDBOX_RECEIPT" \
  --attestation "$HOST_ATTESTATION" \
  --key-set "$CALLER_SUPPLIED_KEY_SET" \
  --invocation "$DOCKER_INVOCATION" \
  --subject "$CLAIMED_SUBJECT"
```

The portable contract schemas are `project-sandbox-host-profile-v1.schema.json`,
`project-sandbox-host-attestation-v1.schema.json`, and `project-sandbox-trust-root-v1.schema.json`. The final name is a
wire-format legacy: portable tooling treats every supplied instance as an untrusted signature key set.
