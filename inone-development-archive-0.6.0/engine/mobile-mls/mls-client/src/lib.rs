//! Ядро клиента InOne на Rust: вход, ключевые пакеты, группы MLS, сообщения, догон после отсутствия,
//! вход нового устройства по подтверждению и удаление отозванных устройств из групп.
//! База устройства зашифрована (SQLCipher). Ключ передаёт платформа: Keychain на iOS, Keystore на Android.
use std::borrow::Borrow;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::RustCrypto;
use openmls_sqlite_storage::{Codec, Connection, SqliteStorageProvider};
use openmls_traits::{crypto::OpenMlsCrypto, random::OpenMlsRand, types::HashType};
use serde_json::{json, Value};

pub mod remote_config;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
/// Сколько прошлых эпох хранит группа (см. mls-bridge: по умолчанию OpenMLS не хранит ни одной).
const MAX_PAST_EPOCHS: usize = 16;

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
    },
    Unreadable {
        room_id: String,
        event_id: String,
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

pub struct Client {
    base: String,
    /// Пара: токен доступа и одноразовый токен обновления. Ядро обновляет их само, когда доступ истёк.
    tokens: Mutex<(String, String)>,
    user_id: String,
    device_id: String,
    agent: ureq::Agent,
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

fn text(e: impl std::fmt::Display) -> String {
    e.to_string()
}

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
    let (event_id, room_id, kind, body): (&str, &str, &str, Option<&str>) = match incoming {
        Incoming::Text { room_id, event_id, text } => (event_id, room_id, "text", Some(text)),
        Incoming::Unreadable { room_id, event_id } => (event_id, room_id, "unreadable", None),
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
    db.execute(
        "DELETE FROM client_inbox
         WHERE acknowledged = 1 AND acknowledged_at IS NOT NULL AND acknowledged_at < ?1",
        [now - ACKNOWLEDGED_INBOX_RETENTION_MS],
    )
    .map_err(text)?;

    let (pending_count, pending_bytes): (i64, i64) = db
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(body)), 0)
             FROM client_inbox WHERE acknowledged = 0",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(text)?;
    let body_bytes = body.map_or(0, |value| value.len()) as i64;
    if pending_count >= MAX_PENDING_INBOX_ITEMS
        || pending_bytes.saturating_add(body_bytes) > MAX_PENDING_INBOX_BYTES
    {
        return Err("durable inbox capacity reached; event remains unprocessed for retry".to_string());
    }

    db.execute(
        "INSERT OR IGNORE INTO client_inbox (event_id, room_id, kind, body, acknowledged, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        rusqlite::params![event_id, room_id, kind, body, now],
    )
    .map_err(text)?;
    Ok(())
}

fn insert_processed_event(db: &Connection, event_id: &str) -> Result<(), String> {
    db.execute(
        "INSERT OR IGNORE INTO client_processed (event_id) VALUES (?1)",
        [event_id],
    )
    .map_err(text)?;
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

/// Ключ базы устройства. Платформа хранит его в Keychain (iOS) или Keystore (Android); ядро его не сохраняет.
pub trait KeyStore {
    fn database_key(&self, scope: &str) -> Result<[u8; 32], String>;
}

/// Хранилище ключей в памяти: для тестов. Для выпуска нужно хранилище платформы.
#[derive(Default)]
pub struct MemoryKeyStore {
    keys: std::sync::Mutex<HashMap<String, [u8; 32]>>,
}

impl KeyStore for MemoryKeyStore {
    fn database_key(&self, scope: &str) -> Result<[u8; 32], String> {
        let mut keys = self.keys.lock().map_err(text)?;
        if let Some(key) = keys.get(scope) {
            return Ok(*key);
        }
        let key = RustCrypto::default().random_array::<32>().map_err(text)?;
        keys.insert(scope.to_string(), key);
        Ok(key)
    }
}

/// Ошибка временная (нет сети, 429, 5xx): её имеет смысл повторить позже.
pub fn is_retryable(err: &str) -> bool {
    if err.starts_with("сеть:") {
        return true;
    }
    if let Some(pos) = err.find(" -> ") {
        let code: String = err[pos + 4..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(code) = code.parse::<u16>() {
            return code == 429 || (500..600).contains(&code);
        }
    }
    false
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
    let tokens = (
        login["token"]
            .as_str()
            .ok_or("сервер не вернул токен: нужно подтверждение с другого устройства")?
            .to_string(),
        login["refreshToken"]
            .as_str()
            .ok_or("сервер не вернул токен обновления")?
            .to_string(),
    );
    build_client(
        agent,
        base,
        tokens,
        user_id,
        device_id,
        db_path,
        &keys.database_key(&format!("{user_id}/{device_id}"))?,
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
    build_client(
        agent,
        base,
        tokens,
        user_id,
        device_id,
        db_path,
        &keys.database_key(&format!("{user_id}/{device_id}"))?,
    )
}

fn build_client(
    agent: ureq::Agent,
    base: &str,
    tokens: (String, String),
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
    let provider = DeviceProvider::new(Arc::new(RustCrypto::default()), Arc::clone(&connection));
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
           acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
           created_at INTEGER NOT NULL,
           acknowledged_at INTEGER,
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
         CREATE TABLE IF NOT EXISTS client_outbox (local_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, body TEXT NOT NULL, seq INTEGER NOT NULL);
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
            UNIQUE (room_id, target_user_id)
          )",
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

    Ok(Client {
        base: base.to_string(),
        tokens: Mutex::new(tokens),
        user_id: user_id.to_string(),
        device_id: device_id.to_string(),
        agent,
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
    body.get("code")?.as_str().map(str::to_string)
}

impl Client {
    /// Вызов API. Если токен доступа истёк, токен обновляется и запрос повторяется один раз.
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
        let refresh = self.tokens.lock().map_err(text)?.1.clone();
        let r = request(
            &self.agent,
            &self.base,
            "",
            "POST",
            "/token/refresh",
            Some(json!({ "refreshToken": refresh })),
        )?;
        let token = r["token"]
            .as_str()
            .ok_or("сервер не вернул токен")?
            .to_string();
        let next = r["refreshToken"]
            .as_str()
            .ok_or("сервер не вернул токен обновления")?
            .to_string();
        *self.tokens.lock().map_err(text)? = (token, next);
        Ok(())
    }

    /// Выход: сессия этого устройства завершается на сервере.
    pub fn logout(&self) -> Result<(), String> {
        self.call("POST", "/logout", Some(json!({})))?;
        Ok(())
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
                    if let Err(error) = tx.commit() {
                        self.reload_group(&room_id)?;
                        return Err(format!("временная ошибка локального хранилища при фиксации membership commit: {}", text(error)));
                    }
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
    ) -> Result<(String, String), String> {
        let existing: Option<(String, String)> = match self.meta.query_row(
            "SELECT operation_id, state FROM client_invite_intents WHERE room_id = ?1 AND target_user_id = ?2",
            rusqlite::params![room_id, user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ) {
            Ok(row) => Some(row),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(error) => return Err(text(error)),
        };
        if let Some(intent) = existing {
            return Ok(intent);
        }
        let operation_id = hex_encode(&self.provider.rand().random_vec(16).map_err(text)?);
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.meta.execute(
            "INSERT INTO client_invite_intents (operation_id, room_id, target_user_id, state, created_at)
             VALUES (?1, ?2, ?3, 'claim_pending', ?4)",
            rusqlite::params![operation_id, room_id, user_id, created_at],
        ).map_err(text)?;
        Ok((operation_id, "claim_pending".to_string()))
    }

    fn resume_claim_pending_invite(
        &mut self,
        room_id: &str,
        user_id: &str,
        operation_id: &str,
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
            let payload = json!({
                "epoch": base_epoch,
                "commit": B64.encode(&commit_bytes),
                "changes": changes,
                "welcomes": welcomes,
                "clientOperationId": operation_id,
                "keyPackageClaimId": operation_id,
            });
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
        if self.flush_pending_membership_commits()? > 0 {
            let mut incoming = Vec::new();
            self.sync_room(room_id, &mut incoming)?;
            self.inbox.extend(incoming);
            return Ok(false);
        }
        Ok(true)
    }

    fn resume_claim_pending_invites(&mut self) -> Result<(), String> {
        let intents: Vec<(String, String, String)> = {
            let mut stmt = self
                .meta
                .prepare(
                    "SELECT operation_id, room_id, target_user_id FROM client_invite_intents
                 WHERE state = 'claim_pending' ORDER BY created_at, operation_id",
                )
                .map_err(text)?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(text)?;
            rows.collect::<Result<_, _>>().map_err(text)?
        };
        for (operation_id, room_id, user_id) in intents {
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

    pub fn invite(&mut self, room_id: &str, user_id: &str) -> Result<(), String> {
        self.ensure_writable()?;
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!("комната требует восстановления: {reason}"));
        }
        self.flush_pending_membership_commits()?;
        let (operation_id, state) = self.ensure_invite_intent(room_id, user_id)?;
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
            if self.resume_claim_pending_invite(room_id, user_id, &operation_id)? {
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

    /// Отправляет UTF-8 текст в комнату. Устройство должно быть на эпохе сервера.
    pub fn send_text(&mut self, room_id: &str, plaintext: &str) -> Result<String, String> {
        let id = hex_encode(&self.provider.rand().random_vec(16).map_err(text)?);
        self.send_text_with_id(room_id, plaintext, &id)
    }

    /// Отправляет UTF-8 текст с идемпотентным идентификатором клиента.
    pub fn send_text_with_id(
        &mut self,
        room_id: &str,
        plaintext: &str,
        client_message_id: &str,
    ) -> Result<String, String> {
        self.send_application_payload_with_id(room_id, plaintext.as_bytes(), client_message_id)
    }

    /// Sends an opaque MLS application payload. Text consumers may classify non-UTF-8 payloads
    /// as unreadable, but must still advance and persist the MLS event without poisoning the room.
    pub fn send_application_payload_with_id(
        &mut self,
        room_id: &str,
        payload: &[u8],
        client_message_id: &str,
    ) -> Result<String, String> {
        if self.flush_pending_membership_commits()? > 0 {
            self.sync()?;
        }
        self.ensure_writable()?;
        if let Some(reason) = self.desync_reason(room_id)? {
            return Err(format!(
                "комната рассинхронизирована, отправка приостановлена: {reason}"
            ));
        }
        let server = self.server_epoch(room_id)?;
        let body = {
            let group = self
                .groups
                .get_mut(room_id)
                .ok_or("комната не создана на этом устройстве")?;
            let local = group.mls.epoch().as_u64();
            if local != server {
                return Err(format!(
                    "устройство на эпохе {local}, сервер на {server}: сначала синхронизация"
                ));
            }
            let message = group
                .mls
                .create_message(&self.provider, &self.signer, payload)
                .map_err(text)?;
            B64.encode(message.tls_serialize_detached().map_err(text)?)
        };
        let res = self.call(
            "POST",
            &format!("/mls/groups/{}/messages", urlencoding::encode(room_id)),
            Some(json!({ "message": body, "kind": "text", "forwarded": false, "clientMessageId": client_message_id })),
        )?;
        let event_id = res["event_id"]
            .as_str()
            .ok_or("сервер не вернул event_id")?
            .to_string();
        self.mark_processed(&event_id)?;
        Ok(event_id)
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
        tx.execute(
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
        let existing: (String, Vec<u8>, String) = tx.query_row(
            "SELECT room_id, welcome, outcome FROM client_welcome_receipts WHERE welcome_id = ?1",
            [welcome_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(text)?;
        if existing.0 != room_id || existing.1 != bytes || existing.2 != outcome {
            return Err(format!(
                "Welcome receipt identity collision for id {welcome_id}"
            ));
        }
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
            let staged = match StagedWelcome::new_from_welcome(
                &self.provider,
                &join_config,
                welcome,
                None,
            ) {
                Ok(staged) => staged,
                Err(WelcomeError::GroupAlreadyExists) => {
                    self.record_desync(
                        room_id,
                        "GroupAlreadyExists while replaying Welcome; retain Welcome without ACK for explicit recovery",
                    )?;
                    continue;
                }
                Err(WelcomeError::LibraryError(_)) | Err(WelcomeError::StorageError(_)) => {
                    // Indeterminate: keep the server Welcome pending and do not quarantine.
                    continue;
                }
                Err(error) => {
                    if self
                        .persist_welcome_receipt(
                            welcome_id,
                            room_id,
                            &bytes,
                            "quarantined",
                            Some(&format!("Permanent Welcome error: {error:?}")),
                        )
                        .is_ok()
                    {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };
            let mls = match staged.into_group(&self.provider) {
                Ok(group) => group,
                Err(WelcomeError::GroupAlreadyExists) => {
                    self.record_desync(
                        room_id,
                        "GroupAlreadyExists while materializing Welcome; retain Welcome without ACK for explicit recovery",
                    )?;
                    continue;
                }
                Err(WelcomeError::LibraryError(_)) | Err(WelcomeError::StorageError(_)) => {
                    continue;
                }
                Err(error) => {
                    if self
                        .persist_welcome_receipt(
                            welcome_id,
                            room_id,
                            &bytes,
                            "quarantined",
                            Some(&format!(
                                "Permanent Welcome materialization error: {error:?}"
                            )),
                        )
                        .is_ok()
                    {
                        let _ = self.ack_welcome(welcome_id);
                    }
                    continue;
                }
            };
            let actual_room = String::from_utf8_lossy(mls.group_id().as_slice()).to_string();
            if actual_room != room_id {
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
            // If this write fails, the Welcome remains unacknowledged. The next run will
            // observe GroupAlreadyExists and require explicit room recovery rather than lose it.
            if self
                .meta
                .execute(
                    "INSERT OR REPLACE INTO client_rooms (room_id, join_epoch) VALUES (?1, ?2)",
                    (&room_id, join_epoch as i64),
                )
                .is_err()
            {
                continue;
            }
            self.groups
                .insert(room_id.to_string(), Group { mls, join_epoch });
            if self
                .persist_welcome_receipt(welcome_id, room_id, &bytes, "joined", None)
                .is_ok()
            {
                let _ = self.ack_welcome(welcome_id);
            }
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
        out: &mut Vec<Incoming>,
    ) -> Result<(), String> {
        let parsed = MlsMessageIn::tls_deserialize_exact(bytes)
            .ok()
            .and_then(|message| message.try_into_protocol_message().ok());
        let Some(protocol) = parsed else {
            let incoming = Incoming::Unreadable {
                room_id: room_id.to_string(),
                event_id: event_id.to_string(),
            };
            let transaction = self.meta.unchecked_transaction().map_err(text)?;
            if let Err(error) = insert_incoming_record(&transaction, &incoming)
                .and_then(|_| insert_processed_event(&transaction, event_id))
            {
                drop(transaction);
                return Err(format!("временная ошибка сохранения unreadable inbox item: {error}"));
            }
            transaction.commit().map_err(|error| {
                format!("временная ошибка фиксации unreadable inbox item: {}", text(error))
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
            group
                .mls
                .process_message(&transactional_provider, protocol)
        };
        drop(transactional_provider);

        match processed_result {
            Ok(processed) => {
                let (incoming, unreadable_reason) = match processed.into_content() {
                    ProcessedMessageContent::ApplicationMessage(app) => {
                        match String::from_utf8(app.into_bytes()) {
                            Ok(text) => (
                                Incoming::Text {
                                    room_id: room_id.to_string(),
                                    event_id: event_id.to_string(),
                                    text,
                                },
                                None,
                            ),
                            Err(_) => (
                                Incoming::Unreadable {
                                    room_id: room_id.to_string(),
                                    event_id: event_id.to_string(),
                                },
                                Some("application payload is not valid UTF-8"),
                            ),
                        }
                    }
                    _ => (
                        Incoming::Unreadable {
                            room_id: room_id.to_string(),
                            event_id: event_id.to_string(),
                        },
                        Some("MLS message is not an application message"),
                    ),
                };

                if let Err(error) = insert_incoming_record(&transaction, &incoming)
                    .and_then(|_| insert_processed_event(&transaction, event_id))
                    .and_then(|_| {
                        if let Some(reason) = unreadable_reason {
                            transaction
                                .execute(
                                    "INSERT OR IGNORE INTO client_undecryptable (event_id, room_id, reason)
                                     VALUES (?1, ?2, ?3)",
                                    rusqlite::params![event_id, room_id, reason],
                                )
                                .map_err(text)?;
                        }
                        Ok(())
                    })
                {
                    drop(transaction);
                    self.reload_group(room_id)?;
                    return Err(format!("временная ошибка сохранения MLS inbox, повтор позже: {error}"));
                }

                if let Err(error) = transaction.commit() {
                    self.reload_group(room_id)?;
                    return Err(format!("временная ошибка фиксации MLS inbox, повтор позже: {}", text(error)));
                }
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
                    };
                    let quarantine = self.meta.unchecked_transaction().map_err(text)?;
                    if let Err(error) = insert_incoming_record(&quarantine, &incoming) {
                        drop(quarantine);
                        return Err(format!("временная ошибка сохранения unreadable inbox item: {error}"));
                    }
                    if let Err(error) = quarantine.execute(
                            "INSERT OR IGNORE INTO client_undecryptable (event_id, room_id, reason)
                             VALUES (?1, ?2, ?3)",
                            rusqlite::params![event_id, room_id, reason],
                        ) {
                        drop(quarantine);
                        return Err(format!("временная ошибка сохранения unreadable diagnostic: {}", text(error)));
                    }
                    if let Err(error) = insert_processed_event(&quarantine, event_id) {
                        drop(quarantine);
                        return Err(format!("временная ошибка сохранения processed marker: {error}"));
                    }
                    quarantine.commit().map_err(|error| {
                        format!("временная ошибка фиксации unreadable inbox item: {}", text(error))
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
        let mut pending: Vec<(u64, String, Vec<u8>)> = Vec::new();
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
            let Some(mls_b64) = ev["content"]["mls"].as_str() else {
                continue;
            };
            if self.processed.contains(&event_id) {
                continue;
            }
            // Испорченный base64 — постоянная ошибка этого события, а не причина остановить комнату (аудит, P0.1).
            let Ok(bytes) = B64.decode(mls_b64) else {
                self.record_unreadable(room_id, &event_id, "сообщение не разбирается")?;
                self.mark_processed(&event_id)?;
                out.push(Incoming::Unreadable {
                    room_id: room_id.to_string(),
                    event_id: event_id.clone(),
                });
                continue;
            };
            let parsed = MlsMessageIn::tls_deserialize_exact(&bytes)
                .ok()
                .and_then(|m| m.try_into_protocol_message().ok());
            let Some(protocol) = parsed else {
                self.record_unreadable(room_id, &event_id, "сообщение не разбирается")?;
                self.mark_processed(&event_id)?;
                out.push(Incoming::Unreadable {
                    room_id: room_id.to_string(),
                    event_id: event_id.clone(),
                });
                continue;
            };
            pending.push((protocol.epoch().as_u64(), event_id, bytes));
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
            .filter(|(e, _, _)| *e < join_epoch)
            .map(|(_, id, _)| id.clone())
            .collect();
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
                self.process_event(room_id, &event_id, &bytes, out)?;
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
            let processed = {
                let group = self
                    .groups
                    .get_mut(room_id)
                    .ok_or("комната не создана на этом устройстве")?;
                group.mls.process_message(&self.provider, protocol)
            };
            let processed = match processed {
                Ok(processed) => processed,
                Err(error) => match classify_process_error(&error) {
                    Failure::Transient => {
                        return Err(format!(
                            "временная ошибка обработки Commit, повтор позже: {error}"
                        ))
                    }
                    Failure::Permanent(classification) => {
                        let reason = format!("{classification}: {error}");
                        self.quarantine_commit(room_id, *commit_epoch, commit, &reason)?;
                        return Err(format!("RecoveryRequired: {reason}"));
                    }
                },
            };
            let staged = match processed.into_content() {
                ProcessedMessageContent::StagedCommitMessage(staged) => staged,
                _ => {
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
                    self.quarantine_commit(room_id, *commit_epoch, commit, &reason)?;
                    return Err(format!("RecoveryRequired: {reason}"));
                }
            }
            let merge = {
                let group = self
                    .groups
                    .get_mut(room_id)
                    .ok_or("комната не создана на этом устройстве")?;
                group.mls.merge_staged_commit(&self.provider, *staged)
            };
            if let Err(error) = merge {
                return Err(format!(
                    "временная ошибка слияния Commit, повтор позже: {error}"
                ));
            }
        }

        // Опоздавшие события (аудит, P0.3): их эпоха уже пройдена. Внутри окна пробуем расшифровать,
        // за пределами окна — явная постоянная ошибка с причиной, а не молчаливый пропуск.
        let final_epoch = self.groups[room_id].mls.epoch().as_u64();
        let late: Vec<(String, Vec<u8>, u64)> = pending
            .iter()
            .filter(|(e, id, _)| *e < final_epoch && !self.processed.contains(id))
            .map(|(e, id, b)| (id.clone(), b.clone(), *e))
            .collect();
        for (event_id, bytes, epoch) in late {
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
                });
            } else {
                self.process_event(room_id, &event_id, &bytes, out)?;
            }
        }

        // Future-epoch events are not corrupt: they are waiting for the missing
        // Commit. Persist this room-scoped state and retry it on the next sync.
        let future_event_ids: Vec<String> = pending
            .iter()
            .filter(|(epoch, event_id, _)| {
                *epoch > final_epoch && !self.processed.contains(event_id)
            })
            .map(|(_, event_id, _)| event_id.clone())
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
                Err(e) if e.starts_with("ошибка контракта ответа:") => {
                    continue
                }
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

    /// Сколько сообщений ждут отправки.
    pub fn outbox_len(&self) -> Result<u64, String> {
        let n: i64 = self
            .meta
            .query_row("SELECT COUNT(*) FROM client_outbox", [], |r| r.get(0))
            .map_err(text)?;
        Ok(n as u64)
    }

    /// Отправляет очередь по порядку. Без связи ничего не теряет: возвращает 0, очередь остаётся.
    pub fn flush_outbox(&mut self) -> Result<usize, String> {
        if self.cached_remote_config().maintenance {
            return Ok(0); // очередь не трогаем: сообщения уйдут после обслуживания
        }
        let items: Vec<(String, String, String)> = {
            let mut stmt = self
                .meta
                .prepare("SELECT local_id, room_id, body FROM client_outbox ORDER BY seq")
                .map_err(text)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(text)?;
            rows.collect::<Result<_, _>>().map_err(text)?
        };
        if items.is_empty() {
            return Ok(0);
        }
        match self.sync() {
            Ok(got) => self.inbox.extend(got),
            Err(e) if is_retryable(&e) => return Ok(0),
            Err(e) => return Err(e),
        }
        let mut sent = 0;
        for (local_id, room_id, body) in items {
            match self.send_text_with_id(&room_id, &body, &local_id) {
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
                "SELECT event_id, room_id, kind, body
                 FROM client_inbox WHERE acknowledged = 0 ORDER BY seq",
            )
            .map_err(text)?;
        let rows = statement
            .query_map([], |row| {
                let event_id: String = row.get(0)?;
                let room_id: String = row.get(1)?;
                let kind: String = row.get(2)?;
                let body: Option<String> = row.get(3)?;
                Ok((event_id, room_id, kind, body))
            })
            .map_err(text)?;
        rows.map(|row| {
            let (event_id, room_id, kind, body) = row.map_err(text)?;
            match kind.as_str() {
                "text" => Ok(Incoming::Text {
                    room_id,
                    event_id,
                    text: body.ok_or_else(|| "inbox text row has no body".to_string())?,
                }),
                "unreadable" => Ok(Incoming::Unreadable { room_id, event_id }),
                _ => Err("inbox contains an unsupported record kind".to_string()),
            }
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
        transaction.commit().map_err(text)?;
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
