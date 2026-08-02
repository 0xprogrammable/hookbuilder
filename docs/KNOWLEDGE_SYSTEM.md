# Knowledge system and token efficiency

The Builder has substantial knowledge, but the agent receives it progressively. Repository size is not context size.

## Three knowledge domains

### Uniswap and EVM

The bundled source map covers v4 core and periphery mechanics, public hook patterns, SDKs, Universal Router, Permit2,
StateView, V4Quoter, PositionManager, subscribers, official launch components, deployment records, routing/discovery
boundaries, relevant Ethereum standards, Solidity, OpenZeppelin hooks and audit-scope limitations.

### Programmable

The Builder knows the mandatory inclusive 10 bps policy, fee ownership and claim rules, canonical-pool binding, project
and platform authority separation, supported evidence states, GitHub application package, status journey, maintainer
review boundary, chain/runtime scope, provider-by-provider claims and future platform handoff contract.

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

`references/knowledge-routing.json` declares the seven modes and their capability and surface routes. The local command:

```bash
node skills/programmable-v4-hook-builder/scripts/cli.mjs context \
  --mode preflight \
  --template-plan path/to/programmable-template.json
```

returns:

- exact `loadNow` files with selection reasons;
- conditional `loadLater` files;
- selected and unknown capabilities and surfaces;
- a profile digest;
- byte and estimated-token totals; and
- confirmation that no network was used and no automatic adverse decision occurred.

The initial target is 18,000 estimated tokens using the reproducible approximation `ceil(UTF-8 bytes / 4)`. This is a
routing budget, not a model-specific tokenizer claim. Required safety context may exceed the target and is reported as
`expanded-required-context`; it is never silently dropped to make a benchmark look better.

Representative v0.4.0 behavior:

| Profile | Initial selection |
| --- | --- |
| Explore with no concrete capability | intake, fee policy and template catalog |
| Ordinary launch preflight | about 17,000 estimated tokens |
| Three.js reward game | ordinary context plus runtime, service and trust boundaries |
| Swap and liquidity-position prototype | protocol, SDK, state, periphery, security and relevant surface chapters |
| Unknown idea | scenario, surface, Lego and security context with architecture review |

Large schemas, deployment maps and the full upstream source map are loaded only when the exact field, deployment,
dependency, license, drift or evidence question exists.

## Upgrade loop

Upstream refreshes are review tasks. The drift checker observes public metadata without changing the package. A
maintainer reads source and release diffs, selects one coherent candidate set, updates the observed snapshot, runs all
invalidated tests, records compatibility and migration impact, and changes the tested baseline only in a new release.

The exact research snapshot and adopted lessons are recorded in
[`UNISWAP_MASTER_SKILL_ADOPTION.md`](UNISWAP_MASTER_SKILL_ADOPTION.md).
