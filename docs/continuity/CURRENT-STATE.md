# AUTH implementation addendum — 2026-11-26

This is an active, unmerged Beta 1.0 implementation branch, not a main/release acceptance record.

- Canonical plan: [AUTH registration/login/recovery plan](../../development/AUTH-REGISTRATION-LOGIN-RECOVERY-BETA-1.0-PLAN.md).
- Implementation audit: [2026-11-26 AUTH report](../../development/reports/2026-11-26-auth-beta1-implementation-audit.md).
- Mobile screen/API matrix: [API-CONTRACTS-BETA-1.md](../../mobile/API-CONTRACTS-BETA-1.md).
- Working branch: `feat/auth-senior-backend-implementation-2026-11-26`; current implementation snapshot before continuity updates: `9d1e46a406feb40a77cca3fafafb8d0e8bc8d73b`.
- Base `main`: `7d34b99fcc026a828b838e211d039c575aeace1d`; branch comparison: 80 ahead, 0 behind. The branch preserves parallel migration-runner/schema test changes; it was forked to avoid further concurrent writes to the original AUTH branch.
- Implemented in source but not yet accepted: registration email-enumeration protections; atomic registration ticket/account transaction; retry-safe recovery finalization; expiring/device-bound identity challenges; bounded password policy; host-controlled device approval and recovery screen wiring.
- Verification: **NOT RUN**. No test, build, CI or device result is PASS until executed on one exact final SHA.
- Blockers: phone verification policy/SMS UI (AUTH-03); recovery-channel approval (AUTH-08, current backend: email code for unverified-phone accounts without provider links, SMS code plus email-link for verified-phone accounts, provider sign-in only for provider-linked accounts without verified phone; native provider flow is blocked); Rust/platform persistent session restoration (AUTH-09); biometric grant for protected signing-key approvals (AUTH-04); native Google/Apple proof acquisition; SC-09 D8 warning copy.
- All AUTH task checkboxes remain open. No product source has been merged to main.

---

# Current state addendum — FEED / PROFILE audit (2026-11-26)

This addendum is newer than the historical post-PR #131 snapshot below. Fetch live `main` before further work; the FEED/PROFILE audit and its follow-up records were documentation-only.

## FEED / PROFILE

- Source snapshot audited: `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`.
- Revalidated main before publication: `920e2a2ecef244c925061348eb68c8b09fe63922`; the two commits since the source snapshot changed only development rules.
- Implementation plan: [FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md](../../development/FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md).
- Audit report: [2026-11-26 FEED / PROFILE audit](../../development/reports/2026-11-26-feed-profile-beta1-audit.md).
- Plan initial publication commit: `8260beb7070d959dce17ee423e2768dbea4399c9`; plan publication-record correction: `9166a82448d2e06847e7212982aeecaf0acb9f19`; current plan blob: `08b1f984a3ded0543d5c20670c9b4e1d5d6e07ab`.
- Audit report initial publication: `e43632e0f1e78742f193793c0dc3558cc910b689`; report reference update: `06862d1458035c868ad01606bcb4dda50669a1e4`.
- FEED/posts: not implemented or connected in the reviewed production source.
- PROFILE: own-profile read and locale update exist; general edit, other-user profile API and avatar/cover binding are absent.
- Generic file upload/download authorization exists; social/profile media lifecycle does not.
- Owner-approved privacy variant В: preserve existing privacy behavior. No new public/private, visibility, block/follow semantics or expanded access. Missing policy does not imply public access.
- Audit finding counts: P0 0; P1 1 conditional on Feed being approved for Beta 1.0; P2 6; P3 1. No confirmed P0/P1 security vulnerability was established by static review of existing profile/file routes.
- Tests, builds, dynamic security testing, production checks and physical-device acceptance were NOT RUN. Do not infer PASS from test-file presence.
- WBS v1.1, its percentages, product privacy policy and release boundaries are unchanged. Feed Beta 1.0 scope remains pending owner decision.
- No product source, schema/migration, workflow, configuration or Flutter UI was changed.

## Next FEED / PROFILE actions

1. Resolve `SCOPE-001`: Feed in Beta 1.0 or Beta 2.0; do not alter WBS without explicit approval.
2. Add and run current own-profile/auth/privacy regression tests under `PROFILE-CORE-001` and `PROFILE-PRIVACY-001`.
3. Preserve existing relationship/owner/device/room access checks; do not invent new privacy semantics.
4. If Feed is approved for Beta 1.0, version the WBS change first, then follow the plan's security-first task dependencies.
5. Keep public-profile and public-media routes blocked until their required access policy is explicitly approved.

---

# Current state — post-PR #131 Beta 1.0 acceptance (2026-11-23)

## Source of truth

- Repository: `vahe210991-cloud/InOne-chat`.
- Current `main`: `2430b0365ab71c60b0926b27854d17a9090e1fba`.
- PR #131 is merged. Do not repeat its implementation or copy it from older branches.
- Current audit/remediation branch: `work/mls-production-acceptance-2026-11-23`, based directly on the above main SHA; work is tracked by draft PR #132. No changes have been merged to main.
- WBS v1.1 is unchanged. Percentages in the audit are engineering estimates, not WBS changes.

## Post-merge CI state

- PR #131 exact-head checks were reported as 19/19 PASS.
- PR #131 head `984d9e2afa6734ac14269fdee6ad787df84b123b`: 19/19 individual check jobs PASS across the retrieved PR-head workflow runs.
- On merge SHA `2430b0365ab71c60b0926b27854d17a9090e1fba`, the Actions REST run list returns 9 push workflows: 8 completed PASS (Backend Docker Compose, OpenMLS client, Dev Container Compose, Email/PostgreSQL, recovered P0 source, Flutter iOS, Flutter mobile, OpenMLS Flutter Rust Bridge including iOS native assets).
- `OpenMLS Flutter Rust Bridge generation`: main job PASS, including iOS native-assets compile. Android build and Android Keystore emulator smoke passed.
- `Native MLS client validation`: exact-source check, canonical Engine B regression tests, persistent bridge host tests and attachment/session integration tests passed. The iOS Keychain native-target build was cancelled in attempt 1; its job log was unavailable. A targeted job rerun was accepted and is QUEUED in attempt 2.
- The exact-SHA acceptance gate is configured for pull_request events only, so it is N/A for a main push; each applicable main workflow verifies its own exact source SHA. Do not claim main exact-SHA validation complete while the two iOS-related jobs remain pending.
- PR #132 code-validation head `87930a5997b9ceb7aea44409b1e0d07020d3c82f` triggered nine PR workflows (including the exact-SHA acceptance gate); all nine were QUEUED at 16:23Z. The latest follow-up commits only update reports/continuity docs; they do not change Rust/Flutter source. No completed test result is available yet for the Welcome, invalid-UTF-8 or 401/403/404 regressions.

## Architecture and implementation facts

- Production `mobile/rust/Cargo.toml` points to canonical Engine B at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`. Engine A is not the production runtime.
- PR #131 integrates native Flutter screens/backend, G2 organization requests, canonical Engine B FFI, durable inbox/outbox, encrypted attachments, session resume/retry, organization roles/invites, device inventory/revocation and room metadata/settings/permissions/read markers.
- `INONE_MLS_NATIVE_ENABLED` remains false by default. Source presence and PR-head CI do not authorize enabling it.
- Approved HTML screens remain visual references. Production UI is Flutter/Dart.
- Beta 1.0 registration remains local as previously approved. InOne Identity remains a separate next phase.

## P0 — MLS crash consistency, Issue #1

- OpenMLS provider and client journal share one SQLCipher connection. A transaction-aware provider is used for inbound application messages and inbound Commit processing.
- `tests/outbox.rs` contains child-process restart tests using actual SQLCipher files for application ratchet writes, inbound Commit merge/commit, and inbox journal boundaries. The ADR states SQLite default journal mode is used; WAL is not enabled and WAL-specific recovery is not proven.
- Audit found a remaining Welcome gap: group materialization, `client_rooms` and Welcome receipt were not atomic.
- Draft PR #132 adds a transaction-aware Welcome materialization/receipt change and five crash failpoints; child-process SQLCipher restart coverage was added for five boundaries. These changes are not yet compiled or executed.
- Outbound Commit server-acceptance/reconciliation and full Flutter/native ACK lifecycle remain separate proof gaps. Keep Issue #1 open.

## P1 — MLS issues

- #114: canonical Engine B production dependency and current FFI/Dart adapter are present. No Engine A migration is required. Keep open for exact-SHA and physical runtime proof.
- #6: durable SQLCipher inbox, pending replay and explicit ACK are present; child-process and restart tests exist. Keep open for exact-SHA and Flutter/native physical ACK proof.
- #5: invalid UTF-8 maps to an unreadable inbox record; crash-boundary test includes invalid bytes. A same-room follow-up-valid-message regression was added on PR #132 branch; it asserts no desync and unchanged epoch, but has not been compiled/executed.
- #9: typed API failure classification exists. A real sync-path 401/403/404 TCP-proxy regression was added on PR #132; it must still execute and pass to prove no RecoveryRequired.
- None of these issues is closed.

## Push, recovery and operations

- Backend FCM sender and encrypted PostgreSQL push outbox are implemented and wired through `engine/src/main.js`; the worker starts/stops with the server when configured. Payload is restricted to generic `type/event_id/path`.
- Flutter Firebase initialization, FID registration/refresh, APNs readiness check, foreground/open/terminated receive handling and MLS-gated navigation exist. Live provider acceptance and physical Android/iOS display/open tests have not been run.
- Beta recovery custom scheme `inone://recovery/confirm` is registered by generated Android/iOS build scripts. Production Android App Links/iOS Universal Links are not configured; no production domain or association files are supplied.
- Backup/restore scripts and PostgreSQL/object-file tests exist. Database and object-file backups are separate operations, not one atomic cross-store snapshot. No production restore rehearsal, alerting/monitoring acceptance, live HTTPS/proxy deployment, SMTP sender-domain/SPF/DKIM/DMARC acceptance or production secrets provisioning is evidenced.

## Physical acceptance

No physical two-device Android/iOS acceptance is recorded. Emulator/CI builds are not device acceptance. Pending scenarios include Welcome, bidirectional text, outbox/retry/dedup, encrypted attachments, process kills, ACK, device revocation/removal, recovery, logout/key purge, and 401/403/404 handling.

## Current estimates (not WBS v1.1)

- Engineering implementation: **90%**.
- Verification: **73%**.
- Release readiness: **58%**.
- Recommendation: **NOT READY** for Beta 1.0 acceptance until P0/P1 proof and physical-device gates pass.

---

# Historical continuity log — P2 Push and Profile audit (2026-11-20)

- A2 PR #102 is already merged to `main`: `df20bef8df05b3ab2e11b20cb91e8f2bca60eec0`. Do not repeat A2.
- P2 audit branch: `audit/p2-push-profile-2026-11-20`, created from `main` SHA `974f944d251870ca57fad5124f058b9d65d12a26`.
- Audit report: [2026-11-20 P2 Push and Profile audit](../../development/reports/2026-11-20-P2-push-profile-audit.md), report commit `acbbe1653046d2f01b1efb6efa5d4a40350b7638`.
- Backend push routes/store lifecycle and four focused push test cases exist in canonical engine source. Source reviewed only; tests NOT RUN in this audit.
- Flutter push integration is incomplete: no FCM/APNs token plugin in pubspec, no typed push repository methods, and no production ST-01 registration callbacks found. Backend sender is injected; production provider wiring is not verified.
- Profile GET and PATCH locale exist. General profile edit route is not present in the reviewed contract/source. Owner decision on editable fields is required.
- No product code or API contract changed. No tests/builds run. Native MLS/release gates untouched. WBS v1.1 unchanged.

---

# A2 FRB reconciliation — current state (2026-11-19)

- Current `main` HEAD: `c939634288db1e7105cfe8d6a7182d4469da1dc4` (A1 merge, PR #95). Do not repeat A1.
- A2 task branch: `feature/a2-frb-reconciliation-2026-11-19`; initial audit report commit: `3f6270d54880cc621745b6f67204ab7587f51f5e`.
- Source inventory: 30 Rust public functions; 25/25 Dart interface methods overridden by the production adapter. Generated FRB files are absent by documented design; actual generated binding/type/error verification is pending.
- Current-main lockfile mismatch: `pubspec.yaml` declares FRB and hooks, while `pubspec.lock` omits both. Open PR #90 adds both packages at 2.13.0 but is 30 commits behind current main; PR #94 is stacked on #90. Both modify A2 target files and must be reconciled before those paths are edited.
- Pipeline audit: mutable branch refs in the dedicated artifact workflow, inconsistent SHA conventions across workflows, divergent FRB integrate flags, and lockfile regeneration without enforced locks. See the full report for P1/P2 classification and API mapping.
- A1 post-merge runs #44519837539 / #44519837547 / #44519837614 were still queued or in progress at the latest check; none had a confirmed successful conclusion. Exact job states are in the report.
- No source code or release gate changed. A2 is NOT ACCEPTED. Native MLS remains disabled. Approved WBS v1.1 baseline remains 42% implementation / 31% verification.

---

# Screen API integration update — 2026-11-12

New implementation branch: `feature/beta1-screen-api-integration-2026-11-12`.

- A1 remains complete and is reused, not repeated.
- B1 inventory generator and tests added: `scripts/audit-screen-api-contracts.mjs`.
- D1/D2 ownership decision: canonical backend = `inone-development-archive-0.6.0/engine`; Flutter FRB = `mobile/rust`; canonical persistent MLS dependency = `inone-engine-poc-0.6.0/mobile-mls/mls-client`; standalone `mls-bridge` is not the Flutter dependency.
- B2/B3 source route reconciliation and backend HTTP smoke test added. SC-01/02/03/04/11/12 have explicit auth API dispatch; CH-01 additionally has the typed GET /rooms/mine screen-scoped dispatch and safe data binding. Most other screen APIs remain backend-only or UI-only and must not be represented as connected.
- C2/C3 first vertical slice: host-only registration ticket + automatic authenticated login; per-screen WebView API allowlist.
- Report: [screen API integration and bridge ownership](../../development/reports/2026-11-12-screen-api-integration-and-bridge-ownership.md).
- Historical verification: [baseline](../../development/reports/2026-11-12-historical-test-evidence-baseline.md).
- New scripts and tests are NOT RUN; existing P0/Stage 3 historical PASS results apply only to their exact recorded SHAs.
- Native MLS stays disabled. Stage 4 remains NOT ACCEPTED / BLOCKED. No merge or WBS change.

---

> **UI SOURCE IMPORT UPDATE — 2026-11-09 12:11 (UTC+3):** Owner-provided `Ui.zip` is now present on the PR #36 task branch at `mobile/assets/ui-approval/`. CI run [#42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987) passed all 15 steps: archive SHA verification, nested package import, 73-screen gallery check, Flutter pub get/analyze/tests, Android preview APK build and artifact upload. Run event SHA: `478cad39bc39e8002e55293e3015e72b68e26c8c`; import bot advanced branch head to `cb09a4058719576df6d589f1f8b59be517b592b5`. Remote tree contains 31 screen HTML files, 32 HTML including index, and 5 WOFF2 fonts. PR #36 remains draft/open/unmerged. Runtime WebView rendering, live bridge/API integration and device acceptance are NOT YET VERIFIED. WBS v1.1 unchanged. See [stage report](../../development/reports/2026-11-09-1211-ui-archive-import-ci.md).

# InOne — текущее состояние проекта


> **ИТОГОВЫЙ СТАТУС — 08.11.2026:** этап P0 (backend / Rust / OpenMLS) ЗАКРЫТ. PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) объединён в `main`, merge commit: `97024ab03ce9583e298ee946f3679565007405ca`. Все 6 обязательных CI-проверок прошли на PR head `addd47da245b6452c9f700c7e10b8d0585aad295`, [запуск #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362). Оригинальный бандл постоянно хранится в ветке `artifacts/p0-bundles`; см. [правила хранения](../../development/ARTIFACT-RETENTION.md) и [отчёт о закрытии P0](../../development/recovered-source/P0-CLOSURE-2026-11-08.md). Постслиянийная проверка main завершилась успешно: [CI run #134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744), все 6/6 jobs PASS. Последующие изменения `main` после merge — только документация закрытия P0. Нативная интеграция Flutter Beta 1.0 — отдельный следующий этап. Исторические записи ниже сохранены для хронологии.


**Срез:** 2026-11-08 08:25 (UTC+3)  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Default branch:** `main`  
**Документ — снимок состояния, а не обещание готовности к релизу.**

## 1. Краткий статус

| Направление | Оценка реализации из последнего CTO roadmap | Подтверждённая проверка | Статус |
|---|---:|---:|---|
| Backend P0 / MLS | 100% | 100% | PR #25 merged; all six acceptance CI jobs passed on the final PR head |
| UI Beta 1.0 | 70% | 0% | Flutter-код и тесты подготовлены локально; Flutter SDK отсутствовал |
| UI ↔ API ↔ MLS | 50% | 0% | Контракты и session handoff подготовлены; native handlers и local message store отсутствуют |
| Сквозной Beta 1.0 | 0% | 0% | Не начинался |
| Подготовка тестирования | 60% по ранее согласованному рабочему учёту | См. ниже по конкретным наборам | Не является процентом пройденного acceptance |

Проценты реализации — прежняя оценка объёма работ, а не автоматический расчёт и не подтверждение готовности. Не обнулять и не пересчитывать их без ревизии исходников. В отчётах всегда отдельно указывать реализацию и верификацию.

## 2. GitHub — проверенное состояние на момент снимка

- `main`: `dd45ae1e660cf2f8ad0ef67e3c5928bd9329a3a9`.
- `development`: `9b2352235569484cf2e82e38167497dcf6de355d`.
- `engine-poc`: `9b2352235569484cf2e82e38167497dcf6de355d`.
- `ci/inone-engine-validation-2026-11-07`: `e9bbe3ee44077aef9d11cf8804f6c760c727a89e`.
- `docs/inone-identity-design-localization`: `26940241fc84e1a013d717d9a9a883bf5dbe2741`.
- `cto/inone-audit-2026-11-08`: `a07815227ecf004628f5b3b94154a4f16de8d1bd`.

Состояние refs получено из GitHub API в этом сеансе. Перед любым push/PR повторно запросить актуальные SHA — refs могли измениться.

### Важное разграничение

GitHub `main` содержит архивные материалы 0.6.0, планы 0.7 и документы решений. Он **не является** текущей локальной P0/UI рабочей копией, описанной в Library handoff-файлах. PR #10 и Actions run #42395014895 относятся к архивному снимку 0.6.0 и не доказывают готовность текущей P0-ветки.

Ранее в Library зафиксированы локальные ветки и коммиты, не опубликованные в GitHub:
- Backend `cto/p0-finalize-fixtures`, commit `cbecb37`; в другом, более раннем P0 snapshot — `cto/p0-exact-pending-commit`, commit `6fe6b67`.
- UI `ui/beta1-api-integration`, commits `e83858b` и `97d08fd`.

Документ P0-ACTUAL-STATE в Library указывает ещё одну рабочую ветку `cto/p0-finalize-fixtures` с commit `ead8e4c` на исходнике `claude/p0-mls-durability-ci` (99fd3e0). Это разные снимки/состояния; **не объединять и не объявлять один из них каноническим без сравнения Git bundle refs, commit ancestry и diff**.

## 3. Проверки — что реально известно

### PASS (узкие проверки, не полная приёмка)
- JavaScript/MJS syntax: 127/127 PASS в последнем P0-ACTUAL-STATE.
- Фокусированный Node-набор: 13/13 PASS для перечисленных наборов: `mls-memory-store-claims`, `mls-wire`, `client-screens-common`, `org-error-codes`.
- Статическая целостность миграций: 25 миграций, последовательность и markers совпадают, `SCHEMA_VERSION = 0026-mls-commit-metadata-and-claims`.
- `git diff --check`: PASS.
- В более раннем roadmap указаны focused tests 12/12 и отдельные client-screen common/auth contract 10/10. Не смешивать эти результаты: это разные снимки и наборы.

### BLOCKED / NOT RUN
- Полный `npm test`: BLOCKED — в неполном `node_modules` отсутствуют `qrcode`, `pg` и другие зависимости; 74 из 85 файлов/поднаборов завершились ошибкой загрузки до тестовой логики. Это не 74 доказанных функциональных регресса.
- PostgreSQL acceptance и `npm run test:db`: BLOCKED — PostgreSQL server/client и часть npm dependencies отсутствуют.
- Rust `cargo test`, `cargo check`, `cargo fmt --check`: BLOCKED — Rust/Cargo/rustfmt не установлены в среде предыдущего исполнителя.
- Flutter `flutter analyze` и `flutter test`: BLOCKED — Flutter/Dart SDK отсутствуют.
- End-to-end Beta 1.0: NOT RUN.

## 4. Содержание P0-работы в локальных материалах

По документу P0-ACTUAL-STATE от 2026-11-08 в рабочей копии были:
- F4: membership journal с SHA-256 fingerprint, связывающим room, operation ID, точный payload и сериализованный OpenMLS pending staged commit; settlement только при точном совпадении.
- P0.2: серверные membership metadata (adds/removes/removeDevices) сверяются с фактическим MLS результатом; при несовпадении транзакция откатывается и Commit помещается в quarantine.
- P0.3: durable SQLite quarantine с ключом room/epoch/commit hash, причиной и защитой от повторной обработки после рестарта.
- Idempotent Key Package claims/replay: claim ID scoped к инициатору/устройству, точный повтор выдаёт тот же пакет, другой target получает 409.
- Миграция `0026-mls-commit-metadata-and-claims.sql`, обновлены schema/migrate/version marker.

Это описывает локальный исходник из Library; пока соответствующая ветка не опубликована и не прогнана в CI, это не считается GitHub-верифицированным результатом.

## 5. Beta 1.0 — зафиксированная граница

Beta 1.0 включает email/password auth, подтверждённую регистрацию, recovery, чаты/список комнат, организации, профиль и общую API session. Tasks, Calendar и Cindy (AI assistant) **исключены из Beta 1.0**. Не возвращать их в навигацию или release gate без нового решения владельца.

Ограничения:
- Flutter MethodChannel adapter существует как Dart-контракт, но Android/iOS native handlers и FFI packaging не реализованы.
- Нет durable local message store; incoming events нельзя ACK-ать до локальной транзакции persistence.
- MLS send/decrypt остаются fail-closed; plaintext fallback запрещён.
- Profile editing не подключён: серверный GET есть, update endpoint отсутствует.
- Фильтр комнат по выбранной организации не заявляется: контракт `/rooms/mine` не содержит active-org filter.

## 6. Следующие обязательные этапы

1. Получить доступ к реальным байтам Library bundles/patches в рабочей среде (или восстановить локальную копию через поддерживаемый механизм). Не просить владельца повторно присылать то, что уже лежит в общей Library.
2. Сравнить все P0 bundle refs, commit histories и UI zip; выбрать точный source of truth без потери истории.
3. Опубликовать точную ветку обычным Git transport (не искусственным snapshot commit и не force-push).
4. Запустить CI именно на опубликованном P0 SHA: Node, PostgreSQL 16 migrations/upgrade, Rust 1.91+ tests/fmt, Flutter analyze/tests.
5. Реализовать Android/iOS native MLS bridge, secure Keychain/Keystore key provider и durable local message store.
6. Выполнить device-level and end-to-end tests, затем PR и merge только после обязательных checks.

## 7. Безопасное правило слияния

Не сливать PR #10 вместо актуального P0. Не менять main на основании неподтверждённого архива. Сначала опубликовать и проверить конкретный source commit, зафиксировать CI run URLs и итоговые SHA; только потом принимать решение о merge.

## 8. Проверка восстановления исходников — 2026-11-08, текущая сессия

- Повторно проверена удалённая ветка `cto/inone-audit-2026-11-08` (HEAD `a07815227ecf004628f5b3b94154a4f16de8d1bd`). Она содержит архивный engine 0.6.0 и ограниченный 0.7 client-screens API/state spike; актуальных P0/UI веток в удалённых refs нет.
- Library `/InOne` действительно содержит два P0 bundle, backend MLS session ZIP, Beta 1.0 UI/API ZIP r2, design-system HTML и сопутствующие acceptance/roadmap/patch документы.
- Повторный запрос raw-byte materialization для пяти основных артефактов завершился одинаковым отказом: `This Project file does not have an authorized raw-byte materialization path.` Binary Files read также не предоставил доступное содержимое.
- Поэтому в этой сессии **не** импортированы bundle, не вычислены их SHA-256, не сопоставлены Git refs/diffs и не опубликован актуальный исходный код. Это технический блокер текущего рабочего окружения, а не завершённый этап.
- Подробности: [RECOVERY-ATTEMPT-2026-11-08](RECOVERY-ATTEMPT-2026-11-08.md).

### Принятое решение по базе данных

Beta 1.0 использует независимые базу данных и backend InOne. Общая operational database InOne + Propo отложена до следующей версии беты; это решение зафиксировано в [ADR-011](ADR-011-BETA1-INDEPENDENT-DATABASE.md). Для Beta 1.0 сохраняем стабильные глобальные ID и независимость от Propo, но не строим сейчас общую БД.
## 9. Patch preservation and compatibility audit — 2026-11-08

- Создана отдельная ветка `recovery/source-artifacts-2026-11-08` и draft PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17). В ней сохранены читаемые патчи 016–020, P0-ACTUAL-STATE, P0 CTO acceptance, MLS↔Flutter bridge contract, Beta 1.0 scope и screen design spec v0.8.
- Это reference artifacts only; код P0 bundle и Flutter ZIP не импортирован. `main` не содержит production-code изменений от этой recovery ветки.
- Выполнена read-only проверка совместимости патчей с архивным исходником GitHub: текущий `lib.rs` blob `bbcfb53fa993ab1792735b6cf2bab13f4cfa0580`, `server.js` blob `9d466284fe69059dc31444b7b45fb624025a07b9`. Patch 016 Rust context не совпадает; Patch 017/018 server context не совпадает; Patch 019 Rust context не совпадает; Patch 020 ссылается на отсутствующий в архиве `mobile-mls/mls-client/tests/membership_outbox.rs`.
- Вывод: патчи 016–020 нельзя накатывать на архивный 0.6.0 source. Это другой/более поздний baseline. Сохранение patch files в PR #17 не означает их применения или прохождения тестов.
- Точный отчёт находится в `recovery/library-artifacts/PATCH-COMPATIBILITY-REPORT.md` на ветке recovery.
- По Library search не найдено отдельных `.dart`, `pubspec.yaml` или `.arb` исходников; Flutter source по-прежнему доступен только внутри недоступного ZIP r2.
## 10. Рабочее окружение текущей сессии

- `/mnt/data` проверен повторно: исходные архивы и рабочие копии не смонтированы.
- Доступны Git CLI и Node.js v22.16.0/npm.
- Не установлены `cargo`, `rustc`, Flutter, Dart и PostgreSQL client/server (`psql` не найден).
- Поэтому даже после текстового сохранения патчей нельзя запускать локальные Node/Rust/Flutter/DB тесты без восстановления соответствующего исходного дерева и зависимостей. GitHub Actions PR #10 остаётся проверкой только архивного 0.6.0 source.

## 11. Recovery update — owner-provided P0 Wave 3 bundle (2026-11-08 08:56 UTC+3)

This section supersedes the earlier section 8 statement that no bundle bytes were available in the working environment.

- The owner uploaded `Bundle(1).zip`; it contains `inone-engine-p0-wave3.bundle`, `BUNDLE-VERIFICATION.txt`, and `ARCHITECTURE-MAP.md`.
- Bundle SHA-256: `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`; size 1,052,468 bytes.
- `git bundle verify`: PASS; complete 5-commit history.
- Ref `refs/heads/engine/p0-wave3`; HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`; base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.
- Bundle protocol says this history has no shared commit with GitHub main. Do not force-push or claim original ancestry has been merged.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) stores a compressed patch derived from the bundle and a validation workflow. It is a patch-based recovery path; it does not preserve the bundle's original five-commit ancestry. Check live Actions status and any published source branch before making claims.
- Local JavaScript/MJS syntax check: 135 files PASS (syntax only).
- Product Flutter app source is not included in this P0 bundle. A runnable phone app is not yet established.
- New mandatory development handover folder is `development/`; see [development README](../../development/README.md), [working rules](../../development/WORKING-RULES.md), [baseline](../../development/BASELINE-2026-11-08.md), and [session log](../../development/SESSION-LOG.md).
- The original bundle bytes and architecture map are not yet confirmed as files committed to the GitHub repository. The PR patch is not a substitute for the full original bundle. Do not mark archive preservation complete until GitHub contains a verified retrievable copy or an approved artifact location and checksum.


## 12. PR #18 initial CI failure and source-tree correction — 2026-11-08

- Workflow run [42453233555](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42453233555) completed with **failure**.
- Node backend suite: 365 tests; 364 passed, 1 failed. Failing file: `test/client-reference.test.js`; cause: missing `client-reference/biometric-client.mjs` in the archived GitHub tree.
- This file exists in the verified bundle base commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`, blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`. It was restored to PR #18 branch in commit `04a490e9a01cf7523fb45205a8077f5f357c2658`.
- Workflow path filter was updated in commit `762e3eca8ccb2e34965441114cc29b63083aa0f9`. A fresh Actions run was not yet visible when checked; do not treat the old run as a pass or as validation of the new head.
- The first CI run proves the eight-file blob comparison was not sufficient to prove full base-tree identity. Check the entire source tree for additional missing files before acceptance.
- PostgreSQL and Rust steps were skipped because Node test step failed. No P0 acceptance is established.
- Detailed record: [development/recovered-source/CI-RESULT-42453233555.md](../../development/recovered-source/CI-RESULT-42453233555.md).


## 13. InOne ↔ Propo integration brief preserved — 2026-11-08

- Owner-provided `INONE_INTEGRATION_BRIEF.md` committed to `development/integrations/INONE-PROPO-AUTH-INTEGRATION-BRIEF.md`.
- Status remains Planned; the document explicitly states no InOne-side implementation is assumed. Production integration is blocked on open contract/security decisions; it is not a Beta 1.0 release dependency.


## 14. Corrected P0 validation reruns — live status snapshot

- PR #18 corrected head: `762e3eca8ccb2e34965441114cc29b63083aa0f9`.
- PR [#19](https://github.com/vahe210991-cloud/InOne-chat/pull/19) is a temporary duplicate validation trigger from the same corrected head; PR #18 remains primary.
- Actions runs [42454943853](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42454943853) and [42455077322](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42455077322) were still `in_progress` at the latest check. Patch decode/apply and npm dependency install passed; backend `npm test` was still running. PostgreSQL and Rust steps had not started.
- No fresh validation pass is established. Keep both PRs unmerged until the actual run results and source-tree completeness are reviewed.


## 15. Biometric vector fixture gap and corrective validation — 2026-11-08

- Corrected P0 CI runs [42454943853](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42454943853) and [42455077322](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42455077322) failed at Node tests: 368/369 passed. The only failure was ENOENT for `client-reference/vectors/biometric-vectors.json`; PostgreSQL and Rust steps were skipped.
- The original fixture was not recoverable from the currently accessible source. A replacement fixture was generated and explicitly labels its provenance as a replacement, not the original bundle asset. It contains two valid P-256/SHA-256 DER-base64url signatures and two altered-input negative cases. All four vectors were locally verified with Node crypto.
- Added to PR #18 branch in commit `bdedff6df54876e82f46a34d27f2fadfac42b46d`; workflow path filter updated in `ee7a877aedb43ca90df8cd410dbf536c2f436668`.
- New Actions run [42457009510](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457009510) is in progress. No CI acceptance is claimed yet.
- Duplicate PR #19 was closed as superseded; PR #18 is the sole primary P0 recovery PR.
- Do not merge until latest run completes all Node, room-list, PostgreSQL, OpenMLS, and Rust bridge checks. The replacement fixture should later be compared with the exact original bundle fixture if original bundle bytes become accessible.


## 16. Exact biometric fixture recovered; latest validation queued — 2026-11-08

- Further source-tree inspection found the original fixture in `inone-development-archive-0.6.0/client-reference/vectors/biometric-vectors.json` on main, along with the matching root `client-reference/biometric-client.mjs` (blob SHA `b03e72fe33c79e6b261d980bc86459babf03b388`).
- Restored the exact original fixture to the engine-relative path required by `engine/test/client-reference.test.js`. Original root blob SHA and restored engine blob SHA both equal `5a00755946219df2527591f00058a19d167c7811`.
- Re-verified the original fixture locally with Node crypto: 1 positive signature passes; 2 negative altered-input cases fail verification.
- The temporary generated fixture from commit `bdedff6...` was replaced in commit `c9eaf6e198d1b65549220d3742b5190d7bbc1a39` before acceptance. It is not present in the current PR head.
- Latest CI run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) is queued for the exact-source fixture. Previous run [42457009510](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457009510) used the temporary replacement and is superseded.
- Duplicate PR #19 is closed; PR #18 remains the only primary recovery PR and is not merged.


## 17. Full repository tree audit — Flutter app absent — 2026-11-08

- Audited main recursive Git tree SHA `89ba83a4cbd06b648cba8ea5a7c529bfd91285e7`: 602 entries, not truncated.
- Only five Dart source/test files and one Dart pubspec exist, all in `client-reference/dart`; the package README says `НЕ ПРОВЕРЕНО`, calls itself an organization API reference, and explicitly says there is no Flutter organization-selection screen.
- No Flutter `main.dart`, no widget tree, no app package, no Android/iOS platform project, and no localization ARB files.
- `inone-development-0.7/stage-0.7.0/client-screens` contains a JS API/state spike and docs only.
- Checked trees for `cto/inone-audit-2026-11-08`, `ci/inone-engine-validation-2026-11-07`, `recovery/p0-wave3-validation`, `development`, `engine-poc`, and `docs/inone-identity-design-localization`; no Flutter app found.
- Consequence: a runnable phone Beta 1.0 cannot be built from current GitHub source alone. The original UI/API ZIP and exact design-system source need a supported import path. Do not recreate them from memory.
- Detailed report: [development/REPO-AUDIT-2026-11-08.md](../../development/REPO-AUDIT-2026-11-08.md).


## 18. P0 publish branch completeness correction — 2026-11-08

- Review of workflow logic found a gap: validation job used the restored client-reference files from the PR head, but publish job recreated a clean branch from main and originally applied only the P0 patch, omitting those two restored files.
- Fixed publish job to copy exact `biometric-client.mjs` and `biometric-vectors.json` from the PR head into the clean main-based recovery branch before applying the patch. Workflow commit: `e0a8c08ddf68864963c3f8a65ba16a0612381e39`.
- Run [42457297299](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457297299) was queued for the workflow correction; no result yet at time of record.
- Run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) tests exact original fixture but predates publish-job correction. Neither run is accepted until all checks complete.


## 19. Original P0 ZIP/bundle independently verified from current upload — 2026-11-08

- Current conversation upload `Bundle(1).zip`: 1,061,251 bytes; SHA-256 `a7ccfc12ae810dc1788f1b737ef4d53e032cafaf35797412784073a2db57f5a0`.
- Inner `inone-engine-p0-wave3.bundle`: 1,052,468 bytes; SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`.
- `git bundle verify` succeeded: complete history; ref `refs/heads/engine/p0-wave3` at `a7f60b6fdc969941e4354a117e17d32bfc951fb9`; five commits; base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`.
- Base tree contains 240 tracked blobs. Full binary bundle is still not committed to GitHub. GitHub connector does have base64 Git Data blob creation, but current tool boundary cannot transfer local mounted bytes to that action; local Git push also lacks network/DNS and credentials.
- Corrected status and hashes in [development/recovered-source/README.md](../../development/recovered-source/README.md).


## 20. P0 CI: Node and room regression pass; PostgreSQL client mismatch — 2026-11-08

- Run [42457297299](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457297299): patch apply PASS; Node backend **369/369 PASS**; P0 room-list regression **2/2 PASS**; PostgreSQL **42/43 PASS**; OpenMLS and Rust bridge skipped after DB failure.
- Sole DB failure: backup/restore test; runner's newer pg_dump/pg_restore wrote `SET transaction_timeout=0`, unsupported by PostgreSQL 16 service. This is a CI client/server version mismatch.
- Fixed workflow at commit `0e13b9726c5fcbecfdb8a9a45b05d4bb6eb02863` to pin `ubuntu-24.04`, install `postgresql-client-16`, and put its binaries first on PATH.
- Fresh run [42457594088](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457594088) was in progress at last check. No full P0 acceptance yet.
- Detailed report: [development/recovered-source/CI-RESULT-42457297299.md](../../development/recovered-source/CI-RESULT-42457297299.md).


## 21. P0 base tree path parity restored — 2026-11-08

- Compared bundle base tree paths (240 blobs) against GitHub archived engine tree (225 blobs); exactly 15 paths were absent.
- Restored all 15 missing paths in PR #18 from exact existing GitHub archive files or directly from the verified bundle base. The recovery branch now has 240 engine blobs and full path parity with the bundle base.
- Exact provenance and per-file blob IDs: [BASE-TREE-RESTORATION.md](../../development/recovered-source/BASE-TREE-RESTORATION.md).
- Full 240-file blob-hash parity is not yet established. The eight previously compared P0-modified files and all 15 restored missing files have exact source blob matches; compare remaining common paths before final acceptance.
- Updated publish job to apply all PR-head engine-path changes to clean main before P0 patch; commit `7898fde9a592a8c180e7c9e89a2c7b3cb2e5ad80`. It also broadens workflow path filters to all engine paths.
- Run #42457594088 predates this last workflow fix; require a new run on head `7898fde9a592a8c180e7c9e89a2c7b3cb2e5ad80`.


## 16. Latest GitHub P0 recovery snapshot — 2026-11-08 12:00 UTC+3

This section supersedes stale earlier statements in this file that no applied P0 branch exists or that the full Node/PostgreSQL/Rust validation has not yet run. Historical sections are retained as a chronology of earlier states.

- Published source branch: `recovery/p0-wave3-applied`.
- Exact checked HEAD: `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`.
- Draft PR: [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22), still OPEN / NOT MERGED.
- CI push run [42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and PR run [42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297) ran on this exact SHA.
- PASS: Node 369/369; P0 room regression 2/2; PostgreSQL 43/43; OpenMLS client tests (all test binaries); Rust bridge 3/3.
- FAIL: `cargo fmt -- --check` reports formatting diffs in 12 Rust files. Overall Actions result remains FAILURE; do not call CI green.
- P0 source integrity is not accepted yet: complete 240-file original-bundle blob-hash audit and verification of six modified engine files + five added P0 tests remain open. See [P0-GITHUB-RECOVERY-STATUS](../../development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md).
- The P0 workflow runs from `inone-development-archive-0.6.0/engine/`. A separate `inone-engine-poc-0.6.0/` tree also exists; do not assume parity without blob comparison.
- Original bundle SHA/ref/HEAD remain separately recorded in the recovery status document. Its original binary and original five-commit ancestry are not imported into GitHub main.
- Flutter app source, native mobile MLS handlers, secure key storage and durable local message persistence remain separate blockers. Do not treat P0 backend CI as a runnable Beta 1.0 app.


## 15. GitHub Codespaces test environment — draft only (2026-11-08)

- Owner selected GitHub Codespaces as the development/test environment.
- Draft scaffolding is committed on branch `feat/beta1-full-screen-api-harness`: `.devcontainer/devcontainer.json`, `.devcontainer/docker-compose.yml`, `.devcontainer/start-backend.sh`, and `docs/CODESPACES_TEST_ENVIRONMENT.md`.
- Related mobile changes select a local backend URL by platform and document the local API panel. These are configuration/code declarations only.
- Latest branch HEAD at the final handoff check: `bf6806cb669220addf3771ad458ebfa5a30357fa`. Draft PR [#28](https://github.com/vahe210991-cloud/InOne-chat/pull/28) remains open and unmerged.
- **Verification: BLOCKED.** No complete repository clone/worktree was available in the tool environment. Codespaces was not created. Container build, PostgreSQL, migrations, backend health checks, Flutter analysis/tests and live API requests were not run.
- Latest Actions run [#42509620990](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42509620990) was in progress when checked. Earlier Flutter runs failed at `flutter analyze`; investigate exact annotations before accepting the branch.
- 34 screen API entries are configured, but they are not 34 verified live integrations. `GET /rooms/mine` is absent from the current engine source; `GR-01` and workspace list probes were removed. The target of 10 verified connected screens remains NOT MET / NOT VERIFIED.
- Next required action: create a Codespace on `feat/beta1-full-screen-api-harness`, verify complete clone/history/refs and clean worktree, then validate this configuration before making more code changes. See [Codespaces test environment guide](../../docs/CODESPACES_TEST_ENVIRONMENT.md) and the latest [session log](../../development/SESSION-LOG.md).


## Owner-approved baseline and Beta 1.0 UI integration — 2026-11-09

- Owner approved the WBS v1.1 in [development/PROGRESS-BASELINE.md](../../development/PROGRESS-BASELINE.md). Fixed baseline: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%; InOne 25% historical qualitative. Do not change scope/weights without explicit owner approval.
- Root `AGENTS.md` and Copilot instructions require every agent/chat to read the WBS.
- UI integration PR [#35](https://github.com/vahe210991-cloud/InOne-chat/pull/35), branch `feat/beta1-ui-source-integration`. Source audit report: [2026-11-09-1015](../../development/reports/2026-11-09-1015-ui-integration-start.md).
- Ui.zip outer SHA-256 `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`; nested archive SHA-256 `d098738ff64fab0388aa72d22a92b097940c41bbcb4acfddfc30ff745e16ad0d`. Both ZIP integrity checks PASS; 231 entries, 24 manifest screens, 31 HTML screens total, 5 WOFF2 fonts, all 10 approved.sha256 entries PASS.
- Exact source assets have NOT yet been uploaded to GitHub. Import is BLOCKED by missing binary streaming from current connector and no GitHub network in container. Do not claim Flutter UI runtime integrated.
- Added asset-path mapping, rootBundle loader, v1 bridge compatibility, tests and deterministic importer. Runtime local-font patch affects only imported runtime copy; source remains immutable.
- v1 chat POST message, and v2 missing/unverified API routes remain BLOCKED. CH-02 `GET /rooms/:id/events` remains unresolved.
- CI run #42578333371: platform setup, geometry, 73-screen gallery check, pub get, analyze and tests PASS; Android APK still in progress at last observation. It predates later commits; latest head not verified.


## Current state — 2026-11-11 Beta 1.0 / Stage 4 single executor

- Sole executor: ChatGPT. Do not create or assume an external-agent workstream unless the owner explicitly changes this instruction.
- Product stage: Beta 1.0 only. Beta 2.0 scope is not active.
- Approved WBS v1.1 is unchanged: Beta 1.0 baseline 42% implementation / 31% verification; domain weights remain Backend/API 25%, Flutter/UI 25%, API/UI 15%, MLS/security/storage 20%, QA/CI/E2E 10%, DevOps/release 5%.
- Active PR #45 remains OPEN/Draft. Current implementation head at last code change: `048db63a7817b28e38a3a8353f8665a713f56730`; documentation report added at `a73f59a253224eefa7b794c708666a3a20153519`.
- Source hardening: native MLS feature gate defaults false; cleanup attempts platform-key deletion even if DB file deletion fails; inbox replay is idempotent; session initialization/handoff are serialized; Android JNI context failures propagate; malformed event IDs and MLS processing errors are rejected rather than silently consumed.
- iOS Protected Keychain CI now fails if signing secrets are absent; runtime validation may not be skipped for acceptance.
- CI on SHA `048db63a7817b28e38a3a8353f8665a713f56730`: OpenMLS client run #42976612169 and FRB run #42976612175 both failed before step 1 with `runner_id=0`, empty steps, and no retrievable logs. iOS dependent job skipped. This is an execution blocker; exact GitHub-side cause is unknown.
- Stage 4 is NOT ACCEPTED. No Stage 4 test command has executed in this environment; no green status is claimed.
- Critical open design issue: OpenMLS provider and client metadata use separate SQLite connections. Atomicity between MLS ratchet-state writes and inbox persistence is not yet established. A crash/restart regression and a proven atomic/recoverable design are mandatory.
- Full report: `development/reports/2026-11-11-stage-4-single-executor-progress.md`.


### Latest CI recheck — 2026-11-11

- PR #45 documentation-updated head: `87089c610e03ba5302b316db07baa2d44d71260a`; source-code head remains `048db63a7817b28e38a3a8353f8665a713f56730`.
- OpenMLS run #42976768215 and FRB run #42976768182 again failed before the first step with `runner_id=0` and empty step arrays. iOS dependent job skipped. Flutter mobile run #42976768225 skipped by branch condition.
- No test command executed; acceptance remains blocked. Latest evidence is in report section 8.


### MLS persistence refactor — 2026-11-11

- OpenMLS provider and client metadata now share one SQLCipher connection. Transaction-backed provider writes ratchet state, inbox content and processed marker in one SQLite transaction; rollback reloads the group from durable storage.
- Server commit processing/merge, room creation and Welcome adoption use transaction-backed storage.
- Invite/revocation pending commits are merged locally only after server acceptance; rejected commits are cleared.
- Regression tests for provider transaction rollback/commit and pending-commit clearing are committed but unexecuted.
- Source head for these changes: `c8ba8f99c45cd532b0941fd774304b6763429511`.
- Latest CI #42977451436 and #42977451456 again failed before step 1 with runner_id 0 and empty steps. iOS dependent job skipped. No source tests executed.
- Atomicity is implemented in source but not accepted until unit, crash/restart and platform tests run green. Stage 4 remains NOT ACCEPTED.


### Pending-commit restart reconciliation — 2026-11-11

- `sync_room` now clears an unmerged local pending commit before applying authoritative server state and fails closed if local MLS epoch exceeds server epoch.
- Source SHA: `e4133120d59ea833dd010bdaa10a7f7a4f281375`.
- Latest OpenMLS/FRB jobs #42977699906 and #42977699954 failed before step 1 with runner_id 0 and empty steps; OpenMLS rerun #42977708226 repeated the same. No tests executed.
- Crash/restart tests for server-accepted commit recovery remain mandatory. Stage 4 is NOT ACCEPTED.


### Logout/session race hardening — 2026-11-11

- Logout now waits for in-flight login, session restoration, MLS handoff and token refresh; new login/adoption/API requests are rejected while logout is active.
- In-memory credentials are cleared even if persistent identity deletion fails.
- Regression test added for logout during a blocked native handoff; test is committed but not executed.
- Source SHA: `404775ff54c5e8a5eee175eb8d908c6c6929e2c0`.
- Latest CI #42977937179 and #42977937116 again failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. Stage 4 remains NOT ACCEPTED.


### Welcome ACK and SQLCipher key recovery — 2026-11-11

- Welcome ACK marker is committed atomically with the joined group/room index; after restart, a pending ACK is retried without reprocessing the Welcome.
- KeyStore distinguishes existing-key lookup from creation. Resume never creates a replacement key; database without its protected key fails closed.
- New session creation rejects DB/key mismatch and attempts cleanup after failed first-time initialization.
- Tests added for missing-key resume, existing DB without key and sidecar detection; not executed.
- Source SHA: `da844b08240c3e67762997be9b65d8e91cab120f`.
- CI #42978533658 and #42978533643 failed before step 1 with runner_id 0 and empty steps. No tests executed. Stage 4 remains NOT ACCEPTED.


### Latest CI recheck after key recovery — 2026-11-11

- Source SHA: `da844b08240c3e67762997be9b65d8e91cab120f`; current PR head also contains archive updates.
- OpenMLS #42978646222 and FRB #42978646245 failed before step 1 with runner_id 0 and empty steps. iOS dependent job skipped. Flutter mobile #42978646254 skipped by branch condition.
- No test or platform build executed. Stage 4 remains NOT ACCEPTED.


### Logout/key-handling follow-up — 2026-11-11

- Rust logout now catches remote logout panic and handles poisoned session mutexes while still attempting local SQLCipher/sidecar and platform-key cleanup.
- Dart clears refresh-token memory immediately after native open succeeds; Rust bridge initialization can retry after failure.
- Regression for poisoned-lock cleanup added; tests not executed.
- Source SHA: `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.
- CI #42979003433 and #42979003356 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. Stage 4 remains NOT ACCEPTED.


### CI on current PR head — 2026-11-11

- PR #45 head: `ca49b376a65766fb59e792cf2097ba7b4f2b50ce`; source head: `eab7b4d9a8889f4a5d69cdbb6de29dc2986272ab`.
- OpenMLS #42979080737 and FRB #42979080732 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped; Flutter mobile #42979080672 skipped by branch condition.
- No tests or platform builds executed. Stage 4 remains NOT ACCEPTED.


### Secret-memory zeroization — 2026-11-11

- Rust session token pairs zeroize on drop; SQLCipher keys, keyring byte buffers, serialized token pairs, request/response token JSON and authorization header copies are zeroized.
- FFI access/refresh token inputs are wrapped immediately.
- KeyStore presence checks do not copy key bytes.
- Source SHA: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.
- CI #42979859714 and #42979859709 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped. No tests executed. Stage 4 remains NOT ACCEPTED.


### CI on current PR head after zeroization — 2026-11-11

- PR #45 head: `c103cc2ae4eaa9e3ce721101f3581f3b6047e138`; product source: `3d4e64d4f302f7ddbe417903ede4dd4443b10975`.
- OpenMLS #42979954916 and FRB #42979955089 failed before step 1 with runner_id 0 and empty steps; iOS dependent job skipped; Flutter mobile #42979954833 skipped.
- No tests executed. Stage 4 remains NOT ACCEPTED.


### Current Beta 1.0 / Stage 4 status — 2026-11-11

- Sole executor: ChatGPT. No external agent is assigned. Owner will explicitly notify if an agent becomes available.
- Current stage: Beta 1.0. Keep work and acceptance within approved Beta 1.0 WBS v1.1; do not expand acceptance into Beta 2.0 modules.
- PR #45 current head: `84248642e05e03c976a6f8d0eae0a9ab03a64765`.
- Source corrections: Rust undeclared identifier fixed; duplicate Flutter dependency removed; native store and Android JNI initialization made retryable; HTTPS/local-debug API origin policy added to Rust and Flutter; HTTP redirects disabled; regression tests added; mobile README updated.
- These changes are committed but not test-verified.
- CI #42981617948 (OpenMLS) and #42981617913 (FRB) FAILED with null/empty step summaries; job logs return BlobNotFound. iOS dependent job skipped. Flutter mobile #42981617907 skipped by branch condition.
- Exact CI failure cause is UNKNOWN. Local environment lacks Rust, Cargo, Flutter, Dart and Xcode; no local test/build execution is claimed.
- Stage 4 NOT ACCEPTED. Keep `INONE_MLS_NATIVE_ENABLED=false`; do not merge. Do not change Beta 1.0 percentages without accepted test evidence.
- Full evidence and next gate: `development/reports/2026-11-11-stage-4-single-executor-progress.md`.


### Latest Stage 4 security changes — 2026-11-11

- Rust login and device-approval token responses are zeroized after extracting required values.
- Flutter login returns a sanitized result without tokens or device-approval secrets; internal response maps are cleared.
- Flutter refresh responses and outbound request buffers/bearer headers are cleared after use.
- Added login-secret exposure regression test.
- Current PR #45 head: `6e56671b632c993ebd15735caf5001ad2662012a`.
- CI #42982066347 and #42982066366 failed with null step summaries/log URLs; iOS dependent job skipped; Flutter mobile #42982066410 skipped. No tests executed.
- Stage 4 remains 0% verified / NOT ACCEPTED.


### Historical P0 parity audit — superseded 2026-11-11

The earlier finding that the active mobile MLS client lacked F1/F4/F5/P0.3 recovery mechanisms was based on an older source revision and is superseded.

A fresh source review found durable Welcome receipts/ACK retry, membership journal/fingerprint, KeyPackage claim replay, WaitingForCommit, Commit quarantine, RecoveryRequired and event identity validation in the active client. Six active regression test files have Git blob SHAs identical to their accepted P0 archive counterparts. This is source parity evidence only; the tests still require execution on the current final SHA.

Do not re-port these mechanisms. See Stage 4 report section 25 for the exact comparison.

## 2026-11-11 live update — Stage 4 hardening

- Beta 1.0 is the active product stage. Do not start Beta 2.0 work.
- PR #45 remains OPEN/Draft, not merged. Source HEAD at this update: `df53ff48a42d9b9ca1dc7b19f049f8f3b05585a6`.
- Stage 4 source now includes durable membership journal/KeyPackage claim replay, P0.2 staged Commit metadata verification, server-vs-MLS membership reconciliation, revoked-device journal, Welcome receipt/ACK recovery, WaitingForCommit, Commit quarantine, event contract validation, late/unreadable event handling, per-room outbox isolation, and Flutter/Rust recovery diagnostics.
- Native secure storage remains Android Keystore/iOS Keychain; no plaintext fallback. Logout integration test covers local purge on remote logout failure.
- Latest OpenMLS CI #42986269774 and FRB CI #42986269879 concluded FAILURE but expose no steps/logs; job log retrieval returned BlobNotFound. Flutter job #42986269746 was SKIPPED by configured branch condition. Exact causes and test outcomes UNKNOWN.
- No local Cargo/Rust toolchain is available; no local test results. No Stage 4 test is claimed PASS.
- Stage 4 NOT ACCEPTED / BLOCKED. WBS v1.1 Beta 1.0 baseline unchanged: 42% implementation / 31% verification.
- Detailed evidence: `development/reports/2026-11-11-stage-4-native-mls-hardening-progress.md`.


## Current Stage 4 status after CI hardening — 2026-11-11

- Owner instruction: ChatGPT is the sole developer/executor; no external agent is assigned.
- Product stage: Beta 1.0 only. Approved WBS v1.1 remains unchanged.
- PR #45 is OPEN/Draft. Latest checked head: `56102098427b8853b746b94d8c073c5aa97d0c2c`; not merged.
- Local-purge safety fix: SQLCipher database and sidecars are removed even if protected-store initialization fails; inability to delete the platform key remains an explicit error. Regression added in commit `4670646558723ae5b33eeffdaa105f3a6df209ed`; not executed.
- FRB workflow is read-only by default. A separate write job commits only allowlisted generated artifacts, followed by full Rust/OpenMLS/Flutter/Android verification on the exact generated SHA.
- iOS job is downstream of that final-SHA gate, requires signing secrets, validates profile/team/app/keychain entitlements, configures manual signing, runs the protected-store simulator smoke test and verifies the app signature. Source reviewed, not executed.
- Latest OpenMLS #42987007179 and FRB #42987007308 failed with `steps=null` and `logs_url=null`; log retrieval returned BlobNotFound. FRB generated commit/final-SHA/iOS jobs were skipped. Flutter #42987007363 was skipped by its branch condition. No test command is evidenced as executed.
- Generated FRB Dart/Rust bindings, build hook and Rust lockfile are still absent because the generation job did not execute.
- Local environment has no Rust/Cargo/Flutter/Dart/Xcode and no outbound network. No local test/build results are claimed.
- Stage 4 verification accepted: 0%. Stage 4 NOT ACCEPTED / BLOCKED. Keep `INONE_MLS_NATIVE_ENABLED=false`; do not merge PR #45.
- Detailed evidence: `development/reports/2026-11-11-stage-4-single-executor-progress.md`, sections 25–26.


## Latest owner-controlled state — 2026-11-11

- Sole executor: ChatGPT. External agent is not assigned.
- Active release stage: Beta 1.0. Approved WBS v1.1 unchanged.
- Stage 4 PR #45 remains OPEN/Draft and unmerged.
- Product hardening commit: `4670646558723ae5b33eeffdaa105f3a6df209ed` (database/sidecar purge still attempted if platform key-store initialization fails; regression added, not run).
- CI workflow now has read-only default permissions, isolated generated-artifact write job, exact final-SHA verification matrix and protected `ios-signing` environment.
- Required environment secrets are documented in mobile/README.md. Owner must configure `ios-signing` with required reviewers and base64 P12/profile plus password/team ID. Do not share secret values in chat.
- Latest observed full CI on prior head `5e3a9dc7644bb9e2eb462a41de345b4ff9f7df3c`: OpenMLS #42987334965 FAILED with no steps/log URL; FRB #42987334938 FAILED with no steps/log URL and all downstream acceptance jobs SKIPPED; Flutter #42987335071 SKIPPED by branch condition.
- Newer documentation head `a9b81e0c04ce1826d361845b8596eae0c4acaaf9` had no workflow records at the time of the check. Re-fetch PR head and CI before any acceptance claim.
- Generated FRB bindings/build hook/Rust lockfile remain absent. No local Rust/Cargo/Flutter/Dart/Xcode or outbound network is available.
- Exact GitHub Actions failure cause remains UNKNOWN. Owner-side unblock is a working CI runner/build environment and protected iOS environment configuration.
- Stage 4 verification accepted: 0%. Keep `INONE_MLS_NATIVE_ENABLED=false`; do not merge PR #45.
- Report sections 25–27 contain current source and CI evidence.


## Exact-head CI recheck — 2026-11-11

- PR #45 head checked: e8f50e566d1095ed7ad6ed9427abb5d666b5097b.
- OpenMLS #42987463963: FAILED; job has no steps/log URL; log retrieval returned BlobNotFound.
- FRB #42987464006: FAILED; generation job has no steps/log URL; downstream generated-commit/final-SHA/iOS jobs SKIPPED.
- Flutter #42987463998: SKIPPED by branch condition.
- Combined status API returned no status entries. No test command is evidenced as executed. Exact failure reason UNKNOWN.
- Stage 4 remains NOT ACCEPTED / BLOCKED. Owner must provide the exact job-level message from GitHub Actions UI or an authorized working runner. Do not guess.


## Latest logout hardening and persistence regressions — 2026-11-11

- Rust logout now clears the local SQLCipher session-token row and in-memory token pair even when the server is unreachable; offline logout regression added.
- Flutter logout clears the persisted MLS identity after every explicit logout attempt, including native purge failure; missing native runtime/device identity returns an explicit error. Two Dart regressions verify no automatic resume after logout failure.
- Added Rust tests for wrong SQLCipher key mismatch without replacement, cleanup after partial new-session initialization, and process termination with an uncommitted WAL transaction covering OpenMLS storage + inbox + processed marker.
- Test source only; not executed.
- Exact head with these tests: `54711b873349a8adb575f27d9c1fcccebbc49081`. FRB #42988592622 and OpenMLS #42988592592 failed before steps/logs (BlobNotFound); Flutter #42988592656 skipped. Exact failure reason UNKNOWN.
- Stage 4 remains NOT ACCEPTED / BLOCKED, 0% verification accepted. Keep `INONE_MLS_NATIVE_ENABLED=false`.


## Owner execution mandate — 2026-11-11

- The missing file referenced by root `AGENTS.md` has been created: `development/AI-AGENT-MANDATE.md`.
- It records ChatGPT as sole executor until explicit owner authorization for an external agent, Beta 1.0-only scope, evidence-only claims, exact-SHA green-test acceptance, WBS-controlled percentages, concise reports/checklists archived in GitHub, and no merge without owner approval.
- `development/WORKING-RULES.md` now includes the mandate in the startup checklist.


## Latest CI retry — 2026-11-11

- Exact code/test head: `5ca865573e7ed8949698ce7eda7d0adbf5f5915a`.
- FRB #42988901680 and OpenMLS #42988901678 FAILED before steps/logs; log retrieval returned BlobNotFound. FRB downstream jobs skipped.
- Flutter #42988901824 SKIPPED by branch condition.
- No test command is evidenced as executed. Exact failure cause UNKNOWN.
- Stage 4 remains NOT ACCEPTED / BLOCKED; native MLS remains disabled.


## Latest exact-head CI — 2026-11-11

- PR #45 head: `28aa6f488472688ae5d728e18da8ef24910d540d`.
- OpenMLS #42989119932 and FRB #42989119937 FAILED with no steps/log URLs; generated commit/final-SHA/iOS jobs skipped. Flutter #42989120066 skipped.
- No test command is evidenced as executed. Exact failure cause UNKNOWN.
- Crash regression accurately covers OpenMLS storage + inbox/processed writes in an uncommitted SQLCipher WAL transaction; it does not claim to test live ratchet mutation.
- Stage 4 remains NOT ACCEPTED / BLOCKED.


## Current-head CI — 2026-11-11

- Latest PR #45 head checked: `d81e05a794f10aa47e414dcc8d8920ffcd35755e`.
- OpenMLS #42989207053 and FRB #42989207170 FAILED before steps/logs; log retrieval returned BlobNotFound. FRB downstream jobs skipped.
- Flutter #42989207122 skipped by branch condition.
- No test command evidenced as executed. Exact failure reason UNKNOWN.
- Stage 4 remains NOT ACCEPTED / BLOCKED, 0% verification accepted.


## Latest current-head CI retry — 2026-11-11

- PR #45 head checked: `e7e19ce9de18e6042b36e5bd5f2ae9700796afd1`.
- FRB #42989322261 and OpenMLS #42989322167 FAILED with no steps/log URLs; log retrieval returned BlobNotFound. FRB downstream jobs skipped.
- Flutter #42989322186 SKIPPED.
- No test command evidenced as executed. Exact failure cause UNKNOWN. Stage 4 remains NOT ACCEPTED / BLOCKED.


## Latest exact-head CI and trigger policy — 2026-11-11

- Full native CI is now triggered by workflow-file and `mobile/**` changes, not documentation-only edits.
- Latest PR #45 head: `bfb87598068239c1107233d930ee79f25ff62d77`.
- FRB #42989491362 and OpenMLS #42989491373 FAILED before steps/logs; log retrieval returned BlobNotFound. Flutter #42989491354 SKIPPED.
- No test command evidenced as executed. Exact failure cause UNKNOWN. Stage 4 remains NOT ACCEPTED / BLOCKED.


## PR #45 failed-job rerun — 2026-11-11

- Latest recorded PR head: `f6384a0bd68460849cbc9b9ce0fa6d7e9fcb9a6a`; latest code-triggered workflow SHA: `bfb87598068239c1107233d930ee79f25ff62d77`.
- Re-ran FRB #42989491362 and OpenMLS #42989491373. Latest attempts still failed before any observable step; job step summaries/log URLs are absent and log retrieval returns `BlobNotFound`.
- Latest job IDs: FRB `130426024038`; OpenMLS `130426036241`. FRB downstream generated-commit/final-SHA/iOS jobs skipped; Flutter #42989491354 skipped by branch condition.
- No test command evidenced as executed. Exact Actions startup cause UNKNOWN; do not infer source, runner, permission, billing or platform cause.
- Stage 4 NOT ACCEPTED / BLOCKED; verification accepted 0%; keep `INONE_MLS_NATIVE_ENABLED=false`; no merge. Report section 36.


## CI trigger-filter correction — 2026-11-11

- Docs-only commit `5b520b5ba25d1091017a5f19d5fdbba73082fb3a` still triggered FRB #42991893141 and OpenMLS #42991893195 because PR path filters evaluate the aggregate PR diff; FRB push trigger also lacked a path allowlist. Both failed before steps/logs; Flutter #42991893163 skipped.
- Updated FRB workflow to remove aggregate `pull_request.paths` and add explicit `push.paths` for `.github/workflows/openmls-frb-codegen.yml` and `mobile/**`. Updated OpenMLS workflow to remove aggregate `pull_request.paths`, retaining its existing push path allowlist. `workflow_dispatch` remains.
- Workflow trigger edits are source-reviewed only; no tests or runner checks passed. Fork-origin PR automation is not covered by this branch-specific approach.
- Stage 4 remains NOT ACCEPTED / BLOCKED; verification accepted 0%; keep native MLS disabled; no merge. Report section 37.


## Current Stage 4 branch hand-back — 2026-11-11

- Branch: `feature/stage-4-native-mls-runtime-2026-11-11`.
- Latest verified commit before this continuity update: `16a522a358a5b3d0d1f9b82f70785a0f599478ea`.
- FRB and OpenMLS workflow trigger corrections are committed and re-fetched. Trigger policy now relies on branch-scoped push path allowlists plus manual dispatch; aggregate PR path triggers removed.
- Local execution capability is limited to Node.js; Rust/Cargo, Flutter/Dart and Xcode are unavailable. No local test/build is claimed. CI startup blocker unresolved.
- Stage 4 remains NOT ACCEPTED / BLOCKED; verification accepted 0%; keep native MLS disabled; no merge. Report section 38.

- Pending device login now stays on SC-11/waiting when the backend did not issue an authenticated token pair; approval claim/poll remains incomplete.

- CH-01 now emits a screen-scoped `GET /rooms/mine` call on screen load; Flutter parses the typed `InOneRoomList` response and safely binds room names/roles to the HTML. Existing backend `rooms-mine.test.js` covers authenticated HTTP route behavior. New branch tests NOT RUN; live Flutter→Node E2E NOT RUN.

## Owner decision update — 2026-11-13: two-app product structure

The owner has approved two separate applications:

- **InOne:** personal/social use — news feed, publications, personal chats, groups, Threads, and related social features.
- **InOne Business:** professional work — Kanban, CRM, Leads, Deals, Wallet, Flags, other business tools, and integration with Propo Seller Account.

This changes the product boundary and future scope classification. It does not itself authorize code changes, PR merges, backend/database separation, or changes to the approved Beta 1.0 UI. Existing screens, APIs, repositories, and roadmap items must be audited and mapped to InOne or InOne Business before implementation is reorganized.

Canonical decision: [DECISIONS.md, section 7](DECISIONS.md#7-product-split-inone-and-inone-business--2026-11-13).


## Canonical Backend identity correction — 2026-11-21

- Owner-approved scope: complete six-stage audit/remediation; safe package rename only after dependency review; no merge to `main` without explicit approval.
- Canonical Node.js backend source remains `inone-development-archive-0.6.0/engine/`. Its package identity is now `inone-backend` (private, version 0.6.0); the old temporary Variant A description is removed.
- The path itself is intentionally retained for compatibility. The separate `inone-engine-poc-0.6.0/mobile-mls/mls-client/` remains the Flutter-connected persistent Rust MLS client referenced by `mobile/rust/Cargo.toml`. Do not conflate the Node backend ownership with the Rust MLS client ownership.
- Updated package metadata/lockfile, canonical backend README, mobile backend setup path, and added a package identity regression test to `npm test`.
- Decision: [ADR-004](../../development/architecture/ADR-004-CANONICAL-BACKEND-IDENTITY.md). Source-of-truth map: [BACKEND-SOURCE-OF-TRUTH](BACKEND-SOURCE-OF-TRUTH.md). Audit report: [2026-11-21 backend identity remediation](../../development/reports/2026-11-21-backend-identity-audit.md).
- Work branch: `fix/canonical-backend-identity-2026-11-21`. PR and exact-head CI review pending. No tests are claimed as run in this session; require focused identity test, full Node suite, npm audit, PostgreSQL suite and related CI checks on the final PR SHA.
- No backend source modules, schema/migrations, Rust/FFI source, directory paths or database data were changed. Do not merge to `main` without owner approval.

- PR #120 remains open as Draft against `main`, not merged. Its README received a preservation correction after review; re-read the latest PR head and require fresh exact-head CI before acceptance.


## CTO remediation roadmap — 2026-11-24

- Added the staged Beta 1.0 security remediation and release plan: [CTO roadmap](../../development/roadmaps/2026-11-24-beta1-cto-security-remediation-roadmap.md).
- The plan defines Gate 0 (close exact-SHA Stage 1 B-01/B-02/B-03), Stage 2 (B-04/B-13 file streaming, atomic quotas and lifecycle), Stage 3 (B-06/B-08/B-09/B-10/B-11/B-15 runtime boundary), Stage 4 (B-07/B-12/B-14 database integrity), Stage 5 (supply-chain/CI/operations), and final release acceptance.
- Reviewed PR #135 head: `4824dfc3b3f4e3aab5d39b16c1adf934a108d660`. Stage 1 remains NOT ACCEPTED: exact-SHA gate #45432827863 failed; iOS run #45432827935 was queued at last poll. Other listed exact-head workflow runs reported success; see roadmap for precise status.
- Work remains on `security/beta1-backend-remediation-2026-11-24`; PR #135 remains Draft/open/unmerged. `main` unchanged. SMS excluded; native MLS default-off; WBS v1.1 unchanged.
- Ready-file retention is an explicit owner decision; no duration or automatic ready-file expiry is authorized by this plan.

## CTO backend security remediation — 2026-11-24

- Live main advanced to `02880940c1e4d8261405fbeaa01f40879eb44f3a` (PR #132 included).
- Stage 0 branch: `security/beta1-backend-remediation-2026-11-24`, created from exact main SHA.
- Stage 0 report: `development/reports/2026-11-24-cto-backend-security-remediation-stage0.md`.
- Source-level findings confirmed: B-01, B-02, B-03, B-04, B-06, B-07, B-08, B-09, B-10, B-11. B-12/B-13/B-14 require additional research; B-15 partial.
- No product source changed and no security tests were executed in this session. Backend remediation is NOT ACCEPTED pending complete clone/Codespace and PostgreSQL-capable runner.
- GitHub main protection remains disabled (`protected=false`); no settings changed. Five exact-main workflow jobs were PASS and three IN PROGRESS at inspection; not backend security acceptance.
- SMS is out of scope; native MLS remains disabled by default. Beta 1.0 backend security verdict: NOT READY.


### Stage 0 continuation — 2026-11-24

- Expanded source review confirms B-12 and B-13 defects; B-14 is already implemented at source level (invalid FID cleanup, non-retryable classification, queue cancellation, plaintext-free allowlisted push payload), pending DB-backed test execution; B-15 readiness is partial.
- Current `main` already has device-bound signed downloads; avoid duplicating PR #86. PR #42 workflow targets old engine paths and does not implement atomic revocation. PR #65 is narrow and does not fix the global request boundary.
- Updated Stage 0 report addendum in `development/reports/2026-11-24-cto-backend-security-remediation-stage0.md`.
