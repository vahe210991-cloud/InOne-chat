# Recovered source artifacts

This directory contains source-derived recovery references that are committed to GitHub. These are not a replacement for the full Git bundle.

## Files

- [ARCHITECTURE-MAP-2026-11-06.md](ARCHITECTURE-MAP-2026-11-06.md) — preserved architecture map supplied inside the owner-provided ZIP. Text is kept as supplied; its historical claims must be checked against current code before relying on them.
- [BUNDLE-VERIFICATION.txt](BUNDLE-VERIFICATION.txt) — preserved bundle verification report with SHA-256, refs, commit IDs, and completeness statement.
- [../BASELINE-2026-11-08.md](../BASELINE-2026-11-08.md) — current verified recovery baseline and GitHub PR references.

## Latest P0 GitHub recovery status

- [P0-GITHUB-RECOVERY-STATUS-2026-11-08.md](P0-GITHUB-RECOVERY-STATUS-2026-11-08.md) — published source branch/SHA, exact-head Actions evidence, remaining source-integrity and formatting gates.

## Original binary archive status

The owner-provided upload is `Bundle(1).zip` (1,061,251 bytes; outer ZIP SHA-256 `a7ccfc12ae810dc1788f1b737ef4d53e032cafaf35797412784073a2db57f5a0`). It contains `inone-engine-p0-wave3.bundle` (1,052,468 bytes; inner SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`), `BUNDLE-VERIFICATION.txt`, and `ARCHITECTURE-MAP.md`.

The inner Git bundle was verified locally with `git bundle verify`: it is complete and contains `refs/heads/engine/p0-wave3` at `a7f60b6fdc969941e4354a117e17d32bfc951fb9`, with five commits. Its declared base is `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`; that base has 240 tracked blobs. The outer ZIP and inner bundle are currently mounted in the active working container, but the original binary bundle is **not yet committed to this GitHub repository**.

Correction to the earlier tooling note: the GitHub connector does expose Git Data `create_blob` with `encoding=base64`, so GitHub's API can store binary blobs. The current blocker is transferring the mounted local bytes into that connector call: Code Mode cannot read the container filesystem, and the container has no network/DNS or configured Git credentials (`git ls-remote` failed with DNS resolution). Do not claim the bundle is in GitHub or treat PR #18's patch as the original bundle. Preserve both checksums and provenance until a supported file-to-GitHub upload route is available.

## P0 source import path

The published source branch now exists at `recovery/p0-wave3-applied`, exact checked HEAD `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`, via draft PR [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22). The exact-head CI runs are [42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and [42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297). Functional Node, room, PostgreSQL, OpenMLS and Rust bridge checks passed; the overall workflow is still red on rustfmt. The full source-integrity acceptance is still open.


PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) stores a compressed patch and validation workflow. The patch is derived from the bundle's base-to-HEAD delta, not the full bundle history. The initial CI run failed because the archived GitHub base tree lacked `client-reference/biometric-client.mjs`, although the file exists in the bundle base commit. The exact file was restored to the PR branch from bundle commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`; its Git blob SHA is `b03e72fe33c79e6b261d980bc86459babf03b388`.

Do not declare P0 validation complete until a fresh run on the updated branch completes Node, PostgreSQL, and Rust jobs. The first run is documented in [CI-RESULT-42453233555.md](CI-RESULT-42453233555.md).
