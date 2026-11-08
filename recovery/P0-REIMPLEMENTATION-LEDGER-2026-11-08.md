# P0 reimplementation ledger — 2026-11-08

Repository: `vahe210991-cloud/InOne-chat`
Branch: `recovery/p0-reimplementation`
Draft PR: https://github.com/vahe210991-cloud/InOne-chat/pull/25

## Source lineage and limitation

This branch is a reimplementation on the published Wave3 recovery snapshot. The newer canonical local source `cto/p0-finalize-fixtures` / `cto/p0-exact-pending-commit` and its commits are not available through published GitHub refs. This ledger does not claim byte-for-byte restoration of that unavailable source.

## Latest complete CI evidence

- Workflow run: [#116](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496187515)
- Tested SHA: `e5260ab9259bf25de2c0ff46f6eb0b02e231d7e7`
- Conclusion: `success`
- All six independent jobs passed: Rust formatting, backend Node suite, P0 room-list regression, PostgreSQL integration suite, OpenMLS client check/tests, Rust bridge check/tests.
- The OpenMLS job passed all integration-test targets, including the new F1, F4, and P0.3 recovery scenarios.
- The formatting job advanced the PR branch to formatted SHA `0d6a1072c1ee9405fa3ba2321b286e64912d3bed`. Run #117 for that bot-created formatting commit is `action_required`; a subsequent source-path documentation commit is being used to trigger the same full workflow against the formatted tree. The P0 release gate remains open until that exact final head has a complete successful run.

## Implemented on this branch

### P0.2 — membership commit metadata

- Migration `0025-mls-commit-change-metadata` stores normalized membership changes and Welcome recipients alongside each MLS Commit.
- PostgreSQL and in-memory stores persist and return the same metadata.
- Commit-history response returns metadata; legacy rows remain represented as null.
- Rust inspects staged OpenMLS Add/Remove proposals before `merge_staged_commit` and compares them with server metadata.
- Node tests cover metadata persistence/round-trip for add/remove.
- Rust negative integration scenario tampers with server metadata and asserts the staged Commit is not merged and room sending is blocked.

### F1 — Welcome recovery

- Duplicate Welcome detection checks both the in-memory group cache and durable `client_rooms` membership state.
- `GroupAlreadyExists` is treated as an indeterminate duplicate, not proof of malformed Welcome; the room receives sticky `RecoveryRequired` and the duplicate Welcome is not ACKed.
- Permanent malformed Welcome data is recorded in a durable receipt/quarantine transaction before ACK.
- Library/storage failures remain indeterminate and are not quarantined or ACKed.
- ACK failures leave the durable receipt pending; restart retries ACK for the same Welcome ID.
- Tests cover duplicate Welcome retention, room isolation, quarantine receipt persistence, local receipt-write failure (no ACK), and ACK retry after restart.

### F4 — membership journal and exact pending-Commit identity

- Exact staged-Commit fingerprint is persisted atomically with the membership operation journal.
- Server idempotency fingerprint binds room, epoch, sender/device, operation ID, claim ID, commit bytes, normalized membership changes, and Welcome recipients.
- Exact replay returns the previously accepted result; reuse of an operation ID with different content is a conflict.
- Client verifies the pending fingerprint before merge/clear. A mismatch retains the journal and sets sticky `RecoveryRequired`.
- Retryable/network/access failures preserve pending state; epoch-outdated responses clear only a fingerprint-matching staged operation and safely rebase.
- Tests cover accepted Commit with lost response and restart replay, journal-insert DB failure, settlement-delete DB failure, fingerprint mismatch, and stale-clear DB failure followed by safe rebase.

### F5 — event identity and malformed response handling

- Event identity/epoch contract validation remains enforced before processing.
- Malformed identity is not marked processed and does not poison unrelated rooms.
- Existing Rust regression coverage is included in the latest OpenMLS test run.

### P0.3 — durable room-scoped recovery

- `client_waiting_for_commit` stores room-scoped expected epoch and pending future-event IDs when a future-epoch event arrives without its Commit.
- The marker survives restart, blocks sends only in the affected room, and clears when the missing Commit is applied.
- `client_commit_quarantine` stores room, epoch, SHA-256 of exact Commit bytes, reason, and timestamp.
- Permanent Commit parse/process/metadata failures are quarantined atomically with `RecoveryRequired`; an already quarantined Commit is not reprocessed.
- Transient fetch/process/merge failures are returned as retryable and are not put into permanent quarantine.
- Tests cover WaitingForCommit/restart/recovery, permanent Commit quarantine/restart, unrelated-room progress, and transient Commit-fetch retry.

### KeyPackage claim/replay

- Migration `0026-mls-key-package-claim-replay` adds durable claim records keyed by target user, requester user/device, and claim ID.
- PostgreSQL reserves the claim and persists the exact package result in one transaction. Replays return saved bytes without consuming another package.
- Memory store mirrors the idempotency contract.
- API uses `POST /mls/key-packages/{userId}/claim` with required URL-safe `claimId`.
- Rust stores per-room/user claim intent in encrypted local SQLite, reuses it on retry, verifies the response claim ID, and clears intent only after server commit acceptance (or an empty result).
- Node replay/concurrency and PostgreSQL restart/replay coverage pass in the latest complete CI run.

## P0 acceptance status

| Area | Implementation status | Latest evidence |
|---|---|---|
| P0.2 server metadata contract | Implemented | PostgreSQL + Node + OpenMLS tests in run #116 |
| P0.2 staged-proposal validation | Implemented | Metadata tamper regression passed in run #116 |
| F1 Welcome recovery | Implemented | Duplicate, quarantine, ACK retry, storage-failure tests passed in run #116 |
| F4 membership journal fingerprint | Implemented | Lost response, replay, fingerprint mismatch, transaction-failure/rebase tests passed in run #116 |
| F5 event identity | Implemented | OpenMLS event-identity regressions passed in run #116 |
| P0.3 quarantine / WaitingForCommit | Implemented | Durable quarantine, restart, retry, room-isolation tests passed in run #116 |
| KeyPackage claim/replay | Implemented | Node and PostgreSQL integration suites passed in run #116 |
| Full P0 release gate | **OPEN pending final exact-SHA run** | Run #116 is green at its SHA; formatted head requires full revalidation |

## Guardrails

- Do not merge this draft PR or modify `main` without explicit user approval.
- Do not close P0 until every acceptance item has runtime evidence on the final PR head.
- Never label Wave3 recovery as the missing canonical P0 source.
- After the final formatted tree is validated, do not make further source changes without another complete run.
