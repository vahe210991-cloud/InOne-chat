# P0 acceptance map


## Final release result — CLOSED

- PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) merged to `main`: `97024ab03ce9583e298ee946f3679565007405ca`.
- All six required jobs passed on exact PR head `addd47da245b6452c9f700c7e10b8d0585aad295` in [workflow run #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362).
- The PR-head P0 acceptance suite passed in run #124, PR #25 is merged, and post-merge validation on `main` completed successfully in [run #134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744): all six jobs passed. Native Flutter Beta 1.0 integration and device-level E2E are separate scope.
- See `development/recovered-source/P0-CLOSURE-2026-11-08.md` for provenance, merge and CI details.



## P0.2 — membership metadata

- Server schema/store: migration `0025-mls-commit-change-metadata`, PostgreSQL store and memory-store parity.
- API: commit history exposes normalized Add/Remove changes and Welcome recipients.
- Client: staged OpenMLS proposals are compared with server metadata before merge.
- Regression: `tests/consistency.rs` tampered-metadata scenario; backend and PostgreSQL metadata round-trip tests.

## F1 — Welcome recovery

- Durable room membership lookup: `client_rooms` plus in-memory group cache.
- Duplicate Welcome / `GroupAlreadyExists`: retain the Welcome, persist sticky `RecoveryRequired`, do not ACK.
- Permanent malformed Welcome: persist quarantine receipt transaction before ACK.
- `LibraryError` / `StorageError`: treat as indeterminate; do not quarantine or ACK.
- ACK retry: durable unacked receipts are retried after restart.
- Regression: `tests/welcome_recovery.rs`, `tests/welcome_receipt_recovery.rs`.

## F4 — membership journal

- Persist exact staged-Commit fingerprint atomically with the membership journal.
- Server request fingerprint binds the exact commit payload and membership metadata; identical operation replay is idempotent, different content under the same operation ID conflicts.
- Verify fingerprint before merge/clear; mismatch retains journal and sets sticky `RecoveryRequired`.
- Retryable network/access failures preserve journal and pending Commit.
- `epoch_outdated` clears only a matching staged Commit and rebases from the newly committed epoch.
- Regression: `tests/membership_journal.rs`, `test/mls-idempotency.test.js`, PostgreSQL replay/restart tests.

## F5 — event identity

- Validate event ID and epoch contract before processing or marking processed.
- Malformed identity is not ACKed/marked processed and does not poison unrelated rooms.
- Regression: malformed event identity scenarios in OpenMLS client tests.

## P0.3 — room-scoped recovery

- `client_waiting_for_commit`: durable expected epoch and pending future-event IDs for a room; sends blocked only in that room; clears when missing Commit is applied.
- `client_commit_quarantine`: durable room/epoch/SHA-256/reason record for permanent Commit failures; exact quarantined bytes are not reprocessed.
- Transient fetch/process/merge failures remain retryable and are not permanently quarantined.
- Regression: `tests/waiting_for_commit.rs`, `tests/commit_quarantine.rs`.

## KeyPackage claim/replay

- Durable server reservation and exact response persistence under claim ID; PostgreSQL transaction and memory-store parity.
- Encrypted client intent persists across retry/restart; accepted membership Commit finalizes the claim.
- Regression: `test/mls-keys.test.js`, membership journal OpenMLS scenarios, PostgreSQL integration tests.

## Release rule

P0 acceptance is complete: PR #25 is merged into `main` at `97024ab03ce9583e298ee946f3679565007405ca`; all six workflow jobs passed on the exact PR head in run #124. Do not reopen this gate without a reproducible regression.


## Beta 1.0 mobile runtime P0 extension — OPEN (2026-11-23)

The historical PR #25 closure above applies to the recovered backend/Rust/OpenMLS acceptance scope from 2026-11-08. It does **not** close the later mobile-runtime crash-consistency acceptance tracked by Issue #1.

Current source of truth is `main` SHA `2430b0365ab71c60b0926b27854d17a9090e1fba`, with PR #131 merged. Production mobile FFI now links canonical Engine B at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`; the old Engine A linkage assertion is obsolete.

Current evidence:
- Shared SQLCipher connection and transaction-aware OpenMLS provider exist for inbound application processing and inbound Commit processing.
- `tests/outbox.rs` includes child-process restart coverage against real SQLCipher files for application ratchet writes, inbound Commit merge/commit and inbox journal boundaries.
- SQLite's default journal mode is used; WAL is not enabled and WAL recovery is not claimed.
- The post-PR131 audit found Welcome group materialization, `client_rooms` and Welcome receipt were not in one transaction. Draft PR #132 adds a transaction-backed Welcome operation, five crash failpoints and a child-process SQLCipher restart test. These changes have not yet compiled or run.
- Outbound Commit server-acceptance/reconciliation and Flutter/native ACK lifecycle remain unproven.

**Disposition:** Issue #1 remains OPEN. Do not reinterpret the historical PR #25 closure as Beta 1.0 mobile runtime acceptance. Do not close Issue #1 or enable native MLS until every required boundary passes on one exact SHA and physical-device acceptance is separately complete.
