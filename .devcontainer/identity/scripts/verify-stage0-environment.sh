#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"

if [[ "$NODE_MAJOR" != "26" ]]; then
  echo "FAIL: expected Node.js 26 LTS, found $(node --version)" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1 || ! command -v pg_isready >/dev/null 2>&1; then
  echo "FAIL: PostgreSQL client tools are missing. Rebuild the Identity devcontainer." >&2
  exit 1
fi

if [[ -z "$IDENTITY_DATABASE_URL" ]]; then
  echo "FAIL: IDENTITY_DATABASE_URL is not configured in the Identity devcontainer." >&2
  exit 1
fi

pg_isready -h postgres -p 5432 -U identity_dev -d identity_dev
SERVER_VERSION="$(psql "$IDENTITY_DATABASE_URL" -Atc 'SHOW server_version;')"
case "$SERVER_VERSION" in
  18.*) echo "PASS: PostgreSQL $SERVER_VERSION" ;;
  *) echo "FAIL: expected PostgreSQL 18, found $SERVER_VERSION" >&2; exit 1 ;;
esac

echo "PASS: Node.js $(node --version)"
echo "PASS: npm $(npm --version)"
echo "PASS: Identity development database connectivity"
bash "$ROOT/.devcontainer/identity/scripts/validate-contracts.sh"
