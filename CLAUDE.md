# CLAUDE.md

Project-specific instructions for Claude Code sessions on this repo.
Applies to both web (claude.ai/code) and terminal Claude Code.

## Project

**BGP Dashboard** — Bruce Gillingham Pollard property management platform.
React + Vite + Wouter (client), Express + Drizzle + Postgres (server),
ChatBGP (Claude-powered AI), deployed on Railway.

See `replit.md` for the full feature runbook, architecture decisions,
and integration notes.

## Working branch

Default working branch: `claude/terminal-coding-interface-JOGQK`

Woody bounces between:
- Terminal Claude Code on his laptop
- Web Claude Code (claude.ai/code) when away from his desk

Both environments share code through GitHub on this branch.

## Sync protocol (IMPORTANT)

At the **start** of every session:
1. Run `git fetch origin` and check if `origin/claude/terminal-coding-interface-JOGQK`
   is ahead of local `HEAD`.
2. If it is, `git pull origin claude/terminal-coding-interface-JOGQK` before
   touching any files. This picks up whatever was done on the other machine.
3. Report the state to Woody in one line (e.g. "Pulled 3 commits from remote"
   or "Already up to date").

At the **end** of every session, or whenever Woody says "push":
1. Commit any outstanding changes with a clear message.
2. Push: `git push -u origin claude/terminal-coding-interface-JOGQK`.
3. Confirm the push succeeded.

**Never push without being asked**, except when Woody says "push" or
equivalent ("ship it", "send it up", "save to GitHub").

**Never force-push, rebase published commits, or reset --hard** without
explicit permission.

## Commit style

- Match the existing commit style (see `git log --oneline -20`).
- Short, imperative, no scope prefix, no trailing period.
- Examples from history: "Fix land registry 500 + mobile downloads in chat-panel",
  "Fix pixelated company logos — switch from Google Favicons to Clearbit".

## Working style

- Read files before editing them. Don't guess at code you haven't seen.
- Prefer editing existing files over creating new ones.
- Don't add speculative abstractions, helpers, or "improvements" beyond what
  was asked.
- Don't add comments, docstrings, or type annotations to code you didn't change.
- Ask before making architectural changes or touching shared schemas
  (`shared/schema.ts`, migrations).
- **Migrations do not run on deploy.** Railway's build is plain `npm run
  build`; drizzle-kit is never run and `script/build.ts --migrate-only` is
  manual. The live schema comes from the boot `MIGRATIONS` array in
  `server/index.ts` plus `server/schema-drift.ts`, which at boot applies the
  files in `IDEMPOTENT_SQL_MIGRATIONS` and adds any column in
  `shared/schema.ts` the DB lacks (nullable). New additive migration files
  go on that list; CREATE TABLE still needs a boot statement or a listed
  file. `GET /api/admin/schema-drift` shows what's missing.
- For UI changes, say explicitly when you haven't verified in a browser.

## Landsec client brand access (DECIDED — do not re-litigate in merges)

Client logins see the **hospitality / leisure / fitness category slice**
(`CLIENT_CRM_CATEGORIES` in `shared/tenant-categories.ts`) **plus any brand
they self-add** from the global directory (`crm_extra_brand_ids` on their
company row; add/remove via `/api/client/crm/add-brand`). Woody decided this
on 2026-08-01 ("landsec only want CRM on the hospitality fitness restaurants
leisure cafes", confirmed as category slice + self-adds) — it **supersedes**
the earlier "open up all brands for the Landsec account" note. When merging,
keep the slice: the canonical gates are `isClientVisibleBrand` and
`clientBrandSliceSql` in `server/company-scope.ts` — don't reintroduce the
`/^tenant -/i` all-brands regexes. Also decided 2026-08-01: the Compliance &
KYC panel STAYS visible on client brand profiles (landlords need tenant
AML/financial standing); staff-only action buttons are hidden for clients.

Woody clarified on 2026-09-07: client CRM **Agents are agents acting for
brands actually in that client's Brand CRM**. Qualify through current
tenant-rep representations or current visible leasing requirements with an
explicit agent-contact link to a directory brand. Company/contact agent
flags alone do not qualify. Show only the named linked contacts, not every
employee at a qualifying firm. Preserve people whose firm is unconfirmed;
do not infer an employer or change stored company attachments. The shared
brand slice (including self-added brands) still defines eligible brands.

## Lettings: units, deals and the Letting Tracker (DECIDED 2026-10-26 — do not re-litigate)

Woody's answers to the cleanup report (`docs/letting-cleanup-thoughts.md`,
appendix `docs/letting-cleanup-technical-appendix.md`):

- **Every Letting Tracker unit has a backing deal (Ref #) from the moment
  it exists**; the fee and the fee split live on the deal. The fee split is
  entered on the Add Unit form at creation (the deal page edits it later).
- **The Letting Tracker becomes a view of letting deals** (the structural
  change): one record per letting from Marketing to Invoiced, shown on the
  tracker, the Deals board and the WIP. The tracker row keeps only
  marketing collateral (website flag, lease terms, available date, photos,
  brochures, HOTs document, viewings, offers) and keeps its id (bgp.uk.com
  listing URLs).
- **Letting deal types:** New Letting, Lease Disposal, Temp Lease, Licence,
  Sub-Letting. Lease Disposal (and Sub-Letting) are **tenant-side**
  instructions; New Letting / Temp Lease / Licence are landlord-side. The
  side is derived from the type on CREATE; existing deals are only moved
  after Woody has seen the list.
- **Tracker statuses:** Marketing (AVA), Negotiating (NEG), HOTs (HOT) and
  Solicitors (SOL) are live on the tracker; Exchanged / Completed /
  Withdrawn / Invoiced fold under Historic. Solicitors shows as "Under
  Offer" on the website.
- **Marketing deals sit on the Deals board and the WIP from birth** with
  or without a fee (no fee = "fee needed" on Needs Attention, not "not
  WIP") — this is the leasing fee forecast.
- **No unplaced letting deals:** a letting deal must have a property and a
  unit (an actual address); otherwise it is refused, never parked.
- **Client-added units** (Landsec logins) create a BGP instruction (deal +
  Ref #).
- **Re-marketing** a let or withdrawn unit starts a new deal record (the
  completed one keeps its Ref #, fee and invoice); it is still ONE unit and
  ONE live deal on the tracker; previous viewings and offers stay visible
  on the unit.
- **Leasing Schedule (Landsec board):** recommended to become a lens over
  the tenancy schedule + live deals, keeping only their strategy fields;
  needs Landsec's nod (Phase 6).
- **Freeze:** the deploy-time NEG-deal → tracker loop is deleted and the
  overlapping admin repair buttons (Sync Tracker → Leasing Schedule,
  Renumber Units, Rename Legacy Teams, firm-wide Re-sync) are frozen while
  the cleanup runs. Integrity is REPORTED (`GET /api/admin/letting-integrity`),
  not silently repaired at boot.
- **One write door (Phase 2, 2026-10-26):** `server/letting-service.ts` —
  `createDeal` / `updateDeal` behind POST/PUT `/api/crm/deals` (and the WIP
  import, import-anything, ChatBGP via the routes), `createListing` behind
  POST `/api/available-units`, `ensureTrackerRowForDeal` (deal ⇒ tracker,
  never two rows for one deal), `writeDealFeeAllocations`. A letting
  create without property + unit is refused (409 `UNIT_REQUIRED`); a
  second live landlord-side letting on a unit is refused with the existing
  Ref # (409 `LIVE_LETTING_EXISTS`); existing deals are never refused for
  lacking a unit. Every row it makes or links gets one `deal_audit_log`
  row (field `letting_service`). Repairs are admin Preview → Apply only:
  `server/letting-backfill.ts` (tracker rows for the off-tracker deals,
  stub + real pairs) and `server/letting-sweep-undo.ts` (the 26 Oct sweep).
  Do not add a boot-time sweep again — the 26 Oct one minted 178 stubs.
- **Still parked for Woody:** the one-live-letting index (schema change)
  and wiring `actingForFromType` (Lease Disposal / Sub-Letting → tenant
  side) — both wait on his review of the integrity report's lists.

## Document design preferences (the "house style" pattern)

For Claude-driven document generation (Why Buy decks initially, Document
Briefs / KYC Clouseau / PLA briefs over time), team preferences live in
`document_design_preferences` (free-text rows, scope + preference).
Active rows are prepended to the generation prompt as "House preferences"
so Claude designs each doc fresh but follows accumulated direction.

The palette and logo rule itself lives in ONE place: `server/doc-engine.ts`
`BGP_BRAND` (v19 Bordeaux `#6E0C25` / Nectar `#FC9F8D` / Stone, real
wordmark via `__BGP_LOGO_DARK__` / `__BGP_LOGO_LIGHT__` tokens that the
renderer swaps for the PNGs). Every new document generator imports it — do
not write a palette into a prompt or hardcode teal/green/gold, and never let
a design type its own "BGP" logo. See `docs/DESIGN.md` §1.

**Don't add rigid override fields.** When Nick (or anyone) says "always
do X on the Why Buy deck", insert one row into
`document_design_preferences` with scope='why_buy'. ChatBGP can do this
via `sql_write` directly — no dedicated tool needed. The pattern
generalises: pick a new scope string for a new doc type, fetch active
prefs in the generation path, prepend to prompt.

Helper: `server/document-preferences.ts` (`preferencesPromptFor(scope)`).
UI: inline `HouseStylePanel` on Pathway → Why Buy section.

## Design guidelines (Woody, 2026-08-23) — docs/DESIGN.md

The app-wide design standard lives in `docs/DESIGN.md` (v2, signed off by
Woody 2026-08-26): token-only colours, typography scale, the pill standard
(`client/src/components/ui/pill.tsx`), pill-row tabs, page header anatomy,
desktop-table/phone-card-list, phone shell rules, and the deviation
hit-list. **Convert on touch**: any commit touching a screen brings its
chips, tabs, header and colours to that standard in the same commit. Don't
invent new chip/tab styles. `rounded-full` buttons are exempt from the
mobile 44px tap-target rule — that rule was the cause of the historic
"massive pills".

## ChatBGP's app map (KEEP CURRENT)

`server/chatbgp-app-map.ts` is ChatBGP's description of the app itself —
every screen and how to reach it on desktop vs the phone shell. ChatBGP
gives users in-app directions from this file, so **whenever you change
navigation, add/remove a page, or move a control, update the relevant
lines there in the same commit**. Stale lines become confident wrong
answers to the team (that's how this file came to exist — ChatBGP sent
Woody to a Settings page the phone app can't reach, 2026-08-23).

## Website team list = HR (Woody, 2026-10-13)

The HR pages in the app are the one source of truth for people. The public
team feed (`/api/public/website/all`, `overlayHrProfiles` in
`server/website-content.ts`) takes name, job title and phone from
`users` + `staff_profiles` (matched by email) and only keeps the website
row for photo, key-contact groups, order and visibility. Business cards
(`/card/<slug>`) read the same HR fields. Fix a title in HR, not in the
website panel or `marketing/src/lib/content.ts`.

## Marketing site (bgp.uk.com) deploys

The public website is a **separate Railway service** (root directory
`marketing/`) from the dashboard. A push to the working branch redeploys
the dashboard but has NOT been redeploying the site — after changing
anything under `marketing/`, the marketing service needs a redeploy for
bgp.uk.com to update.

The Railway project token that used to be written here is dead: Railway
disclosed a breach of customer environment variables on 2026-10-21 and
the token stopped resolving the next day. Mint a new one in Railway →
Tokens only when needed and keep it in the Claude environment settings
as `RAILWAY_PROJECT_TOKEN`, never in the repo or the chat. Rotation
checklist for every secret: `docs/railway-incident-2026-10-21.md`.

- **Terminal Claude Code / any machine with open network**: with the
  Railway CLI, `RAILWAY_TOKEN=<token> railway redeploy` (pick the
  marketing service if prompted, or pass `--service`). Or via the API:
  `POST https://backboard.railway.app/graphql/v2` with header
  `Project-Access-Token: <token>` — query `projectToken { projectId
  environmentId }`, list the environment's services, then run the
  `serviceInstanceRedeploy` mutation on the marketing service.
- **Web (claude.ai/code) sessions**: the sandbox network policy blocks
  backboard.railway.app (proxy 403), so web sessions CANNOT trigger the
  redeploy even with the token — say so and hand off to a terminal
  session or the Railway UI (project → marketing service → Redeploy).
- **The real fix** (do this once, then no token is ever needed): in
  Railway → marketing service → Settings → Source, make sure it deploys
  from `claude/terminal-coding-interface-JOGQK` (the working branch) —
  then every push updates bgp.uk.com automatically like the dashboard.

## Checking pages on prod (BGP_QA_TOKEN)

Web sessions test UI changes against the live app with a test login Woody
creates on `/qa-access` (admin only; one year or 24 hours; "Revoke all test
access" there cancels every one). The one-year token lives in the Claude
environment settings as `BGP_QA_TOKEN` — never in the repo or the chat. Use
it as `Authorization: Bearer $BGP_QA_TOKEN` for API calls, or set
`localStorage.bgp_auth_token` in a Playwright page (Chromium at
`/opt/pw-browsers/chromium`) to screenshot and measure pages across a
spread of brands after a UI change. It acts as Woody: stick to reading
pages and don't trigger paid refreshes or send anything.

## Key files

| Area | Path |
|------|------|
| Client entry | `client/src/main.tsx`, `client/src/App.tsx` |
| Pages (50+) | `client/src/pages/` |
| Server entry | `server/index.ts` |
| REST routes | `server/routes.ts` |
| ChatBGP AI engine | `server/chatbgp.ts` |
| CRM logic | `server/crm.ts` |
| AI model strategies | `server/models.ts` |
| DB schema | `shared/schema.ts` |
| Migrations | `migrations/` |
| Build script | `script/build.ts` |
| Project runbook | `replit.md` |
