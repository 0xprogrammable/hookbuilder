# Agent contribution contract

This repository is one product: the Programmable v4 Builder. Preserve its portable, evidence-first and open-ended
design.

## Source ownership

- `skills/programmable-v4-hook-builder/` is the canonical installed package.
- `SKILL.md` is the small operating contract. Put detailed knowledge in a routed reference, not in the entry file.
- `references/knowledge-routing.json` owns progressive context selection.
- `assets/starter-catalog/catalog.json` owns hash-bound starter and capability composition. Templates are accelerators,
  never an allowlist.
- `references/submission.schema.json` owns machine shape; validators own semantic gates.
- `config/plugin.json` owns neutral host metadata. Regenerate manifests; do not hand-edit generated plugin JSON.
- `evals/` tests agent behavior. Unit and integration tests remain separate executable proof.

## Change discipline

Inspect before editing and preserve unrelated work. Make the smallest coherent change at the owning layer, then update
every derived hash, schema example, validator, test, documentation and migration that the change invalidates. Never
rewrite a historical tag or frozen evidence bundle.

Unknown ideas stay eligible and enter architecture review. Do not turn a catalog, keyword matcher, provider list, or
automated security finding into a product-category ban. Hard conflicts require concrete unsafe behavior, not novelty.

Official branches, docs, package tags and deployment feeds can drift. Record exact revisions and integrity, keep
observed heads separate from tested compatibility profiles, and never promote an address or provider state without
runtime evidence.

## Required local checks

Run before requesting review:

```bash
npm test
gh skill publish --dry-run
```

When Solidity or the fee policy changes, also run the pinned formatter, compiler, unit, fuzz, invariant, static-analysis
and reference-kernel Foundry checks required by the changed model. Model-backed evals need explicit credential and cost
authority; never fabricate their result.

## External boundaries

Do not sign, broadcast, deploy, push, publish, open or update a pull request, merge, tag, release, change an account, or
submit to an external provider without explicit authority for that exact action. Local tests do not approve their own
work. Never read or commit wallet material, credentials, browser profiles, unrelated environment files, or generated
model results.
