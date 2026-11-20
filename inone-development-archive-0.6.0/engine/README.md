# InOne — canonical P0 server backend

## Источник и статус

Этот каталог — опубликованный источник Node.js HTTP backend и PostgreSQL store для P0. Он был принят в PR #25 и прошёл шесть обязательных CI jobs на точном PR head; доказательства и SHA находятся в `development/recovered-source/P0-CLOSURE-2026-11-08.md`.

Штатная точка запуска сервера — `src/main.js`. Она передаёт PostgreSQL store в HTTP API. `src/store-memory.js` оставлен для тестов и локальной разработки. Production запуск без PostgreSQL pool запрещён.

**P0 backend acceptance не означает готовность всего мобильного продукта к выпуску.** Текущие изменения стабилизации ещё должны пройти CI на точном SHA. SMTP, TLS/proxy, backup/restore, мониторинг, реальные устройства и независимый аудит остаются отдельными release gates.

## Разделение серверного и клиентского движков

### Сервер

- `src/main.js` — поддерживаемая точка запуска HTTP API.
- `src/server.js` — маршруты, авторизация, сессии, MLS API, файлы и организации.
- `src/store.js` — постоянное PostgreSQL-хранилище.
- `src/store-memory.js` — тестовый/локальный адаптер.
- `src/migrate.js`, `src/schema.sql`, `../migrations/` — схема и миграции.
- `src/mail-smtp.js` — SMTP транспорт с TLS-настройками.

### Криптография клиента

- Целевой протокол — MLS (RFC 9420), реализация OpenMLS/Rust.
- Более новый persistent OpenMLS client с SQLCipher находится отдельно: `inone-engine-poc-0.6.0/mobile-mls/mls-client/`. Не путать его с серверным источником в этом каталоге.
- `mobile-mls/mls-bridge/` в этом архивном дереве — демонстрационный in-memory bridge. Он не является durable mobile runtime и не должен подключаться к production.
- `src/crypto-engine.js` и `src/client.js` — legacy/test-only Node client на Matrix Olm/Megolm. Они не являются production crypto path и не должны использоваться Flutter.
- В текущем Flutter Beta 1.0 коде native MLS send/receive остаётся заблокированным до интеграции persistent OpenMLS client через проверенный FFI и платформенное хранилище ключей.

Нельзя добавлять plaintext fallback или писать собственную криптографию.

## Проверка расхождения серверных деревьев

В репозитории сохранён второй каталог `inone-engine-poc-0.6.0/`. Сравнение исходников на текущей ветке показало:

- серверные API source files содержат 58 общих статически обнаруживаемых route path literals;
- canonical P0 backend дополнительно содержит `/rooms/mine`;
- PostgreSQL store canonical backend содержит 186 async operations, POC store — 181; пять операций есть только в canonical backend: `joinPublicRoomOpen`, `mlsCommitOperation`, `mlsReleaseKeyPackageClaim`, `roomsOfUser`, `transitionOrgLinkStatus`;
- мигратор canonical backend объявляет schema version `0028`, тогда как POC snapshot отстаёт.

Это статическое сравнение исходников, а не runtime API parity test. Поэтому Beta 1.0 backend contracts ссылаются на этот canonical P0 server path. Второй каталог не удалять: он содержит отдельный persistent OpenMLS client и исторические материалы; использовать его Node server как production backend нельзя.

## Требования и локальные проверки

- Node.js 22 или новее.
- PostgreSQL 16.
- Production: HTTPS reverse proxy, постоянный каталог файлов, отдельный постоянный `INONE_OBJECT_SECRET` для подписанных URL, остальные случайные секреты и SMTP с TLS.
- Секреты хранить только в secret manager / переменных окружения; не коммитить их и не помещать в логи.

```sh
npm ci
npm test
DATABASE_URL=postgresql://... npm run test:db
```

Rust проверки persistent OpenMLS client выполняются из `inone-engine-poc-0.6.0/mobile-mls/mls-client/`; не путать их с тестами legacy in-memory bridge.

## Production acceptance — ещё не закрыта

Перед реальным запуском должны быть подтверждены на целевой инфраструктуре:

- полный CI на точном release SHA после последних изменений;
- PostgreSQL миграции на пустой БД и upgrade-копии с проверкой сохранности данных;
- резервное копирование и реальное восстановление;
- SMTP доставка с домена и проверка SPF/DKIM/DMARC;
- TLS/reverse proxy, корректная обработка forwarded headers и сетевые ограничения;
- Flutter FFI интеграция с persistent OpenMLS client и SQLCipher;
- ключ SQLCipher из iOS Keychain / Android Keystore, перезапуск, offline sync и отзыв устройств;
- тесты на физических iOS/Android устройствах, threat model review и независимый аудит криптографии.

До закрытия этих пунктов движок следует считать **P0 backend candidate**, а не сертифицированным production-релизом.
