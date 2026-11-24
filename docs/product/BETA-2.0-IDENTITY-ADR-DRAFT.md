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

1. Canonical subject ID format and immutability guarantees.
2. Identifier types, global/platform-specific uniqueness, aliases, rename/release/tombstone rules.
3. Email/phone verification requirements and whether phone is mandatory.
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
