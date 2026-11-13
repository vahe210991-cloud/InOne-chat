> **OWNER UI SOURCE ARCHIVE — verified 2026-11-09:** Original `Ui.zip` is stored on `main` (owner upload commit `2050aa7c9fa6ba418bb06fa81964274b6f854a3a`), SHA-256 `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`. PR #36 imports its nested `ui-approval.zip` into `mobile/assets/ui-approval/`; package manifest v0.8-approval-batch-2, 24 manifest screen IDs, 31 approved HTML screens, 5 WOFF2 fonts. CI run [#42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987) passed Flutter analyze/tests and Android preview build after import. Post-import task branch head: `cb09a4058719576df6d589f1f8b59be517b592b5`. This source archive is distinct from the Android APK artifact. Native WebView rendering and live API/bridge acceptance remain pending. Keep PR #36 draft/open pending exact-head CI and owner authorization.

# InOne — источники истины и карта артефактов


> **ТЕКУЩИЙ ИСТОЧНИК ИСТИНЫ — 08.11.2026:** P0 закрыт в `main` на merge commit `97024ab03ce9583e298ee946f3679565007405ca`. PR #25 merged; шесть CI jobs прошли на PR head (run #124). Владелец прислал бандл `InOne-P0-snapshot-2026-11-08.bundle`; его постоянная копия хранится в GitHub branch `artifacts/p0-bundles`, путь `bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`, SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`. Не запрашивать повторную загрузку. Детали: [P0 closure report](../../development/recovered-source/P0-CLOSURE-2026-11-08.md) и [artifact retention](../../development/ARTIFACT-RETENTION.md). Нижеследующие старые записи сохранены как история.



> **ТЕКУЩИЙ ИСТОЧНИК ИСТИНЫ — 08.11.2026:** P0 закрыт в `main` на merge commit `97024ab03ce9583e298ee946f3679565007405ca`. PR #25 merged; шесть CI jobs прошли на PR head (run #124). Владелец прислал бандл `InOne-P0-snapshot-2026-11-08.bundle`; его постоянная копия хранится в GitHub branch `artifacts/p0-bundles`, путь `bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`, SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`. Не запрашивать повторную загрузку. Детали: [P0 closure report](../../development/recovered-source/P0-CLOSURE-2026-11-08.md) и [artifact retention](../../development/ARTIFACT-RETENTION.md). Нижеследующие старые записи сохранены как история.


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


## 8. Repository tree audit and exact P0 test fixtures — 2026-11-08

- [Repository / Flutter source audit](../../development/REPO-AUDIT-2026-11-08.md) records full main and active-branch tree checks; no complete Flutter app is present.
- Original biometric client source is in `inone-development-archive-0.6.0/client-reference/biometric-client.mjs`, blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`; same exact blob restored under engine/client-reference for P0 tests.
- Original vector fixture is in `inone-development-archive-0.6.0/client-reference/vectors/biometric-vectors.json`, blob SHA `5a00755946219df2527591f00058a19d167c7811`; same exact blob restored under engine/client-reference/vectors.
- P0 recovery validation remains in PR #18. Current workflow correction commit `e0a8c08ddf68864963c3f8a65ba16a0612381e39` copies the restored reference files into the clean main-based published source branch before patch application.


## 9. Original bundle binary provenance — 2026-11-08

- Current upload `Bundle(1).zip` outer SHA-256 `a7ccfc12ae810dc1788f1b737ef4d53e032cafaf35797412784073a2db57f5a0`; inner bundle SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`.
- Inner bundle verifies complete, 5 commits, P0 ref `engine/p0-wave3` at `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.
- Binary storage status and connector limitations: `development/recovered-source/README.md`. GitHub base64 blob API exists; current container-to-Code-Mode byte transfer is the blocker.


## 10. Published P0 recovery source — checked 2026-11-08 12:00 UTC+3

- Canonical published recovery branch for the current P0 review: `recovery/p0-wave3-applied`, checked HEAD `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`.
- Draft PR [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22) remains open and unmerged.
- P0 validation executes source from `inone-development-archive-0.6.0/engine/`; a separate `inone-engine-poc-0.6.0/` tree exists and must not be assumed identical.
- Exact-head Actions runs: [42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and [42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297). Node 369/369, room regression 2/2, PostgreSQL 43/43, OpenMLS client tests and Rust bridge 3/3 passed. Overall workflow failed only at Rust formatting (`cargo fmt -- --check`, 12 files).
- Source-integrity audit remains open: complete 240-file blob-hash comparison against the original bundle manifest; review six modified source files and five added P0 tests against exact bundle/patch provenance.
- Full details and exact next actions: [P0-GITHUB-RECOVERY-STATUS-2026-11-08.md](../../development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md).
- Original bundle binary SHA-256 remains `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`; the original binary and its original five-commit ancestry are not yet stored in GitHub. The published patch-derived branch must not be represented as that original bundle history.


## Owner-provided Beta 1.0 UI source — Ui.zip (2026-11-09)

- Attachment name: `Ui.zip`; outer SHA-256: `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`.
- Contains nested `ui-approval.zip`; SHA-256: `d098738ff64fab0388aa72d22a92b097940c41bbcb4acfddfc30ff745e16ad0d`.
- Both ZIP integrity checks PASS. Nested package: 231 entries, 7,432,843 uncompressed bytes, 24 manifest screens, 31 HTML screens total, five WOFF2 fonts, iOS/Android light/dark screenshots and state screenshots. All 10 entries in `approved.sha256` PASS.
- Manifest version `0.8-approval-batch-2`; source files include `screen-manifest.json`, v1/v2 design tokens and interactions, API integration docs, screens and screenshots.
- Source audit and unresolved API/security notes: [UI integration report](../../development/reports/2026-11-09-1015-ui-integration-start.md).
- Status: **verified locally, not yet durably imported to GitHub**. Do not remove the original owner attachment or treat temporary extracted files as authoritative. Upload is blocked until a supported Git transport/Codespace or binary upload path is available. Do not claim the source bundle is in GitHub until its remote hash is verified.

## 11. Owner-approved product direction — two applications (2026-11-13)

The owner has approved a two-application product structure:

- **InOne** is the personal/social application: news feed, publications, personal chats, groups, Threads, and related social communication features.
- **InOne Business** is the professional/work application: Kanban, CRM, Leads, Deals, Wallet, Flags, and other business tools, with integration/interoperation with **Propo Seller Account**.

This is an authoritative product-boundary decision. Requirements, screen inventories, navigation, UX, and release scopes must identify which application owns each capability. Do not design the two products as one combined app/navigation.

The product split does not automatically imply separate or shared identity services, databases, backends, repositories, infrastructure, or UI foundations. Those remain governed by existing approved decisions or require separate ADRs. Existing InOne Beta 1.0 screens and implementation must be audited and classified before any migration or code change. See [owner decisions](DECISIONS.md#7-product-split-inone-and-inone-business--2026-11-13).


## 12. New platform architecture baseline — 2026-11-13

- Root architecture directory: architecture/README.md.
- Product vision: architecture/PRODUCT-VISION.md.
- Product boundaries: architecture/PRODUCT-BOUNDARIES.md.
- Target system architecture: architecture/SYSTEM-ARCHITECTURE.md.
- Domain model and organization access: architecture/DOMAIN-MODEL-AND-ACCESS.md.
- Architecture laws: architecture/ARCHITECTURE-LAWS.md.
- Owner questions: architecture/OPEN-OWNER-DECISIONS.md.
- Development plan: development/architecture/README.md.
- Status: version 0.1 draft; product direction derives from owner statements, technical topology and role details remain proposals/open decisions.
- For the restart, historical code and CI are technical reference only, not accepted product completion. Read development/architecture/REPOSITORY-REBASELINE.md before reuse.


## InOne Identity Stage 0 package — 2026-11-13

Task branch: stage0/identity-readiness-2026-11-13 (based on architecture branch at 05bc226526d9c984b6ccb2b9f44dbad8459dcd6e). See report development/reports/2026-11-13-1326-identity-stage0-readiness.md.

Artifacts:
- architecture/IDENTITY-STAGE-0-READINESS-PACK-V0.1.md
- architecture/identity/ADR-001-RUNTIME-AND-IDENTITY-PROTOCOL.md
- architecture/identity/contracts/openapi.json
- architecture/identity/contracts/event-envelope.schema.json
- architecture/identity/contracts/event-examples.json and event-examples.schema.json
- architecture/identity/contracts/client-registry.json and client-registry.schema.json
- architecture/identity/ops/ENVIRONMENT-CONTRACT.md
- architecture/identity/ops/LOCAL-DEVELOPMENT.md
- .github/workflows/identity-contracts.yml
- services/identity/README.md
- development/AI-AGENT-MANDATE.md restored verbatim from the existing mandate branch (source blob SHA 80a36b484b48019e1200d521bde520d0419a2054).

Status: documentation/contract scaffolding only; no executable Identity service, migrations, secrets, database, containers or deployment. JSON parse/reference scan passed; contract CI not run. Complete clone blocked by DNS resolution. Do not treat this branch as main or Stage 0 as accepted until the blocker and exact-head CI are resolved.
