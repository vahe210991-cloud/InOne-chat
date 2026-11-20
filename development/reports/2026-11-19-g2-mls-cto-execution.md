# Follow-up — 2026-11-20

## PR stack status (verified from GitHub)

- PR #57 is merged (merge commit `77eac10e5a1a8b6b0cce7b6a7fbbbe0681e3b39f`) into `feat/flutter-ui-dart-migration-2026-11-14`, not directly into `main`.
- PR #58 is merged (merge commit `54313a6672d951f002fa17c919e37b04e6f9eedc`) into the same feature branch. Its description records the dependency on #57.
- PR #59 remains open and Draft. It targets `feat/flutter-ui-dart-migration-2026-11-14`, not `main`; its head is `01841ab332aae1274a4926128986885a3e1da2dc`. Existing Native MLS and Flutter workflow runs for that exact head succeeded, but the branch is heavily diverged from current `main` and must not be merged wholesale.
- PR #90 remains open and Draft, targets `main`, and is the controlled G2 integration track. Its original head had failing Flutter mobile and iOS analysis jobs. The main branch has advanced since PR #90 was opened; the PR still needs an explicit base synchronization/conflict-resolution step before mergeability can be accepted.

## Exact-head Flutter fixes committed

Code fixes were committed to this PR branch before this report update (code head: `1782a7845b0a51054fb52d064e44538709590022`):

- Use the `file_picker` 11 static API: `FilePicker.pickFiles()` and `FilePicker.saveFile()`; the old `.platform` API was removed in v11.
- Request in-memory file bytes from the picker and pass the selected bytes into the encrypted MLS attachment flow, avoiding a path-only read assumption on mobile.
- Rename the incoming pending inbox collection so it no longer collides with the outgoing SQLCipher outbox variable; acknowledge incoming `eventId` values only from the incoming-message collection.
- Pass the download callback through to each thread item so attachment downloads are reachable from the UI.
- Remove two analyzer-reported redundant `dart:typed_data` imports.

## Validation status after these changes

- The previous CI failure logs were reviewed. They showed four compile/analyzer errors plus four analyzer warnings/info items; the changes above address those exact findings.
- The earlier successful Rust/MLS and backend runs belong to the previous source SHA and are not evidence that the updated SHA passes.
- No successful test result is claimed for the updated SHA yet. Re-run Flutter mobile, iOS, native MLS and backend workflows on the exact current head. Verify generated FRB bindings remain unchanged or regenerate them using the pinned 2.13.0 toolchain if required.
- The GitHub connector can commit repository contents but cannot dispatch a workflow directly. Use a normal authenticated Git push or reopen/synchronize the PR to trigger the configured `pull_request` workflows; do not substitute a rerun of the old failed SHA for exact-head validation.
- A reopen cycle on PR #90 and a temporary draft validation PR #108 at the same exact head did not create Actions runs. PR #108 was closed after this check. A regular authenticated Git push from the user's machine or an authorized workflow-dispatch action is now required to execute CI; no tests have been run on the updated SHA in this session.

## Next required work

1. Run `flutter analyze`, Flutter unit/widget tests and Android build on the exact updated head.
2. Run the iOS simulator build and Keychain smoke workflow on that same head.
3. Run locked Rust format/check/tests, canonical engine attachment integration tests, and backend file authorization regressions.
4. Inspect all jobs and logs; fix any new failures and rerun until all required checks pass on one SHA.
5. Synchronize PR #90 with the current `main` (now `e629fd35a53147f8372fc5e2bd52ab042a23e766`) and resolve conflicts without dropping the P0 changes already merged to main. Recheck mergeability afterward.
6. Keep PR #59 unmerged until its changes are reconciled with the G2 branch. Do not retarget it or merge the 809-commit divergent stack wholesale.
7. Keep `INONE_MLS_NATIVE_ENABLED=false` until CI and physical Android/iOS acceptance gates pass.

---

# InOne Beta 1.0 — G2 MLS CTO execution

Date: 2026-11-19  
Base: `main` at `a174f794535ab09699d38292acb4919308873fd7`  
Working branch: `fix/g2-mls-ffi-hardening-2026-11-19`  
Pull request: [#90](https://github.com/vahe210991-cloud/InOne-chat/pull/90) — Draft, not merged  
Feature flag: `INONE_MLS_NATIVE_ENABLED=false` remains the default.

## Executive decision

Preserve the existing persistent Rust/OpenMLS client, SQLCipher database and Flutter Rust Bridge architecture. Do not replace OpenMLS, duplicate the session runtime, or merge stacked PRs #57–#59 wholesale. Complete the mobile integration in small, independently validated changes.

The G2 release gate is a single exact source SHA passing all required CI jobs, followed by physical Android and iOS acceptance. CI builds are not evidence of physical-device acceptance.

## Execution record

### Completed in PR #90; acceptance pending exact-head CI

- [x] Add a panic-safe Rust FFI guard for session construction, resume, purge and logout cleanup.
- [x] On panic inside a live MLS client operation, close the client and require an explicit reopen rather than reuse uncertain OpenMLS state.
- [x] Recover a poisoned session mutex fail-closed and clear the poisoned state after discarding the client.
- [x] Canonicalize and validate the application-private SQLCipher directory before deriving the identity-scoped database path.
- [x] Bind each signed object-download URL to the authenticated user and device.
- [x] Require a live active bearer session on every object GET.
- [x] Re-check current room membership or private-file ownership on every download.
- [x] Prevent untrusted Host headers from being reflected into generated file URLs.
- [x] Add regression coverage for panic handling, path validation, anonymous downloads, cross-device URL use, device revocation, room-member removal and Host spoofing.
- [ ] A1 accepted only after Rust format/check/test and all relevant exact-head CI jobs pass.

## Microstep plan and exit criteria

### A — Persistent Rust runtime and FFI

**A1 — FFI hardening (implemented; CI pending)**
- `cargo fmt --check`
- `cargo check --locked --all-targets --manifest-path mobile/rust/Cargo.toml`
- `cargo test --locked --no-fail-fast --manifest-path mobile/rust/Cargo.toml`
- Confirm errors never include token or key material; panic closes the affected client.

**A2 — Flutter Rust Bridge generation parity**
- Run the pinned `flutter_rust_bridge_codegen 2.13.0` integration and generation on the PR head.
- Compare generated Rust/Dart bindings and native-assets integration with committed files.
- Fail CI if generation changes committed bindings unexpectedly.
- Confirm Dart signatures match the Rust API; no refresh-token, SQLCipher-key or MLS-private-key getter is exposed.

**A3 — One persistent runtime**
- Trace application bootstrap, authentication, resume, chat send/sync, logout and account switching.
- Confirm exactly one production `MlsSessionBridge` implementation is injected.
- Confirm no temporary/in-memory MLS client is reachable from production paths.
- Keep fallback disabled and fail closed when native MLS is unavailable.

### B — Protected storage

**B1 — Android Keystore / iOS Keychain**
- Verify key generation, read, existence and delete operations.
- Verify access-control and device-only persistence semantics for both platforms.
- Verify app restart, locked device, unavailable store, reinstall and OS restore behavior.
- Never silently generate a replacement key for an existing encrypted database.

**B2 — SQLCipher lifecycle**
- Verify new DB creation, reopen, wrong-key rejection and missing-key behavior.
- Verify WAL/SHM/journal handling and transaction durability after process interruption.
- Verify database files remain in app-private support storage and are never exported to logs/backups unintentionally.

**B3 — Logout and revocation cleanup**
- Verify remote logout attempt and unconditional local cleanup semantics.
- Verify DB and sidecars are removed even when remote logout or platform key-store initialization fails.
- Verify key deletion failures are reported as unconfirmed, not successful.
- Verify device revocation removes the local MLS state through the approved lifecycle.

### C — Session handoff

**C1 — Flutter → Rust handoff and resume**
- Confirm access/refresh tokens are passed to Rust once on initial adoption.
- Confirm refresh token remains Rust-owned and is not returned to Dart.
- Confirm restart resumes from SQLCipher without Flutter credentials.
- Confirm failed resume cannot leave a parallel Dart-owned authenticated session.

**C2 — Refresh-token rotation**
- Test concurrent 401 responses, one-time refresh rotation, reused refresh tokens, expired refresh tokens, network timeout and server rejection.
- Confirm exactly one refresh operation wins and no token pair is partially persisted.
- Confirm revoked devices cannot refresh or access files.

### D — MLS message exchange

**D1 — Two-device group lifecycle**
- Two independent device identities and SQLCipher databases.
- KeyPackage publication and claim, room creation, invite, Welcome acceptance, Commit processing and epoch convergence.
- Add/remove member and add/remove device scenarios.
- Confirm both sides agree on epoch and membership after each commit.

**D2 — Durability and recovery**
- Offline sender/receiver, reconnect, outbox retry and idempotency.
- Duplicate event delivery, ACK after durable acceptance, process kill during persistence and restart.
- Corrupt/unreadable event quarantine and room-scoped recovery-required behavior.
- No message loss or duplicate application after retry.

### E — Encrypted attachments

**E1 — Authorization and transport**
- The download authorization fix is implemented in PR #90; acceptance is pending tests.
- Verify a signed URL without bearer token returns 401.
- Verify another device token cannot use the URL.
- Verify revocation immediately invalidates the old device token/link.
- Verify room-member removal immediately blocks an existing link.
- Verify URL origin is not controlled by Host headers.
- Verify redirects do not forward bearer tokens to another origin.

**E2 — End-to-end encrypted attachment pipeline**
- Review PR #57 crypto primitives and PR #59 pipeline as source material only.
- Port AES-256-GCM manifest/encryption/decryption into the persistent Rust client.
- Persist file key/nonce/manifest and retry journal only inside SQLCipher.
- Upload ciphertext only; put the manifest/key material only inside an MLS application message.
- Receive/decrypt only after membership, room/file binding, size, hash and AEAD checks.
- Integrate narrow FFI methods and Flutter attachment UI/service after Rust integration tests pass.
- Test interrupted upload, expired upload capability, uncertain server response, idempotent retry, tampered ciphertext/manifest, wrong room, removed member and revoked device.
- Prove plaintext and attachment keys are absent from server storage, logs and transport traces.

## Exact validation gates

1. Rust format, locked check and unit/integration tests.
2. Canonical backend Node tests, including file authorization regressions.
3. Flutter Rust Bridge regeneration parity.
4. Flutter analyze and unit/widget tests.
5. Android debug build and Android emulator Keystore runtime smoke test.
6. iOS device-target and simulator builds plus iOS Keychain runtime coverage where available.
7. Two independent physical devices for final acceptance.
8. One final exact SHA with all checks green; no cherry-pick drift between tested and reviewed code.

## Release policy

- Do not merge PR #90 while any required check is pending or red.
- Do not merge PRs #57–#59 wholesale.
- Do not enable `INONE_MLS_NATIVE_ENABLED` before all G2 gates pass.
- Do not describe emulator/CI success as physical-device success.
- Keep Beta 2.0 work out of this scope.
