# Builder and reviewer policy alignment

This is a non-normative consumer guide. The Builder and every reviewer must resolve the same protected
`0xprogrammable/submit-launch:main` policy and schema bytes described in
[approval-criteria.md](approval-criteria.md). Neither this file nor any Hookbuilder-local prose owns a Programmable
admission requirement.

## Shared contract

1. Bind the exact Submit Launch repository id, base commit, base tree, policy blob, schema blob, policy SHA-256, schema
   SHA-256, policy id, version, and selected enabled profile.
2. The Builder uses current Rule IDs to explain which central requirements it addressed. Universal v4 and EVM checks
   may improve the implementation, but they are not additional Programmable admission rules.
3. The reviewer evaluates only current central rules and returns Rule-ID-addressed results. It cannot invent a blocker,
   severity, evidence demand, outcome, or launch authority.
4. Missing or unavailable evidence remains unproved; it is not automatically an independently reproduced safety defect.
5. A changed policy or schema binding produces `POLICY_DRIFT`. Do not transfer a stale result to the new binding.
6. Build, canary, review, Registry intake, deployment, website eligibility, and production launch are separate states.
   Report only the state supported by the current policy and its evidence.

## Legacy V2 boundary

`prepare-pr` still produces the historical closed six-file V2 package. The policy binding stored in prepared metadata is
only a current drift anchor. It does not change those six files, evaluate them under the workflow-canary profile, or
grant audit, acceptance, deployment, routing, funds, or launch authority.

## Local engineering assets

Hookbuilder templates, fee kernels, scenario matrices, typed artifacts, and security references remain optional build
and review tools. They may describe or test implementation properties. They become relevant to Programmable admission
only when the exact current central policy names the corresponding rule and evidence.
