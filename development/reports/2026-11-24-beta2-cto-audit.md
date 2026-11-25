# CTO audit snapshot — InOne Beta 2.0

**Date:** 2026-11-24  
**Repository:** vahe210991-cloud/InOne-chat  
**Baseline:** main `02880940c1e4d8261405fbeaa01f40879eb44f3a`  
**Scope:** repository/documentation/source-path review for Beta 2.0 planning. Not a penetration test or runtime certification.

## Executive conclusion

Beta 2.0 should begin with an independent Identity Service. The product requirement and architecture direction are already recorded, but the current canonical InOne backend evidence shows local identity/authentication behavior rather than a separately deployable cross-platform Identity authority. This is the largest architectural prerequisite and must be resolved before broad cross-product feature work.

The product is approved as two separate applications: InOne (personal/social) and InOne Business (professional/work). A shared identity service does not mean a shared application backend, navigation tree, domain database or authorization policy.

## Findings

| ID | Severity | Finding | Evidence / impact | CTO disposition |
|---|---|---|---|---|
| A-01 | Critical architectural gap | No independent cross-platform Identity Service evidenced in reviewed current source | Current canonical backend has local identity rules and registration/auth/recovery imports; product decision requires independent authoritative identity service/database | Start Phase 1 Identity; do not claim cross-product reservation implemented |
| A-02 | High | Identifier uniqueness and policy are not centralized across products | Existing email normalization and ASCII nickname rules are local backend functions | Define canonical claim types, normalization, scope and DB uniqueness; preserve Beta 1 compatibility until approved |
| A-03 | High | Cross-product provisioning/reconciliation is not evidenced as a complete system | Product decisions require transactional outbox, idempotent consumers, retries and reconciliation | Implement durable event lifecycle and failure injection |
| A-04 | High | Existing account migration is undefined | Beta 1 has live account/session/recovery behavior; duplicate/conflicting identities are possible | Inventory and mapping first; no auto-merge or destructive migration |
| A-05 | High | Product boundary requires explicit service and UI ownership | Approved InOne vs InOne Business split; existing roadmap candidates span social, business and shared capabilities | Classify screens/routes/data and establish independent app/API boundaries |
| A-06 | High | Group collaboration features have security-sensitive semantics | Events, polls, search, bots, favorites and pins differ in visibility/permissions; group content is MLS protected | Specify authorization, privacy, MLS metadata boundary, deletion and multi-device behavior before implementation |
| A-07 | High | Cindy introduces external data/tool risks | Files, correspondence, archives and financial workflows require provider, tool, privacy and consent controls | Threat model, least-privilege tool registry and human approval gates before implementation |
| A-08 | Medium | Localization/theme/icon foundations require design-system protection | HY/RU/EN and future FR/DE/ES; themes and icon variants are approved directions | Use immutable approved design-system source; no invented tokens |
| A-09 | Medium | Existing Beta 2 roadmap branch is stale | `planning/beta-2.0-roadmap` is 1 commit ahead / 1,262 behind `main`, diverged | Preserve branch; new CTO roadmap based on current main |
| A-10 | High release dependency | Beta 1.0 remediation is still separately gated | PR #135 Stage 1 accepted; Stage 2 not accepted until required exact-head checks pass | Keep Beta 1.0 and Beta 2.0 branches/issues isolated |

## Existing work to preserve

- Cross-product identity/localization/design requirements: `docs/PRODUCT-DECISIONS-IDENTITY-LOCALIZATION-DESIGN.md`.
- Owner decisions and two-app split: `docs/continuity/DECISIONS.md`.
- Existing Beta 2 feature candidates: `docs/product/BETA-2.0-AND-LATER-ROADMAP.md` on the legacy planning branch.
- Canonical backend ownership: ADR-004 and `docs/continuity/BACKEND-SOURCE-OF-TRUTH.md`.
- Existing Beta 1 identity/auth behavior in the canonical Node backend. Treat it as compatibility baseline; do not copy the historical POC tree wholesale.
- Beta 1 PR #135 staged security remediation and its scope boundaries.

## Scope limitation

This pass did not execute tests, inspect production data, deploy services, access Propo's private systems, perform a penetration test, or certify the current Beta 1 release. All findings are architectural/source-review findings and require implementation evidence and exact-SHA validation.


## 2026-11-24 execution record

### Work completed

- Created fresh branch `planning/beta-2.0-cto-2026-11-24` from current main `02880940c1e4d8261405fbeaa01f40879eb44f3a`.
- Preserved legacy `planning/beta-2.0-roadmap` unchanged; compare showed 1 commit ahead / 1,262 behind and diverged.
- Added:
  - `docs/product/BETA-2.0-CTO-ROADMAP.md`
  - `docs/product/BETA-2.0-IDENTITY-PHASE-1.md`
  - `docs/product/BETA-2.0-IDENTITY-ADR-DRAFT.md`
  - `docs/product/BETA-2.0-IDENTITY-THREAT-MODEL.md`
  - `development/reports/2026-11-24-beta2-cto-audit.md`
- Created tracking issues #137–#146 for all ten program directions and #147–#148 for Identity Phase 1 discovery and ADR/contracts.
- Updated development README, session log and continuity current-state/next-session/source-of-truth indexes.
- No Beta 1.0 product code, PR #135, production data, secrets, settings or release gates were changed.

### WBS mapping and readiness

- Beta 2.0 work maps to approved WBS v1.1: Backend platforms/API (25%), Frontend/CRM screens (20%), CRM domain (15%), Cindy (15%), Tasks/Calendar (15%), Group collaboration (5%), QA/security/operations (5%).
- Identity is the first P0 foundation task within the existing Backend platforms/API and QA/security/operations criteria. WBS weights and historical baselines were not changed.
- Beta 2.0 baseline remains **2% implementation / 0% verification**. This session added planning artifacts and issues only; no product implementation is credited.
- Beta 1.0 WBS remains 42% implementation / 31% verification; untouched by this work.

### Acceptance status

- GitHub branch and files created/re-fetched: **PASS** (repository-native documentation operations).
- Main-first branch ancestry verified: **PASS**; branch was ahead of main and not behind at the last compare. Legacy branch untouched.
- Roadmap and workstream issue creation: **PASS**.
- Identity source audit: **PASS** for the limited source/document review stated in this report.
- Identity service implementation: **NOT RUN**.
- Node/PostgreSQL/Rust/Flutter tests, CI, security scans, Propo sandbox tests, load tests and production migration: **NOT RUN**.
- Identity Phase 1: **IN PROGRESS / NOT ACCEPTED**. Draft ADR requires owner approval; unresolved policy decisions remain.

### Five previous tasks / evidence preserved

1. Existing owner-approved cross-platform identity and reservation requirements in `docs/PRODUCT-DECISIONS-IDENTITY-LOCALIZATION-DESIGN.md`.
2. Existing identity/product decisions and InOne vs InOne Business boundary in `docs/continuity/DECISIONS.md`.
3. Existing canonical InOne backend ownership and local identity rules; preserve ADR-004 and `docs/continuity/BACKEND-SOURCE-OF-TRUTH.md`.
4. Existing Beta 2 group feature candidates in the legacy roadmap branch; preserved without wholesale branch integration.
5. Beta 1.0 security remediation PR #135 and its staged acceptance boundary; preserved without scope mixing.

### Five next tasks

1. Complete the source-backed inventory of current InOne identity tables, indexes, migrations, auth routes, providers, devices, recovery and audit state; record exact file/schema references.
2. Obtain owner decisions for canonical ID format, globally unique identifiers, email/phone policy, credential ownership, account linking/conflicts, Propo Seller mapping and deletion/retention.
3. Finalize and approve ADR B2-ADR-001, C4 diagrams, OpenAPI and AsyncAPI contracts.
4. Design Identity schema and concurrency/failure-injection tests; implement the independent service only after architecture decisions are approved.
5. Build InOne/Propo adapters, transactional outbox/inbox and reconciliation; validate both registration directions, outages and existing-account migration plan.

### Exact repository hand-back

- Repository: `vahe210991-cloud/InOne-chat`
- Base: `main` at `02880940c1e4d8261405fbeaa01f40879eb44f3a`
- Branch: `planning/beta-2.0-cto-2026-11-24`
- Branch commit immediately before this report update: `d7f720096f6c0f5417de59f7c8a5d0be6e65864a`
- Working mode: GitHub repository-native documentation/issue operations.
- No local-only required changes exist; all listed deliverables are committed to GitHub.


## Expanded Identity source audit — 2026-11-24

A deeper read of the canonical InOne backend corrects and sharpens the initial gap assessment:

- The production entry point `inone-development-archive-0.6.0/engine/src/main.js` creates a PostgreSQL pool, runs migrations, builds `createStore` and injects it into `createServer`. The memory-store fallback exists at the server factory boundary for tests/development; the production entry point supplies PostgreSQL.
- The local database is a persistent InOne identity subsystem, not an empty shell. Relevant tables include `accounts`, `profiles`, `phones`, `provider_links`, `backup_emails`, `email_codes`, `auth_tokens`, `devices`, `tokens`, `refresh_tokens`, `recovery`, `recovery_cancel_codes`, `approvals` and `device_waits`.
- Existing constraints include lowercased verified-email uniqueness, lowercased nickname uniqueness, phone uniqueness, provider subject primary key `(provider, sub)`, and unique `(user_id, provider)`.
- `account-rules.js` currently generates `u` + 24 random hex user IDs and uses scrypt password hashing. This is a migration compatibility constraint; it does not determine the future canonical ID or credential policy.
- `migrate.js` declares schema version `0033-org-request-document-metadata`, while the header of `schema.sql` still labels the file a 0.6.0-alpha.1 PoC schema. Reconcile schema provenance/version and inspect the actual applied migration ledger before any migration.
- Existing `identity-db.test.js` and `providers-db.test.js` define PostgreSQL integration coverage for local persistence, uniqueness and provider linking. Those tests are conditional on `DATABASE_URL`; their presence is not proof they ran in this session.
- Bounded current-main code searches for `identity_reservations`, `platform_accounts`, `canonical_user_id`, `identity_service` and `cross_platform_reservation` found no matching implementation. This does not make claims about inaccessible Propo systems.

**Refined conclusion:** InOne already has a persistent, product-local identity subsystem with meaningful uniqueness and provider-auth behavior. The missing architectural capability is an independent cross-platform Identity authority, canonical subject/identifier reservation registry, and durable cross-product provisioning/reconciliation. The migration must preserve local account projections and foreign-key relationships; do not move or delete `accounts` as the first step.

Additional migration/security risks IAM-19–IAM-22 are recorded in the Identity threat model, including product foreign-key breakage, local/canonical ID mapping, schema provenance drift and accidental memory-store startup.

## 2026-11-25 — Identity dependency graph and runtime audit

- Parsed the canonical InOne schema.sql: 55 tables; 26 tables contain 29 FK columns referencing accounts(user_id). The full mapping is in the Identity Phase 1 plan.
- Identified 10 additional identity/actor-like columns without a direct FK. They require explicit live-reference vs historical-snapshot vs tombstone policy; no automatic FK additions.
- Reviewed migration runner and integrity tests: SCHEMA_VERSION 0033; 32 markers/migrations from 0002 through 0033; test definitions assert marker/file parity, contiguous numbering and fresh/legacy upgrade behavior. No tests were executed.
- The actual schema_migrations ledger and live DB FK graph are not accessible from repository files and remain blocked pending authorized read-only database inspection.
- Reviewed production bootstrap: normal CLI path always creates/passes PostgreSQL pool. However exported startServer accepts null pool and server falls back to memory store; production config does not currently force pool presence at that exported boundary. This is a hardening issue, not proof the CLI production path uses memory. Created ID-09 #150 for fail-closed guard/test, FK policy, DB verification and schema provenance comment.
- No Beta 1 source, SQL schema, PR #135, database, secrets or production settings were changed. No test/build/DB execution performed.
- Identity schema/API freeze remains NOT READY: owner decisions in B2-ADR-001 and Propo contract are still open.
