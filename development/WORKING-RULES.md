# Mandatory development rules — InOne

These rules apply to every human developer, AI agent, automation, and future ChatGPT session that works in this repository. Read them before entering implementation work. They are project operating rules, not optional recommendations.

## 1. GitHub is the only source of truth

1. The canonical repository is `vahe210991-cloud/InOne-chat`.
2. All meaningful files must be committed to GitHub: source code, migrations, tests, configuration, design tokens/assets, scripts, architecture decisions, API contracts, test reports, and handover notes.
3. Never rely on model memory, chat history, personal notes, a local-only folder, or an uncommitted workspace as the only copy of project knowledge.
4. Never say a file is saved unless its commit is visible in GitHub. Report the branch, commit SHA, and PR/URL.
5. Do not store credentials, access tokens, private keys, production secrets, customer data, or real verification codes in GitHub. Use documented secret-management mechanisms and placeholders.

## 2. Start every session from a complete repository copy

Before editing anything:

1. Read `AGENTS.md`, `development/AI-AGENT-MANDATE.md`, `development/README.md`, `WORKING-RULES.md`, `BASELINE-2026-11-08.md`, `HANDOVER-CHECKLIST.md`, `SESSION-LOG.md`, then `docs/continuity/README.md` and the current-state/decisions/source-of-truth documents.
2. Fetch the latest remote refs. Record the exact starting commit SHA and current branch.
3. Make a **complete clone or complete working copy of the repository**, not a hand-picked subset. Preserve all branches/refs needed for the task, commit history, tags, submodules, and Git LFS objects where applicable.
4. Verify the copy: `git status`, `git log`, `git remote -v`, `git submodule status`, and LFS status if used. If the environment cannot obtain a complete copy, stop and document precisely what is missing. Never silently work from an old or partial snapshot.
5. Use a dedicated task branch created from the latest intended base. Never edit a shared branch directly unless the owner has explicitly authorized a documentation-only direct commit.

## 3. Work locally, return the complete change set to GitHub

1. The local working copy is temporary. The remote repository is the durable result.
2. Keep the complete repository tree intact. Do not replace the remote repository with a partial export or a directory containing only selected files.
3. Before hand-back, inspect **all** changed, added, deleted, renamed, ignored, and untracked files:
   - `git status --short --branch`
   - `git diff --stat`
   - `git diff --check`
   - `git ls-files --others --exclude-standard`
   - `git diff --name-status`
4. Include every intended source, test, migration, configuration, asset, and documentation file in commits. Do not leave necessary files only on the local machine. Do not accidentally commit build output, caches, secrets, or generated junk.
5. Commit all coherent work. Push the branch to GitHub. Open/update a PR with purpose, scope, exact base/head SHAs, tests run, test results, and known limitations.
6. If a file is too large or a binary cannot be uploaded with the available GitHub mechanism, do not pretend it was saved. Use a supported Git transport, Git LFS, or an approved release/artifact route; then verify the resulting GitHub URL and checksum. Until then, mark it BLOCKED and keep its checksum and provenance in the baseline.
7. After push, fetch the remote branch again and verify that the remote HEAD equals the intended local commit. A successful local commit is not a successful hand-back.

## 4. Preserve history and protect the repository

- Never force-push, rewrite shared history, delete branches/tags, reset `main`, or overwrite source with a partial archive unless the owner explicitly approves that exact operation.
- Never merge a product-code PR just because it is mergeable. Require all applicable checks, source review, and release-gate evidence.
- Keep recovery imports, experiments, and unverified code in isolated branches/PRs.
- Never mix incompatible source baselines. Compare commit ancestry, blob hashes, patch applicability, and diffs first.
- Do not apply old patch files to a different baseline without a clean applicability check and review.
- Do not claim tests passed if they were authored but not executed. Use PASS / FAIL / BLOCKED / NOT RUN accurately.

## 5. No hidden work and no memory dependency

1. Do not keep project-specific facts "in memory" as the sole persistence mechanism. The next developer must be able to reconstruct the working context from GitHub alone.
2. At the end of every substantial session, update:
   - `development/SESSION-LOG.md`
   - `development/BASELINE-2026-11-08.md` when source status/checks/refs change
   - `docs/continuity/CURRENT-STATE.md`
   - `docs/continuity/NEXT-SESSION.md`
   - `docs/continuity/SOURCE-OF-TRUTH.md` when artifact inventory changes
3. Include exact links, SHAs, command lines, outcomes, and unresolved blockers. Avoid vague statements such as "fixed", "restored", or "tested" without evidence.
4. A session is not complete until its useful result is committed and visible in GitHub, or the precise external blocker is recorded there.

## 6. Required engineering discipline

- Keep Beta 1.0 scope aligned with approved decisions. Tasks, Calendar, and Cindy are out of Beta 1.0 unless the owner changes scope.
- Beta 1.0 uses an independent InOne backend/database; shared InOne+Propo operational DB is deferred.
- MLS must fail closed. No plaintext fallback.
- Do not ACK an incoming message before durable local persistence.
- Keep secrets out of logs; never log one-time codes or plaintext key material.
- Treat Propo integration as a separate versioned service contract. Do not invent InOne endpoints or assume Propo-side behavior exists.
- Add/update tests for behavior changes and record commands/results.

## 7. If you cannot comply

Stop before making risky edits. Add a concise blocker entry to SESSION-LOG.md and report:
- what exact capability/file/ref is unavailable;
- what was checked;
- what remains untouched;
- what supported next step is needed.

Do not ask the owner to resend an artifact already in GitHub or the shared project Library. Search the repository and documented artifact inventory first.


## Permanent artifact rule — owner P0 bundle

The owner-uploaded `InOne-P0-snapshot-2026-11-08.bundle` must never be requested again as a routine session prerequisite. Its permanent copy is in branch `artifacts/p0-bundles`, path `bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`, SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`. Read `development/ARTIFACT-RETENTION.md` and retrieve the bundle from GitHub when needed. Never say it is saved unless the branch/path is checked live.


## 8. Owner-approved repository-native work and concurrent agents

**Owner clarification — effective 2026-11-11.** The goal of the workflow is that the latest authoritative files are always available in this GitHub repository and that multiple agents can work without overwriting one another. A full local clone is the preferred method for broad/code changes, but it is not an absolute prerequisite for every task.

### 8.1 Choose the working mode by task

1. **Repository-native editing is allowed** when the available GitHub tools can safely read and update the exact files involved. This includes focused documentation changes, small text/config changes, and reviewed file additions/deletions.
2. **Use a complete clone or Codespace** for broad refactors, multi-file code changes, builds, test execution, generated assets, binary files, Git history operations, submodules, LFS, or whenever the available repository API cannot inspect the full required context.
3. If a full clone is unavailable, do not stop automatically. First determine whether the task can be completed safely with repository-native operations. If yes, proceed in an isolated task branch and state which checks cannot be run. If not, record the exact blocker and leave source untouched.
4. A local working copy is a temporary editing environment, not the authoritative destination. Return every approved change to GitHub promptly. No required or latest version may remain only on an agent's machine, in an untracked folder, or in chat.

### 8.2 Canonical files and hand-back

1. GitHub `main` and approved branches are the shared durable repository. Before editing, fetch the latest target branch and exact file/blob SHA.
2. Make edits against the latest file content, not an old downloaded copy. For API-based edits, use the current blob SHA as the update precondition; after each successful write, use the newly returned SHA for any subsequent update to that same file.
3. After writing, fetch the file again from GitHub and verify its contents, commit SHA, and branch. Report the exact URL and SHA.
4. Never tell the owner that a change is available until it is retrievable from GitHub.
5. For changes prepared locally, commit and push the complete coherent change set to GitHub before hand-back. Do not leave the only current version locally.

### 8.3 Multiple agents and collision prevention

1. Every independent task or agent must use its own uniquely named task branch/worktree, created from the latest intended base. Do not have two agents edit the same branch or worktree concurrently.
2. Before editing a file, check whether another open PR/branch is changing that path. If so, coordinate: either wait, split ownership by file, or rebase/reconcile in a separate task branch. Never overwrite another agent's newer work.
3. Use file SHA / expected-head checks for repository-native writes. If GitHub reports a SHA conflict, re-fetch and review the new content; do not retry by forcing the old content.
4. Keep commits small and logically scoped. One task should not bundle unrelated cleanup, feature work, and security fixes.
5. Integrate through reviewable PRs by default. Direct commits to `main` are permitted only for narrowly scoped documentation/rule corrections when the owner explicitly authorizes direct-main documentation changes. This owner clarification grants that authorization for this rule update only; it is not blanket permission for future direct-main product-code changes.
6. Never merge a PR, delete a shared branch, force-update a ref, or overwrite another agent's work without explicit owner approval for that operation.

### 8.4 File cleanup and deletion

1. Do not delete files based only on age, filename, apparent duplication, or absence of recent references.
2. Before deleting, inspect the file's content, Git history/provenance where available, references from code/tests/workflows/docs, and whether it is an intentionally retained archive or source-of-truth artifact.
3. Preserve owner uploads, source bundles, original design archives, migrations, lockfiles, test fixtures, audit/security evidence, and historical reports unless their replacement and retention policy are proven.
4. Prefer a dedicated cleanup branch/PR with a manifest of every deletion and its reason. Verify all references and run applicable tests before requesting merge.
5. If the repository interface cannot inspect the complete tree or history needed to prove a deletion safe, do not delete that file. Continue with independently verifiable candidates and list uncertain files as retained.

### 8.5 Required hand-back format

Every agent reports:
- working mode (clone/Codespace or repository-native);
- base branch and exact starting SHA;
- task branch and resulting commit SHA(s);
- exact paths changed/added/deleted;
- files or paths concurrently modified by other agents and how conflicts were avoided;
- verification performed, with PASS / FAIL / BLOCKED / NOT RUN;
- exact GitHub links to the resulting files/commit/PR;
- confirmation that no local-only required changes remain.

These rules supersede the earlier blanket stop condition in section 2.4 only to the extent that safe repository-native work is possible. All other source-integrity, review, security, and no-merge safeguards remain in force.


## 10. Screen API integration and backend receipt evidence

1. A screen's API string in a manifest/catalog is a requirement declaration, not proof of a request.
2. A `data-api` HTML attribute is not proof of Flutter dispatch. Flutter dispatch requires an explicit typed route and screen-scoped allowlist entry.
3. A route handler in `server.js` is not proof the request was received. Backend receipt requires a real HTTP integration test or runtime trace.
4. A mocked Dart HTTP test proves client serialization/handling only; it does not prove a Node backend received the request.
5. A backend Node test using `createServer` and actual HTTP fetch proves backend route receipt/response for that test case, but does not prove the Flutter bridge invoked it.
6. Full screen acceptance requires the chain: stable screen ID → HTML action → typed bridge allowlist → Flutter request → backend handler receipt → DTO/auth/permission outcome → response mapped to UI state. Record each link separately.
7. Never expose registration tickets, access/refresh tokens, MLS keys, or private response fields to WebView. One-time credentials remain in host memory and are sent only by the trusted host client.
8. Do not widen a global route allowlist without screen-scoped authorization, DTO validation and negative tests.
9. Do not route plaintext message sends through legacy room-event APIs. CH-02 uses the MLS protocol path; backend ciphertext remains opaque.


## 11. Mandatory historical test evidence reuse

This owner instruction is mandatory for every future ChatGPT session and contributor.

1. Before planning checks, read `development/reports/2026-11-12-historical-test-evidence-baseline.md` and the linked P0/Stage 3 acceptance reports.
2. Compare the exact target SHA, changed source paths, test files, workflows and material toolchain changes against the historical tested SHAs.
3. Reuse historical evidence for unchanged source/test scope. A context reset is never a reason by itself to repeat broad code exploration or rerun unchanged tests.
4. Rerun only justified deltas, missing/contradictory evidence, material environment changes, or an explicit exact-SHA release acceptance gate.
5. A test file, proposed command, or workflow that failed before steps is never PASS.
6. Every substantial task creates a dated report and updates SESSION-LOG, CURRENT-STATE and NEXT-SESSION with exact SHAs, run IDs, outcomes, scope and blockers.
7. Use PASS / FAIL / BLOCKED / NOT RUN / IN PROGRESS precisely. Historical PASS applies only to its recorded SHA and scope.


## 12. Mandatory unified task completion and evidence rule

**Owner instruction — effective 2026-11-26.** Every AI agent, AI developer, automation, reviewer, and human contributor must follow `development/UNIFIED-TASK-COMPLETION-RULES.md`. It applies immediately to AUTH, CHATS, GROUPS, FEED, PROFILE, and every future InOne functional block.

1. The canonical plan in `development/` for each functional block is the single shared task/status/history record. Read it before starting or continuing work; do not maintain a competing private checklist.
2. No contributor may declare a task, stage, or functional block complete merely because code was written or local checks passed.
3. A task remains an unchecked, uncrossed item until implementation, required automated tests, applicable checks on the exact SHA, independent review, PR merge, and evidence recording are all complete.
4. Only then may it be marked `- [x] ~~TASK-ID. Title~~` in the canonical plan. Record PR, merge commit SHA, date, check results/run links, implementer, and independent reviewer directly below it.
5. Never delete completed tasks or their evidence. If a defect/regression is found, remove the strike-through, reopen the checkbox, record the reason, and preserve the prior completion evidence.
6. Every session hand-back must identify task IDs, exact SHAs, PRs, tests and outcomes, review/merge state, updated plan paths, and remaining blockers. Unsupported claims of completion are not accepted.
7. All active agents must use the same current GitHub instructions and plans. Coordinate overlapping paths and use separate task branches; never overwrite another agent's work.

This rule is mandatory and cannot be waived by an individual agent. If evidence is incomplete or contradictory, the task stays open.
