# InOne — серверный движок и MLS

## Источник и статус

Этот каталог содержит опубликованный P0 backend / MLS source, принятый в PR #25 и прошедший шесть обязательных CI jobs на зафиксированном PR head. Точный отчёт и SHA приведены в `development/recovered-source/P0-CLOSURE-2026-11-08.md`.

Штатная серверная точка запуска — `src/main.js`. Сервер использует PostgreSQL через `src/store.js`; production запуск без PostgreSQL pool запрещён. `src/store-memory.js` предназначен только для тестов и локальной разработки.

**Это не означает, что мобильная криптография Beta 1.0 готова к выпуску.** Backend P0 и Rust/OpenMLS проверки прошли CI, но интеграция с Flutter, платформенное хранение ключей, физические iOS/Android устройства и независимый аудит остаются отдельными воротами приёмки.

## Два разных криптографических пути

1. **Целевой протокол — MLS (RFC 9420), реализация OpenMLS/Rust.**
   - `mobile-mls/mls-client` содержит Rust-клиент с OpenMLS и постоянным хранилищем состояния групп в SQLCipher.
   - Ключ SQLCipher должен поступать от платформенного KeyStore (iOS Keychain / Android Keystore); тестовый `MemoryKeyStore` не является production-хранилищем.
   - `mobile-mls/mls-bridge` — текущий Flutter FFI bridge. Его состояние пока находится в памяти процесса; его нельзя считать постоянным мобильным runtime и нельзя использовать как замену SQLCipher-клиенту до реализации и проверки durable storage.

2. **Legacy/test-only путь — `src/crypto-engine.js` / `TemporaryMatrixEngine`.**
   - Использует Matrix Olm/Megolm и подключён к старому Node test client через `src/client.js`.
   - Не является целевой криптографией InOne и не должен использоваться в production или Flutter Beta 1.0.
   - Не добавлять plaintext fallback и не писать собственную криптографию.

## Структура

- `src/main.js` — единственная поддерживаемая точка запуска HTTP API.
- `src/server.js` — HTTP/API маршруты, авторизация, сессии, MLS API, файлы и организации.
- `src/store.js` — постоянное PostgreSQL-хранилище.
- `src/store-memory.js` — адаптер для unit/API тестов и локальной разработки.
- `src/migrate.js`, `src/schema.sql`, `migrations/` — схема и последовательные миграции.
- `src/mail-smtp.js` — SMTP-транспорт; production конфигурация требует SMTP с TLS.
- `mobile-mls/mls-client/` — OpenMLS клиент с SQLCipher storage.
- `mobile-mls/mls-bridge/` — текущий FFI bridge; пока не является durable production runtime.
- `test/` — Node/API/security и PostgreSQL интеграционные тесты.

## Требования

- Node.js 22 или новее.
- PostgreSQL 16.
- Production: HTTPS reverse proxy, постоянный каталог файлов, случайные секреты, SMTP с TLS.
- Реальные секреты хранить только в secret manager / переменных окружения; не коммитить их и не помещать в issue или логи.

## Локальные проверки

```sh
npm ci
npm test
DATABASE_URL=postgresql://... npm run test:db
```

Rust проверки:

```sh
cargo check --locked --all-targets
cargo test --locked --no-fail-fast
cargo fmt -- --check
```

Для CI используются отдельные manifests в `mobile-mls/mls-client` и `mobile-mls/mls-bridge`; запускайте команды из соответствующих каталогов.

## Production acceptance — ещё не закрыта

Перед реальным запуском должны быть подтверждены на целевой инфраструктуре:

- полный CI на точном release SHA после последних изменений;
- PostgreSQL миграции на пустой БД и upgrade-копии с проверкой сохранности данных;
- резервное копирование и реальное восстановление;
- SMTP доставка с домена и проверка SPF/DKIM/DMARC;
- TLS/reverse proxy, корректная обработка forwarded headers и сетевые ограничения;
- постоянное SQLCipher хранилище на устройстве с ключом из iOS Keychain / Android Keystore;
- Flutter FFI интеграция с OpenMLS client, перезапуск, оффлайн-синхронизация, отзыв устройств и восстановление;
- тесты на физических iOS/Android устройствах, threat model review и независимый аудит криптографии.

До закрытия этих пунктов движок следует считать **P0 backend candidate**, а не сертифицированным production-релизом.
