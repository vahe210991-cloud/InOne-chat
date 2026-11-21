# InOne backend — source of truth

**Effective date:** 2026-11-21  
**Decision:** [ADR-004 — Canonical identity and ownership of the InOne Beta 1.0 backend](../../development/architecture/ADR-004-CANONICAL-BACKEND-IDENTITY.md)

## Canonical ownership

| Component | Canonical path | Scope |
|---|---|---|
| InOne Beta 1.0 Node.js backend | `inone-development-archive-0.6.0/engine/` | HTTP API, server runtime, persistence, migrations, backend tests |
| Persistent Rust MLS client used by Flutter | `inone-engine-poc-0.6.0/mobile-mls/mls-client/` | MLS client and its Rust persistence/security implementation |
| Flutter Rust Bridge wrapper | `mobile/rust/` | Flutter-facing FFI boundary |

## Important naming rule

The npm package in the canonical backend directory is `inone-backend`. The physical directory name `inone-development-archive-0.6.0` is retained for compatibility and provenance; it does not mean that the code is archived or inactive.

The separate `inone-engine-poc-0.6.0/` tree is not the canonical Node.js backend. Its Rust MLS client subdirectory remains canonical for the Flutter-connected persistent MLS client. Do not infer ownership for the entire tree from its top-level name.

## Developer entry points

- Backend package metadata: `inone-development-archive-0.6.0/engine/package.json`
- Backend package lock: `inone-development-archive-0.6.0/engine/package-lock.json`
- Backend instructions: `inone-development-archive-0.6.0/engine/README.md`
- Mobile setup instructions: `mobile/README.md`
- P0 backend workflow: `.github/workflows/validate-published-p0.yml`

From the repository root, install and test the backend with:

```sh
cd inone-development-archive-0.6.0/engine
npm ci
npm test
```

Run database-backed tests with a configured `DATABASE_URL` and PostgreSQL:

```sh
npm run test:db
```

## Change boundaries

- Backend routes, stores, migrations and Node tests: edit only the canonical backend path.
- Flutter-connected Rust MLS client: edit its canonical Rust path after reviewing the relevant mobile/MLS task and tests.
- Never copy an entire Node backend tree from the POC path over the canonical backend.
- Do not move or rename the existing backend directory without a separate migration plan covering all CI, scripts, path dependencies, developer environments and historical artifacts.
- Production readiness and Beta 1.0 acceptance are separate from this source-ownership decision.
