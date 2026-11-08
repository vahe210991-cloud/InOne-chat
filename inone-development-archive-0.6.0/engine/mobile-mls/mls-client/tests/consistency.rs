// P0.2: сервер и группа называют одних и тех же участников; расхождение приостанавливает отправку.
mod common;
use common::*;
use mls_client::MemoryKeyStore;

const ROOM: &str = "!room-p02:inone.test";
const CAROL: &str = "@carol-p02:inone.test";

#[test]
fn лишний_участник_на_сервере_приостанавливает_отправку_до_выравнивания() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db, carol_db) = (db("p02-alice"), db("p02-bob"), db("p02-carol"));
    let mut alice = login(&engine, &keys, "@alice-p02:inone.test", "A_P02", &alice_db);
    let mut bob = login(&engine, &keys, "@bob-p02:inone.test", "B_P02", &bob_db);
    let _carol = login(&engine, &keys, CAROL, "C_P02", &carol_db);
    bob.upload_key_packages(3).unwrap();
    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@bob-p02:inone.test").unwrap();
    bob.sync().unwrap();
    assert_eq!(
        bob.desync_reason(ROOM).unwrap(),
        None,
        "при согласованном составе расхождения нет"
    );
    bob.send_text(ROOM, "до").unwrap();

    // Сервер добавляет участника мимо протокола: в группе Кэрол не состоит.
    assert_eq!(engine.command(&format!("ADD_MEMBER {ROOM} {CAROL}")), "OK");
    bob.sync().unwrap();
    let reason = bob
        .desync_reason(ROOM)
        .unwrap()
        .expect("расхождение обнаружено");
    assert!(
        reason.contains("carol-p02"),
        "в причине назван участник: {reason}"
    );
    let refused = bob.send_text(ROOM, "нельзя").unwrap_err();
    assert!(
        refused.contains("рассинхронизирована"),
        "отправка приостановлена: {refused}"
    );

    // Сервер выравнивается: Кэрол снова не участник. Отправка возобновляется.
    assert_eq!(
        engine.command(&format!("REMOVE_MEMBER {ROOM} {CAROL}")),
        "OK"
    );
    bob.sync().unwrap();
    assert_eq!(
        bob.desync_reason(ROOM).unwrap(),
        None,
        "после выравнивания флаг снят"
    );
    bob.send_text(ROOM, "можно").unwrap();
}

#[test]
fn серверное_удаление_не_останавливает_другие_комнаты() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("p02b-alice"), db("p02b-bob"));
    let mut alice = login(
        &engine,
        &keys,
        "@alice-p02b:inone.test",
        "A_P02B",
        &alice_db,
    );
    let mut bob = login(&engine, &keys, "@bob-p02b:inone.test", "B_P02B", &bob_db);
    bob.upload_key_packages(3).unwrap();
    let (gone, kept) = ("!room-p02b-gone:inone.test", "!room-p02b-kept:inone.test");
    alice.create_room(gone).unwrap();
    alice.invite(gone, "@bob-p02b:inone.test").unwrap();
    alice.create_room(kept).unwrap();
    alice.invite(kept, "@bob-p02b:inone.test").unwrap();
    bob.sync().unwrap();

    // Сервер удаляет Боба из первой комнаты мимо протокола: в группе он остаётся.
    assert_eq!(
        engine.command(&format!("REMOVE_MEMBER {gone} @bob-p02b:inone.test")),
        "OK"
    );
    alice.send_text(kept, "вторая комната").unwrap();

    let got = bob
        .sync()
        .expect("синхронизация не падает из-за одной комнаты");
    assert_eq!(
        texts(&got),
        vec!["вторая комната"],
        "вторая комната читается"
    );
    assert!(
        bob.desync_reason(gone).unwrap().is_some(),
        "первая комната помечена расхождением"
    );
    assert!(
        bob.send_text(gone, "нельзя").is_err(),
        "в первую комнату отправка приостановлена"
    );
    assert_eq!(
        bob.desync_reason(kept).unwrap(),
        None,
        "вторая комната в порядке"
    );
}

#[test]
fn испорченный_коммит_одной_комнаты_не_останавливает_другую() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("p04-alice"), db("p04-bob"));
    let mut alice = login(&engine, &keys, "@alice-p04:inone.test", "A_P04", &alice_db);
    let mut bob = login(&engine, &keys, "@bob-p04:inone.test", "B_P04", &bob_db);
    bob.upload_key_packages(3).unwrap();
    let (broken, fine) = ("!room-p04-broken:inone.test", "!room-p04-fine:inone.test");
    alice.create_room(broken).unwrap();
    alice.invite(broken, "@bob-p04:inone.test").unwrap();
    alice.create_room(fine).unwrap();
    alice.invite(fine, "@bob-p04:inone.test").unwrap();
    bob.sync().unwrap();

    // Сервер принял недопустимый коммит в первую комнату.
    assert!(engine
        .command(&format!("BADCOMMIT {broken} @alice-p04:inone.test"))
        .starts_with("OK"));
    alice.send_text(fine, "вторая комната работает").unwrap();

    let got = bob
        .sync()
        .expect("синхронизация не падает из-за одной комнаты");
    assert_eq!(
        texts(&got),
        vec!["вторая комната работает"],
        "вторая комната читается"
    );
    let reason = bob
        .desync_reason(broken)
        .unwrap()
        .expect("первая комната требует восстановления");
    assert!(
        reason.contains("восстановление"),
        "причина названа: {reason}"
    );
    let refused = bob.send_text(broken, "нельзя").unwrap_err();
    assert!(
        refused.contains("рассинхронизирована"),
        "отправка приостановлена: {refused}"
    );
    assert_eq!(
        bob.desync_reason(fine).unwrap(),
        None,
        "вторая комната в порядке"
    );
}

#[test]
fn forged_commit_membership_metadata_is_rejected_before_merge() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db, carol_db) = (
        db("p02-meta-alice"),
        db("p02-meta-bob"),
        db("p02-meta-carol"),
    );
    let mut alice = login(
        &engine,
        &keys,
        "@alice-meta:inone.test",
        "A_META",
        &alice_db,
    );
    let mut bob = login(&engine, &keys, "@bob-meta:inone.test", "B_META", &bob_db);
    let _carol = login(
        &engine,
        &keys,
        "@carol-meta:inone.test",
        "C_META",
        &carol_db,
    );
    bob.upload_key_packages(3).unwrap();
    let room = "!room-p02-meta:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, "@bob-meta:inone.test").unwrap();
    bob.sync().unwrap();
    assert_eq!(bob.local_epoch(room), Some(1));

    // Alice creates a valid Add Commit for Carol, then the delivery service lies about its delta.
    alice.invite(room, "@carol-meta:inone.test").unwrap();
    assert_eq!(engine.command(&format!("BADMETADATA {room}")), "OK");
    bob.sync().unwrap();

    assert_eq!(
        bob.local_epoch(room),
        Some(1),
        "mismatched metadata must not merge the staged Commit"
    );
    let reason = bob
        .desync_reason(room)
        .unwrap()
        .expect("room enters recovery state");
    assert!(
        reason.contains("P0.2"),
        "diagnostic identifies the metadata mismatch: {reason}"
    );
    assert!(
        bob.send_text(room, "must not send").is_err(),
        "sending is blocked until reconciliation"
    );
}
