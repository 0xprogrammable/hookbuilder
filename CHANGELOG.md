# Changelog

All notable Builder changes are recorded here. Historical releases remain immutable.

## 0.4.3 - 2026-08-11

### Fixed

- Preserve the exact two-paragraph Git commit message used by the confirmed draft-application transport instead of
  rejecting its line-feed separator before the GitHub request.
- Encode the exact base-to-fork comparison as one safe GitHub API segment so an interrupted submission can verify and
  resume its existing application branch without relaxing the endpoint traversal guard.
- Retry only the transient 404 returned while GitHub propagates an already verified fork branch to draft creation,
  with bounded attempts, exact branch and duplicate checks, and immediate failure for every other response.
- Cover the current GitHub Git Database commit response shape and retain strict rejection of carriage returns,
  invisible control characters, oversized messages, duplicate pull requests, ambiguous recovery branches, approval,
  merge, deployment and launch.

### Preserved

- The explicit two-step external-write confirmation and draft-only Submit a Launch boundary.
- Submission standard `1.5.0`, application schema `1.0.0-beta.1`, fee policy `1.1.0`, and every historical release.

## 0.4.2 - 2026-08-11

### Changed

- Route the six-file GitHub application to [`0xprogrammable/submit-launch`](https://github.com/0xprogrammable/submit-launch)
  and bind its unchanged numeric repository id `1320171831`.
- Use the canonical `<builder>/submit-launch` fork for the two-step draft submission and update flow.
- Tell agents to build and check the project before preparing the application, and to perform the public GitHub write
  only after the builder explicitly authorizes it.

### Preserved

- Submission standard `1.5.0`, application package shape, fee policy `1.1.0`, and every historical release and
  snapshot record.
- The boundary that Hookbuilder cannot approve, merge, deploy, sign, launch, or mark a draft ready for review.

## 0.4.1 - 2026-08-11

This tag was withdrawn from use because the publication tool created it from the default branch instead of the frozen
maintenance commit. It must not be installed or used as submission evidence.

## 0.4.0 - 2026-08-02

### Added

- Deterministic minimum-sufficient knowledge router with mode, capability, surface and template-plan profiles.
- Direct catalog-pack routing that expands public pack ids without misclassifying them as novel capabilities.
- Compact protocol-mechanics, liquidity/state, hook-Lego and v4 SDK integration references.
- Swap-client and liquidity-position starters plus active-liquidity, external-liquidity, idle-yield, subscriber and
  wrapped-asset capability packs.
- Submission standard 1.5 SDK safety profile, including root-only imports, executable hooked quotes, explicit router
  generation, per-hop hookData and price bounds, current slippage semantics, and deprecated liquidity-action exclusion.
- Adversarial evals for hooked local quotes, router/hookData drift, sandwich-vulnerable liquidity actions, subscriber
  fee inflation/liveness, and blind calldata/Permit2 signing.
- Standalone repository, neutral generated host manifests, public documentation, CI and release contract.
- Reproducible release archive, file manifest, SPDX SBOM and checksum generator.
- Slither CI, audit-readiness record and nine-category code-maturity snapshot.

### Preserved

- Open-ended architecture review for unknown ideas.
- Mandatory inclusive Programmable 10 bps fee policy 1.1.0.
- GitHub-only public application transport and strict separation of local, maintainer, deployment and provider states.

## Earlier versions

Earlier release records remain in the original Programmable repository. They are not rewritten or relabeled by this
standalone project.
