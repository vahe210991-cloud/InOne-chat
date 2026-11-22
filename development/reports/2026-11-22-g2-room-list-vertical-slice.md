# G2 room-list vertical slice — CTO execution report

**Date:** 2026-11-22  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` at `a23f9624b8dfcf6234c1770178cff503eff38553`  
**Branch:** `integration/g2-pr90-engine-b-main-2026-11-22-r1`  
**PR:** [#128 — Draft](https://github.com/vahe210991-cloud/InOne-chat/pull/128)  
**Source PR:** [#90 — Open/Draft, unchanged](https://github.com/vahe210991-cloud/InOne-chat/pull/90)  
**Code-slice SHA before documentation updates:** `c3d1c0bffd5ea4b71a104abf5d6b905a1b0b0c93`

## Scope / approved WBS mapping

- Frontend Flutter and approved UI — 25%.
- API ↔ UI integration — 15%.
- QA, CI and E2E — 10%.
- This slice does not accept MLS/mobile security/storage (20%) or G2 as complete. WBS v1.1 weights and cumulative percentages are unchanged.

## Implemented

1. Reused the existing canonical `InOneRoom` / `InOneRoomList` DTO and validation; no duplicate room DTO and no new backend endpoint.
2. Added `InOneRepositories.myRooms()`, calling authenticated `GET /rooms/mine`.
3. Added repository tests for authenticated method/path, successful DTO parsing, malformed response rejection and unauthorized response propagation.
4. Connected authenticated app loading to the room-list repository and mapped rooms into the existing `InOneChatPreview` model.
5. Preserved Firebase Push lifecycle, app/session/navigation flow, SQLCipher/Rust ownership, and `INONE_MLS_NATIVE_ENABLED=false` default.
6. Cleared cached chat previews on logout.
7. Corrected stale empty-state copy that incorrectly said the backend had no room-list endpoint.
8. Updated the API contract matrix, mobile README and PR #90 port matrix.

## Changed product paths

- `mobile/lib/core/data/inone_repositories.dart`
- `mobile/lib/core/data/inone_chat_preview_mapper.dart`
- `mobile/test/core/data/inone_repositories_test.dart`
- `mobile/test/core/data/inone_chat_preview_mapper_test.dart`
- `mobile/lib/core/session/inone_session.dart`
- `mobile/test/core/session/mls_session_handoff_test.dart`
- `mobile/lib/app/inone_mobile_app.dart`
- `mobile/lib/ui_dart_source/screens/main/inone_messages_screen.dart`
- `mobile/lib/ui_dart_source/screens/main/inone_chat_thread_screen.dart`

Existing files reused without changes:
- `mobile/lib/core/data/inone_room.dart`
- `mobile/test/core/data/inone_room_test.dart`
- `inone-development-archive-0.6.0/engine/test/rooms-mine.test.js`

## Verification

- Backend route/DTO contract: **SOURCE REVIEW PASS**. Existing `rooms-mine.test.js` verifies authenticated room listing, membership scoping, non-member isolation and unauthenticated 401.
- Existing DTO parser tests: historical source tests present; exact current branch Flutter suite pending.
- New repository, room-to-preview mapper, durable outbox and read-before-ACK session tests: authored; execution **PENDING**.
- Flutter analyze/test/Android build: **PENDING** exact-SHA GitHub Actions.
- iOS validation: **PENDING** exact-SHA GitHub Actions.
- FRB generation: **PENDING** exact-SHA GitHub Actions.
- P0/backend/Rust/DB acceptance: **PENDING** exact-SHA GitHub Actions.
- Exact-SHA acceptance gate: **PENDING**.
- No current-head test is claimed green yet. Any Actions run on an earlier SHA is superseded and cannot satisfy the final-head gate.

## Room history implementation checkpoint

- Room opening requests the existing authenticated `GET /rooms/:id/events` route (ciphertext only; backend membership checks remain authoritative).
- It invokes Engine B sync and reads only messages already persisted in the SQLCipher inbox. Text and attachment metadata are mapped into the existing thread UI.
- `InOneSession.loadMlsRoomHistory()` centralizes the read-before-ACK boundary: read SQLCipher history, inspect pending inbox, then ACK only readable events for that room whose IDs are present in the persisted history result. Unreadable, other-room, and not-yet-persisted events remain pending. Push-open and normal room-open both use this path.
- A Dart session regression verifies the call order (`history` → `pending` → `ack`) and that only a readable, persisted event for the selected room is acknowledged.
- This is source implementation only. Native MLS remains disabled by default, so the path is not runtime-accepted or available as a product feature until platform/security gates pass.

## Not implemented / acceptance boundary

- Text sending is now source-wired behind the native-session gate: durable enqueue in Engine B SQLCipher outbox, stable local operation ID reused by flush/retry, queued bubble restoration, and retry on app resume. Composer clears only after enqueue succeeds.
- Attachment sending/downloading remains blocked until the stable-ID encrypted attachment UI and platform acceptance pass.
- Native MLS remains disabled by default.
- G2 remains **NOT ACCEPTED**.

## Five previous tasks / evidence

1. PR #119 merged and persistent MLS baseline retained.
2. PR #126 integrated through controlled integration.
3. Repository-wide main-first selective integration policy committed and linked from root `AGENTS.md`.
4. PR #128 integration branch created from exact main SHA as Draft.
5. PR #90's 27 changed paths and full patch mapped against canonical Engine B; no Engine A wholesale port.

## Five next tasks

1. Inspect all current-head Actions jobs and logs; fix Flutter analyze/test/build failures until green.
2. Add deterministic messages-screen regression if supported by the existing widget harness.
3. Implement stable-ID encrypted attachment picker/send/download UI using existing Engine B APIs.
4. Complete Android/iOS runtime, SQLCipher/KeyStore, recovery and two-device offline/restart/duplicate-delivery/revocation acceptance.
5. Keep native MLS disabled until owner accepts all exact-SHA and platform gates; no merge without explicit approval.

## Owner controls

PR #128 remains OPEN/DRAFT. PR #90 remains OPEN/DRAFT and untouched. No merge, force-push, branch deletion, native MLS enablement or Beta 2.0 work was performed.
