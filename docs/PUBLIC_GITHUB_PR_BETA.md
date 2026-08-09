# Public applicant submission beta

Programmable accepts beta review requests as pull requests to
[`0xprogrammable/hookbuilder`](https://github.com/0xprogrammable/hookbuilder). This is the canonical Applicant
repository, GitHub repository ID `1320085947`. The public pull-request transport requires no GitHub App credential.

The source code stays in the applicant's public GitHub repository. One small JSON request pins the applicant's GitHub
login and intended launch wallet, exact source repository ID, commit, root tree, hook/template/model versions,
permissions, fee terms, and requested route.

## What is live in this repository

This repository contains the public contract, example, offline validator, and Applicant pull-request template. A valid
request can enter review. It does not approve, register, deploy, sign, route, or launch the project.

Review automation and maintainer decisions remain separate from launch authority and onchain evidence. A changed
source commit or tree is a new review target.

## Prepare a request

Fork `0xprogrammable/hookbuilder`, then copy the example:

```bash
cp submissions/examples/applicant-submission-v1.example.json \
  submissions/requests/<source-repository-id>-<hook-id>.json
```

Replace every example value. The request must bind:

- the public source repository URL and numeric GitHub repository ID;
- the applicant's GitHub login and public, nonzero EIP-55 `launchWallet` address;
- the exact 40-hex source commit and root tree;
- hook, template, and model IDs with exact `major.minor.patch` versions;
- all 14 Uniswap v4 permission booleans and their derived low-14-bit address mask;
- the exact fee amount, denominator, currency basis, recipient, and mutability;
- the exact live beta route `custom-graph@1.0.0` on Ethereum Mainnet chain `1`; and
- `requestedActions: ["review"]`.

Validate the request without network access:

```bash
npm run submission:check -- \
  submissions/requests/<source-repository-id>-<hook-id>.json
```

Then open one pull request with the Applicant template selected in the compare URL:

```text
https://github.com/0xprogrammable/hookbuilder/compare/main...<github-login>:<branch>?expand=1&template=applicant-submission.md
```

The template source is [`applicant-submission.md`](../.github/PULL_REQUEST_TEMPLATE/applicant-submission.md). Keep the
pull request limited to adding or updating one file under `submissions/requests/`; change nothing else.

## Source identity

Branches and tags are navigation aids, not review identity. Review uses only the exact numeric repository ID, commit,
and root tree in the request. The current beta supports public GitHub source; private repositories, pasted source,
archives, mutable refs, and deployed bytecode without the bound source are not valid transport.

The filename must match the bound source and hook:

```text
submissions/requests/<source-repository-id>-<hook-id>.json
```

The validator checks the filename, schema, canonical versions, checksummed nonzero launch-wallet address, permission
mask, fee consistency, exact live route, duplicate JSON keys, and the fixed Hookbuilder intake identity. It reports both the raw request
bytes and a deterministic `applicationManifest` binding over Canonical JSON V2 bytes with no trailing newline. The
exact contract is owned by the [submission guide](../submissions/README.md). These checks are structural. They do not
prove source availability, build success, safety, wallet control, deployment, tradability, or route support.

## Review boundary

The pull request is a public review thread for one immutable source revision. Review findings must cite that exact
revision and reproducible evidence. Unknown behavior can remain pending; novelty alone is not a security finding.

The Applicant file contains one public wallet-address declaration, not a wallet session, signature, ownership proof, or
transaction request, and grants no direct write access to a Registry, Router, wallet, or provider. Any later approval,
signature, deployment, launch, indexing, or public-availability claim needs its own exact authority and evidence.

## Files

- [Schema](../submissions/schema/applicant-submission-v1.schema.json)
- [Example](../submissions/examples/applicant-submission-v1.example.json)
- [Submission directory](../submissions/README.md)
- [Applicant pull-request template](../.github/PULL_REQUEST_TEMPLATE/applicant-submission.md)
