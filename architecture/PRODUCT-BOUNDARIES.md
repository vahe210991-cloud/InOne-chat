# Product boundaries and ownership

**Version:** 0.1  
**Status:** Draft for owner review

## 1. Capability allocation

| Capability | Propo | InOne Business | InOne |
|---|---|---|---|
| Marketplace browsing and buyer-facing product discovery | Primary | Deep links/context only, if approved | No marketplace ownership |
| Product listings/catalogue | System of record (confirm exact Propo ownership) | Seller workflow and authorized management UI through Propo contract | No |
| Orders and purchases | Marketplace system of record | Seller-side operational view, notifications and actions through Propo contract | No |
| Buyer-to-seller messages | Marketplace-originated conversation/context | Seller inbox and authorized employee handling | Personal messaging remains separate |
| Ratings/reviews | Marketplace system of record | Store notifications and analytics | No |
| Seller/store account | Propo Seller Account (one account per Business organization in v1) | One-to-one connected seller workspace | Not an organization account |
| Organization and employees | Propo seller/store association is an input to integration; canonical ownership TBD | Organization workspace, membership and role experience | No |
| Internal team chat and work threads | No | Primary | No, except personal/social spaces |
| Kanban, CRM, Leads, Deals | No unless Propo contract explicitly owns a record | Primary workspace; domain ownership must be specified | No |
| Wallet | Marketplace financial source/ledger ownership must be confirmed | Business view/actions only through approved financial contract | No |
| Flags | Meaning and owner TBD | Candidate business capability; do not implement before definition | No |
| Store analytics | Marketplace data source | Business dashboards and analysis | No |
| Personal chats, groups, communities, channels | No | Not the personal social product | Primary |
| Personal profile, avatar, cover, About me | No | Employee identity may be shown, but does not own personal profile | Primary |
| Personal posts, stories, statuses, feed | No | Organization publication surface may exist separately | Primary |
| Organization publications, stories and statuses | Marketplace/store surface only if Propo owns it; confirm | Organization-owned content, if approved | Personal content only |

This table expresses intended product allocation, not a claim that any route or feature already exists.

## 2. The critical distinction: organization vs person

The platform must model at least these concepts separately:

- **Person identity:** the human who signs in.
- **InOne profile:** the person's personal/social profile.
- **Organization:** a legal/business or operational entity using InOne Business.
- **Store / Seller Account:** Propo's marketplace seller entity/account. Owner decision A1: exactly one Propo Seller Account is connected to exactly one InOne Business organization in the initial release. One organization managing multiple Seller Accounts/stores is out of initial scope.
- **Membership:** a person's relationship to an organization.
- **Role and permissions:** what that member may do in a specific organization and context.
- **Session / active context:** the person, device, product and organization context in which an action is performed.

A person's identity must not be confused with the organization that employs or authorizes them.

## 3. Application navigation and switching

Proposed experience:
- InOne and InOne Business have separate application identities, navigation trees, permissions and release scopes.
- When a person is entitled to both, each application may provide a secure switch/open action to the other.
- Switching must preserve the correct account and organization context without copying access tokens into URLs, WebViews, logs or clipboard.
- If the person belongs to several organizations, the active organization must be explicit and visible in InOne Business. Each organization has exactly one connected Propo Seller Account in the initial release.
- Deep links must be authorized by the destination backend; hiding a UI item is not authorization.

The exact packaging (two app-store apps, one app with separate packages, or another distribution model) is not yet decided. The owner has approved two separate applications at product level; packaging and shared-client code are technical decisions still open.

## 4. Business content vs personal content

Content records must carry an explicit owner and audience, for example:
- person-owned;
- organization-owned;
- channel/community-owned;
- marketplace/store-owned.

The final schema and audience rules are open. Do not reuse a personal profile publication as an organization announcement without explicit product rules.

## 5. Cross-product contract

InOne Business must integrate with Propo through a versioned, authenticated API/event contract.

Rules:
- Propo remains authoritative for marketplace-owned records.
- InOne Business requests only the data/actions permitted by the contract.
- InOne Business must not query Propo's internal database directly.
- Propo must not rely on InOne Business being online for core marketplace checkout or buyer journeys.
- Buyer messages, purchases, ratings and listing changes should be delivered as durable, retryable events or through an explicitly versioned API. Delivery semantics and ownership must be agreed with Propo.
- Every event needs an event ID, schema version, source, timestamp, tenant/store scope, idempotency strategy and trace/correlation ID.
- A failed integration must be visible and recoverable; it must not silently drop business-critical notifications.

## 6. Beta and release scoping

Do not inherit the old InOne Beta 1.0 / Beta 2.0 labels as the new product plan without owner review. Existing plans and implementation records are historical inputs. A new release scope must be created for:
- Propo integration;
- InOne Business;
- InOne personal/social.

No feature is considered in scope merely because a legacy branch or screen contains it.


## 7. Approved initial Seller Account cardinality

The owner selected Option A: **one Propo Seller Account = one InOne Business organization**. The initial product does not support one organization managing multiple Seller Accounts/stores. This is a cardinality decision, not a claim that Propo already exposes a particular employee or authentication model. The Propo stable account identifier and integration contract still require confirmation.
