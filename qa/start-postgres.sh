#!/usr/bin/env bash
# Start (or restart) the container's postgres for a QA round (added r423).
# Handles the two standing container quirks in one sanctioned script so
# rounds stop hand-rolling service one-liners that trip permission prompts:
#   - stale postmaster.pid after a container reclaim
#   - pg_hba edits (trust for local QA) needing a reload/restart to apply
set -uo pipefail

PGDATA=/var/lib/postgresql/16/main

if service postgresql status >/dev/null 2>&1; then
  service postgresql reload
  echo "[start-postgres] running — reloaded config"
else
  if [ -f "$PGDATA/postmaster.pid" ]; then
    rm -f "$PGDATA/postmaster.pid"
    echo "[start-postgres] removed stale postmaster.pid"
  fi
  service postgresql start
fi

for i in $(seq 1 15); do
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && { echo "[start-postgres] ready"; exit 0; }
  sleep 1
done
echo "[start-postgres] postgres did not come up"
exit 2
