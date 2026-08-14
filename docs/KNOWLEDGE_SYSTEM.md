# Knowledge system and token efficiency

The Builder has substantial knowledge, but the agent receives it progressively. Repository size is not context size.

## Three knowledge domains

### Uniswap and EVM

The bundled source map covers v4 core and periphery mechanics, public hook patterns, SDKs, Universal Router, Permit2,
StateView, V4Quoter, PositionManager, subscribers, official launch components, deployment records, routing/discovery
boundaries, relevant Ethereum standards, Solidity, OpenZeppelin hooks and audit-scope limitations.

### Programmable

The Builder consumes current requirements only from the exact central Submit Launch policy and applicable Rule IDs. It
knows the frozen Fee V2 kernel, inclusive 10 bps economics, fee ownership, claim rules, and applicability model only as
optional legacy implementation knowledge selected by preserved intent or an applicable current Rule, never as a
universal requirement inferred from a pool or project graph. It also knows canonical positive `uint256` decimal-string
chain ids, positive decimal-string V3 application revisions without V1/SafeInteger semantics, separate fee/admin
authorities, supported evidence states, GitHub-only
application package, status journey, maintainer
review boundary, canonical project Registry, chain/runtime scope, provider-by-provider claims and future platform handoff
contract.

### Product construction and review

The Builder models contracts, apps, games, maps, services, indexers, keepers, wallets, metadata and external systems as
composable surfaces. It derives value flow, trust, authority, custody, exits, failure modes, tests, reproducibility,
public disclosures and review routes from the actual idea.

## Source hierarchy

Use the strongest available evidence for the claim being made:

1. exact protocol or application source, package bytes, compiler input and executable tests;
2. exact chain, address, runtime bytecode, immutable configuration and receipt for live claims;
3. official package release metadata, registry integrity and coherent dependency locks;
4. official documentation for intended interfaces and workflows;
5. official examples as research patterns;
6. third-party tutorials, indexers, scanners and provider responses only for their attributable scope.

No layer inherits proof from a weaker one. A current repository head is not a compatible package. Documentation is not
runtime. A successful simulation is not execution. An indexer record is not ownership. A Hooklist entry is not an audit
or router decision.

## Deterministic routing

`references/knowledge-routing.json` declares the eight modes and their capability and surface routes. The local command:

```bash
node skills/programmable-v4-hook-builder/scripts/cli.mjs context \
  --mode preflight \
  --template-plan path/to/programmable-template.json
```

The router validates the complete canonical catalog before selecting context. Every catalog capability and project
surface must occur in at least one explicit route; missing coverage fails closed with `KNOWLEDGE_ROUTING_INVALID`.
Genuinely new owner-defined capabilities remain eligible and continue to the open architecture path.

The model-evaluation harness has a separate closed `context-profiles.json` registry. Generic profiles cannot construct
or preload unregistered, archival, or exact legacy Fee V2 references; the dedicated `legacy-fee-v2` profile is reserved
for the single `transparent-high-fee-open-world` case. This controls deterministic eval prompt bytes, not production
model behavior or token use.

For a quick pre-materialization probe, repeat `--pack <catalog-pack-id>`; the router expands each visible pack id into
its canonical capabilities and project surfaces. On `context`, `--capability` may name either one exact known catalog
capability or a genuinely new owner-defined behavior: known ids receive their direct Lego receipts, while unknown ids
remain intact and route to architecture review. On `start` or `templates materialize`, `--capability` accepts only a
known catalog id and materializes that one Lego without its source pack or sibling behavior. Use
`--custom-capability id='Visible label'` for an unlisted behavior in a materialized plan.

Run `context --help` to list every selectable capability, surface and pack id. Internal route-family names are shown
separately with their exact selectable ids; passing one as a project id returns typed non-adverse guidance instead of
silently treating it as a novel product. A genuinely new kebab-case capability remains owner-defined and eligible.

Select inputs from confirmed semantic intent. Never infer an ordinary launch, token, fee, hook, pool, or V1 workflow
from one prompt word. Explore and Autopilot start only from the compact business-system compiler; intent, surface,
protocol, fee, security, template, and specialist chapters stay deferred until their exact triggers become true.
Historical workflow chapters remain reserved for an explicit V1 recheck or migration.

returns:

- exact `loadNow` files with selection reasons;
- conditional `loadLater` files;
- selected and unknown capabilities and surfaces;
- exact direct-capability Lego receipts bound to the catalog definition hashes without expanding sibling pack behavior;
- the strongest standard, custom or architecture review route inherited from selected packs;
- a profile digest bound to `SKILL.md`, the routing contract, selected reference bytes, deferred plan, and canonical
  template source receipt including its `selectionDigest`;
- byte and estimated-token totals for both the selected files and the canonical context-command JSON envelope; and
- confirmation that no network was used and no automatic adverse decision occurred.

The cold-start target is 4,000 estimated tokens using `ceil(UTF-8 bytes / 4)`; a standard pre-code architecture package
must remain at or below 8,000. Totals include `SKILL.md`, selected references, and the self-measured canonical context
command output. This is a reproducible routing budget, not a model-tokenizer or safety claim. Required later context is
never dropped: a package above the 4,000 cold target reports `expanded-required-context`, and the agent loads each
triggered chapter only when its phase needs it.

Measured representative routing from the historical stable v0.5.1 files:

| Profile | Estimated tokens | Initial selection |
| --- | ---: | --- |
| Cold Explore, no capability | 3,672 | `SKILL.md` plus compact business-system compiler |
| Cold Autopilot, no capability | 3,729 | same compact compiler; build and specialist context deferred |
| Mode-only Preflight | 5,783 | compact open-world workflow; capability chapters deferred |
| Mode-only Prototype | 6,114 | compact open-world workflow; security, surfaces, protocol, upstream, and toolchain records deferred |

The last two are standard architecture packages below 8,000 and intentionally report expanded context relative to the
4,000 cold target. Confirmed capabilities add deferred routes with explicit triggers instead of bulk-loading protocol,
fee, SDK, runtime, or provider corpora.

Large schemas, deployment maps, the 2026-08-07 observed upstream snapshot, and the Builder toolchain lock are processed
or loaded only when the exact field, dependency, compiler/EVM profile, deployment, license, drift, or reproducibility
question exists. The project compiler and composition checker process typed ProjectSpec, graph, repository-plan,
checkpoint, and component contracts without placing their complete schemas in model context.

An old template plan can still be inspected as labeled historical input, but it receives architecture review and does
not inherit current-catalog claims. `build-profiles.md` remains deferred until a prototype needs a deterministic
language/toolchain profile. The `legacy-v1-reproduction` archival group is excluded from ordinary routing and may be
loaded only to reproduce, recheck, or migrate an explicitly identified V1 application.

Deterministic routing is host-neutral evidence; it does not prove identical model interpretation. The configured
repository-evaluation harness can run encrypted sealed-after-design prompts in fresh repositories, reveal judging data
only after subject stages, repeat frontier/mid/small tiers, and record repository stages plus provider-reported token
use, retries, tool errors, questions, and manual intervention. No real provider matrix has been run, the corpus is not
an independently novel blind holdout, and local same-UID execution is not a trusted sandbox. Those states remain
`EXTERNAL_BLOCKED`, never a pass; separate versioned and independently verifiable receipts remain mandatory before any
cross-provider claim.

Project discovery is a separate bounded read, not another preloaded knowledge chapter. More than 20 requested Registry
ids returns a deterministic, content-complete split-review plan before any record or network fetch. The live client reads the small
canonical search index first and fetches one full hash-bound record only for `show` or `compare`. It pins the Registry's
numeric repository id, commit and tree, rejects silent redirects and oversized responses, and never treats Registry
text or similarity as agent instruction, approval, audit evidence or a novelty gate. The bundled snapshot is used only
when explicitly requested or explicitly allowed as a labeled fallback.

## Upgrade loop

Upstream refreshes are review tasks. The drift checker observes public metadata without changing the package. A
maintainer reads source and release diffs, selects one coherent candidate set, updates the observed snapshot, runs all
invalidated tests, records compatibility and migration impact, and changes the tested baseline only in a new release.

Provider-advisory receipts follow the same non-mutating rule but are separately date-pinned. The Chainlink and ETHSkills
receipt observed exact bytes at `2026-08-13T07:10:57Z`; it makes no current or latest claim. Any refresh requires a new
content-addressed receipt, renewed license/no-copy review, and the tests invalidated by the selected facts.

The exact research snapshot and adopted lessons are recorded in
[`UNISWAP_MASTER_SKILL_ADOPTION.md`](UNISWAP_MASTER_SKILL_ADOPTION.md).
