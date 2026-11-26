# InOne Beta 1.0 — аудит личного и организационного профилей и план реализации

**Дата:** 2026-11-26 (UTC+4)  
**Репозиторий:** vahe210991-cloud/InOne-chat  
**Исследованная main:** 7d34b99fcc026a828b838e211d039c575aeace1d  
**Предыдущий source baseline:** 920e2a2ecef244c925061348eb68c8b09fe63922  
**Task branch:** audit/account-organization-profiles-beta1-main-7d34b99-20261126  
**Статус:** SOURCE REVIEW COMPLETE / IMPLEMENTATION NOT STARTED / RUNTIME ACCEPTANCE NOT RUN

---

## 1. Назначение и ограничения

Аудит охватывает личный профиль аккаунта (владелец/гость), профиль организации (owner/admin/member/guest), приватность, роли, backend/API/БД, Flutter/Dart, медиа, устройства, публикации, чаты и группы.

Прослежена цепочка Flutter/Dart → typed repository/session → HTTP API → backend authorization/business logic → PostgreSQL/storage → media delivery.

Это аудит существующей реализации, а не предложение переписать систему. Наличие визуального элемента не подтверждает backend-функцию. Скрытие кнопки не считается контролем доступа.

**Не выполнялось:** исходный код/API/schema/migrations/config/workflows/UI не менялись; тесты, сборки, серверы, production-запросы, dynamic BOLA/IDOR, нагрузочные/destructive проверки, симуляторы и физические устройства не запускались. WBS, продуктовая модель и privacy policy не менялись. Задачи реализации не зачёркнуты.

Статусы:
- **Подтверждено кодом** — непосредственно видно в source/contract/schema.
- **Подтверждено тестовым сценарием** — сценарий есть в тестовом коде, но мог не запускаться.
- **Архитектурный риск** — требует отдельного воспроизведения.
- **Отсутствует** — не найдено в проверенном current main.
- **Не проверено** — требует runtime/CI/production evidence.

## 2. База аудита, история и PR

### 2.1. Актуальность main

- Точный main SHA: **7d34b99fcc026a828b838e211d039c575aeace1d**.
- Previous FEED/PROFILE source baseline: **920e2a2ecef244c925061348eb68c8b09fe63922**.
- Compare: 12 commits ahead, 0 behind. Изменённые пути между этими SHA относятся только к документации. Product source, API, migrations и Flutter screens профиля/организации не менялись.
- HEAD message: docs(continuity): refresh FEED PROFILE plan hash.
- Commit status для exact main SHA: total_count=0. Это NOT RUN/NO STATUS, не PASS.
- Task branch создан от exact main SHA.

### 2.2. Уже существующий аудит личного профиля

Переиспользованы:
- development/FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md
- development/reports/2026-11-26-feed-profile-beta1-audit.md

Подтверждённые там факты:
- GET /profile существует;
- PATCH /profile/locale — единственная найденная операция изменения профиля;
- общий profile edit endpoint не обнаружен;
- полноценный guest profile API не обнаружен;
- avatar/cover binding не обнаружен;
- GET /users/search выдаёт ограниченный набор полей после relationship gate;
- generic files не образуют profile-media lifecycle;
- действует owner-approved privacy variant В: не расширять публичность и не придумывать новые правила доступа;
- предыдущий аудит не запускал tests/builds/dynamic security checks.

Этот план дополняет предыдущий организационным профилем и интеграциями, не дублируя FEED backlog.

### 2.3. Релевантные открытые PR

| PR | Состояние | Влияние |
|---|---|---|
| #166 Chats & Groups audit | Open / Draft, documentation-only, не слит | Содержит связанный P0: прямое удаление room member без MLS Remove Commit/epoch transition. Cross-module dependency. |
| #161 Organization picker | Open / Draft, не слит | Отдельный Flutter экран списка организаций и host changes. Не является main реализацией. |
| #127 G2 organization requests integration | Open / Draft, старый base, dirty при проверке | Меняет request/document backend, migration и Flutter. Не считать принятой main реализацией. |
| #87 G2 organization request screens | Open, not merged | Исходный request/admin/document flow. |
| #89 encrypted document lifecycle | Open, stacked на #87 | Не merged. |
| #86 device-bound file downloads | Open / Draft | Текущий main уже содержит user/device-bound signed download checks; не переносить повторно без diff review. |
| #42 F-01/F-02 PostgreSQL verification | Open / Draft | Workflow PR не доказывает выполнение PostgreSQL тестов текущего canonical engine. |
| #159 Stage 5 hardening | Open / Draft | Общий security/CI workstream, не доказательство проверки профилей. |

Ни один из перечисленных PR не был слит/закрыт этим аудитом.

## 3. Краткая оценка готовности

| Подсистема | Фактическое состояние | Verdict |
|---|---|---|
| Личный профиль владельца | Authenticated own-account summary, locale, device/security navigation; нет полноценного редактирования и media binding | PARTIAL |
| Личный профиль гостя | Search metadata есть, guest profile endpoint/DTO/screen нет | NOT IMPLEMENTED |
| Приватность личного профиля | Own-profile and search boundaries есть; public social policy не найдена | PARTIAL / FAIL-CLOSED |
| Профиль организации владельца | Membership, roles, settings, logs, links существуют; нет полноценной profile identity/edit модели | PARTIAL |
| Профиль организации участника | Roster/settings read и ограниченные права | PARTIAL |
| Профиль организации гостя | Public route/DTO/screen не найден | NOT IMPLEMENTED |
| Роли организации | owner/admin/member, server checks, atomic store mutations, audit | SOURCE IMPLEMENTED; runtime NOT RUN |
| Медиа профилей | Generic file infrastructure есть, profile/org binding отсутствует | NOT IMPLEMENTED |
| Organization removal → MLS | Server room membership удаляется без доказанного MLS Remove Commit | P0 BLOCKER |
| Тестовая приёмка | Test sources существуют, exact-SHA execution не было | NOT ACCEPTED |

Итог: организация имеет серверную модель членства/администрирования, но не полноценную публичную profile identity модель. Личный профиль сейчас преимущественно account/security summary, а не социальный профиль. Guest modes отсутствуют.

## 4. Архитектура личного профиля

### 4.1. Модель данных

Канонический backend: inone-development-archive-0.6.0/engine.

Account response формируется в engine/src/server.js через accountLevelInfo(userId) и store methods. GET /profile добавляет persisted locale, platformRole и securityHints.

Flutter DTO: mobile/lib/core/data/inone_profile.dart. Поля: userId, nickname, email, verificationLevel, providers, backupEmail, securityHints, locale, platformRole.

Это account summary/security DTO, а не публичная social-profile модель.

Migration 0030-profile-email-locale.sql добавляет profiles.locale с ограничением hy|ru|en. В проверенной модели не обнаружена отдельная социальная сущность с bio/avatar/cover/public contacts или отдельная privacy preferences model.

Разделение доменов:
- Account identity/auth: canonical user/account ID и authentication.
- Account summary: nickname/email/verification/providers/backup-email/security hints.
- Profile preference: persisted locale.
- Device/security: session, device inventory/revocation, signing/security hints.
- Public social profile: не обнаружен.
- Public profile privacy settings: не обнаружены.

Email, backup email, providers, platformRole, securityHints и device metadata нельзя переносить в guest DTO.

### 4.2. Backend API

Подтверждены:
- GET /profile — authenticated current-account read; user ID берётся из authed(req), не из client parameter.
- PATCH /profile/locale — authenticated locale update; только hy, ru, en.
- GET /users/search?nickname=... — authenticated, rate-limited, validates nickname, applies sharesOrgOrLink; response: userId, nickname, verificationLevel.

Не обнаружены:
- GET /users/:id/profile или аналогичный guest-profile read;
- общий PATCH /profile для имени/описания;
- avatar/cover mutation/binding routes;
- profile visibility/privacy mutation routes;
- posts/publications endpoints.

GET /users/search не является guest profile API. Relationship gate ограничивает discovery существующими отношениями: общая одобренная организация или активная связь организаций. Search response не возвращает email/phone.

### 4.3. Flutter: владелец

Пути:
- mobile/lib/core/data/inone_profile.dart
- mobile/lib/core/data/inone_repositories.dart
- mobile/lib/app/inone_mobile_app.dart
- mobile/lib/ui_dart_source/screens/main/inone_profile_screen.dart
- mobile/lib/ui_dart_source/models/inone_models.dart

Host вызывает InOneRepositories.profile() и строит InOneUserProfile:
- name = nickname, иначе email/fallback;
- handle = email;
- verification badge от verificationLevel;
- tasks/activity/projects = placeholders;
- menu: workspace, organization, platform requests when authorized, language, devices/security.

InOneProfileScreen имеет optional onEditAvatar, но production host не подключает реальную avatar mutation. Backend contract для avatar не найден.

**Вывод:** own account read, locale и device/security navigation есть. Общего редактирования профиля, avatar и cover нет.

### 4.4. Flutter: гость

Не обнаружены navigation flow для чужого профиля, guest profile screen/model/DTO, repository method или public endpoint. Guest mode личного профиля не реализован. Account DTO InOneProfile нельзя использовать как guest response.

## 5. Приватность личного профиля

Подтверждено:
1. GET /profile требует действующую authenticated session и возвращает current account.
2. GET /users/search требует auth, rate limit и sharesOrgOrLink.
3. Search response содержит только userId/nickname/verificationLevel.
4. Email и phone не возвращаются через user search.
5. Own-account DTO не является public DTO.
6. Device inventory/revocation endpoints используют authenticated account/device context.

Не найдено: public/private profile model, field-level visibility, guest DTO, block/follow graph, guest publication policy, отдельная privacy settings API/persistence.

**Owner decision:** privacy variant В сохраняется. Отсутствие guest API не означает public-by-default. Не возвращать гостю email/phone/backup email/provider links/security hints/platformRole/device data; не вводить новые block/follow/visibility semantics; не открывать owner-only media. Guest access остаётся BLOCKED до отдельного согласования.

## 6. Архитектура организации

### 6.1. Сущности

Подтверждённые SQL сущности:
- organizations: org_id, name, status, created_by, created_at;
- org_members: org_id, user_id, role, joined_at; PK (org_id,user_id);
- org_settings: max_group_members, channels_enabled, file_quota_bytes;
- org_settings_log: actor, field, old/new value, timestamp;
- org_links: organization pair, proposing/deciding actors, status, timestamps;
- admin_action_log: admin audit;
- rooms.org_id: room → organization;
- room_members: отдельное membership в room.

organizations не является обычным user profile. Отдельной organization profile table с description/category/logo/cover/contact/address не найдено.

Отношения:
- accounts → org_members → organizations;
- organizations → org_settings / org_settings_log / admin_action_log / org_links / rooms;
- rooms → room_members;
- accounts → devices/sessions/profile locale.

org_members и room_members — разные ACL domains. Organization role не заменяет room role/capability и MLS membership.

### 6.2. Organization API

Подтверждённые routes в engine/src/server.js и engine/ORG_API.md:

| Route | Фактический доступ |
|---|---|
| GET /orgs/mine | Authenticated; только собственный membership list |
| GET /orgs/:id/members | Только участник организации |
| POST /orgs/:id/members | Owner; admin только с role=member |
| POST /orgs/:id/members/:uid/role | Только owner |
| DELETE /orgs/:id/members/:uid | Owner; admin только для обычного member |
| POST /orgs/:id/leave | Self-leave с last-owner/owned-room constraints |
| GET /orgs/:id/settings | Любой участник |
| POST /orgs/:id/settings | Owner/admin |
| GET /orgs/:id/settings/log | Owner/admin |
| GET /orgs/:id/admin-log | Owner/admin |
| GET/POST /orgs/:id/links | Owner/admin |
| POST /orgs/:id/links/:lid/accept | Owner/admin принимающей стороны |
| POST /orgs/:id/links/:lid/revoke | Owner/admin любой стороны |

GET /orgs/:id/profile и иной public organization profile route не найден. Guest DTO не найден.

### 6.3. Фактические роли

| Операция | Owner | Admin | Member | Guest |
|---|---:|---:|---:|---:|
| Read roster | Да | Да | Да | Нет |
| Read settings | Да | Да | Да | Нет |
| Edit settings | Да | Да | Нет | Нет |
| Read admin/settings logs | Да | Да | Нет | Нет |
| Manage organization links | Да | Да | Нет | Нет |
| Add ordinary member | Да | Да | Нет | Нет |
| Add admin/owner | Да | Нет | Нет | Нет |
| Change roles | Да | Нет | Нет | Нет |
| Remove ordinary member | Да | Да | Нет | Нет |
| Remove admin/owner | Да, кроме последнего owner | Нет | Нет | Нет |
| Leave organization | Через /leave, с ограничениями | То же | То же | Нет |
| Public organization profile | Route absent | Route absent | Route absent | Route absent |
| Dedicated ownership transfer | Route absent | Нет | Нет | Нет |

Owner может назначить другого участника owner через role route или добавить участника с ролью owner. Отдельной atomic transfer operation в контракте не найдено.

### 6.4. Transactionality

В engine/src/store.js существуют addOrgMemberAtomic, changeOrgMemberRoleAtomic, removeOrgMemberAtomic. Операции используют transaction и lock organization row FOR UPDATE, проверяют текущую роль actor, меняют membership и пишут admin audit в той же транзакции. Для role change/remove есть last-owner guard. Remove также проверяет комнаты, которыми владеет target.

org-management.test.js содержит:
- owner/admin add rules;
- owner-only role changes;
- last-owner protection;
- concurrent owner self-demotion;
- rollback при audit insert failure;
- удаление room membership при leave/remove.

Это положительное source-level evidence. PostgreSQL concurrency/fault tests в этом аудите не запускались.

## 7. Flutter: профиль организации

Пути:
- mobile/lib/core/data/inone_organization.dart
- mobile/lib/core/data/inone_repositories.dart
- mobile/lib/app/inone_mobile_app.dart
- mobile/lib/ui_dart_source/screens/main/inone_org_profile_screen.dart
- mobile/lib/ui_dart_source/models/inone_models.dart

InOneOrganization содержит orgId, name, status, role.

Host получает organizations через GET /orgs/mine, roster через GET /orgs/:id/members и строит InOneOrgProfile. Передаются name, role/status, member count/roster, current user ID и capability hints. projects/teams/about = null, verified=false; logo/cover не передаются.

InOneOrgProfileScreen визуально умеет отображать cover/logo/about/stats и optional onEditCover, но production host передаёт onEditCover=null. Это reusable UI, а не подтверждённая media функция.

- Owner: roster и owner operations.
- Admin: roster и ограниченные admin operations.
- Member: roster/settings read, без admin actions.
- Guest: отдельный screen/navigation/API/DTO отсутствует.

UI показывает userId и role, а не полноценную карточку публичного профиля участника.

Не найдены backend fields/routes для about, category, contacts, address/geolocation, website/social links, logo, cover, gallery. Organization settings — operational settings, а не редактирование public card.

## 8. Медиа и файлы

### 8.1. Существующая generic file infrastructure

Backend содержит upload reservation, signed upload URL, upload completion, owner/device binding, room membership/capability checks, ready-state, signed download URL, user/device binding, current authorization check, size/hash validation и cleanup incomplete uploads.

engine/test/files.test.js содержит сценарии signed URL/device/member checks, upload size/hash, revoked device, room membership и cleanup.

### 8.2. Profile media отсутствует

Не найдены:
- avatarFileId/coverFileId в account/profile;
- logoFileId/coverFileId в organization;
- profile-specific upload/replace/delete endpoints;
- public media authorization policy;
- profile media DTO/gallery;
- cleanup lifecycle для заменённых изображений.

Generic files не становятся profile media автоматически. Owner-only file URL нельзя переиспользовать как public guest image URL.

До media implementation нужны owner/org binding, active device checks, actual image MIME/content validation, size/dimension limits, allowlist, replace/delete/orphan cleanup, URL expiry/cache policy и guest authorization только после privacy approval. Шифрование profile media не подтверждено, поэтому не заявляется.

## 9. Интеграции и P0 finding

### 9.1. Organization membership → rooms/MLS

removeOrgMemberAtomic в engine/src/store.js удаляет target из room_members всех комнат организации, затем удаляет org_members и пишет admin audit transactionally. В этой операции не обнаружен MLS Remove Commit или epoch transition для затронутых комнат.

Связанный audit Chats & Groups в PR #166 отдельно зафиксировал P0: direct server-side room member removal bypasses MLS Remove Commit/epoch transition. Его отчёт уточняет: это доказывает server/MLS membership inconsistency, но не доказывает прямую возможность получить новые ciphertext через server API, поскольку event ACL проверяет room membership.

Для organization profile это тот же cross-module risk: удаление из организации снимает server-side room ACL, но cryptographic MLS roster не подтверждён как удалённый. Нельзя считать безопасный отзыв полностью завершённым.

Не дублировать root cause в Chats & Groups backlog: cross-reference CHAT-P0-01 и общий remediation task.

### 9.2. Account/device lifecycle

Подтверждены own profile через authed(req), GET /devices/mine, DELETE /devices/:deviceId, current-device self-revocation protection, signed file downloads bound to user/device. Runtime tests для revoked-device profile/org API не выполнялись.

### 9.3. Feed/publications

См. FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md. Feed/posts domain в предыдущем аудите не подтверждён как реализованный. Не добавлять публикации в профиль до отдельного решения по Feed Beta 1.0 scope и privacy contract.

### 9.4. Chats/groups

Organization membership и room/group membership — разные ACL/MLS domains. Organization role не заменяет room capabilities. Organization removal не доказывает MLS Remove Commit.

## 10. Матрица фактического доступа

### 10.1. Личный профиль

| Сценарий | Owner | Другой authenticated user | Guest/anonymous |
|---|---|---|---|
| Own account GET | Да, own session | Нет | Нет |
| Locale update | Да | Нет | Нет |
| Own devices/revocation | Да | Нет | Нет |
| Search metadata | Relationship/rate gates | Только при sharesOrgOrLink | Нет |
| Full other-user profile | N/A | Endpoint absent | Endpoint absent |
| Edit nickname/about/avatar/cover | API absent | Нет | Нет |
| Private fields of another account | N/A | Не выдаются через search DTO | Не выдаются |
| Public posts/activity | Feed/posts not implemented | Not implemented | Not implemented |

### 10.2. Organization

| Сценарий | Owner | Admin | Member | Guest |
|---|---|---|---|---|
| Read own org list | Да | Да | Да | Нет |
| Read roster | Да | Да | Да | Нет |
| Read settings | Да | Да | Да | Нет |
| Edit settings | Да | Да | Нет | Нет |
| Add member | Any supported role | Member only | Нет | Нет |
| Change role | Да | Нет | Нет | Нет |
| Remove member | С ограничениями | Member only | Нет | Нет |
| Read logs | Да | Да | Нет | Нет |
| Manage links | Да | Да | Нет | Нет |
| Public org profile | Route absent | Route absent | Route absent | Route absent |
| Public org media | Не обнаружено | Не обнаружено | Не обнаружено | Не обнаружено |
| Dedicated transfer | Нет | Нет | Нет | Нет |

Матрицы описывают source behavior, а не динамически подтверждённые результаты запросов.

## 11. Security audit

### 11.1. Положительные source controls

- Own-profile route derives user ID from authenticated session.
- User search rate-limited and gated by existing relationship.
- Search response allowlisted; email/phone omitted.
- Organization member/settings/log/link routes perform server-side role checks.
- Organization member add/role change/remove are transaction-backed.
- Last-owner invariant uses organization-row lock and transaction.
- Admin audit is committed in the same transaction as role/member mutation.
- File download URL is bound to active user/device; owner-only and room membership checks exist.
- Organization member removal removes server-side room memberships.

### 11.2. Подтверждённая проблема

**ORG-P0-001 / CHAT-P0-01 — organization member removal does not prove MLS Remove Commit/epoch transition.**

Это security consistency defect. Не утверждать, что удалённый участник гарантированно может получить новые сообщения через server API: server ACL должен отклонять non-members. Доказанный дефект — server membership и cryptographic MLS membership могут разойтись.

### 11.3. Не подтверждено как уязвимость

Static review не доказал IDOR/BOLA на own-profile GET, выдачу email/phone через search, guest access к private org routes, самостоятельное назначение роли, обход owner/admin checks или last-owner race. Эти сценарии требуют regression tests. Наличие теста не означает, что он запускался.

### 11.4. Coverage gaps

- нет guest DTO и field-level guest allowlist;
- нет profile/org media association и public media policy;
- нет backend profile edit tests;
- нет public organization profile tests, поскольку route отсутствует;
- PostgreSQL race tests в org-links.test.js зависят от DATABASE_URL и не запускались;
- organization removal → MLS Remove Commit не покрыт подтверждённым E2E acceptance.

## 12. Тестовое покрытие

### 12.1. Backend tests в main

| Test file | Проверяемые сценарии по test source |
|---|---|
| engine/test/org-management.test.js | owner/admin add; owner-only role change; last owner; concurrent owner demotion; audit rollback; leave/remove and room ACL cleanup |
| engine/test/org-access.test.js | org membership required for room create/add; unapproved organization restrictions |
| engine/test/org-list-mine.test.js | only own memberships; authentication |
| engine/test/org-settings.test.js | owner/admin settings; member denied; bounds; group limit; channel toggle; quota; audit rollback |
| engine/test/org-isolation-matrix.test.js | cross-org isolation for events, files, members, invites, settings, requests, sync, devices, search and key packages |
| engine/test/org-links.test.js | propose/accept/revoke, stale accept/revoke race, PostgreSQL transaction scenarios |
| engine/test/organizations-model.test.js | roles/status constraints, multiple memberships, org-room relation |
| engine/test/files.test.js | signed URLs, device binding, membership, size/hash, revocation, quota, cleanup |

### 12.2. Flutter tests в main

- mobile/test/core/data/inone_profile_test.dart: DTO parsing, nullable fields, locale, validation, platformRole helpers.
- mobile/test/core/data/inone_repositories_test.dart: authenticated GET /profile, locale update route, response validation.
- mobile/test/core/data/inone_organization_test.dart: organization/membership/settings/link/admin-log DTO parsing.
- Отдельный current-main widget/integration test для owner/admin/member/guest organization-profile UI не найден.
- Guest profile widget/API test не найден, так как guest route/UI отсутствует.

### 12.3. Матрица тестовых пробелов

| Scenario | Existing test source | Missing proof |
|---|---|---|
| Own profile GET | DTO/repository | backend HTTP auth + revoked-device exact-SHA |
| Own locale update | repository | backend HTTP + DB persistence |
| Search privacy | org isolation covers relationship-gated search | explicit sensitive-field allowlist assertions |
| Guest personal profile | None | route/DTO/widget after privacy approval |
| Edit personal profile | None | allowlist, owner scope, validation, concurrency, rollback |
| Avatar/cover | No profile media tests | ownership, image validation, binding, replacement, signed/public access |
| Org roster | org list/access/isolation | complete role-specific direct API matrix |
| Owner/admin/member permissions | org-management/settings | negative tests for all routes and stale sessions |
| Last owner race | concurrent test source | PostgreSQL execution on exact SHA |
| Org member removal | org-management checks server ACL | MLS Remove Commit, epoch, per-device and restart proof |
| Guest org profile | None | route absent; privacy approval first |
| Organization media | None | secure lifecycle and public/private access |
| Ownership transfer | No dedicated route/test | atomic transfer and concurrency tests if approved |
| Device revoke | account/device and file test sources | profile/org re-auth after revoke on exact SHA |
| Organization links | org-links test source | PostgreSQL race/fault execution on exact SHA |
| Flutter org profile | DTO tests only | widget/integration role modes and UI states |
| Feed/posts | FEED plan says subsystem absent | scope decision and feed security test matrix |

**Execution:** NOT RUN. Ни один тест не запускался. Exact main commit status returned total_count=0. Исторические CI от других SHA не засчитываются как PASS для 7d34b99.

## 13. Реестр проблем

Приоритет отражает безопасность и Beta 1.0. P1 ниже — функциональные пробелы, не подтверждённые exploitable vulnerabilities.

### ORG-P0-001 — Организационное удаление участника не подтверждает MLS Remove Commit

- **Priority:** P0 Critical.
- **Подсистема/режим:** organization membership → room/group membership; owner/admin remove; removed member.
- **Факт:** removeOrgMemberAtomic удаляет room_members для комнат организации, затем org_members и пишет admin audit в транзакции. MLS Remove Commit/epoch transition не обнаружен.
- **Ожидание:** server membership и cryptographic MLS membership должны быть согласованы для затронутых комнат.
- **Файлы/routes:** engine/src/server.js — DELETE /orgs/:id/members/:uid и POST /orgs/:id/leave; engine/src/store.js — removeOrgMemberAtomic.
- **Доказательство:** store operation deletes room_members and org_members; related CHAT audit PR #166 documents direct room-member removal P0.
- **Source reproduction:** owner/admin removes org member belonging to org rooms; inspect transaction and MLS calls. SQL membership is deleted without MLS Remove Commit.
- **Влияние:** server ACL and MLS roster/epoch may diverge; cryptographic exclusion is not proven.
- **Security risk:** retained MLS state may not be cryptographically revoked. Direct new-ciphertext retrieval through server was not proven.
- **Fix direction:** integrate canonical Engine B MLS Remove Commit per affected room; durable reconciliation; fail closed on partial commit.
- **Tests:** owner/admin removal; multi-room; partial commit; retry/idempotency; restart; revoked device; PostgreSQL race; removed member cannot receive/decrypt post-removal content.
- **Acceptance:** server and MLS membership converge; epoch advances; no stale membership after crash/retry; audit and mutation remain atomic/reconcilable.
- **Dependencies:** CHAT-P0-01, canonical Engine B, MLS membership transaction journal.
- **Release:** Beta 1.0 blocker.
- **Status:** OPEN / SOURCE CONFIRMED / RUNTIME NOT RUN.

### PROFILE-P1-001 — Полноценный гостевой личный профиль отсутствует

- **Priority:** P1 High, functional scope gap.
- **Mode:** personal guest.
- **Fact:** relationship-gated user search returns limited identity fields; no guest profile route/DTO/screen/repository method.
- **Expected:** approved guest-safe read model, distinct from own account summary, if Beta 1.0 guest profile is confirmed.
- **Files:** engine/src/server.js; mobile/lib/core/data/inone_profile.dart; mobile/lib/app/inone_mobile_app.dart; profile screen.
- **Evidence:** current route inventory contains GET /profile, PATCH /profile/locale, GET /users/search; no /users/:id/profile equivalent found. Previous FEED/PROFILE audit agrees.
- **Reproduction:** authenticate as another user and attempt to open full user profile through current repository/API; no operation exists.
- **Impact:** full guest profile unavailable.
- **Security risk:** reusing InOneProfile could leak email, backup email, providers, security hints and platform role.
- **Fix:** obtain explicit privacy/field decision; then implement minimal guest DTO with server-side enforcement. No default public exposure.
- **Tests:** authorized/unauthorized guest; sensitive field allowlist; relationship gate; block/visibility only if approved; direct API and IDOR.
- **Acceptance:** only approved fields returned; own account DTO never returned; no access by userId substitution.
- **Dependencies:** owner privacy decision, variant В, PROFILE-SEC.
- **Release:** Beta 1.0 only if confirmed; otherwise Beta 2.0.
- **Status:** BLOCKED ON PRODUCT/PRIVACY DECISION.

### ORG-P1-001 — Гостевой профиль организации отсутствует

- **Priority:** P1 High, functional scope gap.
- **Mode:** organization guest.
- **Fact:** organization routes are membership-gated; no public organization profile GET/DTO/screen.
- **Expected:** guest-safe public card only if public access and fields are approved.
- **Files:** engine/src/server.js; engine/ORG_API.md; migration 0020-organizations.sql; Flutter organization profile host/screen.
- **Evidence:** API exposes /orgs/mine and member/settings/admin routes; organizations table contains name/status/creator metadata only.
- **Reproduction:** anonymous/non-member requests to member/settings routes are denied/not found; no public profile route exists.
- **Impact:** organization cannot be browsed through a guest profile.
- **Security risk:** reusing internal roster/settings DTO could expose member IDs, roles, settings, logs or links.
- **Fix:** define public organization DTO and field policy only after owner approval; keep separate from internal admin DTO.
- **Tests:** anonymous/guest/member/owner response allowlist; no internal members/roles/invites/settings/logs/documents; direct API BOLA.
- **Acceptance:** public fields explicitly allowlisted; internal routes remain gated.
- **Dependencies:** owner privacy/product decision, ORG-CORE, ORG-SEC.
- **Release:** Beta 1.0 if approved; otherwise Beta 2.0.
- **Status:** BLOCKED ON PRODUCT/PRIVACY DECISION.

### PROFILE-P2-001 — Нет полноценного редактирования личного профиля

- **Priority:** P2 Medium; **mode:** owner.
- **Fact:** only locale mutation exists.
- **Expected:** approved editable fields with typed validation and owner-only API.
- **Files:** engine/src/server.js; mobile/lib/core/data/inone_profile.dart; inone_repositories.dart; app host.
- **Evidence:** only PATCH /profile/locale found; no general edit endpoint/form.
- **Impact:** user cannot manage nickname/about/contact fields through profile.
- **Security risk:** future mass-assignment must reject userId, verification, platformRole, providers and device/security fields.
- **Fix:** approve field contract; explicit allowlist and owner scope.
- **Tests:** allowed/disallowed fields, malformed input, cross-user IDOR, concurrency, persistence, multi-device refresh.
- **Acceptance:** only approved fields update; protected account fields unchanged.
- **Dependencies:** owner field decision; PROFILE-CORE.
- **Release:** Beta 1.0 for agreed basic fields.
- **Status:** OPEN.

### PROFILE-P2-002 — Avatar/cover не связаны с profile model

- **Priority:** P2 Medium; **mode:** owner/guest.
- **Fact:** reusable UI has optional avatar callback, but production host has no mutation contract; no profile file association or guest media delivery.
- **Expected:** secure owner-bound media lifecycle and approved guest delivery policy.
- **Files:** profile screen; app host; backend generic file routes/store/schema.
- **Evidence:** no profile avatar/cover columns, binding routes or repository operations found.
- **Impact:** profile imagery cannot be persisted/loaded as profile data.
- **Security risk:** exposing owner-only generic files as public avatar URLs would bypass access policy.
- **Fix:** dedicated profile media association, actual image validation, owner/device checks.
- **Tests:** ownership, wrong file ID, cross-account binding, MIME spoofing, size/dimensions, replacement cleanup, unauthorized GET.
- **Acceptance:** only owner binds; no guest fetch without approval; deterministic orphan cleanup.
- **Dependencies:** PROFILE-EDIT; media policy.
- **Release:** minimal avatar Beta 1.0 if approved; expanded media Beta 2.0.
- **Status:** OPEN.

### ORG-P2-001 — Нет редактируемых business identity fields организации

- **Priority:** P2 Medium; **mode:** owner/member.
- **Fact:** organizations schema contains org_id/name/status/created_by/created_at; no about/category/contact/address. Existing settings are operational.
- **Expected:** approved minimum organization identity model and owner edit operations.
- **Files:** migration 0020-organizations.sql; server/store; inone_organization.dart; app _organizationProfile.
- **Evidence:** InOneOrganization contains id/name/status/role; Flutter sets about/projects/teams null.
- **Impact:** organization card cannot present/manage expected business details.
- **Security risk:** do not place private settings/contacts in public DTO by convenience.
- **Fix:** approve minimal fields; separate public/internal DTOs.
- **Tests:** owner-only edits, member/guest denial, allowlist, validation, persistence, concurrent writes.
- **Acceptance:** only approved fields persist and public/private mapping is explicit.
- **Dependencies:** owner field decision; ORG-CORE.
- **Release:** basic name/description only if approved; expanded business fields Beta 2.0.
- **Status:** OPEN / PRODUCT SCOPE REVIEW.

### ORG-P2-002 — Нет organization logo/cover/media lifecycle

- **Priority:** P2 Medium; **mode:** owner/guest.
- **Fact:** UI model supports logo/cover, but production host supplies neither and passes onEditCover=null; no org media fields/API.
- **Expected:** secure organization-bound logo/cover association with owner/admin policy.
- **Files:** org profile screen; app host; migration 0020; generic file routes.
- **Evidence:** profile builder passes name/role/status/roster and null about/stats; no logo/cover IDs.
- **Impact:** branding UI is placeholder.
- **Security risk:** public media policy absent; do not expose generic owner-only files.
- **Fix:** dedicated org media references and explicit owner/admin checks.
- **Tests:** upload/bind/replace/delete, cross-org IDOR, revoked admin, guest read only if approved.
- **Acceptance:** no unauthorized file association/read; safe replacement cleanup.
- **Dependencies:** ORG-P2-001; media architecture.
- **Release:** minimal logo Beta 1.0 if approved; gallery/brand tools Beta 2.0.
- **Status:** OPEN.

### ORG-P2-003 — Нет отдельного atomic ownership transfer workflow

- **Priority:** P2 Medium; **mode:** owner.
- **Fact:** owner can add/promote another owner; no dedicated transfer endpoint/action that atomically changes ownership and records a transfer event.
- **Expected:** if Beta 1.0 requires transfer, one atomic operation with old/new owner semantics and audit.
- **Files:** server org routes; store changeOrgMemberRoleAtomic; ORG_API.md.
- **Evidence:** contract lists role mutation, not ownership transfer.
- **Impact:** ownership transition is multi-step.
- **Security risk:** partial transition if users assume dedicated transfer guarantee.
- **Fix:** no new operation without owner decision; if approved, transaction + audit + concurrency tests.
- **Tests:** old/new owner, last owner, self-transfer, stale session, concurrent transfer, rollback.
- **Acceptance:** one consistent transfer state and audit.
- **Dependencies:** owner decision; ORG-ROLES.
- **Release:** Beta 1.0 only if required; otherwise Beta 2.0.
- **Status:** OPEN / SCOPE REVIEW.

### PROFILE-P2-003 — Недостаточно backend profile API regression coverage

- **Priority:** P2 Medium; **mode:** owner/guest/security.
- **Fact:** Flutter DTO/repository tests exist; no dedicated backend profile HTTP suite found for own GET/locale/search allowlist/revoked device.
- **Expected:** backend HTTP tests and privacy regression pack.
- **Files:** engine/src/server.js; engine/test; mobile profile/repository tests.
- **Evidence:** current Flutter tests verify DTO parsing/repository path, not backend authorization/DB behavior.
- **Impact:** route/auth/DTO privacy regression may not be caught at backend boundary.
- **Fix:** add route-level tests before extending profile.
- **Tests:** auth required; user ID from session; locale persistence; revoked device; search relationship; exact DTO allowlist.
- **Acceptance:** negative tests fail closed; exact-SHA CI pass.
- **Dependencies:** PROFILE-CORE; test runner.
- **Release:** Beta 1.0.
- **Status:** OPEN.

### ORG-P2-004 — Недостаточно Flutter widget/integration coverage organization profile modes

- **Priority:** P2 Medium; **mode:** owner/admin/member/guest.
- **Fact:** organization DTO tests exist; no current-main widget/integration test found for profile role modes, actions, stale roster, loading/error/empty or guest.
- **Expected:** screen tests and API-backed integration tests.
- **Files:** app host; org profile screen; organization DTO tests.
- **Evidence:** test tree contains DTO test; no org-profile widget test located.
- **Impact:** UI/role affordance regressions may go unnoticed; UI is not authorization.
- **Fix:** widget tests with repository/session fakes and backend direct API tests.
- **Tests:** owner/admin/member controls, errors, empty roster, org switch clears roster, role revocation refresh, guest denial.
- **Acceptance:** UI matches server role; backend denies unauthorized direct requests.
- **Dependencies:** ORG-ROLES; ORG-GUEST decision.
- **Release:** Beta 1.0.
- **Status:** OPEN.

### ORG-P2-005 — Не обнаружен lifecycle archive/delete организации

- **Priority:** P2 Medium / scope-dependent.
- **Fact:** schema status is pending|approved|rejected; no archive/delete route found in checked contract.
- **Expected:** explicit lifecycle only if approved product policy requires it.
- **Files:** migration 0020; ORG_API.md; server.js.
- **Evidence:** schema status constraint and route inventory.
- **Impact:** no user-facing archive/close workflow established.
- **Security risk:** ad-hoc cascade deletion could orphan rooms/files or bypass retention/audit.
- **Fix:** do not add cascade delete by assumption; obtain retention/ownership decision.
- **Tests:** archive, room ownership, membership, file retention, audit, restore, idempotency if approved.
- **Acceptance:** referential integrity and retention preserved.
- **Dependencies:** owner lifecycle decision.
- **Release:** likely Beta 2.0 unless owner declares Beta 1.0 requirement.
- **Status:** OPEN / SCOPE REVIEW.

### PROFILE-P3-001 — Показатели профиля/организации являются placeholders

- **Priority:** P3 Low.
- **Fact:** personal tasks/activity/projects show —; organization projects/teams/about are null and stats unavailable.
- **Expected:** keep unavailable values honest; do not fabricate.
- **Files:** app _userProfile/_organizationProfile and screen models.
- **Evidence:** host maps placeholders/null explicitly.
- **Impact:** presentation incomplete; no security defect established.
- **Fix:** hide unsupported sections or retain honest placeholders until real contracts exist.
- **Tests:** no fabricated values; null/empty state.
- **Acceptance:** UI never implies live metrics without backend source.
- **Dependencies:** product scope/source APIs.
- **Release:** extended metrics Beta 2.0; basic placeholder cleanup may be Beta 1.0.
- **Status:** OPEN.

### 13.1. Сводка приоритетов

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 1 | Confirmed MLS/server membership consistency defect |
| P1 | 2 | Missing guest profile capabilities; conditional on approved Beta 1.0 scope |
| P2 | 8 | Missing editing/media/transfer/lifecycle and test coverage |
| P3 | 1 | Placeholder presentation |
| **Total** | **12** | P1 are functional gaps, not confirmed exploitable vulnerabilities |

## 14. Разделение Beta 1.0 / Beta 2.0

### 14.1. Beta 1.0

1. Исправить ORG-P0-001 вместе с CHAT-P0-01: organization removal must reconcile MLS membership.
2. Сохранить authenticated own-profile read, locale и device/security boundaries.
3. Добавить backend regression coverage для own profile, locale, search DTO allowlist и revoked-device behavior.
4. Сохранить существующие organization roles/server authorization; выполнить точную test matrix.
5. Довести минимальные owner profile editing operations только для полей, утверждённых владельцем.
6. Не открывать guest personal/org profile до согласования публичных полей и privacy semantics.
7. Если guest view подтверждён как Beta 1.0, реализовать отдельные guest-safe DTO/endpoints/screens, не переиспользуя owner DTO.
8. Не подключать profile/org media к generic files без media binding/content validation/access policy.
9. Проверить account/device revocation и organization membership removal с room/MLS lifecycle.
10. Пройти exact-SHA backend, PostgreSQL, Flutter, security regression и platform acceptance.

### 14.2. Beta 2.0 candidates

- расширенные категории/тип деятельности и public business fields;
- расширенные контакты, адрес, география, website/social links;
- organization gallery и brand management;
- advanced organization analytics/projects/teams;
- расширенные public presentation controls;
- archive/restore/delete после retention policy;
- granular delegated permissions beyond owner/admin/member;
- expanded profile statistics/activity;
- advanced guest visibility/social relationship controls.

Критические security, authorization, privacy и data-integrity defects нельзя переносить в Beta 2.0.

### 14.3. WBS

WBS v1.1 неизменна: Beta 1.0 baseline 42% implementation / 31% verification; Beta 2.0 baseline 2% / 0%. Этот аудит не пересчитывает проценты и не утверждает новый scope.

## 15. План реализации

Все задачи открыты. Ни одна не зачёркнута.

| ID | Priority | Задача | Основные компоненты | Dependencies | Target |
|---|---|---|---|---|---|
| PROFILE-SEC-001 | P0 | MLS-safe organization member removal | engine server/store, canonical Engine B MLS membership, org-management tests, CHAT-P0-01 | CHAT-P0-01 | Beta 1.0 |
| PROFILE-CORE-001 | P2 | Зафиксировать account/profile DTO allowlist и own-profile contract | server, accountLevelInfo, inone_profile.dart, repositories, API contracts | none | Beta 1.0 |
| PROFILE-PRIVACY-001 | P1 | Backend privacy regression pack for own profile/search/device | engine tests, profile/device tests | PROFILE-CORE-001 | Beta 1.0 |
| PROFILE-GUEST-001 | P1 | Guest-safe personal profile | approved DTO/repository/screen only after owner decision | privacy decision | Beta 1.0 if approved; else Beta 2.0 |
| PROFILE-EDIT-001 | P2 | Minimal owner profile editing | server/store/schema only for approved fields; Flutter DTO/repository/host | owner field decision | Beta 1.0 |
| PROFILE-MEDIA-001 | P2 | Personal avatar/cover lifecycle | file routes/store, profile association, Flutter picker/upload/render | PROFILE-EDIT; media policy | Minimal avatar Beta 1.0 if approved |
| ORG-CORE-001 | P2 | Document/test canonical org entity and route contract | migrations 0020/0022/0023, ORG_API, stores | none | Beta 1.0 |
| ORG-ROLES-001 | P0/P2 | Complete role and membership revocation invariants | server/store, org tests, MLS membership flow | PROFILE-SEC-001 | Beta 1.0 |
| ORG-OWNER-001 | P2 | Minimum organization identity edit | organization schema/store/API and typed Flutter model | owner field decision; ORG-CORE | Beta 1.0 minimal |
| ORG-MEMBER-001 | P2 | Member view/role refresh and negative authorization matrix | org routes, repositories, org profile screen/tests | ORG-ROLES | Beta 1.0 |
| ORG-GUEST-001 | P1 | Guest-safe organization profile | public DTO/API/screen only after privacy approval | privacy decision; ORG-CORE | Beta 1.0 if approved; else Beta 2.0 |
| ORG-MEDIA-001 | P2 | Organization logo/cover lifecycle | org media references, file lifecycle, Flutter upload/render | ORG-OWNER; media policy | Minimal logo Beta 1.0 if approved |
| ORG-TRANSFER-001 | P2 | Explicit ownership transfer if required | server/store/audit/tests/Flutter confirmation | owner decision; ORG-ROLES | Beta 1.0 if required; else Beta 2.0 |
| PROFILE-INTEGRATION-001 | P0 | Account/org/device/rooms/MLS revocation consistency | account/device/org/room/MLS services and integration tests | PROFILE-SEC | Beta 1.0 |
| PROFILE-FLUTTER-001 | P2 | Stabilize owner/member/guest screen modes | profile/org host, repositories, navigation, widget tests | API contracts | Beta 1.0 |
| PROFILE-PERFORMANCE-001 | P2 | Roster/settings/media pagination and query review | store queries, indexes, bounded responses/cache | ORG-CORE | Beta 1.0 only if measured bottleneck |
| PROFILE-TESTS-001 | P1 | Exact-SHA automated regression pack | Node/PostgreSQL/Flutter tests and CI | implementation tasks | Beta 1.0 |
| PROFILE-ACCEPTANCE-001 | P1 | Final owner/participant/guest security acceptance | full matrix, exact-SHA, Android/iOS | all Beta 1.0 P0/P1/P2 | Beta 1.0 |

### 15.1. Порядок

1. PROFILE-SEC-001 first: fix organization removal and MLS consistency before UI expansion.
2. PROFILE-CORE-001 + PROFILE-PRIVACY-001: lock down own-profile/search behavior.
3. ORG-CORE-001 + ORG-ROLES-001: verify current contract; do not rewrite already-working atomic store operations.
4. Obtain owner decisions for public fields, guest access, edit fields, media and ownership transfer.
5. Implement only approved minimum owner profile/org fields.
6. Add guest DTO/routes/screens only if scope/privacy are approved.
7. Add media binding only after storage/access policy is specified.
8. Complete Flutter role modes and tests.
9. Run exact-SHA backend/PostgreSQL/Flutter/security/platform matrix.
10. Owner acceptance; no closure before PR merge and evidence.

## 16. Критерии приёмки

### Личный профиль
- Own GET /profile requires authenticated active device/session.
- User ID derives from session, not caller-controlled body/path.
- Account DTO is explicit allowlist.
- No guest route returns email, phone, backup email, providers, security hints, platform role, devices or recovery/security data.
- Locale persists across devices and rejects unsupported values.
- Approved mutations are owner-scoped and reject protected fields.
- Media is account-bound and not public by default.

### Организация
- Owner/admin/member operations match actual role matrix.
- Backend checks every action regardless of Flutter button visibility.
- Last-owner invariant and audit atomicity pass PostgreSQL concurrency/fault tests.
- Member removal reconciles every affected room membership with MLS Remove Commit/epoch.
- Guest cannot read roster, roles, settings, logs, links, invites, documents or internal identifiers.
- Approved public profile uses separate allowlisted DTO.
- Media binding checks organization ownership and actor role.

### Flutter
- Owner/member/guest screens are separate modes backed by typed repositories.
- Loading/empty/error/retry/stale-state transitions covered.
- Organization switch clears old roster/cached data.
- Revoked role/device cannot continue privileged writes.
- No mock/placeholder is represented as live metric.
- Production remains Flutter/Dart; approved HTML is reference-only.

### Security/verification
- BOLA/IDOR tests for user/org/member/file IDs.
- Direct API negative tests for privileged routes.
- Role/device revocation tests.
- PostgreSQL concurrency/rollback tests.
- Media ownership/content-validation tests.
- No sensitive values in errors/logs.
- Required tests pass on same exact candidate SHA.
- Android/iOS acceptance recorded separately from CI/emulator builds.

## 17. Definition of Done

Task may be crossed out only after:
1. Scope/contract approved.
2. Implementation/tests committed in isolated PR.
3. Relevant tests actually run.
4. Exact-SHA GitHub Actions checks green.
5. Independent review completed.
6. PR merged into main with owner authorization.
7. Plan updated in same PR with PR URL, merge SHA, date, test evidence, executor and reviewer.

If regression is found, remove strikethrough and reopen while preserving history. No tasks are closed by this audit.

## 18. Журнал

| Date | Task ID | Change | PR | Merge SHA | Tests | Executor/reviewer | Status |
|---|---|---|---|---|---|---|---|
| 2026-11-26 | AUDIT-ACCOUNT-ORG-001 | Source-only audit and implementation plan | [PR #170](https://github.com/vahe210991-cloud/InOne-chat/pull/170) | Pending (not merged) | NOT RUN | ChatGPT / owner review pending | SOURCE REVIEW COMPLETE |

## 19. Решения владельца до реализации

1. Какие поля личного профиля доступны гостю?
2. Разрешён ли гостевой просмотр organization profile и какие поля публичны?
3. Какие поля личного/организационного профиля редактируются в Beta 1.0?
4. Входит ли минимальный avatar/logo/cover lifecycle в Beta 1.0?
5. Нужна ли отдельная atomic ownership transfer operation в Beta 1.0?
6. Нужны ли archive/restore/delete organization в Beta 1.0?

До этих решений не добавлять публичные маршруты и не расширять privacy policy.

## 20. Источники

- AGENTS.md; development/AI-AGENT-MANDATE.md; development/WORKING-RULES.md; development/AI-AGENT-GIT-INTEGRATION-POLICY.md.
- development/PROGRESS-BASELINE.md; development/UNIFIED-TASK-COMPLETION-RULES.md.
- docs/continuity/DECISIONS.md; CURRENT-STATE.md; NEXT-SESSION.md; SOURCE-OF-TRUTH.md.
- development/FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md and reports/2026-11-26-feed-profile-beta1-audit.md.
- development/CHAT-GROUPS-BETA-1.0-IMPLEMENTATION-PLAN.md and reports/2026-11-26-chat-groups-beta1-audit.md (PR #166, not merged).
- engine/ORG_API.md; engine/src/server.js; engine/src/store.js; engine/src/store-memory.js; engine/src/schema.sql.
- migrations 0020-organizations.sql, 0022-org-settings.sql, 0023-org-links.sql, 0030-profile-email-locale.sql.
- tests org-management, org-access, org-list-mine, org-settings, org-isolation-matrix, org-links, files.
- mobile/API-CONTRACTS-BETA-1.md; mobile/API-INTEGRATION.md.
- mobile profile/organization DTOs, repositories, app host, profile/org screens and corresponding core/data tests.

**Final audit state:** SOURCE REVIEW COMPLETE. Implementation NOT STARTED. Tests/builds/dynamic security/production/device checks NOT RUN. Product source, API, migrations, configuration and Flutter screens unchanged. WBS v1.1 and owner-approved privacy variant В unchanged.


## 23. Execution journal — PROFILE-SEC-001

### 2026-11-26 — remediation PR opened

- Status: **IN PROGRESS / NOT ACCEPTED / NOT MERGED**.
- Implementation PR: [#173](https://github.com/vahe210991-cloud/InOne-chat/pull/173).
- Source base: main 7d34b99fcc026a828b838e211d039c575aeace1d.
- Current implementation head at journal entry: b841e4f0a51d04dcdd2bf0cf80681055e04d394c.
- Changes: legacy direct room DELETE is rejected after an MLS epoch exists; organization member removal/leave and organization-link revocation fail closed when affected MLS-protected room memberships remain; PostgreSQL and in-memory stores share the guard; regression tests cover the three public paths.
- The organization action returns HTTP 409 with mls_removal_required and affected room IDs. Each affected room must first process an MLS Remove Commit; the organization action is then retried. This is a fail-closed backend guard, not a completed multi-room Flutter workflow.
- PostgreSQL locking was adjusted to serialize room revocation checks with MLS commits and to keep room/link lock ordering consistent.
- Validation: 11 GitHub Actions checks were queued on the exact implementation head; no PASS, test completion or merge is claimed yet.
- No migration, Flutter change, release flag change, WBS change or product-policy change.
- Closure criteria remain unchanged. Do not strike through this task until PR merge, review, exact-SHA test evidence and acceptance are complete.
