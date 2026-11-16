# InOne Beta 1.0 — unified screen and API test host

The Flutter host now exposes the 22 owner-approved visual variants and the complete 73-entry test-screen catalogue in one searchable picker (95 selectable entries total).

## Screen catalogue

- 22 approved HTML screen variants: 11 light and 11 dark. These retain the existing approved HTML asset and WebView presentation.
- 51 Beta 0.7.1 test screens.
- 1 deferred screen (CH-07, moved to 0.8).
- 21 future concepts: calendar, tasks, files, CRM, Sindy AI, stories, geolocation and Propo map integration.
- The 73 additional screens now load from the original owner-provided full-screen design gallery v0.8. The HTML is packaged as deterministic gzip/base64 text parts and reconstructed in memory without rewriting the source. Each Flutter catalogue ID selects its matching original gallery card.

## API transport security

- Release builds require an HTTPS API origin. Configure it with `INONE_API_BASE_URL=https://your-api-host`.
- Plain HTTP is accepted only in debug builds and only for loopback or private-network hosts used by local development (including Android emulator `10.0.2.2` and a private LAN address).
- API origins containing embedded credentials, query strings or fragments are rejected.
- API clients do not follow redirects, preventing bearer credentials from being forwarded to a different origin.
- The Rust MLS client applies the same HTTPS/local-debug policy before sending or refreshing session credentials.

## Native Rust / Flutter bridge generation

The Stage 4 branch uses `flutter_rust_bridge` with the Native Assets backend. At the current source revision, generated bridge files are not yet committed: `lib/src/rust/`, `hook/build.dart`, `rust/src/frb_generated.rs` and `rust/Cargo.lock` are produced by the generation workflow. Therefore a clean checkout cannot use only `flutter pub get` / `flutter run` until generation has completed.

To reproduce the generation locally, use the same pinned sequence as `.github/workflows/openmls-frb-codegen.yml`:

```sh
cd mobile
flutter create --platforms=android,ios --project-name inone_mobile --org com.inone .
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
flutter pub get
cargo generate-lockfile --manifest-path rust/Cargo.toml
flutter analyze
flutter test
flutter build apk --debug
```

This command sequence has not been executed in the current development environment. Its successful completion must be recorded against an exact source SHA before the bridge is accepted. The CI generation job is intended to commit generated bindings, build-hook files and lockfiles back to the Stage 4 branch.

## Backend connection

The Flutter test host uses the local development backend by default; no public URL is required.

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
- In-memory access and refresh token handling.
- One serialized refresh attempt after an authenticated 401, using `POST /token/refresh`.
- Logout through `POST /logout`.
- Read-only GET probes for routes that are present in the current main-branch backend, including `/healthz` and `/readyz` connectivity checks.
- JSON response/error output for QA.

Only the stable device identifier and selected app locale are persisted, using platform secure storage. Access and refresh tokens remain in memory and are never passed into WebView JavaScript.

### In-app language and email locale

The host provides an Armenian / Russian / English language selector. The selected locale is persisted in platform secure storage, sent with verified email registration, and synchronized to the authenticated profile through `PATCH /profile/locale`. On a fresh device, the stored profile locale is loaded after authentication. The backend uses this same locale for registration and all subsequent account-security emails; it does not derive mail language from the operating system.

### Personal profile API integration

Selecting either approved personal-profile variant performs an authenticated `GET /profile` through the existing `InOneSession` and `InOneRepositories` path. The returned nickname, email, and verification level update the matching identity fields in the bundled original profile screen. The existing session remains the sole owner of access/refresh tokens and handles one refresh retry after a 401.

The update is limited to the currently selected profile section of the approved local Flutter asset. Main-frame navigation to other origins is blocked, the update writes text with `textContent`, and no JavaScript channel or credentials are exposed. On logout or leaving the profile screen, identity fields are cleared. The sample task/activity/project counts remain visible as labels but show `—` because `/profile` does not provide those values.

Loading, unauthenticated, empty-profile, and error states appear in a native banner without replacing the WebView or changing the approved screen design. Use the profile refresh action to fetch the latest account summary.

## Current integration boundary

- The personal-profile identity fields are connected to the authenticated profile API; other approved screens remain visual previews and their HTML demo controls are not wired to production actions.
- The 73 test entries use the original full-screen HTML gallery. The gallery asset integrity test checks all 73 card IDs against the Flutter catalogue.
- Generic API probing is read-only. POST/PUT/DELETE actions require dedicated forms, validated payloads and explicit confirmation.
- `MlsSessionBridge` has a production `RustMlsSessionBridge` adapter over generated `flutter_rust_bridge` bindings. The app only constructs this adapter when `INONE_MLS_NATIVE_ENABLED=true` is supplied at build time. The flag defaults to `false` and must remain disabled until the complete Android/iOS native runtime, secure-store, persistence and device-test acceptance gate is green. When enabled, `InOneSession` adopts a successful login, transfers the refresh-token pair once, and retains only a short-lived access-token snapshot in Dart; on restart it resumes from Rust-owned encrypted storage.
- The Rust runtime stores MLS group state and the device session in SQLCipher. The 32-byte database key is held in Android Keystore-backed storage or Apple's protected Keychain store; the key is never exposed to Dart or WebView. The database lives in the app-private support directory.
- The native bridge exposes key-package maintenance, room creation/invites, encrypted send, inbox sync, offline outbox, epoch/member inspection, device revocation, refresh, close and local purge. Decrypted incoming messages are persisted in a SQLCipher inbox and remain pending across restart until Flutter explicitly acknowledges durable acceptance; acknowledgement changes delivery state but retains encrypted room history for later reads.
- Logout destroys the local SQLCipher database, its journal/WAL sidecars and the platform key even when server logout cannot be confirmed. A failed resume can still invoke local purge. No plaintext or Megolm fallback is permitted when native MLS is unavailable.
- Stage 4 is not accepted until Rust/Flutter regression suites, Android Keystore runtime smoke tests, iOS native device/simulator builds and signed iOS Protected Keychain runtime validation pass on the same PR head. The current workflow now runs the signing job behind the GitHub Environment `ios-signing`; configure that environment with required reviewers and these environment secrets: `IOS_SIGNING_CERTIFICATE_P12` (base64-encoded P12), `IOS_SIGNING_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE` (base64-encoded profile) and `IOS_TEAM_ID`. The job validates the profile team, bundle identifier, keychain-access-groups entitlement and expiry, configures manual signing, runs the iOS simulator smoke test, and verifies the resulting app signature/entitlements. This workflow change is source-reviewed but not yet executed. Missing signing secrets fail the iOS job; a skipped or unsigned test is not a pass. Never paste certificate or profile contents into chat.

## Tests

```sh
cd mobile
flutter test
flutter analyze
```

The tests assert the 22 approved variants, 73 test entries, the 51/1/21 stage split, 95 unique picker entries, the API transport contract and the Flutter-to-native session handoff contract.


## Backend deployment note

The current engine deployment guide describes the checked-in server build as development/test, not production-ready. SMTP/domain delivery, SMS where required, deployment/proxy validation, backup/restore and monitoring still need operational acceptance. Use a controlled staging API until those items are closed.
