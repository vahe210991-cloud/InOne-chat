# InOne development workspace

**Mandatory entry point for every developer, AI agent, or follow-up ChatGPT session.**

This folder defines the working protocol and the current verified development baseline. Read this file first, then read every linked instruction before touching source code.

## Required reading order

1. [WORKING-RULES.md](WORKING-RULES.md) — mandatory repository handling and hand-back rules.
2. [BASELINE-2026-11-08.md](BASELINE-2026-11-08.md) — what has actually been recovered, where it lives in GitHub, and what is still missing.
3. [HANDOVER-CHECKLIST.md](HANDOVER-CHECKLIST.md) — start/end-of-session checklist.
4. [SESSION-LOG.md](SESSION-LOG.md) — durable chronological record. Add a short entry after every substantial session.

Project-wide approved decisions and continuity documents remain in [docs/continuity/README.md](../docs/continuity/README.md). If any document conflicts, do not guess: follow the newest explicit owner decision, record the conflict in SESSION-LOG.md, and update the affected documents.

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

## Current status at a glance

- P0 Wave 3 recovery bundle: verified locally from the owner-provided archive; details and checksum in [BASELINE-2026-11-08.md](BASELINE-2026-11-08.md).
- P0 backend/MLS source is published on `recovery/p0-wave3-applied` at `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`; draft PR [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22). Functional Node/room/PostgreSQL/OpenMLS/Rust bridge checks pass on that exact SHA; overall CI remains red only at `cargo fmt -- --check` (12 Rust files). Source-integrity review remains open. See the [latest P0 recovery status](recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md).
- Reference-only P0/Flutter/Beta documents: PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17); not product implementation.
- Product Flutter Beta 1.0 source: not present in the recovered P0 bundle; do not claim there is a runnable mobile app until its actual source is located and built.
- Beta 1.0 uses an independent InOne backend/database. Shared operational database with Propo is deferred to a later beta.

This is a handover area, not a substitute for source code. Work in Git branches and return every change to GitHub under the rules below.
