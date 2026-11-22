# ADR-004 — Единая система push-уведомлений InOne

- **Статус:** Accepted — архитектурная основа этапа push delivery
- **Дата:** 2026-11-21
- **Область:** InOne Beta 1.0 backend, Flutter Android/iOS
- **Репозиторий:** `vahe210991-cloud/InOne-chat`
- **Базовая ветка:** `main` после PR #106

## Контекст и исходные ограничения

В PR #106 подключены Firebase Core / Firebase Messaging и регистрация Firebase Installation ID (FID) через аутентифицированный API текущего устройства. Это регистрация адреса установки, а не система доставки.

Существующая реализация также содержит:
- `InOnePushRepository` и `InOnePushLifecycle`;
- `PUT /devices/me/push` и `DELETE /devices/me/push`;
- таблицу `push_tokens` (миграция `0017-push.sql`);
- удаление регистрации при logout и отзыве устройства;
- минимальное событие для нового сообщения;
- внедряемый `pushSender` и тестовый recorder в `engine/test/push.test.js`.

В текущем коде отправка вызывается из request path, а не через durable push worker. Мобильная реализация пока не содержит полного foreground/background/terminated receive и tap routing pipeline.

Существующая Email Delivery (ADR-003) уже демонстрирует в этом backend PostgreSQL queue pattern: `FOR UPDATE SKIP LOCKED`, lease/worker ownership, bounded retries, exponential backoff with jitter, dead-letter, graceful shutdown, encrypted payload, idempotency. Push использует эти эксплуатационные принципы, но **не** таблицу email и **не** email transport/service.

## Решения

### 1. FCM FID — официальный целевой механизм

Использовать Firebase Admin Node.js SDK `getMessaging().send(message)` с полем `fid`. Реализация использует отдельный production bootstrap `createFirebaseAdminPushSender` и adapter `createFcmPushSender`.

Data allowlist: `type`, `event_id`, `path`. Для фонового отображения разрешён только фиксированный нейтральный notification envelope `title=InOne`, `body=New message`; в нём нет имени отправителя, названия комнаты или содержимого. Никакие приватные значения в notification title/body не передаются.

Официальная документация Firebase прямо поддерживает адресацию FID в Admin SDK и рекомендует `fid`; поле `token` устаревает, хотя в период миграции принимает FID. Не передавать 22-символьный FID как обычный registration token и не вызывать API, который принимает только классические FCM tokens.

Ограничения:
- FID должен быть получен из Firebase client SDK для той же Firebase app/project и соответствующей установки.
- FID может смениться или стать недействительным; события unregister/ошибки провайдера должны удалять только совпадающую текущую регистрацию.
- Успешный ответ Admin SDK означает принятие сообщения FCM, а не подтверждение показа/прочтения на устройстве.
- Не использовать Firebase topics для приватных чатов или групп без отдельной модели авторизации.

Ссылки:
- https://firebase.google.com/docs/cloud-messaging/send/admin-sdk
- https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.fidmessage.md
- https://firebase.google.com/docs/projects/manage-installations

### 2. iOS транспорт: FCM → APNs, не второй независимый sender

Для текущей модели FID использовать FCM как единый транспорт и настроить Firebase project с APNs Authentication Key. Firebase маршрутизирует iOS push через APNs. Поэтому первичная реализация **не** вводит параллельный прямой APNs sender: он не нужен для FID адресации и усложнил бы согласование идентификаторов, retries и статусов.

Для iOS проверить и документировать:
- APNs .p8, Key ID, Apple Team ID и Bundle ID;
- Firebase Console APNs credentials;
- provisioning/signing capabilities и Push Notifications entitlement;
- development/production APNs environment;
- реальную доставку на физическом iOS устройстве.

Прямой APNs transport допускается только отдельным ADR/обоснованием для платформенных сценариев, которые невозможно корректно выполнить через FCM. Приватный .p8 никогда не попадает в Git или мобильный пакет.

### 3. Единая бизнес-служба и transport adapter

Текущая реализация использует внутренний контракт `createPushDelivery`:
- `encryptRegistrationId(fid, deviceKey)`;
- `backfillLegacyRegistrations()`;
- `enqueueRoomEvent(transaction, { roomId, eventId, excludeDeviceKey })` — вызывается только из транзакции записи реального MLS room event;
- `start()`, `tick()`, `stop()` для worker lifecycle.

Расширение до user/group bulk enqueue допускается только после отдельного подтверждения реальных event producers и capability/permission на стороне backend.
- подавление по пользовательским настройкам, системной готовности и актуальному состоянию устройства;
- отмена ещё не отправленных задач;
- безопасный результат по каждому получателю.

Служба отвечает за выбор получателей, авторизацию инициатора, типы событий, настройки, идемпотентность, очередь, retry, статусы и аудит. Транспортный интерфейс отделён: начальная реализация — `FcmPushSender` с адресацией `fid`. APNs — нижележащий транспорт FCM для iOS, а не отдельная бизнес-ветка.

Групповая отправка — не публичный endpoint и не доверие переданному клиентом списку user IDs. Получатели вычисляются сервером из реального события/состава участников и прав инициатора.

### 4. Durable queue и транзакционные границы

Использовать PostgreSQL и worker pattern, уже применённый Email Delivery, со своей таблицей `push_deliveries`. Не добавлять Redis/новую инфраструктуру только ради push.

Обязательные свойства:
- атомарный enqueue относительно фиксации исходного события через тот же PostgreSQL transaction/outbox boundary;
- уникальный idempotency key на исходное событие + device target + notification kind;
- claim batch через `FOR UPDATE SKIP LOCKED`;
- lease, worker ID и восстановление просроченного lease после рестарта;
- ограниченное число попыток и exponential backoff с jitter;
- временные ошибки повторяются, permanent/invalid target — terminal;
- dead-letter status с безопасным кодом ошибки;
- graceful shutdown перестаёт брать новые задачи и освобождает/оставляет восстанавливаемые leases;
- TTL и cleanup для старых terminal записей;
- недоступность очереди не должна превращать успешное сохранение сообщения в ложное подтверждение постановки уведомления.

**Транзакционный gate:** до реализации проверить фактическую транзакционную границу сохранения MLS event в текущем backend. Нельзя называть enqueue атомарным, если event и push outbox записываются разными транзакциями или в разных хранилищах. Если текущий путь события не предоставляет общего PostgreSQL transaction, сначала выделить минимальный store operation/outbox hook, либо документировать и покрыть reconciliation/retry окно; не заявлять гарантию, которой код не обеспечивает.

Семантика доставки — at-least-once до принятия провайдером. Exactly-once у внешнего FCM/APNs не обещается. Сбой после принятия провайдером, но до фиксации статуса, может дать повтор; клиент обязан дедуплицировать событие.

### 5. Статусы и модель результата

Разделять состояния:
- `queued` — durable запись готова к обработке;
- `processing` — worker получил lease;
- `provider_accepted` — FCM вернул message ID;
- `failed` — временная ошибка, ожидается retry;
- `dead` — окончательная ошибка / исчерпаны попытки;
- `cancelled` — отправка подавлена до передачи провайдеру.

Внешний API/админ-диагностика не должен называть `provider_accepted` доставкой на устройство или показом. Хранить provider message ID, безопасный error code, attempt count и временные метки. Не сохранять произвольные provider error strings в публичных ответах/логах.

### 6. Payload и модель конфиденциальности

Data payload содержит минимальный allowlist полей:
- `type` — тип события из allowlist;
- `event_id` — opaque event identifier;
- `path` — безопасный относительный route/opaque reference, только если он допустим моделью авторизации.

FCM также получает фиксированный нейтральный системный notification envelope (`InOne` / `New message`) для отображения ОС в background/terminated состоянии. Он не содержит приватной информации и не заменяет data allowlist.

Не передавать:
- MLS plaintext, имя/текст сообщения, preview, вложения;
- MLS ciphertext или ключевой материал;
- access/refresh tokens, FID в payload, пароли, PIN, recovery codes;
- чувствительные названия комнат/организаций, если они не являются публичными.

Для сообщения push означает только «есть новое событие». Приложение после проверки актуальной сессии обращается к существующему authenticated API, получает MLS-событие и передаёт его в существующий MLS runtime. Push не меняет MLS protocol и не является источником истины.

На lock screen системное отображение нейтральное (без содержания сообщения). Для background/terminated платформенных ограничений payload и приоритеты должны быть проверены отдельно; silent/background push не гарантирует пробуждение приложения.

### 7. Device binding, logout и revoke

- Каждая доставка адресуется device_key, а не только user_id.
- Перед claim/send проверяется, что устройство активно, принадлежит получателю и его текущая регистрация всё ещё совпадает с target snapshot.
- Logout/revoke удаляет или инвалидирует регистрацию и отменяет все ещё не отправленные задания этого device_key.
- Ошибка «FID not found / unregistered» удаляет только регистрацию с тем же device_key + идентификатором/версией, чтобы не стереть новую ротацию FID.
- Повторная авторизация создаёт/обновляет только текущую регистрацию устройства.
- Уведомления не отправляются отозванным, вышедшим или неактивным устройствам.
- API регистрации остаётся аутентифицированным и device-scoped; клиент не может указать чужой device_key/user_id.

Для защиты registration identifier at rest использовать отдельный secret `INONE_PUSH_ENCRYPTION_KEY` (32 bytes) и AES-256-GCM с уникальным nonce. Не переиспользовать email encryption key и PIN pepper. Миграция существующих открытых записей должна выполняться безопасным backfill при наличии ключа, без логирования FID; нельзя молча терять старые регистрации.

### 8. События и настройки

Реализовать только события, уже реально создаваемые backend:
- новое MLS-событие в комнате (первый поддерживаемый сценарий);
- новые устройства / отзыв устройств / безопасность — только если соответствующие backend events уже существуют и payload разрешён.

Ответ/упоминание, звонки, приглашения и организации добавлять только после подтверждения реальных event producers и прав доступа. Не создавать фиктивные события.

В текущем срезе enqueue управляется существующим глобальным feature flag `push.enabled`, активной FID-регистрацией устройства и OS permission/readiness lifecycle на клиенте. Полные серверные category preferences и per-room mute пока не реализованы и остаются отдельным acceptance item; не считать их завершёнными. OS permission остаётся advisory для backend, поскольку сервер не может достоверно читать текущее разрешение ОС.

### 9. Flutter receive и routing

Сохранить существующий `InOnePushLifecycle` как owner регистрации. Добавить отдельный единый `InOnePushHandler`/router:
- foreground: получить событие, проверить сессию и дедупликацию; не показывать чувствительный текст;
- background: top-level Firebase background handler, только безопасная запись/сигнализация, без обращения к незапущенному UI/MLS runtime;
- tap: обработать `onMessageOpenedApp` и `getInitialMessage()`;
- terminated: после восстановления сессии выполнить authenticated fetch и только затем открыть нужный экран;
- logout/revoke: очистить отложенную навигацию и локальные pending IDs;
- неизвестные версии/типы/поля — игнорировать безопасно.

Маршрутизация должна использовать существующий app navigation/recovery patterns. Push не должен обходить ACL, членство в комнате, session checks или MLS processing. Дублированный event_id обрабатывается идемпотентно.

### 10. Configuration и secrets

Server config:
- Firebase project ID;
- service account через workload identity / ADC предпочтительно; иначе JSON credentials только из secret manager/GitHub Secrets;
- отдельный `INONE_PUSH_ENCRYPTION_KEY`;
- worker polling/batch/lease/retry/TTL параметры с безопасными пределами.

Apple/Firebase setup:
- APNs .p8, Key ID, Team ID, Bundle ID и environment вводятся в Firebase Console/Apple Developer и secrets store;
- реальные ключи/JSON не коммитятся;
- локальные тесты используют fake sender; реальные smoke tests — отдельный Firebase project и тестовые устройства.

### 11. Наблюдаемость и приватность

Разрешены только event ID, delivery ID, device key hash, provider, status, attempt, latency и allowlisted error code. Запрещено логировать FID, APNs token, содержимое push, MLS data, auth credentials и service account JSON.

Metrics: queue depth/age, send success/error classes, retries, dead letters, invalid registrations, worker lease recovery. Доступ к operational details ограничить серверными правами.

## План реализации и фактическое состояние

1. [x] Проверена транзакционная граница MLS event и server startup/config; push outbox callback встроен в транзакции обычного и `clientMessageId` пути.
2. [x] Добавлена миграция 0032, AES-256-GCM шифрование FID/payload и startup backfill legacy identifiers.
3. [x] Добавлен FCM Admin sender с FID addressing и отдельный PostgreSQL worker/outbox.
4. [x] Message notification producer перенесён с HTTP request path в transactional enqueue.
5. [ ] Полные category/per-room user preferences и cross-device synchronization.
6. [x] Добавлены Flutter foreground/background/tap/terminated handlers и authenticated, MLS-gated navigation. Реальное открытие содержимого зависит от включённого native MLS session.
7. [x] Сгенерируемая iOS конфигурация включает APNs entitlement/background mode; APNs .p8 upload, Apple signing и физические smoke tests требуют owner credentials/device.
8. [ ] Полные Node/PostgreSQL/Flutter/native CI проверки должны пройти на одном точном SHA; после этого физические Android/iOS delivery tests. PR остаётся draft до полного acceptance.

## Acceptance gates

- [ ] FCM Admin SDK отправляет по `fid`, не по legacy `token`.
- [ ] Подтверждена адресация FID на Android и iOS через FCM/APNs.
- [ ] Push queue durable, lease/restart-safe, idempotent, bounded retry и dead-letter.
- [ ] Транзакционная гарантия enqueue соответствует реальной транзакции исходного события.
- [ ] FID/registration identifier encrypted at rest; legacy backfill проверен.
- [ ] Logout/revoke исключают будущую отправку на старую регистрацию.
- [ ] Payload не содержит MLS plaintext/ciphertext/секретов.
- [ ] Android/iOS foreground, background, terminated и tap flows покрыты тестами.
- [ ] Authenticated fetch и MLS обработка остаются единственным способом получить содержание сообщения.
- [ ] Настройки пользователя отделены от разрешений ОС и синхронизируются.
- [ ] Unit, PostgreSQL integration, Flutter, native build и security tests PASS.
- [ ] Реальная доставка подтверждена отдельно на физическом Android и iOS устройстве.
