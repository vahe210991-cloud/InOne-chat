# InOne Beta 1.0 — Stage 5 Supply-Chain and Production Operability Audit

**Date:** 2026-11-25  
**Branch:** `security/beta1-stage5-supply-chain-2026-11-25`  
**Base:** Stage 4 candidate `ee787deacb051cee981ef5c76038fd71e65cd305`  
**Stage 4 evidence:** 15/15 checks completed successfully on the exact candidate SHA  
**Status:** Initial audit complete; Stage 5 remediation and acceptance are in progress

## Scope

Stage 5 covers dependency provenance and vulnerability visibility, GitHub Actions trust boundaries and permissions, container/build reproducibility, and operator readiness. This audit is based on repository source at the Stage 4 candidate and does not claim live registry, runtime-host, or cloud-account inspection.

## Findings

### S5-01 — Third-party GitHub Actions are referenced by mutable tags
**Severity: High supply-chain exposure; no compromise observed.**

The active workflow set references actions through major tags such as `@v4`, `@v7`, `@v2`, and `dtolnay/rust-toolchain@master`. These references can move without a source change in this repository. A compromised or unexpectedly changed upstream tag could alter code executed in CI.

**Evidence:** `.github/workflows/*.yml` includes checkout, setup-node, upload/download-artifact, github-script, Flutter, Rust-toolchain, Rust-cache and Android-emulator actions using mutable refs.

**Required remediation:** resolve each action release to its verified full commit SHA; pin every external action to a 40-character SHA; retain a human-readable version comment; introduce a controlled update process (Dependabot or equivalent) with review and CI. Do not guess SHAs or blindly pin to an unverified tag.

### S5-02 — Rust dependency advisory scanning is not visible in CI
**Severity: Medium; visibility gap, not evidence of a vulnerable dependency.**

The engine CI runs `npm audit --audit-level=high` and the exact-SHA gate also runs dependency audit checks. Three Rust lockfiles are committed (mobile bridge, canonical MLS client and mobile Rust bridge), but the inspected workflows do not run `cargo audit` against all three.

**Evidence:** lockfiles contain approximately 325, 252 and 153 package records respectively; no Git-sourced Cargo dependencies were found in these lockfiles.

**Required remediation:** add a reproducible Rust advisory scan for each maintained lockfile, pin the scanner/tool version, retain machine-readable output, and define a documented exception process. Do not auto-upgrade cryptographic dependencies without compatibility and MLS regression review.

### S5-03 — Container base images use mutable tags
**Severity: Medium.**

The canonical engine Dockerfile uses `node:22-alpine`; Compose uses `postgres:16`. The tags do not identify immutable image content, so a rebuild can resolve to different layers over time. The Dev Container Flutter archive is stronger: it verifies a committed SHA-256 before extraction.

**Required remediation:** record and pin approved image digests for production-capable Node and PostgreSQL images; define a controlled digest refresh cadence; rebuild and run the full Compose acceptance suite on digest changes. Confirm architecture/platform compatibility before pinning.

### S5-04 — Existing CI permissions are generally least-privilege
**Severity: Positive control.**

The inspected workflows explicitly set `contents: read`. The exact-SHA acceptance workflow additionally requests `actions: read` and `pull-requests: read`, matching its job needs. No write permission was found in the inspected workflow declarations; no `pull_request_target` trigger or repository-secret expression was found in the inspected workflow set. PR validation checks out the PR head SHA.

**Follow-up:** preserve these permissions; make permissions job-level where practical; do not add write tokens to untrusted PR validation. Re-review any future workflow that consumes artifacts across trust boundaries.

### S5-05 — Artifact retention and provenance are partially implemented
**Severity: Low/Medium.**

Some build/test artifacts have explicit 7- or 14-day retention. Generated Flutter/Rust bridge artifacts include source SHA and checksums and the iOS consumer verifies them before copying. Other artifacts do not have explicit retention in the inspected workflow set.

**Required remediation:** define artifact classes and retention by sensitivity/use; require provenance (source SHA, toolchain versions, checksums) for cross-job build artifacts; ensure artifacts from untrusted PRs are never treated as release artifacts.

### S5-06 — Development Compose contains convenience credentials and fixed development identity settings
**Severity: Low when isolated to development; high if reused as production configuration.**

The Dev Container Compose file contains fixed local database credentials and a fixed development email code. The engine Compose file labels itself development-only and has a development pepper fallback. These are not production secrets, but must remain isolated from production deployment paths.

**Existing production guard:** `src/config.js` rejects the development email code in production, rejects a missing/short/test-marked PIN pepper, rejects open registration, requires HTTPS public URL, SMTP with TLS, persistent file storage, Firebase project ID, a valid 32-byte push key, and a strong docs secret; it also rejects test UI. The development PIN-pepper fallback is only applied outside production.

**Remaining remediation:** add explicit regression coverage for each production rejection and verify that deployment configuration never imports Dev Container Compose defaults. Keep fixed local database credentials and the development email code confined to development tooling. Do not duplicate existing guards without a demonstrated gap.

### S5-07 — Production Docker runtime has useful baseline hardening
**Severity: Positive control with remaining verification.**

The engine image sets `NODE_ENV=production`, installs production dependencies only, copies runtime source/migrations, runs as the non-root `node` user, exposes only the application port and defines a healthcheck. Compose runtime tests exercise PostgreSQL migrations and API health/readiness.

**Follow-up:** verify read-only root filesystem compatibility, dropped Linux capabilities, resource limits, image SBOM/provenance and backup/restore behavior in the actual deployment platform before release.

## Dependency inventory snapshot

| Ecosystem | Lockfile | Approx. package records | Git dependencies |
|---|---|---:|---|
| Node engine | package-lock v3 | 119 | None observed |
| Rust mobile bridge | Cargo.lock | 325 | None observed |
| Rust MLS client | Cargo.lock | 252 | None observed |
| Rust MLS bridge | Cargo.lock | 153 | None observed |

The Node lockfile contains a `firebase-admin` package entry without an `integrity` field. This requires investigation against the npm registry and lockfile semantics before treating it as tampering or a defect; no conclusion is drawn from that observation alone.

## Stage 5 remediation sequence

1. Pin all external GitHub Actions to verified full commit SHAs and document the release tags.
2. Add version-pinned Cargo advisory scanning for all maintained Rust lockfiles; retain results and define triage.
3. Pin canonical production Node and PostgreSQL images by verified digest, with an update procedure.
4. Add a production configuration guard/runbook that explicitly rejects development-only credentials, fixed verification codes and fallback secrets.
5. Define artifact retention/provenance and build an SBOM for release candidates.
6. Write and review operator procedures for secret rotation, backup/restore, migration/rollback, object-store reconciliation, incident response and safe deploy/rollback.

## Acceptance gate

- All third-party actions are SHA-pinned and the pin inventory is reviewed.
- npm and Rust advisory scans complete on the exact candidate; all critical/high findings are fixed or explicitly owner-accepted with mitigation.
- Production image digests are immutable and Compose/runtime tests pass.
- Production configuration cannot silently fall back to development secrets or fixed verification codes.
- Artifact provenance/retention policy is documented and tested.
- Operator runbook covers the listed recovery and deployment procedures.
- All applicable CI checks are terminal and successful on one exact SHA.

## Constraints

- No changes to `main`, no merge, no deployment and no repository settings/secrets mutation.
- No automatic dependency upgrades without compatibility review.
- Preserve Beta 1.0 API/client compatibility and MLS cryptographic invariants.
- No secret values are to be committed or written into reports.
- This is a source-level audit; cloud IAM, registry policy, production host settings, actual backup integrity and live provider credentials require owner/operator evidence.
