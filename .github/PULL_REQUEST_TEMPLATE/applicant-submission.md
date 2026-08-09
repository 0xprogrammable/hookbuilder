## Applicant submission

Use this template only to request review of one exact public source revision.

### Submission file

Path: `submissions/requests/<source-repository-id>-<hook-id>.json`

- [ ] This pull request adds or updates exactly one Applicant submission JSON file and changes nothing else.
- [ ] The source repository ID, commit, and root tree identify the public bytes to review.
- [ ] Hook, template, and model IDs each include an exact SemVer version.
- [ ] The permission mask matches all 14 declared Uniswap v4 permissions.
- [ ] Fee terms and the requested route are complete and exact.
- [ ] `npm run submission:check -- <submission-file>` passes.
- [ ] The pull request contains no credentials, wallet material, private source, or personal data.

### Review boundary

This pull request requests review only. It does not approve, register, deploy, sign, route, or launch the submitted
project. Maintainers and automation must evaluate only the exact source commit and tree in the JSON file.

### Notes for reviewers

State any material context that is not already captured in the submission file. Do not restate mutable branch or tag
names as source identity.
