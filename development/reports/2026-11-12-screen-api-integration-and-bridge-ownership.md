# Beta 1.0 — screen API integration, route reconciliation and bridge ownership

**Date:** 2026-11-12  
**Execution branch:** `feature/beta1-screen-api-integration-2026-11-12`  
**Implementation base:** Stage 4 source snapshot `016ba75045412652d362fa8c94ee166bfa371c23`  
**Owner:** ChatGPT, sole technical executor  
**Scope:** Beta 1.0 only

## 1. Work sequence and reuse of prior evidence

The five tasks in the existing Beta 1.0 plan were started without repeating A1:
1. A1 engine tree drift — reuse completed report; no repeat or file consolidation.
2. B1 screen/HTML action inventory — added a dependency-free generator and test.
3. D1/D2 backend, Rust MLS and Flutter bridge ownership — fixed source-of-truth and FRB boundary; added static guard and test.
4. B2/B3 screen operation to backend route, DTO/auth/permission/Flutter dispatch reconciliation — added a normalized source inventory and runtime HTTP smoke test; existing Stage 3 contract and authorization tests remain the historical baseline.
5. C2/C3 typed Flutter slice — hardened verified-email registration ticket handling and screen-scoped API dispatch.

Historical PASS evidence remains in [the test evidence baseline](2026-11-12-historical-test-evidence-baseline.md). Stage 3 PASS evidence is exact to PR #44 head `3d288777135d0c12145f18407e8768a02ae80a9f`; it is not represented as a new PASS for this branch.

## 2. B1 — screen and HTML action inventory

Source inputs:
- `mobile/assets/ui-approval/screen-manifest.json` (24 approval screens plus 7 approved legacy screen entries);
- `mobile/lib/claude_screen_catalog.dart`;
- all referenced HTML screens and their `data-api`, `data-pick`, and `data-go` attributes;
- `mobile/lib/claude_ui_bridge.dart` and `mobile/lib/main.dart`;
- canonical backend route source `inone-development-archive-0.6.0/engine/src/server.js`.

Added:
- `scripts/audit-screen-api-contracts.mjs` — dependency-free inventory generator. Run from repository root: `node scripts/audit-screen-api-contracts.mjs`; optional `--write` writes `development/reports/generated-screen-api-inventory.json`.
- `inone-development-archive-0.6.0/engine/test/screen-api-inventory.test.js` — checks 31 screen IDs, backend route evidence and the distinction between global route allowlisting and screen-level permission.

The generator deliberately labels source route evidence separately from runtime receipt. A handler found in source is not proof that a live request reached a running server.

## 3. D1/D2 — canonical source ownership and bridge boundary

### Backend
Canonical Node.js backend, PostgreSQL schema/migrations, stores and backend tests:
`inone-development-archive-0.6.0/engine/`.

This follows the prior Stage 3 audit and A1 source review. The POC engine tree is not to replace the canonical backend tree.

### Flutter-connected Rust MLS client
Canonical persistent OpenMLS client:
`inone-engine-poc-0.6.0/mobile-mls/mls-client/`.

Evidence: `mobile/rust/Cargo.toml` has a direct path dependency on this crate.

### Actual Flutter Rust Bridge boundary
The Flutter FRB crate is `mobile/rust/` (crate name `inone_mls_frb`), with Dart-facing API in `mobile/rust/src/api/session.rs`. The codegen workflow targets `--rust-crate-dir rust` and crate name `inone_mls_frb`.

The separate `inone-engine-poc-0.6.0/mobile-mls/mls-bridge/` crate is not a dependency of `mobile/rust/Cargo.toml`; it is not the active Flutter bridge. Do not switch to it or merge its stateful in-memory design into the persistent SQLCipher client.

Added:
- `scripts/check-mobile-bridge-ownership.mjs`
- `scripts/check-mobile-bridge-ownership.test.mjs`

Generated artifacts (`mobile/rust/build.rs`, `mobile/rust/Cargo.lock`, `mobile/rust/src/frb_generated.rs`) are produced by the codegen workflow and were absent in the inspected source snapshot. Static source ownership does not equal generated-binding/build acceptance.

## 4. B2/B3 — screen → route → backend → Flutter dispatch

### Source-confirmed backend routes

The Stage 3 contract regression already checks the manifest's declared operations against actual backend handler evidence. The Stage 3 audit recorded 25 unique API operations from the 24-screen manifest with matching backend route evidence and included route/role regression tests in the default Node suite.

Current screen-level integration is narrower:
- Screen-scoped calls explicitly allowed: SC-01 `POST /login`; SC-02 `POST /register/email`; SC-03 `POST /register/email/confirm` and resend `POST /register/email`; SC-04 `POST /register`; SC-11 `POST /login`; SC-12 `POST /logout`; CH-01 `GET /rooms/mine`.
- Other backend handlers are not automatically callable just because they exist in the global route map.
- SC-05 provider nonce/verification, SC-06 provider registration, SC-07…SC-10 recovery, organization request writes/documents/decisions, user search, push-token updates, and room administration remain unconnected or incomplete in the screen bridge.
- RQ-03, PS-01, ST-02, CH-01, GR-01, OR-01 and the handoff PR-01 have declared API needs in the manifest/catalog but their HTML currently has no corresponding `data-api` action or no screen-scoped dispatch. They do not yet make those requests from those handoff screens.
- RQ-02 file selection remains unavailable; a `data-pick` declaration is not a native picker implementation.
- CH-02's older HTML contains `POST message`, not a valid backend operation. Do not map it to plaintext `POST /rooms/:id/events`; backend intentionally rejects that path with 409. Message send/receive must remain in the MLS client flow. The canonical backend supports GET room event history, but the screen is not yet connected to it.

### CH-01 live room-list vertical slice

- The handoff HTML now declares `GET /rooms/mine` for CH-01; the Flutter host triggers auto-load only after the WebView is ready and bridge messages include the stable screen ID.
- The Flutter bridge permits this read only from CH-01. Flutter calls the typed `InOneRepositories.myRooms()` repository, validates the response with `InOneRoomList`, and binds only room display names and roles through `textContent` into the screen. No room IDs, session tokens or MLS secrets are exposed to HTML.
- Existing backend `rooms-mine.test.js` exercises the real HTTP handler with authenticated users and verifies membership scoping. A new source regression checks that the CH-01 HTML/runtime emits the API call.
- This is source-level integration plus existing backend runtime-test evidence. The new test is NOT RUN on this branch; Flutter-to-live-server/device E2E remains NOT RUN.

### Critical implementation correction

Before this work, the Flutter host accepted any operation from the global bridge allowlist from any WebView screen. It also ignored the JSON result for generic route calls. A screen-scoped allowlist was added in `mobile/lib/claude_ui_bridge.dart` and enforced in `mobile/lib/main.dart`. Unknown screens and cross-screen API calls now fail closed. Tests cover this boundary.

This intentionally reduces accidental reachability. It does not claim all 31 screens are now integrated. A login or post-registration login response without an authenticated token pair now remains on SC-11 in a waiting state instead of navigating into the authenticated menu. The full approval claim/pollSecret lifecycle is still not wired.

## 5. C2/C3 — first typed Flutter vertical slice: verified email registration

Found and corrected a credential-boundary defect:
- `POST /register/email/confirm` returns a one-time `registrationToken`.
- Previously, the host ignored that result and the next screen could supply a token in its WebView body; registration then had no reliable host-owned token lifecycle.
- The token is now retained only in private Flutter session memory, cleared when a new registration request begins, cleared on logout, and never returned to WebView.
- `registerAccount` no longer accepts a registration token from UI arguments. It requires the host-held token and sends it only from Flutter to the backend.
- After successful account creation, the client performs the normal login request to satisfy Beta 1.0 decision D11 (immediate authenticated entry). Only non-secret account fields are returned from the registration method.
- Transient registration request failures retain the token for retry; a successful registration consumes/clears it.

Added tests in `mobile/test/core/session/registration_ticket_test.dart` for host-only token storage, request sequence, secret non-disclosure, automatic login and refusal to register without a host-held ticket.

## 6. Backend receipt verification

Added `inone-development-archive-0.6.0/engine/test/screen-api-runtime-smoke.test.js`. It starts the actual `createServer` HTTP server on an ephemeral loopback port and sends HTTP requests for screen-relevant routes. It asserts:
- public config responds successfully;
- authenticated private routes are reached and return the expected unauthenticated response when no bearer session is supplied.

This proves backend route receipt when the test is actually run. It does **not** prove the Flutter WebView/bridge made the request. A full Flutter → live Node server E2E remains a separate acceptance check and needs an executable CI/device environment.

Existing historical evidence that backend handlers and authorization paths have been exercised is retained in the Stage 3 CI baseline:
- Node backend 382 passed / 0 failed;
- PostgreSQL 124 passed / 0 failed;
- exact tested PR #44 head is recorded in the historical evidence report.
The added tests on this branch are NOT RUN in this documentation/source-only session.

## 7. Test and acceptance status for this branch

| Check | Status | Evidence |
|---|---|---|
| Historical P0 and Stage 3 suites | PASS (historical exact SHA only) | See historical evidence baseline |
| New screen inventory generator | NOT RUN | Script and test committed |
| New bridge ownership guard | NOT RUN | Script and test committed |
| New Dart registration ticket tests | NOT RUN | Test committed |
| New backend HTTP smoke test | NOT RUN | Test committed |
| Flutter → live backend/device E2E | NOT RUN | Requires runner/device and integrated host |
| Native MLS Stage 4 | BLOCKED / NOT ACCEPTED | Keep `INONE_MLS_NATIVE_ENABLED=false` |

No new CI run is claimed. No product runtime test is claimed. No backend deployment or server-side log observation was performed during this source update.

## 8. Next execution — continue forward

1. Run the new inventory and ownership scripts on an authorized Node runner; fix only concrete failures.
2. Run the focused backend smoke test and Flutter tests on an authorized runner.
3. Run focused CH-01 tests and Flutter analyze/tests; the typed repository, response validation, ready-gated bridge dispatch and safe HTML data binding are already implemented.
4. Build a Flutter-to-live-Node integration harness so the bridge-triggered request is observable at backend receipt.
5. Add typed organization request reads/writes and a secure file adapter, one explicit operation at a time. Extend the screen allowlist only with DTO validation, role checks and tests.
6. Do not use production credentials or trigger irreversible operations in smoke tests.

Do not merge PR #45, enable native MLS, change WBS v1.1 percentages, or treat this branch as Stage 4 acceptance.
