# Развёртывание серверного движка InOne

Статус: P0 backend candidate. Серверный API и PostgreSQL store прошли P0 CI acceptance на зафиксированном PR head; это не является сертификатом production readiness. Мобильная Flutter/OpenMLS интеграция, реальные устройства, эксплуатационные backup/restore, мониторинг и независимый аудит проверяются отдельно.

## Требования

- Node.js 22 или новее.
- PostgreSQL 16.
- HTTPS reverse proxy (nginx, Caddy или облачный балансировщик).
- Постоянный каталог `INONE_FILES_DIR`.
- Secret manager для `DATABASE_URL`, `INONE_PIN_PEPPER`, `INONE_DOCS_SECRET` и SMTP credentials.

## Конфигурация

Шаблон — `.env.example`. Значения `change-me` и `replace-with-...` являются только placeholders. До запуска замените их реальными значениями из secret manager.

| Переменная | Назначение | Production |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | обязательно |
| `INONE_PIN_PEPPER` | HMAC pepper для PIN и кодов | случайный секрет, не менее 32 символов |
| `INONE_DOCS_SECRET` | секрет защищённых служебных документов | случайный секрет, не менее 32 символов |
| `INONE_PUBLIC_URL` | публичный URL сервиса | только `https://` |
| `INONE_FILES_DIR` | постоянное файловое хранилище | обязательно |
| `INONE_REGISTRATION_MODE` | `verified` или `open` | только `verified` |
| `INONE_REQUIRE_PHONE` | требовать телефон при регистрации | по умолчанию `false`; включать только с рабочим SMS provider |
| `INONE_SMS_ENABLED` | включить SMS flow | по умолчанию `false` |
| `INONE_TRUST_PROXY` | доверять forwarded headers | `true` только за настроенным доверенным proxy |
| `INONE_BODY_LIMIT_BYTES` | максимальный размер тела запроса | по умолчанию 4 MiB |
| `INONE_REQUEST_TIMEOUT_MS` | тайм-аут запроса | по умолчанию 30 s |
| `INONE_RUN_MIGRATIONS` | миграции при старте | `true` по умолчанию; production rollout должен иметь backup и план отката |
| `INONE_MAIL_TRANSPORT` | транспорт почты | `smtp` |
| `INONE_SMTP_HOST`, `INONE_SMTP_PORT` | SMTP host/port | обязательно |
| `INONE_SMTP_SECURE` | implicit TLS (обычно порт 465) | зависит от провайдера |
| `INONE_SMTP_REQUIRE_TLS` | требовать STARTTLS | обязательно `true` |
| `INONE_SMTP_USER`, `INONE_SMTP_PASSWORD` | SMTP credentials | если требует провайдер |
| `INONE_SMTP_FROM` | адрес отправителя | обязательно |

Production-конфигурация отклоняется без HTTPS URL, PostgreSQL URL, сильных секретов, SMTP с TLS, постоянного файлового каталога и выключенного test UI. Production startup через `src/main.js` дополнительно запрещает запуск без PostgreSQL pool. Телефон не требуется по умолчанию, пока SMS provider не подключён.

## Первый запуск

1. Создать отдельную PostgreSQL database и пользователя с минимальными необходимыми правами.
2. Настроить секреты и переменные окружения по `.env.example`.
3. Установить production dependencies: `npm ci --omit=dev`.
4. Снять резервную копию (для новой пустой базы — зафиксировать начальную точку).
5. Применить миграции: `npm run migrate`.
6. Запустить: `npm start` (через supervisor/container orchestration).
7. Проверить `GET /healthz` и `GET /readyz` с внутренней и внешней сторон proxy.

## Обновление

1. Проверить точный release SHA и успешные обязательные CI jobs.
2. Снять backup PostgreSQL и проверить доступность восстановления в отдельной среде.
3. Выполнить rollout на staging copy и применить миграции.
4. Проверить целостность данных и критические API сценарии.
5. Выполнить production rollout с планом rollback. Не запускать миграции одновременно из нескольких независимых deployment jobs; встроенная advisory lock сериализует migration runner.
6. Проверить health/readiness, журналы и ошибки после запуска.

## TLS, журналы и наблюдаемость

TLS завершается на доверенном HTTPS proxy. Включайте `INONE_TRUST_PROXY=true` только если proxy перезаписывает клиентские forwarded headers и доступ к приложению извне proxy закрыт. Сами настройки proxy и TLS должны быть проверены в целевой среде.

Приложение пишет структурированные JSON события. Не добавляйте в журналы тела запросов, пароли, PIN, токены, ключи, содержимое сообщений или файлов. Не передавайте секреты в query string.

Health endpoints подтверждают состояние процесса и доступность базы, но не заменяют мониторинг, метрики, алерты и backup verification.

## Криптография и границы выпуска

Серверный P0 использует MLS API и PostgreSQL persistence. Legacy `TemporaryMatrixEngine` на Matrix Olm/Megolm относится к старому Node test client и не является production crypto path. Rust/OpenMLS client с SQLCipher storage и текущий FFI bridge — разные компоненты: bridge пока хранит состояние в памяти. Не выпускайте мобильную MLS-интеграцию, пока Flutter не подключён к durable SQLCipher client и platform Keychain/Keystore и пока не пройдены реальные device tests.

## Обязательные внешние проверки

- PostgreSQL backup и restore на отдельной базе.
- Реальная SMTP доставка и SPF/DKIM/DMARC.
- TLS/proxy, сетевые ограничения и trust proxy.
- iOS Keychain / Android Keystore, перезапуск и восстановление MLS state.
- Нагрузочные и multi-instance проверки.
- Threat model review и независимый security/crypto audit.

До закрытия этих проверок production deployment не считается утверждённым.
