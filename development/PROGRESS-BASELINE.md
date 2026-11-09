# InOne — накопительная модель готовности Beta 1.0 и Beta 2.0

**Версия:** 1.0 (предварительная WBS для согласования владельцем)  
**Дата среза:** 2026-11-09 09:35 Europe/Tallinn (UTC+03:00)  
**Основа аудита:** GitHub `main` @ `cf2e1515fee680c2e8c86720b570617ffbe471d4`, draft PR #28–#33 и связанные Actions.  
**Статус:** предложенная измерительная модель; веса и состав Beta 2.0 требуют подтверждения владельца. Не является обещанием релиза.

## 1. Методика

Для каждого релиза считаются отдельно:
- **Implementation %** — доля объёма, реально реализованная и сохранённая в GitHub.
- **Verification %** — доля критериев, подтверждённая тестами/CI/устройствами/приёмкой на точном SHA.

Общий процент релиза рассчитывается как сумма `вес × процент направления`. Веса внутри каждого релиза дают 100%. Наличие макета, интерфейсной заглушки, написанного теста или незапущенного кода не считается функционально проверенной возможностью. Draft PR не является частью main и учитывается как реализованное в ветке, но не как принятое/выпущенное.

Порог оценки по каждому направлению:
- 0% — нет реализации/доказательства;
- 25% — архитектура, контракт или начальный каркас;
- 50% — основная часть кода есть, интеграция/сценарии неполные;
- 75% — полный основной сценарий, остаются крайние случаи/платформы/операционные проверки;
- 100% — критерии полностью реализованы и приняты на точном релизном SHA.
Промежуточные значения допустимы только как экспертная оценка с описанием доказательств.

## 2. Beta 1.0 — предложенная WBS

| Направление | Вес | Реализация | Проверка | Что входит |
|---|---:|---:|---:|---|
| Backend/API и данные | 25% | 65% | 55% | независимый InOne backend/DB, auth/recovery, profile, rooms, organizations, API contracts, migrations |
| Frontend Flutter и утверждённый UI | 25% | 35% | 15% | экраны auth, menu, chat, organizations, profile, settings; реальные assets, states, navigation, localization |
| API ↔ UI интеграция | 15% | 35% | 20% | typed transport/session/repositories, привязка реальных экранов, write flows, errors |
| MLS, mobile security и storage | 20% | 35% | 25% | Rust/OpenMLS core, Android/iOS FFI, Keychain/Keystore, encrypted durable local store, ACK/outbox, device recovery |
| QA, CI и E2E | 10% | 50% | 45% | unit/integration, Flutter tests, golden, two-device E2E, regression/security |
| DevOps и release readiness | 5% | 20% | 10% | staging config, SMTP/SMS, deploy/proxy, backups, monitoring, release/rollback |
| **Beta 1.0 итог** | **100%** | **42%** | **31%** | округление до целого |

**Текущая оценка Beta 1.0:** реализация **42%**, подтверждённая проверка **31%**. Это первичная экспертная оценка по предложенным весам, не автоматическая телеметрия. Её нужно сохранить как baseline v1 и менять только с доказательствами и журналом изменений.

### Что уже подтверждено
- Backend P0 / Rust / OpenMLS принят и объединён в main через PR #25; в документации зафиксированы 6/6 CI jobs PASS на PR-head и post-merge run #134.
- PR #28: Flutter QA/API harness, 95-screen selector, test gallery integrity, HTTP transport/session/read repositories; run #42563179564: Flutter analyze PASS, tests PASS, Android debug APK PASS.
- PR #30: typed room-list model/repository и тесты.
- PR #31: approved-screen catalogue, Beta 2.0 placeholders, typed WebView bridge; run #42570757834: analyze PASS, tests PASS, Android APK build FAIL (Gradle distribution HTTP 504).
- API inventory branch #28 lists health/readiness, login/refresh/logout, registration/recovery, profile, room/org read endpoints, device/approval/config, search, file URL, sync.

### Основные незакрытые критерии
- Оригинальные HTML/CSS/JS/font assets из Ui.zip не подключены в Flutter bundle на PR #31; экранный каталог и мост не равны работающим approved screens.
- Нет подтверждённого live staging API E2E: endpoint origin не предоставлен/не проверен в этом аудите.
- API write flows/forms и полный функциональный цикл регистрации/recovery/organization/room actions не подтверждены в приложении.
- Native Android/iOS MLS handlers и Rust FFI packaging не приняты; SQLCipher key в Keystore/Keychain и durable local message store не завершены.
- Incoming event ACK после локальной durable persistence, offline queue/restart recovery, two-device send/receive E2E не приняты.
- Profile editing endpoint отсутствует по текущему состоянию; org filter для rooms не подтверждён; push/file upload UX не подключены.
- SMTP/domain, SMS where required, tested deployment/proxy, backup/restore, monitoring/operations не приняты.
- PR #28–#31 остаются draft/не в main; отдельный CI green на PR #31 отсутствует из-за APK job failure.

## 3. Beta 2.0 — предварительная WBS

Beta 2.0 — будущий этап. Владелец подтвердил исключение Cindy/Tasks/Calendar из Beta 1.0 и сохранение CRM Leads/Kanban/Deal detail как Beta 2.0 placeholders. PR #27 хранит дополнительные групповые пожелания как candidates, без окончательного решения о включении/релизном sequencing. Поэтому этот WBS предварительный.

| Направление | Вес | Реализация | Проверка | Текущий статус |
|---|---:|---:|---:|---|
| Backend платформы и API | 25% | 0% | 0% | нет подтверждённой Beta 2.0 реализации в актуальном source audit |
| Frontend и экраны CRM | 20% | 10% | 0% | Leads/Kanban/Deal detail light/dark сохранены как визуальные placeholders |
| CRM domain (Leads/Kanban/Deals) | 15% | 0% | 0% | только placeholder UI/catalogue, нет подтверждённой логики/данных |
| Cindy / AI assistant | 15% | 0% | 0% | требования/продуктовое направление, нет подтверждённой реализации |
| Tasks + Calendar | 15% | 0% | 0% | требования/продуктовое направление, нет подтверждённой реализации |
| Group collaboration extras | 5% | 0% | 0% | PR #27: events/RSVP, polls, favorites, group search, permissioned bots, pinned messages — backlog candidates |
| QA, security, operations | 5% | 0% | 0% | нет Beta 2.0 acceptance suite |
| **Beta 2.0 итог** | **100%** | **2%** | **0%** | округление; placeholder UI учитывается только как небольшой implementation artifact |

**Текущая оценка Beta 2.0:** реализация **2%**, проверка **0%**. Не следует трактовать как начало полноценной разработки. Значение 2% отражает только наличие сохранённых визуальных placeholder экранов CRM.

## 4. Релизные границы и зависимости

### Beta 1.0 — IN SCOPE
- email/password login, verified registration, recovery, logout/session;
- rooms/chats, organizations and organization requests (в пределах существующих API);
- profile read, basic settings, language selection;
- approved screens and states; Armenian/Russian/English;
- independent InOne backend/database;
- secure MLS message lifecycle with native platform integration;
- QA, release build, operational readiness.

### Beta 1.0 — OUT OF SCOPE
- Cindy/AI assistant;
- Tasks and Calendar;
- CRM Leads/Kanban/Deal detail functional implementation;
- shared operational DB with Propo (deferred);
- features not supported by verified API contracts (e.g. profile editing, upload, push) until separately implemented/approved.

### Beta 2.0 candidates / planned direction
- CRM Leads, Kanban, Deal detail;
- Cindy: model choice, file processing, business correspondence, archive, accounting/management accounting and financial snapshots;
- Tasks + Calendar with creator/executor/observer, attachments, comments, CRM task number and notifications;
- group events with RSVP, polls, favorite messages, group search, permissioned bots, pinned messages.
Final inclusion, ordering and acceptance criteria remain owner decisions.

## 5. Cumulative baseline history

| Date | InOne overall | Beta 1.0 | Beta 2.0 | Method |
|---|---:|---:|---:|---|
| 2026-11-09 prior audit | 25% | 35% | 0–5% | qualitative, no WBS |
| 2026-11-09 this audit | not recalculated | 42% implementation / 31% verification | 2% implementation / 0% verification | proposed weighted WBS v1 |

**Important:** 25%/35% are preserved historical estimates, not silently replaced or mathematically comparable with this new two-axis assessment. The new values are provisional until the owner accepts the scope/weights. After approval, use this document as the cumulative WBS; never reset progress between chats.

## 6. Definition of Done — common

A feature is 100% only when:
1. product scope and screen/API contract are approved;
2. backend + frontend code is in the correct GitHub branch and committed;
3. unit and integration tests pass on exact SHA;
4. API contract and error/loading/empty/offline states are tested;
5. security/privacy requirements pass;
6. Android and iOS checks are complete where applicable;
7. end-to-end flow is tested in a controlled environment;
8. docs/report/continuity are updated;
9. release gate is accepted by owner.

Draft PR, test harness, mock data, visual placeholder or authored-but-not-executed test cannot satisfy DoD alone.
