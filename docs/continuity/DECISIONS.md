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
