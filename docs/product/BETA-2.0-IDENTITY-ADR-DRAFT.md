# Draft ADR — Independent Identity Service for InOne, InOne Business and Propo

**ADR ID:** B2-ADR-001  
**Date:** 2026-11-24  
**Status:** DRAFT — technical recommendation; requires product-owner approval before implementation freeze.  
**Decision owner:** Product owner  
**Related tracking:** [Beta 2.0 Identity issue #137](https://github.com/vahe210991-cloud/InOne-chat/issues/137)

## Context

The approved product direction requires InOne and Propo to share one account identity system. Registration from either side reserves the corresponding identity/identifier on the other side. InOne and InOne Business are separate applications. Product decisions also require independent application backends and domain data, and require InOne to remain usable when Propo's backend is unavailable.

The current canonical InOne Beta 1 backend contains local email/nickname rules and local authentication, registration and recovery flows. The reviewed source does not establish a standalone cross-product Identity authority or central reservation database.

## Proposed decision

1. Build a separately deployable **Identity Service** with its own authoritative identity database.
2. Use one immutable canonical subject ID for a person across participating platforms.
3. Store only identity/security data needed for authentication, verification, identifier reservation and platform-account lifecycle.
4. Keep InOne, InOne Business and Propo application backends and domain databases independent.
5. Integrate through versioned OIDC/OAuth 2.1 and service-to-service APIs/events. Product backends remain responsible for their own authorization and domain permissions.
6. Enforce identifier claims/reservations with database uniqueness constraints and atomic transactions.
7. Create platform account projections using a transactional outbox and idempotent inbox/consumers; never rely on best-effort dual writes.
8. Treat Identity commit as the authoritative registration success point. If Identity is unavailable, fail closed. If another platform is unavailable after the Identity commit, return explicit pending provisioning status and reconcile.
9. Migrate existing Beta 1 accounts only after inventory, conflict resolution, compatibility, rollback and owner approval.

## Proposed lifecycle

- `RESERVED`: canonical identity and platform slot are reserved; the platform account is not activated.
- `ACTIVE`: the user has activated the platform account.
- `SUSPENDED`: platform access is disabled pending review/recovery.
- `CLOSED`: platform account is closed under an approved retention/deletion policy.

State transitions must be monotonic where appropriate and audited. A duplicate/out-of-order event must not regress ACTIVE to RESERVED.

## Proposed standards baseline

Evaluate and, if accepted, implement:
- OIDC / OAuth 2.1 Authorization Code + PKCE for native/public clients.
- Short-lived asymmetric access tokens with issuer/audience/scope validation and JWKS key rotation.
- Refresh-token rotation, reuse detection and device/session revocation.
- Separate client IDs, audiences and scopes for InOne, InOne Business and Propo.
- Workload identity or mutual authentication for service-to-service calls.
- OpenAPI for synchronous APIs and AsyncAPI for durable event contracts.

This is a proposed standards baseline, not an approved final token policy. The exact issuer, claims, token lifetime, grant matrix and service authentication method must be reviewed in the threat model.

## Consequences

### Positive
- One authoritative identity and identifier reservation system.
- No cross-product database coupling.
- Product backend outages do not invalidate canonical identity.
- Registration retries and platform provisioning become observable and recoverable.
- Product-specific authorization remains isolated.

### Costs / risks
- Identity becomes a critical shared dependency for new registrations and authentication operations that require it.
- Requires secure high-availability operation, key management, backup/restore, monitoring and incident response.
- Requires careful migration of existing Beta 1 accounts and provider identities.
- Requires Propo-side contract and sandbox collaboration.

## Alternatives rejected

- **Shared operational database:** rejected; violates product/backend independence and creates unnecessary coupling.
- **InOne backend as identity owner:** rejected; Propo would depend on InOne application availability/ownership.
- **Propo backend as identity owner:** rejected; InOne availability would depend on Propo, explicitly disallowed.
- **Best-effort local duplicate accounts:** rejected; permits split-brain identities and identifier races.
- **Synchronous dual write to both product databases:** rejected; partial failure cannot be made atomic across independent systems without a distributed transaction and creates availability coupling.
- **Automatic merge by matching email/phone:** rejected; verified identifiers alone do not prove account ownership equivalence across historical accounts.

## Decisions required before ADR acceptance

2. Identifier types, global/platform-specific uniqueness, aliases, rename/release/tombstone rules.
4. Credential ownership: central password credential versus federated-only identity; treatment of existing password hashes.
5. Account linking, duplicate-account resolution and step-up policy.
6. Propo Seller Account relationship cardinality and delegated authority.
7. Account suspension, deletion, retention and recovery/appeal policy.
8. Availability/SLO, RPO/RTO, deployment region and data residency.
9. Whether Identity owns user-facing profile attributes or only authentication identifiers.

## Acceptance criteria

- Product owner approves this ADR and the unresolved decisions are closed or explicitly deferred.
- OpenAPI/AsyncAPI contracts and threat model are reviewed.
- Database schema enforces uniqueness and state invariants.
- Failure semantics are demonstrated by integration/fault-injection tests.
- No implementation path creates shadow identities or direct cross-product DB access.


## Current InOne identity implementation baseline (source review)

The existing InOne backend is not identity-empty. Its production entrypoint `src/main.js` initializes PostgreSQL, runs migrations and injects a persistent `createStore` into `createServer`. Local identity records include `accounts`, `profiles`, `phones`, `provider_links`, `backup_emails`, `email_codes`, `auth_tokens`, device/session records and recovery/approval state. Current schema version in `migrate.js` is `0033-org-request-document-metadata`; `schema.sql` has a stale alpha.1 header that must be reconciled.

The target Identity Service must therefore be introduced as an authority alongside the existing product-local identity projection, then integrated through an adapter and carefully migrated. It must not simply relocate `accounts` or change local user IDs: many existing product tables reference local `accounts.user_id` via foreign keys, including rooms/organizations/device/MLS state. The product-local account row and subject mapping should remain until a separately approved migration plan proves safe.

Existing PostgreSQL tests cover local email/nickname uniqueness and provider-link persistence across restart. They do not prove cross-product reservation or central Identity availability.


## Approved product decision: phone is optional (2026-11-25)

The product owner approved this policy for the Beta 2.0 global Identity design:

1. A phone number is **not mandatory** to create a canonical Identity, whether registration starts with email/password or a verified Google/Apple identity.
2. A verified email or provider-verified email may establish the initial account identity under the relevant proof flow. This does **not** mean the phone number is verified.
3. Phone is an independent optional identifier and optional additional contact/recovery channel. It may be used for phone-based recovery only after separate successful phone verification and subject to the approved recovery policy.
4. An unverified/pending phone claim must never be represented as verified, used as a recovery factor, or treated as proof of account ownership.
5. Global uniqueness, cross-product reservation, pending-claim expiry/release, and phone-based recovery assurance remain technical/policy details to be specified and threat-modelled before implementation.
6. This decision applies to the new Beta 2.0 Identity design. It does **not** authorize changing Beta 1.0 registration behavior or its INONE_REQUIRE_PHONE setting. Any Beta 1 change requires separate explicit approval.

This reduces exclusion for users in countries where phone delivery is unavailable or unreliable. Optional phone verification still requires an international delivery strategy, abuse controls, cost controls and country-specific compliance.

## Remaining decisions required before ADR acceptance

The remaining open decisions are: identifier uniqueness/rename/release/tombstone rules; central credential ownership; account linking and duplicate resolution; Propo Seller Account relationship; suspension/deletion/retention/recovery policy; availability and data residency; profile ownership; and phone verification channel, country coverage, cost ceiling and fraud controls.


## Canonical subject ID — owner-approved decision (2026-11-25)

**Owner-approved decision:** use a cryptographically random UUIDv4 as the immutable canonical subject identifier (`sub`) generated only by the Identity Service. Do not derive it from email, phone, nickname, provider subject, local Beta 1 user ID, timestamps or other user attributes.

### Rationale

- UUIDv4 is opaque and does not encode account creation time, region, phone, email or another personal attribute.
- UUIDv4 is globally unique enough for the expected product scale and supported by PostgreSQL, common application runtimes and OIDC subject claims.
- It allows Identity to remain the single ID authority while product-local IDs remain stable behind explicit mapping rows.
- It avoids exposing the creation timestamp embedded in UUIDv7/ULID-like identifiers. Creation and ordering timestamps belong in separate audited columns.
- It is not a credential: possession of a subject ID grants no authority. Authorization must always rely on validated tokens and product policy.

### Alternatives

| Option | Benefits | Costs / risks | Recommendation |
|---|---|---|---|
| UUIDv4 | Opaque, random, no embedded timestamp, broad support | Random-index write locality may be weaker than time-ordered IDs | **Preferred** for privacy/opacity |
| UUIDv7 | Time-ordered, better index locality and operational sorting | Exposes approximate creation time; needs clock/monotonicity discipline | Acceptable only if owner prioritizes index locality over timestamp opacity |
| ULID | Sortable and compact text representation | Timestamp disclosure; encoding/case rules need standardization | Not preferred |
| Sequential integer / BIGSERIAL | Compact and index-friendly | Enumerable, leaks population/order, central allocation pressure | Reject for public canonical subject |
| Derived hash of email/phone | Deterministic | Linkability, dictionary attacks, identifier changes and privacy leakage | Reject |
| Reuse local Beta 1 ID | Avoids immediate mapping for InOne | Not globally authoritative; ties cross-product identity to legacy implementation | Reject |

### Invariants if approved

1. Canonical subject ID is immutable and never recycled, including after account closure.
2. Identity Service is the only issuer; clients cannot choose or override it.
3. IDs are opaque references, not authentication secrets.
4. Each platform keeps its existing local account ID and stores an explicit mapping to canonical subject.
5. Mapping uniqueness is enforced in the Identity-owned registry; no cross-database FK is attempted.
6. Subject ID is not reassigned on email/phone change, provider unlink, account rename, suspension or recovery.
7. Account closure retains a tombstone/minimal mapping according to the separately approved retention policy.

**Decision status:** OWNER-APPROVED on 2026-11-25. UUIDv4 is the canonical human subject ID. UUIDv7 is not selected. The remaining ADR decisions listed above still block final DDL/OpenAPI/AsyncAPI freeze.
 

## Global identifier registry — technical proposal pending remaining policy approval (2026-11-25)

The product-owner source decision `docs/PRODUCT-DECISIONS-IDENTITY-LOCALIZATION-DESIGN.md`, section 1, explicitly requires central atomic reservation of normalized username/handle, email and phone as applicable, in both InOne→Propo and Propo→InOne registration directions. This is stronger than merely sharing a login: identifier claims must belong to one canonical subject and survive the other platform's outage.

### Proposed scope and semantics

| Identifier | Proposed uniqueness scope | Claim/verification semantics | Important caveats |
|---|---|---|---|
| Username / handle | Global across InOne and Propo, as required by the owner decision | Reserve atomically for the canonical subject; normalized form drives uniqueness; product projections may show the same handle | Preserve Beta 1 ASCII validation until a separate Unicode/rename policy is approved. InOne Business participation in the global namespace still needs owner confirmation. |
| Primary email | Global across the shared Identity namespace | Pending reservation during registration proof; only verified claim is a trusted contact/recovery identifier | Current InOne uses trim+lowercase and a unique index on lower(email) for verified profiles. Target email normalization and internationalized-address policy need an explicit standard. |
| Phone | Global across the shared Identity namespace only when claimed; optional for registration | Pending claim is short-lived and not verified; verified claim is an optional contact/recovery channel | Owner approved phone optional for every Beta 2.0 registration method. Pending TTL/release and phone-reassignment policy remain open. |
| Federated provider subject | Global by exact OIDC `(issuer, sub)` pair | Proof comes from validated provider ID token; unique binding to one canonical subject | Do not key only by provider display name. Issuer scoping matters; client/team-specific provider subject behavior must be checked. Provider email equality must not auto-merge an existing account. |
| Backup / secondary email | Global only if product owner wants it to block primary email claims; otherwise a separate verified contact claim with the same canonical ownership model | Verified independently; not automatically primary login identifier | Existing Beta 1 backup_emails has its own global unique lower(email) index but separate semantics. Confirm target policy. |
| Product-local account ID | Product-local only | Mapping to canonical subject; never reused as canonical identity | Keep Beta 1 local IDs and all existing FK relationships stable during migration. |
| Propo Seller Account / organization ID | Business-principal namespace, not a person's username/email/phone | Explicit relationship between a person subject and a business principal, with roles/delegation | Do not collapse a seller/business account into a human canonical subject. Cardinality and authority need Propo contract evidence. |

### Required registry behavior

- Use one atomic claim transaction and database uniqueness constraints for all globally unique active claims. A platform outage must not release or bypass the central reservation.
- Make normalization deterministic and versioned. Store original/display value separately from normalized lookup value; never silently change normalization algorithm in-place.
- Model claim state explicitly (at minimum pending, verified, released/quarantined) with source, verification method, timestamps, expiry and audit correlation.
- Pending claims must have bounded expiry and safe release. Verified claims persist until a proof-backed change/removal flow succeeds.
- Identifier change should claim and verify the replacement before releasing the old claim, to avoid account lockout and takeover races.
- Phone number reassignment is expected in the global telecom ecosystem; do not tombstone every phone forever. Define risk-based cooling-off and re-verification before reclaim.
- Username/handle rename/release needs a separate anti-squatting and impersonation policy; preserve reserved-name controls and historical redirect/tombstone rules.
- Duplicate claim responses must not disclose the other subject's account details.
- Never merge accounts automatically because email or phone strings match. Existing-account linking requires authentication/step-up proof of both sides or a recovery process.
- Provider binding key should be exact `(iss, sub)`; unlink requires step-up and must not strand a federated-only account without another approved credential/recovery path.

### Open product boundary

The source decision explicitly names InOne and Propo. The current ADR also includes InOne Business as a participating product. Confirm whether InOne Business is:
1. a first-class platform-account projection in the same canonical registry; or
2. a separate client relying on the person's canonical Identity, while Propo Seller Account remains a linked business principal.

Recommendation: use the same human authentication subject for InOne and InOne Business, but keep their product-account state, roles and domain permissions separate; model Propo Seller Account as a business principal linked to one or more human subjects. This is a recommendation pending the Propo contract and owner approval.

**Decision status:** technical proposal. The InOne↔Propo global username/email/phone reservation requirement is source-backed; the detailed claim lifecycle, backup-email policy and InOne Business participation remain to be approved. Do not freeze DDL/OpenAPI until the open points are resolved.


## Owner-approved privacy-preserving identifier architecture — 2026-11-25

The product owner approved the architecture recorded in [BETA-2.0-IDENTITY-IMPLEMENTATION-ROADMAP.md](./BETA-2.0-IDENTITY-IMPLEMENTATION-ROADMAP.md):

- UUIDv4 is the immutable Identity-generated canonical human subject ID.
- The canonical ID is internal and is not exposed indiscriminately to products, clients, APIs, analytics, logs or integrations.
- InOne and Propo receive distinct, independently generated pairwise product subject IDs within their registered relying-party boundaries. A pairwise ID is stable only within its approved boundary and is never derived from the canonical ID or personal attributes.
- Existing InOne local IDs, Propo CUID primary keys, product FKs, historical actor values and protocol/idempotency namespaces remain unchanged in the initial rollout.
- Public resource IDs are a separate decision; do not add a public UUID column to every model by default.
- IDs are references, not credentials. Every operation requires server-side object-, tenant-, membership- and action-level authorization. BOLA/IDOR prevention, enumeration resistance, token audience isolation and telemetry minimization are mandatory controls.
- Propo Seller Account remains a separate business principal connected through explicit delegation, not a human Identity subject.

This owner approval closes the canonical subject format decision. It does not approve production schema changes, data migration, Beta 1.0 changes, or the still-open policy items in the implementation roadmap. ADR B2-ADR-001 remains DRAFT until those items and the integration/operational contracts are reviewed.
