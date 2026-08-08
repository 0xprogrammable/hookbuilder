# Privacy, retention, deletion, and takedown model

Status: **design-only policy candidate**. No intake database, privacy portal, deletion worker, legal-review service, or
takedown automation is implemented by this repository. Jurisdictional privacy, employment, contest, financial, and
recordkeeping requirements require accountable legal and product owners before production.

## Data minimization

The application contract should rely on public GitHub source and project facts wherever possible. A future service
should collect only:

- GitHub account and repository identifiers needed for attribution;
- application/revision, review assignment, decision, and audit metadata;
- security contact details supplied for incident coordination;
- abuse-report content and reporter contact only when voluntarily provided; and
- service security logs necessary to detect misuse.

Do not collect wallet secrets, seed phrases, API credentials, browser profiles, precise location, government identity,
or player telemetry merely because a project may use them. A project that processes such data must declare its own
surface, purpose, consent/legal basis, access, retention, deletion, disclosure, child-safety, and failure controls; the
review queue should reference that declaration rather than ingesting the underlying dataset.

## Candidate retention schedule

These periods are bounded implementation defaults for owner/legal review, not an active policy or promise:

| Data class | Candidate maximum | Trigger and disposition |
| --- | --- | --- |
| Unsubmitted local draft | Controlled by the builder | The service should not receive it |
| Invalid intake payload and security logs | 90 days | Delete or irreversibly aggregate after abuse/debug window |
| Closed queue metadata and review findings | 365 days after closure | Delete private metadata; preserve only public Registry/PR references |
| Access and authorization audit events | 24 months | Delete after the security/accountability window unless a legal hold applies |
| Abuse report and private evidence | 24 months after closure | Delete or redact reporter/private evidence; retain public decision reference |
| Confirmed security incident record | 7 years after closure | Restricted retention subject to legal/security-owner approval |
| Credentials or wallet secrets received accidentally | Zero ordinary retention | Isolate, revoke/rotate through the owner, redact, and run incident handling |

Before implementation, the data owner must ratify or replace every period, document applicable jurisdictions and legal
bases, define legal-hold authority, and prove scheduled deletion. A legal hold must be scoped, logged, reviewed, and
released; it is not permission for indefinite default retention.

## Access, correction, export, and deletion

A future privacy workflow should authenticate the requester, locate records by stable internal identity rather than
email searching, export only that subject's private data, allow correction of mutable contact metadata, and delete or
de-identify eligible records. It must preserve immutable public Git/GitHub history, decision integrity, fraud/security
exceptions, and legally required records with an explicit explanation.

Deletion requests must not erase another person's audit events or silently rewrite an acceptance. Where full deletion
is not permitted, minimize and pseudonymize the subject fields and record the authority, scope, and expiry of the
exception.

## Takedown model

Use reason-specific, reversible states:

| Reason | Initial action | Decision owner |
| --- | --- | --- |
| Leaked credential/private key | Private security hold, stop propagation, notify owner to rotate | Incident responder plus security owner |
| Malware or active exploit distribution | Restrict discovery while preserving bounded evidence | Security reviewer plus decision maintainer |
| Impersonation or trademark/copyright claim | Preserve notice/counter-notice and restrict only the disputed presentation | Accountable legal/brand owner |
| Deceptive approval/audit/deployment claim | Correct Registry/interface claim or suspend presentation pending review | Decision maintainer |
| Spam/harassment | Rate-limit or hide abusive content, preserve appeal record | Moderation owner |
| Applicant withdrawal | Stop pending review; public GitHub history remains governed by GitHub/project owner | Applicant plus queue service |

Do not delete public source, close a GitHub pull request, change Registry state, or contact a provider merely because an
automated classifier fired. External account changes and publication/takedown actions require exact authority and an
audit event. Emergency restriction should be the minimum reversible scope needed to stop harm.

## Public GitHub boundary

Application V3 intentionally binds public GitHub source. GitHub repositories, commits, pull requests, forks, caches,
and archives follow their own retention and deletion behavior. The future review service must explain this before
submission and must not promise that deleting its private metadata removes public or replicated Git data.

## Proof required before production

Required evidence includes a ratified notice and schedule, data inventory, purpose/legal-basis map, access matrix,
processor/subprocessor list, encryption/key controls, data-subject request tests, deletion and backup-expiry tests,
legal-hold drill, takedown/appeal drill, breach notification plan, and named privacy/security owners. None exists merely
because this model is committed.
