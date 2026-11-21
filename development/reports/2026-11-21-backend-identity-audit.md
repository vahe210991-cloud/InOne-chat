# Backend identity audit and remediation — 2026-11-21

## Executive result

The reported inconsistency is confirmed. The active Node.js backend source is `inone-development-archive-0.6.0/engine/`, but its npm package previously used the name `inone-engine-poc` and described itself as a temporary Variant A implementation.

The issue is architectural/documentary, not evidence that the working backend should be moved or rewritten. The canonical ownership decision already exists in the A1 engine-tree drift audit and the current continuity record; the package metadata and developer-facing instructions had not been brought into alignment.

## Evidence reviewed

1. Repository default branch at audit start: `main`, HEAD `26568caf8c4c3ac23a5dccb1e073d12bb813af52` (2026-11-20).
2. `inone-development-archive-0.6.0/engine/package.json`: package name `inone-engine-poc`, version `0.6.0`, description called it a temporary Variant A implementation.
3. `inone-development-archive-0.6.0/engine/package-lock.json`: root package name and `packages[""]` name repeated the same obsolete identity.
4. `.devcontainer/devcontainer.json` installs dependencies from the canonical backend path.
5. `.devcontainer/start-backend.sh` starts the backend from the canonical backend path.
6. `.github/workflows/validate-published-p0.yml` sets `ENGINE_DIR` to the canonical backend path and uses its package lock, Node suite, PostgreSQL suite and Rust/OpenMLS paths.
7. `docs/continuity/CURRENT-STATE.md` already identifies `inone-development-archive-0.6.0/engine` as canonical Node backend and separately identifies the POC tree's Rust MLS client as the Flutter-connected persistent client.
8. `development/reports/2026-11-12-A1-engine-tree-drift-audit.md` records the ownership split after a tree/blob comparison: Node API, migrations and Node tests belong to tree A; Flutter-connected Rust MLS client belongs to tree B.
9. `mobile/README.md` contained an obsolete instruction to run the Node backend from `../inone-engine-poc-0.6.0`, contradicting the active devcontainer and P0 workflow paths.

## Architecture decision

The canonical Node.js backend remains at `inone-development-archive-0.6.0/engine/`. The package identity is `inone-backend` (private, version 0.6.0). The directory is not moved or renamed.

The separate `inone-engine-poc-0.6.0/mobile-mls/mls-client/` remains the canonical Flutter-connected Rust MLS client because `mobile/rust/Cargo.toml` has a direct path dependency on it. The separate POC tree must not be globally renamed or overwritten: its Rust client has distinct persistence/security behavior, while the Node backend in tree A has newer backend migrations and API/store safeguards.

## Changes made on this branch

- Updated canonical backend `package.json` name to `inone-backend` and removed the temporary Variant A description.
- Updated `package-lock.json` root name and `packages[""].name` to match; dependencies and resolved package versions were not intentionally changed.
- Replaced the stale engine README with current ownership, install/run, validation and change-boundary instructions.
- Corrected the mobile setup guide to launch the canonical backend path and explicitly distinguish the POC tree's Rust MLS client.
- Added `test/backend-identity.test.js` and included it in `npm test`. It checks package identity, description and package-lock synchronization.
- Added ADR-004 and `docs/continuity/BACKEND-SOURCE-OF-TRUTH.md`.
- Updated the continuity state and session log with this decision and the branch status.

## Compatibility and safety assessment

- No backend source modules, migrations, SQL schema, API routes, Rust code, FFI bindings, or database data were changed.
- No directory was moved or renamed.
- No Node backend source was copied from the POC tree.
- The Rust path dependency in `mobile/rust/Cargo.toml` was not changed.
- CI/devcontainer working paths remain unchanged.
- The npm package is private; the package name change does not alter runtime import paths or API routes. The lockfile metadata is kept in sync.

## Verification status

The following checks are required on the resulting PR head:

- [ ] Focused: `node --test test/backend-identity.test.js`
- [ ] Full Node backend suite: `npm test`
- [ ] Dependency audit: `npm audit --audit-level=high`
- [ ] PostgreSQL suite: `npm run test:db` against the configured PostgreSQL service
- [ ] Related Rust/OpenMLS checks on the workflow's pinned toolchain
- [ ] Final exact-head workflow review

**Important:** this report does not claim those commands passed. Source edits were made through GitHub repository operations; no local Node/PostgreSQL/Rust execution is available in this session. CI evidence must be checked on the final PR SHA before acceptance.

## Merge boundary

The work is isolated to `fix/canonical-backend-identity-2026-11-21`. It must be reviewed through a pull request. Do not merge to `main` without explicit owner approval.

## Pull request and CI status

- Draft PR: [#120 — canonical InOne backend identity](https://github.com/vahe210991-cloud/InOne-chat/pull/120), base `main`, head `1741651a3212057b0d6b8feb4b30ad7e7212c826`.
- The PR is open, draft and not merged. GitHub reports it mergeable at the time of inspection; this is not an approval to merge.
- Exact-head workflow runs were created: P0 validation `44871378564`; Email/PostgreSQL validation `44871379518`; Flutter validation `44871378516`; iOS validation `44871378501`.
- All listed jobs were still `queued` at the latest check. No job has produced a pass/fail result, and no test execution is claimed.
- CI currently schedules unrelated Flutter/iOS workflows as well as backend checks for this PR. Do not interpret queued jobs as completed validation.
