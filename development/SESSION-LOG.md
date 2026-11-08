# InOne development session log

This log is a durable GitHub record. Add newest entries at the top. Keep each entry factual and link commits, PRs, workflow runs, and test evidence.

## 2026-11-08 — Owner's final P0 snapshot bundle; exact-byte retention automation

- Owner supplied `InOne-P0-snapshot-2026-11-08.bundle` and explicitly instructed: "Я отправляю файл в последний раз. Больше этот файл не буду отправлять." This is binding: future sessions must not request another upload.
- Verified uploaded file: 2,476,944 bytes; SHA-256 `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`; `git bundle verify` PASS; complete history; HEAD `16eab726106ae04b4979af2a1646c2052233b87c`.
- Retrieved Actions artifact #2 (run `42480781656`, artifact `13617261673`) and extracted the bundle. Its SHA-256 matched the owner upload exactly.
- Added [development/ARTIFACT-RETENTION.md](ARTIFACT-RETENTION.md), updated [development/WORKING-RULES.md](WORKING-RULES.md), development entrypoint, P0 snapshot manifest, and [SOURCE-OF-TRUTH.md](../docs/continuity/SOURCE-OF-TRUTH.md) with the no-resend instruction and exact provenance.
- Updated `.github/workflows/export-p0-snapshot.yml` to download the original run #2 artifact, verify the expected SHA-256 and Git bundle integrity, then store the exact original bytes on dedicated branch `artifacts/p0-bundles`. Newly generated snapshots are retained separately by source commit.
- Important verification distinction: first retention run [42496692185](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42496692185) successfully archived a newly generated snapshot bundle, but its SHA differed because it was generated from a later documentation commit. It was not the exact owner-supplied file. Workflow was corrected to archive the exact run #2 artifact bytes and check the owner's SHA.
- Exact permanent target: `artifacts/p0-bundles:bundles/owner-upload-2026-11-08/InOne-P0-snapshot-2026-11-08.bundle`; pointer `bundles/OWNER-SUPPLIED-ORIGINAL.txt`.
- Final exact-byte archive workflow run after the latest docs commit must be checked. Do not mark permanent retention complete until the branch path, SHA-256, Git blob identity, and `git bundle verify` are independently verified.
- No product source changes; no merge to `main`; PR #25 and P0 acceptance state remain unchanged.

## 2026-11-08 — GitHub P0 source recovery verified; acceptance still open

- Rechecked repository refs and found published branch `recovery/p0-wave3-applied`, exact HEAD `7ebdeac8b322d7a1fe0b26add039f48b5f9f776f`; draft PR [#22](https://github.com/vahe210991-cloud/InOne-chat/pull/22) is open and unmerged.
- Located the P0 workflow source under `inone-development-archive-0.6.0/engine/`; the repository also has a separate `inone-engine-poc-0.6.0/` tree, which must not be assumed identical.
- Exact-head Actions push run [42465804591](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465804591) and PR run [42465808297](https://github.com/vahe210991-cloud/InOne-chat/actions/runs/42465808297): Node 369/369 PASS; room regression 2/2 PASS; PostgreSQL 43/43 PASS; OpenMLS client tests PASS (all test binaries); Rust bridge 3/3 PASS.
- Overall workflow remains FAIL because `cargo fmt -- --check` reports formatting-only diffs in 12 Rust files. Do not call this green; preserve source baseline and make formatting a separate commit after hash audit.
- Source-integrity acceptance remains open: complete original bundle 240-file blob-hash audit and verification of six substantive changed files plus five added P0 test files are still required.
- Added `development/recovered-source/P0-GITHUB-RECOVERY-STATUS-2026-11-08.md` with exact refs, test evidence, blockers and next actions.
- Original bundle SHA-256 `a226e578a732e5da886e3ec4bfb007102154405a95809c80fb28a2833493522f` is preserved as provenance, but the original binary and original Git ancestry are not yet stored in GitHub main.
- No merge; no changes to `main`; P0 remains the sole active priority.

