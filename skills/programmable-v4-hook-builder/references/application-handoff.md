# Generic application handoff

The official route for every generic `no-market` or `tradable` project that reaches exact-byte
`PROJECT_PREFLIGHT_VALID` is Application V3.1. Follow
[github-application-v3.md](github-application-v3.md): `open-world prepare-revision` then `open-world application` then
`open-world submit`. Unknown project kinds remain eligible; the package records their actual source and evidence rather
than reducing them to a bundled hook profile or allowlist.

Use `handoff preview` only when the accepted V3.1 package cannot yet be prepared and an exact diagnostic artifact is
useful. It is not a second submission format, must not be hand-copied into Submit a Launch, and never proves a Draft PR,
review, approval, deployment or launch.

## Official protected Draft PR path

Prepare the exact next revision, assemble its closed package, and ask for a read-only GitHub plan:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" open-world prepare-revision \
  "/absolute/outside-source/application-v3-draft.json" \
  --source-root "primary=$REPOSITORY_ROOT" \
  --output "/absolute/outside-source/prepared-revision" \
  --write

node "$SKILL_ROOT/scripts/cli.mjs" open-world application --help
node "$SKILL_ROOT/scripts/cli.mjs" open-world submit \
  "/absolute/outside-source/application-v3-package" --dry-run
```

The application command requires the prepared revision, validated V2 project package, review package, security inputs,
every exact source-root mapping, and a new output directory. Its `--help` is the command authority. Inspect the submit
plan and obtain explicit authority for its exact fresh digest. Only then repeat submit with
`--mutation-receipt <absolute-json> --confirm-external-write <sha256:...>`. The confirmed command may create or advance
the authenticated builder's fork branch and create one Draft PR against `0xprogrammable/submit-launch:main`. It cannot
mark the PR ready, approve, merge, deploy, sign or launch.

## Diagnostic fallback

### Bind the current facts

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

### Preview without a write

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

### Guarded local-write boundary

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
| Submission | A diagnostic preview is `NOT_SUBMITTED`; only the confirmed V3.1 transport plus remote readback proves a Draft PR. |
| Review | `NOT_REVIEWED`; the Builder cannot disposition its own findings. |
| Approval | `NOT_APPROVED`; a preview, PR, check, or merge is not approval. |
| Deployment | `NOT_DEPLOYED`; no signing or transaction occurs. |
| Launch | `NOT_LAUNCHED`; no routing, indexing, listing, or availability is claimed. |

The legacy six-file `prepare-pr`/`submit` adapter remains restricted to its exact accepted legacy package. Never feed a
generic handoff into it or hand-author files around either gate. Regenerate a valid V3.1 package and use the protected
generic transport. A Draft PR remains `NOT_REVIEWED`, `NOT_APPROVED`, `NOT_DEPLOYED` and `NOT_LAUNCHED` until separate
authorities establish those states.
