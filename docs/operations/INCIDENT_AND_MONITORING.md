# Incident response and monitoring model

Status: **design-only runbook**. No pager, alert route, dashboard, log pipeline, on-call rotation, incident commander,
status page, automated containment, or uptime promise is supplied by this repository.

## Severity model

| Severity | Example | Initial objective |
| --- | --- | --- |
| SEV-0 | Credential or signing-key exposure, unauthorized decision/state mutation, active value-loss path | Contain access and stop new affected actions immediately |
| SEV-1 | Review queue unavailable, audit-log gap, accepted revision/source mismatch, abuse evidence exposure | Preserve integrity, place bounded holds, restore from known evidence |
| SEV-2 | Backlog breach, stale provider/indexer evidence, failed deletion job, partial notification outage | Degrade visibly, reconcile, and repair within owned operations |
| SEV-3 | Documentation drift, non-security UI issue, noisy alert | Track normally without claiming emergency authority |

Severity does not grant authority to move user/project funds, deploy contracts, rewrite Git history, accept or reject an
application, or change an external account. Those actions retain their independent authorization requirements.

## Incident sequence

1. **Detect and identify.** Create an incident id; record reporter, first signal, affected revisions/systems, time range,
   known/unknown facts, and potential data/value exposure.
2. **Authenticate authority.** Name incident commander, technical lead, communications owner, privacy/legal owner when
   applicable, and the exact containment actions each may take.
3. **Contain narrowly.** Revoke compromised service credentials, stop new intake/decisions, or place affected revisions
   on a reversible hold. Do not invalidate unaffected accepted revisions.
4. **Preserve evidence.** Snapshot relevant configuration and logs through approved tooling; hash and access-control the
   record. Never copy secrets into tickets or public artifacts.
5. **Assess and notify.** Distinguish suspected from confirmed impact; notify applicants, maintainers, providers, users,
   or authorities only through the accountable owner and applicable obligations.
6. **Eradicate and recover.** Repair the root cause, rotate credentials, restore/reconcile state, rerun authorization and
   integrity tests, and require a second reviewer for reopening affected capability.
7. **Close and learn.** Record timeline, impact, cause, decisions, evidence, residual risk, follow-ups, retention class,
   and a blameless review. Rehearse the regression before calling the control restored.

## Candidate monitoring signals

| Surface | Signal | Candidate alert condition |
| --- | --- | --- |
| Intake | Invalid, oversized, duplicate, or traversal attempts | Sudden rate/actor increase or validator crash |
| Queue | Age and count by state/profile/severity | Oldest item exceeds ratified service objective or state becomes stuck |
| RBAC | Denied actions, elevation, role changes, inactive privileged accounts | Any break-glass use; repeated denial; unreviewed privileged role |
| Audit | Event sequence, checkpoint age, before/after digest continuity | Missing/duplicate sequence, digest mismatch, checkpoint stale |
| Source binding | GitHub id/commit/tree/closure replay | Exact replay mismatch or required object unavailable |
| Decisions | Acceptance/decline/suspend actor and evidence closure | Self-approval, missing second reviewer, revision mismatch |
| Privacy | Export/deletion/legal-hold jobs and backup expiry | Failed/late job, hold without owner/expiry, unauthorized export |
| Abuse | New reports, severity, acknowledgment and appeal age | Credible secret/exploit report or breached response objective |
| Dependencies | GitHub/provider status, API errors, rate limits, schema drift | Sustained failure, unexpected response shape, stale evidence |

Thresholds and service objectives must be set from observed capacity and risk. The table names signals; it is not proof
that metrics, alerts, or staff exist. Alerts need a named owner, deduplication, escalation, runbook link, test event, and
resolution evidence. A dashboard without paging and response ownership is not monitoring readiness.

## Required drills

Before production, run and preserve results for:

- compromised reviewer credential and break-glass expiry;
- unauthorized acceptance attempt and audit-chain discontinuity;
- GitHub outage/rate limit during source replay;
- accepted revision/source mismatch;
- accidental secret or personal-data submission;
- deletion job plus backup-expiry verification;
- queue restore and reconciliation from backup; and
- stale provider evidence without falsely changing project acceptance.

Each drill records exact environment, actors, timestamps, injected fault, observed alerts, decisions, containment,
recovery, data loss, missed signals, and follow-up owner/date. A tabletop document is useful evidence but is not a live
alert or recovery receipt.

## Communications boundary

Use factual state language: affected/suspected, contained/uncontained, last verified time, user action, next update, and
known limitations. Never claim “all funds safe,” “no data accessed,” or “fully resolved” without exact evidence. Public
posts, provider notices, GitHub changes, and account actions require separate external authority.
