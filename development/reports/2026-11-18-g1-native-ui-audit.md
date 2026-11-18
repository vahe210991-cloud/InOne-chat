# G1 — Native UI audit (2026-11-18)

## Decision

**Status: BLOCKED — native Dart UI is not yet the production runtime on `main`.**

This audit is read-only against the production baseline. No implementation branch was merged, no application runtime or MLS flag was changed, and no approved HTML reference was deleted.

## Exact baseline

- Repository: `vahe210991-cloud/InOne-chat`
- Production branch: `main`
- Baseline commit: `ef626c0d7c125f2f4c761e02992b475d1b2dd2e4`
- Flutter post-merge CI: [run #44253911721](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44253911721) — PASS on the exact baseline SHA (G0).

## Findings

### G1-01 — production entry point still launches HTML/WebView

Evidence on the exact baseline:

- `mobile/lib/main.dart` imports `package:webview_flutter/webview_flutter.dart`.
- `main()` launches `InOneApp`; its `MaterialApp.home` is `ApprovedScreensHost`.
- `ApprovedScreensHost.initState()` creates a `WebViewController`, configures JavaScript and a JavaScript channel, and loads `approvedScreensAssetPath`.
- `approvedScreensAssetPath` resolves to `assets/approved-ui/InOne-approved-cross-platform.html`.
- `mobile/pubspec.yaml` still declares `webview_flutter` and bundles the approved HTML plus test/UI-approval HTML assets.

Therefore the approved HTML is not merely a reference: it is the active production screen host. This fails the G1 native-runtime requirement.

### G1-02 — current tests validate the HTML host, not native production screens

- `mobile/test/smoke_test.dart` asserts 22 approved HTML variants, 73 test-gallery screens and the HTML asset path.
- `mobile/test/core/data/profile_ui_bridge_test.dart` verifies HTML asset URLs and JavaScript bridge behavior.
- These tests are useful for the legacy host's safety but do not prove native Dart screen rendering, native navigation, or visual parity.

The legacy tests must be replaced or split into reference-asset integrity tests and native widget/integration tests. Do not delete reference integrity checks.

### G1-03 — a native Dart migration candidate exists, but is unsafe to merge wholesale

Candidate: [Draft PR #52](https://github.com/vahe210991-cloud/InOne-chat/pull/52)

- Head branch: `feat/flutter-ui-dart-migration-2026-11-14`
- Head SHA: `4e22d5f5f08de1d3eed9486b59780517ca3dfb86`
- PR base: `stage0/identity-engineering-readiness-2026-11-13`, not `main`.
- PR reports 391 changed files and contains 43 production Dart UI source files plus an alternate native app shell.
- A direct comparison of current `main` against the PR head reports a diverged history: 455 commits ahead and 643 behind, with merge base `1df19a001acb5f8c4892471ca4eaa0696e02c54d`.

Do not merge PR #52 as a whole. Its branch is a source/reference for selective porting only. The wide history and unrelated backend/engine/docs changes are outside G1.

### G1-04 — candidate runtime is not validated on its exact head

- Flutter workflow run [#43758477536](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/43758477536) for exact PR head `4e22d5f5f08de1d3eed9486b59780517ca3dfb86` concluded **failure**.
- The GitHub job/step summary returned no steps, so the cause is not established from the available evidence.
- PR #52 itself states that its initial CI attempt failed before exposing job steps/logs and does not claim local Flutter tests.

No PASS claim is made for the migration candidate.

### G1-05 — candidate application shell uses stale core API assumptions

The candidate `mobile/lib/app/inone_mobile_app.dart` cannot be copied unchanged onto current `main`. Source-level contract mismatches include:

1. Candidate calls `InOneSession.login(..., identityCode: ...)`; current `main` login signature accepts only email/password.
2. Candidate calls `startRecovery(email)` positionally; current `main` requires named `email:`.
3. Candidate expects `confirmEmailRegistration` to return a registration token and passes that token into `registerAccount`; current `main` owns the one-time registration ticket internally and exposes a different `registerAccount` signature.
4. Candidate expects `myOrganizations()` to return a typed list; current `main` repository currently returns a raw response map.
5. Candidate imports organization/public-config model files that are not present at the same paths on current `main`.

These mismatches must be reconciled against current main contracts and backend DTOs; do not roll back current session/security behavior to fit the old shell.

### G1-06 — migration must preserve existing recovery deep-link handling

Current `main.dart` parses incoming routes with `RecoveryDeepLink.parse` and confirms valid links through `InOneSession.confirmRecoveryLink`. Candidate PR #52 explicitly lists recovery deep links as blocked.

A native-runtime cutover must preserve this working route-handling path (or replace it with an equally tested native implementation) before removing the old host. No recovery route may be silently dropped.

### G1-07 — native source package contains intentionally gated/non-Beta-1 surfaces

The candidate README and app shell identify boundaries that must remain explicit:

- Provider login is blocked pending provider verification.
- Recovery deep-link flow is not connected in the candidate shell.
- Message history and sending remain blocked pending native MLS and encrypted local persistence.
- File picker/download and push/notification integration remain blocked.
- Leads, Kanban and deal detail are Beta 2.0 placeholders.
- RQ/PS screens are gated because the handoff and Beta 1.0 API matrix disagree.

The native UI port must not turn these into fake-success flows, fabricated data, or plaintext messaging. G1 must preserve fail-closed behavior; backend wiring remains separately gated under G3 and MLS under G2.

## Required G1 implementation sequence

1. Create a fresh implementation branch from the current `main` baseline; do not rebase/merge the 455-ahead/643-behind migration history.
2. Selectively port the Dart design-system/widgets/screens from PR #52, preserving their source attribution and stable screen IDs. Keep Beta 2.0 and gated Beta 1.0 screens visibly classified.
3. Build a new native app shell against the **current** `InOneSession`, `InOneRepositories`, typed models and backend contracts. Do not downgrade session security or copy stale signatures.
4. Preserve `RecoveryDeepLink` parsing and `confirmRecoveryLink` behavior; add widget/unit tests for valid, malformed, duplicate, expired and retryable links as appropriate.
5. Make the Dart app the sole production entry point. Remove WebView imports/dependency and active HTML assets from the mobile package only after no production Dart source references them.
6. Retain approved HTML and its screenshots/checksums in a clearly separated repository reference/archive location; never delete the owner-approved baseline.
7. Replace legacy host-specific smoke tests with native widget/navigation tests and reference-integrity tests. Add checks that fail if production entry points import WebView, if HTML is bundled as a runtime asset, or if a Beta 2.0/gated screen is accidentally enabled.
8. Verify screen IDs, light/dark variants, responsive layouts, accessibility semantics, localization and visual parity against the approved HTML/screenshots. Record device/simulator and artifact evidence.
9. Run formatting, `flutter analyze`, full `flutter test`, Android debug/release build and iOS simulator build on the exact implementation SHA. Then inspect the resulting workflow steps and artifacts.
10. Only mark G1 PASS after the native runtime and its regression suite pass on one exact SHA. Physical-device acceptance remains part of G5.

## G1 acceptance checklist

- [ ] Production entry point launches only the native Dart app shell.
- [ ] No production runtime import/reference to WebView or JavaScript bridge remains.
- [ ] Approved HTML is retained as reference/archive and not bundled as a runtime screen asset.
- [ ] Native screen inventory maps all in-scope Beta 1.0 IDs and approved light/dark variants.
- [ ] Beta 2.0 placeholders and unresolved RQ/PS/provider/MLS flows remain gated.
- [ ] Existing recovery deep-link behavior is preserved and tested.
- [ ] Native widget/navigation tests cover loading, empty, error, offline, unauthenticated and authenticated states.
- [ ] Visual parity and responsive behavior are evidenced against approved reference assets.
- [ ] Exact-SHA Flutter analyze/test/Android/iOS build checks PASS.
- [ ] G1 evidence ledger includes commit SHA, workflow/job URLs, artifacts, test counts and unresolved defects.

**Current G1 status: BLOCKED.** G0 is PASS; G1 implementation and acceptance have not yet been completed.
