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

- The committed manifests specify OpenMLS `0.8` and RustCrypto provider `0.5`; the five lockfiles resolve OpenMLS `0.8.3` and `openmls_rust_crypto 0.5.1`. Feature-resolved dependency graphs from run [45692885295](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/45692885295), artifact [15058534729](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/45692885295/artifacts/15058534729), now establish reachability. `libcrux-sha3 0.0.8` and `libcrux-secrets 0.0.5` are active in all five default-feature graphs (through the HPKE stack); their advisories RUSTSEC-2026-0207, RUSTSEC-2026-0208 and RUSTSEC-2026-0212 are active findings. By contrast, `libcrux-aesgcm`, `libcrux-chacha20poly1305` and `libcrux-kem` do not appear in any of the five graphs; their five advisory IDs are present in Cargo.lock through the optional Libcrux provider but are not activated by the current default feature graph. The full lockfile scan still records them, and no advisories are suppressed.
- `crypto-bigint 0.5.5` is reached through `mls-client -> openmls_basic_credential -> p256 -> elliptic-curve`. The current configured suite is X25519/Ed25519, but the incoming Welcome path calls `StagedWelcome::new_from_welcome` without an explicit application-level suite allowlist. Do not treat the P-256 path as excluded until all inbound join paths enforce and test the allowlist.
- `rusqlite 0.32.1 -> libsqlite3-sys 0.30.1` is in the active client database path. The application enables bundled SQLCipher. The SQLite advisory requires a local crafted database/WAL pair written by a less-trusted party; actual exploitability depends on whether such a pair can reach the app's private database-open path. It remains a dependency blocker until the SQLCipher/SQLite source version is verified and updated.
- `url 2.5.8` is a direct MLS-client dependency. Update to 2.5.9 and retain the lockfile diff and test evidence.

### OpenMLS / SQLCipher upgrade must preserve persisted state

A blanket OpenMLS 0.8.3 to 0.9.0 bump is **not** approved as a mechanical dependency update. The upstream 0.9 migration guide specifically documents migration from the 0.8.1 storage format; the compatibility of the currently resolved 0.8.3 format with that helper path must be established before any change. OpenMLS 0.9 provides `migration-export` / `migration-import` helpers. Its migration guidance recommends quiescing all MLS access, exporting each group, bridging through a zeroizing self-describing representation, importing into a fresh store, verifying group epochs/membership and application-managed keys, then atomically switching stores. The existing InOne client already uses a JSON storage codec, which is favorable, but compatibility still needs an explicit test and schema-version strategy.

The current lockfiles do not contain a separate `sqlcipher-src` package. Any move to a newer rusqlite/libsqlite3-sys must verify the actual bundled SQLCipher source version, not infer safety from the `libsqlite3-sys` version alone. Rusqlite 0.42.0 release notes report a SQLCipher 4.20.0 bump and bundled SQLite 3.54.1. However, upstream `openmls_sqlite_storage 0.3.0` still declares `rusqlite = "0.37"`, which remains below the RustSec patch floor for `libsqlite3-sys`. Therefore OpenMLS 0.9 plus the unmodified storage crate does **not** resolve RUSTSEC-2026-0459. A reviewed fork/patch of `openmls_sqlite_storage 0.3.0` to use the same rusqlite 0.42 dependency and SQLCipher feature set, or a newer upstream storage release with that dependency, is required. The type unification is essential: the storage provider accepts a `rusqlite::Connection` from its own rusqlite version, so upstream 0.3.0's 0.37 connection cannot share the application's 0.42 connection or its SQLCipher feature unification. Using the unmodified 0.3.0 crate would either retain the vulnerable SQLite source or introduce a separate non-SQLCipher database path, which conflicts with the existing atomicity ADR. The fork must pass storage migrations, SQLCipher key handling, and MLS persistence compatibility tests before use.

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


## Targeted remediation checkpoint — URL and MLS suite policy

### RUSTSEC-2026-0592 is directly reachable in the canonical client

Source tracing confirmed that Engine B's `Client::same_origin_url` calls `target.origin()` before checking the URL scheme. This validator is applied to server-returned `uploadUrl` and `downloadUrl` values from file reservation and file-link responses. A malicious or compromised API response can therefore supply a deeply nested `blob:` URL and reach the recursive `Url::origin()` path described by RustSec, potentially aborting the client process through stack overflow. This is not merely a lockfile-only finding.

The targeted fix in this checkpoint:
- raises the direct `url` minimum to 2.5.9 in the canonical and legacy MLS client manifests;
- updates `url` to 2.5.9 and `form_urlencoded` to 1.2.3 in the three affected lockfiles (`mobile/rust`, canonical Engine B client, legacy Engine A client);
- rejects non-HTTP(S) schemes before calling `origin()`, preserving the existing same-origin and `/objects/` constraints;
- adds a regression test with 10,000 nested `blob:` prefixes, plus a valid same-origin HTTPS case.

RustSec documents that `Url::origin()` through 2.5.8 recursively evaluated nested `blob:` prefixes and that 2.5.9 removes this recursion. The dependency bump and the scheme guard are both retained; neither is treated as a substitute for the other.

### Explicit MLS Welcome ciphersuite policy

The canonical Engine B client and bridge now inspect the verified `StagedWelcome.group_context().ciphersuite()` and reject any suite other than `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` before `into_group` consumes the key package or stores the group. OpenMLS 0.8.3 itself checks that the Welcome ciphersuite matches the locally stored KeyPackage ciphersuite before decrypting GroupSecrets; InOne creates only X25519/Ed25519 KeyPackages. The application-level check adds an explicit policy boundary before committing group state. Regression tests accept the configured suite and reject `MLS_128_DHKEMP256_AES128GCM_SHA256_P256`.

This does **not** remove `crypto-bigint` from the lockfiles: it remains transitively present through `p256`/OpenMLS. No RustSec advisory is suppressed. The remaining advisory requires a separately reviewed dependency/provider strategy; this checkpoint only closes the inbound Welcome policy gap.

### Feature-resolved dependency graph evidence

The P0 workflow now records `cargo tree --all-targets --edges all` for each of the five audited manifests and uploads the resulting graphs beside the RustSec JSON. This is needed because the lockfile-level audit includes optional dependencies, including OpenMLS's optional Libcrux provider. The new graph evidence will distinguish packages present in Cargo.lock from packages activated by the default feature set. No optional-provider advisory is classified as inactive until that exact-head evidence is reviewed.

### Android Gradle diagnostic correction

The first diagnostic run on `c0a22d46e54de3fd83fba4226e94928c163304b1` stopped before the APK build because the diagnostic URL itself omitted the `kotlin-dsl` segment in the Maven group path and returned HTTP 404. That was an error in the newly added probe, not a Gradle build result. The corrected probe now uses the exact marker coordinate:
`org.gradle.kotlin.kotlin-dsl:org.gradle.kotlin.kotlin-dsl.gradle.plugin:6.4.2`
and the corresponding Gradle Plugin Portal path. The upload-artifact paths are also rooted at the repository workspace so generated Android settings/wrapper files can be retained.

### Exact-head status at the time of this checkpoint

On `c0a22d46e54de3fd83fba4226e94928c163304b1`, three workflows succeeded (Backend Compose, Email/PostgreSQL, Dev Container); RustSec/P0 failed on the same five lockfile findings; Flutter mobile stopped at the incorrectly formed diagnostic URL; the exact-SHA gate failed after P0 reported failure. OpenMLS FRB generation was still running and Native MLS/iOS validation were queued. This checkpoint does not claim those pending jobs passed.

The next exact head must verify the URL regression tests, MLS Welcome policy tests, lockfile consistency, active dependency graphs, corrected Gradle marker probe, and the full CI set. Stage 5 remains **NOT ACCEPTED** until active RustSec findings and production-operator evidence are resolved.


### Feature-resolved RustSec classification and URL remediation result — SHA `7c6545bd82e1c7d1e408448c4d86b05b7198a653`

The exact-head RustSec JSON after the URL update contains **10 unique advisory IDs** (not 11): RUSTSEC-2026-0592 is absent because all three affected lockfiles now resolve `url 2.5.9`. Per lockfile, the result is 10 findings for each client lockfile and 9 for each bridge lockfile.

The new `cargo tree --all-targets --edges all` artifacts show the following packages in the active default-feature graph:

| Package | Active graph evidence | Finding |
|---|---|---|
| `crypto-bigint 0.5.5` | Present in all five graphs | RUSTSEC-2026-0387 remains active at the package level |
| `libcrux-sha3 0.0.8` | Present in all five graphs | RUSTSEC-2026-0207 and RUSTSEC-2026-0208 are active |
| `libcrux-secrets 0.0.5` | Present in all five graphs | RUSTSEC-2026-0212 is active |
| `libsqlite3-sys 0.30.1` | Present in the three client graphs; absent from bridge-only graphs | RUSTSEC-2026-0459 is active in the client database path |
| `url 2.5.9` | Present in all three client graphs | The prior RUSTSEC-2026-0592 finding is patched |

The five Libcrux advisories for `libcrux-aesgcm`, `libcrux-chacha20poly1305` and `libcrux-kem` are lockfile-only optional-provider findings: those packages do not appear in any of the five feature-resolved graphs. They remain visible in the full RustSec inventory; this report does not suppress them.

The active Libcrux SHA3/secrets findings are not fixed by simply disabling the optional Libcrux provider: they are pulled by the current HPKE dependency path (`hpke-rs 0.6.1`). The published `openmls_rust_crypto 0.6.0` lockfile resolves `libcrux-sha3 0.0.10` and `libcrux-secrets 0.0.6`, both patched versions, but also still resolves `p256 0.13.2` / `crypto-bigint 0.5.5`. Moving to that provider requires the matching OpenMLS traits generation and the reviewed 0.8.3-to-0.9 storage transition; it is not a lockfile-only update. The OpenMLS 0.9 storage crate also pins rusqlite 0.37, so a SQLCipher-compatible fork/patch is a separate required part of the same migration.

OpenMLS 0.8.3's Welcome processing checks the Welcome ciphersuite against the local KeyPackage ciphersuite before HPKE GroupSecrets decryption. The application-level staged-group allowlist is defense in depth; it does not remove `crypto-bigint` from the build graph, so RUSTSEC-2026-0387 remains visible and requires explicit risk disposition or an upstream cryptographic dependency fix.

### Validation notes for SHA `7c6545bd82e1c7d1e408448c4d86b05b7198a653`

The URL lockfile update removed RUSTSEC-2026-0592 from the full audit JSON. The new Rust source changes did not yet pass validation: Native MLS and Rust format jobs detected the direct private `Welcome::ciphersuite()` call and formatting differences; Flutter Rust Bridge generation failed at `cargo expand` for the same compile error. The code has been corrected in the next prepared checkpoint to inspect `StagedWelcome.group_context()` instead. The Gradle preflight was not reached on this SHA because Flutter Rust Bridge code generation failed first.


### SQLCipher migration compatibility finding

Upstream `openmls_sqlite_storage 0.3.0` is confirmed to depend on `rusqlite 0.37` (not 0.42). The RustSec advisory's fixed range begins at `libsqlite3-sys 0.39.0`; therefore upgrading only from OpenMLS 0.8.3 to 0.9.0 and adopting the unmodified 0.3.0 storage crate would leave the vulnerable SQLite source in the active graph. A candidate remediation requires a reviewed storage-crate fork/patch that moves the provider to rusqlite 0.42.0 and unifies its SQLCipher features with the application's direct database connection. The fork must be tested against the upstream 0.3.0 migration set and the existing InOne JSON codec.

The existing `ADR-MLS-SQLCIPHER-ATOMICITY.md` explicitly keeps the exact dependency pins until a separate compatibility review. No such migration is started in this PR without owner approval.


### Exact-head validation results — SHA `8f369e5fd2dd44e7218d35dd5d9383caff0a3ae5`

The Native MLS workflow completed successfully with all five jobs green:
- exact-head source immutability check;
- canonical Engine B MLS regression tests;
- iOS Keychain native target build;
- OpenMLS attachment/session integration tests;
- persistent Flutter Rust bridge host tests.

The canonical client regression suite passed 29 unit tests, including the nested-`blob:` signed-URL regression and the X25519/P-256 Welcome policy tests. The attachment/session integration suite passed its unit and integration groups, and the persistent bridge host suite passed 14 tests. The iOS Keychain target compiled successfully.

The P0 workflow also passed the canonical client check/tests and Rust bridge check/tests, and produced the five feature-resolved dependency graphs. It remains failed for two independent gates:
1. the strict lockfile RustSec audit reports 10 unique advisory IDs after the URL fix (five active in the default dependency graphs, five from inactive optional Libcrux provider packages);
2. the general Rust-format job found one extra blank line before the new bridge security-policy test module. This formatting-only correction is included in this follow-up commit.

The Flutter mobile workflow has passed the committed-lockfile native bridge check, Flutter analysis, and the corrected Gradle plugin marker preflight. Its Flutter test step was still running at report time; the Android APK build had not yet started. The OpenMLS Flutter Rust Bridge workflow passed deterministic generation, Rust bridge Linux validation, and the Flutter code/session contract check; its Android build with native OpenMLS assets was running. Flutter iOS analysis passed and the unsigned simulator build was running.

The exact-SHA acceptance gate failed because the P0 workflow had not passed. No Stage 5 acceptance is claimed at this SHA.



### Upstream remediation research — 2026-11-26

The upstream dependency path is now better understood:

- OpenMLS **0.9.0 is a released stable version** (published 2026-08-25), not merely a release candidate. Its supporting crate train is `openmls_traits 0.6.0`, `openmls_rust_crypto 0.6.0`, `openmls_sqlite_storage 0.3.0`, and related 0.6.x crates. Release notes also document storage-format and API changes that require migration review. See https://book.openmls.tech/releases/0.9.0.html and https://blog.openmls.tech/posts/2026-08-25-0.9.0-release/.
- Upstream OpenMLS PR #2117 upgraded the Libcrux/HPKE provider line to `hpke-rs 0.7` and Libcrux 0.0.9-era crates. The OpenMLS maintainer subsequently confirmed that moving to OpenMLS 0.9.0 is sufficient for those Libcrux advisories and that the reported issues do not affect OpenMLS's own usage. See https://github.com/openmls/openmls/pull/2117 and https://github.com/openmls/openmls/issues/2126.
- This is **not** a safe lockfile-only update for InOne: the current canonical client remains on OpenMLS 0.8.x / traits 0.5.x, pins `openmls_sqlite_storage = 0.2.0`, and uses `rusqlite 0.32` with SQLCipher. OpenMLS 0.9 introduces the new supporting-crate generation and storage-format migration considerations. The existing application-level persistent MLS state must be migrated and round-trip tested before adopting it.
- The SQLite advisory requires particular care. RustSec states that `libsqlite3-sys >=0.39.0` bundles patched SQLite for the ordinary bundled-SQLite feature, but explicitly notes that `bundled-sqlcipher` in 0.39.0/0.39.1 still embeds SQLite 3.53.4 and remains affected. Therefore a superficial bump of `rusqlite`/ `libsqlite3-sys` to the nominal patched floor is **not evidence** that InOne's SQLCipher build is fixed. See https://rustsec.org/advisories/RUSTSEC-2026-0459.
- The `crypto-bigint 0.5.x` finding is a separate RustCrypto P-256/P-384 dependency path. The compatible RustCrypto generation that uses `crypto-bigint 0.7.x` is `elliptic-curve 0.14` / `p256 0.14`, which is a breaking generation change from the current `p256 0.13` dependency line. See https://docs.rs/elliptic-curve/0.14.1/source/CHANGELOG.md and https://docs.rs/p256/0.14.0/source/CHANGELOG.md. It cannot be solved by adding a Cargo `[patch]` that swaps crypto-bigint major versions underneath elliptic-curve 0.13.
- Upstream OpenMLS's current development manifest has moved beyond the released 0.9.0 line and includes unreleased Git patches for HPKE/Libcrux components. That is not an acceptable Beta 1.0 production dependency without a separately pinned and reviewed upstream commit.

**Decision for this Stage 5 branch:** do not change the MLS provider, OpenMLS storage generation, SQLCipher engine, or persistent database format as an opportunistic RustSec cleanup. The next implementation task is a dedicated, separately validated MLS storage/crypto compatibility change: select a supported OpenMLS release line; resolve a SQLCipher source containing SQLite >=3.54.0 (not merely a `libsqlite3-sys` version number); migrate the OpenMLS storage adapter and format; move the P-256/P-384 HPKE dependencies to a compatible constant-time crypto-bigint 0.7 line or document a bounded, evidence-based exception; and run existing group persistence, restart, Welcome, encrypt/decrypt, attachment, and migration regressions on Android/iOS. Until then the RustSec job must remain a real failing acceptance gate rather than suppressing these advisories.

The upstream findings narrow the remediation path, but do not yet make the current InOne dependency graph safe or Stage 5 acceptable.
