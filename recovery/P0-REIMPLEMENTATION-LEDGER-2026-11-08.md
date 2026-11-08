# P0 reimplementation ledger — 2026-11-08

Repository: `vahe210991-cloud/InOne-chat`
Branch: `recovery/p0-reimplementation`
Draft PR: https://github.com/vahe210991-cloud/InOne-chat/pull/25

## Source lineage and limitation

This branch is a reimplementation on the published Wave3 recovery snapshot. The newer canonical local source `cto/p0-finalize-fixtures` / `cto/p0-exact-pending-commit` and its commits are not available through published GitHub refs. This ledger must not be interpreted as proof that the unavailable source was restored byte-for-byte.

## Verified CI snapshot

- Exact tested head: `e444a4c9e55c2451dddeff651fed2b948b10d96d`
- Workflow run: [#33](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42473665033)
- Conclusion: `success`
- Passed steps: Rust formatting, Node dependency install, backend Node suite, P0 room-list regression, PostgreSQL integration suite, OpenMLS client tests, Rust bridge tests.
- This validates the code at the exact SHA above only. Any subsequent commit requires a new complete run.

## Implemented on this branch

### P0.2 — membership commit metadata

- Migration `0025-mls-commit-change-metadata` stores normalized membership changes and Welcome recipients alongside each MLS Commit.
- PostgreSQL and in-memory stores persist and return the same metadata.
- Commit-history response returns metadata; legacy rows remain represented as null.
- Rust inspects staged OpenMLS Add/Remove proposals before `merge_staged_commit` and compares them with server metadata.
- Node tests cover metadata persistence/round-trip for add/remove.
- Rust negative integration scenario tampers with the server metadata and asserts the staged Commit is not merged and room sending is blocked.
- CI run #33 passed the Rust integration and bridge test steps.

## P0 acceptance status

| Area | Status | Evidence / remaining work |
|---|---|---|
| Published Wave3 validation | Verified at exact SHA | Workflow run #33 success |
| P0.2 server metadata contract | Implemented; CI passed | Migration, PostgreSQL/memory store parity, API history, tests |
| P0.2 client staged-proposal validation | Implemented; CI passed | OpenMLS integration tests in run #33 |
| F1 Welcome recovery | Not implemented/verified on this branch | Implement per CTO checklist, including GroupAlreadyExists, LibraryError, transactional quarantine/ACK and room isolation |
| F4 membership journal fingerprint | Not implemented/verified on this branch | Persist exact staged-commit fingerprint atomically with journal op; structured response classification and restart/replay tests |
| F5 event identity | Existing checks in baseline; acceptance not yet fully re-run against malformed-response retry scenario | Add/verify CI integration regression |
| P0.3 durable quarantine / WaitingForCommit | Not implemented/verified on this branch | Durable room-scoped state, retryable failures, recovery semantics |
| KeyPackage claim/replay | Not implemented/verified on this branch | Stable claim ID, durable claim result, client intent journal, replay idempotency and concurrent claim tests |
| Full P0 release gate | OPEN | All above plus clean DB/upgrade migration and final exact-SHA CI |

## Guardrails

- Do not merge this draft PR or modify `main` without explicit user approval.
- Keep P0 issues open until every acceptance item has runtime evidence on one final SHA.
- Never label Wave3 recovery as the missing canonical P0 source.
- Re-run the full CI workflow after every source change; only the final head's run counts.
