<p align="center">
  <img src="assets/repository-cover.jpg" alt="Paper-cut ants assembling a hook in Programmable's floral night garden" width="100%">
</p>

<h1 align="center">Programmable v4 Builder</h1>

<p align="center">
  Turn an idea or an existing repository into a complete, reviewable Programmable project.
</p>

<p align="center">
  Maintained by Programmable · Developed in public · MIT licensed
</p>

<p align="center">
  <a href="https://github.com/0xprogrammable/hookbuilder/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0xprogrammable/hookbuilder/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-F8F0E9?labelColor=010103"></a>
  <a href="https://agentskills.io/specification"><img alt="Agent Skills compatible" src="https://img.shields.io/badge/Agent%20Skills-compatible-F8F0E9?labelColor=010103"></a>
  <a href="https://github.com/0xprogrammable/hookbuilder/releases/latest"><img alt="Latest GitHub release" src="https://img.shields.io/github/v/release/0xprogrammable/hookbuilder?label=release&color=F8F0E9&labelColor=010103"></a>
</p>

<p align="center">
  <a href="#install-the-builder">Install</a> ·
  <a href="docs/GETTING_STARTED.md">Get started</a> ·
  <a href="#submit-a-project">Submit a project</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="SECURITY.md">Security</a>
</p>

> [!IMPORTANT]
> **Release status**
>
> The latest published GitHub Release is `v0.11.0`. The current `main` branch is newer development source, not a stable
> release. A new version is released only after its immutable tag, GitHub Release, artifacts, checks and installed bytes
> are verified. Repository CI or a local installation alone does not make a release public.

Programmable v4 Builder is a portable [Agent Skill](https://agentskills.io/specification). Give it a product idea or a
repository. It preserves the intended product, chooses the smallest complete architecture, builds the required
components and records what was actually checked.

Hooks are only one possible component. A project may also contain tokens, apps, games, services, indexers, custom
settlement, several repositories or no hook at all. Templates speed up familiar work; they do not decide what may be
built. An unfamiliar capability remains eligible for architecture and review.

The Builder is optional. Independently built projects use the same public
[Submit a Launch requirements](https://github.com/0xprogrammable/submit-launch/blob/main/docs/COMPLETE_LAUNCH_REQUIREMENTS.md)
and review path.

## Install the Builder

Preview the latest published release before installing it:

```bash
gh skill preview 0xprogrammable/hookbuilder \
  programmable-v4-hook-builder@v0.11.0
```

Install that immutable release for Codex:

```bash
gh skill install 0xprogrammable/hookbuilder \
  skills/programmable-v4-hook-builder \
  --agent codex \
  --scope user \
  --pin v0.11.0
```

GitHub's `gh skill` commands are in preview. Installations for other hosts may use a different destination. Read the
[portability guide](docs/PORTABILITY_AND_LIFECYCLE.md) before installing elsewhere.

From the installed Skill directory, verify the package:

```bash
node scripts/verify-skill.mjs --installed
```

## Start with one request

You do not need to know Uniswap callback names, permission bits, schemas or repository layout. Describe the product and
the outcome you want:

```text
Use the Programmable v4 Builder skill. Build and check this project, then prepare it for Submit a Launch. Ask me only about choices that would materially change the product: <idea or public GitHub URL>
```

For a shorter walkthrough, read [Get started](docs/GETTING_STARTED.md).

## What the Builder does

| Stage | Result |
| --- | --- |
| Understand | Preserves the idea and isolates only the product choices that need an owner. |
| Resolve | Reads the current Submit a Launch contract and selects only the requirements for this project's stage and route. |
| Design | Chooses the smallest architecture that preserves the intended behavior. |
| Build | Creates the complete contract, app, service, game or mixed repository surfaces the project needs. |
| Check | Runs available deterministic checks and records missing or unverified evidence without inventing a pass. |
| Prepare | Freezes the exact public source and prepares one review-only application draft. |

The Builder loads detailed protocol and security material only after the project proves that it needs it. Missing tools or
an unsupported integration pause the affected work as `INTEGRATION_PENDING`; they do not turn a new idea into a forbidden
product category.

## Current launch requirements

Submit a Launch owns the current Programmable-specific requirements. The Builder resolves one exact protected revision,
uses its manifest-bound contract and applies only the returned stage plan. It does not keep a second list of fees,
addresses, routers or Rule IDs.

The route matters:

- A no-market project does not invent a market, fee route or launch stamp.
- A project using an external route remains eligible, but it cannot claim a Programmable launch label.
- An unresolved route remains pending; missing evidence never becomes a silent exemption.
- A project requesting the official Programmable Ethereum route must use the current application contract and satisfy
  the requirements returned for launch readiness.

If the protected contract changes, the Builder discards the affected plan and resolves it again. If a future contract or
handler is not supported, only that stage pauses. Local source work that does not depend on the missing contract may
continue.

The canonical machine policy and its human guide live in
[`0xprogrammable/submit-launch`](https://github.com/0xprogrammable/submit-launch). The Builder never replaces them.

## Submit a project

For a completed project with exact public GitHub source, use one command:

```bash
node "$SKILL_ROOT/scripts/cli.mjs" submit-project "$REPOSITORY_ROOT"
```

The command resolves the current accepted application contract, checks the project and returns a read-only Draft plan.
Run the exact safe next command it returns. A GitHub write occurs only after the owner authorizes the freshly computed
confirmation digest.

The current official-route application uses Application V3.2 and Submission 2.1. Existing V3.1 drafts remain eligible
under their original contract, but they cannot establish the official Programmable route or launch readiness. Moving one
forward creates a new V3.2 revision; it does not rewrite the old application.

The same Submit a Launch repository accepts projects built without this Skill. Those applicants should begin with the
[standalone submission guide](https://github.com/0xprogrammable/submit-launch/blob/main/README.md).

A Draft is only a request for review. It is not approval, an audit, deployment, Registry promotion, public routing or a
launch.

## Evidence boundaries

| A result can establish | It does not establish |
| --- | --- |
| A check passed for exact local bytes | An independent audit or a guarantee of safety |
| A package was installed and verified in one host directory | That every host selects or runs the Skill correctly |
| An exact application Draft was prepared or opened | Review, approval, deployment or launch authority |
| Deployment evidence exists | Indexing, routing, liquidity, provider support or public availability |

Every external write, signature, deployment, publication, credentialed provider action and material cost requires its
own authority and evidence.

## Build it with us

Programmable v4 Builder is developed in public. Contributions are welcome when they improve accuracy, composability,
efficiency, portability, documentation or evidence without narrowing the kinds of projects people can build.

| If you found or need | Start here |
| --- | --- |
| A reproducible defect | [Open a bug report](https://github.com/0xprogrammable/hookbuilder/issues/new?template=bug.yml) |
| A missing capability or integration | [Propose a capability](https://github.com/0xprogrammable/hookbuilder/issues/new?template=capability.yml) |
| A code or documentation change | [Read the contribution guide](CONTRIBUTING.md) |
| A possible vulnerability | [Report it privately](SECURITY.md) |

Each fact has one owner. Change the canonical contract and regenerate its projections instead of copying policy or
version data across the repository.

<details>
<summary><strong>Repository map</strong></summary>

```text
skills/programmable-v4-hook-builder/   canonical portable Skill
  references/                         routed knowledge and machine contracts
  assets/                             starters, capability packs and reference kernels
  scripts/                            deterministic tools and package checks
docs/                                 human and maintainer documentation
evals/                                adversarial and journey evaluations
plugins/programmable-v4-builder/      generated Codex plugin payload
```

The canonical Skill is the source. Generated plugin files must be regenerated and byte-checked rather than edited by
hand.

</details>

## Verify from source

Source and release checks require Node.js 24 or newer. The portable Skill supports Node.js 22 or newer.

```bash
npm test
gh skill publish --dry-run
```

The bundled Solidity reference kernels have separate Foundry checks. Model-backed evaluations also remain separate
because they require provider credentials and may cost money. An unavailable provider result is never counted as passed.

## Documentation

| Goal | Read |
| --- | --- |
| Start a project | [Get started](docs/GETTING_STARTED.md) |
| Understand the Agent Skill | [Agent Skill guide](docs/AGENT_SKILL.md) |
| Submit a completed project | [Submit a Launch](docs/PUBLIC_GITHUB_PR_BETA.md) |
| Understand current contract resolution | [Submit Launch resolver](skills/programmable-v4-hook-builder/references/submit-launch-resolver.md) |
| Understand application migration | [Application compatibility and migration](skills/programmable-v4-hook-builder/references/application-compatibility-and-migration.md) |
| Extend the system | [Architecture](docs/ARCHITECTURE.md) · [Contribution guide](CONTRIBUTING.md) |
| Review release evidence | [Release gates](docs/OPEN_WORLD_V2_RELEASE_GATES.md) · [Release process](docs/RELEASING.md) |

## License and independence

Programmable v4 Builder is independent open-source software under the [MIT License](LICENSE). Uniswap is a source
protocol and ecosystem referenced by the Builder. This repository does not claim affiliation with or endorsement by
Uniswap Labs or the Uniswap Foundation.
