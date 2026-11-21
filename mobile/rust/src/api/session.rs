use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use zeroize::Zeroizing;

use serde::Serialize;

use sha2::{Digest, Sha256};

use flutter_rust_bridge::frb;
use mls_client::{connect_with_session, resume_with_session, Client, Incoming, KeyStore};

use crate::secure_store::PlatformKeyStore;

/// Rust-owned persistent OpenMLS session. The refresh token and SQLCipher
/// database key never have getters in the Dart-facing API.
#[frb(opaque)]
pub struct MlsSession {
    client: Mutex<Option<Client>>,
    database_path: String,
    identity_scope: String,
    keys: Arc<dyn KeyStore>,
    // Declared after `client`: SQLite/OpenMLS drops before this reservation releases.
    identity_reservation: Mutex<Option<IdentityReservation>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
    Text {
        room_id: String,
        event_id: String,
        text: String,
    },
    Attachment {
        room_id: String,
        event_id: String,
        file_id: String,
        name: String,
        mime_type: String,
        size: u64,
    },
    Unreadable {
        room_id: String,
        event_id: String,
    },
}

static ACTIVE_IDENTITIES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

struct IdentityReservation {
    identity: String,
}

impl Drop for IdentityReservation {
    fn drop(&mut self) {
        let active = ACTIVE_IDENTITIES.get_or_init(|| Mutex::new(HashSet::new()));
        let mut active = active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        active.remove(&self.identity);
    }
}

fn reserve_identity(identity: &str) -> Result<IdentityReservation, String> {
    let active = ACTIVE_IDENTITIES.get_or_init(|| Mutex::new(HashSet::new()));
    let mut active = active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !active.insert(identity.to_string()) {
        return Err("MLS session is already active for this user/device identity".to_string());
    }
    Ok(IdentityReservation {
        identity: identity.to_string(),
    })
}

fn validated_identity(user_id: &str, device_id: &str) -> Result<String, String> {
    for (name, value) in [("user_id", user_id), ("device_id", device_id)] {
        if value.trim().is_empty() {
            return Err(format!("{name} is required"));
        }
        if (name == "device_id" && value.contains('/')) || value.chars().any(char::is_control) {
            return Err(format!("{name} contains a forbidden character"));
        }
    }
    Ok(format!("{user_id}/{device_id}"))
}

fn normalized_database_directory(directory: &str, create: bool) -> Result<String, String> {
    let path = Path::new(directory);
    if !path.is_absolute() {
        return Err("MLS database directory must be an absolute app-private path".to_string());
    }
    if create {
        std::fs::create_dir_all(path)
            .map_err(|error| format!("создание каталога базы MLS: {error}"))?;
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("проверка каталога базы MLS: {error}"))?;
    if !canonical.is_dir() {
        return Err("MLS database path is not a directory".to_string());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

fn purge_database_directory(directory: &str) -> Result<String, String> {
    let path = Path::new(directory);
    if !path.is_absolute() {
        return Err("MLS database directory must be an absolute app-private path".to_string());
    }
    match std::fs::canonicalize(path) {
        Ok(canonical) if canonical.is_dir() => Ok(canonical.to_string_lossy().into_owned()),
        Ok(_) => Err("MLS database path is not a directory".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Preserve key deletion even if the app-private database directory
            // itself has already disappeared.
            Ok(path.to_string_lossy().into_owned())
        }
        Err(error) => Err(format!("проверка каталога базы MLS: {error}")),
    }
}

fn database_path_for_identity(directory: &str, identity: &str) -> String {
    let digest = Sha256::digest(identity.as_bytes());
    let filename = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    PathBuf::from(directory)
        .join(format!("{filename}.sqlcipher"))
        .to_string_lossy()
        .into_owned()
}

fn map_incoming(items: Vec<Incoming>) -> Vec<IncomingMessage> {
    items
        .into_iter()
        .map(|item| match item {
            Incoming::Text {
                room_id,
                event_id,
                text,
            } => IncomingMessage::Text {
                room_id,
                event_id,
                text,
            },
            Incoming::Attachment {
                room_id,
                event_id,
                file_id,
                name,
                mime_type,
                size,
            } => IncomingMessage::Attachment {
                room_id,
                event_id,
                file_id,
                name,
                mime_type,
                size,
            },
            Incoming::Unreadable { room_id, event_id } => {
                IncomingMessage::Unreadable { room_id, event_id }
            }
        })
        .collect()
}

impl MlsSession {
    fn with_client<T>(
        &self,
        operation: impl FnOnce(&mut Client) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.client.lock().map_err(|error| error.to_string())?;
        let client = guard
            .as_mut()
            .ok_or_else(|| "MLS session is closed".to_string())?;
        operation(client)
    }

    /// Current short-lived access token only. Refresh token stays in Rust.
    pub fn access_token_snapshot(&self) -> Result<String, String> {
        self.with_client(|client| client.access_token_snapshot())
    }

    /// Rotate the session in Rust and return only the new access token.
    pub fn refresh_session(&self) -> Result<String, String> {
        self.with_client(|client| client.refresh_session())
    }

    pub fn ensure_key_packages(&self, target: u64) -> Result<(), String> {
        self.with_client(|client| client.ensure_key_packages(target))
    }

    pub fn create_room(&self, room_id: String) -> Result<(), String> {
        self.with_client(|client| client.create_room(&room_id))
    }

    pub fn invite(&self, room_id: String, user_id: String) -> Result<(), String> {
        self.with_client(|client| client.invite(&room_id, &user_id))
    }

    /// Cancels an invite only when its server-side KeyPackage claim can be safely released.
    pub fn cancel_invite(&self, room_id: String, user_id: String) -> Result<(), String> {
        self.with_client(|client| client.cancel_invite(&room_id, &user_id))
    }

    /// Returns a room-scoped RecoveryRequired, WaitingForCommit or membership mismatch reason.
    pub fn room_recovery_status(&self, room_id: String) -> Result<Option<String>, String> {
        self.with_client(|client| client.desync_reason(&room_id))
    }

    /// Returns durable diagnostics for unreadable MLS events without exposing plaintext keys.
    pub fn undecryptable_json(&self) -> Result<String, String> {
        let items = self.with_client(|client| client.undecryptable())?;
        serde_json::to_string(&items).map_err(|error| error.to_string())
    }

    /// Returns the durable Welcome receipt outcome and ACK state for diagnostics.
    // Rust-only helper; no production Dart bridge contract currently consumes this DTO.
    #[frb(ignore)]
    pub fn welcome_receipt_status_json(&self, welcome_id: i64) -> Result<String, String> {
        let status = self.with_client(|client| client.welcome_receipt_status(welcome_id))?;
        serde_json::to_string(&status).map_err(|error| error.to_string())
    }

    /// Returns a quarantined Commit reason for the requested room epoch.
    pub fn quarantined_commit_reason(
        &self,
        room_id: String,
        epoch: u64,
    ) -> Result<Option<String>, String> {
        self.with_client(|client| client.quarantined_commit_reason(&room_id, epoch))
    }

    pub fn send_text(&self, room_id: String, plaintext: String) -> Result<String, String> {
        let plaintext = Zeroizing::new(plaintext);
        self.with_client(|client| client.send_text(&room_id, plaintext.as_str()))
    }

    /// Encrypts and uploads an attachment inside the persistent Rust client.
    /// Plaintext never crosses the object-storage HTTP boundary. The caller must
    /// reuse client_message_id when retrying an uncertain network operation.
    pub fn send_attachment(
        &self,
        room_id: String,
        name: String,
        mime_type: String,
        plaintext: Vec<u8>,
        client_message_id: String,
    ) -> Result<String, String> {
        let plaintext = Zeroizing::new(plaintext);
        self.with_client(|client| {
            client.send_attachment_with_id(
                &room_id,
                &name,
                &mime_type,
                plaintext.as_slice(),
                &client_message_id,
            )
        })
    }

    /// Downloads ciphertext and returns plaintext only after manifest/hash verification.
    /// The returned bytes are intended for the requesting device only.
    pub fn download_attachment(&self, file_id: String) -> Result<Vec<u8>, String> {
        self.with_client(|client| client.download_attachment(&file_id))
            .map(|bytes| Zeroizing::new(bytes).to_vec())
    }

    pub fn enqueue_text(&self, room_id: String, plaintext: String) -> Result<String, String> {
        let plaintext = Zeroizing::new(plaintext);
        self.with_client(|client| client.enqueue_text(&room_id, plaintext.as_str()))
    }

    // The Dart adapter consumes sync_json() to preserve the stable JSON DTO boundary.
    #[frb(ignore)]
    pub fn sync(&self) -> Result<Vec<IncomingMessage>, String> {
        self.with_client(|client| client.sync().map(map_incoming))
    }

    /// JSON form keeps the Dart API stable without exposing MLS internals.
    pub fn sync_json(&self) -> Result<String, String> {
        let items = self.sync()?;
        serde_json::to_string(&items).map_err(|error| error.to_string())
    }

    /// Returns pending decrypted messages without consuming them.
    // The Dart adapter consumes pending_incoming_json() to preserve the stable JSON DTO boundary.
    #[frb(ignore)]
    pub fn pending_incoming(&self) -> Result<Vec<IncomingMessage>, String> {
        self.with_client(|client| client.pending_incoming().map(map_incoming))
    }

    pub fn pending_incoming_json(&self) -> Result<String, String> {
        let items = self.pending_incoming()?;
        serde_json::to_string(&items).map_err(|error| error.to_string())
    }

    /// Returns decrypted message history for a room from the SQLCipher inbox.
    pub fn messages_for_room_json(&self, room_id: String) -> Result<String, String> {
        let items =
            self.with_client(|client| client.messages_for_room(&room_id).map(map_incoming))?;
        serde_json::to_string(&items).map_err(|error| error.to_string())
    }

    /// Marks inbox entries acknowledged after the app confirms durable acceptance; history remains available.
    pub fn acknowledge_incoming(&self, event_ids: Vec<String>) -> Result<(), String> {
        self.with_client(|client| client.acknowledge_incoming(&event_ids))
    }

    pub fn outbox_len(&self) -> Result<u64, String> {
        self.with_client(|client| client.outbox_len())
    }

    pub fn flush_outbox(&self) -> Result<usize, String> {
        self.with_client(Client::flush_outbox)
    }

    pub fn local_epoch(&self, room_id: String) -> Result<Option<u64>, String> {
        self.with_client(|client| Ok(client.local_epoch(&room_id)))
    }

    pub fn members_of(&self, room_id: String) -> Result<Vec<String>, String> {
        self.with_client(|client| client.members_of(&room_id))
    }

    pub fn revoke_device(&self, device_id: String) -> Result<(), String> {
        self.with_client(|client| client.revoke_device(&device_id))
    }

    pub fn remove_revoked_devices(&self) -> Result<usize, String> {
        self.with_client(Client::remove_revoked_devices)
    }

    /// Logs out remotely when possible, then always destroys local MLS state.
    /// A network error is returned after local database and key cleanup.
    pub fn logout(&self) -> Result<(), String> {
        let mut reservation = self
            .identity_reservation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if reservation.is_none() {
            return Err("MLS session is closed; logout cannot purge a later session".to_string());
        }
        // A poisoned lock or a panic in remote logout must never bypass local
        // SQLCipher/key destruction.
        let remote_result = match self.client.lock() {
            Ok(mut guard) => {
                let result = match guard.as_ref() {
                    Some(client) => catch_unwind(AssertUnwindSafe(|| client.logout()))
                        .unwrap_or_else(|_| Err("panic during remote MLS logout".to_string())),
                    None => Ok(()),
                };
                *guard = None;
                result
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = None;
                Err(
                    "MLS session lock was poisoned; server logout could not be confirmed"
                        .to_string(),
                )
            }
        };

        let cleanup_result = cleanup_local_session(
            &self.database_path,
            &self.identity_scope,
            self.keys.as_ref(),
        );
        // Release only after the client handle and local cleanup attempt are complete.
        reservation.take();
        let mut errors = Vec::new();
        if let Err(error) = cleanup_result {
            errors.push(error);
        }
        if let Err(error) = remote_result {
            errors.push(format!("серверный logout не подтверждён: {error}"));
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    /// Drops the Rust client and releases the encrypted database connection.
    /// It does not revoke the server session; call logout first when required.
    pub fn close(&self) -> Result<(), String> {
        let mut reservation = self
            .identity_reservation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let result = match self.client.lock() {
            Ok(mut guard) => {
                *guard = None;
                Ok(())
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = None;
                Err("MLS session lock was poisoned; client was dropped".to_string())
            }
        };
        reservation.take();
        result
    }
}

fn remove_database_files(database_path: &str) -> Result<(), String> {
    let mut errors = Vec::new();
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = format!("{database_path}{suffix}");
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!("удаление локальной MLS-базы {path}: {error}")),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn database_artifacts_exist(database_path: &str) -> bool {
    ["", "-wal", "-shm", "-journal"]
        .iter()
        .any(|suffix| Path::new(&format!("{database_path}{suffix}")).exists())
}

fn cleanup_local_session_with_key_store(
    database_path: &str,
    identity_scope: &str,
    keys: Result<&dyn KeyStore, String>,
) -> Result<(), String> {
    // Delete the encrypted database even if the platform store cannot be
    // initialized. A remaining protected key is reported so cleanup can be
    // retried, but a transient Keystore/Keychain failure must not preserve
    // decrypted local history on disk.
    let database_result = remove_database_files(database_path);
    let key_result = match keys {
        Ok(keys) => keys.delete_database_key(identity_scope),
        Err(error) => Err(format!("инициализация защищённого хранилища: {error}")),
    };
    let mut errors = Vec::new();
    if let Err(error) = database_result {
        errors.push(error);
    }
    if let Err(error) = key_result {
        errors.push(format!("удаление ключа SQLCipher: {error}"));
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn cleanup_local_session(
    database_path: &str,
    identity_scope: &str,
    keys: &dyn KeyStore,
) -> Result<(), String> {
    cleanup_local_session_with_key_store(database_path, identity_scope, Ok(keys))
}

/// Adopt a session created by Flutter, or restore the encrypted session through `resume_session`.
/// The refresh token is passed into Rust
/// once and is not returned by any method on MlsSession.
pub fn open_session(
    base_url: String,
    user_id: String,
    device_id: String,
    access_token: String,
    refresh_token: String,
    database_directory: String,
) -> Result<MlsSession, String> {
    let access_token = Zeroizing::new(access_token);
    let refresh_token = Zeroizing::new(refresh_token);
    let identity = validated_identity(&user_id, &device_id)?;
    let reservation = reserve_identity(&identity)?;
    let database_directory = normalized_database_directory(&database_directory, true)?;
    let database_path = database_path_for_identity(&database_directory, &identity);
    let keys: Arc<dyn KeyStore> = Arc::new(PlatformKeyStore::new()?);
    let has_existing_key = keys.has_database_key(&identity)?;
    let database_existed = database_artifacts_exist(&database_path);
    if database_existed && !has_existing_key {
        return Err(
            "файл SQLCipher существует, но защищённый ключ отсутствует; автоматическая генерация нового ключа запрещена, требуется явное восстановление"
                .to_string(),
        );
    }
    let client = match connect_with_session(
        &base_url,
        &user_id,
        &device_id,
        access_token.as_str(),
        refresh_token.as_str(),
        &database_path,
        keys.as_ref(),
    ) {
        Ok(client) => client,
        Err(error) => {
            if !has_existing_key && !database_existed {
                if let Err(cleanup_error) =
                    cleanup_local_session(&database_path, &identity, keys.as_ref())
                {
                    return Err(format!(
                        "{error}; очистка частично созданной MLS-сессии не завершена: {cleanup_error}"
                    ));
                }
            }
            return Err(error);
        }
    };
    Ok(MlsSession {
        client: Mutex::new(Some(client)),
        database_path,
        identity_scope: identity,
        keys,
        identity_reservation: Mutex::new(Some(reservation)),
    })
}

/// Resume a previously adopted session from the encrypted SQLCipher database.
/// Flutter supplies no access or refresh token on this path.
pub fn resume_session(
    base_url: String,
    user_id: String,
    device_id: String,
    database_directory: String,
) -> Result<MlsSession, String> {
    let identity = validated_identity(&user_id, &device_id)?;
    let reservation = reserve_identity(&identity)?;
    let database_directory = normalized_database_directory(&database_directory, false)?;
    let database_path = database_path_for_identity(&database_directory, &identity);
    let keys: Arc<dyn KeyStore> = Arc::new(PlatformKeyStore::new()?);
    let client = resume_with_session(
        &base_url,
        &user_id,
        &device_id,
        &database_path,
        keys.as_ref(),
    )?;
    Ok(MlsSession {
        client: Mutex::new(Some(client)),
        database_path,
        identity_scope: identity,
        keys,
        identity_reservation: Mutex::new(Some(reservation)),
    })
}

/// Purges an MLS database whose session could not be resumed. This is local
/// cleanup only; it does not claim that the server-side session was revoked.
pub fn purge_local_session(
    user_id: String,
    device_id: String,
    database_directory: String,
) -> Result<(), String> {
    let identity = validated_identity(&user_id, &device_id)?;
    let _reservation = reserve_identity(&identity)?;
    let database_directory = purge_database_directory(&database_directory)?;
    let database_path = database_path_for_identity(&database_directory, &identity);
    let platform_keys = PlatformKeyStore::new();
    let keys: Result<&dyn KeyStore, String> = match &platform_keys {
        Ok(keys) => Ok(keys),
        Err(error) => Err(error.clone()),
    };
    cleanup_local_session_with_key_store(&database_path, &identity, keys)
}

#[frb(init)]
pub fn init_app() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Default)]
    struct TestKeyStore {
        deleted: AtomicBool,
    }

    impl KeyStore for TestKeyStore {
        fn has_database_key(&self, _scope: &str) -> Result<bool, String> {
            Ok(true)
        }

        fn existing_database_key(&self, _scope: &str) -> Result<Option<[u8; 32]>, String> {
            Ok(Some([7u8; 32]))
        }

        fn database_key(&self, _scope: &str) -> Result<[u8; 32], String> {
            Ok([7u8; 32])
        }

        fn delete_database_key(&self, _scope: &str) -> Result<(), String> {
            self.deleted.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    fn fixture() -> (std::path::PathBuf, Arc<TestKeyStore>, MlsSession) {
        let root = std::env::temp_dir().join(format!(
            "inone-mls-session-lifecycle-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        std::fs::create_dir_all(&root).unwrap();
        let database = root.join("device.sqlcipher");
        std::fs::write(&database, b"encrypted-database-fixture").unwrap();
        std::fs::write(format!("{}-wal", database.display()), b"wal").unwrap();
        std::fs::write(format!("{}-shm", database.display()), b"shm").unwrap();
        std::fs::write(format!("{}-journal", database.display()), b"journal").unwrap();
        let keys = Arc::new(TestKeyStore::default());
        let identity_scope = format!("user/{}", root.file_name().unwrap().to_string_lossy());
        let reservation = reserve_identity(&identity_scope).unwrap();
        let session = MlsSession {
            client: Mutex::new(None),
            database_path: database.to_string_lossy().into_owned(),
            identity_scope,
            keys: keys.clone(),
            identity_reservation: Mutex::new(Some(reservation)),
        };
        (database, keys, session)
    }

    #[test]
    fn duplicate_active_identity_reservation_is_rejected_until_release() {
        let identity = "user/device-a1-reservation";
        let first = reserve_identity(identity).unwrap();
        assert!(reserve_identity(identity).is_err());
        drop(first);
        assert!(reserve_identity(identity).is_ok());
    }

    #[test]
    fn concurrent_reservations_allow_only_one_live_client_per_identity() {
        use std::sync::{mpsc, Barrier};

        let identity = "user/device-a1-concurrent-reservation";
        let start = Arc::new(Barrier::new(3));
        let release_winner = Arc::new(Barrier::new(2));
        let (tx, rx) = mpsc::channel();

        let mut handles = Vec::new();
        for _ in 0..2 {
            let start = start.clone();
            let release_winner = release_winner.clone();
            let tx = tx.clone();
            handles.push(std::thread::spawn(move || {
                start.wait();
                let reservation = reserve_identity(identity);
                let won = reservation.is_ok();
                tx.send(won).unwrap();
                if let Ok(reservation) = reservation {
                    release_winner.wait();
                    drop(reservation);
                }
            }));
        }
        drop(tx);
        start.wait();
        let outcomes = [rx.recv().unwrap(), rx.recv().unwrap()];
        assert_eq!(outcomes.iter().filter(|won| **won).count(), 1);
        release_winner.wait();
        for handle in handles {
            handle.join().unwrap();
        }
    }

    #[test]
    fn identity_and_database_directory_inputs_fail_closed() {
        assert!(validated_identity("", "device").is_err());
        assert!(validated_identity("user", "device/other").is_err());
        assert!(validated_identity("user/with/slash", "device").is_ok());
        assert!(normalized_database_directory("relative/path", true).is_err());
    }

    #[test]
    fn purge_can_delete_protected_key_when_database_directory_is_missing() {
        let root = std::env::temp_dir().join(format!(
            "inone-mls-missing-purge-dir-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let missing_directory = root.join("missing");
        let normalized = purge_database_directory(&missing_directory.to_string_lossy()).unwrap();
        let expected = missing_directory.to_string_lossy().into_owned();
        assert_eq!(normalized, expected);

        let identity = "user/missing-directory-purge";
        let database_path = database_path_for_identity(&normalized, identity);
        let keys = TestKeyStore::default();
        cleanup_local_session(&database_path, identity, &keys).unwrap();
        assert!(keys.deleted.load(Ordering::SeqCst));
        assert!(!missing_directory.exists());
    }

    #[test]
    fn database_artifacts_include_all_sqlite_sidecars() {
        let root = std::env::temp_dir().join(format!(
            "inone-mls-artifact-check-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let database = root.join("device.sqlcipher").to_string_lossy().into_owned();
        assert!(!database_artifacts_exist(&database));
        std::fs::write(format!("{database}-wal"), b"wal").unwrap();
        assert!(database_artifacts_exist(&database));
        remove_database_files(&database).unwrap();
        assert!(!database_artifacts_exist(&database));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn logout_still_cleans_local_state_when_client_lock_is_poisoned() {
        let (database, keys, session) = fixture();
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| {
                let _guard = session.client.lock().unwrap();
                panic!("poison the client lock for the regression test");
            });
            assert!(handle.join().is_err());
        });

        assert!(session.logout().is_err());
        assert!(!database.exists());
        assert!(!std::path::PathBuf::from(format!("{}-wal", database.display())).exists());
        assert!(keys.deleted.load(Ordering::SeqCst));
    }

    #[test]
    fn logout_removes_database_sidecars_and_platform_key() {
        let (database, keys, session) = fixture();
        session.logout().unwrap();
        assert!(reserve_identity(&session.identity_scope).is_ok());
        assert!(!database.exists());
        assert!(!std::path::PathBuf::from(format!("{}-wal", database.display())).exists());
        assert!(!std::path::PathBuf::from(format!("{}-shm", database.display())).exists());
        assert!(!std::path::PathBuf::from(format!("{}-journal", database.display())).exists());
        assert!(keys.deleted.load(Ordering::SeqCst));
    }

    #[test]
    fn logout_attempts_key_deletion_even_when_database_file_cannot_be_removed() {
        let (database, keys, session) = fixture();
        std::fs::remove_file(&database).unwrap();
        std::fs::create_dir(&database).unwrap();

        let result = session.logout();

        assert!(
            result.is_err(),
            "the directory at the database path cannot be removed as a file"
        );
        assert!(
            keys.deleted.load(Ordering::SeqCst),
            "the platform key must still be deleted when database cleanup fails"
        );
        std::fs::remove_dir(&database).unwrap();
    }

    #[test]
    fn close_releases_handle_without_deleting_persistent_session() {
        let (database, keys, session) = fixture();
        session.close().unwrap();
        assert!(reserve_identity(&session.identity_scope).is_ok());
        assert!(database.exists());
        assert!(!keys.deleted.load(Ordering::SeqCst));
        let _ = std::fs::remove_file(&database);
        let _ = std::fs::remove_file(format!("{}-wal", database.display()));
        let _ = std::fs::remove_file(format!("{}-shm", database.display()));
        let _ = std::fs::remove_file(format!("{}-journal", database.display()));
    }
    #[test]
    fn logout_after_close_cannot_purge_a_newer_session() {
        let (database, _keys, session) = fixture();
        session.close().unwrap();
        assert!(database.exists());
        assert!(session.logout().is_err());
        assert!(database.exists());
    }

    #[test]
    fn purge_removes_database_even_when_platform_key_store_initialization_fails() {
        let (database, keys, _session) = fixture();
        let database_path = database.to_string_lossy().into_owned();

        let result = cleanup_local_session_with_key_store(
            &database_path,
            "user/device",
            Err("protected store unavailable".to_string()),
        );

        let error = result.expect_err("key deletion must remain explicitly unconfirmed");
        assert!(error.contains("protected store unavailable"));
        assert!(
            !database.exists(),
            "encrypted database must still be removed"
        );
        for suffix in ["-wal", "-shm", "-journal"] {
            assert!(
                !std::path::PathBuf::from(format!("{}{}", database.display(), suffix)).exists(),
                "SQLite sidecar {suffix} must also be removed"
            );
        }
        assert!(
            !keys.deleted.load(Ordering::SeqCst),
            "a failed platform-store initialization cannot claim key deletion"
        );
    }
}
