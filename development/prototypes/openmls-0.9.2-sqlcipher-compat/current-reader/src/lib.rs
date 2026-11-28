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
    use openmls::prelude::tls_codec::{Deserialize, Serialize};
    use openmls_basic_credential::SignatureKeyPair;
    use openmls_libcrux_crypto::CryptoProvider as LibcruxCrypto;

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
            .max_past_epochs(0)
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
            .max_past_epochs(0)
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

        // Bob can still construct a message using his stale epoch-1 state, but Alice
        // has explicitly discarded past-epoch secrets and must reject it.
        let bob_stale_wire = bob_group
            .create_message(
                &bob_provider,
                &bob_signer.signer(bob_provider.crypto()),
                b"message-from-removed-bob",
            )
            .expect("stale Bob state can construct an epoch-1 message")
            .tls_serialize_detached()
            .expect("serialize stale Bob message");
        let bob_stale_protocol = MlsMessageIn::tls_deserialize_exact(&bob_stale_wire)
            .expect("deserialize stale Bob message")
            .try_into_protocol_message()
            .expect("stale Bob message is a protocol message");
        assert!(
            alice_group
                .process_message(&alice_provider, bob_stale_protocol)
                .is_err(),
            "Alice must reject Bob's old-epoch message with MaxEpochs(0)"
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
            .max_past_epochs(0)
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
            .max_past_epochs(0)
            .build();
        let staged = StagedWelcome::new_from_welcome(&bob_provider, &join_config, welcome, None)
            .expect("stage initial Bob Welcome");
        let mut bob_group = staged
            .into_group(&bob_provider)
            .expect("Bob joins persistent group");

        let group_id = alice_group.group_id().clone();
        assert_eq!(alice_group.epoch().as_u64(), 1);
        assert_eq!(bob_group.epoch().as_u64(), 1);

        // Three add/remove cycles exercise six sequential epoch transitions.
        // Bob receives and merges every Commit; both databases are reopened after
        // each cycle before the next transition is attempted.
        for round in 0..3_u64 {
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

        assert_eq!(alice_group.epoch().as_u64(), 7);
        assert_eq!(bob_group.epoch().as_u64(), 7);
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

    #[test]
    fn grouped_migration_failure_rolls_back_v8_and_retry_preserves_legacy_rows() {
        let path = std::env::var("INONE_COMPAT_RECOVERY_DB")
            .expect("INONE_COMPAT_RECOVERY_DB must point to an independent legacy fixture");
        let path = Path::new(&path);

        let mut connection = Connection::open(path).expect("open legacy recovery fixture");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("apply SQLCipher key");
        connection
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("verify SQLCipher key before migration test");
        let original_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM openmls_group_data", [], |row| {
                row.get(0)
            })
            .expect("count original MLS rows");
        let original_history_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations",
                [],
                |row| row.get(0),
            )
            .expect("count pre-existing migration history");
        let original_v2_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .expect("check V8 migration history before migration");
        assert_eq!(
            original_v2_rows, 1,
            "legacy fixture must retain the legacy V8 migration"
        );

        // The legacy schema can hold this row only when CHECK enforcement is
        // deliberately bypassed. Candidate V8 creates its constrained replacement
        // table, copies rows, and must fail during that copy.
        let invalid_group_id = b"inone-migration-rollback-probe";
        connection
            .pragma_update(None, "ignore_check_constraints", "ON")
            .expect("temporarily permit a deliberately invalid legacy row");
        connection
            .execute(
                "INSERT INTO openmls_group_data (provider_version, group_id, data_type, group_data)
                 VALUES (1, ?1, 'invalid_migration_probe', X'01')",
                [invalid_group_id.as_slice()],
            )
            .expect("insert migration failure probe");
        connection
            .pragma_update(None, "ignore_check_constraints", "OFF")
            .expect("restore CHECK enforcement");
        drop(connection);

        let migration_error = match load_group(path, openmls_rust_crypto::RustCrypto::default()) {
            Ok(_) => panic!("V8 migration unexpectedly accepted an invalid legacy row"),
            Err(error) => error.to_string(),
        };
        assert!(
            migration_error.contains("CHECK constraint failed"),
            "expected V8 copy to fail on the new constraint, got: {migration_error}"
        );

        // The grouped batch must roll back CREATE TABLE, the copy, and every
        // migration-history insert while preserving the original table and rows.
        let mut connection = Connection::open(path).expect("reopen fixture after failed migration");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("reapply SQLCipher key after failed migration");
        let probe_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_group_data WHERE data_type = 'invalid_migration_probe'",
                [],
                |row| row.get(0),
            )
            .expect("read original table after rollback");
        assert_eq!(
            probe_rows, 1,
            "legacy table and probe row must survive rollback"
        );
        let replacement_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'openmls_group_data_new'",
                [],
                |row| row.get(0),
            )
            .expect("check replacement table after rollback");
        assert_eq!(
            replacement_table_count, 0,
            "replacement table must be rolled back"
        );
        let history_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations",
                [],
                |row| row.get(0),
            )
            .expect("read migration history after rollback");
        assert_eq!(
            history_rows, original_history_rows,
            "all pre-existing migration history rows must survive the failed V8 batch"
        );
        let v8_rows_after_failure: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations WHERE version = 8",
                [],
                |row| row.get(0),
            )
            .expect("verify V8 history after rollback");
        assert_eq!(
            v8_rows_after_failure, 0,
            "the failed V8 migration must not leave a history row"
        );
        let integrity: String = connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("check database integrity after rollback");
        assert_eq!(integrity, "ok");
        connection
            .execute(
                "DELETE FROM openmls_group_data WHERE group_id = ?1 AND data_type = 'invalid_migration_probe'",
                [invalid_group_id.as_slice()],
            )
            .expect("remove deliberate failure probe before retry");

        // This second failure happens after V8 has completed every DDL statement,
        // but before Refinery can record V2 in its history table. Grouped mode must
        // roll the schema change back together with the failed history write.
        connection
            .execute_batch(
                "CREATE TRIGGER reject_v8_migration_history
                 BEFORE INSERT ON openmls_sqlite_storage_migrations
                 WHEN NEW.version = 8
                 BEGIN
                   SELECT RAISE(ABORT, 'injected V8 migration history failure');
                 END;",
            )
            .expect("install migration-history failure trigger");
        drop(connection);

        let history_error = match load_group(path, openmls_rust_crypto::RustCrypto::default()) {
            Ok(_) => panic!("V8 migration unexpectedly ignored the history failure trigger"),
            Err(error) => error.to_string(),
        };
        assert!(
            history_error.contains("injected V8 migration history failure"),
            "expected injected history write failure, got: {history_error}"
        );

        let mut connection =
            Connection::open(path).expect("reopen fixture after migration-history failure");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("reapply SQLCipher key after history failure");
        let group_data_schema: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'openmls_group_data'",
                [],
                |row| row.get(0),
            )
            .expect("read group-data schema after history failure");
        assert!(
            !group_data_schema.contains("application_export_tree"),
            "V8 DDL must roll back when its history insert fails"
        );
        let replacement_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'openmls_group_data_new'",
                [],
                |row| row.get(0),
            )
            .expect("check replacement table after history failure");
        assert_eq!(
            replacement_table_count, 0,
            "V8 replacement table must not survive history failure"
        );
        let history_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations",
                [],
                |row| row.get(0),
            )
            .expect("read migration history after history failure");
        assert_eq!(
            history_rows, original_history_rows,
            "all pre-existing migration history rows must remain after the history-write failure"
        );
        let v8_rows_after_history_failure: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations WHERE version = 8",
                [],
                |row| row.get(0),
            )
            .expect("verify V8 history after history failure");
        assert_eq!(v8_rows_after_history_failure, 0);
        let integrity: String = connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("check database integrity after history failure");
        assert_eq!(integrity, "ok");
        connection
            .execute_batch("DROP TRIGGER reject_v8_migration_history")
            .expect("remove migration-history failure trigger");
        drop(connection);

        // Reopening after repair must retry the migrations, preserve the original
        // MLS records, and commit V8 history exactly once.
        let (group, _, _) = load_group(path, openmls_rust_crypto::RustCrypto::default())
            .expect("retry grouped migration after repairing the fixture");
        assert_eq!(group.group_id().as_slice(), GROUP_ID);
        assert_eq!(group.epoch().as_u64(), 0);
        assert_eq!(group.members().count(), 1);
        drop(group);

        let mut connection = Connection::open(path).expect("reopen successfully migrated fixture");
        connection
            .pragma_update(None, "key", format!("x'{TEST_KEY_HEX}'"))
            .expect("reapply SQLCipher key after successful migration");
        let migrated_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM openmls_group_data", [], |row| {
                row.get(0)
            })
            .expect("count migrated MLS rows");
        assert_eq!(
            migrated_rows, original_rows,
            "all legacy MLS rows must be preserved"
        );
        let v8_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM openmls_sqlite_storage_migrations WHERE version = 8",
                [],
                |row| row.get(0),
            )
            .expect("verify V8 migration history");
        assert_eq!(
            v2_rows, 1,
            "V8 history must be committed exactly once after retry"
        );
        let integrity: String = connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("check database integrity after successful retry");
        assert_eq!(integrity, "ok");
    }
}
