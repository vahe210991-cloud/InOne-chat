# Propo ↔ InOne Identity — Stage 0 adapter questionnaire

- **Version:** 1.0
- **Prepared:** 2026-11-13
- **Owner:** InOne Identity architecture
- **Recipient:** Propo backend / platform technical owner
- **Status:** Awaiting Propo technical response
- **Purpose:** establish a real, versioned integration contract. This document intentionally does not invent Propo endpoints, IDs, database tables or behavior.

## 1. Product and identity model

1. Does Propo currently have a stable, immutable person/user principal ID? What is its exact field name, format, lifecycle and non-reassignment guarantee?
2. Does Propo have a separate immutable Seller Account ID? What does it identify: legal entity, shop, merchant profile or another object?
3. Can Propo represent two distinct account contexts for the same human: personal buyer/customer principal and work/employee principal linked to a Seller Account?
4. Can one human hold both personal and work contexts without merging profiles, permissions, buyer history or seller history?
5. Can one Business organization map to exactly one Seller Account, with multiple employee memberships under that account?
6. How are employees represented: independent login principal, Seller Account membership, invited operator, or another model?
7. Can an employee be linked to multiple Seller Accounts? v1 InOne Business assumes one organization ↔ one Seller Account, but the person's broader Propo access model must be understood.

## 2. Account reservation and activation

8. Does Propo support creating a reserved/inactive principal that cannot sign in or access marketplace features?
9. Can reservation happen before a user has ever installed/opened Propo?
10. What exact event activates a reserved account: first successful authentication, verified device registration, explicit activation action, or another event?
11. Can an InOne or InOne Business login accidentally activate the Propo account? Required answer: no.
12. Can Propo distinguish reserved, active, suspended, closed and provisioning_failed?
13. Can Propo return the same principal ID when the same idempotent provisioning command is retried?
14. Can Propo safely reserve personal and work principals independently for one central Identity subject?
15. What happens when reservation succeeds but InOne/Business provisioning fails, or vice versa?

## 3. APIs, events and service authentication

16. Supply current OpenAPI/Swagger files or equivalent API reference for account creation, reservation, activation, suspension and lookup.
17. Supply event/webhook documentation for account lifecycle changes and delivery acknowledgements.
18. Which service authentication mechanisms are supported: mTLS, OAuth2 client credentials, private-key JWT, signed requests, or another standard?
19. Can Propo issue a sandbox service credential and isolated sandbox environment?
20. What are the rate limits, timeout limits, retry semantics, idempotency support and error taxonomy?
21. Does Propo support API/event contract versioning and backward compatibility?
22. Can Propo provide a reconciliation endpoint to query the final account state by external operation ID?

## 4. Mapping and lifecycle

23. Which immutable Propo identifiers must InOne Identity persist?
24. Does Propo require its own stable external subject ID to map to the central Identity ID, or can it store a foreign external reference?
25. How are duplicate/mismatched identities resolved? No automatic merge by matching unverified phone/email is allowed.
26. What events are emitted when an account is renamed, suspended, deleted, transferred, or its Seller Account changes?
27. Can Propo disable only a work principal while preserving the personal principal, and vice versa?
28. What is the deprovisioning policy when a person leaves an organization? Who revokes Business membership and Propo employee access?
29. How does Propo handle an organization/Seller Account closure?

## 5. Security, privacy and operations

30. Which party is the controller/processor for personal and work identity data? Provide the current privacy/data-processing documentation.
31. What data fields may be stored by InOne Identity, and which must remain in Propo?
32. What are Propo's data residency, retention, deletion, backup and breach-notification requirements?
33. Are audit events available for reservation, activation, suspension and account mapping changes?
34. Who owns production support and incident escalation for identity/provisioning failures?
35. What are the expected sandbox/prod availability and support windows?

## 6. Required evidence

Please provide:
- Propo technical owner name/role and escalation channel.
- API specification and version.
- Event/webhook specification and version.
- Stable personal principal ID definition.
- Stable work/employee principal ID definition.
- Stable Seller Account ID definition.
- Sandbox base URL, test-account procedure and service-auth method (secrets shared only through an approved secret manager, never in GitHub or chat).
- Reservation and first-device activation state diagram.
- Idempotency and retry guarantees.
- Data-processing/privacy documentation.
- One successful end-to-end sandbox trace with secrets and personal data redacted.

## 7. Contract acceptance checklist

The Propo adapter is not production-ready until all are true:

- [ ] Personal and work principals are distinct and immutable.
- [ ] A single central identity can map to both contexts without data merge.
- [ ] One InOne Business organization maps to exactly one Seller Account in v1.
- [ ] Propo can reserve both account contexts without activating either.
- [ ] InOne login cannot activate Propo.
- [ ] Propo's own first-device activation changes only the relevant Propo account state.
- [ ] Create-or-return is idempotent across timeout/retry.
- [ ] Stable IDs and account lifecycle state are returned and queryable.
- [ ] Service-to-service authentication and credential rotation are documented.
- [ ] Events are authenticated, versioned, deduplicated and replay-safe.
- [ ] Sandbox contract tests pass.
- [ ] Privacy/data processing and incident responsibilities are documented.

## 8. If Propo cannot support the required model

Do not emulate the missing behavior by writing to Propo's database or creating fake local Propo IDs.

Return a gap report with unsupported requirement, actual current Propo behavior, impact on InOne/Business registration, safe temporary behavior (normally provisioning_pending or feature disabled), required Propo change and migration/backward-compatibility impact.

Until the contract is confirmed, the Identity implementation uses a PropoAccountAdapter interface and a contract-faithful fake adapter only. Production Propo provisioning remains disabled.
