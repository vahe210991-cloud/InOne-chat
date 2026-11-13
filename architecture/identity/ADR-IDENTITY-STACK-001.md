# ADR-IDENTITY-STACK-001 — InOne Identity v1 engineering stack

- **Status:** Accepted as CTO technical decision under owner-delegated CTO authority
- **Date:** 2026-11-13
- **Decision owner:** CTO
- **Scope:** New standalone InOne Identity service only
- **Implementation:** Not started; Stage 0 decision and contract artifacts only

## Context

InOne Identity is a new central authentication authority with high-security requirements. It must support OIDC, passkeys, Argon2id, rotating sessions, recovery, globally unique contact claims, durable account-pair provisioning, and product-scoped authorization. It owns a dedicated database and must not become a shared product database.

The repository contains historical Node.js 22 / PostgreSQL implementation references. They are not accepted as the Identity implementation baseline. The new service must be independently deployable, reproducible, observable, and portable between hosting providers.

## Decision

### Runtime and application

| Layer | Decision | Reason |
|---|---|---|
| Runtime | **Node.js 26 LTS** | Active LTS as of 2026-11-13; longer runway than the repository's Node 22 reference |
| Language | **TypeScript, strict mode** | Compile-time contracts for security-sensitive domain and adapter boundaries |
| HTTP framework | **Fastify 5.x** | Mature schema-first Node HTTP framework; current v5 line supports Node 20+ |
| Module format | **ESM** | Aligns with modern Node and current repository conventions |
| Service shape | **One modular monolith** | One independently deployable Identity service; explicit internal modules |
| Package manager | **npm** | Minimize tooling divergence from the existing Node repository; commit lockfile |
| API description | **OpenAPI 3.1** | Machine-readable HTTP contract, validated in CI |
| Event description | **AsyncAPI 3.0** | Machine-readable asynchronous event contract, validated in CI |

### Persistence and asynchronous work

| Layer | Decision | Reason |
|---|---|---|
| Database | **PostgreSQL 18** | Current supported major; independent Identity database |
| Driver | **node-postgres (pg)** | Direct, explicit parameterized SQL and transaction control |
| Migrations | **SQL-first, versioned migrations** | Reviewable schema evolution; no schema generation from runtime models |
| ORM | **None in v1** | Avoid hiding locks, uniqueness, conditional updates and transaction boundaries |
| Outbox | **PostgreSQL transactional outbox + worker** | Durable delivery and retry without a broker dependency |
| Broker | **None in v1** | Add only when measured throughput/team topology requires it |
| Redis | **Not required for correctness in v1** | PostgreSQL remains source of truth; introduce only for measured ephemeral rate-limit/coordination needs |

The database must enforce unique contact claims, idempotency, product-account mappings and single-use recovery state. Use row locks or conditional updates for one-time consumption and SKIP LOCKED for outbox workers. Do not rely on process-local locks.

### Identity and cryptography libraries

| Capability | Selected implementation | Guardrail |
|---|---|---|
| OIDC Provider | **oidc-provider 9.14.0** | Use the protocol implementation; never hand-roll OAuth/OIDC endpoints. Stage 0 must prove adapter, interaction, Fastify mounting and Node 26 compatibility before Stage 1 |
| Passkeys | **@simplewebauthn/server 14.1.0** | Use WebAuthn ceremony verification; store public credential metadata, never biometric data |
| Password hashing | **@node-rs/argon2 2.2.2** | Argon2id only; calibrate memory/time parameters on target hardware; test native binaries on every CI/runtime architecture |
| JOSE utilities | **jose 6.2.17** | For non-OIDC service-token/JWK operations only; OIDC provider remains owner of OIDC tokens |
| Request validation | **JSON Schema 2020-12 / Fastify schema validation** | Reject unknown/invalid input; do not accept client-supplied identity, role or audience |
| Logging | **Pino via Fastify** | Structured logs with strict redaction |
| Tracing/metrics | **OpenTelemetry APIs** | Vendor-neutral instrumentation; backend choice deferred |

Versions above are the reviewed Stage 0 candidates as of the decision date. Stage 1 must pin exact versions in package-lock.json, run dependency/security scans and pass Node 26 Linux amd64/arm64 compatibility tests. Do not use floating latest in builds.

### Testing and delivery

- Unit/API tests: Node.js built-in node:test and Fastify inject.
- Database integration tests: PostgreSQL 18 service in CI; test clean install, upgrade path, rollback/forward-fix procedure, race conditions and restore.
- Contract validation: Redocly CLI 2.77.0, pinned in CI, for OpenAPI and AsyncAPI lint.
- CI: GitHub Actions, least-privilege permissions, pinned third-party Actions by commit SHA, no production secrets in pull-request workflows.
- Development environment: GitHub Codespaces is the owner-selected development environment. Existing repository Codespaces scaffolding is draft/unverified and must be validated separately before it is treated as working.
- Packaging: OCI/Docker-compatible container, non-root runtime, health/readiness probes.
- Hosting provider: deliberately **not selected** in Stage 0. The service remains portable; no Vercel/AWS/GCP-specific dependency is introduced.

## OIDC security profile

The OIDC implementation must follow RFC 9700 OAuth 2.0 Security Best Current Practice:

- Authorization Code flow only for first-party user clients.
- PKCE S256 mandatory for public clients and required for confidential clients too.
- Exact redirect URI matching; no wildcard or open redirect.
- No Implicit or Resource Owner Password Credentials grant.
- Access tokens audience-restricted to one product API.
- Refresh tokens are bound to client/resource/scope and rotated on every use for public clients.
- Detect refresh-token reuse and revoke the active token family.
- Publish discovery/JWKS metadata; rotate signing keys using KMS-backed key material.
- Evaluate DPoP or mTLS sender-constraining for high-risk service/client paths during implementation.

## Repository layout for Stage 1

The Identity implementation will live in a new isolated package, not inside the historical inone-engine-poc-0.6.0 tree:

~~~text
services/
  identity/
    src/
      app/
      modules/
        identity/
        contacts/
        credentials/
        oidc/
        sessions/
        recovery/
        devices/
        provisioning/
        security-holds/
        audit/
      adapters/
        postgres/
        product-clients/
        kms/
      workers/
        outbox/
    migrations/
    test/
    package.json
    package-lock.json
    tsconfig.json
    Dockerfile
~~~

No source directories are created by this ADR. Stage 1 creates the service skeleton only after the Stage 0 spike and contract gates pass.

## Consequences

### Positive
- Current, supported runtime/database baseline.
- OIDC/WebAuthn/Argon2id are delegated to maintained protocol/cryptography libraries rather than custom cryptographic code.
- One database and one deployable reduce operational complexity while preserving product isolation.
- Contract-first development enables InOne, Business and Propo teams to integrate independently.

### Costs and risks
- oidc-provider requires custom account adapter, login interactions and security integration; it is not a turnkey user-management product.
- Native Argon2 binaries and Node 26 compatibility must be tested on all target architectures.
- PostgreSQL outbox delivery requires operational retry, dead-letter and reconciliation tooling.
- TypeScript type definitions for third-party packages must be checked for version parity.
- Hosting, KMS vendor, production domains and privacy/legal requirements remain external decisions.

## Stage 0 spike acceptance

Before Stage 1 source scaffolding, prove in a disposable spike (no production credentials/data):

1. Node 26 LTS + TypeScript strict + Fastify 5 starts and serves a health endpoint.
2. oidc-provider mounts in the selected HTTP server and exposes valid discovery/JWKS.
3. A test client completes Authorization Code + PKCE S256; PKCE downgrade and redirect mismatch are rejected.
4. Provider adapter persists/reloads grants and sessions through PostgreSQL 18.
5. @simplewebauthn/server verifies registration and authentication test vectors.
6. @node-rs/argon2 hashes/verifies Argon2id on CI Linux amd64 and arm64.
7. jose verifies a service JWT with an allowlisted issuer/audience/algorithm.
8. PostgreSQL transaction tests prove contact uniqueness and atomic one-time consumption.
9. Redocly contract workflow passes on the Stage 0 PR head.

If the OIDC mounting/adapter spike fails, stop and amend this ADR before implementing the Identity service. Do not build a custom OAuth/OIDC server as a workaround.

## References

- Node.js release schedule: https://nodejs.org/en/about/previous-releases
- PostgreSQL version policy: https://www.postgresql.org/support/versioning/
- Fastify v5 migration/support requirements: https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
- oidc-provider: https://oidc-provider.dev/ and https://github.com/panva/node-oidc-provider
- SimpleWebAuthn server: https://simplewebauthn.dev/docs/packages/server/
- Argon2 Rust binding: https://www.npmjs.com/package/@node-rs/argon2
- JOSE: https://www.npmjs.com/package/jose
- OAuth 2.0 Security BCP: https://www.rfc-editor.org/rfc/rfc9700.html
