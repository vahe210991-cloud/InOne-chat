use std::{path::Path, sync::Arc};

use openmls::prelude::*;
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

fn assert_candidate_sqlite_runtime(connection: &Connection) {
    let sqlite_version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .expect("read SQLite runtime version");
    assert_eq!(
        sqlite_version, "3.54.1",
        "candidate must use the reviewed SQLite 3.54.1 runtime"
    );

    let cipher_version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .expect("read SQLCipher runtime version");
    assert!(
        cipher_version.trim().starts_with("4.20.0"),
        "candidate must use SQLCipher 4.20.0, found {cipher_version}"
    );
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
    assert_candidate_sqlite_runtime(&connection);
    connection.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })?;
    {
        let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
        migrations.run_migrations()?;
    }

    let cipher_version: String =
        connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
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
    use std::borrow::Borrow;

    use openmls::prelude::tls_codec::{Deserialize, Serialize};
    use openmls_basic_credential::SignatureKeyPair;
    use openmls_libcrux_crypto::CryptoProvider as LibcruxCrypto;

    struct TransactionConnection<'a, 'conn>(&'a rusqlite::Transaction<'conn>);

    impl Borrow<Connection> for TransactionConnection<'_, '_> {
        fn borrow(&self) -> &Connection {
            self.0
        }
    }

    struct TransactionCandidateProvider<'a, 'conn, C> {
        crypto: C,
        storage: SqliteStorageProvider<JsonCodec, TransactionConnection<'a, 'conn>>,
    }

    impl<'a, 'conn, C> OpenMlsProvider for TransactionCandidateProvider<'a, 'conn, C>
    where
        C: OpenMlsCrypto + OpenMlsRand,
    {
        type CryptoProvider = C;
        type RandProvider = C;
        type StorageProvider =
            SqliteStorageProvider<JsonCodec, TransactionConnection<'a, 'conn>>;

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
        assert_eq!(group.epoch().as_u64(), 3);
        assert_eq!(group.members().count(), 2);
        assert!(group.members().any(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-member"
        }));
        assert!(group.members().any(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-bob"
        }));
        assert!(!group.members().any(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-transient"
        }));
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
        assert_eq!(reopened.epoch().as_u64(), 3);
        assert_eq!(reopened.members().count(), 2);
        assert!(reopened.members().any(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-member"
        }));
        assert!(reopened.members().any(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-bob"
        }));
        assert_eq!(reopened_cipher, cipher_version);

        // The old epoch-1 secret must still be available after a candidate reopen.
        let legacy_epoch1_wire = std::fs::read(path.with_extension("epoch1.msg"))
            .expect("read legacy epoch-1 application message");
        let legacy_epoch1_protocol =
            MlsMessageIn::tls_deserialize_exact(&legacy_epoch1_wire)
                .expect("deserialize legacy epoch-1 application message")
                .try_into_protocol_message()
                .expect("legacy epoch-1 message is a protocol message");
        let legacy_epoch1_received = reopened
            .process_message(&reopened_provider, legacy_epoch1_protocol)
            .expect("Libcrux decrypts retained epoch-1 message after candidate reopen");
        match legacy_epoch1_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(
                    message.into_bytes().as_slice(),
                    b"legacy-openmls-081-epoch-1-message"
                );
            }
            _ => panic!("expected legacy epoch-1 application message"),
        }
        let replayed_protocol = MlsMessageIn::tls_deserialize_exact(&legacy_epoch1_wire)
            .expect("deserialize replayed legacy epoch-1 message")
            .try_into_protocol_message()
            .expect("replayed legacy epoch-1 message is a protocol message");
        assert!(
            reopened
                .process_message(&reopened_provider, replayed_protocol)
                .is_err(),
            "replayed legacy epoch-1 message must be rejected after reopen"
        );

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
        assert_eq!(group.epoch().as_u64(), 3);
        assert_eq!(group.members().count(), 2);
        assert!(group.members().any(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-member"
        }));
        assert!(group.members().any(|member| {
            member.credential.serialized_content() == b"inone-legacy-fixture-bob"
        }));
        assert!(cipher_version.trim().starts_with("4.20.0"));

        // The 0.8.1 writer preserved a valid epoch-1 message. Decrypting it
        // after loading epoch 3 proves retained past secrets survive migration.
        let legacy_epoch1_wire = std::fs::read(path.with_extension("epoch1.msg"))
            .expect("read legacy epoch-1 application message");
        let legacy_epoch1_protocol =
            MlsMessageIn::tls_deserialize_exact(&legacy_epoch1_wire)
                .expect("deserialize legacy epoch-1 application message")
                .try_into_protocol_message()
                .expect("legacy epoch-1 message is a protocol message");
        let legacy_epoch1_received = group
            .process_message(&provider, legacy_epoch1_protocol)
            .expect("RustCrypto decrypts the legacy epoch-1 message after migration");
        match legacy_epoch1_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(
                    message.into_bytes().as_slice(),
                    b"legacy-openmls-081-epoch-1-message"
                );
            }
            _ => panic!("expected legacy epoch-1 application message"),
        }

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

    fn in_memory_connection() -> Arc<Connection> {
        let mut connection =
            Connection::open(":memory:").expect("open in-memory SQLCipher database");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("apply SQLCipher key");
        assert_candidate_sqlite_runtime(&connection);
        {
            let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
            migrations
                .run_migrations()
                .expect("migrate in-memory MLS storage");
        }
        Arc::new(connection)
    }

    fn in_memory_provider() -> CandidateProvider<openmls_rust_crypto::RustCrypto> {
        CandidateProvider {
            crypto: openmls_rust_crypto::RustCrypto::default(),
            storage: SqliteStorageProvider::new(in_memory_connection()),
        }
    }

    fn in_memory_libcrux_provider() -> CandidateProvider<LibcruxCrypto> {
        CandidateProvider {
            crypto: LibcruxCrypto::new().expect("initialize Libcrux provider"),
            storage: SqliteStorageProvider::new(in_memory_connection()),
        }
    }

    #[test]
    fn storage_migrations_are_idempotent_and_apply_all_six_versions() {
        let mut connection =
            Connection::open(":memory:").expect("open in-memory SQLCipher database");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("apply SQLCipher key");
        assert_candidate_sqlite_runtime(&connection);

        {
            let mut migrations = SqliteStorageProvider::<JsonCodec, _>::new(&mut connection);
            migrations
                .run_migrations()
                .expect("apply initial storage migrations");
            migrations
                .run_migrations()
                .expect("re-running storage migrations must be idempotent");
        }

        let migration_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations",
                [],
                |row| row.get(0),
            )
            .expect("read applied migration count");
        assert_eq!(migration_count, 6);

        let group_data_schema: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master
                 WHERE type = 'table' AND name = 'openmls_group_data'",
                [],
                |row| row.get(0),
            )
            .expect("read migrated group-data schema");
        assert!(group_data_schema.contains("application_export_tree"));

        let auxiliary_tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN (
                    'vc_emulation_group_secrets',
                    'vc_emulation_bindings',
                    'vc_operation_trees',
                    'vc_retained_key_package_material',
                    'registered_vc_emulation_epochs'
                 )",
                [],
                |row| row.get(0),
            )
            .expect("count virtual-client storage tables");
        assert_eq!(auxiliary_tables, 5);
    }

    #[test]
    fn membership_epoch_transition_rolls_back_with_outer_sqlite_transaction() {
        let alice_connection = in_memory_connection();
        let alice_provider = CandidateProvider {
            crypto: openmls_rust_crypto::RustCrypto::default(),
            storage: SqliteStorageProvider::new(Arc::clone(&alice_connection)),
        };
        let bob_provider = in_memory_provider();

        let alice_signer = SignatureKeyPair::generate(
            alice_provider.crypto(),
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("generate Alice signer");
        alice_signer
            .store(alice_provider.storage())
            .expect("persist Alice signer");
        let alice_public_key = alice_signer.to_public_vec();
        let alice_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-transaction-alice".to_vec()).into(),
            signature_key: alice_public_key.clone().into(),
        };
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(16)
            .build();
        let mut alice_group = MlsGroup::new(
            &alice_provider,
            &alice_signer.signer(alice_provider.crypto()),
            &config,
            alice_credential,
        )
        .expect("create Alice group");

        let bob_signer = SignatureKeyPair::generate(
            bob_provider.crypto(),
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("generate Bob signer");
        let bob_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-transaction-bob".to_vec()).into(),
            signature_key: bob_signer.to_public_vec().into(),
        };
        let bob_key_package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                bob_credential,
            )
            .expect("build Bob key package");
        let (_commit, _welcome, _) = alice_group
            .add_members(
                &alice_provider,
                &alice_signer.signer(alice_provider.crypto()),
                &[bob_key_package.key_package().clone()],
            )
            .expect("add Bob to Alice group");
        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("merge initial add-member Commit");
        let group_id = alice_group.group_id().clone();
        assert_eq!(alice_group.epoch().as_u64(), 1);
        assert_eq!(alice_group.members().count(), 2);
        drop(alice_group);

        // OpenMLS storage accepts a borrowed transaction connection. All writes
        // performed by remove_members + merge_pending_commit must roll back together.
        let tx = alice_connection
            .unchecked_transaction()
            .expect("begin outer MLS transaction");
        let tx_provider = TransactionCandidateProvider {
            crypto: openmls_rust_crypto::RustCrypto::default(),
            storage: SqliteStorageProvider::new(TransactionConnection(&tx)),
        };
        let mut tx_group = MlsGroup::load(tx_provider.storage(), &group_id)
            .expect("load Alice group inside transaction")
            .expect("Alice group exists inside transaction");
        let tx_signer = SignatureKeyPair::read(
            tx_provider.storage(),
            &alice_public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("load Alice signer inside transaction");
        let bob_index = tx_group
            .members()
            .find(|member| member.credential.serialized_content() == b"inone-transaction-bob")
            .map(|member| member.index)
            .expect("find Bob before removal");
        let (_remove_commit, welcome, _) = tx_group
            .remove_members(
                &tx_provider,
                &tx_signer.signer(tx_provider.crypto()),
                &[bob_index],
            )
            .expect("stage Bob removal inside transaction");
        assert!(welcome.is_none());
        tx_group
            .merge_pending_commit(&tx_provider)
            .expect("merge Bob removal inside transaction");
        assert_eq!(tx_group.epoch().as_u64(), 2);
        assert_eq!(tx_group.members().count(), 1);

        drop(tx_signer);
        drop(tx_group);
        drop(tx_provider);
        tx.rollback().expect("roll back entire MLS epoch transition");

        let restored = MlsGroup::load(alice_provider.storage(), &group_id)
            .expect("reload Alice group after rollback")
            .expect("Alice group remains present after rollback");
        assert_eq!(restored.epoch().as_u64(), 1);
        assert_eq!(restored.members().count(), 2);
        assert!(
            restored.members().any(|member| {
                member.credential.serialized_content() == b"inone-transaction-bob"
            }),
            "Bob must remain a member when the epoch transition transaction rolls back"
        );
    }

    #[test]
    fn stable_candidate_supports_welcome_epoch_and_bidirectional_application_messages() {
        // Exercise Libcrux -> RustCrypto interoperability, including provider-backed
        // key generation.
        let alice_provider = in_memory_libcrux_provider();
        let bob_provider = in_memory_provider();

        let alice_signer = SignatureKeyPair::generate(
            alice_provider.crypto(),
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("generate Alice signer through Libcrux");
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
        let mut alice_group = MlsGroup::new(
            &alice_provider,
            &alice_signer.signer(alice_provider.crypto()),
            &config,
            alice_credential,
        )
        .expect("create Alice group with Libcrux signer");

        let bob_signer = SignatureKeyPair::generate(
            bob_provider.crypto(),
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("generate Bob signer through RustCrypto");
        bob_signer
            .store(bob_provider.storage())
            .expect("persist Bob signer");
        let bob_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-candidate-bob".to_vec()).into(),
            signature_key: bob_signer.to_public_vec().into(),
        };
        let bob_key_package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                bob_credential,
            )
            .expect("build Bob key package");

        let (_commit, welcome, _group_info) = alice_group
            .add_members(
                &alice_provider,
                &alice_signer.signer(alice_provider.crypto()),
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
        match bob_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(message.into_bytes().as_slice(), b"alice-to-bob");
            }
            _ => panic!("expected Alice application message"),
        }

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
        match alice_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(message.into_bytes().as_slice(), b"bob-to-alice");
            }
            _ => panic!("expected Bob application message"),
        }

        // Reverse the Welcome direction: RustCrypto creates Charlie's Welcome,
        // Libcrux accepts it, and both peers exchange application messages.
        let charlie_provider = in_memory_libcrux_provider();
        let charlie_signer = SignatureKeyPair::generate(
            charlie_provider.crypto(),
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("generate Charlie signer through Libcrux");
        charlie_signer
            .store(charlie_provider.storage())
            .expect("persist Charlie signer");
        let charlie_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-candidate-charlie".to_vec()).into(),
            signature_key: charlie_signer.to_public_vec().into(),
        };
        let charlie_key_package = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &charlie_provider,
                &charlie_signer.signer(charlie_provider.crypto()),
                charlie_credential,
            )
            .expect("build Charlie key package through Libcrux");

        let (bob_commit, charlie_welcome, _) = bob_group
            .add_members(
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                &[charlie_key_package.key_package().clone()],
            )
            .expect("RustCrypto adds Charlie and creates Welcome");
        bob_group
            .merge_pending_commit(&bob_provider)
            .expect("Bob merges Charlie add-member Commit");

        let bob_commit: MlsMessageIn = bob_commit.into();
        let alice_processed = alice_group
            .process_message(
                &alice_provider,
                bob_commit
                    .try_into_protocol_message()
                    .expect("Bob Commit is a protocol message"),
            )
            .expect("Alice processes Bob's RustCrypto Commit");
        match alice_processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged_commit) => {
                alice_group
                    .merge_staged_commit(&alice_provider, *staged_commit)
                    .expect("Alice merges Bob's RustCrypto Commit");
            }
            _ => panic!("expected Bob's staged Commit"),
        }

        let charlie_welcome_wire = charlie_welcome
            .tls_serialize_detached()
            .expect("serialize Charlie Welcome");
        let charlie_welcome = match MlsMessageIn::tls_deserialize_exact(&charlie_welcome_wire)
            .expect("deserialize Charlie Welcome")
            .extract()
        {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => panic!("expected Charlie Welcome"),
        };
        let charlie_join_config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .max_past_epochs(16)
            .build();
        let charlie_staged = StagedWelcome::new_from_welcome(
            &charlie_provider,
            &charlie_join_config,
            charlie_welcome,
            None,
        )
        .expect("Libcrux stages RustCrypto Welcome");
        let mut charlie_group = charlie_staged
            .into_group(&charlie_provider)
            .expect("Charlie joins through RustCrypto Welcome");

        assert_eq!(alice_group.epoch().as_u64(), 2);
        assert_eq!(bob_group.epoch().as_u64(), 2);
        assert_eq!(charlie_group.epoch().as_u64(), 2);
        assert_eq!(alice_group.members().count(), 3);
        assert_eq!(bob_group.members().count(), 3);
        assert_eq!(charlie_group.members().count(), 3);

        let bob_to_charlie = bob_group
            .create_message(
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                b"rustcrypto-to-libcrux",
            )
            .expect("Bob encrypts for Charlie");
        let bob_to_charlie: MlsMessageIn = bob_to_charlie.into();
        let charlie_received = charlie_group
            .process_message(
                &charlie_provider,
                bob_to_charlie
                    .try_into_protocol_message()
                    .expect("Bob application message is a protocol message"),
            )
            .expect("Libcrux decrypts RustCrypto application message");
        match charlie_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(message.into_bytes().as_slice(), b"rustcrypto-to-libcrux");
            }
            _ => panic!("expected RustCrypto application message"),
        }

        let charlie_to_bob = charlie_group
            .create_message(
                &charlie_provider,
                &charlie_signer.signer(charlie_provider.crypto()),
                b"libcrux-to-rustcrypto",
            )
            .expect("Charlie encrypts for Bob");
        let charlie_to_bob: MlsMessageIn = charlie_to_bob.into();
        let bob_received = bob_group
            .process_message(
                &bob_provider,
                charlie_to_bob
                    .try_into_protocol_message()
                    .expect("Charlie application message is a protocol message"),
            )
            .expect("RustCrypto decrypts Libcrux application message");
        match bob_received.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(message.into_bytes().as_slice(), b"libcrux-to-rustcrypto");
            }
            _ => panic!("expected Libcrux application message"),
        }

        // The two Welcome directions and both application-message directions are covered.
        assert_eq!(alice_group.epoch().as_u64(), 2);
    }

    fn file_provider(path: &Path) -> CandidateProvider<openmls_rust_crypto::RustCrypto> {
        let mut connection = Connection::open(path).expect("open persistent SQLCipher database");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("apply persistent SQLCipher key");
        assert_candidate_sqlite_runtime(&connection);
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
        let staged = StagedWelcome::new_from_welcome(&bob_provider, &join_config, welcome, None)
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

        drop(alice_signer);
        drop(bob_signer);
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

    #[test]
    fn removing_member_revokes_future_epoch_access_and_survives_sqlcipher_reopen() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after UNIX epoch")
            .as_nanos();
        let alice_path = std::env::temp_dir().join(format!(
            "inone-openmls-092-remove-alice-{}-{nonce}.db",
            std::process::id()
        ));
        let bob_path = std::env::temp_dir().join(format!(
            "inone-openmls-092-remove-bob-{}-{nonce}.db",
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
            credential: BasicCredential::new(b"inone-removal-alice".to_vec()).into(),
            signature_key: alice_public_key.clone().into(),
        };
        let bob_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-candidate-bob".to_vec()).into(),
            signature_key: bob_public_key.clone().into(),
        };
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(16)
            .build();
        let mut alice_group =
            MlsGroup::new(&alice_provider, &alice_signer, &config, alice_credential)
                .expect("create Alice group");

        let bob_key_package = KeyPackage::builder()
            .build(CIPHERSUITE, &bob_provider, &bob_signer, bob_credential)
            .expect("build Bob key package");
        let (_add_commit, welcome, _) = alice_group
            .add_members(
                &alice_provider,
                &alice_signer,
                &[bob_key_package.key_package().clone()],
            )
            .expect("add Bob and create Welcome");
        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("merge add-member commit");

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
            .max_past_epochs(16)
            .build();
        let staged = StagedWelcome::new_from_welcome(&bob_provider, &join_config, welcome, None)
            .expect("stage Bob Welcome");
        let mut bob_group = staged
            .into_group(&bob_provider)
            .expect("Bob joins through Welcome");

        assert_eq!(alice_group.epoch().as_u64(), 1);
        assert_eq!(bob_group.epoch().as_u64(), 1);
        assert_eq!(alice_group.members().count(), 2);
        assert_eq!(bob_group.members().count(), 2);

        let bob_index = alice_group
            .members()
            .find(|member| member.credential.serialized_content() == b"inone-candidate-bob")
            .map(|member| member.index)
            .expect("find Bob's current leaf index");

        let (_remove_commit, welcome, _group_info) = alice_group
            .remove_members(
                &alice_provider,
                &alice_signer.signer(alice_provider.crypto()),
                &[bob_index],
            )
            .expect("create commit removing Bob");
        assert!(welcome.is_none(), "removal must not create a Welcome");
        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("merge Bob removal commit");

        assert_eq!(alice_group.epoch().as_u64(), 2);
        assert_eq!(alice_group.members().count(), 1);
        assert!(alice_group.is_active());
        assert_eq!(bob_group.epoch().as_u64(), 1);
        assert_eq!(bob_group.members().count(), 2);
        assert!(bob_group.is_active());

        // Bob deliberately does not receive the removal Commit and remains in epoch 1.
        // A message created by Alice in epoch 2 must not be processable by that stale state.
        let alice_future_wire = alice_group
            .create_message(
                &alice_provider,
                &alice_signer.signer(alice_provider.crypto()),
                b"message-after-bob-removal",
            )
            .expect("Alice creates epoch-2 application message")
            .tls_serialize_detached()
            .expect("serialize epoch-2 application message");
        let alice_future_protocol = MlsMessageIn::tls_deserialize_exact(&alice_future_wire)
            .expect("deserialize epoch-2 application message")
            .try_into_protocol_message()
            .expect("epoch-2 message is a protocol message");
        assert!(
            bob_group
                .process_message(&bob_provider, alice_future_protocol)
                .is_err(),
            "Bob's epoch-1 state must not process Alice's epoch-2 message"
        );
        assert_eq!(bob_group.epoch().as_u64(), 1);
        assert!(bob_group.is_active());

        // MaxPastEpochs(16) intentionally retains epoch-1 secrets. A valid
        // message created before Bob learns about removal may still be decrypted;
        // this does not grant access to epoch 2 or later.
        let bob_stale_wire = bob_group
            .create_message(
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                b"message-from-removed-bob-in-retained-epoch",
            )
            .expect("stale Bob state can construct an epoch-1 message")
            .tls_serialize_detached()
            .expect("serialize stale Bob message");
        let bob_stale_protocol = MlsMessageIn::tls_deserialize_exact(&bob_stale_wire)
            .expect("deserialize stale Bob message")
            .try_into_protocol_message()
            .expect("stale Bob message is a protocol message");
        let retained_message = alice_group
            .process_message(&alice_provider, bob_stale_protocol)
            .expect("Alice may decrypt an authentic message from retained epoch 1");
        match retained_message.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => {
                assert_eq!(
                    message.into_bytes(),
                    b"message-from-removed-bob-in-retained-epoch"
                );
            }
            _ => panic!("expected retained-epoch application message"),
        }
        let replayed_protocol = MlsMessageIn::tls_deserialize_exact(&bob_stale_wire)
            .expect("deserialize replayed stale Bob message")
            .try_into_protocol_message()
            .expect("replayed stale Bob message is a protocol message");
        assert!(
            alice_group
                .process_message(&alice_provider, replayed_protocol)
                .is_err(),
            "a retained-epoch application message must not be accepted twice"
        );
        assert_eq!(alice_group.epoch().as_u64(), 2);
        assert!(alice_group.is_active());

        let group_id = alice_group.group_id().clone();
        drop(alice_group);
        drop(bob_group);
        drop(alice_provider);
        drop(bob_provider);

        let reopened_provider = file_provider(&alice_path);
        let mut reopened_group = MlsGroup::load(reopened_provider.storage(), &group_id)
            .expect("load Alice group after removal and reopen")
            .expect("Alice group remains stored after removal");
        assert_eq!(reopened_group.epoch().as_u64(), 2);
        assert_eq!(reopened_group.members().count(), 1);
        assert!(reopened_group.is_active());
        assert!(
            !reopened_group
                .members()
                .any(|member| { member.credential.serialized_content() == b"inone-candidate-bob" }),
            "removed Bob must not reappear after SQLCipher reopen"
        );

        let reopened_key = SignatureKeyPair::read(
            reopened_provider.storage(),
            &alice_public_key,
            CIPHERSUITE.signature_algorithm(),
        )
        .expect("reload Alice signing key after removal");
        let reopened_signer = reopened_key.signer(reopened_provider.crypto());
        let post_reopen_message = reopened_group
            .create_message(
                &reopened_provider,
                &reopened_signer,
                b"alice-after-removal-reopen",
            )
            .expect("Alice can create a message after removal and reopen");
        assert!(!post_reopen_message
            .tls_serialize_detached()
            .unwrap()
            .is_empty());

        drop(reopened_signer);
        drop(reopened_group);
        drop(reopened_provider);
        for path in [&alice_path, &bob_path] {
            let _ = std::fs::remove_file(path);
            let _ = std::fs::remove_file(path.with_extension("db-wal"));
            let _ = std::fs::remove_file(path.with_extension("db-shm"));
        }
    }

    fn apply_remote_commit(
        group: &mut MlsGroup,
        provider: &CandidateProvider<openmls_rust_crypto::RustCrypto>,
        commit: MlsMessageOut,
    ) {
        let incoming: MlsMessageIn = commit.into();
        let protocol = incoming
            .try_into_protocol_message()
            .expect("outgoing Commit is a protocol message");
        let processed = group
            .process_message(provider, protocol)
            .expect("peer processes the epoch transition Commit");
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged_commit) => {
                group
                    .merge_staged_commit(provider, *staged_commit)
                    .expect("peer merges the staged epoch transition");
            }
            _ => panic!("expected a staged Commit message"),
        }
    }

    #[test]
    fn repeated_add_remove_epochs_survive_sqlcipher_reopen() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after UNIX epoch")
            .as_nanos();
        let alice_path = std::env::temp_dir().join(format!(
            "inone-openmls-092-epochs-alice-{}-{nonce}.db",
            std::process::id()
        ));
        let bob_path = std::env::temp_dir().join(format!(
            "inone-openmls-092-epochs-bob-{}-{nonce}.db",
            std::process::id()
        ));

        let mut alice_provider = file_provider(&alice_path);
        let mut bob_provider = file_provider(&bob_path);
        let mut alice_signer =
            SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).expect("create Alice signer");
        let mut bob_signer =
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
            credential: BasicCredential::new(b"inone-epochs-alice".to_vec()).into(),
            signature_key: alice_public_key.clone().into(),
        };
        let bob_credential = CredentialWithKey {
            credential: BasicCredential::new(b"inone-epochs-bob".to_vec()).into(),
            signature_key: bob_public_key.clone().into(),
        };
        let create_config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(16)
            .build();
        let mut alice_group = MlsGroup::new(
            &alice_provider,
            &alice_signer,
            &create_config,
            alice_credential,
        )
        .expect("create persistent Alice group");

        let bob_key_package = KeyPackage::builder()
            .build(CIPHERSUITE, &bob_provider, &bob_signer, bob_credential)
            .expect("build persistent Bob key package");
        let (_initial_commit, welcome, _) = alice_group
            .add_members(
                &alice_provider,
                &alice_signer,
                &[bob_key_package.key_package().clone()],
            )
            .expect("add Bob to persistent group");
        alice_group
            .merge_pending_commit(&alice_provider)
            .expect("merge initial add-member commit");

        let welcome_wire = welcome
            .tls_serialize_detached()
            .expect("serialize initial Bob Welcome");
        let welcome = match MlsMessageIn::tls_deserialize_exact(&welcome_wire)
            .expect("deserialize initial Bob Welcome")
            .extract()
        {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => panic!("expected initial Welcome"),
        };
        let join_config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .max_past_epochs(16)
            .build();
        let staged = StagedWelcome::new_from_welcome(&bob_provider, &join_config, welcome, None)
            .expect("stage initial Bob Welcome");
        let mut bob_group = staged
            .into_group(&bob_provider)
            .expect("Bob joins persistent group");

        let group_id = alice_group.group_id().clone();
        assert_eq!(alice_group.epoch().as_u64(), 1);
        assert_eq!(bob_group.epoch().as_u64(), 1);

        // Keep an epoch-1 message to verify it expires after more than 16
        // subsequent epoch transitions.
        let stale_epoch_wire = bob_group
            .create_message(
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                b"message-from-expired-epoch-1",
            )
            .expect("Bob creates epoch-1 message for retention-expiry check")
            .tls_serialize_detached()
            .expect("serialize epoch-1 message");

        // Nine add/remove cycles exercise eighteen sequential epoch transitions.
        // Bob receives and merges every Commit; both databases are reopened after
        // each cycle before the next transition is attempted.
        for round in 0..9_u64 {
            let transient_id = format!("inone-epochs-transient-{round}");
            let transient_provider = in_memory_provider();
            let transient_signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
                .expect("create transient member signer");
            transient_signer
                .store(transient_provider.storage())
                .expect("persist transient member signer");
            let transient_credential = CredentialWithKey {
                credential: BasicCredential::new(transient_id.as_bytes().to_vec()).into(),
                signature_key: transient_signer.to_public_vec().into(),
            };
            let transient_key_package = KeyPackage::builder()
                .build(
                    CIPHERSUITE,
                    &transient_provider,
                    &transient_signer,
                    transient_credential,
                )
                .expect("build transient member KeyPackage");

            let alice_signer_ref = alice_signer.signer(alice_provider.crypto());
            let (add_commit, _welcome, _) = alice_group
                .add_members(
                    &alice_provider,
                    &alice_signer_ref,
                    &[transient_key_package.key_package().clone()],
                )
                .expect("add transient member");
            alice_group
                .merge_pending_commit(&alice_provider)
                .expect("Alice merges add-member Commit");
            apply_remote_commit(&mut bob_group, &bob_provider, add_commit);

            let after_add_epoch = 2 + round * 2;
            assert_eq!(alice_group.epoch().as_u64(), after_add_epoch);
            assert_eq!(bob_group.epoch().as_u64(), after_add_epoch);
            assert_eq!(alice_group.members().count(), 3);
            assert_eq!(bob_group.members().count(), 3);

            let transient_index = alice_group
                .members()
                .find(|member| member.credential.serialized_content() == transient_id.as_bytes())
                .map(|member| member.index)
                .expect("find transient member leaf index");

            let alice_signer_ref = alice_signer.signer(alice_provider.crypto());
            let (remove_commit, welcome, _) = alice_group
                .remove_members(&alice_provider, &alice_signer_ref, &[transient_index])
                .expect("remove transient member");
            assert!(welcome.is_none());
            alice_group
                .merge_pending_commit(&alice_provider)
                .expect("Alice merges removal Commit");
            apply_remote_commit(&mut bob_group, &bob_provider, remove_commit);

            let after_remove_epoch = 3 + round * 2;
            assert_eq!(alice_group.epoch().as_u64(), after_remove_epoch);
            assert_eq!(bob_group.epoch().as_u64(), after_remove_epoch);
            assert_eq!(alice_group.members().count(), 2);
            assert_eq!(bob_group.members().count(), 2);

            let message_wire = alice_group
                .create_message(
                    &alice_provider,
                    &alice_signer.signer(alice_provider.crypto()),
                    format!("epoch-{after_remove_epoch}-after-reopen").as_bytes(),
                )
                .expect("Alice creates synchronized application message")
                .tls_serialize_detached()
                .expect("serialize synchronized application message");
            let message_protocol = MlsMessageIn::tls_deserialize_exact(&message_wire)
                .expect("deserialize synchronized application message")
                .try_into_protocol_message()
                .expect("application message is a protocol message");
            let received = bob_group
                .process_message(&bob_provider, message_protocol)
                .expect("Bob processes synchronized application message");
            match received.into_content() {
                ProcessedMessageContent::ApplicationMessage(message) => {
                    assert_eq!(
                        message.into_bytes(),
                        format!("epoch-{after_remove_epoch}-after-reopen").into_bytes()
                    );
                }
                _ => panic!("expected synchronized application message"),
            }

            drop(transient_signer);
            drop(transient_provider);
            drop(alice_group);
            drop(bob_group);
            drop(alice_signer);
            drop(bob_signer);
            drop(alice_provider);
            drop(bob_provider);

            alice_provider = file_provider(&alice_path);
            bob_provider = file_provider(&bob_path);
            alice_group = MlsGroup::load(alice_provider.storage(), &group_id)
                .expect("load Alice after epoch cycle")
                .expect("Alice group exists after epoch cycle");
            bob_group = MlsGroup::load(bob_provider.storage(), &group_id)
                .expect("load Bob after epoch cycle")
                .expect("Bob group exists after epoch cycle");
            assert_eq!(alice_group.epoch().as_u64(), after_remove_epoch);
            assert_eq!(bob_group.epoch().as_u64(), after_remove_epoch);
            assert_eq!(alice_group.members().count(), 2);
            assert_eq!(bob_group.members().count(), 2);

            alice_signer = SignatureKeyPair::read(
                alice_provider.storage(),
                &alice_public_key,
                CIPHERSUITE.signature_algorithm(),
            )
            .expect("reload Alice signing key after epoch cycle");
            bob_signer = SignatureKeyPair::read(
                bob_provider.storage(),
                &bob_public_key,
                CIPHERSUITE.signature_algorithm(),
            )
            .expect("reload Bob signing key after epoch cycle");
        }

        assert_eq!(alice_group.epoch().as_u64(), 19);
        assert_eq!(bob_group.epoch().as_u64(), 19);

        let expired_protocol = MlsMessageIn::tls_deserialize_exact(&stale_epoch_wire)
            .expect("deserialize expired epoch-1 message")
            .try_into_protocol_message()
            .expect("expired epoch-1 message is a protocol message");
        assert!(
            alice_group
                .process_message(&alice_provider, expired_protocol)
                .is_err(),
            "epoch-1 secrets must expire after the 16-epoch retention window"
        );
        assert_eq!(
            alice_group.epoch_authenticator().as_slice(),
            bob_group.epoch_authenticator().as_slice()
        );

        drop(alice_group);
        drop(bob_group);
        drop(alice_signer);
        drop(bob_signer);
        drop(alice_provider);
        drop(bob_provider);
        for path in [&alice_path, &bob_path] {
            let _ = std::fs::remove_file(path);
            let _ = std::fs::remove_file(path.with_extension("db-wal"));
            let _ = std::fs::remove_file(path.with_extension("db-shm"));
        }
    }
}
