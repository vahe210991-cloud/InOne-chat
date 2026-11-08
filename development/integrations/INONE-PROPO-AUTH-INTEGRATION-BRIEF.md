# InOne ↔ Propo Authentication Integration Brief

- Date/time: 2026-11-08 08:41:19 Europe/Tallinn (UTC+03:00)
- Status: Planned; no InOne-side implementation is assumed to exist.
- Ownership: InOne messenger service is developed separately. Propo owns its own integration and authentication logic.

## Goal

Allow a person to connect their InOne messenger identity to an existing Propo account and later sign in to Propo using InOne. The user proves control of the private InOne chat by entering a one-time code received in that chat.

## High-level flow

### A. Link InOne from an authenticated Propo session
1. User opens Propo account/security settings and selects **Connect InOne**.
2. Propo creates a challenge with purpose `LINK_ACCOUNT`, associated with the authenticated Propo user and a pending InOne identity/session.
3. InOne delivers a one-time verification code to the user's private chat.
4. User enters the code in Propo.
5. Propo validates the challenge, consumes it atomically, and stores the stable InOne provider subject ID against the Propo user.
6. Propo records an audit event and shows the connected status.

### B. Sign in to Propo using InOne
1. User chooses **Continue with InOne** on the Propo login page.
2. Propo creates a fresh challenge with purpose `LOGIN`.
3. InOne delivers a new code to the private chat associated with the requested InOne identity.
4. User enters the code in Propo.
5. Propo verifies the code and resolves the unique linked Propo account.
6. Propo issues its own session/token using its existing session lifecycle and security controls.

### C. Disconnect / recover
- A signed-in user can unlink InOne after appropriate re-authentication or another trusted factor.
- Unlinking must not lock the user out if another valid login/recovery method remains.
- Provide support/recovery handling for lost InOne access, compromised accounts, and duplicate/incorrect links.

## Proposed integration contract (to be agreed, not assumed)

InOne team should provide:
- A stable immutable provider subject identifier for each InOne account.
- A server-side message-delivery operation that accepts a destination subject/chat and a message template or code.
- Authenticated service-to-service access (mTLS or signed short-lived requests / OAuth client credentials; choose based on the InOne platform).
- A signed delivery result or callback so Propo can correlate delivery status without trusting browser input.
- Request IDs/idempotency support and documented retry semantics.
- Rate limits, delivery failure codes, sandbox/test environment, key rotation, and versioning.
- A documented process for identity deletion, account suspension, and provider-side account changes.

The InOne team must not send the verification code to a browser callback or expose it in logs. The Propo backend should generate and verify the code; InOne is a delivery channel, unless both teams explicitly agree on a different cryptographic challenge protocol.

## Security requirements for Propo

- Generate a cryptographically secure random code (suggested 6–8 digits); exact format and entropy to be threat-modelled.
- Short expiry (suggested 5 minutes), one-time use, atomic consumption, purpose binding, and replay prevention.
- Store only a keyed hash/HMAC of the code; never persist or log plaintext codes.
- Bind each challenge to its intended user/session, provider subject, purpose, and expiry.
- Enforce attempt limits, per-account/per-IP/device rate limits, resend cooldowns, and abuse monitoring.
- Use generic responses to prevent account enumeration.
- Ensure one InOne subject maps to at most one Propo account (unique database constraint).
- Never trust a client-supplied InOne user ID or a client assertion that a message was delivered.
- Protect challenge creation and verification against CSRF/session fixation as appropriate to the current auth architecture.
- Emit audit events for challenge creation, successful link, failed verification thresholds, unlink, and login; never include raw codes.
- Support key rotation, secret management, observability, incident response, and data deletion requirements.
- Decide whether additional confirmation is needed for a new device, unusual login, or high-risk action.

## Propo implementation scope (owned by Propo team)

- Data model for linked external identities and verification challenges.
- API endpoints for start-link, verify-link, start-login, verify-login, unlink, and status.
- Authenticated server-to-server adapter to InOne.
- Session/token issuance through Propo's existing authentication subsystem.
- UI for linking, entering code, login, resend, expiry, and recovery.
- Audit logging, rate limiting, tests, monitoring, and operational runbook.
- Integration/e2e tests against InOne sandbox or a contract-faithful mock.

## Open decisions

- What is the canonical InOne subject ID and how is it obtained/validated?
- Does InOne expose a bot, messaging API, or authenticated callback? What are its exact API and delivery constraints?
- Who initiates the chat: user starts the bot, or can the service send the first private message?
- How does Propo securely associate the challenge with the destination chat?
- What happens when the InOne account is renamed, deleted, suspended, or transferred?
- Which existing Propo login methods remain available for recovery?
- What are the applicable privacy/consent, retention, and regional data requirements?

Do not implement production integration until these decisions are answered and the API contract is versioned.

---

## Prompt for the separate InOne development chat

Copy the prompt below into the chat responsible for building InOne. That chat should design and implement only the InOne-side capabilities and return a versioned integration contract to the Propo team.

### Prompt

You are the technical lead for the **InOne messenger**. InOne is developed independently from Propo. Your task is to design the messenger-side capabilities required for secure account linking and passwordless sign-in to the external Propo platform.

**Product scenario:** A person wants to connect their InOne account to Propo. Propo asks the InOne service to deliver a one-time verification code to the person's private InOne chat. The person reads the message and enters the code into the Propo website. After the link is established, the person can later choose "Continue with InOne" on Propo, receive a fresh code in the InOne chat, and enter it in Propo to authenticate.

Do not implement Propo's database, UI, account mapping, challenge validation, or session/token issuance. Those belong to the separate Propo team. Focus on InOne's secure identity and message-delivery responsibilities.

Please produce:

1. **Identity model**
   - Define a stable, immutable, non-reassignable InOne account subject ID.
   - Explain how a user proves control of the InOne account and private chat.
   - Specify behavior for renamed usernames, changed phone numbers, deleted/suspended accounts, and account recovery.
   - Never use display name or mutable username as the identity key.

2. **Private message delivery**
   - Determine whether a bot/service can send a private message to a user and whether the user must first start or authorize the bot.
   - Design the user-consent and bot-start/deep-link flow if needed.
   - Provide an API operation for delivering a Propo-generated one-time code to the verified private chat.
   - Define delivery receipts, unavailable/blocked chat behavior, retry semantics, idempotency, and rate limits.
   - The code must not be returned to the browser or exposed in service logs.

3. **Service-to-service API**
   - Propose versioned endpoints and request/response schemas.
   - Define authentication between Propo and InOne (evaluate mTLS, OAuth2 client credentials, or signed short-lived requests).
   - Include request signing, timestamp/nonce replay defense, key rotation, scopes, authorization, and audit logging.
   - Include a sandbox environment and test credentials.
   - Define error codes and HTTP semantics.

4. **Challenge correlation**
   - Define how Propo can associate a delivery request with the correct InOne subject/chat without trusting a client-provided chat ID.
   - Support correlation/request IDs and idempotent retries.
   - Do not let InOne decide which Propo account receives a successful login. Propo performs that mapping only after its own verification succeeds.

5. **Security and abuse prevention**
   - Protect against spam, enumeration, social engineering, bot abuse, replay, account takeover, and message flooding.
   - Recommend quotas, cooldowns, per-user/per-IP limits, monitoring, alerts, and incident response.
   - Define what metadata is retained and for how long.
   - Never log or persist plaintext verification codes unless there is a reviewed, strictly bounded transient delivery requirement; prefer handling the code as opaque message content and avoid storing it.

6. **Privacy and compliance**
   - Document user consent, privacy notice requirements, data minimization, retention, deletion, and regional processing.
   - Clarify which identifiers and delivery metadata Propo is allowed to store.

7. **Deliverables**
   - Architecture diagram and sequence diagram for link and login.
   - OpenAPI specification (or equivalent machine-readable contract).
   - Security/threat model and abuse cases.
   - Sandbox/test plan and example requests/responses.
   - Operational runbook and service-level expectations.
   - Versioning and backward-compatibility policy.
   - A concise integration guide for the Propo backend team.

Before finalizing, identify every assumption and unresolved product/security decision. Do not invent existing InOne APIs: inspect the actual InOne codebase and platform capabilities first. Return a contract that the Propo team can implement against without guessing. Include a clear ownership boundary between InOne and Propo.
