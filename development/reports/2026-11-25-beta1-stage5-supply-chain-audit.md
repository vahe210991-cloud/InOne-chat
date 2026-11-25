# InOne Beta 1.0 — Stage 5 Supply-Chain and Production Operability Audit

**Date:** 2026-11-25  
**Branch:** `security/beta1-stage5-supply-chain-main-2026-11-25`  
**Base:** `main` at `74169a449de182ea734049e21d8424dfc4091c88`  
**Separate Stage 4 evidence:** Stage 4 PR #154 was independently validated 15/15 on `ee787deacb051cee981ef5c76038fd71e65cd305`; this Stage 5 branch is based directly on `main` and does not depend on Stage 4  
**Status:** Initial audit complete; Stage 5 remediation and acceptance are in progress

## Scope

Stage 5 covers dependency provenance and vulnerability visibility, GitHub Actions trust boundaries and permissions, container/build reproducibility, and operator readiness. This audit is based on repository source at the recorded `main` SHA and does not claim live registry policy, runtime-host, or cloud-account inspection.

## Findings

### S5-01 — Third-party GitHub Actions are referenced by mutable tags
**Severity: High supply-chain exposure; no compromise observed.**

The active workflow set references actions through major tags such as `@v4`, `@v7`, `@v2`, and `dtolnay/rust-toolchain@master`. These references can move without a source change in this repository. A compromised or unexpectedly changed upstream tag could alter code executed in CI.

**Evidence:** `.github/workflows/*.yml` includes checkout, setup-node, upload/download-artifact, github-script, Flutter, Rust-toolchain, Rust-cache and Android-emulator actions using mutable refs.

**Required remediation:** resolve each action release to its verified full commit SHA; pin every external action to a 40-character SHA; retain a human-readable version comment; introduce a controlled update process (Dependabot or equivalent) with review and CI. Do not guess SHAs or blindly pin to an unverified tag.

### S5-02 — Rust dependency advisory scanning is not visible in CI
**Severity: Medium; visibility gap, not evidence of a vulnerable dependency.**

The engine CI runs `npm audit --audit-level=high` and the exact-SHA gate also runs dependency audit checks. Five Cargo.lock files are committed. Three are the current/canonical mobile Rust bridge, Engine B MLS client and Engine B MLS bridge; two are legacy Engine A POC lockfiles under `inone-engine-poc-0.6.0`. The legacy client is still exercised by an existing CI workflow, so the advisory gate now scans all five committed lockfiles.

**Evidence:** lockfiles contain approximately 325, 252, 153, 252 and 153 package records respectively; no Git-sourced Cargo dependencies were found in these lockfiles.

**Required remediation:** add a reproducible Rust advisory scan for all five committed Cargo.lock files, pin the scanner/tool version, retain machine-readable output, and define a documented exception process. Do not auto-upgrade cryptographic dependencies without compatibility and MLS regression review.

### S5-03 — Container base images use mutable tags
**Severity: Medium.**

The canonical engine Dockerfile uses `node:22-alpine`; Compose uses `postgres:16`. The tags do not identify immutable image content, so a rebuild can resolve to different layers over time. The Dev Container Flutter archive is stronger: it verifies a committed SHA-256 before extraction.

**Required remediation:** pin the production-capable Node base image and the PostgreSQL images used by development/test Compose and CI to verified OCI index digests; define a controlled digest refresh cadence; rebuild and run the full Compose acceptance suite on digest changes. No production PostgreSQL deployment manifest is present, so its actual production image remains an owner/operator configuration item.

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

**Remaining remediation:** the existing config suite already covers the principal fail-closed production requirements; this stage adds explicit negative regressions for fixed email code, test UI and invalid push key. Review any remaining uncovered guard individually and verify the eventual deployment configuration does not import Dev Container defaults. No production deployment manifest is currently present to validate that boundary. Keep fixed local database credentials and the development email code confined to development tooling. Do not duplicate existing guards without a demonstrated gap.

### S5-07 — Production Docker runtime has useful baseline hardening
**Severity: Positive control with remaining verification.**

The engine image sets `NODE_ENV=production`, installs production dependencies only, copies runtime source/migrations, runs as the non-root `node` user, exposes only the application port and defines a healthcheck. Compose runtime tests exercise PostgreSQL migrations and API health/readiness.

**Follow-up:** verify read-only root filesystem compatibility, dropped Linux capabilities, resource limits, image SBOM/provenance and backup/restore behavior in the actual deployment platform before release.

## Dependency inventory snapshot

| Ecosystem | Lockfile | Approx. package records | Git dependencies |
|---|---|---:|---|
| Node engine | package-lock v3 | 119 | None observed |
| Rust mobile bridge | `mobile/rust/Cargo.lock` | 325 | None observed |
| Rust Engine B MLS client | `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/Cargo.lock` | 252 | None observed |
| Rust Engine B MLS bridge | `inone-development-archive-0.6.0/engine/mobile-mls/mls-bridge/Cargo.lock` | 153 | None observed |
| Rust legacy Engine A MLS client | `inone-engine-poc-0.6.0/mobile-mls/mls-client/Cargo.lock` | 252 | None observed |
| Rust legacy Engine A MLS bridge | `inone-engine-poc-0.6.0/mobile-mls/mls-bridge/Cargo.lock` | 153 | None observed |

The Node lockfile contains a `firebase-admin` package entry without an `integrity` field. This requires investigation against the npm registry and lockfile semantics before treating it as tampering or a defect; no conclusion is drawn from that observation alone.

## Stage 5 remediation sequence

1. Pin all external GitHub Actions to verified full commit SHAs and document the release tags.
2. Add version-pinned Cargo advisory scanning for all five committed Cargo.lock files; retain results and define triage.
3. Pin the production-capable Node base image and development/test PostgreSQL images by verified digest, with an update procedure; verify the real production database image when the deployment platform is supplied.
4. Add a production configuration guard/runbook that explicitly rejects development-only credentials, fixed verification codes and fallback secrets.
5. Define artifact retention/provenance and build an SBOM for release candidates.
6. Write and review operator procedures for secret rotation, backup/restore, migration/rollback, object-store reconciliation, incident response and safe deploy/rollback.

## Acceptance gate

- All third-party actions are SHA-pinned and the pin inventory is reviewed.
- npm and Rust advisory scans complete on the exact candidate; all critical/high findings are fixed or explicitly owner-accepted with mitigation.
- The Node base image and development/test PostgreSQL images are immutable by digest and Compose/runtime tests pass; the production platform's image and deployment settings are separately verified.
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

## Implementation checkpoint

Added focused negative configuration regressions in `engine/test/config.test.js` for production rejection of the fixed development email code, test UI enablement and an invalid push-encryption key. These tests exercise existing fail-closed guards; no production behavior was weakened or broadened. The full exact-SHA Node/PostgreSQL and acceptance checks must complete on the final Stage 5 head.


## Implementation checkpoint — supply-chain controls

### External GitHub Actions pinned

All external actions found across the 10 inspected workflow files are now pinned to immutable 40-character commit SHAs. Human-readable release comments are retained. The resolved refs were queried from the upstream GitHub repositories on 2026-11-25; the Rust toolchain action is pinned to the exact upstream `master` snapshot observed during this audit rather than following the moving branch.

| Action | Pinned commit |
|---|---|
| `actions/checkout@v4` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/upload-artifact@v4` | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `actions/setup-node@v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `subosito/flutter-action@v2` | `1a449444c387b1966244ae4d4f8c696479add0b2` |
| `dtolnay/rust-toolchain` | `df2a88e9fe4098bad09cb42c3dec7187f15861fc` |
| `reactivecircus/android-emulator-runner@v2` | `a421e43855164a8197daf9d8d40fe71c6996bb0d` |
| `actions/github-script@v7` | `f28e40c7f34bde8b3046d885e986cb6290c5673b` |
| `Swatinem/rust-cache@v2` | `d1527c8f67ef9af357290475d4af4b0fab8f12e0` |
| `actions/download-artifact@v4` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |

Pinning prevents a tag move from silently changing the action code, but does not eliminate the need to review upstream releases and update pins deliberately. The Android emulator action's resolved commit was not GitHub-signature verified by the API response; its SHA is immutable, but the upstream signature status is explicitly not represented as verified.

### OCI image digests pinned

The production-capable Node base image is pinned to the multi-platform index digest `sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a` (Node 22.23.5 Alpine 3.24). The PostgreSQL 16 image used by development Compose and CI services (not a production deployment manifest) is pinned to index digest `sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8`. The pins are applied to the canonical engine Dockerfile, the archived engine Dockerfile, development Compose files, Dev Container Compose and PostgreSQL CI service definitions. No production deployment Compose/manifest is present in this repository; the existing Compose configuration is explicitly development-only. Digests were checked against Docker Hub official-image metadata on 2026-11-25.

Digest pinning intentionally freezes image content. Refreshes must be proposed as reviewed changes, with vulnerability review and the relevant Compose/runtime acceptance checks.

### RustSec advisory scan added

A dedicated `rust-advisory-audit` job now installs `cargo-audit` at exact version `0.23.0` using `cargo install --locked`, then scans all five committed Cargo.lock files independently:
- `mobile/rust/Cargo.lock`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/Cargo.lock`
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-bridge/Cargo.lock`
- `inone-engine-poc-0.6.0/mobile-mls/mls-client/Cargo.lock` (legacy Engine A, still referenced by CI)
- `inone-engine-poc-0.6.0/mobile-mls/mls-bridge/Cargo.lock` (legacy Engine A)

The job writes JSON reports and uploads them with 14-day retention. It does not run `cargo audit fix`, update dependencies, or modify lockfiles. Advisory findings must be triaged before acceptance; cryptographic/MLS dependency upgrades remain subject to compatibility review.

### Validation status

These implementation changes trigger new exact-head CI runs. The earlier successful runs on `7636766d3789e9026ce5d8013282fecaceb03e67` do not count as validation for the updated head. Stage 5 remains in progress until all applicable workflows finish successfully on one final SHA and findings are triaged.

### Controlled update cadence

Added `.github/dependabot.yml` with weekly Monday proposals for GitHub Actions, the three Docker/Compose locations, the backend npm project and all five Cargo.lock directories, including legacy Engine A POC projects. Dependabot only opens update PRs; no auto-merge or automatic dependency mutation is configured. The operations runbook now requires manual upstream provenance review, exact-SHA CI, relevant runtime tests and explicit triage of Rust advisories before accepting updates.

### Source SBOM and provenance evidence

Added a source SBOM job using the Anchore SBOM action pinned to verified commit `e22c389904149dbc22b58101806040fa8d37a610` and Syft `v1.42.3`. It emits SPDX JSON for the repository source and a sidecar recording the exact checked-out source SHA and SBOM SHA-256. The artifact is retained for 14 days as CI evidence only; automatic release-asset upload and dependency-snapshot publishing are explicitly disabled. A PR-generated SBOM is not a release attestation and must not be promoted as one.


### Branch hygiene correction

The initial Stage 5 draft was created as a stacked branch from Stage 4. Repository policy requires task branches to be based directly on the current `main` SHA. To comply, all 19 Stage 5-specific files were selectively ported to `security/beta1-stage5-supply-chain-main-2026-11-25`, created from `main` at `74169a449de182ea734049e21d8424dfc4091c88`. No Stage 4 database-integrity changes were carried into this branch. The original stacked PR remains a historical Draft and is not the active Stage 5 candidate.


## WBS mapping and progress accounting

This work maps to the owner-approved Beta 1.0 WBS v1.1:
- **QA, CI and E2E (10%)**: supply-chain scanning, exact-SHA workflows, artifact evidence and CI hardening.
- **DevOps and release readiness (5%)**: immutable base-image references, dependency update cadence and operator procedures.

No WBS weight or cumulative percentage is changed by this Draft PR. The approved baseline remains **42% implementation / 31% verification** for Beta 1.0. Stage 5 work is not counted as accepted until all applicable criteria and exact-head checks pass. Current Stage 5 status: **NOT ACCEPTED**.

## Previous checkpoints

1. **Stage 1 B-01/B-02/B-03:** previously reported accepted on its exact-SHA gate; retained as prior baseline, not revalidated by this PR.
2. **Stage 2 B-04/B-13:** previously reported accepted; this PR does not modify that implementation.
3. **Stage 3:** PR #152 remains Draft; prior 15/15 CI result is tied to its recorded SHA and is not a merge or release approval.
4. **Stage 4 database integrity:** PR #154 remains separate Draft; 15/15 checks passed on SHA ee787deacb051cee981ef5c76038fd71e65cd305, but it is not merged and is not included in this Stage 5 branch.
5. **Stage 5 source audit:** findings S5-01 through S5-07 documented; the initial implementation now has its own main-based candidate PR #159.

## Next five tasks

1. Complete all applicable GitHub Actions on one final PR #159 head SHA; inspect every job and retain exact run links.
2. Review the five RustSec JSON reports; triage every advisory by severity, dependency path, reachability and platform applicability. Do not auto-upgrade MLS/crypto.
3. Inspect the SPDX SBOM for package coverage and validate its source-SHA and checksum sidecar; keep PR artifacts separate from release attestations.
4. Obtain the actual production deployment target/configuration and verify read-only filesystem compatibility, dropped capabilities, resource limits, secret isolation and image digest use. No production manifest is currently present in this repository.
5. Complete owner/operator evidence for production backup/restore, cloud IAM, monitoring, secret manager, HTTPS/proxy, SMTP/domain and rollback before any production-readiness claim.



## Exact-head CI results and RustSec triage — 2026-11-25

**Candidate SHA:** `7d958a4553e4e352f3208eadb8cb6ffc8e9d4c3d`  
**P0 validation run:** [45581786151](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/45581786151)  
**RustSec evidence artifact:** [rustsec-cargo-audit-45581786151-1](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/45581786151/artifacts/15030589926)

The RustSec job completed its scan and uploaded all five JSON reports, but the audit step returned non-zero for every lockfile. This is a dependency-security finding, not a Rust compilation or test failure.

| Lockfile | Vulnerability records |
|---|---:|
| `mobile/rust/Cargo.lock` | 11 |
| Engine B `mls-client/Cargo.lock` | 11 |
| Engine B `mls-bridge/Cargo.lock` | 9 |
| Legacy Engine A `mls-client/Cargo.lock` | 11 |
| Legacy Engine A `mls-bridge/Cargo.lock` | 9 |

The reports contain **11 unique vulnerability advisory IDs**, repeated across the five lockfiles:

| Package and locked version | Advisory IDs | Upstream remediation information |
|---|---|---|
| `crypto-bigint 0.5.5` | RUSTSEC-2026-0387 | RustSec lists `>=0.7.6`; this is a major-version dependency transition |
| `libcrux-aesgcm 0.0.7` | RUSTSEC-2026-0209, RUSTSEC-2026-0211 | The crate was renamed; AES implementation continues as `libcrux-aes` from 0.0.9 |
| `libcrux-chacha20poly1305 0.0.7` | RUSTSEC-2026-0124 | Patched from 0.0.8 |
| `libcrux-kem 0.0.7` | RUSTSEC-2026-0330, RUSTSEC-2026-0331 | Patched from 0.0.10 |
| `libcrux-secrets 0.0.5` | RUSTSEC-2026-0212 | Patched from 0.0.6 |
| `libcrux-sha3 0.0.8` | RUSTSEC-2026-0207, RUSTSEC-2026-0208 | Patched from 0.0.10 |
| `libsqlite3-sys 0.30.1` | RUSTSEC-2026-0459 | RustSec lists `>=0.39.0`; current client pins rusqlite 0.32.1 and SQLCipher bundled-source support |
| `url 2.5.8` | RUSTSEC-2026-0592 | Patched in `url 2.5.9` |

Two additional informational maintenance warnings are present: `libcrux-aesgcm 0.0.7` (RUSTSEC-2026-0210, renamed) and `proc-macro-error2 2.0.1` (RUSTSEC-2026-0173, unmaintained). These are not counted among the 11 vulnerability IDs.

### Dependency reachability and safe remediation boundaries

- The Libcrux packages are present in the lockfiles through OpenMLS 0.8.1's optional `openmls_libcrux_crypto` provider. The application source currently constructs `openmls_rust_crypto::RustCrypto` and does not explicitly enable the Libcrux provider. A feature-resolved dependency-tree artifact is still required before classifying those findings as inactive; the lockfile scan alone cannot establish runtime reachability.
- `crypto-bigint 0.5.5` is reached through `mls-client -> openmls_basic_credential -> p256 -> elliptic-curve`. The current configured suite is X25519/Ed25519, but the incoming Welcome path calls `StagedWelcome::new_from_welcome` without an explicit application-level suite allowlist. Do not treat the P-256 path as excluded until all inbound join paths enforce and test the allowlist.
- `rusqlite 0.32.1 -> libsqlite3-sys 0.30.1` is in the active client database path. The application enables bundled SQLCipher. The SQLite advisory requires a local crafted database/WAL pair written by a less-trusted party; actual exploitability depends on whether such a pair can reach the app's private database-open path. It remains a dependency blocker until the SQLCipher/SQLite source version is verified and updated.
- `url 2.5.8` is a direct MLS-client dependency. Update to 2.5.9 and retain the lockfile diff and test evidence.

### OpenMLS / SQLCipher upgrade must preserve persisted state

A blanket OpenMLS 0.8.1 to 0.9.0 bump is **not** approved as a mechanical dependency update. Upstream OpenMLS 0.9 documents a storage-format transition and provides `migration-export` / `migration-import` helpers. Its migration guidance recommends quiescing all MLS access, exporting each group, bridging through a zeroizing self-describing representation, importing into a fresh store, verifying group epochs/membership and application-managed keys, then atomically switching stores. The existing InOne client already uses a JSON storage codec, which is favorable, but compatibility still needs an explicit test and schema-version strategy.

The current lockfiles do not contain a separate `sqlcipher-src` package. Any move to a newer rusqlite/libsqlite3-sys must verify the actual bundled SQLCipher source version, not infer safety from the `libsqlite3-sys` version alone. Rusqlite 0.42.0 release notes report a SQLCipher 4.20.0 bump; validate that the resolved lockfile uses the patched source and that OpenMLS storage uses the same compatible rusqlite version.

**No Cargo manifests or lockfiles were changed in this checkpoint.** The dependency upgrades are deferred until the MLS storage compatibility/migration plan and ciphersuite reachability tests are ready. No advisories are suppressed or accepted by this report.

### Android Gradle failure

Flutter analysis and all 112 Flutter tests passed. The Android APK build then failed while resolving `org.gradle.kotlin.kotlin-dsl:6.4.2` from the Flutter SDK's included Gradle build. The plugin portal lists version 6.4.2, so absence of the release is not the explanation established by current evidence. The runner log does not expose the underlying HTTP/repository resolution cause.

The workflow is being instrumented to:
1. record the generated Gradle wrapper distribution;
2. fetch the exact plugin marker POM directly from Gradle Plugin Portal;
3. retain verbose Flutter/Gradle build output and generated wrapper/settings files as a short-lived diagnostic artifact.

Do not change Flutter, AGP, Kotlin DSL or Gradle versions until this evidence identifies a compatibility or repository-resolution cause.

### Exact-head workflow outcomes

At SHA `7d958a4553e4e352f3208eadb8cb6ffc8e9d4c3d`, all nine applicable workflows are terminal: six succeeded and three failed. Native MLS client validation and OpenMLS Flutter Rust Bridge generation succeeded. The primary failures are the RustSec audit and Android APK build. The exact-SHA gate failed after observing the Flutter mobile workflow failure; it is a consequential gate failure, not a third independent product defect. The P0 run's other jobs (SBOM, Backend Node, OpenMLS client, Rust bridge, Rust format, room-list regression and PostgreSQL integration) succeeded.

Stage 5 remains **NOT ACCEPTED**. No merge, deployment, production release, or changes to `main` are authorized by this checkpoint.
