#!/usr/bin/env bash
# One QA round: ensure the dev server is up, purge prior QA test data, run the
# two-bot harness, print the issue summary. Called by the 3-day QA Routine.
#
# Usage: bash qa/run-round.sh <roundNumber>
set -uo pipefail
cd "$(dirname "$0")/.."

ROUND="${1:-1}"
export PGPASSWORD=bgp

# 1. Server up? (tsx does not hot-reload server code — the Routine restarts it
#    after any server-side fix before calling this.)
if ! curl -s -o /dev/null --max-time 3 http://localhost:5000/api/auth/me; then
  echo "[qa] dev server not responding on :5000 — start it first (npm run dev)"
  exit 2
fi

# 2. Purge test rows from the previous round so data doesn't pile up.
psql -U bgp -h localhost bgp -tA -c "
  DELETE FROM crm_deals    WHERE name LIKE 'QA-R%' OR name LIKE '%PROBE%';
  DELETE FROM crm_contacts WHERE name LIKE 'QA Contact%';
" >/dev/null 2>&1 || echo "[qa] (cleanup skipped — no local psql)"

# 3. Run the round.
node qa/two-bot-round.mjs "$ROUND"
