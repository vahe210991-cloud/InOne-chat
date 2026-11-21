# Patch compatibility audit — 2026-11-08

## Purpose

Preserve readable Library artifacts and determine whether the latest P0 patch stack can safely be applied to the source currently present in GitHub. This is a compatibility check only; it is not source import or P0 acceptance.

## Artifacts preserved on this branch

The following files were copied verbatim from the readable Library text representation into `recovery/library-artifacts/`:

- `INONE-PATCH-016-rust-idempotent-key-package-claim-journal.patch`
- `INONE-PATCH-017-idempotent-invite-retry.patch`
- `INONE-PATCH-018-message-idempotency-fingerprint.patch`
- `INONE-PATCH-019-outbound-ack-reconciliation.patch`
- `INONE-PATCH-020-outbox-restart-reconciliation.patch`
- `P0-ACTUAL-STATE-2026-11-08.md`
- `P0-CTO-ACCEPTANCE.md`
- `MLS-FLUTTER-BRIDGE.md`
- `BETA-1.0-SCOPE.md`
- `InOne-screen-design-spec-v0.8.md`

These are reference artifacts, not an imported source tree. The five patches and five documents are stored in this recovery branch only; `main` is unchanged by these artifact copies.

## GitHub source examined

Current `main` at the time of this audit: `5dc7238b3d0655befdead78b2020159524bced1c`.

The archived engine contains:
- `inone-development-archive-0.6.0/engine/mobile-mls/mls-client/src/lib.rs`
  - blob SHA: `bbcfb53fa993ab1792735b6cf2bab13f4cfa0580`
- `inone-development-archive-0.6.0/engine/src/server.js`
  - blob SHA: `9d466284fe69059dc31444b7b45fb624025a07b9`

The current archived source is not the same blob baseline recorded in the latest patches. For example Patch 016 records the Rust file preimage as `e5e1ee0`, not the current GitHub blob prefix `bbcfb53`.

## Compatibility result

A read-only exact-context check was run against the source files fetched from GitHub. It did not modify any file.

- Patch 016: Rust `lib.rs` hunks do not match the archived GitHub source.
- Patch 017: its server hunk does not match the archived `server.js`; it also targets Rust/test files from a different source layout.
- Patch 018: its server hunk does not match the archived `server.js`; it also targets store, schema, migration, and test files not established as the same source snapshot.
- Patch 019: its Rust `lib.rs` hunk does not match the archived GitHub source.
- Patch 020: targets `mobile-mls/mls-client/tests/membership_outbox.rs`, which is not present in the archived GitHub tree inspected here.

**Conclusion:** do not apply Patches 016–020 to the archived 0.6.0 tree. They belong to a later/different source baseline. Their preservation on this branch is useful for recovery, but does not make them applicable.

## What remains blocked

- The P0 bundles and Flutter Beta 1.0 ZIP are present in Library, but the Files service denies raw-byte materialization with `This Project file does not have an authorized raw-byte materialization path.`
- The backend MLS session patch is likewise unavailable as readable text.
- Therefore the exact bundle heads, original Git ancestry, full patch stack, and Flutter source cannot yet be imported or compared.
- No current P0 source was published, no P0 code was changed, and no current P0 CI was run.

## Next safe step

Obtain the existing bundle/ZIP bytes through an authorized source-export path. Then verify bundle integrity, refs, ancestry, and hashes in an isolated repository; compare the exact P0 bundle against the preserved patch stack; publish the original branch with normal Git transport. Do not reconstruct a production source tree from the archived 0.6.0 source plus incompatible patches.
