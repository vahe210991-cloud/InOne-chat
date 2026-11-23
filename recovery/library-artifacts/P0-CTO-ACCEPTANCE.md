# InOne P0 — CTO acceptance checklist

This checklist is the release gate for the local `cto/p0-exact-pending-commit` branch. A source change is not considered accepted until its relevant Rust/Node/PostgreSQL checks pass.

## F1 — Welcome recovery

- [ ] `GroupAlreadyExists` is not treated as proof of a malformed Welcome. Retain the Welcome without ACK, mark only that room `RecoveryRequired`, and continue processing healthy rooms.
- [ ] `LibraryError` is treated as indeterminate: no quarantine and no server ACK.
- [ ] A local storage failure before the quarantine transaction commits leaves the Welcome unacknowledged.
- [ ] If quarantine is committed but ACK fails, restart/retry ACKs the same durable quarantine record without duplicating or losing it.
- [ ] A bad Welcome in one room does not prevent healthy rooms from syncing.

## F4 — Membership journal

- [x] `operation_id_reused` is a conflict, not an ordinary rejection; keep the journal/pending state and set `RecoveryRequired`.
- [x] A `RecoveryRequired` room stays blocked after an ordinary consistency check.
- [ ] Before merge/clear/delete, compare the persisted fingerprint of the local OpenMLS pending `StagedCommit` with the fingerprint stored atomically alongside the exact journal operation; epoch equality alone is insufficient.
- [ ] `epoch_outdated` is handled by structured server code `epoch_outdated`; clear pending only when the journal/pending fingerprint matches.
- [ ] `operation_pending`, `operation_id_reused`, 401/403/404, 429, 5xx and network failures preserve the journal and pending Commit; `operation_id_reused` also marks `RecoveryRequired`.
- [ ] Access failures (401/403/404) do not get misreported as MLS corruption.
- [ ] Tests cover response lost after server acceptance, duplicate replay, conflicting operation ID, local restart, and database failure at each transaction boundary.

## F5 — Event identity

- [x] Missing, null, non-string, empty and whitespace-only `event_id` are rejected instead of being stored under an empty key.
- [x] A response-contract error does not mark the MLS room as corrupted; other rooms continue syncing.
- [ ] Rust integration test is executed in CI and passes, including retry after the malformed response is corrected.

## Verification gates

- [ ] Rust client: `cargo check --locked --all-targets` and `cargo test --locked --no-fail-fast`.
- [ ] Node in-memory suite passes.
- [ ] PostgreSQL suite and migration path pass on a clean database and upgrade path.
- [ ] CI runs against the actual P0 branch, not the archived 0.6.0 snapshot.
- [ ] No P0 merge into `main` before all gates above pass.

## Current local verification snapshot

- Node syntax check: 137 JavaScript/MJS files passed.
- Focused client-screen common + auth-contract tests: 10/10 passed, including login/approval/waiting/identity-check, verified registration, recovery and error messages.
- Full Node suite: blocked at module loading because `qrcode` is missing from `node_modules` in this environment.
- Rust and Flutter checks: blocked because their SDKs are not installed in this environment.
- PostgreSQL acceptance: not run here.

## CTO follow-up work in the local branch (verification pending)

- F1: `GroupAlreadyExists` no longer maps to permanent Welcome quarantine. It leaves the server Welcome unacknowledged, marks only the affected room `RecoveryRequired`, and continues processing other rooms. Added an integration scenario that replays an old Welcome while a healthy room has a pending Welcome.
- F1: `LibraryError` is now described as indeterminate; it is not quarantined or ACKed.
- F4: if the server definitively rejects an operation but the local pending commit does not match the journal's expected epoch/state, the client now preserves the journal and marks the room `RecoveryRequired` instead of deleting the record.
- F4: added a regression test for a definitive rejection with a missing local pending commit.
- These are source changes and added tests only. Rust execution remains unverified because this environment has no Rust toolchain.

## Local follow-up implementation (2026-11-08)

The current local branch contains additional source changes for F1/F4:

- `GroupAlreadyExists` is now a separate Welcome outcome: no quarantine/ACK, room-specific recovery marker, and processing continues for other Welcomes.
- Membership journal rows now store a versioned SHA-256 fingerprint over operation ID, room ID, exact journal payload, and serialized OpenMLS pending `StagedCommit`; settlement requires an exact fingerprint and epoch match. Legacy rows with a null fingerprint are retained for recovery rather than settled.
- `epoch_outdated` now has a structured server code. `operation_id_reused` is handled as a conflict; access failures and ambiguous responses preserve the journal.
- Added Rust tests for duplicate Welcome isolation, pending-Commit fingerprint mismatch, restart/replay, definitive rejection with missing pending Commit, structured response classification, and retained F5 event-ID contract checks.

**Acceptance status:** these Rust tests are authored but not executed in this environment because Cargo/Rust are unavailable. Node syntax checks and the focused client-screens common tests pass; full Node suite is blocked by missing `qrcode` dependency in the restored checkout. No PostgreSQL or end-to-end acceptance is claimed.


## Additional local work — shared mobile session handoff

- [x] `connect_with_session` opens the persistent MLS store using the access/refresh tokens already issued to the Flutter email-authenticated session; it does not call `/register` or `/login`.
- [x] Rust `Client::renew` serializes one-time refresh-token rotation with `renew_lock`.
- [x] Rust exposes `refresh_session` and `session_tokens` for the future native binding.
- [x] Added `tests/session_reuse.rs` to reopen MLS using an existing authenticated session.
- [ ] Run Rust check and the new integration test in a Rust 1.91+ environment.
- Local commit: `6fe6b67 fix(mls): reuse authenticated mobile session safely`.
- [ ] Implement and device-test Android/iOS binding; this repository still has no native handler or FFI packaging.