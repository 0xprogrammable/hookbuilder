# Hidden workflow-canary application

This path exists only to exercise the protected Submit Launch workflow without public discovery, production routing,
an audit claim, or real user funds. It is separate from the historical six-file `prepare-pr` package and from normal
Applicant review.

## Fixed inputs

`prepare-canary` derives authority instead of accepting it from the caller:

- the selected source is the current exact Git worktree root;
- the worktree must be clean, on a named branch, and `HEAD` must equal its configured local upstream-tracking ref;
- the configured upstream branch is then read freshly from GitHub and must name that exact `HEAD` commit and root tree;
- the upstream must be a public GitHub repository whose numeric id, ref name, commit, and root tree resolve exactly;
- the builder is the currently authenticated `gh api user` actor, resolved by login and numeric GitHub user id;
- source ownership is independent, so the public upstream repository may belong to that actor or an organization;
- the target is always `0xprogrammable/submit-launch` repository id `1320171831`, branch `main`;
- the policy, policy schema, and `canary/schemas/workflow-canary-application-v1.schema.json` are read from one exact
  protected commit and tree; and
- V1 is a new `canary-submissions/<application-id>/application.json` at revision `1`. An existing target fails closed.

There is no builder JSON, source JSON, repository override, branch override, revision override, declarations override,
or replacement mode.

## Exact preview; automated writing fails closed

The default command is read-only. The output parent must already exist, the new application directory must be outside
the source repository, and its final name must exactly equal the application id.

```bash
node "$SKILL_ROOT/scripts/cli.mjs" prepare-canary "$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --title "$TITLE" \
  --summary "$SUMMARY" \
  --output-dir "/absolute/outside-source/canary-submissions/$APPLICATION_ID"
```

The preview returns `planDigest` and the exact newline-terminated `canonicalApplicationJson`. The guarded write
boundary still requires both exact arguments on a fresh run:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" prepare-canary "$APPLICATION_ID" \
  --repository-root "$REPOSITORY_ROOT" \
  --title "$TITLE" \
  --summary "$SUMMARY" \
  --output-dir "/absolute/outside-source/canary-submissions/$APPLICATION_ID" \
  --write \
  --acknowledge-local-write "sha256:<exact-preview-plan-digest>"
```

The digest binds the exact builder and source identities, public repository id, configured ref, commit and tree,
protected central base, policy and schema bindings, canonical application bytes, output path, and current output-parent
identity. The guarded boundary freshly rereads that GitHub ref and rechecks the central base, source worktree, public
builder and source identities, and output target.

After those checks the current portable client returns `LOCAL_WRITE_UNAVAILABLE` without filesystem mutation. Pure
path-based publication cannot preserve the acknowledged parent inode across a concurrent rename, so the client will
not claim an atomic local write until a bundled, portable, independently reviewed descriptor-bound writer exists.
The exact preview bytes remain available for that future trusted materializer. The client does not commit, push, fork,
open a pull request, execute source, approve, audit, deploy, route, discover, sign, move funds, or authorize a launch.
