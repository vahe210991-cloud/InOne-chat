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

## 8. Business invitation integration

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

Events contain identifiers and minimum metadata only. Never publish password hashes, raw tokens, recovery codes or full phone/email values.

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

No endpoint, event or test listed here is implemented by this contract draft.
