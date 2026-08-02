# Releasing

Releases are immutable supply-chain events, not documentation edits.

## Versioning

- Patch: compatible corrections with no new required project field or capability contract.
- Minor: backward-compatible features, templates, routes or new submission-standard migration.
- Major: incompatible agent, schema, policy, application or trust-contract change.
- Security hotfix: separately labeled minimal fix with affected-version and advisory evidence.

Normal public Builder releases are bundled no more than once in a rolling 24-hour window. Private work may continue at
any time. The cadence calculation never proves authority, privacy, completeness or readiness.

## Candidate gates

1. Freeze the intended source and complete change set privately.
2. Review upstream drift and exact licenses.
3. Confirm version, schema, fee-policy and migration semantics.
4. Run `npm test` and the Agent Skills publish dry run.
5. Run changed-language format, build, static, unit, fuzz, invariant, fixture/fork, size and performance checks.
6. Run or explicitly defer model-backed evals; never call structural validation a model pass.
7. Verify local installations for Codex, Claude Code and at least one additional Agent Skills host.
8. Generate checksums, package manifest, SBOM, release notes and known-limitations record.
9. Obtain exact owner release authority for the frozen candidate.
10. Commit and push with the Programmable identity, create the protected tag and GitHub release, then re-install from the
    public tag and compare the installed tree.

## Public commands

Validation only:

```bash
npm test
gh skill publish --dry-run
```

After the exact candidate is committed, pushed and authorized:

```bash
gh skill publish --tag v0.4.0
```

The release command may add the `agent-skills` repository topic and create a GitHub release. It does not prove that CI,
marketplace discovery, a platform deployment or any project built with the skill is live; verify each state separately.

## After publication

- Resolve the release and tag to the intended commit.
- Verify GitHub release assets, checksums and source archive.
- Install `programmable-v4-hook-builder@v0.4.0` into clean temporary targets for supported hosts.
- Run the installed package verifier and one ordinary plus one novel dry-run journey.
- Confirm repository topics, README links, CI, security reporting and release visibility.
- Record exact failures or unavailable external evidence without weakening the release claim.
