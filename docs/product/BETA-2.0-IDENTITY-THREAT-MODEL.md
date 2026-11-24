# Identity Phase 1 — initial threat model and data-flow inventory

**Date:** 2026-11-24  
**Status:** Initial source-based model; must be refined with Propo architecture and product-owner decisions.  
**Tracking:** [#137 Identity Service](https://github.com/vahe210991-cloud/InOne-chat/issues/137)

## 1. Scope and trust boundaries

### In scope
- Canonical person identity and identifier ownership.
- Email/phone/provider verification and credential linking.
- Platform-account reservation and activation.
- Identity-issued authentication assertions/tokens.
- Cross-platform provisioning events and reconciliation.
- Existing InOne account migration and conflict handling.
- Identity administration, audit, recovery and deletion lifecycle.

### Out of scope
- Product-specific roles, organization membership, CRM permissions and resource authorization.
- Product operational data and message content.
- MLS group state, private keys, SQLCipher keys and device-local encrypted message storage.
- Propo Seller Account business data, except an explicitly approved identity-link reference.

### Trust boundaries
1. Native clients (untrusted public clients).
2. Identity public API.
3. Identity private core and authoritative database.
4. Identity event publisher / broker.
5. InOne backend adapter and local domain database.
6. InOne Business backend adapter and local domain database.
7. Propo adapter/backend (external integration boundary).
8. Identity operators and privileged administration.
9. Email/SMS/provider identity proof systems.
10. KMS/HSM and token-signing key boundary.

## 2. Initial logical data flow

1. A client begins registration with a platform identifier and an idempotency key.
2. Identity validates client/platform, request schema, proof-of-control, rate limits and identifier policy.
3. Identity transactionally creates/resolves the canonical subject, claims identifiers, activates the origin platform, reserves the other platform, stores operation result and appends outbox event(s).
4. The client receives success only after the Identity transaction commits; the response distinguishes local ACTIVE from remote RESERVED/pending_sync.
5. Outbox publisher emits a versioned event. Platform adapter authenticates the event, deduplicates by event ID/aggregate version, applies a local projection and records inbox acknowledgement.
6. Reconciliation scans for stale/missing projections and replays safely.
7. First successful authentication on a reserved platform activates that platform slot for the same canonical subject.

No product backend reads another product's database. No client directly accesses the Identity database.

## 3. Threat register

| ID | Threat / abuse case | Impact | Required controls / evidence |
|---|---|---|---|
| IAM-01 | Concurrent registration claims same email/phone/username | Duplicate identity or identifier takeover | Unique DB constraints, serializable/locked claim transaction, race tests |
| IAM-02 | Identifier enumeration through login/register/lookup | Privacy breach and targeted phishing | Generic responses, rate limits, proof-gated details, timing review |
| IAM-03 | Email/phone verification replay or brute force | Account takeover | Short TTL, one-time use, attempt limits, hashed OTP storage, resend throttles |
| IAM-04 | Idempotency key reused with altered payload | Confused-deputy / wrong account result | Bind key to request fingerprint and client/platform; conflict on mismatch |
| IAM-05 | Identity commit succeeds but response times out | Duplicate accounts on retry | Durable operation record; same-key replay returns original result |
| IAM-06 | Propo/adapter outage or prolonged queue lag | Split platform state, false activation claim | Outbox, retry/backoff, pending_sync state, lag alerts and reconciliation |
| IAM-07 | Duplicate/out-of-order/spoofed platform event | Incorrect platform lifecycle or unauthorized provisioning | Signed/authenticated transport, event IDs, aggregate versions, inbox dedup, schema validation |
| IAM-08 | Refresh token theft/reuse | Persistent session compromise | Rotation, reuse detection, revocation, device/session inventory, short-lived access tokens |
| IAM-09 | JWT algorithm/issuer/audience confusion | Token accepted by wrong service | Strict allowlist, issuer/audience/client validation, JWKS rotation and negative tests |
| IAM-10 | Malicious account linking/provider substitution | Attacker links victim identity to own account | Recent-auth step-up, provider nonce/state, issuer-scoped subject, proof of both accounts |
| IAM-11 | Automatic merge based on matching email/phone | Wrong historical accounts merged | No automatic merge; explicit proof and audited conflict resolution |
| IAM-12 | Privileged operator reassigns identifier or changes status | Account theft / insider abuse | Strong MFA, least privilege, dual control for high-risk actions, immutable audit |
| IAM-13 | Outbox payload leaks private attributes | PII exposure to adapters/logs | Data minimization, opaque subject/claim refs, encryption, schema review |
| IAM-14 | Signing key compromise | Forged identity tokens | KMS/HSM, key rotation, revocation strategy, restricted workload access |
| IAM-15 | Migration maps multiple local users to one subject | Data exposure across accounts | Read-only inventory, collision quarantine, deterministic mapping, checksums and rollback |
| IAM-16 | Identity service outage / DB corruption | New registration/auth flows unavailable | HA, backups, restore drills, RPO/RTO, fail-closed contract and status monitoring |
| IAM-17 | Account deletion does not propagate | Retained personal data / stale access | Explicit lifecycle event, per-platform deletion acknowledgements, retention/legal hold policy |
| IAM-18 | Platform token accepted as product authorization | Cross-tenant/resource access | Separate audiences/scopes; product backend performs resource-level authorization |

## 4. Security invariants

- No identifier is considered verified merely because a user typed it.
- No identifier ownership is transferred by string equality or a provider email claim alone.
- No cross-platform account is reported ACTIVE until the authoritative lifecycle confirms it.
- No product service has direct database credentials for another product's domain database.
- No platform adapter can mutate arbitrary Identity state; use narrow event/API permissions.
- Every state-changing identity operation is authenticated, authorized, idempotent and audited.
- No secrets or full OTP/token/credential values are written to logs or analytics.
- Token signing keys are isolated from application database credentials and rotated with overlap.
- Product-specific authorization is evaluated in the receiving product backend.
- Failure of the authoritative Identity commit is never converted to a local success response.

## 5. Data inventory — known vs unknown

### Known from current InOne source review
- Email is normalized by trimming and lowercasing in local backend rules.
- Nickname validation is ASCII-based, 3–20 chars, starts with a letter, and allows letters, digits, dot and underscore with reserved-name and punctuation checks.
- Canonical Beta 1 backend imports local account, email-code, provider-auth and recovery rules.
- Current owner decisions require cross-platform canonical identity and identifier reservation.

### Unknown / must be inventoried
- Exact current database tables and indexes holding user identity, credentials, provider subjects, devices, recovery state and audit history.
- Whether phone is mandatory for every account and the exact verification status semantics.
- Existing uniqueness constraints and collation behavior in PostgreSQL.
- Full set of provider issuers/subjects and whether provider identity is linked to verified email.
- Propo-side account schema, account-link model, identifier policies and available event/API contracts.
- Legal retention, deletion, export and recovery policy.

Do not fill these gaps by assumption. Obtain schema/source evidence and product-owner decisions before migration design.

## 6. Required validation plan

- Parallel claim race tests for each globally unique identifier.
- Verification OTP expiry, replay, brute-force and resend race tests.
- Registration retry after client timeout and server crash at transaction boundaries.
- Outbox publisher crash, duplicate delivery, out-of-order delivery, poison event and adapter outage tests.
- Identity outage returns retryable 503 and never creates local shadow account.
- Propo outage after Identity commit returns pending_sync and later converges.
- JWT issuer/audience/algorithm/nonce/signature/expiry/JWKS rotation tests.
- Refresh rotation/reuse/revocation and device/session logout tests.
- Account-linking and duplicate-account conflict tests.
- Migration dry-run, collision quarantine, checksum/count reconciliation and rollback drill.
- Privacy tests for identifier enumeration, logs, event payloads, deletion and retention.

## 7. Open risk / owner decisions

The highest residual risk is unresolved policy, not a coding detail: exact global uniqueness rules, existing-account linking, Propo Seller Account relationship, credential ownership, and retention/deletion. These must be resolved before the schema and migration are frozen.
