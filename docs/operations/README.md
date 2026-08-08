# Operations design package

These runbooks define a review-service operating model without claiming that the service exists:

- [Review queue, RBAC, audit, and abuse model](REVIEW_QUEUE_AND_RBAC.md)
- [Privacy, retention, deletion, and takedown model](PRIVACY_RETENTION_AND_TAKEDOWN.md)
- [Incident response and monitoring model](INCIDENT_AND_MONITORING.md)

Every document is `DESIGN_ONLY`. Before production, accountable owners must ratify policy choices, implement controls,
bind deployed configuration and identities, run adversarial and recovery tests, and provide monitoring/incident receipts.
An application package, repository document, deterministic fixture, or local test cannot satisfy those operational gates.
