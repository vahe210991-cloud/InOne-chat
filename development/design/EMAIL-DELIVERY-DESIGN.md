# InOne Email Delivery — visual design proposal

**Status:** Draft — owner approval required  
**Primary locale:** Eastern Armenian (`hy`)  
**Additional locales:** Russian (`ru`), English (`en`)

## Reference and ownership

The visual source of truth is the immutable Library artifact `InOne-mobile-design-system-curated.html`, identified in `docs/continuity/SOURCE-OF-TRUTH.md`. This proposal does not modify or replace that source. It applies the visible InOne design-system foundations to email-client-safe markup.

The email header uses the exact `InOne` wordmark as text. It does not invent or redraw an app icon. Any future use of the approved app icon must use the exact approved asset.

## Tokens used in this proposal

These are values visibly present in the curated reference; this list is limited to values used by the email design and is not a replacement for the full design-system specification.

| Purpose | Value |
|---|---|
| Page background | `#EEF1EA` |
| Main surface | `#FFFFFF` |
| Main text | `#171A14` |
| Dark brand surface | `#1B1F17` |
| Lime brand accent | `#C9F53F` |
| Soft lime surface | `#F1F8E3` |
| Soft lime border | `#D8E9B8` |
| Card border | `#E4E7E0` |
| Secondary text | `#6B7268` |
| Quiet text | `#8C9487` |
| Supporting text | `#4A5147` |

## Typography and layout

- Font stack: `Noto Sans Armenian`, `Noto Sans`, then system sans-serif fallbacks. No external font download is required by the email.
- Email content width: 600 px maximum; fluid width on narrow screens.
- Card radius: 20 px; code panel radius: 14 px; action button radius: 12 px.
- Spacing follows the reference's 4/8/12/16/20/24/32 px scale.
- The code is visually isolated in a high-contrast pale-lime panel.
- A primary recovery action uses a lime surface and dark text.
- Plain-text alternatives remain available for clients that do not render HTML.

## Email-client constraints

- Table-based outer layout and inline CSS for broad email-client compatibility.
- No scripts, remote stylesheets, tracking pixels, or externally hosted images.
- Dynamic values are HTML-escaped.
- Recovery links must be HTTPS URLs without credentials or control characters.
- The same semantic content is provided in plain text and HTML.

## Preview

Open the branch in GitHub Codespaces, start a terminal at the repository root and run `python3 -m http.server 8000`. Open the forwarded port 8000 and navigate to `/development/design/email-delivery-preview.html`. The gallery imports the actual backend template renderer and lets the owner switch all 13 template IDs between Armenian, Russian and English. This preview does not require a local clone.

## Language selection and delivery

Email language follows the user's selected in-app language, not the operating-system locale and not a global Armenian default. The supported initial locales are Eastern Armenian (`hy`), Russian (`ru`) and English (`en`). Verified registration sends the selected locale with the registration-code request; the backend stores it alongside the pending email-code state and copies it to the account profile when registration completes. Authenticated users can change it through `PATCH /profile/locale`; the mobile host persists the same choice locally for startup and synchronizes it with the account. Authenticated account-security messages, including backup-recipient copies, use the profile locale captured when the business event is queued. If a user selected a language before login, the login request carries that pending locale and the backend persists it after successful credential verification but before any login-security email is queued. Pre-auth recovery actions (`/recovery/start`, `/recovery/cancel-by-code`, `/recovery/complete`) carry the active interface locale for that recovery event without changing the account's saved preference. Legacy callers that omit an event locale use the saved profile locale. The encrypted queued payload keeps the chosen language stable if the user changes their preference before delivery. Armenian is the fallback only for legacy clients/accounts without a saved locale; unsupported locale values are rejected rather than silently rendered in the wrong language.

## Approval gate

The palette and typography are based on the approved reference, but the composition of the email shell is a new application of those foundations. Owner approval is required for:
- header/wordmark treatment;
- background, card and accent balance;
- typography, spacing and code presentation;
- recovery action button;
- mobile-width rendering.

Do not mark visual acceptance complete until the owner explicitly approves the preview. Any requested changes must be applied to the renderer and preview together.
