# G2 integration plan — PR #90 and PR #94

Date: 2026-11-22
Baseline: `main` at `36ee2c464bc0259ecc302a21bd6cbf321ac25896`
Status: integration branch only; no production code ported yet; PRs #90 and #94 remain Draft.

## Objective

Integrate the useful Flutter messaging and encrypted-attachment UI work from PR #90 and the Android PathProvider/JNI investigation from PR #94 without replacing the canonical Engine B runtime or regressing changes already accepted on `main`.

## Non-negotiable baseline

- `mobile/rust/Cargo.toml` on main uses canonical Engine B at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`.
- Keep current main's Rust FFI implementation, identity reservation, operation-id/idempotency APIs, SQLCipher key lifecycle, and logout cleanup. Do not copy PR #90's older Rust FFI or Cargo dependency wholesale.
- Keep current Firebase Core/Messaging dependencies, push lifecycle observers/handlers, app lifecycle behavior, SDK constraints, and all current lockfile constraints.
- Keep native MLS feature activation opt-in until runtime acceptance is complete.
- No secrets, plaintext attachment bytes, attachment file keys, or refresh tokens may be sent to the backend or logged.

## PR #90 — feature-by-feature port

### Already present on main (preserve and verify)

- Engine B persistent session open/resume and platform key storage.
- SQLCipher-backed local session state.
- Rust FFI session lifecycle, attachment send/download entry points, local room history and outbox support.
- Stable operation IDs for text and attachment sends.
- Active identity reservation and safe local session purge/logout.

### Port candidates from PR #90

- Dart `InOneSession` orchestration/wrappers for room operations, send/enqueue, local room restoration, pending outbox, ACK/retry and device lifecycle, adapted to current bridge contracts.
- Chat-screen orchestration that replaces disabled/placeholder message-send and attachment flows.
- File picker/save integration and focused UI regression tests.

### Explicit regression guards

- Do not replace current `mobile/lib/app/inone_mobile_app.dart` with the PR version: it removes current Firebase push lifecycle and foreground notification behavior.
- Do not replace current `mobile/lib/core/mls/rust_mls_session_bridge.dart` or Rust FFI wholesale; preserve current APIs including `sendTextWithId`, `sendAttachmentWithId`, `pendingOutbox`, and `purgeLocalSession`.
- Add any required dependency (for example `file_picker`) selectively and resolve it without lowering current Dart/Flutter SDK constraints or removing Firebase dependencies.
- Inspect all chat UI changes for duplicate send paths, plaintext fallback, optimistic bubble reconciliation, and idempotent retry behavior.

## PR #94 — Android PathProvider/JNI decision

- Current main pins `path_provider_android: 2.2.23` and documents the JNI regression in newer 2.3.x.
- First run Android API 35 emulator smoke against current main with that pin.
- If it passes, retain the pin and do not add a redundant MethodChannel.
- If it fails with the specific JNI context lookup regression, port the workaround narrowly, using current Android package `com.inone.app`, not PR #94's stale `com.inone.inone_mobile` path.
- Preserve `super.configureFlutterEngine` and generated plugin registration.
- Add a real channel/runtime test; a source-generation check alone is insufficient.

## Required validation gates

1. Formatting, static analysis, unit and widget tests for changed Dart code.
2. Rust formatting, clippy (where configured), unit/integration tests and Engine B API compatibility.
3. Flutter Rust Bridge generation/reproducibility check.
4. Android debug/release build and API 35 emulator tests: app launch, support-directory resolution, Keystore key lifecycle, SQLCipher open/resume/logout.
5. iOS simulator build/tests and Keychain lifecycle tests.
6. Two independent devices: bidirectional MLS text exchange, encrypted attachment send/download/decrypt, process restart, retry without duplicate message, membership/device revocation.
7. Backend authorization checks: attachment access scoped to authenticated device and current room membership; no plaintext attachment or key leakage.
8. Exact-head CI matrix green after the final code change. Missing, skipped, action_required, stale-SHA, or unexecuted checks are not green.

## Work sequence

- [x] Create isolated integration branch from current main.
- [x] Record the source audit and port constraints.
- [ ] Compare PR #90 changed Dart files against main and port only missing behavior.
- [ ] Add focused tests for message and attachment UI orchestration.
- [ ] Run the complete Flutter/Rust/FRB CI matrix.
- [ ] Run Android API 35 baseline smoke before deciding whether PR #94 workaround is needed.
- [ ] Port narrowly only if runtime evidence demonstrates the JNI failure.
- [ ] Run iOS simulator and two-device acceptance.
- [ ] Open an integration PR only after exact-head checks are green; keep source PRs Draft until disposition is agreed.

## Current evidence boundary

This plan records source-level findings from repository inspection. Creating this branch and plan does not mean code was ported, builds were run, emulator/device tests passed, or either source PR is merge-ready.
