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
- 401 GET /api/microsoft/* ("Not connected to Microsoft 365") — fixture
  users hold no M365 tokens; dashboard/diary/files panels degrade to their
  connect prompts (r349)
- GET /api/ai-briefing 503 bursts (4-request React Query retry backoff per
  mount) — keyless env; tasks-page briefing card falls back to a Generate
  button, not stuck (r349)
- 503 GET /api/brand/:id/ai-take/* — keyless AI-take panels on company
  profiles fire these on load; UI shows "AI take unavailable" (r269)
- ERR_CONNECTION_RESET on google.com/s2/favicons — no external network
- "[goad datum fix] failed … relation goad_units does not exist" ~30s
  after dev-server boot — fixture has no goad_units (prod-only harvested
  table, not in the auto-migrate list); rolls back + retries next boot,
  no user-facing effect (r326)

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

### r361 · 2026-08-21 · FULL (rotation #3 Landsec client mobile 390px)
- JOGQK merge: brought in Brent Cross evidence-map demo route. Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, FRESH_BUILD=1 post-merge).
  Two-bot round 362: exit 0, all 201 scenario steps ok, 3 issues all listed
  noise (rocketreach-400, live-intel 503, commentary-regen 503 —
  qa/logs/round-362.jsonl). Dev-server sweep: 0 raw 500/502/504 (lone
  " 500 " = "500 articles" news echo). tsc clean on the merged tree.
- Journey: Mark Warne @390px iPhone UA — "on the train to a Bluewater site
  visit": dashboard → PI hub (quick-pick chip seeds map, KPIs/Ownership/
  Planning render; LR tab prefilled Bluewater DA9 9ST, no Invalid Date;
  Business Rates tab) → Letting Tracker /available (search recounts
  "151 of 153", status chips wrap, unit cards actionable) → Brand
  Intelligence + Amorino profile (chat, key contacts) → ChatBGP home.
  0 new bugs, 0 h-overflow, 0 pageerrors; only known UX #81 pathway 403.
- HARNESS LEARNING: a 390px Playwright context WITHOUT an iPhone UA gets
  the DESKTOP layout (use-mobile isTouchDevice() rejects Linux desktop
  UAs) — pinned-sidebar-at-390px is an artifact, not a bug. Always set the
  iPhone UA like two-bot does.
- Wrong-turn notes (app behaved correctly): /leasing-schedule shows the
  intentional ARCHIVED banner (live tracker is /available); /chat is not a
  route (ChatBGP is /chatbgp) and the client guard bounces bad URLs home.
- Bugs fixed: none found. Bugs deferred: none. Suggestions added: UX #83
  (mobile PI map: Google zoom control half-hidden under bottom nav, Resolve
  button touches right edge — pad map container on mobile). New flakes: none.
- Next journey: r361 was FULL → r362 LIGHT; then rotation #4 staff mobile
  390px.

### r359 · 2026-08-21 · FULL (rotation #2 Landsec client desktop) — FINAL (closed by r360)
- Container reclaimed after the 13:09 UTC fix push; r360 verified everything
  below independently (probes + browser) and closed the round. r359's
  gateway fix is good as pushed, but the LR tab it opened exposed
  pre-existing unscoped GETs — fixed in r360.
- Fresh container (pg_hba trust, bgp role + restore per r249). JOGQK merge:
  brought in 5977e99 (profile-photo card on Organisation page). Regression:
  run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1 before and
  after the fixes). Two-bot round 360: exit 0, all scenarios ok, 3 issues
  all listed noise (rocketreach-400, live-intel 503, commentary-regen 503 —
  qa/logs/round-360.jsonl).
- Journey: Mark Warne @ 1440px — "Monday-morning asset-manager session:
  my property tools in the PI hub, the lettings tracker (search + log a
  phone-call interest), open a deal and email my BGP contact". UX 65-73
  client-side batch now browser-VERIFIED: #69 quick-pick bar renders,
  chip pick seeds the map + prefills Land Registry ("Bluewater Shopping
  Centre, DA9 9ST"); #72 Teams/Agents filters absent for client; #68
  header recounts ("6 of 153 units" under search); #71 Log-interest form
  works end-to-end (client logged + deleted an interest row, write allowed
  via /api/available-units); #65 deal header "BGP contact: Test Staff"
  with a live mailto. PI hidden staff tabs stay hidden.
- Bug fixed 1: client PI Map panel rendered EMPTY on every resolve —
  /api/property-lookup (public-data aggregate the panel is built from) and
  /api/address-search (map search box autocomplete) were missing from
  CLIENT_ALLOWED_API. Added both (GET, external public data only).
  Verified by token probe (403→200) and visually: panel now shows
  Titles/Rates/Planning KPIs, Ownership, Planning Designations.
- Bug fixed 2: client Land Registry tab search dead-ended in a 403 —
  POST /api/land-registry/resolve + POST /searches hit the client write
  gate even though #69 prefills the tab for clients. Added an exact-match
  client-write allowance for just those two POSTs (user-stamped search
  history); purchase-title (paid), backfill and searches PATCHes verified
  still 403. Visually: search persists to Recent Searches, resolve now
  503s keyless (staff parity) instead of 403.
- Harness growth: two-bot client-pi-lookup-open (lookup/addr/resolve not
  403 + purchase-title & searches-PATCH stay 403; in NEGATIVE_PROBE set);
  run-round.sh purge now sweeps the scenario's DA9 9ST search rows.
  tsc clean; probe rows (interest, LR searches) all cleaned.
- Bugs deferred (1): Recent Searches card shows "Invalid Date" — GET
  /api/land-registry/searches/recent returns snake_case created_at (raw
  SQL) while the card reads s.createdAt (land-registry.tsx:963); affects
  staff too. One-line fix: alias created_at AS "createdAt" in the recent
  query (server/land-registry.ts:1759).
- Suggestions added: UX #81 (client PI panel offers a staff-only "Run
  Pathway" CTA that can only dead-end + fires a 403 pathway/latest fetch
  per resolve). New flakes: none.
- Next journey: r359 was FULL → r360 may be LIGHT; then rotation #3 client
  mobile 390px.

### r357 · 2026-08-21 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust, bgp role + restore + owner transfer per
  r249). JOGQK merge: already up to date. Regression: run-smoke.sh GREEN ×2
  (42 checks, 0 failures, FRESH_BUILD=1 before and after the fix). Two-bot
  round 358: exit 0, all 200 scenario steps ok, 3 issues all listed noise
  (rocketreach-400, live-intel 503, commentary-regen 503 —
  qa/logs/round-358.jsonl). Dev-server sweep: 0 raw 500/502/504; 403s =
  guard probes; 404s = hr-photo/sharepoint-root noise.
- Journey: Victoria @ 1440px — "prep for the Landsec review meeting":
  dashboard → Bluewater property (tenancy section, data-linkage widget) →
  full /tenancy-schedule/:id (201 rows clean) → Honi Poke brand profile
  (compliance panel present) → comps → /kyc-clouseau board → Image Studio
  (albums + open album) → tasks. 0 dead routes, 0 h-overflow, 0 pageerrors,
  0 non-noise 4xx/5xx. QA-R358 probe deal/comp/unit visible = inter-round
  artefacts, purged next round as usual.
- Bug fixed 1: Wikipedia brand-image source imported photos from a
  completely unrelated article when the brand has no Wikipedia page —
  srsearch fuzzy-match turned "Honi Poke" into wrestler AJ Ferrari's bio
  and his headshot became the brand profile hero (round 358's two-bot run
  imported it live). findWikipediaImages (server/brand-images.ts) now
  rejects the article unless its normalised title overlaps the brand name.
  tsc clean, guard unit-checked (Apple→Apple Inc. / Pret→Pret a Manger
  still accept), bad row deleted, profile re-verified visually — clean
  fallback, no re-import on profile load. Harness growth: none (fix
  depends on live Wikipedia responses — not cheaply assertable).
- False alarms triaged, not bugs: property-page Tenancy Schedule section
  starts OPEN — probe clicks were collapsing it (journey scripts: don't
  click toggle-schedule expecting to expand); Image Studio "Uncategorised
  2 photos" vs sidebar count 1 is albums-vs-categories grouping; blank grey
  album tile is the QA probe photo's literal content (tiny grey jpg).
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #2 Landsec client desktop (r357 was FULL → r358
  LIGHT first; then #2).

### r356 · 2026-08-21 · LIGHT (r355 was FULL) — finished by replacement session
- Original container died after its heartbeat; replacement session re-ran the
  round from scratch 06:30-06:50 UTC. Fresh container (pg_hba trust, bgp role
  + restore + schema grant per r249). JOGQK merge: already up to date.
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, FRESH_BUILD=1).
  Two-bot round 357: exit 0, all scenarios ok (incl. r355's
  staff-deal-mobile-action-row AML-copy assert and r353's
  client-mobile-chat-error-prompt — no recurrences), 3 issues all listed
  noise (rocketreach-400, live-intel 503, commentary-regen 503 —
  qa/logs/round-357.jsonl). Dev-server sweep: 0 raw 500/502/504; 186×403 =
  spread guard probes; 404s = hr-photo/sharepoint-root noise + image-studio
  purged-probe artefact (r354) + one requirements-leasing probe fetch; the
  3×400 = rocketreach noise + deliberate bogus-verdict and bulk-assign-scope
  probes. r355's QA-R356 probe deal purged by run-round.sh as expected.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r356 was LIGHT → r357 FULL).

### r355 · 2026-08-21 · FULL (rotation #4 staff mobile 390px)
- Fresh container (pg_hba trust, bgp role + restore + schema grant per r249).
  JOGQK merge: already up to date. Regression: run-smoke.sh GREEN ×2 (42
  checks, 0 failures, FRESH_BUILD=1 before and after the fix). Two-bot round
  356: exit 0, all scenarios ok, 3 issues all listed noise (rocketreach-400,
  live-intel 503, commentary-regen 503 — qa/logs/round-356.jsonl).
  Dev-server sweep: 0 raw 500/502/504; 403s spread guard probes; 404s =
  sharepoint-root/hr-photo noise + image-studio purged-probe artefact (r354).
- Journey: Victoria @ 390px iPhone — "between viewings: work the deals
  pipeline from my phone, check mail, scan news, log a task": token login →
  mobile dashboard (bottom nav Dashboard|Messages|ChatBGP|Deals|News; billing
  card, boards grid clean) → Deals tab (chips + cards; QA-R356 probe deal
  visible = inter-round artefact, purged next round) → deal detail via View
  (U124 Gail's letting: action row, Parties, Fee Allocation, KYC panel all
  clean at 390) → Mail (/mail degraded to Connect M365 prompt = noise) →
  News → Tasks quick-add (toast + row + count) → Calendar day view →
  Messages. 0 h-overflow, 0 pageerrors, 0 non-noise 4xx/5xx.
- HARNESS NOTE: staff mobile layout swap requires touch emulation — a
  Playwright context with 390px viewport + iPhone UA but NO
  isMobile/hasTouch renders the DESKTOP sidebar at 390px (use-mobile.tsx
  checkIsMobile requires isTouchDevice). Intended app behaviour (real
  phones have touch); journey scripts must pass isMobile+hasTouch like
  two-bot's mobile contexts do.
- Bug fixed 1: deal-detail KYC banner said "Only 0 counterparty linked to
  this deal" when no counterparties were set (deal-aml-status.tsx) — now
  "No counterparties linked" at 0, "Only 1 counterparty linked" at 1.
  tsc clean, rebuilt, verified visually at 390px on the Gail deal.
- Harness growth: staff-deal-mobile-action-row now also asserts the AML
  incomplete banner never regresses to "Only 0 counterparty".
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r355 was FULL → r356 LIGHT
  first if alternation holds; then #1).

### r354 · 2026-08-21 · LIGHT (r353 was FULL)
- Fresh container (pg_hba trust, bgp role + restore + schema grant per r249).
  JOGQK merge: already up to date. Regression: run-smoke.sh GREEN (42 checks,
  0 failures, FRESH_BUILD=1). Two-bot round 355: exit 0, all scenarios ok
  (incl. r353's client-mobile-chat-error-prompt — no recurrence), 3 issues
  all listed noise (rocketreach-400, live-intel 503, commentary-regen 503 —
  qa/logs/round-355.jsonl). Dev-server sweep: 0 raw 500/502/504 (lone " 500 "
  text = "500 articles" news echo); 186×403 spread guard probes; 404s =
  sharepoint-root/hr-photo listed noise + 2 one-off image-studio thumb/full
  fetches of the harness's own purged qa-unit-photo probe image (harness
  artefact, not app).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r354 was LIGHT → r355 FULL).

### r353 · 2026-08-20 · FULL (rotation #3 client mobile 390px)
- JOGQK merge: already up to date. Regression: run-smoke.sh GREEN (42 checks,
  0 failures, FRESH_BUILD=1). Two-bot round 354: exit 0, all scenarios ok,
  3 issues all listed noise (rocketreach-400, live-intel 503, commentary-
  regen 503). Dev-server sweep: 0 raw 500/502/504, errors all keyless noise.
- Journey: Mark Warne @ 390px iPhone UA — "chase the lettings pipeline from
  my phone": real guest-form login → dashboard → ChatBGP (send a message) →
  comps (leftover QA-COMP R354 visible = inter-round probe row, purged next
  round, not a bug) → brands hub + Add-brand dialog (search/global-brands
  round-trip; Testco Fashion pre-"Added" is baked into the fixture's
  crm_extra_brand_ids, not a leak) → tasks quick-add (works, toast + row).
  0 h-overflow, 0 pageerrors, 0 dead routes. Login-screen 401 GET
  /api/auth/me pre-auth echo = same family as the brand-theme 401 noise.
- Bug fixed 1: mobile ChatBGP send that the server REJECTS outright (503
  keyless here; outages/validation 400s in prod) left the user on
  "Thinking..." with no feedback for ~6 min — onError in mobile-app.tsx ran
  its late-response recovery poll even when an HTTP error response had
  definitively arrived (React Query holds isPending through the async
  onError, so the indicator never cleared). Now skips the poll when
  err.status is set (poll kept for abort/network/mid-stream, where a late
  reply genuinely can land). Desktop chat-panel already errored promptly.
  tsc clean, prod build clean; verified visually: error bubble in ~4s.
- Harness growth: client-mobile-chat-error-prompt scenario (390px send →
  Sorry-bubble within 25s; in NEGATIVE_PROBE_SCENARIOS so its deliberate
  503 isn't logged). Verified live: two-bot round 355 exit 0, 200 steps ok
  incl. the new scenario, 3 issues all listed noise.
- Bugs deferred: none. Suggestions added: UX #80 (client sees staff-
  flavoured chat suggestion chips — "Draft HOTs for a property"). New
  flakes: none.
- Next journey: rotation #4 staff mobile 390px (r353 was FULL → r354 LIGHT
  first if alternation holds).

### r352 · 2026-08-20 · LIGHT (r351 was FULL)
- Fresh container (pg_hba trust, bgp role + restore + schema grant per r249).
  JOGQK merge: already up to date. Regression: run-smoke.sh GREEN (42 checks,
  0 failures, FRESH_BUILD=1). Two-bot round 353: exit 0, all scenarios ok
  (incl. r351's mobSeedAuth de-raced mobile scenarios — no recurrence), 3
  issues all listed noise (rocketreach-400, live-intel 503, commentary-regen
  503 — qa/logs/round-353.jsonl). Dev-server sweep: 0 raw 500/502/504;
  186×403 spread guard probes (no single-endpoint storm); 400s = scenario's
  own bogus-verdict + bad-input probes; 404s = hr-photo/sharepoint-root
  listed noise.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r352 was LIGHT → r353 FULL).

### r351 · 2026-08-20 · FULL (rotation #2 Landsec client desktop)
- Fresh container (pg_hba trust, bgp role + restore + schema grant per r249).
  JOGQK merge: already up to date. Regression: run-smoke.sh GREEN (42 checks,
  0 failures, FRESH_BUILD=1). Two-bot round 351: exit 0, 4 issues = 3 listed
  noise (rocketreach-400, live-intel 503, commentary-regen 503) + 1 NEW
  flow-failure: staff-tasks-mobile-tabs "Execution context was destroyed" —
  triaged as a HARNESS race, not an app bug: the mob.evaluate localStorage
  seed right after goto('/') races the app's auth-hydration redirect (same
  family as the known root-goto ERR_ABORTED flake). Fixed in
  qa/two-bot-round.mjs: new mobSeedAuth() helper (retries the evaluate on
  destroyed-context, waits for domcontentloaded) replacing the inline
  pattern at all 10 mobile call sites; also drops the old double-
  JSON.stringify of the user blob. Verified: full two-bot round 352 exit 0,
  all scenarios ok incl. every staff+client mobile scenario, 3 issues all
  listed noise. Dev-server sweep: 0 raw 500/502/504 (two 500s on
  GET /api/auth/microsoft were this round's own errant SSO-button clicks,
  keyless noise; lone " 500 " text = "500 articles" news echo).
- Journey: Mark Warne @ desktop 1440px — "what is BGP doing for me this
  week": guest-form login → portfolio dashboard → My Tasks (quick-add via
  inline input works, task appears; AI briefing degrades to Generate button
  = keyless noise) → Requirements (renders, "No active requirements found"
  empty row present below the fold — fixture has none in client scope) →
  Comps (client sees 1 in-scope probe comp; eye-icon View Details dialog
  opens with full property/transaction/RICS sections; name link for
  unmatched comps opens Google Maps in new tab = intended propertyLinkFor
  fallback; no staff dropdown for clients, correct) → Calendar (work-week
  grid, today's schedule rail, Add event dialog renders; intelligence strip
  scrolls) . 5 surfaces + 3 dialogs, 0 pageerrors, 0 non-noise sightings.
- Bug fixed 1: calendar intelligence strip said "1 viewings this week" /
  "1 viewings booked" / "N viewings in 30 days" at N=1 — pluralized all
  three detail strings in server/microsoft.ts (the neighbouring
  "propert(y|ies)" string already pluralized, so this was an omission).
  tsc clean; verified visually as Mark: "1 viewing this week (→ 0% vs last
  week)", "1 viewing booked", "3 viewings in 30 days".
- Bugs deferred: none. Suggestions added: UX #79 (desktop client
  Requirements empty state says generic "No active requirements found";
  the client-aware UX #38 copy only got wired into the mobile card view).
- New flakes: none (the mobile-tabs race is fixed, not listed).
- Next journey: rotation #3 client mobile 390px (r351 was FULL → r352
  LIGHT first if alternation holds).

### r350 · 2026-08-20 · LIGHT (r349 was FULL)
- Fresh container (pg_hba trust, bgp role + restore + schema grant per r249).
  JOGQK merge: already up to date (no delta since r349). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, FRESH_BUILD=1). Two-bot round
  350: exit 0, all scenarios ok (incl. staff-unit-interest-lifecycle,
  staff-deal-verdict-flow, client-no-deal-verdict-poll), 3 issues all listed
  noise (rocketreach-400, live-intel 503, commentary-regen 503 —
  qa/logs/round-350.jsonl). Dev-server sweep: 0 raw 500/502/504; 170×403 all
  low-count deliberate guard probes across ~100 distinct endpoints (no
  r344/r345-style single-endpoint storm); error traces only keyless/
  no-network noise (Anthropic auth, Azure/MSAL, RSS 403/ENOTFOUND).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #2 Landsec client desktop (r350 was LIGHT → r351
  FULL).

### r349 · 2026-08-20 · FULL (rotation #1 staff desktop)
- Fresh container (pg_hba trust, bgp role + restore + schema grant per r249).
  JOGQK merge: already up to date. Regression: run-smoke.sh GREEN (42 checks,
  0 failures, FRESH_BUILD=1). Two-bot round 349: exit 0, all scenarios ok,
  3 issues all listed noise (rocketreach-400, live-intel 503,
  commentary-regen 503 — qa/logs/round-349.jsonl). Dev-server sweep: 0 raw
  500/502/504; all 5xx are keyless 503s.
- Journey: Victoria @ 1440px — "Monday morning at my desk": dashboard →
  deals hub (WIP report) → letting tracker (full Interest lifecycle via UI:
  dialog → pick Honi Poke from combobox → Log interest → KPI ticked to 1 +
  toast + row rendered → delete, all clean) → quick-add task on /tasks
  (created + purged) → Bluewater property page → brands hub → requirements,
  companies, contacts, diary, comps, chatbgp (keyless Not Connected —
  expected), news. 12+ surfaces, 0 dead routes, 0 h-overflow, 0 error
  boundaries. (/kyc-hub 404 was my bad URL guess — the KYC hub is
  /kyc-clouseau.)
- Triage: /api/microsoft/* 401s = fixture users not M365-connected, panels
  degrade to connect prompts; 78× /api/ai-briefing 503 = React Query retry
  backoff per mount in keyless env, briefing card falls back to a Generate
  button. Both added to the noise list.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  UX #78 (Interest/Viewing/Offer company pickers have no inline-create — a
  brand-new caller forces a detour through CRM; investment tracker's picker
  already has onCreate). New flakes: none.
- Next journey: rotation #2 Landsec client desktop — r349 was FULL, so r350
  LIGHT first.

### r348 · 2026-08-20 · LIGHT (r347 was FULL)
- JOGQK merged into staging (verdict-job restart-proof 5-min tick +
  jsonb marker fix — the only delta since r347). tsc clean post-merge;
  r347's Interest-button + DM-naming fixes kept through the merge.
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, FRESH_BUILD=1
  post-merge). Two-bot round 348: exit 0, all scenarios ok (incl.
  staff-unit-interest-lifecycle from r347), 3 issues all listed noise
  (rocketreach-400, live-intel 503, commentary-regen 503 —
  qa/logs/round-348.jsonl). Dev-server log: 0 raw 500/502/504 (tally
  2xx/3xx + expected 400/401/404/503, no 403 storms); error traces only
  keyless/no-network noise (RSS 403s, Revolut config, MSAL, goad_units).
- Merge-delta review: tickVerdictJobs claim is atomic (ON CONFLICT ...
  WHERE IS DISTINCT FROM), once per hour-slot per kind, restart-safe;
  system_settings table + pkey present in fixture. Note: smoke's prod
  build runs the tick (90s catch-up) — keyless + dormant fixture, no
  effect on the suite. No issues found.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Housekeeping: r348 heartbeat commit's Co-Authored-By accidentally
  carried a model name (can't amend, no force-push); final commit uses
  the standard plain footer.
- Next journey: rotation #1 staff desktop is due (last was r347 #4 →
  cycle restarts) — r348 was LIGHT, so r349 FULL.

### r347 · 2026-08-20 · FULL (rotation #4 staff mobile 390px)
- JOGQK merged INTO staging first (WhatsApp mobile Messages, brand pack v2,
  interest signals) — round tested current production code.
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, FRESH_BUILD=1
  post-merge). Two-bot round 347: exit 0, all scenarios ok, 3 issues all
  listed noise (rocketreach-400, live-intel 503, commentary-regen 503).
- Journey: Victoria @ 390px iPhone UA — "between viewings on my phone":
  login (cold-open lands on ChatBGP — intended per Woody 2026-08-18) →
  /messages (pinned ChatBGP row + chips + empty state OK) → new chat, send,
  draft preview, thread list → Bluewater property page →
  /tenancy-schedule/:id full board (overflow 0, sticky Unit col works) →
  /available Letting Tracker cards.
- Bugs fixed (2, both verified visually at 390 + tsc + prod build green):
  1. Tracker mobile card had NO Interest action (desktop table has it; the
     card's own comment promised it — UX #71 shipped desktop-only). Added
     unit-interest-{id} button mirroring desktop; log → row → delete cycle
     verified in browser.
  2. New 1-person chat from mobile Messages was titled "Group Chat" in the
     thread list (create flow always stamped the default title, defeating
     the DM name fallback). Now a single-member chat passes no title →
     lists under the person's name (server + desktop already handle null).
     Verified: new DM lists as "Cara Milligan".
- Harness: added staff-unit-interest-lifecycle to two-bot (POST/list/counts/
  DELETE round-trip, probe verified green); run-round.sh purge now sweeps
  unit_interest QA-PROBE rows.
- Deferred: none. Suggestions: UX 77 (tenancy sticky Unit col truncates to
  ~3 chars at 390 — can't identify rows once scrolled). New flakes: none.
- Fixture note: victoria has no seeded people-threads — Messages list tests
  must create their own chat (button-mobile-empty-new-group → select user →
  create). Journey's test threads ("Group Chat" w/ Alex Todd pre-fix, Cara
  Milligan DM post-fix) persist in the shared bgp dev DB, harmless.
- Next journey: r347 was FULL → r348 LIGHT (triage + deferred only).

### r346 · 2026-08-20 · LIGHT (r345 had the journey)
- Fresh container (pg_hba trust per r205; superuser bgp role + restore +
  schema grant per r249). JOGQK merge: already up to date (staging ahead
  with r344/r345 fixes; re-fetched before merge).
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, FRESH_BUILD=1).
  Two-bot round 346: exit 0, all scenarios ok, 3 logged issues all listed
  noise (rocketreach-400; brand-gaps/live-intel 503; commentary-regen 503
  — qa/logs/round-346.jsonl). Dev-server log: 0 raw 500/502/504 (tally:
  2xx/3xx + expected 400/401/403/404/503); 403s all low-count deliberate
  guard probes (no r344/r345-style repeated-endpoint pattern); 31×
  client/sharepoint/root 404 = listed fixture noise; error-trace sweep
  only keyless/no-network noise. Staging fixes hold: unit_interest
  all-interest{,-counts} 200 as staff, deal-verdict staff-only mount +
  leasing-privacy staff-only fetch verified in tree, verdict scenario's
  deliberate 400 stayed suppressed. 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r346 was LIGHT → r347 FULL).

### r345 · 2026-08-20 · FULL (rotation #3 client mobile 390px)
- Fresh container (pg_hba trust per r205; bgp role + restore + schema grant
  per r249). JOGQK merge: already up to date (staging ahead w/ r344 fixes).
- Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures, FRESH_BUILD=1
  before and after the fix). Two-bot round 345: exit 0, all scenarios ok,
  4 logged issues all noise (rocketreach-400; verdict-scenario's own
  deliberate 400 — now suppressed, scenario added to
  NEGATIVE_PROBE_SCENARIOS; brand-gaps/live-intel + commentary-regen 503s).
- Journey: Mark Warne @ 390px iPhone UA — "prep for a Landsec asset review
  on my phone": dashboard → leasing board /leasing-schedule/:bluewater
  (ARCHIVED banner correct) → property page → tenancy-schedule full board
  (KPIs + unit table clean at 390) → /brands hub → Honi Poke profile (KYC
  visible per 2026-08-01 decision) → /contacts CRM directory → /requirements
  (clean empty state) → /deals → /news. 10 surfaces, 0 h-overflow, 0 error
  boundaries, 0 dead routes.
- Bug fixed (1): client load of /leasing-schedule/:id fired staff-only
  GET /api/leasing-schedule/property/:id/privacy → gateway 403 on every
  client visit (same family as r344's deal-verdict alarm). privacy useQuery
  in leasing-schedule.tsx now enabled only for staff. Verified: Mark fires
  no privacy request, Victoria still gets 200. tsc clean.
- NOT a bug: "Last updated by mark.warne@landsec.com" on the leasing board
  — two-bot's client write scenarios legitimately touch own-property units
  (r343: client unit writes intended); timestamp matched the two-bot run.
- Harness growth: mark's crawl now visits /leasing-schedule/:bluewater
  (response hook catches a privacy-403 relapse); staff-deal-verdict-flow
  added to NEGATIVE_PROBE_SCENARIOS (its deliberate 400s no longer logged).
- Bugs deferred: none. Suggestions added: UX-NOTES #75 (mobile brand
  profile: Chat card fills first screen, facts below fold), #76 (archived
  leasing board shows Set band / Set positioning / Enable to clients —
  render read-only).
- New flakes: none.
- (Note: r344's entry sits at the bottom of this file — appended by its
  replacement session; see line ~4413.)
- Next journey: rotation #4 staff mobile 390px (r345 had the journey →
  r346 LIGHT first if alternation holds).

### r343 · 2026-08-19 · FULL (rotation #2 client desktop)
- Fresh container (pg_hba trust per r205; superuser bgp role + restore +
  schema grant per r249). origin/JOGQK merge: "Already up to date".
- Regression: run-smoke.sh GREEN twice (42 checks, 0 failures, FRESH_BUILD=1
  — before and after the fix below). Two-bot round 343: exit 0, all
  scenarios ok, 3 issues all listed noise (rocketreach-400;
  brand-gaps/live-intel 503; commentary-regen 503 — qa/logs/round-343.jsonl).
  Dev-server sweep: 0 raw 5xx, error traces only keyless/no-network noise.
- Journey: Mark Warne @ desktop 1440px — "prep for a Bluewater leasing
  review": login form → portfolio dashboard → Letting Tracker (Bluewater
  filter, client write affordances are intended — clients may add/delete
  units on own properties) → Deals board → /available → Brand Intelligence
  hub → Honi Poke profile (KYC panel visible per 2026-08-01 decision) →
  news → ChatBGP (graceful keyless "Not Connected") → /properties →
  Bluewater property page → Schedule card + Tenancy Schedule full-board
  pop-out → CRM directory + Add-contact dialog. 16/16 surfaces, 0 error
  boundaries, 0 non-noise console/5xx.
- Bug fixed 1: Brand Intelligence hub said "9 With Turnover Data" directly
  above an empty "No turnover data yet" Turnover Leaders board — the stat
  counted brands with ANY turnover_data row (fixture has 12, all NULL
  figures) while the leaderboard requires turnover IS NOT NULL. Stat
  subquery in server/crm.ts now requires turnover IS NOT NULL too.
  Verified: hub API + /brands page as client now show 0/0 consistent;
  tsc clean; smoke green on rebuilt dist.
- Harness growth: client-brands-hub-turnover-consistent (stat > 0 with
  empty leaderboard, or vice versa, fails the round).
- Bugs deferred: none. Suggestions added: UX-NOTES #72 (hide All Teams /
  All Agents tracker filters for clients), #73 (property-page card titled
  "Schedule" vs pop-out "Tenancy Schedule" naming mismatch).
- New flakes: none. Note: dashboard "AI Briefing: Preparing your
  briefing..." spins keyless — same family as the AI 503 noise, not
  re-triaged.
- Next journey: rotation #3 client mobile 390px (r343 had the journey →
  r344 LIGHT first if alternation holds).

### r342 · 2026-08-19 · LIGHT (r341 had the journey)
- Fresh container (pg_hba trust fix per r205; superuser bgp role + restore +
  schema grant per r249). origin/JOGQK merge: "Already up to date" — no new
  production commits since r341's merge; r341 unit_interest boot-heal intact.
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, fresh fixture DB,
  FRESH_BUILD=1). Two-bot round 342: exit 0, all scenarios ok, 3 issues all
  listed noise (rocketreach-400; brand-gaps/live-intel 503; commentary-regen
  503 — qa/logs/round-342.jsonl). Dev-server log: 0 raw 500/502/504 (tally:
  2xx/3xx + expected 400/401/403/404/503); error sweep only keyless/
  no-network config noise (Azure/Revolut/RSS-403). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #2 client desktop (r342 was LIGHT → r343 FULL).

### r341 · 2026-08-19 · FULL (rotation #1 staff desktop)
- Staging merged with origin/JOGQK (dbb5c6d — Letting Tracker interest
  signal, brand cull export endpoint, news-feeds work). tsc clean.
  Fresh container (pg_hba trust per r205; superuser bgp role + restore +
  schema grant per r249).
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, fresh fixture DB,
  FRESH_BUILD=1 on merged code + fix below). Two-bot round 341: exit 0,
  195 scenarios ok, 3 issues all listed noise (rocketreach-400;
  brand-gaps/live-intel 503; commentary-regen 503 —
  qa/logs/round-341.jsonl). Dev-server log: 0 raw 5xx, only keyless 503s
  + expected 2xx/3xx/401/403/404; error-trace sweep only keyless/no-network
  config noise.
- Bug fixed 1 (parent-session 15:35 regression): GET
  /api/available-units/all-interest + /all-interest-counts 500'd with
  `relation "unit_interest" does not exist` — commit 1cb9fb30 added the
  drizzle def + reads/writes but no migration/boot heal. Added CREATE TABLE
  IF NOT EXISTS unit_interest + partial unique index on
  email_conversation_id (matches the ON CONFLICT clause in viewing-sync)
  to the boot DDL in server/index.ts, beside the unit_offers heals.
  Verified: both endpoints 200 as staff on fresh fixture boot; smoke green.
- Journey: Victoria @ desktop 1440px — "before a Landsec call: review the
  new Interest signal on a Bluewater unit, tidy a stale row, grab pitch
  material": login form → tracker /available (FY strip Interest chip +
  156 badge buttons) → seeded inbox-style interest row → dialog (company,
  date, "from inbox" badge render) → delete via X → badge refreshes 1→0
  → /news (feed, chips, curated cards clean) → Image Studio (albums,
  categories). 12/12 steps, 0 error boundaries, only noise-list 503/401.
- Harness growth: client-tracker-counts-scoped + records-scoped now also
  cover all-interest{,-counts} (500-guard + client scoping on the new
  table).
- Bugs fixed: 1 (above). Deferred: none. Suggestions added: UX-NOTES #71
  (Interest signal is inbox-sweep-only — no manual "log interest" UI or
  POST endpoint; phone-call interest can't be recorded).
- New flakes: none.
- Next journey: rotation #2 client desktop (r341 had the journey → r342
  may be LIGHT; then #2).

### r340 · 2026-08-19 · LIGHT (r339 had the journey)
- Staging merged with origin/JOGQK (new production commits: safe brand
  cull + zero-substance census, brand-news own-Google-News-source +
  apostrophized possessive fix, is_tracked_brand self-maintain — 644f083).
  tsc clean on the merge. Fresh container (pg_hba trust per r205;
  superuser bgp role + restore + schema grant per r249). Regression:
  run-smoke.sh GREEN (42 checks, 0 failures, fresh fixture DB,
  FRESH_BUILD=1 on the merged code). Two-bot round 340: exit 0, all
  scenarios ok first run, 0 flow-failures; 3 logged issues all listed
  noise (rocketreach-400; brand-gaps/live-intel 503; commentary-regen
  503 — qa/logs/round-340.jsonl). Dev-server log: 0 raw 500/502/504,
  150 keyless 503s; error-trace sweep only keyless config noise
  (Revolut/Anthropic).
- Light-round work: no deferred bugs from r336-r339. New boot heals from
  the merge verified against the fixture DB: cull census reports 7/10
  zero-substance Testco rows and correctly folds/deletes NOTHING (no
  substantive dupes, no garbage names); 3 genuinely orphaned brand news
  sources removed; tracked-brand heal a no-op (all 10 tenant rows
  already flagged). staff-map-goad-concurrent green again on the merged
  code.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r340 was LIGHT → r341 FULL).

### r339 · 2026-08-19 · FULL (rotation #4 staff mobile 390px)
- Staging merged with origin/JOGQK (new production commits: client-scoped
  activity curations, inline date editor commit-on-blur fix, IG image
  proxy, Google News purge — 8a644e6, pushed). tsc clean on the merge.
- Regression: run-smoke.sh GREEN (42 checks, 0 failures, fresh fixture
  DB, fresh build). Two-bot round 339: exit 0, all scenarios ok first
  run; 3 logged issues all listed noise (rocketreach-400;
  brand-gaps/live-intel 503; commentary-regen 503 —
  qa/logs/round-339.jsonl). Dev-server log: 0 raw 500/502/504, 150
  keyless 503s. staff-map-goad-concurrent green again.
- Journey: Victoria @ 390px iPhone UA — "between viewings: check tasks +
  calendar, find an available Bluewater unit, log a viewing, glance at
  Deals" (first staff-mobile pass over /tasks, /calendar, /available and
  the viewing dialog; r227 covered dashboard/Messages/BI/tenancy): "/"
  dashboard → /tasks (quick-add bar, degraded briefing fine) → /calendar
  (Day view default, QA-CAL events render, DaySummaryBar correctly
  skipped) → /available Letting Tracker (search + status chips at 390) →
  unit card Viewing button → dialog (date defaults today) → save →
  "Viewing added", card flips to "Viewing (1)" → /deals board. Cross-check
  via API: Mark (client) sees the staff-logged viewing in
  all-viewings (unit is Landsec's). 0 h-overflow on every surface, 0
  pageerrors, task ≤3 taps per leg. /tracker 404s but nothing links
  there (guessed URL; graceful catch-all page) — not a bug.
- Triaged, NOT bugs: 401 GET /api/microsoft/calendar/summary for staff —
  intended "not connected to M365" signal, client handles with
  on401:returnNull (noise class, same family as brand-theme 401).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Harness growth:
  none needed (agent-log-viewing already covers the staff→client viewing
  cross-check). Suggestions added: UX #70 (mobile tracker card headline
  is the property name 150× over; unit name buried in subtitle).
- New flakes: none. Next journey: rotation #1 staff desktop (r339 had
  the journey → r340 may be LIGHT; then #1).

### r338 · 2026-08-19 · LIGHT (r337 had the journey)
- Staging merged with origin/JOGQK (new production commits: Instagram
  feed/image parsing, AML retry, RSS typing). Fresh container (pg_hba trust
  per r205; superuser bgp role + restore + schema grant per r249).
  Regression: run-smoke.sh GREEN (42 checks, 0 failures, fresh fixture DB,
  reused dist). Two-bot round 338: exit 0, all scenarios ok first run, 0
  flow-failures; 3 logged issues all listed noise (rocketreach-400;
  brand-gaps/live-intel 503; commentary-regen 503 — qa/logs/round-338.jsonl).
  Dev-server log for the whole round: 0 raw 500/502/504, 145 keyless 503s;
  RSS 403/ENOTFOUND = external-network noise. goad map endpoints all
  200/304 (r336 concurrency fix holds on the merged code).
- Light-round work: no deferred bugs outstanding from r335-r337; nothing
  broken found in triage. 0 app bugs.
- Bugs fixed: 0. Deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r338 was LIGHT → r339 FULL).

### r337 · 2026-08-19 · FULL (rotation #3 client mobile 390px)
- Staging merged with origin/JOGQK (new production commits: Instagram feed
  ingest + Google News maintainer fixes, d0a1838). Fresh container (pg_hba
  trust per r205; superuser bgp role + restore + schema grant per r249).
  Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures; reused dist,
  then FRESH_BUILD=1 on the merged code). Two-bot round 337: exit 0, all
  scenarios ok first run; 3 logged issues all listed noise (rocketreach-400;
  brand-gaps/live-intel 503; commentary-regen 503 — qa/logs/round-337.jsonl).
  Dev-server log: 149 keyless 503s, 0 raw 500/502/504 (lone " 500 " grep hit
  is the "500 articles" news-feed line). r336's staff-map-goad-concurrent
  ran green again.
- Journey: Mark Warne @ 390px iPhone UA — "a colleague says a brand is
  expanding: look it up, check who to talk to, then add a brand outside my
  category slice to my CRM" (FIRST visual coverage of the client add-brand
  DIALOG end-to-end at mobile width; API paths were already two-bot-covered):
  token login → "/" Portfolio (bottom nav + Brands tile render, 0 h-overflow)
  → /brands hub at 390px (category tiles + counts, search "Starbucks" → 1
  result) → Starbucks profile (Key Contacts/Covenant/Compliance/Portfolio
  Activity all render; staff-only KYC/enrich/discover buttons hidden for the
  client) → Add brand dialog → search "Jewel" → Testco Jewellers (out of
  slice) → Add → row flips to Remove, hub recounts All Brands 9→10 and a new
  "Luxury" category tile appears, search finds it, its profile opens for the
  client → removed via API (200, added:false confirmed). Task completable in
  ~3 taps per leg; 0 page errors, 0 non-noise sightings, 0 h-overflow on any
  surface.
- Triaged, NOT bugs: "Gail"/"Zara" hub + directory searches return empty —
  neither brand exists in the fixture's crm_companies (17 rows); API verified
  healthy with fixture names. Honi Poke's brand image is a wrestler photo —
  fixture data, not app code.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  client-add-brand-from-directory/remove-ui + client-mobile-brands-hub
  already cover the API paths; this round's coverage was visual. Bugs
  deferred: none. Suggestions added: none new (mobile brand-profile
  chat-first layout already filed, r259-class note). New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r337 had the journey → r338
  may be LIGHT; then #4).

### r336 · 2026-08-19 · LIGHT (r335 had the journey)
- Staging merged with origin/JOGQK (4 new production commits — AML
  screening/enrich/IG diag, a99b777). Fresh container (pg_hba trust per
  r205; superuser bgp role + restore + schema grant per r249).
  Regression: run-smoke.sh GREEN ×2 first pass (42 checks, 0 failures;
  fresh build before the fix, rebuilt bundle after). Two-bot round 336:
  exit 0, all scenarios ok first run, 0 flow-failures; 3 logged issues
  all listed noise (rocketreach-400; brand-gaps/live-intel 503;
  commentary-regen 503 — qa/logs/round-336.jsonl). Dev-server log: 0 raw
  HTTP 5xx (one " 500 " grep hit is "500 articles" in a News Feed line,
  not a status), 150 keyless 503s; smoke logs 0 raw 5xx, RSS 403s =
  external-network noise.
- Bug fixed (1, the r335 deferral): GET /api/map/retail-units 500 —
  duplicate pg_type race when two map-layer requests hit ensureGoadTables
  concurrently on a fresh DB. Fix: concurrent callers now share one
  in-flight promise (ensuring, reset in finally so a failed attempt can
  retry) in server/goad-units.ts. Verified pre-fix-class repro post-fix:
  fresh DB with no goad_units, 6 concurrent retail-units + occupier-plan
  requests as Victoria → all 200, table created once, 0 duplicate-key
  errors in the log. tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 staff-map-goad-concurrent (4 parallel
  retail-units/occupier-plan hits, all must be 200 — fixture ships no
  goad_units so the first pair exercises the race each round). Ran live
  this round and passed; r335's client-pi-investigator-hidden also had
  its first live run — passed.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (this round was LIGHT →
  r337 is FULL).

### r335 · 2026-08-19 · FULL (rotation #2 client desktop)
- Staging merged with origin/JOGQK (already up to date — no new production
  commits since r334). Fresh container (pg_hba trust per r205; superuser
  bgp role + restore + schema grant per r249). Regression: run-smoke.sh
  GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1 before the fixes and
  again on the rebuilt bundle after). Two-bot round 335: exit 0, all
  scenarios ok first run; 3 logged issues all listed noise
  (rocketreach-400; brand-gaps/live-intel 503; commentary-regen 503 —
  qa/logs/round-335.jsonl). Dev-server log: 180 5xx all keyless-AI 503s
  plus ONE raw 500 → deferred bug below; smoke prod logs 0 raw 5xx.
- Journey: Mark Warne desktop 1440px — "due diligence on my Bluewater
  asset: title, rates, map" via /property-intelligence (FIRST coverage
  ever of the PI hub — no round had touched Map/Investigator/Land
  Registry/Business Rates or the client tab-gating): UI login via guest
  form → PI hub → Land Registry renders search + "No searches yet";
  Business Rates renders clean empty state (fixture ships no VOA rows);
  Map renders layer rail + annotate tools (blank tiles = no external
  network, noise; /api/os/sites 503 = keyless OS noise); staff
  cross-check: Victoria sees Pathway/Imagery/Investigator and KYC
  Clouseau loads. 0 h-overflow; 0 non-noise sightings beyond the bugs.
- Bugs fixed (2):
  1. Investigator tab was client-visible but EVERY /api/kyc-clouseau
     route is gateway-blocked for clients (search/investigate/recent/
     expiring all 403 via API probe as Mark) — a dead-end tool (search
     box that can never return) + doomed 403s on load (r307 class).
     Fix: investigator joined pathway/imagery in the client-hidden tab
     set (client/src/pages/property-intelligence.tsx), both redirect
     effects cover it, and its TabsContent no longer mounts for clients.
     Verified pre/post in-browser: tab absent, ?tab=investigator deep
     link lands on Map with 0 kyc-clouseau requests fired; Victoria
     still gets the tab and the tool loads.
  2. Leaflet pageerror "Cannot read _leaflet_pos" on PI tab switches
     (deterministic repro: churn map ↔ other tabs) — edozo-map's moveend
     debounce (300ms setTimeout → loadBuildings → map.getBounds()) and
     in-flight loads survive unmount and fire on the removed map. Fix:
     disposed flag + clearTimeout(debounceTimerRef) in the map effect
     cleanup (client/src/pages/edozo-map.tsx). Verified: same churn now
     0 pageerrors, both personas. tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 client-pi-investigator-hidden (deep link
  must land on Map, tab absent, kyc-clouseau read 403; added to the
  negative-probe set). node --check clean; round 335 ran the pre-edit
  file, first live run r336.
- Bug deferred (1): GET /api/map/retail-units 500'd once — "duplicate
  key value violates unique constraint pg_type_typname_nsp_index".
  ensureGoadTables (server/goad-units.ts:309) has an `ensured` flag but
  no in-flight dedup, so two concurrent map-layer requests on a fresh DB
  (occupier-plan + retail-units fire together) both run CREATE TABLE IF
  NOT EXISTS goad_units and one 500s (not concurrency-safe in pg).
  Self-heals on retry; fix = share one in-flight promise. Left for r336
  (2-bug cap).
- Suggestions added: UX #69 (client PI hub starts empty everywhere —
  seed Map/LR/Rates search with the client's own scoped properties).
- New flakes: none. Tester note: repeated guest-form UI logins tripped
  the login form this round (rate-limiter class) — use token login
  (harness pattern) for re-verification legs.
- Next journey: rotation #3 client mobile 390px (r335 had the journey →
  r336 may be LIGHT; then #3).

### r334 · 2026-08-19 · LIGHT (r333 had the journey)
- Staging merged with origin/JOGQK (already up to date — no new production
  commits since r333). Fresh container (repo pre-cloned; pg_hba trust per
  r205; SUPERUSER bgp role + restore + schema grant per r249). Regression:
  run-smoke.sh GREEN first pass (42 checks, 0 failures, FRESH_BUILD=1,
  fresh DB). Two-bot round 334: exit 0, all scenarios ok first run. 3
  logged issues all listed noise (rocketreach-400; brand-gaps/live-intel
  503; commentary-regen 503 — qa/logs/round-334.jsonl). Dev-server log:
  146 5xx all keyless-AI 503s, 0 raw 500/502/504; smoke prod log: 0 raw
  5xx, 403s are the suite's own scope-denial checks, sharepoint 404s =
  no-M365 noise. Stack-trace sweep of both logs: only keyless Azure/
  Anthropic noise, all degrade gracefully (202/503).
- Light-round work: no deferred bugs from r331-333, no new UX batches to
  verify (JOGQK unchanged since r333's merge). tsc --noEmit clean.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r334 was LIGHT → r335 FULL).

### r333 · 2026-08-19 · FULL (rotation #1 staff desktop)
- Staging merged with origin/JOGQK (already up to date — no new production
  commits since r332). Fresh container (repo pre-cloned; pg_hba trust per
  r205; SUPERUSER bgp role + restore + schema grant per r249). Regression:
  run-smoke.sh GREEN first pass (42 checks, 0 failures, FRESH_BUILD=1,
  fresh DB). Two-bot round 333: exit 0, all scenarios ok first run. 3
  logged issues all listed noise (rocketreach-400; brand-gaps/live-intel
  503; commentary-regen 503 — qa/logs/round-333.jsonl). Dev-server log:
  154 5xx all keyless-AI 503s, 0 raw 500/502/504.
- Journey: Victoria desktop 1440px — "Landsec want movement on a vacant
  Bluewater unit: add a target operator on the Letting Tracker, progress
  it, open the brief, and confirm the client sees it" (FIRST staff-desktop
  visual coverage of the tracker's inline add-target BrandSearchInput
  popover, TargetRowCells status select, and the UnitBriefDialog — the
  brief/target API paths were already two-bot-covered): UI login via
  guest form → /available (156 units, chips, 0 h-overflow) → search
  "Bluewater" → L112 empty-state "+ Target operator" popover → type →
  pick Starbucks → POST targets 200, row renders with Identified badge →
  status select → Approached (PATCH 200, chip recolours) → survives
  reload → Brief button → Targeting Brief dialog renders (title/client
  prefilled "Operator Targeting — L112 / Landsec", 1/5 Targets KPI,
  target listed) → AS MARK desktop: his scoped tracker shows the same
  unit with Starbucks + Approached (targeting progress flows to the
  client, per the tracker parity decisions). Task completable in ~4
  clicks + a search; 0 page errors, 0 non-noise sightings both legs.
  Probe target + brief swept by exact id (safe while two-bot ran — no
  pattern sweeps per the r331 trap).
- Tester notes: the guest login form is behind
  button-show-guest-login — click it before input-guest-email.
  BrandSearchInput's testid is on a popover BUTTON, not an input — click,
  then fill the [cmdk-input] inside.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  brief-target create/PATCH + client-brief-target-scope already covered;
  this round's coverage was visual. Bugs deferred: none. Suggestions
  added: UX #68 (tracker page-header unit count ignores the active
  search while the chips + table recount — UX #63 class). New flakes:
  none.
- Next journey: rotation #2 client desktop (r333 had the journey → r334
  may be LIGHT; then #2).

### r332 · 2026-08-18 · LIGHT (r331 had the journey)
- Staging merged with origin/JOGQK (already up to date — no new production
  commits since r331). Fresh container (repo pre-cloned; pg_hba trust per
  r205; SUPERUSER bgp role + restore + schema grant per r249). Regression:
  run-smoke.sh GREEN first pass (42 checks, 0 failures, FRESH_BUILD=1,
  fresh DB). Two-bot round 332: exit 0, 193 ok first run. 3 logged issues
  all listed noise (rocketreach-400; brand-gaps/live-intel 503;
  commentary-regen 503 — qa/logs/round-332.jsonl). Dev-server log: 140
  5xx all keyless-AI 503s, 0 raw 500/502/504.
- Light-round work: no deferred bugs from r331; no new UX-batch builds to
  verify (JOGQK unchanged). Harness hygiene: fixed the stale two-bot
  comment claiming clients are redirected off /available (r331 triage
  note — the page has a scoped isClientTracker branch; comment-only,
  node --check clean, ran green this round).
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r332 was LIGHT → r333 FULL).

### r331 · 2026-08-18 · FULL (rotation #4 staff mobile 390px)
- Staging merged with origin/JOGQK (already up to date at checkout). Fresh
  container (repo pre-cloned; pg_hba trust per r205; SUPERUSER bgp role +
  restore + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, FRESH_BUILD=1, fresh DB). Two-bot round
  331: exit 0, 193 ok — incl. the FIRST live run of r330's extended
  agent-edit-requirement today-default assert (green). 3 logged issues
  all listed noise (rocketreach-400; brand-gaps/live-intel 503;
  commentary-regen 503). Dev-server log: 85 5xx all keyless-AI 503s, 0
  raw 500/502/504; lone " 500 " hit is the "500 articles" news-feed text.
- Journey: Victoria @390px iPhone UA — "on the train back from Bluewater:
  log this morning's viewing on the unit tracker from my phone, then make
  sure the client can see it" (FIRST staff-mobile coverage of the
  /available Letting Tracker mobile card layout + the viewings-dialog
  WRITE; r323 covered deals/tasks, r315 brands/contacts): UI login →
  lands on /chatbgp (deliberate — JOGQK bf9e6e5 "Mobile opens on
  ChatBGP", bottom nav renders, NOT a bug) → /available mobile cards
  (156 units, status chips with counts, search; 0 h-overflow) → search
  "Bluewater" 156→151 cards (matches SQL: exactly 151 Bluewater units) →
  card Viewing button → dialog fits 390px (374px wide), date pre-filled
  today → save → POST 200, "Viewing added" toast, card button recounts
  "Viewing (1)", survives reload → AS MARK mobile: /available renders
  the client-scoped tracker (153 = 151 Bluewater + 2 Westgate; the 3
  out-of-scope Broadgate-rival/Brent-Cross units hidden — verified vs
  SQL; fees stripped, client subtitle) and his viewing dialog + scoped
  API GET both show Victoria's viewing. Task completable; 0 page errors,
  0 non-noise sightings all legs.
- Triaged, NOT bugs: two-bot's stale comment says clients are REDIRECTED
  off /available — the page now has a full isClientTracker branch and
  server-side scope (routes.ts /api/available-units landlord_id +
  crm_company_properties filter, verified exact); decided client
  write-parity incl. Add Unit. Scope already harness-locked
  (client-available-unit-read-scoped + rival guards) — no growth needed.
- TESTER TRAP (r285 residue-collision class, nearly self-inflicted):
  journey probes stamped QA-VIEWING-R331 COLLIDE with two-bot round 331's
  own stamps — my mid-run sweep `LIKE 'QA-VIEWING-R331%'` deleted
  two-bot's cross-persona viewing row (already PATCHed to -EDITED) while
  client-sees-agent-viewing / rival-viewing-offer-patch-guard still
  needed it. Restored both ids by SQL insert before those scenarios ran —
  all passed. Rule: never sweep QA-<type>-R<round> patterns while two-bot
  round <round> is running; use a distinct probe stamp or sweep after
  exit 0.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  viewing POST/PATCH/DELETE + client round-trip + scope already covered
  (agent-log-viewing, client-sees-agent-viewing, rival guards); this
  round's mobile coverage was visual. Bugs deferred: none. Suggestions
  added: UX #67 (company-less viewing card headlines the attendees AND
  repeats them on the Attendees: line — duplicate text both personas).
  New flakes: none.
- Next journey: rotation #1 staff desktop (r331 had the journey → r332
  may be LIGHT; then #1).

### r330 · 2026-08-18 · LIGHT (r329 had the journey)
- Staging merged with origin/JOGQK (already up to date at checkout). Fresh
  container (repo pre-cloned; pg_hba trust per r205; SUPERUSER bgp role +
  restore + schema grant per r249). Regression: run-smoke.sh GREEN first
  pass (42 checks, 0 failures, FRESH_BUILD=1, fresh DB). Two-bot round
  330: exit 0, 193 ok first run — incl. the FIRST live run of r329's
  staff-deals-all-chip-recounts (green). 3 logged issues all listed noise
  (rocketreach-400; brand-gaps/live-intel 503; commentary-regen 503 —
  qa/logs/round-330.jsonl). Dev-server log: 150 5xx all keyless-AI 503s;
  lone " 500 " hit is the "500 articles" news-feed text.
- Light-round focus: browser-verified the UX 50-64 batch legs r329 didn't
  cover — ALL GREEN (18 Playwright checks, 3 legs, 0 page errors):
  #50 staff desktop sees the off-spine chip on Gail's deal with the
  auto-link tooltip AND Mark's client view of the same deal hides it
  (0 chips); relinkOffSpineDeals wired at server/index.ts:4523. #51 staff
  mobile 390px deal cards show Target (Dec 2026) + "In status: today"
  time-in-status, 0 h-overflow. #52 via API: POST requirement without
  date → requirementDate = today (probe swept). #53 planted dead+live
  recents → dead company page shows "Company not found", dead entry
  dropped from bgp_recent_items, live Starbucks kept. #56 staff /calendar
  Add-event button + dialog → POST /api/team-events 200, created_by
  stamped (DB-verified; probe swept). #57 New Deal (simplified body) →
  "Deal created" toast with "View deal →" navigating to /deals/:id
  (probe deal swept). #58 attendees-only viewing headlines the attendees
  on the tracker dialog, no "No company". #61 Image Studio Library tab
  count matches the grid (2=2; grid excludes Brands at line 754). The
  whole confirmed 50-64 batch is now browser-verified (54/55/59/62/63/64
  in r329).
- Tester notes: /deals is now the DealsHub tab wrapper — button-create-deal
  lives on /deals/list. The simplified New Deal body's Target month picker
  is #deal-target-date (type=month, NO testid; input-deal-target-date only
  exists on the full/Consultant forms). No dealType selected = no
  unit/party validation, so name + target month creates a bare deal.
- Bugs fixed: 0 (nothing broken found; the one FAIL mid-run was my own
  selector against the full-form testid). Harness growth: two-bot
  agent-edit-requirement now also asserts the UX #52 today-default on
  create (node --check clean; round 330 ran the pre-edit file, first live
  run r331). Bugs deferred: none. Suggestions added: none. New flakes:
  none.
- Next journey: rotation #4 staff mobile 390px (r330 was LIGHT → r331
  FULL).

### r329 · 2026-08-18 · FULL (rotation #3 client mobile 390px)
- Staging merged with origin/JOGQK head d6e83a3 first (standing branch rule;
  brings activity-curation, AML-screening-on-open, Instagram direct-wire
  commits onto staging). Fresh container (repo pre-cloned; pg_hba trust per
  r205 — careful: a naive sed mangles scram-sha-256 into trust-sha-256,
  replace the whole method token; SUPERUSER bgp role + restore + schema
  grant per r249). Regression: run-smoke.sh GREEN ×2 (42 checks, 0
  failures; FRESH_BUILD=1 before the fix, rebuilt bundle after). Two-bot
  round 329: exit 0, all scenarios ok first run; 3 logged issues all
  listed noise (rocketreach-400; brand-gaps/live-intel 503;
  commentary-regen 503 — qa/logs/round-329.jsonl). Dev-server log: 177
  5xx all keyless-AI 503s; lone " 500 " hit is the "500 articles"
  news-feed text.
- Journey: Mark Warne @ 390px iPhone UA — "which Bluewater leases expire
  soonest, and save a news story for the board pack" — aimed at the
  browser-unverified UX 50-64 batch. VERIFIED GREEN in-browser: #59 ("Your
  BGP team" row on Portfolio home, 2 mailto links — closes the r313 UX#59
  dead-end), #55 (0 duplicate "← Properties" back-link rows on the mobile
  property page), #64 (WAULT tile reads 4.6 yrs with amber "3 excluded —
  placeholder expiry" sub-line), #62 (Expiry header tap-sorts ▲→▼, soonest
  dates first — 23 Jun 2026 ×2, 06 Sept 2026 … — empties sink; the r321
  "expires soonest unanswerable on a phone" task now completable), #54
  verified as VICTORIA staff mobile (client /news is the Brand News
  signals page per UX #35, no Latest/Saved there by design): save →
  engage 200 → card on Saved tab → unsave 200. 0 page errors, 0 non-noise
  sightings all legs.
- Bug fixed (1): UX #63 was half-built — the deals-board status chips
  recount against the active search but the "All" chip (mobile) and "All
  Deals" card (desktop) still rendered the unfiltered
  teamFilteredDeals count + fee total, so the numbers disagreed the
  moment a search was typed (client mobile screenshot: "All 2" over "No
  deals found"). Fix: new searchedDeals memo feeds both "All" surfaces
  (client/src/pages/deals.tsx). Verified in-browser pre/post: zero-match
  search now reads All 0 (was All 2). tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 — staff-deals-all-chip-recounts (mobile
  /deals/list, zero-match search must recount the All chip to 0). node
  --check clean; round 329 ran the pre-edit file, first live run r330.
- Tester notes: Playwright taps on the tenancy board headers keep landing
  under the STICKY columns — locator.tap auto-scrolls minimally so the
  target parks beneath the sticky Unit th (225px) or the sticky right th
  (~90px); tap via touchscreen.tap at a point centred INSIDE the visible
  strip between the two sticky edges (see probe-62f pattern). Band-row
  colspan ths offset document-wide th indexes — compute column index
  within the header row itself. Client /deals/list chip textContent is
  "All2" (no space — \b regexes miss it).
- Bugs deferred: none. Suggestions added: UX #66 (sticky Unit + actions
  columns leave a ~74px live strip on the 390px tenancy sheet — sort
  works but targets are fiddly; narrow/cap the sticky columns on phones).
  New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r329 had the journey →
  r330 may be LIGHT; then #4).
- FIRST round on staging merged with origin/JOGQK head b3d9690 (standing
  branch rule; brings covenant self-fetch, entity-name backfill heal,
  Bill's IG handle fix, KYC never-screened sweep, brand-profile
  self-refresh/button removal onto staging; merge pushed as 4e45827).
  Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba
  trust per r205 — first smoke attempt died on pg auth before the trust
  edit, not a flake; SUPERUSER bgp role + restore + schema grant per
  r249). Regression: run-smoke.sh GREEN first pass after pg fix (42
  checks, 0 failures, FRESH_BUILD=1, fresh DB). Two-bot round 328: exit
  0, all scenarios ok first run (dev server warmed ~6min — no
  ECONNRESET). 3 logged issues all listed noise (rocketreach-400;
  brand-gaps/live-intel 503; commentary-regen 503 —
  qa/logs/round-328.jsonl). 0 raw 500/502/504 in the round's dev-server
  log (142 5xx all keyless-AI 503s; 2 400s the rocketreach +
  image-studio harness probes; 403/404/401s the listed
  negative-probe/HR-photo+sharepoint/pre-auth classes).
- Merged startup heals verified locally: [uk-entity backfill] filled 1
  fixture row cleanly; bills-ig heal silent (no matching fixture row);
  goad-datum failure is the listed r326 noise.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r328 was LIGHT → r329
  FULL).

### r327 · 2026-08-18 · FULL (rotation #2 client desktop)
- Staging merged with origin/JOGQK head 600b618 first (standing branch
  rule; brings UX 50-64 build, Instagram 3-strike ledger, entity fixes,
  KYC queue rotation onto staging). Fresh container (repo pre-cloned;
  pg_hba trust per r205; superuser bgp role + restore + schema grant per
  r249). Regression: run-smoke.sh GREEN first pass (42 checks,
  0 failures, FRESH_BUILD=1, fresh DB). Two-bot round 327: exit 0, all
  scenarios ok first run. 3 logged issues all listed noise
  (rocketreach-400; brand-gaps/live-intel 503; commentary-regen 503 —
  qa/logs/round-327.jsonl). 0 raw 500/502/504 in the round's dev-server
  log (lone " 500 " hit is the "500 articles" news-feed text; 174 5xx
  all keyless-AI 503s).
- Journey: Mark Warne desktop 1440px — "how are my Bluewater lettings
  progressing, and who do I chase about the stuck one": guest-form login
  → Portfolio dashboard (KPIs, tracker tile) → Letting Tracker →
  Negotiating chip (filters to the 1 MSU9 row, correct) → MSU9 deal page
  → /deals (2 CRM deals + "+2 letting deals" subtitle) → #1003 U124
  Gail's deal detail (stage Solicitors, BGP contact shown, comments +
  audit render) → Bluewater property page (news feed, risk register,
  Linked Contacts with deal-role rows — the real "who to chase" answer)
  → client /news (Brand News renders) → tenancy Full Board via direct
  route (200 units, chips, 0 h-overflow). Task completable; 0 page
  errors, 0 non-noise sightings all legs.
- Triaged, NOT bugs: client tracker rows show edit pencil + delete and
  client deals table shows "+ Link landlord/tenant / + Add terms" —
  decided client write-parity (r263/r279/r287 class; r263 already
  de-fanged the AML side-effect). "Off tenancy spine" chip absent on
  client deal detail = UX #50 gate holding (chip is deal-detail-only,
  staff-only; Gail's deal is genuinely off-spine, unit_id NULL per
  r207). /api/client/sharepoint/root 404 + hr/photo 404 = listed noise.
  Client property page goto('networkidle') times out (long-polling) —
  tester note, use domcontentloaded.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: UX #65 (deal-detail "BGP contact: <name>" is inert text — no
  mailto/message/contact-card link for the chase-this-deal client).
  Harness growth: none needed (no new bug class; parity + gates already
  locked).
- New flakes: none.
- Next journey: rotation #3 client mobile 390px (r327 had the journey →
  r328 may be LIGHT; then #3).

### r326 · 2026-08-18 · LIGHT (r325 had the journey)
- FIRST round on the post-merge staging head (f382235 pulled the JOGQK UX
  batches + client-view fixes into staging). Fresh container (repo
  pre-cloned at /home/user/bgp-wip-app; pg_hba trust per r205; SUPERUSER
  bgp role + restore + schema grant per r249/r321). Regression:
  run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1 before the
  fixes, rebuilt bundle after; no cold-build flake either pass). Two-bot
  round 326: exit 0, all scenarios ok first run (dev server warmed
  ~10min — no ECONNRESET). 4 logged issues: 2 listed noise
  (rocketreach-400; commentary-regen 503), 1 more keyless-AI 503
  (brand-gaps/live-intel), and 1 NEW http-400 → fixed below. 0 raw
  500/502/504 in the round's dev-server log (lone " 500 " hit is the
  "500 articles" news-feed text; 139 5xx all keyless-AI 503s).
- Bugs fixed (2), both introduced by JOGQK commit 07a0a33 ("Free staff
  phones stuck in client view", 2026-08-14) newly merged onto staging:
  1. Exit-client-view fired a doomed POST /api/auth/client-view-mode
     {enabled:false} for EVERY staff exit — server 400s "Not on a client
     team" for staff who entered via the team picker (the common case;
     fixture Victoria included), UI swallowed it (r307
     doomed-request class; surfaced as the round's new http-400). Both
     call sites (app-sidebar Exit button, mobile-home exitClientView) now
     gate on user.canViewAsClient — set by /api/auth/me under exactly the
     condition the server accepts the call. Verified in-browser: switch
     to Landsec scopes, Exit clears scope, 0 client-view-mode requests
     fired (pre-fix: 1 → 400); staff on a client team still fire it.
  2. The desktop "Viewing as <client>" banner was INVISIBLE in client
     view — bg-primary/10 text-primary, and the Landsec theme's primary
     is the same navy as the sidebar, so it rendered as a blank strip
     (element shot: solid navy; text unreadable, Exit undiscoverable —
     staff would think there's no way back). Now
     bg-sidebar-accent text-sidebar-accent-foreground (the paired sidebar
     tokens; correct contrast in the default theme too). Verified
     in-browser: "👁 Viewing as Landsec — Exit" reads clearly, computed
     colours dark-brown-on-beige. Mobile exit banner already explicit
     indigo/white — untouched. tsc clean, rebuilt, smoke re-green.
- Harness growth: none needed — two-bot's http-4xx issue logging IS the
  lock for fix 1 (a regression re-surfaces as a logged http-400); banner
  contrast isn't cheaply assertable.
- New environment noise: dev-server boot logs "[goad datum fix] failed …
  relation goad_units does not exist" ~30s after start — fixture has no
  goad_units (prod-only harvested table, not in the auto-migrate list);
  job rolls back and retries next boot, no user-facing effect. Added to
  the noise list.
- Bugs deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r326 was LIGHT → r327 FULL).
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; SUPERUSER bgp role + restore + schema grant per r249/r321).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 325: exit 0,
  192/192 ok first run (dev server warmed ~8min before start — no
  ECONNRESET). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 — qa/logs/round-325.jsonl). 0 raw 500/502/504 in
  the round's dev-server log (lone " 500 " hit is the "500 articles"
  news-feed text; 148 5xx all keyless-AI 503s — ai-briefing / ai-take /
  brand-gaps / chatbgp / os-sites / contact-verify / rocketreach-refresh /
  competitors-research / bgp-commentary classes; the 2 400s the
  rocketreach + image-studio harness probes).
- Journey: Victoria desktop 1440px — "Bluewater rent review settled with
  Starbucks: update the unit's passing rent on the full tenancy board,
  check the KPIs recalc, and confirm the client sees the new figure"
  (FIRST staff-desktop journey through the tenancy Full Board inline-cell
  WRITE — r307/r321 covered the board read-only on mobile): UI login via
  guest form → /properties → Bluewater card → property page (news feed,
  risk register, linked contacts all render) → Full Board link →
  /tenancy-schedule/:id (KPI strip, 200 units, stage chips, 0 h-overflow)
  → search "Starbucks" → 2 rows → inline click on passing-rent cell →
  input → Enter → PUT /api/tenancy-schedule/unit/:id 200 → cell shows
  £11,111, Passing Rent KPI recalcs — → £11,111 → survives reload → AS
  MARK: same board shows the new figure (decided parity: Import/Re-sync
  hidden, Add + row-delete present per r321) → rent restored via the same
  inline edit (200, cell back to —, DB row 0). Task completable; 0 page
  errors, 0 non-noise sightings all legs.
- NOT a bug (triaged): WAULT KPI read 128.4 yrs while the probe rent was
  live — the fixture's U007 Starbucks row genuinely carries a 2154-12-30
  lease expiry (Landsec-feed placeholder; 72 dated units, max 2154-12-31),
  and with exactly one rented unit the rent-weighted WAULT = that unit's
  term. Maths correct, data placeholder → UX #64 (exclude/badge >60yr
  terms). Unfiltered board reads 9.9 yrs as always.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: UX #64. Harness growth: none needed — the PUT edit path +
  scope guards are already locked (client-tenancy-edit /
  client-tenancy-write-scoped ride the same handler); this round's
  staff-desktop coverage was visual. New flakes: none.
- Next journey: rotation #2 client desktop (r325 had the journey → r326
  may be LIGHT; then #2).

### r324 · 2026-08-17 · LIGHT (r323 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; SUPERUSER bgp role + restore + schema grant per r249/r321).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 324: exit 0, all
  scenarios ok first run (dev server warmed ~90s before start — no
  ECONNRESET). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503 — details in qa/logs/round-324.jsonl). 0 raw
  500/502/504 in the round's dev-server log (135 5xx all keyless-AI 503s —
  ai-briefing / ai-take / brand-gaps / chatbgp / os-sites / contact-verify /
  rocketreach-refresh / competitors-research classes; the 2 400s the
  rocketreach + image-studio harness probes). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions added:
  none. New flakes: none.
- Next journey: rotation #1 staff desktop (r324 was LIGHT → r325 FULL).

### r323 · 2026-08-17 · FULL (rotation #4 staff mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore + SUPERUSER bgp role + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 323: exit 0,
  192/192 ok first run (dev server warmed ~5min before start per the r319
  note — no ECONNRESET). 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in the
  round's dev-server log (148 5xx all keyless-AI 503s — ai-briefing /
  ai-take / brand-gaps / chatbgp / os-sites / contact-verify /
  rocketreach-refresh / competitors-research classes).
- Journey: Victoria @ 390px iPhone UA — "on the move: check how my
  Bluewater letting deals are progressing, open one, then jot a chase-up
  task from my phone" (FIRST staff-mobile coverage of the /deals/list
  board + deal detail + /tasks quick-add WRITE; r307 covered
  properties/tenancy/calendar, r315 brands/contacts): UI login via guest
  form → staff mobile home (tile grid + bottom nav render, ChatBGP bar,
  billing KPIs; 0 h-overflow) → Deals via home tile → /deals/list card
  layout (stage chips All/SOL/EXC, New Deal button, search) → search
  "Bluewater" narrows 3→2 cards, header recounts → deal detail
  ("U124 Bluewater — Gail's letting") renders full stacked (Parties/Fee
  Allocation/Xero/Deal Activity/KYC sections, breadcrumb, Edit; 0
  h-overflow) → /tasks → quick-add "Add a task..." input → Enter → POST
  /api/tasks 200, "Task created" toast, row renders in All tab. Task
  completable; 0 page errors, 0 non-noise sightings all legs. Probe rows
  swept via SQL after (lowercase 'r323' titles dodge run-round's purge
  AND two-bot's uppercase R323 rows — LIKE is case-sensitive).
- Tester notes for future rounds: (1) staff mobile layout REQUIRES touch
  emulation — useIsMobile is narrow-viewport AND isTouchDevice, so a
  Playwright context without hasTouch:true gets the pinned desktop
  sidebar squeezing content into ~166px at 390px (looks like a horrid
  bug; it's the deliberate narrow-desktop-window behaviour — set
  hasTouch:true + isMobile:true). (2) psql -tA prints the "DELETE n"
  command tag as an output line — `RETURNING id | wc -l` overcounts by
  1; a phantom "duplicate task" chased this round was exactly that
  (clean repro: 1 Enter = 1 POST = 1 row; POST-count arithmetic across
  the dev log matched).
- Bugs fixed: 0 (nothing broken found — the one suspect above
  adversarially verified as tester error). Deferred: none. Suggestions
  added: UX #63 (deals-board stage chips keep unfiltered counts while
  search narrows the list + header — numbers disagree, UX #61 class).
  Harness growth: none needed — task create/PATCH/DELETE already covered
  (two-bot ~794/~4023); this round's mobile coverage was visual.
  New flakes: none.
- Next journey: rotation #1 staff desktop (r323 had the journey → r324
  may be LIGHT; then #1).

### r322 · 2026-08-17 · LIGHT (r321 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore + SUPERUSER bgp role + schema grant per r249/r321).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 322: exit 0,
  all scenarios ok first run (dev server warmed ~4min before start per
  the r319 note — no ECONNRESET). 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in the
  round's dev-server log (140 5xx all keyless-AI 503s — ai-briefing /
  ai-take / brand-gaps / chatbgp / os-sites / contact-verify classes;
  the 2 400s the rocketreach + image-studio harness probes). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r322 was LIGHT → r323
  FULL).

### r321 · 2026-08-17 · FULL (rotation #3 client mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore + schema grant per r249 — note reassign-owned errors on
  system objects, a SUPERUSER bgp role + schema grant suffice). Regression:
  run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh DB +
  FRESH_BUILD=1; no cold-build flake). Two-bot round 321: exit 0, 192/192
  ok first run (no ECONNRESET — started ~60s after DEV-UP per the r319
  note). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). Dev-server log 5xx tally: 143 keyless-AI 503s +
  9 GET /api/auth/microsoft 500s — the latter are the explicit "Microsoft
  SSO not configured" no-key guard, all fired by my own journey v1 whose
  button:has-text("Sign in") selector matched "Sign in with Microsoft"
  first (tester error, noted below); 0 other raw 500/502/504. 400s the
  rocketreach + image-studio harness probes; 401/403/404s the listed
  pre-auth/negative-probe/HR-photo+sharepoint-root classes.
- Journey: Mark Warne @ 390px iPhone UA — "my asset manager wants to know
  which Bluewater leases expire soonest and what lettings evidence we
  have — from my phone" (FIRST client-mobile coverage of /properties list,
  property page, tenancy Full Board, and /comps; r313/r305 covered
  calendar/contacts/news/brands): UI login via client form → Portfolio
  home (tiles render, 0 h-overflow) → /properties (2-property Landsec
  portfolio, KPI strip, map, Bluewater card) → property page (ownership
  card, week's-focus task widget; triple nav stack = UX #55 applies to
  client too) → Full Board link → /tenancy-schedule/:id renders (KPI
  cards incl. WAULT 9.9yrs / occupied 88 / vacant 76, status chips, 200
  units, 0 h-overflow — table scrolls in its own container) → search
  "Starbucks" narrows to its 2 units → /comps (Leasing board scoped to
  1 comp = two-bot's live QA-COMP residue; Leasing/Investment tabs,
  search, area filter; 0 staff toolbar leaks — no Add/Scan/Import/
  Verify). 0 page errors, 0 non-noise sightings all legs. Task PARTLY
  completable: reaching the board is easy, but answering "expires
  soonest" means swiping the full 34-column desktop sheet with only
  Unit pinned and no date sort → UX #62.
- Triaged, NOT bugs: client tenancy board shows Add + per-row delete +
  "+ Tracker" — decided parity, verified: server allow-list documents
  client tenancy-row edits (import/bulk-delete stay staff-only, and the
  UI hides exactly Import + Re-sync via isClientViewer), DELETE handler
  scope-checks isPropertyInScope (server/tenancy-schedule.ts). Harness
  already locks this (client-tenancy-write-scoped /
  client-tenancy-staff-ops-guard / client-tenancy-edit) — no growth
  needed. Brand-gaps international/commentary 503s on the client
  property page = keyless-AI class (cache empty → generate → no key).
- Tester notes for future rounds: 'button:has-text("Sign in")' matches
  "Sign in with Microsoft" FIRST on the login page — use
  [data-testid="button-guest-login"] (+ input-guest-email/-password);
  each stray Microsoft click burns a loginLimiter slot AND logs a
  noise 500. Client /comps mobile renders comps as cards, not tbody
  rows.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: UX #62 (mobile tenancy board is the raw 34-column sheet — no
  card view, no date sort; lease-event questions unanswerable on a
  phone). New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r321 had the journey →
  r322 may be LIGHT; then #4).

### r320 · 2026-08-17 · LIGHT (r319 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 320: exit 0 ×2 —
  first run 191/192 ok incl. the FIRST live runs of r319's
  agent-seed-firm-pool-image + client-image-bytes-scoped (both green; the
  image byte scope-jail holds live); re-run after the harness fix 192/192
  ok. 2 remaining logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 across both runs' dev-server
  log (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s;
  403s the harness's negative probes; 404s the listed HR-photo +
  sharepoint-root polling + client-image-bytes-scoped's own asserted
  foreign thumb/full 404s + the requirements-leasing probe; 400s the
  rocketreach + image-studio harness probes + my own 2 wrong-shape login
  probes — /api/auth/login takes {username}, not {email}; 401s pre-auth
  /api/auth/me + no-key M365 class; 503s all keyless-AI class).
- HARNESS FLAKE fixed (not an app bug): staff-property-tenancy-mobile
  failed run 1 with goto "is interrupted by another navigation to /" right
  after the localStorage plant — the r204/r273 redirect-on-mount race
  surfacing under Playwright's OTHER error wording, which mobGoto's
  ERR_ABORTED-only retry didn't catch. App verified fine standalone: 3/3
  exact-pattern repro attempts loaded /properties/:id (setup-folders
  visible) + tenancy sticky sheet at 390px. Fix: mobGoto now also retries
  on /interrupted by another navigation/ (qa/two-bot-round.mjs). node
  --check clean; verified live — re-run 192/192 ok incl. the scenario.
- Bugs fixed: 0 app bugs; 1 harness flake as above. Deferred: none.
  Suggestions added: none. New flakes: none beyond the wording variant
  above (now handled). (Round note: r320's heartbeat commit footer carries
  a non-standard co-author name — r306 class, history kept, no force-push;
  final commits use the repo-standard footer.)
- Next journey: rotation #3 client mobile 390px (r320 was LIGHT → r321
  FULL).

### r319 · 2026-08-17 · FULL (rotation #2 client desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1
  before the fix, rebuilt bundle after). Two-bot round 319: first attempt
  crashed with ECONNRESET on POST /api/auth/login during dev-server cold
  start (news startup fetch in flight) — new flake, see below; clean
  re-run exit 0, all scenarios ok. 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in the
  round's dev-server log (58 5xx all keyless-AI 503s; the 2 400s the
  rocketreach + image-studio harness probes).
- Journey: Mark Warne desktop 1440px — "I need imagery for a Landsec
  board pack: open Image Studio, see what BGP hold for me, upload my own
  unit photo, and confirm it's usable" (FIRST client-desktop coverage of
  the full /image-studio page + client upload WRITE — clients get the
  full studio per the 2026-08-04 parity decision): UI login via client
  form → Portfolio home → sidebar Image Studio → /image-studio renders
  (Library/Brand Library/Collections tabs, category rail, 6 scoped rows —
  5 Landsec brand images + two-bot's Bluewater residue; 0 h-overflow) →
  staff maintenance controls correctly hidden (dedupe/near-dedupe/
  ai-tag-uncategorised/rebuild-folders; hard-delete absent on cards) →
  Upload dialog → PNG via file input → POST /upload 200, card renders
  with thumbnail + Uncategorised chip, Library count bumps 1→2, search
  narrows, survives reload → staff cross-check: upload lands in the firm
  pool company-stamped to Landsec (companyId + uploadedBy correct). API
  probes: own image PATCH 200 / foreign image PATCH 403 (write jail
  holds). 0 page errors, 0 non-noise sightings.
- Bug fixed (1): GET /api/image-studio/:id/thumb and /:id/full served
  raw image bytes for ANY id to ANY authenticated caller — a scoped
  client could read firm-pool/foreign imagery bytes by id, contradicting
  the documented "every handler scope-jails" invariant (journey probe:
  Mark fetched the Honi Poke brand image's /full → 200 pre-fix). Every
  LIST surface was already scoped (incl. /orphans client-blocked), so
  ids don't leak in-app — defence-in-depth class. Fix: both endpoints
  now imageInScope-check and 404 (not 403, so existence isn't confirmed)
  on out-of-scope ids (server/image-studio.ts). Verified via API on the
  restarted dev server: Mark own thumb/full 200 + foreign thumb/full
  404; Victoria all 200 (staff unaffected); in-browser post-fix Mark's
  grid renders all 7 in-scope thumbs (7×200). tsc clean, rebuilt, smoke
  re-green.
- Harness growth: two-bot +2 — agent-seed-firm-pool-image (staff uploads
  an unscoped qa-unit-photo.jpg, id stashed on cross) +
  client-image-bytes-scoped (client own thumb/full must 200, firm-pool
  foreign thumb/full must 404; added to the negative-probe set so its
  404s aren't logged). node --check clean; round 319 ran the pre-edit
  file, so first live run is r320; assertions verified this round via
  the journey's API probes.
- NOT bugs (triaged, for future rounds): client card hover shows
  view/edit/AI-edit affordances — decided parity (PATCH + ai-edit are
  client-allowed, handlers scope-jail; verified 403 on foreign). The
  grey no-thumbnail Bluewater card is two-bot's own residue row (no
  thumbnail stored), purged at next round start. "Library (1)" vs 6
  grid cards is a count/grid mismatch → UX #61, not a data leak.
- Bugs deferred: none. Suggestions added: UX #61 (Library tab/"All"
  counts exclude Brands but the grid shows them — numbers disagree with
  the cards). New flakes: two-bot can die with ECONNRESET on login if
  started right after the dev server boots (news startup fetch); wait
  ~30s after DEV-UP or just re-run.
- Next journey: rotation #3 client mobile 390px (r319 had the journey →
  r320 may be LIGHT; then #3).

### r318 · 2026-08-17 · LIGHT (r317 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + per-object ALTER owners + schema grant
  per r249). Regression: run-smoke.sh GREEN first pass (42 checks, 0
  failures, fresh DB + FRESH_BUILD=1; no cold-build flake). Two-bot round
  318: exit 0, all scenarios ok — incl. the FIRST live run of r317's
  extended client-comps-readonly (green; staff toolbar controls stay
  hidden for the client AND client comp POST + DELETE 403 — the write
  guard holds). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling + the harness's requirements-leasing
  probe; the 2 400s the rocketreach + image-studio harness probes; 401s
  pre-auth /api/auth/me + no-key M365 class + the login-screen
  brand-theme echo; 503s all keyless-AI/OS_API_KEY class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r318 was LIGHT → r319 FULL).

### r317 · 2026-08-17 · FULL (rotation #1 staff desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 317: exit 0,
  190 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes + my journey's own
  client comp write probes; 404s the listed HR-photo + sharepoint-root
  polling; the 2 400s the rocketreach + image-studio harness probes;
  401s pre-auth /api/auth/me + no-key M365 class; 503s all keyless-AI
  class).
- Journey: Victoria desktop 1440px — "just agreed a letting at
  Bluewater: log the comp as rent-review evidence, check it's usable,
  then confirm what the client sees" (FIRST staff-desktop WRITE
  coverage of the Add Comp dialog — r291 only geometry-probed it on
  mobile; r245 saw the empty board): UI login via guest form → /comps
  (Leasing board, KPI strip, area chips, 0 h-overflow) → Add Comp
  dialog → property picker types "Bluewater" → BGP-property dropdown
  hit → "Linked to BGP property" badge → tenant/rent/Zone A/date →
  POST 201, "Comp created" toast → row lists with BGP chip + £92,500
  headline + computed £92,500 NET EFFECTIVE → search narrows →
  survives reload → row detail renders (NER/property sections) → Rent
  Analysis calculator: 92,500 headline / 10yr / 12mo RF amortised →
  £83,250 pa NER + £33.30 net psf, maths correct → AS MARK: /comps is
  the scoped read-only board (sees the Bluewater-linked comp per the
  scheme scope, toolbar is calculators+Export only — 0 Add/Scan/Import/
  bulk-verify leaks; API GET own-scheme comp 200, POST 403, DELETE 403).
  Probe comp deleted via staff API (200) after. Task completable; 0
  page errors, 0 non-noise sightings all legs.
- NOT bugs (triaged, for future rounds): a second "QA-COMP R317,
  Bluewater Shopping Centre" all-dash row mid-journey is two-bot's OWN
  round-317 probe (line ~1150 stamps the round number — r285 residue-
  collision class, not a double-submit). Comp row delete lives in the
  per-row "…" dropdown menu (no button-delete-comp testid) — my row
  locator missed it, cleaned via API instead; not a missing affordance.
  Area doesn't auto-fill from the fixture Bluewater property (its
  address JSON lacks city) — data, not the dialog.
- Bugs fixed: 0 (nothing broken found). Harness growth: two-bot
  client-comps-readonly extended — staff toolbar controls
  (Add/Scan/Import) must not render for the client AND client comp
  POST + DELETE must 403 (locks the journey-verified write guard;
  scenario added to the negative-probe set so its 403s aren't logged).
  node --check clean; round 317 ran the pre-edit file, so first live
  run is r318; assertions verified live this round via the journey's
  API probes (403/403) + client screenshot (0 leaks).
- Bugs deferred: none. Suggestions added: none. New flakes: none.
  (Round note: r317's heartbeat commit footer carries a non-standard
  co-author name — r306 class, history kept, no force-push; final
  commits use the repo-standard footer.)
- Next journey: rotation #2 client desktop (r317 had the journey →
  r318 may be LIGHT; then #2).

### r316 · 2026-08-17 · LIGHT (r315 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 316: exit 0,
  190 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling; the 2 400s the rocketreach +
  image-studio harness probes; 401s pre-auth /api/auth/me + no-key M365
  class; 503s all keyless-AI class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r316 was LIGHT → r317 FULL).

### r315 · 2026-08-17 · FULL (rotation #4 staff mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 315: exit 0,
  190 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling; the lone 400 the rocketreach probe;
  401s pre-auth /api/auth/me + no-key M365 class; 503s keyless-AI class
  incl. /api/ai-briefing echoes during the journey).
- Journey: Victoria @ 390px iPhone UA — "Starbucks' contact has a new job
  title: open the brand from my phone, check Key contacts, correct the
  role, then open the person's card" (FIRST staff-mobile coverage of
  /brands hub, the MobileBrandView company profile, the Key-contacts
  inline role WRITE, and /contacts/:id contact detail): UI login via
  guest form → /brands (Brand Intelligence tiles, category counts,
  search, 0 h-overflow) → search-free tap through to Starbucks →
  /companies/:id renders the stacked MobileBrandView (badges, mini chat,
  Key contacts board with Tom Barista + role, Covenant; 0 h-overflow) →
  inline role edit ("Click to edit role" button → input → Enter) → PUT
  /api/crm/contacts/:id 200 → survives reload → tap name →
  /contacts/:id ContactDetail renders full (role chip updated, Contact
  Details card, activity tabs; 0 h-overflow). Task completable; 0 page
  errors, 0 non-noise sightings. Probe role restored via API + verified
  in DB after.
- Journey v1 dead-end (triaged → UX #60, not a bug): planned the staff
  New Contact WRITE but there is NO manual contact-entry path in the
  live app — /contacts routes to people.tsx PeopleHub (CRM
  landlords/agents/lenders, no create button); the full New Contact
  dialog (button-create-contact + ContactFormDialog) lives in
  client/src/pages/contacts.tsx ContactList which is UNROUTED dead code
  (only its ContactDetail is imported, for /contacts/:id). Staff
  contacts arrive via discovery/promote/bulk only; the client hub keeps
  its own Add-contact dialogs.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  contact create/PUT/DELETE already API-covered (two-bot ~461/~816);
  the brand-board inline role edit rides the same PUT; this round's
  mobile geometry coverage was visual.
- Bugs deferred: none. Suggestions added: UX #60 (staff have no manual
  New Contact path anywhere; working dialog stranded in dead code —
  rewire or delete). New flakes: none.
- Next journey: rotation #1 staff desktop (r315 had the journey → r316
  may be LIGHT; then #1).

### r314 · 2026-08-16 · LIGHT (r313 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 314: exit 0,
  190 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling; the 2 400s the rocketreach +
  image-studio harness probes; 401s pre-auth /api/auth/me + no-key M365
  class + the login-screen brand-theme echo; 503s all keyless-AI class
  incl. the contact-verify scenario's own asserted no-key 503). 0 app
  bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r314 was LIGHT → r315
  FULL).

### r313 · 2026-08-16 · FULL (rotation #3 client mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 313: exit 0,
  190 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (lone " 500 " grep hit is the "500 articles" news-feed
  text; status tally only 2xx/3xx/expected 400/401/403/404 + no-key
  503s: 503s keyless-AI class, 404s HR-photo + sharepoint-root polling,
  401s pre-auth /api/auth/me + M365 + login-screen brand-theme echo,
  403s the harness's negative probes, the 400 the rocketreach probe).
- Journey: Mark Warne @ 390px iPhone UA — "BGP are coming to Bluewater
  Tuesday for a leasing review: put it in my calendar, find my BGP
  contact to confirm, and jot a prep task" (FIRST journey coverage of
  the client mobile CALENDAR WRITE + /contacts CRM tabs; r305/r297
  covered news/brands/deals mobile): UI login via client form →
  Portfolio home (0 h-overflow) → Calendar tile → day view renders
  (concurrent two-bot QA-CAL rows visible, day-summary bar) → Add event
  dialog (374px in 390 viewport, 0 clipped) → POST /api/team-events
  200 → next-day ×2 to Tue 18 → event block renders 10:00 "Landsec"
  attribution, survives reload → /contacts via CRM tile (Brand
  Directory / Agents / Landsec Contacts tabs, 0 h-overflow) → Landsec
  Contacts lists own people (incl. two-bot residue rows) → Tasks via
  bottom nav → quick-add → POST /api/tasks 200, "Task created" toast,
  row renders with Medium chip. 0 page errors, 0 non-noise sightings
  all legs. Task PARTLY completable — the find-my-BGP-contact leg
  dead-ends on mobile (UX #59): ClientTeamOrgChart is desktop
  dashboard + company-profile only, Landsec Contacts tab has no BGP
  staff and no search ("Search brands or people…" only exists on the
  Brand Directory tab, and it doesn't match staff).
- NOT bugs (triaged, for future rounds): mini month picker
  (cal-day-N testids) is a hidden desktop rail on mobile — navigate the
  day view via button-next-day/button-prev-day. Login form hides
  behind button-show-guest-login ("Client / guest sign in") — 0 inputs
  until clicked. My journey probe rows (QA-R313 team_event, QA-PROBE
  task r313) aren't in run-round's purge patterns — swept via SQL this
  round.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  client-calendar-add-event already locks the calendar write API path;
  this round's mobile dialog/day-view coverage was visual.
- Bugs deferred: none. Suggestions added: UX #59 (client mobile has no
  path to the BGP account team — no org-chart card on mobile home, no
  staff in Landsec Contacts, no contact search). New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r313 had the journey →
  r314 may be LIGHT; then #4).

### r312 · 2026-08-16 · LIGHT (r311 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 312: exit 0,
  190 scenarios ok — incl. the FIRST live run of r311's extended
  client-viewings-offers scenario (green; the client WRITE round-trip —
  POST viewing on own unit → in list → client DELETE → gone — holds).
  2 logged issues both listed noise (rocketreach-400; commentary-regen
  503). 0 raw 500/502/504 in the whole round's dev-server log (status
  tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s; 403s the
  harness's negative probes; 404s the listed HR-photo + sharepoint-root
  polling + the harness's requirements-leasing probe; the 2 400s the
  rocketreach + image-studio harness probes; 401s pre-auth /api/auth/me +
  no-key M365 class + the login-screen brand-theme echo; 503s all
  keyless-AI/OS_API_KEY class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r312 was LIGHT → r313
  FULL).

### r311 · 2026-08-16 · FULL (rotation #2 client desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 311: exit 0,
  190 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (lone " 500 " grep hit is the "500 articles" news-feed
  text; status tally only 2xx/3xx/expected 400/401/403/404 + no-key
  503s; the 2 guest-login 404s were my own probe at the wrong endpoint —
  the app's login POST is /api/auth/login).
- Journey: Mark Warne desktop 1440px — "a prospect viewed my Bluewater
  unit last week: log the viewing in the letting tracker, record their
  interest, and check it all rolls up" (FIRST journey coverage of the
  client tracker WRITE dialogs — r279/r297/r303 only opened them
  read-only): UI login via client form → Portfolio home (0 h-overflow) →
  /deals/letting (153 units, FY strip, search narrows to U124 rows, 0
  h-overflow) → Viewings dialog → Add Viewing (date/time/attendees/
  notes) → POST 201, "Viewing added" toast, row renders with edit pencil
  + delete → Offers dialog → Add Offer → POST 201, "Offer added" toast,
  Pending chip → both counts roll up on the unit row (1·1) AND the FY
  KPI strip (Viewings/Offers bump), survive reload. Company/Contact
  CrmPickers populate for clients from the SCOPED lists (probe: 10
  companies / 5 contacts as Mark — not empty, not firm-wide). Client
  viewing DELETE verified via API round-trip (200, gone from list).
  Task completable; 0 page errors, 0 non-noise sightings; probe rows
  cleaned up after (attendees/comments 'QA-R311%' aren't in run-round's
  purge patterns — swept via SQL this round).
- NOT bugs (triaged, for future rounds): tracker desktop TABLE uses
  button-viewings-*/button-offers-* testids (unit-viewing-*/
  unit-interest-* are the card layout); dialog quick entries left with
  empty Company headline "No company" — pickers are optional by design
  (see UX #58); 3 near-identical "U124/U125/U126 Bluewater" fixture rows
  are data, not dupes (r309 note).
- Bugs fixed: 0 (nothing broken found). Harness growth: two-bot
  client-viewings-offers extended — client WRITE round-trip (POST a
  viewing on an own unit → in list → client DELETE → gone) locking the
  r311-journey-verified parity path. node --check clean; round 311 ran
  the pre-edit file, so first live run is r312; assertions verified
  standalone this round via API probes.
- Bugs deferred: none. Suggestions added: UX #58 (viewing/offer cards
  headline "No company" on quick entries — fall back to attendees).
  New flakes: none.
- Next journey: rotation #3 client mobile 390px (r311 had the journey →
  r312 may be LIGHT; then #3).

### r310 · 2026-08-16 · LIGHT (r309 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 310: exit 0,
  190 scenarios ok — incl. the FIRST live run of r309's extended
  create-deal scenario (green; the created deal carries a non-empty team,
  the r309 seeding holds). 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 in the whole
  round's dev-server log (status tally: only 2xx/3xx/expected
  400/401/403/404 + no-key 503s; 403s the harness's negative probes; 404s
  the listed HR-photo + sharepoint-root polling + the harness's
  requirements-leasing probe; the 2 400s the rocketreach + image-studio
  harness probes; 401s pre-auth /api/auth/me + no-key M365 class; the
  GET /api/os/sites 503s verified in code as the explicit "OS_API_KEY not
  configured" guard — same no-key class, not a crash). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r310 was LIGHT → r311 FULL).

### r309 · 2026-08-16 · FULL (rotation #1 staff desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1
  before the fix, rebuilt bundle after; no cold-build flake either pass).
  Two-bot round 309: exit 0, 190 scenarios ok; 2 logged issues both
  listed noise (rocketreach-400; commentary-regen 503). 0 raw 500/502/504
  in the whole round's dev-server log (lone " 500 " grep hit is the "500
  articles" news-feed text; status tally only 2xx/3xx/expected
  400/401/403/404 + no-key 503s).
- Journey: Victoria desktop 1440px — "terms agreed with an espresso
  operator on a Bluewater unit: create the deal, confirm it's on the
  board, open it, and check what the client sees" (FIRST journey coverage
  of the staff New Deal dialog WRITE path end-to-end — r293/r299 only
  viewed/edited existing deals): UI login via guest form → /deals/list
  (0 h-overflow) → New Deal dialog (22 controls, 0 clipped; property
  combobox → Bluewater auto-fills Landsec as landlord + deal name; New
  Letting; unit picker required-and-works; tenant → Starbucks; target
  date) → POST 201 → row appears in the team-filtered table (post-fix),
  survives reload, SOL KPI bumps → deal detail renders full (Parties/
  Fee Allocation/KYC both parties/Files/Linked Property/Timeline/Audit,
  "On tenancy spine" chip, 0 h-overflow) → as Mark: the Landsec-linked
  deal is correctly VISIBLE in his 6-deal list + detail renders with 0
  fee-section leaks (decided own-portfolio parity, r263/r297 gates).
  Unit-less New Letting is correctly blocked with a clear toast. QA deal
  deleted after; journey scripts under the round's scratchpad.
- Bug fixed (1): a created deal with no team VANISHED from the creator's
  deals list the moment the "Deal created" toast fired — the New Deal
  dialog only auto-assigns teams for some deal types (New Letting,
  Sub-Letting, Temp Lease, Consultancy get NONE), the list defaults its
  team filter to the user's own team, and teamFilteredDeals hides
  team-less deals whenever a team filter is active. Fix: the create form
  now seeds the creator's active internal team (never the client
  "Landsec" pseudo-team; clients keep [] — their list isn't
  team-filtered), still editable in the team picker
  (client/src/pages/deals.tsx DealFormDialog freshForm). Verified
  in-browser pre/post: pre-fix the 201'd deal was absent from the list
  even after reload; post-fix it lists immediately with the National
  Leasing chip + team lands in the DB row. tsc clean, rebuilt, smoke
  re-green.
- Harness growth: two-bot create-deal scenario extended — after the
  create it now asserts the deal carries a non-empty team via the API
  (locks the r309 seeding; its old comment documenting "Consultant deals
  carry no team so they won't appear in her filtered view" was the bug's
  own footprint and is updated). node --check clean; round 309 ran the
  pre-edit file, so first live run is r310; assertion verified live this
  round via the journey (dialog-created deal → team ["National Leasing"]
  in DB + API).
- NOT bugs (triaged, for future rounds): the deals TABLE has no deal-name
  column in the default 10/44 set — getByText(dealName) finds nothing
  even when the row is present; assert via ref #/Property/Tenant cells
  or the API. The simplified New Deal form's date input is
  #deal-target-date (NO data-testid; input-deal-target-date is the
  full/consultant form). "New Letting needs a unit" destructive toast on
  unit-less create is intended validation, not a bug. Journey login must
  retry on 429 while two-bot runs concurrently (login rate limiter).
- Bugs deferred: none. Suggestions added: UX #57 (Deal-created toast has
  no "View deal" link and the name-less table makes the new row hard to
  find). New flakes: none.
- Next journey: rotation #2 client desktop (r309 had the journey → r310
  may be LIGHT; then #2).

### r308 · 2026-08-16 · LIGHT (r307 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 308 final run:
  exit 0, 190 scenarios ok; 2 logged issues both listed noise
  (rocketreach-400; commentary-regen 503). 0 raw 500/502/504 across the
  whole day's dev-server log (status tally: only 2xx/3xx/expected
  400/401/403/404 + no-key 503s; the extra 400s were my own repro
  scripts' wrong-shape login probes).
- HARNESS BUG fixed (not an app bug): r307's new
  staff-property-no-client-sharepoint scenario failed its first live runs
  (30s then 60s locator timeout) — it plants the legacy 'authToken'
  localStorage key in a deliberately cookie-less fresh context, but the
  app's UI reads its Bearer token from 'bgp_auth_token'
  (queryClient.ts getAuthHeaders; login.tsx stores only that key). Every
  other fresh-context scenario also copies session cookies, which mask
  the wrong key — cookie-less runs land on the Sign-in screen
  unauthenticated (r307's standalone verify, like my first repro, leaked
  a session cookie via the request-context login, which is why it looked
  green). Fix: the scenario now plants page.qaToken as 'bgp_auth_token'
  (qa/two-bot-round.mjs); also kept a 60s selector wait to survive
  builds hogging the box. Verified standalone cookie-less (selector 3s,
  0 sharepoint fetches — the r307 app fix holds) AND live in-round
  (green in the 190-ok run). App verified fine throughout: staff
  property loads fire 0 /api/client/sharepoint/root fetches.
- NOTE for future scenarios: 'authToken'/'user' localStorage plants are
  no-ops for the app UI — auth in the harness contexts really rides on
  the copied session cookies; cookie-less contexts must plant
  'bgp_auth_token'.
- Bugs fixed: 0 app bugs (nothing broken found); 1 harness auth-key bug
  as above. Deferred: none. Suggestions added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r308 was LIGHT → r309 FULL).

### r307 · 2026-08-16 · FULL (rotation #4 staff mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + per-object ALTER owners + schema grant
  per r249). Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  FRESH_BUILD=1 before the fixes, rebuilt bundle after; no cold-build
  flake either pass). Two-bot round 307: exit 0, 189 scenarios ok; 2
  logged issues both listed noise (rocketreach-400; commentary-regen
  503). 0 raw 500/502/504 in the whole round's dev-server log.
- Journey: Victoria @ 390px iPhone UA — "Landsec asked about upcoming
  lease events at Bluewater: open the property, find which leases expire
  soonest on the full tenancy board, then put a review call on the
  calendar" (FIRST staff-mobile coverage of /properties → property page →
  tenancy Full Board → /calendar): UI login via guest form → dashboard →
  /properties (Bluewater found) → property page (sections hydrate,
  Schedule card open) → Full Board link → /tenancy-schedule/:id (KPIs,
  200 units, search Starbucks → 2 rows, expiry 2027 visible) →
  /calendar day view. 0 h-overflow all legs, 0 page errors. Calendar
  leg NOT completable in-app for staff — Add-event is client-only by
  design (staff events come from Outlook sync); logged as UX #56, not
  a bug.
- Bugs fixed (2):
  1. Calendar events starting before the grid's 06:00 first hour got a
     negative top and rendered as unreadable clipped slivers (seen with
     two-bot's 05:06 QA-CAL rows on the day view). Now pinned to the
     grid top with the block bottom kept at the real end time
     (client/src/pages/calendar.tsx event positioning). Verified
     in-browser: both 05:06 events render as full readable blocks at
     top 0px / 44px height.
  2. Staff property-page loads fired a doomed GET
     /api/client/sharepoint/root → 403 on every view —
     property-detail.tsx isClientViewer defaults TRUE while
     /api/auth/me loads (deliberate fail-closed), briefly mounting the
     client files panel for staff. The client branch now waits for
     pdViewer before mounting the panel (fail-closed UI unchanged).
     Verified in-browser: staff property load fires 0 sharepoint
     requests + staff Files panel renders; client (Mark) panel still
     mounts and fetches. tsc clean, rebuilt, smoke re-green.
- Harness growth: two-bot +1 staff-property-no-client-sharepoint (fresh
  context, staff property load must fire zero /api/client/sharepoint/root
  requests). node --check clean; round 307 loaded the pre-edit file, so
  first live run is r308; assertion verified standalone this round via
  the verify script. Calendar clamp NOT harness-assertable cheaply —
  /api/team-events only serves future events, so a deterministic
  pre-6am fixture isn't available at arbitrary run times.
- NOT bugs (triaged, for future rounds): staff /calendar has no
  Add-event button (isClientViewer-gated by design — clients write
  team_events, staff sync Outlook; UX #56 covers the gap). The two
  clipped-sliver events were two-bot's own QA-CAL residue (start 05:06
  = round start time), but the clipping defect was real for any
  pre-6am event. Property page at 390px stacks 3 nav rows (top bar +
  breadcrumb + back-link) — works, logged as UX #55.
- Bugs deferred: none. Suggestions added: UX #55 (mobile property page
  triple nav stack), UX #56 (staff have no in-app calendar add-event —
  phone users lose CRM-linked quick capture). New flakes: none.
- Next journey: rotation #1 staff desktop (r307 had the journey → r308
  may be LIGHT; then #1).

### r306 · 2026-08-16 · LIGHT (r305 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 306: exit 0,
  189 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling + the harness's requirements-leasing
  probe; the 2 400s the rocketreach + image-studio harness probes; 401s
  pre-auth /api/auth/me + no-key M365 class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none. (Round note: r306's heartbeat commit
  footer carries a non-standard co-author name — history kept, no
  force-push; final commits use the repo-standard footer.)
- Next journey: rotation #4 staff mobile 390px (r306 was LIGHT → r307
  FULL).

### r305 · 2026-08-16 · FULL (rotation #3 client mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 305: exit 0,
  189 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; the 2 400s the
  rocketreach + image-studio harness probes).
- Journey: Mark Warne @ 390px iPhone UA — "over breakfast on my phone:
  catch up on tenant news for the board, save an article for later, then
  look up a tenant brand's contact" (FIRST client-mobile coverage of
  /news and the bottom-nav round trip; r295 covered client news
  DESKTOP): UI login via client form → Portfolio home (0 h-overflow) →
  News via mobile-home-link-news tile → mobile feed renders (50 article
  cards, external hrefs correct) → bottom-nav round trip Deals → Tasks
  (quick-add strip + 1 open task render) → Messages (ChatBGP pinned,
  clean empty state) → Portfolio → News, every tab lands right, 0
  h-overflow on all legs → /brands hub (8-brand slice, category tiles,
  search) → Starbucks profile (Key Contacts: Tom Barista; Compliance +
  Covenant per 2026-08-01; 0 staff-leak buttons). All legs 0 page
  errors, 0 non-noise sightings. Task NOT fully completable — the
  save-for-later leg has no affordance on mobile (see UX #54): mobile
  /news is the deliberately read-only MobileNewsFeed (no Save/Saved/
  search/tags), works as designed but misses the desktop workflow.
- NOT bugs (triaged, for future rounds): Tasks-page AI briefing card
  shows "Preparing your briefing..." for a while before settling — just
  react-query's retry window on the keyless ai-briefing 503, ends in the
  "Generate Briefing" empty state (dashboard card shows the settled
  state). Mobile news cards render a blank 16:9 image box while the
  external image fetch hangs — no-external-network container artifact,
  onError hides it once the fetch fails. Sidebar-trigger selectors find
  nothing on client mobile — nav is mobile-home-link-* tiles +
  bottom-nav-* testids, no hamburger.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  client-mobile-brands-hub / client-mobile-no-overflow already lock the
  geometry; /api/news-feed client reads locked by r295-6 scenarios;
  this round's mobile-news + bottom-nav coverage was visual.
- Bugs deferred: none. Suggestions added: UX #54 (mobile news feed is
  read-only — no save/Saved path on the phone while desktop has the
  full workflow). New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r305 had the journey →
  r306 may be LIGHT; then #4).

### r304 · 2026-08-15 · LIGHT (r303 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 304: exit 0,
  189 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling + the harness's requirements-leasing
  probe; the 2 400s the rocketreach + image-studio harness probes; 401s
  pre-auth /api/auth/me + no-key M365 class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #3 client mobile 390px (r304 was LIGHT → r305
  FULL).

### r303 · 2026-08-15 · FULL (rotation #2 client desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 303: exit 0, all
  scenarios ok, 2 logged issues both listed noise (rocketreach-400;
  keyless-AI 503). 0 raw 500/502/504 in the whole round's dev-server log
  (status tally: only 2xx/3xx/expected 400/401/403/404 + no-key 503s; the
  2 400s the rocketreach + image-studio harness probes).
- Journey: Mark Warne desktop 1440px — "a jeweller is circling Bluewater:
  add it to Brand Intelligence from the wider directory, review its
  profile, then take it back off my list" (FIRST visual coverage of the
  client Add-brand dialog round-trip + the extra-ids brand-profile path;
  r281 only skimmed the hub on mobile): UI login via client form →
  Portfolio home → /brands (Overview KPIs; search lives in the Brand
  Explorer TAB, not Overview) → explorer pre-state correct (Jewellers
  absent, Fashion present — fixture ships Landsec with Testco Fashion
  self-added, crm_extra_brand_ids={…0002}; NOT a slice leak) → Fashion
  profile renders full (Tracked-brand badge, chat, ChatBGP chips, UK
  Stores, Compliance + Covenant per 2026-08-01; 0 staff-leak buttons) →
  Add-brand dialog (slice brands "In CRM", fixture self-add "Added +
  Remove", out-of-slice "Add" — all three badge states correct) → Add
  Jewellers → toast, explorer card appears, category tile bumps → Jewellers
  profile renders full → dialog Remove → explorer 0 hits → direct
  /companies/:id lands on "Company not found" gate (API 403s, no broken
  page). All legs 0 h-overflow, 0 page errors, 0 non-noise sightings.
  Task completable.
- NOT bugs (tester errors, for future rounds): the dialog's per-row Add
  buttons — locator('button:has-text("Add")').first() clicks the FIRST
  result row's Add (alphabetical), not your target's; scope to the row.
  getByText(name).click() on explorer cards misses the a[aria-label=name]
  inset-0 overlay Link — click the anchor. "rendersName=true" after
  removal was the sidebar Quick Access recent-history links (see UX #53),
  not a data leak. My journey v1 mutated Landsec's fixture extras
  (removed 0002 / added 0007) — restored to {…0002} via SQL same round.
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  client-add-brand-from-directory + client-add-brand-remove-ui already
  lock the API + dialog Remove/In-CRM paths; this round verified the
  three badge states + profile round-trip visually.
- Bugs deferred: none. Suggestions added: UX #53 (sidebar Quick Access
  keeps a removed self-added brand and dead-ends on "Company not found").
  New flakes: none.
- Next journey: rotation #3 client mobile 390px (r303 had the journey →
  r304 may be LIGHT; then #3).

### r302 · 2026-08-15 · LIGHT (r301 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 302: exit 0,
  189 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling + the harness's requirements-leasing
  probe; the 2 400s the rocketreach + image-studio harness probes; 401s
  pre-auth /api/auth/me + no-key M365 class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #2 client desktop (r302 was LIGHT → r303 FULL).

### r301 · 2026-08-15 · FULL (rotation #1 staff desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 301: exit 0,
  189 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/404 +
  no-key 503s; 404s the listed HR-photo + sharepoint-root polling; the
  lone 400 the rocketreach probe; 401s pre-auth /api/auth/me + no-key
  M365 class).
- Journey: Victoria desktop 1440px — "a brand wants space: log the new
  leasing requirement, see if any vacant units fit, then pull the brand's
  key contact" (FIRST staff-desktop coverage of the /requirements WRITE
  path — Add Requirement dialog, inline row, edit dialog, UI delete):
  UI login via guest form → dashboard → /requirements (Leasing tab, 0
  h-overflow; fixture ships ZERO leasing requirements so the board opens
  as a bare empty table — data, not a bug) → Add Requirement dialog →
  name + Restaurant use toggle + comments → "Requirement created" toast
  → row lists with Active + Restaurant chips, fits/fresh KPI cards
  appear → search narrows → survives reload → edit dialog pre-fills name
  → UI delete confirm → row gone → fits-only KPI toggle works → /brands
  search → Starbucks profile (Key Contacts: Tom Barista; Compliance &
  KYC + Covenant render; signals feed populated). Task completable; 0
  page errors, 0 non-noise console/net sightings.
- Checked, NOT a bug: /api/crm/requirements-leasing CRUD handlers carry
  no per-route requireAuth but the global auth gate 401s all unauth'd
  /api probes (verified via curl: GET/POST both 401).
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  requirements-leasing create/PUT/DELETE already API-covered (two-bot
  lines ~344/~842); this round verified the dialog UI paths visually.
- Bugs deferred: none. Suggestions added: UX #52 (Add Requirement dialog
  never sets requirementDate → new requirement shows Date "—", no Fresh
  badge, and the "active in the last 90 days" KPI reads 0 seconds after
  adding fresh demand). New flakes: none. Journey-script note: scratchpad
  scripts can't `import 'playwright'` by name — import
  /home/user/bgp-wip-app/node_modules/playwright/index.mjs directly.
- Next journey: rotation #2 client desktop (r301 had the journey → r302
  may be LIGHT; then #2).

### r300 · 2026-08-15 · LIGHT (r299 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 300: exit 0,
  189 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; 404s the listed
  HR-photo + sharepoint-root polling + the harness's requirements-leasing
  probe; the 2 400s the rocketreach + image-studio harness probes; 401s
  pre-auth /api/auth/me + no-key M365 class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #1 staff desktop (r300 was LIGHT → r301 FULL).

### r299 · 2026-08-15 · FULL (rotation #4 staff mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN first pass (42 checks, 0 failures, fresh
  DB + FRESH_BUILD=1; no cold-build flake). Two-bot round 299: exit 0,
  189 scenarios ok; 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's
  dev-server log (status tally: only 2xx/3xx/expected 400/401/403/404 +
  no-key 503s; 403s the harness's negative probes; the 2 400s the
  rocketreach + image-studio harness probes).
- Journey: Victoria @ 390px iPhone UA — "on the train before a Bluewater
  call: how's the letting pipeline moving, open the live deal, then jot a
  chase task and make sure it stuck" (FIRST staff-mobile coverage of
  /deals/letting, /deals/list, deal DETAIL full page + Edit Deal dialog,
  and the /tasks quick-add WRITE): UI login via guest form → dashboard
  (0 h-overflow) → /deals/letting (156 units, status-chip counts, search
  narrows 156→7 CARDS — mobile renders cards not tbody rows, count
  '[data-testid^=tracker-row], .card' next time) → Viewings dialog
  (374px @ x8, 0 clipped) → /deals/list (2 deals, SOL/EXC chips, View
  buttons — NO numeric /deals/:id anchors, navigate via View) → deal
  detail U124 Gail's letting (0 h-overflow at 4 scroll depths; action
  row wraps per r267; Parties/Fee Allocation/KYC/Files/Timeline/Comments
  all render) → Edit Deal dialog (48 controls, 0 clipped) → /tasks
  (tab strip wraps per r275, quick-add → "Task created" toast → row
  renders → survives reload; probe purged by run-round's QA-PROBE sweep).
  Task completable; 0 page errors, 0 non-noise console/net sightings.
- NOT bugs (triaged, for future rounds): "Tenant not set" + empty Parties
  links + "Select unit" on deal #302 are fixture NULLs (r297 class); Edit
  Deal Target Date shows mm/dd/yyyy — native date input in the
  container's en-US Chromium, locale-dependent, not app copy; "Off
  tenancy spine" chip on STAFF deal header is fine (staff have Resolve —
  the client-side copy is already UX #50).
- Bugs fixed: 0 (nothing broken found). Harness growth: none needed —
  staff-deal-mobile-action-row + staff-tasks-mobile-tabs already lock
  this journey's geometry; task write paths already scenario-covered.
- Bugs deferred: none. Suggestions added: UX #51 (staff /deals/list
  mobile cards show no target date / time-in-status — phone pipeline
  triage must open each deal one-by-one). New flakes: none.
- Next journey: rotation #1 staff desktop (r299 had the journey → r300
  may be LIGHT; then #1).

### r298 · 2026-08-15 · LIGHT (r297 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + ALTER owners +
  schema grant per r249). Regression: run-smoke.sh GREEN first pass (42
  checks, 0 failures, fresh DB + FRESH_BUILD=1; no cold-build flake).
  Two-bot round 298: exit 0, 189 scenarios ok — incl. the FIRST live run
  of r297's client-property-units-scoped (green; the scoped
  /api/property-units client read + 403 gates hold). 2 logged issues both
  listed noise (rocketreach-400; commentary-regen 503). 0 raw 500/502/504
  in the whole round's dev-server log (status tally: only 2xx/3xx/expected
  400/401/403/404 + no-key 503s; 403s the harness's negative probes; 404s
  the listed HR-photo + sharepoint-root polling; the 2 400s the
  rocketreach + image-studio harness probes; 401s pre-auth /api/auth/me +
  no-key M365 class). 0 app bugs.
- Bugs fixed: 0 (nothing broken found). Deferred: none. Suggestions
  added: none. New flakes: none.
- Next journey: rotation #4 staff mobile 390px (r298 was LIGHT → r299
  FULL).

### r297 · 2026-08-15 · FULL (rotation #3 client mobile 390px)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205; restore-as-postgres + ALTER owners + schema grant per r249).
  Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures; FRESH_BUILD=1
  before the fix, rebuilt bundle after; no cold-build flake either pass).
  Two-bot round 297: exit 0, 188 scenarios ok — incl. FIRST live run of
  r296's extended client-news-save-unsave-roundtrip (green; tombstone fix
  holds). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the round's dev-server log.
- Journey: Mark Warne @ 390px iPhone UA — "on my phone: how are my
  Bluewater lettings progressing, and what's the state of the live deal?"
  (FIRST client-mobile coverage of /deals/letting, /deals/list, deal
  detail + its dialogs — r279 covered these client DESKTOP): UI login via
  the client form → Portfolio home (0 h-overflow) → /deals/letting (153
  units, status KPIs, Brochure/Viewing/Interest/Edit per row, search
  narrows 153→7, 0 h-overflow) → Viewings dialog (374px @ x8, 10
  controls, 0 clipped) → Offers dialog (14 controls, 0 clipped) →
  /deals/list (2 deals, SOL/EXC chips) → deal detail (r263 gates hold:
  Timeline hidden, jailed Files copy, Audit log present; Image Studio +
  Edit + party links = decided parity, checked) → Edit Deal dialog (48
  controls, 0 clipped, no fee inputs). Task completable; 0 page errors,
  0 non-noise sightings except the bug below.
- Bug fixed (1): the deal Edit dialog's unit picker GET
  /api/property-units 403'd for clients (not on CLIENT_ALLOWED_API), so
  in the decided-parity deal-edit flow the picker silently fell back to
  [] — saved unit ids couldn't resolve to names, property_units-only
  options were missing, and a 403 fired on every dialog open. Fix:
  allowlisted the read (server/index.ts) + scope check in the GET handler
  (server/routes.ts — scoped callers must pass an own-portfolio
  propertyId; unfiltered firm-wide list, foreign property and all unit
  writes stay 403). Verified via API probes on the rebuilt prod bundle
  (:5100 — own 200/71 rows, unfiltered 403, foreign 403, write 403,
  staff unchanged 200/200) AND in-browser as Mark on the restarted dev
  server (Edit dialog fires 200, unit picker 195 options). tsc clean,
  rebuilt, smoke re-green.
- NOT bugs (triaged, for future rounds): my dialog "fee leak" grep hit
  was /fee/i matching "Coffee" — tune the regex. Deals #302/#303 show
  "Select unit" in the Edit trigger post-fix because the fixture deals
  have NULL unit_id — data, not a resolution failure.
- Harness growth: two-bot +1 client-property-units-scoped (own-property
  list 200 + array, unfiltered 403, POST 403; in the negative-probe set
  so its 403s aren't logged). node --check clean; the round-297 run
  loaded the pre-edit file, so first live run is r298; assertions
  verified standalone via the API probes this round.
- Bugs deferred: none. Suggestions added: UX #50 (client deal page shows
  the amber "Off tenancy spine" chip whose tooltip tells the client to
  use a staff-side Resolve tool — internal jargon on a client surface).
- Next journey: rotation #4 staff mobile 390px (r297 had the journey →
  r298 may be LIGHT; then #4).

### r296 · 2026-08-15 · LIGHT (r295 had the journey)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249). Regression: run-smoke.sh GREEN ×2 (42
  checks, 0 failures; FRESH_BUILD=1 before the fix, rebuilt bundle after;
  no cold-build flake either pass). Two-bot round 296: exit 0, 188
  scenarios ok — incl. r295's client-news-save-unsave-roundtrip (green
  post-fix). 2 logged issues both listed noise (rocketreach-400;
  commentary-regen 503). 0 raw 500/502/504 in the whole round's server
  log (lone " 500 " grep hit is the "500 articles" news-feed text; 244
  503s all keyless-AI class).
- Bug fixed (1, r295's deferred): /api/news-feed/saved treated ANY
  historical unsave row as a permanent tombstone — save → unsave → save
  again never reappeared in Saved. Now compares latest save vs latest
  unsave per article (server/news-feeds.ts saved handler); an unsave only
  hides saves that came before it. Verified via API probe as Mark on BOTH
  the prod bundle (:5100) and the dev server (:5000): save 200 → in
  /saved, unsave 200 → gone, re-save 200 → REAPPEARS (was: gone forever).
  tsc clean, rebuilt, smoke re-green.
- Harness growth: client-news-save-unsave-roundtrip extended — after the
  unsave leg it now re-saves and asserts the article is back in /saved
  (locks the tombstone fix). node --check clean; the round-296 run loaded
  the pre-edit scenario, so first live run of the extended version is
  r297; assertions verified standalone this round via the API probes.
- Bugs deferred: none. Suggestions added: none. New flakes/setup notes:
  run-round.sh takes >10 min wall-clock now (188 scenarios) — run it
  backgrounded, a 10-min foreground cap kills it mid-run and ORPHANS the
  node two-bot child (kill it before re-running); pkill/pgrep -f
  'two-bot-round' self-matches the caller's own command line (exit 144) —
  use a character class like 'two-[b]ot-round'.
- Next journey: rotation #3 client mobile 390px (r296 was LIGHT → r297
  FULL).

### r295 · 2026-08-15 · FULL (rotation #2 client desktop)
- Fresh container (repo pre-cloned at /home/user/bgp-wip-app; pg_hba trust
  per r205 — method-column awk; restore-as-postgres + per-object ALTER
  owners + schema grant per r249; NOTE killing `npm run dev`'s pid does
  NOT kill the tsx child — pkill the tsx processes or server fixes never
  load). Regression: run-smoke.sh GREEN ×2 (42 checks, 0 failures;
  FRESH_BUILD=1 before the fixes, rebuilt bundle after; no cold-build
  flake either pass). Two-bot round 295: exit 0, 3 logged issues — 2
  listed noise (rocketreach-400; commentary-regen 503), 1 flow-failure on
  the NEW client-news-save-unsave-roundtrip = the deferred tombstone bug
  below (my pre-run probes had already unsaved the same top article, so
  the re-save never surfaced — deterministic, not flake). 0 raw
  500/502/504 in the whole round's server log (lone " 500 " grep hit is
  the "500 articles" news-feed text; status tally only 2xx/3xx/expected
  400/401/403/404 + no-key 503s).
- Journey: Mark Warne desktop 1440px — "board asked for a tenant-news
  roundup: work the News feed, filter by topic, search, save for later,
  then check news on a tenant brand" (FIRST client-desktop DEPTH pass on
  /news — r223 only glanced at it): login → Portfolio home → /news via
  nav (0 h-overflow) → feed renders (For You/Insights/Saved tabs, tag
  chips, 100 articles) → tag chip filters (client feed zero-hits most
  tags — UX #49) → search box narrows server-side → Save → Saved tab
  shows card → Unsave → gone after hard reload (post-fix) → Read fires
  engage + window.open with correct article URL → Stats/Insights render
  → /brands search → Starbucks profile (Compliance + Covenant per
  2026-08-01 decision, news content present). Task completable; 0 page
  errors, 0 non-noise console/net errors.
- Bugs fixed (2):
  1. Client news UNSAVE 403'd — /api/news-feed/engage (save) is in
     CLIENT_ALLOWED_WRITES but /api/news-feed/unsave never was, so a
     client could save an article but NEVER remove it; the UI toasts
     "Removed" optimistically with no onError, so the failure was
     silent until reload. Allowlisted unsave beside engage
     (server/index.ts). Verified in-browser as Mark: save → Saved tab →
     Unsave → hard reload → gone, empty state back.
  2. News zero-result state under active filters read "No articles yet —
     Click Refresh to fetch…" + an ungated Fetch News button — for a
     client every tag-chip zero-hit (common, see UX #49) dead-ended in a
     button that 403s (fetch is deliberately staff-only). Empty state is
     now filter-aware ("No matching articles / try clearing filters")
     and the Fetch News button is hidden for role=Client in the truly-
     empty case (client/src/pages/news.tsx, matches the header refresh
     gate). Verified both personas; staff header Refresh + genuine-empty
     Fetch News unchanged.
- Bug deferred (1): /api/news-feed/saved treats ANY historical unsave
  row as a permanent tombstone — it drops every articleId with an
  unsave engagement regardless of ordering, so save → unsave → save
  again NEVER reappears in Saved (server/news-feeds.ts ~1690, the
  unsavedSet filter). Fix: keep an article if its latest save is newer
  than its latest unsave. Found via the new harness scenario; hit the
  2-bug cap this round.
- Harness growth: two-bot +1 client-news-save-unsave-roundtrip (client
  save must 2xx, appear in /saved, unsave must 2xx — the r295 allowlist
  gap — and disappear after). node --check clean; ran live this round
  (failed only on the deferred tombstone, see above — passes on a fresh
  DB first run).
- NOT bugs (triaged, for future rounds): Playwright popup events NEVER
  fire in this container's Chromium even though window.open returns a
  window (sanity-tested on a blank page) — verify Read buttons via a
  window.open wrapper, not waitForEvent('popup'). Staff "New openings"
  tag chip has matches (their team feed carries tagged articles), so
  the filtered empty state is client-data-dependent, not a staff
  regression. locator('button:has-text("Save")') substring-matches the
  Saved TAB — use the button-save-/button-unsave- testids.
- Suggestions added: UX #49 (global tag chips mostly zero-out the
  client's For You slice — hide/grey zero-match chips or show counts).
  New flakes: the popup-event note above + the npm-kill note in setup.
- Next journey: rotation #3 client mobile 390px (r295 had the journey →
  r296 may be LIGHT; then #3).

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

### r344 · 2026-08-19/20 · LIGHT (r343 had the journey) — finished by replacement session
- Original container reclaimed after its heartbeat; replacement session
  finished the round 2026-08-20. JOGQK merge already in staging (66e102e);
  smoke GREEN ×3 (42 checks, 0 failures; FRESH_BUILD=1 before and after fix).
- Two-bot round 344: tally 36×403 + 1×400 + 2×503. The 400/503s are listed
  noise (rocketreach-400, keyless-AI 503). The 36×403 were ONE real bug from
  the merge: DealVerdictAlarm mounted for ALL users, but the client API
  gateway (CLIENT_ALLOWED_API) blocks /api/deal-verdicts/* → every client
  page load logged a 403 (mark + sam scenarios). No visual breakage (alarm
  renders null on error), but per-page 403 console/monitor noise.
- Bug fixed (1): App.tsx now mounts DealVerdictAlarm staff-only (same
  role==='Client' || companyScopeId test as isClientShell). Verified
  visually: Mark's pages fetch nothing, 0×403; Victoria unaffected.
- Deal-verdict feature sweep (new surface, dev server + browser): /pending
  correct (fixture has no due deals → dormant by default; probe deal listed
  with daysOverdue); slipping w/o date 400; bogus verdict 400; slipping
  re-dates deal + clears pending; on_track via UI clears the full-screen
  block; banner (0-2d) and full-screen block (3d+) both render clean at
  1440px; invoice_now push path guarded (no woody push sub in fixture, no-op).
- Harness growth: staff-deal-verdict-flow scenario in two-bot-round.mjs
  (create overdue probe deal → pending → 400 → slipping → cleared → deal
  deleted in-scenario); run-round.sh purge now sweeps orphan deal_verdicts
  rows. Scenario's API sequence dry-run green.
- CAUTION for future rounds: a pending verdict deal for victoria@ full-screen
  BLOCKS her browser at 3d+ overdue — never leave one seeded while the
  two-bot round or a journey runs (this round briefly self-inflicted ~90s of
  extra pending-fetch exposure mid-round; re-checked, no false failures
  logged from it).
- Bugs deferred: none. Suggestions added: UX-NOTES #74 (verdict banner
  overlays the app header, hiding global search while pending).
- New flakes: none. tsc clean.
- Next journey: rotation — r343 covered client desktop; r345 FULL should take
  rotation #3 client mobile 390px (staff mobile #4 after).
- Addendum (original r344 session, resumed): independently reproduced and
  verified the same client 403 storm + staff happy path; kept its extra
  harness scenario client-no-deal-verdict-poll (mark's shell making ANY
  /api/deal-verdicts request fails the round) alongside staff-deal-verdict-flow.
