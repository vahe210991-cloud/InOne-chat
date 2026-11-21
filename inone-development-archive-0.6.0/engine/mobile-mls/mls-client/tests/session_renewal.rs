// Токен доступа короткий (1,5 с в тесте): ядро обновляет его само по токену обновления, приложение не участвует.
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread;
use std::time::Duration;

use mls_client::{connect, connect_with_session, resume_with_session, Incoming, MemoryKeyStore};
use serde_json::json;

const PW: &str = "пароль-проверки-1";
const ROOM: &str = "!room-renew:inone.test";

struct Engine {
    child: Child,
    stdin: Option<ChildStdin>,
    base: String,
}

fn start_engine(access_ms: &str) -> Engine {
    let mut child = Command::new("node")
        .arg("tests/engine/start-engine.mjs")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env("INONE_ACCESS_TTL_MS", access_ms)
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
    let path = std::env::temp_dir().join(format!("inone-client-renew-{}-{name}.db", std::process::id()));
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

fn session_tokens(base: &str, user: &str, device: &str) -> (String, String) {
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
fn client_renews_an_expired_access_token_by_itself() {
    let engine = start_engine("1500");
    let keys = MemoryKeyStore::default();
    let mut alice = connect(&engine.base, "@alice:inone.test", PW, "A_PHONE", &db("alice"), &keys).unwrap();
    let mut bob = connect(&engine.base, "@bob:inone.test", PW, "B_PHONE", &db("bob"), &keys).unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@bob:inone.test").unwrap();

    thread::sleep(Duration::from_millis(2000)); // токены доступа истекли
    assert!(bob.sync().unwrap().is_empty(), "синхронизация после истечения работает");
    thread::sleep(Duration::from_millis(2000));
    alice.send_text(ROOM, "после истечения").unwrap();
    thread::sleep(Duration::from_millis(2000));
    assert_eq!(texts(&bob.sync().unwrap()), vec!["после истечения"]);
    bob.logout().unwrap();
    assert!(bob.sync().is_err(), "после выхода сессия не работает");
}

#[test]
fn client_adopts_flutter_session_and_keeps_refresh_token_in_rust() {
    let engine = start_engine("1500");
    let keys = MemoryKeyStore::default();
    let user = "@adopt:inone.test";
    let device = "ADOPT_PHONE";
    let (access, refresh) = session_tokens(&engine.base, user, device);
    let original_access = access.clone();
    let database_path = db("adopt-resume");
    let client = connect_with_session(
        &engine.base,
        user,
        device,
        &access,
        &refresh,
        &database_path,
        &keys,
    )
    .expect("подключение с готовой сессией");
    assert_eq!(client.access_token_snapshot().unwrap(), original_access);

    // Запрос после истечения access token должен обновить пару внутри Rust
    // и атомарно сохранить новую пару в SQLCipher.
    thread::sleep(Duration::from_millis(2000));
    assert_eq!(client.available_key_packages().unwrap(), 0);
    let rotated_access = client.access_token_snapshot().unwrap();
    assert_ne!(rotated_access, original_access, "Flutter получает только обновлённый access token");
    drop(client); // имитируем закрытие процесса приложения

    // Восстановление использует только идентификаторы и ключ системного хранилища:
    // refresh token не передаётся из Flutter повторно.
    let resumed = resume_with_session(
        &engine.base,
        user,
        device,
        &database_path,
        &keys,
    )
    .expect("восстановление сессии после перезапуска");
    assert_eq!(resumed.access_token_snapshot().unwrap(), rotated_access);
    thread::sleep(Duration::from_millis(2000)); // проверяем сохранённый refresh token после перезапуска
    assert_eq!(resumed.available_key_packages().unwrap(), 0, "восстановленная сессия выполняет запрос к серверу");
    let resumed_access = resumed.access_token_snapshot().unwrap();
    assert_ne!(resumed_access, rotated_access, "после перезапуска Rust повторно обновляет сохранённую пару");
    resumed.logout().unwrap();
}


#[test]
fn resume_never_regenerates_a_missing_sqlcipher_key() {
    let engine = start_engine("1500");
    let keys = MemoryKeyStore::default();
    let user = "@missing-key:inone.test";
    let device = "MISSING_KEY_PHONE";
    let (access, refresh) = session_tokens(&engine.base, user, device);
    let database_path = db("missing-key");
    let client = connect_with_session(
        &engine.base,
        user,
        device,
        &access,
        &refresh,
        &database_path,
        &keys,
    )
    .expect("adopt session before simulating key loss");
    drop(client);

    let scope = format!("{user}/{device}");
    keys.delete_database_key(&scope).expect("remove test key");
    let error = resume_with_session(
        &engine.base,
        user,
        device,
        &database_path,
        &keys,
    )
    .expect_err("resume must fail closed when the SQLCipher key is missing");

    assert!(
        error.contains("ключ SQLCipher сохранённой MLS-сессии отсутствует"),
        "unexpected error: {error}"
    );
    assert!(
        !keys.has_database_key(&scope).expect("check key store"),
        "resume must not silently create a replacement key"
    );
}
