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


## 11. Source-backed current identity inventory — expanded 2026-11-24

Reviewed against current `main` SHA `02880940c1e4d8261405fbeaa01f40879eb44f3a` (not the stale POC sibling tree).

### Runtime and persistence

- `inone-development-archive-0.6.0/engine/src/main.js` is the server entry point. It creates a PostgreSQL pool from `config.databaseUrl`, calls `migrate(pool)`, constructs `createStore({ pool, pinPepper })`, and passes that store into `createServer`.
- `createServer` can default to an in-memory store when no store is supplied; production entrypoint supplies PostgreSQL. Audit all production/bootstrap call sites before extraction so an accidental memory-mode boot cannot occur.
- `inone-development-archive-0.6.0/engine/src/migrate.js` declares `SCHEMA_VERSION = 0033-org-request-document-metadata`, uses `schema.sql` for fresh databases and ordered SQL migrations for upgrades.
- `inone-development-archive-0.6.0/engine/src/schema.sql` contains the local account, profile, provider, phone, verification, token, recovery and device records. Its header still describes a 0.6.0-alpha.1 PoC schema while the migration runner is at 0033; reconcile this provenance/version comment before relying on it as a standalone schema artifact.
- `inone-development-archive-0.6.0/engine/src/store.js` implements persistence for these records. It is a product-local PostgreSQL store, not a cross-platform Identity store.

### Existing identity-bearing records and constraints

| Record | Existing behavior / constraints | Identity extraction implication |
|---|---|---|
| `accounts` | `user_id` primary key; `password_hash` | Existing user IDs are not proposed UUIDs: `account-rules.js` creates `u` + 24 random hex characters. Migration must preserve/map these IDs. |
| `profiles` | `email`, `email_verified`, `nickname`, locale; unique lower(email) for verified rows and unique lower(nickname) | Existing local email/nickname uniqueness; define whether global across products and aliases before centralizing. |
| `phones` | Per-user phone and verification fields; schema has phone uniqueness indexes | Phone uniqueness currently exists within this product DB; central scope and verification/reassignment semantics remain undecided. |
| `provider_links` | PK `(provider, sub)`; unique `(user_id, provider)` | One external subject maps to one InOne account and one provider per InOne account; this is not a cross-platform provider registry. |
| `backup_emails` | One per user and unique lower(email) | Must distinguish primary verified email from recovery/contact alias. |
| `email_codes` | Email-keyed registration code and one-time registration token hashes/expiry | Verification state is currently local to InOne. |
| `auth_tokens` | One-time token hash keyed by kind, optional user and payload, expiry | Must not be confused with future Identity access/refresh tokens. |
| `devices`, `tokens`, `refresh_tokens` | Device-bound access/refresh token hashes and expiry/used state | Device/session lifecycle currently product-local; decide central authentication vs product-specific sessions. |
| `recovery`, `recovery_cancel_codes`, `approvals`, `device_waits` | Recovery windows, cancellation, new-device approvals and delayed activation | Recovery/device trust is coupled to local product data and requires an explicit split/adapter strategy. |

### Existing behavior and test evidence (definitions only)

- `account-rules.js`: `newUserId()` returns `u` + 24 hex chars; password hash uses Node `scrypt` with random salt and 32-byte output; minimum password length is 8.
- `identity-db.test.js`: PostgreSQL-backed test covers email/nickname persistence across server restart and DB-enforced uniqueness. It is conditionally skipped when `DATABASE_URL` is absent.
- `providers-db.test.js`: PostgreSQL-backed tests cover Google provider link persistence, uniqueness of provider subject, one provider per user, password-login disablement after provider linking, and backup email behavior. Also conditionally skipped without `DATABASE_URL`.
- These test definitions are evidence of existing local behavior, **not** evidence that tests were executed in this session or that cross-product identity is implemented.
- Code search for `identity_reservations`, `platform_accounts`, `canonical_user_id`, `identity_service` and `cross_platform_reservation` returned no matching current-main implementation. This is a bounded search result, not a proof that no hidden/private Propo implementation exists.

### Updated CTO gap statement

InOne already has a persistent, product-local identity subsystem with database constraints, password/provider authentication, phone/email verification and device/recovery state. The missing capability is the **independent canonical cross-platform authority and atomic reservation/provisioning layer**. The extraction plan must preserve existing local account behavior and migrate/link local records deliberately; do not rebuild or discard these working mechanisms.

## 12. Dependency graph, migration and startup audit — 2026-11-25

### Direct account foreign keys

Static inspection of engine/src/schema.sql (55 tables) found **29 direct FK columns across 26 tables** referencing accounts(user_id):

| Table | Referencing column(s) |
|---|---|
| devices | user_id |
| pins | user_id |
| recoveries | user_id |
| approvals | user_id |
| recovery | user_id |
| rooms | owner |
| room_members | user_id |
| join_requests | user_id |
| invites | created_by |
| group_assets | created_by |
| phones | user_id |
| profiles | user_id |
| provider_links | user_id |
| backup_emails | user_id |
| device_waits | user_id |
| recovery_cancel_codes | user_id |
| mls_key_packages | user_id |
| mls_welcomes | user_id |
| organizations | created_by |
| org_members | user_id |
| platform_roles | user_id |
| org_requests | applicant_id, decided_by |
| org_request_documents | uploaded_by |
| org_links | proposed_by, decided_by |
| mls_key_package_claims | target_user_id, requester_user_id |
| mls_commit_operations | sender_id |

This dependency boundary prevents direct replacement of local IDs. The first migration should add canonical mapping/projection capability while preserving local accounts.user_id and its FKs. No existing FK is to be redirected until every consumer and rollback path is proven.

### Identity-bearing columns without direct account FK

The schema also contains these identity/actor-like fields without a direct FK to accounts:

- room_events.sender
- auth_tokens.user_id (nullable/ephemeral token context)
- mls_commits.sender_id
- mls_device_removals.user_id (removal/tombstone history)
- mls_client_messages.user_id
- files.owner_id
- flag_changes.actor
- org_request_log.actor
- org_settings_log.actor
- admin_action_log.actor

Do not add FKs mechanically. Decide per field whether it is a live account relation, immutable historical actor snapshot, protocol identifier or tombstone. Specify canonical-to-local mapping, deletion behavior, audit retention and whether a record must remain readable after account closure.

### Migration source audit

- migrate.js declares SCHEMA_VERSION = 0033-org-request-document-metadata.
- The migration marker map contains 32 entries, from 0002-room-capabilities through 0033-org-request-document-metadata.
- migration-integrity.test.js asserts marker/file parity, no duplicate/gapped numeric versions, and equality between SCHEMA_VERSION and the last migration.
- migrate.test.js defines PostgreSQL tests for fresh schema creation, upgrade from the alpha.21 fixture with preserved data, and manually-applied migration detection. These tests are conditional on DATABASE_URL and were **not run** in this repository review.
- The actual applied schema_migrations ledger and live DB FK graph are not present in GitHub source and remain **BLOCKED pending authorized read-only DB inspection**. No live database was accessed.
- The first-line schema.sql comment still labels the file 0.6.0-alpha.1; this is stale provenance text. The runtime migration version is 0033. Reconcile the comment and document that schema.sql is the consolidated fresh-install schema; do not treat the comment as the active database version.

### Startup / in-memory fallback audit

- CLI production entrypoint in src/main.js loads config, creates a PostgreSQL pool and passes it to startServer.
- Exported startServer nevertheless accepts pool = null; when null, it leaves store undefined.
- src/server.js then executes store ?? createMemoryStore({ pinPepper }).
- Existing test/main.test.js intentionally exercises this no-pool mode with nodeEnv: test.
- Production config requires DATABASE_URL, but the exported function does not explicitly reject a production config without a pool. A caller using the exported API could therefore start with ephemeral in-memory state if it passes production config but omits pool. CLI's normal path does pass pool, so this is a hardening gap rather than evidence that current CLI production starts in memory.

**Required remediation:** add a production-only fail-fast guard (config.production && !pool) plus a regression test. Preserve no-pool memory mode for test/development. Track separately; do not change Beta 1 code or PR #135 as part of this documentation-only Beta 2.0 step.

### Phase status after this step

- Repository schema dependency inventory: **SOURCE REVIEW COMPLETE** (26 tables / 29 direct FKs, plus 10 unlinked identity-like columns classified for policy review).
- Migration source integrity: **STATIC REVIEW COMPLETE** (32 marker entries and existing test definitions reviewed).
- Test execution against PostgreSQL: **NOT RUN**.
- Actual database ledger/FK verification: **BLOCKED** (no authorized DB connection/data provided).
- Production startup fail-closed remediation: **OPEN** — tracked in [ID-09 #150](https://github.com/vahe210991-cloud/InOne-chat/issues/150).
- Identity schema/API freeze: **NOT READY** until ID policy, orphan-field semantics, Propo contract and owner ADR decisions are resolved.
- No code, SQL schema, production data, secrets or Beta 1 PR #135 changed.

## 13. Authentication routes and verification-policy audit — 2026-11-25

### Existing InOne route inventory

Reviewed the canonical server.js route blocks and the supporting identity rule modules.

| Capability | Current routes |
|---|---|
| Provider challenge / verification | POST /auth/nonce; POST /auth/provider/verify |
| Provider registration | POST /register/provider |
| Email registration | POST /register/email; POST /register/email/confirm; POST /register |
| Password / provider login | POST /login |
| Session lifecycle | POST /token/refresh; POST /logout |
| Phone management | POST /account/phone; POST /account/phone/confirm |
| Provider linking | POST /account/providers; POST /account/providers/remove |
| Backup email | POST /account/backup-email/start; POST /account/backup-email/confirm; POST /account/backup-email/remove |
| Step-up verification | POST /stepup/email/start; POST /stepup/email/confirm |
| Devices / keys | GET /devices; GET /devices/mine; POST /devices/signing-key; POST /devices/signing-key/remove |
| PIN | POST /pin/set; POST /pin/remove |
| Recovery | POST /recovery/start; GET /recovery/confirm; POST /recovery/confirm; POST /recovery/cancel-by-code; POST /recovery/cancel; POST /recovery/complete |
| Profile projection | GET /profile; PATCH /profile/locale; GET /users/search |

### Existing local policy facts

- Email normalization is trim + lowercase. Email syntax validation is basic and bounded to 254 chars.
- Nickname is ASCII-only, 3–20 chars, starts with a letter, allows letters/digits/dot/underscore, rejects repeated dots/trailing punctuation and reserved names. Treat as Beta 1 compatibility behavior, not the final global identifier policy.
- Email registration code is 6 digits, TTL 10 minutes, max 5 attempts; registration token TTL 30 minutes and one-time.
- Phone code is 6 digits, TTL 10 minutes, max 5 attempts; max 3 sends/hour per account.
- Phone format is normalized to E.164 with country allow/block policy.
- Migration 0008 intentionally creates a unique index over every non-null phone, including pending/unverified claims, to reserve the number before SMS verification. Pending reservation expiry/release semantics require explicit review.
- Google and Apple provider verifier validates RS256 signature, configured issuer, client audience, expiry, subject, one-time nonce and verified email. Provider link key is (provider, sub), with one provider per local user.
- Recovery uses distinct local rules for email-only and phone-verified accounts; Google/Apple-linked accounts use provider authentication rather than password recovery.

### Policy inconsistency requiring owner decision

- Runtime config defaults INONE_REQUIRE_PHONE to true; main.js passes this to createServer. The email/password registration route checks requirePhone.
- Provider registration route /register/provider creates an account from verified provider email and nickname but does not check requirePhone or create a phone claim.
- Existing provider tests assert this no-phone provider registration behavior. Existing direct createServer email tests use the test default requirePhone=false.
- Therefore the code does not demonstrate one consistent mandatory-phone rule across registration methods. This may be an intentional provider exception or a policy gap; do not silently change Beta 1 behavior.
- Phone uniqueness currently reserves pending/unverified numbers as well as verified numbers. A pending claim may occupy a number until explicit change/cleanup; define expiry and release before centralizing phone claims.

Follow-up: [ID-10 #151](https://github.com/vahe210991-cloud/InOne-chat/issues/151). Resolve whether phone is mandatory for all signups, only password signups, or a risk/region policy; define verification levels, recovery implications and pending reservation expiry. Only then freeze global identifier policy and API contract.


## 14. Non-FK identity/actor reference classification — source review 2026-11-25

**Scope/evidence:** canonical Beta 1 source at main baseline `02880940c1e4d8261405fbeaa01f40879eb44f3a`; files reviewed: `inone-development-archive-0.6.0/engine/src/schema.sql` and `src/store.js`. This is a source-level semantic classification, not a live database inventory. The applied production schema and actual row distributions remain unverified.

| Field | Observed role from schema/store | Classification | Migration / target policy |
|---|---|---|---|
| `room_events.sender` | Sender attribution stored on durable room events; store reads it for event history and writes it on append. Redaction stores `redacted_by` in event content. | Immutable event actor reference / historical snapshot. | Preserve original local sender value for historical compatibility. Add a canonical-subject mapping/projection for cross-product display and authorization where required. Do not cascade-delete events or rewrite sender strings in place. |
| `auth_tokens.user_id` | Nullable subject association on short-lived nonce/registration/provider-auth tokens; tokens are consumed by deleting the row and returning user_id/payload; expired tokens are purged. | Ephemeral live reference, not durable identity history. | Do not migrate outstanding tokens as durable identity. At cutover revoke/delete outstanding auth tokens and require flow restart; issue new tokens against canonical subject after migration. |
| `mls_commits.sender_id` | Sender attribution on durable MLS epoch commits; stored with protocol commit bytes and returned in commit history. | Immutable protocol actor reference / historical snapshot. | Preserve exact legacy sender ID for protocol/history compatibility. Add a separate canonical-subject mapping only if a product feature needs cross-platform attribution. Never mutate signed/committed protocol artifacts to replace IDs. |
| `mls_device_removals.user_id` | `mlsRecordDeviceRemovals(userId,...)` inserts the member being removed from MLS device membership; pending rows drive completion. | Live operational subject while pending; protocol tombstone after completion. | Resolve through local-to-canonical mapping while pending. Preserve completed removal records as tombstones. Do not interpret this field as the actor who initiated removal. |
| `mls_client_messages.user_id` | Part of primary key `(room_id,user_id,client_message_id)`; scopes message idempotency/reservation and supports pending/done/release logic. | Live protocol idempotency namespace with durable dedupe history. | Keep the original local user ID in the existing keyspace during migration; do not rewrite primary keys or collapse dedupe namespaces. New canonical IDs require an explicit versioned idempotency design and coexistence period. |
| `files.owner_id` | Owner attribution on file records; used by file ownership/access and lifecycle code. | Live ownership/security reference; may need retained tombstone after account closure. | Resolve to canonical subject through the mapping projection for authorization. Preserve local owner ID until every dependent file/object/ACL path is migrated. Define retention/transfer/deletion separately; never orphan or silently reassign ownership. |
| `flag_changes.actor` | Actor recorded with feature-flag old/new values and reason; read by history tooling. | Administrative audit snapshot; may represent a human or automation principal. | Preserve historical actor string. For new events store typed actor identity (human canonical subject vs service principal) in additive columns/metadata; do not force every actor to be an account. |
| `org_request_log.actor` | Log rows are written for applicant creation, document upload and request decisions; actor is a user reference at event time. | Historical audit snapshot. | Preserve original actor value and event ordering. Add canonical subject mapping where provable; retain unresolved/deleted actors as historical references, not nulls. |
| `org_settings_log.actor` | Actor recorded with organization setting changes and returned by audit-history reads. | Historical audit snapshot. | Preserve actor and log rows. New writes should carry typed actor identity and canonical subject where available; no cascade deletion. |
| `admin_action_log.actor` | Actor recorded for administrative actions across organization membership, roles, links and settings. | Historical audit snapshot; human/service actor distinction must be explicit. | Preserve legacy actor value. New contract must distinguish canonical human subject, service principal and system actor; keep audit evidence after account closure. |

### Cross-cutting migration rules

1. Keep each Beta 1 local `accounts.user_id` stable. The 29 existing FK columns and these ten non-FK fields make a direct in-place replacement unsafe.
2. Use an explicit local-to-canonical subject mapping/projection, keyed by product/tenant and local user ID, with a unique canonical subject association and audited lifecycle. Do not create cross-database foreign keys.
3. For live ownership/authorization fields, resolve the local account through the mapping while retaining local IDs during compatibility. For historical/protocol/audit fields, preserve the original actor value and add canonical attribution only as a separate, verifiable projection.
4. Never infer canonical identity from an email/phone string or actor display text. Map only through an approved, proof-backed migration record.
5. Preserve deleted/closed actor attribution in durable events and audit records. Account deletion must not rewrite history; apply an approved pseudonymization/retention policy instead.
6. Outstanding short-lived `auth_tokens` should be invalidated at cutover, not carried across identity namespaces.
7. Keep `mls_client_messages` idempotency keys and protocol sender fields stable. A change to those namespaces needs a separate compatibility protocol and test plan.
8. No schema or data change is authorized by this classification. It informs future design only.

### Remaining evidence gaps

- No authorized read-only query against a live/non-production database was performed; actual FK graph, row counts, nullability and actor-value distributions remain UNKNOWN.
- File authorization/deletion lifecycle and all external object-storage references need a dedicated call-path audit before defining account closure semantics.
- `flag_changes.actor` and `admin_action_log.actor` accepted value formats need inspection of CLI/admin callers to enumerate service/system identities.
- MLS historical retention and room-event deletion/redaction semantics need product/privacy policy approval.
- This classification does not close #150; its DB ledger, exact-SHA migration tests and production fail-fast regression remain outstanding.


## 15. Canonical subject identifier — recommendation for owner decision

The architecture proposal recommends an opaque UUIDv4 generated only by the Identity Service as the immutable canonical subject ID. UUIDv4 avoids embedding a creation timestamp in a subject identifier; UUIDv7 and ULID offer chronological/index locality but expose approximate creation time. Sequential IDs are enumerable; IDs derived from email/phone are linkable and unsafe; reusing Beta 1 local IDs would make legacy InOne the identity authority.

If approved, canonical IDs must never be recycled or reassigned, must not be treated as credentials, and must remain separate from each product's local account ID via an explicit mapping. The full alternatives and invariants are recorded in the ADR draft. **This is a technical recommendation, not an owner decision.** DDL/OpenAPI subject fields remain provisional until the owner approves the format.
