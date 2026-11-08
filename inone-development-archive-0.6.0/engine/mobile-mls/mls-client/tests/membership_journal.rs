mod common;
use common::{db, login, start_engine, PW};
use mls_client::MemoryKeyStore;

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
    assert!(error.contains("-> 500"), "expected ambiguous HTTP failure, got: {error}");
    assert_eq!(alice.local_epoch(ROOM), Some(0), "unacknowledged staged commit is not merged");
    drop(alice);

    let mut restarted = login(&engine, &keys, ALICE, "A_PHONE", &alice_db);
    restarted.sync().expect("restart replays the exact operation and merges its pending commit");
    assert_eq!(restarted.local_epoch(ROOM), Some(1));
    assert_eq!(engine.command(&format!("COMMIT_COUNT {ROOM}")), "1", "server accepted exactly one commit");
    assert!(bob.sync().unwrap().is_empty(), "invited device joins from the single Welcome");
}
