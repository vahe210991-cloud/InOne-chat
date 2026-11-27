# Feed Beta 1.0 domain foundation — 2026-11-27

## Result

**Status: IN PROGRESS / NOT ACCEPTED.** A first isolated domain-code slice and a draft API contract proposal were published on Draft PR #174. No production Feed endpoint or persistence path exists yet.

- Repository: `vahe210991-cloud/InOne-chat`
- Base branch: `main`
- Exact base SHA: `7d34b99fcc026a828b838e211d039c575aeace1d`
- Task branch: `feat/feed-domain-foundation-beta1-main-7d34b99-20261127`
- Code/proposal head before this report: `9130b709248d2e6e5c0d0d46561a4f5f096523c0`
- PR: [#174 — Feed domain foundation and API proposal](https://github.com/vahe210991-cloud/InOne-chat/pull/174), Draft, unmerged.
- Scope decision: Feed Beta 1.0 and authenticated cross-account published-feed reads are owner-approved. The separate documentation PR #172 remains Draft/unmerged.

## Changes

1. Added `engine/src/feed-rules.js`:
   - NFC normalization and newline normalization for plain-text post content;
   - proposed 5,000-code-point / 16-KiB bounds;
   - SHA-256 normalized-content hash;
   - opaque post-ID and idempotency-key format validation;
   - strict versioned cursor encode/parse;
   - deterministic newest-first ordering and bounded page slicing.
2. Added `engine/test/feed-rules.test.js` and imported it from the existing `test/api-contract.test.js`, so it is included by the current `npm test` entry without changing the package script.
3. Added [FEED-BETA1-API-CONTRACT-PROPOSAL.md](../architecture/FEED-BETA1-API-CONTRACT-PROPOSAL.md), explicitly marked DRAFT for owner review.

## Architecture findings preserved

- Canonical Node/PostgreSQL backend remains `inone-development-archive-0.6.0/engine/`.
- Existing routes authenticate through active device sessions.
- Current file flow is owner/device-bound or room-member-bound; it has no post association or authenticated cross-account Feed media path.
- Approved UI manifest has no Feed/post-composer screen. Production UI must be native Flutter/Dart; no HTML/WebView is restored.
- Open PR #171 changes the same server/store/schema/package areas needed for later Feed integration. Open PR #173 also changes server/store. They remain separate; no divergent feature branch was used as this task's base and none of their changes were copied into PR #174.

## Validation

At report creation, PR #174 exact-head workflows were queued/in progress:
- Backend Docker Compose runtime acceptance: run `45927486204`.
- Email delivery and PostgreSQL validation: run `45927486240`.
- Other repository acceptance workflows were also triggered by the engine-path change.

**No test is claimed PASS in this report.** Recheck all workflow/job conclusions on the current exact PR head after any branch update. No manual/local tests, production calls, deployment, or physical-device checks were performed.

## Scope not yet implemented

- No `/posts` or `/feed` HTTP routes.
- No PostgreSQL posts table/migration or in-memory post store.
- No idempotent create/edit/delete HTTP operations.
- No server-side cross-account feed read implementation.
- No post-media association or media upload/download support.
- No typed Flutter repository, Feed screen, or navigation activation.
- No comments, reactions, follows, subscriptions, public profiles, or ranking.

The proposed API routes, DTO, content limits, idempotency semantics, and text-first slice are proposals only until owner review. No implementation task is closed or struck through. WBS v1.1 weights and historical baseline percentages are unchanged; Feed scope amendment v1.2 remains in separate PR #172.

## Five previous tasks / evidence

1. Complete source audit of Feed and personal profile on the current backend/mobile tree.
2. Obtain owner approval to include Feed/publications in Beta 1.0.
3. Obtain owner approval that published general-feed items are readable by all registered/authenticated accounts and anonymous access is denied.
4. Confirm canonical backend ownership, active-device auth, current file authorization, and absence of Feed routes/tables.
5. Establish a unique task branch from the exact live `main` SHA and inspect overlapping open PRs.

## Five next tasks

1. Obtain owner review of the draft API contract and the first-slice boundary, especially text-only first increment versus media timing.
2. Recheck PR #171 AUTH and PR #173 MLS-security exact-SHA Actions/reviews; selectively integrate only after their owner-authorized merges, resolving shared-file changes without wholesale branch merges.
3. Implement posts schema/migration and PostgreSQL + in-memory store parity with atomic idempotency, ownership checks, revision control, and stable keyset query.
4. Implement authenticated HTTP routes and regression matrix: cross-account allow for published posts, anonymous/revoked-device deny, author-only edit/delete, cursor tampering, idempotency replay, and DTO privacy.
5. Add typed Flutter models/repository and a native Dart Feed/composer screen; implement secure media as a separate reviewed slice before exposing attachment UI.

## Acceptance status

| Criterion | Status |
|---|---|
| Domain validation/cursor foundation authored | IN PROGRESS, awaiting exact-SHA CI |
| API contract | DRAFT, owner review required |
| HTTP routes and persistence | NOT STARTED |
| Cross-account read enforcement | NOT STARTED |
| Media authorization and lifecycle | NOT STARTED |
| Flutter Feed UI | NOT STARTED |
| Beta 1.0 Feed acceptance | NOT ACCEPTED |
