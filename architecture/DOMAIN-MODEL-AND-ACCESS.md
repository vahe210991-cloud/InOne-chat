# Domain model and organization access

**Version:** 0.1  
**Status:** Conceptual model informed by the existing organization implementation and owner decisions; detailed Business permission matrix remains to be finalized

## 1. Core entities

### Person and identity
- `Person`: human actor.
- `Identity`: stable account subject used for authentication and cross-product mapping.
- `Credential`: password, passkey, provider credential or other authentication factor.
- `Device`: registered device and its trust/security state.
- `Session`: authenticated session with explicit product context.

The exact canonical identity service and subject format are open. A phone number, email, username or Propo seller ID must not be treated as an immutable primary key.

### Organization
- `Organization`: company/store team workspace in InOne Business.
- `OrganizationMembership`: organization-scoped link between a person and organization, with status, membership dates, role and/or delegated permissions. A person may have many memberships.
- `OrganizationRole`: role assigned to a membership, never a single global role on the person. Different memberships may carry different roles/permissions.
- `Permission`: atomic capability such as `organization.profile.update`.
- `RolePermission`: mapping from role to permissions.
- `MembershipInvitation`: invitation and acceptance lifecycle.
- `OrganizationAuditEvent`: record of sensitive changes.

### Propo connection
- `SellerAccountConnection`: one-to-one mapping between a Business organization and a Propo Seller Account in the initial release. Enforce uniqueness on both `organization_id` and the external Propo Seller Account ID.
- `ExternalResourceReference`: stable reference to a Propo-owned listing, order, buyer conversation, review or store.
- `IntegrationEventReceipt`: durable idempotent receipt for Propo events.
- `IntegrationOutboxMessage`: outbound Business-to-Propo command/event, if the contract supports it.

Owner decision A1: the initial mapping is one-to-one — one organization has exactly one Seller Account, and one Seller Account maps to exactly one organization. Multi-store/multi-account organization support is not in v1.

### Work and communication
- `Workspace`: a work context inside an organization.
- `Conversation`: a conversation with explicit type and owner.
- `ConversationMember`: membership and access.
- `Thread`: a discussion branch linked to a parent conversation/message or business object.
- `Message`: content and metadata, governed by the conversation's security model.
- `Task`: assigned work with status, due date and ownership.
- `TaskParticipant`: creator, executor, observer or other approved responsibility.
- `Attachment`: metadata and object-storage reference.

### Business modules
- `Lead`, `Deal`, `Customer`, `Pipeline` — CRM domain; definitions and lifecycle TBD.
- `KanbanBoard`, `KanbanColumn`, `Card` — workflow domain.
- `AnalyticsMetric`, `ReportDefinition`, `MetricSnapshot` — reporting domain.
- `WalletAccount`, `WalletTransaction` — only after financial ownership, accounting meaning and Propo contract are approved.
- `Flag` — intentionally undefined until the owner defines what a flag represents.

### Content
- `Profile`: personal profile in InOne.
- `OrganizationProfile`: organization-facing profile in InOne Business and/or Propo, ownership TBD.
- `Publication`, `Story`, `Status`: content records with explicit owner, audience and lifecycle.
- Personal and organization content must not share an implicit permission model.

## 2. Authorization model

Recommended model: **RBAC with organization scoping**, with the ability to add resource attributes/ABAC conditions when required.

Every request that acts on organization data must be authorized against:
- authenticated person;
- active organization;
- membership status;
- role and explicit permissions;
- resource ownership and visibility;
- operation and current state;
- Propo Seller Account/store scope where relevant.

A valid login is not proof of organization membership. Membership in Organization A grants no rights in Organization B. A valid membership is not proof of authority to manage other members. UI visibility is not a security boundary.

### Membership and delegation rules approved by the owner

- One organization may contain many employees; one person may belong to several organizations simultaneously.
- Role and permissions are evaluated independently for each `(person, organization)` membership.
- Access-management operations require explicit delegation. The actor may change only the access of members strictly below the actor's own position/authority level; equal or higher-level members are out of scope.
- The actor cannot grant a target permissions or authority exceeding the actor's own delegation ceiling. Self-elevation and privilege escalation through role assignment must be denied server-side.
- Keep platform-level roles separate from organization-level roles.
- Existing implementation baseline is `owner`, `admin`, `member`. This baseline is not a reason to invent a new catalogue; preserve its semantics while specifying the owner-approved delegation extension.

### Example permission namespace

Illustrative names only:
- `organization.profile.read`
- `organization.profile.update`
- `organization.members.read`
- `organization.members.invite`
- `organization.members.remove`
- `organization.roles.manage`
- `organization.content.publish`
- `business.inbox.read`
- `business.inbox.reply`
- `marketplace.listing.read`
- `marketplace.listing.update`
- `marketplace.orders.read`
- `marketplace.orders.manage`
- `analytics.sales.read`
- `crm.leads.manage`
- `crm.deals.manage`
- `kanban.board.manage`
- `wallet.read`
- `wallet.transfer` (do not enable without explicit financial policy)
- `audit.read`

Do not implement these exact permissions until the owner approves a role/permission matrix.

## 3. Existing role baseline and extension rules

The existing engine implementation defines three organization roles: `owner`, `admin`, and `member`. The API and tests establish these current behaviors:

- `owner` can add members with an explicit role and change an existing member's role; multiple owners are permitted, but the last owner cannot be demoted or removed.
- `admin` can add/remove ordinary `member` accounts and manage organization settings/links; the admin cannot promote members or change roles in the current implementation.
- `member` can access member-level organization resources but cannot manage membership or read the administrative log.
- Platform `owner`/`admin` roles are a separate authorization domain and must not be confused with organization roles.

The owner wants access delegation to follow the organization's authority chain: a member with the relevant delegation may manage only members below their own level. The current implementation's owner-only role-change endpoint is narrower than this requirement; it must not be described as already implementing the full delegation hierarchy.

Do not add a speculative Store Manager/Sales/Marketing/Support/Analyst role catalogue. First map the current roles and capabilities, then obtain owner approval for any additions or custom roles.

## 4. Owner and profile permissions

The owner explicitly stated that owner rights include editing the organization profile. Organization publications, news feed, stories and statuses are also part of the InOne Business direction.

Still to clarify:
- whether all members can create content or only selected roles;
- whether publishing requires approval;
- whether organization content is shown on Propo, InOne Business, or both;
- who can edit/delete content created by another member;
- whether an owner can delegate profile editing;
- whether there can be several owners or only one.

## 5. Multi-organization and employee lifecycle

**Owner decision:** a person may belong to multiple organizations. This is already supported by the existing `org_members` relation, whose composite primary key is `(org_id, user_id)`, and by `GET /orgs/mine` returning the current user's memberships. Preserve this behavior. The role is scoped to each membership; never hardcode one global organization role on the person account.

Membership lifecycle should eventually define:
- invited;
- pending acceptance;
- active;
- suspended;
- removed;
- expired.

Every membership change must be audited. Removing an employee must revoke access to the organization's future data immediately according to policy and define what happens to historical messages, tasks and files. Do not silently delete business records owned by the organization.

## 6. Audit and privileged operations

Audit at least:
- role and permission changes;
- member invitation/removal/suspension;
- seller account connection/disconnection;
- organization profile changes;
- financial actions;
- export/download of sensitive data;
- administrative access;
- security and recovery events.

Audit logs must be append-only from the application's perspective, scoped and access-controlled, and must not contain passwords, OTP codes, tokens or plaintext cryptographic key material.


### Existing implementation references reviewed (main)

- `inone-engine-poc-0.6.0/migrations/0020-organizations.sql`: composite primary key `(org_id, user_id)` and organization-scoped role column constrained to `owner`, `admin`, `member`.
- `inone-engine-poc-0.6.0/src/store.js`: `listUserOrgs(userId)` returns each membership and its role.
- `inone-engine-poc-0.6.0/src/server.js`: `GET /orgs/mine`, member add/remove and role-change routes.
- `inone-engine-poc-0.6.0/ORG_API.md`, `test/org-management.test.js`, `test/admin-journal.test.js`: current API and authorization behavior.


## 7. Owner-approved position hierarchy (2026-11-13)

The owner approved the seven-level InOne Business hierarchy and separate Observer/Auditor profile. The authoritative structural specification is [ORG-POSITIONS-AND-DELEGATED-ACCESS.md](ORG-POSITIONS-AND-DELEGATED-ACCESS.md).

Key model requirements:
- Position, functional assignment and atomic permission set are separate fields/concepts.
- Positions are organization-scoped; a person may hold different positions in different organizations.
- Multiple owners are allowed and are peers at the top level.
- Custom positions are created by an owner and assigned down the hierarchy under delegation ceilings.
- Observer/Auditor is a separate read-only profile with explicit resource scope, not a lower hierarchy rank.
- Existing owner/admin/member roles remain a compatibility baseline and must not be mechanically mapped to unverified positions.
- The current POC does not implement the approved seven-level hierarchy or general delegated role changes.

The action-level permission matrix, department-specific delegation ceilings, sensitive-action approval policy and migration mapping remain to be approved before implementation.


## 8. Owner-approved permission matrix v1 (2026-11-13)

The owner approved the position-based permission matrix without remarks. Critical financial operations require two-stage approval; transaction limits are configurable by the owner per position and employee; department heads are scoped to their own department by default. The authoritative policy baseline is [PERMISSION-MATRIX-V1.md](PERMISSION-MATRIX-V1.md).

The matrix is a policy baseline for backend design, not implemented behavior. Position, functional assignment, atomic permission, resource scope, delegation ceiling and transaction approval policy must remain distinct authorization dimensions. Existing owner/admin/member memberships must be migrated explicitly; admin/member do not imply a specific new position or financial authority.
