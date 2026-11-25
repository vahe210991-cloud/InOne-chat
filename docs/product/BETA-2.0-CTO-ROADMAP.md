# InOne Beta 2.0 — CTO roadmap and execution baseline

**Created:** 2026-11-24  
**Status:** CTO planning baseline; product-owner approval required for final release scope, sequencing beyond Identity, and delivery dates.  
**Branch:** `planning/beta-2.0-cto-2026-11-24`  
**Source baseline:** `main` at `02880940c1e4d8261405fbeaa01f40879eb44f3a`  
**Program rule:** Beta 2.0 is isolated from Beta 1.0 remediation. No Beta 1.0 code, API, UI, security gate, or release criterion is silently changed by this roadmap.

## 1. CTO executive assessment

Beta 2.0 is not a single feature increment. It is a product-platform expansion with two distinct applications and a shared identity foundation:

- **InOne:** personal/social application — feed, publications, direct messages, groups, Threads and community features.
- **InOne Business:** professional application — Kanban, CRM, leads, deals, wallet, flags and other work tools, with a separately versioned integration to Propo Seller Account.
- **Identity:** one independent, authoritative identity service supporting the approved InOne ↔ Propo cross-platform identity/identifier reservation requirement. Identity is a shared platform capability, not a combined application backend.

### CTO findings from repository review

1. **Identity is specified as a product requirement, not implemented as an independent service.** The current canonical Beta 1 backend has local email/nickname normalization and validation rules and local registration/auth/recovery handlers. The reviewed source does not establish a separately deployable Identity Service, a canonical cross-platform identity database, or atomic cross-product identifier reservations.
2. **Existing identity decisions are sufficiently strong to begin discovery and architecture.** They require canonical user identity, central uniqueness, ACTIVE/RESERVED platform accounts, durable provisioning, idempotency and fail-closed behavior when Identity is unavailable.
3. **Product boundaries are already approved.** InOne and InOne Business are separate products. Do not infer shared navigation, application backend, operational database or repository from their shared identity.
4. **Beta 2.0 feature inventory exists but is not a release commitment.** Group events/RSVP, polls, personal favorites, group search, permissioned bots and pinned messages are documented candidates. Tasks/Calendar, Cindy and Business capabilities have earlier product context but need their own requirements and release acceptance.
5. **The existing `planning/beta-2.0-roadmap` branch is stale.** It contains one roadmap-only commit but is 1,262 commits behind current `main` and diverged. It is preserved unchanged. This CTO roadmap is based on current `main` in a fresh branch to avoid basing new work on obsolete ancestry.
6. **Beta 1.0 remains a separate release program.** PR #135 is still a staged backend security-remediation track; its Stage 2 checkpoint is not accepted until exact-head checks pass. Beta 2.0 work must not claim or supersede Beta 1.0 acceptance.

This is a source/documentation audit, not a full code-level security certification. Runtime, production data, Propo internals, and physical-device behavior have not been independently tested as part of this planning pass.

## 2. Program principles and architecture guardrails

- Identity Service owns canonical person/account identity and global identifier reservations. It owns only the minimum identity/security data required for that purpose.
- InOne, InOne Business and Propo retain separate application backends and domain databases. No shared operational database is implied.
- A product may continue operating on its own domain data during another product's outage. Cross-product registration/activation must not claim success if the authoritative Identity transaction did not commit.
- If Identity is unavailable, operations requiring a new canonical identity or reservation fail closed with a retryable service error; no shadow/local account may be created as a substitute.
- Platform provisioning is asynchronous after the canonical identity transaction, using transactional outbox, idempotent consumers, retries, reconciliation and visible operation status.
- All APIs/events are versioned. All state-changing operations have idempotency/correlation IDs and explicit authorization.
- No plaintext messaging fallback; no bypass of the existing MLS/E2EE boundary. Identity tokens are not MLS keys and must never be used as such.
- No secrets, access tokens, recovery codes, private keys or message content in logs.
- Existing approved design system is immutable reference. Do not invent design tokens or replace approved UI without review.
- Do not move or globally rename the canonical Beta 1 Node backend or the Flutter-connected Rust MLS client. Respect the source-of-truth map and ADR-004.
- All acceptance is evidence-based on one exact source SHA. A queued workflow is not a pass. Physical-device requirements must be reported separately from CI.

## 3. Release workstreams and ownership

Role ownership below is a proposed responsibility map, not a claim that named GitHub users have been assigned.

| ID | Direction | Accountable role | Scope / key deliverables | Priority |
|---|---|---|---|---|
| B2-01 | **Identity platform** | Identity Architect + Backend Lead + AppSec | Canonical identity model, independent service/database, identifier registry, OIDC/API, cross-platform reservation, outbox/inbox, migration and security acceptance | P0 — first |
| B2-02 | InOne personal/social | Product Lead + Mobile Lead + Backend Lead | Feed, posts/publications, personal profile, direct chats, groups, Threads; product boundary and navigation audit; API/UI contracts | P1 |
| B2-03 | InOne Business | Business Product Lead + Backend Lead | Separate app shell, tenant/workspace model, CRM, leads, deals, Kanban, wallet, flags; integration boundary with Propo Seller Account | P1 |
| B2-04 | Group collaboration | Messaging Lead + AppSec + Mobile Lead | Events/RSVP, polls, personal favorites, group search, pinned messages, permissioned bots; MLS and membership-safe behavior | P1/P2 |
| B2-05 | Tasks and Calendar | Collaboration Lead + Product Lead | Creator/executor/observer roles, due dates, comments, attachments, CRM reference, calendar views, notifications and Cindy progress hooks | P1 |
| B2-06 | Cindy / AI assistant | AI Platform Lead + AppSec + Product Lead | Provider/model selection, tool permissions, file processing, business correspondence, archive, accounting/financial snapshots, audit and cost controls | P1/P2 |
| B2-07 | Localization and design system | Design Systems Lead + Mobile Lead | In-app language selection, HY/RU/EN baseline, future FR/DE/ES readiness, approved glass UI tokens, themes and icon variant architecture | P1 |
| B2-08 | Platform, data and integrations | Platform Lead + Data Architect | Independent service deployment, API gateway/service auth, database boundaries, event delivery, migration/reconciliation, Propo Seller integration contracts | P0/P1 |
| B2-09 | Security, privacy and compliance | AppSec Lead + Privacy Owner | Threat models, data classification, access reviews, abuse prevention, retention/deletion, audit trails, incident response and penetration testing | P0 |
| B2-10 | Quality, SRE and release engineering | QA Lead + SRE Lead | CI exact-SHA gates, integration/contract tests, load/fault tests, observability, backup/restore, rollback, staged rollout and release readiness | P0 |

## 4. Phased roadmap

No calendar delivery dates are committed in this document. Estimate each phase after scope and dependency discovery.

### Phase 0 — CTO discovery and architecture baseline
**Exit:** approved architecture decisions, bounded Beta 2.0 release scope, ownership map, threat models, API/data inventory, dependency graph and measurable acceptance criteria.

- Inventory current InOne screens, routes, repositories, database entities and services; classify each as InOne, InOne Business, shared platform or legacy.
- Inventory Propo integration touchpoints without assuming access to or ownership of Propo internals.
- Approve Identity service boundaries, identity/identifier semantics and migration strategy.
- Establish data classification, privacy/retention and service SLO objectives.
- Convert product candidates into user stories and release decisions.

### Phase 1 — Identity foundation (first implementation phase)
**Exit:** independent Identity Service can create one canonical identity, reserve identifiers atomically for multiple platforms, issue/verifiy tokens, and reconcile platform provisioning safely in test environments.

- Domain model and ADR.
- Authoritative Identity database with migrations and uniqueness constraints.
- Identifier normalization/verification/reservation registry.
- OIDC-compatible authentication and service-to-service integration contract.
- Platform account lifecycle: RESERVED, ACTIVE, SUSPENDED, CLOSED.
- Transactional outbox, idempotent consumers, retries and reconciliation.
- InOne adapter and Propo contract/sandbox adapter.
- Existing Beta 1 authentication migration plan; no destructive cutover before rollback and compatibility gates.
- Security, privacy, abuse, recovery, observability and failure-injection tests.

### Phase 2 — Product foundations and separation
**Exit:** separate InOne and InOne Business product shells, navigation, API ownership and domain-data boundaries are documented and contract-tested.

- Product-boundary audit of existing screens/API routes.
- Separate app navigation and permission models.
- Shared identity integration without shared domain database.
- Versioned API/event contracts and service authentication.
- Localization foundation and approved design-system integration.
- Tenant/workspace and organization boundary design for Business.

### Phase 3 — Core product capabilities
**Exit:** prioritized user journeys work end-to-end across mobile/backend, persist across devices and pass authorization tests.

- InOne personal/social foundations: profile, feed, posts, direct and group conversations, Threads.
- InOne Business foundation: CRM entities, leads, deals, Kanban and role/tenant authorization.
- Tasks and Calendar foundations, if approved for Beta 2.0.
- Device/session/account lifecycle remains coherent across both apps.

### Phase 4 — Group collaboration
**Exit:** each shipped capability has server-side permission enforcement, MLS-aware data handling, notification correctness, idempotency and multi-device acceptance.

Candidate sequence (not a release commitment):
1. Personal favorites and group pins (distinct personal/shared semantics).
2. Polls (single/multi choice, anonymous policy, closing/editing rules).
3. Group events and RSVP (timezone, edits/cancellation, notifications).
4. Group search (authorization re-check, redaction/deletion, retention and indexing).
5. Permissioned bots only after separate threat model, least-privilege scopes, sandboxing and abuse review.

### Phase 5 — Cindy / AI workflows
**Exit:** model/provider routing, tool permissions, user consent, file boundaries, data residency/retention and cost/abuse controls are accepted before enabling production tools.

- Provider/model selection and fallback policy.
- Tool registry and scoped grants; deny-by-default.
- File ingestion/scanning and data-loss controls.
- Correspondence drafting, archive, accounting and financial snapshot workflows.
- Human confirmation for consequential actions; auditable tool execution.
- No model/provider receives MLS keys or unrestricted plaintext store access.

### Phase 6 — UX maturity and extensibility
**Exit:** approved visual system and accessibility/performance checks pass; extension points are stable.

- In-app language selection: Armenian, Russian, English; prepare French, German, Spanish.
- Built-in and user-created chat themes with versioned/validated tokens.
- Alternate app icon catalogue and platform-specific switching support.
- Preserve approved InOne wordmark and glass design direction; exact tokens come from the approved design-system artifact.

### Phase 7 — Release hardening and Beta 2.0 acceptance
**Exit:** owner-approved scope is complete; all required checks pass on one immutable SHA; operational and security gates are evidenced.

- Full unit, API contract, integration, migration, authorization, abuse, load and fault-injection suites.
- Two-product identity flows, account recovery, cross-product reservations and outage reconciliation.
- Multi-device E2E for messaging/group features; no plaintext fallback.
- Backup/restore and disaster recovery drill.
- SLO dashboards, alerts, on-call and incident runbooks.
- Privacy/retention/deletion verification and independent security review.
- Staged rollout, feature flags, rollback rehearsal and owner sign-off.

## 5. Identity phase — detailed work breakdown

See [Identity Phase 1 execution plan](./BETA-2.0-IDENTITY-PHASE-1.md). Identity is the first active workstream and has its own issue epic and acceptance gate.

### Mandatory Identity invariants

1. One canonical `user_id` represents one person across participating platforms.
2. Identifier uniqueness and reservation are enforced centrally and atomically, not by a best-effort lookup followed by a separate insert.
3. Registration on either platform creates the canonical identity and reserves the corresponding identifier/platform slot on the other platform.
4. The platform where registration starts becomes ACTIVE; the other platform starts RESERVED/inactive until activation.
5. Identity commits are authoritative; downstream platform provisioning is asynchronous and recoverable.
6. Identity outage means retryable failure, not a locally successful shadow account.
7. Retries with the same idempotency key return the same operation/result.
8. Platform backends do not share operational databases or own the canonical identity record.
9. Existing Beta 1.0 sessions and accounts are not destructively migrated without a tested compatibility/rollback plan.
10. Cross-product identity does not automatically grant access to either product's domain data or Propo Seller Account.

## 6. Beta 2.0 definition of done

- Product scope and app boundaries are approved.
- Every workstream has an owner role, issue backlog, dependencies and acceptance criteria.
- Architecture decisions and data ownership are versioned in the repository.
- API/event schemas are versioned and contract-tested.
- Every write path has authentication, authorization, validation, idempotency and audit behavior.
- Data migrations are forward-tested, rollback/recovery strategy documented, and no destructive migration runs without explicit approval.
- Security and privacy threat models are reviewed before release.
- Exact-SHA CI is green; no acceptance is inferred from stale/queued runs.
- Production operations, backup/restore, alerting, incident and rollback runbooks are ready.
- Product owner explicitly approves the final Beta 2.0 scope and release.

## 7. Decisions still requiring product-owner approval

These are decision gates, not silently assumed implementation facts:

- Final Beta 2.0 must-ship list and which candidates move to Beta 2.1/3.0.
- Canonical identity identifier format and exact identity attributes/verification policy.
- Whether email, phone, username and provider subject are all globally unique across both products and Propo; alias/rename/release rules.
- Whether existing InOne accounts are migrated in place, linked, or re-verified; conflict/duplicate-account resolution.
- Propo Seller Account linkage semantics and whether a Seller account maps one-to-one or many-to-one to a canonical person.
- Account deletion, legal retention, recovery, suspension and appeal policy.
- Cindy's allowed data classes, providers, regions, retention, model/tool permissions and human-confirmation policy.
- Business wallet scope, money movement boundaries and any regulated/financial obligations.
- Delivery dates, staffing and operating SLOs.

## 8. Branch and change-control rules

- This roadmap branch is based on current `main`; the old `planning/beta-2.0-roadmap` branch is preserved and not force-updated.
- Beta 2.0 implementation must use dedicated feature branches and reviewable PRs targeting this planning/integration strategy as agreed.
- Do not merge this planning branch to `main` without explicit owner approval.
- Do not modify Beta 1.0 release scope, PR #135, protected settings, production secrets, production services or databases through this plan.
- Every meaningful stage updates the roadmap, issue status, evidence and session log.


## 9. GitHub execution backlog

The following tracking issues were opened from this roadmap. The role names in each issue are accountable functions; individual assignees remain unset until the project staffing roster is confirmed.

| Workstream | Tracking issue |
|---|---|
| Identity Service — Phase 1, P0 | [#137](https://github.com/vahe210991-cloud/InOne-chat/issues/137); discovery [#147](https://github.com/vahe210991-cloud/InOne-chat/issues/147); ADR/contracts [#148](https://github.com/vahe210991-cloud/InOne-chat/issues/148) |
| InOne personal/social product | [#138](https://github.com/vahe210991-cloud/InOne-chat/issues/138) |
| InOne Business / CRM | [#139](https://github.com/vahe210991-cloud/InOne-chat/issues/139) |
| Group collaboration | [#140](https://github.com/vahe210991-cloud/InOne-chat/issues/140) |
| Tasks and Calendar | [#141](https://github.com/vahe210991-cloud/InOne-chat/issues/141) |
| Cindy / AI assistant | [#142](https://github.com/vahe210991-cloud/InOne-chat/issues/142) |
| Localization, themes and app icons | [#143](https://github.com/vahe210991-cloud/InOne-chat/issues/143) |
| Platform architecture and Propo integration | [#144](https://github.com/vahe210991-cloud/InOne-chat/issues/144) |
| Security, privacy and abuse prevention | [#145](https://github.com/vahe210991-cloud/InOne-chat/issues/145) |
| Quality engineering, SRE and release | [#146](https://github.com/vahe210991-cloud/InOne-chat/issues/146) |

Identity is the first active execution item. Other workstreams are backlog tasks and must respect Identity contracts and product-owner release-scope approval.


## Identity Phase 1 execution update — 2026-11-25

- Discovery issue #147 has source-backed inventory of 55 schema tables, 26 tables / 29 direct account FKs, ten identity/actor-like non-FK fields, migration source status and production startup fallback finding.
- ADR/contracts task #148 remains open pending owner policy decisions and Propo contract.
- Follow-up P0 issue #150 tracks the remaining identity dependency graph classifications, actual DB-ledger verification, exact-SHA PostgreSQL migration tests, and production-only fail-closed startup guard/test.
- No product code or database migration has been performed. Identity remains NOT ACCEPTED; schema/API freeze is blocked on unresolved owner decisions and DB evidence.
