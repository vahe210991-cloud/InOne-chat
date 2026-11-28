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
- **Privacy decision:** Owner approved variant В. Preserve the existing privacy model without changes. Do not add new public/private rules, visibility preferences, block/follow semantics, or wider access. Missing public-profile/feed policy is not permission to expose data.
- **Release scope:** The approved WBS v1.1 includes Profile but does not include a dedicated Feed workstream. The strategic product direction mentions news feed and publications. Whether Feed enters Beta 1.0 remains an owner decision; do not change WBS weights or release scope without explicit approval.

## 2. Findings and priorities

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 0 | No confirmed critical vulnerability/data-loss issue in reviewed paths |
| P1 | 1 | FP-001: missing feed/posts subsystem, conditional release blocker only if Feed is approved for Beta 1.0 |
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

- Source review covered the canonical Node/PostgreSQL backend, SQL schema/migrations, Flutter/Dart profile model/repository/screen wiring, API contract matrix, relevant tests, product decisions, WBS v1.1, repository rules, and related PR inventory.
- Main advanced from source snapshot `216c6d9` to `920e2a2` by two documentation-only commits. The FEED/PROFILE source paths, API, schema, migrations, and Flutter implementation did not change in that interval.
- **NOT RUN:** Node tests, PostgreSQL tests, Flutter/Dart tests or builds, Rust/OpenMLS tests, Android/iOS builds/device tests, production checks, dynamic BOLA/IDOR tests, load tests, destructive tests, and live penetration testing.
- Existing test files were inventoried but were not treated as passing evidence.
- No product source, SQL schema/migration, configuration, workflow, or Flutter screen was changed.
- WBS v1.1 weights, baseline percentages, commercial policy, and release scope were not changed.

## 5. Previous work reused

1. Canonical backend ownership decision: `inone-development-archive-0.6.0/engine`.
2. Existing authenticated own-profile and locale flow.
3. Existing generic file upload/download authorization and storage controls.
4. Existing native Flutter/Dart own-profile screen integration.
5. Approved WBS v1.1 and current Beta 1.0/Beta 2.0 scope boundary.

No implementation was repeated and no old HTML/WebView screen was restored.

## 6. Next actions

1. Resolve `SCOPE-001`: explicitly decide whether minimum Feed/posts belongs in Beta 1.0 or remains Beta 2.0. Do not alter WBS v1.1 without approval.
2. Complete `PROFILE-CORE-001`: add backend HTTP and Flutter regression coverage for authenticated own-profile read, locale, revoked device, DTO allowlist, and malformed response.
3. Complete `PROFILE-PRIVACY-001`: protect current auth, relationship, owner/device, and room-membership boundaries without inventing new visibility semantics.
4. If Feed is approved for Beta 1.0, version the WBS scope change first, then implement `FEED-SEC-001`, post lifecycle, list/cursor, media, and required security tests in dependency order.
5. Keep public-profile, public media, blocks, follows, and new visibility controls blocked until a separate explicit product decision authorizes their semantics.

## 7. Publication and hand-back

- Plan path: `development/FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md`.
- Plan initial publication commit: `8260beb7070d959dce17ee423e2768dbea4399c9`.
- Plan follow-up documentation commit: `9166a82448d2e06847e7212982aeecaf0acb9f19`.
- Current plan blob SHA: `08b1f984a3ded0543d5c20670c9b4e1d5d6e07ab`.
- Draft PR #167 was closed as superseded after the direct documentation-only publication; its task branch was retained.
- No test/build/CI PASS is claimed for this audit. No WBS percentage was changed.
