# Recovery attempt — 2026-11-08

## What was checked in this session

- GitHub repository: `vahe210991-cloud/InOne-chat`; default branch: `main`.
- Current remote branch search returned: `main`, `development`, `engine-poc`, `ci/inone-engine-validation-2026-11-07`, `docs/inone-identity-design-localization`, and `cto/inone-audit-2026-11-08`.
- Current audit branch head: `a07815227ecf004628f5b3b94154a4f16de8d1bd`; it contains the archived 0.6.0 source, 0.7 planning, and a small client-screens API/state spike. It does not contain the current local P0 branch or the Beta 1.0 Flutter app archive.
- GitHub tree inspection confirmed the tracked engine source is the archived `inone-engine-poc-0.6.0`; the tracked 0.7 client-screens content is a limited spike, not the complete Beta 1.0 app.
- Library root was enumerated and the following expected artifacts are present: `InOne-P0-2026-11-08.bundle` (1,113,913 bytes), `InOne-P0-local-2026-11-08.bundle` (1,099,129 bytes), `InOne-Backend-MLS-Session-2026-11-08.zip` (1,155,912 bytes), `InOne-Beta1-UI-API-2026-11-08-r2.zip` (44,630 bytes), and `InOne-mobile-design-system-curated.html` (1,301,233 bytes), plus P0 state/acceptance/roadmap docs and patches 016–020.
- The P0 state/acceptance/roadmap documents are readable through Library text retrieval. They corroborate that the P0 bundle and UI ZIP contain the current work, but they are not substitutes for importing and testing the source bytes.
- Retried raw-byte materialization for the P0 bundles, UI ZIP, backend session ZIP, and design-system HTML. The service rejected every item with: `This Project file does not have an authorized raw-byte materialization path.` Binary reads also failed at the Files layer. No bytes were copied into the working container.

## Consequence

No source archive was imported, no bundle SHA-256 was computed, no Git ancestry/diff comparison was performed, and no current P0/UI code was published. Do not report otherwise. Do not merge PR #10 or use its archived 0.6.0 CI as current acceptance.

## Next technical action

Find a supported path to obtain the existing Library artifact bytes or a source-export action with authorized access. If no such path exists in this environment, continue with available GitHub source and identify a safe, auditable source-transfer mechanism; do not invent code, reconstruct binary archives from snippets, or ask the owner to upload files already in Library.

## Product decision recorded

Owner confirmed: Beta 1.0 uses an independent InOne database/backend; shared InOne+Propo database is deferred until the next beta. See [ADR-011](ADR-011-BETA1-INDEPENDENT-DATABASE.md).
