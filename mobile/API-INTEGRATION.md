# InOne mobile API integration

> **Post-PR #131 status (2026-11-23):** PR #131 is merged into `main` at `2430b0365ab71c60b0926b27854d17a9090e1fba`. Native Flutter/backend wiring and canonical Engine B FFI are present in source. `INONE_MLS_NATIVE_ENABLED` remains false by default; physical Android/iOS, two-device MLS, and release acceptance are not implied by source integration or PR-head CI. See [post-PR131 acceptance audit](../development/reports/2026-11-23-post-pr131-beta1-acceptance-audit.md).

## Configuration

The mobile test host reads the backend origin from the compile-time environment variable `INONE_API_BASE_URL`.

```sh
flutter run --dart-define=INONE_API_BASE_URL=https://your-staging-api.example
```

The origin must be supplied by the project owner/operator. No production host is hard-coded.

## Current server contract

Existing Beta 1.0 routes are maintained in the canonical engine. Account locale is connected in the current main through the existing profile/registration contracts; do not rely on the older PR #61 pre-merge note below.

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
| GET | `/rooms/mine` | Current user's room list, encrypted last-activity cursor/time, unread count, direct peer ID, contact membership, incoming contact prompt and block state; message plaintext is never included |
| GET | `/contacts` | Current user's accepted contacts and pending incoming contact prompts |
| POST | `/contacts/:userId/accept` | Add the sender to the current user's contacts; this does not gate or delay message delivery |
| POST | `/contacts/:userId/block` | Block a user, remove contact/pending-request state and prevent future direct-message delivery |
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

The current Rust MLS session owns refresh-token rotation after explicit native-session adoption; Dart retains only a short-lived access-token snapshot. Native MLS remains opt-in and disabled by default.

## Not yet connected

- Screen-specific write forms for all 51 core test screens.
- Physical Android/iOS runtime acceptance of the integrated Engine B FFI, protected Keychain/Keystore and SQLCipher key persistence.
- Full two-device MLS acceptance, including Welcome, text/attachment exchange, crash/restart, ACK and revocation.
- Runtime proof of Flutter/native ACK lifecycle on real devices.
- File upload progress/completion UI and production-provider callback gaps that remain explicitly blocked in the current host.

The original 73-card full-screen gallery is packaged and loaded by Flutter; an asset test verifies every card ID. Visual inclusion does not imply that all future modules have backend implementations or live API contracts.


## Deployment readiness boundary

The repository has Docker Compose acceptance and PostgreSQL-backed backup/restore implementation/tests, but these do not constitute production deployment acceptance. Before live use, the backend owner must complete a real SMTP transport and sender domain, phone/SMS flows where required, HTTPS/proxy validation, a restore rehearsal on a production-like environment, monitoring/alerts and operational recovery. Database and object-file backups are separate operations, not one atomic cross-store snapshot. Until these are closed, connect the Flutter client only to a controlled development or staging environment.


## Stage 3 contract source of truth

The complete screen-to-route matrix, authentication boundaries, request-flow notes and current CH-02 MLS sequence are maintained in [API-CONTRACTS-BETA-1.md](API-CONTRACTS-BETA-1.md). That contract matrix supersedes older screen-level route notes in this file when they differ.

Important: `GET /rooms/:id/events` is implemented for reading ciphertext history. It is not a message-send endpoint. All new messages must use `POST /mls/groups/:id/messages`; the legacy `POST /rooms/:id/events` returns 409. Native MLS ownership and secure local persistence are now integrated through canonical Engine B, but remain opt-in and not physically accepted. The Flutter/Dart production UI must not expose MLS secrets or arbitrary routes.

## Private direct conversations

`POST /direct-chats/open` accepts `{ userId }` and returns the single canonical conversation for the unordered account pair. The server generates an opaque room ID and reserves a private, non-organization-scoped room with only the creator in its server roster. The creator resumes local Engine B initialization through `POST /rooms`, then automatically uses the existing MLS KeyPackage-claim and Add Commit flow to deliver a Welcome to every active device of the paired recipient. The recipient does not accept or reject the chat and never has to approve MLS membership. `provisioning` is only an internal state while MLS membership is being established; after the Add Commit is accepted, messages are delivered through the normal encrypted message route.

When the first message arrives from a sender who is not in the recipient's contacts, the message is still delivered immediately. The chat row displays **Принять** and **Заблокировать** beside the sender's name. **Принять** adds that sender to the recipient's contacts and removes the prompt; it does not unlock or trigger delivery of the message because delivery has already happened. **Заблокировать** blocks the pair, removes reciprocal contact entries and pending contact prompts, and prevents future messages/interactions; previously delivered history remains available. If the sender is already in the recipient's contacts, no prompt is shown. The prompt is a contact-list decision, not a message request or an MLS membership gate.

Reopening from either side returns the same room; a conversation provisioned by the other side becomes available on this device when its Welcome is synchronized. Direct rooms cannot be made public or use group invite/join controls.
