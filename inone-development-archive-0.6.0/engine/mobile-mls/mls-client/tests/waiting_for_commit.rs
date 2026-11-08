// P0.3: a future-epoch event without its Commit is durably room-scoped and retryable.
mod common;
use common::*;
use mls_client::MemoryKeyStore;

#[test]
fn missing_commit_is_durable_room_scoped_and_recovers_when_commit_arrives() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let target_room = "!room-waiting-commit:inone.test";
    let healthy_room = "!room-waiting-healthy:inone.test";
    let bob_db = db("waiting-commit-bob");
    let mut alice = login(
        &engine,
        &keys,
        "@alice-waiting:inone.test",
        "A_WAITING",
        &db("waiting-commit-alice"),
    );
    let mut bob = login(
        &engine,
        &keys,
        "@bob-waiting:inone.test",
        "B_WAITING",
        &bob_db,
    );
    let mut dave = login(
        &engine,
        &keys,
        "@dave-waiting:inone.test",
        "D_WAITING",
        &db("waiting-commit-dave"),
    );
    bob.upload_key_packages(5).unwrap();
    dave.upload_key_packages(1).unwrap();

    alice.create_room(target_room).unwrap();
    alice.invite(target_room, "@bob-waiting:inone.test").unwrap();
    bob.sync().unwrap();
    assert_eq!(bob.local_epoch(target_room), Some(1));

    alice.create_room(healthy_room).unwrap();
    alice.invite(healthy_room, "@bob-waiting:inone.test").unwrap();
    bob.sync().unwrap();
    assert_eq!(bob.local_epoch(healthy_room), Some(1));

    // The target room advances, then receives an event in the new epoch.
    alice.invite(target_room, "@dave-waiting:inone.test").unwrap();
    alice.send_text(target_room, "held until its Commit arrives").unwrap();
    alice.send_text(healthy_room, "unrelated room remains healthy").unwrap();
    assert_eq!(engine.command(&format!("HIDE_COMMIT {target_room}")), "OK");

    let first_sync = bob.sync().unwrap();
    assert!(
        texts(&first_sync).contains(&"unrelated room remains healthy".to_string()),
        "a missing Commit in one room must not block another room"
    );
    assert!(
        !texts(&first_sync).contains(&"held until its Commit arrives".to_string()),
        "future-epoch event must remain pending"
    );
    let waiting = bob
        .desync_reason(target_room)
        .unwrap()
        .expect("WaitingForCommit is durable");
    assert!(waiting.starts_with("WaitingForCommit:"), "{waiting}");
    assert!(bob.send_text(target_room, "must remain blocked").is_err());
    bob.send_text(healthy_room, "healthy room can still send").unwrap();

    // The marker survives reopening the encrypted client database.
    drop(bob);
    let mut bob = login(
        &engine,
        &keys,
        "@bob-waiting:inone.test",
        "B_WAITING",
        &bob_db,
    );
    assert!(
        bob.desync_reason(target_room)
            .unwrap()
            .is_some_and(|reason| reason.starts_with("WaitingForCommit:"))
    );
    assert_eq!(engine.command(&format!("SHOW_COMMIT {target_room}")), "OK");

    let recovered = bob.sync().unwrap();
    assert!(
        texts(&recovered).contains(&"held until its Commit arrives".to_string()),
        "event is retried after the missing Commit is available"
    );
    assert_eq!(bob.local_epoch(target_room), alice.local_epoch(target_room));
    assert_eq!(bob.desync_reason(target_room).unwrap(), None);
    assert_eq!(bob.desync_reason(healthy_room).unwrap(), None);
}
