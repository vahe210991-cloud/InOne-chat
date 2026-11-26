# InOne Beta 1.0 — Production Operations Runbook

**Status:** Draft template; operational values must be supplied by the authorized operator.  
**Scope:** Beta 1.0 backend, PostgreSQL, encrypted object storage, signing/encryption secrets and deployment pipeline.

> Never place secret values, recovery codes, private keys, database passwords or customer data in this document, CI logs or issue comments.

## 1. Release preflight

- [ ] Confirm approved release commit SHA and matching successful exact-SHA CI.
- [ ] Confirm dependency and container-image scans have no unresolved critical/high findings unless a documented owner risk acceptance exists.
- [ ] Confirm production image digests and platform architecture.
- [ ] Confirm production mode and required secret references are configured; no development fallback values are present.
- [ ] Confirm database backup completed and restore verification is current.
- [ ] Confirm object-store backup/replication and reconciliation status.
- [ ] Confirm migration plan, compatibility window and rollback constraints.
- [ ] Confirm health/readiness probes and alert routing.
- [ ] Confirm no release uses artifacts from an untrusted PR workflow.

## 2. Secret rotation

1. Identify the secret purpose, consumers, rotation compatibility and blast radius.
2. Create the replacement in the approved secret manager; do not paste it into GitHub issues, PRs or chat.
3. Deploy support for old/new overlap only where the secret format and security design permit it.
4. Roll consumers in a controlled order and verify health.
5. Revoke the old secret after successful propagation.
6. Verify logs and audit records contain identifiers/status only, never secret material.
7. Record operator, timestamp, affected services and non-secret version/reference.

**Owner-supplied values:** secret manager, rotation contacts, rotation window, emergency revocation path.

## 3. PostgreSQL backup and restore

- Record backup schedule, retention, encryption, storage location and access policy in the approved operations system.
- Verify backup completion and integrity; a successful backup job alone is not proof of recoverability.
- Perform periodic restore drills into an isolated environment.
- Verify schema migration version, row counts/invariants and application smoke tests after restore.
- Define RPO/RTO with the service owner; do not invent them in this template.

**Owner-supplied values:** backup system, schedule, retention, RPO, RTO, restore operator and escalation contact.

## 4. Database migration and rollback

1. Review migration SQL and its lock/transaction behavior.
2. Confirm backward compatibility with the currently deployed application.
3. Take/verify a recoverable backup before destructive or data-transforming migrations.
4. Apply migrations through the approved deployment process.
5. Verify schema migration ledger and application readiness.
6. Prefer forward-fix for irreversible migrations. Do not assume a down migration can restore deleted or transformed data.
7. Record exact application SHA and migration version.

## 5. Encrypted object-store reconciliation

- Preserve opaque ciphertext; backend operators must not decrypt user file payloads.
- Reconcile database references, object existence, temporary objects and retryable deletion tombstones.
- Do not delete an object solely because one listing pass did not find a database reference.
- Use the engine's idempotent reconciliation process and retain evidence of retries/failures.
- Ready-file retention remains a product-owner decision; do not introduce automatic expiry without approval.

## 6. Incident response

1. Triage severity and contain the affected credential/service without destroying forensic evidence.
2. Preserve relevant redacted logs, CI run IDs, deployment SHA and database/object-store audit metadata.
3. Rotate/revoke credentials through the approved secret manager where compromise is suspected.
4. Avoid exporting message bodies, file plaintext, recovery codes or raw authentication tokens.
5. Escalate privacy/security incidents through the approved owner and legal process.
6. Document timeline, impact, containment, recovery and follow-up actions.

## 7. Deploy and rollback

- Deploy only an explicitly approved SHA with exact-SHA CI acceptance.
- Use immutable image digests and traceable build artifacts.
- Verify liveness, readiness, database connectivity and critical API smoke tests.
- Roll back application and database changes only when migration compatibility is confirmed.
- If schema changes are not backward-compatible, stop and use the migration-specific recovery plan rather than blindly reverting the application.
- Record deployment and rollback timestamps, SHAs, image digests and operator approval.


## 9. Supply-chain maintenance

- Dependabot is configured to propose weekly updates for GitHub Actions, Docker images, the backend npm lockfile and all five committed Cargo lockfile directories, including legacy Engine A POC crates.
- Review every update as a pull request. Do not enable automatic merge for action, base-image, Rust, MLS, cryptography or backend dependency updates.
- For GitHub Actions, verify the upstream repository, release/tag and full commit SHA; retain the version comment and inspect meaningful upstream changes before accepting a new pin.
- For container images, verify the official publisher, architecture/index digest, release notes and vulnerability status. Update the digest and human-readable version together.
- Run the exact-SHA CI and relevant runtime/platform acceptance after every action or image pin refresh.
- Run the RustSec scan across all five committed Cargo.lock files, including the legacy Engine A POC client and bridge lockfiles. For Rust advisories, record the advisory ID, affected crate/version, dependency path, reachability/platform applicability, remediation and owner decision. Do not use `cargo audit fix` on MLS or cryptographic dependencies without a separate compatibility review.
- Keep scanner JSON reports and CI evidence under the configured retention policy; do not treat PR artifacts as release provenance.
- If an advisory cannot be fixed safely, document the risk, mitigation, owner and expiry/review date before release approval.

## 10. Open owner/operator inputs

- [ ] Production hosting/platform and region
- [ ] Secret manager and secret owners
- [ ] Database backup schedule, retention, RPO and RTO
- [ ] Object-store backup/replication and reconciliation owner
- [ ] Monitoring/alerting destination and on-call contact
- [ ] Approved deployment/rollback mechanism
- [ ] Ready-file retention policy (separate product decision)
- [ ] Incident severity and escalation contacts
