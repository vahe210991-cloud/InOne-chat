# Historical test and verification evidence baseline — Beta 1.0

**Date:** 2026-11-12  
**Purpose:** Preserve previously executed and documented verification so later sessions do not repeat repository exploration or plan checks that already have valid evidence.  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Evidence policy:** A result is historical evidence for its exact commit/run and stated scope only. It is not automatically a pass for later source revisions.

## 1. Confirmed historical green runs

### 1.1 P0 backend / PostgreSQL / OpenMLS / Rust bridge — merged acceptance

- Successful PR validation: [run #42496739362](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362), exact PR head `addd47da245b6452c9f700c7e10b8d0585aad295`.
- PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) was merged at `97024ab03ce9583e298ee946f3679565007405ca`.
- Post-merge validation: [run #42503694744](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744), successful on main code SHA `e30fcd02380327cd9efed94d85c05a3e6dccf3ce).
- All six jobs passed: Rust 1.91 format, P0 room-list regression, backend Node suite, PostgreSQL integration, Rust bridge check/tests, OpenMLS client check/tests.
- Acceptance boundary: P0 backend/Rust/OpenMLS baseline is closed for that accepted source. It does not establish completion of Flutter native MLS integration or Stage 4.

### 1.2 Stage 3 API / Backend and Flutter acceptance

- Report: [2026-11-11 Stage 3 API/backend audit](2026-11-11-stage-3-api-backend-audit.md).
- PR [#44](https://github.com/vahe210991-cloud/InOne-chat/pull/44), branch `feature/stage-3-api-contracts-2026-11-11`.
- Exact tested head: `3d288777135d0c12145f18407e8768a02ae80a9f`; base main `ce2018bffd3faf8a1c30aed65ee6191675ee38ad`.
- Backend/Rust/PostgreSQL [run #42967427669](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42967427669): SUCCESS.
  - Node backend: **382 passed, 0 failed**.
  - PostgreSQL 16: **124 passed, 0 failed**.
  - F-01 stale organization-link accept after concurrent revoke regression passed; stale accept returns 409 and emits no accept audit event.
  - F-02 concurrent public-room join/capacity and membership revalidation/revocation serialization PostgreSQL regressions passed.
  - OpenMLS client target check/tests passed.
  - Rust bridge target check/tests passed.
  - Rust formatting passed.
  - P0 room-list regression passed.
- Flutter [run #42967427728](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42967427728): SUCCESS.
  - Flutter dependency resolution, `flutter analyze`, `flutter test`, Android preview APK build and artifact upload passed.
- Scope boundary: exact PR #44 head only; not production deployment readiness, physical Android/iOS device acceptance, iOS archive/signing, or later Stage 4 code.

### 1.3 Beta 1.0 UI integration — earlier Flutter CI evidence

- Report: [2026-11-09 UI integration stage 1](2026-11-09-1015-ui-integration-start.md).
- PR #35 workflow [run #42579006574](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42579006574) SUCCESS on code SHA `df5c50c6e7f372d3a64f1c10e4bf4464d4a4d121`.
- Flutter setup/platform generation, geometry, 73-screen gallery, `flutter pub get`, `flutter analyze`, `flutter test`, Android preview APK and artifact upload all passed.
- Earlier run #42578785134 on SHA `8d3282b2bca16deb09af7bac98642c8abf35aec7`: analyze and **53 Flutter tests** passed, but Android APK packaging failed before app compilation because Gradle distribution download returned HTTP 504. Overall run was FAIL, not green.
- Scope boundary: Flutter UI validation on those exact source revisions; the original Ui.zip source archive upload remained blocked at that time. This is not proof that all production screens/API workflows were connected.

### 1.4 Branch consolidation audit — prior green workflow snapshots

- Report: [2026-11-10 branch consolidation audit](2026-11-10-git-branch-consolidation-audit.md).
- Main SHA `8350a18865703c78d5991b66d3cc6899cdeeca1f` passed Flutter workflow [#42630606199](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42630606199): platform generation, approved UI geometry, archive verification/import, 73-screen gallery, pub get, analyze, tests, Android preview APK and artifact upload.
- P0 workflow [#42504163838](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42504163838) passed 6/6 jobs on `7a1db8e9...`. The audit compared that SHA with the then-current main and found no changes under `inone-development-archive-0.6.0/engine/**`; this is engine-subtree continuity evidence, not a fresh P0 run on the later main SHA.

## 2. Historical failures and partial runs — do not erase

- P0 recovery run #42465804591: Node 369/369, room regression 2/2, PostgreSQL 43/43, OpenMLS and Rust bridge tests passed, but overall workflow FAILED because `cargo fmt -- --check` reported formatting diffs in 12 Rust files. Source-integrity audit also remained open at that point.
- Run #42457297299: Node 369/369 and room regression 2/2 passed; PostgreSQL 42/43. Sole DB failure was a PostgreSQL client/server version mismatch (`transaction_timeout` unsupported by PostgreSQL 16); OpenMLS/Rust jobs skipped.
- Runs #42454943853/#42455077322: Node 368/369 due missing biometric vector fixture; downstream integration jobs skipped. Later fixture recovery and later runs superseded this partial state.
- UI run #42578785134: 53 Flutter tests passed, but Android APK step failed with Gradle HTTP 504; do not classify as fully green.

## 3. Current Stage 4 evidence boundary (as of 2026-11-12)

The Stage 4 native MLS runtime work is a later source line and is **NOT ACCEPTED / BLOCKED**. The latest PR #45 records multiple workflow attempts that failed before executing steps, with unavailable logs (`BlobNotFound`); Flutter jobs were skipped. Newly added Rust/Dart regressions were committed but NOT RUN. Therefore:

- Do not reuse P0 or Stage 3 green status as a Stage 4 pass.
- Do not describe a failed-before-steps workflow as a source-code test failure; the exact cause is UNKNOWN until logs show it.
- Keep `INONE_MLS_NATIVE_ENABLED=false`.
- Do not merge PR #45 or enable native MLS until the complete required matrix is green on one exact final SHA and the owner approves.
- WBS v1.1 remains unchanged.

## 4. Required reuse protocol for future sessions

Before planning or executing any new checks:

1. Read this report and the linked source reports first.
2. Identify the target source SHA and compare it with each historical tested SHA.
3. Reuse a historical result only for unchanged source paths and the exact test scope it covered. Record whether the result is direct exact-SHA evidence or a justified unchanged-subtree continuity reference.
4. Do not rerun a check merely because context has been reset. Rerun only when source changed in the covered area, test/workflow changed, environment/toolchain changed materially, evidence is missing, or the acceptance gate explicitly requires a fresh exact-SHA run.
5. Continue the next implementation task from the last recorded handoff; do not restart broad code exploration when authoritative reports already answer the question.
6. Every substantial task must add a timestamped report and update `development/SESSION-LOG.md`, `docs/continuity/CURRENT-STATE.md`, and `docs/continuity/NEXT-SESSION.md`. Keep exact SHAs, run IDs/links, commands, outcomes and blockers.
7. Use only these statuses: **PASS**, **FAIL**, **BLOCKED**, **NOT RUN**, **IN PROGRESS**. A test file existing is not a test result.

## 5. What this report does not claim

This report is a consolidation of historical repository evidence. It does not claim that tests were executed during this documentation update, does not claim that current PR #45/Stage 4 is green, and does not change product source, release scope, WBS percentages, feature flags, or merge state.
