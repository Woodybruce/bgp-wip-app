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

## Landsec pitch build (Woody, 2026-11-11) — docs/landsec-pitch-plan.md

Landsec is re-tendering its Hospitality & Leisure leasing instruction (14
schemes; pitches w/c 23 and 30 November 2026). Woody approved a build plan on
2026-11-11: one Landsec workspace with a single unit page, a brief agreed by
both the Landsec leasing manager and the asset manager, a deal clock with
"waiting on", a brand case (Jersey Mike's first), logins by role and scheme,
and an AI lock-down for Landsec data. **Read `docs/landsec-pitch-plan.md`
before touching any Landsec surface** — it has the build order, the problem
list from the team, the live-data findings and the sources to import.

The 14 schemes are a code registry, `server/landsec-schemes.ts` (name
matchers, groups); the Landsec home, client property list, portfolio
endpoint and analytics all read it. Add a scheme there, never by hand-
listing property ids elsewhere. Every Landsec workspace route resolves the
caller with `landsecViewer()` in `server/landsec-access.ts` (role + scheme
set); the Landsec tables are all in migration 0049 and `shared/schema.ts`
(`landsec_*`), and the shared constants and NER maths in `shared/landsec.ts`.

Decided (do not re-litigate): leasing managers see all schemes; asset
managers and joint agents see their own schemes only; joint agents never see
BGP's brand contacts, email history or fees; asset managers see brand pages
and the brand case portfolio-wide but deals and figures only on their
schemes; the new roles get a separate front door of new workspace routes
rather than scheme checks retrofitted into the existing client view; Landsec
data goes to one AI provider (Anthropic) only.

## Brands: one directory, one CRM plan (Woody, 2026-11-11)

- **Brand tidy = hide, then delete** (Woody, 2026-11-12: "dont archive just
  delete them or hide"). The screens say Hide / Hidden / Unhide; the column
  is still `crm_companies.archived_at` (+ reason, by). A hidden brand is out
  of the directory (Brand Explorer, hub counts, search, client brand pages
  via `isClientVisibleBrand`, `storage.getCrmCompanies` and the raw queries
  in `server/crm.ts`) but keeps its row, deals and tenancies.
  `server/brand-relevance.ts` holds the keep-signals (ids and names on
  schedules, offers, target lists and briefs) and the admin preview → hide →
  unhide routes (`/api/admin/brand-relevance*`). Hide and Delete refuse to
  run when any signal could not be checked. Apply also brings back brands an
  earlier sweep hid that have since gained a signal; brands hidden by hand
  stay hidden. Re-adding a hidden brand (staff create or client add-brand)
  unhides the old record instead of making a duplicate. **Delete for good**
  is admin-only and takes only hidden brands nothing points at (no signal, no
  contacts, no property link, no KYC file, no history). Add a new "this
  brand matters" source as a signal there, never by hand-editing archived_at.
- **CRM plan for brands**: the landlord plan (`server/crm-engagement.ts`) now
  accepts tenant brands as plan companies (`PLAN_COMPANY_PREDICATE`). A
  client login on a brand in its slice can add actions for a BGP owner and
  sees only the actions its own company raised (`clientPlanView`,
  `clientOwnActionIds`): no strategies, no events, no BGP actions or notes,
  and its form lists that one brand and no contacts (review, 2026-11-12:
  the shared plan showed clients each other's actions). Showing a BGP item
  to one client needs an explicit per-record share marker, which is not
  built. `LandlordEngagementPanel`
  with `kind="brand"` is the card on brand pages (desktop Relationship
  section, phone Overview). Strategies and events stay BGP-only to write.
- The brand profile's section pills show one section at a time on every
  screen (`panelSec` in `brand-profile-panel.tsx`).

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

## Targeting Brief workspace (Woody, 2026-11-12)

One Targeting Brief per Letting Tracker unit, across the whole app and every
client including Landsec. `shared/unit-brief.ts` (types, the commercials
field list, money parsing, the sign-off rule), `server/unit-brief-workspace.ts`
(routes), migration 0050 (`unit_briefs` + commercials, agency_basis, plan_ids,
brochure_ids, version, agreed_at; `unit_brief_people`; `unit_brief_comments`),
client `unit-brief-dialog.tsx` + `components/unit-brief/*`.

- **Add brief** at the top of the tracker (`POST /api/unit-briefs/start`)
  puts the unit on the tracker through the letting service (so it gets its
  deal and Ref #) and starts its brief; a unit already listed is reused and
  so is its brief. For a client login this is how units are added. One brief
  per unit: a second create hands back the existing one. The unit is picked
  from the property's tenancy schedule (or typed, which adds it there), and
  the brief shows its tenancy row. The brief follows its unit: moving the
  unit to another property moves the brief (`moveBriefsToProperty`), and
  deleting the unit deletes the brief with its people, comments and targets.
- **People involved**: BGP agents, a joint agent (firm from the CRM's agent
  companies, or typed), the client's leasing team, a senior asset manager and
  the asset manager for the scheme. Sole or joint is `agency_basis`.
- **Sign-off**: every person involved presses Agree brief; the date is kept.
  A person agrees as themselves (their login, matched by user id or email).
  BGP staff may record an agreement for someone with no login, and the brief
  says who recorded it. A change to the brief's terms (the text fields, the
  commercials, the agency basis) raises `version`; a signature on an earlier
  version no longer counts and the timeline says so. `agreed_at` is set only
  while everyone has agreed the current version AND the brief has at least
  one BGP agent and one person on the client side (one side cannot agree it
  alone by removing the other). A BGP agent is a BGP staff login picked from
  the list, added and removed only by BGP. A person with a login agrees for
  themselves; staff record an agreement only for someone with no login.
  Names and emails come from the login or CRM record, never from the form. Never let a request write
  version, agreed_at, unit or property: `saveBriefFields` is the one write
  door for a brief's fields.
- **Comments**: each person's own, labelled with what they are on the brief
  and the date; AI help drafts a comment for the person to edit and save,
  never saves by itself. The app's own lines (agreed, terms changed, person
  added) sit in the same timeline as `kind = 'event'`.
- **Access** is `briefAccess()`: BGP staff everywhere; a client login on its
  own properties; a Landsec asset manager or joint agent on their own schemes
  only (the restricted gateway lets them reach `/api/unit-briefs*` and the
  unit's brief and files, and every handler checks the scheme). A joint agent
  reads, comments and agrees, but does not change the brief, people, targets
  or files, and never receives BGP's notes on the targets.
- The quoting rent, service charge and rates on the brief are written through
  to the tracker row. The Landsec unit page opens the same brief. The older
  two-signature "Agreed brief" card on that page (`landsec_units.brief_*`)
  is still there and still feeds the NER floor check: retiring it in favour
  of this brief is Woody's call.

## Offer to Solicitors on the Letting Tracker (Woody, 2026-11-12)

The run from a first offer to solicitors is three linked pieces on a unit.
Migrations 0051 to 0053. All access goes through `briefAccess()`.

- **Negotiation log** (`shared/unit-negotiation.ts`, `server/unit-negotiation.ts`,
  `components/unit-negotiation/*`): `unit_offers` is a bid's CURRENT position,
  `unit_offer_rounds` every position it has been through (tenant offer,
  landlord counter). The newest round always equals the offer row. Status is
  Pending, Negotiating, Agreed, Rejected or Withdrawn ("Accepted" on old rows
  reads as Agreed) and changes ONLY through `POST /api/unit-offers/:id/status`;
  the offer create and edit routes ignore a status in the body. One agreed
  offer per unit.
- **Heads of Terms flow** (`shared/unit-hots.ts`, `server/unit-hots.ts`,
  `components/unit-hots/*`): standard first (the property's
  `hots_template`), generate from the agreed offer, amend (each amendment
  raises `hots_version` and earlier signatures stop counting), sign-off by
  the people on the unit's Targeting Brief, issue (BGP; moves the unit to
  HOT through the gate and mirror; sends nothing), final upload (BGP), convert
  to Solicitors (BGP; terms onto the deal through `updateDeal`, SOL through
  `dealStatusTransitionDenial` and `mirrorFromAvailableUnit`, never past the
  MLRO-rejected block). The old `PUT /api/available-units/:id/hots` and
  `/hots/populate` are closed (410): do not reopen them, they wrote the text
  with no version or sign-off.
- **Scheme forms** (`shared/hots-standards.ts`): Landsec's own HOTs for
  Bluewater, St David's, Trinity Leeds and White Rose, as Woody sent them.
  Create standard HOTs uses the scheme's form by property name, BGP's 37
  clauses otherwise. These mark blanks with `[ ]` or `XXXX`, not `{TOKENS}`:
  `fillSchemeHots` fills only what it can place with certainty, never deletes
  an OR alternative, and names what it could not place in the HOTs history.
  A new scheme form is one more entry in `SCHEME_HOTS_STANDARDS` plus a test.
- **Fee split between the agents** (Woody: "fee splits need to be for joint
  or sole agent ... include the joint agents for their own benefit and for
  clarity with Landsec"): `unit_briefs.joint_agent_fee_pct` (copied to
  `crm_deals`), set on the brief's People tab through
  `PUT /api/unit-briefs/:id/agent-fee-split`; `agentFeeSplitText()` words it.
  Everyone on the brief sees it, the joint agent included; a joint agent
  cannot change it. BGP's internal split (BGP House, who at BGP earns what)
  is for BGP staff only, on the deal page: never show it or its wording to a
  client login or on a Landsec unit's form.
- **Share with a brand** (`server/unit-share.ts`, `unit-share-dialog.tsx`,
  BGP staff only): a tick list, then one PDF or an Outlook DRAFT (never a
  send). What a brand may be given is an allow-list in that file. Never add
  the fee, the NER floor, ERV, the maximum incentives, offers, viewings,
  comments, the Targeting Brief or heads of terms to it. The draft needs the
  Mail.ReadWrite application permission and has not been run against
  Microsoft; it falls back to the PDF and a mailto link.
- **Deal checklist** (`shared/deal-checklist.ts`, `server/deal-checklist.ts`,
  `components/deal-checklist/*`, migration 0052): one per unit and its
  current deal, items by stage, each with one responsible person from BGP,
  the client or a joint agent, plus one person responsible for the deal.
  Making someone responsible creates a `user_tasks` row (marked
  `source = 'deal_checklist'`) and emails them; the task and the item tick
  each other (`syncChecklistItemFromTask` from `PATCH /api/tasks/:id`). Only
  tasks with that marker are ever deleted by the feature. Opening a checklist
  never emails anyone. It is NOT a gate on status changes (Woody has not
  asked for one). There is ONE standard list for every client, modelled on
  the client checklist Woody pasted and rewritten in BGP's words (Woody,
  2026-11-12: "change it so it's not exactly the same"): never paste a
  client's own checklist in word for word. `{CLIENT}` in an item becomes the
  landlord's name when the checklist starts.
- **Against the brief** (`shared/brief-progress.ts`, the tracker's success
  monitor column): a fixed ladder of steps worked out from the brief, the
  viewings, the offers and the deal status. Nothing is typed. Add a step
  there, with a test, never in the cell.

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

## The old site, brucegillinghampollard.com (WordPress, until bgp.uk.com launches)

Still the live public site. WordPress 7 on a cPanel host that drops about
one connection in three, so every request needs retries. Theme is
`bgp-child` (Bibliothèque, 2020), ACF PRO 5.8 (no ACF REST support), Classic
Editor. Woody's rule (2026-10-27): **no structural changes**; content only.

- **Access**: REST with an application password for the admin user
  `CaraMilligan`, kept in the Claude environment settings as
  `BGP_WP_APP_PASSWORD` (also on Railway for the sync). Never in the repo
  or chat.
- **BGP Tracker Bridge plugin** (`docs/wordpress-bgp-tracker-bridge.php`
  is the copy of record; installed via Plugins → Add New → Upload): exposes
  `listings`, `project` and their taxonomies over REST, plus
  `GET/POST /wp-json/bgp/v1/acf/<post_id>` (raw ACF values by field key),
  `GET /wp-json/bgp/v1/acf-schema/<post_id>` and
  `GET /wp-json/bgp/v1/acf-bulk/<post_type>`. Edit any ACF content through
  these rather than the admin forms.
- **Listings follow the tracker**: `server/wp-listings-sync.ts` reads this
  app's own `/api/public/leasing-listings` feed hourly and creates /
  updates / drafts WordPress `listings` posts (meta `bgp_unit_id`), uploads
  photos and brochures to the media library once (`bgp-unit-<fileId>`), and
  never touches the team's hand-made listings unless an admin POSTs
  `/api/admin/wp-listings-sync?retireLegacy=1`. Status at
  `GET /api/admin/wp-listings-sync`.
- Header (menu across the top, title hidden on desktop) is Additional CSS
  in the Customizer, nothing in the theme. Home story blocks, Recent
  Projects, the Contact team list (from HR) and the meta description were
  refreshed from the new site's content on 2026-10-27.

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
