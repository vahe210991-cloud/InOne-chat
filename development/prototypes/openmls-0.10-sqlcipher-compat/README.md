# OpenMLS 0.10 SQLCipher compatibility prototype

**Status:** isolated prototype, not production code.  
**Baseline:** InOne's current OpenMLS 0.8.1 + JSON codec + SQLCipher database.  
**Candidate:** OpenMLS 0.10.0-rc.1 + Libcrux provider + SQLite storage 0.4.0-rc.1 + rusqlite 0.41.1.

## Purpose

This prototype tests whether the candidate can open a database created by the exact 0.8.1-era storage stack used by InOne, without changing the production app or its database format.

The legacy fixture is produced by a separate Cargo package using:
- openmls 0.8.1
- openmls_sqlite_storage 0.2.0
- rusqlite 0.32.1 with bundled SQLCipher and vendored OpenSSL
- the same serde_json storage codec used by the InOne client

The candidate reader uses:
- openmls 0.10.0-rc.1 with `0-8-1-storage-format`
- openmls_libcrux_crypto 0.5.0-rc.1
- openmls_sqlite_storage 0.4.0-rc.1
- rusqlite 0.41.1 with bundled SQLCipher and vendored OpenSSL
- crypto-bigint 0.7.11, resolved beyond RUSTSEC-2026-0387's fixed boundary

## What CI must prove

1. Create an encrypted SQLCipher database using the legacy stack and a test-only key.
2. Open that exact database with the candidate SQLCipher stack.
3. Run the candidate storage provider's migrations against the fixture copy.
4. Load the existing MLS group using `MlsGroup::load`.
5. Verify group ID, epoch, member count, SQLCipher cipher version and SQLite integrity.
6. Close and reopen the database, then load the same group again.
7. Reject an incorrect SQLCipher key.
8. Run RustSec against the candidate lockfile and print the resolved versions of crypto-bigint and libsqlite3-sys.

The fixture key and group identity are deterministic test data only. They are not copied from, derived from, or suitable for any production account or database.

## Safety boundary

- No production Cargo manifest, Cargo.lock, database, key store, migration or Flutter code is modified by this prototype.
- Never point this harness at a user database or a production SQLCipher key.
- Do not merge the prototype into the runtime until the full compatibility matrix passes on Linux, Android and iOS, including pending commits, Welcome join, message encryption/decryption, restart/reopen, migration rollback and key rotation/revocation.
- OpenMLS 0.10.0-rc.1 is a release candidate. Passing this prototype is evidence for further review, not approval to ship the prerelease dependency.

Run locally with `scripts/run.sh`; CI runs the same fixture-generation and read-back sequence.
