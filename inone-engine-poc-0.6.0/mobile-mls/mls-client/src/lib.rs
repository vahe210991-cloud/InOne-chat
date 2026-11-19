//! Ядро клиента InOne на Rust: вход, ключевые пакеты, группы MLS, сообщения, догон после отсутствия,
//! вход нового устройства по подтверждению и удаление отозванных устройств из групп.
//! База устройства зашифрована (SQLCipher). Ключ передаёт платформа: Keychain на iOS, Keystore на Android.
use std::borrow::Borrow;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Mutex;

use rusqlite::OptionalExtension;
use zeroize::{Zeroize, Zeroizing};
use std::time::Duration;
use std::path::Path;
use std::io::Read;
use std::net::IpAddr;
use url::Url;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::RustCrypto;
use openmls_traits::{crypto::OpenMlsCrypto, random::OpenMlsRand, types::HashType};
use openmls_sqlite_storage::{Codec, Connection, SqliteStorageProvider};
use serde_json::{json, Value};

pub mod remote_config;
pub mod attachment_crypto;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
/// Сколько прошлых эпох хранит группа (см. mls-bridge: по умолчанию OpenMLS не хранит ни одной).
const MAX_PAST_EPOCHS: usize = 16;

/// Что получено из комнаты при синхронизации.
enum Failure {
    Transient,
    Permanent(&'static str),
}

fn classify_process_error<S>(error: &openmls::prelude::ProcessMessageError<S>) -> Failure {
    use openmls::prelude::ProcessMessageError as E;
    match error {
        E::StorageError(_) | E::LibraryError(_) => Failure::Transient,
        _ => Failure::Permanent("MLS message failed validation or is unsupported"),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Text { room_id: String, event_id: String, text: String, mine: bool },
    Attachment {
        room_id: String,
        event_id: String,
        file_id: String,
        name: String,
        mime_type: String,
        size: u64,
        mine: bool,
    },
    Unreadable { room_id: String, event_id: String, mine: bool },
}

/// Кодек хранилища OpenMLS: JSON.
#[derive(Default)]
pub struct JsonCodec;

impl Codec for JsonCodec {
    type Error = serde_json::Error;
    fn to_vec<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, Self::Error> {
        serde_json::to_vec(value)
    }
    fn from_slice<T: serde::de::DeserializeOwned>(slice: &[u8]) -> Result<T, Self::Error> {
        serde_json::from_slice(slice)
    }
}

/// OpenMLS provider borrows the same SQLCipher connection used by client metadata.
/// This allows a caller-owned SQLite transaction to cover both MLS state and inbox writes.
pub struct DeviceProvider<'a, ConnectionRef>
where
    ConnectionRef: Borrow<Connection>,
{
    crypto: &'a RustCrypto,
    storage: SqliteStorageProvider<JsonCodec, ConnectionRef>,
}

impl<'a, ConnectionRef> DeviceProvider<'a, ConnectionRef>
where
    ConnectionRef: Borrow<Connection>,
{
    fn new(crypto: &'a RustCrypto, connection: ConnectionRef) -> Self {
        Self {
            crypto,
            storage: SqliteStorageProvider::new(connection),
        }
    }
}

impl<'a, ConnectionRef> OpenMlsProvider for DeviceProvider<'a, ConnectionRef>
where
    ConnectionRef: Borrow<Connection>,
{
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = SqliteStorageProvider<JsonCodec, ConnectionRef>;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }
    fn crypto(&self) -> &Self::CryptoProvider {
        self.crypto
    }
    fn rand(&self) -> &Self::RandProvider {
        self.crypto
    }
}

struct TransactionConnection<'a, 'conn>(&'a rusqlite::Transaction<'conn>);

impl Borrow<Connection> for TransactionConnection<'_, '_> {
    fn borrow(&self) -> &Connection {
        self.0
    }
}

struct Group {
    mls: MlsGroup,
    /// Эпоха, с которой устройство вошло в группу: более ранние сообщения оно не читает.
    join_epoch: u64,
}

struct SessionTokens(String, String);

impl Drop for SessionTokens {
    fn drop(&mut self) {
        self.0.zeroize();
        self.1.zeroize();
    }
}

pub struct Client {
    base: String,
    /// Пара токенов живёт только в Rust и обнуляется при удалении клиента.
    tokens: Mutex<SessionTokens>,
    user_id: String,
    device_id: String,
    agent: ureq::Agent,
    crypto: RustCrypto,
    /// Единственное SQLCipher-соединение для OpenMLS state и client metadata/inbox.
    meta: Connection,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    groups: HashMap<String, Group>,
    processed: HashSet<String>,
}


/// Normalize and validate the API origin before any credentials are sent.
/// Plain HTTP is permitted only for loopback/private hosts in debug builds.
fn normalize_base_url(base: &str) -> Result<String, String> {
    let parsed = Url::parse(base.trim())
        .map_err(|error| format!("некорректный адрес API: {error}"))?;
    if parsed.host_str().is_none() || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("адрес API должен содержать host и не должен содержать credentials".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("адрес API не должен содержать query или fragment".to_string());
    }
    match parsed.scheme() {
        "https" => {}
        "http" if cfg!(debug_assertions) && is_local_development_host(parsed.host_str().unwrap_or("")) => {}
        "http" => return Err("HTTPS обязателен; HTTP разрешён только для локальной разработки".to_string()),
        _ => return Err("поддерживаются только HTTPS и локальный HTTP в debug-сборках".to_string()),
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn is_local_development_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => address.is_loopback() || address.is_private() || address.is_link_local(),
        Ok(IpAddr::V6(address)) => address.is_loopback() || address.is_unique_local() || address.is_unicast_link_local(),
        Err(_) => false,
    }
}

fn text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn event_id_from_event(event: &Value) -> Result<String, String> {
    let event_id = event
        .get("event_id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| {
            "ошибка контракта ответа: event_id отсутствует, не строка или пустой".to_string()
        })?;
    Ok(event_id.to_string())
}

fn verify_staged_membership_metadata(
    group: &MlsGroup,
    staged: &StagedCommit,
    metadata: &Value,
) -> Result<(), String> {
    let changes = metadata
        .get("changes")
        .filter(|v| !v.is_null())
        .ok_or_else(|| "P0.2: отсутствуют metadata changes".to_string())?;
    let string_set = |value: &Value, key: &str| -> Result<BTreeSet<String>, String> {
        value
            .get(key)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("P0.2: поле {key} отсутствует или не массив"))?
            .iter()
            .map(|v| {
                v.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| format!("P0.2: поле {key} содержит не строку"))
            })
            .collect()
    };
    let expected_adds = string_set(changes, "adds")?;
    let expected_removes = string_set(changes, "removes")?;
    let expected_remove_devices = string_set(changes, "removeDevices")?;

    let recipients = metadata
        .get("welcomeRecipients")
        .and_then(Value::as_array)
        .ok_or_else(|| "P0.2: welcomeRecipients отсутствует или не массив".to_string())?;
    let mut expected_welcome_identities = Vec::with_capacity(recipients.len());
    for recipient in recipients {
        let user = recipient
            .get("userId")
            .and_then(Value::as_str)
            .ok_or_else(|| "P0.2: Welcome recipient без userId".to_string())?;
        let device = recipient
            .get("deviceId")
            .and_then(Value::as_str)
            .ok_or_else(|| "P0.2: Welcome recipient без deviceId".to_string())?;
        expected_welcome_identities.push(format!("{user}/{device}"));
    }
    expected_welcome_identities.sort();

    let mut actual_add_identities: Vec<String> = staged
        .add_proposals()
        .map(|proposal| {
            String::from_utf8_lossy(
                proposal
                    .add_proposal()
                    .key_package()
                    .leaf_node()
                    .credential()
                    .serialized_content(),
            )
            .to_string()
        })
        .collect();
    actual_add_identities.sort();
    if actual_add_identities != expected_welcome_identities {
        return Err(format!(
            "P0.2: Add proposals не совпадают с Welcome recipients (actual={actual_add_identities:?}, expected={expected_welcome_identities:?})"
        ));
    }

    let actual_add_users: BTreeSet<String> = actual_add_identities
        .iter()
        .map(|identity| {
            identity
                .rsplit_once('/')
                .map(|(user, _)| user.to_string())
                .ok_or_else(|| "P0.2: credential Add имеет неверный формат user/device".to_string())
        })
        .collect::<Result<_, _>>()?;
    if actual_add_users != expected_adds {
        return Err(format!(
            "P0.2: Add users не совпадают с server changes (actual={actual_add_users:?}, expected={expected_adds:?})"
        ));
    }

    let before: BTreeSet<String> = group
        .members()
        .map(|member| String::from_utf8_lossy(member.credential.serialized_content()).to_string())
        .collect();
    let mut actual_remove_identities = Vec::new();
    for proposal in staged.remove_proposals() {
        let index = proposal.remove_proposal().removed();
        let member = group.member_at(index).ok_or_else(|| {
            format!("P0.2: Remove proposal ссылается на отсутствующий pre-merge leaf {index:?}")
        })?;
        actual_remove_identities
            .push(String::from_utf8_lossy(member.credential.serialized_content()).to_string());
    }

    let mut actual_after = before.clone();
    for identity in &actual_remove_identities {
        if !actual_after.remove(identity) {
            return Err(format!(
                "P0.2: Remove proposal удаляет отсутствующий identity {identity}"
            ));
        }
    }
    for identity in &actual_add_identities {
        if !actual_after.insert(identity.clone()) {
            return Err(format!(
                "P0.2: Add proposal повторно добавляет identity {identity}"
            ));
        }
    }
    let users = |identities: &BTreeSet<String>| -> Result<BTreeSet<String>, String> {
        identities
            .iter()
            .map(|identity| {
                identity
                    .rsplit_once('/')
                    .map(|(user, _)| user.to_string())
                    .ok_or_else(|| "P0.2: credential имеет неверный формат user/device".to_string())
            })
            .collect()
    };
    let before_users = users(&before)?;
    let actual_after_users = users(&actual_after)?;
    let mut expected_after_users = before_users;
    for user in &expected_removes {
        expected_after_users.remove(user);
    }
    for user in &expected_adds {
        expected_after_users.insert(user.clone());
    }
    if actual_after_users != expected_after_users {
        return Err(format!(
            "P0.2: итоговый MLS membership не совпадает с changes (actual={actual_after_users:?}, expected={expected_after_users:?})"
        ));
    }

    let mut actual_remove_devices: Vec<String> = actual_remove_identities
        .iter()
        .filter_map(|identity| {
            let (user, device) = identity.rsplit_once('/')?;
            if expected_removes.contains(user) {
                None
            } else {
                Some(device.to_string())
            }
        })
        .collect();
    actual_remove_devices.sort();
    let mut expected_remove_devices: Vec<String> = expected_remove_devices.into_iter().collect();
    expected_remove_devices.sort();
    if actual_remove_devices != expected_remove_devices {
        return Err(format!(
            "P0.2: Remove device proposals не совпадают с changes.removeDevices (actual={actual_remove_devices:?}, expected={expected_remove_devices:?})"
        ));
    }
    Ok(())
}

fn membership_commit_fingerprint(
    crypto: &RustCrypto,
    room_id: &str,
    operation_id: &str,
    base_epoch: u64,
    payload: &Value,
    staged: &StagedCommit,
) -> Result<String, String> {
    let staged_epoch = staged.epoch().as_u64();
    if staged_epoch != base_epoch.saturating_add(1) {
        return Err(format!(
            "membership fingerprint epoch mismatch: base={base_epoch}, staged={staged_epoch}"
        ));
    }
    let staged_value = serde_json::to_value(staged).map_err(text)?;
    let staged_bytes = serde_json::to_vec(&staged_value).map_err(text)?;
    let payload_value = serde_json::to_value(payload).map_err(text)?;
    let payload_bytes = serde_json::to_vec(&payload_value).map_err(text)?;
    let base_bytes = base_epoch.to_be_bytes();
    let staged_epoch_bytes = staged_epoch.to_be_bytes();
    let parts: [&[u8]; 6] = [
        room_id.as_bytes(),
        operation_id.as_bytes(),
        &base_bytes,
        &staged_epoch_bytes,
        &staged_bytes,
        &payload_bytes,
    ];
    let mut input = b"inone-membership-staged-commit-v1\0".to_vec();
    for part in parts {
        input.extend_from_slice(&(part.len() as u64).to_be_bytes());
        input.extend_from_slice(part);
    }
    let digest = crypto.hash(HashType::Sha2_256, &input).map_err(text)?;
    Ok(hex_encode(&digest))
}

fn response_error_code(error: &str) -> Option<String> {
    let start = error.find('{')?;
    let body: Value = serde_json::from_str(&error[start..]).ok()?;
    body.get("code")?.as_str().map(str::to_string)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Открывает зашифрованную базу. Неверный ключ сразу даёт ошибку.
fn open_db(path: &str, key: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(text)?;
    conn.pragma_update(None, "key", format!("x'{}'", hex_encode(key))).map_err(text)?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
        .map_err(|_| "неверный ключ базы устройства или файл повреждён".to_string())?;
    Ok(conn)
}

fn insert_incoming_record(meta: &Connection, incoming: &Incoming) -> Result<(), String> {
    let (event_id, room_id, kind, body) = match incoming {
        Incoming::Text { room_id, event_id, text, .. } => (
            event_id.as_str(), room_id.as_str(), "text", Some(text.clone())
        ),
        Incoming::Attachment { room_id, event_id, file_id, name, mime_type, size, .. } => (
            event_id.as_str(),
            room_id.as_str(),
            "attachment",
            Some(serde_json::to_string(&json!({
                "fileId": file_id,
                "name": name,
                "mimeType": mime_type,
                "size": size,
            })).map_err(text)?),
        ),
        Incoming::Unreadable { room_id, event_id, .. } => (
            event_id.as_str(), room_id.as_str(), "unreadable", None
        ),
    };
    // Event IDs are idempotency keys. Replays must never reset an already
    // acknowledged inbox row or replace its previously persisted plaintext.
    meta.execute(
        "INSERT OR IGNORE INTO client_inbox (event_id, room_id, kind, body, acknowledged) VALUES (?1, ?2, ?3, ?4, 0)",
        rusqlite::params![event_id, room_id, kind, body],
    ).map_err(text)?;
    meta.execute(
        "INSERT OR IGNORE INTO client_processed (event_id) VALUES (?1)",
        [event_id],
    ).map_err(text)?;
    Ok(())
}

fn incoming_from_row(
    event_id: String,
    room_id: String,
    kind: String,
    body: Option<String>,
    client_message_id: Option<String>,
) -> Result<Incoming, String> {
    let mine = client_message_id.is_some();
    match kind.as_str() {
        "text" => Ok(Incoming::Text {
            room_id,
            event_id,
            text: body.ok_or("в сохранённом сообщении отсутствует текст")?,
            mine,
        }),
        "attachment" => {
            let body = body.ok_or("в сохранённом вложении отсутствуют метаданные")?;
            let value: Value = serde_json::from_str(&body).map_err(text)?;
            let file_id = value.get("fileId").and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or("в метаданных вложения отсутствует fileId")?.to_string();
            let name = value.get("name").and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or("в метаданных вложения отсутствует имя")?.to_string();
            let mime_type = value.get("mimeType").and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or("в метаданных вложения отсутствует MIME type")?.to_string();
            let size = value.get("size").and_then(Value::as_u64)
                .filter(|size| *size > 0 && *size <= 50 * 1024 * 1024 - 16)
                .ok_or("в метаданных вложения некорректный размер")?;
            Ok(Incoming::Attachment { room_id, event_id, file_id, name, mime_type, size, mine })
        }
        "unreadable" => Ok(Incoming::Unreadable { room_id, event_id, mine }),
        _ => Err(format!("неизвестный тип локального сообщения: {kind}")),
    }
}

#[cfg(test)]
fn persist_incoming_record(meta: &mut Connection, incoming: &Incoming) -> Result<(), String> {
    let tx = meta.transaction().map_err(text)?;
    insert_incoming_record(&tx, incoming)?;
    tx.commit().map_err(text)
}

fn zeroize_json_value(value: &mut Value) {
    match value {
        Value::String(value) => value.zeroize(),
        Value::Array(values) => {
            for value in values {
                zeroize_json_value(value);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                zeroize_json_value(value);
            }
        }
        _ => {}
    }
}

fn request(agent: &ureq::Agent, base: &str, token: &str, method: &str, path: &str, mut body: Option<Value>) -> Result<Value, String> {
    let url = format!("{base}{path}");
    let mut req = agent.request(method, &url);
    if !token.is_empty() {
        let authorization = Zeroizing::new(format!("Bearer {}", &*token));
        req = req.set("authorization", authorization.as_str());
    }
    let res = match body.as_mut() {
        Some(value) => {
            let serialized = match serde_json::to_vec(value) {
                Ok(bytes) => Zeroizing::new(bytes),
                Err(error) => {
                    zeroize_json_value(value);
                    return Err(text(error));
                }
            };
            let result = req
                .set("content-type", "application/json")
                .send_bytes(serialized.as_slice());
            zeroize_json_value(value);
            result
        }
        None => req.call(),
    };
    match res {
        Ok(r) => r.into_json::<Value>().map_err(text),
        Err(ureq::Error::Status(code, r)) => Err(format!("{method} {path} -> {code} {}", r.into_string().unwrap_or_default())),
        Err(e) => Err(format!("сеть: {e}")),
    }
}

fn register(agent: &ureq::Agent, base: &str, user_id: &str, password: &str) -> Result<(), String> {
    match request(agent, base, "", "POST", "/register", Some(json!({ "userId": user_id, "password": password }))) {
        Ok(_) => Ok(()),
        Err(e) if e.contains("-> 409") => Ok(()),
        Err(e) => Err(e),
    }
}

/// Ключ базы устройства. Платформа хранит его в Keychain (iOS) или Keystore (Android); ядро его не сохраняет.
fn database_artifacts_exist(db_path: &str) -> bool {
    ["", "-wal", "-shm", "-journal"].iter().any(|suffix| {
        Path::new(&format!("{db_path}{suffix}")).exists()
    })
}

fn ensure_existing_key_matches_database(
    db_path: &str,
    scope: &str,
    keys: &dyn KeyStore,
) -> Result<bool, String> {
    let has_existing_key = keys.has_database_key(scope)?;
    if !has_existing_key && database_artifacts_exist(db_path) {
        return Err(
            "SQLCipher database exists but its protected key is missing; refusing to create a replacement key"
                .to_string(),
        );
    }
    Ok(has_existing_key)
}

fn remove_database_artifacts(db_path: &str) -> Result<(), String> {
    let mut errors = Vec::new();
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = format!("{db_path}{suffix}");
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!("remove {path}: {error}")),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn build_client_with_keys(
    agent: ureq::Agent,
    base: &str,
    tokens: (String, String),
    user_id: &str,
    device_id: &str,
    db_path: &str,
    keys: &dyn KeyStore,
) -> Result<Client, String> {
    let scope = format!("{user_id}/{device_id}");
    let tokens = SessionTokens(tokens.0, tokens.1);
    let has_existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let database_existed = database_artifacts_exist(db_path);
    let db_key = Zeroizing::new(match keys.database_key(&scope) {
        Ok(key) => key,
        Err(error) => {
            if !has_existing_key && !database_existed {
                if let Err(cleanup_error) = keys.delete_database_key(&scope) {
                    return Err(format!("{error}; cleanup of partially created key failed: {cleanup_error}"));
                }
            }
            return Err(error);
        }
    });
    let result = build_client(agent, base, tokens, user_id, device_id, db_path, &db_key);
    match result {
        Ok(client) => Ok(client),
        Err(error) if !has_existing_key && !database_existed => {
            let database_cleanup = remove_database_artifacts(db_path);
            let key_cleanup = keys.delete_database_key(&scope);
            let cleanup_errors: Vec<String> = [database_cleanup.err(), key_cleanup.err()]
                .into_iter()
                .flatten()
                .collect();
            if cleanup_errors.is_empty() {
                Err(error)
            } else {
                Err(format!(
                    "{error}; cleanup of partially created MLS session failed: {}",
                    cleanup_errors.join("; ")
                ))
            }
        }
        Err(error) => Err(error),
    }
}

pub trait KeyStore: Send + Sync {
    /// Checks for an existing key without returning key material.
    fn has_database_key(&self, scope: &str) -> Result<bool, String>;

    /// Loads an existing key without creating or replacing one.
    fn existing_database_key(&self, scope: &str) -> Result<Option<[u8; 32]>, String>;

    /// Loads an existing key or creates one for a new encrypted database.
    fn database_key(&self, scope: &str) -> Result<[u8; 32], String>;

    /// Removes the platform-protected key after the encrypted database is deleted.
    fn delete_database_key(&self, scope: &str) -> Result<(), String>;
}

/// Хранилище ключей в памяти: для тестов. Для выпуска нужно хранилище платформы.
#[derive(Default)]
pub struct MemoryKeyStore {
    keys: std::sync::Mutex<HashMap<String, [u8; 32]>>,
}

impl Drop for MemoryKeyStore {
    fn drop(&mut self) {
        let keys = match self.keys.get_mut() {
            Ok(keys) => keys,
            Err(poisoned) => poisoned.into_inner(),
        };
        for key in keys.values_mut() {
            key.zeroize();
        }
    }
}

impl KeyStore for MemoryKeyStore {
    fn has_database_key(&self, scope: &str) -> Result<bool, String> {
        Ok(self.keys.lock().map_err(text)?.contains_key(scope))
    }

    fn existing_database_key(&self, scope: &str) -> Result<Option<[u8; 32]>, String> {
        Ok(self.keys.lock().map_err(text)?.get(scope).copied())
    }

    fn database_key(&self, scope: &str) -> Result<[u8; 32], String> {
        let mut keys = self.keys.lock().map_err(text)?;
        if let Some(key) = keys.get(scope) {
            return Ok(*key);
        }
        let key = RustCrypto::default().random_array::<32>().map_err(text)?;
        keys.insert(scope.to_string(), key);
        Ok(key)
    }

    fn delete_database_key(&self, scope: &str) -> Result<(), String> {
        if let Some(mut key) = self.keys.lock().map_err(text)?.remove(scope) {
            key.zeroize();
        }
        Ok(())
    }
}

/// Ошибка временная (нет сети, 429, 5xx): её имеет смысл повторить позже.
pub fn is_not_member_error(err: &str) -> bool {
    err.contains("not a member")
        || response_error_code(err).as_deref() == Some("not_a_member")
}

fn is_access_failure(err: &str) -> bool {
    let Some(pos) = err.find(" -> ") else {
        return false;
    };
    let code: String = err[pos + 4..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    matches!(code.parse::<u16>(), Ok(401 | 403 | 404))
}

/// Returns whether an MLS transport error is safe to retry.
pub fn is_retryable(err: &str) -> bool {
    if err.starts_with("сеть:") {
        return true;
    }
    if let Some(pos) = err.find(" -> ") {
        let code: String = err[pos + 4..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(code) = code.parse::<u16>() {
            return code == 429 || (500..600).contains(&code);
        }
    }
    false
}

const MAX_BACKOFF: Duration = Duration::from_secs(300);

/// Повторяет операцию при временных ошибках: паузы удваиваются, но не больше пяти минут.
pub fn with_retry<T>(attempts: u32, base: Duration, mut op: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    let mut delay = base;
    let mut attempt = 1;
    loop {
        match op() {
            Ok(value) => return Ok(value),
            Err(e) if attempt < attempts && is_retryable(&e) => {
                std::thread::sleep(delay);
                delay = (delay * 2).min(MAX_BACKOFF);
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Вход первого устройства аккаунта (или устройства, которое уже подтверждено).
pub fn connect(
    base: &str,
    user_id: &str,
    password: &str,
    device_id: &str,
    db_path: &str,
    keys: &dyn KeyStore,
) -> Result<Client, String> {
    let base = normalize_base_url(base)?;
    let scope = format!("{user_id}/{device_id}");
    let _has_existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    register(&agent, &base, user_id, password)?;
    let mut login = request(
        &agent,
        &base,
        "",
        "POST",
        "/login",
        Some(json!({ "userId": user_id, "password": password, "deviceId": device_id })),
    )?;
    let tokens_result = (|| -> Result<(String, String), String> {
        let access = Zeroizing::new(
            login["token"]
                .as_str()
                .ok_or("сервер не вернул токен: нужно подтверждение с другого устройства")?
                .to_string(),
        );
        let refresh = Zeroizing::new(
            login["refreshToken"]
                .as_str()
                .ok_or("сервер не вернул токен обновления")?
                .to_string(),
        );
        Ok((access.to_string(), refresh.to_string()))
    })();
    zeroize_json_value(&mut login);
    let tokens = tokens_result?;
    build_client_with_keys(agent, &base, tokens, user_id, device_id, db_path, keys)
}

/// Подключает постоянный MLS-клиент к уже созданной мобильной сессии.
///
/// Flutter передаёт пару токенов один раз после успешного входа. Refresh token
/// остаётся внутри Rust-клиента и никогда не возвращается через API snapshot.
pub fn connect_with_session(
    base: &str,
    user_id: &str,
    device_id: &str,
    access_token: &str,
    refresh_token: &str,
    db_path: &str,
    keys: &dyn KeyStore,
) -> Result<Client, String> {
    if user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("user_id и device_id обязательны".to_string());
    }
    let base = normalize_base_url(base)?;
    if access_token.is_empty() || refresh_token.is_empty() {
        return Err("для подключения нужны access и refresh tokens".to_string());
    }
    let scope = format!("{user_id}/{device_id}");
    let _has_existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    build_client_with_keys(
        agent,
        &base,
        (access_token.to_string(), refresh_token.to_string()),
        user_id,
        device_id,
        db_path,
        keys,
    )
}

/// Восстанавливает MLS-сессию из SQLCipher без повторной передачи refresh token
/// из Flutter. Пара токенов читается только внутри Rust.
pub fn resume_with_session(
    base: &str,
    user_id: &str,
    device_id: &str,
    db_path: &str,
    keys: &dyn KeyStore,
) -> Result<Client, String> {
    if user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("user_id и device_id обязательны".to_string());
    }
    let base = normalize_base_url(base)?;
    if !Path::new(db_path).is_file() {
        return Err("сохранённая MLS-сессия не найдена на этом устройстве".to_string());
    }
    let db_key = Zeroizing::new(
        keys.existing_database_key(&format!("{user_id}/{device_id}"))?
            .ok_or_else(|| {
                "ключ SQLCipher сохранённой MLS-сессии отсутствует; создание нового ключа запрещено"
                    .to_string()
            })?,
    );
    (|| -> Result<Client, String> {
        let meta = open_db(db_path, &db_key)?;
        let has_meta: bool = meta
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'client_meta')",
                [],
                |row| row.get(0),
            )
            .map_err(text)?;
        if !has_meta {
            return Err("в базе нет сохранённой MLS-сессии".to_string());
        }
        let serialized: Zeroizing<Vec<u8>> = Zeroizing::new(
            meta.query_row(
                "SELECT value FROM client_meta WHERE key = 'session_tokens'",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .map_err(|_| "в базе нет сохранённой MLS-сессии; выполните вход заново".to_string())?,
        );
        drop(meta);
        let (access, refresh): (String, String) = serde_json::from_slice(serialized.as_slice())
            .map_err(|_| "сохранённая сессия повреждена; выполните вход заново".to_string())?;
        let tokens = SessionTokens(access, refresh);
        if tokens.0.is_empty() || tokens.1.is_empty() {
            return Err("сохранённая сессия неполная; выполните вход заново".to_string());
        }
        let agent = ureq::AgentBuilder::new().redirects(0).build();
        build_client(
            agent,
            &base,
            tokens,
            user_id,
            device_id,
            db_path,
            &db_key,
        )
    })()
}

/// Вход нового устройства аккаунта: подтверждается существующим устройством `approver`.
pub fn connect_with_approval(
    base: &str,
    user_id: &str,
    password: &str,
    device_id: &str,
    db_path: &str,
    keys: &dyn KeyStore,
    approver: &Client,
) -> Result<Client, String> {
    let base = normalize_base_url(base)?;
    let scope = format!("{user_id}/{device_id}");
    let _has_existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    register(&agent, &base, user_id, password)?;
    let mut login = request(
        &agent,
        &base,
        "",
        "POST",
        "/login",
        Some(json!({
            "userId": user_id,
            "password": password,
            "deviceId": device_id,
            "label": device_id,
            "platform": "mobile"
        })),
    )?;

    let tokens_result = (|| -> Result<(String, String), String> {
        if let Some(access) = login["token"].as_str() {
            let refresh = login["refreshToken"]
                .as_str()
                .ok_or("сервер не вернул токен обновления")?;
            let access = Zeroizing::new(access.to_string());
            let refresh = Zeroizing::new(refresh.to_string());
            return Ok((access.to_string(), refresh.to_string()));
        }

        let approval_id = Zeroizing::new(
            login["approvalId"]
                .as_str()
                .ok_or("сервер не вернул запрос подтверждения")?
                .to_string(),
        );
        let code = Zeroizing::new(
            login["code"]
                .as_str()
                .ok_or("нет кода подтверждения")?
                .to_string(),
        );
        let poll = Zeroizing::new(
            login["pollSecret"]
                .as_str()
                .ok_or("нет секрета опроса")?
                .to_string(),
        );

        approver.call(
            "POST",
            &format!(
                "/approvals/{}/approve",
                urlencoding::encode(approval_id.as_str())
            ),
            Some(json!({ "code": code.as_str() })),
        )?;

        for _ in 0..5 {
            let mut claim = request(
                &agent,
                &base,
                "",
                "POST",
                &format!(
                    "/approvals/{}/claim",
                    urlencoding::encode(approval_id.as_str())
                ),
                Some(json!({ "pollSecret": poll.as_str() })),
            )?;

            let claim_status = claim["status"].as_str().map(str::to_owned);
            match claim_status.as_deref() {
                Some("approved") => {
                    let pair = (
                        claim["token"]
                            .as_str()
                            .map(|value| Zeroizing::new(value.to_string())),
                        claim["refreshToken"]
                            .as_str()
                            .map(|value| Zeroizing::new(value.to_string())),
                    );
                    zeroize_json_value(&mut claim);
                    let (access, refresh) = pair;
                    let access = access.ok_or("сервер не вернул токен")?;
                    let refresh = refresh.ok_or("сервер не вернул токен обновления")?;
                    return Ok((access.to_string(), refresh.to_string()));
                }
                Some("pending") => {
                    zeroize_json_value(&mut claim);
                }
                other => {
                    zeroize_json_value(&mut claim);
                    return Err(format!("вход отклонён: {other:?}"));
                }
            }
        }
        Err("подтверждение входа не пришло".to_string())
    })();

    zeroize_json_value(&mut login);
    let tokens = tokens_result?;
    build_client_with_keys(agent, &base, tokens, user_id, device_id, db_path, keys)
}

fn build_client(agent: ureq::Agent, base: &str, tokens: SessionTokens, user_id: &str, device_id: &str, db_path: &str, db_key: &[u8; 32]) -> Result<Client, String> {
    let mut meta = open_db(db_path, db_key)?;
    {
        let mut storage = SqliteStorageProvider::<JsonCodec, &mut Connection>::new(&mut meta);
        storage.run_migrations().map_err(text)?;
    }
    meta.execute_batch(
        "CREATE TABLE IF NOT EXISTS client_meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
         CREATE TABLE IF NOT EXISTS client_rooms (room_id TEXT PRIMARY KEY, join_epoch INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS client_welcomes (welcome_id INTEGER PRIMARY KEY, room_id TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS client_welcome_receipts (
           welcome_id INTEGER PRIMARY KEY,
           room_id TEXT NOT NULL,
           welcome BLOB NOT NULL,
           outcome TEXT NOT NULL CHECK (outcome IN ('joined', 'quarantined')),
           reason TEXT,
           created_at INTEGER NOT NULL,
           acked_at INTEGER
         );
         CREATE TABLE IF NOT EXISTS client_desync (room_id TEXT PRIMARY KEY, reason TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS client_waiting_for_commit (
           room_id TEXT PRIMARY KEY,
           expected_epoch INTEGER NOT NULL,
           event_ids TEXT NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS client_commit_quarantine (
           room_id TEXT NOT NULL,
           epoch INTEGER NOT NULL,
           commit_hash TEXT NOT NULL,
           reason TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           PRIMARY KEY (room_id, epoch, commit_hash)
         );
         CREATE TABLE IF NOT EXISTS client_undecryptable (
           event_id TEXT PRIMARY KEY,
           room_id TEXT NOT NULL,
           reason TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS client_key_package_claims (
           room_id TEXT NOT NULL,
           user_id TEXT NOT NULL,
           claim_id TEXT NOT NULL,
           PRIMARY KEY (room_id, user_id)
         );
         CREATE TABLE IF NOT EXISTS client_membership_commits (
           operation_id TEXT PRIMARY KEY,
           room_id TEXT NOT NULL,
           base_epoch INTEGER NOT NULL,
           fingerprint TEXT NOT NULL,
           payload TEXT NOT NULL,
           claim_ids TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE UNIQUE INDEX IF NOT EXISTS client_membership_commits_one_per_room
           ON client_membership_commits (room_id);
         CREATE TABLE IF NOT EXISTS client_invite_intents (
           operation_id TEXT PRIMARY KEY,
           room_id TEXT NOT NULL,
           target_user_id TEXT NOT NULL,
           state TEXT NOT NULL CHECK (state IN ('claim_pending', 'commit_pending')),
           created_at INTEGER NOT NULL,
           UNIQUE (room_id, target_user_id)
         );
         CREATE TABLE IF NOT EXISTS client_processed (event_id TEXT PRIMARY KEY);
         CREATE TABLE IF NOT EXISTS client_inbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT, acknowledged INTEGER NOT NULL DEFAULT 0, client_message_id TEXT);
         CREATE TABLE IF NOT EXISTS client_outbox (local_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, body TEXT NOT NULL, seq INTEGER NOT NULL, mls_message BLOB, mls_epoch INTEGER);
          CREATE TABLE IF NOT EXISTS client_attachments (
            file_id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            event_id TEXT NOT NULL UNIQUE,
            manifest BLOB NOT NULL,
            direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
             client_message_id TEXT,
            created_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS client_attachment_outbox (
            client_message_id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            manifest BLOB NOT NULL,
            ciphertext_sha256 TEXT NOT NULL,
            ciphertext_size INTEGER NOT NULL,
            uploaded INTEGER NOT NULL DEFAULT 0,
            mls_message BLOB,
            mls_epoch INTEGER
          );
         CREATE TABLE IF NOT EXISTS client_remote_config (id INTEGER PRIMARY KEY CHECK (id = 1), etag TEXT NOT NULL, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);",
    )
    .map_err(text)?;
    let inbox_columns = {
        let mut statement = meta.prepare("PRAGMA table_info(client_inbox)").map_err(text)?;
        let rows = statement.query_map([], |row| row.get::<_, String>(1)).map_err(text)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(text)?
    };
    if !inbox_columns.iter().any(|column| column == "client_message_id") {
        meta.execute("ALTER TABLE client_inbox ADD COLUMN client_message_id TEXT", [])
            .map_err(text)?;
    }
    meta.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS client_inbox_client_message_id
         ON client_inbox (client_message_id) WHERE client_message_id IS NOT NULL",
        [],
    ).map_err(text)?;
    let text_outbox_columns = {
        let mut statement = meta.prepare("PRAGMA table_info(client_outbox)").map_err(text)?;
        let rows = statement.query_map([], |row| row.get::<_, String>(1)).map_err(text)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(text)?
    };
    if !text_outbox_columns.iter().any(|column| column == "mls_message") {
        meta.execute("ALTER TABLE client_outbox ADD COLUMN mls_message BLOB", [])
            .map_err(text)?;
    }
    if !text_outbox_columns.iter().any(|column| column == "mls_epoch") {
        meta.execute("ALTER TABLE client_outbox ADD COLUMN mls_epoch INTEGER", [])
            .map_err(text)?;
    }
     let has_client_message_id = {
         let mut statement = meta.prepare("PRAGMA table_info(client_attachments)").map_err(text)?;
         let columns = statement.query_map([], |row| row.get::<_, String>(1)).map_err(text)?;
         columns.collect::<Result<Vec<_>, _>>().map_err(text)?
             .iter().any(|column| column == "client_message_id")
     };
     if !has_client_message_id {
         meta.execute("ALTER TABLE client_attachments ADD COLUMN client_message_id TEXT", [])
             .map_err(text)?;
     }
     let outbox_columns = {
         let mut statement = meta.prepare("PRAGMA table_info(client_attachment_outbox)").map_err(text)?;
         let columns = statement.query_map([], |row| row.get::<_, String>(1)).map_err(text)?;
         columns.collect::<Result<Vec<_>, _>>().map_err(text)?
     };
     if !outbox_columns.iter().any(|column| column == "mls_message") {
         meta.execute("ALTER TABLE client_attachment_outbox ADD COLUMN mls_message BLOB", [])
             .map_err(text)?;
     }
     if !outbox_columns.iter().any(|column| column == "mls_epoch") {
         meta.execute("ALTER TABLE client_attachment_outbox ADD COLUMN mls_epoch INTEGER", [])
             .map_err(text)?;
     }
     meta.execute(
         "CREATE UNIQUE INDEX IF NOT EXISTS client_attachments_client_message_id
          ON client_attachments (client_message_id) WHERE client_message_id IS NOT NULL",
         [],
     ).map_err(text)?;
    let serialized_tokens = Zeroizing::new(
        serde_json::to_vec(&(&tokens.0, &tokens.1)).map_err(text)?,
    );
    meta.execute(
        "INSERT OR REPLACE INTO client_meta (key, value) VALUES ('session_tokens', ?1)",
        [serialized_tokens.as_slice()],
    )
    .map_err(text)?;

    let crypto = RustCrypto::default();
    let provider = DeviceProvider::new(&crypto, &meta);
    let stored_public: Option<Vec<u8>> = meta
        .query_row("SELECT value FROM client_meta WHERE key = 'signer_public'", [], |r| r.get(0))
        .ok();
    let signer = match stored_public {
        Some(public) => SignatureKeyPair::read(provider.storage(), &public, CIPHERSUITE.signature_algorithm())
            .ok_or("ключ подписи устройства не найден в базе")?,
        None => {
            let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(text)?;
            signer.store(provider.storage()).map_err(text)?;
            meta.execute("INSERT INTO client_meta (key, value) VALUES ('signer_public', ?1)", [signer.to_public_vec()]).map_err(text)?;
            signer
        }
    };
    let credential = CredentialWithKey {
        credential: BasicCredential::new(format!("{user_id}/{device_id}").into_bytes()).into(),
        signature_key: signer.to_public_vec().into(),
    };

    let mut groups = HashMap::new();
    let mut stmt = meta.prepare("SELECT room_id, join_epoch FROM client_rooms").map_err(text)?;
    let rows: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(text)?
        .collect::<Result<_, _>>()
        .map_err(text)?;
    drop(stmt);
    for (room_id, join_epoch) in rows {
        let mls = MlsGroup::load(provider.storage(), &GroupId::from_slice(room_id.as_bytes()))
            .map_err(text)?
            .ok_or_else(|| format!("состояние группы {room_id} не найдено"))?;
        groups.insert(room_id, Group { mls, join_epoch: join_epoch as u64 });
    }
    drop(provider);

    let mut processed = HashSet::new();
    let mut stmt = meta.prepare("SELECT event_id FROM client_processed").map_err(text)?;
    for id in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(text)? {
        processed.insert(id.map_err(text)?);
    }
    drop(stmt);

    Ok(Client {
        base: base.to_string(),
        tokens: Mutex::new(tokens),
        user_id: user_id.to_string(),
        device_id: device_id.to_string(),
        agent,
        crypto,
        meta,
        signer,
        credential,
        groups,
        processed,
    })
}

impl Client {
    /// Вызов API. Если токен доступа истёк, токен обновляется и запрос повторяется один раз.
    fn provider(&self) -> DeviceProvider<'_, &Connection> {
        DeviceProvider::new(&self.crypto, &self.meta)
    }

    fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        match self.call_once(method, path, body.clone()) {
            Err(e) if e.contains("token_expired") => {
                self.renew()?;
                self.call_once(method, path, body)
            }
            other => other,
        }
    }

    fn call_once(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        let token = Zeroizing::new(self.tokens.lock().map_err(text)?.0.clone());
        request(&self.agent, &self.base, &token, method, path, body)
    }

    fn same_origin_url(&self, raw_url: &str) -> Result<Url, String> {
        let base = Url::parse(&self.base).map_err(text)?;
        let target = Url::parse(raw_url).map_err(text)?;
        if base.origin() != target.origin()
            || !target.username().is_empty()
            || target.password().is_some()
            || target.fragment().is_some()
        {
            return Err("signed file URL must remain on the authenticated API origin".to_string());
        }
        Ok(target)
    }

    /// Upload capability URLs are unauthenticated and never receive the bearer token.
    fn upload_signed_bytes(&self, raw_url: &str, ciphertext: &[u8]) -> Result<(), String> {
        let url = self.same_origin_url(raw_url)?;
        match self.agent
            .put(url.as_str())
            .set("content-type", "application/octet-stream")
            .send_bytes(ciphertext)
        {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(code, response)) => Err(format!(
                "signed upload -> {code} {}",
                response.into_string().unwrap_or_default()
            )),
            Err(error) => Err(format!("сеть: {error}")),
        }
    }

    /// Download capability URLs are bound to this device and require its active bearer token.
    fn download_signed_bytes(&self, raw_url: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        let url = self.same_origin_url(raw_url)?;
        for attempt in 0..2 {
            let token = Zeroizing::new(self.tokens.lock().map_err(text)?.0.clone());
            let authorization = Zeroizing::new(format!("Bearer {}", token.as_str()));
            let response = self.agent.get(url.as_str())
                .set("authorization", authorization.as_str())
                .call();
            match response {
                Ok(response) => {
                    let mut bytes = Vec::new();
                    response.into_reader()
                        .take(max_bytes.saturating_add(1))
                        .read_to_end(&mut bytes)
                        .map_err(text)?;
                    if bytes.len() as u64 > max_bytes {
                        return Err("signed file download exceeded the manifest ciphertext size".to_string());
                    }
                    return Ok(bytes);
                }
                Err(ureq::Error::Status(401, response)) if attempt == 0 => {
                    let _ = response.into_string();
                    self.renew()?;
                }
                Err(ureq::Error::Status(code, response)) => {
                    return Err(format!(
                        "signed download -> {code} {}",
                        response.into_string().unwrap_or_default()
                    ));
                }
                Err(error) => return Err(format!("сеть: {error}")),
            }
        }
        Err("signed download remained unauthorized after token refresh".to_string())
    }

    fn reserve_attachment_upload(
        &self,
        room_id: &str,
        ciphertext: &[u8],
    ) -> Result<(String, String), String> {
        let response = self.call(
            "POST",
            "/files",
            Some(json!({
                "kind": "file",
                "size": ciphertext.len(),
                "sha256": attachment_crypto::sha256_hex(ciphertext),
                "roomId": room_id,
            })),
        )?;
        let file_id = response.get("fileId").and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or("file reservation did not return fileId")?.to_string();
        let upload_url = response.get("uploadUrl").and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or("file reservation did not return uploadUrl")?.to_string();
        self.same_origin_url(&upload_url)?;
        Ok((file_id, upload_url))
    }

    /// Новая пара по токену обновления. Старый токен обновления после этого не принимается.
    fn renew(&self) -> Result<(), String> {
        // Держим блокировку до завершения ротации: два параллельных 401
        // не должны потратить один refresh token дважды.
        let mut tokens = self.tokens.lock().map_err(text)?;
        let refresh = Zeroizing::new(tokens.1.clone());
        let mut response = request(
            &self.agent,
            &self.base,
            "",
            "POST",
            "/token/refresh",
            Some(json!({ "refreshToken": refresh.as_str() })),
        )?;
        let next_pair_result = (|| -> Result<SessionTokens, String> {
            Ok(SessionTokens(
                response["token"].as_str().ok_or("сервер не вернул токен")?.to_string(),
                response["refreshToken"].as_str().ok_or("сервер не вернул токен обновления")?.to_string(),
            ))
        })();
        zeroize_json_value(&mut response);
        let next_pair = next_pair_result?;
        // Одна SQL-операция заменяет пару целиком; память обновляем только
        // после успешной записи, чтобы не потерять действующий refresh token.
        let serialized = Zeroizing::new(
            serde_json::to_vec(&(&next_pair.0, &next_pair.1)).map_err(text)?,
        );
        self.meta
            .execute(
                "INSERT OR REPLACE INTO client_meta (key, value) VALUES ('session_tokens', ?1)",
                [serialized.as_slice()],
            )
            .map_err(text)?;
        *tokens = next_pair;
        Ok(())
    }

    /// Выход: локальные credentials очищаются даже при недоступности сервера.
    pub fn logout(&self) -> Result<(), String> {
        let server_result = match self.call("POST", "/logout", Some(json!({}))) {
            Ok(mut response) => {
                zeroize_json_value(&mut response);
                Ok(())
            }
            Err(error) => Err(error),
        };

        // Never keep a refresh token in the encrypted database merely because
        // the server could not be reached during logout.
        let local_result = self
            .meta
            .execute("DELETE FROM client_meta WHERE key = 'session_tokens'", [])
            .map(|_| ())
            .map_err(text);

        let empty_tokens = SessionTokens(String::new(), String::new());
        match self.tokens.lock() {
            Ok(mut tokens) => *tokens = empty_tokens,
            Err(poisoned) => *poisoned.into_inner() = empty_tokens,
        }

        match (server_result, local_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(server), Ok(())) => Err(format!(
                "ошибка выхода на сервере; локальные токены очищены: {server}"
            )),
            (Ok(()), Err(local)) => Err(format!(
                "выход на сервере выполнен; не удалось удалить локальные токены: {local}"
            )),
            (Err(server), Err(local)) => Err(format!(
                "ошибка выхода на сервере: {server}; не удалось удалить локальные токены: {local}"
            )),
        }
    }

    /// Идентификатор этого устройства на сервере.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// Краткоживущий access token для обычного HTTP-клиента Flutter.
    /// Refresh token остаётся в Rust и этим методом не раскрывается.
    pub fn access_token_snapshot(&self) -> Result<String, String> {
        self.tokens.lock().map(|tokens| tokens.0.clone()).map_err(text)
    }

    /// Принудительно обновляет сессию и возвращает новый access token snapshot.
    pub fn refresh_session(&self) -> Result<String, String> {
        self.renew()?;
        self.access_token_snapshot()
    }


    fn mark_processed(&mut self, event_id: &str) -> Result<(), String> {
        self.meta.execute("INSERT OR IGNORE INTO client_processed (event_id) VALUES (?1)", [event_id]).map_err(text)?;
        self.processed.insert(event_id.to_string());
        Ok(())
    }

    fn reload_group(&mut self, room_id: &str) -> Result<(), String> {
        let provider = self.provider();
        let mls = MlsGroup::load(provider.storage(), &GroupId::from_slice(room_id.as_bytes()))
            .map_err(text)?
            .ok_or_else(|| format!("состояние группы {room_id} не найдено после rollback"))?;
        let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
        group.mls = mls;
        Ok(())
    }

    fn merge_local_pending_commit(&mut self, room_id: &str) -> Result<(), String> {
        let transaction = self.meta.transaction().map_err(text)?;
        let result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            group.mls.merge_pending_commit(&provider).map_err(text)
        };
        match result {
            Ok(()) => match transaction.commit() {
                Ok(()) => Ok(()),
                Err(error) => {
                    self.reload_group(room_id)?;
                    Err(text(error))
                }
            },
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                Err(error)
            }
        }
    }

    fn clear_local_pending_commit(&mut self, room_id: &str) -> Result<(), String> {
        let transaction = self.meta.transaction().map_err(text)?;
        let result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            group.mls.clear_pending_commit(provider.storage()).map_err(text)
        };
        match result {
            Ok(()) => match transaction.commit() {
                Ok(()) => Ok(()),
                Err(error) => {
                    self.reload_group(room_id)?;
                    Err(text(error))
                }
            },
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                Err(error)
            }
        }
    }

    /// Processes and merges a server commit within one SQLCipher transaction.
    /// On any error, the in-memory group is reloaded after rollback.
    fn process_and_merge_commit(
        &mut self,
        room_id: &str,
        commit_epoch: u64,
        bytes: &[u8],
        metadata: &Value,
    ) -> Result<(), String> {
        enum CommitFailure {
            Transient(String),
            Permanent(String),
        }

        let protocol = match MlsMessageIn::tls_deserialize_exact(bytes)
            .map_err(text)
            .and_then(|message| message.try_into_protocol_message().map_err(text))
        {
            Ok(protocol) => protocol,
            Err(error) => {
                let reason = format!("Commit encoding is invalid: {error}");
                self.quarantine_commit(room_id, commit_epoch, bytes, &reason)?;
                self.record_desync(room_id, &reason)?;
                return Err(format!("RecoveryRequired: {reason}"));
            }
        };

        let transaction = self.meta.transaction().map_err(text)?;
        let result: Result<(), CommitFailure> = (|| {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or_else(|| {
                CommitFailure::Transient("комната не создана на этом устройстве".to_string())
            })?;
            match group.mls.process_message(&provider, protocol) {
                Ok(processed) => match processed.into_content() {
                    ProcessedMessageContent::StagedCommitMessage(staged) => {
                        if !metadata["changes"].is_null() {
                            verify_staged_membership_metadata(&group.mls, &staged, metadata)
                                .map_err(CommitFailure::Permanent)?;
                        }
                        group.mls.merge_staged_commit(&provider, *staged)
                            .map_err(|error| CommitFailure::Transient(text(error)))
                    }
                    _ => Err(CommitFailure::Permanent(
                        "серверная запись не является MLS StagedCommit".to_string(),
                    )),
                },
                Err(error) => match classify_process_error(&error) {
                    Failure::Transient => Err(CommitFailure::Transient(text(error))),
                    Failure::Permanent(classification) => Err(CommitFailure::Permanent(
                        format!("{classification}: {error}"),
                    )),
                },
            }
        })();

        match result {
            Ok(()) => {
                if let Err(error) = transaction.commit() {
                    self.reload_group(room_id)?;
                    return Err(format!(
                        "временная ошибка локального хранилища при фиксации Commit: {}",
                        text(error)
                    ));
                }
                Ok(())
            }
            Err(CommitFailure::Transient(error)) => {
                drop(transaction);
                self.reload_group(room_id)?;
                Err(format!("временная ошибка обработки Commit, повтор позже: {error}"))
            }
            Err(CommitFailure::Permanent(reason)) => {
                drop(transaction);
                self.reload_group(room_id)?;
                self.quarantine_commit(room_id, commit_epoch, bytes, &reason)?;
                self.record_desync(room_id, &reason)?;
                Err(format!("RecoveryRequired: {reason}"))
            }
        }
    }


    /// Processes an MLS application event and persists the OpenMLS ratchet state,
    /// inbox row and processed marker in the same SQLCipher transaction.
    fn persist_unreadable(
        &mut self,
        room_id: &str,
        event_id: &str,
        reason: &str,
    ) -> Result<Incoming, String> {
        let incoming = Incoming::Unreadable {
            room_id: room_id.to_string(),
            event_id: event_id.to_string(),
            mine: false,
        };
        let transaction = self.meta.transaction().map_err(text)?;
        insert_incoming_record(&transaction, &incoming)?;
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        transaction.execute(
            "INSERT OR IGNORE INTO client_undecryptable (event_id, room_id, reason, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![event_id, room_id, reason, created_at],
        ).map_err(text)?;
        transaction.commit().map_err(text)?;
        self.processed.insert(event_id.to_string());
        Ok(incoming)
    }

    pub fn undecryptable(&self) -> Result<Vec<(String, String, String)>, String> {
        let mut statement = self.meta.prepare(
            "SELECT event_id, room_id, reason FROM client_undecryptable ORDER BY created_at, event_id",
        ).map_err(text)?;
        let rows = statement.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        }).map_err(text)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(text)
    }

    fn process_and_persist_incoming(
        &mut self,
        room_id: &str,
        event_id: &str,
        bytes: &[u8],
        outer_file_id: Option<&str>,
    ) -> Result<Incoming, String> {
        let protocol = match MlsMessageIn::tls_deserialize_exact(bytes)
            .map_err(text)
            .and_then(|message| message.try_into_protocol_message().map_err(text))
        {
            Ok(protocol) => protocol,
            Err(error) => {
                return self.persist_unreadable(
                    room_id,
                    event_id,
                    &format!("MLS protocol message is malformed: {error}"),
                );
            }
        };

        let transaction = self.meta.transaction().map_err(text)?;
        let incoming_result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            match group.mls.process_message(&provider, protocol) {
                Ok(processed) => {
                    let (incoming, unreadable_reason, manifest_payload) = match processed.into_content() {
                        ProcessedMessageContent::ApplicationMessage(app) => {
                            let app_bytes = Zeroizing::new(app.into_bytes());
                            if let Some(file_id) = outer_file_id {
                                match attachment_crypto::parse_manifest(&app_bytes, file_id, room_id) {
                                    Ok(manifest) => (
                                        Incoming::Attachment {
                                            room_id: room_id.to_string(),
                                            event_id: event_id.to_string(),
                                            file_id: manifest.file_id.clone(),
                                            name: manifest.name.clone(),
                                            mime_type: manifest.mime_type.clone(),
                                            size: manifest.size,
                                            mine: false,
                                        },
                                        None,
                                        Some(Zeroizing::new(app_bytes.to_vec())),
                                    ),
                                    Err(error) => (
                                        Incoming::Unreadable {
                                            room_id: room_id.to_string(),
                                            event_id: event_id.to_string(),
                                            mine: false,
                                        },
                                        Some(format!("invalid MLS attachment manifest: {error}")),
                                        None,
                                    ),
                                }
                            } else {
                                if attachment_crypto::is_attachment_manifest(&app_bytes) {
                                    (
                                        Incoming::Unreadable {
                                            room_id: room_id.to_string(),
                                            event_id: event_id.to_string(),
                                            mine: false,
                                        },
                                        Some("MLS attachment manifest is missing the outer file reference".to_string()),
                                        None,
                                    )
                                } else {
                                    match String::from_utf8(app_bytes.to_vec()) {
                                        Ok(text) => (
                                            Incoming::Text {
                                                room_id: room_id.to_string(),
                                                event_id: event_id.to_string(),
                                                text,
                                                mine: false,
                                            },
                                            None,
                                            None,
                                        ),
                                        Err(_) => (
                                            Incoming::Unreadable {
                                                room_id: room_id.to_string(),
                                                event_id: event_id.to_string(),
                                                mine: false,
                                            },
                                            Some("application payload is not valid UTF-8".to_string()),
                                            None,
                                        ),
                                    }
                                }
                            }
                        }
                        _ => (
                            Incoming::Unreadable {
                                room_id: room_id.to_string(),
                                event_id: event_id.to_string(),
                                mine: false,
                            },
                            Some("MLS message is not an application message".to_string()),
                            None,
                        ),
                    };
                    Ok((incoming, unreadable_reason, manifest_payload))
                }
                Err(error) => Err(classify_process_error(&error)),
            }
        };

        match incoming_result {
            Ok((incoming, unreadable_reason, manifest_payload)) => {
                if let Err(error) = insert_incoming_record(&transaction, &incoming) {
                    drop(transaction);
                    self.reload_group(room_id)?;
                    return Err(error);
                }
                if let (Incoming::Attachment { file_id, .. }, Some(manifest)) =
                    (&incoming, manifest_payload.as_ref())
                {
                    let created_at = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    if let Err(error) = transaction.execute(
                        "INSERT OR IGNORE INTO client_attachments
                         (file_id, room_id, event_id, manifest, direction, created_at)
                         VALUES (?1, ?2, ?3, ?4, 'incoming', ?5)",
                        rusqlite::params![file_id, room_id, event_id, manifest.as_slice(), created_at],
                    ) {
                        drop(transaction);
                        self.reload_group(room_id)?;
                        return Err(text(error));
                    }
                    let stored: (String, String, Vec<u8>) = match transaction.query_row(
                        "SELECT room_id, event_id, manifest FROM client_attachments WHERE file_id = ?1",
                        [file_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    ) {
                        Ok(stored) => stored,
                        Err(error) => {
                            drop(transaction);
                            self.reload_group(room_id)?;
                            return Err(text(error));
                        }
                    };
                    if stored.0 != room_id || stored.1 != event_id || stored.2.as_slice() != manifest.as_slice() {
                        drop(transaction);
                        self.reload_group(room_id)?;
                        return Err("attachment fileId is already bound to a different room/event/manifest".to_string());
                    }
                }
                if let Some(reason) = unreadable_reason {
                    let created_at = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    if let Err(error) = transaction.execute(
                        "INSERT OR IGNORE INTO client_undecryptable (event_id, room_id, reason, created_at)
                         VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![event_id, room_id, reason, created_at],
                    ) {
                        drop(transaction);
                        self.reload_group(room_id)?;
                        return Err(text(error));
                    }
                }
                if let Err(error) = transaction.commit() {
                    self.reload_group(room_id)?;
                    return Err(text(error));
                }
                self.processed.insert(event_id.to_string());
                Ok(incoming)
            }
            Err(Failure::Transient) => {
                drop(transaction);
                self.reload_group(room_id)?;
                Err(format!("временная ошибка обработки MLS-события {event_id}; повтор позже"))
            }
            Err(Failure::Permanent(reason)) => {
                drop(transaction);
                self.reload_group(room_id)?;
                self.persist_unreadable(room_id, event_id, reason)
            }
        }
    }

    /// Публикует ключевые пакеты этого устройства (не больше 50 за раз).
    pub fn upload_key_packages(&mut self, count: usize) -> Result<(), String> {
        let provider = self.provider();
        let mut packages = Vec::with_capacity(count);
        for _ in 0..count {
            let bundle = KeyPackage::builder().build(CIPHERSUITE, &provider, &self.signer, self.credential.clone()).map_err(text)?;
            packages.push(B64.encode(bundle.key_package().tls_serialize_detached().map_err(text)?));
        }
        self.call("POST", "/mls/key-packages", Some(json!({ "packages": packages })))?;
        Ok(())
    }

    /// Публикует резервный ключевой пакет: им приглашают, когда обычные закончились.
    pub fn upload_last_resort(&mut self) -> Result<(), String> {
        let provider = self.provider();
        let bundle = KeyPackage::builder().build(CIPHERSUITE, &provider, &self.signer, self.credential.clone()).map_err(text)?;
        let package = B64.encode(bundle.key_package().tls_serialize_detached().map_err(text)?);
        self.call("POST", "/mls/key-packages/last-resort", Some(json!({ "package": package })))?;
        Ok(())
    }

    /// Сколько обычных ключевых пакетов осталось на сервере для этого устройства.
    pub fn available_key_packages(&self) -> Result<u64, String> {
        let r = self.call("GET", "/mls/key-packages/count", None)?;
        r["available"].as_u64().ok_or_else(|| "сервер не вернул счётчик".to_string())
    }

    /// Доводит запас обычных пакетов до `target` и обновляет резервный пакет.
    pub fn ensure_key_packages(&mut self, target: u64) -> Result<(), String> {
        let have = self.available_key_packages()?;
        if have < target {
            let need = (target - have).min(50) as usize;
            self.upload_key_packages(need)?;
        }
        self.upload_last_resort()
    }

    /// Создаёт комнату на сервере и группу MLS на этом устройстве (эпоха 0).
    pub fn create_room(&mut self, room_id: &str) -> Result<(), String> {
        self.ensure_writable()?;
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!("комната рассинхронизирована и требует восстановления: {reason}"));
        }
        self.call("POST", "/rooms", Some(json!({ "roomId": room_id, "members": [self.user_id] })))?;
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(MAX_PAST_EPOCHS)
            .build();
        let transaction = self.meta.transaction().map_err(text)?;
        let mls = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            MlsGroup::new_with_group_id(
                &provider,
                &self.signer,
                &config,
                GroupId::from_slice(room_id.as_bytes()),
                self.credential.clone(),
            )
            .map_err(text)?
        };
        transaction
            .execute(
                "INSERT OR REPLACE INTO client_rooms (room_id, join_epoch) VALUES (?1, 0)",
                [room_id],
            )
            .map_err(text)?;
        transaction.commit().map_err(text)?;
        self.groups.insert(room_id.to_string(), Group { mls, join_epoch: 0 });
        Ok(())
    }

    fn server_epoch(&self, room_id: &str) -> Result<u64, String> {
        let r = self.call("GET", &format!("/mls/groups/{}/epoch", urlencoding::encode(room_id)), None)?;
        r["epoch"].as_u64().ok_or_else(|| "сервер не вернул эпоху".to_string())
    }

    /// Приглашает пользователя: забирает его ключевые пакеты (все устройства), делает коммит и приветствия.
    fn ensure_invite_intent(
        &mut self,
        room_id: &str,
        user_id: &str,
    ) -> Result<(String, String), String> {
        let existing: Option<(String, String)> = self.meta
            .query_row(
                "SELECT operation_id, state FROM client_invite_intents WHERE room_id = ?1 AND target_user_id = ?2",
                rusqlite::params![room_id, user_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(text)?;
        if let Some(intent) = existing {
            return Ok(intent);
        }
        let operation_id = hex_encode(&self.crypto.random_vec(16).map_err(text)?);
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta.execute(
            "INSERT OR IGNORE INTO client_invite_intents (operation_id, room_id, target_user_id, state, created_at)
             VALUES (?1, ?2, ?3, 'claim_pending', ?4)",
            rusqlite::params![operation_id, room_id, user_id, created_at],
        ).map_err(text)?;
        self.meta.query_row(
            "SELECT operation_id, state FROM client_invite_intents WHERE room_id = ?1 AND target_user_id = ?2",
            rusqlite::params![room_id, user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(text)
    }

    fn resume_claim_pending_invite(
        &mut self,
        room_id: &str,
        user_id: &str,
        operation_id: &str,
    ) -> Result<bool, String> {
        let state: String = self.meta.query_row(
            "SELECT state FROM client_invite_intents WHERE operation_id = ?1",
            [operation_id],
            |row| row.get(0),
        ).map_err(text)?;
        if state != "claim_pending" {
            return Ok(false);
        }
        if self.desync_reason(room_id)?.is_some_and(|reason| reason.starts_with("RecoveryRequired:")) {
            return Ok(false);
        }
        let claimed = match self.call(
            "POST",
            &format!("/mls/key-packages/{}/claims", urlencoding::encode(user_id)),
            Some(json!({ "claimId": operation_id, "roomId": room_id })),
        ) {
            Ok(value) => value,
            Err(error) => {
                if matches!(
                    response_error_code(&error).as_deref(),
                    Some("claim_committed" | "claim_released" | "claim_room_mismatch")
                ) {
                    let reason = format!(
                        "invite intent {operation_id} conflicts with server reservation: {error}"
                    );
                    self.record_desync(room_id, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
                return Err(error);
            }
        };
        if claimed["claimId"].as_str() != Some(operation_id)
            || claimed["roomId"].as_str() != Some(room_id)
        {
            let reason = format!("server returned a different reservation identity for {operation_id}");
            self.record_desync(room_id, &reason)?;
            return Err(format!("RecoveryRequired: {reason}"));
        }
        let packages = claimed["packages"].as_array().ok_or("нет поля packages")?.clone();
        if packages.is_empty() {
            let released = self.call(
                "DELETE",
                &format!("/mls/key-packages/claims/{}", urlencoding::encode(operation_id)),
                None,
            )?;
            if released["released"].as_bool().is_none() {
                return Err("сервер не подтвердил release пустого KeyPackage claim".to_string());
            }
            self.meta.execute(
                "DELETE FROM client_invite_intents WHERE operation_id = ?1",
                [operation_id],
            ).map_err(text)?;
            return Err(format!("у {user_id} нет ключевых пакетов"));
        }

        let mut key_packages = Vec::with_capacity(packages.len());
        let mut devices = Vec::with_capacity(packages.len());
        for package in &packages {
            let encoded = package["package"].as_str().ok_or("пакет не строка")?;
            let bytes = B64.decode(encoded).map_err(text)?;
            let key_package = KeyPackageIn::tls_deserialize_exact(&bytes)
                .map_err(text)?
                .validate(&self.crypto, ProtocolVersion::Mls10)
                .map_err(text)?;
            key_packages.push(key_package);
            devices.push(package["deviceId"].as_str().ok_or("нет deviceId")?.to_string());
        }
        devices.sort();
        devices.dedup();

        let transaction = self.meta.transaction().map_err(text)?;
        let staged = (|| -> Result<(), String> {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            let base_epoch = group.mls.epoch().as_u64();
            let (_commit, welcome, _) = group.mls
                .add_members(&provider, &self.signer, &key_packages)
                .map_err(text)?;
            let welcome_bytes = welcome.tls_serialize_detached().map_err(text)?;
            let welcome_b64 = B64.encode(&welcome_bytes);
            let welcomes: Vec<Value> = devices.iter()
                .map(|device| json!({ "userId": user_id, "deviceId": device, "welcome": welcome_b64 }))
                .collect();
            let changes = json!({ "adds": [user_id], "removes": [], "removeDevices": [] });
            let recipients: Vec<Value> = devices.iter()
                .map(|device| json!({ "userId": user_id, "deviceId": device }))
                .collect();
            let payload = json!({
                "epoch": base_epoch,
                "commit": B64.encode(&_commit.tls_serialize_detached().map_err(text)?),
                "changes": changes,
                "welcomes": welcomes,
                "clientOperationId": operation_id,
                "keyPackageClaimId": operation_id,
            });
            let metadata = json!({ "changes": changes, "welcomeRecipients": recipients });
            let pending = group.mls.pending_commit()
                .ok_or("OpenMLS did not retain the staged membership commit")?;
            verify_staged_membership_metadata(&group.mls, pending, &metadata)?;
            let fingerprint = membership_commit_fingerprint(
                &self.crypto, room_id, operation_id, base_epoch, &payload, pending,
            )?;
            let claim_ids = serde_json::to_string(&vec![operation_id.to_string()]).map_err(text)?;
            let payload_json = serde_json::to_string(&payload).map_err(text)?;
            let created_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            transaction.execute(
                "INSERT INTO client_membership_commits
                 (operation_id, room_id, base_epoch, fingerprint, payload, claim_ids, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![operation_id, room_id, base_epoch as i64, fingerprint, payload_json, claim_ids, created_at],
            ).map_err(text)?;
            transaction.execute(
                "INSERT OR REPLACE INTO client_key_package_claims (room_id, user_id, claim_id)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![room_id, user_id, operation_id],
            ).map_err(text)?;
            transaction.execute(
                "UPDATE client_invite_intents SET state = 'commit_pending' WHERE operation_id = ?1",
                [operation_id],
            ).map_err(text)?;
            Ok(())
        })();
        if let Err(error) = staged {
            drop(transaction);
            self.reload_group(room_id)?;
            if error.starts_with("P0.2:") {
                self.record_desync(room_id, &error)?;
                return Err(format!("RecoveryRequired: {error}"));
            }
            return Err(error);
        }
        if let Err(error) = transaction.commit() {
            self.reload_group(room_id)?;
            return Err(format!("не удалось зафиксировать staged membership journal: {}", text(error)));
        }
        if self.flush_pending_membership_commits()? > 0 {
            let mut incoming = Vec::new();
            self.sync_room(room_id, &mut incoming)?;
            return Ok(false);
        }
        Ok(true)
    }

    fn resume_claim_pending_invites(&mut self) -> Result<(), String> {
        let intents: Vec<(String, String, String)> = {
            let mut statement = self.meta.prepare(
                "SELECT operation_id, room_id, target_user_id FROM client_invite_intents
                 WHERE state = 'claim_pending' ORDER BY created_at, operation_id",
            ).map_err(text)?;
            let rows = statement.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            }).map_err(text)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(text)?
        };
        for (operation_id, room_id, user_id) in intents {
            if self.desync_reason(&room_id)?.is_some_and(|reason| reason.starts_with("RecoveryRequired:")) {
                continue;
            }
            let mut completed = false;
            for attempt in 0..3 {
                if self.resume_claim_pending_invite(&room_id, &user_id, &operation_id)? {
                    completed = true;
                    break;
                }
                if attempt == 2 {
                    return Err(format!("epoch_outdated: invite intent {operation_id} exhausted safe rebase attempts"));
                }
            }
            if !completed {
                return Err(format!("invite intent {operation_id} remains pending"));
            }
        }
        Ok(())
    }

    pub fn cancel_invite(&mut self, room_id: &str, user_id: &str) -> Result<(), String> {
        let intent: Option<(String, String)> = self.meta
            .query_row(
                "SELECT operation_id, state FROM client_invite_intents WHERE room_id = ?1 AND target_user_id = ?2",
                rusqlite::params![room_id, user_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(text)?;
        let Some((operation_id, state)) = intent else { return Ok(()) };
        if state == "commit_pending" {
            self.flush_pending_membership_commits()?;
            let next_state: Option<String> = self.meta
                .query_row(
                    "SELECT state FROM client_invite_intents WHERE operation_id = ?1",
                    [&operation_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(text)?;
            match next_state.as_deref() {
                None => return Ok(()),
                Some("commit_pending") => return Err("membership commit остаётся staged; reservation нельзя release до ACK/replay".to_string()),
                Some("claim_pending") => {}
                Some(other) => return Err(format!("unknown invite intent state: {other}")),
            }
        }
        let released = self.call(
            "DELETE",
            &format!("/mls/key-packages/claims/{}", urlencoding::encode(&operation_id)),
            None,
        )?;
        if released["released"].as_bool().is_none() {
            return Err("сервер не подтвердил release KeyPackage claim".to_string());
        }
        let transaction = self.meta.transaction().map_err(text)?;
        transaction.execute(
            "DELETE FROM client_invite_intents WHERE operation_id = ?1",
            [&operation_id],
        ).map_err(text)?;
        transaction.execute(
            "DELETE FROM client_key_package_claims WHERE room_id = ?1 AND user_id = ?2",
            rusqlite::params![room_id, user_id],
        ).map_err(text)?;
        transaction.commit().map_err(text)?;
        Ok(())
    }

    fn flush_pending_membership_commits(&mut self) -> Result<usize, String> {
        let rows: Vec<(String, String, i64, String, String, String)> = {
            let mut statement = self.meta.prepare(
                "SELECT operation_id, room_id, base_epoch, fingerprint, payload, claim_ids
                 FROM client_membership_commits ORDER BY created_at, operation_id",
            ).map_err(text)?;
            let rows = statement.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
            }).map_err(text)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(text)?
        };
        let mut stale_cleared = 0usize;
        for (operation_id, room_id, base_i64, fingerprint, payload_json, claim_ids_json) in rows {
            if self.desync_reason(&room_id)?.is_some_and(|reason| reason.starts_with("RecoveryRequired:")) {
                continue;
            }
            let base_epoch = u64::try_from(base_i64).map_err(text)?;
            let payload: Value = serde_json::from_str(&payload_json).map_err(text)?;
            let claim_ids: Vec<String> = serde_json::from_str(&claim_ids_json).map_err(text)?;
            if payload["clientOperationId"].as_str() != Some(operation_id.as_str())
                || payload["epoch"].as_u64() != Some(base_epoch)
                || payload["keyPackageClaimId"].as_str().is_some_and(|claim_id| claim_id != operation_id)
            {
                let reason = "membership journal payload does not match its operation identity";
                self.record_desync(&room_id, reason)?;
                return Err(format!("RecoveryRequired: {reason}"));
            }
            let actual = {
                let group = self.groups.get(&room_id).ok_or_else(|| format!("RecoveryRequired: journal room {room_id} is not loaded"))?;
                let staged = group.mls.pending_commit().ok_or_else(|| format!("RecoveryRequired: pending StagedCommit missing for {operation_id}"))?;
                membership_commit_fingerprint(&self.crypto, &room_id, &operation_id, base_epoch, &payload, staged)?
            };
            if actual != fingerprint {
                let reason = format!("pending StagedCommit fingerprint mismatch for operation {operation_id}");
                self.record_desync(&room_id, &reason)?;
                return Err(format!("RecoveryRequired: {reason}"));
            }
            match self.call(
                "POST",
                &format!("/mls/groups/{}/commits", urlencoding::encode(&room_id)),
                Some(payload.clone()),
            ) {
                Ok(response) => {
                    let accepted_epoch = response["epoch"].as_u64().ok_or("сервер не вернул epoch для membership commit")?;
                    if accepted_epoch != base_epoch.saturating_add(1) {
                        let reason = format!("server accepted operation {operation_id} at unexpected epoch {accepted_epoch}");
                        self.record_desync(&room_id, &reason)?;
                        return Err(format!("RecoveryRequired: {reason}"));
                    }
                    let transaction = self.meta.transaction().map_err(text)?;
                    let mut integrity_error = None;
                    let settlement = (|| -> Result<(), String> {
                        let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
                        let group = self.groups.get_mut(&room_id).ok_or("membership journal room disappeared")?;
                        let staged = group.mls.pending_commit().ok_or("pending StagedCommit disappeared before merge")?;
                        let actual = membership_commit_fingerprint(&self.crypto, &room_id, &operation_id, base_epoch, &payload, staged)?;
                        if actual != fingerprint {
                            let reason = format!("pending StagedCommit fingerprint changed before merge for {operation_id}");
                            integrity_error = Some(reason.clone());
                            return Err(reason);
                        }
                        group.mls.merge_pending_commit(&provider).map_err(text)?;
                        if group.mls.epoch().as_u64() != accepted_epoch {
                            let reason = format!("merged local epoch {} differs from accepted server epoch {accepted_epoch}", group.mls.epoch().as_u64());
                            integrity_error = Some(reason.clone());
                            return Err(reason);
                        }
                        transaction.execute("DELETE FROM client_membership_commits WHERE operation_id = ?1", [&operation_id]).map_err(text)?;
                        transaction.execute("DELETE FROM client_invite_intents WHERE operation_id = ?1", [&operation_id]).map_err(text)?;
                        for claim_id in &claim_ids {
                            transaction.execute(
                                "DELETE FROM client_key_package_claims WHERE room_id = ?1 AND claim_id = ?2",
                                rusqlite::params![room_id, claim_id],
                            ).map_err(text)?;
                        }
                        Ok(())
                    })();
                    if let Err(error) = settlement {
                        drop(transaction);
                        self.reload_group(&room_id)?;
                        if let Some(reason) = integrity_error {
                            self.record_desync(&room_id, &reason)?;
                            return Err(format!("RecoveryRequired: {reason}"));
                        }
                        return Err(format!("временная ошибка локального хранилища при завершении membership commit: {error}"));
                    }
                    if let Err(error) = transaction.commit() {
                        self.reload_group(&room_id)?;
                        return Err(format!(
                            "временная ошибка локального хранилища при фиксации membership commit: {}",
                            text(error)
                        ));
                    }
                }
                Err(error) if response_error_code(&error).as_deref() == Some("epoch_outdated") => {
                    let transaction = self.meta.transaction().map_err(text)?;
                    let mut integrity_error = None;
                    let clearing = (|| -> Result<(), String> {
                        let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
                        let group = self.groups.get_mut(&room_id).ok_or("membership journal room disappeared")?;
                        let staged = group.mls.pending_commit().ok_or("pending StagedCommit disappeared before stale clear")?;
                        let actual = membership_commit_fingerprint(&self.crypto, &room_id, &operation_id, base_epoch, &payload, staged)?;
                        if actual != fingerprint {
                            let reason = format!("pending StagedCommit fingerprint changed before stale clear for {operation_id}");
                            integrity_error = Some(reason.clone());
                            return Err(reason);
                        }
                        group.mls.clear_pending_commit(provider.storage()).map_err(text)?;
                        transaction.execute(
                            "DELETE FROM client_membership_commits WHERE operation_id = ?1",
                            [&operation_id],
                        ).map_err(text)?;
                        transaction.execute(
                            "UPDATE client_invite_intents SET state = 'claim_pending' WHERE operation_id = ?1",
                            [&operation_id],
                        ).map_err(text)?;
                        Ok(())
                    })();
                    if let Err(error) = clearing {
                        drop(transaction);
                        self.reload_group(&room_id)?;
                        if let Some(reason) = integrity_error {
                            self.record_desync(&room_id, &reason)?;
                            return Err(format!("RecoveryRequired: {reason}"));
                        }
                        return Err(format!("временная ошибка локального хранилища при очистке stale membership commit: {error}"));
                    }
                    if let Err(error) = transaction.commit() {
                        self.reload_group(&room_id)?;
                        return Err(format!(
                            "временная ошибка локального хранилища при фиксации stale membership commit: {}",
                            text(error)
                        ));
                    }
                    stale_cleared += 1;
                }
                Err(error) if response_error_code(&error).as_deref() == Some("operation_id_reused") => {
                    self.record_desync(&room_id, &format!("server rejected reused membership operation ID {operation_id}"))?;
                    return Err(error);
                }
                Err(error) if matches!(
                    response_error_code(&error).as_deref(),
                    Some("claim_committed" | "claim_missing" | "claim_released" | "claim_room_mismatch" | "claim_mismatch")
                ) => {
                    let reason = format!("server KeyPackage claim conflict for membership operation {operation_id}: {error}");
                    self.record_desync(&room_id, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(stale_cleared)
    }

    pub fn invite(&mut self, room_id: &str, user_id: &str) -> Result<(), String> {
        self.ensure_writable()?;
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!("комната рассинхронизирована и требует восстановления: {reason}"));
        }
        self.flush_pending_membership_commits()?;
        let (operation_id, state) = self.ensure_invite_intent(room_id, user_id)?;
        if state == "commit_pending" {
            self.flush_pending_membership_commits()?;
            let next_state: Option<String> = self.meta
                .query_row(
                    "SELECT state FROM client_invite_intents WHERE operation_id = ?1",
                    [&operation_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(text)?;
            match next_state.as_deref() {
                None => return Ok(()),
                Some("claim_pending") => {}
                Some("commit_pending") => {
                    let reason = format!("commit_pending invite {operation_id} has no resolvable ACK");
                    self.record_desync(room_id, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
                Some(other) => return Err(format!("unknown invite intent state: {other}")),
            }
        }
        for attempt in 0..3 {
            if self.resume_claim_pending_invite(room_id, user_id, &operation_id)? {
                return Ok(());
            }
            if attempt == 2 {
                return Err(format!("epoch_outdated: invite {operation_id} exhausted safe rebase attempts"));
            }
        }
        Err("invite не удалось применить".to_string())
    }


    pub fn send_text(&mut self, room_id: &str, plaintext: &str) -> Result<String, String> {
        let id = hex_encode(&self.crypto.random_vec(16).map_err(text)?);
        self.send_text_with_id(room_id, plaintext, &id)
    }

    /// Отправляет текст с durable idempotency: точное MLS-сообщение и sender ratchet
    /// фиксируются в SQLCipher до сети, а completed mapping сохраняется в inbox.
    pub fn send_text_with_id(
        &mut self,
        room_id: &str,
        plaintext: &str,
        client_message_id: &str,
    ) -> Result<String, String> {
        self.ensure_writable()?;
        if client_message_id.is_empty()
            || client_message_id.len() > 64
            || !client_message_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            || client_message_id.starts_with("att_")
        {
            return Err("clientMessageId must contain 1-64 letters, digits, _ or -; att_ is reserved for attachments".to_string());
        }
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!("комната рассинхронизирована и требует восстановления: {reason}"));
        }

        let completed: Option<(String, String, String, Option<String>)> = self.meta.query_row(
            "SELECT room_id, event_id, kind, body FROM client_inbox WHERE client_message_id = ?1",
            [client_message_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).optional().map_err(text)?;
        if let Some((stored_room, event_id, kind, stored_body)) = completed {
            if stored_room != room_id || kind != "text" || stored_body.as_deref() != Some(plaintext) {
                return Err("clientMessageId is already completed with a different room or payload".to_string());
            }
            return Ok(event_id);
        }

        let queued: Option<(String, String)> = self.meta.query_row(
            "SELECT room_id, body FROM client_outbox WHERE local_id = ?1",
            [client_message_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(text)?;
        match queued {
            Some((stored_room, stored_body)) => {
                if stored_room != room_id || stored_body != plaintext {
                    return Err("clientMessageId is already reserved for a different room or payload".to_string());
                }
            }
            None => {
                self.meta.execute(
                    "INSERT INTO client_outbox (local_id, room_id, body, seq)
                     VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM client_outbox))",
                    rusqlite::params![client_message_id, room_id, plaintext],
                ).map_err(text)?;
            }
        }

        let server_epoch = self.server_epoch(room_id)?;
        let expected_epoch = i64::try_from(server_epoch)
            .map_err(|_| "MLS epoch exceeds the persistent message outbox range".to_string())?;
        let persisted_message: (Option<Vec<u8>>, Option<i64>) = self.meta.query_row(
            "SELECT mls_message, mls_epoch FROM client_outbox WHERE local_id = ?1",
            [client_message_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(text)?
            .ok_or_else(|| "message outbox disappeared before MLS encryption".to_string())?;
        let mls_message = match persisted_message {
            (Some(bytes), Some(epoch)) if !bytes.is_empty() && epoch == expected_epoch => Zeroizing::new(bytes),
            _ => Zeroizing::new(self.create_and_persist_text_mls_message(
                room_id,
                client_message_id,
                plaintext,
                server_epoch,
            )?),
        };
        let encrypted_body = B64.encode(mls_message.as_slice());
        let response = self.call(
            "POST",
            &format!("/mls/groups/{}/messages", urlencoding::encode(room_id)),
            Some(json!({
                "message": encrypted_body,
                "kind": "text",
                "forwarded": false,
                "clientMessageId": client_message_id
            })),
        )?;
        let event_id = response["event_id"]
            .as_str()
            .ok_or("сервер не вернул event_id")?
            .to_string();

        let outgoing = Incoming::Text {
            room_id: room_id.to_string(),
            event_id: event_id.clone(),
            text: plaintext.to_string(),
            mine: true,
        };
        let transaction = self.meta.transaction().map_err(text)?;
        if let Err(error) = insert_incoming_record(&transaction, &outgoing) {
            drop(transaction);
            return Err(error);
        }
        let updated = match transaction.execute(
            "UPDATE client_inbox SET client_message_id = ?1
             WHERE event_id = ?2 AND room_id = ?3 AND kind = 'text' AND body = ?4",
            rusqlite::params![client_message_id, event_id, room_id, plaintext],
        ) {
            Ok(updated) => updated,
            Err(error) => {
                drop(transaction);
                return Err(text(error));
            }
        };
        if updated != 1 {
            drop(transaction);
            return Err("sender message history could not be bound to its clientMessageId".to_string());
        }
        let deleted = match transaction.execute(
            "DELETE FROM client_outbox WHERE local_id = ?1 AND room_id = ?2 AND body = ?3",
            rusqlite::params![client_message_id, room_id, plaintext],
        ) {
            Ok(deleted) => deleted,
            Err(error) => {
                drop(transaction);
                return Err(text(error));
            }
        };
        if deleted != 1 {
            drop(transaction);
            return Err("message outbox changed before completion".to_string());
        }
        transaction.commit().map_err(text)?;
        self.processed.insert(event_id.clone());
        Ok(event_id)
    }

    /// Creates and persists the exact MLS message with the sender ratchet update.
    /// A retry reuses the serialized message until the server epoch changes.
    fn create_and_persist_text_mls_message(
        &mut self,
        room_id: &str,
        client_message_id: &str,
        plaintext: &str,
        expected_epoch: u64,
    ) -> Result<Vec<u8>, String> {
        let epoch = i64::try_from(expected_epoch)
            .map_err(|_| "MLS epoch exceeds the persistent message outbox range".to_string())?;
        let transaction = self.meta.transaction().map_err(text)?;
        let message_result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            let local_epoch = group.mls.epoch().as_u64();
            if local_epoch != expected_epoch {
                Err(format!("устройство на эпохе {local_epoch}, сервер на {expected_epoch}: сначала синхронизация"))
            } else {
                group.mls
                    .create_message(&provider, &self.signer, plaintext.as_bytes())
                    .map_err(text)
                    .and_then(|message| message.tls_serialize_detached().map_err(text))
            }
        };
        let message_bytes = match message_result {
            Ok(bytes) => bytes,
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(error);
            }
        };
        let changed = match transaction.execute(
            "UPDATE client_outbox SET mls_message = ?2, mls_epoch = ?3
             WHERE local_id = ?1 AND room_id = ?4 AND body = ?5",
            rusqlite::params![client_message_id, message_bytes, epoch, room_id, plaintext],
        ) {
            Ok(changed) => changed,
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(text(error));
            }
        };
        if changed != 1 {
            drop(transaction);
            self.reload_group(room_id)?;
            return Err("message outbox changed before MLS message persistence".to_string());
        }
        if let Err(error) = transaction.commit() {
            self.reload_group(room_id)?;
            return Err(text(error));
        }
        Ok(message_bytes)
    }

    /// Creates the MLS application message and commits its sender ratchet state
    /// together with the exact serialized message in the SQLCipher outbox. A retry
    /// after a lost HTTP response must resend these exact bytes, not consume another
    /// sender generation for an event the server has already accepted.
    fn create_and_persist_attachment_mls_message(
        &mut self,
        room_id: &str,
        operation_id: &str,
        file_id: &str,
        manifest_payload: &[u8],
        expected_epoch: u64,
    ) -> Result<Vec<u8>, String> {
        let epoch = i64::try_from(expected_epoch)
            .map_err(|_| "MLS epoch exceeds the persistent attachment journal range".to_string())?;
        let transaction = self.meta.transaction().map_err(text)?;
        let message_result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id)
                .ok_or("комната не создана на этом устройстве")?;
            let local_epoch = group.mls.epoch().as_u64();
            if local_epoch != expected_epoch {
                Err(format!(
                    "устройство на эпохе {local_epoch}, сервер на {expected_epoch}: сначала синхронизация"
                ))
            } else {
                group.mls
                    .create_message(&provider, &self.signer, manifest_payload)
                    .map_err(text)
                    .and_then(|message| message.tls_serialize_detached().map_err(text))
            }
        };
        let message_bytes = match message_result {
            Ok(bytes) => bytes,
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(error);
            }
        };
        let changed = match transaction.execute(
            "UPDATE client_attachment_outbox
             SET mls_message = ?4, mls_epoch = ?5
             WHERE client_message_id = ?1 AND room_id = ?2 AND file_id = ?3",
            rusqlite::params![operation_id, room_id, file_id, message_bytes, epoch],
        ) {
            Ok(changed) => changed,
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(text(error));
            }
        };
        if changed != 1 {
            drop(transaction);
            self.reload_group(room_id)?;
            return Err("attachment outbox changed before MLS message persistence".to_string());
        }
        if let Err(error) = transaction.commit() {
            self.reload_group(room_id)?;
            return Err(text(error));
        }
        Ok(message_bytes)
    }

    /// Encrypts a file with a per-file AES-256-GCM key, uploads ciphertext only,
    /// then sends the key/nonce manifest inside an MLS application message.
    pub fn send_attachment(
        &mut self,
        room_id: &str,
        name: &str,
        mime_type: &str,
        plaintext: &[u8],
    ) -> Result<String, String> {
        let client_message_id = hex_encode(&self.crypto.random_array::<16>().map_err(text)?);
        self.send_attachment_with_id(room_id, name, mime_type, plaintext, &client_message_id)
    }

    /// Idempotent attachment send. Reuse the same client_message_id when retrying
    /// after an uncertain network result; its manifest/key remain in SQLCipher.
    pub fn send_attachment_with_id(
        &mut self,
        room_id: &str,
        name: &str,
        mime_type: &str,
        plaintext: &[u8],
        client_message_id: &str,
    ) -> Result<String, String> {
        self.ensure_writable()?;
        if client_message_id.is_empty()
            || client_message_id.len() > 60
            || !client_message_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err("clientMessageId must contain 1-60 letters, digits, _ or -".to_string());
        }
        if name.is_empty() || name.len() > 255 || name.chars().any(char::is_control)
            || name.contains('/') || name.contains('\\')
        {
            return Err("invalid attachment display name".to_string());
        }
        if mime_type.is_empty() || mime_type.len() > 127 || mime_type.chars().any(char::is_control) {
            return Err("invalid attachment MIME type".to_string());
        }
        if plaintext.is_empty() || plaintext.len() as u64 > 50 * 1024 * 1024 - 16 {
            return Err("attachment size must be between 1 byte and 50 MiB minus the GCM tag".to_string());
        }
        let operation_id = format!("att_{client_message_id}");
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!("комната рассинхронизирована и требует восстановления: {reason}"));
        }
        let initial_server_epoch = self.server_epoch(room_id)?;
        let initial_local_epoch = self.groups.get(room_id)
            .ok_or("комната не создана на этом устройстве")?
            .mls.epoch().as_u64();
        if initial_local_epoch != initial_server_epoch {
            return Err(format!(
                "устройство на эпохе {initial_local_epoch}, сервер на {initial_server_epoch}: сначала синхронизация"
            ));
        }

        let file_id: String;
        let mut upload_url: Option<String> = None;
        let manifest_payload: Zeroizing<Vec<u8>>;
        let ciphertext: Vec<u8>;
        let mut already_uploaded = false;

        let completed: Option<(String, String, String, Vec<u8>)> = self.meta.query_row(
            "SELECT room_id, file_id, event_id, manifest FROM client_attachments
             WHERE client_message_id = ?1 AND direction = 'outgoing'",
            [operation_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).optional().map_err(text)?;
        if let Some((stored_room, stored_file_id, event_id, stored_manifest)) = completed {
            if stored_room != room_id {
                return Err("clientMessageId is already completed for a different room".to_string());
            }
            let stored_manifest = Zeroizing::new(stored_manifest);
            let manifest = attachment_crypto::parse_manifest(&stored_manifest, &stored_file_id, room_id)?;
            if manifest.name != name
                || manifest.mime_type != mime_type
                || manifest.size != plaintext.len() as u64
                || manifest.sha256 != attachment_crypto::sha256_hex(plaintext)
            {
                return Err("clientMessageId retry payload does not match the completed attachment".to_string());
            }
            return Ok(event_id);
        }

        let existing: Option<(String, String, Vec<u8>, String, i64, bool)> = self.meta.query_row(
            "SELECT room_id, file_id, manifest, ciphertext_sha256, ciphertext_size, uploaded
             FROM client_attachment_outbox WHERE client_message_id = ?1",
            [operation_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        ).optional().map_err(text)?;

        if let Some((stored_room, stored_file_id, stored_manifest, stored_cipher_hash, stored_cipher_size, uploaded)) = existing {
            if stored_room != room_id {
                return Err("clientMessageId is already reserved for a different room".to_string());
            }
            let stored_manifest = Zeroizing::new(stored_manifest);
            let parsed = attachment_crypto::parse_manifest(&stored_manifest, &stored_file_id, room_id)?;
            if parsed.name != name
                || parsed.mime_type != mime_type
                || parsed.size != plaintext.len() as u64
                || parsed.sha256 != attachment_crypto::sha256_hex(plaintext)
            {
                return Err("clientMessageId retry payload does not match the persisted attachment".to_string());
            }
            ciphertext = attachment_crypto::encrypt(plaintext, &parsed.key, &parsed.nonce, room_id)?;
            let ciphertext_hash = attachment_crypto::sha256_hex(&ciphertext);
            if ciphertext_hash != stored_cipher_hash || ciphertext.len() as i64 != stored_cipher_size {
                return Err("persisted attachment retry ciphertext does not match its SQLCipher journal".to_string());
            }
            if uploaded {
                file_id = stored_file_id;
                manifest_payload = Zeroizing::new(stored_manifest.to_vec());
                already_uploaded = true;
            } else {
                // The previous upload capability may have expired or been consumed.
                // Reserve a fresh object while reusing the same per-file key/nonce.
                let (new_file_id, new_upload_url) = self.reserve_attachment_upload(room_id, &ciphertext)?;
                let new_manifest = Zeroizing::new(attachment_crypto::build_manifest(
                    &new_file_id, room_id, name, mime_type, plaintext, &ciphertext,
                    &parsed.key, &parsed.nonce,
                )?);
                let changed = self.meta.execute(
                    "UPDATE client_attachment_outbox
                     SET file_id = ?2, manifest = ?3, ciphertext_sha256 = ?4, ciphertext_size = ?5,
                         uploaded = 0, mls_message = NULL, mls_epoch = NULL
                     WHERE client_message_id = ?1 AND room_id = ?6",
                    rusqlite::params![
                        operation_id.as_str(), new_file_id, new_manifest.as_slice(),
                        ciphertext_hash, ciphertext.len() as i64, room_id
                    ],
                ).map_err(text)?;
                if changed != 1 {
                    return Err("attachment retry journal changed during upload reservation".to_string());
                }
                file_id = new_file_id;
                upload_url = Some(new_upload_url);
                manifest_payload = new_manifest;
            }
        } else {
            let key = Zeroizing::new(self.crypto.random_array::<32>().map_err(text)?);
            let nonce = Zeroizing::new(self.crypto.random_array::<12>().map_err(text)?);
            ciphertext = attachment_crypto::encrypt(plaintext, &key, &nonce, room_id)?;
            let ciphertext_hash = attachment_crypto::sha256_hex(&ciphertext);
            let (reserved_file_id, reserved_upload_url) = self.reserve_attachment_upload(room_id, &ciphertext)?;
            let manifest = Zeroizing::new(attachment_crypto::build_manifest(
                &reserved_file_id, room_id, name, mime_type, plaintext, &ciphertext, &key, &nonce,
            )?);
            self.meta.execute(
                "INSERT INTO client_attachment_outbox
                 (client_message_id, room_id, file_id, manifest, ciphertext_sha256, ciphertext_size, uploaded)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                rusqlite::params![
                    operation_id.as_str(), room_id, reserved_file_id, manifest.as_slice(),
                    ciphertext_hash, ciphertext.len() as i64
                ],
            ).map_err(text)?;
            file_id = reserved_file_id;
            upload_url = Some(reserved_upload_url);
            manifest_payload = manifest;
        }

        if !already_uploaded {
            let signed_upload_url = upload_url.as_deref()
                .ok_or("attachment upload URL is missing for an unuploaded outbox item")?;
            self.upload_signed_bytes(signed_upload_url, &ciphertext)?;
            self.call(
                "POST",
                &format!("/files/{}/complete", urlencoding::encode(&file_id)),
                Some(json!({})),
            )?;
            let changed = self.meta.execute(
                "UPDATE client_attachment_outbox SET uploaded = 1 WHERE client_message_id = ?1 AND file_id = ?2",
                rusqlite::params![operation_id.as_str(), file_id],
            ).map_err(text)?;
            if changed != 1 {
                return Err("attachment outbox disappeared after successful upload".to_string());
            }
        }

        let server_epoch = self.server_epoch(room_id)?;
        let expected_epoch = i64::try_from(server_epoch)
            .map_err(|_| "MLS epoch exceeds the persistent attachment journal range".to_string())?;
        let persisted_message: (Option<Vec<u8>>, Option<i64>) = self.meta.query_row(
            "SELECT mls_message, mls_epoch FROM client_attachment_outbox
             WHERE client_message_id = ?1 AND room_id = ?2 AND file_id = ?3",
            rusqlite::params![operation_id.as_str(), room_id, file_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(text)?
            .ok_or_else(|| "attachment outbox disappeared before MLS message persistence".to_string())?;
        let mls_message = match persisted_message {
            (Some(bytes), Some(epoch)) if !bytes.is_empty() && epoch == expected_epoch => Zeroizing::new(bytes),
            _ => Zeroizing::new(self.create_and_persist_attachment_mls_message(
                room_id,
                operation_id.as_str(),
                &file_id,
                manifest_payload.as_slice(),
                server_epoch,
            )?),
        };
        let encrypted_manifest = B64.encode(mls_message.as_slice());
        let response = self.call(
            "POST",
            &format!("/mls/groups/{}/messages", urlencoding::encode(room_id)),
            Some(json!({
                "message": encrypted_manifest,
                "kind": "text",
                "forwarded": false,
                "clientMessageId": operation_id.as_str(),
                "fileId": file_id,
            })),
        )?;
        let event_id = response.get("event_id").and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or("сервер не вернул event_id для вложения")?.to_string();

        let incoming = Incoming::Attachment {
            room_id: room_id.to_string(),
            event_id: event_id.clone(),
            file_id: file_id.clone(),
            name: name.to_string(),
            mime_type: mime_type.to_string(),
            size: plaintext.len() as u64,
            mine: true,
        };
        let transaction = self.meta.transaction().map_err(text)?;
        insert_incoming_record(&transaction, &incoming)?;
        let tagged = transaction.execute(
            "UPDATE client_inbox SET client_message_id = ?1 WHERE event_id = ?2",
            rusqlite::params![operation_id.as_str(), event_id.as_str()],
        ).map_err(text)?;
        if tagged != 1 {
            return Err("could not tag outgoing attachment direction in local history".to_string());
        }
        transaction.execute(
            "INSERT OR IGNORE INTO client_attachments
             (file_id, room_id, event_id, manifest, direction, created_at, client_message_id)
             VALUES (?1, ?2, ?3, ?4, 'outgoing', ?5, ?6)",
            rusqlite::params![
                file_id, room_id, event_id, manifest_payload.as_slice(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default().as_millis() as i64,
                operation_id.as_str()
            ],
        ).map_err(text)?;
        let stored: (String, String, Vec<u8>) = transaction.query_row(
            "SELECT room_id, event_id, manifest FROM client_attachments WHERE file_id = ?1",
            [&file_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(text)?;
        if stored.0 != room_id || stored.1 != event_id || stored.2.as_slice() != manifest_payload.as_slice() {
            return Err("attachment fileId is already bound to a different local event".to_string());
        }
        transaction.execute(
            "DELETE FROM client_attachment_outbox WHERE client_message_id = ?1",
            [operation_id.as_str()],
        ).map_err(text)?;
        transaction.commit().map_err(text)?;
        self.processed.insert(event_id.clone());
        Ok(event_id)
    }

    /// Downloads ciphertext using the authenticated device-bound capability and
    /// decrypts it only after manifest, room, size, hash and AEAD checks succeed.
    pub fn download_attachment(&self, file_id: &str) -> Result<Vec<u8>, String> {
        if file_id.trim().is_empty() || file_id.len() > 128 {
            return Err("invalid attachment fileId".to_string());
        }
        let (room_id, manifest_bytes): (String, Vec<u8>) = self.meta.query_row(
            "SELECT room_id, manifest FROM client_attachments WHERE file_id = ?1",
            [file_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(text)?
            .ok_or_else(|| "attachment manifest is not available in the encrypted local inbox".to_string())?;
        let manifest_bytes = Zeroizing::new(manifest_bytes);
        let manifest = attachment_crypto::parse_manifest(&manifest_bytes, file_id, &room_id)?;
        for attempt in 0..2 {
            let link = self.call(
                "GET",
                &format!("/files/{}/url", urlencoding::encode(file_id)),
                None,
            )?;
            let download_url = link.get("downloadUrl").and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or("file link response did not return downloadUrl")?;
            match self.download_signed_bytes(download_url, manifest.ciphertext_size) {
                Ok(ciphertext) => return attachment_crypto::decrypt(&ciphertext, &manifest),
                Err(error) if attempt == 0 && error.contains("signed download -> 403") => {
                    // The short-lived URL may have expired between link creation and GET.
                    // Re-request it once; membership/device revocation still fails closed.
                    continue;
                }
                Err(error) => return Err(error),
            }
        }
        Err("could not obtain a valid signed attachment download".to_string())
    }

    /// Входит в группы по приветствиям, которые ждут на сервере, и подтверждает их.
    fn join_welcomes(&mut self) -> Result<(), String> {
        self.retry_pending_welcome_acks()?;
        let pending = self.call("GET", "/mls/welcomes", None)?;
        let welcome_rows = pending["welcomes"].as_array()
            .ok_or_else(|| "ошибка контракта ответа: welcomes отсутствует или не массив".to_string())?
            .clone();
        for row in welcome_rows {
            let welcome_id = row["id"].as_i64()
                .ok_or_else(|| "ошибка контракта ответа: Welcome id отсутствует или не число".to_string())?;
            let room_id = row["roomId"].as_str()
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| "ошибка контракта ответа: Welcome roomId отсутствует или пустой".to_string())?;
            let encoded = row["welcome"].as_str()
                .ok_or_else(|| "ошибка контракта ответа: Welcome payload не строка".to_string())?;
            let bytes = match B64.decode(encoded) {
                Ok(bytes) => bytes,
                Err(error) => {
                    if self.persist_welcome_receipt(
                        welcome_id, room_id, encoded.as_bytes(), "quarantined",
                        Some(&format!("Welcome base64 is malformed: {error}")),
                    ).is_ok() {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };

            let existing: Option<(String, Vec<u8>, String, Option<i64>)> = self.meta
                .query_row(
                    "SELECT room_id, welcome, outcome, acked_at FROM client_welcome_receipts WHERE welcome_id = ?1",
                    [welcome_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
                .map_err(text)?;
            if let Some((stored_room, stored_welcome, outcome, acked_at)) = existing {
                if stored_room != room_id || stored_welcome != bytes {
                    self.record_desync(room_id, "Welcome receipt identity collision")?;
                    continue;
                }
                if outcome == "joined" && !self.groups.contains_key(room_id) {
                    self.record_desync(room_id, "joined Welcome receipt exists but the local MLS group is missing")?;
                    continue;
                }
                if acked_at.is_none() {
                    let _ = self.ack_welcome(welcome_id);
                }
                continue;
            }

            if self.desync_reason(room_id)?.is_some_and(|reason| reason.starts_with("RecoveryRequired:")) {
                continue;
            }

            // Upgrade a pending ACK marker written by the earlier mobile client.
            let legacy_room: Option<String> = self.meta
                .query_row(
                    "SELECT room_id FROM client_welcomes WHERE welcome_id = ?1",
                    [welcome_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(text)?;
            if let Some(stored_room) = legacy_room {
                if stored_room != room_id || !self.groups.contains_key(room_id) {
                    self.record_desync(room_id, "legacy Welcome ACK marker does not match a durable local group")?;
                    continue;
                }
                if self.persist_welcome_receipt(welcome_id, room_id, &bytes, "joined", None).is_ok() {
                    let _ = self.meta.execute("DELETE FROM client_welcomes WHERE welcome_id = ?1", [welcome_id]);
                    let _ = self.ack_welcome(welcome_id);
                }
                continue;
            }

            let locally_joined: bool = self.meta
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM client_rooms WHERE room_id = ?1)",
                    [room_id],
                    |r| r.get(0),
                )
                .map_err(text)?;
            if locally_joined || self.groups.contains_key(room_id) {
                self.record_desync(
                    room_id,
                    "Duplicate Welcome for an already joined room; retain Welcome without ACK for explicit recovery",
                )?;
                continue;
            }

            let message = match MlsMessageIn::tls_deserialize_exact(&bytes) {
                Ok(message) => message,
                Err(error) => {
                    if self.persist_welcome_receipt(
                        welcome_id, room_id, &bytes, "quarantined",
                        Some(&format!("Malformed Welcome encoding: {error}")),
                    ).is_ok() {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };
            let welcome = match message.extract() {
                MlsMessageBodyIn::Welcome(welcome) => welcome,
                _ => {
                    if self.persist_welcome_receipt(
                        welcome_id, room_id, &bytes, "quarantined",
                        Some("Server item is not an MLS Welcome"),
                    ).is_ok() {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };

            enum JoinFailure { Duplicate, Indeterminate(String), Permanent(String), Mismatch(String) }
            let join_config = MlsGroupJoinConfig::builder()
                .use_ratchet_tree_extension(true)
                .max_past_epochs(MAX_PAST_EPOCHS)
                .build();

            // MLS state, room index and durable Welcome receipt commit atomically.
            let joined: Result<(MlsGroup, u64), JoinFailure> = (|| {
                let transaction = self.meta.transaction()
                    .map_err(|error| JoinFailure::Indeterminate(text(error)))?;
                let (mls, actual_room, join_epoch) = {
                    let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
                    let staged = StagedWelcome::new_from_welcome(&provider, &join_config, welcome, None)
                        .map_err(|error| match error {
                            WelcomeError::GroupAlreadyExists => JoinFailure::Duplicate,
                            WelcomeError::LibraryError(error) => JoinFailure::Indeterminate(format!("{error:?}")),
                            WelcomeError::StorageError(error) => JoinFailure::Indeterminate(format!("{error:?}")),
                            other => JoinFailure::Permanent(format!("Permanent Welcome error: {other:?}")),
                        })?;
                    let mls = staged.into_group(&provider).map_err(|error| match error {
                        WelcomeError::GroupAlreadyExists => JoinFailure::Duplicate,
                        WelcomeError::LibraryError(error) => JoinFailure::Indeterminate(format!("{error:?}")),
                        WelcomeError::StorageError(error) => JoinFailure::Indeterminate(format!("{error:?}")),
                        other => JoinFailure::Permanent(format!("Permanent Welcome materialization error: {other:?}")),
                    })?;
                    let actual_room = String::from_utf8_lossy(mls.group_id().as_slice()).to_string();
                    let join_epoch = mls.epoch().as_u64();
                    (mls, actual_room, join_epoch)
                };
                if actual_room != room_id {
                    return Err(JoinFailure::Mismatch(format!(
                        "Welcome group ID mismatch: server={room_id}, MLS={actual_room}"
                    )));
                }
                transaction.execute(
                    "INSERT OR REPLACE INTO client_rooms (room_id, join_epoch) VALUES (?1, ?2)",
                    (&room_id, join_epoch as i64),
                ).map_err(|error| JoinFailure::Indeterminate(text(error)))?;
                let created_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default().as_millis() as i64;
                transaction.execute(
                    "INSERT OR IGNORE INTO client_welcome_receipts
                     (welcome_id, room_id, welcome, outcome, reason, created_at, acked_at)
                     VALUES (?1, ?2, ?3, 'joined', NULL, ?4, NULL)",
                    rusqlite::params![welcome_id, room_id, bytes, created_at],
                ).map_err(|error| JoinFailure::Indeterminate(text(error)))?;
                let receipt: (String, Vec<u8>, String) = transaction.query_row(
                    "SELECT room_id, welcome, outcome FROM client_welcome_receipts WHERE welcome_id = ?1",
                    [welcome_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                ).map_err(|error| JoinFailure::Indeterminate(text(error)))?;
                if receipt.0 != room_id || receipt.1 != bytes || receipt.2 != "joined" {
                    return Err(JoinFailure::Mismatch("Welcome receipt identity collision".to_string()));
                }
                transaction.execute(
                    "DELETE FROM client_welcomes WHERE welcome_id = ?1",
                    [welcome_id],
                ).map_err(|error| JoinFailure::Indeterminate(text(error)))?;
                transaction.commit().map_err(|error| JoinFailure::Indeterminate(text(error)))?;
                Ok((mls, join_epoch))
            })();

            match joined {
                Ok((mls, join_epoch)) => {
                    self.groups.insert(room_id.to_string(), Group { mls, join_epoch });
                    let _ = self.ack_welcome(welcome_id);
                }
                Err(JoinFailure::Duplicate) => {
                    self.record_desync(room_id, "GroupAlreadyExists while replaying Welcome; retain Welcome without ACK for explicit recovery")?;
                }
                Err(JoinFailure::Indeterminate(reason)) => {
                    return Err(format!("temporary Welcome processing failure for {welcome_id}: {reason}"));
                }
                Err(JoinFailure::Permanent(reason)) => {
                    if self.persist_welcome_receipt(welcome_id, room_id, &bytes, "quarantined", Some(&reason)).is_ok() {
                        let _ = self.ack_welcome(welcome_id);
                    }
                }
                Err(JoinFailure::Mismatch(reason)) => {
                    self.record_desync(room_id, &reason)?;
                    if self.persist_welcome_receipt(welcome_id, room_id, &bytes, "quarantined", Some(&reason)).is_ok() {
                        let _ = self.ack_welcome(welcome_id);
                    }
                }
            }
        }
        Ok(())
    }

    fn persist_welcome_receipt(
        &mut self,
        welcome_id: i64,
        room_id: &str,
        bytes: &[u8],
        outcome: &str,
        reason: Option<&str>,
    ) -> Result<(), String> {
        let transaction = self.meta.transaction().map_err(text)?;
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default().as_millis() as i64;
        transaction.execute(
            "INSERT OR IGNORE INTO client_welcome_receipts
             (welcome_id, room_id, welcome, outcome, reason, created_at, acked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            rusqlite::params![welcome_id, room_id, bytes, outcome, reason, created_at],
        ).map_err(text)?;
        let existing: (String, Vec<u8>, String) = transaction.query_row(
            "SELECT room_id, welcome, outcome FROM client_welcome_receipts WHERE welcome_id = ?1",
            [welcome_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(text)?;
        if existing.0 != room_id || existing.1 != bytes || existing.2 != outcome {
            return Err(format!("Welcome receipt identity collision for id {welcome_id}"));
        }
        transaction.commit().map_err(text)?;
        Ok(())
    }

    fn ack_welcome(&mut self, welcome_id: i64) -> Result<(), String> {
        if let Err(error) = self.call(
            "POST",
            &format!("/mls/welcomes/{welcome_id}/ack"),
            Some(json!({})),
        ) {
            // The server may have committed the ACK before the response was lost.
            // Treat 404 as already acknowledged; the durable receipt is authoritative.
            if !error.contains("-> 404") {
                return Err(error);
            }
        }
        let acked_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta.execute(
            "UPDATE client_welcome_receipts SET acked_at = ?1 WHERE welcome_id = ?2 AND acked_at IS NULL",
            rusqlite::params![acked_at, welcome_id],
        ).map_err(text)?;
        self.meta.execute(
            "DELETE FROM client_welcomes WHERE welcome_id = ?1",
            [welcome_id],
        ).map_err(text)?;
        Ok(())
    }

    fn retry_pending_welcome_acks(&mut self) -> Result<(), String> {
        let pending: Vec<(i64, String, String)> = {
            let mut statement = self.meta.prepare(
                "SELECT welcome_id, room_id, outcome FROM client_welcome_receipts
                 WHERE acked_at IS NULL ORDER BY created_at, welcome_id",
            ).map_err(text)?;
            let rows = statement.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            }).map_err(text)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(text)?
        };
        for (welcome_id, room_id, outcome) in pending {
            if outcome == "joined" && !self.groups.contains_key(&room_id) {
                self.record_desync(&room_id, "pending joined Welcome receipt exists but the local MLS group is missing")?;
                continue;
            }
            let _ = self.ack_welcome(welcome_id);
        }
        Ok(())
    }

    fn mls_users(&self, room_id: &str) -> Result<BTreeSet<String>, String> {
        Ok(self.members_of(room_id)?
            .into_iter()
            .filter_map(|identity| identity.rsplit_once('/').map(|(user, _)| user.to_string()))
            .collect())
    }

    fn server_users(&mut self, room_id: &str) -> Result<BTreeSet<String>, String> {
        let body = match self.call(
            "GET",
            &format!("/rooms/{}/members", urlencoding::encode(room_id)),
            None,
        ) {
            Ok(body) => body,
            Err(error) if is_not_member_error(&error) => return Ok(BTreeSet::new()),
            Err(error) => return Err(error),
        };
        let members = body["members"].as_array().ok_or("ответ без списка участников")?;
        members.iter()
            .map(|member| member.as_str().map(str::to_string)
                .ok_or_else(|| "участник не строка".to_string()))
            .collect()
    }

    fn check_consistency(&mut self, room_id: &str) -> Result<(), String> {
        let mls = self.mls_users(room_id)?;
        let server = self.server_users(room_id)?;
        if mls == server {
            let recovery_required: bool = self.meta.query_row(
                "SELECT EXISTS(SELECT 1 FROM client_desync WHERE room_id = ?1 AND reason LIKE 'RecoveryRequired:%')",
                [room_id],
                |row| row.get(0),
            ).map_err(text)?;
            if !recovery_required {
                self.meta.execute("DELETE FROM client_desync WHERE room_id = ?1", [room_id]).map_err(text)?;
            }
            return Ok(());
        }
        let only_server: Vec<&String> = server.difference(&mls).collect();
        let only_mls: Vec<&String> = mls.difference(&server).collect();
        let reason = format!(
            "рассинхронизирована: на сервере без MLS-группы {only_server:?}; в MLS-группе без сервера {only_mls:?}"
        );
        self.meta.execute(
            "INSERT INTO client_desync (room_id, reason) VALUES (?1, ?2)
             ON CONFLICT(room_id) DO UPDATE SET reason = excluded.reason",
            rusqlite::params![room_id, reason],
        ).map_err(text)?;
        Ok(())
    }

    fn record_desync(&mut self, room_id: &str, reason: &str) -> Result<(), String> {
        let durable_reason = if reason.starts_with("RecoveryRequired:") {
            reason.to_string()
        } else {
            format!("RecoveryRequired: {reason}")
        };
        self.meta.execute(
            "INSERT INTO client_desync (room_id, reason) VALUES (?1, ?2)
             ON CONFLICT(room_id) DO UPDATE SET reason = excluded.reason",
            rusqlite::params![room_id, durable_reason],
        ).map_err(text)?;
        Ok(())
    }

    pub fn desync_reason(&self, room_id: &str) -> Result<Option<String>, String> {
        let recovery: Option<String> = self.meta.query_row(
            "SELECT reason FROM client_desync WHERE room_id = ?1 AND reason LIKE 'RecoveryRequired:%'",
            [room_id],
            |row| row.get(0),
        ).optional().map_err(text)?;
        if recovery.is_some() {
            return Ok(recovery);
        }
        if let Some((expected_epoch, event_ids)) = self.waiting_for_commit(room_id)? {
            return Ok(Some(format!(
                "WaitingForCommit: expected epoch {expected_epoch}, pending events {event_ids:?}"
            )));
        }
        self.meta.query_row(
            "SELECT reason FROM client_desync WHERE room_id = ?1",
            [room_id],
            |row| row.get(0),
        ).optional().map_err(text)
    }

    fn waiting_for_commit(&self, room_id: &str) -> Result<Option<(u64, Vec<String>)>, String> {
        let row: Option<(i64, String)> = self.meta.query_row(
            "SELECT expected_epoch, event_ids FROM client_waiting_for_commit WHERE room_id = ?1",
            [room_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(text)?;
        row.map(|(epoch, ids)| {
            let expected_epoch = u64::try_from(epoch).map_err(text)?;
            let event_ids = serde_json::from_str(&ids).map_err(text)?;
            Ok((expected_epoch, event_ids))
        }).transpose()
    }

    fn set_waiting_for_commit(
        &mut self,
        room_id: &str,
        expected_epoch: u64,
        event_ids: &[String],
    ) -> Result<(), String> {
        let ids = serde_json::to_string(event_ids).map_err(text)?;
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta.execute(
            "INSERT INTO client_waiting_for_commit (room_id, expected_epoch, event_ids, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(room_id) DO UPDATE SET expected_epoch = excluded.expected_epoch,
               event_ids = excluded.event_ids, updated_at = excluded.updated_at",
            rusqlite::params![room_id, expected_epoch as i64, ids, updated_at],
        ).map_err(text)?;
        Ok(())
    }

    fn clear_waiting_for_commit(&mut self, room_id: &str) -> Result<(), String> {
        self.meta.execute(
            "DELETE FROM client_waiting_for_commit WHERE room_id = ?1",
            [room_id],
        ).map_err(text)?;
        Ok(())
    }

    fn commit_hash(&self, bytes: &[u8]) -> Result<String, String> {
        let digest = self.crypto.hash(HashType::Sha2_256, bytes).map_err(text)?;
        Ok(hex_encode(&digest))
    }

    fn quarantine_commit(
        &mut self,
        room_id: &str,
        epoch: u64,
        bytes: &[u8],
        reason: &str,
    ) -> Result<(), String> {
        let commit_hash = self.commit_hash(bytes)?;
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta.execute(
            "INSERT OR IGNORE INTO client_commit_quarantine
             (room_id, epoch, commit_hash, reason, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![room_id, epoch as i64, commit_hash, reason, created_at],
        ).map_err(text)?;
        Ok(())
    }

    fn commit_is_quarantined(
        &self,
        room_id: &str,
        epoch: u64,
        bytes: &[u8],
    ) -> Result<Option<String>, String> {
        let commit_hash = self.commit_hash(bytes)?;
        self.meta.query_row(
            "SELECT reason FROM client_commit_quarantine
             WHERE room_id = ?1 AND epoch = ?2 AND commit_hash = ?3",
            rusqlite::params![room_id, epoch as i64, commit_hash],
            |row| row.get(0),
        ).optional().map_err(text)
    }

    pub fn quarantined_commit_reason(
        &self,
        room_id: &str,
        epoch: u64,
    ) -> Result<Option<String>, String> {
        self.meta.query_row(
            "SELECT reason FROM client_commit_quarantine
             WHERE room_id = ?1 AND epoch = ?2 ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![room_id, epoch as i64],
            |row| row.get(0),
        ).optional().map_err(text)
    }

    pub fn welcome_receipt_status(
        &self,
        welcome_id: i64,
    ) -> Result<Option<(String, Option<String>, bool)>, String> {
        self.meta.query_row(
            "SELECT outcome, reason, acked_at FROM client_welcome_receipts WHERE welcome_id = ?1",
            [welcome_id],
            |row| {
                let outcome: String = row.get(0)?;
                let reason: Option<String> = row.get(1)?;
                let acked_at: Option<i64> = row.get(2)?;
                Ok((outcome, reason, acked_at.is_some()))
            },
        ).optional().map_err(text)
    }

    fn sync_room(&mut self, room_id: &str, out: &mut Vec<Incoming>) -> Result<(), String> {
        if let Some(reason) = self.desync_reason(room_id)? {
            if reason.starts_with("RecoveryRequired:") {
                return Err(reason);
            }
        }
        // Journaled membership commits are replayed before room sync. Clear only
        // an unjournaled legacy pending commit, then apply server-authoritative commits.
        self.clear_local_pending_commit(room_id)?;
        let local_epoch = self
            .groups
            .get(room_id)
            .ok_or("комната не создана на этом устройстве")?
            .mls
            .epoch()
            .as_u64();
        let remote_epoch = self.server_epoch(room_id)?;
        if local_epoch > remote_epoch {
            let reason = format!(
                "локальная MLS эпоха {local_epoch} выше серверной {remote_epoch}; автоматическая синхронизация небезопасна"
            );
            self.record_desync(room_id, &reason)?;
            return Err(format!("RecoveryRequired: {reason}"));
        }
        let events = self.call("GET", &format!("/rooms/{}/events", urlencoding::encode(room_id)), None)?;
        let event_rows = events["events"].as_array()
            .ok_or_else(|| "ошибка контракта ответа: events отсутствует или не массив".to_string())?
            .clone();
        let mut pending: Vec<(u64, String, Vec<u8>, Option<String>)> = Vec::new();
        for ev in event_rows {
            let event_id = match event_id_from_event(&ev) {
                Ok(event_id) => event_id,
                // A malformed event_id is a server response-contract error, not
                // MLS state corruption. Leave the event unprocessed so a repaired
                // response can be retried, and isolate this room for this sync pass.
                Err(error) => return Err(error),
            };
            let Some(content) = ev.get("content").and_then(Value::as_object) else { continue };
            let Some(mls_value) = content.get("mls") else { continue };
            let mls_b64 = mls_value.as_str()
                .ok_or_else(|| "ошибка контракта ответа: event content.mls не строка".to_string())?;
            let outer_file_id = match content.get("file") {
                Some(Value::String(file_id)) if !file_id.trim().is_empty() => Some(file_id.clone()),
                Some(_) => return Err("ошибка контракта ответа: event content.file не строка или пустой".to_string()),
                None => None,
            };
            if self.processed.contains(&event_id) {
                continue;
            }
            let bytes = match B64.decode(mls_b64) {
                Ok(bytes) => bytes,
                Err(error) => {
                    let incoming = self.persist_unreadable(
                        room_id,
                        &event_id,
                        &format!("MLS event payload is not valid base64: {error}"),
                    )?;
                    out.push(incoming);
                    continue;
                }
            };
            let protocol = match MlsMessageIn::tls_deserialize_exact(&bytes)
                .map_err(text)
                .and_then(|message| message.try_into_protocol_message().map_err(text))
            {
                Ok(protocol) => protocol,
                Err(error) => {
                    let incoming = self.persist_unreadable(
                        room_id,
                        &event_id,
                        &format!("MLS event payload is malformed: {error}"),
                    )?;
                    out.push(incoming);
                    continue;
                }
            };
            pending.push((protocol.epoch().as_u64(), event_id, bytes, outer_file_id));
        }
        let current = self.groups.get(room_id).ok_or("комната не создана на этом устройстве")?.mls.epoch().as_u64();
        let commits = self.call(
            "GET",
            &format!("/mls/groups/{}/commits?since={current}", urlencoding::encode(room_id)),
            None,
        ).map_err(|error| {
            if is_retryable(&error) {
                format!("временная ошибка загрузки Commit: {error}")
            } else {
                error
            }
        })?;
        let commit_rows = commits["commits"].as_array()
            .ok_or_else(|| "ошибка контракта ответа: commits отсутствует или не массив".to_string())?
            .clone();
        let mut parsed_commits: Vec<(u64, Vec<u8>, Value)> = Vec::new();
        for commit in commit_rows {
            let epoch = commit["epoch"].as_u64()
                .ok_or_else(|| "ошибка контракта ответа: у Commit отсутствует epoch".to_string())?;
            let encoded = commit["commit"].as_str()
                .ok_or_else(|| "ошибка контракта ответа: Commit не является строкой".to_string())?;
            let bytes = match B64.decode(encoded) {
                Ok(bytes) => bytes,
                Err(error) => {
                    let reason = format!("Commit base64 is invalid: {error}");
                    self.quarantine_commit(room_id, epoch, encoded.as_bytes(), &reason)?;
                    self.record_desync(room_id, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
            };
            parsed_commits.push((epoch, bytes, commit));
        }
        let commits = parsed_commits;

        let join_epoch = self.groups[room_id].join_epoch;
        let before_join: Vec<String> = pending.iter().filter(|(e, _, _, _)| *e < join_epoch).map(|(_, id, _, _)| id.clone()).collect();
        for event_id in before_join {
            self.mark_processed(&event_id)?;
        }
        loop {
            let epoch = self.groups[room_id].mls.epoch().as_u64();
            let ready: Vec<(String, Vec<u8>, Option<String>)> = pending
                .iter()
                .filter(|(e, id, _, _)| *e == epoch && !self.processed.contains(id))
                .map(|(_, id, b, file_id)| (id.clone(), b.clone(), file_id.clone()))
                .collect();
            for (event_id, bytes, file_id) in ready {
                let incoming = self.process_and_persist_incoming(room_id, &event_id, &bytes, file_id.as_deref())?;
                out.push(incoming);
            }
            let Some((commit_epoch, commit, metadata)) = commits.iter().find(|(e, _, _)| *e == epoch + 1) else { break };
            if let Some(reason) = self.commit_is_quarantined(room_id, *commit_epoch, commit)? {
                let recovery = format!("Commit epoch {commit_epoch} already quarantined: {reason}");
                self.record_desync(room_id, &recovery)?;
                return Err(format!("RecoveryRequired: {recovery}"));
            }
            self.process_and_merge_commit(room_id, *commit_epoch, commit, metadata)?;
        }
        // Late events within the retained epoch window remain decryptable; older ones
        // are durably recorded as unreadable instead of silently discarded.
        let final_epoch = self.groups[room_id].mls.epoch().as_u64();
        let late: Vec<(String, Vec<u8>, u64, Option<String>)> = pending.iter()
            .filter(|(epoch, event_id, _, _)| *epoch < final_epoch && !self.processed.contains(event_id))
            .map(|(epoch, event_id, bytes, file_id)| (event_id.clone(), bytes.clone(), *epoch, file_id.clone()))
            .collect();
        for (event_id, bytes, epoch, file_id) in late {
            if final_epoch.saturating_sub(epoch) > MAX_PAST_EPOCHS as u64 {
                let incoming = self.persist_unreadable(
                    room_id,
                    &event_id,
                    "event epoch is outside the retained MLS epoch window; rejoin is required",
                )?;
                out.push(incoming);
            } else {
                let incoming = self.process_and_persist_incoming(room_id, &event_id, &bytes, file_id.as_deref())?;
                out.push(incoming);
            }
        }

        let future_event_ids: Vec<String> = pending.iter()
            .filter(|(epoch, event_id, _, _)| *epoch > final_epoch && !self.processed.contains(event_id))
            .map(|(_, event_id, _, _)| event_id.clone())
            .collect();
        if !future_event_ids.is_empty() {
            self.set_waiting_for_commit(room_id, final_epoch.saturating_add(1), &future_event_ids)?;
        } else if remote_epoch > final_epoch {
            self.set_waiting_for_commit(room_id, final_epoch.saturating_add(1), &[])?;
        } else if let Some((expected_epoch, _)) = self.waiting_for_commit(room_id)? {
            let commit_available = commits.iter().any(|(epoch, _, _)| *epoch == expected_epoch);
            if final_epoch >= expected_epoch || commit_available {
                self.clear_waiting_for_commit(room_id)?;
            }
        }

        self.check_consistency(room_id)?;
        Ok(())
    }

    /// Полная синхронизация: вход по приветствиям и чтение всех комнат устройства.
    pub fn sync(&mut self) -> Result<Vec<Incoming>, String> {
        self.flush_pending_membership_commits()?;
        self.resume_claim_pending_invites()?;
        self.join_welcomes()?;
        let rooms: Vec<String> = self.groups.keys().cloned().collect();
        let mut out = Vec::new();
        for room in rooms {
            match self.sync_room(&room, &mut out) {
                Ok(()) => {}
                Err(error) if is_not_member_error(&error) => {
                    self.check_consistency(&room)?;
                }
                Err(error)
                    if error.starts_with("RecoveryRequired:")
                        || error.starts_with("ошибка контракта ответа:") =>
                {
                    continue;
                }
                Err(error)
                    if error.contains("временная ошибка")
                        || is_retryable(&error)
                        || is_access_failure(&error) =>
                {
                    return Err(error);
                }
                Err(error) => {
                    self.record_desync(&room, &format!("требуется восстановление состояния: {error}"))?;
                }
            }
        }
        Ok(out)
    }

    /// Ставит текст в очередь отправки: он уйдёт, когда появится связь. Возвращает локальный номер.
    pub fn enqueue_text(&mut self, room_id: &str, plaintext: &str) -> Result<String, String> {
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!("комната рассинхронизирована и требует восстановления: {reason}"));
        }
        let local_id = hex_encode(&self.crypto.random_vec(16).map_err(text)?);
        self.meta
            .execute(
                "INSERT INTO client_outbox (local_id, room_id, body, seq) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM client_outbox))",
                (&local_id, room_id, plaintext),
            )
            .map_err(text)?;
        Ok(local_id)
    }

    /// Returns pending plaintext only from the encrypted SQLCipher outbox so
    /// the UI can restore queued bubbles after an app restart.
    pub fn pending_outbox_for_room_json(&self, room_id: &str) -> Result<String, String> {
        if room_id.trim().is_empty() || room_id.len() > 255 {
            return Err("invalid MLS room id".to_string());
        }
        let mut statement = self.meta.prepare(
            "SELECT local_id, body FROM client_outbox WHERE room_id = ?1 ORDER BY seq"
        ).map_err(text)?;
        let rows = statement.query_map([room_id], |row| {
            Ok(json!({
                "local_id": row.get::<_, String>(0)?,
                "room_id": room_id,
                "text": row.get::<_, String>(1)?,
            }))
        }).map_err(text)?;
        let pending = rows.collect::<Result<Vec<_>, _>>().map_err(text)?;
        serde_json::to_string(&pending).map_err(text)
    }

    /// Сколько сообщений ждут отправки.
    pub fn outbox_len(&self) -> Result<u64, String> {
        let n: i64 = self.meta.query_row("SELECT COUNT(*) FROM client_outbox", [], |r| r.get(0)).map_err(text)?;
        Ok(n as u64)
    }

    /// Отправляет очередь по порядку. Без связи ничего не теряет: возвращает 0, очередь остаётся.
    pub fn flush_outbox(&mut self) -> Result<usize, String> {
        if self.cached_remote_config().maintenance {
            return Ok(0); // очередь не трогаем: сообщения уйдут после обслуживания
        }
        let items: Vec<(String, String, String)> = {
            let mut stmt = self.meta.prepare("SELECT local_id, room_id, body FROM client_outbox ORDER BY seq").map_err(text)?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(text)?;
            rows.collect::<Result<_, _>>().map_err(text)?
        };
        if items.is_empty() {
            return Ok(0);
        }
        match self.sync() {
            Ok(_received) => {},
            Err(e) if is_retryable(&e) => return Ok(0),
            Err(e) => return Err(e),
        }
        let mut sent = 0;
        for (local_id, room_id, body) in items {
            match self.send_text_with_id(&room_id, &body, &local_id) {
                Ok(_) => {
                    // send_text_with_id commits history and removes the outbox row atomically.
                    sent += 1;
                }
                Err(e) if e.contains("комната рассинхронизирована") => continue,
                Err(e) if is_retryable(&e) => break,
                Err(e) => return Err(e),
            }
        }
        Ok(sent)
    }

    /// Returns encrypted-at-rest pending inbox items without consuming them.
    /// The UI must acknowledge only after it has durably accepted the message.
    pub fn pending_incoming(&self) -> Result<Vec<Incoming>, String> {
        let mut stmt = self.meta.prepare(
            "SELECT event_id, room_id, kind, body, client_message_id FROM client_inbox WHERE acknowledged = 0 ORDER BY seq"
        ).map_err(text)?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        }).map_err(text)?;
        let mut incoming = Vec::new();
        for row in rows {
            let (event_id, room_id, kind, body, client_message_id) = row.map_err(text)?;
            incoming.push(incoming_from_row(event_id, room_id, kind, body, client_message_id)?);
        }
        Ok(incoming)
    }

    /// Local MLS rooms restored from the persistent SQLCipher-backed client.
    pub fn local_room_ids(&self) -> Vec<String> {
        let mut room_ids = self.groups.keys().cloned().collect::<Vec<_>>();
        room_ids.sort();
        room_ids
    }

    /// Returns the local encrypted message history for one room.
    pub fn messages_for_room(&self, room_id: &str) -> Result<Vec<Incoming>, String> {
        let mut stmt = self.meta.prepare(
            "SELECT event_id, room_id, kind, body, client_message_id FROM client_inbox WHERE room_id = ?1 ORDER BY seq"
        ).map_err(text)?;
        let rows = stmt.query_map([room_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        }).map_err(text)?;
        let mut incoming = Vec::new();
        for row in rows {
            let (event_id, room_id, kind, body, client_message_id) = row.map_err(text)?;
            incoming.push(incoming_from_row(event_id, room_id, kind, body, client_message_id)?);
        }
        Ok(incoming)
    }

    /// Acknowledges messages only after the application has durably accepted them.
    pub fn acknowledge_incoming(&mut self, event_ids: &[String]) -> Result<(), String> {
        if event_ids.is_empty() {
            return Ok(());
        }
        let tx = self.meta.transaction().map_err(text)?;
        for event_id in event_ids {
            tx.execute("UPDATE client_inbox SET acknowledged = 1 WHERE event_id = ?1", [event_id]).map_err(text)?;
        }
        tx.commit().map_err(text)
    }

    /// Синхронизация с повторами: при сбоях сети ждёт всё дольше, но не дольше `attempts` попыток.
    pub fn sync_retrying(&mut self, attempts: u32, base: Duration) -> Result<Vec<Incoming>, String> {
        with_retry(attempts, base, || self.sync())
    }

    /// Эпоха, которую знает устройство, для комнаты.
    pub fn local_epoch(&self, room_id: &str) -> Option<u64> {
        self.groups.get(room_id).map(|g| g.mls.epoch().as_u64())
    }

    /// Участники группы по их устройствам (`пользователь/устройство`).
    pub fn members_of(&self, room_id: &str) -> Result<Vec<String>, String> {
        let group = self.groups.get(room_id).ok_or("комната не создана на этом устройстве")?;
        Ok(group.mls.members().map(|m| String::from_utf8_lossy(m.credential.serialized_content()).to_string()).collect())
    }

    /// Отзывает устройство аккаунта на сервере: его сессии перестают работать.
    pub fn revoke_device(&self, device_id: &str) -> Result<(), String> {
        self.call("DELETE", &format!("/devices/{}", urlencoding::encode(device_id)), None)?;
        Ok(())
    }

    /// Сколько отозванных устройств ещё стоят в группах и ждут удаления.
    pub fn pending_removals(&self) -> Result<usize, String> {
        let r = self.call("GET", "/mls/removals", None)?;
        Ok(r["removals"].as_array().map(|a| a.len()).unwrap_or(0))
    }

    /// Удаляет из групп отозванные устройства: коммит удаляет их листья и объявляет удаление на сервере.
    pub fn remove_revoked_devices(&mut self) -> Result<usize, String> {
        self.ensure_writable()?;
        if self.flush_pending_membership_commits()? > 0 {
            self.sync()?;
        }
        let mut removed_total = 0usize;
        for attempt in 0..3 {
            let removals = self.call("GET", "/mls/removals", None)?;
            let removal_rows = removals["removals"].as_array()
                .ok_or_else(|| "ошибка контракта ответа: removals отсутствует или не массив".to_string())?
                .clone();
            let mut by_room: HashMap<String, Vec<String>> = HashMap::new();
            for row in removal_rows {
                let room = row["roomId"].as_str().ok_or("нет roomId")?.to_string();
                let device = row["deviceId"].as_str().ok_or("нет deviceId")?.to_string();
                by_room.entry(room).or_default().push(device);
            }
            let mut must_rebase = false;
            for (room_id, mut devices) in by_room {
                if !self.groups.contains_key(&room_id) || self.desync_reason(&room_id)?.is_some() {
                    continue;
                }
                devices.sort();
                devices.dedup();
                let server = self.server_epoch(&room_id)?;
                let local = self.groups.get(&room_id)
                    .map(|group| group.mls.epoch().as_u64())
                    .ok_or("комната не найдена")?;
                if local != server {
                    must_rebase = true;
                    break;
                }
                let identities: Vec<Vec<u8>> = devices.iter()
                    .map(|device| format!("{}/{}", self.user_id, device).into_bytes())
                    .collect();
                let operation_id = hex_encode(&self.crypto.random_vec(16).map_err(text)?);
                let transaction = self.meta.transaction().map_err(text)?;
                let staged = (|| -> Result<(), String> {
                    let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
                    let group = self.groups.get_mut(&room_id).ok_or("комната не найдена")?;
                    let leaves: Vec<LeafNodeIndex> = group.mls.members()
                        .filter(|member| identities.iter().any(|identity|
                            member.credential.serialized_content() == identity.as_slice()
                        ))
                        .map(|member| member.index)
                        .collect();
                    if leaves.is_empty() {
                        return Err(format!(
                            "P0.2: нет MLS leaf для отзываемых устройств в комнате {room_id}; commit не отправлен"
                        ));
                    }
                    let (commit, _, _) = group.mls
                        .remove_members(&provider, &self.signer, &leaves)
                        .map_err(text)?;
                    let commit_bytes = commit.tls_serialize_detached().map_err(text)?;
                    let changes = json!({ "adds": [], "removes": [], "removeDevices": devices });
                    let payload = json!({
                        "epoch": local,
                        "commit": B64.encode(&commit_bytes),
                        "changes": changes,
                        "welcomes": [],
                        "clientOperationId": operation_id,
                    });
                    let metadata = json!({ "changes": changes, "welcomeRecipients": [] });
                    let pending = group.mls.pending_commit()
                        .ok_or("OpenMLS did not retain staged device-removal commit")?;
                    verify_staged_membership_metadata(&group.mls, pending, &metadata)?;
                    let fingerprint = membership_commit_fingerprint(
                        &self.crypto, &room_id, &operation_id, local, &payload, pending,
                    )?;
                    let payload_json = serde_json::to_string(&payload).map_err(text)?;
                    let created_at = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    transaction.execute(
                        "INSERT INTO client_membership_commits
                         (operation_id, room_id, base_epoch, fingerprint, payload, claim_ids, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, '[]', ?6)",
                        rusqlite::params![operation_id, room_id, local as i64, fingerprint, payload_json, created_at],
                    ).map_err(text)?;
                    Ok(())
                })();
                if let Err(error) = staged {
                    drop(transaction);
                    self.reload_group(&room_id)?;
                    if error.starts_with("P0.2:") {
                        self.record_desync(&room_id, &error)?;
                        return Err(format!("RecoveryRequired: {error}"));
                    }
                    return Err(error);
                }
                if let Err(error) = transaction.commit() {
                    self.reload_group(&room_id)?;
                    return Err(format!("не удалось зафиксировать device-removal journal: {}", text(error)));
                }
                if self.flush_pending_membership_commits()? > 0 {
                    must_rebase = true;
                    break;
                }
                removed_total += devices.len();
            }
            if !must_rebase {
                return Ok(removed_total);
            }
            self.sync()?;
            if attempt == 2 {
                return Err("epoch_outdated: исчерпаны попытки безопасного rebasing device removal".to_string());
            }
        }
        Err("device removal не удалось применить после rebasing".to_string())
    }

}

#[cfg(test)]
mod retry_tests {
    use super::*;

    #[test]
    fn openmls_storage_writes_participate_in_the_outer_sqlite_transaction() {
        let mut connection = Connection::open_in_memory().unwrap();
        {
            let mut storage =
                SqliteStorageProvider::<JsonCodec, &mut Connection>::new(&mut connection);
            storage.run_migrations().unwrap();
        }

        let crypto = RustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
        let public = signer.to_public_vec();

        {
            let transaction = connection.transaction().unwrap();
            let provider =
                DeviceProvider::new(&crypto, TransactionConnection(&transaction));
            signer.store(provider.storage()).unwrap();
            // Drop without commit: OpenMLS storage writes must roll back with the outer tx.
        }

        let provider = DeviceProvider::new(&crypto, &connection);
        assert!(
            SignatureKeyPair::read(
                provider.storage(),
                &public,
                CIPHERSUITE.signature_algorithm()
            )
            .is_none(),
            "rolled-back OpenMLS state must not remain visible"
        );
        drop(provider);

        let transaction = connection.transaction().unwrap();
        let provider = DeviceProvider::new(&crypto, TransactionConnection(&transaction));
        signer.store(provider.storage()).unwrap();
        drop(provider);
        transaction.commit().unwrap();

        let provider = DeviceProvider::new(&crypto, &connection);
        assert!(
            SignatureKeyPair::read(
                provider.storage(),
                &public,
                CIPHERSUITE.signature_algorithm()
            )
            .is_some(),
            "committed OpenMLS state must be visible"
        );
    }

    #[test]
    fn existing_database_with_wrong_protected_key_is_rejected_without_replacement() {
        let scope = "alice/device-key-mismatch";
        let correct_key = [0x31u8; 32];
        let wrong_key = [0x73u8; 32];
        let database_path = std::env::temp_dir().join(format!(
            "inone-mls-key-mismatch-{}-{}.sqlcipher",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let database_path = database_path.to_string_lossy().into_owned();

        let keys = MemoryKeyStore::default();
        keys.keys
            .lock()
            .unwrap()
            .insert(scope.to_string(), wrong_key);

        let mut database = open_db(&database_path, &correct_key).unwrap();
        {
            let mut storage =
                SqliteStorageProvider::<JsonCodec, &mut Connection>::new(&mut database);
            storage.run_migrations().unwrap();
        }
        drop(database);

        // Fresh-login entrypoints converge on build_client_with_keys. A present
        // but wrong key must fail closed without deleting or replacing the DB/key.
        let result = build_client_with_keys(
            ureq::AgentBuilder::new().redirects(0).build(),
            "https://api.inone.test",
            ("access".to_string(), "refresh".to_string()),
            "alice",
            "device-key-mismatch",
            &database_path,
            &keys,
        );

        assert!(result.is_err(), "a mismatched SQLCipher key must be rejected");
        assert!(database_artifacts_exist(&database_path));
        assert_eq!(
            keys.existing_database_key(scope).unwrap(),
            Some(wrong_key),
            "the existing protected key must not be replaced"
        );
        let still_readable_with_original_key = open_db(&database_path, &correct_key).unwrap();
        drop(still_readable_with_original_key);
        remove_database_artifacts(&database_path).unwrap();
    }

    #[test]
    fn failed_new_session_initialization_removes_partial_database_and_key() {
        let scope = "alice/device-partial-init";
        let keys = MemoryKeyStore::default();
        let root = std::env::temp_dir().join(format!(
            "inone-mls-partial-init-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let database_path = root.join("missing-parent").join("device.sqlcipher");
        let database_path = database_path.to_string_lossy().into_owned();

        // The parent directory is intentionally absent. The platform key is
        // created first; opening the DB then fails and both partial artifacts
        // and the newly-created key must be cleaned.
        let result = build_client_with_keys(
            ureq::AgentBuilder::new().redirects(0).build(),
            "https://api.inone.test",
            ("access".to_string(), "refresh".to_string()),
            "alice",
            "device-partial-init",
            &database_path,
            &keys,
        );

        assert!(result.is_err());
        assert_eq!(keys.existing_database_key(scope).unwrap(), None);
        assert!(
            !database_artifacts_exist(&database_path),
            "failed initialization must not leave a partial SQLCipher database"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn process_crash_rolls_back_openmls_storage_and_inbox_atomically() {
        const CHILD_DATABASE_ENV: &str = "INONE_MLS_CRASH_TEST_CHILD_DATABASE";
        const TEST_KEY: [u8; 32] = [0x42; 32];

        if let Ok(database_path) = std::env::var(CHILD_DATABASE_ENV) {
            let mut connection = open_db(&database_path, &TEST_KEY).unwrap();
            connection
                .pragma_update(None, "journal_mode", "WAL")
                .unwrap();
            let transaction = connection.transaction().unwrap();
            let crypto = RustCrypto::default();
            let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
            let public = signer.to_public_vec();

            {
                let provider =
                    DeviceProvider::new(&crypto, TransactionConnection(&transaction));
                signer.store(provider.storage()).unwrap();
                insert_incoming_record(
                    &transaction,
                    &Incoming::Text {
                        room_id: "room-crash".to_string(),
                        event_id: "event-crash".to_string(),
                        text: "must commit with ratchet state".to_string(),
                        mine: false,
                    },
                )
                .unwrap();
            }

            std::fs::write(format!("{database_path}.public"), &public).unwrap();
            // Deliberately bypass Rust destructors: SQLite must recover the
            // uncommitted WAL transaction after the child process exits.
            std::process::exit(86);
        }

        let database_path = std::env::temp_dir().join(format!(
            "inone-mls-process-crash-{}-{}.sqlcipher",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let database_path = database_path.to_string_lossy().into_owned();
        let mut connection = open_db(&database_path, &TEST_KEY).unwrap();
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        {
            let mut storage =
                SqliteStorageProvider::<JsonCodec, &mut Connection>::new(&mut connection);
            storage.run_migrations().unwrap();
        }
        connection
            .execute_batch(
                "CREATE TABLE client_inbox (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    room_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    body TEXT,
                    acknowledged INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE TABLE client_processed (event_id TEXT PRIMARY KEY);",
            )
            .unwrap();
        drop(connection);

        let child_status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("retry_tests::process_crash_rolls_back_openmls_storage_and_inbox_atomically")
            .arg("--nocapture")
            .env(CHILD_DATABASE_ENV, &database_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert_eq!(
            child_status.code(),
            Some(86),
            "child must terminate with an uncommitted transaction"
        );

        let public = std::fs::read(format!("{database_path}.public")).unwrap();
        let connection = open_db(&database_path, &TEST_KEY).unwrap();
        let crypto = RustCrypto::default();
        let provider = DeviceProvider::new(&crypto, &connection);
        assert!(
            SignatureKeyPair::read(
                provider.storage(),
                &public,
                CIPHERSUITE.signature_algorithm()
            )
            .is_none(),
            "uncommitted OpenMLS storage material must not survive process death"
        );
        drop(provider);

        let inbox_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM client_inbox WHERE event_id = 'event-crash'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let processed_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM client_processed WHERE event_id = 'event-crash'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(inbox_count, 0, "inbox plaintext must roll back with ratchet state");
        assert_eq!(processed_count, 0, "processed marker must roll back with inbox and ratchet");

        drop(connection);
        remove_database_artifacts(&database_path).unwrap();
        let _ = std::fs::remove_file(format!("{database_path}.public"));
    }

    #[test]
    fn logout_clears_local_session_tokens_when_server_is_unavailable() {
        let scope = "alice/logout-offline";
        let keys = MemoryKeyStore::default();
        let database_path = std::env::temp_dir().join(format!(
            "inone-mls-logout-offline-{}-{}.sqlcipher",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let database_path = database_path.to_string_lossy().into_owned();

        let client = build_client_with_keys(
            ureq::AgentBuilder::new().redirects(0).build(),
            "https://127.0.0.1:1",
            ("access-token".to_string(), "refresh-token".to_string()),
            "alice",
            "logout-offline",
            &database_path,
            &keys,
        )
        .unwrap();

        assert_eq!(client.access_token_snapshot().unwrap(), "access-token");
        let error = client
            .logout()
            .expect_err("unreachable server must be reported");
        assert!(
            error.contains("локальные токены очищены"),
            "server failure must be explicit"
        );
        assert_eq!(
            client.access_token_snapshot().unwrap(),
            "",
            "in-memory access and refresh tokens must be cleared"
        );
        let token_rows: i64 = client
            .meta
            .query_row(
                "SELECT COUNT(*) FROM client_meta WHERE key = 'session_tokens'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(token_rows, 0, "refresh tokens must be removed from SQLCipher");

        drop(client);
        remove_database_artifacts(&database_path).unwrap();
        keys.delete_database_key(scope).unwrap();
    }

    #[test]
    fn rejected_local_commit_can_be_cleared_without_advancing_epoch() {
        let mut connection = Connection::open_in_memory().unwrap();
        {
            let mut storage =
                SqliteStorageProvider::<JsonCodec, &mut Connection>::new(&mut connection);
            storage.run_migrations().unwrap();
        }
        let crypto = RustCrypto::default();
        let provider = DeviceProvider::new(&crypto, &connection);
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).unwrap();
        let credential = CredentialWithKey {
            credential: BasicCredential::new(b"alice/device-1".to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(MAX_PAST_EPOCHS)
            .build();
        let mut group = MlsGroup::new_with_group_id(
            &provider,
            &signer,
            &config,
            GroupId::from_slice(b"!pending-commit:inone.test"),
            credential,
        )
        .unwrap();
        let epoch_before = group.epoch().as_u64();

        group
            .self_update(&provider, &signer, LeafNodeParameters::default())
            .unwrap();
        group.clear_pending_commit(provider.storage()).unwrap();

        assert_eq!(group.epoch().as_u64(), epoch_before);
        group
            .create_message(&provider, &signer, b"still-operational")
            .unwrap();
    }

    #[test]
    fn existing_database_without_a_protected_key_is_rejected() {
        let keys = MemoryKeyStore::default();
        let scope = "alice/device-existing-db";
        let filename = format!(
            "inone-mls-existing-db-no-key-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(filename);
        std::fs::write(&path, b"existing encrypted database placeholder").unwrap();

        let result = ensure_existing_key_matches_database(
            path.to_str().unwrap(),
            scope,
            &keys,
        );

        assert!(result.is_err());
        assert_eq!(keys.existing_database_key(scope).unwrap(), None);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn resuming_without_an_existing_key_never_creates_a_replacement_key() {
        let keys = MemoryKeyStore::default();
        let scope = "alice/device-restore";
        let filename = format!(
            "inone-mls-missing-key-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(filename);
        std::fs::write(&path, b"existing encrypted database placeholder").unwrap();

        let result = resume_with_session(
            "https://api.inone.test",
            "alice",
            "device-restore",
            path.to_str().unwrap(),
            &keys,
        );

        assert!(result.is_err());
        assert_eq!(keys.existing_database_key(scope).unwrap(), None);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn event_ids_must_be_present_and_non_empty() {
        assert_eq!(
            event_id_from_event(&json!({"event_id": "$event-1"})).unwrap(),
            "$event-1"
        );
        assert!(event_id_from_event(&json!({})).is_err());
        assert!(event_id_from_event(&json!({"event_id": ""})).is_err());
        assert!(event_id_from_event(&json!({"event_id": "  "})).is_err());
    }

    #[test]
    fn network_and_server_errors_are_retried_client_errors_are_not() {
        assert!(is_retryable("сеть: connection refused"));
        assert!(is_retryable("GET /x -> 503 unavailable"));
        assert!(is_retryable("POST /y -> 429 slow down"));
        assert!(!is_retryable("GET /x -> 401 unauthorized"));
        assert!(!is_retryable("POST /z -> 409 conflict"));
        assert!(!is_retryable("неизвестная ошибка"));
    }

    #[test]
    fn replayed_inbox_event_does_not_reset_acknowledgement_or_replace_content() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE client_inbox (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                room_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                body TEXT,
                acknowledged INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE client_processed (event_id TEXT PRIMARY KEY);",
        )
        .unwrap();

        let original = Incoming::Text {
            room_id: "!room:inone.test".to_string(),
            event_id: "$event-1".to_string(),
            text: "original".to_string(),
            mine: false,
        };
        persist_incoming_record(&mut db, &original).unwrap();
        db.execute(
            "UPDATE client_inbox SET acknowledged = 1 WHERE event_id = ?1",
            ["$event-1"],
        )
        .unwrap();

        let replay = Incoming::Text {
            room_id: "!room:inone.test".to_string(),
            event_id: "$event-1".to_string(),
            text: "replayed".to_string(),
            mine: false,
        };
        persist_incoming_record(&mut db, &replay).unwrap();

        let (acknowledged, body): (i64, String) = db
            .query_row(
                "SELECT acknowledged, body FROM client_inbox WHERE event_id = ?1",
                ["$event-1"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(acknowledged, 1);
        assert_eq!(body, "original");
        let processed: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM client_processed WHERE event_id = ?1",
                ["$event-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(processed, 1);
    }

    #[test]
    fn retry_stops_on_success_and_on_fatal_errors() {
        let mut calls = 0;
        let ok: Result<u32, String> = with_retry(5, Duration::ZERO, || {
            calls += 1;
            if calls < 3 { Err("сеть: нет связи".to_string()) } else { Ok(calls) }
        });
        assert_eq!(ok, Ok(3));
        let mut calls = 0;
        let fatal: Result<(), String> = with_retry(5, Duration::ZERO, || {
            calls += 1;
            Err("GET /x -> 401 нет доступа".to_string())
        });
        assert!(fatal.is_err());
        assert_eq!(calls, 1, "ошибка доступа не повторяется");
        let mut calls = 0;
        let gave_up: Result<(), String> = with_retry(3, Duration::ZERO, || {
            calls += 1;
            Err("сеть: нет связи".to_string())
        });
        assert!(gave_up.is_err());
        assert_eq!(calls, 3, "не больше заданного числа попыток");
    }
    #[test]
    fn api_origin_requires_tls_outside_local_debug_hosts() {
        assert_eq!(
            normalize_base_url("https://api.inone.test/").unwrap(),
            "https://api.inone.test"
        );
        assert!(normalize_base_url("http://api.inone.test").is_err());
        assert!(normalize_base_url("ftp://api.inone.test").is_err());
        assert!(normalize_base_url("https://user:secret@api.inone.test").is_err());
        assert!(normalize_base_url("https://api.inone.test?token=secret").is_err());
        #[cfg(debug_assertions)]
        {
            assert_eq!(
                normalize_base_url("http://10.0.2.2:8080/").unwrap(),
                "http://10.0.2.2:8080"
            );
            assert!(normalize_base_url("http://192.168.1.20:8080").is_ok());
            assert!(normalize_base_url("http://localhost:8080").is_ok());
        }
    }

    #[test]
    fn zeroize_json_value_clears_nested_secret_strings() {
        let mut value = json!({
            "token": "access-secret",
            "refreshToken": "refresh-secret",
            "nested": ["approval-code", {"pollSecret": "poll-secret"}],
            "public": 7
        });

        zeroize_json_value(&mut value);

        assert_eq!(value["token"], "");
        assert_eq!(value["refreshToken"], "");
        assert_eq!(value["nested"][0], "");
        assert_eq!(value["nested"][1]["pollSecret"], "");
        assert_eq!(value["public"], 7);
    }

}
