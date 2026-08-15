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
- 503 GET /api/brand/:id/ai-take/* — keyless AI-take panels on company
  profiles fire these on load; UI shows "AI take unavailable" (r269)
- ERR_CONNECTION_RESET on google.com/s2/favicons — no external network

## Known flakes
- postgres dies on container restart — `service postgresql start`, rm stale
  postmaster.pid if needed
- bare root gotos can throw ERR_ABORTED on redirect-on-mount — hardened in
  qa helpers (round 204); use the tolerant visit() pattern
- tsx does not hot-reload server/*.ts — restart the server after server fixes
- (r262) first smoke pass right after FRESH_BUILD can time out the client
  UI-login check (cold first page load); re-run before triaging as real

## Fresh-container setup (learned r205)
- Repo may not be pre-cloned; clone to /workspace/bgp-wip-app.
- postgres: set pg_hba to trust for local/host lines, `service postgresql reload`.
- Dev server needs a .env (DATABASE_URL=postgresql://bgp:bgp@127.0.0.1:5432/bgp,
  PORT=5000, SESSION_SECRET, HOST=0.0.0.0); create role bgp + db bgp and restore
  qa/smoke-fixture.sql.gz into it for browser journeys.
- (r249) After restore-as-postgres + ALTER owners, ALSO run
  `grant all on schema public to bgp; alter schema public owner to bgp;`
  — else the bgp role can't CREATE and auto-migrate silently skips new
  tables/indexes (kyc_audit_log, deal_audit_log, …).
- Do NOT run the prod build over plain http for browser tests: session cookie
  is secure-only in production, so cookie-auth UI flows all 401
  (/api/client/brand-theme storms, empty client nav). smoke.mjs is fine (Bearer).
- (RESOLVED r208) two-bot used to hardcode old-dev-fixture IDs; it now
  resolves Landsec/Bluewater/brand by name at startup and works against
  qa/smoke-fixture.sql.gz. run-round.sh + seed-personas.sql then two-bot is
  the full sweep; run-smoke.sh stays the quick authoritative regression.

## Rounds

### r295 · 2026-08-15 · ROUND IN PROGRESS (FULL — rotation #2 client desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build
  flake). Triage: nothing to triage from smoke. Two-bot + journey
  (client-desktop /news depth + brand-profile news) running next.

### r294 · 2026-08-14 · LIGHT (r293 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build
  flake). Two-bot round 294: exit 0, all scenarios ok, 2 logged issues
  both listed noise (rocketreach-400; keyless-AI 503). 0 raw 500/502/504
  in the whole round's server log (status tally: only 2xx/3xx/expected
  400/401/403/404 + no-key 503s; 403s the harness's negative probes;
  404s the listed HR-photo + sharepoint-root polling + the harness's own
  requirements-leasing probe; the 2 400s the rocketreach + image-studio
  harness probes; 401s pre-auth /api/auth/me + no-key M365 class).
  0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r294 was LIGHT → r295 FULL).

### r293 · 2026-08-14 · FULL (rotation #1 staff desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build
  flake). Two-bot round 293: exit 0, all scenarios ok, 2 logged issues
  both listed noise (rocketreach-400; commentary-regen 503). 0 raw
  500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s the harness's
  negative probes; 404s the listed HR-photo + sharepoint-root polling;
  the 2 400s the rocketreach + image-studio harness probes; 401s
  pre-auth /api/auth/me + no-key M365 class).
- Journey: Victoria desktop 1440px — "Monday pipeline review: check the
  deals board, open the live letting deal, leave a note for the team,
  scan calendar + news" (FIRST staff-desktop journey through /deals/list
  → deal DETAIL page, the deal Comments write path, the Timeline/Audit
  expanders, /calendar and /news): login → "/" dashboard → /deals hub →
  /deals/list (2 deals, SOL/EXC chips, Table/Cards/Board toggle) → deal
  #1003 Gail's letting (Parties, Fee Allocation, Xero house copy, KYC,
  Files, Linked Property all render) → Comments card WRITE end-to-end
  (posted note persists across reloads; probe cleaned via SQL after) →
  Timeline expands inline (Deal Timeline 1 event), Audit log expands
  (Change Log 7) → /calendar work-week (team filter chips, Today's
  Schedule; QA-CAL-* rows = concurrent two-bot residue) → /news feed
  (42 sources, tag chips, search). All legs 0 h-overflow, 0 page errors,
  0 non-noise console/net errors. Task completable.
- NOT bugs (tester errors, for future rounds): the deal page renders
  md:hidden MOBILE DUPLICATES of the right-rail cards first in the DOM —
  getByText('Click to add a comment'/'Timeline').first() grabs the
  hidden copy and "element is not visible" forever; filter with
  .locator('visible=true'). Post-comment, the placeholder is REPLACED by
  the comment text (comments is one text column), so re-runs won't find
  the affordance.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  journey exercised the deal-comment write visually; no cheap assertion
  beyond existing deal-detail gates.
- Bugs deferred: none. Suggestions added: UX #48 (deal Comments card
  reads like a team thread but is a single shared text blob — no author/
  timestamp, next comment silently overwrites the last). New flakes:
  none.
- Next journey: rotation #2 client desktop (r293 had the journey → r294
  may be LIGHT; then #2).

### r292 · 2026-08-14 · LIGHT (r291 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build
  flake). Two-bot round 292: exit 0, all scenarios ok — incl. the FIRST
  live run of r291's staff-comps-mobile (green; the 390px /comps + Add
  Comp dialog assertions hold). 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in the whole
  round's server log (the lone " 500 " grep hit is the "500 articles"
  news-feed text again; status tally: only 2xx/3xx/expected
  400/401/403/404 + no-key 503s; 403s the harness's negative probes; 404s
  the listed HR-photo + sharepoint-root polling; the 2 400s the
  rocketreach + image-studio harness probes; 401s pre-auth /api/auth/me +
  no-key class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r292 was LIGHT → r293 FULL).

### r291 · 2026-08-14 · FULL (rotation #4 staff mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build
  flake). Two-bot round 291: exit 0, all scenarios ok, 2 logged issues
  both listed noise (rocketreach-400; commentary-regen 503). Lone 500 in
  the server log is GET /api/auth/microsoft — my own journey script's
  first-pass mis-click on "Sign in with Microsoft" (r289 class; fixed the
  script to use data-testid button-guest-login). Status tally otherwise
  only 2xx/3xx/expected 400/401/403/404 + no-key 503s.
- Journey: Victoria @ 390px iPhone UA — "on the train to a rent-review
  call: pull up the comps board for lettings evidence, then find the
  Landsec key contact in People" (FIRST staff-mobile coverage of /comps
  and the /contacts People hub): UI login via the guest form → "/"
  dashboard (0 h-overflow) → /comps (Leasing board renders, KPI strip,
  search narrows, 0 h-overflow) → comp card opens inline detail (NER
  Calculator + property/transaction sections) → Add Comp dialog probe:
  all controls inside 390px, Create/Cancel visible → /contacts People hub
  (Table/Cards toggle, Landlords/Agents/Lenders tabs, KPI cards, 0
  h-overflow) → search "Landsec" → View People → Landsec company profile
  → Key Contacts "Show all 4" expand works at 390px → contact reachable
  (Maria Portfolio — the fixture's Landsec key contact; Mark Warne is a
  login USER, not a crm_contact, so he's not in Key Contacts — that's
  data, not a bug). Task completable; 0 page errors, 0 non-noise
  console/net errors.
- NOT bugs (triaged, for future rounds): CRM hub "BGP Clients" KPI shows
  0 — the fixture's Landsec row is company_type='Landlord' with
  is_portfolio_account=false, and the KPI keys off companyType/portfolio
  flag (people.tsx clientLandlords); production data sets the flag, so
  fixture artifact, not app logic. "Search landlords…" box on /contacts
  searches COMPANIES on the active tab — a person-name search ("Mark
  Warne") correctly 0-hits (UX #13's brand hint already covers the
  zero-hit case). QA-COMP R291 / QA Contact rows in journey screenshots
  are the concurrent two-bot round's residue (purged next round).
- Bugs fixed: 0 (nothing broken found). Harness growth: two-bot +1
  staff-comps-mobile (/comps at 390px: Add Comp button + page no
  h-scroll; Add Comp dialog controls all inside the viewport —
  r265/r275/r283 mobile-clipping class). Assertions verified live this
  round via the journey's geometry probes (dialog 374px @ x8, 0 clipped
  controls); node --check clean; first live run from r292.
- Bugs deferred: none. Suggestions added: UX #47 (staff /comps shows
  "N AI leads awaiting review" but the Leads tab is admin-parked — count
  with no path to act). New flakes: none.
- Next journey: rotation #1 staff desktop (r291 had the journey → r292
  may be LIGHT; then #1).

### r290 · 2026-08-14 · LIGHT (r289 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build
  flake). Two-bot round 290: exit 0, 186 scenarios ok — incl. the FIRST
  live runs of r289's staff-tenancy-bare-redirect +
  client-tenancy-bare-redirect (both green; the bare /tenancy-schedule →
  /properties redirect holds). 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in the whole
  round's server log (the lone " 500 " grep hit is the "500 articles"
  news-feed text again; API status tally: only 2xx/3xx/expected
  400/401/403/404 + no-key 503s; 404s the listed HR-photo +
  sharepoint-root polling; the 2 400s the rocketreach + image-studio
  harness probes; 401s pre-auth /api/auth/me + no-key class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r290 was LIGHT → r291
  FULL).

### r289 · 2026-08-14 · FULL (rotation #3 client mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba
  trust per r205 — method-column awk; restore-as-postgres + per-object
  ALTER owners + schema grant per r249). Regression: run-smoke.sh GREEN
  ×2 (42 checks, 0 failures; FRESH_BUILD=1 before the fix, rebuilt
  bundle after; no cold-build flake either pass). Two-bot round 289:
  exit 0, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). Lone 500 in the server log is GET
  /api/auth/microsoft — the journey script's own mis-click on the
  "Sign in with Microsoft" button (keyless local); status tally
  otherwise only 2xx/3xx/expected 400/401/403/404 + no-key 503s.
- Journey: Mark Warne @ 390px iPhone UA — "a lease event is coming:
  open my Bluewater property, find which leases expire soonest, and get
  to the tenant" (FIRST client-mobile coverage of the property page,
  the embedded Schedule card, and the tenancy Full Board): UI login via
  the client form → Portfolio home → /properties → Bluewater property
  page (0 h-overflow) → Schedule card (defaults OPEN — 200 units,
  Tenancy lens toggle works, sticky Unit cell 208px vs 326px window =
  118px moving view, r283 cap holds for clients) → "Full Board" link →
  /tenancy-schedule/:id renders (KPIs, search) → search "Starbucks"
  narrows to 2 rows with expiry dates (24 Dec 2027) → tenant anchor →
  Starbucks profile (Compliance + Covenant per the 2026-08-01 decision,
  0 staff-leak buttons, 0 h-overflow). Task completable; 0 page errors,
  0 non-noise console/net errors.
- Bug fixed (1): bare /tenancy-schedule (no propertyId — bookmark or
  hand-typed; it IS on CLIENT_ALLOWED_ROUTES) rendered "Page not found"
  for every persona — the Router only had /tenancy-schedule/:propertyId
  (r269 /messages dead-route class). Added TenancyScheduleRedirect →
  /properties (client/src/App.tsx); verified in-browser: staff desktop,
  client desktop AND client mobile all land on /properties, no
  Page-not-found. tsc clean, rebuilt, smoke re-green. (First redirect
  target tried was /leasing-schedule — rejected: that board is retired
  and says so in a banner.)
- Harness growth: two-bot +2 staff-tenancy-bare-redirect +
  client-tenancy-bare-redirect (bare /tenancy-schedule must land on
  /properties, never Page-not-found). Assertions verified standalone
  green both personas; node --check clean; run from r290.
- NOT bugs (triaged, for future rounds): property-page Schedule card
  defaults OPEN — a journey script that clicks toggle-schedule CLOSES
  it (my first probe's "no tenancy lens" was self-inflicted). Property
  detail sections hydrate lazily — waitForSelector toggle-schedule
  (~4s) before asserting, or count()==0 false-fails. Client mobile
  property page THIS WEEK'S FOCUS task quick-add + tenancy Add/delete/
  "+ Tracker" = decided client write-parity (r287/r279 class). Fixture
  row U007 carries lease expiry 30 Dec 2154 — fixture oddity, not an
  app date bug.
- Bugs deferred: none. Suggestions added: none (search-below-KPI-stack
  friction on the mobile full board is already UX #45; chat-first brand
  profile burying Key Contacts is UX #32). New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r289 had the journey →
  r290 may be LIGHT; then #4).

### r288 · 2026-08-14 · LIGHT (r287 had the journey)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 288: exit 0,
  all scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key
  503s; 403s the harness's negative probes; 404s the listed HR-photo +
  sharepoint-root polling; the 2 400s the rocketreach + image-studio
  harness probes; 401s all /api/microsoft/* no-key + pre-auth
  /api/auth/me). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r288 was LIGHT → r289
  FULL).

### r287 · 2026-08-14 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 287: exit 0,
  all scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (the lone " 500 " grep hit is the "500 articles" news-feed text
  again; status tally: only 2xx/3xx/expected 400/401/403/404 + no-key
  503s).
- Journey: Mark Warne desktop 1440px — "a lease event is coming up: open
  my Bluewater property, scan the tenancy schedule for expiries, look at
  the tenant brand, add a calendar event to discuss with BGP" (FIRST
  client-desktop journey through the tenancy schedule AND the client
  calendar Add-event WRITE path): login → Portfolio home → /properties
  (2 rows, ownership chips) → Bluewater property page (jailed Files
  panel holds, news feed, risk register) → /tenancy-schedule (201 units,
  expiry column, search "Starbucks" narrows to 2 rows with expiry dates)
  → Starbucks profile via tenant link (Covenant + Compliance per the
  2026-08-01 decision, 0 staff-leak buttons) → /calendar → Add event
  dialog END-TO-END (title + location, Save) → event renders in the
  work-week grid + Today's Schedule; API row confirmed, client DELETE
  200 (probe cleaned). All legs 0 h-overflow, 0 page errors; only
  sightings were listed noise (sharepoint-root 404s, brand-gaps 503s =
  keyless-AI class).
- NOT bugs (triaged, for future rounds): client tenancy schedule shows
  Add / per-row delete / Status dropdowns / Set-tenant inline edits —
  genuine parity by design (POST/PUT/DELETE /api/tenancy-schedule/unit*
  all allow own-property client writes, "Landsec audit" comments in
  server/tenancy-schedule.ts; same class as the r279 tracker triage).
  QA-UNIT-R287 row on the schedule + QA-CAL-MINE-R287 event on the
  calendar were the CONCURRENT two-bot round's residue (purged at next
  round's start), not app rows.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  calendar write path exercised visually; client-tenancy scenarios
  already lock the write gates.
- Bugs deferred: none. Suggestions added: UX #46 (client property KYC
  panel exposes an EDITABLE "Set billing entity" control — PUT succeeds
  for own-portfolio, letting a landlord steer BGP's fee-invoicing SPV;
  wants read-only for client viewers). New flakes: none.
- Next journey: rotation #3 client mobile 390px (r287 had the journey →
  r288 may be LIGHT; then #3).

### r286 · 2026-08-14 · LIGHT (r285 had the journey)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 286: exit 0,
  all scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  the 400 pair in the log is rocketreach + the image-studio harness
  probe; the lone 503 issue a keyless-AI route). 0 raw 500/502/504 in
  the whole round's server log (the lone " 500 " grep hit is the "500
  articles" news-feed text again; status tally: only 2xx/3xx/expected
  400/401/403/404 + no-key 503s; 403s the harness's negative probes;
  404s the listed HR-photo + sharepoint-root polling + the harness's
  own requirements-leasing probe; 401s all /api/microsoft/* no-key +
  pre-auth /api/auth/me). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r286 was LIGHT → r287 FULL).

### r285 · 2026-08-13 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 285: exit 0,
  all scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (the lone " 500 " grep hit is the "500 articles" news-feed text
  again; status tally: only 2xx/3xx/expected 400/401/403/404 + no-key
  503s).
- Journey: Victoria desktop 1440px — "a brand is circling a vacant
  Bluewater unit: create/extend the targeting brief with a target
  operator, log the viewing, then check the Landsec client sees the
  activity" (FIRST staff-desktop journey through the tracker WRITE
  dialogs — Brief dialog target add via the BrandSearchInput popover +
  Viewings dialog): login → "/" dashboard → /available (search narrows
  to the unit) → Brief dialog → operator popover → "Use … as typed" →
  Add (row lists, adder auto-set as Agent) → Viewings dialog → Add
  Viewing → save ("Viewing added" toast, row lists, tracker chip count
  bumps) → AS MARK: /available renders, same unit found by search,
  target-operator row visible, viewings count matches, viewing detail
  readable in the dialog (decided client parity holds). Both trackers
  0 h-overflow; 0 page errors, 0 non-noise console/net errors. Probe
  viewing/target/brief cleaned via API (200s).
- NOT bugs (triaged, for future rounds): journey probes on the resolved
  fixture unit (Bluewater MSU9) COLLIDE with two-bot residue — two-bot's
  own R285 QA-TGT-/QA-VIEWING- rows live on that same unit until the
  next round's purge, so "2 rows deleted where I added 1" is residue,
  not a double-submit. Client tracker screenshot right after Escape
  catches the dialog's fade-out ghost frame (empty-state flash mid-
  animation) — cosmetic, invisible at real speed.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  agent-log-viewing + client-sees-agent-viewing already lock the
  staff-viewing → client-sees cross-check, client-brief-target-scope
  locks targets; this round verified the dialog UI paths visually.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r285 had the journey → r286
  may be LIGHT; then #2).

### r284 · 2026-08-13 · LIGHT (r283 had the journey)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 284: exit 0,
  all scenarios ok — incl. the FIRST live run of r283's
  staff-property-tenancy-mobile (green; the property action-row wrap +
  tenancy pinned-column cap fixes hold at 390px). 2 logged issues both
  listed noise (rocketreach-400; commentary-regen 503). 0 raw
  500/502/504 in the whole round's server log (the lone " 500 " grep hit
  is the "500 articles" news-feed text again; status tally: only
  2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s the harness's
  negative probes; 404s the listed HR-photo + sharepoint-root polling +
  the harness's own requirements-leasing probe; the 2 400s the
  rocketreach + image-studio harness probes; 401s all /api/microsoft/*
  no-key + one pre-auth /api/auth/me). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r284 was LIGHT → r285 FULL).

### r283 · 2026-08-13 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1
  before the fixes, rebuilt bundle after; no cold-build flake either
  pass). Two-bot round 283: exit 0, all scenarios ok, 2 logged issues
  both listed noise (rocketreach-400; commentary-regen 503). 0 raw
  500/502/504 in both servers' logs (the lone " 500 " grep hit is the
  "500 articles" news-feed text again). Setup note: the mobile login
  form is behind the "Client / guest sign in" toggle — journey scripts
  must click it before waiting for inputs.
- Journey: Victoria @ 390px iPhone UA — "at Bluewater between meetings:
  open the property, find a unit's tenant on the tenancy schedule, get
  the brand's key contact" (FIRST staff-mobile coverage of /properties,
  the property detail page, and /tenancy-schedule/:id): login → "/"
  dashboard (0 h-overflow) → /properties (tab strip wraps, map + 4
  property cards fit) → Bluewater property page → /tenancy-schedule
  (toolbar wraps, KPIs stack, 200 units) → search "Starbucks" narrows to
  2 rows → tenant link → Starbucks profile (KEY CONTACTS card: Tom
  Barista, Head of Acquisitions). Task completable; 0 page errors, 0
  non-noise console/net errors.
- Bugs fixed (2, both r265/r267 mobile-layout classes):
  1. Property page header action row (Ask ChatBGP / Image Studio /
     Create document / Set Up Folders) was a nowrap flex row — 610px at
     390px, Create document + Set Up Folders past the viewport with no
     scroll path. flex-wrap gap-y-1.5 added
     (client/src/components/property-detail.tsx); all four buttons
     inside the viewport at 390px, desktop 1440px still one line (equal y).
  2. Tenancy schedule's pinned Unit column grew to 434px — WIDER than
     the whole 356px scroll window at 390px (long nowrap unit names), so
     every moving column (tenant, dates, rent) slid underneath it:
     sheet unreadable beyond column 1 on phones. Unit-cell InlineEdit
     now capped max-w-[34vw] + truncate below sm
     (client/src/components/PropertyTenancySchedule.tsx); sticky cell
     208px → 148px visible window, tenant column readable + tappable,
     desktop unchanged (0 clipped unit cells at 1440px, sticky 434px as
     before). Both: tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 staff-property-tenancy-mobile (iPhone
  context per r266 pattern — all four property action buttons inside
  390px; tenancy sticky td must leave ≥80px of moving-column window).
  Assertions verified standalone green via the fix-verify probes; node
  --check clean; first live run THIS round (exit 0, no issue rows).
- Bugs deferred: none. Suggestions added: UX #45 (tenancy-schedule
  search feedback lands ~1.5 screens below the box at 390px — KPI stack
  buries the filtered table). New flakes: none.
- Next journey: rotation #1 staff desktop (r283 had the journey → r284
  may be LIGHT; then #1).

### r282 · 2026-08-13 · LIGHT (r281 had the journey)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 282: exit 0,
  all scenarios ok — incl. the FIRST live run of r281's
  client-mobile-brands-hub (green; the 390px brands-hub assertions hold).
  2 logged issues both listed noise (rocketreach-400; commentary-regen
  503). 0 raw 500/502/504 in the whole round's server log (the lone
  " 500 " grep hit is the "500 articles" news-feed text again; status
  tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s the
  harness's negative probes; 404s the listed HR-photo + sharepoint-root
  polling + the harness's own requirements-leasing probe; the 2 400s the
  rocketreach + image-studio harness probes). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r282 was LIGHT → r283
  FULL).

### r281 · 2026-08-13 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 281: exit 0,
  all scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (the lone " 500 " grep hit is the "500 articles" news-feed text
  again).
- Journey: Mark Warne @ 390px iPhone UA — "before meeting a tenant brand:
  look it up in Brand Intelligence, check its covenant/compliance, find
  the key contact's details" (FIRST client-mobile coverage of the /brands
  hub → brand profile → contact detail path): login → "/" Portfolio home
  (0 h-overflow) → Brands tile → /brands hub (category cards, search
  narrows to 1 result, 0 h-overflow) → Starbucks profile via the card
  anchor (Compliance + Covenant present per the 2026-08-01 decision, Key
  Contacts card, 0 staff-leak buttons, 0 h-overflow) → Tom Barista
  contact detail (Edit only per r257/r258 gates, email + company
  rendered, 0 h-overflow). Task completable in reasonable steps; 0 page
  errors, 0 non-noise console/net errors. Only friction: chat-first
  profile buries Key Contacts below the tall chat panel — already logged
  as UX #32 (+r259 addendum), no new note.
- Bugs fixed: 0 (nothing broken found). Harness growth: two-bot +1
  client-mobile-brands-hub (iPhone context per r266 pattern — /brands
  must render the hub with tappable brand cards and no h-overflow;
  BRAND profile must keep its Key Contacts card at 390px). Assertions
  verified standalone green against the fixture's Honi Poke; node
  --check clean; runs from r282.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r281 had the journey →
  r282 may be LIGHT; then #4).

### r280 · 2026-08-13 · LIGHT (r279 had the journey)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 280: exit 0,
  all scenarios ok — incl. the FIRST live run of r279's
  client-landlord-files-gate (green; the landlord-profile jailed files
  panel fix holds). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (the lone " 500 " grep hit is the "500 articles" news-feed text
  again; status tally: only 2xx/3xx/expected 400/401/403/404 + no-key
  503s; 403s the harness's negative probes; 404s the listed HR-photo +
  sharepoint-root polling + the harness's own requirements-leasing
  probe; the 2 400s the rocketreach + image-studio harness probes).
  0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r280 was LIGHT → r281
  FULL).

### r279 · 2026-08-13 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1
  before the fix, rebuilt bundle after; no cold-build flake either pass).
  Two-bot round 279: exit 0, all scenarios ok, 2 logged issues both listed
  noise (rocketreach-400; commentary-regen 503). First run-round.sh
  invocation died on its 3s health check while the warm-up curl was still
  cold-transforming "/" (r276 class — server was fine, re-ran green).
- Journey: Mark Warne desktop 1440px — "how are my Bluewater lettings
  progressing, and who do I chase?" (FIRST client-desktop journey coverage
  of the Letting Tracker at /deals/letting, the Properties tab, and the
  landlord company profile): login → Portfolio home → /deals/letting
  (153 units, status chips + FY Viewings/Offers KPIs, search narrows,
  0 h-overflow) → /deals/list (2 deals, SOL/EXC chips) → deal #1003
  Gail's letting (r263 gates hold: Timeline hidden, Files jailed copy,
  Audit log present) → Properties tab (map + 2 rows) → Landsec company
  profile via ownership chip. NOT bugs (triaged): client tracker shows
  Add Unit / edit / delete / Target operator — genuine parity by design
  (server allows own-portfolio unit writes, fee stripped; checked
  routes.ts gates); 'main' locator absent on /deals/list (page structure,
  harness visit() already tolerates it).
- Bug fixed (1): landlord company profile Files card mounted the STAFF
  SharePoint browser for clients (r223/r265 staff-leak class): "Set Up
  Folders" + "Upload" + drag-drop invite all 403 for clients (M365
  sealed), the per-team folder GET fired a 403 on every client visit,
  and the error state read "No folder linked yet" (misleading). Now
  swaps per viewer like the property page: staff keep PropertyFoldersPanel
  + Set Up Folders; clients get the jailed ClientPropertyFoldersPanel
  (client/src/components/brand-profile-panel.tsx). Verified in-browser
  both personas: Mark → jailed Documents panel, house copy, 0 staff
  buttons, 0 property-folders fires; Victoria unchanged (panel + both
  buttons; her 401 is listed M365-noise). tsc clean, rebuilt, smoke
  re-green.
- Harness growth: two-bot +1 client-landlord-files-gate (client on
  /companies/:landsec must have no staff folders panel / Set Up Folders /
  Upload, must keep the jailed panel, and zero 4xx property-folders
  fires — own listener since /api/microsoft/ is globally ignored).
  Assertions verified standalone via the fix-verify probes; node --check
  clean; runs from r280.
- Bugs deferred: none. Suggestions added: UX #44 (client deal page names
  no BGP owner to chase — lead only findable on the company profile's BGP
  Team card two hops away). New flakes: none.
- Next journey: rotation #3 client mobile 390px (r279 had the journey →
  r280 may be LIGHT; then #3).

### r278 · 2026-08-13 · LIGHT (r277 had the journey)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 278: exit 0,
  181 scenarios ok — incl. the FIRST live run of r277's
  staff-image-studio-redirect (green; the /image-studio → /m/images
  guard holds). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key
  503s; 403s the harness's negative probes; 404s the listed HR-photo +
  sharepoint-root polling + the harness's own requirements-leasing
  probe; the 2 400s are the rocketreach + image-studio harness probes).
  0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r278 was LIGHT → r279 FULL).

### r277 · 2026-08-12 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust per r205 — method-column awk;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 277: exit 0,
  all scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key
  503s; 403s the harness's negative probes).
- Journey: Victoria desktop 1440px — "a brand asked for photos of a
  Bluewater unit: find them via Image Studio, add today's new unit
  photo; also, does a pasted /image-studio admin link dead-end?" (FIRST
  journey coverage of the staff image gallery /m/images anywhere):
  login → "/" dashboard → sidebar "Image Studio" (rewritten to /m/images
  for non-admin staff) → gallery renders, 0 h-overflow → upload leg
  END-TO-END: Add photos file input → "Uploaded — ready to edit with AI"
  toast, edit sheet opens (image, phone-upload tag, download/folder/
  link/trash controls, AI prompt chips) → direct /image-studio goto
  bounces cleanly to /m/images (StudioRoute guard, no Page-not-found).
  Probe row deleted after. 0 page errors, 0 non-noise net errors.
  NOT bugs (tester errors, for future rounds): staff /m/images shows
  ONLY phone-upload-tagged photos by design ("phone-upload filter is a
  staff convenience", mobile-images.tsx:190) — 0 tiles with a
  brands-only fixture is intended, don't triage the empty grid; the
  fixture qa-unit-photo.jpg row is the harness's own upload probe
  (run-round.sh purges it at round start). Radix logs a DialogTitle
  a11y warning from the edit sheet (dev console only, cosmetic).
- Bugs fixed: 0 (nothing broken found — journey's only real finding is
  a UX gap, below). Harness growth: two-bot +1 staff-image-studio-
  redirect (non-admin /image-studio must land on /m/images with the
  gallery shell rendered; assertions verified standalone green in the
  browser this round; node --check clean; runs from r278).
- Bugs deferred: none. Suggestions added: UX #43 (staff desktop "Image
  Studio" nav lands on the phone-uploads-only gallery — non-admin staff
  have NO route to the team image library, and the empty-state copy is
  phone-phrased on desktop). New flakes: none.
- Next journey: rotation #2 client desktop (r277 had the journey → r278
  may be LIGHT; then #2).

### r276 · 2026-08-12 · LIGHT (r275 had the journey)
- Fresh container (pg_hba trust per r205 — method-column-only sed;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 276: exit 0,
  180 scenarios ok — incl. the FIRST live run of r275's
  staff-tasks-mobile-tabs (green; the tasks filter-tab wrap fix holds).
  2 logged issues both listed noise (rocketreach-400; commentary-regen
  503). 0 raw 500/502/504 in the whole round's server log (the lone
  " 500 " grep hit is the "500 articles" news-feed text again; status
  tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s the
  harness's negative probes; 404s the listed HR-photo + sharepoint-root
  polling + the harness's own requirements-leasing probe; the 2 400s
  are the rocketreach + image-studio harness probes). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none new — one setup note: run-round.sh's 3s
  health check can fail while the dev server is still cold-transforming
  "/" (warm-up curl in flight); wait for the warm-up then retry (r264
  cold-transform class).
- Next journey: rotation #1 staff desktop (r276 was LIGHT → r277 FULL).

### r275 · 2026-08-12 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust per r205; restore-as-postgres + per-object
  ALTER owners + schema grant per r249). Regression: run-smoke.sh GREEN ×2
  (42 checks, 0 failures; FRESH_BUILD=1 before the fix, rebuilt bundle
  after; no cold-build flake either pass). Two-bot round 275: exit 0, all
  scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server log
  (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s
  the harness's negative probes; 404s the listed sharepoint-root polling +
  HR photos; the rocketreach + image-studio 400s the harness's own probes).
- Journey: Victoria @ 390px iPhone UA — "between viewings, on my phone:
  check the requirements board, log a new requirement, quick-add a
  follow-up task, confirm it shows on my dashboard" (FIRST coverage of
  staff-mobile /requirements, the Create Leasing Requirement dialog, and
  /tasks quick-add at 390px): login → "/" dashboard (0 h-overflow) →
  /requirements (renders, tabs/KPIs/Add Requirement all inside viewport) →
  Create Requirement dialog END-TO-END: 61 visible controls all inside
  390px, typed name → "+ Add as new company" → Save (below the fold,
  in-dialog scroll reaches it) → row appears, probe req + auto-created
  company deleted via API (200/200) → /tasks quick-add ("Add a task…
  press Enter" input, row lists) → task visible on dashboard MY TASKS.
  0 page errors; only non-listed sighting was GET /api/ai-briefing 503×6
  (keyless noise class; card TERMINATES — flickers idle↔"Preparing…"
  during react-query retries then settles on "Generate Briefing" — NOT
  the r261 forever-spinner class).
- Bug fixed (1): /tasks filter tab strip (Assigned by me/All/To Do/
  In Progress/Done) was a nowrap flex row — Done sat at x 425-494 at
  390px, only reachable by panning the ENTIRE page pane sideways 104px
  (the strip itself has no scroll; r265 calendar-toolbar class). Added
  flex-wrap to the header row + tab row (client/src/pages/tasks.tsx);
  tabs wrap to a second row, all five inside the viewport, pane
  h-overflow 0. Desktop 1440px re-verified: single row (equal y).
  tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 staff-tasks-mobile-tabs (iPhone context per
  r266 pattern — all five filter tabs inside 390px + no content-pane
  h-scroll). Assertions verified standalone via the journey probes
  (geometry green post-fix); node --check clean; runs from r276.
- NOT bugs (tester errors, for future rounds): the Create Requirement
  dialog Save needs the "+ Add … as a new company" pick first and sits
  below the fold — a bare tap on Save without scrolling the dialog times
  out; the flow is fine as a real user drives it.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r275 had the journey → r276
  may be LIGHT; then #1).

### r274 · 2026-08-12 · LIGHT (r273 had the journey)
- Fresh container (pg_hba trust per r205 — method-column-only sed;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 274: exit 0,
  all scenarios ok — incl. first live runs of r273's mobGoto-hardened
  gotos (client-mobile-controls-reachable green, no ERR_ABORTED recur).
  2 logged issues both listed noise (rocketreach-400; commentary-regen
  503). 0 raw 500/502/504 in the whole round's server log (the lone
  " 500 " grep hit is the "500 articles" news-feed text again; status
  tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s are
  the harness's negative probes; 404s the listed HR-photo + sharepoint-
  root polling + the harness's own requirements-leasing probe; the
  image-studio bulk-assign 400 is the harness's own probe, scenario ok).
  0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r274 was LIGHT → r275
  FULL).

### r273 · 2026-08-12 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust per r205 — method-column-only sed;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 273: exit 0,
  178 scenarios ok, 3 logged issues — 2 listed noise (rocketreach-400;
  commentary-regen 503), 1 flow-failure client-mobile-controls-reachable
  "page.goto: net::ERR_ABORTED at /requirements" = the r204
  redirect-on-mount goto race under round load (first flake since its
  r266 rebuild): standalone re-run 5/5 green, new-brand count 0 every
  pass — NOT an app bug.
- Journey: Mark Warne @ 390px iPhone UA — "just walked a vacant Bluewater
  unit with an agent: log the viewing on my phone, then check the unit's
  asking rent and existing interest" (FIRST coverage of the tracker WRITE
  path — Add Viewing dialog — at client mobile): login → "/" Portfolio
  home → tracker link → /available (153 units, 0 h-overflow) → search
  MSU3 (2 cards) → card "Viewing" button → dialog opens with the Add form
  → company combobox works inline at 390px in-dialog (typed Starbucks,
  picked; r253 EntityCombobox shape holds), date defaults today (UX #2
  holds), Save inside the viewport → "Viewing added" toast, row lists
  with company/date/attendees, card chip flips to "Viewing (1)" →
  Interest button opens the Offers dialog clean (Add Offer form, all
  fields inside 390px). Probe viewing deleted via API (200) — client
  parity delete works. 0 page errors; only non-listed sighting was
  3× 503 GET /api/ai-briefing on the client home = keyless-AI noise
  class (generic "503s from AI/M365 endpoints" line covers it). 0 app
  bugs.
- Bugs fixed: 0 (nothing broken found). Harness fix (1): new mobGoto
  helper retries once on ERR_ABORTED (swallow-only would false-pass
  assertions against the wrong page) — applied to the post-localStorage
  gotos in client-mobile-controls-reachable, staff-deal-mobile-action-row
  and client-mobile-no-overflow (qa/two-bot-round.mjs; node --check
  clean; live from r274).
- Bugs deferred: none. Suggestions added: UX #42 (mobile tracker unit
  card silently drops Rent/Area rows when unset — user can't tell
  unrecorded from hidden; wants "—"/"not set" per confirmed #4 pattern).
  New flakes: none new (the /requirements abort joins the documented
  r204 class, now hardened). FIXTURE NOTE: MSU3 Bluewater exists TWICE
  in the fixture (both AVA, same name, no rent/sqft) — dupe rows, mind
  probes that assume one.
- Next journey: rotation #4 staff mobile 390px (r273 had the journey →
  r274 may be LIGHT; then #4).

### r272 · 2026-08-12 · LIGHT (r271 had the journey)
- Fresh container (pg_hba trust per r205 — method-column-only sed;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 272: exit 0,
  179 scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (the lone " 500 " grep hit is the "500 articles" news-feed text
  again; status tally: only 2xx/3xx/expected 400/401/403/404 + no-key
  503s; 403s are the harness's negative probes; 404s are the listed
  sharepoint-root polling + missing HR photos). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r272 was LIGHT → r273
  FULL).

### r271 · 2026-08-12 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust per r205 — method-column-only sed;
  restore-as-postgres + per-object ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 271: exit 0,
  179 scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server log
  (the lone " 500 " grep hit is the "500 articles" news-feed text again).
- Journey: Mark Warne desktop 1440px — "board asked about a tenant brand's
  financial standing: review its compliance, then add a brand we're
  courting to our CRM and find who to chase" (FIRST client-desktop journey
  coverage of the Brand Intelligence hub tabs, brand-profile Compliance/KYC
  panel, and the Add-brand dialog UI): login → Portfolio home → /brands hub
  (Overview KPIs, 9 brands) → Brand Explorer tab + search → Starbucks
  profile (Compliance & KYC panel visible per the 2026-08-01 decision,
  Covenant, competitor set, news; NO staff leaks — 0 Run-checks/Delete/
  Enrich/RocketReach buttons; 0 h-overflow) → Key Contacts → Tom Barista
  detail (Edit only, r257/r258 gates hold) → Turnover Board + Brand Hunter
  tabs (both render client-side, no errors) → Add brand dialog END-TO-END:
  search Testco Jewellers (out-of-slice) → Add → row flips to Remove →
  brand appears in Brand Explorer → its profile renders with compliance
  panel → removed via API, state restored. 0 page errors, 0 non-noise
  console/net errors across all legs. 0 app bugs.
- FIXTURE NOTE (future add-brand probes): the fixture ships Landsec with
  Testco Fashion (aaaaaaaa-…-0002) ALREADY in crm_extra_brand_ids — its
  dialog row shows Added/Remove from the start; probe with Testco
  Jewellers (…0007) instead. (My first probe removed the fixture extra —
  restored via SQL same round.)
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  UX #40 (client-visible Brand-expansion AI commentary ends with BGP-
  internal "Do not pitch until KYC due diligence…" advice), UX #41
  (Instagram card empty state prints "Meta Graph API credentials not set
  on server" to clients — wants house copy). New flakes: none. Harness
  growth: none needed (add-brand round-trip + remove-UI already covered;
  this round verified the Add-side flip visually).
- Next journey: rotation #3 client mobile 390px (r271 had the journey →
  r272 may be LIGHT; then #3).

### r270 · 2026-08-12 · LIGHT (r269 had the journey)
- Fresh container (pg_hba trust per r205 — note: a blanket sed can mangle
  scram-sha-256 → trust-sha-256, check the file before reload;
  restore-as-postgres + per-table ALTER owners + schema grant per r249 —
  blanket REASSIGN OWNED BY postgres is rejected by pg16, use the
  per-object loop). Regression: run-smoke.sh GREEN first pass (42 checks,
  0 failures, fresh DB + FRESH_BUILD=1; no cold-build flake). Two-bot
  round 270: exit 0, 179 scenarios ok — incl. the FIRST live runs of
  r269's staff-messages-desktop-redirect + client-messages-desktop-
  redirect (both green; the desktop /messages → /chatbgp fix holds).
  2 logged issues both listed noise (rocketreach-400; commentary-regen
  503). 0 raw 500/502/504 in the whole round's server log (status tally:
  only 2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s are the
  harness's negative probes). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r270 was LIGHT → r271 FULL).

### r269 · 2026-08-12 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER owners
  + schema grant per r249). Regression: run-smoke.sh GREEN ×2 (42 checks,
  0 failures; FRESH_BUILD=1 before the fix, rebuilt bundle after; no
  cold-build flake either pass). Two-bot round 269: exit 0, all scenarios ok,
  2 logged issues both listed noise (rocketreach-400; commentary-regen 503).
  0 raw 500/502/504 in the whole round's server log (the lone " 500 " grep
  hit is the text "500 articles" in a news-feed log line).
- Journey: Victoria desktop 1440px — "after an intro call with a new
  Starbucks contact: get them into the CRM, then ask ChatBGP a question"
  (FIRST journey hunt for the staff manual add-contact path + FIRST visit
  to staff-desktop ChatBGP): login → /contacts CRM hub (Landlords/Agents/
  Lenders render; 0 add-contact controls on any tab) → Landsec + Starbucks
  profiles (render clean, contacts board has only inbox-scan Add +
  RocketReach refresh) → /chatbgp (keyless "Not Connected — AI service is
  not configured" house state, no hang — GREEN). Core task IMPOSSIBLE as
  the user: no manual add-contact entry point anywhere for staff (the
  complete New Contact dialog in pages/contacts.tsx is orphaned — /contacts
  routes to the People hub; staff POST /api/crm/contacts still 201s) —
  logged as UX #39, not built (entry-point placement is Woody's call).
  Ai-take 503s on profiles = no-key noise (added to noise list below).
  NOT bugs (tester errors): /messages is mobile-only by design (bottom-nav
  tab) — but see the fix below; first "manual-add=1" probe hit was the
  regex matching "no NEW CONTACTs found" in the scan banner, not a control.
- Bug fixed (1): desktop /messages showed "Page not found" (r257 /login
  class): the mobile chat list is intercepted before the desktop Router,
  which had no /messages route — a mobile bookmark/shared link opened on
  desktop dead-ended (clients additionally guard-bounced home, since
  /messages wasn't CLIENT_ALLOWED). Added MessagesRedirect → /chatbgp in
  the authenticated Router + "/messages" to CLIENT_ALLOWED_ROUTES
  (client/src/App.tsx). Verified in-browser both personas: staff and Mark
  land on /chatbgp, no "Page not found". tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +2 — staff-messages-desktop-redirect and
  client-messages-desktop-redirect (desktop /messages must land on
  /chatbgp, never Page-not-found/guard-bounce). Assertions verified
  standalone in-browser both personas; node --check clean; run from r270.
- Environment noise addition: GET /api/brand/:id/ai-take/* 503s (keyless
  AI-take panels on company profiles fire them on load; UI shows the
  intended "AI take unavailable" copy).
- Bugs deferred: none. Suggestions added: UX #39 (staff have no manual
  add-contact path; orphaned New Contact dialog). New flakes: none.
- Next journey: rotation #2 client desktop (r269 had the journey → r270
  may be LIGHT; then #2).

### r268 · 2026-08-12 · LIGHT (r267 had the journey)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER owners
  + schema grant per r249). Regression: run-smoke.sh GREEN first pass
  (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build flake).
  Two-bot round 268: exit 0, all scenarios ok — incl. the FIRST live run of
  r267's staff-deal-mobile-action-row (green; the deal action-row wrap fix
  holds). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server log
  (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s
  are the harness's negative probes; the lone requirements-leasing 404 and
  image-studio bulk-assign 400 are the harness's own probes, scenarios ok).
  0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r268 was LIGHT → r269 FULL).

### r267 · 2026-08-11 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER owners
  + schema grant per r249). Regression: run-smoke.sh GREEN ×2 (42 checks,
  0 failures; FRESH_BUILD=1 before the fix, rebuilt bundle after; no
  cold-build flake either pass). Two-bot round 267: exit 0, 176 scenarios
  ok — incl. the FIRST live runs of r266's rebuilt
  client-mobile-controls-reachable (green in its iPhone context) — 2 logged
  issues both listed noise (rocketreach-400; commentary-regen 503).
- Journey: Victoria @ 390px iPhone UA — "on the train: how is the Gail's
  deal at Solicitors going — open it, read the latest, log a comment"
  (FIRST journey coverage of the staff deals board + deal DETAIL at staff
  mobile): login → "/" dashboard → bottom-nav Deals (mobile lands on the
  Deals list — 2 cards, status chips, search) → U124 Gail's deal detail
  (header chips, Parties, Fee Allocation, Files/Linked Property/Comments/
  History accordions all render, 0 page h-overflow) → comment via the
  Comments InlineText (tap placeholder → textarea, blur-saves PUT 200,
  persists across reload). Probe comment cleared after via API. 0 page
  errors, 0 non-noise console/net errors.
- Bug fixed (1): staff deal-detail action row (Image Studio / Create
  document / Edit) is a nowrap flex row — 412px wide at a 390px phone, so
  EDIT sat past the viewport with no scroll path (row overflow visible,
  scrollLeft stuck 0; r265 calendar-toolbar class). Added flex-wrap
  gap-y-1.5 (client/src/components/deal-detail.tsx); Edit now wraps to a
  second row, all three actions inside the viewport (verified 390px
  iPhone UA). Desktop 1440px re-verified: row still a single line (equal
  y for all three). tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 staff-deal-mobile-action-row (Gail's deal at
  390px iPhone context per r266 pattern — all three action buttons must
  sit inside the viewport). Assertions verified standalone via the journey
  probes (geometry green post-fix); node --check clean; runs from r268.
- NOT bugs (triaged): mid-journey "client shell as Victoria" (Portfolio
  nav, client Files copy, no Fee Allocation) = the CONCURRENT two-bot
  staff-switch-to-client-view scenario flipping her server-persisted
  active_team mid-run — self-inflicted window, cleared when the scenario
  exits; journey re-run post-window showed the staff shell. Deal Comments
  panel: header tap TOGGLES it closed (it defaults open) and the editor is
  a click-to-edit InlineText — first "no textarea" triage was a tester
  error. deal-detail treats an unresolved viewer as client (!ddUser at
  deal-detail.tsx:208) — deliberate fail-closed default, renders staff
  extras once /me lands.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r267 had the journey → r268 may
  be LIGHT; then #1).

### r266 · 2026-08-11 · LIGHT (r265 had the journey)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER owners
  + schema grant per r249). Regression: run-smoke.sh GREEN ×2 (42 checks,
  0 failures; FRESH_BUILD=1 before the fix, rebuilt bundle after; no
  cold-build flake either pass). Two-bot round 266: exit 0, 175 scenarios
  ok, 3 logged issues — 2 listed noise (rocketreach-400; commentary-regen
  503), 1 was the FIRST live run of r265's client-mobile-controls-reachable
  failing on ITS OWN environment, not the app (below).
- Bug fixed (1, r265's deferred item): calendar Intelligence footer clipped
  its insight text mid-word at 390px — the Intelligence label (178px) +
  date stamp (84px) chrome left the strip 56px of visible width, and the
  first nowrap card is 391px wide, so phones saw "🔥 I…" and nothing else.
  Footer now hides the label text + date group below sm and caps the
  insight detail at max-w-[58vw] with truncate (ellipsis) on mobile
  (client/src/components/intelligence-footer.tsx). Verified 390px iPhone
  UA: first card fully inside the viewport with clean ellipsis, strip
  285px + swipeable; staff desktop /calendar byte-identical layout (label,
  date, full-width cards). tsc clean, rebuilt, smoke re-green.
- Harness fixes (2, both in client-mobile-controls-reachable —
  qa/two-bot-round.mjs): (a) its first live run failed "toggle-crm-events
  clipped (x 391)" — a TEST bug: it used a bare 390px page in the desktop
  context, and useIsMobile deliberately keeps the DESKTOP layout for
  non-touch/desktop-UA windows (force-desktop support), so it asserted
  phone-layout geometry against the intentionally-squeezed desktop shell.
  Scenario now runs in a dedicated iPhone-emulating context (mobile UA +
  isMobile + hasTouch). (b) that fresh context needs the session COOKIE
  copied over (addCookies) — localStorage authToken/user alone does not
  authenticate, pages silently land on the sign-in screen and count()==0
  assertions false-pass. Also grew the scenario: footer first-insight card
  must sit inside the 390px viewport (guards this round's fix). All
  assertions verified standalone green (view-week 183, toggle-crm 256,
  insight 257 — all < 390); runs from r267. node --check clean.
- NOT bugs (triaged): desktop layout at a 390px-wide desktop-UA window
  (or force-desktop on a phone) genuinely overflows the calendar toolbar —
  intended desktop shell at an extreme width, not a phone surface, left
  alone. Client mobile dashboard has NO IntelligenceFooter (the 134px-wide
  footer-in-card sighting was the same desktop-UA artifact). Repeated
  script logins tripping the 429 limiter mid-triage — listed noise,
  cleared by dev-server restart.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r266 was LIGHT → r267
  FULL).

### r265 · 2026-08-11 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER owners
  + schema grant per r249). Regression: run-smoke.sh GREEN ×2 (42 checks,
  0 failures; FRESH_BUILD=1 before the fixes, rebuilt bundle after; no
  cold-build login flake either pass). Two-bot round 265: exit 0,
  175 scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's dev-server
  log (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s;
  403s are the harness's negative probes).
- Journey: Mark Warne @ 390px iPhone UA — "before a call with BGP: when's
  our next meeting, what requirements are live for us, message BGP" (FIRST
  client-mobile coverage of /calendar, /requirements, /messages): login →
  "/" Portfolio home → /calendar (day grid + red now-line render, client
  Add event present) → /requirements (renders, client slice = 0 rows,
  clean empty state) → /messages (ChatBGP pinned, New Chat). All four
  pages: 0 console/page errors, 0 page h-overflow, 0 non-noise http
  errors.
- Bugs fixed (2, both found by judging the journey pages as the user):
  1. Client Requirements showed the staff-only "New Brand" button (r223
     staff-leak class): its save POSTs /api/crm/companies which is
     read-only for client accounts — 403 "Read-only access" — so the
     dialog advertised a flow that could never save (the dialog even has a
     client category slice, but the write gate is the decided model:
     clients add existing brands via brands-hub add-brand). Button now
     gated behind !isClientView, same as the sync toolbar one line below
     (client/src/pages/requirements.tsx). Verified: Mark 0 buttons,
     Victoria still has it.
  2. Calendar toolbar unusable at 390px: the header row (nav/Today/Add
     event + view toggle + CRM chip) is a non-wrapping flex row — "Week"
     sat clipped at x=410 and the CRM toggle fully past the viewport with
     NO scrollable ancestor (page body doesn't h-scroll), so phone users
     could not switch views or toggle CRM events at all. Added
     flex-wrap gap-y-1.5 to the toolbar (client/src/pages/calendar.tsx);
     controls now wrap to a second row. Verified 390px: all six controls
     inside the viewport, CRM toggle clickable, 0 h-overflow; staff
     desktop toolbar still a single 49px row. Both: tsc clean, rebuilt,
     smoke re-green.
- Harness growth: two-bot +1 client-mobile-controls-reachable (client
  /requirements must have no button-new-brand; calendar view-week +
  toggle-crm-events must sit inside a 390px viewport). node --check
  clean; runs from r266.
- Bugs deferred (1): calendar INTELLIGENCE footer at 390px clips its
  rotating stat text mid-word (screenshot shows "🔥 F…" truncated) —
  cosmetic, triage next round whether it should wrap/shorten.
- Suggestions added: UX #37 (mobile calendar has no "next meeting"
  answer — Day view of today + desktop-only mini-cal; wants an Upcoming
  agenda list), UX #38 (requirements empty state says "Try adjusting
  your filters" when no filters are active; also no hint BGP logs
  requirements for clients). New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r265 had the journey →
  r266 may be LIGHT; then #4).

### r264 · 2026-08-11 · LIGHT (r263 had the journey)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build
  login flake this time). Two-bot round 264: exit 0, 175 scenarios ok —
  incl. the FIRST live run of r263's client-deal-party-link-gates
  (green; the r263 AML-gate + Timeline-card fixes hold). 2 logged
  issues both listed noise (rocketreach-400; commentary-regen 503).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404; every 503 endpoint is a listed
  AI/no-key route + os/sites noise; contact verify now 503s per the
  r261 fix). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: two-bot's FIRST run right after dev-server
  start can die at login with ECONNRESET (Vite still cold-transforming
  the first page load; sibling of the r262 cold-build smoke flake) —
  warm "/" once / re-run before triaging as real.
- Next journey: rotation #3 client mobile 390px (r264 was LIGHT → r265
  FULL).

### r263 · 2026-08-11 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER owners
  + schema grant per r249). Regression: run-smoke.sh GREEN ×2 (42 checks,
  0 failures; FRESH_BUILD=1 before the fixes, rebuilt bundle after — no
  cold-build login flake this time). Two-bot round 263: exit 0, all
  scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). Repo hygiene: the r261 entry in THIS FILE contained
  a literal NUL byte (in the sentence about NUL bytes…) making the log
  binary to git diff/grep — escaped it, log is a text file again.
- Journey: Mark Warne desktop 1440px — "the Gail's letting is at Solicitors:
  read the deal, ask BGP a question via deal comment, check history"
  (FIRST client-desktop journey coverage of deal-detail writes: comments,
  party linking, Timeline/Audit): login → dashboard → /deals table (2 CRM
  deals + tracker subtitle) → U124 Gail's deal → comment via the inline
  editor (saves on blur, PUT 200, persists across reload) → "+ Link tenant"
  picker (works client-side, PUT 200 = decided client-parity write) →
  Timeline + Audit log cards. Probe comment/link cleared after (verified
  via the deal's own Audit log). NOT bugs: comment save-on-blur with no
  Save button felt riskier than it is (blur saves; Esc cancels) — my first
  "lost comment" triage was a tester error (reloaded while the textarea
  still had focus, so blur-save never fired).
- Bugs fixed (2):
  1. Client party-link fired the staff-only AML sweep: handlePartySave
     (deal-detail.tsx) + handleInlineSave (deals.tsx) always toasted
     "Running AML checks — Screening <company>…" then POSTed
     /api/kyc/run-all-checks, which gateway-403s for clients and fetch
     swallows — the client was TOLD screening ran when nothing did (worse
     than noise: a compliance claim). Both homes now skip toast+kick when
     the viewer is a client (isClientDeal / isClientDeals). Verified: link
     as Mark → 0 kyc calls, 0 toast, 0 403; staff path untouched.
  2. Deal-detail Timeline card for clients opened an EMPTY panel — its
     GET /api/deals/:id/timeline is gateway-403 (only /api/crm/ is
     client-allowed, and the route has no per-deal scope check so opening
     the prefix would be wrong); r257 gate pattern applied: Timeline card
     hidden for clients (both sidebar homes via the shared fragment),
     Audit log stays (works, and records client edits). Verified both
     personas: Mark no Timeline + Audit renders; Victoria Timeline renders
     entries. tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 client-deal-party-link-gates (no Timeline
  card / Audit stays / UI tenant-link fires zero run-all-checks; restores
  tenantId=null in finally). Assertions verified standalone via the
  journey probes; runs from r264.
- Bugs deferred: none. Suggestions added: UX #35 (clients have no news
  surface — staff /news has no client equivalent), UX #36 (audit log
  Change Log prints raw company UUIDs, e.g. "changed tenant from
  11110000-… to empty"). New flakes: none.
- Next journey: rotation #3 client mobile 390px (r263 had the journey →
  r264 may be LIGHT; then #3).

### r262 · 2026-08-11 · LIGHT (r261 had the journey)
- Fresh container (pg_hba trust per r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh first run had
  1 failure — client UI login input never rendered in 30s on the cold
  FRESH_BUILD first page load (staff checks all ok; r237 warm-up flake
  class, new flake line below); immediate re-run GREEN 42 checks,
  0 failures. Two-bot round 262: exit 0, all scenarios ok — incl. the
  FIRST live run of r261's staff-ai-failure-terminal (green; the r261
  verify-500 + curate-spinner fixes hold). 2 logged issues both listed
  noise (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in
  the whole round's server log (status tally: only 2xx/3xx/expected
  400/401/403/404/503; every 503 endpoint is a listed AI/no-key route +
  os/sites noise). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: first smoke pass right after FRESH_BUILD can
  time out the client UI-login check (cold first page load); re-run
  before triaging it as real.
- Next journey: rotation #2 client desktop (r262 was LIGHT → r263 FULL).

### r261 · 2026-08-11 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust fix per r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN ×2
  (42 checks, 0 failures; FRESH_BUILD=1 before the fixes and rebuilt bundle
  after). Two-bot round 261: exit 0, all scenarios ok, 2 logged issues both
  listed noise (rocketreach-400; commentary-regen 503). The only raw 500 in
  the whole round's server log was bug 1 below, fired by my own probe.
- Journey: Victoria desktop 1440px — "Monday morning desk sweep: scan brand
  news for signals, drill into a brand, find the key contact, note the
  call, set a follow-up task" (FIRST journey coverage of staff-desktop
  NEWS page and the My Tasks page): login → dashboard → /news (Feed renders,
  42 sources, chips; Landsec chip re-sorts; headline click expands card to
  Read/Save/Extract Leads) → Starbucks profile via CRM (chips, Key
  Contacts, 0 non-noise errors) → Tom Barista contact detail (Enrich/Edit/
  Delete, synced activity board) → Edit Contact dialog (clean, esc closes)
  → /tasks quick-add ("Task created" toast, row lists) → task visible on
  dashboard MY TASKS widget. Probe task deleted post-journey. GREEN apart
  from the two bugs below (found by clicking the page's own AI buttons).
- Bugs fixed (2, both "AI failure never reaches the user properly"):
  1. Contact "Verify with AI" surfaced the raw Anthropic SDK error as a
     500 toast ("Could not resolve authentication method…", r237/r257
     class). Route catch now maps key/auth errors to 503 + house copy
     "Contact verification unavailable — AI service is not configured"
     (server/contact-verify.ts). Verified visually: toast shows house copy.
     Side fix: replaced two literal NUL bytes ("\x00" sentinels) in
     contact-verify.ts with escaped "\x00" — same runtime value, but the
     file was binary to grep/git diff.
  2. Contact/brand "Analyse" (activity curate) spun on "Analysing… 30-60
     seconds" FOREVER when the background job died (no AI key): client poll
     had an unreachable terminal branch (its condition duplicated `fresh`),
     and the GET auto-kick relaunched a doomed job on every 4s poll so
     inFlight never read false. Client now stops with "Analysis didn't
     complete — the AI service may be unavailable" when the job ends
     without a fresh read (client/src/components/ai-activity-card.tsx);
     server tracks recentCurationFailures with a 10-min cooldown before
     auto-re-kick, cleared by explicit POST /curate retry
     (server/activity-routes.ts). Verified visually: panel resolves to the
     error copy in <10s, Analyse button returns to idle. tsc clean,
     rebuilt, smoke re-green.
- Harness growth: two-bot +1 staff-ai-failure-terminal (verify-contact must
  never 500 — 503 needs house copy; curate kick must reach inFlight:false
  within 30s). Negative-probe listed; assertions verified standalone via
  the journey probes; runs from r262.
- Bugs deferred: none. Suggestions added: UX-NOTES #34 (no way to log a
  call/note on a contact — activity board is inbox-synced only, Notes field
  buried in Edit dialog). New flakes: none.
- NOT bugs (triaged): /api/microsoft/* 401s on dashboard = listed noise
  (no M365 creds); news "Sorted for Landsec" content looks generic = AI
  curation is keyless locally, can't judge relevance here.
- Next journey: rotation #2 client desktop (r261 had the journey → r262
  may be LIGHT; then #2).

### r260 · 2026-08-11 · LIGHT (r259 had the journey)
- Fresh container (pg_hba trust fix per r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN (42 checks,
  0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 260: exit 0, all
  scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 = intended no-key degradation). r259's
  negative-probe silencing holds — the client-contact-detail-gates DELETE
  probe no longer echoes as http-403. 0 raw 500/502/504 in the whole
  round's server log (status tally: only 2xx/3xx/expected
  400/401/403/404/503; every 503 endpoint is a listed AI/no-key route +
  os/sites noise). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r260 was LIGHT → r261 FULL).

### r259 · 2026-08-11 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust fix per r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN (42 checks,
  0 failures, fresh DB + fresh build). Two-bot round 259: exit 0, 3 logged
  issues — 2 listed noise (rocketreach-400; commentary-regen 503), 1 was the
  harness's OWN client-contact-detail-gates DELETE-must-403 probe echoing
  through the global response listener (scenario [ok] — r258's fixes hold;
  first live run of the widened blocked-regex green). 0 raw 5xx in the whole
  round's server log.
- Journey: Victoria @ 390px iPhone UA — "on the train to a Starbucks
  meeting: when is it, review the brand, find the contact" (FIRST journey
  coverage of staff CALENDAR + brands hub → brand profile → contact
  drill-in at staff mobile): login → "/" Dashboard → /calendar (day view
  renders, team filter chips, today's events visible incl. correctly
  staff-visible other-client rows) → /brands hub → search "Starbucks" →
  card tap → /companies/:id profile (chips, Chat, Key Contacts with Tom
  Barista, Covenant; 0 h-overflow) → tap contact → /contacts/:id detail
  (Enrich/Edit/Delete, email + mailto, activity board — task done). GREEN:
  0 page errors, 0 non-noise console/net errors, 0 h-overflow anywhere.
  NOT bugs (tester errors, for future rounds): brand profile route is
  /companies/:id (NOT /brand/:id — that's a dead URL and my first pass
  triaged phantom failures off it); hub cards are covered by an
  a[aria-label=<name>] overlay anchor — click THAT, not the name text
  (text-node clicks get intercepted and time out; a real tap works).
- Bugs fixed: 0 app bugs (nothing broken found). Harness fix (1):
  client-contact-detail-gates added to NEGATIVE_PROBE_SCENARIOS so its
  intentional DELETE-403 probe stops logging as an issue every round — its
  read-path 403 assertions live in the scenario's own listener and still
  throw crisply (node --check clean; effective from r260, expect the
  http-403 echo gone).
- Bugs deferred: none. Suggestions added: none new — UX #32 extended with
  an r259 addendum (chat-first brand profile layout equally buries Key
  Contacts for STAFF mobile; fix should cover both personas). New flakes:
  none.
- Next journey: rotation #1 staff desktop (r259 had the journey → r260 may
  be LIGHT; then #1).

### r258 · 2026-08-11 · LIGHT (r257 had the journey)
- Fresh container (pg_hba trust fix per r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN ×2
  (42 checks, 0 failures; FRESH_BUILD=1 before the fixes and rebuilt bundle
  after). Two-bot round 258: exit 0, 18 logged issues — 2 listed noise
  (rocketreach-400; commentary-regen 503), 16 all ONE real bug caught by the
  FIRST live run of r257's client-contact-detail-gates (staff-login-route-
  redirect green): 15× http-403 on GET /api/crm/contacts/…0002 + its
  requirements/deals/properties/investment-tracker subroutes as Mark, plus
  the flow-failure (contact-detail testid never attached — page errored on
  the base 403). The 403s attributed to client-mobile-no-overflow were the
  same page (listener attribution). 0 raw 5xx in the round's issue log.
- Bug fixed (1, client agent-contact read path, server/crm.ts): the contacts
  LIST deliberately serves agent-company contacts to clients ("market-facing
  — the requirements board names the acquiring agent", and its comment even
  claims detail-GET parity) but the detail GET and forbidsContactRead used
  clientCanTouchCompany (own company + brand slice only) — so EVERY agent
  contact a client could see in the list 403'd when opened (error page, not
  detail). New clientCanReadContactCompany (touch ∪ company_type ILIKE
  'Agent%') now gates the detail GET + all four sub-resource reads; writes
  (PUT/DELETE/POST) stay on clientCanTouchCompany. Same asymmetry one level
  up: the contact page's Company card fires GET /api/crm/companies/:id,
  which only allowed slice/extras/tenant-rep agents — general Agent rows now
  client-readable with the SAME stripped-fields path as brands. Verified:
  Mark reads Alex Agentson detail + subroutes 200, company card 200
  (stripped, no kyc/aml/hunter keys), PUT/DELETE still 403, slice contact
  still 200; Victoria unchanged (200s); rival Sam still 403 on Landsec row,
  200 on agent row (market-facing for all clients, matches list rule).
  Browser re-run of the scenario's assertions: page renders, Edit only, no
  Delete/Enrich, no false interactions empty-state, 0×403/5xx. tsc clean,
  rebuilt, smoke re-green.
- Harness growth: client-contact-detail-gates blocked-regex widened to also
  catch crm/contacts + crm/companies 403s (the read path itself), so this
  class fails crisply instead of via flow-timeout (qa/two-bot-round.mjs;
  node --check clean). Runs from round 259.
- Bugs deferred: none. Suggestions added: UX-NOTES #33 (client sees Edit on
  agent contacts but the PUT write gate 403s the save — hide/disable Edit
  outside the writable set). New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r258 was LIGHT → r259 FULL).

### r257 · 2026-08-11 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust fix per r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN ×2
  (42 checks, 0 failures; FRESH_BUILD=1 before the fixes and rebuilt bundle
  after). Two-bot round 257: exit 0, 170 scenarios ok, 3 logged issues —
  2 listed noise (rocketreach-400; commentary-regen 503), 1 flow-failure
  (client-property-detail "Files board missing") that is the r256 TIMING
  FLAKE class: screenshot shows the page still on skeletons (journey + tsc
  ran concurrently); standalone re-run renders the panel with the graceful
  no-folder fallback. Hardened the scenario to waitFor the panel (15s)
  before asserting. 0 raw 500/502/504 in the whole round's server log
  (503s all listed AI/no-key routes; 403s are two-bot's negative probes).
- Journey: Mark Warne @ 390px iPhone UA — "a colleague asked who our
  contact at Starbucks is: find the brand on my phone, get their details,
  check what's happening with them" (FIRST journey coverage of the client
  CONTACT DETAIL page, and of the brands hub → profile → contact drill
  path at client mobile): login → "/" Portfolio home → Brands tile →
  Brand Intelligence hub (category tiles, search "Starbucks" → 1 result) →
  brand profile (contacts, covenant, compliance-per-decision, signals all
  render, 0 h-overflow) → tap Tom Barista → /contacts/:id detail (email
  mailto present — task done). 0 page errors; 0 non-noise console/net
  errors after fixes.
- Bugs fixed (2):
  1. Client contact detail (r223 interactions-sync class): the page showed
     the staff-only Delete button (DELETE always 403s for clients —
     "managed by your BGP team") and auto-fired the two staff-only boards —
     /api/interactions/contact + /api/activity/contact both gateway-403 —
     with the InteractionsBoard then rendering a FALSE "No interactions in
     the last 2 years" over real staff data. Delete, AIActivityCard and
     InteractionsBoard now gated behind !cdIsClient (same pattern as the
     already-gated Enrich/SourcePanel; client/src/pages/contacts.tsx).
     Edit stays — PUT is scope-checked client parity. Verified visually
     both ways: Mark 390px (Edit only, no boards, 0×403), Victoria 1440px
     unchanged (Enrich/Edit/Delete + both boards with data).
  2. Signed-in user at the literal /login URL landed on "Page not found" —
     guest-form sign-in happens in place (no navigation), and the
     authenticated Router had no /login route; staff logging in via the
     guest form hit a 404 straight after signing in (clients were saved
     only by the ClientRouteGuard bounce). Added a /login → "/" redirect
     route (LoginRedirect, client/src/App.tsx). Verified: Victoria's UI
     login now lands on the dashboard. Both fixes: tsc clean, rebuilt,
     smoke re-green.
- Harness growth: two-bot +2 — client-contact-detail-gates (no
  Delete/Enrich/boards for client, no 403 fetches, Edit present; server
  probe: client contact DELETE on a QA-created row must 403) and
  staff-login-route-redirect (authenticated /login must land home, never
  "Page not found"). Assertions verified standalone (curl probes + UI both
  personas); run from round 258.
- Bugs deferred: none. Suggestions added: UX-NOTES #32 (mobile brand
  profile leads with a full-screen chat panel — contacts a screen+ down).
  New flakes: none new (client-property-detail joined the known fixed-wait
  class and is now hardened).
- Next journey: rotation #4 staff mobile 390px (r257 had the journey →
  r258 may be LIGHT; then #4).

### r256 · 2026-08-11 · LIGHT (r255 had the journey)
- Fresh container (pg_hba trust fix, r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN
  (42 checks, 0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 256:
  exit 0, 3 logged issues — 2 listed noise (rocketreach-400;
  commentary-regen 503 = intended no-key degradation), 1 flow-failure
  (client-add-brand-remove-ui "Remove did not flip to Add") that is a
  TIMING FLAKE, not an app bug: the failure screenshot shows the row
  already flipped + the removal toast, and a standalone re-run flipped in
  151ms with the DB extra cleared — the scenario's fixed 1500ms
  post-click wait just lost the race under round load. Hardened the
  scenario to poll via waitFor detached (10s) instead of the fixed wait
  (qa/two-bot-round.mjs; node --check clean). 0 raw 500/502/504 in the
  whole round's server log (status tally: only 2xx/3xx/expected
  400/401/403/404/503; every 503 endpoint is a listed AI/no-key route +
  os/sites noise). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: fixed-wait UI assertions can lose the
  invalidation-refetch race under round load (this class now polls).
- Next journey: rotation #3 client mobile 390px (r256 was LIGHT → r257
  FULL).

### r255 · 2026-08-11 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust fix, r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN
  (42 checks, 0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 255:
  exit 0, 171 scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503; every 503 endpoint is a listed
  AI/no-key route).
- Journey: Mark Warne desktop 1440px — "before the quarterly call: which
  vacant Bluewater units have live interest, who do I chase at the brand,
  and when is the review meeting?" (FIRST client-desktop journey coverage
  of the tracker Viewings/Offers dialogs, the CRM Contacts page, and the
  Calendar): login → /available (153 units, table + status chips) →
  Viewings dialog (clean empty state, Add Viewing) → Offers dialog →
  Add Viewing form: company combobox popover-in-dialog WORKS client-side
  (r205 fix holds; Starbucks pick fills form, date defaults today; not
  saved) → /calendar (week grid + month mini-cal render, two-bot's
  QA-CAL-MINE event correctly Landsec-scoped, intelligence footer) →
  /contacts CRM (Brand Directory slice = 9 brands, Starbucks card shows
  Tom Barista + email; Landsec Contacts tab lists the client's people).
  0 non-noise console/net errors, 0 page errors. No data mutated.
- NOT bugs (triaged): "No company / QA-VIEWING-R255-EDITED" viewing row
  mid-journey = concurrent two-bot probe (swept next round); tracker
  first paint can take ~8s cold (r237 warm-up flake class — use longer
  waits, not a bug).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: UX-NOTES #31 (client tracker: Activity/viewings/offers column
  is off-screen at 1440px and the FY Viewings/Offers chips don't filter —
  "which units have interest" is scroll-and-scan). New flakes: none.
  Harness growth: none needed (viewing/offer add+edit covered API-side;
  calendar scoping covered by client-calendar-sees-own-events).
- Next journey: rotation #3 client mobile 390px (r255 had the journey →
  r256 may be LIGHT; then #3).

### r254 · 2026-08-11 · LIGHT (r253 had the journey)
- Fresh container (pg_hba trust fix, r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN
  (42 checks, 0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 254:
  exit 0, all scenarios ok — incl. the FIRST live run of r253's
  staff-brief-target-create + client-brief-target-scope (both green; the
  r253 Brief-dialog fixes hold). 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503; every 503 endpoint is a listed
  AI/no-key route + os/sites noise). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #2 client desktop (r254 was LIGHT → r255 FULL).

### r253 · 2026-08-11 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust fix, r205; restore-as-postgres + ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN ×2
  (42 checks, 0 failures; FRESH_BUILD=1 before the fixes and rebuilt
  bundle after). Two-bot round 253: exit 0, all scenarios ok, 2 logged
  issues both listed noise (rocketreach-400; commentary-regen 503 =
  intended no-key degradation).
- Journey: Victoria desktop 1440px — "MSU3 Bluewater is vacant: brief the
  unit, set a target operator, log this morning's viewing, then check
  what the client sees" (FIRST journey coverage of the Targeting Brief
  dialog): login → /available → search MSU3 → Brief dialog → create brief
  → add target operator + comment → log viewing via Viewings dialog →
  cross-check as Mark: staff viewing visible on the unit, Brief dialog
  opens with the target row (client-instruction parity), rival-brief
  writes 403 / reads 404 (probed via API). Post-fix run: 0 non-noise
  console/net errors. All probe rows deleted after.
- Bugs fixed (2, both in the Targeting Brief dialog):
  1. The "add target operator" picker was DEAD in its only home — the
     brand dropdown is a portal'd Popover inside a Radix Dialog (the
     documented r205 dead-picker class): the list rendered but the
     dialog's focus trap + pointer-events guard swallowed every click and
     keystroke, so staff could not add a target operator from the Brief
     dialog at all. BrandSearchInput gained an `inline` mode (dialog-safe
     EntityCombobox shape, dropdown in the trigger's own subtree);
     TargetOperatorsTable passes it. Popover mode untouched — tracker /
     leasing-schedule inline pickers re-verified working via Playwright.
  2. Picking a brand never autofilled Category — the pick handler compared
     companyType ("Tenant - Restaurant") against LETTING_CATEGORIES bare
     labels ("Restaurant"), so the advertised autofill never fired; now
     strips the "Tenant - " prefix (Starbucks pick → Category Restaurant,
     verified visually). Both fixes: tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +2 — staff-brief-target-create (brief + target
  round-trip via the list route, which is the only brief read path) and
  client-brief-target-scope (own-property brief + staff target visible to
  client, client target-add on own brief 200, foreign-brief write
  403/404; negative-probe listed). Assertions verified standalone via
  curl both personas; run from round 254 — briefs titled 'QA Brief%' are
  purged by run-round.sh at round start.
- Bugs deferred: none. Suggestions added: UX-NOTES #30 (Brief dialog
  hides the Target operators section until the brief is saved, and
  "Create brief" only appears once a field is dirty — invisible two-step
  gate). New flakes: none.
- NOT bugs (triaged): client CAN add targets to a brief on their own
  property (200) — client-instruction parity, same decision family as
  tenancy row edits; rival scoping holds (403/404). GET
  /api/unit-briefs/:id 404s for everyone — the route doesn't exist, the
  list endpoint is the read path (dialog + tracker use it).
- Next journey: rotation #2 client desktop (r253 had the journey → r254
  may be LIGHT; then #2).

### r252 · 2026-08-10 · LIGHT (r251 had the journey)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners + schema grant per r249 note). Regression: run-smoke.sh
  GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1). Two-bot round
  252: exit 0, all scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503; every 503 endpoint is a listed
  AI/no-key route + os/sites noise; startup RSS fetch errors = no
  external network, same noise class as favicons). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r252 was LIGHT → r253 FULL).

### r251 · 2026-08-10 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners + schema grant per r249 note). Regression: run-smoke.sh
  GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1). Two-bot round
  251: exit 0, all scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503; every 503 endpoint is a listed
  AI/no-key route + os/sites noise).
- Journey: Victoria @ 390px iPhone UA — "a new operator requirement came
  in by phone: log it, then check the Bluewater tenancy board for a fit"
  (FIRST journey coverage of the REQUIREMENTS create flow AND the staff
  tenancy full board at 390px): login → /requirements (renders, Leasing/
  Investment tabs, KPI chips) → Create Leasing Requirement dialog
  end-to-end via manual-name path ("Requirement created" toast, row card
  lists, group + All chips increment, persisted across reload) →
  /tenancy-schedule/:bluewaterId staff board (200 units, staff Import/
  Add/Excel/Re-sync/Columns all present at 390px, KPI tiles, MSU3 search
  filters to 2 rows, wide table scrolls in its own container — 0 page
  h-overflow). 0 non-noise console/net errors, 0 page errors. Probe
  requirement deleted post-journey.
- NOT bugs (triaged): GET /api/crm/properties/Bluewater 404 mid-journey =
  tester error (route wants the property ID, not the name); repeating
  /api/client/sharepoint/root 404s = concurrent two-bot polling, listed
  noise (IGNORED_RESPONSES); tenancy "151 Available" vs "VACANT 76" =
  known fixture orphans (r217/r249).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: UX-NOTES #29 (mobile requirement cards drop the desktop Match/
  fits/Discuss actions — phone user sees "0/1 fit your available units"
  with no way to open the matches). New flakes: none. Harness growth:
  none needed (requirement create/scope covered API-side by
  agent-create-requirement/agent-edit-requirement; mobile-no-overflow
  covers the shell).
- Next journey: rotation #1 staff desktop (r251 had the journey → r252
  may be LIGHT; then #1).

### r250 · 2026-08-10 · LIGHT (r249 had the journey)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners + schema grant per r249 note). Regression: run-smoke.sh
  GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1). Two-bot round
  250: exit 0, all scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503; every 503 endpoint is a listed
  AI/no-key route + os/sites noise). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r250 was LIGHT → r251 FULL).

### r249 · 2026-08-10 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners per r242 note; ALSO needed `grant all on schema public to
  bgp` + alter schema owner — bgp role couldn't CREATE, auto-migrate
  skipped kyc/deal-audit tables until granted; new setup line below).
  Regression: run-smoke.sh GREEN (42 checks, 0 failures, fresh DB +
  FRESH_BUILD=1). Two-bot round 249: exit 0, 169 scenarios ok, 2 logged
  issues both listed noise (rocketreach-400; commentary-regen 503 =
  intended no-key degradation). 0 raw 500/502/504 in the whole round's
  server log (every 503 endpoint is a listed AI/no-key route + os/sites
  noise).
- Journey: Mark Warne @ 390px iPhone UA — "on my phone before a call with
  BGP: which Bluewater units are vacant, what rents are we asking, then
  log a follow-up task" (FIRST journey coverage of the tenancy full board
  at client-mobile 390px): login → "/" Portfolio home → Tracker tile →
  /available (153 units, status chips, unit cards clean) →
  /tenancy-schedule/Bluewater (board renders, KPI tiles, search filters
  MSU3/MSU4, wide table scrolls in its own overflow-x-auto container —
  0 page h-overflow; sticky Unit column holds while reaching the Quoting
  Rent column; Columns popover renders + grouped checkboxes work at
  390px) → bottom-nav Tasks → quick-add input ("Task created" toast, row
  lists) → task shows on dashboard MY TASKS widget. 0 non-noise
  console/net errors, 0 page errors. Probe task deleted post-journey.
- NOT bugs (triaged): per-row trash icon on the client tenancy board =
  deliberate (single-row delete is client-allowed on own properties,
  "Landsec audit" comment at tenancy-schedule.ts:464; only bulk ops are
  staff-only per r223). "151 Available" chip vs "VACANT 76" on the same
  board = the fixture's known 75 orphaned/duplicate Bluewater tracker
  rows (r217; mirror-status chips count tracker rows, VACANT counts
  tenancy rows).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: UX-NOTES #28 (mobile tenancy board needs a compact column
  preset — rent lookup = ~3,400px of swiping; companion to #17). New
  flakes: none. Harness growth: none needed (client tenancy read/write
  scoping already covered API-side; mobile-no-overflow covers "/").
- Next journey: rotation #4 staff mobile 390px (r249 had the journey →
  r250 may be LIGHT; then #4).

### r248 · 2026-08-10 · LIGHT (r247 had the journey)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners per r242 note). Regression: run-smoke.sh GREEN (42 checks,
  0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 248: exit 0,
  169 scenarios ok — incl. the FIRST live run of r247's
  client-add-brand-remove-ui (green). 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503; every 503 endpoint is a listed
  AI/no-key route + os/sites noise). The r247 remove-brand fix holds.
  0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r248 was LIGHT → r249 FULL).

### r247 · 2026-08-10 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners per r242 note). Regression: run-smoke.sh GREEN ×2 (42 checks,
  0 failures; FRESH_BUILD=1 before the fix and rebuilt bundle after).
  Two-bot round 247: exit 0, 168 scenarios ok, 2 logged issues both listed
  noise (rocketreach-400; commentary-regen 503 = intended no-key
  degradation). 0 raw 500/502/504 in the whole round's server log.
- Journey: Mark Warne desktop 1440px — "weighing a jewellery operator
  outside our hospitality slice: add the brand to my CRM, review its
  profile and contacts, then take it back out" (FIRST end-to-end UI
  coverage of the client self-add brand flow): UI login (guest-login form
  testids) → dashboard → /brands hub → Add brand dialog (search shows
  slice rows as "In CRM", global rows with Add) → add Testco Jewellers
  (toast, hub Total Brands 9→10, Brand Explorer lists it + category chip)
  → its profile renders for the client (contacts + Compliance panel per
  decision, no 403s) → removal. NOTE: hub lands on Overview tab which
  never lists individual brands — my first "added brand not visible"
  triage was a false positive (it's on the Brand Explorer tab); logged
  the discoverability gap as UX #27 instead.
- Bug fixed (1): client could ADD a brand but never REMOVE one — the
  decided model (CLAUDE.md: "add/remove via /api/client/crm/add-brand")
  has a DELETE route that no UI called, so a misclicked Add (no confirm
  step) was permanent from the user's side. Add-brand dialog rows that
  are self-added extras now show Added + a Remove button (slice rows keep
  the plain In CRM badge); remove flips the row back to Add and
  invalidates the hub/companies queries (client/src/pages/brands-hub.tsx,
  ClientAddBrandButton). Verified visually as Mark: Remove on
  Fashion/Jewellers extras only, removal toast, Explorer drops the brand,
  DB extras restored to fixture state. tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 client-add-brand-remove-ui (extra row must
  carry Remove, click flips to Add, slice rows never show Remove, API
  confirms cleared). Steps verified standalone against the dev server;
  runs from round 248.
- Bugs deferred: none. Suggestions added: UX-NOTES #27 (post-add
  dead-end — toast/dialog give no path to the added brand; Overview tab
  never lists brands). New flakes: none.
- Next journey: rotation #3 client mobile 390px (r247 had the journey →
  r248 may be LIGHT; then #3).

### r246 · 2026-08-10 · LIGHT (r245 had the journey)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners per r242 note). Regression: run-smoke.sh GREEN (42 checks,
  0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 246: exit 0,
  168 scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 = intended no-key degradation). 0 raw 500/502/504
  in the whole round's server log (status tally: only 2xx/3xx/expected
  400/401/403/404/503; every 503 endpoint is a listed AI/no-key route +
  os/sites noise). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #2 client desktop (r246 was LIGHT → r247 FULL).

### r245 · 2026-08-10 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust fix, r205 note; restore-as-postgres +
  ALTER owners per r242 note). Regression: run-smoke.sh GREEN (42 checks,
  0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 245: exit 0, all
  scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 = intended no-key degradation). 0 raw 500/502/504
  in the whole round's server log (only Error lines = ai-briefing no-key
  SDK + Azure-creds noise).
- Journey: Victoria desktop 1440px — "a new operator requirement came in:
  log it, scan the deals board, check Bluewater tenancy for a fit,
  sanity-check comps" (first journey coverage of the staff REQUIREMENTS
  add flow and staff Comps): login → /requirements (renders, staff sync
  toolbar present) → Create Leasing Requirement dialog end-to-end via the
  "+ Add as a new company" path ("Requirement created" toast, row lists,
  KPI increments) → row drill-in lands on the auto-created company brand
  profile (r237 enrich-toast fix holds: house "AI service is not
  configured" copy, not the raw SDK error) → /deals WIP report (5 rows,
  KPIs, filters) → /tenancy-schedule/Bluewater (200 units, Import/Add/
  Excel/Columns present for staff) → /comps (renders; empty fixture state).
  Cross-check: Mark (client desktop) sees 0 requirements — the staff
  requirement is correctly invisible (clients get PIPnet + own-company
  only) and staff-only sync buttons hidden. 0 non-noise console/net
  errors, 0 page errors, 0 h-overflow. Probe requirement + company
  deleted post-journey.
- NOT bugs (triaged): comps "11 AI leads awaiting review" stat with no
  path to review = deliberate parking (Leads tab is admin-only via
  /admin/comps-leads → /comps?tab=leads; comment at comps.tsx:1894) —
  logged as UX #26 instead. QA-REQ-R245 / QA-COMP R245 rows appearing
  mid-journey = the concurrent two-bot's own probes (purged by
  run-round.sh next round).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: UX-NOTES #26 (comps AI-leads stat is a dead-end for non-admin
  staff). New flakes: none. Harness growth: none needed (requirement
  create/scope already covered API-side).
- Next journey: rotation #2 client desktop (r245 had the journey → r246
  may be LIGHT; then #2).

### r244 · 2026-08-10 · LIGHT (r243 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note; restore-as-postgres +
  ALTER owners per r242 note). Regression: run-smoke.sh GREEN (42 checks,
  0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 244: exit 0, all
  scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 = intended no-key degradation). 0 raw 500/502/504 in
  the whole round's server log (status tally: only 2xx/3xx/expected
  400/401/403/404/503; every 503 endpoint is a listed AI/no-key route +
  os/sites noise). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r244 was LIGHT → r245 FULL).

### r243 · 2026-08-10 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust fix needed, r205 note; restore-as-postgres +
  ALTER owners per r242 note). Regression: run-smoke.sh GREEN (42 checks,
  0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 243: exit 0, all
  scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server log
  (status tally: only 2xx/3xx/expected 400/401/403/404/503; every 503 is a
  listed AI/no-key route + os/sites map noise).
- Journey: Victoria @ 390px iPhone UA — "back from a Bluewater viewing:
  log it, check offers, add a follow-up task, find who to chase": login →
  "/" Dashboard (billing KPIs, boards, bottom nav) → /available Letting
  Tracker (156 units, search MSU9) → log viewing via Viewing dialog
  ("Viewing added" toast, row appears, date defaults today) → Interest
  dialog (offer list + full Add Offer form clean at 390px) → /tasks
  quick-add ("Task created", row appears) → /contacts search. Cross-check:
  Mark (client, 390px) sees the staff-logged viewing on the same unit's
  dialog; client /available correctly scoped (153 units, all Landsec
  properties server-side). Staff mobile deal detail: r241
  deal-sidebar-mobile fix holds for STAFF too (Comments/Files/History
  present, 0 h-overflow). 0 console/page errors, 0 h-overflow anywhere.
- NOT bugs (triaged): client tracker header "N units" vs smaller chip
  counts = header shows teamUnits pre-toolbar-filter by design (KPI
  comment in available-units.tsx ~1038); contacts "Warne" 0 results +
  "0 BGP Clients" KPI = fixture data (no crm_contacts row for Mark,
  bgp_client=false everywhere); /deals at 390px needs ~5s for the lazy
  DealsHub chunk before judging content (timing artifact, not a blank).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none (offer-date default already noted as UX #22). New flakes: none.
- Journey QA rows (viewings 'QA-R243 Journey Viewing%', task
  'QA-PROBE task r243%') deleted post-journey.
- Next journey: rotation #1 staff desktop (r243 had the journey → r244 may
  be LIGHT; then #1).

### r242 · 2026-08-10 · LIGHT (r241 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note). Setup note: restoring
  the fixture AS bgp now fails ("must be able to SET ROLE postgres" on an
  ALTER ... OWNER) — restore as postgres into db bgp, then ALTER all
  public tables+sequences owner to bgp (else auto-migrate index creation is
  skipped as non-owner).
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, fresh DB +
  FRESH_BUILD=1). Two-bot round 242: exit 0, all scenarios ok (incl. the new
  r241 client-deal-mobile-sidebar — first live run, green), 2 logged issues
  both listed noise (rocketreach-400; commentary-regen 503 = intended no-key
  degradation). 0 raw 500/502/504 in the whole round's server log (status
  tally: only 2xx/3xx/expected 400/401/403/404/503; every 503 endpoint is a
  listed AI/no-key route). The r241 deal-sidebar-mobile fix holds. 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r242 was LIGHT → r243 FULL).

### r241 · 2026-08-10 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1 before the
  fix and rebuilt bundle after). Two-bot round 241: all scenarios ok,
  2 logged issues both listed noise (rocketreach-400; commentary-regen 503
  = intended no-key degradation). 0 raw 500/502/504 in the whole round's
  server log (status tally: only 2xx/3xx/expected 400/401/403/404/503).
- Journey: Mark Warne @ 390px iPhone UA — "how are my Bluewater lettings
  progressing, and who do I chase?": login → "/" Portfolio home (layout
  swap holds) → Deals tab (2 deals + tracker subtitle) → Gail's deal
  drill-in (h1 = deal name, r231 fix holds on MOBILE — first coverage) →
  tracker → Interest opens the Offers dialog clean at 390px → /messages
  (ChatBGP pinned). 0 console errors, 0 net issues beyond noise,
  no h-overflow anywhere.
- Bug fixed (1): deal detail below md LOST the entire right sidebar —
  Files, Linked Property, Linked Contacts, Comments, Timeline/Audit are
  all inside a `hidden md:flex` panel with no mobile fallback, so phones
  (client AND staff) couldn't read or add deal comments, see linked
  contacts, or open history at all (r217 hidden-on-mobile class; also the
  journey's "who to chase" dead-ended). Sections extracted to a shared
  sidebarPanels fragment, desktop sidebar unchanged, new md:hidden stacked
  block (testid deal-sidebar-mobile) at the bottom of the main column
  (client/src/components/deal-detail.tsx). Verified visually both ways:
  Mark 390px shows Files/Linked Property/Comments/History stacked,
  0 h-overflow; Victoria 1440px sidebar unchanged, mobile block hidden.
  tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 client-deal-mobile-sidebar (390px deal detail
  must show deal-sidebar-mobile with the Comments section). Locators
  verified manually at both widths; runs from round 242 (the 241 process
  loaded the pre-edit file).
- Bugs deferred: none. Suggestions added: UX-NOTES #25 (client deal
  detail names no BGP person to chase — agent/fee card is rightly
  staff-only, so a stalled deal has no human next step).
- New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r241 had the journey →
  r242 may be LIGHT; then #4).

### r240 · 2026-08-10 · LIGHT (r239 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1).
  Two-bot round 240: exit 0, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r240 was LIGHT → r241 FULL).

### r239 · 2026-08-10 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1).
  Two-bot round 239: exit 0, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503).
- Journey: Mark Warne desktop 1440px — "prep the quarterly review: check
  area comps, review the Bluewater tenancy schedule + edit a unit record,
  log a follow-up task": login → dashboard (KPIs, rent "—" holds) → Comps
  (FIRST client-desktop journey visit: renders with the client-facing
  empty state "Your BGP team adds comps as deals complete" — intended
  scoping, fixture comps aren't Landsec-linked) → dashboard "Letting
  Tracker >" link → /deals/letting (navigates fine) → /tenancy-schedule/
  Bluewater full board (200 units; staff Import/Re-sync hidden, r223 fix
  holds; Add/Excel/Columns present) → click-to-edit a cell: edit
  PERSISTED across reload, revert clean — first journey coverage of the
  client row-edit path → dashboard Quick-add task → shows on dashboard +
  /tasks (probe task deleted after) → Requirements as client (0 rows =
  correct scoping: clients see PIPnet imports + own-company only, none
  locally; "New Brand" button is deliberately client-allowed per the
  gateway comment). All net/console = listed noise only.
- Bugs fixed: 0 (nothing broken found — round green).
- Bugs deferred: none. Suggestions added: UX-NOTES #24 (tracker unit-name
  click starts an inline rename — accidental-edit trap, no drill-in).
- New flakes: none. Note: two-bot [ok] stdout buffering when piped loses
  early lines (known r224) — round-239.jsonl is authoritative.
- Next journey: rotation #3 client mobile 390px (r239 had the journey →
  r240 may be LIGHT; then #3).

### r238 · 2026-08-10 · LIGHT (r237 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1).
  Two-bot round 238: 167 scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503). The r237 fixes hold
  (staff-deal-mlr-scope green; enrich-toast class not re-triggered).
  0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #2 client desktop (r238 was LIGHT → r239 FULL).

### r237 · 2026-08-10 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1 before the
  fixes and rebuilt bundle after). Two-bot round 237: 164 scenarios ok,
  4 logged issues — 2 listed noise (rocketreach-400; commentary-regen 503),
  2 flow-failures (client-add-contact networkidle timeout;
  client-activity-summary board "missing") that fired while the journey +
  tsc ran concurrently on the same box — BOTH re-verified standalone
  after the round: add-contact OK, activity-summary testid PRESENT. Load
  flakes, not app bugs. 1 raw 500 in the whole round's server log = bug 1
  below (fixed).
- Journey: Victoria desktop 1440px — "prep the Landsec quarterly: Pathway
  board for Bluewater, drill into the Gail's letting deal, leave a note,
  find Landsec's key contact, glance at Covenant Watch": login → dashboard
  → /property-pathway (FIRST journey visit: empty-state renders with
  ChatBGP guidance copy — runs only start via ChatBGP, fixture has none;
  dead-end logged as UX #23) → deal detail (staff h1 = deal name, r231 fix
  holds staff-side; comments live click-to-reveal in the sidebar) →
  Landsec company profile (Key Contacts present, Chat/Enrich/AI-take
  render) → Covenant Watch (renders; screenshot caught "Viewing as
  Landsec" mid-round = the concurrent two-bot team-board scenario POSTing
  active-team on the shared Victoria user, not a bug).
- Bugs fixed (2):
  1. GET /api/aml/deal/:id/mlr-scope 500'd on EVERY staff deal-detail open —
     the "core columns" SELECT read monthly_rent/annual_rent, which don't
     exist in crm_deals (real column: rent_pa). MLR 2017 SCOPE panel showed
     no suggestion + a raw 500 each visit. Now SELECTs rent_pa and feeds it
     to assessMlrScope as annualRent (server/aml-compliance.ts). Verified
     API (200 + in_scope suggestion, was 500) and visually (panel shows
     "Suggested: in scope — Standard CDD…"; 0 5xx on page load).
  2. Brand auto-enrich surfaced the raw Anthropic SDK error to users — the
     red "AI enrichment skipped" toast printed "Could not resolve
     authentication method. Expected either apiKey or authToken…" on every
     staff brand-profile open with blank AI fields (auto-enrich fires on
     open). Reason now maps key/auth errors to the house "AI service is
     not configured" copy, other failures to "try again shortly"
     (server/brand-enrichment.ts, r214/r218 class). Verified via API.
- Harness growth: two-bot +1 staff-deal-mlr-scope (route must 200 with a
  suggestion payload, never 500 — guards the schema-drift class).
- Bugs deferred: none. Suggestions added: UX-NOTES #23 (Pathway board has
  no "start investigation" entry point of its own — ChatBGP-only).
- New flakes: a freshly (re)started dev server's FIRST browser page load
  can exceed playwright's 30s goto timeout (cold Vite transform + slow
  first DB pool checkout — killed one two-bot launch and one probe script).
  Warm it with a single browser goto before starting a harness run.
- Next journey: rotation #2 client desktop (r237 had the journey → r238
  may be LIGHT; then #2).

### r236 · 2026-08-09 · LIGHT (r235 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note; mid-round worker
  restart — postgres needed a second `service postgresql start`, no other
  impact). Regression: run-smoke.sh GREEN (42 checks, 0 failures, fresh DB
  + FRESH_BUILD=1). Two-bot round 236: all scenarios ok, 2 logged issues
  both listed noise (rocketreach-400; commentary-regen 503 = intended
  no-key degradation). 0 raw 500/502/504 in the whole round's server log
  (status tally: only 2xx/3xx/expected 400/401/403/404/503). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r236 was LIGHT → r237 FULL).

### r235 · 2026-08-09 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1).
  Two-bot round 235: all scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503).
- Journey: Victoria @ 390px iPhone UA — "back from a viewing: a tenant made
  a verbal offer on U124 Bluewater — log it, then scan news": login → "/"
  Dashboard (layout swap holds staff-side) → Deals tab → Letting Tracker →
  search U124 → Interest button → Offers dialog (renders clean at 390px) →
  company picker popover-in-dialog works (r205 fix holds on mobile) → save →
  toast + row lists (Starbucks/Pending/date/rent) → Interest (1) count
  updates → reopen → Edit offer/Delete offer aria-labels present (UX batch 2
  holds), edit prefills date+rent → News list (cards render; blank
  thumbnails + external-link taps = no-network noise). No h-overflow on any
  surface; 0 console errors; 0 net issues beyond noise. Probe offer deleted
  from dev DB after verification. First journey coverage of the OFFER flow
  on staff mobile.
- NOT a bug: U124 search shows duplicate unit cards — the fixture's known
  75 orphaned/duplicate Bluewater tracker rows (r217; leak plugged, fixture
  regeneration deliberately deferred).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Harness growth:
  none needed (offer add/edit already covered API-side by
  agent-edit-viewing-offer, r209).
- Suggestions added: UX-NOTES #22 (Add Offer date should default to today
  like Add Viewing — fiddly native date picker on phones).
- New flakes: none.
- Next journey: rotation #1 staff desktop (r235 had the journey → r236 may
  be LIGHT; then #1).

### r234 · 2026-08-09 · LIGHT (r233 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1).
  Two-bot round 234: 166 scenarios ok (incl. the new r233
  client-map-layer-scope), 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503). The r233 map fixes hold. 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r234 was LIGHT → r235 FULL).

### r233 · 2026-08-09 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1 before the
  fixes and rebuilt bundle after). Two-bot round 233: all scenarios ok,
  2 logged issues both listed noise (rocketreach-400; commentary-regen 503).
  0 raw 500/502/504 across the round.
- Journey: Mark Warne @ 390px iPhone UA — "before a call with BGP: how is
  Bluewater doing — property drill-in, tenancy, news, documents": login →
  "/" Portfolio home (layout swap holds) → tracker card → /available
  (Letting Tracker clean) → News list (article cards fine; blank thumbnails
  = no external network, noise) → SharePoint tile → Calendar → Comps →
  Property Intelligence tile → MAP: blank + 403 storm (the round's bugs) →
  /messages (ChatBGP pinned). No h-overflow anywhere.
- Bugs fixed (2, both on the client Property Intelligence map — the sidebar
  decision makes PI client-visible, but its Map tab was dead for clients):
  1. Gateway allowlist carried the dead prefix "/api/os-data" — the FILE is
     os-data.ts but the routes are /api/os/* — so every OS layer (sites,
     buildings, uprns, places) 403'd for clients despite the app-sidebar
     comment claiming OS data is client-allowed. Entry now "/api/os/"
     (external Ordnance Survey proxies only, no BGP internals;
     server/index.ts). Verified as Mark: os/sites 503 no-key = same as
     staff (was 403), ngd-status 200.
  2. The map auto-fired 7 BGP-internal staff-only endpoints as a client —
     map/pins (whole property book, unscoped — must stay staff-only),
     occupier-plan, retail-units, labels, map-annotations,
     external-properties, property-plans/in-viewport — a guaranteed 403
     storm on every client visit. All 7 now skipped for client viewers via
     a mapIsClientRef read at fetch time (edozo-map.tsx; r215/r223
     interactions-sync class). Verified visually both ways: Mark 390px map
     = 0×403 (only intended os/sites 503 no-key); Victoria desktop Map tab
     unchanged (all layers 200). tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 client-map-layer-scope (OS proxies must not
  gateway-403 for a client; pins/annotations/external-properties/plans
  must stay 403). Statuses pre-verified via curl as Mark; negative-probe
  listed.
- Bugs deferred: none. Suggestions added: UX-NOTES #20 (390px map toolbar
  overlaps the search field), #21 (client map shows no pins at all — even
  own estates; needs a scoped-pins decision).
- New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r233 had the journey →
  r234 may be LIGHT; then #4).

### r232 · 2026-08-09 · LIGHT (r231 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1).
  Two-bot round 232: all scenarios ok (incl. the new r231
  client-deal-detail-name-and-doc-gate), 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503). 0 app bugs. The r231 fixes hold.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r232 was LIGHT → r233 FULL).

### r231 · 2026-08-09 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1 before the
  fixes and rebuilt bundle after). Two-bot round 231: 164 scenarios ok,
  2 logged issues both listed noise (rocketreach-400; commentary-regen 503
  = intended no-key degradation). 0 raw 500/502/504 in the whole round's
  server log. 0 app bugs from the sweep.
- Journey: Mark Warne desktop 1440px — "prepare a board pack": login →
  dashboard → Image Studio as client (FIRST journey visit client-side:
  Library/Brand Library/Collections tabs all render, Landsec brand folder,
  upload/AI-generate entry points present) → Deals board (2 deals +
  tracker subtitle) → deal detail #1003 drill-in (Parties, Files
  "managed by BGP team" copy, comments, timeline/audit) → Create-document
  probe. All clean beyond noise + the 2 bugs below.
- Bugs fixed (2):
  1. Client saw the staff-only "Create document" button on deal detail —
     clicking navigated to /document-briefs, whose API 403s clients (the
     two-bot client-document-briefs-guard asserts exactly that) and the
     route guard bounced them home: a silent dead-end + 403 noise. Button
     now hidden via the existing isClientDeal gate
     (client/src/components/deal-detail.tsx; r223 interactions-sync class).
  2. Unit-less LEASING deal detail was headed by the PROPERTY name —
     heading, breadcrumb and sidebar all used linkedProperty?.name ||
     deal.name, so "U124 Bluewater — Gail's letting" rendered as
     "Bluewater Shopping Centre" and the two fixture Bluewater deals were
     indistinguishable everywhere (deal name appeared nowhere on the page).
     Investment deals keep property-name headings (that's their design);
     leasing deals now fall back to deal.name first, with the property as
     the existing sub-line link. Verified visually as Mark AND Victoria:
     h1/sidebar = deal name, property sub-line present, Create document
     hidden for Mark / present for Victoria. tsc clean, rebuilt, smoke
     re-green.
- Harness growth: two-bot +1 client-deal-detail-name-and-doc-gate
  (unit-less leasing deal must be headed by deal.name; client must not see
  button-deal-create-document). Assertions verified manually via the same
  locators both ways.
- Bugs deferred: none. Suggestions added: UX-NOTES #19 (Parties card shows
  Vendor/Purchaser slots on leasing deals — investment-only parties).
- New flakes: none.
- Next journey: rotation #3 client mobile 390px (r231 had the journey →
  r232 may be LIGHT; then #3).

### r224 · 2026-08-09 · LIGHT (r223 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 224: all scenarios ok (incl. the
  new r223 client-tenancy-staff-ops-guard), 2 logged issues both listed
  noise (rocketreach-400; commentary-regen 503 = intended no-key
  degradation). 0 raw 500/502s in the whole round's server log. 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Setup note: two-bot stdout buffers when piped — early [ok] lines can be
  lost if the run is backgrounded; qa/logs/round-N.jsonl is the
  authoritative issue record either way.
- Next journey: rotation #3 client mobile 390px (r224 was LIGHT → r225 FULL).

### r223 · 2026-08-09 · FULL (rotation #2 client desktop)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fix and rebuilt bundle after). Two-bot round 223:
  all scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 = intended no-key degradation). 0 raw 500s in the
  round's server log.
- Journey: Mark Warne desktop 1440px — "portfolio health: which leases are
  expiring, tenant news, my tasks, ask ChatBGP": login → dashboard (KPIs,
  rent "—" holds) → EXPIRING tile (dead end, UX-NOTES #16) → News (For You
  renders) → My Tasks (task list + degraded briefing fine) → ChatBGP
  ("Not Connected" no-key copy = intended) → Letting Tracker via Bluewater
  → Tenancy Schedule full board (r217 mobile fix N/A here; board renders,
  201 units). Bare /tenancy-schedule 404s but is unreachable in real nav
  (route is /tenancy-schedule/:propertyId only) — not a bug.
- Bug fixed (1): client tenancy full board showed staff-only "Import" and
  "Re-sync (all)" buttons — both 403 for clients at the gateway (import/
  bulk-delete/resync are deliberately staff-only; only /unit row edits are
  client-open). Buttons now hidden for client viewers via the house
  isClientViewer pattern; Add/Excel-export/Columns/row edits stay (those
  ARE client-allowed + scope-checked). r215 interactions-sync class of bug.
  Verified via Playwright both ways: Mark sees no Import/Re-sync, Victoria
  unchanged (client/src/components/PropertyTenancySchedule.tsx). tsc clean,
  rebuilt, smoke re-green.
- Harness growth: two-bot +1 client-tenancy-staff-ops-guard (bulk-delete /
  import-excel / resync-mirror as client on OWN property must all 403 —
  server side of the same rule; statuses pre-verified via curl as Mark).
- Bugs deferred: none. Suggestions added: UX-NOTES #16 (EXPIRING KPI tile
  is a dead end — no way to see which leases expire).
- Journey note: desktop dashboard scrolls in an inner container (like the
  mobile shell) — window.scrollTo doesn't move it; scroll the container.
- New flakes: none.
- Next journey: rotation #3 client mobile 390px (r223 had the journey →
  r224 may be LIGHT; then #3).

### r222 · 2026-08-09 · LIGHT (r221 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 222: 53 scenarios ok, 2 logged
  issues both listed noise (rocketreach-400 + intended bulk-assign {}
  validation 400; commentary-regen 503 = intended no-key degradation).
  0 raw 500s in the whole round's server log. 0 app bugs.
- Layout-change check (Woody 2026-08-09 mobile landing swap): no harness
  scenario assumed the chat list at "/" — the mobile-no-overflow steps
  visit "/" and only assert overflow, landing-agnostic. Nothing to update.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #2 client desktop (r222 was LIGHT → r223 FULL).

### r221 · 2026-08-09 · FULL (rotation #1 staff desktop)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 221: 162 scenarios ok, 2 logged
  issues both listed noise (rocketreach-400; commentary-regen 503 = intended
  no-key degradation). 0 app bugs from the sweep; 0 raw 500s in the whole
  round's server log.
- Journey: Victoria desktop 1440px — "prep marketing material for a
  Bluewater pitch": login → dashboard → Image Studio (first journey visit)
  → Brand Intelligence Overview → search Honi → Honi Poke profile (all
  section tabs, Portfolio Activity, Expansion, Key Contacts, Compliance) →
  Pitch property → Letting Tracker. Everything renders and works; AI panels
  degrade to the intended "AI take unavailable" copy.
- NOT bugs: staff non-admin hitting /image-studio is bounced to /m/images
  by design (StudioRoute gate, Woody 2026-08-04: full studio = admins +
  clients) — desktop experience of that gate logged as UX-NOTES #14.
  "QA Target Operator" visible on a tracker row = two-bot parity residue,
  swept at next round start by run-round.sh.
- Bugs fixed: 0 (nothing broken found). Deferred: none.
- Suggestions added: UX-NOTES #14 (Image Studio for non-admin staff on
  desktop = phone-copy /m/images page), #15 (brand profile "Pitch property"/
  "Add to deal" drop the brand context — bare navigations).
- New env noise: 401 GET /api/microsoft/calendar + /api/microsoft/files
  console echoes when M365 isn't connected — UI shows the Connect prompt;
  ignore alongside the listed M365 503s.
- Next journey: rotation #2 client desktop (r221 had the journey → r222 may
  be LIGHT; then #2).

### r220 · 2026-08-09 · LIGHT (r219 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fix and rebuilt bundle after). Two-bot round 220:
  161 scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 = the intended no-key degradation). 0 app bugs from
  the sweep itself.
- Bug fixed (1): GET /api/hr/staff and /api/hr/staff/:userId silently
  degraded to their minimal-SELECT fallback — the holiday_used/holiday_pending
  subqueries did EXTRACT(YEAR FROM start_date) but holiday_requests.start_date
  is TEXT ("function pg_catalog.extract(unknown, text) does not exist",
  4 hits in the round's server log; introduced with the year-filter in
  3b10bc2). Every profile-tier field (title/salary/APC/holiday/emergency)
  vanished from the directory + drill-in while the route still 200'd.
  Fixed with the house ::date cast (server/hr-routes.ts ×4 sites, same
  pattern as the anniversary sweep). Verified via API as Victoria: bulk
  route returns full shape + holiday_used sums a seeded probe request
  (probe reverted), drill-in same; /hr page visually green at 1440px.
  tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 staff-hr-directory-full-shape (route must
  return the full-query shape — fallback rows lack the holiday_used key,
  so the silent-fallback failure mode now fires an issue). Assertion
  verified manually via the same fetch.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r220 was LIGHT → r221 FULL).

### r219 · 2026-08-09 · FULL (rotation #4 staff mobile 390px)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fix and rebuilt bundle after). Two-bot round 219:
  55 scenarios ok, 2 logged issues both triaged as listed noise
  (rocketreach-400; commentary-regen 503 = the intended no-key degradation
  the r218 scenario asserts). 0 app bugs from the sweep; no raw 5xx.
- Journey: Victoria @ 390px iPhone UA — "back from a viewing: log an
  expense, find a landlord contact, check my tasks": login → Dashboard
  (billing KPIs, quick links, boards) → Expenses tile (/m/expenses renders,
  Add-a-receipt CTA, empty state fine) → CRM tile (/contacts: cards,
  stats, search fine at 390px) → Hammerson → Tasks page via My Tasks
  "View all" (renders, 0 open, New Task present). No h-overflow anywhere;
  only noise-list 503s. Surfaces /m/expenses, mobile CRM and mobile Tasks
  had never been journey-tested.
- Bug fixed (1): CRM "View People" on a landlord card was a dead end — it
  flipped to a pseudo-scoped view headed "<Landlord> — CRM · Agents &
  tenants relevant to this landlord" that actually rendered the GLOBAL
  agents list (AgentsTab never received the landlord) and never showed the
  landlord's own contacts, despite the card advertising "1 contact ·
  View People". Button now navigates to the company profile
  (/companies/:id) where KEY CONTACTS lives; removed the unreachable
  scoped-tabs state machinery (client/src/pages/people.tsx). Verified at
  390px: Hammerson → View People → profile with "Show all 1 contacts".
  tsc clean, rebuilt, smoke re-green.
- Harness growth: none (client-side navigation fix, no cheap API probe —
  same call as r213's nested-anchor).
- Suggestions added: UX-NOTES #13 (mobile CRM search is a dead end for
  brand names — no pointer to Brand Intelligence).
- Bugs deferred: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r219 had the journey → r220 may
  be LIGHT; then #1).

### r218 · 2026-08-09 · LIGHT (r217 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fix and rebuilt bundle after). Two-bot round 218:
  55 scenarios ALL ok, 1 logged issue = listed rocketreach-400 noise (plus
  the intended bulk-assign {} validation 400 in the server log). The r217
  reimport-no-dup + mobile fixes hold.
- Bug fixed (1): POST /api/properties/:id/bgp-commentary/regenerate 500'd
  on AI failure — bare Anthropic SDK call, so no-key locally (or an auth/
  overload blip in prod) surfaced a raw 500 instead of the house mapping.
  Found via the server-log 500 sweep during triage (one 500 mid-round).
  Now maps key/auth errors → 503, other AI failures → 502 (r214
  brand-gaps pattern; no cache fallback — regenerate is an explicit action
  and the panel keeps the old prose; server/property-asset-brief.ts).
  Verified via API: Mark on own property 503 (was 500), Victoria 503.
  tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 client-commentary-regen-graceful (route must
  return 200/503/502, never 500). Assertion verified manually as Mark.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r218 was LIGHT → r219 FULL).

### r217 · 2026-08-09 · FULL (rotation #3 client mobile 390px)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fixes and rebuilt bundle after). Two-bot round 217:
  ALL scenarios ok, 1 logged issue = listed rocketreach-400 noise.
- Journey: Mark Warne @ 390px iPhone UA — "find who to contact at a brand
  about my Bluewater lettings": UI login (Client/guest link; NOTE the generic
  button:has-text("Sign in") locator hits "Sign in with Microsoft" first —
  use role+exact name) → Portfolio tab → Brands tile → Brand Intelligence
  (slice categories + search fine at 390px) → Starbucks profile
  (MobileBrandView: contact name+role visible, covenant/compliance/signals
  clean, r215 interactions parity holds on mobile — no 403s) → Deals tab.
  Task achievable in 4 taps; all clean beyond noise.
- Bugs fixed (2):
  1. Tenancy schedule re-import DUPLICATED the Letting Tracker + leasing
     boards — import-excel with clearExisting (tenancy-schedule.ts:780) and
     bulk-delete (:1237) deleted tenancy_schedule_units wholesale but left
     mirror rows' tenancy_unit_id dangling; unit-mirror's name-link adoption
     only matches tenancy_unit_id IS NULL, so the fan-out inserted a second
     listing per unit on every re-import. (This is exactly how the fixture
     got its 75 orphaned/duplicate Bluewater tracker rows, created 2min
     apart on 2026-08-03 — the mop-up tool /api/admin/dedupe-tracker existed
     but the leak was never plugged.) Both sites now run the same unlink
     cascade the single-row DELETE route already had (null mirror +
     crm_deals tenancy_unit_id refs first). Verified via API probe: create
     tenancy row → bulk-delete → recreate same name = 1 tracker row,
     relinked, 0 dangling (was 2 rows pre-fix); probe property restored.
  2. Mobile brand profile: PortfolioActivityBlock rows hid the unit name
     below 640px (`hidden sm:inline` — desktop panel never renders that
     narrow, so it ONLY fired on phones, where MobileBrandView reuses the
     block) → two same-property suggested pitches rendered as identical
     duplicate-looking rows. Unit name now always shown (truncates).
     Verified at 390px: rows show "BWREST Portakabin Bluewater" labels.
- FLAG for Woody: if prod Bluewater's tracker shows duplicate units (the
  fixture was cut from a DB bearing this damage), staff POST
  /api/admin/dedupe-tracker?apply=1 is the existing cleanup; the leak
  itself is now plugged. Fixture keeps its 75 orphans (smoke green against
  them; regenerating the fixture left for a dedicated decision).
- Harness growth: two-bot +1 agent-reimport-no-dup (throwaway QA property:
  tenancy create → bulk-delete → recreate = exactly 1 tracker row);
  run-round.sh purge sweeps QA-REIMP leftovers. Passed in the post-fix
  revalidation sweep (160 ok, only rocketreach-400 noise; no residue).
- Suggestions added: UX-NOTES #11 (pitch reason is hover-only — invisible
  on touch), #12 (signals card shows near-duplicate headlines).
- Bugs deferred: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r217 had the journey → r218
  may be LIGHT; then #4).

### r216 · 2026-08-09 · LIGHT (r215 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 216: ALL scenarios ok, 1 logged
  issue = the listed rocketreach-400 noise (plus the intended bulk-assign
  {} validation 400 in the server log). 0 app bugs. The r215 fixes hold
  (client interactions/activity parity scenarios green, brand-gaps
  degrade to 503 not 500).
- Bugs fixed: 0. Deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r216 was LIGHT → r217 FULL).

### r215 · 2026-08-09 · FULL (rotation #2 client desktop)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fixes and rebuilt bundle after). Two-bot round 215:
  ALL scenarios ok, 1 logged issue = listed rocketreach-400 noise.
- Journey: Mark Warne desktop 1440px — "scope an operator for Bluewater":
  login → dashboard (rent "—" + occupancy label fixes hold) → Brand
  Intelligence Overview → Brand Explorer (8-brand slice + Testco Fashion
  extra correct) → Starbucks profile (Compliance & KYC panel visible per
  decision; covenant/news/contacts clean) → Add brand dialog (search
  renders). All navigation clean.
- Bugs fixed (2):
  1. Client 403s on the brand profile's BGP Relationship zone — the
     default-deny gateway only allowed /api/activity/(landlord|brand)/:id
     for the client's OWN company and had no allowance at all for
     /api/interactions/company/:id, even though both handlers + the UI
     implement Woody's 2026-08-04 parity decision (correspondence drawer +
     activity card client-visible for own company AND slice brands — the
     handler comment quotes it). Gateway now allows both shapes for
     scope-or-slice ids (server/index.ts); the interactions handler re-checks
     the same rule. Verified as Mark: Starbucks/Honi/extra 200, own company
     200, rival landlord 403, meeting viewer 403, curate POST 403; Victoria
     unchanged. NOTE: two-bot's client-interactions-guard previously
     asserted the OPPOSITE ("all /api/interactions/* refuse a client") and
     the noise list called the 403 "deliberate" — both encoded the
     pre-2026-08-04 rule and had locked the broken state in; rewritten to
     assert the decided behaviour (own+slice 200, rival/summary/leaderboard/
     meeting-viewer/sync 403). If staff-only was actually intended, revert
     4083df3.
  2. InteractionsBoard auto-fired staff-only POST /api/interactions/sync as
     a client (403 noise on every profile once the drawer became reachable)
     — auto-sync and the "Sync now" button now gated !isClientViewer,
     matching the brand-profile-panel pattern
     (client/src/components/interactions-board.tsx).
- Harness growth: client-interactions-guard extended to 10 assertions
  (own/slice interactions + activity 200; rival ×2, summary, leaderboard,
  meeting viewer, sync POST all 403). Passed in round 215.
- NOT a bug: dashboard AI Briefing "Preparing your briefing…" during 503 is
  just the loading state — it settles into a static task digest + retry.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r215 had the journey → r216
  may be LIGHT; then #3).
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

### r207 · 2026-08-08 · FULL (rotation #2 client desktop)
- Fresh container. Regression: run-smoke.sh GREEN twice (41 checks before the
  fix, 42 after — new summarise-scope check).
- Journey: Mark Warne desktop — dashboard → letting-tracker card click →
  /deals/letting?propertyId=… → filters/chips/FY strip → U124 search.
  Navigation + scoping all worked; FY Viewings strip shows 1 (r205 fix holds).
- Bug fixed (1): client auto-summarise 403 — /api/activity-summary serves
  clients deal/property-linked interactions (e.g. Gail's — U124 meeting whose
  contact has no company), but POST /api/interactions/:id/summarise only
  accepted contact-company ∈ scope → console 403 storm on every scoped feed
  + "Couldn't summarise" toast on manual click. Gate now mirrors the feed's
  portfolio rule (server/activity-summary.ts). Verified: deal-linked → 200,
  Hammerson-contact probe → still 403.
- Harness growth: smoke.mjs +1 (client summarise portfolio-linked allowed);
  two-bot +1 client-summarise-feed-scope (404-tolerant for old fixture).
- NOT bugs: client tracker Add Unit/delete icons are intended (clients may
  manage units on their own property — two-bot asserts it); U124 rows show no
  deal because the fixture's Gail's deal has unit_id NULL (fixture shape).
- New env noise: 404 GET /api/client/sharepoint/root — fixture has no linked
  folder ("ask your BGP team" path); ignore. Also /deals/letting takes ~8s to
  first paint under the DEV server (lazy chunk transform) — don't screenshot
  early and call it blank; prod build is fine.
- Deferred (harness, from r206): port two-bot off old-fixture hardcoded IDs.
- Suggestions added: UX-NOTES #4 (£0.0m passing rent tile), #5 (dashboard vs
  leasing-schedule unit/occupancy figures disagree).
- Next journey: rotation #3 client mobile 390px (r207 had the journey → r208
  may be LIGHT; then #3).

### r208 · 2026-08-08 · LIGHT (r207 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build).
- Deferred harness port DONE: two-bot resolves Landsec/Bluewater/brand by
  NAME at startup and injects them as window.QA_FIX into every browser
  context. Resolution must run NODE-side (a page.evaluate right after login
  races the app's auth-hydration navigation and silently falls back to the
  legacy IDs — cost one full false-signal run). seed-personas.sql grows:
  Honi Poke + pitch rows on both estates, Landsec team members (also added
  to bgp_contact_user_ids so the orphan sweep keeps them); fee-strip detail
  and rival-unit probes now use IDs discovered during the round.
- Two-bot round 208 (dev server + smoke fixture): 151 scenarios ok, 4 issues,
  all triaged, 0 app bugs: rocketreach 400 (listed noise); hub/hunter
  "fashion leak" was Landsec's fixture-shipped self-added extra (Testco
  Fashion in crm_extra_brand_ids) — scenario now asserts hub/hunter ⊆ the
  client's /api/crm/companies directory (the canonical slice+extras gate);
  team board empty = fixture shipped no members (now seeded); tenancy-write
  guard got 404 not 403 because the probe id never existed — now targets the
  seeded rival row (403 re-verified via API, as were the other two fixes).
- Mid-round merge: parent session pushed the Woody-confirmed UX batch; the
  round ran pre-merge server + post-merge client — no scenario touches the
  new viewing/offer PATCH routes, so results stand. Next round exercises them.
- Bugs fixed: 0 (nothing broken in the app this round). Deferred: none.
  Suggestions added: none.
- Next journey: rotation #3 client mobile 390px (r208 was LIGHT → r209 FULL).

### r214 · 2026-08-09 · LIGHT (r213 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fix and rebuilt bundle after). Two-bot round 214:
  ALL scenarios ok, 1 logged issue = the listed rocketreach-400 noise (plus
  the intended bulk-assign {} validation 400). 0 app bugs from the sweep.
- Bug fixed (1): brand-gaps AI reads 500'd instead of degrading — GET
  /api/property/:id/brand-gaps/commentary and /international called the
  Anthropic SDK bare, so an SDK throw (no key locally; overload/auth blip in
  prod) skipped both the cached-row fallback AND the house 503 mapping
  (brand-ai-take pattern) and surfaced a raw 500 — even with perfectly good
  cached commentary in the DB. Both routes now: AI failure → serve cached
  row if present, else 503 for key/auth errors, 502 otherwise
  (server/property-gap-analysis.ts). Verified via API: no-cache → 503 both
  routes (was 500), stale-cache + AI failure → 200 cached=true both routes,
  client (Mark) on Bluewater → 503 not 500. Probe writes reverted.
- Harness growth: two-bot +1 client-brand-gaps-graceful (both routes must
  return 200-cached or 503, never 500). Assertion verified manually as Mark.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r214 was LIGHT → r215 FULL).

### r213 · 2026-08-09 · FULL (rotation #1 staff desktop)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fix and rebuilt bundle after). Two-bot round 213:
  55 scenarios ok, 1 logged issue = listed rocketreach-400 noise (plus the
  intended bulk-assign {} validation 400). 0 app bugs from the sweep.
- Journey: Victoria desktop 1440px — "prep the Landsec catch-up": login →
  dashboard → Requirements → Comps → Leasing Schedule board → Bluewater
  board → Tenancy Schedule → Tasks (create chase task — created, listed,
  toast) → News. All surfaces render + work; task CRUD clean.
- Bug fixed (1): nested-<a> DOM nesting violations — wouter v3 Link already
  renders an anchor, but 6 sites still wrapped a child <a> inside it
  (tenancy-schedule-full breadcrumb, deal-detail breadcrumb ×3, tenant-rep
  quick links ×2 — invalid HTML, React validateDOMNesting warning, flaky
  click/navigation semantics). Moved className/target onto Link, dropped the
  inner <a>. Verified: warning gone, `a a` selector count 0 on tenancy
  schedule + deal detail, breadcrumb still navigates to the property page.
  tsc clean, rebuilt, smoke re-green.
- NOT a bug: Comps table shows 1 row while stats strip says 12 — the 11 AI
  news-extracted comps are unverified "leads" on the parked admin-only Leads
  tab (isLead filter). Logged as UX-NOTES #10 instead.
- Harness growth: none (nested-anchor fix has no cheap API probe; viewing/
  offer PATCH scenarios already landed r209/r212).
- Bugs deferred: none. New flakes: none. Setup note: for API probes,
  POST /api/auth/login takes {username, password} (email works as username).
- Next journey: rotation #2 client desktop (r213 had the journey → r214 may
  be LIGHT; then #2).

### r212 · 2026-08-08 · LIGHT (r211 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  before the fix and again on the rebuilt bundle). Two-bot round 212: ALL
  scenarios ok, 1 logged issue = http-400 (the listed rocketreach noise plus
  a bulk-assign 400 from the {}-body destructive probe — which exposed the
  real bug below).
- Bug fixed (1): POST /api/image-studio/bulk-assign-property had NO scope
  check despite the client-parity allowance in index.ts claiming every
  image-studio handler scope-jails — a client with a VALID payload could
  reassign ANY image (rival/staff) to ANY property, including a rival's,
  and the sync loop then wrote property_imagery_assets/entity_images rows
  onto the foreign property. Handler now jails ids via imageIdsInScope and
  gates propertyId via isPropertyInScope (mirrors bulk-tag/upload patterns,
  server/image-studio.ts). Verified via API as Mark: own img → rival prop
  403, foreign img → own prop 403, own img → own prop 200; Victoria
  (unscoped staff) unchanged 200. Probe writes reverted in dev DB.
- Harness growth: two-bot +1 client-image-assign-scope-guard (valid-payload
  probes: rival property refused, out-of-scope image id refused) — the
  destructive-guards probe only sends {} and stops at validation, which is
  why this never fired before.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Setup note: killing the dev server needs the tsx PID (kill on "npm run
  dev" leaves tsx holding :5000 → EADDRINUSE on restart); lsof -ti:5000.
- Next journey: rotation #1 staff desktop (r212 was LIGHT → r213 FULL).

### r211 · 2026-08-08 · FULL (rotation #4 staff mobile 390px)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 211: ALL scenarios ok, 1 logged
  issue = the listed rocketreach 400 noise. 0 app bugs.
- Journey: Victoria @ 390px iPhone UA — UI login (Client/guest link) →
  mobile shell (Messages | Dashboard | Mail | Deals | News) → Dashboard
  (billing KPIs, quick links, boards, AI briefing, My Tasks at bottom) →
  Deals → Letting Tracker (search U124) → Viewing dialog: ADD (date
  defaults to today — UX2 holds on mobile) → row lists with pencil/trash →
  pencil EDIT persists + EDITED stamp shows. Mail tab = Connect M365
  (expected, no keys), News renders. All clean; no 4xx/5xx beyond noise.
- Harness note: mobile-shell scrolling is an inner `overflow-y-auto` div —
  mouse.wheel at (0,0) doesn't move it; scroll via evaluate on the
  container. Tracker first paint on the dev server is slow (known) — wait
  for the search input, not a fixed pause.
- Bugs fixed: 0. Deferred: none. Suggestions added: UX-NOTES #8 (staff
  mobile also lands on empty Messages tab — extend #6), #9 (viewing row
  edit/delete icons unlabelled + tiny at 390px; company-less viewing shows
  "Unknown"). New flakes: none.
- Next journey: rotation #1 staff desktop (r211 had the journey → r212 may
  be LIGHT; then #1).

### r210 · 2026-08-08 · LIGHT (r209 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 210 (dev server + smoke fixture):
  all scenarios ok, 1 logged issue = the listed rocketreach 400 noise.
  0 app bugs. The r209 viewing/offer PATCH scenarios (agent-edit-viewing-
  offer, rival-viewing-offer-patch-guard, client-deals-property-scope) and
  the post-UX-batch server (AML revert window, tracker edit routes) all hold.
- Bugs fixed: 0. Deferred: none. Suggestions added: none. New flakes: none.
- Setup note: bgp role may get created WITHOUT superuser (CREATE DATABASE
  ... OWNER bgp can fail with "must be able to SET ROLE"); restore then spews
  ~222 "must be able to SET ROLE postgres" OWNER-TO errors — harmless, data
  restores fine and tables stay owned by bgp.
- Next journey: rotation #4 staff mobile 390px (r210 was LIGHT → r211 FULL;
  remember: mobile shell needs an iPhone/Android USER AGENT, not just
  viewport+hasTouch).

### r209 · 2026-08-08 · FULL (rotation #3 client mobile 390px)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks; before fixes
  and again on the rebuilt bundle after them). Two-bot round 209: all
  scenarios ok, 3 logged issues triaged (rocketreach 400 = listed noise; the
  fee-injection 403 was a real bug, fixed below).
- Journey: Mark Warne @ 390px iPhone UA — login → mobile shell (Messages/
  Portfolio/Deals/Tasks/News tabs) → Deals tab → Letting Tracker sub-tab →
  Portfolio/Tasks/News. Mobile shell renders cleanly; tracker chips, unit
  cards and search all fine at 390px. NOTE for future mobile rounds: the
  mobile shell only triggers on a MOBILE USER AGENT (useIsMobile requires
  isTouchDevice + narrow); Playwright viewport+hasTouch alone gets the
  desktop layout with a squeezed sidebar — set an iPhone/Android UA.
- Bugs fixed (2):
  1. Client deal scoping missed tracker-created deals (no landlord_id on the
     deal row) — Mark's Deals board showed "0 deals" while the dashboard KPI
     counted 4, deal detail 403'd, and the client deal-edit PUT 403'd (the
     fee-injection scenario had been silently skipping). Fixed in all three
     spots by the property-landlord rule the dashboard KPI already used:
     /api/crm/deals list filter (server/crm.ts), isDealInScope
     (server/company-scope.ts), and the PUT gate now calls isDealInScope
     instead of its own inline copy. Verified: list 4 deals + fees stripped,
     own tracker-deal detail 200, PUT 200 with fee injection ignored,
     rival deal read/write still 403.
  2. Client mobile home fired staff-only GET /api/expenses/pending-approval
     → 403 console noise every 60s (mobile-home.tsx approvals badge now
     gated !isClientHome, matching the commission/WIP queries beside it).
- Harness growth: two-bot +3 — agent-edit-viewing-offer (new PATCH pencils:
  edit persists, EDITED stamps flow to the client cross-checks),
  rival-viewing-offer-patch-guard (Sam PATCH/DELETE on a Landsec viewing/
  offer → 403), client-deals-property-scope (tracker deals present, rival
  absent, no fee leak). All three passed in round 209.
- NOT bugs: Deals sub-tab shows 2 while KPI says 4 — tracker-linked deals
  deliberately live on the Letting Tracker sub-tab (logged as UX-NOTES #7).
- Deferred: none. Suggestions added: UX-NOTES #6 (client mobile lands on
  empty Messages tab), #7 (Deals-vs-KPI count mismatch needs a hint).
- Next journey: rotation #4 staff mobile 390px (r209 had the journey → r210
  may be LIGHT; then #4).

### r206 · 2026-08-08 · LIGHT (r205 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN twice (41 checks, 0 failures;
  second run verified the new chromium fallback with no SMOKE_CHROMIUM set).
- Two-bot sweep (round 206, dev server + smoke fixture): 42 issues, all but
  one the known hardcoded-ID fixture mismatch (11111111/22222222/77777777/
  66666666 scenarios fail by construction) or listed env noise. ~60 scenarios
  still pass, incl. all rival-isolation and destructive guards.
- Harness bugs fixed (2):
  1. staff-deal-stage-move corrupted the fixture: it flips the Bluewater deal
     (SOL) to UO, and the intended AML counterparty gate 409s the restore
     (no KYC-approved counterparties on the fixture deal) — deal stayed stuck
     in UO for the rest of the round. Restore now uses the documented MLRO
     override for gated codes and puts amlCheckCompleted back afterwards
     (qa/two-bot-round.mjs). Verified: move+restore both 200, flag reset.
  2. Fresh containers can't launch playwright's own browser (node_modules
     expects headless_shell-1234; /opt only has chromium-1194) — smoke.mjs now
     falls back to /opt/pw-browsers/chromium when the default launch fails,
     and two-bot uses the version-stable /opt/pw-browsers/chromium symlink
     (env QA_CHROMIUM overrides) instead of a hardcoded chromium-1194 path.
- App bugs: none found (AML-gate 409 judged intended behaviour — compliance
  gate with MLRO override; logged the drag-out-can't-drag-back trap as
  UX-NOTES #3 instead).
- Deferred (harness): port two-bot-round.mjs off the old-fixture hardcoded IDs
  (resolve Landsec/property/brand/deal IDs from the DB at startup) so the
  ~40 fixture-mismatch scenarios regain signal in fresh containers.
- Suggestions added: UX-NOTES #3 (irreversible stage drag on AML-gated deals).
- Next journey: rotation #2 client desktop (then #3 client mobile 390px).

## 2026-08-08 ~20:00 UTC — UX batch (parent session, Woody-confirmed)
- Woody confirmed all 5 open UX-NOTES suggestions ("Do all 5"); built in the
  Land sec Chat parent session, not a QA round.
- Changes: viewing/offer row edit (new PATCH /api/available-units/viewings/:id
  and offers/:id + pencil edit mode in tracker dialogs); Add Viewing date
  defaults to today; AML gate now allows reverting the deal's most recent
  stage move back into a gated stage (24h window, audit-logged revert: true,
  non-reverts still 409); client dashboard rent KPI shows "—" when no rent
  data; occupancy basis labelled on dashboard ("full rent roll") and leasing
  schedule ("Units on this board" / "board units only").
- Verified: tsc clean, build clean, 41/41 smoke green pre-batch, Playwright
  UI pass on tracker dialog (add default + edit + toast), client KPI text,
  leasing labels; UX3 probed via API (out 200 / non-revert 409 AML_GATE_FAILED
  / revert 200 + audit payload).
- Note for rounds: viewing/offer edit pencils are new — worth 1-2 harness
  scenarios in two-bot-round.mjs (edit persists, client scope 403 on foreign
  unit's viewing PATCH).

## 2026-08-09 ~11:30 UTC — UX batch 2 (parent session, Woody-confirmed all 8)
- Woody confirmed UX-NOTES #6-13 ("go ahead with them all"); built in the
  parent session (commit dbade8e0), not a QA round.
- Changes: mobile landing swapped — Dashboard/Portfolio now at "/", Messages
  at /messages (bottom nav + BOTTOM_NAV_PATHS updated; supersedes 2026-08-05
  Messages-home decision); client Deals subtitle notes +N tracker-only letting
  deals; viewing/offer row controls got aria-labels/bigger targets/"No
  company"; comps strip counts visible comps + "N AI leads awaiting review";
  Suggested Pitches reasons render as sub-lines; brand Signals deduped by
  normalised headline; Contacts zero-hit search hints at Brand Intelligence.
- Verified: tsc + build clean, 12/12 Playwright checks (mobile 390px client +
  staff landings, /messages nav, aria-labels, comps strip, signal dedupe).
- Note for rounds: mobile journeys should now expect Dashboard/Portfolio at
  "/" and Messages at /messages — update any harness scenario that assumed
  the chat list at "/". Smoke tick skipped one 30-min slot (~11:00 UTC)
  while this batch built; suite was green immediately before and after.

### r230 · 2026-08-09 · LIGHT (r229 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + FRESH_BUILD=1).
  Two-bot round 230: 164 scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503). The r229 fixes hold
  (staff-search-deal-names green, calendar legend N/A to harness). 0 app
  bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #2 client desktop (r230 was LIGHT → r231 FULL).

### r229 · 2026-08-09 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust fix needed). Regression: run-smoke.sh GREEN
  ×2 (42 checks, 0 failures; fresh build before fixes and FRESH_BUILD=1
  after). Two-bot round 229: all scenarios ok, 2 logged issues both listed
  noise (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in the
  round's server log. NOTE: a first two-bot attempt against the PROD build
  on :5000 reproduced the documented secure-cookie artefact exactly (97×
  brand-theme 401 + 18 flow-failures) — setup-section warning holds, re-ran
  on the dev server per the docs; not app bugs.
- Journey: Victoria desktop 1440px — "Monday-morning desk session: dashboard,
  calendar, add a task, requirements, comps, global-search to Bluewater,
  tenancy tab": login form (Client/guest reveal) → dashboard → /calendar →
  /tasks (quick-add works) → /requirements → /comps (strip + AI-leads line
  hold) → Ctrl+K search → Bluewater property → tenancy tab. All render; only
  noise-list 4xx/5xx.
- Bug fixed 1: global search labelled every deal at a matched property with
  the PROPERTY name (crmSearchAll `propertyName || d.name`) — WIP group
  showed three identical "Bluewater Shopping Centre" rows. Now deal name +
  property as subtitle. Verified API + visually; harness grew
  staff-search-deal-names.
- Bug fixed 2: calendar Event Types legend split one type into look-alike
  rows when stored event_type case/plurality differed ("Meetings" vs
  "meeting" — seeded QA events surfaced it). teamEventType now normalises to
  canonical lowercase singular (alias map). Verified visually: single
  "Meetings 3" row.
- Bugs deferred: none. Suggestions added: UX-NOTES #18 (calendar defaults to
  Work week on weekends, so "today" isn't in the grid on Sat/Sun).
- New flakes: none. Setup notes: pkill pattern "tsx server" does NOT match
  the dev process (`tsx --env-file=.env server/index.ts`) — kill the PIDs.
- Next journey: rotation #2 client desktop (r229 had the journey → r230 may
  be LIGHT; then #2).

### r228 · 2026-08-09 · LIGHT (r227 had the journey)
- Fresh container (pg_hba trust fix needed, r205 note). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh DB + fresh build).
  Two-bot round 228: 163 scenarios ok, 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503 = intended no-key degradation).
  0 raw 500/502/504 in the whole round's server log (status tally: only
  2xx/3xx/expected 400/401/403/404/503). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r228 was LIGHT → r229 FULL).

### r227 · 2026-08-09 · FULL (rotation #4 staff mobile 390px)
- Fresh container. Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  fresh build before the fix and rebuilt bundle after). Two-bot round 227:
  163 scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 = intended no-key degradation). 0 raw 500/502s in the
  whole round's server log.
- Journey: Victoria @ 390px iPhone UA — "between viewings: check the new home
  screen, Messages/ChatBGP, look up a brand for a pitch, glance at the
  Bluewater tenancy board": login → "/" lands on Dashboard (LAYOUT SWAP
  VERIFIED staff-side: bottom nav Dashboard|Messages|Mail|Deals|News,
  Dashboard active at "/") → /messages (ChatBGP pinned + New Chat, clean) →
  ChatBGP thread (suggestion chips, composer render) → Brand Intelligence
  (category tiles + search at 390px) → Starbucks profile via search (Key
  Contacts name+role, covenant checks, Portfolio Activity unit names = r217
  fix holds, pitch reasons as sub-lines + deduped signals = UX batch 2 holds)
  → Bluewater tenancy schedule (202 rows, KPI tiles, no h-overflow). No
  h-overflow anywhere; only noise-list issues (ai-briefing 503, favicon
  reset). Journey used API-token login (harness pattern) — login form itself
  covered by smoke.
- Bug fixed (1, micro): mobile dashboard greeting said "Good afternoon"
  while ChatBGP said "Good evening" between 17:00-18:00 — mobile-home.tsx
  used hour<18 for afternoon, mobile-app.tsx + today.tsx use hour<17.
  Aligned to <17. Verified visually at 17:50: both now "Good evening".
  tsc clean, rebuilt, smoke re-green.
- Harness growth: none (client-side one-liner, no cheap API probe).
- Bugs deferred: none. Suggestions added: UX-NOTES #17 (staff mobile tenancy
  header = 8 stacked controls pushing rows ~2 screens down at 390px).
- New flakes: none. Setup notes: fresh container needed the pg_hba trust fix
  (r205); scratchpad scripts must import playwright via the repo's absolute
  node_modules path (ESM resolves from the file's location, not cwd).
- Next journey: rotation #1 staff desktop (r227 had the journey → r228 may
  be LIGHT; then #1).

### r226 · 2026-08-09 · LIGHT (r225 had the journey)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 226: all scenarios ok, 2 logged
  issues both listed noise (rocketreach-400; commentary-regen 503 = intended
  no-key degradation). 0 raw 500/502s in the whole round's server log
  (status tally: only 2xx/3xx/expected 400/401/403/404/503). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Setup note: fresh container needed the pg_hba trust fix (r205 note) —
  smoke's postgres restore fails on password auth otherwise.
- Next journey: rotation #4 staff mobile 390px (r226 was LIGHT → r227 FULL).

### r225 · 2026-08-09 · FULL (rotation #3 client mobile 390px)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Two-bot round 225: all scenarios ok, 2 logged
  issues both listed noise (rocketreach-400; commentary-regen 503 = intended
  no-key degradation). 0 raw 500/502s in the whole round's server log.
- Journey: Mark Warne @ 390px iPhone UA — "on my phone: how's my portfolio,
  dig into lettings, message BGP, check tasks": login → "/" lands on
  Portfolio dashboard (LAYOUT SWAP VERIFIED client-side: bottom nav
  Portfolio|Messages|Deals|Tasks|News, Portfolio active at "/") → /messages
  (ChatBGP pinned + New Chat, renders clean) → Tasks (list + degraded
  briefing fine) → Tracker tile → /available (search U124 filters, status
  chips, unit card actions) → Viewing dialog at 390px (renders, date
  defaults today — UX2 holds for client mobile) → Deals tab (2 deals,
  "+2 letting deals" subtitle = r209 UX7 holds) → News. No h-overflow on
  any surface; no 4xx/5xx beyond noise; task achievable in ≤3 taps each.
- NOT a bug: client dashboard tracker KPI "0 Under offer/0 Let" while deals
  sit at SOL/EXC — fixture's Gail's deal has unit_id NULL (r207 note) so the
  deal→unit marketing_status mirror (crm.ts ~3655) has nothing to sync;
  KPI correctly reflects unit statuses (all 151 Bluewater rows AVA).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none. Harness growth: none needed (mobile-no-overflow
  already landing-agnostic per r222).
- Next journey: rotation #4 staff mobile 390px (r225 had the journey →
  r226 may be LIGHT; then #4).
