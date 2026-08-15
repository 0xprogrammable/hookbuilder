# Releasing

Releases are immutable supply-chain events, not documentation edits.

## Current identities

- Current release-package and installation identity: `v0.9.3`. Treat it as public only after the exact tag, GitHub
  release and installed bytes are verified.
- Bundled lifecycle reports retain `publicationStateVerified: false`; source identity alone is not a published or live
  state assertion.
- Prior immutable releases: `v0.9.2`, `v0.9.1`, `v0.9.0`, `v0.8.0`, `v0.7.0`, `v0.6.0`, and `v0.5.1`.
- Canonical version authority: `config/plugin.json`. `package.json`, `package-lock.json`, the portable runtime constant,
  MCP identity, generated plugin manifests, marketplaces, and the release-planning template are mirrors. The
  repository and plugin checks fail on version drift.

Never change the immutable `v0.5.1`, `v0.6.0`, `v0.7.0`, `v0.8.0`, `v0.9.0`, `v0.9.1`, or `v0.9.2` tags, release notes, assets, or changelog sections after publication.
Future work must use a new version and preserve released package bytes.

## Versioning

- Patch in the pre-1.0 line: backward-compatible corrections or optional additive capabilities with no newly required
  input for an existing workflow and no incompatible capability contract.
- Minor in the pre-1.0 line: a new capability baseline or submission-standard migration that intentionally advances
  the supported feature line while preserving documented migration behavior.
- Major: incompatible agent, schema, policy, application or trust-contract change.
- Security hotfix: separately labeled minimal fix with affected-version and advisory evidence.

There is no minimum interval between Builder releases. Publish whenever the exact candidate, owner authority, required
review and CI, immutable tag and artifacts, and post-publication verification are complete. Release history remains an
input for monotonic version checks, provenance, and exact public identity; it never creates a waiting period.

## Candidate gates

1. Freeze the intended source and complete change set privately.
2. Review upstream drift and exact licenses.
3. Confirm version, schema, fee-policy and migration semantics.
4. Run the fast `npm test` repository gate and the Agent Skills publish dry run.
5. Run both reference kernels through dependency installation, format, build, unit, 10,000-run fuzz, extended invariant,
   gas-report and pinned Slither checks. The release gate records exact commands, effective invariant environment, tool
   versions and stdout/stderr hashes; normal development tests do not claim this evidence.
6. Run the real repository-E2E matrix across the named model tiers with an independent judge and require a hash-bound
   `PASS` scorecard for the exact commit, tree and skill tree. Unavailable provider evidence remains `EXTERNAL_BLOCKED`.
7. Run subjects and every generated-repository stage in a trusted separate-UID or container sandbox.
8. Evaluate a comparable public repository-E2E population, an independently created novel holdout and an immutable
   prior-release comparator.
9. Execute every fork-dependent case against a pinned fork RPC.
10. Install the package for Codex, Claude Code and at least one additional Agent Skills host, then invoke each supported
    host from natural-language intent through repository generation and submission with a versioned receipt. Package
    placement alone is not behavioral evidence.
11. Generate checksums, package manifest, SBOM, release notes and known-limitations record.
12. Obtain exact owner release authority for the frozen candidate.
13. Use the contributor identity for the candidate branch, fork push and pull request. After required checks, a separate
    current CODEOWNER uses the Programmable maintainer identity to review the exact head, approve, squash-merge, create
    the protected tag and publish the GitHub release. Then re-install from the public tag and compare the installed tree.

## Public commands

Run the local infrastructure and packaging rehearsal:

```bash
candidate_output=/absolute/path/to/programmable-v4-builder-v0.9.3-candidate
npm run release:candidate -- --tag v0.9.3 --output-dir "$candidate_output"
```

The `release:candidate` name is retained for CLI compatibility. A successful run is not a release-candidate verdict.
This command requires a clean committed worktree. It runs the complete repository gate; the mandatory V1 and V2
kernel campaign (`npm ci --ignore-scripts`, Forge 1.7.1 format/build/unit, 10,000 fuzz runs, 1,000 invariant runs at
depth 256, a unit-path gas report and Slither 0.11.5); the Agent Skills publication dry run; ordinary and unknown-idea routing
canaries; clean project-scope installations for Codex, Claude Code and GitHub Copilot; and installed-package
verification. Package installation may use the configured npm network or cache. It then generates the release artifact
set twice and requires identical filenames, byte counts, SHA-256 digests and bytes. It writes only to the new absolute
output directory and performs no external write.

The two routing canaries are CLI context and preflight checks, not trade execution. Separate repository tests enforce
that `no-market` projects emit no route and that each tradable market selects either standard Uniswap v4 or the
canonical Programmable adapter contract. Static Project Compiler fixtures validate legacy receipt/result bindings but
execute no candidate bytes and remain `NOT_PROVEN`; reference-kernel Forge evidence remains a separate local
`PARTIAL_EVIDENCE` lane. Every manifest remains `NOT_APPROVED`; none of these are a provider quote, pinned-fork
receipt, deployed-market execution, host invocation, broadcast transaction or approval.

The output contains `local-release-verification.json`, `kernel-release-evidence.json` and an `artifacts/` directory.
The artifact set embeds the exact kernel evidence and its digest. The SPDX 2.3 SBOM names both V1 and V2 kernel
packages, binds each exact lockfile digest and attributes dependency relationships to the kernel that contains them.
Review the receipts before asking for release authority. The compatibility-named `local-release-verification.json`
records `LOCAL_INFRASTRUCTURE_AND_PACKAGING_REHEARSAL_VERIFIED`, `releaseCandidate: false`, and stable publication as
`NOT_PUBLISHED`. It cannot become release-candidate evidence without a hash-bound `PASS` scorecard for the same commit,
tree, and skill tree from real repository-E2E runs. Such a scorecard is necessary but not sufficient: every other
release blocker must also be independently closed for the same immutable revision.

The receipt records these gates as `EXTERNAL_BLOCKED`: real named model tiers and an independent judge; a trusted
separate-UID or container sandbox; a comparable public repository-E2E population; an independently created novel
holdout and immutable prior-release comparator; a pinned fork RPC for fork-dependent cases; and installed-host
natural-language-to-repository-and-submission runs. Owner authority, public CI and tag canaries, Registry activation,
deployment, signature-flow evidence, deployed-address evidence, and independent security review also remain deferred.
The three clean installations are package-placement canaries, not host-trigger or behavioral evidence. Cursor and
ChatGPT are not exercised by this command; use the support vocabulary in
[`PORTABILITY_AND_LIFECYCLE.md`](PORTABILITY_AND_LIFECYCLE.md).

The rehearsal accepts an optional absolute external-evidence bundle only together with an operator-selected policy
digest. The digest can bind signatures to the supplied policy, but it is not an independent trust root. No authority
policy is independently pinned today, so caller-supplied evidence reports `VALID_UNTRUSTED_POLICY`,
`CALLER_SUPPLIED_UNESTABLISHED`, and `independenceEstablished: false`; all six external gates remain
`EXTERNAL_BLOCKED` and `releaseCandidate` remains false. A future trusted path requires a separately reviewed policy
pin that is unavailable to the candidate bundle and adjacent command-line arguments.

When a shared maintainer host cannot provide stable resources, dispatch `.github/workflows/release-rehearsal.yml` on
protected public `main`. The workflow derives the tag from the checked-in version authority, verifies the exact
dispatched commit and remote `main`, runs the same complete command, and uploads the whole output with compression
disabled. Its repository token is read-only and checkout credentials are not persisted, so a successful run still has
no tag or release publication authority. Download the run artifact, verify its receipts and file digests, and bind any
later publication to that exact commit and output.

The repository gate also verifies the generated Codex marketplace payload against the canonical Skill and MCP bytes and
runs the MCP protocol suite. Those checks do not install the plugin into Codex's cache or prove host startup. Claude's
marketplace entry is isolated to the canonical Skill subtree and cannot package the root Codex-only MCP companion; its
root manifest remains format metadata rather than that marketplace entry's source.

For a focused developer diagnosis, select a kernel and check explicitly:

```bash
focused_evidence=/absolute/new/path/focused-kernel-evidence.json
node scripts/verify-repository.mjs \
  --kernel-evidence-out "$focused_evidence" \
  --kernel v2 \
  --kernel-check build
```

Any `--kernel` or `--kernel-check` selection is recorded as focused and is never release eligible, even when it passes.
The dependency-install check is added automatically as a prerequisite for any focused kernel check. Kernel commands run
in isolated temporary copies, which are removed afterward; their evidence records the canonical logical source path and
the isolated execution mode. The local rehearsal command has no skip or focused mode.
`PROGRAMMABLE_RELEASE_KERNEL_TIMEOUT_MS` may change only the per-command timeout (default 1,200,000; allowed 1,000 to
3,600,000 milliseconds); it cannot weaken or omit a release check.

After the exact candidate is committed, merged to protected `main`, verified by post-merge CI and authorized for
publication, create one immutable GitHub release. Run the Skill publication validation without letting it push or
create a mutable release:

```bash
release_tag=v0.9.3
gh skill publish --dry-run
test "$(git rev-parse HEAD)" = "$(gh api repos/0xprogrammable/hookbuilder/commits/main --jq .sha)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"

gh api --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/0xprogrammable/hookbuilder/immutable-releases
test "$(gh api repos/0xprogrammable/hookbuilder/immutable-releases --jq .enabled)" = true

git tag -a "$release_tag" HEAD -m "Programmable v4 Builder $release_tag"
git push origin "refs/tags/$release_tag:refs/tags/$release_tag"

gh release create "$release_tag" "$candidate_output"/artifacts/* \
  --repo 0xprogrammable/hookbuilder \
  --verify-tag \
  --fail-on-no-commits \
  --title "Programmable v4 Builder $release_tag" \
  --notes-file docs/releases/v0.9.3.md \
  --latest

gh release verify "$release_tag" --repo 0xprogrammable/hookbuilder
for asset in "$candidate_output"/artifacts/*; do
  gh release verify-asset "$release_tag" "$asset" --repo 0xprogrammable/hookbuilder
done
```

The artifact generator refuses a dirty worktree, requires a complete release-eligible kernel evidence file for the exact
commit/tree/skill tree and both exact lockfiles, and writes outside the repository. It produces a deterministic skill
archive, file-level SHA-256 manifest, provenance-aware SPDX 2.3 SBOM, embedded kernel evidence, release-state receipt
and `SHA256SUMS`. GitHub release immutability applies to the newly published release and its uploaded artifacts; it
does not retroactively change historical releases. Neither publication nor verification proves that CI, marketplace
discovery, a platform deployment or any project built with the skill is live; verify each state separately.

The manifest and release receipt bind both the complete repository tree and the exact portable skill subtree. This lets
an installer or reviewer distinguish a repository-level documentation change from a change to installed skill bytes.

The archive filename is versioned, while its single top-level directory remains exactly
`programmable-v4-hook-builder/` so an extracted artifact still satisfies the Agent Skills package identity. Verify the
checksums, extract into a fresh directory, and run the extracted `scripts/verify-skill.mjs --installed` before upload.

Prepare any versioned announcement only after the post-publication checks below pass; no announcement is part of the
release build.

## After publication

- Resolve the release and tag to the intended commit.
- Verify GitHub release assets, checksums and source archive.
- Install the exact newly published tag into clean temporary targets for supported hosts.
- Run the installed package verifier and one ordinary plus one novel dry-run journey.
- Confirm repository topics, README links, CI, security reporting and release visibility.
- Record exact failures or unavailable external evidence without weakening the release claim.
