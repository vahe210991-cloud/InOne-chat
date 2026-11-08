# ADR-011 — Independent InOne database for Beta 1.0

**Status:** Accepted by product owner on 2026-11-08  
**Scope:** InOne Beta 1.0; future InOne + Propo platform integration

## Decision

Beta 1.0 launches with an InOne-owned database and InOne-owned backend. A unified/shared database for InOne and Propo is deferred to the next beta release after Beta 1.0. Work on a shared database must not become a launch dependency or block the first usable InOne build.

## Beta 1.0 constraints

- InOne must operate when Propo services are unavailable.
- InOne owns its Beta 1.0 domain data and database migrations.
- Do not add cross-product runtime dependencies or synchronous calls to Propo.
- Use stable, globally unique user/device identifiers and explicit product/platform namespaces where needed.
- Keep schemas and API contracts migration-friendly; do not couple InOne tables to Propo's internal schema.
- If any account-reservation/identity compatibility is required for Beta 1.0, it must be isolated behind a small, documented contract and must not require a shared operational database.
- Do not claim cross-product account reservation is implemented until its independent service and failure semantics are implemented and tested.

## Deferred to the next beta

- Unified/shared operational database, if still justified by product and operational needs.
- Cross-product identity provisioning and reconciliation beyond the minimal Beta 1.0 contract.
- Data migration, conflict resolution, ownership rules, and rollback plan for joining datasets.

## Rationale

The shared database is not required to validate InOne Beta 1.0's core chat experience. Deferring it reduces integration scope and launch risk while preserving a path to future interoperability through stable identifiers and explicit APIs/events.

## Release gate

Beta 1.0 acceptance is based on the InOne database, InOne backend, mobile client, and their own end-to-end tests. The future shared database is not a Beta 1.0 blocker. The team must revisit this ADR before the next beta and approve a migration design before connecting production datasets.
