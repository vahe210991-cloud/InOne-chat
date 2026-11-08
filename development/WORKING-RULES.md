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

1. Read `development/README.md`, `WORKING-RULES.md`, `BASELINE-2026-11-08.md`, `HANDOVER-CHECKLIST.md`, `SESSION-LOG.md`, then `docs/continuity/README.md` and the current-state/decisions/source-of-truth documents.
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

## 8. Mandatory binary-artifact retention — owner instruction, 2026-11-08

This section is a binding project instruction from the owner.

> "Я отправляю файл в последний раз. Больше этот файл не буду отправлять."

The owner has explicitly stated that the P0 bundle is being supplied for the last time and will not be uploaded again. **Never ask the owner to resend this bundle.** Do not restart a session by asking for it. First retrieve it from the permanent repository archive described in [ARTIFACT-RETENTION.md](ARTIFACT-RETENTION.md).

The exact owner-supplied bytes are archived at:
- Branch: `artifacts/p0-bundles`
- Pointer file: `bundles/OWNER-SUPPLIED-ORIGINAL.txt`
- Permanent file: `bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`
- SHA-256: `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`

For every binary/source bundle:
- Save the actual bytes in a durable repository location (dedicated artifact branch or Git LFS), not only a chat attachment, model memory, expiring Actions artifact, or local workspace.
- Record the exact filename, size, SHA-256, source commit/ref, verification result, and permanent GitHub path.
- Verify the stored copy by downloading it from GitHub and comparing its SHA-256 with the supplied file.
- Keep the retention automation active so future snapshots are archived automatically.
- A temporary Actions artifact is only a transport/backup copy; it is not the permanent source of truth.
- Never mark an artifact as saved unless the permanent branch/path and checksum have been verified.

Current supplied file: `InOne-P0-snapshot-2026-11-08.bundle`; SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`; size 2,476,944 bytes; verified as a complete Git bundle with HEAD `16eab726106ae04b4979af2a1646c2052233b87c`. Permanent retention status is tracked in [ARTIFACT-RETENTION.md](ARTIFACT-RETENTION.md).
