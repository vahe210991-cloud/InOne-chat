# Immediate next steps — 2026-11-09 12:11 Europe/Tallinn

1. Run Flutter CI independently on post-import PR #36 head `cb09a4058719576df6d589f1f8b59be517b592b5`; verify the exact candidate SHA.
2. Review PR #36 and keep it draft/open until the owner explicitly authorizes merge. Do not merge automatically.
3. Integrate the imported UI package with the native Flutter WebView/runtime loader and prove an approved screen renders on Android and iOS.
4. Verify navigation and typed bridge events against actual Flutter handlers; map each screen action to a documented API contract and existing backend handler.
5. Resolve missing/uncertain API contracts (including CH-02 room events), then perform visual parity, security and physical-device E2E acceptance.

Latest evidence: [CI run #42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987), input SHA `478cad39bc39e8002e55293e3015e72b68e26c8c`; post-import branch head `cb09a4058719576df6d589f1f8b59be517b592b5`. Full report: [2026-11-09-1211-ui-archive-import-ci.md](../../development/reports/2026-11-09-1211-ui-archive-import-ci.md).

---

## Immediate next step — open and verify the Codespaces workspace (2026-11-08)

The owner selected GitHub Codespaces. A draft devcontainer is on branch `feat/beta1-full-screen-api-harness` (PR #28). Before further source edits:

1. Open the repository in GitHub and create a Codespace on branch `feat/beta1-full-screen-api-harness`.
2. In the terminal, run:
   ```sh
   git status --short --branch
   git log -1 --oneline
   git remote -v
   git branch -a
   git submodule status
   git rev-parse HEAD
   ```
3. Confirm the checked-out HEAD equals the latest PR head and that the full repository, required refs, submodules and LFS objects are available. If any are missing, stop and document the exact gap.
4. Validate `.devcontainer/devcontainer.json` and `.devcontainer/docker-compose.yml`; build the app/db services and inspect container logs. The configuration has not yet been run.
5. Verify PostgreSQL readiness, backend migrations, `/healthz` and `/readyz`; record exact outputs and test commands.
6. Inspect the latest Flutter Actions failure at `flutter analyze` and fix it only from the complete Codespaces clone. Latest run at handoff: [#42509620990](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42509620990), then in progress.
7. Audit the 34 route declarations against actual backend handlers and response schemas. Do not count a route declaration as a connected screen. The requirement remains at least 10 live, authenticated, response-verified screens.
8. Keep PR #28 draft/open; do not merge until full CI and the required integration evidence pass.

Current branch at handoff: `bf6806cb669220addf3771ad458ebfa5a30357fa`. Codespaces guide: [CODESPACES_TEST_ENVIRONMENT.md](../../docs/CODESPACES_TEST_ENVIRONMENT.md). Session evidence/blocker: [SESSION-LOG.md](../../development/SESSION-LOG.md).

# InOne — инструкция следующему чату / исполнителю


> **НОВАЯ ТОЧКА ПРОДОЛЖЕНИЯ — 08.11.2026:** P0 уже закрыт и объединён в `main` через PR #25; merge commit `97024ab03ce9583e298ee946f3679565007405ca`. Не повторяй восстановление P0 и не проси владельца повторно присылать бандл. Все 6 CI jobs прошли на PR head в [run #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362) и повторно на merged `main` в [post-merge run #134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744). Сначала прочитай [P0 closure report](../../development/recovered-source/P0-CLOSURE-2026-11-08.md) и [ARTIFACT-RETENTION](../../development/ARTIFACT-RETENTION.md). Следующий отдельный продуктовый этап — восстановление/проверка Flutter Beta 1.0 source, native Android/iOS MLS integration, secure key storage, durable on-device message storage и device E2E. Старые инструкции ниже — исторические и не должны переоткрывать P0.



> **НОВАЯ ТОЧКА ПРОДОЛЖЕНИЯ — 08.11.2026:** P0 уже закрыт и объединён в `main` через PR #25; merge commit `97024ab03ce9583e298ee946f3679565007405ca`. Не повторяй восстановление P0 и не проси владельца повторно присылать бандл. Все 6 CI jobs прошли на PR head в [run #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362). Сначала прочитай [P0 closure report](../../development/recovered-source/P0-CLOSURE-2026-11-08.md) и [ARTIFACT-RETENTION](../../development/ARTIFACT-RETENTION.md). Следующий отдельный продуктовый этап — восстановление/проверка Flutter Beta 1.0 source, native Android/iOS MLS integration, secure key storage, durable on-device message storage и device E2E. Старые инструкции ниже — исторические и не должны переоткрывать P0.


**Точка продолжения:** 2026-11-08 08:25 (UTC+3)

Прочитай сначала [README](README.md), затем [CURRENT-STATE](CURRENT-STATE.md), [DECISIONS](DECISIONS.md), [SOURCE-OF-TRUTH](SOURCE-OF-TRUTH.md). Не проси владельца пересказывать историю или присылать артефакты, пока не проверил общую Library.

## Приоритет 0 — восстановить точный исходный код

1. Проверить Library `/InOne` на текущие bundle/zip/patch артефакты; искать более новые версии, чем перечисленные в SOURCE-OF-TRUTH.
2. Найти способ получить реальные байты этих файлов в рабочее окружение. Предыдущая ошибка materialize должна быть диагностирована, а не обходиться просьбой к владельцу.
3. Для каждого Git bundle выполнить `git bundle verify`, `git bundle list-heads`, сохранить SHA-256.
4. Импортировать bundles в изолированный git repository/worktree. Не делать force-push, не заменять refs, не сбрасывать main.
5. Сравнить все P0 bundle heads, исходные ветки, ancestry, merge-base и diffs; отдельно сравнить UI zip r2 и предыдущую версию.
6. Определить canonical P0 branch и UI branch на основании commit graph + содержимого + patch sequence, а не по одному только времени файла.
7. Сверить патчи 016–020 и session patch: какие уже применены, какие нет, нет ли дублирования/конфликтов.
8. Создать точный manifest: source SHA-256, refs, commit SHA, список patch IDs и diff summary.

## Приоритет 1 — опубликовать код и запустить CI

1. Использовать обычный Git transport из локального клона с сохранением истории. Не создавать искусственный snapshot commit поверх main.
2. Опубликовать точную canonical branch под новым уникальным remote ref, если такого ref нет. Сначала проверить remote refs и ancestry.
3. Создать PR в согласованную target branch. Не merge до прохождения checks.
4. Добавить GitHub Actions workflows для Node 22, PostgreSQL 16, Rust 1.91 и Flutter stable. Pin versions; сохранять logs/artifacts.
5. Запустить полный Node suite; PostgreSQL migration clean-install + upgrade + test:db; Rust fmt/check/test; Flutter pub get/analyze/test.
6. Если connector не умеет передавать bundle bytes или запускать нужный транспорт, явно зафиксировать блокер и найти доступный поддерживаемый механизм. Не изображать GitHub API file writes как импорт Git history.

## Приоритет 2 — закрыть интеграционные блокеры

- Android и iOS native handlers для `mobile-mls/mls-client`.
- Rust FFI/library packaging для обеих платформ.
- Keychain/Keystore-backed secure DB key provider.
- Durable local message store.
- ACK только после локальной persistence transaction; idempotent eventId.
- Send/receive/offline/restart/outbox/revoked-device/epoch-outdated tests на реальных Android/iOS устройствах.
- Пока перечисленное не готово, MLS send/decrypt остаются fail-closed. Не включать plaintext fallback.

## Приоритет 3 — Beta 1.0 release gate

- Auth: registration, email confirmation, login, approval/waiting, recovery, refresh rotation.
- Organization isolation/permissions.
- Rooms/messages and durable MLS send/receive.
- Device restart and offline recovery.
- Flutter widget tests + Android/iOS device tests.
- Security, regression, load checks; release build and rollback/backup plan.

Tasks, Calendar, Cindy не добавлять в Beta 1.0 без нового решения владельца.

## Ежедневный формат отчёта владельцу

Коротко, 2–3 абзаца:
1. Что фактически сделано (commit/PR/run URLs).
2. Что проверено и что заблокировано (PASS/FAIL/BLOCKED/NOT RUN; не путать authored tests с executed tests).
3. CTO-рекомендация и следующий шаг.

Проценты:
- Сохранять baseline из CURRENT-STATE.
- Изменять процент только после сравнения объёма работ и объяснять изменение.
- Всегда показывать implementation % и verification % отдельно.
- Не считать старый архивный CI как проверку текущего кода.

## Завершение каждой сессии — обязательный чек-лист

- [ ] Код сохранён в Git commit, branch и SHA записаны.
- [ ] Тесты перечислены с точными командами и результатами.
- [ ] Непройденные проверки обозначены BLOCKED/NOT RUN.
- [ ] CURRENT-STATE.md обновлён.
- [ ] SOURCE-OF-TRUTH.md обновлён при добавлении/замене артефактов.
- [ ] NEXT-SESSION.md содержит конкретную следующую задачу.
- [ ] README.md и журнал обновлены.
- [ ] Ссылки PR/Actions/commit добавлены, если они существуют.

Никогда не заканчивать сессию так, чтобы следующий чат должен был восстанавливать контекст только из памяти предыдущей модели.

## Update after the 2026-11-08 recovery attempt

- The Library inventory confirms that the P0 bundles, backend MLS session ZIP, Beta 1.0 UI/API ZIP r2, and curated design-system HTML exist. Raw-byte materialization/read is currently denied by the Project Files layer; see [RECOVERY-ATTEMPT-2026-11-08](RECOVERY-ATTEMPT-2026-11-08.md). Do not repeat the same materialize call blindly or ask the owner to upload existing artifacts.
- Re-check available file/source connectors and authorized export routes; if none can provide the existing bytes, explicitly identify the missing capability before considering a controlled source reconstruction.
- Re-check GitHub refs before further writes. The audit branch head observed this session was `a07815227ecf004628f5b3b94154a4f16de8d1bd`; it is not the current P0/UI source.
- Beta 1.0 database decision is now explicit: independent InOne DB/backend; shared InOne+Propo DB deferred to the next beta. Follow [ADR-011](ADR-011-BETA1-INDEPENDENT-DATABASE.md).
- Immediate user-visible objective remains a runnable Beta 1.0 build, not additional planning documents. Once source bytes are available, prioritize importing and running the Flutter app and backend locally, then produce an installable test build as soon as the native MLS/security gates permit.
## Latest recovery progress — 2026-11-08

- Draft PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17) preserves readable Library patches 016–020 and the P0/MLS/Beta 1.0 reference documents on branch `recovery/source-artifacts-2026-11-08`. It is not product code and is not merged.
- Read-only compatibility audit proves patches 016–019 do not match the archived GitHub 0.6.0 source; Patch 020 targets a missing Rust test file. Do not apply this patch stack to that archive.
- Library contains no standalone `.dart`, `pubspec.yaml`, or `.arb` files. The Flutter Beta 1.0 app source is only in the inaccessible UI/API ZIP r2.
- Continue searching for an authorized way to export the existing Library bundle/ZIP bytes. If not possible, do not pretend the 0.6.0 archive is a substitute. Keep main unchanged until exact source import is possible.

## Mandatory development workspace handover — 2026-11-08

- Before any work, read `development/README.md`, `WORKING-RULES.md`, `BASELINE-2026-11-08.md`, `HANDOVER-CHECKLIST.md`, and `SESSION-LOG.md`.
- Follow the full-repository copy/work/return protocol in `development/WORKING-RULES.md`. All meaningful deliverables must be committed to GitHub; no model-memory/local-only dependency.
- The owner-provided P0 Wave 3 bundle is verified: SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`, ref `engine/p0-wave3`, HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, complete five-commit history. It has no shared commit with GitHub main.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) is a patch-based validation/import path. Fetch live workflow status; do not claim checks passed until verified. It does not import the original Git ancestry.
- Preserve the full original bundle and `ARCHITECTURE-MAP.md` in GitHub using a supported binary/Git transport or approved artifact storage; verify hashes. Do not treat the compressed patch as a complete archive.
- Then verify whether the applied-source branch was created by CI. Open a separate source-code PR only from that verified branch.
- Next product priority: locate/recover the actual Flutter Beta 1.0 source (not present in the P0 bundle), restore it into GitHub, connect the native MLS bridge securely, and produce a testable Android build as soon as the release gates allow.
- Keep Beta 1.0 independent from Propo's operational database. Shared DB remains deferred.


## PR #18 CI correction — 2026-11-08

- Initial workflow run [42453233555](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42453233555) failed: Node suite 364/365, missing `client-reference/biometric-client.mjs`; PostgreSQL and Rust stages skipped.
- Exact file restored from bundle base commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`, blob `b03e72fe33c79e6b261d980bc86459babf03b388`, to PR #18 in commit `04a490e9a01cf7523fb45205a8077f5f357c2658`.
- Workflow path filter update committed as `762e3eca8ccb2e34965441114cc29b63083aa0f9`. Verify a new Actions run for this exact head; it was not visible at the last check.
- Re-evaluate full source-tree completeness: matching only the eight modified files did not prove the archived base was a complete match. Do not publish or merge the source branch until all validation steps pass.
- Full original bundle bytes are still not stored in GitHub. The connector does not expose a binary Git/LFS upload route; use approved durable artifact storage or authenticated Git transport when available. Do not claim the patch file is a full bundle.


## Current live check status

- PR #18 corrected head `762e3eca8ccb2e34965441114cc29b63083aa0f9`.
- Duplicate validation trigger PR [#19](https://github.com/vahe210991-cloud/InOne-chat/pull/19) created from the same head. Keep #18 as the primary PR; close #19 after verification.
- Runs [42454943853](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42454943853) and [42455077322](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42455077322) were in progress at last check. Node suite running; PostgreSQL/Rust not yet run.


## Next CI checkpoint

- The 368/369 failure in runs #42454943853/#42455077322 was due to missing original biometric vector fixture. A labelled replacement fixture is committed in PR #18; local crypto verification passed.
- Current run [42457009510](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457009510) must be inspected through every stage: Node, room-list, PostgreSQL, OpenMLS, Rust.
- PR #19 closed as superseded. PR #18 remains unmerged.
- If tests reveal more absent unchanged files, compare against exact bundle base and restore with provenance; do not silently manufacture artifacts or claim the full source tree matches.


## Exact-source correction

- The original biometric vector fixture was found in the root archived client-reference directory and copied to the engine-relative test path. Exact blob SHA: `5a00755946219df2527591f00058a19d167c7811`.
- Latest PR #18 head is `c9eaf6e198d1b65549220d3742b5190d7bbc1a39`; run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) queued.
- The generated replacement fixture was superseded before acceptance; use the exact restored source file only.


## Mobile source boundary — confirmed by full tree audit

- Main recursive tree SHA `89ba83a4cbd06b648cba8ea5a7c529bfd91285e7`, 602 entries, confirms no full Flutter app. Only a Dart organization API reference package exists and its README says unverified/no Flutter screen.
- Checked other active branches: no Flutter app found.
- Do not claim Beta 1.0 is buildable from current GitHub tree. Obtain/import original Flutter UI/API ZIP and design system; then validate on real Dart/Flutter toolchain.
- See `development/REPO-AUDIT-2026-11-08.md`.


## P0 publish branch correction

- Workflow now copies the exact restored biometric client and vector fixture from the PR head into the clean main-based recovery branch before patch application. Commit `e0a8c08ddf68864963c3f8a65ba16a0612381e39`.
- Check run [42457297299](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457297299) through every step. The older run #42457116231 does not validate the publish correction.


## Original P0 bundle status correction

- The uploaded ZIP is present in the active runtime and its inner bundle was verified complete with `git bundle verify`: 5 commits, P0 HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`, 240 base blobs.
- Preserve checksums from `development/recovered-source/README.md`. Binary still not in GitHub; base64 blob API exists but current tool bridge cannot transfer mounted bytes to it. Do not claim it was uploaded.


## P0 validation current blocker

- Latest completed validation run #42457297299: Node 369/369 and room regression 2/2 passed; PostgreSQL 42/43 passed. The only DB failure was pg_dump/pg_restore client version mismatch against PostgreSQL 16 service (`transaction_timeout`).
- Workflow pinned to Ubuntu 24.04 + PostgreSQL client 16 at commit `0e13b9726c5fcbecfdb8a9a45b05d4bb6eb02863`.
- Inspect fresh run [42457594088](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457594088) and require PostgreSQL, OpenMLS, Rust, and publish job to pass.
- No merge yet.


## Latest continuation instruction — P0 only (2026-11-08)

Do not follow the older instruction above to wait for a published applied-source branch: it now exists. Start from [P0-GITHUB-RECOVERY-STATUS-2026-11-08.md](../../development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md).

1. Fetch current refs and verify `recovery/p0-wave3-applied` HEAD before editing. Last checked SHA: `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`.
2. Continue only on P0. Do not start Flutter UI wiring, auth feature work or other Beta features.
3. Complete the 240-file original bundle blob-hash audit; path-count parity is not blob-hash parity.
4. Verify the six substantive changed engine files and five added P0 tests against the exact bundle/patch provenance.
5. Preserve a pre-format source hash manifest, then apply rustfmt in a separate formatting-only commit. Re-run all CI checks on the exact resulting SHA.
6. Require Node, room regression, PostgreSQL, OpenMLS, Rust bridge and formatting checks all green before P0 acceptance.
7. Keep PR #22 draft/open and do not merge until the source-integrity and CI gates are accepted. Do not modify `main`.
8. Keep the original bundle archive limitation visible: its checksum/provenance are known, but the binary itself is not yet retrievable from GitHub as a committed archive.

Latest exact-head evidence: [push run 42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and [PR run 42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297). Overall status is FAIL due to rustfmt only; the functional suites listed in the status report passed.


## Mandatory approved WBS and current UI stage — 2026-11-09

Before any work, read [AGENTS.md](../../AGENTS.md), the full [AI agent mandate](../../development/AI-AGENT-MANDATE.md), and the full [owner-approved progress baseline](../../development/PROGRESS-BASELINE.md). The WBS is approved and immutable without a new owner decision. Current UI stage is Beta 1.0 UI-01 through UI-06; continue from [UI integration report](../../development/reports/2026-11-09-1015-ui-integration-start.md) and branch `feat/beta1-ui-source-integration`. The owner-provided Ui.zip has been checksum-verified locally; its full binary/source package is not yet confirmed uploaded to GitHub. Do not claim import complete until remote files/checksums are verified.


## Current next-session instructions — Beta 1.0 Stage 4 (2026-11-11)

**Execution ownership:** ChatGPT is the sole developer/executor. Do not prepare or delegate tasks to an external agent unless the owner explicitly instructs otherwise.

**Scope:** Beta 1.0 only. Keep the approved WBS v1.1 weights and baseline unchanged.

1. Start from the latest PR #45 head; read `development/WORKING-RULES.md`, `development/PROGRESS-BASELINE.md`, `docs/continuity/CURRENT-STATE.md`, `docs/continuity/DECISIONS.md`, and `development/reports/2026-11-11-stage-4-single-executor-progress.md`.
2. Resolve GitHub Actions runner allocation. The latest OpenMLS and FRB jobs failed before their first step with runner_id 0 and empty step arrays. Do not infer a billing, policy or source-code cause without evidence.
3. Design and implement an atomic or recoverable persistence boundary between OpenMLS ratchet-state mutation and durable inbox persistence. Add crash injection, app restart and duplicate-delivery regressions.
4. Execute Rust/OpenMLS tests, FRB generation, Flutter analyze/tests, Android APK + Keystore runtime test, iOS device/simulator builds and signed iOS Protected Keychain runtime test.
5. Keep `INONE_MLS_NATIVE_ENABLED` false until all platform and security gates pass. No plaintext or Megolm fallback.
6. Run the complete required matrix on one exact final SHA. Record commands, results, logs and artifacts. A skipped or unexecuted test is not a pass.
7. Do not merge PR #45 or claim Stage 4 accepted until all required checks are green. Owner approval is required.
8. Do not recalculate Beta 1.0 progress or alter WBS weights without verified evidence and owner-approved scope.

Report: `development/reports/2026-11-11-stage-4-single-executor-progress.md`.


## Additional Stage 4 verification tasks — 2026-11-11

- Verify the one-connection transaction-backed OpenMLS provider compiles and passes its rollback/commit regression.
- Add/run process-kill crash/restart coverage around `process_and_persist_incoming`; prove ratchet state and inbox remain consistent.
- Add/run restart coverage for a server-accepted invite/revocation commit when the process terminates before local merge.
- Verify `clear_pending_commit` behavior on OpenMLS 0.8 with the rejected-commit regression.
- Verify that invite/revocation server errors clear pending commits without advancing local epoch.
- Execute full Rust/OpenMLS, FRB, Flutter, Android Keystore and signed iOS Protected Keychain matrix on one exact final SHA. Current GitHub Actions jobs still fail before runner allocation; no tests have executed.


## Additional recovery checks — 2026-11-11

- Test Welcome ACK retry after local group commit and process restart; verify the same Welcome is not processed twice.
- Test SQLCipher resume with an absent platform key; assert that no replacement key is generated.
- Test new-session initialization failure after key creation; verify both database artifacts and the newly created key are cleaned.
- Test DB/key mismatch through every session-creation entrypoint (`connect`, `connect_with_session`, `connect_with_approval`).


## Current execution instructions — Beta 1.0 / Stage 4 — 2026-11-11

- Work as the sole ChatGPT executor. Do not assume or assign an external agent; owner will notify if one becomes available.
- Current product stage is Beta 1.0. Use approved WBS v1.1 only; do not include Beta 2.0/future scope in current acceptance.
- Current PR #45 head: `84248642e05e03c976a6f8d0eae0a9ab03a64765`.
- Review and verify the latest source changes: undeclared Rust identifier correction, duplicate pubspec dependency removal, retryable Android/iOS secure-store initialization, retryable Android JNI context, HTTPS/local-debug origin validation, disabled redirects, and associated regression tests.
- Current CI #42981617948 (OpenMLS) and #42981617913 (FRB) failed before any retrievable step summary; logs returned BlobNotFound. iOS dependent job skipped. Flutter mobile #42981617907 skipped by branch condition. Do not infer the root cause.
- Local environment currently has no Rust/Cargo/Flutter/Dart/Xcode. Do not claim local tests. Obtain an executable GitHub Actions runner or another owner-authorized build environment before declaring any test result.
- Continue code review and implement tests for: transaction-backed OpenMLS storage rollback/commit; incoming ratchet+inbox atomicity under process crash; duplicate delivery after restart; Welcome ACK retry after local durable join; server-accepted invite/revocation commit recovery after crash before local merge; missing SQLCipher key fail-closed; key/database mismatch; logout cleanup.
- Verify Android Keystore and iOS Protected Keychain runtime behavior, signed iOS build and Android runtime smoke tests.
- Keep `INONE_MLS_NATIVE_ENABLED=false` until all required platform and security checks pass.
- No merge of PR #45 without complete green required matrix on one exact final SHA and owner approval. Do not update Beta 1.0 progress percentages until WBS criteria have accepted evidence.

Report: `development/reports/2026-11-11-stage-4-single-executor-progress.md`.


## Additional next-session tasks — credential handling

- Verify Rust login/approval response zeroization tests and ensure all response branches zeroize.
- Verify Flutter login callers only receive sanitized maps and no screen/log exposes tokens, one-time codes or poll secrets.
- Verify request body buffer cleanup and bearer-header removal do not break IOClient/MockClient or retries.
- Run full Rust/OpenMLS and Flutter test suites on the exact current PR head `6e56671b632c993ebd15735caf5001ad2662012a`; current workflows have no step summaries or log URLs.


## Historical P0 parity implementation checklist — ported, verification pending

The following invariants have been ported into the active `inone-engine-poc-0.6.0/mobile-mls/mls-client` while preserving SQLCipher/platform-key architecture. The next task is verification, not re-porting:

1. F1: durable Welcome receipts, duplicate handling, quarantine and ACK retry after restart.
2. F4: membership journal, exact staged-Commit fingerprint, idempotent replay and safe rebase.
3. F5: event identity/epoch validation before processing/marking.
4. P0.3: room-scoped WaitingForCommit, Commit quarantine and sticky RecoveryRequired.
5. KeyPackage claim/replay: durable claim intent, claim IDs, server reservation replay.
6. Adapted regression sources are present in the active mobile client; test execution remains unverified.
7. Preserve secure storage, token zeroization, HTTPS and no-redirect hardening.
8. Execute the complete CI and Android/iOS runtime matrix on one final SHA. No acceptance until green.

Reference files:
- `inone-development-archive-0.6.0/engine/mobile-mls/P0-ACCEPTANCE-MAP.md`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/src/lib.rs`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/tests/welcome_receipt_recovery.rs`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/tests/membership_journal.rs`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/tests/waiting_for_commit.rs`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/tests/commit_quarantine.rs`


## Next session — Beta 1.0 Stage 4 verification gate (2026-11-11)

1. Start from PR #45 branch `feature/stage-4-native-mls-runtime-2026-11-11`, latest recorded HEAD `df53ff48a42d9b9ca1dc7b19f049f8f3b05585a6`. Re-fetch PR head before any work.
2. Read `development/reports/2026-11-11-stage-4-native-mls-hardening-progress.md` and this continuity file set.
3. Do not assume any test passed. Latest OpenMLS #42986269774 and FRB #42986269879 failed without step summaries/logs; Flutter job #42986269746 was skipped. Obtain usable logs or restore CI observability before diagnosing.
4. Do not start an external agent; owner has specified that ChatGPT is the sole developer until further notice.
5. Do not weaken tests or remove checks. Fix only causes confirmed by actual logs.
6. Run full mls-client integration suite against P0 engine; run FRB codegen, Rust bridge tests, Flutter analyze/tests, Android build/emulator runtime, iOS build and signed protected-Keychain runtime when signing secrets are available.
7. Record exact final SHA, test counts and run links. A skipped platform test is not PASS.
8. Keep refresh-token rotation and SQLCipher key in Rust/native secure storage; preserve fail-closed behavior and no plaintext fallback.
9. Keep Beta 1.0 WBS v1.1 baseline unchanged until evidence-based acceptance; do not work on Beta 2.0.
10. Do not merge PR #45 or #46 without owner approval.


## Current next-session instructions — Beta 1.0 Stage 4 — 2026-11-11 (supersedes earlier heads)

1. Work as ChatGPT sole executor. Do not create or assume an external-agent workstream.
2. Active stage is Beta 1.0. Preserve approved WBS v1.1; do not include Beta 2.0 scope or change percentages.
3. Re-fetch PR #45 before editing. Latest verified branch head at this entry: `56102098427b8853b746b94d8c073c5aa97d0c2c`. PR remains OPEN/Draft.
4. P0 parity porting is complete at source level; do not re-port F1/F4/F5/P0.3 or claim their tests passed. Six active regression files are blob-identical to accepted archive files; execute them on the final SHA.
5. Review the new local-purge fallback in `mobile/rust/src/api/session.rs` (commit `4670646558723ae5b33eeffdaa105f3a6df209ed`) and execute its regression when a runner is available.
6. The FRB workflow now defaults to read-only; generated outputs are committed by a separate allowlisted write job; a final-SHA job reruns Rust/OpenMLS, Flutter and Android checks; iOS is downstream and requires signing assets.
7. Latest OpenMLS #42987007179 and FRB #42987007308 failed with no step summaries/log URLs; FRB generated commit/final-SHA/iOS jobs skipped. Flutter #42987007363 skipped by branch condition. Exact cause is UNKNOWN; do not infer billing, permissions or runner policy.
8. Generated FRB bindings, hook/build.dart and mobile/rust/Cargo.lock remain absent because codegen did not execute. Do not claim the mobile app is buildable from a clean checkout until these outputs are generated and committed.
9. Obtain a working GitHub Actions execution path or an owner-authorized build environment. Current local environment has no Rust/Cargo/Flutter/Dart/Xcode and no outbound network.
10. Run the full matrix on one exact final SHA: Rust format/tests, active mls-client integration against P0 engine, FRB codegen, Flutter analyze/tests, Android APK/emulator Keystore, iOS build and signed Protected Keychain runtime. A skipped test is not PASS.
11. Keep `INONE_MLS_NATIVE_ENABLED=false`. Do not merge PR #45 or claim Stage 4 accepted until all required checks are green on the exact same final SHA and owner approval is given.

Report: `development/reports/2026-11-11-stage-4-single-executor-progress.md`, sections 25–26.


## Latest continuation instruction — Beta 1.0 Stage 4 — 2026-11-11

- Re-fetch PR #45 and the current branch head before any edits. Latest source/workflow head checked: `5e3a9dc7644bb9e2eb462a41de345b4ff9f7df3c`; subsequent commits are documentation/continuity updates. PR remains OPEN/Draft.
- Do not assign an external agent. ChatGPT is the sole executor until the owner says otherwise.
- P0 parity implementation is present in active source; six checked regression files are blob-identical to the accepted archive. Do not re-port; run tests on the final SHA.
- Local-purge fallback regression was added in `4670646558723ae5b33eeffdaa105f3a6df209ed`; execute it when a runner is available.
- FRB workflow is read-only by default; generated output is committed by an isolated allowlisted write job; final-SHA job runs Rust/OpenMLS, Flutter and Android tests. iOS job is behind the protected GitHub Environment `ios-signing`.
- Owner must configure `ios-signing` with required reviewers and environment secrets: `IOS_SIGNING_CERTIFICATE_P12` (base64 P12), `IOS_SIGNING_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE` (base64 profile), `IOS_TEAM_ID`. Do not send secret values in chat.
- Latest full CI on 5e3a9dc: OpenMLS #42987334965 FAILED with no steps/logs; FRB #42987334938 FAILED with no steps/logs and downstream jobs skipped; Flutter #42987335071 SKIPPED. Exact failure cause UNKNOWN.
- Generated FRB bindings, build hook and Rust lockfile remain absent until codegen executes. No local Rust/Cargo/Flutter/Dart/Xcode or network is available.
- Obtain an executing GitHub Actions runner or owner-authorized build environment. Do not diagnose from guesswork.
- Run full matrix on one exact final SHA. A failed job with no steps/logs is not a test result; skipped platform jobs are not PASS.
- Keep `INONE_MLS_NATIVE_ENABLED=false`; no merge; no WBS percentage changes until all Beta 1.0 criteria have green evidence and owner approval.

Report: `development/reports/2026-11-11-stage-4-single-executor-progress.md`, sections 25–27.


## Exact next action — unblock CI on current Stage 4 head

- Re-fetch PR #45 head before work. At the last check it was e8f50e566d1095ed7ad6ed9427abb5d666b5097b; report/continuity commits may have advanced it since.
- Latest exact-head runs: OpenMLS #42987463963 and FRB #42987464006 FAILED with no steps/log URLs; Flutter #42987463998 SKIPPED. FRB downstream jobs skipped. The combined status API returned no entries.
- Obtain the exact job-level failure message from the GitHub Actions UI for run #42987464006 or #42987463963. Do not infer runner/billing/permissions causes from BlobNotFound.
- Once the reason is known, restore execution, then run the full matrix on one exact final SHA. Generated FRB artifacts remain absent; do not accept Stage 4 until codegen, Rust/OpenMLS, Flutter, Android and signed iOS checks all pass.
- Keep Beta 1.0 WBS unchanged and INONE_MLS_NATIVE_ENABLED=false. No merge.

Report: development/reports/2026-11-11-stage-4-single-executor-progress.md, section 28.


## Latest next actions — logout safety and crash consistency — 2026-11-11

- Review Rust `Client.logout` and execute `logout_clears_local_session_tokens_when_server_is_unavailable`.
- Review Flutter `InOneSession.logout` and execute both new tests in `mobile/test/core/session/inone_session_logout_test.dart`.
- Execute Rust tests `existing_database_with_wrong_protected_key_is_rejected_without_replacement`, `failed_new_session_initialization_removes_partial_database_and_key`, and `process_crash_rolls_back_openmls_storage_and_inbox_atomically`.
- Latest test-source head: `54711b873349a8adb575f27d9c1fcccebbc49081`. FRB #42988592622 and OpenMLS #42988592592 failed with no step/log data; Flutter #42988592656 skipped. Do not infer cause.
- Obtain the exact job-level failure message from GitHub Actions UI or an authorized working runner. Then run the complete Beta 1.0 matrix on one final SHA.
- Do not mark any new regression PASS until executed. Keep native MLS disabled and do not merge.
- Report section 29.


## Governance prerequisite — current owner instruction

Read `development/AI-AGENT-MANDATE.md` at the start of every session. ChatGPT remains sole executor; do not delegate to an external agent unless the owner explicitly authorizes it. Active product stage is Beta 1.0. Acceptance remains based on all criteria and green tests on one exact SHA.


## Latest CI retry evidence — 2026-11-11

- Code/test head: `5ca865573e7ed8949698ce7eda7d0adbf5f5915a`.
- FRB run #42988901680 and OpenMLS run #42988901678 failed with no steps/log URLs; logs returned BlobNotFound. Flutter run #42988901824 skipped.
- Do not infer root cause. Obtain the exact job-level failure message from GitHub Actions UI or restore an authorized runner.
- New Rust/Dart regressions remain NOT RUN. No PASS claims. See report section 31.


## Latest exact-head state — 2026-11-11

- PR #45 head: `28aa6f488472688ae5d728e18da8ef24910d540d`.
- OpenMLS #42989119932 and FRB #42989119937 failed before steps/logs; Flutter #42989120066 skipped. No test command evidenced as executed.
- Crash regression `process_crash_rolls_back_openmls_storage_and_inbox_atomically` tests OpenMLS storage plus inbox/processed transaction rollback on process exit; do not describe it as live ratchet mutation.
- Exact CI failure reason UNKNOWN; obtain job-level message from GitHub Actions UI or restore an authorized runner. Report section 32.


## Current-head CI unblock — 2026-11-11

- Latest PR #45 head checked: `d81e05a794f10aa47e414dcc8d8920ffcd35755e`.
- OpenMLS #42989207053 and FRB #42989207170 failed before steps/logs; logs returned BlobNotFound. Flutter #42989207122 skipped.
- No tests are evidenced as executed. Obtain the exact job-level failure message from GitHub Actions UI for run #42989207170 or #42989207053. Do not infer cause.
- Once execution is restored, run all Beta 1.0 acceptance checks on one exact final SHA. Keep native MLS disabled; no merge. Report section 33.


## Latest current-head CI retry — 2026-11-11

- PR #45 head checked: `e7e19ce9de18e6042b36e5bd5f2ae9700796afd1`.
- FRB #42989322261 and OpenMLS #42989322167 failed before steps/logs; logs returned BlobNotFound. Flutter #42989322186 skipped.
- No test command evidenced as executed. Obtain the exact job-level failure message from GitHub Actions UI or restore an authorized runner. Do not infer cause.
- Report section 34. Keep Beta 1.0 scope, native MLS disabled and no merge.


## Latest CI gate — 2026-11-11

- Native matrix path filter: workflow file + `mobile/**`; documentation-only edits do not trigger the matrix.
- Latest PR #45 head: `bfb87598068239c1107233d930ee79f25ff62d77`.
- FRB #42989491362 and OpenMLS #42989491373 failed before steps/logs; logs returned BlobNotFound. Flutter #42989491354 skipped.
- No test command evidenced as executed. Obtain the exact job-level failure message from GitHub Actions UI or restore an authorized runner. Report section 35.


## Stage 4 — next action after failed-job rerun — 2026-11-11

- PR #45 latest recorded head: `f6384a0bd68460849cbc9b9ce0fa6d7e9fcb9a6a`; latest code-triggered run SHA: `bfb87598068239c1107233d930ee79f25ff62d77`.
- Failed-job reruns #42989491362 and #42989491373 were accepted by the API but again failed with no step summaries/log URLs; logs return `BlobNotFound`. Latest job IDs: `130426024038` and `130426036241`.
- No test/codegen/build command is evidenced as executed. Do not modify runner labels, permissions or acceptance checks speculatively.
- Obtain the exact job-start failure detail visible in the Actions UI or use an owner-authorized working runner; then execute the full Beta 1.0 matrix on one exact final SHA.
- Keep native MLS disabled, WBS v1.1 unchanged, Stage 4 NOT ACCEPTED / BLOCKED; no merge. Report section 36.
