# Submit a Launch

Submit a Launch is the canonical public review path for new one-off Programmable projects.

The project stays in the builder's own public GitHub repository. Hookbuilder builds and checks it, then prepares an
exact six-file application for
[`0xprogrammable/submit-launch`](https://github.com/0xprogrammable/submit-launch), immutable GitHub repository ID
`1320171831`. Git commits, pull-request history, checks, and reviews provide the public record.

## Use the Builder

Give the installed Skill an idea or public repository and ask it to build, check, and prepare the application for
Submit a Launch. The supported journey is:

```text
doctor -> scaffold -> check -> package -> prepare-pr -> submit
```

`scaffold` is optional for an existing project. `prepare-pr` resolves and freezes the exact public source repository,
commit, tree, application package, and evidence without writing to GitHub.

`submit` and `update` are two-step operations. The first call returns a read-only action plan and confirmation digest.
Only a second call with that exact digest may create or update:

- the authenticated builder's fork of `0xprogrammable/submit-launch`;
- one application branch; and
- one draft pull request against `0xprogrammable/submit-launch:main`.

The transport never creates a ready-for-review pull request, enables maintainer edits, merges, approves, deploys,
signs, routes, or launches.

## Intake contract

Every write is bound to one canonical contract:

| Field | Value |
| --- | --- |
| Repository | `0xprogrammable/submit-launch` |
| Immutable GitHub ID | `1320171831` |
| Base branch | `main` |
| Application directory | `submissions/<application-id>/` |
| Status document | `docs/builder/intake-status.json` |
| Status schema | `2` |
| Pull-request state | Draft only |

The client reads the exact status document from the observed central commit before any write. `prelaunch`,
`paused-new`, and `paused-all` fail closed for a new application. `paused-new` permits only an exact trusted continuation
listed by the status document. A central-branch or status change invalidates the confirmed plan.

Do not hand-create an application pull request. The generated six-file package and exact draft transport are part of
the contract.

## Application identity

Repository names, branches, and tags are navigation aids. Review identity is built from immutable values including the
numeric source repository ID, full commit, root tree, package bytes, and declared evidence. A changed source commit or
tree is a new review target.

The pull request requests review only. A local check, valid package, green GitHub check, review comment, or merged
record does not prove safety, approval, deployment, provider support, tradability, or launch authorization.

## Hookbuilder legacy continuations

Hookbuilder is not open for new Applicant pull requests. The only legacy continuations are pull requests #10, #11,
#12, #14, #15, #18, #19, and #20. Their existing files and history remain available for their original review threads;
they must target Hookbuilder `main` and do not define the route for a new application.

Every new one-off application goes to Submit a Launch through the Builder. Template intake is separate and is not
opened by this contract.

A trusted-base Hookbuilder check immediately redirects a new `submissions/requests/*.json` pull request. That
path-filtered check is early feedback and also rejects Applicant changes targeting `release/*`; the protected
`Applicant gate` on `main` remains the authoritative merge boundary.
