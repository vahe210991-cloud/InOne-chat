# G1 native Dart UI — merge and exact-head CI closeout

**Date:** 2026-11-18  
**Repository:** `vahe210991-cloud/InOne-chat`  
**PR:** [#82 — feat(beta1): switch production mobile entry to native Dart UI](https://github.com/vahe210991-cloud/InOne-chat/pull/82)  
**PR branch:** `feat/beta1-native-dart-ui-g1-2026-11-18`  
**Validated PR head:** `dde4de9922a328c9016ad34e3e770cc234b50b45`  
**Merge commit / current main:** `a174f794535ab09699d38292acb4919308873fd7`

## Final Git state

- PR #82 is CLOSED and MERGED.
- Merge commit: `a174f794535ab09699d38292acb4919308873fd7`.
- The `main` ref was compared with the merge commit in both directions. GitHub returned `status=identical`, `ahead_by=0`, `behind_by=0`.
- A repository-wide recent-commit query showed the merge commit as the newest commit at the time of this report; no later commit was observed.
- No force-push, branch deletion, or additional product-code change was performed in this closeout.

## Exact-head CI evidence

All workflows below ran against PR head `dde4de9922a328c9016ad34e3e770cc234b50b45`, before merge.

| Workflow | Run | Result | Verified outputs |
|---|---:|---|---|
| Flutter mobile validation | [#44353252275](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44353252275) | **PASS** | Dart binding generation, NDK preparation, UI archive import/geometry checks, native-only runtime guard, Rust lockfile/bridge validation, `flutter analyze`, `flutter test`, Android preview APK build and artifact upload |
| Flutter iOS validation | [#44353252289](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44353252289) | **PASS** | Dart binding generation, recovery deep-link configuration, `flutter analyze`, iOS Simulator build, Cargo deployment-target configuration, iOS Device build and artifact upload |
| Native MLS client validation | [#44353252236](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/44353252236) | **PASS** | iOS Keychain native target build; OpenMLS attachment/session integration tests; persistent Flutter Rust bridge host tests |

### Artifact retention

- Android preview: `inone-beta1-android-preview`, 96,066,932 bytes, SHA-256 `131f11a7a7b5a2adf64be4ea07a7e9acd9094719b883a3eba9694aa22d5a5c95d`, artifact ID `14451772969`.
- iOS preview: `inone-beta1-ios-preview`, 79,569,877 bytes, SHA-256 `a315e02da4bd0638e6c50054fbdb9ea2bbbff3aacd036cb9b3660b70cd49d5ac`, artifact ID `14452312758`.
- Both artifacts were reported unexpired, with expiry at 2026-12-02 (UTC).

The iOS device build passed on the exact PR head. The Cargo configuration step that sets `IPHONEOS_DEPLOYMENT_TARGET=15.0` also passed. This resolves the previously observed CI linker failure for this build path; do not describe it as physical-device runtime acceptance.

## Scope accepted by this evidence

The merged change makes the production mobile entry point native Flutter/Dart, removes WebView as the production entry path, preserves approved HTML materials in the archive, and includes the native-only runtime checks and recovery deep-link handling described in PR #82.

## Remaining acceptance gates — NOT covered by these CI runs

- Physical Android and iOS installation/runtime checks.
- Android Keystore and iOS Keychain behavior on physical devices, including lifecycle/restart/revocation cases.
- Two-device MLS end-to-end messaging and encrypted attachment acceptance.
- Product-owner review of all screen wiring, native navigation, and API bindings against the approved Beta 1.0 scope.
- Backend integration acceptance for flows not exercised by the listed CI jobs. In particular, the active backend does not expose `GET /rooms/mine`; chat listing must remain an explicit empty state until an approved backend contract exists.

Therefore: **PR #82 merge and its exact-head CI are PASS; overall G1 / Beta 1.0 release acceptance is not declared complete.** Keep MLS and any other gated capabilities fail-closed until their separate acceptance gates pass.

## Follow-up

1. Use `main` at `a174f794535ab09699d38292acb4919308873fd7` as the current G1 native-UI baseline.
2. Do not re-merge the superseded migration PR #52 wholesale.
3. Recheck physical-device and two-device MLS acceptance separately and record their exact build/source SHAs.
4. The older G1 blocker audit in PR #81 predates this implementation and merge; treat its “G1 blocked” conclusion as historical, not current CI status. PR #81 remains open and was not modified by this closeout.
5. Documentation continuity files `CURRENT-STATE.md`, `NEXT-SESSION.md`, and `SESSION-LOG.md` are concurrently modified by open PR #80. They were intentionally left untouched here to avoid overwriting that branch's changes. Reconcile and update them after PR #80 is resolved.
