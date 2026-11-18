# InOne mobile API integration

## Configuration

The mobile test host reads the backend origin from the compile-time environment variable `INONE_API_BASE_URL`.

```sh
flutter run --dart-define=INONE_API_BASE_URL=https://your-staging-api.example
```

The origin must be supplied by the project owner/operator. No production host is hard-coded.

## Current server contract

Existing Beta 1.0 routes are maintained in the canonical engine. The account-locale routes and registration locale payload are introduced in Email Delivery PR #61 and are not available on `main` until that PR is merged.

### Health and readiness

| Method | Route | Use |
|---|---|---|
| GET | `/healthz` | Process liveness |
| GET | `/readyz` | Database readiness |

### Session and account

| Method | Route | Use |
|---|---|---|
| POST | `/login` | Email/password login; includes stable deviceId, label and platform. If a local UI-language change is pending, pass `locale`; the backend saves it after successful authentication and before queuing login-security email |
| POST | `/token/refresh` | Single-use refresh-token rotation |
| POST | `/logout` | End current device session |
| GET | `/profile` | Current account/profile, security hints and persisted in-app locale (`locale: hy\|ru\|en`) |
| PATCH | `/profile/locale` | Update the authenticated account's selected in-app locale |
| POST | `/register/email` | Start verified email registration; pass the selected app locale in `locale` (`hy`, `ru`, or `en`) |
| POST | `/register/email/confirm` | Verify email code and receive registrationToken |
| POST | `/register` | Create account using registrationToken |
| POST | `/recovery/start` | Start account recovery; pass the currently selected UI `locale` (`hy`, `ru`, `en`) |
| POST | `/recovery/cancel-by-code` | Cancel recovery by email code; pass the current UI `locale` |
| POST | `/recovery/complete` | Complete recovery; pass the current UI `locale` |

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
- `InOneSession`: in-memory access/refresh tokens, stable device ID and selected app locale in platform secure storage, serialized refresh and one retry after 401. Registration sends the selected locale; a pending locale is sent during login before any security email can be queued; authenticated locale changes use `/profile/locale`; recovery start/cancel/complete helpers carry the current UI locale. Authenticated operations are held if a pending locale synchronization cannot be completed.
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

The original 73-card full-screen gallery is packaged and loaded by Flutter; an asset test verifies every card ID. Visual inclusion does not imply that all future modules have backend implementations or live API contracts.


## Deployment readiness boundary

The repository's current engine deployment guide identifies this server build as a development/test build, not a production release. Before live company use, the backend owner must complete and verify a real SMTP transport and sender domain, phone/SMS flows where required, a tested deployment/proxy configuration, database backup/restore, monitoring and operational recovery. The checked-in compose file is explicitly marked untested. Until these are closed, connect the Flutter client only to a controlled development or staging environment.


## Stage 3 contract source of truth

The complete screen-to-route matrix, authentication boundaries, request-flow notes and current CH-02 MLS sequence are maintained in [API-CONTRACTS-BETA-1.md](API-CONTRACTS-BETA-1.md). That contract matrix supersedes older screen-level route notes in this file when they differ.

Important: `GET /rooms/:id/events` is implemented for reading ciphertext history. It is not a message-send endpoint. All new group messages must use `POST /mls/groups/:id/messages`; the legacy `POST /rooms/:id/events` returns 409. Native MLS ownership and secure local persistence remain Stage 4 work. The WebView bridge must not receive MLS secrets or call arbitrary routes.


## Platform organization requests (G2)

- `GET /org-requests` populates PS-01; the authenticated profile exposes `platformRole` (`owner`, `admin` or `null`) for navigation only. The server independently scopes the queue and enforces every operation.
- `GET /org-requests/:id` populates PS-02 request and document metadata.
- `POST /org-requests/:id/decision` is connected from PS-03. Only the platform owner sees the decision action; the backend still rejects admins with 403 `not_platform_owner` and repeated decisions with 409.
- Document bytes are not yet connected to a secure native download/preview flow. PS-02 must not be considered complete until that adapter and its tests are implemented.
