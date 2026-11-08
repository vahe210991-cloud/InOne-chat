# Flutter screen handoff — Claude implementation contract

**Audience:** Claude preparing InOne Beta 1.0 UI screens.  
**Owner/integrator:** InOne engineering agent.  
**Target:** production-integratable Flutter/Dart source, not a standalone HTML mockup.

## 1. Required output format

Deliver **Flutter/Dart source as the primary artifact**. HTML may be supplied only as an optional visual reference/prototype and must not be treated as the application implementation.

Deliver one ZIP or a Git branch containing:
- `lib/` screen and reusable widget source;
- `test/` widget tests for each delivered screen and key interactions;
- `assets/` only for assets actually used, with a short source/licence note;
- `README-SCREENS.md` with screen inventory, navigation map, setup instructions, assumptions, and known gaps;
- `API-INTEGRATION.md` listing every API operation the screens need;
- no generated build folders, secrets, local environment files, or copied dependency caches.

Keep screens modular. Do not deliver a single giant `main.dart`. Use null-safe, formatted Dart and stable keys for testable controls.

## 2. Beta 1.0 product boundary

Implement only the approved Beta 1.0 surface:
1. Sign in / registration / email confirmation / password recovery.
2. Main shell and navigation.
3. Chat/room list.
4. Chat conversation screen.
5. Organization list and active organization selection, only to the extent supported by the verified API.
6. User profile view.
7. Basic app settings, including language selection independent of OS language.

Do **not** add Tasks, Calendar, Cindy/AI assistant, or post-beta features to Beta 1.0 navigation. Do not invent profile-editing, organization filtering, presence, read receipts, attachments, or push-notification capabilities unless an implemented endpoint and acceptance contract are supplied.

## 3. Source of truth for API integration

The server implementation and its route registration/OpenAPI contract are authoritative. Before binding a screen to an endpoint:
- inspect the current server source and route registration in the target integration branch;
- identify HTTP method, exact path, auth requirement, request schema, response schema, error codes, pagination and retry semantics;
- record the evidence (file path + symbol/route registration) in `API-INTEGRATION.md`;
- if an endpoint is absent or ambiguous, mark the operation **BLOCKED / CONTRACT NEEDED**. Do not guess a URL or fabricate a response shape.

Known product constraints:
- Beta 1.0 uses an independent InOne backend and database; no runtime dependency on Propo.
- Stable globally unique user/organization/room identifiers must be treated as opaque strings.
- Authentication/session state is shared through a typed app-level session abstraction; never store passwords or access tokens in plain preferences/logs.
- Do not ACK an incoming message/event before the app's durable local persistence transaction succeeds.
- MLS send/decrypt must fail closed. Never add plaintext fallback or fake encryption success.
- Profile GET is present in the prior audit, but profile update endpoint was not verified; implement read-only profile until a real update contract is confirmed.
- The previously audited `/rooms/mine` contract did not expose an active-organization filter. Do not add a query parameter or imply server-side filtering without verifying current source.

The endpoint names above are not a substitute for inspecting the exact current source. The integrator will reconcile your API inventory against server code.

## 4. Required architecture

Use a thin UI and explicit integration boundaries:
- `features/<feature>/presentation/` — screens/widgets only;
- `features/<feature>/application/` — controllers/notifiers and state transitions;
- `features/<feature>/data/` — repositories and DTO mapping;
- `core/network/` — shared typed HTTP client, auth header injection, timeout and error mapping;
- `core/session/` — authenticated/unauthenticated session abstraction;
- `core/navigation/` — route definitions and auth guards;
- `core/theme/` and `core/localization/` — theme and locale configuration.

Prefer the repository's existing state-management, routing, networking, and dependency-injection choices if present. Do not introduce a competing framework or duplicate infrastructure. If those choices are absent, isolate screens behind interfaces so the integrator can connect them without rewriting widgets.

Define repository interfaces before binding widgets, for example:
- `AuthRepository`
- `RoomsRepository`
- `MessagesRepository`
- `OrganizationsRepository`
- `ProfileRepository`

Use DTOs that mirror verified wire schemas and map them into UI models. Avoid passing raw JSON maps through widgets. Add loading, empty, error, retry, and offline/unknown states where relevant.

## 5. Visual and interaction requirements

- Preserve the supplied InOne design-system source exactly; do not recreate tokens from memory or replace the design language with a generic template.
- Use reusable theme tokens for colors, typography, spacing, radii, borders, and elevations.
- Keep responsive layouts usable on common iPhone and Android phone widths.
- Support Armenian, Russian, and English as independent in-app locale choices; do not force the app language to follow the operating-system language.
- All tappable controls need real callbacks and meaningful disabled/loading states.
- Provide semantics/labels for accessibility and stable `Key` values for test automation.
- Avoid hard-coded sample data in production paths. Mock data belongs only in explicit test fixtures/demo mode.

## 6. API inventory format

For each operation, include a table row in `API-INTEGRATION.md`:

| Screen/action | Method + exact path | Auth | Request DTO | Response DTO | Error cases | Server evidence | Status |
|---|---|---|---|---|---|---|---|
| Sign in | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |
| Register | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |
| Confirm email | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |
| Password recovery | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |
| Load rooms | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |
| Load messages / send message | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |
| Load organizations / select active organization | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |
| Load profile | verify from source | yes/no | type | type | codes | path:symbol | VERIFIED / BLOCKED |

Do not mark an operation VERIFIED based only on a design mockup, a previous chat, or an assumed REST convention.

## 7. Required tests before handoff

At minimum:
- `flutter analyze` with zero errors (warnings should be explained; aim for zero);
- `flutter test` for all delivered widget/controller tests;
- widget tests for auth validation, loading/error/success states, room-list empty/error states, navigation, and locale switching;
- repository tests using deterministic fake HTTP responses for every VERIFIED API operation;
- tests proving tokens/secrets are not logged or stored in plain preferences;
- no real network dependency in unit/widget tests;
- `dart format --output=none --set-exit-if-changed .` passes.

Report exact commands, SDK version, test counts, and any skipped tests. Never report a check as passed if it was not run.

## 8. Handoff package and Git rules

Preferred handoff: commit the Dart implementation on a dedicated branch and open a PR against the integration branch named by the owner/integrator. If sending an archive, include the complete source tree and checksums. Do not commit directly to `main`, do not force-push, and do not modify backend contracts to make a mock screen pass.

PR description must include:
- screen inventory and screenshots;
- files added/changed;
- verified API inventory and blocked endpoints;
- test commands and exact results;
- assumptions and known limitations;
- any dependencies added and why.

## 9. Definition of done for Claude's screen package

The handoff is accepted only when the Dart source is buildable in the repository's Flutter toolchain, `flutter analyze` and `flutter test` are green, the API inventory is evidence-backed, and no prohibited post-beta features or fake backend behavior have been introduced.

If any required source, design token file, endpoint contract, or Flutter project scaffold is unavailable, stop at that boundary and document the missing input instead of fabricating it.
