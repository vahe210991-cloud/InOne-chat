# Stable OpenMLS 0.9.2 SQLCipher compatibility prototype

This prototype is intentionally isolated from the production MLS client.

## Compatibility contract

- Legacy writer: OpenMLS 0.8.1 with `openmls_sqlite_storage 0.2.0`.
- Candidate reader: stable OpenMLS 0.9.2 with `0-8-1-storage-format`.
- Legacy database: SQLCipher encrypted, with a persisted MLS group and private signing key.
- Candidate SQLCipher: SQLCipher 4.20.0 / SQLite 3.54.1 via `rusqlite 0.42.0` and `libsqlite3-sys 0.40.0`.
- Candidate storage and credential source snapshots are documented in `vendor/README.md`.

The workflow is a prototype gate only. It does not change production dependencies or assert that all historic device databases are migrated. Production adoption requires the full mobile platform matrix and MLS interoperability tests.
