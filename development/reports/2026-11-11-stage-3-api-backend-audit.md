# Stage 3 — API / Backend audit (initial source audit)

**Дата:** 2026-11-11  
**База аудита:** `main` = `ce2018bffd3faf8a1c30aed65ee6191675ee38ad`  
**Ветка отчёта:** `audit/stage-3-api-backend-2026-11-11`  
**Статус:** initial source audit; runtime/API integration tests not run in this pass.

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

## 6. Acceptance criteria (not yet passed)

- [ ] Every Beta 1 screen has a canonical API mapping or an explicit “client-only / blocked / future” reason.
- [ ] Every mapped route is tied to a source handler and request/response/error contract.
- [ ] No UI action can invoke an arbitrary route or bypass the bridge allowlist.
- [ ] No token, refresh token, MLS secret or plaintext message is exposed to WebView or logs.
- [ ] CH-02 history and MLS message lifecycle are tested against PostgreSQL-backed backend.
- [ ] Authorization matrix tests cover applicant, member, admin and platform owner.
- [ ] Flutter unit/widget tests, analyze, Android/iOS builds and device runtime tests pass.

**Conclusion:** Stage 3 is in progress. This report is a source-level audit snapshot, not acceptance evidence. No product code, API contract or backend behavior was changed by this audit.


## 7. Additional Stage 3 security blocker review (2026-11-11)

A second source pass identified two concurrency items that must remain open:

- **F-01 stale accept/revoke:** current org-link handler reads a proposed link, checks the status, and then updates the status in a separate call. The current sequential `org-links.test.js` does not cover a stale-read interleaving. The previously reviewed conditional-transition patch and regression test are not present in main.
- **F-02 open-join race:** the previously prepared atomic PostgreSQL/locking change and deterministic barrier regression are not present in main. Memory-only test results do not close the PostgreSQL concurrency requirement.

PR #42 was inspected: it adds only `.github/workflows/f01-f02-postgres.yml`; it does not contain either source patch or its regression test. Therefore the new PostgreSQL workflow is not acceptance evidence for F-01/F-02.

**Required handoff:** obtain the exact original agent patch and changed-file list, preserve its working-tree changes, compare against current main, review, then run the PostgreSQL concurrency test. Do not reconstruct or overwrite the missing patch from memory.

Stage 3 authorization/security acceptance is **blocked** until F-01 and F-02 source changes and PostgreSQL test evidence are present.


## 8. Delivery status after contract/test pass (2026-11-11)

- Canonical contract matrix: `mobile/API-CONTRACTS-BETA-1.md`.
- Approval manifest: 24 screens / 25 unique API operations; source preflight matched all 25 to backend route evidence.
- Legacy Flutter handoff catalog: chat, rooms, organization and profile routes cross-checked; CH-02 history, MLS send, commit, Welcome ACK and sync/read ACK paths documented.
- Regression guard: `engine/test/api-contract.test.js`, included in default `npm test`.
- Existing authorization evidence reviewed: `security-matrix.test.js`, `org-isolation-matrix.test.js`, `room-permissions.test.js`, `sessions.test.js`, `recovery.test.js`, `org-requests.test.js`, `org-links.test.js`.
- Draft PR #44: https://github.com/vahe210991-cloud/InOne-chat/pull/44.
- Latest PR head at this update: `f67bf068622947b0484999487582cdba60bb79fa`.
- Latest GitHub Actions run set for this head: backend Node, PostgreSQL integration, OpenMLS, Rust bridge, Rust format, P0 room-list regression and Flutter validation. Rust format and P0 room-list regression passed; backend/DB/OpenMLS/Rust bridge/Flutter jobs were still running when this report was updated.

**Acceptance remains blocked** by F-01/F-02 source patches not present in the repository/PR #42. Do not mark Stage 3 accepted until the exact original patch is handed off, reviewed and passes PostgreSQL concurrency tests. PR #44 remains Draft and unmerged.
