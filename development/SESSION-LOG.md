## 2026-11-26 — FEED / PROFILE Beta 1.0 audit and plan published

- Audited publications/news feed and personal profile against source snapshot `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`; revalidated against main `920e2a2ecef244c925061348eb68c8b09fe63922`. The two intervening main commits changed only development rules, not FEED/PROFILE source, contracts, schema or Flutter files.
- Published [FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md](FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md) in main at `8260beb7070d959dce17ee423e2768dbea4399c9`; publication-record correction followed at `9166a82448d2e06847e7212982aeecaf0acb9f19`; current plan blob `08b1f984a3ded0543d5c20670c9b4e1d5d6e07ab`. Added [dated audit report](reports/2026-11-26-feed-profile-beta1-audit.md) (initial commit `e43632e0f1e78742f193793c0dc3558cc910b689`, follow-up `06862d1458035c868ad01606bcb4dda50669a1e4`), indexed both artifacts in development README.
- Owner selected privacy variant В: preserve the existing privacy model unchanged. No new public/private defaults, visibility settings, block/follow semantics or broader access are authorized. Current own-profile auth, relationship-gated user search, owner/device file checks and room membership controls remain the baseline.
- Findings: P0 0; P1 1 conditional functional scope gap (feed/posts only if approved for Beta 1.0); P2 6; P3 1. No confirmed P0/P1 security vulnerability was established in the statically reviewed profile/file paths. Dynamic security testing was NOT RUN.
- Feed/posts are absent. Own-profile GET and locale update exist; general profile edit, other-user profile API, avatar/cover binding and social media lifecycle are absent. Generic file infrastructure exists.
- Node/PostgreSQL/Flutter/Dart/Rust/Android/iOS tests and builds, dynamic BOLA/IDOR, production, load and device tests were NOT RUN. Existing test files were inventoried but not counted as PASS.
- No product source, schema/migration, workflow, config or UI changed. WBS v1.1, baseline percentages, privacy policy and release scope remain unchanged. Feed Beta 1.0 vs Beta 2.0 remains an owner decision.
- Draft PR #167 was closed as superseded after direct documentation-only publication; task branch retained. No implementation task was marked complete.

## 2026-11-26 — Direct chats: no recipient approval; automatic MLS provisioning

- Owner clarified that personal messages are delivered without recipient acceptance. A recipient must never be shown an accept/reject request for the chat or message. If the sender is not in the recipient's contacts, a separate contact prompt appears only after the first message has already been delivered.
- Direct-chat `provisioning` is an internal cryptographic state only. The sender initializes Engine B, claims KeyPackages for all active recipient devices, and submits the MLS Add Commit with per-device Welcome. The recipient is added automatically after server acceptance of that commit.
- Added canonical direct conversation pair storage, migration `0036-direct-conversations.sql`, authenticated create-or-open API, pair-only KeyPackage claim/Add Commit authorization, and message-delivery regression coverage.
- Updated Flutter direct conversation DTO and UI wording to remove recipient-approval semantics. Added per-device KeyPackage reserve maintenance after authenticated app loading and app resume.
- Added migration schema assertions, Flutter DTO/repository/preview tests, and registered direct-chat regressions in both backend test suites. Added a Rust/OpenMLS scenario that sends while both recipient devices are offline and verifies delivery to both devices on sync without any accept/reject action.
- Added server-side encrypted last-activity/unread projections, memory-store parity, Flutter unread badges/filter and read-marker badge clearing. Backend and Flutter regression tests were authored and registered; tests/builds have not been run. Do not claim acceptance until GitHub Actions verifies one exact SHA.
- MLS native feature flag remains disabled by default. No merge without explicit owner approval.
- Detailed plan: `development/CHAT-GROUPS-BETA-1.0-IMPLEMENTATION-PLAN.md`; progress report: `development/reports/2026-11-26-chat-groups-beta1-implementation-progress.md`.

---


- Added migration `0037-contacts-and-blocks.sql`, authenticated contacts/accept/block APIs, room-list contact-state projection, and Flutter **Принять**/**Заблокировать** actions. Accept adds the sender to the recipient's contacts; block prevents future direct messages in both directions and reopening the conversation while preserving delivered history.
- Added backend, PostgreSQL migration, repository, room DTO, mapper and Flutter chat-row regressions. Tests/builds have not been run; exact-SHA GitHub Actions acceptance remains pending.
## 2026-11-24 — CTO Beta 1.0 security remediation roadmap recorded

- Added authoritative staged plan: `development/roadmaps/2026-11-24-beta1-cto-security-remediation-roadmap.md`.
- Sequence: Gate 0 exact-SHA acceptance for Stage 1 B-01/B-02/B-03; Stage 2 file streaming/quotas/lifecycle (B-04/B-13); Stage 3 runtime/security boundaries (B-06/B-08/B-09/B-10/B-11/B-15); Stage 4 DB integrity/cleanup/admin atomicity (B-07/B-12/B-14); Stage 5 supply-chain, CI and production operations; final owner-approved release gate.
- Recorded current evidence at SHA `4824dfc3b3f4e3aab5d39b16c1adf934a108d660`: exact-SHA gate #45432827863 FAILURE; iOS run #45432827935 QUEUED at last poll; Backend Compose, Dev Container Compose, Email/PostgreSQL, P0, Flutter mobile and Native MLS runs reported SUCCESS. Stage 1 remains NOT ACCEPTED.
- Updated continuity handoff files. No application source, schema, tests, workflows, secrets, settings or main branch changed. PR #135 remains Draft/open/unmerged.
- Explicitly left ready-file retention as an owner decision; SMS remains out of scope; native MLS remains disabled by default; WBS v1.1 unchanged.

## 2026-11-19 — A2 FRB reconciliation audit started

- Verified `main` remains at A1 merge commit `c939634288db1e7105cfe8d6a7182d4469da1dc4`; A1 PR #95 is merged. Post-merge runs #44519837539, #44519837547 and #44519837614 were not all terminal/successful at inspection; see the A2 report for job-level states.
- Created task branch `feature/a2-frb-reconciliation-2026-11-19` from the exact A1 merge commit. Initial audit report: [2026-11-19 A2 FRB reconciliation audit](reports/2026-11-19-A2-frb-reconciliation-audit.md), report commit `3f6270d54880cc621745b6f67204ab7587f51f5e`.
- Inventoried 30 Rust public functions and found all 25 `MlsSessionBridge` methods overridden by `RustMlsSessionBridge`. Generated bindings are absent from the main source tree, so generated symbol/type/error mapping is not yet verified.
- Confirmed current main `pubspec.lock` omits the declared FRB packages; open PR #90 adds FRB/hooks 2.13.0 but is 30 commits behind main. PRs #90/#94 also modify A2-owned Rust/Dart/workflow paths; those paths were left untouched.
- Static pipeline review found divergent FRB integrate flags, mutable branch checkout in the artifact workflow, mixed PR SHA conventions across workflows, and lockfile regeneration without lock enforcement. Priorities and exact evidence are in the report.
- No source/API/workflow code changed. No local tests/codegen/builds ran: GitHub DNS access from the container failed and Rust/Cargo/Flutter/Dart/Xcode are unavailable. A2 remains NOT ACCEPTED; native MLS and release gate unchanged; WBS v1.1 remains 42% implementation / 31% verification.
- Next: obtain terminal A1 run results; reconcile #90/#94; retrieve generated artifacts from CI; verify actual bindings; then implement deterministic generation and regression coverage on one immutable SHA.

### 2026-11-16 — CI findings after first repair run

- Backend Node suite on PR #67 executed 395 tests: 391 passed, 1 failed, 3 skipped. The remaining failure was an error-message compatibility assertion in `config.test.js`; strict shared key validation was correct, but its message did not preserve the established phrase `must be 32 bytes`. Updated the message without weakening validation.
- Flutter validation confirmed the 73-screen catalogue and imported all approved UI assets (31 screen HTML files, 32 total HTML files, 5 WOFF2 fonts). It then failed because the PR #61 base workflow still had write permission and attempted to push generated assets to a stale branch, receiving non-fast-forward.
- Replaced the Flutter workflow on PR #61 and PR #67 with the read-only workflow from the approved Beta 1 base: no `contents: write`, no commit, no push. The gallery check runs before code generation.
- Also replaced PR #61's Rust-format auto-commit/push job with the read-only `cargo fmt --check` job. The earlier run's rustfmt made no changes and did not push.
- Backend Node, PostgreSQL, OpenMLS, Rust bridge and Flutter checks must be rerun after these workflow/config fixes. Previous run is diagnostic only; not acceptance evidence.

### 2026-11-16 — Beta 1 pre-test CI repair

- Opened stacked PR #67 against Email Delivery PR #61; no merge to `main`.
- CI log review isolated the Node failures to legacy tests selecting email by fixed Russian subject lines instead of stable template identity. The in-memory test transport now exposes template ID and locale, and affected tests assert template identity.
- Production configuration and durable queue now share the same strict 32-byte email encryption-key parser. Production config fixtures include a valid key; malformed-key regression coverage added.
- Recovery locale regression now supplies the active UI locale and verifies both recovery messages preserve it without mutating the saved account locale.
- Flutter gallery validation now tolerates Dart formatting and runs before Flutter project/code generation.
- Found P0 workflow on PR #61 head was restricted to PRs targeting `main`, preventing backend/PostgreSQL/Rust checks on stacked PRs. Removed that base-branch restriction in PR #61 head commit `11937d388c46cd5ad5cdb24dd247ad83142229d9`.
- Validation for PR #67: pending GitHub Actions. Do not claim Node, PostgreSQL, Flutter, or native bridge PASS until jobs complete on the exact final head SHA.

- CH-01 startup sequencing hardened: `data-api-onload` is invoked only after Flutter marks the WebView ready, avoiding lost early bridge messages. The screen now removes hard-coded demo chats, shows live backend room names/roles via `textContent`, and has a visible error target. Login and post-registration login without an authenticated token pair remain on SC-11/waiting.
- CH-01 typed room-list slice added: HTML emits `GET /rooms/mine` with screen ID; Flutter allows only CH-01, uses `InOneRepositories.myRooms()` + `InOneRoomList` validation, then binds room display names/roles via safe text content. Existing backend `rooms-mine.test.js` is the historical runtime test basis; new inventory assertion is NOT RUN. Live Flutter→Node E2E NOT RUN.
- Additional auth safety: a login response without an authenticated token pair remains on SC-11 in a waiting state; it cannot enter the authenticated menu. Device approval claim/poll lifecycle remains incomplete.
## 2026-11-12 — Screen API integration and bridge ownership work

- Started all five Beta 1.0 plan workstreams. Reused A1 and historical test evidence; no repeat A1.
- Added screen API inventory generator/test, Flutter FRB ownership guard/test, backend live HTTP smoke test, and screen API inventory regression test.
- Source ownership: Node/PostgreSQL backend remains archive engine tree; Flutter FRB crate `mobile/rust` links persistent OpenMLS `mls-client` in POC tree; standalone `mls-bridge` is not the Flutter dependency.
- Hardened WebView API dispatch with per-screen allowlist. Added tests for cross-screen/unknown-call rejection.
- Fixed verified-email registration ticket lifecycle: token remains host-only, new registration/logout clears it, registration requires host-held token, then normal login creates authenticated session per D11. Added Dart tests.
- Backend request smoke test now starts real `createServer` and issues HTTP requests to route handlers. Flutter-to-live-backend E2E is still NOT RUN.
- New report: `development/reports/2026-11-12-screen-api-integration-and-bridge-ownership.md`.
- Historical test evidence baseline copied into this branch; exact historical PASS scopes remain unchanged.
- New scripts/tests are committed but NOT RUN because no authorized runner was available in this session. Do not claim green.
- Native MLS remains disabled; PR #45 remains Draft/open/unmerged; no WBS changes.

---

## 2026-11-11 — Conservative repository file cleanup

- Inspected the complete recursive Git tree on the current base (964 entries / 853 files; response not truncated) and grouped exact duplicate blobs by SHA.
- No obvious generated/cache/temp files were present in the inspected tree.
- Removed only `README-ARCHIVE.md` from task branch `cleanup/remove-duplicate-archive-readme-2026-11-11`: it was byte-identical to the retained, version-explicit `README-ARCHIVE-0.6.0.md`, and no internal path references to the generic name were found.
- Preserved repeated engine/archive files, test reports, lockfiles, UI screenshots, owner archives, checksums, fixtures and security evidence because separate paths carry archive/runtime/provenance meaning.
- Verification: full Git tree fetch PASS; removed path returns NOT_FOUND on task branch; retained versioned README fetch PASS; application tests NOT RUN (documentation-only deletion); local `git diff --check` NOT RUN (repository-native API workflow).
- Audit report: `development/reports/2026-11-11-repository-file-cleanup.md`.
- Task branch commit before this log entry: `fd22723a797175ae8eb811f450116de1f4627fd3`.
- No merge, force update, branch deletion, product-code edit, or security-fix edit performed.

---

## 2026-11-11 — Owner-approved repository-native and concurrent-agent workflow

- Owner clarified that GitHub must remain the always-current shared source of truth, while agents may use either a temporary local clone/Codespace or safe repository-native editing depending on task scope and available tools.
- Updated `development/WORKING-RULES.md` with repository-native editing rules, SHA-guarded sequential writes, unique task branches/worktrees for concurrent agents, conflict handling, safe deletion criteria, and mandatory hand-back evidence. This supersedes the blanket stop condition when a task can safely be completed through GitHub.
- Updated root `AGENTS.md` and `development/README.md` to point all agents to the clarified workflow.
- Documentation-only commits were explicitly authorized by the owner and applied directly to `main`; no product code, security fixes, branch refs, or PRs were changed.
- Commits: `823c968096df074c0034f0aeee726a0e4cba5843` (WORKING-RULES), `459a11966cb20c4edb9d0f0f0cdf1c9a0b7a15df` (AGENTS), `c4defca324952ae2d7766195ef1692238d254c75` (development README).
- Next: apply the repository-native workflow to a complete file-tree audit; do not delete files without inspecting content, provenance, references and retention role.

---

## 2026-11-09 10:46 — UI exact-head CI green; original source archive still blocked

- Latest Actions run [#42579006574](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42579006574) completed **SUCCESS** on code SHA `df5c50c6e7f372d3a64f1c10e4bf4464d4a4d121`. Flutter setup/platform generation, geometry, 73-screen gallery, pub get, analyze, tests, Android preview APK and artifact upload all passed.
- GitHub Actions artifact `inone-beta1-android-preview`: 78,561,747 bytes; SHA-256 `e9686dcf5f698f4bb6a33a58cb205a0bf2f3c0b4e7fe1472e695488476018968`; expires 2026-11-23 07:29 UTC. This is the APK artifact, not Ui.zip.
- Reverified mounted `Ui.zip`: 5,970,074 bytes; SHA-256 `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`; ZIP integrity PASS. The original source archive is still NOT in GitHub.
- Transfer remains BLOCKED: current GitHub connector has no binary file-stream/release-asset action and container has no GitHub network. No false upload claim or substitute artifact was made. Need authorized binary-capable git push/Codespace/uploader, then verify remote hash.
- PR #35 remains draft/open/unmerged. No server/deploy/DB exposure. WBS unchanged: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%; historical InOne 25%.
- Detailed status: `development/reports/2026-11-09-1046-ui-source-upload-check.md`.

---

## 2026-11-09 10:30 — UI integration exact-head CI completed

- Actions run [#42578785134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42578785134) on PR #35 head `8d3282b2bca16deb09af7bac98642c8abf35aec7` completed **FAIL**.
- PASS: Flutter setup/platform generation, geometry validation, 73-screen gallery integrity, pub get, analyze, and **53 Flutter tests**.
- FAIL: Android debug APK due Gradle wrapper download HTTP 504 for `gradle-9.3.1-all.zip`; artifact upload skipped. No app compilation failure demonstrated; APK remains unverified and CI not green.
- Detailed report updated: `development/reports/2026-11-09-1015-ui-integration-start.md`. UI binary source import remains blocked and must not be claimed complete.

---

## 2026-11-09 10:27 — Exact-head Flutter CI progress

- PR #35 head `8d3282b2bca16deb09af7bac98642c8abf35aec7` triggered Actions run [#42578785134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42578785134).
- Flutter setup/platform generation, geometry check, 73-screen gallery validation, pub get and analyze PASS; Flutter tests still IN PROGRESS at last check; Android APK and artifact upload not started. Workflow is NOT GREEN yet.
- Report updated: `development/reports/2026-11-09-1015-ui-integration-start.md`. Original UI binary package remains not uploaded; blocker unchanged.

---

## 2026-11-09 10:22 — UI source compatibility/security audit addendum

- Verified v2 UI bridge is no-network/no-storage and local WOFF2 refs; v1 screens use Google Fonts and localStorage for theme preference, with bridge events omitting screen ID. Importer now patches only runtime copies to local fonts; originals remain unchanged. Flutter parser accepts legacy v1 events.
- API audit: v1 `POST message` and multiple v2 auth/recovery/org-document/push/per-room-event routes are not in verified backend allowlist; keep blocked. No invented routes.
- CI run #42578333371: setup/geometry/gallery/pub get/analyze/tests PASS; APK build IN PROGRESS at last check. Run is pre-latest commits; current head CI not verified.
- Ui.zip is verified locally but not yet uploaded to GitHub; exact binary import remains BLOCKED by connector file-stream limitation. Report and continuity records preserve checksums and blocker.

---

## 2026-11-09 10:15 — Beta 1.0 UI integration stage 1 / WBS owner approval

- Owner explicitly approved the Beta 1.0/Beta 2.0 WBS; `development/PROGRESS-BASELINE.md` v1.1 is marked owner-approved. Fixed baseline: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%; historical InOne overall 25% retained.
- Root AGENTS.md and Copilot instructions now require reading the approved WBS; development README and continuity entrypoints link it as the common base for every agent/chat.
- Ui.zip outer SHA-256 `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`; nested archive SHA-256 `d098738ff64fab0388aa72d22a92b097940c41bbcb4acfddfc30ff745e16ad0d`. Both ZIP integrity checks PASS; nested package 231 entries / 7,432,843 bytes; 24 manifest screens, 31 HTML screens total, five fonts; all 10 approved.sha256 entries PASS.
- UI integration foundation committed: stable ID → local asset path mapping, rootBundle loader, path tests, deterministic import tool. Full binary/source import is still BLOCKED: available GitHub connector cannot stream mounted binary files and container has no GitHub network. No false claim of upload; preserve source attachment and checksums.
- API contract mismatch remains: CH-02 `GET /rooms/:id/events` is not in API inventory. Do not invent endpoint.
- Flutter analyze/tests, Actions, Android/iOS runtime and golden visual checks NOT RUN for this stage. No server/deploy/DB exposure. Main unchanged.
- Detailed report: `development/reports/2026-11-09-1015-ui-integration-start.md`.

---

## 2026-11-08 — Codespaces configuration drafted; full-clone protocol blocks verification

- Owner selected GitHub Codespaces for the InOne test environment.
- Added unverified Codespaces scaffolding on `feat/beta1-full-screen-api-harness`: `.devcontainer/devcontainer.json`, `.devcontainer/docker-compose.yml`, `.devcontainer/start-backend.sh`, and `docs/CODESPACES_TEST_ENVIRONMENT.md`. Related earlier commits on this branch also add a local API URL resolver and document local Flutter API defaults.
- Latest checked branch HEAD: `cb013d561f720f14e30b85cef963c513cc65f9b7`; draft PR [#28](https://github.com/vahe210991-cloud/InOne-chat/pull/28) remains OPEN and unmerged.
- **BLOCKED — repository working protocol:** this session had only GitHub connector file/tree/API access and did not obtain a complete clone with full history, refs, submodules and LFS verification. Therefore the required `git status`, full-tree diff review, compose validation and local test commands could not be run. Stop source changes until a complete Codespace clone is opened and verified against this branch.
- **NOT RUN:** Codespace creation, container build, PostgreSQL startup, backend startup, migrations, `/healthz` and `/readyz` requests, Flutter connection, and actual API probe validation.
- Latest Actions run for HEAD: [#42509620990](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42509620990) was `in_progress` when checked. Earlier Flutter runs on preceding commits failed at `flutter analyze`; inspect annotations/logs and correct those failures after the full clone. Do not claim CI green.
- The 34 configured screen probes are route declarations, not proof of 10 live-connected screens. The backend source audit showed `GET /rooms/mine` is absent; probes for `GR-01` and workspace room listing were removed. Live screen acceptance remains NOT RUN.
- Next: owner creates a Codespace on `feat/beta1-full-screen-api-harness`; verify full clone, refs, clean worktree, and PR head; then validate/fix devcontainer compose and startup script, run backend/API tests, inspect Flutter analyze failure, and only then continue toward 10 verified screen integrations.

# InOne development session log


## 2026-11-08 — Post-merge P0 validation passed; stage closed

- Added push-to-main validation for the P0 workflow in commit `e30fcd02380327cd9efed94d85c05a3e6dccf3ce`; formatting auto-commit remains limited to PR runs.
- Post-merge GitHub Actions run [#134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744) completed with **success** on main code SHA `e30fcd02380327cd9efed94d85c05a3e6dccf3ce`.
- All six jobs passed: Rust 1.91 format, P0 room-list regression, Backend Node suite, PostgreSQL integration suite, Rust bridge check/tests, OpenMLS client check/tests.
- PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) remains CLOSED / MERGED at `97024ab03ce9583e298ee946f3679565007405ca`; current main HEAD after documentation-only closeout updates is `a676f9bede7fbf21e2717cf35fc9ac5b1cc37918`.
- P0 backend/Rust/OpenMLS acceptance is fully closed. Flutter Beta 1.0 native integration remains separate scope.
- Permanent owner bundle path and no-reupload rule: `development/ARTIFACT-RETENTION.md`.
- Final report: `development/recovered-source/P0-CLOSURE-2026-11-08.md`.



## 2026-11-08 — P0 accepted and merged

- Final PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) merged into `main`; merge commit `97024ab03ce9583e298ee946f3679565007405ca`.
- Verified `main` HEAD equals the merge commit; PR state CLOSED / MERGED.
- All six required jobs passed on exact PR head `addd47da245b6452c9f700c7e10b8d0585aad295` in workflow run [#124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362): Node, room-list, PostgreSQL, OpenMLS, Rust bridge and Rust 1.91 formatting.
- Source provenance checked against owner bundle HEAD `16eab726106ae04b4979af2a1646c2052233b87c`; common ancestor `6fba6601e53a03da9652d0f76982c0b5d1bf8d3a`. Four bundle-only commits are docs/CI-only; 19-file P0 delta is recorded in PR #25 and the closure report.
- Owner bundle permanently stored on `artifacts/p0-bundles`, SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`.
- P0 backend/Rust/OpenMLS acceptance is closed. Native Flutter Beta 1.0 integration remains a separate scope. No separate post-merge push run was returned; run #124 is the successful PR merge-candidate validation.
- Closure report: `development/recovered-source/P0-CLOSURE-2026-11-08.md`.


This log is a durable GitHub record. Add newest entries at the top. Keep each entry factual and link commits, PRs, workflow runs, and test evidence.

## 2026-11-08 — GitHub P0 source recovery verified; acceptance still open

- Rechecked repository refs and found published branch `recovery/p0-wave3-applied`, exact HEAD `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`; draft PR [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22) is open and unmerged.
- Located the P0 workflow source under `inone-development-archive-0.6.0/engine/`; the repository also has a separate `inone-engine-poc-0.6.0/` tree, which must not be assumed identical.
- Exact-head Actions push run [42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and PR run [42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297): Node 369/369 PASS; room regression 2/2 PASS; PostgreSQL 43/43 PASS; OpenMLS client tests PASS (all test binaries); Rust bridge 3/3 PASS.
- Overall workflow remains FAIL because `cargo fmt -- --check` reports formatting-only diffs in 12 Rust files. Do not call this green; preserve source baseline and make formatting a separate commit after hash audit.
- Source-integrity acceptance remains open: complete original bundle 240-file blob-hash audit and verification of six substantive changed files plus five added P0 test files are still required.
- Added `development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md` with exact refs, test evidence, blockers and next actions.
- Original bundle SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f` is preserved as provenance, but the original binary and original Git ancestry are not yet stored in GitHub main.
- No merge; no changes to `main`; P0 remains the sole active priority.


## 2026-11-08 — Establish development folder and handover protocol

- Added the mandatory `development/` entry point, working rules, baseline, and start/end checklist.
- Verified owner-provided ZIP contains a complete Git bundle and companion architecture map.
- Verified bundle SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`, bundle ref `engine/p0-wave3`, HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, five commits, and complete history.
- Bundle verification report says its history has no common commit with GitHub main. Do not force-push or treat it as a fast-forward.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) is the isolated patch-based validation/import path. Its workflow status and any published applied-source branch must be verified live.
- PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17) preserves reference artifacts only.
- JavaScript/MJS syntax check: 135 files PASS (syntax only). Full Rust/DB/Flutter acceptance not run in the local environment.
- Product Flutter Beta 1.0 source is not in the P0 bundle; do not claim a phone-ready app.
- Owner decision retained: independent InOne backend/database for Beta 1.0; shared InOne+Propo operational DB deferred.
- Next: verify PR #18 workflow status and resulting branch; import the exact architecture map and provenance files into GitHub; then continue toward Flutter source recovery and a runnable Android test build.


## 2026-11-08 — PR #18 CI investigation and correction

- Fetched workflow run [42453233555](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42453233555): **FAIL**.
- Job `validate`: patch decode/apply PASS; npm ci PASS; backend npm test FAIL (365 total, 364 pass, 1 fail); room-list, PostgreSQL, OpenMLS, and bridge tests SKIPPED. Publish job SKIPPED.
- Exact failure: `ERR_MODULE_NOT_FOUND` for `client-reference/biometric-client.mjs` imported by `test/client-reference.test.js`.
- Checked bundle commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`: file exists with blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`.
- Restored exact file to PR #18 branch: commit `04a490e9a01cf7523fb45205a8077f5f357c2658`; fetched GitHub blob SHA matches the bundle blob SHA.
- Updated workflow path filter: commit `762e3eca8ccb2e34965441114cc29b63083aa0f9`.
- Fresh Actions run for the new head was not visible at the last check. Do not report the correction as validated until a new run completes.
- Important correction: matching the eight P0-modified file blobs did not prove the full base tree was identical. Continue auditing missing base files before acceptance.
- Original binary bundle remains pending durable GitHub storage; architecture map and bundle verification report have been committed under `development/recovered-source/`.


## 2026-11-08 — Corrected P0 validation rerun submitted

- Restored `client-reference/biometric-client.mjs` from the exact bundle base commit into PR #18 branch. GitHub blob SHA matches `b03e72fe33c79e6b261d980bc86459babf03b388`.
- Workflow filter updated; branch head is `762e3eca8ccb2e34965441114cc29b63083aa0f9`.
- Opened validation rerun PR [#19](https://github.com/vahe210991-cloud/InOne-chat/pull/19) from the same corrected head because the first run had failed and the updated-head run was not initially visible. PR #18 remains the primary recovery PR; #19 is a duplicate validation trigger and should be closed as superseded after fresh CI is verified.
- GitHub Actions runs [42454943853](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42454943853) and [42455077322](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42455077322) were both `in_progress` at last check. Patch decode/apply and npm install passed; Node `npm test` still running. PostgreSQL and Rust not yet reached.
- Owner's `INONE_INTEGRATION_BRIEF.md` committed at `development/integrations/INONE-PROPO-AUTH-INTEGRATION-BRIEF.md`; status Planned, no production integration implementation assumed.


## 2026-11-08 — Biometric vector fixture gap and replacement

- Corrected runs #42454943853 and #42455077322: Node 368/369 passed; sole failure was missing `client-reference/vectors/biometric-vectors.json`. The restored client module's C1–C4 tests passed. PostgreSQL and Rust steps skipped.
- Original fixture bytes were not accessible. Added a clearly labelled replacement fixture to PR #18 (commit `bdedff6df54876e82f46a34d27f2fadfac42b46d`), not claimed as original. It uses P-256/SHA-256 DER base64url; two positive and two negative cases verified locally using Node crypto.
- Workflow path filter updated in commit `ee7a877aedb43ca90df8cd410dbf536c2f436668`.
- Latest run [42457009510](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457009510) is in progress. Await Node -> room-list -> PostgreSQL -> OpenMLS -> Rust.
- Closed duplicate PR #19 as superseded; PR #18 is primary. No merge.


## 2026-11-08 — Exact biometric vector fixture recovered

- Tree audit found original root source at `inone-development-archive-0.6.0/client-reference/vectors/biometric-vectors.json`; source blob SHA `5a00755946219df2527591f00058a19d167c7811`.
- Copied exact file into `engine/client-reference/vectors/biometric-vectors.json`; restored blob SHA exactly matches source. Matching client reference file in root has blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`.
- Original vector file verified locally: 1 positive, 2 negative cases behave as expected.
- Temporary generated fixture was superseded; latest PR #18 head `c9eaf6e198d1b65549220d3742b5190d7bbc1a39` contains the exact original fixture.
- Latest Actions run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) queued. Run #42457009510 was against the temporary fixture and is superseded.


## 2026-11-08 — Repository-wide Flutter source audit

- Read recursive main tree SHA `89ba83a4cbd06b648cba8ea5a7c529bfd91285e7`: 602 entries, not truncated.
- Only five Dart files plus one pubspec under `client-reference/dart`; package README explicitly says unverified and no Flutter selection screen. No app `main.dart`, widget tree, mobile platform project, or ARB localization.
- 0.7 client-screens folder contains JS API/state spike and docs only.
- Checked other active branches (CTO audit, CI validation, recovery, development, engine-poc, localization); none contains Flutter app source.
- Added `development/REPO-AUDIT-2026-11-08.md` commit `a2f396a7169c5e0220821c44a5ef2e1e87066f89`.
- This is a hard blocker for hands-on phone Beta 1.0 until original Flutter UI/API artifact and exact design system are imported into GitHub. Do not reconstruct approved UI from memory.


## 2026-11-08 — Publish branch completeness fix

- Code review found the publish job would start from clean main and apply the P0 patch but omit the two restored client-reference files that were present during validation.
- Updated workflow in PR #18 commit `e0a8c08ddf68864963c3f8a65ba16a0612381e39`: fetch exact client-reference files from PR head into new main-based recovery branch before patch application.
- Run [42457297299](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457297299) queued on workflow fix. Older exact-fixture run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) does not validate this publish-job correction.


## 2026-11-08 — Original bundle reverified from mounted conversation upload

- Located `/mnt/data/Bundle(1).zip` (outer ZIP 1,061,251 bytes; SHA-256 `a7ccfc12ae810dc1788f1b737ef4d53e032cafaf35797412784073a2db57f5a0`).
- Extracted `inone-engine-p0-wave3.bundle` (1,052,468 bytes; SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`).
- `git bundle verify` succeeded: complete five-commit history, ref `engine/p0-wave3` at `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`, 240 tracked base blobs.
- Corrected earlier statement: GitHub connector exposes `create_blob(encoding=base64)`; current limitation is getting mounted local bytes into the Code Mode action call. Container Git push attempted and failed at DNS resolution; no Git credentials configured.
- Detailed status and hashes saved to `development/recovered-source/README.md` commit `4b3074c5a2c4f4310d58ab6fe10e8ef687846b9a`.


## 2026-11-08 — P0 CI Node and room tests green; PostgreSQL client mismatch

- Run #42457297299: backend Node tests 369/369 pass; P0 room-list regression 2/2 pass; PostgreSQL 42/43 pass. Only failure was backup/restore because newer runner pg_restore emitted `SET transaction_timeout=0` unsupported by PostgreSQL 16.
- Corrected workflow to pin Ubuntu 24.04 and PostgreSQL client 16 in commit `0e13b9726c5fcbecfdb8a9a45b05d4bb6eb02863`.
- Fresh run #42457594088 in progress at last check. No full acceptance; OpenMLS/Rust skipped in failed run.
- Report: `development/recovered-source/CI-RESULT-42457297299.md`.


## 2026-11-08 — P0 base-tree path parity restored

- Compared bundle base tree (240 blobs) to archived GitHub engine tree (225 blobs); identified exactly 15 missing paths.
- Restored all 15 paths to PR #18 branch, with exact blob provenance documented in `development/recovered-source/BASE-TREE-RESTORATION.md`.
- Recovery branch now has 240 engine blobs, matching base path count. This is path parity, not yet full blob hash parity for all 240 files.
- Publish workflow now applies the entire PR-head engine-path diff onto clean main before the P0 patch, preserving all restored files. Workflow commit `7898fde9a592a8c180e7c9e89a2c7b3cb2e5ad80`.
- Fresh CI required; run #42457594088 predates the latest workflow change.


## 2026-11-09 12:11 — Owner UI archive imported; Flutter CI green

- PR #36: https://github.com/vahe210991-cloud/InOne-chat/pull/36; task branch `task/ui-archive-import-2026-11-09`.
- Fixed HTML inventory check (31 screen HTML + package index = 32 HTML) and GitHub Actions checkout target (real PR head instead of synthetic merge ref); added PR-scoped concurrency.
- Workflow run [#42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987) completed 15/15 steps SUCCESS on input SHA `478cad39bc39e8002e55293e3015e72b68e26c8c`.
- CI fetched `Ui.zip` from main and verified SHA-256 `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`; imported nested package to `mobile/assets/ui-approval/`.
- Remote tree check: 230 paths under asset root; 31 screen HTML files, 32 HTML including index, 5 WOFF2 fonts; manifest v0.8-approval-batch-2, 24 manifest screens.
- Flutter pub get, analyze, tests, Android preview APK build and artifact upload all PASS. Artifact ID 13659118446, 78,584,647 bytes, digest `sha256:6376ba35cdebe92f200bfbe27b197918722d5564ef5d93a0210f1714c433d53a`, expires 2026-11-23 08:40 UTC.
- Import bot commit advanced branch to `cb09a4058719576df6d589f1f8b59be517b592b5`. The workflow tested the workspace after import but run's event SHA is prior commit `478cad39...`; request an independent CI run on the new head.
- PR remains draft/open/unmerged; main unchanged by this task. Runtime WebView rendering, live API/bridge, visual parity and device E2E remain unverified.
- WBS baseline v1.1 unchanged: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%; overall historical 25%.


## 2026-11-11 — Beta 1.0 Stage 4 single-executor continuation

- Owner instruction: ChatGPT is the sole developer/executor; do not assign or assume an external agent. Current product stage is Beta 1.0 only; Beta 2.0 is out of scope.
- Preserved approved WBS v1.1 weights and Beta 1.0 baseline (42% implementation / 31% verification). No percentage increase claimed.
- Added native MLS build-time feature gate defaulting to disabled; hardening changes cover logout key deletion, inbox replay idempotency, concurrent session initialization/handoff, Android JNI initialization error propagation, malformed MLS event rejection and crypto-error propagation.
- Made iOS Protected Keychain runtime validation require signing secrets rather than silently accepting a skipped test.
- Added report `development/reports/2026-11-11-stage-4-single-executor-progress.md`.
- Latest source head at report time: `048db63a7817b28e38a3a8353f8665a713f56730`; report commit: `a73f59a253224eefa7b794c708666a3a20153519`.
- CI runs #42976612169 (OpenMLS client) and #42976612175 (FRB) failed before the first step: `runner_id=0`, empty step arrays, no retrievable job logs. iOS dependent job skipped. Flutter mobile workflow is intentionally skipped for the Stage 4 branch; FRB workflow is intended to run Flutter analyze/tests and Android build.
- No test command ran. Stage 4 is NOT ACCEPTED; no merge or deployment performed.
- Critical open review item: OpenMLS provider storage and client metadata use separate SQLite connections; crash atomicity between ratchet-state mutation and durable inbox persistence is not yet established. Requires crash/restart test and a proven atomic/recoverable design.
- Next: resolve runner allocation; implement/test MLS state + inbox atomicity; run Rust/OpenMLS, FRB, Flutter, Android Keystore and signed iOS Protected Keychain gates on one exact SHA.


### 2026-11-11 — Post-report CI recheck

- PR #45 documentation-updated head: `87089c610e03ba5302b316db07baa2d44d71260a`; source code head remains `048db63a7817b28e38a3a8353f8665a713f56730`.
- Latest OpenMLS run #42976768215 and FRB run #42976768182 again failed before step 1 with `runner_id=0` and `steps=[]`; iOS dependent job skipped.
- Flutter mobile run #42976768225 was skipped by the Stage 4 branch condition.
- No source test executed; Stage 4 remains NOT ACCEPTED. Updated report section 8.


### 2026-11-11 — MLS persistence transaction refactor

- Refactored `mls-client` to use one SQLCipher connection for OpenMLS storage and client metadata.
- Added a transaction-backed generic `DeviceProvider`; incoming MLS processing, ratchet-state writes, inbox row and processed marker now share one SQLite transaction. On failure, rollback and reload group state.
- Wrapped server commit processing/merge, room creation and Welcome adoption in transactions.
- Invite and revoked-device commits are staged and merged locally only after server acceptance; rejected commits are cleared without advancing the local epoch.
- Added OpenMLS provider transaction rollback/commit regression and pending-commit discard regression. These tests are committed but have NOT executed.
- Latest source SHA: `c8ba8f99c45cd532b0941fd774304b6763429511`.
- CI #42977451436 (OpenMLS client) and #42977451456 (FRB) failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. No source tests executed.
- Updated detailed report section 4.1 and section 9. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — Pending-commit restart reconciliation

- Added `sync_room` reconciliation: clear an unmerged local pending commit before applying authoritative server state; reject synchronization if local MLS epoch is ahead of server epoch.
- Source SHA: `e4133120d59ea833dd010bdaa10a7f7a4f281375`.
- CI #42977699906 and #42977699954 again failed before step 1 with runner_id 0 and empty steps. OpenMLS rerun #42977708226 repeated the same result; FRB rerun #42977708143 remained queued at inspection.
- Updated report section 10. No test executed; Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — Logout/session race hardening

- Serialized logout against in-flight login, session restoration, MLS handoff and refresh operations.
- Blocked new login/adoption/API requests while logout is active; in-memory credentials are always cleared even if persistent identity deletion fails.
- Added regression test for logout during a blocked native MLS handoff.
- Source SHA: `404775ff54c5e8a5eee175eb8d908c6c6929e2c0`.
- CI #42977937179 (OpenMLS) and #42977937116 (FRB) failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. No tests executed.
- Updated report section 11. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — Welcome ACK and SQLCipher key recovery

- Added a durable Welcome ACK marker in the same transaction as the joined OpenMLS group and room index; retries ACK after restart without processing the same Welcome twice.
- Split KeyStore existing-key lookup from key creation. Resume now refuses to create a replacement key; existing SQLCipher DB without protected key fails closed.
- New-session creation checks DB/key consistency and attempts to remove partial DB/sidecars and a newly created key if initial construction fails.
- Added tests for missing-key resume, existing DB without key and sidecar detection; not executed.
- Source SHA: `da844b08240c3e67762997be9b65d8e91cab120f`.
- CI #42978533658 (OpenMLS) and #42978533643 (FRB) failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. No tests executed.
- Updated report section 12. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — Post-key-recovery CI recheck

- PR #45 current head after report/continuity updates: `24e9a15e1fbc8446a18e68c84a779abe7a865729`; product source head: `da844b08240c3e67762997be9b65d8e91cab120f`.
- OpenMLS run #42978646222 and FRB run #42978646245 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. Flutter mobile run #42978646254 skipped by branch condition.
- No source tests/platform builds executed. Updated report section 13. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — Logout/key-handling follow-up

- Rust logout now catches remote logout panic and recovers poisoned session mutex so local SQLCipher/sidecar and platform-key cleanup still runs; added poisoned-lock regression.
- Dart clears refresh token immediately after native open succeeds, before access-token snapshot.
- Rust bridge initialization retry clears a failed cached initialization future.
- Source SHA: `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.
- CI #42979003433 (OpenMLS) and #42979003356 (FRB) failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. No tests executed.
- Updated report section 14. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — CI recheck on current PR head

- PR #45 head: `ca49b376a65766fb59e792cf2097ba7b4f2b50ce`; source head: `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.
- OpenMLS #42979080737 and FRB #42979080732 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped; Flutter mobile #42979080672 skipped by branch condition.
- No tests or platform builds executed. Updated report section 15. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — Secret-memory zeroization

- Added RAII zeroization for Rust session tokens, SQLCipher key buffers, keyring byte buffers, request/response token JSON, authorization header copies and serialized token pairs.
- Wrapped access/refresh token arguments at the Rust FFI open-session boundary.
- Added `has_database_key` to check key presence without returning key bytes; all KeyStore implementations updated.
- Source SHA: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.
- CI #42979859714 (OpenMLS) and #42979859709 (FRB) failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. No tests executed.
- Updated report section 16. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — CI recheck on current PR head after zeroization

- PR #45 head: `c103cc2ae4eaa9e3ce721101f3581f3b6047e138`; product source head: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.
- OpenMLS #42979954916 and FRB #42979955089 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped; Flutter mobile #42979954833 skipped by branch condition.
- No tests executed on current PR head. Updated report section 17. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — Sole-executor instruction, source hardening and CI state

- Owner confirmed Beta 1.0 is the current development stage and ChatGPT is the sole executor; no external agent is involved unless owner explicitly enables one later.
- Fixed confirmed Rust identifier defect in `mobile/rust/src/api/session.rs`; removed duplicate `path_provider` in mobile pubspec.
- Made Android/iOS native key-store initialization and Android JNI context initialization retryable after failures.
- Added HTTPS/local-debug API origin validation in Rust and Flutter, rejected origin credentials/query/fragment, disabled redirects to protect bearer tokens, added regression tests and documented the policy.
- Corrected bridge documentation for decrypted SQLCipher inbox history and acknowledgement state.
- Current PR #45 head: `84248642e05e03c976a6f8d0eae0a9ab03a64765`.
- CI #42981617948 (OpenMLS) and #42981617913 (FRB) FAILED with no step summaries; job-log downloads returned BlobNotFound; iOS dependent job skipped. Flutter mobile #42981617907 skipped by Stage 4 branch condition.
- Local environment has Node/npm/Java but no rustc, cargo, Flutter, Dart or Xcode. No local tests/builds were executed.
- Exact GitHub job failure cause remains UNKNOWN. All source changes in this entry are unverified until CI or an authorized build environment executes the tests.
- Beta 1.0 WBS v1.1 is unchanged. Stage 4 NOT ACCEPTED; do not merge or enable native MLS.


### 2026-11-11 — Credential-retention hardening

- Rust login and device-approval JSON responses are zeroized after token extraction; one-time code and poll secret use Zeroizing.
- Flutter login result excludes access/refresh tokens, approval code, poll secret and approval ID; response maps are cleared after ownership transfer.
- Flutter refresh response fields are cleared; request body bytes and bearer headers are cleared after send.
- Added regression assertion that login results do not expose auth secrets.
- Source/PR head: `6e56671b632c993ebd15735caf5001ad2662012a`.
- CI #42982066347 (OpenMLS) and #42982066366 (FRB) FAILED with null steps/log URLs; iOS dependent job skipped; Flutter mobile #42982066410 skipped by branch condition.
- No tests executed. Stage 4 remains NOT ACCEPTED.


### 2026-11-11 — P0 parity audit of active mobile MLS client

- Compared active Stage 4 client `inone-engine-poc-0.6.0/mobile-mls/mls-client/src/lib.rs` with accepted P0 reference `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/src/lib.rs` and P0 acceptance map.
- Confirmed active client lacks durable Welcome receipts/ACK retry, membership journal/fingerprint, KeyPackage claim replay, WaitingForCommit, Commit quarantine and sticky RecoveryRequired.
- Confirmed active invite still uses legacy GET KeyPackage endpoint rather than P0 claim ID reservation/replay.
- These are active mobile-runtime gaps; archived P0 acceptance does not prove the Beta 1.0 mobile runtime contains them.
- Added F1/F4/F5/P0.3 and claim/replay porting tasks to the Stage 4 checklist. No tests were run.


### 2026-11-11 — Single-executor re-audit and local purge hardening

- Owner confirmed: Beta 1.0 is the active stage; ChatGPT is the sole developer/executor. No external agent is assigned.
- Corrected the earlier P0 parity audit: active mobile MLS source now contains Welcome receipts/ACK retry, membership journal/fingerprint, KeyPackage claim/replay, WaitingForCommit, Commit quarantine, RecoveryRequired and event identity validation. Six active test files have the same Git blob SHA as their accepted P0 archive counterparts. The earlier claim that these mechanisms were absent is superseded; source parity does not prove test execution.
- Added cleanup_local_session_with_key_store so SQLCipher DB/WAL/SHM/journal removal still runs if platform Keystore/Keychain initialization fails; key deletion remains explicitly unconfirmed in that case. Added purge_removes_database_even_when_platform_key_store_initialization_fails.
- Product source commit: 4670646558723ae5b33eeffdaa105f3a6df209ed. New regression is not executed.
- Reviewed FRB workflow and mobile source. Generated Dart/Rust bindings, build hook and Rust lockfile are absent; the mobile README now documents the pinned code-generation sequence.
- Found iOS workflow mismatch: current workflow builds with --no-codesign and does not import/reference the signing secrets described in previous docs. Protected Keychain runtime acceptance is not proven; signed workflow must be implemented.
- Reran latest available earlier-head CI: OpenMLS #42985487129 and FRB #42985487107 still failed with no retrievable steps/logs; iOS dependent job skipped; Flutter mobile #42985487102 skipped by branch condition. No tests executed on the new source commit; connector returned no run records for it.
- Local environment has no Rust/Cargo/Flutter/Dart/Xcode and no external network access. No local tests/builds claimed.
- Updated report section 25 and mobile/README.md. Beta 1.0 WBS unchanged; Stage 4 NOT ACCEPTED; native MLS flag remains false.


### 2026-11-11 — Single-executor Stage 4 hardening and verification gate

- Owner confirmed Beta 1.0 is the active product stage and ChatGPT is the sole developer/executor until the owner says otherwise. No external agent used.
- Source branch: `feature/stage-4-native-mls-runtime-2026-11-11`; recorded HEAD `df53ff48a42d9b9ca1dc7b19f049f8f3b05585a6`; PR #45 remains OPEN/Draft.
- Added membership reconciliation, P0.2 staged Commit metadata verification, durable membership Commit journal, idempotent KeyPackage claims/replay, stale epoch rebase and journaled device removal.
- Added durable Welcome receipt/ACK recovery, WaitingForCommit state, Commit quarantine, late-event/unreadable handling, API response shape validation and per-room outbox isolation.
- Added Rust/Flutter recovery diagnostics and safe invite cancellation; updated Flutter bridge fake.
- Updated native logout integration test to verify local SQLCipher database and platform key cleanup when the server logout endpoint is unreachable.
- Updated OpenMLS client CI to test exact PR head with P0 archived engine fixture. iOS signed protected-Keychain runtime smoke is conditional on signing secrets; a skipped step is not PASS.
- Latest CI on recorded HEAD: OpenMLS #42986269774 FAILURE with no step summary/logs; FRB #42986269879 FAILURE with no step summary/logs; Flutter mobile #42986269746 SKIPPED by configured branch condition. Job log retrieval returned BlobNotFound. Exact cause UNKNOWN.
- Rerun attempts did not provide step summaries or logs. No local Cargo/Rust compiler available; no local test results are claimed. No Stage 4 test is marked PASS.
- Detailed report: `development/reports/2026-11-11-stage-4-native-mls-hardening-progress.md`.
- Acceptance: Stage 4 NOT ACCEPTED / BLOCKED. Beta 1.0 WBS v1.1 baseline unchanged at 42% implementation / 31% verification. Do not merge.


### 2026-11-11 — CI privilege isolation and exact-SHA gate

- Refactored the FRB workflow: default contents permission is read-only; only a separate generated-artifact commit job has contents:write; it rejects symlinks and copies only allowlisted generated outputs.
- Added a read-only final-SHA verification job that reruns Rust formatting, native bridge tests, persistent OpenMLS/P0 engine integration tests, Flutter analyze/tests, Android APK build and Android Keystore runtime smoke test on the exact generated commit.
- iOS job now depends on exact-SHA verification, checks out that SHA, requires signing secrets, validates certificate/profile/team/app/keychain-group/expiry, configures manual signing, runs Protected Keychain smoke test and verifies app signature/entitlements. Temporary signing material is cleaned up.
- Corrected macOS base64 decoding to `base64 -D`; checked iOS profile and certificate team match.
- Workflow source commit: `00efe8fd002a78f3bb0dbbc2033b9581eda8efec`; subsequent signing/verification fixes: `a754735ca14ffe274f720590a09ceb5b88b9bfcb`, `56102098427b8853b746b94d8c073c5aa97d0c2c`.
- Latest PR head: `56102098427b8853b746b94d8c073c5aa97d0c2c`.
- Latest OpenMLS #42987007179 and FRB #42987007308 failed with no steps/log URLs; FRB downstream commit/final-SHA/iOS jobs skipped. Flutter #42987007363 skipped by branch condition. No test command is evidenced as executed.
- Stage 4 remains NOT ACCEPTED / BLOCKED; Beta 1.0 WBS unchanged; native MLS flag remains false.
- Report section 26 records exact CI evidence and remaining unblock.


### 2026-11-11 — Protected iOS environment and latest CI

- Added GitHub Environment `ios-signing` to the iOS job so signing credentials are released only after environment protection approval. Required environment secrets are documented in mobile/README.md: base64 P12, P12 password, base64 provisioning profile and Team ID. Whether the owner has configured these settings is UNKNOWN.
- Latest observed full CI on prior head `5e3a9dc7644bb9e2eb462a41de345b4ff9f7df3c`: OpenMLS #42987334965 FAILED, FRB #42987334938 FAILED before steps/logs, Flutter #42987335071 SKIPPED; downstream generated commit/final-SHA/iOS jobs skipped.
- Latest PR head after README/report updates: `a9b81e0c04ce1826d361845b8596eae0c4acaaf9`. No workflow-run records for the immediately preceding README head were returned at the time of the report; current SHA still requires CI evidence.
- No tests are accepted or claimed. Stage 4 remains blocked pending a working runner, generated FRB outputs and complete green matrix on one exact SHA.


### 2026-11-11 — Exact-head CI recheck

- PR #45 exact head at check: e8f50e566d1095ed7ad6ed9427abb5d666b5097b.
- OpenMLS #42987463963 failed; job 130411972408 had steps=null/logs_url=null; log download returned BlobNotFound.
- FRB #42987464006 failed; job 130411972791 had steps=null/logs_url=null; log download returned BlobNotFound. Generated commit, final-SHA verification and iOS jobs skipped.
- Flutter #42987463998 skipped by the explicit Stage 4 branch condition.
- Combined status API returned no status entries for the exact SHA. No test command is evidenced as executed; exact job-start failure reason UNKNOWN.
- Report section 28 records evidence. Owner needs to provide the job-level failure message from GitHub Actions UI or restore an authorized runner. No diagnosis is guessed.


### 2026-11-11 — Logout fail-closed and crash-consistency regressions

- Rust `Client.logout` now attempts remote logout but always deletes local SQLCipher session-token row and clears in-memory access/refresh tokens; added offline-server regression.
- Flutter `InOneSession.logout` clears saved MLS user identity on every explicit logout attempt, even if native purge fails; missing native runtime/device identity is now an explicit error. Added two tests to prevent automatic resume after failed purge/unavailable runtime.
- Added Rust regressions for wrong protected-key mismatch without replacement, partial new-session initialization cleanup, and child-process termination with an open SQLCipher WAL transaction (OpenMLS storage/inbox/processed writes must all roll back).
- These source/test changes are not executed.
- Exact tested head: `54711b873349a8adb575f27d9c1fcccebbc49081`. FRB #42988592622 and OpenMLS #42988592592 failed with no steps/log URL; log retrieval returned BlobNotFound. Flutter #42988592656 skipped. No tests evidenced as run.
- Report section 29 records details. Stage 4 remains NOT ACCEPTED / BLOCKED; Beta 1.0 WBS unchanged; native MLS flag false.


### 2026-11-11 — Owner execution mandate

- Created previously missing `development/AI-AGENT-MANDATE.md` referenced by root AGENTS.md.
- Recorded owner instruction: ChatGPT sole executor; no external agent unless explicitly authorized; current product stage Beta 1.0; no assumptions as facts; accept only complete criteria with green tests on one exact SHA; concise reports with criteria, WBS percentage and checklist; archive reports in GitHub; no product merge without owner approval.
- Updated WORKING-RULES startup checklist to include the mandate.
- Governance-only change. No test result or acceptance status changed.


### 2026-11-11 — Latest CI retry after logout regression

- Exact code/test head: `5ca865573e7ed8949698ce7eda7d0adbf5f5915a`.
- FRB #42988901680: FAILED; generation job `130416646502` had no steps/log URL; downstream commit/final-SHA/iOS jobs skipped.
- OpenMLS #42988901678: FAILED; job `130416646666` had no steps/log URL.
- Flutter #42988901824: SKIPPED by branch condition.
- Log retrieval returned BlobNotFound. No test command evidenced as executed; exact failure cause UNKNOWN.
- Report section 31. Stage 4 remains NOT ACCEPTED / BLOCKED.


### 2026-11-11 — Exact-head CI after crash-test naming correction

- The process-exit regression is now named `process_crash_rolls_back_openmls_storage_and_inbox_atomically`; it tests OpenMLS signature-key storage plus inbox/processed writes, not a live group ratchet.
- Latest PR #45 head: `28aa6f488472688ae5d728e18da8ef24910d540d`.
- OpenMLS #42989119932 failed with no steps/log URL; FRB #42989119937 failed with no steps/log URL and downstream jobs skipped; Flutter #42989120066 skipped.
- No test command evidenced as executed. Exact failure cause UNKNOWN. Report section 32.


### 2026-11-11 — Current-head CI status

- Latest PR #45 head checked: `d81e05a794f10aa47e414dcc8d8920ffcd35755e`.
- OpenMLS #42989207053 failed; job `130417656507` had no steps/log URL and log retrieval returned BlobNotFound.
- FRB #42989207170 failed; job `130417656993` had no steps/log URL and log retrieval returned BlobNotFound. Generated commit/final-SHA/iOS jobs skipped.
- Flutter #42989207122 skipped by branch condition.
- No test command evidenced as executed; exact job-start failure cause UNKNOWN. Report section 33.


### 2026-11-11 — Latest current-head CI retry

- PR #45 head checked: `e7e19ce9de18e6042b36e5bd5f2ae9700796afd1`.
- FRB #42989322261 failed; job `130418031253` had no steps/log URL; log retrieval returned BlobNotFound; downstream jobs skipped.
- OpenMLS #42989322167 failed; job `130418031986` had no steps/log URL; log retrieval returned BlobNotFound.
- Flutter #42989322186 skipped by branch condition.
- No test command evidenced as executed; exact failure cause UNKNOWN. Report section 34.


### 2026-11-11 — Latest exact-head CI and trigger policy

- FRB workflow now runs its full matrix only for workflow-file and `mobile/**` changes; documentation-only edits no longer trigger native CI.
- Latest PR #45 head: `bfb87598068239c1107233d930ee79f25ff62d77`.
- FRB #42989491362 and OpenMLS #42989491373 failed with no steps/log URLs; log retrieval returned BlobNotFound. Flutter #42989491354 skipped.
- No test command evidenced as executed. Exact failure cause UNKNOWN. Report section 35.


### 2026-11-11 — PR #45 failed-job rerun

- Re-read PR #45, mandate, WBS v1.1, working rules and Stage 4 reports/continuity.
- Latest recorded PR head: `f6384a0bd68460849cbc9b9ce0fa6d7e9fcb9a6a`; latest code-triggered run SHA: `bfb87598068239c1107233d930ee79f25ff62d77`.
- Re-ran failed jobs in FRB run #42989491362 and OpenMLS run #42989491373. Latest attempts still failed with `steps=null`, `logs_url=null`; log retrieval returned `BlobNotFound`. Latest job IDs: `130426024038` and `130426036241`.
- FRB generated-commit/final-SHA/iOS jobs skipped; Flutter run #42989491354 skipped by branch condition. No test/build/codegen command is evidenced as executed.
- No speculative workflow/source edit made because the failure occurs before observable steps. Exact Actions startup cause remains UNKNOWN.
- Stage 4 remains NOT ACCEPTED / BLOCKED; verification accepted 0%; native MLS disabled; no merge. See report section 36.


### 2026-11-11 — CI trigger-filter correction

- A docs-only archive commit generated FRB #42991893141 and OpenMLS #42991893195 because `pull_request.paths` sees the aggregate PR diff; FRB `push` also lacked a `paths` filter. Both jobs again failed before observable steps/logs; Flutter #42991893163 skipped. Log retrieval returned BlobNotFound.
- Corrected `.github/workflows/openmls-frb-codegen.yml` to use explicit `push.paths` for the workflow file and `mobile/**`, removing the aggregate `pull_request` trigger. Corrected `.github/workflows/openmls-client.yml` by removing the aggregate `pull_request` trigger; its existing push path allowlist remains. Manual dispatch remains in both.
- These are source-reviewed workflow trigger changes only; no passing workflow/test result is claimed. Same-repository PR head pushes remain covered; fork PR automation is not covered by this branch-specific setup.
- Stage 4 remains NOT ACCEPTED / BLOCKED, verification accepted 0%, native MLS disabled, no merge. See report section 37.


### 2026-11-11 — Current Stage 4 branch hand-back

- Workflow trigger corrections and continuity archive are committed on `feature/stage-4-native-mls-runtime-2026-11-11`; latest verified commit at report time: `16a522a358a5b3d0d1f9b82f70785a0f599478ea`.
- Re-fetched and verified both workflow files. FRB uses branch-scoped `push.paths` for the workflow file and `mobile/**`; OpenMLS uses its existing push path allowlist; aggregate PR path triggers removed; manual dispatch retained.
- Available execution container has Node.js only; no Rust/Cargo, Flutter/Dart or Xcode. No local tests/builds run. Actions jobs continue to fail before observable steps/logs; exact cause unknown.
- Stage 4 NOT ACCEPTED / BLOCKED; verification accepted 0%; native MLS disabled; no merge. Report section 38.

### 2026-11-16 — Email delivery and API error-path hardening

- Continued the owner-approved Email Delivery implementation on PR #61. Added configurable PostgreSQL outbox lease duration and heartbeat renewal while SMTP is in flight; stale claims are not sent after lease ownership is lost.
- Added a PostgreSQL integration test with two workers and an SMTP operation exceeding two lease periods. This test still requires the PR's PostgreSQL CI job to execute.
- Unexpected HTTP 500 responses now return a stable generic error. Only a constrained machine-readable error code is logged; exception messages, SQL details, hostnames and stack traces are not returned to clients or copied into this log.
- Added a persistent-store regression test for the HTTP error disclosure path.
- PR #63's security-hygiene head `35e5729464f5d598f1c14fc234d0680d76a1cfc1` passed all seven observed CI jobs: Backend Node suite, PostgreSQL integration suite, OpenMLS client check/tests, Rust bridge check/tests, Rust formatting, P0 room-list regression and Flutter validation. This validates that CI runners are functioning for that commit; it does not validate PR #61's changed backend.
- PR #61's stacked base branch is `feature/beta1-screen-api-integration-2026-11-12`. Its P0 workflow originally filtered pull requests to base `main`, so PR #61 received only the Flutter workflow. The base branch workflow was updated at `38d812d81b9a2d81543fc961bc6ba7b93d78cd24` to run P0 checks for stacked PRs and make Rust formatting read-only. A new PR #61 head commit is required to trigger the full matrix against the updated base.
- No PR was merged and no runtime test result is claimed for the new email lease or HTTP error regression tests.

- First full stacked CI run #43900951278 reached and executed backend/Rust/PostgreSQL jobs; Flutter validation failed only at the legacy step that pushed generated UI assets to `task/ui-archive-import-2026-11-09` and received a non-fast-forward rejection. The UI archive extraction and counts had passed (31 screens, 32 HTML files, 5 WOFF2 fonts).
- Corrected the PR #61 base branch workflow at `e4f2002a6e1be2baed83e3a8aa5573d1b06170a1`: Flutter validation now has `contents: read` and keeps imported UI files in the ephemeral runner workspace without pushing commits. Re-triggering full CI against this updated workflow.

- The first Backend Node suite on PR #61 exposed stale legacy tests that expected Russian email copy while requests relied on the new Armenian default. Updated the test helpers/requests to explicitly request `ru` where their assertions inspect Russian copy; product behavior remains driven by the user's selected locale. The production-config test now supplies the required 32-byte email encryption key when testing SMTP mode.
- Flutter analyze on the first full run found a malformed `mobile/lib/core/network/api_environment.dart` source line and a nullable bridge route guard; repaired both.
- The same run confirmed generated FRB Dart files are intentionally absent from source and must be generated before Flutter analysis. The PR #61 base workflow now installs Rust 1.91 and `flutter_rust_bridge_codegen 2.13.0`, runs the documented native-assets integration/generation sequence, prepares Android NDK context, generates the Rust lockfile and tests the native Rust bridge before Flutter analysis/build. The workflow remains read-only (`contents: read`) and does not push generated files.
- Updated PR #61 head to trigger the complete validation matrix against the corrected base workflows. Awaiting the rerun before treating any of these fixes as verified.

## 2026-11-13 — Owner decision: split product into InOne and InOne Business

- Owner approved two separate applications:
  - **InOne:** personal/social application with news feed, publications, personal chats, groups, Threads, and related social features.
  - **InOne Business:** professional/work application with Kanban, CRM, Leads, Deals, Wallet, Flags, other business tools, and integration with Propo Seller Account.
- Recorded as an authoritative product decision in `docs/continuity/DECISIONS.md` section 7 and added to `docs/continuity/SOURCE-OF-TRUTH.md`.
- Updated continuity handoff documents to require a product-boundary impact review before reorganizing screens or implementation.
- Important: this decision defines product boundaries only. It does not automatically decide separate/shared identity, backend, databases, repositories, or infrastructure.
- No application code, UI, API, backend, database, CI workflow, PR state, or branch topology changed. No Actions were started and no PR was merged.
- Next: inventory and classify existing screens, routes, repositories, APIs, and navigation into InOne, InOne Business, shared platform, or unresolved; prepare an impact map for owner review before code changes.


## 2026-11-20 — P2 Push and Profile audit started

- Confirmed A2 PR #102 is already merged to main as `df20bef8df05b3ab2e11b20cb91e8f2bca60eec0`; no duplicate merge or A2 edits.
- Created isolated audit branch `audit/p2-push-profile-2026-11-20` from main SHA `974f944d251870ca57fad5124f058b9d65d12a26`.
- Reviewed canonical backend push routes/store lifecycle, existing `engine/test/push.test.js`, Flutter ST-01 screen, profile DTO/repository/session, pubspec and API contract.
- Findings: backend push token registration/removal and privacy-oriented notification payload are present in source; backend push tests exist but were NOT RUN in this audit. Flutter has no declared FCM/APNs token plugin, no typed push register/unregister repository, and no production ST-01 callback flow. Production push sender is injected, not wired by the inspected default server construction.
- Profile GET and locale synchronization exist. General profile editing has no documented/verified write route; no route was invented. Owner decision is required for editable fields.
- Added report `development/reports/2026-11-20-P2-push-profile-audit.md`, commit `acbbe1653046d2f01b1efb6efa5d4a40350b7638`.
- No product code/API contract changed. No tests/builds run. No merge. WBS v1.1 and readiness percentages unchanged.
- Next: obtain approved profile editable-field list; select/pin FCM/APNs mobile integration; implement typed token lifecycle and production ST-01 wiring; wire protected provider sender; run exact-SHA Node/PostgreSQL/Flutter/Android/iOS checks.


## 2026-11-21 — canonical Backend identity remediation

- Confirmed that `inone-development-archive-0.6.0/engine/` is the canonical Node.js Beta 1.0 backend, while `inone-engine-poc-0.6.0/mobile-mls/mls-client/` remains the canonical Flutter-connected persistent Rust MLS client.
- Reconciled package metadata and npm lockfile to `inone-backend`; removed the temporary Variant A package description.
- Replaced the stale backend README, corrected the mobile setup guide's backend working directory, and added `test/backend-identity.test.js` to the Node suite.
- Added ADR-004, backend source-of-truth map and detailed audit report.
- Branch: `fix/canonical-backend-identity-2026-11-21`. No source tree move/rewrite, no Rust dependency change and no merge to main.
- Runtime tests and CI are not yet evidenced; inspect exact-head checks before accepting or merging.

- Draft PR #120 remains open against `main`, not merged. The backend README was corrected to preserve legacy notes under a clear canonical-source banner; fresh exact-head CI is required for this final follow-up.

## 2026-11-22 — PR #119 synchronized with main

- Synchronized `feat/issue-114-engine-b-session-resume-2026-11-21` with `main` using a temporary, branch-scoped GitHub Actions workflow based on the repository's previously used one-time merge procedure.
- The runner fetched current `origin/main`, performed a real Git merge, removed the temporary workflow file, and pushed the resulting branch. No conflict was reported by the merge job; the final PR diff contains no temporary workflow.
- Verified compare: feature branch is 125 commits ahead and 0 behind; merge base equals `main` SHA `96bf053d0f713e97d1018d6022b15915d46cb3e8`.
- Pre-sync checks on `cd43c60` are superseded. The first synchronize-triggered runs on the new head were created with conclusion `action_required` and no jobs because the branch update was pushed by `GITHUB_TOKEN`; GitHub requires a repository writer to approve these PR workflow runs. Do not treat them as test failures or successful validation.
- Next: create a normal repository-authenticated head update (not via Actions `GITHUB_TOKEN`) so the exact-head PR workflows can run without the approval gate; then review all nine required workflows on the resulting SHA.
- PR #119 remains Draft and unmerged.

## 2026-11-23 — isolated Beta 1.0 screen/backend wiring

- Owner instruction: continue connecting native Dart screens to existing backend contracts; do not run tests, analyzers, builds or GitHub Actions until PR #128 and PR #130 are fully green.
- PR #128 and PR #130 overlap on Flutter app/session/repository/chat paths. Created isolated child branch `feature/beta1-screen-backend-wiring-2026-11-23` from PR #130 head `dff0786bd8f920b902495e94fec46c297b110899`; did not modify either queued PR and did not open a new PR.
- Connected the messages list to typed authenticated `GET /rooms/mine` independently of native MLS opt-in. Room content/send remain gated by the canonical Engine B session; no plaintext fallback.
- Added organization member read wrapper for existing `GET /orgs/:id/members`; organization/workspace member counts remain unknown when the API read fails.
- Added a profile-menu language selector (`hy`, `ru`, `en`) using the existing authenticated `PATCH /profile/locale` session path.
- Updated mobile API contract matrix and README to reflect the current screen wiring; detailed report: `development/reports/2026-11-23-beta1-screen-backend-wiring.md`.
- Validation: intentionally NOT RUN. No workflow dispatch, PR open, test, analyzer or build was performed. Native MLS remains disabled by default.


## 2026-11-23 — five-screen integration expansion

- Owner expanded scope to all five active Beta 1.0 screens: messages, chat thread, organization profile, workspace and user profile; target is every in-scope UI control backed by a real server operation.
- Source audit found non-wired controls and missing data: public room search/join, thread room/member/settings actions, full organization roster and management, workspace notifications/activity/project/task data, and profile device/security management. Some metrics and profile/avatar mutations have no confirmed Beta 1.0 route and must remain unavailable rather than fabricated.
- Implemented typed immutable organization member parsing from existing GET /orgs/:id/members; organization profile now renders the authenticated member roster and roles. Roster is cleared on account/organization switch.
- PR #128 and #130 remain open and unmerged. Work remains on the isolated screen branch; no PR opened. Tests, analyzers, builds and Actions remain intentionally not run.


## 2026-11-23 — public groups and chat-thread actions

- Connected typed public group search (`GET /rooms/search`) and join/request (`POST /rooms/:id/join`) to the Messages screen. Search validates 2–50 characters and displays member count/join policy; UI distinguishes joined, requested and already-member states.
- Connected chat room metadata (`GET /rooms/:id/members`), permission-aware rename (`POST /rooms/:id/settings`), native Engine B member invite (only with `invite_members` capability and an active native MLS session), and room read marker (`POST /rooms/:id/read`) after readable messages have been loaded through the durable SQLCipher history path.
- Replaced the misleading “Search messages” affordance with public group discovery. The group filter toggles All/Groups; unread filtering remains disabled because `GET /rooms/mine` has no unread counts. The call control is hidden because no Beta 1.0 call contract is connected.
- Verified source contract semantics: open public join checks organization membership/capacity but does not provision MLS Welcome. UI keeps the room unreadable until a valid Engine B local epoch exists.
- No tests, analyzer, builds, device checks, workflow dispatches or GitHub Actions were run. PR #128 and #130 remain untouched.


## 2026-11-23 — organization member administration

- Connected existing organization member mutations: add (`POST /orgs/:id/members`), role change (`POST /orgs/:id/members/:userId/role`) and removal (`DELETE /orgs/:id/members/:userId`).
- Added role-aware UI: owners can add all supported roles, change roles and remove other members; admins can add/remove ordinary members only. Mutations require confirmation where destructive or privilege-changing.
- After a self-role change, the selected organization's role is refreshed in local app state so stale owner controls are not retained. Server continues enforcing last-owner and owned-room constraints.
- No tests/analyzers/builds/Actions run.


## 2026-11-23 — user profile device management

- Added typed device inventory DTO and repository for authenticated `GET /devices/mine`.
- Connected remote device revocation through `DELETE /devices/:deviceId`; UI confirms before revocation, refreshes inventory and never offers the current device as a target.
- Device rows display only server-provided label/ID, revoked state and push-registration state; no token/key material is exposed.
- Backend revocation remains responsible for deleting push registration and recording MLS device removals.
- No tests, analyzers, builds, device checks or GitHub Actions were run.


## 2026-11-23 — organization settings and audit log

- Connected organization settings read/write and settings audit log using existing GET/POST routes. Only owner/admin UI exposes mutations and audit log; all members can view settings.
- Organization screen More now opens settings; workspace switch remains on the workspace header control.
- Server remains authoritative for allowed values, global group limits and audit recording. No new backend routes added.
- No tests/analyzers/builds/Actions run.


## 2026-11-23 — organization links

- Connected owner/admin organization link listing, proposal, acceptance and revocation using existing backend routes.
- UI distinguishes proposer from receiving organization; proposer cannot accept its own proposal. Accept/revoke actions require confirmation and refresh server state.
- Backend transition/CAS and cross-organization membership cleanup remain authoritative. No route added.
- No tests/analyzers/builds/Actions run.


## 2026-11-23 — Beta 1.0 UI scope cleanup

- Audited workspace route availability: no Beta 1.0 persistent notifications feed, project/task/activity feed or module customization endpoint was found. These controls are hidden rather than wired to notices or fake data.
- Hid unsupported publication actions, avatar/cover editing and Feed/Calls navigation in the active Beta 1.0 screens. Protected-chat creation is shown as a Messages header action only when native Engine B MLS is active.
- Workspace continues to show server-derived organization member/group counts; project/task metrics remain unknown.
- No tests, analyzer, builds, device checks or GitHub Actions were run.


## 2026-11-23 — organization admin-action log

- Connected owner/admin-only `GET /orgs/:id/admin-log` with a typed action DTO and a read-only UI dialog in organization settings.
- Displays server actor/action/target/detail/timestamp fields. No client-generated audit entries.
- No tests/analyzers/builds/Actions run.


## 2026-11-23 — room visibility and join policy settings

- Chat thread settings now include visibility and join-policy controls when effective capabilities include `edit_group_settings`; room name remains separately gated by `edit_group_name`.
- The client sends only changed fields through existing `POST /rooms/:id/settings`. Backend remains authoritative, including clearing join requests when a room becomes private.
- No tests/analyzers/builds/Actions run.


## 2026-11-23 — post-PR #131 acceptance audit and P0 Welcome transaction

- Verified current `main` remains at `2430b0365ab71c60b0926b27854d17a9090e1fba`; PR #131 is merged. PR #131 head workflows retrieved as PASS are not substituted for merge-SHA post-merge checks. Nine PR-head workflows are PASS; the four post-merge main workflows reported IN_PROGRESS at checkpoint remain unconfirmed.
- Confirmed production `mobile/rust/Cargo.toml` uses canonical Engine B. Updated Issues #1, #114, #6, #5 and #9 with current source facts and remaining proof gaps; all remain open.
- Source audit found that Welcome materialization, `client_rooms` and Welcome receipt were not atomic even though application-message and inbound Commit paths use the shared SQLCipher connection/transaction-aware provider.
- On existing draft PR #132 branch `work/mls-production-acceptance-2026-11-23`, changed Welcome materialization to use a transaction-backed OpenMLS provider and commit group state, room index and receipt together. Added five crash failpoints and a child-process SQLCipher restart regression for rollback/recovery at each boundary. Commits: `e06ffe5` and `3a0bf89`.
- These Rust changes and tests have NOT been compiled or executed in this audit. Do not mark Issue #1 accepted. Outbound Commit server-acceptance/reconciliation, Flutter/native ACK lifecycle and WAL-specific behaviour remain open proof gaps.
- Corrected mobile README: production Firebase Admin FCM sender and encrypted PostgreSQL push outbox already exist and are wired by backend `main.js`; physical provider/device delivery remains unaccepted. Beta recovery custom scheme is generated for Android/iOS; production Universal/App Links remain blocked on owner-supplied domain.
- Updated `mobile/API-INTEGRATION.md`, `mobile/API-CONTRACTS-BETA-1.md`, continuity docs, MLS atomicity ADR, P0 acceptance map and the PR #131 screen/backend report. Historical records remain intact but are explicitly superseded where stale.
- Audited old PRs #127/#87/#89/#90/#124/#116/#117/#125/#94/#129/#110/#97. No stale PR or branch was merged or closed. Selected changes from #87/#89/#90 are already represented by PR #131; old Engine A is not to be copied.
- No local test runner or physical devices were available through the current GitHub connector. No Rust/Flutter/Node/PostgreSQL tests, native builds or physical-device tests were run in this audit branch. WBS v1.1 unchanged; current engineering estimates 90% implementation / 73% verification / 58% release readiness; recommendation NOT READY.



## 2026-11-23 — exact merge-SHA Actions recheck and P1 UTF-8 regression

- Queried GitHub Actions REST runs for exact main SHA `2430b0365ab71c60b0926b27854d17a9090e1fba` (push event): nine workflows exist. Seven completed PASS: Backend Docker Compose, OpenMLS client, Dev Container Compose, Email/PostgreSQL, recovered P0 source, Flutter iOS and Flutter mobile.
- OpenMLS Flutter Rust Bridge generation: main validation and Android build/Keystore emulator smoke passed; iOS native-assets compile remains IN_PROGRESS.
- Native MLS client validation: exact source verification, canonical Engine B regression tests, persistent bridge host tests and OpenMLS attachment/session integration tests passed. The iOS Keychain target build was cancelled on attempt 1; logs for the cancelled job are unavailable. A targeted rerun was accepted and attempt 2 is QUEUED. Do not call this workflow complete yet.
- The exact-SHA acceptance gate is configured for PR events, not main push; it is N/A for main. Individual main workflows verify their exact source SHA.
- Added an additional P1 regression on draft PR #132 branch: malformed UTF-8 followed by a valid message in the same room must produce an Unreadable record, preserve room epoch, deliver the later valid message and leave no RecoveryRequired marker. Test not yet compiled/executed.
- Current audit branch has no workflow runs returned for its latest commit; all new Rust changes remain unvalidated. No changes to main.



## 2026-11-23 — PR #132 exact-SHA workflow queue

- PR #132 code-validation head `988d537d7fb3acf812781e67ac598cb5954ed958` triggered nine PR workflows, including the exact-SHA acceptance gate; all nine were queued at 16:19Z.
- The audit report was added as a documentation-only commit `2d7754e29d31aa0cedf004ae9fee988d45e2dbb0`; no new workflow runs were returned for that report-only head.
- Continuity docs now distinguish the code-validation SHA from the later report-only head. No test result for the new Welcome or invalid-UTF-8 regressions is yet available. Do not mark the branch accepted until the exact-SHA gate completes on the final PR head.



## 2026-11-23 — P1 #9 real sync-path regression

- Added `room_sync_access_and_not_found_errors_never_mark_recovery_required` to canonical Engine B `tests/outbox.rs` on PR #132 branch.
- The test uses a local TCP proxy to inject HTTP 401, 403 and 404 responses specifically for `GET /rooms/:id/events`, asserts `sync()` returns the access/not-found error without a durable `RecoveryRequired` marker, then restores access and asserts the same room delivers the pending valid message with unchanged epoch.
- Updated Issue #9 description. Issue remains OPEN until the regression passes on an exact SHA and physical revocation/re-auth is accepted.
- New code-validation SHA: `87930a5997b9ceb7aea44409b1e0d07020d3c82f`; nine PR workflows (including exact-SHA gate) were queued at 16:23Z. No completed result yet.



## 2026-11-23 — main merge-SHA FRB completion

- Rechecked Actions REST runs for main SHA `2430b0365ab71c60b0926b27854d17a9090e1fba`.
- `OpenMLS Flutter Rust Bridge generation` completed PASS, including both `generate-and-validate` and `iOS native assets compile (unsigned, no secrets)`.
- Main now has 8/9 push workflows completed PASS. The only remaining workflow is `Native MLS client validation`: its four non-iOS jobs PASS; the iOS Keychain native-target job's first attempt was cancelled, and the targeted rerun remains QUEUED.
- The cancelled job had no retrievable logs; the rerun is the next evidence point. Do not call main fully validated until it completes.



## 2026-11-24 — CTO backend security remediation Stage 0

- Re-fetched live main at `02880940c1e4d8261405fbeaa01f40879eb44f3a`; created isolated branch `security/beta1-backend-remediation-2026-11-24` directly from that exact SHA.
- Read repository agent mandate, WBS v1.1, Git integration policy, working rules, historical test evidence and current continuity documents. Canonical backend source is `inone-development-archive-0.6.0/engine`.
- Revalidated source and recorded confirmed source-level findings B-01, B-02, B-03, B-04, B-06, B-07, B-08, B-09, B-10 and B-11; B-12/B-13/B-14 need additional investigation; B-15 is partial. Detailed evidence: `development/reports/2026-11-24-cto-backend-security-remediation-stage0.md`.
- Main already contains PR #132 MLS Welcome atomicity work; did not repeat it. Reviewed open-PR inventory and identified overlap requiring patch/ancestry review (#42, #63, #65, #66, #86, #89 and G2/MLS PRs).
- Exact-main workflows at inspection: five completed PASS and three IN PROGRESS; these are not a substitute for the requested security test matrix. Main protection API reports `protected=false`.
- No backend source/migration/test/workflow changes. New tests, exploit reproduction, PostgreSQL concurrency/fault injection and full suite are NOT RUN. No local clone/Codespace runner is available in this session; broad backend edits are blocked by repository policy until a complete working copy/test runner is available.
- Beta 1.0 verdict remains NOT READY for backend security acceptance. SMS confirmation/recovery/provider work excluded; native MLS remains disabled by default; no merge, issue closure or repository setting mutation performed.


## 2026-11-24 — Stage 0 continued: B-12..B-15 and overlap review

- Expanded review of canonical backend on main. Confirmed B-12 last-owner/role/audit operations use check-then-write across independent pool queries; B-13 owner/org quota checks are non-atomic preflight reads, and ready-object retention/deletion lifecycle is incomplete; B-15 readiness only pings the store and liveness is exposed as `/healthz`.
- Refined B-14: current FCM sender already classifies invalid FIDs as permanent `invalid_target`, deletes the matching registration, cancels queued deliveries and has a push regression test. Marked FIXED at source level; DB test execution still required.
- Confirmed current `main` already contains device-bound signed file downloads (same class of work as PR #86); do not duplicate. PR #42 is only a PostgreSQL workflow against old `inone-engine-poc-0.6.0` paths, not a current-engine transaction fix. PR #65 only hardens one error catch, not the global request boundary.
- Reviewed mobile code-search results for legacy KeyPackage/to-device endpoint usage; no direct mobile references surfaced in the searched source paths. This is not yet a complete API compatibility proof; inspect Rust/Flutter transport adapters and runtime traces before retiring legacy API.
- Expanded the Stage 0 report with the updated matrix and exact PR dispositions. No source changes, test runs, issue closures, merges, secret edits or repo setting changes.


## 2026-11-27 — Direct-chat contact prompt review and race hardening

- Reconfirmed owner behavior: first message delivery is independent of contact acceptance. If the sender is not already in the recipient's contacts, show **Принять** and **Заблокировать** beneath the sender name in the chat list. Accept only updates the recipient's address book; block prevents future direct messages in both directions and does not reveal the blocker to the blocked peer.
- Verified the production Flutter app host passes both contact actions to `InOneMessagesScreen` and calls authenticated `InOneRepositories.acceptContactRequest` / `blockContact`. The chat-row visibility predicate excludes existing contacts and blocked peers.
- Fixed a PostgreSQL accept/block race by making acceptance acquire both account locks in the same stable account-first order as block operations before locking the contact-request row. Added a concurrent accept/block regression and assertions that blocking removes both contact edges.
- Fixed active-thread room-summary refresh to update contact prompt flags, not only unread/time metadata. Added model copy/update regression coverage.
- Updated backend Compose CI's migration assertion to require `0037-contacts-and-blocks`.
- Source review and code edits only. **No tests, builds, PostgreSQL migrations, Flutter/Rust checks, or GitHub Actions have been run yet.** Continue static review, then create the final PR and run the complete exact-SHA GitHub Actions gate. Native MLS remains disabled by default; do not merge without owner approval.
