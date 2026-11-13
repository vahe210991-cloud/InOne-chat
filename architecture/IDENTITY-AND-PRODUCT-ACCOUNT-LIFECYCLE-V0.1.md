# InOne Identity and product-account lifecycle v0.1

**Status:** Owner-approved product direction; technical design draft  
**Date:** 2026-11-13  
**Branch:** `architecture/product-and-platform-blueprint-2026-11-13`  
**Implementation status:** Documentation only. No identity service, product API, database, UI, invitation flow or device activation code is implemented by this decision.

## 1. Purpose and product boundary

This document records the owner-approved registration model for InOne, InOne Business and Propo. It separates a person's central identity from product-local accounts, credentials, devices and business memberships.

Products remain separate security and data domains:
- **InOne** — personal/social account and personal data.
- **InOne Business** — work account, organization memberships, positions, permissions and business workspace.
- **Propo** — marketplace account(s), seller/buyer activity and Propo-owned marketplace data.

A central **InOne Identity** service coordinates registration and identity linkage. It is not a shared product database and does not replace each product's backend or database.

## 2. Owner-approved registration rule

Every new registration MUST collect:
- a phone number;
- an email address.

The central Identity service stores both contact points. During the initial no-aggregator phase they are **unverified claims**, not proof that the registrant controls the phone number or mailbox. The system MUST NOT label them verified or use them alone for password recovery, account takeover, sensitive approvals or identity proof.

### 2.1 Owner-approved contact reservation — Option A

**Decision: APPROVED by the owner on 2026-11-13.** Phone and email are uniquely reserved across the central Identity service. Each normalized phone number and each normalized email address may have only one active claim.

The first successful registration reserves the normalized contact. A later registration attempting to use an already-reserved contact is blocked with a generic conflict response; the system must not disclose the existing account or claimant. The uniqueness check must be atomic and database-enforced to prevent simultaneous registrations from both succeeding.

Because contacts remain unverified while SMS/email delivery providers are unavailable, reservation is not proof that the registrant controls the contact. A person may reserve another person's contact first; this risk is explicitly accepted by the owner as part of Option A.

Conflicts are handled manually through a restricted support/security procedure. No automatic transfer, account merge or identity linking is allowed. An authorized operator may reassign/release a claim only after reviewing the case and recording the evidence considered, decision, actor/reviewer, affected identity/contact references, before/after state, reason and timestamps. If evidence is insufficient or ambiguous, keep the reservation unchanged and escalate. Never reveal the existing claimant's identity or full contact data to the requester.

Normalization must be consistent and conservative: phone numbers use E.164 where possible; email lookup normalization preserves the original display value and must not apply provider-specific transformations such as stripping dots or plus-tags.

A registration is initiated through one of two entry points:
1. Personal registration from InOne.
2. Work registration from InOne Business, normally through an organization invitation.

The entry point selects the account pair to provision. One registration does not automatically create every product account.

## 3. Product-account pair provisioning

### 3.1 Personal registration

A successful personal registration initiated in InOne creates:
- one central Identity person;
- one **InOne personal account**;
- one **Propo personal account reservation**.

The InOne personal account is the entry-point account and becomes active after successful first-device activation. The Propo personal account is created/reserved in Propo immediately, but remains `reserved` until the user activates/signs in to Propo on at least one device.

### 3.2 Work registration

A successful work registration initiated in InOne Business creates:
- one central Identity person;
- one **InOne Business work account**;
- one **Propo work account reservation**.

The InOne Business account becomes active after successful first-device activation and acceptance of the relevant organization invitation. The Propo work account is created/reserved immediately and remains `reserved` until first device activation in Propo.

A Propo personal account and a Propo work account are distinct product principals/account contexts. They MUST NOT be silently merged. Propo owns the marketplace-side account and seller/buyer records; the InOne products do not write directly into Propo's database.

### 3.3 Account matrix

| Registration entry point | Immediately provisioned | Entry-point account | Paired Propo account |
|---|---|---|---|
| InOne | InOne personal + Propo personal | Active after first-device activation | Reserved until first Propo device activation |
| InOne Business invitation/work flow | InOne Business work + Propo work | Active after invitation acceptance and first-device activation | Reserved until first Propo device activation |

The word **reserved** means the product-local account identifier/subject and unique linkage are provisioned so another registration cannot create a conflicting account for the same central identity/product account type. It does not mean the user can access that product.

## 4. Services and data ownership

### 4.1 Central InOne Identity service

Identity is the system of record for:
- immutable `identity_id` / person subject;
- required phone and email contact claims and their verification status;
- authentication credentials and credential lifecycle;
- product-account pair provisioning orchestration and mapping;
- invitation token validation metadata where appropriate;
- registered/trusted device identities and central session/token issuance;
- account security events, recovery state and identity-link audit.

Identity stores contact information and identity/authentication data only. It MUST NOT become the owner of chats, posts, listings, orders, CRM records, tasks, organization permissions or other product-domain data.

### 4.2 Product backends

Each product keeps its own backend and database:
- InOne backend stores the InOne product account, profile and social-domain data.
- InOne Business backend stores the Business product account, organization memberships, roles/positions, permissions and work-domain data.
- Propo backend stores Propo product accounts and marketplace-domain data.

Each product database stores a product-local immutable `product_account_id` and the central `identity_id` reference, account type/context, lifecycle status and provisioning metadata. Product backends MUST NOT copy central passwords or independently become credential authorities. Contact data should be fetched from Identity through authorized APIs only when needed; avoid uncontrolled copies.

No direct cross-product SQL or shared product database. Identity-to-product communication uses authenticated, versioned service APIs/events.

## 5. Provisioning lifecycle and reliability

Provisioning is a durable multi-service workflow, not a distributed database transaction.

Recommended lifecycle:
1. Validate registration request and required phone/email fields.
2. Create the central identity in a pending state and record contact claims as unverified.
3. Allocate idempotent provisioning command(s) for the selected account pair.
4. Create the entry-point product account and paired Propo account reservation.
5. Record each product's acknowledgement and immutable account IDs.
6. Mark the registration as `provisioned_pending_activation` only when both product records are confirmed.
7. Activate each product account independently when its activation conditions are met.

Requirements:
- Use transactional outbox/inbox, idempotency keys and unique constraints.
- Retries MUST reuse the same identity and product-account IDs; never create duplicates.
- Partial failure remains visible as `provisioning_pending` / `provisioning_failed_retryable`; do not tell the user that both accounts were created until both acknowledge.
- Provide reconciliation and safe replay for stuck provisioning.
- Use correlation IDs across Identity and product backends.
- Product account reservations are not deleted just because the paired product has not been used.
- Account closure/deletion and retention require a separate lifecycle policy; do not free phone/email claims or recycle product IDs automatically.

## 6. Device activation

A product account is activated independently per product. First successful sign-in/device enrollment in that product changes its local status from `reserved` to `active`. The central Identity service records the device and issues a product-scoped session/token.

Device activation proves that the authenticated identity has established a device session; it does **not** prove ownership of an unverified phone number or email address.

A reserved Propo account:
- exists and is linked to the central identity;
- blocks conflicting duplicate provisioning for that account type;
- cannot access marketplace functions until activated;
- may later be activated without creating a second account.

Sessions and tokens MUST be audience-scoped to the target product. A token for InOne MUST NOT automatically authorize InOne Business or Propo. Cross-product access requires an explicit Identity-issued product-scoped exchange/authorization flow and the target product's own authorization checks.

## 7. Organization invitation flow

Invitation remains the preferred work onboarding mechanism.

1. An authorized organization member creates an invitation with organization, intended work email and phone, intended position/department, expiry and invitation scope.
2. Invitation is stored as `pending`; it does not grant organization membership or business permissions.
3. The invitation is delivered manually (for example in person, by QR or through an existing external messenger) until email/SMS delivery providers are integrated.
4. The invitee opens the invitation, signs in to an existing central identity or completes the mandatory registration with phone and email.
5. The invitee explicitly accepts the invitation.
6. Identity coordinates provisioning of the InOne Business work account and Propo work account reservation. If those accounts already exist for this identity/context, the flow is idempotent and reuses them.
7. InOne Business creates/activates the organization membership with the approved position, functional assignment, grants and financial-authority configuration only after valid acceptance and authorization checks.
8. The InOne Business account becomes active after first-device activation. The Propo work account remains reserved until the user first activates Propo.

The invitation code is single-use, high-entropy, scoped to one organization/invitation, expires, is revocable and is stored hashed. Rate-limit attempts. Do not put permissions or personal data in a bearer URL.

### No-aggregator trust limitation

Until phone/email verification is available, an invitation code delivered manually demonstrates only possession of the invitation token. It does NOT independently prove legal identity, employment, phone ownership or mailbox ownership. The organization inviter is the trust anchor for the initial work membership. Sensitive permissions (especially financial initiation/approval, ownership changes, bank destination changes and bulk exports) require stronger authentication/verification policy before being enabled.

A pending invitation must not silently bind an existing account solely because its unverified phone/email strings match. The invitee must authenticate to the target Identity account and explicitly accept. If an invitation's contact claims conflict, route to a controlled owner/admin resolution process; do not auto-merge identities.

## 8. Contact uniqueness and no-provider phase

Phone and email are required and normalized for lookup/deduplication. Because they are unverified initially:
- store each as `unverified_claim` with capture time and source;
- enforce a uniqueness/claim policy centrally to prevent routine duplicate registrations, but distinguish a claimed value from a verified value;
- never use an unverified contact alone to sign in, recover credentials, link accounts, authorize a sensitive operation or notify a third party;
- do not reveal whether a phone/email is registered in public registration or recovery responses;
- provide a controlled dispute/recovery path for mistaken or malicious claims;
- retain audit history when contacts are changed; changing a contact does not silently transfer account ownership.

**Known risk:** without an SMS/email provider or another proof-of-control method, the platform cannot reliably establish that the first registrant owns the entered phone number or mailbox. A uniqueness reservation can reduce duplicate account creation but cannot prevent deliberate contact squatting or prove ownership. This risk must be visible in product/security acceptance criteria. The platform should not treat contact reservation as verified identity.

## 9. Authentication, recovery and security boundaries

- Credentials are held centrally by Identity; product backends trust short-lived, audience-restricted tokens and validate product membership/authorization locally.
- Identity credentials use the CTO v1 baseline: Argon2id password, passkeys preferred, optional TOTP and 10 one-time recovery codes. Recovery uses an enrolled passkey, fresh trusted-device step-up or recovery code; unverified contacts are never recovery factors. Recovery-code reset revokes all sessions and places a 24-hour hold on sensitive actions. If all authenticators/codes are lost, v1 has no manual reset override until independent identity proofing and two-person review are designed.
- No automatic account merge based on matching phone/email.
- Linking/unlinking accounts requires authentication to the relevant identities, explicit consent, conflict checks and immutable audit.
- Organization administrators can manage/reissue a work invitation or membership within delegated authority. They cannot reset a person's central credentials, take over a personal InOne account, read personal chats or recover the person's private data.
- Revoking a Business membership does not delete the person's Identity or personal InOne account.
- A user may have both a personal InOne/Propo pair and a separate work InOne Business/Propo pair. They are separate contexts even when the same human operates both. Do not assume one Propo account can serve both contexts.
- Security-sensitive actions require step-up authentication and, where policy requires, independent approval. Device activation alone is not a substitute for step-up authentication.

## 10. Notifications

Notifications are product- and context-scoped. Identity contact storage does not imply delivery capability. Before push/email/SMS providers exist, use in-app notification centers and already-enrolled product devices only. Personal and work notification preferences must remain separate. A work notification must not be sent to a personal contact merely because both are stored on the same identity.

## 11. Suggested logical data model

Names are illustrative and require schema review:
- Identity: `identities`, `identity_contacts` (type, normalized value, verification status, claim source, timestamps), `auth_credentials`, `identity_devices`, `identity_sessions`, `identity_security_events`.
- Product mapping: `product_account_links` (identity_id, product, account_context [personal/work], product_account_id, lifecycle status, provisioning idempotency key).
- Invitations: `organization_invitations` (org_id, inviter_membership_id, target contact claims, intended assignment, token_hash, status, expiry, accepted_identity_id).
- Each product DB: local product account table with unique product account ID, identity reference, context and lifecycle state.
- Provisioning: durable outbox/inbox records and correlation IDs.

Enforce unique constraints for `(identity_id, product, account_context)` where one account per context is the approved initial model. Also enforce one active claim per normalized phone number and one active claim per normalized email address globally, implementing the owner-approved Option A policy. Because contacts are unverified in the initial phase, conflicts use generic errors and a restricted manual dispute process; never auto-transfer, merge or link identities. Exact DDL, encrypted lookup/index design and operator workflow remain implementation design tasks.

## 12. Decisions and implementation gates

**Owner-approved product direction (2026-11-13):**
- Mandatory phone number and email at registration; store them centrally.
- Personal registration provisions InOne personal + Propo personal.
- Work registration/invitation provisions InOne Business work + Propo work.
- Paired Propo account is created/reserved immediately and remains inaccessible until first-device activation in Propo.
- Each product retains its own backend and database; central Identity is a separate service for identity/authentication and cross-product account mapping.
- Invitation-based work onboarding is retained.

**Still requires architecture/security closure before implementation:**
- Contact uniqueness is decided (Option A); the CTO recovery baseline is defined. Detailed support case operations, independent identity-proofing provider/evidence standards, contact release and dormant reservation policy still require threat-model and operational design.
- Device activation and trusted-device lifecycle, including device binding and revocation implementation.
- Whether invitation pre-provisions a placeholder before acceptance or provisions the pair only on acceptance (this draft recommends acceptance-triggered provisioning; invite record itself is pending before acceptance).
- Exact Propo account-context API contract and whether Propo supports separate personal/work principals.
- Identity API/event schemas, token exchange, service-to-service authentication and threat model.
- Retention/deletion, account closure, dormant reservations and contact release policy.

No implementation, migration, API route, UI or deployment is authorized or implied by recording this product decision.


## 13. Detailed Identity technical architecture

The implementation-level proposal is maintained in two companion documents:
- [IDENTITY-SERVICE-ARCHITECTURE-V0.1.md](IDENTITY-SERVICE-ARCHITECTURE-V0.1.md) — service boundaries, OIDC, credentials, contact claims, sessions/devices, provisioning saga, database model, security and implementation sequence.
- [IDENTITY-API-AND-EVENT-CONTRACT-V0.1.md](IDENTITY-API-AND-EVENT-CONTRACT-V0.1.md) — proposed endpoint surface, request/response examples, events, product adapter contract, idempotency and acceptance tests.

**Boundary clarification:** InOne Business owns organization invitations and membership decisions. Identity does not own Business invitation authority or permission grants. It authenticates the invitee and provisions product accounts only after an authenticated Business acceptance request.

**Remaining owner/product or integration gates:** login identifier behavior for unverified contacts, token/session lifetimes, and Propo's separate personal/work account API contract. Credential and recovery technical baseline is set by the CTO for v1; contact uniqueness is owner-approved (Option A). All remain documentation until implementation is separately authorized.
