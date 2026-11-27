# Feed Beta 1.0 media-first architecture — 2026-11-27

## Status

**Architecture revision and media-first pure-domain slice published to PR #174; production integration not yet started.** Owner approved variant A: a separate server-side Feed media pipeline, TLS in transit, encryption at rest and mandatory authentication. Chat MLS/file pipeline must remain untouched.

- Repository: vahe210991-cloud/InOne-chat
- Main SHA at review: 7d34b99fcc026a828b838e211d039c575aeace1d
- PR #174 branch: feat/feed-domain-foundation-beta1-main-7d34b99-20261127
- Prior PR #174 head: 87783a37fe9361dec477458ff9ad921887d19e97
- Architecture proposal update commit: 7db478a6d4e2491a273188ad0b55cca544eaba35
- Domain implementation commits: a6648bebc7cbbcf5a62d2d8d84316d34087f3a0a and 95711b5f1a3d9bffa438cc9e2b4fe355cc5719c5, 52d3909bf20d61212854afc470b9222e4ac63bf3, and 26b94a6e376064aecddadc735392d651bbbfbc30
- Domain test additions/fix commits: d182a94eaa7a3ee4f99ff882deef4d8a6e4f751d 83e6b81af42fd86b8dca2ccbfb9d9129cb22771a and 3f1467bed8acc5b8b48ce9ef396a5ca1d6dd9357 and 8acd93fb329d4bc95a85921fe03c586c408a47e1
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

## Domain and encrypted storage primitives

The text-first mandatory-content helper and unsigned cursor encoder were removed from the Feed domain module. The current pure domain slice now contains:
- optional caption normalization (NFC, newline normalization, blank → null, malformed Unicode/NUL rejection);
- mandatory non-empty, unique, ready, Feed-scoped media validation bound to the authenticated author record;
- canonical SHA-256 request hash over normalized caption and ordered media IDs for idempotency comparison;
- HMAC-SHA-256 cursor encoding/verification with key IDs, global/own query-scope binding, canonical base64url checks and constant-time signature comparison;
- keyset ordering/boundary helpers; pagination emits signed cursors only.

Added an isolated streaming encrypted object-store wrapper:
- random 256-bit DEK per object;
- AES-256-GCM chunk records with independent authentication tags;
- DEK wrapped with a dedicated 256-bit KEK from an injected key-provider interface;
- AAD binds object key, key ID, chunk counter and plaintext length;
- key ID in the object header supports key-ring rotation;
- streaming read/write adapter wraps the existing object-store interface without changing chat storage.

New domain and encrypted-store tests were added and wired into the existing backend test entry. They have NOT been executed.

## Storage audit finding

The canonical backend currently exposes:
- filesystem object store with streaming writes, restrictive file/directory permissions and atomic temp-file publication, but no application-level encryption at rest;
- in-memory object store that buffers complete objects and is suitable only for tests;
- no S3/MinIO or KMS/HSM adapter in the reviewed production path.

The updated proposal therefore specifies an isolated Feed storage directory/namespace, encrypted before bytes reach the underlying filesystem store, and a key-provider backed by deployment secret management. KMS/HSM can implement the provider later; it is not an existing capability. The existing chat object store and /files authorization must remain unchanged.

Production config/key-provider wiring and the dedicated Feed directory are not yet implemented.
 
## Existing backend boundary

Current chat file flow remains owner/device-bound or room-member-bound. It includes active-device checks, upload reservation/completion, signed download authorization and object storage. It is not suitable to be made cross-account-readable for Feed by changing its existing policy.

Feed requires a dedicated media domain adapter and isolated namespace. Existing chat routes and MLS behavior must remain unchanged.

## PR coordination

- #171 AUTH: open Draft, shared backend files affected; do not blindly integrate.
- #173 MLS membership security: open Draft and explicitly on HOLD until #169 merges; do not run or rerun its workflows before that dependency is merged.
- #172 Feed scope decision: open Draft, unmerged.
- #174 Feed domain foundation: open Draft; revised proposal is still unapproved until owner reviews it.
- Main remains at 7d34b99fcc026a828b838e211d039c575aeace1d at the time of this report.

The existing shared server/store/schema/config/main files were not changed. No PR was merged. New domain and encrypted-store tests were authored but not executed in this stage; no PASS is claimed.

## Next engineering sequence

1. Complete independent static review of the domain and encrypted-store code/test sources. Tests remain NOT RUN.
2. Implement the Feed key-provider/configuration and isolated filesystem namespace without changing chat storage; verify key version retention/rotation design.
3. Produce evidence-based configurable limits for photo count, byte sizes, codecs, video duration/resolution, rendition profiles and processing resource budgets.
4. Reconcile #171/#173/#169 integration order and capture a fresh exact main SHA before touching shared server/store/schema/config files.
5. Implement Feed media reservation, streaming upload, quarantine, validation/processing, encrypted storage and authenticated delivery.
6. Implement transactional Post/PostMedia persistence, feed/profile queries and cleanup outbox.
7. Verify exact Dart UI sources in all relevant branches before connecting approved screens.
8. Add dynamic security/regression tests and run applicable Actions on the exact final SHA.

## Acceptance status

| Criterion | Status |
|---|---|
| Owner-approved media encryption direction | APPROVED |
| Media-first API proposal | DRAFT, awaiting owner review |
| Pure domain rules adapted to media-first | AUTHORED, NOT EXECUTED |
| Feed encrypted object-store primitive | AUTHORED, NOT EXECUTED |
| Feed media upload/processing/storage integration | NOT STARTED |
| Post/PostMedia persistence and routes | NOT STARTED |
| Authenticated Feed and profile gallery | NOT STARTED |
| Flutter integration | NOT STARTED |
| Dynamic security acceptance | NOT STARTED |
| Beta 1.0 Feed | NOT ACCEPTED |

No WBS weights or progress percentages were changed. No task was closed or struck through.
