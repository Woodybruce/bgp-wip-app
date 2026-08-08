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
- (RESOLVED r208) two-bot used to hardcode old-dev-fixture IDs; it now
  resolves Landsec/Bluewater/brand by name at startup and works against
  qa/smoke-fixture.sql.gz. run-round.sh + seed-personas.sql then two-bot is
  the full sweep; run-smoke.sh stays the quick authoritative regression.

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

### r212 · 2026-08-08 · LIGHT — ROUND IN PROGRESS (provisional)
- Fresh container. Regression: run-smoke.sh GREEN (42 checks, 0 failures,
  fresh DB + fresh build). Triage: nothing to triage from smoke. Two-bot
  sweep running next; entry will be replaced with the final one.

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
