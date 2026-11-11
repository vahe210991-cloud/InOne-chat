# Stage 3 — API / Backend audit and acceptance report

**Дата:** 2026-11-11  
**База аудита:** `main` = `ce2018bffd3faf8a1c30aed65ee6191675ee38ad`  
**Ветка отчёта:** `feature/stage-3-api-contracts-2026-11-11`  
**Статус:** implementation completed; source review and CI validation completed on PR head `3d288777135d0c12145f18407e8768a02ae80a9f`. PR remains Draft and unmerged.

## 1. Scope and evidence

Reviewed:
- `mobile/assets/ui-approval/screen-manifest.json` — 24 screens from the newer handoff set;
- `mobile/lib/claude_screen_catalog.dart` — 7 owner-approved v1 screens (31 screen IDs total across both sets);
- `mobile/lib/claude_ui_bridge.dart` and `mobile/lib/main.dart` — bridge parsing, API allowlist, dispatch and file-picker behavior;
- `mobile/lib/core/test_api/screen_api_catalog.dart`, `mobile/lib/core/data/inone_repositories.dart`, `mobile/lib/core/session/inone_session.dart`;
- `inone-development-archive-0.6.0/engine/src/server.js` and `src/main.js` — actual route handlers and server bootstrap.

Backend source in the current repository is under the explicitly versioned `inone-development-archive-0.6.0/engine/` path. `src/main.js` wires a PostgreSQL pool/store for normal server startup; memory storage is the fallback for tests/development. This audit does not establish that a production deployment is configured or operational.

## 2. Main findings

1. Flutter WebView is already present in `mobile/lib/main.dart`, with local asset loading and `InOneBridge` JavaScript channel.
2. The bridge accepts `navigate`, `api`, and `pick` messages. API calls are restricted to an explicit allowlist of 10 calls. HTML does not receive session tokens and does not make direct HTTP requests.
3. The newer UI handoff declares 24 screens; the owner-approved v1 set adds 7 more, for 31 screen IDs in the handoff catalog.
4. Only a subset of screen operations is currently dispatched by the Flutter bridge. Unsupported calls display an “API route not connected” state. Native file picking is explicitly unavailable.
5. The mobile API document is stale/incomplete for chat history: `GET /rooms/:id/events` exists in backend source (server.js lines 2615–2624), while the document says it is absent. `POST /rooms/:id/events` is present but deliberately returns HTTP 409 and directs message sending to `/mls/groups/:id/messages` (lines 2594–2605). The UI contract must be updated to reflect MLS send/receive semantics; do not enable plaintext/event POST as a workaround.
6. Several write routes exist in backend source but are not in the WebView bridge allowlist. Presence of a backend handler does not mean the corresponding screen action is implemented or safe to invoke.
7. The server source contains both PostgreSQL-backed startup wiring and in-memory test support. No server, PostgreSQL, Flutter, Android or iOS runtime tests were executed during this read-only audit.

## 3. Screen → API → backend handler → status → missing work

Status meanings:
- **Backend confirmed** — matching route handler found in current server source.
- **Backend confirmed / bridge missing** — handler exists but is not in the WebView bridge allowlist/dispatch.
- **Special protocol** — generic room event write is intentionally rejected; use MLS routes.
- **No API** — screen is client-side/shared presentation.
- **Contract review** — route exists, but exact payload/response, permissions or UI mapping still needs contract-level verification.

| Screen | Declared operation(s) | Backend evidence | Current status | Missing work |
|---|---|---|---|---|
| SC-01 | POST /login | server.js:1498+ | Backend + bridge confirmed | Verify payload/response and error-state mapping end-to-end |
| SC-02 | POST /register/email | server.js:882+ | Backend + bridge confirmed | Verify registration-mode behavior and response |
| SC-03 | POST /register/email/confirm | server.js:901+ | Backend + bridge confirmed | Verify code errors, expiry and registrationToken handling |
| SC-04 | POST /register | server.js:922+ | Backend + bridge confirmed | Confirm phone-required policy and immediate-login behavior against owner decision |
| SC-05 | POST /auth/nonce; POST /auth/provider/verify | server.js:616+, 624+ | Backend confirmed / bridge missing | Add typed provider-auth flow only after provider proof contract and platform callbacks are verified |
| SC-06 | POST /register/provider | server.js:646+ | Backend confirmed / bridge missing | Define typed registration-provider flow and response |
| SC-07 | POST /recovery/start | server.js:2628+ | Backend confirmed / bridge missing | Wire recovery flow; verify privacy-preserving response and 429 retryAt |
| SC-08 | POST /recovery/confirm | server.js:2690+ | Backend confirmed / bridge missing | Verify confirmation token/form contract |
| SC-09 | POST /recovery/complete | server.js:2753+ | Backend confirmed / bridge missing | Verify reset payload and D8 warning text |
| SC-10 | POST /recovery/cancel-by-code; POST /admission/cancel | server.js:2712+, 1095+ | Backend confirmed / bridge missing | Decide authenticated/unauthenticated path and error mapping |
| SC-11 | POST /login; POST /approvals/:id/claim | server.js:1498+, 1620+ | Backend confirmed / bridge partial | Implement polling/claim lifecycle; verify activateAt, id and pollSecret contract |
| SC-12 | POST /logout | server.js:1130+ | Backend + bridge confirmed | Verify session clearing and navigation |
| SC-00 | Client-side menu | — | No API | Gate admin menu by verified platform role; current manifest marks this as unresolved |
| RQ-01 | POST /org-requests | server.js:1231+ | Backend confirmed / bridge missing | Add typed create operation and result state |
| RQ-02 | POST /org-requests/:id/documents | server.js:1258+ | Backend confirmed / bridge missing | Add native file picker, upload contract, size/type validation and progress |
| RQ-03 | GET /org-requests | server.js:1240+ | Backend + bridge confirmed | Verify applicant/admin visibility states |
| RQ-04 | GET /org-requests/:id; GET /org-requests/:id/documents/:docId | server.js:1246+, 1277+ | Backend confirmed / bridge partial | Add typed document download and ownership/role UI states |
| PS-01 | GET /org-requests | server.js:1240+ | Backend + bridge confirmed | Enforce staff-only navigation in UI; backend remains authoritative |
| PS-02 | GET /org-requests/:id; GET document | server.js:1246+, 1277+ | Backend confirmed / bridge partial | Add document retrieval and audit-view handling |
| PS-03 | POST /org-requests/:id/decision | server.js:1295+ | Backend confirmed / bridge missing | Add owner-only decision flow; handle 403 not_platform_owner and 409 |
| SR-01 | GET /users/search?nickname=… | server.js:976+ | Backend confirmed / bridge missing | Verify query privacy, result fields and personal-chat creation contract |
| ST-01 | PUT/DELETE /devices/me/push | server.js:1196+ | Backend confirmed / bridge missing | Wire platform push permission/token registration; honor push.enabled flag |
| ST-02 | GET /config/public; GET /config | server.js:1210+, 1222+ | Backend + bridge confirmed | Verify which fields are safe for each screen/theme state |
| ST-03 | Shared presentation/state layer | — | No API | Keep common-state behavior in host; no standalone API call |
| CH-01 | GET /rooms/mine | server.js:2038+ | Backend + bridge confirmed | Map room list response to screen model; connect selection/navigation |
| CH-02 | GET /rooms/:id/events; send via MLS | server.js:2615+; MLS send handler at 2273+ | Backend confirmed; bridge missing; special protocol | Add typed history/sync + MLS send/receive/ACK flow; never use POST /rooms/:id/events for sending |
| GR-01 | GET /rooms/mine | server.js:2038+ | Backend + bridge confirmed | Connect group list and navigation |
| GR-02 | POST /rooms | server.js:1823+ | Backend confirmed / bridge missing | Define create-room payload, validation, membership/org prerequisites |
| GR-04 | Room details/settings operations | server.js has room/member/settings handlers (e.g. 1890+, 1999+) | Contract review / bridge missing | Inspect exact v1 HTML actions and bind each to GET/POST contract; verify owner/admin permissions |
| OR-01 | GET /orgs/mine | server.js:1493+ | Backend + bridge confirmed | Bind response to organization selector and navigation |
| PR-01 | GET /profile | server.js:992+ | Backend + repository confirmed | Complete profile field mapping and edit operations separately |

## 4. Flutter integration state

- `ClaudeBridgeMessage.tryParse` parses the three event types and validates the basic JSON shape.
- `claudeSupportedApiCalls` currently allowlists: login, register/email, register/email/confirm, register, logout, orgs/mine, org-requests, config, config/public, rooms/mine.
- The host dispatches those calls; all other API calls render “Этот API-маршрут пока не подключён”.
- `pick` currently renders “Выбор файла пока не подключён”.
- `InOneSession` keeps access/refresh tokens in memory and stores a stable device identifier via Flutter Secure Storage. The source comments explicitly state that refresh-token ownership must move to the native MLS session later.
- `screen_api_catalog.dart` provides GET probes for the development gallery; it is not a complete implementation of the approved screen workflows.

## 5. Priorities for Stage 3

1. **P0 — Contract reconciliation:** create one canonical API contract for all 31 screen IDs, with method, path, auth, request, response, errors, permissions and side effects.
2. **P0 — CH-02:** document GET history and MLS message send/receive/ACK lifecycle; update stale mobile docs; keep legacy event POST blocked.
3. **P1 — Auth and recovery:** provider auth, recovery, approval/claim, logout edge cases and session ownership boundaries.
4. **P1 — Organization requests:** document upload/download and platform-owner decisions; native file picker is a dependency.
5. **P1 — Rooms and organizations:** create/configure room, membership, invitations, roles, organization settings and admin actions.
6. **P2 — Push and profile:** push token lifecycle, profile fields and edits.
7. Add contract tests that assert every screen-declared operation maps to a real handler and every bridge-allowed operation maps to a documented contract. Add authorization tests for owner/admin/member/applicant boundaries.

## 6. Stage 3 acceptance criteria and evidence

- [x] Canonical mapping for the 24-screen approval manifest and the legacy v1 handoff catalog (7 additional screens; 31 screen IDs total).
- [x] 25 unique API operations declared by the approval manifest have corresponding backend route evidence; the automated source-contract regression test is included in the default Node suite.
- [x] CH-02 contract reconciled: room history uses `GET /rooms/:id/events`; message sending uses the MLS route `POST /mls/groups/:id/messages`; legacy `POST /rooms/:id/events` remains deliberately rejected with HTTP 409.
- [x] WebView bridge route allowlist boundary is guarded by the contract regression test; the WebView does not receive access/refresh tokens or MLS key material.
- [x] Existing authorization/session/recovery/room-permission/organization isolation suites run as part of backend and PostgreSQL validation.
- [x] F-01 compare-and-set transition and stale-read regression are present. PostgreSQL-backed test confirms stale accept after revoke returns 409 and emits no `link_accept` audit event.
- [x] F-02 open-join transaction locks the room, revalidates organization membership/active cross-organization link inside the transaction, checks capacity and inserts membership atomically. Organization-member revocation takes a conflicting row lock and removes room membership in the same transaction.
- [x] PostgreSQL-backed F-02 tests confirm simultaneous joins respect capacity and that revocation serializes against an in-flight open join without leaving a stale room membership.
- [x] Full CI for the exact PR head completed successfully (details below).

## 7. F-01 / F-02 implementation review

### F-01 — stale organization-link accept/revoke

The handler still reads a link snapshot for authorization and side checks, but state mutation is no longer a blind write. Both accept and revoke use `transitionOrgLinkStatus`, implemented as a conditional SQL update:

```sql
UPDATE org_links
SET status = ..., decided_by = ..., decided_at = ...
WHERE link_id = ... AND status = ...
```

Only one concurrent transition can win. A stale accept receives HTTP 409 and exits before either `link_accept` audit event is written. The regression deliberately pauses accept after its stale read, performs revoke, then releases accept and verifies the final state and both audit journals.

### F-02 — public open-join concurrency

`joinPublicRoomOpen` executes in one PostgreSQL transaction. It locks the room row with `FOR UPDATE`, rechecks visibility/join policy and organization approval, checks direct organization membership or an active cross-organization link under `FOR SHARE`, checks capacity, serializes the event sequence and inserts the member before commit.

Organization-member removal uses a transaction and locks the same `org_members` row with `FOR UPDATE` before deleting room membership and the organization membership. Thus:
- if join obtains its authorization share lock first, revocation waits, then removes the newly inserted room membership;
- if revocation obtains its update lock first, the later join sees no organization membership and is rejected;
- concurrent open joins serialize on the room row, so capacity cannot be exceeded by two simultaneous requests.

The PostgreSQL regression detects the join's held authorization lock using a conflicting `FOR UPDATE NOWAIT`, then runs the revocation concurrently and verifies that the final room has no membership for the revoked user.

## 8. CI evidence — exact PR head

**Repository:** `vahe210991-cloud/InOne-chat`  
**PR:** [#44](https://github.com/vahe210991-cloud/InOne-chat/pull/44)  
**Branch:** `feature/stage-3-api-contracts-2026-11-11`  
**Head:** `3d288777135d0c12145f18407e8768a02ae80a9f`  
**Base:** `main` at `ce2018bffd3faf8a1c30aed65ee6191675ee38ad`

### Backend / Rust / PostgreSQL workflow

Run [42967427669](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42967427669) — **success**.

- Backend Node suite: **382 passed, 0 failed**.
- PostgreSQL 16 integration suite: **124 passed, 0 failed**.
- PostgreSQL log explicitly records:
  - `F-01: stale accept after a concurrent revoke is rejected without an accept audit event` — passed;
  - `F-02: simultaneous open joins serialize capacity and organization authorization` — passed;
  - `F-02: open join revalidates organization membership after the route preflight` — passed;
  - `F-02 PostgreSQL: revocation waits for an in-flight open join and removes its room membership` — passed.
- OpenMLS client target check and tests — passed.
- Rust bridge target check and tests — passed.
- Rust format — passed.
- P0 room-list regression — passed.

### Flutter workflow

Run [42967427728](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42967427728) — **success**.

- Flutter dependency resolution — passed.
- `flutter analyze` — passed.
- `flutter test` — passed.
- Android preview APK build — passed.
- Artifact upload — passed.

## 9. Scope boundaries and remaining work

Stage 3 API/backend contract and concurrency acceptance is complete on the PR branch. This is not a claim of production deployment readiness.

Still separate:
- **Stage 4:** native MLS FFI, platform key storage, encrypted local persistence, offline/restart and recovery validation.
- **Stage 2:** complete typed Flutter ↔ WebView bridge workflows, file picking and API action wiring beyond the currently supported allowlist.
- **Stage 1:** physical Android/iOS device visual acceptance, keyboard/safe-area/navigation and end-to-end UI regression.

The Flutter CI result proves analysis, tests and Android preview APK build; it does not prove physical-device acceptance or an iOS archive build.

PR #44 remains **Draft and unmerged**. The tested changes are on the PR branch; `main` was not modified by this work. Merge is not performed as part of this audit.
