// Regression coverage for access/session HTTP failures during MLS room sync.
// This case is included in the current exact-head P0 validation gate.
// These failures must be returned to the caller without poisoning the local MLS room.
mod common;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::thread;

use mls_client::{connect, MemoryKeyStore};

const PW: &str = common::PW;
const ROOM: &str = "!room-access-errors:inone.test";
const ALICE: &str = "@alice:inone.test";
const BOB: &str = "@bob:inone.test";

struct StatusProxy {
    base: String,
    status: Arc<AtomicU16>,
}

impl StatusProxy {
    fn set_status(&self, status: u16) {
        self.status.store(status, Ordering::SeqCst);
    }
}

fn handle_connection(
    mut client: TcpStream,
    upstream_address: &str,
    status: Arc<AtomicU16>,
) {
    let Ok(cloned) = client.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(cloned);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).ok().filter(|n| *n > 0).is_none() {
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

    let forced_status = status.load(Ordering::SeqCst);
    if method == "GET"
        && path.starts_with("/rooms/")
        && path.ends_with("/events")
        && matches!(forced_status, 401 | 403 | 404)
    {
        let reason = match forced_status {
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            _ => unreachable!(),
        };
        let response_body = format!(r#"{{"error":"forced_test_{forced_status}"}}"#);
        let response = format!(
            "HTTP/1.1 {forced_status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
            response_body.len()
        );
        let _ = client.write_all(response.as_bytes());
        let _ = client.flush();
        return;
    }

    let Ok(mut upstream) = TcpStream::connect(upstream_address) else {
        return;
    };
    if upstream
        .write_all(request_line.as_bytes())
        .and_then(|_| {
            for header in &headers {
                if !header.to_ascii_lowercase().starts_with("connection:") {
                    upstream.write_all(header.as_bytes())?;
                }
            }
            upstream.write_all(b"Connection: close\r\n\r\n")?;
            upstream.write_all(&body)?;
            upstream.flush()
        })
        .is_err()
    {
        return;
    }
    let _ = std::io::copy(&mut upstream, &mut client);
}

fn start_status_proxy(upstream: &str) -> StatusProxy {
    let upstream_address = upstream
        .strip_prefix("http://")
        .expect("test engine must use http")
        .to_string();
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind status proxy");
    let address = listener.local_addr().expect("status proxy address");
    let status = Arc::new(AtomicU16::new(0));
    let shared_status = status.clone();

    thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(client) = incoming else {
                continue;
            };
            let upstream_address = upstream_address.clone();
            let status = shared_status.clone();
            thread::spawn(move || handle_connection(client, &upstream_address, status));
        }
    });

    StatusProxy {
        base: format!("http://{address}"),
        status,
    }
}

#[test]
fn auth_access_and_deleted_room_http_errors_do_not_mark_room_recovery_required() {
    let engine = common::start_engine();
    let proxy = start_status_proxy(&engine.base);
    let keys = MemoryKeyStore::default();

    let mut alice = connect(
        &proxy.base,
        ALICE,
        PW,
        "A_PHONE",
        &common::db("access-errors-alice"),
        &keys,
    )
    .expect("Alice login");
    let mut bob = connect(
        &proxy.base,
        BOB,
        PW,
        "B_PHONE",
        &common::db("access-errors-bob"),
        &keys,
    )
    .expect("Bob login");

    bob.ensure_key_packages(1).expect("Bob key packages");
    alice.create_room(ROOM).expect("create room");
    alice.invite(ROOM, BOB).expect("invite Bob");
    assert!(bob.sync().expect("accept Welcome").is_empty());

    for status in [401, 403, 404] {
        proxy.set_status(status);
        let error = bob.sync().expect_err("access failure must be surfaced");
        assert!(
            error.contains(&format!("-> {status}")),
            "expected HTTP {status} to reach the caller, got: {error}"
        );
        assert_eq!(
            bob.desync_reason(ROOM).expect("read room recovery state"),
            None,
            "HTTP {status} is not evidence of MLS state corruption"
        );
    }

    proxy.set_status(0);
    alice.send_text(ROOM, "room remains usable").expect("send after access failures");
    let received = bob.sync().expect("sync after access restored");
    assert_eq!(
        common::texts(&received),
        vec!["room remains usable".to_string()],
        "the same MLS room must remain usable after 401/403/404"
    );
    assert_eq!(
        bob.desync_reason(ROOM).expect("final room recovery state"),
        None
    );
}
