# InOne — утверждённая накопительная модель готовности Beta 1.0 и Beta 2.0

**Версия:** 1.2 — WBS с утверждённым scope amendment Feed для Beta 1.0  
**Первоначальное утверждение:** 2026-11-09 (v1.1)
**Scope amendment:** 2026-11-26 (v1.2, Feed включён в Beta 1.0)  
**Источник:** PR #34 full audit; владелец явно подтвердил оценку и поручил использовать её как обязательную базу всех последующих чатов/агентов.  
**Актуальная ветка реализации UI:** `feat/beta1-ui-source-integration` (производная от `feat/claude-ui-beta1-integration`).

## Обязательное правило для каждого агента

Перед любой работой прочитать этот файл полностью и последний отчёт. Любая задача должна быть привязана к конкретной строке WBS, screen ID, API contract или acceptance criterion. В каждом отчёте обновлять накопительный процент с доказательствами. Не менять веса/границы релизов без отдельного разрешения владельца. Этот файл — базовая измерительная модель проекта, а не память чата.

## Методика (утверждена)

- **Implementation %** — фактически реализованный объём, сохранённый в GitHub.
- **Verification %** — критерии, подтверждённые тестами/CI/устройствами/приёмкой на точном SHA.
- Общий процент = сумма `вес × процент направления`; веса каждого релиза = 100%.
- Draft PR/макет/placeholder/тест, который не исполнялся, не считается принятой функцией.
- Уровни: 0% нет реализации; 25% каркас/контракт; 50% основная часть кода, интеграция неполная; 75% основной сценарий готов, остаются края/платформы; 100% полная реализация и приёмка на точном SHA.
- Веса, scope и критерии неизменны без owner approval; история оценок не удаляется.

## 1. Beta 1.0 — утверждённая WBS

| Направление | Вес | Реализация baseline | Проверка baseline | Критерии |
|---|---:|---:|---:|---|
| Backend/API и данные | 25% | 65% | 55% | independent InOne backend/DB, auth/recovery, profile, rooms, organizations, **publications/posts, own publications, authorized news feed, cursor query, post media authorization**, API contracts, migrations |
| Frontend Flutter и утверждённый UI | 25% | 35% | 15% | auth/menu/chat/org/profile/**native Feed and post composer/list/detail screens**, settings, exact assets, states, navigation, localization |
| API ↔ UI интеграция | 15% | 35% | 20% | typed transport/session/repositories, real screens, verified routes, **post CRUD/feed read/cursor/media integration**, writes/errors |
| MLS, mobile security и storage | 20% | 35% | 25% | Rust/OpenMLS, Android/iOS FFI, Keychain/Keystore, encrypted durable local store, ACK/outbox, device recovery |
| QA, CI и E2E | 10% | 50% | 45% | unit/integration, Flutter tests, golden, two-device E2E, **Feed authorization/IDOR/idempotency/pagination/media regression**, regression/security |
| DevOps и release readiness | 5% | 20% | 10% | staging, SMTP/SMS, deploy/proxy, backups, monitoring, release/rollback |
| **ИТОГО Beta 1.0** | **100%** | **42%** | **31%** | исходный утверждённый baseline |

**Historical starting baseline Beta 1.0 (WBS v1.1, 2026-11-09):** 42% implementation / 31% verification. WBS v1.2 adds Feed scope on 2026-11-26 without changing domain weights or rewriting the historical v1.1 baseline. These percentages are **not a current progress measurement for the expanded scope**; do not report them as recalculated/current until a full evidence-based re-baseline is approved. Each row remains a separate workstream. Do not raise overall progress for imported source alone: import proves provenance/asset readiness, not visual or functional acceptance.

### 1.1.1. Approved scope amendment — Feed in Beta 1.0 (2026-11-26)

Owner decision: publications and news feed are included in Beta 1.0. This amendment supersedes the earlier Feed exclusion/conditional statements in WBS v1.1 and the 2026-11-26 audit plan.

**Minimum Beta 1.0 Feed scope:**
- Create, read, edit and delete the authenticated user's own publications; author and timestamps are server-owned.
- Show the user's own publications and a news feed containing only publications the caller is authorized to read.
- Stable deterministic cursor pagination, refresh, duplicate prevention and deleted-record exclusion.
- Native Flutter/Dart Feed UI with loading, empty, error, offline and pagination states; typed repository/API integration.
- Server-side object authorization, idempotency, rate/abuse controls, audit-safe logging and regression tests before release.
- Post attachments only through validated, owner-bound and access-checked media lifecycle; no public/unprotected object URLs.

**Explicitly not implied by this scope approval:** comments/reactions, follows/subscriptions, stories, ranking/recommendations, public-by-default profiles/posts, public media links, blocks, or new visibility preferences. These require separate product approval or remain later-stage candidates. Variant В remains binding: preserve existing privacy behavior; do not infer that the user-search relationship gate automatically defines post visibility.

**Owner-approved visibility rule (2026-11-26):** every published item intentionally included in the general/news feed is readable by every registered and authenticated InOne account; anonymous access is denied. Attachments inherit the same eligibility and must be re-authorized at download. This rule does not expose profiles, drafts, private account data or other product domains. The audited source has no implementation yet; cross-account reads must remain disabled until server-side enforcement and regression tests pass. The existing `sharesOrgOrLink` user-search gate is not the feed authorization rule.

**Weight handling:** existing six domain weights remain unchanged and sum to 100%. Feed work is allocated inside Backend/API (25%), Flutter (25%), API↔UI (15%), and QA/CI/E2E (10%). No new percentage or current progress score is invented by this amendment. A full progress re-baseline must be based on source inventory and executed acceptance evidence.

**Version history:** v1.1 (2026-11-09) owner-approved starting WBS; v1.2 (2026-11-26) owner-approved Feed Beta 1.0 scope amendment, with weights and historical baseline preserved.

## 2. Beta 2.0 — утверждённая предварительная WBS

| Направление | Вес | Реализация baseline | Проверка baseline | Критерии |
|---|---:|---:|---:|---|
| Backend платформы и API | 25% | 0% | 0% | Beta 2.0 domain/API |
| Frontend и CRM-экраны | 20% | 10% | 0% | Leads/Kanban/Deal detail placeholders only |
| CRM domain | 15% | 0% | 0% | entities, pipeline, permissions, CRUD |
| Cindy / AI assistant | 15% | 0% | 0% | model selection, files, correspondence, archive, accounting/finance |
| Tasks + Calendar | 15% | 0% | 0% | creator/executor/observer, attachments/comments/CRM number/notifications |
| Group collaboration extras | 5% | 0% | 0% | events/RSVP, polls, favorites, search, permissioned bots, pinned messages |
| QA, security, operations | 5% | 0% | 0% | acceptance/E2E/security/operations |
| **ИТОГО Beta 2.0** | **100%** | **2%** | **0%** | 2% учитывает только CRM placeholders |

**Baseline Beta 2.0:** 2% implementation / 0% verification. Групповые extras остаются candidate backlog до отдельного уточнения состава; Cindy, Tasks/Calendar и CRM остаются вне Beta 1.0.

## 3. Историческая непрерывность

| Дата | InOne overall | Beta 1.0 | Beta 2.0 | Статус |
|---|---:|---:|---:|---|
| 2026-11-09 pre-WBS | 25% | 35% | 0–5% | qualitative, historical |
| 2026-11-09 WBS v1 | — | 42% / 31% | 2% / 0% | proposed |
| 2026-11-09 WBS v1.1 | 25% historical | 42% / 31% | 2% / 0% | **owner approved** |

Первая величина пары — implementation, вторая — verification. InOne overall 25% сохраняется как исторический качественный показатель; не пересчитывать без отдельной согласованной общей WBS.

## 4. Definition of Done

Функция получает 100% только если: scope/screen/API contract approved; код committed/pushed; unit+integration pass на exact SHA; loading/empty/error/offline states проверены; security/privacy pass; Android/iOS checks complete where applicable; E2E выполнен в контролируемой среде; документы и отчёт обновлены; владелец принял release gate.

## 5. Текущие UI work items — связаны с Beta 1.0

1. **UI-01 Source provenance/import:** сохранить оригинальный Ui.zip и все исходники/manifest/fonts/screenshots в GitHub, проверить SHA-256.
2. **UI-02 Asset packaging:** добавить оригинальные HTML/CSS/JS/fonts в Flutter asset bundle с корректными путями и локальной загрузкой.
3. **UI-03 Stable screen routing:** использовать stable IDs из screen manifest; не заменять/переименовывать визуальные исходники.
4. **UI-04 Bridge integration:** события navigate/api/pick идут через узкий типизированный Flutter bridge; никакого прямого network из HTML, токены не передаются в JS.
5. **UI-05 API contract reconciliation:** каждый screen API сверить с server source/OpenAPI; отсутствующий endpoint = BLOCKED, не изобретать.
6. **UI-06 Platform and visual verification:** iOS/Android WebView local asset loading, safe area, keyboard/back/offline; golden/screenshots and interaction tests.

Beta 2.0 placeholders сохранять в каталоге, но не подключать к Beta 1.0 функциональному потоку.

## 6. Следующие чаты и агенты

Новый агент начинает с этого файла, затем читает root `AGENTS.md`, полный `development/AI-AGENT-MANDATE.md`, последний report, SESSION-LOG и continuity docs. В отчёте указывает точный WBS item, текущий SHA, доказательства, пять предыдущих и пять следующих задач, а также implementation/verification. Если точный source/contract отсутствует — BLOCKED и вопрос владельцу.
