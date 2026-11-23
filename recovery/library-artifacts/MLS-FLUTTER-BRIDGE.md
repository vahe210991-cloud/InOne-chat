# InOne Flutter ↔ MLS native bridge contract

## Current state

The Flutter app now calls a typed `MlsEngine` boundary and has a `MethodChannelMlsEngine` adapter on `inone.mls`. No Android/iOS channel handler or generated Rust binding exists yet, so the adapter intentionally fails closed when the native plugin is absent. The UI remains read-only for messages; it never sends plaintext to the HTTP message endpoint.

The production implementation must wrap `mobile-mls/mls-client`, which contains the persistent OpenMLS + SQLCipher client. Do **not** wrap `mobile-mls/mls-bridge` as the production engine: that older crate keeps identities and groups in process memory and is a demo/test bridge.

## Required methods

| MethodChannel method | Native Rust operation | Contract |
|---|---|---|
| `open` | `mls_client::connect_with_session` | Accept base URL, access token, refresh token, user ID and stable device ID from the already authenticated Flutter session. Obtain DB key from platform Keychain/Keystore; never pass it through Dart. |
| `refreshSession` | `Client::refresh_session` + `Client::session_tokens` | Serialize refresh-token rotation in Rust and return the latest token pair to Flutter. |
| `sync` | `Client::sync` | Return processed incoming event summaries. Do not ACK at this point. |
| `pendingIncoming` | `Client::pending_incoming` | Return durable unacknowledged inbox records after restart. |
| `ackIncoming` | `Client::ack_incoming` | Allowed only after the Flutter local message transaction commits. |
| `sendText` | `Client::send_text` | Rust owns encryption, durable outbox, retries and server delivery; return event ID. |
| `close` | Drop client handle | Clear in-memory credentials and close the SQLCipher connection. |

## Security and durability requirements

1. Access and refresh tokens remain memory-only in Flutter and Rust. After MLS opens, Rust owns rotation; Flutter delegates refresh and adopts the rotated pair.
2. The SQLCipher database key is generated/stored by Android Keystore or iOS Keychain and is not exported to Dart.
3. Never call `ackIncoming` before a durable local message transaction commits. Delivery is at-least-once; deduplicate by `eventId`.
4. `sendText` must use the Rust outbox. Dart must not POST a plaintext body to `/rooms/:id/events` or `/mls/groups/:id/messages`.
5. Missing plugin, storage errors, key mismatch or MLS recovery state must disable send/decrypt rather than fall back to plaintext.
6. A production bridge must expose recovery diagnostics without exposing private keys, plaintext logs or tokens.

## Build/acceptance work still required

- Add Android and iOS plugin handlers backed by `mls-client` (not the in-memory demo crate).
- Add native platform KeyStore adapters and SQLCipher DB path lifecycle.
- Build Android/iOS libraries and bind lifecycle to Flutter app background/foreground.
- Add persistent local message storage; only then wire `ackIncomingAfterPersistence`. Until then, keep incoming events unacknowledged and display them at-least-once.
- Add Rust↔Dart integration tests for restart, duplicate delivery, offline outbox, `epoch_outdated`, revoked device, and lost server response.
- Run Flutter widget tests and device-level tests on Android and iOS.


## Authenticated session handoff (Beta 1.0)

Flutter owns the initial email/password authentication. It passes the resulting `accessToken`, `refreshToken`, `userId`, and `deviceId` to `mls-client::connect_with_session`. The native MLS client must not call `/register` or `/login` during this handoff. The previous `connect` / `connect_with_approval` functions remain available for legacy engine tests and CLI scenarios only.

The server refresh token is single-use and rotates on every refresh. After native MLS opens successfully, the Rust client is the single refresh-token rotation owner. It serializes refresh requests with `renew_lock` and exposes `refresh_session` / `session_tokens` to the platform binding. Flutter's API client delegates its 401 refresh to that same native session and adopts the returned token pair. If MLS is unavailable, Flutter temporarily uses its own API refresh path; native MLS must remain closed in that mode. Never let the Flutter API client and Rust MLS client independently rotate the same refresh token.

The platform binding still needs to expose these Rust methods and provide a durable Keychain/Keystore-backed implementation of `KeyStore`. The current Dart MethodChannel adapter is only a contract; Android/iOS handlers and the native library packaging are not yet implemented.


`INONE_MLS_NATIVE_ENABLED` defaults to `false` in the Flutter entrypoint. Keep it disabled until the Android and iOS handlers, native Rust library, durable key store, and device tests are all present. Enabling it early would only produce a missing-platform-channel error; it is not a feature flag for plaintext fallback.