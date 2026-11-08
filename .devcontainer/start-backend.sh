#!/usr/bin/env bash
set -euo pipefail

cd /workspace/inone-engine-poc-0.6.0

if curl --silent --fail http://127.0.0.1:8080/healthz >/dev/null; then
  echo "InOne API is already running at http://127.0.0.1:8080"
  exit 0
fi

if [[ "${NODE_ENV:-development}" != "development" || -z "${DATABASE_URL:-}" ]]; then
  echo "Refusing to start without the development database configuration."
  exit 1
fi

db_ready=false
for attempt in $(seq 1 45); do
  if node --input-type=module -e '
    import pg from "pg";
    const target = new URL(process.env.DATABASE_URL);
    if (target.hostname !== "db" || target.pathname !== "/inone_dev") process.exit(2);
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1000 });
    try { await pool.query("SELECT 1"); }
    catch { process.exitCode = 1; }
    finally { await pool.end(); }
  ' >/dev/null 2>&1; then
    db_ready=true
    break
  fi
  sleep 1
done

if [[ "$db_ready" != true ]]; then
  echo "The isolated PostgreSQL development database is not ready; backend was not started."
  exit 1
fi

nohup npm start >/tmp/inone-backend.log 2>&1 </dev/null &

for attempt in $(seq 1 45); do
  if curl --silent --fail http://127.0.0.1:8080/healthz >/dev/null; then
    echo "InOne API is ready at http://127.0.0.1:8080"
    echo "Backend log: /tmp/inone-backend.log"
    exit 0
  fi
  sleep 1
done

echo "InOne API did not become healthy. Recent backend log:"
tail -n 80 /tmp/inone-backend.log || true
exit 1
