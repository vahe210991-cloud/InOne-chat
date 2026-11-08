# InOne P0 snapshot manifest — 2026-11-08

This branch preserves the published P0 reimplementation state without merging it into main.

- Snapshot branch: `snapshot/p0-and-groups-2026-11-08`
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

## Safety

- No merge to `main` was performed.
- Keep PR #25 draft until all P0 acceptance criteria pass on one exact head SHA.
- The group collaboration requirements are recorded separately and are not implemented by this snapshot.
- A Git bundle export workflow is included on this snapshot branch to produce a downloadable, self-contained repository bundle artifact.
