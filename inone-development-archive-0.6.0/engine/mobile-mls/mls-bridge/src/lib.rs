//! Мост для Flutter: группы MLS (OpenMLS) за простым интерфейсом из байтов и строк.
//! Состояние держится в памяти процесса. Постоянное хранение (зашифрованная база) — отдельный шаг.
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};

use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Сколько прошлых эпох хранит группа. По умолчанию OpenMLS не хранит ни одной, и сообщения прошлой эпохи
/// после коммита не открываются. 16 эпох покрывают обычный пропуск связи; клиент всё равно читает по порядку эпох.
const MAX_PAST_EPOCHS: usize = 16;

fn ensure_supported_welcome_ciphersuite(suite: Ciphersuite) -> Result<(), String> {
    if suite == CIPHERSUITE {
        Ok(())
    } else {
        Err("unsupported MLS ciphersuite; only X25519/Ed25519 is enabled".to_string())
    }
}

/// Результат обработки входящего сообщения группы.
#[derive(Debug, Clone, PartialEq)]
pub enum Received {
    Application { text: String },
    Commit { epoch: u64 },
}

/// Результат приглашения: коммит для участников группы и приветствие для нового участника.
#[derive(Debug, Clone, PartialEq)]
pub struct Added {
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
    pub epoch: u64,
}

struct Identity {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
}

#[derive(Default)]
struct World {
    identities: HashMap<String, Identity>,
    groups: HashMap<(String, String), MlsGroup>,
}

static WORLD: OnceLock<Mutex<World>> = OnceLock::new();

fn world() -> MutexGuard<'static, World> {
    WORLD
        .get_or_init(|| Mutex::new(World::default()))
        .lock()
        .expect("mls world lock")
}

fn text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Создаёт личность с ключами подписи и возвращает её ключевой пакет для приглашения.
pub fn create_identity(name: String) -> Result<Vec<u8>, String> {
    let provider = OpenMlsRustCrypto::default();
    let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(text)?;
    signer.store(provider.storage()).map_err(text)?;
    let credential = CredentialWithKey {
        credential: BasicCredential::new(name.as_bytes().to_vec()).into(),
        signature_key: signer.to_public_vec().into(),
    };
    let bundle = KeyPackage::builder()
        .build(CIPHERSUITE, &provider, &signer, credential.clone())
        .map_err(text)?;
    let key_package = bundle
        .key_package()
        .tls_serialize_detached()
        .map_err(text)?;
    world().identities.insert(
        name,
        Identity {
            provider,
            signer,
            credential,
        },
    );
    Ok(key_package)
}

/// Создаёт группу с указанным идентификатором; возвращает номер эпохи (0).
pub fn create_group(identity: String, group_id: String) -> Result<u64, String> {
    let mut w = world();
    let me = w
        .identities
        .get(&identity)
        .ok_or_else(|| format!("unknown identity {identity}"))?;
    let config = MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        .use_ratchet_tree_extension(true)
        .max_past_epochs(MAX_PAST_EPOCHS)
        .build();
    let group = MlsGroup::new_with_group_id(
        &me.provider,
        &me.signer,
        &config,
        GroupId::from_slice(group_id.as_bytes()),
        me.credential.clone(),
    )
    .map_err(text)?;
    let epoch = group.epoch().as_u64();
    w.groups.insert((identity, group_id), group);
    Ok(epoch)
}

/// Приглашает участника по его ключевому пакету и применяет коммит у себя.
pub fn add_member(
    identity: String,
    group_id: String,
    key_package: Vec<u8>,
) -> Result<Added, String> {
    let mut w = world();
    let World { identities, groups } = &mut *w;
    let me = identities
        .get(&identity)
        .ok_or_else(|| format!("unknown identity {identity}"))?;
    let group = groups
        .get_mut(&(identity.clone(), group_id))
        .ok_or_else(|| "unknown group".to_string())?;
    let package = KeyPackageIn::tls_deserialize_exact(&key_package)
        .map_err(text)?
        .validate(me.provider.crypto(), ProtocolVersion::Mls10)
        .map_err(text)?;
    let (commit, welcome, _group_info) = group
        .add_members(&me.provider, &me.signer, &[package])
        .map_err(text)?;
    group.merge_pending_commit(&me.provider).map_err(text)?;
    Ok(Added {
        commit: commit.tls_serialize_detached().map_err(text)?,
        welcome: welcome.tls_serialize_detached().map_err(text)?,
        epoch: group.epoch().as_u64(),
    })
}

/// Присоединяется к группе по приветствию; возвращает идентификатор группы.
pub fn join_group(identity: String, welcome: Vec<u8>) -> Result<String, String> {
    let mut w = world();
    let World { identities, groups } = &mut *w;
    let me = identities
        .get(&identity)
        .ok_or_else(|| format!("unknown identity {identity}"))?;
    let message = MlsMessageIn::tls_deserialize_exact(&welcome).map_err(text)?;
    let welcome = match message.extract() {
        MlsMessageBodyIn::Welcome(w) => w,
        _ => return Err("not a welcome message".to_string()),
    };
    let join_config = MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .max_past_epochs(MAX_PAST_EPOCHS)
        .build();
    let staged =
        StagedWelcome::new_from_welcome(&me.provider, &join_config, welcome, None).map_err(text)?;
    ensure_supported_welcome_ciphersuite(staged.group_context().ciphersuite())?;
    let group = staged.into_group(&me.provider).map_err(text)?;
    let group_id = String::from_utf8_lossy(group.group_id().as_slice()).to_string();
    groups.insert((identity, group_id.clone()), group);
    Ok(group_id)
}

/// Шифрует текст для группы в текущей эпохе.
pub fn encrypt(identity: String, group_id: String, plaintext: String) -> Result<Vec<u8>, String> {
    let mut w = world();
    let World { identities, groups } = &mut *w;
    let me = identities
        .get(&identity)
        .ok_or_else(|| format!("unknown identity {identity}"))?;
    let group = groups
        .get_mut(&(identity, group_id))
        .ok_or_else(|| "unknown group".to_string())?;
    group
        .create_message(&me.provider, &me.signer, plaintext.as_bytes())
        .map_err(text)?
        .tls_serialize_detached()
        .map_err(text)
}

/// Расшифровывает сообщение группы или применяет коммит.
pub fn decrypt(identity: String, group_id: String, message: Vec<u8>) -> Result<Received, String> {
    let mut w = world();
    let World { identities, groups } = &mut *w;
    let me = identities
        .get(&identity)
        .ok_or_else(|| format!("unknown identity {identity}"))?;
    let group = groups
        .get_mut(&(identity, group_id))
        .ok_or_else(|| "unknown group".to_string())?;
    let parsed = MlsMessageIn::tls_deserialize_exact(&message).map_err(text)?;
    let protocol = parsed.try_into_protocol_message().map_err(text)?;
    let processed = group
        .process_message(&me.provider, protocol)
        .map_err(text)?;
    match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(app) => Ok(Received::Application {
            text: String::from_utf8(app.into_bytes()).map_err(text)?,
        }),
        ProcessedMessageContent::StagedCommitMessage(staged) => {
            group
                .merge_staged_commit(&me.provider, *staged)
                .map_err(text)?;
            Ok(Received::Commit {
                epoch: group.epoch().as_u64(),
            })
        }
        _ => Err("unexpected kind of message".to_string()),
    }
}

/// Номер текущей эпохи группы.
pub fn epoch(identity: String, group_id: String) -> Result<u64, String> {
    let w = world();
    w.groups
        .get(&(identity, group_id))
        .map(|g| g.epoch().as_u64())
        .ok_or_else(|| "unknown group".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invitation_welcome_and_messages_both_ways() {
        let group = "!bridge-test-1:inone.test".to_string();
        let kp_bob = create_identity("t1-bob".into()).unwrap();
        create_identity("t1-alice".into()).unwrap();
        assert_eq!(create_group("t1-alice".into(), group.clone()).unwrap(), 0);
        let added = add_member("t1-alice".into(), group.clone(), kp_bob).unwrap();
        assert_eq!(added.epoch, 1);
        assert_eq!(join_group("t1-bob".into(), added.welcome).unwrap(), group);
        let hello = encrypt("t1-alice".into(), group.clone(), "привет, Боб".into()).unwrap();
        assert_eq!(
            decrypt("t1-bob".into(), group.clone(), hello).unwrap(),
            Received::Application {
                text: "привет, Боб".into()
            }
        );
        let reply = encrypt("t1-bob".into(), group.clone(), "привет, Алиса".into()).unwrap();
        assert_eq!(
            decrypt("t1-alice".into(), group.clone(), reply).unwrap(),
            Received::Application {
                text: "привет, Алиса".into()
            }
        );
    }

    #[test]
    fn past_epoch_message_readable_after_one_commit() {
        let group = "!bridge-test-3:inone.test".to_string();
        let kp_bob = create_identity("t3-bob".into()).unwrap();
        let kp_carol = create_identity("t3-carol".into()).unwrap();
        create_identity("t3-alice".into()).unwrap();
        create_group("t3-alice".into(), group.clone()).unwrap();
        let first = add_member("t3-alice".into(), group.clone(), kp_bob).unwrap();
        join_group("t3-bob".into(), first.welcome).unwrap();
        // Сообщение эпохи 1 отправлено до того, как Боб получил коммит эпохи 2.
        let old = encrypt("t3-alice".into(), group.clone(), "из эпохи один".into()).unwrap();
        let second = add_member("t3-alice".into(), group.clone(), kp_carol).unwrap();
        assert_eq!(second.epoch, 2);
        assert_eq!(
            decrypt("t3-bob".into(), group.clone(), second.commit).unwrap(),
            Received::Commit { epoch: 2 }
        );
        assert_eq!(
            decrypt("t3-bob".into(), group, old).unwrap(),
            Received::Application {
                text: "из эпохи один".into()
            }
        );
    }

    #[test]
    fn tampered_message_is_refused() {
        let group = "!bridge-test-2:inone.test".to_string();
        let kp_bob = create_identity("t2-bob".into()).unwrap();
        create_identity("t2-alice".into()).unwrap();
        create_group("t2-alice".into(), group.clone()).unwrap();
        let added = add_member("t2-alice".into(), group.clone(), kp_bob).unwrap();
        join_group("t2-bob".into(), added.welcome).unwrap();
        let mut message = encrypt("t2-alice".into(), group.clone(), "секрет".into()).unwrap();
        let last = message.len() - 1;
        message[last] ^= 1;
        assert!(decrypt("t2-bob".into(), group, message).is_err());
    }
}

#[cfg(test)]
mod security_policy_tests {
    use super::*;

    #[test]
    fn welcome_policy_rejects_p256_ciphersuite() {
        assert!(ensure_supported_welcome_ciphersuite(CIPHERSUITE).is_ok());
        assert!(ensure_supported_welcome_ciphersuite(
            Ciphersuite::MLS_128_DHKEMP256_AES128GCM_SHA256_P256
        )
        .is_err());
    }
}
