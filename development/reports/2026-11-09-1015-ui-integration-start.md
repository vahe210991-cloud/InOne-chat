# Beta 1.0 UI integration — stage 1: source audit and integration foundation

**Date/time:** 2026-11-09 10:15 Europe/Tallinn (UTC+03:00)  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** PR #31 branch `feat/claude-ui-beta1-integration` (based on main `cf2e1515fee680c2e8c86720b570617ffbe471d4`)  
**Working branch:** `feat/beta1-ui-source-integration`  
**WBS:** approved Beta 1.0 — Frontend/UI (25%) and API↔UI integration (15%); UI-01..UI-06.  
**Scope:** record owner approval of baseline, inspect current Ui.zip, add local asset-path integration foundation and import tooling. No server, deployment, production API, DB or merge.

## 1. Owner approval recorded

The owner explicitly accepted the prior audit assessment and directed that it become the common baseline for every subsequent chat/agent. `development/PROGRESS-BASELINE.md` is now version 1.1, status **owner approved**. The WBS weights and release boundaries are fixed unless owner authorizes a versioned change.

- Beta 1.0: 42% implementation / 31% verification.
- Beta 2.0: 2% implementation / 0% verification.
- Historical InOne overall: 25% retained as qualitative historical baseline; no false recalculation.
- Root `AGENTS.md`, Copilot instructions, development README and continuity entrypoints point every future agent to the approved WBS.

## 2. Ui.zip source audit

Owner-provided file: `/mnt/data/Ui.zip` (temporary processing path only; not treated as durable storage).

- Outer archive SHA-256: `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`.
- Outer ZIP integrity: PASS; contains `ui-approval.zip` and `index.html`.
- Inner archive SHA-256: `d098738ff64fab0388aa72d22a92b097940c41bbcb4acfddfc30ff745e16ad0d`.
- Inner ZIP integrity: PASS; 231 archive entries, 7,432,843 uncompressed bytes.
- Manifest version: `0.8-approval-batch-2`; 24 records in `screen-manifest.json`.
- 31 screen HTML source files total (24 current manifest screens + 7 approved-v1 screens); manifest screen file paths all exist.
- Five WOFF2 font files: Armenian, Cyrillic, Cyrillic-ext, Latin, Latin-ext.
- Two design token files and two interaction JS files (v1 and v2).
- Screenshot sets include iOS/Android, light/dark, plus state captures.
- `approved.sha256`: all 10 declared checksum entries PASS.
- Inner archive includes API integration notes, stable IDs, theme modes, insets and bridge event/method contracts.

This is source package verification, not visual approval re-approval. The existing approved source revision must be preserved without redesign.

## 3. Findings relevant to integration

- v2 manifest screens use `../../design-tokens.v2.css` and `../../interactions.v2.js`; v1 approved screens use v1 filenames. Asset folder structure must preserve relative paths or be rewritten only by an explicitly approved packaging transformation.
- WebView should load local bundled assets only. HTML must not perform authenticated network calls. API calls go through typed Flutter repositories and narrow `InOneBridge`.
- Access/refresh tokens must never be exposed to JS/DOM/localStorage/URLs/logs.
- Flutter `pubspec.yaml` asset directory enumeration is not recursive; each needed directory must be listed.
- The manifest's 24 screens are auth/menu/org request/admin/search/settings; seven approved-v1 files cover chat, rooms, organization, profile. Current screen catalogue already maps 31 IDs.
- Chat screen CH-02 declares `GET /rooms/:id/events`; current API inventory does not confirm this endpoint. It remains BLOCKED pending backend source/OpenAPI reconciliation.
- Requirements flagged in source remain unresolved (including D8, G13, D4/D7, D5, D6, D11). No values or behavior were invented.

## 4. Code delivered in this stage

- `AGENTS.md`: root instructions require the owner-approved WBS.
- `.github/copilot-instructions.md`: same requirement for Copilot.
- `development/PROGRESS-BASELINE.md`: WBS v1.1 marked owner-approved.
- `development/README.md`, `docs/continuity/README.md`, `docs/continuity/NEXT-SESSION.md`: point all agents/chats to baseline and UI work.
- `mobile/lib/claude_screen_catalog.dart`: deterministic local asset path getter for each stable screen ID.
- `mobile/lib/ui_approval_asset_loader.dart`: rootBundle loader for original HTML asset paths.
- `mobile/test/ui_approval_asset_path_test.dart`: path uniqueness and ID tests.
- `mobile/tool/import_ui_approval.mjs`: deterministic copy/manifest validation script for an extracted canonical UI package.

## 5. Important blocker — binary/source package not yet persisted

The current GitHub connector exposes text/blob operations but no direct local-file streaming path from the mounted ZIP to GitHub. The container has no outbound GitHub network access. I have **not** claimed the 5.7 MB binary archive, WOFF2 fonts or screenshots were uploaded. They are still pending durable GitHub import. Do not remove the owner attachment or treat the local temp extraction as the project source of truth.

Next supported route should be a normal Git push from an authorized working clone/Codespace, or Git LFS for large binary screenshots/archive if repository policy requires it. No paid Codespace was created. This blocker does not prevent preserving the verified checksums and continuing integration preparation, but it prevents claiming UI source import complete.

## 6. Verification

- ZIP integrity / manifest consistency / declared checksum check: PASS (local Python zipfile/hashlib).
- Flutter analyze/tests: NOT RUN in this stage; no local Flutter SDK invoked.
- GitHub Actions: NOT RUN for this new branch at time of report.
- Android/iOS WebView runtime: NOT RUN.
- Visual golden comparison: NOT RUN.
- Live API: NOT RUN.
- Product server/deployment/DB exposure: NOT performed.

## 7. Cumulative readiness

Unchanged, per approved WBS:
- Beta 1.0: **42% implementation / 31% verification**.
- Beta 2.0: **2% implementation / 0% verification**.
- InOne overall: **25% historical qualitative estimate**.

UI asset-path code and importer are an integration foundation only. No percentage increase until original source files are present in GitHub, Flutter bundle is configured, and tests/visual parity pass.

## 8. Последние 5 предыдущих задач

1. ~~[x] Backend P0/Rust/OpenMLS accepted and merged — PR #25; six required CI jobs PASS and post-merge run #134.~~
2. ~~[x] Flutter QA/API harness delivered in PR #28 branch — run #42563179564 PASS; not merged.~~
3. [ ] IN PROGRESS — typed rooms list data layer PR #30; full chat lifecycle not accepted.
4. [ ] IN PROGRESS — UI bridge/catalogue PR #31; original source package not bundled, APK build failure due Gradle HTTP 504.
5. ~~[x] Owner-approved audit WBS — PR #34 audit baseline accepted by owner; approval now carried in WBS v1.1.~~

## 9. Следующие 5 задач

1. [ ] BLOCKED — import original Ui.zip and nested package into GitHub (preserve archive, source tree, font and screenshot checksums).
2. [ ] NOT STARTED — configure explicit Flutter asset directories and verify local HTML/CSS/JS/font loading on Android/iOS.
3. [ ] NOT STARTED — connect Flutter host navigation to all 31 stable screen IDs and keep Beta 2.0 placeholders out of Beta 1.0 navigation.
4. [ ] BLOCKED — reconcile every declared screen API with backend source/OpenAPI, especially CH-02 `GET /rooms/:id/events`.
5. [ ] NOT STARTED — run Flutter tests/analyze, Android/iOS builds, WebView bridge/security tests and golden visual parity.

## 10. Handoff

Remote commit/PR SHA will be recorded after the stage files are committed and fetched from GitHub. This report is not complete until the report, session log and continuity changes are committed/pushed and remote-verified. PR remains draft; no merge.


## Addendum — UI source security and compatibility audit (2026-11-09 10:22 Europe/Tallinn)

Additional inspection of the extracted package found:
- v2 `interactions.v2.js` explicitly documents no network/no storage and emits typed bridge messages with `screen` ID.
- v2 design tokens load the supplied local WOFF2 files using relative `assets/fonts/*` paths.
- Seven v1 screens load Google Fonts from `fonts.googleapis.com`; this conflicts with a fully local/offline WebView asset package. The importer now preserves original source and patches only the runtime copy to use local `legacy-fonts.css` backed by supplied WOFF2 files.
- v1 `interactions.js` uses `localStorage` only for the `inone-theme` display preference (no credentials observed), and its bridge messages omit the screen ID. Flutter bridge parser now accepts v1 messages with a non-sensitive `legacy-v1` marker.
- v1 chat UI emits `POST message`, which is not an approved backend route in the current allowlist; it must remain BLOCKED until a real server contract is confirmed. Do not add it to the allowlist.
- v2 manifest declares multiple endpoints not currently in the verified API allowlist (provider auth, recovery variants, org-request document upload/decision, push settings and per-room event history). These are contract blockers, not routes to invent.

No original HTML/design files were edited. Runtime font patch is performed only on the copy produced by the importer.

## CI snapshot

GitHub Actions run [#42578333371](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42578333371) was triggered on the PR #35 head at creation time. At last check: platform generation, asset geometry, 73-screen gallery verification, pub get, Flutter analyze and Flutter tests all PASS; Android preview APK build remained IN PROGRESS. This run predates subsequent v1 bridge/importer commits and therefore does not verify the latest branch head. Exact latest-head CI remains NOT RUN / NOT VERIFIED.


## Addendum — exact-head Actions rerun (2026-11-09 10:27 Europe/Tallinn)

PR #35 head at trigger: `8d3282b2bca16deb09af7bac98642c8abf35aec7`. GitHub Actions run [#42578785134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42578785134) is associated with this exact head. At last observation:
- Flutter setup/platform generation: PASS.
- Approved screen geometry check: PASS.
- Original 73-screen gallery integrity check: PASS.
- `flutter pub get`: PASS.
- `flutter analyze`: PASS.
- `flutter test`: IN PROGRESS.
- Android preview APK build and artifact upload: NOT STARTED.
Therefore no green workflow result is claimed. This run validates the branch head before this report/log-only follow-up commit; any later code changes require a fresh exact-head run.


## Final result for Actions run #42578785134

Run #42578785134 completed with **FAIL** on PR #35 head `8d3282b2bca16deb09af7bac98642c8abf35aec7`:
- Flutter setup/platform generation: PASS.
- Approved screen geometry validation: PASS.
- 73-screen test gallery validation: PASS.
- `flutter pub get`: PASS.
- `flutter analyze`: PASS.
- `flutter test`: PASS — **53 tests passed**, including new v1 bridge compatibility and approved screen asset-path tests.
- Android debug APK: FAIL — Gradle wrapper download returned HTTP 504 for `gradle-9.3.1-all.zip`; build did not reach app compilation.
- Artifact upload: SKIPPED because APK build failed.

Classification: infrastructure/network failure at Gradle distribution download, not a demonstrated Dart compile/test failure. Still, workflow is not green and the APK is not verified. Retry must be against the then-current exact branch SHA. No merge.
