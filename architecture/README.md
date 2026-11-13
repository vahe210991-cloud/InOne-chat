# InOne Platform Architecture

**Status:** Architecture v0.1 — owner-context draft, for review  
**Date:** 2026-11-13  
**Products:** Propo · InOne Business · InOne

This directory is the architectural entry point for the platform. It describes the intended products, their boundaries, system relationships, domain ownership, and non-negotiable engineering principles.

## Read in this order

1. [Product vision](PRODUCT-VISION.md) — what the products are and why they exist.
2. [Product boundaries](PRODUCT-BOUNDARIES.md) — responsibility of each application and the Propo relationship.
3. [System architecture](SYSTEM-ARCHITECTURE.md) — proposed system topology, backend, integration and data flow.
4. [Domain model and access](DOMAIN-MODEL-AND-ACCESS.md) — organizations, employees, roles, permissions and key business objects.
5. [Architecture laws](ARCHITECTURE-LAWS.md) — rules all implementation must follow.
6. [Open owner decisions](OPEN-OWNER-DECISIONS.md) — questions that must be answered before the related design is frozen.

## Companion development plan

The implementation path is in [development/architecture/](../development/architecture/README.md):
- phased development roadmap;
- backend evolution and optimization;
- repository re-baselining and first engineering actions.

## Authority and status

- Owner-approved product direction is distinguished from CTO proposals and unresolved questions.
- A proposal in these documents is not an owner decision until the owner approves it.
- The repository currently contains historical code, experiments, reports and assets. For the new architecture exercise, their existence is not proof of production readiness or completed product behavior.
- No application code, database schema, API, integration or deployment is authorized by this architecture draft.
- If this directory conflicts with a newer explicit owner decision, record the conflict and update the documents. Never silently guess.

## Architecture versioning

Use Architecture Decision Records (ADRs) for decisions that affect product boundaries, identity, data ownership, security, integration contracts, infrastructure or deployment. Each ADR must include context, decision, alternatives, consequences, status, owner approval and date.


## InOne Identity — Stage 0 engineering readiness

The contract-first preparation package is maintained in [architecture/identity/](identity/):
- [Stage 0 Engineering Readiness](identity/STAGE-0-ENGINEERING-READINESS.md)
- [Stack ADR-001](identity/ADR-IDENTITY-STACK-001.md)
- [Propo adapter questionnaire](identity/PROPO-ADAPTER-QUESTIONNAIRE.md)
- [Data classification and privacy inventory](identity/DATA-CLASSIFICATION-AND-PRIVACY.md)
- [Machine-readable API and event contracts](identity/contracts/README.md)

Stage 0 is a readiness milestone, not a running Identity service. The contract-validation workflow and compatibility spike must pass before Stage 1 implementation begins. Propo and privacy/legal evidence remain external gates before production integration.
