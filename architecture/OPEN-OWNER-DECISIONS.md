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

10. The existing implementation has the fixed organization roles `owner`, `admin`, `member`; use these as the compatibility baseline rather than replacing them with an invented catalogue. Should the new Business model add more predefined roles or custom organization-defined roles on top of this baseline?
11. The existing implementation permits multiple owners. Should that remain the rule for InOne Business, and what confirmation/audit process is required for ownership transfer?
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
- Still open: Propo employee identity/login linkage; whether additional fixed or custom roles are needed; detailed permission matrix and delegation rules for sensitive actions.
