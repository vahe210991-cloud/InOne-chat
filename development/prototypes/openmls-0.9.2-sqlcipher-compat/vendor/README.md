# Stable OpenMLS 0.9.2 SQLCipher compatibility prototype

This isolated prototype tests a production-eligible stable OpenMLS train against an OpenMLS 0.8.1 SQLCipher database.

- `openmls_sqlite_storage`: upstream `openmls/openmls` tag `v0.9.2`; package version remains 0.3.0. The manifest is patched to use `rusqlite 0.42.0` with bundled SQLCipher and `refinery 0.10.1`, with standalone MSRV and `openmls_traits 0.6.0`.
- `openmls_basic_credential`: upstream source snapshot from `openmls-v0.10.0-rc.1`, adapted to the stable `openmls_traits 0.6.0` API and package version 0.6.0. It updates ECDSA/Ed25519 key-generation dependencies to the versions used by the candidate train.
- `openmls_rust_crypto`: upstream source snapshot from `openmls-v0.10.0-rc.1`, adapted to stable `openmls_traits 0.6.0` and `openmls_memory_storage 0.6.0`, retaining the stable package version 0.6.0. This updates the optional RustCrypto provider and its HPKE backend to the patched p256/p384 0.14 dependency line. The provider is included in the lockfile even though the runtime test selects Libcrux, so it must also be clean for RustSec.
- `openmls_libcrux_crypto`: upstream source snapshot from `openmls-v0.10.0-rc.1`, adapted to stable `openmls_traits 0.6.0` and `openmls_memory_storage 0.6.0`, retaining the stable package version 0.4.0. This updates the optional Libcrux provider's HPKE backend and Libcrux crates to patched versions. The source and manifest changes are isolated to this prototype.
- `refinery-core`: source snapshot from `rust-db/refinery` commit `1d31d289a6570fc4a19490d4de4c3c5dd4acb5ec`; the manifest allows `rusqlite 0.42.x`.

The purpose is to test stable OpenMLS 0.9.2, OpenMLS 0.8.1 storage-format compatibility, and patched SQLCipher 4.20.0 without changing production dependencies. This is experimental vendor code. Before production adoption, review the source diffs and licenses and run Android, iOS, Windows, Linux, database migration, and MLS message interoperability tests.

## Immutable upstream provenance

The tags below resolve to the following immutable commit SHAs (verified against upstream Git references on 2026-11-27):

| Vendored package | Upstream source | Immutable upstream commit |
|---|---|---|
| `openmls_sqlite_storage` | `openmls/openmls`, tag `v0.9.2` | `8a8f83b4b61fc45f28facec25e914992b3465de6` |
| `openmls_basic_credential` | `openmls/openmls`, tag `openmls-v0.10.0-rc.1` | `b792393d8a710632c42cce2a6462d99cac48363c` |
| `openmls_rust_crypto` | `openmls/openmls`, tag `openmls-v0.10.0-rc.1` | `b792393d8a710632c42cce2a6462d99cac48363c` |
| `openmls_libcrux_crypto` | `openmls/openmls`, tag `openmls-v0.10.0-rc.1` | `b792393d8a710632c42cce2a6462d99cac48363c` |
| `refinery-core` | `rust-db/refinery`, commit `1d31d289a6570fc4a19490d4de4c3c5dd4acb5ec` | `1d31d289a6570fc4a19490d4de4c3c5dd4acb5ec` |

## Local adaptation inventory

The vendored code is not an unmodified mirror. The currently identified adaptations are:

1. `openmls_sqlite_storage`: dependency integration for exact `rusqlite 0.42.0`, bundled SQLCipher, the `refinery 0.10.0` facade with patched `refinery-core 0.10.1`, and stable `openmls_traits 0.6.0`.
2. `openmls_basic_credential`: synchronous stable storage API adaptation, provider-backed `SignatureKeyPair::generate` and `ProviderSigner`, and backward-compatible serialization of private signing keys.
3. `openmls_rust_crypto`: stable `openmls_traits 0.6.0` / `openmls_memory_storage 0.6.0` integration and updated HPKE / ECDSA dependency train.
4. `openmls_libcrux_crypto`: stable trait integration and updated HPKE / Libcrux dependency train. This hardening branch wraps temporary Ed25519 and ML-DSA seed/randomness buffers in `Zeroizing` and adds a local drop guard that clears the generated ML-DSA signing-key buffer after deriving its public key or completing a signature. The Libcrux 0.0.12 API accepts ML-DSA key-generation and signing randomness by value, so copies internal to those upstream calls are not proven to be wiped by this adapter; this remains an upstream/API-level zeroization review item. Upstream Libcrux also explicitly states that it does not currently guarantee zeroization of secret values on the stack or heap, so this local hardening is best-effort and must not be represented as a complete memory-erasure guarantee (see the upstream [Libcrux security notes](https://github.com/cryspen/libcrux#side-channel-resistance-and-zeroization)).
5. `refinery-core`: the upstream 0.10.1 `rusqlite` range is narrowed to exact `=0.42.0` for this isolated candidate. This compatibility change must be verified by compilation before it is considered supported.

This is a reviewed adaptation inventory, not a claim that every vendored file has undergone a complete semantic diff. Before production use, compare every changed vendored file against its exact upstream commit, record any additional patch, and complete the license and RustSec review for both Cargo graphs.

## Persistence and migration contract

`SqliteStorageProvider` accepts a connection wrapper implementing `Borrow<Connection>`; callers can therefore pass a wrapper around a rusqlite transaction. The legacy writer now creates a multi-member, multi-epoch OpenMLS 0.8.1 fixture (Alice and Bob remain in epoch 3 after a transient member is added and removed) and preserves an authentic epoch-1 application message. The 0.9.2 reader is expected to decrypt that message after migration with both Libcrux and RustCrypto. Candidate tests also include an outer-transaction rollback scenario for a membership removal and an idempotent six-migration schema check. These tests are source-level coverage only until they are executed.

The storage provider does not create a transaction spanning a complete MLS epoch transition by itself. Callers must keep the group state writes and their related application journal / operation rows inside one transaction, following the existing Engine B transaction adapter pattern. Migration idempotence does not prove crash recovery during every migration statement; process-kill and reopen tests for the V2 table replacement and the V3-V6 schema additions remain required.

## File-level upstream comparison

A recursive Git tree / blob-SHA comparison was performed against the immutable upstream commits above on 2026-11-27. This records which source files are byte-identical and which are local adaptations; it is stronger than a tag-only provenance statement, but does not replace semantic review of the changed files.

| Package | Local files | Upstream files | Byte-identical | Local modifications |
|---|---:|---:|---:|---|
| `openmls_sqlite_storage` | 22 | 24 | 21 | `Cargo.toml` |
| `openmls_basic_credential` | 4 | 5 | 2 | `Cargo.toml`, `src/lib.rs` |
| `openmls_rust_crypto` | 8 | 7 | 6 | `Cargo.toml` |
| `openmls_libcrux_crypto` | 7 | 9 | 4 | `Cargo.toml`, `src/crypto.rs` |
| `refinery-core` | 13 | 17 | 11 | `Cargo.toml` |

Additional local-only files are the MIT license copies in the provider crates and the Refinery license file. Upstream-only files are test suites omitted from the vendored packages (`openmls_sqlite_storage/tests/proposals.rs`, `tests/vc_operation_tree.rs`, `basic_credential/tests/provider_signer.rs`, and Libcrux provider integration tests) plus optional Refinery drivers not used by this candidate (`mysql`, `mysql_async`, `postgres`, `tiberius`, and `tokio_postgres`).

The changed source files are intentionally limited to the stable storage/API adaptations and the Libcrux crypto implementation. Their behavior still requires compile-time and runtime validation on the candidate branch.
