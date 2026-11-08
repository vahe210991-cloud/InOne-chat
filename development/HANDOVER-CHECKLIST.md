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
