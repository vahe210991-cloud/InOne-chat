# Email Delivery — эксплуатация и ключи

## Переменные production

Production требует:
- PostgreSQL и применение миграции `0029-email-delivery`;
- `INONE_MAIL_TRANSPORT=smtp`;
- `INONE_SMTP_HOST`, `INONE_SMTP_PORT`, `INONE_SMTP_FROM`;
- `INONE_SMTP_REQUIRE_TLS=true`;
- SMTP credentials парой: `INONE_SMTP_USER` и `INONE_SMTP_PASSWORD`, либо оба пустые, если сервер использует IP allowlist;
- `INONE_EMAIL_ENCRYPTION_KEY`: ровно 32 случайных байта в hex (64 символа) или корректном base64;
- `INONE_EMAIL_WORKER_POLL_MS` (250–60000, default 1000);
- `INONE_EMAIL_MAX_ATTEMPTS` (1–20, default 8).

Генерировать master key можно, например, командой `openssl rand -hex 32`. Ключ хранится только в secret manager. Не использовать `PIN_PEPPER`, пароль SMTP или другой ключ приложения. Из master key через HKDF-SHA256 выводятся независимые subkeys для AES-256-GCM payload encryption, HMAC payload fingerprint и HMAC idempotency key.

Локальная разработка по умолчанию использует `INONE_MAIL_TRANSPORT=memory`. Этот transport запрещён в production.

## Queue lifecycle

- `queued`: ожидает наступления `available_at`.
- `processing`: зарезервирована worker lease на 60 секунд.
- `sent`: SMTP принял сообщение; сохраняется provider message ID, если он предоставлен.
- `dead`: permanent failure, исчерпаны повторы, повреждён payload или истёк TTL.

Transient SMTP errors повторяются с exponential backoff + jitter, максимум 1 час между попытками. Ошибки auth/envelope — permanent. Payload удаляется через 30 дней после terminal status. Коды и recovery links имеют короткий TTL; просроченные записи не отправляются.

Доставка — at-least-once, не exactly-once. Если SMTP принял письмо, а процесс упал до записи `sent`, повтор после истечения lease возможен. Idempotency гарантирует дедупликацию enqueue при одинаковом ключе и payload, но не заменяет idempotency внешнего SMTP.

## Проверка состояния

Внутренний метод `emailDelivery.stats()` возвращает только счётчики по status. Не включать recipient, subject, body, codes, links или SMTP credentials в metrics/log labels.

Для диагностики БД допустимы агрегаты:

```sql
SELECT status, count(*) FROM email_deliveries GROUP BY status ORDER BY status;
SELECT last_error_code, count(*) FROM email_deliveries WHERE status = 'dead' GROUP BY last_error_code;
```

Не выгружать `payload_ciphertext`, nonce, tag или payload fingerprint в тикеты/логи.

## Плановая ротация ключа (текущая модель: один активный ключ)

Multi-key decryption/key-ring пока не реализован. Поэтому rotation выполняется только через drain-and-purge:

1. Включить maintenance/read-only режим для всех producers, которые ставят email в очередь.
2. Дать worker завершить все уже поставленные задачи; дождаться нулевых `queued` и `processing` counts, не отключая worker до опустошения очереди.
3. Дождаться завершения текущих HTTP requests и остановить worker через graceful shutdown. Повторно проверить, что в `email_deliveries` нет `queued` или `processing`. Не продолжать ротацию, если есть pending delivery: сначала доставить или принять отдельное решение по её отмене.
4. После проверки выгрузить только агрегированные counts, затем удалить terminal rows (`sent` и `dead`), чтобы старые idempotency records не сравнивались новым HMAC key.
5. Установить новый случайный 32-byte key в secret manager и deployment environment. Не передавать ключ через чат, PR, CI output или commit.
6. Запустить backend, проверить startup/migrations, затем поставить и доставить одно тестовое письмо на контролируемый адрес.
7. Сохранить старый key в secret manager до истечения срока всех резервных копий БД, содержащих прежние encrypted payloads. Не удалять его раньше, чем завершится backup retention window.
8. Выключить maintenance mode и проверить агрегированные queue counters.

Если требуется ротация без остановки и purge, сначала реализовать versioned key ring, поле key version в queue, dual-key decrypt и тесты восстановления старых записей. Нельзя просто заменить environment key при наличии encrypted queue rows.

## Восстановление dead-letter после исправления SMTP

Permanent SMTP errors (например, `auth` или `envelope`) переводятся в `dead` и автоматически не повторяются. Сейчас отдельного административного requeue API/экрана нет. Не считать исправление SMTP credentials достаточным для повторной отправки уже dead-lettered сообщений.

После устранения причины и подтверждения SMTP smoke test оператор может вручную переотправить только выбранные, ещё не истёкшие записи. Сначала проверить агрегаты и конкретные ID без чтения encrypted payload:

```sql
SELECT id, status, attempts, last_error_code, expires_at
FROM email_deliveries
WHERE status = 'dead'
  AND last_error_code IN ('auth', 'connection', 'transport_error')
  AND expires_at > now()
ORDER BY id;
```

После ручной сверки списка и подтверждения, что причина устранена, разрешён точечный requeue по заранее проверенным ID:

```sql
UPDATE email_deliveries
SET status = 'queued',
    attempts = 0,
    available_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = NULL,
    updated_at = now()
WHERE id = ANY(ARRAY[12345, 12346]::bigint[]) -- replace with explicitly reviewed delivery IDs
  AND status = 'dead'
  AND last_error_code IN ('auth', 'connection', 'transport_error')
  AND expires_at > now()
RETURNING id, status, attempts, expires_at;
```

Не выполнять массовый reset всех `dead` записей: среди них могут быть неверные адреса, повреждённые payload и просроченные одноразовые коды. Для `envelope` сначала проверить и исправить адрес/получателя через исходный бизнес-сценарий; не повторять его вслепую. Для `payload_integrity` и `expired` requeue запрещён. В Beta 1.0 процедуру выполнять только под контролем оператора и фиксировать delivery ID и результат фактического получения без записи адресов/кодов в общий лог.

## Runtime acceptance

Перед production:
- `npm test` PASS;
- `npm run test:db` PASS с PostgreSQL;
- отдельная SMTP smoke test на контролируемом адресе;
- проверить DNS SPF, DKIM, DMARC, bounce handling и provider limits;
- проверить shutdown, queue restart, retries, expired messages и секреты в логах на exact commit SHA.

## Проверка в GitHub Codespaces

Тестирование выполняется из актуального checkout PR #61; локальный клон на рабочем компьютере не требуется. Перед запуском убедиться, что Codespaces открыт на ветке `feature/email-delivery-service-2026-11-16-b1` и SHA совпадает с SHA в PR.

### Backend / Node

Из корня репозитория:

```bash
cd inone-development-archive-0.6.0/engine
node --version
npm ci
npm audit
npm test
```

Требуется Node.js 22 или новее. `npm test` использует memory/test transports и не отправляет реальные письма.

### PostgreSQL integration

Нужен доступный PostgreSQL 16. Перед запуском задать `DATABASE_URL` для отдельной тестовой базы; пользователь БД должен иметь право создавать и удалять схемы. Тесты создают уникальную схему на каждый test case и удаляют её после завершения.

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/TEST_DATABASE'
npm run test:db
```

Не использовать production database. Не записывать credentials в файлы репозитория, shell history общего Codespace или PR.

### Flutter / mobile

Из корня репозитория:

```bash
cd mobile
flutter --version
flutter pub get
flutter analyze
flutter test
```

Валидация Email Delivery считается полной только после PASS всех трёх групп: Node, PostgreSQL integration и Flutter. Зафиксировать точный commit SHA и полный итоговый счётчик passed/failed/skipped. Любой FAIL исправить в этой же PR-ветке и повторить затронутые группы на новом SHA.

SMTP smoke test и SPF/DKIM/DMARC выполняются отдельно после выбора владельцем домена и SMTP-провайдера; они не являются блокирующим условием для начала автоматизированных тестов.


## Сквозной тест регистрации с реальным почтовым ящиком

Регистрация уже использует единый маршрут доставки: `POST /register/email` ставит письмо с кодом в PostgreSQL outbox в той же транзакции, `email-delivery` доставляет его через SMTP, `POST /register/email/confirm` проверяет код и выдаёт одноразовый registration token. `POST /register` использует этот токен для создания аккаунта.

Для проверки на реально работающем окружении с PostgreSQL и SMTP (не на memory transport):

1. Убедиться, что backend работает с `INONE_REGISTRATION_MODE=verified`, `INONE_MAIL_TRANSPORT=smtp`, обязательным TLS и корректными секретами в secret manager. Не включать `INONE_DEV_EMAIL_CODE`.
2. Использовать отдельный, ещё не зарегистрированный тестовый почтовый ящик. Не использовать адрес реального пользователя без его согласия.
3. Из каталога engine задать адрес развёрнутого HTTPS API и тестовый email, затем запустить:

```bash
INONE_SMOKE_BASE_URL=https://<your-inone-api-host> \
INONE_SMOKE_EMAIL=<unregistered-test-mailbox> \
INONE_SMOKE_LOCALE=ru \
npm run test:registration:live
```

Скрипт вызывает реальный `POST /register/email`, ждёт письмо в почтовом ящике, принимает введённый оператором шестизначный код и вызывает `POST /register/email/confirm`. Он проверяет, что backend выдал одноразовый registration token, но по умолчанию не создаёт аккаунт. Неиспользованный токен истекает через 30 минут.

Чтобы дополнительно создать тестовый аккаунт, явно задать `INONE_SMOKE_CREATE_ACCOUNT=true`, `INONE_SMOKE_NICKNAME` и `INONE_SMOKE_PASSWORD`; если окружение требует телефон, задать также `INONE_SMOKE_PHONE`. Это создаёт постоянную запись аккаунта в целевой базе данных. Использовать только отдельную тестовую среду и заранее согласованный тестовый номер. Скрипт не удаляет аккаунт автоматически.

Скрипт не принимает SMTP credentials и не читает секреты сервера. SMTP credentials и ключ шифрования остаются только в secret manager развёрнутого backend. Не передавать коды, пароли, registration token или секреты в CI logs, issue, PR или чат.

Автоматический DB integration test `test/registration-email-delivery-db.test.js` проходит тот же HTTP registration flow через PostgreSQL outbox и Nodemailer SMTP transport, используя локальный SMTP sink. Он входит в `npm run test:db` и не отправляет внешних писем.
