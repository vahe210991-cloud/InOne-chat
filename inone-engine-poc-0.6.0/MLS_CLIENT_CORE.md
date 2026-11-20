# Ядро клиента InOne (Rust): проверка

- **Дата:** 2026-11-01 16:08 UTC (Ереван UTC+4).
- **Состав:** `mobile-mls/mls-client` — вход, ключевые пакеты, резервный пакет, создание комнаты, приглашение, сообщения, перезапуск, догон по эпохам. Состояние группы и ключи — в SQLite-файле устройства.

## Что проверено
- Сценарий 1 (`offline_member_catches_up_after_restart_and_new_member_reads_from_join`): приглашение; сообщение; перезапуск устройства — эпоха и состояние сохраняются; участник без связи догоняет по эпохам; новый участник читает только с момента вступления; повторная синхронизация ничего не отдаёт; ответ участника читает отправитель.
- Сценарий 2 (`invitation_works_when_regular_packages_run_out`): приглашение проходит по резервному пакету, когда обычные закончились.
- Оба сценария проходят на настоящем сервере движка; предупреждений компилятора нет.
- Чистая копия (исходники и файл блокировки, без папки сборки): 2 из 2.

## Поломки (падает нужный сценарий, файл восстанавливается побайтно)
- Коммит не применяется при догоне.
- Обработанные события не записываются.
- При запуске не читается список обработанных событий.
- Вступившие в комнату не сохраняются.
- Клиент не публикует резервный пакет.

## Не сделано и не проверено
- Экраны Flutter и мост flutter_rust_bridge: Flutter SDK и Dart в среде недоступны (pub.dev, dart.dev и хранилище Flutter не открываются).
- Шифрование базы устройства и хранение ключа в защищённом хранилище ОС — обязательно до выпуска.
- Фоновая синхронизация, уведомления, повторы при потере связи.
- Удаление отозванного устройства на стороне клиента (сервер уже ведёт список `/mls/removals`).
- Сборки Android и iOS и проверка на устройствах.

## Durable inbox lifecycle (Beta 1.0)

- `client_inbox` is stored in the device SQLCipher database. The incoming MLS ratchet update, inbox record, unreadable-event diagnostic (when applicable), and processed event marker are committed in one SQLite transaction. A failed inbox write rolls back that transaction and reloads the MLS group state.
- `pending_incoming()` returns only rows with `acknowledged = 0`, in insertion order. Reading or syncing again does not consume a row. The application must ACK only after it has durably accepted the message.
- `acknowledge_incoming()` marks the selected event IDs as acknowledged; it does not delete the message. `messages_for_room()` continues to expose acknowledged and pending local history.
- Unreadable application messages are stored as `Incoming::Unreadable` plus a diagnostic reason. The diagnostic is a fixed error category and must not include decrypted application bytes or secrets.
- **Current retention limitation:** the client does not automatically delete acknowledged history, pending inbox items, or diagnostics, and it has no configured per-device storage quota or row-count cap. This is intentionally fail-safe against silent message loss, but storage can grow without bound. Do not introduce automatic pruning of unacknowledged rows. A product-approved quota/retention value and explicit user-visible cleanup flow remain required before claiming bounded storage for production scale.
