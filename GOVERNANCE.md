# Governance

Programmable maintains the canonical Builder, accepts contributions, and owns release decisions. The software remains
open source; maintainer control does not turn a Builder result into an audit or automatic project approval.

## Decision boundaries

- Builders own product intent, economics beyond the mandatory platform share, custody choices and publication consent.
- The Builder derives reversible technical defaults and objective findings but cannot approve itself.
- Programmable maintainers accept or request changes for one exact project revision and evidence set.
- Deployment, runtime verification, provider support and public activation require separate accountable evidence.
- Upstream Uniswap and OpenZeppelin projects own their protocol, packages, releases and policies; this repository records
  observations and compatible pins without speaking for them.

## Releases

Normal improvements are bundled into versioned releases rather than silently changing existing users. Protected tags
and artifacts are immutable. A release records its source commit, tree, package bytes, checksums, SBOM, eval state,
known limitations and migration impact. Security hotfixes are clearly labeled and narrowly scoped.

The public changelog is a summary. Machine-readable source, schema, policy and evidence records remain authoritative.
