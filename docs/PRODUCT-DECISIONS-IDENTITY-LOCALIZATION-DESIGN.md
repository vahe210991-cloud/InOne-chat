# InOne — Product decisions: identity, localization, chat themes and app icons

Date: 2026-11-08  
Status: requirements captured from product owner. This document is the project reference for the decisions below. Do not silently replace or reinterpret them.

## 1. Cross-platform account identity: InOne + Propo

### Product requirement

InOne and Propo must share one account identity system. Registration on either platform reserves the corresponding account on the other platform, even if the user has never opened that second app.

Example: a person registers in InOne:
- create one canonical user_id in the shared Identity system;
- mark the InOne platform account ACTIVE;
- create/reserve the Propo platform account for the same user_id with status RESERVED / inactive;
- reserve unique identifiers (normalized username/handle, email, phone, as applicable) against that canonical identity;
- when the user first signs in to Propo, activate the reserved Propo account; do not create a second unrelated person/account.

The same flow must work in reverse when registration starts in Propo.

The reservation belongs to the canonical user_id, not merely to a string username. Identifier normalization and uniqueness must be enforced centrally and atomically to prevent concurrent registrations from claiming the same identifier.

### Architecture decision / recommendation

Use an independent Identity Service and its own authoritative identity database as the single source of truth. InOne and Propo retain independent application backends and their own domain data. Both backends integrate with Identity Service through a versioned API and/or durable events.

Do not make InOne's availability depend on Propo's application backend. Do not make Propo's backend the owner of the shared identity database.

Suggested platform-account states:
- RESERVED: identity/slot is reserved for this user, platform account not yet activated;
- ACTIVE: user has activated/used the platform account;
- SUSPENDED: access temporarily disabled;
- CLOSED: platform account closed according to lifecycle policy.

The canonical identity and identifier reservation must survive platform backend outages. Platform-specific account records may be asynchronously provisioned from the canonical reservation.

### Failure behavior

1. Propo backend unavailable, Identity Service available: InOne registration can complete. The shared Identity database commits the canonical user and the Propo reservation. A durable outbox event records the need to provision/update Propo. The client receives a successful InOne registration response plus an explicit cross-platform status such as pending_sync; the UI explains that the InOne account is ready and the Propo reservation is secured but Propo activation/provisioning will complete when its backend returns. The event is retried until Propo catches up.
2. Identity Service/database unavailable: do not claim that cross-platform reservation succeeded. Fail closed with a retryable service-unavailable response (for example HTTP 503 and stable error code IDENTITY_TEMPORARILY_UNAVAILABLE). Do not silently create a locally successful account that can conflict with a registration on the other platform.
3. Timeout / unknown result: client retries with the same idempotency key; server returns the original operation/result rather than creating duplicate accounts.
4. Partial platform provisioning: expose a durable operation status and reconcile/retry. Never tell the user that both platforms are fully provisioned unless the authoritative state confirms it.

Use transactional outbox + idempotent consumers/inbox, unique database constraints, retry with backoff, operation correlation IDs, and monitoring for stuck reservations. Avoid relying on an in-memory retry queue or a best-effort dual write.

### Explicit answer to the runtime question

The InOne backend must be independently deployable and runnable without the Propo backend. The shared Identity Service/database is the required dependency for cross-platform registration guarantees. If Propo is offline but Identity is healthy, InOne can register and reserve Propo centrally. If the authoritative Identity service is offline, InOne must not promise the reservation.

## 2. Application language / localization

The language must be selected inside the app and must not be forced by the device operating-system language.

Initial supported interface languages:
- Armenian
- Russian
- English

Prepare localization architecture for future additions:
- French
- German
- Spanish

Requirements:
- language selection in onboarding/settings;
- persist the user's selected language in their profile/preferences and locally for startup;
- support language fallback when a translation is missing;
- keep all UI strings out of business logic and source widgets;
- support pluralization, date/number formatting and language-specific layout;
- adding a language must not require changes to business logic.

## 3. Chat appearance customization

Required product capability:
- choose from built-in chat themes;
- create and save personal themes.

This feature does not need to ship in the first beta versions. However, the architecture and chat UI must be designed so that themes can be added later without rebuilding chat rendering.

Plan theme tokens for chat background, message bubbles (incoming/outgoing), text, links, separators, composer, accents and wallpaper/surface effects. Keep contrast and readability accessible. User-created themes should be serializable, versioned and validated.

## 4. App icon choices

The app must offer several selectable icon variants, subject to platform-specific support and restrictions.

Primary icon concept (clarified and approved by the product owner on 2026-11-08):
- green background using the approved InOne design-system green; the green background itself has no white perimeter frame;
- the wordmark must read exactly “InOne” as one uninterrupted word, preserving this exact spelling and capitalization;
- letters are black, bold, and visually connected/compact;
- the white outline/stroke must follow the contours of the black letterforms directly; it must not outline the green background or the app-icon perimeter;
- glass-inspired, layered visual language, with each layer reading as glass.

Do not change the wordmark spelling, capitalization, spacing, or outline placement without explicit product-owner approval. Use the exact approved design-system green and typography assets when available; do not invent substitute token values.

Plan the asset catalogue and icon-selection UX. On platforms where alternate icons must be declared in the app bundle, include each supported variant at build time and implement the platform-specific switch mechanism.

## 5. Visual design direction / design-system preservation

The product owner's specified visual direction is glassmorphism: each visual layer should read as a distinct glass surface/layer. Apply this consistently to surfaces, cards, panels, chat elements and depth hierarchy while preserving legibility, contrast and performance.

The primary app icon follows section 4.

Treat the approved InOne design system as a protected project artifact and source of truth. Do not discard, replace, or silently alter approved tokens, components, or visual decisions. Any change to approved design decisions requires explicit product-owner approval.

Exact color values, font family/files, spacing scale, radii, blur/elevation tokens and component specifications must be copied from the approved design-system source when available; do not invent or infer missing token values. This document captures the product owner's stated direction and requirements; it is not a substitute for missing exact design tokens.

## 6. Delivery sequencing

- Identity Service separation and cross-platform reservation semantics are architectural requirements, not optional future polish.
- Localization foundation and language selection belong in the product foundation.
- Chat theme selection and user-created themes may be delivered after the first beta, but must be anticipated in the data model and UI architecture.
- Multiple app icon variants may be delivered in a later beta, but the asset/build approach must be planned.
- Preserve this document and the approved design-system source as version-controlled project artifacts.
