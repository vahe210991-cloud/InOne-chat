# Domain model and organization access

**Version:** 0.1  
**Status:** Conceptual model; role matrix is a proposal, not approved policy

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
- `OrganizationMembership`: link between a person and organization, with status and membership dates.
- `OrganizationRole`: named role within one organization.
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

A valid login is not proof of organization membership. Membership is not proof of owner authority. UI visibility is not a security boundary.

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

## 3. Candidate starter roles (proposal only)

| Role | Intended responsibility | Example permission direction |
|---|---|---|
| Owner | Legal/business owner; full organization control | Profile, members, roles, seller connection, financial controls, all modules |
| Organization admin | Day-to-day workspace administration | Members and settings, but ownership/financial transfer may be excluded |
| Store manager | Store operations | Orders, listings, team workflow and sales overview |
| Sales manager | Sales and customer pipeline | Buyer inbox, leads, deals, sales metrics |
| Content/marketing manager | Store content and campaigns | Listing content, banners, publications, stories |
| Customer support | Buyer conversations and service | Inbox, order context, customer support actions |
| Analyst | Reporting | Read-only approved analytics |
| Employee | Assigned operational work | Narrow task- and module-specific permissions |

This is not an approved final role catalogue. The owner must confirm whether these roles are needed, whether custom roles are allowed, and which permissions are financial/high-risk.

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

Design must support a person potentially belonging to more than one organization unless the owner decides otherwise. Do not hardcode a single global organization role into the person account.

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
