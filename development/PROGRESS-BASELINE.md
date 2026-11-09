# InOne — утверждённая накопительная модель готовности Beta 1.0 и Beta 2.0

**Версия:** 1.1 — WBS утверждена владельцем  
**Дата утверждения:** 2026-11-09  
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
| Backend/API и данные | 25% | 65% | 55% | independent InOne backend/DB, auth/recovery, profile, rooms, organizations, API contracts, migrations |
| Frontend Flutter и утверждённый UI | 25% | 35% | 15% | auth/menu/chat/org/profile/settings screens, exact assets, states, navigation, localization |
| API ↔ UI интеграция | 15% | 35% | 20% | typed transport/session/repositories, real screens, verified routes, writes/errors |
| MLS, mobile security и storage | 20% | 35% | 25% | Rust/OpenMLS, Android/iOS FFI, Keychain/Keystore, encrypted durable local store, ACK/outbox, device recovery |
| QA, CI и E2E | 10% | 50% | 45% | unit/integration, Flutter tests, golden, two-device E2E, regression/security |
| DevOps и release readiness | 5% | 20% | 10% | staging, SMTP/SMS, deploy/proxy, backups, monitoring, release/rollback |
| **ИТОГО Beta 1.0** | **100%** | **42%** | **31%** | исходный утверждённый baseline |

**Baseline Beta 1.0:** 42% implementation / 31% verification. Каждая строка — отдельный поток работ; UI integration теперь начинается с Frontend и API↔UI criteria. Не повышать общий процент только за импорт исходников: импорт закрывает provenance/asset readiness, но не визуальную и функциональную приёмку.

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
