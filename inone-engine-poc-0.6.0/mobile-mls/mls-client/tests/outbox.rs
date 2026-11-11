// Очередь без связи, повторы при сбоях сети и отправка с идентификатором клиента.
// Прокси между клиентом и сервером можно выключить: тогда связи нет.
use std::io::{BufRead, BufReader};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use mls_client::{connect, connect_with_session, is_retryable, resume_with_session, Incoming, MemoryKeyStore};
use serde_json::json;

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
    assert_eq!(alice.flush_outbox().unwrap(), 0, "без связи ничего не отправлено");
    assert_eq!(alice.outbox_len().unwrap(), 1, "сообщение осталось в очереди");

    proxy.set_online(true);
    assert_eq!(alice.flush_outbox().unwrap(), 1, "после связи отправлено");
    assert_eq!(alice.outbox_len().unwrap(), 0);
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
    assert!(is_retryable(&failed), "сбой сети — временный: {failed}");
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
    assert_eq!(texts(&bob.sync().unwrap()), vec!["раз"]);
}


fn login_tokens(base: &str, user: &str, device: &str) -> (String, String) {
    let agent = ureq::AgentBuilder::new().build();
    match agent
        .post(&format!("{base}/register"))
        .send_json(json!({ "userId": user, "password": PW }))
    {
        Ok(_) | Err(ureq::Error::Status(409, _)) => {}
        Err(error) => panic!("регистрация тестового пользователя: {error}"),
    }
    let login = agent
        .post(&format!("{base}/login"))
        .send_json(json!({ "userId": user, "password": PW, "deviceId": device }))
        .expect("вход для получения сессии")
        .into_json::<serde_json::Value>()
        .expect("JSON ответа входа");
    (
        login["token"].as_str().expect("access token").to_string(),
        login["refreshToken"].as_str().expect("refresh token").to_string(),
    )
}

#[test]
fn offline_outbox_survives_process_restart_and_flushes_once() {
    let engine = start_engine();
    let proxy = start_proxy(&engine.base);
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-resume");
    let (access, refresh) = login_tokens(&proxy.base, ALICE, "A_PHONE");
    let mut alice = connect_with_session(
        &proxy.base, ALICE, "A_PHONE", &access, &refresh, &alice_db, &keys,
    ).unwrap();
    let mut bob = connect(&proxy.base, BOB, PW, "B_PHONE", &db("bob-resume"), &keys).unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    proxy.set_online(false);
    alice.enqueue_text(ROOM, "очередь переживает перезапуск").unwrap();
    assert_eq!(alice.outbox_len().unwrap(), 1);
    let queued_plaintext = "очередь переживает перезапуск".as_bytes();
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = format!("{alice_db}{suffix}");
        if let Ok(ciphertext) = std::fs::read(path) {
            if ciphertext.len() >= queued_plaintext.len() {
                assert!(
                    !ciphertext.windows(queued_plaintext.len()).any(|window| window == queued_plaintext),
                    "текст offline outbox не должен находиться в файлах базы открытым текстом"
                );
            }
        }
    }
    drop(alice);

    let mut resumed = resume_with_session(&proxy.base, ALICE, "A_PHONE", &alice_db, &keys)
        .expect("восстановление MLS-сессии и outbox после перезапуска");
    assert_eq!(resumed.outbox_len().unwrap(), 1);

    proxy.set_online(true);
    assert_eq!(resumed.flush_outbox().unwrap(), 1);
    assert_eq!(resumed.outbox_len().unwrap(), 0);
    assert_eq!(resumed.flush_outbox().unwrap(), 0);
    assert_eq!(
        texts(&bob.sync().unwrap()),
        vec!["очередь переживает перезапуск"],
        "получатель видит ровно одно расшифрованное сообщение"
    );
    resumed.logout().unwrap();
}


#[test]
fn encrypted_inbox_survives_restart_until_explicit_acknowledgement() {
    let engine = start_engine();
    let proxy = start_proxy(&engine.base);
    let keys = MemoryKeyStore::default();
    let mut alice = connect(&proxy.base, ALICE, PW, "A_PHONE", &db("alice-inbox"), &keys).unwrap();

    let bob_db = db("bob-inbox");
    let (bob_access, bob_refresh) = login_tokens(&proxy.base, BOB, "B_PHONE");
    let mut bob = connect_with_session(
        &proxy.base, BOB, "B_PHONE", &bob_access, &bob_refresh, &bob_db, &keys,
    ).unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, BOB).unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let plaintext = "входящее сообщение сохраняется после перезапуска";
    alice.send_text(ROOM, plaintext).unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec![plaintext.to_string()]);

    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = format!("{bob_db}{suffix}");
        if let Ok(ciphertext) = std::fs::read(path) {
            if ciphertext.len() >= plaintext.len() {
                assert!(
                    !ciphertext.windows(plaintext.len()).any(|window| window == plaintext.as_bytes()),
                    "входящий plaintext не должен храниться в файлах базы открытым текстом"
                );
            }
        }
    }
    drop(bob);

    let mut resumed = resume_with_session(&proxy.base, BOB, "B_PHONE", &bob_db, &keys)
        .expect("восстановление локального inbox после перезапуска");
    let pending = resumed.pending_incoming().unwrap();
    assert_eq!(texts(&pending), vec![plaintext.to_string()]);
    let event_ids: Vec<String> = pending
        .iter()
        .map(|item| match item {
            Incoming::Text { event_id, .. } | Incoming::Unreadable { event_id, .. } => event_id.clone(),
        })
        .collect();
    resumed.acknowledge_incoming(&event_ids).unwrap();
    assert!(resumed.pending_incoming().unwrap().is_empty());
    assert_eq!(texts(&resumed.messages_for_room(ROOM).unwrap()), vec![plaintext.to_string()]);
    resumed.logout().unwrap();
}
