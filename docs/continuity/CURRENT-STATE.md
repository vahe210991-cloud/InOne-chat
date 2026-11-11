> **UI SOURCE IMPORT UPDATE — 2026-11-09 12:11 (UTC+3):** Owner-provided `Ui.zip` is now present on the PR #36 task branch at `mobile/assets/ui-approval/`. CI run [#42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987) passed all 15 steps: archive SHA verification, nested package import, 73-screen gallery check, Flutter pub get/analyze/tests, Android preview APK build and artifact upload. Run event SHA: `478cad39bc39e8002e55293e3015e72b68e26c8c`; import bot advanced branch head to `cb09a4058719576df6d589f1f8b59be517b592b5`. Remote tree contains 31 screen HTML files, 32 HTML including index, and 5 WOFF2 fonts. PR #36 remains draft/open/unmerged. Runtime WebView rendering, live bridge/API integration and device acceptance are NOT YET VERIFIED. WBS v1.1 unchanged. See [stage report](../../development/reports/2026-11-09-1211-ui-archive-import-ci.md).

# InOne — текущее состояние проекта


> **ИТОГОВЫЙ СТАТУС — 08.11.2026:** этап P0 (backend / Rust / OpenMLS) ЗАКРЫТ. PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) объединён в `main`, merge commit: `97024ab03ce9583e298ee946f3679565007405ca`. Все 6 обязательных CI-проверок прошли на PR head `addd47da245b6452c9f700c7e10b8d0585aad295`, [запуск #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362). Оригинальный бандл постоянно хранится в ветке `artifacts/p0-bundles`; см. [правила хранения](../../development/ARTIFACT-RETENTION.md) и [отчёт о закрытии P0](../../development/recovered-source/P0-CLOSURE-2026-11-08.md). Постслиянийная проверка main завершилась успешно: [CI run #134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744), все 6/6 jobs PASS. Последующие изменения `main` после merge — только документация закрытия P0. Нативная интеграция Flutter Beta 1.0 — отдельный следующий этап. Исторические записи ниже сохранены для хронологии.


**Срез:** 2026-11-08 08:25 (UTC+3)  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Default branch:** `main`  
**Документ — снимок состояния, а не обещание готовности к релизу.**

## 1. Краткий статус

| Направление | Оценка реализации из последнего CTO roadmap | Подтверждённая проверка | Статус |
|---|---:|---:|---|
| Backend P0 / MLS | 100% | 100% | PR #25 merged; all six acceptance CI jobs passed on the final PR head |
| UI Beta 1.0 | 70% | 0% | Flutter-код и тесты подготовлены локально; Flutter SDK отсутствовал |
| UI ↔ API ↔ MLS | 50% | 0% | Контракты и session handoff подготовлены; native handlers и local message store отсутствуют |
| Сквозной Beta 1.0 | 0% | 0% | Не начинался |
| Подготовка тестирования | 60% по ранее согласованному рабочему учёту | См. ниже по конкретным наборам | Не является процентом пройденного acceptance |

Проценты реализации — прежняя оценка объёма работ, а не автоматический расчёт и не подтверждение готовности. Не обнулять и не пересчитывать их без ревизии исходников. В отчётах всегда отдельно указывать реализацию и верификацию.

## 2. GitHub — проверенное состояние на момент снимка

- `main`: `dd45ae1e660cf2f8ad0ef67e3c5928bd9329a3a9`.
- `development`: `9b2352235569484cf2e82e38167497dcf6de355d`.
- `engine-poc`: `9b2352235569484cf2e82e38167497dcf6de355d`.
- `ci/inone-engine-validation-2026-11-07`: `e9bbe3ee44077aef9d11cf8804f6c760c727a89e`.
- `docs/inone-identity-design-localization`: `26940241fc84e1a013d717d9a9a883bf5dbe2741`.
- `cto/inone-audit-2026-11-08`: `a07815227ecf004628f5b3b94154a4f16de8d1bd`.

Состояние refs получено из GitHub API в этом сеансе. Перед любым push/PR повторно запросить актуальные SHA — refs могли измениться.

### Важное разграничение

GitHub `main` содержит архивные материалы 0.6.0, планы 0.7 и документы решений. Он **не является** текущей локальной P0/UI рабочей копией, описанной в Library handoff-файлах. PR #10 и Actions run #42395014895 относятся к архивному снимку 0.6.0 и не доказывают готовность текущей P0-ветки.

Ранее в Library зафиксированы локальные ветки и коммиты, не опубликованные в GitHub:
- Backend `cto/p0-finalize-fixtures`, commit `cbecb37`; в другом, более раннем P0 snapshot — `cto/p0-exact-pending-commit`, commit `6fe6b67`.
- UI `ui/beta1-api-integration`, commits `e83858b` и `97d08fd`.

Документ P0-ACTUAL-STATE в Library указывает ещё одну рабочую ветку `cto/p0-finalize-fixtures` с commit `ead8e4c` на исходнике `claude/p0-mls-durability-ci` (99fd3e0). Это разные снимки/состояния; **не объединять и не объявлять один из них каноническим без сравнения Git bundle refs, commit ancestry и diff**.

## 3. Проверки — что реально известно

### PASS (узкие проверки, не полная приёмка)
- JavaScript/MJS syntax: 127/127 PASS в последнем P0-ACTUAL-STATE.
- Фокусированный Node-набор: 13/13 PASS для перечисленных наборов: `mls-memory-store-claims`, `mls-wire`, `client-screens-common`, `org-error-codes`.
- Статическая целостность миграций: 25 миграций, последовательность и markers совпадают, `SCHEMA_VERSION = 0026-mls-commit-metadata-and-claims`.
- `git diff --check`: PASS.
- В более раннем roadmap указаны focused tests 12/12 и отдельные client-screen common/auth contract 10/10. Не смешивать эти результаты: это разные снимки и наборы.

### BLOCKED / NOT RUN
- Полный `npm test`: BLOCKED — в неполном `node_modules` отсутствуют `qrcode`, `pg` и другие зависимости; 74 из 85 файлов/поднаборов завершились ошибкой загрузки до тестовой логики. Это не 74 доказанных функциональных регресса.
- PostgreSQL acceptance и `npm run test:db`: BLOCKED — PostgreSQL server/client и часть npm dependencies отсутствуют.
- Rust `cargo test`, `cargo check`, `cargo fmt --check`: BLOCKED — Rust/Cargo/rustfmt не установлены в среде предыдущего исполнителя.
- Flutter `flutter analyze` и `flutter test`: BLOCKED — Flutter/Dart SDK отсутствуют.
- End-to-end Beta 1.0: NOT RUN.

## 4. Содержание P0-работы в локальных материалах

По документу P0-ACTUAL-STATE от 2026-11-08 в рабочей копии были:
- F4: membership journal с SHA-256 fingerprint, связывающим room, operation ID, точный payload и сериализованный OpenMLS pending staged commit; settlement только при точном совпадении.
- P0.2: серверные membership metadata (adds/removes/removeDevices) сверяются с фактическим MLS результатом; при несовпадении транзакция откатывается и Commit помещается в quarantine.
- P0.3: durable SQLite quarantine с ключом room/epoch/commit hash, причиной и защитой от повторной обработки после рестарта.
- Idempotent Key Package claims/replay: claim ID scoped к инициатору/устройству, точный повтор выдаёт тот же пакет, другой target получает 409.
- Миграция `0026-mls-commit-metadata-and-claims.sql`, обновлены schema/migrate/version marker.

Это описывает локальный исходник из Library; пока соответствующая ветка не опубликована и не прогнана в CI, это не считается GitHub-верифицированным результатом.

## 5. Beta 1.0 — зафиксированная граница

Beta 1.0 включает email/password auth, подтверждённую регистрацию, recovery, чаты/список комнат, организации, профиль и общую API session. Tasks, Calendar и Cindy (AI assistant) **исключены из Beta 1.0**. Не возвращать их в навигацию или release gate без нового решения владельца.

Ограничения:
- Flutter MethodChannel adapter существует как Dart-контракт, но Android/iOS native handlers и FFI packaging не реализованы.
- Нет durable local message store; incoming events нельзя ACK-ать до локальной транзакции persistence.
- MLS send/decrypt остаются fail-closed; plaintext fallback запрещён.
- Profile editing не подключён: серверный GET есть, update endpoint отсутствует.
- Фильтр комнат по выбранной организации не заявляется: контракт `/rooms/mine` не содержит active-org filter.

## 6. Следующие обязательные этапы

1. Получить доступ к реальным байтам Library bundles/patches в рабочей среде (или восстановить локальную копию через поддерживаемый механизм). Не просить владельца повторно присылать то, что уже лежит в общей Library.
2. Сравнить все P0 bundle refs, commit histories и UI zip; выбрать точный source of truth без потери истории.
3. Опубликовать точную ветку обычным Git transport (не искусственным snapshot commit и не force-push).
4. Запустить CI именно на опубликованном P0 SHA: Node, PostgreSQL 16 migrations/upgrade, Rust 1.91+ tests/fmt, Flutter analyze/tests.
5. Реализовать Android/iOS native MLS bridge, secure Keychain/Keystore key provider и durable local message store.
6. Выполнить device-level and end-to-end tests, затем PR и merge только после обязательных checks.

## 7. Безопасное правило слияния

Не сливать PR #10 вместо актуального P0. Не менять main на основании неподтверждённого архива. Сначала опубликовать и проверить конкретный source commit, зафиксировать CI run URLs и итоговые SHA; только потом принимать решение о merge.

## 8. Проверка восстановления исходников — 2026-11-08, текущая сессия

- Повторно проверена удалённая ветка `cto/inone-audit-2026-11-08` (HEAD `a07815227ecf004628f5b3b94154a4f16de8d1bd`). Она содержит архивный engine 0.6.0 и ограниченный 0.7 client-screens API/state spike; актуальных P0/UI веток в удалённых refs нет.
- Library `/InOne` действительно содержит два P0 bundle, backend MLS session ZIP, Beta 1.0 UI/API ZIP r2, design-system HTML и сопутствующие acceptance/roadmap/patch документы.
- Повторный запрос raw-byte materialization для пяти основных артефактов завершился одинаковым отказом: `This Project file does not have an authorized raw-byte materialization path.` Binary Files read также не предоставил доступное содержимое.
- Поэтому в этой сессии **не** импортированы bundle, не вычислены их SHA-256, не сопоставлены Git refs/diffs и не опубликован актуальный исходный код. Это технический блокер текущего рабочего окружения, а не завершённый этап.
- Подробности: [RECOVERY-ATTEMPT-2026-11-08](RECOVERY-ATTEMPT-2026-11-08.md).

### Принятое решение по базе данных

Beta 1.0 использует независимые базу данных и backend InOne. Общая operational database InOne + Propo отложена до следующей версии беты; это решение зафиксировано в [ADR-011](ADR-011-BETA1-INDEPENDENT-DATABASE.md). Для Beta 1.0 сохраняем стабильные глобальные ID и независимость от Propo, но не строим сейчас общую БД.
## 9. Patch preservation and compatibility audit — 2026-11-08

- Создана отдельная ветка `recovery/source-artifacts-2026-11-08` и draft PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17). В ней сохранены читаемые патчи 016–020, P0-ACTUAL-STATE, P0 CTO acceptance, MLS↔Flutter bridge contract, Beta 1.0 scope и screen design spec v0.8.
- Это reference artifacts only; код P0 bundle и Flutter ZIP не импортирован. `main` не содержит production-code изменений от этой recovery ветки.
- Выполнена read-only проверка совместимости патчей с архивным исходником GitHub: текущий `lib.rs` blob `bbcfb53fa993ab1792735b6cf2bab13f4cfa0580`, `server.js` blob `9d466284fe69059dc31444b7b45fb624025a07b9`. Patch 016 Rust context не совпадает; Patch 017/018 server context не совпадает; Patch 019 Rust context не совпадает; Patch 020 ссылается на отсутствующий в архиве `mobile-mls/mls-client/tests/membership_outbox.rs`.
- Вывод: патчи 016–020 нельзя накатывать на архивный 0.6.0 source. Это другой/более поздний baseline. Сохранение patch files в PR #17 не означает их применения или прохождения тестов.
- Точный отчёт находится в `recovery/library-artifacts/PATCH-COMPATIBILITY-REPORT.md` на ветке recovery.
- По Library search не найдено отдельных `.dart`, `pubspec.yaml` или `.arb` исходников; Flutter source по-прежнему доступен только внутри недоступного ZIP r2.
## 10. Рабочее окружение текущей сессии

- `/mnt/data` проверен повторно: исходные архивы и рабочие копии не смонтированы.
- Доступны Git CLI и Node.js v22.16.0/npm.
- Не установлены `cargo`, `rustc`, Flutter, Dart и PostgreSQL client/server (`psql` не найден).
- Поэтому даже после текстового сохранения патчей нельзя запускать локальные Node/Rust/Flutter/DB тесты без восстановления соответствующего исходного дерева и зависимостей. GitHub Actions PR #10 остаётся проверкой только архивного 0.6.0 source.

## 11. Recovery update — owner-provided P0 Wave 3 bundle (2026-11-08 08:56 UTC+3)

This section supersedes the earlier section 8 statement that no bundle bytes were available in the working environment.

- The owner uploaded `Bundle(1).zip`; it contains `inone-engine-p0-wave3.bundle`, `BUNDLE-VERIFICATION.txt`, and `ARCHITECTURE-MAP.md`.
- Bundle SHA-256: `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`; size 1,052,468 bytes.
- `git bundle verify`: PASS; complete 5-commit history.
- Ref `refs/heads/engine/p0-wave3`; HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`; base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.
- Bundle protocol says this history has no shared commit with GitHub main. Do not force-push or claim original ancestry has been merged.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) stores a compressed patch derived from the bundle and a validation workflow. It is a patch-based recovery path; it does not preserve the bundle's original five-commit ancestry. Check live Actions status and any published source branch before making claims.
- Local JavaScript/MJS syntax check: 135 files PASS (syntax only).
- Product Flutter app source is not included in this P0 bundle. A runnable phone app is not yet established.
- New mandatory development handover folder is `development/`; see [development README](../../development/README.md), [working rules](../../development/WORKING-RULES.md), [baseline](../../development/BASELINE-2026-11-08.md), and [session log](../../development/SESSION-LOG.md).
- The original bundle bytes and architecture map are not yet confirmed as files committed to the GitHub repository. The PR patch is not a substitute for the full original bundle. Do not mark archive preservation complete until GitHub contains a verified retrievable copy or an approved artifact location and checksum.


## 12. PR #18 initial CI failure and source-tree correction — 2026-11-08

- Workflow run [42453233555](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42453233555) completed with **failure**.
- Node backend suite: 365 tests; 364 passed, 1 failed. Failing file: `test/client-reference.test.js`; cause: missing `client-reference/biometric-client.mjs` in the archived GitHub tree.
- This file exists in the verified bundle base commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`, blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`. It was restored to PR #18 branch in commit `04a490e9a01cf7523fb45205a8077f5f357c2658`.
- Workflow path filter was updated in commit `762e3eca8ccb2e34965441114cc29b63083aa0f9`. A fresh Actions run was not yet visible when checked; do not treat the old run as a pass or as validation of the new head.
- The first CI run proves the eight-file blob comparison was not sufficient to prove full base-tree identity. Check the entire source tree for additional missing files before acceptance.
- PostgreSQL and Rust steps were skipped because Node test step failed. No P0 acceptance is established.
- Detailed record: [development/recovered-source/CI-RESULT-42453233555.md](../../development/recovered-source/CI-RESULT-42453233555.md).


## 13. InOne ↔ Propo integration brief preserved — 2026-11-08

- Owner-provided `INONE_INTEGRATION_BRIEF.md` committed to `development/integrations/INONE-PROPO-AUTH-INTEGRATION-BRIEF.md`.
- Status remains Planned; the document explicitly states no InOne-side implementation is assumed. Production integration is blocked on open contract/security decisions; it is not a Beta 1.0 release dependency.


## 14. Corrected P0 validation reruns — live status snapshot

- PR #18 corrected head: `762e3eca8ccb2e34965441114cc29b63083aa0f9`.
- PR [#19](https://github.com/vahe210991-cloud/InOne-chat/pull/19) is a temporary duplicate validation trigger from the same corrected head; PR #18 remains primary.
- Actions runs [42454943853](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42454943853) and [42455077322](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42455077322) were still `in_progress` at the latest check. Patch decode/apply and npm dependency install passed; backend `npm test` was still running. PostgreSQL and Rust steps had not started.
- No fresh validation pass is established. Keep both PRs unmerged until the actual run results and source-tree completeness are reviewed.


## 15. Biometric vector fixture gap and corrective validation — 2026-11-08

- Corrected P0 CI runs [42454943853](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42454943853) and [42455077322](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42455077322) failed at Node tests: 368/369 passed. The only failure was ENOENT for `client-reference/vectors/biometric-vectors.json`; PostgreSQL and Rust steps were skipped.
- The original fixture was not recoverable from the currently accessible source. A replacement fixture was generated and explicitly labels its provenance as a replacement, not the original bundle asset. It contains two valid P-256/SHA-256 DER-base64url signatures and two altered-input negative cases. All four vectors were locally verified with Node crypto.
- Added to PR #18 branch in commit `bdedff6df54876e82f46a34d27f2fadfac42b46d`; workflow path filter updated in `ee7a877aedb43ca90df8cd410dbf536c2f436668`.
- New Actions run [42457009510](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457009510) is in progress. No CI acceptance is claimed yet.
- Duplicate PR #19 was closed as superseded; PR #18 is the sole primary P0 recovery PR.
- Do not merge until latest run completes all Node, room-list, PostgreSQL, OpenMLS, and Rust bridge checks. The replacement fixture should later be compared with the exact original bundle fixture if original bundle bytes become accessible.


## 16. Exact biometric fixture recovered; latest validation queued — 2026-11-08

- Further source-tree inspection found the original fixture in `inone-development-archive-0.6.0/client-reference/vectors/biometric-vectors.json` on main, along with the matching root `client-reference/biometric-client.mjs` (blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`).
- Restored the exact original fixture to the engine-relative path required by `engine/test/client-reference.test.js`. Original root blob SHA and restored engine blob SHA both equal `5a00755946219df2527591f00058a19d167c7811`.
- Re-verified the original fixture locally with Node crypto: 1 positive signature passes; 2 negative altered-input cases fail verification.
- The temporary generated fixture from commit `bdedff6...` was replaced in commit `c9eaf6e198d1b65549220d3742b5190d7bbc1a39` before acceptance. It is not present in the current PR head.
- Latest CI run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) is queued for the exact-source fixture. Previous run [42457009510](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457009510) used the temporary replacement and is superseded.
- Duplicate PR #19 is closed; PR #18 remains the only primary recovery PR and is not merged.


## 17. Full repository tree audit — Flutter app absent — 2026-11-08

- Audited main recursive Git tree SHA `89ba83a4cbd06b648cba8ea5a7c529bfd91285e7`: 602 entries, not truncated.
- Only five Dart source/test files and one Dart pubspec exist, all in `client-reference/dart`; the package README says `НЕ ПРОВЕРЕНО`, calls itself an organization API reference, and explicitly says there is no Flutter organization-selection screen.
- No Flutter `main.dart`, no widget tree, no app package, no Android/iOS platform project, and no localization ARB files.
- `inone-development-0.7/stage-0.7.0/client-screens` contains a JS API/state spike and docs only.
- Checked trees for `cto/inone-audit-2026-11-08`, `ci/inone-engine-validation-2026-11-07`, `recovery/p0-wave3-validation`, `development`, `engine-poc`, and `docs/inone-identity-design-localization`; no Flutter app found.
- Consequence: a runnable phone Beta 1.0 cannot be built from current GitHub source alone. The original UI/API ZIP and exact design-system source need a supported import path. Do not recreate them from memory.
- Detailed report: [development/REPO-AUDIT-2026-11-08.md](../../development/REPO-AUDIT-2026-11-08.md).


## 18. P0 publish branch completeness correction — 2026-11-08

- Review of workflow logic found a gap: validation job used the restored client-reference files from the PR head, but publish job recreated a clean branch from main and originally applied only the P0 patch, omitting those two restored files.
- Fixed publish job to copy exact `biometric-client.mjs` and `biometric-vectors.json` from the PR head into the clean main-based recovery branch before applying the patch. Workflow commit: `e0a8c08ddf68864963c3f8a65ba16a0612381e39`.
- Run [42457297299](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457297299) was queued for the workflow correction; no result yet at time of record.
- Run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) tests exact original fixture but predates publish-job correction. Neither run is accepted until all checks complete.


## 19. Original P0 ZIP/bundle independently verified from current upload — 2026-11-08

- Current conversation upload `Bundle(1).zip`: 1,061,251 bytes; SHA-256 `a7ccfc12ae810dc1788f1b737ef4d53e032cafaf35797412784073a2db57f5a0`.
- Inner `inone-engine-p0-wave3.bundle`: 1,052,468 bytes; SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`.
- `git bundle verify` succeeded: complete history; ref `refs/heads/engine/p0-wave3` at `a7f60b6fdc969941e4354a117e17d32bfc951fb9`; five commits; base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.
- Base tree contains 240 tracked blobs. Full binary bundle is still not committed to GitHub. GitHub connector does have base64 Git Data blob creation, but current tool boundary cannot transfer local mounted bytes to that action; local Git push also lacks network/DNS and credentials.
- Corrected status and hashes in [development/recovered-source/README.md](../../development/recovered-source/README.md).


## 20. P0 CI: Node and room regression pass; PostgreSQL client mismatch — 2026-11-08

- Run [42457297299](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457297299): patch apply PASS; Node backend **369/369 PASS**; P0 room-list regression **2/2 PASS**; PostgreSQL **42/43 PASS**; OpenMLS and Rust bridge skipped after DB failure.
- Sole DB failure: backup/restore test; runner's newer pg_dump/pg_restore wrote `SET transaction_timeout=0`, unsupported by PostgreSQL 16 service. This is a CI client/server version mismatch.
- Fixed workflow at commit `0e13b9726c5fcbecfdb8a9a45b05d4bb6eb02863` to pin `ubuntu-24.04`, install `postgresql-client-16`, and put its binaries first on PATH.
- Fresh run [42457594088](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457594088) was in progress at last check. No full P0 acceptance yet.
- Detailed report: [development/recovered-source/CI-RESULT-42457297299.md](../../development/recovered-source/CI-RESULT-42457297299.md).


## 21. P0 base tree path parity restored — 2026-11-08

- Compared bundle base tree paths (240 blobs) against GitHub archived engine tree (225 blobs); exactly 15 paths were absent.
- Restored all 15 missing paths in PR #18 from exact existing GitHub archive files or directly from the verified bundle base. The recovery branch now has 240 engine blobs and full path parity with the bundle base.
- Exact provenance and per-file blob IDs: [BASE-TREE-RESTORATION.md](../../development/recovered-source/BASE-TREE-RESTORATION.md).
- Full 240-file blob-hash parity is not yet established. The eight previously compared P0-modified files and all 15 restored missing files have exact source blob matches; compare remaining common paths before final acceptance.
- Updated publish job to apply all PR-head engine-path changes to clean main before P0 patch; commit `7898fde9a592a8c180e7c9e89a2c7b3cb2e5ad80`. It also broadens workflow path filters to all engine paths.
- Run #42457594088 predates this last workflow fix; require a new run on head `7898fde9a592a8c180e7c9e89a2c7b3cb2e5ad80`.


## 16. Latest GitHub P0 recovery snapshot — 2026-11-08 12:00 UTC+3

This section supersedes stale earlier statements in this file that no applied P0 branch exists or that the full Node/PostgreSQL/Rust validation has not yet run. Historical sections are retained as a chronology of earlier states.

- Published source branch: `recovery/p0-wave3-applied`.
- Exact checked HEAD: `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`.
- Draft PR: [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22), still OPEN / NOT MERGED.
- CI push run [42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and PR run [42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297) ran on this exact SHA.
- PASS: Node 369/369; P0 room regression 2/2; PostgreSQL 43/43; OpenMLS client tests (all test binaries); Rust bridge 3/3.
- FAIL: `cargo fmt -- --check` reports formatting diffs in 12 Rust files. Overall Actions result remains FAILURE; do not call CI green.
- P0 source integrity is not accepted yet: complete 240-file original-bundle blob-hash audit and verification of six modified engine files + five added P0 tests remain open. See [P0-GITHUB-RECOVERY-STATUS](../../development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md).
- The P0 workflow runs from `inone-development-archive-0.6.0/engine/`. A separate `inone-engine-poc-0.6.0/` tree also exists; do not assume parity without blob comparison.
- Original bundle SHA/ref/HEAD remain separately recorded in the recovery status document. Its original binary and original five-commit ancestry are not imported into GitHub main.
- Flutter app source, native mobile MLS handlers, secure key storage and durable local message persistence remain separate blockers. Do not treat P0 backend CI as a runnable Beta 1.0 app.


## 15. GitHub Codespaces test environment — draft only (2026-11-08)

- Owner selected GitHub Codespaces as the development/test environment.
- Draft scaffolding is committed on branch `feat/beta1-full-screen-api-harness`: `.devcontainer/devcontainer.json`, `.devcontainer/docker-compose.yml`, `.devcontainer/start-backend.sh`, and `docs/CODESPACES_TEST_ENVIRONMENT.md`.
- Related mobile changes select a local backend URL by platform and document the local API panel. These are configuration/code declarations only.
- Latest branch HEAD at the final handoff check: `bf6806cb669220addf3771ad458ebfa5a30357fa`. Draft PR [#28](https://github.com/vahe210991-cloud/InOne-chat/pull/28) remains open and unmerged.
- **Verification: BLOCKED.** No complete repository clone/worktree was available in the tool environment. Codespaces was not created. Container build, PostgreSQL, migrations, backend health checks, Flutter analysis/tests and live API requests were not run.
- Latest Actions run [#42509620990](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42509620990) was in progress when checked. Earlier Flutter runs failed at `flutter analyze`; investigate exact annotations before accepting the branch.
- 34 screen API entries are configured, but they are not 34 verified live integrations. `GET /rooms/mine` is absent from the current engine source; `GR-01` and workspace list probes were removed. The target of 10 verified connected screens remains NOT MET / NOT VERIFIED.
- Next required action: create a Codespace on `feat/beta1-full-screen-api-harness`, verify complete clone/history/refs and clean worktree, then validate this configuration before making more code changes. See [Codespaces test environment guide](../../docs/CODESPACES_TEST_ENVIRONMENT.md) and the latest [session log](../../development/SESSION-LOG.md).


## Owner-approved baseline and Beta 1.0 UI integration — 2026-11-09

- Owner approved the WBS v1.1 in [development/PROGRESS-BASELINE.md](../../development/PROGRESS-BASELINE.md). Fixed baseline: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%; InOne 25% historical qualitative. Do not change scope/weights without explicit owner approval.
- Root `AGENTS.md` and Copilot instructions require every agent/chat to read the WBS.
- UI integration PR [#35](https://github.com/vahe210991-cloud/InOne-chat/pull/35), branch `feat/beta1-ui-source-integration`. Source audit report: [2026-11-09-1015](../../development/reports/2026-11-09-1015-ui-integration-start.md).
- Ui.zip outer SHA-256 `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`; nested archive SHA-256 `d098738ff64fab0388aa72d22a92b097940c41bbcb4acfddfc30ff745e16ad0d`. Both ZIP integrity checks PASS; 231 entries, 24 manifest screens, 31 HTML screens total, 5 WOFF2 fonts, all 10 approved.sha256 entries PASS.
- Exact source assets have NOT yet been uploaded to GitHub. Import is BLOCKED by missing binary streaming from current connector and no GitHub network in container. Do not claim Flutter UI runtime integrated.
- Added asset-path mapping, rootBundle loader, v1 bridge compatibility, tests and deterministic importer. Runtime local-font patch affects only imported runtime copy; source remains immutable.
- v1 chat POST message, and v2 missing/unverified API routes remain BLOCKED. CH-02 `GET /rooms/:id/events` remains unresolved.
- CI run #42578333371: platform setup, geometry, 73-screen gallery check, pub get, analyze and tests PASS; Android APK still in progress at last observation. It predates later commits; latest head not verified.


## Current state — 2026-11-11 Beta 1.0 / Stage 4 single executor

- Sole executor: ChatGPT. Do not create or assume an external-agent workstream unless the owner explicitly changes this instruction.
- Product stage: Beta 1.0 only. Beta 2.0 scope is not active.
- Approved WBS v1.1 is unchanged: Beta 1.0 baseline 42% implementation / 31% verification; domain weights remain Backend/API 25%, Flutter/UI 25%, API/UI 15%, MLS/security/storage 20%, QA/CI/E2E 10%, DevOps/release 5%.
- Active PR #45 remains OPEN/Draft. Current implementation head at last code change: `048db63a7817b28e38a3a8353f8665a713f56730`; documentation report added at `a73f59a253224eefa7b794c708666a3a20153519`.
- Source hardening: native MLS feature gate defaults false; cleanup attempts platform-key deletion even if DB file deletion fails; inbox replay is idempotent; session initialization/handoff are serialized; Android JNI context failures propagate; malformed event IDs and MLS processing errors are rejected rather than silently consumed.
- iOS Protected Keychain CI now fails if signing secrets are absent; runtime validation may not be skipped for acceptance.
- CI on SHA `048db63a7817b28e38a3a8353f8665a713f56730`: OpenMLS client run #42976612169 and FRB run #42976612175 both failed before step 1 with `runner_id=0`, empty steps, and no retrievable logs. iOS dependent job skipped. This is an execution blocker; exact GitHub-side cause is unknown.
- Stage 4 is NOT ACCEPTED. No Stage 4 test command has executed in this environment; no green status is claimed.
- Critical open design issue: OpenMLS provider and client metadata use separate SQLite connections. Atomicity between MLS ratchet-state writes and inbox persistence is not yet established. A crash/restart regression and a proven atomic/recoverable design are mandatory.
- Full report: `development/reports/2026-11-11-stage-4-single-executor-progress.md`.


### Latest CI recheck — 2026-11-11

- PR #45 documentation-updated head: `87089c610e03ba5302b316db07baa2d44d71260a`; source-code head remains `048db63a7817b28e38a3a8353f8665a713f56730`.
- OpenMLS run #42976768215 and FRB run #42976768182 again failed before the first step with `runner_id=0` and empty step arrays. iOS dependent job skipped. Flutter mobile run #42976768225 skipped by branch condition.
- No test command executed; acceptance remains blocked. Latest evidence is in report section 8.


### MLS persistence refactor — 2026-11-11

- OpenMLS provider and client metadata now share one SQLCipher connection. Transaction-backed provider writes ratchet state, inbox content and processed marker in one SQLite transaction; rollback reloads the group from durable storage.
- Server commit processing/merge, room creation and Welcome adoption use transaction-backed storage.
- Invite/revocation pending commits are merged locally only after server acceptance; rejected commits are cleared.
- Regression tests for provider transaction rollback/commit and pending-commit clearing are committed but unexecuted.
- Source head for these changes: `c8ba8f99c45cd532b0941fd774304b6763429511`.
- Latest CI #42977451436 and #42977451456 again failed before step 1 with runner_id 0 and empty steps. iOS dependent job skipped. No source tests executed.
- Atomicity is implemented in source but not accepted until unit, crash/restart and platform tests run green. Stage 4 remains NOT ACCEPTED.


### Pending-commit restart reconciliation — 2026-11-11

- `sync_room` now clears an unmerged local pending commit before applying authoritative server state and fails closed if local MLS epoch exceeds server epoch.
- Source SHA: `e4133120d59ea833dd010bdaa10a7f7a4f281375`.
- Latest OpenMLS/FRB jobs #42977699906 and #42977699954 failed before step 1 with runner_id 0 and empty steps; OpenMLS rerun #42977708226 repeated the same. No tests executed.
- Crash/restart tests for server-accepted commit recovery remain mandatory. Stage 4 is NOT ACCEPTED.


### Logout/session race hardening — 2026-11-11

- Logout now waits for in-flight login, session restoration, MLS handoff and token refresh; new login/adoption/API requests are rejected while logout is active.
- In-memory credentials are cleared even if persistent identity deletion fails.
- Regression test added for logout during a blocked native handoff; test is committed but not executed.
- Source SHA: `404775ff54c5e8a5eee175eb8d908c6c6929e2c0`.
- Latest CI #42977937179 and #42977937116 again failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. Stage 4 remains NOT ACCEPTED.


### Welcome ACK and SQLCipher key recovery — 2026-11-11

- Welcome ACK marker is committed atomically with the joined group/room index; after restart, a pending ACK is retried without reprocessing the Welcome.
- KeyStore distinguishes existing-key lookup from creation. Resume never creates a replacement key; database without its protected key fails closed.
- New session creation rejects DB/key mismatch and attempts cleanup after failed first-time initialization.
- Tests added for missing-key resume, existing DB without key and sidecar detection; not executed.
- Source SHA: `da844b08240c3e67762997be9b65d8e91cab120f`.
- CI #42978533658 and #42978533643 failed before step 1 with runner_id 0 and empty steps. No tests executed. Stage 4 remains NOT ACCEPTED.


### Latest CI recheck after key recovery — 2026-11-11

- Source SHA: `da844b08240c3e67762997be9b65d8e91cab120f`; current PR head also contains archive updates.
- OpenMLS #42978646222 and FRB #42978646245 failed before step 1 with runner_id 0 and empty steps. iOS dependent job skipped. Flutter mobile #42978646254 skipped by branch condition.
- No test or platform build executed. Stage 4 remains NOT ACCEPTED.


### Logout/key-handling follow-up — 2026-11-11

- Rust logout now catches remote logout panic and handles poisoned session mutexes while still attempting local SQLCipher/sidecar and platform-key cleanup.
- Dart clears refresh-token memory immediately after native open succeeds; Rust bridge initialization can retry after failure.
- Regression for poisoned-lock cleanup added; tests not executed.
- Source SHA: `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.
- CI #42979003433 and #42979003356 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. Stage 4 remains NOT ACCEPTED.


### CI on current PR head — 2026-11-11

- PR #45 head: `ca49b376a65766fb59e792cf2097ba7b4f2b50ce`; source head: `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.
- OpenMLS #42979080737 and FRB #42979080732 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped; Flutter mobile #42979080672 skipped by branch condition.
- No tests or platform builds executed. Stage 4 remains NOT ACCEPTED.


### Secret-memory zeroization — 2026-11-11

- Rust session token pairs zeroize on drop; SQLCipher keys, keyring byte buffers, serialized token pairs, request/response token JSON and authorization header copies are zeroized.
- FFI access/refresh token inputs are wrapped immediately.
- KeyStore presence checks do not copy key bytes.
- Source SHA: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.
- CI #42979859714 and #42979859709 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. No tests executed. Stage 4 remains NOT ACCEPTED.


### CI on current PR head after zeroization — 2026-11-11

- PR #45 head: `c103cc2ae4eaa9e3ce721101f3581f3b6047e138`; product source: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.
- OpenMLS #42979954916 and FRB #42979955089 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped; Flutter mobile #42979954833 skipped.
- No tests executed. Stage 4 remains NOT ACCEPTED.


### Current Beta 1.0 / Stage 4 status — 2026-11-11

- Sole executor: ChatGPT. No external agent is assigned. Owner will explicitly notify if an agent becomes available.
- Current stage: Beta 1.0. Keep work and acceptance within approved Beta 1.0 WBS v1.1; do not expand acceptance into Beta 2.0 modules.
- PR #45 current head: `84248642e05e03c976a6f8d0eae0a9ab03a64765`.
- Source corrections: Rust undeclared identifier fixed; duplicate Flutter dependency removed; native store and Android JNI initialization made retryable; HTTPS/local-debug API origin policy added to Rust and Flutter; HTTP redirects disabled; regression tests added; mobile README updated.
- These changes are committed but not test-verified.
- CI #42981617948 (OpenMLS) and #42981617913 (FRB) FAILED with null/empty step summaries; job logs return BlobNotFound. iOS dependent job skipped. Flutter mobile #42981617907 skipped by branch condition.
- Exact CI failure cause is UNKNOWN. Local environment lacks Rust, Cargo, Flutter, Dart and Xcode; no local test/build execution is claimed.
- Stage 4 NOT ACCEPTED. Keep `INONE_MLS_NATIVE_ENABLED=false`; do not merge. Do not change Beta 1.0 percentages without accepted test evidence.
- Full evidence and next gate: `development/reports/2026-11-11-stage-4-single-executor-progress.md`.
