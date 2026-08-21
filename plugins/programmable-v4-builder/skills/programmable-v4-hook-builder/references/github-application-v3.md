# GitHub Application contract

> The current protected Draft contract is Application V3.2 with Submission 2.1. Application V3.1 is an immutable legacy
> compatibility input, not the normal path and not proof of current official-route readiness.

Use this contract for every completed Programmable project with exact public source, including hooks, applications,
services, games, multi-repository systems and unfamiliar custom architectures. Unknown project kinds remain eligible;
they are not rejected or forced into a template because they are novel. Hookbuilder is optional.

The normal entry is one command:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

It resolves one integrity-checked Compatibility V2 snapshot, selects its declared Application V3.2, Submission 2.1 and
Trade Capability Manifest V2 adapters, and applies the `submit` Stage Plan. Run only the safe next command it returns.
Do not require `PROJECT_PREFLIGHT_VALID` or a trusted external sandbox to create an unreviewed Applicant Draft. Both are
optional stronger evidence. Local or applicant-supplied test evidence remains unverified until independent review.

V3.1 packages remain valid only where the current compatibility contract declares them as offline legacy. Preserve
their bytes and reports. Continue one as a new, linked V3.2 schema-migration revision with the identical source binding
and no unrelated product, intent or normative change. Put later changes in a separate linked V3.2 revision. Never treat
the old package as current launch readiness.

Fee V2 fields below are exact compatibility only. They apply only when preserved project intent and the current Stage
Plan select that package. The Submission contract cannot create a platform requirement by itself.

The protected Submit a Launch workflow validates the resolved current schema and exact revision package with trusted
base code. Local generation or validation is not submission; only remote readback of the exact Draft PR and its checks
proves transport. Website eligibility remains a separate later authority, and the Builder never derives it locally.

Application V3 is GitHub-only. Every source surface must be an exact public GitHub repository. Another Git host, private
repository, ZIP, pasted source, upload form or email needs a different versioned contract and threat model. Keep the
idea eligible, mark only this integration `INTEGRATION_PENDING`, and create no public Application V3 package for it.

## Contents

1. [Application contract](#application-contract)
2. [Source closure](#source-closure)
3. [Revision and lineage preparation](#revision-and-lineage-preparation)
4. [Application-package preparation](#application-package-preparation)
5. [External-write boundary](#external-write-boundary)
6. [Review and status](#review-and-status)
7. [Historical applications](#historical-applications)

## Application contract

Never choose an Application schema from installed prose. `submit-project` resolves the protected Applicant
Compatibility V2 contract and selects the current V3.2 adapter. Generate `application.v3.json` only through that bound
adapter. Bind:

- application id, revision and explicit lineage;
- builder identity and public-data acknowledgements;
- the exact idea-source repository/path/digest as the sole normative intent source;
- intent and fidelity state without inherited approval;
- the declared Submission 2.1 package by repository, path and digest;
- the bound Trade Capability Manifest V2, requested route and applicable evidence without inventing a market;
- optional Fee V2 schema/applicability/instance only when that exact legacy package was explicitly selected;
- security schema plus source-assessed security and verification records derived after source freeze;
- exact review-package records and evidence; and
- every primary/companion repository by local id, GitHub numeric id, URI, commit and tree.

Preserve every embedded Submission `chainId` as a canonical positive `uint256` decimal string. Application, Registry acceptance
and Launch Bundle V2 must never narrow it to a JSON number or JavaScript safe integer.

Encode `applicationRevision` itself as a canonical positive decimal string (`"1"`, not a JSON number) across Application
V3, Registry Acceptance V3 and Launch V2. Do not impose the historical V1 integer shape, a `1,000,000` ceiling or a
JavaScript safe-integer ceiling. A new application starts at `"1"`; every later revision must be exactly the prior
content-bound decimal revision plus one using arbitrary-precision semantics. Frozen V1 application revisions remain
integers.

For a V3 predecessor, derive `lineage.previous` with
`derivePublicPrApplicationV3PreviousBinding`; do not hand-author its fields. The helper binds only facts provable from
the immutable predecessor root and package bytes: application identity/revision/digests, primary source repository
id/commit/tree, declared Submission schema/standard/path/digest, Fee V2 id/version, and the predecessor's exact
`feeApplicability` plus nullable `feePolicyInstanceSha256`. The current Registry base belongs to the transport plan and pull request, so it is not a
historical predecessor field. Never relabel the Keccak-based `programmableFeePolicyHash` as SHA-256; it remains an
exact global-policy field in the predecessor Application root.

Allow only a non-normative public-safe idea excerpt. Keep it null for redacted or unavailable intent. Never copy a
second normative summary that can replace provenance.

Keep a submitted application `unreviewed`. Require no acceptance binding and grant no approval. A later trusted review
decision is a separate authority record for one exact revision.

A policy-neutral `proposal` may be materialized for this unreviewed Applicant route only when `feeApplicability` is
`not-selected`, every legacy Fee V2 field is null, and no Fee V2 record exists. Preserve unresolved trade capability and
omit trade manifests and trade-test results. If exact trade evidence exists, advance honestly to `prototype` instead of
attaching it to a proposal. Source verification still does not prove trade capability, audit, deployment, approval, or launch.

Only after the legacy Fee V2 package is explicitly selected, derive its compatibility field from the exact bound
declared Submission graph:

- `proposal` requires `unresolved` and null fee-instance path, repository and digest;
- a prototype with at least one `programmable-canonical` scope requires `applicable` plus a real instance path,
  repository and digest; and
- an exact zero-scope prototype requires `not-applicable` and keeps all three instance fields null.

Inside that selected package, do not use N/A to hide a declared Fee V2 execution path. Outside it, do not fabricate
`feeApplicability`, a market, or a fee artifact for any project.

Let a source-owned proposal keep its security assessment null or explicitly pending/unassessed. Do not place a
source-assessed security instance or source-verification report in the source commit whose id it contains. After
freezing source, derive the assessed instance and one verification report per repository into the central application
package. Bind them as `source: application-package`, `repositoryRef: null`, while their content binds the
already-existing source commit, tree and manifest.

## Source closure

Use one closure mode per repository:

- `inline`: bind one to 4,096 unique repository-relative paths and no source manifest.
- `manifest`: bind no inline paths; bind one versioned root manifest by path, SHA-256, byte length, Git blob, entry count
  and fragment count.

Treat inline as a small-package fast path, not a product tier. Crossing 4,096 paths selects manifest transport and
never makes a large game, service or unfamiliar architecture unsafe or ineligible.

In manifest mode, let the outer application repository record bind repository id/URI plus exact commit/tree. Read the
root manifest as an exact blob inside that pinned tree. The root repeats repository id/URI and binds ordered fragments;
it deliberately does not embed its own containing commit/tree because that would require a cryptographic fixed point.

Verify every fragment and canonical JSONL entry against raw Git objects. Check global UTF-8 bytewise path order,
uniqueness, ranges, counts, modes, roles, blob ids, byte lengths, per-object hashes and the closure digest. Do not follow
symlinks or execute candidate code, hooks, filters, submodules or build scripts. Return a precise split-review hold when
a bounded verifier budget is exceeded; preserve idea eligibility.

Coverage is per repository. A path in one companion can never satisfy a fee, submission, evidence or review binding in
another repository.

`source-closure-manifest-v1` binds 40-hex SHA-1 Git object ids, separately records SHA-256 byte digests, and requires
UTF-8 committed paths. A Git SHA-256 object database or non-UTF-8 path exits without a write as `INTEGRATION_PENDING`,
`ideaEligibility: ELIGIBLE_FOR_REVIEW`, classification `tooling-transport`. A UTF-8 path above the current 16 KiB byte
budget returns `HOLD_SPLIT_REVIEW` and `tooling-split-review`. Add other object formats or path encodings through a new
versioned closure contract, generator and verifier; never silently widen V1 or call the product unsafe.

The optional top-level `publicDisclosureAttestations[]` can move only an exact intentionally public
`public-financial-identifier` candidate from privacy block to human review. Bind each candidate's RFC 6901 string pointer, SHA-256 of
the matched substring, application id, owner-stated purpose and exactly one `public-disclosure-authorization` review
record. It proves neither ownership nor approval. Wrong, unused or blanket attestations fail closed; credentials, keys,
seed phrases, passwords and API/auth tokens are never attestable.

All raw JSON reaches the strict bounded parser before semantic, privacy or integrity interpretation. Duplicate decoded
keys are invalid even when their values match and even when one spelling uses a Unicode escape. This prevents a secret,
authority or digest from being hidden behind a later visible value. Resource ceilings route to a typed split-review hold
where the contract permits it; they never become an unsupported-product or unsafe-category verdict.

## Revision and lineage preparation

`submit-project` is the normal entry. Use a namespaced preparation command only when its safe next action requests a
package repair; its current `--help` owns the flags. Never reconstruct the older three-command choreography from this
reference.

Keep `applicationRevision` and `lineage` absent from the canonical revision draft. The bound adapter derives both from
the highest exact eligible Registry or open-Draft predecessor; never copy, increment or repair them by hand. A new
project produces V3.2. A V3.1 predecessor produces an append-only schema-migration revision with the identical source,
product intent and normative bindings. A product or intent change belongs in a later linked V3.2 revision. A V3.2
predecessor produces an ordinary linked revision.

Preparation is read-only by default. Any explicit local output must be a new root outside the Builder, source,
linked-worktree Git, shared Git and object-store directories and must use atomic replacement. It performs no candidate
execution, GitHub mutation, approval, submission or launch action.

Recompute after every source, closure, evidence or current-contract change. Missing historical objects are
`INTEGRATION_PENDING`; supplied corrupt, mismatched or incomplete objects are invalid. Preserve every predecessor byte
and conclusion.

## Application-package preparation

The current adapter assembles the closed package as a zero-network operation. It must:

- preview by default and perform no write, network request, push, submission or approval;
- accept only already-derived immutable repository identities, revision/lineage and exact local Git objects;
- validate the declared Submission package and source closure;
- derive source-assessed security and repository verification reports only after all source commits are fixed;
- preserve a policy-neutral proposal as `proposal` with Fee V2 `not-selected` and no invented prototype or trade evidence;
- generate canonical deterministic `application.v3.json` bytes;
- refuse an existing destination unless a separately documented update path owns that exact revision; and
- write only after an explicit local write flag through staging and atomic rename.

Do not hand-edit a prepared application to bypass a finding. Regenerate it from the exact corrected source revision.
Application-package preparation never opens a pull request and never claims that the Registry validated the Git objects
remotely. Every destination must be a new root outside every input, source worktree and Git-control directory. Passing
that package to the confirmation-gated Draft transport is a later operation. A validation-only adapter can replay local
source closure when exact source roots are present; without them it still validates schema and semantic bindings,
canonical package bytes, privacy and persisted verification reports. It performs no network write or candidate-code
execution.

## External-write boundary

Every completed project follows one path after its exact public source and closed local package validate:

```text
APPLICATION_PACKAGE_VALID -> submit plan -> explicit confirmation -> protected Draft PR
```

Keep GitHub preparation and mutation separate. Invoke or resume only:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

Do not begin the normal journey with a namespaced transport. The first result is a read-only plan that reports:

- target repository, protected base commit/tree, application id/revision, branch/pull-request action and every write;
- the exact protected contract snapshot, selected Application and Submission adapters and Stage Plan;
- payload bytes/digests plus one current confirmation digest.

The fixed public target is
[`0xprogrammable/submit-launch:main`](https://github.com/0xprogrammable/submit-launch), immutable GitHub repository ID
`1320171831`. The confirmed
client uses the builder's fork to create or update one draft application pull request there.

Require explicit user authority for that exact digest before creating a fork, advancing a branch or opening/updating a
pull request. Recompute the plan immediately before execution and fail closed if source, base, identity, package,
intake state or requested writes changed. Never reuse a stale confirmation.

The command owns its persistent workspace, receipt and reconciliation details. Its transport records every attempted
mutation before the request, persists returned identities before readback and never blindly retries a write. Ambiguous
outcomes reconcile through bounded GET-only reads. Run only the safe next command returned for that exact state.

Planning, reconciliation and execution verify the trusted Registry intake object and every declared source CI run. A CI
run counts only when its repository identity, head repository identity, exact head SHA, workflow id/path, completed
state and successful conclusion all match the application binding. `submit-project` independently re-reads the
remote package and review state; optional local source roots add evidence but are not a substitute for remote status.

The confirmed client may perform only the writes listed in the plan. It must never mark the pull request ready, approve,
merge, deploy, sign, launch, change an account or move funds.

Reinvoking `submit-project` without a pending authorized mutation is read-only status. Report a Draft PR only after the
command re-reads the exact remote package, pull request and checks. That proves transport only, never review, approval,
deployment or launch.

A local resolver or adapter result is not end-to-end submission proof. Only the released combined path plus exact
remote Draft readback can establish that boundary.

## Review and status

Use GitHub as public transport and the review thread. Keep these axes separate:

- application transport: not submitted, draft/open, checks running, changes requested, merged or closed;
- design: unresolved, changes required or design ready;
- implementation: not started, in progress or structurally complete;
- independent review: required, hold, disposition recorded or accepted for the exact revision;
- Registry acceptance: absent/null or a content-bound accepted revision;
- authenticated approval: absent, approved for the exact revision, stale or revoked;
- Website launch handoff: pending activation, details required, permit ready, blocked or consumed;
- launch preparation: matched, unresolved or conflict; Builder-local output is never authorization;
- runtime: not deployed, deployed/verified or monitored; and
- availability: not indexed, indexed, quoted or tradable.

Let unfamiliar mechanics enter architecture discussion. An objective finding must name the exact revision, rule,
location, evidence, impact and repair path. The builder may attach counter-evidence but cannot self-disposition the
finding. A Registry/maintainer disposition must bind the application revision, finding identity, evidence and
accountable reviewer; preserve the original observation and never carry the disposition into another commit.

For a project change, create a new public commit, rerun invalidated checks, regenerate the declared Submission artifacts and
`application.v3.json`, then use the released read-only update-plan path and explicitly authorize only its current
digest. Keep prior revisions and conclusions visible as history.

Merging the GitHub application pull request proves only that the public transport/review thread was merged. It does not
by itself create canonical acceptance, deploy, index, quote or launch the project and is not an audit or Uniswap
endorsement.

A merged GitHub thread is not canonical acceptance by itself. Acceptance requires a Registry-controlled record that
binds the exact application, source, declared Submission, fee applicability and conditional Fee V2 instance, security
assessment, verification reports, findings and maintainer decision. Registry Acceptance V3 permits `applicable` with a
real fee instance or exact zero-scope `not-applicable` with null instance fields. It omits its own containing commit/tree;
the later outer launch input binds its exact Registry repository, commit, tree, path, blob and digest. Before that record
exists, launch input keeps acceptance null and reports `UNRESOLVED` and `NOT_AUTHORIZED`. Launch Bundle V2 is a separate
canonical fee-bearing contract: a `not-applicable` acceptance cannot become a fabricated fee binding or launch
authorization and must remain a launch conflict.

After activation, the authenticated approval service may convert only a valid exact-revision approval into Website
launch eligibility. The same GitHub subject must sign in, and the service must re-resolve the approved application and
source SHA and recheck current source, rights, policy, compiler, launch specification, release, chain, and incident
state. Any changed source SHA is stale and returns to analysis. A PR review, label, comment, merge, local receipt, or
caller-provided status is not launch authority.

Builder launch analysis is preflight only. Its protected resolver re-reads the central Registry repository by numeric ID,
the closed-and-merged Application PR, `refs/pull/<number>/head`, the current-head OWNER approval and the exact raw-Git
base-to-head package change set under one bounded deadline. It also reads central `refs/heads/main` twice and replays the
exact bound acceptance path, Git blob and SHA-256 from that stable current commit. The immutable PR-author GitHub user ID is authoritative;
the stored Application login is historical and may have been renamed. Maintainer and Registry authority likewise use
their immutable numeric GitHub IDs; current login, full name and URI are observed metadata that must be internally
consistent but may change. Caller JSON and results produced with an injected or mocked transport are inspection-only and never
become process-local authority. Production must independently repeat this verification before any later authorization.

## Historical applications

Keep every published V1 and V3.1 application, six-file package, pull request, receipt and status immutable. Do not rename
`application.json`, reinterpret an old fee receipt or silently widen historical source limits. Continue through a
separate V3.2 revision with explicit schema-migration lineage, unresolved evidence where necessary and no inherited
acceptance or current-route readiness.
