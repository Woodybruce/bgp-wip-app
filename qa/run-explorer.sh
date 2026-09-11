#!/usr/bin/env bash
# Explorer sweep: full-app agent-style crawl against the local fixture.
# Starts the dev server on :5000 if it isn't up (dev mode — session cookies
# work over plain http; NEVER point the explorer at production).
#
# Usage: bash qa/run-explorer.sh [explorer args, e.g. --pages 40 --update-known]
set -uo pipefail
cd "$(dirname "$0")/.."

STARTED_SERVER=""
if ! curl -s -o /dev/null --max-time 3 http://localhost:5000/api/auth/me; then
  echo "[explorer] dev server not up — starting one against the bgp fixture DB"
  DATABASE_URL="${DATABASE_URL:-postgresql://bgp:bgp@127.0.0.1:5432/bgp}" \
  PGSSLMODE=disable PORT=5000 SESSION_SECRET=explorer-local HOST=0.0.0.0 \
    npm run dev > /tmp/explorer-dev.log 2>&1 &
  STARTED_SERVER=$!
  for i in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 http://localhost:5000/api/auth/me && break
    sleep 1
  done
  if ! curl -s -o /dev/null --max-time 2 http://localhost:5000/api/auth/me; then
    echo "[explorer] dev server failed to start — see /tmp/explorer-dev.log"
    [ -n "$STARTED_SERVER" ] && kill "$STARTED_SERVER" 2>/dev/null
    exit 2
  fi
fi

node qa/explorer.mjs "$@"
CODE=$?

if [ -n "$STARTED_SERVER" ]; then kill "$STARTED_SERVER" 2>/dev/null; fi
exit $CODE
