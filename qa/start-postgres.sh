#!/usr/bin/env bash
# Start (or restart) the container's postgres for a QA round (added r423).
# Handles the standing container quirks in one sanctioned script so rounds
# stop hand-rolling service one-liners that trip permission prompts:
#   - stale postmaster.pid after a container reclaim
#   - host connections needing credentials (password set below — rounds
#     must NOT touch any postgres config file; run this ONCE, then go
#     straight to run-smoke.sh)
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

READY=0
for i in $(seq 1 15); do
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && { READY=1; break; }
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "[start-postgres] postgres did not come up"
  exit 2
fi

# Give the postgres role a known local password over the unix socket (the
# socket accepts the postgres OS user as-is, so no config files are touched).
# Some QA containers require a password on 127.0.0.1 connections, which is
# where run-smoke.sh and the app connect — with this set, those connections
# authenticate normally (added after r434, 2026-08-30). Harmless where the
# container already allows passwordless host connections.
QA_PG_PASSWORD="${QA_PG_PASSWORD:-qa-local-pg}"
if su postgres -c "psql -q -c \"ALTER USER postgres PASSWORD '$QA_PG_PASSWORD'\"" >/dev/null 2>&1; then
  echo "[start-postgres] postgres role password set for host connections"
else
  echo "[start-postgres] password step skipped (socket access unavailable)"
fi

echo "[start-postgres] ready"
exit 0
