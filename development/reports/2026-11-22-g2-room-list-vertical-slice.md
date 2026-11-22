# G2 room-list vertical slice — CTO execution report

**Date:** 2026-11-22  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` at `a23f9624b8dfcf6234c1770178cff503eff38553`  
**Branch:** `integration/g2-pr90-engine-b-main-2026-11-22-r1`  
**PR:** [#128 — Draft](https://github.com/vahe210991-cloud/InOne-chat/pull/128)  
**Source PR:** [#90 — Open/Draft, unchanged](https://github.com/vahe210991-cloud/InOne-chat/pull/90)  
**Code-slice SHA before documentation updates:** `1110e0b1a9083932cfa6bbaff54dc1045f8f0f5d`

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
- `mobile/test/core/data/inone_repositories_test.dart`
- `mobile/lib/app/inone_mobile_app.dart`
- `mobile/lib/ui_dart_source/screens/main/inone_messages_screen.dart`

Existing files reused without changes:
- `mobile/lib/core/data/inone_room.dart`
- `mobile/test/core/data/inone_room_test.dart`
- `inone-development-archive-0.6.0/engine/test/rooms-mine.test.js`

## Verification

- Backend route/DTO contract: **SOURCE REVIEW PASS**. Existing `rooms-mine.test.js` verifies authenticated room listing, membership scoping, non-member isolation and unauthenticated 401.
- Existing DTO parser tests: historical source tests present; exact current branch Flutter suite pending.
- New repository tests: authored; execution **PENDING**.
- Flutter analyze/test/Android build: **PENDING** exact-SHA GitHub Actions.
- iOS validation: **PENDING** exact-SHA GitHub Actions.
- FRB generation: **PENDING** exact-SHA GitHub Actions.
- P0/backend/Rust/DB acceptance: **PENDING** exact-SHA GitHub Actions.
- Exact-SHA acceptance gate: **PENDING**.
- No current-head test is claimed green yet. Any Actions run on an earlier SHA is superseded and cannot satisfy the final-head gate.

## Not implemented / acceptance boundary

- Room history remains unavailable in the UI until the Engine B incoming/persisted message path is connected and validated.
- Message sending remains blocked until durable outbox, stable message IDs, retry idempotency and ACK-after-durable-persistence are wired.
- Attachments remain blocked pending the stable-ID encrypted attachment flow and platform acceptance.
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
3. Connect room history to persisted Engine B incoming messages; ACK only after durable local persistence.
4. Wire durable text outbox and flush with stable message IDs and idempotent retries.
5. Implement stable-ID encrypted attachment UI/download and complete Android/iOS plus two-device acceptance.

## Owner controls

PR #128 remains OPEN/DRAFT. PR #90 remains OPEN/DRAFT and untouched. No merge, force-push, branch deletion, native MLS enablement or Beta 2.0 work was performed.
