# InOne Beta 1.0 — unified screen and API test host

The Flutter host now exposes the 22 owner-approved visual variants and the complete 73-entry test-screen catalogue in one searchable picker (95 selectable entries total).

## Screen catalogue

- 22 approved HTML screen variants: 11 light and 11 dark. These retain the existing approved HTML asset and WebView presentation.
- 51 Beta 0.7.1 test screens.
- 1 deferred screen (CH-07, moved to 0.8).
- 21 future concepts: calendar, tasks, files, CRM, Sindy AI, stories, geolocation and Propo map integration.
- The 73 additional screens now load from the original owner-provided full-screen design gallery v0.8. The HTML is packaged as deterministic gzip/base64 text parts and reconstructed in memory without rewriting the source. Each Flutter catalogue ID selects its matching original gallery card.

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

## Current integration boundary

- The 22 approved screens remain visual previews; their HTML demo controls are not yet wired to production actions.
- The 73 test entries use the original full-screen HTML gallery. The gallery asset integrity test checks all 73 card IDs against the Flutter catalogue.
- Generic API probing is read-only. POST/PUT/DELETE actions require dedicated forms, validated payloads and explicit confirmation.
- Native Android/iOS MLS FFI, secure message database, upload flow, offline queue and two-device E2E are not completed by this increment.
- The Flutter session temporarily owns refresh-token rotation. When the native MLS bridge is integrated, ownership must move to the native MLS session layer rather than running two refresh owners.

## Tests

```sh
cd mobile
flutter test
flutter analyze
```

The tests assert the 22 approved variants, 73 test entries, the 51/1/21 stage split, 95 unique picker entries and the API transport contract.


## Backend deployment note

The current engine deployment guide describes the checked-in server build as development/test, not production-ready. SMTP/domain delivery, SMS where required, deployment/proxy validation, backup/restore and monitoring still need operational acceptance. Use a controlled staging API until those items are closed.
