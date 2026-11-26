#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DB="$WORK/openmls-081-fixture.db"

cargo run --manifest-path "$ROOT/legacy-writer/Cargo.toml" -- "$DB"

(
  cd "$ROOT/current-reader"
  cargo update -p crypto-bigint --precise 0.7.11
  cargo tree -i crypto-bigint
  cargo tree -i libsqlite3-sys
)

INONE_COMPAT_DB="$DB" cargo test --manifest-path "$ROOT/current-reader/Cargo.toml" -- --nocapture

(cd "$ROOT/current-reader" && cargo audit)
