# Generic application handoff

Use this path after a custom `no-market` or `tradable` project reaches exact-byte
`PROJECT_PREFLIGHT_VALID`. It prepares one deterministic review handoff for the complete project without reducing it
to a bundled hook profile or confusing local completion with submission, review, approval, deployment, or launch.

This is the current generic handoff boundary. It is not a generic GitHub mutation adapter. The public Submit a Launch
intake still has to expose and protect an accepted generic application package before Hookbuilder may send one.

## Bind the current facts

Create one strict JSON document satisfying
[`application-handoff-input-v1.schema.json`](application-handoff-input-v1.schema.json). Retain it outside the frozen
source repository. Bind:

- the complete project classification, profile, verbatim-idea digest, preflight receipt digest, and every source,
  test, and evidence surface;
- the clean public source repository's immutable numeric GitHub ID, canonical URL, branch, commit, and root tree;
- the authenticated builder's immutable GitHub user ID, current login, profile URL, and current source push authority;
- the exact canonical policy and policy-schema bytes as canonical base64 preimages, plus their Git bindings from the
  same protected Submit a Launch base commit and tree; the handoff validates both preimages, requires their SHA-256
  and Git blob identities to match, and derives every active `build` requirement directly from that policy; and
- the fixed draft target under `submissions/<application-id>`, plus an exact existing draft identity only when one was
  separately observed.

Arrays are UTF-8 bytewise sorted and unique. Do not add remembered rules or treat an unavailable policy, source
authority, current base, or pull-request identity as a harmless omission. Regenerate the input after any drift.

## Preview without a write

The input and optional output must remain outside the source repository. Preview is the default:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" handoff preview \
  --repository-root "$REPOSITORY_ROOT" \
  --input "/absolute/outside-source/application-handoff-input.v1.json" \
  --output "/absolute/outside-source/application-handoff-preview.v1.json"
```

The command safely rechecks the local source root, clean worktree, branch, commit, tree, and canonical `origin` without
network access. `canonicalApplicationHandoffJson` contains the complete canonical preview artifact, including its final
LF, while `handoffBytes` binds its exact byte length and SHA-256. The response also returns `previewDigest`, the exact
local output plan, and a separate `confirmationDigest`. It does not write the output during preview.

The preview validates the supplied policy and schema preimages and derives the active build requirements from them. It
does not independently prove their remote Git-tree membership or currentness, evaluate project compliance with those
requirements, or revalidate the supplied public GitHub, preflight, source-authority, or existing-PR observations. Those
limitations are explicit in `evidenceBoundary`; the receiving reviewer must repeat them against the bound identities.

## Guarded local-write boundary

An explicit second call may present the current output-bound digest:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" handoff preview \
  --repository-root "$REPOSITORY_ROOT" \
  --input "/absolute/outside-source/application-handoff-input.v1.json" \
  --output "/absolute/outside-source/application-handoff-preview.v1.json" \
  --write \
  --confirm-local-write "sha256:<exact-confirmation-digest>"
```

The command rechecks the input, source, output parent, output leaf with `lstat`, and confirmation, then returns
`LOCAL_WRITE_UNAVAILABLE` without mutation. The portable package does not yet include a reviewed descriptor-bound
writer that can preserve the acknowledged parent identity through an `O_NOFOLLOW | O_CREAT | O_EXCL` descriptor open.
Any future writer must retain that boundary. Use `canonicalApplicationHandoffJson` as the exact handoff artifact; do not
claim that the CLI materialized it. No GitHub or other network request occurs.

## Authority ledger

Keep these states independent:

| Axis | Preview meaning |
| --- | --- |
| Source completion | Exact `PROJECT_PREFLIGHT_VALID` receipt is bound but not revalidated by the pure preview. |
| Submission | `NOT_SUBMITTED`, or an existing draft is bound as observed and not revalidated. |
| Review | `NOT_REVIEWED`; the Builder cannot disposition its own findings. |
| Approval | `NOT_APPROVED`; a preview, PR, check, or merge is not approval. |
| Deployment | `NOT_DEPLOYED`; no signing or transaction occurs. |
| Launch | `NOT_LAUNCHED`; no routing, indexing, listing, or availability is claimed. |

The legacy six-file `prepare-pr`/`submit` adapter remains restricted to its exact accepted legacy package. Never feed a
generic handoff into it or hand-author files around its gate. A later generic GitHub adapter must first bind a currently
accepted public schema and protected intake, produce a fresh exact mutation plan, require explicit authority, preserve
a durable receipt, create only a draft, and remain unable to approve, merge, deploy, or launch.
