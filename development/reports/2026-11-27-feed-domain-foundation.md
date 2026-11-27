# Feed Beta 1.0 media-first architecture — 2026-11-27

## Status

**Architecture revision and media-first pure-domain slice published to PR #174; production integration not yet started.** Owner approved variant A: a separate server-side Feed media pipeline, TLS in transit, encryption at rest and mandatory authentication. Chat MLS/file pipeline must remain untouched.

- Repository: vahe210991-cloud/InOne-chat
- Main SHA at review: 7d34b99fcc026a828b838e211d039c575aeace1d
- PR #174 branch: feat/feed-domain-foundation-beta1-main-7d34b99-20261127
- Prior PR #174 head: 87783a37fe9361dec477458ff9ad921887d19e97
- Architecture proposal update commit: 7db478a6d4e2491a273188ad0b55cca544eaba35
- Domain implementation commits: a6648bebc7cbbcf5a62d2d8d84316d34087f3a0a and 95711b5f1a3d9bffa438cc9e2b4fe355cc5719c5
- Domain test additions/fix commits: d182a94eaa7a3ee4f99ff882deef4d8a6e4f751d and 83e6b81af42fd86b8dca2ccbfb9d9129cb22771a
- PR: https://github.com/vahe210991-cloud/InOne-chat/pull/174 (Draft, unmerged)

## Owner decision recorded

Feed media variant A is approved:
- separate media pipeline and storage namespace for Feed;
- TLS for transport;
- encryption of stored objects and all derived renditions;
- mandatory active-session authorization for upload, publication, listing and every media delivery;
- server-side content validation and image/video derivative generation;
- no change to chat MLS, room files or existing chat file authorization.

This is server-side processing and is not E2EE. This decision applies only to Feed.

## What changed in this stage

Updated development/architecture/FEED-BETA1-API-CONTRACT-PROPOSAL.md from text-first to media-first.

The revised proposal defines:
- Post with nullable caption and mandatory one-or-more ready media;
- PostMedia association and media lifecycle states;
- authenticated upload reservation, quarantine, content verification and processing worker;
- isolated Feed storage namespace and envelope-encryption recommendation;
- authenticated media delivery with session/device revalidation and parent-post authorization;
- atomic publication and owner-only deletion with cleanup outbox;
- nickname in Feed DTO and no internal account/device IDs;
- HMAC-SHA-256 cursor integrity;
- own-profile gallery endpoint only, without introducing public-profile semantics;
- explicit integration boundary around existing /files and MLS pipeline;
- security acceptance matrix and implementation gates.

## Existing domain work: retain, adapt, do not misrepresent

The existing pure domain helpers remain useful for opaque IDs, idempotency-key validation, Unicode validation, deterministic ordering, keyset boundary handling and page bounds.

Required adaptation before production use:
- text content must become optional caption;
- publication validation must require at least one ready media association;
- existing unsigned cursor serialization is only a parsing/format helper and is not a tamper-proof production cursor. Production cursor must use a server-secret HMAC and constant-time verification;
- old text-only create semantics and tests must not be used as production post contract.

Added pure helpers for optional caption normalization, mandatory non-empty unique ready Feed media validation bound to the author, and HMAC-SHA-256 cursor signing/verification with key IDs, scope binding and constant-time signature comparison. Added corresponding tests to the existing feed-rules test file. These are domain primitives only; they are not wired into HTTP routes or persistence.

No backend routes, SQL migrations, Post/PostMedia persistence, media worker, object encryption, media delivery or Flutter integration have been implemented in this stage.

## Existing backend boundary

Current chat file flow remains owner/device-bound or room-member-bound. It includes active-device checks, upload reservation/completion, signed download authorization and object storage. It is not suitable to be made cross-account-readable for Feed by changing its existing policy.

Feed requires a dedicated media domain adapter and isolated namespace. Existing chat routes and MLS behavior must remain unchanged.

## PR coordination

- #171 AUTH: open Draft, shared backend files affected; do not blindly integrate.
- #173 MLS membership security: open Draft and explicitly on HOLD until #169 merges; do not run or rerun its workflows before that dependency is merged.
- #172 Feed scope decision: open Draft, unmerged.
- #174 Feed domain foundation: open Draft; revised proposal is still unapproved until owner reviews it.
- Main remains at 7d34b99fcc026a828b838e211d039c575aeace1d at the time of this report.

No shared backend files were changed. No PR was merged. No tests were run in this stage and no PASS is claimed.

## Next engineering sequence

1. Complete static review of the new pure Feed domain helpers and tests, then execute the exact-head domain tests when the implementation batch is ready.
2. Inspect the existing object-store abstraction and deployment/runtime capabilities for an isolated Feed bucket/namespace, encryption key provider and worker execution model.
3. Propose evidence-based numeric limits for photo count, bytes, codecs, video duration/resolution, rendition profiles and processing resource budgets. Do not hard-code arbitrary values.
4. Reconcile #171/#173/#169 integration order and capture a fresh exact main SHA before touching server/store/schema.
5. Implement Feed media reservation/quarantine/processing/storage/delivery in isolated modules, then transactional Post/PostMedia persistence and routes.
6. Verify exact Dart UI sources in all relevant branches before connecting the approved screens.
7. Add dynamic security and regression tests, then run applicable Actions on the exact final SHA.

## Acceptance status

| Criterion | Status |
|---|---|
| Owner-approved media encryption direction | APPROVED |
| Media-first API proposal | DRAFT, awaiting owner review |
| Pure domain rules adapted to media-first | AUTHORED, NOT EXECUTED |
| Feed media upload/processing/storage | NOT STARTED |
| Post/PostMedia persistence and routes | NOT STARTED |
| Authenticated Feed and profile gallery | NOT STARTED |
| Flutter integration | NOT STARTED |
| Dynamic security acceptance | NOT STARTED |
| Beta 1.0 Feed | NOT ACCEPTED |

No WBS weights or progress percentages were changed. No task was closed or struck through.
