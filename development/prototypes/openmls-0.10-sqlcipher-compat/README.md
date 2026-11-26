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
8. Upload the generated candidate lockfile; the repository's existing Stage 5 RustSec workflow audits it once committed, alongside the other tracked lockfiles.

The fixture key and group identity are deterministic test data only. They are not copied from, derived from, or suitable for any production account or database.

## Safety boundary

- No production Cargo manifest, Cargo.lock, database, key store, migration or Flutter code is modified by this prototype.
- Never point this harness at a user database or a production SQLCipher key.
- Do not merge the prototype into the runtime until the full compatibility matrix passes on Linux, Android and iOS, including pending commits, Welcome join, message encryption/decryption, restart/reopen, migration rollback and key rotation/revocation.
- OpenMLS 0.10.0-rc.1 is a release candidate. Passing this prototype is evidence for further review, not approval to ship the prerelease dependency.

Run locally with Rust 1.94.0, then execute `scripts/run.sh`; CI runs the same fixture-generation and read-back sequence. The generated candidate lockfile is uploaded as evidence and is evaluated by the repository's existing Stage 5 RustSec gate once committed.


## Initial CI result — 2026-11-26

Prototype workflow run `45760553977` passed. It created a SQLCipher 4.5.7 fixture with OpenMLS 0.8.1 and then, with OpenMLS 0.10.0-rc.1, Libcrux and rusqlite 0.41.1:
- loaded the existing group (epoch 0, one member);
- passed SQLite integrity checking;
- reopened and loaded the same group a second time;
- rejected an incorrect SQLCipher key.

The generated candidate lockfile is committed in this prototype directory. It resolves `crypto-bigint 0.7.11`, `libcrux-aead/libcrux-kem/libcrux-chacha20poly1305 0.0.11`, `libcrux-secrets 0.0.8`, `libcrux-sha3 0.0.12`, and `libsqlite3-sys 0.39.1`. The repository's RustSec gate must still audit this committed lockfile; no finding is considered resolved until that check passes.

This remains a prerelease compatibility experiment. It is not a production dependency update or a merge approval.


## RustSec audit integration

The Stage 5 P0 workflow now discovers every tracked `Cargo.lock` in the checked-out PR tree (rather than auditing only a hard-coded list). This includes this prototype's candidate lockfile and records its default-feature dependency graph. Existing Stage 5 lockfiles are still audited independently and remain blocking until their dependency remediation is complete.

## Extended signing-key compatibility test — 2026-11-26

The next isolated test extends the read-only baseline. The legacy writer exports only the signer's public key to a sidecar fixture file; the private signing key remains in the encrypted OpenMLS storage. The candidate reader must:

1. Read the legacy signing key from the SQLCipher-backed storage using the candidate OpenMLS API.
2. Create a new application message with the candidate Libcrux provider and that legacy private key.
3. Close and reopen the database, read the same signer again, and create a second message.

This is a compatibility test only. The current candidate lockfile has a RustSec finding in the bundled SQLCipher source (sqlcipher-src 419.0.6, RUSTSEC-2026-0502 / CVE-2026-119375). It must be remediated before any production consideration. The newer libsqlite3-sys 0.40.0 line uses sqlcipher-src 420.0.0, but the current OpenMLS 0.10.0-rc.1 SQLite storage dependency resolves rusqlite 0.41.1; upgrading that dependency chain needs a separately validated compatibility change. The test must not be described as security-clean until the candidate audit passes.