# Application handoff

## Current Applicant handoff

Every completed project with exact public source uses one normal entry:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

Hookbuilder is optional. A project built elsewhere uses the same Submit Launch contract once its public source and
application inputs are complete. Unknown project kinds remain eligible; record their actual source and evidence instead
of reducing them to a template or allowlist.

The command:

1. binds the clean public source commit and tree;
2. resolves one manifest-bound Current Contract Snapshot;
3. selects the Application V3.2, Submission 2.1 and Trade Capability Manifest V2 adapters from one integrity-checked
   Applicant Compatibility V2 snapshot;
4. applies only the `submit` Stage Plan for the verified route;
5. validates or resumes one closed application package; and
6. returns one read-only Draft plan or one exact repair.

Run only the safe next command it returns. Internal preparation, receipt, branch and reconciliation mechanics are not a
second Applicant journey.

Application V3.1 remains accepted only as a byte-identical offline legacy input. Continue it through a linked V3.2
schema-migration revision with the identical source binding and no unrelated product, intent or normative change. Put
later changes in a separate linked V3.2 revision. A V3.1 package cannot establish current official route or launch
readiness. Read
[Application compatibility and migration](application-compatibility-and-migration.md) for that boundary.

## Confirmation and authority

The first result performs no GitHub write. It identifies the exact target, source, package, protected base, proposed
change and one fresh confirmation digest. A changed source, contract snapshot, package or base invalidates that plan.

Only the exact confirmed next command may create or update one Draft pull request against
`0xprogrammable/submit-launch:main`. It may not mark the Draft ready, approve, merge, deploy, sign, route, promote,
launch, change an account or move funds.

Remote readback proves only that the exact Draft revision reached GitHub and its protected checks were observed. It is
not independent review, approval, Registry acceptance, deployment, indexing or availability.

A local resolver or adapter result is not end-to-end submission proof. Only the released combined path plus exact
remote Draft readback can establish that boundary.

## Historical diagnostic handoff

`handoff preview` is retained for exact diagnosis of older flows when a current package cannot yet be assembled. It is
not a submission format, a substitute for `submit-project` or a file to copy into Submit Launch. Its older input
contract binds a `PROJECT_PREFLIGHT_VALID` receipt; that requirement belongs only to this historical diagnostic and is
not admission criteria for a current unreviewed Draft.

### Bind the historical facts

Create one strict JSON document satisfying
[`application-handoff-input-v1.schema.json`](application-handoff-input-v1.schema.json) outside the frozen source
repository. Bind:

- the historical classification, profile, verbatim-idea digest, preflight receipt digest and every source, test and
  evidence surface;
- the clean public source repository's immutable GitHub ID, canonical URL, branch, commit and root tree;
- the authenticated builder's immutable GitHub user ID, current login, profile URL and observed push authority;
- the supplied policy and schema bytes, their digests and Git bindings from one protected Submit Launch base; and
- the fixed historical Draft target plus an existing Draft identity only when separately observed.

Arrays are UTF-8 bytewise sorted and unique. Do not add remembered rules or treat unavailable policy, source authority,
base or pull-request identity as a harmless omission. Regenerate the input after any drift.

### Preview without a write

```bash
node "$SKILL_ROOT/scripts/cli.mjs" handoff preview \
  --repository-root "$REPOSITORY_ROOT" \
  --input "/absolute/outside-source/application-handoff-input.v1.json" \
  --output "/absolute/outside-source/application-handoff-preview.v1.json"
```

The command rechecks the local source root, clean worktree, branch, commit, tree and canonical `origin` without network
access. It returns canonical preview bytes, their length and SHA-256, the local output plan and a separate confirmation
digest. Preview does not write the output.

The diagnostic validates its supplied policy and schema preimages and derives their historical build requirements. It
does not prove remote Git membership or currentness, evaluate project compliance, or revalidate supplied GitHub,
preflight, source-authority or existing-PR observations. Its `evidenceBoundary` keeps those limits explicit so a
reviewer can repeat them against the bound identities.

### Guarded local-write boundary

The legacy interface accepts an explicit second call with `--write` and the current output-bound confirmation digest,
but the portable package returns `LOCAL_WRITE_UNAVAILABLE` without mutation. It has no reviewed descriptor-bound writer
that can preserve the acknowledged parent identity through an exclusive no-follow create. Use the returned canonical
bytes as diagnostic evidence; do not claim that the CLI materialized them. No network request occurs.

## Evidence ledger

| Axis | Current handoff | Historical diagnostic |
| --- | --- | --- |
| Source | Exact public source and available evidence are bound. Applicant checks remain unverified until independent review. | The supplied preflight receipt is bound but not revalidated. |
| Submission | Exact confirmed `submit-project` transport plus remote readback proves one Draft revision. | `NOT_SUBMITTED`; preview performs no transport. |
| Review | `NOT_REVIEWED` until an independent decision binds the exact revision. | `NOT_REVIEWED`. |
| Approval | `NOT_APPROVED`; a Draft, check, comment or merge is not approval. | `NOT_APPROVED`. |
| Deployment | `NOT_DEPLOYED`; no signing or transaction occurs. | `NOT_DEPLOYED`. |
| Launch | `NOT_LAUNCHED`; routing, indexing, promotion and availability require separate evidence. | `NOT_LAUNCHED`. |

The six-file `prepare-pr`/`submit` adapter remains restricted to exact historical packages. Never feed a current generic
handoff into it or hand-author files around either gate.
