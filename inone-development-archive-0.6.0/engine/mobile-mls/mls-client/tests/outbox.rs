// Очередь без связи, повторы при сбоях сети и отправка с идентификатором клиента.
// Прокси между клиентом и сервером можно выключить: тогда связи нет.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use mls_client::{connect, is_retryable, Incoming, KeyStore, MemoryKeyStore};

const PW: &str = "пароль-проверки-1";
const ROOM: &str = "!room-outbox:inone.test";
const ALICE: &str = "@alice:inone.test";
const BOB: &str = "@bob:inone.test";

struct Engine {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<std::process::ChildStdout>,
    base: String,
}

impl Engine {
    fn command(&mut self, line: &str) -> String {
        let stdin = self.stdin.as_mut().expect("engine stdin");
        writeln!(stdin, "{line}").expect("write engine command");
        stdin.flush().expect("flush engine command");
        let mut response = String::new();
        self.stdout
            .read_line(&mut response)
            .expect("read engine response");
        response.trim().to_string()
    }
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
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout"));
    let mut line = String::new();
    stdout.read_line(&mut line).expect("строка адреса");
    let base = line
        .trim()
        .strip_prefix("URL=")
        .expect("адрес сервера")
        .to_string();
    Engine {
        child,
        stdin,
        stdout,
        base,
    }
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
            let Ok(server) = TcpStream::connect(&upstream) else {
                continue;
            };
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
    Proxy {
        base: format!("http://{addr}"),
        online,
        open,
    }
}

struct StatusProxy {
    base: String,
    status: Arc<AtomicU16>,
}

impl StatusProxy {
    fn set_status(&self, status: u16) {
        self.status.store(status, Ordering::SeqCst);
    }
}

fn start_status_proxy(upstream: &str) -> StatusProxy {
    let listener = TcpListener::bind("127.0.0.1:0").expect("status proxy");
    let addr = listener.local_addr().expect("status proxy address");
    let upstream = upstream.trim_start_matches("http://").to_string();
    let status = Arc::new(AtomicU16::new(0));
    let shared_status = status.clone();

    thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(mut client) = incoming else { continue };
            let status = shared_status.clone();
            let upstream = upstream.clone();
            thread::spawn(move || {
                let mut request = Vec::new();
                let mut chunk = [0_u8; 1024];
                loop {
                    let Ok(read) = client.read(&mut chunk) else {
                        return;
                    };
                    if read == 0 {
                        return;
                    }
                    request.extend_from_slice(&chunk[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }

                let request_line = String::from_utf8_lossy(&request)
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_string();
                let mut parts = request_line.split_whitespace();
                let method = parts.next().unwrap_or_default();
                let path = parts.next().unwrap_or_default();
                let injected_status = status.load(Ordering::SeqCst);
                if method == "GET"
                    && path.contains("/rooms/")
                    && path.contains("/events")
                    && injected_status != 0
                {
                    let (reason, body) = match injected_status {
                        401 => ("Unauthorized", r#"{"error":"device_revoked"}"#),
                        403 => ("Forbidden", r#"{"code":"permission_denied"}"#),
                        404 => ("Not Found", r#"{"error":"room_deleted"}"#),
                        _ => ("Service Unavailable", r#"{"error":"unavailable"}"#),
                    };
                    let response = format!(
                        "HTTP/1.1 {injected_status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = client.write_all(response.as_bytes());
                    let _ = client.shutdown(Shutdown::Both);
                    return;
                }

                let Ok(mut server) = TcpStream::connect(&upstream) else {
                    let _ = client.shutdown(Shutdown::Both);
                    return;
                };

                // Force the upstream to close this HTTP/1.1 connection after the
                // response. Otherwise ureq may reuse the already-tunneled socket,
                // bypassing the status injector on subsequent sync requests.
                let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n")
                else {
                    let _ = client.shutdown(Shutdown::Both);
                    return;
                };
                let header = String::from_utf8_lossy(&request[..header_end]);
                let mut lines = header.lines();
                let Some(request_line) = lines.next() else {
                    let _ = client.shutdown(Shutdown::Both);
                    return;
                };
                let mut forwarded = format!("{request_line}\r\n");
                for line in lines {
                    if !line.to_ascii_lowercase().starts_with("connection:") {
                        forwarded.push_str(line);
                        forwarded.push_str("\r\n");
                    }
                }
                forwarded.push_str("Connection: close\r\n\r\n");
                if server.write_all(forwarded.as_bytes()).is_err()
                    || server.write_all(&request[header_end + 4..]).is_err()
                {
                    let _ = client.shutdown(Shutdown::Both);
                    return;
                }
                let (client_read, server_write) =
                    (client.try_clone().unwrap(), server.try_clone().unwrap());
                let (server_read, client_write) = (server, client);
                thread::spawn(move || pipe(client_read, server_write));
                thread::spawn(move || pipe(server_read, client_write));
            });
        }
    });

    StatusProxy {
        base: format!("http://{addr}"),
        status,
    }
}

fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!(
        "inone-client-outbox-{}-{name}.db",
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

    proxy.set_online(false);
    alice.enqueue_text(ROOM, "в метро").unwrap();
    assert_eq!(alice.outbox_len().unwrap(), 1);
    assert_eq!(
        alice.flush_outbox().unwrap(),
        0,
        "без связи ничего не отправлено"
    );
    assert_eq!(
        alice.outbox_len().unwrap(),
        1,
        "сообщение осталось в очереди"
    );

    proxy.set_online(true);
    assert_eq!(alice.flush_outbox().unwrap(), 1, "после связи отправлено");
    assert_eq!(alice.outbox_len().unwrap(), 0);
    assert_eq!(
        alice.flush_outbox().unwrap(),
        0,
        "повторный сброс ничего не шлёт"
    );
    assert_eq!(
        texts(&bob.sync().unwrap()),
        vec!["в метро"],
        "у Боба ровно одно сообщение"
    );
}

#[test]
fn sync_waits_out_a_short_outage_with_retries() {
    let engine = start_engine();
    let proxy = start_proxy(&engine.base);
    let keys = MemoryKeyStore::default();
    let mut alice = connect(&proxy.base, ALICE, PW, "A_PHONE", &db("alice-retry"), &keys).unwrap();
    proxy.set_online(false);
    let failed = alice
        .sync_retrying(2, Duration::from_millis(5))
        .unwrap_err();
    assert!(is_retryable(&failed), "сбой сети — временный: {failed}");
    let flag = proxy.online.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(80));
        flag.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    alice
        .sync_retrying(10, Duration::from_millis(20))
        .expect("повторы дождались связи");
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
    assert_eq!(texts(&bob.sync().unwrap()), vec!["раз"]);
}

#[test]
fn uncertain_send_reuses_exact_mls_ciphertext_and_keeps_sender_history() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-exact-retry");
    let bob_db = db("bob-exact-retry");
    let mut alice = connect(&engine.base, ALICE, PW, "A_EXACT", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_EXACT", &bob_db, &keys).unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let database_key = keys
        .existing_database_key(&format!("{ALICE}/A_EXACT"))
        .unwrap()
        .expect("sender SQLCipher key");
    let connection = open_encrypted_db(&alice_db, &database_key);
    connection
        .execute_batch(
            "CREATE TRIGGER fail_outgoing_history_insert
             BEFORE INSERT ON client_inbox
             WHEN NEW.direction = 'outgoing'
             BEGIN
               SELECT RAISE(ABORT, 'simulated local history failure');
             END;",
        )
        .unwrap();
    drop(connection);

    // The server commits the first request, but the local history transaction
    // fails. The exact MLS ciphertext must remain in the durable SQLCipher outbox.
    assert!(alice
        .send_text_with_id(ROOM, "retry-safe text", "stable-send-0001")
        .is_err());
    let read_persisted_message = || {
        let connection = open_encrypted_db(&alice_db, &database_key);
        connection
            .query_row(
                "SELECT mls_message FROM client_outbox WHERE local_id = ?1",
                ["stable-send-0001"],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .expect("durable MLS message")
    };
    let first_message = read_persisted_message();
    assert!(!first_message.is_empty());

    // A second uncertain retry must not advance the sender ratchet or alter bytes.
    assert!(alice
        .send_text_with_id(ROOM, "retry-safe text", "stable-send-0001")
        .is_err());
    assert_eq!(first_message, read_persisted_message());

    let connection = open_encrypted_db(&alice_db, &database_key);
    connection
        .execute_batch("DROP TRIGGER fail_outgoing_history_insert;")
        .unwrap();
    drop(connection);

    let event_id = alice
        .send_text_with_id(ROOM, "retry-safe text", "stable-send-0001")
        .unwrap();
    assert_eq!(
        alice
            .send_text_with_id(ROOM, "retry-safe text", "stable-send-0001")
            .unwrap(),
        event_id,
        "completed operation IDs return the original event without creating another MLS message"
    );
    assert_eq!(texts(&bob.sync().unwrap()), vec!["retry-safe text"]);

    let sender_history = texts(&alice.messages_for_room(ROOM).unwrap());
    assert_eq!(sender_history, vec!["retry-safe text"]);

    alice
        .send_text_with_id(ROOM, "message after retry", "stable-send-0002")
        .unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec!["message after retry"]);
}

#[test]
fn encrypted_inbox_survives_restart_until_app_ack_and_never_replays_after_ack() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();

    let alice_db = db("alice-durable-inbox");
    let bob_db = db("bob-durable-inbox");
    let mut alice = connect(&engine.base, ALICE, PW, "A_INBOX", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_INBOX", &bob_db, &keys).unwrap();

    bob.ensure_key_packages(2).unwrap();
    let room = "!room-durable-inbox:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let plaintext = "persisted before application acknowledgement";
    let event_id = alice.send_text(room, plaintext).unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec![plaintext.to_string()]);

    let pending = bob.pending_incoming().unwrap();
    assert_eq!(texts(&pending), vec![plaintext.to_string()]);
    assert!(matches!(
        pending.as_slice(),
        [Incoming::Text { event_id: pending_id, .. }]
            if pending_id.as_str() == event_id.as_str()
    ));

    // SQLCipher protects the pending plaintext at rest, including WAL sidecars.
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = format!("{bob_db}{suffix}");
        if let Ok(ciphertext) = std::fs::read(path) {
            if ciphertext.len() >= plaintext.len() {
                assert!(
                    !ciphertext
                        .windows(plaintext.len())
                        .any(|window| window == plaintext.as_bytes()),
                    "pending inbox plaintext must not appear in database files"
                );
            }
        }
    }

    // Simulate app/process restart after decrypt+commit but before the UI ACK.
    drop(bob);
    let mut resumed = connect(&engine.base, BOB, PW, "B_INBOX", &bob_db, &keys)
        .expect("resume device after crash before app acknowledgement");
    assert_eq!(
        texts(&resumed.pending_incoming().unwrap()),
        vec![plaintext.to_string()]
    );

    // ACK is idempotent and durable.
    resumed.acknowledge_incoming(&[event_id.clone()]).unwrap();
    resumed.acknowledge_incoming(&[event_id.clone()]).unwrap();
    assert!(resumed.pending_incoming().unwrap().is_empty());
    drop(resumed);

    // Simulate another restart after ACK. Neither the inbox nor a repeated server sync replays it.
    let mut after_ack = connect(&engine.base, BOB, PW, "B_INBOX", &bob_db, &keys)
        .expect("resume after acknowledged inbox item");
    assert!(after_ack.pending_incoming().unwrap().is_empty());
    assert!(after_ack.sync().unwrap().is_empty());
    assert!(after_ack.pending_incoming().unwrap().is_empty());
    after_ack.logout().unwrap();
}

#[test]
fn inbox_write_failure_rolls_back_mls_state_and_allows_server_redelivery() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-inbox-write-failure");
    let bob_db = db("bob-inbox-write-failure");
    let mut alice = connect(&engine.base, ALICE, PW, "A_INBOX_FAIL", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_INBOX_FAIL", &bob_db, &keys).unwrap();

    bob.ensure_key_packages(2).unwrap();
    let room = "!room-inbox-write-failure:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let plaintext = "must be redelivered after a failed inbox transaction";
    let event_id = alice.send_text(room, plaintext).unwrap();

    // Open the same real SQLCipher database with the device key and inject a
    // deterministic storage failure at the inbox INSERT boundary.
    let key = keys.database_key(&format!("{BOB}/B_INBOX_FAIL")).unwrap();
    let key_hex = key
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let fault = rusqlite::Connection::open(&bob_db).unwrap();
    fault
        .pragma_update(None, "key", format!("x'{key_hex}'"))
        .unwrap();
    fault
        .execute_batch(
            "CREATE TRIGGER reject_inbox_insert
             BEFORE INSERT ON client_inbox
             BEGIN
               SELECT RAISE(ABORT, 'injected durable inbox write failure');
             END;",
        )
        .unwrap();

    let failed = bob
        .sync()
        .expect_err("inbox storage failure must abort event processing");
    assert!(
        failed.contains("временная ошибка сохранения MLS inbox"),
        "unexpected sync error: {failed}"
    );
    assert!(
        bob.pending_incoming().unwrap().is_empty(),
        "a failed transaction must not expose a partially stored inbox item"
    );

    // The event must not be marked processed and the in-memory MLS group must
    // be reloaded from the rolled-back SQLCipher state before retrying.
    fault
        .execute_batch("DROP TRIGGER reject_inbox_insert;")
        .unwrap();
    drop(fault);

    let redelivered = bob
        .sync()
        .expect("the same server event must be processable after rollback");
    assert_eq!(texts(&redelivered), vec![plaintext.to_string()]);
    assert!(matches!(
        bob.pending_incoming().unwrap().as_slice(),
        [Incoming::Text {
            event_id: pending_id,
            text: pending_text,
            ..
        }] if pending_id == &event_id && pending_text == plaintext
    ));

    assert!(
        bob.sync().unwrap().is_empty(),
        "the successfully committed event must not be processed twice"
    );
    bob.acknowledge_incoming(&[event_id]).unwrap();
    assert!(bob.pending_incoming().unwrap().is_empty());
    drop(bob);

    let mut resumed = connect(&engine.base, BOB, PW, "B_INBOX_FAIL", &bob_db, &keys)
        .expect("the committed inbox and ACK must survive reopening SQLCipher");
    assert!(resumed.pending_incoming().unwrap().is_empty());
    assert!(resumed.sync().unwrap().is_empty());
}

// Process-crash tests use a deterministic platform key so a child test process can
// reopen the exact same SQLCipher file after the parent has prepared the scenario.
const CRASH_DB_KEY: [u8; 32] = [0x5a; 32];
const CAROL: &str = "@carol:inone.test";

struct FixedCrashKeyStore;

impl KeyStore for FixedCrashKeyStore {
    fn has_database_key(&self, _scope: &str) -> Result<bool, String> {
        Ok(true)
    }

    fn existing_database_key(&self, _scope: &str) -> Result<Option<[u8; 32]>, String> {
        Ok(Some(CRASH_DB_KEY))
    }

    fn database_key(&self, _scope: &str) -> Result<[u8; 32], String> {
        Ok(CRASH_DB_KEY)
    }

    fn delete_database_key(&self, _scope: &str) -> Result<(), String> {
        // This test store models a stable platform key across child-process restarts.
        Ok(())
    }
}

fn run_crash_child(
    test_name: &str,
    base: &str,
    db_path: &str,
    point: &str,
) -> std::process::Output {
    std::process::Command::new(std::env::current_exe().expect("current test executable"))
        .args(["--exact", test_name, "--nocapture"])
        .env("INONE_MLS_CRASH_CHILD_BASE", base)
        .env("INONE_MLS_CRASH_CHILD_DB", db_path)
        .env("INONE_MLS_TEST_CRASH_POINT", point)
        .output()
        .expect("spawn crash-test child")
}

fn crash_child_sync_if_requested() {
    let (Ok(base), Ok(db_path)) = (
        std::env::var("INONE_MLS_CRASH_CHILD_BASE"),
        std::env::var("INONE_MLS_CRASH_CHILD_DB"),
    ) else {
        return;
    };
    let keys = FixedCrashKeyStore;
    let mut bob = connect(&base, BOB, PW, "B_CRASH_P0", &db_path, &keys)
        .expect("child reopens the prepared SQLCipher database");
    let result = bob.sync();
    panic!("configured crash failpoint did not terminate child; sync result: {result:?}");
}

fn run_membership_crash_child(
    test_name: &str,
    base: &str,
    db_path: &str,
    room_id: &str,
    point: &str,
) -> std::process::Output {
    std::process::Command::new(std::env::current_exe().expect("current test executable"))
        .args(["--exact", test_name, "--nocapture"])
        .env("INONE_MLS_MEMBERSHIP_CRASH_CHILD_BASE", base)
        .env("INONE_MLS_MEMBERSHIP_CRASH_CHILD_DB", db_path)
        .env("INONE_MLS_MEMBERSHIP_CRASH_CHILD_ROOM", room_id)
        .env("INONE_MLS_TEST_CRASH_POINT", point)
        .output()
        .expect("spawn membership crash-test child")
}

fn crash_child_membership_invite_if_requested() {
    let (Ok(base), Ok(db_path), Ok(room_id)) = (
        std::env::var("INONE_MLS_MEMBERSHIP_CRASH_CHILD_BASE"),
        std::env::var("INONE_MLS_MEMBERSHIP_CRASH_CHILD_DB"),
        std::env::var("INONE_MLS_MEMBERSHIP_CRASH_CHILD_ROOM"),
    ) else {
        return;
    };
    let keys = FixedCrashKeyStore;
    let mut alice = connect(&base, ALICE, PW, "A_MEMBERSHIP_CRASH_P0", &db_path, &keys)
        .expect("child reopens the prepared inviter SQLCipher database");
    let result = alice.invite(&room_id, BOB);
    panic!(
        "configured membership crash failpoint did not terminate child; invite result: {result:?}"
    );
}

fn run_ack_crash_child(
    test_name: &str,
    base: &str,
    db_path: &str,
    event_id: &str,
    point: &str,
) -> std::process::Output {
    std::process::Command::new(std::env::current_exe().expect("current test executable"))
        .args(["--exact", test_name, "--nocapture"])
        .env("INONE_MLS_ACK_CRASH_CHILD_BASE", base)
        .env("INONE_MLS_ACK_CRASH_CHILD_DB", db_path)
        .env("INONE_MLS_ACK_CRASH_CHILD_EVENT", event_id)
        .env("INONE_MLS_TEST_CRASH_POINT", point)
        .output()
        .expect("spawn inbox ACK crash-test child")
}

fn crash_child_acknowledge_if_requested() {
    let (Ok(base), Ok(db_path), Ok(event_id)) = (
        std::env::var("INONE_MLS_ACK_CRASH_CHILD_BASE"),
        std::env::var("INONE_MLS_ACK_CRASH_CHILD_DB"),
        std::env::var("INONE_MLS_ACK_CRASH_CHILD_EVENT"),
    ) else {
        return;
    };
    let keys = FixedCrashKeyStore;
    let mut bob = connect(&base, BOB, PW, "B_CRASH_P0", &db_path, &keys)
        .expect("child reopens the prepared recipient SQLCipher database");
    let result = bob.acknowledge_incoming(&[event_id]);
    panic!("configured inbox ACK crash failpoint did not terminate child; ACK result: {result:?}");
}

#[test]
fn process_crash_after_application_ratchet_write_rolls_back_and_redelivers() {
    crash_child_sync_if_requested();

    let engine = start_engine();
    let keys = FixedCrashKeyStore;
    let alice_db = db("p0-crash-app-alice");
    let bob_db = db("p0-crash-app-bob");
    let mut alice = connect(&engine.base, ALICE, PW, "A_CRASH_P0", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys).unwrap();
    bob.ensure_key_packages(2).unwrap();

    let room = "!room-p0-process-crash-app:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());
    let plaintext = "survives a real process crash before inbox commit";
    let event_id = alice.send_text(room, plaintext).unwrap();
    drop(bob);

    let status = run_crash_child(
        "process_crash_after_application_ratchet_write_rolls_back_and_redelivers",
        &engine.base,
        &bob_db,
        "after_application_mls_write",
    );
    assert!(
        !status.status.success(),
        "child must be forcibly terminated inside the open transaction"
    );
    assert!(
        String::from_utf8_lossy(&status.stderr)
            .contains("INONE_MLS_TEST_CRASH_POINT_REACHED=after_application_mls_write"),
        "child must reach the application ratchet crash point; stderr: {}",
        String::from_utf8_lossy(&status.stderr)
    );

    let mut recovered = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys)
        .expect("SQLCipher database remains readable after process death");
    let delivered = recovered
        .sync()
        .expect("same event decrypts after rollback and restart");
    assert_eq!(texts(&delivered), vec![plaintext.to_string()]);
    assert!(recovered.undecryptable().unwrap().is_empty());
    assert!(matches!(
        recovered.pending_incoming().unwrap().as_slice(),
        [Incoming::Text { event_id: pending_id, text: pending_text, .. }]
            if pending_id == &event_id && pending_text == plaintext
    ));
    assert!(
        recovered.sync().unwrap().is_empty(),
        "committed event is not replayed"
    );
    recovered.acknowledge_incoming(&[event_id]).unwrap();
    assert!(recovered.pending_incoming().unwrap().is_empty());
}

#[test]
fn process_crash_after_inbound_commit_merge_rolls_back_epoch_and_retries() {
    crash_child_sync_if_requested();

    let engine = start_engine();
    let keys = FixedCrashKeyStore;
    let alice_db = db("p0-crash-commit-alice");
    let bob_db = db("p0-crash-commit-bob");
    let mut alice = connect(
        &engine.base,
        ALICE,
        PW,
        "A_COMMIT_CRASH_P0",
        &alice_db,
        &keys,
    )
    .unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys).unwrap();
    let mut carol = connect(
        &engine.base,
        CAROL,
        PW,
        "C_COMMIT_CRASH_P0",
        &db("p0-crash-commit-carol"),
        &keys,
    )
    .unwrap();
    bob.ensure_key_packages(2).unwrap();
    carol.ensure_key_packages(1).unwrap();

    let room = "!room-p0-process-crash-commit:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());
    let before_epoch = bob.local_epoch(room).expect("Bob has the invited group");
    alice.invite(room, CAROL).unwrap();
    assert_eq!(
        alice.local_epoch(room).expect("Alice has the group"),
        before_epoch + 1
    );
    drop(bob);

    let status = run_crash_child(
        "process_crash_after_inbound_commit_merge_rolls_back_epoch_and_retries",
        &engine.base,
        &bob_db,
        "after_inbound_commit_merge",
    );
    assert!(
        !status.status.success(),
        "child must be forcibly terminated after merge but before commit"
    );
    assert!(
        String::from_utf8_lossy(&status.stderr)
            .contains("INONE_MLS_TEST_CRASH_POINT_REACHED=after_inbound_commit_merge"),
        "child must reach the Commit merge crash point; stderr: {}",
        String::from_utf8_lossy(&status.stderr)
    );

    let mut recovered = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys)
        .expect("SQLCipher group state remains readable after process death");
    assert_eq!(
        recovered.local_epoch(room).expect("recovered group exists"),
        before_epoch,
        "uncommitted epoch must roll back"
    );
    recovered
        .sync()
        .expect("the exact server Commit is retried after restart");
    assert_eq!(recovered.local_epoch(room), alice.local_epoch(room));
    recovered.sync().expect("a repeated sync is idempotent");
    assert_eq!(recovered.local_epoch(room), alice.local_epoch(room));
    assert!(recovered
        .members_of(room)
        .unwrap()
        .iter()
        .any(|member| member == &format!("{CAROL}/C_COMMIT_CRASH_P0")));
}

#[test]
fn process_crash_immediately_after_inbound_commit_transaction_commit_keeps_epoch() {
    crash_child_sync_if_requested();

    let engine = start_engine();
    let keys = FixedCrashKeyStore;
    let alice_db = db("p0-crash-commit-after-alice");
    let bob_db = db("p0-crash-commit-after-bob");
    let mut alice = connect(
        &engine.base,
        ALICE,
        PW,
        "A_COMMIT_AFTER_P0",
        &alice_db,
        &keys,
    )
    .unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys).unwrap();
    let mut carol = connect(
        &engine.base,
        CAROL,
        PW,
        "C_COMMIT_AFTER_P0",
        &db("p0-crash-commit-after-carol"),
        &keys,
    )
    .unwrap();

    bob.ensure_key_packages(2).unwrap();
    carol.ensure_key_packages(1).unwrap();

    let room = "!room-p0-process-crash-commit-after:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());
    let before_epoch = bob.local_epoch(room).expect("Bob has the invited group");

    alice.invite(room, CAROL).unwrap();
    let committed_epoch = alice
        .local_epoch(room)
        .expect("Alice has the updated group");
    assert_eq!(committed_epoch, before_epoch + 1);
    drop(bob);

    let status = run_crash_child(
        "process_crash_immediately_after_inbound_commit_transaction_commit_keeps_epoch",
        &engine.base,
        &bob_db,
        "after_inbound_commit_transaction_commit",
    );
    assert!(
        !status.status.success(),
        "child must be forcibly terminated immediately after SQLite COMMIT"
    );
    assert!(
        String::from_utf8_lossy(&status.stderr)
            .contains("INONE_MLS_TEST_CRASH_POINT_REACHED=after_inbound_commit_transaction_commit"),
        "child must reach the post-COMMIT crash point; stderr: {}",
        String::from_utf8_lossy(&status.stderr)
    );

    let mut recovered = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys)
        .expect("committed SQLCipher database remains readable after process death");
    assert_eq!(
        recovered.local_epoch(room).expect("recovered group exists"),
        committed_epoch,
        "the committed epoch must survive process termination and reopen"
    );
    assert!(
        recovered
            .members_of(room)
            .unwrap()
            .iter()
            .any(|member| member == &format!("{CAROL}/C_COMMIT_AFTER_P0")),
        "the membership state committed with the epoch must also survive"
    );

    recovered
        .sync()
        .expect("a subsequent sync after restart must remain healthy");
    assert_eq!(
        recovered.local_epoch(room),
        Some(committed_epoch),
        "repeated sync must not roll back or double-apply the committed epoch"
    );
    assert!(recovered
        .members_of(room)
        .unwrap()
        .iter()
        .any(|member| member == &format!("{CAROL}/C_COMMIT_AFTER_P0")));
}

#[test]
fn process_crash_at_outbound_membership_commit_boundaries_replays_exact_operation_once() {
    crash_child_membership_invite_if_requested();
    crash_child_sync_if_requested();

    let crash_points = [
        "after_membership_commit_journal_commit",
        "after_outbound_membership_commit_server_acceptance",
        "after_outbound_membership_commit_local_merge",
        "after_outbound_membership_commit_journal_settlement",
        "before_outbound_membership_commit_transaction_commit",
        "after_outbound_membership_commit_transaction_commit",
    ];

    for (index, point) in crash_points.iter().enumerate() {
        let mut engine = start_engine();
        let keys = FixedCrashKeyStore;
        let alice_db = db(&format!("p0-membership-crash-{index}-alice"));
        let bob_db = db(&format!("p0-membership-crash-{index}-bob"));
        let mut alice = connect(
            &engine.base,
            ALICE,
            PW,
            "A_MEMBERSHIP_CRASH_P0",
            &alice_db,
            &keys,
        )
        .unwrap();
        let mut bob = connect(
            &engine.base,
            BOB,
            PW,
            "B_MEMBERSHIP_CRASH_P0",
            &bob_db,
            &keys,
        )
        .unwrap();
        bob.ensure_key_packages(1).unwrap();

        let room = format!("!room-p0-membership-crash-{index}:inone.test");
        alice.create_room(&room).unwrap();
        drop(alice);

        let status = run_membership_crash_child(
            "process_crash_at_outbound_membership_commit_boundaries_replays_exact_operation_once",
            &engine.base,
            &alice_db,
            &room,
            point,
        );
        assert!(
            !status.status.success(),
            "child must be forcibly terminated at {point}"
        );
        assert!(
            String::from_utf8_lossy(&status.stderr)
                .contains(&format!("INONE_MLS_TEST_CRASH_POINT_REACHED={point}")),
            "child did not reach {point}; stderr: {}",
            String::from_utf8_lossy(&status.stderr)
        );

        let database = open_encrypted_db(&alice_db, &CRASH_DB_KEY);
        let journal_rows: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM client_membership_commits WHERE room_id = ?1",
                [&room],
                |row| row.get(0),
            )
            .unwrap();
        let intent_rows: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM client_invite_intents
                 WHERE room_id = ?1 AND state = 'commit_pending'",
                [&room],
                |row| row.get(0),
            )
            .unwrap();
        drop(database);
        let committed_locally = *point == "after_outbound_membership_commit_transaction_commit";
        let server_accepted = *point != "after_membership_commit_journal_commit";
        assert_eq!(
            journal_rows,
            if committed_locally { 0 } else { 1 },
            "journal row must match the local settlement transaction at {point}"
        );
        assert_eq!(
            intent_rows,
            if committed_locally { 0 } else { 1 },
            "invite intent must match the local settlement transaction at {point}"
        );

        let expected_server_commits = if server_accepted { 1 } else { 0 };
        assert_eq!(
            engine.command(&format!("COMMIT_COUNT {room}")),
            expected_server_commits.to_string(),
            "server acceptance boundary must be observable"
        );

        let mut recovered = connect(
            &engine.base,
            ALICE,
            PW,
            "A_MEMBERSHIP_CRASH_P0",
            &alice_db,
            &keys,
        )
        .expect("inviter SQLCipher database remains readable after process death");
        assert_eq!(
            recovered.local_epoch(&room),
            Some(if committed_locally { 1 } else { 0 }),
            "MLS state must roll back with the journal before local COMMIT"
        );
        recovered.sync().expect(
            "restart must replay or recognize the exact durable operation and settle locally",
        );
        assert_eq!(recovered.local_epoch(&room), Some(1));
        assert_eq!(
            engine.command(&format!("COMMIT_COUNT {room}")),
            "1",
            "server must accept exactly one membership Commit"
        );
        assert_eq!(recovered.desync_reason(&room).unwrap(), None);

        let database = open_encrypted_db(&alice_db, &CRASH_DB_KEY);
        let journal_rows: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM client_membership_commits WHERE room_id = ?1",
                [&room],
                |row| row.get(0),
            )
            .unwrap();
        let intent_rows: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM client_invite_intents WHERE room_id = ?1",
                [&room],
                |row| row.get(0),
            )
            .unwrap();
        drop(database);
        assert_eq!(journal_rows, 0, "settled operation journal must be removed");
        assert_eq!(intent_rows, 0, "settled invite intent must be removed");

        bob.sync()
            .expect("recipient must process the single Welcome after replay");
        assert_eq!(bob.local_epoch(&room), Some(1));
        assert!(bob
            .members_of(&room)
            .unwrap()
            .iter()
            .any(|member| member == &format!("{BOB}/B_MEMBERSHIP_CRASH_P0")));
        assert_eq!(engine.command(&format!("COMMIT_COUNT {room}")), "1");
    }
}

#[test]
fn process_crash_before_and_after_durable_inbox_ack_commit_preserves_ack_state() {
    crash_child_acknowledge_if_requested();
    crash_child_sync_if_requested();

    let crash_points = [
        "before_inbox_ack_transaction_commit",
        "after_inbox_ack_transaction_commit",
    ];

    for (index, point) in crash_points.iter().enumerate() {
        let engine = start_engine();
        let keys = FixedCrashKeyStore;
        let alice_db = db(&format!("p0-ack-crash-{index}-alice"));
        let bob_db = db(&format!("p0-ack-crash-{index}-bob"));
        let mut alice = connect(
            &engine.base,
            ALICE,
            PW,
            &format!("A_ACK_CRASH_{index}"),
            &alice_db,
            &keys,
        )
        .unwrap();
        let mut bob = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys).unwrap();
        bob.ensure_key_packages(1).unwrap();

        let room = format!("!room-p0-ack-crash-{index}:inone.test");
        alice.create_room(&room).unwrap();
        alice.invite(&room, BOB).unwrap();
        assert!(bob.sync().unwrap().is_empty());
        let event_id = alice
            .send_text_with_id(
                &room,
                "durable ACK crash boundary",
                &format!("ack-crash-{index}"),
            )
            .unwrap();
        let delivered = bob.sync().unwrap();
        assert!(delivered.iter().any(|item| matches!(
            item,
            Incoming::Text { event_id: delivered_id, .. } if delivered_id == &event_id
        )));
        assert_eq!(bob.pending_incoming().unwrap().len(), 1);
        drop(bob);

        let status = run_ack_crash_child(
            "process_crash_before_and_after_durable_inbox_ack_commit_preserves_ack_state",
            &engine.base,
            &bob_db,
            &event_id,
            point,
        );
        assert!(
            !status.status.success(),
            "child must be forcibly terminated at {point}"
        );
        assert!(
            String::from_utf8_lossy(&status.stderr)
                .contains(&format!("INONE_MLS_TEST_CRASH_POINT_REACHED={point}")),
            "child did not reach {point}; stderr: {}",
            String::from_utf8_lossy(&status.stderr)
        );

        let mut recovered = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys)
            .expect("recipient SQLCipher database remains readable after ACK process death");
        let expected_pending = if *point == "after_inbox_ack_transaction_commit" {
            0
        } else {
            1
        };
        assert_eq!(
            recovered.pending_incoming().unwrap().len(),
            expected_pending,
            "ACK durability must match the transaction boundary at {point}"
        );
        assert!(
            recovered.sync().unwrap().is_empty(),
            "an acknowledged or already durable inbox event must not be replayed"
        );
        if expected_pending == 1 {
            recovered.acknowledge_incoming(&[event_id.clone()]).unwrap();
        }
        assert!(recovered.pending_incoming().unwrap().is_empty());

        let database = open_encrypted_db(&bob_db, &CRASH_DB_KEY);
        let acknowledged: i64 = database
            .query_row(
                "SELECT acknowledged FROM client_inbox WHERE event_id = ?1",
                [&event_id],
                |row| row.get(0),
            )
            .unwrap();
        drop(database);
        assert_eq!(acknowledged, 1, "recovered ACK must be durable");
    }
}

#[test]
fn process_crash_at_each_inbox_journal_boundary_preserves_atomic_delivery() {
    crash_child_sync_if_requested();

    let crash_points = [
        "before_inbox_retention_cleanup",
        "after_inbox_retention_cleanup",
        "before_inbox_insert",
        "after_inbox_insert",
        "before_processed_marker_insert",
        "after_processed_marker_insert",
        "before_undecryptable_marker_insert",
        "after_undecryptable_marker_insert",
        "before_application_transaction_commit",
        "after_application_transaction_commit",
    ];

    for (index, point) in crash_points.iter().enumerate() {
        let engine = start_engine();
        let keys = FixedCrashKeyStore;
        let alice_db = db(&format!("p0-crash-boundary-{index}-alice"));
        let bob_db = db(&format!("p0-crash-boundary-{index}-bob"));
        let mut alice = connect(
            &engine.base,
            ALICE,
            PW,
            &format!("A_BOUNDARY_{index}"),
            &alice_db,
            &keys,
        )
        .unwrap();
        let mut bob = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys).unwrap();
        bob.ensure_key_packages(2).unwrap();

        let room = format!("!room-p0-inbox-boundary-{index}:inone.test");
        alice.create_room(&room).unwrap();
        alice.invite(&room, BOB).unwrap();
        assert!(bob.sync().unwrap().is_empty());

        let unreadable_case = point.contains("undecryptable_marker");
        let payload: &[u8] = if unreadable_case {
            &[0xff, 0xfe, 0xfd]
        } else {
            b"durable inbox boundary payload"
        };
        let event_id = alice
            .send_application_payload_with_id(&room, payload, &format!("boundary-message-{index}"))
            .unwrap();
        drop(bob);

        let status = run_crash_child(
            "process_crash_at_each_inbox_journal_boundary_preserves_atomic_delivery",
            &engine.base,
            &bob_db,
            point,
        );
        assert!(
            !status.status.success(),
            "child must be forcibly terminated at {point}"
        );
        assert!(
            String::from_utf8_lossy(&status.stderr)
                .contains(&format!("INONE_MLS_TEST_CRASH_POINT_REACHED={point}")),
            "child did not reach {point}; stderr: {}",
            String::from_utf8_lossy(&status.stderr)
        );

        let mut recovered = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys)
            .expect("SQLCipher database remains readable after process death");

        if *point == "after_application_transaction_commit" {
            let pending = recovered.pending_incoming().unwrap();
            assert_eq!(
                pending.len(),
                1,
                "committed inbox row must survive process death"
            );
            if !unreadable_case {
                assert_eq!(texts(&pending), vec!["durable inbox boundary payload"]);
            }
            assert!(
                recovered.sync().unwrap().is_empty(),
                "committed processed marker must prevent server redelivery"
            );
        } else {
            assert!(
                recovered.pending_incoming().unwrap().is_empty(),
                "uncommitted inbox insert must roll back at {point}"
            );
            let redelivered = recovered
                .sync()
                .expect("the exact server event must be processable after rollback");
            if unreadable_case {
                assert!(matches!(
                    redelivered.as_slice(),
                    [Incoming::Unreadable { event_id: delivered_id, .. }]
                        if delivered_id == &event_id
                ));
            } else {
                assert_eq!(texts(&redelivered), vec!["durable inbox boundary payload"]);
            }
            assert!(
                recovered.sync().unwrap().is_empty(),
                "successfully committed event must not be delivered twice"
            );
        }

        if unreadable_case {
            assert!(
                recovered
                    .undecryptable()
                    .unwrap()
                    .iter()
                    .any(|row| row.0 == event_id),
                "unreadable diagnostic must be committed with its inbox record"
            );
        } else {
            assert!(
                recovered.undecryptable().unwrap().is_empty(),
                "valid application payload must not create an unreadable diagnostic"
            );
        }
        recovered.acknowledge_incoming(&[event_id]).unwrap();
        assert!(recovered.pending_incoming().unwrap().is_empty());
    }
}

#[test]
fn process_crash_at_welcome_transaction_boundaries_preserves_atomic_join() {
    crash_child_sync_if_requested();

    let crash_points = [
        "after_welcome_group_materialization",
        "after_welcome_room_index_write",
        "after_welcome_receipt_write",
        "before_welcome_transaction_commit",
        "after_welcome_transaction_commit",
    ];

    for (index, point) in crash_points.iter().enumerate() {
        let engine = start_engine();
        let keys = FixedCrashKeyStore;
        let alice_db = db(&format!("p0-crash-welcome-{index}-alice"));
        let bob_db = db(&format!("p0-crash-welcome-{index}-bob"));
        let mut alice = connect(
            &engine.base,
            ALICE,
            PW,
            &format!("A_WELCOME_{index}"),
            &alice_db,
            &keys,
        )
        .unwrap();
        let mut bob = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys).unwrap();
        bob.ensure_key_packages(2).unwrap();

        let room = format!("!room-p0-welcome-boundary-{index}:inone.test");
        alice.create_room(&room).unwrap();
        alice.invite(&room, BOB).unwrap();
        drop(bob);

        let status = run_crash_child(
            "process_crash_at_welcome_transaction_boundaries_preserves_atomic_join",
            &engine.base,
            &bob_db,
            point,
        );
        assert!(
            !status.status.success(),
            "child must be forcibly terminated at {point}"
        );
        assert!(
            String::from_utf8_lossy(&status.stderr)
                .contains(&format!("INONE_MLS_TEST_CRASH_POINT_REACHED={point}")),
            "child did not reach {point}; stderr: {}",
            String::from_utf8_lossy(&status.stderr)
        );

        let database = open_encrypted_db(&bob_db, &CRASH_DB_KEY);
        let room_count: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM client_rooms WHERE room_id = ?1",
                [&room],
                |row| row.get(0),
            )
            .unwrap();
        let receipt_count: i64 = database
            .query_row(
                "SELECT COUNT(*) FROM client_welcome_receipts WHERE room_id = ?1 AND outcome = 'joined'",
                [&room],
                |row| row.get(0),
            )
            .unwrap();
        drop(database);

        if *point == "after_welcome_transaction_commit" {
            assert_eq!(
                room_count, 1,
                "committed room index must survive process death"
            );
            assert_eq!(
                receipt_count, 1,
                "committed Welcome receipt must survive process death"
            );
        } else {
            assert_eq!(
                room_count, 0,
                "uncommitted room index must roll back at {point}"
            );
            assert_eq!(
                receipt_count, 0,
                "uncommitted Welcome receipt must roll back at {point}"
            );
        }

        let mut recovered = connect(&engine.base, BOB, PW, "B_CRASH_P0", &bob_db, &keys)
            .expect("SQLCipher database remains readable after process death");
        recovered
            .sync()
            .expect("Welcome must be safely replayed or its committed ACK retried after restart");
        assert_eq!(
            recovered.local_epoch(&room),
            alice.local_epoch(&room),
            "recovered device must materialize the exact invited group epoch"
        );
        assert!(recovered
            .members_of(&room)
            .unwrap()
            .iter()
            .any(|member| member == &format!("{BOB}/B_CRASH_P0")));

        let database = open_encrypted_db(&bob_db, &CRASH_DB_KEY);
        let welcome_id: i64 = database
            .query_row(
                "SELECT welcome_id FROM client_welcome_receipts WHERE room_id = ?1 AND outcome = 'joined'",
                [&room],
                |row| row.get(0),
            )
            .unwrap();
        drop(database);
        assert_eq!(
            recovered.welcome_receipt_status(welcome_id).unwrap(),
            Some(("joined".to_string(), None, true)),
            "the committed Welcome receipt must be ACKed after recovery"
        );
        assert!(
            recovered.sync().unwrap().is_empty(),
            "a repeated sync must not re-materialize or duplicate the joined group"
        );
        assert_eq!(recovered.local_epoch(&room), alice.local_epoch(&room));
    }
}

#[test]
fn invalid_utf8_event_is_quarantined_without_poisoning_room_or_later_messages() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("invalid-utf8-alice");
    let bob_db = db("invalid-utf8-bob");
    let mut alice = connect(&engine.base, ALICE, PW, "A_INVALID_UTF8", &alice_db, &keys).unwrap();
    let mut bob = connect(&engine.base, BOB, PW, "B_INVALID_UTF8", &bob_db, &keys).unwrap();

    bob.ensure_key_packages(2).unwrap();
    let room = "!room-invalid-utf8:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let unreadable_id = alice
        .send_application_payload_with_id(room, &[0xff, 0xfe, 0xfd], "invalid-utf8-event")
        .unwrap();
    let valid_id = alice
        .send_application_payload_with_id(
            room,
            b"valid message after invalid UTF-8",
            "valid-after-invalid-utf8",
        )
        .unwrap();

    let incoming = bob
        .sync()
        .expect("invalid UTF-8 must not make the room enter RecoveryRequired");
    assert!(matches!(
        incoming.as_slice(),
        [
            Incoming::Unreadable { event_id: invalid_id, .. },
            Incoming::Text { event_id: next_id, text, .. }
        ] if invalid_id == &unreadable_id
            && next_id == &valid_id
            && text == "valid message after invalid UTF-8"
    ));
    assert_eq!(bob.desync_reason(room).unwrap(), None);
    assert_eq!(bob.local_epoch(room), alice.local_epoch(room));
    assert_eq!(
        texts(&bob.pending_incoming().unwrap()),
        vec!["valid message after invalid UTF-8"]
    );
    assert!(
        bob.undecryptable()
            .unwrap()
            .iter()
            .any(|row| row.0 == unreadable_id && row.1 == room),
        "invalid UTF-8 must remain visible as a room-scoped unreadable diagnostic"
    );

    bob.acknowledge_incoming(&[unreadable_id, valid_id])
        .unwrap();
    assert!(bob.pending_incoming().unwrap().is_empty());
    assert!(bob.sync().unwrap().is_empty());
    assert_eq!(bob.desync_reason(room).unwrap(), None);
}

#[test]
fn room_sync_access_and_not_found_errors_never_mark_recovery_required() {
    for (index, status) in [401_u16, 403, 404].into_iter().enumerate() {
        let engine = start_engine();
        let proxy = start_status_proxy(&engine.base);
        let keys = MemoryKeyStore::default();
        let alice_db = db(&format!("sync-access-{index}-alice"));
        let bob_db = db(&format!("sync-access-{index}-bob"));
        let mut alice = connect(
            &proxy.base,
            ALICE,
            PW,
            &format!("A_ACCESS_{index}"),
            &alice_db,
            &keys,
        )
        .unwrap();
        let mut bob = connect(
            &proxy.base,
            BOB,
            PW,
            &format!("B_ACCESS_{index}"),
            &bob_db,
            &keys,
        )
        .unwrap();

        bob.ensure_key_packages(2).unwrap();
        let room = format!("!room-sync-access-{index}:inone.test");
        alice.create_room(&room).unwrap();
        alice.invite(&room, BOB).unwrap();
        assert!(bob.sync().unwrap().is_empty());
        alice
            .send_text(&room, "access failures must not poison the room")
            .unwrap();

        proxy.set_status(status);
        let failure = bob
            .sync()
            .expect_err("injected access/not-found response must be returned");
        assert!(
            failure.contains(&format!("-> {status}")),
            "unexpected error for HTTP {status}: {failure}"
        );
        assert_eq!(
            bob.desync_reason(&room).unwrap(),
            None,
            "HTTP {status} must not create RecoveryRequired"
        );

        proxy.set_status(0);
        assert_eq!(
            texts(&bob.sync().unwrap()),
            vec!["access failures must not poison the room"],
            "the same room must recover when access is restored after HTTP {status}"
        );
        assert_eq!(bob.desync_reason(&room).unwrap(), None);
        assert_eq!(bob.local_epoch(&room), alice.local_epoch(&room));
    }
}
