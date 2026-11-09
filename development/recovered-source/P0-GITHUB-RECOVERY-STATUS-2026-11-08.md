> **LIVE STATUS CORRECTION — 2026-11-09:** PR #25 is the accepted P0 backend/Rust/OpenMLS scope and is merged; its six required PR-head checks and six post-merge checks passed (runs #42496739362 and #42503694744). PR #22 was also merged on 2026-11-08, but its own run #42471062557 failed at Rust formatting; the older text below that says PR #22 is open/draft is historical and superseded. PR #18 remains open/draft at `2776a275a5b74a2458759beb106846262cc5c3f0`; its validation job passed but publish failed because the published engine subtree differed from the validated candidate. The 240-base-path hash audit remains open for that separate Wave 3 recovery lineage. The accepted Rust MLS client already has SQLCipher state, outbound outbox and Welcome/recovery journals; production platform KeyStore adapters and durable normal inbound-message storage remain separate mobile work. Do not conflate it with the accepted PR #25 owner snapshot, whose bundle SHA-256 is `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`.

# P0 GitHub recovery status — 2026-11-08


> **FINAL STATUS — 2026-11-08:** P0 backend/Rust/OpenMLS acceptance is CLOSED. PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) was merged into `main` as `97024ab03ce9583e298ee946f3679565007405ca`. All six required CI jobs passed on PR head `addd47da245b6452c9f700c7e10b8d0585aad295` in [workflow run #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362). The owner bundle is permanently retained on `artifacts/p0-bundles`; see [ARTIFACT-RETENTION](../ARTIFACT-RETENTION.md) and [P0 closure report](recovered-source/P0-CLOSURE-2026-11-08.md). Historical status below is retained for chronology and is superseded by this final record. Native Flutter Beta 1.0 work is a separate scope.


**Purpose:** authoritative handoff for the recovered P0 source currently published on GitHub. This document supersedes stale status snapshots that say the P0 applied-source branch does not exist or that the full CI matrix has not yet run.

## 1. Canonical published recovery snapshot

- Repository: `vahe210991-cloud/InOne-chat`
- Source branch: `recovery/p0-wave3-applied`
- Exact source HEAD checked: `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`
- Commit: `recovery: restore 13 verified base-tree files`
- Pull request: [#22 — publish restored P0 engine and MLS core](https://github.com/vahe210991-cloud/InOne-chat/pull/22)
- PR state at this snapshot: OPEN, DRAFT, NOT MERGED.
- Base branch: `main`; PR base SHA at the run: `cf4c45fddbeff32f8dde659db419de29bb008d68`.
- This is a patch-based source publication derived from the owner-provided P0 Wave 3 bundle. It does **not** import the bundle's original five-commit ancestry into GitHub main.

The original bundle provenance remains:
- SHA-256: `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`
- Ref: `refs/heads/engine/p0-wave3`
- Original bundle HEAD: `a7f60b6fdc969941e4354a117e17d32bfc951fb9`
- Declared base: `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`
- Complete five-commit history; no common commit with GitHub main according to the bundle verification report.
- The original binary bundle itself is still not stored as a retrievable GitHub file. The published source patch is not a substitute for that binary archive or its original Git ancestry.

## 2. Where the published source is

The P0 validation workflow executes the engine from:

`inone-development-archive-0.6.0/engine/`

Relevant source and test areas include:
- `src/` — Node backend, server and stores;
- `migrations/` — database migrations;
- `test/` — backend and P0 regression tests;
- `mobile-mls/mls-client/` — Rust/OpenMLS client and integration tests;
- `mobile-mls/mls-bridge/` — Rust bridge;
- `.github/workflows/validate-published-p0.yml` — validation workflow.

The repository also contains a separate `inone-engine-poc-0.6.0/` archive tree. Do not assume duplicate-looking trees are identical. Before editing either copy, compare blob maps and confirm which path the relevant workflow/build uses. The P0 Actions log explicitly shows the test checkout running under `inone-development-archive-0.6.0/engine/`.

## 3. Exact-head CI evidence

Both exact-head workflow runs completed on source SHA `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`:

- [Push validation run 42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591)
- [Pull request validation run 42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297)

Observed job results from run 42465804591:

| Check | Result |
|---|---:|
| Backend Node suite | PASS — 369/369 |
| P0 room-list regression | PASS — 2/2 |
| PostgreSQL integration suite | PASS — 43/43 |
| OpenMLS client tests | PASS — all test binaries |
| Rust bridge tests | PASS — 3/3 |
| Rust formatting (`cargo fmt -- --check`) | FAIL — formatting-only diffs in 12 Rust files |
| Overall workflow | FAIL — because Rust formatting step failed |

Do not report this workflow as green. The functional test jobs above passed on the exact SHA, but the formatting gate remains red. The failure output contains rustfmt diffs (import ordering/line wrapping and similar formatting changes); it does not report a compiler or Rust test failure. Preserve the recovered source baseline before applying a formatting-only commit, and rerun all checks on the resulting exact SHA.

## 4. Source-integrity acceptance still open

PR #22 records the following reconciliation state:
- 13 missing base-tree files were restored using exact Git blob objects from the verified restoration candidate.
- All 13 restored blob SHAs were checked against that candidate.
- The current engine subtree contains 245 blobs.
- Compared with PR #18's restoration candidate, 11 paths differ: six modified engine files and five added P0 MLS/room-list test files.
- The six substantive differences are described as P0.1 message failure classification/diagnostics, P0.2 membership consistency/fail-closed room state, P0.3 late-message-window handling, `/rooms/mine` route/store implementation, a client-screen asset path correction, and test-harness controls for corrupted/hidden events.

Still required before P0 source-integrity acceptance:
1. Complete the 240-base-path/blob-hash audit against the original bundle manifest (not only against PR #18's restoration candidate).
2. Verify the six substantive source deltas and five added test files against the exact P0 bundle and patch stack.
3. Review the complete branch diff for test-only keys/secrets and unrelated changes. The biometric fixture's private key is explicitly test-only and must remain confined to test fixtures.
4. Decide on a formatting-only Rust commit only after preserving the recovered-source integrity baseline; rerun the full workflow afterward.
5. Review the resulting exact SHA and CI evidence before changing PR #22 from draft or considering merge.

## 5. Product/runtime boundaries

This recovery snapshot is backend + Rust/OpenMLS source, not a complete Beta 1.0 mobile app:
- The GitHub tree audit found no complete Flutter app project (`main.dart`, Flutter platform projects, app widget tree, or localization ARB files).
- The Flutter API transport foundation in PR #23 is separate groundwork; it does not wire screens to the backend.
- Native Android/iOS MLS handlers, Rust FFI packaging, Keychain/Keystore-backed key storage, durable local message storage and device-level E2E acceptance remain unverified/incomplete.
- Incoming messages must not be ACKed before durable local persistence succeeds.
- MLS send/decrypt must remain fail-closed. No plaintext fallback, fake encryption, or Propo runtime dependency.
- Beta 1.0 uses an independent InOne backend/database. Shared InOne + Propo operational DB remains deferred.
- Tasks, Calendar and Cindy are outside the approved Beta 1.0 scope.

## 6. Immediate next work — P0 only

1. Preserve the current source integrity baseline and obtain the exact original bundle tree manifest/objects for the 240-file hash comparison.
2. Review the six changed engine files and five new P0 test files against the exact bundle/patch provenance.
3. Resolve the rustfmt failure in a separate, clearly labelled formatting-only commit after source hashes have been recorded.
4. Run the full validation workflow on the new exact HEAD; require every job to pass.
5. Update this document, `development/BASELINE-2026-11-08.md`, `development/SESSION-LOG.md`, and `docs/continuity/{CURRENT-STATE,NEXT-SESSION,SOURCE-OF-TRUTH}.md` with exact SHAs and run links.
6. Keep PR #22 open and draft until source-integrity review and all P0 checks pass. Do not merge or move to Beta feature work before P0 acceptance.

## 7. Session continuity rule

Every meaningful source/document change must be committed to GitHub. The next session must start by reading:
1. `development/WORKING-RULES.md`
2. `development/BASELINE-2026-11-08.md`
3. this document
4. `docs/continuity/CURRENT-STATE.md`
5. `docs/continuity/NEXT-SESSION.md`

Never rely on a prior chat or model memory as the only record of a file, decision, test result or blocker.
