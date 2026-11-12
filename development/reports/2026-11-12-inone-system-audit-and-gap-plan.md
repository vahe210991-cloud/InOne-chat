# InOne Beta 1.0 — системный аудит, карта сервисов и план закрытия пробелов

**Дата среза:** 2026-11-12  
**Репозиторий:** `vahe210991-cloud/InOne-chat`  
**Аудируемый commit:** `016ba75045412652d362fa8c94ee166bfa371c23`  
**Аудируемая ветка:** `feature/stage-4-native-mls-runtime-2026-11-11`  
**Рабочая ветка документации:** `docs/beta1-system-audit-ui-gap-plan-2026-11-12`  
**Релизная граница:** Beta 1.0. Beta 2.0 не включать в текущую реализацию.

## 0. Как читать этот аудит

Это source/documentation audit по дереву GitHub и конкретным файлам на указанном SHA. Он **не является** подтверждением работающего production/staging сервера, полного end-to-end сценария или успешного запуска тестов на текущем SHA.

Статусы:
- **SOURCE PRESENT** — компонент/маршрут/механизм найден в исходниках.
- **PARTIAL** — часть пути реализована, но сквозная интеграция неполная.
- **BLOCKED** — нельзя принять или безопасно подключить без недостающего контракта, решения или внешней возможности.
- **NOT RUN** — тест/сборка/платформенная проверка не запускались.
- **PASS** — только реальный успешный результат на указанном exact SHA.
- **NOT ACCEPTED** — критерии релизной приёмки не выполнены.

Нельзя превращать SOURCE PRESENT в PASS. Нельзя ставить зелёный статус на основании наличия тестового файла, YAML workflow или ожидаемого результата.

## 1. Снимок репозитория и релизное состояние

- Private GitHub repository: `vahe210991-cloud/InOne-chat`.
- Default branch: `main`.
- PR #45: открыт, Draft, не merged; base `main` на `94571cbc923ac4d29c3c684dbfdeb35f031d6a30`; head branch `feature/stage-4-native-mls-runtime-2026-11-11`; audited head `016ba75045412652d362fa8c94ee166bfa371c23`.
- PR #45 scope: Stage 4 Native MLS runtime hardening for Beta 1.0.
- WBS v1.1 остаётся неизменной: Beta 1.0 baseline — 42% implementation / 31% verification. Не пересчитывать проценты этим документом.
- Stage 4 остаётся **NOT ACCEPTED / BLOCKED**, accepted verification 0%; `INONE_MLS_NATIVE_ENABLED=false`; no merge.
- Ограничения среды: Dell XPS 13 / Windows 10; RAM считать 8 GB planning baseline; около 10 GB свободного диска; не запускать тяжёлые Flutter/Android builds, большие параллельные suites, широкую загрузку зависимостей; не устанавливать self-hosted runner; не менять GitHub billing safeguards и не создавать платное использование без разрешения.

## 2. Категории и реальные сервисные границы

### 2.1. Фактическая архитектура

По проверенному дереву не обнаружены независимые deployable microservices. Текущая серверная архитектура — **модульный монолит / один Node.js HTTP server**, а не набор независимо развёртываемых микросервисов. Не называть внутренние модули микросервисами.

| Категория / домен | Текущий компонент и путь | Фактическая роль | Состояние по исходникам | Основной пробел |
|---|---|---|---|---|
| Backend runtime | `inone-development-archive-0.6.0/engine/src/main.js`, `src/server.js` | Один HTTP-сервер; bootstrap PostgreSQL pool, миграции, конфигурация, маршруты | SOURCE PRESENT | Нет подтверждённого текущего production/staging deployment и runtime smoke на актуальном SHA |
| Auth / identity | `engine/src/server.js`, `account-rules.js`, `identity-rules.js`, `provider-auth.js` | Email/password, registration, provider proof, sessions, device approval | SOURCE PRESENT / PARTIAL | Flutter provider callbacks, typed flows, full screen mapping, real SMTP/provider environment acceptance |
| Recovery / account security | `recovery-rules.js`, routes in `server.js` | Account recovery, delayed recovery/cancellation, PIN/security flows | SOURCE PRESENT / PARTIAL | UI flow and deep-link/code branches, exact error-state and platform acceptance |
| Organization / tenancy | `org-*.js`, migrations 0020–0024, routes in `server.js` | Organizations, requests, documents, links, settings, platform administration | SOURCE PRESENT / PARTIAL | Screen actions, document picker/download, role-aware navigation and owner-only operations |
| Rooms / chat domain | `room-*.js`, `server.js` | Direct/group rooms, membership, capabilities, invites, settings, event history | SOURCE PRESENT / PARTIAL | Typed Flutter mutations, conversation screen binding and complete UX state handling |
| MLS server API | `mls-rules.js`, `mls-wire.js`, `server.js` | Ciphertext, commits, welcomes, key packages, device and sync endpoints | SOURCE PRESENT | Backend does not replace native client cryptographic verification; server/client protocol integration acceptance pending |
| Native MLS client | `inone-engine-poc-0.6.0/mobile-mls/mls-client` | Rust/OpenMLS client library with durable encrypted state/outbox/sync | SOURCE PRESENT in source branch | Stage 4 not accepted; generated bindings and platform/runtime tests not accepted |
| Flutter host | `mobile/lib/main.dart` | Flutter app shell, WebView host, navigation/asset loading | SOURCE PRESENT | Full production route/screen coverage and platform visual acceptance |
| WebView bridge | `mobile/lib/claude_ui_bridge.dart` | Typed-ish messages for navigate/api/pick; fixed API allowlist | PARTIAL | Allowlist currently only 10 calls; missing operation-specific DTOs, file picker and full screen lifecycle |
| API/session/network | `mobile/lib/core/network/*`, `core/session/inone_session.dart` | HTTPS validation, bearer handling, refresh/session state, typed errors | SOURCE PRESENT / PARTIAL | Verify every auth/recovery/MLS session edge and native refresh-token ownership on platforms |
| Data/repositories | `mobile/lib/core/data/inone_repositories.dart` | Typed read repositories for profile, rooms, orgs, approvals, requests, config | PARTIAL | Most write repositories absent; messages/attachments/search/settings action repositories incomplete |
| UI asset/design system | `mobile/assets/ui-approval/`, `mobile/lib/approved_screens.dart`, `claude_screen_catalog.dart` | Approved HTML/CSS/JS/fonts, manifest and stable screen IDs | SOURCE PRESENT | Asset packaging/rendering and functional bridge integration must be checked on Android/iOS |
| Database | PostgreSQL via `pg`, `engine/src/store.js`, `schema.sql`, migrations | Durable server-side records | SOURCE PRESENT | Current production migration/backup/restore/connection-pool operations not established by source inspection |
| Object/file storage | `engine/src/object-store.js`, `migrations/0016-files.sql` | File/object persistence | SOURCE PRESENT | Production storage durability, malware/content policy, upload/download UI, retention and backup validation |
| Email | `engine/src/mail-smtp.js` | SMTP adapter | SOURCE PRESENT | Real provider credentials, DNS/deliverability, bounce/abuse operations not verified |
| SMS | `engine/src/sms.js`, `phone-rules.js` | SMS interface/dev memory implementation | PARTIAL | Real provider integration and delivery/verification not accepted |
| Push | `PUT/DELETE /devices/me/push`, migration 0017 | Device token registration lifecycle | PARTIAL | Actual FCM/APNs sender, permission lifecycle, delivery receipts, deep links and platform tests |
| Config / feature flags | `engine/src/flags.js`, `/config*`, migration 0018 | Public/private configuration and feature gating | SOURCE PRESENT / PARTIAL | Operational policy, safe exposure review, admin workflow and runtime verification |
| Observability / operations | `logger.js`, health/readiness routes, backup scripts/docs | Logging, health and operational support | PARTIAL | Metrics/tracing/alerts, log retention/redaction, backup restore drill, incident/runbook and SLOs |
| CI / release | `.github/workflows/*` | Source checks, codegen, mobile/native matrix | CONFIGURED / BLOCKED | Latest relevant CI jobs failed before steps or skipped; exact cause UNKNOWN; do not infer |
| Test infrastructure | Node/Rust/Flutter tests and CI workflows | Unit, integration, DB, native platform verification | SOURCE PRESENT / NOT RUN on current head | Need authorized runner and one exact-SHA acceptance matrix |

### 2.2. Microservice conclusion

**Confirmed by the inspected tree:** no separately deployed service directories, independent service manifests or separate runtime deployment units were identified for Beta 1.0. The backend starts through one `src/main.js` and constructs one `createServer()` application. PostgreSQL, local/object storage, SMTP/SMS and push are dependencies/adapters, not independently verified microservices.

Future extraction into services is not a Beta 1.0 task. First enforce clear module boundaries, explicit interfaces and contracts inside the monolith. Do not add network hops or distributed-system complexity without a measured requirement.

### 2.3. Critical duplicate engine source trees

The audited tree contains both:
- `inone-development-archive-0.6.0/engine/` — Stage 3 API audit names this as backend source of truth.
- `inone-engine-poc-0.6.0/` — Stage 4 mobile Rust crate path points here from `mobile/rust/Cargo.toml`.

Tree comparison on audited SHA:
- archive engine paths: 280 entries;
- engine-poc paths: 257 entries;
- common relative paths: 257;
- identical blobs among common paths: 212;
- differing blobs among common paths: 45;
- archive-only paths: 23;
- engine-poc-only paths: 0.

This is a **high-priority source-of-truth risk**. Do not blindly copy one tree over the other. Produce a file-by-file diff classification (backend, MLS Rust, migrations, tests, docs, package manifests), designate canonical paths for Node backend and Rust MLS client, and document exact provenance before any consolidation. Stage 4 workflow currently uses the archive engine as `INONE_ENGINE_DIR` for engine integration, while the mobile Rust Cargo dependency references the engine-poc MLS crate. That intentional split must be explicit and continuously checked.

## 3. Screen inventory and UI/API integration status

Screen inventory evidence:
- `mobile/assets/ui-approval/screen-manifest.json`: 24 screen IDs, manifest version `0.8-approval-batch-2`.
- `mobile/lib/claude_screen_catalog.dart`: 31 total stable screen IDs after adding seven approved v1 chat/rooms/profile/org screens.
- `mobile/CLAUDE_UI_INTEGRATION.md`, `mobile/API-CONTRACTS-BETA-1.md`, and `development/integrations/FLUTTER-SCREEN-HANDOFF-FOR-CLAUDE.md` define current source and handoff boundaries.

### 3.1. Screen-by-screen checklist

| ID | Screen | API / role | Source-level gap / required action | Priority |
|---|---|---|---|---|
| SC-01 | Вход | POST /login | Validate request/response/errors, rate limit, session handoff, navigation | P0 |
| SC-02 | Регистрация: почта | POST /register/email | Validate privacy-preserving response, resend/429 and duplicate-email behavior | P0 |
| SC-03 | Подтверждение email | POST /register/email/confirm | Registration token lifecycle, expiry, replay and navigation | P0 |
| SC-04 | Профиль регистрации | POST /register | Enforce owner phone-required policy and immediate-login semantics; validate input | P0 |
| SC-05 | Google/Apple вход | nonce + provider verify | Native provider SDK/callback, nonce binding, typed host flow; BLOCKED until exact contract/platform setup | P1 |
| SC-06 | Provider registration | POST /register/provider | Ticket expiry/replay and typed registration flow | P1 |
| SC-07 | Recovery start | POST /recovery/start | Privacy-safe copy, channel branch, 429 retryAt and enumeration resistance | P1 |
| SC-08 | Recovery link confirm | POST /recovery/confirm | Deep link/universal link lifecycle and non-mutating preview semantics | P1 |
| SC-09 | Recovery complete | POST /recovery/complete | Code/PIN requirements, 48-hour policy, session/device revocation UX | P1 |
| SC-10 | Recovery/admission cancel | recovery cancel-by-code / admission cancel | Context must choose correct route; do not conflate recovery and admission credentials | P1 |
| SC-11 | New device approval | login + approvals + claim | Polling, activation, pollSecret, timeout and cancellation lifecycle | P1 |
| SC-12 | Logout | POST /logout | Explicit logout must clear local identity/session even on remote/native cleanup errors; verify no auto-resume | P0 |
| SC-00 | Main menu | client-side | Role/capability-aware visibility; server remains authoritative; no false admin access | P1 |
| RQ-01 | New organization request | POST /org-requests | Typed create repository, validation, result and retry | P1 |
| RQ-02 | Request documents | POST /org-requests/:id/documents | Native file picker, type/size (5 MB) validation, progress, retry and secure upload | P1 |
| RQ-03 | My requests | GET /org-requests | Applicant/admin result shaping, empty/error/retry and status mapping | P1 |
| RQ-04 | Request detail/documents | GET request + document | Secure binary download, ownership/role states, audited access | P1 |
| PS-01 | Admin request list | GET /org-requests | Platform staff gate, filters, paging and forbidden state | P1 |
| PS-02 | Admin request detail | GET request + document | Read-only audit view, owner/staff permissions and document download | P1 |
| PS-03 | Decision | POST /org-requests/:id/decision | Platform-owner-only decision, confirmation, 403/409 handling | P1 |
| SR-01 | People search | GET /users/search | Typed query/results, privacy limits, shared-org/link boundary and chat-start contract | P1 |
| ST-01 | Push settings | PUT/DELETE /devices/me/push | Native permission/token lifecycle and actual FCM/APNs delivery are not established | P2 |
| ST-02 | System status | GET /config/public + /config | Confirm safe fields, flag names, unavailable/maintenance semantics | P2 |
| ST-03 | Global banners/states | shared client state | Bind global network/session/maintenance/rate/error states consistently | P1 |
| CH-01 | Chat list | GET /rooms/mine | Typed room model, sort/unread/favorite behavior only where API supports it; empty/error/offline | P0 |
| CH-02 | Conversation | events + MLS commits/welcomes/messages/sync/read | Native MLS pipeline, history ordering, commit-before-message, ACK only after durable storage, outbox, retry and reconnect | P0 |
| GR-01 | Groups/channels list | GET /rooms/mine | Distinguish room kinds, roles and capabilities without inventing unsupported filters | P1 |
| GR-02 | Create group | POST /rooms | Typed create payload, membership/org prerequisite, validation and idempotency | P1 |
| GR-04 | Group details/settings | members/settings/name/roles | Map each control to exact route, capability and permission; do not infer actions from visual controls | P1 |
| OR-01 | Organization selector | GET /orgs/mine | Active membership/role binding; do not imply server-side filter if absent | P1 |
| PR-01 | User profile | GET /profile | Read-only unless profile-update endpoint is verified; mapping and privacy states | P1 |

**Important:** design-declared API strings are not authorization grants. Backend route existence does not mean Flutter host dispatches the operation. The bridge allowlist currently lists ten operations: login, register/email, register/email/confirm, register, logout, orgs/mine, org-requests, config, config/public and rooms/mine. Other operations require dedicated typed methods, DTOs, validation, permission/error mapping and tests. Generic screen probes remain GET-only. The WebView must not receive tokens or make direct network requests.

### 3.2. Screen acceptance checklist (repeat for every ID)

- [ ] Stable screen ID and exact approved source path preserved.
- [ ] Design spec reviewed for required fields, actions, transitions, validation, responsive behavior and all states.
- [ ] Every action mapped to a real API contract or explicitly marked client-only / blocked.
- [ ] Method, exact path, auth, request DTO, response DTO, error codes, permissions, side effects and retry semantics evidenced from backend source.
- [ ] Flutter typed repository/controller exists; widgets do not receive raw JSON.
- [ ] Loading, empty, error, offline, rate-limit, unauthorized/forbidden and maintenance states implemented where relevant.
- [ ] Navigation/back/system back and session expiry behavior defined.
- [ ] No hard-coded production sample data; no fake successful API responses.
- [ ] Accessibility semantics, stable widget keys, keyboard/safe-area handling and locale strings present.
- [ ] Widget/controller/repository tests authored and executed when a runner is available.
- [ ] Android and iOS asset loading, WebView bridge, keyboard, safe area and visual parity accepted.
- [ ] Evidence recorded against exact SHA.

## 4. Cross-system critical gaps

### P0 — blocks Beta 1.0 acceptance

1. **Canonical source-tree ambiguity:** 45 divergent common paths across the two engine trees; 23 archive-only paths. Need provenance classification and canonical ownership.
2. **Native MLS acceptance:** Stage 4 source work exists, but generated FRB bindings, platform builds/runtime checks and exact-SHA green acceptance are not established. Native MLS remains disabled.
3. **Conversation vertical slice:** no claim of accepted end-to-end path from authenticated session → room list → MLS history/commit processing → decrypt → durable local write → UI render → send/outbox → server delivery → ACK/reconnect.
4. **Typed Flutter operation coverage:** ten bridge allowlisted operations vs 31 screen IDs and numerous actions. Complete typed repository/application layer and close unsupported actions.
5. **Authentication/recovery vertical slice:** provider auth, recovery, approval polling/claim and deep-link routes are not fully wired to Flutter.
6. **API contract drift control:** automated source-to-contract-to-screen consistency checks must cover every declared operation and reject undocumented/unsafe routes.
7. **No current exact-SHA test acceptance for Stage 4:** prior workflow attempts failed before steps or were skipped; cause UNKNOWN. Need authorized runner and evidence.

### P1 — required for functional Beta 1.0 completeness

8. Organization request upload/download and platform-owner decision flow.
9. People search and personal-chat creation flow with privacy/authorization checks.
10. Room creation, group settings, invitations, membership and capability controls connected through typed APIs.
11. Profile screen field mapping and explicit read-only/edit policy.
12. Push delivery provider and platform lifecycle; distinguish token registration from actual message delivery.
13. Production email/SMS adapters, provider health, abuse handling and delivery observability.
14. File storage operational controls: size quotas, MIME/content validation, access audit, retention, backup and restore.
15. Operational monitoring: structured metrics, traces, error rates, queue/DB health, alerting and incident runbooks.
16. Backup/restore rehearsal for PostgreSQL and object store; retention and recovery-point/recovery-time objectives.
17. Localization completeness for Armenian, Russian and English, including server error mapping and accessibility text.
18. Privacy/security review for metadata, account enumeration, search, push previews, document access and logs.

### P2 — hardening and scale (within Beta 1.0 only where required by approved WBS)

19. Load/soak tests for group sizes and concurrent PostgreSQL operations.
20. Mobile network transitions, background/foreground, app kill/restart, low storage and device migration.
21. App distribution/signing, version compatibility, staged rollout, rollback and release checklist.
22. Dependency/license/SBOM and vulnerability review.
23. Rate-limit tuning and abuse telemetry from operational evidence.
24. UX polish: conversation-specific notification controls, unread filters, search filters and thread/follow behavior only if supported by Beta 1.0 scope/contracts. Do not silently expand scope.

## 5. Current code-level positive evidence (not release acceptance)

- Server bootstrap uses PostgreSQL pool, migration runner and one HTTP application.
- Server source contains auth, account recovery, devices, rooms, organizations, files, configuration, push-token registration and MLS routes.
- Mobile source has Flutter host, local WebView bridge, HTTPS-constrained API client, session abstraction, typed profile/room models and read repositories.
- Rust crate exists for Flutter Rust Bridge and references the OpenMLS client crate.
- Approved screen manifest and source catalog preserve stable IDs.
- Node/Rust/Flutter tests and CI workflows exist in repository.
- Stage 3 report records prior acceptance evidence on its exact historical code-validation SHA. That evidence must not be projected onto later Stage 4 changes without rerunning the relevant matrix.

## 6. Industry UX comparison — reference patterns, not copy instructions

Use these products as behavioral benchmarks for clarity and completeness, not as permission to copy protected UI or add out-of-scope features:

| Product reference | Verified pattern from official source | InOne design implication |
|---|---|---|
| Microsoft Teams | Chats/channels can be combined or separated; favorites, recent chats, teams/channels, unread filters and quick views organize work conversations. Search supports people, files, messages, sender/date/context filters. | CH-01 should make conversation type, unread state, recency and navigation obvious. Search should be scoped and typed; only expose filters supported by backend contracts. |
| Slack | Per-channel and group-DM notification preferences can differ; users can choose all new posts, mentions only or mute; mobile overrides and thread-follow options exist. | ST-01 and conversation settings should distinguish global vs per-conversation preferences, but backend/device support must exist before UI promises delivery. |
| WhatsApp multi-device | Independent linked devices, per-device identity keys and encrypted synchronization require explicit device lifecycle and secure history/state transfer. | InOne device list/approval/recovery and MLS sync must be treated as security-critical product flows, not just settings screens. Never claim seamless multi-device until tested. |
| Microsoft Teams collaboration model | Teams group people/content/tools around projects or organizational structure; channels organize work by topic/project and access is membership-scoped. | GR/OR screens should clearly communicate organization, room/channel context, membership and visibility boundaries. |

Official references:
- Microsoft Teams chat/channel experience: https://support.microsoft.com/en-gb/teams/teams-channels/explore-the-new-chat-and-channels-experience
- Microsoft Teams search: https://support.microsoft.com/en-us/teams/chat/search-for-messages-and-more-in-microsoft-teams
- Microsoft Teams teams/channels: https://learn.microsoft.com/en-us/microsoftteams/teams-channels-overview
- Slack per-conversation notification settings: https://slack.com/help/articles/360056534254-Manage-notifications-for-specific-channels-and-direct-messages
- Slack global/mobile notification settings: https://slack.com/help/articles/201355156-Configure-your-Slack-notifications
- WhatsApp multi-device security architecture: https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/

## 7. Development plan while full CI/server runs are unavailable

Do not try to emulate a live server in model memory. Use four explicit evidence layers:

**Layer A — source inspection (can be completed now):**
- route inventory and route-to-screen mapping;
- DTO and error mapping from server handlers;
- DB schema/migration integrity by static inspection;
- dependency graph and duplicate-tree diff;
- auth/session/token lifecycle review;
- permission matrix review;
- Flutter bridge allowlist and call-site coverage;
- Rust FFI API and generated-binding inventory;
- workflow permissions, triggers and exact-SHA logic review.

**Layer B — low-resource local checks (only if tools already exist and resource budget is safe):**
- `git diff --check`, JSON parse, YAML parse, TOML parse;
- source formatting checks on changed files only;
- Node syntax checks for changed JavaScript files;
- targeted Dart format/analyze only if Flutter SDK is already installed and no large dependency resolution/build is needed;
- Rust formatting/static inspection only if toolchain already exists;
- scripts that compare route manifests, screen IDs, asset paths and checksums without booting server.
Do not install large SDKs or download dependencies on the constrained Dell XPS 13.

**Layer C — deterministic tests authored now, execution deferred:**
- unit tests and contract fixtures for every change;
- source-contract tests that compare declared screen operations with backend routes and typed host allowlist;
- negative authorization fixtures;
- property/invariant tests for idempotency, ordering, ACK and fail-closed behavior;
- reproducible test commands and pinned versions recorded.

**Layer D — deferred runtime acceptance (must be run later):**
- PostgreSQL migrations and concurrency suite;
- Node API/integration suite;
- Rust/OpenMLS tests;
- FRB code generation and generated-file parity;
- Flutter analyze/tests;
- Android build + Keystore runtime;
- iOS build + Keychain runtime/signing;
- two-device MLS E2E, crash/restart/offline/reconnect;
- full release smoke, monitoring and backup restore.

Every check has one of: PASS, FAIL, NOT RUN, BLOCKED. If no executable runtime exists, record NOT RUN / BLOCKED with exact reason. No fake green tests.

## 8. Ordered work backlog and checklist

### Track A — architecture/source integrity
- [ ] A1. Produce 45-path divergence report for the two engine trees, grouped by domain and blob SHA.
- [ ] A2. Identify exact canonical Node backend path and exact canonical Rust MLS path.
- [ ] A3. Add a deterministic CI/static guard for intentional source mirroring or remove duplication only after owner-approved migration plan.
- [ ] A4. Document actual runtime/deployment topology and all external adapters.
- [ ] A5. Document module boundaries and dependency direction inside monolith.

### Track B — API contract and screen reconciliation
- [ ] B1. Build canonical 31-screen action inventory from manifest + catalog + actual HTML action hooks.
- [ ] B2. Map every action to exact backend handler, auth, request/response/error DTO and permission.
- [ ] B3. Compare backend routes to mobile typed repositories and bridge allowlist; classify missing/partial/blocked.
- [ ] B4. Implement contract drift tests; do not allow unverified paths.
- [ ] B5. Complete UI state and navigation matrices per screen.
- [ ] B6. Review all 31 screens against industry reference patterns in section 6 and record accept/reject rationale.

### Track C — mobile application integration
- [ ] C1. Keep Flutter host as sole network/token owner; HTML/WebView has no direct network access or secrets.
- [ ] C2. Expand bridge only through typed operation definitions and narrow allowlists.
- [ ] C3. Implement auth/recovery/provider/device approval typed flows.
- [ ] C4. Implement room/org/profile read and supported mutations with DTOs.
- [ ] C5. Implement file picker/upload/download safely.
- [ ] C6. Implement CH-02 as MLS-only pipeline; no plaintext fallback.
- [ ] C7. Add per-screen widget/controller/repository tests and offline/error/loading states.
- [ ] C8. Complete locale, accessibility, safe-area, keyboard and navigation checks.

### Track D — native MLS and mobile security
- [ ] D1. Resolve canonical source-tree relationship for Rust client and backend.
- [ ] D2. Complete generated FRB Dart/Rust binding generation and verify committed generated files.
- [ ] D3. Verify refresh token ownership remains Rust after adoption; no token/key exposure to Dart/logs.
- [ ] D4. Verify SQLCipher + protected Android Keystore/iOS Keychain behavior.
- [ ] D5. Verify transaction atomicity for MLS state, inbox and processed markers.
- [ ] D6. Verify outbox retry/idempotency, welcome receipts, commit replay and recovery states.
- [ ] D7. Run crash/restart, offline, device removal, missing key and DB/key mismatch tests.
- [ ] D8. Keep native MLS feature gate false until all D-items and required exact-SHA checks pass.

### Track E — backend/platform operations
- [ ] E1. Verify PostgreSQL schema/migration sequence and rollback/forward-only policy.
- [ ] E2. Verify SMTP/SMS production adapters and secret rotation without exposing values.
- [ ] E3. Implement and verify FCM/APNs sender, device token invalidation and deep links.
- [ ] E4. Verify object storage durability, permissions, quotas, content validation and backup.
- [ ] E5. Add metrics, tracing, redacted structured logs, alerts and runbooks.
- [ ] E6. Execute backup/restore drill for database + object store.
- [ ] E7. Establish staging/release/rollback process after infrastructure is authorized.

### Track F — QA and release acceptance
- [ ] F1. Create one exact-SHA matrix tying backend, Rust, Flutter, Android and iOS artifacts together.
- [ ] F2. Run Node memory suite and PostgreSQL suite.
- [ ] F3. Run Rust formatting/tests and OpenMLS/engine integration.
- [ ] F4. Run FRB codegen, generated-source check and Rust bridge tests.
- [ ] F5. Run Flutter analyze/tests and asset/widget tests.
- [ ] F6. Run Android build and Keystore smoke.
- [ ] F7. Run iOS build and Keychain smoke with protected signing environment.
- [ ] F8. Run two-device E2E: registration, login, approval, 1:1, group, offline, restart, membership removal, recovery, logout.
- [ ] F9. Run security/privacy regression and backup/restore checks.
- [ ] F10. Owner reviews evidence and explicitly authorizes merge/release.

## 9. First execution sequence (low-resource, no server)

1. A1: diff the two engine trees and produce exact file-by-file ownership report.
2. B1: extract all 31 screen IDs and every HTML bridge action into one normalized inventory.
3. B2/B3: reconcile all operations with server handlers and current typed host allowlist.
4. D1: resolve Node/Rust source-of-truth relationship.
5. C2/C3: implement the next small typed mobile flow based on verified contracts, beginning with highest-risk auth/recovery/CH-02 sequencing.
6. Add focused tests and static consistency scripts for each change.
7. Update report, session log and continuity docs; do not claim runtime acceptance.
8. Only after an authorized runner becomes available execute Layer D runtime matrix.

## 10. Definition of Done for any task in this plan

- Exact task maps to approved Beta 1.0 WBS, screen ID, API contract or security invariant.
- Source change is committed on an isolated task branch and retrievable from GitHub.
- Tests are authored; executed results are stated honestly.
- Static checks and source review are distinguished from runtime acceptance.
- No unverified endpoint, mock success, plaintext chat fallback, secret exposure or scope creep.
- Documentation, report, session log and continuity pointers are updated.
- No PR merge or native MLS enablement without explicit owner approval and exact-SHA green acceptance.

## 11. Next five tasks / handover

1. Diff report for 45 divergent engine paths.
2. Full HTML-action inventory for 31 screens.
3. Canonical source ownership decision for backend and Rust MLS.
4. Route/DTO/permission/bridge reconciliation.
5. Typed Flutter vertical slice plus deterministic contract tests.

## 12. References inside repository

- `development/PROGRESS-BASELINE.md` — owner-approved WBS v1.1.
- `development/AI-AGENT-MANDATE.md` — executor and acceptance rules.
- `development/reports/2026-11-11-stage-3-api-backend-audit.md` — Stage 3 route/screen audit.
- `development/reports/2026-11-11-stage-4-single-executor-progress.md` — Stage 4 detailed continuity and CI evidence.
- `mobile/API-CONTRACTS-BETA-1.md` — canonical Beta 1.0 API matrix.
- `development/integrations/FLUTTER-SCREEN-HANDOFF-FOR-CLAUDE.md` — UI implementation handoff constraints.
- `docs/continuity/2026-11-12-development-environment-constraints.md` — workstation and billing constraints.


## 13. Screen-by-screen UX benchmark review (source-level)

The following review covers every one of the 31 stable IDs. It compares the declared screen purpose/actions with the cited industry patterns and records what InOne should preserve or avoid. This is a requirements/design review from the manifest, catalog and current HTML source; it is not a visual QA pass on a running device.

| ID | UX review against benchmark | InOne decision / gap to resolve |
|---|---|---|
| SC-01 | Teams/Slack favor fast return to recent work, but secure enterprise chat must make account/device context clear before entry. | Keep sign-in minimal; clearly distinguish password vs provider paths; show privacy-safe rate/error states. Validate device ID binding and post-login routing. |
| SC-02 | Standard account creation should explain why email is collected and what happens next. | Show email destination, resend timing and anti-enumeration-safe copy; prevent duplicate-account disclosure. |
| SC-03 | One-time-code flows need clear expiry, resend cooldown and masked destination. | Add explicit expiry/cooldown/attempt feedback without exposing whether an account exists; confirm registrationToken remains host-only. |
| SC-04 | Enterprise onboarding benefits from concise identity fields and transparent organization/phone requirements. | Explain phone is required but SMS confirmation is not currently available; do not show a false verified-phone state. |
| SC-05 | Provider login should use native system authentication rather than embedded credential forms. | UI can present Google/Apple choices; actual native SDK callback, nonce and proof exchange remain BLOCKED until typed host/platform integration. |
| SC-06 | Provider registration should avoid asking users to re-enter provider-owned data unnecessarily. | Ask only for required InOne nickname; show provider identity context without exposing raw provider tokens to WebView. |
| SC-07 | Recovery UX must balance urgency and account-enumeration privacy. | Keep generic response copy, distinguish link/code paths only after safe server response; expose retryAt for 429. |
| SC-08 | Deep-link confirmation needs an explicit destination and clear trust boundary. | Add link-expired/invalid/offline states; confirm GET preview is non-mutating and POST consumes token. |
| SC-09 | Password reset should clearly state policy effects (sessions/devices/recovery delay). | Explain 48-hour recovery policy and PIN requirements accurately; do not imply instant recovery if server policy delays it. |
| SC-10 | Security cancellation screens must make the event being cancelled unambiguous. | Keep recovery cancellation and pending-device admission cancellation separate in copy and typed action selection. |
| SC-11 | Device approval is a trust decision; WhatsApp's multi-device model shows per-device identity/lifecycle is foundational. | Show requesting device identity, time/context and approve/deny outcomes; polling/claim/pollSecret flow is not yet wired end-to-end. |
| SC-12 | Logout should be explicit and predictable on shared devices. | Confirmation/cancel behavior and local cleanup must be clear; do not auto-resume after explicit logout, even if remote logout fails. |
| SC-00 | Teams organizes chats/channels and app destinations with clear navigation; Slack separates workspace navigation from user preferences. | Main menu should group chats, groups, organizations, profile and settings; admin entry must be role-gated and server-authorized. |
| RQ-01 | Enterprise onboarding usually communicates organization identity and required proof documents before submission. | Clarify organization/legal identity fields, consent and review expectation; POST contract must supply validation/result DTO. |
| RQ-02 | File upload UX should show type, size, progress, retry and successful attachment state. | Current HTML exposes select/upload/download actions; native picker/download adapter is absent. Add MIME/5 MB validation and safe error/retry states. |
| RQ-03 | Teams-style workspace context makes organization membership status visible and actionable. | Keep pending/approved/rejected states, but replace demo organization rows with API data; include empty state and request detail navigation. |
| RQ-04 | Detail pages should make status, timeline and evidence documents easy to inspect. | Bind only authorized applicant/staff data; secure document download and audited access still need host integration. |
| PS-01 | Enterprise admin queues need filters, status grouping and clear reviewer workload. | Keep status filters; add pagination/empty/error states only where server contract supports them; staff-only route guard required. |
| PS-02 | Review detail should separate read-only evidence from decision controls. | Show documents and audit context; decision action only for platform owner, not generic admin. Handle 403/409. |
| PS-03 | High-impact admin actions need explicit confirmation and irreversible-action clarity. | Separate approve/reject confirmation; show reason input only if server contract supports it; platform-owner authorization must be server enforced. |
| SR-01 | Teams search supports people/messages/files and filters; Slack search is context-aware. | Beta 1.0 screen is people search only: keep it focused, privacy-safe and typed; "Написать" requires verified personal-room creation contract, not merely search success. |
| ST-01 | Slack's per-conversation notification preferences and mobile overrides are more useful than a single global toggle. | Current backend route only registers/removes current-device push token; do not design per-channel rules as functional until APIs/data model exist. Show OS permission/provider state accurately. |
| ST-02 | Enterprise apps distinguish service availability from account/session state. | Use public/private config fields only as allowed; avoid demo data and avoid treating config as live health unless the backend contract says so. |
| ST-03 | Consistent global banners reduce confusion across chat, search and settings. | Treat as shared state component, not a separate API feature; standardize offline, maintenance, unavailable, rate, error and session-expired semantics. |
| CH-01 | Teams combines favorites/recent chats/unread quick views; Slack supports focused channel navigation. | Keep list scannable with room type, title, latest activity and unread only if supplied by backend; filters/favorites are blocked until supported by API/data. |
| CH-02 | WhatsApp multi-device demonstrates secure per-device identity and encrypted state sync; Teams/Slack show conversation context and search. | Prioritize message chronology, sender/time, delivery/retry state and room identity. MLS decrypt/persist/ACK ordering must be invisible but reliable; no plaintext fallback. |
| GR-01 | Teams teams/channels organize people and work by project/topic with membership-scoped visibility. | Make group vs channel semantics, organization context, visibility and membership clear; do not imply public/private semantics unsupported by current room contract. |
| GR-02 | Group creation should disclose who will be included and the visibility/organization context. | Add member selection and prerequisites only from verified API capabilities; idempotent submit/loading/error states required. |
| GR-04 | Mature collaboration apps expose settings according to role/capability, not generic admin status. | Every control must map to exact capability and route; disable/hide only as UX, backend remains authoritative. |
| OR-01 | Teams workspace/team context helps users understand which organization owns the conversation. | Show only memberships and roles returned by `/orgs/mine`; avoid a client-only active-org filter if backend does not support it. |
| PR-01 | Enterprise profile pages distinguish identity, account security and editable fields. | Current verified API is GET /profile; keep profile read-only until update contract exists. Do not show editable controls that cannot persist. |

### Screen review acceptance note

Before Claude's final design handoff, compare the exact current HTML screen and its stable ID against this table. If the design changes an action, field, transition or state, update the manifest and API integration inventory together. A UI control with no verified backend contract must be explicitly labelled visual-only / disabled / BLOCKED and must not simulate a successful operation.


## 14. A1 detailed audit supersedes the preliminary count

The preliminary count in section 2.3 counted Git tree entries (including directories) as if they were files. The corrected file-level audit is documented in `development/reports/2026-11-12-A1-engine-tree-drift-audit.md`: 34 divergent common blob files, 11 divergent directory tree entries, 23 archive-only entries (20 files + 3 directories), and no POC-only entries. Canonical ownership is now explicit: Node backend/schema/migrations/tests remain in the archive engine tree; the Flutter-connected Rust MLS client remains in the POC tree because `mobile/rust/Cargo.toml` points there. No files were consolidated or deleted. A repeatable no-dependency audit script and unit tests were added under `scripts/`; execution remains NOT RUN.
