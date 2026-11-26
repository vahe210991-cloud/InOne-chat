# Chat & Groups Beta 1.0 implementation progress — 2026-11-26

- **Base:** `main` at `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`.
- **Working branch:** `work/chat-groups-beta1-implementation-2026-11-26`.
- **Detailed plan:** [CHAT-GROUPS-BETA-1.0-IMPLEMENTATION-PLAN.md](../CHAT-GROUPS-BETA-1.0-IMPLEMENTATION-PLAN.md).
- **Status:** IMPLEMENTATION IN PROGRESS / NOT ACCEPTED.
- **Tests:** not run. No claim of build or release readiness.

## Owner clarification: direct-message delivery

A recipient does not accept or reject a request when another user sends a personal message. Direct messages are delivered without recipient approval. MLS KeyPackage claim, Add Commit and per-device Welcome are automatic cryptographic provisioning, not a consent flow. The backend's `provisioning` state is internal only and must not be displayed as a request awaiting acceptance.

## Code changes present on the branch

1. Added migration `0036-direct-conversations.sql` and matching canonical schema for private, non-organization-scoped direct rooms. The unordered account pair is unique and deterministic.
2. Added authenticated `POST /direct-chats/open` create-or-open route. Both directions of the same pair resolve to one opaque room ID.
3. Added PostgreSQL and memory-store support for direct conversation reservation, pair lookup, membership checks and activation after MLS Add Commit.
4. Restricted KeyPackage claim and Add Commit to the paired recipient. A third account cannot be added to a direct room.
5. Kept the legacy room member add/remove endpoints fail-closed with `409 mls_commit_required`. They cannot mutate MLS membership directly.
6. Updated Flutter direct-chat DTO and UI: `provisioning` is an internal MLS state, with no recipient accept/reject action or prompt.
7. Added per-device KeyPackage reserve maintenance after authenticated app loading and on resume, so a recipient device can be reached without first creating a conversation.
8. Added backend regression coverage for canonical pair creation, concurrent opens, multi-device Welcome, third-party isolation, pre-activation fail-closed behavior, group-only route denial and bidirectional message delivery without an acceptance step.
9. Added a real Rust/OpenMLS scenario: sender opens a direct room, automatically welcomes every active recipient device, sends while the recipient is offline, and both recipient devices receive the first message on sync without an approval action.
10. Added Flutter DTO/repository/preview tests for provisioning and active direct conversations, including rejection of the old `pending` response shape and suppression of opaque room IDs in display labels.
11. Registered migration 0036 in the migration runner, included direct-chat regressions in `npm test` and `npm run test:db`, and added schema assertions for fresh and upgraded PostgreSQL databases.

## Important behavior and limits

- A message is not reported as delivered until the sender's MLS Add Commit is accepted and every active recipient device has a Welcome.
- A device with no usable KeyPackage cannot be silently added. The native client fails closed; KeyPackage reserve maintenance is intended to prevent this for devices that have authenticated and initialized the native MLS runtime.
- The MLS native feature flag remains disabled by default. This work does not enable production MLS.
- Direct rooms remain private and do not expose public-group join requests, invite links, or group settings.

## Verification still required

- Review all backend/store authorization and transaction paths, including PostgreSQL lock order and memory-store parity.
- Run migration tests against PostgreSQL.
- Run the new direct-chat tests and existing room, MLS membership, KeyPackage, multi-device, message, sync and revocation regression suites.
- Run Rust/OpenMLS checks and Flutter format/analyze/unit/widget tests.
- Run the configured GitHub Actions workflows on one exact PR SHA and fix every failure.
- Confirm no unrelated Beta 2.0 work or release flag changes entered the branch.

No test/build result is claimed until Actions reports it for the exact implementation SHA. Do not merge without explicit owner approval.
