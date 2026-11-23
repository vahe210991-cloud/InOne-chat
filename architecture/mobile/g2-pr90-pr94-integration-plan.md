# G2 integration plan — PR #90 and PR #94

Date: 2026-11-22
Baseline: `main` at `36ee2c464bc0259ecc302a21bd6cbf321ac25896`
Status: selective Engine B integration implemented in Draft PR #124; exact-head CI is pending. Source PRs #90 and #94 remain Draft.

## Objective

Integrate the useful Flutter messaging and encrypted-attachment UI work from PR #90 and the Android PathProvider/JNI investigation from PR #94 without replacing the canonical Engine B runtime or regressing changes already accepted on `main`.

## Non-negotiable baseline

- `mobile/rust/Cargo.toml` on main uses canonical Engine B at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`.
- Keep current main's Rust FFI implementation, identity reservation, operation-ID/idempotency APIs, SQLCipher key lifecycle, and logout cleanup. Do not copy PR #90's older Rust FFI or Cargo dependency wholesale.
- Keep current Firebase Core/Messaging dependencies, push lifecycle observers/handlers, app lifecycle behavior, SDK constraints, and lockfile constraints.
- Keep native MLS feature activation opt-in until runtime acceptance is complete.
- No secrets, plaintext attachment bytes, attachment file keys, or refresh tokens may be sent to the backend or logged.

## PR #90 — feature-by-feature port

### Implemented in PR #124

- Added validated `InOneSession` orchestration for room operations, key-package setup, invitations, text enqueue/send, inbox/outbox, ACK/retry, epoch/member inspection and device lifecycle.
- Connected the native MLS chat list and thread UI while preserving Firebase push lifecycle and push-route handling.
- Added attachment picker/download flow. The UI keeps a conservative 50 MiB in-memory selection limit.
- Attachment sends now pass a caller-generated stable `clientMessageId` to Engine B's durable attachment outbox; the facade validates the key before crossing FFI.
- Exposed Engine B `local_room_ids()` through Rust FFI, FRB and Dart. If the server room-list request fails after a cold start, the app restores room IDs from the SQLCipher-backed local client.
- Added focused session handoff tests, including stable attachment-ID forwarding and local-room-list facade coverage.
- Kept the authenticated `GET /rooms/mine` repository adapter for online room metadata.

### Preserved from main

- Canonical Engine B dependency and generated FRB runtime.
- Persistent Rust-owned sessions, platform key storage, SQLCipher, inbox/outbox and attachment journal.
- Existing Firebase initialization, push handlers, foreground notification behavior and recovery deep links.
- `INONE_MLS_NATIVE_ENABLED` remains false by default.

### Explicit regression guards

- Do not copy PR #90's Engine A Rust code, Cargo dependency, or older FFI wholesale.
- Do not replace current `mobile/lib/app/inone_mobile_app.dart` with the PR #90 version; it removes current Firebase push lifecycle and foreground notification behavior.
- Keep attachment payloads encrypted end-to-end; no plaintext fallback or backend-visible file key.
- Preserve the durable Engine B outbox and stable operation IDs so retry after restart does not create a second logical send.

## PR #94 — Android PathProvider/JNI decision

- Current main pins `path_provider_android: 2.2.23` and avoids the JNI regression reported against newer 2.3.x.
- PR #124 does not add the custom MethodChannel workaround from PR #94.
- Earlier PR #124 exact-head Android runtime smoke passed with the current pin. The latest exact-head Android runtime check must pass again before this decision is final.
- If the latest API 35 emulator run fails with the specific JNI context lookup regression, port the workaround narrowly, using the current Android package and preserving `super.configureFlutterEngine` and generated plugin registration.

## Required validation gates

1. Formatting, static analysis, unit and widget tests for changed Dart code.
2. Rust formatting, clippy where configured, unit/integration tests and Engine B API compatibility.
3. Flutter Rust Bridge generation/reproducibility check, including the new `localRoomIds` contract.
4. Android build and API 35 emulator tests: app launch, support-directory resolution, Keystore key lifecycle, SQLCipher open/resume/logout and local room restoration.
5. iOS simulator build/tests and Keychain lifecycle tests.
6. Two independent devices: bidirectional MLS text exchange, encrypted attachment send/download/decrypt, process restart, retry without duplicate message, membership/device revocation.
7. Backend authorization checks: attachment access scoped to authenticated device and current room membership; no plaintext attachment or key leakage.
8. Exact-head CI matrix green after the final code change. Missing, skipped, action_required, stale-SHA, or unexecuted checks are not green.

## Work sequence

- [x] Create isolated integration branch from current main.
- [x] Audit PR #90 and PR #94 against the accepted Engine B baseline.
- [x] Port Flutter session facade and chat UI without copying Engine A.
- [x] Add stable attachment operation IDs at the UI/FFI boundary.
- [x] Expose local Engine B room IDs through FFI/FRB and restore the offline room list after cold start.
- [x] Preserve the existing PathProvider pin instead of adding a redundant MethodChannel.
- [ ] Complete exact-head Android, iOS, FRB, Native MLS and P0 CI on the latest PR #124 SHA.
- [ ] Run physical two-device acceptance for text, attachments, restart/retry and revocation.
- [ ] Keep native MLS opt-in disabled until all runtime/security acceptance gates pass.

## Progress update — 2026-11-22

- Draft PR #124 is based on the exact main baseline from PR #119.
- Latest code head before this documentation refresh: `bda3b6b7919151eda81b035940a1e2e8811f6515`.
- The latest code changes expose `local_room_ids()` through Rust FFI/FRB/Dart and wire the app's offline fallback to the SQLCipher-backed room list.
- Attachment UI now sends a stable operation ID and the session handoff test verifies it reaches the Rust bridge.
- Exact-head CI for the latest code SHA was queued; this documentation commit will require a fresh exact-head CI run.
- PR #126's independent integration SHA `97e1b14d9405f2dac4e1fafcfe3270fc2552825a` has completed 9/9 workflows successfully. PR #126 remains Draft and unmerged.

## Current evidence boundary

Source-level integration is implemented in PR #124, but this does not prove physical-device or two-device acceptance. CI results from older SHAs are not evidence for the latest head. Keep PR #124 Draft and keep `INONE_MLS_NATIVE_ENABLED` false until the final exact-head CI and required runtime/security gates pass.

## PR #131 integration checkpoint — 2026-11-23

PR #131 (feature/beta1-screen-backend-wiring-2026-11-23) is the only integration target. These changes are applied to its branch; PR #87, #89 and #90 source branches are not modified.

### Selected G2 organization-request work from PR #87 / #89

- PS-01/PS-02/PS-03 are wired into the native Flutter app: platform queue, request details, document list/preview, and owner-only decision actions.
- Platform role is returned by the authenticated profile and used only for presentation; the server remains authoritative for every privileged request.
- Document downloads use a binary authenticated client. Persistent local content is owner-scoped AES-256-GCM ciphertext; key material is held in platform secure storage. Preview plaintext is temporary and cleaned on startup, app resume after viewer handoff, logout and session revocation.
- Backend upload metadata includes sanitized filename and allowlisted MIME type with magic-byte validation. Upload is serialized against the pending-request decision; an upload racing a decision is rejected and its object is removed.
- The main branch already uses migration 0032-push-delivery-queue.sql. Therefore the document metadata migration is **0033**, not the conflicting 0032 proposed by the older PR #87 branch. SCHEMA_VERSION, the legacy marker, fresh schema and fresh/legacy migration tests are aligned to 0033.
- PR #89's four-role staging authorization smoke script and syntax test are included. The live staging script is not run without the four distinct staging credentials.

### Selected MLS work from PR #90

- Engine A (inone-engine-poc-0.6.0/mobile-mls/mls-client) is deliberately excluded.
- PR #131 retains Engine B (inone-development-archive-0.6.0/engine/mobile-mls/mls-client) and its Rust/FRB bridge.
- The current branch already contains the selected application glue: stable message and attachment IDs, SQLCipher-backed durable inbox/outbox, local room recovery, retry on app resume, readable-history persistence before ACK, MLS-protected attachment manifests and encrypted attachment send/download.
- Push deep links now open the durable MLS chat thread and support attachment items rather than the legacy read-only push-chat screen.
- Canonical group/direct/support room preview mapping is shared and tested.

### Acceptance gate and closure policy

- Source changes above are present in PR #131, but source presence is not a green test result.
- Backend Node/PostgreSQL, Flutter analyze/tests, Rust/OpenMLS/FRB codegen and Android/iOS build workflows must pass on the **same final PR #131 head SHA**. Physical-device and two-device MLS acceptance remains a separate manual gate.
- PR #87 and #90 remain open until that exact-SHA validation is green and the transfer checklist is verified. They are then to be closed without merging. PR #89 is not included in the closure instruction and remains untouched.
- PR #131 must not be merged into main without a separate explicit decision.
