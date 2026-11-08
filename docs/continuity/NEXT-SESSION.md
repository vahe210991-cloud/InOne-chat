# InOne — инструкция следующему чату / исполнителю

**Точка продолжения:** 2026-11-08 08:25 (UTC+3)

Прочитай сначала [README](README.md), затем [CURRENT-STATE](CURRENT-STATE.md), [DECISIONS](DECISIONS.md), [SOURCE-OF-TRUTH](SOURCE-OF-TRUTH.md). Не проси владельца пересказывать историю или присылать артефакты, пока не проверил общую Library.

## Приоритет 0 — восстановить точный исходный код

1. Проверить Library `/InOne` на текущие bundle/zip/patch артефакты; искать более новые версии, чем перечисленные в SOURCE-OF-TRUTH.
2. Найти способ получить реальные байты этих файлов в рабочее окружение. Предыдущая ошибка materialize должна быть диагностирована, а не обходиться просьбой к владельцу.
3. Для каждого Git bundle выполнить `git bundle verify`, `git bundle list-heads`, сохранить SHA-256.
4. Импортировать bundles в изолированный git repository/worktree. Не делать force-push, не заменять refs, не сбрасывать main.
5. Сравнить все P0 bundle heads, исходные ветки, ancestry, merge-base и diffs; отдельно сравнить UI zip r2 и предыдущую версию.
6. Определить canonical P0 branch и UI branch на основании commit graph + содержимого + patch sequence, а не по одному только времени файла.
7. Сверить патчи 016–020 и session patch: какие уже применены, какие нет, нет ли дублирования/конфликтов.
8. Создать точный manifest: source SHA-256, refs, commit SHA, список patch IDs и diff summary.

## Приоритет 1 — опубликовать код и запустить CI

1. Использовать обычный Git transport из локального клона с сохранением истории. Не создавать искусственный snapshot commit поверх main.
2. Опубликовать точную canonical branch под новым уникальным remote ref, если такого ref нет. Сначала проверить remote refs и ancestry.
3. Создать PR в согласованную target branch. Не merge до прохождения checks.
4. Добавить GitHub Actions workflows для Node 22, PostgreSQL 16, Rust 1.91 и Flutter stable. Pin versions; сохранять logs/artifacts.
5. Запустить полный Node suite; PostgreSQL migration clean-install + upgrade + test:db; Rust fmt/check/test; Flutter pub get/analyze/test.
6. Если connector не умеет передавать bundle bytes или запускать нужный транспорт, явно зафиксировать блокер и найти доступный поддерживаемый механизм. Не изображать GitHub API file writes как импорт Git history.

## Приоритет 2 — закрыть интеграционные блокеры

- Android и iOS native handlers для `mobile-mls/mls-client`.
- Rust FFI/library packaging для обеих платформ.
- Keychain/Keystore-backed secure DB key provider.
- Durable local message store.
- ACK только после локальной persistence transaction; idempotent eventId.
- Send/receive/offline/restart/outbox/revoked-device/epoch-outdated tests на реальных Android/iOS устройствах.
- Пока перечисленное не готово, MLS send/decrypt остаются fail-closed. Не включать plaintext fallback.

## Приоритет 3 — Beta 1.0 release gate

- Auth: registration, email confirmation, login, approval/waiting, recovery, refresh rotation.
- Organization isolation/permissions.
- Rooms/messages and durable MLS send/receive.
- Device restart and offline recovery.
- Flutter widget tests + Android/iOS device tests.
- Security, regression, load checks; release build and rollback/backup plan.

Tasks, Calendar, Cindy не добавлять в Beta 1.0 без нового решения владельца.

## Ежедневный формат отчёта владельцу

Коротко, 2–3 абзаца:
1. Что фактически сделано (commit/PR/run URLs).
2. Что проверено и что заблокировано (PASS/FAIL/BLOCKED/NOT RUN; не путать authored tests с executed tests).
3. CTO-рекомендация и следующий шаг.

Проценты:
- Сохранять baseline из CURRENT-STATE.
- Изменять процент только после сравнения объёма работ и объяснять изменение.
- Всегда показывать implementation % и verification % отдельно.
- Не считать старый архивный CI как проверку текущего кода.

## Завершение каждой сессии — обязательный чек-лист

- [ ] Код сохранён в Git commit, branch и SHA записаны.
- [ ] Тесты перечислены с точными командами и результатами.
- [ ] Непройденные проверки обозначены BLOCKED/NOT RUN.
- [ ] CURRENT-STATE.md обновлён.
- [ ] SOURCE-OF-TRUTH.md обновлён при добавлении/замене артефактов.
- [ ] NEXT-SESSION.md содержит конкретную следующую задачу.
- [ ] README.md и журнал обновлены.
- [ ] Ссылки PR/Actions/commit добавлены, если они существуют.

Никогда не заканчивать сессию так, чтобы следующий чат должен был восстанавливать контекст только из памяти предыдущей модели.
