# CTO report — repository-wide agent policy and G2 integration branch preparation

**Date:** 2026-11-22  
**Task:** publish a mandatory integration policy for all agents and prepare a fresh PR #90 integration branch.  
**Repository:** `vahe210991-cloud/InOne-chat`

## Result

- **PASS:** repository-wide policy committed to `main` and linked from root `AGENTS.md` and `development/README.md`.
- **PASS:** new G2 integration branch created directly from exact current `main` SHA.
- **PASS:** integration plan committed on the new branch.
- **NOT STARTED:** PR #90 product-code port.
- **NOT RUN:** GitHub Actions on the new branch at report time; no test or build result is claimed.
- **NOT ACCEPTED:** G2 behavior is not yet integrated or release-accepted.

## Permanent policy documentation on main

- [Root agent instructions](../../AGENTS.md) — mandatory pointer and summary for every agent.
- [Full AI-agent integration policy](../AI-AGENT-GIT-INTEGRATION-POLICY.md) — main-first branch creation, selective behavior porting, architecture/security safeguards, exact-SHA Actions, PR lifecycle, reporting.
- [Development entry point](../README.md) — links the policy for all developers and agents.

Main documentation commits:
- Policy document: `ada6a32d0a52bf22f8877f263c82b7da2d1992e1`
- Root `AGENTS.md`: `7613bd9d39c5a62dbfee0891dda8942c58ea5a69`
- Development README link: `a23f9624b8dfcf6234c1770178cff503eff38553` (current main head at branch creation)

## Integration branch

- Draft integration PR: [#128](https://github.com/vahe210991-cloud/InOne-chat/pull/128). It remains open and unmerged.

- Base branch: `main`
- Exact base SHA: `a23f9624b8dfcf6234c1770178cff503eff38553`
- New branch: `integration/g2-pr90-engine-b-main-2026-11-22-r1`
- Plan commit: `32ba94552d532bfc2e0373e1175690017e36e4f8`
- Plan: [G2 / PR #90 Engine B integration plan](../../architecture/mobile/G2-PR90-ENGINE-B-INTEGRATION-PLAN.md)

The new branch starts from the latest main and contains only the integration plan documentation so far. It does not yet contain product-code changes from PR #90.

## PR #90 source facts reviewed

- PR #90 remains OPEN / DRAFT and must not be merged or closed.
- Source branch: `fix/g2-mls-ffi-hardening-2026-11-19`.
- Source head inspected: `074e76014f33f46085d46cad93007a0fbc849215`.
- Last compare to main before preparation: 115 commits ahead / 322 behind; diverged; merge base `a174f794535ab09699d38292acb4919308873fd7`.
- Source patch spans Flutter, Rust FFI, backend, Engine A, lockfiles, tests and workflows.
- Current production baseline uses canonical Engine B at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`; PR #90 points to experimental Engine A. Porting must adapt behavior to Engine B, not copy the old branch wholesale.
- Preserve Firebase Push, current app/session lifecycle, stable message/attachment IDs, authorization, SQLCipher, and native MLS disabled-by-default.

## Acceptance criteria

| Criterion | Status |
|---|---|
| Global agent policy discoverable from mandatory entry point | PASS |
| Policy committed and retrievable on main | PASS |
| New branch based on exact live main SHA | PASS |
| PR #90 source and architecture conflict documented | PASS |
| Feature-by-feature port matrix | NOT RUN |
| Product code port and regression tests | NOT STARTED |
| Exact-SHA GitHub Actions | NOT RUN |
| Security and device acceptance | NOT RUN |
| Owner approval / merge | NOT REQUESTED |

## Five preceding completed tasks/evidence

1. PR #119 merged and its accepted persistent MLS baseline retained.
2. PR #126 integrated G2 behavior through a controlled branch rather than wholesale stale-branch merge.
3. Main/PR #90 architecture comparison identified Engine B vs Engine A divergence.
4. Exact-SHA Actions acceptance practice and workflow inventory reviewed.
5. Owner directed that the main-first integration decision be persisted for every future agent.

## Five next tasks

1. Build a per-file/per-feature PR #90 port matrix against the new branch and canonical Engine B.
2. Verify Engine B Rust API signatures and current FFI/Dart contracts before editing.
3. Port durable text outbox and stable-ID attachment retry as separate vertical slices, adding focused regressions.
4. Port only missing encrypted download/auth hardening and preserve Firebase Push/session lifecycle.
5. Run all applicable Rust/FRB/backend/Flutter/Android/iOS Actions on one exact final SHA; inspect all jobs and logs.

## Owner controls and restrictions

- PR #90 remains open Draft; do not close or merge.
- Do not merge the new integration PR without explicit owner authorization.
- Do not force-push, rewrite history, enable native MLS by default, weaken cryptography, or introduce plaintext fallback.
- No local machine commands were used. Work was performed through GitHub repository operations.
