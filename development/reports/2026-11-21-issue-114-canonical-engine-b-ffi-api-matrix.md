# Issue #114 — canonical Engine B / mobile FFI API reconciliation

Audit baseline: `main` at `ce0c4dba63c2f1275090500c263882864becd875` (after PR #112 and #113).
Work branch: `feat/issue-114-canonical-engine-b-ffi-2026-11-21`.

## Decision

Engine B remains the only production MLS engine. Do not change `mobile/rust/Cargo.toml` to B until the bridge contract is implemented and tested. Do not copy Engine A's `lib.rs` over B: B's transaction-aware OpenMLS storage, durable inbox journal, P1 error handling, and crash consistency are authoritative.

## Current production bridge imports and calls

Source: `mobile/rust/src/api/session.rs`; Dart contract: `mobile/lib/core/mls/mls_session_bridge.dart`; adapter: `mobile/lib/core/mls/rust_mls_session_bridge.dart`.

| Contract | Engine B on main | Required action |
|---|---|---|
| `connect_with_session` | absent | Add safe persistent-session adoption around B's `build_client` |
| `resume_with_session` | absent | Add resume from B's encrypted DB; fail closed if key/session metadata missing |
| `KeyStore::has_database_key` | absent | Extend platform key-store contract |
| `KeyStore::existing_database_key` | absent | Extend platform key-store contract; never silently replace a missing key |
| `KeyStore::delete_database_key` | absent | Extend platform key-store contract for logout/purge |
| `Client::access_token_snapshot` | absent | Add access-token-only snapshot; never expose refresh token |
| `Client::refresh_session` | absent | Add explicit rotation with durable refresh-token update |
| `Client::messages_for_room` | absent | Add SQLCipher-backed room history query |
| `Client::send_text_with_id` | absent | Port stable client operation ID and retry semantics; preserve server idempotency |
| `Incoming::Attachment` | absent | Port only after G2 attachment crypto/send/receive is reconciled |
| `send_attachment_with_id` / `download_attachment` | absent | Port G2 encrypted file pipeline into B; no plaintext upload or unbound download |

Existing B APIs already cover the shared operations used by the bridge: key-package provisioning, room create/invite/cancel, recovery/desync diagnostics, undecryptable diagnostics, quarantine reason, send/enqueue text, sync, pending inbox, ACK, outbox, epochs, membership, device revoke/removal, and logout. Keep B implementations for these operations.

## G2 source and constraints

PR #59 is still Draft and is based on the Flutter migration branch, with attachment crypto and integration tests in Engine A. PR #90 is still Draft and also targets Engine A. These are source material, not merge candidates for production B. Port the cryptographic module and narrowly scoped behavior/tests; do not transplant their Engine A client implementation or unrelated backend/UI changes.

## Required implementation sequence

1. Extend Engine B `KeyStore` with explicit existing-key detection/read/delete semantics and tests; preserve zeroization and fail-closed behavior.
2. Add persistent session adoption/resume and durable token rotation to B's existing SQLCipher `client_meta` without changing B's transaction/storage ownership.
3. Add stable message operation IDs and room history APIs in B; test retry/idempotency and crash behavior against B.
4. Port G2 attachment crypto and B-native attachment persistence/send/download. Keep file bytes encrypted before upload; manifest and file key travel only inside MLS; bind downloads to the authenticated device; preserve retry identity.
5. Add B-native integration/regression tests for session resume/logout, attachments, device-bound downloads, retry/idempotency, and inbox atomicity.
6. Switch `mobile/rust/Cargo.toml` to B only after steps 1–5 compile and pass; update `Cargo.lock` and regenerate FRB/Dart artifacts deterministically.
7. Validate exact same commit on Rust, canonical B, FRB codegen, Flutter, Android runtime, iOS Simulator, and iOS Device.

## Acceptance gate

No production path switch and no merge until the mobile FFI compiles and runs against B, Dart/FRB contracts are aligned, P1 + G2 regressions pass on one exact SHA, and Android/iOS use the same generated bridge artifact.
