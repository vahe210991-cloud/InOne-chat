// P0.3: окно эпох. Опоздавшее сообщение внутри окна читается; за пределами окна — явная ошибка с причиной.
mod common;
use common::*;
use mls_client::MemoryKeyStore;

const ROOM: &str = "!room-p03:inone.test";

#[test]
fn опоздавшее_сообщение_внутри_окна_читается() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("p03a-alice"), db("p03a-bob"));
    let mut alice = login(&engine, &keys, "@alice-p03a:inone.test", "A_P03A", &alice_db);
    let mut bob = login(&engine, &keys, "@bob-p03a:inone.test", "B_P03A", &bob_db);
    bob.upload_key_packages(3).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@bob-p03a:inone.test").unwrap();
    assert!(bob.sync().unwrap().is_empty());

    // Сообщение записано на сервере, но Боб его ещё не получил (задержка доставки).
    alice.send_text(ROOM, "опоздает").unwrap();
    assert!(engine.command(&format!("HIDE {ROOM}")).starts_with("OK"));
    // Пока сообщение в пути, группа уходит вперёд: приглашение — новая эпоха.
    let mut dave = login(&engine, &keys, "@dave-p03a:inone.test", "D_P03A", &db("p03a-dave"));
    dave.upload_key_packages(1).unwrap();
    alice.invite(ROOM, "@dave-p03a:inone.test").unwrap();
    assert!(bob.sync().unwrap().is_empty(), "Боб догоняет эпоху, сообщения ещё нет");
    assert_eq!(bob.local_epoch(ROOM), alice.local_epoch(ROOM), "Боб догнал эпоху Алисы");

    // Сообщение доставлено: эпоха сообщения позади, но внутри окна.
    assert_eq!(engine.command("SHOW"), "OK");
    let got = bob.sync().unwrap();
    assert_eq!(texts(&got), vec!["опоздает"], "опоздавшее сообщение читается");
    assert_eq!(unreadable(&got), 0);
}

#[test]
fn опоздавшее_сообщение_за_окном_помечается_явно() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("p03b-alice"), db("p03b-bob"));
    let mut alice = login(&engine, &keys, "@alice-p03b:inone.test", "A_P03B", &alice_db);
    let mut bob = login(&engine, &keys, "@bob-p03b:inone.test", "B_P03B", &bob_db);
    bob.upload_key_packages(3).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@bob-p03b:inone.test").unwrap();
    assert!(bob.sync().unwrap().is_empty());

    alice.send_text(ROOM, "очень опоздает").unwrap();
    assert!(engine.command(&format!("HIDE {ROOM}")).starts_with("OK"));
    // Группа уходит дальше окна в 16 эпох: семнадцать приглашений.
    for i in 0..17 {
        let user = format!("@m{i:02}-p03b:inone.test");
        let mut m = login(&engine, &keys, &user, &format!("M{i}_P03B"), &db(&format!("p03b-m{i}")));
        m.upload_key_packages(1).unwrap();
        drop(m);
        alice.invite(ROOM, &user).unwrap();
    }
    assert!(bob.sync().unwrap().is_empty());

    assert_eq!(engine.command("SHOW"), "OK");
    let got = bob.sync().unwrap();
    assert!(texts(&got).is_empty(), "за окном текста нет");
    assert_eq!(unreadable(&got), 1, "событие явно помечено нечитаемым");
    let diag = bob.undecryptable().unwrap();
    assert_eq!(diag.len(), 1);
    assert!(diag[0].2.contains("вне окна эпох"), "причина названа: {}", diag[0].2);
    assert!(bob.sync().unwrap().is_empty(), "повтор не выдаёт его снова");
}
