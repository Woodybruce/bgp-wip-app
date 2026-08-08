# Rolling QA log

Memory for the rolling visual-testing routine. Each round runs in a FRESH
session with no chat history — this file is how rounds remember each other.
Read it before testing; append a terse entry after. Keep entries short.

## How to use
- Pick the next journey from the rotation below — cover what recent rounds
  didn't. One exploratory journey per round, plus the scripted regression.
- Known flakes and environment noise are listed so they aren't re-triaged
  every round. Add new ones as found.
- UX/improvement suggestions go to `qa/UX-NOTES.md` (NOT implemented without
  Woody's numbered confirmation).

## Rotation (persona × surface)
1. BGP staff · desktop (victoria@brucegillinghampollard.com)
2. Landsec client · desktop (mark.warne@landsec.com)
3. Landsec client · mobile 390px
4. BGP staff · mobile 390px

Vary the task each visit: tracker work, brand profiles, requirements, deals
board, tenancy schedules, ChatBGP, comps, tasks, contacts, news, Image Studio.

## Environment noise (ignore, do not triage)
- 503s from AI/M365 endpoints — no Anthropic/Microsoft keys locally
- 404s on missing brand/unit photos
- 429s from the login rate limiter after repeated runs (restart app to clear)
- URL-less "Failed to load resource" console echoes
- 400 from POST /api/brand/:id/rocketreach/discover — no ROCKETREACH_API_KEY
  locally; the brand profile auto-fires it and swallows the failure
- 401 GET /api/client/brand-theme console echo on the login screen (fires
  before auth hydrates; harmless)
- ERR_CONNECTION_RESET on google.com/s2/favicons — no external network

## Known flakes
- postgres dies on container restart — `service postgresql start`, rm stale
  postmaster.pid if needed
- bare root gotos can throw ERR_ABORTED on redirect-on-mount — hardened in
  qa helpers (round 204); use the tolerant visit() pattern
- tsx does not hot-reload server/*.ts — restart the server after server fixes

## Fresh-container setup (learned r205)
- Repo may not be pre-cloned; clone to /workspace/bgp-wip-app.
- postgres: set pg_hba to trust for local/host lines, `service postgresql reload`.
- Dev server needs a .env (DATABASE_URL=postgresql://bgp:bgp@127.0.0.1:5432/bgp,
  PORT=5000, SESSION_SECRET, HOST=0.0.0.0); create role bgp + db bgp and restore
  qa/smoke-fixture.sql.gz into it for browser journeys.
- Do NOT run the prod build over plain http for browser tests: session cookie
  is secure-only in production, so cookie-auth UI flows all 401
  (/api/client/brand-theme storms, empty client nav). smoke.mjs is fine (Bearer).
- IMPORTANT: qa/two-bot-round.mjs + run-round.sh were written for the OLD dev
  fixture (Landsec = 11111111-…, property 22222222 = Landsec's, brand 77777777)
  which is NOT in the repo. Against qa/smoke-fixture.sql.gz (Landsec = d25ec158…,
  11111111 = "British Land Rival") every ID-hardcoded scenario fails by
  construction — those are fixture mismatches, not app bugs. In a fresh
  container treat `bash qa/run-smoke.sh` as the authoritative regression, and
  triage only two-bot failures that don't involve the hardcoded IDs.

## Rounds
(carried over: the previous rolling session completed ~204 scripted rounds
green through 2026-08-06, growing qa/two-bot-round.mjs as it went)

### r205 · 2026-08-08 · fresh container
- Journey: rotation #1 staff desktop (Victoria) — "work a Bluewater unit: add a
  target operator, log a viewing" + client desktop verification leg (Mark sees
  the target, agent name and viewing). Regression: run-smoke.sh green
  (41 checks, 0 failures, fresh DB + fresh build).
- Bugs fixed (5):
  1. GET /api/property-pathway 500 on a fresh DB — property_pathway_runs only
     bootstrapped by /api/portfolios; pathway routes + boot resume sweep now
     ensure it (server/property-pathway.ts, server/portfolios.ts).
  2. policy_files lazy CREATE lacked rendered_html/rendered_at → policy detail
     500 on fresh DB until restart (server/hr-routes.ts).
  3. Viewings/Offers dialogs: company/contact picker (Popover CrmPicker) never
     received clicks inside the Radix Dialog — viewings all saved "Unknown".
     Now wraps the inline EntityCombobox (client/src/pages/available-units.tsx).
  4. Client-scoped all-viewings/all-offers returned snake_case rows → client FY
     Viewings/Offers strip always 0 (server/routes.ts, camelRow map).
  5. Client tracker Agent column showed raw user UUID — getClientVisibleUserIds
     now includes agents assigned on the client's units/target operators
     (server/company-scope.ts).
- Harness growth: smoke.mjs +3 checks (pathway board API, portfolios API,
  client viewings camelCase); two-bot client-sees-agent-viewing now asserts
  camelCase + new client-tracker-agent-names scenario.
- Suggestions added: UX-NOTES #1 (viewings/offers not editable), #2 (viewing
  date should default to today).
- Next journey: rotation #2 client desktop (then #3 client mobile 390px).

### r206 · 2026-08-08 · round in progress (LIGHT — r205 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN (41 checks, 0 failures,
  fresh build + fresh fixture DB).
- Setup note: playwright's node_modules install expects headless_shell-1234
  which isn't in /opt/pw-browsers — run smoke with
  SMOKE_CHROMIUM=/opt/pw-browsers/chromium (symlink to chromium-1194).
- Triage list: nothing from smoke. Next: two-bot-round.mjs sweep, triaging
  only non-hardcoded-ID failures per r205 note.
