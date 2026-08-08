# Review queue, RBAC, audit, and abuse model

Status: **design-only operations model**. This document defines requirements for a future maintainer-owned review
service. The Builder repository does not provide a live queue, identity provider, role enforcement, immutable audit log,
moderation team, service-level agreement, or approval system.

## Queue record

One queue record binds one exact Application V3 revision and contains:

- immutable application id, numeric GitHub repository ids, commits, root trees, closure digests, and application revision;
- intake time, current queue state, reason code, priority basis, assigned role rather than personal data, and predecessor;
- exact structural/security/fee/evidence findings and their artifact references;
- every state transition with actor role, time, reason, before/after values, and request id; and
- no private key, credential, wallet secret, browser state, unnecessary personal data, or mutable branch as evidence.

Duplicate submissions for the same application revision collapse to one queue item. A changed source or evidence byte is
a new revision; it cannot inherit an earlier acceptance.

## Queue states

```text
RECEIVED
  -> INTAKE_VALIDATED
  -> TRIAGED
  -> IN_REVIEW
  -> CHANGES_REQUESTED -> IN_REVIEW
  -> READY_FOR_DECISION
  -> ACCEPTED | DECLINED

Any non-terminal state -> SECURITY_HOLD | ABUSE_HOLD | APPLICANT_WITHDRAWN
ACCEPTED -> SUSPENDED | RETIRED only through a separate recorded decision
```

The queue state is not the project's deployment or availability state. Automated intake may create findings and route
work, but it cannot accept, decline, suspend, or retire a project.

## Proposed RBAC

| Role | May do | Must not do alone |
| --- | --- | --- |
| Applicant | Read own record, add a higher revision, withdraw an undecided application | Change findings, assign reviewers, accept, deploy |
| Intake validator | Verify immutable source/package shape and open a triage record | Interpret ambiguous intent, waive gates, decide |
| Triage reviewer | Classify scope, assign required review profiles, request bounded missing evidence | Accept, alter source, deploy |
| Technical reviewer | Record source/evidence findings for assigned profiles | Rewrite applicant source, self-approve own project |
| Security reviewer | Confirm or reject concrete hard predicates and high-risk controls | Convert novelty into a hard conflict, deploy |
| Decision maintainer | Accept or decline the exact reviewed revision with reasons | Edit evidence, accept an unreviewed revision, deploy implicitly |
| Incident responder | Place bounded holds, preserve evidence, rotate service credentials under incident authority | Seize project/user assets, rewrite history, make permanent decisions alone |
| Auditor | Read queue and audit records, export bounded evidence | Mutate records or decisions |
| Operations administrator | Maintain service configuration and role assignments under change control | Review or approve a project by virtue of admin access |

Production policy should require authenticated identities, least privilege, time-bounded elevation, periodic access
review, and separation between applicant, technical reviewer, decision maintainer, and deployment authority. Break-glass
access must expire automatically and receive after-the-fact independent review.

## Audit event model

Every mutation would append an event containing:

```text
event id, occurred-at, recorded-at, actor identity id, actor role,
authenticated session/request id, action, object type/id/revision,
before digest, after digest, reason code, evidence references,
authorization decision, source IP class or privacy-preserving equivalent
```

The future system must make mutation, deletion, export, role change, failed authorization, break-glass use, and decision
events observable. Hash chaining, signed checkpoints, or external append-only storage are candidate controls; this
document does not claim any is deployed or tamper-proof.

## Abuse intake and handling

Separate abuse reporting from technical acceptance. Proposed categories include spam, impersonation, malware, leaked
secrets, intellectual-property complaints, deceptive claims, unauthorized value movement, harassment, and credible
exploit reports.

1. Acknowledge receipt without exposing reporter identity to the applicant.
2. Remove credentials or unnecessary personal data from ordinary queue views; never copy a leaked secret into evidence.
3. Apply the narrowest reversible hold while triage determines scope and urgency.
4. Preserve exact public references and privately controlled evidence according to the retention model.
5. Route security reports to the incident process and legal/takedown claims to an accountable human decision.
6. Record the outcome and appeal path. An abuse allegation is not automatically a technical finding or permanent ban.

Automated rate limits, duplicate detection, attachment scanning, and content classification may assist triage but must
not become an unreviewable approval, rejection, or takedown authority.

## Required proof before calling this operational

Do not call the queue or controls live until an accountable owner supplies deployed service identity, configuration,
role bindings, access-review receipt, mutation/denial tests, audit-event durability tests, backup/restore drill, abuse
escalation drill, monitoring/alert receipts, and an incident contact. Repository prose and fixtures prove none of these.
