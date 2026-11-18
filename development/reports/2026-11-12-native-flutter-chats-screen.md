# Beta 1.0 — native Flutter Chats screen and rooms API integration

**Date:** 2026-11-12  
**Task branch:** `feature/beta1-native-chats-screen-2026-11-12`  
**Base branch:** `feature/beta1-screen-api-integration-2026-11-12`  
**Base SHA:** `415dbf980b496c38f89d68c441fa8f45fb1560e9`  
**Implementation HEAD:** `76efbd1361e29ac2890bcb967c604c3149700451`  
**Scope:** Beta 1.0 · CH-01 · WBS Frontend Flutter and approved UI; API ↔ UI integration  
**Execution owner:** ChatGPT, sole executor

## Result

A native Flutter implementation of CH-01 was added in `mobile/lib/chats_screen.dart`. The app now starts on this native Chats screen, and selecting the existing stable handoff screen ID `CH-01` routes to the same Flutter implementation rather than loading its legacy HTML handoff.

The screen uses the existing typed `InOneRepositories.myRooms()` repository and the verified authenticated backend route `GET /rooms/mine`. It consumes the validated `InOneRoomList` / `InOneRoom` response; the existing backend route remains the source of room membership and role data. No new backend endpoint was invented and no backend deployment was performed.

Implemented UI:
- InOne light visual system with lime accent, chat list, room-kind icons, folder filters and five bottom-navigation entries: Статусы, Звонки, Каналы, Сообщения, Профиль.
- Pull-to-refresh, loading, empty, unauthenticated, unauthorized and generic error states.
- Full-screen animated search page. It filters the currently loaded room names into direct-chat, group and channel categories, shows up to three matches per category and expands inline using «Показать все».
- Long-press context menu with capped height, internal scrolling, smooth animation and placement below / centered / above the pressed row based on its vertical position.
- The native app starts on CH-01; the existing screen picker remains available for other screens.

## API and feature boundaries

Confirmed backend integration:
- `GET /rooms/mine` — authenticated room list, membership-scoped, typed response parsing.

Not implemented or not claimed:
- The backend response does not provide latest-message text, timestamps, unread counts, file contents or story data. The native screen does not fabricate those values or sort by an unavailable message timestamp.
- Search currently searches room names from the authenticated room list. Direct rooms are grouped under the Contacts search category; this is not a global contacts-directory search.
- Message/file full-text search needs a verified message-history/search contract and must follow the MLS flow. No plaintext message-send route was added.
- Pin and archive state currently live only in the screen session; unread marking is not connected to backend persistence.
- Create-chat, contacts directory, story feed, channel management, call/status/profile navigation and room-history navigation are not represented as connected.
- The bottom navigation keeps the requested labels; other destinations remain explicitly not connected.

## Tests and verification

| Check | Status | Evidence |
|---|---|---|
| Existing backend `GET /rooms/mine` contract and authenticated membership tests | PASS — historical exact-source evidence | `development/reports/2026-11-12-screen-api-integration-and-bridge-ownership.md`; backend `rooms-mine.test.js` |
| New native screen widget test: repository request and live-room rendering | NOT RUN | `mobile/test/chats_screen_test.dart` |
| New native screen widget test: full-screen search and room-name filtering | NOT RUN | `mobile/test/chats_screen_test.dart` |
| Flutter analyzer | NOT RUN | Flutter/Dart SDK unavailable in this execution environment |
| Flutter widget/unit test suite | NOT RUN | Flutter/Dart SDK unavailable |
| Android/iOS build and device visual parity | NOT RUN | No platform build/device runner used |
| Flutter-to-live-backend/device E2E | NOT RUN | No live app/server E2E was executed |

No GitHub Actions workflow was triggered. No test is claimed PASS on this new HEAD. Native MLS remains disabled: `INONE_MLS_NATIVE_ENABLED=false`; Stage 4 remains NOT ACCEPTED / BLOCKED.

## Acceptance status

- Native CH-01 source implementation: **IN PROGRESS** — code is committed to the task branch; runtime and visual acceptance remain open.
- Existing authenticated rooms API reuse: **PASS at source/contract level**, with historical backend test evidence limited to its exact recorded SHA.
- Flutter build, widget tests, Android/iOS, runtime API receipt and visual parity: **NOT RUN**.
- WBS v1.1 remains unchanged. Beta 1.0 cumulative baseline remains **42% implementation / 31% verification**; no percentage increase is claimed from unverified source changes.

## Five previous tasks / evidence reused

1. A1 engine ownership/drift audit — reused; no tree consolidation.
2. B1 stable screen/API inventory for 31 screens — reused.
3. D1/D2 backend and Flutter/Rust bridge source-of-truth — reused.
4. Screen-scoped bridge allowlist and typed Flutter API transport — reused.
5. CH-01 authenticated `GET /rooms/mine` typed repository/DTO integration — extended with native Flutter UI.

## Five next tasks

1. Run `flutter analyze` and the focused native CH-01 tests on an authorized Flutter runner; fix concrete analyzer/test failures.
2. Run the complete Flutter test suite and Android build on one exact final SHA.
3. Perform iOS/Android visual parity and interaction checks for menu placement, scroll, safe areas, keyboard and search.
4. Reconcile and implement the next verified backend contracts for contacts directory, channel metadata and message-history search; keep message send/receive on the MLS client path.
5. Add persistence/API contracts for pin, archive and unread state, then connect navigation destinations only to implemented screens.

## Changed files

- Added `mobile/lib/chats_screen.dart`.
- Updated `mobile/lib/main.dart` to launch native CH-01 and route stable ID CH-01 to the Flutter screen.
- Added `mobile/test/chats_screen_test.dart`.

Branch compare: base `415dbf980b496c38f89d68c441fa8f45fb1560e9` → HEAD `76efbd1361e29ac2890bcb967c604c3149700451` (11 commits ahead, 0 behind at comparison time; 3 changed paths).

No merge was performed. Owner approval is required for merge.
