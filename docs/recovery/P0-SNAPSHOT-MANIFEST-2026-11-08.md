# InOne P0 snapshot manifest — 2026-11-08

This branch preserves the published P0 reimplementation state without merging it into main.

- Snapshot branch: `snapshot/p0-and-groups-2026-11-08`
- Snapshot commit represented by the bundle: `16eab726106ae04b4979af2a1646c2052233b87c`
- P0 source branch at capture: `recovery/p0-reimplementation`
- Captured P0 commit: `6fba6601e53a03da9652d0f76982c0b5d1bf8d3a`
- Related draft PR: #25
- Group feature requirements: `docs/product/GROUPS-COLLABORATION-FEATURES.md`

## Validation state at capture

The latest completed run on P0 source branch was run #61 (`42479858473`):
- Backend Node suite: passed
- P0 room-list regression: passed
- PostgreSQL integration suite: passed
- OpenMLS client tests: failed in `welcome_recovery.rs` because the test expected a durable `RecoveryRequired` marker that was not present
- Rust bridge tests: skipped after OpenMLS failure

This snapshot is therefore a preserved development checkpoint, **not a green or accepted P0 release**.

## Source lineage warning

The canonical later local source branch `cto/p0-finalize-fixtures` and referenced commits were not present in published GitHub refs during recovery. The current code is a documented reimplementation on the published Wave3 baseline, not a byte-for-byte restoration of that missing source.

## Binary bundle provenance and owner instruction

The owner supplied `InOne-P0-snapshot-2026-11-08.bundle` on 2026-11-08 and explicitly stated this is the final upload and will not be sent again. This instruction is binding: future sessions must retrieve the bundle from GitHub and must not ask the owner to resend it.

- Bundle size: 2,476,944 bytes
- SHA-256: `e76fdd39e2e9698d7f32061e3fd4fb3dbc52ef981bb075c6c252a7cce11f391e`
- Bundle HEAD: `16eab726106ae04b4979af2a1646c2052233b87c`
- Git bundle verification: PASS; complete history
- Same exact bytes found in GitHub Actions artifact #2, run `42480781656`, artifact `13617261673`

Permanent storage and retrieval requirements are defined in [development/ARTIFACT-RETENTION.md](../../development/ARTIFACT-RETENTION.md). The Actions artifact expires and is not considered permanent storage. The durable repository archive branch must be checksum-verified before the bundle is marked retained.

## Safety

- No merge to `main` was performed.
- Keep PR #25 draft until all P0 acceptance criteria pass on one exact head SHA.
- The group collaboration requirements are recorded separately and are not implemented by this snapshot.
- A Git bundle export workflow is included on this snapshot branch. It must preserve the generated bundle in the dedicated `artifacts/p0-bundles` branch, in addition to any temporary Actions artifact.
