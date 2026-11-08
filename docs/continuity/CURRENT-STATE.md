# InOne — текущее состояние проекта

**Срез:** 2026-11-08 08:25 (UTC+3)  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Default branch:** `main`  
**Документ — снимок состояния, а не обещание готовности к релизу.**

## 1. Краткий статус

| Направление | Оценка реализации из последнего CTO roadmap | Подтверждённая проверка | Статус |
|---|---:|---:|---|
| Backend P0 / MLS | 80% | 40% | Реализация расширена локально; полный Rust/DB acceptance не выполнен |
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