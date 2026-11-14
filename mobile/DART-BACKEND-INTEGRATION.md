# Dart UI → backend integration map (Beta 1.0)

**Branch:** `feat/flutter-ui-dart-migration-2026-11-14`  
**Date:** 2026-11-14  
**Status:** Native Flutter migration started; only verified, safe Beta 1.0 flows are active. This is not a claim that every screen is production-complete.

## 1. Runtime change

- `mobile/lib/main.dart` starts `InOneMobileApp`.
- `mobile/lib/app/inone_mobile_app.dart` is the native Flutter application shell.
- The 45-file Dart source package is under `mobile/lib/ui_dart_source/`.
- The old HTML/WebView host is no longer the application entry point.
- The 22 owner-approved root HTML reference screens were moved, without content changes, to `мусорный ящик/HTML-эталоны/`.
- All 219 files from the former `mobile/assets/` HTML gallery/approval bundles, including HTML, JS, CSS, fonts and reference screenshots, were moved to `мусорный ящик/HTML-архив/mobile-assets/`.
- The old WebView host, JS bridge, HTML screen catalogs, HTML-only tests and import scripts were moved to `мусорный ящик/Legacy-WebView-host/`.
- There are no HTML assets or WebView source files under the active `mobile/` runtime. A CI guard checks this invariant.

## 2. Backend source of truth

- `inone-development-archive-0.6.0/engine/src/server.js` — route handlers and request/response behavior.
- `mobile/API-CONTRACTS-BETA-1.md` — existing screen-to-contract matrix and security constraints.
- `development/integrations/FLUTTER-SCREEN-HANDOFF-FOR-CLAUDE.md` — Beta 1.0 boundary and integration requirements.

The backend is not modified by this migration. Do not infer routes from screen labels or mockup metadata. If a route, body, response or permission is not verified in server source, the operation stays blocked.

## 3. Screen-by-screen status

### Authentication

| Dart screen | Backend contract | Status | Notes |
|---|---|---|---|
| `sc01_login_screen.dart` | `POST /login` | **Connected** | Email/password via `InOneSession`; active session required before navigation. Google/Apple remain blocked until native provider SDK + nonce/verify flow are implemented. |
| `sc02_register_email_screen.dart` | `POST /register/email` | **Connected** | Email code request. |
| `sc03_email_code_screen.dart` | `POST /register/email/confirm` | **Connected** | Retains returned `registrationToken` in memory for the next step. |
| `sc04_create_account_screen.dart` | `POST /register` | **Connected** | Uses verified email token, nickname, password and required phone. Registration does not issue a session; user signs in afterwards. |
| `sc06_provider_nickname_screen.dart` | `POST /register/provider` | **Blocked** | Provider ticket acquisition/verification and native provider callback are not connected. |
| `sc07_recovery_start_screen.dart` | `POST /recovery/start` | **Blocked in navigation** | Route exists. Recovery must be integrated with link/deep-link confirmation and the required owner-approved key-reset warning. |
| `sc08_recovery_confirm_screen.dart` | `POST /recovery/confirm` | **Blocked** | Requires verified deep-link handling for `user` and `token`. |
| `sc09_new_password_screen.dart` | `POST /recovery/complete` | **Blocked in navigation** | Route exists; recovery confirmation, PIN conditions and owner-approved key-reset warning must be completed first. |
| `sc10_not_you_screen.dart` | `POST /recovery/cancel-by-code` or `POST /admission/cancel` | **Contracted, UI not active** | Different flows; route depends on whether recovery or new-device admission is being cancelled. |
| `sc11_login_waiting_screen.dart` | `POST /login`, `GET /approvals`, `POST /approvals/:id/claim` | **Blocked** | Device approval UI, pollSecret lifecycle and state machine are not wired. No password is retained in app state for polling. |
| `sc12_logout_screen.dart` | `POST /logout` | **Connected** | Clears in-memory session state even when logout request fails. |

### Main application screens

| Dart screen | Backend contract | Status | Notes |
|---|---|---|---|
| `inone_messages_screen.dart` | `GET /rooms/mine` | **Connected for room list** | Real room IDs, names and kinds are mapped. No last-message preview, timestamp or unread count is fabricated. |
| `inone_chat_thread_screen.dart` | `GET /rooms/:id/events`, MLS commits/welcomes/sync, `POST /mls/groups/:id/messages` | **Blocked pending production native MLS** | The Rust `mls-bridge` is an in-memory POC with no Dart/FRB bridge or platform persistence; its own bridge report records an open plaintext-send defect. `mls-client` has SQLCipher storage but no Flutter bridge or production Keychain/Keystore `KeyStore` adapter. Mobile Android/iOS builds were not run. Neither crate is safe to expose to this screen yet. No plaintext fallback or direct event POST. |
| `inone_profile_screen.dart` | `GET /profile` | **Connected read-only** | Name, email/handle and verification level are mapped. Task/activity/project counts show `—`; endpoint does not supply them. Profile editing is blocked; no verified update endpoint. |
| `inone_org_profile_screen.dart` | `GET /orgs/mine` | **Connected, limited to verified fields** | Displays actual organization name, role and status. Members/projects/teams/about/cover remain unknown (`—`/empty); editing is disabled. |
| `inone_workspace_screen.dart` | `GET /orgs/mine` | **Connected, limited to verified fields** | Workspace name comes from the selected membership; unavailable metrics remain `—`, and activity is omitted because no matching feed endpoint exists. |
| `inone_notifications_screen.dart` | `GET /sync` is a delivery/signal queue, not a generic notification feed | **Blocked** | Requires typed event-to-notification mapping and correct ACK semantics. |
| `inone_empty_states_screen.dart` | Client-only | **UI component** | Use only with state derived from real repository results. |
| `inone_loading_error_screen.dart` | Client-only | **Connected UI state** | Used for real repository loading failures. |
| `inone_leads_screen.dart` | No Beta 1.0 CRM API verified | **Beta 2.0 placeholder** | Not in Beta 1.0 navigation. |
| `inone_deals_board_screen.dart` | No Beta 1.0 CRM API verified | **Beta 2.0 placeholder** | Not in Beta 1.0 navigation. |
| `inone_deal_detail_screen.dart` | No Beta 1.0 CRM API verified | **Beta 2.0 placeholder** | Not in Beta 1.0 navigation. |

### Organization requests and administration

| Dart screen | Backend contract | Status | Notes |
|---|---|---|---|
| `rq01_new_request_screen.dart` | `POST /org-requests` | **Backend verified; scope gate** | Name length 2–120 characters. |
| `rq02_request_documents_screen.dart` | `POST /org-requests/:id/documents`, `GET .../documents/:docId` | **Backend verified; adapter missing** | Upload needs file selection, Base64 body, 5 MiB limit and storage configuration; download is binary, not JSON. |
| `rq03_my_requests_screen.dart` | `GET /org-requests` | **Backend verified; scope gate** | Response is role-aware (applicant's own requests vs platform staff queue). |
| `rq04_request_details_screen.dart` | `GET /org-requests/:id` and binary document GET | **Backend verified; adapter missing** | Preserve applicant/platform-staff access checks and audit behavior. |
| `ps01_requests_admin_screen.dart` | `GET /org-requests` | **Backend verified; scope gate** | Platform staff presentation and navigation authorization are not wired. |
| `ps02_request_admin_details_screen.dart` | `GET /org-requests/:id` and binary document GET | **Backend verified; adapter missing** | Platform viewing is read-only and audited by the server. |
| `ps03_request_decision_screen.dart` | `POST /org-requests/:id/decision` | **Backend verified; scope gate** | Server requires platform-owner role; admin receives 403 `not_platform_owner`. |

**Owner scope gate:** `FLUTTER-SCREEN-HANDOFF-FOR-CLAUDE.md` limits Beta 1.0 to auth, rooms/chats, organizations where verified, profile and basic settings. `API-CONTRACTS-BETA-1.md` additionally lists RQ/PS screens. This discrepancy is not silently resolved by adding RQ/PS to navigation. They remain outside active navigation until the owner resolves the scope.

### Settings

| Dart screen | Backend contract | Status | Notes |
|---|---|---|---|
| `st01_notifications_settings_screen.dart` | `PUT/DELETE /devices/me/push` | **Backend verified; native integration missing** | Requires real APNs/FCM token lifecycle, platform permission and feature-flag handling. |
| `st02_system_status_screen.dart` | `GET /config/public` | **Connected** | Reads only public `maintenance.enabled` and `app.minVersion` flags; does not request private configuration. |
| `st03_banners_states_screen.dart` | Client/shared state | **UI component** | Must not simulate real server outage or maintenance state. |

### Shared source files and demo code

| Files | Status |
|---|---|
| `inone.dart`, `models/inone_models.dart`, `state/inone_state.dart`, `theme/*`, `widgets/*` | Shared Flutter presentation layer. No direct HTTP. Models are UI models, not wire DTOs. |
| `mobile/example/ui_dart_source/inone_gallery.dart`, `inone_demo_data.dart` | Demo/gallery only, outside `lib/`. Must not be imported by production app or used as fallback data. |

## 4. Currently active real API flows

1. Email/password login — `POST /login`.
2. Email registration start — `POST /register/email`.
3. Email registration confirmation — `POST /register/email/confirm`.
4. Account creation — `POST /register`.
5. Read current profile — `GET /profile`.
6. Read current user's rooms — `GET /rooms/mine`.
7. Read current user's organization memberships — `GET /orgs/mine`.
8. Read public system configuration — `GET /config/public`.
9. Logout — `POST /logout`.

Requests use the existing `InOneSession` / `ApiClient` / `InOneRepositories` boundary. Organization memberships are parsed into a typed DTO. Access and refresh tokens remain in memory; only the stable device ID is stored using platform secure storage.

## 5. Security and release gates

- No backend routes or contracts were changed.
- Stable IDs remain opaque strings; internal room IDs are not used as fallback display labels.
- No sample message text, unread count, timestamps, task counts, project counts or organization statistics are fabricated.
- MLS history/send remains fail-closed until a production Flutter/Rust bridge, platform Keychain/Keystore key provider, SQLCipher persistence, server session/token ownership, background sync and Android/iOS device tests are complete. The current in-memory `mls-bridge` POC is explicitly not production-safe. Never use `POST /rooms/:id/events` as fallback.
- Do not ACK delivery/signal streams before durable local persistence.
- RQ/PS Beta 1.0 scope discrepancy remains open.
- Native provider login, recovery deep links, file picker/download, push token registration and localization selection remain separate integration tasks.
- No Flutter analyze/test result is claimed until CI or a local Flutter toolchain runs on this exact branch head.

## 6. Next implementation order

1. Archive/remove the old HTML/WebView runtime and add regression checks proving it is unreachable.
2. Resolve the RQ/PS Beta 1.0 scope decision.
3. Complete typed organization-request repositories and native file upload/download adapters if in scope.
4. Implement deep links and full recovery/device-approval state machines.
5. Integrate the native MLS bridge and encrypted local persistence before activating chat history/send.
6. Add widget/repository tests and Android/iOS CI validation for each enabled screen.
