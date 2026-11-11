use std::path::Path;
use std::sync::{Arc, Mutex};

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
    },
    Unreadable {
        room_id: String,
        event_id: String,
    },
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

    pub fn send_text(&self, room_id: String, plaintext: String) -> Result<String, String> {
        self.with_client(|client| client.send_text(&room_id, &plaintext))
    }

    pub fn enqueue_text(&self, room_id: String, plaintext: String) -> Result<String, String> {
        self.with_client(|client| client.enqueue_text(&room_id, &plaintext))
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

    /// Returns encrypted local inbox history for a room.
    pub fn messages_for_room_json(&self, room_id: String) -> Result<String, String> {
        let items = self.with_client(|client| client.messages_for_room(&room_id).map(map_incoming))?;
        serde_json::to_string(&items).map_err(|error| error.to_string())
    }

    /// Removes inbox entries only after the app confirms durable acceptance.
    pub fn acknowledge_incoming(&self, event_ids: Vec<String>) -> Result<(), String> {
        self.with_client(|client| client.acknowledge_incoming(&event_ids))
    }

    pub fn outbox_len(&self) -> Result<u64, String> {
        self.with_client(Client::outbox_len)
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
        let remote_result = {
            let mut guard = self.client.lock().map_err(|error| error.to_string())?;
            let result = match guard.as_ref() {
                Some(client) => client.logout(),
                None => Ok(()),
            };
            *guard = None;
            result
        };

        remove_database_files(&self.database_path)?;
        self.keys.delete_database_key(&self.identity_scope)?;
        remote_result.map_err(|error| format!("серверный logout не подтверждён; локальные MLS-данные удалены: {error}"))
    }

    /// Drops the Rust client and releases the encrypted database connection.
    /// It does not revoke the server session; call logout first when required.
    pub fn close(&self) -> Result<(), String> {
        let mut guard = self.client.lock().map_err(|error| error.to_string())?;
        *guard = None;
        Ok(())
    }
}

fn remove_database_files(database_path: &str) -> Result<(), String> {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = format!("{database_path}{suffix}");
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("удаление локальной MLS-базы {path}: {error}")),
        }
    }
    Ok(())
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
    let keys: Arc<dyn KeyStore> = Arc::new(PlatformKeyStore::new()?);
    std::fs::create_dir_all(&database_directory)
        .map_err(|error| format!("создание каталога базы MLS: {error}"))?;
    let identity = format!("{user_id}/{device_id}");
    let digest = Sha256::digest(identity.as_bytes());
    let filename = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let database_path = Path::new(&database_directory)
        .join(format!("{filename}.sqlcipher"))
        .to_string_lossy()
        .into_owned();
    let client = connect_with_session(
        &base_url,
        &user_id,
        &device_id,
        &access_token,
        &refresh_token,
        &database_path,
        keys.as_ref(),
    )?;
    Ok(MlsSession {
        client: Mutex::new(Some(client)),
        database_path,
        identity_scope: identity,
        keys,
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
    let keys: Arc<dyn KeyStore> = Arc::new(PlatformKeyStore::new()?);
    let identity = format!("{user_id}/{device_id}");
    let digest = Sha256::digest(identity.as_bytes());
    let filename = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let database_path = Path::new(&database_directory)
        .join(format!("{filename}.sqlcipher"))
        .to_string_lossy()
        .into_owned();
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
}


/// Purges an MLS database whose session could not be resumed. This is local
/// cleanup only; it does not claim that the server-side session was revoked.
pub fn purge_local_session(
    user_id: String,
    device_id: String,
    database_directory: String,
) -> Result<(), String> {
    if user_id.trim().is_empty() || device_id.trim().is_empty() {
        return Err("user_id и device_id обязательны для очистки MLS-сессии".to_string());
    }
    let identity = format!("{user_id}/{device_id}");
    let digest = Sha256::digest(identity.as_bytes());
    let filename = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let database_path = Path::new(&database_directory)
        .join(format!("{filename}.sqlcipher"))
        .to_string_lossy()
        .into_owned();
    remove_database_files(&database_path)?;
    let keys = PlatformKeyStore::new()?;
    keys.delete_database_key(&identity)
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
}
