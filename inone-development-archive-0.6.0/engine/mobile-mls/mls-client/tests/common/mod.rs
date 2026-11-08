// Общий стенд для тестов ядра: настоящий сервер движка, клиенты, команды тестовому движку.
#![allow(dead_code)]
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use mls_client::{connect, Client, Incoming, MemoryKeyStore};

pub const PW: &str = "пароль-проверки-1";

pub struct Engine {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    pub base: String,
}

impl Engine {
    /// Команда тестовому движку (только в тестах): ответ одной строкой.
    pub fn command(&mut self, line: &str) -> String {
        let stdin = self.stdin.as_mut().expect("stdin движка");
        writeln!(stdin, "{line}").expect("команда движку");
        stdin.flush().expect("сброс буфера");
        let mut out = String::new();
        self.stdout.read_line(&mut out).expect("ответ движка");
        out.trim().to_string()
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}

pub fn start_engine() -> Engine {
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

pub fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!(
        "inone-client-test-{}-{name}.db",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    path.to_string_lossy().to_string()
}

pub fn login(
    engine: &Engine,
    keys: &MemoryKeyStore,
    user: &str,
    device: &str,
    db_path: &str,
) -> Client {
    connect(&engine.base, user, PW, device, db_path, keys).expect("вход")
}

pub fn texts(items: &[Incoming]) -> Vec<String> {
    items
        .iter()
        .filter_map(|i| match i {
            Incoming::Text { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

pub fn unreadable(items: &[Incoming]) -> usize {
    items
        .iter()
        .filter(|i| matches!(i, Incoming::Unreadable { .. }))
        .count()
}
