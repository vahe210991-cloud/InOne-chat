use std::sync::{Mutex, OnceLock};

use zeroize::Zeroize;

use keyring_core::{Entry, Error as KeyringError};
use mls_client::KeyStore;

/// Production database-key storage. The key is read and written entirely
/// inside Rust through Android Keystore-backed storage or Apple's protected
/// Keychain store; it is never passed to Dart.
static KEY_STORE_LOCK: Mutex<()> = Mutex::new(());

pub struct PlatformKeyStore {
    _private: (),
}

impl PlatformKeyStore {
    pub fn new() -> Result<Self, String> {
        crate::ensure_android_context_initialized()?;
        initialize_native_store()?;
        Ok(Self { _private: () })
    }
}

impl KeyStore for PlatformKeyStore {
    fn has_database_key(&self, scope: &str) -> Result<bool, String> {
        let entry = Entry::new("com.inone.mls.sqlcipher-key", scope)
            .map_err(|error| format!("создание записи защищённого хранилища: {error}"))?;
        match entry.get_secret() {
            Ok(mut secret) => {
                secret.zeroize();
                Ok(true)
            }
            Err(KeyringError::NoEntry) => Ok(false),
            Err(error) => Err(format!("чтение ключа SQLCipher: {error}")),
        }
    }

    fn existing_database_key(&self, scope: &str) -> Result<Option<[u8; 32]>, String> {
        let entry = Entry::new("com.inone.mls.sqlcipher-key", scope)
            .map_err(|error| format!("создание записи защищённого хранилища: {error}"))?;
        match entry.get_secret() {
            Ok(mut secret) => {
                let key = secret
                    .as_slice()
                    .try_into()
                    .map(Some)
                    .map_err(|_| "ключ SQLCipher в системном хранилище имеет неверную длину".to_string());
                secret.zeroize();
                key
            }
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(format!("чтение ключа SQLCipher: {error}")),
        }
    }

    fn database_key(&self, scope: &str) -> Result<[u8; 32], String> {
        let _guard = KEY_STORE_LOCK
            .lock()
            .map_err(|error| format!("блокировка ключа SQLCipher: {error}"))?;
        if let Some(key) = self.existing_database_key(scope)? {
            return Ok(key);
        }

        let entry = Entry::new("com.inone.mls.sqlcipher-key", scope)
            .map_err(|error| format!("создание записи защищённого хранилища: {error}"))?;
        let mut key = [0u8; 32];
        getrandom::fill(&mut key)
            .map_err(|error| format!("генерация ключа SQLCipher: {error}"))?;
        if let Err(error) = entry.set_secret(&key) {
            key.zeroize();
            return Err(format!("сохранение ключа SQLCipher: {error}"));
        }
        Ok(key)
    }

    fn delete_database_key(&self, scope: &str) -> Result<(), String> {
        let _guard = KEY_STORE_LOCK
            .lock()
            .map_err(|error| format!("блокировка ключа SQLCipher: {error}"))?;
        let entry = Entry::new("com.inone.mls.sqlcipher-key", scope)
            .map_err(|error| format!("создание записи защищённого хранилища: {error}"))?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!("удаление ключа SQLCipher из системного хранилища: {error}")),
        }
    }
}

fn initialize_native_store() -> Result<(), String> {
    static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();
    INITIALIZED
        .get_or_init(|| {
            #[cfg(target_os = "android")]
            {
                let store = android_native_keyring_store::by_store::Store::new()
                    .map_err(|error| format!("Android Keystore недоступен: {error}"))?;
                keyring_core::set_default_store(store);
                Ok(())
            }

            #[cfg(target_os = "ios")]
            {
                let store = apple_native_keyring_store::protected::Store::new()
                    .map_err(|error| format!("iOS Keychain недоступен: {error}"))?;
                keyring_core::set_default_store(store);
                Ok(())
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                Err("защищённое хранилище MLS доступно только на Android и iOS".to_string())
            }
        })
        .clone()
}
