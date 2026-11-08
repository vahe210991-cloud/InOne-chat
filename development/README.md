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

## Recovered source references

- [Recovered source index](recovered-source/README.md)
- [Architecture map](recovered-source/ARCHITECTURE-MAP-2026-11-06.md)
- [Bundle verification report](recovered-source/BUNDLE-VERIFICATION.txt)
- [Initial CI failure and correction](recovered-source/CI-RESULT-42453233555.md)

## Integration briefs

- [InOne ↔ Propo authentication integration brief](integrations/INONE-PROPO-AUTH-INTEGRATION-BRIEF.md). This is a planned contract, not an implemented feature; open security/product decisions remain unresolved.

## Current status at a glance

- P0 Wave 3 recovery bundle: verified locally from the owner-provided archive; details and checksum in [BASELINE-2026-11-08.md](BASELINE-2026-11-08.md).
- P0 backend/MLS patch validation: PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18); validation rerun also opened as [#19](https://github.com/vahe210991-cloud/InOne-chat/pull/19) to obtain a fresh run on the corrected head. do not call it passed until its actual GitHub Actions checks are green.
- Reference-only P0/Flutter/Beta documents: PR [#17](https://github.com/vahe210991-cloud/InOne-chat/pull/17); not product implementation.
- Product Flutter Beta 1.0 source: not present in the recovered P0 bundle; do not claim there is a runnable mobile app until its actual source is located and built.
- Beta 1.0 uses an independent InOne backend/database. Shared operational database with Propo is deferred to a later beta.

This is a handover area, not a substitute for source code. Work in Git branches and return every change to GitHub under the rules below.
