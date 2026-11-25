# ADR-005: Free-first growth, monetization and Creator Economy

- **Date:** 2026-11-25
- **Status:** Accepted strategic direction; commercial parameters are hypotheses pending validation
- **Decision owner:** Product owner
- **Scope:** Product strategy, tariff principles, monetization architecture, creator incentives and staged commercial roadmap
- **Related decision:** [Owner decisions, section 8](../../docs/continuity/DECISIONS.md#8-free-first-growth-monetization-and-creator-economy--2026-11-25)
- **Detailed execution plan:** [InOne Monetization & Growth Strategy v2.0](../roadmaps/2026-11-25-inone-monetization-growth-strategy-v2.md)

## Context

InOne is a new platform and must first acquire users, build recurring usage, content supply, communities and network effects. An early subscription-first strategy or artificially restricted free product would raise the adoption barrier before users have a reason to pay.

The owner approved a different sequence: make personal use and useful starter business workflows available for free; monetize optional expansion, creator/business growth tools and commercial transactions only when a real need exists. Users should be able to participate in the creator economy without first buying a subscription.

This decision supplements the existing product boundary: **InOne** remains the personal/social application and **InOne Business** remains the professional/work application. It does not merge their navigation or authorize changes to Beta 1.0.

## Decision

### 1. Strategic model

Adopt **Free-first + Creator Economy + Business Growth**.

The growth sequence is:

1. Acquire users through a genuinely useful Free experience.
2. Encourage communication, communities, publications, channels and invitations.
3. Build creator and business activity with organic discovery and network effects.
4. Offer paid expansion only when usage evidence indicates a real need.
5. Enable users and organizations to earn through channels, audience support, services and approved commercial placements.
6. Earn platform revenue from subscriptions, optional purchases, promotion, transaction commissions and business services.

Free is the primary acquisition and retention tier, not a crippled trial.

### 2. Free personal account

The approved starting entitlement hypothesis is:

- Personal chats: free, without a subscription paywall.
- Create up to 10 groups.
- Pin up to 5 chats.
- Publish up to 5 stories per day.
- Own 1 channel.
- Create publications/posts.
- Read and discover public content, subscribe to channels and participate in communities without a paywall.
- Basic search, recommendations and communication capabilities.

Do not monetize access to basic private communications, encryption or baseline security. Do not use private-message, call or encrypted communication content for advertising, targeting or commercial profiling.

### 3. Free business starter workspace

The approved starter entitlement hypothesis for a business user / organization is:

- Personal chats: free.
- 1 organization.
- Up to 5 internal company chats.
- Up to 2 stories per day for the business presence.
- 1 company channel.
- Up to 5 workers with role-based access.
- Up to 10 active Kanban tasks.
- Up to 10 active CRM cards/records.
- Basic customer/contact handling and basic analytics.
- Paid promotion may be purchased separately.

This is an entry-level, usable workspace, not a non-functional demo. Business capabilities must remain classified under the existing **InOne Business** product boundary. The entitlement model must not silently combine the two applications into one navigation or runtime.

### 4. Tariff architecture and indicative price anchors

The four commercial labels are:

| Tier | Indicative international price | Primary audience / role |
|---|---:|---|
| Free | $0 | Mass audience and starter business usage |
| Plus | $9.99/month | Active personal users and creators needing more capacity |
| Smart | $14.99/month | Creators, professionals and entrepreneurs using advanced growth/analytics tools |
| Enterprise | $60/month starting organization package | Organizations needing expanded team and business capabilities |

The owner initially proposed $10 / $15 / $60. The $9.99 and $14.99 figures are presentation/price-testing anchors, not a final price approval. Enterprise $60 is a proposed starting organization price, not a per-seat price. The working hypothesis is up to 5 included seats, with additional seats priced separately (an initial $6/seat/month hypothesis). All these commercial values require validation.

Plus should be the principal mass paid tier after Free. Smart should offer a clear step-up in creator/business productivity, analytics and monetization tools. Enterprise is an organization-level offer, not simply a personal subscription. Do not require every employee to buy an individual Plus/Smart subscription to use an Enterprise organization.

Regional pricing must account for purchasing power, taxes, currency, payment-provider costs, app-store fees and local competition. Do not assume the same effective price is suitable in every market.

### 5. Optional one-time purchases

Create an optional in-app store for discrete add-ons. A user should not need to subscribe merely to solve an occasional need.

Candidate purchase types include:
- Temporary additional story capacity (e.g. +5, +20 or +50 stories for a defined period).
- Temporary additional channels, group capacity or pinned-chat capacity.
- Publication, channel or profile promotion.
- Additional CRM/Kanban capacity or business resources.
- Other clearly scoped, time-limited expansions.

Initial illustrative price hypotheses from the owner-approved strategy:
- +5 stories for one day: $0.49.
- +20 stories for one day: $1.49.
- +50 stories for one day: $2.99.
- Extra channel for 30 days: $1.49.
- +10 pinned chats for 30 days: $0.99.
- Temporary group-limit expansion for 30 days: $1.49.
- Publication promotion from $1; channel promotion from $2.

These prices and packages are experiments, not committed tariffs. Avoid selling arbitrary limits without evidence of demand and without clear duration, renewal and expiry terms.

### 6. Analytics-led offer selection

Implement a future **InOne Growth Intelligence** capability to recommend the most relevant paid option based on product usage and measured user need.

Permitted signals should be minimized and primarily event-based or aggregated, such as:
- Feature usage frequency and limit attainment.
- Publication counts and voluntarily available aggregate reach/engagement metrics.
- Channel growth and aggregate interactions.
- CRM/Kanban capacity utilization.
- Purchases, repeat purchases, refunds and offer dismissals.
- Retention and churn impact.

Examples:
- Repeated story-limit attainment may trigger a comparison between a one-time story pack and Plus.
- A growing channel with a need for audience insights may trigger Smart.
- An organization approaching its worker/task/CRM capacity may trigger an organization upgrade.

The system must compare subscription versus one-time purchase value for the user, avoid irrelevant repeated prompts and measure whether an offer harms retention. Do not infer commercial intent from private conversations, calls or encrypted content. Do not use sensitive personal attributes for commercial targeting.

### 7. Creator Economy and user earnings

Participation in earning opportunities must not be gated behind a paid subscription. Free users may qualify, subject to eligibility, fraud controls and applicable law.

Build these capabilities in stages:
1. Paid channel memberships / paid content.
2. Voluntary creator support / tips.
3. Activity-quality-based referral rewards.
4. Clearly labelled sponsored placements arranged through an approved marketplace.
5. Marketplace for professional services and business offers.

Commercial hypotheses:
- Creator subscription commission initially tested around 10–15% to InOne, with payment costs, refunds, taxes and chargebacks separately accounted for.
- Sponsored placement revenue split may be tested around 80% to the creator / 20% to InOne.
- These are test parameters, not final commitments.

Do not pay merely for raw registrations. Referral rewards should depend on qualified, sustained activity and anti-fraud checks, with an acquisition budget and positive contribution economics.

Keep **InOne Points** (non-cash platform reward credits) separate from a creator's real-money earnings balance. Do not represent points as money, transferable assets or a cryptocurrency. Redemption, expiry and eligibility rules must be explicit. Real-money payouts require payment-provider, KYC/AML where applicable, tax, sanctions and jurisdictional review.

### 8. Promotion and organic distribution

Paid promotion may provide additional distribution for publications, channels, profiles, local business listings and campaigns. It must be clearly labelled where it is advertising or sponsored content.

Paid promotion must not guarantee views, followers, leads or sales. Free organic discovery must remain meaningful. Do not intentionally suppress ordinary free content to force purchases.

No advertising inside private chats or calls. Do not target ads using private or encrypted content.

### 9. Revenue portfolio and sequencing

Prioritize:
1. Plus and Smart subscriptions.
2. One-time purchases and temporary capacity add-ons.
3. Publication and channel promotion.
4. Enterprise organization subscriptions and additional seats/resources.
5. Creator subscriptions and voluntary support commissions.
6. Marketplace and sponsored creator placements.
7. API/integrations and additional digital/communications services later.

Advertising is not the primary launch revenue model. Do not launch every commercial system at once.

### 10. Measurement and decision gates

Measure at minimum:
- Acquisition, referral quality, activation and D1/D7/D30 retention.
- DAU/MAU and cohort retention.
- Publication supply, active creators, channel growth and organic reach.
- Free-to-Plus and Free-to-Smart conversion.
- One-time purchase conversion, repeat purchase and refund rate.
- Revenue per MAU across all streams, not subscriptions alone.
- Creator earnings, creator retention, payout success and fraud.
- B2B organizations, paid seats, expansion and churn.
- CAC, LTV, gross margin, contribution margin, infrastructure cost per active user and payback period.
- Complaints, spam, abuse and the effect of monetization on user trust.

The proposed mature-base planning mix (e.g. 85% Free, 10% Plus, 4% Smart, 1% Enterprise-equivalent) is only a scenario assumption. Enterprise must be modeled by organizations and seats, not mixed mechanically into personal-account percentages.

### 11. Privacy, safety and trust invariants

- Personal chats and baseline communications remain free.
- No sale or commercial exploitation of private-message, call or encrypted content.
- No advertising or commercial profiling based on private/encrypted content.
- No paywall on baseline encryption, account security or privacy protections.
- Clear disclosure of sponsored content and paid distribution.
- Anti-spam, anti-bot, creator fraud, fake engagement and referral abuse controls.
- Transparent purchase, renewal, cancellation, refund and payout terms.
- Legal and payment compliance before real-money creator payouts or marketplace transactions.

### 12. Staged implementation

1. **Audience foundation:** Free personal and starter business entitlements, organic content/community, referral instrumentation, retention analytics.
2. **First monetization:** Plus, Smart, optional add-ons, promotion, controlled experiments.
3. **Creator Economy:** paid channels, tips, creator analytics and qualified referrals.
4. **Business monetization:** Enterprise, seats, CRM/Kanban capacity, integrations and support.
5. **Commercial ecosystem:** Marketplace, creator sponsorships, APIs and additional services.

Each stage requires a separate product specification, economic model, privacy/security review, legal review where applicable, and owner approval before implementation.

## Consequences

- Free is the expected largest tier and the platform's primary audience-growth engine.
- Plus is the primary mass-market paid tier; Smart is the advanced creator/professional tier.
- Enterprise is sold at organization level with explicit included seats and expansion pricing.
- Optional purchases serve intermittent needs and should be offered contextually.
- Creator earnings and marketplace commissions diversify revenue beyond subscriptions.
- Product analytics must measure the whole user lifecycle and not optimize conversion at the expense of retention, trust or organic reach.
- Financial forecasts must label assumptions and validate infrastructure, payment, tax, acquisition and conversion inputs before they are treated as forecasts.

## Explicit non-goals / not authorized by this ADR

This strategic ADR does **not** authorize:
- Changes to Beta 1.0 code, APIs, schemas, database migrations, approved screens, release scope or existing WBS.
- Immediate implementation of paid limits, billing, payments, wallets, creator payouts, advertising, promotion or Marketplace.
- Changes to the approved InOne / InOne Business product split.
- Changes to identity, authentication, MLS, encryption, security or privacy architecture.
- Purchases, contracts, provider commitments, advertising campaigns or financial commitments.
- Treating illustrative prices, revenue shares, conversion rates or user-mix assumptions as validated facts.

Any implementation requires a separately scoped roadmap item, technical and legal review, measurement plan and explicit owner authorization.
