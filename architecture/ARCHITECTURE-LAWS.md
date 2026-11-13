# Architecture laws — non-negotiable project rules

**Version:** 0.1  
**Status:** Proposed engineering laws; owner approval requested

These laws apply to all products, developers, contractors and AI agents.

## Law 1 — Product purpose stays explicit
Every screen, route, API operation, database entity and release item must identify its product owner: Propo, InOne Business, InOne, shared platform, or unresolved.

## Law 2 — Propo owns marketplace truth
Marketplace-owned listings, orders, buyer conversations, ratings and payment state remain authoritative in Propo unless Propo's owner explicitly assigns ownership elsewhere. InOne Business consumes approved contracts; it does not write directly to Propo's database.

## Law 3 — Organization access is tenant-scoped
Every business data request is scoped to an organization and, where relevant, a Propo Seller Account/store. No cross-organization access by default. The backend checks permissions on every operation.

## Law 4 — Person is not organization
Personal identity, personal profile, employee membership, organization profile and seller account are distinct concepts. Do not conflate them in schema or authorization.

## Law 5 — UI is not security
Hiding a button or route does not enforce access. Authorization is validated server-side for reads, writes, exports, subscriptions and background jobs.

## Law 6 — Integrations are contracts, not database shortcuts
Cross-product communication uses versioned APIs/events, authentication, schema validation, idempotency, retries, observability and reconciliation. No direct cross-product SQL or undocumented private endpoints.

## Law 7 — Events must be durable
Business-critical marketplace notifications must not disappear if a worker or receiving service is unavailable. Persist before acknowledging; retry safely; deduplicate by stable event identity; expose dead-letter/replay operations.

## Law 8 — No duplicate source of truth
Read models and analytics projections may be stored for speed, but their source and freshness must be declared. A derived copy is not the authority for the underlying marketplace transaction.

## Law 9 — Security fails closed
Authentication, authorization, encryption, key storage or integration validation failure must not silently downgrade to insecure behavior. No plaintext fallback for a message flow that requires end-to-end encryption.

## Law 10 — Conversation types are separate security domains
Personal chats, internal organization chats and buyer-to-seller marketplace conversations may share UI components, but they do not automatically share membership, retention, encryption, search or moderation rules.

## Law 11 — Financial data requires explicit semantics
Wallet, balances, payouts, refunds, commissions and transfers cannot be implemented from labels or UI mocks. Define source of truth, ledger model, currency, rounding, reconciliation, permissions and audit first.

## Law 12 — Start modular, split when justified
Prefer clear domain modules and explicit interfaces over premature microservices. Split deployables only when independent scaling, security, reliability, team ownership or release cadence justify it.

## Law 13 — API contracts precede client wiring
Every production client operation must map to a documented, versioned API contract, permission, error model and test. A route declaration is not proof of a working feature.

## Law 14 — No fake completion
Use PASS, FAIL, BLOCKED and NOT RUN accurately. Writing a test is not running it. A historical CI result applies only to its exact source SHA and test scope.

## Law 15 — Migrations are controlled
Every schema change has a migration, compatibility plan, backup/restore consideration and rollback or forward-fix strategy. Never edit production schema manually as the normal workflow.

## Law 16 — Observability is part of the feature
Production modules require structured logs, metrics, traces, actionable alerts and support diagnostics. Never log credentials, OTPs, tokens, private keys or plaintext secret material.

## Law 17 — Mobile clients are untrusted
All business rules and access decisions live on the backend. Protect tokens, use secure device storage where appropriate, validate deep links and do not expose secrets to WebViews or client logs.

## Law 18 — AI is an assistant, not an authority
AI-generated calculations, summaries and suggestions must show source data, time range and assumptions. AI cannot execute financial, publishing, permission or destructive actions without explicit authorization and an auditable confirmation.

## Law 19 — Preserve owner-approved design and decisions
Do not redesign or change an approved design system, product boundary, release scope or security decision without explicit owner approval. New owner decisions supersede older ones only when recorded.

## Law 20 — Every change is traceable
Meaningful changes map to a requirement, ADR, API contract, migration, test and release criterion. Keep architecture, decisions, development plan and session evidence synchronized.


## 12. Organization-scoped membership and delegated authority

A person may belong to many organizations. Their role and permissions are scoped to each membership; never reuse one organization's role in another. A member may manage access only when explicitly delegated, only for members strictly below their own authority level, and only up to the permissions they are allowed to delegate. Enforce this on the server for every change, prevent self-elevation and equal/higher-level changes, and audit actor, target, previous access, new access, organization and timestamp. Existing `owner`/`admin`/`member` rules are the compatibility baseline; do not claim the current owner-only role-change route already implements this broader hierarchy.
