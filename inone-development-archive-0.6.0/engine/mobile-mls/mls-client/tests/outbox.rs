// Очередь без связи, повторы при сбоях сети и отправка с идентификатором клиента.
// Прокси между клиентом и сервером можно выключить: тогда связи нет.
use std::io::{BufRead, BufReader};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
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
    BufReader::new(child.stdout.take().expect("stdout"))
        .read_line(&mut line)
        .expect("строка адреса");
    let base = line
        .trim()
        .strip_prefix("URL=")
        .expect("адрес сервера")
        .to_string();
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

fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!(
        "inone-client-outbox-{}-{name}.db",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    path.to_string_lossy().to_string()
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
