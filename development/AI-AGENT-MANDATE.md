# AI Agent Mandate — InOne

This file is referenced by the repository-root `AGENTS.md`. It records the current owner instructions for every AI session working in this repository. It supplements, and does not replace, `development/WORKING-RULES.md`.

## 1. Current owner instructions — effective 2026-11-11

1. **Single executor:** ChatGPT is the sole developer and executor. Do not invoke, assign, or assume an external agent, sub-agent, or delegated developer unless the owner explicitly authorizes it in a later message.
2. **Current release stage:** Beta 1.0 only. Do not add Beta 2.0 scope, roadmap work, or completion claims to Beta 1.0.
3. **No assumptions as facts:** Never present an assumption, inference, unverified source review, or expected behavior as a completed result. If a required fact is unknown, ask the owner for the exact missing information. Do not invent test output, root causes, percentages, or repository state.
4. **Acceptance rule:** A task is accepted only when every agreed acceptance criterion is met and every required test/check is green on the same exact final commit SHA. Test code being authored, a build being configured, a skipped job, or a source review is not a passing test.
5. **Status vocabulary:** Use only evidence-based states: PASS, FAIL, BLOCKED, NOT RUN, or NOT ACCEPTED. Distinguish source implementation from executed verification.
6. **Progress percentages:** Use the owner-approved WBS v1.1 only. Do not change weights or raise progress percentages without corresponding accepted evidence. Keep implementation and verification percentages separate where the WBS requires it.
7. **Report format:** Reports must be concise and factual, with minimal subjective assessment and no unnecessary technical-state narration. Every report must include:
   - task and actual result;
   - acceptance criteria and their status;
   - executed test/check names and exact results;
   - percentage calculated against the approved WBS;
   - a remaining-work checklist;
   - exact branch, commit SHA and repository path/URL.
8. **Repository archive:** Store reports, session logs, checklists, evidence links and handover notes in this GitHub repository. Chat messages are not the project archive.
9. **No product merge without owner approval:** Never merge a product-code PR, enable native MLS, or change a release gate without explicit owner approval after all required checks are green on the exact proposed SHA.
10. **Security first:** Preserve fail-closed MLS behavior, encrypted-only local persistence, protected platform key storage, durable-persistence-before-ACK, token/key isolation from Dart, and no plaintext or Megolm fallback.

## 2. Beta 1.0 Stage 4 invariants

- `INONE_MLS_NATIVE_ENABLED` remains false until the required native runtime, persistence, Android, iOS, recovery and security checks are accepted.
- SQLCipher is mandatory; do not introduce plaintext database fallback.
- Refresh tokens and SQLCipher keys remain in Rust/protected storage; never expose them to Dart or logs.
- Incoming messages are ACKed only after durable local persistence.
- Failure to initialize protected storage, verify a key/database pair, or recover a durable MLS state must fail closed.
- Missing protected keys must never be silently replaced for an existing database.
- Logout must clear local credentials and prevent automatic session restoration after an explicit logout attempt, even when cleanup reports an error.
- Do not store certificates, provisioning profiles, private keys, tokens, passwords, real verification codes, or customer data in Git or chat. Use protected GitHub Environment secrets.

## 3. Required workflow for every task

1. Read `AGENTS.md`, this mandate, `development/WORKING-RULES.md`, the approved baseline/WBS, and current continuity documents.
2. Fetch the live repository state and record the exact base and starting SHA.
3. Work in a uniquely named task branch. Check for concurrent changes before editing.
4. Make the smallest coherent change set. Add or update regression tests for behavior changes.
5. Review the complete diff and inspect all changed files. Never remove or overwrite unreviewed content.
6. Execute the relevant test/build/security matrix when an authorized runner is available.
7. If tests cannot run, mark them BLOCKED or NOT RUN and record the exact missing capability. Never label the task accepted.
8. Fetch the written files again from GitHub and verify the remote branch, commit SHA and content.
9. Update `development/SESSION-LOG.md`, `docs/continuity/CURRENT-STATE.md`, `docs/continuity/NEXT-SESSION.md`, and the dated report in `development/reports/`.
10. Do not merge without owner approval.

## 4. Current execution ownership

Until the owner explicitly changes this instruction, all investigation, implementation, testing, code review, reporting and repository archival are performed by ChatGPT alone. An external agent is not part of the current plan.


## Owner update — 2026-11-12: Claude UI/UX design authorization

The owner has explicitly authorized Claude to work on **UI/UX design deliverables only** for InOne. This is a narrow exception to the single-executor rule, not a transfer of CTO or engineering ownership. Claude may review the approved screen specifications, compare UX patterns with documented industry references, and prepare screen/design assets and a handoff package. ChatGPT remains responsible for backend/API/security architecture, code integration, contract verification, tests, repository acceptance, reports and release decisions. Claude must follow `development/integrations/CLAUDE-UI-DESIGN-HANDOFF-2026-11-12.md`. No credentials or secret values are to be supplied to Claude; design work requires no API keys.
