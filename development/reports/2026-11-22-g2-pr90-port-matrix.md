# CTO stage report — PR #90 / Engine B selective port matrix

**Date:** 2026-11-22  
**Requirement mapping:** Beta 1.0 WBS — Frontend Flutter (25%), API ↔ UI integration (15%), MLS/mobile security/storage (20%), QA/CI/E2E (10%). No WBS weights or percentages changed.  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` SHA `a23f9624b8dfcf6234c1770178cff503eff38553`  
**Task branch:** `integration/g2-pr90-engine-b-main-2026-11-22-r1`  
**PR:** [#128](https://github.com/vahe210991-cloud/InOne-chat/pull/128), Draft  
**Source PR:** [#90](https://github.com/vahe210991-cloud/InOne-chat/pull/90), Open/Draft

## Result

- **PASS:** inspected the full 27-file PR #90 changed-path inventory and patch.
- **PASS:** confirmed source branch is diverged: 115 commits ahead / 325 behind current main; merge base `a174f794535ab09699d38292acb4919308873fd7`.
- **PASS:** verified current Engine B API and Rust FFI/Dart bridge signatures at source level.
- **PASS:** confirmed backend device-bound download, authorization re-checks and Host-header hardening are already present on main, with current regression tests.
- **PASS:** confirmed main already exposes stable-ID attachment send/retry, encrypted download, durable text outbox, pending inbox and ACK methods through Engine B/FFI/Dart.
- **IMPLEMENTED ON #128:** `InOneRepositories.myRooms()` now calls authenticated `GET /rooms/mine` and reuses the existing validated `InOneRoomList` DTO.
- **IMPLEMENTED ON #128:** repository regressions cover authenticated route/method, valid DTO mapping, malformed response and 401 propagation.
- **IMPLEMENTED ON #128:** native messages screen now maps authenticated room names/IDs into the approved `InOneChatPreview` model. Firebase Push, auth/session/navigation and default-off MLS gate are preserved.
- **PENDING:** exact-SHA Flutter/iOS/FRB/P0/acceptance Actions on the product-code head; no current-head job has yet been confirmed green.
- **NOT STARTED:** room history, durable text send, attachment UI and two-device acceptance.
- **NOT ACCEPTED:** G2 remains unaccepted; native MLS remains disabled by default.

## Key CTO decision

Do not copy Engine A or the old PR #90 Rust/bridge/session implementation. Main already contains the critical Engine B persistence, stable-ID and security primitives. The first native room-list slice is now implemented on #128; the next code changes must connect room history and durable messaging through Engine B. Preserve Firebase Push, authentication/session lifecycle, navigation, SQLCipher and durable-before-ACK.

## Exact files

- Matrix: [G2 / PR #90 selective port matrix](../../architecture/mobile/G2-PR90-PORT-MATRIX.md)
- Integration plan: [Engine B integration plan](../../architecture/mobile/G2-PR90-ENGINE-B-INTEGRATION-PLAN.md)
- Integration PR: [#128](https://github.com/vahe210991-cloud/InOne-chat/pull/128)

## Verification evidence

- Current Engine B manifest: `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/Cargo.toml`.
- Current Engine B source: `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/src/lib.rs`.
- Current FFI: `mobile/rust/src/api/session.rs`.
- Current Dart contract/adapter/session: `mobile/lib/core/mls/mls_session_bridge.dart`, `mobile/lib/core/mls/rust_mls_session_bridge.dart`, `mobile/lib/core/session/inone_session.dart`.
- Backend file authorization: `inone-development-archive-0.6.0/engine/src/server.js`, `engine/test/files.test.js`, `engine/test/files-disk.test.js`.
- Main Actions workflows already include exact-SHA checkout, FRB generation, Flutter analyze/tests, Android build and Android Keystore/SQLCipher runtime smoke. PR #90's iOS Keychain simulator step still needs separate workflow/test-driver review.

## Five preceding tasks / evidence

1. PR #119 merged; accepted persistent MLS baseline retained.
2. PR #126 integrated G2 behavior through controlled integration.
3. Main-first integration policy committed and linked from root `AGENTS.md`.
4. Fresh integration branch and Draft PR #128 created from exact main SHA.
5. PR #90 complete changed-file inventory and patches inspected.

## Five next tasks

1. Inspect current-head Actions and fix Flutter analyze/test/build failures until green.
2. Add a deterministic native messages-screen regression if the existing widget harness supports injection.
3. Connect room history to persisted Engine B inbox data; preserve durable persistence before ACK.
4. Wire durable text outbox and flush using stable client message IDs.
5. Add focused regressions and rerun applicable exact-SHA Actions before advancing to attachment UI.

## Owner controls

PR #90 remains open Draft and untouched. PR #128 remains Draft. No merge, force-push, branch deletion, native MLS enablement, or Beta 2.0 work was performed.
