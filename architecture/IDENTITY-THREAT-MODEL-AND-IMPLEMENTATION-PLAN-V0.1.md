# InOne Identity — threat model and implementation plan v0.1

**Status:** CTO security and delivery baseline; architecture documentation only  
**Date:** 2026-11-13  
**Branch:** architecture/product-and-platform-blueprint-2026-11-13  
**Implementation status:** No Identity service, schema, endpoint, UI, deployment or runtime security control is implemented by this document.

## 1. Executive decision

Treat InOne Identity as a high-trust security boundary, not as a shared user table or a login helper.

Build and validate it in this order:

1. Freeze trust boundaries, threat model, API contracts and product adapter responsibilities.
2. Implement the Identity core in isolation with its own database and security audit.
3. Prove authentication, session revocation, recovery and anti-abuse controls with adversarial tests.
4. Integrate one product adapter at a time in a non-production environment.
5. Run security review, operational exercises and failure/replay tests.
6. Enable production traffic gradually, with feature flags and a tested rollback path.

No product may trust a client-supplied identity, role, account context, device status, recovery state or financial permission. Product APIs validate signed tokens and independently authorize every product action.

The initial topology remains a modular monolith with a dedicated PostgreSQL database, OIDC Authorization Code + PKCE, server-side sessions/refresh-token families, transactional outbox/inbox and versioned product adapters. Do not split into microservices in v1.

## 2. Security objectives

- Authentication integrity: only a valid enrolled credential can authenticate an identity.
- Tenant and product isolation: a token for one product cannot grant access to another product; personal and work contexts are not silently merged.
- Account lifecycle integrity: each required product account is created/reserved exactly once; partial failure never produces a false success.
- Contact claim integrity: globally unique unverified phone/email claims follow the owner's first-claim reservation policy without being treated as proof of ownership.
- Session containment: lost, stolen, revoked or replayed sessions cannot continue refreshing indefinitely.
- Recovery integrity: recovery requires a previously enrolled factor; unverified contacts and support assertions are not recovery proofs.
- Authorization separation: Identity authenticates; InOne, InOne Business and Propo authorize their own domain actions.
- Auditability: privileged changes and security state transitions are attributable, ordered and tamper-evident.
- Availability with safe degradation: an outage must not silently weaken authentication, authorization, recovery or financial controls.

## 3. Assets and impact

| Asset | Examples | Primary impact if compromised |
|---|---|---|
| Central identity | identity ID, account status, product links | Account takeover across product contexts |
| Credentials | password hash, passkey public keys, TOTP secret | Authentication compromise |
| Recovery secrets | recovery-code hashes, recovery grants | Account takeover / recovery bypass |
| Sessions | refresh-token families, device bindings | Persistent unauthorized access |
| Contact claims | normalized phone/email and reservation state | Registration denial, privacy leakage, social engineering |
| Product account mappings | InOne/Business/Propo principal IDs | Cross-account or cross-context access |
| Provisioning operations | saga state, idempotency keys, acknowledgements | Duplicate, missing or incorrectly activated accounts |
| Business invitation references | invitation state, scope, acceptance | Unauthorized employee onboarding |
| Security holds | recovery hold, contact-change hold | Unauthorized sensitive actions if bypassed |
| Audit trail | actor, action, decision, correlation | Loss of accountability / repudiation |
| Signing keys | OIDC/JWT signing material | Forged tokens for affected audiences |
| Service credentials | product adapter credentials | Forged provisioning or lifecycle commands |

Highest impact assets: signing keys, refresh-token families, recovery grants/codes, product account mappings, service-to-service credentials and Business security-hold state.

## 4. Trust boundaries

1. Untrusted client to Identity public API: all input is attacker-controlled; apply validation, rate limits, anti-enumeration and CSRF protections where browser cookies are used.
2. Identity to product backend: authenticated machine-to-machine boundary; each service gets a distinct credential and narrow audience/scope.
3. Product backend to Identity: product service identity is authenticated and authorized; a product may request only its own permitted provisioning or lifecycle operations.
4. Identity to event broker to product consumers: events are at-least-once and potentially delayed/reordered; consumers verify producer authenticity, schema version and idempotency.
5. Employee invitation to invitee: possession of an invitation token proves possession of that token only; it does not prove phone/email ownership or real-world identity.
6. Support/operator to restricted case tools: privileged human boundary; require least privilege, reason codes, separation of duties and immutable audit.
7. Identity service to database/KMS/secrets: privileged infrastructure boundary; database access does not grant application-level authorization; signing/encryption keys are kept in managed secrets/KMS, not source control.
8. Personal to work contexts: explicit context switch and audience-specific authorization; never infer Business membership from an InOne or Propo session.

## 5. Threat actors and capabilities

- Anonymous internet attacker: credential stuffing, enumeration, abuse, malformed requests and resource exhaustion.
- Targeted attacker: phishing, social engineering, SIM/email account compromise, device theft and recovery abuse.
- Malicious or compromised user: attempts to claim another person's contact, replay a token, link identities or exceed product scope.
- Malicious employee: abuses invitations, delegated access, support processes or Business privileges.
- Compromised product backend/adapter: attempts to provision arbitrary identities or obtain broader scopes.
- Insider/operator: attempts unauthorized contact reassignment or credential recovery.
- Supply-chain/infrastructure attacker: compromises dependencies, CI secrets, signing keys, database or deployment pipeline.

Assume attackers can inspect mobile binaries, modify clients, replay requests, race concurrent operations, call public APIs directly, control an untrusted device and delay/reorder network messages. Do not rely on hidden UI controls or client-side checks.

## 6. Threat register and required controls

Severity is an initial engineering rating, not a claim that risk is eliminated. P0 blocks production launch.

| ID | Threat / abuse case | Severity | Required preventive controls | Detection / response |
|---|---|---:|---|---|
| T01 | Account enumeration via registration, recovery or contact conflict | High | Generic response shape/status; timing normalization; no authenticator disclosure; rate limits | Monitor response distributions and probing patterns |
| T02 | Credential stuffing / password spraying | Critical | Argon2id; breached-password screening where available; per-account/IP/device throttles; progressive backoff; bot/risk controls; MFA/passkey support | Alert on failure spikes; temporary risk-based blocks |
| T03 | Phishing / stolen password | Critical | Passkey preferred; TOTP optional; fresh step-up for sensitive actions; never rely on password alone for high-risk Business actions | New-device and unusual-auth alerts; revoke sessions |
| T04 | Refresh-token theft or replay | Critical | Opaque high-entropy refresh tokens; store hashes; rotate every use; family linkage; reuse detection; secure OS storage; TLS | Revoke affected family and raise risk event on reuse |
| T05 | Cross-product token substitution | Critical | Exact issuer, audience, client, scope, expiry and signature validation; distinct product audiences; no wildcard audience | Reject and alert on audience mismatch |
| T06 | Personal/work context confusion | Critical | Separate product principals/context IDs; explicit product authorization; no implicit linking or data merge | Audit context transitions and mapping changes |
| T07 | Contact squatting / denial of registration | High | Owner-approved first-claim reservation; generic conflict; no automatic transfer; restricted manual dispute process; contacts remain unverified | Queue disputed claims; audit every resolution |
| T08 | Contact string used as recovery proof | Critical | Unverified phone/email are lookup identifiers only; no reset links/SMS/email; recovery only through enrolled factors | Test all reset paths; alert on prohibited attempts |
| T09 | Recovery-code brute force/replay/theft | Critical | 128-bit minimum random codes; keyed hashes; one-time atomic consume; rate limits; invalidate set after use; 24h sensitive-action hold | Alert on repeated invalid codes and concurrent attempts |
| T10 | Recovery grant theft/replay | Critical | Hash at rest; 10-minute TTL; single-use atomic consume; bind identity/client/device/purpose; never issue normal token from grant | Reject replay; audit grant lifecycle |
| T11 | Trusted-device approval from stale session | Critical | Require active session plus fresh passkey/TOTP step-up; session-only approval forbidden | Record step-up age and device status |
| T12 | Support social engineering / insider reset | Critical | No manual reset override in v1; restricted case only; least privilege; two-person review for future proofing | Immutable operator audit; alert on unusual case access |
| T13 | Business invitation theft/replay | High | High-entropy opaque token; hash at rest; expiry/revocation; bind org, inviter, role ceiling and intended flow; explicit authenticated acceptance; one-time consume | Audit inviter, acceptor, scope and replay attempts |
| T14 | Unauthorized product provisioning | Critical | mTLS or equivalent service auth; per-service scopes; signed commands; server-derived product pair; idempotency; no client-selected identity ID | Alert on rejected service calls and anomalous provisioning |
| T15 | Duplicate accounts due to retries/races | High | Unique constraints; idempotency key + payload fingerprint; transactional outbox; product-side idempotency; reconciliation | Detect duplicate mapping invariant violations |
| T16 | Partial saga reported as complete | High | Explicit per-product state; return 202/pending until all required acknowledgements; no access before product activation | Stuck-saga dashboard and repair queue |
| T17 | Delayed/replayed security events | Critical | Event IDs, versions, producer auth, consumer inbox dedupe, sequence/aggregate version; current-state checks for critical holds | Lag/replay monitoring; reconcile current Identity state |
| T18 | Security hold bypass in Business/Propo | Critical | Server-side deny on sensitive routes; event cache plus authoritative current-state check when stale; fail closed if state unavailable for designated high-risk actions | Synthetic hold-enforcement probes |
| T19 | Signing-key compromise | Critical | KMS/HSM-backed keys; key rotation; kid; short access-token TTL; private key access restricted; no secrets in CI logs | Key-use anomaly alerts; emergency revoke/rotate runbook |
| T20 | Database breach | Critical | Encryption at rest; least-privilege DB roles; network isolation; hashed tokens/codes; secrets separated; backups encrypted | DB audit, access alerts, restore drills |
| T21 | PII leakage in logs/traces/analytics | High | Redaction allowlist; no passwords/tokens/full contacts/recovery codes; restricted log access and retention | Automated secret/PII scans; incident playbook |
| T22 | DoS / recovery and registration resource exhaustion | High | Rate limits, quotas, bounded Argon2 concurrency, queue backpressure, request size/time limits | Saturation alerts; degrade non-critical workflows |
| T23 | CSRF / redirect URI abuse / PKCE downgrade | Critical | Exact redirect URI allowlist; PKCE S256 mandatory; state/nonce validation; secure SameSite cookies; strict CORS; no open redirects | Security tests and rejected-redirect telemetry |
| T24 | Dependency or CI supply-chain compromise | High | Lockfiles; dependency scanning; signed builds; protected branches; secret scanning; least-privilege CI; reviewed upgrades | SBOM, vulnerability alerts, provenance checks |
| T25 | Audit deletion or repudiation | High | Append-only audit; restricted writer; immutable external retention/export; monotonic event IDs | Integrity checks and audit-gap alerts |
| T26 | Race on contact claim, code consume, grant consume or approval | Critical | Database unique constraints; serializable/row-lock/conditional update semantics; atomic state transitions | Concurrency tests and invariant monitoring |
| T27 | Account linking based on matching unverified contact | Critical | Never auto-link by phone/email; explicit authentication to both identities and separately approved linking flow | Alert on unexpected mapping changes |
| T28 | Product backend unavailable during revocation | Critical | Short access-token TTL; refresh blocked centrally; revocation event; product-side session version/current-state checks for sensitive actions; fail closed on stale high-risk state | Revocation propagation SLO and outage alert |

### Launch-blocking P0 conditions

Do not launch production authentication if any of these is true:

- Product APIs accept tokens without strict issuer/audience/signature/expiry validation.
- A product can trust a client-supplied identity or role.
- Unverified phone/email can reset credentials or approve sensitive actions.
- Refresh-token reuse is not detected and contained.
- Recovery codes/grants can be reused under concurrent requests.
- A Business/Propo sensitive action can bypass an active Identity security hold.
- A personal token can access work data or another product audience.
- Product provisioning can create duplicate accounts or activate a reserved Propo account prematurely.
- Signing keys or service credentials are stored in source code or client binaries.
- There is no tested global session-revocation path.

## 7. Authentication, token and session baseline

These are CTO technical defaults for v1, subject to implementation review; they do not alter owner-approved product policy.

### 7.1 Password and authenticators

- Password hashing: Argon2id with parameters calibrated on production-class hardware and re-evaluated periodically.
- Never store or log plaintext passwords; never send them to product backends.
- Passkey/WebAuthn is the preferred phishing-resistant authenticator.
- TOTP is optional and must use encrypted secret storage with restricted key access.
- Password-only authentication may establish a normal low-risk session, but sensitive Business financial permissions require an enrolled passkey or TOTP and a fresh step-up.
- Recovery codes: 10 codes, each generated with at least 128 bits of cryptographic randomness, shown once, stored only as keyed hashes, atomically consumed.

### 7.2 Access and refresh tokens

- Access token target lifetime: **5 minutes**.
- Refresh token: opaque random secret, stored server-side only as a hash, rotated on every successful use.
- Refresh inactivity lifetime: **30 days**; absolute session lifetime: **90 days**. Re-authentication is required after absolute expiry.
- Refresh-token reuse revokes the entire token family and triggers a security event; do not silently mint a new session.
- Sensitive action step-up freshness: **5 minutes maximum**.
- Recovery grant: **10 minutes**, single-use, purpose/client/device-bound, and never exchangeable for an ordinary access token.
- Tokens carry minimum claims: issuer, subject, audience, client, issued-at, expiry, token/session identifier, authentication context and relevant security version. Avoid embedding mutable organization permissions or long-lived product roles.
- Signing keys are asymmetric and KMS-backed. Publish public keys via JWKS; support controlled key rotation and emergency key revocation.

### 7.3 Device lifecycle

- Device record is a revocable installation/browser registration, not proof of a real person's identity.
- Each device has an opaque server-generated ID; client installation ID is only a correlation hint, not an authenticator.
- Store refresh secrets only in OS secure storage (Keychain/Keystore) on mobile; browser clients use secure, HttpOnly, SameSite cookies where applicable.
- Device rename is low risk; enrollment, removal, recovery and session transfer require appropriate authentication/step-up.
- Lost-device action revokes device refresh families immediately and emits a revocation event.
- Device activation in InOne never activates the paired Propo account. Propo activation is a Propo-owned lifecycle action.

## 8. Recovery and contact policy enforcement

The standalone IDENTITY-RECOVERY-FLOW-V0.1.md remains authoritative for the detailed state machine. This threat model requires these invariants:

- Unverified contacts are lookup identifiers only.
- Recovery uses enrolled passkey, fresh trusted-device passkey/TOTP step-up, or one unused recovery code.
- No factor left: fail closed; support can track a case but cannot reset credentials in v1.
- Password reset revokes all product sessions.
- Recovery-code use invalidates the old set and applies a 24-hour hold on sensitive actions.
- Contact replacement requires fresh passkey/TOTP, retains the old claim during the 72-hour cooling period and blocks sensitive actions while pending.
- Support and Business administrators cannot bypass central Identity recovery.

Important implementation detail: a security hold is a server-side authorization fact, not a UI banner or JWT boolean. Product services consume authenticated events for fast propagation and must check current Identity security state before designated high-risk actions whenever event freshness cannot be guaranteed. If the authoritative state cannot be confirmed, the designated high-risk action is denied.

## 9. Product isolation and provisioning safeguards

### 9.1 Product authorization

- InOne, InOne Business and Propo register separate OAuth/OIDC clients and audiences.
- Identity issues only the audience authorized for the initiating client and approved product flow.
- Every product API validates token signature, issuer, exact audience, expiry, client and required authentication context.
- Product API maps central sub to its own local principal using a server-managed mapping.
- Product API then checks local account status, membership, organization scope, permissions and resource ownership.
- Business permissions never live solely in Identity tokens.
- A Business employee's access is membership-scoped; one person's membership in another organization cannot grant access to this organization.

### 9.2 Provisioning saga

- Registration selects product pairs server-side: InOne personal → InOne personal + Propo personal; accepted Business invitation → InOne Business work + Propo work.
- Use durable outbox and consumer inbox with unique event IDs and idempotent handlers.
- Use a stable operation ID and payload fingerprint; same idempotency key with changed payload is rejected.
- Product adapters create-or-return the same local principal on retries.
- Product account state is explicit: requested, provisioning, reserved, active, failed-retryable, failed-permanent, suspended.
- Propo reserved account cannot authenticate or use marketplace features until Propo's own first-device activation.
- Do not delete successful partial steps automatically. Reconcile and repair them.
- Identity reports full pair completion only after both required product backends acknowledge.
- Do not assume Propo supports separate personal/work principals; prove this in a sandbox and obtain a versioned contract before production integration.

### 9.3 Invitation boundary

- InOne Business creates and owns invitations, inviter authorization, target organization, role/position ceiling, expiry, revocation and membership activation.
- Invite token is random, opaque, single-use, hashed at rest and scoped to one invitation.
- Previewing an invitation never creates membership.
- Acceptance requires authentication to central Identity and an explicit user action.
- Identity provisions work product accounts only after a service-authenticated Business acceptance command.
- Invitation possession does not verify phone/email and cannot recover central Identity.

## 10. Security architecture and data handling

- Dedicated Identity PostgreSQL database; no product backend reads/writes it directly.
- Database constraints enforce unique normalized active phone/email claims, unique product mapping per identity/context/product, and unique idempotency keys within their defined scope.
- Store passwords as Argon2id hashes; refresh tokens/recovery codes/recovery grants/invitation tokens as cryptographic hashes; encrypt TOTP secrets and sensitive key material with envelope encryption.
- Keep KMS keys and service credentials outside source control and client apps.
- Use separate DB roles for migrations, application read/write, outbox publishing and restricted support operations.
- Audit log is append-only from application perspective; privileged audit access is read-only and restricted.
- Logs contain opaque IDs, event names and safe error codes; redact credentials, full contacts and sensitive request bodies.
- Define retention and deletion policy with legal/privacy review before production; do not invent a universal retention duration.
- Backups encrypted, access-controlled and regularly restore-tested.
- Production access is just-in-time, approved, time-bounded and audited.

## 11. Observability, alerts and incident response

### Required security signals

- Login success/failure by client, risk bucket and coarse network/device signals.
- Password spray and credential-stuffing indicators.
- Refresh rotation, token-family reuse and device revocations.
- Passkey/TOTP enrollment/removal and step-up failures.
- Recovery start/challenge/grant/complete outcomes, without secrets or contact disclosure.
- Recovery-code consumption and 24-hour hold placement/release.
- Contact claim conflicts, pending changes and manual dispute actions.
- Invitation creation, revocation, preview and acceptance.
- Product provisioning age, retries, dead letters, partial success and reconciliation mismatch.
- Security event delivery lag and product-side hold enforcement.
- Signing-key rotation and service credential use.

### Initial operational targets

These are engineering targets to validate in staging, not contractual uptime promises:

- Access-token lifetime: 5 minutes.
- Revocation event propagation: p95 under 30 seconds; high-risk actions still use authoritative state checks.
- Provisioning status visible within 10 seconds of each acknowledgement.
- Alert if a provisioning saga remains incomplete for 5 minutes; route to retry/reconciliation queue.
- Alert immediately on refresh-token reuse, invalid signature/audience spike, signing-key anomaly or hold bypass attempt.
- Security audit events durable before returning success for credential, recovery, contact-claim, session-revocation and privileged admin changes.

### Incident runbooks required before production

1. Signing-key compromise: stop issuance, rotate keys, invalidate affected sessions, publish JWKS transition, coordinate product API cache refresh.
2. Refresh-token theft/replay: revoke family/device, force re-authentication, assess cross-product sessions.
3. Identity database exposure: isolate service, rotate encryption/signing/service secrets as applicable, assess hashes/PII, restore from clean backup if needed.
4. Product adapter compromise: revoke adapter credential, pause its provisioning commands, reconcile affected mappings.
5. Recovery abuse: rate-limit/disable affected recovery path, preserve evidence, revoke grants and affected sessions.
6. Security-hold propagation failure: deny designated high-risk operations until authoritative state is confirmed.
7. Contact-squatting dispute: restrict case access, preserve claim history, require evidence and independent reviewer; never auto-transfer.

## 12. Delivery plan and stage gates

### Stage 0 — Contract freeze and engineering readiness

Deliver:
- Identity domain model and API/event contract reviewed against this threat model.
- Confirmed OIDC library and WebAuthn library choices.
- Product client registry and audience matrix.
- Propo API/sandbox answers for personal/work account principals, stable IDs, reservation and activation.
- Data classification, privacy/legal review, retention decisions and threat-model sign-off.
- CI security baseline, secrets management and reproducible local/staging environment.

Exit gate:
- No unresolved P0 trust-boundary question.
- Propo integration contract is concrete or Propo integration is explicitly deferred behind an adapter boundary.
- Architecture and API schemas versioned and reviewed.

### Stage 1 — Identity foundation

Implement:
- Service bootstrap, configuration and health/readiness endpoints.
- Dedicated PostgreSQL migrations, constraints and DB roles.
- Central identity creation and status lifecycle.
- Contact normalization and atomic unique reservation.
- Append-only security audit and correlation IDs.
- Transactional outbox/inbox and idempotency middleware.
- KMS/secrets integration and key rotation foundation.

Exit tests:
- Concurrent duplicate contact claim yields exactly one winner.
- No PII/secrets in logs.
- Migration and backup/restore tests pass.
- Audit events are durable and correlated.

### Stage 2 — Authentication and sessions

Implement:
- OIDC discovery, authorization code + PKCE S256, exact redirect allowlist, state/nonce.
- Password Argon2id; passkey/WebAuthn; optional TOTP.
- Access/refresh token issuance, rotation, reuse detection and revocation.
- Device/session listing and revocation.
- Per-client/product audiences and JWKS key rotation.

Exit tests:
- Token substitution across products rejected.
- Refresh replay revokes family.
- Revoked device cannot refresh.
- PKCE downgrade, redirect manipulation, CSRF and nonce/state attacks rejected.
- Product API validates tokens independently.

### Stage 3 — Recovery and account security

Implement:
- Recovery codes, secure one-time display and atomic consumption.
- Recovery grants, device/client/purpose binding and expiry.
- Passkey/TOTP/trusted-device recovery paths.
- Global session revocation on password reset.
- Recovery-code 24-hour hold.
- Contact replacement 72-hour cooling state.
- Restricted support cases without credential reset override.

Exit tests:
- Enumeration tests produce indistinguishable responses.
- Code/grant replay and concurrency tests pass.
- Unverified contact reset attempts fail.
- Holds are enforced by every integrated product service.
- All recovery transitions are auditable.

### Stage 4 — Product provisioning and invitation integration

Implement:
- InOne personal pair provisioning.
- Propo reserved-account behavior and Propo first-device activation contract.
- Business invitation acceptance callback and work-pair provisioning.
- Product adapter authentication/scopes.
- Durable retries, DLQ, replay and reconciliation.
- Product account mapping and lifecycle status APIs.

Exit tests:
- Exactly one account per required product/context after repeated requests and injected failures.
- Partial success never reports complete.
- InOne activation does not activate Propo.
- Business membership is not active before accepted invitation and Business authorization.
- Existing central identity accepting a Business invite reuses identity without merging personal/work product data.

### Stage 5 — Product authorization integration

Implement:
- InOne, Business and Propo token validation middleware.
- Product-local principal mapping.
- Business membership and permission checks remain in Business.
- Security hold event consumers and authoritative current-state checks.
- Global logout/revocation propagation.
- Separate personal/work account context selection.

Exit tests:
- Cross-product and cross-organization access denied.
- A token with wrong audience or stale/revoked state is rejected.
- Hold blocks designated sensitive operations even if UI is stale.
- Product API outage/failure modes fail closed for designated high-risk actions.

### Stage 6 — Security hardening and operational readiness

Deliver:
- Independent penetration test and remediation of all Critical/High findings.
- Threat-model review with abuse-case walkthroughs.
- Load, soak, chaos, replay, concurrency and restore testing.
- SBOM/dependency scan, secret scan, signed build/provenance checks.
- Incident runbooks, on-call ownership, dashboards and alert drills.
- Privacy/legal review and data retention/deletion procedure.

Exit gate:
- Zero open Critical findings; High findings fixed or explicitly risk-accepted by accountable owner/security reviewer.
- Recovery, revocation, key rotation and restore exercises completed.
- No known P0 threat control missing.

### Stage 7 — Controlled rollout

- Internal test identities first.
- Then limited employee/test cohort with no financial permissions.
- Then limited personal InOne cohort.
- Then Business onboarding with non-sensitive permissions.
- Enable sensitive Business financial actions only after passkey/TOTP, recovery-code, step-up, dual approval and hold enforcement are proven end-to-end.
- Propo production integration only after Propo contract/sandbox acceptance.
- Use feature flags, per-client kill switches and documented rollback; never silently downgrade to local product passwords or unverified-contact recovery.

Exit gate:
- Security and product owners sign off on observed telemetry and test evidence.
- Rollback has been rehearsed.
- No production enablement based solely on successful compilation or unit tests.

## 13. Required test strategy

Use multiple layers; unit tests alone are insufficient.

- Unit: normalizers, permission decisions, token claims, state machines, policy checks.
- Database integration: uniqueness races, atomic code/grant consumption, transaction rollback, idempotency constraints.
- API integration: OIDC flows, registration, recovery, device revocation, invitation acceptance, provisioning.
- Contract tests: Identity ↔ each product adapter, event schema compatibility, audience and service scopes.
- Security tests: enumeration, credential stuffing throttles, redirect/PKCE attacks, token substitution, replay, CSRF, injection, broken object-level authorization.
- Concurrency tests: simultaneous contact claims, simultaneous recovery-code use, refresh-token replay, duplicate provisioning, double invitation acceptance.
- Chaos/failure tests: product API timeout, database failover, event broker outage, duplicate/out-of-order events, KMS unavailable, partial saga and dead-letter replay.
- End-to-end: password reset revokes all products; recovery-code hold blocks sensitive Business action; Propo reserved account remains inaccessible before Propo activation.
- Operational: restore from backup, signing-key rotation, adapter credential revocation, incident drills.

Every test must assert server-side outcomes, not merely UI messages.

## 14. Release checklist

Production release is blocked until all items are evidenced:

- [ ] Architecture/API/event contract reviewed and versioned.
- [ ] Propo personal/work account contract confirmed or integration deferred.
- [ ] OIDC PKCE and strict audience validation verified.
- [ ] Password/passkey/TOTP implementation security-reviewed.
- [ ] Refresh rotation, replay detection and global revocation verified.
- [ ] Recovery codes/grants are single-use under concurrency.
- [ ] Unverified contacts cannot recover accounts.
- [ ] Contact claim conflict and dispute process is restricted/audited.
- [ ] Security holds enforced by every relevant product backend.
- [ ] Product provisioning is idempotent, retryable and reconcilable.
- [ ] Personal/work and cross-product isolation tests pass.
- [ ] No secrets/PII leakage in logs, traces or analytics.
- [ ] Signing-key rotation and incident runbooks exercised.
- [ ] Backup restore and database migration rollback strategy tested.
- [ ] Independent security review has no unresolved Critical findings.
- [ ] Controlled rollout and kill-switch/rollback rehearsed.

## 15. Remaining external decisions and assumptions

The CTO has set the technical defaults in section 7. The following cannot be invented by Identity and remain integration/legal gates:

1. Propo contract: immutable personal/work principal IDs, Seller Account ID, account reservation API, first-device activation, employee-to-seller mapping, event/webhook support and sandbox.
2. Legal/privacy: lawful basis, data controller/processor roles, retention, deletion, data residency, user rights and incident notification requirements for target markets.
3. Support identity proofing: independent evidence standards and human override are intentionally out of v1; no support reset until separately designed and approved.
4. Contact disputes: owner-approved manual conflict resolution exists as a policy; operator roles, evidence checklist, appeal path and SLA must be operationally specified before support tooling.
5. Business financial operation catalogue: the two-person model is approved, but the exact list of actions requiring dual approval and organization-specific limits remains a Business-domain policy gate. Identity only provides authentication/step-up/security signals.

## 16. Definition of done

Identity v1 is done only when:
- every Stage 0–7 exit gate has test evidence;
- each product independently enforces its audience and authorization boundary;
- recovery, global revocation and security holds are proven end-to-end;
- product provisioning is exactly-once in effect despite at-least-once delivery;
- no P0 threat remains open;
- operational owners can detect, contain and recover from the documented incidents.

This document is a threat model and delivery specification, not evidence of implementation. No service, database migration, API, UI, deployment or runtime control is created merely by adding this specification.

**Related documents:**
- [IDENTITY-SERVICE-ARCHITECTURE-V0.1.md](IDENTITY-SERVICE-ARCHITECTURE-V0.1.md)
- [IDENTITY-API-AND-EVENT-CONTRACT-V0.1.md](IDENTITY-API-AND-EVENT-CONTRACT-V0.1.md)
- [IDENTITY-RECOVERY-FLOW-V0.1.md](IDENTITY-RECOVERY-FLOW-V0.1.md)
- [IDENTITY-AND-PRODUCT-ACCOUNT-LIFECYCLE-V0.1.md](IDENTITY-AND-PRODUCT-ACCOUNT-LIFECYCLE-V0.1.md)
