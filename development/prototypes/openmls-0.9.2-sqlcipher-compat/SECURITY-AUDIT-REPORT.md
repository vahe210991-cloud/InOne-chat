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

## Source-only comparison with production Engine B

Дата проверки: 2026-11-28. Проверка выполнена чтением исходников на этой ветке; команды сборки, тесты и CI не запускались.

### Production client: durable membership journal

Reference source: `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/src/lib.rs`.

- Client opens one shared SQLCipher connection for OpenMLS storage and its metadata/journal tables (`open_client`, lines 978-992). The schema creates `client_membership_commits` with a primary key on `operation_id` and a unique index allowing one pending membership commit per room (lines 1060-1064).
- A membership fingerprint binds room ID, operation ID, base epoch, staged epoch, serialized OpenMLS `StagedCommit`, and the complete serialized request payload using SHA-256 with length-delimited fields (lines 1433-1460). It is an integrity/idempotency binding, not a secret MAC.
- Invite intent receives a random 128-bit operation ID, persisted before claim/retry work (lines 2524-2542). The staged OpenMLS mutation, serialized request, fingerprint, journal row, and transition of the intent to `commit_pending` are committed together (lines 2654-2715).
- Recovery validates that the journal payload's operation ID and base epoch match the row, recomputes the fingerprint against the persisted pending `StagedCommit`, and sends the exact saved payload (lines 2120-2179).
- After server acceptance, the client checks the accepted epoch, rechecks the staged fingerprint, merges the pending Commit, deletes the membership journal and invite intent, and releases the associated claim rows inside one SQLite transaction. On a pre-commit failure it rolls back and reloads the group from storage (lines 2197-2269).

### Production server: durable idempotency receipt

References:
- `inone-development-archive-0.6.0/engine/src/main.js`
- `inone-development-archive-0.6.0/engine/src/server.js`
- `inone-development-archive-0.6.0/engine/src/store.js`
- `inone-development-archive-0.6.0/engine/migrations/0027-mls-commit-idempotency.sql`

- The production entrypoint creates the PostgreSQL-backed `createStore({ pool, ... })` when a pool is supplied; the executable entrypoint creates a PostgreSQL pool (main.js lines 14-20 and 106-116).
- The commit route authenticates first, computes a canonical request fingerprint, checks the durable operation receipt before room-membership authorization, and checks again after reading the room to close a race (server.js lines 2546-2595). This permits an authenticated sender to receive the original receipt after a successful self-removal without reapplying the Commit.
- PostgreSQL stores the receipt in `mls_commit_operations`, keyed by room, sender account, sender device, and client operation ID. The migration constrains the operation ID and 64-character fingerprint and stores the resulting epoch (0027 migration).
- `mlsApplyCommit` takes a PostgreSQL transaction, locks the room epoch row, rechecks the operation receipt under the transaction, applies membership changes, appends the MLS Commit, advances the epoch, stores Welcomes and inserts the idempotency receipt before one COMMIT (store.js lines 2187-2217 and 2198-2392).
- Same operation ID + same fingerprint returns the original epoch. Same operation ID + different fingerprint returns `operation_id_reused`. The room-row lock serializes concurrent commits for that room.

### Existing source-level test matrix

These are test definitions, not test results.

| Boundary / property | Existing source coverage | Qualification |
|---|---|---|
| Server accepted Commit, HTTP response lost | `mls-client/tests/membership_journal.rs::accepted_commit_with_lost_response_replays_after_client_restart` | Rust client integration harness uses the in-memory engine |
| Journal insert failure | `journal_insert_storage_failure_rolls_back_staged_commit_and_can_retry` | Trigger-injected local SQLCipher failure |
| Journal settlement failure | `settlement_storage_failure_keeps_exact_journal_until_restart_replay` | Verifies rollback and retry after restart |
| Corrupted local fingerprint | `pending_commit_fingerprint_mismatch_keeps_journal_and_requires_recovery` | Fails closed; preserves the journal |
| Crash after journal / server acceptance / local merge / journal settlement / before and after SQLite COMMIT | `mls-client/tests/outbox.rs::process_crash_at_outbound_membership_commit_boundaries_replays_exact_operation_once` | Six process-abort failpoints; asserts local epoch, journal/intent rows and one server Commit. Harness server is in-memory |
| Same server operation ID, exact retry | `engine/test/mls-idempotency.test.js` | `storeForTest` selects PostgreSQL when `DATABASE_URL` is set; otherwise in-memory |
| Same operation ID, changed request | `engine/test/mls-idempotency.test.js` | Changed Commit bytes return HTTP 409 `operation_id_reused` |
| Concurrent requests with same operation ID | `engine/test/mls-idempotency.test.js` | Asserts one epoch advance and one stored Commit |
| Retry after sender removes itself | `engine/test/mls-idempotency.test.js` | Original receipt remains retrievable after membership removal |
| Stale epoch does not reserve operation ID | `engine/test/mls-idempotency.test.js` | Explicitly rejected stale request can be rebased and accepted |

The PostgreSQL-specific branch of `engine/test/mls-idempotency.test.js` is included in the `test:db` script and is activated by `DATABASE_URL`. No such test was executed during this audit.

### Architectural conclusion

The OpenMLS 0.9.2 / SQLCipher prototype must not become a second membership transaction or recovery implementation. Production Engine B already has the durable client journal, stable operation identity, exact-payload replay, server-side PostgreSQL receipt, and transaction boundaries that the prototype lacks. Any future OpenMLS provider integration must preserve and reuse these Engine B semantics rather than replacing them with the prototype's caller-owned SQLite rollback adapter.

### Remaining proof gaps

1. The Rust process-crash matrix runs against the in-memory test server. The PostgreSQL API tests exercise the PostgreSQL store when `DATABASE_URL` is present, but the inspected source does not establish one combined test that runs the real Rust client crash/restart matrix against PostgreSQL.
2. The PostgreSQL idempotency test changes Commit bytes for the reused-ID case. The server fingerprint source also binds epoch, changes, Welcomes, claim ID and join-request ID, but distinct negative tests for each individual field were not found in the inspected test file.
3. The Rust client source does not explicitly set or verify SQLite `journal_mode`, `synchronous`, checkpoint policy, or `busy_timeout`. This is an unpinned durability/configuration policy, not by itself proof of a defect. Platform-specific SQLCipher defaults and actual mobile filesystem behavior remain to be validated.
4. Process-abort tests establish process-restart behavior at selected code boundaries; they do not simulate sudden power loss, storage-controller failure, filesystem corruption, or mobile OS termination during platform key-store operations.
5. The candidate prototype still has no demonstrated equivalent of Engine B's durable operation journal, PostgreSQL idempotency receipt, or six-boundary process-crash recovery matrix. Its caller-owned transaction rollback scenario must not be described as equivalent.

### Next validation gate

After explicit approval to run tests, prioritize the PostgreSQL-enabled `mls-idempotency.test.js`, then a combined Rust-client/PostgreSQL lost-response and restart scenario. Keep the prototype isolated and preserve Engine B as the reference implementation. Do not change PR #169, production Engine B, workflows, or branch protection as part of this source-only audit.

