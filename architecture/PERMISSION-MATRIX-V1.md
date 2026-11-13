# InOne Business — approved permission matrix v1

**Version:** 1.0  
**Status:** Owner-approved baseline for backend specification  
**Approval date:** 2026-11-13  
**Scope:** One InOne Business organization linked to one Propo Seller Account in v1

## 1. Owner-approved decisions

The owner approved the proposed position-based matrix without remarks, with these rules:
- Critical financial operations use two-stage approval.
- Transaction limits are configurable by the owner for positions and individual employees.
- Department heads are scoped to their own department by default.
- The approved seven-level position hierarchy and separate Observer/Auditor profile remain in force.

Approval of this document authorizes detailed backend design. It does not mean the permissions have already been implemented in application code.

## 2. Position abbreviations

- **O** — Owner (Level 1)
- **D** — Internet Store Director (Level 2)
- **DD** — Deputy Director (Level 3)
- **DH** — Department Head (Level 4)
- **TL** — Senior Specialist / Team Lead (Level 5)
- **SP** — Specialist (Level 6)
- **OP** — Operator / Assistant (Level 7)
- **AUD** — Observer / Auditor (separate read-only profile)

## 3. Approved baseline matrix

The labels below are permission ceilings/default scopes, not unconditional grants. Every permission remains subject to functional assignment, department/resource scope, explicit delegation and any sensitive-operation policy.

| Module / domain | O | D | DD | DH | TL | SP | OP |
|---|---|---|---|---|---|---|---|
| Organization settings | Full | Delegated | Assigned | None by default | None | None | None |
| Employees and membership | Full | Manage within delegation | Delegated | Own department | Assigned team scope | Self/profile | None |
| Positions and access rights | Full | Delegated | Delegated | Delegated within department | None by default | None | None |
| Products and catalog | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Prices and discounts | Full | Explicit delegation | Explicit delegation | Own department, delegated | Assigned | Assigned | None by default |
| Orders | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Returns and cancellations | Full | Explicit delegation | Explicit delegation | Own department, delegated | Assigned | Assigned | Explicit delegation |
| Sales | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Warehouse and inventory | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Procurement | Full | Explicit delegation | Explicit delegation | Own department | Assigned | Assigned | None by default |
| Logistics and delivery | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Customers and support | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Marketing and advertising | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Financial reports | Full | Explicit delegation | Explicit delegation | Explicit delegation | None by default | None | None |
| Payouts and bank details | Explicit sensitive grant | Explicit sensitive grant | Explicit sensitive grant | None by default | None | None | None |
| Analytics | Full | Manage | Manage | Own department | Assigned | Assigned | None by default |
| CRM, Leads and Deals | Full | Manage | Manage | Own department | Assigned | Assigned | Assigned |
| Internal tasks | Full | Manage | Manage | Own department | Own team | Assigned | Assigned |
| Propo integration | Full | Explicit delegation | Explicit delegation | None by default | None | None | None |
| Audit log | Full | Explicit delegation | Explicit delegation | Explicit delegation | None by default | None | None |

**AUD:** read-only access only to explicitly selected reports, departments, resources and audit records. No write, approval, publishing, payout or membership-management permissions by default. AUD is not a hierarchy level.

## 4. Scope rules

- Owner authority is organization-wide, subject to protected ownership and financial workflows.
- Director and Deputy Director may exercise only permissions explicitly delegated to them by an owner.
- Department Heads are limited to their own department by default. Cross-department access requires a separate explicit scope grant.
- Team Leads are limited to their assigned team and department.
- Specialists and Operators are limited to assigned objects, tasks and operations within their functional assignment.
- No role or title grants access to another organization's data.
- Position, functional assignment, permission and resource scope are distinct. The same person may have different assignments in different organizations.

## 5. Sensitive actions and two-stage financial approval

The following actions require explicit permission and an approval policy, not merely a position title:
- initiating or releasing payouts and other critical money transfers;
- changing bank/payment destination details;
- refunds above an owner-configured threshold;
- high-value adjustments or write-offs;
- changing financial limits or approval policies;
- ownership changes and Seller Account relinking;
- bulk export of customer or financial data;
- destructive or irreversible organization-level actions.

For critical financial transactions:
1. An authorized employee initiates the transaction.
2. A second authorized person reviews and approves it.
3. The initiator cannot approve their own transaction.
4. The approver must independently hold the required approval permission and be within the configured amount/scope ceiling.
5. The system records initiator, approver, amount, currency, target, reason, timestamps, decision and transaction correlation ID.
6. Rejection, expiry, cancellation and replay attempts are audited.
7. The transaction is not released until the approval policy is satisfied.

The exact list of operations covered by dual control, approver eligibility and any emergency exception must be explicit configuration/policy. Do not assume that every director or every owner automatically has bank/payment credentials.

## 6. Configurable limits

The owner may configure limits by position and override them for an individual employee, subject to delegation ceiling. Examples:
- maximum refund amount per transaction and per period;
- maximum discount or price adjustment;
- maximum write-off/stock adjustment;
- maximum payout initiation or approval amount;
- maximum export size or data categories.

Rules:
- An employee override cannot exceed the position/organization ceiling.
- A delegated manager cannot increase a limit beyond their own authority.
- Currency must be explicit; no implicit cross-currency comparison.
- Threshold changes are versioned, audited and effective-dated.
- Transactions use the policy version active at initiation, with revalidation before release if policy requires it.
- Missing limit configuration means deny or require escalation for sensitive operations, never unlimited access.

## 7. Delegation constraints

- Access administration requires an explicit organization access-management permission and a valid scope.
- A member may manage only target members strictly below their own hierarchy level.
- Equal-level and higher-level members are not manageable through ordinary delegation.
- A grant cannot exceed the actor's permissions, scopes, amount limits or delegation ceiling.
- No self-elevation, self-approval or indirect privilege escalation through custom positions.
- Custom positions are created by an owner. Assignment may be delegated down the hierarchy; each custom position must declare level, reporting scope, functional domain, permissions and delegable permissions.
- Multiple owners are peers at the highest level. Owner removal/transfer uses a separate protected audited process.

## 8. Backend enforcement contract

Every protected request must be authorized server-side using at least:
- authenticated person and session;
- active organization membership;
- position and functional assignment;
- permission/action;
- resource and department scope;
- delegation ceiling and applicable limits;
- transaction state and approval policy, when relevant.

UI visibility is not a security control. Denied attempts on privileged operations should be auditable. Recheck authorization at the point of execution, not only when a form is opened.

## 9. Existing role migration

Existing organization roles owner/admin/member remain a compatibility baseline. Do not infer department, position level or financial authority from admin/member. Migration must explicitly assign position, functional domain, permissions and scopes, preserve last-owner protection and be tested before rollout.

## 10. Implementation gate

Before changing production authorization behavior:
1. translate this matrix into atomic permission codes and resource scopes;
2. define the exact critical-financial-operation catalogue and approver eligibility;
3. design position, assignment, delegation, limit and approval-policy storage;
4. map existing memberships safely;
5. implement server-side policy checks and audit events;
6. add tests for cross-organization isolation, peer/superior protection, delegation ceilings, amount limits, dual approval and self-approval rejection.

This is an approved policy baseline, not a claim of completed implementation.
