use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};

use mls_client::{connect, resume_with_session, Incoming, MemoryKeyStore};

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
    let received_attachments = attachments(&received);
    assert_eq!(received_attachments.len(), 1);
    let (file_id, name, mime_type, size) = &received_attachments[0];
    assert_eq!(name, "confidential.txt");
    assert_eq!(mime_type, "text/plain");
    assert_eq!(*size, plaintext.len() as u64);

    assert_eq!(bob.download_attachment(file_id).unwrap(), plaintext);
    assert_eq!(alice.download_attachment(file_id).unwrap(), plaintext);

    let sender_history = attachments(&alice.messages_for_room(ROOM).unwrap());
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
