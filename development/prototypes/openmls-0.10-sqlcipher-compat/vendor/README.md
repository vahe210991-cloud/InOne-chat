# Isolated patched SQLCipher dependency experiment

This directory contains narrowly scoped source snapshots used only by the OpenMLS compatibility prototype.

- `openmls_sqlite_storage`: copied from `openmls/openmls` tag `openmls-v0.10.0-rc.1`. Its manifest is changed only to use `rusqlite 0.42.0`, bundled SQLCipher with vendored OpenSSL, standalone `openmls_traits 0.7.0-rc.1`, and an explicit MSRV.
- `refinery-core`: copied from `rust-db/refinery` commit `1d31d289a6570fc4a19490d4de4c3c5dd4acb5ec`. Its manifest is changed only to allow `rusqlite 0.42.x` and declare the standalone MSRV.

The goal is to test the unchanged OpenMLS storage and migration logic against the patched SQLCipher line (`libsqlite3-sys 0.40.0` / `sqlcipher-src 420.0.0`) without changing production dependencies.

Upstream source licenses are retained in each vendored crate directory. These forks are experimental and must not be used by production code unless their source diffs, cross-platform builds, migration tests, and RustSec results are independently reviewed.
