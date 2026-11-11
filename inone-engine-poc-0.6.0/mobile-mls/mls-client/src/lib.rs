//! Ядро клиента InOne на Rust: вход, ключевые пакеты, группы MLS, сообщения, догон после отсутствия,
//! вход нового устройства по подтверждению и удаление отозванных устройств из групп.
//! База устройства зашифрована (SQLCipher). Ключ передаёт платформа: Keychain на iOS, Keystore на Android.
use std::borrow::Borrow;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use rusqlite::OptionalExtension;
use std::time::Duration;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::RustCrypto;
use openmls_traits::random::OpenMlsRand;
use openmls_sqlite_storage::{Codec, Connection, SqliteStorageProvider};
use serde_json::{json, Value};

pub mod remote_config;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
/// Сколько прошлых эпох хранит группа (см. mls-bridge: по умолчанию OpenMLS не хранит ни одной).
const MAX_PAST_EPOCHS: usize = 16;

/// Что получено из комнаты при синхронизации.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Text { room_id: String, event_id: String, text: String },
    Unreadable { room_id: String, event_id: String },
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

pub struct Client {
    base: String,
    /// Пара: токен доступа и одноразовый токен обновления. Ядро обновляет их само, когда доступ истёк.
    tokens: Mutex<(String, String)>,
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

fn text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn event_id_from_event(event: &Value) -> Result<String, String> {
    let event_id = event["event_id"]
        .as_str()
        .ok_or_else(|| "MLS event has no string event_id".to_string())?;
    if event_id.trim().is_empty() {
        return Err("MLS event has an empty event_id".to_string());
    }
    Ok(event_id.to_string())
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
    let (event_id, room_id, kind, body): (&str, &str, &str, Option<&str>) = match incoming {
        Incoming::Text { room_id, event_id, text } => (event_id, room_id, "text", Some(text)),
        Incoming::Unreadable { room_id, event_id } => (event_id, room_id, "unreadable", None),
    };
    // Event IDs are idempotency keys. Replays must never reset an already
    // acknowledged inbox row or replace its previously persisted plaintext.
    meta.execute(
        "INSERT OR IGNORE INTO client_inbox (event_id, room_id, kind, body, acknowledged) VALUES (?1, ?2, ?3, ?4, 0)",
        (event_id, room_id, kind, body),
    ).map_err(text)?;
    meta.execute(
        "INSERT OR IGNORE INTO client_processed (event_id) VALUES (?1)",
        [event_id],
    ).map_err(text)?;
    Ok(())
}

fn persist_incoming_record(meta: &mut Connection, incoming: &Incoming) -> Result<(), String> {
    let tx = meta.transaction().map_err(text)?;
    insert_incoming_record(&tx, incoming)?;
    tx.commit().map_err(text)
}

fn request(agent: &ureq::Agent, base: &str, token: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
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
) -> Result<Option<[u8; 32]>, String> {
    let existing_key = keys.existing_database_key(scope)?;
    if existing_key.is_none() && database_artifacts_exist(db_path) {
        return Err(
            "SQLCipher database exists but its protected key is missing; refusing to create a replacement key"
                .to_string(),
        );
    }
    Ok(existing_key)
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
    let existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let database_existed = database_artifacts_exist(db_path);
    let db_key = keys.database_key(&scope)?;
    match build_client(agent, base, tokens, user_id, device_id, db_path, &db_key) {
        Ok(client) => Ok(client),
        Err(error) if existing_key.is_none() && !database_existed => {
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

impl KeyStore for MemoryKeyStore {
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
        self.keys.lock().map_err(text)?.remove(scope);
        Ok(())
    }
}

/// Ошибка временная (нет сети, 429, 5xx): её имеет смысл повторить позже.
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
pub fn connect(base: &str, user_id: &str, password: &str, device_id: &str, db_path: &str, keys: &dyn KeyStore) -> Result<Client, String> {
    let scope = format!("{user_id}/{device_id}");
    let _existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let agent = ureq::AgentBuilder::new().build();
    register(&agent, base, user_id, password)?;
    let login = request(&agent, base, "", "POST", "/login", Some(json!({ "userId": user_id, "password": password, "deviceId": device_id })))?;
    let tokens = (
        login["token"].as_str().ok_or("сервер не вернул токен: нужно подтверждение с другого устройства")?.to_string(),
        login["refreshToken"].as_str().ok_or("сервер не вернул токен обновления")?.to_string(),
    );
    build_client_with_keys(agent, base, tokens, user_id, device_id, db_path, keys)
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
    if base.trim().is_empty() || user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("адрес сервера, user_id и device_id обязательны".to_string());
    }
    if access_token.is_empty() || refresh_token.is_empty() {
        return Err("для подключения нужны access и refresh tokens".to_string());
    }
    let scope = format!("{user_id}/{device_id}");
    let _existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let agent = ureq::AgentBuilder::new().build();
    build_client_with_keys(
        agent,
        base.trim_end_matches('/'),
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
    if base.trim().is_empty() || user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("адрес сервера, user_id и device_id обязательны".to_string());
    }
    if !Path::new(db_path).is_file() {
        return Err("сохранённая MLS-сессия не найдена на этом устройстве".to_string());
    }
    let db_key = keys
        .existing_database_key(&format!("{user_id}/{device_id}"))?
        .ok_or_else(|| {
            "ключ SQLCipher сохранённой MLS-сессии отсутствует; создание нового ключа запрещено"
                .to_string()
        })?;
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
    let serialized: Vec<u8> = meta
        .query_row(
            "SELECT value FROM client_meta WHERE key = 'session_tokens'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "в базе нет сохранённой MLS-сессии; выполните вход заново".to_string())?;
    drop(meta);
    let tokens: (String, String) = serde_json::from_slice(&serialized)
        .map_err(|_| "сохранённая сессия повреждена; выполните вход заново".to_string())?;
    if tokens.0.is_empty() || tokens.1.is_empty() {
        return Err("сохранённая сессия неполная; выполните вход заново".to_string());
    }
    let agent = ureq::AgentBuilder::new().build();
    build_client(
        agent,
        base.trim_end_matches('/'),
        tokens,
        user_id,
        device_id,
        db_path,
        &db_key,
    )
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
    let scope = format!("{user_id}/{device_id}");
    let _existing_key = ensure_existing_key_matches_database(db_path, &scope, keys)?;
    let agent = ureq::AgentBuilder::new().build();
    register(&agent, base, user_id, password)?;
    let login = request(
        &agent,
        base,
        "",
        "POST",
        "/login",
        Some(json!({ "userId": user_id, "password": password, "deviceId": device_id, "label": device_id, "platform": "mobile" })),
    )?;
    let tokens = match login["token"].as_str() {
        Some(t) => (t.to_string(), login["refreshToken"].as_str().ok_or("сервер не вернул токен обновления")?.to_string()),
        None => {
            let approval_id = login["approvalId"].as_str().ok_or("сервер не вернул запрос подтверждения")?.to_string();
            let code = login["code"].as_str().ok_or("нет кода подтверждения")?.to_string();
            let poll = login["pollSecret"].as_str().ok_or("нет секрета опроса")?.to_string();
            approver.call("POST", &format!("/approvals/{}/approve", urlencoding::encode(&approval_id)), Some(json!({ "code": code })))?;
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
                        pair = Some((claim["token"].as_str().map(String::from), claim["refreshToken"].as_str().map(String::from)));
                        break;
                    }
                    Some("pending") => continue,
                    other => return Err(format!("вход отклонён: {other:?}")),
                }
            }
            let (t, r) = pair.ok_or("подтверждение входа не пришло")?;
            (t.ok_or("сервер не вернул токен")?, r.ok_or("сервер не вернул токен обновления")?)
        }
    };
    build_client_with_keys(agent, base, tokens, user_id, device_id, db_path, keys)
}

fn build_client(agent: ureq::Agent, base: &str, tokens: (String, String), user_id: &str, device_id: &str, db_path: &str, db_key: &[u8; 32]) -> Result<Client, String> {
    let mut meta = open_db(db_path, db_key)?;
    {
        let mut storage = SqliteStorageProvider::<JsonCodec, &mut Connection>::new(&mut meta);
        storage.run_migrations().map_err(text)?;
    }
    meta.execute_batch(
        "CREATE TABLE IF NOT EXISTS client_meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);
         CREATE TABLE IF NOT EXISTS client_rooms (room_id TEXT PRIMARY KEY, join_epoch INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS client_welcomes (welcome_id INTEGER PRIMARY KEY, room_id TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS client_processed (event_id TEXT PRIMARY KEY);
         CREATE TABLE IF NOT EXISTS client_inbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT, acknowledged INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS client_outbox (local_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, body TEXT NOT NULL, seq INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS client_remote_config (id INTEGER PRIMARY KEY CHECK (id = 1), etag TEXT NOT NULL, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);",
    )
    .map_err(text)?;
    let serialized_tokens = serde_json::to_vec(&tokens).map_err(text)?;
    meta.execute(
        "INSERT OR REPLACE INTO client_meta (key, value) VALUES ('session_tokens', ?1)",
        [serialized_tokens],
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
        let token = self.tokens.lock().map_err(text)?.0.clone();
        request(&self.agent, &self.base, &token, method, path, body)
    }

    /// Новая пара по токену обновления. Старый токен обновления после этого не принимается.
    fn renew(&self) -> Result<(), String> {
        // Держим блокировку до завершения ротации: два параллельных 401
        // не должны потратить один refresh token дважды.
        let mut tokens = self.tokens.lock().map_err(text)?;
        let refresh = tokens.1.clone();
        let r = request(&self.agent, &self.base, "", "POST", "/token/refresh", Some(json!({ "refreshToken": refresh })))?;
        let next_pair = (
            r["token"].as_str().ok_or("сервер не вернул токен")?.to_string(),
            r["refreshToken"].as_str().ok_or("сервер не вернул токен обновления")?.to_string(),
        );
        // Одна SQL-операция заменяет пару целиком; память обновляем только
        // после успешной записи, чтобы не потерять действующий refresh token.
        let serialized = serde_json::to_vec(&next_pair).map_err(text)?;
        self.meta
            .execute(
                "INSERT OR REPLACE INTO client_meta (key, value) VALUES ('session_tokens', ?1)",
                [serialized],
            )
            .map_err(text)?;
        *tokens = next_pair;
        Ok(())
    }

    /// Выход: сессия этого устройства завершается на сервере.
    pub fn logout(&self) -> Result<(), String> {
        self.call("POST", "/logout", Some(json!({})))?;
        self.meta
            .execute("DELETE FROM client_meta WHERE key = 'session_tokens'", [])
            .map_err(text)?;
        Ok(())
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
    fn process_and_merge_commit(&mut self, room_id: &str, bytes: &[u8]) -> Result<(), String> {
        let protocol = MlsMessageIn::tls_deserialize_exact(bytes)
            .map_err(text)?
            .try_into_protocol_message()
            .map_err(text)?;
        let transaction = self.meta.transaction().map_err(text)?;
        let result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            match group.mls.process_message(&provider, protocol) {
                Ok(processed) => match processed.into_content() {
                    ProcessedMessageContent::StagedCommitMessage(staged) => {
                        group.mls.merge_staged_commit(&provider, *staged).map_err(text)
                    }
                    _ => Err("ожидался коммит".to_string()),
                },
                Err(error) => Err(text(error)),
            }
        };
        match result {
            Ok(()) => {
                if let Err(error) = transaction.commit() {
                    self.reload_group(room_id)?;
                    Err(text(error))
                } else {
                    Ok(())
                }
            }
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                Err(error)
            }
        }
    }

    /// Processes an MLS application event and persists the OpenMLS ratchet state,
    /// inbox row and processed marker in the same SQLCipher transaction.
    fn process_and_persist_incoming(
        &mut self,
        room_id: &str,
        event_id: &str,
        bytes: &[u8],
    ) -> Result<Incoming, String> {
        let protocol = MlsMessageIn::tls_deserialize_exact(bytes)
            .map_err(text)?
            .try_into_protocol_message()
            .map_err(text)?;
        let transaction = self.meta.transaction().map_err(text)?;
        let incoming_result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            match group.mls.process_message(&provider, protocol) {
                Ok(processed) => Ok(match processed.into_content() {
                    ProcessedMessageContent::ApplicationMessage(app) => {
                        match String::from_utf8(app.into_bytes()) {
                            Ok(text) => Incoming::Text {
                                room_id: room_id.to_string(),
                                event_id: event_id.to_string(),
                                text,
                            },
                            Err(_) => Incoming::Unreadable {
                                room_id: room_id.to_string(),
                                event_id: event_id.to_string(),
                            },
                        }
                    }
                    _ => Incoming::Unreadable {
                        room_id: room_id.to_string(),
                        event_id: event_id.to_string(),
                    },
                }),
                Err(error) => Err(format!(
                    "не удалось проверить или расшифровать MLS-событие {event_id}: {}",
                    text(error)
                )),
            }
        };

        match incoming_result {
            Ok(incoming) => {
                if let Err(error) = insert_incoming_record(&transaction, &incoming) {
                    drop(transaction);
                    self.reload_group(room_id)?;
                    return Err(error);
                }
                if let Err(error) = transaction.commit() {
                    self.reload_group(room_id)?;
                    return Err(text(error));
                }
                self.processed.insert(event_id.to_string());
                Ok(incoming)
            }
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                Err(error)
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
    pub fn invite(&mut self, room_id: &str, user_id: &str) -> Result<(), String> {
        self.ensure_writable()?;
        let claimed = self.call(
            "GET",
            &format!("/mls/key-packages/{}", urlencoding::encode(user_id)),
            None,
        )?;
        let packages = claimed["packages"].as_array().ok_or("нет поля packages")?.clone();
        if packages.is_empty() {
            return Err(format!("у {user_id} нет ключевых пакетов"));
        }

        let (key_packages, devices) = {
            let provider = self.provider();
            let mut key_packages = Vec::with_capacity(packages.len());
            let mut devices = Vec::with_capacity(packages.len());
            for package in &packages {
                let bytes = B64
                    .decode(package["package"].as_str().ok_or("пакет не строка")?)
                    .map_err(text)?;
                let key_package = KeyPackageIn::tls_deserialize_exact(&bytes)
                    .map_err(text)?
                    .validate(provider.crypto(), ProtocolVersion::Mls10)
                    .map_err(text)?;
                key_packages.push(key_package);
                devices.push(
                    package["deviceId"]
                        .as_str()
                        .ok_or("нет deviceId")?
                        .to_string(),
                );
            }
            (key_packages, devices)
        };

        // Stage the commit transactionally, but do not advance the local epoch
        // until the delivery service has accepted the commit.
        let transaction = self.meta.transaction().map_err(text)?;
        let staged_result = {
            let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            let epoch_before = group.mls.epoch().as_u64();
            group
                .mls
                .add_members(&provider, &self.signer, &key_packages)
                .map_err(text)
                .and_then(|(commit, welcome, _)| {
                    let commit = commit.tls_serialize_detached().map_err(text)?;
                    let welcome = welcome.tls_serialize_detached().map_err(text)?;
                    Ok((epoch_before, B64.encode(commit), B64.encode(welcome)))
                })
        };
        let (epoch_before, commit_b64, welcome_b64) = match staged_result {
            Ok(staged) => staged,
            Err(error) => {
                drop(transaction);
                self.reload_group(room_id)?;
                return Err(error);
            }
        };
        if let Err(error) = transaction.commit() {
            self.reload_group(room_id)?;
            return Err(text(error));
        }

        let welcomes: Vec<Value> = devices
            .iter()
            .map(|device| json!({ "userId": user_id, "deviceId": device, "welcome": welcome_b64 }))
            .collect();
        let server_result = self.call(
            "POST",
            &format!("/mls/groups/{}/commits", urlencoding::encode(room_id)),
            Some(json!({
                "epoch": epoch_before,
                "commit": commit_b64,
                "changes": { "adds": [user_id], "removes": [] },
                "welcomes": welcomes
            })),
        );
        if let Err(error) = server_result {
            return match self.clear_local_pending_commit(room_id) {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(format!(
                    "{error}; не удалось очистить локальный pending commit: {cleanup_error}"
                )),
            };
        }

        if let Err(error) = self.merge_local_pending_commit(room_id) {
            let cleanup = self.clear_local_pending_commit(room_id);
            return match cleanup {
                Ok(()) => Err(format!(
                    "сервер принял commit, локальное слияние не завершено; commit очищен, требуется синхронизация: {error}"
                )),
                Err(cleanup_error) => Err(format!(
                    "сервер принял commit, локальное слияние не завершено: {error}; очистка pending commit также не удалась: {cleanup_error}"
                )),
            };
        }
        Ok(())
    }

    /// Отправляет текст в комнату. Устройство должно быть на эпохе сервера: иначе сначала синхронизация.
    /// Отправляет текст в комнату. Устройство должно быть на эпохе сервера: иначе сначала синхронизация.
    pub fn send_text(&mut self, room_id: &str, plaintext: &str) -> Result<String, String> {
        let id = hex_encode(&self.crypto.random_vec(16).map_err(text)?);
        self.send_text_with_id(room_id, plaintext, &id)
    }

    /// Отправляет текст с идентификатором клиента: повтор с тем же идентификатором не создаёт дубля.
    pub fn send_text_with_id(&mut self, room_id: &str, plaintext: &str, client_message_id: &str) -> Result<String, String> {
        self.ensure_writable()?;
        let server = self.server_epoch(room_id)?;
        let provider = self.provider();
        let body = {
            let group = self.groups.get_mut(room_id).ok_or("комната не создана на этом устройстве")?;
            let local = group.mls.epoch().as_u64();
            if local != server {
                return Err(format!("устройство на эпохе {local}, сервер на {server}: сначала синхронизация"));
            }
            let message = group.mls.create_message(&provider, &self.signer, plaintext.as_bytes()).map_err(text)?;
            B64.encode(message.tls_serialize_detached().map_err(text)?)
        };
        let res = self.call(
            "POST",
            &format!("/mls/groups/{}/messages", urlencoding::encode(room_id)),
            Some(json!({ "message": body, "kind": "text", "forwarded": false, "clientMessageId": client_message_id })),
        )?;
        let event_id = res["event_id"].as_str().ok_or("сервер не вернул event_id")?.to_string();
        self.mark_processed(&event_id)?;
        Ok(event_id)
    }

    /// Входит в группы по приветствиям, которые ждут на сервере, и подтверждает их.
    fn join_welcomes(&mut self) -> Result<(), String> {
        let pending = self.call("GET", "/mls/welcomes", None)?;
        for w in pending["welcomes"].as_array().cloned().unwrap_or_default() {
            let id = w["id"].as_i64().ok_or("нет id приветствия")?;
            let previously_joined: Option<String> = self
                .meta
                .query_row(
                    "SELECT room_id FROM client_welcomes WHERE welcome_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(text)?;
            if let Some(room_id) = previously_joined {
                if self.groups.contains_key(&room_id) {
                    // The local group was committed before the previous ACK attempt.
                    // Retry only the ACK; never consume the same Welcome twice.
                    self.call("POST", &format!("/mls/welcomes/{id}/ack"), Some(json!({})))?;
                    self.meta
                        .execute("DELETE FROM client_welcomes WHERE welcome_id = ?1", [id])
                        .map_err(text)?;
                    continue;
                }
                self.meta
                    .execute("DELETE FROM client_welcomes WHERE welcome_id = ?1", [id])
                    .map_err(text)?;
            }
            let bytes = B64.decode(w["welcome"].as_str().ok_or("приветствие не строка")?).map_err(text)?;
            let welcome = match MlsMessageIn::tls_deserialize_exact(&bytes).map_err(text)?.extract() {
                MlsMessageBodyIn::Welcome(x) => x,
                _ => return Err("ожидалось приветствие".to_string()),
            };
            let join_config = MlsGroupJoinConfig::builder().use_ratchet_tree_extension(true).max_past_epochs(MAX_PAST_EPOCHS).build();
            let transaction = self.meta.transaction().map_err(text)?;
            let (mls, room_id, join_epoch) = {
                let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
                let staged = StagedWelcome::new_from_welcome(&provider, &join_config, welcome, None).map_err(text)?;
                let mls = staged.into_group(&provider).map_err(text)?;
                let room_id = String::from_utf8_lossy(mls.group_id().as_slice()).to_string();
                let join_epoch = mls.epoch().as_u64();
                (mls, room_id, join_epoch)
            };
            transaction
                .execute(
                    "INSERT OR REPLACE INTO client_rooms (room_id, join_epoch) VALUES (?1, ?2)",
                    (&room_id, join_epoch as i64),
                )
                .map_err(text)?;
            transaction
                .execute(
                    "INSERT OR REPLACE INTO client_welcomes (welcome_id, room_id) VALUES (?1, ?2)",
                    (id, &room_id),
                )
                .map_err(text)?;
            transaction.commit().map_err(text)?;
            self.groups.insert(room_id, Group { mls, join_epoch });
            // The server welcome is acknowledged only after both MLS state and
            // the local room index have been durably committed.
            self.call("POST", &format!("/mls/welcomes/{id}/ack"), Some(json!({})))?;
            self.meta
                .execute("DELETE FROM client_welcomes WHERE welcome_id = ?1", [id])
                .map_err(text)?;
        }
        Ok(())
    }

    /// Читает комнату: сообщения идут по эпохам, коммит N -> N+1 применяется после сообщений эпохи N.
    fn sync_room(&mut self, room_id: &str, out: &mut Vec<Incoming>) -> Result<(), String> {
        // After a restart, the local database may contain a pending commit whose
        // delivery result was lost. The server is authoritative: discard the
        // unmerged local commit, then apply any commit the server actually stored.
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
            return Err(format!(
                "локальная MLS эпоха {local_epoch} выше серверной {remote_epoch}; автоматическая синхронизация небезопасна"
            ));
        }
        let events = self.call("GET", &format!("/rooms/{}/events", urlencoding::encode(room_id)), None)?;
        let mut pending: Vec<(u64, String, Vec<u8>)> = Vec::new();
        for ev in events["events"].as_array().cloned().unwrap_or_default() {
            let Some(mls_b64) = ev["content"]["mls"].as_str() else { continue };
            let event_id = event_id_from_event(&ev)?;
            if self.processed.contains(&event_id) {
                continue;
            }
            let bytes = B64.decode(mls_b64).map_err(text)?;
            let protocol = MlsMessageIn::tls_deserialize_exact(&bytes).map_err(text)?.try_into_protocol_message().map_err(text)?;
            pending.push((protocol.epoch().as_u64(), event_id, bytes));
        }
        let current = self.groups.get(room_id).ok_or("комната не создана на этом устройстве")?.mls.epoch().as_u64();
        let commits = self.call("GET", &format!("/mls/groups/{}/commits?since={current}", urlencoding::encode(room_id)), None)?;
        let commits: Vec<(u64, Vec<u8>)> = commits["commits"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|c| Ok((c["epoch"].as_u64().ok_or("нет эпохи")?, B64.decode(c["commit"].as_str().ok_or("коммит не строка")?).map_err(text)?)))
            .collect::<Result<_, String>>()?;

        let join_epoch = self.groups[room_id].join_epoch;
        let before_join: Vec<String> = pending.iter().filter(|(e, _, _)| *e < join_epoch).map(|(_, id, _)| id.clone()).collect();
        for event_id in before_join {
            self.mark_processed(&event_id)?;
        }
        loop {
            let epoch = self.groups[room_id].mls.epoch().as_u64();
            let ready: Vec<(String, Vec<u8>)> = pending
                .iter()
                .filter(|(e, id, _)| *e == epoch && !self.processed.contains(id))
                .map(|(_, id, b)| (id.clone(), b.clone()))
                .collect();
            for (event_id, bytes) in ready {
                let incoming = self.process_and_persist_incoming(room_id, &event_id, &bytes)?;
                out.push(incoming);
            }
            let Some((_, commit)) = commits.iter().find(|(e, _)| *e == epoch + 1) else { break };
            self.process_and_merge_commit(room_id, commit)?;
        }
        Ok(())
    }

    /// Полная синхронизация: вход по приветствиям и чтение всех комнат устройства.
    pub fn sync(&mut self) -> Result<Vec<Incoming>, String> {
        self.join_welcomes()?;
        let rooms: Vec<String> = self.groups.keys().cloned().collect();
        let mut out = Vec::new();
        for room in rooms {
            self.sync_room(&room, &mut out)?;
        }
        Ok(out)
    }

    /// Ставит текст в очередь отправки: он уйдёт, когда появится связь. Возвращает локальный номер.
    pub fn enqueue_text(&mut self, room_id: &str, plaintext: &str) -> Result<String, String> {
        let local_id = hex_encode(&self.crypto.random_vec(16).map_err(text)?);
        self.meta
            .execute(
                "INSERT INTO client_outbox (local_id, room_id, body, seq) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM client_outbox))",
                (&local_id, room_id, plaintext),
            )
            .map_err(text)?;
        Ok(local_id)
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
                    self.meta.execute("DELETE FROM client_outbox WHERE local_id = ?1", [&local_id]).map_err(text)?;
                    sent += 1;
                }
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
            "SELECT event_id, room_id, kind, body FROM client_inbox WHERE acknowledged = 0 ORDER BY seq"
        ).map_err(text)?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        }).map_err(text)?;
        let mut incoming = Vec::new();
        for row in rows {
            let (event_id, room_id, kind, body) = row.map_err(text)?;
            let item = match kind.as_str() {
                "text" => Incoming::Text {
                    room_id,
                    event_id,
                    text: body.ok_or("в сохранённом сообщении отсутствует текст")?,
                },
                "unreadable" => Incoming::Unreadable { room_id, event_id },
                _ => return Err(format!("неизвестный тип локального сообщения: {kind}")),
            };
            incoming.push(item);
        }
        Ok(incoming)
    }

    /// Returns the local encrypted message history for one room.
    pub fn messages_for_room(&self, room_id: &str) -> Result<Vec<Incoming>, String> {
        let mut stmt = self.meta.prepare(
            "SELECT event_id, room_id, kind, body FROM client_inbox WHERE room_id = ?1 ORDER BY seq"
        ).map_err(text)?;
        let rows = stmt.query_map([room_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        }).map_err(text)?;
        let mut incoming = Vec::new();
        for row in rows {
            let (event_id, room_id, kind, body) = row.map_err(text)?;
            let item = match kind.as_str() {
                "text" => Incoming::Text {
                    room_id,
                    event_id,
                    text: body.ok_or("в сохранённом сообщении отсутствует текст")?,
                },
                "unreadable" => Incoming::Unreadable { room_id, event_id },
                _ => return Err(format!("неизвестный тип локального сообщения: {kind}")),
            };
            incoming.push(item);
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
        let removals = self.call("GET", "/mls/removals", None)?;
        let mut by_room: HashMap<String, Vec<String>> = HashMap::new();
        for removal in removals["removals"].as_array().cloned().unwrap_or_default() {
            let room = removal["roomId"].as_str().ok_or("нет roomId")?.to_string();
            let device = removal["deviceId"].as_str().ok_or("нет deviceId")?.to_string();
            by_room.entry(room).or_default().push(device);
        }

        let mut removed = 0;
        for (room_id, devices) in by_room {
            if !self.groups.contains_key(&room_id) {
                continue;
            }
            let server = self.server_epoch(&room_id)?;
            let identities: Vec<Vec<u8>> = devices
                .iter()
                .map(|device| format!("{}/{}", self.user_id, device).into_bytes())
                .collect();

            let transaction = self.meta.transaction().map_err(text)?;
            let staged_result = (|| -> Result<(u64, String), String> {
                let provider = DeviceProvider::new(&self.crypto, TransactionConnection(&transaction));
                let group = self.groups.get_mut(&room_id).ok_or("комната не найдена")?;
                let local = group.mls.epoch().as_u64();
                if local != server {
                    return Err(format!("устройство на эпохе {local}, сервер на {server}: сначала синхронизация"));
                }
                let leaves: Vec<LeafNodeIndex> = group
                    .mls
                    .members()
                    .filter(|member| {
                        identities
                            .iter()
                            .any(|identity| member.credential.serialized_content() == identity.as_slice())
                    })
                    .map(|member| member.index)
                    .collect();
                let commit = if leaves.is_empty() {
                    group
                        .mls
                        .self_update(&provider, &self.signer, LeafNodeParameters::default())
                        .map(|bundle| bundle.commit().clone())
                        .map_err(text)?
                } else {
                    group
                        .mls
                        .remove_members(&provider, &self.signer, &leaves)
                        .map(|(commit, _, _)| commit)
                        .map_err(text)?
                };
                let bytes = commit.tls_serialize_detached().map_err(text)?;
                Ok((local, B64.encode(bytes)))
            })();
            let (epoch_before, commit_b64) = match staged_result {
                Ok(staged) => staged,
                Err(error) => {
                    drop(transaction);
                    self.reload_group(&room_id)?;
                    return Err(error);
                }
            };
            if let Err(error) = transaction.commit() {
                self.reload_group(&room_id)?;
                return Err(text(error));
            }

            let server_result = self.call(
                "POST",
                &format!("/mls/groups/{}/commits", urlencoding::encode(&room_id)),
                Some(json!({
                    "epoch": epoch_before,
                    "commit": commit_b64,
                    "changes": { "adds": [], "removes": [], "removeDevices": devices }
                })),
            );
            if let Err(error) = server_result {
                return match self.clear_local_pending_commit(&room_id) {
                    Ok(()) => Err(error),
                    Err(cleanup_error) => Err(format!(
                        "{error}; не удалось очистить локальный pending commit: {cleanup_error}"
                    )),
                };
            }

            if let Err(error) = self.merge_local_pending_commit(&room_id) {
                let cleanup = self.clear_local_pending_commit(&room_id);
                return match cleanup {
                    Ok(()) => Err(format!(
                        "сервер принял commit удаления, локальное слияние не завершено; commit очищен, требуется синхронизация: {error}"
                    )),
                    Err(cleanup_error) => Err(format!(
                        "сервер принял commit удаления, локальное слияние не завершено: {error}; очистка pending commit также не удалась: {cleanup_error}"
                    )),
                };
            }
            removed += devices.len();
        }
        Ok(removed)
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
}
