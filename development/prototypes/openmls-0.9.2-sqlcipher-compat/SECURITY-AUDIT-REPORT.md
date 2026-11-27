# Углублённый аудит OpenMLS 0.9.2 / SQLCipher

Дата среза: 2026-11-27

## Границы работ

- Исходная точка: PR #169, head `f7b024e6509b560158bda14982380636da08204a`.
- Изолированная ветка: `security/openmls-092-compat-hardening-2026-11-27`.
- Работа ограничена каталогом `development/prototypes/openmls-0.9.2-sqlcipher-compat/`.
- PR #169 остаётся открытым Draft; его head и base не изменялись.
- Workflow GitHub Actions восстановлен в исходное состояние PR #169 и не изменялся.
- Новые PR не создавались. В основную ветку и production Engine B ничего не переносилось.
- Компиляция, форматирование, Cargo audit и тесты на этой ветке не запускались.

## Что расширено в исходниках

| Область | Файл / строки | Добавленное покрытие |
|---|---|---|
| Runtime SQLCipher | `current-reader/src/lib.rs:53` | Проверка фактических версий SQLite 3.54.1 и SQLCipher 4.20.0 после установки ключа |
| Legacy database | `legacy-writer/src/main.rs:122-199` | База OpenMLS 0.8.1 с Alice и Bob на epoch 3, после добавления и удаления временного участника; сохраняется настоящее сообщение Bob из epoch 1 |
| Legacy read | `current-reader/src/lib.rs:155-350` | Повторное открытие базы OpenMLS 0.8.1, проверка состава группы и расшифровка epoch-1 сообщения после миграции через Libcrux и RustCrypto |
| Cross-provider | `current-reader/src/lib.rs:538-780` | Welcome в обоих направлениях Libcrux/RustCrypto и обмен application messages с проверкой plaintext |
| Migrations | `current-reader/src/lib.rs:361-414` | Повторный запуск шести миграций, проверка migration ledger и ожидаемых таблиц |
| Transaction rollback | `current-reader/src/lib.rs:416-536` | Удаление участника и merge Commit внутри caller-owned SQLite transaction, затем rollback и проверка восстановления epoch/member set |
| MaxPastEpochs | `current-reader/src/lib.rs:1007-1255` | Удалённый участник не получает доступ к новому epoch; сообщение из сохранённого старого epoch может быть обработано один раз; повтор сообщения отклоняется |
| Retention expiry | `current-reader/src/lib.rs:1256-1516` | 18 переходов эпохи с закрытием и повторным открытием баз; сообщение epoch 1 после выхода за окно 16 эпох должно отклоняться |
| Dependency floors | `scripts/run.sh:25-80` | Проверка пакетов и версий candidate/legacy lockfiles, включая `crypto-bigint 0.7.11`, `libcrux-kem 0.0.10`, `libsqlite3-sys 0.40.0`, `refinery-core 0.10.1`, `rusqlite 0.42.0` и SQLCipher 4.20.0 |
| Secret handling | `vendor/openmls_libcrux_crypto/src/crypto.rs:283-337, 905-967` | Zeroizing для временных Ed25519/ML-DSA буферов и drop guard для временного ML-DSA signing key |

## Текущие выводы и ограничения

### Блокирующие условия до любого production adoption

1. **Нет результатов сборки и тестов.** Все перечисленные сценарии существуют только в исходниках. Нельзя считать их зелёными до выполнения и сохранения результатов.
2. **Dependency graph ещё не зафиксирован в репозитории.** Runner генерирует два Cargo.lock при первом запуске, проверяет version floors и использует `--locked` в последующих шагах. Оба lockfile должны быть проверены и сохранены как reviewed inputs перед production adoption.
3. **Не доказана полная crash-atomicity production membership flow.** Новый тест доказывает только ожидаемый rollback при использовании внешней SQLite transaction. Он не заменяет production Engine B transaction adapter, durable membership journal, idempotent server replay и outbox recovery.
4. **Не доказано восстановление при аварийном прерывании миграций.** V2 перестраивает `openmls_group_data` через create/copy/drop/rename. Идемпотентный повтор миграций не заменяет process-kill/reopen испытания на каждом опасном участке.
5. **Нет мобильной матрицы.** Linux prototype не подтверждает Android/iOS native builds, реальный Flutter-Rust FFI, platform key storage, SQLCipher key handoff или поведение на Windows.

### Высокий приоритет

- **Libcrux zeroization остаётся best-effort.** Локальный guard очищает временный ML-DSA signing-key buffer, а временные массивы обёрнуты в `Zeroizing`. Однако ML-DSA API принимает seed/randomness по значению, поэтому копии внутри upstream-вызовов не доказано очищаются. Сам upstream Libcrux отдельно предупреждает, что не гарантирует zeroization секретов на stack/heap: [upstream security notes](https://github.com/cryspen/libcrux#side-channel-resistance-and-zeroization).
- **WAL не подтверждён.** В candidate нет явной настройки/проверки `journal_mode`, `synchronous`, checkpoint policy и recovery при WAL/SHM. Это не доказывает дефект, но WAL-гарантии отсутствуют.
- **Повтор старого сообщения проверяется только в рамках одного живого объекта группы.** Поведение replay protection после закрытия и повторного открытия базы нужно проверить отдельным сценарием.
- **Криптографическая матрица ограничена используемым Ed25519 ciphersuite.** ML-DSA/PQ и ECDSA end-to-end interoperability этим тестовым набором не подтверждаются.
- **Полная семантическая проверка vendor adaptations ещё не закрыта.** Зафиксированы upstream commits и file-level comparison, но изменённые source-файлы и лицензии всё ещё требуют финального review.

### Известные security floors

- `libcrux-kem 0.0.10` выбран как исправленная версия для ошибки panic при декодировании коротких hybrid keys: [RUSTSEC-2026-0331](https://rustsec.org/advisories/RUSTSEC-2026-0331.html).
- `crypto-bigint 0.7.11` выше исправленной границы для timing-variability advisory RUSTSEC-2026-0387.
- `sqlcipher-src 420.0.0+` соответствует SQLCipher 4.20.0 / SQLite 3.54.1 и исправленной границе для локального WAL/page-cache advisory: [RUSTSEC-2026-0502](https://rustsec.org/advisories/RUSTSEC-2026-0502.html). Официальный [релиз SQLCipher 4.20.0](https://www.zetetic.net/blog/2026/10/27/sqlcipher-4.20.0-release/) подтверждает SQLite baseline 3.54.1.
- Это проверяемые version floors в runner, а не подтверждение текущего lockfile: точный dependency graph ещё не получен выполнением runner.

## Семантика удаления участника и MaxPastEpochs

При `MaxPastEpochs(16)` удаление участника не делает автоматически нечитаемыми уже созданные сообщения из сохранённых прошлых эпох. Корректная гарантия: участник, не получивший Commit удаления, не может читать сообщения новой эпохи; сообщения из сохранённой старой эпохи могут оставаться читаемыми до истечения retention window. Тесты намеренно отражают эту семантику и не классифицируют старое сообщение как уязвимость.

## Следующие обязательные проверки после отдельного разрешения на тестирование

1. `cargo fmt --check` для legacy-writer и current-reader.
2. Сборка и запуск legacy-writer с сохранением SHA-256 обоих lockfiles.
3. Полный `cargo test --locked` candidate suite.
4. `cargo audit` отдельно для candidate и legacy fixture lockfiles; сохранить оба JSON-отчёта.
5. Отдельные replay-after-reopen, migration process-kill, WAL/SHM, backup/restore и wrong-key/corrupt-file сценарии.
6. Android/iOS builds и тесты с реальным platform key store.
7. Сопоставление transaction boundaries с production Engine B journal/outbox recovery без замены его архитектуры.

До прохождения этих gates prototype не считать production-ready.
