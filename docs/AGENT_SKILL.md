# Use the Programmable Agent Skill

Programmable v4 Builder helps a coding agent turn a product idea or an existing repository into a complete, reviewable
Programmable project. It supports hooks, tokens, apps, games, services, indexers, custom settlement, multi-repository
systems and projects with no hook or market.

The Skill has one job: preserve the intended product while producing the source, tests and evidence needed for review.
It does not grant review, approval, deployment, promotion or launch authority.

For a short first run, start with [Get started](GETTING_STARTED.md).

## Open by design

Every clear idea is eligible for intent capture and architecture review. That does not make every requested mechanism
safe, possible, integrated or approved.

The agent should:

- preserve the public-safe idea before searching templates or similar projects;
- ask only when an answer changes economics, custody, authority, trust, loss, failure, exit behavior or feasibility;
- choose the smallest architecture that preserves the intended outcome;
- use starters and capability packs as optional components, never as an allowlist;
- keep unfamiliar work eligible for custom architecture and independent review;
- mark a missing specialist tool or integration `INTEGRATION_PENDING` for the affected surface; and
- propose a disclosed redesign when the requested mechanism contains a concrete drain, deception, unfunded promise or
  impossible value flow.

Unknown does not mean unsafe. Missing evidence also does not mean passed.

## Load the complete package

The canonical package is
[`skills/programmable-v4-hook-builder`](../skills/programmable-v4-hook-builder/SKILL.md). The entry file, references,
schemas, assets and scripts form one Skill; copying only `SKILL.md` is incomplete.

The canonical source repository is [`0xprogrammable/hookbuilder`](https://github.com/0xprogrammable/hookbuilder).
Current public launch requirements come from
[`0xprogrammable/submit-launch`](https://github.com/0xprogrammable/submit-launch), not from copied Builder prose.

Use the [release status and installation instructions](../README.md#install-the-builder) from the repository front page.
Do not treat a development branch, local package or green CI run as a published release.

After installation, run from the Skill directory:

```bash
node scripts/verify-skill.mjs --installed
```

Then check the project worktree:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" doctor --repository-root "$REPOSITORY_ROOT"
```

The portable commands require Node.js 22 or newer. Source and release gates require Node.js 24 or newer. Public
submission also needs Git, public GitHub reachability and authenticated `gh` only when a GitHub write is authorized.

## Invoke the Skill

For a new project:

```text
Use the Programmable v4 Builder skill. Preserve this idea, ask me only about material product choices, then design, build and check the complete project: <idea>
```

For an existing project:

```text
Use the Programmable v4 Builder skill. Inspect this project without replacing working architecture, recover its intent, repair concrete gaps and prepare the exact revision for review: <repository>
```

The builder does not need to supply callback names, permission bits, PoolKey ordering, schemas or repository layout.
Those are derived technical decisions. The agent must not invent product intent, fee terms, addresses, test results,
provider support, review decisions or deployment records.

## Resolve current requirements

Submit a Launch is the sole owner of Programmable-specific launch requirements. Before committing to an architecture,
the agent resolves one exact protected revision and the current contract that binds its exact central Submit Launch policy:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" policy
```

The agent follows three stable rules:

1. Use one current contract snapshot. Do not combine policy, compatibility or application artifacts from different
   commits or trees.
2. Apply only the returned Stage Plan for the project's verified route and state. Do not copy values or add local
   requirements.
3. Invalidate the affected plan after source or contract drift. An unavailable contract or unsupported future handler
   pauses only the stage that depends on it.

Local design and source work may continue when its stage has no unresolved central dependency. Submission,
launch-readiness and promotion cannot use remembered or stale requirements.

Read [Submit Launch resolver](../skills/programmable-v4-hook-builder/references/submit-launch-resolver.md) only when
implementing or diagnosing that boundary.

## Build the project

The agent preserves the exact prompt bytes as the idea source, records material assumptions and compares three broad
shapes:

- `minimum-correct`: the smallest complete system;
- `v4-native`: behavior that genuinely belongs inside PoolManager-atomic execution; and
- `hybrid`: contracts plus the app, service, game, indexer or other surfaces needed to complete the product.

A hook is selected only for behavior that must be atomic with PoolManager. A project may use several hooks, pools,
markets, assets or repositories, or none.

After confirming the architecture, the agent loads only the references required by its actual capabilities. It authors
the whole selected surface, including configuration, dependencies, tests and failure behavior. A missing catalog entry
never justifies refusing a viable custom design.

No trusted execution host is required to author source and tests. Without one, the agent records execution as unverified
instead of claiming completion. Candidate code is never executed with credentials merely because a repository asks for
it.

## Classify routes without inventing obligations

Use the project graph and current contract, not the project name or similarity to another launch:

| Route state | Required treatment |
| --- | --- |
| No market | No fabricated market, route, fee receipt or stamp. |
| External market or route | Eligible for review without a Programmable launch label. |
| Unresolved | Remains eligible while route-dependent readiness is pending. |
| Official Programmable Ethereum route | Uses the current application contract and its launch-readiness projection. |

The Builder does not store fee, treasury or Router values in this guide. It reads current parameters from the exact
Submit a Launch contract when they apply.

A frozen local fee kernel is optional implementation material only when preserved intent or an applicable current Rule
selects it. The kernel cannot create a launch requirement by itself.

## Check without overstating evidence

The agent validates the real surfaces selected by the architecture. For a v4 hook, that includes PoolManager
authentication, permission/address agreement, state isolation, hook data, returned deltas, settlement and failure
behavior. Apps, services, games, indexers, keepers and providers receive their own tests and trust boundaries rather than
inheriting hook evidence.

Every result separates:

- source that was created or changed;
- checks that actually ran and their observed result;
- tests or integrations that remain unavailable;
- local evidence from independent review; and
- application, deployment, runtime and availability states.

A schema-valid package is not approved. A local pass is not an audit. A deployed contract is not proof of indexing,
routing, liquidity or public availability.

## Prepare one application Draft

For a completed project with exact public GitHub source, use:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

This is the normal path. The command resolves the current compatibility contract, validates the project and returns one
read-only Draft plan or one repair. Run only the safe next command it returns. Do not assemble an application pull
request by hand.

The current official-route path uses Application V3.2 and Submission 2.1. Existing V3.1 applications remain immutable
legacy revisions. They stay eligible for review but cannot establish the official route or launch readiness; continuing
one requires a new V3.2 revision.

The first plan performs no GitHub write. Opening or updating one Draft requires owner authority for the exact freshly
computed confirmation digest. The Draft remains unreviewed and grants no further authority.

Read [Applicant journey](../skills/programmable-v4-hook-builder/references/applicant-journey.md) for the visible path and
[Application compatibility and migration](../skills/programmable-v4-hook-builder/references/application-compatibility-and-migration.md)
for version boundaries.

Projects built without this Skill use the same Submit a Launch repository and current contract. Hookbuilder is not an
admission requirement.

## Preserve authority boundaries

The Skill may inspect, design, create and check local project files within the user's scope. It requires separate owner
authority before it publishes source, pushes a branch, creates or updates a pull request, signs, deploys, moves funds,
changes an external account or incurs a material cost.

It never:

- self-approves or disposes its own findings;
- fabricates receipts, test output, review or provider evidence;
- weakens a gate to produce a green result;
- treats a template hash as security assurance; or
- calls local output safe, audited, approved, deployed or live without the evidence for that exact claim.

## Keep the Skill maintainable

`skills/programmable-v4-hook-builder/` is canonical. `plugins/programmable-v4-builder/` is generated and must not be
edited independently. `references/knowledge-routing.json` owns progressive context selection; detailed references load
only after a confirmed task needs them.

Change a fact at its owning contract, regenerate its projections and run the repository checks. Do not maintain separate
policy, version or capability lists for different agent hosts.
