# InOne Identity — data classification and privacy inventory

- **Version:** 1.0
- **Date:** 2026-11-13
- **Status:** Engineering baseline; privacy/legal review pending
- **Scope:** Central Identity service and product-account provisioning metadata

## 1. Classification levels

| Level | Label | Examples | Handling |
|---|---|---|---|
| C0 | Public | Published OIDC metadata, public JWKS | Public read; integrity protected |
| C1 | Internal | Product client IDs, event names, non-sensitive operation states | Authenticated service/admin access; no public enumeration |
| C2 | Personal | Phone, email, identity ID, device label, IP/network signals, product account IDs | Minimize, encrypt at rest/in transit, least privilege, access audit, retention policy |
| C3 | Secret / credential | Password hashes, passkey credential metadata, TOTP secrets, refresh-token hashes, recovery-code/grant hashes, invitation token hashes, service credentials | Strong access isolation; secret/KMS protection; never log or export |
| C4 | Security-critical | Private signing keys, KMS key material, break-glass credentials, privileged operator credentials | KMS/HSM only; no application DB/source/client exposure; dual control and audited access |

## 2. Data inventory and ownership

| Data | Source | System of record | Classification | Notes |
|---|---|---|---|---|
| identity_id | Identity | Identity DB | C2 | Immutable opaque identifier; never derive from phone/email |
| Phone number | Registration/user change | Identity DB | C2 | Mandatory; unverified until actual proof-of-control |
| Email | Registration/user change | Identity DB | C2 | Mandatory; unverified until actual proof-of-control |
| Password hash | User credential | Identity DB | C3 | Argon2id; no plaintext |
| Passkey public key / credential ID | WebAuthn ceremony | Identity DB | C3 | Public key is not secret but credential mapping is security-sensitive |
| TOTP secret | Enrollment | Identity DB encrypted envelope | C3 | Decrypt only in authentication service |
| Recovery code hashes | Recovery-code generation | Identity DB | C3 | Keyed hash; raw code shown once only |
| Refresh token hashes | Session issuance | Identity DB | C3 | Opaque token, rotate every refresh |
| Device metadata | Client registration | Identity DB | C2 | Minimal platform/label/last-seen; device ID is not proof of identity |
| Product principal IDs | Product adapter acknowledgements | Identity mapping DB + product DB authority | C2 | Identity stores mapping only; product owns principal |
| Seller Account ID | Propo contract | Propo authority; Identity mapping only | C2 | Must not be invented before Propo confirms |
| Provisioning operation IDs | Identity saga | Identity DB | C1/C2 | Opaque IDs; event correlation |
| Invitation reference | InOne Business | Business authority | C1/C2 | Identity sees only accepted reference needed for provisioning |
| Security hold state | Identity | Identity DB | C2/C3 | Product APIs enforce; no client-side authority |
| Audit events | Security actions | Append-only audit store | C2/C3 | No secrets/full contact values in event payload |
| Request logs/traces | Runtime | Observability system | C1/C2 | Redacted; no auth headers, body secrets or full contacts |

## 3. Data minimization rules

Identity stores only what it needs to authenticate the human, maintain contact claims, manage sessions/recovery and coordinate product account mappings.

Identity MUST NOT store:
- personal chats, posts, social graph or community content;
- Business CRM, leads, deals, tasks, Wallet balances or financial transactions;
- Propo listings, orders, buyer/seller conversations, ratings or payout ledger;
- biometric templates or raw biometric data;
- full copies of product profiles where a product-local ID and limited projection suffice;
- passwords or authentication secrets belonging to product systems.

## 4. Encryption and access

- TLS 1.2+ minimum; TLS 1.3 preferred for service and client traffic.
- Database and backups encrypted at rest.
- TOTP secrets encrypted with envelope encryption and KMS-backed key wrapping.
- Private OIDC signing keys remain in KMS/HSM; application receives only scoped signing capability.
- Passwords use Argon2id hashes; no reversible encryption.
- Refresh tokens, recovery codes, recovery grants and invitation tokens are stored as cryptographic hashes (keyed where required).
- Database roles are split by runtime, migration, outbox publisher and restricted support access.
- Production access is time-bound, least-privilege and audited.
- No credentials or real user data in GitHub, CI artifacts, screenshots or developer fixtures.

## 5. Logging, audit and telemetry

Never log passwords, access/refresh/ID/recovery tokens, one-time recovery codes, TOTP secrets or authenticator URIs, private signing/encryption keys, full phone/email values, authorization headers, cookies or raw request bodies for credential/recovery endpoints.

Allowed diagnostic fields, subject to privacy review: request/correlation ID, opaque identity/session/device/operation IDs, product/client identifier, event type and stable error code, coarse risk bucket and latency, masked contact only when necessary for user-visible confirmation.

Audit is separate from diagnostic logging. Audit entries include actor, action, target, decision, timestamp, correlation ID and safe reason code. Audit is append-only from application perspective and exported to an immutable/retention-controlled store when available.

## 6. Retention and deletion — intentionally not guessed

No universal retention periods are set in this document. Before production, a qualified privacy/legal reviewer must approve:
- lawful basis and notice/consent model for mandatory phone/email collection;
- controller/processor roles between InOne, InOne Business and Propo;
- data residency and cross-border transfers;
- retention for active, suspended, dormant and closed identities;
- contact claim retention and dispute evidence retention;
- credential/session/audit/telemetry retention;
- deletion, correction, export and access-request workflows;
- backup expiry and restoration treatment for deleted records;
- security incident and breach notification duties.

Until these are approved, local/Codespaces and CI environments use synthetic data only. Staging must use synthetic/test identities unless separately approved. Production user onboarding is blocked.

## 7. Unverified contact risk

Owner-approved first-claim-wins reservation can allow an attacker to reserve a contact they do not own. The system must clearly label phone/email as unverified; never send password reset or security notifications to them; never use them for MFA, recovery, financial approval or identity proofing; never expose the existing claimant during conflict handling; preserve an audited manual dispute process; and avoid releasing/reassigning claims automatically based on inactivity.

## 8. Privacy/security review checklist

- [ ] Data-flow map approved by privacy/legal.
- [ ] Lawful basis for mandatory contact capture documented.
- [ ] Product controller/processor roles agreed with Propo.
- [ ] Retention schedule and deletion semantics approved.
- [ ] Cross-border transfer/data residency approved.
- [ ] User access/correction/export/deletion requests designed.
- [ ] Audit retention and privileged access approved.
- [ ] Incident response and breach notification roles documented.
- [ ] Staging and CI confirmed synthetic-only.
