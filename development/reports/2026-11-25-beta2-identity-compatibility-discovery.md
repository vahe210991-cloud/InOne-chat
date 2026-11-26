# Beta 2.0 Identity — WP-01 compatibility discovery

**Audit date:** 2026-11-25  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Audited baseline:** `main` at `74169a449de182ea734049e21d8424dfc4091c88` (merge of PR #135)  
**Audit branch:** `audit/beta2-identity-compatibility-2026-11-25`  
**Scope:** read-only source inspection. No product code, schema, database, secrets, or runtime configuration changed. No tests/builds were run.

## 1. Executive result

WP-01 is **PARTIALLY COMPLETE**.

- **InOne:** source-backed compatibility inventory completed for the current main baseline.
- **Propo:** cannot be independently audited yet. The only repository visible to the connected GitHub account is `InOne-chat`; no separate Propo repository is connected/visible. Propo figures below are recorded as owner-supplied, unverified inputs, not as repository findings.
- **Mobile source of truth:** InOne's production Flutter application is `mobile/`, with `mobile/lib/main.dart` as its entry point. The alternative path `apps/mobile/app/lib` was not found in the InOne repository; the Propo duplicate-tree question remains blocked until its repository is accessible.
- **Identity architecture implication:** preserve InOne local account IDs and all existing relations; preserve Propo CUID primary keys and relations. Identity must own a separate canonical UUIDv4 and issue independent pairwise product subjects. Do not turn either product's current local key into the shared cross-product subject.

## 2. InOne — verified source facts

### 2.1 Current account ID generation and data model

Canonical backend source:
- `inone-development-archive-0.6.0/engine/src/account-rules.js`, blob `653902755202b4d53f3da8174a4c07837f246ad7`.
- `inone-development-archive-0.6.0/engine/src/schema.sql`, blob `b1f1be16927e75353aaf1f0e18fc76b7d6f04c07`.
- `inone-development-archive-0.6.0/engine/src/store.js`, blob `3172c098fff7a794d54f8a11a2ed20f85d69ab67`.

Findings:
- InOne's verified email and provider registration flows call `newUserId()`.
- `newUserId()` currently returns `'u' + randomBytes(12).toString('hex')`: a prefix plus 96 bits of cryptographically random material. It does not encode an email, phone, nickname, provider subject or creation timestamp.
- This existing random ID is an InOne-local account key, not the approved global Identity subject. It should not be reused as the canonical cross-product ID.
- The verified registration path and provider registration path return the local `userId` to the client.
- A legacy `registrationMode=open` route accepts a caller-supplied `userId`; however, `src/config.js` defaults to `verified` and rejects open registration in production configuration. The actual deployed runtime configuration was not inspected, so no claim is made about a live deployment.
- InOne's canonical SQL schema has **55 tables** and **29 direct FK columns across 26 tables** referencing `accounts(user_id)`. `accounts.user_id` is `TEXT PRIMARY KEY`. The complete list is already classified in Identity Phase 1; this audit reconfirmed the 55/29/26 counts on the audited main baseline.
- The existing schema is not a Prisma/CUID schema. Code search of the InOne main branch did not identify a Prisma schema or CUID generator dependency.

### 2.2 User ID exposure and propagation

The local InOne `userId` is not merely an internal DB key today:
- `POST /register` and `POST /register/provider` return `userId`.
- `GET /profile` returns account-level information containing the current `userId`.
- `GET /users/search` returns `userId`, nickname and verification level. It is authenticated, rate-limited per account and source address, and only returns a match when the users share an organization or active organization link. Email and phone are deliberately omitted.
- Organization membership and role operations accept target `userId` in request bodies or route segments and return it.
- The backend uses local user IDs in room membership, MLS member/device/key-package/welcome/commit flows, file ownership, device records, audit records and other product-local relationships.

**Compatibility consequence:** do not replace the current `userId` field or rewrite its meaning as part of the first Identity integration. Define a versioned Identity adapter/mapping boundary. The exact choice of whether product-facing OIDC `sub` equals the pairwise product subject or remains distinct from the existing local `userId` is still an API-contract decision and must be resolved before contract freeze.

### 2.3 InOne mobile application and persistence

Verified source:
- `mobile/README.md` identifies `mobile/lib/main.dart` as the production entry point and `mobile/lib/ui_dart_source/` as the native screen tree.
- `mobile/pubspec.yaml` declares `inone_mobile`; its dependencies include Flutter, `http`, `flutter_secure_storage`, Firebase, file picker, Flutter Rust Bridge and related packages. It does **not** declare Drift or sqflite.
- `mobile/lib/core/session/inone_session.dart` stores the resumed MLS account marker under `inone.mls_user_id` using the platform secure-storage abstraction. The session receives account identity from server responses; this file does not define a client-side account ID generator.
- `mobile/rust/Cargo.toml` links the Flutter Rust bridge to canonical Engine B's Rust MLS client.
- The README and Beta 1.0 contracts describe SQLCipher-backed local MLS state, durable inbox/outbox and platform-protected database key storage in the Rust client. This is separate from a Drift database.
- The alternative paths `apps/mobile/app/lib/main.dart` and `apps/mobile/app/pubspec.yaml` were not found on InOne main. GitHub code search also returned no matching `apps/mobile/app/lib` path. This establishes the current InOne app root; it does not establish which of two trees is authoritative in Propo.

**Conclusion:** InOne's authoritative Flutter tree is `mobile/`. The Propo mobile-tree duplication must be resolved from Propo's own workspace configuration, package manifests, build scripts, CI workflows and application entry points; do not copy this conclusion across repositories.

## 3. Propo — supplied facts awaiting source verification

The following numbers and observations were supplied in the preceding owner-provided audit summary. They have **not** been independently verified against Propo source in this pass:

| Item | Supplied observation | Verification status |
|---|---:|---|
| Prisma models | 30 | Owner-supplied; unverified |
| Prisma `@relation` declarations | 69 | Owner-supplied; unverified |
| Approximate FK fields | 73 | Owner-supplied; unverified |
| Prisma migrations | 18 | Owner-supplied; unverified |
| Swagger CUID literals | 184 across 51 files | Owner-supplied; unverified |
| Mobile local ID storage | Drift stores IDs as text | Owner-supplied; unverified |
| Client-generated entity IDs | Not generated by mobile client | Owner-supplied; unverified |
| UUID usage | UUID used for `idempotencyKey` in `sync_engine.dart` | Owner-supplied; unverified |
| Duplicate mobile trees | `lib/` and `apps/mobile/app/lib/` differ | Owner-supplied; authoritative tree unresolved |

No claim is made here that Propo uses CUID1 rather than CUID2, that every Swagger literal is a resource ID, or that all 73 fields are actual relational foreign keys. Those distinctions require inspection of the exact Prisma generator configuration, schema, migration SQL and API DTOs.

### Required Propo evidence

Once the Propo repository is connected, collect:
1. `package.json`, lockfile and Prisma generator/provider/version, including exact CUID implementation and version.
2. Full `schema.prisma`, all 18 migration directories/files, raw SQL and generated-client configuration.
3. Model-by-model PK/FK/relation inventory; classify nullable, composite, polymorphic and JSON-embedded references separately.
4. Swagger/OpenAPI source and generated examples. Distinguish literal examples from actual runtime ID format validators.
5. Search all server/client consumers of IDs: controllers, DTOs, auth/session claims, WebSocket events, webhooks, push payloads, background jobs, logs, exports, deep links and external integrations.
6. Compare both mobile trees by package/workspace configuration, import graph, build scripts, CI, app entry point, release workflow and tests. Do not select the authoritative tree by file count or last-modified date.
7. Trace Drift tables, migrations, repositories, sync cursor, outbox and idempotency behavior. Confirm whether UUIDs are only operation keys or also persisted entity/resource references.

## 4. Cross-product Identity compatibility requirements

The current evidence supports these invariants:

1. Identity alone generates the canonical UUIDv4 human subject.
2. InOne and Propo receive independent pairwise subject IDs scoped to their registered relying-party boundaries. The same human must not have a shared public subject across the two products.
3. Preserve InOne `accounts.user_id`, its 29 FK columns and historical actor/protocol fields in the initial rollout.
4. Preserve Propo CUID primary keys and existing Prisma relations in the initial rollout. Do not mass-convert CUID PKs to UUID.
5. Keep product-local IDs distinct from the pairwise Identity subject. Do not silently reinterpret a CUID or InOne local ID as the canonical subject.
6. Keep operation/idempotency identifiers distinct from user subjects and resource IDs. An idempotency key is not an identity key.
7. No automatic account merge based on matching email, phone, username or display name.
8. Every resource operation continues to require server-side object, tenant, membership, ownership and action authorization. Opaque IDs do not prevent BOLA/IDOR.
9. Use versioned adapter contracts and an additive mapping/projection. No cross-database foreign keys.
10. Plan client compatibility for cached IDs, Drift/SQLCipher data, sync outbox, push and deep links before any cutover.

## 5. Blockers and next actions

| Work item | Status | Next action |
|---|---|---|
| InOne source identity and FK inventory | **COMPLETE — static source audit** | Reuse prior detailed Phase 1 field classification |
| InOne mobile source-of-truth tree | **COMPLETE — source-backed** | Treat `mobile/` as the InOne production app |
| InOne API/local-ID exposure map | **COMPLETE — first-pass inventory** | Expand route-by-route contract matrix during Identity adapter design |
| Propo repository availability | **BLOCKED** | Connect/authorize the Propo GitHub repository |
| Propo CUID implementation/version | **BLOCKED** | Inspect package manifest, lockfile and Prisma generator |
| Propo 30-model / 73-FK graph | **BLOCKED** | Parse actual schema and migration SQL |
| Propo Swagger literal classification | **BLOCKED** | Inspect OpenAPI source and DTO validators |
| Propo authoritative mobile tree | **BLOCKED** | Compare workspace, CI, app entry points and import graph |
| Propo Drift/cache/outbox compatibility | **BLOCKED** | Trace local DB schema and sync engine |

## 6. Gate decision

**WP-01 cannot be marked fully complete** until Propo source evidence is reviewed. The InOne side is sufficiently grounded to proceed with a draft adapter/contract design, but final cross-product subject semantics and schema/API freeze must wait for Propo evidence.

No product implementation is authorized by this report. No test, analyzer, build, migration, database connection or production configuration change was performed.

## 7. Source references

- InOne main baseline: [`74169a449de182ea734049e21d8424dfc4091c88`](https://github.com/vahe210991-cloud/InOne-chat/commit/74169a449de182ea734049e21d8424dfc4091c88)
- [InOne account ID generator](https://github.com/vahe210991-cloud/InOne-chat/blob/main/inone-development-archive-0.6.0/engine/src/account-rules.js)
- [InOne canonical SQL schema](https://github.com/vahe210991-cloud/InOne-chat/blob/main/inone-development-archive-0.6.0/engine/src/schema.sql)
- [InOne backend routes](https://github.com/vahe210991-cloud/InOne-chat/blob/main/inone-development-archive-0.6.0/engine/src/server.js)
- [InOne runtime config](https://github.com/vahe210991-cloud/InOne-chat/blob/main/inone-development-archive-0.6.0/engine/src/config.js)
- [InOne mobile README](https://github.com/vahe210991-cloud/InOne-chat/blob/main/mobile/README.md)
- [InOne Flutter dependency manifest](https://github.com/vahe210991-cloud/InOne-chat/blob/main/mobile/pubspec.yaml)
- [InOne session identity persistence](https://github.com/vahe210991-cloud/InOne-chat/blob/main/mobile/lib/core/session/inone_session.dart)
- [InOne Beta 1 API contracts](https://github.com/vahe210991-cloud/InOne-chat/blob/main/mobile/API-CONTRACTS-BETA-1.md)
- [Identity implementation roadmap (planning PR #149 branch)](https://github.com/vahe210991-cloud/InOne-chat/blob/planning/beta-2.0-cto-2026-11-24/docs/product/BETA-2.0-IDENTITY-IMPLEMENTATION-ROADMAP.md)
