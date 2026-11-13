# Development roadmap — from architecture to first releases

**Version:** 0.1  
**Status:** Proposed sequence; dates and scope not approved

## Guiding strategy

Build the platform in dependency order. First settle identity, organizations, authorization and Propo integration. Then deliver the smallest useful InOne Business operating loop. Build InOne personal/social as a distinct product with its own release scope. Avoid implementing every named module at once.

## Stage 0 — Owner decisions and product specification

Deliverables:
- answers to blocking questions in [OPEN-OWNER-DECISIONS.md](../../architecture/OPEN-OWNER-DECISIONS.md);
- product capability map for Propo / InOne Business / InOne;
- organization-to-Seller-Account cardinality;
- person identity and login flow;
- role/permission matrix;
- data ownership matrix;
- Propo API/event inventory;
- initial release scope and measurable acceptance criteria.

Exit gate:
- owner approves product boundary, identity and org model;
- Propo integration owner confirms contract ownership and access to documentation/sandbox;
- no critical domain is left with invented semantics.

## Stage 1 — Platform foundation

Design and implement only after Stage 0 approval:
- repo/workspace strategy;
- environment and secret management;
- CI checks and reproducible local development;
- backend composition root and domain module boundaries;
- database migration framework and test database;
- identity/session model;
- organization membership and tenant-scoped authorization;
- audit trail;
- health/readiness and observability baseline.

Exit gate:
- sign-in and organization context work end-to-end;
- permission tests prove cross-organization isolation;
- migration and restore process is documented;
- no product-specific feature bypasses authz.

## Stage 2 — Propo integration foundation

- Versioned Propo API/event contract.
- Seller Account linking and lifecycle.
- Authenticated service-to-service transport.
- Durable event inbox/outbox.
- Idempotency, retries, dead-letter handling and replay.
- Contract tests and sandbox E2E tests.
- Reconciliation and integration health dashboard.

Exit gate:
- test order/message/rating event can be delivered, deduplicated and recovered;
- tenant/store mapping is verified;
- Business cannot access another seller's data;
- Propo remains available if Business is offline.

## Stage 3 — InOne Business minimum operating loop

Recommended initial slice, subject to owner approval:
1. Organization workspace and active organization switcher.
2. Employee invitations and basic role permissions.
3. Business inbox for Propo buyer messages.
4. Notifications for new orders, purchases and ratings.
5. Internal conversations and threads linked to a product, campaign or order reference.
6. Audit trail for employee actions.
7. Basic store sales overview from Propo-approved data.

Exit gate:
- one real organization can onboard multiple employees;
- each employee sees only authorized store data;
- buyer message reply round-trip works through Propo contract;
- critical events are not lost;
- mobile navigation and notification states are accepted.

## Stage 4 — InOne Business workflow and intelligence

- Kanban/task workflow.
- Product launch workflow and approvals.
- Campaign/banner planning and publishing workflow.
- CRM/Leads/Deals after lifecycle definitions.
- Advanced analytics and reports.
- Wallet only after ledger/financial semantics are approved.
- Flags only after exact business meaning is defined.
- AI assistant after data access, permission, audit and human confirmation model is approved.

Exit gate:
- each module has domain model, API contract, permission matrix, audit, tests and operational owner.

## Stage 5 — InOne personal/social foundation

- Personal identity/profile and privacy.
- One-to-one and group conversations.
- Communities and channels.
- Personal feed and publications.
- Stories and statuses.
- Media and notifications.
- Search, moderation, reporting and abuse prevention.

Exit gate:
- personal content is isolated from organization content;
- privacy and audience rules are tested;
- conversation security model is accepted;
- moderation and abuse flows exist before broad public growth.

## Stage 6 — Cross-product experience

- Safe switching between Propo and InOne Business.
- Optional switching between InOne and Business where user is entitled.
- Deep links with re-authorization.
- Unified notifications only if the user consents and product boundaries remain clear.
- Account recovery and device/session lifecycle across products.

Exit gate:
- switching cannot leak data or tokens;
- losing one product does not create undefined failure in another;
- account unlink/disable/recovery is documented.

## Stage 7 — Scale, reliability and operations

- Load and capacity testing.
- Database indexing and query optimization.
- Queue backpressure and worker scaling.
- Read models and analytics pipelines.
- Backup restore drills and disaster recovery.
- Security review and penetration testing.
- SLOs, on-call runbooks and cost budgets.

Exit gate:
- capacity targets and recovery objectives are measured;
- operational alerts are actionable;
- release and rollback procedures are proven.

## Work item definition of done

Every work item must include:
- product owner (Propo / Business / InOne / shared);
- user and business outcome;
- requirements and non-goals;
- domain model and data owner;
- API/event contract;
- permission rules;
- UI states (loading, empty, error, offline, forbidden);
- migration if needed;
- unit, integration, contract and E2E tests appropriate to risk;
- observability and audit;
- acceptance evidence on exact commit SHA;
- documentation and handover update.

## What not to do first

- Do not build all three products as one giant app.
- Do not start with Wallet or financial transfers.
- Do not build a general-purpose microservice mesh before load and team needs exist.
- Do not connect to Propo by direct database access.
- Do not build AI features before access control, audit and data contracts.
- Do not activate legacy screens simply because they exist in a branch.
