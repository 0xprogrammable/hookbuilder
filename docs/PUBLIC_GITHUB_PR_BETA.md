# Public GitHub PR Builder Beta

The Public GitHub PR Builder Beta is the proposed public review path for open-world Programmable projects. A builder
keeps the complete project in one or more builder-controlled public GitHub repositories. A small application pull
request binds one exact revision, its intent, source closure and evidence; GitHub keeps the public review thread.

## Current status

Open-world submission v2 and application v3 are a local development implementation. This document defines the target
beta; it does not announce that v3 intake is open or that a release candidate exists. Public activation requires the
v3 generator, trusted Registry validator, status/update path, protected workflow and live canary to pass the same
contract for one exact release. Check
[`OPEN_WORLD_V2_RELEASE_GATES.md`](OPEN_WORLD_V2_RELEASE_GATES.md) and the trusted Registry intake state before making
an availability claim.

The authenticated approval-to-Website bridge and Website Custom Launcher are represented in the local target product
flow, not a separate product claim. They remain pending production activation and externally verified integration. The target user path
is GitHub submission, repair, and exact-revision status, followed by Website launch eligibility for the same unchanged
approved source SHA. Do not describe that connected path as live while production remains frozen or trusted intake is
not active.

The published v1 beta remains historical. Its closed six-file directory, `application.json`, source-array caps and up
to eight companions apply only to exact v1 applications. They are not v2 limits and must not be silently rewritten or
described as application v3.

## What the beta is for

The beta is designed to let a builder:

1. describe an idea in plain language or bring an existing public project;
2. preserve the original public-safe intent before templates or archive search;
3. build hooks, tokens, games, interfaces, services and new compositions without a product-category allowlist;
4. run deterministic checks against exact source and evidence;
5. prepare a content-addressed public application;
6. discuss unknown mechanics without treating novelty as rejection;
7. receive objective findings, attach counter-evidence and repair a new exact revision; and
8. keep review, acceptance, launch and runtime history separate.

The Builder and GitHub transport do not self-approve, audit, deploy, or launch a project. After activation, the
independent authenticated approval service may approve only the exact revision it evaluated, and the Website may derive
launch eligibility only from that current approval. Neither approval nor launch eligibility proves that a project is
safe, rug-free, supported by a provider, or endorsed by Uniswap.

## Eligibility

Every describable idea is eligible for intent capture and architecture review. A valid application needs:

- a builder-controlled public GitHub repository for every declared source surface;
- exact reachable commits and trees that remain available during review;
- a public-safe original idea record or an explicit redaction/legacy-unavailable state;
- a complete v2 project graph, architecture decisions and intent-fidelity record;
- source, tests, evidence, fee and security artifacts appropriate to the stage; and
- a public GitHub identity reviewers can contact.

A project may contain multiple assets, markets, hooks, pools and repositories plus interfaces, Three.js games,
services, indexers, keepers, metadata, custom pricing, custom settlement or external systems. It may use an AMM,
partial custom accounting or reviewed full-consumption zero-AMM accounting. A missing catalog name, template, chain,
provider integration or language handler is not a rejection.

When a design cannot launch on the current platform, it can still be designed, implemented and submitted with
`INTEGRATION_PENDING`, independent review or an explicit tooling hold. Launch support requires a separate exact
integration release and runtime evidence.

Concrete unsafe behavior remains a real boundary. A hard conflict requires an exact structured predicate such as an
unauthenticated privileged action; hidden or unauthorized mint, seizure, fee, pause, upgrade or payout redirection;
movement below an enforceable backing/liability floor; seizure of owed value; a false autonomous-exit or guaranteed-
solvency promise; dishonest custom accounting; or participant-value randomness with an undisclosed or manipulable
outcome. Disclosed bounded controls, authorized dispositions, managed redemption, contingent claims and invariant-
preserving rebalancing instead receive their explicit trust/review path unless one exact predicate applies. The reviewer
must name the behavior and preserve the legitimate outcome where possible; “unfamiliar” is not a security finding.

Private repositories, local-only worktrees, ZIP-only source, pasted code, mutable branch names and deployed bytecode
without reviewed source are outside the public transport. The builder can continue local work but cannot bind a valid
public application until the required exact source is public and reachable. Report the transport as
`INTEGRATION_PENDING`, keep the idea eligible and perform no public-package or external write.

Application V3 is GitHub-only. Another Git host, upload form, email, ZIP or connected private-source service is not an
alternate V3 transport; adding one would require a separate versioned contract and threat model.

## Application v3 contract

The target root artifact is `application.v3.json`, validated against
[`public-pr-application-v3.schema.json`](../skills/programmable-v4-hook-builder/references/public-pr-application-v3.schema.json).
It binds:

- application id, revision and explicit lineage;
- immutable builder and repository identities;
- exact commit and tree for every primary or companion repository;
- the content-addressed idea source as the only normative intent record;
- intent, architecture and fidelity state;
- `submission.v2.json`;
- Fee V2 schema, derived `feeApplicability`, and a real scoped instance only when applicability is `applicable`;
- security schema plus source-assessed security and verification records derived after source freeze;
- review records, tests and evidence; and
- the complete source closure for each repository.

The application is always submitted as `unreviewed`. It cannot prefill a maintainer acceptance or inherit approval from
a template, similar Registry entry, v1 application, prior commit or local test result.

Application V3 derives fee applicability from the exact bound Submission V2 graph. A proposal is `unresolved` with null
instance fields. A prototype with at least one `programmable-canonical` scope is `applicable` and binds the real instance.
An exact zero-scope prototype is `not-applicable`, keeps every fee-instance field null and supplies no fake market,
PoolKey, hook or fee receipt. An `unknown` execution class must resolve before prototype review and grants no exemption.

V2 serializes each EVM `chainId` as a canonical positive `uint256` decimal string (`"1"`, never the JSON number `1`).
Zero, signs, whitespace, leading zeros, fractions and values above `2^256 - 1` fail closed across submission, fee and
launch bindings.

Application V3, Registry Acceptance V3 and Launch V2 serialize `applicationRevision` as a canonical positive decimal
string. There is no semantic `1,000,000` or JavaScript safe-integer ceiling. Historical V1 application revisions keep
their frozen integer representation. A new V3 application starts at `"1"`; each update content-binds the prior exact
revision and increments it by one with arbitrary-precision semantics.

A source-owned proposal may keep its security assessment null or explicitly pending/unassessed. A source-assessed
instance and source-verification report cannot live in the source commit whose id they contain. Freeze source first,
then derive those records into the central application package with `repositoryRef: null`; content-bind them to the
already-existing source commit, tree and manifest.

The pull request contains only the generated v3 application package and its presentation; it does not copy the full
project into Programmable. The exact package layout is owned by the released v3 generator and trusted Registry
validator. Do not hand-invent filenames or use the historical six-file v1 layout for a v2 project.

### Source closure without a project-size allowlist

Each repository uses one transport:

- `inline` binds one to 4,096 exact repository-relative paths; or
- `manifest` binds a versioned root manifest and ordered canonical-JSON-Lines fragments for a larger closure.

Inline is a small-package fast path, not a preferred product class. Crossing the inline bound selects manifest
transport. It does not make a large game, multi-service project or unfamiliar mechanism unsafe or ineligible.

The outer application repository record binds repository id/URI, commit and tree. The root manifest is bound as an
exact blob inside that tree, repeats repository id/URI and binds every fragment. It deliberately does not embed its own
containing commit/tree because doing so would create a Git self-reference.

The verifier checks every fragment and source entry against raw Git objects: path order, uniqueness, role, mode, blob,
size, SHA-256, ranges, counts and closure digest. It does not follow symlinks or execute candidate code, hooks, filters,
submodules or build scripts. Bounded resource limits may produce a content-addressed split-review hold. A tooling hold
blocks that verification run, not the product idea.

Coverage remains repository-local. A path in one companion cannot satisfy a submission, fee, security or evidence
binding owned by another repository.

Manifest V1 supports SHA-1 Git object databases: its Git object fields are 40-hex ids, separate SHA-256 fields bind
content bytes, and committed paths must be UTF-8. A Git SHA-256 object database or non-UTF-8 path is
`INTEGRATION_PENDING` for current V3 transport with the idea still `ELIGIBLE_FOR_REVIEW`; the generator does not write.
A UTF-8 path above the current 16 KiB byte budget reports `HOLD_SPLIT_REVIEW` and `tooling-split-review`. Other object
formats or path encodings require a new versioned closure contract and verifier; do not widen V1 in place.

## Programmable Fee V2 for canonical scopes

Every `programmable-canonical` execution scope owes exactly 10 bps (`0.10%`) of executed gross quote-side swap or fill
volume to the immutable fee owner and sole claim authority:

```text
0x4957f49620AFf3Adbbe8195a4f633E49cc93376c
```

The builder-selected total charge is inclusive. Selected 3% means 0.1% for Programmable and 2.9% for the project,
never 3.1%; a zero project fee still produces the 0.1% share. LP fees, transfer taxes, router charges, app payments and
unrelated pools are not substitutes.

Markets declared `external` or `non-launchable` bind no Programmable fee scope, but that label cannot disguise an
execution actually performed by Programmable. Fee V2 supports standard AMM, synchronous custom zero-AMM, async
fill/batch and custom-reviewed profiles. Each profile needs exact implementation, funding, rounding, claim and
conformance evidence; the bundled standard-AMM kernel does not prove the others.

The separate administration wallet is:

```text
0x2Bb333d48DFAF1596D9036671d2E43168994249E
```

Administration and fee ownership remain independent. The admin cannot claim, redirect, sweep or replace the
Programmable liability.

## Builder journey

### 1. Capture and build

Give any compatible coding agent the Programmable v4 Builder skill and the idea or repository. For a fresh idea, use
the local open-world `init` operation in dry-run mode first, review the unconfirmed bootstrap proposal set, then
explicitly write it. That set is not a project file-count limit. Templates can accelerate the build but cannot redefine
the idea.

Confirm only material choices, create the open project graph, implement the complete mechanism and trace each material
intent fact through architecture, source, tests and evidence. Keep planned, blocked, declared and executed checks
separate.

### 2. Validate locally

Run the released open-world validator on the complete package. It performs no network request, candidate-code
execution, GitHub write, review decision or approval. A schema-valid package is structural evidence only.

Layer security observations across intent, configuration, exact source and runtime. An absent scanner match remains
`unknown`. An adverse automated finding must name its rule, location, observed evidence and remediation. The builder
may attach counter-evidence but cannot waive its own finding.

### 3. Prepare application v3

First keep `applicationRevision` and `lineage` absent from the canonical revision draft, then derive them from exact
current source plus the highest eligible Registry/open-draft predecessor:

```bash
REVISION_DRAFT="/absolute/outside-source/application-v3-draft.json"
REVISION_ROOT="/absolute/outside-source/prepared-revision"
node "$SKILL_ROOT/scripts/cli.mjs" open-world prepare-revision "$REVISION_DRAFT" \
  --source-root primary="$REPOSITORY_ROOT" \
  --output "$REVISION_ROOT" \
  --write
```

Repeat `--source-root` for every current repository. Preview is the default. `prepare-revision` uses authenticated
GET-only GitHub requests and exact local Git replay; it performs no GitHub write and creates only a new output root when
`--write` is explicit. Then use the resulting `$REVISION_ROOT/application.v3.json` with the exact inputs shown by
`cli.mjs open-world application --help`. `application` is a separate zero-network operation that builds the complete
source-assessed package, refuses an existing or contained destination and writes only after explicit `--write`.

Neither step publishes source, pushes a branch, opens a pull request or proves that the Registry verified the remote
Git objects. Output roots must remain outside every input/source worktree, linked-worktree Git directory, common Git
directory and object store. Until the v3 generator and trusted intake are activated together, describe the result as
candidate-only.

Every source, closure, evidence or recheck change requires another `prepare-revision` pass before rebuilding the
package. Same-numeric-repository history may be replayed from the current object database. Use repeatable
`--predecessor-source-root id=/exact/old/git-root` only for a selected removed or replaced historical repository whose
objects are otherwise unavailable, including a removed inline companion in mixed manifest/inline history. Missing old
objects are integration-pending; mismatched old objects are invalid.

### 4. Plan and confirm the GitHub write

After trusted V3 intake is activated, use only `cli.mjs open-world submit`, `update`, and `status`; the top-level
application commands remain historical V1 interfaces. The first V3 submission or update call is a read-only
authenticated plan. It identifies the target, application revision, branch or pull-request action, exact bytes, every
external write and one current confirmation digest. Status remains read-only.

The canonical public target is
[`0xprogrammable/programmable-registry:main`](https://github.com/0xprogrammable/programmable-registry). The confirmed
client creates or updates one draft application pull request there from the builder's fork; no application is submitted
to the Website repository or the general product repository.

Review that plan. Only after explicit authorization may the client execute those exact writes with that exact digest.
It must recompute the plan immediately before execution and fail closed if source, package, identity, intake state,
base revision or requested writes changed.

The confirmed client may create or update the draft application pull request. It never marks it ready, approves,
merges, deploys, signs, launches, changes an account or moves funds.

### 5. Review and repair

Review applies only to the exact repository ids, commits, trees, source closure and evidence in the latest application.
An objective finding includes:

- exact application revision and artifact/source location;
- observed fact and reproducible evidence;
- published rule or trust boundary;
- practical impact;
- repair or missing-evidence path; and
- the check that must be rerun.

Unfamiliar or conflicting behavior can enter `INDEPENDENT_REVIEW` or `HOLD` without being labelled unsafe. A later
Registry/maintainer disposition may confirm, remediate, mark not applicable or identify a false positive only when it
content-binds the exact application revision, finding, evidence and accountable reviewer. It preserves the original
finding and never carries into a new commit.

When a builder changes the project, push a new commit, rerun invalidated checks, regenerate the v2 package and v3
application, then prepare and explicitly confirm an update to the same review thread. Do not force-push or delete exact
revisions that remain part of the review history.

A merged review thread is not canonical acceptance. Acceptance requires a Registry-controlled record that binds the
exact application, source, submission, fee applicability and conditional Fee V2 instance, security assessment,
verification reports, findings and maintainer decision. Registry Acceptance V3 additionally requires a fresh external
review projection bound to the approved head's exact raw-Git package inventory; stored acceptance bytes never authenticate
themselves. V3 permits `applicable` with a real instance or exact zero-scope
`not-applicable` with null instance fields. The accepted record omits the commit/tree that would
contain itself; the later launch input binds the exact Registry repository, commit, tree, path, blob and digest. Before
that record exists, its nullable launch binding is null and launch preparation remains `UNRESOLVED` and `NOT_AUTHORIZED`.
Launch Bundle V2 is a separate canonical fee-bearing contract: a zero-scope acceptance cannot fabricate the missing fee
instance and remains a launch conflict.

After activation, an authenticated approval for that exact Application V3 revision can continue to the Website Custom
Launcher. The same GitHub subject signs in, the service re-resolves the approved application and source SHA, and the
Website rechecks current approval, source, rights, policy, compiler, launch specification, release, chain, and incident
state before it derives a short-lived launch entitlement. Any source change makes the approval stale and starts a new
review target. A PR review, label, comment, merge, or caller-supplied status never unlocks launch.

## Status model

GitHub state is transport, not one universal product status:

| Axis | Examples | Does not prove |
| --- | --- | --- |
| Pull request | draft, open, checks running, changes requested, merged, closed | technical acceptance or launch |
| Design | unresolved, changes required, design ready | implementation exists |
| Implementation | not started, in progress, structurally complete | audit or deployment |
| Independent review | required, hold, disposition recorded, accepted revision | launch authority |
| Authenticated approval | absent, approved exact revision, stale or revoked | wallet signature, deployment or launch |
| Website launch handoff | pending activation, details required, permit ready, blocked or consumed | transaction confirmation |
| Launch preparation | matched, unresolved, conflict; Builder-local output is not authorized | signature or transaction |
| Runtime | not deployed, deployed/verified, monitored | provider availability or safety |
| Availability | not indexed, indexed, quoted, tradable | endorsement or absence of risk |

The trusted Registry intake state is separate and must be read from its exact current base revision. `prelaunch`,
`paused-new` or `paused-all` are operational states, not a rejection of the project. Do not hard-code or infer `open`
from this document.

Repository administrators remain part of GitHub's trust boundary. Application authors receive no bypass authority.
Trusted intake must use base-branch validator code, isolate application paths and never execute contributor scripts
with credentials, signing access or repository write permission.

## Public data and privacy

The project repositories, application pull request, commits, evidence and review comments are public. Include only
information intended for publication.

Every raw JSON input and manifest line is decoded with fatal UTF-8 and checked for duplicate decoded keys before the
privacy scanner, hash comparison or semantic validator sees it. Matching duplicates, conflicting duplicates and
Unicode-escaped equivalents all fail closed, so a later visible value cannot shadow an earlier secret or authority.
The scanner never echoes the secret value in its public error.

Never include:

- private keys, seed phrases, wallet files or signing material;
- passwords, access tokens, API keys, cookies or credentials;
- private RPC/database URLs or environment files;
- unrelated personal or customer data;
- confidential third-party source or documents; or
- an unpatched vulnerability or exploit instructions.

Use a GitHub handle for contact. The beta does not need a wallet address, legal identity, private repository permission
or GitHub App installation.

Each intentionally public financial identifier may remain visible only through an exact top-level
`publicDisclosureAttestations[]` record. It binds the candidate's RFC 6901 string pointer and SHA-256 substring digest,
the same application id and owner-stated purpose, plus exactly one content-bound
`public-disclosure-authorization` review record. The raw identifier is not duplicated in the attestation. It remains
`human-review-required` and proves neither account ownership nor publication approval. A wrong, unused or blanket
attestation stays a privacy hold; private keys, seed phrases, passwords, credentials and API/auth tokens are never
attestable.

Report an unpatched vulnerability through
[GitHub private vulnerability reporting](https://github.com/0xprogrammable/programmable-v4-builder/security/advisories/new)
as described in [`SECURITY.md`](../SECURITY.md). Stop public technical discussion until it is safe to resume.

## Historical v1 applications

Keep exact v1 source revisions, six-file application directories, pull requests, receipts, validator results and
review conclusions immutable. A v2 migration creates a separate revision with explicit lineage. It marks unavailable
original intent as legacy-unconfirmed, leaves fidelity unassessed, creates no fabricated Fee V2 instance and inherits
no approval.

Do not rename `application.json`, expand a v1 package in place, reinterpret Fee V1 evidence as Fee V2 conformance or
apply v3 reviewer dispositions to a historical revision.

## What a completed review does not mean

A draft, open, reviewed, merged or closed application pull request does not mean the project is:

- audited, safe, rug-free or free of vulnerabilities;
- approved to sign, deploy or launch;
- deployed, source/runtime matched, monitored, indexed, quoted or tradable;
- supported by any wallet, interface, aggregator, provider or listing service;
- endorsed by Uniswap Labs, Uniswap Foundation or another third party; or
- entitled to fees, revenue, grants or future integration merely because it was submitted.

Acceptance, launch authorization, deployment, verification, indexing and provider activation are separate processes
with their own exact evidence.

## Honest release copy

Until v3 trusted intake is active, say:

> Programmable's open-world v2 Builder and public application v3 are in release-candidate testing. They are not yet an
> open application or launch claim.

Use launch copy only after the exact public release, trusted intake, protected workflow and live canary are verified:

> Describe your Programmable project to your coding agent or bring an existing public repository—including a Uniswap v4
> hook or token, app, game, service, or standalone settlement. The Builder preserves the idea, helps build and check the
> complete project, binds one exact GitHub revision and prepares a public application for evidence-based review. New
> mechanics enter architecture review instead of a preset-model rejection.
> Review is not an audit, deployment, launch, provider-support or Uniswap-endorsement claim.

Do not say the agent “does everything,” that every mechanism is safe, that an application is automatically approved or
that a reviewed project is automatically launchable. A factual shorthand before activation is: **Your agent handles
the build-and-repair loop; GitHub keeps the exact public review trail; the Website launch handoff is pending
activation.** After activation and verification of the exact public release, it may become: **Your agent handles the
build-and-repair loop, GitHub shows the exact-revision status, and an unchanged approved revision continues to the
Website Custom Launcher.**

## Related documents

- [Open-world v2 architecture](OPEN_WORLD_V2_ARCHITECTURE.md)
- [Open-world v2 release gates](OPEN_WORLD_V2_RELEASE_GATES.md)
- [Use the agent skill](AGENT_SKILL.md)
- [Platform boundary](PLATFORM_INTEGRATION.md)
- [Security reporting](../SECURITY.md)
- [Contribution guide](../CONTRIBUTING.md)
