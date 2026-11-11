# InOne Beta 1.0 — Stage 4 native MLS hardening progress

**Date:** 2026-11-11  
**Product stage:** Beta 1.0 only  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Base:** `main` at `94571cbc923ac4d29c3c684dbfdeb35f031d6a30`  
**Implementation branch:** `feature/stage-4-native-mls-runtime-2026-11-11`  
**Implementation HEAD at this report:** `df53ff48a42d9b9ca1dc7b19f049f8f3b05585a6`  
**PR:** [#45](https://github.com/vahe210991-cloud/InOne-chat/pull/45), OPEN / Draft / not merged

## 1. Work performed

The following implementation changes are present in the Stage 4 branch. They are **not accepted yet** because the required CI execution results are unavailable.

### MLS membership and recovery

- Added server-vs-local MLS membership reconciliation. A mismatch is persisted room-scoped and blocks writes to that room while other rooms can continue syncing.
- Added staged membership metadata verification (P0.2) against the actual OpenMLS staged Commit, including add/remove device changes and Welcome recipients.
- Added durable membership Commit journal with operation ID, base epoch, payload, claim IDs and cryptographic fingerprint.
- Added idempotent KeyPackage claim/reservation flow and invite intent state recovery.
- Added replay of an accepted membership Commit after a lost response, and stale-epoch clear/rebase handling.
- Added journaled device-removal Commits for revoked devices.
- Made invite-intent creation race-safe with `INSERT OR IGNORE` followed by reading the persisted operation ID.
- Sticky `RecoveryRequired` rooms are excluded from membership replay; transient `WaitingForCommit` is retried.

### Welcome and event integrity

- Added durable Welcome receipt outcomes and retryable ACK state.
- Duplicate or conflicting Welcome identity is treated as a recovery condition; it is not silently acknowledged.
- ACK success also clears the legacy Welcome marker.
- Added persistent `WaitingForCommit` state for future-epoch events, including the case where the server epoch is ahead but no application event is pending.
- Added persistent Commit quarantine keyed by room, epoch and SHA-256 fingerprint.
- Permanent malformed/invalid Commit failures are quarantined and mark only the affected room for recovery. Transient Commit read failures are not quarantined.
- Added late-event handling within the retained MLS epoch window and durable unreadable-event records outside it.
- API response shapes for events, commits, Welcomes and removals are validated rather than silently treating missing arrays as empty.
- Event identity is validated before processing.

### Outbox and room isolation

- Outbox flushing keeps messages for a blocked/desynchronized room queued and continues with healthy rooms.
- Transient failures remain retryable; access failures are not reclassified as data corruption.
- Structured `not_a_member` responses are recognized during membership reconciliation.

### Native Rust / Flutter bridge

- Added Rust bridge methods for safe invite cancellation, room recovery status, unreadable-event diagnostics, Welcome receipt diagnostics and quarantined Commit reasons.
- Exposed the corresponding methods through the Flutter bridge and `InOneSession`.
- Added a typed Flutter model for durable unreadable-event diagnostics.
- Updated the bridge test fake for the expanded interface.
- Refresh token rotation remains in Rust after the one-time auth handoff; the Dart auth object clears its refresh-token copy after native session adoption. SQLCipher key material remains in the native platform key store.

### Platform storage and CI workflow

- Android Keystore and iOS Keychain platform storage remain fail-closed; no plaintext database fallback was introduced.
- Updated the mobile integration test to verify that native logout removes the SQLCipher database and platform key even when the server logout endpoint is unreachable.
- iOS device and simulator compile checks remain no-code-sign.
- The signed iOS protected-Keychain runtime smoke test is conditional on the required signing secrets. If those secrets are absent, the workflow emits a warning; that runtime test remains an acceptance requirement and is not counted as passed.
- Updated the OpenMLS client workflow to test the exact PR head, use the P0 archived engine fixture, and allow a 30-minute test window.

## 2. Test sources present in the branch

The following test sources are present in the active `mls-client` crate:

- `tests/membership_journal.rs`
- `tests/consistency.rs`
- `tests/waiting_for_commit.rs`
- `tests/commit_quarantine.rs`
- `tests/welcome_recovery.rs`
- `tests/welcome_receipt_recovery.rs`
- `tests/common/mod.rs`
- `tests/engine/start-engine.mjs`

The harness uses the repository's P0 archived engine fixture. Presence of a test source is not evidence that the test executed or passed.

## 3. Actual verification status on the exact HEAD

The latest observed workflow runs for `df53ff48a42d9b9ca1dc7b19f049f8f3b05585a6`:

| Workflow | Run | Job result | Evidence |
|---|---:|---|---|
| OpenMLS client validation | [42986269774](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42986269774) | FAILURE | Job has no step summary; job log retrieval returned `BlobNotFound` |
| OpenMLS Flutter Rust Bridge generation | [42986269879](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42986269879) | FAILURE | `generate-and-validate` has no step summary; logs unavailable; iOS dependent job skipped |
| Flutter mobile validation | [42986269746](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42986269746) | SKIPPED | Job skipped by the workflow's configured branch condition |

The failed workflow conclusions do **not** provide a test failure message. The available GitHub job data contains no steps and no usable job logs. The exact cause is **UNKNOWN**. Do not infer a code defect, runner outage, permission problem or billing issue without logs.

A rerun was requested for the failed OpenMLS and FRB jobs; the available results still did not provide step summaries or logs.

No local Rust compiler or Cargo executable is available in this execution environment. Therefore no local `cargo test`, `cargo fmt` or Rust build is claimed.

## 4. Acceptance status

**Status: NOT ACCEPTED — BLOCKED / NOT VERIFIED**

- No Stage 4 test is marked PASS in this report.
- No Android/iOS runtime result is claimed.
- The signed iOS protected-Keychain smoke test is not confirmed as executed.
- Flutter analysis and tests are not confirmed as executed on this HEAD.
- No Stage 4 merge is authorized.
- No cumulative completion percentage is increased.

The approved Beta 1.0 WBS baseline remains unchanged: **42% implementation / 31% verification**. This report does not recalculate project completion.

## 5. Required next actions

1. Restore or diagnose GitHub Actions execution/observability for the two required workflows. Obtain actual job logs and step summaries; the current connector cannot retrieve them.
2. Rerun OpenMLS client validation and FRB generation on one exact PR head SHA.
3. Fix only errors confirmed by logs; do not weaken or remove tests to obtain green status.
4. Confirm Rust tests, Flutter analyze/tests, Android build/emulator runtime and iOS build/runtime.
5. Confirm the signed iOS protected-Keychain runtime test when signing secrets are available. A skipped test is not a pass.
6. Run the complete required matrix on one final SHA, archive the run links and exact counts, then request owner acceptance. Do not merge before that.

**Result:** implementation hardening and test sources have been added to PR #45. Acceptance remains blocked because required verification has not produced inspectable results.
