#!/usr/bin/env bash
set -euo pipefail

cd /workspace/inone-engine-poc-0.6.0

if curl --silent --fail http://127.0.0.1:8080/healthz >/dev/null; then
  echo "InOne API is already running at http://127.0.0.1:8080"
  exit 0
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
