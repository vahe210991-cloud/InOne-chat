# Полный аудит InOne: Beta 1.0 и Beta 2.0

**Дата/время:** 2026-11-09 09:35:12 Europe/Tallinn (UTC+03:00)  
**Тип:** repository/source/CI audit  
**Репозиторий:** `vahe210991-cloud/InOne-chat` (private)  
**Default branch:** `main`  
**Проверенный main HEAD:** `cf2e1515fee680c2e8c86720b570617ffbe471d4`  
**Аудитная ветка:** `audit/beta1-beta2-full-audit-2026-11-09`  
**Scope:** полный аудит подтверждённых продуктовых направлений и разделение релизов; без изменения продуктового кода, запуска серверов, деплоя, миграций и merge.

## 1. Executive summary

Проект имеет принятый backend P0/Rust/OpenMLS foundation, а также несколько Flutter development increments в отдельных draft PR. Это **не означает**, что Beta 1.0 является готовым мобильным продуктом: экранные HTML assets не перенесены в Flutter runtime, реальная API-связка неполна, native Android/iOS MLS и durable local message storage не завершены, live two-device E2E не подтверждён.

| Релиз | Backend implementation | Backend verification | Frontend implementation | Frontend verification | Интеграция / E2E |
|---|---:|---:|---:|---:|---:|
| **Beta 1.0** | 65% | 55% | 35% | 15% | 35% / 20% |
| **Beta 2.0** | 0% | 0% | 10% (только CRM placeholders) | 0% | 0% / 0% |

Сводная оценка по предложенной WBS:
- **Beta 1.0: 42% implementation / 31% verification.**
- **Beta 2.0: 2% implementation / 0% verification.**
- Предыдущая историческая оценка InOne 25% / Beta 1.0 35% сохранена; она была качественной и без WBS. Новая оценка не является математическим продолжением старой.

## 2. Источники и проверенные refs

Прочитаны:
- `AGENTS.md`, полный `development/AI-AGENT-MANDATE.md` (в branch `docs/mandatory-ai-agent-protocol-2026-11-09`), `development/README.md`, `development/WORKING-RULES.md`, `development/HANDOVER-CHECKLIST.md`, последний mandate report, `development/SESSION-LOG.md`;
- `development/BASELINE-2026-11-08.md`;
- `docs/continuity/CURRENT-STATE.md`, `DECISIONS.md`, `NEXT-SESSION.md`;
- `docs/TECHNICAL-DIRECTOR-STATUS-2026-11-08.md`, `development/integrations/HTML-FIRST-UI-APPROVAL-TO-FLUTTER.md);
- API inventory `mobile/API-INTEGRATION.md` из PR #28; screen handoff/catalogue/bridge из PR #31; `mobile/pubspec.yaml`, transport/repository files из PR #28.

Проверены:
- `main` @ `cf2e1515fee680c2e8c86720b570617ffbe471d4`;
- PR #28 `feat/beta1-full-screen-api-harness`, tested SHA `645bc579857d87fb5ac21d983fa189a4f330d87e`;
- PR #30 (typed rooms list; draft);
- PR #31 `feat/claude-ui-beta1-integration`, reported SHA `f522908e16c0a97bd5a988913196d9c63fa52340`;
- PR #32 report branch; PR #33 mandate branch `docs/mandatory-ai-agent-protocol-2026-11-09` @ `84ab61e924fea2d5126142fa26fbe71fe9a78a7c`;
- open PR inventory #18, #23, #26–#33; не все PR являются частью Beta 1.0 delivery и многие draft/reference-only.

## 3. Beta 1.0 — полный функциональный инвентарь

### 3.1 Backend / API / данные

| Функция | Состояние по источникам | Оценка |
|---|---|---|
| Independent InOne backend/database | решение владельца зафиксировано; Propo runtime dependency исключена | DECIDED; operational acceptance неполная |
| Backend P0 / Rust / OpenMLS core | PR #25 merged; 6/6 jobs PASS на PR SHA и post-merge run #134 | ACCEPTED для P0 scope |
| Health/readiness | `GET /healthz`, `GET /readyz` в API inventory | API listed |
| Login / refresh / logout | `POST /login`, `POST /token/refresh`, `POST /logout` | route contract listed; full mobile E2E not verified |
| Email registration | `POST /register/email`, `/register/email/confirm`, `/register` | route contract listed; end-to-end delivery/UX not verified |
| Recovery | `POST /recovery/start` | partial contract; end-to-end not verified |
| Profile | `GET /profile` | read listed; profile editing unavailable/not confirmed |
| Rooms | `GET /rooms/mine`, search/details/members/invites/requests | reads listed; mobile room list typed in PR #30; complete writes/chat flow not verified |
| Organizations | `GET /orgs/mine`, members/settings/log/links/admin-log, org requests | reads listed; write/admin decision flow not fully connected |
| Devices / approvals | `GET /devices/mine`, `GET /approvals` | reads listed; approval flow not verified end-to-end |
| Configuration | `GET /config`, `GET /config/public` | read probes listed |
| User search | `GET /users/search?nickname=...` | route listed; privacy and UI acceptance not verified |
| Files | `GET /files/:id/url` | download URL lookup listed; upload UI/progress not connected |
| Synchronization | `GET /sync` | event feed only; not a message history contract |
| Localization | Armenian/Russian/English approved as first locales | decision exists; app-wide runtime QA not evidenced |
| Chat themes | preset/custom theme direction recorded | complete editor can be deferred; UI parity/implementation not fully verified |
| Notifications / push | settings screens exist in concepts; live push flow not proven | NOT VERIFIED |
| Profile editing / active org room filtering | current state says update endpoint missing; rooms contract has no active-org filter | BLOCKED / not in accepted API |

**Критический вывод:** наличие backend routes и P0 engine does not prove every Beta 1.0 user journey is complete. Read API inventory and test harness are stronger than before, but write flows and production operations remain incomplete.

### 3.2 Frontend / Flutter / approved UI

| Функция | Состояние | Оценка |
|---|---|---|
| Flutter app shell | mobile package exists on PR #28 branch | IN PROGRESS |
| HTTP transport | typed ApiClient, error mapping, auth header, timeout | IMPLEMENTED in branch |
| Session | in-memory tokens, device ID secure storage; refresh ownership temporarily Flutter | PARTIAL / architecture transition pending |
| Profile / rooms / org read repositories | typed/read repositories in PR #28; typed rooms in PR #30 | PARTIAL |
| Test gallery | 95-screen selector and source gallery integrity check in PR #28 | QA HOST, not product completion |
| Approved screen catalogue | stable IDs and screen stage catalogue in PR #31 | CATALOGUE ONLY |
| WebView bridge | typed navigate/api/pick parser and API allowlist in PR #31 | FOUNDATION; original HTML assets not yet bundled |
| Approved HTML/CSS/JS/fonts | Ui.zip source files not yet copied into Flutter assets on PR #31 | BLOCKED |
| Auth/register/recovery forms | designs/catalogue and backend routes exist; full functional forms and API end-to-end not evidenced | PARTIAL |
| Chat conversation screen | catalog lists `GET /rooms/:id/events`; current API inventory does not list this endpoint; must reconcile before claiming support | CONTRACT MISMATCH / BLOCKED |
| Organizations screens | requests/list/details in catalogue; reads exist; decision/write actions not wired | PARTIAL |
| Personal profile / settings | visual concepts and reads; edit/push operations not confirmed | PARTIAL |
| Localization and themes | decisions/spec exist; full Flutter implementation/golden parity not evidenced | NOT VERIFIED |

PR #31 explicitly states original HTML/CSS/JS/fonts from `Ui.zip` are not in Flutter asset bundle. Therefore the app does not yet render the owner-approved original UI via this bridge. Keep Beta 2.0 screens as placeholders; do not delete them.

### 3.3 MLS / mobile security / persistence

- Backend P0 / Rust/OpenMLS acceptance: PASS/merged (PR #25, six CI jobs and post-merge validation).
- Android/iOS native MLS handlers and FFI packaging: not accepted/implemented in current Beta 1.0 mobile integration.
- Keychain/Keystore-backed SQLCipher key provider: not accepted.
- Durable encrypted local message store: not accepted.
- Incoming event ACK only after durable local transaction: required decision, not yet proven end-to-end.
- Offline queue, restart recovery, duplicate event handling, revoked-device and epoch-outdated flows: not accepted on real devices.
- Two-device send/receive/decrypt E2E: NOT RUN / no evidence.
- No plaintext fallback; MLS remains fail-closed.

P0 is closed for the accepted backend/Rust/OpenMLS scope; **mobile MLS integration remains open**. Do not collapse these into one status.

### 3.4 Beta 1.0 QA / operations

- PR #28 run #42563179564: Flutter setup, geometry/gallery integrity, pub get, analyze, tests and debug APK all PASS on its tested SHA.
- PR #31 run #42570757834: pub get PASS, analyze PASS, tests PASS; Android APK step FAIL; artifact upload skipped. Prior report identifies Gradle 9.3.1 distribution HTTP 504. This is an infrastructure/build blocker, not a demonstrated app compile defect; nevertheless exact run is not green.
- PR #31 tests: 49 PASS per preceding status record.
- Live API against owner-supplied staging origin: NOT RUN.
- Android/iOS physical-device testing: NOT RUN / no evidence.
- SMTP/domain, SMS where required, deployment/proxy validation, backup/restore, monitoring and operational recovery: pending.
- No production deployment/server started in this audit.

## 4. Beta 2.0 — full functional inventory

### CRM
- Leads light/dark, Kanban light/dark, Deal detail light/dark preserved in approved screen gallery.
- Marked as Beta 2.0 placeholders.
- No verified backend entities/endpoints, permissions, pipelines, CRUD, search, filtering, activity log, tests or E2E in this audit.

### Cindy AI assistant
Product requirements from prior owner context:
- selectable AI model/provider;
- file processing;
- business correspondence drafting;
- archiving;
- accounting record preparation;
- management/bookkeeping support and financial snapshots.
No confirmed backend service, model/provider routing, prompt/security policy, file pipeline, audit log, UI runtime, tests or cost/usage controls were found in the audited GitHub implementation.

### Tasks and Calendar
Owner-described requirements:
- integrated task manager and calendar;
- creator, executor, observer roles;
- attachments and comments; comments appear in Messages;
- CRM task number;
- AI monitors progress and notifies observers.
No confirmed schema/API/Flutter module/notifications or E2E implementation found in audited source.

### Group collaboration candidates (PR #27)
- events with Going/Not going + notifications;
- polls;
- personal favorite messages;
- group search;
- permissioned bots;
- pinned messages/list.
PR #27 is planning/backlog only; final release inclusion and sequencing were not approved in that PR. Treat as candidates, not committed Beta 2.0 scope.

## 5. CI / GitHub state

| PR | Purpose | State / evidence | Audit interpretation |
|---|---|---|---|
| #25 | Backend P0/Rust/OpenMLS | merged; 6/6 PASS and post-merge run #134 | closed P0 foundation only |
| #28 | Flutter QA host + API test layer | draft; run #42563179564 success | harness and transport foundation, not complete app |
| #29 | Web visual preview | draft; visual-only, not Flutter Web/live API | preview artifact only |
| #30 | Typed rooms list | draft | data-layer increment; no full chat history/send/receive |
| #31 | Claude screen handoff bridge | draft; analyze/tests pass, APK build failed HTTP 504 | bridge/catalogue only; approved source assets not bundled |
| #32 | Timestamped status report | draft/docs | documentation only |
| #33 | Mandatory AI agent protocol | draft/docs; no workflow run visible on audited SHA | docs proposal, not merged |
| #27 | Beta 2.0 roadmap candidates | draft/planning | candidate backlog only |

No open PR was merged or promoted as a result of this audit. `main` remains unchanged.

## 6. Critical risks / blockers (ordered)

1. **UI source import:** original Ui.zip assets absent from Flutter runtime; cannot claim approved screens implemented.
2. **API contract mismatch:** chat catalogue references `GET /rooms/:id/events`, absent from API inventory; reconcile against backend source/OpenAPI before wiring.
3. **Native MLS bridge:** Android/iOS FFI, secure key management, durable local storage and ACK lifecycle absent; security-critical release blocker.
4. **End-to-end validation:** no live staging origin and no two-device E2E evidence; no full auth→org→chat journey acceptance.
5. **Write operations:** read-only probes dominate; registration/recovery/admin/membership/file workflows require dedicated validated forms and backend contracts.
6. **Operational readiness:** SMTP/SMS, deployment/proxy, backup/restore, monitoring and incident recovery not accepted.
7. **Build reproducibility:** PR #31 Android APK step failed due Gradle download HTTP 504; needs fresh exact-head green CI.
8. **Scope governance:** Beta 2.0 is partly owner-defined product direction and partly candidate backlog; final WBS and sequencing require owner approval.

## 7. Scores and interpretation

The detailed proposed weighted WBS is in `development/PROGRESS-BASELINE.md`.

- Beta 1.0: **42% implementation / 31% verification** (proposed weighted estimate).
- Beta 2.0: **2% implementation / 0% verification** (only CRM placeholders counted).
- Historic 2026-11-09 estimates InOne 25%, Beta 1.0 35% retained without deletion; the new WBS uses separate implementation and verification dimensions and is not directly comparable.
- No global InOne total is recalculated until the owner approves the WBS and Beta 2.0 scope.

## 8. Owner decisions required (do not guess)

1. Confirm whether the proposed WBS weights are acceptable, or specify preferred weights.
2. Confirm Beta 2.0 inclusion and priority: Cindy, Tasks/Calendar, CRM, and group collaboration candidates.
3. Resolve chat history contract: is `GET /rooms/:id/events` intended, or should the UI use another existing endpoint?
4. Confirm which original Ui.zip revision is canonical for Flutter asset import (do not assume from older branch notes).
5. Confirm the live staging API origin when ready for API E2E. No server will be started by this audit.

## 9. Actions and safety

- Used GitHub repository/file/PR/Actions read operations.
- GitHub Actions existing runs inspected; no new workflow dispatched.
- Codespaces availability was not provisioned/used; no paid resource created.
- No server, staging, production, DB migration, deployment, public preview, secret change, merge or release was performed.
- Product source unchanged; documentation-only audit branch.

## 10. Последние 5 предыдущих задач

1. ~~[x] Backend P0/Rust/OpenMLS accepted and merged — PR #25; 6/6 CI and post-merge run #134.~~
2. ~~[x] Flutter QA/API harness branch delivered — PR #28; run #42563179564 success; not merged.~~
3. ~~[x] Typed rooms list data-layer increment — PR #30; draft; acceptance of full chat flow not implied.~~
4. [ ] **IN PROGRESS** — Claude UI screen catalogue/bridge — PR #31; assets not imported, APK CI failed.
5. [ ] **IN PROGRESS** — Mandatory AI-agent instructions/reporting — PR #33; draft, no Actions run visible.

## 11. Следующие 5 задач

1. [ ] **BLOCKED / OWNER DECISION** — approve WBS weights and Beta 2.0 scope.
2. [ ] **BLOCKED / SOURCE IMPORT** — import canonical Ui.zip HTML/CSS/JS/fonts and manifest into GitHub product branch with checksums.
3. [ ] **BLOCKED / CONTRACT** — reconcile `GET /rooms/:id/events` against actual backend source and freeze API inventory.
4. [ ] **NOT STARTED** — complete Flutter approved-screen runtime, auth/org/profile/chat states, typed API flows and golden tests.
5. [ ] **NOT STARTED** — implement native Android/iOS MLS FFI + secure storage + durable local message persistence, then two-device E2E and all-green CI.

## 12. Cumulative progress and handoff

- Historical baseline: InOne 25%, Beta 1.0 35% (qualitative, preserved).
- New proposed baseline: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%.
- WBS is proposed, not owner-approved. Do not change weights without versioning and owner approval.
- Report is stored in GitHub audit branch; main untouched; PR required for review.
- HANDOFF INCOMPLETE until report/session-log are pushed and remote SHA is verified; no merge performed.
