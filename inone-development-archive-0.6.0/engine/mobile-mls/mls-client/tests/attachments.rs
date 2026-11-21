use std::io::{BufRead, BufReader, Read};
use std::process::{Child, ChildStdin, Command, Stdio};

use mls_client::{connect, resume_with_session, Incoming, KeyStore, MemoryKeyStore};

const PW: &str = "пароль-вложений-1";
const ROOM: &str = "!room-attachments:inone.test";
const ALICE: &str = "@alice:inone.test";
const BOB: &str = "@bob:inone.test";

struct Engine {
    child: Child,
    stdin: Option<ChildStdin>,
    base: String,
}

fn start_engine() -> Engine {
    let mut child = Command::new("node")
        .arg("tests/engine/start-engine.mjs")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("start test engine");
    let stdin = child.stdin.take();
    let mut line = String::new();
    BufReader::new(child.stdout.take().expect("stdout"))
        .read_line(&mut line)
        .expect("engine URL");
    let base = line
        .trim()
        .strip_prefix("URL=")
        .expect("URL= line")
        .to_string();
    Engine { child, stdin, base }
}

impl Drop for Engine {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}

fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!(
        "inone-mls-attachment-{}-{name}.db",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    path.to_string_lossy().to_string()
}

fn open_encrypted_db(path: &str, key: &[u8; 32]) -> rusqlite::Connection {
    let connection = rusqlite::Connection::open(path).expect("open SQLCipher database");
    let key_hex = key
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    connection
        .pragma_update(None, "key", format!("x'{key_hex}'"))
        .expect("unlock SQLCipher database");
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("verify SQLCipher key");
    connection
}

fn attachments(items: &[Incoming]) -> Vec<(String, String, String, u64)> {
    items
        .iter()
        .filter_map(|item| match item {
            Incoming::Attachment {
                file_id,
                name,
                mime_type,
                size,
                ..
            } => Some((file_id.clone(), name.clone(), mime_type.clone(), *size)),
            _ => None,
        })
        .collect()
}

#[test]
fn attachment_retry_reuses_the_exact_mls_message_after_server_commit() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-retry");
    let bob_db = db("bob-retry");
    let mut alice = connect(&engine.base, ALICE, PW, "A_PHONE", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_PHONE", &bob_db, &keys).unwrap();

    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let plaintext = b"retry-safe confidential attachment".to_vec();
    let client_message_id = "attachment-retry-0001";
    let operation_id = format!("att_{client_message_id}");
    let database_key = keys
        .existing_database_key(&format!("{ALICE}/A_PHONE"))
        .unwrap()
        .expect("sender SQLCipher key");

    let connection = open_encrypted_db(&alice_db, &database_key);
    connection
        .execute_batch(
            "CREATE TRIGGER fail_outgoing_attachment_insert
         BEFORE INSERT ON client_attachments
         WHEN NEW.direction = 'outgoing'
         BEGIN
           SELECT RAISE(ABORT, 'simulated local persistence failure');
         END;",
        )
        .unwrap();
    drop(connection);

    // The server accepts the encrypted message, but the local commit is forced
    // to fail. The durable outbox must retain the exact MLS ciphertext.
    assert!(alice
        .send_attachment_with_id(
            ROOM,
            "retry.txt",
            "text/plain",
            &plaintext,
            client_message_id
        )
        .is_err());

    let read_persisted_message = || {
        let connection = open_encrypted_db(&alice_db, &database_key);
        connection
            .query_row(
                "SELECT mls_message FROM client_attachment_outbox WHERE client_message_id = ?1",
                [&operation_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .expect("persisted MLS message")
    };
    let first_message = read_persisted_message();
    assert!(!first_message.is_empty());

    // Close and reopen Rust: the exact MLS ciphertext and encrypted manifest
    // must survive process loss without depending on the original Dart handle.
    drop(alice);
    let mut alice = resume_with_session(&engine.base, ALICE, "A_PHONE", &alice_db, &keys).unwrap();

    // A second uncertain retry receives the server's original event ID. It
    // must not consume another sender ratchet generation or change the bytes.
    assert!(alice
        .send_attachment_with_id(
            ROOM,
            "retry.txt",
            "text/plain",
            &plaintext,
            client_message_id
        )
        .is_err());
    let second_message = read_persisted_message();
    assert_eq!(first_message, second_message);

    // After another restart, the native outbox can finish without the caller
    // re-supplying the file bytes; the ciphertext is already durable in SQLCipher.
    drop(alice);
    let connection = open_encrypted_db(&alice_db, &database_key);
    connection
        .execute_batch("DROP TRIGGER fail_outgoing_attachment_insert;")
        .unwrap();
    drop(connection);
    let mut alice = resume_with_session(&engine.base, ALICE, "A_PHONE", &alice_db, &keys).unwrap();
    assert_eq!(alice.flush_outbox().unwrap(), 1);
    assert_eq!(alice.outbox_len().unwrap(), 0);
    let resumed_handoff = alice.take_incoming();
    assert!(
        matches!(resumed_handoff.as_slice(), [Incoming::Attachment { mine: true, .. }]),
        "the sender's own recovered attachment must retain outgoing direction in the in-memory handoff"
    );
    let sender_history = alice.messages_for_room(ROOM).unwrap();
    let event_id = sender_history
        .iter()
        .find_map(|item| match item {
            Incoming::Attachment {
                event_id,
                mine: true,
                ..
            } => Some(event_id.clone()),
            _ => None,
        })
        .expect("sender attachment history after resumed outbox flush");
    let received = bob.sync().unwrap();
    assert_eq!(
        received
            .iter()
            .filter(|item| matches!(item, Incoming::Attachment { .. }))
            .count(),
        1
    );
    assert!(received
        .iter()
        .any(|item| matches!(item, Incoming::Attachment { event_id: id, .. } if id == &event_id)));

    alice
        .send_text(ROOM, "message after attachment retry")
        .unwrap();
    let after_retry = bob.sync().unwrap();
    assert!(after_retry.iter().any(|item| matches!(
        item,
        Incoming::Text { text, .. } if text == "message after attachment retry"
    )));
}

#[test]
fn attachment_is_mls_encrypted_uploaded_and_persisted_for_both_devices() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice");
    let bob_db = db("bob");

    let mut alice = connect(&engine.base, ALICE, PW, "A_PHONE", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_PHONE", &bob_db, &keys).unwrap();

    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let plaintext = b"private file payload: never upload these bytes in clear".to_vec();
    let event_id = alice
        .send_attachment_with_id(
            ROOM,
            "confidential.txt",
            "text/plain",
            &plaintext,
            "attachment-send-0001",
        )
        .unwrap();

    let received = bob.sync().unwrap();
    assert!(matches!(
        received.as_slice(),
        [Incoming::Attachment { mine: false, .. }]
    ));
    let received_attachments = attachments(&received);
    assert_eq!(received_attachments.len(), 1);
    let (file_id, name, mime_type, size) = &received_attachments[0];
    assert_eq!(name, "confidential.txt");
    assert_eq!(mime_type, "text/plain");
    assert_eq!(*size, plaintext.len() as u64);

    // The object service stores only AES-GCM ciphertext, never the source bytes.
    let alice_token = alice.access_token_snapshot().unwrap();
    let alice_auth = format!("Bearer {alice_token}");
    let alice_link = ureq::get(&format!("{}/files/{file_id}/url", engine.base))
        .set("authorization", &alice_auth)
        .call()
        .unwrap()
        .into_json::<serde_json::Value>()
        .unwrap();
    let alice_download_url = alice_link["downloadUrl"].as_str().unwrap();
    let mut uploaded_ciphertext = Vec::new();
    ureq::get(alice_download_url)
        .set("authorization", &alice_auth)
        .call()
        .unwrap()
        .into_reader()
        .read_to_end(&mut uploaded_ciphertext)
        .unwrap();
    assert_ne!(uploaded_ciphertext, plaintext);
    assert_eq!(uploaded_ciphertext.len(), plaintext.len() + 16);

    // A signed object URL obtained by another room member is still bound to
    // that member's device and cannot be replayed with this device's bearer.
    let bob_token = bob.access_token_snapshot().unwrap();
    let bob_auth = format!("Bearer {bob_token}");
    let bob_link = ureq::get(&format!("{}/files/{file_id}/url", engine.base))
        .set("authorization", &bob_auth)
        .call()
        .unwrap()
        .into_json::<serde_json::Value>()
        .unwrap();
    let bob_download_url = bob_link["downloadUrl"].as_str().unwrap();
    let cross_device = ureq::get(bob_download_url)
        .set("authorization", &alice_auth)
        .call();
    assert!(matches!(cross_device, Err(ureq::Error::Status(403, _))));

    assert_eq!(bob.download_attachment(file_id).unwrap(), plaintext);
    assert_eq!(alice.download_attachment(file_id).unwrap(), plaintext);

    let sender_messages = alice.messages_for_room(ROOM).unwrap();
    assert!(matches!(
        sender_messages.as_slice(),
        [Incoming::Attachment { mine: true, .. }]
    ));
    assert!(
        alice
            .pending_incoming()
            .unwrap()
            .iter()
            .all(|item| { !matches!(item, Incoming::Attachment { mine: true, .. }) }),
        "a sender's already accepted attachment must not be re-delivered as pending incoming"
    );
    let sender_history = attachments(&sender_messages);
    assert_eq!(sender_history.len(), 1);
    assert_eq!(sender_history[0].0, *file_id);

    // Repeating the same operation is idempotent; changing its payload is rejected.
    assert_eq!(
        alice
            .send_attachment_with_id(
                ROOM,
                "confidential.txt",
                "text/plain",
                &plaintext,
                "attachment-send-0001",
            )
            .unwrap(),
        event_id
    );
    assert!(alice
        .send_attachment_with_id(
            ROOM,
            "different.txt",
            "text/plain",
            b"different payload",
            "attachment-send-0001",
        )
        .is_err());

    // The recipient's encrypted manifest/key survive a Rust client restart.
    drop(bob);
    let bob = resume_with_session(&engine.base, BOB, "B_PHONE", &bob_db, &keys).unwrap();
    let persisted = attachments(&bob.messages_for_room(ROOM).unwrap());
    assert_eq!(persisted.len(), 1);
    assert_eq!(persisted[0].0, *file_id);
    assert_eq!(bob.download_attachment(file_id).unwrap(), plaintext);
}
