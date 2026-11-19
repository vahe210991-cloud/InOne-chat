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
