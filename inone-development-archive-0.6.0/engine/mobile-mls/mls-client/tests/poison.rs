// P0.1: сообщение, которое сервер принял, а клиент не может расшифровать, не блокирует комнату.
mod common;
use common::*;
use mls_client::MemoryKeyStore;

const ROOM: &str = "!room-p01:inone.test";

#[test]
fn испорченное_сообщение_не_блокирует_комнату() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("p01-alice"), db("p01-bob"));
    let mut alice = login(&engine, &keys, "@alice-p01:inone.test", "A_P01", &alice_db);
    let mut bob = login(&engine, &keys, "@bob-p01:inone.test", "B_P01", &bob_db);
    bob.upload_key_packages(3).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@bob-p01:inone.test").unwrap();
    assert!(bob.sync().unwrap().is_empty());
    alice.send_text(ROOM, "до").unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec!["до"]);

    // Сообщение с правильным заголовком, но с испорченным шифротекстом: сервер его не проверяет.
    assert!(
        engine.command(&format!("CORRUPT {ROOM}")).starts_with("OK"),
        "порча записана"
    );
    alice.send_text(ROOM, "после").unwrap();

    let got = bob.sync().unwrap();
    assert_eq!(
        texts(&got),
        vec!["после"],
        "комната не заблокирована: следующее сообщение читается"
    );
    assert_eq!(
        unreadable(&got),
        1,
        "испорченное сообщение помечено нечитаемым"
    );
    let diag = bob.undecryptable().unwrap();
    assert_eq!(diag.len(), 1, "причина записана в диагностику");
    assert_eq!(diag[0].2, "проверка сообщения не пройдена");
    assert!(
        bob.sync().unwrap().is_empty(),
        "повторная синхронизация не выдаёт его снова"
    );
}

#[test]
fn испорченная_кодировка_одного_сообщения_не_останавливает_комнату() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("p01b-alice"), db("p01b-bob"));
    let mut alice = login(
        &engine,
        &keys,
        "@alice-p01b:inone.test",
        "A_P01B",
        &alice_db,
    );
    let mut bob = login(&engine, &keys, "@bob-p01b:inone.test", "B_P01B", &bob_db);
    let room = "!room-p01b:inone.test";
    bob.upload_key_packages(3).unwrap();
    alice.create_room(room).unwrap();
    alice.invite(room, "@bob-p01b:inone.test").unwrap();
    assert!(bob.sync().unwrap().is_empty());
    alice.send_text(room, "до").unwrap();
    assert_eq!(texts(&bob.sync().unwrap()), vec!["до"]);

    // Событие с полем, которое не является base64: сервер хранит его как есть.
    assert!(engine.command(&format!("BADB64 {room}")).starts_with("OK"));
    alice.send_text(room, "после").unwrap();
    let got = bob
        .sync()
        .expect("синхронизация не падает из-за кодировки одного события");
    assert_eq!(texts(&got), vec!["после"], "комната читается дальше");
    assert_eq!(unreadable(&got), 1, "событие помечено нечитаемым");
    assert_eq!(
        bob.undecryptable().unwrap()[0].2,
        "сообщение не разбирается"
    );
}
