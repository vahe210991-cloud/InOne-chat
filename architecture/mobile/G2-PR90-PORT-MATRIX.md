# G2 / PR #90 — selective port matrix against canonical Engine B

**Date:** 2026-11-22  
**Base:** `main` at `a23f9624b8dfcf6234c1770178cff503eff38553`  
**Task branch:** `integration/g2-pr90-engine-b-main-2026-11-22-r1`  
**Source:** PR #90, `fix/g2-mls-ffi-hardening-2026-11-19`; previously recorded source head `074e76014f33f46085d46cad93007a0fbc849215`  
**Comparison:** source branch diverged from current main; 115 commits ahead / 325 behind; merge base `a174f794535ab09699d38292acb4919308873fd7`.  
**Decision:** behavior-only integration. No wholesale merge or Engine A production dependency.

## Findings

The core persistent MLS capabilities are already present on main and Engine B: protected SQLCipher key lifecycle, session adoption/resume, durable text outbox, stable-ID text send, stable-ID attachment send/retry, encrypted attachment download, inbox persistence/ACK APIs, and device/member controls. The Rust FFI and Dart bridge already expose the stable-ID attachment API. These are not to be copied from PR #90.

The main functional gap was the native Flutter integration: the repository already had a validated `InOneRoom` / `InOneRoomList` DTO and unit tests, but the active `InOneRepositories` wrapper did not call `GET /rooms/mine`, and the native app did not populate its chat list. This branch now adds that repository method, focused request/DTO regressions, and live room-list binding in the native app. History and sending remain MLS-gated.

## Per-file / feature matrix

| PR #90 path or feature | Main / Engine B evidence | Decision |
|---|---|---|
| `inone-engine-poc-0.6.0/mobile-mls/mls-client/**` | Production dependency is Engine B at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`; Engine B already contains attachment crypto, durable outboxes, stable operation IDs, downloads and tests. | **EXCLUDE** Engine A wholesale. Use only as historical behavior reference. |
| Engine A `attachment_crypto.rs`, attachment/outbox tests and Cargo manifests/lock | Engine B already contains `attachment_crypto`, `send_attachment_with_id`, retry handoff and persistent SQLCipher schema. | **EXCLUDE**. Port no dependency or lockfile changes from Engine A. Add Engine B regressions only if a demonstrated gap is found. |
| `mobile/rust/src/api/session.rs` | Main FFI already has panic guard, identity reservation, absolute app-private DB path validation, fail-closed key handling, `send_attachment_with_id`, download, sync, pending inbox, ACK and outbox APIs. Incoming attachment DTO is present. | **MOSTLY ALREADY PRESENT**. Do not transplant file. Review exact edge-case test gaps only. |
| `mobile/lib/core/mls/mls_session_bridge.dart` | Main interface already exposes `sendAttachmentWithId`, `downloadAttachment`, `enqueueText`, `pendingOutbox`, inbox and ACK APIs. | **ALREADY PRESENT**. Do not add the non-stable attachment send API as a retry path. |
| `mobile/lib/core/mls/rust_mls_session_bridge.dart` | Main adapter maps the stable-ID attachment API to generated Rust session bindings and exposes download. | **ALREADY PRESENT**. `localRoomIds` is not currently exposed. Add only if offline room restoration is an approved, evidenced requirement. |
| `mobile/lib/core/session/inone_session.dart` | Main session already adopts/resumes the native session and wraps stable-ID send, enqueue, flush, download, pending inbox and ACK. | **EXTENDED ON #128** with typed `pendingMlsOutbox(roomId)` so the UI can restore queued operations; existing auth/refresh/logout sequencing preserved. |
| `mobile/lib/core/data/inone_repositories.dart` | Main already contains `InOneRoom` / `InOneRoomList` DTO validation and DTO unit tests, but the repository wrapper lacks `myRooms()`. | **IMPLEMENTED ON #128**. Added authenticated `myRooms()` returning the canonical validated `InOneRoomList`; added request, parsing, malformed response and unauthorized regressions. |
| `mobile/lib/app/inone_mobile_app.dart` | Main preserves Firebase Push and session/navigation lifecycle, but normal messages UI is empty and push-chat send/attachments are deliberately blocked. PR #90 adds ~457 lines of chat UI/session orchestration. | **ROOM LIST + HISTORY + TEXT OUTBOX IMPLEMENTED ON #128 BEHIND NATIVE GATE**. App loads typed rooms; room opening uses ciphertext history + Engine B sync + SQLCipher history; ACK after durable read; text enqueue persists in Engine B outbox with stable local operation ID and flush/retry on app resume. Preserve current host/push/auth/navigation lifecycle. Attachments remain blocked. |
| `mobile/lib/ui_dart_source/models/inone_models.dart` | Main UI model currently lacks some attachment presentation fields added by PR #90. Rust bridge DTO already carries attachment metadata. | **DEFER** until attachment UI slice; map only fields needed by approved screen contract. |
| `mobile/lib/ui_dart_source/screens/main/inone_chat_thread_screen.dart` | PR #90 changes send callback to async and adds attachment download callback. | **IMPLEMENTED ON #128**: send callback accepts `FutureOr<void>`; composer clears only after durable enqueue succeeds, and failed persistence leaves the draft available. Existing approved layout preserved. |
| `mobile/lib/ui_dart_source/screens/main/inone_messages_screen.dart` | PR #90 changes placeholder copy only. | **LOW VALUE**. Do not port copy alone; connect real typed room data first. |
| `mobile/pubspec.yaml` / `mobile/pubspec.lock` (`file_picker`) | Current main does not declare `file_picker`; PR #90 adds v11.0.3. | **DEFER** until attachment picker implementation is approved and API use is verified. Never transplant lockfile wholesale. |
| `mobile/rust/Cargo.lock` | PR #90 changes transitive versions and zeroize graph. Main has its own locked Engine B graph and CI enforces it. | **EXCLUDE** source lockfile. Regenerate only from the selected Engine B manifest with pinned toolchain if dependencies actually change. |
| `mobile/test/core/session/mls_session_handoff_test.dart` | Main already has broad Rust session/FFI tests; PR adds a fake-bridge happy-path test for text/outbox/attachment/ACK. | **CANDIDATE REGRESSION**. Re-author against current DTOs and current stable-ID contract when implementing each slice; do not copy fake APIs blindly. |
| `mobile/integration_test/mls_secure_store_test.dart` | PR deletes a close call; no demonstrated production behavior gap from that one-line deletion. | **EXCLUDE** pending a test-lifecycle explanation and exact runtime evidence. |
| `inone-development-archive-0.6.0/engine/src/server.js` | Main already contains device-bound download signatures, live bearer authentication on object GET, current membership/owner checks, and Host-safe absolute URL generation. | **ALREADY PRESENT**. No server patch required. |
| `engine/test/files.test.js`, `files-disk.test.js` | Main already tests device-bound downloads, revocation, membership and Host spoofing. | **ALREADY PRESENT**. Reuse current tests; do not duplicate. |
| `engine/test/api-contract.test.js` | Main already has native Beta 1 repository/backend contract assertions. PR #90 rewrites older screen-manifest checks and references Engine A paths. | **DO NOT COPY**. Preserve current main contract inventory; add only a focused assertion if a new route wrapper is introduced. |
| `.github/workflows/flutter-mobile.yml` | Main already has exact-SHA checkout, FRB generation, Flutter analyze/tests, Android build and Android Keystore/SQLCipher runtime smoke. | **ALREADY COVERED**; PR #90's additional generic emulator step is redundant and must not replace the stronger current smoke. |
| `.github/workflows/flutter-ios-validation.yml` | Main has exact-SHA iOS build and FRB checks; PR #90 adds simulator Keychain smoke. | **REVIEW CANDIDATE**. Verify integration driver, simulator boot and Keychain test prerequisites before any workflow edit. |
| `development/reports/2026-11-19-g2-mls-cto-execution.md` | Historical source-branch report; contains useful provenance and prior CI failure details. | **REFERENCE ONLY**. Preserve as historical evidence; do not overwrite or import it as current acceptance. |

## Current API contract confirmed on main

- Engine B manifest: `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/Cargo.toml`.
- Engine B methods include `send_text_with_id`, `send_attachment_with_id`, `download_attachment`, `enqueue_text`, `pending_outbox_for_room_json`, `flush_outbox`, `pending_incoming`, `acknowledge_incoming`, `local_room_ids`, `local_epoch`, `members_of`, and device-revocation operations.
- Rust FFI exposes `send_text_with_id`, `send_attachment_with_id`, `download_attachment`, `enqueue_text`, `sync`, `pending_incoming`, `acknowledge_incoming`, and `flush_outbox`.
- Dart bridge exposes `sendAttachmentWithId`, `downloadAttachment`, `enqueueText`, `pendingIncoming`, `acknowledgeIncoming`, and `flushOutbox`.
- `INONE_MLS_NATIVE_ENABLED` remains false by default in `mobile/lib/app/inone_mobile_app.dart`.

## Next implementation order

1. **Completed on #128:** typed authenticated `myRooms()` wrapper using the pre-existing `InOneRoomList` DTO; request/response validation regressions.
2. **Completed on #128:** native messages screen now displays authenticated room names/IDs while preserving Firebase Push and app/session/navigation lifecycle.
3. **Implemented behind native-session gate on #128:** authenticated ciphertext-only history read → Engine B sync → SQLCipher room-history read → ACK only readable pending IDs after durable read. Runtime acceptance remains pending.
4. **Implemented behind native gate:** text is enqueued to Engine B SQLCipher outbox, displayed as queued, flushed with durable local operation ID, and retried on app resume; queued bubbles restore from pending outbox.
5. Implement stable-ID encrypted attachment UI/download and complete platform/two-device acceptance. Exact-SHA CI remains pending.

## Acceptance status

- Source PR ancestry/changed paths inspected: **PASS**.
- Engine B / FFI / Dart API signatures inspected: **PASS** (source-level only).
- Core MLS and backend hardening gaps from PR #90: **ALREADY PRESENT** on main.
- Typed authenticated room-list repository + native messages-list integration: **IMPLEMENTED ON #128**; exact-SHA Actions pending.
- Room history read/decrypt/presentation + ACK-after-SQLCipher-read path: **IMPLEMENTED BEHIND NATIVE MLS GATE**; runtime acceptance pending.
- Durable text send/outbox UI: **IMPLEMENTED BEHIND NATIVE MLS GATE**; exact-SHA/runtime acceptance pending.
- Attachment UI: **NOT STARTED**.
- G2: **NOT ACCEPTED**.
- PR #90 remains OPEN/DRAFT; PR #128 remains OPEN/DRAFT. No merge or source-branch mutation.
