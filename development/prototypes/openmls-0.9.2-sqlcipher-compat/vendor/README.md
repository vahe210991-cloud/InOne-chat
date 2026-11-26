# Stable OpenMLS 0.9.2 SQLCipher compatibility prototype

This isolated prototype tests a production-eligible stable OpenMLS train against an OpenMLS 0.8.1 SQLCipher database.

- `openmls_sqlite_storage`: upstream `openmls/openmls` tag `v0.9.2`; package version remains 0.3.0. The manifest is patched to use `rusqlite 0.42.0` with bundled SQLCipher and `refinery 0.10.1`, with standalone MSRV and `openmls_traits 0.6.0`.
- `openmls_basic_credential`: upstream source snapshot from `openmls-v0.10.0-rc.1`, adapted to the stable `openmls_traits 0.6.0` API and package version 0.6.0. It updates ECDSA/Ed25519 key-generation dependencies to the versions used by the candidate train.
- `openmls_rust_crypto`: upstream source snapshot from `openmls-v0.10.0-rc.1`, adapted to stable `openmls_traits 0.6.0` and `openmls_memory_storage 0.6.0`, retaining the stable package version 0.6.0. This updates the optional RustCrypto provider and its HPKE backend to the patched p256/p384 0.14 dependency line. The provider is included in the lockfile even though the runtime test selects Libcrux, so it must also be clean for RustSec.
- `openmls_libcrux_crypto`: upstream source snapshot from `openmls-v0.10.0-rc.1`, adapted to stable `openmls_traits 0.6.0` and `openmls_memory_storage 0.6.0`, retaining the stable package version 0.4.0. This updates the optional Libcrux provider's HPKE backend and Libcrux crates to patched versions. The source and manifest changes are isolated to this prototype.
- `refinery-core`: source snapshot from `rust-db/refinery` commit `1d31d289a6570fc4a19490d4de4c3c5dd4acb5ec`; the manifest allows `rusqlite 0.42.x`.

The purpose is to test stable OpenMLS 0.9.2, OpenMLS 0.8.1 storage-format compatibility, and patched SQLCipher 4.20.0 without changing production dependencies. This is experimental vendor code. Before production adoption, review the source diffs and licenses and run Android, iOS, Windows, Linux, database migration, and MLS message interoperability tests.
