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
