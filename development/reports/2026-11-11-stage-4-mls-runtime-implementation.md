# Stage 4 — Native MLS runtime implementation report

**Date:** 2026-11-11  
**Branch:** `feature/stage-4-native-mls-runtime-2026-11-11`  
**Pull request:** #45  
**Acceptance status:** implementation submitted; CI/device acceptance pending  
**Main:** unchanged

## Delivered implementation

### Flutter ↔ Rust session lifecycle
- Added the production `RustMlsSessionBridge` adapter over generated `flutter_rust_bridge` bindings.
- `InOneSession` automatically hands a successful login to native Rust MLS and resumes the native session after app restart.
- The refresh-token pair is transferred once; Flutter retains only a short-lived access-token snapshot for ordinary authenticated API calls.
- A failed native MLS handoff is visible in the app. It does not enable plaintext or Megolm fallback.
- Logout attempts server revocation and independently purges the local database and platform key. A failed resume can still invoke local purge.

### Platform key storage and encrypted persistence
- SQLCipher stores MLS state, device session credentials, offline outbox and decrypted incoming message history.
- The 32-byte SQLCipher key is generated and retained in Android Keystore-backed storage or Apple's protected Keychain store.
- The key is never exposed through the Dart bridge or WebView.
- The database is kept under the application-private support directory.
- Incoming plaintext is persisted inside SQLCipher before it is marked processed. Pending inbox entries survive restart until explicitly acknowledged; acknowledgement retains encrypted local room history.
- Logout removes the database and its `-wal`, `-shm` and `-journal` sidecars before deleting the platform key.

### Native API surface
The Dart bridge exposes:
- Key Package maintenance.
- Room creation and participant invitation.
- MLS encrypted text send and offline enqueue.
- Sync, pending inbox, acknowledgement and local room history.
- Outbox flush and pending count.
- Local epoch and member inspection.
- Device revocation and revoked-device cleanup.
- Native token refresh, session close, remote logout and local purge.

## Regression coverage added

### Rust MLS client / real engine
- Offline outbox survives process restart and flushes exactly once.
- Decrypted inbox survives restart until explicit acknowledgement.
- Acknowledged messages remain available in encrypted local room history.
- Tests inspect the SQLCipher database and sidecars to ensure queued and decrypted plaintext is not present as cleartext.
- Existing encryption, token rotation, Welcome, sync, membership, retry and multi-device tests remain in the suite.

### Rust FFI
- Logout removes the encrypted database, WAL/SHM/journal sidecars and platform key.
- Close releases the native handle without deleting persistent session data.

### Flutter
- Login automatically adopts the native session.
- Failed adoption is visible and does not activate a messaging fallback.
- Failed session resume still permits an explicit local purge.

### Native platform integration
- Android emulator smoke test opens a session, closes it, resumes using the protected key, then purges and verifies that resume fails.
- iOS device and simulator native build checks are configured.
- iOS protected Keychain runtime smoke test is conditional on repository signing secrets because Apple's protected store requires an appropriately code-signed app and provisioning profile.

## CI workflows

- `.github/workflows/openmls-client.yml`: Rust MLS client against the real Node engine; includes outbox/inbox restart and SQLCipher plaintext checks.
- `.github/workflows/openmls-frb-codegen.yml`: FRB generation, Rust FFI tests, Flutter analyze/test, Android APK build, Android emulator Keystore smoke test, iOS device/simulator builds, and conditional iOS Keychain runtime test.
- `.github/workflows/flutter-mobile.yml`: the general Flutter workflow is intentionally skipped for this branch to avoid racing the FRB generation job; the stage-specific workflow runs the complete Flutter checks.

## Current validation blocker

The first push-triggered runs on this branch were:
- OpenMLS client validation: run `42975275190`
- OpenMLS Flutter Rust Bridge generation: run `42975275038`

Both jobs terminated before the first workflow step, with no runner assigned, zero billable runtime and no downloadable job logs. This is an Actions execution/runner-allocation blocker, not an observed test assertion failure. The jobs must be rerun successfully before acceptance can be claimed.

## iOS signing prerequisite

To execute the iOS protected-Keychain runtime smoke test, configure these repository secrets:
- `IOS_SIGNING_CERTIFICATE_P12` — base64-encoded signing certificate.
- `IOS_SIGNING_CERTIFICATE_PASSWORD` — certificate password.
- `IOS_PROVISIONING_PROFILE` — base64-encoded provisioning profile for `com.inone.inone_mobile`.
- `IOS_TEAM_ID` — Apple Developer Team ID.

Without those secrets, iOS compilation still runs, but the protected-Keychain runtime test is explicitly reported as deferred.

## Acceptance gate

Stage 4 must remain open until all applicable checks pass on the same PR head:
1. Rust MLS client + real engine integration suite.
2. Rust FFI unit tests and native target compilation.
3. Flutter analyze and unit/widget tests.
4. Android native build and Keystore runtime smoke test.
5. iOS device and simulator builds.
6. Signed iOS protected-Keychain runtime smoke test.
7. SQLCipher inbox/outbox restart and no-plaintext assertions.

No merge to `main` is included in this work.
