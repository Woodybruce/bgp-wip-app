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
  -- verdict rows for deals that no longer exist (the verdict-flow scenario
  -- deletes its probe deal; the verdict row has no FK and would pile up)
  DELETE FROM deal_verdicts WHERE deal_id NOT IN (SELECT id FROM crm_deals);
  DELETE FROM crm_contacts WHERE name LIKE 'QA Contact%';
  DELETE FROM user_tasks   WHERE title LIKE 'QA-PROBE task%';
  DELETE FROM crm_requirements_leasing WHERE name LIKE 'QA-REQ%' OR name LIKE 'QA-PROBE req%';
  DELETE FROM unit_target_operators WHERE brief_id IN (SELECT id FROM unit_briefs WHERE title LIKE 'QA Brief%');
  DELETE FROM unit_briefs WHERE title LIKE 'QA Brief%';
  DELETE FROM image_studio_images WHERE file_name = 'qa-unit-photo.jpg';
  DELETE FROM team_events WHERE title LIKE 'QA-VIS %' OR title LIKE 'QA-CAL-%' OR title LIKE 'QA Landsec brainstorm' OR title LIKE 'QA Other Client review';
  DELETE FROM unit_viewings WHERE attendees LIKE 'QA-VIEWING-%' OR attendees LIKE 'QA-VDEL-%';
  DELETE FROM unit_interest WHERE company_name LIKE 'QA-PROBE%';
  DELETE FROM crm_comps    WHERE name LIKE 'QA-COMP%';
  -- client-pi-lookup-open resolves DA9 9ST each round; the resolve persists
  -- a search-history row even when the title lookup itself comes back empty.
  DELETE FROM land_registry_searches WHERE address IN ('DA9 9ST', 'Bluewater Shopping Centre, DA9 9ST') OR address LIKE 'QA-LR-SCOPE%';
  -- reimport-no-dup scenario cleans up after itself; sweep survivors of a
  -- mid-scenario death (tenancy + tracker rows, then the QA property).
  DELETE FROM tenancy_schedule_units WHERE unit_number = 'QA-REIMP-UNIT';
  DELETE FROM available_units WHERE unit_name = 'QA-REIMP-UNIT';
  DELETE FROM leasing_schedule_units WHERE unit_name = 'QA-REIMP-UNIT';
  DELETE FROM crm_properties WHERE name LIKE 'QA-REIMP Prop%';
  DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE title LIKE 'QA-CHATDEL%' OR title LIKE 'QA Thread%');
  DELETE FROM chat_threads WHERE title LIKE 'QA-CHATDEL%' OR title LIKE 'QA Thread%';
  DELETE FROM unit_offers WHERE company_name LIKE 'QA-AOFFER-%' OR company_name LIKE 'QA-ODEL-%' OR company_name LIKE 'QA-OFFER-%' OR company_name LIKE 'QA-RIVAL-%';
  -- The team-board scenario adds a member then removes it; if a round dies
  -- mid-way the row survives, so sweep anyone not in the account contacts.
  DELETE FROM crm_client_team_members m
   USING crm_companies c
   WHERE c.id = m.client_company_id
     AND (m.user_id IS NULL OR NOT (m.user_id = ANY(COALESCE(c.bgp_contact_user_ids, '{}'::text[]))));
" >/dev/null 2>&1 || echo "[qa] (cleanup skipped — no local psql)"

# 3. Run the round.
node qa/two-bot-round.mjs "$ROUND"
