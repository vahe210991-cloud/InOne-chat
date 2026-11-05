# Полный архив разработки InOne, версия 0.6.0

Закрытие линии 0.6. Архив содержит все файлы разработки, кроме строек и кэша.

## Что внутри
- engine/ — движок (сервер, хранилище, миграции, тесты, документы, Rust-ядро клиента и мост). Файлы CHANGELOG.md, TEST_REPORT_0.6.0.md, DEVELOPMENT_REGISTER.md, DELIBERATE_BREAKS.md, ORG_API.md, client-test-ui/ (тестовый экран).
- repository/ — история git: inone-engine-0.6.0.bundle (ветка engine/0.6.0-alpha.38), PUBLISH_STEPS.md, SECURITY.md.
- client-reference/dart/ — справочный клиент организаций на Dart. НЕ ПРОВЕРЕН: в среде нет Dart SDK.
- releases/ — защищённые копии всех выпусков: 0.6.0-alpha.31 … 0.6.0-alpha.37 и 0.6.0, каждая с архивом, SHA-256, отчётом о тестах и манифестом.

## Что не вошло
- node_modules/ — восстанавливается командой `npm ci`.
- target/ (сборки Rust) — восстанавливается командой `cargo build` в mobile-mls/mls-client и mobile-mls/mls-bridge.
- Журналы (*.log), временные копии, старые экспериментальные копии (engine, engine2, mls-spike, mls-interop). Они заменены текущим движком; при необходимости добавлю.

## Как восстановить
1. Распакуйте архив.
2. Движок: `cd engine && npm ci && npm test`. Ядро клиента: `cd engine/mobile-mls/mls-client && cargo test`.
3. История git: `git clone repository/inone-engine-0.6.0.bundle -b engine/0.6.0-alpha.38 inone`.
4. Проверка целостности: `sha256sum -c` для архивов в releases/.

## Результаты проверок закрытия 0.6
- Движок: память 369 из 369, PostgreSQL 369 из 369.
- База и миграции: 43 из 43. Ядро клиента Rust: 26 из 26. Мост: 3 из 3.
- Поломок записано: 56, все пойманы тестами.

## Ограничения
- Экраны только тестовые; визуальные экраны — этап 0.7.
- Dart-код не проверен.
- Пункты беты 6.2–6.10 открыты.
