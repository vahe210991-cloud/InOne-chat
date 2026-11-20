# Issue #1 — MLS SQLCipher crash-consistency verification

Date: 2026-11-20  
Repository: `vahe210991-cloud/InOne-chat`  
Implementation commit: `d3a88cf15a35d7c24a03c793e92086633493b101`  
Merge commit: `e629fd35a53147f8372fc5e2bd52ab042a23e766`

## Verified implementation

The merged implementation uses one shared SQLCipher connection for the OpenMLS provider and client-owned journal. Inbound application-message processing and inbound Commit merge use transaction-backed OpenMLS storage. Rollback paths reload in-memory group state from durable storage. No schema migration was introduced; the SQL DDL block and crate dependency manifest were unchanged against the PR base.

## Exact-head CI evidence

The following five workflow runs completed successfully for implementation SHA `d3a88cf15a35d7c24a03c793e92086633493b101`:

| Workflow | Run ID | Result |
|---|---:|---|
| Validate recovered InOne P0 source | 44738132915 | success |
| Native MLS client validation | 44738132873 | success |
| Email delivery and PostgreSQL validation | 44738132890 | success |
| Flutter mobile validation | 44738132853 | success |
| Flutter iOS validation | 44738132822 | success |

All 13 jobs inspected completed successfully. Android APK build, Android Keystore/SQLCipher runtime smoke, iOS simulator build, iOS device build, canonical MLS client tests, Rust bridge tests, backend Node suite, PostgreSQL integration suite and Rust formatting all passed.

## Process-crash/restart evidence

The OpenMLS client test log from job `136294625501` confirms:

- `process_crash_after_application_ratchet_write_rolls_back_and_redelivers` — passed.
- `process_crash_after_inbound_commit_merge_rolls_back_epoch_and_retries` — passed.
- `process_crash_immediately_after_inbound_commit_transaction_commit_keeps_epoch` — passed.

The relevant test group completed with `8 passed; 0 failed`. Tests use real SQLCipher database files and reopen them in a separate process using the same deterministic test device key. The application-message test verifies redelivery/decryption once, no unreadable record, durable inbox visibility and acknowledgement behavior. The Commit tests verify rollback of the uncommitted epoch and persistence of the committed epoch/membership after process death.

## Acceptance boundaries and remaining work

This evidence closes the implemented inbound application-message and inbound Commit atomicity paths only. It does **not** establish:

- a crash-injection point at every individual client journal write boundary (for example, between inbox row insertion and processed-marker insertion);
- outbound Commit lifecycle atomicity;
- Welcome materialization atomicity;
- Flutter/native acknowledgement lifecycle atomicity;
- WAL-mode crash consistency (WAL is not enabled or claimed by this implementation).

The implementation uses SQLite's configured default journal mode. No schema migration is introduced. Existing SQLCipher key handling and migration-before-shared-connection order are retained.

## CTO gate

Issue #1 explicitly requires a separate CTO review before acceptance. No formal CTO approval/review record was found in GitHub at the time of this report. The PR #105 merge is historical repository state and must not be interpreted as proof that this governance gate was satisfied.

**Disposition:** technical implementation and listed exact-head CI evidence are verified; Issue #1 must remain open pending CTO review and a decision on the remaining crash-point matrix/scope limitations. Do not represent this report as CTO approval.
