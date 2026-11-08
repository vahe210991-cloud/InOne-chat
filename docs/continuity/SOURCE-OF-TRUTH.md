# InOne — источники истины и карта артефактов

**Срез:** 2026-11-08 08:25 (UTC+3)

## 1. GitHub repository

Основной репозиторий: https://github.com/vahe210991-cloud/InOne-chat

GitHub — постоянное хранилище кода, истории, решений, CI и handoff-документов. Папка `docs/continuity/` — стартовая точка следующего чата.

Не считать наличие архивов 0.6.0 на `main` доказательством наличия последней P0/UI рабочей копии.

## 2. Общая Library — обнаруженные артефакты

Все нижеперечисленные файлы обнаружены в Library в папке `/InOne`. Они доступны как project/library artifacts, но предыдущая попытка materialize бинарных файлов в рабочий контейнер завершилась ошибкой авторизации raw-byte path. Это ограничение текущего способа доступа, а не отсутствие файлов.

### P0 и backend
- `/InOne/InOne-P0-2026-11-08.bundle` — bundle, создан 2026-11-08 04:51 UTC.
- `/InOne/InOne-P0-local-2026-11-08.bundle` — локальный bundle, создан 2026-11-08 04:27 UTC.
- `/InOne/InOne-Backend-MLS-Session-2026-11-08.patch` — session handoff patch.
- `/InOne/INONE-PATCH-016-rust-idempotent-key-package-claim-journal.patch`.
- `/InOne/INONE-PATCH-017-idempotent-invite-retry.patch`.
- `/InOne/INONE-PATCH-018-message-idempotency-fingerprint.patch`.
- `/InOne/INONE-PATCH-019-outbound-ack-reconciliation.patch`.
- `/InOne/INONE-PATCH-020-outbox-restart-reconciliation.patch`.
- `/InOne/P0-ACTUAL-STATE-2026-11-08.md`.
- `/InOne/P0-CTO-ACCEPTANCE.md`.
- `/InOne/INONE-ROADMAP.md`.

### UI / Flutter
- `/InOne/InOne-Beta1-UI-API-2026-11-08-r2.zip`.
- `/InOne/InOne-Beta1-UI-API-2026-11-08.zip`.
- `/InOne/inone-ui-foundation.zip`.
- `/InOne/BETA-1.0-SCOPE.md`.
- `/InOne/MLS-FLUTTER-BRIDGE.md`.

### Дизайн
- `/InOne/InOne-mobile-design-system-curated.html` — исходный curated design-system артефакт (~1.3 MB). Это reference source; не пересобирать его по сниппетам и не заменять макетом, созданным заново.
- В Library есть и отдельный `Propo mobile app design system.html`; это другой продуктовый артефакт. Не путать его с InOne design system.

### Дополнительные handoff / worklog
- `/InOne/INONE-CTO-WORKLOG-2026-11-07.md`.
- `/InOne/INONE-CTO-STATUS-2026-11-07.md`.
- `/InOne/INONE-PATCH-STACK-VALIDATION-001-016-2026-11-07.md`.
- `/InOne/INONE-PATCH-020-VALIDATION.md`.
- В Library также лежат более ранние handoff ZIPs и patch artifacts. Использовать только после проверки даты и ancestry.

## 3. Противоречия между исходниками — обязательно разрешить

В разных сохранённых снимках встречаются разные refs:
- `cto/p0-finalize-fixtures` / `cbecb37` (handoff summary).
- `cto/p0-finalize-fixtures` / `ead8e4c` (P0-ACTUAL-STATE).
- `cto/p0-exact-pending-commit` / `6fe6b67` (roadmap).
- `claude/p0-mls-durability-ci` / `99fd3e0` (parent/source branch in P0-ACTUAL-STATE).
- UI `ui/beta1-api-integration` / `e83858b`, `97d08fd`.

Это может быть цепочка последовательных snapshots, но пока bundle refs/commit graph не осмотрены, не утверждать, что один файл является самым свежим. Сравнить bundle list-heads, verify, commit ancestry и diffs. Сохранять original history.

## 4. Ограничения текущего доступа

- Library list/search/read доступны для текстовых материалов.
- В предыдущем сеансе `files__materialize` для bundle/zip завершился ошибкой: нет authorized raw-byte materialization path.
- `files__read` не является способом распаковки бинарных архивов.
- GitHub connector может читать GitHub и выполнять GitHub API операции, но не заменяет обычный Git transport для публикации локального bundle с полной историей.
- Не утверждать, что архив импортирован, опубликован, проверен или объединён, пока это не выполнено реальным инструментом и подтверждено SHA/CI.

Если способ получения байтов изменится, сразу использовать существующие Library files; владельца не просить повторно загружать те же файлы.

## 5. Обязательные метаданные для любого нового артефакта

Каждый source bundle/zip/patch, добавленный в дальнейшем, должен сопровождаться:
- exact file name and storage path;
- SHA-256;
- branch/ref and commit SHA;
- parent/base commit and intended target;
- creation timestamp with timezone;
- applied patch list;
- exact tests run and output summary;
- known blockers;
- whether published to GitHub, PR URL and Actions run URL.

Для каждого нового CI результата указывать commit SHA, workflow/run URL, job status и тестовый scope.

## Дополнение — 2026-11-08: сохранённые текстовые артефакты

Ветка `recovery/source-artifacts-2026-11-08` / draft PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17) содержит точные текстовые представления, прочитанные из Library:
- Patches 016–020;
- `P0-ACTUAL-STATE-2026-11-08.md`;
- `P0-CTO-ACCEPTANCE.md`;
- `MLS-FLUTTER-BRIDGE.md`;
- `BETA-1.0-SCOPE.md`;
- `InOne-screen-design-spec-v0.8.md`;
- `PATCH-COMPATIBILITY-REPORT.md`.

Они являются reference artifacts, не заменяют оригинальные ZIP/Git bundles и не содержат полный Flutter source. Проверка показала, что patch stack 016–020 нельзя применить к архивному GitHub 0.6.0 дереву. Оригинальные бинарные файлы остаются в Library и должны быть экспортированы через разрешённый raw-byte механизм, прежде чем выполнять source import.

## 6. Owner-provided P0 Wave 3 bundle — received and verified 2026-11-08

- Container upload: `Bundle(1).zip`; contents: `inone-engine-p0-wave3.bundle`, `BUNDLE-VERIFICATION.txt`, `ARCHITECTURE-MAP.md`.
- Git bundle SHA-256: `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`.
- Size: 1,052,468 bytes; `git bundle verify` passed; complete five-commit history.
- Ref: `refs/heads/engine/p0-wave3`; HEAD: `a7f60b6fdc969941e4354a117e17d32bfc951fb9`; declared base: `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.
- Bundle report states no common commit with GitHub main. Preserve it as a separate lineage; no force-push.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) contains a compressed base64 patch derived from this bundle and a CI workflow. It is not the original bundle and does not preserve its original commit ancestry.
- The original bundle bytes and companion architecture map still need to be placed in a durable, retrievable GitHub location with checksum verification. Until then, mark original archive preservation as pending.
- JavaScript/MJS syntax check of extracted source: 135 files PASS (syntax only). Full Node/DB/Rust/Flutter/device acceptance remains separate and must be evidenced by CI or device runs.


## 7. InOne ↔ Propo authentication integration brief — 2026-11-08

- The owner-provided `INONE_INTEGRATION_BRIEF.md` is preserved in [development/integrations/INONE-PROPO-AUTH-INTEGRATION-BRIEF.md](../../development/integrations/INONE-PROPO-AUTH-INTEGRATION-BRIEF.md).
- It is explicitly marked Planned; no InOne-side implementation is assumed. Propo owns its own account mapping, challenge validation, UI, and session/token issuance.
- Do not implement production integration until the listed identity subject, private chat initiation/delivery, S2S authentication, callback/receipt, consent, recovery, and retention decisions are resolved and the contract is versioned.
