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

Only the stable device identifier is persisted, using platform secure storage. Access and refresh tokens remain in memory and are never passed into WebView JavaScript.

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
- Stage 4 is not accepted until Rust/Flutter regression suites, Android Keystore runtime smoke tests, iOS native device/simulator builds and signed iOS Protected Keychain runtime validation pass on the same PR head. The iOS workflow fails closed when any required signing certificate, password, provisioning profile or team ID secret is missing; a skipped runtime test is not accepted.

## Tests

```sh
cd mobile
flutter test
flutter analyze
```

The tests assert the 22 approved variants, 73 test entries, the 51/1/21 stage split, 95 unique picker entries, the API transport contract and the Flutter-to-native session handoff contract.


## Backend deployment note

The current engine deployment guide describes the checked-in server build as development/test, not production-ready. SMTP/domain delivery, SMS where required, deployment/proxy validation, backup/restore and monitoring still need operational acceptance. Use a controlled staging API until those items are closed.
