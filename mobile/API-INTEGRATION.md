# InOne Beta 1.0 — API integration status

This inventory is intentionally conservative. A screen specification or an old client reference is not proof that the current backend implements an endpoint. Before a repository is marked VERIFIED, reconcile it against the exact backend source branch and route registration used by the release candidate.

## Mobile transport foundation

Implemented on `feat/beta1-backend-api-foundation`:

- `lib/core/network/api_client.dart`: typed JSON HTTP transport, bearer-token injection from an in-memory session provider, request timeout, safe error-code extraction, and retryability classification.
- `lib/core/network/api_exception.dart`: stable machine-readable error type for UI localization.
- `test/core/network/api_client_test.dart`: deterministic tests for auth headers, JSON bodies, 401 behavior, retryable 503, and absolute-URL rejection.
- `http` is a direct dependency.

Security boundary:
- The transport never stores credentials or tokens.
- It does not implement refresh-token rotation. Do not add a second refresh owner: after native MLS opens, Rust owns refresh rotation and Flutter must delegate to that session.
- No access token, refresh token, SQLCipher key, or MLS key is passed to the WebView.
- No chat plaintext endpoint is introduced.

## Endpoint inventory

| Feature / action | Method + path | Current evidence | Status |
|---|---|---|---|
| Login | `POST /login` | Referenced by the 0.7.1 screen specification; current release-source request/response contract still needs reconciliation | BLOCKED |
| Start email registration | `POST /register/email` | Referenced by the 0.7.1 screen specification; current release-source contract not independently verified | BLOCKED |
| Confirm email | `POST /register/email/confirm` | Referenced by the 0.7.1 screen specification; current release-source contract not independently verified | BLOCKED |
| Complete registration | `POST /register` | Referenced by the 0.7.1 screen specification; current release-source contract not independently verified | BLOCKED |
| Start password recovery | `POST /recovery/start` | Referenced by the 0.7.1 screen specification; current release-source contract not independently verified | BLOCKED |
| Load my rooms | `GET /rooms/mine` | Added in P0 publication PR #22; response fields shown in route patch: `roomId`, `kind`, `name`, `role`; regression tests cover membership isolation and unauthenticated access | IMPLEMENTED IN DRAFT PR — NOT MERGED |
| Load my organizations | `GET /orgs/mine` | Present in an explicitly unverified Dart reference client | BLOCKED |
| Leave organization | `POST /orgs/:id/leave` | Present in an explicitly unverified Dart reference client | BLOCKED |
| Read profile | `GET /profile` | Prior source audit records a profile GET; re-check against the exact release branch before wiring | NEEDS SOURCE RECHECK |
| Update profile | — | No verified update endpoint found in the current handoff; keep profile read-only | BLOCKED |
| Send / receive MLS messages | Native MLS bridge methods: `sendText`, `sync`, `pendingIncoming`, `ackIncoming` | Contract documented in `MLS-FLUTTER-BRIDGE.md`; platform handlers and durable local message store are not yet complete | BLOCKED — FAIL CLOSED |

## Required contract evidence before feature wiring

For every endpoint, record:
1. exact route registration file and handler symbol;
2. HTTP method, path, authentication and authorization rules;
3. request and response DTOs, including nullable fields;
4. all error codes and status codes;
5. pagination, ordering, idempotency and retry behavior;
6. deterministic repository tests against the verified schema.

Do not infer an endpoint from a screen, UI mock, old client, or REST naming convention. Do not invent an active-organization filter for `/rooms/mine`.

## Next implementation order

1. Reconcile the auth endpoints against the canonical P0 backend source.
2. Add typed auth DTOs and `AuthRepository`; implement login, registration, confirmation and recovery only after contract verification.
3. Add session state and navigation guards; keep tokens memory-only and avoid competing refresh-token rotation.
4. Bind the chat list to `GET /rooms/mine` after PR #22's backend source is accepted into the integration baseline.
5. Implement local durable message persistence and native MLS handlers before enabling message send/decrypt or incoming ACK.
6. Add organization/profile repositories only after their routes are verified.

## Validation status

Flutter SDK was not available in the previous environment inventory. Run and record these checks on the actual branch before merge:

```sh
cd mobile
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
```

Do not mark this transport foundation as Flutter-tested until those commands have run successfully.
