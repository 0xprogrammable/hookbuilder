# Applicant submissions

This directory is the public beta intake for one exact, review-only Programmable submission. The canonical intake
repository is `0xprogrammable/hookbuilder`, GitHub repository ID `1320085947`.

## Prepare one request

1. Copy [`examples/applicant-submission-v1.example.json`](examples/applicant-submission-v1.example.json).
2. Replace every example value and pin the public source repository ID, commit, and root tree.
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

The file binds hook, template, and model IDs with exact SemVer versions, all 14 Uniswap v4 permission flags, the
derived address mask, fee terms, and the requested route. A valid file requests review only. It does not approve,
deploy, register, sign, route, or launch anything.

The GitHub App is scoped to this single repository. Source remains in the applicant's public repository and is read by
exact repository ID, commit, and tree during review. Mutable branches and tags are not source identity.

Schema: [`schema/applicant-submission-v1.schema.json`](schema/applicant-submission-v1.schema.json)
