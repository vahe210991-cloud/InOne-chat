use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::{Arc, Mutex};

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
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IncomingMessage {
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

/// Convert an unexpected Rust panic into a stable FFI error. Never expose panic
/// payloads because they may contain request or credential data.
fn ffi_guard<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(operation))
        .unwrap_or_else(|_| Err("panic inside native MLS boundary; operation aborted".to_string()))
}

/// Resolve the app-private database directory once and derive a deterministic,
/// identity-scoped database filename. Canonicalization prevents later path
/// interpretation from depending on a relative path or unresolved components.
fn prepare_database_path(
    database_directory: &str,
    user_id: &str,
    device_id: &str,
) -> Result<(String, String), String> {
    if user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("user_id и device_id обязательны".to_string());
    }
    if database_directory.trim().is_empty() {
        return Err("каталог базы MLS не задан".to_string());
    }
    std::fs::create_dir_all(database_directory)
        .map_err(|error| format!("создание каталога базы MLS: {error}"))?;
    let directory = std::fs::canonicalize(database_directory)
        .map_err(|error| format!("нормализация каталога базы MLS: {error}"))?;
    let metadata = std::fs::metadata(&directory)
        .map_err(|error| format!("проверка каталога базы MLS: {error}"))?;
    if !metadata.is_dir() || !directory.is_absolute() {
        return Err("каталог базы MLS должен быть абсолютным каталогом приложения".to_string());
    }

    let identity = format!("{user_id}/{device_id}");
    let digest = Sha256::digest(identity.as_bytes());
    let filename = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let database_path = directory
        .join(format!("{filename}.sqlcipher"))
        .to_string_lossy()
        .into_owned();
    Ok((identity, database_path))
}

fn map_incoming(items: Vec<Incoming>) -> Vec<IncomingMessage> {
    items
        .into_iter()
        .map(|item| match item {
            Incoming::Text {
                room_id,
                event_id,
                text,
                mine,
            } => IncomingMessage::Text {
                room_id,
                event_id,
                text,
                mine,
            },
            Incoming::Attachment {
                room_id,
                event_id,
                file_id,
                name,
                mime_type,
                size,
                mine,
            } => IncomingMessage::Attachment {
                room_id,
                event_id,
                file_id,
                name,
                mime_type,
                size,
                mine,
            },
            Incoming::Unreadable {
                room_id,
                event_id,
                mine,
            } => IncomingMessage::Unreadable {
                room_id,
                event_id,
                mine,
            },
        })
        .collect()
}

impl MlsSession {
    fn with_client<T>(
        &self,
        operation: impl FnOnce(&mut Client) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = match self.client.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = None;
                self.client.clear_poison();
                return Err(
                    "MLS session lock was poisoned; session closed and must be reopened"
                        .to_string(),
                );
            }
        };
        let client = guard
            .as_mut()
            .ok_or_else(|| "MLS session is closed".to_string())?;
        match catch_unwind(AssertUnwindSafe(|| operation(client))) {
            Ok(result) => result,
            Err(_) => {
                // A panic may leave OpenMLS or its persistence transaction in an
                // unknown state. Fail closed instead of reusing a possibly damaged client.
                *guard = None;
                Err(
                    "panic inside native MLS operation; session closed and must be reopened"
                        .to_string(),
                )
            }
        }
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
        self.with_client(|client| client.send_text(&room_id, &plaintext))
    }

    pub fn enqueue_text(&self, room_id: String, plaintext: String) -> Result<String, String> {
        self.with_client(|client| client.enqueue_text(&room_id, &plaintext))
    }

    /// Encrypts and uploads an attachment through the persistent MLS client.
    /// File bytes are encrypted before upload; the manifest/key travel only inside MLS.
    pub fn send_attachment(
        &self,
        room_id: String,
        name: String,
        mime_type: String,
        plaintext: Vec<u8>,
    ) -> Result<String, String> {
        let plaintext = Zeroizing::new(plaintext);
        self.with_client(|client| {
            client.send_attachment(&room_id, &name, &mime_type, plaintext.as_slice())
        })
    }

    /// Downloads ciphertext and decrypts it only after manifest and AEAD validation.
    pub fn download_attachment(&self, file_id: String) -> Result<Vec<u8>, String> {
        self.with_client(|client| client.download_attachment(&file_id))
    }

    pub fn sync(&self) -> Result<Vec<IncomingMessage>, String> {
        self.with_client(|client| client.sync().map(map_incoming))
    }

    /// JSON form keeps the Dart API stable without exposing MLS internals.
    pub fn sync_json(&self) -> Result<String, String> {
        let items = self.sync()?;
        serde_json::to_string(&items).map_err(|error| error.to_string())
    }

    /// Returns pending decrypted messages without consuming them.
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

    pub fn pending_outbox_json(&self, room_id: String) -> Result<String, String> {
        self.with_client(|client| client.pending_outbox_for_room_json(&room_id))
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

        let cleanup_result = ffi_guard(|| {
            cleanup_local_session(
                &self.database_path,
                &self.identity_scope,
                self.keys.as_ref(),
            )
        });
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
        match self.client.lock() {
            Ok(mut guard) => {
                *guard = None;
                Ok(())
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = None;
                Err("MLS session lock was poisoned; client was dropped".to_string())
            }
        }
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
    ffi_guard(|| {
        let access_token = Zeroizing::new(access_token);
        let refresh_token = Zeroizing::new(refresh_token);
        let keys: Arc<dyn KeyStore> = Arc::new(PlatformKeyStore::new()?);
        let (identity, database_path) =
            prepare_database_path(&database_directory, &user_id, &device_id)?;
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
        })
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
    ffi_guard(|| {
        let keys: Arc<dyn KeyStore> = Arc::new(PlatformKeyStore::new()?);
        let (identity, database_path) =
            prepare_database_path(&database_directory, &user_id, &device_id)?;
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
        })
    })
}

/// Purges an MLS database whose session could not be resumed. This is local
/// cleanup only; it does not claim that the server-side session was revoked.
pub fn purge_local_session(
    user_id: String,
    device_id: String,
    database_directory: String,
) -> Result<(), String> {
    ffi_guard(|| {
        let (identity, database_path) =
            prepare_database_path(&database_directory, &user_id, &device_id)?;
        let platform_keys = PlatformKeyStore::new();
        let keys: Result<&dyn KeyStore, String> = match &platform_keys {
            Ok(keys) => Ok(keys),
            Err(error) => Err(error.clone()),
        };
        cleanup_local_session_with_key_store(&database_path, &identity, keys)
    })
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
        let session = MlsSession {
            client: Mutex::new(None),
            database_path: database.to_string_lossy().into_owned(),
            identity_scope: "user/device".to_string(),
            keys: keys.clone(),
        };
        (database, keys, session)
    }

    #[test]
    fn ffi_guard_converts_panics_to_non_sensitive_errors() {
        let result = ffi_guard::<()>(|| panic!("must not escape the FFI boundary"));
        let error = result.expect_err("panic must become an error");
        assert_eq!(error, "panic inside native MLS boundary; operation aborted");
    }

    #[test]
    fn database_path_is_canonical_and_identity_scoped() {
        let root = std::env::temp_dir().join(format!(
            "inone-mls-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let (identity, database) = prepare_database_path(
            root.to_string_lossy().as_ref(),
            "@alice:inone.test",
            "device-1",
        )
        .unwrap();
        assert_eq!(identity, "@alice:inone.test/device-1");
        assert!(Path::new(&database).is_absolute());
        assert!(Path::new(&database).parent().unwrap().is_dir());
        assert!(database.ends_with(".sqlcipher"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn database_path_rejects_empty_identity_and_directory() {
        assert!(prepare_database_path("", "alice", "device").is_err());
        assert!(prepare_database_path("/tmp/inone-mls", " ", "device").is_err());
        assert!(prepare_database_path("/tmp/inone-mls", "alice", "").is_err());
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
        assert!(database.exists());
        assert!(!keys.deleted.load(Ordering::SeqCst));
        let _ = std::fs::remove_file(&database);
        let _ = std::fs::remove_file(format!("{}-wal", database.display()));
        let _ = std::fs::remove_file(format!("{}-shm", database.display()));
        let _ = std::fs::remove_file(format!("{}-journal", database.display()));
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
