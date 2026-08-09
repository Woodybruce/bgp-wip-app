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

### r234 · 2026-08-09 · LIGHT — ROUND IN PROGRESS (heartbeat)
- Fresh container (pg_hba trust fix needed, r205 note). run-smoke.sh GREEN
  (42 checks, 0 failures, fresh DB + FRESH_BUILD=1). Two-bot round 234
  running; triage + final entry to follow.

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
