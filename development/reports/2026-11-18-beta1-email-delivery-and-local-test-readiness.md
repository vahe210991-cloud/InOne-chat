# Beta 1.0 — Email Delivery: code review и подготовка интеграции в main

**Актуализация:** 2026-11-18  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Рабочая ветка:** `feature/email-delivery-service-2026-11-16-b1`  
**Интеграционный PR:** [#79](https://github.com/vahe210991-cloud/InOne-chat/pull/79)  
**Stacked implementation PR:** [#61](https://github.com/vahe210991-cloud/InOne-chat/pull/61)  
**Текущий проверенный HEAD:** `d5b91549bef794692451a96a638bde793b632365`  
**Base main:** `d9d699f1c7e27107123c8a019a780f7060531a08`

## 1. Решение владельца — критерии Beta 1.0

Цель Beta 1.0 по Email Delivery — **фактически получить все письма от всех подключённых служб для каждого предусмотренного сценария**. Проверка должна подтвердить реальную доставку до контролируемого почтового ящика/устройства, а не только постановку в очередь или успешный ответ SMTP transport.

- Визуальный вид писем не является критерием приёмки Beta 1.0.
- Корректность адресата, назначения, содержимого, языка, срока действия кодов/ссылок и фактическое получение — являются.
- Все шаблоны должны стать редактируемыми из административной панели, но это последующий этап, не Beta 1.0.
- Проверки на реальных устройствах и почтовых клиентах проводятся в рамках Beta 1.0. Они не выдаются за уже выполненные.
- Текущий preview — технический draft; его визуальное утверждение не требуется для merge.

## 2. Git / PR состояние на момент проверки

PR #79 направлен из `feature/email-delivery-service-2026-11-16-b1` непосредственно в `main`.

- PR state: open, Draft.
- Source HEAD: `d5b91549bef794692451a96a638bde793b632365`.
- Base main: `d9d699f1c7e27107123c8a019a780f7060531a08`.
- Compare: 626 commits ahead / 0 behind.
- Changed files: 129; additions: 17,859; deletions: 584.
- GitHub mergeable: true.
- Main не изменён; PR не слит.
- Review submissions: отсутствуют; inline review threads: отсутствуют.

626 коммитов — накопленная история Beta 1.0, а не только Email Delivery. Ветка включает Backend, Email Delivery, Flutter, Rust/OpenMLS MLS runtime, secure storage, recovery/session, screen/API integration, tests, CI и документацию. Для переноса истории сохраняем обычный merge commit; не используем squash/rebase/cherry-pick.

## 3. Проверка Email Delivery implementation

Изучены текущие исходники и связанные материалы:
- `engine/src/email-delivery.js`;
- `engine/src/email-templates.js`;
- `engine/src/mail-smtp.js`;
- `engine/src/config.js`, `main.js`, `server.js`;
- `engine/src/store.js`, `store-memory.js`;
- миграции `0029`, `0030`, `0031`;
- email delivery, registration delivery, templates и SMTP tests;
- ADR, design proposal, operations guide и текущий stage report;
- email validation workflow.

### Подтверждённые свойства реализации

- PostgreSQL durable outbox; SMTP worker запускается вместе с Backend при SMTP-конфигурации.
- Адрес получателя и тело письма шифруются AES-256-GCM; HKDF разделяет encryption/HMAC subkeys.
- Idempotency и payload fingerprint защищены HMAC.
- Enqueue для критических сценариев выполняется в той же PostgreSQL-транзакции, что и изменение бизнес-состояния.
- Worker использует lease/claim, retry с backoff+jitter, expiry и dead-letter.
- SMTP transport требует TLS 1.2+; production запрещает memory transport.
- Логи не должны содержать адреса, коды, ссылки, содержимое или credentials.
- Delivery semantics — at-least-once, не exactly-once: после неопределённого исхода SMTP возможна повторная отправка.

### Каталог email-сценариев

В renderer присутствуют 14 шаблонов:
1. `registration_code`
2. `backup_email_verification`
3. `backup_email_changed`
4. `backup_email_removed`
5. `stepup_code`
6. `old_devices_revoked`
7. `recovery_login_code`
8. `new_device_wait`
9. `recovery_code`
10. `recovery_requested`
11. `recovery_confirmation_link`
12. `recovery_cancelled`
13. `recovery_completed`
14. (каталог содержит 13 фактически перечисленных template IDs; число в preview/дизайн-документах необходимо привести к фактическому каталогу — см. замечание ниже).

Поддерживаемые локали: `hy`, `ru`, `en`. Рендерер формирует plain-text и HTML. Recovery URLs проверяются на HTTPS, HTML-значения экранируются.

Основные связанные бизнес-потоки, найденные в Backend:
- регистрационный код;
- подтверждение резервной почты, уведомление об изменении/удалении;
- step-up confirmation;
- проверка личности при входе и ожидание нового устройства;
- код восстановления, уведомления о старте, ссылка подтверждения;
- отмена и завершение восстановления;
- отключение старых устройств после восстановления.

Наличие route/call-site и зелёных тестов подтверждает реализацию на уровне исходников/автоматизированных сценариев, но не фактическое получение каждого письма на реальном почтовом ящике.

## 4. Миграции и хранение

- `0029-email-delivery.sql`: durable encrypted queue, unique idempotency key, lifecycle status, leases, retry timestamps, provider message ID, expiry и индексы.
- `0030-profile-email-locale.sql`: locale профиля и pending email code с ограничением `hy/ru/en`.
- `0031-file-upload-device-binding.sql`: привязка незавершённых загрузок к устройству; не является email migration, но входит в общий Beta 1.0 diff.
- Migration runner сортирует версии, применяет миграции транзакционно и использует advisory lock. Новая схема синхронизирована до `0031-file-upload-device-binding`.

Проверки migration/DB входят в CI. Перед merge нужно сохранить exact-head evidence; локальная production база не затрагивалась.

## 5. SMTP evidence и его ограничения

Владелец выполнил отдельный Windows Node.js → Brevo SMTP test:
- `SEND=PASS`;
- `ELAPSED_MS=1019`;
- SMTP host `smtp-relay.brevo.com`, port 587;
- STARTTLS, Nodemailer `secure: false`, `requireTLS: true`, TLS minimum 1.2.

Это доказывает передачу отдельного тестового письма из Node.js через Brevo. Это не InOne Backend E2E и не доказывает получение всех сценариев/служб. Не подтверждены SPF/DKIM/DMARC, bounce processing и реальная работа production deployment. SMTP key не должен попадать в Git/документацию/логи; при раскрытии требуется ротация.

## 6. CI на точном HEAD

На exact HEAD `d5b91549bef794692451a96a638bde793b632365` четыре обязательных направления завершились PASS:
- Email delivery and PostgreSQL validation — [run 44243910377](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44243910377).
- Validate recovered InOne P0 source — [run 44243910364](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44243910364).
- Native MLS client validation — [run 44243910690](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44243910690).
- Flutter mobile validation — [run 44243910304](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44243910304).

В jobs этих workflow проверены Node engine suite, PostgreSQL migration/email queue tests, production dependency audit, Rust/OpenMLS/FRB, iOS native target build, Flutter analyze/test и Android preview APK build. Успешные CI jobs не заменяют Beta 1.0 real mailbox/device acceptance.

## 7. Замечания review / операционные ограничения

1. **SMTP acceptance ≠ mailbox delivery.** SMTP transport отмечает `sent` после успешного `sendMail`; это означает принятие сообщения SMTP сервером, а не доказательство, что оно попало во входящие. Beta 1.0 должна сверять фактическое получение.
2. **At-least-once.** Возможна повторная доставка при сбое после SMTP acceptance до фиксации статуса.
3. **Dead-letter recovery.** Ошибки auth/envelope классифицируются как permanent и переходят в `dead`. После исправления конфигурации такие записи требуют контролируемого повторного enqueue/requeue. Перед эксплуатацией нужна документированная операторская процедура и тест восстановления; не делать слепой массовый reset всех dead rows.
4. **Single active encryption key.** Versioned key ring не реализован; rotation только drain-and-purge, по текущему operations guide.
5. **Template administration.** UI/редактор шаблонов отсутствует и не входит в Beta 1.0. Это отдельная последующая задача с audit/versioning.
6. **Documentation count drift.** Документы дизайна ранее указывали 13 шаблонов; фактический renderer содержит 13 template IDs. Число и перечень следует синхронизировать в одном источнике истины. (В перечне выше — 13 ID.)
7. **Full system diff.** PR объединяет 129 файлов и 626 коммитов; email subsystem и связанные интеграции проверены предметно. До перевода PR из Draft требуется завершить финальный проход по оставшимся Flutter/Rust/OpenMLS/CI/docs изменениям и зафиксировать любые найденные блокеры.

## 8. Отложенные проверки Beta 1.0

В Beta 1.0 выполнить матрицу фактической доставки:
- каждый из 13 template IDs;
- каждая поддерживаемая локаль, где она применима;
- каждый инициирующий сервис/route;
- основной и резервный адресаты, если сценарий предусматривает обоих;
- правильный адресат, текст/plain-text, ссылка/код, срок действия;
- подтверждение появления письма в реальном ящике/устройстве;
- повторные отправки, временный сбой SMTP, постоянная ошибка, истечение TTL и восстановление dead-letter;
- проверка inbox/spam и provider events, где доступны.

Параллельно Beta 1.0 включает проверку мобильного приложения на реальных устройствах. До её выполнения не утверждать, что вся Beta 1.0 acceptance завершена.

## 9. План подготовки к merge

1. Завершить полный review всех 129 файлов относительно актуального `main`.
2. Устранить только реальные блокирующие дефекты; не расширять Beta 1.0 объём на визуальный редактор или admin template UI.
3. Синхронизировать ADR/operations/report/PR description с решением владельца.
4. Проверить точный HEAD и повторить CI после любых изменений.
5. Убедиться, что нет секретов и блокирующих review threads.
6. Перевести PR #79 из Draft в Ready только после завершения review и проверок.
7. Слить обычным merge commit с сохранением commit graph, после подтверждения владельцем.
8. После merge проверить `main`, exact merge SHA и CI.

PR #79 пока не слит. GitHub `mergeable=true` не заменяет code review и approval.

---
Этот отчёт разделяет доказанные исходниками/CI факты, отдельный SMTP smoke test и будущую фактическую Beta 1.0 приёмку. Он не утверждает, что все письма уже реально получены.
