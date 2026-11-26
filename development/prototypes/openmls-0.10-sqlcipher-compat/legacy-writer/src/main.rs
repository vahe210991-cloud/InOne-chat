use std::{path::Path, sync::Arc};

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::RustCrypto;
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

struct FixtureProvider {
    crypto: Arc<RustCrypto>,
    storage: SqliteStorageProvider<JsonCodec, Arc<Connection>>,
}

impl OpenMlsProvider for FixtureProvider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
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

fn open_sqlcipher(path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))?;
    connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })?;
    Ok(connection)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: fixture-writer <database-path>")?;
    let path = Path::new(&path);
    if path.exists() {
        std::fs::remove_file(path)?;
    }

    let mut connection = open_sqlcipher(path)?;
    {
        let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
        migrations.run_migrations()?;
    }

    let connection = Arc::new(connection);
    let crypto = Arc::new(RustCrypto::default());
    let provider = FixtureProvider {
        crypto,
        storage: SqliteStorageProvider::new(Arc::clone(&connection)),
    };

    let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())?;
    signer.store(provider.storage())?;
    std::fs::write(path.with_extension("signer.pub"), signer.to_public_vec())?;
    let credential = CredentialWithKey {
        credential: BasicCredential::new(b"inone-legacy-fixture-member".to_vec()).into(),
        signature_key: signer.to_public_vec().into(),
    };
    let config = MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .max_past_epochs(16)
        .build();

    let group = MlsGroup::new_with_group_id(
        &provider,
        &signer,
        &config,
        GroupId::from_slice(GROUP_ID),
        credential,
    )?;

    assert_eq!(group.epoch().as_u64(), 0);
    assert_eq!(group.members().count(), 1);

    let cipher_version: String =
        connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    assert!(
        !cipher_version.trim().is_empty(),
        "fixture must be SQLCipher-encrypted"
    );

    println!("fixture_created=true");
    println!("fixture_epoch={}", group.epoch().as_u64());
    println!("fixture_members={}", group.members().count());
    println!("cipher_version={cipher_version}");
    Ok(())
}
