# InOne Beta 1.0 — технический аудит чатов и групп и план доработки

**Дата аудита:** 2026-11-26 (UTC+4)  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Проверенная ветка:** `main`  
**Точный HEAD:** `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`  
**Рабочая ветка документа:** `audit/chat-groups-beta1-main-216c6d9-20261126`  
**Статус аудита:** SOURCE REVIEW COMPLETE / RELEASE ACCEPTANCE NOT READY  
**Общий вывод:** **NOT READY для приёмки чатов и групп Beta 1.0.**  
**Изменения приложения в рамках аудита:** отсутствуют. Изменяется только документация.

---

## 1. Краткий итог

По актуальному `main` подтверждено наличие значительной части backend- и MLS-инфраструктуры: комнаты и участники, роли и capabilities, публичные группы, MLS Commit/Welcome, OpenMLS-клиент на Rust, SQLCipher, постоянные inbox/outbox, идемпотентность отправки, зашифрованные вложения и push-маршрут без содержимого сообщения.

При этом наличие инфраструктуры не равно готовности продукта. Есть один подтверждённый P0-дефект согласованности членства и MLS, два P1-дефекта/отсутствующих обязательных сценария и восемь P2-дефектов либо существенных пробелов пользовательского пути.

| Приоритет | Количество | Смысл |
|---|---:|---|
| P0 | 1 | Критический разрыв отзыва членства и криптографического состояния |
| P1 | 2 | Небезопасный обход MLS при добавлении и отсутствие личных диалогов |
| P2 | 8 | Неполные продуктовые сценарии, UI, синхронизация и масштабирование |
| P3 | 0 | Подтверждённые P3 в рамках просмотренных компонентов не выделены |

Отдельно существует release gate: `INONE_MLS_NATIVE_ENABLED` по умолчанию равен `false`. Это осознанное fail-closed решение владельца, а не дефект, который следует устранять простым включением флага. Пока обязательная проверка Android/iOS, восстановления, двух устройств и безопасности не принята, фактический пользовательский путь отправки и чтения сообщений остаётся закрытым.

## 2. База аудита и актуальность

### 2.1. Main и история изменений

На момент начала аудита GitHub сообщил:

- `main` HEAD: `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`;
- последний commit: `docs(development): add Beta 1.0 auth and recovery implementation plan`;
- родительский commit: `baec9c083ed51ab5004e5f1b1e99aca6b4f2476a`;
- сравнение parent → HEAD: один commit, один добавленный файл `development/AUTH-REGISTRATION-LOGIN-RECOVERY-BETA-1.0-PLAN.md`; прикладной код в этом единственном delta не менялся.

Релевантные слитые изменения:

- PR #131 — интеграция native Flutter, G2, canonical Engine B и MLS-сценариев; merge commit `2430b0365ab71c60b0926b27854d17a9090e1fba`.
- PR #132 — post-merge MLS crash consistency / durable Welcome и Commit journal; merge commit `02880940c1e4d8261405fbeaa01f40879eb44f3a`.
- PR #154 — Stage 4 database integrity и FCM race hardening; merge commit `baec9c083ed51ab5004e5f1b1e99aca6b4f2476a`.

Проверены статусы связанных PR:

- PR #90 остаётся Draft/open/unmerged. Его нельзя закрывать или сливать без отдельного решения владельца. Его ветка использует экспериментальный Engine A и не является базой для текущей реализации.
- PR #159 и #162 не слиты в main на момент аудита.
- PR #163 закрыт без merge и заменён отдельным прототипом PR #164; PR #164 не является production dependency и не меняет текущую MLS-архитектуру main.
- Для текущего production Rust bridge `mobile/rust/Cargo.toml` использует `inone-development-archive-0.6.0/engine/mobile-mls/mls-client` — canonical Engine B. Engine A из `inone-engine-poc-0.6.0` не считается production-клиентом.

### 2.2. Проверенные компоненты

**Backend / PostgreSQL**
- `inone-development-archive-0.6.0/engine/src/server.js`
- `inone-development-archive-0.6.0/engine/src/store.js`
- `inone-development-archive-0.6.0/engine/src/store-memory.js`
- `inone-development-archive-0.6.0/engine/src/schema.sql`
- `inone-development-archive-0.6.0/engine/migrations/*`
- `room-permissions.js`, `room-rules.js`, `mls-rules.js`, `mls-wire.js`
- backend tests for groups, room permissions, MLS membership/messages/device removal/idempotency/offline, files, delivery, sync ACK, public groups, security matrix and channels.

**Flutter / Dart**
- `mobile/lib/app/inone_mobile_app.dart`
- `mobile/lib/core/session/inone_session.dart`
- `mobile/lib/core/data/inone_room.dart`
- `mobile/lib/core/data/inone_chat_preview_mapper.dart`
- `mobile/lib/core/data/inone_repositories.dart`
- `mobile/lib/core/mls/mls_session_bridge.dart`
- `mobile/lib/core/mls/rust_mls_session_bridge.dart`
- `mobile/lib/core/session/inone_push_lifecycle.dart`
- `mobile/lib/core/session/inone_push_receive_lifecycle.dart`
- `mobile/lib/ui_dart_source/screens/main/inone_messages_screen.dart`
- `mobile/lib/ui_dart_source/screens/main/inone_chat_thread_screen.dart`
- related Flutter tests and integration test inventory.

**Rust / MLS / attachments**
- `mobile/rust/Cargo.toml`
- `mobile/rust/src/lib.rs`
- `mobile/rust/src/api/session.rs`
- `mobile/rust/src/secure_store.rs`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/src/lib.rs`
- `attachment_crypto.rs`
- OpenMLS client integration and regression test inventory.

**Документация и продуктовые решения**
- `mobile/API-CONTRACTS-BETA-1.md`
- `mobile/README.md`
- `mobile/FIREBASE-PUSH-INTEGRATION.md`
- `development/AI-AGENT-MANDATE.md`
- `development/AI-AGENT-GIT-INTEGRATION-POLICY.md`
- `development/WORKING-RULES.md`
- `development/PROGRESS-BASELINE.md`
- `docs/continuity/DECISIONS.md` и continuity-документы.

### 2.3. Ограничения и достоверность

1. Проверка выполнялась read-only через GitHub tree, source-file, compare, PR и Actions API. Полный локальный clone, сборка и запуск тестов в рамках этого аудита не выполнялись.
2. Не запускались Node, PostgreSQL, Flutter, Rust/OpenMLS, Android emulator, iOS simulator или физические устройства.
3. Не выполнялась live-доставка FCM/APNs. Её проверка остаётся отдельным release gate.
4. В CI найдено пять успешных workflow на SHA `baec9c083ed51ab5004e5f1b1e99aca6b4f2476a`: Backend Docker Compose (#45759098791), OpenMLS client validation (#45759098767), Dev Container Compose (#45759098819), Email/PostgreSQL (#45759098778), P0 source validation (#45759098794). Это историческое exact-SHA evidence для этого SHA. На текущем документационном HEAD `216c6d9...` Actions runs отсутствуют; поэтому тесты не объявляются прошедшими на точном текущем HEAD.
5. Статический анализ подтверждает наличие маршрутов и реализаций, но не подтверждает успешную работу полного Flutter → Rust → backend → PostgreSQL → recipient pipeline на реальном устройстве.
6. Там, где не было подтверждения runtime-тестом, вывод помечен как архитектурный риск или непроверенная гипотеза, а не как воспроизведённая эксплуатационная атака.

## 3. Фактическая продуктовая модель

### 3.1. Сущности

В актуальной схеме комнаты представлены таблицами `rooms`, `room_members`, `room_events`, `invites`, `join_requests`, MLS-таблицами и связанными таблицами файлов.

Backend поддерживает `kind = group | channel`. Комната имеет `visibility = public | private` и `join_policy = open | approval`. Участники имеют роли owner/admin/member и отдельные capabilities.

Организации — отдельная бизнес-сущность с собственными участниками, ролями, статусами и связями между организациями. Организация не является каналом или группой. Она влияет на допустимость доступа к комнате, но не заменяет room membership.

Отдельной сущности «сообщество» в проверенном текущем backend-контракте не обнаружено. Не следует проектировать её как синоним группы без продуктового решения.

### 3.2. Личные чаты

Владелец утвердил личные чаты как часть Beta 1.0 и как бесплатную базовую коммуникацию. Однако текущий backend `POST /rooms` принимает только `group` и `channel`; отдельной модели direct conversation, API создания/повторного открытия и уникального ограничения на пару пользователей не обнаружено. Flutter mapper распознаёт алиасы `direct/dm/person`, но это само по себе не создаёт серверную direct-room модель.

**Вывод:** личные диалоги нельзя считать реализованными сквозным образом.

### 3.3. Группы и каналы

Группы имеют серверную модель ролей, capabilities, настроек приватности, открытого/модерируемого вступления, приглашений и заявок. Есть owner transfer endpoint, read markers, поиск публичных комнат, ограничение числа участников и управление разрешениями.

Канал существует как отдельный backend `kind`, с обязательным именем и уникальностью имени. Однако текущий Flutter mapper преобразует неизвестные типы, включая `channel`, в `group`. Отдельная полноценная мобильная модель канала и его публикационного UX не подтверждена.

## 4. Архитектурная карта

### 4.1. Сообщение

Фактический целевой маршрут:

1. Flutter composer вызывает app handler.
2. `InOneSession` проверяет активную native MLS session.
3. Для текста создаётся устойчивый operation ID и запись durable outbox в Rust/SQLCipher.
4. Engine B создаёт MLS Application Message; состояние ratchet и операция сохраняются в SQLCipher.
5. Rust отправляет ciphertext на `POST /mls/groups/:roomId/messages`.
6. Backend проверяет bearer session, актуальное членство, capability `send_messages`, framing, room ID, текущий epoch, ограничения размера и idempotency.
7. Backend записывает `m.room.encrypted` event в PostgreSQL. Backend не расшифровывает содержимое.
8. Для push используется durable outbox; payload содержит тип события, opaque event ID и безопасный относительный путь, но не текст и не ciphertext сообщения.
9. Получатель синхронизирует room events/commits/welcomes через Rust MLS client.
10. Rust проверяет и расшифровывает MLS-событие, сохраняет его в SQLCipher inbox/history.
11. Flutter сначала читает durable history; ACK readable incoming events разрешён только после наличия события в сохранённой истории.

Legacy `POST /rooms/:id/events` для отправки намеренно возвращает 409. Это правильный fail-closed контракт: plaintext или альтернативный send path не должен быть добавлен.

### 4.2. MLS и локальное хранение

Подтверждено в source:
- Rust-owned `MlsSession`;
- Engine B OpenMLS client;
- SQLCipher local database;
- Android native keyring / iOS protected Keychain adapters;
- SQLCipher key не возвращается в Dart API;
- refresh-token pair после handoff остаётся под Rust ownership;
- durable outbox/inbox, stable message IDs, pending retry;
- Welcome receipts, membership commit journal, quarantine/desync diagnostics;
- ACK после durable persistence;
- attachment manifest с file key/nonce находится внутри MLS-encrypted application message.

Важная граница: наличие этих функций в коде и тестах не означает завершённую платформенную эксплуатационную приёмку. Флаг `INONE_MLS_NATIVE_ENABLED` остаётся false по обязательному решению владельца.

### 4.3. Вложения

В Engine B найден отдельный AES-256-GCM attachment pipeline:
- содержимое шифруется на клиенте;
- file key и nonce помещаются в MLS-защищённый manifest;
- сервер получает ciphertext и служебные данные файла;
- upload URL подписан и ограничен сроком;
- незавершённая загрузка привязана к owner device;
- completion перепроверяет устройство, membership и capability;
- download URL подписан и проверяет актуальную авторизацию;
- скачанное содержимое проверяется и расшифровывается Rust-клиентом.

Сервер всё ещё видит некоторые метаданные: room ID, owner/device, размер, хэш ciphertext, статус и временные отметки. Это не plaintext leak, но это часть threat model социального графа и traffic analysis.

### 4.4. Синхронизация и push

В проверенном мобильном контуре не обнаружен WebSocket transport. Используются HTTP sync/event fetch, повторная синхронизация на пользовательских переходах/восстановлении и Firebase push. Push содержит только безопасный маршрут и event ID; обработчик уведомления сам по себе не расшифровывает сообщение. При открытии уведомления приложение проверяет сессию, запрашивает событие и требует native MLS для отображения содержимого.

Это безопаснее передачи текста в push, но не доказывает непрерывную real-time доставку при активном приложении или гарантированное восстановление после длительного offline.

## 5. Обнаруженные проблемы

### 5.1. Подтверждённые дефекты

#### CHAT-P0-01 — Серверное удаление участника не выполняет MLS Remove Commit

**Приоритет:** P0  
**Статус:** ПОДТВЕРЖДЁН ПО ИСХОДНОМУ КОДУ; runtime exploit не запускался.

**Фактическое поведение**
- `inone-development-archive-0.6.0/engine/src/server.js:2333` — `DELETE /rooms/:roomId/members/:userId`.
- После проверки actor/role/capability маршрут вызывает `storage.removeRoomMember(roomId, target)`.
- `inone-development-archive-0.6.0/engine/src/store.js:1762` — операция удаляет строку `room_members`; этот путь не создаёт MLS Remove Commit, не продвигает MLS epoch и не подтверждает изменение MLS-состава.
- `mobile/API-CONTRACTS-BETA-1.md` в разделе native MLS removal прямо фиксирует, что прямой DELETE не должен использоваться; мобильный UI должен использовать Rust MLS operation.
- В UI удаление делегируется native MLS operation, но сам backend DELETE route всё ещё доступен.

**Ожидаемое поведение**
Любое удаление участника MLS-комнаты, включая self-leave, должно завершаться только после принятого MLS Remove Commit, epoch transition, локального merge и post-sync подтверждения одинакового состава на сервере и в MLS.

**Сценарий**
1. Создать MLS-комнату с Alice и Bob.
2. Вызвать прямой DELETE route для Bob.
3. Проверить: серверное членство Bob удалено, но MLS epoch оставшейся группы не продвинут этим маршрутом.
4. Alice отправляет новое сообщение в прежнем MLS epoch.
5. Проверить, что Bob сохраняет старый MLS state. Серверный ACL должен блокировать прямое получение room event после удаления; однако криптографический отзыв не состоялся. Если ciphertext попадёт к Bob по любому другому каналу, его старый group state не был отозван.

**Риск**
Нарушается инвариант MLS membership/revocation. Прямое получение ciphertext бывшим участником через этот API не доказано, поскольку серверная авторизация событий проверяет membership. Но криптографическое исключение участника не выполнено, поэтому считать такую операцию безопасным отзывом доступа нельзя.

**Решение**
- Для MLS-комнат запретить server-only DELETE и возвращать fail-closed 409 с кодом `mls_commit_required`.
- Не удалять участника до валидного MLS Commit.
- Self-leave реализовать как MLS Commit с удалением собственного MLS membership, а не как прямой SQL DELETE.
- Свести все mutation paths к одному транзакционному и проверяемому протоколу.
- Сохранить исторические legacy tests, но заменить их ожидания для MLS-комнат и добавить регрессии.

**Тесты**
- backend: `mls-membership.test.js`, `mls-device-removal.test.js`, `groups.test.js`, `files.test.js`;
- PostgreSQL concurrency: одновременное удаление/отправка/commit;
- Engine B: удалённый participant не может обработать ciphertext новой epoch;
- regression: прямой DELETE не меняет membership и epoch частично.

**Критерии приёмки**
- нет доступного server-only removal пути для MLS-комнаты;
- серверное membership и MLS membership изменяются согласованно;
- удалённый участник не получает новые ciphertext через разрешённые server paths;
- оставшиеся участники отправляют только в новой epoch;
- тесты проходят на одном exact SHA.

**Зависимости:** CHAT-A-01, CHAT-I-01.

#### CHAT-P1-01 — Добавление участника через обычный endpoint обходит MLS Add Commit/Welcome

**Приоритет:** P1  
**Статус:** ПОДТВЕРЖДЁН ПО ИСХОДНОМУ КОДУ.

**Фактическое поведение**
- `server.js:2260` — `POST /rooms/:roomId/members`.
- Проверяются account, capability и organization gate.
- Далее вызывается `storage.addRoomMember`, после чего рассылается room-changed signal.
- В этом handler нет обязательного MLS Add Commit, epoch transition и per-device Welcome.
- Отдельный MLS commit endpoint уже реализует корректный Add + Welcome flow.

**Ожидаемое поведение**
Добавление в MLS-комнату возможно только после принятого MLS Add Commit и Welcome для каждого допустимого устройства пользователя.

**Риск**
Серверный состав комнаты может отличаться от MLS roster. Новый участник получает серверное членство, но не обязательно получает криптографическое состояние группы. Это нарушает целостность доступа и создаёт возможность рассинхронизации.

**Решение**
- Закрыть прямой POST для MLS-комнат или оставить только для явно определённого не-MLS ресурса, если такой ресурс будет утверждён отдельно.
- Все добавления направить через Rust OpenMLS Add Commit и Welcome.
- Проверять серверный и MLS roster до/после изменения.

**Тесты:** MLS membership, public groups, invites, concurrent membership, negative API tests.

**Критерии приёмки:** ни один обычный REST add/join/invite endpoint не может объявить пользователя полноценным MLS-участником без принятого MLS Commit/Welcome.

**Зависимости:** CHAT-A-01, CHAT-I-01.

#### CHAT-P1-02 — Личные чаты не реализованы сквозным образом

**Приоритет:** P1  
**Статус:** ОТСУТСТВУЮЩАЯ ФУНКЦИОНАЛЬНОСТЬ.

**Фактическое поведение**
- `POST /rooms` принимает только `group` и `channel`.
- Модель `rooms` не содержит подтверждённой пары direct participants с уникальным ограничением.
- Не найден отдельный backend contract для create-or-open direct conversation.
- `mapInOneRoomKind` знает алиасы direct/dm/person, но backend не создаёт такой kind.
- В Flutter нет полного сценария поиска пользователя → создание/повторное открытие личного диалога → MLS Welcome на все устройства.

**Ожидаемое поведение**
Один и тот же набор двух пользователей всегда открывает один и тот же direct conversation; конкурентные запросы не создают дубликаты. Личный чат использует тот же MLS fail-closed принцип, что и группа.

**Решение**
- Согласовать direct-chat contract и canonical identity/pair key.
- Добавить атомарный create-or-get с уникальностью пары пользователей.
- Не использовать group endpoint с произвольным kind до утверждения контракта.
- Подключить typed repository, поиск пользователя и Flutter navigation.
- Создание MLS-группы/Welcome для direct conversation выполнить через Engine B.

**Тесты:** параллельное создание одной пары, обратный порядок участников, повторное открытие, несколько устройств, запрет чужой истории, remove/revoke.

**Критерии приёмки:** два пользователя всегда получают один диалог; дубликаты невозможны на уровне БД; plaintext fallback отсутствует; отправка/получение проходят через MLS.

**Зависимости:** CHAT-D-01, CHAT-MLS-01, CHAT-I-02.

### 5.2. P2 — неполные пользовательские сценарии и архитектурные пробелы

#### CHAT-P2-01 — Каналы отображаются как обычные группы
**Файл:** `mobile/lib/core/data/inone_chat_preview_mapper.dart:5`.  
**Факт:** mapper обрабатывает direct/dm/person и support; остальные значения попадают в group. Backend имеет отдельный `kind=channel`.  
**Риск:** неверные визуальные и поведенческие ожидания, нет отдельного channel UI.  
**Решение:** добавить явный enum/DTO для channel и отдельный UI/permission behavior только в рамках утверждённой Beta 1.0 модели.  
**Тесты:** DTO mapping, widget tests, backend channel contract.  
**Приёмка:** channel никогда не отображается как group; недопустимые kind не маскируются как group.

#### CHAT-P2-02 — История событий не имеет server-side pagination
**Файлы:** `server.js:3041+`, `store.js:2128+`.  
**Факт:** GET room events выбирает все события после `joinedSeq` в порядке seq; cursor/page limit в этом маршруте не обнаружен.  
**Риск:** большие группы и длинная история создают большие ответы, память/CPU spikes, долгую расшифровку и медленную прокрутку.  
**Решение:** cursor pagination по стабильному seq/event ID, верхний limit, сохранение join floor и строгое упорядочивание; клиент загружает более старые страницы по требованию.  
**Тесты:** 100k событий, одинаковые timestamps, пропуски/повторные страницы, конкурентная запись, новый участник не получает историю до joinedSeq.  
**Приёмка:** размер ответа ограничен; страницы не пропускают и не дублируют события; старые сообщения подгружаются независимо от новых.

#### CHAT-P2-03 — Неполная модель списка чатов и unread
**Файлы:** `inone_room.dart`, `inone_chat_preview_mapper.dart`, `inone_mobile_app.dart`.  
**Факт:** room-list DTO содержит roomId/kind/name/role; mapper создаёт preview с пустым временем и null lastMessage. App передаёт `unreadCountsAvailable: false`. При активном native MLS часть preview восстанавливается из локальной истории, но серверный список не содержит полноценного last activity/unread projection.  
**Риск:** список чатов не соответствует ожидаемому UX; нет достоверных unread badges и стабильной сортировки между устройствами.  
**Решение:** определить server-side room summary projection: latest event cursor/time, unread/read position, pinned ordering только если входит в Beta 1.0; не отправлять plaintext в summary.  
**Тесты:** две учётные записи/несколько устройств, read marker monotonicity, offline/restart, redacted events.  
**Приёмка:** список восстанавливается после перезапуска и одинаково отображается на устройствах без утечки текста на сервер.

#### CHAT-P2-04 — Создание группы не покрывает полный UX
**Файл:** `inone_mobile_app.dart:1149+`.  
**Факт:** текущий flow генерирует room ID, предлагает одного invitee и создаёт MLS room/invite. Отдельный выбор имени/изображения и полноценный multi-select участников при создании не подтверждены. Имя можно изменить позже через настройки.  
**Риск:** созданная группа выглядит как техническая комната; пользователь не может завершить ожидаемый сценарий за один flow.  
**Решение:** добавить name/avatar/member picker поверх существующего Engine B flow; все участники должны добавляться MLS Commit/Welcome, не прямым REST mutation.  
**Тесты:** отмена выбора, один/несколько участников, duplicate invite, failed Welcome, retry.  
**Приёмка:** созданная группа имеет корректное имя и выбранный аватар; каждый участник появляется после подтверждённого MLS Add.

#### CHAT-P2-05 — Часть управления группой доступна backend, но не завершена в UI
**Файлы:** `server.js` room routes, `inone_repositories.dart`, `inone_mobile_app.dart`.  
**Факт:** backend содержит owner transfer и invite-link/QR endpoints. Flutter имеет настройки, роли/capabilities, заявки и MLS invite по user ID, но полный UI owner transfer, invite-link/QR lifecycle, безопасный self-leave и delete-group flow не подтверждён.  
**Риск:** пользователь не может самостоятельно завершить жизненный цикл группы; опасно использовать legacy DELETE как замену self-leave.  
**Решение:** разделить действия owner/admin/member; добавить только утверждённые Beta 1.0 сценарии. Self-leave только через MLS Remove Commit. Удаление комнаты требует отдельного безопасного backend contract и решения по retention.  
**Тесты:** owner transfer race, last owner, admin-vs-admin, revoked invite, self-leave, room deletion retention.  
**Приёмка:** каждая кнопка вызывает typed repository/MLS operation, а не прямой SQL/legacy route; сервер повторно проверяет роль.

#### CHAT-P2-06 — Отсутствуют или не подключены действия над сообщением
**Файлы:** `inone_chat_thread_screen.dart`, `inone_mobile_app.dart`, room event edit/redact handlers.  
**Факт:** текущий thread UI подтверждает базовый текст и вложения. Backend имеет edit/redact contract, но подключение этих операций к native Flutter UI не подтверждено. Replies, reactions и message search не обнаружены в текущем пользовательском потоке.  
**Решение:** в Beta 1.0 включать только функции, закреплённые в утверждённом WBS/API contract. Pinned messages, favorites, polls, permissioned bots и group collaboration extras относятся к Beta 2.0 candidate backlog и не должны автоматически попадать в Beta 1.0.  
**Тесты:** permission-denied, author-only edit, delete window, already-read deletion, epoch mismatch, redaction rendering.  
**Приёмка:** каждое отображаемое действие имеет реальный backend/native handler и negative tests; неподключённые функции не показываются.

#### CHAT-P2-07 — Нет доказанной непрерывной real-time синхронизации
**Файлы:** `inone_session.dart:804+`, push lifecycle/receive lifecycle, backend `/sync`.  
**Факт:** обнаружены HTTP pull/sync и generic push route. WebSocket transport в проверенном контуре не найден. Sync вызывается в конкретных lifecycle/UI flows; push handler не расшифровывает сообщение самостоятельно.  
**Риск:** задержки получения при активном приложении, пропуск событий при длительном offline или отказе push-провайдера.  
**Решение:** зафиксировать допустимую модель доставки для Beta 1.0: push wake-up + bounded foreground sync + cursor reconciliation; обеспечить sync при resume, push foreground/open, восстановлении сети и периодическом foreground tick, если это согласовано. WebSocket не добавлять без необходимости и архитектурного решения.  
**Тесты:** push missed, duplicate, out-of-order, reconnect, token refresh, app resume, long offline.  
**Приёмка:** события в итоге синхронизируются без дубликатов и без зависимости от открытого экрана; plaintext отсутствует в push.

#### CHAT-P2-08 — Недостаточно Flutter widget/integration tests для чатов
**Факт:** backend suite содержит значительный набор room/MLS/files tests; Flutter содержит session handoff, DTO, push и room tests. Полное widget/integration покрытие списка чатов, thread composer, группы, вложений, пустых/ошибочных состояний и навигации не подтверждено.  
**Решение:** добавить тесты на реальный widget composition и fake bridge/API boundary; затем добавить backend-recipient integration scenario на тестовой инфраструктуре.  
**Тесты:** loading/error/empty, open room, no Welcome, send queued, retry, attachment, remove member, app resume, push tap.  
**Приёмка:** каждый Beta 1.0 critical user journey покрыт positive/negative tests; мок не выдаётся за Flutter→backend E2E.

## 6. Проверка безопасности: threat model

| Угроза | Текущее наблюдение | Оценка |
|---|---|---|
| Доступ к чужому чату через подмену room ID | Room/event/member/file routes проверяют bearer и membership; требуется регрессия по всем путям | Архитектура есть; полный IDOR matrix не запускался |
| Самовольное добавление в приватную группу | Private join endpoint скрывает room; MLS invite checks capabilities | Положительная защита; legacy direct POST membership остаётся риском CHAT-P1-01 |
| Удалённый участник | Прямой DELETE меняет server membership без MLS Commit | P0 CHAT-P0-01 |
| Отозванное устройство | Device revocation и MLS pending removals существуют; per-device KeyPackages/Welcome | Source present; физическая двух-device проверка не выполнена |
| Replay API requests | Refresh rotation, MLS operation IDs, stable clientMessageId и commit journal присутствуют | Положительная архитектура; полный adversarial matrix не запускался |
| Подмена message ID / room ID | Server checks room header, epoch, idempotency and room membership | Source present; требуется fuzz/negative coverage |
| Чужие вложения | Signed URLs, owner/device binding, current membership check, ciphertext integrity | Положительная защита; runtime test не запускался в этом аудите |
| Подмена ролей | Server-side owner/capability checks | Source present; concurrency matrix нужна |
| Race condition | Некоторые PostgreSQL mutations используют locks/transactions; membership legacy routes расходятся с MLS flow | P0/P1 |
| История до вступления | joinedSeq применяется к room events | Положительная защита; тесты есть |
| Доступ после выхода | Server ACL закрывает события; MLS removal bypass остаётся | P0 |
| Социальный граф/метаданные | Server хранит room roster, sender, timestamps, read_seq, file room/owner/size/hash | Архитектурный риск; сервер видит связи и traffic metadata |

### 6.1. Логи и push

Push payload документирован как generic: event type, opaque event ID, safe relative route. В нём не должно быть message text, sender identity, MLS plaintext/ciphertext, file bytes или credentials. Это подтверждается мобильным push integration doc и receive lifecycle source, но реальная FCM/APNs доставка не проверялась.

### 6.2. Megolm и legacy crypto

В `inone-development-archive-0.6.0/engine/src/crypto-engine.js` сохранился адаптер matrix-sdk-crypto-wasm с Olm/Megolm, а package manifest содержит соответствующую зависимость. При этом:
- production Flutter Rust dependency указывает на Engine B/OpenMLS;
- проверенный server entrypoint не импортирует этот crypto engine как отправляющий/расшифровывающий путь;
- текущий Flutter thread использует Rust MLS bridge;
- документация запрещает plaintext/Megolm fallback.

**Вывод:** активный Megolm fallback не подтверждён. Остаточный адаптер и зависимость требуют отдельной проверки импортов/потребителей перед возможным удалением. В рамках этого аудита они не удаляются.

## 7. Матрица тестового покрытия

| Область | Существующие тесты/проверки | Что доказывают | Что остаётся |
|---|---|---|---|
| Backend groups | `groups.test.js`, `public-groups.test.js`, `room-permissions.test.js` | HTTP group behavior, permissions, public membership | MLS state parity for every legacy mutation path |
| MLS membership | `mls-membership.test.js`, `mls-device-removal.test.js` | Add/Remove Commit, Welcome, epoch, device removal | Direct REST bypass regression and cross-client decryption test |
| MLS messages | `mls-messages.test.js`, `mls-idempotency.test.js`, `mls-offline.test.js`, `mls-wire.test.js` | Epoch checks, encrypted message path, retries/offline | Full mobile UI → Rust → backend → recipient device |
| Attachments | `files.test.js`, `files-disk.test.js`, Rust attachment crypto tests | Signed URL, membership/device checks, ciphertext integrity | Physical file picker/save, interrupted transfer and actual device key-store |
| Delivery/sync | `delivery.test.js`, `sync-ack.test.js`, `push-delivery-db.test.js` | Queue ACK and push persistence | Provider acceptance, missed push and real devices |
| PostgreSQL/security | `security-matrix.test.js`, membership/db suites, migrations | Route/store behavior and transaction regressions | Full adversarial race matrix for room membership vs MLS commit |
| Flutter DTO/session | room mapper, push lifecycle, `mls_session_handoff_test.dart` | Parsing, lifecycle and bridge handoff behavior under test doubles | Widget tests and real Rust bridge end-to-end |
| Flutter UI | Chat/thread screens exist | UI components and callbacks exist | Not proof of production acceptance or all user actions |
| Rust/OpenMLS | Engine B Rust tests and CI workflow | MLS persistence/commit/inbox/outbox logic for recorded SHA | Current main exact-SHA and device runtime acceptance |

**Важно:** тест `groups.test.js` проверяет запрет чтения после удаления через серверный ACL. Это не эквивалент теста, который доказывает MLS epoch rotation и невозможность расшифровать ciphertext, если бывший участник его получил. Аналогично наличие `mls-membership.test.js` не закрывает legacy DELETE route, если этот маршрут меняет только PostgreSQL membership.

### 7.1. CI evidence

На `baec9c083ed51ab5004e5f1b1e99aca6b4f2476a`:
- Backend Docker Compose — PASS, run #45759098791.
- OpenMLS client validation — PASS, run #45759098767.
- Dev Container Compose — PASS, run #45759098819.
- Email/PostgreSQL — PASS, run #45759098778.
- P0 source validation — PASS, run #45759098794.

Current main HEAD `216c6d9...` отличается от этого SHA только добавлением auth/recovery documentation. На точном `216c6d9...` Actions run list пуст. Это не превращается в exact-SHA PASS; результаты выше сохраняются как доказательство для исходного кода на parent SHA.

**Во время аудита новые тесты не запускались.** Статус: NOT RUN.

## 8. План исправлений Beta 1.0

Все сроки намеренно не назначаются. Порядок определяется зависимостями и риском.

### Этап A — безопасность членства и доступа

#### [ ] CHAT-A-01 — Закрыть server-only MLS membership mutation
- **Приоритет:** P0
- **Статус:** NOT STARTED
- **Компоненты:** `engine/src/server.js`, `engine/src/store.js`, MLS commit transaction, API contract.
- **Изменение:** закрыть direct DELETE для MLS rooms; все удаления проводить через MLS Remove Commit; self-leave реализовать тем же криптографическим механизмом.
- **Тесты:** прямой DELETE fail-closed; old member cannot fetch; old epoch not accepted; new epoch used; parallel send/remove/commit PostgreSQL tests.
- **Критерии:** серверное membership не меняется без accepted MLS Commit; epoch и roster согласованы; все обязательные тесты PASS на одном SHA.
- **Зависимости:** нет.

#### [ ] CHAT-A-02 — Закрыть прямое добавление без Welcome
- **Приоритет:** P1
- **Статус:** NOT STARTED
- **Компоненты:** `POST /rooms/:id/members`, `/rooms/:id/join`, invite join, MLS commit.
- **Изменение:** MLS room membership mutation только через Add Commit + per-device Welcome; обычные REST add/join не могут создать полноценное membership.
- **Тесты:** legacy POST fail-closed; Welcome missing; wrong device Welcome; concurrent join/invite; post-sync roster equality.
- **Критерии:** ни один публичный маршрут не создаёт MLS membership без commit/welcome.
- **Зависимости:** CHAT-A-01.

### Этап B — личные чаты и надёжность сообщений

#### [ ] CHAT-B-01 — Реализовать direct chat model и create-or-open
- **Приоритет:** P1
- **Статус:** NOT STARTED
- **Компоненты:** PostgreSQL room/direct model, migrations, backend contract, repositories, Flutter search/navigation, Engine B.
- **Изменение:** согласовать canonical pair identity; уникальный unordered user pair; атомарный create-or-get; отдельный typed API; MLS initialization и Welcome для устройств обеих сторон.
- **Тесты:** A→B и B→A возвращают один диалог; конкурентное создание; restart; multiple devices; unauthorized lookup.
- **Критерии:** один личный диалог на пару; реальная отправка и получение через MLS; история закрыта от третьих пользователей.
- **Зависимости:** CHAT-A-01, CHAT-A-02.

#### [ ] CHAT-B-02 — Добавить пагинацию истории
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** `GET /rooms/:id/events`, store query, Rust sync cursor, local history DAO, Flutter thread.
- **Изменение:** cursor по seq/event ID, ограниченный page size, стабильный порядок, joinedSeq floor, lazy load older messages.
- **Тесты:** большие истории, одинаковые timestamps, пропуски/дубликаты, concurrent append, restart.
- **Критерии:** ограниченный response size, последовательная история без потерь и дубликатов.
- **Зависимости:** CHAT-I-02.

#### [ ] CHAT-B-03 — Согласовать статусы отправки/доставки/прочтения
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** SQLCipher outbox, server event receipt/queue, room read markers, Flutter thread/list.
- **Изменение:** определить отдельные статусы queued/sent/delivered/read; не путать `/sync` queue ACK с read marker; не показывать неподтверждённый статус.
- **Тесты:** offline/retry, multiple devices, read marker monotonicity, duplicate ACK.
- **Критерии:** UI показывает только подтверждённое состояние; статусы восстанавливаются после перезапуска.
- **Зависимости:** CHAT-B-02, CHAT-F-01.

### Этап C — группы, участники и роли

#### [ ] CHAT-C-01 — Завершить создание группы
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** Flutter group creation flow, room settings/assets, Engine B invites.
- **Изменение:** имя, изображение, выбор нескольких участников, проверка прав и последовательная MLS Add/Welcome.
- **Тесты:** cancel/retry, duplicate member, partial Welcome failure, room creation crash recovery.
- **Критерии:** группа не показывается как полностью готовая, пока криптографический roster не подтверждён.
- **Зависимости:** CHAT-A-02.

#### [ ] CHAT-C-02 — Завершить lifecycle группы в Flutter
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** owner transfer, leave, invite link/QR, delete/retention contract, group details.
- **Изменение:** подключить только существующие проверенные API; self-leave через MLS; group deletion — после отдельного решения по retention и cascade semantics.
- **Тесты:** owner transfer race, last owner, revoked invite, self-leave MLS, delete retention.
- **Критерии:** нет кнопок без handler; нет legacy membership mutation; все роли проверяются сервером.
- **Зависимости:** CHAT-A-01, CHAT-A-02.

#### [ ] CHAT-C-03 — Развести group и channel UX
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** room DTO/mapper, messages list, channel contract and permissions.
- **Изменение:** отдельные enum/DTO и виджеты; определить publisher/posting semantics только по утверждённой модели.
- **Тесты:** mapper/widget/API negative cases.
- **Критерии:** channel не отображается как group; пользовательские права и тип публикации соответствуют contract.
- **Зависимости:** product scope confirmation if channel behavior is not already approved.

### Этап D — MLS и сквозное шифрование

#### [ ] CHAT-D-01 — Закрыть native MLS acceptance gate
- **Приоритет:** P1 release gate
- **Статус:** BLOCKED / NOT ACCEPTED
- **Компоненты:** Rust FRB, Android Keystore, iOS Protected Keychain, SQLCipher, Engine B, Flutter lifecycle.
- **Изменение:** не переписывать уже реализованный persistent Engine B. Собрать единый exact-SHA evidence package: Rust/OpenMLS, FRB codegen, Flutter analyze/test, Android native key store runtime, iOS Keychain runtime, restore/revoke/restart, two-device.
- **Тесты:** полный matrix на одном SHA; реальное устройство только на отдельной release acceptance стадии.
- **Критерии:** все checks PASS на одном SHA; владелец явно разрешил включение; до этого `INONE_MLS_NATIVE_ENABLED=false`.
- **Зависимости:** CHAT-A-01, CHAT-A-02, CHAT-I-01.

#### [ ] CHAT-D-02 — Проверить device revocation и rejoin lifecycle
- **Приоритет:** P1
- **Статус:** NOT STARTED
- **Компоненты:** `/mls/removals`, device revocation, MLS commit journal, Welcome.
- **Изменение:** подтвердить для каждого отозванного устройства отсутствие доступа к новым событиям и удаление его MLS leaf через Commit; повторный вход создаёт новый device identity/key package.
- **Тесты:** revoked token, stale refresh, stale Welcome, delayed removal, multiple devices.
- **Критерии:** отозванное устройство не получает новые ciphertext и не может восстановить активную сессию старым token/key state.
- **Зависимости:** CHAT-D-01.

### Этап E — вложения

#### [ ] CHAT-E-01 — Закрыть attachment acceptance matrix
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** Rust attachment_crypto, file upload/download endpoints, Flutter picker/save.
- **Изменение:** подтвердить size limits, MIME/content policy, ciphertext-only upload, hash binding, interrupted upload, retry same operation ID, device/membership revocation.
- **Тесты:** tampered ciphertext/manifest, wrong room, wrong device, revoked membership, interrupted upload, large file, invalid MIME/content.
- **Критерии:** сервер не получает plaintext/key/nonce; повтор не создаёт дубликат; revoked device/member не скачивает файл.
- **Зависимости:** CHAT-D-01.

### Этап F — синхронизация и несколько устройств

#### [ ] CHAT-F-01 — Завершить offline/reconnect and push reconciliation
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** Rust sync, `/sync`, room events, FCM generic payload, app resume/foreground receive.
- **Изменение:** определить и реализовать bounded sync triggers; reconcile cursor after reconnect and missed push; ensure duplicate/out-of-order event suppression.
- **Тесты:** missed/duplicate push, offline 24h, token refresh, app killed/resumed, network flaps.
- **Критерии:** события в итоге доставлены без потерь/дубликатов; push не содержит содержимого сообщения.
- **Зависимости:** CHAT-D-01.

### Этап G — Flutter UX

#### [ ] CHAT-G-01 — Завершить список чатов
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** room summary DTO, mapper, messages screen.
- **Изменение:** безопасные last activity summaries, unread counts, stable sort, empty/loading/error/offline states. Не передавать plaintext summary на сервер.
- **Тесты:** unread multi-device, restart, no native MLS, stale summary, empty list.
- **Критерии:** список чатов корректно восстанавливается и показывает только подтверждённые метаданные.
- **Зависимости:** CHAT-B-03, CHAT-F-01.

#### [ ] CHAT-G-02 — Подключить подтверждённые message actions
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** thread screen, edit/redact endpoints, capabilities.
- **Изменение:** подключить только действия, подтверждённые Beta 1.0 contract. Не включать Beta 2.0 pinned/favorites/polls/bots/search extras без отдельного owner decision.
- **Тесты:** author, capability, edit/delete window, already-read, epoch mismatch.
- **Критерии:** каждое отображаемое действие имеет реальный API/native path; отсутствующие действия не показываются.
- **Зависимости:** CHAT-B-03, CHAT-D-01.

### Этап H — производительность и масштабирование

#### [ ] CHAT-H-01 — Проверить room/message query plan и лимиты
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** `room_events`, `room_members`, `files`, indexes, event fetch, group size flags.
- **Изменение:** после pagination проверить индексы по room_id/seq, membership lookup, bounded result sets, retention/cleanup policy.
- **Тесты:** PostgreSQL EXPLAIN, large room fixtures, high write concurrency, storage quota.
- **Критерии:** latency and memory budgets согласованы и соблюдены на согласованном load profile.
- **Зависимости:** CHAT-B-02, CHAT-E-01.

### Этап I — автоматизированные интеграционные и security tests

#### [ ] CHAT-I-01 — MLS membership security regression pack
- **Приоритет:** P0
- **Статус:** NOT STARTED
- **Компоненты:** backend HTTP tests + PostgreSQL + Engine B multi-client harness.
- **Изменение:** один тестовый сценарий покрывает add/remove/leave/revoke/rejoin, включая legacy route denial и exact MLS epoch transition.
- **Тесты:** positive/negative/concurrency/crash/retry; доказать, что бывший участник не может расшифровать новые ciphertext при их наличии у него.
- **Критерии:** все негативные сценарии fail-closed; никакой server-only membership mutation не проходит.
- **Зависимости:** CHAT-A-01, CHAT-A-02.

#### [ ] CHAT-I-02 — Flutter chat/group widget and integration suite
- **Приоритет:** P2
- **Статус:** NOT STARTED
- **Компоненты:** messages screen, thread, group details, repositories, fake/native bridge.
- **Изменение:** покрыть UI состояния и взаимодействия; отдельно обозначать mock tests и live HTTP E2E.
- **Тесты:** loading/error/empty, send/retry, attachment, group create/manage, channel mapping, deep-link/push navigation.
- **Критерии:** критические Beta 1.0 сценарии имеют widget/integration evidence; ни один мок не считается live backend receipt.
- **Зависимости:** CHAT-G-01, CHAT-G-02.

### Этап J — финальная приёмка Beta 1.0

#### [ ] CHAT-J-01 — End-to-end acceptance чатов и групп
- **Приоритет:** P1 release gate
- **Статус:** NOT STARTED
- **Компоненты:** Flutter Android/iOS, backend/PostgreSQL, Engine B, push, files, direct chats, groups.
- **Изменение:** прогнать все принятые сценарии на одном exact SHA; физические устройства только после разрешения владельца и перед release acceptance.
- **Тесты:** direct chat, group lifecycle, two-device send/receive, offline, revocation, encrypted attachments, recovery, push open, restart.
- **Критерии:** P0/P1 = 0 открытых; все required checks PASS на одном SHA; владелец явно принимает результат; флаг MLS включается только отдельным решением.
- **Зависимости:** все предыдущие этапы.

## 9. Что не включать в Beta 1.0 автоматически

По утверждённому WBS v1.1 и product decisions не переносить в Beta 1.0 без отдельного решения:
- pinned messages / pinned chats extras сверх уже утверждённого лимита;
- favorites;
- polls;
- permissioned bots;
- advanced group collaboration extras;
- новые community semantics, не представленные текущей моделью;
- полноценный CRM/community feature set из Beta 2.0.

Личные чаты и базовые группы являются Beta 1.0 scope и не должны переноситься только потому, что их реализация отсутствует.

## 10. Definition of Done для задач плана

Задача может быть закрыта только если:
1. Все критерии приёмки именно этой задачи выполнены.
2. PR слит в main.
3. В документе указан merge commit SHA.
4. Все обязательные тесты задачи прошли на одном exact SHA.
5. Нет незакрытых P0/P1 дефектов в области задачи.
6. Есть исполнитель, reviewer, дата и ссылки на PR/CI.
7. Документ обновлён в том же PR, что и код.

**Правило зачёркивания:** только после выполнения всех условий задача визуально зачеркивается. Описание, ID, чекбокс, критерии, тесты, ссылки, SHA, дата, исполнитель и reviewer остаются в документе.

Пример закрытия:

- [x] ~~CHAT-A-01. Закрыть server-only MLS membership mutation~~
  - Статус: ЗАВЕРШЕНО
  - PR: <ссылка>
  - Merge commit SHA: <sha>
  - Дата: <YYYY-MM-DD>
  - Тесты: <точные workflow/run/job и результат>
  - Исполнитель: <имя>
  - Reviewer: <имя>

Если дефект найден после закрытия:
- снять зачёркивание;
- статус изменить на ПОВТОРНО ОТКРЫТА;
- сохранить прежнюю историю закрытия;
- создать ссылку на регрессионный PR и новый SHA.

## 11. Журнал решений и закрытия

| Дата | ID | Решение/изменение статуса | PR | Merge SHA | Evidence |
|---|---|---|---|---|---|
| 2026-11-26 | AUDIT-BASELINE | Аудит зафиксирован на main SHA 216c6d9; исходный код не менялся | документационный PR | pending | GitHub tree/source/PR/Actions review |
| — | CHAT-A-01…CHAT-J-01 | Все задачи ожидают реализации/приёмки | — | — | См. соответствующие критерии выше |

## 12. Ссылки на основные источники

- [Repository main](https://github.com/vahe210991-cloud/InOne-chat/tree/main)
- [Backend server.js](https://github.com/vahe210991-cloud/InOne-chat/blob/main/inone-development-archive-0.6.0/engine/src/server.js)
- [Backend store.js](https://github.com/vahe210991-cloud/InOne-chat/blob/main/inone-development-archive-0.6.0/engine/src/store.js)
- [Backend schema.sql](https://github.com/vahe210991-cloud/InOne-chat/blob/main/inone-development-archive-0.6.0/engine/src/schema.sql)
- [Canonical Engine B MLS client](https://github.com/vahe210991-cloud/InOne-chat/tree/main/inone-development-archive-0.6.0/engine/mobile-mls/mls-client)
- [Flutter app](https://github.com/vahe210991-cloud/InOne-chat/blob/main/mobile/lib/app/inone_mobile_app.dart)
- [Flutter API contract](https://github.com/vahe210991-cloud/InOne-chat/blob/main/mobile/API-CONTRACTS-BETA-1.md)
- [Approved WBS v1.1](https://github.com/vahe210991-cloud/InOne-chat/blob/main/development/PROGRESS-BASELINE.md)
- [Owner product decisions](https://github.com/vahe210991-cloud/InOne-chat/blob/main/docs/continuity/DECISIONS.md)

---

**Итог аудита:** исходный код не изменялся. Текущая архитектура содержит серьёзную и полезную основу для защищённых групповых сообщений, но до Beta 1.0 остаются P0/P1 security/product blockers и существенные UX, sync и acceptance gaps. Native MLS остаётся выключенным до exact-SHA и платформенной приёмки.


---

## 13. Implementation update — 2026-11-26

This section records implementation work on branch `work/chat-groups-beta1-implementation-2026-11-26`, based on `main` at `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`. The original audit findings above remain a historical snapshot of that source SHA. They are not evidence that the current implementation branch is complete.

### 13.1. Product decision: no recipient approval for personal messages

The owner clarified the intended Beta 1.0 behavior:

- A recipient does not accept or reject the chat or the first message. Direct messages are delivered without recipient approval.
- MLS KeyPackage claims, Add Commit and per-device Welcome are automatic cryptographic provisioning, not a user-facing invitation or consent workflow.
- `provisioning` is an internal backend state only. It means the MLS group has not yet completed its first membership commit. It must never be shown as a request awaiting recipient approval.
- Once the Add Commit is accepted, both paired accounts can exchange messages through the MLS-only message route.
- If the sender is not in the recipient's contact list, the first delivered message creates a separate contact prompt beside the sender's name with **Принять** and **Заблокировать**. This prompt does not delay or gate delivery.
- **Принять** adds the sender to the recipient's contacts and removes the prompt. If the sender is already in contacts, no prompt appears.
- **Заблокировать** blocks the pair, removes reciprocal contact entries and pending prompts, and prevents future direct messages/interactions. Previously delivered history remains available.
- The contact prompt is an address-book decision, not an MLS membership or message-approval decision.

### 13.2. Implemented on the working branch, not yet accepted

| Area | Current branch implementation | Acceptance state |
|---|---|---|
| Legacy member removal | `DELETE /rooms/:roomId/members/:userId` is fail-closed with `409 mls_commit_required`; membership removal must use MLS Remove Commit | Code present; tests pending |
| Legacy member addition | `POST /rooms/:roomId/members` is fail-closed with `409 mls_commit_required`; addition must use MLS Add Commit and per-device Welcome | Code present; tests pending |
| Direct conversation data | Migration `0036-direct-conversations`; canonical unordered pair, unique constraint, private non-organization room, `provisioning/active` states | Code present; PostgreSQL migration test pending |
| Chat-list summary | Server returns encrypted last-event cursor/time and per-user unread count; Flutter renders time/unread filter and clears badge after persisted read marker; no plaintext is projected | Code and regression tests present; not run |
| Direct create-or-open | Authenticated `POST /direct-chats/open`; opaque room ID; same room returned for either side of the pair | Code present; concurrency test pending |
| MLS provisioning | Only the paired recipient can be claimed and added; direct membership activates only with the claimed Add Commit/Welcome | Code present; end-to-end test pending |
| Recipient experience | Flutter treats provisioning as internal and never gates message delivery; first message from a non-contact shows **Принять**/**Заблокировать** beside the sender name | Backend contact-request state, Flutter actions and tests authored; verification pending |
| Device KeyPackages | Native Flutter app maintains a per-device KeyPackage reserve after authentication and on app resume | Code present; native runtime tests pending |
| Contact requests and blocks | First delivered message from a non-contact creates a recipient-side prompt; accept adds the sender to contacts; block prevents future direct-message delivery and clears pending prompts | PostgreSQL/memory storage, routes, room-list projection and Flutter buttons added; backend/Flutter tests authored, not run |
| Message delivery | Backend regression covers MLS message route, pre-activation fail-closed behavior and recipient retrieval; Rust/OpenMLS scenario sends while both recipient devices are offline and verifies delivery after sync without an acceptance action | Tests authored; not run |

### 13.3. Security and release constraints

- `INONE_MLS_NATIVE_ENABLED` remains `false` by default. This implementation does not authorize enabling it.
- No plaintext or non-MLS fallback is introduced.
- No server-only room membership mutation is allowed for direct conversations.
- All active recipient devices must receive a valid Welcome before the direct conversation is activated.
- A missing KeyPackage, invalid Welcome, failed Commit, or network error must fail closed and preserve durable retry/recovery semantics. It must not silently report that the message was delivered.
- Do not mark tasks complete until the implementation is merged and the relevant acceptance tests pass.
- Do not merge the implementation branch without explicit owner approval.

### 13.4. Verification status

No tests, builds, PostgreSQL migration runs, Rust checks, Flutter checks, or device acceptance runs have been executed for the current implementation head. The code and tests must first complete source review and static preflight. The final verification must run through GitHub Actions on one exact PR SHA and all failures must be resolved before release acceptance.
