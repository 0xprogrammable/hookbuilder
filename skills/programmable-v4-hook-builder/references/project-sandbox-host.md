# Trusted sandbox host integration

This is an opt-in operator integration, not portable execution. The portable `project execute` command stays
fail-closed and the package contains no production trust root, runtime image, signing key, Docker daemon access, or
claim that a planned container actually ran.

## Contract

One completed host run has six independently inspectable subjects:

1. The existing sandbox request binds the clean Git commit/tree/status, materializing RepositoryPlan, commands, policy,
   and every input artifact.
2. A host profile pins the Docker CLI digest, shell-free launcher entrypoint, digest-addressed runtime image, non-root
   UID/GID, mount layout, no-network/no-secret policy, PID/resource limits, and output boundary.
3. `plan-docker` emits exact Docker argv and digests. It uses `--pull never`, `--network none`, `--read-only`,
   `--cap-drop ALL`, `no-new-privileges`, `--init`, a PID limit, fixed explicit environment keys, read-only source and
   request mounts, an explicit shell-free launcher entrypoint, an output mount with a launcher-enforced byte limit, and
   disposable tmpfs workspace/temp mounts.
4. The independently operated launcher records command/output and filesystem-write hashes in the existing sandbox
   receipt. A plan is not this observation.
5. The host attestation additionally binds the exact invocation, receipt, mount/environment digests, network/secret/
   external-write observations, output inventory, container exit, post-removal absence, and zero remaining descendants.
6. Verification accepts both signatures only when an independently supplied Ed25519 trust root pins the exact subject,
   key, host-profile digest, launcher, runtime-image digest, and `container-separate-user` scope. It rereads every signed
   output artifact from the isolated output directory and rejects every unreceipted file, directory, symlink, or special
   filesystem entry.

These receipts prove only the execution boundary described by their exact bytes. They never create Programmable
approval, an audit, deployment, publication, production status, or Registry authority.

## Operator flow

Create the sandbox request while the project worktree is clean, then place its canonical JSON sidecar, the canonical
materializing plan, and a canonical host profile outside that worktree. Export only the exact committed Git tree; the
candidate container never sees ignored worktree files, host credentials, or `.git` state:

```bash
node "$SKILL_ROOT/scripts/project-sandbox-host.mjs" source-archive \
  --request "$SANDBOX_REQUEST" \
  --repository-root "$PROJECT_ROOT" \
  --output "$NEW_SOURCE_ARCHIVE"
```

Keep the output directory separate and empty. Generate the exact invocation:

```bash
node "$SKILL_ROOT/scripts/project-sandbox-host.mjs" plan-docker \
  --profile "$HOST_PROFILE" \
  --request "$SANDBOX_REQUEST" \
  --repository-root "$PROJECT_ROOT" \
  --source-archive "$NEW_SOURCE_ARCHIVE" \
  --output-root "$EMPTY_OUTPUT_ROOT" \
  --plan "$MATERIALIZING_PLAN" \
  --docker "$PINNED_DOCKER_BINARY"
```

The command above does not execute Docker. Store its canonical stdout as the invocation sidecar. A separately managed
host launcher must execute those exact argv, refuse an absent local image instead of pulling, enforce the profile,
clear the candidate-command environment to the profile allowlist, safely extract the source archive without following
links, enforce the output byte limit during execution, collect the output, prove teardown, and sign both the existing
receipt and host attestation. Never mount its signing key or a Docker socket into the candidate container.

Verify after the runner has finished:

```bash
node "$SKILL_ROOT/scripts/project-sandbox-host.mjs" verify \
  --profile "$HOST_PROFILE" \
  --request "$SANDBOX_REQUEST" \
  --receipt "$SANDBOX_RECEIPT" \
  --attestation "$HOST_ATTESTATION" \
  --trust-root "$INDEPENDENT_TRUST_ROOT" \
  --invocation "$DOCKER_INVOCATION" \
  --output-root "$OUTPUT_ROOT" \
  --subject "$EXPECTED_AUTHORITY_SUBJECT"
```

`PROJECT_SANDBOX_HOST_COMPLETION_VERIFIED` means the verifier authenticated this exact run and reread its outputs. It
does not by itself rewrite the project RepositoryPlan or unlock `PROJECT_PREFLIGHT_VALID`; that importer remains an
external integration until the production launcher/output format is deployed and independently forward-tested.

## Supported and unsupported isolation

The bundled local adapter supports only network-forbidden Docker commands. Any RepositoryPlan command requesting
read-only network access is rejected before argv generation. A future networked runner must enforce an exact destination
allowlist outside the candidate process and receipt both the allowlist and observations; a policy string or application
proxy claim is insufficient.

The profile name `container-separate-user` is accepted only with a non-root UID/GID and the exact Docker restrictions
above. `plan-docker` reports `isolationObserved: false`. Only an attestation from a separately trusted host can report the
container run and teardown; local tests exercise contract verification with fixtures, not real OS isolation.

The portable contract schemas are:

- `project-sandbox-host-profile-v1.schema.json`
- `project-sandbox-host-attestation-v1.schema.json`
- `project-sandbox-trust-root-v1.schema.json`
