# ADR: MLS state and client journal atomicity

- Status: **Proposed — pending CTO review**
- Date: 2026-11-20
- Scope: canonical source `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`
- Pinned storage dependencies: `openmls_sqlite_storage = 0.2.0`, `rusqlite = 0.32`

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
- [ ] Application message: inject process termination after OpenMLS ratchet/storage writes and before inbox/event-marker writes; restart a separate process against the same SQLCipher database and key; verify the exact ciphertext is decryptable once and no unreadable record is created.
- [ ] Application message: inject a normal journal-write failure; verify transaction rollback and exact-event redelivery.
- [ ] Commit: inject process termination after staged Commit merge writes and before transaction commit; restart and verify the prior epoch remains loadable and the same Commit can be applied exactly once.
- [ ] Commit: verify successful merge and associated epoch state survive restart together.
- [ ] Exercise crash points immediately before and after transaction commit.
- [ ] Run tests against real SQLCipher files, including WAL/reopen behavior.
- [ ] Run all canonical MLS client, Rust bridge, Android and iOS checks.
- [ ] CTO review approves the transaction boundary, failure semantics, and migration/backward-compatibility story.

## Current implementation note

The P0 branch changes inbound Commit processing and staged-Commit merge to use a transaction-backed OpenMLS provider and reloads the group after rollback paths. Existing application-message processing already uses this transaction pattern. This ADR remains **proposed** until process-kill/restart tests and CTO review pass.

## Explicitly not claimed

A rollback test triggered by a SQL INSERT failure is not a process-crash test. A successful unit/integration suite is not a substitute for terminating a child process while the SQLCipher transaction is open. This ADR does not claim that outbound commit lifecycle, Welcome materialization, or Flutter/native acknowledgement lifecycle are already proven atomic.
