# InOne Beta 1.0 — native Flutter mobile client

The production mobile entry point is now Flutter/Dart:

- `lib/main.dart` → `InOneMobileApp`
- `lib/app/inone_mobile_app.dart` — native application shell
- `lib/ui_dart_source/` — the production Dart UI package (screens, models, theme and widgets); `example/ui_dart_source/` holds the two demo/gallery files outside the production library
- `lib/core/network/`, `lib/core/session/`, `lib/core/data/` — shared API client, session and typed repositories

The legacy HTML/WebView host is no longer the application entry point. Approved HTML source material is retained in the repository archive for design/reference purposes only; it is not an active production navigation target.

## Current connected flows

The native Flutter shell currently connects:

1. Email/password login — `POST /login`
2. Email registration request — `POST /register/email`
3. Email code confirmation — `POST /register/email/confirm`
4. Account creation — `POST /register`
5. Read-only current profile — `GET /profile`
6. Current user's room list — `GET /rooms/mine`
7. Current user's organization memberships — `GET /orgs/mine`
8. Public system status — `GET /config/public`
9. Logout — `POST /logout`

See [Dart/backend integration map](DART-BACKEND-INTEGRATION.md) for the screen-by-screen status, blocked operations, Beta 1.0 boundaries and security gates.

## API environment

The API origin is supplied through `INONE_API_BASE_URL`. No production host is hard-coded.

- Android emulator default: `http://10.0.2.2:8080`
- iOS simulator / desktop default: `http://127.0.0.1:8080`
- Physical device: pass the development/staging host's LAN address explicitly.

Example:

```sh
cd mobile
flutter pub get
flutter run --dart-define=INONE_API_BASE_URL=http://192.168.1.20:8080
```

The LAN address is an example only. Use a controlled development/staging backend; do not expose the development engine publicly.

## Native MLS integration status

The repository now contains the Stage 4 persistent Rust/OpenMLS client, the Flutter Rust Bridge crate, platform-protected SQLCipher key storage, the typed Dart session adapter, and a session-handoff path. The app constructs the adapter only when `INONE_MLS_NATIVE_ENABLED=true` is supplied at build time; the flag defaults to `false`.

Before enabling the flag, run `.	ool\generate_native_mls.ps1` from PowerShell in this directory. It generates the FRB bindings, native-assets hook, Rust build script and lockfile, then configures Android's application context. The generated files are not yet committed in this source revision, so a clean checkout is not yet buildable with the native flag enabled.

The native session path adopts the authenticated session into Rust, keeps the refresh token and MLS private state in Rust, stores the device database in SQLCipher, and stores the SQLCipher key in Android Keystore / protected iOS Keychain. On restart it attempts to resume the Rust-owned session. If native adoption fails, messaging remains disabled; there is no plaintext or Megolm fallback.

This source integration is not yet validated: generated FRB outputs, Flutter analysis/tests, Rust bridge tests, Android Keystore runtime checks, and iOS Protected Keychain device/simulator checks must pass on the same final commit before the flag can be enabled for release.

## Security and known boundaries

- Before native MLS adoption, the login session remains in Flutter memory. After successful adoption, Rust owns refresh-token rotation; Dart retains only a short-lived access-token snapshot.
- Profile is read-only until a verified update endpoint exists.
- Room list metadata is connected, but message history and sending remain blocked until the native MLS runtime is generated, built and accepted on devices.
- Never send plaintext messages or use `POST /rooms/:id/events` as a fallback.
- Recovery deep links, device-approval flows, APNs/FCM registration and notification-feed mapping are not yet enabled.
- Binary file transport exists, and the Rust AEAD attachment crypto core is in a separate draft PR; attachment upload/encrypted-manifest delivery/SQLCipher key persistence/decryption are not yet connected end-to-end.
- Leads, Kanban and deal detail remain Beta 2.0 placeholders.
- RQ/PS scope differs between the screen handoff and API contract documents; these screens are not in active Beta 1.0 navigation pending owner resolution.
- Demo data and gallery callbacks are not production data sources.

## Validation

Run from `mobile/`:

```sh
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

Only report results from checks actually run on the exact commit being reviewed. Android/iOS device acceptance and native MLS end-to-end tests remain separate release gates.
