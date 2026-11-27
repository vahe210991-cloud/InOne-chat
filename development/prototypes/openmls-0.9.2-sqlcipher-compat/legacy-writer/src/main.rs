use std::{path::Path, sync::Arc};

use openmls::prelude::*;
use openmls::prelude::tls_codec::{Deserialize, Serialize};
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

fn in_memory_provider() -> Result<FixtureProvider, Box<dyn std::error::Error>> {
    let mut connection = Connection::open(":memory:")?;
    connection.pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))?;
    connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })?;
    {
        let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
        migrations.run_migrations()?;
    }

    let connection = Arc::new(connection);
    Ok(FixtureProvider {
        crypto: Arc::new(RustCrypto::default()),
        storage: SqliteStorageProvider::new(connection),
    })
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

    let mut group = MlsGroup::new_with_group_id(
        &provider,
        &signer,
        &config,
        GroupId::from_slice(GROUP_ID),
        credential,
    )?;

    // Persist a real multi-member, multi-epoch legacy state instead of a minimal
    // epoch-0 fixture. The transient member is added and then removed, leaving
    // Alice and Bob in epoch 3 with historical epoch secrets in the database.
    let bob_provider = in_memory_provider()?;
    let bob_signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())?;
    bob_signer.store(bob_provider.storage())?;
    let bob_credential = CredentialWithKey {
        credential: BasicCredential::new(b"inone-legacy-fixture-bob".to_vec()).into(),
        signature_key: bob_signer.to_public_vec().into(),
    };
    let bob_key_package = KeyPackage::builder().build(
        CIPHERSUITE,
        &bob_provider,
        &bob_signer,
        bob_credential,
    )?;
    let (_bob_add_commit, bob_welcome, _) =
        group.add_members(&provider, &signer, &[bob_key_package.key_package().clone()])?;
    group.merge_pending_commit(&provider)?;

    let bob_welcome_wire = bob_welcome.tls_serialize_detached()?;
    let bob_welcome = match MlsMessageIn::tls_deserialize_exact(&bob_welcome_wire)?.extract() {
        MlsMessageBodyIn::Welcome(welcome) => welcome,
        _ => return Err("expected Bob Welcome in legacy fixture".into()),
    };
    let bob_join_config = MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .max_past_epochs(16)
        .build();
    let bob_staged = StagedWelcome::new_from_welcome(
        &bob_provider,
        &bob_join_config,
        bob_welcome,
        None,
    )?;
    let mut bob_group = bob_staged.into_group(&bob_provider)?;

    // Preserve an authentic epoch-1 application message. The candidate reader
    // must decrypt it after loading the epoch-3 group and its retained past secrets.
    let bob_epoch1_message = bob_group
        .create_message(
            &bob_provider,
            &bob_signer,
            b"legacy-openmls-081-epoch-1-message",
        )?
        .tls_serialize_detached()?;
    std::fs::write(path.with_extension("epoch1.msg"), bob_epoch1_message)?;

    let transient_signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())?;
    transient_signer.store(bob_provider.storage())?;
    let transient_credential = CredentialWithKey {
        credential: BasicCredential::new(b"inone-legacy-fixture-transient".to_vec()).into(),
        signature_key: transient_signer.to_public_vec().into(),
    };
    let transient_key_package = KeyPackage::builder().build(
        CIPHERSUITE,
        &bob_provider,
        &transient_signer,
        transient_credential,
    )?;
    group.add_members(
        &provider,
        &signer,
        &[transient_key_package.key_package().clone()],
    )?;
    group.merge_pending_commit(&provider)?;

    let transient_index = group
        .members()
        .find(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-transient"
        })
        .map(|member| member.index)
        .ok_or("transient fixture member was not added")?;
    group.remove_members(&provider, &signer, &[transient_index])?;
    group.merge_pending_commit(&provider)?;

    assert_eq!(group.epoch().as_u64(), 3);
    assert_eq!(group.members().count(), 2);

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
