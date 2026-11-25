# InOne Beta 1.0 — Stage 4 Database Integrity Audit

**Date:** 2026-11-25  
**Branch:** `security/beta1-stage4-db-integrity-2026-11-25`  
**Base:** `main`  
**Dependency:** Stage 3 exact-SHA CI acceptance on `bd7d8d5e5cdee594f77e399ac3d37252e463263b` (PR #152 remains Draft/unmerged)  
**Status:** Initial source audit complete; remediation implementation not yet accepted

## Scope

Stage 4 covers B-07 (ephemeral security-state retention), B-12 (organization owner invariant and admin atomicity), and B-14 (FCM registration lifecycle race).

## Findings

### B-07 — Expired security-state cleanup is incomplete

The runtime sweep in `engine/src/server.js` calls `storage.purgeExpired`, `storage.clearExpiredCodes`, `storage.purgeRetired`, rejected organization request cleanup and file cleanup.

The PostgreSQL schema includes `rate_limits` and `login_throttle` tables. The inspected `purgeExpired` / `clearExpiredCodes` cleanup paths cover inbox, access/refresh/auth tokens, recovery cancellation codes, phone/email codes and recovery secrets, but do not currently delete stale rows from `rate_limits` or `login_throttle`.

**Risk:** persistent growth of per-key throttling state. Cleanup must be bounded, index-supported, and preserve active windows/blocks. Do not delete counters that are still enforcing a live limit.

**Remediation direction:** define conservative stale cutoffs from the actual window/block semantics; add supporting indexes if query plans require them; use bounded batch deletion and return bounded counts. Keep memory-store and PostgreSQL semantics aligned. Add tests proving active counters survive and stale counters are deleted idempotently.

### B-12 — Organization owner invariant and audit are not atomic

In `engine/src/server.js`, role demotion, member removal and member leave perform role/count/owned-room checks before calling separate storage mutations. The last-owner check uses `countOrgOwners`, followed by `setOrgMemberRole` or `removeOrgMember`. Audit writes are separate calls to `logAdminAction`.

In `engine/src/store.js`, `removeOrgMember` already uses a transaction to lock the target membership row and remove room memberships plus the organization membership. However, the last-owner count/check is outside that transaction, and the audit insert is also outside it. `setOrgMemberRole` and `setOrgSetting` likewise persist their mutation and audit data as separate statements. This leaves race and partial-audit failure windows.

**Risk:** concurrent owner demotions/removals/leaves can violate the last-owner invariant; a failed audit insert can leave a committed admin mutation without its corresponding audit record.

**Remediation direction:** introduce storage-level atomic commands that lock a stable organization row first, re-read actor/target roles and owner count under that lock, enforce room ownership constraints, perform mutation and insert the audit event in one transaction. Apply the same invariant to role demotion, member removal and self-leave. Make settings changes and their audit entries atomic. Preserve existing authorization policy and HTTP response semantics. Memory store should expose deterministic equivalent behavior for unit tests.

### B-14 — FCM stale-registration cleanup can cancel newer deliveries

In `engine/src/push-delivery.js`, invalid-target handling deletes `push_tokens` conditionally using both `device_key` and the previously read `token_ciphertext`. This is a useful compare-and-delete guard: a newly registered token with a different ciphertext is not directly deleted.

However, the following update cancels every `queued` or `failed` delivery for the device, without tying cancellation to the stale registration generation or to the conditional delete result. A re-registration and new enqueue racing with this path can therefore cause valid deliveries for the newer registration to be cancelled. The cleanup steps are not grouped into one transaction.

**Risk:** valid notifications may be silently discarded after a device re-registers while an older send is failing.

**Remediation direction:** make invalid-registration handling a transaction. Lock/read the current registration and perform compare-and-delete. Only cancel deliveries if the stale registration was actually removed, and scope cancellation to the affected generation/registration snapshot. Ensure a newly registered token and deliveries created for it remain intact. Avoid storing raw FIDs; use existing encrypted token material and conditional predicates. Add a deterministic PostgreSQL race test with barriers: worker reads old registration, device re-registers and enqueues, old send fails, then cleanup runs. Assert new registration and new delivery remain.

## Existing protections to preserve

- Push registration identifiers are encrypted at rest; do not introduce plaintext FID storage.
- Push outbox payloads remain encrypted and contain no message plaintext.
- Retry classification and worker lease ownership remain unchanged except where transactionally necessary.
- Existing room/org authorization and owner/admin/member role policy must not be broadened.
- Ready-file retention remains out of scope and must not be invented as part of security-state cleanup.

## Stage 4 acceptance tests

1. **B-07:** PostgreSQL and memory-store tests for stale versus active rate-limit and login-throttle rows; bounded batch behavior; idempotent repeated sweep; indexes/query-plan review.
2. **B-12:** concurrent attempts to demote/remove/leave multiple owners; exactly one owner remains; all rejected operations return stable conflict; audit insert failure rolls back mutation; settings mutation and audit are atomic; room-owner constraint remains enforced.
3. **B-14:** deterministic re-registration race between old invalid-target response and new registration/enqueue; new registration survives; new delivery remains eligible; stale delivery is cancelled; repeated cleanup is idempotent.
4. Complete backend Node suite, PostgreSQL integration/concurrency suite, Compose migration/API smoke and exact-SHA required workflow gate must pass on one immutable final SHA.

## Execution constraints

- Work only on this Stage 4 branch and its Draft PR when created.
- Do not modify `main`, merge PR #152 or Stage 4, deploy, change repository settings, or mutate secrets.
- Stage 3 PR #152 remains Draft/unmerged pending owner authorization.
- Do not weaken existing security assertions to make tests pass.
- Do not implement ready-file automatic expiry without a separate owner-approved retention policy.


## Work started after initial audit

B-07 implementation has begun on this branch:
- PostgreSQL cleanup now prunes stale `rate_limits` rows after the longest configured rate window (24 hours), and `login_throttle` rows only after both the 15-minute maximum throttle window and any active block have expired.
- Each table cleanup is bounded to 500 rows per sweep.
- Added migration `0034-expired-security-state-indexes.sql` with indexes for the cleanup predicates/order.
- Memory-store cleanup mirrors the same cutoffs.
- Added memory-store regression for stale versus active windows/blocks and a PostgreSQL regression that verifies stale rows are removed while active rows survive.

Relevant current Stage 4 branch head: `820572acf77fa8353f1aabf36e56df4d34c114bb`.

**Validation caveat:** no CI checks have been run for this Stage 4 branch yet. B-07 is not accepted until the branch is complete and the full exact-SHA gate passes. B-12 and B-14 remain to be implemented.
