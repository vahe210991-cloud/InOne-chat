mod common;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Arc;
use std::thread;

use mls_client::MemoryKeyStore;

struct StatusProxy {
    base: String,
    events_status: Arc<AtomicU16>,
    expired_access: Arc<AtomicBool>,
    refresh_denied: Arc<AtomicBool>,
}

impl StatusProxy {
    fn set_events_status(&self, status: u16) {
        self.events_status.store(status, Ordering::SeqCst);
        self.expired_access.store(false, Ordering::SeqCst);
    }

    fn set_failed_refresh(&self, enabled: bool) {
        self.events_status
            .store(if enabled { 401 } else { 0 }, Ordering::SeqCst);
        self.expired_access.store(enabled, Ordering::SeqCst);
        self.refresh_denied.store(enabled, Ordering::SeqCst);
    }

    fn reset(&self) {
        self.events_status.store(0, Ordering::SeqCst);
        self.expired_access.store(false, Ordering::SeqCst);
        self.refresh_denied.store(false, Ordering::SeqCst);
    }
}

fn respond(mut client: TcpStream, status: u16, reason: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = client.write_all(response.as_bytes());
    let _ = client.flush();
}

fn handle_connection(
    mut client: TcpStream,
    upstream_address: &str,
    events_status: Arc<AtomicU16>,
    expired_access: Arc<AtomicBool>,
    refresh_denied: Arc<AtomicBool>,
) {
    let Ok(cloned) = client.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(cloned);
    let mut request_line = String::new();
    if reader
        .read_line(&mut request_line)
        .ok()
        .filter(|n| *n > 0)
        .is_none()
    {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut headers = Vec::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.is_empty() {
            return;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
        headers.push(line);
    }
    let mut body = vec![0u8; content_length];
    if reader.read_exact(&mut body).is_err() {
        return;
    }

    if method == "GET" && path.starts_with("/rooms/") && path.ends_with("/events") {
        let status = events_status.load(Ordering::SeqCst);
        if status != 0 {
            let token_expired = expired_access.load(Ordering::SeqCst);
            let (reason, body) = match (status, token_expired) {
                (401, true) => ("Unauthorized", r#"{"error":"token_expired"}"#),
                (401, false) => ("Unauthorized", r#"{"error":"device_revoked"}"#),
                (403, _) => ("Forbidden", r#"{"error":"permission_denied"}"#),
                (404, _) => ("Not Found", r#"{"error":"room_deleted"}"#),
                _ => ("Forced", r#"{"error":"forced_test_error"}"#),
            };
            respond(client, status, reason, body);
            return;
        }
    }
    if method == "POST" && path == "/token/refresh" && refresh_denied.load(Ordering::SeqCst) {
        respond(
            client,
            401,
            "Unauthorized",
            r#"{"error":"refresh_revoked"}"#,
        );
        return;
    }

    let Ok(mut upstream) = TcpStream::connect(upstream_address) else {
        return;
    };
    let write_result = (|| -> std::io::Result<()> {
        upstream.write_all(request_line.as_bytes())?;
        for header in &headers {
            if !header.to_ascii_lowercase().starts_with("connection:") {
                upstream.write_all(header.as_bytes())?;
            }
        }
        upstream.write_all(b"Connection: close\r\n\r\n")?;
        upstream.write_all(&body)?;
        upstream.flush()
    })();
    if write_result.is_err() {
        return;
    }
    let _ = std::io::copy(&mut upstream, &mut client);
}

fn start_status_proxy(upstream: &str) -> StatusProxy {
    let upstream_address = upstream
        .strip_prefix("http://")
        .expect("test engine must use http")
        .to_string();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test proxy");
    let address = listener.local_addr().expect("proxy address");
    let events_status = Arc::new(AtomicU16::new(0));
    let expired_access = Arc::new(AtomicBool::new(false));
    let refresh_denied = Arc::new(AtomicBool::new(false));

    let thread_status = events_status.clone();
    let thread_expired = expired_access.clone();
    let thread_refresh = refresh_denied.clone();
    thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(client) = incoming else {
                continue;
            };
            let upstream_address = upstream_address.clone();
            let events_status = thread_status.clone();
            let expired_access = thread_expired.clone();
            let refresh_denied = thread_refresh.clone();
            thread::spawn(move || {
                handle_connection(
                    client,
                    &upstream_address,
                    events_status,
                    expired_access,
                    refresh_denied,
                )
            });
        }
    });

    StatusProxy {
        base: format!("http://{address}"),
        events_status,
        expired_access,
        refresh_denied,
    }
}

#[test]
fn auth_access_deleted_room_and_failed_refresh_never_mark_mls_recovery_required() {
    let engine = common::start_engine();
    let proxy = start_status_proxy(&engine.base);
    let keys = MemoryKeyStore::default();
    let (alice_db, bob_db) = (
        common::db("access-errors-alice"),
        common::db("access-errors-bob"),
    );
    let mut alice = common::login(&engine, &keys, "@alice:inone.test", "A_ACCESS", &alice_db);
    let mut bob = common::login(&engine, &keys, "@bob:inone.test", "B_ACCESS", &bob_db);
    bob.ensure_key_packages(2).unwrap();

    let room = "!room-access-errors:inone.test";
    let other_room = "!room-access-errors-other:inone.test";
    alice.create_room(room).unwrap();
    alice.invite(room, "@bob:inone.test").unwrap();
    alice.create_room(other_room).unwrap();
    alice.invite(other_room, "@bob:inone.test").unwrap();
    assert!(bob.sync().unwrap().is_empty());

    for status in [401, 403, 404] {
        proxy.set_events_status(status);
        let error = bob
            .sync()
            .expect_err("HTTP access failure must be surfaced");
        assert!(
            error.contains(&format!("-> {status}")),
            "expected HTTP {status}, got {error}"
        );
        assert_eq!(
            bob.desync_reason(room).unwrap(),
            None,
            "HTTP {status} does not prove MLS state corruption"
        );
        assert_eq!(bob.desync_reason(other_room).unwrap(), None);
    }

    // A token-expired event response followed by a rejected refresh is still a
    // session problem, not an MLS recovery condition.
    proxy.set_failed_refresh(true);
    let refresh_error = bob
        .sync()
        .expect_err("failed refresh must be surfaced");
    assert!(
        refresh_error.contains("token/refresh -> 401"),
        "{refresh_error}"
    );
    assert_eq!(bob.desync_reason(room).unwrap(), None);
    assert_eq!(bob.desync_reason(other_room).unwrap(), None);

    proxy.reset();
    alice
        .send_text(room, "room remains usable after access recovery")
        .unwrap();
    alice
        .send_text(other_room, "other room remains usable after access recovery")
        .unwrap();
    let received = bob.sync().expect("same and other MLS rooms remain usable");
    let mut received_texts = common::texts(&received);
    received_texts.sort();
    let mut expected_texts = vec![
        "room remains usable after access recovery".to_string(),
        "other room remains usable after access recovery".to_string(),
    ];
    expected_texts.sort();
    assert_eq!(received_texts, expected_texts);
    assert_eq!(bob.desync_reason(room).unwrap(), None);
    assert_eq!(bob.desync_reason(other_room).unwrap(), None);
}
