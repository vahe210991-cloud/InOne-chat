# InOne mobile API integration

## Configuration

The mobile test host reads the backend origin from the compile-time environment variable `INONE_API_BASE_URL`.

```sh
flutter run --dart-define=INONE_API_BASE_URL=https://your-staging-api.example
```

The origin must be supplied by the project owner/operator. No production host is hard-coded.

## Current server contract verified in main

The route definitions below were checked against `inone-development-archive-0.6.0/engine/src/server.js` on the repository's `main` branch.

### Session and account

| Method | Route | Use |
|---|---|---|
| POST | `/login` | Email/password login; includes stable deviceId, label and platform |
| POST | `/token/refresh` | Single-use refresh-token rotation |
| POST | `/logout` | End current device session |
| GET | `/profile` | Current account/profile and security hints |
| POST | `/register/email` | Start verified email registration |
| POST | `/register/email/confirm` | Verify email code and receive registrationToken |
| POST | `/register` | Create account using registrationToken |
| POST | `/recovery/start` | Start account recovery |

### Rooms and organizations

| Method | Route | Use |
|---|---|---|
| GET | `/rooms/mine` | Current user's room list |
| GET | `/rooms/search?q=...` | Search public rooms |
| GET | `/rooms/:id` | Room details |
| GET | `/rooms/:id/members` | Room members |
| GET | `/rooms/:id/invites` | Room invitations |
| GET | `/rooms/:id/requests` | Room join requests |
| GET | `/orgs/mine` | Current user's organizations |
| GET | `/orgs/:id/members` | Organization members |
| GET | `/orgs/:id/settings` | Organization settings |
| GET | `/orgs/:id/settings/log` | Settings history |
| GET | `/orgs/:id/links` | Organization links |
| GET | `/orgs/:id/admin-log` | Organization admin log |
| GET | `/org-requests` | Organization requests |
| GET | `/org-requests/:id` | Organization request details |

### Other read probes

| Method | Route | Use |
|---|---|---|
| GET | `/devices/mine` | Current user's devices |
| GET | `/approvals` | Pending device login approvals |
| GET | `/config` | Authenticated service configuration |
| GET | `/config/public` | Public service configuration |
| GET | `/users/search?nickname=...` | Privacy-limited user lookup |
| GET | `/files/:id/url` | Resolve a file download URL |
| GET | `/rooms/:id/stickers` | Room sticker assets (deferred screen) |
| GET | `/sync` | Current user's synchronization feed |

## Client architecture

- `ApiClient`: JSON HTTP transport, Bearer token injection, timeout and stable API errors.
- `InOneSession`: in-memory access/refresh tokens, stable device ID in Keychain/Android Keystore, serialized refresh and one retry after 401.
- `InOneRepositories`: typed profile, room, organization, device, approval and config reads.
- `screen_api_catalog.dart`: maps approved/test screen IDs to safe GET probes.
- Flutter owns network calls. The WebView receives no access token, refresh token or MLS secret.

## Safe test policy

The generic screen runner executes GET requests only. Mutating operations (POST/PUT/DELETE), including registration, recovery, group membership, file upload, admin decisions and MLS operations, require dedicated forms with explicit payload validation and confirmation. They are not fired from a generic screen click.

The current Flutter session temporarily rotates refresh tokens. After Android/iOS MLS FFI is integrated, the native MLS session must become the sole refresh-token owner.

## Not yet connected

- Screen-specific write forms for all 51 core test screens.
- Native Android/iOS MLS FFI and protected local message storage.
- MLS message send/receive and ACK lifecycle from Flutter.
- File upload progress/completion UI.
- Offline queue, reconnect and restart recovery.
- Full two-device end-to-end acceptance.

The 73 test-screen entries are visible in the QA catalogue; their inclusion does not imply that all future modules have backend implementations.
