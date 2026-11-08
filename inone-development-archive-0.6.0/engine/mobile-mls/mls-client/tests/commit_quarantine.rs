// P0.3: permanent Commit failures are durably quarantined per room; transient failures remain retryable.
mod common;
use common::*;
use mls_client::MemoryKeyStore;

#[test]
fn permanent_commit_failure_is_quarantined_across_restart_without_poisoning_other_rooms() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let target_room = "!room-commit-quarantine:inone.test";
    let healthy_room = "!room-commit-quarantine-healthy:inone.test";
    let bob_db = db("commit-quarantine-bob");
    let mut alice = login(
        &engine,
        &keys,
        "@alice-quarantine:inone.test",
        "A_QUARANTINE",
        &db("commit-quarantine-alice"),
    );
    let mut bob = login(
        &engine,
        &keys,
        "@bob-quarantine:inone.test",
        "B_QUARANTINE",
        &bob_db,
    );
    bob.upload_key_packages(5).unwrap();

    alice.create_room(target_room).unwrap();
    alice
        .invite(target_room, "@bob-quarantine:inone.test")
        .unwrap();
    bob.sync().unwrap();

    alice.create_room(healthy_room).unwrap();
    alice
        .invite(healthy_room, "@bob-quarantine:inone.test")
        .unwrap();
    bob.sync().unwrap();
    alice
        .send_text(healthy_room, "healthy room continues")
        .unwrap();

    assert!(engine
        .command(&format!(
            "BADCOMMIT {target_room} @alice-quarantine:inone.test"
        ))
        .starts_with("OK "));

    let incoming = bob.sync().unwrap();
    assert!(
        texts(&incoming).contains(&"healthy room continues".to_string()),
        "a permanently invalid Commit in one room must not stop healthy rooms"
    );
    let reason = bob
        .quarantined_commit_reason(target_room, 2)
        .unwrap()
        .expect("permanent Commit failure is durably quarantined");
    assert!(reason.contains("Commit encoding is invalid"), "{reason}");
    assert!(bob
        .desync_reason(target_room)
        .unwrap()
        .is_some_and(|value| value.starts_with("RecoveryRequired:")));

    // The same exact Commit is not reprocessed after another sync or a client restart.
    assert!(bob.sync().unwrap().is_empty());
    drop(bob);
    let mut bob = login(
        &engine,
        &keys,
        "@bob-quarantine:inone.test",
        "B_QUARANTINE",
        &bob_db,
    );
    assert!(bob.sync().unwrap().is_empty());
    assert!(bob
        .quarantined_commit_reason(target_room, 2)
        .unwrap()
        .is_some());
    assert!(bob.send_text(target_room, "blocked").is_err());

    alice
        .send_text(healthy_room, "healthy after quarantine")
        .unwrap();
    let after_restart = bob.sync().unwrap();
    assert!(texts(&after_restart).contains(&"healthy after quarantine".to_string()));
    assert_eq!(bob.desync_reason(healthy_room).unwrap(), None);
}

#[test]
fn transient_commit_fetch_failure_is_retryable_and_does_not_quarantine_room() {
    let mut engine = start_engine();
    let keys = MemoryKeyStore::default();
    let room = "!room-commit-transient:inone.test";
    let mut alice = login(
        &engine,
        &keys,
        "@alice-transient:inone.test",
        "A_TRANSIENT",
        &db("commit-transient-alice"),
    );
    let mut bob = login(
        &engine,
        &keys,
        "@bob-transient:inone.test",
        "B_TRANSIENT",
        &db("commit-transient-bob"),
    );
    let mut dave = login(
        &engine,
        &keys,
        "@dave-transient:inone.test",
        "D_TRANSIENT",
        &db("commit-transient-dave"),
    );
    bob.upload_key_packages(5).unwrap();
    dave.upload_key_packages(1).unwrap();

    alice.create_room(room).unwrap();
    alice.invite(room, "@bob-transient:inone.test").unwrap();
    bob.sync().unwrap();

    alice.invite(room, "@dave-transient:inone.test").unwrap();
    alice
        .send_text(room, "retry after Commit fetch recovers")
        .unwrap();
    assert_eq!(
        engine.command(&format!("FAIL_NEXT_COMMIT_READ {room}")),
        "OK"
    );

    let error = bob.sync().unwrap_err();
    assert!(
        error.contains("временная ошибка"),
        "transient server failure is returned as retryable: {error}"
    );
    assert_eq!(bob.desync_reason(room).unwrap(), None);
    assert_eq!(bob.quarantined_commit_reason(room, 2).unwrap(), None);

    let recovered = bob.sync().unwrap();
    assert!(texts(&recovered).contains(&"retry after Commit fetch recovers".to_string()));
    assert_eq!(bob.local_epoch(room), alice.local_epoch(room));
    assert_eq!(bob.desync_reason(room).unwrap(), None);
}
