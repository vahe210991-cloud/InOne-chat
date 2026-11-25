# InOne Monetization & Growth Strategy v2.0

- **Date:** 2026-11-25
- **Status:** Owner-approved strategic direction; implementation and commercial parameters pending separate validation/approval
- **Related ADR:** [ADR-005 — Free-first growth, monetization and Creator Economy](../architecture/ADR-005-FREE-FIRST-MONETIZATION-AND-CREATOR-ECONOMY.md)
- **Canonical owner decision:** [DECISIONS.md, section 8](../../docs/continuity/DECISIONS.md#8-free-first-growth-monetization-and-creator-economy--2026-11-25)

## 1. Executive strategy

InOne should acquire a large active audience before optimizing for subscription revenue. The platform's primary growth product is a useful Free experience. Monetization follows demonstrated user need and expands through optional capacity, creator tools, promotion, business workspaces and marketplace transactions.

**Model:** Free-first + Creator Economy + Business Growth.

**Growth loop:** useful free product → communication and content → audience/community formation → user invitations and creator activity → optional paid expansion → creators and businesses earn → more useful content/services and platform revenue.

The strategy is designed for a new platform. It deliberately accepts that Free will be the largest tier and that some users will never subscribe. Those users still create value through communities, content, discovery, referrals and marketplace demand.

## 2. Product boundaries

Preserve the approved split:
- **InOne:** personal/social application (personal communication, groups, publications, stories, channels, discovery and communities).
- **InOne Business:** professional/work application (organizations, roles, internal company chats, Kanban, CRM and other business workflows).

A user may have a personal Free/Plus/Smart entitlement and separately use an organization workspace. Do not collapse the two applications into one navigation or infer that a personal subscription automatically pays for an organization.

## 3. Tariff model

### Personal / creator tiers

| Tier | Price anchor | Purpose |
|---|---:|---|
| Free | $0 | Mass adoption, communication, content and community |
| Plus | $9.99/month | Main paid tier for active personal users and creators |
| Smart | $14.99/month | Advanced creator/professional growth and analytics |

### Organization tier

| Tier | Price anchor | Purpose |
|---|---:|---|
| Free Business | $0 | Usable starter organization |
| Enterprise | From $60/month per organization | Expanded team and business operations |

The four named commercial labels remain Free, Plus, Smart and Enterprise. Free Business is the organization-level Free entitlement. Enterprise is organization-based. Initial Enterprise hypothesis: up to 5 included seats, then approximately $6 per additional seat/month. Validate this against support, infrastructure and sales costs.

Prices are USD international anchors, not globally fixed final prices. Local prices require country-level validation, purchasing-power review, taxes, payment/app-store fees and competitor checks.

## 4. Entitlement hypotheses

### Free personal

- Unlimited personal chats, subject to abuse/security controls.
- Up to 10 created groups.
- Up to 5 pinned chats.
- Up to 5 stories per day.
- 1 owned channel.
- Publications/posts.
- Free reading, discovery, subscriptions and participation in public communities.
- Basic search/recommendations and core communication.

### Free Business starter

- Personal chats.
- 1 organization.
- Up to 5 internal company chats.
- Up to 2 business stories per day.
- 1 company channel.
- Up to 5 workers with role-based access.
- Up to 10 active Kanban tasks.
- Up to 10 active CRM cards/records.
- Basic contacts and basic analytics.
- Optional separately purchased promotion.

### Plus

Starting entitlement hypotheses:
- Up to 50 personal groups.
- Up to 20 pinned chats.
- Up to 20 stories/day.
- Up to 5 owned channels.
- Expanded personal organization and publication tools.
- Basic expanded channel/publication analytics.
- Access to optional promotion and creator earning features.
- Additional personal capacity and convenience.

### Smart

Starting entitlement hypotheses:
- Up to 100 personal groups.
- Up to 50 pinned chats.
- Up to 50 stories/day.
- Up to 20 owned channels.
- Everything in Plus.
- Advanced audience and channel analytics.
- Creator growth and monetization tools.
- More advanced automation and professional workflows where supported.
- Expanded CRM/Kanban capacity for eligible business use; organization entitlements must remain distinct.

### Enterprise

Starting organization package hypothesis:
- From $60/month per organization.
- Up to 5 included seats.
- Organization-level roles, access and management.
- Expanded CRM/Kanban and team capacity.
- Organization analytics and administrative controls.
- Priority support and selected integrations.
- Additional seats/resources priced separately.

All numerical entitlements are provisional. Before implementation, define exact semantics (owned vs joined groups, active vs total tasks/cards, story reset timezone, channel ownership, over-limit behavior, grandfathering and downgrade behavior). Avoid deleting user content or breaking access when a subscription expires; define safe read/export/renewal states.

## 5. Optional purchases / InOne Store

The store should support occasional needs without forcing a recurring subscription.

| Product hypothesis | Initial test price |
|---|---:|
| +5 stories, one day | $0.49 |
| +20 stories, one day | $1.49 |
| +50 stories, one day | $2.99 |
| Extra channel, 30 days | $1.49 |
| +10 pinned chats, 30 days | $0.99 |
| Temporary group-limit expansion, 30 days | $1.49 |
| Publication promotion | From $1 |
| Channel promotion | From $2 |

These are test prices only. Product pages must show exact duration, entitlement, renewal behavior, refund rules and expiry. Compare one-time purchase versus subscription for users with recurring demand. Do not create a large store catalogue before measuring demand.

## 6. InOne Growth Intelligence

Purpose: recommend a relevant feature or paid option at the moment of need, not bombard every user with upgrade prompts.

### Event and analytics inputs

- Feature use counts and frequency.
- Repeated limit attainment.
- Owned channel/publication counts.
- Aggregated reach, view and interaction metrics where available and appropriate.
- CRM/Kanban capacity utilization.
- Purchase, repeat purchase, refund and offer-dismissal events.
- Retention, churn and cohort changes.

### Offer logic examples

| Observed need | Candidate offer |
|---|---|
| Rarely exceeds story limit | No offer or low-friction one-time pack |
| Repeatedly exceeds story limit | Compare story pack with Plus |
| Channel is growing and needs deeper insights | Smart |
| Creator wants more distribution | Promotion with clear paid-placement disclosure |
| Organization approaches worker/task/CRM limits | Enterprise or targeted capacity add-on |

### Experiment rules

- Use control groups and measure incremental conversion.
- Track retention and user complaints, not just immediate revenue.
- Frequency-cap prompts and respect dismissal.
- Avoid dark patterns, artificial urgency and hidden renewals.
- Never use private-message, call or encrypted content for targeting or commercial profiling.
- Use aggregated/product-event data with data minimization and retention limits.

## 7. Creator Economy

### A. Paid channel subscriptions

Creators may offer free and paid channel tiers, educational material, specialist communities and premium posts. Free accounts can participate if they satisfy platform eligibility and compliance rules.

Illustrative example: 1,000 channel followers × 5% paid conversion × $3/month = $150 gross monthly sales. At a 15% platform commission, platform gross commission is $22.50 before payment fees, taxes, refunds and operating costs. This is an arithmetic illustration, not a conversion forecast.

### B. Voluntary support / tips

Users can support creators with fixed or custom amounts. The platform charges a disclosed transaction commission.

### C. Qualified referral rewards

Do not pay for raw registrations. Reward only qualified sustained activity after fraud screening. Possible rewards include bonus points, temporary feature credits or a cash referral fee where approved and economically justified.

### D. Sponsored creator placements

A marketplace can match brands/businesses with opted-in creators. Sponsored material must be labelled. An 80% creator / 20% platform split is an initial experiment only, not a final contractual promise.

### E. Professional services marketplace

Allow eligible professionals and businesses to list and sell services. Candidate categories include education, design, consulting, construction, repair, photography, translation and software services. Launch only after payments, dispute handling, refunds, provider verification, prohibited-service rules and local legal requirements are designed.

## 8. InOne Points versus money

Keep separate ledgers and user-facing concepts:
- **InOne Points:** non-cash promotional/reward credits usable for defined platform features. They are not money, not a deposit, not a transferable asset and not cryptocurrency.
- **Creator earnings:** real-money receivables from paid subscriptions, tips, sponsorship or marketplace transactions. Subject to payout provider, KYC/AML where required, tax, sanctions and jurisdictional controls.

Never silently convert one into the other. Define points issuance budget, expiry, redemption, abuse prevention and accounting treatment before launch.

## 9. Promotion and distribution

Promotion products:
- Publication boost.
- Channel growth campaign.
- Profile visibility.
- Local business promotion.
- Sponsored creator placement.

Paid distribution must be labelled and must not guarantee views, followers, leads or sales. Keep organic distribution useful for Free users. Do not suppress organic reach to force payment. No ads in private chats/calls and no targeting based on private/encrypted content.

## 10. Revenue portfolio and priorities

| Revenue stream | Priority | Reason |
|---|---|---|
| Plus | High | Main mass-market paid tier |
| Smart | High | Advanced creator/professional value |
| One-time purchases | High | Captures intermittent demand |
| Publication/channel promotion | High | Directly tied to creator/business growth |
| Enterprise | High | Recurring organization revenue |
| Paid channel commissions | Medium | Requires creator supply and payment rails |
| Tips/support commissions | Medium | Requires payout readiness |
| Qualified referrals | Medium | Growth spend, not direct revenue |
| Sponsored creator marketplace | Later | Requires scale, trust and moderation |
| Professional services marketplace | Later | Requires dispute/payment/legal operations |
| API, integrations, telecom and other services | Later | Requires stable platform and demand |

Do not make broad display advertising the launch business model.

## 11. Growth and go-to-market

1. Launch with clear Free value and low friction.
2. Seed communities, channels and useful public content before expecting users to create content in an empty network.
3. Use invitation/referral loops, but reward quality and sustained activity rather than registration count.
4. Recruit initial creators and professional communities with transparent pilot terms.
5. Start with small businesses that can benefit from the free starter organization.
6. Introduce Plus and Smart after usage evidence identifies repeated needs.
7. Pilot Enterprise with a limited number of organizations and validate seat/resource economics.
8. Expand regions using localized pricing, payment methods, language, compliance and support.

## 12. Financial model requirements

Build separate revenue and cost lines for:
- Plus subscriptions.
- Smart subscriptions.
- Enterprise base organizations.
- Additional seats/resources.
- One-time add-ons.
- Publication/channel promotion.
- Paid channel commissions.
- Tips/support commissions.
- Sponsored creator commissions.
- Marketplace commissions.
- Later API/integration/telecom revenue.

Model monthly cohorts for 12/24/36 months and strategic 5-year scenarios. Separate registered users, MAU, DAU, active creators, paying users, organizations and paid seats.

Required scenario inputs:
- Acquisition by channel and CAC.
- Activation and retention cohorts.
- Free-to-Plus/Smart conversion.
- Enterprise organization conversion, seats and churn.
- Purchase frequency and average order value.
- Creator count, paid conversion, GMV and take rate.
- Promotion spend and realized delivery cost.
- Payment/app-store fees, refunds, fraud and chargebacks.
- Infrastructure cost per active user and per media/storage workload.
- Support, moderation, legal/compliance and sales costs.
- Regional price and tax differences.

Never present a user-mix or revenue forecast as validated without real cohort and pilot data. The earlier 85/10/4/1 tier mix is a scenario assumption only. Enterprise is modeled by organizations and seats, not as a personal subscriber percentage.

## 13. KPI dashboard

- Acquisition: registrations, source, CAC, qualified referral rate.
- Activation: first message, first group, first publication, first channel, first organization.
- Engagement: DAU/MAU, sessions, content creation, community participation.
- Retention: D1/D7/D30, cohort retention, churn.
- Creator: active creators, audience growth, creator earnings, payout success.
- Monetization: Free-to-Plus/Smart, one-time purchase conversion, ARPPU, revenue per MAU, repeat purchase.
- Promotion: spend, reach delivery, cost, labelled sponsored impressions, complaints.
- Business: active organizations, paid seats, expansion, organization churn.
- Economics: CAC, LTV, gross margin, contribution margin, payback, infrastructure cost per MAU.
- Trust: spam, fraud, fake engagement, abuse reports, moderation actions and user complaints.

## 14. Staged roadmap and gates

### Stage 0 — strategy and evidence (now)
- Record ADR-005 and this roadmap.
- Inventory existing product capabilities and map to InOne versus InOne Business.
- Define entitlement semantics and price experiments.
- Validate payment/app-store constraints, privacy and jurisdictional obligations.
- Produce a revised formula-driven financial model with low/base/high scenarios.

**Exit gate:** owner-approved product specs, legal/privacy review plan, baseline economics and experiment design. No product code change.

### Stage 1 — audience foundation
- Useful Free personal and starter business experience.
- Organic publication/channel/community discovery.
- Referral instrumentation and anti-abuse controls.
- Retention, content and infrastructure-cost analytics.

**Exit gate:** activation, D7/D30 retention, organic content supply, spam controls and cost per MAU meet owner-set thresholds.

### Stage 2 — first monetization
- Launch Plus and Smart only after entitlement and billing specifications.
- Add one-time purchases and limited promotion experiments.
- Add subscription lifecycle, receipts, refunds, cancellation and entitlement reconciliation.

**Exit gate:** positive incremental contribution, acceptable refund/complaint rates, no material retention harm, support and billing operations ready.

### Stage 3 — Creator Economy
- Paid channel subscriptions and tips.
- Creator dashboard and transparent earnings statements.
- Qualified referral rewards.
- Payout and compliance controls.

**Exit gate:** payment and payout reliability, fraud controls, creator support, legal/tax review and sustainable take rate.

### Stage 4 — Enterprise
- Organization package, included seats and add-on pricing.
- CRM/Kanban capacity, role management and analytics.
- Support, integrations and SLA.

**Exit gate:** pilot evidence for willingness to pay, gross margin, support load and organization retention.

### Stage 5 — marketplace and wider ecosystem
- Creator sponsorship marketplace.
- Professional services marketplace.
- APIs, integrations and additional digital/communication services.

**Exit gate:** dispute resolution, seller/provider verification, payment compliance, moderation and unit economics.

## 15. Governance and scope guardrails

- This is a strategic approval, not implementation permission.
- Do not alter Beta 1.0 code, APIs, database, migrations, UI, WBS or release scope through this document.
- Do not merge implementation or deploy billing, advertising, promotion, points, wallets, payouts or marketplace without separate explicit approval.
- Preserve existing identity, MLS, encryption and security decisions.
- Keep private communication content outside monetization analytics.
- Any price, quota, commission, referral reward and forecast is provisional until measured.
- Update this roadmap only with dated owner decisions and evidence from pilots/experiments.
