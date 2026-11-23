# Beta 1.0 — screen/backend wiring (isolated work branch)

**Date:** 2026-11-23
**Repository:** vahe210991-cloud/InOne-chat
**Branch:** feature/beta1-screen-backend-wiring-2026-11-23
**Base:** PR #130 head dff0786bd8f920b902495e94fec46c297b110899
**Current report head before this report commit:** eda3e019342760c7cea48553919a55143ffdc1a1
**Status:** implementation slice committed; tests/builds/Actions intentionally not run.

## Why this branch exists

PR #128 and PR #130 both touch the Flutter app, repositories, session and messaging screens. PR #130 already carries the selected Engine B room-list/history/outbox behavior from #128. To avoid editing either queued PR or duplicating its commits, this work is isolated on a child branch based on the exact PR #130 head. No PR was opened, so pull-request validation workflows were not triggered.

## Implemented

### 1. Authenticated room directory is independent of native MLS opt-in

- InOneRepositories.myRooms() continues to use the existing typed GET /rooms/mine contract.
- The messages screen now loads and displays authenticated room names/IDs even when INONE_MLS_NATIVE_ENABLED=false.
- Room history, message content, sync, durable outbox and sending remain behind the active canonical Engine B session.
- SQLCipher local-room recovery is used only when a native Engine B session exists and the server read fails due to a transport outage. Authentication failures and malformed successful responses are not hidden by local fallback.
- Opening a room without native MLS still fails closed with the existing explanatory notice. No plaintext transport or fallback was added.

### 2. Organization/workspace member count

- Added InOneRepositories.organizationMembers(orgId) for the existing authenticated GET /orgs/:id/members route.
- The organization screen reads the member list and displays only its validated count.
- The workspace summary receives the count when available; access/network/shape failures leave it unknown rather than inventing a value.
- The workspace group count is derived from the typed authenticated room list and remains unknown while that list is loading or in an error state.
- The app retains server-side role enforcement; this slice adds no organization mutation controls.

### 3. Profile locale selector

- Added a visible profile-menu selector for Armenian (hy), Russian (ru) and English (en).
- It calls the existing session/repository locale path, which sends authenticated PATCH /profile/locale and persists the selected locale through the existing secure local preference flow.
- The app does not infer the account locale from the operating system.

## Files changed

- mobile/lib/core/data/inone_repositories.dart
- mobile/lib/app/inone_mobile_app.dart
- mobile/API-CONTRACTS-BETA-1.md
- mobile/README.md
- development/reports/2026-11-23-beta1-screen-backend-wiring.md

## Safeguards preserved

- PR #128 and PR #130 were not modified by this branch after its creation; neither was merged or closed.
- No checks, tests, analyzers, builds, workflow dispatches or CI reruns were started, per owner instruction.
- No PR was opened, avoiding pull-request workflow triggers while #128 and #130 occupy the queue.
- INONE_MLS_NATIVE_ENABLED remains false by default.
- Canonical Engine B only; Firebase Push, session ownership and navigation lifecycle remain intact.
- No backend endpoint was added. No plaintext fallback or key material exposure was introduced.

## Validation status

**Not run by instruction:** Flutter tests, analyzer, Rust tests, backend tests, Android/iOS builds, GitHub Actions and device/two-device acceptance.

The work received source-level inspection only. It is not runtime-accepted and is not ready for merge until the owner authorizes validation after the queued PRs are fully green.

## Next screen work

Continue only against backend routes already present and documented. Prioritize the reachable Beta 1.0 profile, workspace, organization, room-list and chat flows. Keep approval/request/provider flows and future CRM/task/calendar screens blocked until their exact screen contracts and host behavior are confirmed. Do not create new endpoints or expose backend operations through a generic UI probe.

## Expanded five-screen integration pass

The five-screen scope is now explicit:

| Screen | Existing live wiring | Current source gaps to close |
|---|---|---|
| Messages / room directory | Authenticated `GET /rooms/mine`; `GET /rooms/search`; `POST /rooms/:id/join`; group filter; loading/error/retry | Server-backed unread counts are not included in `/rooms/mine`; public-group discovery is wired. An approval join records a request; an open join still requires a valid native MLS Welcome before history can open |
| Chat thread | Engine B MLS text send, durable outbox, encrypted attachment send/download; `GET /rooms/:id/members`; `POST /rooms/:id/settings`; `POST /rooms/:id/read`; permission-gated native MLS invite | Metadata/member roster and effective capabilities render; rename and MLS invite are capability-gated; read marker posts only after readable history has been durably loaded. Member removal/role changes and moderation remain pending |
| Organization profile | `GET /orgs/mine`, `GET /orgs/:id/members`, `POST /orgs/:id/members`, `POST /orgs/:id/members/:userId/role`, `DELETE /orgs/:id/members/:userId` | Typed roster plus owner/admin-aware add/remove and owner-only role changes are connected with confirmations. Organization settings, links and audit views remain pending |
| Workspace | Organization switch, member count, room-derived group count, public system config | Notifications, project/task/activity statistics and customization must be mapped to actual Beta 1.0 backend routes; unavailable modules must not show fabricated metrics |
| User profile | `GET /profile`, persisted `PATCH /profile/locale`, `GET /devices/mine`, `DELETE /devices/:deviceId`, logout | Device inventory and remote-device revocation are connected with confirmation; current device is protected from self-revocation. Profile/avatar editing remains unavailable until a real backend mutation contract exists |

### Newly implemented in this pass

- Added strict `InOneOrganizationMember` parsing for the existing `GET /orgs/:id/members` response (`userId`, role).
- Changed `InOneRepositories.organizationMembers` from an untyped response map to a validated immutable member list.
- Organization profile now renders the member roster and server-provided role for each member, not only a count.
- Roster state is cleared when the account or selected organization changes. Failed/denied reads remain unknown and are not replaced with guessed members.

### Acceptance boundary

This is source implementation only. No test, analyzer, build, device run, workflow dispatch or Actions rerun was performed. The roster is not runtime-accepted. The five screens are **not yet fully connected**: the remaining gaps above are tracked as implementation work, not marked complete. Backend contracts that do not exist (for example, a general profile/avatar update or workspace project/task feed in the current Beta 1.0 contract) will not be fabricated on the client.


## 2026-11-23 — next implementation pass: public groups and chat thread

### Implemented

- Added strict DTOs for public-room search and authenticated room details, including owner, admins, members, per-member effective capabilities, visibility, join policy and read markers.
- Added typed repository operations for `GET /rooms/search?q=`, `POST /rooms/:id/join`, `GET /rooms/:id/members`, `POST /rooms/:id/settings` (name only), and `POST /rooms/:id/read`.
- Messages screen search now opens a public-group discovery dialog. It enforces the server's 2–50 character query range, displays member count and join policy, and handles open joins, approval requests, already-member conflicts and server errors.
- The group filter control now toggles All / Groups locally. The search label accurately says “Find public groups”; it does not claim to search message plaintext.
- Chat thread “More” loads server member/capability/settings/read-marker metadata. The dialog shows owner/admin/member roles and each member's latest server read marker.
- Room rename is displayed only when the current user's server-provided capabilities include `edit_group_name`; mutation uses existing `POST /rooms/:id/settings` and the backend remains authoritative.
- “Invite member” is displayed only when `invite_members` is granted and native MLS is active; it calls the existing Engine B invite bridge, not a plaintext or non-MLS membership shortcut.
- Read markers are posted only after `loadMlsRoomHistory` has returned readable messages from the native client after durable persistence. The marker is derived from the server event ID; no marker is sent for unknown IDs.
- The call action is hidden because no Beta 1.0 call backend contract is connected.

### Important protocol boundary

The backend's public open-join operation adds room membership and emits a room-change signal, but it does not itself establish an MLS epoch or deliver a Welcome to this device. The UI therefore reports that a device MLS Welcome is still required and the thread continues to fail closed until the native Engine B client has a local epoch. Do not weaken this boundary.

### Remaining chat/group gaps

- Server unread counts are not returned by `GET /rooms/mine`; the UI keeps unread filtering disabled rather than inventing counts.
- The full room settings form (visibility/join policy), member role changes/removal, join-request moderation, invite-link management and message edit/redact controls are not yet wired.
- Search is for public group names only; message-content search remains unavailable because ciphertext is not searchable by the server.


## 2026-11-23 — organization member administration

- Added typed repository mutations for existing organization routes: add member, change member role, and remove member.
- Organization profile now exposes Add member for owner/admin; admin can add only ordinary members, owner can assign owner/admin/member.
- Owner sees role selector and may change roles; owner can remove other members; admin can remove ordinary members only. The current account cannot remove itself from this control.
- Role changes and removals require confirmation. Roster and count refresh from the authenticated server response after each successful mutation.
- If the owner changes their own role, the active organization role is updated immediately so the UI no longer exposes owner-only controls.
- Last-owner, owned-room transfer and other business constraints remain enforced by the backend; errors are surfaced rather than bypassed.
- Organization settings, linked organizations and admin/audit log actions remain unconnected.


## 2026-11-23 — user profile device management

- Added strict `InOneDevice` DTO parsing for `GET /devices/mine` (`deviceId`, `label`, `revoked`, `pushRegistered`).
- Added typed repository device inventory and `DELETE /devices/:deviceId` revocation.
- Added “Устройства и безопасность” to the user profile menu. It displays device label/ID, current-device state, revoked state and push-registration state.
- Remote device revocation requires confirmation and refreshes the inventory after success. The current device is not offered as a revocation target, avoiding invalidating the active app session in-place.
- Server remains authoritative: revocation deletes push registration and records MLS device removals. No key material or push identifiers are displayed.
- Profile name/avatar update remains blocked because no confirmed Beta 1.0 profile mutation route is available.
