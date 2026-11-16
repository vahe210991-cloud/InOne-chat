# InOne Bots & Stickers — проектное архитектурное предложение

**Дата:** 2026-11-16 (UTC+3)  
**Режим:** repository-native documentation edit  
**Base:** `main` @ `1df19a001acb5f8c4892471ca4eaa0696e02c54d`  
**Task branch:** `docs/bots-stickers-platform-2026-11-16`  
**Architecture document:** [INONE-BOTS-AND-STICKERS.md](../architecture/INONE-BOTS-AND-STICKERS.md)  
**Status:** documentation proposal committed; product implementation NOT STARTED.

## Result

Added a detailed architecture proposal for:
- administration-owned InOne Bot Manager as the sole user-facing bot registration/management entrypoint;
- Bot ID, owner, lifecycle states, one-time API token issuance, hashed token storage, revocation/rotation and least-privilege scopes;
- REST API, Webhooks, OpenAPI versioning, HMAC signatures, replay protection, retries, idempotency, rate limits and SSRF protection for external bot builders;
- explicit bot installation/consent in personal and group conversations;
- strict MLS/E2EE boundary: a bot must be an explicit MLS participant; no hidden server-side plaintext access or fallback;
- administration-owned Sticker Bot, photo processing and preview;
- personal sticker collections and versioned sticker packs with a backend-enforced maximum of 50 stickers per pack;
- conceptual data entities, moderation/admin controls, implementation phases and acceptance criteria.

## Product/release boundary

This is a proposal, not a declaration that these features exist. The approved Beta 1.0 WBS v1.1 and its percentages remain unchanged. Permissioned bots are already listed as a Beta 2.0 group-collaboration candidate; the broader Bot Platform and Sticker Bot require separate owner scope/release approval. No implementation, migration, endpoint or release commitment is created by this document.

## Verification

- GitHub branch creation: PASS.
- Architecture document creation: PASS.
- Remote read-back of the new document: pending final hand-back verification.
- Product tests/builds: NOT RUN (documentation-only change; no product code changed).
- API contracts, DB schema, storage limits, image provider, image retention and final rate limits: NOT DEFINED; require follow-up design approval.

## Rolling work checklist

### Five preceding active Beta 1.0 work items (context, not changed by this documentation task)

1. Persistent Rust/OpenMLS runtime and Flutter bridge — tracked in PR #58.
2. Encrypted attachment send/receive pipeline — tracked in PR #59, stacked on #58/#57.
3. Android Keystore and protected iOS Keychain acceptance — pending platform verification.
4. Recovery confirmation deep links for confirmed-phone accounts — pending.
5. Real-device/two-device MLS and encrypted attachment E2E — pending.

### Five next tasks

1. Owner reviews Bot Platform and Sticker Bot scope, especially Beta 2.0+ placement.
2. Approve bot creation eligibility, quotas, username policy and which scopes require moderation.
3. Approve MLS bot-participant protocol and consent UX before any chat event delivery is implemented.
4. Define versioned OpenAPI/Webhook contracts, event payloads, rate limits, token rotation and audit policy.
5. Define image processing provider/privacy, upload/output limits, retention, moderation and sticker-pack deletion/version policy.

## Exact repository result

- Branch: `docs/bots-stickers-platform-2026-11-16`
- Base SHA: `1df19a001acb5f8c4892471ca4eaa0696e02c54d`
- Architecture file: `development/architecture/INONE-BOTS-AND-STICKERS.md`
- Initial document commit: `35fb0e8b782a43cd84ca556455a9645a194f522c`
- No merge, deployment, database change or product-code change.


## Решение владельца от 2026-11-16: защищённые названия InOne и Propo

Владелец распорядился зарезервировать официальные названия **InOne Hub**, **InOne Developer** и **InOne Development**. Также установлено глобальное правило: обозначения `InOne` и `Propo` запрещены в публичных именах пользователей, групп/комнат/сообществ, ботов, приложений, интеграций, организаций и других пользовательских сущностей.

Использовать защищённые обозначения могут только официальные сущности администрации и только после прохождения всей применимой цепочки административного согласования с обязательным финальным одобрением владельца. Административные права любого уровня не дают права единолично создавать, резервировать, присваивать или разрешать такое имя. Администратор может только инициировать предложение. Согласование фиксируется для конкретного имени и конкретной сущности в аудите.

Правило должно обеспечиваться централизованно на backend с Unicode-нормализацией, защитой от обхода через регистр/разделители/визуально сходные символы, атомарным резервированием и проверками при регистрации и переименовании. Существующие совпадения сначала инвентаризируются; автоматическое переименование без отдельного решения владельца запрещено.

Резервирование названий не означает, что боты или сервисы с такими именами уже реализованы. Их создание и публичный запуск остаются отдельным решением.
