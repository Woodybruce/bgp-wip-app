#!/usr/bin/env bash
# Local smoke run, mirroring what CI does on every push: restore the committed
# fixture into a throwaway DB, start a production build against it with NO
# AI / Microsoft keys, run qa/smoke.mjs, tear down. Exit code = suite result.
#
# Usage: bash qa/run-smoke.sh
# Env:   SMOKE_DB    fixture database name   (default bgpsmoke)
#        SMOKE_PORT  app port for the run    (default 5100)
#        SMOKE_PG    psql connection prefix  (default -h 127.0.0.1 -U postgres)
set -uo pipefail
cd "$(dirname "$0")/.."

DB="${SMOKE_DB:-bgpsmoke}"
PORT="${SMOKE_PORT:-5100}"
PG=(${SMOKE_PG:--h 127.0.0.1 -U postgres})

# start-postgres.sh sets this password on the postgres role so host
# connections authenticate in containers that require one (added after
# r434). Ignored where the container allows passwordless connections.
QA_PG_PASSWORD="${QA_PG_PASSWORD:-qa-local-pg}"
export PGPASSWORD="${PGPASSWORD:-$QA_PG_PASSWORD}"
DB_URL="postgresql://postgres:$QA_PG_PASSWORD@127.0.0.1:5432/$DB"

# 1. Fresh DB from the committed fixture.
psql "${PG[@]}" -c "drop database if exists $DB;" >/dev/null
psql "${PG[@]}" -c "create database $DB;" >/dev/null
gunzip -c qa/smoke-fixture.sql.gz | psql "${PG[@]}" -d "$DB" -q -v ON_ERROR_STOP=1 >/dev/null \
  || { echo "[smoke] fixture restore failed"; exit 2; }

# 2. Production build (reuse dist/ if present — pass FRESH_BUILD=1 to force).
if [ ! -f dist/index.cjs ] || [ "${FRESH_BUILD:-}" = "1" ]; then
  npm run build || exit 2
fi

# 3. Start the app the way CI does: minimal env, no AI keys.
DATABASE_URL="$DB_URL" \
PGSSLMODE=disable \
PORT="$PORT" NODE_ENV=production SESSION_SECRET=smoke-local HOST=0.0.0.0 \
  node dist/index.cjs >/tmp/smoke-app.log 2>&1 &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null' EXIT

for i in $(seq 1 30); do
  curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/" && break
  sleep 1
done
curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/" \
  || { echo "[smoke] app did not come up on :$PORT — see /tmp/smoke-app.log"; exit 2; }

# 4. Run the suite (exit code propagates).
SMOKE_BASE="http://localhost:$PORT" DATABASE_URL="$DB_URL" node qa/smoke.mjs
