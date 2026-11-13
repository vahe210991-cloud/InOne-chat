# InOne Business — backend authorization specification v0.1

**Status:** Draft technical specification derived from owner-approved Position Hierarchy and Permission Matrix v1  
**Date:** 2026-11-13  
**Branch:** architecture/product-and-platform-blueprint-2026-11-13  
**Scope:** Authorization, delegated administration, resource scope, financial limits, dual approval, audit and migration  
**Implementation status:** Documentation only. No application code, API behavior or database schema is changed by this document.

## 1. Purpose and normative language

This document translates the approved business policy into a backend design that can be reviewed before implementation. MUST, MUST NOT, SHOULD and MAY are normative requirements.

This is not a claim that the existing POC already implements the seven-level hierarchy, atomic permission catalogue, configurable limits or dual approval. The existing `owner/admin/member` model remains in place until a separately reviewed migration is implemented.

## 2. Authorization model

Authorization is evaluated for a specific person, organization, action and resource. Do not store a single global role on the person.

The effective authorization context is the intersection of:

1. authenticated person and active session;
2. active membership in the requested organization;
3. assigned position and its hierarchy level;
4. functional assignment(s), such as Finance or Warehouse;
5. explicit atomic permission grant;
6. resource scope (organization, department, team, assigned object);
7. delegation ceiling and grant provenance;
8. applicable amount/quantity/export limits;
9. resource state and workflow state;
10. approval policy, where the action is sensitive.

A position or matrix cell is a ceiling/default policy, not an unconditional grant. Deny by default. A missing grant, scope, limit or required policy configuration MUST NOT be interpreted as unlimited access.

### 2.1 Separate concepts

- **Membership:** person ↔ organization relationship and status.
- **Position:** hierarchy level and reporting placement.
- **Functional assignment:** department, team or operational function.
- **Permission grant:** atomic action allowed, optionally scoped and time-bounded.
- **Delegation:** authority to grant a constrained subset of permissions to another member.
- **Limit policy:** quantitative ceiling for an operation.
- **Approval policy:** independent control required before a sensitive operation is committed/released.
- **Observer/Auditor profile:** separate read-only profile with explicit resource scope; not hierarchy Level 8.

One membership may have one primary position and multiple functional assignments. If multiple positions are needed for a person, model the active authority context explicitly; do not merge permissions by taking the highest privilege. The initial implementation SHOULD enforce one active primary position per membership unless the owner approves a more complex model.

## 3. Atomic permission catalogue

Permission codes are stable machine identifiers. Display labels may be localized and changed independently. Resource scopes and limits are additional constraints, not suffixes that create an unbounded permission namespace.

### 3.1 Organization and access administration

| Permission code | Meaning | Sensitivity |
|---|---|---|
| `org.read` | Read organization profile/settings | Standard |
| `org.settings.update` | Update ordinary organization settings | High |
| `org.members.read` | Read membership directory | Standard |
| `org.members.invite` | Invite a person to the organization | High |
| `org.members.suspend` | Suspend membership | High |
| `org.members.remove` | Remove membership | High |
| `org.positions.read` | Read positions and assignments | Standard |
| `org.positions.create` | Create an owner-defined custom position | Critical |
| `org.positions.assign` | Assign a position within delegation ceiling | Critical |
| `org.access.read` | Read effective access and grants | High |
| `org.access.grant` | Grant a permission within actor's ceiling | Critical |
| `org.access.revoke` | Revoke a permission within actor's scope | High |
| `org.access.delegate` | Delegate a constrained authority ceiling | Critical |
| `org.ownership.manage` | Execute protected owner transfer/removal flow | Critical |

### 3.2 Catalog, inventory and commerce

| Permission code | Meaning |
|---|---|
| `catalog.products.read` | Read products/catalog |
| `catalog.products.create` | Create product |
| `catalog.products.update` | Edit product |
| `catalog.products.publish` | Publish/unpublish product |
| `catalog.products.archive` | Archive product |
| `catalog.prices.read` | Read prices |
| `catalog.prices.update` | Change price within configured limit |
| `catalog.discounts.create` | Create discount within configured limit |
| `catalog.discounts.approve` | Approve discount outside ordinary grant path |
| `inventory.read` | Read stock and inventory |
| `inventory.adjust.initiate` | Initiate stock adjustment/write-off |
| `inventory.adjust.approve` | Approve controlled stock adjustment |
| `procurement.read` | Read suppliers and procurement |
| `procurement.orders.create` | Create procurement order |
| `procurement.orders.approve` | Approve procurement order |

### 3.3 Orders, returns, sales, logistics and support

| Permission code | Meaning |
|---|---|
| `orders.read` | Read orders within scope |
| `orders.update` | Update allowed order fields/status |
| `orders.cancel` | Cancel order within policy |
| `orders.return.initiate` | Initiate return/refund |
| `orders.return.approve` | Approve controlled return/refund |
| `sales.read` | Read sales records |
| `sales.manage` | Manage sales workflow |
| `logistics.read` | Read delivery/logistics |
| `logistics.manage` | Assign/manage delivery workflow |
| `support.conversations.read` | Read buyer-support conversations within scope |
| `support.conversations.reply` | Reply to buyer-support conversations |
| `support.conversations.assign` | Assign support conversation |
| `customers.read` | Read customer data within scope |
| `customers.export` | Export customer data subject to export policy |

### 3.4 Marketing, CRM and internal work

| Permission code | Meaning |
|---|---|
| `marketing.campaigns.read` | Read campaigns |
| `marketing.campaigns.manage` | Create/edit campaigns |
| `marketing.campaigns.publish` | Publish campaigns |
| `crm.leads.read` | Read leads |
| `crm.leads.manage` | Create/update/assign leads |
| `crm.deals.read` | Read deals |
| `crm.deals.manage` | Create/update deals |
| `tasks.read` | Read tasks within scope |
| `tasks.create` | Create internal task |
| `tasks.assign` | Assign task within scope |
| `tasks.update` | Update assigned task |
| `tasks.close` | Close task subject to workflow |
| `discussions.read` | Read internal Business discussions within membership/scope |
| `discussions.write` | Create/reply to internal Business discussions |

### 3.5 Finance, analytics, integrations and audit

| Permission code | Meaning | Sensitivity |
|---|---|---|
| `finance.reports.read` | Read financial reports | High |
| `finance.transactions.read` | Read financial transactions | High |
| `finance.payout.initiate` | Initiate payout | Critical |
| `finance.payout.approve` | Approve payout | Critical |
| `finance.payout.release` | Release approved payout, if separate rail exists | Critical |
| `finance.bank_details.read` | Read masked bank details | Critical |
| `finance.bank_details.update` | Change bank/payment destination | Critical |
| `finance.refund.initiate` | Initiate refund | High/Critical by threshold |
| `finance.refund.approve` | Approve refund | Critical by policy |
| `finance.limits.read` | Read limits and thresholds | High |
| `finance.limits.manage` | Change limits/policy within authority | Critical |
| `analytics.read` | Read analytics within scope | Standard/High by dataset |
| `analytics.export` | Export analytics | High |
| `data.export.customer` | Bulk customer-data export | Critical |
| `data.export.finance` | Bulk financial-data export | Critical |
| `integration.propo.read` | Read Propo connection state | High |
| `integration.propo.manage` | Manage authorized integration settings | Critical |
| `audit.read` | Read audit records within scope | High |
| `audit.export` | Export audit records | Critical |

Catalogue is an initial namespace, not a complete endpoint-by-endpoint authorization map. Before implementation, every mutating/read endpoint must map to exactly one or more codes, with explicit resource and data classification. New codes require review; unknown codes deny.

## 4. Position, function and scope representation

### 4.1 Position levels

Use the approved levels exactly:
1. Owner
2. Internet Store Director
3. Deputy Director
4. Department Head
5. Senior Specialist / Team Lead
6. Specialist
7. Operator / Assistant

Observer/Auditor is a separate profile and cannot be compared numerically with hierarchy levels.

### 4.2 Functional assignments

Initial department/function keys SHOULD be stable identifiers:
`sales`, `warehouse`, `logistics`, `customer_service`, `marketing`, `procurement`, `assortment`, `catalog_content`, `finance`, `analytics`.

A membership can have multiple assignments only when explicitly approved. Each assignment has organization ID, department key, optional team ID, status and effective dates. Department Head default scope is the assigned department; Team Lead default scope is assigned team and department.

### 4.3 Resource scopes

Use explicit typed scopes, not arbitrary client-supplied filters:
- `organization`
- `department`
- `team`
- `assigned_records`
- `self`
- explicit resource IDs where justified

The server resolves the resource's organization/department/team from trusted persisted data. Never trust an org ID, department ID or owner ID supplied only in request body to establish access to the target resource.

## 5. Delegation and authority ceiling

A delegation is a bounded grant from one membership to another. It MUST record:
- organization;
- grantor membership;
- recipient membership;
- permission set;
- allowed resource scope;
- hierarchy ceiling/target-level range;
- quantitative limits and currency, if applicable;
- which delegated permissions may themselves be delegated;
- effective-from and optional expiry;
- status/revocation;
- reason and audit correlation.

Rules:
1. Grantor must hold `org.access.delegate` and the relevant `org.access.grant` capability.
2. Target member must be strictly below grantor's position level for ordinary hierarchy delegation.
3. Equal-level and higher-level members cannot be changed by this path. Owners are peers; owner transfer/removal is a separate protected workflow.
4. Grantor cannot grant a permission they do not hold or cannot delegate.
5. Grantor cannot widen scope, raise amount ceiling, extend expiry or increase hierarchy ceiling beyond their own authority.
6. Delegation chains cannot amplify authority. Effective grant is bounded by the intersection of every ancestor grant and current policy.
7. Revoking/expiring a parent delegation invalidates dependent grants. Cache invalidation must be immediate or fail closed.
8. Self-grant, self-promotion and cycles in reporting/delegation graphs are rejected.
9. A custom position is a template, not an authority bypass. Its permissions are intersected with grantor ceiling and target scope.
10. Multiple owner memberships remain peers; ordinary delegated management cannot modify another owner.

A delegated manager may grant a subset to a subordinate but may not delegate a permission marked non-delegable (for example ownership management, bank destination change, payout release) unless the owner-approved policy explicitly says otherwise.

## 6. Financial limits and dual approval

### 6.1 Limit model

A limit policy should support:
- permission/operation key;
- organization;
- position and optional employee override;
- department/resource scope;
- maximum per transaction;
- optional cumulative period cap (daily/weekly/monthly);
- currency (ISO 4217);
- effective-from/to;
- policy version;
- creator/approver and audit references.

An employee override can only narrow the applicable ceiling. If policy allows an owner to raise an employee limit, the new value must still be <= organization maximum and be separately audited. A delegated manager cannot raise a limit above their own ceiling. No implicit FX conversion; if cross-currency operations are needed, use a documented rate source, timestamp and rounding policy. Missing or ambiguous limits deny or escalate.

### 6.2 Dual-control transaction lifecycle

Recommended state machine:
`draft → pending_approval → approved → executing → completed`
with terminal alternatives `rejected`, `cancelled`, `expired`, `failed`.

- Initiator has `*.initiate` permission and passes scope/limit checks.
- Approval is a separate action and requires `*.approve` plus independent scope/limit eligibility.
- Initiator cannot approve their own transaction, even through another session/device or delegated identity.
- Approver must be a different authenticated person and must not be the initiator's same person/account subject.
- Approval binds to an immutable transaction snapshot/hash: amount, currency, destination/target, operation type and relevant metadata. Any material edit invalidates approvals and returns transaction to pending approval.
- Release/execution is impossible until the configured approval quorum is met.
- Approval is idempotent; repeated identical approval requests do not create extra approvals.
- Concurrent approvals/state transitions use optimistic versioning or row-level locking.
- Approval expiry, rejection, cancellation, policy change and execution failure are explicit audited transitions.
- A separate release permission may be required when payment provider execution is distinct from approval.
- No silent emergency bypass. If an emergency process is later approved, it must be narrowly scoped, time-bound, independently audited and subject to post-event review.

### 6.3 Policy catalogue remains to be finalized

The owner approved dual control for critical financial operations, but the exact covered operation list and approver eligibility are not fully decided. Proposed initial candidates for owner review:
- payout initiation/release;
- bank/payment destination changes;
- refunds above configurable threshold;
- high-value discounts/price adjustments;
- stock write-offs/adjustments above threshold;
- changes to financial limits/approval policies;
- bulk customer/financial exports;
- ownership transfer and Seller Account relinking.

Do not ship these thresholds as hard-coded assumptions. Define each operation's initiator roles, approver roles, amount ceilings, quorum, expiry and whether owner-level actions also require independent approval.

## 7. Suggested persistence model (logical, not migration SQL)

Names are illustrative; align with actual DB conventions after schema review.

| Entity | Key fields / purpose |
|---|---|
| `org_memberships` | org_id, user_id, status, joined_at, left_at; preserve existing membership identity |
| `org_positions` | id, org_id, code, title, level, parent_position_id, is_system, status |
| `org_functional_assignments` | id, org_id, membership_id, department_key, team_id, status, effective dates |
| `org_membership_positions` | membership_id, position_id, primary flag, effective dates; initially enforce one active primary |
| `permission_definitions` | code, description, sensitivity, delegable, version/status |
| `org_permission_grants` | id, org_id, membership_id, permission_code, scope_type, scope_id, grantor_membership_id, delegation_id, limits/policy reference, validity, revoked_at |
| `org_delegations` | id, org_id, grantor, recipient, ceiling, scope, validity, parent_delegation_id, status |
| `org_limit_policies` | id, org_id, operation_code, position/employee selector, amount, currency, period, version, effective dates |
| `org_approval_policies` | id, org_id, operation_code, threshold, quorum, eligible approver policy, expiry, version |
| `sensitive_transactions` | id, org_id, operation_code, initiator, immutable payload/hash, amount/currency, state, policy version, timestamps |
| `sensitive_transaction_approvals` | transaction_id, approver, decision, payload_hash, reason, timestamp; unique approver/transaction |
| `org_audit_events` | append-only actor/target/action/before-after/scope/policy/correlation metadata |

Important constraints:
- Foreign keys include organization identity wherever possible to prevent cross-tenant references.
- Unique active membership per (org_id,user_id), consistent with existing composite membership key.
- Unique active assignment constraints as appropriate.
- Grantor/recipient and referenced resources must belong to same organization.
- Use UTC timestamps and explicit currency codes.
- Avoid storing secrets/bank credentials in authorization tables; store provider token references in a dedicated secrets boundary.
- Sensitive transaction payloads should store only necessary data, encrypt sensitive fields and avoid duplicating full bank details in audit logs.
- Audit log append-only for application principals; corrections are compensating events, not updates/deletes.

## 8. Server-side policy evaluation contract

A central policy service/middleware should expose a conceptual operation:

`authorize(actor, org, action, resource, context) -> allow | deny | require_approval`

Evaluation order:
1. Authenticate actor/session; reject revoked/expired session.
2. Resolve resource from trusted storage and derive its owning organization/scope.
3. Verify active membership in that organization.
4. Load current position, functional assignments and active grants.
5. Check action permission exists and is active.
6. Check position/matrix ceiling and delegation chain.
7. Check resource scope (including private room/conversation membership where applicable).
8. Check quantitative limits and current policy version.
9. If sensitive operation, return a server-generated approval requirement; do not execute.
10. At execution time, re-evaluate all mutable conditions and transaction state.
11. Emit decision/audit event for privileged allows, denials and state transitions according to policy.

Response behavior:
- Use 403 for authenticated but unauthorized requests; 404 may be used to avoid disclosing existence of out-of-scope resources.
- Never return effective grants for another organization.
- Do not accept a client-provided `is_owner`, `role`, `permission`, `scope`, `limit` or `approved=true` as evidence.
- Cache only with a versioned authorization snapshot; revoke/invalidate on membership, grant, delegation, position or policy change. Sensitive operations should read current policy from authoritative storage.
- Denial reason returned to client should be safe and not reveal private resource existence.

## 9. API contract (proposed routes, not implemented)

All routes require authentication and organization context. Exact URL style should follow the existing server conventions after endpoint inventory.

- `GET /orgs/:orgId/access/me` — current user's effective access summary for that org.
- `GET /orgs/:orgId/members/:memberId/access` — inspect target access, gated by `org.access.read`.
- `POST /orgs/:orgId/members/:memberId/position` — assign/change position, gated by hierarchy and delegation.
- `POST /orgs/:orgId/members/:memberId/grants` — create constrained permission grant.
- `DELETE /orgs/:orgId/grants/:grantId` — revoke grant.
- `POST /orgs/:orgId/delegations` — create delegation.
- `DELETE /orgs/:orgId/delegations/:delegationId` — revoke delegation.
- `GET/PUT /orgs/:orgId/limits/:operationCode` — read/update limit policy, gated by explicit permission and approval policy.
- `GET/PUT /orgs/:orgId/approval-policies/:operationCode` — policy management; exact owner-only/dual-control rule to be specified.
- `POST /orgs/:orgId/sensitive-transactions` — initiate sensitive operation; server computes policy and snapshot.
- `POST /orgs/:orgId/sensitive-transactions/:id/approvals` — approve/reject as independent authorized actor.
- `GET /orgs/:orgId/audit` — filtered audit read with strict scope.

Use idempotency keys for create/invite/grant/delegation and sensitive transaction initiation. Use optimistic concurrency (ETag/version) for edits. All endpoints must be documented with action code, resource scope, sensitivity, idempotency and audit behavior.

## 10. Audit event contract

Minimum fields:
- event_id, event_type, occurred_at (UTC);
- organization_id;
- actor_person_id and actor_membership_id;
- target membership/person/resource ID where applicable;
- action/permission code;
- decision (allow/deny/require_approval);
- before/after snapshot or redacted diff;
- effective position, functional assignment and scope identifiers;
- delegation chain/grant IDs;
- policy and limit versions;
- transaction ID, amount, currency where relevant;
- reason/comment where required;
- request_id, correlation_id, idempotency_key;
- source session/device metadata, minimized to security need.

Never place passwords, access tokens, full bank credentials or unnecessary customer personal data in audit events. Access to audit records is itself permission-controlled and audited. Keep immutable event history and define retention/legal hold separately.

## 11. Migration from owner/admin/member

Migration MUST be staged and reversible before enforcement cutover.

1. Inventory all current organization routes, role checks, DB constraints, fixtures and tests.
2. Preserve `org_members(org_id,user_id)`, existing membership states and organization scoping.
3. Map existing `owner` to Owner position only where the current owner semantics are valid.
4. Do NOT auto-map `admin` to Director/Deputy/Department Head; do NOT auto-map `member` to a specific position. Require owner/authorized admin-assisted explicit assignment or a reviewed organization migration plan.
5. Preserve multiple owners and current last-owner protections.
6. Preserve current admin/member compatibility behavior behind a versioned adapter during rollout; do not silently broaden admin rights.
7. Backfill positions/assignments/grants in shadow mode and compare old-vs-new decisions.
8. Resolve unmapped or ambiguous memberships before enforcement; fail closed for newly introduced sensitive operations.
9. Roll out by organization/feature flag with telemetry and rollback path.
10. Remove legacy role checks only after parity, migration completion, security review and owner approval.

Do not change platform-level admin/owner semantics while migrating organization permissions. Do not use InOne personal-chat membership or Propo Seller Account IDs as substitutes for Business membership identity.

## 12. Security and regression test matrix

| Area | Required test |
|---|---|
| Tenant isolation | Member of Org A cannot read/change Org B resources, even with guessed IDs |
| Membership | Suspended/removed membership loses access immediately |
| Multiple organizations | Different positions/grants in Org A and Org B do not leak |
| Hierarchy | Actor cannot manage equal-level or higher-level member |
| Delegation ceiling | Actor cannot grant permission/scope/limit they do not hold |
| Delegation chain | Revoked/expired parent delegation invalidates descendants |
| Self-elevation | User cannot grant self higher position or permission through alternate endpoint |
| Custom positions | Custom role cannot exceed creator's authority |
| Department scope | Department Head cannot access another department absent explicit grant |
| Team scope | Team Lead cannot access unassigned team records |
| Observer | Observer can read only explicitly scoped data and cannot mutate/approve |
| Financial limits | Above-limit action denied or escalated; missing config never means unlimited |
| Currency | Amount in another currency is not compared without explicit conversion policy |
| Dual approval | Initiator cannot approve own transaction |
| Dual approval | Approver lacking independent permission/scope/limit cannot approve |
| Dual approval | Payload change invalidates prior approval |
| Dual approval | Concurrent approvals/retries are idempotent and cannot release twice |
| Audit | Privileged grants, denials and approval transitions produce immutable audit records |
| Legacy compatibility | Existing owner/admin/member behavior remains unchanged until controlled cutover |
| Private conversations | Org admin does not gain private room access without room membership |
| Propo boundary | Business authorization does not mutate/read Propo-owned data outside authorized API contract |

Include property-based tests for delegation non-amplification and concurrent transaction state transitions. Add negative tests as first-class acceptance criteria.

## 13. Implementation sequence and gates

**Gate A — endpoint inventory:** enumerate every existing organization/business endpoint and map it to atomic action + resource scope. No code change until this map is reviewed.

**Gate B — detailed policy closure:** owner/product approval required for:
- exact critical-financial operation catalogue and thresholds;
- who may approve each operation (including owner transactions);
- whether all owners are independent approvers or some operations require an external/second owner;
- refund, discount, write-off, payout, export and bank-detail limit defaults;
- expiry/quorum and any emergency process;
- policy for custom position creation and who may delegate custom positions.

**Gate C — schema/API design:** prepare migrations, constraints, API schemas and rollback plan; review against existing DB and route conventions.

**Gate D — implementation:** feature-flagged policy service, audit, shadow evaluation, migration and endpoints.

**Gate E — acceptance:** security regression suite, cross-tenant tests, migration dry-run, observability and owner sign-off.

No production enforcement change or data migration is authorized by this document alone.

## 14. Open technical decisions (do not guess)

1. Stable Propo Seller Account ID and authoritative API/event contract.
2. Employee login/identity linking between Propo and InOne Business.
3. Exact operation catalogue requiring dual approval and approver eligibility.
4. Default monetary thresholds and currencies per sensitive operation.
5. Whether custom positions may be created only by owners (current approved baseline) or later delegated as a capability.
6. Whether membership can have more than one active position (initial recommendation: one primary position).
7. Required retention and privacy policy for audit and exports.
8. Whether approval policy changes themselves require two-person approval.
9. Exact permission codes for any module not yet in the endpoint inventory.

## 15. Current implementation truth

- Existing POC has `owner/admin/member`, multi-organization membership, owner-only role changes and last-owner protection.
- The seven-level position hierarchy, Observer/Auditor profile, atomic permission catalogue, delegation graph, configurable limits and two-person financial approval are specified here but are NOT implemented by this document.
- No DB migration, API route, middleware or application code has been changed.
