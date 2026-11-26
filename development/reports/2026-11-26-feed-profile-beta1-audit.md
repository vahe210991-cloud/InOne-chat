# FEED / PROFILE Beta 1.0 — audit report

**Date:** 2026-11-26 (UTC+4)  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Source snapshot:** `main` at `216c6d9ea4e825182d3fc94b7aa6d9841e0ad250`  
**Revalidated main:** `920e2a2ecef244c925061348eb68c8b09fe63922`  
**Plan initial publication commit:** `8260beb7070d959dce17ee423e2768dbea4399c9`  
**Plan follow-up documentation commit:** `9166a82448d2e06847e7212982aeecaf0acb9f19`  
**Plan:** [FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md](../FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md)  
**Status:** SOURCE REVIEW COMPLETE / RUNTIME AND RELEASE ACCEPTANCE NOT RUN

## 1. Executive result

- **FEED:** NOT IMPLEMENTED / NOT CONNECTED. No production post/feed domain, API routes, SQL tables, typed repository operations, or production Flutter feed screens were found.
- **PROFILE:** PARTIAL / READ-ONLY. Authenticated own-profile `GET /profile`, `PATCH /profile/locale`, typed DTO/repository, and native own-profile screen exist. General profile editing, other-user profile read, and avatar/cover binding are absent.
- **MEDIA:** Generic file upload and signed-download infrastructure exists, including owner/device binding and room-membership checks. A profile/social media lifecycle does not exist.
- **SECURITY:** Static source review did not establish a confirmed P0/P1 vulnerability in the reviewed current profile/file routes. This is not a dynamic penetration-test result.
- **Privacy decision:** Owner-approved variant В remains binding for profiles and non-feed account data. The owner has separately approved a narrow feed rule: every published item intentionally included in the general/news feed is readable by every registered and authenticated InOne account; anonymous access is denied. Attachments inherit the same rule and are re-authorized at download. The audited code still has no implementation of this policy, so cross-account reads must remain disabled until server-side enforcement and regression tests pass. `sharesOrgOrLink` remains a user-search gate only and is not reused for feed authorization.
- **Release scope:** Owner approved Feed in Beta 1.0 on 2026-11-26. WBS v1.2 adds Feed across existing workstreams without changing domain weights. Historical v1.1 percentages are not a current progress measurement for the expanded scope.

## 2. Findings and priorities

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 0 | No confirmed critical vulnerability/data-loss issue in reviewed paths |
| P1 | 1 | FP-001: missing Feed/posts subsystem, unconditional Beta 1.0 release blocker after owner scope approval |
| P2 | 6 | Profile editing/public profile/media lifecycle, profile API regression matrix, comments/reactions, future avatar validation |
| P3 | 1 | Profile statistics shown as placeholders |

The P1 item is a functional scope gap, not a confirmed exploitable security vulnerability. The plan contains per-finding evidence, locations, impact, reproduction, remediation, tests, acceptance criteria, dependencies, and release classification.

## 3. Privacy baseline — variant В

The audit preserves only existing source-supported boundaries:

1. `GET /profile` derives the account ID from the authenticated device/session.
2. `GET /users/search` is rate-limited, requires the existing `sharesOrgOrLink` relationship gate, and returns only `userId`, `nickname`, and `verificationLevel`.
3. Owner-only files require the owner and active user/device authorization; room files require room membership.
4. The own-account DTO is not a public social DTO.
5. No public-profile API, social visibility settings, blocks, or follow graph were found. Their absence must not be interpreted as public-by-default access.

If a future feature requires a privacy rule not present in the current approved model, stop and obtain a separate owner decision before implementation.

## 4. Scope and verification

- Source review covered the canonical Node/PostgreSQL backend, SQL schema/migrations, Flutter/Dart profile model/repository/screen wiring, API contract matrix, relevant tests, product decisions, WBS v1.1, repository rules, and related PR inventory. The owner-approved Feed scope amendment is recorded in WBS v1.2.
- Main advanced from source snapshot `216c6d9` to `920e2a2` by two documentation-only commits. The FEED/PROFILE source paths, API, schema, migrations, and Flutter implementation did not change in that interval.
- **NOT RUN:** Node tests, PostgreSQL tests, Flutter/Dart tests or builds, Rust/OpenMLS tests, Android/iOS builds/device tests, production checks, dynamic BOLA/IDOR tests, load tests, destructive tests, and live penetration testing.
- Existing test files were inventoried but were not treated as passing evidence.
- No product source, SQL schema/migration, configuration, workflow, or Flutter screen was changed.
- WBS v1.2 scope amendment preserves the existing domain weights and historical v1.1 baseline; no current progress percentage is recalculated. Commercial policy is unchanged.

## 5. Previous work reused

1. Canonical backend ownership decision: `inone-development-archive-0.6.0/engine`.
2. Existing authenticated own-profile and locale flow.
3. Existing generic file upload/download authorization and storage controls.
4. Existing native Flutter/Dart own-profile screen integration.
5. Approved WBS v1.1 and current Beta 1.0/Beta 2.0 scope boundary.

No implementation was repeated and no old HTML/WebView screen was restored.

## 6. Next actions

1. Implement `FEED-PRIVACY-001` according to the owner-approved rule: every published item intentionally included in the general/news feed is readable by every registered and authenticated InOne account; anonymous access is denied. Apply the same rule to attached media at download. This does not expose profiles, drafts or private account data.
2. Complete `PROFILE-CORE-001` and `PROFILE-PRIVACY-001`: add backend HTTP and Flutter regression coverage for authenticated own-profile read, locale, revoked device, DTO allowlist, and existing owner/device/room boundaries.
3. Implement the Beta 1.0 Feed workstream in security-first order: `FEED-SEC-001`, `FEED-CORE-001`, `FEED-LIST-001`, `FEED-PAGINATION-001`, secure media as scoped, native Flutter integration, then the exact-SHA regression matrix.
4. Keep comments/reactions and advanced social features out of the minimum scope unless separately approved.


## 7. Publication and hand-back

- Plan path: `development/FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md`.
- Plan initial publication commit: `8260beb7070d959dce17ee423e2768dbea4399c9`.
- Plan follow-up documentation commit: `9166a82448d2e06847e7212982aeecaf0acb9f19`.
- Current plan blob SHA: `08b1f984a3ded0543d5c20670c9b4e1d5d6e07ab`.
- Draft PR #167 was closed as superseded after the direct documentation-only publication; its task branch was retained.
- No test/build/CI PASS is claimed for this audit. No WBS percentage was changed.
