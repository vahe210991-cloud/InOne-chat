# ADR-004: Canonical identity and ownership of the InOne Beta 1.0 backend

- **Date:** 2026-11-21
- **Status:** Accepted
- **Decision owner:** Product owner
- **Scope:** Repository layout, Node.js backend identity, documentation and CI guardrails

## Context

The active Node.js backend is maintained at `inone-development-archive-0.6.0/engine/`. Its path contains the word `archive`, while its npm metadata identified it as `inone-engine-poc` and described it as a temporary Variant A implementation. This conflicts with the current source-of-truth decision and can cause developers to edit or execute the wrong tree.

The repository also contains `inone-engine-poc-0.6.0/`. It is not a second interchangeable copy. The A1 engine-tree audit established separate ownership boundaries: the archive-path tree is canonical for Node.js backend, database migrations and Node backend tests; the POC-path tree is canonical for the Flutter-connected persistent Rust MLS client.

## Decision

1. `inone-development-archive-0.6.0/engine/` is the canonical Node.js backend source for InOne Beta 1.0.
2. Its npm package identity is `inone-backend`, version `0.6.0`, private.
3. The existing directory path is retained for compatibility and historical provenance. The word `archive` in the path is not a lifecycle or ownership designation.
4. `inone-engine-poc-0.6.0/mobile-mls/mls-client/` remains the canonical Flutter-connected persistent Rust MLS client because `mobile/rust/Cargo.toml` directly depends on that path.
5. The Node.js files under `inone-engine-poc-0.6.0/` remain a historical/experimental snapshot and are not the canonical Beta 1.0 backend.
6. Backend source, PostgreSQL schema/migrations and Node tests are changed only in the canonical backend path. Rust MLS changes remain on their separately approved path.
7. No directory move, source-tree consolidation, backend rewrite, MLS dependency switch or Identity architecture change is authorized by this decision.

## Consequences

- Node package metadata and lockfile use the same canonical package name.
- The backend README and mobile setup instructions identify the same active backend path.
- A focused regression test protects package/lockfile identity from reverting to POC/temporary naming.
- Historical references and release artifacts may continue to contain `inone-engine-poc`; they must be interpreted according to their path and role, not globally renamed.
- The directory name is intentionally not renamed in this change to avoid breaking scripts, CI path filters, relative imports, local checkouts and external references.

## Validation requirements

- Verify package.json and package-lock.json root identities match.
- Run the focused backend identity test and full Node backend suite.
- Run PostgreSQL integration tests where the configured database is available.
- Verify the canonical backend path remains the working directory used by backend CI/devcontainer entry points.
- Review the complete PR diff and exact-head CI before merge.

## Non-goals

This ADR does not assert production readiness, complete Beta 1.0 acceptance, or completion of mobile MLS runtime gates. It only resolves repository ownership and identity ambiguity.
