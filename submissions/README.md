# Applicant submissions

This directory is the public beta intake for one exact, review-only Programmable submission. The canonical intake
repository is `0xprogrammable/hookbuilder`, GitHub repository ID `1320085947`.

## Prepare one request

1. Copy [`examples/applicant-submission-v1.example.json`](examples/applicant-submission-v1.example.json).
2. Replace every example value. Declare the applicant's GitHub login and public, nonzero EIP-55 `launchWallet`, then pin
   the public source repository ID, commit, and root tree.
3. Save exactly one request as `requests/<source-repository-id>-<hook-id>.json`.
4. Validate it locally:

   ```bash
   npm run submission:check -- submissions/requests/<source-repository-id>-<hook-id>.json
   ```

5. Open a pull request with `template=applicant-submission.md` in the compare URL:

   ```text
   https://github.com/0xprogrammable/hookbuilder/compare/main...<github-login>:<branch>?expand=1&template=applicant-submission.md
   ```

For a changed commit or tree of the same hook, update that same request path. The changed bytes are a new review target.

The 1.1.0 file binds the applicant GitHub login and intended launch-wallet address, hook, template, and model IDs with
exact SemVer versions, all 14 Uniswap v4 permission flags, the derived address mask, fee terms, and the only live beta
route: `custom-graph@1.0.0` on Ethereum Mainnet chain `1`. A valid file requests review only. The public address does not
prove wallet control or authorize approval, deployment, registration, signing, routing, or launch.

The public pull-request transport targets this single Hookbuilder repository and requires no GitHub App credential.
Source remains in the applicant's public repository and is read by exact repository ID, commit, and tree during review.
Mutable branches and tags are not source identity.

## Deterministic applicationManifest binding

The checked-in request may stay human-readable. The offline validator accepts only 1 to 65,536 bytes of strict UTF-8
JSON and rejects duplicate decoded keys. After schema and semantic validation, it derives a separate immutable
`applicationManifest` binding:

- `path` is exactly `submissions/requests/<source-repository-id>-<hook-id>.json`;
- `canonicalization` is `urn:programmable:canonical-json:2.0.0`;
- `bytes` is the length of the parsed request serialized as Canonical JSON V2 UTF-8 with no trailing newline; and
- `sha256` is `sha256:<64 lowercase hex>` over those exact canonical bytes.

At the file-report level, the CLI keeps `path`, raw checked-in `bytes`, and raw-byte `sha256` as 64 lowercase hex without
a prefix. Formatting changes can change that raw evidence without changing the canonical semantic binding. Any field
change, including `applicant.launchWallet`, changes the canonical digest and is a new review target.

Schema: [`schema/applicant-submission-v1.schema.json`](schema/applicant-submission-v1.schema.json)
