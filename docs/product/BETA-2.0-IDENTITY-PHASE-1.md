# InOne Beta 2.0 — Identity Phase 1 execution plan

**Date:** 2026-11-24  
**Status:** CTO technical proposal for owner approval before irreversible implementation or migration.  
**Priority:** P0 — first Beta 2.0 implementation workstream.  
**Tracking issue:** [#137 — Identity Service](https://github.com/vahe210991-cloud/InOne-chat/issues/137)  
**Discovery task:** [#147 — current-state inventory and threat model](https://github.com/vahe210991-cloud/InOne-chat/issues/147)  
**ADR/contracts task:** [#148 — architecture ADR and API/event contracts](https://github.com/vahe210991-cloud/InOne-chat/issues/148)  
**Companion documents:** [Draft ADR](./BETA-2.0-IDENTITY-ADR-DRAFT.md) · [Initial threat model](./BETA-2.0-IDENTITY-THREAT-MODEL.md)

## 1. Current-state audit

### Verified repository facts

- The approved product decision requires InOne and Propo to share one canonical account identity system. Registration from either platform reserves the corresponding account/identifiers for the other platform.
- The approved architecture direction is an independent Identity Service with its own authoritative identity database. InOne and Propo retain separate application backends and domain data.
- If Propo is unavailable while Identity is healthy, InOne registration may succeed with Propo provisioning reported as pending. If Identity/database is unavailable, registration must fail closed with retryable service-unavailable behavior.
- The canonical Beta 1 backend currently contains local email normalization/validation and nickname validation in `inone-development-archive-0.6.0/engine/src/identity-rules.js`. Its `server.js` imports local account, email-code, provider-auth and recovery rules and exposes registration/auth/recovery behavior.
- Repository search and reviewed source do not establish an independently deployed Identity Service, canonical cross-product identity database, or atomic shared identifier reservation mechanism.
- Existing Beta 1 identity/authentication is therefore a baseline to integrate/migrate, not proof that the cross-product Identity requirement is already satisfied.

### Gap assessment

| Capability | Current evidence | Beta 2.0 gap |
|---|---|---|
| Local email/nickname rules | Present in canonical InOne backend | Need central, versioned normalization and collision policy |
| Local registration/login/recovery | Present in InOne backend | Must integrate with canonical identity without breaking Beta 1 |
| Cross-product canonical user | Product decision documented | Independent authoritative service/database not evidenced |
| Cross-product identifier reservation | Product decision documented | Atomic registry, constraints and conflict semantics not evidenced |
| Platform account lifecycle | Desired states documented | Shared lifecycle state machine and APIs not evidenced |
| Async provisioning | Outbox pattern required in decision | Identity-owned transactional outbox/inbox and reconciliation not evidenced |
| Idempotency | Required by decision | Unified operation contract and replay semantics need design |
| Propo integration | Requirements documented | Propo contract, sandbox and ownership confirmation required |
| Migration | Existing accounts in Beta 1 backend | Inventory, mapping, duplicate resolution and rollback plan required |

## 2. Target architecture proposal

### Logical components

1. **Identity API** — public/client-facing authorization and identity operations; versioned contract.
2. **Identity Core** — canonical user lifecycle, identifier claims/reservations, platform-account lifecycle and policy enforcement.
3. **Identity Database** — authoritative records and uniqueness constraints, isolated from product databases.
4. **Credential and Federation module** — password/provider credentials, verification and session/token policy. Exact credential ownership is an ADR decision.
5. **Identity Outbox / Event Publisher** — transactional events committed with identity changes.
6. **Platform Adapters** — InOne adapter and Propo adapter; idempotent inbox/consumer and reconciliation.
7. **Operations plane** — audit trail, metrics, alerts, rate limits, abuse detection and admin workflows.

### Trust boundaries

- InOne and InOne Business are separate clients/products. They may consume the same canonical identity but must receive product-specific authorization/audience and entitlements.
- Propo is an independent platform. Identity integration is via versioned contract, not direct database access.
- Propo Seller Account is not automatically equivalent to a person identity. Model it as an explicit linked business principal/account relationship pending owner confirmation.
- Identity tokens establish authentication claims only. Each application backend remains authoritative for product-specific roles, memberships, tenant access and resource permissions.
- Identity must not store MLS private keys, SQLCipher keys, message plaintext or product domain records.

## 3. Canonical domain model proposal

Names below are logical entities; physical schema and identifier format require an ADR and migration review.

- `CanonicalUser`: immutable canonical subject ID, lifecycle status, created/updated timestamps, version.
- `IdentifierClaim`: type, normalized value, display value, verification state, owner subject, reservation state, source, created/verified/retired timestamps.
- `PlatformAccount`: canonical subject, platform key, state (`RESERVED`, `ACTIVE`, `SUSPENDED`, `CLOSED`), platform-local subject mapping, activation/closure metadata.
- `Credential`: password/provider credential reference, credential status, created/rotated/revoked timestamps; secrets never readable from API.
- `IdentityOperation`: idempotency key, request fingerprint, operation state/result reference, expiry and correlation ID.
- `OutboxEvent`: event ID, aggregate ID/version, event type/schema version, payload reference, created/published/attempt metadata.
- `PlatformLink`: explicit link between canonical identity and external platform account, including Propo Seller Account mapping if approved.
- `SecurityAuditEvent`: actor, subject, action, result, correlation ID, timestamp and minimal safe metadata.

### Identifier policy — decision required

Potential claim types include verified email, verified phone, public username/handle and external provider subject. Do not assume all have the same uniqueness scope.

Before schema freeze, define:
- normalization per identifier type (case, Unicode normalization, IDNA/email handling, phone E.164, reserved names);
- global versus platform-scoped uniqueness;
- whether multiple verified aliases are allowed;
- rename, release, tombstone and cooling-off rules;
- recovery and reassignment controls;
- collision/duplicate-account resolution;
- privacy-safe lookup behavior and enumeration resistance.

Current nickname validation is ASCII-only, 3–20 characters, starts with a letter, allows letters/digits/dot/underscore, rejects repeated dots/trailing punctuation and reserved names. Treat this as existing Beta 1 compatibility behavior until product owner approves a new global policy; do not silently widen or narrow it.

## 4. Registration and reservation transaction

For a registration originating from platform A:

1. Client begins an idempotent registration operation with platform identifier, normalized claims and proof of control.
2. Identity validates the request, verification proof, rate limits and identifier policy.
3. In one Identity database transaction:
   - resolve or create canonical subject;
   - claim verified identifiers under unique constraints;
   - set platform A account to `ACTIVE`;
   - create platform B account reservation as `RESERVED`;
   - append outbox event(s);
   - persist idempotency result and correlation ID.
4. Commit is the authoritative success point.
5. Identity returns the active platform result plus cross-platform provisioning state such as `pending_sync` or `provisioned`.
6. Adapters consume outbox events at least once, deduplicate by event ID/aggregate version, provision/update local platform references and acknowledge in an inbox.
7. Reconciliation finds stale reservations, missing platform projections, failed consumers and identifier drift; retries safely.
8. First successful sign-in to platform B activates the reserved platform account for the same canonical subject. It must not create a second person.

### Failure rules

- Identity DB/API unavailable: retryable 503 with stable error code; do not create local shadow identity.
- Duplicate identifier: deterministic conflict response without leaking the other user's private data.
- Unknown commit result: retry with same idempotency key and request fingerprint; return the original operation result.
- Platform B unavailable: platform A may succeed after canonical transaction commits; B remains RESERVED/pending and is reconciled.
- Duplicate/out-of-order event: idempotent no-op or monotonic update; never regress ACTIVE to RESERVED.
- Partial provisioning: expose operation state; do not claim both platforms are ready.
- Conflicting external accounts: quarantine for explicit resolution; never auto-merge based only on matching email/phone strings.

## 5. Authentication and API contract proposal

Evaluate standards-based OIDC/OAuth 2.1 rather than inventing a proprietary token protocol.

Recommended baseline for ADR:
- Authorization Code + PKCE for native/public clients.
- Short-lived, audience-restricted access tokens signed asymmetrically; publish rotating public keys through JWKS.
- Refresh-token rotation with reuse detection and session/device revocation.
- Strict issuer, audience, expiry, nonce/state, algorithm and redirect URI validation.
- Separate client registrations and scopes for InOne, InOne Business and Propo.
- Service-to-service authentication with workload identity or mutually authenticated credentials; no shared static client secret embedded in mobile apps.
- Product backends validate tokens and independently authorize their own domain resources.
- Explicit account linking/step-up for adding provider identities or external platform accounts.

Candidate API surface (versioned; exact paths and schemas to be finalized in OpenAPI):
- `POST /v1/registrations` — create/replay registration operation.
- `POST /v1/identifiers/verify` — verify proof and claim status.
- `GET /v1/operations/{operationId}` — retrieve provisioning state.
- `GET /v1/me` — authenticated canonical identity projection.
- `GET /v1/platform-accounts` — authorized platform account states.
- `POST /v1/platform-accounts/{platform}/activate` — activate reserved platform slot.
- `POST /v1/credentials/{credentialType}/link` and unlink flow — step-up protected.
- `POST /v1/sessions/revoke` — revoke current/all sessions according to policy.
- Internal event contracts for identity created, identifier reserved/verified/released, platform account reserved/activated/suspended/closed and credential/security changes.

Do not implement this candidate API until OpenAPI, threat model and ADR are reviewed.

## 6. Security, privacy and abuse requirements

- Threat model account takeover, identifier squatting, race-condition registration, account enumeration, replay, token theft/reuse, malicious linking, insider/admin abuse, event spoofing, outbox poisoning and adapter compromise.
- Enforce unique constraints at the database layer and transactionally serialize conflicting claims.
- Rate-limit by source, identifier, device/client and risk signals; add abuse controls without leaking whether a private identifier exists.
- Use verified proof before treating email/phone as owned; external provider subjects are issuer-scoped.
- Use secure password hashing and step-up for credential/link/recovery changes.
- Store only necessary identity attributes; encrypt sensitive data at rest and in transit; separate lookup hashes from encrypted display values where justified by the threat model.
- Audit all security-sensitive operations with safe metadata; never log credentials, OTPs, tokens or full private identifiers.
- Define account deletion, legal retention, suspension and appeal semantics before production.
- Rotate signing keys with overlap; protect private keys in managed KMS/HSM or equivalent.
- Define backup/restore, disaster recovery, RPO/RTO and tested key recovery.
- No admin backdoor or manual identifier reassignment without approval, strong auth, dual control where appropriate and audit.

## 7. Migration and compatibility strategy

1. Inventory Beta 1 users, verified/unverified identifiers, provider links, device/session records, recovery state and account status using metadata only.
2. Build a read-only mapping report; do not export passwords, OTPs, tokens or private keys into planning artifacts.
3. Define deterministic mapping from each existing local user to exactly one canonical subject.
4. Detect collisions and ambiguous links; quarantine them for user/owner resolution. Never auto-merge based on email alone.
5. Add a compatibility adapter in the InOne backend; keep current API behavior stable while identity operations move behind the adapter.
6. Run shadow/read-only reconciliation and compare identity decisions without dual-writing authoritative identity.
7. Migrate in controlled batches with checksums, counts, resumability and rollback/forward-fix plan.
8. Cut over only after load, failure, rollback and recovery drills pass and owner approves.
9. Keep Beta 1.0 operational until the Beta 2.0 Identity release gate is explicitly accepted.

## 8. Work breakdown and acceptance criteria

### ID-01 — Identity discovery, inventory and threat model
**Owner role:** Identity Architect + AppSec  
**Deliverables:** data-flow diagram, trust boundaries, data inventory, abuse cases, risk register, current-to-target mapping.  
**Acceptance:** every identity-bearing table/route/event/provider is inventoried; no assumed Propo internals; threats have mitigations and owners.

### ID-02 — Identity architecture ADR and contracts
**Owner role:** Principal Architect  
**Deliverables:** ADR, C4 context/container diagrams, OpenAPI, AsyncAPI/event schemas, service SLO and failure semantics.  
**Acceptance:** separate DB/backend boundaries, identifier scope, OIDC/token policy, outbox consistency, migration strategy and unresolved owner decisions are explicit.

### ID-03 — Identity database and identifier registry
**Owner role:** Backend/Data Lead  
**Deliverables:** migrations, canonical subject, identifier claim/reservation model, uniqueness constraints, transaction/concurrency strategy.  
**Acceptance:** parallel claim tests prove exactly one winner; rollback and migration tests pass; private identifier enumeration is prevented.

### ID-04 — Identity API and authentication
**Owner role:** Backend/Auth Lead  
**Deliverables:** versioned endpoints, OIDC integration, JWKS rotation, PKCE, audience/scope policy, refresh rotation and revocation.  
**Acceptance:** conformance tests; invalid issuer/audience/nonce/redirect/signature/algorithm rejected; refresh reuse revokes according to policy.

### ID-05 — Cross-platform provisioning and reconciliation
**Owner role:** Distributed Systems Lead  
**Deliverables:** transactional outbox, adapter inboxes, idempotent consumers, retry/backoff, dead-letter/replay, reconciliation dashboard.  
**Acceptance:** crash/retry/duplicate/out-of-order/target-outage tests converge without duplicate accounts or false success.

### ID-06 — InOne and Propo adapters
**Owner role:** Integration Lead  
**Deliverables:** InOne compatibility adapter, Propo contract/sandbox adapter, explicit external account link model.  
**Acceptance:** both registration directions tested; platform B outage does not block canonical reservation; no direct DB coupling.

### ID-07 — Existing account migration
**Owner role:** Data Migration Lead + Security  
**Deliverables:** inventory, conflict report, mapping, batch migration, verification and rollback/forward-fix plan.  
**Acceptance:** 100% records accounted for; no silent merges; credentials/tokens/keys are not exposed; rollback rehearsal passes.

### ID-08 — Security and operational acceptance
**Owner role:** AppSec + SRE  
**Deliverables:** pen-test remediation, abuse limits, audit events, metrics/alerts, backup/restore, incident runbooks.  
**Acceptance:** no unresolved critical/high findings; SLO/DR targets agreed and rehearsed; exact-SHA CI green.

## 9. Identity release gate

Identity Phase 1 is NOT complete until all conditions hold:

- Canonical identity and global identifier policy approved by product owner.
- Independent service and authoritative DB deployed in non-production environment.
- Registration initiated from either platform produces one canonical subject and correct ACTIVE/RESERVED states.
- Identifier races, duplicate requests, retries and unknown commit outcomes are safe.
- Propo outage and Identity outage behavior match the approved failure contract.
- Provisioning recovers after consumer crash, duplicate delivery and prolonged outage.
- Existing Beta 1 accounts have a reviewed migration/compatibility path; no production cutover without approval.
- Authentication, session, provider linking, recovery and revocation security tests pass.
- Privacy, deletion, retention, audit and operational runbooks are accepted.
- Required CI and integration tests pass on one exact SHA.
- Product owner approves the Identity phase exit.

## 10. Explicitly not authorized by this plan

- No production database migration or data export.
- No destructive changes to Beta 1 authentication, account tables, sessions or recovery.
- No shared operational database between InOne and Propo.
- No direct access from one product backend to the other's database.
- No automatic merging of existing accounts.
- No change to Beta 1.0 registration/recovery policy or PR #135.
- No production deployment, secrets mutation or branch-protection change.
