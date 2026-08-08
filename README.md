<p align="center">
  <img src="assets/repository-cover.jpg" alt="Programmable islands connected by streams, representing composable building blocks" width="100%">
</p>

<h1 align="center">Programmable v4 Builder</h1>

<p align="center">
  Describe a Programmable product—including a Uniswap v4 hook, token, app, game, service, or standalone settlement. Give the same portable skill to your coding agent. Build, check, and prepare one exact GitHub application.
</p>

<p align="center">
  <a href="https://github.com/0xprogrammable/programmable-v4-builder/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0xprogrammable/programmable-v4-builder/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-6f5b95"></a>
  <a href="https://agentskills.io/specification"><img alt="Agent Skills compatible" src="https://img.shields.io/badge/Agent%20Skills-compatible-e86eaf"></a>
  <a href="CHANGELOG.md"><img alt="Current public release 0.4.0" src="https://img.shields.io/badge/public-v0.4.0-5e8f7b"></a>
</p>

Programmable v4 Builder is an evidence-first [Agent Skill](https://agentskills.io/specification) for open-ended
Programmable projects, including but not limited to Uniswap v4. It combines protocol mechanics, Programmable's platform
contract, reusable planning blocks, deterministic checks, adversarial evaluations, and a GitHub application workflow in
one versioned package.

The Open-World V2, Fee V2, Application V3, and Launch Bundle V2 work described below is an unreleased local candidate.
Its local tools do not make Registry V3 intake active, accept a project, authorize launch, deploy code, or prove provider
availability. The public `v0.4.0` release remains current until the candidate release gates pass.

It is built for ordinary token launches and unfamiliar ideas alike: custom hooks, games, maps, wallet quests, auctions,
dynamic fees, transfer taxes, automatic liquidity, external services, active-liquidity markets, wrapped assets,
position automation, and architectures that do not have a catalog name yet. Templates accelerate repeated work; they
never define what builders are allowed to invent.

## Install

The shortest interactive command is:

```bash
gh skill install 0xprogrammable/programmable-v4-builder
```

For a reproducible Codex installation pinned to this release:

```bash
gh skill install 0xprogrammable/programmable-v4-builder \
  programmable-v4-hook-builder@v0.4.0 \
  --agent codex \
  --scope user
```

Replace `codex` with `claude-code`, `github-copilot`, `cursor`, `gemini-cli`, or another host supported by `gh skill`.
The GitHub CLI skill commands are currently a preview feature. Installation grants no wallet, deployment, publication,
approval, or external-account authority.

Then tell the agent:

```text
Use the Programmable v4 Builder skill. Turn this idea into a complete checked project and prepare its GitHub application: <your idea>
```

For an existing project:

```text
Use the Programmable v4 Builder skill. Inspect this repository, preserve the intended product, repair objective findings, and prepare one exact GitHub application revision: <repository URL>
```

The agent keeps the mechanics behind that request explicit: it validates and freezes the project, derives the unique
Application V3 revision/lineage with GET-only GitHub reads, builds the complete source-assessed package locally with no
network, then shows a read-only submission/update plan. A GitHub draft is written only after separate confirmation of
that exact current plan digest. No local success is called acceptance, deployment or launch.

## Why this is more than a documentation page

Documentation explains. This package also gives the agent deterministic machinery:

- a local knowledge router that loads only the chapters required for the current job;
- live, hash-bound search of the canonical public Programmable project Registry;
- an explicit offline Registry fallback proven against one already-public commit through a portable raw-Git receipt,
  always labeled as a stale point-in-time baseline rather than live state;
- composable starters and capability packs with hash-bound provenance;
- a plain-language intent contract and open-world product graph with owner-defined capabilities;
- first-class trade-capability outputs: explicit `tradable`/`no-market`/`unresolved` classification, one closed
  `NOT_APPROVED` route manifest per tradable market, and typed quote/execution evidence;
- deterministic scaffolding, semantic validation, security assessment and intent-fidelity checks;
- Fee V2 profiles for AMM, zero-AMM, async/batched and custom-reviewed settlement designs;
- exact multi-repository source closure with content-addressed manifests for large projects;
- staged, post-commit security and source-verification evidence that avoids a source hash cycle;
- a derived, content-bound, GitHub-only Application V3 with GET-only revision discovery, zero-network package building,
  inline and manifest closure modes;
- duplicate-key-safe bounded JSON handling before privacy, integrity or semantic review;
- read-only application status plus two-step confirmation for an authorized draft submission;
- upstream source drift detection, migrations, release planning, and installed-package verification; and
- adversarial evals for protocol, SDK, liquidity, signing, claims, creativity, repository and external-action failures.

## One idea, progressive context

The agent does not preload the entire knowledge base.

```mermaid
flowchart LR
  A["Plain-language idea or repository"] --> I["Verbatim intent contract"]
  I --> H["Live canonical project archive"]
  H --> B["Local context router"]
  B --> C["Starter plus Lego capabilities"]
  C --> D["Design and value-flow checks"]
  D --> T["Trade classification and route contract"]
  T --> E["Implementation and executable evidence"]
  E --> R["GET-only revision and lineage derivation"]
  R --> F["Zero-network exact application package"]
  F --> G["Programmable maintainer review"]
```

The router reports exact bytes and a reproducible `ceil(UTF-8 bytes / 4)` estimate for every profile. The 18,000-token
initial target is a routing budget, not a safety cap or model-tokenizer claim. More complex products add only the
confirmed protocol, runtime, service, liquidity, or security context. Unknown capabilities remain eligible and route to
architecture review; routing follows confirmed capabilities and surfaces, never one prompt word or a fixed taxonomy.
Required context is reported and retained when it exceeds the target.

Try the router locally:

```bash
node skills/programmable-v4-hook-builder/scripts/cli.mjs context --mode explore
node skills/programmable-v4-hook-builder/scripts/cli.mjs discover search "ordinary token with automatic liquidity"
```

## Product rules that do not disappear inside templates

First derive fee applicability from the exact project graph. A proposal is `unresolved`. A prototype with at least one
`programmable-canonical` scope is `applicable` and binds a real Fee V2 instance. An exact zero-scope prototype is
`not-applicable`, keeps instance fields null, and must not invent a market, PoolKey, hook or fee receipt.

Every Programmable-canonical execution scope must preserve Programmable's inclusive 10 bps share of executed gross
quote-side swap or fill volume exactly once. If a builder selects a 3% total charge, the total remains 3%:
0.1% Programmable and 2.9% project. The immutable claim authority is
`0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`. The separate platform administration wallet,
`0x2Bb333d48DFAF1596D9036671d2E43168994249E`, can exercise only independently authorized platform controls; it cannot
claim, replace, redirect, sweep, or net the fee liability.

V2 encodes every EVM `chainId` as a canonical positive `uint256` decimal string (`"1"`, never the JSON number `1`). Fee
collection uses the settlement-specific `standard-amm`, `sync-custom-zero-amm`, `async-fill-batch`, or
`custom-reviewed` profile. The bundled Solidity kernel evidences only `standard-amm`; the other profiles need their own
implementation, custody proof, tests, and review.

When applicability is `applicable`, prototype conformance uses a typed receipt plus canonical vector-set bytes, not a
free-form evidence string. A complete record carries `evidenceRefs`, exact `evidenceDigests[]`, and one typed
receipt/vector pair in `scopeArtifacts[]` for every fee scope. It binds the implementation, source commit/tree,
scope/profile, execution-surface coverage, exposed modes, vectors and evidence. User-funded modes remain below 100%; a
high-rate custom profile requires exact segregated external funding and solvency evidence. Structural conformance is not
an audit, deployment or approval.

Application V3, Registry Acceptance V3, and Launch V2 likewise encode `applicationRevision` as a canonical positive
decimal string, without the historical V1 integer, `1,000,000`, or JavaScript safe-integer ceiling. Frozen V1 records
retain their original integer revision shape. A new V3 application starts at `"1"`; each update binds the exact prior
revision and increments it by one with arbitrary-precision semantics.

Application V3 transports the derived applicability. Registry Acceptance V3 may accept an exact zero-scope project as
`not-applicable` with null fee-instance fields. Launch Bundle V2 remains a separate canonical fee-bearing contract: N/A
cannot be converted into a fabricated instance or launch authorization, and every local launch result stays unsigned
and `NOT_AUTHORIZED`.

The Builder's Registry Acceptance V3 bridge is also preflight, not platform authority. It resolves the stable central
Registry repository ID, closed-and-merged Application PR, central pull ref, current-head OWNER approval and exact
raw-Git package/change-set digests under aggregate request, byte and deadline bounds. The same protected pass reads
central `refs/heads/main` twice and replays the exact bound acceptance blob from that stable current commit. Builder identity follows the
immutable GitHub user ID, so a renamed login does not break lineage. Maintainer and Registry authority also follow their
immutable numeric IDs; current login, full name and URI remain internally consistent observed metadata, not authority.
Mocked or injected transports return inspection-only results, caller JSON never authenticates, and production must
independently re-run the verification before any later authorization.

Application V3 may downgrade an exact intentionally public financial-identifier candidate from privacy block to mandatory
human review only through an exact pointer, substring digest, application binding, owner-stated purpose and matching
authorization record. That attestation proves neither ownership nor approval and can never waive a secret, credential,
private key, seed phrase, password or API/auth token.

The Builder keeps these states separate:

1. idea and design eligibility;
2. implementation conformance;
3. Programmable maintainer review;
4. deployment and source/runtime verification;
5. provider-specific indexing, quoting, simulation, and execution; and
6. public availability.

A local green check proves only the exact local check. It is not an audit, approval, deployment, provider statement,
Uniswap endorsement, or guarantee that code is safe or rug-free.

The public application path accepts exact public GitHub repositories only. A local directory, ZIP, pasted source,
private repository, or another Git host can support exploration but cannot satisfy Application V3; it stays idea
eligible as `INTEGRATION_PENDING`, with no public package or external write. Application transport, maintainer
acceptance, launch preparation, admin authorization, deployment/runtime verification, indexing, quoting, and public
availability remain separate evidence states.

The current source-closure-manifest V1 transport supports SHA-1 Git object databases, separately records SHA-256 content
digests, and requires UTF-8 committed paths. A Git SHA-256 object database or non-UTF-8 path is an
`INTEGRATION_PENDING` transport case with `ELIGIBLE_FOR_REVIEW` idea status. A UTF-8 path above the generator's current
16 KiB path-byte budget is `HOLD_SPLIT_REVIEW` under the same eligibility. None is an unsafe or ineligible product;
other object formats or path encodings require a new versioned closure contract rather than widening V1 in place.

## Repository map

```text
skills/programmable-v4-hook-builder/   portable source installed by agents
  SKILL.md                             small operating contract and router entry
  references/                         progressively loaded knowledge and schemas
  assets/starter-catalog/              starters and composable capability packs
  assets/reference-kernels/            reviewed implementation candidates and tests
  scripts/                             deterministic local tools
  scripts/test/                        portable package tests
evals/                                 adversarial agent evaluation suite
docs/                                  architecture, usage, source and review records
config/plugin.json                     single host-metadata source
.codex-plugin/                         generated Codex manifest
.agents/plugins/marketplace.json       generated Codex marketplace
.claude-plugin/                        generated Claude manifest and marketplace
.mcp.json and mcp/                     Codex-only local MCP companion and tests
plugins/programmable-v4-builder/       generated, byte-verified Codex plugin payload
scripts/verify-repository.mjs          complete local repository gate
```

The portable skill and root MCP files are canonical. Host manifests and the Codex marketplace payload are generated;
the payload mirrors canonical bytes and cannot redefine policy. The Claude marketplace is isolated to the canonical
Skill subtree and cannot package the root Codex-only MCP companion. See [Architecture](docs/ARCHITECTURE.md) for the ownership and upgrade boundaries and
[Portability and lifecycle](docs/PORTABILITY_AND_LIFECYCLE.md) for evidence-qualified host support.

[`programmable-registry`](https://github.com/0xprogrammable/programmable-registry) is the separate public application
ledger and project archive. The Builder reads it; project source remains in each builder's own public GitHub repository,
and the platform repository remains responsible for contracts and the Explorer.

## Verify from source

Node.js 20 or newer is required. The repository has no npm runtime or development dependencies.

```bash
npm test
gh skill publish --dry-run
```

The historical and current reference fee kernels additionally use Foundry:

```bash
cd skills/programmable-v4-hook-builder/assets/reference-kernels/programmable-volume-fee-v1
forge test
cd ../programmable-volume-fee-v2
forge test
```

Model-backed eval execution is deliberately separate because it requires an explicit provider credential and can cost
money. Structural eval validation is included in `npm test`; provider selection is supplied through the explicit
subject/judge provider contract rather than embedded in semantic cases or rubrics. No model result or credential is
committed. Provider-neutral definitions do not prove equivalent behavior across Codex, Claude Code, GitHub Copilot or
other hosts; cross-provider claims require separately authorized, versioned run receipts.

## Documentation

- [Use the Builder with an agent](docs/AGENT_SKILL.md)
- [GitHub application journey](docs/PUBLIC_GITHUB_PR_BETA.md)
- [Open-World V2 architecture](docs/OPEN_WORLD_V2_ARCHITECTURE.md)
- [Open-World V2 release gates](docs/OPEN_WORLD_V2_RELEASE_GATES.md)
- [Architecture and surgical change map](docs/ARCHITECTURE.md)
- [Knowledge routing and token efficiency](docs/KNOWLEDGE_SYSTEM.md)
- [Templates and extension model](docs/TEMPLATES_AND_EXTENSIONS.md)
- [Security and review model](docs/SECURITY_AND_REVIEW.md)
- [Security and audit readiness](docs/SECURITY_AUDIT_READINESS.md)
- [Code maturity snapshot](docs/CODE_MATURITY.md)
- [Uniswap source coverage](docs/UNISWAP_MASTER_SKILL_ADOPTION.md)
- [Programmable platform boundary](docs/PLATFORM_INTEGRATION.md)
- [Portability and lifecycle](docs/PORTABILITY_AND_LIFECYCLE.md)
- [Release process](docs/RELEASING.md)

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing knowledge, policy, templates, schemas, validators, or release
metadata. Security reports belong in [private GitHub vulnerability reporting](SECURITY.md), not a public issue.

Programmable v4 Builder is independent open-source software. Uniswap is a source protocol and ecosystem referenced by
the Builder; this repository does not claim affiliation with or endorsement by Uniswap Labs or Uniswap Foundation.
