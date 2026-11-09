# Daily InOne UI / P0 / MLS audit — 2026-11-09 13:02 Europe/Tallinn (UTC+2)

> **LIVE CI ADDENDUM — 2026-11-09 13:06 (UTC+2):** After the Flutter asset-bundle fix and passing `flutter analyze`/`flutter test` on head `8b27e14ac067ffa68618b5ab53a609c148eb06a8` (run #42605486693; Android APK build was still in progress), a final WebView policy review found that the host still allowed external `unpkg.com` / Google Fonts subresources and `data:` subframes. Commit `7d356aa0b46d9e00a7b8391f657a08d173bc1764` now blocks remote subresources and data frames; only inert `about:blank` is allowed for subframes. PR #37 head is now `7d356aa0b46d9e00a7b8391f657a08d173bc1764`; latest exact-head run [#42606366859](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42606366859) is queued, so the final SHA is **not yet CI-verified**. No merge.

**Session type:** scheduled repository audit and safe CI correction.  
**Repository:** `vahe210991-cloud/InOne-chat`.  
**Main snapshot:** `faa5b8b682b8e1328a58b97bcf5770d1286efa8a`.  
**UI runtime PR:** [#37](https://github.com/vahe210991-cloud/InOne-chat/pull/37).  
**UI branch:** `feat/ui-approval-webview-runtime-2026-11-09`.  
**UI base SHA:** `faa5b8b682b8e1328a58b97bcf5770d1286efa8a`.  
**UI exact head SHA:** `8b27e14ac067ffa68618b5ab53a609c148eb06a8`.  
**Documentation branch:** `automation/daily-audit-2026-11-09-1303`; documentation PR [#38](https://github.com/vahe210991-cloud/InOne-chat/pull/38) is open/draft and not merged to `main`.

## Executive status

- **Flutter UI Beta 1.0:** implementation **35%**, verified readiness **15%** (owner-approved WBS row; unchanged). PR #35 and #36 are merged. PR #37 is open/draft and GitHub reports it mergeable, but its latest CI run is not yet complete and device acceptance has not been performed.
- **Backend/API Beta 1.0:** implementation **65%**, verified readiness **55%** (WBS baseline; unchanged).
- **Accepted P0 backend/Rust/OpenMLS core:** **100% / 100% for the P0 acceptance scope**. PR #25 is merged; all six required jobs passed on the exact PR head and again post-merge. This does not mean native Flutter MLS integration is complete.
- **Native MLS / mobile security / local storage:** implementation **35%**, verified readiness **25%** (WBS baseline; unchanged). Android/iOS native handlers, production FFI packaging, platform DB-key providers, durable mobile message persistence and device E2E are still absent/unverified.
- **Beta 1.0 overall:** **42% implementation / 31% verification**. **Beta 2.0:** **2% / 0%**. Historical qualitative InOne overall: **25%**. WBS v1.1 remains unchanged and owner-approved.

## 1. Flutter UI Beta 1.0

### Repository and PR state

- Original owner archive `Ui.zip` is present on `main`; SHA-256: `cdff61b36673d45332f4809c5a42f1978e715adb3e4dcf280c96d92f3aa758bb`.
- PR [#35](https://github.com/vahe210991-cloud/InOne-chat/pull/35) merged the Flutter integration foundation.
- PR [#36](https://github.com/vahe210991-cloud/InOne-chat/pull/36) merged the imported UI package. The remote tree contains 31 HTML screen files, 32 HTML files including package index, and five WOFF2 fonts. Its documented CI run [#42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987) passed 15/15 workflow steps on the recorded input SHA.
- PR [#37](https://github.com/vahe210991-cloud/InOne-chat/pull/37) is **OPEN / DRAFT / mergeable=true** at head `8b27e14ac067ffa68618b5ab53a609c148eb06a8`. It connects the owner-approved HTML handoff screens to the Flutter WebView and uses the typed bridge. No merge was attempted.

### Failure found and correction committed

Previous PR #37 run [#42603592680](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42603592680) failed at `flutter test`: **54 passed, 1 failed**, because `assets/ui-approval/screens/auth/SC-01.html` was not in Flutter's asset bundle.

Root cause: `pubspec.yaml` declared only `assets/ui-approval/`. Flutter directory declarations include files directly in that directory, not arbitrary nested folders. The official [Flutter asset documentation](https://docs.flutter.dev/ui/assets/assets-and-images) requires a separate entry for each subdirectory.

Corrections committed to PR #37:
- `c1fbf23a2bdfad5d7a7fa5a8c9fdc2651a44978d` — explicitly declare all screen-category folders and local font/icon/image folders in `mobile/pubspec.yaml`.
- `d16b4b46df46cb0050350fe3a50a88842b0b398d` — extend asset tests to load all 31 HTML screens and all five local WOFF2 fonts.
- `afa34e944dced1e728a33878892e038a70d4adf3` — constrain approved WebView file URLs to exact bundled path segments; reject traversal, double-encoded traversal, hosts, queries and fragments.
- `8b27e14ac067ffa68618b5ab53a609c148eb06a8` — add traversal and fake-bundle regression cases.

### Latest exact-head CI

Latest run [#42605486693](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42605486693) is on exact head `8b27e14ac067ffa68618b5ab53a609c148eb06a8`.

At the time of this report:
- PASS — Flutter setup and platform project generation.
- PASS — approved cross-platform geometry validation.
- PASS — original `Ui.zip` SHA check and nested UI package verification/import.
- PASS — 73-screen test gallery verification.
- PASS — `flutter pub get`.
- PASS — `flutter analyze`.
- PASS — `flutter test`, including nested HTML/font bundle checks and local file-path traversal tests.
- IN PROGRESS — Android debug APK build.
- NOT STARTED — artifact upload (waiting for APK build).
- NOT RUN — iOS build, Android/iOS physical-device visual parity, keyboard/safe-area/back-navigation acceptance.

The 22 canonical approved variants (11 light + 11 dark) pass the source geometry gate. This is not yet proof of rendered pixel parity on physical Android and iOS devices. The 31 imported handoff HTML screens are a separate source catalog and are not a replacement for the 22 canonical variants. The current host is still WebView-based; gradual native Flutter porting is not yet accepted.

### API boundary

The bridge currently exposes a limited allowlist of supported calls. The screen catalog also declares routes that are not in that allowlist; in particular `CH-02` declares `GET /rooms/:id/events`, which remains unresolved for this UI integration. Unknown calls fail closed and display an unavailable state. Do not add route handlers until the backend contract and implementation are verified.

## 2. Backend P0 / MLS / source integrity

### Accepted P0 scope

- PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) merged as `97024ab03ce9583e298ee946f3679565007405ca`.
- Exact PR-head run [#42496739362](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362): all six required jobs PASS.
- Post-merge run [#42503694744](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744): all six jobs PASS — Rust format, OpenMLS client, backend Node, Rust bridge, PostgreSQL integration and room-list regression.
- Main advanced from the post-merge P0 code snapshot to `faa5b8b...` through UI/docs work. Comparison found no subsequent executable P0 engine changes; the only changed file under the archived engine path was the P0 acceptance-map document.
- Accepted P0 source provenance is recorded in [P0 closure report](../recovered-source/P0-CLOSURE-2026-11-08.md). The accepted owner bundle SHA-256 is `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e` and is retained on `artifacts/p0-bundles`.

### Historical recovery PR corrections

- PR [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22) is **merged**, despite stale recovery documentation saying it was open. Its run [#42471062557](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42471062557) failed at Rust formatting; Node, room-list, PostgreSQL, OpenMLS and Rust bridge steps passed. It is not the final P0 acceptance evidence; PR #25 is.
- PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) remains **OPEN / DRAFT** at head `2776a275a5b74a2458759beb106846262cc5c3f0`. Run [#42460862472](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42460862472) passed its validation job but failed its publish job because the published engine subtree did not match the validated candidate.
- The separate Wave 3 recovery lineage still has an incomplete 240-base-path blob-hash audit and six substantive delta/five added-test provenance review. Keep that audit distinct from the accepted PR #25 snapshot; do not conflate their bundle hashes or histories.

### Native mobile MLS and protected storage

Repository inspection confirms:
- Rust `mls-client` contains SQLCipher-backed storage and a `KeyStore` interface; the only `KeyStore` implementation found is `MemoryKeyStore` for tests.
- The separate Rust `mls-bridge` currently keeps its `World` in process memory.
- Flutter `InOneSession` stores the stable device ID through `flutter_secure_storage`, but access/refresh tokens remain in memory; this is not a native MLS database-key provider.
- No Android/iOS `MethodChannel` MLS handlers or production Rust FFI packaging were found on `main`.
- No production Keychain/Keystore DB-key adapter, durable on-device message store, persistence-before-ACK flow, or two-device restart/offline E2E was verified.

MLS send/decrypt must remain fail-closed. No plaintext fallback. Incoming messages must not be ACKed before durable local persistence.

## 3. Green / red / blocked checks

| Area | Check | Result |
|---|---|---|
| UI PR #37 head `8b27e14` | Geometry, archive integrity/import, gallery, pub get, analyze, Flutter tests | **PASS** |
| UI PR #37 head `8b27e14` | Android debug APK build and artifact upload | **IN PROGRESS / NOT YET VERIFIED** |
| UI PR #37 | iOS build and physical-device parity | **NOT RUN** |
| UI prior head `5c5e791` | Flutter tests | **FAIL** — 54 pass / 1 fail, nested HTML asset missing; corrected on new head, new CI tests pass |
| P0 PR #25 | PR-head six-job acceptance | **PASS 6/6** |
| P0 merged main | Post-merge six-job acceptance | **PASS 6/6** |
| Legacy PR #22 | Rust formatting | **FAIL**; other functional jobs passed |
| Legacy PR #18 | Publish subtree integrity gate | **FAIL**; do not use as accepted source |
| Native MLS | Android/iOS handlers, FFI, secure DB key provider, durable message store, device E2E | **NOT RUN / NOT IMPLEMENTED** |

No PR was merged in this session. No server, database, deployment, or paid Codespace was started.

## 4. Cumulative readiness (owner-approved WBS v1.1)

| WBS direction | Weight | Implementation | Verification |
|---|---:|---:|---:|
| Backend/API and data | 25% | 65% | 55% |
| Frontend Flutter and approved UI | 25% | 35% | 15% |
| API ↔ UI integration | 15% | 35% | 20% |
| MLS, mobile security and storage | 20% | 35% | 25% |
| QA, CI and E2E | 10% | 50% | 45% |
| DevOps and release readiness | 5% | 20% | 10% |
| **Beta 1.0 overall** | **100%** | **42%** | **31%** |

No percentage uplift: source import and unit tests do not yet prove runtime rendering, live API integration, native MLS, secure persistent storage or device E2E.

## 5. Последние 5 предыдущих задач

1. ~~[x] Утверждён WBS v1.1 и зафиксирован baseline 42% / 31%.~~ [PROGRESS-BASELINE.md](../PROGRESS-BASELINE.md)
2. ~~[x] Проверен исходный `Ui.zip`, его SHA-256 и вложенный пакет; импортированы 31 HTML-экран и пять WOFF2.~~ [PR #36](https://github.com/vahe210991-cloud/InOne-chat/pull/36), [run #42586579987](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42586579987)
3. ~~[x] Интеграционный фундамент Flutter/WebView catalog/typed bridge сохранён в main.~~ [PR #35](https://github.com/vahe210991-cloud/InOne-chat/pull/35)
4. ~~[x] UI archive import объединён в main; исходники доступны в удалённом дереве.~~ [PR #36](https://github.com/vahe210991-cloud/InOne-chat/pull/36)
5. [ ] **IN PROGRESS** — PR #37: исправить вложенную упаковку assets и завершить exact-head CI на `8b27e14...`; Flutter tests уже PASS, Android APK build ещё выполняется.

## 6. Следующие 5 задач

1. [ ] **IN PROGRESS** — завершить run [#42605486693](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42605486693) на точном SHA `8b27e14...`; при сбое исправить причину и проверить новый SHA.
2. [ ] **NOT STARTED** — установить preview APK и проверить все 22 канонических варианта на Android; выполнить iOS build/device parity на macOS.
3. [ ] **BLOCKED** — сверить API каждого handoff screen с backend; отдельно закрыть контракт `CH-02 GET /rooms/:id/events` до подключения действия.
4. [ ] **NOT STARTED** — реализовать Android/iOS MLS handlers и Rust FFI, Keychain/Keystore-backed SQLCipher key provider и durable local message store; ACK только после транзакции persistence.
5. [ ] **BLOCKED** — завершить 240-file blob-hash/provenance audit отдельной Wave 3 recovery lineage и затем провести two-device MLS send/receive/offline/restart E2E.

## 7. Tooling and limitations

- GitHub API connector used for repository/PR/branch/file/workflow/job/log inspection and isolated branch commits.
- No local Flutter or Dart executable is installed in the automation container; validation is therefore taken only from GitHub Actions, not claimed as a local run.
- Current GitHub connector exposes workflow-run/job inspection and rerun operations, but no direct workflow-dispatch operation. The latest PR #37 run was automatically triggered by the branch update and is being monitored.
- No merge, deploy, server start, database exposure or paid Codespace creation was performed.
