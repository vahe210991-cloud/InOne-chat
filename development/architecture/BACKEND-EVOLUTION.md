# Backend evolution and optimization plan

**Version:** 0.1  
**Status:** CTO proposal; target stack and topology require owner approval

## 1. What the existing repository gives us as a reference

Historical repository analysis identified:
- Node.js HTTP server and modular route/domain source;
- PostgreSQL transactional persistence and SQL migrations;
- memory-backed test support;
- storage adapters for files/objects;
- SMTP and SMS adapters;
- device/session and organization concepts;
- feature flags and rate limiting;
- Rust/OpenMLS client and a Flutter bridge path;
- Flutter client, repositories and WebView/native bridge work on task branches.

These are reference assets only. For the restart, none is considered complete or production-accepted merely because it is in GitHub. The backend audit must re-establish exact source, tests, dependencies and security state before reuse.

## 2. Recommended backend structure

Start with a modular monolith where domain boundaries are explicit. A possible Node.js layout:

```text
backend/
  src/
    bootstrap/             # configuration, dependency wiring, server start
    shared/
      auth/
      db/
      http/
      events/
      observability/
      errors/
    modules/
      identity/
      organizations/
      memberships/
      authorization/
      propo-integration/
      business-inbox/
      workspaces/
      conversations/
      tasks/
      crm/
      analytics/
      wallet/              # only after financial design approval
      flags/               # only after domain definition
      notifications/
      audit/
      files/
  migrations/
  contracts/
    openapi/
    events/
  tests/
    unit/
    integration/
    contract/
    e2e/
```

This is a proposed logical layout, not an instruction to move existing files before a source re-baseline.

Each module owns:
- domain entities and invariants;
- application use cases;
- repository interfaces;
- persistence implementation;
- API/event contracts;
- authorization requirements;
- tests and metrics.

Other modules use public interfaces, not direct table writes.

## 3. Database boundaries

A likely starting point is PostgreSQL for transactional domains, with schemas or separate databases chosen only after ownership and operational isolation are decided.

Do not settle database topology before resolving:
- Propo as source of truth for marketplace entities;
- whether Business has its own operational DB;
- whether InOne personal data shares any infrastructure with Business;
- canonical identity ownership;
- data residency, retention and deletion requirements.

Hard rules:
- no cross-product SQL joins;
- stable IDs and explicit external references;
- migrations are versioned and tested;
- tenant/org IDs are part of the access path and often composite indexes;
- enforce uniqueness and referential integrity in the database where appropriate;
- use transactions for local invariants;
- use outbox/inbox rather than distributed transactions across Propo and Business.

## 4. Integration reliability pattern

For Propo-to-Business events:
1. Validate authentication/signature and schema.
2. Persist event receipt and payload/reference in an inbox transaction.
3. Deduplicate by source + event ID.
4. Acknowledge only after durable persistence.
5. Process asynchronously with bounded concurrency.
6. Retry transient failures with exponential backoff and jitter.
7. Move exhausted failures to a dead-letter state.
8. Provide controlled replay and reconciliation.
9. Record event age, processing latency, failures and tenant scope.

For Business-to-Propo commands:
- create an idempotent command record;
- validate user permission and organization-to-seller mapping;
- call the versioned Propo contract;
- store correlation and result;
- handle timeouts as unknown outcomes until reconciled, not as automatic failures safe to repeat;
- expose status to the user.

## 5. Performance and cost optimization

Optimize from measurements:
- establish p50/p95/p99 latency and throughput baselines;
- log slow SQL with parameter redaction;
- inspect EXPLAIN plans;
- index by tenant/store + common filter/sort keys;
- avoid N+1 queries;
- paginate every unbounded list;
- use cursor pagination for high-volume feeds/events;
- bound DB pool and worker concurrency;
- use caching only for measured hot reads and include tenant/context in cache keys;
- invalidate caches through domain events;
- move report generation and media processing to background jobs;
- use pre-aggregated read models for expensive dashboards;
- keep analytics queries off latency-sensitive transactional paths;
- apply backpressure when queues grow;
- set payload and upload limits;
- use CDN/object storage for media rather than proxying large files through app workers.

Do not add Redis, Kafka, Kubernetes or separate microservices by default. Choose each component from a measured requirement and operational capability.

## 6. Security and tenant isolation

- Central authorization policy evaluated on every request.
- Organization/store context derived from verified session and membership, not trusted from arbitrary client input.
- Propo service credentials separate from user tokens.
- Secrets in managed secret storage; rotate credentials.
- Rate limits for login, OTP, invites, search, buyer messaging and external callbacks.
- Validate webhook signature, timestamp and replay window.
- Encrypt sensitive data in transit and at rest.
- Audit privileged and financial actions.
- Redact PII and secrets from logs.
- Test cross-tenant object reference attacks and background job scope leakage.

## 7. Observability and operations

Baseline:
- structured JSON logs with request/correlation/tenant IDs (never raw secrets);
- metrics for request latency/error, DB pool, queue depth/age, webhook delivery, worker retries, notification delivery;
- distributed traces across Business integration and Propo requests;
- dashboards by service and business flow;
- alert on stale marketplace events, dead-letter growth, integration auth failure, DB saturation and notification failures;
- readiness and liveness endpoints;
- backup monitoring and restore tests;
- runbooks for Propo outage, credential rotation, event replay and data correction.

## 8. Backend testing pyramid

- Unit: domain invariants and permission policy.
- Integration: PostgreSQL transactions, migrations, repositories, outbox/inbox.
- Contract: Propo API and event schemas; compatibility tests.
- Security: tenant isolation, IDOR, replay, rate limit, privilege escalation.
- E2E: seller account onboarding, employee invitation, buyer message round-trip, order/review notification and analytics.
- Load: event bursts, feed/inbox pagination, dashboard query concurrency.
- Resilience: Propo unavailable, duplicate events, delayed/out-of-order events, worker restart, DB failover and queue backlog.

A test is PASS only when executed against the exact source SHA and its output is recorded.

## 9. Service extraction criteria

Extract a module only if one or more are proven:
- materially different scaling profile;
- independent release and ownership;
- stronger isolation requirement;
- failure containment need;
- separate data residency/compliance boundary;
- monolith deployment cadence creates measurable risk.

Before extraction, define API/event contracts, data ownership, migration, dual-run/reconciliation, rollback and operational owner.

## 10. Suggested first backend vertical slice

Build a complete thin path rather than many disconnected modules:
- authenticate a person;
- resolve active organization membership;
- authorize reading a connected Seller Account;
- ingest one Propo event durably;
- show it in the Business inbox;
- let an authorized employee perform one permitted action through Propo API;
- audit the action and prove idempotency/retry behavior.

The exact event and action must be selected after Propo contract review.
