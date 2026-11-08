# InOne — CTO status and delivery checklist

**Status date:** 2026-11-08  
**Repository:** `vahe210991-cloud/InOne-chat`  
**Scope:** Beta 1.0 baseline (account, chats, organizations, profile, MLS). Tasks, Calendar and Cindy are outside this Beta 1.0 scope.

## Corrected progress baseline

The previous 35% estimate is withdrawn. It measured only what was visible on the then-accessible GitHub branches and omitted the prior local development work. Use this baseline until a new reproducible source audit changes it:

| Workstream | Implementation | Verified / acceptance |
|---|---:|---:|
| Backend P0 | **80%** | **40%** |
| Frontend Beta 1.0 | **70%** | **0%** |
| API ↔ MLS integration | **50%** | **0%** |
| Testing workstream | **60%** | Execution incomplete; see test gates |
| End-to-end Beta 1.0 | **0%** | **0%** |

These are separate measures, not a single additive percentage. Implementation progress includes code and test preparation; verified progress counts only executed checks with retained evidence. Do not reduce progress merely because a local branch is not yet published, and do not increase verified progress for static checks or tests that could not run.

## Recovered local development state

- Backend local work includes branch `cto/p0-exact-pending-commit`, commit `6fe6b67`, and the later P0 finalize-fixtures handoff identifies local branch `cto/p0-finalize-fixtures`, commit `cbecb37`.
- Frontend local branch: `ui/beta1-api-integration`; recorded commits `e83858b` (shared API/MLS session refresh) and `97d08fd` (contract/documentation).
- The 2026-11-08 roadmap records Beta 1.0 screens/navigation, real room/org/profile API wiring, email/password auth, email-confirmed registration, recovery flow, memory-only access/refresh tokens, stable device ID, refresh delegation and Dart source-contract tests.
- P0 work includes operation-id protections, durable inbox/outbox and membership journals, commit metadata verification, quarantine/WaitingForCommit handling, exact device-removal identity, repeatable Key Package claims, and outbound ACK/restart reconciliation through Patch 020.
- Saved handoff artifacts include `InOne-P0-2026-11-08.bundle`, `InOne-P0-local-2026-11-08.bundle`, `InOne-Backend-MLS-Session-2026-11-08.zip`, and `InOne-Beta1-UI-API-2026-11-08-r2.zip`. These artifacts are not yet represented by a published canonical source branch in the currently connected GitHub repository.

## Verified / blocked test gates

- Node syntax checks for JS/MJS source: passed in the saved 2026-11-08 roadmap run.
- Focused Node common/auth/API/MLS source-contract tests: **12/12 passed** in that run.
- Full Node suite: **blocked**, dependencies such as `qrcode` and `libphonenumber-js/max` were missing; 74 of 85 files/subtests failed during module loading, not proven product regressions.
- Rust check/tests: **blocked**, Rust 1.91 toolchain unavailable in that environment.
- PostgreSQL migration/concurrency acceptance: **blocked**, no PostgreSQL service or `DATABASE_URL`.
- Flutter analyze/widget tests: **blocked**, Flutter/Dart SDK unavailable.
- Native Android/iOS MLS handlers, FFI packaging, secure Keychain/Keystore provider and durable local message store remain unimplemented; native MLS stays fail-closed.
- GitHub PR #10's older archived 0.6.0 workflow run is not acceptance evidence for the latest local P0 source.

## Next delivery checklist

- [ ] Restore the latest canonical P0 bundle and UI/API r2 source into a working environment with raw-byte access; verify hashes, branches, clean trees and exact commits before changing anything.
- [ ] Preserve original Git history; publish the canonical source with normal Git transport only after ancestry/merge-base checks. Never snapshot-rebase onto `main`, force-push or overwrite unrelated history.
- [ ] Run Rust 1.91: `cargo fmt --check`, `cargo check --locked --all-targets`, `cargo test --locked --no-fail-fast`, including `membership_outbox` and `consistency`.
- [ ] Restore Node dependencies; run `npm ci`, `npm test`, focused MLS tests and `npm run test:db` against PostgreSQL 16, including fresh-schema and upgrade migrations.
- [ ] Install Flutter/Dart; run `flutter pub get`, `flutter analyze`, `flutter test`; fix all findings.
- [ ] Implement Android/iOS native MLS handlers, Rust FFI packaging, Keychain/Keystore-backed SQLCipher key provider and durable local message store; keep plaintext fallback prohibited.
- [ ] Run two-device E2E: registration/login/recovery, organizations, send/receive, offline/restart, duplicate delivery, refresh rotation, membership changes, key-package claim recovery and quarantine behavior.
- [ ] Add and validate the independent InOne + Propo Identity Service, in-app Armenian/Russian/English localization (future French/German/Spanish), and planned chat-theme/icon extension points as separate scope beyond the recovered Beta 1.0 baseline.
- [ ] Open reviewable PRs only after required CI is green; merge only after review and explicit release gate.

## Change control

The approved product decisions are recorded in `docs/PRODUCT-DECISIONS-IDENTITY-LOCALIZATION-DESIGN.md`. The corrected primary icon remains: exact wordmark `InOne`; black bold connected letters; white outline directly around the letters; green background without a white perimeter; layered glass aesthetic. The design-system source of truth must be preserved unchanged.
