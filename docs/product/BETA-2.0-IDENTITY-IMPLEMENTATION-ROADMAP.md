# InOne Beta 2.0 — Identity implementation and privacy-preserving identifier plan

**Plan ID:** B2-ID-ROADMAP-001  
**Date:** 2026-11-25  
**Status:** OWNER-APPROVED ARCHITECTURAL DIRECTION; implementation remains gated by contract, evidence and release approvals.  
**Priority:** P0 — foundational platform capability  
**Parent:** [Identity epic #137](https://github.com/vahe210991-cloud/InOne-chat/issues/137)  
**Architecture / contracts:** [#148](https://github.com/vahe210991-cloud/InOne-chat/issues/148)  
**Discovery / migration evidence:** [#147](https://github.com/vahe210991-cloud/InOne-chat/issues/147), [#150](https://github.com/vahe210991-cloud/InOne-chat/issues/150)  
**Phone channel research:** [#153](https://github.com/vahe210991-cloud/InOne-chat/issues/153)  
**Related:** [ADR B2-ADR-001](./BETA-2.0-IDENTITY-ADR-DRAFT.md) · [Phase 1 audit](./BETA-2.0-IDENTITY-PHASE-1.md) · [Threat model](./BETA-2.0-IDENTITY-THREAT-MODEL.md)

---

## 1. Owner-approved architecture decisions

The product owner approved the following direction on 2026-11-25:

1. **Canonical human subject:** Identity-generated, cryptographically random UUIDv4. It is immutable, never recycled and never derived from email, phone, username, provider subject, local product ID, timestamp or other personal attribute.
2. **No global subject exposure by default:** the canonical Identity subject is an internal correlation key. It must not automatically become the identifier exposed to every product, client, API, log, analytics system or integration.
3. **Pairwise product identifiers:** each relying product/client receives an independently generated opaque subject identifier. InOne and Propo must not receive a shared public identifier that lets either correlate a person across products.
4. **Preserve local keys:** existing InOne local account IDs, Propo CUID primary keys, product foreign keys, historical actor values and protocol/idempotency namespaces remain unchanged during the initial Identity rollout.
5. **No wholesale CUID-to-UUID migration:** do not rewrite the Propo schema or the InOne legacy schema merely to standardize key formats.
6. **Separate entity types:** a human Identity subject is not a Propo Seller Account, organization, device, session or product resource. Business principals and delegated relationships are modelled separately.
7. **IDs are not authorization:** knowing any canonical, pairwise or local identifier must never grant access. Every resource operation requires server-side object-, tenant-, membership- and action-level authorization.
8. **Beta boundary:** these decisions govern the Beta 2.0 Identity target. They do not authorize changes to Beta 1.0, PR #135, production data or production settings.

The overall ADR remains DRAFT until the remaining policy, integration and operational decisions are closed. This approval is not authorization to execute a production migration.

## 2. Identifier architecture

### 2.1 Three distinct namespaces

| Namespace | Purpose | Visibility | Format / rule |
|---|---|---|---|
| Canonical human subject | One human across the shared Identity authority | Identity database and explicitly authorized internal services only | UUIDv4 |
| Pairwise product subject | Stable representation of the same human within one product/client security boundary | Only the relevant product/client and its authorized services | Independent random opaque ID; UUIDv4 is the default candidate, never derived from canonical subject |
| Product-local entity ID | Existing product records and relationships | Product backend; expose only where a reviewed API contract requires it | Preserve existing local format (including Propo CUID) |

A product-specific subject is not the same thing as a public resource ID. If a resource needs an external/deep-link identifier, it receives a separate resource identifier under that resource's own threat model. Do not add publicId to every model by default.

### 2.2 Pairwise identifier issuance

- Identity maintains the private mapping from canonical subject to product/client subject.
- Generate each pairwise value independently using a cryptographically secure random generator; never encode or hash canonical subject, email, phone, provider subject or timestamp into it.
- Scope the mapping by an immutable registered client/product security boundary. Do not let arbitrary client IDs be self-asserted by callers.
- Use a stable pairwise subject for the same person within the same approved product/client boundary; use different values across InOne, Propo and any separately registered client boundary.
- Define explicit migration/rotation semantics before changing a pairwise subject. Do not rotate identifiers casually because clients, audit trails and relationships may depend on them.
- OIDC tokens should expose the pairwise subject appropriate to the relying-party sector/client. The internal canonical subject must not be copied into access tokens or ID tokens by convenience.
- Do not expose a cross-product lookup endpoint to ordinary clients. Only tightly authorized Identity workflows may resolve mappings.

### 2.3 Identifier handling rules

- UUIDv4 is opaque, not secret. It is not a password, bearer token, capability or proof of ownership.
- Do not use sequential IDs, CUID1, UUIDv7, ULID, timestamps, email/phone hashes or reversible personal-data encodings for canonical or pairwise public subject identifiers.
- CUID2 does not inherently encode user PII or creation time, but Propo's existing CUID keys remain local implementation details and are not promoted as global Identity IDs.
- Treat identifiers linked to a person as pseudonymous personal data: apply access control, data minimization, retention, export/deletion and logging rules even when the string itself contains no PII.
- Never use an identifier as a substitute for authorization. A UUID is guess-resistant, not access control.

## 3. Target Identity capabilities

The Identity Service and its authoritative database are responsible for:

1. **Subjects and lifecycle:** create, activate, suspend, recover and close canonical human subjects; immutable subject ID; lifecycle audit.
2. **Identifier registry:** atomic cross-product reservation for username/handle, primary email and phone when claimed; normalization versioning; claim verification, expiry, release, cooldown and conflict-safe change.
3. **Credentials:** centrally governed credential records and proof flows, with password/passkey/provider ownership decisions explicit before implementation.
4. **Federation:** exact OIDC (iss, sub) bindings; validated issuer, audience, signature, expiry and nonce; no automatic account merge from matching email/phone.
5. **Pairwise product subjects and local mappings:** private canonical-to-product mapping; explicit local account projection for InOne and Propo; no cross-database foreign keys.
6. **Sessions and devices:** session issuance, refresh-token rotation/reuse detection, revocation and device/session lifecycle.
7. **Verification and recovery:** independent email and optional phone verification; recovery assurance based on verified factors; no pending claim treated as proof.
8. **Business delegation:** separate business principals (including Propo Seller Account) and explicit user-to-business delegated roles/authority.
9. **Security events:** typed human/service actors, tamper-evident audit trail, outbox/inbox, idempotency, reconciliation and abuse signals.

Identity authenticates and issues claims; each product backend remains authoritative for its domain data and must enforce its own authorization policies.

## 4. Mandatory privacy and application-security controls

### 4.1 Prevent account and identifier enumeration

- Use privacy-safe, externally indistinguishable responses for registration, login, recovery, identifier-claim and provider-linking conflicts where revealing account existence is unnecessary.
- Normalize status codes, response shapes and observable timing as far as practical; do not return the other subject's profile, product membership, masked contact data or identifier ownership.
- Rate-limit by multiple dimensions (account/session, source IP/network, device/risk signal, destination identifier and operation); apply progressive friction and abuse monitoring.
- Use generic recovery messages and asynchronous delivery where appropriate. Never reveal whether an email/phone is registered through an unauthenticated lookup.
- Search endpoints must require an authorized product context and return only fields allowed by the product's discovery/privacy policy.

### 4.2 Prevent BOLA / IDOR and cross-tenant access

Every read, write, download, attachment, export, search result and background job must validate:
1. authenticated principal and token issuer/audience/client;
2. requested product and tenant context;
3. object ownership or explicit membership/delegation;
4. permitted action and resource state;
5. field-level disclosure policy where sensitive attributes are involved.

Never trust a client-supplied userId, tenantId, ownerId, role or product identifier without resolving it against the authenticated server-side principal and policy. Query scoping must be enforced server-side, not only hidden in UI. For files, preserve owner/device binding and apply the same authorization resolver to upload, completion, download, attachment, quota and lifecycle operations.

### 4.3 Prevent cross-product correlation and token confusion

- Use separate OIDC client registrations, audiences, scopes, signing/verification policy and product-specific pairwise subjects.
- A valid InOne token must not be accepted by Propo APIs, or vice versa, unless an explicitly designed exchange flow issues a correctly scoped token.
- Validate iss, aud, azp/client, signature, expiry, not-before, token type and required scopes. Reject algorithm/key confusion and unknown key IDs safely.
- Never place canonical subject, email, phone, provider subject or internal mapping IDs in tokens unless a documented, minimized, authorized service contract requires it.
- Do not permit a client to choose its own pairwise sector/client identifier or request arbitrary subject resolution.

### 4.4 Minimize secondary leakage

- Redact access/refresh tokens, verification codes, credentials, recovery secrets and sensitive identifier values from logs, traces, crash reports and analytics.
- Avoid sending canonical or pairwise subject IDs to advertising/third-party analytics. Use purpose-specific analytics pseudonyms where measurement is required.
- Do not include user identifiers or sensitive claims in push payloads or deep links. Use short-lived, one-time, audience-bound references resolved after authentication.
- Protect support/admin search and exports with least privilege, step-up authentication, reason capture, audit and alerting.
- Treat database backups, replicas, event streams, dead-letter queues and observability stores as sensitive identity data stores.

## 5. Delivery phases and gates

| Phase | Scope | Deliverables | Exit gate |
|---|---|---|---|
| 0. Architecture baseline | Confirm approved ID architecture, product boundaries, threat model and current-state evidence | Accepted ADR decisions, C4 context/container diagrams, identifier data-flow and trust-boundary diagrams | Product owner approves remaining policy decisions; no unresolved critical design ambiguity |
| 1. Propo and InOne compatibility discovery | Verify Propo CUID implementation/version, Prisma models/relations/migrations, API exposure and active mobile app tree; inventory InOne local IDs and consumers | Source-backed compatibility matrix; canonical path for mobile; API/deep-link/webhook consumer inventory; no guessed Propo contracts | Evidence linked to exact repository refs; unresolved items explicitly BLOCKED |
| 2. Identity contracts | Define client/product registry, pairwise subject semantics, OpenAPI/AsyncAPI, token/client matrix, errors, idempotency and event ordering | Versioned API/event contracts, OIDC profile, claim lifecycle and mapping contract | Lint/schema validation and owner/security review; contracts preserve local IDs |
| 3. Identity data model and security design | Draft subjects, identifiers/claims, credentials, federation, product mappings, sessions, business principals/delegation, outbox/audit | DDL proposal, data classification, retention matrix, threat mitigations, migration/backfill/rollback design | Concurrency, privacy, authorization and lifecycle invariants reviewed; no production DDL |
| 4. Identity service foundation | Implement isolated service and database in a dedicated feature branch after approval | Subject/claim core, secure ID generation, client registry, key management, health/metrics, audit and transactional outbox | Unit/integration tests; fail-closed behavior; no shadow identity; security review |
| 5. Authentication and federation | Implement OIDC/OAuth flows, password/passkey policy, Google/Apple binding, sessions, refresh/revocation, device lifecycle | Native-client PKCE flow, token validation, provider linking/unlinking and recovery | Negative tests for issuer/audience/nonce/replay/token confusion; step-up and revocation tests |
| 6. Product adapters and pairwise projections | Integrate InOne and Propo without sharing product DBs; provision pairwise subjects and local mappings | Idempotent adapters, inbox/outbox consumers, retries, dead-letter and reconciliation | Both registration directions tested; outage and duplicate/out-of-order event tests; no cross-product subject leakage |
| 7. Legacy account onboarding | Inventory and reconcile existing accounts; preserve local PKs/FKs and historical actor attribution | Dry-run mapping/conflict reports, staged backfill, dual-read/compatibility strategy, rollback/restore rehearsal | Exact-SHA tests on sanitized production-like copy; row/FK/ownership reconciliation; explicit cutover approval |
| 8. Security and abuse hardening | BOLA/IDOR, enumeration, rate limits, privacy, logging, admin, recovery and file ownership review | Security test suite, abuse playbooks, audit alerts, privacy review | No unresolved critical/high findings; evidence-based sign-off |
| 9. Operational readiness and rollout | HA, backups, restore, SLO/RPO/RTO, data residency, incident response, canary and rollback | Runbooks, dashboards, key rotation, disaster recovery proof, staged rollout plan | SRE/security/product acceptance; production rollout separately authorized |

Phases may overlap only where dependencies are satisfied. Do not skip gates to accelerate implementation.

## 6. Detailed implementation work packages

### WP-01 — repository and Propo compatibility evidence
- Verify the exact Propo CUID package/version and generator configuration; distinguish CUID1 from CUID2.
- Inventory every Prisma model, relation, FK, unique constraint, migration and raw SQL dependency.
- Trace every ID across API DTOs, Swagger examples, webhooks, push, deep links, logs and mobile persistence.
- Identify the authoritative mobile app tree by checking workspace/package configuration, build scripts, CI, app entry points and imports; do not choose lib/ or apps/mobile/app/lib/ by directory age or file count.
- Keep Propo primary keys unchanged. Do not mechanically replace Swagger CUID examples until the contract semantics are decided.

### WP-02 — Identity registry and pairwise mapping
- Specify canonical subject lifecycle and UUIDv4 generation at the Identity authority.
- Define pairwise ID scope (product/client/sector), stability, uniqueness, rotation and recovery behavior.
- Define mapping authorization: only Identity-controlled services may resolve canonical-to-product mapping; product clients cannot enumerate mappings.
- Specify local account projection and reconciliation without cross-database FKs.
- Model Propo Seller Account as a separate business principal with delegated relationships.

### WP-03 — identifier claims and account linking
- Finalize global uniqueness and normalization for handle, primary email and optional phone as required by the owner decision.
- Define pending/verified/released/quarantined states, TTLs, race-safe claims, identifier change, recycled phone, handle rename and backup-email policy.
- Use generic conflict responses; no cross-account data disclosure.
- Require proof of control of both identities or a defined recovery/step-up flow before linking; no automatic merge by matching email/phone.

### WP-04 — authentication, tokens and sessions
- Define OIDC/OAuth client matrix and pairwise sub semantics.
- Separate product audiences and scopes; define authorized token exchange only if required.
- Set access-token lifetime, refresh rotation/reuse detection, session/device revocation, key rotation and JWKS caching.
- Define service-to-service workload identity and least-privilege service scopes.
- Preserve Beta 1 authentication until separately approved migration/cutover.

### WP-05 — product authorization and privacy
- Inventory every object access path and test BOLA/IDOR, tenant escape, membership revocation and field-level leakage.
- Standardize server-side authorization context and policy checks; do not rely on opaque IDs or UI filtering.
- Cover files, rooms, organizations, CRM/business resources, search, exports, background jobs and admin endpoints.
- Add enumeration-resistant response behavior, rate limits, privacy-safe telemetry and support-access audit.

### WP-06 — migration, compatibility and mobile
- Preserve local PKs and all existing FKs; add mapping/projection additively.
- Determine the authoritative mobile tree from build/CI evidence.
- Keep client-side IDs as strings where currently required; clients do not generate canonical subject IDs.
- Define compatibility for installed clients, cached records, sync outbox, deep links and push. Do not require a forced destructive cache reset.
- Use versioned API compatibility and staged rollout; legacy identifiers must be accepted only in their documented product context and never interpreted as another product's identifier.
- Require dry-run, backup/restore rehearsal, row counts, FK checks, object-owner checks, event reconciliation and rollback criteria before cutover.

## 7. Required test matrix

- **Identifier generation:** CSPRNG source, format, uniqueness constraint, collision retry, no timestamp/PII derivation, no client-selected canonical ID.
- **Pairwise privacy:** same human gets distinct InOne and Propo subjects; stable within the approved client boundary; canonical ID absent from client-visible tokens/responses unless explicitly authorized.
- **Enumeration:** registration/login/recovery/claim/provider-link conflicts do not reveal whether another account exists; rate limits resist distributed probing.
- **Authorization:** cross-user, cross-tenant, cross-product and revoked-membership attempts fail for every object operation; changing an ID never bypasses policy.
- **Token validation:** wrong issuer/audience/client/scope/type, expired/not-yet-valid token, invalid signature, unknown key, replay and algorithm confusion are rejected.
- **Linking/recovery:** matching email/phone never auto-merges; linking requires step-up/proof; pending phone/email is not a recovery factor.
- **Events:** duplicate, delayed, reordered and retried outbox events are idempotent; poison messages reach controlled DLQ; reconciliation repairs drift without identity duplication.
- **Migration:** all local IDs/FKs, files, MLS protocol identities, idempotency keys, historical audit actors, cached mobile references and deep links remain consistent.
- **Operations:** Identity outage fails closed for new identity operations; Propo outage leaves canonical Identity intact and exposes pending provisioning; restore/key rotation/incident procedures are tested.

## 8. Non-goals and prohibited shortcuts

- No CUID-to-UUID rewrite of Propo primary keys.
- No mass replacement of InOne local IDs or FK columns.
- No global canonical subject exposed indiscriminately to all clients.
- No security-by-obscurity assumption that UUIDs prevent IDOR/BOLA.
- No account merge based only on equal email, phone, username or display name.
- No shared operational database or cross-product direct DB access.
- No product code, production DDL, production data migration, secret, runtime setting or Beta 1.0 change during the documentation/architecture stage.
- No claim that a static repository audit proves production database state or successful migration.

## 9. Open decisions that still block contract/schema freeze

- Exact Propo integration contract, event/API ownership and supported CUID behavior, backed by repository/sandbox evidence.
- Pairwise subject sector boundaries and whether InOne Business is a distinct relying-party client or a first-class platform projection.
- Credential ownership and password/passkey migration.
- Identifier normalization/Unicode, backup email role, pending claim TTL/release, phone reassignment and handle rename/cooldown.
- Account linking/conflict resolution, account closure, legal retention, appeal and deletion.
- Token lifetime/client matrix, service authentication, SLO, RPO/RTO, regions and data residency.
- Exact mobile source-of-truth tree and old-client compatibility policy.

Canonical UUIDv4 approval is **closed**. These remaining items are not implicitly approved by that decision.

## 10. Completion definition

Identity Beta 2.0 is not complete merely because login works or UUIDs exist. Completion requires:
- one canonical subject authority and privacy-preserving pairwise identifiers;
- globally atomic identifier claims under approved policy;
- independently secured InOne and Propo product boundaries;
- no BOLA/IDOR or cross-tenant access in tested object paths;
- no account enumeration or cross-product correlation through identifiers/tokens;
- proven migration compatibility preserving all local relationships and historical attribution;
- reliable outage, event replay, reconciliation, backup/restore and incident handling;
- documented security, privacy, SRE and product-owner acceptance at exact release SHA.
