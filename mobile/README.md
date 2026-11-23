# InOne Beta 1.0 — native Flutter mobile application

> **A2 FRB reconciliation — 2026-11-19:** Initial audit is recorded in [the A2 report](../development/reports/2026-11-19-A2-frb-reconciliation-audit.md). The production adapter references generated files that are intentionally produced during the pinned bootstrap; actual generated symbols/types and clean-repeat determinism remain unverified. This audit is not A2 acceptance.

The production entry point is `lib/main.dart`, which launches `InOneMobileApp`. The native design system and screen components live under `lib/ui_dart_source/`. The previously approved HTML design package and 73-screen test gallery are retained only as references in `../мусорный ящик/HTML-архив/mobile-assets/`; they are not bundled as Flutter assets or loaded by the production app.

## Screen catalogue

- 43 native Dart UI source files containing the design system, reusable widgets, models, and screen components. The archived HTML package remains the visual reference baseline, not a runtime.
- 51 Beta 0.7.1 test screens.
- 1 deferred screen (CH-07, moved to 0.8).
- 21 future concepts: calendar, tasks, files, CRM, Sindy AI, stories, geolocation and Propo map integration.
- The original 73-screen HTML gallery is preserved in the archive for historical/reference comparison. It is not reconstructed or loaded by the native production app.

## API transport security

- Release builds require an HTTPS API origin. Configure it with `INONE_API_BASE_URL=https://your-api-host`.
- Plain HTTP is accepted only in debug builds and only for loopback or private-network hosts used by local development (including Android emulator `10.0.2.2` and a private LAN address).
- API origins containing embedded credentials, query strings or fragments are rejected.
- API clients do not follow redirects, preventing bearer credentials from being forwarded to a different origin.
- The Rust MLS client applies the same HTTPS/local-debug policy before sending or refreshing session credentials.

## Native Rust / Flutter bridge generation

The Stage 4 branch uses `flutter_rust_bridge` with the Native Assets backend. Generated bridge files are produced in the validation workspace and uploaded as an artifact; they are not committed automatically. CI workflows have read-only repository permissions and never push generated code or formatting changes. A clean checkout must run the pinned generation sequence locally before `flutter run`.

To reproduce the generation locally, use the same pinned sequence as `.github/workflows/openmls-frb-codegen.yml`:

```sh
cd mobile
flutter create --platforms=android,ios --project-name app --org com.inone .
rm -f test/widget_test.dart
cargo install --locked --version 2.13.0 flutter_rust_bridge_codegen
cp lib/main.dart /tmp/inone-main.dart
cp rust/src/api/mod.rs /tmp/inone-api-mod.rs
flutter_rust_bridge_codegen integrate \
  --rust-crate-dir rust \
  --rust-crate-name inone_mls_frb \
  --integration-backend native-assets \
  --platforms android,ios
cp /tmp/inone-main.dart lib/main.dart
cp /tmp/inone-api-mod.rs rust/src/api/mod.rs
rm -f rust/src/api/simple.rs lib/src/rust/api/simple.dart
flutter_rust_bridge_codegen generate
node tool/prepare_android_mls.mjs
node tool/prepare_ios_deep_links.mjs
flutter pub get
cargo generate-lockfile --manifest-path rust/Cargo.toml
flutter analyze
flutter test
flutter build apk --debug
```

This command sequence has not been executed in the current development environment. Its successful completion must be recorded against an exact source SHA before the bridge is accepted. The CI generation job uploads generated bindings, build hooks and lockfiles as artifacts only. A developer must review and commit generated files explicitly; CI does not modify any branch.

## Backend connection

The native Flutter app uses the local development backend by default in debug builds; no public URL is required.

- Android emulator: `http://10.0.2.2:8080` (the host computer's port 8080).
- iOS simulator / desktop: `http://127.0.0.1:8080`.
- Physical device: pass the host computer's private LAN address explicitly.

Run the backend from `../inone-engine-poc-0.6.0` on port `8080` using its development instructions, then start the app:

```sh
cd mobile
flutter pub get
flutter run
```

If the backend listens on another host or port, override the default without changing source code:

```sh
flutter run --dart-define=INONE_API_BASE_URL=http://192.168.1.20:8080
```

The LAN address above is an example only. Keep the backend bound to the local development network; do not expose it publicly. Never commit credentials or tokens.

The API panel provides:
- Email/password login against `POST /login`.
- A one-time login handoff transfers the refresh-token pair to the persistent Rust client; Dart keeps only a short-lived access-token snapshot.
- Rust performs serialized refresh after an authenticated 401 through `POST /token/refresh`.
- Logout through `POST /logout`.
- Read-only GET probes for routes that are present in the current main-branch backend, including `/healthz` and `/readyz` connectivity checks.
- JSON response/error output for QA.

The stable device identifier and selected app locale are persisted using platform secure storage. When the native MLS bridge is explicitly enabled, the refresh token is handed to the Rust client and Dart retains only a short-lived access-token snapshot in memory. The bridge remains disabled by default; session credentials are never passed to UI widgets or JavaScript.

### In-app language and email locale

`InOneSession` supports `hy`, `ru`, and `en`, persists the selected locale in platform secure storage, sends it with verified email registration, and synchronizes it with the authenticated profile through `PATCH /profile/locale`. The native profile menu now exposes the supported `hy`, `ru`, and `en` choices and persists an authenticated change through `PATCH /profile/locale`; the app does not infer the account language from the operating system.

### Personal profile API integration

Selecting either approved personal-profile variant performs an authenticated `GET /profile` through the existing `InOneSession` and `InOneRepositories` path. The returned nickname, email, and verification level update the matching identity fields in the bundled original profile screen. The existing session remains the sole owner of access/refresh tokens and handles one refresh retry after a 401.

The update is limited to the currently selected profile section of the approved local Flutter asset. Main-frame navigation to other origins is blocked, the update writes text with `textContent`, and no JavaScript channel or credentials are exposed. On logout or leaving the profile screen, identity fields are cleared. The sample task/activity/project counts remain visible as labels but show `—` because `/profile` does not provide those values.

Loading, unauthenticated, empty-profile, and error states are rendered by native Flutter widgets through `InOneActionState` and `InOneStatusScope`; the production app no longer hosts or replaces a WebView page.

## Current integration boundary

- The native shell connects login, email registration, recovery, profile, organization membership, public configuration and the authenticated room directory to existing Beta 1.0 contracts. `GET /rooms/mine` populates the native messages list even while native MLS is disabled; room contents, sending and attachment operations remain unavailable unless the canonical Engine B session is explicitly enabled. Organization profile/workspace member counts are read from `GET /orgs/:id/members`. Screens without a verified Beta 1.0 backend/native capability remain unreachable or explicitly blocked; UI previews do not fabricate successful actions.
- The original 73-screen HTML gallery is retained only in the archive. CI checks approved HTML geometry from the archive, removes temporary imported HTML assets before Flutter analysis/tests, and verifies the native-only runtime boundary.
- Generic API probing is read-only. POST/PUT/DELETE actions require dedicated forms, validated payloads and explicit confirmation.
- `MlsSessionBridge` has a production `RustMlsSessionBridge` adapter over generated `flutter_rust_bridge` bindings. `INONE_MLS_NATIVE_ENABLED` defaults to `false` and remains opt-in until the owner accepts the Android/iOS runtime, persistence, recovery and security gates on the exact tested commit. When explicitly enabled, `InOneSession` transfers the refresh-token pair once to Rust and retains only a short-lived access-token snapshot in Dart; subsequent refreshes are Rust-owned. If Rust handoff fails, the mobile login fails closed, attempts server logout, clears Dart credentials and removes the resumable user marker; there is no Dart refresh fallback.
- The Rust runtime stores MLS group state and the device session in SQLCipher. The 32-byte database key is held in Android Keystore-backed storage or Apple's protected Keychain store; the key is never exposed to Dart UI components or application logs. The database lives in the app-private support directory.
- The native bridge exposes key-package maintenance, room creation/invites, encrypted text, G2 attachment send/download, inbox sync, offline outbox, epoch/member inspection, device revocation, refresh, close and local purge. Attachment bytes are AES-256-GCM encrypted before upload; the manifest travels only inside MLS, the SQLCipher attachment journal/outbox preserves retry identity, and downloads are authenticated and device-bound. Decrypted incoming messages remain pending across restart until Flutter explicitly acknowledges durable acceptance; acknowledgement changes delivery state but retains encrypted room history for later reads.
- Logout destroys the local SQLCipher database, its journal/WAL sidecars and the platform key even when server logout cannot be confirmed. A failed resume can still invoke local purge. No plaintext or Megolm fallback is permitted when native MLS is unavailable.
- The current CI is read-only and uses no signing secrets. It generates the Rust bridge, runs Flutter analysis/tests, builds Android, and builds unsigned iOS device/simulator targets. This does not prove runtime Keychain behavior on a signed iOS device; that still requires a real-machine acceptance test.
- Recovery confirmation now supports the `inone://recovery/confirm?user=...&token=...&locale=...` scheme. Android/iOS project preparation scripts register the scheme. The HTTPS preview page is non-mutating, localized, and sent with no-store/referrer protections; only an explicit app launch or POST confirms recovery. This custom scheme is for Beta 1 testing. Before production release, replace it with verified Android App Links / iOS Universal Links using the actual public domain and signing association files.

## Remaining Beta 1 acceptance blockers

- Production entry point is now `lib/main.dart` → `InOneMobileApp`, with the Dart UI source set under `lib/ui_dart_source/`. The WebView dependency and active HTML assets have been removed from the Flutter package; the 219 HTML/reference files are preserved under `../мусорный ящик/HTML-архив/mobile-assets/`. The G1 native UI migration remains under review until exact-head Flutter tests/builds and screen-parity checks pass.
- The native Rust MLS bridge exposes session, room, encrypted text, inbox/outbox, device operations and G2 encrypted attachment APIs. The native shell preserves the opt-in `INONE_MLS_NATIVE_ENABLED` session handoff (default false). The authenticated `/rooms/mine` list is displayed without enabling MLS; message history, sync, sending and attachment operations remain gated by the native Engine B session and the outstanding Android/iOS runtime, recovery, security and two-device acceptance.
- G2 encrypted attachment transfer is implemented in canonical Engine B and exposed through the Flutter/Rust bridge. It remains unavailable in the product while native MLS is disabled and until Android/iOS runtime, recovery, security and two-device acceptance gates pass. There is no plaintext fallback.
- Provider OAuth callback handling is not yet connected in the active Flutter flow.
- The recovery custom scheme is implemented for Beta 1 testing; verified production Universal/App Links still require the real domain and platform association metadata.

## Recovery deep links and remaining acceptance blockers

- Beta 1 testing supports `inone://recovery/confirm?user=...&token=...&locale=...`. Android/iOS preparation scripts register the scheme. The HTTPS preview page is non-mutating, localized and uses no-store/referrer protections; only an explicit app launch or POST confirms recovery. The unverified custom scheme is hidden in production; production requires verified Android App Links / iOS Universal Links with the actual public domain and association metadata.
- The native Dart shell is now the production entry point. Provider authentication remains blocked until native provider callbacks are implemented; message history and sending remain blocked until the native MLS and encrypted-persistence acceptance gates pass.
- When `INONE_MLS_NATIVE_ENABLED` is explicitly enabled, the active chat UI uses the Engine B Rust bridge for room history, inbox synchronization, durable text outbox and encrypted attachment send/download. These operations remain opt-in and are not runtime-accepted until the Android/iOS, recovery, security and two-device gates pass. No plaintext fallback is permitted. Provider OAuth callback handling is also not connected in the active Flutter flow.

## Tests

```sh
cd mobile
flutter test
flutter analyze
```

Tests cover API transport, typed repositories, session locale/logout, MLS handoff, recovery deep-link parsing and confirmation, registration tickets, and native login-shell rendering. Archived HTML geometry and native-runtime isolation are checked separately by CI scripts.


## Backend deployment note

The current engine deployment guide describes the checked-in server build as development/test, not production-ready. SMTP/domain delivery, SMS where required, deployment/proxy validation, backup/restore and monitoring still need operational acceptance. Use a controlled staging API until those items are closed.


## Firebase platform configuration status

The repository-root Firebase client files are validated and copied by `tool/generate_flutter_platforms.sh` into the generated native projects on every run. Android receives `android/app/google-services.json`; iOS receives `ios/Runner/GoogleService-Info.plist`. The helper rejects missing files or mismatched Firebase project/App IDs and package/bundle identifiers before platform builds. See [platform identifier and Firebase configuration details](PLATFORM-IDENTIFIERS.md).

**Integration status:** Firebase Core and Firebase Messaging runtime initialization, FCM permission/FID registration, receive/tap lifecycle and MLS-gated navigation are implemented in this branch. End-to-end delivery is not yet accepted until FCM/APNs physical-device smoke tests pass. Do not log FCM/APNs identifiers or commit Firebase Admin service-account credentials or APNs private keys.

## Firebase Messaging runtime

- `main.dart` initializes Firebase Core from the generated Android/iOS native configuration before creating the app.
- After an authenticated session is restored or created, `InOnePushLifecycle` requests notification permission, waits for an APNs token on iOS, obtains the Firebase Installation ID (FID), and registers it through the existing authenticated `InOnePushRepository` (`PUT /devices/me/push`).
- Firebase Installation ID registration refreshes are synchronized to the same current-device endpoint. Explicit logout attempts `DELETE /devices/me/push` before logout; backend logout and device revocation remain authoritative cleanup paths.
- FIDs are not written to Flutter storage, analytics, or logs. Denied permission removes any prior server registration. iOS registration is retried when the app resumes if APNs registration was not ready.
- InOnePushReceiveLifecycle handles foreground messages, notification taps and terminated launches. It validates the room/event route, waits for an authenticated session, verifies room membership through the server and displays content only after native MLS decryption. If native MLS is not active, it safely returns to Chats without exposing ciphertext or plaintext.
- Native generation installs the Google Services Gradle plugin, sets Android minSdk to 24 for Firebase Messaging 26.x and adds Android permissions; on iOS it embeds `GoogleService-Info.plist`, adds the APNs entitlement and remote-notification background mode.
- iOS delivery still requires an Apple Developer App ID with Push Notifications enabled and the APNs authentication key uploaded to Firebase. The repository's push sender is not implemented yet, so this client work registers devices but does not claim end-to-end notification delivery.
