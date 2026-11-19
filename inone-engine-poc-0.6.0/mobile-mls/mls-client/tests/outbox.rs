// Очередь без связи, повторы при сбоях сети и отправка с идентификатором клиента.
// Прокси между клиентом и сервером можно выключить: тогда связи нет.
use std::io::{BufRead, BufReader};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use mls_client::{connect, Incoming, KeyStore, MemoryKeyStore};

const PW: &str = "пароль-проверки-1";
const ROOM: &str = "!room-outbox:inone.test";
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
        .expect("запуск node");
    let stdin = child.stdin.take();
    let mut line = String::new();
    BufReader::new(child.stdout.take().expect("stdout")).read_line(&mut line).expect("строка адреса");
    let base = line.trim().strip_prefix("URL=").expect("адрес сервера").to_string();
    Engine { child, stdin, base }
}

impl Drop for Engine {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}

struct Proxy {
    base: String,
    online: Arc<AtomicBool>,
    open: Arc<Mutex<Vec<TcpStream>>>,
}

impl Proxy {
    fn set_online(&self, on: bool) {
        self.online.store(on, Ordering::SeqCst);
        if !on {
            for stream in self.open.lock().unwrap().drain(..) {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
    }
}

fn pipe(mut from: TcpStream, mut to: TcpStream) {
    let _ = std::io::copy(&mut from, &mut to);
    let _ = to.shutdown(Shutdown::Write);
}

fn start_proxy(upstream: &str) -> Proxy {
    let listener = TcpListener::bind("127.0.0.1:0").expect("прокси");
    let addr = listener.local_addr().expect("адрес прокси");
    let upstream = upstream.trim_start_matches("http://").to_string();
    let online = Arc::new(AtomicBool::new(true));
    let open: Arc<Mutex<Vec<TcpStream>>> = Arc::new(Mutex::new(Vec::new()));
    let (flag, registry) = (online.clone(), open.clone());
    thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(client) = incoming else { continue };
            if !flag.load(Ordering::SeqCst) {
                let _ = client.shutdown(Shutdown::Both);
                continue;
            }
            let Ok(server) = TcpStream::connect(&upstream) else { continue };
            {
                let mut open = registry.lock().unwrap();
                open.push(client.try_clone().unwrap());
                open.push(server.try_clone().unwrap());
            }
            let (c_read, s_write) = (client.try_clone().unwrap(), server.try_clone().unwrap());
            let (s_read, c_write) = (server, client);
            thread::spawn(move || pipe(c_read, s_write));
            thread::spawn(move || pipe(s_read, c_write));
        }
    });
    Proxy { base: format!("http://{addr}"), online, open }
}

fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!("inone-client-outbox-{}-{name}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path.to_string_lossy().to_string()
}


fn open_encrypted_db(path: &str, key: &[u8; 32]) -> rusqlite::Connection {
    let connection = rusqlite::Connection::open(path).expect("open SQLCipher database");
    let key_hex = key.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    connection
        .pragma_update(None, "key", format!("x'{key_hex}'"))
        .expect("unlock SQLCipher database");
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))
        .expect("verify SQLCipher key");
    connection
}

fn texts(items: &[Incoming]) -> Vec<String> {
    items
        .iter()
        .filter_map(|i| match i {
            Incoming::Text { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect()
}


#[test]
fn uncertain_text_send_reuses_the_same_mls_ciphertext_until_local_commit_succeeds() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-uncertain-send");
    let bob_db = db("bob-uncertain-send");
    let mut alice = connect(&engine.base, ALICE, PW, "A_PHONE", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_PHONE", &bob_db, &keys).unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let client_message_id = "send-uncertain-0001";
    let database_key = keys
        .existing_database_key(&format!("{ALICE}/A_PHONE"))
        .unwrap()
        .expect("sender SQLCipher key");
    let connection = open_encrypted_db(&alice_db, &database_key);
    connection.execute_batch(
        "CREATE TRIGGER fail_text_inbox_insert
         BEFORE INSERT ON client_inbox
         WHEN NEW.kind = 'text'
         BEGIN
           SELECT RAISE(ABORT, 'simulated local inbox failure');
         END;",
    ).unwrap();
    drop(connection);

    assert!(alice.send_text_with_id(ROOM, "retry this text", client_message_id).is_err());
    let read_persisted_message = || {
        let connection = open_encrypted_db(&alice_db, &database_key);
        connection.query_row(
            "SELECT mls_message FROM client_outbox WHERE local_id = ?1",
            [client_message_id],
            |row| row.get::<_, Vec<u8>>(0),
        ).expect("persisted MLS message")
    };
    let first_message = read_persisted_message();
    assert!(!first_message.is_empty());

    assert!(alice.send_text_with_id(ROOM, "retry this text", client_message_id).is_err());
    assert_eq!(first_message, read_persisted_message());

    let connection = open_encrypted_db(&alice_db, &database_key);
    connection.execute_batch("DROP TRIGGER fail_text_inbox_insert;").unwrap();
    drop(connection);

    let event_id = alice.send_text_with_id(ROOM, "retry this text", client_message_id).unwrap();
    assert_eq!(alice.send_text_with_id(ROOM, "retry this text", client_message_id).unwrap(), event_id);
    assert_eq!(alice.outbox_len().unwrap(), 0);
    let sender_history = alice.messages_for_room(ROOM).unwrap();
    assert_eq!(texts(&sender_history), vec!["retry this text"]);
    assert!(matches!(sender_history.as_slice(), [Incoming::Text { mine: true, .. }]));
    let received = bob.sync().unwrap();
    assert_eq!(texts(&received), vec!["retry this text"]);
    assert!(matches!(received.as_slice(), [Incoming::Text { mine: false, .. }]));
}

#[test]
fn messages_written_offline_are_delivered_once_when_back_online() {
    let engine = start_engine();
    let proxy = start_proxy(&engine.base);
    let keys = MemoryKeyStore::default();
    let mut alice = connect(&proxy.base, ALICE, PW, "A_PHONE", &db("alice-queue"), &keys).unwrap();
    let mut bob = connect(&proxy.base, BOB, PW, "B_PHONE", &db("bob-queue"), &keys).unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());
    assert_eq!(alice.local_room_ids(), vec![ROOM.to_string()]);

    proxy.set_online(false);
    alice.enqueue_text(ROOM, "в метро").unwrap();
    assert_eq!(alice.outbox_len().unwrap(), 1);
    let pending: serde_json::Value = serde_json::from_str(
        &alice.pending_outbox_for_room_json(ROOM).unwrap()
    ).unwrap();
    assert_eq!(pending[0]["text"], "в метро",
        "SQLCipher outbox exposes the pending bubble for app restart restoration");
    assert_eq!(alice.flush_outbox().unwrap(), 0, "без связи ничего не отправлено");
    assert_eq!(alice.outbox_len().unwrap(), 1, "сообщение осталось в очереди");

    proxy.set_online(true);
    assert_eq!(alice.flush_outbox().unwrap(), 1, "после связи отправлено");
    assert_eq!(alice.outbox_len().unwrap(), 0);
    assert_eq!(alice.pending_outbox_for_room_json(ROOM).unwrap(), "[]");
    assert_eq!(alice.flush_outbox().unwrap(), 0, "повторный сброс ничего не шлёт");
    assert_eq!(texts(&bob.sync().unwrap()), vec!["в метро"], "у Боба ровно одно сообщение");
}

#[test]
fn sync_waits_out_a_short_outage_with_retries() {
    let engine = start_engine();
    let proxy = start_proxy(&engine.base);
    let keys = MemoryKeyStore::default();
    let mut alice = connect(&proxy.base, ALICE, PW, "A_PHONE", &db("alice-retry"), &keys).unwrap();
    proxy.set_online(false);
    let failed = alice.sync_retrying(2, Duration::from_millis(5)).unwrap_err();
    assert!(!failed.trim().is_empty(), "сбой сети должен вернуть понятную ошибку");
    let flag = proxy.online.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(80));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    alice.sync_retrying(10, Duration::from_millis(20)).expect("повторы дождались связи");
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn repeated_send_with_the_same_identifier_is_stored_once() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let mut alice = connect(&engine.base, ALICE, PW, "A_PHONE", &db("alice-id"), &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_PHONE", &db("bob-id"), &keys).unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());
    let first = alice.send_text_with_id(ROOM, "раз", "send-0001").unwrap();
    let again = alice.send_text_with_id(ROOM, "раз", "send-0001").unwrap();
    assert_eq!(first, again, "повтор вернул первое сообщение");
    assert_eq!(texts(&alice.messages_for_room(ROOM).unwrap()), vec!["раз"], "отправитель видит своё сообщение в SQLCipher истории");
    assert_eq!(texts(&bob.sync().unwrap()), vec!["раз"]);
}
