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

Run these two gates sequentially. Wait for `npm test` and all of its verifier subprocesses to exit before starting
`gh skill publish --dry-run`; do not overlap either gate with another `verify-skill` or publication dry-run. If a gate
is interrupted, confirm that none of its verifier subprocesses remain before retrying.

Keep boundary tests proportional to the behavior under test. Do not materialize one filesystem file, Git blob, or
subprocess per limit element when a synthetic input, shared blob, compact Git object tree, or batched worker proves the
same contract. Preserve at least one real integration path, and benchmark any changed test that takes more than five
seconds before adding more work to it.

Repository-shape checks must ignore operating-system metadata already excluded by `.gitignore`, including `.DS_Store`,
at every depth. Host metadata is not product structure and must not invalidate a completed test run.

Treat provider requests as a finite user resource. Every external workflow must have a tested operation-wide physical
request budget that includes retries. Batch or operation-scope-cache content-addressed immutable reads; never cache the
live refs, permissions, pull requests, reviews, checks or other moving state used for race and authority decisions.
Do not add one provider request per source file when a bounded batch or explicit split-review route can prove the same
contract. For public GitHub source bytes, prefer one isolated exact-commit filtered Git fetch plus local batched object
verification over REST `contents` calls per path; an archive alone is not proof of Git modes or object identity.

When Solidity or the fee policy changes, also run the pinned formatter, compiler, unit, fuzz, invariant, static-analysis
and reference-kernel Foundry checks required by the changed model. Model-backed evals need explicit credential and cost
authority; never fabricate their result.

## External boundaries

Do not sign, broadcast, deploy, push, publish, open or update a pull request, merge, tag, release, change an account, or
submit to an external provider without explicit authority for that exact action. Local tests do not approve their own
work. Never read or commit wallet material, credentials, browser profiles, unrelated environment files, or generated
model results.
