// Клиент получает удалённую конфигурацию с настоящего сервера: умолчания совпадают с сервером, изменения доходят,
// при сбое сети остаются последние значения, на обслуживании записи не уходят, очередь сохраняется.
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use mls_client::remote_config::{
    fetch_public_status, ProductionRemoteConfigService, RemoteConfig, RemoteConfigService, Source,
    MAINTENANCE_MESSAGE,
};
use mls_client::{connect, MemoryKeyStore};

const PW: &str = "пароль-проверки-1";
const ROOM: &str = "!config-client:inone.test";

struct Engine {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
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

impl Engine {
    /// Меняет флаг на сервере так же, как оператор, и ждёт подтверждения.
    fn set_flag(&mut self, key: &str, json: &str) {
        let stdin = self.stdin.as_mut().expect("stdin");
        writeln!(stdin, "FLAG {key} {json}").unwrap();
        stdin.flush().unwrap();
        let mut answer = String::new();
        self.stdout.read_line(&mut answer).unwrap();
        assert_eq!(answer.trim(), "OK", "флаг {key} не принят: {answer}");
    }

    /// Выключает сервер: клиент остаётся без связи.
    fn stop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

fn db(name: &str) -> String {
    let path = std::env::temp_dir().join(format!(
        "inone-remote-config-{}-{name}.db",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    path.to_string_lossy().to_string()
}

#[test]
fn defaults_match_the_server() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice = connect(
        &engine.base,
        "@alice:inone.test",
        PW,
        "A_PHONE",
        &db("defaults"),
        &keys,
    )
    .unwrap();
    let service = ProductionRemoteConfigService::new(&alice);
    let fresh = service.refresh().unwrap();
    assert_eq!(fresh.source, Source::Fresh);
    assert!(
        fresh.same_values(&RemoteConfig::defaults()),
        "умолчания клиента совпадают с сервером"
    );
}

#[test]
fn changed_value_reaches_the_app_and_an_unchanged_one_is_kept() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice = connect(
        &engine.base,
        "@alice:inone.test",
        PW,
        "A_PHONE",
        &db("changes"),
        &keys,
    )
    .unwrap();
    let service = ProductionRemoteConfigService::new(&alice);
    engine.set_flag("groups.maxMembers", "42");
    let fresh = service.refresh().unwrap();
    assert_eq!(fresh.group_max_members, 42);
    assert_eq!(fresh.source, Source::Fresh);
    let again = service.refresh().unwrap();
    assert_eq!(again.group_max_members, 42, "сервер ответил «не менялось»");
    assert_eq!(again.source, Source::Cached);
}

#[test]
fn app_keeps_the_last_values_when_the_server_is_unreachable() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice = connect(
        &engine.base,
        "@alice:inone.test",
        PW,
        "A_PHONE",
        &db("offline"),
        &keys,
    )
    .unwrap();
    let service = ProductionRemoteConfigService::new(&alice);
    engine.set_flag("groups.maxMembers", "42");
    service.refresh().unwrap();
    engine.stop();
    assert!(
        service.refresh().is_err(),
        "без сети обновление сообщает об ошибке"
    );
    let kept = service.current();
    assert_eq!(
        kept.group_max_members, 42,
        "последние сохранённые значения остаются"
    );
    assert_eq!(kept.source, Source::Cached);
}

#[test]
fn without_any_data_the_app_uses_the_defaults() {
    let engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice = connect(
        &engine.base,
        "@alice:inone.test",
        PW,
        "A_PHONE",
        &db("nodata"),
        &keys,
    )
    .unwrap();
    let service = ProductionRemoteConfigService::new(&alice);
    let now = service.current();
    assert_eq!(
        now.source,
        Source::Defaults,
        "ещё не было ни одного обновления"
    );
    assert!(now.same_values(&RemoteConfig::defaults()));
}

#[test]
fn maintenance_stops_writes_but_keeps_the_outbox() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let mut alice = connect(
        &engine.base,
        "@alice:inone.test",
        PW,
        "A_PHONE",
        &db("maintenance"),
        &keys,
    )
    .unwrap();
    alice.create_room(ROOM).unwrap();
    let mut bob = connect(
        &engine.base,
        "@bob:inone.test",
        PW,
        "B_PHONE",
        &db("maintenance-bob"),
        &keys,
    )
    .unwrap();
    bob.ensure_key_packages(1).unwrap();
    alice.invite(ROOM, "@bob:inone.test").unwrap(); // группа получает состояние на сервере
    engine.set_flag("maintenance.enabled", "true");
    ProductionRemoteConfigService::new(&alice)
        .refresh()
        .unwrap();
    let err = alice.send_text(ROOM, "текст").unwrap_err();
    assert_eq!(
        err, MAINTENANCE_MESSAGE,
        "отправка на обслуживании отказана понятно"
    );
    alice.enqueue_text(ROOM, "в очередь").unwrap();
    assert_eq!(alice.outbox_len().unwrap(), 1);
    assert_eq!(
        alice.flush_outbox().unwrap(),
        0,
        "на обслуживании очередь не отправляется"
    );
    assert_eq!(alice.outbox_len().unwrap(), 1, "очередь сохранена");
    engine.set_flag("maintenance.enabled", "false");
    ProductionRemoteConfigService::new(&alice)
        .refresh()
        .unwrap();
    assert_eq!(
        alice.flush_outbox().unwrap(),
        1,
        "после обслуживания очередь уходит"
    );
    assert_eq!(alice.outbox_len().unwrap(), 0);
}

#[test]
fn public_status_is_read_without_signing_in() {
    let mut engine = start_engine();
    engine.set_flag("maintenance.enabled", "true");
    engine.set_flag("app.minVersion", "\"1.2.0\"");
    let status = fetch_public_status(&engine.base).unwrap();
    assert!(status.maintenance, "обслуживание видно до входа");
    assert_eq!(status.min_version, "1.2.0");
    assert!(
        fetch_public_status("http://127.0.0.1:9").is_err(),
        "без связи статус не выдумывается"
    );
}

#[test]
fn minimum_version_from_the_server_decides_what_the_app_supports() {
    let mut engine = start_engine();
    engine.set_flag("app.minVersion", "\"1.2.0\"");
    let keys = MemoryKeyStore::default();
    let alice = connect(
        &engine.base,
        "@alice:inone.test",
        PW,
        "A_PHONE",
        &db("minver"),
        &keys,
    )
    .unwrap();
    let cfg = ProductionRemoteConfigService::new(&alice)
        .refresh()
        .unwrap();
    assert!(
        !cfg.supports_version("1.1.9"),
        "старая версия не поддерживается"
    );
    assert!(
        cfg.supports_version("1.2.0"),
        "минимальная версия поддерживается"
    );
    assert!(cfg.supports_version("1.10.0"), "1.10.0 новее 1.2.0");
}
