# Application compatibility and migration

Use this reference when selecting an application adapter or continuing a legacy Submit a Launch application. The normal
journey discovers the contract automatically and uses `submit-project`.

## Discover, do not assume

Resolve the application contract from the same Current Contract Snapshot as the central policy. Active Contract V2
binds Applicant Compatibility V2, which declares:

- one `current` application contract and its required source artifacts;
- accepted `legacy` contracts;
- the schemas and validator closure for each declared contract; and
- the exact compatibility identities and digests.

Do not choose an application version from Hookbuilder prose, a filename in applicant source or a remembered release.
Never combine the current application contract with policy or schemas from another Submit a Launch revision.

## Current path

The current official-route path is:

```text
Application V3.2
  -> Submission 2.1
  -> route-specific current artifacts
  -> exact public source closure
  -> protected Draft validation
```

The application declares the route honestly:

| Route | Current treatment |
| --- | --- |
| No market | No market or route artifact is invented. |
| External | Eligible without official Programmable route or label evidence. |
| Unresolved | Eligible as a Draft while route-dependent readiness stays pending. |
| Official Programmable Ethereum | Uses the current source, route and launch-readiness contracts declared by Compatibility V2. |

The application contract carries project and route evidence. The central policy remains the sole owner of launch
requirements. Application fields must not become a second policy or caller-selected exemption.

## Legacy V3.1

Application V3.1 remains accepted only as a declared legacy compatibility input. Existing and new V3.1 Drafts retain
their original validation semantics. They do not inherit V3.2 fields, the official Programmable route or launch
readiness.

Do not rewrite a V3.1 application, submission, source binding or report to resemble V3.2. Historical bytes and decisions
remain attached to their original revision.

## Move a legacy application forward

When a V3.1 project needs the current official route:

1. Preserve the prior application and every bound report unchanged.
2. Resolve a fresh Current Contract Snapshot.
3. Create a new V3.2 application revision from the same or newer exact public source.
4. Bind the V3.1 predecessor through explicit schema-migration lineage.
5. Add only the current artifacts required by the verified project and route.
6. Validate and submit the new revision through `submit-project`.

The new revision receives its own Stage Plan, evidence and review. It does not retroactively change the outcome of the
legacy revision.

## Adapter boundary

Hookbuilder may implement versioned adapters only for contracts declared by the resolved compatibility manifest. An
adapter translates existing project evidence into that contract without inventing product facts, tests, route state or
authority.

If Applicant Compatibility declares an unknown application major version:

- keep the project and unrelated local work eligible;
- return `SUBMIT_LAUNCH_CONTRACT_UNSUPPORTED` for the `submit` stage;
- mark that stage `INTEGRATION_PENDING`;
- perform no Draft write; and
- add a reviewed versioned adapter before retrying.

Do not guess field mappings or fall back silently to a legacy version.

## Independent builders

Hookbuilder is one consumer of this contract, not an admission gate. A project built independently may create the same
current application package and submit it through the public Submit a Launch path. It must satisfy the same protected
schemas, source bindings and review boundaries.

## Authority boundary

Compatibility means only that a package can enter protected review under the declared contract. It does not establish
safety, audit, approval, deployment, route activation, promotion, provider adoption or launch authority.
