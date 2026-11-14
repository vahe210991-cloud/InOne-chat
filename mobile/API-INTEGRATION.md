# InOne mobile API integration

**Current client:** native Flutter/Dart.  
**Runtime entry:** `mobile/lib/main.dart` → `mobile/lib/app/inone_mobile_app.dart`.  
**Network boundary:** `ApiClient` → `InOneSession` → typed `InOneRepositories`.  
**Screen mapping:** [DART-BACKEND-INTEGRATION.md](DART-BACKEND-INTEGRATION.md).

The former HTML/WebView runtime, JS bridge and HTML asset bundles have been removed from the mobile runtime and retained under the repository's `мусорный ящик/` archive. No production screen may load HTML, execute a JS bridge or receive session credentials through a WebView.

## Configuration

The mobile client reads the backend origin from compile-time environment variable `INONE_API_BASE_URL`.

```sh
flutter run --dart-define=INONE_API_BASE_URL=https://your-staging-api.example
```

Defaults are development-only:
- Android emulator: `http://10.0.2.2:8080`
- iOS simulator / desktop: `http://127.0.0.1:8080`

No production host is hard-coded. Use only a controlled development/staging environment until deployment, mail/SMS, monitoring and backup/restore operations are accepted.

## Current native integration

| Operation | Method + exact path | Status |
|---|---|---|
| Login | `POST /login` | Connected; email/password |
| Start email registration | `POST /register/email` | Connected |
| Confirm email registration | `POST /register/email/confirm` | Connected |
| Create account | `POST /register` | Connected; requires verified registration token and phone |
| Logout | `POST /logout` | Connected |
| Current profile | `GET /profile` | Connected; read-only |
| Current user's rooms | `GET /rooms/mine` | Connected; list metadata only |

Other routes exist in the backend but are not automatically callable from the UI. Their exact screen status, payload requirements and blockers are in [DART-BACKEND-INTEGRATION.md](DART-BACKEND-INTEGRATION.md).

## Existing client architecture

- `ApiClient`: JSON HTTP transport, Bearer token injection, timeout and safe API errors.
- `InOneSession`: in-memory access/refresh tokens, stable device ID in platform secure storage, serialized refresh and one retry after 401.
- `InOneRepositories`: typed profile and room reads, plus verified read operations for organizations/devices/config/request lists.
- `InOneProfile` and `InOneRoom`: DTOs validate exact backend response envelopes before UI mapping.

The current session temporarily owns refresh-token rotation. When native MLS is integrated, refresh-token ownership must move to the native MLS session layer; do not introduce two refresh owners.

## Backend route evidence

The route source used for this integration is:
`inone-development-archive-0.6.0/engine/src/server.js`.

Important verified route groups include:

### Session and account
- `POST /login`
- `POST /token/refresh`
- `POST /logout`
- `GET /profile`
- `POST /register/email`
- `POST /register/email/confirm`
- `POST /register`
- `POST /recovery/start`
- `POST /recovery/confirm`
- `POST /recovery/cancel-by-code`
- `POST /recovery/cancel`
- `POST /recovery/complete`
- `POST /auth/nonce`
- `POST /auth/provider/verify`
- `POST /register/provider`

### Organizations and requests
- `GET /orgs/mine`
- `GET /org-requests`
- `POST /org-requests`
- `GET /org-requests/:id`
- `POST /org-requests/:id/documents`
- `GET /org-requests/:id/documents/:docId`
- `POST /org-requests/:id/decision`

### Rooms, sync and MLS
- `GET /rooms/mine`
- `GET /rooms/:id/events` — encrypted events only
- `GET /mls/groups/:id/commits?since=N`
- `GET /mls/welcomes`
- `POST /mls/welcomes/:id/ack`
- `POST /mls/groups/:id/messages` — MLS ciphertext only
- `GET /sync?since=N&signal_since=M`
- `POST /rooms/:id/read`

The presence of a backend route does not mean the Flutter screen is integrated. Request/response schemas, auth, role checks, binary file behavior, retries and local persistence must be implemented and tested before a route is exposed.

## Security invariants

- Stable user, organization and room IDs are opaque strings.
- Never store passwords or log tokens, secrets, pollSecret values or MLS material.
- No plaintext chat fallback. `POST /rooms/:id/events` returns 409 and directs clients to the MLS message endpoint.
- MLS decrypt/send must fail closed.
- Do not ACK delivery/signal streams before the corresponding local durable persistence transaction succeeds.
- Backend membership, role, ownership and capabilities remain authoritative; UI visibility is not authorization.
- Profile update is blocked until a verified update endpoint exists.
- Room-list response does not include last-message preview, unread count or timestamp; the UI must not fabricate them.

## Validation

Run from `mobile/`:

```sh
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build apk --debug
```

Only report checks that were run against the exact commit. Native MLS, file upload/download, push delivery, recovery deep links and physical-device acceptance remain separate gates.
