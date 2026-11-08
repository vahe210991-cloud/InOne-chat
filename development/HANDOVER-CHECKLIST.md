# InOne session handover checklist

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
- [ ] Keep PR #22 draft/open and do not merge or begin non-P0 Beta work until source-integrity and CI gates pass.
- [ ] Record original bundle binary preservation as BLOCKED until a retrievable GitHub/archive object is uploaded and its SHA-256 verified.
