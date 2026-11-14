# Stage 4 source-boundary addendum

**Date/time:** 2026-11-14 17:03:39 Europe/Tallinn (UTC+03:00)  
**Related audit:** [2026-11-14-1701-stage4-flutter-mls-integration-audit.md](2026-11-14-1701-stage4-flutter-mls-integration-audit.md)

## Additional source-of-truth check

The Stage 4 mobile Rust crate at `mobile/rust/Cargo.toml` points to:

```toml
mls-client = { path = "../../inone-engine-poc-0.6.0/mobile-mls/mls-client" }
```

It does **not** point to the separate canonical engine tree at `inone-development-archive-0.6.0/engine/mobile-mls/mls-client`.

The two crates are not byte-identical and must not be treated as interchangeable. Observed source blob/size pairs:

| Branch | POC client `src/lib.rs` | Canonical engine client `src/lib.rs` |
|---|---|---|
| Stage 4 PR #45 head `016ba750...` | `e156e52d...`, 149,864 chars | `3bdd7e36...`, 110,512 chars |
| Current Flutter head `eda47ce...` | `bbcfb53f...`, 35,379 chars | `3bc3c5f0...`, 110,035 chars |

Stage 4's integration workflow sets `INONE_ENGINE_DIR` to the canonical engine for tests, while the mobile Rust crate links the POC-path client library. This may be an intentional separation (mobile client library versus server engine), but it is a source-ownership boundary that must be explicitly reconciled before porting. Do not copy the POC server into production or silently replace the canonical engine crate.

## Corrected execution status

The next step “obtain a complete private-repository working copy” is **BLOCKED**, not in progress. The available connector does not provide a complete clone or a Rust/Flutter build runner. No source implementation was attempted through partial GitHub Contents API writes because the six requested items require coordinated cross-language and native-platform changes.

No tests/builds/device runs were performed.
