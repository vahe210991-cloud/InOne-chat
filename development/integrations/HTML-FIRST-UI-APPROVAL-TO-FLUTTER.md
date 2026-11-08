# HTML-first UI approval and Flutter implementation workflow

**Decision:** HTML/CSS is the visual approval artifact. Flutter/Dart is the production application artifact. HTML is not automatically transpiled to Dart.

## Goal

Let the product owner inspect and approve real screens in a browser before implementation, then reproduce the approved design in Flutter with measurable visual parity. The approved HTML is the visual source of truth for each screen revision; the Flutter implementation is the runtime source of truth after acceptance.

## Recommended delivery model: HTML prototype + design contract + Flutter port

### Stage A — Claude prepares browser-reviewable screens

For every screen, deliver:
- standalone HTML entry point or a small static prototype app;
- CSS separated from markup, with all design values expressed as named CSS custom properties;
- local assets in an assets folder; no remote font/image dependencies;
- realistic responsive behavior for agreed phone viewport sizes;
- working navigation and interaction states in the prototype;
- a screen manifest and component inventory;
- screenshots at agreed viewport dimensions;
- an API contract inventory, but mock data only in a clearly isolated prototype adapter.

Do not bind the prototype directly to production credentials or expose secrets. Do not pretend mock interactions are real backend operations.

### Stage B — Owner reviews and freezes a screen revision

Each approved screen gets a stable ID and revision, for example:
- `auth.login@v1`
- `rooms.list@v1`
- `chat.conversation@v1`

Record:
- approved HTML/CSS commit SHA;
- target viewport(s), pixel dimensions and device pixel ratio;
- font files and exact font weights;
- asset paths and checksums;
- interaction states approved (default, loading, empty, error, disabled, focused);
- explicit approval status.

A screen is not frozen merely because a preview was sent. Only owner-approved revisions are implementation targets. Any later visual change creates a new revision and requires approval.

### Stage C — Convert by implementation, not blind transpilation

The Flutter engineer maps the approved design contract into reusable Flutter widgets:
- CSS design tokens -> Dart ThemeExtension / immutable design-token classes;
- HTML semantic components -> Flutter widgets;
- CSS layout -> Flutter Row, Column, Stack, Flex, Wrap, constraints and scrolling;
- CSS typography -> TextStyle with the same local font files, weights, line heights and letter spacing;
- CSS assets -> Flutter asset bundle;
- routes -> Flutter navigation;
- prototype mock adapter -> typed repository interfaces backed by verified API clients.

Do not use an automatic HTML-to-Dart converter as the production conversion mechanism. It cannot reliably preserve responsive layout, CSS cascade, pseudo-elements, animations, browser text metrics, accessibility, or platform behavior.

### Stage D — Prove visual parity

Create Flutter golden tests for every approved screen and critical state. Capture screenshots using the same viewport dimensions, logical pixel size, device pixel ratio, font files and asset versions as the approved HTML reference.

Compare HTML reference screenshots with Flutter golden screenshots. Set a documented pixel-difference tolerance; investigate all meaningful differences in spacing, typography, color, borders, icons and clipping. Run tests in CI so later code changes cannot silently drift from the approved design.

Visual acceptance requires:
- same screen composition and hierarchy;
- same colors, fonts, text wrapping and line heights;
- same dimensions, spacing, radii, borders and shadows within agreed tolerance;
- same icon and image assets;
- same approved interaction states;
- no clipping/overflow on supported device sizes.

Golden tests are a regression guard, not proof that HTML and Flutter render engines are identical. Browser and Flutter text/layout rasterization can differ slightly; the agreed tolerance must account for that.

## Optional exact-fidelity bridge: Flutter shell + WebView

If the owner requires the approved HTML itself to render pixel-for-pixel immediately, a screen can temporarily run inside a Flutter WebView using the same HTML/CSS bundle. Flutter owns app lifecycle, secure storage, native capabilities and navigation shell.

Security and architecture requirements:
- bundle HTML/CSS locally; do not load arbitrary remote pages;
- restrict navigation to the app's local origin/assets;
- disable unnecessary JavaScript interfaces and external navigation;
- do not put access/refresh tokens in JavaScript, localStorage, DOM, URLs or console logs;
- route authenticated API calls through native Flutter repositories;
- pass only minimal view data to the WebView;
- use a narrow, typed, allow-listed JS bridge for UI events (e.g. button tapped, route requested);
- validate every bridge message and never treat JS as a trusted authority;
- do not acknowledge message delivery or MLS persistence from the WebView;
- test keyboard, text input, accessibility, back navigation, safe areas, offline mode and lifecycle on real iOS/Android devices.

Use WebView as a deliberate compatibility/transition option, not an assumed permanent architecture. Prefer native Flutter screens for security-sensitive auth/session flows, chat input, message lifecycle and MLS-dependent operations unless a documented review approves otherwise.

## Required folder/package structure

Suggested HTML approval package:
```
ui-approval/
  README.md
  screen-manifest.json
  design-tokens.css
  assets/
  screens/
    auth-login/
      index.html
      screen.css
      interactions.js
      states/
    rooms-list/
    chat-conversation/
  screenshots/
    iphone/
    android/
  API-INTEGRATION.md
```

Suggested Flutter implementation:
```
lib/
  core/
    design_system/
    navigation/
    network/
    session/
  features/
    auth/
    rooms/
    chat/
    organizations/
    profile/
test/
  golden/
  features/
```
Adapt these paths to the existing repository conventions rather than duplicating an existing architecture.

## Required screen manifest fields

Each screen record must include:
- stable screen ID and revision;
- title and route;
- HTML entry point;
- supported viewport dimensions and device pixel ratio;
- asset/font references;
- component IDs and stable interaction IDs;
- states and transitions;
- API operations required, each marked VERIFIED or BLOCKED with source evidence;
- approval status and approved commit SHA.

## API boundary

HTML prototype may use deterministic fixture data only. It must label mock mode visibly in the prototype. The Dart implementation must call only endpoints verified in server source or OpenAPI. The API inventory must state exact method/path, auth requirement, request/response schema, errors and evidence path/symbol. Missing endpoint = BLOCKED, not invented.

Beta 1.0 remains limited to approved scope: authentication, rooms/chats, organizations where supported, profile read, settings and localization. Tasks, Calendar and Cindy are post-beta.

## CI / acceptance gates

HTML review:
- HTML/CSS/JS lint or validation;
- screenshots generated at agreed viewports;
- all navigation and interactive prototype states manually reviewable.

Flutter integration:
- `dart format --output=none --set-exit-if-changed .`;
- `flutter analyze`;
- `flutter test`;
- golden tests for approved screens and states;
- repository/API tests with deterministic fixtures;
- no real production network dependency in unit/widget tests;
- Android and iOS build checks when the native toolchains are available.

Do not report skipped checks as passed. Store screenshots, manifests, API inventory, test logs and approval references in GitHub.

## Definition of done

A screen is complete only when:
1. its HTML revision is approved and frozen;
2. its design tokens, fonts, assets and states are recorded;
3. Flutter implementation is connected to verified APIs or explicitly marked blocked;
4. golden tests demonstrate visual parity within the agreed tolerance;
5. widget/repository tests and analysis pass;
6. the owner can compare the approved reference screenshot with the Flutter screenshot.

**Core rule:** owner approval applies to a specific HTML revision. Flutter work must match that revision; any design deviation returns for approval rather than being silently improvised.
