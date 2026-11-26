# Beta 1.0 — organization UI integration stage

**Date:** 2026-11-26  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base inspected:** `main` at `38bbd2f028fdce299d42ab41d5a3ab0aad77c09c`  
**Implementation PR:** #161 — `feature/beta1-org-picker-screen-2026-11-26`

## 1. Completed: Screen 190 — My organizations

Added `mobile/lib/ui_dart_source/screens/main/inone_my_organizations_screen.dart`, exported it through `inone.dart`, and connected it to the production host `mobile/lib/app/inone_mobile_app.dart`.

The screen is adapted to the existing authenticated `InOneOrganization` model returned by `GET /orgs/mine`. It shows:
- organization name;
- server-provided role;
- server-provided status;
- currently selected organization.

Workspace switching now opens this dedicated screen instead of a modal. Selecting an organization updates the selected organization, clears the prior roster/member count to avoid showing stale data, returns to the workspace and refreshes the member count from the existing authenticated repository call.

The screen includes Armenian, Russian and English labels.

### Contract discipline

The documented `GET /orgs/mine` response contains `orgId`, `name`, `status` and `role`. It does not return member/project counts. Those values are not fabricated.

The screen intentionally does not expose create/search controls. The current Beta 1.0 host path does not have a verified organization-search flow or an approved create-organization action wired from this screen. Organization onboarding continues through the existing request/approval flow.

## 2. Tests added

Added `mobile/test/ui_dart_source/screens/inone_my_organizations_screen_test.dart`:
- renders organizations and their server-provided role/status;
- selects the tapped organization;
- displays an honest empty state and does not advertise an unwired create action.

The test source is committed. Execution is delegated to the exact-head GitHub Actions workflows attached to PR #161; do not mark tests passed until those runs complete successfully.

## 3. Other archived organization screens — integration disposition

The second Dart archive includes Screens 191–195. They were reviewed against current Beta 1.0 backend contracts and production host code.

| Screen | Existing backend/host evidence | Decision |
|---|---|---|
| 191 Members and roles | `GET /orgs/:id/members` returns `userId` and `role`; current profile already shows the typed roster and connects owner/admin-aware add/remove and owner-only role change operations | Do not import unchanged. Archive requires display name, email, initials, invitation state and a local role picker which does not itself persist the mutation. Adapt only after the data/UX contract is agreed. |
| 192 Organization settings | Existing host already connects `GET/POST /orgs/:id/settings`, settings log, admin log and organization links. Server-supported mutable settings are `maxGroupMembers`, `channelsEnabled`, `fileQuotaBytes` | Do not replace the existing settings flow with the archive screen unchanged. Avatar/profile/description/visibility/permission/invite-toggle/notification controls are not all represented by the verified current API contract. |
| 193 Organization journal | Existing host already reads the settings log and admin-action log. Server DTOs provide actor IDs, action/field, target/detail and timestamps; archive model expects display names, initials, tones and its own category enum | Keep current server-backed logs. A dedicated combined journal needs a mapping and product decision; do not invent actor names or categories. |
| 194 Organization links | Existing host already connects list, propose, accept and revoke with server authorization and confirmation | Do not duplicate. Archive description claims project/file sharing, which is not established by the current organization-link API contract. |
| 195 Leave organization | Backend `POST /orgs/:id/leave` exists and rejects the last owner (`last_owner`) or a user who owns rooms (`owns_rooms`). No typed mobile repository operation or active screen flow is currently connected | Candidate for the next slice. Before integration, adapt copy to verified effects only. The archive's claims about file retention and group-chat notification behavior are not established by the inspected leave handler. |

## 4. Safety and scope

- No backend, identity, database, MLS or encryption behavior changed.
- No new API routes were introduced.
- Existing organization member administration, settings, logs and links were preserved.
- No temporary HTML was restored or used as a Dart pixel-comparison gate.
- Owner screenshots remain the authority for visual corrections after connection.

## 5. Validation state

- Source-level review of the new screen, barrel export, host route, selected-organization state transition and widget-test source completed.
- PR #161 runs the repository's exact-head Flutter mobile, Flutter iOS, Rust bridge and acceptance workflows.
- Until those workflow runs complete on the latest PR head, test/build status remains **pending**, not passed.
- No physical-device test was performed in this stage.
