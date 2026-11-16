# OneBot / StickyBot — implementation readiness audit

**Date:** 2026-11-16 (UTC+3)  
**Task branch:** `audit/onebot-stickybot-contract-readiness-2026-11-16`  
**Base branch:** `feature/email-delivery-service-2026-11-16-b1`  
**Base SHA:** `1bddce2d77477faa0fb804173c97e8b06ad9ae8b`  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Related architecture PR:** [#60](https://github.com/vahe210991-cloud/InOne-chat/pull/60)  
**Backend source branch:** PR #61 head, stacked on PR #48  
**Status:** audit completed; implementation BLOCKED pending owner-approved API contract and full working-copy/test capability.

## 1. Audit scope and source selection

Inspected the owner-approved Bot Platform / StickyBot proposal in PR #60, the current backend source carried by PR #61, its parent Beta 1.0 integration branch PR #48, the approved WBS v1.1, repository operating rules, continuity documents, and the relevant Node/PostgreSQL backend modules.

The selected backend baseline is `feature/email-delivery-service-2026-11-16-b1` at `1bddce2d77477faa0fb804173c97e8b06ad9ae8b`, because PR #61 is the latest current backend work and is based on PR #48. PR #61 is still draft/unmerged; this task branch is intentionally stacked on that exact head and must be retargeted after its dependency is merged.

The architecture proposal in PR #60 is documentation-only and is not yet merged. The owner-approved names are **OneBot** and **StickyBot**; **The Bot** is rejected; public bot names must be English-only.

## 2. Confirmed implementation inventory

The recursive source tree at the selected backend SHA contains 1,027 entries. The audit found:

- No bot or sticker-pack source modules.
- No bot-specific test files.
- No bot registry, credential, webhook, installation, event or audit tables.
- No bot repository methods in either the PostgreSQL store or in-memory test store.
- No bot management or external bot API routes in the HTTP server.
- No Bot ID / bot principal / bot-authentication model.
- No StickerBot image-processing worker or image-processing dependency.
- No public sticker-pack catalog, versioning, personal sticker collection or 50-item enforcement.

The existing route `GET /rooms/:roomId/stickers` only lists room-owned assets filtered by visibility. It is not a sticker-pack service, user collection or StickyBot implementation.

## 3. Existing backend capabilities that can be reused carefully

| Existing capability | Source at selected SHA | Finding |
|---|---|---|
| HTTP API | `engine/src/server.js` | Single large route dispatcher; no bot routes |
| PostgreSQL persistence | `engine/src/store.js` | Transaction helper exists; no bot repository methods |
| In-memory persistence | `engine/src/store-memory.js` | Parallel test-store contract; no bot methods |
| Schema and migrations | `engine/src/schema.sql`, `engine/migrations/` | Schema includes through migration 0030; no bot tables |
| Rate limits | `engine/src/rate-limit.js`, `store.rateHit` | Persistent fixed-window primitive exists; no bot policies |
| Object storage | `engine/src/object-store.js` | Disk/memory object stores exist; current file flow is designed for encrypted attachments |
| File routes | `engine/src/server.js` around `/files` | Authenticated, signed upload/download; file metadata and room access checks |
| Platform roles | `platformRoleOf` in both stores | Existing owner/admin role checks are used for organization administration; no bot moderation hierarchy |
| Audit | `admin_action_log`, org request logs | Organization-scoped admin history exists; no global bot audit stream |
| MLS messages | `/mls/groups/:id/messages` | Server enforces encrypted-event boundary; no bot MLS participant protocol |

Relevant reviewed blob SHAs:
- `server.js`: `255357d2b630e6dd3a8e0828d10458d09ecedfa0`
- `store.js`: `065a7ed0d37cfb892697f70eb7edfb63f3917886`
- `store-memory.js`: `c7e89aeeba8bff547a351ebdea8b2477a20e9afd`
- `schema.sql`: `719642952e016f8225d9f90a4d8c63662cabcec9`
- `migrate.js`: `2446d15b8976ffd5f30b7e47cd495c610f600058`
- `config.js`: `d1c47b2762ff660c4cb61fd798ca0c75b1dfab76`
- `object-store.js`: `6dd691f1858ac20c026ce8570fefad947a446483`
- `rate-limit.js`: `4c387fc37a4f0e274fa061f9bbcfa304bea7cf45`
- `identity-rules.js`: `67dcbafd505f3731c977a3117c4a5b61bdc1b099`
- `room-names.js`: `468824eaae48f5113433857e67d0d88249b71a05`
- `0029-email-delivery.sql`: `2eb7609edfa66330499c961208e8fd1f019c0299`

## 4. Security and architecture gaps

### 4.1 Bot identity and authorization

The current backend identifies users through account/device sessions. It has no separate bot principal, bot bearer-token verifier, bot ownership boundary, installation-specific scopes or token revocation path. Platform owner/admin roles exist, but there is no bot-specific moderation role, approval chain or audit model.

### 4.2 MLS / E2EE

The existing server accepts encrypted room events and routes MLS messages through the dedicated MLS endpoints. The architecture correctly forbids server-side plaintext fallback. No bot MLS client/participant protocol, key-package flow, bot device lifecycle or explicit MLS membership implementation exists. Therefore chat message/command webhooks and bot message sends must remain disabled. Implementing them as server-side plaintext hooks would violate the approved security boundary.

### 4.3 Sticker media

The existing object store is reusable as a low-level byte store, but the existing `/files` contract is an encrypted-attachment flow. StickyBot image transformation needs access to image pixels, so it requires a separately approved upload/privacy boundary, processing worker, resource limits and source-image retention policy. No third-party image provider has been selected or approved; none may be called.

### 4.4 Global protected-name policy

The existing `identity-rules.js` has a reserved nickname list containing exact `inone` and `propo` values, and the current nickname validator restricts the handle to ASCII. This does not implement the owner's broader policy for every public entity name. `room-names.js` currently trims/collapses whitespace and lowercases channel keys but has no Unicode/confusable policy. Organization request names are length-checked and trimmed. A centralized normalization/reservation/approval service is not present in the audited backend. Bot usernames/display names must not ship with a weaker duplicate implementation.

### 4.5 Data and operational readiness

The conceptual architecture entities are not a physical schema. There are no approved unique indexes, transaction boundaries, retention rules, quota values, retry schedule, webhook delivery semantics or image media contract. The latest schema/migration chain ends at `0030-profile-email-locale`; no bot migration exists.

## 5. Missing decisions in the architecture proposal

The proposal itself leaves these items open:
- account eligibility and per-account bot quota;
- organization/team ownership in v1;
- exact API paths, request/response DTOs, status codes and error codes;
- webhook event names, signature canonicalization, retry schedule and retention;
- credential expiry, overlap and pepper/key management;
- exact scope/moderation matrix and moderation authority;
- rate limits and payload limits;
- bot installation API and the MLS participant protocol;
- image provider boundary, input/output formats and limits, source-image retention;
- sticker-pack visibility, publication, deletion, copyright takedown and cached-copy behavior;
- physical database schema and migration sequence.

A proposed v1 API contract has been prepared in `development/contracts/BOT-PLATFORM-API-v1-DRAFT.md`. It is explicitly marked DRAFT and must not be treated as approved implementation input until the owner reviews it.

## 6. Implementation readiness

**Code ready for tests: NO.**

No product code was changed in this audit. No test suite was run. The implementation gate is blocked for two independent reasons:

1. **Contract approval:** repository rules prohibit inventing production routes when the API contract is missing. The architecture document explicitly defers physical schema and exact routes/DTOs/limits to a separate contract review. The owner must approve or amend the draft contract before implementation.
2. **Working-copy capability:** repository rules require a complete clone or Codespace for broad multi-file backend changes and runtime tests. This session has GitHub repository API access but no available Codespace/complete Git working copy or Node/PostgreSQL execution environment. Repository-native file edits are not a safe substitute for changing the large HTTP server, both stores, migrations, schema and tests together.

No server was started, no database was exposed, no deployment or merge was performed, and no production secret was created.

## 7. Next gate

1. Owner approves the draft API contract or returns changes in one consolidated review.
2. Obtain an authorized complete repository working copy/Codespace for the backend branch after PR #61 dependency is resolved.
3. Implement control-plane storage, transactional repository methods, routes, bot-token authentication, webhook verification/delivery, scope enforcement, global name policy integration, StickyBot media/pack services and tests.
4. Keep chat content routes disabled until MLS bot participation has its own approved protocol and device-level acceptance.
5. Run Node unit/HTTP tests, PostgreSQL migration/concurrency tests, security tests, and only then report exact-SHA readiness.

## 8. Test and change status

- Source audit: **PASS** (read-only review of the selected branch and architecture proposal).
- Bot/sticker implementation: **NOT STARTED** (blocked at the approval and working-copy gates above).
- Product tests: **NOT RUN**.
- Database migrations: **NOT CREATED**.
- API routes: **NOT CREATED**.
- PR merge / deployment: **NOT PERFORMED**.
