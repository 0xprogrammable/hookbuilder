# Frozen legacy Applicant contract

This directory preserves the former Hookbuilder Applicant contract for pull requests #10, #11, #12, #14, #15, #18,
#19, and #20 against Hookbuilder `main` only. It is not open to new requests.

Every new one-off application must use the Builder's generated six-file draft flow to
`0xprogrammable/submit-launch`, immutable GitHub repository ID `1320171831`. Do not copy the example or create a new
`submissions/requests/**` pull request in Hookbuilder.

An allowed legacy pull request may update its existing request path on the same thread when its bound commit or tree
changes. The changed bytes are a new review target and still require the legacy validator:

```bash
npm run submission:check -- submissions/requests/<existing-request>.json
```

The 1.1.0 file binds the applicant GitHub login and intended launch-wallet address, hook, template, and model IDs with
exact SemVer versions, all 14 Uniswap v4 permission flags, the derived address mask, fee terms, and the only live beta
route: `custom-graph@1.0.0` on Ethereum Mainnet chain `1`. A valid file requests review only. The public address does not
prove wallet control or authorize approval, deployment, registration, signing, routing, or launch.

The legacy pull-request transport remains only for the eight listed continuations. Source remains in the applicant's
public repository and is read by exact repository ID, commit, and tree during review. Mutable branches and tags are not
source identity.

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
