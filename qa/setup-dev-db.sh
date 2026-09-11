#!/usr/bin/env bash
# Fresh-container dev setup for QA rounds (added r421): create the bgp
# role/db, restore qa/smoke-fixture.sql.gz, apply the r249 schema grants,
# write .env, start the dev server on :5000. Run as `bash qa/setup-dev-db.sh`
# so no bare psql one-liner ever hits a permission prompt (killed r421's
# first attempt). Assumes pg_hba trust (see ROLLING-LOG fresh-container
# notes) and postgres already running.
set -uo pipefail
cd "$(dirname "$0")/.."

psql -h 127.0.0.1 -U postgres -tAc "select 1 from pg_roles where rolname='bgp'" | grep -q 1 \
  || psql -h 127.0.0.1 -U postgres -c "create role bgp superuser login password 'bgp';"
psql -h 127.0.0.1 -U postgres -c "drop database if exists bgp;" >/dev/null
psql -h 127.0.0.1 -U postgres -c "create database bgp owner bgp;" >/dev/null
gunzip -c qa/smoke-fixture.sql.gz | psql -h 127.0.0.1 -U postgres -d bgp -q -v ON_ERROR_STOP=1 >/dev/null \
  || { echo "[setup] fixture restore failed"; exit 2; }
psql -h 127.0.0.1 -U postgres -d bgp -c "grant all on schema public to bgp; alter schema public owner to bgp;" >/dev/null
psql -h 127.0.0.1 -U postgres -d bgp -tAc "
  do \$\$ declare r record; begin
    for r in select tablename from pg_tables where schemaname='public' loop
      execute format('alter table public.%I owner to bgp', r.tablename);
    end loop;
    for r in select sequencename from pg_sequences where schemaname='public' loop
      execute format('alter sequence public.%I owner to bgp', r.sequencename);
    end loop;
  end \$\$;" >/dev/null

cat > .env <<EOF
DATABASE_URL=postgresql://bgp:bgp@127.0.0.1:5432/bgp
PORT=5000
SESSION_SECRET=qa-local
HOST=0.0.0.0
PGSSLMODE=disable
EOF

npm run dev > /tmp/dev-server.log 2>&1 &
echo $! > /tmp/dev-server.pid
for i in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 http://localhost:5000/api/auth/me && { echo "[setup] dev server up (pid $(cat /tmp/dev-server.pid))"; exit 0; }
  sleep 1
done
echo "[setup] dev server failed to come up — see /tmp/dev-server.log"
exit 2
