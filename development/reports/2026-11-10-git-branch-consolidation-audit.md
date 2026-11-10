# Git branch consolidation audit — 2026-11-10

Repository: `vahe210991-cloud/InOne-chat`
Default branch: `main`
Audited main SHA before this report: `8350a18865703c78d5991b66d3cc6899cdeeca1f`

## Findings

- GitHub inventory: 29 remote branches, 13 open PRs at audit time.
- Current main SHA `8350a188...` passed Flutter workflow #42630606199: platform generation, approved UI geometry, archive verification/import, 73-screen gallery, `flutter pub get`, `flutter analyze`, `flutter test`, Android preview APK and artifact upload.
- P0 workflow #42504163838 passed 6/6 jobs on `7a1db8e9...`: Rust format, Node suite, room-list regression, PostgreSQL integration, OpenMLS client and Rust bridge. Comparing that SHA with current main showed no changes under `inone-development-archive-0.6.0/engine/**`; this is engine-subtree continuity evidence, not a fresh P0 run on current main SHA.
- API transport PR #23 has a historical green Flutter run #42469418081, but its branch is 248 commits behind main and GitHub reports the PR non-mergeable. It must be reconciled and retested before porting.
- P0 recovery PR #18 passed its validation job but failed its publish-integrity gate. Snapshot PR #26 failed OpenMLS client tests. Neither is eligible for merge.
- PR #29 preview packaging passed but its publish workflow failed.
- PR #30 and PR #31 were closed as superseded after compare confirmed their heads are ancestors of main with zero unique file changes. PR closures did not modify source code.
- No PR was merged and no product source, dependencies, workflow or configuration were changed in this audit.

## Branch refs already contained in main

GitHub compare reported zero commits ahead and zero changed files for these refs. They are candidates for deletion after archival/retention policy is decided:

- `development` and `engine-poc` — exact duplicate head SHA `9b235223...`
- `feat/beta1-chat-room-list-data`
- `feat/beta1-full-screen-api-harness`
- `feat/claude-ui-beta1-integration`
- `feat/beta1-ui-source-integration`
- `task/ui-archive-import-2026-11-09`
- `recovery/p0-reimplementation`
- `recovery/p0-wave3-applied`
- `recovery/p0-wave3-rustfmt`

These refs were not deleted: the available GitHub connection exposes branch listing and ref updates, but no branch-delete operation. Force-moving a ref to main would destroy branch history and was not used.

## Branches to preserve

Do not delete these as duplicates: they contain unique source, reports, patches, workflows, product decisions or recovery artifacts, or have unresolved validation:

- `artifacts/p0-bundles` (no common ancestor with main)
- `audit/beta1-beta2-full-audit-2026-11-09`
- `automation/daily-audit-2026-11-09-1303` (its UI/CI status is stale and must be reconciled)
- `ci/inone-engine-validation-2026-11-07` (validation failed)
- `cto/inone-audit-2026-11-08`
- `docs/dev-report-2026-11-09-0809`
- `docs/flutter-screen-handoff-claude`
- `docs/inone-identity-design-localization`
- `docs/mandatory-ai-agent-protocol-2026-11-09` (draft PR, stale base)
- `feat/beta1-approved-html-webview` (tree not yet reconciled against main)
- `feat/beta1-backend-api-foundation` (historical green run, 248 commits behind, non-mergeable)
- `feat/inone-phone-web-preview` (publish failed)
- `feat/ui-approval-webview-runtime-2026-11-09` (PR #37 merged; compare still shows differing paths that require inspection)
- `planning/beta-2.0-roadmap`
- `recovery/p0-wave3-validation` (publish-integrity mismatch)
- `recovery/p0-wave3-validation-rerun` (no passing exact-head evidence found)
- `recovery/source-artifacts-2026-11-08` (patches explicitly reported as incompatible with archived source)
- `snapshot/p0-and-groups-2026-11-08` (snapshot export passed, OpenMLS validation failed)

## Consolidation rule

Use `main` as the sole integration baseline. Start future short-lived work from the exact current main SHA, require exact-head CI and a clean mergeable PR, and port only reviewed unique changes from stale branches. Do not merge stale branches wholesale.

## Not done

- No branch ref was deleted or force-updated.
- No product code was changed.
- No unverified PR was merged.
- No MLS native FFI, platform KeyStore, durable inbound message storage or iOS device acceptance is claimed complete.
