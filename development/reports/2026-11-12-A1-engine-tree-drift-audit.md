# A1 — детальный аудит расхождений двух деревьев InOne Engine

**Дата:** 2026-11-12  
**Базовый commit:** `016ba75045412652d362fa8c94ee166bfa371c23`  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Дерево A:** `inone-development-archive-0.6.0/engine/`  
**Дерево B:** `inone-engine-poc-0.6.0/`  
**Статус A1:** SOURCE AUDIT COMPLETED; runtime/tests NOT RUN; source consolidation NOT PERFORMED.

## 1. Итог в цифрах — важное уточнение предыдущего аудита

Первоначальная формулировка «45 различающихся файлов» была неточной. Число 45 получено сравнением всех записей дерева Git и включает не только файлы, но и каталоги.

Точная разбивка по Git tree на указанном commit:

| Метрика | Значение |
|---|---:|
| Записи дерева A (файлы + каталоги) | 280 |
| Записи дерева B (файлы + каталоги) | 257 |
| Общие относительные пути | 257 |
| Идентичные общие записи | 212 |
| Различающиеся общие записи | 45 |
| Из них blob-файлы | **34** |
| Из них tree-записи каталогов | **11** |
| Только в дереве A | **23 записи: 20 файлов + 3 каталога** |
| Только в дереве B | **0** |

Следовательно, реальный файловый diff — **34 общих файла с разным Git blob SHA**, а не 45 файлов. Одиннадцать отличающихся tree SHA являются следствием изменений внутри каталогов и не должны считаться самостоятельными исходными файлами.

Проверка использовала Git tree API на точном commit SHA; сравнение blob SHA — надёжный способ определить идентичность содержимого файла. Семантическое значение каждого изменения оценивалось отдельно по содержимому исходников.

## 2. Владение исходниками: решение A1

### 2.1. Node.js backend — canonical: дерево A

Канонический путь backend Beta 1.0:

`inone-development-archive-0.6.0/engine/`

Основания:
1. Stage 3 API/backend audit прямо фиксирует этот путь как backend source of truth.
2. В дереве A присутствуют миграции 0025–0028, отсутствующие в дереве B.
3. Дерево A содержит более новые механизмы серверной идемпотентности MLS commit, reservation/finalization KeyPackage claims и replay.
4. Дерево A содержит более строгую транзакционную обработку открытого вступления в публичные комнаты и смены статуса org link.
5. Дерево A содержит маршрут `GET /rooms/mine`, который используется мобильным контрактом Beta 1.0.

**Решение:** все дальнейшие изменения Node.js backend, серверной схемы, миграций и backend-тестов делать только в дереве A. Не переносить backend-файлы из дерева B поверх A.

### 2.2. Rust/OpenMLS mobile client — canonical: дерево B

Канонический путь Rust MLS client, используемый Flutter Rust Bridge:

`inone-engine-poc-0.6.0/mobile-mls/mls-client/`

Основания:
1. `mobile/rust/Cargo.toml` напрямую указывает path dependency на `../../inone-engine-poc-0.6.0/mobile-mls/mls-client`.
2. В дереве B Rust-клиент использует единое SQLCipher connection/transaction для OpenMLS state и client metadata/inbox.
3. В дереве B присутствует обнуление session token через `zeroize` при Drop.
4. В дереве B присутствует нормализация/валидация API origin с HTTPS по умолчанию и ограниченным HTTP только для локальной debug-разработки.
5. В дереве B присутствует проверка обязательного непустого `event_id`.
6. В дереве B `Cargo.toml` содержит `zeroize` и `url`, используемые соответствующими security controls.

В дереве A есть полезные отличия, которые нельзя потерять:
- классификация ошибок OpenMLS на retryable/permanent;
- дополнительная remote config настройка `messages.editWindowMinutes`;
- отдельные сообщения/диагностика ошибок обработки.

**Решение:** Rust crate, подключённый Flutter, развивается в дереве B. Полезные возможности дерева A переносить туда только отдельными проверенными изменениями с тестами; не копировать файл целиком и не менять path dependency на архив.

### 2.3. MLS bridge — требует отдельной сверки

`mobile-mls/mls-bridge/src/lib.rs` различается в обоих деревьях. При этом фактический Flutter Rust Bridge wrapper находится в `mobile/rust/`, а Cargo path для основного MLS client указывает на дерево B. До сверки генерации FRB, публичных Rust API и реальных импортов:
- не менять canonical bridge по предположению;
- считать дерево B предпочтительным для mobile runtime только если подтверждено, что bridge crate импортируется оттуда;
- провести отдельную проверку generated bindings и сборочных путей в D2.

**A1 не меняет Rust bridge и не запускает codegen.**

### 2.4. Общий принцип

Это не две синхронные копии одного проекта, а исторически разошедшиеся деревья с разными зонами актуальности:

| Подсистема | Канонический путь |
|---|---|
| Node.js API/server | Дерево A |
| PostgreSQL schema/migrations | Дерево A |
| Node backend tests | Дерево A |
| Flutter-connected Rust MLS client | Дерево B |
| Rust Cargo dependency для mobile | Дерево B |
| FRB wrapper / generated bindings | `mobile/rust/`; отдельная проверка D2 |
| Документы/legacy client references | Проверять по назначению, не считать исполняемым backend |

## 3. Полный список 34 расходящихся файлов

Все пути ниже указаны относительно корня каждого engine дерева. Blob SHA приведены в формате Git SHA-1 и позволяют однозначно проверить точную версию на базовом commit.

### 3.1. Контракт и backend

| Файл | Archive blob SHA | POC blob SHA | Вывод |
|---|---|---|---|
| `MLS_CONTRACT.md` | `826ece102975a6c189b7d16bc53245c125c66828` | `bf34dc93e14c921003f72dd04b6f793f3a352924` | Контракт расходится с серверными изменениями; синхронизировать с фактическими route/DTO и mobile Rust |
| `package.json` | `fbdc04eed3ee3b5753155128c85f84d78147086c` | `195f4676da0a5f68eed205ac481b0c72e60c14ba` | В A тестовые scripts шире, включая API contract и DB suite; A canonical для Node |
| `src/main.js` | `f536d3c6e224d902dcdee408b7fc82af5c1f4cad` | `8e033d5ec2b4a31065b0fa9416e8c614cec79460` | Отличается тестовый mail adapter; production bootstrap сверять с A |
| `src/migrate.js` | `702d8495adad3b466aabc1ac36809766463bf83e` | `1cbf26331f64c725b051d055530a070560c275f3` | A включает schema version 0028 и integrity checks для миграций 0025–0028 |
| `src/mls-rules.js` | `5fec067941bad978e17f964f8157c9a19f70d6a8` | `41df05a0d54abf920b2e1afd112d3cefe4622913` | A валидирует operation/claim IDs, их равенство и один target для KeyPackage claim |
| `src/schema.sql` | `75b2d972d165568194cc3e5fe134d980cbd40a44` | `1c2343e77f446e352d13911951100bacce15523f` | A включает durable claims и commit operation idempotency tables |
| `src/server.js` | `345c2c2ab785b21a5d011384cbd141e4d34bdfb6` | `9d466284fe69059dc31444b7b45fb624025a07b9` | A содержит commit fingerprint/replay, комнаты пользователя, CAS-переходы org link, безопасный public join |
| `src/store.js` | `af807b2851341756f5768e60afd747f666e9a9c7` | `1dbfb60eae053e69385a997ad54588224333a4a7` | A содержит транзакционные lock/authorization guards для org membership и public join, MLS claim/commit storage |
| `src/store-memory.js` | `e7c869b8ea0150798fc7e0a016a3f3c5cbe5225d` | `3082a91093aa1d13a21bff3b542d0cbaed44a66c` | A memory adapter соответствует расширенным MLS claims/idempotency и room operations |

### 3.2. Rust/OpenMLS client и bridge

| Файл | Archive blob SHA | POC blob SHA | Вывод |
|---|---|---|---|
| `mobile-mls/mls-bridge/src/lib.rs` | `3a65d08133d5bb8f78dfc500a179a4a055d82636` | `abceaacd0db2e557eefb04a769a708b1c7d94f60` | Различаются bridge API/implementation; требуется D2 codegen/import verification |
| `mobile-mls/mls-client/Cargo.lock` | `cd8353e392f7bfbaaec651079a60ba58ecda3457` | `4b4ef314a28637b29e2191327d55abd8ce06a993` | Разные dependency resolutions; не смешивать lockfiles |
| `mobile-mls/mls-client/Cargo.toml` | `f1d29b51be72e87351eb96517d5c60607ef9a792` | `d705399cc4ef3b9cd064408cad86c743686c8eb2` | POC добавляет `zeroize` и `url`, используемые security logic |
| `mobile-mls/mls-client/src/lib.rs` | `3bdd7e36e45c5e2488b544f1ed339285ecfdc6be` | `e156e52d92b6eb04c9a7b30720f0f68135eda6a1` | POC содержит transaction-backed OpenMLS storage, token zeroization, URL validation и event ID checks; A содержит failure classification |
| `mobile-mls/mls-client/src/remote_config.rs` | `591e2222233e1e8315f59e8fbe4650409455599b` | `53a5b4deeb2700d5e4e4b5b063dfe856c77abe67` | A включает `messages.editWindowMinutes`; сетевой config code и тесты форматированы по-разному |
| `mobile-mls/mls-client/tests/encryption.rs` | `3c0078d001429d7fc0d6ef2753f8cec829eec19d` | `80ee981ac2c1e1a9830852e3d361280e0332a280` | MLS encryption regression fixtures различаются |
| `mobile-mls/mls-client/tests/engine/start-engine.mjs` | `0a4c51cdac6519b4153905268942fcd9e1052de6` | `d6b1e196b20813441c50f89c7b1837172326dbf6` | Engine integration harness различается |
| `mobile-mls/mls-client/tests/outbox.rs` | `9f38559256e9c9273d7f5897f4bb9a4db29c572d` | `67b087c7bda7086dd3982cc4b3442a951463b851` | POC outbox suite заметно расширен; тесты требуют объединения по смыслу, не перезаписи |
| `mobile-mls/mls-client/tests/remote_config.rs` | `1639017f9663007e22dde5b301ef437aba0a1875` | `15ef2cd71f52e688a084e35066b9f9d901b6b35c` | A включает дополнительные проверки конфигурации, в т.ч. edit window |
| `mobile-mls/mls-client/tests/removal.rs` | `4ccf8cb442f9108ef741acf36fa47847dd1e56b8` | `0d56fc520b2624a06a53c5f212fd7889cc6a4c0d` | Разные MLS device/member removal regression tests |
| `mobile-mls/mls-client/tests/scenario.rs` | `db61d78b155c79e06f542235fd3c13aceef512c0` | `d31e7be0d5574adbfeb948cce5b7bfa88b27dd8b` | Разные end-to-end scenario fixtures |
| `mobile-mls/mls-client/tests/session_renewal.rs` | `90a53a6efa3bfbb2de833a1364491e84eeec4537` | `70a420d96cb8a6a377c85e5a3decb5a852c99bf9` | POC тесты сессии/renewal отличаются и должны быть canonical вместе с POC Rust source |

### 3.3. Backend regression tests

Для всех следующих файлов дерево A содержит отличающийся blob и остаётся canonical, так как эти тесты относятся к Node backend:

| Файл | Archive blob SHA | POC blob SHA |
|---|---|---|
| `test/mls-expiry.test.js` | `a24da3548934bf853af90268708734749d1ce7eb` | `1864e262c4d592d69b350b14111c9a7a9d10043a` |
| `test/mls-groups.test.js` | `6d49c2cf83b4eb9ba1cd13d8cd96ed49c4ee9706` | `88c11d4873e5eb6cf155ff0c5d524395411c5285` |
| `test/mls-hygiene.test.js` | `78cafb0a7ca01a77576147290ff1c9e201910e4d` | `5b0b6c21bd333f616e2fdd30ee953a440e202f02` |
| `test/mls-idempotency.test.js` | `f2beb54209113a9868f49c3ba0b191ef2a951ff8` | `e6720ff285aa20962380d507193d25663f227ef4` |
| `test/mls-keys.test.js` | `1a36c563c2d4b4f78f63ac8ecb9c3255ab9022d3` | `8114904cdac1d3027a94abf4859386977a9563e7` |
| `test/mls-last-resort.test.js` | `2582bce16f4d5de44d4cb1402d4d4e26b4d84a46` | `eb85193065e702d4e75a2ddbf9462fba1183c180` |
| `test/mls-membership.test.js` | `f9fb67f7326998d068fdbf862d8b9faebd4daa1b` | `c5834f8cbff826eb935f501664cdae6ad6ebb5e1` |
| `test/mls-messages.test.js` | `5c22e171d6439a09ba6aec126072cce8059b9d55` | `f49982530eeb8388bbd81aa67f32224b8a059d82` |
| `test/mls-offline.test.js` | `5a2685aff1ab315bea691e995629c22eeddfa92b` | `27a23af3814702730d766b30e387c074157a0415` |
| `test/mls-reference.test.js` | `f3145d02f6371969e2ac008cac630d9aaa98d149` | `30a1103b58cecc16ac32e732b61a3cd6541ed949` |
| `test/org-access-joins.test.js` | `d230411e311a410195fad6e380d64fdd608c6405` | `e1b33aa32e05ac27de2a526222a7987198b57db0` |
| `test/org-links.test.js` | `4167c1a029c6ee1e70e4f26c586b244dfd18b33c` | `7c403f9ee7942251107acf02a66676d98558ab04` |
| `test/server-db.test.js` | `5d7d4a7c5f0db9348d877e56624aca54be1aaf7e` | `1e3937ec1dc8f158ae940ff23425c5693e6ac8e5` |

## 4. Архивные файлы, отсутствующие в POC

Дерево A имеет 23 дополнительных записи: 20 файлов и 3 directory tree entries. У дерева B дополнительных файлов нет.

### 4.1. Файлы (20)

- `.gitignore`
- `PUBLISH_STEPS.md`
- `SECURITY.md`
- `client-reference/dart/README.md`
- `client-reference/dart/lib/org_api.dart`
- `client-reference/dart/lib/org_errors.dart`
- `client-reference/dart/lib/org_models.dart`
- `client-reference/dart/lib/org_picker.dart`
- `client-reference/dart/pubspec.yaml`
- `client-reference/dart/test/org_errors_test.dart`
- `migrations/0025-mls-commit-change-metadata.sql`
- `migrations/0026-mls-key-package-claim-replay.sql`
- `migrations/0027-mls-commit-idempotency.sql`
- `migrations/0028-mls-key-package-claim-reservation-finalization.sql`
- `mobile-mls/P0-ACCEPTANCE-MAP.md`
- `mobile-mls/P0-RUST-FORMATTING-RECOVERY.md`
- `mobile-mls/mls-client/tests/poison.rs`
- `mobile-mls/mls-client/tests/window.rs`
- `test/api-contract.test.js`
- `test/rooms-mine.test.js`

### 4.2. Только в дереве A directory entries (3)

- `client-reference/dart/`
- `client-reference/dart/lib/`
- `client-reference/dart/test/`

Эти 20 файлов нельзя удалять как «мусор»: миграции 0025–0028 — часть актуального backend schema evolution; API contract и rooms-mine tests защищают серверный контракт; SECURITY/PUBLISH документы и MLS acceptance notes требуют отдельного решения о переносе/архивировании.

## 5. Одиннадцать отличающихся directory tree entries

Следующие directory SHA различаются из-за различий в дочерних файлах:
- `client-reference/`
- `migrations/`
- `mobile-mls/`
- `mobile-mls/mls-bridge/`
- `mobile-mls/mls-bridge/src/`
- `mobile-mls/mls-client/`
- `mobile-mls/mls-client/src/`
- `mobile-mls/mls-client/tests/`
- `mobile-mls/mls-client/tests/engine/`
- `src/`
- `test/`

Они не являются дополнительными файлами для ручного merge.

## 6. Семантические различия, важные для безопасности

### 6.1. Backend / database

Дерево A имеет следующие важные механизмы, отсутствующие в B:
- schema migrations 0025–0028 и checks их фактического применения;
- хранение MLS commit metadata `changes` и `welcome_recipients`;
- таблица `mls_key_package_claims` с состояниями reserved/committed/released;
- таблица `mls_commit_operations` с fingerprint и resulting epoch;
- проверка `clientOperationId` / `keyPackageClaimId`, ограничение URL-safe ID и привязка claim ID к operation ID;
- replay lookup для принятого commit до проверки membership, чтобы повтор принятой операции корректно переживал удаление отправителя из группы;
- защита от гонки между replay lookup и snapshot комнаты;
- compare-and-set переходы статуса org link;
- транзакционные блокировки membership и public join для предотвращения гонок при отзыве доступа;
- `GET /rooms/mine` и его store implementation.

Эти механизмы нельзя заменять более старой реализацией дерева B.

### 6.2. Rust mobile MLS

Дерево B имеет следующие более новые security/consistency механизмы:
- единый SQLCipher SQLite connection для OpenMLS provider и пользовательских metadata/inbox;
- transaction-backed provider, позволяющий одной транзакцией покрыть MLS state и inbox;
- token wrapper с `Drop` и `zeroize`;
- HTTPS-only API origin для production; HTTP разрешён только для loopback/private адресов в debug builds;
- запрет credentials/query/fragment в API origin;
- проверка `event_id` в ответах сервера;
- более развитые retry/session/outbox сценарии в POC тестах.

Эти механизмы нельзя перезаписывать архивным Rust source без предметного анализа и регрессионных тестов.

### 6.3. Полезные возможности дерева A, которые следует перенести в B отдельно

- классификация ошибок OpenMLS обработки на временные и постоянные, чтобы не застревать на повторе постоянной ошибки;
- `messages.editWindowMinutes` в remote config;
- дополнительные тесты remote config, включая edit window и граничные значения.

Это кандидаты на отдельные задачи D-track, не часть A1 и не повод копировать весь файл.

## 7. Результат A1 — принятая карта владения

| Область | Источник истины | Действие |
|---|---|---|
| Node server/API | Archive A | Продолжать здесь |
| DB schema + migrations | Archive A | Продолжать здесь; миграции 25–28 обязательны |
| Node stores + backend tests | Archive A | Продолжать здесь |
| Rust MLS client used by Flutter | POC B | Продолжать здесь |
| Rust Cargo dependencies/lock for that client | POC B | Сохранять согласованными |
| Mobile FRB wrapper | `mobile/rust/` | Отдельная сверка D2 |
| MLS contract docs | Пока не назначать единственный файл | Сверить route, payload, error, epoch и replay contract между A/B/mobile |
| Archive-only client reference Dart | Не является текущим Flutter app | Сохранить до проверки ссылок/истории; не копировать автоматически |

**Запрещённая операция:** массовое копирование A поверх B, B поверх A или автоматическое объединение директорий. Это уничтожит актуальные backend migration/transaction safeguards либо более новые Rust security/atomicity safeguards.

## 8. Реализация инструмента аудита

Добавлены dependency-free Node.js скрипт и unit tests:

- `scripts/audit-engine-tree-drift.mjs`
- `scripts/audit-engine-tree-drift.test.mjs`

Скрипт:
- читает только Git-tracked blobs из двух каталогов на заданном ref;
- сравнивает относительные пути, blob SHA и file mode;
- отдельно выдаёт identical, divergent, archive-only и POC-only;
- поддерживает Markdown и JSON вывод;
- не меняет рабочие файлы и не устанавливает зависимости.

Команды для будущего локального запуска:
```bash
node scripts/audit-engine-tree-drift.mjs --ref 016ba75045412652d362fa8c94ee166bfa371c23
node scripts/audit-engine-tree-drift.mjs --json --ref 016ba75045412652d362fa8c94ee166bfa371c23
node --test scripts/audit-engine-tree-drift.test.mjs
```

**Выполнение команд в этой сессии:** NOT RUN. Код и тестовые сценарии добавлены в GitHub, но GitHub runner/локальный checkout в рамках A1 не запускался. Не объявлять тесты зелёными до реального запуска.

## 9. Чек-лист A1

- [x] Получить recursive Git tree для точного исходного commit.
- [x] Сопоставить относительные пути двух engine деревьев.
- [x] Исправить счёт: 34 blob files + 11 directory entries, а не 45 файлов.
- [x] Зафиксировать 23 archive-only entries и отсутствие POC-only entries.
- [x] Исследовать различия backend bootstrap, migration runner, MLS rules, schema, server, stores.
- [x] Исследовать Rust MLS client, bridge, dependencies и targeted tests.
- [x] Проверить фактический mobile Rust Cargo path dependency.
- [x] Определить канонический backend path и канонический Flutter-connected Rust client path.
- [x] Добавить повторяемый локальный drift audit script.
- [x] Добавить unit tests для парсера, сравнения, file mode и Markdown output.
- [ ] Выполнить unit tests на разрешённом runner.
- [ ] Сверить bridge imports/generated FRB bindings и закрепить решение по bridge (D2).
- [ ] Согласовать и реализовать перенос полезных Rust-only функций из A в B (отдельные D tasks).
- [ ] Решить судьбу legacy `client-reference/dart` и документов после проверки всех ссылок.

## 10. Что A1 не делает

- Не удаляет и не переименовывает ни один engine каталог.
- Не меняет Cargo path dependency.
- Не объединяет файлы с разными SHA.
- Не запускает Node, PostgreSQL, Rust, Flutter, Android или iOS.
- Не подтверждает runtime поведение или зелёные тесты.
- Не включает native MLS.
- Не меняет PR #45 и не влияет на WBS v1.1 проценты.

## 11. Следующие задачи

1. **D2 / bridge ownership:** проверить `mobile/rust/Cargo.toml`, `build.rs`, FRB config, generated Dart/Rust bindings и фактические импорты bridge crate. Установить точный канонический bridge path.
2. **D-track / Rust parity:** перенести классификацию OpenMLS ошибок и remote config edit window в POC Rust source отдельными коммитами с unit tests.
3. **B-track / contract:** обновить единый MLS contract на основании archive server API и POC mobile client; проверить replay, claim reservation, commit fingerprint, welcome receipts, epoch and retry semantics.
4. **A3:** после утверждения canonical ownership добавить CI/static drift guard, который запрещает новые неучтённые изменения в неканонической копии.
5. **Consolidation proposal:** только после вышеуказанного подготовить план удаления/архивирования старых копий. Не удалять дерево B: оно является текущей зависимостью Flutter Rust client.

## 12. Source references

- `development/reports/2026-11-11-stage-3-api-backend-audit.md` — фиксирует archive engine как backend source of truth.
- `development/reports/2026-11-11-stage-4-single-executor-progress.md` — Stage 4 transaction/MLS work and acceptance boundary.
- `mobile/rust/Cargo.toml` — фактический POC path dependency.
- `inone-development-archive-0.6.0/engine/src/migrate.js` и `migrations/0025–0028` — backend schema evolution.
- `inone-development-archive-0.6.0/engine/src/server.js`, `src/store.js`, `src/store-memory.js` — backend route and persistence safeguards.
- `inone-engine-poc-0.6.0/mobile-mls/mls-client/src/lib.rs` — Flutter-connected Rust MLS implementation.
- `scripts/audit-engine-tree-drift.mjs` — repeatable comparison tool.
