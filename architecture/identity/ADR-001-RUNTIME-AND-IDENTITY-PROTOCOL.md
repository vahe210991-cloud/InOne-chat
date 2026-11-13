# ADR-001 — InOne Identity runtime, protocol and persistence baseline

- Status: CTO technical decision for Stage 0; exact package patches and compatibility are verified in Stage 1.
- Date: 2026-11-13
- Scope: New InOne Identity service only.
- Existing POC code remains reference-only and is not accepted as the new Identity implementation.

## Context

InOne Identity is a security-critical authentication authority for InOne, InOne Business and Propo. It must support native mobile clients, standards-based authentication, account-pair provisioning and strict product isolation. The repository has a Node.js backend POC using Node 22 or newer; this is compatibility evidence, not a mandate to reuse its account model.

## Decision

### Runtime and language
- Node.js 26.x Active LTS.
- TypeScript strict mode.
- npm with committed package-lock and reproducible npm ci installs.
- Fastify 5.x for HTTP.
- One modular monolith codebase with separately runnable HTTP/OIDC and outbox/reconciliation worker processes.
- Provider-neutral containers. No cloud host, paid resource or production region is selected or provisioned in Stage 0.

### Identity protocol and libraries
- oidc-provider 9.x as OpenID Provider. It is OpenID Certified and supports Authorization Code + PKCE, revocation, introspection and client-authentication capabilities. Enable only required grants/profiles.
- @simplewebauthn/server 14.x for WebAuthn/passkey registration and assertion verification.
- argon2 0.45.x for Argon2id password hashing. Calibrate parameters against production-class hardware in Stage 1.
- TOTP remains optional. Select and pin its maintained library in Stage 1 after dependency/security review; do not implement custom cryptographic primitives.
- No hosted social login, SMS OTP, email OTP or third-party account recovery in initial release.

### Database and persistence
- PostgreSQL 18.7 baseline. Stay on supported PostgreSQL 18.x and apply security minor releases. PostgreSQL 19 is still a release candidate on this date and is not a production baseline.
- Dedicated Identity database and least-privilege database roles.
- SQL-first, reviewed, append-only migrations. Use explicit transactions, unique constraints, row locks and conditional updates for atomic state transitions.
- Maintained pg Node driver with parameterized SQL. No ORM hiding transaction/locking behavior in security-critical flows.
- PostgreSQL is source of truth for identities, claims, credentials metadata, sessions, provisioning, outbox/inbox and audit. Redis, Kafka and microservices are not v1 dependencies.

### API and event contracts
- OpenAPI 3.1.0 for Identity-owned HTTP APIs.
- JSON Schema Draft 2020-12 for event envelopes/payloads.
- Redocly CLI 2.77.0 validates OpenAPI; Ajv CLI 5.0.0 validates event examples.
- Events are at-least-once; consumers deduplicate by event_id and aggregate/version.
- Standard OIDC protocol endpoints are defined by discovery metadata; do not invent proprietary authorization/token routes.

### Client security
- Separate audiences: urn:inone:api, urn:inone-business:api, urn:propo:api.
- Native clients are public clients using Authorization Code + PKCE S256; no embedded client secret.
- Web clients use confidential server-side BFF; no access/refresh tokens in browser JS, localStorage or WebView.
- Static reviewed client registration; Dynamic Client Registration disabled.
- Exact redirect URIs and app bundle identifiers are not guessed. Registrations remain disabled until app identifiers/callback inventory are supplied.
- Tokens contain minimum identity/session/authentication context and, if needed, an audience-scoped product-account reference. No organization roles, financial limits, department membership or contact values.

## Stage 1 service layout

Create under services/identity/:
- src/bootstrap — configuration and lifecycle
- src/oidc — provider integration, client registry and interactions
- src/modules/identity, credentials, contacts, devices, sessions, recovery, provisioning and security
- src/infra/postgres — connection, migrations and repositories
- src/infra/crypto — KMS adapters and keyed-hash services
- src/infra/outbox — publisher, inbox and reconciliation
- test/unit, test/integration and test/contracts

Do not create empty folders or placeholder runtime code in Stage 0. Stage 1 creates executable source and tests together.

## Rejected alternatives

- Custom OAuth/OIDC implementation: rejected; protocol correctness/certification are too security-sensitive to build from scratch.
- Hosted IdP as canonical identity database: rejected for v1 because contact reservation, recovery policy and product-pair lifecycle require first-party domain ownership.
- Rust for first Identity service: not selected. Rust remains appropriate for cryptographic/native MLS components, but Node ecosystem offers certified OIDC Provider and mature WebAuthn integration.
- Redis/Kafka/microservices at launch: rejected as unnecessary complexity; PostgreSQL outbox is sufficient until measured scale requires change.
- PostgreSQL 19 RC: rejected because not stable production release on decision date.

## Consequences and verification

- oidc-provider storage adapter and login/interaction UX must be integrated and tested against selected database. The library is not a complete identity product.
- Disable unused grants, dynamic registration, implicit/hybrid flows and insecure client authentication.
- Production signing keys are asymmetric and KMS/HSM-backed. Keyed-hash and encryption keys have separate purposes.
- Exact dependency patches, lockfile, SBOM and dependency scan are Stage 1/6 acceptance evidence.
- No service, database, cloud resource, deployment, DNS or secret is created by this ADR.

## Sources checked 2026-11-13

- Node.js releases: https://nodejs.org/en/about/previous-releases — Node 26 entered LTS on 2026-10-28.
- PostgreSQL versioning: https://www.postgresql.org/support/versioning/
- PostgreSQL 18.7 and 19 RC2: https://www.postgresql.org/about/news/postgresql-187-1712-1616-1520-1425-and-19-rc-2-released-3442/
- OpenID Provider: https://github.com/panva/node-oidc-provider
- OpenID Foundation certified implementations: https://openid.net/certification/certified-openid-connect-implementations/
- oidc-provider package: https://www.npmjs.com/package/oidc-provider
- SimpleWebAuthn: https://www.npmjs.com/package/@simplewebauthn/server
- Argon2 Node bindings: https://github.com/ranisalt/node-argon2
- Fastify v5: https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
- Redocly CLI: https://www.npmjs.com/package/@redocly/cli
