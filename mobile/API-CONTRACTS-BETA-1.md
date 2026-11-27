# Beta 1.0 API contract matrix

> **Post-PR #131 status (2026-11-23):** PR #131 is merged into `main` at `2430b0365ab71c60b0926b27854d17a9090e1fba`. The current product UI is native Flutter/Dart; approved HTML screens remain visual references only. Canonical Engine B Rust FFI, G2 encrypted attachments, durable inbox/outbox and screen/backend integration are present in source. `INONE_MLS_NATIVE_ENABLED` remains false by default. Exact merge-SHA validation and physical Android/iOS two-device acceptance remain pending. This document's Stage 3 matrix below is retained as contract history; use the latest post-PR131 audit for current implementation and acceptance state.

**Статус:** историческая карта Stage 3 контрактов; не является заявлением о production readiness.  
**Backend source:** `inone-development-archive-0.6.0/engine/src/server.js`  
**Mobile host:** `mobile/lib/main.dart`, `mobile/lib/app/inone_mobile_app.dart`, `mobile/lib/core/network/api_client.dart`, `mobile/lib/core/mls/`  
**Production screens:** `mobile/lib/ui_dart_source/`; approved HTML package is a visual reference only.

## 1. Contract rules

1. Flutter/Dart owns HTTP and production navigation. Approved HTML/WebView screens are references only; no production WebView receives access/refresh tokens, MLS secrets or arbitrary network access.
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
| SC-00 | Client-side menu; role-gated entries | Roles are exposed by authenticated domain reads; server enforces every operation | Client-only navigation exposes only connected Beta 1.0 sections; Feed/Calls and publication actions remain hidden until their backend flows exist |
| SC-01 | `POST /login` | Email/password + device metadata; returns access/refresh tokens, expiry metadata, or `202 identity_check_required` with an opaque device-bound `challengeId`; identity code expires in 10 minutes, resend cooldown is 60 seconds, and five failed attempts trigger a one-hour lock | Native Flutter host connected; identity challenge ID is sent with the code; errors, expiry, resend and lockout are handled. Dart-owned refresh tokens rotate through OS secure storage and restore sessions through POST /token/refresh after restart; logout retries after access-token expiry and clears the stored token. The Dart copy is deleted after Rust accepts native ownership. Provider sign-in remains separate under SC-05/06 |
| SC-02 | `POST /register/email` | `202 {ok:true}`; same response for existing/non-existing email; rate limited; locale defaults to `hy` when omitted | Native Flutter host connected |
| SC-03 | `POST /register/email/confirm` | `200 {registrationToken}`; invalid/expired/locked code returns 403/410; unknown or already-registered email does not disclose account existence | Native Flutter host connected; registration ticket stays in Flutter session memory |
| SC-04 | `POST /register` | Email, registrationToken, password (8–128 Unicode code points), nickname, required phone number (no SMS verification), matching 8-digit recovery PIN entered twice | Native Flutter host connected; required phone/PIN persistence and profile phone visibility remain part of AUTH-08 acceptance; no SMS verification is required |
| SC-05 | `POST /auth/nonce` → `POST /auth/provider/verify` | One-use nonce (10 min); provider google/apple; result is linked proof or registration ticket | Backend only; native provider callback intentionally remains pending |
| SC-06 | `POST /register/provider` | One-use provider ticket + nickname; returns registration/session result | Backend only; typed native provider flow remains pending |
| SC-07 | `POST /recovery/start` | Privacy-preserving `202 {ok:true}`; rate limit returns 429 + retryAt | Native Flutter host connected; recovery request and cancellation navigation wired |
| SC-08 | `POST /recovery/confirm` | Custom-scheme recovery deep link; GET preview is non-mutating; explicit POST consumes the link | Native Flutter deep-link handoff and confirmation screen connected; production verified App Links/Universal Links remain a release requirement |
| SC-09 | `POST /recovery/complete` | Verified-email one-time code + matching recovery challenge + 8-digit recovery PIN + new password; 48-hour recovery policy applies | Native Flutter host connected; eight-digit PIN challenge, server-side limits and full recovery acceptance remain open under AUTH-08 |
| SC-10 | `POST /recovery/cancel-by-code`; authenticated `POST /recovery/cancel`; `POST /admission/cancel` where admission flow applies | Code/device-based cancellation paths are distinct; existing device-age rule applies to authenticated cancel | Native Flutter cancellation screen connected to the correct recovery/admission endpoint |
| SC-11 | `POST /login` + `GET /approvals` + `POST /approvals/:id/claim` | Claim is bound to device approval; token pair is issued only after valid claim | Native Flutter waiting/approval flow connected; polling and recheck wired. Runtime acceptance remains subject to CI and device tests |
| SC-12 | `POST /logout` | Revokes current device session; device registration remains | Backend + host |
| RQ-01 | `POST /org-requests` | `200 {requestId,status}`; authenticated applicant | Backend only |
| RQ-02 | `POST /org-requests/:id/documents` | `kind`, `filename`, `mimeType`, `contentBase64`; max 5 MiB; allowlisted MIME + magic-byte validation; upload is serialized against pending-request decision | Flutter binary upload adapter and per-owner AES-256-GCM local cache; backend stores encrypted object and audited metadata; preview plaintext is temporary and cleaned on startup/resume/logout/revocation |
| RQ-03 | `GET /org-requests` | Applicant sees own requests; platform staff sees queue | Typed repository and role-gated platform queue connected; applicant scope and platform role are enforced by backend |
| RQ-04 | `GET /org-requests/:id`; `GET /org-requests/:id/documents/:docId` | Applicant and authorized platform staff; document view is audited; downloads return validated MIME and safe attachment disposition | Detail screen, binary download adapter, owner-scoped encrypted storage and temporary preview connected; 401/revocation cleanup is wired |
| PS-01 | `GET /org-requests` | Platform queue; role checks server-side | Connected: queue navigation is shown only to platform admin/owner; backend filters applicant and staff scope |
| PS-02 | `GET /org-requests/:id`; `GET /org-requests/:id/documents/:docId` | Platform view is read-only and journaled | Connected: request detail, applicant metadata, document list and encrypted preview; temporary plaintext is cleaned after viewer handoff |
| PS-03 | `POST /org-requests/:id/decision` | Platform owner only; admin receives 403 `not_platform_owner`; repeat decision 409 | Connected: owner-only decision UI; server transaction locks request row and rejects stale/repeated decisions; authorization matrix tests added |
| SR-01 | `GET /users/search?nickname=...` | Rate limited; returns only userId/nickname/verificationLevel; requires shared org/link | Backend only; typed query/result UI pending |
| ST-01 | `PUT /devices/me/push`; `DELETE /devices/me/push` | Authenticated current-device FID registration/unregister; FCM accepts a 22-character FID plus legacy-token compatibility; feature flag applies | Flutter Firebase Messaging FID registration/refresh, permission gating, APNs readiness, Firebase unregister and logout cleanup are connected; sender delivery remains separate |
| ST-02 | `GET /config/public`; `GET /config` | Public config unauthenticated; private config authenticated | Backend + host |
| ST-03 | Shared state and public config | No separate screen-specific mutation | Client/shared host state |
| CH-01 | `GET /rooms/mine` | Authenticated user's rooms | Typed repository, native messages list and canonical group/direct/support preview mapping connected; on transport outage local room IDs restore from Engine B SQLCipher when native MLS is enabled |
| CH-02 | `GET /rooms/:id/events`; `GET /mls/groups/:id/commits?since=N`; `GET /mls/welcomes`; `POST /mls/welcomes/:id/ack`; `POST /mls/groups/:id/messages`; `GET /sync?since=N&signal_since=M`; `GET /rooms/:id/members`; `POST /rooms/:id/read`; `POST /rooms/:id/settings`; native MLS invite | Room event history is ciphertext only; MLS commits/messages are epoch-checked; membership and effective capabilities checked | Engine B bridge uses stable message/attachment IDs, SQLCipher persistence, durable outbox/inbox, retry on resume, local room restoration, ACK after durable readable history, and MLS-encrypted attachment manifest/payload. UI remains behind `INONE_MLS_NATIVE_ENABLED` (default false); device/two-device acceptance remains pending; no plaintext fallback |
| GR-01 | `GET /rooms/mine`; `GET /rooms/search?q=...`; `POST /rooms/:id/join` | Authenticated user's rooms; public-name search (2–50 chars); open join or approval request, with org membership/capacity enforced server-side | Typed room list plus public group search/join UI connected. Approval-only joins display request state. An open join does not itself provision a device MLS Welcome; room history remains closed until the native Engine B epoch is available |
| GR-02 | `POST /rooms` | `roomId`, `kind`, optional `name`, members and org/feature gates | Backend only; typed create form and validation pending |
| GR-04 | `GET /rooms/:id/members`; `POST /rooms/:id/settings`; `PUT /rooms/:id/name`; roles/capabilities/owner endpoints as allowed by action | Per-capability authorization; owner/admin restrictions | Room metadata/member/capability/read-marker display is connected; rename uses capability-checked `POST /rooms/:id/settings`; native MLS invitation is shown only to members with `invite_members`. Room visibility/join-policy settings are capability-gated; owner-only per-member capability editing is connected through POST /rooms/:id/capabilities. Room role changes/removals, approval queue and invite-link management remain pending |
| OR-01 | `GET /orgs/mine`; `GET /orgs/:id/members`; `POST /orgs/:id/members`; `POST /orgs/:id/members/:userId/role`; `DELETE /orgs/:id/members/:userId`; `GET/POST /orgs/:id/settings`; `GET /orgs/:id/settings/log`; `GET /orgs/:id/admin-log`; `GET/POST /orgs/:id/links`; `POST /orgs/:id/links/:linkId/(accept|revoke)` | Current user's organization memberships, roles and member list; owner/admin add/remove rules; owner-only role changes; last-owner and owned-room safety constraints | Typed repository and role-aware organization UI connected: owner can add any supported role, change roles and remove other members; admin can add/remove ordinary members only. Owner/admin settings edits, settings audit log, organization admin-action log, and organization link proposal/accept/revoke actions are also connected. Backend remains authoritative for last-owner and owned-room conflicts |
| PR-01 | `GET /profile`; `PATCH /profile/locale`; `GET /devices/mine`; `DELETE /devices/:deviceId` | Current account profile and locale; authenticated device inventory and per-account device revocation | Typed profile/locale flow plus device inventory and revocation dialog connected. Current device cannot be revoked from its own session; server revocation removes push registration and records MLS device removals. Profile/avatar mutation remains unavailable without a confirmed contract |

The v0.8 approval manifest contains 24 screen IDs (SC/RQ/PS/SR/ST). The Flutter handoff catalog adds 7 chat/room/profile/organization screen IDs. The manifest's declared `api` string is a design declaration, not an authorization grant or proof of Flutter dispatch.

### Registration phone and recovery PIN contract (approved 2026-11-27)

- Registration requires a phone number as a profile/account field. Phone ownership is not SMS-verified in Beta 1.0 and the phone number is never a recovery factor.
- The owner may choose whether the phone number is visible on their profile. Visibility is a profile privacy preference, not an authentication or authorization signal.
- Registration requires a separate recovery PIN entered twice and matching exactly. The PIN is exactly eight ASCII digits, represented as a string so leading zeroes are preserved. It is not the account password and cannot be used as a standalone login credential.
- Recovery requires both a one-time code sent to the verified email address and the recovery PIN in the same short-lived, server-bound recovery challenge. Email-only or PIN-only recovery is forbidden. Do not reveal account existence or which factor was correct through pre-auth responses.
- Store only an Argon2id password hash with a unique per-account salt and server-calibrated parameters. Never store, log, email, include in analytics, or place the PIN in a URL/deep link. Enforce strict server-side per-account and distributed rate limits, progressive delay and temporary lockout; the 8-digit namespace is not safe without online-guessing controls.
- Profile settings show a reminder no more than once every 7 days with exactly two actions: «Помню» and «Не помню, заменить». «Помню» acknowledges the reminder and defers it to the next weekly interval. «Не помню, заменить» starts a protected PIN-change flow requiring an authenticated session/re-authentication and verified-email confirmation; the new PIN is entered twice, the old hash is invalidated, and a security notification is sent.
- At least once every 30 days, after the regular password login, require a correct PIN before granting access to protected account areas. The server is authoritative for the last successful PIN verification timestamp; app restart and client clock changes must not bypass the gate. PIN is an additional periodic verification, not a password replacement.
- Approved user-facing security copy: «Просим прощения за временные неудобства. Мы заботимся о безопасности вашего аккаунта и хотим защитить его от постороннего доступа. Пожалуйста, подтвердите PIN-код восстановления.»

**Implementation status:** this is the approved product/API requirement, not evidence that the backend and Flutter flow are implemented. Track implementation and tests under AUTH-08; keep the task open until acceptance.

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
- Canonical Engine B FFI, SQLCipher local message database, durable inbox/outbox, offline retry and Rust token ownership are integrated in source after PR #131; they remain opt-in and not physically accepted until exact-SHA and two-device Android/iOS gates pass.
- Full typed WebView bridge expansion, file picking and screen-level API binding are Stage 2.
- Physical Android/iOS device and two-device acceptance remain separate release gates and are pending.
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


### Room administration — roles and join-request moderation

- Connected owner-only member role changes through `POST /rooms/:id/roles`; only `admin` and `member` are selectable, while owner transfer remains a separate server operation.
- Connected the capability-gated join-request list through `GET /rooms/:id/requests` and rejection through `POST /rooms/:id/requests/:userId/reject`.
- Approval is intentionally not exposed: the current server approval route inserts the account into the room and emits a room-change signal but does not require or deliver an MLS Welcome. Enabling it would desynchronize server membership from encrypted group membership.
- Direct `DELETE /rooms/:id/members/:userId` is intentionally not exposed for the same reason: it removes server membership without requiring an MLS commit. Member removal must be driven by an MLS commit containing the removal and epoch transition.


### Native MLS account removal

- Added the native OpenMLS client operation `remove_member(roomId, userId)`. It checks server/MLS membership equality, protects the room owner and self-removal, preflights current `remove_members` authorization (including the admin-vs-admin restriction), locates every MLS leaf for the target account, stages one OpenMLS Commit, verifies the staged membership metadata, and persists the exact operation in the existing SQLCipher membership journal before network delivery.
- The operation is submitted only through the existing `POST /mls/groups/:roomId/commits` path. Success requires server ACK, local Commit merge, and post-sync agreement that the target is absent from both server and MLS membership.
- Added the Rust session API and Dart bridge contract/adapter entrypoints. Generated Flutter Rust Bridge bindings are produced by the repository's pinned generation workflow and are not hand-edited.
- No server-only member deletion route, plaintext fallback, or direct local MLS state mutation is used.


- Room member details now expose removal only to the owner or a member with `remove_members` (non-admin targets only); the owner and current account are excluded from the action. The UI delegates to the native MLS operation and does not call the server's direct member DELETE route.


## MLS approval of a pending room join request

- `POST /rooms/:roomId/requests/:userId/approve` is intentionally fail-closed and returns `409 mls_approval_required`; it must not mutate room membership directly.
- The supported approval transport is the canonical `POST /mls/groups/:roomId/commits` request with a verified Add Commit, per-device `welcomes`, `keyPackageClaimId` equal to `clientOperationId`, and `joinRequestUserId` equal to the single user in `changes.adds`.
- The server validates that the request is still pending and that the target passes the room organization gate. The SQL store locks the pending request row and deletes it in the same transaction that records the MLS commit, advances the epoch, adds the member, stores every device Welcome, commits the KeyPackage claim and writes the idempotency receipt.
- Exact operation replay returns the stored epoch receipt; reuse of the operation ID with a different request is rejected. The request is not consumed on epoch mismatch, claim mismatch, or transaction rollback.
- The client must not display approval as complete until the durable membership journal receives the server ACK, the local OpenMLS Commit merges, and post-sync confirms the room state. The current Dart moderation UI remains rejection-only until the native approval operation and its FRB bridge are implemented and validated.


## Native MLS approval of a room join request

- The Flutter moderation action calls `approveMlsJoinRequest`; it does not call the legacy HTTP approval endpoint.
- Rust persists the operation type (`is_join_request`) in SQLCipher before claiming KeyPackages. This flag survives process restart and is replayed when `sync()` resumes a `claim_pending` intent.
- The native client uses the existing per-device KeyPackage claim and OpenMLS `add_members` path, creates a Welcome for every claimed device, and includes `joinRequestUserId` in the durable membership commit payload.
- The server checks the pending request and organization gate only after checking the exact-operation receipt. This ordering is required: after a successful commit the request row is consumed, but an exact retry must still return the accepted receipt.
- PostgreSQL locks and consumes the request atomically with room membership, epoch, Welcome, KeyPackage claim and idempotency receipt. The old direct-approval endpoint remains fail-closed.
- The UI reports success only after native membership commit ACK, local merge and room sync complete. A missing KeyPackage or network failure leaves the request pending and the durable intent retryable.
