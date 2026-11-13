# Architecture restart and platform blueprint v0.1

**Date:** 2026-11-13  
**Branch:** architecture/product-and-platform-blueprint-2026-11-13  
**Base:** main at branch creation; documentation-only work  
**Status:** Draft for owner review

## 1. Owner-provided product direction captured

- Propo is the marketplace and classifieds project in Armenia.
- InOne Business is the logical professional continuation of Propo: the backstage/back office and internal operating workspace for seller organizations and their employees.
- Business use cases include internal product/campaign discussions and threads, buyer messages, purchase/order and rating notifications, sales analytics, calculations, organization roles/permissions, Kanban, CRM, Leads, Deals, Wallet, Flags, organization profile/content and Propo Seller Account integration.
- Owner privileges include editing the organization profile; the complete permission matrix is not yet defined.
- InOne is the personal/social product: personal chats, groups, communities, channels, news feed, personal publications/profile, avatar, cover, About me, stories and statuses.

## 2. Documents created

### Root architecture
- architecture/README.md
- architecture/PRODUCT-VISION.md
- architecture/PRODUCT-BOUNDARIES.md
- architecture/SYSTEM-ARCHITECTURE.md
- architecture/DOMAIN-MODEL-AND-ACCESS.md
- architecture/ARCHITECTURE-LAWS.md
- architecture/OPEN-OWNER-DECISIONS.md

### Development architecture
- development/architecture/README.md
- development/architecture/DEVELOPMENT-ROADMAP.md
- development/architecture/BACKEND-EVOLUTION.md
- development/architecture/REPOSITORY-REBASELINE.md

### Entry points and continuity
- README.md
- development/README.md
- docs/continuity/DECISIONS.md
- docs/continuity/SOURCE-OF-TRUTH.md
- docs/continuity/CURRENT-STATE.md
- docs/continuity/NEXT-SESSION.md
- development/SESSION-LOG.md

## 3. Architecture choices proposed, not approved

- Begin with clearly bounded modular backends rather than premature microservices.
- Treat Propo as authoritative for marketplace-owned data; Business integrates through versioned authenticated APIs/events.
- Use durable inbox/outbox, idempotency, retry, replay and reconciliation for marketplace events.
- Use organization-scoped RBAC with explicit permission checks at the backend.
- Separate personal, internal organization and buyer-to-seller conversation security domains.
- Optimize backend from measured latency, database plans, queue depth and operational metrics.
- Treat historical repository source as candidate reference until re-baselined.

These are CTO proposals and require owner review where they affect product or infrastructure decisions.

## 4. Open owner decisions

The detailed list is in architecture/OPEN-OWNER-DECISIONS.md. Highest priority:
1. Propo Seller Account to organization cardinality.
2. Employee identity/login and multi-organization membership.
3. Common identity across Propo, InOne Business and InOne.
4. Fixed roles vs custom roles; owner/admin/financial privileges.
5. Propo buyer-message API and event/webhook capabilities.
6. Which marketplace actions Business may perform vs read/notify only.
7. Definitions and financial semantics of Wallet and Flags.
8. Separate app packaging and backend/database topology.

## 5. Repository restart interpretation

The owner requested that all current repository implementation be treated as not yet completed for the new architecture exercise. Files and history are preserved; no deletion or rewrite was performed. Existing code, screens, test files, historical CI and progress baselines are not treated as proof of new product completion.

## 6. Changes and verification

- Documentation-only branch created from main.
- Architecture and development planning files committed to the branch.
- Continuity and README entry points updated.
- Remote files must be reviewed through the draft PR before merge.
- No product code, UI, API, DB schema, CI workflow, deployment or service changed.
- No Actions were started and no PR was merged.
- Application tests: NOT RUN (documentation-only work).

## 7. Next actions

1. Owner reviews and answers the blocking questions.
2. Obtain Propo API/event documentation and sandbox access.
3. Run a complete read-only repository re-baseline.
4. Publish ADRs for identity, organization mapping, data ownership, database topology, messaging security and integration.
5. Approve the first InOne Business vertical slice and InOne personal/social release scope.
