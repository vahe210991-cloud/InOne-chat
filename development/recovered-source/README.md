# Recovered source artifacts

This directory contains source-derived recovery references that are committed to GitHub. These are not a replacement for the full Git bundle.

## Files

- [ARCHITECTURE-MAP-2026-11-06.md](ARCHITECTURE-MAP-2026-11-06.md) — preserved architecture map supplied inside the owner-provided ZIP. Text is kept as supplied; its historical claims must be checked against current code before relying on them.
- [BUNDLE-VERIFICATION.txt](BUNDLE-VERIFICATION.txt) — preserved bundle verification report with SHA-256, refs, commit IDs, and completeness statement.
- [../BASELINE-2026-11-08.md](../BASELINE-2026-11-08.md) — current verified recovery baseline and GitHub PR references.

## Original binary archive status

The original `inone-engine-p0-wave3.bundle` is 1,052,468 bytes and has SHA-256:

`a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f`

Its complete five-commit history was verified locally from the owner-provided upload. **The original binary bundle itself is not yet committed to this GitHub repository.** The available GitHub connector supports UTF-8 file operations but no binary upload / Git transport / Git LFS upload action. Do not misrepresent the patch in PR #18 as the original bundle. Preserve the original bundle in an approved durable artifact store or use a real authenticated Git transport when available, then verify the exact checksum after retrieval.

## P0 source import path

PR [#18](https://github.com/vahe210991-cloud/InOne-chat/pull/18) stores a compressed patch and validation workflow. The patch is derived from the bundle's base-to-HEAD delta, not the full bundle history. The initial CI run failed because the archived GitHub base tree lacked `client-reference/biometric-client.mjs`, although the file exists in the bundle base commit. The exact file was restored to the PR branch from bundle commit `ea3b49ae9cdf1670a1b7499d4b5e608ee22fe1e9`; its Git blob SHA is `b03e72fe33c79e6b261d980bc86459babf03b388`.

Do not declare P0 validation complete until a fresh run on the updated branch completes Node, PostgreSQL, and Rust jobs. The first run is documented in [CI-RESULT-42453233555.md](CI-RESULT-42453233555.md).
