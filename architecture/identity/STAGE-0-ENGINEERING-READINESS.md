# InOne Identity — Stage 0 Engineering Readiness

- **Version:** 1.0
- **Date:** 2026-11-13
- **Status:** Stage 0 internal deliverables prepared; CI evidence pending
- **Owner:** CTO
- **Parent architecture:** [Identity service architecture v0.1](../IDENTITY-SERVICE-ARCHITECTURE-V0.1.md)
- **Security baseline:** [Threat model and implementation plan v0.1](../IDENTITY-THREAT-MODEL-AND-IMPLEMENTATION-PLAN-V0.1.md)

## 1. Purpose

Stage 0 is the engineering-readiness gate before implementation. It freezes the internal service boundary, technical stack, API/event contracts, security profile, client registration rules, data classification and external integration requirements.

Stage 0 does **not** implement authentication or create production database/API behavior. It makes Stage 1 implementable without inventing protocols, product boundaries or security rules.

## 2. Architecture decisions frozen for Stage 1

1. Identity is a separate service and owns only central person identity, credentials, contact claims, devices/sessions, recovery/security state, product-account mappings and provisioning orchestration.
2. Product backends own product-local accounts, domain data and authorization. No cross-product SQL.
3. One central identity can have a personal context and later a work context. No automatic linking by matching contact strings.
4. InOne personal registration provisions InOne personal + Propo personal.
5. Accepted InOne Business invitation provisions InOne Business work + Propo work. Business owns invitation authority and membership; Identity does not grant Business roles.
6. Propo paired accounts are reserved and cannot authenticate/use marketplace features until Propo's own activation.
7. Phone and email are mandatory registration fields, globally unique by normalized claim, but remain unverified. They are lookup identifiers, not proof of ownership or recovery factors.
8. Login identifier: the user may sign in with either claimed phone or claimed email plus password. Both remain unverified; possession of the string alone proves nothing. This is a CTO decision and does not change the owner-approved contact reservation policy.
9. Identity uses OIDC Authorization Code + PKCE S256. Each product API has a separate audience; product APIs authorize independently.
10. Access token target lifetime is 5 minutes; refresh inactivity lifetime 30 days; absolute session lifetime 90 days; refresh rotates on every use and replay revokes the token family.
11. Recovery follows the standalone CTO baseline: Argon2id, passkey preferred, TOTP optional, 10 single-use recovery codes, 10-minute recovery grant, global session revocation after password reset, 24-hour sensitive-action hold after recovery-code use, 72-hour contact-change cooling period.
12. Sensitive Business financial operations require fresh passkey/TOTP step-up and the independent two-person approval already approved by the owner.
13. v1 is a modular monolith with a dedicated PostgreSQL database and transactional outbox. No Kafka, service mesh or microservice decomposition.
14. Stack is fixed by [ADR-IDENTITY-STACK-001](ADR-IDENTITY-STACK-001.md).

## 3. Deliverables

| Artifact | Purpose | Status |
|---|---|---|
| Stack ADR | Runtime, framework, database, auth and crypto library decisions | Prepared |
| OpenAPI contract | Public and service-to-service HTTP surface | Prepared |
| AsyncAPI contract | Versioned product event messages | Prepared |
| Client registry template | Per-product client/audience/redirect allowlist | Prepared; exact URIs pending product domains |
| Data classification | PII, credentials, secrets, logs, retention and privacy controls | Prepared; legal review pending |
| Propo adapter questionnaire | Requests stable IDs, personal/work principals, reservation/activation, API and sandbox facts | Prepared; Propo response pending |
| Threat model | Attackers, trust boundaries, 28 threats, P0 controls | Existing v0.1 document |
| CI contract validator | Reproducible OpenAPI/AsyncAPI lint | Added in this Stage 0 branch; must pass before Stage 0 closure |\n| Identity Codespaces profile | Node 26 + PostgreSQL 18 isolated development environment | Configuration added; build/start/health verification pending |
| Stage 1 backlog and gate | Ordered implementation scope and acceptance tests | Defined below |

## 4. Contract and security rules

### 4.1 Public client rules
- The client cannot choose its product pair, audience, identity_id, product principal ID or authorization rights.
- Native apps are public clients; no client secret may be embedded in an APK/IPA.
- Authorization Code + PKCE S256 is mandatory.
- Redirect URIs are exact allowlist entries. No wildcard, prefix matching or arbitrary return URL.
- Web client type must be explicitly chosen as SPA/public or BFF/confidential before its client is provisioned.
- All mutating operations use idempotency keys where retries are possible.
- Generic responses prevent account enumeration for registration conflicts and recovery.

### 4.2 Product service rules
- Product service credentials are separate per environment and per product.
- Production service-to-service calls use mTLS or an approved workload identity mechanism; no static shared secret embedded in clients.
- Service scopes restrict each adapter to its own product and operations.
- Provisioning commands carry operation, step, product, context, schema version and correlation IDs.
- Product account creation is create-or-return idempotent.
- A product must acknowledge stable product account ID and state.
- Product activation remains product-owned; Identity cannot activate Propo by signing into InOne.
- Security-hold events are hints for rapid propagation; sensitive product operations verify current security state when event freshness is uncertain and fail closed if unavailable.

### 4.3 Database rules
- Unique constraints enforce normalized active phone and email claims.
- Product mapping uniqueness is scoped by identity + product + account context.
- Idempotency keys bind to a canonical request fingerprint.
- Recovery codes and grants are consumed with atomic conditional updates.
- Refresh token rotation and family revocation are transactionally consistent.
- Audit and outbox writes occur in the same transaction as the security state change.
- No plaintext password, token, recovery code, invitation token or TOTP secret is stored in logs or event payloads.

## 5. Environments and configuration

The isolated Codespaces configuration is `.devcontainer/identity/devcontainer.json`; its Compose file runs Node 26 and PostgreSQL 18 with a disposable local-only database. The setup and commands are documented in [.devcontainer/identity/README.md](../../.devcontainer/identity/README.md). Run `bash .devcontainer/identity/scripts/verify-stage0-environment.sh` from the repository root after creating the Codespace. The profile has not yet been built or run.\n\nStage 1 must define three isolated environments:

| Environment | Data | Credentials | External products |
|---|---|---|---|
| Local/Codespaces | Synthetic fixtures only | Disposable local secrets | Contract-faithful mocks |
| Staging | Synthetic/test identities only unless separately approved | Staging-only KMS/service credentials | Propo sandbox or approved mock |
| Production | Real user data | Production KMS and per-service credentials | Approved production contracts |

Required configuration names (values never committed):
- NODE_ENV
- PORT
- IDENTITY_PUBLIC_ISSUER
- IDENTITY_DATABASE_URL
- IDENTITY_DATABASE_POOL_MAX
- IDENTITY_KMS_KEY_REFERENCE
- IDENTITY_OIDC_SIGNING_KEY_REFERENCE
- IDENTITY_SERVICE_CLIENT_REGISTRY
- IDENTITY_OUTBOX_POLL_INTERVAL_MS
- IDENTITY_OUTBOX_BATCH_SIZE
- IDENTITY_LOG_LEVEL
- OTEL_EXPORTER_OTLP_ENDPOINT (optional by environment)
- IDENTITY_TRUSTED_PROXY_CIDRS (empty unless a trusted proxy is explicitly configured)

Configuration must be schema-validated at startup. Production must fail to start if issuer, database, KMS/signing key reference, secure cookie policy or trusted proxy configuration is missing/invalid. No development fallback may run in production.

## 6. Health and operational contract for Stage 1

- GET /healthz: process liveness only; no dependency probes.
- GET /readyz: readiness; checks database connectivity and required key material availability without exposing secrets.
- Readiness fails if migrations are behind, database is unavailable, or required signing capability is unavailable.
- Liveness must not restart-loop merely because Propo is unavailable; Identity registration can expose provisioning-pending state.
- Outbox worker has independent heartbeat and lag metrics.
- Logs use request/correlation IDs and redact authorization headers, cookies, passwords, contact values, codes, keys and tokens.

## 7. Stage 0 exit criteria

### Internal criteria
- [x] Product/service ownership boundary is documented.
- [x] Stack ADR is prepared with current upstream references.
- [x] OpenAPI contract is prepared.
- [x] AsyncAPI event contract is prepared.
- [x] Client registry template exists; missing redirect URIs are explicitly blocked, not guessed.
- [x] Data classification/privacy inventory is prepared.
- [x] Propo adapter questionnaire is prepared.
- [x] Threat model and P0 launch blockers exist.
- [ ] Contract CI passes on the exact Stage 0 PR head.
- [ ] OIDC/Passkey/Argon2/PostgreSQL compatibility spike is executed in the Stage 0 development environment.

### External gates — do not falsely mark complete
- [ ] Propo technical owner supplies API documentation, sandbox and answers to the adapter questionnaire.
- [ ] Propo confirms immutable personal/work principal IDs, reserved-account behavior and product-owned activation.
- [ ] Product domains, mobile bundle IDs and exact redirect URIs are confirmed.
- [ ] Privacy/legal reviewer confirms data-controller roles, lawful basis, retention/deletion, residency and incident duties.
- [ ] Production KMS/hosting provider is selected and threat-reviewed.

**Stage 0 status rule:** internal contract readiness can be accepted after CI passes. Stage 1 may begin with synthetic data and a mocked Propo adapter once the compatibility spike passes. Production account provisioning and production release remain blocked by the external gates above.

## 8. Stage 1 implementation backlog

1. Create services/identity package and Docker image; strict TypeScript, health/readiness and structured logs.
2. Provision PostgreSQL 18 local/CI service; add SQL migrations, least-privilege roles and backup/restore test.
3. Implement central identity and contact claim domain; enforce atomic unique reservations and generic conflicts.
4. Implement audit log + transactional outbox/inbox + idempotency middleware.
5. Execute OIDC provider adapter and PKCE integration spike; then implement registered clients and product audiences.
6. Add Argon2id credential service, rate limits and password policy.
7. Add WebAuthn/passkey enrollment/authentication and optional TOTP.
8. Implement sessions, refresh rotation, reuse detection, device lifecycle and global revocation.
9. Implement recovery state machine, one-time codes/grants, holds and contact cooling.
10. Implement product adapter interface + fake adapter; prove saga retry/reconciliation before Propo integration.
11. Add adversarial, concurrency, contract and database integration tests.
12. Add CI security/dependency scans and staging deployment after infrastructure decision.

## 9. Stage 1 acceptance gate

Stage 1 is complete only when:
- a clean Codespace can install dependencies, start PostgreSQL, migrate and run tests from documented commands;
- healthz and readyz return the documented states;
- duplicate concurrent contact claims produce exactly one active reservation;
- outbox writes are atomic with state changes and repeated delivery is idempotent;
- audit records are durable and secrets/PII do not leak into logs;
- the OIDC provider completes Authorization Code + PKCE S256 and rejects cross-client/audience misuse;
- no product backend reads Identity's database directly;
- CI runs on the exact commit and the complete command/results are recorded.

## 10. Stage 0 handover

The next task is Stage 0 verification, not product feature implementation:
1. Wait for the contract-lint workflow on this PR head.
2. Open the repository in the owner-selected GitHub Codespaces environment on this branch; verify full clone/refs and current HEAD.
3. Run the compatibility spike from ADR-001 and capture exact command output.
4. Send the Propo questionnaire to its technical owner and track the response as an external integration gate.
5. Only after CI and compatibility spike pass, open Stage 1 implementation work on a new branch.

Never report the entire Stage 0 as passed while its CI or compatibility spike remains NOT RUN.


## Repository handoff metadata

- Task branch: `stage0/identity-engineering-readiness-2026-11-13`
- Draft PR: https://github.com/vahe210991-cloud/InOne-chat/pull/51
- Parent architecture PR: https://github.com/vahe210991-cloud/InOne-chat/pull/50
- Stage 0 PR head at initial opening: `bef433d33c194ea096f1067078f6d6a041f0623d` (re-fetch the PR before using this as the latest head)
- Contract CI status at handoff: pending; do not mark PASS without an exact-head workflow result.
- Compatibility spike: NOT RUN.
- Propo sandbox/API and privacy/legal review: external gates pending.
