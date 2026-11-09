# UI archive import and Flutter CI — 2026-11-09 12:11 Europe/Tallinn

**Repository:** `vahe210991-cloud/InOne-chat`  
**PR:** [#36](https://github.com/vahe210991-cloud/InOne-chat/pull/36)  
**Branch:** `task/ui-archive-import-2026-11-09`  
**CI workflow run:** [#42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987)  
**CI input SHA:** `478cad39bc39e8002e55293e3015e72b68e26c8c`  
**Post-import branch head:** `cb09a4058719576df6d589f1f8b59be517b592b5`  
**WBS:** owner-approved v1.1; no scope/weight changes.

## Result

- Owner's `Ui.zip` was fetched from `main` and SHA-256 verified byte-for-byte by CI: `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`.
- Nested `ui-approval.zip` was validated and imported to `mobile/assets/ui-approval/`.
- Remote Git tree verification confirms **230 paths** under the imported asset root, including **31 screen HTML files**, **32 HTML files total** including package `index.html`, and **5 WOFF2 fonts**. Manifest records package `0.8-approval-batch-2`, 24 manifest screen IDs, 31 total approved HTML screens, and SHA-256 `115534d84b272c4783c02bb73624d1dd1af12fa26bff7865bd359c9c41a4e9bc`.
- Original manifest/source files remain identifiable; seven v1 screens use runtime-local font patching as declared in `IMPORT-MANIFEST.json`.
- Workflow run #42586579987 completed **15/15 steps SUCCESS**, including archive verification/import, existing 73-screen gallery check, `flutter pub get`, `flutter analyze`, `flutter test`, Android preview APK build, and artifact upload.
- Artifact `inone-beta1-android-preview`: 78,584,647 bytes; artifact ZIP digest `sha256:6376ba35cdebe92f200bfbe27b197918722d5564ef5d93a0210f1714c433d53a`; expires 2026-11-23 08:40 UTC. This is a GitHub Actions artifact containing an Android debug preview APK, not a release APK and not the source archive.
- Root causes fixed in the workflow: expected HTML count now distinguishes 31 screen files from the package index; checkout uses PR head branch rather than synthetic merge ref, avoiding non-fast-forward bot push. PR concurrency also prevents overlapping runs.
- Import bot commit moved PR branch head to `cb09a4058719576df6d589f1f8b59be517b592b5`. The successful run was triggered on code SHA `478cad39...`; it executed tests against the workspace after importing the assets. Because GitHub-token pushes do not trigger a second workflow, an independent CI run on the post-import commit is still recommended before treating that exact commit as separately CI-verified.

## Scope and blockers

- PR #36 remains **draft/open/unmerged**. No changes were made to `main` by this task.
- Imported source assets are now stored in Flutter's asset tree and package validation/build pass. This does **not** prove the approved HTML screens are yet loaded/rendered in the native Flutter WebView at runtime, nor does it prove live API connectivity, native bridge behavior, visual parity on devices, or production readiness.
- The artifact upload succeeded; no APK installation or physical-device test was performed.
- Do not merge without all required checks on the exact proposed SHA and explicit owner authorization. No server/deployment/database exposure was attempted.

## Cumulative WBS readiness (unchanged)

- Beta 1.0: **42% implementation / 31% verification**.
- Beta 2.0: **2% implementation / 0% verification**.
- InOne historical qualitative baseline: **25%**.

The archive transfer/import and CI checks are an important source-integration milestone, but do not justify a WBS percentage uplift without a scored acceptance criterion and evidence of runtime integration.

## Previous five tasks

1. ~~[x] Owner-approved WBS v1.1 established and preserved.~~
2. ~~[x] Ui.zip integrity, nested archive, manifest, checksums and screen inventory audited.~~
3. ~~[x] Import tooling and Flutter asset registration prepared.~~
4. ~~[x] Original Ui.zip uploaded to main by owner; CI independently fetched and verified its exact SHA-256.~~
5. ~~[x] UI assets imported to task branch and Flutter analyze/tests/Android preview build passed in run #42586579987.~~

## Next five tasks

1. [ ] Run CI independently against post-import branch head `cb09a4058719576df6d589f1f8b59be517b592b5`; verify checks on the exact candidate SHA.
2. [ ] Review PR #36 diff and workflow permissions/behavior; keep draft until owner explicitly authorizes merge.
3. [ ] Integrate imported HTML/CSS/JS/fonts with the existing Flutter WebView/runtime loader; verify at least one approved screen renders locally on Android and iOS.
4. [ ] Verify typed bridge messages, navigation and API handoff against implemented Flutter handlers; do not infer missing API contracts.
5. [ ] Reconcile screen API requirements with backend handlers (including unresolved CH-02 room events), then run visual parity, security and device-level acceptance tests.

## Handoff

The original archive is now present in the PR branch and its hash is verified. Continue from PR #36 and the post-import branch head above. Keep the PR draft/open. Do not merge, deploy, start servers, or change readiness percentages without the required evidence and owner authorization.
