# InOne development workspace


> **FINAL STATUS — 2026-11-08:** P0 backend/Rust/OpenMLS acceptance is CLOSED. PR [#25](https://github.com/vahe210991-cloud/InOne-chat/pull/25) was merged into `main` as `97024ab03ce9583e298ee946f3679565007405ca`. All six required CI jobs passed on PR head `addd47da245b6452c9f700c7e10b8d0585aad295` in [workflow run #124](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496739362), and all six passed again on merged `main` in [post-merge run #134](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42503694744). The owner bundle is permanently retained on `artifacts/p0-bundles`; see [ARTIFACT-RETENTION](ARTIFACT-RETENTION.md) and [P0 closure report](recovered-source/P0-CLOSURE-2026-11-08.md). Historical status below is retained for chronology and is superseded by this final record. Native Flutter Beta 1.0 work is a separate scope.


**Mandatory entry point for every developer, AI agent, or follow-up ChatGPT session.**

This folder defines the working protocol and the current verified development baseline. Read this file first, then read every linked instruction before touching source code.

## Required reading order

1. [WORKING-RULES.md](WORKING-RULES.md) — mandatory repository handling and hand-back rules.
2. [BASELINE-2026-11-08.md](BASELINE-2026-11-08.md) — what has actually been recovered, where it lives in GitHub, and what is still missing.
3. [HANDOVER-CHECKLIST.md](HANDOVER-CHECKLIST.md) — start/end-of-session checklist.
4. [SESSION-LOG.md](SESSION-LOG.md) — durable chronological record. Add a short entry after every substantial session.

Project-wide approved decisions and continuity documents remain in [docs/continuity/README.md](../docs/continuity/README.md). If any document conflicts, do not guess: follow the newest explicit owner decision, record the conflict in SESSION-LOG.md, and update the affected documents.

## Mandatory main-first integration policy

Every AI agent and automation must follow [AI-AGENT-GIT-INTEGRATION-POLICY.md](AI-AGENT-GIT-INTEGRATION-POLICY.md), regardless of the assigned task. It defines the main-first isolated branch workflow, selective behavior porting, architecture safeguards, exact-SHA GitHub Actions acceptance, and owner-controlled PR lifecycle. The root `AGENTS.md` also makes this policy mandatory.

## Repository-native and concurrent-agent workflow

Owner clarification (2026-11-11): agents may work directly against GitHub files when the available interface can safely inspect and update the exact paths. A complete clone/Codespace is preferred for broad code changes, builds, tests, binaries, history, submodules and LFS, but lack of a clone is not by itself a reason to stop. Each concurrent agent must use its own task branch/worktree, verify the latest SHA before writing, and never overwrite another agent's changes. See section 8 of [WORKING-RULES.md](WORKING-RULES.md) for the full protocol. Direct commits to `main` are limited to narrowly scoped documentation/rule changes explicitly authorized by the owner; this authorization does not cover product-code changes or PR merges.

## One source of truth

The GitHub repository `vahe210991-cloud/InOne-chat` is the only authoritative project workspace. No important source, patch, decision, test result, design asset, or handover instruction may exist only in a model's memory, a chat transcript, a private local folder, or an untracked working directory.

**A conversation's memory is not project storage.** Persist useful facts and deliverables in GitHub before ending the session.

## Repository audit

- [Repository / Flutter source audit](REPO-AUDIT-2026-11-08.md) — exact main and branch tree inspection; confirms no full Flutter app source is present in the audited GitHub branches.

## Recovered source references

- [Latest P0 GitHub recovery status](recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md) — exact published branch/SHA, CI results, source-integrity blockers and next P0 actions.

- [Recovered source index](recovered-source/README.md)
- [Architecture map](recovered-source/ARCHITECTURE-MAP-2026-11-06.md)
- [Bundle verification report](recovered-source/BUNDLE-VERIFICATION.txt)
- [Initial CI failure and correction](recovered-source/CI-RESULT-42453233555.md)
- [P0 base-tree restoration record](recovered-source/BASE-TREE-RESTORATION.md)
- [Latest Node/PostgreSQL CI outcome](recovered-source/CI-RESULT-42457297299.md)
- Exact biometric fixture recovery: documented in [current state](../docs/continuity/CURRENT-STATE.md#15-biometric-vector-fixture-gap-and-corrective-validation--2026-11-08) and in PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18).

## Integration briefs

- [InOne ↔ Propo authentication integration brief](integrations/INONE-PROPO-AUTH-INTEGRATION-BRIEF.md). This is a planned contract, not an implemented feature; open security/product decisions remain unresolved.

## Beta 1.0 AUTH work — 2026-11-26

- [AUTH registration, login and recovery plan](AUTH-REGISTRATION-LOGIN-RECOVERY-BETA-1.0-PLAN.md) — canonical task list; all tasks remain open until evidence, review and merge.
- [AUTH implementation audit report](reports/2026-11-26-auth-beta1-implementation-audit.md) — current implementation, defects addressed, tests NOT RUN and owner/platform blockers.
- [Mobile API contracts](../mobile/API-CONTRACTS-BETA-1.md) — screen-to-backend wiring and current AUTH boundaries.
- [Unified task-completion rules](UNIFIED-TASK-COMPLETION-RULES.md) — mandatory rule for every AI agent and developer.
- Working branch: `feat/auth-senior-backend-implementation-2026-11-26`, current handoff SHA `a94f0b0bacd61693f51790b0cce5c8185c1cc86f`, based on current main `7d34b99fcc026a828b838e211d039c575aeace1d`.
- State: implementation in progress; no merge; automated tests have not been run on the final SHA.

## Current status at a glance

- P0 Wave 3 recovery bundle: verified locally from the owner-provided archive; details and checksum in [BASELINE-2026-11-08.md](BASELINE-2026-11-08.md).
- P0 backend/MLS source is published on `recovery/p0-wave3-applied` at `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`; draft PR [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22). Functional Node/room/PostgreSQL/OpenMLS/Rust bridge checks pass on that exact SHA; overall CI remains red only at `cargo fmt -- --check` (12 Rust files). Source-integrity review remains open. See the [latest P0 recovery status](recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md).
- Reference-only P0/Flutter/Beta documents: PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17); not product implementation.
- Product Flutter Beta 1.0 source: not present in the recovered P0 bundle; do not claim there is a runnable mobile app until its actual source is located and built.
- Beta 1.0 uses an independent InOne backend/database. Shared operational database with Propo is deferred to a later beta.

This is a handover area, not a substitute for source code. Work in Git branches and return every change to GitHub under the rules below.


## Owner-approved progress baseline — mandatory for every agent

Read [PROGRESS-BASELINE.md](PROGRESS-BASELINE.md) in full before every implementation task. The owner approved WBS v1.1 on 2026-11-09: Beta 1.0 = 42% implementation / 31% verification; Beta 2.0 = 2% / 0%. Weights, release boundaries and baseline are fixed unless the owner explicitly approves a versioned change. Every report and implementation task must map to this WBS. The root [AGENTS.md](../AGENTS.md) and Copilot instructions require it.

## Current product work — FEED / PROFILE audit (2026-11-26)

- [FEED / PROFILE Beta 1.0 implementation plan](FEED-PROFILE-BETA-1.0-IMPLEMENTATION-PLAN.md) — source audit, findings, task register, dependencies and acceptance criteria. Owner-approved privacy variant В: preserve existing privacy behavior without introducing new visibility rules.
- [FEED / PROFILE audit report](reports/2026-11-26-feed-profile-beta1-audit.md) — exact source/publication SHAs, priorities, verification limits and next actions.
- Feed Beta 1.0 scope remains an owner decision; WBS v1.1 is unchanged. Do not treat the presence of the plan as implementation or test acceptance.

## Current product work — Beta 1.0 / A2 FRB reconciliation

- [A2 FRB reconciliation audit — 2026-11-19](reports/2026-11-19-A2-frb-reconciliation-audit.md). Initial source inventory is complete; generated-binding verification and the full platform matrix remain pending.

## Historical UI integration work

- [Full Beta 1.0 / 2.0 audit](reports/2026-11-09-0935-full-beta-audit.md)
- [UI source import and integration stage](reports/2026-11-09-1015-ui-integration-start.md)
