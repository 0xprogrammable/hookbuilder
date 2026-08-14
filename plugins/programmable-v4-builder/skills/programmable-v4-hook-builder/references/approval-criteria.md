# Submit Launch policy consumer guide

This file is non-normative. It contains no Programmable admission rule and cannot approve, reject, audit, deploy, route,
or launch a project.

The authored Programmable launch requirements are the exact protected policy bytes at
`0xprogrammable/submit-launch:main`. The adjacent schemas define the policy and binding shapes:

- `policy/launch-policy.v1.json`
- `policy/schemas/launch-policy.v1.schema.json`
- `policy/schemas/launch-policy-binding.v1.schema.json`

Resolve the fixed repository by numeric id `1320171831`, bind its exact default-branch commit and tree, read the policy
and schema as regular Git blobs, validate the policy against those schema bytes, and record the closed policy binding.
Never accept caller-selected policy bytes, repository, branch, path, profile, rule severity, evidence, or outcome.

Use the profile selected by the public workflow. Every Programmable-specific finding must cite a current Rule ID from
the resolved policy. A local document, prompt, template, fee kernel, test, or model opinion may help build or explain an
implementation, but cannot add an admission requirement. If the protected policy or schema binding changes while work
is open, stop with `POLICY_DRIFT` and evaluate the current bytes again.

The existing six-file V2 `prepare-pr` package remains a frozen historical transport. Its attached workflow-canary
binding is a drift anchor only; it does not reinterpret that package as a canary result, launch approval, audit, or
production authorization. The workflow-canary application path is a separate contract exposed only through the
bounded local [`prepare-canary` client](workflow-canary-application.md), never through legacy `prepare-pr`.

General Uniswap v4, EVM, compiler, testing, accounting, and secure-coding guidance remains useful engineering knowledge.
Local fee policies, fee kernels, typed review artifacts, and templates are optional implementation assets. Select them
only when project intent or the current central policy requires their behavior, and never treat their presence as
Programmable admission authority.
