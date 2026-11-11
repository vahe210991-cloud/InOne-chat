# InOne repository instructions for all AI agents

**Mandatory first read:** `development/AI-AGENT-MANDATE.md`, then `development/PROGRESS-BASELINE.md` in full.

Before any work, read the mandate in full, then follow its required reading list and start-of-session checklist. The owner-approved Beta 1.0/Beta 2.0 WBS is the immutable planning baseline. Every task must map to a WBS row, stable screen ID, API contract, or acceptance criterion.

Non-negotiable requirements:
- GitHub is the only durable source of truth; do not leave project files or the only copy in local/temp/chat/model memory.
- Inspect and preserve every file/attachment received from the owner; classify it, store it in the correct project branch/path, commit, push, and verify remote SHA/checksum.
- Create a timestamped report under `development/reports/` after every completed stage and every substantial session; update `development/SESSION-LOG.md`.
- Every report carries five previous and five next tasks; cross out only evidenced completed tasks; preserve cumulative readiness using `development/PROGRESS-BASELINE.md`.
- Treat the owner-approved WBS weights, scope, Beta 1.0/Beta 2.0 boundary and baseline percentages as fixed. Change them only after explicit owner approval and version the history.
- Do not implement unverified endpoints. Missing contract = BLOCKED and ask owner; never invent routes or silently mock production behavior.
- Never use chat text as a substitute for GitHub reporting.
- Never merge until all required checks are green on the exact proposed SHA and the owner explicitly authorizes merge.
- Never start any server, deploy, expose a backend/database, or create paid Codespaces resources without explicit owner permission.
- Use GitHub Actions and Codespaces where available and authorized; report what was actually used.
- Commit and push every completed deliverable; verify it is retrievable from GitHub.

UI integration rules:
- Preserve owner-approved HTML/CSS/JS/fonts and stable screen IDs; do not redesign them.
- Flutter production screens must be connected only to verified API contracts through typed Flutter repositories.
- HTML must not make direct network requests or receive access/refresh tokens.
- Keep Beta 2.0 CRM screens as placeholders and out of Beta 1.0 flows.
- Do not claim UI import or rendering complete until exact assets are in GitHub, Flutter asset bundle is configured, and Android/iOS tests plus visual parity checks pass.

If you cannot comply, stop and record the exact blocker. Do not claim completion without evidence.


## Owner-approved repository-native workflow (2026-11-11)

The repository is the shared source of truth so that every agent can retrieve the latest files and concurrent work does not overwrite another agent.

- Read `development/WORKING-RULES.md` for the full workflow. Its repository-native mode is explicitly allowed when the available GitHub interface can safely inspect and update the exact files involved.
- A complete clone/Codespace remains preferred for broad code changes, builds, tests, binaries, Git history, submodules, and LFS. It is not a blanket prerequisite for focused documentation or other safely reviewable repository-native edits.
- Do not stop merely because a local clone is unavailable. Assess whether the task can be completed safely through GitHub in an isolated task branch. If not, state the exact missing capability and leave risky files untouched.
- Each concurrent agent uses a unique task branch/worktree. Check the latest branch/file SHA before editing; never have agents write to the same branch concurrently. Resolve SHA conflicts by re-fetching and reviewing, never by overwriting.
- Keep all required/current files in GitHub. Local copies are temporary; publish complete coherent changes and verify remote SHA before hand-back.
- Direct commits to `main` remain limited to narrowly scoped documentation/rule corrections explicitly authorized by the owner. This owner authorization covers the 2026-11-11 workflow-rule clarification only; it does not authorize direct product-code changes, PR merges, force updates, or branch deletion.
