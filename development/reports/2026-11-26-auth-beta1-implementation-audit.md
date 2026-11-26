# InOne Beta 1.0 — AUTH implementation and backend wiring audit

**Date:** 2026-11-26  
**Owner instruction:** take the AUTH Beta 1.0 plan into implementation, connect registration/login/recovery screens to real backend contracts, preserve the canonical task checklist and do not close tasks before review, exact-SHA checks, and merge.  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Working branch:** `feat/auth-senior-backend-implementation-2026-11-26`  
**Implementation snapshot before this report:** `2d51cdc4f7c7ebadc47c1c4d1d8d5cfb47e5aaad`  
**Base:** forked from the then-current parallel AUTH work branch at `3522e428b711f26233d3667ab63435421542e895`; its migration-runner/schema tests were preserved.  
**Merge state:** not merged to `main`.  
**Test state:** NOT RUN. No test is reported as PASS.

## 1. Source-of-truth review

Reviewed the canonical AUTH plan, repository working rules, mobile API contract, mobile session implementation, auth screen widgets, backend server/store, recovery rules, PostgreSQL schema/migrations, and the relevant existing tests.

The canonical Beta 1.0 backend in this change set is `inone-development-archive-0.6.0/engine`. The separate `inone-engine-poc-0.6.0` copy was not modified as part of this backend task.

## 2. Defects addressed in this implementation branch

### AUTH-01 — registration email enumeration

- Removed the early “email already registered” branch from `POST /register/email/confirm`.
- Removed the pre-ticket existing-email check from `POST /register`. Existing-account detection now occurs only after a valid registration ticket has been checked inside the atomic account-creation transaction.
- Added coverage asserting identical responses for an existing and an unknown email when no valid confirmation code/ticket exists.

### AUTH-02 — registration ticket could be consumed before account creation

- Added `createVerifiedAccountWithEmailToken` to the PostgreSQL and in-memory stores.
- Email ticket validation/consumption and account/profile/default-membership creation now share one transaction.
- Unique-constraint failure or account-creation rollback preserves the registration ticket, allowing a safe retry.
- Added PostgreSQL rollback/retry/replay coverage.

### AUTH-04 — device approval UI was not connected end-to-end

- Added host-session APIs for listing pending approvals, approving, denying, and claiming a pending login.
- The poll secret remains in the session object; it is not returned to the screen.
- SC-11 displays only the short approval code and polls the claim endpoint at a bounded interval.
- The authenticated trusted device polls `GET /approvals` while foregrounded, presents an approve/deny dialog, and sends the code to the approval endpoint.
- Added a safe exit from the pending-approval screen and terminal handling for denied/expired/invalid claims.
- **Remaining security gate:** a trusted device with a biometric-protected signing key requires a platform biometric grant. No bypass was added. That platform bridge remains BLOCKED.

### AUTH-05 — post-recovery identity code was reusable/unbounded and not device-bound

- Added persisted expiry, device binding, challenge ID, resend timestamp, and lockout fields to recovery state.
- Added migration `0036-recovery-identity-challenges.sql`; updated `schema.sql`, migration runner markers/version, and PostgreSQL mapping/update statements.
- Challenge hash is bound to user ID, device ID, and challenge ID.
- Rules: 1-hour expiry, 60-second resend cooldown, maximum 5 wrong attempts, 1-hour lockout.
- Repeated requests inside the cooldown reuse the active challenge without sending duplicate email.
- Resend preserves wrong-attempt count; a different device cannot reuse a challenge issued to another device.
- Updated Flutter login contract to submit `identityCode` with `identityChallengeId`.
- Added integration coverage for binding, resend throttling, expiry, and lockout, plus PostgreSQL persistence/migration coverage.

### AUTH-06 — “not me” actions could conflate admission cancellation and recovery cancellation

- SC-10 now dispatches pending-device admission cancellation to `POST /admission/cancel`.
- Recovery cancellation by code uses the separate `POST /recovery/cancel-by-code` endpoint.
- SC-07 now exposes a recovery-cancellation entry into SC-10.
- Added API tests asserting that the two flows use distinct unauthenticated endpoints.

### AUTH-07 — recovery finalization could clear the window before all devices were revoked

- Recovery window state is no longer closed before old-device cleanup.
- The durable recovery-window marker remains active until every pre-window device has completed the idempotent cleanup sequence.
- If a cleanup step fails, a later authenticated request retries cleanup, including already-revoked device records, before closing the window.
- Added fault-injection coverage for failure after the device has already been marked revoked.

### AUTH-10 — password length was not bounded consistently

- Added a shared 8–128 Unicode-code-point policy.
- Hashing rejects out-of-policy values; password verification returns false before invoking scrypt for invalid/oversized input.
- Registration and recovery enforce the same bounds; login uses the bounded verifier.
- Auth UI password fields are capped at 128; one-time code/PIN fields are capped at six digits.
- Added unit tests for boundary values and Unicode code points.

## 3. Screen wiring changes

- SC-01 login now handles normal login, waiting-period, device-approval, and post-recovery identity-check states.
- SC-03 supports registration code entry and identity-code entry with a challenge ID and resend action.
- SC-04 registration submits through the host session and the atomic registration backend path.
- SC-07 starts recovery and exposes the separate recovery-cancellation code path.
- SC-08 stages recovery deep-link data in memory and performs the mutating confirmation request only after explicit user action; Back discards the staged payload.
- SC-09 completes recovery with the new password and existing recovery code.
- SC-10 distinguishes admission cancellation from recovery cancellation.
- SC-11 handles the waiting period and device approval code/claim lifecycle.
- SC-12 logout clears transient approval, identity-challenge, and recovery-link state.
- SC-05/SC-06 provider login remains explicitly blocked until native provider SDK proof acquisition and client configuration exist; no fake provider success was introduced.

## 4. Test inventory added or updated

All are **NOT RUN** in this session:

- `mobile/test/core/session/device_approval_api_test.dart`
- `mobile/test/core/session/recovery_api_test.dart`
- `mobile/test/ui_dart_source/screens/auth/sc08_recovery_confirm_screen_test.dart`
- `mobile/test/ui_dart_source/screens/auth/sc11_login_waiting_screen_test.dart`
- `inone-development-archive-0.6.0/engine/test/account-rules.test.js`
- `inone-development-archive-0.6.0/engine/test/dev-email-code.test.js`
- `inone-development-archive-0.6.0/engine/test/recovery.test.js`
- `inone-development-archive-0.6.0/engine/test/registration-email-delivery-db.test.js`
- `inone-development-archive-0.6.0/engine/test/migrate.test.js`

No local test run or CI run is claimed. The final test suite must run only after the implementation/review pass is complete and against one exact final commit SHA.

## 5. Remaining blockers requiring owner decision or platform capability

1. **AUTH-03 phone policy:** decide whether a verified phone is mandatory for Beta 1.0, when registration must block, and whether unverified accounts may use the product. SMS confirmation UI is not yet connected.
2. **AUTH-04 biometric grant:** add a platform-backed biometric grant bridge for trusted devices with signing-key protection. Server-side checks remain fail-closed.
3. **AUTH-08 recovery policy:** decide whether email-only recovery is permitted for accounts without a verified phone and define the permitted restrictions.
4. **AUTH-09 session restore:** persistent refresh-token restoration must remain Rust/platform-owned. The native session runtime is still opt-in; do not introduce Dart preferences/plaintext token persistence.
5. **Provider sign-in:** Google/Apple native SDKs and client configuration are absent; screens remain blocked rather than pretending to authenticate.

## 6. Acceptance and next actions

- Keep AUTH-01 through AUTH-12 unchecked and uncrossed in the canonical plan.
- Complete source review and resolve any static/type/format issues.
- Obtain owner decisions for AUTH-03 and AUTH-08; keep AUTH-04 biometric and AUTH-09 Rust runtime gates explicit.
- Run the focused backend, PostgreSQL migration, Flutter analyze, widget, and session API suites only after code is ready, then run the applicable full Beta 1.0 suite on one exact SHA.
- Update the canonical AUTH plan with final evidence, open/update a PR, require independent review, and merge only after the unified task-completion rule is satisfied.

**No task is marked complete by this report.**
