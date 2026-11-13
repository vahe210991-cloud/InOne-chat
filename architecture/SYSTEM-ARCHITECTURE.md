# System architecture — proposed target

**Version:** 0.1  
**Status:** CTO proposal; requires owner decisions listed in OPEN-OWNER-DECISIONS.md

## 1. Architecture goals

1. Keep Propo's marketplace reliable and authoritative for marketplace data.
2. Give organizations a secure back office in InOne Business.
3. Keep InOne personal/social functionality independent from organization operations.
4. Make cross-product communication reliable, observable and versioned.
5. Enforce organization-level authorization on every backend operation.
6. Start with a design that is operable by a small team; avoid premature microservices.
7. Preserve the ability to split high-load or independently owned modules later.

## 2. Logical system map

```text
                         PEOPLE
                           |
              +------------+------------+
              |                         |
          InOne app               InOne Business app
       personal/social            organization workspace
              |                         |
       InOne API/backend          Business API/backend
              |                         |
       InOne data domains         Business data domains
              |                         |
       personal social,           orgs, memberships, RBAC,
       profiles, chats,           work threads, CRM, Kanban,
       groups, channels           analytics views, inbox
              |                         |
              +------ shared platform capabilities ------+
                     identity, notifications, files,
                     audit, search, observability
                                    |
                          Integration boundary
                       versioned API + event delivery
                                    |
                              Propo platform
                    marketplace / seller account / orders /
                     catalogue / buyer conversations / ratings
```

This is a logical map, not a final deployment topology. The number of deployables and databases is not yet approved.

## 3. Recommended initial backend shape

**Recommendation:** begin with a modular monolith for each independently owned application backend, or a clearly separated set of modules inside an agreed platform backend. Do not begin with dozens of microservices.

The existing repository's historical server is a Node.js HTTP application with modular route/domain files, PostgreSQL persistence, migrations and adapters. This is a useful structural reference. It is not proof that the proposed platform backend is production-ready.

A modular monolith should have:
- one explicit composition root/bootstrap;
- domain modules with private internal interfaces;
- route/controller layer separated from domain use cases;
- repositories for persistence;
- external adapters for Propo, email, SMS, push and object storage;
- transaction boundaries owned by the domain;
- outbox/inbox for reliable integration;
- contract tests for external APIs/events;
- no direct cross-module SQL access.

Extract a module into a separate service only when there is evidence of independent scaling, release cadence, security boundary, operational ownership or failure isolation that justifies the cost.

## 4. Logical backend modules

### InOne personal backend
- Identity/session adapter (canonical identity ownership TBD).
- Personal profiles and privacy settings.
- Social graph / follows / memberships (exact model TBD).
- Personal feed and publications.
- Stories and statuses.
- Direct and group conversations.
- Communities and channels.
- Media/file metadata and object storage adapter.
- Notification preferences and delivery.
- Search.
- Moderation, reporting and abuse controls.
- Audit/security events.

### InOne Business backend
- Organization registry and organization settings.
- Seller Account connection and mapping.
- Employee membership lifecycle.
- Role and permission policy engine.
- Organization profile and organization content.
- Business inbox for buyer conversations.
- Marketplace notification ingestion.
- Workspaces and internal conversations/threads.
- Tasks/Kanban.
- CRM, Leads and Deals.
- Sales analytics and reporting projections.
- Wallet adapter/view (financial source of truth TBD).
- Flags (business meaning and lifecycle TBD).
- Audit trail and approvals.
- Notification routing and delivery.

### Shared platform capabilities (logical; physical sharing TBD)
- Identity and authentication primitives.
- Device/session management.
- Notification orchestration.
- File/media storage.
- Search infrastructure.
- Audit/event envelope.
- Feature configuration.
- Observability and support tooling.

Shared capability does not mean shared database tables or unrestricted access between products.

## 5. Propo integration architecture

InOne Business should use an anti-corruption/integration layer that translates Propo's external concepts into stable internal Business concepts.

The integration layer should provide:
- authenticated server-to-server communication;
- versioned API schemas;
- event ingestion and acknowledgement;
- idempotency keys;
- retry with exponential backoff and jitter;
- dead-letter handling and replay;
- inbox/outbox persistence;
- reconciliation jobs;
- request signing or mTLS/OAuth client authentication (choose after threat modelling);
- per-tenant/store authorization;
- correlation IDs and end-to-end tracing;
- sandbox and contract tests.

### Event examples (illustrative, not agreed contracts)
- `marketplace.order.created`
- `marketplace.order.status_changed`
- `marketplace.buyer_message.created`
- `marketplace.review.created`
- `marketplace.rating.changed`
- `marketplace.listing.status_changed`

These names are examples only. Do not implement them until Propo's actual event/API contract is reviewed and versioned.

### Data flow example: buyer message
1. Buyer sends a message in Propo.
2. Propo persists the message as the authoritative marketplace record.
3. Propo emits or exposes a durable event/notification under an agreed contract.
4. InOne Business integration adapter authenticates, validates schema and tenant scope, and stores an inbox receipt idempotently.
5. Business backend makes the message available only to authorized employees of the mapped organization/store.
6. Employee replies through an authorized Business operation.
7. Business backend calls Propo's approved reply API; it does not write directly to Propo storage.
8. Propo remains authoritative for the buyer-facing conversation.
9. Delivery and failure states are observable and recoverable.

### Data flow example: sales analytics
1. Propo remains the source of truth for marketplace sales/order facts.
2. Business analytics consumes approved aggregates/events or calls an authorized reporting API.
3. Business stores derived projections only when justified by performance and retention requirements.
4. Every metric has a definition, currency, timezone, filters, update delay and source.
5. Reconciliation compares projections to Propo's authoritative reporting data.

## 6. Data ownership and persistence

Recommended boundaries:
- Propo owns marketplace listings, buyer orders, marketplace payment state, ratings and buyer-facing conversations unless Propo's own architecture specifies otherwise.
- InOne Business owns organization membership, roles, internal discussions, work assignments, and its own workflow metadata.
- InOne owns personal profile/social content and personal conversations.
- Shared identity ownership is not yet finalized for the three products.
- Business may store references and read models for Propo entities, but must not silently become a second authoritative owner of marketplace records.

Database strategy is an open owner decision. Existing ADR-011 approved an independent InOne database for an earlier Beta 1.0 scope and deferred a shared InOne+Propo operational database. The new product direction requires a fresh decision that reconciles that ADR with InOne Business. Until then, do not assume a shared database or alter ADR-011 silently.

## 7. Communication and messaging

Messaging domains must be classified:
- personal conversations in InOne;
- internal organization/work conversations in InOne Business;
- buyer-to-seller marketplace conversations owned by Propo, surfaced to authorized staff through InOne Business.

Do not merge these into one authorization domain merely because they share a chat UI.

If end-to-end encryption/MLS is used:
- message content must not fall back to plaintext transport/storage;
- server-side search, moderation, retention and legal access constraints must be explicitly reconciled with encryption;
- organization membership changes must define key rotation and history access;
- buyer messaging integration must define whether the Propo conversation is end-to-end encrypted, server-readable, or uses another security model;
- no message protocol is accepted until threat model, device storage, key lifecycle and recovery are validated.

The repository has historical Rust/OpenMLS and MLS bridge work. Treat it as a candidate technical asset only; it is not accepted as the security design for every conversation type.

## 8. API design

- Use explicit versioned contracts.
- Validate request and response schemas at boundaries.
- Use stable resource IDs and explicit tenant/org/store scoping.
- Use pagination, filtering and sorting contracts for collections.
- Make write operations idempotent where retries are possible.
- Return structured error codes and correlation IDs.
- Define authorization requirements per operation, not just per route.
- Avoid leaking database schema or internal service names.
- Keep mobile clients thin: business rules and authorization live on the backend.
- Generate client SDKs or typed repositories from reviewed schemas where practical.

## 9. Scale and resilience

Start with:
- PostgreSQL as transactional relational store where selected;
- object storage for media and attachments;
- background job/queue abstraction for notifications, analytics projections and integration retries;
- Redis or equivalent only when a measured need exists (cache, ephemeral coordination, rate limiting); do not add it by habit;
- CDN for public/static media where appropriate;
- connection pooling and bounded concurrency;
- query plans, indexes and slow-query monitoring;
- read models/materialized views for analytics when justified;
- structured logs, metrics, traces and alerting;
- backup restore drills and migration rollback/forward-fix strategy.

Avoid:
- synchronous fan-out to Propo on every screen render;
- unbounded event processing;
- retry loops without idempotency;
- cross-product database joins;
- long-running calculations in HTTP request handlers;
- caching authorization decisions without tenant/context keys;
- premature service proliferation.

## 10. Deployment topology

Not decided. Candidate deployment units:
- Propo marketplace (existing independent project).
- InOne personal API and workers.
- InOne Business API and integration/worker processes.
- Shared platform services only if ownership and failure isolation are defined.

Do not deploy or expose any service as part of this architecture-writing stage.


## Owner-approved constraint — Seller Account cardinality (2026-11-13)

For the initial InOne Business model, one Propo Seller Account maps to exactly one Business organization, and one Business organization connects to exactly one Propo Seller Account. The organization-to-account connection must be unique on both sides. Do not implement a multi-store organization or account aggregation in v1. Propo's actual immutable Seller Account identifier and API/event semantics must still be verified with the Propo project before integration implementation.
