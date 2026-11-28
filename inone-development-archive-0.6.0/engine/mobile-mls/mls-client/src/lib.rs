//! Ядро клиента InOne на Rust: вход, ключевые пакеты, группы MLS, сообщения, догон после отсутствия,
//! вход нового устройства по подтверждению и удаление отозванных устройств из групп.
//! База устройства зашифрована (SQLCipher). Ключ передаёт платформа: Keychain на iOS, Keystore на Android.
use std::borrow::Borrow;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use zeroize::{Zeroize, Zeroizing};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::RustCrypto;
use openmls_sqlite_storage::{Codec, Connection, SqliteStorageProvider};
use openmls_traits::{crypto::OpenMlsCrypto, random::OpenMlsRand, types::HashType};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use url::Url;

pub mod attachment_crypto;
pub mod remote_config;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
/// Сколько прошлых эпох хранит группа (см. mls-bridge: по умолчанию OpenMLS не хранит ни одной).
const MAX_PAST_EPOCHS: usize = 16;

fn ensure_supported_welcome_ciphersuite(suite: Ciphersuite) -> Result<(), String> {
    if suite == CIPHERSUITE {
        Ok(())
    } else {
        Err("unsupported MLS ciphersuite; only X25519/Ed25519 is enabled".to_string())
    }
}

fn parse_signed_object_url(base_raw: &str, raw_url: &str) -> Result<Url, String> {
    let base = Url::parse(base_raw).map_err(text)?;
    let target = Url::parse(raw_url).map_err(text)?;

    // Check schemes before origin(): url <= 2.5.8 recursively evaluated nested blob: URLs.
    if !matches!(base.scheme(), "http" | "https") || !matches!(target.scheme(), "http" | "https") {
        return Err("signed object URL must use HTTP or HTTPS".to_string());
    }

    if base.origin() != target.origin()
        || !target.username().is_empty()
        || target.password().is_some()
        || target.fragment().is_some()
        || !target.path().starts_with("/objects/")
    {
        return Err(
            "signed object URL must remain on the authenticated API origin and /objects path"
                .to_string(),
        );
    }
    Ok(target)
}

/// Класс ошибки обработки сообщения (аудит, P0.1). Временная — событие не помечается обработанным,
/// повтор при следующей синхронизации. Постоянная — сообщение нельзя расшифровать, причина пишется в диагностику.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Failure {
    Transient,
    Permanent(&'static str),
}

pub(crate) fn classify_process_error<S>(e: &openmls::prelude::ProcessMessageError<S>) -> Failure {
    use openmls::prelude::ProcessMessageError as E;
    match e {
        E::StorageError(_) | E::LibraryError(_) => Failure::Transient,
        E::IncompatibleWireFormat => Failure::Permanent("несовместимый формат сообщения"),
        E::ValidationError(_) => Failure::Permanent("проверка сообщения не пройдена"),
        E::GroupStateError(_) => Failure::Permanent("состояние группы не подходит для сообщения"),
        E::InvalidCommit(_) => Failure::Permanent("недопустимый коммит"),
        E::UnauthorizedExternalApplicationMessage | E::UnauthorizedExternalCommitMessage => {
            Failure::Permanent("отправитель вне группы")
        }
        _ => Failure::Permanent("сообщение не поддерживается"),
    }
}

/// Что получено из комнаты при синхронизации.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Text {
        room_id: String,
        event_id: String,
        text: String,
        mine: bool,
    },
    Attachment {
        room_id: String,
        event_id: String,
        file_id: String,
        name: String,
        mime_type: String,
        size: u64,
        mine: bool,
    },
    Unreadable {
        room_id: String,
        event_id: String,
        mine: bool,
    },
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

/// Провайдер OpenMLS устройства: криптография в памяти процесса, состояние групп — в зашифрованной базе.
pub struct DeviceProvider<ConnectionRef = Arc<Connection>>
where
    ConnectionRef: Borrow<Connection>,
{
    crypto: Arc<RustCrypto>,
    storage: SqliteStorageProvider<JsonCodec, ConnectionRef>,
}

impl<ConnectionRef> DeviceProvider<ConnectionRef>
where
    ConnectionRef: Borrow<Connection>,
{
    fn new(crypto: Arc<RustCrypto>, connection: ConnectionRef) -> Self {
        Self {
            crypto,
            storage: SqliteStorageProvider::new(connection),
        }
    }
}

impl<ConnectionRef> OpenMlsProvider for DeviceProvider<ConnectionRef>
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
        &self.crypto
    }
    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
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
    /// Access/refresh tokens are retained only in Rust and zeroized when replaced or dropped.
    tokens: Mutex<SessionTokens>,
    user_id: String,
    device_id: String,
    agent: ureq::Agent,
    crypto: Arc<RustCrypto>,
    provider: DeviceProvider<Arc<Connection>>,
    /// Соединение с той же базой для собственных таблиц клиента (комнаты, обработанные события, метаданные).
    meta: Arc<Connection>,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    groups: HashMap<String, Group>,
    processed: HashSet<String>,
    /// Сообщения, полученные при отправке из очереди: их забирает приложение через take_incoming().
    inbox: Vec<Incoming>,
}

// SAFETY: rusqlite::Connection is Send but not Sync. Client's connection Arcs
// are private implementation details: every alias (the OpenMLS provider,
// metadata handle, and transaction-scoped providers) stays inside this Client
// and is accessed only during one exclusive Client operation. Client is not
// Sync, so shared concurrent access is impossible. The Flutter bridge stores
// Client only behind MlsSession::client's Mutex, which serializes every call.
unsafe impl Send for Client {}

fn text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// Debug-build-only process-kill hook used by integration tests to prove rollback
// across an actual process boundary. It is absent from optimized production builds.
#[cfg(debug_assertions)]
fn crash_at_test_failpoint(point: &str) {
    if std::env::var("INONE_MLS_TEST_CRASH_POINT").ok().as_deref() == Some(point) {
        eprintln!("INONE_MLS_TEST_CRASH_POINT_REACHED={point}");
        std::process::abort();
    }
}

#[cfg(not(debug_assertions))]
#[inline(always)]
fn crash_at_test_failpoint(_: &str) {}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Открывает зашифрованную базу. Неверный ключ сразу даёт ошибку.
fn open_db(path: &str, key: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(text)?;
    conn.pragma_update(None, "key", format!("x'{}'", hex_encode(key)))
        .map_err(text)?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| "неверный ключ базы устройства или файл повреждён".to_string())?;
    Ok(conn)
}

const MAX_PENDING_INBOX_ITEMS: i64 = 10_000;
const MAX_PENDING_INBOX_BYTES: i64 = 32 * 1024 * 1024;
const ACKNOWLEDGED_INBOX_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

fn insert_incoming_record(db: &Connection, incoming: &Incoming) -> Result<(), String> {
    let (event_id, room_id, kind, body): (&str, &str, &str, Option<String>) = match incoming {
        Incoming::Text {
            room_id,
            event_id,
            text,
            ..
        } => (event_id, room_id, "text", Some(text.clone())),
        Incoming::Attachment {
            room_id,
            event_id,
            file_id,
            name,
            mime_type,
            size,
            ..
        } => (
            event_id,
            room_id,
            "text",
            Some(
                serde_json::to_string(&json!({
                    "fileId": file_id,
                    "name": name,
                    "mimeType": mime_type,
                    "size": size,
                }))
                .map_err(text)?,
            ),
        ),
        Incoming::Unreadable {
            room_id, event_id, ..
        } => (event_id, room_id, "unreadable", None),
    };
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM client_inbox WHERE event_id = ?1)",
            [event_id],
            |row| row.get(0),
        )
        .map_err(text)?;
    if exists {
        return Ok(());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    crash_at_test_failpoint("before_inbox_retention_cleanup");
    db.execute(
        "DELETE FROM client_inbox
         WHERE acknowledged = 1 AND acknowledged_at IS NOT NULL AND acknowledged_at < ?1",
        [now - ACKNOWLEDGED_INBOX_RETENTION_MS],
    )
    .map_err(text)?;
    crash_at_test_failpoint("after_inbox_retention_cleanup");

    let (pending_count, pending_bytes): (i64, i64) = db
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0)
             FROM client_inbox WHERE acknowledged = 0",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(text)?;
    let body_bytes = body.as_ref().map_or(0, |value| value.len()) as i64;
    if pending_count >= MAX_PENDING_INBOX_ITEMS
        || pending_bytes.saturating_add(body_bytes) > MAX_PENDING_INBOX_BYTES
    {
        return Err(
            "durable inbox capacity reached; event remains unprocessed for retry".to_string(),
        );
    }

    crash_at_test_failpoint("before_inbox_insert");
    db.execute(
        "INSERT OR IGNORE INTO client_inbox (event_id, room_id, kind, body, acknowledged, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        rusqlite::params![event_id, room_id, kind, body, now],
    )
    .map_err(text)?;
    crash_at_test_failpoint("after_inbox_insert");
    Ok(())
}

fn insert_attachment_manifest(
    db: &Connection,
    incoming: &Incoming,
    manifest: &[u8],
    direction: &str,
    client_message_id: Option<&str>,
) -> Result<(), String> {
    let Incoming::Attachment {
        room_id,
        event_id,
        file_id,
        ..
    } = incoming
    else {
        return Err("attachment manifest requires an attachment inbox item".to_string());
    };
    if !matches!(direction, "incoming" | "outgoing") {
        return Err("invalid attachment direction".to_string());
    }
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    db.execute(
        "INSERT INTO client_attachments
         (file_id, room_id, event_id, manifest, direction, client_message_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(file_id) DO UPDATE SET
           direction = excluded.direction,
           client_message_id = excluded.client_message_id
         WHERE client_attachments.room_id = excluded.room_id
           AND client_attachments.event_id = excluded.event_id
           AND client_attachments.manifest = excluded.manifest",
        rusqlite::params![
            file_id,
            room_id,
            event_id,
            manifest,
            direction,
            client_message_id,
            created_at
        ],
    )
    .map_err(text)?;
    let stored: (String, String, Vec<u8>, String, Option<String>) = db
        .query_row(
            "SELECT room_id, event_id, manifest, direction, client_message_id
             FROM client_attachments WHERE file_id = ?1",
            [file_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(text)?;
    if stored.0 != *room_id
        || stored.1 != *event_id
        || stored.2.as_slice() != manifest
        || stored.3 != direction
        || stored.4.as_deref() != client_message_id
    {
        return Err("attachment fileId is already bound to a different local event".to_string());
    }
    Ok(())
}

fn incoming_from_row(
    event_id: String,
    room_id: String,
    kind: String,
    body: Option<String>,
    client_message_id: Option<String>,
    file_id: Option<String>,
    manifest: Option<Vec<u8>>,
) -> Result<Incoming, String> {
    let mine = client_message_id.is_some();
    if let Some(file_id) = file_id {
        if !matches!(kind.as_str(), "text" | "unreadable") {
            return Err(format!(
                "attachment index references an invalid inbox kind: {kind}"
            ));
        }
        // The encrypted manifest index is authoritative for attachment metadata.
        // client_inbox.body is a denormalized display cache and can predate a
        // recovered/idempotent handoff; never use it to bind file identity.
        let manifest = manifest.ok_or("в индексе вложения отсутствует manifest")?;
        let parsed = attachment_crypto::parse_manifest(&manifest, &file_id, &room_id)?;
        return Ok(Incoming::Attachment {
            room_id,
            event_id,
            file_id,
            name: parsed.name.clone(),
            mime_type: parsed.mime_type.clone(),
            size: parsed.size,
            mine,
        });
    }
    match kind.as_str() {
        "text" => Ok(Incoming::Text {
            room_id,
            event_id,
            text: body.ok_or("в сохранённом сообщении отсутствует текст")?,
            mine,
        }),
        "unreadable" => Ok(Incoming::Unreadable {
            room_id,
            event_id,
            mine,
        }),
        _ => Err(format!("неизвестный тип локального сообщения: {kind}")),
    }
}

fn insert_processed_event(db: &Connection, event_id: &str) -> Result<(), String> {
    crash_at_test_failpoint("before_processed_marker_insert");
    db.execute(
        "INSERT OR IGNORE INTO client_processed (event_id) VALUES (?1)",
        [event_id],
    )
    .map_err(text)?;
    crash_at_test_failpoint("after_processed_marker_insert");
    Ok(())
}

fn insert_undecryptable_record(
    db: &Connection,
    event_id: &str,
    room_id: &str,
    reason: &str,
) -> Result<(), String> {
    crash_at_test_failpoint("before_undecryptable_marker_insert");
    db.execute(
        "INSERT OR IGNORE INTO client_undecryptable (event_id, room_id, reason)
         VALUES (?1, ?2, ?3)",
        rusqlite::params![event_id, room_id, reason],
    )
    .map_err(text)?;
    crash_at_test_failpoint("after_undecryptable_marker_insert");
    Ok(())
}

fn request(
    agent: &ureq::Agent,
    base: &str,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("{base}{path}");
    let mut req = agent.request(method, &url);
    if !token.is_empty() {
        req = req.set("authorization", &format!("Bearer {token}"));
    }
    let res = match body {
        Some(b) => req.send_json(b),
        None => req.call(),
    };
    match res {
        Ok(r) => r.into_json::<Value>().map_err(text),
        Err(ureq::Error::Status(code, r)) => Err(format!(
            "{method} {path} -> {code} {}",
            r.into_string().unwrap_or_default()
        )),
        Err(e) => Err(format!("сеть: {e}")),
    }
}

fn register(agent: &ureq::Agent, base: &str, user_id: &str, password: &str) -> Result<(), String> {
    match request(
        agent,
        base,
        "",
        "POST",
        "/register",
        Some(json!({ "userId": user_id, "password": password })),
    ) {
        Ok(_) => Ok(()),
        Err(e) if e.contains("-> 409") => Ok(()),
        Err(e) => Err(e),
    }
}

/// Ключ базы устройства. Платформа хранит его в Keychain (iOS) или Keystore (Android).
pub trait KeyStore: Send + Sync {
    /// Checks for an existing key without creating or replacing key material.
    fn has_database_key(&self, scope: &str) -> Result<bool, String>;
    /// Loads an existing key only. A missing key must never be recreated during resume.
    fn existing_database_key(&self, scope: &str) -> Result<Option<[u8; 32]>, String>;
    /// Loads an existing key or creates one for a new encrypted database.
    fn database_key(&self, scope: &str) -> Result<[u8; 32], String>;
    /// Removes the platform-protected key after the encrypted database is deleted.
    fn delete_database_key(&self, scope: &str) -> Result<(), String>;
}

/// Хранилище ключей в памяти: только для тестов.
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApiFailureKind {
    Transport,
    RetryableHttp,
    AuthSession,
    AccessDenied,
    ResourceDeleted,
    Contract,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ApiFailure {
    kind: ApiFailureKind,
    status: Option<u16>,
    code: Option<String>,
}

/// Converts the legacy transport string into a typed API failure at the client boundary.
/// Callers can branch on status/code without confusing authorization with MLS corruption.
fn classify_api_failure(error: &str) -> ApiFailure {
    if error.starts_with("сеть:") {
        return ApiFailure {
            kind: ApiFailureKind::Transport,
            status: None,
            code: None,
        };
    }
    if error.starts_with("ошибка контракта ответа:") {
        return ApiFailure {
            kind: ApiFailureKind::Contract,
            status: None,
            code: None,
        };
    }

    let Some(separator) = error.find(" -> ") else {
        return ApiFailure {
            kind: ApiFailureKind::Other,
            status: None,
            code: None,
        };
    };
    let response = &error[separator + 4..];
    let status_text: String = response
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    let status = status_text.parse::<u16>().ok();
    let body_code = response.find('{').and_then(|start| {
        serde_json::from_str::<Value>(&response[start..])
            .ok()
            .and_then(|body| {
                body.get("code")
                    .or_else(|| body.get("error"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
    });
    let kind = match status {
        Some(401) => ApiFailureKind::AuthSession,
        Some(403) => ApiFailureKind::AccessDenied,
        Some(404) => ApiFailureKind::ResourceDeleted,
        Some(429) | Some(500..=599) => ApiFailureKind::RetryableHttp,
        _ => ApiFailureKind::Other,
    };
    ApiFailure {
        kind,
        status,
        code: body_code,
    }
}

/// Ошибка временная (нет сети, 429, 5xx): её имеет смысл повторить позже.
pub fn is_retryable(err: &str) -> bool {
    matches!(
        classify_api_failure(err).kind,
        ApiFailureKind::Transport | ApiFailureKind::RetryableHttp
    )
}

fn is_access_failure(err: &str) -> bool {
    matches!(
        classify_api_failure(err).kind,
        ApiFailureKind::AuthSession
            | ApiFailureKind::AccessDenied
            | ApiFailureKind::ResourceDeleted
    )
}

const MAX_BACKOFF: Duration = Duration::from_secs(300);

/// Повторяет операцию при временных ошибках: паузы удваиваются, но не больше пяти минут.
pub fn with_retry<T>(
    attempts: u32,
    base: Duration,
    mut op: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
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
    let agent = ureq::AgentBuilder::new().build();
    register(&agent, base, user_id, password)?;
    let login = request(
        &agent,
        base,
        "",
        "POST",
        "/login",
        Some(json!({ "userId": user_id, "password": password, "deviceId": device_id })),
    )?;
    let tokens = SessionTokens(
        login["token"]
            .as_str()
            .ok_or("сервер не вернул токен: нужно подтверждение с другого устройства")?
            .to_string(),
        login["refreshToken"]
            .as_str()
            .ok_or("сервер не вернул токен обновления")?
            .to_string(),
    );
    let scope = format!("{user_id}/{device_id}");
    let db_key = session_database_key(&scope, db_path, keys)?;
    build_client(agent, base, tokens, user_id, device_id, db_path, &db_key)
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
    let agent = ureq::AgentBuilder::new().build();
    register(&agent, base, user_id, password)?;
    let login = request(
        &agent,
        base,
        "",
        "POST",
        "/login",
        Some(
            json!({ "userId": user_id, "password": password, "deviceId": device_id, "label": device_id, "platform": "mobile" }),
        ),
    )?;
    let tokens = match login["token"].as_str() {
        Some(t) => (
            t.to_string(),
            login["refreshToken"]
                .as_str()
                .ok_or("сервер не вернул токен обновления")?
                .to_string(),
        ),
        None => {
            let approval_id = login["approvalId"]
                .as_str()
                .ok_or("сервер не вернул запрос подтверждения")?
                .to_string();
            let code = login["code"]
                .as_str()
                .ok_or("нет кода подтверждения")?
                .to_string();
            let poll = login["pollSecret"]
                .as_str()
                .ok_or("нет секрета опроса")?
                .to_string();
            approver.call(
                "POST",
                &format!("/approvals/{}/approve", urlencoding::encode(&approval_id)),
                Some(json!({ "code": code })),
            )?;
            let mut pair = None;
            for _ in 0..5 {
                let claim = request(
                    &agent,
                    base,
                    "",
                    "POST",
                    &format!("/approvals/{}/claim", urlencoding::encode(&approval_id)),
                    Some(json!({ "pollSecret": poll })),
                )?;
                match claim["status"].as_str() {
                    Some("approved") => {
                        pair = Some((
                            claim["token"].as_str().map(String::from),
                            claim["refreshToken"].as_str().map(String::from),
                        ));
                        break;
                    }
                    Some("pending") => continue,
                    other => return Err(format!("вход отклонён: {other:?}")),
                }
            }
            let (t, r) = pair.ok_or("подтверждение входа не пришло")?;
            (
                t.ok_or("сервер не вернул токен")?,
                r.ok_or("сервер не вернул токен обновления")?,
            )
        }
    };
    let tokens = SessionTokens(tokens.0, tokens.1);
    let scope = format!("{user_id}/{device_id}");
    let db_key = session_database_key(&scope, db_path, keys)?;
    build_client(agent, base, tokens, user_id, device_id, db_path, &db_key)
}

fn session_database_key(
    scope: &str,
    db_path: &str,
    keys: &dyn KeyStore,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let has_key = keys.has_database_key(scope)?;
    let existing_key = keys.existing_database_key(scope)?;
    match (has_key, existing_key) {
        (true, Some(key)) => Ok(Zeroizing::new(key)),
        (true, None) => Err(
            "защищённое хранилище сообщило о ключе, но не вернуло его".to_string(),
        ),
        (false, Some(mut key)) => {
            key.zeroize();
            Err("защищённое хранилище вернуло ключ без признака его наличия".to_string())
        }
        (false, None) if Path::new(db_path).is_file() => Err(
            "файл SQLCipher существует, но защищённый ключ отсутствует; автоматическая генерация нового ключа запрещена"
                .to_string(),
        ),
        (false, None) => Ok(Zeroizing::new(keys.database_key(scope)?)),
    }
}

fn validate_session_base(base: &str) -> Result<(), String> {
    let base = base.trim();
    let local_http = cfg!(debug_assertions)
        && (base.starts_with("http://127.0.0.1:")
            || base.starts_with("http://localhost:")
            || base.starts_with("http://[::1]:"));
    if !(base.starts_with("https://") || local_http)
        || base.contains('@')
        || base.contains('#')
        || base.contains('?')
    {
        return Err(
            "адрес MLS API должен быть HTTPS (HTTP разрешён только для loopback в debug) и не содержать credentials/query/fragment"
                .to_string(),
        );
    }
    Ok(())
}

fn store_session_tokens(meta: &Connection, tokens: &SessionTokens) -> Result<(), String> {
    if tokens.0.is_empty() || tokens.1.is_empty() {
        return Err("пара токенов сессии не может быть пустой".to_string());
    }
    let serialized =
        Zeroizing::new(serde_json::to_vec(&(tokens.0.as_str(), tokens.1.as_str())).map_err(text)?);
    meta.execute(
        "INSERT INTO client_meta (key, value) VALUES ('session_tokens', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [serialized.as_slice()],
    )
    .map_err(text)?;
    Ok(())
}

fn load_session_tokens(meta: &Connection) -> Result<SessionTokens, String> {
    let serialized: Zeroizing<Vec<u8>> = Zeroizing::new(
        meta.query_row(
            "SELECT value FROM client_meta WHERE key = 'session_tokens'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "в базе нет сохранённой MLS-сессии; выполните вход заново".to_string())?,
    );
    let (access, refresh): (String, String) = serde_json::from_slice(serialized.as_slice())
        .map_err(|_| "сохранённая сессия повреждена; выполните вход заново".to_string())?;
    if access.is_empty() || refresh.is_empty() {
        return Err("сохранённая сессия неполная; выполните вход заново".to_string());
    }
    Ok(SessionTokens(access, refresh))
}

fn zeroize_json_value(value: &mut Value) {
    match value {
        Value::String(value) => value.zeroize(),
        Value::Array(values) => values.iter_mut().for_each(zeroize_json_value),
        Value::Object(values) => values.values_mut().for_each(zeroize_json_value),
        _ => {}
    }
}

/// Adopts an already authenticated mobile session without resetting MLS state.
pub fn connect_with_session(
    base: &str,
    user_id: &str,
    device_id: &str,
    access_token: &str,
    refresh_token: &str,
    db_path: &str,
    keys: &dyn KeyStore,
) -> Result<Client, String> {
    validate_session_base(base)?;
    if user_id.trim().is_empty()
        || device_id.trim().is_empty()
        || access_token.is_empty()
        || refresh_token.is_empty()
    {
        return Err("user_id, device_id, access_token и refresh_token обязательны".to_string());
    }
    let scope = format!("{user_id}/{device_id}");
    let tokens = SessionTokens(access_token.to_string(), refresh_token.to_string());
    let db_key = session_database_key(&scope, db_path, keys)?;
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    build_client(
        agent,
        base.trim(),
        tokens,
        user_id,
        device_id,
        db_path,
        &db_key,
    )
}

/// Reopens an existing SQLCipher session. It never creates a replacement database key.
pub fn resume_with_session(
    base: &str,
    user_id: &str,
    device_id: &str,
    db_path: &str,
    keys: &dyn KeyStore,
) -> Result<Client, String> {
    validate_session_base(base)?;
    if user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("user_id и device_id обязательны".to_string());
    }
    if !Path::new(db_path).is_file() {
        return Err("сохранённая MLS-сессия не найдена на этом устройстве".to_string());
    }
    let scope = format!("{user_id}/{device_id}");
    let db_key = Zeroizing::new(keys.existing_database_key(&scope)?.ok_or_else(|| {
        "ключ SQLCipher сохранённой MLS-сессии отсутствует; создание нового ключа запрещено"
            .to_string()
    })?);
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
    let tokens = load_session_tokens(&meta)?;
    drop(meta);
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    build_client(
        agent,
        base.trim(),
        tokens,
        user_id,
        device_id,
        db_path,
        &db_key,
    )
}

fn build_client(
    agent: ureq::Agent,
    base: &str,
    tokens: SessionTokens,
    user_id: &str,
    device_id: &str,
    db_path: &str,
    db_key: &[u8; 32],
) -> Result<Client, String> {
    // OpenMLS migrations require an owned mutable connection. Run them before
    // sharing the long-lived connection used by OpenMLS and the client journal.
    let mut migration_storage =
        SqliteStorageProvider::<JsonCodec, Connection>::new(open_db(db_path, db_key)?);
    migration_storage.run_migrations().map_err(text)?;
    drop(migration_storage);

    // One shared connection makes MLS state transitions and their journal rows
    // part of the same SQLite transaction.
    let connection = Arc::new(open_db(db_path, db_key)?);
    let crypto = Arc::new(RustCrypto::default());
    let provider = DeviceProvider::new(Arc::clone(&crypto), Arc::clone(&connection));
    let meta = connection;
    meta.execute_batch(
        "CREATE TABLE IF NOT EXISTS client_meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
         CREATE TABLE IF NOT EXISTS client_rooms (room_id TEXT PRIMARY KEY, join_epoch INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS client_processed (event_id TEXT PRIMARY KEY);
         CREATE TABLE IF NOT EXISTS client_inbox (
           seq INTEGER PRIMARY KEY AUTOINCREMENT,
           event_id TEXT NOT NULL UNIQUE,
           room_id TEXT NOT NULL,
           kind TEXT NOT NULL CHECK (kind IN ('text', 'unreadable')),
           body TEXT,
           payload BLOB,
           acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
           created_at INTEGER NOT NULL,
           acknowledged_at INTEGER,
           direction TEXT NOT NULL DEFAULT 'incoming' CHECK (direction IN ('incoming', 'outgoing')),
           client_message_id TEXT,
           CHECK ((kind = 'text' AND body IS NOT NULL) OR (kind = 'unreadable' AND body IS NULL))
         );
         CREATE INDEX IF NOT EXISTS idx_client_inbox_pending ON client_inbox(acknowledged, seq);
         CREATE TABLE IF NOT EXISTS client_undecryptable (event_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, reason TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS client_desync (room_id TEXT PRIMARY KEY, reason TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS client_waiting_for_commit (room_id TEXT PRIMARY KEY, expected_epoch INTEGER NOT NULL, event_ids TEXT NOT NULL, updated_at INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS client_commit_quarantine (room_id TEXT NOT NULL, epoch INTEGER NOT NULL, commit_hash TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (room_id, epoch, commit_hash));
         CREATE TABLE IF NOT EXISTS client_welcome_receipts (
           welcome_id INTEGER PRIMARY KEY,
           room_id TEXT NOT NULL,
           welcome BLOB NOT NULL,
           outcome TEXT NOT NULL CHECK (outcome IN ('joined', 'quarantined')),
           reason TEXT,
           created_at INTEGER NOT NULL,
           acked_at INTEGER
         );
         CREATE TABLE IF NOT EXISTS client_outbox (
           local_id TEXT PRIMARY KEY,
           room_id TEXT NOT NULL,
           body TEXT NOT NULL,
           payload BLOB,
           seq INTEGER NOT NULL,
           mls_message BLOB,
           mls_epoch INTEGER
         );
                   CREATE TABLE IF NOT EXISTS client_attachments (
            file_id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            event_id TEXT NOT NULL UNIQUE,
            manifest BLOB NOT NULL,
            direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
            client_message_id TEXT,
            created_at INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_client_attachments_message_id
            ON client_attachments(client_message_id) WHERE client_message_id IS NOT NULL;
          CREATE TABLE IF NOT EXISTS client_attachment_outbox (
            client_message_id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            manifest BLOB NOT NULL,
            ciphertext_sha256 TEXT NOT NULL,
            ciphertext_size INTEGER NOT NULL,
            ciphertext BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            uploaded INTEGER NOT NULL DEFAULT 0,
            mls_message BLOB,
            mls_epoch INTEGER
          );
          CREATE TABLE IF NOT EXISTS client_remote_config (id INTEGER PRIMARY KEY CHECK (id = 1), etag TEXT NOT NULL, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS client_key_package_claims (room_id TEXT NOT NULL, user_id TEXT NOT NULL, claim_id TEXT NOT NULL, PRIMARY KEY (room_id, user_id));
          CREATE TABLE IF NOT EXISTS client_membership_commits (
            operation_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, base_epoch INTEGER NOT NULL,
            fingerprint TEXT NOT NULL, payload TEXT NOT NULL, claim_ids TEXT NOT NULL, created_at INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS client_membership_commits_one_per_room ON client_membership_commits (room_id);
          CREATE TABLE IF NOT EXISTS client_invite_intents (
            operation_id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            target_user_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('claim_pending', 'commit_pending')),
            created_at INTEGER NOT NULL,
            is_join_request INTEGER NOT NULL DEFAULT 0 CHECK (is_join_request IN (0, 1)),
            UNIQUE (room_id, target_user_id)
          )",
    )
    .map_err(text)?;

    let has_join_request_intent: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_invite_intents') WHERE name = 'is_join_request')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_join_request_intent {
        meta.execute_batch(
            "ALTER TABLE client_invite_intents ADD COLUMN is_join_request INTEGER NOT NULL DEFAULT 0 CHECK (is_join_request IN (0, 1))",
        )
        .map_err(text)?;
    }

    // Upgrade databases created by earlier Engine B builds without replacing any
    // existing inbox/outbox rows or OpenMLS storage.
    let has_inbox_direction: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_inbox') WHERE name = 'direction')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_inbox_direction {
        meta.execute_batch(
            "ALTER TABLE client_inbox ADD COLUMN direction TEXT NOT NULL DEFAULT 'incoming' CHECK (direction IN ('incoming', 'outgoing'))",
        )
        .map_err(text)?;
    }
    let has_client_message_id: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_inbox') WHERE name = 'client_message_id')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_client_message_id {
        meta.execute_batch("ALTER TABLE client_inbox ADD COLUMN client_message_id TEXT")
            .map_err(text)?;
    }
    let has_inbox_payload: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_inbox') WHERE name = 'payload')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_inbox_payload {
        meta.execute_batch("ALTER TABLE client_inbox ADD COLUMN payload BLOB")
            .map_err(text)?;
    }
    let has_outbox_payload: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_outbox') WHERE name = 'payload')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_outbox_payload {
        meta.execute_batch("ALTER TABLE client_outbox ADD COLUMN payload BLOB")
            .map_err(text)?;
    }
    let has_attachment_ciphertext: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_attachment_outbox') WHERE name = 'ciphertext')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_attachment_ciphertext {
        meta.execute_batch("ALTER TABLE client_attachment_outbox ADD COLUMN ciphertext BLOB")
            .map_err(text)?;
    }
    let has_attachment_created_at: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_attachment_outbox') WHERE name = 'created_at')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_attachment_created_at {
        meta.execute_batch(
            "ALTER TABLE client_attachment_outbox ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
        )
        .map_err(text)?;
    }
    let has_outbox_mls_message: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_outbox') WHERE name = 'mls_message')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_outbox_mls_message {
        meta.execute_batch("ALTER TABLE client_outbox ADD COLUMN mls_message BLOB")
            .map_err(text)?;
    }
    let has_outbox_mls_epoch: bool = meta
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('client_outbox') WHERE name = 'mls_epoch')",
            [],
            |row| row.get(0),
        )
        .map_err(text)?;
    if !has_outbox_mls_epoch {
        meta.execute_batch("ALTER TABLE client_outbox ADD COLUMN mls_epoch INTEGER")
            .map_err(text)?;
    }
    meta.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_client_inbox_client_message_id
         ON client_inbox(client_message_id) WHERE client_message_id IS NOT NULL",
    )
    .map_err(text)?;

    let stored_public: Option<Vec<u8>> = meta
        .query_row(
            "SELECT value FROM client_meta WHERE key = 'signer_public'",
            [],
            |r| r.get(0),
        )
        .ok();
    let signer = match stored_public {
        Some(public) => SignatureKeyPair::read(
            provider.storage(),
            &public,
            CIPHERSUITE.signature_algorithm(),
        )
        .ok_or("ключ подписи устройства не найден в базе")?,
        None => {
            let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(text)?;
            signer.store(provider.storage()).map_err(text)?;
            meta.execute(
                "INSERT INTO client_meta (key, value) VALUES ('signer_public', ?1)",
                [signer.to_public_vec()],
            )
            .map_err(text)?;
            signer
        }
    };
    let credential = CredentialWithKey {
        credential: BasicCredential::new(format!("{user_id}/{device_id}").into_bytes()).into(),
        signature_key: signer.to_public_vec().into(),
    };

    let mut groups = HashMap::new();
    let mut stmt = meta
        .prepare("SELECT room_id, join_epoch FROM client_rooms")
        .map_err(text)?;
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
        groups.insert(
            room_id,
            Group {
                mls,
                join_epoch: join_epoch as u64,
            },
        );
    }
    let mut processed = HashSet::new();
    let mut stmt = meta
        .prepare("SELECT event_id FROM client_processed")
        .map_err(text)?;
    for id in stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(text)?
    {
        processed.insert(id.map_err(text)?);
    }
    drop(stmt);

    store_session_tokens(&meta, &tokens)?;

    Ok(Client {
        base: base.to_string(),
        tokens: Mutex::new(tokens),
        user_id: user_id.to_string(),
        device_id: device_id.to_string(),
        agent,
        crypto,
        provider,
        meta,
        signer,
        credential,
        groups,
        processed,
        inbox: Vec::new(),
    })
}

/// Проверяет фактические Add/Remove proposals до merge staged commit.
/// Legacy epochs without metadata (changes = NULL) remain readable but are not metadata-verified.
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
    provider: &DeviceProvider<Arc<Connection>>,
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
    let digest = provider
        .crypto()
        .hash(HashType::Sha2_256, &input)
        .map_err(text)?;
    Ok(hex_encode(&digest))
}

fn response_error_code(error: &str) -> Option<String> {
    let start = error.find('{')?;
    let body: Value = serde_json::from_str(&error[start..]).ok()?;
    body.get("code")
        .or_else(|| body.get("error"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// A policy rejection for a pure account-removal Commit is definitive: the server
/// has not accepted the Commit, so the staged local proposal can be safely discarded.
/// A join request removed by a moderator is a definitive pre-commit rejection.
/// Release its still-reserved KeyPackages before clearing the durable local proposal.
fn is_join_request_not_pending_rejection(payload: &Value, error: &str) -> bool {
    let target = payload["joinRequestUserId"].as_str();
    let adds = payload["changes"]["adds"].as_array();
    target.is_some()
        && adds.is_some_and(|items| items.len() == 1 && items[0].as_str() == target)
        && payload["keyPackageClaimId"].as_str().is_some()
        && response_error_code(error).as_deref() == Some("join_request_not_pending")
}

fn is_account_removal_policy_rejection(payload: &Value, error: &str) -> bool {
    let changes = &payload["changes"];
    let removes_account = changes["removes"]
        .as_array()
        .is_some_and(|items| !items.is_empty());
    let no_adds = changes["adds"].as_array().is_some_and(Vec::is_empty);
    let no_device_removals = changes["removeDevices"]
        .as_array()
        .is_some_and(Vec::is_empty);
    if !(removes_account && no_adds && no_device_removals) {
        return false;
    }
    let code = response_error_code(error).unwrap_or_default();
    matches!(
        code.as_str(),
        "an admin cannot remove another admin" | "owner cannot be removed"
    ) || code.starts_with("missing capability: remove_members")
        || code.starts_with("not a member: ")
}

impl Client {
    /// Вызов API. Если токен доступа истёк, токен обновляется и запрос повторяется один раз.
    fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        match self.call_once(method, path, body.clone()) {
            Err(e) if classify_api_failure(&e).code.as_deref() == Some("token_expired") => {
                self.renew()?;
                self.call_once(method, path, body)
            }
            other => other,
        }
    }

    fn call_once(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        let token = Zeroizing::new(self.tokens.lock().map_err(text)?.0.clone());
        request(&self.agent, &self.base, token.as_str(), method, path, body)
    }

    fn same_origin_url(&self, raw_url: &str) -> Result<Url, String> {
        parse_signed_object_url(&self.base, raw_url)
    }

    /// Upload capability URLs are unauthenticated and never receive the bearer token.
    fn upload_signed_bytes(&self, raw_url: &str, ciphertext: &[u8]) -> Result<(), String> {
        let url = self.same_origin_url(raw_url)?;
        match self
            .agent
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

    /// Download capability URLs are device-bound and require the active bearer token.
    fn download_signed_bytes(&self, raw_url: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        let url = self.same_origin_url(raw_url)?;
        for attempt in 0..2 {
            let token = Zeroizing::new(self.tokens.lock().map_err(text)?.0.clone());
            let authorization = Zeroizing::new(format!("Bearer {}", token.as_str()));
            let response = self
                .agent
                .get(url.as_str())
                .set("authorization", authorization.as_str())
                .call();
            match response {
                Ok(response) => {
                    let mut bytes = Vec::new();
                    response
                        .into_reader()
                        .take(max_bytes.saturating_add(1))
                        .read_to_end(&mut bytes)
                        .map_err(text)?;
                    if bytes.len() as u64 > max_bytes {
                        return Err("signed file download exceeded the manifest ciphertext size"
                            .to_string());
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
        let file_id = response
            .get("fileId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or("file reservation did not return fileId")?
            .to_string();
        let upload_url = response
            .get("uploadUrl")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or("file reservation did not return uploadUrl")?
            .to_string();
        self.same_origin_url(&upload_url)?;
        Ok((file_id, upload_url))
    }

    /// Rotates the refresh token and persists the complete replacement before updating memory.
    fn renew(&self) -> Result<(), String> {
        // Serialize rotations so concurrent 401 responses cannot spend one refresh token twice.
        let mut tokens = self.tokens.lock().map_err(text)?;
        if tokens.1.is_empty() {
            return Err("сессия MLS завершена; требуется повторный вход".to_string());
        }
        let refresh = Zeroizing::new(tokens.1.clone());
        let mut response = request(
            &self.agent,
            &self.base,
            "",
            "POST",
            "/token/refresh",
            Some(json!({ "refreshToken": refresh.as_str() })),
        )?;
        let next_pair = (|| -> Result<SessionTokens, String> {
            Ok(SessionTokens(
                response["token"]
                    .as_str()
                    .ok_or("сервер не вернул токен")?
                    .to_string(),
                response["refreshToken"]
                    .as_str()
                    .ok_or("сервер не вернул токен обновления")?
                    .to_string(),
            ))
        })();
        zeroize_json_value(&mut response);
        let next_pair = next_pair?;
        // One SQLite statement atomically replaces the encrypted token pair. Keep the old
        // in-memory refresh token if persistence fails after the server response.
        store_session_tokens(&self.meta, &next_pair)?;
        *tokens = next_pair;
        Ok(())
    }

    pub fn access_token_snapshot(&self) -> Result<String, String> {
        let tokens = self.tokens.lock().map_err(text)?;
        if tokens.0.is_empty() {
            return Err("сессия MLS завершена; требуется повторный вход".to_string());
        }
        Ok(tokens.0.clone())
    }

    pub fn refresh_session(&self) -> Result<String, String> {
        self.renew()?;
        self.access_token_snapshot()
    }

    /// Logout always clears the persisted and in-memory token pair, even if the server is offline.
    pub fn logout(&self) -> Result<(), String> {
        let server_result = match self.call("POST", "/logout", Some(json!({}))) {
            Ok(mut response) => {
                zeroize_json_value(&mut response);
                Ok(())
            }
            Err(error) => Err(error),
        };
        let local_result = self
            .meta
            .execute("DELETE FROM client_meta WHERE key = 'session_tokens'", [])
            .map(|_| ())
            .map_err(text);
        let empty = SessionTokens(String::new(), String::new());
        match self.tokens.lock() {
            Ok(mut tokens) => *tokens = empty,
            Err(poisoned) => *poisoned.into_inner() = empty,
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

    /// Участники группы по протоколу, по пользователям (устройства объединяются).
    fn mls_users(&self, room_id: &str) -> Result<std::collections::BTreeSet<String>, String> {
        Ok(self
            .members_of(room_id)?
            .into_iter()
            .filter_map(|id| id.rsplit_once('/').map(|(user, _)| user.to_string()))
            .collect())
    }

    /// Участники комнаты по серверу. Если сервер больше не считает устройство участником, список пуст.
    fn server_users(&self, room_id: &str) -> Result<std::collections::BTreeSet<String>, String> {
        let body = match self.call(
            "GET",
            &format!("/rooms/{}/members", urlencoding::encode(room_id)),
            None,
        ) {
            Ok(body) => body,
            Err(e) if e.contains("not a member") => return Ok(std::collections::BTreeSet::new()),
            Err(e) => return Err(e),
        };
        let list = body["members"]
            .as_array()
            .ok_or("ответ без списка участников")?;
        list.iter()
            .map(|m| {
                m.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| "участник не строка".to_string())
            })
            .collect()
    }

    /// Сверка состава (аудит, P0.2): сервер и протокол должны называть одних и тех же участников.
    /// Расхождение фиксируется и приостанавливает отправку в комнату до выравнивания.
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
                self.meta
                    .execute("DELETE FROM client_desync WHERE room_id = ?1", [room_id])
                    .map_err(text)?;
            }
            return Ok(());
        }
        let only_server: Vec<&String> = server.difference(&mls).collect();
        let only_mls: Vec<&String> = mls.difference(&server).collect();
        let reason =
            format!("на сервере без группы: {only_server:?}; в группе без сервера: {only_mls:?}");
        self.meta
            .execute(
                "INSERT INTO client_desync (room_id, reason) VALUES (?1, ?2) ON CONFLICT(room_id) DO UPDATE SET reason = excluded.reason",
                [room_id, reason.as_str()],
            )
            .map_err(text)?;
        Ok(())
    }

    /// Пометка комнаты как требующей восстановления состояния (RecoveryRequired): отправка приостанавливается.
    fn record_desync(&mut self, room_id: &str, reason: &str) -> Result<(), String> {
        let durable_reason = if reason.starts_with("RecoveryRequired:") {
            reason.to_string()
        } else {
            format!("RecoveryRequired: {reason}")
        };
        self.meta
            .execute(
                "INSERT INTO client_desync (room_id, reason) VALUES (?1, ?2) ON CONFLICT(room_id) DO UPDATE SET reason = excluded.reason",
                [room_id, durable_reason.as_str()],
            )
            .map_err(text)?;
        self.clear_waiting_for_commit(room_id)?;
        Ok(())
    }

    fn set_waiting_for_commit(
        &mut self,
        room_id: &str,
        expected_epoch: u64,
        event_ids: &[String],
    ) -> Result<(), String> {
        let event_ids = serde_json::to_string(event_ids).map_err(text)?;
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta.execute(
            "INSERT INTO client_waiting_for_commit (room_id, expected_epoch, event_ids, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(room_id) DO UPDATE SET expected_epoch = excluded.expected_epoch, event_ids = excluded.event_ids, updated_at = excluded.updated_at",
            rusqlite::params![room_id, expected_epoch as i64, event_ids, updated_at],
        ).map_err(text)?;
        Ok(())
    }

    fn waiting_for_commit(&self, room_id: &str) -> Result<Option<(u64, String)>, String> {
        use rusqlite::OptionalExtension;
        self.meta.query_row(
            "SELECT expected_epoch, event_ids FROM client_waiting_for_commit WHERE room_id = ?1",
            [room_id],
            |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, String>(1)?)),
        ).optional().map_err(text)
    }

    fn clear_waiting_for_commit(&mut self, room_id: &str) -> Result<(), String> {
        self.meta
            .execute(
                "DELETE FROM client_waiting_for_commit WHERE room_id = ?1",
                [room_id],
            )
            .map_err(text)?;
        Ok(())
    }

    fn quarantine_commit(
        &mut self,
        room_id: &str,
        epoch: u64,
        bytes: &[u8],
        reason: &str,
    ) -> Result<(), String> {
        let digest = self
            .provider
            .crypto()
            .hash(HashType::Sha2_256, bytes)
            .map_err(text)?;
        let commit_hash = hex_encode(&digest);
        let durable_reason =
            format!("RecoveryRequired: Commit epoch {epoch} quarantined: {reason}");
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let tx = self.meta.unchecked_transaction().map_err(|error| {
            format!(
                "временная ошибка локального хранилища при карантине Commit: {}",
                text(error)
            )
        })?;
        tx.execute(
            "INSERT OR IGNORE INTO client_commit_quarantine (room_id, epoch, commit_hash, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![room_id, epoch as i64, commit_hash, reason, created_at],
        ).map_err(|error| format!("временная ошибка локального хранилища при карантине Commit: {}", text(error)))?;
        tx.execute(
            "INSERT INTO client_desync (room_id, reason) VALUES (?1, ?2) ON CONFLICT(room_id) DO UPDATE SET reason = excluded.reason",
            [room_id, durable_reason.as_str()],
        ).map_err(|error| format!("временная ошибка локального хранилища при карантине Commit: {}", text(error)))?;
        tx.execute(
            "DELETE FROM client_waiting_for_commit WHERE room_id = ?1",
            [room_id],
        )
        .map_err(|error| {
            format!(
                "временная ошибка локального хранилища при карантине Commit: {}",
                text(error)
            )
        })?;
        tx.commit().map_err(|error| {
            format!(
                "временная ошибка локального хранилища при фиксации карантина Commit: {}",
                text(error)
            )
        })?;
        Ok(())
    }

    fn commit_is_quarantined(
        &self,
        room_id: &str,
        epoch: u64,
        bytes: &[u8],
    ) -> Result<Option<String>, String> {
        use rusqlite::OptionalExtension;
        let digest = self
            .provider
            .crypto()
            .hash(HashType::Sha2_256, bytes)
            .map_err(text)?;
        let commit_hash = hex_encode(&digest);
        self.meta.query_row(
            "SELECT reason FROM client_commit_quarantine WHERE room_id = ?1 AND epoch = ?2 AND commit_hash = ?3",
            rusqlite::params![room_id, epoch as i64, commit_hash],
            |row| row.get(0),
        ).optional().map_err(text)
    }

    pub fn quarantined_commit_reason(
        &self,
        room_id: &str,
        epoch: u64,
    ) -> Result<Option<String>, String> {
        use rusqlite::OptionalExtension;
        self.meta.query_row(
            "SELECT reason FROM client_commit_quarantine WHERE room_id = ?1 AND epoch = ?2 ORDER BY created_at LIMIT 1",
            rusqlite::params![room_id, epoch as i64],
            |row| row.get(0),
        ).optional().map_err(text)
    }

    /// Причина приостановки отправки в комнату, если она рассинхронизирована.
    pub fn desync_reason(&self, room_id: &str) -> Result<Option<String>, String> {
        use rusqlite::OptionalExtension;
        let desync: Option<String> = self
            .meta
            .query_row(
                "SELECT reason FROM client_desync WHERE room_id = ?1",
                [room_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(text)?;
        if desync
            .as_deref()
            .is_some_and(|reason| reason.starts_with("RecoveryRequired:"))
        {
            return Ok(desync);
        }
        if let Some((expected_epoch, event_ids)) = self.waiting_for_commit(room_id)? {
            return Ok(Some(format!("WaitingForCommit: ожидается Commit для эпохи {expected_epoch}; события {event_ids}")));
        }
        Ok(desync)
    }

    fn record_unreadable(
        &mut self,
        room_id: &str,
        event_id: &str,
        reason: &str,
    ) -> Result<(), String> {
        self.meta
            .execute("INSERT OR IGNORE INTO client_undecryptable (event_id, room_id, reason) VALUES (?1, ?2, ?3)", [event_id, room_id, reason])
            .map_err(text)?;
        Ok(())
    }

    /// Нечитаемые события с причинами (для поддержки и отладки): (событие, комната, причина).
    pub fn undecryptable(&self) -> Result<Vec<(String, String, String)>, String> {
        let mut stmt = self
            .meta
            .prepare("SELECT event_id, room_id, reason FROM client_undecryptable ORDER BY event_id")
            .map_err(text)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(text)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(text)
    }

    fn mark_processed(&mut self, event_id: &str) -> Result<(), String> {
        self.meta
            .execute(
                "INSERT OR IGNORE INTO client_processed (event_id) VALUES (?1)",
                [event_id],
            )
            .map_err(text)?;
        self.processed.insert(event_id.to_string());
        Ok(())
    }

    /// Публикует ключевые пакеты этого устройства (не больше 50 за раз).
    pub fn upload_key_packages(&mut self, count: usize) -> Result<(), String> {
        let mut packages = Vec::with_capacity(count);
        for _ in 0..count {
            let bundle = KeyPackage::builder()
                .build(
                    CIPHERSUITE,
                    &self.provider,
                    &self.signer,
                    self.credential.clone(),
                )
                .map_err(text)?;
            packages.push(
                B64.encode(
                    bundle
                        .key_package()
                        .tls_serialize_detached()
                        .map_err(text)?,
                ),
            );
        }
        self.call(
            "POST",
            "/mls/key-packages",
            Some(json!({ "packages": packages })),
        )?;
        Ok(())
    }

    /// Публикует резервный ключевой пакет: им приглашают, когда обычные закончились.
    pub fn upload_last_resort(&mut self) -> Result<(), String> {
        let bundle = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(text)?;
        let package = B64.encode(
            bundle
                .key_package()
                .tls_serialize_detached()
                .map_err(text)?,
        );
        self.call(
            "POST",
            "/mls/key-packages/last-resort",
            Some(json!({ "package": package })),
        )?;
        Ok(())
    }

    /// Сколько обычных ключевых пакетов осталось на сервере для этого устройства.
    pub fn available_key_packages(&self) -> Result<u64, String> {
        let r = self.call("GET", "/mls/key-packages/count", None)?;
        r["available"]
            .as_u64()
            .ok_or_else(|| "сервер не вернул счётчик".to_string())
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
        self.call(
            "POST",
            "/rooms",
            Some(json!({ "roomId": room_id, "members": [self.user_id] })),
        )?;
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .max_past_epochs(MAX_PAST_EPOCHS)
            .build();
        let mls = MlsGroup::new_with_group_id(
            &self.provider,
            &self.signer,
            &config,
            GroupId::from_slice(room_id.as_bytes()),
            self.credential.clone(),
        )
        .map_err(text)?;
        self.meta
            .execute(
                "INSERT OR REPLACE INTO client_rooms (room_id, join_epoch) VALUES (?1, 0)",
                [room_id],
            )
            .map_err(text)?;
        self.groups
            .insert(room_id.to_string(), Group { mls, join_epoch: 0 });
        Ok(())
    }

    fn server_epoch(&self, room_id: &str) -> Result<u64, String> {
        let r = self.call(
            "GET",
            &format!("/mls/groups/{}/epoch", urlencoding::encode(room_id)),
            None,
        )?;
        r["epoch"]
            .as_u64()
            .ok_or_else(|| "сервер не вернул эпоху".to_string())
    }

    fn reload_group(&mut self, room_id: &str) -> Result<(), String> {
        let join_epoch: i64 = self
            .meta
            .query_row(
                "SELECT join_epoch FROM client_rooms WHERE room_id = ?1",
                [room_id],
                |row| row.get(0),
            )
            .map_err(text)?;
        let mls = MlsGroup::load(
            self.provider.storage(),
            &GroupId::from_slice(room_id.as_bytes()),
        )
        .map_err(text)?
        .ok_or_else(|| format!("состояние группы {room_id} не найдено"))?;
        self.groups.insert(
            room_id.to_string(),
            Group {
                mls,
                join_epoch: join_epoch as u64,
            },
        );
        Ok(())
    }

    fn flush_pending_membership_commits(&mut self) -> Result<usize, String> {
        let rows: Vec<(String, String, i64, String, String, String)> = {
            let mut stmt = self
                .meta
                .prepare(
                    "SELECT operation_id, room_id, base_epoch, fingerprint, payload, claim_ids
                 FROM client_membership_commits ORDER BY created_at, operation_id",
                )
                .map_err(text)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })
                .map_err(text)?;
            rows.collect::<Result<_, _>>().map_err(text)?
        };
        let mut stale_cleared = 0usize;
        for (operation_id, room_id, base_i64, fingerprint, payload_json, claim_ids_json) in rows {
            let base_epoch = u64::try_from(base_i64).map_err(text)?;
            let payload: Value = serde_json::from_str(&payload_json).map_err(text)?;
            let claim_ids: Vec<String> = serde_json::from_str(&claim_ids_json).map_err(text)?;
            if payload["clientOperationId"].as_str() != Some(operation_id.as_str())
                || payload["epoch"].as_u64() != Some(base_epoch)
                || payload["keyPackageClaimId"]
                    .as_str()
                    .is_some_and(|claim_id| claim_id != operation_id)
            {
                let reason = "membership journal payload does not match its operation identity";
                self.record_desync(&room_id, reason)?;
                return Err(format!("RecoveryRequired: {reason}"));
            }
            let actual = {
                let group = self.groups.get(&room_id).ok_or_else(|| {
                    format!("RecoveryRequired: journal room {room_id} is not loaded")
                })?;
                let staged = group.mls.pending_commit().ok_or_else(|| {
                    format!("RecoveryRequired: pending StagedCommit missing for {operation_id}")
                })?;
                membership_commit_fingerprint(
                    &self.provider,
                    &room_id,
                    &operation_id,
                    base_epoch,
                    &payload,
                    staged,
                )?
            };
            if actual != fingerprint {
                let reason = format!(
                    "pending StagedCommit fingerprint mismatch for operation {operation_id}"
                );
                self.record_desync(&room_id, &reason)?;
                return Err(format!("RecoveryRequired: {reason}"));
            }

            let response = self.call(
                "POST",
                &format!("/mls/groups/{}/commits", urlencoding::encode(&room_id)),
                Some(payload.clone()),
            );
            match response {
                Ok(response) => {
                    let accepted_epoch = response["epoch"]
                        .as_u64()
                        .ok_or("сервер не вернул epoch для membership commit")?;
                    if accepted_epoch != base_epoch.saturating_add(1) {
                        let reason = format!("server accepted operation {operation_id} at unexpected epoch {accepted_epoch}");
                        self.record_desync(&room_id, &reason)?;
                        return Err(format!("RecoveryRequired: {reason}"));
                    }
                    // Server acceptance is durable before local merge. A crash here must replay
                    // the exact operation ID/fingerprint and receive the original epoch receipt.
                    crash_at_test_failpoint("after_outbound_membership_commit_server_acceptance");
                    let tx = self.meta.unchecked_transaction().map_err(text)?;
                    let mut integrity_error: Option<String> = None;
                    let settlement = (|| -> Result<(), String> {
                        let group = self
                            .groups
                            .get_mut(&room_id)
                            .ok_or("membership journal room disappeared")?;
                        let staged = group
                            .mls
                            .pending_commit()
                            .ok_or("pending StagedCommit disappeared before merge")?;
                        let actual = membership_commit_fingerprint(
                            &self.provider,
                            &room_id,
                            &operation_id,
                            base_epoch,
                            &payload,
                            staged,
                        )?;
                        if actual != fingerprint {
                            let reason = format!("pending StagedCommit fingerprint changed before merge for {operation_id}");
                            integrity_error = Some(reason.clone());
                            return Err(reason);
                        }
                        group
                            .mls
                            .merge_pending_commit(&self.provider)
                            .map_err(text)?;
                        crash_at_test_failpoint("after_outbound_membership_commit_local_merge");
                        if group.mls.epoch().as_u64() != accepted_epoch {
                            let reason = format!("merged local epoch {} differs from accepted server epoch {accepted_epoch}", group.mls.epoch().as_u64());
                            integrity_error = Some(reason.clone());
                            return Err(reason);
                        }
                        tx.execute(
                            "DELETE FROM client_membership_commits WHERE operation_id = ?1",
                            [&operation_id],
                        )
                        .map_err(text)?;
                        tx.execute(
                            "DELETE FROM client_invite_intents WHERE operation_id = ?1",
                            [&operation_id],
                        )
                        .map_err(text)?;
                        for claim_id in &claim_ids {
                            tx.execute(
                                "DELETE FROM client_key_package_claims WHERE room_id = ?1 AND claim_id = ?2",
                                rusqlite::params![room_id, claim_id],
                            ).map_err(text)?;
                        }
                        crash_at_test_failpoint(
                            "after_outbound_membership_commit_journal_settlement",
                        );
                        Ok(())
                    })();
                    if let Err(error) = settlement {
                        let _ = tx.rollback();
                        self.reload_group(&room_id)?;
                        if let Some(reason) = integrity_error {
                            self.record_desync(&room_id, &reason)?;
                            return Err(format!("RecoveryRequired: {reason}"));
                        }
                        return Err(format!("временная ошибка локального хранилища при завершении membership commit: {error}"));
                    }
                    crash_at_test_failpoint("before_outbound_membership_commit_transaction_commit");
                    if let Err(error) = tx.commit() {
                        self.reload_group(&room_id)?;
                        return Err(format!("временная ошибка локального хранилища при фиксации membership commit: {}", text(error)));
                    }
                    crash_at_test_failpoint("after_outbound_membership_commit_transaction_commit");
                }
                Err(error) if response_error_code(&error).as_deref() == Some("epoch_outdated") => {
                    let tx = self.meta.unchecked_transaction().map_err(text)?;
                    let mut integrity_error: Option<String> = None;
                    let clearing = (|| -> Result<(), String> {
                        let group = self
                            .groups
                            .get_mut(&room_id)
                            .ok_or("membership journal room disappeared")?;
                        let staged = group
                            .mls
                            .pending_commit()
                            .ok_or("pending StagedCommit disappeared before stale clear")?;
                        let actual = membership_commit_fingerprint(
                            &self.provider,
                            &room_id,
                            &operation_id,
                            base_epoch,
                            &payload,
                            staged,
                        )?;
                        if actual != fingerprint {
                            let reason = format!("pending StagedCommit fingerprint changed before stale clear for {operation_id}");
                            integrity_error = Some(reason.clone());
                            return Err(reason);
                        }
                        group
                            .mls
                            .clear_pending_commit(self.provider.storage())
                            .map_err(text)?;
                        tx.execute(
                            "DELETE FROM client_membership_commits WHERE operation_id = ?1",
                            [&operation_id],
                        )
                        .map_err(text)?;
                        tx.execute(
                            "UPDATE client_invite_intents SET state = 'claim_pending' WHERE operation_id = ?1",
                            [&operation_id],
                        )
                        .map_err(text)?;
                        Ok(())
                    })();
                    if let Err(error) = clearing {
                        let _ = tx.rollback();
                        self.reload_group(&room_id)?;
                        if let Some(reason) = integrity_error {
                            self.record_desync(&room_id, &reason)?;
                            return Err(format!("RecoveryRequired: {reason}"));
                        }
                        return Err(format!("временная ошибка локального хранилища при очистке stale membership commit: {error}"));
                    }
                    if let Err(error) = tx.commit() {
                        self.reload_group(&room_id)?;
                        return Err(format!("временная ошибка локального хранилища при фиксации stale membership commit: {}", text(error)));
                    }
                    stale_cleared += 1;
                }
                Err(error) if is_account_removal_policy_rejection(&payload, &error) => {
                    // The server definitively rejected this account-removal proposal before
                    // mlsApplyCommit. Clear only the matching verified staged proposal so a
                    // capability/role race cannot strand the room behind a permanent journal row.
                    let tx = self.meta.unchecked_transaction().map_err(text)?;
                    let mut integrity_error: Option<String> = None;
                    let clearing = (|| -> Result<(), String> {
                        let group = self
                            .groups
                            .get_mut(&room_id)
                            .ok_or("membership journal room disappeared")?;
                        let staged = group.mls.pending_commit().ok_or(
                            "pending StagedCommit missing during rejected account removal",
                        )?;
                        let actual = membership_commit_fingerprint(
                            &self.provider,
                            &room_id,
                            &operation_id,
                            base_epoch,
                            &payload,
                            staged,
                        )?;
                        if actual != fingerprint {
                            let reason = format!("pending StagedCommit fingerprint mismatch while clearing rejected account removal {operation_id}");
                            integrity_error = Some(reason.clone());
                            return Err(reason);
                        }
                        group
                            .mls
                            .clear_pending_commit(self.provider.storage())
                            .map_err(text)?;
                        tx.execute(
                            "DELETE FROM client_membership_commits WHERE operation_id = ?1",
                            [&operation_id],
                        )
                        .map_err(text)?;
                        Ok(())
                    })();
                    if let Err(clear_error) = clearing {
                        let _ = tx.rollback();
                        self.reload_group(&room_id)?;
                        if let Some(reason) = integrity_error {
                            self.record_desync(&room_id, &reason)?;
                            return Err(format!("RecoveryRequired: {reason}"));
                        }
                        return Err(format!("temporary local storage error while clearing rejected account removal: {clear_error}"));
                    }
                    if let Err(commit_error) = tx.commit() {
                        self.reload_group(&room_id)?;
                        return Err(format!("temporary local storage error while committing rejected account removal cleanup: {}", text(commit_error)));
                    }
                    return Err(error);
                }
                Err(error) if is_join_request_not_pending_rejection(&payload, &error) => {
                    let target_user_id = payload["joinRequestUserId"]
                        .as_str()
                        .ok_or("join approval payload has no target user")?
                        .to_string();
                    let claim_id = payload["keyPackageClaimId"]
                        .as_str()
                        .ok_or("join approval payload has no KeyPackage claim ID")?
                        .to_string();
                    let staged_fingerprint = {
                        let group = self
                            .groups
                            .get(&room_id)
                            .ok_or("membership journal room disappeared")?;
                        let staged = group
                            .mls
                            .pending_commit()
                            .ok_or("pending StagedCommit missing during rejected join approval")?;
                        membership_commit_fingerprint(
                            &self.provider,
                            &room_id,
                            &operation_id,
                            base_epoch,
                            &payload,
                            staged,
                        )?
                    };
                    if staged_fingerprint != fingerprint {
                        let reason = format!("pending StagedCommit fingerprint mismatch while clearing rejected join approval {operation_id}");
                        self.record_desync(&room_id, &reason)?;
                        return Err(format!("RecoveryRequired: {reason}"));
                    }
                    let released = self.call(
                        "DELETE",
                        &format!(
                            "/mls/key-packages/claims/{}",
                            urlencoding::encode(&claim_id)
                        ),
                        None,
                    )?;
                    if released["released"].as_bool().is_none() {
                        return Err("server did not confirm release of KeyPackage claim for rejected join approval".to_string());
                    }
                    let tx = self.meta.unchecked_transaction().map_err(text)?;
                    let clearing = (|| -> Result<(), String> {
                        let group = self
                            .groups
                            .get_mut(&room_id)
                            .ok_or("membership journal room disappeared")?;
                        let staged = group.mls.pending_commit().ok_or("pending StagedCommit disappeared during rejected join approval cleanup")?;
                        let actual = membership_commit_fingerprint(
                            &self.provider,
                            &room_id,
                            &operation_id,
                            base_epoch,
                            &payload,
                            staged,
                        )?;
                        if actual != fingerprint {
                            return Err("pending StagedCommit fingerprint changed during rejected join approval cleanup".to_string());
                        }
                        group
                            .mls
                            .clear_pending_commit(self.provider.storage())
                            .map_err(text)?;
                        tx.execute(
                            "DELETE FROM client_membership_commits WHERE operation_id = ?1",
                            [&operation_id],
                        )
                        .map_err(text)?;
                        tx.execute(
                            "DELETE FROM client_invite_intents WHERE operation_id = ?1",
                            [&operation_id],
                        )
                        .map_err(text)?;
                        tx.execute(
                            "DELETE FROM client_key_package_claims WHERE room_id = ?1 AND user_id = ?2 AND claim_id = ?3",
                            rusqlite::params![room_id, target_user_id, claim_id],
                        ).map_err(text)?;
                        Ok(())
                    })();
                    if let Err(clear_error) = clearing {
                        let _ = tx.rollback();
                        self.reload_group(&room_id)?;
                        let reason = format!(
                            "failed to clear rejected join approval {operation_id}: {clear_error}"
                        );
                        self.record_desync(&room_id, &reason)?;
                        return Err(format!("RecoveryRequired: {reason}"));
                    }
                    if let Err(commit_error) = tx.commit() {
                        self.reload_group(&room_id)?;
                        return Err(format!("local storage error while committing rejected join approval cleanup: {}", text(commit_error)));
                    }
                    return Err(error);
                }
                Err(error)
                    if response_error_code(&error).as_deref() == Some("operation_id_reused") =>
                {
                    self.record_desync(
                        &room_id,
                        &format!("server rejected reused membership operation ID {operation_id}"),
                    )?;
                    return Err(error);
                }
                Err(error)
                    if matches!(
                        response_error_code(&error).as_deref(),
                        Some(
                            "claim_committed"
                                | "claim_missing"
                                | "claim_released"
                                | "claim_room_mismatch"
                                | "claim_mismatch"
                        )
                    ) =>
                {
                    let reason = format!("server KeyPackage claim conflict for membership operation {operation_id}: {error}");
                    self.record_desync(&room_id, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
                Err(error) => return Err(error),
            }
        }
        Ok(stale_cleared)
    }

    /// Приглашает пользователя: KeyPackage claim intent сохраняется до подтверждения Commit сервером.
    fn ensure_invite_intent(
        &mut self,
        room_id: &str,
        user_id: &str,
        is_join_request: bool,
    ) -> Result<(String, String), String> {
        let existing: Option<(String, String, bool)> = match self.meta.query_row(
            "SELECT operation_id, state, is_join_request FROM client_invite_intents WHERE room_id = ?1 AND target_user_id = ?2",
            rusqlite::params![room_id, user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? != 0)),
        ) {
            Ok(row) => Some(row),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(error) => return Err(text(error)),
        };
        if let Some((operation_id, state, existing_is_join_request)) = existing {
            if existing_is_join_request != is_join_request {
                return Err(
                    "an invite intent already exists for this user with a different operation type"
                        .to_string(),
                );
            }
            return Ok((operation_id, state));
        }
        let operation_id = hex_encode(&self.provider.rand().random_vec(16).map_err(text)?);
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta.execute(
            "INSERT INTO client_invite_intents (operation_id, room_id, target_user_id, state, created_at, is_join_request)
             VALUES (?1, ?2, ?3, 'claim_pending', ?4, ?5)",
            rusqlite::params![operation_id, room_id, user_id, created_at, if is_join_request { 1_i64 } else { 0_i64 }],
        ).map_err(text)?;
        Ok((operation_id, "claim_pending".to_string()))
    }

    fn resume_claim_pending_invite(
        &mut self,
        room_id: &str,
        user_id: &str,
        operation_id: &str,
        is_join_request: bool,
    ) -> Result<bool, String> {
        let state: String = self
            .meta
            .query_row(
                "SELECT state FROM client_invite_intents WHERE operation_id = ?1",
                [operation_id],
                |row| row.get(0),
            )
            .map_err(text)?;
        if state != "claim_pending" {
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
            let reason =
                format!("server returned a different reservation identity for {operation_id}");
            self.record_desync(room_id, &reason)?;
            return Err(format!("RecoveryRequired: {reason}"));
        }
        let packages = claimed["packages"]
            .as_array()
            .ok_or("нет поля packages")?
            .clone();
        if packages.is_empty() {
            let released = self.call(
                "DELETE",
                &format!(
                    "/mls/key-packages/claims/{}",
                    urlencoding::encode(operation_id)
                ),
                None,
            )?;
            if released["released"].as_bool().is_none() {
                return Err("сервер не подтвердил release пустого KeyPackage claim".to_string());
            }
            self.meta
                .execute(
                    "DELETE FROM client_invite_intents WHERE operation_id = ?1",
                    [operation_id],
                )
                .map_err(text)?;
            return Err(format!("у {user_id} нет ключевых пакетов"));
        }

        let mut key_packages = Vec::with_capacity(packages.len());
        let mut devices = Vec::with_capacity(packages.len());
        for package in &packages {
            let bytes = B64
                .decode(package["package"].as_str().ok_or("пакет не строка")?)
                .map_err(text)?;
            let key_package = KeyPackageIn::tls_deserialize_exact(&bytes)
                .map_err(text)?
                .validate(self.provider.crypto(), ProtocolVersion::Mls10)
                .map_err(text)?;
            key_packages.push(key_package);
            devices.push(
                package["deviceId"]
                    .as_str()
                    .ok_or("нет deviceId")?
                    .to_string(),
            );
        }
        devices.sort();
        devices.dedup();

        let tx = self.meta.unchecked_transaction().map_err(text)?;
        let staged = (|| -> Result<(), String> {
            let group = self
                .groups
                .get_mut(room_id)
                .ok_or("комната не создана на этом устройстве")?;
            let base_epoch = group.mls.epoch().as_u64();
            let (commit, welcome, _) = group
                .mls
                .add_members(&self.provider, &self.signer, &key_packages)
                .map_err(text)?;
            let commit_bytes = commit.tls_serialize_detached().map_err(text)?;
            let welcome_bytes = welcome.tls_serialize_detached().map_err(text)?;
            let welcome_b64 = B64.encode(&welcome_bytes);
            let welcomes: Vec<Value> = devices.iter()
                .map(|device| json!({ "userId": user_id, "deviceId": device, "welcome": welcome_b64 }))
                .collect();
            let changes = json!({ "adds": [user_id], "removes": [], "removeDevices": [] });
            let mut payload = json!({
                "epoch": base_epoch,
                "commit": B64.encode(&commit_bytes),
                "changes": changes,
                "welcomes": welcomes,
                "clientOperationId": operation_id,
                "keyPackageClaimId": operation_id,
            });
            if is_join_request {
                payload["joinRequestUserId"] = json!(user_id);
            }
            let recipients: Vec<Value> = devices
                .iter()
                .map(|device| json!({ "userId": user_id, "deviceId": device }))
                .collect();
            let metadata = json!({ "changes": changes, "welcomeRecipients": recipients });
            let pending = group
                .mls
                .pending_commit()
                .ok_or("OpenMLS did not retain the staged membership commit")?;
            verify_staged_membership_metadata(&group.mls, pending, &metadata)?;
            let fingerprint = membership_commit_fingerprint(
                &self.provider,
                room_id,
                operation_id,
                base_epoch,
                &payload,
                pending,
            )?;
            let claim_ids = serde_json::to_string(&vec![operation_id.to_string()]).map_err(text)?;
            let payload_json = serde_json::to_string(&payload).map_err(text)?;
            let created_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            tx.execute(
                "INSERT INTO client_membership_commits (operation_id, room_id, base_epoch, fingerprint, payload, claim_ids, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![operation_id, room_id, base_epoch as i64, fingerprint, payload_json, claim_ids, created_at],
            ).map_err(text)?;
            tx.execute(
                "UPDATE client_invite_intents SET state = 'commit_pending' WHERE operation_id = ?1",
                [operation_id],
            )
            .map_err(text)?;
            Ok(())
        })();
        if let Err(error) = staged {
            let _ = tx.rollback();
            self.reload_group(room_id)?;
            return Err(error);
        }
        if let Err(error) = tx.commit() {
            self.reload_group(room_id)?;
            return Err(format!(
                "не удалось зафиксировать staged membership journal: {}",
                text(error)
            ));
        }
        // The durable StagedCommit and its stable operation receipt now survive restart.
        crash_at_test_failpoint("after_membership_commit_journal_commit");
        if self.flush_pending_membership_commits()? > 0 {
            let mut incoming = Vec::new();
            self.sync_room(room_id, &mut incoming)?;
            self.inbox.extend(incoming);
            return Ok(false);
        }
        Ok(true)
    }

    fn resume_claim_pending_invites(&mut self) -> Result<(), String> {
        let intents: Vec<(String, String, String, bool)> = {
            let mut stmt = self
                .meta
                .prepare(
                    "SELECT operation_id, room_id, target_user_id, is_join_request FROM client_invite_intents
                 WHERE state = 'claim_pending' ORDER BY created_at, operation_id",
                )
                .map_err(text)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get::<_, i64>(3)? != 0,
                    ))
                })
                .map_err(text)?;
            rows.collect::<Result<_, _>>().map_err(text)?
        };
        for (operation_id, room_id, user_id, is_join_request) in intents {
            let mut completed = false;
            for attempt in 0..3 {
                if self.resume_claim_pending_invite(
                    &room_id,
                    &user_id,
                    &operation_id,
                    is_join_request,
                )? {
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
        let intent: Option<(String, String)> = match self.meta.query_row(
            "SELECT operation_id, state FROM client_invite_intents WHERE room_id = ?1 AND target_user_id = ?2",
            rusqlite::params![room_id, user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ) {
            Ok(row) => Some(row),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(error) => return Err(text(error)),
        };
        let Some((operation_id, state)) = intent else {
            return Ok(());
        };
        if state == "commit_pending" {
            self.flush_pending_membership_commits()?;
            let next_state: Option<String> = match self.meta.query_row(
                "SELECT state FROM client_invite_intents WHERE operation_id = ?1",
                [&operation_id],
                |row| row.get(0),
            ) {
                Ok(value) => Some(value),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(error) => return Err(text(error)),
            };
            match next_state.as_deref() {
                None => return Ok(()),
                Some("commit_pending") => {
                    return Err("membership commit остаётся staged; reservation нельзя release до ACK/replay".to_string());
                }
                Some("claim_pending") => {}
                Some(other) => return Err(format!("unknown invite intent state: {other}")),
            }
        }
        let result = self.call(
            "DELETE",
            &format!(
                "/mls/key-packages/claims/{}",
                urlencoding::encode(&operation_id)
            ),
            None,
        )?;
        if result["released"].as_bool().is_none() {
            return Err("сервер не подтвердил release KeyPackage claim".to_string());
        }
        let tx = self.meta.unchecked_transaction().map_err(text)?;
        tx.execute(
            "DELETE FROM client_invite_intents WHERE operation_id = ?1",
            [&operation_id],
        )
        .map_err(text)?;
        tx.execute(
            "DELETE FROM client_key_package_claims WHERE room_id = ?1 AND user_id = ?2",
            rusqlite::params![room_id, user_id],
        )
        .map_err(text)?;
        tx.commit().map_err(text)?;
        Ok(())
    }

    fn invite_with_mode(
        &mut self,
        room_id: &str,
        user_id: &str,
        is_join_request: bool,
    ) -> Result<(), String> {
        self.ensure_writable()?;
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!("комната требует восстановления: {reason}"));
        }
        self.flush_pending_membership_commits()?;
        let (operation_id, state) = self.ensure_invite_intent(room_id, user_id, is_join_request)?;
        if state == "commit_pending" {
            self.flush_pending_membership_commits()?;
            let next_state: Option<String> = match self.meta.query_row(
                "SELECT state FROM client_invite_intents WHERE operation_id = ?1",
                [&operation_id],
                |row| row.get(0),
            ) {
                Ok(value) => Some(value),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(error) => return Err(text(error)),
            };
            match next_state.as_deref() {
                None => return Ok(()),
                Some("claim_pending") => {}
                Some("commit_pending") => {
                    let reason =
                        format!("commit_pending invite {operation_id} has no resolvable ACK");
                    self.record_desync(room_id, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
                Some(other) => return Err(format!("unknown invite intent state: {other}")),
            }
        }
        for attempt in 0..3 {
            if self.resume_claim_pending_invite(room_id, user_id, &operation_id, is_join_request)? {
                return Ok(());
            }
            if attempt == 2 {
                return Err(format!(
                    "epoch_outdated: invite {operation_id} exhausted safe rebase attempts"
                ));
            }
        }
        Err("invite не удалось применить".to_string())
    }

    pub fn invite(&mut self, room_id: &str, user_id: &str) -> Result<(), String> {
        self.invite_with_mode(room_id, user_id, false)
    }

    /// Approves a pending room join request through the durable MLS Add Commit + Welcome flow.
    pub fn approve_join_request(&mut self, room_id: &str, user_id: &str) -> Result<(), String> {
        self.invite_with_mode(room_id, user_id, true)
    }

    /// Отправляет UTF-8 текст в комнату. Устройство должно быть на эпохе сервера.
    pub fn send_text(&mut self, room_id: &str, plaintext: &str) -> Result<String, String> {
        let id = hex_encode(&self.provider.rand().random_vec(16).map_err(text)?);
        self.send_text_with_id(room_id, plaintext, &id)
    }

    /// Отправляет UTF-8 текст с durable idempotency: точное MLS-сообщение
    /// и sender ratchet фиксируются в SQLCipher до обращения к серверу.
    pub fn send_text_with_id(
        &mut self,
        room_id: &str,
        plaintext: &str,
        client_message_id: &str,
    ) -> Result<String, String> {
        self.send_application_payload_with_id(room_id, plaintext.as_bytes(), client_message_id)
    }

    fn create_and_persist_outbox_message(
        &mut self,
        room_id: &str,
        client_message_id: &str,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, String> {
        let transaction = self.meta.unchecked_transaction().map_err(text)?;
        let created = {
            let transactional_provider = DeviceProvider::new(
                Arc::clone(&self.provider.crypto),
                TransactionConnection(&transaction),
            );
            let group = self
                .groups
                .get_mut(room_id)
                .ok_or("комната не создана на этом устройстве")?;
            let epoch = group.mls.epoch().as_u64();
            let result = group
                .mls
                .create_message(&transactional_provider, &self.signer, plaintext)
                .map_err(text)
                .and_then(|message| message.tls_serialize_detached().map_err(text));
            result.map(|bytes| (bytes, epoch))
        };
        let (message, epoch) = match created {
            Ok(created) => created,
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(error);
            }
        };
        let changed = match transaction.execute(
            "UPDATE client_outbox
             SET mls_message = ?2, mls_epoch = ?3
             WHERE local_id = ?1 AND room_id = ?4 AND payload = ?5 AND mls_message IS NULL",
            rusqlite::params![client_message_id, message, epoch as i64, room_id, plaintext],
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
            return Err("outbox operation changed before MLS message persistence".to_string());
        }
        crash_at_test_failpoint("outbox_before_message_commit");
        if let Err(error) = transaction.commit() {
            self.reload_group(room_id)?;
            return Err(text(error));
        }
        crash_at_test_failpoint("outbox_after_message_commit");
        Ok(message)
    }

    fn persist_outgoing_message(
        &mut self,
        client_message_id: &str,
        room_id: &str,
        payload: &[u8],
        event_id: &str,
    ) -> Result<(), String> {
        let transaction = self.meta.unchecked_transaction().map_err(text)?;
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let (kind, body) = match std::str::from_utf8(payload) {
            Ok(text) => ("text", Some(text)),
            Err(_) => ("unreadable", None),
        };
        let inserted = transaction
            .execute(
                "INSERT INTO client_inbox
                 (event_id, room_id, kind, body, payload, acknowledged, created_at, acknowledged_at, direction, client_message_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, NULL, 'outgoing', ?7)
                 ON CONFLICT(event_id) DO UPDATE SET
                   acknowledged = 1,
                   acknowledged_at = NULL,
                   direction = 'outgoing',
                   client_message_id = excluded.client_message_id,
                   payload = excluded.payload
                 WHERE client_inbox.room_id = excluded.room_id
                   AND client_inbox.kind = excluded.kind
                   AND client_inbox.body IS excluded.body
                   AND (client_inbox.client_message_id IS NULL
                        OR client_inbox.client_message_id = excluded.client_message_id)
                   AND (client_inbox.payload IS NULL OR client_inbox.payload = excluded.payload)",
                rusqlite::params![
                    event_id,
                    room_id,
                    kind,
                    body,
                    payload,
                    created_at,
                    client_message_id
                ],
            )
            .map_err(text)?;
        if inserted != 1 {
            return Err("server event ID conflicts with a different local message".to_string());
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO client_processed (event_id) VALUES (?1)",
                [event_id],
            )
            .map_err(text)?;
        let removed = transaction
            .execute(
                "DELETE FROM client_outbox
                 WHERE local_id = ?1 AND room_id = ?2 AND payload = ?3 AND mls_message IS NOT NULL",
                rusqlite::params![client_message_id, room_id, payload],
            )
            .map_err(text)?;
        if removed != 1 {
            return Err(
                "durable outgoing message journal disappeared before completion".to_string(),
            );
        }
        transaction.commit().map_err(text)?;
        self.processed.insert(event_id.to_string());
        Ok(())
    }

    /// Persist the sender ratchet and exact attachment MLS ciphertext in one SQLCipher transaction.
    fn create_and_persist_attachment_mls_message(
        &mut self,
        room_id: &str,
        operation_id: &str,
        file_id: &str,
        manifest: &[u8],
        epoch: u64,
    ) -> Result<Vec<u8>, String> {
        let transaction = self.meta.unchecked_transaction().map_err(text)?;
        let created = {
            let transactional_provider = DeviceProvider::new(
                Arc::clone(&self.provider.crypto),
                TransactionConnection(&transaction),
            );
            let group = self
                .groups
                .get_mut(room_id)
                .ok_or("комната не создана на этом устройстве")?;
            let current_epoch = group.mls.epoch().as_u64();
            if current_epoch != epoch {
                drop(transactional_provider);
                drop(transaction);
                return Err("MLS room epoch changed before attachment encryption".to_string());
            }
            group
                .mls
                .create_message(&transactional_provider, &self.signer, manifest)
                .map_err(text)
                .and_then(|message| message.tls_serialize_detached().map_err(text))
        };
        let message = match created {
            Ok(message) => message,
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(error);
            }
        };
        let changed = match transaction.execute(
            "UPDATE client_attachment_outbox
             SET mls_message = ?4, mls_epoch = ?5
             WHERE client_message_id = ?1 AND room_id = ?2 AND file_id = ?3
               AND uploaded = 1
               AND (mls_message IS NULL OR mls_epoch IS NULL OR mls_epoch != ?5)",
            rusqlite::params![operation_id, room_id, file_id, message, epoch as i64],
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
        crash_at_test_failpoint("attachment_before_mls_message_commit");
        if let Err(error) = transaction.commit() {
            self.reload_group(room_id)?;
            return Err(text(error));
        }
        crash_at_test_failpoint("attachment_after_mls_message_commit");
        Ok(message)
    }

    /// Encrypts attachment bytes before upload; only ciphertext and its digest reach the file service.
    /// The manifest (including file key and nonce) is sent only inside an MLS application message.
    pub fn send_attachment(
        &mut self,
        room_id: &str,
        name: &str,
        mime_type: &str,
        plaintext: &[u8],
    ) -> Result<String, String> {
        let random_id = self.provider.rand().random_array::<16>().map_err(text)?;
        self.send_attachment_with_id(room_id, name, mime_type, plaintext, &hex_encode(&random_id))
    }

    /// Retries with the same ID reuse the same file key/nonce, manifest, and MLS ciphertext.
    pub fn send_attachment_with_id(
        &mut self,
        room_id: &str,
        name: &str,
        mime_type: &str,
        plaintext: &[u8],
        client_message_id: &str,
    ) -> Result<String, String> {
        self.ensure_writable()?;
        if room_id.trim().is_empty()
            || client_message_id.is_empty()
            || client_message_id.len() > 60
            || !client_message_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err("clientMessageId must contain 1-60 letters, digits, _ or -".to_string());
        }
        if name.is_empty()
            || name.len() > 255
            || name.chars().any(char::is_control)
            || name.contains('/')
            || name.contains('\\')
        {
            return Err("invalid attachment display name".to_string());
        }
        if mime_type.is_empty() || mime_type.len() > 127 || mime_type.chars().any(char::is_control)
        {
            return Err("invalid attachment MIME type".to_string());
        }
        if plaintext.is_empty() || plaintext.len() as u64 > 250 * 1024 * 1024 - 16 {
            return Err(
                "attachment size must be between 1 byte and 250 MiB minus the GCM tag".to_string(),
            );
        }

        let operation_id = format!("att_{client_message_id}");
        if self.flush_pending_membership_commits()? > 0 {
            self.sync()?;
        }
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!(
                "комната рассинхронизирована и требует восстановления: {reason}"
            ));
        }

        let completed: Option<(String, String, String, Vec<u8>)> = self
            .meta
            .query_row(
                "SELECT room_id, file_id, event_id, manifest
                 FROM client_attachments
                 WHERE client_message_id = ?1 AND direction = 'outgoing'",
                [&operation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(text)?;
        if let Some((stored_room, stored_file_id, event_id, stored_manifest)) = completed {
            if stored_room != room_id {
                return Err("clientMessageId is already completed for a different room".to_string());
            }
            let stored_manifest = Zeroizing::new(stored_manifest);
            let manifest = attachment_crypto::parse_manifest(
                stored_manifest.as_slice(),
                &stored_file_id,
                room_id,
            )?;
            if manifest.name != name
                || manifest.mime_type != mime_type
                || manifest.size != plaintext.len() as u64
                || manifest.sha256 != attachment_crypto::sha256_hex(plaintext)
            {
                return Err(
                    "clientMessageId retry payload does not match the completed attachment"
                        .to_string(),
                );
            }
            return Ok(event_id);
        }

        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!(
                "комната рассинхронизирована и требует восстановления: {reason}"
            ));
        }
        let initial_server_epoch = self.server_epoch(room_id)?;
        let initial_local_epoch = self
            .groups
            .get(room_id)
            .ok_or("комната не создана на этом устройстве")?
            .mls
            .epoch()
            .as_u64();
        if initial_local_epoch != initial_server_epoch {
            return Err(format!(
                "устройство на эпохе {initial_local_epoch}, сервер на {initial_server_epoch}: сначала синхронизация"
            ));
        }

        let existing: Option<(String, String, Vec<u8>, String, i64, bool)> = self
            .meta
            .query_row(
                "SELECT room_id, file_id, manifest, ciphertext_sha256, ciphertext_size, uploaded
                 FROM client_attachment_outbox WHERE client_message_id = ?1",
                [&operation_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(text)?;

        let file_id: String;
        let mut upload_url: Option<String> = None;
        let manifest_payload: Zeroizing<Vec<u8>>;
        let ciphertext: Zeroizing<Vec<u8>>;
        let mut already_uploaded = false;

        if let Some((
            stored_room,
            stored_file_id,
            stored_manifest,
            stored_hash,
            stored_size,
            uploaded,
        )) = existing
        {
            if stored_room != room_id {
                return Err("clientMessageId is already reserved for a different room".to_string());
            }
            let stored_manifest = Zeroizing::new(stored_manifest);
            let parsed = attachment_crypto::parse_manifest(
                stored_manifest.as_slice(),
                &stored_file_id,
                room_id,
            )?;
            if parsed.name != name
                || parsed.mime_type != mime_type
                || parsed.size != plaintext.len() as u64
                || parsed.sha256 != attachment_crypto::sha256_hex(plaintext)
            {
                return Err(
                    "clientMessageId retry payload does not match the persisted attachment"
                        .to_string(),
                );
            }
            ciphertext = Zeroizing::new(attachment_crypto::encrypt(
                plaintext,
                &parsed.key,
                &parsed.nonce,
                room_id,
            )?);
            if attachment_crypto::sha256_hex(ciphertext.as_slice()) != stored_hash
                || ciphertext.len() as i64 != stored_size
            {
                return Err(
                    "persisted attachment retry ciphertext does not match its SQLCipher journal"
                        .to_string(),
                );
            }
            if uploaded {
                file_id = stored_file_id;
                manifest_payload = Zeroizing::new(stored_manifest.to_vec());
                already_uploaded = true;
            } else {
                // The previous signed URL may have expired; reserve a fresh object but reuse key/nonce.
                let (new_file_id, new_upload_url) =
                    self.reserve_attachment_upload(room_id, ciphertext.as_slice())?;
                let new_manifest = Zeroizing::new(attachment_crypto::build_manifest(
                    &new_file_id,
                    room_id,
                    name,
                    mime_type,
                    plaintext,
                    ciphertext.as_slice(),
                    &parsed.key,
                    &parsed.nonce,
                )?);
                let changed = self
                    .meta
                    .execute(
                        "UPDATE client_attachment_outbox
                         SET file_id = ?2, manifest = ?3, ciphertext_sha256 = ?4,
                             ciphertext_size = ?5, uploaded = 0, mls_message = NULL, mls_epoch = NULL
                         WHERE client_message_id = ?1 AND room_id = ?6",
                        rusqlite::params![
                            operation_id,
                            new_file_id,
                            new_manifest.as_slice(),
                            attachment_crypto::sha256_hex(ciphertext.as_slice()),
                            ciphertext.len() as i64,
                            room_id
                        ],
                    )
                    .map_err(text)?;
                if changed != 1 {
                    return Err(
                        "attachment retry journal changed during upload reservation".to_string()
                    );
                }
                file_id = new_file_id;
                upload_url = Some(new_upload_url);
                manifest_payload = new_manifest;
            }
        } else {
            let key = Zeroizing::new(self.provider.rand().random_array::<32>().map_err(text)?);
            let nonce = Zeroizing::new(self.provider.rand().random_array::<12>().map_err(text)?);
            ciphertext = Zeroizing::new(attachment_crypto::encrypt(
                plaintext, &key, &nonce, room_id,
            )?);
            let ciphertext_hash = attachment_crypto::sha256_hex(ciphertext.as_slice());
            let (reserved_file_id, reserved_upload_url) =
                self.reserve_attachment_upload(room_id, ciphertext.as_slice())?;
            let manifest = Zeroizing::new(attachment_crypto::build_manifest(
                &reserved_file_id,
                room_id,
                name,
                mime_type,
                plaintext,
                ciphertext.as_slice(),
                &key,
                &nonce,
            )?);
            self.meta
                .execute(
                    "INSERT INTO client_attachment_outbox
                     (client_message_id, room_id, file_id, manifest, ciphertext_sha256,
                      ciphertext_size, ciphertext, created_at, uploaded)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
                    rusqlite::params![
                        operation_id,
                        room_id,
                        reserved_file_id,
                        manifest.as_slice(),
                        ciphertext_hash,
                        ciphertext.len() as i64,
                        ciphertext.as_slice(),
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64
                    ],
                )
                .map_err(text)?;
            file_id = reserved_file_id;
            upload_url = Some(reserved_upload_url);
            manifest_payload = manifest;
        }

        if !already_uploaded {
            let signed_upload_url = upload_url
                .as_deref()
                .ok_or("attachment upload URL is missing for an unuploaded outbox item")?;
            self.upload_signed_bytes(signed_upload_url, ciphertext.as_slice())?;
            self.call(
                "POST",
                &format!("/files/{}/complete", urlencoding::encode(&file_id)),
                Some(json!({})),
            )?;
            let changed = self
                .meta
                .execute(
                    "UPDATE client_attachment_outbox
                     SET uploaded = 1
                     WHERE client_message_id = ?1 AND file_id = ?2 AND uploaded = 0",
                    rusqlite::params![operation_id, file_id],
                )
                .map_err(text)?;
            if changed != 1 {
                return Err("attachment outbox disappeared after successful upload".to_string());
            }
        }

        let mut server_epoch = self.server_epoch(room_id)?;
        let mut local_epoch = self
            .groups
            .get(room_id)
            .ok_or("комната не создана на этом устройстве")?
            .mls
            .epoch()
            .as_u64();
        if local_epoch != server_epoch {
            self.sync()?;
            server_epoch = self.server_epoch(room_id)?;
            local_epoch = self
                .groups
                .get(room_id)
                .ok_or("комната не создана на этом устройстве")?
                .mls
                .epoch()
                .as_u64();
        }
        if local_epoch != server_epoch {
            return Err(format!(
                "устройство на эпохе {local_epoch}, сервер на {server_epoch}: вложение сохранено в очереди, сначала синхронизация"
            ));
        }
        let expected_epoch = i64::try_from(server_epoch)
            .map_err(|_| "MLS epoch exceeds the persistent attachment journal range".to_string())?;
        let persisted_message: (Option<Vec<u8>>, Option<i64>) = self
            .meta
            .query_row(
                "SELECT mls_message, mls_epoch FROM client_attachment_outbox
                 WHERE client_message_id = ?1 AND room_id = ?2 AND file_id = ?3 AND uploaded = 1",
                rusqlite::params![operation_id, room_id, file_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(text)?
            .ok_or_else(|| {
                "attachment outbox disappeared before MLS message persistence".to_string()
            })?;
        let mls_message = match persisted_message {
            (Some(bytes), Some(epoch)) if !bytes.is_empty() && epoch == expected_epoch => {
                Zeroizing::new(bytes)
            }
            _ => Zeroizing::new(self.create_and_persist_attachment_mls_message(
                room_id,
                &operation_id,
                &file_id,
                manifest_payload.as_slice(),
                server_epoch,
            )?),
        };

        let response = self.call(
            "POST",
            &format!("/mls/groups/{}/messages", urlencoding::encode(room_id)),
            Some(json!({
                "message": B64.encode(mls_message.as_slice()),
                "kind": "text",
                "forwarded": false,
                "clientMessageId": operation_id,
                "fileId": file_id,
            })),
        )?;
        let event_id = response
            .get("event_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or("сервер не вернул event_id для вложения")?
            .to_string();

        let incoming = Incoming::Attachment {
            room_id: room_id.to_string(),
            event_id: event_id.clone(),
            file_id: file_id.clone(),
            name: name.to_string(),
            mime_type: mime_type.to_string(),
            size: plaintext.len() as u64,
            mine: true,
        };
        let transaction = self.meta.unchecked_transaction().map_err(text)?;
        insert_incoming_record(&transaction, &incoming)?;
        let tagged = transaction
            .execute(
                "UPDATE client_inbox
                 SET client_message_id = ?1, acknowledged = 1, acknowledged_at = NULL
                 WHERE event_id = ?2 AND room_id = ?3",
                rusqlite::params![operation_id, event_id, room_id],
            )
            .map_err(text)?;
        if tagged != 1 {
            return Err("could not tag outgoing attachment direction in local history".to_string());
        }
        insert_attachment_manifest(
            &transaction,
            &incoming,
            manifest_payload.as_slice(),
            "outgoing",
            Some(&operation_id),
        )?;
        // A recovery sync can quarantine this server-committed event before the
        // durable outbox has enough information to reconstruct its attachment.
        // Once the idempotent outgoing operation is confirmed and its manifest is
        // committed locally, that authenticated local record supersedes the stale
        // unreadable inbox placeholder and diagnostic.
        let attachment_body = serde_json::to_string(&json!({
            "fileId": file_id,
            "name": name,
            "mimeType": mime_type,
            "size": plaintext.len() as u64,
        }))
        .map_err(text)?;
        let normalized = transaction
            .execute(
                "UPDATE client_inbox SET kind = 'text', body = ?1
                 WHERE event_id = ?2 AND room_id = ?3 AND client_message_id = ?4",
                rusqlite::params![attachment_body, event_id, room_id, operation_id],
            )
            .map_err(text)?;
        if normalized != 1 {
            return Err(
                "could not normalize recovered outgoing attachment inbox record".to_string(),
            );
        }
        transaction
            .execute(
                "DELETE FROM client_undecryptable WHERE event_id = ?1",
                [&event_id],
            )
            .map_err(text)?;
        let removed = transaction
            .execute(
                "DELETE FROM client_attachment_outbox WHERE client_message_id = ?1 AND file_id = ?2",
                rusqlite::params![operation_id, file_id],
            )
            .map_err(text)?;
        if removed != 1 {
            return Err("attachment outbox disappeared before local history commit".to_string());
        }
        crash_at_test_failpoint("attachment_before_history_commit");
        transaction.commit().map_err(text)?;
        crash_at_test_failpoint("attachment_after_history_commit");
        self.reconcile_outgoing_attachment_handoff(incoming);
        self.processed.insert(event_id.clone());
        Ok(event_id)
    }

    /// Reconciles an outgoing attachment with any copy queued by a recovery sync.
    /// The durable SQLCipher attachment record is authoritative for sender direction.
    fn reconcile_outgoing_attachment_handoff(&mut self, mut incoming: Incoming) {
        let (event_id, file_id) = match &mut incoming {
            Incoming::Attachment {
                event_id,
                file_id,
                mine,
                ..
            } => {
                // The durable outgoing SQLCipher record is authoritative even
                // when recovery did not already enqueue an inbox copy.
                *mine = true;
                (event_id.clone(), file_id.clone())
            }
            _ => return,
        };
        let mut handoff_present = false;
        self.inbox.retain_mut(|item| {
            if let Incoming::Attachment {
                event_id: queued_event_id,
                file_id: queued_file_id,
                mine,
                ..
            } = item
            {
                if queued_event_id == &event_id || queued_file_id == &file_id {
                    if handoff_present {
                        return false;
                    }
                    *queued_event_id = event_id.clone();
                    *queued_file_id = file_id.clone();
                    *mine = true;
                    handoff_present = true;
                }
            }
            true
        });
        if !handoff_present {
            self.inbox.push(incoming);
        }
    }

    /// Fetches the encrypted object only for the active authenticated device, then verifies and decrypts locally.
    pub fn download_attachment(&self, file_id: &str) -> Result<Vec<u8>, String> {
        if file_id.trim().is_empty() || file_id.len() > 128 {
            return Err("invalid attachment fileId".to_string());
        }
        let (room_id, manifest_bytes): (String, Vec<u8>) = self
            .meta
            .query_row(
                "SELECT room_id, manifest FROM client_attachments WHERE file_id = ?1",
                [file_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(text)?
            .ok_or_else(|| {
                "attachment manifest is not available in the encrypted local inbox".to_string()
            })?;
        let manifest_bytes = Zeroizing::new(manifest_bytes);
        let manifest =
            attachment_crypto::parse_manifest(manifest_bytes.as_slice(), file_id, &room_id)?;
        for attempt in 0..2 {
            let link = self.call(
                "GET",
                &format!("/files/{}/url", urlencoding::encode(file_id)),
                None,
            )?;
            let download_url = link
                .get("downloadUrl")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or("file link response did not return downloadUrl")?;
            match self.download_signed_bytes(download_url, manifest.ciphertext_size) {
                Ok(ciphertext) => return attachment_crypto::decrypt(&ciphertext, &manifest),
                Err(error) if attempt == 0 && error.contains("signed download -> 403") => {
                    // Refresh the short-lived capability once; revoked devices still fail closed.
                    continue;
                }
                Err(error) => return Err(error),
            }
        }
        Err("could not obtain a valid signed attachment download".to_string())
    }

    /// Sends an opaque MLS application payload with a stable operation ID.
    /// Exact plaintext bytes and the sender ratchet are persisted before network I/O.
    pub fn send_application_payload_with_id(
        &mut self,
        room_id: &str,
        payload: &[u8],
        client_message_id: &str,
    ) -> Result<String, String> {
        if room_id.trim().is_empty()
            || client_message_id.is_empty()
            || client_message_id.len() > 64
            || !client_message_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err("invalid room ID or clientMessageId".to_string());
        }
        self.ensure_writable()?;
        let text_body = std::str::from_utf8(payload).ok();
        let display_body = text_body
            .map(str::to_string)
            .unwrap_or_else(|| format!("opaque:{}", B64.encode(payload)));

        let completed: Option<(String, String, Option<String>, Option<Vec<u8>>, String)> = self
            .meta
            .query_row(
                "SELECT room_id, kind, body, payload, event_id
                 FROM client_inbox WHERE client_message_id = ?1",
                [client_message_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(text)?;
        if let Some((stored_room, kind, body, stored_payload, event_id)) = completed {
            let same_payload = stored_payload
                .as_deref()
                .map(|stored| stored == payload)
                .unwrap_or_else(|| text_body.is_some_and(|text| body.as_deref() == Some(text)));
            let expected_kind = if text_body.is_some() {
                "text"
            } else {
                "unreadable"
            };
            if stored_room != room_id || kind != expected_kind || !same_payload {
                return Err(
                    "clientMessageId is already completed with a different room or payload"
                        .to_string(),
                );
            }
            return Ok(event_id);
        }

        if self.flush_pending_membership_commits()? > 0 {
            self.sync()?;
        }
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!(
                "комната рассинхронизирована, отправка приостановлена: {reason}"
            ));
        }

        let existing: Option<(String, String, Option<Vec<u8>>, Option<Vec<u8>>)> = self
            .meta
            .query_row(
                "SELECT room_id, body, payload, mls_message
                 FROM client_outbox WHERE local_id = ?1",
                [client_message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(text)?;
        let persisted_message = if let Some((stored_room, stored_body, stored_payload, message)) =
            existing
        {
            let same_payload = stored_payload
                .as_deref()
                .map(|stored| stored == payload)
                .unwrap_or_else(|| text_body.is_some_and(|text| stored_body == text));
            if stored_room != room_id || !same_payload {
                return Err(
                    "clientMessageId is already reserved for a different room or payload"
                        .to_string(),
                );
            }
            if stored_payload.is_none() {
                self.meta
                    .execute(
                        "UPDATE client_outbox SET payload = ?2 WHERE local_id = ?1 AND payload IS NULL",
                        rusqlite::params![client_message_id, payload],
                    )
                    .map_err(text)?;
            }
            message
        } else {
            self.meta
                .execute(
                    "INSERT INTO client_outbox (local_id, room_id, body, payload, seq)
                     VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(seq), 0) + 1 FROM client_outbox))",
                    rusqlite::params![client_message_id, room_id, display_body, payload],
                )
                .map_err(text)?;
            None
        };

        let message = match persisted_message {
            Some(message) => message,
            None => {
                let server_epoch = self.server_epoch(room_id)?;
                let local_epoch = self
                    .groups
                    .get(room_id)
                    .ok_or("комната не создана на этом устройстве")?
                    .mls
                    .epoch()
                    .as_u64();
                if local_epoch != server_epoch {
                    return Err(format!(
                        "устройство на эпохе {local_epoch}, сервер на {server_epoch}: сначала синхронизация"
                    ));
                }
                self.create_and_persist_outbox_message(room_id, client_message_id, payload)?
            }
        };

        let response = self.call(
            "POST",
            &format!("/mls/groups/{}/messages", urlencoding::encode(room_id)),
            Some(json!({
                "message": B64.encode(&message),
                "kind": "text",
                "forwarded": false,
                "clientMessageId": client_message_id
            })),
        )?;
        let event_id = response["event_id"]
            .as_str()
            .ok_or("сервер не вернул event_id")?
            .to_string();
        self.persist_outgoing_message(client_message_id, room_id, payload, &event_id)?;
        Ok(event_id)
    }

    fn insert_welcome_receipt(
        db: &Connection,
        welcome_id: i64,
        room_id: &str,
        bytes: &[u8],
        outcome: &str,
        reason: Option<&str>,
    ) -> Result<(), String> {
        db.execute(
            "INSERT OR IGNORE INTO client_welcome_receipts (welcome_id, room_id, welcome, outcome, reason, created_at, acked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            rusqlite::params![
                welcome_id,
                room_id,
                bytes,
                outcome,
                reason,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64
            ],
        ).map_err(text)?;
        let existing: (String, Vec<u8>, String) = db.query_row(
            "SELECT room_id, welcome, outcome FROM client_welcome_receipts WHERE welcome_id = ?1",
            [welcome_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(text)?;
        if existing.0 != room_id || existing.1 != bytes || existing.2 != outcome {
            return Err(format!(
                "Welcome receipt identity collision for id {welcome_id}"
            ));
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
        let tx = self.meta.unchecked_transaction().map_err(text)?;
        Self::insert_welcome_receipt(&tx, welcome_id, room_id, bytes, outcome, reason)?;
        tx.commit().map_err(text)?;
        Ok(())
    }

    pub fn welcome_receipt_status(
        &self,
        welcome_id: i64,
    ) -> Result<Option<(String, Option<String>, bool)>, String> {
        use rusqlite::OptionalExtension;
        self.meta
            .query_row(
                "SELECT outcome, reason, acked_at FROM client_welcome_receipts WHERE welcome_id = ?1",
                [welcome_id],
                |row| {
                    let outcome: String = row.get(0)?;
                    let reason: Option<String> = row.get(1)?;
                    let acked_at: Option<i64> = row.get(2)?;
                    Ok((outcome, reason, acked_at.is_some()))
                },
            )
            .optional()
            .map_err(text)
    }

    fn ack_welcome(&mut self, welcome_id: i64) -> Result<(), String> {
        let response = self.call(
            "POST",
            &format!("/mls/welcomes/{welcome_id}/ack"),
            Some(json!({})),
        );
        if let Err(error) = response {
            // 404 means the server already accepted the ACK (or the row is no longer pending).
            if !error.contains(" -> 404") {
                return Err(error);
            }
        }
        self.meta.execute(
            "UPDATE client_welcome_receipts SET acked_at = ?2 WHERE welcome_id = ?1 AND acked_at IS NULL",
            rusqlite::params![
                welcome_id,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64
            ],
        ).map_err(text)?;
        Ok(())
    }

    fn retry_pending_welcome_acks(&mut self) -> Result<(), String> {
        let ids: Vec<i64> = {
            let mut statement = self.meta.prepare(
                "SELECT welcome_id FROM client_welcome_receipts WHERE acked_at IS NULL ORDER BY created_at, welcome_id"
            ).map_err(text)?;
            let rows = statement.query_map([], |row| row.get(0)).map_err(text)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(text)?
        };
        for welcome_id in ids {
            // Leave the durable receipt pending if the ACK cannot be confirmed.
            let _ = self.ack_welcome(welcome_id);
        }
        Ok(())
    }

    /// Входит в группы по Welcome. Permanent failures first commit a durable receipt, then ACK.
    /// GroupAlreadyExists and indeterminate Library/Storage failures are never ACKed or quarantined.
    fn join_welcomes(&mut self) -> Result<(), String> {
        self.retry_pending_welcome_acks()?;
        let pending = self.call("GET", "/mls/welcomes", None)?;
        for row in pending["welcomes"].as_array().cloned().unwrap_or_default() {
            let Some(welcome_id) = row["id"].as_i64() else {
                continue;
            };
            let Some(room_id) = row["roomId"].as_str().filter(|id| !id.trim().is_empty()) else {
                continue;
            };
            let encoded = row["welcome"].as_str().unwrap_or_default();
            let bytes = match B64.decode(encoded) {
                Ok(bytes) => bytes,
                Err(error) => {
                    let raw = encoded.as_bytes();
                    if self
                        .persist_welcome_receipt(
                            welcome_id,
                            room_id,
                            raw,
                            "quarantined",
                            Some(&format!("Welcome base64 is malformed: {error}")),
                        )
                        .is_ok()
                    {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };

            let existing: Option<(String, Vec<u8>, String, Option<i64>)> = {
                use rusqlite::OptionalExtension;
                self.meta.query_row(
                    "SELECT room_id, welcome, outcome, acked_at FROM client_welcome_receipts WHERE welcome_id = ?1",
                    [welcome_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                ).optional().map_err(text)?
            };
            if let Some((stored_room, stored_welcome, _outcome, acked_at)) = existing {
                if stored_room != room_id || stored_welcome != bytes {
                    self.record_desync(room_id, "Welcome receipt identity collision")?;
                    continue;
                }
                if acked_at.is_none() {
                    let _ = self.ack_welcome(welcome_id);
                }
                continue;
            }

            // A second Welcome for a room already joined by this client is a replay,
            // even if OpenMLS now reports NoMatchingKeyPackage because the original
            // KeyPackage was consumed. Detect it before attempting to decrypt/claim keys.
            // Keep the server item pending and make the room require explicit recovery.
            // The durable client_rooms row is authoritative even if the in-memory
            // group cache is temporarily absent. A replay must never be interpreted
            // as a fresh join merely because the cache lookup misses.
            let locally_joined: bool = self
                .meta
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM client_rooms WHERE room_id = ?1)",
                    [room_id],
                    |row| row.get(0),
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
                    if self
                        .persist_welcome_receipt(
                            welcome_id,
                            room_id,
                            &bytes,
                            "quarantined",
                            Some(&format!("Malformed Welcome encoding: {error}")),
                        )
                        .is_ok()
                    {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };
            let welcome = match message.extract() {
                MlsMessageBodyIn::Welcome(welcome) => welcome,
                _ => {
                    if self
                        .persist_welcome_receipt(
                            welcome_id,
                            room_id,
                            &bytes,
                            "quarantined",
                            Some("Server item is not an MLS Welcome"),
                        )
                        .is_ok()
                    {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };
            let join_config = MlsGroupJoinConfig::builder()
                .use_ratchet_tree_extension(true)
                .max_past_epochs(MAX_PAST_EPOCHS)
                .build();
            // Welcome processing consumes a KeyPackage as well as materializing the
            // group. Both operations must use the same SQL transaction as the room
            // index and receipt, otherwise a crash can consume the KeyPackage while
            // rolling back the group and make the server Welcome impossible to replay.
            let transaction = self.meta.unchecked_transaction().map_err(text)?;
            let transactional_provider = DeviceProvider::new(
                Arc::clone(&self.provider.crypto),
                TransactionConnection(&transaction),
            );
            let staged = match StagedWelcome::new_from_welcome(
                &transactional_provider,
                &join_config,
                welcome,
                None,
            ) {
                Ok(staged) => staged,
                Err(error) => {
                    drop(transactional_provider);
                    drop(transaction);
                    match error {
                        WelcomeError::GroupAlreadyExists => {
                            self.record_desync(
                                room_id,
                                "GroupAlreadyExists while replaying Welcome; retain Welcome without ACK for explicit recovery",
                            )?;
                        }
                        WelcomeError::LibraryError(_) | WelcomeError::StorageError(_) => {
                            // Indeterminate: keep the server Welcome pending and do not quarantine.
                        }
                        other => {
                            if self
                                .persist_welcome_receipt(
                                    welcome_id,
                                    room_id,
                                    &bytes,
                                    "quarantined",
                                    Some(&format!("Permanent Welcome error: {other:?}")),
                                )
                                .is_ok()
                            {
                                let _ = self.ack_welcome(welcome_id);
                            }
                        }
                    }
                    continue;
                }
            };
            if ensure_supported_welcome_ciphersuite(staged.group_context().ciphersuite()).is_err() {
                drop(staged);
                drop(transactional_provider);
                drop(transaction);
                if self
                    .persist_welcome_receipt(
                        welcome_id,
                        room_id,
                        &bytes,
                        "quarantined",
                        Some("Unsupported MLS ciphersuite; only X25519/Ed25519 is enabled"),
                    )
                    .is_ok()
                {
                    let _ = self.ack_welcome(welcome_id);
                }
                continue;
            }
            let mls = match staged.into_group(&transactional_provider) {
                Ok(group) => group,
                Err(error) => {
                    drop(transactional_provider);
                    drop(transaction);
                    match error {
                        WelcomeError::GroupAlreadyExists => {
                            self.record_desync(
                                room_id,
                                "GroupAlreadyExists while materializing Welcome; retain Welcome without ACK for explicit recovery",
                            )?;
                        }
                        WelcomeError::LibraryError(_) | WelcomeError::StorageError(_) => {
                            // Indeterminate storage errors leave the server Welcome pending.
                        }
                        other => {
                            if self
                                .persist_welcome_receipt(
                                    welcome_id,
                                    room_id,
                                    &bytes,
                                    "quarantined",
                                    Some(&format!(
                                        "Permanent Welcome materialization error: {other:?}"
                                    )),
                                )
                                .is_ok()
                            {
                                let _ = self.ack_welcome(welcome_id);
                            }
                        }
                    }
                    continue;
                }
            };
            drop(transactional_provider);

            let actual_room = String::from_utf8_lossy(mls.group_id().as_slice()).to_string();
            if actual_room != room_id {
                drop(mls);
                drop(transaction);
                self.record_desync(
                    room_id,
                    &format!("Welcome group ID mismatch: server={room_id}, MLS={actual_room}"),
                )?;
                if self
                    .persist_welcome_receipt(
                        welcome_id,
                        room_id,
                        &bytes,
                        "quarantined",
                        Some("Welcome group ID does not match server room ID"),
                    )
                    .is_ok()
                {
                    let _ = self.ack_welcome(welcome_id);
                }
                continue;
            }

            let join_epoch = mls.epoch().as_u64();
            crash_at_test_failpoint("after_welcome_group_materialization");
            if transaction
                .execute(
                    "INSERT OR REPLACE INTO client_rooms (room_id, join_epoch) VALUES (?1, ?2)",
                    (&room_id, join_epoch as i64),
                )
                .is_err()
            {
                drop(mls);
                drop(transaction);
                continue;
            }
            crash_at_test_failpoint("after_welcome_room_index_write");
            if Self::insert_welcome_receipt(
                &transaction,
                welcome_id,
                room_id,
                &bytes,
                "joined",
                None,
            )
            .is_err()
            {
                drop(mls);
                drop(transaction);
                continue;
            }
            crash_at_test_failpoint("after_welcome_receipt_write");
            crash_at_test_failpoint("before_welcome_transaction_commit");
            if transaction.commit().is_err() {
                drop(mls);
                continue;
            }
            crash_at_test_failpoint("after_welcome_transaction_commit");

            self.groups
                .insert(room_id.to_string(), Group { mls, join_epoch });
            // The durable receipt is committed before the network ACK. A lost ACK is
            // replayed from retry_pending_welcome_acks() after process restart.
            let _ = self.ack_welcome(welcome_id);
        }
        Ok(())
    }

    /// Читает комнату: сообщения идут по эпохам, коммит N -> N+1 применяется после сообщений эпохи N.
    /// Обработка одного события комнаты (аудит, P0.1 и P0.3): расшифровка, постоянная или временная ошибка.
    fn process_event(
        &mut self,
        room_id: &str,
        event_id: &str,
        bytes: &[u8],
        outer_file_id: Option<&str>,
        out: &mut Vec<Incoming>,
    ) -> Result<(), String> {
        let parsed = MlsMessageIn::tls_deserialize_exact(bytes)
            .ok()
            .and_then(|message| message.try_into_protocol_message().ok());
        let Some(protocol) = parsed else {
            let incoming = Incoming::Unreadable {
                room_id: room_id.to_string(),
                event_id: event_id.to_string(),
                mine: false,
            };
            let transaction = self.meta.unchecked_transaction().map_err(text)?;
            if let Err(error) = insert_incoming_record(&transaction, &incoming)
                .and_then(|_| insert_processed_event(&transaction, event_id))
                .and_then(|_| {
                    insert_undecryptable_record(
                        &transaction,
                        event_id,
                        room_id,
                        "сообщение не разбирается",
                    )?;
                    Ok(())
                })
            {
                drop(transaction);
                return Err(format!(
                    "временная ошибка сохранения unreadable inbox item: {error}"
                ));
            }
            transaction.commit().map_err(|error| {
                format!(
                    "временная ошибка фиксации unreadable inbox item: {}",
                    text(error)
                )
            })?;
            self.processed.insert(event_id.to_string());
            out.push(incoming);
            return Ok(());
        };

        // MLS ratchet state, durable inbox content and processed marker share one
        // SQLCipher transaction. If the process dies before commit, all three roll back.
        let transaction = self.meta.unchecked_transaction().map_err(text)?;
        let transactional_provider = DeviceProvider::new(
            Arc::clone(&self.provider.crypto),
            TransactionConnection(&transaction),
        );
        let processed_result = {
            let group = self
                .groups
                .get_mut(room_id)
                .ok_or("комната не создана на этом устройстве")?;
            group.mls.process_message(&transactional_provider, protocol)
        };
        // At this point OpenMLS has written the receive-ratchet state, while
        // the durable inbox and processed marker are deliberately not written yet.
        crash_at_test_failpoint("after_application_mls_write");
        drop(transactional_provider);

        match processed_result {
            Ok(processed) => {
                let (incoming, unreadable_reason, attachment_manifest) = match processed
                    .into_content()
                {
                    ProcessedMessageContent::ApplicationMessage(app) => {
                        let payload = Zeroizing::new(app.into_bytes());
                        if attachment_crypto::is_attachment_manifest(payload.as_slice()) {
                            match outer_file_id {
                                    Some(file_id) => match attachment_crypto::parse_manifest(
                                        payload.as_slice(),
                                        file_id,
                                        room_id,
                                    ) {
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
                                            Some(payload),
                                        ),
                                        Err(_) => (
                                            Incoming::Unreadable {
                                                room_id: room_id.to_string(),
                                                event_id: event_id.to_string(),
                                                mine: false,
                                            },
                                            Some("attachment manifest failed validation or outer binding"),
                                            None,
                                        ),
                                    },
                                    None => (
                                        Incoming::Unreadable {
                                            room_id: room_id.to_string(),
                                            event_id: event_id.to_string(),
                                            mine: false,
                                        },
                                        Some("attachment manifest is missing its outer file reference"),
                                        None,
                                    ),
                                }
                        } else if outer_file_id.is_some() {
                            (
                                    Incoming::Unreadable {
                                        room_id: room_id.to_string(),
                                        event_id: event_id.to_string(),
                                        mine: false,
                                    },
                                    Some("outer file reference is not bound to an MLS attachment manifest"),
                                    None,
                                )
                        } else {
                            match String::from_utf8(payload.to_vec()) {
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
                                    Some("application payload is not valid UTF-8"),
                                    None,
                                ),
                            }
                        }
                    }
                    _ => (
                        Incoming::Unreadable {
                            room_id: room_id.to_string(),
                            event_id: event_id.to_string(),
                            mine: false,
                        },
                        Some("MLS message is not an application message"),
                        None,
                    ),
                };

                if let Err(error) = insert_incoming_record(&transaction, &incoming)
                    .and_then(|_| {
                        if let Some(manifest) = attachment_manifest.as_deref() {
                            insert_attachment_manifest(
                                &transaction,
                                &incoming,
                                manifest,
                                "incoming",
                                None,
                            )?;
                        }
                        insert_processed_event(&transaction, event_id)
                    })
                    .and_then(|_| {
                        if let Some(reason) = unreadable_reason {
                            insert_undecryptable_record(&transaction, event_id, room_id, reason)?;
                        }
                        Ok(())
                    })
                {
                    drop(transaction);
                    self.reload_group(room_id)?;
                    return Err(format!(
                        "временная ошибка сохранения MLS inbox, повтор позже: {error}"
                    ));
                }

                crash_at_test_failpoint("before_application_transaction_commit");
                if let Err(error) = transaction.commit() {
                    self.reload_group(room_id)?;
                    return Err(format!(
                        "временная ошибка фиксации MLS inbox, повтор позже: {}",
                        text(error)
                    ));
                }
                crash_at_test_failpoint("after_application_transaction_commit");
                self.processed.insert(event_id.to_string());
                out.push(incoming);
            }
            Err(error) => match classify_process_error(&error) {
                Failure::Transient => {
                    drop(transaction);
                    self.reload_group(room_id)?;
                    return Err(format!("временная ошибка обработки, повтор позже: {error}"));
                }
                Failure::Permanent(reason) => {
                    drop(transaction);
                    self.reload_group(room_id)?;
                    let incoming = Incoming::Unreadable {
                        room_id: room_id.to_string(),
                        event_id: event_id.to_string(),
                        mine: false,
                    };
                    let quarantine = self.meta.unchecked_transaction().map_err(text)?;
                    if let Err(error) = insert_incoming_record(&quarantine, &incoming) {
                        drop(quarantine);
                        return Err(format!(
                            "временная ошибка сохранения unreadable inbox item: {error}"
                        ));
                    }
                    if let Err(error) =
                        insert_undecryptable_record(&quarantine, event_id, room_id, reason)
                    {
                        drop(quarantine);
                        return Err(format!(
                            "временная ошибка сохранения unreadable diagnostic: {}",
                            error
                        ));
                    }
                    if let Err(error) = insert_processed_event(&quarantine, event_id) {
                        drop(quarantine);
                        return Err(format!(
                            "временная ошибка сохранения processed marker: {error}"
                        ));
                    }
                    quarantine.commit().map_err(|error| {
                        format!(
                            "временная ошибка фиксации unreadable inbox item: {}",
                            text(error)
                        )
                    })?;
                    self.processed.insert(event_id.to_string());
                    out.push(incoming);
                }
            },
        }
        Ok(())
    }

    fn sync_room(&mut self, room_id: &str, out: &mut Vec<Incoming>) -> Result<(), String> {
        let events = self
            .call(
                "GET",
                &format!("/rooms/{}/events", urlencoding::encode(room_id)),
                None,
            )
            .map_err(|error| {
                if is_retryable(&error) {
                    format!("временная ошибка загрузки событий: {error}")
                } else {
                    error
                }
            })?;
        let mut pending: Vec<(u64, String, Vec<u8>, Option<String>)> = Vec::new();
        for ev in events["events"].as_array().cloned().unwrap_or_default() {
            let event_id = ev
                .get("event_id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    "ошибка контракта ответа: event_id отсутствует, не строка или пустой"
                        .to_string()
                })?;
            let content = ev
                .get("content")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    "ошибка контракта ответа: event content отсутствует или не объект".to_string()
                })?;
            let file_ref = content.get("file");
            let legacy_file_ref = content.get("fileId");
            if let (Some(Value::String(file)), Some(Value::String(legacy))) =
                (file_ref, legacy_file_ref)
            {
                if file != legacy {
                    return Err(
                        "ошибка контракта ответа: file и fileId содержат разные идентификаторы"
                            .to_string(),
                    );
                }
            }
            let outer_file_id = match file_ref.or(legacy_file_ref) {
                Some(Value::String(file_id)) if !file_id.trim().is_empty() => Some(file_id.clone()),
                Some(_) => {
                    return Err(
                        "ошибка контракта ответа: event content.file должен быть непустой строкой"
                            .to_string(),
                    )
                }
                None => None,
            };
            let Some(mls_b64) = ev["content"]["mls"].as_str() else {
                continue;
            };
            if self.processed.contains(&event_id) {
                continue;
            }
            // Malformed base64 or TLS payloads are persisted through the same durable
            // inbox transaction as every other unreadable event.
            let Ok(bytes) = B64.decode(mls_b64) else {
                self.process_event(room_id, &event_id, &[], outer_file_id.as_deref(), out)?;
                continue;
            };
            let parsed = MlsMessageIn::tls_deserialize_exact(&bytes)
                .ok()
                .and_then(|message| message.try_into_protocol_message().ok());
            let Some(protocol) = parsed else {
                self.process_event(room_id, &event_id, &bytes, outer_file_id.as_deref(), out)?;
                continue;
            };
            pending.push((protocol.epoch().as_u64(), event_id, bytes, outer_file_id));
        }
        let current = self
            .groups
            .get(room_id)
            .ok_or("комната не создана на этом устройстве")?
            .mls
            .epoch()
            .as_u64();
        let commits = self
            .call(
                "GET",
                &format!(
                    "/mls/groups/{}/commits?since={current}",
                    urlencoding::encode(room_id)
                ),
                None,
            )
            .map_err(|error| {
                if is_retryable(&error) {
                    format!("временная ошибка загрузки Commit: {error}")
                } else {
                    error
                }
            })?;
        let commits: Vec<(u64, Vec<u8>, Value)> = commits["commits"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|c| {
                Ok((
                    c["epoch"].as_u64().ok_or("нет эпохи")?,
                    B64.decode(c["commit"].as_str().ok_or("коммит не строка")?)
                        .map_err(text)?,
                    json!({
                        "changes": c.get("changes").cloned().unwrap_or(Value::Null),
                        "welcomeRecipients": c.get("welcomeRecipients").cloned().unwrap_or(Value::Null),
                    }),
                ))
            })
            .collect::<Result<_, String>>()?;

        let join_epoch = self.groups[room_id].join_epoch;
        let before_join: Vec<String> = pending
            .iter()
            .filter(|(e, _, _, _)| *e < join_epoch)
            .map(|(_, id, _, _)| id.clone())
            .collect();
        for event_id in before_join {
            self.mark_processed(&event_id)?;
        }
        loop {
            let epoch = self.groups[room_id].mls.epoch().as_u64();
            let ready: Vec<(String, Vec<u8>, Option<String>)> = pending
                .iter()
                .filter(|(e, id, _, _)| *e == epoch && !self.processed.contains(id))
                .map(|(_, id, bytes, file_id)| (id.clone(), bytes.clone(), file_id.clone()))
                .collect();
            for (event_id, bytes, outer_file_id) in ready {
                self.process_event(room_id, &event_id, &bytes, outer_file_id.as_deref(), out)?;
            }
            let Some((commit_epoch, commit, metadata)) =
                commits.iter().find(|(e, _, _)| *e == epoch + 1)
            else {
                break;
            };
            if let Some(reason) = self.commit_is_quarantined(room_id, *commit_epoch, commit)? {
                self.record_desync(
                    room_id,
                    &format!("Commit epoch {commit_epoch} already quarantined: {reason}"),
                )?;
                return Err(format!(
                    "RecoveryRequired: Commit epoch {commit_epoch} is quarantined"
                ));
            }
            let parsed = MlsMessageIn::tls_deserialize_exact(commit)
                .map_err(text)
                .and_then(|message| message.try_into_protocol_message().map_err(text));
            let protocol = match parsed {
                Ok(protocol) => protocol,
                Err(error) => {
                    let reason = format!("Commit encoding is invalid: {error}");
                    self.quarantine_commit(room_id, *commit_epoch, commit, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
            };
            // Commit processing and merge must use the same SQLCipher transaction
            // as the OpenMLS storage provider. Otherwise a crash can persist the new
            // epoch while the client has not durably completed the corresponding sync.
            let transaction = self.meta.unchecked_transaction().map_err(text)?;
            let transactional_provider = DeviceProvider::new(
                Arc::clone(&self.provider.crypto),
                TransactionConnection(&transaction),
            );
            let processed_result = {
                let group = self
                    .groups
                    .get_mut(room_id)
                    .ok_or("комната не создана на этом устройстве")?;
                group.mls.process_message(&transactional_provider, protocol)
            };
            let processed = match processed_result {
                Ok(processed) => processed,
                Err(error) => {
                    drop(transactional_provider);
                    drop(transaction);
                    self.reload_group(room_id)?;
                    match classify_process_error(&error) {
                        Failure::Transient => {
                            return Err(format!(
                                "временная ошибка обработки Commit, повтор позже: {error}"
                            ));
                        }
                        Failure::Permanent(classification) => {
                            let reason = format!("{classification}: {error}");
                            self.quarantine_commit(room_id, *commit_epoch, commit, &reason)?;
                            return Err(format!("RecoveryRequired: {reason}"));
                        }
                    }
                }
            };
            let staged = match processed.into_content() {
                ProcessedMessageContent::StagedCommitMessage(staged) => staged,
                _ => {
                    drop(transactional_provider);
                    drop(transaction);
                    self.reload_group(room_id)?;
                    let reason = "серверная запись не является MLS StagedCommit";
                    self.quarantine_commit(room_id, *commit_epoch, commit, reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
            };
            if !metadata["changes"].is_null() {
                let verification = {
                    let group = self
                        .groups
                        .get(room_id)
                        .ok_or("комната не создана на этом устройстве")?;
                    verify_staged_membership_metadata(&group.mls, staged.as_ref(), metadata)
                };
                if let Err(reason) = verification {
                    drop(transactional_provider);
                    drop(transaction);
                    self.reload_group(room_id)?;
                    self.quarantine_commit(room_id, *commit_epoch, commit, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
            }
            let merge = {
                let group = self
                    .groups
                    .get_mut(room_id)
                    .ok_or("комната не создана на этом устройстве")?;
                group
                    .mls
                    .merge_staged_commit(&transactional_provider, *staged)
            };
            drop(transactional_provider);
            if let Err(error) = merge {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(format!(
                    "временная ошибка слияния Commit, повтор позже: {error}"
                ));
            }
            // OpenMLS has merged the new epoch inside the still-open transaction.
            // A forced process exit here must roll the epoch back on disk.
            crash_at_test_failpoint("after_inbound_commit_merge");
            if let Err(error) = transaction.commit() {
                self.reload_group(room_id)?;
                return Err(format!(
                    "временная ошибка фиксации MLS Commit, повтор позже: {}",
                    text(error)
                ));
            }
            // A separate-process restart must observe the fully committed epoch.
            // This failpoint is debug-only and deliberately sits strictly after COMMIT.
            crash_at_test_failpoint("after_inbound_commit_transaction_commit");
        }

        // Опоздавшие события (аудит, P0.3): их эпоха уже пройдена. Внутри окна пробуем расшифровать,
        // за пределами окна — явная постоянная ошибка с причиной, а не молчаливый пропуск.
        let final_epoch = self.groups[room_id].mls.epoch().as_u64();
        let late: Vec<(String, Vec<u8>, u64, Option<String>)> = pending
            .iter()
            .filter(|(epoch, id, _, _)| *epoch < final_epoch && !self.processed.contains(id))
            .map(|(epoch, id, bytes, file_id)| (id.clone(), bytes.clone(), *epoch, file_id.clone()))
            .collect();
        for (event_id, bytes, epoch, outer_file_id) in late {
            if final_epoch - epoch > MAX_PAST_EPOCHS as u64 {
                self.record_unreadable(
                    room_id,
                    &event_id,
                    "вне окна эпох: нужна пересинхронизация по приглашению",
                )?;
                self.mark_processed(&event_id)?;
                out.push(Incoming::Unreadable {
                    room_id: room_id.to_string(),
                    event_id: event_id.clone(),
                    mine: false,
                });
            } else {
                self.process_event(room_id, &event_id, &bytes, outer_file_id.as_deref(), out)?;
            }
        }

        // Future-epoch events are not corrupt: they are waiting for the missing
        // Commit. Persist this room-scoped state and retry it on the next sync.
        let future_event_ids: Vec<String> = pending
            .iter()
            .filter(|(epoch, event_id, _, _)| {
                *epoch > final_epoch && !self.processed.contains(event_id)
            })
            .map(|(_, event_id, _, _)| event_id.clone())
            .collect();
        if !future_event_ids.is_empty() {
            self.set_waiting_for_commit(room_id, final_epoch.saturating_add(1), &future_event_ids)?;
        } else if let Some((expected_epoch, _)) = self.waiting_for_commit(room_id)? {
            let commit_available = commits.iter().any(|(epoch, _, _)| *epoch == expected_epoch);
            if final_epoch >= expected_epoch || commit_available {
                self.clear_waiting_for_commit(room_id)?;
            }
        }
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
                Ok(()) => self.check_consistency(&room)?,
                // Сервер больше не пускает устройство в комнату: это расхождение состава, а не причина остановить все комнаты.
                Err(e) if e.contains("not a member") => self.check_consistency(&room)?,
                // Некорректный event identity — ошибка контракта ответа, а не повреждение MLS room.
                Err(e) if classify_api_failure(&e).kind == ApiFailureKind::Contract => continue,
                // Сетевые/HTTP и локальные временные ошибки возвращаются вызывающему коду без MLS-карантина.
                Err(e)
                    if e.contains("временная ошибка")
                        || is_retryable(&e)
                        || is_access_failure(&e) =>
                {
                    return Err(e)
                }
                // Постоянная ошибка относится только к этой комнате; остальные комнаты продолжают синхронизацию.
                Err(e) => {
                    self.record_desync(&room, &format!("требуется восстановление состояния: {e}"))?
                }
            }
        }
        Ok(out)
    }

    /// Ставит текст в очередь отправки: он уйдёт, когда появится связь. Возвращает локальный номер.
    pub fn enqueue_text(&mut self, room_id: &str, plaintext: &str) -> Result<String, String> {
        let local_id = hex_encode(&self.provider.rand().random_vec(16).map_err(text)?);
        self.meta
            .execute(
                "INSERT INTO client_outbox (local_id, room_id, body, seq) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM client_outbox))",
                (&local_id, room_id, plaintext),
            )
            .map_err(text)?;
        Ok(local_id)
    }

    /// Local MLS rooms restored from the persistent SQLCipher-backed client.
    pub fn local_room_ids(&self) -> Vec<String> {
        let mut room_ids = self.groups.keys().cloned().collect::<Vec<_>>();
        room_ids.sort();
        room_ids
    }

    /// Pending text and attachment bubbles for restoring the UI after process restart.
    /// Attachment keys remain inside the encrypted manifest and are never returned here.
    pub fn pending_outbox_for_room_json(&self, room_id: &str) -> Result<String, String> {
        if room_id.trim().is_empty() || room_id.len() > 255 {
            return Err("invalid MLS room id".to_string());
        }
        let mut pending = Vec::new();
        {
            let mut statement = self
                .meta
                .prepare(
                    "SELECT local_id, body, payload FROM client_outbox
                     WHERE room_id = ?1 ORDER BY seq",
                )
                .map_err(text)?;
            let rows = statement
                .query_map([room_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<Vec<u8>>>(2)?,
                    ))
                })
                .map_err(text)?;
            for row in rows {
                let (local_id, body, payload) = row.map_err(text)?;
                let opaque = body.starts_with("opaque:");
                pending.push(json!({
                    "local_id": local_id,
                    "room_id": room_id,
                    "kind": if opaque { "opaque" } else { "text" },
                    "text": if opaque { Value::Null } else { Value::String(body) },
                    "payload_bytes": payload.as_ref().map_or(0, Vec::len),
                }));
            }
        }
        {
            let mut statement = self
                .meta
                .prepare(
                    "SELECT client_message_id, file_id, manifest, uploaded
                     FROM client_attachment_outbox
                     WHERE room_id = ?1 ORDER BY created_at, client_message_id",
                )
                .map_err(text)?;
            let rows = statement
                .query_map([room_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, bool>(3)?,
                    ))
                })
                .map_err(text)?;
            for row in rows {
                let (operation_id, file_id, manifest_bytes, uploaded) = row.map_err(text)?;
                let manifest_bytes = Zeroizing::new(manifest_bytes);
                let manifest =
                    attachment_crypto::parse_manifest(&manifest_bytes, &file_id, room_id)?;
                pending.push(json!({
                    "local_id": operation_id,
                    "room_id": room_id,
                    "kind": "attachment",
                    "file_id": file_id,
                    "name": manifest.name.clone(),
                    "mime_type": manifest.mime_type.clone(),
                    "size": manifest.size,
                    "uploaded": uploaded,
                }));
            }
        }
        serde_json::to_string(&pending).map_err(text)
    }

    /// Сколько сообщений ждут отправки.
    pub fn outbox_len(&self) -> Result<u64, String> {
        let n: i64 = self
            .meta
            .query_row(
                "SELECT (SELECT COUNT(*) FROM client_outbox)
                      + (SELECT COUNT(*) FROM client_attachment_outbox)",
                [],
                |row| row.get(0),
            )
            .map_err(text)?;
        Ok(n as u64)
    }

    /// Отправляет очередь по порядку. Без связи ничего не теряет: возвращает 0, очередь остаётся.
    pub fn flush_outbox(&mut self) -> Result<usize, String> {
        if self.cached_remote_config().maintenance {
            return Ok(0); // очередь не трогаем: сообщения уйдут после обслуживания
        }
        let items: Vec<(String, String, String, Option<Vec<u8>>)> = {
            let mut stmt = self
                .meta
                .prepare("SELECT local_id, room_id, body, payload FROM client_outbox ORDER BY seq")
                .map_err(text)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .map_err(text)?;
            rows.collect::<Result<_, _>>().map_err(text)?
        };
        let attachment_count: i64 = self
            .meta
            .query_row("SELECT COUNT(*) FROM client_attachment_outbox", [], |row| {
                row.get(0)
            })
            .map_err(text)?;
        if items.is_empty() && attachment_count == 0 {
            return Ok(0);
        }
        match self.sync() {
            Ok(got) => self.inbox.extend(got),
            Err(e) if is_retryable(&e) => return Ok(0),
            Err(e) => return Err(e),
        }
        let mut sent = 0;
        for (local_id, room_id, body, payload) in items {
            let result = match payload {
                Some(payload) => {
                    self.send_application_payload_with_id(&room_id, &payload, &local_id)
                }
                None => self.send_text_with_id(&room_id, &body, &local_id),
            };
            match result {
                Ok(_) => {
                    self.meta
                        .execute("DELETE FROM client_outbox WHERE local_id = ?1", [&local_id])
                        .map_err(text)?;
                    sent += 1;
                }
                Err(e) if is_retryable(&e) => break,
                Err(e) => return Err(e),
            }
        }
        sent += self.flush_attachment_outbox()?;
        Ok(sent)
    }

    /// Retries durable attachment uploads from ciphertext stored in SQLCipher.
    /// The original plaintext file is reconstructed only in zeroizing memory.
    fn flush_attachment_outbox(&mut self) -> Result<usize, String> {
        let items: Vec<(String, String, String, Vec<u8>, String, i64, Vec<u8>)> = {
            let mut statement = self
                .meta
                .prepare(
                    "SELECT client_message_id, room_id, file_id, manifest, ciphertext_sha256,
                        ciphertext_size, ciphertext
                 FROM client_attachment_outbox ORDER BY created_at, client_message_id",
                )
                .map_err(text)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                })
                .map_err(text)?;
            rows.collect::<Result<_, _>>().map_err(text)?
        };
        let mut sent = 0;
        for (
            operation_id,
            room_id,
            file_id,
            manifest_bytes,
            stored_hash,
            stored_size,
            ciphertext,
        ) in items
        {
            let Some(client_message_id) = operation_id.strip_prefix("att_") else {
                return Err("attachment outbox contains an invalid operation ID".to_string());
            };
            let manifest_bytes = Zeroizing::new(manifest_bytes);
            let manifest = attachment_crypto::parse_manifest(&manifest_bytes, &file_id, &room_id)?;
            if attachment_crypto::sha256_hex(&ciphertext) != stored_hash
                || ciphertext.len() as i64 != stored_size
                || manifest.ciphertext_size != stored_size as u64
                || manifest.ciphertext_sha256 != stored_hash
            {
                return Err(
                    "encrypted attachment outbox failed its ciphertext integrity check".to_string(),
                );
            }
            let plaintext = Zeroizing::new(attachment_crypto::decrypt(&ciphertext, &manifest)?);
            match self.send_attachment_with_id(
                &room_id,
                &manifest.name,
                &manifest.mime_type,
                plaintext.as_slice(),
                client_message_id,
            ) {
                Ok(event_id) => {
                    // Rebuild the sender bubble from the committed SQLCipher record.
                    // This also covers the idempotent-completed fast path, where the
                    // send method can return before publishing an in-memory handoff.
                    let completed: Option<(String, Vec<u8>)> = self
                        .meta
                        .query_row(
                            "SELECT file_id, manifest FROM client_attachments
                             WHERE client_message_id = ?1 AND direction = 'outgoing'",
                            [&operation_id],
                            |row| Ok((row.get(0)?, row.get(1)?)),
                        )
                        .optional()
                        .map_err(text)?;
                    let (stored_file_id, stored_manifest) = completed.ok_or_else(|| {
                        "completed attachment outbox has no durable outgoing history record"
                            .to_string()
                    })?;
                    let stored_manifest = Zeroizing::new(stored_manifest);
                    let stored = attachment_crypto::parse_manifest(
                        stored_manifest.as_slice(),
                        &stored_file_id,
                        &room_id,
                    )?;
                    self.reconcile_outgoing_attachment_handoff(Incoming::Attachment {
                        room_id: room_id.clone(),
                        event_id,
                        file_id: stored_file_id,
                        name: stored.name.clone(),
                        mime_type: stored.mime_type.clone(),
                        size: stored.size,
                        mine: true,
                    });
                    sent += 1;
                }
                Err(error) if is_retryable(&error) => break,
                Err(error) if error.contains("комната рассинхронизирована") => {
                    continue
                }
                Err(error) => return Err(error),
            }
        }
        Ok(sent)
    }

    /// Returns pending incoming events from encrypted SQLCipher storage. Items are not
    /// consumed; the application must acknowledge them only after durable handoff.
    pub fn pending_incoming(&self) -> Result<Vec<Incoming>, String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta
            .execute(
                "DELETE FROM client_inbox
                 WHERE acknowledged = 1 AND acknowledged_at IS NOT NULL AND acknowledged_at < ?1",
                [now - ACKNOWLEDGED_INBOX_RETENTION_MS],
            )
            .map_err(text)?;
        let mut statement = self
            .meta
            .prepare(
                "SELECT i.event_id, i.room_id, i.kind,
                        i.body, i.client_message_id, a.file_id, a.manifest
                 FROM client_inbox i
                 LEFT JOIN client_attachments a ON a.event_id = i.event_id
                 WHERE i.acknowledged = 0 ORDER BY i.seq",
            )
            .map_err(text)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<Vec<u8>>>(6)?,
                ))
            })
            .map_err(text)?;
        rows.map(|row| {
            let (event_id, room_id, kind, body, client_message_id, file_id, manifest) =
                row.map_err(text)?;
            incoming_from_row(
                event_id,
                room_id,
                kind,
                body,
                client_message_id,
                file_id,
                manifest,
            )
        })
        .collect()
    }

    /// Returns all locally persisted, decrypted history for one room, including acknowledged items.
    /// The inbox journal remains the source of truth; reading history never consumes or ACKs events.
    pub fn messages_for_room(&self, room_id: &str) -> Result<Vec<Incoming>, String> {
        let mut statement = self
            .meta
            .prepare(
                "SELECT i.event_id, i.room_id, i.kind,
                        i.body, i.client_message_id, a.file_id, a.manifest
                 FROM client_inbox i
                 LEFT JOIN client_attachments a ON a.event_id = i.event_id
                 WHERE i.room_id = ?1 ORDER BY i.seq",
            )
            .map_err(text)?;
        let rows = statement
            .query_map([room_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<Vec<u8>>>(6)?,
                ))
            })
            .map_err(text)?;
        rows.map(|row| {
            let (event_id, room_id, kind, body, client_message_id, file_id, manifest) =
                row.map_err(text)?;
            incoming_from_row(
                event_id,
                room_id,
                kind,
                body,
                client_message_id,
                file_id,
                manifest,
            )
        })
        .collect()
    }

    /// Acknowledges inbox items after the application has durably accepted them.
    /// Unknown IDs are harmless; repeated ACKs are idempotent.
    pub fn acknowledge_incoming(&mut self, event_ids: &[String]) -> Result<(), String> {
        if event_ids.len() > 500 {
            return Err("too many inbox acknowledgements in one batch".to_string());
        }
        if event_ids.is_empty() {
            return Ok(());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let transaction = self.meta.unchecked_transaction().map_err(text)?;
        for event_id in event_ids {
            transaction
                .execute(
                    "UPDATE client_inbox SET acknowledged = 1, acknowledged_at = ?2
                     WHERE event_id = ?1 AND acknowledged = 0",
                    rusqlite::params![event_id, now],
                )
                .map_err(text)?;
        }
        crash_at_test_failpoint("before_inbox_ack_transaction_commit");
        transaction.commit().map_err(text)?;
        crash_at_test_failpoint("after_inbox_ack_transaction_commit");
        Ok(())
    }

    /// Забирает сообщения, которые пришли при синхронизации из очереди отправки.
    pub fn take_incoming(&mut self) -> Vec<Incoming> {
        std::mem::take(&mut self.inbox)
    }

    /// Синхронизация с повторами: при сбоях сети ждёт всё дольше, но не дольше `attempts` попыток.
    pub fn sync_retrying(
        &mut self,
        attempts: u32,
        base: Duration,
    ) -> Result<Vec<Incoming>, String> {
        with_retry(attempts, base, || self.sync())
    }

    /// Эпоха, которую знает устройство, для комнаты.
    pub fn local_epoch(&self, room_id: &str) -> Option<u64> {
        self.groups.get(room_id).map(|g| g.mls.epoch().as_u64())
    }

    /// Участники группы по их устройствам (`пользователь/устройство`).
    pub fn members_of(&self, room_id: &str) -> Result<Vec<String>, String> {
        let group = self
            .groups
            .get(room_id)
            .ok_or("комната не создана на этом устройстве")?;
        Ok(group
            .mls
            .members()
            .map(|m| String::from_utf8_lossy(m.credential.serialized_content()).to_string())
            .collect())
    }

    /// Removes every MLS leaf belonging to one account through a durable membership Commit.
    /// The server remains the authority for owner/admin capability checks; this preflight avoids
    /// staging a Commit for an operation the current actor is already known not to be allowed to do.
    pub fn remove_member(&mut self, room_id: &str, target_user_id: &str) -> Result<(), String> {
        self.ensure_writable()?;
        if target_user_id.trim().is_empty() || target_user_id.len() > 255 {
            return Err("invalid target user ID".to_string());
        }
        if target_user_id == self.user_id {
            return Err("an account cannot remove itself through this operation".to_string());
        }
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!(
                "RecoveryRequired: room requires recovery: {reason}"
            ));
        }

        // Resolve any earlier durable operation and reconcile before taking a membership snapshot.
        self.flush_pending_membership_commits()?;
        self.sync()?;

        for attempt in 0..3 {
            let snapshot = self.call(
                "GET",
                &format!("/rooms/{}/members", urlencoding::encode(room_id)),
                None,
            )?;
            let server_members: BTreeSet<String> = snapshot["members"]
                .as_array()
                .ok_or("room member response has no members array")?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .ok_or("room member ID is not a string")
                })
                .collect::<Result<_, _>>()?;
            let mls_members = self.mls_users(room_id)?;
            if server_members != mls_members {
                self.check_consistency(room_id)?;
                return Err(
                    "RecoveryRequired: server and MLS membership differ before removal".to_string(),
                );
            }
            if !server_members.contains(target_user_id) {
                return Ok(());
            }

            let owner = snapshot["owner"]
                .as_str()
                .ok_or("room member response has no owner")?;
            if owner == target_user_id {
                return Err("the room owner cannot be removed".to_string());
            }
            let admins: BTreeSet<String> = snapshot["admins"]
                .as_array()
                .ok_or("room member response has no admins array")?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .ok_or("room admin ID is not a string")
                })
                .collect::<Result<_, _>>()?;
            let capabilities = snapshot["capabilities"][self.user_id.as_str()]
                .as_array()
                .ok_or("current user capabilities are missing from room snapshot")?;
            let can_remove = capabilities
                .iter()
                .any(|value| value.as_str() == Some("remove_members"));
            if self.user_id != owner && (!can_remove || admins.contains(target_user_id)) {
                return Err(
                    "server policy does not allow this account to remove the selected member"
                        .to_string(),
                );
            }

            let server_epoch = self.server_epoch(room_id)?;
            let local_epoch = self
                .local_epoch(room_id)
                .ok_or("room is not loaded on this device")?;
            if local_epoch != server_epoch {
                self.sync()?;
                if attempt == 2 {
                    return Err(
                        "epoch_outdated: unable to reconcile room before member removal"
                            .to_string(),
                    );
                }
                continue;
            }

            let target_prefix = format!("{target_user_id}/");
            let operation_id = hex_encode(&self.provider.rand().random_vec(16).map_err(text)?);
            let tx = self.meta.unchecked_transaction().map_err(text)?;
            let staged = (|| -> Result<(), String> {
                let group = self.groups.get_mut(room_id).ok_or("room is not loaded")?;
                let leaves: Vec<LeafNodeIndex> = group
                    .mls
                    .members()
                    .filter(|member| {
                        std::str::from_utf8(member.credential.serialized_content())
                            .is_ok_and(|identity| identity.starts_with(&target_prefix))
                    })
                    .map(|member| member.index)
                    .collect();
                if leaves.is_empty() {
                    return Err(format!(
                        "MLS membership has no device leaves for target account {target_user_id}"
                    ));
                }

                let (commit, _, _) = group
                    .mls
                    .remove_members(&self.provider, &self.signer, &leaves)
                    .map_err(text)?;
                let commit_bytes = commit.tls_serialize_detached().map_err(text)?;
                let changes = json!({
                    "adds": [],
                    "removes": [target_user_id],
                    "removeDevices": [],
                });
                let payload = json!({
                    "epoch": local_epoch,
                    "commit": B64.encode(&commit_bytes),
                    "changes": changes,
                    "welcomes": [],
                    "clientOperationId": operation_id,
                });
                let metadata = json!({
                    "changes": changes,
                    "welcomeRecipients": [],
                });
                let pending = group
                    .mls
                    .pending_commit()
                    .ok_or("OpenMLS did not retain staged account-removal commit")?;
                verify_staged_membership_metadata(&group.mls, pending, &metadata)?;
                let fingerprint = membership_commit_fingerprint(
                    &self.provider,
                    room_id,
                    &operation_id,
                    local_epoch,
                    &payload,
                    pending,
                )?;
                let payload_json = serde_json::to_string(&payload).map_err(text)?;
                let created_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                tx.execute(
                    "INSERT INTO client_membership_commits
                     (operation_id, room_id, base_epoch, fingerprint, payload, claim_ids, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, '[]', ?6)",
                    rusqlite::params![operation_id, room_id, local_epoch as i64, fingerprint, payload_json, created_at],
                ).map_err(text)?;
                Ok(())
            })();

            if let Err(error) = staged {
                let _ = tx.rollback();
                self.reload_group(room_id)?;
                return Err(error);
            }
            if let Err(error) = tx.commit() {
                self.reload_group(room_id)?;
                return Err(format!(
                    "failed to persist account-removal journal: {}",
                    text(error)
                ));
            }

            // A network error leaves the exact staged Commit in SQLCipher for safe retry.
            let stale_cleared = self.flush_pending_membership_commits()?;
            self.sync()?;
            if !self.server_users(room_id)?.contains(target_user_id)
                && !self.mls_users(room_id)?.contains(target_user_id)
            {
                return Ok(());
            }
            if stale_cleared > 0 && attempt < 2 {
                continue;
            }
            return Err(
                "membership Commit was not acknowledged as a completed account removal".to_string(),
            );
        }
        Err("epoch_outdated: account removal exhausted safe rebase attempts".to_string())
    }

    /// Отзывает устройство аккаунта на сервере: его сессии перестают работать.
    pub fn revoke_device(&self, device_id: &str) -> Result<(), String> {
        self.call(
            "DELETE",
            &format!("/devices/{}", urlencoding::encode(device_id)),
            None,
        )?;
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
            let mut by_room: HashMap<String, Vec<String>> = HashMap::new();
            for row in removals["removals"].as_array().cloned().unwrap_or_default() {
                let room = row["roomId"].as_str().ok_or("нет roomId")?.to_string();
                let device = row["deviceId"].as_str().ok_or("нет deviceId")?.to_string();
                by_room.entry(room).or_default().push(device);
            }
            let mut must_rebase = false;
            for (room_id, mut devices) in by_room {
                if !self.groups.contains_key(&room_id) {
                    continue;
                }
                devices.sort();
                devices.dedup();
                let server = self.server_epoch(&room_id)?;
                let local = self
                    .groups
                    .get(&room_id)
                    .map(|g| g.mls.epoch().as_u64())
                    .ok_or("комната не найдена")?;
                if local != server {
                    must_rebase = true;
                    break;
                }
                let identities: Vec<Vec<u8>> = devices
                    .iter()
                    .map(|device| format!("{}/{}", self.user_id, device).into_bytes())
                    .collect();
                let operation_id = hex_encode(&self.provider.rand().random_vec(16).map_err(text)?);
                let tx = self.meta.unchecked_transaction().map_err(text)?;
                let staged = (|| -> Result<(), String> {
                    let group = self.groups.get_mut(&room_id).ok_or("комната не найдена")?;
                    let leaves: Vec<LeafNodeIndex> = group
                        .mls
                        .members()
                        .filter(|member| {
                            identities
                                .iter()
                                .any(|id| member.credential.serialized_content() == id.as_slice())
                        })
                        .map(|member| member.index)
                        .collect();
                    if leaves.is_empty() {
                        return Err(format!("P0.2: нет MLS leaf для отзываемых устройств в комнате {room_id}; commit не отправлен"));
                    }
                    let (commit, _, _) = group
                        .mls
                        .remove_members(&self.provider, &self.signer, &leaves)
                        .map_err(text)?;
                    let commit_bytes = commit.tls_serialize_detached().map_err(text)?;
                    let changes = json!({ "adds": [], "removes": [], "removeDevices": devices });
                    let payload = json!({
                        "epoch": local, "commit": B64.encode(&commit_bytes), "changes": changes,
                        "welcomes": [], "clientOperationId": operation_id,
                    });
                    let metadata = json!({ "changes": changes, "welcomeRecipients": [] });
                    let pending = group
                        .mls
                        .pending_commit()
                        .ok_or("OpenMLS did not retain staged device-removal commit")?;
                    verify_staged_membership_metadata(&group.mls, pending, &metadata)?;
                    let fingerprint = membership_commit_fingerprint(
                        &self.provider,
                        &room_id,
                        &operation_id,
                        local,
                        &payload,
                        pending,
                    )?;
                    let payload_json = serde_json::to_string(&payload).map_err(text)?;
                    let created_at = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64;
                    tx.execute(
                        "INSERT INTO client_membership_commits (operation_id, room_id, base_epoch, fingerprint, payload, claim_ids, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, '[]', ?6)",
                        rusqlite::params![operation_id, room_id, local as i64, fingerprint, payload_json, created_at],
                    ).map_err(text)?;
                    Ok(())
                })();
                if let Err(error) = staged {
                    let _ = tx.rollback();
                    self.reload_group(&room_id)?;
                    return Err(error);
                }
                if let Err(error) = tx.commit() {
                    self.reload_group(&room_id)?;
                    return Err(format!(
                        "не удалось зафиксировать device-removal journal: {}",
                        text(error)
                    ));
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
                return Err(
                    "epoch_outdated: исчерпаны попытки безопасного rebasing device removal"
                        .to_string(),
                );
            }
        }
        Err("device removal не удалось применить после rebasing".to_string())
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;

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
    fn api_failures_are_typed_by_status_and_server_error_code() {
        let auth = classify_api_failure(r#"GET /rooms/x/events -> 401 {"error":"device_revoked"}"#);
        assert_eq!(auth.kind, ApiFailureKind::AuthSession);
        assert_eq!(auth.status, Some(401));
        assert_eq!(auth.code.as_deref(), Some("device_revoked"));

        let denied =
            classify_api_failure(r#"GET /rooms/x/events -> 403 {"code":"permission_denied"}"#);
        assert_eq!(denied.kind, ApiFailureKind::AccessDenied);
        assert_eq!(denied.code.as_deref(), Some("permission_denied"));

        let deleted =
            classify_api_failure(r#"GET /rooms/x/events -> 404 {"error":"room_deleted"}"#);
        assert_eq!(deleted.kind, ApiFailureKind::ResourceDeleted);
        assert_eq!(deleted.status, Some(404));

        let refresh =
            classify_api_failure(r#"POST /token/refresh -> 401 {"error":"refresh_revoked"}"#);
        assert_eq!(refresh.kind, ApiFailureKind::AuthSession);
        assert!(!is_retryable(
            r#"POST /token/refresh -> 401 {"error":"refresh_revoked"}"#
        ));
        assert!(is_retryable(
            r#"GET /rooms/x/events -> 503 {"error":"unavailable"}"#
        ));
        assert!(is_retryable("сеть: connection reset"));
    }

    #[test]
    fn retry_stops_on_success_and_on_fatal_errors() {
        let mut calls = 0;
        let ok: Result<u32, String> = with_retry(5, Duration::ZERO, || {
            calls += 1;
            if calls < 3 {
                Err("сеть: нет связи".to_string())
            } else {
                Ok(calls)
            }
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
}

#[cfg(test)]
mod classify_tests {
    use super::{classify_process_error, Failure};
    use openmls::prelude::ProcessMessageError as E;

    #[test]
    fn постоянные_ошибки_не_повторяются() {
        assert_eq!(
            classify_process_error(&E::<()>::IncompatibleWireFormat),
            Failure::Permanent("несовместимый формат сообщения")
        );
        assert_eq!(
            classify_process_error(&E::<String>::StorageError("диск недоступен".to_string())),
            Failure::Transient
        );
        assert_eq!(
            classify_process_error(&E::<()>::UnauthorizedExternalApplicationMessage),
            Failure::Permanent("отправитель вне группы")
        );
        assert_eq!(
            classify_process_error(&E::<()>::UnauthorizedExternalCommitMessage),
            Failure::Permanent("отправитель вне группы")
        );
    }
}

#[cfg(test)]
mod session_persistence_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;

    static NEXT_DB: AtomicU64 = AtomicU64::new(0);

    fn temp_db(label: &str) -> String {
        let path = std::env::temp_dir().join(format!(
            "inone-engine-b-session-{}-{}-{label}.db",
            std::process::id(),
            NEXT_DB.fetch_add(1, Ordering::Relaxed)
        ));
        remove_db(&path.to_string_lossy());
        path.to_string_lossy().into_owned()
    }

    fn remove_db(path: &str) {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(format!("{path}{suffix}"));
        }
    }

    #[test]
    fn adopted_session_resumes_and_refresh_rotation_is_durable_and_encrypted() {
        let database = temp_db("rotation");
        let keys = MemoryKeyStore::default();
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind refresh test server");
        let address = listener.local_addr().expect("refresh test server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept refresh request");
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            let body = r#"{"token":"rotated-access-token","refreshToken":"rotated-refresh-token"}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write refresh response");
        });
        let base = format!("http://{address}");
        let client = connect_with_session(
            &base,
            "user-session",
            "device-session",
            "initial-access-token",
            "initial-refresh-token",
            &database,
            &keys,
        )
        .expect("adopt authenticated session");
        assert_eq!(
            client.access_token_snapshot().unwrap(),
            "initial-access-token"
        );
        assert_eq!(client.refresh_session().unwrap(), "rotated-access-token");
        server.join().expect("refresh server thread");

        drop(client);
        let resumed =
            resume_with_session(&base, "user-session", "device-session", &database, &keys)
                .expect("resume persisted SQLCipher session");
        assert_eq!(
            resumed.access_token_snapshot().unwrap(),
            "rotated-access-token"
        );

        let key = keys
            .existing_database_key("user-session/device-session")
            .unwrap()
            .expect("persisted database key");
        let connection = open_db(&database, &key).expect("open encrypted database");
        let tokens = load_session_tokens(&connection).expect("read rotated token pair");
        assert_eq!(tokens.0, "rotated-access-token");
        assert_eq!(tokens.1, "rotated-refresh-token");
        drop(tokens);
        drop(connection);
        drop(resumed);

        let ciphertext = std::fs::read(&database).expect("read encrypted database file");
        for secret in ["rotated-access-token", "rotated-refresh-token"] {
            assert!(
                !ciphertext
                    .windows(secret.len())
                    .any(|window| window == secret.as_bytes()),
                "session credentials must not be visible in the SQLCipher file"
            );
        }
        remove_db(&database);
    }

    #[test]
    fn memory_key_store_distinguishes_read_create_and_idempotent_delete() {
        let keys = MemoryKeyStore::default();
        let scope = "user-key/device-key";
        assert!(!keys.has_database_key(scope).unwrap());
        assert_eq!(keys.existing_database_key(scope).unwrap(), None);

        let first = keys.database_key(scope).unwrap();
        assert!(keys.has_database_key(scope).unwrap());
        assert_eq!(keys.existing_database_key(scope).unwrap(), Some(first));

        keys.delete_database_key(scope).unwrap();
        keys.delete_database_key(scope).unwrap();
        assert!(!keys.has_database_key(scope).unwrap());
        assert_eq!(keys.existing_database_key(scope).unwrap(), None);
        let second = keys.database_key(scope).unwrap();
        assert_ne!(first, second, "deleted key material must not be reused");
    }

    #[test]
    fn resume_never_creates_a_missing_platform_database_key() {
        let database = temp_db("missing-key");
        std::fs::write(&database, b"existing encrypted database placeholder").unwrap();
        let keys = MemoryKeyStore::default();

        let error = resume_with_session(
            "https://api.example.invalid",
            "user-missing-key",
            "device-missing-key",
            &database,
            &keys,
        )
        .err()
        .expect("resume must fail closed without the original SQLCipher key");

        assert!(error.contains("ключ SQLCipher"));
        assert!(!keys
            .has_database_key("user-missing-key/device-missing-key")
            .unwrap());
        remove_db(&database);
    }

    #[test]
    fn adopting_session_refuses_to_replace_a_missing_key_for_existing_database() {
        let database = temp_db("existing-db-no-key");
        std::fs::write(&database, b"existing encrypted database placeholder").unwrap();
        let keys = MemoryKeyStore::default();

        let error = connect_with_session(
            "https://api.example.invalid",
            "user-existing-db",
            "device-existing-db",
            "access",
            "refresh",
            &database,
            &keys,
        )
        .err()
        .expect("an existing database without its platform key must not be re-keyed");

        assert!(error.contains("защищённый ключ отсутствует"));
        assert!(!keys
            .has_database_key("user-existing-db/device-existing-db")
            .unwrap());
        remove_db(&database);
    }

    #[test]
    fn room_history_retains_acknowledged_events_without_replaying_pending_inbox() {
        let database = temp_db("history");
        let keys = MemoryKeyStore::default();
        let mut client = connect_with_session(
            "https://api.example.invalid",
            "user-history",
            "device-history",
            "history-access",
            "history-refresh",
            &database,
            &keys,
        )
        .expect("adopt session for history test");

        let event = Incoming::Text {
            room_id: "!history:inone.test".to_string(),
            event_id: "$history-1".to_string(),
            text: "persisted message".to_string(),
            mine: false,
        };
        let other_room_event = Incoming::Text {
            room_id: "!other:inone.test".to_string(),
            event_id: "$history-2".to_string(),
            text: "another room".to_string(),
            mine: false,
        };
        insert_incoming_record(&client.meta, &event).unwrap();
        insert_incoming_record(&client.meta, &other_room_event).unwrap();

        client
            .acknowledge_incoming(&["$history-1".to_string(), "$history-2".to_string()])
            .unwrap();
        assert!(client.pending_incoming().unwrap().is_empty());
        assert_eq!(
            client.messages_for_room("!history:inone.test").unwrap(),
            vec![event],
            "ACK must not delete durable history"
        );
        drop(client);
        remove_db(&database);
    }

    #[test]
    fn logout_clears_persisted_and_in_memory_tokens_when_server_is_unavailable() {
        let database = temp_db("logout");
        let keys = MemoryKeyStore::default();
        let client = connect_with_session(
            "http://127.0.0.1:1",
            "user-logout",
            "device-logout",
            "logout-access",
            "logout-refresh",
            &database,
            &keys,
        )
        .expect("adopt session for logout test");

        let error = client
            .logout()
            .expect_err("unavailable server must be reported");
        assert!(error.contains("локальные токены очищены"));
        assert!(client.access_token_snapshot().is_err());

        let key = keys
            .existing_database_key("user-logout/device-logout")
            .unwrap()
            .expect("database key remains until FFI cleanup");
        let connection = open_db(&database, &key).expect("open database after logout");
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM client_meta WHERE key = 'session_tokens'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "logout must delete the persisted refresh token");
        drop(connection);
        drop(client);
        remove_db(&database);
    }
}

#[cfg(test)]
mod security_policy_tests {
    use super::*;

    #[test]
    fn signed_object_url_rejects_nested_blob_scheme_before_origin() {
        let nested_blob = format!(
            "{}https://api.example.invalid/objects/file",
            "blob:".repeat(10_000)
        );
        let error = parse_signed_object_url("https://api.example.invalid", &nested_blob)
            .expect_err("nested blob URL must be rejected before origin evaluation");
        assert!(error.contains("HTTP or HTTPS"));
    }

    #[test]
    fn signed_object_url_accepts_same_origin_https_objects() {
        let parsed = parse_signed_object_url(
            "https://api.example.invalid",
            "https://api.example.invalid/objects/file",
        )
        .unwrap();
        assert_eq!(parsed.path(), "/objects/file");
    }

    #[test]
    fn welcome_policy_rejects_p256_ciphersuite() {
        assert!(ensure_supported_welcome_ciphersuite(CIPHERSUITE).is_ok());
        assert!(ensure_supported_welcome_ciphersuite(
            Ciphersuite::MLS_128_DHKEMP256_AES128GCM_SHA256_P256
        )
        .is_err());
    }
}
