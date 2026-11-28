#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DB="$WORK/openmls-081-fixture.db"
RECOVERY_DB="$WORK/openmls-081-recovery-fixture.db"

cargo run --manifest-path "$ROOT/legacy-writer/Cargo.toml" -- "$DB"
# Keep an independent legacy database for the migration rollback/retry test.
cargo run --manifest-path "$ROOT/legacy-writer/Cargo.toml" -- "$RECOVERY_DB"

# The candidate reader is an independent Cargo project. Generate its lockfile
# explicitly before inspecting it or running RustSec; cargo run on the legacy
# writer does not create a lockfile for the reader.
cargo generate-lockfile --manifest-path "$ROOT/current-reader/Cargo.toml"

LOCKFILE="$ROOT/current-reader/Cargo.lock"
python3 - "$LOCKFILE" <<'PY'
import sys, tomllib
from pathlib import Path
lock = tomllib.loads(Path(sys.argv[1]).read_text())
packages = lock["package"]
versions = {(p["name"], p["version"]) for p in packages}
assert ("crypto-bigint", "0.5.5") not in versions, "vulnerable crypto-bigint 0.5.5 remains in candidate lockfile"
assert ("crypto-bigint", "0.7.11") in versions, "expected patched crypto-bigint 0.7.11 is missing"
assert ("libsqlite3-sys", "0.40.0") in versions, "expected patched libsqlite3-sys 0.40.0 is missing"
assert any(name == "sqlcipher-src" and version.startswith("420.0.0+") for name, version in versions), "SQLCipher 4.20.0 source is missing"
print("dependency_floor=verified")
PY

(
  cd "$ROOT/current-reader"
  cargo tree -i crypto-bigint@0.7.11
  cargo tree -i libsqlite3-sys@0.40.0
)

INONE_COMPAT_DB="$DB" INONE_COMPAT_RECOVERY_DB="$RECOVERY_DB" cargo test --manifest-path "$ROOT/current-reader/Cargo.toml" -- --nocapture --test-threads=1
