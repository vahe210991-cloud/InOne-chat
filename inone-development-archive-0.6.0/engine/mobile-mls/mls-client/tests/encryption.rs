// База устройства зашифрована: без ключа файл не читается, чужой ключ не открывает базу.
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};

use mls_client::{connect, MemoryKeyStore};

const PW: &str = "пароль-проверки-1";

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

#[test]
fn device_database_is_encrypted_and_needs_the_key() {
    let engine = start_engine();
    let file = std::env::temp_dir().join(format!("inone-client-enc-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&file);
    let file = file.to_string_lossy().to_string();
    let keys = MemoryKeyStore::default();
    let _alice = connect(
        &engine.base,
        "@alice:inone.test",
        PW,
        "A_PHONE",
        &file,
        &keys,
    )
    .unwrap();

    let head = std::fs::read(&file).unwrap();
    assert_ne!(
        &head[..16.min(head.len())],
        b"SQLite format 3\0",
        "файл не открывается без ключа"
    );
    let other = MemoryKeyStore::default();
    assert!(
        connect(
            &engine.base,
            "@alice:inone.test",
            PW,
            "A_PHONE",
            &file,
            &other
        )
        .is_err(),
        "чужой ключ не открывает базу"
    );
    assert!(
        connect(
            &engine.base,
            "@alice:inone.test",
            PW,
            "A_PHONE",
            &file,
            &keys
        )
        .is_ok(),
        "свой ключ открывает базу"
    );
}
