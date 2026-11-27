use std::{path::Path, sync::Arc};

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_libcrux_crypto::CryptoProvider as LibcruxCrypto;
use openmls_sqlite_storage::{Codec, Connection, SqliteStorageProvider};
use openmls_traits::{crypto::OpenMlsCrypto, random::OpenMlsRand};
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

struct CandidateProvider<C> {
    crypto: C,
    storage: SqliteStorageProvider<JsonCodec, Arc<Connection>>,
}

impl<C> OpenMlsProvider for CandidateProvider<C>
where
    C: OpenMlsCrypto + OpenMlsRand,
{
    type CryptoProvider = C;
    type RandProvider = C;
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

fn load_group<C>(
    path: &Path,
    crypto: C,
) -> Result<(MlsGroup, CandidateProvider<C>, String), Box<dyn std::error::Error>>
where
    C: OpenMlsCrypto + OpenMlsRand,
{
    let mut connection = Connection::open(path)?;
    connection.pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))?;
    connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })?;
    let cipher_version: String =
        connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    if !cipher_version.trim().starts_with("4.20.0") {
        return Err(format!(
            "candidate connection must use SQLCipher 4.20.0, found {cipher_version}"
        )
        .into());
    }

    {
        let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
        migrations.run_migrations()?;
    }

    let connection = Arc::new(connection);
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

    Ok((group, provider, cipher_version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_and_reloads_existing_openmls_081_group_with_sqlcipher_and_libcrux() {
        let path = std::env::var("INONE_COMPAT_DB")
            .expect("INONE_COMPAT_DB must point to the generated fixture");
        let path = Path::new(&path);

        let raw = std::fs::read(path).expect("read encrypted fixture");
        assert!(
            !raw.windows(GROUP_ID.len()).any(|window| window == GROUP_ID),
            "group identifier must not appear in plaintext in the SQLCipher file"
        );

        let public_key = std::fs::read(path.with_extension("signer.pub"))
            .expect("read legacy signer public-key sidecar");

        let (mut group, provider, cipher_version) = load_group(
            path,
            LibcruxCrypto::new().expect("initialize Libcrux provider"),
        )
        .expect("load legacy group with candidate");
        assert_eq!(group.group_id().as_slice(), GROUP_ID);
        assert_eq!(group.epoch().as_u64(), 0);
        assert_eq!(group.members().count(), 1);
        assert!(!cipher_version.trim().is_empty());

        // The private signing key remains inside SQLCipher storage. Read it with the
        // candidate OpenMLS version and prove Libcrux can sign a new application message.
        let key_pair = SignatureKeyPair::read(
            provider.storage(),
            &public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("read legacy signing key from candidate storage");
        let signer = key_pair.signer(provider.crypto());
        let signed_message = group
            .create_message(&provider, &signer, b"legacy-key-to-candidate-message")
            .expect("candidate Libcrux signs and encrypts with the legacy key");
        drop(signed_message);
        drop(signer);
        drop(group);

        // A second independent open proves both group state and signer persistence survive reopen.
        let (mut reopened, reopened_provider, reopened_cipher) = load_group(
            path,
            LibcruxCrypto::new().expect("initialize Libcrux provider"),
        )
        .expect("reopen and reload legacy group");
        assert_eq!(reopened.group_id().as_slice(), GROUP_ID);
        assert_eq!(reopened.epoch().as_u64(), 0);
        assert_eq!(reopened.members().count(), 1);
        assert_eq!(reopened_cipher, cipher_version);

        let reopened_key_pair = SignatureKeyPair::read(
            reopened_provider.storage(),
            &public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("re-read legacy signing key after reopen");
        let reopened_signer = reopened_key_pair.signer(reopened_provider.crypto());
        let second_message = reopened
            .create_message(
                &reopened_provider,
                &reopened_signer,
                b"reopened-legacy-key-to-candidate-message",
            )
            .expect("candidate Libcrux signs and encrypts after reopen");
        drop(second_message);
    }

    #[test]
    fn rustcrypto_provider_reads_legacy_state_and_signs_with_reloaded_key() {
        let path = std::env::var("INONE_COMPAT_DB")
            .expect("INONE_COMPAT_DB must point to the generated fixture");
        let path = Path::new(&path);
        let public_key = std::fs::read(path.with_extension("signer.pub"))
            .expect("read legacy signer public-key sidecar");

        let (mut group, provider, cipher_version) =
            load_group(path, openmls_rust_crypto::RustCrypto::default())
                .expect("load legacy group with RustCrypto provider");
        assert_eq!(group.group_id().as_slice(), GROUP_ID);
        assert_eq!(group.epoch().as_u64(), 0);
        assert_eq!(group.members().count(), 1);
        assert!(cipher_version.trim().starts_with("4.20.0"));

        let key_pair = SignatureKeyPair::read(
            provider.storage(),
            &public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("read legacy signing key through RustCrypto storage adapter");
        let signer = key_pair.signer(provider.crypto());
        let message = group
            .create_message(
                &provider,
                &signer,
                b"legacy-key-to-rustcrypto-candidate-message",
            )
            .expect("RustCrypto provider signs and encrypts with the legacy key");
        drop(message);
    }

    fn in_memory_provider() -> CandidateProvider<openmls_rust_crypto::RustCrypto> {
        let mut connection =
            Connection::open(":memory:").expect("open in-memory SQLCipher database");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("apply SQLCipher key");
        {
            let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
            migrations
                .run_migrations()
                .expect("migrate in-memory MLS storage");
        }
        let connection = Arc::new(connection);
        CandidateProvider {
            crypto: openmls_rust_crypto::RustCrypto::default(),
            storage: SqliteStorageProvider::new(connection),
        }
    }

    #[test]
    fn stable_candidate_supports_welcome_epoch_and_bidirectional_application_messages() {
        let alice_provider = in_memory_provider();
        let bob_provider = in_memory_provider();

        let alice_signer =
            SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).expect("create Alice signer");
        alice_signer
            .store(alice_provider.storage())
            .expect("persist Alice signer");
        let alice_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-candidate-alice".to_vec()).into(),
            signature_key: alice_signer.to_public_vec().into(),
        };
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(16)
            .build();
        let mut alice_group =
            MlsGroup::new(&alice_provider, &alice_signer, &config, alice_credential)
                .expect("create Alice group");

        let bob_signer =
            SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).expect("create Bob signer");
        bob_signer
            .store(bob_provider.storage())
            .expect("persist Bob signer");
        let bob_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-candidate-bob".to_vec()).into(),
            signature_key: bob_signer.to_public_vec().into(),
        };
        let bob_key_package = KeyPackage::builder()
            .build(CIPHERSUITE, &bob_provider, &bob_signer, bob_credential)
            .expect("build Bob key package");

        let (_commit, welcome, _group_info) = alice_group
            .add_members(
                &alice_provider,
                &alice_signer,
                &[bob_key_package.key_package().clone()],
            )
            .expect("add Bob and create Welcome");
        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("merge Alice add-member commit");
        assert_eq!(alice_group.epoch().as_u64(), 1);
        assert_eq!(alice_group.members().count(), 2);

        let welcome_wire = welcome
            .tls_serialize_detached()
            .expect("serialize Bob Welcome");
        let welcome = match MlsMessageIn::tls_deserialize_exact(&welcome_wire)
            .expect("deserialize Bob Welcome")
            .extract()
        {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => panic!("expected Welcome message"),
        };
        let join_config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let staged = StagedWelcome::new_from_welcome(&bob_provider, &join_config, welcome, None)
            .expect("stage Bob Welcome");
        let mut bob_group = staged
            .into_group(&bob_provider)
            .expect("Bob joins through Welcome");
        assert_eq!(bob_group.epoch().as_u64(), 1);
        assert_eq!(bob_group.members().count(), 2);

        let alice_message = alice_group
            .create_message(
                &alice_provider,
                &alice_signer.signer(alice_provider.crypto()),
                b"alice-to-bob",
            )
            .expect("Alice encrypts application message");
        let alice_message: MlsMessageIn = alice_message.into();
        let bob_received = bob_group
            .process_message(
                &bob_provider,
                alice_message
                    .try_into_protocol_message()
                    .expect("Alice message is a protocol message"),
            )
            .expect("Bob decrypts Alice application message");
        assert!(matches!(
            bob_received.into_content(),
            ProcessedMessageContent::ApplicationMessage(_)
        ));

        let bob_message = bob_group
            .create_message(
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                b"bob-to-alice",
            )
            .expect("Bob encrypts application message");
        let bob_message: MlsMessageIn = bob_message.into();
        let alice_received = alice_group
            .process_message(
                &alice_provider,
                bob_message
                    .try_into_protocol_message()
                    .expect("Bob message is a protocol message"),
            )
            .expect("Alice decrypts Bob application message");
        assert!(matches!(
            alice_received.into_content(),
            ProcessedMessageContent::ApplicationMessage(_)
        ));

        // Adding Bob already advanced the group from epoch 0 to epoch 1.
        assert_eq!(alice_group.epoch().as_u64(), 1);
    }

    fn file_provider(path: &Path) -> CandidateProvider<openmls_rust_crypto::RustCrypto> {
        let mut connection = Connection::open(path).expect("open persistent SQLCipher database");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("apply persistent SQLCipher key");
        {
            let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
            migrations
                .run_migrations()
                .expect("migrate persistent MLS storage");
        }
        let connection = Arc::new(connection);
        CandidateProvider {
            crypto: openmls_rust_crypto::RustCrypto::default(),
            storage: SqliteStorageProvider::new(connection),
        }
    }

    #[test]
    fn two_party_group_and_signing_keys_survive_sqlcipher_reopen() {
        use openmls::prelude::tls_codec::{Deserialize, Serialize};
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after UNIX epoch")
            .as_nanos();
        let alice_path = std::env::temp_dir().join(format!(
            "inone-openmls-092-alice-{}-{nonce}.db",
            std::process::id()
        ));
        let bob_path = std::env::temp_dir().join(format!(
            "inone-openmls-092-bob-{}-{nonce}.db",
            std::process::id()
        ));

        let alice_provider = file_provider(&alice_path);
        let bob_provider = file_provider(&bob_path);
        let alice_signer =
            SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).expect("create Alice signer");
        let bob_signer =
            SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).expect("create Bob signer");
        alice_signer
            .store(alice_provider.storage())
            .expect("persist Alice signing key");
        bob_signer
            .store(bob_provider.storage())
            .expect("persist Bob signing key");

        let alice_public_key = alice_signer.to_public_vec();
        let bob_public_key = bob_signer.to_public_vec();
        let alice_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-persistent-alice".to_vec()).into(),
            signature_key: alice_public_key.clone().into(),
        };
        let bob_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-persistent-bob".to_vec()).into(),
            signature_key: bob_public_key.clone().into(),
        };
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(16)
            .build();
        let mut alice_group =
            MlsGroup::new(&alice_provider, &alice_signer, &config, alice_credential)
                .expect("create persistent Alice group");
        let bob_key_package = KeyPackage::builder()
            .build(CIPHERSUITE, &bob_provider, &bob_signer, bob_credential)
            .expect("build persistent Bob key package");
        let (_commit, welcome, _) = alice_group
            .add_members(
                &alice_provider,
                &alice_signer,
                &[bob_key_package.key_package().clone()],
            )
            .expect("add persistent Bob member");
        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("commit persistent group membership");
        let welcome_wire = welcome
            .tls_serialize_detached()
            .expect("serialize persistent Welcome");
        let welcome = match MlsMessageIn::tls_deserialize_exact(&welcome_wire)
            .expect("deserialize persistent Welcome")
            .extract()
        {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => panic!("expected persistent Welcome"),
        };
        let join_config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .build();
        let staged = StagedWelcome::new_from_welcome(
            &bob_provider,
            &join_config,
            welcome,
            None,
        )
        .expect("stage persistent Bob Welcome");
        let bob_group = staged
            .into_group(&bob_provider)
            .expect("Bob joins persistent group");
        let group_id = alice_group.group_id().clone();
        assert_eq!(group_id, bob_group.group_id().clone());
        assert_eq!(alice_group.epoch().as_u64(), 1);
        assert_eq!(bob_group.epoch().as_u64(), 1);

        drop(alice_group);
        drop(bob_group);
        drop(alice_provider);
        drop(bob_provider);

        let alice_provider = file_provider(&alice_path);
        let bob_provider = file_provider(&bob_path);
        let mut alice_group = MlsGroup::load(alice_provider.storage(), &group_id)
            .expect("load Alice persistent group")
            .expect("Alice group exists after reopen");
        let mut bob_group = MlsGroup::load(bob_provider.storage(), &group_id)
            .expect("load Bob persistent group")
            .expect("Bob group exists after reopen");
        assert_eq!(alice_group.epoch().as_u64(), 1);
        assert_eq!(bob_group.epoch().as_u64(), 1);
        assert_eq!(alice_group.members().count(), 2);
        assert_eq!(bob_group.members().count(), 2);

        let alice_key = SignatureKeyPair::read(
            alice_provider.storage(),
            &alice_public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("reload Alice private signing key");
        let bob_key = SignatureKeyPair::read(
            bob_provider.storage(),
            &bob_public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("reload Bob private signing key");
        let alice_signer = alice_key.signer(alice_provider.crypto());
        let bob_signer = bob_key.signer(bob_provider.crypto());

        let alice_wire = alice_group
            .create_message(&alice_provider, &alice_signer, b"alice-after-reopen")
            .expect("Alice encrypts after SQLCipher reopen")
            .tls_serialize_detached()
            .expect("serialize Alice message after reopen");
        let alice_protocol = MlsMessageIn::tls_deserialize_exact(&alice_wire)
            .expect("deserialize Alice message after reopen")
            .try_into_protocol_message()
            .expect("Alice message is protocol message");
        let alice_received = bob_group
            .process_message(&bob_provider, alice_protocol)
            .expect("Bob decrypts after SQLCipher reopen");
        match alice_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(message.into_bytes(), b"alice-after-reopen");
            }
            _ => panic!("expected Alice application message"),
        }

        let bob_wire = bob_group
            .create_message(&bob_provider, &bob_signer, b"bob-after-reopen")
            .expect("Bob encrypts after SQLCipher reopen")
            .tls_serialize_detached()
            .expect("serialize Bob message after reopen");
        let bob_protocol = MlsMessageIn::tls_deserialize_exact(&bob_wire)
            .expect("deserialize Bob message after reopen")
            .try_into_protocol_message()
            .expect("Bob message is protocol message");
        let bob_received = alice_group
            .process_message(&alice_provider, bob_protocol)
            .expect("Alice decrypts after SQLCipher reopen");
        match bob_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(message.into_bytes(), b"bob-after-reopen");
            }
            _ => panic!("expected Bob application message"),
        }

        drop(alice_group);
        drop(bob_group);
        drop(alice_provider);
        drop(bob_provider);
        for path in [&alice_path, &bob_path] {
            let _ = std::fs::remove_file(path);
            let _ = std::fs::remove_file(path.with_extension("db-wal"));
            let _ = std::fs::remove_file(path.with_extension("db-shm"));
        }
    }

    #[test]
    fn rejects_a_wrong_sqlcipher_key() {
        let path = std::env::var("INONE_COMPAT_DB")
            .expect("INONE_COMPAT_DB must point to the generated fixture");
        let connection = Connection::open(Path::new(&path)).expect("open database handle");
        connection
            .pragma_update(None, "key", format!("x'{}'", "99".repeat(32)))
            .unwrap();
        assert!(connection
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| row
                .get::<_, i64>(0))
            .is_err());
    }
}
