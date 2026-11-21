# InOne P0 — фактическое состояние рабочей копии

Дата обновления: 2026-11-08 (UTC+3)

Документ описывает только то, что присутствует в рабочем дереве и подтверждено доступными проверками. Память предыдущих исполнителей и старые отчёты не являются источником истины.

## 1. Источник кода и Git

- Рабочая копия: `/mnt/data/inone-continue`.
- Исходная ветка: `claude/p0-mls-durability-ci`, исходный commit `99fd3e0`.
- Рабочая ветка: `cto/p0-finalize-fixtures`.
- Базовый локальный commit этой ветки: `ead8e4c` (`fix(p0): repair MLS test fixture and record verified state`).
- После коммита рабочее дерево чистое.
- Локальный `origin` указывает на Git bundle, а не на GitHub.
- В локальном репозитории нет локальной ветки `main`.

### GitHub — состояние удалённого репозитория

Подключённый GitHub-репозиторий: `vahe210991-cloud/InOne-chat`.

- Удалённый `main`: `1a40026d9bbb1c9f14d12635513552e63724be99`.
- Удалённый `development`: `9b2352235569484cf2e82e38167497dcf6de355d`.
- Удалённая CI-ветка: `ci/inone-engine-validation-2026-11-07`.
- На GitHub присутствуют только ветки `main`, `development`, `engine-poc` и `ci/inone-engine-validation-2026-11-07`.
- Локальная ветка `claude/p0-mls-durability-ci` и текущая рабочая ветка не опубликованы на GitHub.
- GitHub `main` — резервная структура с архивом `inone-development-archive-0.6.0/engine`, а не текущая локальная P0-ветка.
- PR #10 и CI run #42395014895 относятся к архивному снимку. Они не проверяют этот локальный P0-код.

PR #10: https://github.com/vahe210991-cloud/InOne-chat/pull/10
Старый CI: https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42395014895

**GitHub CI для текущего P0-кода пока не запущен.** Через доступный GitHub-коннектор можно читать репозиторий и выполнять Git-объектные операции, но он не предоставляет передачу локального дерева/файлов из `/mnt/data`. В этой среде нет GitHub credentials для прямого `git push`. Поэтому текущую ветку нельзя честно представить GitHub Actions как исходник. Старый PR #10 нельзя сливать вместо неё.

## 2. Реализованные P0-изменения в текущей рабочей копии

### F4 — точная привязка membership journal к pending commit

- `client_membership_commits` хранит `pending_fingerprint` и `claim_id`.
- Fingerprint SHA-256 вычисляется с domain separator и связывает `room_id`, `client_operation_id`, точный сериализованный payload и сериализованное состояние OpenMLS pending staged commit.
- При подтверждении сервера fingerprint пересчитывается по текущему pending commit и точному payload из журнала.
- При несовпадении журнал сохраняется, pending не сливается/не очищается, комната переводится в RecoveryRequired.
- При окончательном отказе pending очищается только при совпадении fingerprint.
- При подтверждённом сервером коммите, который не совпал с локальным pending, KeyPackage claim освобождается, чтобы уже использованный пакет не переиспользовался.
- Добавлены Rust-тесты на mismatch и перезапуск SQLite с потерянным ответом сервера.

### P0.2 — метаданные membership проверяются относительно фактического MLS результата

- `mls_commits.changes JSONB` хранит `adds`, `removes`, `removeDevices` рядом с Commit.
- `GET /mls/groups/:id/commits` возвращает эти метаданные вместе с Commit.
- PostgreSQL и memory store сохраняют/возвращают одинаковую структуру.
- Клиент обрабатывает и сливает Commit внутри SQLite-транзакции, сравнивает реальную разницу credential/member sets с объявленными метаданными и фиксирует транзакцию только при точном совпадении.
- При расхождении транзакция откатывается, Commit помещается в карантин, локальная эпоха не продвигается.
- Старые записи с `changes = NULL` остаются совместимыми; они не проходят новую проверку метаданных и продолжают контролироваться итоговой сверкой состава комнаты.
- Добавлен отрицательный тест `BADMETADATA` для корректного MLS Commit с подменёнными серверными метаданными.

### P0.3 — durable quarantine для постоянных ошибок Commit

- Локальная таблица `client_commit_quarantine` имеет ключ `(room_id, epoch, commit_hash)`.
- Неподдерживаемый/повреждённый Commit, постоянная ошибка обработки или mismatch membership metadata сохраняются с SHA-256 и причиной.
- Повторная синхронизация и перезапуск проверяют карантин до `process_message`; один и тот же Commit не исполняется повторно.
- Временные ошибки хранилища/слияния не помещаются в карантин и возвращаются как retryable.
- Добавлены тестовые сценарии повторной синхронизации и перезапуска.

### Key Package claim/replay

- API принимает `claimId`, scoped к пользователю-инициатору и устройству.
- PostgreSQL сохраняет точный набор выданных KeyPackage в `mls_key_package_claims` в той же транзакции, что и их расходование.
- Повторный запрос с тем же claim ID возвращает тот же пакет побайтно; попытка применить тот же ID к другому target возвращает 409.
- Memory store повторяет то же поведение.
- Rust-клиент сохраняет claim ID локально до запроса и повторяет его после потери ответа/перезапуска. Claim удаляется только после подтверждённого membership commit или при пустом/невалидном ответе.
- Добавлены Node-тесты memory store/API и Rust-тест потери HTTP-ответа с перезапуском клиента.

### Миграция

Добавлена `migrations/0026-mls-commit-metadata-and-claims.sql`; обновлены `src/schema.sql`, `src/migrate.js`, `SCHEMA_VERSION` и migration marker.

## 3. Доступные результаты проверок

- JS/MJS syntax: **127/127 PASS** (`node --check` для `src`, `client-screens`, `test`, `mobile-mls/mls-client/tests`).
- Фокусированный Node-набор: **13/13 PASS** (`mls-memory-store-claims`, `mls-wire`, `client-screens-common`, `org-error-codes`).
- Статическая целостность миграций: **PASS** — 25 миграций, номера последовательны, маркеры совпадают, `SCHEMA_VERSION = 0026-mls-commit-metadata-and-claims`.
- `git diff --check`: PASS.
- Полный `npm test`: **BLOCKED**. Node 22.16.0 обнаружил 85 тестовых наборов: 11 PASS, 74 FAIL до выполнения тестовой логики из-за отсутствующих `qrcode`, `pg` и других npm-зависимостей в неполном `node_modules`.
- `npm run test:db`: **BLOCKED**. 8/8 наборов не запускаются из-за отсутствующих npm-зависимостей; PostgreSQL сервер/клиент отсутствуют.
- Rust `cargo test`, `cargo fmt --check`, bridge tests: **BLOCKED** — `cargo`, `rustc`, `rustfmt` не установлены.
- Flutter/Dart: SDK отсутствуют.

Ни Rust-, ни PostgreSQL-, ни полный Node-прогон не объявляются PASS. Rust integration tests добавлены в исходник, но не исполнены.

## 4. Что ещё обязательно до слияния

1. Установить/восстановить зависимости и выполнить полный `npm ci`, `npm test`.
2. Выполнить миграции на PostgreSQL 16: новая схема, upgrade с предыдущей схемы, `npm run test:db`.
3. Выполнить `cargo fmt --check`, `cargo test --locked` для `mls-client` и `mls-bridge` на Rust 1.91.
4. Проверить Rust-тесты F4, P0.2, P0.3, KeyPackage claim/replay, включая перезапуск и отрицательные сценарии.
5. Перенести именно эту рабочую ветку в GitHub (полное дерево, не архивный снимок), запустить все GitHub Actions на commit SHA этой ветки.
6. Исправить все CI failures; после зелёных обязательных checks создать PR в согласованную целевую ветку и только затем выполнить merge.

## 5. Правило публикации

Владелец явно разрешил полный GitHub прогон и слияние. Это разрешение не отменяет требования проверять именно актуальный код. Пока актуальное дерево не доступно удалённому CI, merge не выполняется: слияние старого PR #10 означало бы слияние архивного снимка вместо текущих P0-изменений.