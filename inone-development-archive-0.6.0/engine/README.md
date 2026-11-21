# InOne Beta 1.0 Backend

## Canonical identity

This directory is the **canonical Node.js backend source for InOne Beta 1.0**.

- Canonical repository path: `inone-development-archive-0.6.0/engine/`
- npm package name: `inone-backend`
- Package version: `0.6.0`
- Runtime: Node.js `>=22`
- Package is private and is not published to the npm registry.

The directory name is retained for repository-path compatibility and historical provenance. The word `archive` in that path does **not** mean that this source is inactive, read-only, or superseded. Backend implementation, migrations, and Node.js backend tests are maintained here.

## Repository ownership boundaries

The repository also contains `inone-engine-poc-0.6.0/`. It is a separate historical/experimental tree and must not be treated as the canonical Node.js backend.

The Flutter-connected persistent Rust MLS client currently has a separate canonical location:

`inone-engine-poc-0.6.0/mobile-mls/mls-client/`

That Rust path is consumed by `mobile/rust/Cargo.toml`. Its presence does not make the Node.js backend in the POC tree canonical. Do not copy or replace Node backend files between these trees without a separately reviewed migration and source-diff audit.

| Responsibility | Canonical source |
|---|---|
| Node.js HTTP API and backend runtime | `inone-development-archive-0.6.0/engine/` |
| PostgreSQL schema and migrations | `inone-development-archive-0.6.0/engine/` |
| Node.js backend tests | `inone-development-archive-0.6.0/engine/test/` |
| Flutter-connected persistent Rust MLS client | `inone-engine-poc-0.6.0/mobile-mls/mls-client/` |
| Flutter Rust Bridge wrapper | `mobile/rust/` |

## Install and run

From the repository root:

```sh
cd inone-development-archive-0.6.0/engine
node --version
npm ci
npm test
```

Start the backend with:

```sh
npm start
```

Database-backed tests use `DATABASE_URL` and the configured PostgreSQL test database:

```sh
npm run test:db
```

Apply database migrations with:

```sh
npm run migrate
```

The backend requires a sufficiently strong `PIN_PEPPER` (at least 32 characters) for PIN-related secret derivation. Use environment-specific secrets; never commit credentials or production secrets.

## Validation and release status

The package scripts define the Node.js unit/integration suite and the database-backed suite. CI workflows also validate PostgreSQL integration and the related Rust/OpenMLS components on their configured toolchains.

A passing source test suite is not, by itself, production deployment acceptance. Production SMTP/domain delivery, deployment and reverse-proxy configuration, backup/restore, monitoring, operational secrets, and real-device/mobile MLS acceptance remain separate release gates. Do not describe the backend as production-ready unless those gates have been evidenced on the exact release candidate.

## Change policy

1. Make Node.js backend, migration, and backend-test changes in this directory.
2. Keep `package.json` and `package-lock.json` package identity synchronized.
3. Preserve database migration history and existing P0/security regression tests.
4. Do not move this directory or rename its path as part of a metadata-only cleanup.
5. Keep the POC Rust MLS client on its separately approved path until an explicit migration is reviewed and tested.
