# P2 — Push and Profile: initial audit

**Date:** 2026-11-20  
**Task branch:** `audit/p2-push-profile-2026-11-20`  
**Base:** `main` at `974f944d251870ca57fad5124f058b9d65d12a26`  
**Scope:** Beta 1.0 only. Audit and implementation planning; no product code or API contract changed.

## 1. Executive result

P2 can proceed as a separate workstream. Source review confirms that the canonical backend already has a device-scoped push-token lifecycle, while the Flutter app does not yet have a production push-token acquisition/registration path. Profile retrieval and locale synchronization exist; general profile editing is not represented by the current backend contract.

No test/build command was executed in this audit. Source presence and existing test code are not acceptance evidence.

## 2. Push findings

### Backend source present

Canonical backend: `inone-development-archive-0.6.0/engine`.

- `PUT /devices/me/push` and `DELETE /devices/me/push` require the current authenticated device.
- Registration is gated by `push.enabled`.
- Accepted providers are `fcm` and `apns`; token syntax/length is validated (32–512 characters).
- One token is stored per device; a new token replaces the previous one.
- `GET /devices/mine` exposes only `pushRegistered`, not the raw token.
- Logout deletes the current device's push token.
- Device revocation deletes the device's push token.
- Invalid-token feedback from the injected sender deletes the rejected token.
- Notification payload is deliberately limited to `type` and an event path; message text and sender name are not sent.
- Delivery targets active devices belonging to current room members, excluding the sending device.

Relevant implementation:
- `engine/src/server.js` lines 518–529 and 1248–1264.
- `engine/src/store.js` push token persistence and active-device selection.
- `engine/src/store-memory.js` in-memory implementation.
- `engine/test/push.test.js` covers token validation/device state, recipient selection and payload minimization, revocation/logout, and provider-invalid-token cleanup.

### Mobile gaps

- `mobile/pubspec.yaml` does not currently declare a Firebase Messaging or equivalent native push-token plugin.
- `InOneRepositories` exposes device listing but no typed push register/unregister operations.
- The ST-01 screen accepts callbacks, but the source search found only gallery/test callback wiring (`_ok1` / `_ok0`); no production permission → token acquisition → authenticated registration path was found.
- The backend accepts an injected `pushSender`, but no production FCM/APNs sender is wired by the inspected `createServer` default. The feature flag and route alone do not provide delivery.

### Push acceptance still required

1. Select and pin the supported Flutter/native FCM and APNs integration.
2. Implement permission state, token acquisition/refresh, authenticated PUT, DELETE on opt-out, and retry-safe token refresh.
3. Connect ST-01 to real state from `GET /devices/mine` and real callbacks; no gallery placeholders in production navigation.
4. Wire a production sender through protected environment configuration; never commit provider credentials.
5. Verify token rotation, logout, revocation, invalid-token cleanup, opt-out and delivery privacy in Node/PostgreSQL and Android/iOS CI.
6. Keep the feature disabled where provider configuration is absent; do not report end-to-end delivery based only on a mock sender.

## 3. Profile findings

- Backend `GET /profile` returns account profile/security data and persisted locale.
- The only profile mutation route in the inspected contract/source is `PATCH /profile/locale`.
- Flutter `InOneProfile` strictly parses the current profile DTO.
- `InOneRepositories.profile()` reads the profile; locale changes are routed through `InOneSession.setLocale()`, which persists locally and synchronizes with the backend.
- No general profile update endpoint (nickname/name/avatar/phone) is documented in `mobile/API-CONTRACTS-BETA-1.md` or present in the inspected profile route block.
- The visual profile screen exposes an avatar callback and presentation fields, but those UI callbacks do not establish a backend write contract.

### Profile acceptance still required

1. Preserve GET profile and locale sync; add regression coverage for malformed DTOs, missing optional fields and locale synchronization/retry behavior.
2. Obtain an owner-approved editable-field list and security rules.
3. Only after the field list and backend contract are approved, implement matching server validation, persistence, typed mobile DTO/repository and UI flow.
4. Do not invent `PATCH /profile`, avatar upload, or phone mutation routes. Phone verification/recovery policy remains outside this P2 audit unless explicitly approved.

## 4. Exact source snapshot

Branch was created from `main` at `974f944d251870ca57fad5124f058b9d65d12a26`.

Reviewed source paths:
- `inone-development-archive-0.6.0/engine/src/server.js` — blob `5472b659c3c605449d66dd00042ff3d1cce97f05`
- `inone-development-archive-0.6.0/engine/src/store.js` — blob `3781a2e1d8fe72f0c6ecbea036f39399b280fe73`
- `inone-development-archive-0.6.0/engine/src/store-memory.js` — blob `e6506a6ea7e5075651b40dcd090b4771f39e71c0`
- `inone-development-archive-0.6.0/engine/test/push.test.js` — blob `f40b849fdc13afe9e541e23e58038c89e67102ec`
- `mobile/lib/core/data/inone_profile.dart` — blob `aee1d10d0ae70d53b942c5581c996c74d8e55be0`
- `mobile/lib/core/data/inone_repositories.dart` — blob `20d806dafc33a31572122c8c7b6a46fbdee4d9e1`
- `mobile/lib/core/session/inone_session.dart` — blob `65c086b0e309c3611a64d70cf26b41a5e21fa1c7`
- `mobile/lib/ui_dart_source/screens/settings/st01_notifications_settings_screen.dart` — blob `cf9a8e0133d21cf61283401092e405ce40da88e8`
- `mobile/pubspec.yaml` — blob `fed95ffcbf451c3b04c7098dc693f37d486ab73d`
- `mobile/API-CONTRACTS-BETA-1.md` — blob `9536ed605b2c6043808043d52c33bf3843717e24`

## 5. Acceptance matrix

| Criterion | Status | Evidence / next action |
|---|---|---|
| Backend push register/unregister routes | PASS — source review only | `server.js` route block; tests exist, not executed here |
| Backend token lifecycle and privacy | PASS — source review only | Store cleanup and minimal payload; runtime tests not executed here |
| Production FCM/APNs sender | BLOCKED | Sender is injected; no production provider wiring verified |
| Flutter token acquisition/permission | BLOCKED | No push plugin or production acquisition flow found |
| Flutter typed register/unregister | BLOCKED | Repository methods absent |
| ST-01 production wiring | BLOCKED | No production callback path found |
| Profile read DTO/repository | PASS — source review only | Existing typed implementation |
| Locale update/synchronization | PASS — source review only | Existing PATCH route/session flow; tests not executed here |
| General profile editing | BLOCKED | No approved fields or backend write contract |
| CI / Android / iOS runtime | NOT RUN | No source changes in this audit |

## 6. WBS mapping

- Backend/API and data (25%): push backend source exists; production sender and profile-edit contract remain unaccepted.
- Frontend Flutter (25%): ST-01 UI shell exists; native push integration and production wiring remain incomplete.
- API ↔ UI integration (15%): typed push repository/permission lifecycle missing; profile read/locale path exists, general edits do not.
- QA/CI and DevOps: no new checks were run; provider configuration and exact-SHA platform tests remain required.

Approved WBS v1.1 weights and historical percentages are unchanged. No readiness percentage is raised by this source audit.

## 7. Five previous / five next tasks

Previous:
1. A1 engine ownership decision — reused; not repeated.
2. P1 validation workflow coverage PR #101 — merged.
3. P1 resilience regression PR #99 — merged.
4. A2 deterministic FRB contract PR #102 — merged as `df20bef8df05b3ab2e11b20cb91e8f2bca60eec0`.
5. Push/profile source inventory — completed as this audit only; implementation not accepted.

Next:
1. Confirm owner-approved profile fields and whether Beta 1.0 includes nickname/avatar editing.
2. Select the FCM/APNs Flutter integration and record required non-secret platform configuration.
3. Implement typed push token registration, refresh and removal in Flutter.
4. Connect ST-01 to real permission/token/device state and remove placeholder callbacks from production flow.
5. Wire a protected production push sender and run exact-SHA Node, PostgreSQL, Flutter, Android and iOS checks.

## 8. Open questions / blockers

- Owner decision required: which profile fields are editable in Beta 1.0 (nickname, avatar, phone, or another explicit subset)?
- Provider setup required outside Git: Firebase project/app configuration and APNs credentials must be provisioned through the approved protected configuration path. Do not paste secrets into chat or commit them.
- Tests are NOT RUN in this audit. No implementation or release acceptance is claimed.

**Current status:** P2 audit started; push mobile/provider integration BLOCKED; general profile editing BLOCKED pending approved scope. No product source changed, no tests rerun, no merge performed.
