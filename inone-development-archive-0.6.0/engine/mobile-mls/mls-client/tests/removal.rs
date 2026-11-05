// Второе устройство входит по подтверждению; отозванное устройство удаляется из групп коммитом клиента.
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};

use mls_client::{connect, connect_with_approval, Client, Incoming, MemoryKeyStore};

const PW: &str = "пароль-проверки-1";
const ROOM: &str = "!room-removal:inone.test";

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

fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!("inone-client-removal-{}-{name}.db", std::process::id()));
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
fn revoked_device_is_removed_from_groups_by_a_commit() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let mut alice = connect(&engine.base, "@alice:inone.test", PW, "A_PHONE", &db("alice"), &keys).unwrap();
    let mut bob_phone = connect(&engine.base, "@bob:inone.test", PW, "B_PHONE", &db("bob-phone"), &keys).unwrap();
    bob_phone.upload_key_packages(2).unwrap();
    let mut bob_old: Client = connect_with_approval(&engine.base, "@bob:inone.test", PW, "B_OLD", &db("bob-old"), &keys, &bob_phone).unwrap();
    bob_old.upload_key_packages(2).unwrap();

    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@bob:inone.test").unwrap();
    assert!(bob_phone.sync().unwrap().is_empty());
    assert!(bob_old.sync().unwrap().is_empty());
    alice.sync().unwrap();
    let members = alice.members_of(ROOM).unwrap();
    assert!(members.contains(&"@bob:inone.test/B_OLD".to_string()), "второе устройство в группе: {members:?}");

    // Старое устройство отозвано с основного: в группах остаётся запись, пока коммит не удалит листок.
    bob_phone.revoke_device("B_OLD").unwrap();
    assert_eq!(bob_phone.pending_removals().unwrap(), 1);
    assert_eq!(bob_phone.remove_revoked_devices().unwrap(), 1);
    assert_eq!(bob_phone.pending_removals().unwrap(), 0, "запись закрыта коммитом");

    // Алиса получает коммит удаления: листка отозванного устройства в группе больше нет.
    alice.sync().unwrap();
    let members = alice.members_of(ROOM).unwrap();
    assert!(!members.contains(&"@bob:inone.test/B_OLD".to_string()), "листок удалён: {members:?}");
    assert!(members.contains(&"@bob:inone.test/B_PHONE".to_string()));

    // Группа работает дальше; отозванное устройство больше не входит в API.
    alice.send_text(ROOM, "после удаления").unwrap();
    assert_eq!(texts(&bob_phone.sync().unwrap()), vec!["после удаления"]);
    assert!(bob_old.sync().is_err(), "отозванное устройство не получает данные");
}
