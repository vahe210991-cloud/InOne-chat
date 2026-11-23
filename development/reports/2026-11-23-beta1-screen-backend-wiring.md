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