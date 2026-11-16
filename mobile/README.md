# InOne Beta 1.0 — unified screen and API test host

The current QA host exposes the 22 owner-approved visual variants and the 73-entry test-screen catalogue in one searchable picker (95 selectable entries total). It is still a WebView-based HTML test host, not the final native Dart production UI.

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

The Stage 4 branch uses `flutter_rust_bridge` with the Native Assets backend. Generated bridge files are produced in the validation workspace and uploaded as an artifact; they are not committed automatically. CI workflows have read-only repository permissions and never push generated code or formatting changes. A clean checkout must run the pinned generation sequence locally before `flutter run`.

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
node tool/prepare_ios_deep_links.mjs
flutter pub get
cargo generate-lockfile --manifest-path rust/Cargo.toml
flutter analyze
flutter test
flutter build apk --debug
```

This command sequence has not been executed in the current development environment. Its successful completion must be recorded against an exact source SHA before the bridge is accepted. The CI generation job uploads generated bindings, build hooks and lockfiles as artifacts only. A developer must review and commit generated files explicitly; CI does not modify any branch.

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
- A one-time login handoff transfers the refresh-token pair to the persistent Rust client; Dart keeps only a short-lived access-token snapshot.
- Rust performs serialized refresh after an authenticated 401 through `POST /token/refresh`.
- Logout through `POST /logout`.
- Read-only GET probes for routes that are present in the current main-branch backend, including `/healthz` and `/readyz` connectivity checks.
- JSON response/error output for QA.

The stable device identifier and selected app locale are persisted using platform secure storage. The refresh token is held by the Rust client in SQLCipher; Dart retains only a short-lived access-token snapshot in memory. No credentials are passed into WebView JavaScript.

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
- `MlsSessionBridge` has a production `RustMlsSessionBridge` adapter over generated `flutter_rust_bridge` bindings. `INONE_MLS_NATIVE_ENABLED` defaults to `false` and remains opt-in until the owner accepts the Android/iOS runtime, persistence, recovery and security gates on the exact tested commit. When explicitly enabled, `InOneSession` transfers the refresh-token pair once to Rust and retains only a short-lived access-token snapshot in Dart; subsequent refreshes are Rust-owned. If Rust handoff fails, the mobile login fails closed, attempts server logout, clears Dart credentials and removes the resumable user marker; there is no Dart refresh fallback.
- The Rust runtime stores MLS group state and the device session in SQLCipher. The 32-byte database key is held in Android Keystore-backed storage or Apple's protected Keychain store; the key is never exposed to Dart or WebView. The database lives in the app-private support directory.
- The native bridge exposes key-package maintenance, room creation/invites, encrypted send, inbox sync, offline outbox, epoch/member inspection, device revocation, refresh, close and local purge. Decrypted incoming messages are persisted in a SQLCipher inbox and remain pending across restart until Flutter explicitly acknowledges durable acceptance; acknowledgement changes delivery state but retains encrypted room history for later reads.
- Logout destroys the local SQLCipher database, its journal/WAL sidecars and the platform key even when server logout cannot be confirmed. A failed resume can still invoke local purge. No plaintext or Megolm fallback is permitted when native MLS is unavailable.
- The current CI is read-only and uses no signing secrets. It generates the Rust bridge, runs Flutter analysis/tests, builds Android, and builds unsigned iOS device/simulator targets. This does not prove runtime Keychain behavior on a signed iOS device; that still requires a real-machine acceptance test.
- Recovery confirmation now supports the `inone://recovery/confirm?user=...&token=...&locale=...` scheme. Android/iOS project preparation scripts register the scheme. The HTTPS preview page is non-mutating, localized, and sent with no-store/referrer protections; only an explicit app launch or POST confirms recovery. This custom scheme is for Beta 1 testing. Before production release, replace it with verified Android App Links / iOS Universal Links using the actual public domain and signing association files.

## Remaining Beta 1 acceptance blockers

- The active `main.dart` still presents the approved HTML screens through WebView. The approved HTML is a visual reference/test host, not the accepted native Dart production UI. The separate Dart migration branch has not yet been connected to the current `InOneSession` and still contains provider-login and message-action placeholders.
- The native Rust MLS bridge exposes session, room, encrypted text, inbox/outbox and device operations, but the active UI does not yet drive MLS send/sync through those methods. `InOneSession` still needs typed public wrappers and the native Dart chat screen must use them.
- Encrypted file-attachment transfer is not implemented end-to-end in the Flutter/Rust bridge. Attachments must remain unavailable rather than fall back to plaintext.
- Provider OAuth callback handling is not yet connected in the active Flutter flow.
- The recovery custom scheme is implemented for Beta 1 testing; verified production Universal/App Links still require the real domain and platform association metadata.

## Recovery deep links and remaining acceptance blockers

- Beta 1 testing supports `inone://recovery/confirm?user=...&token=...&locale=...`. Android/iOS preparation scripts register the scheme. The HTTPS preview page is non-mutating, localized and uses no-store/referrer protections; only an explicit app launch or POST confirms recovery. The unverified custom scheme is hidden in production; production requires verified Android App Links / iOS Universal Links with the actual public domain and association metadata.
- The active `main.dart` remains a WebView-based HTML QA host. It is not the accepted native Dart production UI. The separate Dart migration branch still has provider-login and message-action placeholders and is not connected to the current `InOneSession`.
- The active UI does not yet drive MLS send/sync through the Rust bridge. Encrypted file-attachment transfer is not implemented end-to-end and must remain unavailable rather than fall back to plaintext. Provider OAuth callback handling is also not connected in the active Flutter flow.

## Tests

```sh
cd mobile
flutter test
flutter analyze
```

The tests assert the 22 approved variants, 73 test entries, the 51/1/21 stage split, 95 unique picker entries, the API transport contract and the Flutter-to-native session handoff contract.


## Backend deployment note

The current engine deployment guide describes the checked-in server build as development/test, not production-ready. SMTP/domain delivery, SMS where required, deployment/proxy validation, backup/restore and monitoring still need operational acceptance. Use a controlled staging API until those items are closed.
