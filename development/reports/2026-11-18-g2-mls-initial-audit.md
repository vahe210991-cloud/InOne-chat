# G2 — native MLS implementation audit and execution checklist

**Date:** 2026-11-18  
**Baseline:** `main` at `a174f794535ab09699d38292acb4919308873fd7`  
**Working branch:** `feat/beta1-g2-mls-audit-2026-11-18`  
**Scope:** Beta 1.0 MLS only. No Beta 2.0 functionality and no production MLS enablement.

## 1. Initial audit conclusion

The merged G1 baseline already contains a substantial persistent Rust/OpenMLS path and Flutter Rust Bridge adapter. It is not yet an accepted end-to-end MLS release.

### Present in main

- `mobile/rust` is the Flutter Rust Bridge crate (`flutter_rust_bridge = 2.13.0`, Rust 1.91); it depends on the canonical POC client at `inone-engine-poc-0.6.0/mobile-mls/mls-client`.
- The Rust API exposes a persistent opaque `MlsSession`; refresh token, OpenMLS state and SQLCipher key are not exposed through Dart getters.
- `mobile/rust/src/secure_store.rs` implements a platform KeyStore adapter: Android Keystore and protected iOS Keychain; key reads/creation/deletion are serialized, secret buffers are zeroized, and unsupported platforms fail closed.
- The client uses SQLCipher-backed SQLite for OpenMLS state, session metadata, inbox/outbox and diagnostics. The client code rejects an existing database with a missing protected key and rejects key/database mismatch rather than silently replacing the key.
- Rust owns refresh-token rotation after session adoption. Flutter receives only an access-token snapshot.
- The app feature flag `INONE_MLS_NATIVE_ENABLED` defaults to `false`; native MLS is opt-in and must remain disabled until G2 acceptance.
- Rust API already exposes key-package provisioning, room/invite operations, text send/sync, inbox acknowledgement, outbox flush, epoch/member diagnostics and device revocation/removal.
- The exact G1-head Native MLS workflow [#44353252236](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44353252236) passed OpenMLS attachment/session integration tests, iOS Keychain native-target compilation and persistent FRB host tests. This is evidence for that workflow/head only, not physical-device or two-device acceptance.

### Missing or not yet accepted

- The current main client does not contain `attachment_crypto.rs`; the Rust FFI API has no attachment send/download methods. The complete encrypted attachment path is therefore NOT IMPLEMENTED in the current main baseline.
- No physical Android Keystore or iOS Keychain lifecycle/restart/revocation acceptance is recorded.
- No two-independent-device MLS send/receive acceptance, offline/reconnect acceptance or revocation/recovery acceptance is recorded.
- OTR/ephemeral behavior has not been demonstrated as part of the Beta 1.0 scope; keep it separate until scope is confirmed by the approved product contract.
- Native MLS remains feature-flagged off. Do not enable it during this work until all gates and owner acceptance pass.

## 2. Legacy PR/branch disposition — do not merge wholesale

The prior MLS work is stacked on an obsolete Flutter branch and has diverged substantially from current main:

| PR | Branch | State | Current purpose | Initial disposition |
|---|---|---|---|---|
| [#57](https://github.com/vahe210991-cloud/InOne-chat/pull/57) | `feat/mls-attachment-aead-core-2026-11-15` | Draft/open | AES-256-GCM attachment crypto core and manifest | Extract only the crypto-core changes after API/security review |
| [#58](https://github.com/vahe210991-cloud/InOne-chat/pull/58) | `feat/native-mls-persistent-ffi-2026-11-15` | Draft/open | Persistent Rust client/FRB/platform secure store | Most of the core runtime already exists in main through selective G1 port; compare exact path-level diffs before reusing anything |
| [#59](https://github.com/vahe210991-cloud/InOne-chat/pull/59) | `feat/mls-encrypted-attachment-flow-2026-11-15` | Draft/open | End-to-end encrypted attachment send/receive, persistence, retry | Extract only missing attachment vertical slice; backend changes require independent review |

All three PRs have an old base (`feat/flutter-ui-dart-migration-2026-11-14`) and their branch histories diverge from current main. GitHub compare reports a shared merge base `1df19a001acb5f8c4892471ca4eaa0696e02c54d`, while main has moved on. The compare is too large for a safe whole-branch merge. Do not merge, retarget, close or delete these PRs/branches until their unique changes have been mapped and preserved.

## 3. G2 execution checklist

Status vocabulary: `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `PASS`, `OWNER ACCEPTED`. A PASS must cite exact SHA, command/scenario, environment and evidence. CI PASS is not device PASS.

### G2-A — canonical runtime and FFI

- [x] Identify canonical Rust client crate and Flutter FRB boundary in main.
- [x] Confirm Dart does not receive SQLCipher key or MLS private-key getters.
- [ ] Audit every FRB-exported method for ownership, error mapping, panic boundary, concurrency and input validation.
- [ ] Confirm generated bindings are reproducible from the committed Rust API on a clean checkout; no untracked/generated drift.
- [ ] Confirm only one persistent MLS runtime is reachable from production app code; no temporary engine/client is wired into the app.
- [ ] Add/verify regression tests for closed session, concurrent open/close/logout, duplicate calls and failed initialization.

### G2-B — platform key storage and SQLCipher

- [x] Confirm Android Keystore and protected iOS Keychain adapters exist in main.
- [x] Confirm existing DB + missing key and DB/key mismatch fail closed in Rust client code.
- [ ] Review Keychain accessibility, synchronizability, backup/migration and device-only policy against the threat model.
- [ ] Review Android Keystore hardware-backed capability reporting, key invalidation, backup/restore and device-lock behavior.
- [ ] Verify SQLCipher key never appears in Dart, preferences, logs, crash reports, backups or plaintext files.
- [ ] Verify create/open/close/lock/unlock/process-kill/reboot and corruption recovery on physical Android and iOS.
- [ ] Verify logout and device revocation cleanup of DB, WAL/SHM/journal and protected key under success, network failure and secure-store failure.

### G2-C — Rust-owned session lifecycle

- [x] Confirm refresh-token ownership transfers to Rust after successful native session adoption.
- [x] Confirm resume path restores tokens from encrypted SQLCipher without Dart resupplying refresh token.
- [ ] Verify login handoff, restart resume, concurrent refresh, token rotation, expiry, replay rejection and 401/403 handling.
- [ ] Verify transient network failure does not discard the only valid refresh token.
- [ ] Verify logout clears in-memory tokens, SQLCipher session data and protected key even if remote logout fails.
- [ ] Verify process death during token rotation and recovery from partial/corrupt state.

### G2-D — MLS messaging and group state

- [x] Confirm Rust client exposes text send/sync, durable inbox/outbox, ACK, epochs, members and revocation APIs.
- [ ] Validate two independent devices through real backend: KeyPackage, group create/join, welcome, commit/epoch transitions, send/receive in both directions.
- [ ] Validate offline queue, reconnect, retry, duplicate/reorder, ACK, process kill and restart without message loss or duplicate delivery.
- [ ] Validate invalid signature, wrong group, replay, malformed ciphertext, stale epoch and revoked device all fail closed.
- [ ] Review OTR/ephemeral behavior only if explicitly included in Beta 1.0 scope; otherwise document deferred.

### G2-E — encrypted attachment vertical slice

- [ ] Port/review AES-256-GCM crypto core and versioned manifest from PR #57 as a focused change based on current main.
- [ ] Bind file key, nonce, filename, MIME, plaintext hash and plaintext size only inside the MLS-encrypted manifest.
- [ ] Keep backend/object storage limited to ciphertext, ciphertext hash/size, room and opaque file reference.
- [ ] Implement Rust send flow: CSPRNG key/nonce, encrypt, reserve/upload/complete ciphertext, then send manifest inside MLS application message.
- [ ] Implement SQLCipher persistence for manifests and retry journal; safe idempotency and payload-bound retries.
- [ ] Implement Rust download/decrypt flow: same-origin authenticated download, no redirects, ciphertext size/hash, AEAD tag, AAD, plaintext size/hash verification.
- [ ] Expose typed FRB/Dart methods; connect UI only after Rust and backend contract tests pass.
- [ ] Test tampering, truncation, wrong key/room/file, duplicate/reused message ID, partial upload, retry, large files and revoked-device access.
- [ ] Prove with backend/object-store evidence that plaintext and file keys never reach storage/logs.

### G2-F — device revocation and recovery

- [x] Confirm Rust client has device revoke and remove-revoked-device operations.
- [ ] Verify backend revocation, MLS group exclusion and epoch update across all affected groups.
- [ ] Verify a revoked device cannot send, sync, refresh, fetch ciphertext or decrypt future attachments.
- [ ] Verify local data on revoked device is deleted or cryptographically blocked per threat model.
- [ ] Verify recovery on a new device with confirmed factor and correct account/device binding.
- [ ] Test expired/replayed/wrong-account/no-network/partial-failure recovery and revocation cases.

### G2-G — release gate

- [x] Confirm native MLS feature flag defaults to false.
- [ ] Rust tests, FRB generation, Flutter analyze/tests and Android/iOS native builds PASS on one exact candidate SHA.
- [ ] Android Keystore and iOS protected Keychain tests PASS on physical devices.
- [ ] Two-device MLS message and encrypted-attachment E2E PASS.
- [ ] Device revocation and recovery positive/negative E2E PASS.
- [ ] Security review and threat-model update completed.
- [ ] Owner accepts G2 evidence on exact release-candidate SHA.
- [ ] Only after all prior boxes and owner approval, consider enabling the native MLS flag via a separate controlled change.

## 4. Immediate next implementation sequence

1. Finish a method-by-method review of current `mobile/rust/src/api/session.rs`, `secure_store.rs`, and the client lifecycle in `inone-engine-poc-0.6.0/mobile-mls/mls-client/src/lib.rs`.
2. Compare PR #57 and #59 against current main at file/function level; extract attachment crypto and transport changes only. Do not pull their old UI, engine-wide or unrelated history.
3. Write/approve the attachment manifest and backend object-store contract before implementing the missing attachment API.
4. Implement the attachment path in the persistent Rust client and FFI with tests; keep the app flag off.
5. Run exact-head CI, then schedule physical-device and two-device E2E. Do not declare G2 PASS before these.

## 5. Current evidence ledger

| ID | Current status | Evidence / exact baseline | Gap |
|---|---|---|---|
| G2-A-01 canonical client/FRB | IN PROGRESS | main `a174f794535ab09699d38292acb4919308873fd7`; `mobile/rust/Cargo.toml`, `mobile/rust/src/api/session.rs` | Full API and concurrency audit |
| G2-B-01 platform KeyStore | IN PROGRESS | main; `mobile/rust/src/secure_store.rs` | Physical device lifecycle and policy verification |
| G2-C-01 Rust session ownership | IN PROGRESS | main; `mobile/lib/core/session/inone_session.dart`, Rust session API | Full race/failure/restart matrix |
| G2-D-01 MLS messaging | IN PROGRESS | main; native MLS run [#44353252236](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44353252236) | Two-device end-to-end |
| G2-E-01 attachments | NOT STARTED | No attachment crypto module or attachment methods in current main client/FRB API | Port and integrate focused vertical slice |
| G2-F-01 revocation/recovery | IN PROGRESS | Rust revoke/remove APIs present in main | Backend + MLS + device E2E |
| G2-G-01 production gate | BLOCKED | `INONE_MLS_NATIVE_ENABLED=false` by default | All G2 gates and owner acceptance |

## 6. Safety decisions

- Keep `INONE_MLS_NATIVE_ENABLED=false`.
- Do not merge PR #57/#58/#59 wholesale or rebase their full divergent histories.
- Do not expose file keys, nonces, refresh tokens or SQLCipher keys to Dart.
- Do not allow backend/object storage to receive plaintext attachment metadata or file keys.
- Do not enable MLS or declare Beta 1.0 release acceptance based on CI alone.
