# MLS production acceptance — execution tracker

**Date:** 2026-11-23  
**Main baseline:** `2430b0365ab71c60b0926b27854d17a9090e1fba`  
**Working branch:** `work/mls-production-acceptance-2026-11-23`  
**Draft PR:** #132  
**Detailed audit:** [Post-PR #131 Beta 1.0 acceptance audit](2026-11-23-post-pr131-beta1-acceptance-audit.md)

## Executive decision

Keep `INONE_MLS_NATIVE_ENABLED=false` by default. The source implementation is extensive, but P0 Welcome crash consistency, exact-SHA validation, physical two-device Android/iOS acceptance and production operations remain open. **NOT READY** for Beta 1.0 release acceptance.

## Verified baseline

- PR #131 is merged into main at the baseline SHA above.
- PR #131 head checks: 19/19 PASS.
- Main push runs on the merge SHA: seven completed PASS; OpenMLS FRB iOS native-assets compile is IN_PROGRESS; Native MLS iOS Keychain target job was cancelled in attempt 1 and targeted rerun is QUEUED in attempt 2.
- Production mobile Rust dependency points to canonical Engine B at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`. Engine A is not production.
- OpenMLS provider and client journal share one SQLCipher connection; inbound application and inbound Commit processing use a transaction-aware provider. Child-process SQLCipher restart tests for these paths and inbox journal boundaries exist on main.
- SQLite default journal mode is used by canonical Engine B. WAL is not enabled and WAL-specific crash recovery is not claimed.
- `INONE_MLS_NATIVE_ENABLED` is explicitly false by default.
- Production FCM sender and encrypted PostgreSQL `push_deliveries` outbox already exist and are wired by `engine/src/main.js`. Live provider/device delivery remains unaccepted.
- Beta recovery custom scheme `inone://recovery/confirm` is configured by generated Android/iOS build scripts. Production App Links/Universal Links are not configured without a real owner-supplied domain.
- No physical two-device Android/iOS acceptance has been performed.

## A. P0 — MLS crash consistency, Issue #1

### Main evidence

- Inbound application event: shared SQLCipher transaction for OpenMLS state + inbox + processed marker; child-process restart tests exist.
- Inbound Commit: transaction-backed OpenMLS merge + client journal; child-process restart tests exist.
- Durable inbox: persists before application ACK; restart/ACK idempotency tests exist.
- Actual SQLCipher files are used in child-process tests, not only memory stores.

### Gap found and branch implementation

Welcome group materialization, `client_rooms` and Welcome receipt were not in one transaction on main. PR #132 changes the Welcome path to use a transaction-backed OpenMLS provider and commit group state, room index and receipt together. ACK is sent only after COMMIT; pending ACK retry remains available.

Added five failpoints and a child-process SQLCipher restart test for:
1. after OpenMLS group materialization;
2. after room-index write;
3. after Welcome receipt write;
4. before transaction COMMIT;
5. after transaction COMMIT.

**Not yet compiled or executed.** Outbound Commit accepted/response-lost reconciliation, Flutter/native ACK lifecycle and WAL-specific behaviour remain proof gaps. Issue #1 remains OPEN.

## B. P1 — regressions added on this branch

- Issue #5: invalid UTF-8 followed by a valid message in the same room; asserts Unreadable record, later valid delivery, unchanged epoch and no RecoveryRequired.
- Issue #9: local TCP proxy injects HTTP 401/403/404 for the room-events sync request; asserts sync returns the access/not-found error without RecoveryRequired, then restores access and verifies delivery in the same room.
- Issue #114: canonical Engine B dependency and current Rust FFI/Dart adapter are present; physical platform/runtime proof remains.
- Issue #6: durable SQLCipher inbox and ACK/replay tests exist; Flutter/native physical ACK lifecycle remains.

These new P1 regressions have not yet been compiled or executed. Issues #114, #6, #5 and #9 remain OPEN.

## C. Exact-SHA validation

Code-validation SHA on PR #132: `87930a5997b9ceb7aea44409b1e0d07020d3c82f`. Nine PR workflows, including the exact-SHA acceptance gate, were queued at 16:23Z. Subsequent commits on this branch update only documentation and do not change Rust/Flutter source. No completed test result for the new Welcome/P1 regressions is available yet.

Do not treat a queued workflow as PASS. If any job fails, download its logs, identify the precise cause, fix on this branch (still separate from main), and rerun applicable exact-SHA checks.

## D. Physical two-device acceptance

Not run. Use the detailed matrix in the post-PR131 audit report. Required: Android and iOS devices with distinct identities; Welcome; bidirectional text; offline outbox/retry/dedup; encrypted attachments; forced process death at send/receive/ACK boundaries; device revocation and participant removal; session restore; logout/key purge; 401/403/404; unreadable event.

CI Android emulator Keystore smoke and unsigned iOS simulator/device-target builds are supporting evidence only.

## E. Push, recovery and operations

### Push

The production sender exists. Do not implement a duplicate sender. Remaining: configure Firebase project and independent push encryption key in a secret manager; run live provider smoke; verify real Android FCM and iOS FCM→APNs foreground/background/terminated receive, tap, token refresh, logout and revocation. No plaintext in payload.

### Recovery

Test generated custom-scheme intent/URL registration on physical devices, confirmation, repeat-open, expired/reused token and revoked-device recovery. Production Universal/App Links require the real domain, package/signing fingerprint and iOS app/team identifiers; do not invent them.

### Infrastructure

Backup/restore scripts and tests exist, but DB and FILES_DIR archives are separate, not atomic. External encrypted backup, WAL/PITR, production restore rehearsal, alerting/monitoring, HTTPS/proxy, SMTP provider/domain SPF/DKIM/DMARC, production secrets and runbook remain open.

## F. Rules

- No changes to main and no merge of PR #132 without owner approval.
- No issue or PR closures without owner approval and evidence.
- No Engine A production dependency, plaintext fallback or weakened SQLCipher/Keychain/Keystore controls.
- No new backend routes without an approved contract.
- No production enablement of native MLS without separate owner permission.
- WBS v1.1 remains unchanged.

## Current status

- Main SHA: `2430b0365ab71c60b0926b27854d17a9090e1fba`.
- PR #132 remains draft; no merge.
- P0 Issue #1 and P1 Issues #114/#6/#5/#9 remain open.
- Physical acceptance: NOT RUN.
- Implementation / verification / release readiness estimates: 90% / 73% / 58%.
- Release recommendation: **NOT READY**.
