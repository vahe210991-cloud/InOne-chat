//! MLS attachment AEAD primitives.
//!
//! The file key and nonce belong only in the MLS-encrypted manifest. Never
//! send this manifest as plaintext metadata to the file service. The backend
//! receives ciphertext bytes and their SHA-256 only.
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

const MANIFEST_VERSION: u64 = 1;
const GCM_NONCE_LEN: usize = 12;
const AES256_KEY_LEN: usize = 32;
const GCM_TAG_LEN: usize = 16;
const MAX_MANIFEST_SIZE: usize = 4 * 1024;
const MAX_FILE_SIZE: u64 = 250 * 1024 * 1024 - GCM_TAG_LEN as u64;

/// Encrypt bytes with a fresh per-file AES-256-GCM key and nonce supplied by
/// the caller's CSPRNG (the MLS provider's random source).
pub fn encrypt(
    plaintext: &[u8],
    key: &[u8; AES256_KEY_LEN],
    nonce: &[u8; GCM_NONCE_LEN],
    room_id: &str,
) -> Result<Vec<u8>, String> {
    validate_identity(room_id, "roomId")?;
    if plaintext.is_empty() || plaintext.len() as u64 > MAX_FILE_SIZE {
        return Err("attachment size must be between 1 byte and 250 MiB".to_string());
    }
    let aad = associated_data(room_id, plaintext.len() as u64);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "invalid attachment key")?;
    cipher
        .encrypt(Nonce::from_slice(nonce), Payload { msg: plaintext, aad: &aad })
        .map_err(|_| "attachment encryption failed".to_string())
}

/// Build the versioned manifest payload. The caller MUST pass the returned
/// bytes to OpenMLS create_message; they must never be sent as plaintext JSON.
pub fn build_manifest(
    file_id: &str,
    room_id: &str,
    name: &str,
    mime_type: &str,
    plaintext: &[u8],
    ciphertext: &[u8],
    key: &[u8; AES256_KEY_LEN],
    nonce: &[u8; GCM_NONCE_LEN],
) -> Result<Vec<u8>, String> {
    validate_identity(file_id, "fileId")?;
    validate_identity(room_id, "roomId")?;
    if plaintext.is_empty() || plaintext.len() as u64 > MAX_FILE_SIZE {
        return Err("attachment size must be between 1 byte and 250 MiB".to_string());
    }
    if ciphertext.len() != plaintext.len() + GCM_TAG_LEN {
        return Err("ciphertext length does not match AES-GCM payload".to_string());
    }
    if name.is_empty() || name.len() > 255 || name.chars().any(char::is_control)
        || name.contains('/') || name.contains('\\')
    {
        return Err("invalid attachment display name".to_string());
    }
    if mime_type.is_empty() || mime_type.len() > 127 || mime_type.chars().any(char::is_control) {
        return Err("invalid attachment MIME type".to_string());
    }
    let verified_ciphertext = encrypt(plaintext, key, nonce, room_id)?;
    if verified_ciphertext.as_slice() != ciphertext {
        return Err("ciphertext does not match the supplied plaintext/key/nonce".to_string());
    }
    let mut payload = json!({
        "type": "inone.attachment",
        "version": MANIFEST_VERSION,
        "fileId": file_id,
        "roomId": room_id,
        "name": name,
        "mimeType": mime_type,
        "size": plaintext.len() as u64,
        "ciphertextSize": ciphertext.len() as u64,
        "sha256": sha256_hex(plaintext),
        "ciphertextSha256": sha256_hex(ciphertext),
        "key": B64.encode(key),
        "nonce": B64.encode(nonce),
    });
    let encoded = serde_json::to_vec(&payload).map_err(|error| error.to_string());
    zeroize_json_value(&mut payload);
    encoded
}

/// A validated manifest. Key material is zeroized when this value is dropped.
pub struct AttachmentManifestV1 {
    pub file_id: String,
    pub room_id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub ciphertext_size: u64,
    pub sha256: String,
    pub ciphertext_sha256: String,
    pub(super) key: [u8; AES256_KEY_LEN],
    pub(super) nonce: [u8; GCM_NONCE_LEN],
}

impl Drop for AttachmentManifestV1 {
    fn drop(&mut self) {
        self.key.zeroize();
        self.nonce.zeroize();
    }
}

/// Detect attachment payloads even when the outer event forgot its file reference.
/// The parsed JSON (which may contain a base64 file key) is zeroized on every path.
pub fn is_attachment_manifest(payload: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<Value>(payload) else {
        return false;
    };
    let guarded = ZeroizingJson(value);
    guarded.0.get("type").and_then(Value::as_str) == Some("inone.attachment")
}

/// Parse only a supported manifest and bind it to the outer event's file ID
/// and room. This prevents swapping a valid manifest between file events.
pub fn parse_manifest(
    payload: &[u8],
    expected_file_id: &str,
    expected_room_id: &str,
) -> Result<AttachmentManifestV1, String> {
    let mut guarded_value = ZeroizingJson(
        serde_json::from_slice(payload)
            .map_err(|_| "attachment manifest is not valid JSON".to_string())?
    );
    let value = &mut guarded_value.0;
    let string = |key: &str| -> Result<String, String> {
        value.get(key).and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("attachment manifest field {key} is missing or invalid"))
    };
    if value.get("type").and_then(Value::as_str) != Some("inone.attachment")
        || value.get("version").and_then(Value::as_u64) != Some(MANIFEST_VERSION)
    {
        return Err("unsupported attachment manifest type or version".to_string());
    }
    let file_id = string("fileId")?;
    let room_id = string("roomId")?;
    validate_identity(&file_id, "fileId")?;
    validate_identity(&room_id, "roomId")?;
    if file_id != expected_file_id || room_id != expected_room_id {
        return Err("attachment manifest does not match outer file/room binding".to_string());
    }
    let name = string("name")?;
    let mime_type = string("mimeType")?;
    if name.is_empty() || name.len() > 255 || name.chars().any(char::is_control)
        || name.contains('/') || name.contains('\\')
    {
        return Err("invalid attachment display name".to_string());
    }
    if mime_type.is_empty() || mime_type.len() > 127 || mime_type.chars().any(char::is_control) {
        return Err("invalid attachment MIME type".to_string());
    }
    let size = value.get("size").and_then(Value::as_u64)
        .filter(|size| *size > 0 && *size <= MAX_FILE_SIZE)
        .ok_or_else(|| "invalid attachment plaintext size".to_string())?;
    let ciphertext_size = value.get("ciphertextSize").and_then(Value::as_u64)
        .filter(|actual| *actual == size + GCM_TAG_LEN as u64)
        .ok_or_else(|| "invalid attachment ciphertext size".to_string())?;
    let sha256 = string("sha256")?;
    let ciphertext_sha256 = string("ciphertextSha256")?;
    validate_hash(&sha256)?;
    validate_hash(&ciphertext_sha256)?;
    let encoded_key = Zeroizing::new(string("key")?);
    let key_bytes = Zeroizing::new(
        B64.decode(encoded_key.as_bytes()).map_err(|_| "invalid attachment key encoding")?
    );
    let nonce_bytes = Zeroizing::new(
        B64.decode(string("nonce")?).map_err(|_| "invalid attachment nonce encoding")?
    );
    let key: [u8; AES256_KEY_LEN] = key_bytes.as_slice().try_into()
        .map_err(|_| "attachment key must be exactly 32 bytes")?;
    let nonce: [u8; GCM_NONCE_LEN] = nonce_bytes.as_slice().try_into()
        .map_err(|_| "attachment nonce must be exactly 12 bytes")?;
    Ok(AttachmentManifestV1 {
        file_id, room_id, name, mime_type, size, ciphertext_size,
        sha256, ciphertext_sha256, key, nonce,
    })
}

/// Verify ciphertext integrity and decrypt. The AEAD tag authenticates the
/// room-bound associated data; hashes detect truncation/corruption before use.
pub fn decrypt(
    ciphertext: &[u8],
    manifest: &AttachmentManifestV1,
) -> Result<Vec<u8>, String> {
    if ciphertext.len() as u64 != manifest.ciphertext_size
        || sha256_hex(ciphertext) != manifest.ciphertext_sha256
    {
        return Err("attachment ciphertext integrity check failed".to_string());
    }
    let aad = associated_data(&manifest.room_id, manifest.size);
    let cipher = Aes256Gcm::new_from_slice(&manifest.key)
        .map_err(|_| "invalid attachment key")?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(Nonce::from_slice(&manifest.nonce), Payload { msg: ciphertext, aad: &aad })
            .map_err(|_| "attachment authentication failed".to_string())?
    );
    if plaintext.len() as u64 != manifest.size || sha256_hex(&plaintext) != manifest.sha256 {
        return Err("attachment plaintext integrity check failed".to_string());
    }
    Ok(plaintext.to_vec())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn associated_data(room_id: &str, plaintext_size: u64) -> Vec<u8> {
    let mut aad = b"inone-attachment-aead-v1\0".to_vec();
    aad.extend_from_slice(&(room_id.len() as u64).to_be_bytes());
    aad.extend_from_slice(room_id.as_bytes());
    aad.extend_from_slice(&plaintext_size.to_be_bytes());
    aad
}

struct ZeroizingJson(Value);

impl Drop for ZeroizingJson {
    fn drop(&mut self) {
        zeroize_json_value(&mut self.0);
    }
}

fn zeroize_json_value(value: &mut Value) {
    match value {
        Value::String(value) => value.zeroize(),
        Value::Array(values) => {
            for value in values { zeroize_json_value(value); }
        }
        Value::Object(values) => {
            for value in values.values_mut() { zeroize_json_value(value); }
        }
        _ => {}
    }
}

fn validate_identity(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(format!("invalid attachment {field}"));
    }
    Ok(())
}

fn validate_hash(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
        return Err("attachment hash must be 64 lowercase hexadecimal characters".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Vec<u8>, [u8; 32], [u8; 12], Vec<u8>) {
        let plaintext = b"confidential attachment bytes".to_vec();
        let key = [0x42; 32];
        let nonce = [0x24; 12];
        let ciphertext = encrypt(&plaintext, &key, &nonce, "room-1").unwrap();
        (plaintext, key, nonce, ciphertext)
    }

    #[test]
    fn encrypted_manifest_round_trip_binds_file_and_room() {
        let (plaintext, key, nonce, ciphertext) = fixture();
        let payload = build_manifest(
            "file-1", "room-1", "document.pdf", "application/pdf",
            &plaintext, &ciphertext, &key, &nonce,
        ).unwrap();
        let manifest = parse_manifest(&payload, "file-1", "room-1").unwrap();
        assert_eq!(decrypt(&ciphertext, &manifest).unwrap(), plaintext);
    }

    #[test]
    fn manifest_rejects_outer_file_or_room_mismatch() {
        let (plaintext, key, nonce, ciphertext) = fixture();
        let payload = build_manifest(
            "file-1", "room-1", "document.pdf", "application/pdf",
            &plaintext, &ciphertext, &key, &nonce,
        ).unwrap();
        assert!(parse_manifest(&payload, "file-2", "room-1").is_err());
        assert!(parse_manifest(&payload, "file-1", "room-2").is_err());
    }

    #[test]
    fn ciphertext_tampering_and_wrong_room_fail_closed() {
        let (plaintext, key, nonce, mut ciphertext) = fixture();
        let payload = build_manifest(
            "file-1", "room-1", "document.pdf", "application/pdf",
            &plaintext, &ciphertext, &key, &nonce,
        ).unwrap();
        let manifest = parse_manifest(&payload, "file-1", "room-1").unwrap();
        ciphertext[0] ^= 0x01;
        assert!(decrypt(&ciphertext, &manifest).is_err());
        let wrong_room_ciphertext = encrypt(&plaintext, &key, &nonce, "room-2").unwrap();
        assert!(decrypt(&wrong_room_ciphertext, &manifest).is_err());
    }
}
