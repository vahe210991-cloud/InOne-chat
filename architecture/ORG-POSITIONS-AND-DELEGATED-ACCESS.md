# InOne Business — organization positions and delegated access model

**Version:** 0.1  
**Status:** Owner-approved structural baseline; detailed permission matrix is the next design artifact  
**Owner decision date:** 2026-11-13  
**Scope:** Seller organization workspace for one Propo Seller Account

## 1. Approved decisions

The owner approved the seven-level position hierarchy, Observer/Auditor as a separate non-hierarchical access profile, multiple owners per organization, and additional positions created by an owner and assigned/delegated down the hierarchy.

This document records the approved structure. It does not claim that the hierarchy or permissions have been implemented in application code.

## 2. Seven-level position hierarchy

| Level | Position | Organizational authority |
|---|---|---|
| 1 | Owner | Highest organization authority; controls ownership, organization-wide policy and delegation |
| 2 | Internet Store Director | Runs the store as a whole within authority delegated by owners |
| 3 | Deputy Director | Coordinates operations and supervises department heads within delegated scope |
| 4 | Department Head | Leads one assigned function/department; peer department heads are at the same level |
| 5 | Senior Specialist / Team Lead | Coordinates a team and checks its work within the assigned department |
| 6 | Specialist | Performs professional operations within granted functional permissions |
| 7 | Operator / Assistant | Performs limited routine operations within explicitly granted permissions |

### Level 4 functional departments

These are parallel departments at the same hierarchy level, not ranks above one another:
- Sales
- Warehouse and inventory
- Logistics and delivery
- Customer service
- Marketing and advertising
- Procurement
- Assortment/category management
- Product catalog and content
- Finance
- Analytics

A business may combine departments or leave some positions unfilled. The list is a recommended organization template, not a requirement to employ one person per department.

## 3. Three separate authorization dimensions

Do not collapse these concepts into one role field:

1. **Position** — hierarchy level and reporting relationship.
2. **Functional role** — work domain (sales, warehouse, support, marketing, finance, catalog, analytics, etc.).
3. **Permissions** — atomic allowed actions on specific resources.

A membership may have one position, one or more functional assignments, and an explicit permission set. These values are organization-scoped. The same person may hold different positions and permissions in different organizations.

Position rank alone must not grant every permission in a department. For example, a department head receives authority over their department's workflows and people only to the extent explicitly delegated.

## 4. Core permission domains

The detailed action-level matrix is a follow-up artifact. The initial permission catalogue must cover at least:
- Organization and employee administration
- Positions, functional assignments and delegation
- Product catalog, listings, prices and stock
- Orders, returns, cancellations and fulfilment
- Sales and customer records
- Warehouse, inventory and stock movements
- Logistics and delivery
- Buyer conversations and customer support
- Marketing, campaigns and organization publications
- Procurement and suppliers
- Finance, payouts, wallet and financial reports
- Analytics and exports
- Internal tasks, Kanban, CRM, Leads and Deals
- Propo integration and connection settings
- Audit log and sensitive-data access

Financial actions, payouts, bank details, ownership changes, seller-account linking, exports and destructive operations must be treated as sensitive permissions and explicitly granted. A title must never silently imply those permissions.

## 5. Delegation and hierarchy rules

- A member may administer access only when they have the explicit organization.access.manage capability and a valid delegation scope.
- An actor may change access only for target members strictly below the actor's position level. Equal-level and higher-level members are outside the actor's authority.
- A department head's default people-management scope is their own department. Cross-department authority requires an explicit additional scope delegated by a higher authority.
- The actor cannot grant a position, permission, scope or delegation ceiling that exceeds the actor's own authority.
- The actor cannot elevate themselves, alter their own position, or use an intermediate custom role to bypass the hierarchy.
- Custom positions are created by an owner. Assignment is delegated down the hierarchy, subject to the assigning actor's authority ceiling and target-level restrictions.
- A custom position must declare its hierarchy level, reporting parent/scope, functional domain (if any), permission template, and which permissions may be further delegated.
- Changes take effect server-side; hiding a UI control is not authorization.
- Every invitation, assignment, permission change, delegation, revocation and failed privileged attempt is audited with actor, target, organization, before/after state, timestamp and reason where supplied.

### Multiple owners

Multiple owners are permitted and occupy the same highest authority level. They are peers; one owner cannot use the ordinary lower-level delegation path to modify another owner's access. Ownership transfer, owner removal and last-owner safeguards require a separate explicit ownership-management flow and audit. The existing implementation's last-owner protection must be preserved until a stronger owner-approved process replaces it.

## 6. Observer / Auditor — separate profile

Observer/Auditor is not Level 8 and is not a subordinate position. It is a separately assigned read-only access profile with explicit scope.
- It grants no write, assignment, approval, publishing, payout or membership-management capabilities by default.
- Its visibility is limited to explicitly selected departments, reports, resources and audit records.
- It does not bypass organization membership, private conversation membership, Propo data scope or personal-data restrictions.
- Any exceptional export or sensitive-data access requires a separate explicit permission and audit.

## 7. Existing role compatibility

The existing engine uses organization roles owner, admin, member. Preserve them as a compatibility/migration baseline; do not map them mechanically to all seven positions.

The current POC implementation allows multiple owners, owner-only role changes, and limited admin/member behavior. It does not yet implement this seven-level hierarchy or delegated access model. A migration design must map existing memberships deliberately and preserve existing security guarantees, including last-owner protection and organization scoping.

## 8. Initial role-to-position mapping proposal for migration

This is a compatibility proposal, not an automatic migration instruction:

| Existing role | Safe interpretation before migration |
|---|---|
| owner | Owner position (Level 1) |
| admin | Existing administrator capability bundle; position must be explicitly assigned during migration rather than guessed |
| member | Existing member access; position must be explicitly assigned during migration rather than guessed |

Do not infer a person's department, reporting line, or position from admin or member alone.

## 9. Security invariants

- All access checks include person, active organization membership, position, explicit permissions, delegation ceiling, resource scope and operation.
- Organization A membership grants no rights in Organization B.
- Platform-level administrative roles remain separate from organization roles.
- A person cannot self-elevate or grant rights to a peer/superior.
- Propo remains the system of record for marketplace-owned entities unless an approved API contract says otherwise; InOne Business permissions govern which organization employees may act through the integration.
- Buyer conversations, personal chats and internal Business conversations remain separate authorization domains.

## 10. Next design gate

Before implementation, produce and obtain owner approval for an action-level permission matrix for each module, exact delegation ceilings by position and department, approval/dual-control rules for sensitive financial and ownership actions, migration mapping for existing owner/admin/member memberships, and rules for combining functional domains in custom positions.

No application code, database schema or production permission behavior is changed by this specification alone.
