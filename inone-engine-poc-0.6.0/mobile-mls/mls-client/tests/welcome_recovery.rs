// F1: Welcome failures are isolated, durable receipts precede ACK, and duplicate groups are not ACKed.
mod common;
use common::*;
use mls_client::MemoryKeyStore;

#[test]
fn duplicate_welcome_is_retained_and_does_not_block_healthy_room() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (db("f1-welcome-alice"), db("f1-welcome-bob"));
    let mut alice = login(&engine, &keys, "@alice-f1:inone.test", "A_F1", &alice_db);
    let mut bob = login(&engine, &keys, "@bob-f1:inone.test", "B_F1", &bob_db);
    bob.upload_key_packages(5).unwrap();

    let duplicate_room = "!room-f1-duplicate:inone.test";
    let healthy_room = "!room-f1-healthy:inone.test";
    alice.create_room(duplicate_room).unwrap();
    alice.invite(duplicate_room, "@bob-f1:inone.test").unwrap();
    bob.sync().unwrap();
    assert_eq!(bob.local_epoch(duplicate_room), Some(1));

    // A new healthy Welcome arrives together with a replay of the already-consumed Welcome.
    alice.create_room(healthy_room).unwrap();
    alice.invite(healthy_room, "@bob-f1:inone.test").unwrap();
    let replay = engine.command(&format!(
        "REPLAY_WELCOME {duplicate_room} @bob-f1:inone.test B_F1"
    ));
    assert!(replay.starts_with("OK "), "test replay enabled: {replay}");
    let replay_id = replay.split_whitespace().nth(1).unwrap();

    bob.sync()
        .expect("duplicate Welcome in one room must not stop other welcomes");
    assert_eq!(
        bob.local_epoch(healthy_room),
        Some(1),
        "healthy Welcome joined"
    );
    let reason = bob
        .desync_reason(duplicate_room)
        .unwrap()
        .expect("duplicate Welcome requires room recovery");
    assert!(
        reason.starts_with("RecoveryRequired:"),
        "durable recovery marker: {reason}"
    );
    assert!(bob.send_text(duplicate_room, "blocked").is_err());

    // An ordinary membership check cannot clear RecoveryRequired.
    bob.sync().unwrap();
    let reason_after_check = bob
        .desync_reason(duplicate_room)
        .unwrap()
        .expect("RecoveryRequired remains sticky");
    assert!(reason_after_check.starts_with("RecoveryRequired:"));

    alice
        .send_text(healthy_room, "healthy room continues")
        .unwrap();
    let incoming = bob.sync().unwrap();
    assert!(texts(&incoming).contains(&"healthy room continues".to_string()));
    assert_eq!(
        engine.command(&format!("WELCOME_ACK_ATTEMPTED {replay_id}")),
        "NO",
        "GroupAlreadyExists must retain the old Welcome without ACK"
    );
}
