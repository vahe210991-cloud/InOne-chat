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
| SC-04 | `POST /register` | Email, registrationToken, password, nickname, optional/required phone per server config | Backend + host; one-time registration ticket is held only in Flutter session memory; successful registration follows with normal login per D11. SMS confirmation not yet wired |
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
| ST-01 | `PUT /devices/me/push`; `DELETE /devices/me/push` | Authenticated current-device FID registration/unregister; FCM accepts a 22-character FID plus legacy-token compatibility; feature flag applies | Flutter Firebase Messaging FID registration/refresh, permission gating, APNs readiness, Firebase unregister and logout cleanup are connected; sender delivery remains separate |
| ST-02 | `GET /config/public`; `GET /config` | Public config unauthenticated; private config authenticated | Backend + host |
| ST-03 | Shared state and public config | No separate screen-specific mutation | Client/shared host state |
| CH-01 | `GET /rooms/mine` | Authenticated user's rooms | Typed repository + native messages list load independently of MLS opt-in; room contents remain MLS-gated. Tests and live Flutter→Node E2E intentionally NOT RUN on the screen-wiring branch |
| CH-02 | `GET /rooms/:id/events`; `GET /mls/groups/:id/commits?since=N`; `GET /mls/welcomes`; `POST /mls/welcomes/:id/ack`; `POST /mls/groups/:id/messages`; `GET /sync?since=N&signal_since=M`; `GET /rooms/:id/members`; `POST /rooms/:id/read`; `POST /rooms/:id/settings`; native MLS invite | Room event history is ciphertext only; MLS commits/messages are epoch-checked; membership and effective capabilities checked | Flutter → canonical Engine B history/sync, durable SQLCipher text outbox, text send and encrypted attachment send/download remain behind `INONE_MLS_NATIVE_ENABLED` (default false). Thread now reads member/capability/read-marker metadata, permission-gates rename and MLS invite, and posts read markers only after readable history is durably loaded. Runtime/security/two-device acceptance remains pending; no plaintext fallback |
| GR-01 | `GET /rooms/mine`; `GET /rooms/search?q=...`; `POST /rooms/:id/join` | Authenticated user's rooms; public-name search (2–50 chars); open join or approval request, with org membership/capacity enforced server-side | Typed room list plus public group search/join UI connected. Approval-only joins display request state. An open join does not itself provision a device MLS Welcome; room history remains closed until the native Engine B epoch is available |
| GR-02 | `POST /rooms` | `roomId`, `kind`, optional `name`, members and org/feature gates | Backend only; typed create form and validation pending |
| GR-04 | `GET /rooms/:id/members`; `POST /rooms/:id/settings`; `PUT /rooms/:id/name`; roles/capabilities/owner endpoints as allowed by action | Per-capability authorization; owner/admin restrictions | Room metadata/member/capability/read-marker display is connected; rename uses capability-checked `POST /rooms/:id/settings`; native MLS invitation is shown only to members with `invite_members`. Role changes, removals, approval queue and full settings controls remain pending |
| OR-01 | `GET /orgs/mine`; `GET /orgs/:id/members`; `POST /orgs/:id/members`; `POST /orgs/:id/members/:userId/role`; `DELETE /orgs/:id/members/:userId` | Current user's organization memberships, roles and member list; owner/admin add/remove rules; owner-only role changes; last-owner and owned-room safety constraints | Typed repository and role-aware organization UI connected: owner can add any supported role, change roles and remove other members; admin can add/remove ordinary members only. Backend remains authoritative for last-owner and owned-room conflicts |
| PR-01 | `GET /profile`; `PATCH /profile/locale`; `GET /devices/mine`; `DELETE /devices/:deviceId` | Current account profile and locale; authenticated device inventory and per-account device revocation | Typed profile/locale flow plus device inventory and revocation dialog connected. Current device cannot be revoked from its own session; server revocation removes push registration and records MLS device removals. Profile/avatar mutation remains unavailable without a confirmed contract |

The v0.8 approval manifest contains 24 screen IDs (SC/RQ/PS/SR/ST). The Flutter handoff catalog adds 7 chat/room/profile/organization screen IDs. The manifest's declared `api` string is a design declaration, not an authorization grant or proof of Flutter dispatch.

### Account locale contract

- The app owns the user's language choice; do not infer it from the device OS locale.
- Flutter persists the selected `hy`, `ru`, or `en` locale locally and sends it with `POST /register/email`.
- The backend stores the pending registration locale with the email-code record, then copies it into the new profile when the one-time registration token is consumed.
- `GET /profile` returns the saved locale. `PATCH /profile/locale` changes it for the authenticated account.
- Account-security emails for authenticated actions use the saved profile locale at event creation; every recipient, including a backup address, receives the same account locale. A successful password/provider login may include a pending local UI locale, which the backend persists after authentication and before queuing login-security email. Pre-auth recovery actions (`/recovery/start`, `/recovery/cancel-by-code`, `/recovery/complete`) carry the currently selected UI locale per event; this does not mutate the account preference. If those legacy clients omit locale, the saved profile locale is used. The locale is frozen in the encrypted queue payload so later preference changes do not rewrite already queued mail.

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
7. Acknowledge to-device and signal streams on the next `GET /sync?since=N&signal_since=M` request. The server caps each acknowledgement at the highest sequence actually delivered to that device. `POST /rooms/:id/read` separately advances the room read marker (`upTo` event ID); it is not a delivery-queue ACK and not an MLS cryptographic ACK.

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

## 6. Acceptance boundary

The following items are **outside Stage 3 acceptance** and remain assigned to their own stages:
- Production endpoint, deployment, SMTP/SMS operations, monitoring and backup/restore are not certified by this source contract.
- No end-to-end Flutter flow is accepted solely because its backend route exists.
- Native MLS FFI, secure local message database, offline restart recovery and native token ownership are Stage 4.
- Full typed WebView bridge expansion, file picking and screen-level API binding are Stage 2.
- Physical Android/iOS device visual acceptance is Stage 1.
- Stage 3 PostgreSQL concurrency acceptance is complete on PR #44 code head `3d288777135d0c12145f18407e8768a02ae80a9f`; the DB-backed workflow result is recorded in the repository Stage 3 acceptance report.

## 7. Stage 3 acceptance checklist

- [x] Every Beta 1 screen has a contract or explicit client-only / blocked / future reason.
- [x] Every screen-declared API operation maps to concrete backend route evidence.
- [x] Request, response, error and permission boundaries are documented for the write flows and multi-step operations.
- [x] CH-02 history, MLS message send, commits, Welcome ACK, sync ACK and read marker semantics are reconciled.
- [x] Applicant/member/admin/platform-owner authorization suites pass in backend and PostgreSQL workflows.
- [x] F-01 and F-02 concurrency regressions pass against PostgreSQL 16.
- [x] Backend Node suite and all required Rust/OpenMLS/Flutter CI jobs pass on the code-validation head.
- [x] The final documentation-only update is being revalidated by GitHub Actions on the latest PR head.

## 8. Security concurrency findings — closed on PR branch

| Finding | Implementation | Regression evidence | Status |
|---|---|---|---|
| F-01 — stale organization-link accept vs revoke | Conditional compare-and-set transition in the PostgreSQL and memory stores. Audit events are emitted only after a successful state transition. | Stale-read interleaving: revoke wins; stale accept returns 409; no `link_accept` audit event. Passed in the PostgreSQL integration job. | **Closed on PR #44 branch** |
| F-02 — public open-join race | One PostgreSQL transaction serializes on the room row, revalidates direct or linked organization membership under share locks, checks capacity and inserts membership. Revocation locks the authorization row before deleting room membership and organization membership. | Concurrent capacity-limited joins; route-preflight membership revocation; PostgreSQL lock test proving revocation waits for an in-flight join and then removes the inserted room membership. All passed in the PostgreSQL integration job. | **Closed on PR #44 branch** |

### Verified workflow evidence

Code-validation head: `3d288777135d0c12145f18407e8768a02ae80a9f`.

- Backend Node: 382 passed, 0 failed.
- PostgreSQL 16: 124 passed, 0 failed; log includes the F-01 stale-accept test and all F-02 tests.
- OpenMLS client target check/tests, Rust bridge check/tests, Rust formatting and P0 room-list regression: passed.
- Flutter analyze, Flutter tests and Android preview APK build: passed.

See [Stage 3 API / Backend acceptance report](../development/reports/2026-11-11-stage-3-api-backend-audit.md) and PR [#44](https://github.com/vahe210991-cloud/InOne-chat/pull/44) for exact run references and scope boundaries.

The fixes are independently implemented against the committed repository source. The original untransferred Codespaces working tree was not available; this branch does not claim to contain the original unpublished agent diff.
