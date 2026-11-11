# Beta 1.0 API contract matrix

**Статус:** рабочая каноническая карта Stage 3; не является заявлением о production readiness.  
**Backend source:** `inone-development-archive-0.6.0/engine/src/server.js`  
**Mobile host:** `mobile/lib/main.dart`, `mobile/lib/claude_ui_bridge.dart`, `mobile/lib/core/network/api_client.dart`  
**Экранные источники:** `mobile/assets/ui-approval/screen-manifest.json` и `mobile/lib/claude_screen_catalog.dart`.

## 1. Contract rules

1. Flutter owns HTTP. HTML/WebView sends a typed bridge message; it never receives access/refresh tokens, MLS secrets or arbitrary network access.
2. The backend is authoritative for membership, roles, feature flags, ownership and capabilities. Hiding a button in the UI is not authorization.
3. Route existence does not mean the operation is connected to Flutter. The bridge allowlist is intentionally narrower than the backend.
4. Generic screen probes are GET-only. Mutations require dedicated typed operations, payload validation, confirmation where appropriate, and tests.
5. Chat message plaintext must never be sent to the backend. MLS ciphertext is opaque to the backend.
6. For all API errors preserve HTTP status and backend `code` when present. Do not infer success from a 2xx body with missing required fields.

## 2. Screen-to-contract matrix

Status:
- **Backend + host** — backend handler exists and Flutter host currently dispatches it.
- **Backend only** — handler exists; a typed Flutter operation is still required.
- **Client only** — no server request is required.
- **Backend + protocol integration pending** — backend operations exist, but the secure multi-step client flow is not connected.
- **Contract gate** — implementation must remain blocked until a required provider/platform/owner decision is resolved.

| Screen | Required API / flow | Backend contract evidence | Current integration status |
|---|---|---|---|
| SC-00 | Client-side menu; role-gated entries | Roles are exposed by authenticated domain reads; server enforces every operation | Client only; menu must not infer platform-owner access |
| SC-01 | `POST /login` | Email/password + device metadata; returns access and refresh tokens, expiry metadata | Backend + host; verify complete error mapping |
| SC-02 | `POST /register/email` | `202 {ok:true}`; same response for existing/non-existing email; rate limited | Backend + host |
| SC-03 | `POST /register/email/confirm` | `200 {registrationToken}`; invalid/expired/locked code returns 403/410 | Backend + host; response navigation is host-driven |
| SC-04 | `POST /register` | Email, registrationToken, password, nickname, optional/required phone per server config | Backend + host; owner policy says phone required, SMS confirmation not yet wired |
| SC-05 | `POST /auth/nonce` → `POST /auth/provider/verify` | One-use nonce (10 min); provider google/apple; result is linked proof or registration ticket | Backend only; native provider callback and typed host flow pending |
| SC-06 | `POST /register/provider` | One-use provider ticket + nickname; returns registration/session result | Backend only; typed host flow pending |
| SC-07 | `POST /recovery/start` | Privacy-preserving `202 {ok:true}`; rate limit returns 429 + retryAt | Backend only; typed host flow and channel-specific copy pending |
| SC-08 | `POST /recovery/confirm` | Confirmation link; GET preview is non-mutating; POST consumes link | Backend only; web handoff/deep-link contract pending |
| SC-09 | `POST /recovery/complete` | Recovery code + new password (and configured PIN requirements); 48-hour recovery policy applies | Backend only; typed host flow and security copy pending |
| SC-10 | `POST /recovery/cancel-by-code`; authenticated `POST /recovery/cancel`; `POST /admission/cancel` where admission flow applies | Code/device-based cancellation paths are distinct; existing device-age rule applies to authenticated cancel | Backend only; map screen actions to the correct path, do not conflate credentials |
| SC-11 | `POST /login` + `GET /approvals` + `POST /approvals/:id/claim` | Claim is bound to device approval; token pair is issued only after valid claim | Backend only / host partial; polling, activation and pollSecret lifecycle pending |
| SC-12 | `POST /logout` | Revokes current device session; device registration remains | Backend + host |
| RQ-01 | `POST /org-requests` | `200 {requestId,status}`; authenticated applicant | Backend only |
| RQ-02 | `POST /org-requests/:id/documents` | `kind`, `contentBase64`; max 5 MB; secret/config and pending-request checks | Backend only; native picker, MIME/size checks, progress and retry pending |
| RQ-03 | `GET /org-requests` | Applicant sees own requests; platform staff sees queue | Backend + host; role-aware presentation pending |
| RQ-04 | `GET /org-requests/:id`; `GET /org-requests/:id/documents/:docId` | Applicant and authorized platform staff; document view is audited | Backend only / host partial; binary download adapter pending |
| PS-01 | `GET /org-requests` | Platform queue; role checks server-side | Backend + host; staff-only navigation/presentation pending |
| PS-02 | `GET /org-requests/:id`; `GET /org-requests/:id/documents/:docId` | Platform view is read-only and journaled | Backend only / host partial |
| PS-03 | `POST /org-requests/:id/decision` | Platform owner only; admin receives 403 `not_platform_owner`; repeat decision 409 | Backend only; owner-only action and error text pending |
| SR-01 | `GET /users/search?nickname=...` | Rate limited; returns only userId/nickname/verificationLevel; requires shared org/link | Backend only; typed query/result UI pending |
| ST-01 | `PUT /devices/me/push`; `DELETE /devices/me/push` | Authenticated current-device push-token lifecycle; feature flag applies | Backend only; native permission/token registration pending |
| ST-02 | `GET /config/public`; `GET /config` | Public config unauthenticated; private config authenticated | Backend + host |
| ST-03 | Shared state and public config | No separate screen-specific mutation | Client/shared host state |
| CH-01 | `GET /rooms/mine` | Authenticated user's rooms | Backend + host; screen data binding pending |
| CH-02 | `GET /rooms/:id/events`; `GET /mls/groups/:id/commits?since=N`; `GET /mls/welcomes`; `POST /mls/welcomes/:id/ack`; `POST /mls/groups/:id/messages`; sync/ack lifecycle | Room event history is ciphertext only; MLS commits/messages are epoch-checked; membership checked | Backend + protocol integration pending; no WebView direct send |
| GR-01 | `GET /rooms/mine` | Authenticated user's rooms/groups | Backend + host; group-specific presentation pending |
| GR-02 | `POST /rooms` | `roomId`, `kind`, optional `name`, members and org/feature gates | Backend only; typed create form and validation pending |
| GR-04 | `GET /rooms/:id/members`; `POST /rooms/:id/settings`; `PUT /rooms/:id/name`; roles/capabilities/owner endpoints as allowed by action | Per-capability authorization; owner/admin restrictions | Backend only; map each control to one explicit action |
| OR-01 | `GET /orgs/mine` | Current user's organization memberships and roles | Backend + host |
| PR-01 | `GET /profile` | Current account profile, providers and security hints | Backend + repository; profile edit contract is separate |

The v0.8 approval manifest contains 24 screen IDs (SC/RQ/PS/SR/ST). The Flutter handoff catalog adds 7 chat/room/profile/organization screen IDs. The manifest's declared `api` string is a design declaration, not an authorization grant or proof of Flutter dispatch.

## 3. Authentication and authorization boundaries

### Public or pre-authentication operations
- `POST /login`
- `POST /register/email`
- `POST /register/email/confirm`
- `POST /register` (verified/open behavior depends on server registration mode)
- `POST /auth/nonce`
- `POST /auth/provider/verify`
- `POST /register/provider`
- Recovery start/confirm/cancel-by-code/complete flows as defined by their route handlers.

### Authenticated operations
All room, organization, profile, device, push, approvals, file, sync and MLS operations require a valid bearer session. Route-level role/capability checks still apply after authentication.

### Required negative cases
- A non-member cannot read room history or access private room resources.
- A member without the relevant capability cannot send messages, invite/remove members or change settings.
- An organization admin cannot make a platform-owner decision.
- A user cannot read another applicant's private documents.
- A WebView event cannot select an arbitrary HTTP method/path.
- No legacy/plaintext message POST may bypass MLS.

## 4. CH-02 — authoritative message flow

The current backend flow is:

1. Read room history: `GET /rooms/:id/events` → `{events:[...]}`. The handler checks membership and returns events after the user's join sequence.
2. Read group commits: `GET /mls/groups/:id/commits?since=<epoch>`; process commits in epoch order.
3. Receive pending welcomes: `GET /mls/welcomes`; acknowledge each accepted welcome using `POST /mls/welcomes/:id/ack`.
4. Send message: `POST /mls/groups/:id/messages` with `{message: <base64 MLS ciphertext>, kind, forwarded?, clientMessageId?}`.
5. The backend checks membership, `send_messages` / sticker / forwarding capabilities, ciphertext framing, group ID, current epoch, size and idempotency.
6. For offline clients, consume room events in epoch order and apply intervening commits before later-epoch messages.
7. Use the sync acknowledgement contract for read/processed position; do not equate a UI-rendered message with a durable MLS acknowledgement.

**Forbidden fallback:** `POST /rooms/:id/events` returns HTTP 409 and directs the caller to `/mls/groups/:id/messages`. The WebView must not send plaintext or invent a legacy encrypted-event payload.

The server does not decrypt MLS ciphertext. Cryptographic verification and local durable MLS state remain native-client responsibilities and belong to Stage 4.

## 5. Existing test coverage to preserve and extend

The engine's `npm test` suite already includes dedicated suites for:
- auth/session/recovery/provider flows;
- organization requests, document access, roles, links, admin logs and isolation;
- room membership, permissions, owner transfer, settings, invitations and public groups;
- MLS messages, groups, membership, offline delivery, idempotency, epoch expiry, welcomes and sync ACK;
- files, push, configuration and secret-log hygiene.

The following test files are the primary integration evidence:
- `engine/test/mls-messages.test.js`
- `engine/test/mls-offline.test.js`
- `engine/test/sync-ack.test.js`
- `engine/test/org-requests.test.js`
- `engine/test/org-access.test.js`
- `engine/test/org-isolation-matrix.test.js`
- `engine/test/room-permissions.test.js`
- `engine/test/sessions.test.js`
- `mobile/test/claude_ui_bridge_test.dart`
- `mobile/test/core/network/api_client_test.dart`

A source-contract regression test is added alongside these suites to prevent screen-declared routes from silently drifting away from server handlers and to keep the legacy room-event POST blocked.

## 6. Explicitly not accepted yet

- No production endpoint or deployment is certified by this source contract.
- No end-to-end Flutter flow is accepted solely because its backend route exists.
- Native MLS FFI, secure local message database, offline restart recovery and token ownership are Stage 4.
- WebView typed bridge expansion, file picker and UI binding are Stage 2.
- Physical Android/iOS visual acceptance is Stage 1.
- PostgreSQL concurrency claims require the DB-backed test job to pass; memory tests alone are insufficient.

## 7. Stage 3 acceptance checklist

- [ ] Every Beta 1 screen has a contract or explicit client-only/blocking reason.
- [ ] Every screen API maps to a concrete backend handler.
- [ ] Request/response/error/permission contracts are documented for all write operations.
- [ ] CH-02 MLS flow passes memory and PostgreSQL-backed tests.
- [ ] Applicant/member/admin/platform-owner negative authorization tests pass.
- [ ] Flutter analyze and unit tests pass after any client contract changes.
- [ ] CI passes on the final PR head SHA, not merely on an earlier local commit.
- [ ] Any deployment-dependent check is reported separately from source/test acceptance.


## 8. Security concurrency blockers discovered during Stage 3

These are **not accepted** and must not be hidden by the route-presence checks above.

| Finding | Current source evidence | Required closure | Status |
|---|---|---|---|
| F-01 — stale organization-link accept vs revoke | The accept handler reads the link, checks `status === 'proposed'`, then separately calls `setOrgLinkStatus(...active)`. This is not a compare-and-set transition at the handler boundary. Existing `org-links.test.js` covers sequential accept/revoke behavior, not the stale-read interleaving. | Transfer and review the previously prepared conditional state-transition patch and regression test; prove stale accept returns 409 and creates no active link or accept audit event. Run PostgreSQL concurrency test. | **Blocked — source patch not in main/PR #42** |
| F-02 — open-join concurrency race | A previously prepared atomic PostgreSQL/locking fix and deterministic barrier regression are not present in current main. | Obtain the original agent's source/test handoff; review the exact diff; run memory regression and PostgreSQL concurrency test on CI. | **Blocked — source patch not in main/PR #42** |

PR #42 currently contains only the PostgreSQL CI workflow; it does not contain the F-01/F-02 source changes or regression test. The CI workflow alone is infrastructure, not proof that either race is fixed.

**Preservation rule:** do not recreate, overwrite or discard the original agent's untransferred working-tree changes. Obtain the exact patch and its file list first, compare against current main, then apply it on an isolated branch. Stage 3 security acceptance remains blocked until the source diff and PostgreSQL concurrency evidence are both present.
