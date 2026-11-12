# Claude UI design handoff — InOne Beta 1.0

**Owner direction:** Claude is assigned UI/UX design work. ChatGPT remains CTO, backend/API/security integrator and sole owner of repository integration/acceptance unless the owner explicitly expands Claude's scope.

## 1. Authoritative files to read first

Read these files from the exact task branch before designing:
1. `AGENTS.md`
2. `development/AI-AGENT-MANDATE.md`
3. `development/PROGRESS-BASELINE.md`
4. `development/reports/2026-11-12-inone-system-audit-and-gap-plan.md`
5. `development/integrations/FLUTTER-SCREEN-HANDOFF-FOR-CLAUDE.md`
6. `mobile/CLAUDE_UI_INTEGRATION.md`
7. `mobile/assets/ui-approval/screen-manifest.json`
8. `mobile/lib/claude_screen_catalog.dart`
9. `mobile/API-CONTRACTS-BETA-1.md`
10. `mobile/API-INTEGRATION.md`
11. `mobile/assets/ui-approval/design-tokens.css`, `design-tokens.v2.css`, `index.html`, `interactions.js`, `interactions.v2.js`
12. Exact HTML screen source under `mobile/assets/ui-approval/screens/**`.

The original UI source archive is retained as `Ui.zip` at repository root. The imported/approved source of truth for the current screen set is `mobile/assets/ui-approval/`. Do not replace source assets with approximations.

## 2. Beta 1.0 screen scope and stable IDs

There are 31 stable IDs: 24 from `screen-manifest.json` plus seven approved v1 entries in `claude_screen_catalog.dart`.

- Authentication: SC-01…SC-12
- Menu: SC-00
- Organization requests/admin: RQ-01…RQ-04, PS-01…PS-03
- People search: SR-01
- Settings/global states: ST-01…ST-03
- Chat: CH-01, CH-02
- Rooms/groups: GR-01, GR-02, GR-04
- Organization selector: OR-01
- Profile: PR-01

Beta 2.0 placeholders are out of Beta 1.0 navigation and must remain placeholders:
- `leads-light`, `leads-dark`
- `kanban-light`, `kanban-dark`
- `deal-detail-light`, `deal-detail-dark`

Do not invent Tasks, Calendar, Cindy/AI, CRM, or other Beta 2.0 UI in the Beta 1.0 flow.

## 3. Design references and evaluation criteria

Use product behavior as a benchmark, not visual copying:
- Microsoft Teams: chat/channel organization, favorites/recent/unread quick views, contextual search. https://support.microsoft.com/en-gb/teams/teams-channels/explore-the-new-chat-and-channels-experience
- Microsoft Teams search: people/messages/files and filters by sender/date/context. https://support.microsoft.com/en-us/teams/chat/search-for-messages-and-more-in-microsoft-teams
- Slack: global and per-conversation notification controls, mentions-only/mute and mobile overrides. https://slack.com/help/articles/360056534254-Manage-notifications-for-specific-channels-and-direct-messages
- WhatsApp multi-device: device-specific identity and secure synchronization implications. https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/

For every screen, evaluate:
- hierarchy and information scent;
- primary/secondary action clarity;
- validation, destructive confirmation and recovery;
- loading, empty, error, offline, rate-limit, forbidden and maintenance states;
- safe-area, keyboard, back gesture, responsive phone widths;
- accessibility, touch target, contrast and localization (HY/RU/EN);
- consistency between iOS/Android;
- clear organization/room/device/role context;
- no visual affordance that promises an unsupported operation.

Record the comparison per screen ID in a design review table: reference pattern, InOne requirement, accepted adaptation, intentionally excluded pattern, backend/API dependency.

## 4. Paths and integration contract

Approved design assets:
- `mobile/assets/ui-approval/screens/<category>/<SCREEN-ID>.html`
- `mobile/assets/ui-approval/design-tokens.css`
- `mobile/assets/ui-approval/design-tokens.v2.css`
- `mobile/assets/ui-approval/interactions.js`
- `mobile/assets/ui-approval/interactions.v2.js`
- `mobile/assets/ui-approval/screen-manifest.json`
- `mobile/assets/ui-approval/IMPORT-MANIFEST.json`
- `mobile/assets/ui-approval/approved.sha256`

Flutter integration:
- Host: `mobile/lib/main.dart`
- Screen catalog: `mobile/lib/claude_screen_catalog.dart`
- Bridge parser: `mobile/lib/claude_ui_bridge.dart`
- API client: `mobile/lib/core/network/api_client.dart`
- Session: `mobile/lib/core/session/inone_session.dart`
- Repositories: `mobile/lib/core/data/inone_repositories.dart`
- API contracts: `mobile/API-CONTRACTS-BETA-1.md`
- Integration notes: `mobile/API-INTEGRATION.md`

Design output should preserve stable IDs and emit a manifest of screen path, states, navigation edges, user actions and bridge events. Do not alter backend routes or fabricate DTOs.

## 5. API and security boundary

API contract source:
- `mobile/API-CONTRACTS-BETA-1.md`
- backend route implementation: `inone-development-archive-0.6.0/engine/src/server.js`
- server bootstrap: `inone-development-archive-0.6.0/engine/src/main.js`
- Flutter host dispatch/allowlist: `mobile/lib/main.dart`, `mobile/lib/claude_ui_bridge.dart`
- Rust MLS API: `mobile/rust/src/api/**`, with client crate dependency declared in `mobile/rust/Cargo.toml`.

Rules:
- UI/WebView must never call HTTP directly.
- UI/WebView must never receive access/refresh tokens, API keys, MLS secrets, SQLCipher keys or authorization headers.
- Only Flutter host may own API transport and attach bearer credentials.
- A declared route is not proof of host dispatch. The current bridge allowlist is deliberately narrow.
- Missing or ambiguous endpoint = mark BLOCKED / CONTRACT NEEDED; do not invent.
- Generic screen probe API is GET-only. Mutations need explicit typed repository methods.
- CH-02 sends only MLS ciphertext via the native Rust flow; never send plaintext and never use `POST /rooms/:id/events` as a workaround.
- No fake success states, hard-coded production data or mocked encryption.
- Respect role/capability checks enforced by backend; UI hiding is not authorization.

## 6. Credentials and API keys

No API key, bearer token, private key, certificate, provisioning profile, signing password, SMTP password or production credential is provided in this handoff. **Do not ask the owner to paste secrets into Claude/chat or commit secrets to GitHub.**

For design work, no credentials are required. If a future integration needs a provider:
- specify the provider and exact purpose;
- document only the environment variable name and required scope, e.g. `GOOGLE_OAUTH_CLIENT_ID` (public client ID only where appropriate), `APNS_KEY_ID`, `FCM_SERVICE_ACCOUNT_JSON`, `SMTP_PASSWORD`;
- actual secret values must be configured by the owner in protected GitHub Environment/secret storage or local ignored `.env`;
- never expose production credentials to UI code or HTML assets.

Do not create credentials or change GitHub billing/settings. Do not initiate paid API usage.

## 7. Expected handoff from Claude

For each screen batch:
1. Updated screen design/source with unchanged stable ID.
2. Screen-by-screen UX review and rationale referencing the benchmark patterns.
3. Complete interaction/state/navigation matrix.
4. List of bridge events/API operations required, with no invented paths or schemas.
5. Accessibility/localization/responsive notes.
6. Asset/license inventory and checksum manifest.
7. Widget/visual test expectations; do not claim tests passed unless executed.
8. Exact files changed and source branch/commit or archive checksum.

Claude's output is a design artifact, not accepted production integration. ChatGPT reviews the handoff, reconciles it with API contracts, integrates it into Flutter, adds tests, and owns release acceptance.
