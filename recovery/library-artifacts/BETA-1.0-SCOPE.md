# InOne Beta 1.0 — UI scope boundary

## Owner correction

The following modules are **not part of Beta 1.0** and must not appear in its navigation, release checklist or acceptance criteria:

- Tasks
- Calendar
- Cindy (AI assistant)

Their prototype source was parked outside the Beta 1.0 Flutter app and is not counted toward release readiness.

## Beta 1.0 client scope

- Login by email/password, email-confirmed registration and account recovery.
- Chats: server-backed room list, room event metadata, and conversation view.
- Organization list and approved/pending state; pending organizations are not selectable.
- Profile/account/security entry points.
- API session in memory with refresh-token rotation; stable device identifier in platform secure storage.
- MLS through the persistent Rust client, with no plaintext fallback.

## Current implementation state (2026-11-08)

- Main navigation exposes only Chats, Organizations and Profile.
- Flutter API transport, in-memory access/refresh session handling, login/registration/recovery actions, device identity storage, organization/profile/room repositories have been authored.
- Chat list and room metadata are loaded from server endpoints. Encrypted events are shown as decrypted only when the native MLS client returns a matching durable incoming event; otherwise the UI clearly marks them as encrypted/unprocessed.
- The `MethodChannelMlsEngine` Dart adapter is authored, but Android/iOS native handlers are not yet implemented. Therefore send/decrypt remain unavailable until the persistent `mls-client` bridge is built.
- No local message database is implemented yet. Incoming MLS events must remain unacknowledged until durable local persistence is added.
- Profile editing is not wired because the current server exposes `GET /profile` but no profile-update endpoint.
- Organization selection is displayed locally; the current `/rooms/mine` response has no organization filter/active-org contract, so filtering chats by selected organization is not claimed.
- Flutter analyze/widget tests have not run: Flutter/Dart SDK are unavailable in this environment.

Any additional Beta 1.0 screen or API operation must be checked against the owner's approved scope before implementation.