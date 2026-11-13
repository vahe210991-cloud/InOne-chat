# InOne Identity — API and event contract v0.1

**Status:** Technical proposal; pending architecture and security review  
**Date:** 2026-11-13  
**Companion:** [IDENTITY-SERVICE-ARCHITECTURE-V0.1.md](IDENTITY-SERVICE-ARCHITECTURE-V0.1.md)  
**Implementation status:** Contract draft only. No endpoints or schemas are implemented.

## 1. Contract principles

- Base path: `/v1`.
- JSON over HTTPS.
- OIDC Authorization Code + PKCE for interactive first-party clients.
- Identity is the only credential authority.
- Product backends own product accounts and authorization.
- Every mutating request supports an idempotency key where retries are possible.
- Every request/command carries a correlation ID.
- Public APIs never reveal whether arbitrary phone/email values belong to an account.
- Contact claims remain unverified until an actual proof-of-control flow succeeds.
- All machine-to-machine APIs use service credentials and narrow scopes.

## 2. Common response conventions

Success responses include `request_id` and relevant resource/state fields. Errors use a stable machine-readable code and a safe user-facing message.

Example error envelope:

```json
{
  "error": {
    "code": "CONTACT_CLAIM_CONFLICT",
    "message": "These details cannot be used right now. Review the information or contact support.",
    "retryable": false,
    "request_id": "req_..."
  }
}
```

Do not include raw database errors, SQL details, account-existence signals or contact values in errors.

## 3. Registration

### POST /v1/registrations

Entry point: InOne personal registration. Work registration must be invitation-bound and accepted through InOne Business.

Request:

```json
{
  "entry_product": "inone",
  "account_context": "personal",
  "phone": "+4915112345678",
  "email": "person@example.com",
  "password": "user-supplied-secret",
  "client_id": "inone-ios",
  "device": {
    "client_instance_id": "client-generated-random-id",
    "platform": "ios",
    "display_name": "iPhone"
  },
  "terms_version": "2026-11"
}
```

Rules:
- `phone` and `email` required.
- `entry_product=inone` requires `account_context=personal`.
- `entry_product=inone_business` is accepted only with a valid invitation acceptance reference; no open public work registration.
- Product pair is selected server-side from entry point; client cannot request arbitrary product combinations.
- Password never appears in logs, traces or analytics.
- Use idempotency key in request header.

Response:

```json
{
  "identity_id": "uuid",
  "registration_status": "provisioning",
  "provisioning_operation_id": "uuid",
  "product_accounts": [
    {"product": "inone", "context": "personal", "status": "pending_activation"},
    {"product": "propo", "context": "personal", "status": "reserved"}
  ],
  "contacts": [
    {"type": "phone", "verification_status": "unverified", "masked_value": "+49******5678"},
    {"type": "email", "verification_status": "unverified", "masked_value": "p***n@example.com"}
  ]
}
```

If provisioning is asynchronous, return `202 Accepted` and a status resource. Do not return a success state claiming both product accounts exist until both product backends acknowledge.

## 4. Provisioning status

### GET /v1/registrations/{operation_id}

Authenticated identity may read its own operation. Authorized product service may read operations in its service scope.

Response:

```json
{
  "operation_id": "uuid",
  "status": "provisioning",
  "steps": [
    {"product": "inone", "status": "succeeded", "product_account_id": "inone-account-id"},
    {"product": "propo", "status": "pending", "product_account_id": null}
  ],
  "retry_after_seconds": 3
}
```

Never return another identity's operation.

## 5. OIDC and sessions

Use standard OIDC discovery and endpoints:
- `GET /.well-known/openid-configuration`
- `GET /.well-known/jwks.json`
- authorization endpoint using Authorization Code + PKCE;
- token endpoint for code exchange and refresh;
- revocation endpoint;
- end-session/logout endpoint.

Exact standard parameter schemas follow the selected OIDC library/profile. Do not invent a proprietary authorization-code protocol.

Recommended scopes:
- `openid` — required for OIDC;
- `profile` — only minimal central profile claims, if needed;
- product-specific scopes such as `inone.session`, `inone_business.session`, `propo.session` — client authorization request only; product API still enforces its own permissions.

Token audience is chosen from the registered client and server policy, not trusted from arbitrary client input.

### GET /v1/me

Returns central identity summary for the authenticated user:
- `identity_id`;
- identity status;
- masked contacts and verification states;
- enrolled device count;
- product-account links and lifecycle states visible to that identity.

It does not return passwords, hashes, recovery codes, internal risk signals or organization permissions.

## 6. Contact management

### 6.0 Owner-approved unique reservation and conflict handling

Owner decision: **Option A approved (2026-11-13)**. Identity enforces one active claim per normalized phone number and one active claim per normalized email address globally.

API behavior:
- Registration and contact-add operations attempt an atomic uniqueness reservation. Concurrent claims resolve transactionally; only one can succeed.
- If a phone or email is already actively reserved, reject the operation with the generic `CONTACT_CLAIM_CONFLICT` error envelope. Do not reveal which contact matched, the claimant identity, account status or other contact details.
- The API must not offer automatic merge, account linking, transfer or reassignment.
- A conflict may create a restricted support case through an internal workflow. Public endpoints expose only a neutral case/reference state where appropriate.
- Manual resolution is an operator-only, authenticated, least-privilege workflow with audit trail: requester, reviewer/operator, evidence and rationale, affected contact/identity IDs, prior/new claim state, timestamps and resolution outcome. Reassignment is permitted only after explicit authorized resolution; unresolved/ambiguous cases remain blocked.
- The API must never treat unverified contacts, invitation possession or device activation as proof of contact ownership.
- Do not expose an endpoint that allows a user or organization administrator to take over another identity's contact.

### GET /v1/me/contacts

Returns the caller's own contact claims, masked by default.

### POST /v1/me/contacts

Adds a phone/email claim. Requires authenticated session, idempotency key and applicable step-up policy. New contact starts `unverified`.

### DELETE /v1/me/contacts/{contact_id}

Soft-removes/supersedes a contact only if account recovery safeguards remain satisfied. Do not allow deletion of the only recovery-capable authenticator or violate owner-approved mandatory registration data policy without a controlled exception.

### POST /v1/me/contacts/{contact_id}/verification

Reserved for future delivery adapter. Must not report success until an actual challenge has been delivered and validated.

## 7. Device and session management

### GET /v1/me/devices

Lists the caller's devices and active sessions.

### DELETE /v1/me/devices/{device_id}

Revokes the selected device and all its refresh-token families. Require step-up authentication where available. Emit an audit event.

### POST /v1/auth/logout

Revokes current session/token family. Global logout is a separate explicit operation.

## 8. Account recovery and credential security

### POST /v1/recovery/start

Starts a recovery attempt using a phone/email lookup identifier. Always returns the same generic response shape and status whether the identity exists or not. Never returns enrolled authenticator types, masked contacts, claimant details or account existence. Apply per-identity (where resolvable), IP, device and global abuse limits.

### POST /v1/recovery/challenge

Validates a previously enrolled passkey assertion or one unused recovery code. A trusted-device approval is accepted only when the device has an active session and completes fresh passkey/TOTP step-up. An old session or unlocked app alone is not sufficient. On success, issue an opaque single-use recovery grant with a 10-minute TTL, bound to identity, client, device and `purpose=password_reset|authenticator_replacement`.

### POST /v1/recovery/complete

Consumes the recovery grant atomically, sets a new Argon2id password and records the credential change. Revoke all existing refresh-token families/sessions across all product contexts. Issue only a restricted recovery session to the current device. If the grant was created using a recovery code, invalidate the entire previous recovery-code set and require a new set before restoring sensitive Business permissions; place a 24-hour security hold on sensitive operations. A passkey-based recovery does not trigger this hold but still revokes other sessions after password reset.

### POST /v1/recovery/authenticators/replace

Consumes a recovery grant with purpose `authenticator_replacement`, enrolls a new passkey or TOTP authenticator, and revokes only the explicitly selected lost/compromised authenticator records. The operation is single-use, audited and followed by global session revocation. If the grant was obtained with a recovery code, the 24-hour sensitive-action hold applies. Never allow the endpoint to disable the last usable authenticator without enrolling a replacement.

### POST /v1/me/security/recovery-codes

Initial issuance requires recent password re-authentication; if a passkey/TOTP is already enrolled, require it as additional step-up. Rotation requires passkey/TOTP or fresh password re-authentication plus one unused recovery code. Generates 10 one-time codes with at least 128 bits of cryptographic randomness each, displays them once, stores only keyed hashes and invalidates the previous set. A recovery code is consumed atomically and cannot be reused. Recovery codes cannot authorize financial approvals or ordinary step-up actions. Sensitive InOne Business financial permissions require an enrolled passkey or TOTP plus a fresh recovery-code set.

### POST /v1/me/security/sessions/revoke-all

Requires fresh step-up. Revokes all sessions and refresh-token families across InOne, InOne Business and Propo; emits a security event. The caller must authenticate again.

### POST /v1/me/contacts/{contact_id}/change

Requires current session plus fresh passkey/TOTP step-up. Reserves the new normalized contact as a pending change, retains the old claim for a 72-hour cooling period, revokes other sessions and blocks sensitive actions during the pending period. The initiating trusted session may cancel with fresh step-up. On completion, supersede/release the old claim and activate the new claim in one audited transaction. No unverified-contact notification or verification is implied.

### Manual recovery support boundary

Support may open and track a restricted recovery case but v1 has no manual credential-reset override. Unverified phone/email, password knowledge, device activation, invitation possession, organization confirmation or account metadata are not sufficient evidence. A future override requires independent identity proofing, documented evidence standards, trained operator plus independent security approver, immutable audit and a cooling period. If proofing is unavailable or inconclusive, keep access blocked.

Business administrators may reissue a work invitation or manage membership within their delegated authority; they cannot reset central Identity credentials or recover a user's personal InOne/Propo account.

Recovery grants and recovery codes must be single-use, short-lived/hashed as applicable, purpose- and device-bound, rate-limited and protected against concurrent replay. API responses must not permit account enumeration. Never log passwords, raw recovery codes, raw tokens or full contact values.

## 9. Business invitation integration

Invitation lifecycle and membership are owned by InOne Business.

Suggested Business API:
- `POST /v1/business/invitations` — create scoped invitation after Business authorization.
- `GET /v1/business/invitations/{token}/preview` — safe invitation preview, no membership grant.
- `POST /v1/business/invitations/{token}/accept` — authenticated invitee explicitly accepts.
- Business then calls Identity's internal provisioning API.

Identity internal request:

```json
{
  "request_id": "req_...",
  "idempotency_key": "business-invite-acceptance-uuid",
  "identity_id": "uuid",
  "entry_product": "inone_business",
  "account_context": "work",
  "invitation_reference": "opaque-business-invitation-id",
  "requested_products": ["inone_business", "propo"],
  "provisioning_policy_version": "1"
}
```

Identity validates the caller's service identity and allowed scope. It does not decide whether the inviter had sufficient authority or which role/permissions to grant. InOne Business must validate its invitation and membership policy itself.

## 9. Internal product provisioning API

### POST /v1/internal/provisioning/operations

Creates or returns the existing operation for the same idempotency key.

### POST /v1/internal/provisioning/acknowledgements

Product adapter reports successful account creation or a stable retryable/permanent failure.

Acknowledgement:

```json
{
  "operation_id": "uuid",
  "step_id": "uuid",
  "product": "propo",
  "product_account_id": "propo-account-id",
  "account_context": "personal",
  "status": "succeeded",
  "product_contract_version": "1",
  "correlation_id": "corr_..."
}
```

The product backend must guarantee idempotency for `operation_id + product + account_context`. A retry returns the same product account ID.

## 10. Events

Events are versioned and delivered at least once. Consumers must be idempotent. Event envelope:

```json
{
  "event_id": "uuid",
  "event_type": "identity.product_account.provision_requested",
  "event_version": 1,
  "occurred_at": "2026-11-13T12:00:00Z",
  "correlation_id": "corr_...",
  "causation_id": "cmd_...",
  "aggregate_id": "identity-uuid",
  "data": {}
}
```

Initial event catalogue:

| Event | Producer | Consumer | Purpose |
|---|---|---|---|
| `identity.product_account.provision_requested` | Identity | Product adapter/backend | Create or reserve product account |
| `product.product_account.provisioned` | Product | Identity | Confirm product account ID and state |
| `product.product_account.provision_failed` | Product | Identity | Report retryable/permanent error |
| `identity.product_account.status_changed` | Identity | Product adapters/clients as authorized | Notify lifecycle state change |
| `identity.session.revoked` | Identity | Product APIs/gateway | Accelerate revocation propagation |
| `identity.contact.verified` | Identity | Authorized product consumers | Notify verified contact state if needed |
| `identity.credential.changed` | Identity | Product APIs/gateway | Invalidate sessions and require fresh authentication |
| `identity.recovery.completed` | Identity | Product APIs/gateway | Record completed recovery and apply recovery policy |
| `identity.security_hold.placed` | Identity | InOne Business, InOne, Propo APIs | Enforce temporary deny rules for sensitive actions |
| `identity.security_hold.released` | Identity | InOne Business, InOne, Propo APIs | Remove hold after expiry or audited release |
| `identity.contact_change.started` | Identity | Identity clients / security activity | Show pending contact replacement and cooling period |
| `identity.contact_change.completed` | Identity | Authorized product consumers | Update contact-claim state without implying verification |

Events contain identifiers and minimum metadata only. Never publish password hashes, raw tokens, recovery codes or full phone/email values. Product APIs must enforce `identity.security_hold.placed` for sensitive operations and use a current-state check where event delivery may be delayed; do not rely on stale client-side state.

## 11. Product adapter contract

Each product backend must implement:
- create-or-return account by idempotency key;
- reserve account without enabling product access;
- activate account only on product-specific first-device activation;
- return immutable product account ID and lifecycle state;
- reject duplicate identity/product/context mappings;
- accept signed/authenticated commands only from Identity;
- emit acknowledgements with operation and correlation IDs;
- expose reconciliation lookup by operation ID to authorized Identity service.

The product API must not accept a user-supplied `identity_id` without a trusted Identity service credential and server-side authorization.

## 12. Idempotency, retries and error taxonomy

- Store idempotency key and request fingerprint for each operation.
- Same key + same payload returns the same result.
- Same key + different payload returns `IDEMPOTENCY_KEY_REUSED`.
- Retry network/timeouts and product 5xx with exponential backoff and jitter.
- Do not retry permanent validation/authorization errors without operator or caller correction.
- Dead-letter exhausted operations for investigation; allow safe replay after correction.
- Keep partial successes reserved; do not silently delete them.

Initial stable error codes:
- `VALIDATION_ERROR`
- `CONTACT_CLAIM_CONFLICT`
- `REGISTRATION_REQUIRES_INVITATION`
- `INVITATION_INVALID_OR_EXPIRED`
- `AUTHENTICATION_FAILED`
- `SESSION_REVOKED`
- `STEP_UP_REQUIRED`
- `IDEMPOTENCY_KEY_REUSED`
- `PROVISIONING_PENDING`
- `PROVISIONING_FAILED_RETRYABLE`
- `PRODUCT_ADAPTER_UNAVAILABLE`
- `RATE_LIMITED`
- `RECOVERY_CHALLENGE_INVALID`
- `RECOVERY_GRANT_EXPIRED_OR_CONSUMED`
- `RECOVERY_NOT_AVAILABLE`
- `RECOVERY_CASE_PENDING`
- `SECURITY_HOLD_ACTIVE`

## 13. Contract acceptance tests

Before production, automate at minimum:
1. Personal registration creates exactly one InOne personal and one Propo personal account.
2. Repeating registration with same idempotency key creates no duplicates.
3. Work invitation acceptance provisions exactly one InOne Business work and one Propo work account.
4. Existing InOne identity accepting a Business invitation reuses the same central identity and adds work context without merging product data.
5. Propo reservation is inaccessible before Propo first-device activation.
6. InOne device activation does not activate Propo.
7. Access token for InOne is rejected by Business and Propo APIs.
8. Product provisioning partial failure is retried without duplicate account creation.
9. Product backend outage does not falsely report full pair provisioning.
10. Duplicate or conflicting contact claims follow the approved conflict policy without account enumeration.
11. Unverified phone/email cannot recover credentials or approve sensitive actions.
12. Business invitation does not create membership before authenticated explicit acceptance.
13. Business administrator cannot reset central Identity credentials or access personal InOne data.
14. Refresh-token reuse triggers the defined session-family response.
15. Revoked device cannot refresh a session.
16. Recovery start never reveals whether an identity/contact exists.
17. Unverified phone/email cannot complete recovery or receive reset links.
18. Initial recovery-code issuance works for a password-authenticated user who has not yet enrolled passkeys/TOTP; rotation requires a stronger recovery proof.
19. Sensitive Business financial permissions are unavailable until passkey/TOTP and recovery codes are enrolled.
20. Passkey recovery creates a purpose-bound grant and revokes all other sessions after password reset.
21. Recovery-code replay is rejected atomically; use invalidates the complete previous code set.
22. Recovery-code password reset places a 24-hour hold on sensitive actions across all product contexts.
23. A trusted-device approval without fresh step-up is rejected.
24. Support cannot reset credentials in v1 without independent identity proofing and two-person approval.
25. Business administrator cannot recover central Identity credentials.
26. Contact change requires passkey/TOTP step-up, retains old claim for 72 hours and cannot bypass uniqueness conflicts.
27. Authenticator replacement requires a purpose-matched one-use grant and revokes only the selected lost/compromised authenticators.

No endpoint, event or test listed here is implemented by this contract draft.


## 14. Machine-readable Stage 0 contracts

The normative machine-readable v1 contract files are maintained under [architecture/identity/contracts/](identity/contracts/):

- [OpenAPI 3.1](identity/contracts/identity-openapi-v1.yaml) defines public registration, account, contact, device, recovery, internal provisioning and internal security-state endpoints.
- [AsyncAPI 3.0](identity/contracts/identity-events-v1.asyncapi.yaml) defines versioned Identity-to-product events and payload schemas. Delivery is at-least-once from the transactional outbox; consumers deduplicate by event ID and reject stale aggregate versions.
- [Client registry template](identity/contracts/identity-client-registry-v1.template.yaml) records product, platform, context, audience and PKCE policy. It is intentionally non-deployable until app identifiers, domains and exact redirect URIs are confirmed.

The Stage 0 OpenAPI contract adds `GET /v1/internal/identities/{identity_id}/security-state` for product backends to check authoritative active security holds before designated high-risk actions when event freshness cannot be guaranteed. This endpoint returns only minimal security state, not contact or credential data. If Identity cannot confirm state, designated high-risk operations fail closed.

These files describe intended contracts only. No endpoint, event publisher/consumer, client registration or runtime security behavior is implemented by documenting them. Contract validation is automated by `.github/workflows/identity-contracts.yml` and must pass on the exact Stage 0 PR head.
