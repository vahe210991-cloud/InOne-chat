# Развёртывание сервера InOne

Сборка: 0.6.0-alpha.30. В исходниках подключён SMTP transport и PostgreSQL-backed encrypted email queue. Production acceptance остаётся BLOCKED до выполнения production runtime-тестов, настройки домена/провайдера и проверки SPF/DKIM/DMARC.

## Что нужно

- Node.js 24.7.0 или новее, PostgreSQL 16.
- HTTPS-прокси перед сервером (nginx, Caddy или облачный балансировщик).
- Секреты: пароль базы, перец PIN (`INONE_PIN_PEPPER`) и отдельный постоянный ключ подписи URL объектов (`INONE_OBJECT_SIGNING_SECRET`), каждый случайный и не короче 32 символов.

## Настройки

Все настройки — в переменных окружения. Образец — `.env.example`.

| Переменная | Что делает | По умолчанию |
|---|---|---|
| `DATABASE_URL` | адрес базы PostgreSQL | обязательна |
| `INONE_PIN_PEPPER` | перец для хэшей PIN и кодов | обязательна в продакшене |
| `INONE_OBJECT_SIGNING_SECRET` | постоянный HMAC-ключ для подписанных URL объектов; одинаковый на всех репликах и сохраняется при рестартах | обязателен в продакшене; `openssl rand -hex 32` |
| `INONE_PUBLIC_URL` | публичный адрес за прокси, https в продакшене | — |
| `INONE_REGISTRATION_MODE` | `verified` (с проверкой почты) или `open` | `verified` |
| `INONE_TRUST_PROXY` | включить обработку forwarded headers только от allowlisted immediate peer | `false` |
| `INONE_TRUSTED_PROXY_IPS` | comma-separated exact IP allowlist для прокси; цепочка проверяется справа налево | обязателен при `INONE_TRUST_PROXY=true` |
| `INONE_BODY_LIMIT_BYTES` | максимальный размер тела запроса | 4 МБ |
| `INONE_REQUEST_TIMEOUT_MS` | время на запрос | 30 с |
| `LOG_LEVEL` | уровень журнала | `info` |
| `INONE_RUN_MIGRATIONS` | применять миграции при старте | `true` |
| `INONE_MAIL_TRANSPORT` | почтовый транспорт: `smtp` или `memory` (только разработка) | `memory` |
| `INONE_SMTP_HOST` | адрес SMTP-сервера (своего или провайдера) | обязательна для `smtp` |
| `INONE_SMTP_PORT` | порт: 587 (STARTTLS) или 465 (вместе с `INONE_SMTP_SECURE=true`) | 587 |
| `INONE_SMTP_SECURE` | `true` для порта 465 | `false` |
| `INONE_SMTP_REQUIRE_TLS` | требовать шифрование соединения; в продакшене должно быть `true` | `true` |
| `INONE_SMTP_USER` / `INONE_SMTP_PASSWORD` | логин и пароль ящика; пароль не пишется в журнал | — |
| `INONE_SMTP_FROM` | адрес отправителя, например `InOne <noreply@example.com>` | обязательна для `smtp` |
| `INONE_EMAIL_ENCRYPTION_KEY` | независимый 32-байтовый ключ AES-256-GCM для шифрования очереди (64 hex или канонический Base64; сгенерировать: `openssl rand -hex 32`) | обязателен для `smtp` |
| `INONE_EMAIL_WORKER_POLL_MS` | интервал опроса durable queue, 250–60000 мс | 1000 |
| `INONE_EMAIL_MAX_ATTEMPTS` | максимальное число попыток доставки, 1–20 | 8 |

Неверная настройка останавливает запуск до открытия порта и называет причину. `INONE_OBJECT_SIGNING_SECRET` нельзя генерировать заново на каждом старте: иначе ранее выданные signed object URLs перестанут проверяться; при нескольких backend replicas используйте одно и то же значение из secret manager. При смене ключа требуется отдельная ротация с периодом совместной проверки старого и нового ключа. Для proxy trust задавайте только точные адреса непосредственных доверенных узлов; без allowlist `X-Forwarded-For` игнорируется.

## Локальный запуск через Docker Compose

Корневой `docker-compose.yml` этого каталога — development-профиль, не production deployment. Он запускает PostgreSQL 16 и Backend, применяет миграции при старте, сохраняет данные в named volumes и публикует порт 8080.

1. Создать локальный файл `.env` в этом каталоге. Минимальные значения:

   ```dotenv
   POSTGRES_DB=inone
   POSTGRES_USER=inone
   POSTGRES_PASSWORD=UseAnAlphanumericLocalPassword
   INONE_PIN_PEPPER=replace-with-at-least-32-random-characters
   ```

   Для пароля базы используйте URL-safe буквы и цифры, поскольку он включается в `DATABASE_URL`. Не используйте эти локальные значения в production.
2. Проверить конфигурацию: `docker compose config --quiet`.
3. Собрать и запустить: `docker compose up -d --build --wait`.
4. Проверить `http://localhost:8080/healthz`, `/readyz` и `/config/public`.
5. Посмотреть диагностику: `docker compose logs --tail=200`.
6. Остановить сервисы: `docker compose down`. Для полного удаления локальной базы и файлов используйте `docker compose down --volumes`.

CI workflow `.github/workflows/backend-compose-acceptance.yml` выполняет сборку образа, запуск PostgreSQL и Backend, проверку health/readiness, публичного API и последней миграции. Результат должен оцениваться только по конкретному SHA PR.

## Первый production запуск без Compose

1. Создать базу: `CREATE DATABASE inone OWNER inone;`
2. Установить зависимости: `npm ci --omit=dev`
3. Создать схему: `DATABASE_URL=... npm run migrate`
4. Запустить: `DATABASE_URL=... npm start`

## Проверки

- `GET /healthz` — liveness процесса: 200, пока HTTP runtime отвечает; не зависит от PostgreSQL и не раскрывает детали конфигурации.
- `GET /readyz` — readiness обязательной зависимости PostgreSQL: 200, если `storage.ping()` успешен; 503 иначе. Внешние SMTP/FCM провайдеры обслуживаются durable workers и не включаются в синхронный readiness probe. Docker image `HEALTHCHECK` использует `/readyz`; production orchestrators должны настроить отдельные liveness `/healthz` и readiness `/readyz` probes.

## Обновление

1. Сделать резервную копию базы.
2. Остановить старую версию сигналом `SIGTERM`: сервер перестаёт принимать новые соединения, дожидается текущих запросов и закрывает базу.
3. Запустить `npm run migrate` с новой версией. Миграции применяются по одной, каждая в транзакции. Уже применённые не выполняются повторно.
4. Запустить новую версию.

## Журнал

Одна строка JSON на событие: запуск, остановка, миграции и каждый запрос (метод, путь без строки запроса, код ответа, время). В журнал не попадают тела запросов, пароли, PIN, токены, ключи, содержимое сообщений и файлов.

## Ограничения этой сборки

- Почта: SMTP transport и durable encrypted queue реализованы в исходниках; добавлены миграции, worker, идемпотентность, expiry, retry/dead-letter, HY/RU/EN templates, локализация по выбранному языку интерфейса и safe logs. Для acceptance нужны Node + PostgreSQL suite, SMTP integration, restart/retry/shutdown tests и реальная проверка доставки.
- Продакшен не стартует без `INONE_MAIL_TRANSPORT=smtp` с TLS и адресом отправителя.
- Зависимости почты по текущему `package.json`: `nodemailer` 10.3.1 и `smtp-server` 3.21.3 (только тестовый сервер). Проверку `npm audit` на соответствующем SHA следует выполнять отдельно.
- SMS не подключён: восстановление доступа по телефону недоступно.
- Файлы оформления хранятся в базе данных.
- Криптографический движок временный (`@matrix-org/matrix-sdk-crypto-wasm`), собственный не собран.
- Docker Compose profile is development-only; passing its CI smoke test does not constitute production deployment acceptance.
- Резервное копирование, очистка устаревших записей и мониторинг не автоматизированы.

## Push delivery
- `firebase-admin` отправляет по FID через `fid`; iOS использует тот же FCM путь, который Firebase маршрутизирует через APNs.
- PostgreSQL `push_deliveries` — отдельный durable outbox, не таблица Email Delivery. MLS event и outbox запись фиксируются одной транзакцией, включая путь `clientMessageId`.
- FID и минимальный push payload зашифрованы AES-256-GCM. Legacy identifiers шифруются при backfill, но не отправляются; клиент должен зарегистрировать актуальный FID.
- `provider_accepted` означает принятие FCM, а не подтверждённую доставку/показ на устройстве.
- Для iOS нужны APNs `.p8`, Key ID, Team ID, Bundle ID и корректные entitlements/provisioning. Секреты не коммитить.

## Ограничения этой сборки

- Почта: SMTP transport и durable encrypted queue реализованы в исходниках; добавлены миграции, worker, идемпотентность, expiry, retry/dead-letter, HY/RU/EN templates, локализация по выбранному языку интерфейса и safe logs. Новые тесты добавлены, но на текущем SHA ещё NOT RUN. До acceptance нужны Node + PostgreSQL suite, SMTP integration, restart/retry/shutdown tests и реальная проверка доставки.
- Продакшен не стартует без `INONE_MAIL_TRANSPORT=smtp` с TLS и адресом отправителя.
- Зависимости почты по текущему `package.json`: `nodemailer` 10.3.1 и `smtp-server` 3.21.3 (только тестовый сервер). Проверку `npm audit` на этом SHA ещё не выполняли.
- Push receive/tap navigation и реальные Android/iOS delivery smoke tests остаются отдельными acceptance gates.
- SMS не подключён: восстановление доступа по телефону недоступно.
- Файлы оформления хранятся в базе данных.
- Криптографический движок временный (`@matrix-org/matrix-sdk-crypto-wasm`), собственный не собран.
- Docker-образ и `docker-compose.yml` не собраны и не проверены: в этой среде Docker недоступен.
- Резервное копирование, очистка устаревших записей и мониторинг не автоматизированы.
