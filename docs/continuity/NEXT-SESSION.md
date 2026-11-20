# Immediate next steps — 2026-11-14 (engine stabilization)

1. Verify exact current branch HEAD and clean worktree: `feat/flutter-ui-dart-migration-2026-11-14`; expected code/test commit `24ed7477ed308f82d5e61c97bba5aac3f5f2da65`. Do not modify `main`.
2. Inspect GitHub Actions for the current branch after the P0 workflow trigger update. Confirm Node 22, PostgreSQL 16, Rust 1.91 format/check/test jobs on one exact SHA. The available connector view previously returned only PR-triggered runs, so push-run status was not independently confirmed here.
3. If CI fails, inspect the actual failing step/log before changing code. Do not infer a failure from the older Flutter workflow run #43573883217: it failed before steps and logs were unavailable (BlobNotFound).
4. Run backend tests on a controlled environment: `npm ci`, `npm test`, clean PostgreSQL migration, `npm run test:db`, upgrade migration on a copy, and verify data integrity.
5. Run Rust persistent OpenMLS client tests and FFI integration checks; confirm SQLCipher DB key is supplied by iOS Keychain / Android Keystore, not MemoryKeyStore.
6. Run Flutter `dart format`, `flutter analyze`, `flutter test`, Android/iOS builds and physical-device MLS tests. Until these pass, keep message send/receive fail-closed and do not enable native MLS.
7. On target infrastructure, verify SMTP delivery, TLS/proxy, backup/restore, multi-instance behavior, monitoring and alerts.
8. Preserve POC source history; do not move the entire `inone-engine-poc-0.6.0/` directory to trash because its persistent OpenMLS client is still needed. Its duplicate Node server is blocked from production.

Evidence: [engine stability audit](../../development/reports/2026-11-14-engine-stability-audit.md). No PR merge is authorized by this handoff.

---

# Immediate next steps — 2026-11-09 12:11 Europe/Tallinn

1. Run Flutter CI independently on post-import PR #36 head `cb09a4058719576df6d589f1f8b59be517b592b5`; verify the exact candidate SHA.
2. Review PR #36 and keep it draft/open until the owner explicitly authorizes merge. Do not merge automatically.
3. Integrate the imported UI package with the native Flutter WebView/runtime loader and prove an approved screen renders on Android and iOS.
4. Verify navigation and typed bridge events against actual Flutter handlers; map each screen action to a documented API contract and existing backend handler.
5. Resolve missing/uncertain API contracts (including CH-02 room events), then perform visual parity, security and physical-device E2E acceptance.

Latest evidence: [CI run #42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987), input SHA `478cad39bc39e8002e55293e3015e72b68e26c8c`; post-import branch head `cb09a4058719576df6d589f1f8b59be517b592b5`. Full report: [2026-11-09-1211-ui-archive-import-ci.md](../../development/reports/2026-11-09-1211-ui-archive-import-ci.md).

---

## Immediate next step — open and verify the Codespaces workspace (2026-11-08)

The owner selected GitHub Codespaces. A draft devcontainer is on branch `feat/beta1-full-screen-api-harness` (PR #28). Before further source edits:

1. Open the repository in GitHub and create a Codespace on branch `feat/beta1-full-screen-api-harness`.
2. In the terminal, run:
   ```sh
   git status --short --branch
   git log -1 --oneline
   git remote -v
   git branch -a
   git submodule status
   git rev-parse HEAD
   ```
3. Confirm the checked-out HEAD equals the latest PR head and that the full repository, required refs, submodules and LFS objects are available. If any are missing, stop and document the exact gap.
4. Validate `.devcontainer/devcontainer.json` and `.devcontainer/docker-compose.yml`; build the app/db services and inspect container logs. The configuration has not yet been run.
5. Verify PostgreSQL readiness, backend migrations, `/healthz` and `/readyz`; record exact outputs and test commands.
6. Inspect the latest Flutter Actions failure at `flutter analyze` and fix it only from the complete Codespaces clone. Latest run at handoff: [#42509620990](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42509620990), then in progress.
7. Audit the 34 route declarations against actual backend handlers and response schemas. Do not count a route declaration as a connected screen. The requirement remains at least 10 live, authenticated, response-verified screens.
8. Keep PR #28 draft/open; do not merge until full CI and the required integration evidence pass.

Current branch at handoff: `bf6806cb669220addf3771ad458ebfa5a30357fa`. Codespaces guide: [CODESPACES_TEST_ENVIRONMENT.md](../../docs/CODESPACES_TEST_ENVIRONMENT.md). Session evidence/blocker: [SESSION-LOG.md](../../development/SESSION-LOG.md).

# InOne — инструкция следующему чату / исполнителю


> **НОВАЯ ТОЧКА ПРОДОЛЖЕНИЯ — 08.11.2026:** P0 уже закрыт и объединён в `main` через PR #25; merge commit `97024ab03ce9583e298ee946f3679565007405ca`. Не повторяй восстановление P0 и не проси владельца повторно присылать бандл. Все 6 CI jobs прошли на PR head в [run #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362) и повторно на merged `main` в [post-merge run #134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744). Сначала прочитай [P0 closure report](../../development/recovered-source/P0-CLOSURE-2026-11-08.md) и [ARTIFACT-RETENTION](../../development/ARTIFACT-RETENTION.md). Следующий отдельный продуктовый этап — восстановление/проверка Flutter Beta 1.0 source, native Android/iOS MLS integration, secure key storage, durable on-device message storage и device E2E. Старые инструкции ниже — исторические и не должны переоткрывать P0.



> **НОВАЯ ТОЧКА ПРОДОЛЖЕНИЯ — 08.11.2026:** P0 уже закрыт и объединён в `main` через PR #25; merge commit `97024ab03ce9583e298ee946f3679565007405ca`. Не повторяй восстановление P0 и не проси владельца повторно присылать бандл. Все 6 CI jobs прошли на PR head в [run #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362). Сначала прочитай [P0 closure report](../../development/recovered-source/P0-CLOSURE-2026-11-08.md) и [ARTIFACT-RETENTION](../../development/ARTIFACT-RETENTION.md). Следующий отдельный продуктовый этап — восстановление/проверка Flutter Beta 1.0 source, native Android/iOS MLS integration, secure key storage, durable on-device message storage и device E2E. Старые инструкции ниже — исторические и не должны переоткрывать P0.


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

## Update after the 2026-11-08 recovery attempt

- The Library inventory confirms that the P0 bundles, backend MLS session ZIP, Beta 1.0 UI/API ZIP r2, and curated design-system HTML exist. Raw-byte materialization/read is currently denied by the Project Files layer; see [RECOVERY-ATTEMPT-2026-11-08](RECOVERY-ATTEMPT-2026-11-08.md). Do not repeat the same materialize call blindly or ask the owner to upload existing artifacts.
- Re-check available file/source connectors and authorized export routes; if none can provide the existing bytes, explicitly identify the missing capability before considering a controlled source reconstruction.
- Re-check GitHub refs before further writes. The audit branch head observed this session was `a07815227ecf004628f5b3b94154a4f16de8d1bd`; it is not the current P0/UI source.
- Beta 1.0 database decision is now explicit: independent InOne DB/backend; shared InOne+Propo DB deferred to the next beta. Follow [ADR-011](ADR-011-BETA1-INDEPENDENT-DATABASE.md).
- Immediate user-visible objective remains a runnable Beta 1.0 build, not additional planning documents. Once source bytes are available, prioritize importing and running the Flutter app and backend locally, then produce an installable test build as soon as the native MLS/security gates permit.
## Latest recovery progress — 2026-11-08

- Draft PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17) preserves readable Library patches 016–020 and the P0/MLS/Beta 1.0 reference documents on branch `recovery/source-artifacts-2026-11-08`. It is not product code and is not merged.
- Read-only compatibility audit proves patches 016–019 do not match the archived GitHub 0.6.0 source; Patch 020 targets a missing Rust test file. Do not apply this patch stack to that archive.
- Library contains no standalone `.dart`, `pubspec.yaml`, or `.arb` files. The Flutter Beta 1.0 app source is only in the inaccessible UI/API ZIP r2.
- Continue searching for an authorized way to export the existing Library bundle/ZIP bytes. If not possible, do not pretend the 0.6.0 archive is a substitute. Keep main unchanged until exact source import is possible.

## Mandatory development workspace handover — 2026-11-08

- Before any work, read `development/README.md`, `WORKING-RULES.md`, `BASELINE-2026-11-08.md`, `HANDOVER-CHECKLIST.md`, and `SESSION-LOG.md`.
- Follow the full-repository copy/work/return protocol in `development/WORKING-RULES.md`. All meaningful deliverables must be committed to GitHub; no model-memory/local-only dependency.
- The owner-provided P0 Wave 3 bundle is verified: SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`, ref `engine/p0-wave3`, HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, complete five-commit history. It has no shared commit with GitHub main.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) is a patch-based validation/import path. Fetch live workflow status; do not claim checks passed until verified. It does not import the original Git ancestry.
- Preserve the full original bundle and `ARCHITECTURE-MAP.md` in GitHub using a supported binary/Git transport or approved artifact storage; verify hashes. Do not treat the compressed patch as a complete archive.
- Then verify whether the applied-source branch was created by CI. Open a separate source-code PR only from that verified branch.
- Next product priority: locate/recover the actual Flutter Beta 1.0 source (not present in the P0 bundle), restore it into GitHub, connect the native MLS bridge securely, and produce a testable Android build as soon as the release gates allow.
- Keep Beta 1.0 independent from Propo's operational database. Shared DB remains deferred.


## PR #18 CI correction — 2026-11-08

- Initial workflow run [42453233555](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42453233555) failed: Node suite 364/365, missing `client-reference/biometric-client.mjs`; PostgreSQL and Rust stages skipped.
- Exact file restored from bundle base commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`, blob `b03e72fe33c79e6b261d980bc86459babf03b388`, to PR #18 in commit `04a490e9a01cf7523fb45205a8077f5f357c2658`.
- Workflow path filter update committed as `762e3eca8ccb2e34965441114cc29b63083aa0f9`. Verify a new Actions run for this exact head; it was not visible at the last check.
- Re-evaluate full source-tree completeness: matching only the eight modified files did not prove the archived base was a complete match. Do not publish or merge the source branch until all validation steps pass.
- Full original bundle bytes are still not stored in GitHub. The connector does not expose a binary Git/LFS upload route; use approved durable artifact storage or authenticated Git transport when available. Do not claim the patch file is a full bundle.


## Current live check status

- PR #18 corrected head `762e3eca8ccb2e34965441114cc29b63083aa0f9`.
- Duplicate validation trigger PR [#19](https://github.com/vahe210991-cloud/InOne-chat/pull/19) created from the same head. Keep #18 as the primary PR; close #19 after verification.
- Runs [42454943853](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42454943853) and [42455077322](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42455077322) were in progress at last check. Node suite running; PostgreSQL/Rust not yet run.


## Next CI checkpoint

- The 368/369 failure in runs #42454943853/#42455077322 was due to missing original biometric vector fixture. A labelled replacement fixture is committed in PR #18; local crypto verification passed.
- Current run [42457009510](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457009510) must be inspected through every stage: Node, room-list, PostgreSQL, OpenMLS, Rust.
- PR #19 closed as superseded. PR #18 remains unmerged.
- If tests reveal more absent unchanged files, compare against exact bundle base and restore with provenance; do not silently manufacture artifacts or claim the full source tree matches.


## Exact-source correction

- The original biometric vector fixture was found in the root archived client-reference directory and copied to the engine-relative test path. Exact blob SHA: `5a00755946219df2527591f00058a19d167c7811`.
- Latest PR #18 head is `c9eaf6e198d1b65549220d3742b5190d7bbc1a39`; run [42457116231](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457116231) queued.
- The generated replacement fixture was superseded before acceptance; use the exact restored source file only.


## Mobile source boundary — confirmed by full tree audit

- Main recursive tree SHA `89ba83a4cbd06b648cba8ea5a7c529bfd91285e7`, 602 entries, confirms no full Flutter app. Only a Dart organization API reference package exists and its README says unverified/no Flutter screen.
- Checked other active branches: no Flutter app found.
- Do not claim Beta 1.0 is buildable from current GitHub tree. Obtain/import original Flutter UI/API ZIP and design system; then validate on real Dart/Flutter toolchain.
- See `development/REPO-AUDIT-2026-11-08.md`.


## P0 publish branch correction

- Workflow now copies the exact restored biometric client and vector fixture from the PR head into the clean main-based recovery branch before patch application. Commit `e0a8c08ddf68864963c3f8a65ba16a0612381e39`.
- Check run [42457297299](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457297299) through every step. The older run #42457116231 does not validate the publish correction.


## Original P0 bundle status correction

- The uploaded ZIP is present in the active runtime and its inner bundle was verified complete with `git bundle verify`: 5 commits, P0 HEAD `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, base `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`, 240 base blobs.
- Preserve checksums from `development/recovered-source/README.md`. Binary still not in GitHub; base64 blob API exists but current tool bridge cannot transfer mounted bytes to it. Do not claim it was uploaded.


## P0 validation current blocker

- Latest completed validation run #42457297299: Node 369/369 and room regression 2/2 passed; PostgreSQL 42/43 passed. The only DB failure was pg_dump/pg_restore client version mismatch against PostgreSQL 16 service (`transaction_timeout`).
- Workflow pinned to Ubuntu 24.04 + PostgreSQL client 16 at commit `0e13b9726c5fcbecfdb8a9a45b05d4bb6eb02863`.
- Inspect fresh run [42457594088](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42457594088) and require PostgreSQL, OpenMLS, Rust, and publish job to pass.
- No merge yet.


## Latest continuation instruction — P0 only (2026-11-08)

Do not follow the older instruction above to wait for a published applied-source branch: it now exists. Start from [P0-GITHUB-RECOVERY-STATUS-2026-11-08.md](../../development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md).

1. Fetch current refs and verify `recovery/p0-wave3-applied` HEAD before editing. Last checked SHA: `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`.
2. Continue only on P0. Do not start Flutter UI wiring, auth feature work or other Beta features.
3. Complete the 240-file original bundle blob-hash audit; path-count parity is not blob-hash parity.
4. Verify the six substantive changed engine files and five added P0 tests against the exact bundle/patch provenance.
5. Preserve a pre-format source hash manifest, then apply rustfmt in a separate formatting-only commit. Re-run all CI checks on the exact resulting SHA.
6. Require Node, room regression, PostgreSQL, OpenMLS, Rust bridge and formatting checks all green before P0 acceptance.
7. Keep PR #22 draft/open and do not merge until the source-integrity and CI gates are accepted. Do not modify `main`.
8. Keep the original bundle archive limitation visible: its checksum/provenance are known, but the binary itself is not yet retrievable from GitHub as a committed archive.

Latest exact-head evidence: [push run 42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and [PR run 42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297). Overall status is FAIL due to rustfmt only; the functional suites listed in the status report passed.


## Mandatory approved WBS and current UI stage — 2026-11-09

Before any work, read [AGENTS.md](../../AGENTS.md), the full [AI agent mandate](../../development/AI-AGENT-MANDATE.md), and the full [owner-approved progress baseline](../../development/PROGRESS-BASELINE.md). The WBS is approved and immutable without a new owner decision. Current UI stage is Beta 1.0 UI-01 through UI-06; continue from [UI integration report](../../development/reports/2026-11-09-1015-ui-integration-start.md) and branch `feat/beta1-ui-source-integration`. The owner-provided Ui.zip has been checksum-verified locally; its full binary/source package is not yet confirmed uploaded to GitHub. Do not claim import complete until remote files/checksums are verified.

## New owner-approved product direction — 2026-11-13

Before expanding screen implementation, perform a product-boundary impact review based on the owner's decision to create two separate apps:

1. **InOne:** personal/social application — feed, publications, personal chats, groups, Threads, and related social functions.
2. **InOne Business:** professional application — Kanban, CRM, Leads, Deals, Wallet, Flags, other business tools, integrated with Propo Seller Account.

Required next work:
- Inventory current screens, routes, API contracts, repositories, and navigation.
- Classify every capability as InOne, InOne Business, shared platform capability, or unresolved.
- Identify which of the 11 approved InOne UI screens belong to the personal/social app and whether any current business-oriented concepts should be reserved for InOne Business.
- Produce a proposed product boundary / migration map and list technical decisions still needed (identity, backend/API boundaries, data ownership, app packaging, shared components).
- Do not move code, split services/databases, alter approved UI, or merge PRs until the owner reviews the impact map and authorizes implementation.
- Preserve existing Beta 1.0, identity, database, MLS, and security decisions unless explicitly superseded by a separate owner decision.

Canonical decision: [DECISIONS.md, section 7](DECISIONS.md#7-product-split-inone-and-inone-business--2026-11-13).


## Architecture restart — next actions (2026-11-13)

1. Owner review of architecture v0.1: architecture/README.md and linked product/system/domain/laws documents.
2. Answer blocking questions in architecture/OPEN-OWNER-DECISIONS.md, beginning with Propo employee identity/linking, cross-product login, the detailed delegated role/permission matrix and buyer-message contract. Seller Account cardinality is one-to-one for v1; multi-organization membership is owner-approved and already represented in the existing engine.
3. Obtain Propo API documentation, event/webhook specification, sandbox access and technical owner.
4. Complete a read-only repository re-baseline per development/architecture/REPOSITORY-REBASELINE.md. Treat all existing code and CI evidence as historical/reference until independently verified for the new product scope.
5. After owner decisions, publish ADRs for identity, data ownership, backend topology, database boundaries, messaging security and Propo integration.
6. Define the first InOne Business vertical slice and separate InOne personal/social release scope.
7. Only then begin implementation on an isolated task branch with API contracts, migrations, permission tests and acceptance criteria.

No code changes are authorized by the architecture draft itself.


### Decision received — 2026-11-13

- Seller Account cardinality: **Option A, one-to-one**. Do not design v1 for one organization to manage multiple Propo stores/Seller Accounts.
- Continue with A2–A5 and identity/employee questions. Confirm Propo's stable Seller Account ID and contract before implementing the connection.


### Decision received — multiple organizations and delegated roles (2026-11-13)

- One organization can have many employees; one person can belong to several organizations with different roles/permissions in each.
- Existing role baseline: `owner`, `admin`, `member`.
- New required behavior: explicit delegation down the authority chain only. An actor cannot manage equal/higher-level members or grant authority beyond their own delegation ceiling.
- Inspect and preserve the existing organization API/tests; do not confuse the current owner-only role-change endpoint with the broader delegated hierarchy requirement.
- Propo employee identity/login mapping remains open.


## Latest continuation instruction — Identity Stage 0 (2026-11-13)

Current task branch: `stage0/identity-engineering-readiness-2026-11-13`, based on the architecture v0.1 branch. The Stage 0 package is documented in `architecture/identity/STAGE-0-ENGINEERING-READINESS.md`.

Immediate sequence:
1. Verify the GitHub PR head and wait for `.github/workflows/identity-contracts.yml`; inspect both Redocly lint results on the exact head SHA.
2. Open GitHub Codespaces on this branch (owner-selected environment), verify complete clone/refs and `git status`, then execute the Stage 0 compatibility spike in ADR-001 with synthetic data only.
3. Fix any OpenAPI/AsyncAPI or compatibility findings on this task branch; do not mark unexecuted checks PASS.
4. Send `architecture/identity/PROPO-ADAPTER-QUESTIONNAIRE.md` to the Propo technical owner and track evidence. Do not invent endpoints or IDs.
5. Obtain privacy/legal review for data controller roles, lawful basis, retention/deletion and data residency before any production user data.
6. Once contract CI and compatibility spike pass, Stage 0 internal readiness can close and Stage 1 can begin on a fresh branch. Production Propo provisioning remains blocked until the Propo contract is confirmed.

No Identity service source, database schema or runtime endpoint exists yet. No production deployment is authorized by Stage 0.


Review PR: [#51 — Identity Stage 0](https://github.com/vahe210991-cloud/InOne-chat/pull/51). Keep it Draft. Verify exact head SHA and contract CI before declaring Stage 0 contract validation complete.


Identity Stage 0 environment: create a Codespace on branch `stage0/identity-engineering-readiness-2026-11-13` using `.devcontainer/identity/devcontainer.json`. GitHub CLI command: `gh codespace create -r vahe210991-cloud/InOne-chat -b stage0/identity-engineering-readiness-2026-11-13 --devcontainer-path .devcontainer/identity/devcontainer.json`. Then run `bash .devcontainer/identity/scripts/verify-stage0-environment.sh`. Record exact output; do not mark environment/contract validation PASS until it succeeds.

## Engine hardening — next session continuation (2026-11-14)

Current branch: `feat/flutter-ui-dart-migration-2026-11-14`; latest audited SHA: `58fafebe5566ea5b6f6afbadd8942fe5e166b62f`.

Changes already committed:
- P0 workflow no longer has a write-enabled Rust formatting job or auto-commits/pushes formatting changes; it only checks formatting.
- Canonical engine startup now probes PostgreSQL with `SELECT 1` before binding the HTTP port when migrations are explicitly disabled.
- Two regression tests cover successful probe and startup refusal on DB failure. They have NOT been run.

Important repository state:
- PR #52 is still Draft/open, with base `stage0/identity-engineering-readiness-2026-11-13`; do not retarget or merge without owner authorization.
- Branch was 358 commits ahead of main and 0 behind; main untouched.
- Flutter workflow run #632 failed before any job steps. Logs/steps are unavailable; do not infer an application test failure or pass.
- P0 Node/PostgreSQL/Rust matrix has not been confirmed on this exact SHA.

Next actions:
1. Read current exact branch HEAD before editing.
2. Verify the P0 workflow run for the exact SHA (including push-triggered run); run Node, PostgreSQL, Rust/OpenMLS checks.
3. Continue focused read-only audit of auth/session/OTP, object-store isolation and limits, backup/restore, and Flutter MLS FFI/key lifecycle.
4. Make only evidence-backed changes and add tests. Do not touch main, merge PR, change its base, deploy, or claim tests passed unless actually verified.
5. Keep runtime/production certification separate from source-level readiness.

## Engine hardening continuation — 2026-11-14

Latest audited engine code SHA: `133a8c8dc3d28fa3c923288354dbf98821e90afb` on `feat/flutter-ui-dart-migration-2026-11-14`.

Completed source changes:
- P0 Rust format job is read-only and no longer commits/pushes formatting changes.
- Startup probes PostgreSQL before HTTP listen when migrations are disabled.
- Refresh-token rotation and issuance of the replacement pair are one PostgreSQL transaction; device row is locked before refresh row, and the memory adapter mirrors the API.
- Recovery finalization is run before token consumption; the atomic rotation rechecks revocation.
- Tests added for DB readiness, concurrent refresh replay, transaction rollback on replacement-token insert failure, Host-header poisoning, and transactional restore command. `sessions.test.js` is now included in `test:db`.
- Production signed object URLs use configured `INONE_PUBLIC_URL`, not request Host.
- `restore-db.sh` uses `pg_restore --single-transaction`.

Verification status:
- P0 run #43591312640 was created for exact SHA `133a8c8dc3d28fa3c923288354dbf98821e90afb`; all six jobs failed before any steps (empty step arrays, logs unavailable). No tests can be considered executed.
- Local Node/PostgreSQL/Rust/Flutter tests were NOT RUN.
- Branch was 376 commits ahead of main, 0 behind. `main` unchanged.
- PR #52 remains Draft/open and targets `stage0/identity-engineering-readiness-2026-11-13`. Do not retarget or merge without owner approval.

Next: diagnose GitHub Actions job provisioning failure, run the exact-head P0 suite, then continue focused audit of account/session revocation, OTP throttling, object-store/backup consistency and Flutter MLS FFI. Do not claim production readiness before runtime validation.

## Engine hardening — exact latest state (2026-11-14)

Latest branch HEAD: `dff9ebf9c69ac6ae08f6a91f7df3213652c3c87b` on `feat/flutter-ui-dart-migration-2026-11-14`.

Code changes now present:
- P0 Rust format job is read-only and cannot auto-commit/push.
- Server startup probes PostgreSQL before listen when migrations are disabled.
- Refresh token rotation and replacement token insertion are atomic in PostgreSQL; device-first row locking and revocation checks are used. Memory adapter mirrors the method.
- Recovery finalization is performed before token consumption. Concurrent replay regression and rollback-on-insert-failure tests added.
- `sessions.test.js` included in `test:db`.
- Production signed file URLs use configured `INONE_PUBLIC_URL`; a raw HTTP Host-header override regression test is included.
- Restore uses `pg_restore --single-transaction` with a regression assertion.

Exact-head CI: P0 run #43591433401 and Flutter run #43591437303 both failed before steps on SHA `dff9ebf9c69ac6ae08f6a91f7df3213652c3c87b`. P0 has six jobs, each with an empty step array; logs unavailable. No code tests ran or were verified. Local tests NOT RUN.

Branch compare: 381 ahead of main, 0 behind. PR #52 remains Draft/open, base `stage0/identity-engineering-readiness-2026-11-13`. Do not retarget or merge. `main` unchanged.

Next: resolve GitHub Actions runner/job provisioning failure, then run Node/PostgreSQL/Rust/Flutter checks on exact head. Continue focused audit of account/session revocation, OTP rate limiting, object storage/backup file archive safety, and MLS FFI. Production certification remains blocked pending runtime and security validation.

## Next actions — updated 2026-11-15

1. Finish encrypted attachment flow in the persistent Rust client: reserve a file, encrypt bytes with per-file AES-256-GCM, upload ciphertext only, send the key/nonce/metadata only inside an MLS-encrypted versioned manifest, verify outer fileId/roomId binding on sync, persist manifest/key in SQLCipher in the same durable inbox transaction, and expose Rust download/decrypt with hash/tag/size verification. Add two-device, restart, tamper, wrong-room, revoked-device and membership-removal tests.
2. Generate FRB bindings on a real Windows development machine using mobile/tool/generate_native_mls.ps1; commit generated Dart/Rust outputs and lockfiles. Then run cargo fmt/test, cargo test for mls-client, flutter analyze/test, Android build + Keystore runtime smoke, and iOS device/simulator + protected Keychain validation. Record exact SHA and actual results; do not enable INONE_MLS_NATIVE_ENABLED until all gates pass.
3. Verify the Rust-owned text send/sync flow through the actual chat screen on two devices. Confirm offline outbox, inbox acknowledgement, restart persistence, epoch changes and device revocation. Do not introduce plaintext fallback.
4. Implement and verify recovery confirmation deep links for accounts with a confirmed phone. First confirm the canonical backend token/code and redirect contract, SMS provider, app-link domain and Android/iOS association requirements; do not invent a production domain or mark the flow complete without a real association test.
5. Reconcile PR #42: it targets the POC Node server rather than canonical inone-development-archive-0.6.0/engine. Keep it separate until the owner approves a target/rebase.
6. Keep PR #54 and #56 merged in the active feature branch only; main is untouched and no deployment has occurred. PR #57 and #58 remain Draft/open and stacked; tests remain NOT RUN.

## Next actions — updated after PR #59

1. Generate FRB bindings on Windows using mobile/tool/generate_native_mls.ps1; commit generated Dart/Rust outputs and lockfiles. Install canonical engine dependencies (npm ci), set INONE_ENGINE_DIR to inone-development-archive-0.6.0/engine, then run Rust bridge tests, mls-client tests including attachments.rs, Flutter analyze/tests, Android build + Keystore runtime tests, and iOS device/simulator + protected Keychain tests. Record exact SHA and results.
2. Finish attachment UX: connect a vetted file picker to sendMlsAttachment using a persisted clientMessageId; add user-triggered download/save/open flow using downloadMlsAttachment. Keep all file bytes encrypted before upload; no plaintext fallback. Add file-size/type UX and cancellation/progress.
3. Verify two-device text and attachment flows, restart persistence, idempotent retries, tamper/wrong-room rejection, device revocation and room-member removal against the canonical backend.
4. Complete recovery confirmation deep links for accounts with confirmed phones. First verify the canonical recovery code/token/redirect contract, SMS provider, app-link domain and Android/iOS association files. Do not invent a production domain.
5. Reconcile PR #42, which targets the POC Node server rather than canonical inone-development-archive-0.6.0/engine.
6. PR #54/#56 are merged into the active feature branch only; main is untouched. PR #57, #58 and #59 remain Draft/open and stacked. No tests have been run and native MLS remains disabled.
