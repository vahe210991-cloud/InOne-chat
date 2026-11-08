// F1: permanent Welcome quarantine is durable before ACK; ACK/storage failures retain the same server row.
mod common;
use common::*;
use mls_client::{KeyStore, MemoryKeyStore};

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
fn quarantined_welcome_is_acked_after_restart_when_first_ack_fails() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let bob_db = db("welcome-receipt-retry-bob");
    let mut alice = login(
        &engine,
        &keys,
        "@alice-welcome-retry:inone.test",
        "A_WELCOME_RETRY",
        &db("welcome-receipt-retry-alice"),
    );
    let mut bob = login(
        &engine,
        &keys,
        "@bob-welcome-retry:inone.test",
        "B_WELCOME_RETRY",
        &bob_db,
    );
    bob.upload_key_packages(5).unwrap();

    let bad_room = "!room-welcome-bad-retry:inone.test";
    let healthy_room = "!room-welcome-healthy-retry:inone.test";
    alice.create_room(bad_room).unwrap();
    alice.invite(bad_room, "@bob-welcome-retry:inone.test").unwrap();
    let welcome_id: i64 = engine
        .command(&format!(
            "WELCOME_ID @bob-welcome-retry:inone.test B_WELCOME_RETRY {bad_room}"
        ))
        .parse()
        .unwrap();
    assert_eq!(engine.command(&format!("BAD_WELCOME {bad_room}")), "OK");
    assert_eq!(
        engine.command(&format!("FAIL_NEXT_WELCOME_ACK {welcome_id}")),
        "OK"
    );

    alice.create_room(healthy_room).unwrap();
    alice
        .invite(healthy_room, "@bob-welcome-retry:inone.test")
        .unwrap();

    bob.sync().unwrap();
    assert_eq!(bob.local_epoch(bad_room), None);
    assert_eq!(bob.local_epoch(healthy_room), Some(1));
    let (outcome, reason, acked) = bob
        .welcome_receipt_status(welcome_id)
        .unwrap()
        .expect("quarantine receipt committed before ACK attempt");
    assert_eq!(outcome, "quarantined");
    assert!(reason.unwrap().contains("Malformed Welcome encoding"));
    assert!(!acked, "failed ACK must leave durable receipt pending");
    assert_eq!(engine.command("WELCOME_PENDING @bob-welcome-retry:inone.test B_WELCOME_RETRY"), "1");
    assert_eq!(engine.command(&format!("WELCOME_ACK_COUNT {welcome_id}")), "1");

    // Reopening the same encrypted database retries ACK for the same durable receipt.
    drop(bob);
    let mut bob = login(
        &engine,
        &keys,
        "@bob-welcome-retry:inone.test",
        "B_WELCOME_RETRY",
        &bob_db,
    );
    bob.sync().unwrap();
    let (outcome, reason, acked) = bob
        .welcome_receipt_status(welcome_id)
        .unwrap()
        .expect("same quarantine receipt survives restart");
    assert_eq!(outcome, "quarantined");
    assert!(reason.unwrap().contains("Malformed Welcome encoding"));
    assert!(acked);
    assert_eq!(engine.command("WELCOME_PENDING @bob-welcome-retry:inone.test B_WELCOME_RETRY"), "0");
    assert_eq!(engine.command(&format!("WELCOME_ACK_COUNT {welcome_id}")), "2");
    assert_eq!(bob.local_epoch(healthy_room), Some(1));
}

#[test]
fn welcome_storage_failure_before_receipt_commit_leaves_welcome_unacked() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let bob_db = db("welcome-receipt-storage-bob");
    let mut alice = login(
        &engine,
        &keys,
        "@alice-welcome-storage:inone.test",
        "A_WELCOME_STORAGE",
        &db("welcome-receipt-storage-alice"),
    );
    let mut bob = login(
        &engine,
        &keys,
        "@bob-welcome-storage:inone.test",
        "B_WELCOME_STORAGE",
        &bob_db,
    );
    bob.upload_key_packages(2).unwrap();

    let room = "!room-welcome-storage-failure:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, "@bob-welcome-storage:inone.test").unwrap();
    let welcome_id: i64 = engine
        .command(&format!(
            "WELCOME_ID @bob-welcome-storage:inone.test B_WELCOME_STORAGE {room}"
        ))
        .parse()
        .unwrap();
    assert_eq!(engine.command(&format!("BAD_WELCOME {room}")), "OK");

    let connection = open_device_db(
        &bob_db,
        &keys,
        "@bob-welcome-storage:inone.test",
        "B_WELCOME_STORAGE",
    );
    connection
        .execute_batch(
            "CREATE TRIGGER fail_welcome_receipt_insert
             BEFORE INSERT ON client_welcome_receipts
             BEGIN SELECT RAISE(FAIL, 'simulated receipt storage failure'); END;",
        )
        .unwrap();
    drop(connection);

    bob.sync().unwrap();
    assert_eq!(bob.welcome_receipt_status(welcome_id).unwrap(), None);
    assert_eq!(engine.command("WELCOME_PENDING @bob-welcome-storage:inone.test B_WELCOME_STORAGE"), "1");
    assert_eq!(engine.command(&format!("WELCOME_ACK_COUNT {welcome_id}")), "0");

    let connection = open_device_db(
        &bob_db,
        &keys,
        "@bob-welcome-storage:inone.test",
        "B_WELCOME_STORAGE",
    );
    connection
        .execute_batch("DROP TRIGGER fail_welcome_receipt_insert;")
        .unwrap();
    drop(connection);

    bob.sync().unwrap();
    let (outcome, reason, acked) = bob
        .welcome_receipt_status(welcome_id)
        .unwrap()
        .expect("receipt is written after storage recovers");
    assert_eq!(outcome, "quarantined");
    assert!(reason.unwrap().contains("Malformed Welcome encoding"));
    assert!(acked);
    assert_eq!(engine.command("WELCOME_PENDING @bob-welcome-storage:inone.test B_WELCOME_STORAGE"), "0");
    assert_eq!(engine.command(&format!("WELCOME_ACK_COUNT {welcome_id}")), "1");
}
