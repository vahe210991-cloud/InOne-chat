# OneBot / StickyBot API contract v1 — OWNER-APPROVED IMPLEMENTATION BASELINE

**Status:** OWNER APPROVED — implementation baseline (2026-11-16, UTC+3)  
**Date:** 2026-11-16 (UTC+3)  
**Backend base reviewed:** `feature/email-delivery-service-2026-11-16-b1` @ `1bddce2d77477faa0fb804173c97e8b06ad9ae8b`  
**Architecture source:** PR #60, `development/architecture/INONE-BOTS-AND-STICKERS.md`  
**Canonical bot names:** OneBot and StickyBot  
**Language:** canonical bot names and public bot names are English-only. Interface copy may be localized.

The owner approved this v1 contract as the implementation baseline on 2026-11-16. The routes, lifecycle, security invariants, credential handling, media boundary and proposed media limits below are approved as the baseline. Items explicitly marked as unresolved owner decisions remain fail-closed/configuration gates; implementers must not invent production quotas, retention periods, provider choices or moderation authority. Any change to an approved invariant requires a new owner decision and a versioned contract update.

## 1. Scope and release boundary

1. The Bot Platform is an independent backend module. It must not become a dependency of account registration, login, ordinary chat or MLS.
2. OneBot is the administration-owned entrypoint for registering and managing bots. It is not itself an authorization bypass; backend policy checks remain authoritative.
3. StickyBot is an administration-owned image-to-sticker service using the same bot identity and installation infrastructure.
4. The current Beta 1.0 WBS v1.1 is not changed. Permissioned group bots remain a Beta 2.0 candidate. Full Bot Platform / StickyBot release placement remains a separate owner decision.
5. Phase 1 may implement the bot control plane only after this contract is approved. Chat message delivery and sending remain disabled until the MLS participant protocol is separately approved and implemented.
6. No server-side plaintext access to MLS messages, hidden listener, plaintext fallback, or transfer of MLS secrets is permitted.

## 2. Proposed API boundaries

### 2.1 Account-authenticated management API

Management calls use the existing InOne account bearer session. A caller may manage only bots for which that account is the owner.

| Method | Proposed route | Purpose |
|---|---|---|
| POST | `/bots` | Create a user-owned bot in `PENDING_SETUP` |
| GET | `/bots` | List bots owned by the authenticated account |
| GET | `/bots/{botId}` | Read one owned bot and its safe metadata |
| PATCH | `/bots/{botId}` | Change display name, description and category |
| POST | `/bots/{botId}/credentials` | Issue a new credential; return its secret once |
| POST | `/bots/{botId}/credentials/{credentialId}/revoke` | Revoke one credential immediately |
| PUT | `/bots/{botId}/webhook` | Set or replace the HTTPS webhook endpoint and subscriptions |
| POST | `/bots/{botId}/webhook/verify` | Start/complete endpoint ownership challenge |
| PUT | `/bots/{botId}/scopes` | Request scopes; sensitive scopes remain pending moderation |
| POST | `/bots/{botId}/stop` | Stop a bot and block API/event delivery |
| POST | `/bots/{botId}/start` | Resume only if all required checks are satisfied |
| DELETE | `/bots/{botId}` | Request deletion; do not hard-delete audit history |

The final route names and DTOs must be reconciled with the repository's existing route conventions and OpenAPI source before implementation.

### 2.2 External bot REST API

Base path proposal: `/api/bot/v1`. Authentication is a bot credential in the `Authorization: Bearer` header. Credentials are never accepted in URL query parameters.

| Method | Proposed route | Scope | Availability |
|---|---|---|---|
| GET | `/api/bot/v1/bot` | `profile.read.basic` | Phase 1 |
| POST | `/api/bot/v1/messages` | `messages.send` | BLOCKED until MLS bot-participant support |
| GET | `/api/bot/v1/installations` | none beyond valid bot token | Phase 2, after installation contract |
| POST | `/api/bot/v1/installations/{installationId}/reply` | `messages.send` | BLOCKED until MLS bot-participant support |

No endpoint for reading all chats, account credentials, room keys, device keys, refresh tokens or historical chat content is permitted. No mass-messaging scope is proposed for v1.

### 2.3 Webhook event envelope

Proposed common envelope:

```json
{
  "eventId": "evt_<opaque-id>",
  "eventType": "bot.status.changed",
  "apiVersion": "v1",
  "createdAt": "2026-11-16T00:00:00.000Z",
  "botId": "bot_<opaque-id>",
  "installationId": null,
  "data": {}
}
```

Initial control-plane event names proposed:
- `bot.status.changed`
- `bot.credential.revoked`
- `bot.installation.created`
- `bot.installation.revoked`

Chat content events (including `message.created` and `command.received`) are not enabled until the bot is a real, explicit MLS participant. They must not be simulated by forwarding server-side plaintext.

### 2.4 Webhook security and delivery

Proposed signature headers:
- `X-InOne-Event-Id`
- `X-InOne-Timestamp`
- `X-InOne-Signature: v1=<hex HMAC-SHA256>`

Signature input proposal: `timestamp + "." + rawRequestBody`. Reject stale timestamps (proposed tolerance: five minutes), invalid signatures, duplicate delivery attempts already acknowledged, non-HTTPS endpoints, redirects, loopback/private/link-local destinations and DNS results that change to prohibited address ranges. Re-resolve and revalidate destinations at connection time to reduce DNS rebinding/SSRF risk.

Delivery proposal: durable event outbox, stable event ID, bounded exponential retries, idempotent receiver guidance, explicit delivery state and audit record. Exact retry schedule, retention and maximum attempts remain approval items. A webhook must not block the main chat/message transaction.

## 3. Proposed identity, lifecycle and credential rules

### 3.1 Bot identity

- Immutable opaque Bot ID; never use username as a primary key.
- Owner types: `user` or `platform`.
- Platform-owned bots cannot be transferred, deleted or managed through ordinary user commands.
- OneBot and StickyBot are system bots; their public display names are fixed to the owner-approved English names.
- Public bot username proposal: lowercase ASCII `[a-z][a-z0-9_]{3,31}`, unique case-insensitively. The official handles `onebot` and `stickybot` must be reserved for platform-owned records if available. Handle availability is NOT checked in this audit.
- User-created bot display names must be English-only and pass the global reserved-name policy for InOne/Propo. Existing protected-name enforcement is incomplete; see the audit report.

### 3.2 Proposed lifecycle

`PENDING_SETUP` → `ACTIVE` → `SUSPENDED` / `REVOKED` / `DELETION_PENDING` → `DELETED`.

Only backend transitions are allowed. A suspended or revoked bot cannot authenticate, send API calls or receive webhook events. Deletion should be a soft-delete/tombstone that preserves audit evidence and releases the username only after the approved retention window.

### 3.3 Credentials

- Generate at least 256 bits of cryptographically secure random token entropy.
- Proposed display prefix: `inb_`; full secret shown once only.
- Persist only a keyed verifier (HMAC-SHA-256 with a dedicated server-side pepper) plus credential ID, non-secret prefix, scopes, state, created/expiry/last-used/revoked timestamps.
- Compare verifiers in constant time. Never log tokens or include them in traces, analytics, error messages, URLs or webhook payloads.
- Support immediate revocation and re-issuance. Credential overlap during rotation must be explicit and time-bounded.
- The required pepper/key provisioning and rotation mechanism must be approved before adding configuration or schema.

### 3.4 Owner eligibility and quotas — approval required

The architecture document does not decide:
- whether an account must have verified email, verified phone, both, or an age/account-standing threshold;
- how many active/pending bots one account may own;
- how many credentials/webhook subscriptions may exist per bot;
- per-bot API and webhook delivery rate limits;
- whether organization ownership is included in v1.

Proposed conservative starting point for review: verified, non-suspended account; user ownership only; configurable per-account bot quota; no organization/team ownership in v1. Numeric quotas must be owner-approved, not hardcoded by an implementer.

## 4. Scopes and installation consent

Proposed scopes:
- `profile.read.basic`
- `commands.receive`
- `messages.receive`
- `messages.send`
- `files.receive`
- `files.send`
- `stickers.use`
- `groups.join`
- `members.read.basic`

Rules:
1. No wildcard, `admin`, account-wide, all-chat or history-reading scope.
2. Each API request rechecks the credential's current scope and installation's approved scope.
3. Sensitive scopes (groups, files, bulk/high-volume delivery) require platform moderation. The exact sensitive-scope matrix must be approved.
4. Installation into a personal conversation requires explicit user consent; group installation requires explicit group-admin approval.
5. Show bot name, owner/developer, requested scopes and data disclosure before consent.
6. Installation begins at the current event boundary; no prior history is delivered.
7. Uninstall/revocation immediately blocks new sends and webhook delivery.
8. MLS chat content remains unavailable until a separate MLS bot-client/participant protocol is approved. Consent UI alone does not grant plaintext access.

## 5. StickyBot image and sticker contract

### 5.1 Processing boundary

- No external AI/image provider may receive user photos without separate provider, disclosure, terms and retention approval.
- Initial implementation proposal: a self-hosted processing adapter only; no outbound third-party image API.
- Processing must be isolated from the HTTP request process, enforce resource/time limits, validate actual file signatures (not only MIME headers), decode safely, strip EXIF and other unnecessary metadata, and reject malformed or unsupported files.
- The source image must not be published automatically. Preview, save, pack creation and publication require explicit user actions.

### 5.2 Proposed media limits — approval required

| Property | Proposed v1 value |
|---|---:|
| Input formats | JPEG, PNG, WebP |
| Input size | maximum 10 MiB |
| Input dimensions | maximum 4096 × 4096 |
| Animation | reject multi-frame input in v1 |
| Output formats | PNG or WebP with alpha |
| Output dimensions | maximum 512 × 512 |
| Output size | maximum 512 KiB |
| EXIF/metadata | remove unless strictly required |

These are conservative design proposals, not current product limits.

### 5.3 Sticker packs

- A pack has an immutable Pack ID, owner, English title, description, visibility, cover, version and status.
- Hard server-side maximum: **50 stickers per pack**. Enforce atomically on create/import/add; concurrent additions must not exceed 50.
- Default visibility proposal: private. Owner may explicitly publish public or unlisted-by-link.
- A user's collection stores a reference to a pack; adding/removing a pack does not transfer or delete ownership.
- Each content update creates a new pack version. Auto-update is a user preference.
- Removing a pack from a user's collection never deletes the author's pack.
- Deletion, unpublishing, cached copies, reports and copyright takedown semantics require an approved retention/deletion policy.

### 5.4 Proposed sticker API routes

The following routes are a proposal only and require OpenAPI review:
- `POST /api/stickers/v1/uploads`
- `POST /api/stickers/v1/uploads/{uploadId}/complete`
- `POST /api/stickers/v1/process`
- `GET /api/stickers/v1/jobs/{jobId}`
- `POST /api/stickers/v1/stickers`
- `GET /api/stickers/v1/stickers/{stickerId}`
- `POST /api/stickers/v1/packs`
- `GET /api/stickers/v1/packs/{packId}`
- `PATCH /api/stickers/v1/packs/{packId}`
- `POST /api/stickers/v1/packs/{packId}/items`
- `DELETE /api/stickers/v1/packs/{packId}/items/{stickerId}`
- `POST /api/stickers/v1/packs/{packId}/publish`
- `POST /api/stickers/v1/packs/{packId}/collection`
- `DELETE /api/stickers/v1/packs/{packId}/collection`

This API must use a dedicated media policy. The existing encrypted attachment upload route is not automatically suitable for server-side image processing of plaintext photos.

## 6. Proposed logical persistence model

The architecture entities remain the starting point. The physical schema proposal needs review for foreign keys, uniqueness, indexes, transaction boundaries, retention and concurrency:

- `bots`
- `bot_credentials`
- `bot_webhooks`
- `bot_installations`
- `bot_events`
- `bot_audit_events`
- `stickers`
- `sticker_packs`
- `sticker_pack_items`
- `user_sticker_collections`

Required invariants:
- unique normalized username reservation;
- one owner identity per bot in v1;
- platform-owned system bots cannot be transferred;
- one credential verifier per credential, never raw token;
- unique event IDs and idempotent delivery acknowledgements;
- atomic pack item count with maximum 50;
- collection membership unique per user/pack;
- audit rows append-only from application APIs;
- no plaintext MLS payload stored or emitted by this module.

The existing in-memory test store and PostgreSQL store must implement the same repository contract, with concurrency behavior tested against PostgreSQL.

## 7. Error format and observability

Proposed API error shape, matching current backend style:

```json
{ "error": "human-readable message", "code": "stable_machine_code" }
```

Do not include raw credentials, signing secrets, image bytes, message plaintext, MLS secrets or private webhook response bodies in logs. Audit metadata must be redacted and must record actor, bot, action, target, reason, timestamp and outcome.

## 8. Remaining operational decisions (must not be guessed)

The owner must approve or change the following as one versioned contract:
1. v1 scope boundary: control plane only first, with chat event/send routes disabled until MLS participant support; confirm that this is acceptable.
2. Account eligibility and bot creation quotas.
3. Exact sensitive scopes and moderation authority.
4. API route names, DTOs, error codes and webhook event envelope.
5. Webhook retry/retention/rate-limit values and bot credential expiry/rotation policy.
6. Image processing provider boundary, file limits, output format, source-image retention and deletion policy.
7. Sticker-pack visibility, publication, version auto-update, takedown and cached-copy behavior.
8. Whether official public handles `onebot` and `stickybot` should be reserved after availability/collision checks.
9. Physical database schema and migration plan after the above contract is approved.

**Implementation authorization:** owner approval is recorded. Begin implementation against the approved baseline. Where this section leaves an operational value unresolved, ship a fail-closed/configurable boundary and keep the affected production capability disabled until the owner supplies the value. Do not weaken any MLS, consent, credential, SSRF or privacy invariant.
