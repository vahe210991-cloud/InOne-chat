# InOne Identity — Stage 0 readiness pack v0.1

**Status:** CTO technical baseline recorded; ready to begin Stage 1 core implementation after external gates are understood  
**Date:** 2026-11-13  
**Branch:** stage0/identity-readiness-2026-11-13  
**Base:** architecture/product-and-platform-blueprint-2026-11-13 @ 05bc226526d9c984b6ccb2b9f44dbad8459dcd6e  
**Production status:** NOT AUTHORIZED. This package does not authorize deployment, production secrets, public endpoints, migrations or live traffic.

## 1. Stage 0 outcome

Stage 0 provides:
- Selected runtime, language, HTTP framework, OIDC Provider, WebAuthn library and database in ADR-001.
- Formal Identity-owned HTTP API contract in OpenAPI 3.1.
- Versioned event envelope and twelve event types in JSON Schema 2020-12, with sample events.
- Static first-party client registry and exact product audience policy.
- Environment and secret-management contract.
- GitHub Actions contract validation.
- Explicit Propo adapter deferral until stable IDs, reservation/activation semantics, API/event docs and sandbox are provided.
- Explicit privacy/legal, app callback and production-infrastructure gates.

**READY_FOR_STAGE_1 = true** for isolated non-production Identity core development.  
**READY_FOR_PRODUCTION = false.**

## 2. CTO technical baseline

| Area | Decision |
|---|---|
| Runtime | Node.js 26.x Active LTS |
| Language | TypeScript strict |
| HTTP | Fastify 5.x |
| OIDC Provider | oidc-provider 9.x |
| Passkeys | @simplewebauthn/server 14.x |
| Password hashing | argon2 0.45.x, Argon2id |
| Database | PostgreSQL 18.7 baseline; remain on supported 18.x |
| SQL driver | pg 8.x, parameterized SQL |
| API | OpenAPI 3.1.0 |
| Event schema | JSON Schema Draft 2020-12 |
| Contract CI | Redocly CLI 2.77.0 + Ajv CLI 5.0.0 |
| Package management | npm; exact dependency lockfile in Stage 1 |
| Deployment | Provider-neutral containers; no host selected |
| Architecture | Modular monolith; HTTP and outbox worker processes |

Exact package patches and lockfile are created in Stage 1, when source is introduced and the dependency tree can be installed, scanned and tested. Stage 0 does not claim runtime compatibility tests.

## 3. Identity and product boundaries

- Identity authenticates people; each product backend owns its local principals, lifecycle, data and authorization.
- InOne personal registration provisions InOne personal plus reserved Propo personal.
- Accepted InOne Business invitation provisions InOne Business work plus reserved Propo work.
- InOne sign-in does not activate a Propo reservation; Propo owns its first-device activation.
- One central identity may hold personal and work contexts; product data is never merged implicitly.
- Tokens are audience-specific; one product token cannot authorize another product.
- Business owns invitations, membership, positions, delegation, permissions and financial authority.
- Propo owns marketplace records. Identity must not access Propo SQL directly.
- Unverified phone/email are unique reserved claims, not proof of ownership or recovery factors.

## 4. OIDC clients and audiences

Reserved audiences: urn:inone:api, urn:inone-business:api, urn:propo:api.

- Authorization Code + PKCE S256 only.
- No Implicit, Resource Owner Password Credentials, wildcard redirects or Dynamic Client Registration.
- Native apps are public clients; no embedded client secret.
- Web clients use a confidential server-side BFF; browser JS/WebView never receives refresh tokens.
- Identity chooses the one audience registered for the client.
- Propo may select personal/work only when the corresponding product-account mapping exists.
- Never put organization roles, positions, financial limits, department scope, phone/email or broad permissions in access tokens.
- Exact callback URIs, bundle IDs and Android package IDs remain unset until the real app inventory is confirmed. A client with no exact redirect URI must not be enabled.

## 5. API and event ownership

OpenAPI describes Identity-owned routes only. Business invitation routes and organization permissions belong to InOne Business; marketplace endpoints belong to Propo; product first-device activation belongs to each product. Standard OIDC protocol URLs come from issuer discovery metadata. Contact-verification delivery routes remain disabled while no SMS/email proof-of-control provider exists.

Events are at-least-once and contain identifiers/minimum metadata only. They never contain passwords, hashes, tokens, recovery codes, full contact values or secrets. Consumers deduplicate by event_id, persist inbox/effect atomically, retry bounded transient failures, support replay/reconciliation and fail closed for designated high-risk actions when current security state cannot be confirmed.

## 6. Propo adapter — explicitly deferred

Before Propo integration leaves BLOCKED, obtain:
- immutable Propo person/user IDs and separate personal/work principal semantics;
- stable Seller Account ID and one-to-one organization mapping;
- create/reserve/activate/suspend behavior and first-device activation contract;
- employee-to-Seller-Account mapping;
- authenticated API, error taxonomy, rate limits and versioning;
- signed events/webhooks, replay semantics and sandbox accounts;
- reconciliation and support process.

Identity core Stage 1 can proceed with a fake test adapter. No Propo production adapter or live provisioning call may be created before the contract is supplied.

## 7. Stage 0 acceptance

- [x] Runtime/library/database ADR.
- [x] OIDC client and audience policy.
- [x] Identity HTTP contract and event schema.
- [x] Event examples for agreed event types.
- [x] Environment and secrets contract.
- [x] Automated contract validation workflow.
- [x] Propo adapter explicitly deferred.
- [x] Stage 1 work packages and acceptance gates.

External gates:
- [ ] Propo API/sandbox contract — blocks Propo adapter and production pair-provisioning, not isolated Identity core work.
- [ ] App bundle/package identifiers and exact redirect URIs — required before enabling client registrations.
- [ ] Privacy/legal review: lawful basis, controller/processor roles, data residency, retention/deletion, user rights and incident-notification requirements — required before production.
- [ ] Independent security review of final OIDC/WebAuthn configuration — required before production.
- [ ] Owner approval of production host, regions, KMS and cost envelope — required before cloud provisioning.

## 8. Stage 1 implementation order

1. Create services/identity TypeScript service skeleton and package lock.
2. Add validated configuration, process bootstrap and private health/readiness endpoints.
3. Add PostgreSQL 18.x migrations, roles, constraints and transaction helpers.
4. Implement identity/contact creation and atomic global contact reservation.
5. Implement append-only security audit and request/correlation IDs.
6. Implement transactional outbox/inbox and idempotency primitives.
7. Integrate oidc-provider with PostgreSQL adapter and issuer discovery/JWKS.
8. Implement client registry and audience validation.
9. Add passkey and Argon2id modules behind testable interfaces.
10. Add unit, integration, concurrency, contract and security tests before product integration.

Stage 1 does not include production deployment or real Propo integration.

## 9. Definition of done

Stage 0 is technically ready for Stage 1 because first-party design and contract decisions needed to begin Identity core are versioned. It is not production authorization. External legal, app-registration and Propo gates remain open.

See ADR-001, identity/contracts/, identity/ops/ and IDENTITY-THREAT-MODEL-AND-IMPLEMENTATION-PLAN-V0.1.md.
