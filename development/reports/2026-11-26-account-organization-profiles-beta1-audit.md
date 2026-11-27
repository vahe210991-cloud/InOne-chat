# Account & Organization Profiles — Beta 1.0 audit report

**Date:** 2026-11-26 (UTC+4)  
**Repository:** vahe210991-cloud/InOne-chat  
**Audited main SHA:** 7d34b99fcc026a828b838e211d039c575aeace1d  
**Previous source baseline:** 920e2a2ecef244c925061348eb68c8b09fe63922  
**Plan:** [ACCOUNT-ORGANIZATION-PROFILES-BETA-1.0-IMPLEMENTATION-PLAN.md](../ACCOUNT-ORGANIZATION-PROFILES-BETA-1.0-IMPLEMENTATION-PLAN.md)  
**Status:** SOURCE REVIEW COMPLETE / TESTS NOT RUN / IMPLEMENTATION NOT STARTED

## Executive result

- Personal owner profile is partial: authenticated own-account GET, locale update and device/security navigation exist; general profile editing and profile media binding do not.
- Personal guest profile is not implemented. Relationship-gated user search is not a guest profile API.
- Organization owner/admin/member management exists through server-side role checks and transaction-backed membership/settings operations.
- Organization guest profile is not implemented. No public organization profile route/DTO was found.
- Organization schema contains core identity, membership, operational settings, logs and links. It does not contain description/category/contact/address/logo/cover profile fields.
- Organization Flutter screen is connected to name/status/role/roster. About/projects/teams/logo/cover remain null/unbound; edit-cover callback is null.
- **P0:** organization member removal deletes server-side room memberships without corresponding MLS Remove Commit/epoch transition. Same cross-module root cause as CHAT-P0-01 from unmerged PR #166. This confirms server/MLS consistency defect; direct retrieval of new ciphertext by removed user was not proven.
- Static review did not establish a separate confirmed P0/P1 profile data disclosure vulnerability. This is not dynamic penetration testing.

## Finding counts

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 1 | Organization membership removal / MLS consistency |
| P1 | 2 | Missing guest personal and organization profile capabilities; conditional on approved Beta 1.0 privacy/scope |
| P2 | 8 | Missing editing/media/ownership transfer/lifecycle and regression coverage |
| P3 | 1 | Placeholder profile/organization metrics |

P1 findings are functional gaps, not confirmed exploitable vulnerabilities.

## Source map

- Canonical backend: inone-development-archive-0.6.0/engine.
- Personal account DTO: mobile/lib/core/data/inone_profile.dart.
- Organization DTO: mobile/lib/core/data/inone_organization.dart.
- Flutter host: mobile/lib/app/inone_mobile_app.dart.
- Personal and organization screens: mobile/lib/ui_dart_source/screens/main/.
- Organization SQL: migrations 0020, 0022, 0023.
- Profile locale SQL: migration 0030.

## Privacy baseline

Owner-approved variant В remains unchanged. Do not add public-by-default profiles, new visibility/block/follow semantics or expanded access. Own-account DTO is not a guest DTO. GET /users/search returns only userId, nickname, verificationLevel after authentication, rate limiting and sharesOrgOrLink checks. No email/phone are returned.

## Related PRs

- #166 Chats & Groups audit: open Draft; contains related P0 direct room-member removal / MLS Remove Commit finding. Not merged.
- #161 organization picker: open Draft; not current main.
- #127 organization requests integration: open Draft, stale base/dirty; not accepted.
- #87/#89 organization request/document lifecycle: open, unmerged.
- #42 PostgreSQL org-link race verification: open Draft; not proof of current-main PostgreSQL test execution.

## Verification boundary

- Exact main status endpoint returned no registered commit statuses (total_count=0).
- No backend, PostgreSQL, Flutter, Rust, build, dynamic security, production or physical-device tests were run.
- Test files were inspected as source only. No PASS is claimed.
- No application source, API, migration, configuration or Flutter UI was changed.
- WBS v1.1 and privacy variant В were not changed.

## Next work

1. Fix PROFILE-SEC-001 with CHAT-P0-01: MLS-safe organization member removal.
2. Complete own-profile/search/device privacy regression tests.
3. Verify owner/admin/member organization operations on PostgreSQL exact SHA.
4. Obtain owner decisions on guest fields, public organization data, edit fields and media scope.
5. Implement only approved Beta 1.0 fields and guest views.
6. Add profile media lifecycle only with explicit access and content-validation rules.
7. Complete Flutter widget/integration and exact-SHA acceptance.

No tasks were closed or crossed out. No WBS percentage was recalculated.


## WBS and task continuity

- Approved WBS v1.1 baseline remains unchanged: Beta 1.0 42% implementation / 31% verification; Beta 2.0 2% / 0%. This audit does not recalculate progress.
- Five prior/related project work items reviewed as existing context: (1) authenticated own-profile DTO and locale integration; (2) organization membership/role model; (3) organization settings and admin audit; (4) generic device-bound file delivery; (5) FEED/PROFILE source audit and privacy variant В.
- Five next work items: (1) PROFILE-SEC-001 / CHAT-P0-01 MLS-safe organization member removal; (2) PROFILE-CORE-001 and PROFILE-PRIVACY-001 backend regression coverage; (3) ORG-CORE-001 and ORG-ROLES-001 exact PostgreSQL authorization verification; (4) owner decision on guest visibility/editable fields/media; (5) approved Flutter/API implementation and exact-SHA acceptance.
- Task branch: audit/account-organization-profiles-beta1-main-7d34b99-20261126.
- Documentation PR: to be recorded after creation. No merge is authorized.


## Publication record

- Documentation PR: [#170](https://github.com/vahe210991-cloud/InOne-chat/pull/170), Draft / open / not merged.
- Task branch: audit/account-organization-profiles-beta1-main-7d34b99-20261126.
- PR creation head: b87ccb24fb6d200362974ab0f0f897add9f0903e. Subsequent documentation-only updates produced final branch head 91dd53d7b164579ca04266a7844f32d016bc0cdd at the last verification; the PR head metadata remains authoritative.
- Merge SHA: pending; no merge is authorized.
- Tests: NOT RUN.


- PR #170 has seven GitHub Actions check runs queued on exact head 91dd53d7b164579ca04266a7844f32d016bc0cdd; no completed result is claimed. They include general repository workflows and are not a substitute for the profile-specific acceptance matrix.


## Remediation handoff — 2026-11-26

- PROFILE-SEC-001 implementation is in progress in [Draft PR #173](https://github.com/vahe210991-cloud/InOne-chat/pull/173).
- PR #173 blocks direct room-member deletion after an MLS epoch, organization member removal/leave while MLS-protected memberships remain, and organization-link revocation while inherited MLS memberships remain.
- The backend returns 409 with affected room IDs; valid MLS Remove Commits must be applied before retrying organization removal/link revocation.
- Regression tests were added for direct room DELETE, organization member removal, organization self-leave and cross-organization link revocation.
- Current exact implementation head at handoff: 1d36d809d111b6d7da73bdbaa98115e0e3f85c6b.
- 11 GitHub Actions checks were queued on that exact SHA. Results are pending; tests are not reported as passed.
- This is a fail-closed backend safety patch, not yet a complete multi-room removal UX. PR remains Draft and unmerged.


## Remediation execution update — 2026-11-27

- PR #173 remains Draft/open/unmerged. Exact base: `7d34b99fcc026a828b838e211d039c575aeace1d`.
- Implementation head advanced to `4ea0cd4df246778ea1ee171e768f50f48910a4bb`.
- First CI on prior head `1d36d809d111b6d7da73bdbaa98115e0e3f85c6b` completed with failures in backend Node, PostgreSQL integration, Native MLS and the exact-SHA gate. Review identified stale legacy-DELETE test paths, an escaped template-literal syntax error, a PostgreSQL link/room lock-order inversion, and Rust consistency assertions that expected legacy server mutation to reconcile MLS state.
- Corrective commits updated tests to use MLS Remove Commits, repaired the self-leave test syntax, changed link revocation to acquire the link row lock before room locks (matching open-join), and updated consistency assertions to preserve room-scoped recovery when only server membership metadata is changed.
- The cross-organization MLS regression now explicitly asserts that the linked user is a room member and that the room epoch is active before checking revocation behavior.
- Current-head GitHub Actions runs are queued/in progress, including Backend Node/PostgreSQL, Native MLS, P0 source validation, Compose runtime, Dev Container and exact-SHA acceptance. No PASS is claimed until all required jobs complete successfully on the exact head.
- The remediation is still a backend fail-closed guard. Multi-room Flutter orchestration remains a follow-up; do not mark PROFILE-SEC-001 complete or strike it through.
- No database migration, release flag, product policy or WBS change has been made.
