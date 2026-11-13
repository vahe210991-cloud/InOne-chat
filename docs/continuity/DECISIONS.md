# InOne — подтверждённые решения владельца

**Срез:** 2026-11-08 (UTC+3). Новые решения добавлять с датой и ссылкой на обсуждение/PR.

## 1. Продукт и Beta 1.0

- Beta 1.0: Chats, Organizations, Profile, auth/recovery и серверные API для них.
- Tasks, Calendar и Cindy (AI assistant) не входят в Beta 1.0. Это будущие этапы; не включать их в Beta 1.0 navigation/release criteria.
- Пользователь выбирает язык внутри приложения, независимо от языка ОС.
- Первая локализация: Armenian, Russian, English. French, German, Spanish — позже.
- Темы чатов: готовые пресеты и возможность создавать собственные темы. Полный пользовательский редактор можно отложить до beta, но архитектура должна предусматривать расширение.
- В дальнейшем планируются Cindy с выбором AI-модели, обработкой файлов, деловой перепиской, архивом, учётами и финансовыми срезами; задачи/календарь с ролями постановщик/исполнитель/наблюдатель, файлами, комментариями и CRM-номерами. Эти возможности не являются текущей Beta 1.0 scope.

## 2. Идентичность InOne ↔ Propo

Владелец утвердил:
1. InOne не должен зависеть от доступности backend Propo.
2. Общий identity/identifier reservation между платформами.
3. Раздельные доменные данные и application backends InOne и Propo.
4. Расширяемая архитектура.

Ожидаемая модель:
- Независимый Identity Service + authoritative database.
- Регистрация на любой платформе создаёт canonical identity.
- На платформе регистрации account ACTIVE.
- На второй платформе тот же идентификатор резервируется как RESERVED/inactive; другой пользователь не может занять его.
- Outbox/inbox, idempotency, retry и reconciliation обеспечивают eventual provisioning.
- Если backend Propo недоступен, но Identity Service и его БД доступны, InOne может завершить регистрацию и отметить provisioning Propo как pending_sync.
- Если Identity Service/БД недоступны, регистрация должна завершиться retryable 503 (fail closed); нельзя сообщать, что reservation выполнен.
- Не связывать транзакцию регистрации с синхронной доступностью backend другой платформы.

## 3. Визуальная идентичность и дизайн-система

### Иконка приложения — утверждённая спецификация
- Зелёный фон без белой внешней рамки.
- Точное написание wordmark: `InOne` (без пробела и изменения регистра).
- Чёрные жирные соединённые буквы.
- Белая обводка непосредственно вокруг чёрных букв, не вокруг зелёного фона.
- Многослойная стеклянная эстетика; каждый слой должен выглядеть стеклянным.
- Предложить несколько вариантов app icon, сохраняя эту основную концепцию.

### Сохранение UI design system
- Использовать исходный артефакт `InOne-mobile-design-system-curated.html` из общей Library как эталон, а не восстанавливать дизайн по памяти.
- Не менять tokens, цвета, типографику, размеры, компоненты и экраны без проверки исходного артефакта и согласования.
- Сохранить оригинальный файл как immutable reference. Если в GitHub переносится копия, зафиксировать её SHA-256 и происхождение.
- В найденном HTML есть, среди прочего, цветовые значения `#C9F53F`, `#77B72C`, текст `#171A14`, muted `#A6ADA1`; это не исчерпывающая спецификация. Не делать их единственными tokens без полного извлечения файла.

## 4. Безопасность и MLS

- Никакого plaintext fallback для сообщений.
- MLS должен работать через persistent `mobile-mls/mls-client`, не через in-memory demo bridge.
- Access/refresh tokens — memory-only. После открытия MLS Rust — единый владелец refresh rotation; Flutter делегирует refresh и принимает новую пару токенов.
- SQLCipher DB key — в Android Keystore / iOS Keychain; не передавать его в Dart.
- Incoming event ACK разрешён только после durable local message transaction; deduplicate по eventId.
- При отсутствии native plugin, ошибке storage/key mismatch/recovery — send/decrypt должны оставаться отключёнными.
- `INONE_MLS_NATIVE_ENABLED` должен оставаться false до реализации Android/iOS handlers, Rust library packaging, secure key store и device tests.

## 5. Правила изменения решений

- Новое решение владельца имеет приоритет, но должно быть внесено сюда с датой.
- Не считать техническое предложение утверждённым решением, пока владелец явно его не подтвердил.
- Если документ/ветка расходится с этим списком, зафиксировать расхождение и запросить решение; не угадывать.


## 6. Beta 1.0 database boundary — 2026-11-08

- Owner decision: Beta 1.0 launches with an independent InOne database and backend.
- A unified/shared operational database for InOne + Propo is deferred to the next beta release and must not block Beta 1.0.
- Beta 1.0 should retain stable globally unique identifiers, explicit API/event boundaries, and migration-friendly schema design. It must not introduce runtime dependence on Propo.
- See [ADR-011 — Independent InOne database for Beta 1.0](ADR-011-BETA1-INDEPENDENT-DATABASE.md).

## 7. Product split: InOne and InOne Business — 2026-11-13

**Owner decision (approved 2026-11-13, UTC+3):** The product will be delivered as two separate applications with distinct product purposes.

### InOne — personal and social application
- Personal-use product.
- News feed.
- User publications/posts.
- One-to-one chats.
- Groups and group chats.
- Threads.
- Other personal/social communication and community features.

### InOne Business — professional/work application
- Professional work environment.
- Kanban.
- CRM.
- Leads.
- Deals.
- Wallet.
- Flags.
- Other business and operational tools.
- Integration/interoperation with **Propo Seller Account**.

### Product boundary and implementation rules
- Treat InOne and InOne Business as two separate applications/products, not as one application with a single combined navigation.
- Product scope, screen inventory, navigation, release criteria, and UX flows must be classified against the correct application.
- Social/personal capabilities belong to InOne; professional workflow and business-management capabilities belong to InOne Business unless the owner explicitly changes the boundary.
- Propo Seller Account integration is an explicit part of the InOne Business direction.
- This decision establishes the product split. It does **not**, by itself, decide whether the applications share identity, backend services, databases, repositories, infrastructure, or common UI components. Preserve existing approved identity/database/security decisions until a separate technical decision is recorded.
- Existing InOne Beta 1.0 work and approved UI must not be silently rebranded or moved between products. Audit current screens and APIs against this split and propose a migration/classification plan before changing implementation.
- Do not expand InOne Business scope by assuming that every Propo Seller Account capability is already specified; define and version the integration contract separately.


## 8. InOne Business as Propo seller back office — 2026-11-13

**Owner-approved product direction:**
- Propo is the marketplace and classifieds project in Armenia.
- InOne Business is the logical professional continuation of Propo and the backstage/back office for seller organizations operating on Propo.
- Seller organizations use InOne Business to coordinate employees and work around marketplace operations: internal discussions/threads about products and campaigns, buyer messages, purchase/order notifications, rating notifications, sales analytics, calculations and business tools.
- Business direction includes organization employees and roles/permissions, Kanban, CRM, Leads, Deals, Wallet, Flags, organization-related publications/news feed/stories/statuses, and integration with Propo Seller Account.
- Owner rights include the ability to edit the organization profile. The complete permission matrix remains to be approved.
- InOne remains the separate personal/social application: personal chats, groups, communities, channels, news feed, personal publications/profile, avatar, cover, About me, stories and statuses.

**Architecture implications / not yet decided:**
- Propo remains the marketplace project; exact system-of-record ownership and API/event contracts must be confirmed with Propo.
- The product direction does not decide whether a Propo Seller Account equals one organization, how many employees it supports, or whether one organization can connect multiple stores.
- It does not decide common identity/login, database topology, deployment topology, or whether shared platform services are physically shared.
- Do not use direct Propo database access. Define a versioned integration contract before implementation.
- The architecture draft is in the root architecture directory; unresolved owner questions are in OPEN-OWNER-DECISIONS.md.


## 8. Propo Seller Account ↔ InOne Business organization cardinality — 2026-11-13

**Owner decision: Option A.** One Propo Seller Account corresponds to exactly one InOne Business organization, and one InOne Business organization connects to exactly one Propo Seller Account in the initial release. Option B (one organization managing multiple stores/Seller Accounts) is not required now and is excluded from v1 scope. Keep the integration boundary explicit so this can be extended later by a separately approved decision and migration. This does not decide how many employees a Seller Account supports, whether Propo has separate employee identities, or how login/account linking works.


## 9. InOne Business organization membership and delegated access — 2026-11-13

**Owner decisions:**

- Each organization may have many employees.
- A person may belong to several organizations at once.
- Roles and permissions are scoped to each organization membership; the same person may have different rights in each organization.
- A member with explicit delegation may manage access only for members below their own position/authority level, and may not grant authority beyond their own delegation ceiling.
- The existing engine's organization roles (`owner`, `admin`, `member`) are the compatibility baseline. The existing API currently permits only the owner to change roles; delegated lower-level management is a requirement to design, not a capability already present.

See the architecture branch's domain/access model for the audited existing API/schema/test references and the difference between current behavior and the new requirement.



## Owner decision — Financial Policy v1 (2026-11-13)

**Status: APPROVED — approval model. Monetary limits remain OPEN.** The owner explicitly approved the proposed financial-control model with no remarks, while requiring monetary limits to be refined separately.

Approved baseline:
- Sensitive financial actions follow `initiator → independent approver → execution`.
- Initiator and approver must be different natural-person identities; self-approval is prohibited across sessions/devices/accounts and delegated contexts.
- Initiation and approval are separate atomic permissions. An approver must independently satisfy permission, organization membership, resource scope, delegation ceiling and applicable limit checks.
- If no eligible independent approver exists, execution is blocked; there is no implicit one-person bypass.
- Approval binds to an immutable transaction snapshot. A material change invalidates prior approval and requires a new approval decision.
- Approval state transitions and execution are idempotent, concurrency-safe and auditable.
- Observer/Auditor cannot initiate or approve financial operations by default.
- Missing or ambiguous limit configuration is deny/escalate, never unlimited.

Not approved / still open:
- Numeric thresholds, currencies and per-transaction/daily/weekly/monthly caps.
- Final operation-by-operation dual-approval catalogue and approver eligibility details.
- Approval expiry/quorum defaults and exact treatment of owner-initiated transactions.

The earlier illustrative monetary amounts are examples only and are not policy. This decision approves the control model, not implementation, migrations, API changes or production enforcement. No application code or database schema was changed.


## Owner decision — organization-configurable employee financial limits (2026-11-13)

**Status: APPROVED.** Monetary limits are not fixed globally by InOne and are not imposed as universal numeric defaults. Each InOne Business organization configures its own limits through the product interface. When the organization owner assigns or edits an employee's position/authority, the owner configures that employee's applicable financial limits as part of the assignment.

Requirements:
- Limits and policy settings are tenant-isolated; one organization's configuration never affects another organization.
- Limits are configured per employee membership/position assignment, not merely by a global position title. Employees with the same title may have different limits; the same person may have different limits in different organizations.
- The interface must allow the owner to configure limits by operation type (for example payout, refund, discount, procurement, inventory write-off), with per-transaction and optional cumulative period caps where applicable.
- Currency must be explicit for every monetary limit; no implicit currency conversion.
- Limit changes are versioned and audited (actor, employee, organization, operation, previous/new value, currency, effective time and reason where supplied).
- Missing or ambiguous limits do not mean unlimited authority; the operation is denied or escalated until configured.
- These configurable limits remain subordinate to the approved independent two-person approval model. An initiator cannot approve their own sensitive transaction.
- No universal numeric thresholds or default monetary values are to be hard-coded by InOne. The organization owner controls the organization's configuration through the UI, subject to permission and delegation rules.

This decision approves the product behavior and configuration model. UI screens, API, persistence schema and enforcement are not yet implemented by recording this decision.
