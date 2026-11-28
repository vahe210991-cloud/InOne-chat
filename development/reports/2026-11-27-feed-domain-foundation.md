# Feed Beta 1.0 media-first architecture — 2026-11-27

## Status

**Architecture revision and media-first pure-domain slice published to PR #174; production integration not yet started.** Owner approved variant A: a separate server-side Feed media pipeline, TLS in transit, encryption at rest and mandatory authentication. Chat MLS/file pipeline must remain untouched.

- Repository: vahe210991-cloud/InOne-chat
- Main SHA at review: 7d34b99fcc026a828b838e211d039c575aeace1d
- PR #174 branch: feat/feed-domain-foundation-beta1-main-7d34b99-20261127
- Prior PR #174 head: 87783a37fe9361dec477458ff9ad921887d19e97
- Architecture proposal update commit: 7db478a6d4e2491a273188ad0b55cca544eaba35
- Domain implementation commits: a6648bebc7cbbcf5a62d2d8d84316d34087f3a0a, 95711b5f1a3d9bffa438cc9e2b4fe355cc5719c5, 52d3909bf20d61212854afc470b9222e4ac63bf3, and 26b94a6e376064aecddadc735392d651bbbfbc30
- Encrypted object-store commits: fc61e6838508af3383d92db6d1540c2f01d9959b and edf0163f2fae6e1c72f0fff91ec81eed79269a27
- Backend test-entry wiring commit: 54f22ae20c3843f4d34b4a8458ca520274555fd4
- Domain test commits: d182a94eaa7a3ee4f99ff882deef4d8a6e4f751d, 83e6b81af42fd86b8dca2ccbfb9d9129cb22771a, 3f1467bed8acc5b8b48ce9ef396a5ca1d6dd9357, and 8acd93fb329d4bc95a85921fe03c586c408a47e1
- Encrypted-store test commits: c225f81145785bb19427d472e0e2f0c86fe3af5a, d32fe1df23a9cefaefc7be05422c26f23c8290d4, and 894b1a3af94e31cccf276afdab695c5098be629e
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
 

## Media runtime and cryptographic static review — next stage

A source-level inspection was completed against the exact PR branch. No tests or workflows were run manually.

### Confirmed runtime constraints

- The canonical engine is built from `node:22-alpine`; the image runs `npm ci --omit=dev`.
- The production dependency set contains the Matrix crypto WASM package, libphonenumber-js, Nodemailer, PostgreSQL, QRCode and Firebase Admin. No image decoder/encoder, image metadata sanitizer, video probe/transcoder or thumbnail-generation dependency is declared.
- The Docker image installs no FFmpeg or other system media tooling. Therefore the current container cannot yet be treated as a validated image/video processing runtime.
- The filesystem object store supports streaming and atomic temp-file publication. The memory object store buffers full objects and is test-only.
- `config.js` and `main.js` do not yet read Feed encryption keyring settings or construct a Feed-specific encrypted object store. The keyring provider and encrypted adapter remain isolated primitives, not production protection.

### Static cryptographic review

- Rechecked AES-256-GCM chunk nonce allocation, object/key/chunk AAD binding, wrapped-DEK authentication, final-record authentication, counter bounds and key-ID rotation flow.
- Found a key-lifecycle issue: the adapter copied the ephemeral KEK returned by the key provider, leaving the provider-returned copy outside the adapter's zeroization path. Corrected the adapter to adopt the caller-owned ephemeral buffer (and clear Uint8Array input buffers) so its existing `finally` path zeroizes that key material. Added a regression test that checks write/read key buffers are cleared.
- The provider contract is now explicit in implementation intent: `getKey()` must return a fresh, caller-owned ephemeral byte buffer. A provider must not return a shared long-lived internal key buffer.
- `getStream()` is the production read path. The convenience `get()` method intentionally accumulates the complete plaintext object and must not be used for large production media.
- The current decrypt framing parser accumulates source stream chunks while satisfying each frame read. The production filesystem stream currently supplies bounded Node stream chunks, but any future storage adapter must preserve a bounded-chunk contract. This needs to become an explicit adapter invariant or a bounded parser before a non-filesystem adapter is accepted.
- No claim of cryptographic acceptance is made until focused tests, tamper/fault cases and production adapter review run on the final exact SHA.

### Media-processing decision gate

Do not add a guessed package or arbitrary media limits. Before implementation, select and document a supported runtime strategy for:
1. image format identification by file signatures and a real decoder (not MIME/extension trust);
2. safe metadata stripping and deterministic thumbnail/display rendition generation;
3. video container/codec probing and bounded transcoding or an explicit supported-codec passthrough policy;
4. decompression-bomb, pixel-count, duration, resolution, memory, CPU and wall-clock limits;
5. worker isolation, concurrency, temp-file permissions, cancellation and cleanup;
6. Alpine compatibility, reproducible dependency versions and vulnerability maintenance.

The current repository does not provide these capabilities. Keep uploads quarantined and unpublished until a selected processor has decoded and validated the complete input and produced the required derivatives. No media upload endpoint should accept bytes directly into the published namespace.

### Changes in this stage

- Hardened ephemeral Feed KEK buffer lifecycle in `feed-encrypted-object-store.js`.
- Added a regression case to `feed-encrypted-object-store.test.js` for key-buffer zeroization.
- Test remains NOT RUN, consistent with the #169 gate.

## Dart UI re-audit

Reviewed the actual Dart source tree in the following branches: main, PR #171 head, feat/beta1-native-dart-ui-g1-2026-11-18, feat/flutter-ui-dart-migration-2026-11-14, feature/ui-dart-archive-stage1-2026-11-25, audit/feed-profile-beta1-main-216c6d9-20261126 and the profile-workspace branches.

| UI element | Source | Verified state |
|---|---|---|
| Feed navigation tab | mobile/lib/ui_dart_source/widgets/inone_bottom_nav.dart | Exists; enum and visual navigation item |
| Add publication action | mobile/lib/ui_dart_source/widgets/inone_bottom_nav.dart | Exists as a bottom-nav action label/button |
| Feed route | mobile/lib/app/inone_mobile_app.dart | Not connected; selecting Feed shows “section not in connected Beta 1.0 scope” notice |
| Feed screen | mobile/lib/ui_dart_source/screens/main | No Feed screen source found in the inspected branches |
| Create publication / media picker / preview | mobile/lib/ui_dart_source/screens/main and widgets | No corresponding Dart source found in the inspected branches |
| Personal profile | mobile/lib/ui_dart_source/screens/main/inone_profile_screen.dart | Real UI: avatar, nickname/name, handle, stats and menu; no publication gallery |
| Organization profile | mobile/lib/ui_dart_source/screens/main/inone_org_profile_screen.dart | Real UI: cover, logo, description, stats and member list; no publication gallery |
| Profile model | mobile/lib/ui_dart_source/models/inone_models.dart | InOneUserProfile has avatar and profile display fields; no post/media collection |
| Profile repository | mobile/lib/core/data/inone_repositories.dart and inone_profile.dart | Own-profile API model/repository; no Feed/post/media methods |

This is a source-level finding, not an inference from missing backend. The Feed navigation affordance exists, but its route is a placeholder. Profile and organization profile screens are real Dart screens, but they do not currently contain the requested visual publication gallery in the inspected branches. In the current app adapter, the profile handle is populated from the account email; this field MUST NOT be reused in Feed author DTOs, which expose nickname only. The organization profile screen also renders member userId values; this is a separate existing privacy-review item and was not changed in this Feed branch. No approved design has been replaced or changed.

The product instruction that accepted Feed/Create/Preview Dart screens must not be recreated without checking the owner-approved source remains binding. If a separate approved source branch exists outside the inspected branches, it must be identified before Flutter implementation. Backend and isolated media primitives can continue independently.

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
| Feed keyring provider primitive | AUTHORED, NOT EXECUTED |
| Feed media upload/processing/storage integration | NOT STARTED |
| Post/PostMedia persistence and routes | NOT STARTED |
| Authenticated Feed and profile gallery | NOT STARTED |
| Flutter integration | NOT STARTED |
| Dynamic security acceptance | NOT STARTED |
| Beta 1.0 Feed | NOT ACCEPTED |

No WBS weights or progress percentages were changed. No task was closed or struck through.

### Worker and deployment topology finding

- The repository's Compose file is explicitly a development-only PostgreSQL + backend stack. The deployment guide documents direct Node startup behind an HTTPS proxy; no production Compose/Kubernetes/orchestrator manifest or independently deployed media-worker service was found in the reviewed paths.
- The existing in-process email and push workers do not establish a safe media-processing isolation boundary. CPU/memory-heavy or malformed media must not execute inside the public HTTP request process.
- Recommended implementation boundary (not yet wired): a distinct Feed media-worker process/service with bounded concurrency and resource limits, consuming durable processing jobs; the public API only reserves/uploads/quarantines and publishes after the worker reports validated derivatives. It may share a pinned application image only if the chosen media runtime and deployment platform support a separately constrained worker command. Otherwise use a dedicated worker image.
- Quarantine and final encrypted Feed objects must remain in separate namespaces. Worker temp files must be private, bounded, cleaned on success/failure/cancellation, and never served directly. The deployment platform, durable queue, and shared private storage mechanism must be selected before wiring this topology.
- This remains a design recommendation, not an implementation or production-readiness claim.

### Candidate processing stack (research only; not yet added)

The official Sharp installation matrix documents prebuilt Linux x64 and ARM64 musl binaries when musl is at least 1.2.5, and requires a Node-API v9 runtime (Node.js 20.9+). This makes Sharp a viable image-processing candidate for Node 22, but the exact worker base image/digest and musl version must be verified before dependency lock/update and container acceptance: https://sharp.pixelplumbing.com/install/.

For video, use the FFmpeg/ffprobe toolchain inside the isolated worker rather than in the public API process. FFmpeg's own security page records active release branches and security fixes, including the 9.0 line; the worker therefore needs an explicit patch/update policy and vulnerability review before every accepted build: https://ffmpeg.org/security.html.

Recommended boundary for the next design iteration:
- API process: authenticate, reserve, stream to quarantine, enqueue durable work; no media decoder execution.
- Worker: separate process/service, no public ingress, no credentials beyond the minimum private object/queue access, non-root, read-only root filesystem, bounded private temp space, CPU/memory/PID/time/concurrency limits, and network access disabled unless a narrowly documented need exists.
- Image candidate: Sharp for decode, metadata removal and derivative generation; validate magic bytes and decoded dimensions/pixel count before producing fixed server-selected outputs.
- Video candidate: FFmpeg/ffprobe from a pinned worker image; fixed argument arrays with shell disabled, local-file-only inputs, explicit demuxer/codec allowlist, bounded duration/resolution/frame rate and strict process timeout. Do not pass user-controlled URLs or arbitrary FFmpeg arguments.
- Queue and storage: durable processing outbox/queue; private quarantine and final encrypted Feed namespace; atomic transition to READY only after every required derivative is validated and stored.
- Keep exact supported formats and numeric limits open until the product requirements, device/network benchmarks and deployment target are confirmed.

This is a candidate architecture, not a dependency approval or implementation. No package or image was added in this stage.

### Exact-head workflow observation

At PR head `1d5f12af43b96ccc6a5830802e2d43513bf1460b`, GitHub reported six PR workflows in `queued` state: Backend Docker Compose runtime acceptance, Native MLS client validation, Validate recovered InOne P0 source, Dev Container Compose runtime validation, InOne exact-SHA acceptance gate, and Email delivery/PostgreSQL validation. These were automatically queued by GitHub following PR updates; none was manually dispatched or rerun. No PASS is claimed. The #169 dependency remains open and unmerged, so do not manually rerun or treat queued workflows as acceptance.



## Continuation audit — 2026-11-28

### PR #169 dependency status (read-only observation)

- PR #169 remains Draft and unmerged at head `928f1cbf57963f1c4a1835f54216082828b4353b`; its base remains `security/beta1-stage5-supply-chain-main-2026-11-25`.
- No PR #169 branch, commit, file, review, or workflow was modified or manually dispatched by this continuation.
- Existing exact-head workflow observations: PostgreSQL/email, Backend Docker Compose, Dev Container Compose and recovered-P0 validation completed successfully. The OpenMLS 0.9.2 compatibility workflow failed in `grouped_migration_failure_rolls_back_v2_and_retry_preserves_legacy_rows` (7 passed, 1 failed). The exact-SHA gate failed because that required workflow failed. Flutter mobile validation also completed with exit code 124 during the Android emulator/runtime stage. OpenMLS FRB generation and native MLS validation were queued, while Flutter iOS was still in progress at the latest status read.
- These are recorded observations only. They are not authorization to edit PR #169 or to repair its failures. No test was started by this continuation.

### Independent Feed primitive hardening on PR #174

The following source-only changes were committed to the existing PR #174 branch:

- `adfa12c` — enforce a 1 MiB maximum on individual source-stream chunks on both encrypted writes and reads; reject non-byte stream fragments; reject non-canonical ASCII key-ID bytes in the encrypted header.
- `9f52933` — zeroize temporary cursor-signing key copies after HMAC generation/verification, including the invalid-short-key path.
- `1a9fa1e` / `13bde7c` — add regression coverage for oversized stream chunks and non-canonical key-ID bytes; correct asynchronous stream consumption in the test.
- `efd5274` — clear the pending plaintext buffer when encrypted source streaming fails or is cancelled.

Current PR #174 head after these commits: `efd5274d4e05e694998ffcfcfe0f6571e2b602f7`. The new/updated tests have **NOT BEEN RUN**. No test PASS or cryptographic acceptance is claimed.

### Remaining integration gates

- Feed encryption key provider is still not wired into production configuration/startup; no production Feed namespace is constructed.
- Feed-specific filesystem namespace, quarantine store, durable processing queue/outbox and isolated media worker are not implemented.
- Image/video decoder, metadata sanitizer, rendition generator and bounded processing runtime have not been selected or integrated.
- Feed/Post/PostMedia persistence, authenticated upload/delivery routes and cleanup lifecycle are not implemented.
- Flutter Feed/create-publication/media-picker/profile-gallery screens and repository integration remain unimplemented; existing Feed navigation still points to a placeholder.
- The media-first API contract remains a Draft proposal. Variant A is owner-approved; exact format/size/duration/resource limits and the full API contract remain unapproved.
- PR #171 and closed-unmerged PR #175 still have colliding migration versions 0036/0037. Do not merge either migration history without a single coordinated monotonic migration sequence. PR #173 remains on hold until PR #169 is merged.
- Do not start test suites or manually rerun workflows before the PR #169 merge gate is satisfied.

