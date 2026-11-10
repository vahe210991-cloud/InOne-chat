use std::path::Path;
use std::sync::Mutex;

use sha2::{Digest, Sha256};

use flutter_rust_bridge::frb;
use mls_client::{connect_with_session, Client, Incoming, KeyStore};

use crate::secure_store::PlatformKeyStore;

/// Rust-owned persistent OpenMLS session. The refresh token and SQLCipher
/// database key never have getters in the Dart-facing API.
#[frb(opaque)]
pub struct MlsSession {
    client: Mutex<Option<Client>>,
}

#[derive(Clone, Debug, PartialEq)]
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

    pub fn take_incoming(&self) -> Result<Vec<IncomingMessage>, String> {
        self.with_client(|client| Ok(map_incoming(client.take_incoming())))
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

    pub fn logout(&self) -> Result<(), String> {
        self.with_client(|client| client.logout())
    }

    /// Drops the Rust client and releases the encrypted database connection.
    /// It does not revoke the server session; call logout first when required.
    pub fn close(&self) -> Result<(), String> {
        let mut guard = self.client.lock().map_err(|error| error.to_string())?;
        *guard = None;
        Ok(())
    }
}

/// Adopt a session created by Flutter. The refresh token is passed into Rust
/// once and is not returned by any method on MlsSession.
pub fn open_session(
    base_url: String,
    user_id: String,
    device_id: String,
    access_token: String,
    refresh_token: String,
    database_directory: String,
) -> Result<MlsSession, String> {
    let keys = PlatformKeyStore::new()?;
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
        &keys,
    )?;
    Ok(MlsSession {
        client: Mutex::new(Some(client)),
    })
}

#[frb(init)]
pub fn init_app() {}
