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
