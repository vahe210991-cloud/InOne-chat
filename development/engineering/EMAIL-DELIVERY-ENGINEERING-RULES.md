# Email Delivery — обязательные инженерные правила

Эти правила обязательны для backend-модулей, Identity/Registration, OneBot и всех будущих интеграций с Email Delivery.

## 1. Единая точка отправки
Все продуктовые письма отправляются через внутренний Email Delivery Service. Никакой route, бот или отдельный сервис не подключается к SMTP напрямую.

## 2. Разделение ответственности
Identity/Registration создаёт и проверяет одноразовые коды и токены. Email Delivery отвечает только за доставку, шаблоны, очередь и статус.

## 3. Не передавать SMTP credentials
SMTP host/user/password/from и encryption key доступны только серверной конфигурации Email Delivery. Их запрещено передавать ботам, мобильным клиентам, WebView или внешним интеграциям.

## 4. Только типизированный внутренний интерфейс
Вызывающий модуль передаёт recipient, template ID, variables, locale и idempotency key. Произвольный transport configuration от вызывающего модуля не принимается.

## 5. Шаблоны вместо inline-текстов
Используются именованные, версионированные шаблоны. Язык каждого письма обязан совпадать с выбранным пользователем языком интерфейса (`hy`, `ru` или `en`), а не с языком ОС и не с глобальным default. Для регистрации клиент передаёт locale при запросе кода; backend сохраняет его в pending email-code state и переносит в профиль при создании аккаунта. Для существующего аккаунта источник истины — locale профиля, обновляемый через `PATCH /profile/locale`. Если язык был изменён до входа, клиент передаёт pending locale в `/login`; после успешной проверки credentials backend сохраняет его до постановки login-security писем. Pre-auth recovery endpoints принимают locale события (`/recovery/start`, `/recovery/cancel-by-code`, `/recovery/complete`) и не меняют профильную настройку. Locale фиксируется в зашифрованном payload при enqueue, поэтому изменение настройки не меняет уже поставленные в очередь письма. `hy` допускается только как fallback для legacy-аккаунтов/клиентов без сохранённой настройки; внутренний delivery boundary и durable queue требуют явный locale и отклоняют отсутствующие или неподдерживаемые значения. Все шаблоны обязаны содержать plain-text и HTML альтернативы. HTML должен следовать исходному `InOne-mobile-design-system-curated.html`: не изобретать новые brand tokens, палитру, типографику, логотип или компоненты. Динамические значения проходят проверку типа, размера, управляющих символов и HTML escaping; ссылки допускаются только по HTTPS. Subject не может содержать CR/LF. Визуальный preview всех шаблонов должен быть представлен владельцу и утверждён до production acceptance.

## 6. Durable queue в production
Production использует PostgreSQL queue. In-memory mailbox разрешён только в тестах и локальной разработке; production должен fail closed, если SMTP или encryption key не настроены.

## 7. Шифрование payload at rest
Recipient, subject и body хранятся только в AES-256-GCM encrypted payload. Nonce уникален на каждую запись; authentication tag обязателен; AAD связывает payload с idempotency hash. Ключ — 32 случайных байта из secret manager; HKDF-SHA256 выводит независимые subkeys для AES-GCM и HMAC. Текущая процедура ротации drain-and-purge описана в `EMAIL-DELIVERY-OPERATIONS.md`; замена ключа при наличии pending rows запрещена.

## 8. Идемпотентность обязательна
Каждая delivery получает idempotency key, связанный с конкретным событием и получателем. Повтор того же ключа с тем же payload возвращает существующую запись. В БД хранится только HMAC-SHA256 idempotency key с отдельным HKDF subkey. Повтор того же ключа с другим payload отклоняется. Сырые ключи не сохраняются.

## 9. Независимая доставка получателям
Каждый recipient — отдельная запись. Ошибка доставки на резервный адрес не должна отменять постановку письма на основной адрес и наоборот.

## 10. Ограниченные повторы
Временные сетевые ошибки повторяются с bounded exponential backoff и jitter. Ошибки аутентификации и некорректного адресата являются permanent и переводятся в dead-letter. Количество попыток ограничено конфигурацией.

## 11. Срок годности
Коды и recovery links не должны доставляться после истечения срока их действия. TTL задаётся шаблоном/событием. Просроченные сообщения переводятся в dead-letter без отправки.

## 12. Безопасные логи
Запрещено журналировать recipient, subject/body, verification codes, recovery tokens/links, SMTP credentials, encryption keys и полный SMTP error object. Логируются только delivery ID, безопасная категория ошибки, attempt count и provider message ID при наличии.

## 13. Жизненный цикл процесса
При graceful shutdown worker прекращает брать новые записи, ожидает текущую активную работу в пределах shutdown policy, закрывает SMTP transport и только после этого закрывается PostgreSQL pool. Durable pending records не удаляются при остановке.

## 14. Тестирование и acceptance
Изменение Email Delivery сопровождается unit и PostgreSQL integration tests: шаблоны, validation, idempotency, payload encryption, restart recovery, retries, permanent errors, expiry, multi-recipient independence, secret leakage и shutdown. Результат принимается только при PASS на exact final SHA. Незапущенные тесты обозначаются NOT RUN, а не PASS.

## 15. Каналы и расширяемость
Email Delivery не становится обязательным посредником для SMS, push или иных каналов. Новый transport (например Email API) добавляется как адаптер того же интерфейса и только после отдельной оценки необходимости.

## 16. Transactional consistency
Для критических бизнес-событий enqueue атомарен с изменением бизнес-состояния через PostgreSQL transaction/outbox boundary. Использовать transactional hooks store для registration/backup-email/step-up/recovery/new-device flows; запрещено заменять их последовательными независимыми запросами. Любой новый critical mail use case должен добавить store-level transaction hook и rollback test до подключения route.

## 17. Retention и удаление
Отправленные и dead-letter записи очищаются по ограниченной retention policy. Payload не копируется в application logs, analytics или внешние telemetry tags. Rotation/deletion процедуры для encryption key и backups должны учитывать возможность восстановления очереди.

## 18. Внешние интеграции и боты
OneBot и будущие боты используют только внутренний Email Delivery interface с разрешёнными template IDs/scopes. Нельзя предоставлять ботам API для произвольного subject/body, bulk mailing или произвольного выбора получателей без отдельного security review.
