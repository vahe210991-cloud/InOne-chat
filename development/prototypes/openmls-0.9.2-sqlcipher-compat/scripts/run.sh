#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
DB="$WORK/openmls-081-fixture.db"
EVIDENCE_DIR="${INONE_COMPAT_EVIDENCE_DIR:-}"

cleanup() {
  if [[ -n "$EVIDENCE_DIR" && -f "$DB" ]]; then
    mkdir -p "$EVIDENCE_DIR" || true
    for file in \
      "$DB" \
      "$WORK/openmls-081-fixture.signer.pub" \
      "$WORK/openmls-081-fixture.epoch1.msg"; do
      if [[ -f "$file" ]]; then
        cp "$file" "$EVIDENCE_DIR/" || true
      fi
    done
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# Generate a lockfile only for a fresh checkout. Existing reviewed lockfiles
# are immutable inputs and must never be silently re-resolved by this runner.
if [[ ! -f "$ROOT/legacy-writer/Cargo.lock" ]]; then
  cargo generate-lockfile --manifest-path "$ROOT/legacy-writer/Cargo.toml"
fi
if [[ ! -f "$ROOT/current-reader/Cargo.lock" ]]; then
  cargo generate-lockfile --manifest-path "$ROOT/current-reader/Cargo.toml"
fi

LOCKFILE="$ROOT/current-reader/Cargo.lock"
LEGACY_LOCKFILE="$ROOT/legacy-writer/Cargo.lock"
python3 - "$LOCKFILE" "$LEGACY_LOCKFILE" <<'PY'
import hashlib, sys, tomllib
from pathlib import Path

candidate_path, legacy_path = map(Path, sys.argv[1:])
candidate = tomllib.loads(candidate_path.read_text())
legacy = tomllib.loads(legacy_path.read_text())

candidate_versions = {(p["name"], p["version"]) for p in candidate["package"]}
legacy_versions = {(p["name"], p["version"]) for p in legacy["package"]}

assert ("openmls", "0.9.2") in candidate_versions, "candidate must use stable OpenMLS 0.9.2"
assert ("openmls_traits", "0.6.0") in candidate_versions, "candidate must use openmls_traits 0.6.0"
assert ("openmls_sqlite_storage", "0.3.0") in candidate_versions, "candidate must use the reviewed SQLite storage adapter 0.3.0"
assert ("rusqlite", "0.42.0") in candidate_versions, "candidate must use rusqlite 0.42.0"
assert ("crypto-bigint", "0.5.5") not in candidate_versions, "vulnerable crypto-bigint 0.5.5 remains in candidate lockfile"
assert ("crypto-bigint", "0.7.11") in candidate_versions, "expected patched crypto-bigint 0.7.11 is missing"
assert ("libcrux-kem", "0.0.10") in candidate_versions, "patched libcrux-kem 0.0.10 is required to reject malformed hybrid keys safely"
assert ("libsqlite3-sys", "0.40.0") in candidate_versions, "expected patched libsqlite3-sys 0.40.0 is missing"
assert ("refinery", "0.10.0") in candidate_versions, "expected Refinery 0.10.0 facade is missing"
assert ("refinery-core", "0.10.1") in candidate_versions, "patched refinery-core 0.10.1 is not selected"
assert ("zeroize", "1.9.1") in candidate_versions, "candidate must include the reviewed zeroize 1.9.1 dependency"
assert any(name == "sqlcipher-src" and version.startswith("420.0.0+") for name, version in candidate_versions), "SQLCipher 4.20.0 source is missing"

assert ("openmls", "0.8.1") in legacy_versions, "legacy fixture must use OpenMLS 0.8.1"
assert ("openmls_sqlite_storage", "0.2.0") in legacy_versions, "legacy fixture must use openmls_sqlite_storage 0.2.0"
assert ("rusqlite", "0.32.1") in legacy_versions, "legacy fixture must use rusqlite 0.32.1"

for label, path in (("candidate", candidate_path), ("legacy_fixture", legacy_path)):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"{label}_lockfile_sha256={digest}")
print("candidate_dependency_floor=verified")
print("legacy_fixture_dependency_contract=verified")
PY

(
  cd "$ROOT/current-reader"
  cargo tree --locked -i crypto-bigint@0.7.11
  cargo tree --locked -i libsqlite3-sys@0.40.0
  cargo tree --locked -i refinery-core@0.10.1
)

cargo run --locked --manifest-path "$ROOT/legacy-writer/Cargo.toml" -- "$DB"
INONE_COMPAT_DB="$DB" cargo test --locked --manifest-path "$ROOT/current-reader/Cargo.toml" -- --nocapture --test-threads=1
