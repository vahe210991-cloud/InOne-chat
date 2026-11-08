mod common;
use common::{db, login, start_engine};
use mls_client::{KeyStore, MemoryKeyStore};

const ROOM: &str = "!room-membership-journal:inone.test";
const ALICE: &str = "@alice:inone.test";
const BOB: &str = "@bob:inone.test";

#[test]
fn accepted_commit_with_lost_response_replays_after_client_restart() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-membership-journal");
    let bob_db = db("bob-membership-journal");
    let mut alice = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    let mut bob = login(&engine, &keys, BOB, "B_PHONE", &bob_db);
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();

    assert_eq!(engine.command("DROP_NEXT_COMMIT_RESPONSE"), "OK");
    let error = alice.invite(ROOM, BOB).unwrap_err();
    assert!(
        error.contains("-> 500"),
        "expected ambiguous HTTP failure, got: {error}"
    );
    assert_eq!(
        alice.local_epoch(ROOM),
        Some(0),
        "unacknowledged staged commit is not merged"
    );
    drop(alice);

    let mut restarted = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    restarted
        .sync()
        .expect("restart replays the exact operation and merges its pending commit");
    assert_eq!(restarted.local_epoch(ROOM), Some(1));
    assert_eq!(
        engine.command(&format!("COMMIT_COUNT {ROOM}")),
        "1",
        "server accepted exactly one commit"
    );
    assert!(
        bob.sync().unwrap().is_empty(),
        "invited device joins from the single Welcome"
    );
}

fn open_device_db(
    path: &str,
    keys: &MemoryKeyStore,
    user_id: &str,
    device_id: &str,
) -> rusqlite::Connection {
    let key = keys
        .database_key(&format!("{user_id}/{device_id}"))
        .unwrap();
    let key_hex: String = key.iter().map(|byte| format!("{byte:02x}")).collect();
    let connection = rusqlite::Connection::open(path).unwrap();
    connection
        .pragma_update(None, "key", format!("x'{key_hex}'"))
        .unwrap();
    connection
}

#[test]
fn journal_insert_storage_failure_rolls_back_staged_commit_and_can_retry() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-membership-insert-failure");
    let mut alice = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    let mut bob = login(
        &engine,
        &keys,
        BOB,
        "B_PHONE",
        &db("bob-membership-insert-failure"),
    );
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();

    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    connection
        .execute_batch(
            "CREATE TRIGGER fail_membership_journal_insert
         BEFORE INSERT ON client_membership_commits
         BEGIN SELECT RAISE(FAIL, 'simulated membership journal insert failure'); END;",
        )
        .unwrap();
    drop(connection);

    let error = alice.invite(ROOM, BOB).unwrap_err();
    assert!(
        error.contains("simulated membership journal insert failure"),
        "{error}"
    );
    assert_eq!(
        alice.local_epoch(ROOM),
        Some(0),
        "staged MLS mutation rolled back"
    );
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "0");

    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    connection
        .execute_batch("DROP TRIGGER fail_membership_journal_insert;")
        .unwrap();
    drop(connection);

    alice.invite(ROOM, BOB).unwrap();
    assert_eq!(alice.local_epoch(ROOM), Some(1));
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "1");
}

#[test]
fn settlement_storage_failure_keeps_exact_journal_until_restart_replay() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-membership-settlement-failure");
    let mut alice = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    let mut bob = login(
        &engine,
        &keys,
        BOB,
        "B_PHONE",
        &db("bob-membership-settlement-failure"),
    );
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();

    assert_eq!(engine.command("DROP_NEXT_COMMIT_RESPONSE"), "OK");
    assert!(alice.invite(ROOM, BOB).unwrap_err().contains("-> 500"));
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "1");

    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    connection
        .execute_batch(
            "CREATE TRIGGER fail_membership_journal_delete
         BEFORE DELETE ON client_membership_commits
         BEGIN SELECT RAISE(FAIL, 'simulated membership journal delete failure'); END;",
        )
        .unwrap();
    drop(connection);

    let error = alice.sync().unwrap_err();
    assert!(
        error.contains("временная ошибка локального хранилища"),
        "{error}"
    );
    assert_eq!(
        alice.local_epoch(ROOM),
        Some(0),
        "settlement transaction rolled back"
    );
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "1");

    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    connection
        .execute_batch("DROP TRIGGER fail_membership_journal_delete;")
        .unwrap();
    drop(connection);
    drop(alice);

    let mut restarted = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    restarted.sync().unwrap();
    assert_eq!(restarted.local_epoch(ROOM), Some(1));
    assert_eq!(
        engine.command(&format!("COMMIT_COUNT {ROOM}")),
        "1",
        "the server's accepted operation is replayed, never duplicated"
    );
}

#[test]
fn pending_commit_fingerprint_mismatch_keeps_journal_and_requires_recovery() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-membership-fingerprint-mismatch");
    let mut alice = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    let mut bob = login(
        &engine,
        &keys,
        BOB,
        "B_PHONE",
        &db("bob-membership-fingerprint-mismatch"),
    );
    bob.ensure_key_packages(1).unwrap();
    alice.create_room(ROOM).unwrap();

    assert_eq!(engine.command("DROP_NEXT_COMMIT_RESPONSE"), "OK");
    assert!(alice.invite(ROOM, BOB).unwrap_err().contains("-> 500"));
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "1");

    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    connection
        .execute(
            "UPDATE client_membership_commits SET fingerprint = ?1 WHERE room_id = ?2",
            rusqlite::params!["0".repeat(64), ROOM],
        )
        .unwrap();
    drop(connection);
    drop(alice);

    let mut restarted = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    let error = restarted.sync().unwrap_err();
    assert!(error.contains("fingerprint mismatch"), "{error}");
    assert_eq!(
        restarted.local_epoch(ROOM),
        Some(0),
        "unverified pending Commit is not merged"
    );
    assert!(restarted
        .desync_reason(ROOM)
        .unwrap()
        .is_some_and(|reason| reason.starts_with("RecoveryRequired:")));
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "1");
    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    let journal_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM client_membership_commits WHERE room_id = ?1",
            [ROOM],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        journal_rows, 1,
        "mismatched journal is retained for explicit recovery"
    );
}


#[test]
fn stale_commit_clear_storage_failure_retains_journal_then_rebases_safely() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let alice_db = db("alice-membership-stale-clear");
    let mut alice = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    let mut dave = login(&engine, &keys, "@dave:inone.test", "D_PHONE", &db("dave-membership-stale-clear"));
    let mut bob = login(&engine, &keys, BOB, "B_PHONE", &db("bob-membership-stale-clear"));
    let mut eve = login(&engine, &keys, "@eve:inone.test", "E_PHONE", &db("eve-membership-stale-clear"));
    bob.ensure_key_packages(1).unwrap();
    eve.ensure_key_packages(1).unwrap();

    alice.create_room(ROOM).unwrap();
    alice.invite(ROOM, "@dave:inone.test").unwrap();
    dave.sync().unwrap();
    assert_eq!(dave.local_epoch(ROOM), Some(1));

    assert_eq!(engine.command("FAIL_NEXT_COMMIT_BEFORE_APPLY"), "OK");
    assert!(alice.invite(ROOM, BOB).unwrap_err().contains("-> 500"));
    assert_eq!(alice.local_epoch(ROOM), Some(1));
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "1");

    // Another valid member advances the room while Alice's exact staged Commit is pending.
    dave.invite(ROOM, "@eve:inone.test").unwrap();
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "2");

    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    connection.execute_batch(
        "CREATE TRIGGER fail_stale_membership_delete
         BEFORE DELETE ON client_membership_commits
         BEGIN SELECT RAISE(FAIL, 'simulated stale journal delete failure'); END;",
    ).unwrap();
    drop(connection);

    let error = alice.sync().unwrap_err();
    assert!(error.contains("временная ошибка локального хранилища при очистке stale membership commit"), "{error}");
    assert_eq!(alice.local_epoch(ROOM), Some(1), "failed stale-clear transaction rolls back OpenMLS state");
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "2");
    assert_eq!(alice.desync_reason(ROOM).unwrap(), None, "transient local storage failure is not RecoveryRequired");

    let connection = open_device_db(&alice_db, &keys, ALICE, "A_PHONE");
    connection.execute_batch("DROP TRIGGER fail_stale_membership_delete;").unwrap();
    drop(connection);

    alice.sync().unwrap();
    assert_eq!(alice.local_epoch(ROOM), Some(3), "client catches up and rebases the same invite intent");
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "3");
    assert_eq!(alice.desync_reason(ROOM).unwrap(), None);
}
