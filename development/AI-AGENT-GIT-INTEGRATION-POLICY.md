# AI-agent GitHub and integration workflow

**Status:** owner-directed repository-wide engineering decision, effective 2026-11-22.  
**Applies to:** every AI agent, automation, developer, and future session working in this repository, regardless of the assigned task.  
**Canonical repository:** `vahe210991-cloud/InOne-chat`.

This document is a mandatory operating rule. It supplements `AGENTS.md`, `development/AI-AGENT-MANDATE.md`, and `development/WORKING-RULES.md`. If an older branch or task brief describes a conflicting workflow, stop and reconcile it with the latest owner decision before editing.

## 1. Core decision

Use **main-first, isolated, selective integration**:

1. Read the repository instructions and current approved baseline before doing any work.
2. Fetch the live `main` ref and record its exact commit SHA. Never assume a SHA from an old chat, PR description, or previous agent is still current.
3. Create a uniquely named task/integration branch from that exact `main` SHA.
4. Inspect source PRs, commits, changed files, ancestry, and overlapping ownership before porting changes.
5. Bring over only the required, still-missing behavior. Prefer small, reviewable changes and regression tests over copying an old branch or merging a large divergent history wholesale.
6. Preserve all accepted behavior and architecture already present on `main`.
7. Run GitHub Actions on the exact proposed head SHA; inspect every applicable job and its conclusion.
8. Keep the PR Draft until code review and every required exact-SHA check are green.
9. Never merge product code, enable a release gate, force-push, delete a shared branch, or close an owner-protected PR without explicit owner authorization.

The purpose is to prevent old feature branches from reintroducing superseded code, undoing accepted work, or overwriting another agent's changes.

## 2. Mandatory first-read and handoff

Every agent must read, in full:

- repository-root `AGENTS.md`;
- `development/AI-AGENT-MANDATE.md`;
- `development/WORKING-RULES.md`;
- `development/PROGRESS-BASELINE.md`;
- the latest relevant report, `development/SESSION-LOG.md`, and continuity documents.

The root `AGENTS.md` is the entry point and must link to this policy. Do not rely on chat memory or a task prompt as the only place where an architectural decision is recorded.

Before editing, identify:
- exact current `main` SHA;
- task branch and starting SHA;
- related open/merged PRs and their head SHAs;
- files changed by those PRs and any concurrent branch;
- the relevant WBS item, contract, screen ID, or acceptance criterion.

## 3. Branch and source-integration procedure

### 3.1 Establish the baseline

- Read the live `refs/heads/main` from GitHub.
- Compare the candidate branch with `main`; record ahead/behind counts, merge base, changed paths, and mergeability.
- Inspect the full relevant PR patch and commit history, not only its description.
- Treat a branch that is far behind, diverged, or based on a superseded engine/runtime as a source of candidate changes—not as a new base for current development.

### 3.2 Create an integration branch

- Create a new uniquely named branch directly from the exact current `main` SHA.
- Do not use an old feature branch as the integration base merely because it contains more commits.
- Keep the original PR and source branch intact as historical evidence unless the owner directs otherwise.
- Never force-push or rewrite shared history. Use expected-SHA/lease checks for ref updates.

### 3.3 Port behavior, not obsolete architecture

For each candidate change:
1. Map it to an approved requirement and verify it is still missing on `main`.
2. Identify the current canonical implementation and API contract.
3. Reuse current abstractions and stable IDs; do not duplicate an existing feature.
4. Port the smallest coherent behavior and tests.
5. Review the complete diff for unintended changes to lifecycle, authorization, persistence, navigation, dependencies, workflows, and security.
6. Record anything deliberately not ported and why.

Do not manufacture a merge commit whose tree is not a genuine, reviewed result of the merge. Do not solve conflicts by replacing the current tree with either side wholesale.

## 4. InOne Beta 1.0 architecture safeguards

These are project-specific invariants and must be preserved during every integration:

- Canonical production MLS client is **Engine B** at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`. Do not reintroduce experimental Engine A from `inone-engine-poc-0.6.0/mobile-mls/mls-client` as the production dependency.
- Preserve the current production Flutter app/session lifecycle and Firebase Push lifecycle already present on `main`.
- Keep native MLS adoption gated; `INONE_MLS_NATIVE_ENABLED` remains false by default until the owner-approved acceptance gates pass.
- Preserve stable message IDs, stable attachment operation IDs, typed pending-outbox semantics, durable outbox behavior, and retry idempotency. Attachment retry must use the stable-ID API (for example, `sendAttachmentWithId`) rather than creating a new operation on retry.
- Preserve ciphertext-only attachment transport, authenticated/device-bound downloads, current room-membership and device-revocation authorization, and Host-header hardening.
- Preserve SQLCipher and protected platform key storage. No plaintext persistence or plaintext messaging fallback.
- Incoming messages may be acknowledged only after durable local persistence.
- Do not expose refresh tokens, SQLCipher keys, or private key material to Dart or logs.
- Reuse verified existing backend routes/contracts. Do not invent an endpoint to make a screen or integration appear complete.
- Keep Beta 2.0 features outside Beta 1.0 scope.

These safeguards do not mean every task must modify MLS. They are constraints whenever a change touches the relevant paths or behavior.

## 5. GitHub Actions and exact-SHA acceptance

GitHub Actions is the required validation environment for repository work when applicable workflows are available. A check result is valid only for the exact candidate SHA being proposed.

For every PR:
- Determine applicable workflows from the changed paths and workflow triggers.
- Confirm each workflow checked out the PR head SHA, not an unrelated stale commit or synthetic merge ref. Prefer workflows that print and assert the expected SHA.
- Inspect all jobs, including skipped, cancelled, timed-out, queued, and failed jobs. A skipped required job is not a pass.
- Review failing job logs and artifacts before changing source.
- After any new commit, repeat the exact-SHA verification; previous green results do not transfer to a new SHA.
- Require all applicable checks to conclude `success`. If a run or job is absent, queued, skipped, or not terminal, report it as pending/NOT RUN/BLOCKED—not PASS.
- Do not create no-source-change commits merely to imply CI has run. If a workflow did not trigger, report the actual trigger/configuration blocker.

Typical checks include Flutter analyze/tests and Android build/runtime smoke; iOS simulator/device build and Keychain checks; Rust formatting/check/tests; OpenMLS/MLS integration; FRB deterministic generation; backend Node tests; Docker Compose/PostgreSQL acceptance; and the repository exact-SHA acceptance gate. Only run checks applicable to the changed paths and owner-approved acceptance criteria.

## 6. Tools and evidence

Use GitHub-native capabilities as appropriate:
- repository file and tree reads to inspect current source;
- PR metadata, patches, commit history, and compare endpoints to understand change provenance;
- isolated branch creation and SHA-guarded commits/ref updates;
- PR creation/update for review and traceability;
- Actions run, job, step, log, artifact, and exact-commit status inspection.

A connector action being available does not prove that an operation succeeded. Verify the returned branch, commit, file content, PR head, and Actions run after each material operation. If the available interface cannot perform a safe operation (for example, a real conflict-resolving branch update), do not emulate it with a fabricated merge tree. State the exact limitation and use a supported workflow or leave the risky paths untouched.

## 7. PR lifecycle and owner authority

- Integration PRs should normally be created as Draft.
- A PR being mergeable, all checks being green, or an agent recommending merge does not itself authorize merge.
- Do not merge any product-code PR until the owner explicitly authorizes that exact merge after reviewing evidence.
- Preserve owner-protected PRs. In particular, PR #90 must remain open and must not be merged or closed unless the owner explicitly changes that instruction.
- Keep source PRs available for traceability. The integration PR should link to its source PR(s), state what was ported, and list what was intentionally not ported.

## 8. Required reporting

At each substantial stage, commit a concise report and update the session/continuity records required by the repository mandate. Report:
- task, requirement/WBS mapping, and actual outcome;
- base branch and exact starting SHA;
- task branch and exact resulting SHA;
- source PR/branch/head SHAs reviewed;
- exact changed paths;
- ported and intentionally omitted behavior;
- concurrent changes and conflict handling;
- every executed Actions run/job with exact SHA and result;
- tests not run and precise reason;
- acceptance status using PASS, FAIL, BLOCKED, NOT RUN, or NOT ACCEPTED;
- next actions and owner decisions still required.

Never claim implementation, validation, acceptance, or merge based only on source inspection or a workflow definition.

## 9. Reference integration case: G2 / PR #90 (2026-11-22)

PR #90 is an older Draft source branch with persistent MLS messaging and encrypted-attachment work. It is **not** the integration base. The selected strategy is to create a fresh branch from current `main` and selectively port still-missing behavior after comparing the source patch against canonical Engine B and the current Flutter lifecycle.

The initial source review identified these key constraints:
- `main` already contains canonical Engine B and its stable-ID messaging/attachment and outbox APIs.
- PR #90 points to experimental Engine A and contains older Dart bridge/session orchestration assumptions.
- Port the required behavior to Engine B contracts; do not transplant Engine A wholesale.
- Preserve Firebase Push, app navigation/session lifecycle, native-MLS disabled-by-default gating, and current authorization checks.
- Keep `local_room_ids()` exposure minimal and only if a verified offline-room-restoration requirement needs it.
- Review retry semantics and require stable attachment operation IDs.
- PR #90 remains open Draft and is not to be merged or closed.

This is an integration plan and architectural decision, not evidence that the PR #90 code has already been ported or accepted. Code porting and exact-SHA CI must be recorded separately.

## 10. Change control

Only the repository owner may change these rules or the Beta 1.0 architecture safeguards. An agent that finds a conflict must stop the affected change, record the conflict, and request a decision rather than silently weakening a safeguard.
