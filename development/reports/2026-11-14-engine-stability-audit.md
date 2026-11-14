# InOne — углублённый аудит и стабилизация движка

**Дата:** 2026-11-14  
**Рабочая ветка:** `feat/flutter-ui-dart-migration-2026-11-14`  
**Статус:** source-level stabilization in progress; production readiness НЕ подтверждена.

## 1. Цель и принципы

Установить единственную поддерживаемую серверную реализацию, исключить скрытый memory fallback в production, отделить legacy криптографию от MLS, защитить production-конфигурацию от тестовых значений и сохранить историю исходников.

Не удалять исторические каталоги, пока в них есть уникальные компоненты, тесты или provenance. Не считать статический аудит заменой Node/PostgreSQL/Rust/Flutter runtime тестам. `main` не изменялся.

## 2. Установленная карта исходников

### Канонический серверный backend

Поддерживаемый Node.js/PostgreSQL backend находится в:

`inone-development-archive-0.6.0/engine/`

Это опубликованный P0 source, принятый в PR #25. Историческая P0 приёмка прошла шесть CI jobs на exact PR head; см. `development/recovered-source/P0-CLOSURE-2026-11-08.md`. Это доказательство относится к тому SHA, а не к новым изменениям этого аудита.

### Второе дерево — не production сервер

`inone-engine-poc-0.6.0/` содержит отдельную копию Node server и отдельный persistent OpenMLS client.

Статическое сравнение файлов на этой ветке показало:

- в серверных файлах есть 58 общих route path literals;
- canonical P0 backend дополнительно содержит `/rooms/mine`;
- PostgreSQL store canonical backend содержит 186 async operations, POC store — 181;
- пять операций присутствуют только в canonical backend: `joinPublicRoomOpen`, `mlsCommitOperation`, `mlsReleaseKeyPackageClaim`, `roomsOfUser`, `transitionOrgLinkStatus`;
- canonical migrator указывает schema version `0028`, POC snapshot — `0024`.

Это статическое сравнение текста и имён операций, не runtime contract test. Оно достаточно, чтобы не считать два серверных дерева равноправными и не использовать POC Node server как production backend.

### Криптографические компоненты

- `inone-development-archive-0.6.0/engine/src/crypto-engine.js` и `src/client.js` — legacy/test-only Matrix Olm/Megolm Node client. Production entrypoint `src/main.js` его не импортирует.
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-bridge/` — демонстрационный OpenMLS bridge с состоянием в памяти. Он не является durable mobile runtime.
- `inone-engine-poc-0.6.0/mobile-mls/mls-client/` — отдельный persistent OpenMLS client с SQLCipher storage и интерфейсом для platform KeyStore. Он не равен Flutter FFI интеграции.
- Активный `mobile/pubspec.yaml` содержит Flutter, HTTP и secure-storage зависимости, но не подключает Rust/FRB пакет. В Beta 1.0 отправка и получение сообщений правильно остаются заблокированными до native MLS + durable local storage.

Не включать Megolm в production, не использовать in-memory bridge как постоянное хранилище и не добавлять plaintext fallback.

## 3. Найденные проблемы и выполненные исправления

### Production persistence

- В каноническом `src/main.js` production мог запускаться без PostgreSQL pool и использовать память.
- Добавлен fail-closed guard: production startup без PostgreSQL отклоняется до открытия HTTP порта.
- В `test/main.test.js` добавлен регрессионный тест.
- Комментарии `src/server.js` и `src/store.js` приведены в соответствие с фактической архитектурой: PostgreSQL — постоянный store, memory store — только тесты/локальная разработка.

### Конфигурация телефона и SMS

- `INONE_REQUIRE_PHONE` по умолчанию теперь `false`; включение возможно только явным `true`.
- `INONE_SMS_ENABLED` остаётся `false` по умолчанию.
- В канонической сборке нет production SMS provider injection: сервер по умолчанию создаёт memory SMS adapter для тестов.
- Поэтому production config теперь запрещает `INONE_SMS_ENABLED=true` и `INONE_REQUIRE_PHONE=true`, пока настоящий провайдер не будет реализован и проверен.
- Добавлены тесты для email-first defaults и fail-closed SMS поведения.

### Production secrets и environment template

- `.env.example` исправлен: DATABASE_URL больше не содержит поясняющий текст внутри значения; добавлены SMTP, docs secret, files path, phone/SMS flags и production defaults.
- Production config теперь отвергает известные placeholder markers в PIN pepper, docs secret и SMTP credentials; example host/address/public URL; placeholder PostgreSQL hostname.
- Добавлена проверка корректного PostgreSQL URL, диапазона request timeout и положительной безопасной file quota.
- Все значения в `.env.example` остаются placeholders; их нельзя использовать как реальные секреты.

### Legacy криптография и зависимости

- Matrix crypto package используется старым Node test client, а не production HTTP server.
- `@matrix-org/matrix-sdk-crypto-wasm` перемещён из runtime dependencies в devDependencies; package-lock согласован с package.json.
- Production backend не импортирует `src/client.js` / `TemporaryMatrixEngine`.

### Жизненный цикл сервера

- Cleanup interval раньше создавался до успешного listen и не очищался при shutdown.
- Теперь interval создаётся после успешного bind и очищается при остановке.
- SMTP transport закрывается при graceful shutdown.

### Дублирующий POC server

- `inone-engine-poc-0.6.0/src/main.js` теперь отклоняет любой production запуск, даже если передан PostgreSQL pool.
- Добавлен тест, что POC server остаётся доступен тестам/разработке, но не может быть развёрнут как production backend.
- README и DEPLOY POC каталога помечены: Node server не использовать; persistent OpenMLS client сохраняется как отдельный артефакт.

### CI и мобильные контракты

- В `.github/workflows/flutter-mobile.yml` устранён повторный ключ `push`; правила запуска для feature branch и main объединены в один блок.
- В `.github/workflows/validate-published-p0.yml` добавлена текущая рабочая ветка в push trigger, чтобы запускать P0 Node/PostgreSQL/Rust matrix на её изменениях.
- Rust formatting workflow больше не вставляет untrusted PR branch ref прямо в shell; ref передаётся через env, push ограничен same-repository PR.
- Beta 1.0 API integration docs переведены на canonical P0 backend source path.

## 4. Статические проверки, выполненные после изменений

- JSON parse для canonical `package.json` и `package-lock.json`: PASS.
- Root lockfile dependencies совпадают с `package.json`: PASS.
- Legacy Matrix crypto package присутствует только в devDependencies и помечен dev в lockfile: PASS.
- В Flutter workflow остался один `push` block: PASS.
- В P0 workflow добавлен trigger для текущей ветки: PASS.
- Production PostgreSQL guard и новые regression tests присутствуют в исходниках: PASS.
- Статическая инвентаризация: 177 уникальных `storage.<method>()` вызовов в canonical server; все имена найдены в PostgreSQL store и memory store. Это проверка наличия интерфейсных имён, а не доказательство корректности SQL/транзакций.
- Сравнение route path literals и store operation names двух серверных деревьев завершено; результаты приведены в разделе 2.

## 5. CI и runtime evidence

- Исторический P0 CI на exact SHA из P0 closure report: 6/6 jobs PASS.
- После новых изменений полный Node/PostgreSQL/Rust suite здесь не запускался.
- Flutter workflow run #43571536430 завершился failure до выполнения steps; получение job logs вернуло BlobNotFound. Поэтому это не является ни тестовым провалом приложения, ни успешной проверкой.
- Доступный workflow-runs wrapper показывает только PR-triggered runs; push run текущей ветки этим способом не подтверждён.
- Локальные `npm test`, `npm run test:db`, `cargo test`, `flutter analyze` и `flutter test` не запускались.

## 6. Что сохранено, а что отправлено в архив

- Исторические HTML/WebView материалы остаются в `мусорный ящик/` согласно ранее принятому переходу на Flutter.
- Канонический P0 backend сохранён в существующем пути, чтобы не ломать provenance и ссылки.
- POC каталог не перемещён целиком: его Node server теперь заблокирован для production, но persistent OpenMLS client и тестовые материалы нужны для дальнейшей FFI работы.
- Никакие уникальные engine source files или миграции не удалялись.

## 7. Открытые блокеры до утверждения постоянного и безопасного движка

1. Успешный полный CI на точном текущем SHA: Node 22, PostgreSQL 16, Rust 1.91, Flutter.
2. Проверка миграций на пустой БД и upgrade copy с сохранением данных.
3. Реальный PostgreSQL backup и restore drill.
4. Реальная SMTP доставка с домена, SPF/DKIM/DMARC.
5. TLS reverse proxy, trust proxy, firewall/network isolation и эксплуатационные тайм-ауты.
6. Нагрузочные и multi-instance проверки, наблюдаемость и alerting.
7. Подключение persistent OpenMLS client к Flutter через поддерживаемый FFI.
8. SQLCipher database key из iOS Keychain / Android Keystore; lifecycle, restart, offline sync, device revoke/recovery.
9. Полные физические iOS/Android tests и end-to-end с двумя и более устройствами.
10. Threat model review и независимый security/crypto audit.

**Итог:** серверный P0 backend имеет постоянный PostgreSQL path и принятую историческую P0 CI базу; новые fail-closed исправления внесены в рабочую ветку. Дублирующий POC server исключён из production. Клиентский MLS путь ещё не интегрирован с активным Flutter runtime. До прохождения текущего CI и оставшихся эксплуатационных/мобильных проверок весь движок нельзя объявлять сертифицированным production-safe.
