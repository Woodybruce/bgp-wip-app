#!/usr/bin/env bash
# Run a command with the dev server up, then tear the whole process group down.
# Foreground only — QA rounds must never leave a stray server on :5000
# (a stale server silently serves PRE-FIX code; cost r532 ~10 minutes).
# Usage: bash qa/with-server.sh "<command>"  [log file: /tmp/qa-server.log]
set -uo pipefail
cd "$(dirname "$0")/.."

if curl -s -o /dev/null --max-time 2 http://127.0.0.1:5000/api/auth/me; then
  echo "[with-server] REFUSING to start: something already answers on :5000"
  exit 3
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke}"
export PORT=5000 HOST=0.0.0.0 NODE_ENV=development
export SESSION_SECRET="${SESSION_SECRET:-qa-local-secret}"
LOG="${QA_SERVER_LOG:-/tmp/qa-server.log}"
: > "$LOG"

setsid node node_modules/tsx/dist/cli.mjs server/index.ts >>"$LOG" 2>&1 &
SRV=$!
trap 'kill -TERM -"$SRV" 2>/dev/null' EXIT

for i in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:5000/api/auth/me && break
  sleep 1
done
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:5000/api/auth/me; then
  echo "[with-server] server never came up — tail of $LOG:"; tail -30 "$LOG"; exit 4
fi
echo "[with-server] up on :5000"

bash -c "$1"
RC=$?
echo "[with-server] command exit $RC"
exit $RC
