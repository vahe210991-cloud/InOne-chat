# Open decisions for the owner

**Version:** 0.1  
**Status:** Blocking questions register  
**Rule:** Until answered, the related design remains a proposal. Do not fill gaps by assumption.

The questions below are intentionally specific. They are the minimum set needed to freeze the first system architecture without inventing Propo behavior.

## A. Propo Seller Account and organization model

1. **DECIDED — Option A.** One Propo Seller Account corresponds to exactly one InOne Business organization. One organization does not manage multiple Seller Accounts/stores in the first release. Option B is not in the initial scope. The model should avoid unnecessary multi-store complexity while not making future expansion impossible.
2. One organization can have multiple employees (owner-confirmed). How are those employees represented in Propo: separate Propo user identities/logins linked to one Seller Account, or shared seller credentials? This integration detail remains open.
3. **DECIDED:** one person may belong to several organizations at the same time and may have different roles/permissions in each. This is already supported by the existing InOne organization-membership model; preserve it.
4. Who is the canonical owner of the organization/store profile: Propo, InOne Business, or field-by-field ownership?
5. Can an organization exist in InOne Business before it has a Propo Seller Account, or must it be provisioned from Propo first?

## B. Identity and authentication

6. Should InOne, InOne Business and Propo use one common person identity/login, with product-specific sessions and permissions?
7. Does Propo already have a stable immutable Seller Account ID and a stable user/person ID for each employee? If yes, what are the names and semantics?
8. Should a Propo employee be able to open InOne Business automatically after Propo login, or must they explicitly link/activate the account?
9. Is InOne personal profile the same identity as the employee identity, or should users be able to keep personal and professional identities/profile visibility separate?

## C. Organization roles and permissions

10. **DECIDED:** preserve existing `owner`, `admin`, `member` as a compatibility baseline; InOne Business adds the owner-approved seven-level position hierarchy, separate functional roles and atomic permissions. Additional positions are created by an owner and assigned/delegated down the hierarchy. See [organization positions and delegated access](ORG-POSITIONS-AND-DELEGATED-ACCESS.md).
11. **DECIDED:** multiple owners remain permitted. Owners are peers at the highest level; ordinary lower-level delegation cannot modify another owner's access. Ownership transfer/removal requires a separately specified audited flow.
12. Which exact actions are reserved to the owner: profile editing, employee invitations, role management, seller-account linking, Wallet/financial operations, content publishing, deletion?
13. Can employees publish organization posts/stories/statuses, or is that restricted to owner/admin/marketing roles?
14. Do content and permissions need an approval workflow before publishing or changing marketplace listings?

## D. Buyer communication and marketplace integration

15. Are buyer messages currently stored and handled in Propo, and does Propo expose an API/webhook/event stream for them?
16. Should employee replies in InOne Business be sent as the seller/store identity, with the employee identity recorded internally for audit?
17. Which marketplace events must arrive in Business first: new order, payment status, buyer message, review/rating, listing rejection, stock/status changes, delivery, refund?
18. Must notifications arrive in real time, or are bounded delays acceptable? What is the target (for example, seconds/minutes)?
19. Can InOne Business perform marketplace actions (edit listing, change price/stock, accept/cancel order), or is the first release read/notify/reply only?

## E. Business modules

20. What exactly is Wallet: Propo seller balance, payout account, transaction history, payment initiation, expense wallet, or a combination?
21. What does Flags mean in your business concept: feature flags, alerts/labels, operational statuses, risk flags, or something else?
22. Is CRM intended to manage Propo buyers/customers, leads generated outside Propo, or both?
23. Are Leads and Deals separate from Propo orders? What are their lifecycle stages?
24. Is Kanban for internal tasks, sales pipeline, listing launch workflow, or configurable boards for all these?
25. What are the first three calculations/analytics the owner/store manager must see?

## F. Personal and organization social content

26. Is InOne Business's news feed a private organization feed, a public store feed, or both?
27. Where are organization publications/stories/statuses displayed: Propo, InOne Business only, or shared to InOne with a clear organization identity?
28. Should personal InOne communities/channels be discoverable from InOne Business, or remain separate?
29. Can a person post as themselves in InOne Business, as an organization, or both with an explicit identity switch?

## G. Technical and operational choices

30. Should InOne and InOne Business ship as two separate App Store / Google Play applications with separate bundle IDs, or is "two separate apps" a product-level distinction with shared distribution still open?
31. Do you want a single backend codebase with isolated domain modules initially, or separate InOne and Business backend deployments from the first release?
32. Should InOne Business use the existing InOne identity service plan, or should Propo remain the identity authority for seller employees?
33. Which Propo API documentation, sandbox environment and technical contact can be used to define the integration contract?
34. Which countries/currencies are in the first release? Armenia is confirmed as Propo's marketplace market; the legal, privacy, tax and data residency requirements still need specialist confirmation.

## Suggested answer order

A1 and A3 are decided. A2 is partly decided (multiple employees per organization; Propo employee identity/linking remains open). Next, resolve A2/A4/A5, B6–B9 and C10–C14, then D15–D19. The detailed semantics of Wallet, Flags, CRM and analytics can then be specified as separate domain decisions. The detailed semantics of Wallet, Flags, CRM and analytics can then be specified as separate domain decisions.


## Recorded owner decision — A1 (2026-11-13)

- **Selected:** Option A — one Propo Seller Account maps to exactly one InOne Business organization.
- **Not in initial scope:** one InOne Business organization managing multiple Propo Seller Accounts/stores (Option B).
- **Implementation implication:** enforce a one-to-one SellerAccountConnection in the initial model and verify the mapping against Propo's stable Seller Account identifier. Do not assume anything about employee accounts, login sharing or Propo's internal data model; those remain open questions.
- **Future-proofing:** keep the integration boundary explicit so multi-store support can be added through a separately approved schema migration and product decision, without implementing it now.


## Recorded owner decisions — organization membership and access (2026-11-13)

- One InOne Business organization may have many employees.
- One person may belong to multiple organizations simultaneously.
- A person's role and permissions are attached to each organization membership, not globally to the person. The same person may have different authority in different organizations.
- Only a member with explicit authority to manage access may grant/change permissions. That member may manage only members below their own position/authority level; they may not change an equal or higher-level member's access or grant authority beyond their own delegation ceiling.
- Existing code baseline: organization roles `owner`, `admin`, `member`; role assignment is organization-scoped. Preserve these semantics as the starting point; extend only after the complete permission hierarchy is specified.
- Still open: Propo employee identity/login linkage; detailed action-level permission matrix, delegation ceilings by department, sensitive-action approval rules and migration mapping for existing roles.


## Recorded owner decision — InOne Business positions and hierarchy (2026-11-13)

The owner approved the seven-level hierarchy: Owner; Internet Store Director; Deputy Director; Department Head; Senior Specialist/Team Lead; Specialist; Operator/Assistant. Observer/Auditor is a separate non-hierarchical read-only profile. Multiple owners are permitted. Additional positions are created by an owner and assigned/delegated down the hierarchy. Position, functional role and atomic permissions are separate authorization dimensions. See [ORG-POSITIONS-AND-DELEGATED-ACCESS.md](ORG-POSITIONS-AND-DELEGATED-ACCESS.md). The owner approved Permission Matrix v1 on 2026-11-13: critical financial operations require two-stage approval; transaction limits are owner-configurable by position and employee; department heads are scoped to their own department by default. See [PERMISSION-MATRIX-V1.md](PERMISSION-MATRIX-V1.md). The next gate is detailed permission-code, approval-policy and migration design.



## Owner decision — Financial Policy v1 (2026-11-13)

**Status: APPROVED — approval model. Monetary limits remain OPEN.** The owner explicitly approved the proposed financial-control model with no remarks, while requiring monetary limits to be refined separately.

Approved baseline:
- Sensitive financial actions follow `initiator → independent approver → execution`.
- Initiator and approver must be different natural-person identities; self-approval is prohibited across sessions/devices/accounts and delegated contexts.
- Initiation and approval are separate atomic permissions. An approver must independently satisfy permission, organization membership, resource scope, delegation ceiling and applicable limit checks.
- If no eligible independent approver exists, execution is blocked; there is no implicit one-person bypass.
- Approval binds to an immutable transaction snapshot. A material change invalidates prior approval and requires a new approval decision.
- Approval state transitions and execution are idempotent, concurrency-safe and auditable.
- Observer/Auditor cannot initiate or approve financial operations by default.
- Missing or ambiguous limit configuration is deny/escalate, never unlimited.

Not approved / still open:
- Numeric thresholds, currencies and per-transaction/daily/weekly/monthly caps.
- Final operation-by-operation dual-approval catalogue and approver eligibility details.
- Approval expiry/quorum defaults and exact treatment of owner-initiated transactions.

The earlier illustrative monetary amounts are examples only and are not policy. This decision approves the control model, not implementation, migrations, API changes or production enforcement. No application code or database schema was changed.


## Owner decision — organization-configurable employee financial limits (2026-11-13)

**Status: APPROVED.** Monetary limits are not fixed globally by InOne and are not imposed as universal numeric defaults. Each InOne Business organization configures its own limits through the product interface. When the organization owner assigns or edits an employee's position/authority, the owner configures that employee's applicable financial limits as part of the assignment.

Requirements:
- Limits and policy settings are tenant-isolated; one organization's configuration never affects another organization.
- Limits are configured per employee membership/position assignment, not merely by a global position title. Employees with the same title may have different limits; the same person may have different limits in different organizations.
- The interface must allow the owner to configure limits by operation type (for example payout, refund, discount, procurement, inventory write-off), with per-transaction and optional cumulative period caps where applicable.
- Currency must be explicit for every monetary limit; no implicit currency conversion.
- Limit changes are versioned and audited (actor, employee, organization, operation, previous/new value, currency, effective time and reason where supplied).
- Missing or ambiguous limits do not mean unlimited authority; the operation is denied or escalated until configured.
- These configurable limits remain subordinate to the approved independent two-person approval model. An initiator cannot approve their own sensitive transaction.
- No universal numeric thresholds or default monetary values are to be hard-coded by InOne. The organization owner controls the organization's configuration through the UI, subject to permission and delegation rules.

This decision approves the product behavior and configuration model. UI screens, API, persistence schema and enforcement are not yet implemented by recording this decision.


## Owner decision — separate Financial authority block in employee assignment UI (2026-11-13)

**Status: APPROVED.** The employee position assignment/edit interface in InOne Business must contain a distinct block named **Financial authority**. In this block, the organization owner configures the individual employee's allowed financial operations and applicable limits, including per-transaction maximums, optional cumulative period caps and explicit currency. The block also displays/configures the second-approval requirement in accordance with the approved financial-control policy.

The configuration belongs to the employee's membership and assignment within that organization, not globally to the person or merely to the position title. Organization settings remain tenant-isolated. No universal numeric defaults are introduced. The block cannot disable mandatory independent two-person approval for sensitive operations. Changes are versioned and audited; missing or ambiguous limits deny/escalate.

This approves the interface requirement and policy behavior only. Screen design details, API, persistence schema and runtime enforcement remain to be designed and implemented separately. No application code or database schema was changed by this decision.


## Owner decision — central identity and paired product-account registration (2026-11-13)

**Status: OWNER-APPROVED PRODUCT DIRECTION; technical design draft.** Registration requires phone number and email. Identity stores both centrally; without SMS/email verification providers they remain unverified claims and must not be used alone for recovery, authentication or sensitive authorization.

Personal registration through InOne provisions an InOne personal account plus a reserved Propo personal account. Work registration through InOne Business provisions an InOne Business work account plus a reserved Propo work account. The paired Propo account is created immediately but cannot be used until first-device activation in Propo. Personal and work contexts are separate; one person may hold both pairs.

A separate InOne Identity service owns central identity/authentication/contact claims/device-session and product-account mapping. InOne, InOne Business and Propo retain separate backends and databases, local account principals and domain data. Work onboarding uses scoped invitations: explicit acceptance precedes provisioning/reuse of the work pair and activation of organization membership. Cross-product provisioning uses authenticated versioned APIs/events, idempotency, durable outbox/inbox, retries and reconciliation; no shared product database or direct cross-product SQL.

See [IDENTITY-AND-PRODUCT-ACCOUNT-LIFECYCLE-V0.1.md](IDENTITY-AND-PRODUCT-ACCOUNT-LIFECYCLE-V0.1.md). Open design items include unverified-contact conflicts/recovery, credential/MFA policy, device recovery, invitation timing and Propo's support for separate personal/work principals. No implementation is implied.
