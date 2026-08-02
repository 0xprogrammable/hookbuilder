# Security policy

## Report privately

Do not open a public issue for a vulnerability, exploitable Builder bypass, fee-policy defect, malicious-package path,
credential exposure, unsafe signing path, or unpublished security-sensitive finding.

Use this repository's **Security** tab and choose **Report a vulnerability**. Include:

- affected release and exact commit;
- impacted files and behavior;
- a minimal reproduction or test;
- plausible impact and preconditions; and
- whether the issue is already public or exploited.

Do not include real private keys, seed phrases, access tokens, production secrets, or user funds in a reproduction.

## Scope

In scope are the portable skill, deterministic tools, schemas, templates, reference kernel, context router, package and
GitHub application boundaries, plugin manifests, release tooling, CI, and this repository's supply chain.

Third-party protocols, wallets, providers, agents, GitHub, Uniswap deployments, builder projects and the live
Programmable platform have their own security contacts. A report here may still be useful when this Builder caused or
failed to detect the integration defect.

## Release handling

Maintainers reproduce the issue, assess affected immutable versions, prepare the smallest private fix, run the complete
invalidated gates, and publish an advisory with a fixed release when evidence is sufficient. A critical hotfix may use
the documented exception path; it still requires exact release authority and does not rewrite old tags.

No response-time, bounty, safety, audit, or remediation guarantee is implied by this policy.
