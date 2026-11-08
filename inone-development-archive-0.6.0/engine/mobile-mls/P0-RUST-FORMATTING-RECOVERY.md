# P0 Rust formatting recovery record

Date: 2026-11-08

## Source lineage

- Published recovery baseline: `recovery/p0-wave3-applied` at `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`.
- Documentation-only update on that recovery branch: `f6c88eb6c98a0195ed12ef11f76e376f73e4f1c9`.
- P0 formatting recovery branch: `recovery/p0-wave3-rustfmt`.
- Recovery workflow correction: `c1ff05b7eddbe72e2800e9850288279e52106543`.
- Rust formatting commit produced by CI: `d5b0655f1826587afc5f41af99b6a653de56a7ef`.

## Formatting operation

The Rust source was formatted using Rust 1.91.1 / rustfmt. The workflow applies:

- `cargo fmt --manifest-path mls-client/Cargo.toml`
- `cargo fmt --manifest-path mls-bridge/Cargo.toml`

The workflow then runs the corresponding `--check` commands. The formatting changes are isolated in commit `d5b0655`; no functional source changes were intentionally made in that commit.

## Verification boundary

- A workflow run on the pre-format branch revision successfully completed the formatter step and pushed the formatting commit.
- That run's test suite was interrupted when the workflow was corrected; it is not an acceptance pass.
- A fresh full validation run on the exact post-format source revision is required.
- Do not describe P0 Wave 3 as fully green until Node 22, PostgreSQL 16, OpenMLS client, Rust bridge, formatting, and all required regression tests pass on one exact final SHA.

## Superseded-source warning

This branch is the published P0 Wave 3 recovery snapshot. It does not contain the later local `cto/p0-finalize-fixtures` source described in the recovery handoff (F1/F4 pending-commit and Welcome changes, P0.2 Commit metadata verification, P0.3 durable quarantine, KeyPackage claim/replay and authenticated-session reuse). The commits `99fd3e0`, `ead8e4c`, and `6fe6b67` are not resolvable in the GitHub repository. This formatting recovery does not close that source-recovery gap or the associated P0 acceptance gates.
