# InOne — Stage 3 post-merge verification and Stage 4 CI triage

**Дата/время:** 2026-11-11 09:45 UTC+03:00  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**База отчёта:** `main` at `94571cbc923ac4d29c3c684dbfdeb35f031d6a30`  
**Документационная ветка:** `docs/stage-4-native-mls-triage-2026-11-11`  
**Статус Stage 3:** merged; PR-head CI PASS.  
**Статус Stage 4:** NOT ACCEPTED; three required workflow runs on current PR head FAILED. Причины отказов по доступным данным не установлены.

## 1. Проверенный результат Stage 3

PR [#44](https://github.com/vahe210991-cloud/InOne-chat/pull/44) merged into `main` as `94571cbc923ac4d29c3c684dbfdeb35f031d6a30`.

Проверки выполнены на точном PR code-validation head `3d288777135d0c12145f18407e8768a02ae80a9f`:

- Backend Node: 382 passed, 0 failed.
- PostgreSQL 16: 124 passed, 0 failed.
- OpenMLS client: PASS.
- Rust bridge: PASS.
- Rust formatting: PASS.
- P0 room-list regression: PASS.
- Flutter analyze: PASS.
- Flutter tests: PASS.
- Android preview APK build: PASS.

CI evidence:
- [Backend / Rust / PostgreSQL run 42967427669](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42967427669) — success; all six jobs individually report success.
- [Flutter run 42967427728](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42967427728) — success.

F-01 and F-02 concurrency regressions are included in the PostgreSQL test evidence. The Stage 3 report `development/reports/2026-11-11-stage-3-api-backend-audit.md` contains stale wording that PR #44 remains Draft/unmerged. This new report corrects the current status without rewriting historical evidence in the original report.

## 2. Current Stage 4 target

- PR: [#45 — native OpenMLS runtime foundation](https://github.com/vahe210991-cloud/InOne-chat/pull/45)
- State: OPEN, Draft, not merged.
- Base: `main` at `94571cbc923ac4d29c3c684dbfdeb35f031d6a30`.
- Branch: `feature/stage-4-native-mls-runtime-2026-11-11`.
- Exact checked head: `45ee623d5bd2982e2a7032942962c9d4b58a8ffb`.
- Changed files: 16.
- PR description scope: persistent OpenMLS session adoption/resume, SQLCipher persistence, Android/iOS platform key-store adapters, typed Rust/Flutter session API and handoff contract.

## 3. Exact CI status on Stage 4 head

All three workflow runs associated with `45ee623d5bd2982e2a7032942962c9d4b58a8ffb` completed with conclusion `failure`:

| Workflow | Run | Result |
|---|---:|---|
| OpenMLS client validation | [42972694597](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42972694597) | FAIL |
| OpenMLS Flutter Rust Bridge generation | [42972694698](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42972694698) | FAIL |
| Flutter mobile validation | [42972694655](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42972694655) | FAIL |

The connector returned no job step summaries and the job-log download endpoint returned `BlobNotFound` for all three job IDs. Therefore the exact failing commands, error messages and root causes are **UNKNOWN / NOT VERIFIED**. No cause is inferred in this report.

Stage 4 acceptance is blocked until an agent obtains the full logs, identifies each failure, fixes the confirmed causes, and reruns the complete required matrix on one exact final SHA.

## 4. Security acceptance boundary

Preserve the approved decisions in `docs/continuity/DECISIONS.md`:

- No plaintext message fallback.
- Refresh token and SQLCipher key remain inside Rust; do not expose them to Dart.
- SQLCipher is mandatory; no plaintext database fallback.
- Incoming event ACK only after durable local message persistence.
- MLS remains disabled if native initialization, key storage, persistence or recovery fails.
- `INONE_MLS_NATIVE_ENABLED` remains false until Android/iOS handlers, Rust library packaging, secure key store and device tests are accepted.
- No Megolm fallback.

The PR's description itself says iOS coverage, runtime storage tests, outbox/restart regression and concrete Dart bridge wiring remain follow-up work. These are not accepted merely because code files exist.

## 5. WBS and percentage reporting

The owner-approved WBS v1.1 in `development/PROGRESS-BASELINE.md` remains unchanged:

- Beta 1.0 baseline: 42% implementation / 31% verification.
- Beta 2.0 baseline: 2% implementation / 0% verification.
- Historical InOne overall: 25%; do not recalculate without an approved overall WBS.

No cumulative percentage is increased in this triage report. Stage 4 is Draft and its current CI is red. Any later percentage change must map to the fixed WBS criteria and exact accepted evidence.

## 6. Repository instruction inconsistency

Root `AGENTS.md` names `development/AI-AGENT-MANDATE.md` as a mandatory first read. Fetching that exact path from `main` returned GitHub 404, and repository code search did not find the file. This is recorded as a documentation inconsistency; no missing mandate text is reconstructed or invented. The existing `development/WORKING-RULES.md` and `development/PROGRESS-BASELINE.md` were read.

## 7. Five previous work items

1. [x] P0 backend/Rust/OpenMLS acceptance merged in PR #25; retain its original closure evidence.
2. [x] Owner-approved Beta 1.0/Beta 2.0 WBS v1.1 recorded; weights and scope remain fixed.
3. [ ] UI source integration PR #35 remains a separate draft stream; original Ui.zip binary/source import must not be called complete without remote hash verification.
4. [x] Stage 3 API contracts and route guards merged in PR #44 with the listed green CI evidence.
5. [x] F-01 stale organization-link accept/revoke and F-02 open-join/revocation concurrency fixes merged as part of PR #44.

## 8. Five next work items

1. [ ] Obtain and inspect full logs for all three failed Stage 4 runs; report exact failing step, command, error and root cause.
2. [ ] Fix only confirmed Stage 4 failures on a unique task branch based on PR #45 head; avoid writing to a branch another agent is using.
3. [ ] Verify persistent session adoption, refresh rotation, SQLCipher writes, restart resume and logout/session cleanup with executed tests.
4. [ ] Complete Android and iOS native build/runtime coverage, secure key-store tests, outbox/restart and durable-persistence-before-ACK regressions; keep MLS fail-closed.
5. [ ] Run the complete required Stage 4 acceptance matrix on one exact final SHA; update the report, session log and continuity documents only with observed results. Do not merge without owner approval.

## 9. Work performed in this triage

- Read repository entrypoints, working rules, continuity index, approved WBS and current Stage 3 report.
- Checked GitHub repository, PR #44 merge state, exact CI run/job conclusions, PR #45 state/head, changed-file list and three Stage 4 workflow conclusions.
- Attempted to retrieve all three failed job logs; GitHub returned `BlobNotFound`. Step summaries were empty.
- No product source files were changed. No workflow was rerun. No server, deployment, database or paid Codespace was started. No PR was merged.

**Acceptance:** Stage 3 PR-head CI evidence is PASS and PR #44 is merged. Stage 4 is NOT ACCEPTED.  
**Next gate:** exact Stage 4 failure diagnosis and complete green CI on the final SHA.
