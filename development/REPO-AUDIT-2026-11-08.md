# Repository source audit — 2026-11-08

## Snapshot identity

- Repository: `vahe210991-cloud/InOne-chat`
- Default branch: `main`
- Audited main tree SHA: `89ba83a4cbd06b648cba8ea5a7c529bfd91285e7`
- Recursive tree entries: 602
- GitHub tree response: `truncated=false`
- Audit method: GitHub Git Trees API, recursive listing, plus direct reads of the Dart package README and pubspec.

This document records only what exists in the GitHub tree at the stated SHA. It does not infer contents of Library ZIPs or private bundles.

## Mobile application status — critical

**No complete Flutter application source is present in the audited main tree.**

The only Dart files found are:

- `inone-development-archive-0.6.0/client-reference/dart/lib/org_api.dart`
- `inone-development-archive-0.6.0/client-reference/dart/lib/org_errors.dart`
- `inone-development-archive-0.6.0/client-reference/dart/lib/org_models.dart`
- `inone-development-archive-0.6.0/client-reference/dart/lib/org_picker.dart`
- `inone-development-archive-0.6.0/client-reference/dart/test/org_errors_test.dart`
- `inone-development-archive-0.6.0/client-reference/dart/pubspec.yaml`

There is no `main.dart`, no Flutter widget tree, no Flutter app package, no `android/`, `ios/`, `macos/`, `windows/`, or `linux/` application platform project, no `l10n.yaml`, and no ARB localization files.

The Dart package `pubspec.yaml` describes `inone_org_client` version `0.0.1`, depends only on `http`, and is explicitly an organization API reference client. Its README states **НЕ ПРОВЕРЕНО**, says Dart SDK was unavailable, and says there is no organization-selection Flutter screen. Do not describe this package as the InOne mobile app.

## 0.7 screen work

The main tree contains `inone-development-0.7/stage-0.7.0/client-screens/` with:
- `README.md`
- `SPIKE-0.7.0a.md`
- `STAGE-0.7.0.md`
- `common/api.mjs`
- `common/state.mjs`
- `test/client-screens-common.test.js`

This is a small JavaScript API/state spike and documentation, not a Flutter UI implementation.

## Engine / MLS source

The main tree contains an archived 0.6.0 Node engine and Rust MLS components:
- `inone-development-archive-0.6.0/engine/src/` — Node server modules.
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/` — Rust MLS client and tests.
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-bridge/` — Rust bridge.
- Android/iOS shell scripts under `engine/mobile-mls/scripts/` build Rust libraries; these are not Flutter application projects.

There are also duplicate-looking engine archive / POC roots. They must not be assumed identical without comparing full tree/blob identities.

## Branch audit

Recursive trees were also checked for these branches:

| Branch | Tree entries | Flutter app files |
|---|---:|---|
| `main` | 602 | None |
| `cto/inone-audit-2026-11-08` | 581 | None |
| `ci/inone-engine-validation-2026-11-07` | 581 | None |
| `recovery/p0-wave3-validation` | 598 | None |
| `development` | 5 | None |
| `engine-poc` | 5 | None |
| `docs/inone-identity-design-localization` | 8 | None |

The audit checked all branches returned by GitHub branch search relevant to the active development work. No product Flutter app was found in these branches.

## Beta 1.0 implication

A runnable phone Beta 1.0 cannot be built from the current GitHub main tree alone. Before a device build can be produced, the original Flutter UI/API source artifact (or a later verified Git branch containing it) must be imported into GitHub. Do not start a parallel UI rewrite or reconstruct the approved design system from memory while the exact source ZIP and design-system HTML remain available only in inaccessible Library binary artifacts.

## Next actions

1. Complete the P0 CI run against exact restored biometric client + fixture.
2. Audit and restore any further missing unchanged base files revealed by CI, using exact source evidence.
3. Obtain a supported route to import the original Flutter UI/API ZIP and design-system source to GitHub; preserve its hashes and provenance.
4. Only then run Flutter/Dart toolchains, analyze/test, connect UI to the verified API/MLS bridge, and produce a signed test build.
5. Keep Beta 1.0 database independent from Propo; do not block launch on the future shared operational database.
