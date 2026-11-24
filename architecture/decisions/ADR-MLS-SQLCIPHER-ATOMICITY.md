# ADR: MLS state and client journal atomicity

- Status: **Proposed — pending CTO review**
- Date: 2026-11-20
- Scope: canonical source `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`
- Pinned storage dependencies: `openmls_sqlite_storage = 0.2.0`, `rusqlite = 0.32`

## Post-PR #131 audit update — 2026-11-23

Current `main` SHA: `2430b0365ab71c60b0926b27854d17a9090e1fba`. Production mobile FFI now depends on canonical Engine B; the former Engine A linkage note in older issue descriptions is stale.

Source inspection confirms one shared SQLCipher connection for the OpenMLS provider and client journal, plus transaction-aware provider writes for inbound application processing and inbound Commit processing. `tests/outbox.rs` contains child-process restart tests against real SQLCipher files for application ratchet writes, inbound Commit merge and post-COMMIT recovery, and inbox journal boundaries. The database helper does not enable WAL; no WAL-specific recovery is claimed.

The post-merge audit found that Welcome group materialization, the `client_rooms` index and the durable Welcome receipt still used separate write boundaries. Draft PR #132 now changes Welcome materialization to use a transaction-backed provider and commits the group state, room index and receipt together. It adds failpoints after group materialization, room-index write, receipt write, before COMMIT and after COMMIT, plus a child-process SQLCipher restart test for those five boundaries.

**This Welcome change is not yet compiled or executed.** It is not accepted evidence and does not change this ADR's Proposed status. Outbound Commit server-acceptance/reconciliation, Flutter/native ACK lifecycle and WAL-specific crash behaviour remain unproven. Keep Issue #1 open until exact-SHA tests and independent review pass.


## Context

OpenMLS group state and the InOne client journal must not commit independently. If an inbound application message advances the MLS receive ratchet but the durable inbox/event marker is not committed, replaying the same server event after restart can fail or be misclassified. The same failure window exists while applying an inbound staged Commit and advancing the group epoch.

The canonical client already opens one SQLCipher database connection shared by `Client.meta` and the OpenMLS storage provider. Inbound application-message processing uses a transaction-backed provider. Before this change, inbound Commit processing and `merge_staged_commit` used the ordinary provider, outside an explicit client transaction.

## Decision proposed

Use one long-lived `Arc<openmls_sqlite_storage::Connection>` for the client journal and OpenMLS provider. For each MLS state transition that must be atomic with client-owned records:

1. Start `Connection::unchecked_transaction()` on that shared connection.
2. Construct a temporary `DeviceProvider` whose storage connection borrows that transaction.
3. Perform OpenMLS storage writes through that transaction-backed provider.
4. Write the associated client journal / quarantine / cursor records through the same transaction.
5. Commit only after every operation succeeds; on any failure, drop the transaction and reload the affected `MlsGroup` from durable storage before retrying or quarantining.

The migrations must run before the shared `Arc<Connection>` provider is constructed. Do not call `run_migrations()` through the shared provider: the migration API requires mutable access that `Arc<Connection>` does not provide.

This design uses the pinned crate's public `Borrow<Connection>` provider contract and `unchecked_transaction(&self)`; it does not use unsafe shared SQLite handles and does not require a fork of OpenMLS storage.

## Compatibility and safety constraints

- Keep the exact dependency pins until a separate compatibility review approves changes.
- Keep SQLCipher enabled for the actual device database; memory databases and fake providers are insufficient evidence.
- Never mark a server event processed before the MLS state and durable inbox/diagnostic row have committed together.
- Never publish an updated group epoch if the associated transaction fails.
- On rollback, discard in-memory group state that may have observed uncommitted writes and reload it from the shared durable connection.
- Preserve existing database schema and rows; any schema migration must be additive, versioned, and separately reviewed.

## Required verification before acceptance

- [ ] Compile the canonical `mls-client` crate and native bridge with the pinned lockfile.
- [x] Application message: inject process termination after OpenMLS ratchet/storage writes and before inbox/event-marker writes; restart a separate process against the same SQLCipher database and key; verify the exact ciphertext is decryptable once and no unreadable record is created (covered by process_crash_after_application_ratchet_write_rolls_back_and_redelivers).
- [x] Application message: inject a normal journal-write failure; verify transaction rollback and exact-event redelivery (covered by inbox_write_failure_rolls_back_mls_state_and_allows_server_redelivery).
- [x] Commit: inject process termination after staged Commit merge writes and before transaction commit; restart and verify the prior epoch remains loadable and the same Commit can be applied exactly once (covered by process_crash_after_inbound_commit_merge_rolls_back_epoch_and_retries).
- [x] Commit: verify successful merge and associated epoch state survive restart together (covered by the post-crash retry assertions in process_crash_after_inbound_commit_merge_rolls_back_epoch_and_retries).
- [ ] Exercise crash points immediately before and after transaction commit (pre-COMMIT is covered; post-COMMIT coverage is added by process_crash_immediately_after_inbound_commit_transaction_commit_keeps_epoch and awaits CI execution on this revision).
- [x] Run process-kill/reopen tests against real SQLCipher database files with the same device key. The client currently uses SQLite's default journal mode; WAL is not enabled by this PR and is not claimed as tested.
- [ ] Run all canonical MLS client, Rust bridge, Android and iOS checks on the final head SHA (previous SHA passed; rerun is required after this revision).
- [ ] CTO review approves the transaction boundary, failure semantics, and migration/backward-compatibility story.

## Current implementation note

The P0 branch changes inbound Commit processing and staged-Commit merge to use a transaction-backed OpenMLS provider and reloads the group after rollback paths. Existing application-message processing already uses this transaction pattern. This ADR remains **proposed** until process-kill/restart tests and CTO review pass.

## Explicitly not claimed

A rollback test triggered by a SQL INSERT failure is not a process-crash test. A successful unit/integration suite is not a substitute for terminating a child process while the SQLCipher transaction is open. This ADR does not claim that outbound commit lifecycle, Welcome materialization, or Flutter/native acknowledgement lifecycle are already proven atomic.

## Backward-compatibility evidence

This PR does not add, remove, or alter a client-owned SQL table, index, column, constraint, or OpenMLS storage dependency. The build_client SQL DDL block in mls-client/src/lib.rs is byte-for-byte identical to the PR base commit b877d883f8ad8c731c784b82729e18f7d5523fc9 (3,212 bytes); the crate Cargo.toml is also byte-for-byte identical to that base. The change is limited to transaction ownership for inbound Commit processing, debug-only failpoints, and integration tests. Existing database files are opened using the same SQLCipher key path and the same migration-before-shared-connection sequence. No data migration is introduced. This is an explicit unchanged-schema compatibility statement, not a claim that every historical database fixture has been independently replayed.

The database open helper does not enable WAL; these tests therefore claim SQLCipher file crash/reopen coverage in the configured default journal mode only. WAL-specific behavior is intentionally not claimed.


## Exact-SHA verification update — 2026-11-24

The following source and test changes are present on PR #132 at code-validation SHA `aabc64cc8bb74981fa0fe20c626f48761b556f7d`:

- Welcome group materialization, `client_rooms` and durable Welcome receipt share one transaction-backed OpenMLS provider. Five child-process SQLCipher crash/restart boundaries cover post-materialization, post-index, post-receipt, pre-COMMIT and post-COMMIT.
- Outbound membership Commit recovery has six child-process crash/restart boundaries covering journal commit, server acceptance, local OpenMLS merge, journal settlement, pre-COMMIT and post-COMMIT. Recovery asserts exact operation replay and one server-side Commit settlement.
- Inbox ACK transaction tests cover process termination immediately before and after COMMIT.

The exact-SHA Native MLS client validation passed on `aabc64cc8bb74981fa0fe20c626f48761b556f7d`, including canonical Engine B formatting, target checks, P1 MLS regressions, persistent bridge lifecycle tests and OpenMLS attachment/session integration tests. The recovered P0 source workflow also passed. Flutter mobile, Flutter iOS (including unsigned simulator/device-target build), FRB generation (including Android native assets/Keystore smoke and iOS native-assets compile), backend Compose, Dev Container, Email/PostgreSQL and the exact-SHA acceptance gate all passed on the same SHA. The first gate attempt timed out while FRB remained queued; rerunning the gate after FRB completed passed.

This is CI evidence for the default SQLite journal mode only. WAL remains disabled and is not claimed. Physical two-device Android/iOS acceptance and separate CTO/owner review remain outstanding. Accordingly, this ADR remains **Proposed pending independent review**, and Issue #1 remains open pending owner disposition. Native MLS remains disabled by default.
