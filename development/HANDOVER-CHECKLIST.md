# InOne session handover checklist


## P0 closeout — completed 2026-11-08

- [x] Source provenance checked against owner bundle; bundle is retained in GitHub.
- [x] Six P0 CI jobs passed on exact PR head (run #124).
- [x] PR #25 merged to `main` as `97024ab03ce9583e298ee946f3679565007405ca`.
- [x] P0 closure report and session handoff committed.
- [x] Permanent bundle retention path and SHA-256 documented.
- [ ] Native Flutter Beta 1.0 integration, secure platform key storage, durable local message persistence and real-device E2E — separate next phase, not P0.

Do not reopen P0 or ask the owner to re-upload the bundle unless a concrete regression or missing artifact is demonstrated. Retrieve it from `artifacts/p0-bundles`.


## Start

- [ ] Read `development/README.md` and every linked mandatory instruction.
- [ ] Read project continuity index, current state, decisions, source-of-truth, and next-session.
- [ ] Fetch latest GitHub refs; record base SHA and branch.
- [ ] Make a complete clone/copy; verify history, refs, submodules and LFS if applicable.
- [ ] Confirm source baseline is the correct one for the task; compare hashes/ancestry before patching.
- [ ] Create a dedicated task branch; keep main and other shared branches untouched.

## During work

- [ ] Keep changes inside the complete repository tree.
- [ ] Add tests and update relevant contracts/docs.
- [ ] Do not store required files only in local memory, chat, or local workspace.
- [ ] Do not include credentials, secrets, caches, or build output.
- [ ] Record exact test commands and outcomes.

## Finish / hand back

- [ ] Inspect `git status --short --branch`, `git diff --stat`, `git diff --check`, `git diff --name-status`, and untracked files.
- [ ] Ensure every intended added/changed/deleted/renamed file is included.
- [ ] Commit coherent changes and push the branch.
- [ ] Fetch remote and verify remote HEAD equals intended commit SHA.
- [ ] Open/update PR; include exact base/head SHA and test evidence.
- [ ] Update SESSION-LOG, BASELINE if needed, and docs/continuity handover documents.
- [ ] Link commits, PRs, CI runs, and blockers.
- [ ] Leave no necessary uncommitted or local-only work.

A session is not handed back until the work is in GitHub or the exact blocker is documented in GitHub.


## P0-specific acceptance gate

- [ ] Verify latest `recovery/p0-wave3-applied` HEAD; last checked: `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`.
- [ ] Read `development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md` before editing P0.
- [ ] Complete full 240-file original-bundle blob-hash audit; do not substitute path parity or PR #18 candidate parity.
- [ ] Verify six substantive modified engine files and five added P0 test files against exact bundle/patch provenance.
- [ ] Preserve source hashes before a separate rustfmt-only commit.
- [ ] Re-run the full GitHub Actions workflow on the exact resulting SHA; require formatting, Node, room regression, PostgreSQL, OpenMLS and Rust bridge jobs all green.
- [x] PR #25 merged after source-provenance review and all six CI jobs passed.
- [x] Original owner bundle permanently stored in GitHub; checksum recorded in ARTIFACT-RETENTION.md.
