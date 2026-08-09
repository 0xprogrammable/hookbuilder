# Contributing

Contributions are welcome when they make the Builder more accurate, composable, efficient, testable, or portable
without weakening its evidence boundaries.

Submitting a hook, template, or model for review is a different path. Follow the
[Applicant beta guide](docs/PUBLIC_GITHUB_PR_BETA.md), add or update exactly one JSON request under
`submissions/requests/`, and use the Applicant pull-request template. Do not mix Applicant data with a Builder code
change.

## Start with the owning layer

| Change | Canonical location |
| --- | --- |
| Agent operating behavior | `skills/programmable-v4-hook-builder/SKILL.md` |
| Detailed protocol or platform knowledge | `skills/programmable-v4-hook-builder/references/` |
| Context selection | `references/knowledge-routing.json` and router tests |
| Reusable planning block | `assets/starter-catalog/` and catalog tests |
| Applicant submission field | `submissions/schema/`, validator, example, tests and migration |
| Deterministic tool | `scripts/` plus its test |
| Agent behavior regression | `evals/` with a binary safety rubric when applicable |
| Host metadata | `config/plugin.json`, then `npm run plugin:write` |

Do not duplicate a rule into several prose files as independent truth. Link to the canonical contract and keep summaries
clearly subordinate.

## Pull-request standard

1. Explain the exact problem and source evidence.
2. Keep observed upstream drift separate from a tested dependency upgrade.
3. Include tests that fail before the repair and pass after it.
4. State every check run and every check not run.
5. Call out schema, migration, compatibility, security, token-budget and public-copy effects.
6. Do not include credentials, wallet secrets, generated model results or unrelated formatting.

Run:

```bash
npm test
gh skill publish --dry-run
```

Changes to Solidity, economics, authority, custody, deltas, settlement, signing, deployment, routing or release trust need
the stronger model-specific evidence and accountable review described in the skill.

## Source and license

Prefer links and exact pins over copied upstream prose or code. Verify the effective license at file level. Preserve
notices for material that is legally reused. A tutorial, repository head, audit report, generated scaffold or provider
response does not confer compatibility, audit coverage, deployment identity or approval.
