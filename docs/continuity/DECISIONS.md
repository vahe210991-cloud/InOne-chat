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


## 8. Free-first growth, monetization and Creator Economy — 2026-11-25

**Owner decision (approved 2026-11-25):** InOne's commercial strategy is based on acquiring and retaining a large active Free audience first, then monetizing optional expansion, creator/business growth tools and commercial transactions. Free is the primary growth tier, not a crippled trial.

### Strategic principles

- Adopt **Free-first + Creator Economy + Business Growth**.
- Keep baseline personal communications, private chats, encryption and core security free.
- Do not use private-message, call or encrypted content for advertising, targeting or commercial profiling.
- Free users must be able to publish, build communities and qualify for creator earning opportunities without first buying a subscription.
- Paid tiers and one-time purchases sell additional capacity, productivity, analytics, promotion and business expansion, not access to baseline privacy or communication.
- Organic distribution must remain meaningful; paid promotion must be disclosed and must not guarantee outcomes.
- Commercial analytics should rely on minimized product events and aggregate usage signals, never private communication content.

### Free personal entitlement hypothesis

- Personal chats free.
- Up to 10 created groups.
- Up to 5 pinned chats.
- Up to 5 stories per day.
- 1 owned channel.
- Publications/posts available.
- Free reading, discovery, channel subscriptions and participation in public communities.

### Free Business starter entitlement hypothesis

- Personal chats free.
- 1 organization.
- Up to 5 internal company chats.
- Up to 2 business stories per day.
- 1 company channel.
- Up to 5 workers with role-based access.
- Up to 10 active Kanban tasks.
- Up to 10 active CRM cards/records.
- Basic contacts and analytics; optional separately paid promotion.

Business capabilities remain within the previously approved **InOne Business** product boundary. This decision does not merge InOne and InOne Business applications.

### Tariffs and price anchors

| Tier | Indicative price | Role |
|---|---:|---|
| Free | $0 | Largest audience and starter usage |
| Plus | $9.99/month | Main mass paid tier |
| Smart | $14.99/month | Advanced creator/professional tier |
| Enterprise | From $60/month per organization | Organization-level tier |

The owner's initial anchors were $10 / $15 / $60. Prices shown above are provisional test anchors, not globally fixed or commercially validated. Initial Enterprise hypothesis: up to 5 included seats, then approximately $6 per additional seat/month, subject to pilot validation. Plus and Smart are personal/creator tiers; Enterprise is organization-level. Free Business is the organization starter tier.

### Optional purchases

Explore one-time or time-limited add-ons for extra stories, channels, pinned chats, group capacity, publication/channel promotion and additional business capacity. Initial hypotheses include +5 stories/day for $0.49, +20 for $1.49, +50 for $2.99, extra channel/30 days for $1.49, +10 pinned chats/30 days for $0.99, publication promotion from $1 and channel promotion from $2. All require demand, unit-economics and user-experience validation.

### Creator Economy

- Paid channel subscriptions and premium content.
- Voluntary creator support/tips.
- Qualified referral rewards based on sustained genuine activity, not raw registrations.
- Clearly labelled sponsored creator placements.
- Professional services marketplace in a later stage.
- Initial commission hypotheses: 10–15% for creator subscriptions/tips; illustrative sponsored placement split 80% creator / 20% platform. Not final promises or contracts.
- Keep non-cash **InOne Points** separate from real-money creator earnings. Real-money payouts require payment, fraud, tax and jurisdictional compliance review.

### Analytics and monetization governance

- Create a future **InOne Growth Intelligence** capability to recommend purchases when measured product usage demonstrates need.
- Compare subscription value with one-time purchase value; frequency-cap offers and measure retention/complaints as well as conversion.
- Measure acquisition, activation, D1/D7/D30 retention, DAU/MAU, content supply, channel growth, Free-to-Plus/Smart conversion, add-on purchases, creator earnings, organizations/seats, CAC, LTV, margins and cost per MAU.
- Any user-mix, conversion, price, commission or revenue-share figure is a scenario assumption until validated by cohorts and pilots.

### Staged rollout

1. Audience foundation: useful Free experience, organic content/community, referrals and retention/cost analytics.
2. First monetization: Plus, Smart, optional add-ons and controlled promotion tests.
3. Creator Economy: paid channels, tips, creator analytics and qualified referrals.
4. Business monetization: Enterprise, seats, CRM/Kanban capacity, integrations and support.
5. Commercial ecosystem: Marketplace, creator sponsorships, APIs and additional services.

### Scope guardrails

This decision is strategic and does not authorize changes to Beta 1.0 code, APIs, database, migrations, approved UI, WBS or release scope. Billing, advertising, promotion, points, wallets, payouts and Marketplace require separate product/technical/legal specifications and explicit implementation approval. Existing identity, MLS, encryption, security and privacy decisions remain unchanged.

Canonical details:
- [ADR-005 — Free-first growth, monetization and Creator Economy](../../development/architecture/ADR-005-FREE-FIRST-MONETIZATION-AND-CREATOR-ECONOMY.md)
- [InOne Monetization & Growth Strategy v2.0](../../development/roadmaps/2026-11-25-inone-monetization-growth-strategy-v2.md)


## 9. Feed / publications are part of Beta 1.0 — 2026-11-26

**Owner decision (approved 2026-11-26):** InOne publications and the news feed are included in Beta 1.0. This decision supersedes any older statement that Feed is unavailable, conditional, or Beta 2.0-only. The scope amendment is recorded in WBS v1.2 at `development/PROGRESS-BASELINE.md`.

### Minimum Beta 1.0 Feed scope

- Create, read, edit and delete the authenticated user's own publications; the server owns author identity and timestamps.
- Own-publications list and a general/news feed containing only posts the requesting account is authorized to read.
- Stable cursor pagination, deterministic ordering, refresh, duplicate prevention and deleted-record exclusion.
- Native Flutter/Dart Feed UI, typed API/repository integration and loading/empty/error/offline states.
- Server-side object authorization, idempotency, abuse controls, safe logging and backend/mobile regression tests.
- Attachments, where included in the approved Feed screen contract, use validated media objects bound to the post and re-authorized at download; no public/unprotected object URLs.

### Privacy remains unchanged — variant В

- Preserve the existing InOne privacy model. This Feed decision does not make profiles or posts public by default.
- Do not add new public/private settings, block/follow semantics, subscriptions, social graph, or broad access rules under this decision.
- The existing `sharesOrgOrLink` gate is evidenced for user search only; it must not be silently reused as post visibility authorization.
- The audited code contains no implemented post visibility policy. The owner has now approved a narrow rule: every published item intentionally included in the general/news feed is readable by every registered and authenticated InOne account; anonymous access is denied. This rule applies to feed publications and their attachments only, not profiles, drafts, private files or other account data. The backend must enforce it on list/detail/download paths; IDs and URLs are not authorization credentials. The user-search `sharesOrgOrLink` gate is not reused. The owner decision resolves policy, but implementation and security tests remain mandatory.

### Owner-approved cross-account publication visibility — 2026-11-26

**Owner decision (approved 2026-11-26):** Every published item intentionally included in the general/news feed is readable by every registered and authenticated InOne account. Anonymous/unauthenticated requests must be denied. This is a feed-publication rule only; it does not make account profiles, private account data, drafts, private files or other product domains public.

- The backend must enforce the authenticated-session requirement and the published/general-feed eligibility rule on every list, detail and media-download request. A post ID, media ID, guessed URL or cached URL is never an authorization credential.
- Attachments inherit the same read eligibility as their parent feed publication and must be checked again at download. No unauthenticated/public object URLs.
- The existing `sharesOrgOrLink` user-search gate is not the authorization rule for feed posts and must not be reused for this purpose.
- Preserve privacy variant В for profiles and all other data. Do not introduce profile visibility settings, block/follow semantics, subscriptions or a general social graph under this decision.
- The audited source still has no implemented post visibility policy. The owner decision resolves the product-policy question, not the engineering implementation or security acceptance; the backend must explicitly implement and test this rule before cross-account feed data is served.

### Not automatically included

Comments/reactions, follows/subscriptions, stories, advanced ranking/recommendations, creator tooling, promotion/analytics, public profiles and public media delivery require separate approval or remain Beta 2.0 candidates. This decision does not change commercial policy or the existing privacy baseline.

### WBS / progress handling

- WBS v1.2 adds Feed to the existing Backend/API, Flutter, API↔UI and QA/CI/E2E workstreams.
- Existing domain weights remain unchanged. Historical WBS v1.1 baseline values (42% implementation / 31% verification) are preserved as historical starting values, not reported as current progress for the expanded scope.
- No implementation percentage changes without evidence-based re-baselining and owner approval.
