// Сценарий клиента против настоящего сервера движка: приглашение, сообщения, перезапуск устройства,
// отсутствие участника, приход нового, догон по эпохам.
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};

use mls_client::{connect, Client, Incoming, MemoryKeyStore};

const PW: &str = "пароль-проверки-1";
const ROOM: &str = "!room-offline:inone.test";

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

fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!(
        "inone-client-test-{}-{name}.db",
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

fn unreadable(items: &[Incoming]) -> usize {
    items
        .iter()
        .filter(|i| matches!(i, Incoming::Unreadable { .. }))
        .count()
}

fn login(engine: &Engine, keys: &MemoryKeyStore, user: &str, device: &str, file: &str) -> Client {
    connect(&engine.base, user, PW, device, file, keys).expect("вход")
}

fn open_direct_room(engine: &Engine, creator: &Client, peer_user_id: &str) -> String {
    let token = creator.access_token_snapshot().expect("access token snapshot");
    let response = ureq::post(&format!("{}/direct-chats/open", engine.base))
        .set("Authorization", &format!("Bearer {token}"))
        .send_json(serde_json::json!({ "userId": peer_user_id }))
        .expect("create or open direct conversation");
    let payload: serde_json::Value = response.into_json().expect("direct conversation response");
    assert_eq!(payload["status"], "provisioning");
    assert_eq!(payload["created"], true);
    assert_eq!(payload["isCreator"], true);
    payload["roomId"].as_str().expect("opaque room ID").to_string()
}

#[test]
fn direct_messages_are_delivered_without_recipient_approval() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("alice-direct"), db("bob-direct"));
    let mut alice = login(&engine, &keys, "@alice:inone.test", "A_DIRECT", &alice_db);
    let mut bob = login(&engine, &keys, "@bob:inone.test", "B_DIRECT", &bob_db);

    // The recipient publishes KeyPackages automatically as part of device readiness.
    // No request is presented to Bob and there is no accept/reject operation.
    bob.ensure_key_packages(10).unwrap();
    let room = open_direct_room(&engine, &alice, "@bob:inone.test");
    alice.create_room(&room).unwrap();
    alice.invite(&room, "@bob:inone.test").unwrap();

    // Sync processes the MLS Welcome; this is cryptographic provisioning, not consent.
    assert!(bob.sync().unwrap().is_empty());
    alice.send_text(&room, "первое личное сообщение").unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec!["первое личное сообщение"]);

    bob.send_text(&room, "ответ без подтверждения запроса").unwrap();
    assert_eq!(texts(&alice.sync().unwrap()), vec!["ответ без подтверждения запроса"]);
}

#[test]
fn offline_member_catches_up_after_restart_and_new_member_reads_from_join() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db, carol_db) = (db("alice"), db("bob"), db("carol"));
    let mut alice = login(&engine, &keys, "@alice:inone.test", "A_PHONE", &alice_db);
    let mut bob = login(&engine, &keys, "@bob:inone.test", "B_PHONE", &bob_db);
    let mut carol = login(&engine, &keys, "@carol:inone.test", "C_PHONE", &carol_db);
    bob.upload_key_packages(3).unwrap();
    carol.upload_key_packages(3).unwrap();

    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@bob:inone.test").unwrap();
    assert!(
        bob.sync().unwrap().is_empty(),
        "при входе сообщений ещё нет"
    );
    alice.send_text(ROOM, "раз").unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec!["раз"]);

    // Боб перезапускает приложение: эпоха и обработанные сообщения читаются из файла.
    let epoch_before = bob.local_epoch(ROOM);
    drop(bob);
    let mut bob = login(&engine, &keys, "@bob:inone.test", "B_PHONE", &bob_db);
    assert_eq!(
        bob.local_epoch(ROOM),
        epoch_before,
        "эпоха пережила перезапуск"
    );

    // Боб без связи: Алиса пишет и приглашает Кэрол.
    alice.send_text(ROOM, "два").unwrap();
    alice.invite(ROOM, "@carol:inone.test").unwrap();
    alice.send_text(ROOM, "три").unwrap();

    // Кэрол входит и читает только то, что было после её вступления.
    let carol_got = carol.sync().unwrap();
    assert_eq!(texts(&carol_got), vec!["три"]);
    assert_eq!(unreadable(&carol_got), 0);

    // Боб возвращается и догоняет: "раз" не перечитывается, дальше сообщения эпохи 1, коммит, эпоха 2.
    let bob_got = bob.sync().unwrap();
    assert_eq!(texts(&bob_got), vec!["два", "три"]);
    assert_eq!(unreadable(&bob_got), 0, "уже прочитанное не перечитывается");
    assert_eq!(bob.local_epoch(ROOM), Some(2));
    assert!(
        bob.sync().unwrap().is_empty(),
        "повторная синхронизация ничего не отдаёт"
    );

    // Боб отвечает, Алиса читает.
    bob.send_text(ROOM, "четыре").unwrap();
    assert_eq!(texts(&alice.sync().unwrap()), vec!["четыре"]);
    assert_eq!(alice.local_epoch(ROOM), Some(2));
}

#[test]
fn invitation_works_when_regular_packages_run_out() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("alice-reserve"), db("bob-reserve"));
    let mut alice = login(&engine, &keys, "@alice:inone.test", "A_PHONE", &alice_db);
    let mut bob = login(&engine, &keys, "@bob:inone.test", "B_PHONE", &bob_db);
    bob.ensure_key_packages(1).unwrap();
    assert_eq!(bob.available_key_packages().unwrap(), 1);

    alice.create_room("!first:inone.test").unwrap();
    alice
        .invite("!first:inone.test", "@bob:inone.test")
        .unwrap();
    assert_eq!(
        bob.available_key_packages().unwrap(),
        0,
        "обычный пакет израсходован"
    );

    // Обычных больше нет: приглашение проходит по резервному пакету.
    alice.create_room("!second:inone.test").unwrap();
    alice
        .invite("!second:inone.test", "@bob:inone.test")
        .unwrap();
    assert!(bob.sync().unwrap().is_empty());
    alice.send_text("!second:inone.test", "резерв").unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec!["резерв"]);
}

#[test]
fn non_utf8_application_payload_is_quarantined_and_durably_acknowledged() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("alice-invalid-utf8"), db("bob-invalid-utf8"));
    let mut alice = login(&engine, &keys, "@alice:inone.test", "A_UTF8", &alice_db);
    let mut bob = login(&engine, &keys, "@bob:inone.test", "B_UTF8", &bob_db);
    bob.upload_key_packages(2).unwrap();

    let room = "!room-invalid-utf8:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, "@bob:inone.test").unwrap();
    assert!(bob.sync().unwrap().is_empty());

    let invalid_event_id = alice
        .send_application_payload_with_id(room, &[0xff, 0xfe, 0x80], "invalid-utf8-1")
        .expect("MLS accepts opaque application bytes");

    let unreadable_items = bob
        .sync()
        .expect("invalid UTF-8 is an event-level content error");
    assert_eq!(unreadable(&unreadable_items), 1);
    assert!(matches!(
        unreadable_items.as_slice(),
        [Incoming::Unreadable { room_id, event_id, .. }]
            if room_id == room && event_id == &invalid_event_id
    ));
    assert_eq!(bob.desync_reason(room).unwrap(), None);

    let durable_unreadable = bob.pending_incoming().unwrap();
    assert!(matches!(
        durable_unreadable.as_slice(),
        [Incoming::Unreadable { room_id, event_id, .. }]
            if room_id == room && event_id == &invalid_event_id
    ));
    bob.acknowledge_incoming(&[invalid_event_id]).unwrap();
    assert!(bob.pending_incoming().unwrap().is_empty());

    alice
        .send_text(room, "valid message after invalid payload")
        .unwrap();
    let recovered = bob.sync().expect("the same room remains synchronized");
    assert_eq!(
        texts(&recovered),
        vec!["valid message after invalid payload"]
    );
    assert_eq!(unreadable(&recovered), 0);
    assert_eq!(bob.desync_reason(room).unwrap(), None);
}
