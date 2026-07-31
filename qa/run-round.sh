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

# 1b. Seed the multi-persona fixtures (idempotent — Hammerson rival client).
psql -U bgp -h localhost bgp -f qa/seed-personas.sql >/dev/null 2>&1 || echo "[qa] (persona seed skipped)"

# 2. Purge test rows from the previous round so data doesn't pile up.
psql -U bgp -h localhost bgp -tA -c "
  DELETE FROM crm_deals    WHERE name LIKE 'QA-R%' OR name LIKE '%PROBE%';
  DELETE FROM crm_contacts WHERE name LIKE 'QA Contact%';
  DELETE FROM unit_target_operators WHERE brief_id IN (SELECT id FROM unit_briefs WHERE title LIKE 'QA Brief%');
  DELETE FROM unit_briefs WHERE title LIKE 'QA Brief%';
  DELETE FROM image_studio_images WHERE file_name = 'qa-unit-photo.jpg';
  DELETE FROM team_events WHERE title LIKE 'QA-CAL-%' OR title LIKE 'QA Landsec brainstorm' OR title LIKE 'QA Other Client review';
  DELETE FROM unit_viewings WHERE attendees LIKE 'QA-VIEWING-%';
  -- The team-board scenario adds a member then removes it; if a round dies
  -- mid-way the row survives, so sweep anyone not in the account contacts.
  DELETE FROM crm_client_team_members m
   USING crm_companies c
   WHERE c.id = m.client_company_id
     AND (m.user_id IS NULL OR NOT (m.user_id = ANY(COALESCE(c.bgp_contact_user_ids, '{}'::text[]))));
" >/dev/null 2>&1 || echo "[qa] (cleanup skipped — no local psql)"

# 3. Run the round.
node qa/two-bot-round.mjs "$ROUND"
