use std::{path::Path, sync::Arc};

use openmls::prelude::*;
use openmls_libcrux_crypto::CryptoProvider as LibcruxCrypto;
use openmls_traits::crypto::OpenMlsCrypto;
use openmls_sqlite_storage::{Codec, Connection, SqliteStorageProvider};
use serde::{de::DeserializeOwned, Serialize};

const GROUP_ID: &[u8] = b"inone-openmls-081-compat-fixture";
const TEST_KEY_HEX: &str = "4242424242424242424242424242424242424242424242424242424242424242";
const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

#[derive(Default)]
struct JsonCodec;

impl Codec for JsonCodec {
    type Error = serde_json::Error;

    fn to_vec<T: Serialize>(value: &T) -> Result<Vec<u8>, Self::Error> {
        serde_json::to_vec(value)
    }

    fn from_slice<T: DeserializeOwned>(slice: &[u8]) -> Result<T, Self::Error> {
        serde_json::from_slice(slice)
    }
}

struct CandidateProvider {
    crypto: LibcruxCrypto,
    storage: SqliteStorageProvider<JsonCodec, Arc<Connection>>,
}

impl OpenMlsProvider for CandidateProvider {
    type CryptoProvider = LibcruxCrypto;
    type RandProvider = LibcruxCrypto;
    type StorageProvider = SqliteStorageProvider<JsonCodec, Arc<Connection>>;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }

    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

fn open_sqlcipher(path: &Path, key_hex: &str) -> Result<Connection, Box<dyn std::error::Error>> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "key", format!("x'{key_hex}'"))?;
    connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))?;
    Ok(connection)
}

fn load_group(path: &Path) -> Result<(MlsGroup, String), Box<dyn std::error::Error>> {
    let mut connection = open_sqlcipher(path, TEST_KEY_HEX)?;
    let cipher_version: String = connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    if cipher_version.trim().is_empty() {
        return Err("candidate connection is not using SQLCipher".into());
    }

    {
        let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
        migrations.run_migrations()?;
    }

    let connection = Arc::new(connection);
    let crypto = LibcruxCrypto::new()?;
    let provider = CandidateProvider {
        crypto,
        storage: SqliteStorageProvider::new(Arc::clone(&connection)),
    };

    provider.crypto().supports(CIPHERSUITE)?;
    let group_id = GroupId::from_slice(GROUP_ID);
    let group = MlsGroup::load(provider.storage(), &group_id)?
        .ok_or("legacy MLS group was not found in the SQLCipher database")?;

    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(format!("SQLite integrity_check failed: {integrity}").into());
    }

    Ok((group, cipher_version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_and_reloads_existing_openmls_081_group_with_sqlcipher_and_libcrux() {
        let path = std::env::var("INONE_COMPAT_DB").expect("INONE_COMPAT_DB must point to the generated fixture");
        let path = Path::new(&path);

        let raw = std::fs::read(path).expect("read encrypted fixture");
        assert!(!raw.windows(GROUP_ID.len()).any(|window| window == GROUP_ID),
            "group identifier must not appear in plaintext in the SQLCipher file");

        let (group, cipher_version) = load_group(path).expect("load legacy group with candidate");
        assert_eq!(group.group_id().as_slice(), GROUP_ID);
        assert_eq!(group.epoch().as_u64(), 0);
        assert_eq!(group.members().count(), 1);
        assert!(!cipher_version.trim().is_empty());
        drop(group);

        // A second independent open proves that migration/readback survives process-style reopen.
        let (reopened, reopened_cipher) = load_group(path).expect("reopen and reload legacy group");
        assert_eq!(reopened.group_id().as_slice(), GROUP_ID);
        assert_eq!(reopened.epoch().as_u64(), 0);
        assert_eq!(reopened.members().count(), 1);
        assert_eq!(reopened_cipher, cipher_version);
    }

    #[test]
    fn rejects_a_wrong_sqlcipher_key() {
        let path = std::env::var("INONE_COMPAT_DB").expect("INONE_COMPAT_DB must point to the generated fixture");
        let connection = Connection::open(Path::new(&path)).expect("open database handle");
        connection.pragma_update(None, "key", format!("x'{}'", "99".repeat(32))).unwrap();
        assert!(connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0)).is_err());
    }
}
