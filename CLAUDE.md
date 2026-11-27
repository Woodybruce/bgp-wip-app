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
- **The build sets its own memory limit** (`"build"` in `package.json`:
  `--max-old-space-size=4096`, ahead of any `NODE_OPTIONS` the caller set, so
  a caller's own figure still wins). The client build needs about 2.5 GB of
  heap (it failed at 2304 MB and passed at 2560 MB on 18 November 2026) and
  died with "JavaScript heap out of memory" wherever Node's default was
  about 2 GB. The whole build peaks at about 3.9 GB of memory whether the
  limit is 4096 or 8192, so the limit asks for no more than a passing build
  already used. The in-app deploy builds inside the live container
  (`server/auto-deploy.ts`); Railway's memory size was not checked.
- **`npm run qa:regression` is the deploy gate** (`.github/workflows/auto-deploy.yml`):
  a red run skips the build, the smoke suites and the deploy job. Run it
  before pushing. Many of its tests cut one function or route out of the
  source and run it with a fixed list of bindings
  (`qa/regression/source-harness.cjs`), so code that gains an import, a
  helper or a module-level constant needs the binding added to its test in
  the same commit; the failure reads `X is not defined`, or a 500 where 200
  is expected. It failed on every push from at least 25 September to
  13 November 2026, so nothing after it ran, and 67 tests fell behind.
  The tests that need PostgreSQL are listed in `qa/regression/README.md`:
  skipped locally unless their variable is set, all run by the workflow.
  The two smoke suites run after it (`qa/smoke.mjs`,
  `qa/phone-session-smoke.mjs`; `bash qa/run-smoke.sh` runs the first
  locally): a change to where a login lands, to a menu, to a test id or to
  what Back does needs their checks changed with it. The phone suite failed
  on every push from 13 to 15 November 2026 because its property scenario
  still waited for the simple view after the plan-led page became the staff
  default; it now follows the plan-led page first and reaches the older
  page from More → Back to the current page. The staff smoke check failed
  on 16 and 17 November 2026 (runs 1988 and 2004) with a 504 from
  `/api/property-lookup` (Bluewater, DA9 9ST): public sources called with no
  time limit (Land Registry price paid, postcodes.io, flood, listed
  buildings) ran past the 45 second request limit. Every outside call in
  `server/property-lookup.ts` now has its own limit and a failed price paid
  read is not cached; `qa/regression/property-lookup-timeouts.test.mjs`
  fails on a new call without one. To run it locally: `bash
  qa/start-postgres.sh`, restore `qa/smoke-fixture.sql.gz` into a database
  named `bgpsmoke`, `npm run build`, start `node dist/index.cjs` on it, then
  `SMOKE_CHROMIUM=/opt/pw-browsers/chromium SMOKE_BASE=http://localhost:<port>
  PHONE_SMOKE_DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:5432/bgpsmoke
  node qa/phone-session-smoke.mjs`.
- **`npm test` is the wider unit suite and is not part of the deploy gate**,
  so it can go stale unseen: on 15 November 2026 ten of its tests had been
  failing since the joint agent and scheme-limit changes of 14 November
  (their assertions still held the 13 November rules) and because two files
  could not load without a database address. Run it with the regression
  suite. A test whose imports reach `./db` starts with
  `import "./test-database-url";` (nothing connects; a test that needs a
  real database names its own variable and skips without it).
- **A red workflow does not keep a push off the live site** (seen on
  15 November 2026: two pushes reached chatbgp.app within about ten minutes
  while the run was red and its `deploy` job was skipped, so Railway is
  building the branch on each push by itself; its settings were not
  inspected). The workflow's `deploy` job is the in-app deploy of the tested
  commit (`server/auto-deploy.ts`). Treat a green run as the check that the
  push was safe, not as what stops it: run `npm run qa:regression` and the
  two smoke suites BEFORE pushing. Whether Railway should wait for the
  workflow is Woody's call.

## Landsec client brand access (DECIDED — do not re-litigate in merges)

**Superseded on 14 November 2026** (Woody: "let clients full access to the
brands regardless of anything"; commit 2e4cc81c, "Client logins see every
brand, whatever its category"): `isClientVisibleBrand` and
`clientBrandSliceSql` in `server/company-scope.ts` now pass any company whose
type starts "Tenant", as well as the categories and self-adds below. A client
login, Landsec included, sees retail brands too, which also covers the
retail at the four London schemes in Landsec's H&L agency brief (October
2026). Do not put the category slice back in a merge. A joint agent still
has no brand pages (see the Landsec sections below). The rest of this
section is the earlier rule, kept for its history.

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

## Landsec's brief categories (Woody, 2026-11-16)

Landsec's Hospitality & Leisure agency brief (October 2026, the pitch brief
Woody sent) names the categories the instruction covers. Asked how the app
should reflect them, Woody answered "go ahead with the catagories", "2 yes"
(only the Landsec view uses the brief's groups; BGP's own Brands groups gain
the new types) and "3 ignore" (the fee stays as it is: the brief pays 10% of
NER sole and 7.5% joint, and nothing works a fee from NER). Do not
re-litigate.

- **The categories and the map** are `shared/landsec.ts`:
  `LANDSEC_CATEGORIES` (key, label, group, the agreed brief's label), the
  groups Hospitality, Leisure, Cinema & entertainment and London retail
  (the agreed brief still says "Retail (London schemes)", so stored rows
  read), `LANDSEC_CATEGORY_TYPES` (every company type, imported variants
  included, by category) and `landsecCategoryOf(companyType)`: null for a
  company that is not a tenant brand, "other" for a tenant type that names
  no category (a bare "Tenant", "Tenant - Leisure"), words read for a type
  the lists do not hold. A brand's category is READ from its type, never
  stored. `LANDSEC_BRIEF_CATEGORIES` (the agreed brief's list) holds all
  ten; the stored labels did not change, so old rows still read.
- **New company types**: Food Hall, Competitive Socialising, Active Leisure,
  Soft Play, Theme & Water Park, in `TENANT_CATEGORIES`,
  `CLIENT_CRM_CATEGORIES` (they are hospitality and leisure, so every test
  that reads "hospitality, leisure or fitness" takes them) and the type
  picker (`client/src/lib/crm-options.ts`, with a colour each). The three
  lists are held in step by `qa/regression/landsec-categories.test.mjs`.
- **Where they show** (the Landsec view, `useIsLandsecView()`, unless said):
  Brand Explorer's cards (`LANDSEC_BRAND_CATEGORIES` in `brands-hub.tsx`, a
  group matched by `landsecCategoryOf` through `landsecKey`; BGP's
  `BRAND_CATEGORIES` gained Food Halls, Competitive Socialising, Active
  Leisure and Theme & Water Parks); the client Brand Directory's Category
  filter (`client-brand-list.tsx`, Landsec only); Brand gap's Targets
  (`brand-gap-panel.tsx`: the category under each brand and a Category
  filter, read from `company_type`, which the target rows now carry: the
  route itself gained no import, because `qa/regression/scheme-positioning.test.mjs`
  runs it with a fixed module list); the Brand CRM Targets board, for every
  viewer because it is Landsec's schemes (`category` on `BrandGridBrand`,
  set in `brandGrid`); the Targeting Brief's Priority categories and its AI
  draft at a Landsec scheme (property name matches a scheme AND Landsec is
  the landlord, the Heads of Terms forms' test; `landsecScheme` on the
  workspace's unit; a name with a comma is read whole, `splitCategories`).
- **Trading units by brief category** on Properties → Schemes
  (`CategoryMixTable` in `scheme-cards.tsx`): `categoryMix` on each scheme
  of `GET /api/landsec/home`, from `categoryMixByProperty` in
  `server/landsec-home.ts`: tenancy schedule rows read as occupied by
  `unitOccupancy`, archived rows left out, the category of the row's brand
  as the property page's unit feed gives it (the stored brand, else the one
  brand its trading or lease name matches: the same `BRAND_KEYS_CTE` join as
  `server/property-units.ts`, held in step by the test; the caption says how
  many were found by name). A trading row with neither is "No brand". A
  failed read leaves the table out.
- **Sort categories** (admins, beside Ownership intel on Brand Explorer;
  `client/src/components/brand-retype.tsx`, `server/brand-retype.ts`, rules
  in `shared/brand-retype.ts`): for brands on a catch-all type
  (`CATCH_ALL_TENANT_TYPES`: Tenant, Leisure, Experiential, Entertainment,
  Gaming, Family Entertainment, Restaurant, F&B, Food & Drink; never retail,
  never a type a person chose), a type suggested from the name, then the
  description and industry, only where it moves the brand to another
  category. Rules only, no AI, never at boot or on a timer. Apply changes a
  ticked brand only while it still holds the type the preview read (one
  UPDATE); the batch is kept in `system_settings.brand_retype_last`, and
  Undo puts back a brand still on the type it was given, once. Tests:
  `qa/regression/brand-retype.test.mjs`. It has not been run on the live
  directory: the first preview is an admin's.
- Not built: a category on a unit (joint agent logins cut by category, the
  leisure consultant's cinema and immersive remit); fees from NER; counting
  Landsec's in-house lettings for the fee forecast; the inclusive costs in
  Landsec's NER definition; Landsec's new Portfolio Leasing / asset leasing
  split on the deal clock.

## Landsec pitch build (Woody, 2026-11-11) — docs/landsec-pitch-plan.md

Landsec is re-tendering its Hospitality & Leisure leasing instruction (14
schemes; pitches w/c 23 and 30 November 2026). Woody approved a build plan on
2026-11-11: one Landsec workspace with a single unit page, a brief agreed by
both the Landsec leasing manager and the asset manager, a deal clock with
"waiting on", a brand case (Jersey Mike's first), logins by role and scheme,
and an AI lock-down for Landsec data (removed 13 November 2026). **Read `docs/landsec-pitch-plan.md`
before touching any Landsec surface** — it has the build order, the problem
list from the team, the live-data findings and the sources to import.

The 14 schemes are a code registry, `server/landsec-schemes.ts` (name
matchers, groups); the Landsec home, client property list, portfolio
endpoint and analytics all read it. Add a scheme there, never by hand-
listing property ids elsewhere. Every Landsec workspace route resolves the
caller with `landsecViewer()` in `server/landsec-access.ts` (role + scheme
set); the Landsec tables are all in migration 0049 and `shared/schema.ts`
(`landsec_*`), and the shared constants and NER maths in `shared/landsec.ts`.

The deal clock is drawn from one file,
`client/src/components/landsec/deal-clock.tsx` (stage chip, days at stage,
waiting on, depends on, Net Effective Rent, brief check), fed by
`GET /api/landsec/deals`. For a Landsec viewer the Deals page, its board and
phone cards and the Letting Tracker join that feed by deal id
(`docs/landsec-menu-plan-2026-11-12.md`, part 4); the unit page and the older
Lettings page use the same components. The deal page draws the same pieces
for every letting, whoever views it, from its own read (`clockForDeal`,
`GET /api/crm/deals/:id/page`; see "The deal page" below). Stuck is Negotiating, HOTs or
Solicitors for 30 days, never Marketing (`landsecIsStuck`); with no rent free
or capital recorded there is no pass or fail (`landsecBriefCheck`); a deal
the viewer cannot see is "another deal" (`dependsOnFor`). Change a rule
there, with a test in `server/landsec-deal-clock.test.ts`, never on a screen.
Stuck is counted one way: every open deal in negotiation on the scheme
properties, a letting or not, both in the clock feed (the Deals pill) and in
`landsecCounts` (the Properties pill and the scheme cards). The stage pills
on Properties are live lettings only, and say so in their tooltips; the
Deals status cards and the tracker pills still count their own lists (all
deals; tracker rows), so those three agree only when the data does. A
Properties pill's link (`?status=` or `?clock=`) is the whole Deals filter
(`dealListSeed` in `shared/landsec-menu.ts`): never read one filter from the
address and the rest from the session. Where the clock strip shows on the
deal page it carries the only Net Effective Rent.
Since 14 November 2026 a joint agent opens the deal and property pages at
its own schemes (below), so the clock pieces link there for every Landsec
login. `linkDeals`, `dealHref` and `hrefFor` stay as switches for a screen
that has no page to link to.

**Days at stage and Last contact** (Woody, 2026-11-13: "they are there but
make no sense", then "fix them"). The date a deal reached its stage has one
rule, `shared/stage-since.ts` (`resolveStageSince`, tested in
`server/stage-since.test.ts`): a date a person set by hand, then the latest
status change in `deal_audit_log`, then the deal's own stage timestamp or
creation. It is **unconfirmed** when the status change shares its minute with
the status changes of 5 or more other deals (an import or bulk tidy-up) or
there is no status change at all. `stageSinceFor` in `server/landsec-unit.ts`
reads the facts in one pass; the clock feed, the unit page, the scheme unit
list and `landsecCounts` all go through the rule. An unconfirmed figure is
greyed (no question mark: Woody, 2026-11-13, "remove question marks looks
stupid"), its title says the date is not known, and it still counts as stuck: never hide a
stuck deal because its date is unconfirmed. The hand-set date is
`landsec_deal_clock.stage_since` (+ `stage_since_code`, `stage_since_by_name`;
migration 0059), written only by `PUT /api/landsec/deal/:id/clock`
(`stageSince`: yyyy-mm-dd, not in the future, not more than three years
before the deal was created, null clears it) with a `stage_since` line in the
deal's history. It applies only while the deal is at the stage it was set for
and its status has not changed since it was set. Whoever may write the clock
at the scheme may set it (the feed sends `canSetStage`). As first built on
13 November an asset manager could not; that was superseded the same day,
when Woody said "asset managers and leasing landsec should be the same": an
asset manager sets it as any full Landsec login does. The screens draw it from `DaysAtStage` / `DaysChip` in
`deal-clock.tsx` (press the figure for "At <stage> since"). Nothing is
back-filled. A status line written when a move was refused or skipped
("Approval rejected", "Blocked —", "Skipped —": `statusLineIsMoveSql`) is
not a move: it never restarts the days or cancels a hand-set date. The
phone deal cards outside the Landsec view read the same rule
(`stageDatesForDeals`, sent by `GET /api/crm/deals` as `statusChangedAt` +
`statusChangedConfirmed`), and the board cards and the scheme unit list pass
`stageConfirmed` to the chip: never keep a second copy of the rule in a
query. The Deals table's **Last contact** column (once "Last Touch",
`crm_deals.last_interaction`) and the deal page share
`shared/last-contact.ts`: a date ahead is "Next: 12 Feb", never a minus
figure, and sorts as the newest. The Deals list says where its date came
from (`lastContactAt` + `lastContactSource`): `read` is the app's reading of
emails and meetings, `event` the latest deal event, `edit` only the deal's
last edit, which is drawn as a quiet "No contact read yet" with the edit
date in its title and sorts as no date. The list never writes a fallback
into `lastInteraction` itself: the edit form saves that field back.

**Every Deals table cell opens its editor, filled or empty** (Woody,
2026-11-13: "can click empty spaces and add / edit"). An empty cell reads
"+ Add …" or a faint dash and opens the same editor as a filled one, through
the same save (the deal PUT, or the clock PUT); NER and "Not checked" open
the lease terms, Brief check opens the unit's `UnitBriefDialog`, Depends on
opens the Waiting on form. A closed deal shows its closing stage and date and
dashes with the reason in the title: never a waiting-on or a stage date for
it. A cell a login may not change is plain text: for a client login the
Client only (no bin; no Completed or Invoiced status; party pickers create
contacts and tenant brands only). **A client login and a joint agent change
the Team, the BGP Contact and the Instructed, Exchanged and Completed dates**
(Woody, 2026-11-15: "Landsec can change, as can joint agent"). Team and BGP
Contact are off by default: turn them on from Columns. A client picks BGP's
people from the names already on its deals (the fee split stays BGP's own,
so its editor is never opened for a client), and the server takes from a
client only a name already on the deal or an active BGP login
(`PUT /api/crm/deals/:id`, 400 otherwise). A joint agent is sent a deal's
team and BGP people (they came off `JOINT_AGENT_HIDDEN_DEAL_FIELDS`); the
fee and everything else on that list stay hidden. A
client's deal save never writes `poNumber` or `invoicedAt` (blanked for it by
`stripDealFees`) and moves a deal only to a property in its scope.

Properties carries what the Landsec home (Portfolio) had
(`docs/landsec-menu-plan-2026-11-12.md`, part 3). For a Landsec viewer the
Properties page opens on a "Schemes" view: the scheme cards, the stage pills
(each opens Deals at that stage) and, for BGP staff only, the "Landsec admin"
block (tracker against deals, duplicate-record merge, the outside-the-schemes
report as rows that are not links, logins by role). All of it is drawn from
`client/src/components/landsec/scheme-cards.tsx` and fed by
`GET /api/landsec/home`; the older Landsec home uses the same cards. The
scheme page is folded into the property page as a "Units and lettings"
section, drawn from `client/src/components/landsec/scheme-units.tsx` and fed
by `GET /api/landsec/scheme/by-property/:propertyId` (the same answer as
`/api/landsec/scheme/:key`, same scheme check); `?section=units` opens the
property page on it. The Landsec property list is cut to the 14 schemes on
the server (`GET /api/crm/properties`): do not add a landlord-name filter on
the screen again. BGP staff in the Landsec view whose session is not scoped
to Landsec (no team of their own, or their own team is Landsec) are sent the
whole BGP list, so `PropertiesList` cuts it to the scheme records the home
feed names for staff. "The Landsec view" is one test on every screen,
`useIsLandsecView()` (the brand), never `activeTeam === "Landsec"`. A joint
agent gets the same page with its own schemes only (14 November 2026).

**The Landsec menu (Woody, 2026-11-12) — docs/landsec-menu-plan-2026-11-12.md.**
Woody's decisions of 12 November 2026, in his words where he gave them:

- **Four entries on the side bar**: Properties, Deals, Letting Tracker,
  Brands ("The side bar should have Properties, deals and letting tracker";
  Brands stays).
- **Portfolio and Lettings are gone**, folded into Properties and Deals
  ("Portfolio is the same as properties. Lettings is the same as deals").
- **Ask is off the side bar** ("its in the chat function"), and **chat is
  open to all** ("everyone can use the chat function should be open to all").
- **Every login carries a list of properties, or ALL, and uses the real
  pages** ("each log in will be given a list of properties they work on or
  ALL. Everyone can have the same access to each properties the only
  difference is that we probably dont want to give the full brand list and
  detailed brand board to joint agents"): joint agents have no brand list and
  no brand board.
- **Tasks is on every Landsec menu** (Woody, 2026-11-13: "we need each
  person to have this update their own task list which was removed from the
  Landsec one for some reason lets combine it all make sure it all links and
  add to the side bar"). One page, `/landsec/tasks`
  (`client/src/pages/landsec-tasks.tsx`), for a full Landsec login or leasing
  manager, an asset manager and a joint agent, on the side bar and the phone
  tabs with the number of open tasks (`openTaskCount`). It leads with
  "Waiting on you" (the person's checklist tasks a deal's waiting-on points
  at), then To do, then Done. BGP staff viewing as Landsec get the same entry
  pointing at their own My Tasks, `/tasks` (`landsecTasksPath`). The side bar
  is five entries now: Properties, Deals, Letting Tracker, Tasks, Brands.

What is built (plan steps 1 to 4), for a **full Landsec login** (no role, a
leasing manager, or since 13 November 2026 an asset manager) and for **BGP
staff viewing as Landsec**:

- The addresses and the one rule for which entry is lit are in
  `shared/landsec-menu.ts` (`LANDSEC_MENU`, `landsecMenuActive`, tested in
  `server/landsec-menu.test.ts`); the desktop side bar (`LANDSEC_NAV`,
  `landsecNavFor` in `app-sidebar.tsx`) and the phone tabs
  (`mobile-bottom-nav.tsx`) both use it. What each login's menu holds, and
  who is redirected, is tested in `qa/regression/landsec-menu.test.mjs` (run
  with `--import tsx`; not in `npm test`). Properties `/deals/properties`,
  Deals `/deals`, Letting Tracker `/deals/letting`, Tasks `/landsec/tasks`
  (`/tasks` for staff viewing as Landsec), Brands `/brands`. Deals is
  never lit on the Properties or Letting Tracker addresses; Brands is lit on
  any `/brands` address; Tasks is lit on `/landsec/tasks` and `/tasks`, for
  every role (the rule owns that entry for a joint agent too). `DealsHub` hides its own tab row in the Landsec view.
- Phone tabs: Properties, Deals, Tracker, Tasks, Brands, Chat (`/messages`);
  the Tasks tab carries the number of open tasks. An asset manager has the
  same six (as first built on 13 November its tabs were Properties, Deals,
  Tasks, Brands, on the scheme-limited pages; superseded the same day). BGP
  staff viewing as Landsec on a phone have Home in place of Brands and keep
  the tile home at `/`, because that is where the banner out of the Landsec
  view is. Do not redirect staff on a phone away from `/`.
- **A full Landsec login opens on ChatBGP, on a phone and on a computer**
  (Woody, 2026-11-15, with a screenshot of the new-chat screen: "the phone
  can just open with this screen for landsec so it's like opening Claude";
  and "also should open on desktop instead of a dashboard"). Once a
  session, by the marker `bgp-chat-home-done` (the one BGP staff's phone
  open uses): the first `/` or `/home` goes to ChatBGP and any later one to
  Properties. On a phone it is the `landsecPhoneHome` effect in `App.tsx`
  (real Landsec client logins only; it goes to `/chatbgp?ask=1`, the
  new-chat screen, because a bare `/chatbgp` there is the Messages list);
  on a computer it is `LandsecOpening` under `Home` (`LANDSEC_MENU.chat`;
  the marker is read and set in an effect, never while rendering, because
  a render thrown away while the page loads used the marker up and sent
  the login to Properties). A joint agent still opens on Properties (its chat is its
  own page). On a computer the ChatBGP page has no side bar, so in the
  Landsec view its header carries the menu (`chatbgp-landsec-menu`) and its
  Back arrow goes to Properties when there is no earlier screen. The smoke
  suite expects a Landsec login to land on `/chatbgp`.
  **The Landsec phone tabs leave out the tab of the open page** (Woody,
  2026-11-15, the ChatBGP screen with its Chat tab circled: "remove the
  button the page is on from the icons as they are a bit crowded"):
  `shown` in `mobile-bottom-nav.tsx` drops the lit tab, so six show at a
  time, for every Landsec login and for staff viewing as Landsec. Other
  logins' tabs are unchanged. A phone test that presses a Landsec tab must
  not be on that tab's page. `/landsec/deals` goes to `/deals`, and
  `/landsec/scheme/:key` to the scheme's property page at `?section=units`
  (`LandsecDealsRoute`, `LandsecSchemeRoute`). Both redirect only in the
  Landsec view: BGP staff on All Teams or their own team keep the old scheme
  page and deal clock list (the Brand CRM links there, and their property and
  Deals pages have no Landsec sections). `/available` is not redirected:
  it is the tracker, and many links carry query strings to it. The Brand CRM,
  the brand case page and the diary still emit `/landsec/scheme/<key>` links,
  so that address must keep working.
- Chat for these logins is the ChatBGP rail on the right (desktop) and the
  Chat tab (phone). Brand cases are one "Brand cases" button at the top of
  Brands (`brands-hub.tsx`), never for a joint agent.
- `landsec-home.tsx`, `landsec-deals.tsx`, `landsec-scheme.tsx` and every
  `/api/landsec/*` endpoint stay: a joint agent still uses the pages, and
  the unit page, emails, Heads of Terms, the checklist, the
  recommendation and the Brand CRM link to them.

**An asset manager is a full Landsec login (Woody, 2026-11-13).** His words:
"asset managers should see everything the rest see so dont gate them";
"asset managers and leasing landsec should be the same"; asked which schemes,
"All 14, like leasing"; and "its just joint agents don't see our brand pages
thats it". This answers the question that was open on 12 November for asset
managers, and supersedes every earlier rule that limited one (own schemes
only, a separate front door, no ChatBGP, the 13 November brand-page limits).
The access review of the same day was written while an asset manager was
still a restricted role, so some of its notes below and in
`docs/landsec-pitch-review-2026-11-13.md` speak of "the two restricted
roles" or of a limit on an asset manager: each of those now reads "a joint
agent", and the asset manager is answered as a full Landsec login in that
place (every fix that review made for client logins and for joint agents
stands, and an asset manager is held to whatever it holds a full Landsec
login to).

- For ACCESS an asset manager is exactly a Landsec login with no role or a
  leasing manager: all 14 schemes whatever schemes are stored on the login,
  the five-entry menu and six phone tabs (Tasks included), the real
  Properties, Deals, Letting Tracker and Brands pages, brand pages in full,
  the Brand CRM, brand cases, the Tasks page (`/landsec/tasks`, with the
  ordinary client task routes behind it: it can add a task of its own), and
  the ChatBGP rail and Chat. It goes through the
  ordinary client gateway, brand slice included.
- The role is a LABEL: it says who the asset manager is on a Targeting Brief,
  on the older agreed brief (an asset manager login signs as the asset
  manager and a leasing manager login as the leasing manager, one rule,
  `landsecBriefSignerOnly` in `shared/landsec.ts`: the server refuses the
  other line and the unit page does not offer its button; a login with no
  role signs either. This is the one place an asset manager and a login with
  no role differ, and whether a role login should sign either line is
  Woody's call), on a brand case, on the recommendation, in the diary (BGP sees
  which asset managers have yet to answer a brand case) and in the admin's
  logins panel. The schemes on the login are "the schemes this person answers
  for": they limit nothing, and only decide where the login is OFFERED in the
  people pickers (a joint agent's brief picker, the checklist's Make
  responsible list). A login with none stored is offered everywhere, and an
  asset manager can be created with no scheme.
- The mechanism is one constant: `RESTRICTED_LANDSEC_ROLES` in
  `shared/landsec.ts` is `["joint_agent"]`. `landsecViewer` then gives an
  asset manager `schemes: null`, `restrictedLandsecApiDecision` gives null
  (the client gateway decides), and everything keyed on a scheme list
  (`viewerCanSeeScheme`, `schemeLimitedPropertyIds[OrNone]`,
  `briefSchemePropertyIds`, `dealListProperties`) stops applying. Never key a
  limit on `role === "asset_manager"`; `landsecPlanViewer` maps only a joint
  agent to its own kind.
- The scheme-limit code on the brand page and its companions
  (`server/brand-profile.ts`, `brand-profile-deals.ts`, `brand-ai-take.ts`,
  `brand-pack.ts`, `expansion-intel.ts`, `hunter-score.ts`, `crm.ts`, the
  company summaries in `routes.ts`) is left as a backstop that fails closed.
  No login reaches it today: a joint agent is refused those routes at the
  gateway.
- On the client nothing is keyed on the asset manager role either
  (`qa/regression/landsec-menu.test.mjs` pins it): `landsecNavFor` and the
  phone tabs name only the joint agent, `LANDSEC_RESTRICTED_ROUTES` in
  `App.tsx` holds only the joint agent's route jail, and `useLandsecRestricted`
  / `isRestrictedLandsecRole` / `landsecRestrictedRole` are true for a joint
  agent alone. `landsec-home.tsx`, `landsec-deals.tsx` and `landsec-scheme.tsx`
  are drawn for a joint agent (and the last two for BGP staff outside the
  Landsec view); an asset manager is redirected from all three as a full
  login is. On `/landsec/tracker` and `/landsec/viewings` an asset manager
  gets what a full login gets (on Viewings, a line pointing to the Letting
  Tracker), and `/landsec/tasks` is its Tasks page as it is every full
  Landsec login's. (The other build of 13 November had given an asset
  manager Tasks while keeping it on the scheme-limited Properties and Deals
  pages and off the tracker and viewings pages, "only the names changed".
  Superseded the same day by Woody's words above: the route guard and the
  menus no longer name the role.)
- Three things the other build of 13 November keyed on the asset manager
  role were turned round in the merge, because a full Landsec login has
  each of them: setting the date a deal reached its stage
  (`canSetStageSince` in `server/landsec-unit.ts`), reading a note into a
  letting form (`server/unit-note-reader.ts`), and the deal checklist link
  on a task or an email (the Letting Tracker, not the unit page). Comments
  not yet logged stay closed to it, as they are to every client login.
- The logins panel (`landsec-access-panel.tsx`) says so: an asset manager
  "sees all schemes, as Landsec leasing", its scheme ticks are labelled
  "Schemes this person answers for (optional: does not limit what they
  see)", and only a joint agent needs at least one scheme. A new login
  starts with NO role chosen and cannot be saved until one is picked (two of
  the three roles give the full view; do not default the form to one).
- Re-roling a joint agent login to asset manager or leasing manager gives
  that login the full Landsec view, so POST `/api/landsec/access` refuses it
  (400 `JOINT_AGENT_FULL_VIEW`, before anything is written) unless the
  request carries `confirmFullView: true`, which the panel sends only after
  the admin answers a confirm that says what the login will get. It is not
  refused outright because a deactivated joint agent login cannot be made
  again on the same email, so a login given the wrong role would have no
  way back. Whether to refuse it outright is Woody's call.

**Every login sees only its own schemes (Woody, 2026-11-14)**: "we need to
have log in for people from landsec with access only to their properties and
the same for joint agents. The only difference is the lack of access to the
brands page"; asked, "list or ALL" and "whole schemes". This SUPERSEDES "an
asset manager / leasing manager sees all 14 schemes" wherever it appears
below. The schemes ticked on a login limit what it sees; a Landsec login
with none ticked (or no role row) sees all; a joint agent always has a list
(`landsecLoginSchemes` in `shared/landsec.ts`, read by `landsecViewer`). On
14 November no live Landsec login had schemes ticked, so nobody's view
changed until an admin ticks them (logins panel: "Schemes this login sees").
Mechanism: an `/api` middleware in `server/index.ts`, ahead of the client
gateway, runs the request inside `runWithSchemeLimit` (`server/scheme-limit.ts`,
AsyncLocalStorage) with the login's scheme property ids (a failed read = none).
`isPropertyInScope` and `isDealInScope` answer no outside it (that covers
`checkPropertyAccess`, `clientBlockedForProperty` and ~110 call sites), and
every hand-written "client's properties" query adds `schemeLimitSql(column)`
or filters with `inSchemeLimit` (tracker list and aggregates, unit search,
search, map pins, company portfolio and its tasks, leasing schedule list,
CRM property link maps, comps, contacts' properties, brand suggestions,
client team board, contacts board, Image Studio, calendar insights, the
covenant gateway, ChatBGP's client guards, the brand page's pitched-to and
lease events). A new client query over the company's properties must do the
same. The whole-company activity feed is empty for a limited login (its
property feeds work), and the calendar shows it meetings at its schemes'
properties or ones it is invited to. Test: `qa/regression/scheme-limit.test.mjs`.
**A joint agent is a Landsec login at its schemes, less brand pages** (same
day, stage 3: "For joint agent"). `RESTRICTED_LANDSEC_ROLES` is now `[]`.
`restrictedLandsecApiDecision` for a joint agent: what
`restrictedLandsecApiRule` opened before stays open ("allow", its own
tracker, viewings, chat addresses one by one), `jointAgentApiDenied`
(`shared/landsec.ts`) refuses brand pages and the hub, company records,
contacts, the CRM plan, landlord records, brand cases, the correspondence
log, every other chat or ChatBGP door, the generated Targeting Brief, a
requirement from a viewing, deleting a unit, and since 17 November 2026
leasing requirements (the list, a row, add and edit, the requirements
centre, matching and brand suggestions) and the client Agents directory;
everything else goes to the
ordinary client checks, cut to its schemes by the middleware above. BGP's
own fields stay hidden from it on the real pages (`isJointAgentLogin` before
`withoutJointAgentFields`), and `briefAccess` still gives it `agentControl`
and no BGP notes. Client: its menu is Properties, Deals, Letting Tracker (its
own, `/landsec/tracker`), Calendar, Tasks, Brand CRM; phone tabs Properties,
Deals, Tracker, Tasks, CRM, Chat. `ClientRouteGuard` takes the ordinary
client routes and sends it away from `JOINT_AGENT_BLOCKED_ROUTES` (brands,
companies, contacts, brand cases). In the shell `landsecRestricted` means
"is a joint agent": its own chat stays (`JointAgentChat`, the locked
ChatBGP), and no global search. The deal page opens to it in full less the
Brand tab and brand profiles. Not yet: the full ChatBGP for a joint agent,
the staff Letting Tracker for it, and the user list
(`getClientVisibleUserIds`), which still lists people on all the company's
properties. `/api/dashboard/my-portfolio` is
refused to client logins (it matched deals by team, with fees).

**The only difference between the Landsec roles** (Woody, 2026-11-13: "its
just joint agents don't see our brand pages thats it"): a joint agent does
not see BGP's brand pages. A Landsec login with no role, a leasing manager
and an asset manager are the same for access. BGP's own records stay private
to BGP whatever the role: its brand contacts, its notes on target brands, its
email history, its fee and its internal split.

**A joint agent on the real pages** (Woody, 2026-11-14: "joint agent can do
anything other than see brands"; asked, he kept it to "its own schemes" and
kept BGP's records private: the fee and internal split, email history, BGP's
notes on target brands and the staff directory with emails). Its menu is
Properties (`/deals/properties`) and Deals (`/deals`), the real pages cut to
its schemes on the server, then Letting Tracker (its own,
`/landsec/tracker`: the staff tracker reads firm-wide lists and BGP's notes
on targets, so `/deals/letting` and `/available` send it there), Viewings,
Tasks and Brand CRM; phone tabs Properties, Deals, Tracker, Viewings, Tasks,
CRM, Chat (`JOINT_AGENT_MENU` in `shared/landsec-menu.ts`). No Brands.
- **Pages**: its route jail stays `/`, `/home`, `/landsec`,
  `/settings/profile`, plus `jointAgentRealPage` (Properties, Deals, the
  Deals list, one deal by id, one property by id). `/`, `/landsec/deals` and
  `/landsec/scheme/<key>` send it to the real pages as they do any Landsec
  login; `landsec-home.tsx` is no longer mounted.
- **Server**: the gateway opens, GET only, `/api/crm/properties` and one by
  id, `/api/crm/deals` and one by id, `/api/tenancy-schedule/property/:id`
  (and `/links`) and a property's plans, brochures and schemes list
  (`restrictedLandsecApiRule`, tested in `server/landsec-gateway.test.ts`).
  Each handler cuts to `schemeLimitedPropertyIdsOrNone` (a record off its
  schemes is a 403; a deal counts only on a scheme property) and sends the
  row through `withoutJointAgentFields` with
  `JOINT_AGENT_HIDDEN_PROPERTY_FIELDS` / `JOINT_AGENT_HIDDEN_DEAL_FIELDS`
  (`shared/landsec.ts`; tests `server/joint-agent-real-pages.test.ts`): no
  BGP notes, commentary, who covers it, contacts, comments, last contact,
  fee, invoicing, Xero or compliance. A new BGP-only column goes on the list.
  Every other address stays refused: no writes on those pages, no company
  list, contacts, property tasks, news, AI targets, brand gap or activity.
  Since 14 November 2026 the unit feed, one unit and a plan's match board are
  open to read (the plan-led page).
- **Screens**: read only. The property page (`jointAgent` in
  `property-detail.tsx`) leaves out Ask ChatBGP, the layout controls,
  weekly focus, news, risk register, brand gap, BGP commentary, research,
  files, contacts, compliance, activity, tagged conversations and the
  available units card. The deal page (`jointAgent` in `deal-detail.tsx`;
  rebuilt 18 November 2026, see "The deal page" below) leaves out Edit,
  Image Studio, Document, Delete, brand profiles, the property's folder and
  the change log (History); it reads the stage strip, the clock (and sets
  who the deal is waiting on, as at its tracker), the timeline less BGP's
  AML and invoicing lines, the negotiation, the checklist and its own
  tasks, the parties' names, the unit's files and the property's shared
  conversation cut to the deal. (Until then this line said files, comments
  and history were left out while the code showed them.) Deals has no New Deal, and an inline change says
  "read only" (`jointAgentDeals` in `deals.tsx`). Editing deals or the
  schedule from these pages is not built.
- Its chat is unchanged (the section "Chat for a joint agent" below), and its
  ChatBGP keeps its 14 read tools.

Decided (do not re-litigate): leasing managers and asset managers see all
schemes and are the same for access; joint agents see their own schemes
only; joint agents never see BGP's brand pages, brand contacts, email
history or fees. (A joint agent's "separate front door of workspace routes
rather than scheme checks retrofitted into the existing client view" was
superseded on 14 November 2026: it now reads the real Properties and Deals
pages, cut on the server by the scheme checks above.)
(Until 13 November 2026 this list read "asset managers and joint agents see
their own schemes only" and "asset managers see brand pages and the brand
case portfolio-wide but deals and figures only on their schemes", and the
question of moving both roles onto the real pages with chat was recorded
here as open. Woody answered it for asset managers on 13 November, in the
words at the top of this section; for joint agents it is as the paragraph
above says.)

**AI providers and Landsec data (Woody, 2026-11-13: "there is no anthropic
only rule").** He said this when asked whether the Brand gap's weekly
Perplexity read (scheme name, postcode, competing centres, brand names)
should be switched off for Landsec schemes. It stays on. This list used to
end "Landsec data goes to one AI provider (Anthropic) only"; he says there is
no such rule, so that line is withdrawn. The pitch plan's item 7, the
Landsec AI lock-down (`runLandsecLocked`, which pinned every request in the
Landsec view to Anthropic and refused the other providers), was REMOVED on
13 November 2026 when Woody answered "no lock down": a Landsec request uses
the same AI providers as any other. `qa/regression/landsec-no-ai-lock.test.mjs`
keeps it from coming back. Do not block, gate or remove a feature on the
grounds of an Anthropic-only rule. (Features that call Anthropic directly by
design, such as the note reader, are unchanged.)

**Joint agents: full control on their instructed schemes** (Woody,
2026-11-12: "Joint agents should have full control like us", "But only on
their instructed properties also they can't have access to the brand
pages"). On a unit at a scheme on their login a joint agent does every
letting action a BGP login does: the brief, targets and files, interest,
viewings, offers and the negotiation log, Heads of Terms through to
Solicitors, the deal checklist, the recommendation, Share with a brand, and
adding or editing a unit. Their pages are `/landsec/tracker`,
`/landsec/viewings` and `/landsec/tasks`, and since 14 November 2026 the
real Properties and Deals pages at their schemes; the staff tracker page is
not opened to them.

- **Stays closed to a joint agent**: brand pages and BGP's CRM (a brand's id
  and name in a picker is the limit); BGP's brand contacts; BGP's notes on
  target brands and the generated Targeting Brief document; BGP's email
  history, including a diary invitation's subject, body and guest list;
  BGP's fee and internal split, editing on the BGP deal page, the staff and client
  ChatBGP (it has its own locked-down one, below), search and the
  staff directory with emails; every scheme not on their login; deleting a
  unit, or a brief someone has signed; adding or removing BGP's own agents
  on a brief; making a CRM requirement from a viewing.
- **Mechanism**: `briefAccess()` gives `agentControl` (BGP staff, or a joint
  agent on their scheme) for ACTIONS and `seesBgpNotes` (false for a joint
  agent) for every redaction. `isStaff` is NEVER true for a joint agent: it
  skips the property check and opens BGP's own records. Their company scope
  is the whole Landsec company, so every handler must check the scheme
  (`briefAccess`, `briefSchemePropertyIds`, `assertUnitInClientScope`).
- **Gateway**: `restrictedLandsecApiRule` in `shared/landsec.ts` (called by
  `restrictedLandsecApiDecision`) is the full list of what a joint agent
  reaches (the only restricted role), tested in
  `server/landsec-gateway.test.ts`. Its answers `allow` and `deny` are
  final. (For a few hours on 13 November there was a third answer,
  `client`, for an asset manager's read under the brand prefixes, after the
  review found `allow` let an asset manager read a rival landlord's
  records. Superseded the same day: an asset manager is a full Landsec
  login, the rule is never asked for it, and every request it makes goes
  through the ordinary client checks, so it reads a brand address only
  where a full Landsec login can: its own company or a brand in the slice.
  `qa/regression/client-gateway-path.test.mjs` runs the real gateway as an
  asset manager and as a login with no role and expects the same answers.)
  Under `/api/config/` a joint agent reaches the maps key only. The two
  gates that judge an address against a list (the client gateway and the
  retired-AML switch in `server/index.ts`) read `routedApiPath(req)`, the
  path the router matches on, never text cut out of `req.originalUrl`: a
  `#` in the request line ends the path for the router and not for the
  text. Any new gate does the same (the rate limiters still read
  `req.originalUrl`, for a starts-with test only).
  `routedApiPath` gives the empty path, which no rule allows, when it
  cannot read the path or when its reading differs from the line as typed
  (below a mount a line with a `#` goes to a slower reader that turns `\`
  into `/` and takes `//user@host` for a host). And the first thing the
  app mounts, `refuseAmbiguousRequestLine` in `server/index.ts`, answers
  400 to any request line with a `#`, or a `\` in its path: no browser
  sends either, and with them gone a path is read one way. Keep both.
  `qa/regression/client-gateway-path.test.mjs` runs the real gateway source
  against those spellings. Every
  joint agent rule sits under `role === "joint_agent"`. Never open the unit
  list (`GET /api/available-units`), the `all-*` aggregates, a unit DELETE,
  `/api/leasing-viewings/:id/requirement` or
  `/api/unit-briefs/:id/generate-document` there. **Every login has a task
  list** (Woody, 2026-11-13: "we need each person to have this update their
  own task list"). For a joint agent `GET /api/tasks` and
  `PATCH /api/tasks/:id` are open and nothing else under `/api/tasks` is,
  and it is read and tick only (`restrictedLandsecTaskCaller` in
  `server/routes.ts`): its own tasks, at its own schemes, a tick or a reopen
  and no other change. A joint agent's task opens the checklist on its
  tracker. An asset manager has the ordinary client task routes, as a full
  Landsec login does (the other build of 13 November had given it the same
  read-and-tick list as a joint agent, with its checklist link on the
  Landsec unit page; superseded the same day): its task opens the checklist
  on the Letting Tracker. `restrictedTaskRow` still holds the unit-page
  branch for a scheme-limited login that is not a joint agent; no login
  reaches it today.
- **Taking a joint agent off**: removing a joint agent's Landsec role
  deactivates the login. It never falls back to the full Landsec view (a
  Landsec login with no role row sees all 14 schemes and the brand CRM).
- **People on a brief**: a joint agent can add to a brief only the people
  its own picker offers (the client-side people at that scheme, no emails).
  An id or email from anywhere else is refused, whatever the request sends.
- **The role read fails closed**: a failed read of the `landsec_access` row
  fails the request. Never catch it and carry on, because a login read as
  having no role is treated as a full Landsec client.
  A row whose role is not one of the three, spelt exactly, is refused the
  same way (`isKnownLandsecRole` in `shared/landsec.ts`; `getLandsecAccess`
  and `jointAgentByUserId` throw, and a conversation check counts such a
  login as a joint agent): the table has no check on the column, so a
  hand-written "joint-agent" must never read as a full Landsec login. A
  check constraint is a schema change and waits on Woody.
- **Chat for a joint agent** (Woody, 12 November 2026: "everyone can use
  the chat function should be open to all"; "its just joint agents don't see
  our brand pages thats it"; and on 13 November, asked whether to build
  "Chat for joint agents, which needs a locked-down ChatBGP first": "yes go
  ahead"). This supersedes "No ChatBGP on any screen" for a joint agent. A
  joint agent is another agency, so chat is cut the way its pages are, and
  it is its own small chat, never the staff chat panel. **Relaxed by Woody
  on 13 November 2026**: asked about the five things first built "the strict
  way" (who it may start a conversation with, ChatBGP in a conversation with
  it, two agencies in one conversation, a viewing's brand contact in its
  ChatBGP, a Landsec login's conversations in the computer's chat rail), he
  answered "Relax all of those"; asked whether ChatBGP should use the full
  staff toolset there, "Yes full use". Each is written into the bullets
  below. The lock is on the server, in four files:
  `shared/chat-joint-agent.ts` (what a tag may show; the two kinds of
  conversation), `server/chat-joint-agent.ts` (who it may talk to, who may
  be put in a conversation with it, what it is sent), the guard in
  `storage.addChatThreadMember`, and `server/chatbgp-joint-agent.ts` (its
  ChatBGP). Every read of the role in them fails closed.
  - **Messaging.** A joint agent holds two kinds of conversation and no
    other (`jointAgentThreadKind`): a conversation between people, **linked
    to no record, or to a property at its own schemes** (the property page's
    conversation, since 14 November 2026: Woody, "yes to the chat";
    `jointAgentLinkAllowed`, with the joint agent's `propertyIds` passed by
    every route; the create route makes it linked to that property with
    ChatBGP in it; with several joint agents in it the property must be at
    every one's schemes; never a deal, brand or channel), which may
    have ChatBGP in it (since 13 November 2026), and its own ChatBGP chat
    with nobody else in it. Anything else is not listed, read as 404, and
    cannot be posted to. It starts a conversation only with the people
    `chatPeopleFor` gives (`GET /api/landsec/chat/people`, names only, no
    emails): any active BGP staff login, the Landsec logins at its schemes,
    and the other joint agents of any firm (shown as "Name (Firm)"). Never
    another landlord's login or the staff directory with emails. (Until 13
    November 2026 it was the BGP people on the Landsec account and the
    Landsec logins at its schemes only, never another joint agent.) Members
    after a conversation is made, renaming, linking, search, the media
    drawer and group pictures stay closed at the gateway.
  - **Who may put it in a conversation** is one rule for every caller,
    `chatMemberDenial`, run inside `storage.addChatThreadMember` (the one
    door for a member row; do not write `chat_thread_members` beside it for
    a login you were handed) and before a conversation is made
    (`chatCreateDenial`, 409). With a joint agent in it a conversation holds
    only BGP staff, joint agents (of any firm, since 13 November 2026) and
    the Landsec people at each joint agent's schemes; it is never someone's
    ChatBGP chat and never linked to a record; and **a joint agent joins
    only before the first message** (the test is part of the insert). BGP
    staff who want a joint agent in a property's conversation start a plain
    one. With two agencies in one conversation each reader's view stays its
    own: every message, preview and notification is redacted for THAT
    reader (`allowSetsFor` for the reader, then `redactChatText`), so one
    agency's units and deals show to the other as "[another unit]".
  - **ChatBGP in a conversation with a joint agent in it** (Woody, 13
    November 2026: "Relax all of those", then "Yes full use"). BGP staff may
    add it (the member route, the thread's ChatBGP switch, or `@chatbgp`,
    which also works from a joint agent's post). Who ASKED decides how it
    answers, read from the posting request's own sign-in, never from the
    message or the body (`groupAnswerRunner` and `bgpStaffAsking` in
    `server/chat-joint-agent.ts`, the first statement of
    `triggerAiGroupResponse`):
    - **BGP staff asking** (signed in as themselves, not viewing as a
      client) get the ordinary group answer with their full tools and
      context, exactly as in a staff-only conversation. **The joint agent
      reads that answer**: whatever ChatBGP says there (fees, brand
      contacts, BGP's notes, emails) is shared with the other agency by the
      person who asked. The message itself is still redacted per reader
      for tags, but the words ChatBGP writes are plain words.
    - **The joint agent, or any client login, asking** (and anyone the
      staff test cannot confirm) get the joint agent's locked run,
      `answerAsJointAgents` in `server/routes.ts` →
      `runSharedJointAgentChat` in `server/chatbgp-joint-agent.ts`: its own
      prompt (`JOINT_AGENT_SHARED_PROMPT`), the allow-list tools less the
      task list, every address read AS a joint agent in the conversation
      through a short-lived sign-in made for that login and deleted after
      (never the asker's cookie or token), the earlier messages redacted as
      the joint agents read them, and no BGP context. With two or more
      joint agents it answers only about the schemes they ALL hold
      (`sharedJointAgentScope`): read as the one holding exactly those, or,
      when their sets cross, read as one of them with every list cut to the
      shared schemes and the lists that cannot be cut (Brand CRM, diary)
      not offered. Sharing no scheme, it posts one line saying it cannot
      answer there. A failed check of who is in the conversation gives no
      answer at all.
    Tests: `server/chatbgp-joint-agent.test.ts` (the runner chosen by who
    asked, the locked run's tools and sign-in, shared schemes, redaction),
    `qa/regression/joint-agent-chat-guards.test.mjs`, and
    `server/chat-joint-agent-postgres.test.ts`. Not relaxed: the automatic
    "Task done" line (`PATCH /api/tasks/:id`) is not written into a
    conversation with a joint agent (`NO_JOINT_AGENT_THREAD_SQL`), and such
    a conversation is never read for requirements. A new automatic line or
    reader over chat threads must skip them the same way.
  - **What it may tag and read.** It tags people in the conversation, units
    at its schemes and deals that are live there (`liveDealsAt`, the rule
    its Deals page lists by); a post or an EDIT with any other tag is
    refused (`postDenialForJointAgent`). What it reads is a projection,
    never the stored row (`threadForJointAgent`): every message, the list
    preview, the notification and the push go through `redactChatText` for
    that reader, so a tag for a brand, a contact, a property, a folder, a
    unit or deal off its schemes, or a person outside the conversation
    becomes "[a company]", "[a contact]", "[someone]" and so on, with no id
    and no name. The preview is redacted before it is cut. Plain typed words
    are not filtered. No action data, and only files from the chat store.
  - **Files.** It attaches only what it uploaded. It downloads its own
    upload, or a file somebody else posted in a conversation it holds; its
    own message naming a file is no entitlement.
  - **Sockets.** Its socket joins no conversation room and relays no typing
    (`noThreadRooms` in `server/websocket.ts`): it is sent the redacted
    notification and its screen reads over the API.
  - **Its ChatBGP is an allow-list**, not the client block-list
    (`CLIENT_BLOCKED_TOOLS` is not enough for another agency). The run is
    its own (`runJointAgentChat`): a fixed prompt, the login's own schemes
    as context, and exactly the 14 read tools in `JOINT_AGENT_TOOLS`. Each
    tool reads one address its own pages read, as that login (GET, this
    machine, an id checked against its schemes first), and **returns named
    fields only** (`projectFields`: a field not written in the tool's list
    never reaches the model, so never a fee, BGP's notes, an email, a phone
    number or a company id). The one brand contact field is the contact's
    NAME at a viewing in `ja_list_viewings` (`contactName`, named as
    `SHOWN_NAME`; Woody, 13 November 2026), because the joint agent's own
    Viewings page (`GET /api/leasing-viewings`) shows it; the unit tool's
    viewing lines stay without it, as that page blanks it. Every other tool name is refused in
    all three executors (`jointAgentToolGate`, the first statement of
    `executeAnyTool`, `executeCrmToolRaw` and `handleCrmToolCall`, ahead of
    the server-originated bypass), which also closes the email-instruction
    and WhatsApp paths for that login. No write tool, no SQL, no CRM, brand,
    contact, email, web, file, document, memory or thread-search tool, no
    file to ChatBGP, no model slash command. `POST /api/chatbgp/chat`
    decides a joint agent first, before the AI key: only in its own ChatBGP
    chat, else 403. **A new tool for a joint agent is one more entry in
    `TOOLS` there with a test, never a name taken off a block-list**, and
    nothing about other schemes, BGP's CRM, fees or notes is ever put in its
    prompt, because anything in the prompt can be asked for. The provider
    follows the rule above ("there is no anthropic only rule"): nothing is
    gated on it.
  - **An existing Landsec login with conversations cannot be made a joint
    agent** (400 `JOINT_AGENT_HAS_CHATS`, `POST /api/landsec/access`): its
    old ChatBGP answers came from the whole account. Make a new login.
  - The gateway rows are opened one address at a time, by method, under
    `role === "joint_agent"` (never a `/api/chat` or `/api/chatbgp`
    prefix). Tests: `shared/chat-joint-agent.test.ts`,
    `server/chatbgp-joint-agent.test.ts`, `server/landsec-gateway.test.ts`,
    `qa/regression/joint-agent-chat-guards.test.mjs`, and
    `server/chat-joint-agent-postgres.test.ts` (needs the local fixture
    logins: `RUN_JA_CHAT_POSTGRES=1`).
  - **The screens** are one component,
    `client/src/components/landsec/joint-agent-chat.tsx`: the **Chat** rail
    on a computer (`App.tsx`, in the place of the staff panel, which is
    never mounted for a joint agent), the seventh phone tab **Chat**
    (`mobile-bottom-nav.tsx`, with the unread count) and the page
    `/landsec/chat` (`landsec-chat.tsx`), where a notification's
    `?thread=` opens its conversation. `/chatbgp` and `/messages` go there
    for a joint agent. Its side bar is unchanged. Two pills: Messages (the
    list, **New conversation** from the server's people list, "@" for
    people in the conversation and its own units and live deals, a file, Edit
    and Delete on its own message) and ChatBGP (its own chats, one line
    saying what it answers from, the bin on its own ChatBGP chat only). It
    reads over the API every few seconds and treats the socket's
    notification as a nudge. A unit tag opens `/landsec/tracker?unit=`, a
    deal tag `/landsec/deals`, a person is plain text: never `tagPath`, the
    staff markdown or the staff panel. It calls only the addresses the
    gateway opens and offers no control the server refuses
    (`qa/regression/landsec-menu.test.mjs` pins both). A new control there
    needs its gateway row first.
  - **An upload is never run as a page** (`GET /api/chat-media/:filename`,
    every login): `X-Content-Type-Options: nosniff` always, and anything
    that is not a plain image, video, audio or plain text file (HTML, SVG,
    XML, an unknown type) is sent as a download in a sandbox
    (`uploadShownInline` in `server/utils/http-headers.ts`, tested in
    `qa/regression/auth.cjs`). An outside agency can upload here and BGP
    staff open what they are sent.
  - **A Landsec login's conversations on a computer** (Woody, 13 November
    2026): the chat rail (`chat-panel.tsx`) lists a client login's
    conversations with people and their unread count, as the phone's
    Messages tab does (`/api/chat/threads` lists only the threads the
    caller created or is a member of). It offers a client only what the
    client gateway allows: New message, sending, editing and deleting its
    own messages, the media drawer. Adding people (`/members`, refused by
    `CLIENT_BLOCKED_SUBPATHS`) and linking a property are not offered to a
    client; tagging a person or @ChatBGP leaves the adding to the server on
    send.
  - **Not built**: any ChatBGP write tool, file, web search or model choice
    for a joint agent; chat search, renaming, adding or removing people
    after a conversation is made, group pictures, the media drawer; live
    message, typing and seen events (the screen polls). The unread count
    can include a conversation since hidden from it (a count only). ChatBGP
    has not been asked a real question as a joint agent, nor in a
    conversation with one, against Anthropic: the lock is proved at the
    executor, the runner choice and the prompt builder.
  - Waiting on Woody: whether an old login's conversations should be
    removed so it can be re-roled.

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
- **Select and Delete on Brand Explorer** (Woody, 2026-11-19: "On the brands
  lists / logo icons can you put a select and delete button so I can bulk
  delete them"). Admins have **Select** beside Tidy brands (not under
  Hidden): a card then ticks instead of opening the brand, and a bar over
  the grid has Select all (at most 500), Clear, **Delete** (type the number
  to confirm) and Done (`BrandSelectBar` in
  `client/src/components/brand-tidy.tsx`). `POST
  /api/admin/brand-relevance/bulk-delete` (admin only; `bulkDeletePlan`,
  `brandTies` in `server/brand-relevance.ts`) runs every signal again and
  refuses if any cannot be checked; a ticked brand that no other record
  points at is deleted for good (`storage.deleteCrmCompany`), live or
  hidden; one that something points at is hidden instead ("Hidden by
  hand") and the reply names what it is tied to; one already hidden stays
  hidden. Being new or flagged (`HAND_DELETE_IGNORES`: added in the last 90
  days, the Super Brand star or a pipeline stage) keeps a brand from the
  sweep but not from a person's own choice. The `merged` signal (another
  record merged into it) was added the same day and also blocks the Hidden
  list's Delete for good. Test: `qa/regression/brand-crm-guards.test.mjs`.
- **CRM plan for brands**: the planning records (`server/crm-engagement.ts`)
  take tenant brands as plan companies (`PLAN_COMPANY_PREDICATE`), and since
  2026-11-12 they are read as two separate views: the Landlord CRM
  (`kind=landlord`) and the Brand CRM (`kind=brand`, see the next section).
  A client login on a brand in its slice can add actions for a BGP owner and
  sees only the actions its own company raised (`clientPlanView`,
  `clientOwnActionIds`): no strategies, no events, no BGP notes, and its
  form lists that one brand and no contacts (review, 2026-11-12: the shared
  plan showed clients each other's actions). A BGP action reaches one client
  only through its share marker
  (`crm_engagement_actions.shared_with_company_id`, set by BGP staff on a
  brand action BGP raised; Woody approved the action fields on 2026-11-12):
  that client is sent the title, due date, owner name, status, scheme and
  unit, never the notes or who it waits on (`checkedActionPlan`,
  `clientPlanView`). A joint agent cannot reach `/api/crm/engagement` at all
  (the restricted gateway): a shared action reaches it only through the
  Brand CRM plan and diary, and only when it sits at one of its schemes. An
  asset manager has the ordinary client view of the plan. `LandlordEngagementPanel` with
  `kind="brand"` is the card on brand pages (Overview, on desktop and
  phone). Strategies and events are BGP-only, to read and to write.
- The brand profile's section pills show one section at a time on every
  screen (`panelSec` in `brand-profile-panel.tsx`).
- **Brand page layout** (Woody, 2026-11-12: "still looks a bit rubbish";
  re-laid out 2026-11-13). A tenant brand's own page (`brandTop` in
  `brand-profile-panel.tsx`; landlords, agent firms, lenders and the deal
  page's Brand tab are untouched) is: a header line with badges and the
  agent's actions, with all housekeeping in one **More** menu; a summary
  card (About, Working with BGP figures, What they sell, Tenant at / In
  talks at / Suggested pitches as counted lines); a one-line Brand
  conversation; then six pills, in the address as `?section=`: Overview,
  Deals & space, Stores & menu, Expansion, People & checks, News & media.
  The phone (`mobile-brand-view.tsx`) has the same six. New pieces live in
  `client/src/components/brand-page/`; cards follow one pattern
  (`brand-card.tsx`). Menu highlights / Best sellers is mounted once, under
  Stores & menu, with a teaser in the summary card. Keep the KEEP LIST in
  `docs/brands-review-2026-11-12.md` when changing the page.
  - **Expansion** (Woody, 2026-11-14: "the display doesn't look great
    between the 2 ... needs improvement and design tidy up"). The score
    card is the figure with its band (`expansionBand`, the Hunter board's
    bands), then the four parts one under the other, each with its bar and,
    for staff, every why-line of that part (`SCORE_PARTS`; no separate "Why
    this score"). The Signals card draws one line per signal in three
    columns (kind, headline, date), with the estate list first
    (`isEstateSignal`: every kind but plain news, plus a plain news story
    whose headline is about sites, hiring, deals or money) and general
    coverage folded under **Other news**; the Expansion pill counts the
    estate list. That rule only decides which list a story is drawn in.
    The score counts one story once (`dedupeFacts` in
    `server/hunter-score.ts`: the same headline or the same link) and a
    headcount fall is its own line, "Headcount falling". The review of what
    the score could not see is `docs/expansion-review-2026-11-14.md`; its
    "Built on 15 November" section says which ideas are now built.
  - **Expansion and Relationship are two figures** (Woody, 2026-11-15: "Yes
    to all on expansion apart from 6 keep running 25 a night"; do not
    re-litigate). `computeExpansionScoreV2` in `server/hunter-score.ts`:
    **Expansion** is market evidence only, four parts of 25 (UK momentum,
    Pipeline, Capacity, Intent), out of 100; **Relationship** is BGP's own
    work with the brand (deals, offers, viewings, contact), out of 25, and
    is NEVER added to Expansion. `score` / `expansionScore` and the saved
    `brand_score_history.hunter_score` are the Expansion figure;
    Relationship is `relationship` and `sub_scores.engagement`. A row saved
    before the split holds the old sum, so every reader works both out from
    the sub-scores (`splitSubScores`). Bands and alerts (Very hot 30, Hot
    20, Watch 10; hot / cooling emails) are judged on Expansion.
    `SCORE_VERSION` is 6 (since 19 November 2026, when the count of BGP's
    own requirements moved onto the one live rule). A client login is sent Expansion only
    (`clientScoreView` drops the Relationship figure, part and lines). The
    Hunter board shows Relationship beside each score for staff and has a
    **No BGP relationship** filter (Expansion 10 or more, Relationship 0:
    the prospecting list). Never add the two together again.
  - **What feeds Expansion besides signals** (same decision):
    - **The store count** (`server/brand-store-count.ts`, rules in
      `shared/store-count.ts`): the brand's own website sitemap is read for
      its page-per-store set (no AI), about once a month per brand, 90
      brands a night (`brand-store-count` job, 02:30), kept as dated
      snapshots in `brand_store_counts`; openings and closures are the
      difference between two good snapshots of the same set. A count under
      60% of the last is saved flagged and left out. It leads UK momentum
      ("Net +N sites in M months, counted on its own website"; a net fall
      in an estate of 50 or more is damped as churn) and then headlines
      about openings count for less. It cannot count a store finder with no
      page per store (Wingstop, Five Guys, Wagamama, Pizza Express) or a
      site that refuses a plain request (Dishoom, McDonald's): those fall
      back to the locations-page list or have no count.
    - **Planning applications and job adverts** (`server/brand-pipeline.ts`,
      rules in `shared/brand-pipeline.ts`, tables `brand_pipeline_items` /
      `brand_pipeline_checks`, job `brand-pipeline` 03:45, 60 brands a
      night): PlanIt is searched by brand name, a name of more than one
      word (or with an ampersand) as a quoted phrase (unquoted, "Flat Iron"
      matched 71 records, 3 naming it; quoted, the 3; no kept record was
      lost by quoting); a record counts only when the description names
      the brand (not as a former, existing or neighbouring occupier), is
      about works a new occupier applies for (shopfront, signage, change of
      use, fit-out, extraction), is not only replacing what is already
      there, and is under 12 months old. A name too common to search (Next,
      Boots, The Light, any single word of four letters or fewer but Pret
      and Itsu) is skipped and says so. A tree or telecoms application
      (PlanIt's own type, `NEVER_AN_OCCUPIER_TYPES`) never counts, and road
      or traffic signs and "signs of" are not shop signs: a Guildford tree
      application counted for The Light on 18 November 2026 because it said
      "grown to the light" and "touching the road signs". **Replacing what
      is there** (`replacesWhatIsThere`): replacement signs, lettersets,
      fascias or shopfronts, or "replace existing", do not count (McDonald's
      replacement lettersets were nine of the 21 kept for it), unless the
      description also says arrival (change of use, fit-out, occupation by,
      erection of) or names another business as the one being replaced
      ("replacement for existing Tim Hortons" on a Starbucks application
      counts). Stored rows are never deleted (a check only adds or
      refreshes them), so the card and the score also leave out a stored
      tree or telecoms row.
      **PlanIt's rate limit** (found 18 November 2026; its API page:
      "access to the API is rate limited", a 429 with Retry-After past it).
      The nightly run asked about 26 times a minute and on 16 and 17
      November the only planning hits were the 6th and 12th brands of their
      nights: about the first dozen brands a night got an answer and the
      rest were refused, and the live card read a refusal as "none found".
      Every PlanIt request in the process now books a turn at least
      `PLANIT_GAP_MS` (6 seconds) after the last (`planitTurn`; 37 searches
      at that pace went through untroubled), and a 429 pushes every later
      turn back by its Retry-After (60 seconds without one). Each caller
      waits only so long: Check again 15 seconds, then "PlanIt asked us to
      slow down; try again in N minutes"; the nightly run 5 minutes, then
      it stops for the night (`stoppedEarly`) and the rest stay due; the
      twelve-month check 15 minutes, then it pauses keeping its place. Do
      not add a PlanIt request that skips the turn.
      **Planning, last 12 months, for every brand** (Woody, 2026-11-18:
      "can we do planning for the last 12 months?"): admins have **Planning,
      12 months** on Brand Explorer (`client/src/components/planning-sweep.tsx`;
      `GET`/`POST /api/admin/brand-pipeline/planning-sweep`, admin only).
      **Check every brand** walks every tenant brand in id order from a
      saved place (`system_settings.brand-planning-sweep`), planning only:
      Adzuna is never asked. Each brand gets its records and planning
      status as the nightly check saves them, and its job adverts are
      marked "not checked", which brings it round to the nightly run (the
      card says "job adverts not checked yet"). About 4 or 5 hours for the
      2,764 brands. Stop keeps the place, Carry on resumes it, and a
      finished run starts again; a run an admin started carries on after a
      deploy (`resumePlanningSweep`, 75 seconds after boot), and nothing
      starts one at boot or on a timer. The dialog lists every brand with
      an application naming it in the window (sites, latest date, towns),
      each opening its Expansion tab. Guard:
      `qa/regression/brand-pipeline-planit-guards.test.mjs`.
      What PlanIt holds, from a direct test of the rule on 18 November
      2026 (about 45 expanding brands, 12 months): Starbucks and McDonald's
      the most, then Costa, Greggs (eight genuine new sites, four of them
      Greggs Pods), Burger King, Nando's and Domino's; Gail's two; Popeyes,
      Five Guys, Pret and Taco Bell one each; nothing naming Wagamama,
      Itsu, Wingstop, Black Sheep Coffee, Honest Burgers or Flat Iron. PlanIt hides the applicant's name ("See source"), so a record
      is found only when the description names the brand; council
      descriptions often do not, and PlanIt's Liverpool register stopped at
      8 July 2026 (seen 18 November). Job adverts come from Adzuna
      (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, set on Railway). The name is asked
      as a phrase, one request a brand, and only adverts the brand itself
      placed are kept (`advertCompanyMatches`); Adzuna's company filter is
      not used: it knows only some employer names and refused the rest with
      a 400, so until 18 November 2026 the jobs half failed for about nine
      brands in ten (it worked for 15 of the first 179: Argos, Skechers,
      McCarthy & Stone and others). Do not add a second request per brand:
      Adzuna's free key is reported to allow about 2,500 calls a month
      (unconfirmed) and the nightly run already makes about 1,800. A
      refusal is stored with Adzuna's own words, never a key. The card says
      what each source's check did (`pipelineCheckWords`,
      `pipelineCheckedSummary`): a check that failed or was not run never
      reads as "none found". At 60 a night the 2,764 tenant brands take
      about 46 nights to go round once; a failed check is tried again only
      after every brand never checked. Licensing registers are council by
      council and are not read.
    - **Plans stated in the filed accounts** (`server/accounts-plans.ts`,
      checks in `shared/accounts-plans.ts`): openings, closures and capital
      spend planned after the year end, kept under
      `companies_house_data.latestAccountsPlans`. Accounts with a text
      layer are read as text and every plan must quote a sentence that is
      in them; scanned accounts are read from page images and say so.
      Anthropic only, one read per filing, nightly (`accounts-plans` job,
      03:30) under `ACCOUNTS_PLANS_DAILY_CAP` (default 15, 0 = off), the
      highest Expansion score first. A plan counts in full for 18 months
      after the year end, half to 30 months, then nothing.
    - **A sale of sites is a contraction** (`siteSale`): "agreed to sell a
      24-pub package" takes points off UK momentum. A story where the brand
      is the buyer does not.
    - **The rollout badge lapses after six months** (`shared/rollout-badge.ts`,
      `crm_companies.rollout_status_at`, stamped by a database trigger when
      the badge changes and by the brand save when a person saves it
      again). A lapsed badge scores nothing and is drawn greyed "· lapsed".
      A badge set before 15 November 2026 has no date and counts from that
      day. Brand Gap, the Brand Pack and the digest still read the raw
      badge.
    The nightly tidy (`normaliseBrandFacts`) stays at 25 brands a night:
    Woody declined running it on every brand. On the page the two measured
    cards, **Store count** and **Sites on the way**
    (`client/src/components/brand-page/estate-pipeline.tsx`), lead the
    evidence column above Signals; a client login reads them (public data)
    and only BGP staff can ask for a fresh count or check. The Competitor
    set goes under whichever column is shorter, measured without it
    (`BalancedPair` in `client/src/components/brand-page/balanced-pair.tsx`;
    Woody, 2026-11-18, on Flat Iron's page: "can you fix this gap?"); on one
    column it stays under the score card, and no card is stretched to fill
    a gap. Guard: `qa/regression/brand-expansion-columns.test.mjs`.
  - **People & checks is a matched pair** (Woody, 2026-11-13: "same
    height"). On two columns Key contacts and Company checks are one height
    while both are at rest; a card marked `data-own-height` (opened with
    Show all or Show more, or holding next to nothing) or with a list open
    inside it puts each column back on its own height (the classes on
    `brand-people-cards`). Never stretch a card into a blank, and no fixed
    height or inner scroll box on either. Company checks rests on its
    summary and the Checks run list, with Show more at its foot; a record
    not held is a muted "not held yet" line, never an empty tick box. The
    KYC chip is KYC4U's verdict and is not changed by the rows.
  - The brand **Deals** card (`server/brand-profile-deals.ts`) is not the
    landlord deals board. A client login sees only deals where its own
    company is landlord, vendor or purchaser. An asset manager reads the
    brand page exactly as a full Landsec login does (Woody, 2026-11-13). The
    code below is a backstop no login reaches today: a Landsec login held to
    named schemes gets deals, counts, portfolio activity and tracker notes
    for those schemes only, no BGP take and no conversation box. A
    scheme-limited login also gets live tenancies,
    lease events, Tenant at, the stores' nearby-property mark and suggested
    pitches for its own schemes only, and the same list cuts its Brand pack
    (no BGP take), the Landsec company's own deals and properties, and the
    deal, offer and viewing counts in the expansion score's why-lines: one
    list, `dealListProperties` on the profile and
    `schemeLimitedPropertyIdsOrNone` elsewhere, which gives none when the
    schemes cannot be read (tests in `server/brand-profile-deals.test.ts`).
    Its rent range, sizes and rent affordability are worked out from
    comparables at its own schemes only, with no peer average. The Brand
    pack's deal list follows the Deals card for every client login (own
    company as landlord, vendor or purchaser).
    `useLandsecRestricted` only switches off requests the
    server refuses; what a login may read is decided on the server. The
    Brand Pack PDF (`server/brand-pack.ts`) takes the same cut and checks
    the company itself for every client login: a client's pack lists only
    the deals its own company is party to and tenant-rep representation,
    prints the saved analysis without BGP's pitch advice, carries the BGP
    take only for a brand in the client's CRM (never for a scheme-limited
    login), and a company the client may not see is refused. A new section
    on the pack is cut the way the brand page cuts it.
    `/api/brand/:companyId/suggested-units` (the parked admin block) is BGP
    staff only: no client login of any kind is sent it.
  - What the CRM company routes never send a client login is ONE list,
    `BGP_ONLY_COMPANY_FIELDS` in `shared/tenant-categories.ts` (BGP's notes
    and prospecting flags, every aml column, the saved AI fields, the saved
    analysis, On hold). The brand page has its own cut, described below,
    which keeps four things from that list on purpose: the PEP flag, the
    Super Brand star (`hunter_flag`, the Hunter pick until 17 November 2026),
    the analysis without its advice and two saved AI keys.
    Every company row the CRM routes send a client goes
    through one of three cuts beside it: `clientBrandCompanyView` (another
    company's record, and the reply to a save or a create: also without
    BGP's KYC and Companies House record on it or who at BGP covers it),
    `clientOwnCompanyView` (its own record: BGP's compliance record on the
    client is not sent back to it; who looks after it stays) and
    `clientCompanyListRow` (the list: the brand cut, but the KYC status and
    expiry stay because the Deals page's AML mark reads them). The brand
    page's company row goes through `clientProfileCompanyView`: of the saved
    AI fields a client gets only `CLIENT_PROFILE_AI_KEYS` (the backers list
    and the likely website), never the summary of BGP's emails with the
    brand, and never BGP's AML risk level (the Company checks card reads
    the KYC status and the PEP flag, which stay). The saved analysis reaches
    a client without BGP's pitch advice at its end (`clientBrandAnalysis`:
    everything from "Recommendation" on is cut on the server, for the page's
    data and the Brand Pack, by the rule the screen has always used; keep
    the two in step). A new BGP-only column goes
    on the list; a new saved AI key reaches a client only when it is added
    to the keys. A company's deals, properties, property summary and
    contact summary (`/api/crm/companies/:id/deals`, `/properties`,
    `/property-summary`, `/contact-summary`) are cut to a scheme-limited
    login's own schemes. The Brands hub's deal count on a brand, for a
    client, is that client's own deals with it. The Brand Hunter list sends
    a client no saved analysis.
  - What a client login may WRITE on a company is one thing: it can add a
    tenant brand (`POST /api/crm/companies`, on the CRM write guard's list
    in `server/crm.ts` since 2026-11-13; "Add to the brand list" on a brand
    picker failed for every client before that). The create handler refuses
    any other company type, refuses a login not yet tied to a client
    company (`NO_ACCESS_SCOPE`: it could otherwise make a company under its
    own team name and be scoped to it), and saves only
    `CLIENT_NEW_BRAND_FIELDS` in `shared/tenant-categories.ts` (the name,
    type, web address, description and profile link the create screens
    send): never a KYC status or AML record, a BGP note or flag, a parent
    or merged-into link, or its own list of extra brands. A column goes on
    that list only when a create screen a client uses sends it. A client's
    company SAVE
    (`PUT /api/crm/companies/:id`) stays refused by the same guard, though
    the outer gateway's prefix lets it that far: the handler writes whatever
    the request carries, so it needs its own list of fields first, and
    whether a client edits a brand at all is waiting on Woody. Do not open
    it to make the guard "agree" with the gateway. A joint agent adds
    nothing (`restrictedLandsecApiRule`). An asset manager adds a tenant
    brand as any full Landsec login does (this line read "Asset managers and
    joint agents add nothing" when it was written on 13 November; superseded
    the same day by Woody's "asset managers and leasing landsec should be
    the same"). Both gates and the
    create are run together in `qa/regression/access.cjs`.
  - A brand or building photo by its id (`/api/brand/gallery-image/<id>`,
    the cover photo and gallery) is open to client logins since 2026-11-13
    (it was refused them at the gateway, so the cover never loaded). The
    handler serves a client login only what `clientMaySeeImage` allows: its
    own company's photos, those of a brand it may see (filed under the
    brand, or an older row filed under no company that carries its name),
    and its own properties' (its own schemes', for a scheme-limited Landsec
    login). BGP staff are served any photo, as before, including while
    viewing as a client.
  - **Call from the Tenant rep line** (15 November 2026; Woody: "fix the
    phone issues"). A Tenant rep line with a named agent carries Call and
    Email icon links beside the name, on the phone page
    (`repContactLinks` in `mobile-brand-view.tsx`) and the desktop block
    (`RepContactLinks`, `TenantRepsBlock`), when the reply holds a number or
    an address. The brand profile sends `contact_email` and `contact_phone`
    on `representedBy` and `requirementAgents`, the phone worded as the
    client Agents list words it (mobile, else phone). A client login is sent
    them for tenant reps only, the people its Agents list already shows it;
    a joint agent has no brand page. Links only: no write. Test:
    `qa/regression/phone-property-brand.test.mjs`.
  - **Add photos on a brand's page** (15 November 2026; Woody: "fix the
    phone issues"). `client/src/components/brand-page/brand-photos.tsx`:
    `BrandAddPhotos` takes several images at once and files each against
    the brand through the routes Images already used (`POST
    /api/image-studio/upload`, then `POST /api/image-studio/:id/attach`
    with the brand); no new route. `BrandPhotosCard` is the phone page's
    **Photos** card under News & media (every saved image; a client login
    sees the photos and no control), and the desktop Documents & gallery
    card has the same link. BGP staff only, as the attach is: the server
    still refuses a client login attaching to any company but its own.
    Test: `qa/regression/brand-add-photos.test.mjs`.
  - Every deal sent to a client goes through `stripDealFees` in
    `server/crm.ts`, the replies to its own deal save and new deal included
    (those two sent the whole stored row until 2026-11-13): all fee fields
    blanked, and BGP's AML working on the
    deal (`CLIENT_HIDDEN_DEAL_AML` beside it: risk level, PEP, source of
    funds, ID checks, any suspicion report and its reference, compliance
    notes, the AI triage, the MLR scope, who approved). "AML check" and
    "KYC approved" stay because a client's deal form sends them back. A
    client never writes those fields either (`clientNeverSetsOnDeal` on the
    deal save and create), so a blanked value cannot come back and
    overwrite BGP's record. Do not blank part of a deal by hand in a route.
    Invoicing notes and the Xero contact on a deal still go to a client:
    waiting on Woody.
  - Sizes go through `shared/format-size.ts` (a size stored split at its
    thousands commas is rejoined); a suggested pitch's opening words come
    from `pitchFitWords` in `shared/requirement-fit.ts` (Fits / Size fits /
    Close to), and its six are spread across centres (`spreadAcrossCentres`
    there: the best unit at each centre before a second at any; Woody,
    2026-11-16, after Jersey Mike's showed six Gunwharf units and nothing
    else). One stage pill across the page (`stageChipClass`).
  - Waiting on Woody: what a full Landsec login reads on a brand (the BGP
    take in full, live tenancies and rent at other landlords' schemes, the
    expansion score, Tracker updates).

## Who owns a brand: the London Food Money Matrix (Woody, 2026-11-15)

Woody on https://london-food-money-matrix.vercel.app/ (a public map of who
owns London's restaurants, cafés, bakeries, bars and pubs: private equity,
venture, a corporate parent or independent, each entry with its owner, the
year and a source link): "This is good intel let's keep using this app for
contacts and intel on brands". It is a standing source of brand intel,
read once a week. Its author and terms of reuse are not stated on the page.

- **Rules** are `shared/ownership-intel.ts` (`readOwnershipPage`,
  `ownershipNameKey`, `ownershipKindFits`, `sameOwner`, `planOwnership`;
  tests `server/ownership-intel.test.ts`, in `npm test`, and
  `qa/regression/ownership-intel-guards.test.mjs`). A name is matched only
  to exactly ONE visible tenant brand recorded as food and drink, or as
  nothing in particular (a "Tenant - Retail" of the same name is listed for
  a person: The Wolseley is not Wolseley). **A brand is never created from
  the page.** A read that fails, has lost its list or looks cut short
  (under 100 places, or under 60% of the last read) changes nothing.
- **What is saved**: the page's reading under
  `crm_companies.ai_generated_fields.ownership_intel` (owner, kind, since,
  the page's one-line note, the source link, the date read, the owner it
  gave before). It is on no client list (`CLIENT_PROFILE_AI_KEYS`), so no
  client login is sent it. **Backers** is filled only for a private equity
  or venture owner and only when blank (or still holding exactly what an
  earlier read put there), marked as an automated fact like the profile's
  other readers; a value a person or another reader set is never
  overwritten, and a disagreement is listed. A corporate parent and an
  independent's founders are not backers: they show on the owner line only.
- **The read** is `server/ownership-intel.ts` (`runOwnershipRead`; no AI):
  weekly job `ownership-intel`, Monday 03:00, and admin routes
  `GET /api/admin/ownership-intel` (the last read's report, kept in
  `system_settings.ownership_intel_report`) and `POST …/read`.
  `OWNERSHIP_INTEL_URL` moves it (https only) and `off` stops it.
- **Screens**: BGP staff see an **Owner** line among the facts on a brand's
  summary card (`brand-ownership-line`: owner, kind, since, a source link;
  the note and the read date in its title). Admins have **Ownership intel**
  beside Tidy brands on Brand Explorer
  (`client/src/components/ownership-intel.tsx`): owners that changed since
  the read before, brands where our Backers names someone else, and the
  backed operators not in the directory. The phone brand view has no owner
  line yet.
- A dry run against the live directory on 15 November 2026 (nothing
  written): 591 places, 94 matched, 36 Backers to fill, 1 disagreement
  (Flat Iron), 14 names left for a person, 164 backed operators and 319
  independents not in the directory. It has not been run on the live
  database from a build machine: the first read is Monday's, or an admin's
  Read now.
- Not built, each waiting on Woody: adding the missing operators as brands
  (the directory is deliberately kept to brands BGP works); the owners (the
  private equity houses) as companies or contacts in the CRM; an owner
  change as a signal on the Expansion page or in the digest; the map's
  pins and areas.

## Contacts from email, company checks and Back (Woody, 2026-11-13)

Decided by Woody on 13 November 2026 (do not re-litigate):

- **Contact details are read from emails automatically** ("should be
  automatic ... its really important we capture contact details from
  emails"), with no button. The hourly staff-mailbox sync reads a person's
  own signature, including one inside an earlier message of theirs quoted
  further down a thread, so someone who was only copied can still be found
  (`server/email-contact-reader.ts`, used from `server/email-contact-details.ts`).
  It fills BLANK fields only, never overwrites a value, never sets an
  employer, and gives a signature to a person only when the block closes a
  message they wrote and carries their name. Plain signatures are read by
  rules; anything else goes to Anthropic only, with a daily cap. Contacts
  already added from email with no title or phone are worked through by the
  same hourly job a small batch at a time, oldest first. This is the one
  timed job allowed to read staff email text for contact details. (Reading
  email for requirements was approved on 15 November 2026 and is its own
  file, `server/requirement-email-feed.ts`: see the Requirements centre
  section.) It has not been run against
  Microsoft from a build machine: check Settings → Email Intelligence →
  Sync Health after a deploy.
- **The "Auto-added from email" note opens its email, for BGP staff only**
  (`server/contact-source-email.ts`). A client login is never sent a
  contact's internal notes, how the contact was sourced, or any email link
  (`server/client-contact-row.ts` is the allow-list for a contact row sent
  to a client). The client's read of the correspondence log
  (`/api/interactions/company/<brand>`) stays open for now (Woody: "needs
  thought if this goes live").
- **The accounts read retries in the background** ("buttons are annoying
  can this background read?"): an empty or cut-off extraction is read again
  by the nightly job, a day later and then weekly, up to four times per
  filing (`shared/accounts-read.ts`; cap `ACCOUNTS_RETRY_DAILY_CAP`,
  default 10 a night, 0 = off). No button was added.
- **Company checks on a brand's page**: the covenant report is allowed to a
  client when ANY record with that Companies House number is its own
  company or a brand it may open (two records can share a number); the
  "Checks run" rows and the company facts lines come from
  `shared/company-facts.ts` (a plc with officers held ticks Officers + PSCs;
  the annual report row is for a plc or a stored report). Key contacts and
  Company checks sit as a matched pair when both hold real content. The KYC
  chip is KYC4U's verdict and is never inferred, for a plc or anyone.
- **Back goes back** ("back buttons should just always take back to the
  screen before"): one helper, `client/src/lib/go-back.ts`. Back returns to
  the previous screen in the app; a pill or tab change on the same page
  replaces the history entry, so it is never a step; with no previous
  screen in the app (a pasted link) Back goes to the page's parent. Use the
  helper for any new Back control; never a fixed address. The phone smoke
  suite holds the tab rule in a browser (`qa/phone-session-smoke.mjs`,
  "phone Back leaves Deals in one press after a tab change"); it used to
  expect Back to reopen the WIP tab, the behaviour this rule replaced.

## The contact page (Woody, 2026-11-14)

Woody: the contact page "looks pretty shit". `ContactDetail` in
`client/src/pages/contacts.tsx` is one header (photo, name, "job title at
company" with the company's chip, email / phone / LinkedIn icons, Last
contact for staff from `/api/interactions/summary`, Edit, and one More menu:
Enrich, Log activity, Delete) and two cards of the property page's shape.
Left: Overview (details, the company's website and office, BGP people who
know them, Source), Activity (the AI read and the emails and meetings board,
staff only: both feeds are staff-only), Notes. Right: Conversation (the
person's thread, `CompanyMiniChat` with `linkedType="contact"`) and Records
(properties, deals, requirements, investment items, each a link).
Co-workers follow as compact rows, first 8, a search and Show all. The
company's type is never shown as the person's label, and the separate
Company card is gone. The AI activity card says a failed read quietly, never
in red. An agent firm's page opens to a client login to READ
(`isClientReadableCompanyPage` in `server/company-scope.ts`: a brand it may
see, or an agent firm); writes there stay with `isClientVisibleBrand`.
**A client login never opens another landlord's page** (Woody, 2026-11-15:
"no landsec should see another landlord page"): a Landsec login is refused
Hammerson's record and its feeds, as it always was. Do not open it.

## The CRM page (Woody, 2026-11-15) — docs/crm-review-2026-11-15.md

Woody on the side bar's CRM page (`client/src/pages/people.tsx`): it is "not
uniform between brand, agent and landlords", "lacks connectivity and
usability", and he wants "one engine ... join it all up for BGP and then
Landsec can use that for theirs, just move lenders and landlords out ...
they should all be linked to the calendar". The review, the proposal (one
CRM page, one list design for landlords, brands, agents and lenders, one
engine and diary for all four, a CRM layer on the team and Landsec
calendars), the order of work and the four decisions waiting on him are in
`docs/crm-review-2026-11-15.md`. **Read it before touching the CRM page.**

**Decided by Woody on 15 November 2026 (do not re-litigate):**

- **Build the BGP version first**, "then we can just hide lenders and
  landlord for Landsec". Both are built (the Landsec version later the
  same day, when he said to finish the rest).
- **One engine for every kind.** "I agree with your approach": landlords,
  brands, agents and lenders in one Overview. This SUPERSEDES "the Brand
  CRM is separate from the Landlord CRM" in the Brand CRM section below for
  BGP's CRM page; the two older views (`kind=landlord`, `kind=brand`)
  still exist for a landlord's and a brand's own page and the Brand CRM.
- **Who is on the lists**: "all landlords will be included in the CRM and
  all agents and lenders. But we won't have a strategy for any of them till
  we turn them on." Brands are only the ones BGP is working ("otherwise
  lose focus"; "the Brand CRM should just reflect the contact level of
  Brand Intelligence ... Brand Intelligence is too big").
- **Turning a company on** starts its strategy: "we can add people or
  companies to the CRM strategy, goes for all types, and that is what then
  starts the strategy. Could AI start it a bit? Help kick it off? ... we
  choose who to make VIP and then the CRM engine starts suggesting
  locations, events, people to meet etc and closely watches them more than
  other CRMs."

**Built on 15 November 2026 for BGP:**

- **The joined view** is `kind=all` on `/api/crm/engagement`
  (`EngagementKind` in `shared/crm-engagement.ts`). Agent firms (type
  "agent") and lenders (the CRM page's lender type list) are plan companies
  (`PLAN_COMPANY_PREDICATE`, `AGENT_COMPANY_SQL`, `LENDER_COMPANY_SQL`,
  `companyNounSql` in `server/crm-engagement.ts`). In `all` a strategy or
  event may link any mix of kinds and a save replaces every link; `landlord`
  and `brand` still refuse a mix and replace only their own side. A save
  with no kind is still a landlord save. The CRM page's Overview is
  `CrmEngagementPanel kind="all"`: pills All / Landlords / Brands / Agents /
  Lenders filter it (`options.companies[].noun`), its pickers list every
  landlord, agent and lender and find a brand by typing, and the form words
  follow each company's kind. Each company in those pickers says what it is,
  the list opens on a few of each kind (not the first names alphabetically,
  which were all landlords) and scrolls into view at the foot of the form,
  and a company with no contacts says so (Woody, 2026-11-16: "cant seem to
  add brands or agents to the CRM forms just landlords?"). A form opened
  with no kind (a company page's CRM card, the property People board) lists
  agent firms and lenders as well (`getCrmEngagementOptions`). The scheme,
  sharing and waiting-on fields on an action still belong to a brand. Tests:
  `qa/regression/crm-engagement-postgres.test.mjs` (needs
  `CRM_ENGAGEMENT_DATABASE_URL`).
- **Start strategy** (`client/src/components/crm-engagement/start-strategy.tsx`,
  `server/crm-kickoff.ts`, contract and checks `shared/crm-kickoff.ts`,
  tests `server/crm-kickoff.test.ts`). `POST /api/crm/engagement/kick-off`
  reads what the app holds on the company (a fixed handful of queries, each
  allowed to fail) and, when the reader is on, asks Anthropic directly for
  a draft: a name, objective and reason; ONE running strategy it could
  join; people to meet, events to invite them to, places (space BGP is
  letting, for a brand; its own properties, for a landlord) and first
  actions. The reader is sent facts and the lists it may choose from by id
  (never an email address), and `checkKickoffAnswer` drops any id that was
  not offered. Capped a day (`CRM_KICKOFF_DAILY_CAP`, default 100, 0 =
  off); with the reader off the dialog still lists the people and events to
  tick by hand. Nothing is saved by the draft. `POST …/kick-off/apply` saves
  what the person ticked through the engine's own functions in the joined
  view: a new strategy or a place on a running one, the people as its
  contacts, the ticked events (the company linked, the people as SUGGESTED
  guests; no invitation is sent) and the actions (each a My Tasks row for
  the owner). BGP staff only: both routes are on the engagement router. It
  has not been run against Anthropic from a build machine.
- **One list for Landlords, Brands, Agents and Lenders**
  (`client/src/components/crm-hub/company-list.tsx`, `company-row.tsx`;
  feed `server/crm-hub.ts`, `GET /api/crm/hub/:kind` and
  `…/hub/company/:id/people`; types and pure rules `shared/crm-hub.ts`;
  tests `server/crm-hub.test.ts`). BGP staff only (`isEngagementStaff`).
  Landlords, agents and lenders are every company of that kind, by the
  rules the old tabs used (`companyIsKind`); **Brands is only the brands BGP
  is working**: on a strategy that is not completed, with an open CRM
  action, a live deal, a live or to-confirm requirement, or the Super Brand
  star (`brandWhy`; it read "Hunter pick" until 17 November 2026, and Super
  Brands now lead the list, see "Super Brands" below). Every row carries the BGP owner (`bgp_contact_user_ids`,
  else the agents on its deals, greyed), last contact
  (`shared/last-contact.ts`), the next action, its strategies and a
  kind line; a card or row opens the company page and its arrow opens the
  people in place. The filters are the same on all four tabs
  (`CRM_HUB_FILTERS`). **Start strategy** on a row opens the kick-off
  below; a strategy pill opens it on the Overview. Not carried over from
  the old tabs, on purpose until asked for: delete, the agent specialty
  pills and per-person deal and requirement lists, the lender stat tiles
  and Add Lender. The three older tab designs (`LandlordsTab`, `AgentsTab`,
  `LendersTab`) were deleted from `people.tsx` when the Landsec version was
  built (below).
- **The CRM plan on the team calendar** (`client/src/pages/calendar.tsx`,
  `crmPlanToCalendarEvents`): a **CRM plan** pill beside CRM / Outlook /
  Team draws confirmed CRM events and the due times of open CRM actions,
  each with an "Open in the CRM" link. BGP staff only; remembered per
  browser.
- **The Diary for every kind** (the CRM page's **Diary** pill,
  `/contacts?tab=diary`): `Diary` in `client/src/components/brand-crm/diary.tsx`
  with `scope="all"`, fed by `GET /api/brand-crm/diary?scope=all`
  (`loadDiary` in `server/brand-crm-diary.ts`, `DiaryOptions.scope`). It is
  the Brand CRM diary plus CRM actions on landlords, agents and lenders,
  confirmed CRM events from today (`crm_event`) and the end dates of
  active strategies (`strategy_review`); each item carries `nouns`, the
  kinds of company on it, for the All / Landlords / Brands / Agents /
  Lenders pills. BGP staff only: it sits behind `staffDoor`, and
  `loadDiary` gives any other viewer the brand diary whatever scope is
  asked for. The Landsec diary and the Brand CRM diary are unchanged.
- **The CRM layer on the Landsec calendar** (`/landsec/calendar`):
  `landsecCrmEntries` in `client/src/components/landsec/landsec-meetings.ts`
  turns the DATED lines of `GET /api/landsec/diary` (already cut for the
  login) into calendar entries marked `crm` (`CalendarCrm` in
  `leasing-viewings-calendar.tsx`): a muted bar with a target mark, a
  **CRM** pill with its count, and a card with an Open link. A booked
  viewing is left out (the calendar draws it as a viewing) and an undated
  line stays in the diary. A joint agent's calendar is its Viewings page
  and has no CRM layer.
- **The Landsec version of the page** (Woody: "then we can just hide
  lenders and landlord for Landsec"). BGP staff in the Landsec view
  (`useIsLandsecView()`) get the same page without the Landlords and
  Lenders pills (`LANDSEC_HIDDEN`). A client login gets `ClientCrmHub`:
  pills **Brand Directory**, **Agents**, **Diary** (Landsec only: the
  shared Landsec diary) and **<client> Contacts**. Brand Directory is
  `client/src/components/crm-hub/client-brand-list.tsx`, the BGP list's
  design (cards or table, the shared cells) drawn only from what a client
  is already sent: `GET /api/client/brand-directory` and, for Landsec,
  the diary's CRM actions as each brand's next action. BGP's owner, last
  contact and strategies are never on a client's row; the pill keeps the
  name Brand Directory because the Landsec side bar already has Brands.
  A Landsec login adds a **Request to BGP** from a brand's row
  (`ClientRequest` in `diary.tsx`, through the engine's client action
  route). `CrmNoteFill` is not drawn for a client login (the reader is
  BGP's). Guards: `qa/regression/crm-client-hub-guards.test.mjs`.
- **The CRM plan on every company page**: `LandlordEngagementPanel` is
  on agent firm and lender pages too (`staffPlan` in
  `brand-profile-panel.tsx`, and the phone view), with
  `interviews={false}`, and with `companyName` it offers **Start
  strategy** to BGP staff on a company that is on no active strategy.
- **Landlord, agent firm and lender pages in the brand page's shape**
  (step 5 of the review; Woody, 2026-11-15: "Company pages yes", then
  "Yes to all" on the design: the conversation as one line, Files as its
  own pill on the landlord page, the Activity feed on agent and lender
  pages). Desktop only; the phone view keeps its pills. The frame is
  `client/src/components/company-page/company-kind-page.tsx`
  (`CompanyKindPage`: one section at a time, kept in `?section=` with a
  history replace, a section drawn the first time it is opened and then
  kept; `CompanySummaryCard`; `CompanyWhereWeAre` and
  `CompanyStartStrategy`, both reading the plan under the plan card's own
  query key). `brand-profile-panel.tsx` builds the three pages from the
  cards they already had (`kindPageTop`, `kindMoreItems`,
  `kindHeaderActions`, and the three `if (... && flat)` branches):
  landlord Overview / Properties & deals / People & checks / News & media
  / Files; agent Overview / Brands & deals / People / News & media;
  lender Overview / Loans & properties / People & checks / News & media.
  The actions are portalled onto the company page's header line (Start
  strategy, Email, Call, Edit and ONE More menu); the profile reports
  `kindTop` through `pageHeader.onKindPage` and `companies.tsx` then
  leaves its own Edit and Delete out (`kindHeader`). "Where we are" and
  Start strategy are BGP staff only (`staffPlan`); a client login on an
  agent firm gets no Overview and no dealings. `AgentRelationshipCard`
  takes `part` (roles, dealings, viewings, teams) with the open list
  shared through `AgentDealingsScope`; `LenderPanel` takes `only` and
  `LenderGlance` is the lender's figures. Layout pins:
  `qa/regression/landlord-profile-ui.test.mjs`. Every card those pages
  had is still on them: move a card between pills there, never drop one.
- **Closer watching** (`server/crm-watch.ts`): a company on a running
  strategy goes first in the nightly store count, planning and jobs check,
  accounts read and signal tidy, and is re-checked every 7 days, not 30
  (`onStrategySql`, `WATCH_RECHECK_DAYS`). The Overview's first card is the
  **Watch list** (`server/crm-watch-list.ts`, `GET
  /api/crm/engagement/watch`, `watch-list.tsx`): every company on a running
  strategy, what is new in 14 days (signals, planning applications, job
  adverts, contact) and what is owed (overdue actions, no next step, no
  contact for 30 days), the ones owing first.
  **The watch list does something** (Woody, 2026-11-23, on Jersey Mike's
  reading "No contact on record": "wrong so needs to link", a "pop out
  summary of the brand activity with BGP", the "actions needed button to
  actually do something" and "a box to update strategy"; then "same for
  Landlords", "agents and lenders"). Contact is anything filed against the
  company OR one of its people (the CRM lists' rule, private mailbox left
  out) and the meetings in both diary books; a meeting booked ahead stops
  "No contact" being owed. "No people on record" is owed apart. **A brand's
  agents count** (Woody, the same day: "should count agents they are
  integral", of Jersey Mike's agent Richard Wilcox): the named contact on a
  current tenant rep representation and the agent named on a requirement
  that is not closed (`brandAgentSql` in `server/crm-watch-list.ts`; only the
  named person, never the whole firm) count as the brand's contact and its
  people, and show in Activity with BGP as "Agent · <firm>". Each owed
  chip is a button (`owedKind` in `watch-entry.tsx`): Start strategy, Add
  CRM action filled in for the company (No next step; "Get in touch with"
  for No contact), Add contact (`ContactFormDialog` with the company), or
  the entry. A company's name opens `WatchEntryDialog`: What's needed (each
  owed line with its button, overdue and open actions with their status),
  Strategy (per strategy: this company's plan, which is its target
  `reason`, the objective, status and review date, saved whole through the
  Overview's strategy save with the version read) and Activity with BGP
  (`GET /api/crm/engagement/watch/:companyId/summary`, `watchSummary`:
  people, last and next contact, diary meetings, logged emails and
  meetings, live deals, open requirements; staff only on the engagement
  router). Every kind, not just brands. Tests: `server/super-brand.test.ts`,
  `qa/regression/crm-watch-entry.test.mjs`.
  **The Overview's layout** (Woody, same day: "remove the stratgeys board
  ... have the calend go straight accross", "filters sit above watch list
  and filter all", "combine the CRM actions with the watch list on to the
  top board together"). On the joined CRM page (`overall` in
  `overview.tsx`) the Company / Strategy / BGP owner filters sit above the
  Watch list and filter it (`watchMatches`: the company, its strategies,
  and an owner of one of its running strategies or open actions) as well
  as the calendar and the actions; the CRM actions are the right half of
  the Watch list's card (`aside`); there is no Strategies board and the
  calendar runs full width. A company page's plan keeps its Strategies
  board and its own actions card.
  **Linked to** (Woody: "brands linked to BGP leasing instructions and the
  Landlords linked to their buildings / ownership", "agents ... linked to
  brands they are acting for and also building they are leasing").
  `GET /api/crm/hub/company/:id/links` (`server/crm-company-links.ts`,
  `CrmCompanyLinks` in `shared/crm-hub.ts`, staff only on the hub router):
  buildings by the role a property record gives the company (and
  `crm_company_properties`), a brand's place on BGP lettings (targets,
  interest, viewings, offers, Wanted lines, deals as tenant; live by
  `TRACKER_LIVE_STATUSES`), the brands an agent acts for now, the buildings
  it lets or brings brands to, and live deals. Read, never stored. Drawn by
  `CompanyLinks` under a CRM list row's people and in a Watch list entry's
  Activity with BGP.
  **Select and Delete on the CRM lists** (Woody: "add a select and delete
  buttons on the CRMs pages"). Admins, beside Table / Cards
  (`CrmSelectBar`); `POST /api/admin/crm-companies/bulk-delete`
  (`crmBulkDeletePlan` in `server/brand-relevance.ts`, the brand tidy's own
  checks plus a company's own KYC or AML record): untied = deleted for
  good; a tied brand is hidden as Brand Explorer does; a tied landlord,
  agent or lender is KEPT and listed with its ties (there is no Hidden list
  for those to bring one back from). Never at boot.
  **The CRM forms read better** (Woody: "auto type didnt pick up the
  strategy", "missed the company ... and didn't fill in why this agent").
  Add CRM action takes the company's one running strategy, or the one the
  note names (`strategyForCompany` in `dialogs.tsx`), on a read, on picking
  a company and when opened for one. A company written with a word that
  only says what kind of firm it is ("Forge agency") matches the record
  without it (`withoutKindWord` in `shared/crm-note.ts`, also in the
  reader's candidate search); the reason then fills.
  **Contact discovery and the website**: RocketReach is searched by
  employer NAME, so "forge" brought back people at every Forge. With a
  website on the record a profile is kept only when its employer's domain
  or website, or a work email, is on that domain
  (`rocketReachEmployerFits` in `server/contacts-discovery.ts`); a profile
  that says nothing is kept. Contacts already SAVED under a company are
  never removed by a refresh: take them off from the person's menu.
  **The Landlords list is the owner side** (Woody: Legal & General "hasnt
  landed as a landlord in the CRM list", typed Investor): `LANDLORD_TYPES`
  in `shared/crm-hub.ts` takes Landlord, Client, Landlord / Client,
  Landlord/Freeholder, Freeholder, Investor, REIT, Developer, Fund and Asset
  manager (the landlord diary book's types), or a portfolio account.

Built on 15 November 2026:

- **Review is a pill** (his words: "change the review tab so it sits in a
  pill next to CRM meetings"): `ContactDataHealth` with `pill` is the last
  pill of the CRM page's row, with its count, and opens the same employer
  checks dialog. With nothing to review it is not drawn. The full-width
  line is gone.
- **A note fills a CRM form** ("add in the AI form filling feature we built
  to this", on the New CRM strategy form). `CrmNoteFill`
  (`client/src/components/crm-engagement/note-fill.tsx`) is the box
  "Describe it in your own words" at the top of a NEW strategy, action or
  event, in the landlord and the brand view. `POST
  /api/crm/engagement/read-note?kind=` (`server/crm-note-reader.ts`) is BGP
  staff only (the engagement router refuses every client login), Anthropic
  only, called directly, one call a read, capped a day
  (`CRM_NOTE_READER_DAILY_CAP`, default 300, 0 = off). It is sent the note,
  the kind of form and today's date: no staff list and no company list. The
  contract and every check are `shared/crm-note.ts` (`checkCrmAnswer`; tests
  `server/crm-note.test.ts`, in `npm test`): the person's own text is a span
  of the note (else the whole note is the objective); a title is kept only
  when most of its words are the note's; an owner is one BGP person the
  note names; a date needs words from the note that carry it; a company is
  matched on the server to ONE record on that view's list, and a name with
  no match or several is listed back, never guessed. It only fills the form
  on the screen: the form's own Create is the only save. This is NOT the
  letting note reader (`shared/letting-note.ts`), whose stricter rules (a
  reading never fills a box by itself) stay as they are: do not merge the
  two. It has not been run against Anthropic from a build machine.

## The activity feed (Woody, 2026-11-15)

Woody: "bring the design up to speed", "click on the activity brings up an
explanation box", "is it linked properly to everything?".
`client/src/components/activity-summary.tsx` (the property page's Activity
tab, the dashboard boards, a brand's phone page) is one row shape
(`FeedRow`: icon chip, what it was about, who and when) under Upcoming and
day headings (Today / Yesterday / This week / Earlier). The whole row opens
`ActivityDetail`: when, who at BGP, who with, the company, the deal and its
property (each a link), "What it was about" (the saved AI read, asked for
once on open when there is none) and the actions (follow-up task, book a
follow-up, Open in Outlook, contact, deal, property). The hover-only icons
are gone. `GET /api/activity-summary` sends the names and ids those links
need (`contact_name`, `company_id`, `company_name`, `bgp_user`, `direction`,
the deal's `property_id` / `property_name`, a deal move's `stage`); a joint
agent is sent names and no contact or company id.

The same feed is on every record page (Woody, 2026-11-15: "Yes"): the
contact page's Activity tab (`contactId`, in place of `InteractionsBoard`),
the deal page under the AI read (`dealId`), and an Activity card on the
desktop brand page's Overview and on the landlord page (`companyId`). A
contact's or a deal's feed covers 12 months, the others 14 days. The AI
reads (`AIActivityCard`, the BGP take, the landlord's Meetings and Email
threads summaries) stay above it, staff only as before.

**The brand feed works for a client login** (Woody, 2026-11-15: "the brand
feed needs to work for landsec"): `?companyId=` is allowed for its own
company or a brand it may open (`isClientVisibleBrand`). On a brand it is
sent BGP's touches with the brand's people, and deals, deal moves and diary
events only at the client's own properties (`clientBrand`, `ownProps`, with
the scheme limit): never another landlord's deal. `?contactId=` follows the
contact's company by the same rule and `?dealId=` is `isDealInScope`. A
joint agent is refused the company and contact feeds (it has no brand or
contact pages).

## Brand gap board and benchmark centres (Woody, 2026-11-15)

Woody: Brand gap "can be much improved to include connectivity with the rest
of the app and be more user friendly than just a word dump", "link it to
requirements (add or reflect), properties, CRM, letting tracker, Brands",
"a bit more info about other competing centres, news about what they are
doing", "we could almost just set up property pages for them all at BGP".
Asked the four questions, he answered "Yes to all".

- **The board** (`client/src/components/brand-gap-panel.tsx`, data from
  `GET /api/property/:id/brand-gaps` in `server/property-gap-analysis.ts`):
  four figures (rank against the top centres, missing sectors, targets with
  a requirement, already in play), then pills: **Targets**, **Sectors**,
  **Competing centres**, **BGP take**, **More**. The AI prose and the web
  research are under BGP take, no longer the opening screen.
- **Targets** is one row per brand not on scheme (`targets` in the reply):
  why (the competing centres it trades at, how many top centres, how near),
  its Expansion score, the requirement held and the marketing unit here its
  size fits (`parseReqSize` against the live tracker units), and where it
  already stands at this scheme. **That stage is the Brand CRM's own rule**
  (`loadPlan` for this property; a Landsec login is read as its own plan
  viewer, so an unticked Wanted line stays BGP's). Never work a stage out on
  this screen. A row opens `TargetDetail`: **Add as target** on a marketing
  unit (the unit's Targeting Brief, `POST /api/unit-briefs` then
  `/targets`), **Want at this scheme** (BGP staff, `POST
  /api/brand-crm/targets` with the property), **Add requirement** (the
  Requirements page for that brand) and the brand page. A joint agent gets
  names and no brand links.
- **Competitors are the centres the landlord does not own.** A peer centre
  whose BGP property record has this property's landlord is a sister scheme
  (`sisterNames`): left out of the competing four, the benchmark table and
  the top-centre counts, and listed on one line. Competing centres are the
  nearest four non-sister centres within 60km (`competingCards`: owner,
  brands, not here, latest openings).
- **Benchmark centres** (`server/benchmark-centres.ts`): the `top25` list in
  `shared/uk-centres.ts`. A centre's record is the property stamped
  `crm_properties.benchmark_centre`, else a match by name and place. Missing
  pages are created only by an admin from the Competing centres tab
  (`GET /api/admin/benchmark-centres`, then `POST .../apply`: name,
  coordinates, tag "Benchmark centre"; existing pages are only stamped).
  Never at boot. They have no landlord, so no client login's property list
  holds them.
- **A centre's box** (`GET /api/benchmark-centres/:name`, `CentreDetail`):
  owner, its own news page, the weekly research and who trades there (store
  locations inside the centre's ring, labelled as not a tenancy schedule).
  Public data only, open to every login (on the client gateway's allow
  list); BGP staff are also sent the property id for "Open its BGP page", a
  client never is, and a joint agent is sent brand names with no ids. A
  client login still never opens the BGP property page or any landlord
  page.
- **Weekly research** (`runCentreResearch`, job `centre-research`, 05:20):
  Perplexity, a few centres a night (`CENTRE_RESEARCH_NIGHTLY_CAP`, default
  6, 0 = off), each about once a week, only centres with a page; saved as
  `centre_research` on the record (openings, closures, redevelopment,
  ownership, leasing; each with its date and source link). It has not been
  run against Perplexity from a build machine.
- **Shared centre pages** (Woody, 2026-11-15, told Landsec would get the
  box and not the page: "Let's them edit"). A page the set-up CREATED is
  stamped `benchmark_shared` and is open to every login to read and amend,
  joint agents and scheme-limited logins included
  (`sharedBenchmarkPropertyIds` in `server/company-scope.ts`, answered
  ahead of the scheme limit in `isPropertyInScope`, and in
  `propertyReadBlocked`, `clientBlockedForProperty`, the property GET and
  the tenancy schedule reads). It holds nothing of BGP's. **A centre page
  BGP already held is only stamped `benchmark_centre` and stays as private
  as it was** (it may hold another landlord's work: "no landsec should see
  another landlord page"); never set `benchmark_shared` on an existing page.
  The centre's box sends a client the page id of a shared centre only. A
  shared page is not on any client's Properties list: it is reached from
  the box. The research also shows on the centre's own page, under News &
  social (`PropertyCentreResearch`, `GET /api/properties/:id/centre-research`).
- **No junk in the gaps** (Woody, 2026-11-15: "hate junk").
  `shared/junk-brand.ts` (`isJunkBrand`, tests `server/junk-brand.test.ts`):
  an operating or holding company under its legal name (Ltd, plc, Holdings,
  Group), a hotel group, a bookmaker or casino, a name that is only a
  description ("Coffee House"). `pitchable` in the gap route leaves them out
  of every gap list, the sector examples, the benchmark and competing-centre
  chips and the targets, and the centre's box leaves them out of who trades
  there. They still count as occupiers on the scheme. A real brand caught by
  the rule goes on `KEEP` there, with a test.
- A requirement fits a marketing unit by the one fit rule (`requirementFit`,
  19 November 2026; see the Requirements centre section): size and use, or
  size and a place it names; with no size to compare, both. Targets' Fits
  here gives each unit's reason, and a requirement is "held" on a target
  only when it fits a unit being marketed here.
- "Requirements that fit a unit being marketed here" (under More; "whose use
  fits a unit" until 19 November 2026) lists only brands the
  board would offer as a gap: a linked brand record, in the scheme's
  categories (`fitsPositioning`), not junk. The property conversation works
  for a joint agent on its own schemes and on a shared centre page.
- The weekly research has never been run against Perplexity (no key on a
  build machine): check a centre's box after the first night on live.
  Tests: `qa/regression/brand-gap-board.test.mjs`.

## Brand CRM (Woody, 2026-11-12) — docs/brand-crm-spec-2026-11-12.md

The brands' own CRM: which schemes BGP wants each brand in, whether there is
a unit for it there, how far it has got, and what happens next. Built from
`docs/brand-crm-spec-2026-11-12.md`; **its "Decisions" section at the top
overrides the spec body.** Staff: `/brands?tab=crm` (the Brand CRM pill on
Brands; its own side bar link was removed on 16 November 2026, see "The BGP
side bar" below). Landsec logins: the same pill under Brands. A joint agent has no Brands entry, so it has `/landsec/brand-crm`.
Three views were built: Targets (brands against the Landsec schemes), Diary,
and Strategies and events (BGP staff only). **Since 16 November 2026 BGP
staff get Targets only** (Woody: "1 and 2 yes", on taking off the two views
the CRM page already holds): the brands' diary is the CRM page's Diary
(`/contacts?tab=diary`) and their strategies, events and actions its Overview
(`/contacts?tab=overview`, kind `all`), where a brand action's detail now
shows its scheme and sharing with Change scheme, sharing or waiting on.
`crmEngagementLink` sends every company's plan there, a brand's included,
and `brandCrmMovedHref` (`brand-crm-tab.tsx`) sends an old staff
`?view=diary` or `?view=strategies` link on. Landsec logins keep Targets and
Diary; the joint agent's `/landsec/brand-crm` is unchanged. The same plan is
the **Schemes and units** card on every brand page.

Decided (do not re-litigate):

- **Schemes and units.** A brand's plan is one line per scheme and unit:
  the unit, the stage, the requirement fit, the next step and who has it,
  with links to the Letting Tracker row, the deal and the Landsec unit page.
- **Stages are read from the records, never picked.** One stage per brand
  per unit, the furthest live evidence wins (`resolveStage` in
  `shared/brand-stage.ts`): Wanted, Unit identified, Approached, Viewed,
  Negotiating, HOTs, Solicitors, Let, Trading, Not proceeding (the full
  set, Woody's choice over the shorter one), plus Disposing for a brand
  giving a unit up, which is never a target. The words match the Letting
  Tracker. The five old `concept_status` values are gone from the screens;
  the one hand-set flag is **On hold**, stored as `parked`
  (`conceptStatusForSave` accepts only null or `parked`; BGP staff only; a
  client can neither set it nor read it). Change a stage rule there, with a
  test in `shared/brand-stage.test.ts`, never on a screen.
- **The Brand CRM is separate from the Landlord CRM.** The Landlord CRM
  (`/contacts`, Overview) keeps every word and behaviour it had. Brand
  screens say "Brand". A strategy or event is all brands or all landlords:
  `?kind=brand|landlord` on `/api/crm/engagement` reads and writes one side,
  a write with no kind is a landlord write, and a mixed save is refused. An
  older record that links both shows on each page with only that page's
  companies. An action follows its company's type.
- **The Wanted table** (`brand_scheme_targets`, migration 0055, on
  `IDEMPOTENT_SQL_MIGRATIONS`, `brandSchemeTargets` in `shared/schema.ts`):
  "we want this brand at this scheme", with or without a unit. It is the
  only stored line; every other line is derived. BGP staff add one with
  **+ Scheme** on the brand's card, retire it with a reason and bring it
  back; there is no delete. It is hidden from Landsec until BGP ticks
  **Show to Landsec**. Landsec does not write Wanted lines yet (after the
  pitch). **A target or a wish is never recorded by creating a deal**: a
  real letting is only ever created through `server/letting-service.ts`.
  The three Jersey Mike's units (Bluewater, Liverpool ONE, Gunwharf Quays)
  are early targets: Wanted lines or unit targets, not deals.
- **The action fields** on `crm_engagement_actions`
  (`CRM_ENGAGEMENT_MIGRATIONS`): `property_id` (the scheme's property
  record), `tenancy_unit_id`, `shared_with_company_id` (the share marker),
  `waiting_on_party` (one of `LANDSEC_WAITING_PARTIES`) and `waiting_since`.
  Brand actions only; a landlord action takes none of them.
- **The diary is shared** with Landsec (asset managers included, on every
  scheme) and joint agents on their schemes ("for Landsec it's all BGP and other joint agents on the
  instruction"): brand CRM actions, booked viewings, viewing follow-ups,
  deals waiting on someone, briefs awaiting a signature and brand cases
  awaiting a reply. It is read from those records; it stores nothing.
- **What each login sees** (cut on the server before a stage is worked out,
  so a client's stage reflects only what it may see):
  - BGP staff: everything, every landlord, with the lead, the aim, notes,
    internal evidence (units sent to a brand, name-only matches, unticked
    Wanted lines) and who an action waits on. `/api/brand-crm/*` is theirs
    alone (`staffDoor`: a client login, or staff viewing as a client, is
    refused; the path is on no client allowlist).
  - A full Landsec login, leasing manager or asset manager: brands in its slice
    (`isClientVisibleBrand`), the 14 schemes only, never another landlord's
    activity, never BGP's strategies, notes, lead, aim or fees. Its own
    requests to BGP, plus the actions BGP shared with it.
  - A joint agent: brand names and stages on own schemes; no company ids,
    brand pages, brand cases, contact names, notes or BGP strategies. Its
    diary holds deals waiting, viewings and shared actions only.
  - Any other client login: none of it.
  The Landsec door (`/api/landsec/brand-crm/plan`, `/api/landsec/diary`)
  is always a client view, even for BGP staff, and is read only.

Files: `shared/brand-stage.ts` (stages, evidence, requirement chip, the
response types), `server/brand-scheme-plan.ts` (`brandPlan`, `brandGrid`,
`createWish`, `updateWish`, the plan routes), `shared/brand-diary.ts` and
`server/brand-crm-diary.ts` (`loadDiary`, the two diary routes),
`client/src/components/brand-crm/*` (`brand-crm-tab.tsx`, `plan-board.tsx`,
`diary.tsx`, `scheme-plan-card.tsx`), `client/src/pages/landsec-brand-crm.tsx`,
`migrations/0057_brand_scheme_targets.sql`. Tests: `shared/brand-stage.test.ts`,
`server/brand-scheme-plan.test.ts`, `server/brand-crm-diary.test.ts` and
`qa/regression/brand-*.test.mjs`, `crm-engagement-kind.test.mjs`.

- A new source of evidence is one more branch of the evidence query in
  `server/brand-scheme-plan.ts` plus a rule in `readEvidence`; say there
  whether a client may see it. Never give a screen its own stage logic.
- Brand tidy: a live Wanted line keeps a brand, and any Wanted line stops a
  permanent delete (`schemeTarget`, `anyWish` in `server/brand-relevance.ts`).
  A merge repoints Wanted lines (`COMPANY_REFS`).
- Brand contacts follow the landlord board: one person's email history and
  the dismiss cross on a suggested contact work on a brand, for BGP staff
  only. A joint agent is never sent a brand contact name
  (`server/landsec-unit.ts` blanks it on viewings). The client gateway lets
  a Landsec login (an asset manager included, by the same test as any full
  Landsec login) GET `/api/brand/<id>/...` for its own company or a brand in
  the Landsec slice, so every handler there that returns BGP's contacts or
  mail checks for BGP staff itself (`contacts-cascade`,
  `bgp-known-contacts`, the email threads, `suggested-units`). A client's
  brand page shows the requirements the Requirements page lets it read:
  every one that is not closed since 17 November 2026 (Requirements centre
  section), never the state.
- Not built, each waiting on Woody: Landsec writing its own Wanted lines;
  an all-landlords Targets list; showing Landsec that a shared action waits
  on Landsec; whether an On hold brand is safe from the brand tidy; draft
  brand cases are hidden from the plan but still open to a Landsec login on
  the brand-case routes.

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
- **Investment deals stay on the Investment Tracker until Solicitors**
  (Jack, 2026-11-16: "It should only move to other parts of the app once in
  solicitors"). The Deals board, its stat cards, property summaries, the
  Deal Report, a company's deals and the WIP Report (its Deal Detail,
  agent summary and drill-down, Needs attention and the Excel export) leave out an investment deal (deal type
  Purchase / Sale / Investment, or the Investment team) before SOL; lettings
  still show from Marketing. One rule, `dealLeftTrackerSql` /
  `dealLeftTracker` in `shared/deal-status.ts`: never a second list.
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
- **Backfill Tracker Deals is back on, for admins only** (Woody, 2026-11-16:
  "go", after the button answered "Paused during the lettings cleanup" and
  about 21 Landsec units sat on the tracker with no deal). Settings → Data
  Health → Backfill Tracker Deals (`POST /api/admin/backfill-tracker-deals`,
  `backfillUnitBackingDeals` in `server/unit-mirror.ts`) gives every live
  tracker row with no deal its deal, or links the live letting deal already
  on that unit. It has no preview and he knows that; its answer counts the
  rows given a new deal, linked, left alone and failed. It was staff-wide
  before the pause and is admin only now. The other paused tools
  (`LETTING_REPAIR_TOOLS_ENABLED`) stay paused, and it still never runs at
  boot.
- **Withdrawn is shown, not picked** (Woody, 2026-11-20: "only chase live
  deals actually delete the Withdrawn option generally delete is good
  enough"): a deal that falls through is deleted. The deal form, the Deals
  table's status cell, the WIP Report, the Letting Tracker's bulk Change
  Status and the joint agent's Edit unit no longer offer Withdrawn (`WIT`);
  a deal already at it shows it, never a blank box. The Investment Tracker
  keeps it: asked (21 of the 30 Withdrawn deals on live were investment
  purchases), Woody did not answer, so that was the default chosen. One
  rule, `INVESTMENT_ONLY_PICKS` in `shared/deal-status.ts`, read by
  `DEAL_PAGE_STATUSES` and `LETTING_PICK_STATUSES`: never a hand-written
  picker list. Withdrawn is still shown everywhere it was: its label and
  colours, filters, the Historic pill and the tracker's counts
  (`LETTING_STATUSES`). The server still accepts `WIT` on a save, and
  deleting a tracker unit still moves a deal at Negotiating, HOTs or
  Solicitors to Withdrawn with its Ref #, fee and history; a joint agent
  cannot delete a unit and asks BGP. Tests:
  `qa/regression/withdrawn-not-picked.test.mjs`, `shared/deal-status.test.ts`.
- **Still parked for Woody:** the one-live-letting index (schema change)
  and wiring `actingForFromType` (Lease Disposal / Sub-Letting → tenant
  side) — both wait on his review of the integrity report's lists.

## The 14 August email import's offers (Woody, 2026-11-19)

Asked about the 83 offers on 4 Cathedral Walk, Woody chose "1": an admin
Preview then Apply that clears the offers the one-off email import of
14 August 2026 left on the Letting Tracker. Do not re-litigate. That import
(`backfillActivityFromInteractions` in `server/viewing-sync.ts`, called from
nowhere since) replayed three months of stored emails and wrote an
unconfirmed offer for every email that mentioned an offer and could be pinned
on a tracker unit: 970 of the 1,037 offers on live on 19 November 2026, on 31
units (186 on one, 80 on 4 Cathedral Walk), all Pending with no terms, 673
credited to no company, 256 to Landsec and 10 to BGP. None had been touched.

- **The rule** is `shared/email-offer-cleanup.ts` (tests
  `server/email-offer-cleanup.test.ts`, in `npm test`). An import row is an
  email offer carrying the import's key `int_<interaction id>` (only the
  import wrote it; the live inbox sweep writes `conv_` or `msg_`). It is
  cleared only while nothing a person does shows on it: status Pending, no
  confirmation, no agreement, no term, the import's comment word for word, no
  viewing, `updated_at` empty, no negotiation round but the blank round 1 the
  log writes when it is opened (`ensureRounds`), not the unit's Heads of
  Terms offer, on no recommendation, not logged from a comment. Each failure
  is a reason the row is **Kept**. A row credited to a tenant brand (company
  type starting "Tenant") shows as that brand's offer on the Brand CRM, so it
  is listed apart as **Credited to a brand** and ticked one by one (11 on
  live, Krispy Kreme, Choux Bun, Fat Face and Asda among them).
- **One offer per email thread** (Woody, 2026-11-19, on the first preview:
  "these are actual offers but its picking up all the emails so shows hundred
  of entries for each offer").
  - The import wrote one row for every email in a thread. The 970 rows were
    74 threads, up to 144 rows each. A thread is the unit plus the subject
    without Re: or Fwd: (`threadKey`).
  - `threadKeeper` keeps one row per thread as its offer: a row a person
    worked on, else one credited to a brand, else the first email. Only the
    copies are offered for clearing, and the preview lists each unit's
    threads.
  - **Not an offer** on a thread (a newsletter the import caught) clears its
    kept row too (`threads` on apply).
  - Apply leaves a thread's copies when its kept row has gone since the
    preview. A preview made before this rule recorded no kept rows, so apply
    refuses it.
- **The tool** is `server/email-offer-cleanup.ts`, admin only
  (`POST /api/admin/email-offer-cleanup`, `…/undo`, `GET …/runs`), mounted
  from `server/index.ts`; never at boot or on a timer. Preview records the
  ids it may clear (`system_settings.email_offer_cleanup:dry_run`). Apply
  takes the ids the same admin ticked on that preview, within the hour, one
  unit at a time in a transaction: the negotiation log's lock on each offer
  (`unit_offer:<id>`, as `lockOffer`), the rows locked and read again, and
  only those still untouched deleted with their rounds, each written whole
  to `investment_comp_migration_log` (batch `email-offer-cleanup-<time>`) by
  the statement that deletes it. Undo puts back every row of a batch whose
  unit is still on the tracker and whose id and email key are still free.
  Runs are kept in `email_offer_cleanup:runs`.
- **The screen** is Settings → Letting integrity → Backfills → **Offers from
  the 14 August email import** (`client/src/components/email-offer-cleanup.tsx`):
  Preview, the three pills, a tick per unit (To clear) or per offer
  (Credited to a brand), Apply with APPLY typed, Undo under Recent runs.
- Guards: `qa/regression/email-offer-cleanup.test.mjs` (its three real-SQL
  tests need `EMAIL_OFFER_CLEANUP_DATABASE_URL`, which the workflow sets).
  The one-off import must stay uncalled: running it again would write the
  rows back.
- **Who the live sweep credits** (Woody, same day, "Are you fixing it?" when
  asked whether to fix it). The inbox sweep credited an offer or interest
  to the company of whoever was on the email whenever that company was
  typed as a tenant: TfL (typed "Tenant") took offers on the arches,
  Screwfix Direct a House of Wizard offer, Crisp Pizza a Fulai offer.
  `chooseEmailBrand` in `server/viewing-matching.ts` is now the one rule
  for the offer sweep, the interest sweep and the diary interest sync
  (`server/viewing-sync.ts`): one directory brand named in the subject wins
  over the people on the email (the diary matcher's own name reading,
  `inferViewingBrand`), unless the subject names their brand too ("Gails X
  Reiss" stays Gail's; apostrophes are ignored); with no brand named the
  people decide as before; with neither, nothing is written. A contact is
  kept only when it belongs to the brand credited. A company recorded as
  the unit's property landlord (`crm_properties.landlord_id`) is never
  credited. Replayed against the 67 live sweep offers on 19 November 2026,
  29 subjects named another brand than the one credited (Kakure, Fulai,
  Fuel, The 2 Twits, Chayan among them). Rows already written are not
  changed. TfL was typed "Tenant" in the CRM; on 20 November 2026 (Woody:
  "can you change TFL?") it was retyped Landlord on live, as Places for
  London (the recorded landlord of the arches) is, so an arch email naming
  no CRM brand is no longer credited to it. TfL was on no deal.
  Tests: `server/viewing-email-brand.test.ts` (in `npm test`) and
  `qa/regression/email-sweep-brand.test.mjs`.
- Not built, waiting on Woody: the 49 interest lines the same import left
  on 15 units (`unit_interest`, notes starting "Backfilled from synced
  email:"); re-crediting the sweep's earlier rows.
- Not yet applied on live: an admin presses Preview, then Apply.

## Property page rebuild (Woody, 2026-11-13) — docs/property-page-rebuild-2026-11-13.md

Woody: "everything revolves around the leasing plan and the tenancy schedule",
"I want to be able to click on a unit and have it all there", with the
"tenancy schedule remaining the spine". The plan, what he decided, the live
findings, the build order and what waits on him are in
`docs/property-page-rebuild-2026-11-13.md`. **Read it before touching the
property page, plans or the tenancy schedule screens.**

Decided (do not re-litigate):

- **The plan never writes to the schedule.** An outline that matches no
  schedule row is grey context; only a person adds a schedule row.
- **One page for every property**, shaped by what the property has (no
  units, one unit, several units and no plan, a plan), in place of the
  Building / Multi-let / Centre views.
- **One list of units.** "Units and lettings" and the tenancy schedule are
  the same rows; the short list on the Plan tab is the schedule's default
  view.
- **Two facts about a unit, kept apart**: occupancy from the schedule, the
  letting stage only from the tracker row and its deal
  (`docs/unit-status-cleanup-plan.md`). One rule, `shared/property-units.ts`,
  with a test; never a second meaning of vacant or live on a screen.
- **A letting moving on never empties an occupied unit** (found
  15 November 2026). The status mirror (`writeTenancyStatus` in
  `server/lease-status-mirror.ts`) writes "Vacant" to a schedule row only
  when `unitOccupancy` does not read the row as occupied: a row worded
  "Opportunity" or "Not Vacant" with a tenant still on it stays as it is
  while its successor's letting runs. Never go back to a list of status
  words there. Test: `qa/regression/lease-status-mirror-guards.test.mjs`.
- **Documents live in the team's real folder** (`BGP - Share Drive /
  National / National / Landsec / <scheme>`), not the app's `BGP share drive`.

The plan-led layout is the DEFAULT for BGP staff since 13 November 2026
(Woody: "start using the new property layout for everyone"; key
`bgp_property_layout_default_plan` in `use-property-page.ts`), with **Back
to the current page** in its More menu (remembered per browser;
`?layout=plan` / `?layout=classic`). On it the header is Ask ChatBGP and
one **More** menu, Positioning sits on the Brand gap tab, the unit list
shows four filters with the work lists behind **More filters**, "Needs
review" leaves out the plan's own work (it is the Plan tab's Match), and
the People board leaves out tenant companies known only as a unit's
occupier (the schedule shows them) and an owner's directors once anyone at
the owner is tied to the property. Every Landsec login always gets the plan-led page (Woody, 2026-11-14:
"yes", then "Joint agents need to be on new layout"); every other client
login gets the page as it was (`planLayout` in `property-detail.tsx`).
**The page is the same for everyone, and everyone amends it** (Woody,
2026-11-14: "Why are you adding random restrictions the app is for everyone
to be able to amend including the client and the joint agents. Put the
activity up there for everyone. Everything is the same"). On the plan-led
page `uiClient` / `uiJointAgent` are off: every tab, the Activity and
conversation row, Folders, News & social, People, Brand gap, plan matching
and the unit panel's letting buttons (to the login's own Letting Tracker)
are there for every login. The intro row's left card is **BGP take** (the
saved commentary, `BgpCommentaryWrapper`) with Activity behind it, and its
right card the conversation with **People** behind it (Woody, 2026-11-14);
People is no longer a main tab and the BGP take is no longer on Details;
This week's focus is the left card's third tab. The property's facts
(status, asset class, use class, teams, owners and lenders, area, website,
competitor agent) are a row of editable pills above the tabs
(`property-facts`), and the Details tab (KYC, Needs review, schemes,
investment) is shown to admins only (Woody, 2026-11-14; renamed Ownership &
KYC, with investment moved beside the BGP take, on 23 November 2026: see
"Ownership & KYC on the property page"). People's tenants
and agents group is `UnitPersonLine`: a named person is the landlord pages'
own `KeyContactRow` with Tenant or Agent beside the name and the unit
(linked to its deal) and company under it (Woody: "the same structure as
we built in the Landlord pages"); a company with no named person is one
line reading "No named contact". A brand's Tenant rep
**Add agent** is open to every login that can open the brand
(`POST/PATCH /api/brand/representations` check `canUseBrand`).
The **Landsec Calendar** (`/landsec/calendar`, on the Landsec menu after
Letting Tracker) is the tracker's viewings calendar with Landsec's meetings
on it (`meetings` on `LeasingViewings`, `landsecMeetings` reading
`GET /api/team-events?pastDays=`), each a `MeetingRow` drawn in the secondary
colour; the client-events sync now also sweeps `LANDSEC_MAILBOX` and counts
an invitation to it as Landsec's, and keeps past meetings (it replaces only
its own window). A joint agent's calendar stays its Viewings page.
What a login may read or save is decided on the
server, never by hiding a control. The only differences kept: a joint agent
does not open brand pages (no brand links), the More menu's BGP pages
(Image Studio, documents, evidence plan, folder set-up, delete) are BGP
staff's, and a client's Folders is its own data room. A client login edits a
contact's job title as BGP does (Woody, 2026-11-14, asking why the contact
menu had lost options: it had been taken off for clients that morning, not
by his decision; the server holds a client to its own contacts and its
brand list). Do not add a hide-for-clients switch to this page.
- **A joint agent on the page**: `restrictedLandsecApiDecision` hands a
  request the joint agent rule refuses to the ordinary client checks when it
  is about a property at one of its schemes (`jointAgentPropertyRef` in
  `shared/landsec.ts`: the property, a plan, an outline, a schedule row, a
  review item, or `?propertyId=` on the activity feed, lease events and the
  folder root; the server looks the property up). Anywhere else, or when the
  property cannot be worked out, it stays refused. Its folders are the bound
  folders of its schemes' properties only (`jointAgentRoots` in
  `server/client-sharepoint.ts`). Brand pages, the company list and BGP's
  agent list stay closed to it. The page as it was is
untouched when it is off, and
`PropertySection` and the tab mapping (`tab(full, simple, plan)` in
`property-detail.tsx`) are how each existing card finds its tab.

- **One feed**: `GET /api/properties/:id/units` and `…/units/:unitId`
  (`server/property-units.ts`), a fixed number of queries per property. The
  list, the plan colours and the pills all read it. `propertyReadBlocked`
  is the read check (a client login on its own properties; BGP staff viewing
  as a client are held to that client's properties). No fee, internal agent
  or BGP note on a target is in either reply. A joint agent READS it, one
  unit and a plan's match board (GET only, since 14 November 2026) at its own
  schemes: `propertyReadBlocked` checks the scheme, and `unitViewerFor` /
  `jointAgentUnit` also leave out the brand's KYC4U record and the brand ids
  behind a target. An asset manager is a full Landsec login since 13 November
  2026 and reads it as one. An archived
  schedule row is history, not a unit, unless a live letting still hangs off
  it: a letting is never hidden because its row was archived.
- **Units tied together** (Woody, 2026-11-14, step 1 of
  `docs/consistency-review-2026-11-14.md`: "Yes go ahead"). A schedule row's
  tracker row and deal come from the unit feed or the stored ids
  (`letting_tracker_unit_id`, `deal_id`, a tracker row's `deal_id`), never
  from a unit or deal NAME: the schedule screen no longer uses
  `findTenancyUnitLink`. Its Occupied and Vacant counts and pills read
  `unitOccupancy`. Every jump to a unit goes through
  `client/src/lib/unit-links.ts` (`trackerUnitHref`: `/available` for staff,
  `/deals/letting` in the Landsec view, `/landsec/tracker` for a joint agent;
  `propertyUnitHref`: the property page at `#tenancy-unit-<id>`). A new
  schedule row is knitted to a tracker row, leasing row or deal only by
  `normUnitSql` and only when exactly one schedule row and one candidate
  carry that name (`server/tenancy-schedule.ts`); links that name different
  units are reported as `unitPointersDisagree` on
  `GET /api/admin/letting-integrity`, never repaired. Last contact on the
  brand, landlord and property boards goes through `shared/last-contact.ts`
  (`latestPastContact`, `daysSinceContact`, `lastContactShort`: a date ahead
  is "Next", never a last touch). The brand page counts the requirements the
  server sends by the live rule, never `status === "Active"`. A company on a
  row is drawn by `client/src/components/company-chip.tsx` (logo or
  initials, name, link only when the reply carried an id, optional role).
- **The BGP team is part of People** (Woody, 2026-11-14: "the bGP team
  block should be wrapped into people rather than have a block", then
  "Go"). One row for a BGP person everywhere,
  `client/src/components/bgp-team-group.tsx` (`BgpTeamGroup`, `BgpTeamRow`):
  the first group of Key contacts on landlord and brand pages, desktop and
  phone (`CompanyBgpTeam` in `company-bgp-team.tsx`, through the contacts
  board's `teamSlot`), the BGP group of the property People board
  (`bgpGroup` in `people-board.tsx`), and the head of the deal's Parties
  card (`dealBgpTeam` in `deal-detail.tsx`). On a company it reads the
  account's people (`coverers`, which now carry email and phone) for every
  login and, for BGP staff on a landlord, the landlord team read
  (`/api/crm/landlords/:id/team`): roles at its properties, suggested roles
  to confirm, and email and meeting counts that open that person's history.
  A client login gets names, roles, email and phone only: no counts, no
  last contact, no suggestions, no menu. The separate landlord team block
  (`landlord-relationship-team.tsx`, deleted), the brand's team cards and
  chips (`CovererChip`, `BgpTeamMenu`), the property's agent chips on the
  plan-led page and the deal's "BGP contact" text are gone. Deal agents are
  still changed in Fee allocation, where the split lives. The classic
  property page keeps `InlineAgents`.
- **One conversation per property** (Woody, 2026-11-14: Letting Tracker
  comments should be "nice and easy" and "all just go into the property
  chat"). Until then the property box made a private thread per person.
  `server/record-conversation.ts`: the shared thread's creator is the marker
  `__record__` (nobody's own chat, nobody can delete it); `POST
  /api/chat/threads/record/property/:id` checks `propertyReadBlocked`, makes
  the thread once (advisory lock) and joins the caller through
  `storage.addChatThreadMember`; everything else is the ordinary chat routes.
  It is quiet (the message POST in `routes.ts`): a push only to the people a
  message tags, a tag pulls in BGP staff only (`mayBeTaggedIntoRecordThread`;
  a client joins by opening the property), and ChatBGP answers only when
  asked by name, never joining for good. Everyone who can open the property
  reads what is written there, ChatBGP's answers to BGP staff included: the
  box says so. Each message names who wrote it (from the thread's members;
  until 15 November 2026 every message but your own read "Team"). Earlier
  private threads stay private. Tracker comments are
  `client/src/components/unit-comments.tsx` (`UnitCommentButton` on each
  row of the staff tracker, desktop and phone; counts from `GET
  /api/chat/threads/record/unit-comments?propertyIds=`, read only for
  properties the caller may open): a message tagged with the unit. Guards:
  `qa/regression/record-conversation-guards.test.mjs`. **A joint agent
  uses it too** (Woody, 2026-11-15: "Sort the list"): opening the box on a
  property at its schemes, or on a shared centre page, joins the shared
  conversation whatever has been written there already (its gateway opens
  `POST /api/chat/threads/record/property/:id` and nothing else new; the
  handler's property check is the door; `chatMemberDenial` and the member
  insert in `storage.addChatThreadMember` waive "before the first message"
  for that one thread only). It reads it as it reads any conversation:
  redacted for that reader, tags only at its own schemes
  (`linkPropertyIds` on `ChatJointAgent` is what it may HOLD a conversation
  on; `propertyIds` is still what it may tag, read and ask ChatBGP about).
  Not yet: comment buttons on the joint agent's tracker, company and deal
  conversations.
  **When the property goes** (15 November 2026; `server/record-thread-links.ts`,
  tests `qa/regression/record-thread-links.test.mjs`): deleting a property
  deletes its shared conversation with it, messages and members included,
  in the same transaction (`storage.deleteCrmProperty`); merging two
  properties moves the duplicate's conversation to the keeper, or joins its
  messages and people to the one the keeper has (`mergeSharedPropertyThreads`,
  inside the merge); and `GET /api/chat/threads` leaves out a shared
  conversation whose property no longer exists, for records removed some
  other way. A person's own thread linked to the property is never touched.
  Anything new that removes a property record must do one of these.
- **Matching: a scan's matches are saved, not checked** (Woody, 2026-11-16:
  "fold the whole matching units to tenancy schedule and upload scan process
  into the main plan page ... the base case should be that the scan and
  tenancy schedule matches dont need checking they are all done immediately
  and then there is the ability to edit should it be required"; do not
  re-litigate). `shared/property-plan-match.ts`,
  `server/property-plan-match.ts` (`GET /api/plans/:id/match`, `POST
  …/match/accept`, `…/accept-all`). A finished scan is marked ready and
  every outline it found is saved in the same transaction, under the plan's
  lock (`completePlanScan`, called by the scan runner): linked to the free
  schedule row its printed unit number names (else its tenant's name, else
  a floor tie-break), whatever tenant or floor the plan prints, and saved
  unlinked (grey) where nothing points at exactly one row. Where two
  overlap the surer reading stays and the other is set aside
  (`planSaveOrder`). A failed save leaves the proposals open for **Save
  them** on the Plan tab (`…/accept-all`), which is also how a scan from
  before 16 November is saved. Removing an outline marks its proposal "not
  a unit" (`setRemovedOutlineAside`, inside `DELETE /api/plan-units/:id`), so
  nothing comes back by itself. The unit number printed on the plan decides
  before the tenant's name; one schedule row has at most one outline per
  floor (also enforced on the older save routes in
  `server/property-plans.ts`); the plan never writes to the schedule. The
  client gateway lets client logins reach `…/accept` and `…/accept-all`,
  as it did the older apply route (the handlers check the property with
  `propertyReadBlocked`): until then the Match screen's saves were refused
  for every client login although the screen offered them.
  - **The Plan tab is the one place for it** (`plan-workspace.tsx`): Upload
    plan (each page cropped or used whole, then the scan), Add from (BGP
    staff), **Edit plan** (Scan again for staff, Rename this floor, Crop,
    Restore the whole page, Original PDF, Delete), the scan's progress, a
    grey outline's panel (`OutlinePanel` in `match-panel.tsx`: the units it
    could be, Choose a unit, Remove from plan, Next not linked), the unit
    panel's plan block (Not this unit, Unlink, Remove from plan, for
    everyone, not only BGP staff) and **Find it on the plan** (click inside
    the unit: the outline under the click is taken, even another unit's,
    else its walls are traced; or Draw its corners instead). The Plans
    dialog, the Match screen and the one-shot Review scan are gone from the
    plan-led page. The classic page's Plans card keeps its tools, with a scan
    status (`property-plan-scan-status.tsx`: Scanning…, Scan again, Save N
    scanned outlines) in place of Review scan; the older apply route
    (`applyPropertyPlanScan`) is kept for cached clients.
  - **Draw a unit** (Woody, 2026-11-19: "the plan on the property page has
    lost the ability to draw a unit and allocate to the tenancy schedule
    where the scan hasn't worked. we had that in the lease advisory version
    works well"). The Plans window's Trace and Draw tools did not come across
    on 16 November. The button beside Edit plan (everyone who may amend the
    plan) works outline first, as the lease advisory plans do: corners and
    Finish, or Click inside it instead (the walls traced; an outline already
    under the click is taken), then **Choose the unit** (`RowPicker` over the
    schedule units with no outline on that floor, those the schedule puts on
    that floor first, a grey outline's possible units first) saves it linked,
    and **Save it grey** saves it unlinked (`status_override` "unlinked", as a
    grey scan outline is). The bar then waits for the next unit until Done.
    It saves through the routes Find it on the plan uses (`POST
    /api/plans/:id/units`, the outline PATCH, a proposal's accept) and never
    writes the schedule. The empty plan, a failed scan and a scan that found
    nothing point at it. Guard: `qa/regression/plan-draw-unit.test.mjs`.
- **Cropping a plan** (Woody, 2026-11-16: "ability to crop the page when
  loading up"). Rules and tests: `shared/plan-crop.ts`,
  `shared/plan-crop.test.ts` (in `npm test`). `POST /api/plans/:planId/crop`
  (a box as fractions of the page, in `server/property-plans.ts`) cuts the
  image to a new PNG and, in one transaction, re-measures every outline
  against it. An outline wholly outside the crop is removed only when it is
  tied to no schedule row; **a crop that would cut through an outline, or
  leave a matched unit outside, is refused** (409), so cropping never loses a
  match. The page as loaded stays in the store and is named in the cropped
  image's key (`<page key>.crop-<left>-<top>-<width>-<height>-of-<W>x<H>-<stamp>.png`,
  `planCropOrigin`): `POST …/crop/undo` (**Restore the whole page**) puts it
  back with the outlines; there is no column for it. A crop changes
  `storage_key`, which every scan check already compares, so a scan of the
  old image is stopped and, for BGP staff, started again on the new one.
  The plan image route answers with an ETag of the key and `no-cache` (it
  was a day's cache; a cropped plan at the same address would have shown the
  old picture under moved outlines), and `usePropertyPlanImage` takes the
  key where the caller has it. **Upload plan** sends `autoScan=false`, then
  shows each page to crop or use whole (`UploadPlanButton` in
  `property-plans-panel.tsx`, `PlanCropBox` in `property-plan-crop.tsx`) and
  starts the scan after that step; closing part way uses the remaining pages
  whole. **Crop this plan** and **Restore the whole page** are in the plan's
  Edit menu. Open to every login that may edit the plan (the client gateway
  lists both routes; the handler checks the property). Brochure and
  SharePoint imports have no crop step: crop them from the Edit menu.
  Guards: `qa/regression/plan-crop-guards.test.mjs`.
- **Client**: `client/src/components/property-page/`. Tests:
  `shared/property-units.test.ts`, `server/property-page.test.ts` (its SQL
  half runs in a throwaway schema and needs `PROPERTY_PAGE_DATABASE_URL`
  naming a local database with the app's tables),
  `qa/regression/property-units-guards.test.mjs` (in `npm run qa:regression`).
- **The company on the lease** (Woody, 2026-11-13: trading names "should
  be linked to brands but their actual AML contracted company name is often
  different and should be a sub company within the brands for covenant
  checking and AML"). Plan, and what waits on him:
  `docs/tenant-entity-plan-2026-11-13.md`.
  - A schedule row has a **brand** (`tenant_company_id`), a **lease name**
    (`tenant_name`, plain text a person types), a **trading name**, and the
    **company on the lease** (`tenancy_schedule_units.tenant_entity_id`,
    migration 0061: a `crm_trading_entities` row under the brand). It is NOT
    `crm_deals.tenant_entity_id`, which is a Xero contact id.
  - **One write door**: `server/tenancy-tenant.ts` (`setTenancyTenant`,
    `relinkTenantAfterNameEdit`), rules in `shared/tenant-entity.ts`
    (`planTenantWrite`; tests `shared/tenant-entity.test.ts`,
    `server/tenancy-tenant.test.ts`). A name that matches no brand never
    wipes a brand; a brand a person set stays; a tie between two brands links
    neither; a vacant row loses brand and company; a lease name that names
    another company takes the company off; a company always sits under the
    row's brand. The door never creates a brand, and creates a company only
    when a person asks (`createEntity`). Each change to the company on the
    lease is logged in `investment_comp_migration_log` (batch
    `tenant-entity-door` or `tenant-entity-system`). Route:
    `PUT /api/tenancy-schedule/unit/:id/tenant`. The schedule's row save runs
    the same rules on a name edit and sends back `tenant_notes`.
  - **Every other writer goes through it** (imports, ChatBGP, evidence plan
    unit edits, review answers): the row's tenant columns as they were
    BEFORE the write, inside the writer's own transaction, with the right
    actor. A `{ system }` actor counts as BGP staff: never give one to a
    client login or a shared-plan editor (`chatTenantActor`). The two
    completion reverts clear the company with the brand; a duplicate merge
    carries it only when the brands agree; `sql_write` refuses
    `tenant_entity_id` on schedule rows and any delete of
    `crm_trading_entities`; deleting a company is refused while a schedule
    row points at it. Guards: `qa/regression/tenant-entity-*-guards.test.mjs`.
  - **The Tenant cell** on the tenancy schedule (`TenantCell` in
    `PropertyTenancySchedule.tsx`, `lease-company-picker.tsx`): the brand
    (picked by id; "by name" marks a brand matched only by name), "Lease:"
    and the lease name, and for BGP staff the company with its Companies
    House number and its own covenant badge. The picker-only Tenant column
    is gone on purpose. A row with no brand is one line: never make every
    row taller.
  - **Client logins** (Woody, 2026-11-13, answering the plan's section
    10): SEE the company on the lease read-only (name, Companies House
    number, its covenant badge) on the schedule and in the unit feed; only
    BGP sets it (`STAFF_ONLY`). A client's change of brand, vacancy or lease
    name GOES THROUGH ("let it through") and takes the company off by the
    ordinary rules, logged with the client as the actor. Clients may add a
    brand to their list from the schedule's pickers. The client gateway
    allows `/api/covenant/<number>` for a number that is the company on the
    lease of a schedule row on one of the client's own properties. The
    "No company on lease" flag, count and lease-company state stay BGP's
    work list. Bulk creation of companies from lease names is parked
    (Woody: "lets leave that for a sec"); AML stays on the brand.
  - **Feed and panel**: `PropertyUnit.tenant` carries `entityId`,
    `entityName`, `companiesHouseNumber`, `leaseCompany` and the brand's
    `kyc`; "No company on lease" in the unit list is the work list. The
    state is `leaseCompanyState` of the row's STORED brand, the call the
    Tenant cell makes: never pass it a brand found by name. The client cut
    (the work list only) is `clientUnit` / `unitsForViewer` in
    `server/property-units.ts`.
  - **Back-fill** (Settings, beside the letting back-fills;
    `server/tenant-entity-backfill.ts`; `POST
    /api/admin/tenant-entity-backfill` and `/undo`, admin only): Preview
    then Apply, links only. A row is linked only to the ONE existing
    verified company (a Companies House number, or the brand's default)
    under a brand the row's own trading name confirms, whose legal name
    equals the lease name (Limited against plc is listed, never linked). It
    creates no company and sets no brand; Apply takes the ticked pairs from
    the admin who previewed, within the hour, with `previewedAt`.
  - **AML is unchanged**: the deal gate still reads the brand's KYC4U
    status. AML on the company on the lease is the next step and waits on
    Woody, as do bulk creation of companies from lease text and a visible
    history of tenant changes.
- **People on a property** (Woody, 2026-11-13: "I feel like we need all
  boards to use the same Contacts approach?"). Plan, and what waits on him:
  `docs/contacts-board-plan-2026-11-13.md`. The property page is the first
  board on it; the landlord, brand, deal and brief boards have not moved.
  - **Feed**: `GET /api/properties/:id/people` (`server/property-people.ts`),
    a fixed number of queries. Groups are `PEOPLE_GROUPS` in
    `shared/record-people.ts` (BGP team, client's team, landlord and owner,
    tenants and agents by unit, others on deals, advisers, added by the
    team). A person sits in the first group any relationship gives them, and
    each relationship carries its schedule row and tracker row, found on the
    server by the unit feed's own four ties (a guard keeps the two in step).
    Order is group, set roles, then name: never recency.
  - **One client rule**: `recordPersonForViewer` builds every entry afresh
    from an allow-list and never spreads its input, so a new field reaches
    nobody until it is named there. Staff only: last contact, the CRM plan,
    who pinned someone, source and via, people known only from a viewing, an
    offer or being in touch with BGP, and a BGP person's deal. The staff
    test is `contactViewer(req)` (`server/contact-viewer.ts`): BGP staff
    viewing as a client, and a session scoped to a company, count as NOT
    staff. A client's entry id may be `company-entry:<n>`: never read a
    company id out of an id; the `contactId` and `company.id` keys are the
    permission to open a record.
  - **Role at a property**: `crm_property_clients`, for the owner's own
    people only, set by BGP staff (`PUT` and `DELETE
    /api/properties/:id/people/:contactId/client-role`). It is the "property
    client" mark on the landlord's Key contacts, and it is not the job title
    (`crm_contacts.role`). A role on a unit's brief reads "on the <unit>
    brief", never "this property".
  - **CRM plan**: `planForCompanies` in `server/crm-engagement.ts` (two
    queries: open actions, the next one, active strategies), staff only. If
    it fails the people still load and the reply says `plan: "unavailable"`.
    Add action from a person opens the existing `ActionEditor`; only a brand
    action at one of the share partners' schemes carries a place
    (`actionPlaceFor`), a landlord action never does, and the person is named
    in the notes only (never `linked_property_id` or `linked_contact_id`:
    client logins read tasks by property).
  - **Screen**: `client/src/components/property-page/people-board.tsx`
    (`PropertyPeopleBoard`, and `UnitPeopleBlock` in the unit panel), on the
    plan-led page only; the classic Contacts card is unchanged. Everyone
    with a CRM record is drawn by `KeyContactRow`
    (`company-contacts-board.tsx`) through one adapter that names each
    field. Its four optional slots (`recordRole`, `aside`, `menuItems`,
    `onChanged`) change nothing on the landlord and brand boards
    (`qa/regression/key-contact-row-slots.test.mjs`). Each person is drawn
    once, even when on several units.
  - `KeyContactRow`'s job title editor is open to client logins (Woody,
    2026-11-14: everyone amends); the client CRM guard holds the save to the
    client's own contacts and its brand list. Only a joint agent has none.
- **Approved by Woody on 2026-11-13** ("yes do it all"): pushing step 1
  live behind the button; loading the May 2022 Bluewater plan; the link from
  a schedule row to the tenant's legal entity (`tenant_entity_id`); the
  shared contacts board, with the property page first.
- **Still waiting on Woody** (the note lists them): unit links on comps and
  lease events, retiring the Layout choice, narrowing the schedule's Status
  box, the brochure card and the documents root, one store for target
  brands. (Joint agents on the real pages was on this list until Woody
  answered on 14 November 2026: they read them at their own schemes; asset
  managers were answered on 13 November.)

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
  BGP staff, or the scheme's joint agent, may record an agreement for someone
  with no login, and the brief says who recorded it. A change to the brief's terms (the text fields, the
  commercials, the agency basis) raises `version`; a signature on an earlier
  version no longer counts and the timeline says so. `agreed_at` is set only
  while everyone has agreed the current version AND the brief has at least
  one BGP agent and one person on the client side (one side cannot agree it
  alone by removing the other). A BGP agent is a BGP staff login picked from
  the list, added and removed only by BGP. A person with a login agrees for
  themselves; an agreement is recorded only for someone with no login.
  Names and emails come from the login or CRM record, never from the form. Never let a request write
  version, agreed_at, unit or property: `saveBriefFields` is the one write
  door for a brief's fields.
- **Comments**: each person's own, labelled with what they are on the brief
  and the date; AI help drafts a comment for the person to edit and save,
  never saves by itself. The app's own lines (agreed, terms changed, person
  added) sit in the same timeline as `kind = 'event'`.
- **Access** is `briefAccess()`: BGP staff everywhere; a client login on its
  own properties (a Landsec asset manager is one, on every scheme); a Landsec
  joint agent on their own schemes only (the restricted gateway lets them
  reach `/api/unit-briefs*` and the unit's brief and files, and every handler
  checks the scheme). A joint agent
  on the scheme has full control of the brief (Woody, 2026-11-12: "Joint
  agents should have full control like us"): terms, commercials, agency
  basis, files, targets, the AI draft, Add brief, the client's people and
  joint agents, and recording an agreement for someone with no login
  (`agentControl`). Still closed to them: BGP's notes on the targets (the
  server keeps the stored values whatever they send and redacts replies with
  `targetForViewer`), the generated Targeting Brief document (`seesBgpNotes`
  is false), BGP's own agents on the brief, and deleting a brief someone has
  signed.
- The quoting rent, service charge and rates on the brief are written through
  to the tracker row. The Landsec unit page opens the same brief. The older
  two-signature "Agreed brief" card on that page (`landsec_units.brief_*`)
  is still there and still feeds the NER floor check: retiring it in favour
  of this brief is Woody's call.
- **Describe the brief in your own words** (Woody, 2026-11-19: "brief form
  needs our type and populate tool"). A box at the top of the Brief tab
  (`client/src/components/unit-brief/brief-note-fill.tsx`): the person types
  the brief or pastes the client's email, presses Fill the brief, and the
  Brief boxes (title, client, objective, location, criteria, priority
  categories, instruction, success measures, the three dates and both
  deliverables, targets and priority A wanted) and the Commercials fill. It
  only fills the form: the dialog's Save is the only save, and the read-back
  lists what was filled and what could not be placed, with the reason.
  `POST /api/unit-briefs/read-note` (`server/unit-brief-workspace.ts`) is
  keyed by the unit, so it works before the brief exists, and is open to
  whoever may change the brief (`briefAccess`, then `canEditTerms`: BGP
  staff, a client login on its own properties, a joint agent on its schemes;
  both gateways already open `/api/unit-briefs/`). The reader
  (`server/brief-note-reader.ts`) is Anthropic only, called directly, one
  forced-tool call a read, capped a day (`BRIEF_NOTE_READER_DAILY_CAP`,
  default 300, 0 = off), and is sent only the note, the boxes, the unit's
  category list, today's date and the unit and scheme names. Every value is
  checked against the note before it fills (`shared/brief-note.ts`, tests
  `server/brief-note.test.ts` in `npm test`): a text box takes a span of the
  note or wording that is at least 80% the note's own; a date, a count and
  every figure come with the words they were read from; money is a year's
  (a figure the words make a month's or a square foot's is listed back,
  never filled); rent free must stand in months, the lease in years, turnover
  rent as a percentage; a priority category must be on the unit's list
  (Landsec's agency brief list at a Landsec scheme) and asked for in the
  note, and is added to those already chosen. The older Draft with AI and
  Upload the client's brief stay as they were (no literal checks: they fill
  for review). Guard: `qa/regression/brief-note-fill.test.mjs`.
- **The figures at the top of the Brief tab are buttons** (Woody, same day:
  "the pills at the top are not clickable"). The six section pills already
  switched sections: pressed in a browser on live, as Woody, on deal #4213's
  brief from the deal page, each one did. What did nothing were the figures
  under them, so Targets, Priority A, Meetings and Inspections now open the
  Targets section showing those targets ("Showing … Show all"), a deadline
  figure goes to its date box, and the sign-off chip by the title opens
  People & sign-off.

## Offer to Solicitors on the Letting Tracker (Woody, 2026-11-12)

The older **Promote to Solicitors** route (`POST
/api/available-units/:id/create-deal`; since 17 November 2026 no screen calls
it: the status column opens the one deal form below) is BGP staff only since
2026-11-13: no client screen offers it and a client login is refused. It refuses a move to Solicitors when a party the deal is
about to carry has been rejected by the MLRO, before anything is written
(the parties from the form where it gives them), and refuses the same way
when it is asked to put a new tenant or landlord on a deal already at
Solicitors; it keeps the form's "AML / KYC checked" answer only from the
MLRO, because on the deal that field is the MLRO's sign-off and lifts the
gate (an agent who answers YES or N/A is told it was not kept; a sign-off
that is kept goes on the deal's history); and it records the status change
and any AML warning on the deal as every other move to Solicitors does. The
same review found the deal page's gate read only the parties stored before
the save: the save (`PUT /api/crm/deals/:id`) now gates the parties the deal
will carry after it, so a rejected tenant named in the same save as the
status is stopped, and a deal created straight at Solicitors or later
(`POST /api/crm/deals`) is stopped the same way, on the parties the new deal
names (a client's own company as its landlord). Any new route that sets a
party and a status together gates the parties as they will be.

Who may put the sign-off on a deal: "AML check" is changed only by the MLRO
on a save and on the Promote box; a new deal never takes it from a client
login, and "KYC approved" is never set by making a deal, whoever asks (it is
given on the deal page). BGP staff can still start a deal with "AML check:
YES" from the New Deal form: whether that stays is Woody's call. Where the
MLRO's block answers a client login it says the deal is held and nothing
else (`AML_HELD_FOR_CLIENT` in `server/deal-gates.ts`): never the party or
the reason. Tests: `qa/regression/aml-gate-doors.test.mjs`.

**One deal form for Solicitors (Woody, 2026-11-17).** His words: "in each of
these situations lets have one form its exactly the same. use the new deal
form as the basis but we need billing entity also linked to the tenants with
ability to create as per the last one. also the type it and AI fills in
ability in a new box at the top. This will then cover all eventualities." It
replaces the Promote box's own form (rebuilt that morning and replaced the
same day, never live). Do not re-litigate. Tests:
`qa/regression/promote-to-solicitors.test.mjs`, `qa/regression/deal-dialog.test.cjs`.

- **One form**: `DealFormDialog` in `client/src/pages/deals.tsx`, with the New
  Deal form's essentials body (`SimplifiedCreateBody`). New Deal opens it as
  before. A **handover** (`DealHandover`, opened through `DealHandoverDialog`,
  which loads the deal and the lists the form picks from) opens it on a
  Letting Tracker unit's own deal, at Solicitors, with the property and unit
  fixed (`place`) and no Show all fields: `kind: "promote"` from the tracker's
  Deal Status column (BGP staff; `promoteUnit` in `available-units.tsx`), and
  `kind: "hots"` from the Heads of Terms dialog's Convert to Solicitors step
  for BGP staff. A joint agent keeps `HotsConvertForm` there (it has no CRM,
  BGP people or fee). `handoverForm` is the start: the deal's own values, the
  unit's fee, rent and size where the deal has none, the property's landlord,
  and for hots the agreed offer's tenant and terms (a new tenant clears the
  billing entity).
- **It saves through the doors the deal already has, never a new deal**
  (`saveHandover`). Promote is the deal's own save at SOL (`PUT
  /api/crm/deals/:id`: the AML gate on the parties after the save, the
  history line "Moved to Solicitors from the Letting Tracker", the mirror to
  the tracker row; its `X-AML-Warning` header is shown); a tracker row with no
  deal is first given one by `POST /api/available-units/:id/ensure-deal`.
  Hots saves the deal's other details through the same PUT (no status, none
  of the six terms), then the tenant and the terms through `POST
  /api/unit-hots/:unitId/convert`, which keeps its checks (final HOTs on
  file, the agreed offer, the AML gate) and its event line; with no deal yet
  the convert heals one and the PUT follows. Then the fee split (`saveSplit`:
  `internalAgent` is never sent, the split's own save keeps BGP Contact in
  step) (and the joint agency note, until that was retired on 23 November
  2026). The old Promote route (`/create-deal`) is
  called by no screen now; it stays for a cached client.
- **Describe the deal**, the box at the top (BGP staff, New Deal and both
  handovers, never the edit form): `NoteFill` with `readUrl=
  "/api/deal-notes/read"` (`server/unit-note-reader.ts`), the letting note
  reader read as an offer with the same rules (tight shorthand fills; a note
  written out in full lists Use lines), for a deal with a tracker unit (its
  brands count) or only a property. BGP staff signed in as themselves only (a
  client login or staff viewing as a client is refused, and the address is on
  no client gateway list); one read of the users table, shared with the unit
  route (`staffNamesFor`). `client/src/lib/deal-note.ts` (`dealNotePatch`)
  maps a reading: rent, lease length, rent free, break and capital
  contribution fill; the tenant only when the tenant picker lists it (else
  "Brand read as"); anything else is a Comments line, once. An offer's date is
  never the target date. A note led by a brand that is not on a unit is not
  tight. Since 20 November 2026 the box also reads the deal itself: see
  "Describe the deal reads the deal" below.
- **Add heads of terms**: the New Deal form's HOTs parser
  (`/api/crm/deals/parse-hots`) fills the form; on promote the document is
  first filed on the unit as its final agreed Heads of Terms (`POST
  /api/unit-hots/:unitId/final`: `hots_final`, never public, moves no
  status), and a handover is not moved to HOTs by the reading; hots shows the
  file already on file instead. Client logins no longer see the button (the
  parser was always refused them). The note reader's `hots_final` source,
  built for the Promote box, was removed with it.
- **Lease terms and fee agreement** are on the essentials body for every
  leasing type: lease length, break (words: the column is text, and the save
  no longer reads it as a number, which blanked a worded break), rent free,
  capital contribution, total area (the save keeps a typed total when no
  floor areas are given; before, it saved it blank) and Fee agreement signed.
- **Duplicates** (Woody, 2026-11-17: "We are hitting duplicate issues when a
  deal is added to the app but its also on the letting tracker at the same
  time"). A letting deal at Solicitors is on the tracker: it is one record.
  New Deal takes the unit's row when it has no live deal and refuses a second
  live letting on the unit (`findLiveLandlordLetting` in
  `server/letting-service.ts`: the same unit record, schedule row, or unit
  name before any comma). **Use that deal** on New Deal's "Already on the
  Letting Tracker" notice now opens that unit's own deal in the one form
  (promote) while it is before Solicitors, else the deal page. Unit names
  that differ ("Unit 12" and "12"), a duplicate property record, or a deal
  type that is not a letting still get past the check, and the integrity
  report (`GET /api/admin/letting-integrity`) lists such pairs: a looser match
  is Woody's call.
- **Billing entities linked to their party** (Woody, 2026-11-17: "tenant
  and Landlord first then the billing entity comes up linked to that tenant
  or landlord"). On the essentials body each party (landlord, tenant, vendor,
  purchaser) gets its own **Billing entity for <name> (Xero)** box once the
  party is picked, BGP staff only (`!hideFees`: Xero is BGP's and a client
  login cannot reach it, so the box never worked for one). The picker's
  `createFor` is that party: it lists the companies filed under it first
  (`crm_trading_entities`, the `leaseCompaniesKey` cache shared with the lease
  company picker); picking one with a Companies House number goes through
  `POST /api/billing-entities`, which keeps it under the party and finds its
  Xero contact by name or makes one; without a number its name is searched
  in Xero. **New billing entity for <name>** is always offered at the foot.
- **Kick off AML** (Woody, 2026-11-17: "on the form we need a button to allow
  us to Kick off the AML"). When New Deal or a handover saves, BGP staff see
  the form turn into a Kick off AML step (`showAmlStep`, `amlStep`): one
  `Kyc4uRequestButton` (label "Kick off AML") per party on the saved deal,
  the deal page's KYC4U request (prefilled from the deal; the person checks
  and saves it, then clicks the Send to ChatBGP bookmark on KYC4U's page and
  presses Submit there). The edit form and client logins never get it, and a
  deal with no party closes as before. It cannot send the request by itself
  until KYC4U agrees to take requests some other way, or the in-app checks
  (`IN_APP_AML_ENABLED`, ComplyAdvantage and Veriff) are switched back on.
  While the client checks are on (their own switch since 18 November 2026,
  on unless `KYC_CLIENT_CHECKS=off`), each button is **Send client checks**
  instead (`clientChecks`, read from `clientChecks` on
  `GET /api/kyc/deal/:id/status`), and a party with a red flag keeps the
  KYC4U request; see "Client checks" below.
- **Create billing entity** (`server/billing-entity.ts`,
  `POST /api/billing-entities { brandId, companyNumber }`, `brandId` the
  landlord or brand, BGP staff signed in as themselves;
  `client/src/components/billing-entity-create.tsx`). The
  Xero picker (`xero-contact-picker.tsx`) says "not in Xero yet" when the
  firm's link answered with contacts and the search found none, and keeps the
  reconnect line for a real connection problem; with `createFor` (the one
  deal form's four party boxes, for BGP staff) it offers Create billing
  entity. The company is read from Companies House on the server
  (never a name or address from the request; a closed company is refused),
  saved under the brand with `insertTradingEntity` (never a brand; a company
  of that name already there is reused unless its number differs) and logged
  (batch `billing-entity`), then made a contact in the firm's Xero through
  `withSystemXero` after a search by name (the invoice routes' POST
  /Contacts), and selected: the deal stores its ContactID as the tenant's
  billing entity. `rememberXeroContact` puts it on the picker's cached list.
  A Xero refusal leaves the company saved and says why. It has not been run
  against Xero or Companies House from a build machine.

The run from a first offer to solicitors is three linked pieces on a unit.
Migrations 0051 to 0053. All access goes through `briefAccess()`.

- **Negotiation log** (`shared/unit-negotiation.ts`, `server/unit-negotiation.ts`,
  `components/unit-negotiation/*`): `unit_offers` is a bid's CURRENT position,
  `unit_offer_rounds` every position it has been through (tenant offer,
  landlord counter). The newest round always equals the offer row. Status is
  Pending, Negotiating, Agreed, Rejected or Withdrawn ("Accepted" on old rows
  reads as Agreed) and changes ONLY through `POST /api/unit-offers/:id/status`;
  every offer starts at Pending and the create and edit routes ignore a
  status in the body. One agreed offer per unit. The old offer form cannot go
  round the log: it refuses to edit an offer that is not open, and refuses a
  change of terms once a bid has more than one position; an agreed offer, or
  the one the unit's HOTs came from, cannot be deleted. When the HOTs' offer
  stops being agreed the HOTs version is raised (signatures reset) and the
  history says why. "Closed" marks an offer from an earlier letting.
- **A re-marketed unit's new deal is named `<property> – <unit> (re-marketed <Mon YYYY>)`**
  (`ensureBackingDealForUnit` in `server/unit-mirror.ts`, 2026-11-12). The plain
  name collided with the earlier deal on the dedupe index, so the re-marketed
  unit was left live with no deal and no Ref #. If the new deal still cannot be
  made the save is refused (409 `REMARKET_DEAL_FAILED`), never saved without one.
- **A re-marketed unit starts a new letting clean** (`server/letting-cycle.ts`,
  called from `startFreshCycle` and the unit PATCH's reopening branch): the
  HOTs state and sign-offs are cleared and the earlier offers are marked
  Closed. The HOTs flow and the offers hang off the tracker unit, not the
  deal, so anything new that hangs off the unit must be reset there too.
  The unit's open comments not yet logged (`letting_suggestions`) are closed
  there as well, dismissed with a plain reason and never deleted, so the
  earlier letting's words are not raised again; deleting a unit deletes its
  suggestion rows (the unit DELETE in `server/routes.ts`).
- **Heads of Terms flow** (`shared/unit-hots.ts`, `server/unit-hots.ts`,
  `components/unit-hots/*`): standard first (the property's
  `hots_template`), generate from the agreed offer, amend (each amendment
  raises `hots_version` and earlier signatures stop counting), sign-off by
  the people on the unit's Targeting Brief, issue (BGP or the scheme's joint
  agent, `agentControl`; moves the unit to HOT through the gate and mirror;
  sends nothing), final upload (the same), convert to Solicitors (the same;
  terms onto the deal through `updateDeal`, SOL through
  `dealStatusTransitionDenial` and `mirrorFromAvailableUnit`, never past the
  MLRO-rejected block; the terms come from the offer agreed NOW, and it
  refuses when the HOTs were generated from a different one). A joint agent
  converts with no CRM picking (the tenant's name goes on as text when no
  company is linked) and the reply carries no fee, CRM contact or AML
  detail. Asset managers have the Letting Tracker, as every full Landsec
  login does; the Landsec unit page opens the HOTs and the deal checklist too
  (`?hots=1`, `?checklist=1`). A
  joint agent has their own tracker for their schemes (`/landsec/tracker`,
  Woody, 2026-11-12) and the unit page too. The final
  agreed HOTs file is never public and cannot be re-filed or deleted from
  the Files list. The old `PUT /api/available-units/:id/hots` and
  `/hots/populate` are closed (410): do not reopen them, they wrote the text
  with no version or sign-off.
- **Scheme forms** (`shared/hots-standards.ts`): Landsec's own HOTs for
  Bluewater, St David's, Trinity Leeds and White Rose, as Woody sent them.
  Create standard HOTs uses the scheme's form when the property's name
  matches AND Landsec is its landlord (they name Landsec's companies and
  solicitors), BGP's standard (38 clauses) otherwise. These mark blanks with `[ ]` or `XXXX`, not `{TOKENS}`:
  `fillSchemeHots` fills only what it can place with certainty, never deletes
  an OR alternative, and names what it could not place in the HOTs history.
  A new scheme form is one more entry in `SCHEME_HOTS_STANDARDS` plus a test.
  **Each form carries BGP's AML clause** (Woody, 2026-11-20: "yes on AML";
  `AML_HOTS_CLAUSE`, added by `withAmlClause`) as its next clause after its
  last, before its closing paragraph where it has one: Bluewater 44, St
  David's 47, White Rose 45, and at the end of Trinity Leeds, which numbers
  none, as "Anti-money laundering:". Landsec's own clauses keep their
  numbers. `before` on each entry is the form as it stood without the
  clause, so a property that copied it earlier still reads as the scheme's
  form ("…, before the AML clause", `builtInStandard` in
  `server/unit-hots.ts`). Test: `server/hots-standards.test.ts`.
- **Fee split between the agents** (Woody: "fee splits need to be for joint
  or sole agent ... include the joint agents for their own benefit and for
  clarity with Landsec"): `unit_briefs.joint_agent_fee_pct` (copied to
  `crm_deals`), set on the brief's People tab through
  `PUT /api/unit-briefs/:id/agent-fee-split`; `agentFeeSplitText()` words it.
  Everyone on the brief sees it, the joint agent included; a joint agent on
  the scheme can change it (2026-11-12), and the timeline records who
  changed it with the old and new figure. BGP's internal split (BGP House, who at BGP earns what)
  is for BGP staff only, on the deal page: never show it or its wording to a
  client login or on a Landsec unit's form.
- **Transaction recommendation** (`shared/unit-recommendation.ts`,
  `server/unit-recommendation.ts`, `components/unit-recommendation/*`,
  migration 0054; Woody, 2026-11-12: "letting transaction recommendation
  once the HOTs are issued to a tenant"). One per unit and its current deal.
  The form is Landsec's own Offer template (February 2026): the term fields
  and the eight commentary headings in `shared/unit-recommendation.ts` are
  that list, in its order. BGP staff and the scheme's joint agent write it
  (Woody, 2026-11-12: joint agents "can see draft and amend, it's theirs
  too"); BGP or the scheme's joint agent issues it (once HOTs are issued and
  nothing is missing; issued by a joint agent it says their name and firm),
  and either can record a decision for a decider with no login; the deciders are the client-side people on the Targeting Brief, each as
  themselves. A change after issue raises the version and earlier decisions
  stop counting. A joint agent never receives the brand's CRM website. The measure (psf, net effective, less three months' fit-out,
  % of ERV and floor, occupational cost) is worked out on read, never stored.
  AI drafts are Anthropic only and are never saved by themselves.
- **Landsec emails come from the Landsec mailbox** (Woody, 2026-11-12:
  landsec@chatbgp.app; the mailbox made on 17 November 2026 is
  `landsec2@chatbgp.app`, the default; `LANDSEC_MAILBOX` overrides): `sendWorkspaceEmail` in
  `server/shared-mailbox.ts` sends checklist and recommendation emails about
  a Landsec property as that mailbox, and falls back to the shared mailbox,
  with a log line, if Microsoft will not send as it. Use it for any new
  email about a letting; do not call the shared mailbox sender directly.
- **Landsec team sheet** (`shared/landsec-personnel.ts`, from BGP's
  personnel model of 2 February 2026): only SUGGESTS people on a brief at a
  Landsec scheme. Names are confirmed by the person adding them and matched
  to a real login where there is one. It will go stale: update it from the
  team's current sheet, never treat it as who has access.
  Bluewater was updated on 18 November 2026 from Landsec's own account
  (Mark Warne's feedback): Will Harvey senior asset manager
  (`seniorAssetManagers`, suggested on a brief in that role), Jonny Rushton
  leasing, BGP's team Millie Edwards, Emily Dumbell, Alex Todd and Kate
  Martin (Woody, the same day), and Gemma Casey, Rebecca "Becs"
  Blenkinsop and Mark Warne kept informed (`informed`: listed with the team,
  never suggested as someone who agrees a brief). Every other scheme is
  still the February sheet; an entry confirmed since carries `checked`. The
  sheet also feeds a client's own Contacts groups and the BGP team a client
  sees per scheme, so a name is spelt as its login or CRM record spells it
  (Jonny, not Jonathan). Tests: `shared/landsec-personnel.test.ts`.
- **The public website gets only files stored with file type `upload`**
  (review, 2026-11-13). The rule is `publicUnitFileSql` in
  `shared/letting-rules.ts` (`publicUnitFile` in `server/routes.ts` is that
  rule): the public listing feed, the public file route and (through the
  feed) the WordPress sync read it, and so do the tracker's Website pill
  and ChatBGP's website check when they count a unit's photo
  (`publicUnitPhotoSql`), so the pill never reads Live on a picture the
  site cannot show. File type `upload`, filed under Brochures, Floor plans
  or Photos. A picture a row only borrows from Image Studio (file type
  `image_studio`, 186 rows on the live tracker) and a SharePoint link
  (`sharepoint`) are not public and do not count as the unit's photo: the
  public file route cannot serve either. The `upload` type is what a
  person uploads, the photos and
  plans the app cuts from an uploaded brochure, files ChatBGP files from an
  attachment (`addUnitFile`) and old-site imports. The documents the app
  writes (`infosheet`, `targeting_brief`) and the final agreed Heads of
  Terms (`hots_final`, a person's upload) have their own type and are never
  public. A new document the app writes must be given its own file type:
  never `upload`, and never through `addUnitFile`. The info sheet prints
  the row's Notes box, which is why it came off the website; an agent still
  sends it by hand or through Share with a brand. With no PDF among a unit's public
  files, bgp.uk.com makes its own particulars from the listing and the old
  WordPress site shows no brochure. Tested in
  `qa/regression/public-unit-files.test.mjs`.
- **Share with a brand** (`server/unit-share.ts`, `unit-share-dialog.tsx`,
  BGP staff, and a joint agent on their own schemes): a tick list, then one
  PDF or an Outlook DRAFT (never a send). A joint agent types the recipient
  or picks a brand already named on the unit (no CRM lookup; a `contactId`
  is always refused, and a `companyId` unless that brand is already named on
  the unit), gets the PDF only (no
  draft in BGP's Microsoft tenant) and sees only the shares they made. What a brand may be given is an allow-list in that file. Never add
  the fee, the NER floor, ERV, the maximum incentives, offers, viewings,
  comments, the Targeting Brief or heads of terms to it. The draft needs the
  Mail.ReadWrite application permission and has not been run against
  Microsoft; it falls back to the PDF and a mailto link.
  **The brand's agent as the recipient** (15 November 2026; Woody: "fix the
  phone issues"): for BGP staff the contact list for a picked brand also
  offers the named contacts of the brand's CURRENT tenant-rep
  representations, marked "Tenant rep" with their firm (`GET
  /api/unit-share/:unitId/brand-agents?companyId=`, `tenantRepContacts`),
  and the share stays logged against the brand. The send checks the contact
  it is handed (`contactMayReceiveFor`): someone at the brand, or one of
  those tenant rep contacts; any other `contactId` is refused, whatever the
  screen offered. A joint agent's rules are unchanged: the new route refuses
  it (it sits under the share prefix its gateway opens, so the handler says
  no itself) and a `contactId` from it is still always refused. Test:
  `qa/regression/unit-share-tenant-rep.test.mjs` (its SQL half needs
  `UNIT_SHARE_DATABASE_URL`).
- **Deal checklist** (`shared/deal-checklist.ts`, `server/deal-checklist.ts`,
  `components/deal-checklist/*`, migration 0052): one per unit and its
  current deal, items by stage, each with one responsible person from BGP,
  the client or a joint agent, plus one person responsible for the deal.
  Making someone responsible creates a `user_tasks` row (marked
  `source = 'deal_checklist'`) and emails them; the task and the item tick
  each other (`syncChecklistItemFromTask` from `PATCH /api/tasks/:id`). A
  joint agent on the scheme runs the checklist as BGP does and has a task
  list (`/landsec/tasks`); their people picker stays the client-side list,
  never BGP's directory. Every login has a task list now, an asset manager's
  included (2026-11-13), so everyone with a login gets the task as well as
  the email. **Task lists know what a deal is waiting on**: `GET /api/tasks`
  sends `waitingOnDeal` and `waitingDays` on a task made for a checklist
  item, for every caller, from `waitingFlagsForChecklistItems` in
  `server/deal-checklist.ts` (a failure there reads as "not waiting"; the
  task list never fails because of it). The screens show one pill, "Deal is
  waiting on you" with the days, and list those tasks first
  (`client/src/components/deal-waiting-pill.tsx`: My Tasks, the phone home,
  the Landsec Tasks page); My Tasks and the Landsec Tasks page put them in a
  "Waiting on you" section of their own (16 November 2026). A new task
  screen uses that file. **Waiting on
  follows the checklist** (Woody, 2026-11-13; the rules are
  `shared/deal-waiting.ts`, tested in `server/deal-waiting.test.ts`): a
  deal's waiting-on can point at one checklist item
  (`landsec_deal_clock.checklist_item_id`, migration 0058), moves to the next
  required item when that one is ticked, and with nothing set is read from
  the checklist on read, never stored. The flag is also on the "Responsible
  for the letting" task when the waited-on item has nobody of its own
  (`waitingFlagsForChecklists`), never on two tasks for one deal, and only
  while the clock names that person, their party or no one: a linked item
  with a party typed by hand ("Tenant's solicitors") flags no task. A closed
  deal (withdrawn, completed, invoiced, archived) is waiting on no one. The
  Deals feed, the unit page, the shared diary and the scheme units feed all
  read it through `waitingClockFor`, so a deal reads the same everywhere.
  When a linked item changes hands the waiting-on follows the person, and a
  party that was the old person's own is never left beside someone whose
  party is not known. A "New task" push opens the login's own list
  (`tasksPathForLogin`: `/landsec/tasks` for a Landsec role and for a full
  Landsec login with no role row, `/tasks` for everyone else). Only
  tasks with that marker are ever deleted by the feature. Opening a checklist
  never emails anyone. It is NOT a gate on status changes (Woody has not
  asked for one). There is ONE standard list for every client, modelled on
  the client checklist Woody pasted and rewritten in BGP's words (Woody,
  2026-11-12: "change it so it's not exactly the same"): never paste a
  client's own checklist in word for word. `{CLIENT}` in an item becomes the
  landlord's name when the checklist starts.
- **Against the brief** (`shared/brief-progress.ts`): a fixed ladder of
  steps worked out from the brief, the viewings, the offers and the deal
  status. Nothing is typed. Add a step there, with a test, never in the
  cell. On the tracker row it is the "Against brief" chip under the unit's
  name (`BriefProgressChip`), and the **Deal checklist is the column** in
  the main table (`TrackerChecklistCell`), on the staff tracker and the
  joint agent's (Woody, 2026-11-13: "swap the check list and against the
  brief"). Do not swap them back.

## Describe the deal reads the deal (Woody, 2026-11-20)

Woody, on New Deal's "Describe the deal" box with the note "lettering on 55
wells street London to Bruce gillingham pollard LTd. Landlord is Brucecap Ltd
rent is 300,000 pax term 10 yrs rent free 5 momnths", which filled nothing
but the terms: "Need to improve the autofill as doesn't search the adress?
Also didn't pick up the tenant and couldn't add landlord or tenant once
worked out they are not in the CRM?", "also didnt change the deal typ to new
letting", "also didnt help with the billing entiryies either". The box's
first reading (the letting note reader, read as an offer) is unchanged; a
second reading, of the deal itself, runs beside it. Rules and checks:
`shared/deal-note.ts`; provider and look-ups: `server/deal-note-reader.ts`;
form mapping: `client/src/lib/deal-note.ts`; panel:
`client/src/components/deal-note-read.tsx`. Tests: `server/deal-note.test.ts`
(in `npm test`), `qa/regression/deal-note-reader-guards.test.mjs`, and the
route case in `qa/regression/promote-to-solicitors.test.mjs`.

- **What it reads**: the deal type (one of `DEAL_NOTE_TYPES`, the deal form's
  types for a deal with a property), the address and a unit, and each party
  (landlord, tenant, vendor, purchaser) by the name the note gives. Anthropic
  when a key and the letting note reader's daily allowance allow (its own
  call, `defaultNoteReaderDeps`, logged as `deal-note-reader`), sent the note
  and the list of deal types and nothing from the CRM; the rules
  (`readDealNoteRules`: "Landlord is X", "letting ... to X", "55 Wells
  Street", "lettering on", which is "letting" autocorrected) fill what the
  provider leaves out, or read the note alone. Every value must be the
  note's own words (`checkDealNoteAnswer`); a name in two roles, or the
  address as a party, is used for neither.
- **What it looks up**: the address among `crm_properties` word by word
  (`addressSearch`: the house number whole, Street as St too, the town left
  out; the address's values, never its key names), then by postcode, then
  without the number (offered, never filled). Each party among the CRM's
  companies and the companies filed under them (`crm_trading_entities`, the
  billing entities) by the PIPnet import's name key (`partyCandidates`: "Bruce
  gillingham pollard LTd" is the BRUCE GILLINGHAM POLLARD LIMITED filed under
  barrette estates), and at Companies House (live companies of exactly that
  name, `registerHits`) when the CRM holds no company for it, or holds the
  party but not the legal company a name ending Ltd names.
- **What the form does**: what is sure fills an EMPTY box by itself
  (`dealReadPatch`: the deal type, a property that matched every word, a
  party with one CRM company and the company that signs; never a party,
  property or type already chosen, and only the parties the deal type's
  form shows), with the property's own side effects (`propertyPickPatch`),
  the deal type's team (`teamForDealType`) and the deal name (`dealAutoName`).
  The panel under the box shows each part with the words it came from and
  offers the rest: pick a property or party, **Find or add it** (the
  property picker opens with the address typed, its `seed`), **Add … as
  tenant** (`POST /api/crm/companies` with the role's type, then, when
  Companies House matched, the billing entity) and **Bill …** (`POST
  /api/billing-entities`, the route the billing entity picker uses, which
  files the company under the party and finds or makes its Xero contact).
  Each of those is a press; nothing is sent by a reading.
- The offer reading is tidied by the deal reading (`tidyOfferReadingForDeal`):
  a party read as a brand or agent, and "not a brand on this unit", are taken
  out. A value listed to Use is no longer also listed as left out, on every
  letting form (`readLettingNote`).
- Not run against Anthropic or Companies House from a build machine: checked
  in a browser against a local copy on 20 November 2026 with the rules alone.

## The invoice goes to the billing entity (Woody, 2026-11-20)

Woody, on deal #4507's Xero Invoicing card: "this xero invoicing is not
autolinked to the AML deal process thats happening it should be". The
landlord's billing entity was set under Parties (Bruce Cap Ltd t/a Pave),
but the card read only the deal's old single invoice contact and had to be
given the contact again by hand; with neither set, the server made a Xero
contact named after the DEAL, and the automatic draft at exchange or
completion billed the TENANT's name whoever BGP acted for, making that
contact too. Rules: `shared/deal-parties.ts`; server:
`resolveDealInvoiceContact` in `server/xero.ts`. Tests:
`server/deal-parties.test.ts`, `qa/regression/invoice-billing-entity.test.mjs`.

- **BGP's client** is one rule, `dealClientRole`: a sale's vendor, a
  purchase's purchaser, the tenant on a Lease Acquisition or Lease Disposal,
  with BGP acting for the tenant or on the Tenant Rep team, else the
  landlord. The Deals table's Client cell (`clientFieldFor`) reads it.
- **Who is billed** is `invoiceContactFor`: the deal's own invoice contact
  (`xero_contact_id` / `xero_contact_name`) when one is set, because some
  invoices go to another company than the party's billing entity (six
  invoiced deals on live on 20 November 2026, Brent Cross Partnership Ltd
  among them), else the billing entity on BGP's client from Parties
  (`<role>_entity_id` / `_name`), else (since later that day) a third party
  the deal records as paying, else the company that signs for BGP's client
  (see "Who BGP bills and who pays" below). Never the deal's name, never the
  tenant.
- **The invoice route** (`POST /api/xero/invoices`) bills the contact the
  screen sends, else `resolveDealInvoiceContact`; with none it answers 409
  `NO_BILLING_ENTITY` naming the party. **The automatic draft** (the deal
  save on a move to Exchanged or Completed, `server/crm.ts`) uses the same
  and is skipped, with a log line, when there is none. A deal's own contact
  held by name alone (an estate scheme's billing entity,
  `server/property-schemes.ts`) is still found in Xero by its exact name, or
  made, as before.
- **The card** (`XeroInvoiceSection` in `client/src/pages/deals.tsx`): an
  **Invoice to** line with the name and where it came from ("the landlord's
  billing entity, from Parties", or "the invoice contact set on this
  deal"), **Set / Change the <party>'s billing entity** (the one party box,
  `DealPartyEditor`), **Invoice someone else** / **Change the invoice
  contact** (the deal's own contact, the old picker), and, when the deal's
  own contact differs from the party's billing entity, a line naming it with
  **Invoice it instead** (clears the deal's own contact). With no billing
  entity it says so in amber and Create Draft Invoice is greyed. The Deals
  table's Client & billing and Xero contact cells show the same contact.
- Not run against Xero from a build machine; checked in a browser against a
  local copy on 20 November 2026 with Xero not connected.

## Layla's invoice template (2026-11-22)

Layla, to Woody: "This is the template I use for majority of invoices – would
be great if it could autofill over to Xero!" Woody asked for it to be filled
in when Layla bills. Rule: `shared/invoice-template.ts`; read:
`server/invoice-template.ts`. Tests: `server/invoice-template.test.ts` (in
`npm test`), `qa/regression/invoice-template.test.mjs`.

- **For a New Letting where BGP acts for the landlord** (`usesLettingTemplate`)
  the draft reads: Reference `FAO <client contact>`; then the tenant, the
  address (Letting Tracker unit, property, address, postcode), `PO – <number>`
  when there is one, "To: Acting on behalf of <landlord>, in negotiating a new
  letting to <tenant> in respect of the above property." and "To: Fee <x>% of
  the agreed annual rent of £<rent> = £<fee> plus VAT". One line item; the
  amount is the deal's fee. Parties are named as they sign (the company that
  signs), else by their CRM name. The FAO is the deal's client contact, else
  the client's own contact on the deal.
- **Anything missing stays as in her template** (NAME, TENANT, ADDRESS,
  LANDLORD, `?`) and the form lists it. A fee percentage is worked out from the
  fee and rent only when it is a clean figure. A percentage, rent and fee that
  do not agree are flagged, never changed. A joint agent's share is flagged.
- **Other deals keep the deal's name** as before: Layla's other templates are
  not known.
- **Where**: the deal page's Send to Xero form (`GET
  /api/xero/invoice-draft/:dealId`, BGP staff, reads only) shows the reference
  and the text to check and edit; the text follows the PO and amount until
  someone types over it, and Fill again starts over. The automatic draft at
  exchange or completion uses the same rule. A PO already in the text is not
  added to the reference again (`descriptionHoldsPo`).
- Not run against Xero from a build machine; checked in a browser on a local
  copy on 22 November 2026.

## Xero invoices worked from the app (Woody, 2026-11-24)

Woody, on draft INV-05587 (20 November 2026): "at this point need the ability
to edit that draft or also see that draft in the app is that possible? and
also delete it if the deal gets deleted from the app? ... does the api allow
for approval and email from the app? can you review and see if we can make it
more integrated so layla doesn't need to go on to Xero?"; asked who may
approve and send, on 24 November 2026: "xero all admin". Do not re-litigate.
Rules: `shared/xero-invoice.ts`; routes: `server/xero-invoice-actions.ts`
(`setupXeroInvoiceRoutes`, after `setupXeroRoutes` in `server/index.ts`);
window: `client/src/components/xero-invoice-window.tsx`. Tests:
`server/xero-invoice.test.ts` (in `npm test`),
`qa/regression/xero-invoice-actions.test.mjs`.

- **The invoice window**: pressing an invoice on the transaction's Xero
  Invoicing card (Fees & invoicing), or making a draft with Send to Xero, opens
  it as Xero holds it (`GET /api/xero/invoices/:id/detail`, which also
  refreshes the row and moves the transaction to Invoiced once approved, as the
  sync does): lines, VAT, totals, dates, reference, amount due, and the last
  email sent from the app. **See the PDF** is Xero's own PDF
  (`GET …/:id/pdf`, `Accept: application/pdf`) in the pop-out viewer.
- **Who does what** (`invoiceActions`): any BGP person signed in as themselves
  reads an invoice, changes a draft and deletes a draft, as any BGP person makes
  one. Admins (`users.is_admin` or `ADMIN_EMAILS`, requireAdmin's test) approve,
  email and void. Writes go through the person's own Xero connection, so Xero
  records who did it and the email goes out in their name (`XERO_CONNECT` asks
  them to connect); reads fall back to the firm's connection.
- **Changing a draft** (`PUT /api/xero/invoices/:id`, `invoiceEditInput`,
  `xeroEditPayload`): every line is sent (Xero deletes a line not sent), a kept
  line keeps its account code and tax type, a new one takes the sales nominal
  (`salesAccountCode`); the dates, reference and contact. **The contact is sent
  by its Xero id only**: a name or details would change the contact itself in
  Xero. Read fresh first: a draft approved in Xero since is refused.
- **Approve** (`POST …/:id/approve`, optional `andEmail`) from DRAFT or
  SUBMITTED; never on a transaction stopped for AML reasons. **Email**
  (`POST …/:id/email`): AUTHORISED or PAID only; Xero sends it to the contact's
  own address and its contact persons marked to receive emails, from
  messaging-service@post.xero.com with Xero's default template
  (`GET …/:id/recipients` shows who). With no address on the contact, a person
  gives one and it is saved on the contact (its contact persons sent back as
  they were). An `Idempotency-Key` on every send; a second send within ten
  minutes asks first (`SENT_RECENTLY`); then marked as sent
  (`SentToContact`). **Void** (`POST …/:id/void`): approved with nothing paid or
  credited, with a reason noted on the invoice's history in Xero. **Delete the
  draft** (`POST …/:id/delete-draft`). Each writes a history line on the
  transaction (`xero_invoice_edited`, `_approved`, `_emailed`, `_voided`,
  `_deleted`), hidden from client logins with the AML lines.
- **Deleting a transaction** (`xeroBeforeDealDelete`): its drafts are deleted in
  Xero first (Status DELETED); an approved invoice keeps it until an admin voids
  it, and a paid one keeps it (409 `XERO_INVOICE_LIVE`); a draft Xero could not
  be reached for keeps it too (`XERO_UNREACHABLE`), so no draft is left behind.
  The delete routes ask with the person's own Xero login; `storage.deleteCrmDeal`
  asks again (the firm's connection) for every other caller, ChatBGP's
  delete_record included, and removes the transaction's invoice rows with it.
- **Taking a row off** (`DELETE /api/xero/invoices/:id`) only when Xero holds
  nothing live for it (deleted, voided, or never sent).
- Also fixed: Xero's dates came back as `/Date(…)/` and were cut to "/Date(176"
  on sync; `xeroDay` reads both forms.
- Checked in a browser on a local copy against a stand-in for Xero on
  24 November 2026 (edit, PDF, approve and email, no address, void, transaction
  delete). Not run against BGP's Xero from a build machine: the first real
  approval and email is an admin's.
- Not built: attachments, repeating invoices, payments, credit notes.

## Who BGP bills and who pays (Woody, 2026-11-20)

Woody: "the Xero billing entity and the aml entity need to be flagged if they
are different? They are effectively the same thing? ... Should we need to
change the billing entity it's done on the deal page as add billing entity
which also needs its own KYC no?", then "yes biuild"; later the same day
"need ability to create billing entity or contracting entity as a person we
will then KYC them but we also need to be able to add a billing entity after
when the deal is ready to invoice because they may not have set up the
purchase vehicle to date". Do not re-litigate. Rules: `shared/deal-billing.ts`
and `shared/deal-parties.ts`; reads and routes: `server/deal-parties.ts`,
`server/billing-entity.ts`; screens: `PartyBillingDetail` and `PayerDialog`
in `client/src/components/deal-parties.tsx`,
`client/src/components/billing-entity-create.tsx`,
`client/src/components/signing-entity-picker.tsx`. Tests:
`server/deal-billing.test.ts` (in `npm test`), `server/deal-parties.test.ts`,
`server/aml-box.test.ts`.

- **BGP's client is billed as the one that signs for it.** With no invoice
  contact of its own (`invoiceContactFor`: the deal's own contact, then the
  party's billing contact, then a recorded payer, then the company that
  signs), the invoice goes to the company that signs, whose own Xero contact
  is kept on it (`crm_trading_entities.xero_contact_id` / `_name`, boot
  migrations) once found or made. `resolveDealInvoiceContact` finds or makes
  it by name with its Companies House number. Only BGP's client is billed: the
  deal form shows a billing box for the client's party only (every party when
  the deal type does not say who the client is).
- **A billing contact that names another company is flagged**
  (`billingState`: same, signing, different, payer, no_company, individual):
  on the Parties card, the AML box's **Who pays** section, the AML box's Next
  line (asked before sign-off, never ahead of the checks: `billingDiffers`)
  and the Xero card. **They are the same company** keeps the contact on the
  company; **Bill <company> instead** clears the deal's own contact and bills
  the company that signs.
- **A third party that pays** is recorded on the deal
  (`crm_deals.invoice_payer_entity_id`, `_relationship`, `_note`, boot
  migrations, not in `shared/schema.ts`) through `PUT /api/deals/:id/payer`
  (BGP staff as themselves): a company filed under the client's brand, never
  the one that signs, with how it is related (`PAYER_RELATIONSHIPS`: its
  purchase vehicle, its group, the same owners, its guarantor, its agent,
  another relationship with a note, or no clear relationship). It gets BGP's
  checks before asking of its own; what they find, and "no clear
  relationship" (HMRC AMLG3200: high risk), are red flags on the client
  (`payerRedFlags`, kind `third_party_payer`), in the AML box and on the AML
  dashboard. It warns; it never blocks a deal.
- **A person as the billing or contracting entity.** The Create billing
  entity dialog has **A company** (Companies House, as before) and **A
  person** (name, email, mobile): `POST /api/billing-entities { brandId,
  person }` files the person under the party as a `crm_trading_entities` row
  with `entity_kind = 'individual'` and `contact_id` (the CRM contact who is
  them, found by email or added: `savePersonEntity`), and makes their Xero
  contact by name unless `xero: false`. Boot migrations add both columns.
  Every AML reader then treats the party as a private individual
  (`partySubjectKind`: the one who signs decides; with nobody named, the
  record's `aml_subject_type`): BGP's checks before asking screen the person,
  the client checks ask for an identity check, a proof of address and the
  question about public roles, KYC4U's note names them as a private
  individual, the sign-off and the AML file read them as one. The person who
  signs is who to ask when nobody else is named (`from: "signer"`).
- **Who signs for the other side.** On the deal form a party BGP does not bill
  gets **Who signs for <party> (for the AML checks)** (`SigningEntityPicker`):
  the companies and people filed under it, **A company (Companies House)** or
  **A person**, never a Xero contact. The party box on the deal page has
  **Find it at Companies House** and **A person signs**, with Xero only for
  BGP's client.
- **Adding the billing entity later** (the purchase vehicle not set up yet):
  nothing on the form needs it. When it exists, the party box either changes
  who signs to it (the AML checks then run on it, the person who signed
  before being one of its owners), or records it under **A third party pays**
  as **Its purchase vehicle** (the `vehicle` relationship), with its own
  checks.
- Not run against Xero or Companies House from a build machine.
- **New Deal pressed to Create** (Woody, the same day: "check the add deal
  process actually works and doesnt fail"; a sale with a person signing, a
  purchase and a lease acquisition, in a browser against a local copy). Two
  faults found and fixed: the person dialog held a `<form>`, and React
  carries a submit through the dialog's portal to the deal form, so saving
  the person created the deal before the person was set (the dialog has no
  form now; Enter still saves); and a deal with the name and parties of a
  live one met the dedupe index (`idx_crm_deals_dedupe`) and showed the
  database's own words, now `409 DUPLICATE_DEAL` naming the deal and its
  Ref with **Open deal**. Never put a `<form>` in a dialog the deal form
  opens. Guard: `qa/regression/new-deal-create-guards.test.mjs`. Pressed
  again later that day for lettings: a New Letting on a unit typed in, a
  second one on the same unit (`409 LIVE_LETTING_EXISTS`, Open deal), one
  with no unit (Create greyed, with the reason), a Lease Disposal and a Rent
  Review (Lease Advisory) all behave. A letting's name is "<tenant> –
  <property>", with no unit, so the same tenant taking a second unit from
  the same landlord there meets the dedupe index: the person renames it.
- **A party recorded as a private individual** (Woody, the same day, adding
  the Fortis Green heads of terms on live as #4526: the Kick off AML step
  asked for "the company buying" for Sandy Macaskill (private), a private
  buyer, and nothing on the app could record him as a person).
  `PUT /api/deals/:id/parties/:role/individual { individual }` (BGP staff
  signed in as themselves, in `server/deal-parties.ts`) sets the record's
  own `crm_companies.aml_subject_type`, which every AML reader follows
  (`partySubjectKind`): no company that signs is then needed and the checks
  are about the person. A record with a Companies House number is refused
  (409: it is a company). Undo clears only what it set. The record is
  shared, so every deal with it follows. A line on the deal's history and
  on the record's KYC history (`aml_subject_type`). The party box offers
  **Record them as a private individual** (and **Undo**); the Kick off AML
  step and the AML box offer **A private individual** first when the CRM
  name is marked private (`privateMarkInName`: "(private)", "(private
  client)", "(individual)"), a suggestion a person presses, never applied
  by itself. Guard: `qa/regression/deal-parties-guards.test.mjs`.

## Heads of terms on a sale or purchase (Woody, 2026-11-20)

Woody, on New Deal with the Fortis Green Tennis Club heads of terms: "I loaded
up HOTs but it didnt add new vendor also it hasnt added the purchase price
which is because the form is set up for leases but needs that and should auto
add team if its investment", then "the vendor FORTIS GREEN TENNIS CLUB but its
not showing". On live the reader had no vendor, purchaser or price; the club
(the sitting tenant) was linked to EE because "fortis gr-ee-n" holds "ee";
#4520 had no team; and #4282 already held the same purchase, so #4519 and
#4520 were duplicates. Helpers: `client/src/lib/deal-note.ts`
(`findCompanyByName`, `hotsParties`, `hotsPricePatch`, `teamPatch`); tests in
`server/deal-note.test.ts`.

- The reader (`/api/crm/deals/parse-hots`, `server/crm.ts`) also reads
  `vendorName`, `purchaserName`, `sittingTenant` and `price`. The form fills
  the vendor and purchaser on a sale or purchase (a reading with only a
  landlord gave the seller; a sale's tenant is never the buyer), and the
  landlord and tenant otherwise.
- Reading heads of terms names the deal with the property it picked, as
  picking the property does (a sale read from them was named after the
  vendor alone until 20 November 2026).
- **Names match by whole words** (`findCompanyByName`: the same words, legal
  endings and "(private)" aside, else the one company whose every word is in
  the name, two words at least; never part of a word, never a guess between
  two), on New Deal and the deal page's heads of terms reader.
- A party the CRM does not hold is listed under the button with **Add as
  vendor** (or purchaser, landlord, tenant): one press makes the CRM record
  and fills the box. Nothing is created by a reading.
- **Price (£)** replaces Headline Rent on a sale or purchase (`pricing`), and
  the fee is worked from price × % there. The reading fills the price and
  the fee.
- A reading that sets the deal type adds its team (`teamForDealType`), as
  picking the type does.
- **Already a live sale or purchase on this property** (`LiveInvestmentDeals`,
  from `GET /api/crm/properties/:id/deals`) lists them under Property on New
  Deal for a sale or purchase, each opening its deal.
- **Use this transaction** on that notice (Woody, 2026-11-24: "Can you allow
  for link to existing deal at this point? its easier"; BGP staff, New
  Transaction only, not a handover). Rule: `client/src/lib/deal-link.ts`
  (`linkToTransaction`; tests `server/deal-link.test.ts`, in `npm test`, and
  `qa/regression/deal-link-guards.test.mjs`). The form moves onto that
  transaction, read fresh: what it holds stays; its blanks fill from what New
  Transaction was given (a field differs from New Transaction's own defaults,
  so the Solicitors default and the person's team never count); a party comes
  whole with its billing entity and company that signs, and the same party
  only fills those two where blank; new comments are added to its own. Its
  name, team, BGP Contact, property and AML check are never carried
  (`KEPT`). Where the two differ the transaction's value stays and the
  banner (`DealLinkBanner`) offers **Use** for the other, with Undo. The
  stage is never moved by itself: a later stage (Negotiating, HOTs or
  Solicitors only, never past) is offered as **Move it to HOTs**. The
  property is fixed (`place`), Show all fields is not offered, the read
  panel cannot move it to another property, and its own fee split is
  loaded when it has one. **Back to a new transaction** puts the form as it
  was. **Save to #<ref>** is its own save (`PUT /api/crm/deals/:id`, never
  a POST), then its fee split, then Kick off AML.

## Heads of terms on the transaction page (Woody, 2026-11-23)

Woody, on Bill's · Unit 7a's Parties & AML pill at "To do · Set the company
that signs": "where is the upload HOTs place? so can populate?". Until then
heads of terms were read only by New Deal and the Transactions table's move to
HOTs (the HOTs checklist), and neither set the company that signs. Rules and
checks: `shared/deal-hots.ts`; reading and look-ups: `server/deal-hots.ts`;
screen: `client/src/components/deal-hots.tsx`. Tests:
`server/deal-hots.test.ts` (in `npm test`),
`qa/regression/deal-hots-guards.test.mjs`.

- **Where**: the **Describe the transaction** box at the top of the
  transaction's Parties and AML box (BGP staff; `DealDescribeBox`; Woody,
  the same day: "shall we have the box that populates the deal here too?
  drop HOTS or type it out? Easier for people"): one line until it is used;
  type the transaction out and press **Fill it in**, or drop or choose the
  heads of terms. Both read into the same dialog. And **Read the heads of
  terms** in the party box (Fill in) under Who signs while no company
  signs. The party box stays open under the dialog (`hotsOpen`).
- **A party not found, or named with no company, saves from the dialog**
  (Woody, the same day: "read hots and click choose company and it went
  back to previous board nothing saved"; the old **Choose the company**
  only closed the dialog). The party line offers **Find the company at
  Companies House** and **A person signs** (or, when the name reads as a
  person's, `hotsPersonName` in `shared/deal-hots.ts`: "Caitlin Johal,
  trading as The Ugly Duck", **Caitlin Johal signs personally** first).
  Each opens the party box's own Who signs dialog (`CreateBillingEntityDialog`,
  `xero={false}`, the person's name filled in, `initialPersonName`) over
  the heads of terms (`finding`, guarded in the dialog's `onOpenChange`);
  the pick is filed under the party and set as the one who signs (`PUT
  /api/deals/:id/parties/:role`, `signsFound`), then the reading is matched
  again. **Back to the party box** (or **Open the party box** from the
  Describe box) is a quiet link. Guard: `qa/regression/deal-hots-guards.test.mjs`.
- **A company registered abroad is found by its name** (Woody, the same
  evening, on 65A Granville Arcade: "bug not allowing me to confirm the
  Landlord having loaded up the HOTs"). The heads of terms gave "AG Hondo
  Brixton Village B.V. Company Registration Number: 71168974", its Dutch
  number, and the reader looked only for a UK company numbered 71168974. A
  name with a foreign legal form (`looksOverseasName`) and a number that is
  not an OE number is now never looked up by that number at Companies
  House: it is searched by its name with the legal form left out
  (`overseasNameKey`), which finds the overseas entity (AG HONDO BRIXTON
  VILLAGE BV, OE002654), and a company filed under the party matches by
  name despite the home number (`numberIsFromAbroad` in
  `server/deal-hots.ts`). A company found by its name, not by the number the
  document gives, is offered with a press and never set by itself
  (`byName`). Test in `server/deal-hots.test.ts`.
- **The heads of terms stay open after setting the company** (found in the
  same check): opened from the party box, the dialog lived inside a section
  shown only while no company signs, so setting the company from it removed
  the dialog and left the party box closable only with Done. The section now
  stays while the dialog is open (`hotsOpen`).
- **A typed note** (`readHotsNote`; the route takes `text` in place of a
  file, up to 20,000 characters): the label rules, New Deal's party rules
  (`readDealNoteRules`: "Landlord is …", "letting … to …") with a company
  number written after a name (`numberAfterName`), and the letting note's
  shorthand for the terms (`readShorthand`: "300,000 pax", "10 yrs",
  "6 MRF", "£50k CC"), all through `readHotsNoteRules` and the same
  `checkHotsAnswer` as a document (`{ note: true }`: a note is checked
  against itself however short). The provider is sent the note alone.
  Nothing is filed from a note.
- **The read** (`POST /api/deals/:id/heads-of-terms/read`, BGP staff signed
  in as themselves, checked before the file is taken; 25MB; PDF, Word, text,
  or a typed note):
  each party the document names (landlord, tenant, guarantor; vendor and
  purchaser on a sale) with its registered company and Companies House number,
  and the terms the transaction holds (rent a year, lease in years, break, rent
  free in months, capital contribution, area, target date; price on a sale).
  Anthropic, called directly, one forced-tool call (`read_heads_of_terms`),
  capped a day (`HOTS_READER_DAILY_CAP`, default 100, 0 = off), sent the
  document and nothing from the CRM; the rules (`readHotsByRules`, the
  "Label: value" and table layouts) fill what it leaves out and read the
  document alone when it is off. Every value is checked against the document's
  own text (`checkHotsAnswer`): the quote is in it, the name is in its quote,
  the number is in the document, each figure is one its own words give in the
  unit the transaction stores. A scan cannot be checked: its lines say check
  by eye. Solicitors and agents are not parties; "Guarantor: None" is none.
- **A sum given as a figure and in words is read by the words** (Woody,
  24 November 2026, on One Clapham #4578: "that's got 000 wrong"). Its heads
  of terms gave "£2,325m (Two Million, Three Hundred & Twenty-Five Thousand
  Pounds)"; the figure was read as £2,325,000,000 and filled, and a provider
  reading of £2,325,000 from the words was dropped as "not in the words it
  came from". `sumByWords` (`sumInWords`, `figuresWithWords` in
  `shared/deal-hots.ts`) now settles a figure with a sum in words in brackets
  beside it that disagrees: the provider's answer, the rules and New
  Transaction's reader (`parseHotsHandler` in `server/crm.ts`: price, rent,
  capital contribution, fee) all take the words, and the dialog shows the
  term's `note` ("The figure £2,325m reads as £2,325,000,000 but the words
  beside it say £2,325,000: the words are used."). Tests in
  `server/deal-hots.test.ts`. #4578's price was put right on live the same
  day (£2,325,000; its Investment Tracker row followed).
- **Where each party is** (`matchHotsParties`, and `POST …/match` after
  anything is set, without reading the document again): the company filed
  under the transaction's party with that number or exact registered name
  (`legalNameKey`: the legal form aside, every word kept, so "Braeburn Estates
  (Holdings) Limited" is another company); else Companies House by the number
  (a name that differs is said), else by the exact name (several are a
  choice); a brand name with no company ("Bill's") is no company; with no
  party on the transaction, the CRM records of that name (`findParty`). A
  guarantor is shown, never set.
- **A number that is another company's is never offered** (found on live,
  23 November 2026: the test heads of terms gave 06327384 for Braeburn
  Estates Limited, which Companies House holds as AUSTIN BARBER DESIGN
  LIMITED, and the window offered Add … and use it). When the company a
  number names shares no word that tells companies apart with the name the
  document gives (`hotsNamesClose`: the legal form and common words such as
  Estates, Holdings or Property left out; a name of common words only is
  compared on all its words) and the name is not one of its former names
  (`previous_company_names`, which count as the same company), the window
  says "06327384 at Companies House is …, not …. The number may be wrong."
  (`numberIsAnother`), looks the name up instead and offers only what that
  finds. A guarantor's number is said the same way. A company filed under
  the party by that number is still offered, with "check it is the same
  company" when the names share no such word.
- **Nothing saves by itself**, except the company that signs where the
  reading is certain (below). The buttons save through the routes that
  already exist: Use as the company that signs (`PUT
  /api/deals/:id/parties/:role`), Add under <party> and use it (`POST
  /api/billing-entities` with `xero: false`, then the same PUT), Make them the
  tenant and Add as the tenant (the deal save, `POST /api/crm/companies`),
  Fill in and Fill the N blank ones (the deal save), and File these as the
  final agreed heads of terms (`POST /api/unit-hots/:unitId/final`, on the
  tracker unit the transaction is the letting of, PDF or Word only, when none
  are on file; they then go in the AML file). Each writes its own history.
- **Solicitors and agents** (Woody, the same day: "the HOTs upload / drop
  didnt pick up their solcitors or ours or their agent"). The reading also
  gives each side's solicitors and agents (`HotsContact`: side, solicitor or
  agent, the firm, the person, email and phone), often from a contact sheet
  at the end. The provider records them under `contacts` and each is kept
  only where the document's own words carry it (`checkHotsContacts`: the
  quote and the firm in the text, an email or phone the document does not
  give dropped). The rules (`readHotsContactsByRules`) read "Landlord's
  Solicitors: …", a label with the firm on the lines under it, and a row a
  PDF flattened onto one line ("Landlord Solicitors GT - GreenbergTraurig",
  only when the words read as a firm name, `firmLike`); a sentence, "TBC",
  the next clause and a clause heading ("Rent Free") are never a firm or a
  person. `mergeHotsContacts` fills the provider's blanks from the rules'
  reading of the same firm. The dialog's **Solicitors and agents** section
  (`hotsContactViews`) says what each is to this transaction: Bruce
  Gillingham Pollard is "BGP"; the other side's agent **Set as the tenant's
  agent** (or landlord's, seller's, buyer's: `HOTS_AGENT_FIELDS`); an agent
  on our client's side who is not BGP **Set as joint agent**; our client's
  solicitors **Save as our client's solicitors** (`solicitor_firm`,
  `solicitor_contact`); the other side's solicitors **Check at the SRA** (the
  Solicitors check of the AML box). Each first files the firm and its person
  in the CRM (`POST /api/deals/:id/heads-of-terms/contact`, BGP staff,
  `fileHotsContact` in `server/deal-hots-contact.ts`, the screen's one write
  of its own, so the read and match routes still write nothing: the person by email, else the firm by name, else added
  as type Agent or Solicitor with a note naming the transaction; a record
  already there only gains blank fields; the person is linked to the
  transaction), then saves through the transaction's own save. A firm already
  on the transaction reads "On the transaction". Tests in
  `server/deal-hots.test.ts`.
- **Asset managers are the client's contact, never an agent** (Woody, the
  same evening: "it pulled out the Landlord contact and wanted to add it as
  joint agent but its the client contact because they are the asset
  managers for the building ... they are often the person to ask for
  docs"). A contact's kind can be `manager` (`HotsContactKind`, with `role`:
  asset manager, property manager, managing agent, estate, fund or
  investment manager, `hotsManagerRole`): the provider's enum has it, the
  rules read "Landlord's Asset Manager" or "Managing Agent:" labels
  (`CONTACT_LABEL`), and a contact the provider calls an agent whose own
  words say asset manager or managing agent is a manager (`MANAGER_WORDS`).
  On the server (`hotsContactViews`) a manager, or a contact whose firm is
  the party itself (its brand or a company filed under it, by the whole name,
  `hotsFirmIsParty`), is `forParty`: never offered as the joint agent or the
  side's agent. The dialog (now **Solicitors, agents and asset managers**)
  offers **Make them who to ask** (`makeAsk`: the party box's own route,
  `POST /api/deals/:id/parties/:role/person`, found under the party by email
  or added there, with the role and their firm as the job title), says "Who
  to ask" once they are, and names who to ask now otherwise. With no email
  or mobile it says to add them in the party box. The contact route refuses
  a manager. Do we KYC an asset manager? Not as a customer (Issue 4 calls
  them intermediaries); the person who instructs us for the party is the
  person acting (MLR 2017 reg 28(10)): their identity check and authority to
  act, which the client checks already ask of who to ask.
- Not run against Anthropic or Companies House from a build machine.

## Guarantors, and the contracting entity worked out (Woody, 2026-11-23)

Woody, on Inception T2's party box (Cornhill Bar Ltd signs; Inception
Ventures Group Limited guarantees): "should be able to allocate add as the
guarantor", then "we dont need this commnetry it should just wiork out what
the contracting entity is". HMRC's letting guidance (AMLG2300, read
23 November 2026): s18 "Guarantors are a party to a tenancy agreement" and
are treated as customers; s19 the ID verification of the "tenant, guarantor
or trustee" is completed "before any agreement or contract is made"; s21
source of funds and wealth is verified "when guarantors pay". Do not
re-litigate. Rules: `shared/deal-guarantor.ts`; reads:
`server/deal-guarantors.ts`; routes in `server/deal-parties.ts`. Tests:
`server/deal-guarantor.test.ts` (in `npm test`),
`qa/regression/deal-guarantor-guards.test.mjs`.

- **A guarantor** is a company or a person filed under the party it stands
  behind, a tenant or a buyer (`GUARANTEED_ROLES`), never the company that
  signs; more than one is allowed. Kept in `deal_guarantors` (boot migration
  in `server/index.ts`: deal, role, the party's brand, the
  `crm_trading_entities` row, who added it; `removed_at` when taken off, one
  live row per guarantor). A row counts only while its company is still filed
  under the party the transaction names and is not the company that signs
  (`guarantorRows`). Merges repoint it (`COMPANY_REFS`).
- **Routes** (BGP staff signed in as themselves): `POST
  /api/deals/:id/guarantors { role, companyId }` (a history line `guarantor`;
  BGP's checks before asking start on it at once, `startPrecheck` with its
  entity), `DELETE /api/deals/:id/guarantors/:guarantorId`, and `POST
  …/:guarantorId/checks` (Run checks). The party view carries `guarantors`
  (`guarantorViews`: where BGP's checks on each stand, and its red flag
  count).
- **What follows from it**: its findings are red flags on the party it stands
  behind (`guarantorRedFlags`, keys `guarantor:<entity>:…`, labels "The
  guarantor, X: …"), on the transaction's AML box and the AML board
  (`withGuarantorFlags`); its people join that party's People to check
  (`guarantors` on `partyPeople`): a person who guarantees (role
  `guarantor`) and the people who own or control a guarantor company (role
  `guarantor_owner`, from its own register read) each owe an identity check
  and a proof of address and get links of their own (the email and page say
  why they are asked); its other directors are screened only; the party is
  signed off only once BGP's checks on each guarantor have run, in the last
  30 days (`guarantorChecks` on `SignOffFacts`, `guarantorChecksDenial`; a
  read that fails holds the sign-off); the AML file names each guarantor and
  what is still needed on it.
- **Screens**: in the party box each of the brand's companies other than the
  one that signs has **Guarantor** beside **Use**; the **Guarantor** section
  lists the guarantors with their checks (**Run checks**, **Remove**) and has
  **Find the guarantor at Companies House** and **A person guarantees** (the
  billing entity dialog, never a Xero contact). The party lines and the AML
  box's Who signs line name the guarantor. Heads of terms that name a
  guarantor offer **Make them the guarantor** (filed under the party) or
  **Add under <party> as the guarantor** (from Companies House by the number
  the document gives): a press, never set by itself.
- **The party box has no commentary**: the trust question shows only when the
  name reads like a trust, foundation or charity (`trustHint`); the
  paragraphs explaining the company that signs, who to ask and the CRM were
  removed.
- **The contracting entity is worked out by itself** where the app can be
  sure, for a party with no company that signs: the company on the unit's
  lease (`offer.why === "lease"`), set when the AML box or the party box loads
  (`useWorkOutSigningCompanies`, once per transaction and party, through the
  party save and its history line); and heads of terms or a typed note that
  name it for certain (a company filed under the party with that number or
  name, or the one live company Companies House holds under the number the
  document gives, with the same name), set when the reading comes back. The
  brand's main or only company is still a suggestion, never set by itself:
  Inception T2's main company is not the one that signs.
- Not built: a guarantor of a landlord or a seller; source of funds asked of a
  guarantor that pays.

## Another company signs too (Woody, 2026-11-24)

Woody, on #4664's party box: "can we add 2 entities? maybe should disappear
with just clear left and also add another entity or something?", then "yes".
A second company or person signing for the same party: joint landlords on one
title, a joint venture, two people buying together. Do not re-litigate.
Rules: `shared/deal-guarantor.ts` (`SIGNER_ROLES`, `signerRedFlags`,
`signerChecksDenial`, `signersNotCleared`); reads: `server/deal-guarantors.ts`
(`signerRows`, `signerViews`, `signersForParty`, `signerApprovals`); routes in
`server/deal-parties.ts`. Tests: `server/deal-signer.test.ts` (in `npm test`),
`qa/regression/deal-signer-guards.test.mjs`.

- **Kept with the guarantors**: a `deal_guarantors` row of `kind = 'signer'`
  (boot migration adds `kind`, default `'guarantor'`). Any party role; filed
  under the party, never the company that signs, and only beside one ("Set the
  company that signs for the landlord first"). One live row per company per
  party, so a company is a guarantor or another signer, never both (409 either
  way). Each read and route filters by kind; a guarantor route never touches a
  signer row and the other way round.
- **Routes** (BGP staff signed in as themselves): `POST /api/deals/:id/signers
  { role, companyId }` (BGP's checks start on it at once; a history line
  `signer`; the brand's transactions are recomputed), `DELETE
  /api/deals/:id/signers/:signerId`, `POST …/:signerId/checks` (Run checks).
- **Each one is a customer**, checked as a guarantor is and approved as the
  company that signs is: its findings are the party's red flags (`signer:<entity>:…`,
  "Also signs, X: …", on the transaction and the AML board); a company's owners
  (role `signer_owner`) and a person who signs (role `signer`) are People to
  check, each owing an identity check and a proof of address, its other
  directors screened only, and the person acting can pass them their links;
  the sign-off waits until BGP's checks on each have run in the last 30 days
  (`signerChecksDenial`, in all three sign-off paths), then **approves each one**
  with the main company (`approveEntityKyc` on every signer, same level and
  term).
- **The party reads cleared only while each signer is**: `loadPartyKyc` takes the
  transaction (`dealId`, and `signerKey` where the caller keys parties its own
  way) and reads the signers' own approvals (`signerApprovals`); an approved
  party with a signer not approved, expired, or approved for sanctions only on
  a transaction that needs the full checks reads as not cleared
  (`applySigners`, `signersOpen`; kycVerdict says "X also signs and is not
  signed off yet"). A failed read reads as not cleared, never as approved. The
  gate, the deal's `kyc_approved`, the AML box and board, the AML file, the
  sign-off and the status route all pass the transaction. A signer added after
  the party was cleared re-opens it until it is signed off. A company's own
  approval change recomputes the transactions it signs for as another signer
  too (`recomputeDealsForTradingEntity`).
- **Screens**: in the party box, under the chosen company (Change, Clear),
  **Also signs** lists each with its checks, **Run checks** and **Remove**,
  and **Another company signs too** offers the brand's other companies, **Find
  it at Companies House**, **Registered abroad** and **A person signs too**
  (the billing entity dialog, no Xero contact). The Parties card and the AML
  box's party lines show an **Also signs** row; the AML box's first step names
  them ("also signs: X") and says when checks are still to run; the AML file
  lists them and what is still needed on each.
- **Billing is unchanged**: BGP bills the company that signs for its client
  (or the party's billing entity), never the other signer.
- Also fixed: the filed-company delete guard read `deal_guarantors.trading_entity_id`,
  a column that does not exist, so the database error was read as zero and a
  company guaranteeing a transaction could be deleted. It reads `entity_id`
  now, and refuses a company that signs with another one too.
- Not built: a separate person acting for the other company (the party's who
  to ask acts for all its signers); heads of terms naming two landlords setting
  the second one by themselves; a guarantor of a landlord or seller.

## KYC4U is no longer used (Woody, 2026-11-23)

Woody: "We are no longer using KYC 4U update the app accross everyhting",
then "we want to keep and record the hiostoric AML checks from KYC4U though
which are downloaded on the app". Do not re-litigate. **This supersedes every
rule further down that sends a party to KYC4U, asks for KYC4U's result or
keeps a party waiting on KYC4U**: the red-flag hand-off (17 November), trusts
to KYC4U in full (20 November), KYC4U's portal, pack and Submitted record
(20 November), foreign-owned parties to KYC4U (21 November), the officers'
in-house switch (21 November) and ChatBGP's prepare_kyc4u_request. Read those
sections as history. Rules: `KYC4U_RETIRED_ON` / `KYC4U_RETIRED_WORDS` in
`shared/kyc4u-portal.ts`. Guards: `qa/regression/kyc4u-portal.test.mjs`,
`uk-screening-guards.test.mjs`, `kyc4u-gaps-guards.test.mjs`,
`aml-trust-second-read.test.mjs`, `aml-policy-guards.test.mjs`.

- **Enhanced due diligence is always the officers'.** `readInHouseEdd()`
  (`server/aml-authority.ts`) always answers on; there is no switch (`PUT
  /api/aml-policy/in-house-edd` answers 410, and the Policy pill reads
  "Enhanced due diligence: done by BGP's officers"). An enhanced, trust,
  foundation or owned-abroad party's client checks run as any party's, and
  the Nominated Officer or a Deputy signs it off with a note of what was
  checked (`signOffDenial`'s enhanced path; an agent cannot). The pure rules
  read a missing flag as in-house (`inHouseEdd !== false`, `inHouse !==
  false`); `false` only reads a file as it stood before 23 November.
- **Nothing goes to KYC4U.** The Next line has no KYC4U step (`amlNextStep`
  lost `request_kyc4u`, `kyc4u_form` and `kyc4u_result`); there is no Request
  KYC4U check, Download for KYC4U, Submitted on KYC4U's portal, red **Not yet
  with KYC4U** box or board mark (`amlNeedsKyc4u` is gone); Kick off AML sends
  every party the client checks, a flagged one too; the Heads of Terms
  convert offers the tenant the client checks; the AML file has no File for
  KYC4U (`POST /api/deals/:id/aml-file/kyc4u` answers 410); the WIP report's
  Not raised with KYC4U list is gone; ChatBGP has no prepare_kyc4u_request (a
  stale call is refused) and its prompt and app map say so. The server routes
  that start or send work to KYC4U answer 410 (connect, the admin consent
  link, sync, the drafts prefill and create, submitted), the bookmark's draft
  queue is always empty and the six-hourly sync is gone.
- **KYC4U's past checks stay and still count.** `kyc4u_requests`,
  `kyc4u_drafts`, `kyc4u_archive_files` and every KYC document filed from them
  are kept (the five-year deletion covers them as before); a past KYC4U
  approval keeps a party approved until its re-check; the AML file prints any
  past KYC4U check under "KYC4U (past checks)". A request made before
  23 November holds nothing up: the Documents step shows it as one history
  line. **Subscriptions & APIs → KYC4U** is the record: the request grid, the
  files copied into the app, and the Send to ChatBGP bookmark, kept to copy
  their latest records across while BGP can still sign in (it only reads; it
  fills no form). A company's strip reads "KYC4U's past checks", and an admin
  can still **Record a past KYC4U sign-off** given by email before then.
  Recorded from a transaction's party it goes on the company that signs
  (26 November 2026, Jack: on 334 Ramsbury Oxford it had gone on the brand's
  record and the party stayed uncleared), and on the brand too only when
  that company is the brand's own (`dealId`, `role` on the sign-off route).
  **Add KYC4U result** in a party's Sign-off step is offered only where a
  KYC4U request was made on that transaction (`pastKyc4u`, 23 November 2026).
- **Words**: the box's red-flag hints and the red-flag email name the
  officers ("needs enhanced checks"); the risk assessment says the officers
  identify owners abroad; the companies page reads "KYC approved / in review
  / rejected"; the unit panel "KYC:"; the brand pages "KYC4U's past checks".
- **Joint agent: we ask for their documents, never reliance** (Woody, the
  same day: "can we call another firm Joint agent", then "the reliance on the
  joint agent doesnt work we cant agree reliance. What we need is an email to
  come from us similar to the other emails sayng we are finanlise the KYC on
  this joint agent transaction and need you to upload or email back the
  following files. This should include all the docs including their proof of
  identity and any further AML they have dione", and "should also be able to
  reply with the documents"). Under the Documents step's Other ways the
  reliance button (Another firm) is gone; **Joint agent** sends the request
  (the party's own agent has its own route since the same day, below). The
  email (`jointAgentRequestEmail`, from the KYC mailbox) is headed
  "Finalising our KYC on <party>" and opens (Woody, the same day, on the
  page of request FC5BT6: "the intro changing to reflect the fact that we
  are jointly instructed by xxx client and you have undertaken the
  negotiations of this transaction ... the rest is pretty good")
  "We are jointly instructed by <BGP's client> on <transaction>, and you
  have undertaken the negotiations of this transaction with <party>, the
  <role>. We are finalising our KYC on them and need the documents below"
  (`jointlyInstructed`: the client's name from the transaction, kept on the
  request as `jointAgent.clientName`, else "the landlord", else "our
  client"); the page says the same. It lists (`jointAgentAsks`) proof of identity (passport,
  photocard driving licence or national identity card, or their electronic
  check report) for each owner and the person acting, proof of address from
  the last three months for each owner (never the person acting alone, since
  23 November 2026), the company's register entry and owners, and any
  further AML they have done (screening, risk assessment or CDD summary,
  source of funds); **Upload the documents**, or reply to the email with them
  attached (the reference in the subject files the reply, as before). Their
  page is headed the same and has no reliance terms step; the chase emails
  ask for what is missing in the same words. No reliance terms are asked for
  anywhere (`JOINT_ASKS_RELIANCE = false` in `shared/joint-agent-checks.ts`:
  the missing list, the page and the box): on a letting, with their documents
  in, the Next line reads "Ready to sign off · <firm>'s documents are in: add
  a note" and the officers (or an agent, on a routine party) sign the party
  off on BGP's own check of them. A reliance agreed before then still shows
  and can still be recorded. A sale keeps HMRC's ask and record (Not
  required with what came back). Guards:
  `qa/regression/joint-agent-checks-guards.test.mjs`; tests
  `server/joint-agent-checks.test.ts`.
- **The other side's agent passes on the standard checks** (Woody, the same
  day: "you are getting confused with the agents", then "with the agent
  acting for the tenant or against us we need them to pass on the standard
  KYC requests for their clients to complete the agent should have the
  ability to help organise by uploading docs etc."). Do not re-litigate.
  The joint agent (jointly instructed with BGP) is asked for their
  documents (above); the party's own agent (acting for the other side) is
  sent the party's ordinary client checks to pass on, never the joint
  agent's documents request. The joint agent's dialog asks the joint agent
  only, and a request with no relation is the joint agent's unless only the
  party's own agent is recorded (`jointRelationFor`).
  - **Sending**: Other ways offers **<Tenant's agent>** (the agent the
    transaction records, `askAgentLabel`; else Their agent) on any party BGP
    does not act for, and Send client checks has a **Send to** choice: the
    party's contact, or **Their agent, to pass on** (firm, who at the agent,
    and who at the party will complete it if known). `POST
    /api/aml/deal/:id/client-checks` with `viaAgent` (`createClientCheck`):
    the agent's address (never a BGP one), never for BGP's own client,
    nothing typed into the CRM, kept on the request as `request.viaAgent`
    (firm, who, BGP's client and role, `passedOn`). The token's address is
    the agent's, its name the person at the party (or none). With nobody to
    ask set at the party and its agent recorded, the Next line reads "To do ·
    Send the checks to <firm> to pass on" (`send_via_agent`, `theirAgent` in
    `shared/aml-box.ts`) and the who-to-ask gaps do not hold it up; then
    "Waiting on <firm>" until it is passed on, then on the person. The
    Sent confirmation stays open until the dialog is closed (the
    transaction's checks are read again on close).
  - **The email to the agent** (`kycViaAgentRequestEmail`): "We act for
    <client>, the landlord, on <transaction>, and you act for <party>, the
    tenant ... Please pass our standard checks on to your client to
    complete", the steps, **Open the checks**, forward this email or send
    the link from the page, upload what you hold for them, the identity
    check is the client's. Subject "Please pass on: our checks on <party>
    for <transaction> (ref X)", so a reply files.
  - **The page** is the client's ordinary page with a line saying who it
    was sent through, and **Send this to <party>** (`POST
    /api/kyc-upload/:token/pass-on`: name and email; the standard request
    email to them from the KYC mailbox, saying the agent asked, the agent
    and BGP's agents copied; three a day, two minutes apart, never a BGP
    address, never into the CRM). Either of them uploads the documents.
    With nobody named, the identity check asks for the full name of the
    person doing it first (it is set against that name); the person it is
    passed on to is the person, until a check has started.
  - **Replies** file from the agent, a colleague at the agent's firm, or
    whoever it was passed on to. **Reminders** go to the person it was
    passed on to with the agent copied, else to the agent in their words
    (`kycViaAgentReminderEmail`). Everything else (people to check, the
    sign-off, the board) reads it as the party's own client checks.
  - Guards: `qa/regression/kyc-via-agent-guards.test.mjs`; tests in
    `server/kyc-request.test.ts`. Not run against Microsoft from a build
    machine.
- **Settled by Issue 4 of the policy** (23 November 2026, next section): the
  outsourcing section now says the checks are carried out in-house in
  ChatBGP, and section D names Layla O'Driscoll and Woody Bruce as Deputy
  Compliance Officers (Issue 2 and Issue 3 still named KYC4U's outsourcing
  and Victoria Broadhead). Jack approved Issue 4 on 23 November 2026.

## AML policy Issue 4 is the source of truth (Woody, 2026-11-23)

**Issue 5 of the policy and Issue 4 of the risk assessment replaced these the
same day** (Jack signed off; see "Companies registered abroad, all in the
app"). They change only companies registered or owned overseas (no Dun &
Bradstreet) and translations; everything below stands in Issue 5.

Woody sent Jack's "BGP AML Policy: Recommended Amendments for Issue 4" ("this
is jacks updated BGP policies? Can you check?"), then: "Can you clean it up
and amend our Company policy on the app we will use that as the source of
truth. cant be AI slang stuff though needs to be normal", and "we are going
to use dun and bradstreet". Do not re-litigate. The recommendations were
checked against GOV.UK (HMRC's AMLG2200, AMLG2300, AMLG11410, AMLG11500,
AMLG11600; the Money Laundering and Terrorist Financing (Amendment)
Regulations 2026, SI 2026/621, in force 30 June 2026) and written into
**Issue 4 of the policy** and **Issue 3 of the risk assessment** in plain
words, with three corrections: a buyer's checks start at agreed heads of
terms and must be complete before exchange (HMRC treats the offer as
accepted at exchange; the recommendations said earlier); full checks on the
counterparty on every joint instruction, sales included, is BGP's choice and
goes further than HMRC (AMLG2200 s21 only asks a sale's other agent for its
checks); and FATF's increased monitoring list is treated as high risk by
BGP's choice (since SI 2026/621 the law requires enhanced due diligence for
call for action countries only).

- **The documents** (`AML_POLICY_DOCUMENTS`, buttons on Deals → AML →
  Policy): `bgp-aml-policy-issue-4.docx` (`policy-issue-4`) and
  `bgp-firm-wide-aml-risk-assessment-issue-3.docx` (`risk-assessment-issue-3`)
  in `server/assets/aml-policy/`; Issues 2 and 3 of the policy and Issue 2 of
  the risk assessment are kept on the quiet line (policy M). The footer of
  Issue 4 names Jack as approver and its change record says what changed;
  **Jack approved it on 23 November 2026** (Woody: "jack has approved"), and
  Jack is changing BGP's HMRC registration to add Layla. The file stays as he
  approved it. Each person confirms Issue 4 on My BGP →
  AML training (`CURRENT_POLICY_READ_TITLE` takes the latest issue).
  `POLICY_SOURCE` names both. The policy's link to the risk assessment and
  the risk assessment's link to the policy point at the app's Policy pill.
- **What Issue 4 says, and what the app does with it**:
  - **Simplified due diligence is a reduction, never an exemption**: owners
    are still identified unless the company itself is listed; never with a
    PEP, an unclear source of funds, ownership beyond one UK legal entity,
    any higher-risk factor, a call for action country or a suspicion (HMRC
    AMLG11500). In the app: an FCA-authorised fund's or a public body's
    owners are still identified (`simplifiedBasis` says so), and a company
    owned through a listed one is **standard**, not simplified
    (`simplifiedBasis` returns null for `viaParent`; `standardBasis` gives
    the reason "Owned through X, a listed company: standard due diligence";
    the officers, not KYC4U, confirm the chain and a market abroad).
  - **Super-prime value is weighed on every transaction**, not a red flag
    by itself (risk assessment Issue 3): `superPrimeWeigh` adds it to each
    party's factors to weigh (`server/kyc-red-flags.ts`,
    `server/aml-dashboard.ts`); `dealRedFlags` no longer adds it. Enhanced
    due diligence comes from another higher-risk factor or the agent's
    judgement. `superPrimeFlag` stays the reading. Until 24 November 2026
    the transaction save (`PUT /api/crm/deals/:id`) still marked every sale
    or purchase of £1m or more (£5m with "london" in its name) for enhanced
    due diligence, reason `super_prime`, which came back as a "Marked for
    enhanced due diligence" red flag (found when New Transaction's Use this
    transaction saved a price). The save now marks only a PEP, and a mark
    whose only reason is `super_prime` is no red flag
    (`eddMarkIsSuperPrimeOnly`), so marks already saved on live clear on
    read. Tests: `server/aml-policy.test.ts`,
    `qa/regression/aml-policy-guards.test.mjs`.
  - **The counterparty on a joint instruction is always checked**, using the
    joint agent's documents or BGP's own checks, sale or letting. The
    joint agent reason for Not required is gone: `jointAgentNotRequiredRefusal`
    refuses it on every transaction, `NOT_REQUIRED_CHOOSABLE` is
    `["no_deal"]`, `notRequiredInput` refuses anything else, and the record
    of asking (its form, `JointNotRequiredButton`, `jointRequestsForRecord`)
    was deleted. A joint agent mark made before Issue 4 lapses
    (`notRequiredLapse`) and its record still reads. A sale's joint agent
    documents are signed off as a letting's: "Waiting on Savills · for the
    documents", then "Ready to sign off · Savills' documents are in: add a
    note". The Rules page says BGP goes further than HMRC here.
  - **When checks are done** (Issue 4's table; Woody, 23 November 2026: "we
    want to make sure the app is capable of understanding what we need at
    each point and then make our own approvals"). BGP's own client who lets
    or sells: from engagement, complete before the property is marketed. A
    buyer, a tenant, and every party BGP does not act for: from agreed heads
    of terms, complete before exchange (a sale) or before the lease
    completes (a letting; the tenant's identity before any agreement is
    signed). Rules in `shared/aml-dashboard.ts`: `amlDue(role, status,
    clientRole)` (the client from `dealClientRole`; a landlord or seller BGP
    does not act for is now due from heads of terms, not at once),
    `amlDeadline` (the words and whether the transaction has passed that
    point: marketed from Available; exchanged from Exchanged) and `amlLate`
    (past it and not decided). Each dashboard row carries `deadline` and
    `late`: the AML board shows a red **Late** chip (the deadline in its
    title), lists late rows first and has a **Late** filter (`?late=1`); the
    transaction's AML box shows "Needed …" under each party's Next line, in
    red as "Late: needed …" once passed. On live on 23 November 2026 most of
    the To do list was BGP's client landlords on lettings already marketed,
    so most of it reads Late: that is what Issue 4 says. The Next line's
    "Not due yet" reads "from agreed heads of terms". The Rules page has the
    policy's line. **The AML board now takes in investment deals still on
    the Investment Tracker where Issue 4 needs checks** (`amlBoardDealSql` in
    `server/aml-dashboard.ts`): a sale from Live, Available or Negotiating
    (its seller is BGP's client), any investment deal from heads of terms;
    before, nothing showed until Solicitors, so the 11 sale instructions at
    Live on 23 November 2026 had no AML row. The Investment Tracker opens the
    AML window ("On the market: check the seller") when a sale first moves to
    Live or Available from an earlier stage (`amlBeforeMarketing` on the
    tracker's PATCH reply), as it does at Solicitors. **Not built: the app
    still lets a transaction move to Exchanged or Completed with checks
    outstanding and emails the officers** (Woody's "gating remain as is" of
    17 November 2026; Issue 4 says nothing exchanges or completes first).
    Whether the app should hold the move is Woody's call.
  - **In-house checks in ChatBGP** (section D and the risk assessment's
    outsourcing row): KYC4U's past checks kept as records; **Dun & Bradstreet
    reports for companies owned from overseas** (the evidence lists also
    accept a D&B report in place of the Companies House record with BGP's
    screening). The app has no D&B connection yet: it needs D&B Direct+ API
    keys from D&B (Railway `DNB_API_KEY` / `DNB_API_SECRET`, not set);
    BGP's D&B Finance Analytics web login has no API the app can use. Until
    then an officer downloads the D&B report and drops it on the party's
    **Upload documents**. **Superseded the same day** (Woody: Creditsafe said
    no and BGP has no D&B either, "all happen in the app including
    translation"): see "Companies registered abroad, all in the app" below.
    Issue 4's D&B lines are replaced in Issue 5, which Jack signed off the
    same day.
  - Also in Issue 4: the letting threshold is £10,000 a month or more;
    records kept five years from the end of the relationship; discrepancies
    reported to Companies House; when enhanced due diligence must be applied
    and that each case is approved by the Nominated Officer or a Deputy; what
    happens when checks cannot be completed (Stop acting); the officers named
    on BGP's HMRC registration; training; independent review.
- **The report so far** (Woody, 23 November 2026: "a download button of the
  report todate which we can share with suppliers however we dont intend on
  doing this"). Under a party's Documents step, **Other ways** has **Report
  so far** for the officers (the AML file button, `AmlFileButton` with
  `label` and `quiet`): the report alone (PDF) or with every document (ZIP).
  Each party's page of the AML report now has **Still needed**
  (`amlStillNeeded` in `shared/aml-file.ts`, fed by `stillNeededFor` in
  `server/aml-file.ts`): the deadline (late or not), the company that signs,
  BGP's checks before asking, a trust's information, each red flag and
  higher-risk factor, what each open client checks request and each person
  to check still owes, what the joint agent's files do not cover, and who
  signs it off (an agent or an officer; the Nominated Officer or a Deputy
  when enhanced; sanctions only on a small letting). It reads; it decides
  nothing. The file is still made by the officers only, recorded on the KYC
  history and the transaction, and never carries the AML register. BGP does
  not plan to use a supplier: the officers make their own approvals.
- ChatBGP's prompt and app map name Issue 4 and the risk assessment Issue 3.
- Tests: `server/aml-policy.test.ts`, `server/joint-agent-checks.test.ts`,
  `server/kyc-prechecks.test.ts` (all in `npm test`);
  `qa/regression/aml-policy-guards.test.mjs` and
  `joint-agent-checks-guards.test.mjs`.

## A party's files as thumbnails, and the Ugly Duck review (Woody, 2026-11-23)

Woody: "on the files can the app show the files so can check them at any
point rather than having to download a zip just a thumbnail can clikc and
it pops out?" Then, reviewing 65A Granville Arcade (The Ugly Duck: an
overseas landlord, a letting of £13,600 a year): "OK fix them but if TPG
are a client and we are doing lots of work for them is this a good enough
check?" Do not re-litigate.

- **Thumbnails** (`client/src/components/file-popout.tsx`, rules
  `shared/file-preview.ts`): `FileThumbGrid` draws files as small tiles (a
  photo as itself, a PDF's first page by pdf.js, anything else a tile with
  its type), two at a time as they come into view; a tile opens
  `FilePopout`: every page of a PDF, a photo with zoom and rotate, arrows
  between files, **Download**. Only this app's own addresses are fetched
  (`inAppFileUrl`), with the signed-in headers, as a blob; an SVG, HTML or
  XML file is never drawn (`filePreviewKind`). Word, Excel and Outlook files
  show a tile and download. Where: **Files on record** at the top of each
  party's Documents step (`PartyFiles` in `client/src/components/aml-files.tsx`,
  reading the AML board's trail route, `GET /api/aml-dashboard/party`, BGP
  staff only, which now sends each file's type), the AML board's trail, a
  client check request's files, and a file's name in **Upload documents**.
  Tests: `server/file-preview.test.ts` (in `npm test`),
  `qa/regression/aml-files-popout.test.mjs`.
- **An overseas entity's "Registered" is live** (`chStatusLive` in
  `shared/kyc-prechecks.ts`): a UK company reads "active", an overseas
  entity "registered". It was a red warning on AG Hondo Brixton Village BV.
- **A company abroad on the overseas register is read as listed**
  (`roeListedOwners`, `withRoeListing`, `normaliseStoredPrecheck`): the
  Register of Overseas Entities takes a company as a registrable owner only
  when it has its own disclosure duties (a UK company with its own register,
  an overseas entity on the register, or a company listed on a UK, EEA or
  named overseas market such as Nasdaq). One registered abroad that is not
  itself an overseas entity is therefore listed. When those are all of an
  overseas entity's registered owners, the party reads as owned through a
  listed company (`listing.market` `roe_disclosure`, `viaParent`): no people
  behind it to find, standard due diligence, the officers confirm the
  listing. Beside a named person, such a company is no owner abroad still to
  find. Applied when a check runs and on read (`latestPrecheck`, the AML
  board, the red flags), so no re-run is needed. A UK company's PSC register
  is not read this way (it is often filled in wrongly: Scp Aaa Invest,
  Monaco).
- **A simple sanctions-only version** (Woody, the same evening: "we have a
  sanctions only version for AML'S which is much simpler so not to confuse
  everyone"). On a letting under £10,000 a month (`amlRegime`
  `sanctions_only`), a party that is not a trust gets three steps in the AML
  box: **Who signs**, **Sanctions** (the sanctions line alone, with Run
  again: `PartyPrechecks only`; a possible match with its set-aside, and
  nothing else) and **Sign-off**; **Show the full checks** under the card
  opens the four steps (`fullView`, per page view). Only a possible
  sanctions match holds it up: `signOffDenial` has a sanctions-only branch
  (a sanctions match, checks running, not run, or more than 30 days old,
  a guarantor's checks), `signOffEnhanced` is false for it, so an agent on
  the transaction signs it off with no note, for 3 years, and its line on
  the history says "sanctions checks only" with no level. The Next line
  (`amlNextStep`) follows. Adverse media, public roles, owners abroad and
  other findings are information there, under the full checks. The AML
  board shows the party as **Sanctions only** (`sanctionsOnly` on the row)
  and lists only possible sanctions matches, with "Letting under £10k a
  month" under it. The sanctions line names who was screened.
- **A sanctions-only party waits on the sign-off** (24 November 2026): once
  screened it reads "BGP: sign off" on the AML board ("Officers: sign off"
  with a possible sanctions match), never "send the client checks", because
  nobody is asked for anything (`amlWaitingOn(stage, flags, sanctionsOnly)`).
- **The board's red flags are a count** (Woody, the same evening: "lets not
  show the actual problem in the table just 2 flags but click and it shows
  the explanations as pop up and can take to the AML board"). The Due
  diligence and red flags column reads "⚑ 2 red flags"; pressing it opens a
  pop-up (`Flags` in `client/src/pages/aml-dashboard.tsx`, a Popover that
  stops the row opening under it) listing each flag with its detail and
  source (`flagDetails` on the row), **Open the checks** (the party's trail
  on the board) and **Go to the transaction** (its Parties & AML pill). On a
  phone the card shows the count only and opens the checks itself. Tests in `server/aml-box.test.ts`, `server/party-kyc.test.ts`,
  `qa/regression/aml-box-sections.test.mjs`.
- **Sanctions-only parties ask for nothing** (a letting under £10,000 a
  month): the party lines read "Who to ask · Not needed: sanctions checks
  only" (also once signed off or not required), and Owners abroad shows what
  was found with no add buttons and no "Still to find"
  (`AbroadTrace sanctionsOnly`).
- **A sanctions-only sign-off covers small lettings only**
  (`applyCheckScope`, `entitySignOffScope`, `brandSignOffScope` in
  `shared/party-kyc.ts`). An approval is kept on the company that signs (or
  the brand) and read by every transaction with it, so Layla's sign-off of
  AG Hondo on a £13,600 letting would have read Cleared on a £10,000+ a
  month letting or a sale. Now `loadPartyKyc` takes `fullChecks` per party
  (the transaction's `amlRegime` is "full"), and a sign-off recorded as
  sanctions-only (the company's `crm_entity_kyc.evidence.bgpSignOff.regime`
  with its time matching the approval; for a brand, its latest
  `kyc_approved` history line, written with the approval, saying "sanctions
  checks only") reads as not yet checked there: the gate, the AML box, the
  AML board, the AML file and the sign-off all see it. The AML box says
  "Signed off … for sanctions checks only, on a smaller letting. This
  transaction needs the full checks." Callers that pass no `fullChecks` read
  as before. Tests in `server/party-kyc.test.ts`.
- **Is a sanctions check enough for a repeat client?** (Woody's question,
  answered the same day.) For each letting under £10,000 a month, yes: the
  law asks for the sanctions checks only. A letting at £10,000 a month or
  more, or any sale or purchase, needs the full checks on the landlord
  before marketing; for a client with a lot of work the full file is done
  once on each company that signs and covers its transactions for three
  years.

## Upload documents on a party (Woody, 2026-11-23)

Woody: "the documents upload button for KYC4U can that be just upload
documents but also add the drag and drop function in the new box we have
done so can upload certified documents, the app must read these and check
they are acceptable". Rules: `shared/kyc-documents.ts`; reader and routes:
`server/kyc-documents.ts`; box: `client/src/components/kyc-documents.tsx`.
Tests: `server/kyc-documents.test.ts` (in `npm test`),
`qa/regression/kyc-documents-guards.test.mjs`.

- **Where**: **Upload documents** in each party's Documents step on the
  transaction's AML (BGP staff): drag files onto it or Choose files (PDF,
  photos including HEIC, Word, or a zip, opened; up to 10 at a time, 25MB
  each), with **An agent saw the originals** to tick when they did. The box
  keeps its own drops: its drag handlers stop the event, so the app-wide
  **Drop to import** (`GlobalDropZone`, on window) neither shows over it nor
  opens Import Anything (a drop on it did both until a browser check on
  23 November 2026; the Describe the transaction box had the same fault and
  the same fix). The same file (name and size) is filed once per party:
  dropped again it is listed as already uploaded, or, with the tick, the
  copy already filed is marked as seen in the original.
- **Filed** on the party's KYC record (the company that signs when the
  transaction names one, else the brand), with a `kyc_document_readings` row
  (boot migration in `server/index.ts`: the reading, seen original, who
  uploaded, an officer's acceptance). Five-year deletion and company merges
  cover it.
- **Read** in the background (the box reads again every few seconds while a
  file waits), by Anthropic called directly, one forced-tool call a file
  (`read_kyc_document`), capped a day (`KYC_DOCUMENT_READER_DAILY_CAP`,
  default 200, 0 = off), sent the file alone: the kind, the names as
  printed, date of birth, issue and expiry dates, a bill's date, the
  address, and whether it is certified as a true copy with the certifier's
  name, profession or firm and date. The KYC record files it under the type
  it was read as. **Read again** per file.
- **Checked** (`checkKycDocument`): an identity document counts for the one
  person to check it names (date of birth agreeing with the register's),
  in date, and certified with the certifier's name, profession or firm and
  date, or seen in the original by an agent; a proof of address by the
  proof of address rules; company documents are kept on the record. Each
  failure is a plain reason. **Accept it** (the Nominated Officer or a
  Deputy, with a note) counts one that did not pass.
- **Counts** on the people to check (`uploads` in `shared/kyc-people.ts`):
  "Identity document uploaded by BGP and checked" and "Proof of address:
  uploaded by BGP and checked", so nothing more is asked of that person.
- Not run against Anthropic from a build machine: checked in a browser on a
  local copy with the reader off and with a reading written in its shape.

## Verified from public sources: admins only, with a search (Woody, 2026-11-23)

Woody: "verified from public records button needs to be for admins only",
then "should search and pull out what it can to actually verify for public
records can it also then make a suggestion if thats a reasonable amount or
have to ask for further info". Rules: `shared/public-records.ts`; search:
`server/public-records.ts`; routes in `server/deal-party-aml.ts`. Tests:
`server/public-records.test.ts` (in `npm test`), the guard in
`qa/regression/kyc4u-gaps-guards.test.mjs`.

- **Admins only**: the button shows to an admin who is an AML officer
  (`canDecide && admin` on the person row), and the three routes (record,
  withdraw, search) use `adminDecider`: the Nominated Officer or a Deputy
  who is also an admin (`is_admin` or `ADMIN_EMAILS`).
- **Search public sources** in the dialog (`POST
  /api/deals/:id/parties/:role/public-figure/search { key }`): Perplexity
  (`sonar-pro`), sent the person's name, their role and the company, and
  their month and year of birth; capped a day (`PUBLIC_RECORDS_DAILY_CAP`,
  default 60, 0 = off). A fact is kept only when its page is one the search
  read (`checkPublicRecordsAnswer`), and one that may be about someone else
  of the same name is shown but not counted.
- **The suggestion** (`publicRecordsSuggestion`): enough when at least two
  separate sites are about them (a `.co.uk` site is one site), at least one
  ties them to the company, and no source gives another age than the
  register's; otherwise "Ask for their ID" with the reasons, and send them a
  link instead. Only when it is enough does it fill the note and links
  (and only boxes still empty); the officer still reads and saves it
  (Record it), and the search records nothing beyond a line on the KYC
  history.
- Not run against Perplexity from a build machine: the dialog was checked in
  a browser on a local copy with the search's answer supplied.

## Client checks: the in-app KYC request (Woody, 2026-11-17)

Woody: the emails should "come from kyc@chatbgp.app", "copy the agent that
has done the deal" and carry the "BGP logo"; "check the whole system because
it was built ages ago and wasnt working properly"; "not that clear or user
friendly"; then "check this all against HMRC guidance" and "FCA and bank of
England Guidance". The in-app request an agent sends a party's contact, the
client's own page, reminders, replies by email, and the admin's test send.
**It runs on its own switch** (Woody, 18 November 2026, shown that the
deal card offered only KYC4U on live, chose "client checks only"): on
unless `KYC_CLIENT_CHECKS=off`, whether or not the old in-app AML
(`IN_APP_AML_ENABLED`) is on. One rule, `clientChecksSwitchOn` in
`shared/kyc-request.ts` (`clientChecksOn` in `server/aml-portal.ts`): the
retired-AML switch lets the staff addresses in `KYC_CLIENT_CHECK_ROUTES`
through (the deal's client checks, remind, cancel, the admin's mailbox read;
the rest of `/api/aml/` stays retired), sending and reminding answer 410
while it is off, the reminders and the KYC mailbox reader follow it, and the
deal card, Kick off AML and the admin card read `clientChecks`. The old
in-app AML stays off on live: no screening of every party when a deal is
made or moves to HOTs or Solicitors, no re-screens, no old checklist
screens. A party still clears the card's "AML approval needed" only when
its `kyc_status` reads approved, which with in-app AML off only KYC4U's
sync writes. Until 18 November the agent's side showed only while in-app
AML was on, which it is not on live. The client's page and the admin's test
work either way. Server `server/aml-portal.ts`; every email's words and the
page's rules `shared/kyc-request.ts`; client page
`client/src/pages/kyc-upload.tsx` (public, `/kyc-upload/:token`); agent
dialog and request rows `client/src/components/kyc-client-checks.tsx` (on
the deal's KYC card per party, and the deal form's Kick off AML step);
admin card `client/src/components/kyc-emails-admin.tsx` (the AML
dashboard's **Client check emails** pill, admins, since 21 November 2026;
on the KYC4U pill of My BGP before). Tests: `server/kyc-request.test.ts` (in `npm test`),
`qa/regression/kyc-client-checks.test.mjs`.

- **What was wrong, and the rule now** (do not undo): it sent from
  `BGP_AML_MAILBOX`, never set, so nothing went (now `KYC_MAILBOX`, default
  kyc@chatbgp.app, then the shared mailbox when Microsoft will not send as
  it, through `sendKycEmail`, the one door); its link opened a "no longer in
  use" page (the page is back); an upload was read by the AI and then
  DELETED (every file is stored with `saveFile` and filed in `kyc_documents`
  on the party, with the checklist items it evidences ticked for the MLRO to
  confirm, the KYC pack's rule); the reminder and the reply reader never ran
  (reminders daily 10:00, `kyc-client-reminders`; the KYC mailbox read every
  15 minutes; both only while the client checks are on); the agents were never
  copied (the deal's agents, `internal_agent_ids` / names and the fee split,
  never BGP House, BGP addresses only, plus the sender); the links pointed at
  app.brucegillinghampollard.com (now `PUBLIC_APP_URL`, default chatbgp.app);
  the orchestrator started a paid Veriff check for EVERY contact on a company
  and sent nobody the link (removed: the identity check is asked for one
  person, from the request); WhatsApp free text was sent from the server,
  which WhatsApp refuses for a business's first message (removed: a wa.me
  link opens the agent's own WhatsApp); Veriff's event webhook wrote a blank
  status over a session (it now records started / submitted and never
  overwrites a decision).
- **Clients and joint agents read "transaction", never "deal"** (Woody,
  2026-11-22, on the client's page: "Can we call the deal the
  transaction"): the client's page, the joint agent's page, a person's own
  link and every email and WhatsApp text to them, and since the same day
  every BGP screen too (see "The app says transaction" below). The deal's
  name still names the transaction. Tests in `server/kyc-request.test.ts`
  and `server/joint-agent-checks.test.ts`.
- **One email, one page.** The request email has the logo inline (cid), a
  numbered list of what is needed, one **Start your checks** button, the
  agent's note, Why we ask, the agent's phone and email, and the reference
  in the subject so a reply finds its request: a random code made for each
  request (six letters and digits, none that can be misread), never the
  transaction's Ref #. Since 23 November 2026 (Woody: "keep it but make it
  small it's only for our use") it is a bare tag at the end of the subject,
  `[7K2Q9M]`, pale 10px text at the foot of the email and the page, and
  nothing asks the client to keep it; `kycRefFromSubject` still reads the
  old `(ref 7K2Q9M)` on replies to emails sent before, the last tag counting. The page: a card per step with an Upload button (PDF, photos
  including HEIC, Word; 25MB; 40 files a request), the Veriff check (returns
  to the page when done; a new session at most three times), the question,
  progress, and **Finish**, which emails the deal's agents what came in and
  what did not. Reminders three and seven days after sending while anything
  is outstanding, and only while the deal is live: never for one deleted,
  withdrawn, completed, invoiced or archived (`CLOSED_STATUSES`; a deal
  with no status counts as live). Woody, 19 November 2026: "Yes don't
  chase", of a deleted deal; 20 November: "only chase live deals". The
  deal's requests stay as they are. A reply by email is filed only when it carries a request's
  reference AND comes from the address the request went to; anything else is
  marked in the mailbox for a person (`BGP-KYC-Unmatched`) and never filed.
- **Checked against HMRC's guidance for supervised businesses** (AMLG2200
  estate agency, AMLG2300 letting agency, AMLG11400 identification and
  verification, AMLG11600 / 11630 / 11650 enhanced due diligence, source of
  funds and PEPs, AMLG11700 records; read 17 November 2026). What it changed:
  the identity documents HMRC lists (passport, photocard driving licence,
  national identity card); without the online check, photo ID is a CERTIFIED
  copy ("Certified to be a true copy of the original seen by me") or the
  original shown to the agent, because HMRC wants originals where possible;
  address documents are those HMRC names (utility bill, bank or building
  society statement, mortgage statement); beneficial owners are "more than
  25%" or control (MLR reg 5), never "25% or more"; a company's contact
  confirms their authority to act (a director's email or letter, AMLG11400
  14.7: "Obtain evidence that they have authority to act"); an overseas
  company sends a register extract (14.8); source of funds is where the money
  comes from, not only the bank (AMLG11630), and is asked of a tenant as well
  as a buyer (AMLG2300 s21: "all customers making a payment"); the data
  statement of MLR reg 41 ("only to prevent money laundering and terrorist
  financing") and the privacy notice (brucegillinghampollard.com/privacy);
  records "kept for five years after our work with you ends" (AMLG11700);
  the agent's dialog says when HMRC expects each party's checks (landlord:
  before terms of engagement and before marketing; tenant: once the landlord
  accepts the offer, before any agreement, no deposit before; seller: before
  marketing; buyer: before an offer is accepted, at the latest exchange) and
  that a letting is in scope at £10,000 a month or more for any part of the
  term, turnover rent included; the agents' email reminds them to compare the
  owners with the PSC register, a difference being reportable to Companies
  House.
- **The question about public roles** (`KYC_PEP_QUESTION`): every request
  since 17 November asks it ("Asking your customer" is one of HMRC's ways to
  find a PEP; screening is the other). Its words are the legal definition
  and no wider (MLR reg 35(12)-(14); the FCA's FG25/3, which replaced FG17/6,
  found firms using definitions wider than the regulations): family is a
  spouse or partner, a child and their spouse or partner, a parent (never a
  sibling); 12 months after leaving office; middle-ranking and junior
  officials excluded. A yes or not sure goes on the party's KYC trail
  (`client_pep_declaration`), shows on the request and in the agents' email
  as enhanced due diligence: senior management approval (a director or the
  MLRO), source of wealth and of funds, closer monitoring; lighter for a UK
  PEP with no other risk factor (FCA FG25/3). It never writes
  `aml_pep_status` (the MLRO's field).
- **FCA and Bank of England** (17 November 2026): BGP's AML supervisor is
  HMRC; the FCA supervises financial firms and the Bank of England / PRA
  supervises no one for AML, so neither's AML rulebook binds BGP. What does
  apply: the FCA's PEP guidance as the reference for PEP treatment (above),
  and sanctions: the app screens the FCDO's UK Sanctions List
  (`server/sanctions-screening.ts`), the one list since OFSI's Consolidated
  List closed on 28 January 2026; estate agents, and letting agents since
  14 May 2025, are OFSI "relevant firms" and must report a designated person
  or a breach to OFSI as soon as practicable, whatever the rent, even when
  the business is declined. The dialog's scope line says so.
- **Admin test** (`GET /api/admin/kyc-emails`, `POST
  /api/admin/kyc-emails/test`, admins only): every email as the client sees
  it, and **Send me a test** to the admin who pressed it, copied to nobody.
  The test request's link opens the real page in test mode (a token with
  `is_test`, two days, uploads recorded by name only and not kept, Finish
  emails the same admin). A failed send still returns the test page's link.
  **Try it with a colleague** (Woody, 2026-11-17: "send a test email to both
  me and jack@... that he needs to do KYC for bruce Gillingham pollard ltd as
  a test so we can see how it works"): the request only, to one ACTIVE login
  with an address on brucegillinghampollard.com (`toUserId`; anything else is
  a 400, so a test never reaches an outside address), naming the company or
  person being checked (`partyName`, `partyKind`; words only), copied to the
  admin, who is the agent on it. It is still an `is_test` token. Who hears
  back from any request is one rule, `kycReplyAddresses` in
  `shared/kyc-request.ts`: the copy list (the deal's agents and the sender),
  never the client; a self-test has none and comes back to its own address.
  So the colleague's Finish note and any red-flag alert go to the admin. The
  banner names the admin (`testBy`) instead of "nothing sent to anyone
  else". **A test page runs a real Veriff identity check** when Veriff is set
  up (Woody, 2026-11-17: "can you do the test page a real identity check
  with veriff"; `real` on the page's `idCheck`), charged like any check and
  under the same three-session cap. Its session has no company or contact
  (deal `test`), so an approval files nothing on any party (the decision
  handler files a document only for one or the other); its own sessions feed
  its red flags (`requestIdChecks` in `server/kyc-red-flags.ts`), so a
  decline alerts the admin and is listed in the Finished note. A test page
  without Veriff set up still shows the step only. Uploads on a test are
  still recorded by name only and not kept. While in-app AML is off, the
  retired switch in `server/index.ts` keeps two Veriff addresses open for it:
  `/api/veriff/webhook` (Veriff's decisions; Veriff signs them and the
  handler checks the signature) and `/api/veriff/diagnostic` (admins only:
  it asks Veriff for a session and reports Veriff's answer). When Veriff does
  not start a check, a test page shows the tester Veriff's own reason; a
  client sees the plain "couldn't be started" line. First try on live, 17
  November 2026: Veriff answered 401, code 1804, "Integration with the API
  key ... is not active" (read with the diagnostic): the integration whose
  key is on Railway is switched off at Veriff (the Veriff keys were on the
  October rotation list). Woody's to fix in Veriff Station: activate it, or
  put an active integration's API key and shared secret on Railway
  (`VERIFF_API_KEY` / `VERIFF_SECRET`, or the other names `getCreds` reads)
  with its decision and event webhook URL https://chatbgp.app/api/veriff/webhook.
  The diagnostic's signed webhook loopback passed the same day. Later that
  evening Woody switched the integration on and the diagnostic passed in
  full: Veriff created the session. Whether Veriff's own webhook delivery
  reaches the app (the URL set in Veriff Station) is first seen when a real
  check is finished: a check that stays at submitted and never shows a
  decision means the URL there needs setting.
- **Schema** (additive, nullable, boot MIGRATIONS in `server/index.ts`, not
  in `shared/schema.ts`): `kyc_upload_tokens` gained `company_id`,
  `contact_id`, `request` (JSONB: `KycRequestDetails`), `completed_at`,
  `reminders_sent`, `last_reminded_at`, `is_test`; `kyc_upload_files` gained
  `doc_type`, `kyc_document_id`. Approved with the push (Woody,
  2026-11-17: "push the work to date").
- **The deal gate stays as it is** (Woody, 2026-11-17: "gating remain as
  is", asked about HMRC's line that a contract cannot proceed without CDD):
  a move to Solicitors with checks outstanding warns and does not stop; only
  an MLRO rejection blocks. Do not add a hold at exchange or completion.
- **The gates**: `/api/kyc-upload/*` is no longer on the retired-AML list and
  passes the client gateway (the token is the only key, and no live token
  exists while the client checks are off except an admin's test). Every
  other client checks route is under `/api/aml/`, let through the retired
  switch by `KYC_CLIENT_CHECK_ROUTES` while the client checks are on, and is
  BGP staff only (`contactViewer`).
- **How BGP runs AML** (Woody, 2026-11-17: "basically we do the normal
  checks expected and if there is a red flag then we get KYC4U"): the
  client checks and screening in the app for the routine checks; a red flag
  goes to KYC4U (Request KYC4U check, beside Send client checks on each
  party). AML Dealcheck (Compliance On Demand), offered the same day, was
  not taken up (Woody: "looks rubbish").
- **The red-flag hand-off** (Woody, same day: "yes build the red flag
  handoff to KYC4U"). Rules: `shared/kyc-red-flags.ts` (`partyRedFlags`,
  `dealRedFlags`, `redFlagNote`; tests `server/kyc-red-flags.test.ts`, in
  `npm test`, and `qa/regression/kyc-red-flags.test.mjs`); reading and
  alerting: `server/kyc-red-flags.ts`. Every flag is read from a record the
  app already holds, and nothing decides: KYC4U does. A party's flags: the
  client's yes or not sure to the question about public roles (any request
  to it on the deal; a later no does not wipe it), a declined Veriff check,
  `aml_pep_status` read as review_required, PEP or close associate (the KYC
  form's own reading), the latest `kyc_investigations` row with a sanctions
  match, `aml_risk_level` high or critical, and `aml_edd_required` (with its
  reason: the landlord packs set it, as on Bulgaria Mall). The deal record's
  own: its PEP status, risk, enhanced due diligence not yet completed, and a
  source of funds document read as not matching what was declared. Not a
  flag on purpose: the MLRO's rejection (it already blocks) and a client who
  has not replied (chase them). Since 17 November 2026 the latest screening
  is the latest record that screened anyone (`SCREENED_INVESTIGATION_SQL`),
  and BGP's checks before asking add their own flags, adverse media with a
  source among them, and the client saying the register's owners are wrong
  (`owners_differ`): see the next section.
  Where they show: `redFlags` on `GET /api/kyc/deal/:id/status`, for BGP
  staff signed in as themselves only (`contactViewer`), on the deal's KYC
  card (a red box per party, the deal record's above, and a line naming any
  record that could not be read: never a silent "no red flags"); in the
  KYC4U request's note (`kyc4uPrefill`), so Request KYC4U check carries
  them; in the agents' Finished email; and in Kick off AML, where a flagged
  party gets the KYC4U request instead of the client checks. **The alert**:
  the client's yes or not sure, and Veriff declining a check the client page
  started, email the agents copied on the request at once ("Red flag on
  <deal>: raise <party> with KYC4U", `kycRedFlagEmail`), once per flag per
  request (`request.redFlagAlerts`, written only after a send), never the
  client; a test request alerts the admin. The other flags show on the card
  and in the note but send no email. Admins preview and test it with the
  other client check emails.
- **Veriff is on the UK DVS register** (checked 17 November 2026,
  access-dvs-register.service.gov.uk): provider "Veriff OÜ", service "Veriff
  UK Identity Verification Service", roles Identity and Component, trust
  framework 0.4 gamma, certified by Kantara, certificate 14 January 2026 to
  14 January 2029, profiles L1B, M1A, M1B, supplementary codes Right to Work
  and Right to Rent. HMRC (AMLG11400 14.5): a service "certified against the
  trust framework and on the DVS register" is "a reliable and independent
  source".
- **Not built, each waiting on Woody**: the kyc@chatbgp.app mailbox exists
  since 17 November 2026 (see "Emails come from chatbgp.app" below), but
  sending as it and reading it from the app have not been seen working from
  a build machine: the admin's Send me a test says which address an email
  came from; whether the privacy notice covers AML
  processing (reg 41 / Article 13: read on 17 November 2026, it does not:
  no controller company or number, no lawful basis, no AML or reg 41
  statement, no retention period, no right to complain to the ICO; an AML
  notice for these checks is Woody's and Rupert Bentley-Smith's to approve);
  records are not deleted after the five years; the app does not prompt an OFSI report on a sanctions match;
  trusts, partnerships and charities have no request type of their own; the
  principal place of business (if not the registered office) is not asked.

## BGP's checks before asking (Woody, 2026-11-17)

Woody: "can you make sure you use all the companies house APIS to get the
recent accounts downloaded for any check first before asking?", "and also
access to plcs? how do we deal with that?", "the pep is that siorted?", "and
the poloticaly media riskes etc ?", "we need to do everyhting we can before
we ask questions on someone". Asked, he chose "Web search now, CA later"
(public roles and adverse media by a web search with sources for each
person, ComplyAdvantage automatically once it is unblocked and has fresh
keys) and "Ask only what's left". Do not re-litigate. Rules (pure):
`shared/kyc-prechecks.ts`; gathering and storing: `server/kyc-prechecks.ts`.
Tests: `server/kyc-prechecks.test.ts` (in `npm test`),
`qa/regression/kyc-prechecks-guards.test.mjs`.

- **What one run does, per deal party** (`runPrecheck`): a company with no
  Companies House number is first looked for by the brand-page lookup
  (`performAutoKyc`, at most once a week). Companies House: the profile,
  officers, PSCs, PSC statements, the PSC exemptions, insolvency, the
  ownership chain (`discoverUltimateParent`, five levels), the disqualified
  directors register for up to ten directors (name, then date of birth: a
  different year sets a name match aside), and the covenant report (charges,
  The Gazette). It downloads the latest accounts (`fetchLatestAccountsForCompany`),
  the latest confirmation statement and the certificate of incorporation
  (the NEWINC filing) and files each on the party's KYC record
  (`kyc_documents`, types `company_accounts`, `confirmation_statement`,
  `company_cert`; the file under `chat-media/kyc-ch-<company>-<doc>.pdf`),
  once per Companies House document id, so Request KYC4U check attaches them.
  Sanctions: the UK Sanctions List and the US OFAC list (`screenName`) for the
  company, its trading name, every officer and owner, the companies and people
  up the chain and the deal's contact. A listing is a possible match only when
  one name holds every word of the other (two words at least) and a known date
  of birth does not disagree by more than a year (`sanctionsLine`). Web:
  Perplexity (`sonar-pro`) for the company and up to ten people
  (`KYC_PRECHECK_MAX_WEB_PEOPLE`), asked about public roles in the words of
  MLR 2017 reg 35 and about adverse media (financial crime, corruption,
  sanctions, criminal charges, disqualification, regulatory enforcement; not
  ordinary disputes or a past insolvency); a finding is kept only when its
  link is on a site the search actually read (`checkWebAnswer`), and anything
  said without one is only counted. ComplyAdvantage: used when its keys are
  set, through the Mesh client (next section), with each subject sent as a
  person or a company and a person's year of birth; a refused sign-in (and
  only that: `errorKind === "sign_in"`) is remembered against a hash of the
  keys (`system_settings.kyc_precheck_ca_refusal`) and not tried again for a
  day or until different keys are set, because the older login's repeated
  failures keep its account locked. ComplyAdvantage was blocked (429) on
  17 November 2026.
- **Stored** as a `kyc_investigations` row (`result.kind = 'precheck'`, with
  `sanctionsScreening` so it counts as a screening; `sanctions_match` true,
  false, or null when the lists could not be loaded), a `kyc_audit_log` line
  (`precheck`). It writes no KYC status, PEP status, EDD flag or checklist
  tick: nothing it finds decides anything; it becomes red flags
  (`precheckRedFlags`: sanctions, a ComplyAdvantage match, a public role or
  adverse media with its link, the company in liquidation or similar,
  insolvency or a Gazette notice, a disqualified director, a PSC statement of
  concern, an owner registered offshore) and lines in KYC4U's note
  (`precheckNote`).
- **When it runs**: when a BGP person (signed in as themselves) opens the
  deal's AML card and the party has no run from the last 30 days (on the
  deal page that is the **Parties & AML** pill: since 18 November 2026
  nothing else on the page reads the AML status; before, the page read it
  on every open)
  (`dealPrechecks` from `GET /api/kyc/deal/:id/status`, which returns
  `prechecks`; the Kick off AML step after New Deal or a handover reads the
  same status, so a run starts the moment a deal is saved); on **Run again** (`POST /api/kyc/deal/:id/prechecks`, BGP
  staff only, one party or all; until 18 November 2026 the retired-AML
  switch in `server/index.ts` answered it 410 while in-app AML was off, so
  its exception now names `status` and `prechecks`); and from KYC4U's
  prefill (`kyc4uPrefill` starts one if needed and waits up to 20 seconds).
  Never on a timer or at
  boot. A daily allowance (`KYC_PRECHECK_DAILY_CAP`, default 40 runs, 0 =
  off) and `KYC_PRECHECKS=off` stop it. A run is in memory while it goes: a
  restart loses it and the next view starts it again.
- **The deal card** (`PartyPrechecks` in `deal-aml-status.tsx`): a
  **Checked before asking** box per party, reading again every 5 seconds
  while a run goes, with anything to review listed at once and **Show** for
  every line (`precheckCardLines`).
- **A listed company** (the plcs question): Companies House's exemptions
  resource names the market. A UK or EU regulated market, or DTR chapter 5,
  is listed on a regulated market (MLR 2017 reg 28(5)): no beneficial owners
  to ask for, though the company itself is still identified. A market
  elsewhere (`other_regulated`, `listed_market`) is treated the same but the
  reason says KYC4U is to confirm the market's disclosure rules are
  equivalent. AIM is not a regulated market: an AIM company keeps a PSC
  register and is asked as any other. A company owned through one corporate
  owner at each level by a listed company (`viaParent`, found by
  `listedParent`, which reads each level's exemptions first because a listed
  company keeps no PSC list and the general chain walk stops below it) is
  treated as listed, and the reason says KYC4U is to confirm the chain: the
  regulation names the listed company itself.
- **One owner listed twice** (23 November 2026, on St George plc, Woody:
  "still asking for info on a plc? is that needed?"): Companies House can
  hold the same owner twice, a notification made again and the first never
  ceased (St George lists The Berkeley Group plc from 2016 and from 2017,
  both active, one number), and `listedParent` needs one corporate owner at
  each level, so it never reached The Berkeley Group Holdings plc (exempt as
  listed on a UK regulated market since 7 July 2017) and the box asked the
  client who owns St George. `dedupeRegisterOwners` (shared/kyc-prechecks.ts)
  merges owners by registration number (else name; a person by name and
  month and year of birth): new runs store them merged, `latestPrecheck`
  merges stored runs, and `listedParent` reads them merged at every level.
  The listing is found only by a run: a party checked before needs Run again.
- **Ask only what's left** (`precheckAsks`, the one rule; the client checks
  dialog and `createClientCheck` both call it): listed, no owners chart and no
  owners' IDs; **no proof of address from the person acting for any company**
  unless the register names them as an owner (Woody, 23 November 2026, first
  for a listed group, "If HMRC don't require it then stop it", then for every
  company, "If they don't need it then let's not require it"): HMRC asks only
  their identity and authority (MLR 2017 reg 28(10)), and Issue 4 asks an
  individual for proof of address only as the party or an owner.
  `defaultKycDocs` no longer lists it for a company, `precheckAsks` adds it
  back when the person asked is one of the owners and otherwise lists it as
  not asked (`ACTING_NO_ADDRESS`), and People to check marks the person acting
  who is not an owner, guarantor or a trust's person `address.notNeeded`
  (`actingOnly` in `shared/kyc-people.ts`: owing the identity check alone);
  their own link and the joint agent's list (`jointAgentAsks`: "For each
  owner") leave it out. A trust's representative and a private individual are
  asked as before. A request already sent keeps the step (on live that day one
  open request, 4KM9Q3 on Inception T2): nothing waits on it, the client can
  press Finish without it, but its reminders still list it; owners on the register, the client confirms the list instead of
  sending a chart (a new card on the client page, `POST
  /api/kyc-upload/:token/owners`, a no needs words, logged as
  `client_owners_confirmation`, a red flag `owners_differ` and a box in the
  agents' finished note: report the difference to Companies House, HMRC
  AMLG11400 14.8), and the owners' IDs step names them; a contact who is a
  director at Companies House is not asked for authority; a tenant company
  whose accounts made up within 24 months were downloaded (not dormant) is not
  asked where the money comes from (a buyer still is); a company not found at
  Companies House is asked for its overseas register extract. The request
  records `notAsked` (with reasons), `confirmOwners`, `ownerNames`,
  `ownersAnswer` and `precheckId`; the dialog lists what was not asked and the
  agent can tick anything back. With no finished run, the usual list is asked.
- **Sending waits for the register** (Woody, 24 November 2026, on #4664: "I
  clicked in the add people button before it had searched the companies?
  should it wait"). The landlord's request went to Kenneth Tam three minutes
  after BGP's checks read the register, with the list the send window had
  made before they finished: a structure chart, "ID for each of those
  owners" as documents and his own proof of address, and no identity check
  of their own for the owner, Lee Chung Chan. Now the client checks list
  carries `precheckRunning` per party and is read again every 3 seconds
  while a run goes (`useClientChecks`), and the AML box re-reads it when a
  run starts or finishes; the send window says it is reading Companies House
  and holds its ticks and Send until the run finishes, then makes the list
  afresh. The server (`createClientCheck`) waits up to 20 seconds for a run
  going, then refuses (`CHECKS_RUNNING`), and refuses a list made before
  the latest run (`basedOn`, `listMadeBeforeChecks`: `CHECKS_UPDATED`); the
  window then re-reads and asks for the list to be checked again. A request
  already sent is not changed: People to check shows each owner still to
  check, with Send them a link.
- **The nightly fix**: the nightly Companies House refresh (`runBatchReKyc`
  → `performAutoKyc`, 120 companies a night) wrote a `kyc_investigations` row
  with `sanctions_match = false` without screening anyone, so within 30 days
  it hid an earlier sanctions match from the red flags and the CDD form, which
  read the latest row. It writes null now, and those readers take the latest
  row that screened anyone (`SCREENED_INVESTIGATION_SQL`: `sanctions_match`
  true, or `result.sanctionsScreening` an array). Earlier rows were not
  changed: the condition reads them correctly.
- Not run from a build machine against Companies House, Perplexity or
  ComplyAdvantage (no keys here): the first real run is the first deal card a
  BGP person opens after the deploy. Not built: a register extract PDF of the
  Companies House record itself, sanctions screening of officers' other
  appointments, a check that a listed market abroad is equivalent, and reading
  trusts, partnerships or charities as anything but a company.

## ComplyAdvantage Mesh (Woody, 2026-11-18)

Woody: "need to get the API for comply back up and running". The client
(`server/comply-advantage.ts`, tests `server/comply-advantage.test.ts`, in
`npm test`) had never screened anyone: it posted to `/v2/searches`, an older
ComplyAdvantage address Mesh does not have (it answered 405), and signed in
with the username and password whose failures locked the account. Rebuilt
from Mesh's own documentation (docs.mesh.complyadvantage.com, read
18 November 2026):

- **Sign-in**: API credentials, `COMPLY_ADVANTAGE_ACCESS_KEY` and
  `COMPLY_ADVANTAGE_SECRET` (made in Mesh: Settings > Access Management > API
  Credentials), exchanged at `POST /v3/token`, Mesh's recommended way. The
  token lasts a day with no refresh; a new one is taken an hour early. The
  older `COMPLY_ADVANTAGE_USERNAME` / `PASSWORD` / `REALM` (`POST /v2/token`)
  is used only when no API credentials are set. A refused sign-in (400, 401,
  403 or 429) pauses every sign-in with those keys: 15 minutes, an hour for
  the older login's 429 lockout, 5 minutes for API keys' 429 (Mesh's ordinary
  rate limit). New keys start afresh at once.
- **Screening**: `POST /v2/workflows/sync/create-and-screen?last_sync_step=ALERTING`.
  A person goes as `person.last_name` with `first_name` and `middle_name`
  (`meshNameParts`: the register's "DOE, Jane", else the last word as the
  surname; a leading Mr or Mrs dropped), never with `full_name` beside them
  (see "Who is screened" below), a company as `company.legal_name`, a subject
  of unknown kind as Mesh's `undefined.name` (`subjectKind`: the caller's
  kind, else a corporate word, else a person's role). Ongoing monitoring is
  off (`monitoring.entity_screening.enabled: false`): the app screens again
  when it needs to. `COMPLY_ADVANTAGE_SCREENING_CONFIG_ID` names the screening
  configuration (optional; without it Mesh chooses).
- **One Mesh customer per name per London day** (`meshExternalId`:
  `bgp-<p|c|u>-<hash of kind, name, year of birth>-<yyyymmdd>`), never a CRM
  id. The same name the same day answers 409 or the first screen's result;
  a 409 reads the workflow its body names (`GET /v2/workflows/:id`), else the
  name is screened under a fresh record. **Every screen is a customer record
  and a search on BGP's Mesh contract, and every hit opens a case in Mesh**
  for someone to close there; nothing in the app closes it.
- **The answer**: `step_details["customer-screening"].step_output`:
  `NO_PROFILES` is clear, `HAS_PROFILES` a possible match with Mesh's
  `aml_types` read as sanctions, pep, adverse_media, warning or
  fitness_probity (`amlKind`). A hit's matched profiles are read from its
  alerts (`GET /v2/alerts/:id/risks`, up to two alerts): one match per kind
  per profile, with the matched name, the list or source name, and the score
  (Mesh does not document its scale; since 19 November 2026 a score of 1 to
  100 is read as a percentage, as Mesh's screens show it, a fraction as it
  is, anything else is dropped), and whether the profile's birth year agrees
  with the person's (`birthYearAgrees`). A person's profile whose every
  date of birth is more than a year from the subject's is set aside
  (`setAside`), the free lists' rule; all set aside is clear. A screen Mesh
  skipped (risk rated prohibited) or did not finish is an error, never
  clear; profiles that cannot be read fall back to the `aml_types`.
- **Calls**: four screens at a time; a refused token is replaced once, a 429
  waited out twice (Retry-After), a server error retried once. A 403 (the
  login lacks "Create and screen customers"), 404 or 405 stops the batch and
  pauses screening for 10 minutes. `screenNames` never throws: a screen that
  did not run is an `error` line with `errorKind`.
- **Connection check** (reads only, creates nothing in Mesh):
  `checkComplyAdvantage`, behind `GET /api/admin/comply-advantage/check`
  (admins) and the ComplyAdvantage card of **Test Apollo / Xero / CH /
  ComplyAdvantage / SRA** on Subscriptions & APIs (`/subscriptions`, Admin; the
  ping always ran it, the page now shows it): signs in and lists the
  screening configurations (Mesh's `/v2` list, and its `/v3` list for
  accounts on its newer pipeline when the first is empty), and says whether
  the one named on Railway is among them, with what each screens and how
  closely (`describeMeshConfiguration`: per collection its risks and its
  match threshold or fuzziness, shown 0 to 100 as Mesh's screens show them,
  its filters and options, and the results limit). On live on 18 November
  2026 the API keys signed in and `/v2` listed no configuration; later that
  day Woody made **"chat bgp"** (`01a1f01a-caf3-715d-aedc-e55000f6e363`, the
  only one, so Mesh uses it with nothing named on Railway): a match-threshold
  configuration, one collection ("Chat") holding every risk (sanctions,
  political exposure, terrorist financing from media and more) at **50**
  ("Medium" on Mesh's slider; 25 is "Broad"), all three filters off (no year
  of birth, year of birth sensitivity, country mismatch). Mesh's screen
  offers one threshold per collection and he could only move the slider
  (Woody, 2026-11-18: "All I can do is move the slider that's it"), so it
  stays at 50, ComplyAdvantage's starting point for sanctions (60 for PEPs and
  90 for everything else, from their "Recommended Match Threshold Starting
  Points"; never below 40); more media hits to close in Mesh is the price.
  Keep the three filters off while the app sends names only: Mesh's score
  rises sharply with year of birth and country (their example: a common name
  34 alone, 67 with a country, 95 with a year of birth), so a name-only
  screen of a common name can score under 50; the free UK and US sanctions
  lists in the checks before asking still catch exact names. Since 19
  November 2026 the app sends a person's birth month and year and a UK
  nationality, and applies the bars to red flags itself (next section). Not
  built: separate collections through Mesh's API. The old
  `/api/comply-advantage/probe`, which posted test searches to seven
  addresses for any login, is gone.
- Callers: BGP's checks before asking (`server/kyc-prechecks.ts`, live while
  in-app AML is off), and with in-app AML on, the KYC orchestrator, KYC
  Clouseau and the weekly re-screen job. Not run against Mesh from a build
  machine (no keys here): the first real answer comes once API credentials
  are on Railway. Not built: closing Mesh cases from the app, Mesh's
  webhooks, passing a date of birth or country to Mesh (a partial date may
  be refused; the year is used to set profiles aside instead).

## The company that signs and who to ask (Woody, 2026-11-18) — docs/deal-page-review-2026-11-18.md

Woody, on the deal page: "most importantly adding the billing entities so can
AML. Also when doing that if the AML hasnt started need the ability to add in
all the info so it can start such as email phone numbers etc". He answered
"go" to step 1 of the review, which included its new columns (decision 1).
Rules: `shared/deal-parties.ts`; reads and writes: `server/deal-parties.ts`;
screens: `client/src/components/deal-parties.tsx`. Tests:
`server/deal-parties.test.ts` (in `npm test`),
`qa/regression/deal-parties-guards.test.mjs`.

- **The company that signs** for a party is a `crm_trading_entities` row
  filed under the party's brand, stored on the deal as
  `<role>_trading_entity_id` (landlord, tenant, vendor, purchaser; boot
  MIGRATIONS, nullable). It is NOT `<role>_entity_id`, the Xero billing
  contact made from it. A deal with none set (every deal before 18 November
  2026) reads the brand as before. Every deal save goes through
  `checkPartyCompanies` (`createDeal` and `updateDeal` in
  `server/letting-service.ts`): a company sent for a party that is not filed
  under it is refused (400, `PartyCompanyRefusal`), and one the deal carried
  that no longer sits under its party (the party changed) is cleared. A
  client login neither reads nor writes the four fields
  (`CLIENT_HIDDEN_DEAL_AML`); a joint agent is sent neither them nor the Xero
  billing contacts (`JOINT_AGENT_HIDDEN_DEAL_FIELDS`).
- **The person to ask** is `<role>_contact_id`, a contact filed under the
  brand; with none set, the deal's client contact when that person is filed
  under the brand. A person typed (the party box's Add someone, or Someone
  else in Send client checks) is saved to the CRM under the brand by
  `findOrAddPartyPerson`: someone already there with that email is used and
  gains blank fields only; a new contact carries a note saying why it was
  added. Someone else in the client checks also becomes the party's person
  when the deal names nobody.
- **What is missing** (`partyGaps`): a company party with no company that
  signs set needs it, whatever the brand holds (since 19 November 2026; until
  then a brand with a Companies House number counted, see "The AML box"
  below); every party needs a person to ask, with an email. An individual's
  date of birth and address are the client checks' to gather, not asked here.
- **Routes** (BGP staff signed in as themselves; `/api/deals/` is on no client
  gateway list): `GET /api/deals/:id/parties` (each party's brand, the company
  set, what to offer, the brand's companies, the Xero contact, the person,
  the brand's people, the gaps), `PUT /api/deals/:id/parties/:role`
  (`companyId`, `personId`, `xero`: set, or clear with null),
  `POST /api/deals/:id/parties/:role/person`. Each change is a
  `deal_audit_log` line. The offer when none is set: the company on the
  unit's lease (the schedule row's `tenant_entity_id`, for the tenant, only
  when filed under it), else the brand's one main company, else its only one.
- **The AML records say which company they are about**: `trading_entity_id`
  on `kyc_investigations`, `kyc_documents` and `kyc_upload_tokens` (the audit
  log's `entity_kind` / `entity_id` already existed). BGP's checks before
  asking run on the company that signs when the deal names one (keyed by
  brand and company; read by its own Companies House number; its accounts
  from its own filing history through `pickLatestAccountsFiling`; the
  brand-page lookup, which writes the brand's number, never runs for it).
  The red flags read that company's screening. The client checks name it as
  the party and file the client's uploads on it. KYC4U's request names it as
  the party, adds "Contracting company" (and, for a counterparty, the person
  to ask) to the note, and lists its documents and the brand's general ones,
  never another company's. The brand's own screens read only the brand's rows
  (`trading_entity_id IS NULL`: the CDD form, the orchestrator's PSC read, the
  brand page's Experian read).
- **Screens**: the deal page's Parties card, under each party, has Signs as,
  Billed to and Ask, and what is still needed; Fill in or Change opens the
  party box (the company: a suggestion, Use, Find it at Companies House; Bill
  to it in Xero; since 20 November 2026 Who the AML checks need, the owners
  with their contact details, see "People to check" below; Who to ask: pick,
  or Add someone). The KYC card and the Kick
  off AML step show "Before the checks can start" per party
  (`PartyReadyToStart`). The deal form's billing entity boxes set the company
  that signs when a company filed under the party is picked or created
  (`XeroContactPicker`'s `onChange(contact, company)`); changing a party
  clears it.
- Not run against Companies House or Xero from a build machine; checked in a
  browser against a local copy on 18 November 2026. Approval, BGP sign-off and
  KYC4U's result are step 2, the next section.

## Approval on the company that signs, BGP sign-off, KYC4U results (Woody, 2026-11-18)

Woody, asked whether KYC4U's documents are fetched and filed from their site
(they were not; statuses came only through the bookmark), answered "Ok go
ahead with your suggestions I will do the requests": step 2 of
`docs/deal-page-review-2026-11-18.md`. Do not re-litigate. Rules (pure):
`shared/party-kyc.ts`; sign-off and KYC4U's result: `server/deal-party-aml.ts`;
screens: `client/src/components/deal-party-aml.tsx`. Tests:
`server/party-kyc.test.ts` (in `npm test`),
`qa/regression/deal-party-aml-guards.test.mjs`.

- **A party is approved on the company that signs** when the deal names one
  (`partyKycState`, read by `loadPartyKyc` in `server/deal-gates.ts`): that
  company's own record in `crm_entity_kyc` (the per-company KYC table of
  Delivery 5), else, while it has none, the brand's state only when it is the
  brand's own legal company (`sameLegalCompany`: the same Companies House
  number, or the company's name is the brand's `uk_entity_name` or Companies
  House name), else "no checks run". A company counts only when filed under
  the party's brand. A brand the MLRO rejected blocks whatever company is
  named. With no company that signs the party is the brand, as before. Every
  caller of `checkCounterpartyAml` passes the deal's id or the companies in
  the save (`signingCompanies`); `recomputeDealKycApproved` and
  `recomputeDealsForTradingEntity` re-derive `kyc_approved`. The deal's AML
  status reply (`GET /api/kyc/deal/:id/status`) reads the same state, and for
  BGP staff sends `kycName`, `kycSource`, `brandKycStatus`, `signsAs` and
  `decisions` (who may decide; per party whether BGP may sign it off now).
  `crm_deal_entities` stays a shadow table nothing writes and the gate never
  reads (`server/aml-shadow-gate.ts`).
- **BGP's sign-off** (`POST /api/deals/:id/parties/:role/sign-off { note }`)
  and **KYC4U's result** (`POST …/kyc4u-result`, multipart) are the MLRO's:
  the nominated officer once one is appointed in AML settings, admins until
  then (`amlActor`), BGP staff signed in as themselves; the result's route
  checks that before multer reads a file. Sign-off is refused
  (`signOffDenial`, in this order) for a rejected party, one already approved
  and in date, records the red flag read could not reach, a request raised
  with KYC4U on this deal and not yet answered (`kyc4u_drafts`, 180 days),
  the party's or the deal's red flags, a higher-risk file (`isHigherRisk`),
  checks before asking still running, not run, or more than 30 days old, and,
  while the client checks are unfinished, a note under 10 characters. It
  writes the company that signs through `approveEntityKyc` (re-check reminder
  listed under the brand, an earlier open one for that company completed),
  else the brand's `kyc_*` columns, reminder and KYC audit line, then a
  `deal_audit_log` line (`aml_sign_off`) and the recompute.
- **KYC4U's result** is Approved, Rejected or More information needed
  (`KYC4U_RESULTS`), a date (not in the future; dated today it is timed as
  recorded), a reference, a note and up to 10 files of 25MB. An approval needs
  a file (KYC4U's report or email); anything else a file or a note of 10
  characters. Files go to `kyc_documents` on the party (the company that signs
  when set; type `kyc4u_report` unless the name says otherwise). The result is
  a `kyc4u_requests` row (list `manual`) applied by the mirror, so a later
  KYC4U request for the party replaces it as before; the reply says when it
  did not take effect. **A result about a company that is not the brand's own
  legal company has no `company_id`** (`company_id_manual` is the brand), so
  the mirror's brand pass never applies it to the brand.
- **The mirror's company pass** (`mirrorKyc4uCompanyStatuses`, inside
  `mirrorKyc4uStatuses`): rows with `kyc4u_requests.trading_entity_id` (boot
  migration) set the company's own record, approved, rejected or in review
  (a still-valid approval kept), idempotent on `evidence.kyc4uKey`. Both
  passes take the latest row by date, then the latest recorded. **Synced
  rows** are matched to a company under the matched brand only on a single
  fit by Companies House number or full name (`pickTradingEntity`) and still
  count for the brand as they always did: unlike a result added by hand, a
  synced approval of one of a brand's companies also approves the brand (the
  matcher's long-standing behaviour, kept so no deal changes).
- **Screens**: on the AML card (both layouts) and in Kick off AML, the MLRO
  or an admin gets **Sign off** (hidden once approved, greyed with the reason
  when refused) and **Add KYC4U result** under each party (`PartyDecisions`).
  The card says "Checks on <company>, the company that signs", says when a
  different company has no checks though the brand is approved, and hides
  "Before the checks can start" once a party is approved.
- **Connect KYC4U is back** (Subscriptions & APIs → KYC4U since 21 November
  2026, on My BGP before; admins, "Automatic sync"):
  Connect, Sync now, Disconnect and **Copy the approval link for KYC4U's IT
  admin** (`GET /api/kyc4u/admin-consent-link`: Microsoft's v2.0 admin
  consent for `Sites.Read.All`, `User.Read` and `offline_access` only, never
  `.default`, which would ask for the app's mail permissions in KYC4U's
  tenant; it returns to `PUBLIC_APP_URL`/api/kyc4u/callback). Connect fails
  with "Need admin approval" until KYC4U's admin approves (why it was removed
  on 6 October 2026). Woody is sending the link.
- **KYC4U's documents** (`copyKyc4uDocuments`, at the end of each sync):
  request folders (`REQ… <entity>`) at a library's root or one folder down,
  matched to a brand (and the company that signs) by the same matchers; each
  file copied into the store as `kyc4u-doc-<hash of drive and item>-<name>`
  and filed in `kyc_documents` once (type from its name, else its section
  folder), on the deal its request was raised from when a draft names the
  REQ number. At most 200 files a sync, none over 25MB; unmatched folders are
  counted, not copied. Read only on KYC4U's side. Not run against KYC4U from
  a build machine (it cannot be until their admin approves): tried locally
  against a fake site on 18 November 2026.
- Not built: the MLRO clearing a rejection from the deal (the old company
  reject and approve routes are retired with in-app AML). The AML dashboard
  (step 6) is the next section.

## The AML dashboard (Woody, 2026-11-18)

Woody: "a dashboard of all AML / KYC live and finished checks ... nice and
easy"; step 6 of `docs/deal-page-review-2026-11-18.md`, brought forward with
"go ahead with your suggestions", in the place the review proposed (decision
5: a pill on Deals). Rules (pure): `shared/aml-dashboard.ts`; feed:
`server/aml-dashboard.ts`; page: `client/src/pages/aml-dashboard.tsx`, the
**AML** pill on the Deals hub (`/deals/aml`, `deals-hub.tsx`). Tests:
`server/aml-dashboard.test.ts` (in `npm test`),
`qa/regression/aml-dashboard-guards.test.mjs`.

- **Who**: BGP staff signed in as themselves (`staffMe`, `contactViewer`) on
  `GET /api/aml-dashboard` and `GET /api/aml-dashboard/party`. The address is
  on no client gateway list and outside the retired-AML switch (which matches
  `/api/aml/` only). The pill is never offered or mounted for a client login,
  and `/deals/aml` sends one to the deal list. It reads; it writes nothing.
- **Rows**: one per party (landlord, tenant, vendor, purchaser) of every deal
  not withdrawn or archived, completed or invoiced ones changed in the last
  90 days included (`AML_DASHBOARD_CLOSED_DAYS`), an investment deal only from
  Solicitors (`dealLeftTrackerSql`), at most 2,000 deals. Each party is read
  the deal card's way and in one batch for every deal: its state through
  `loadPartyKyc` (the company that signs when the deal names one), its red
  flags by `partyRedFlags` and `dealRedFlags` on the same records the card
  reads (a deal record's flag is listed on each of its parties as "Deal:
  …"). A record that could not be read is listed (`unchecked`), never read
  as no red flags.
- **One stage rule** (`amlStage`): a decision first (rejected; approved,
  Expiring within `AML_EXPIRING_DAYS` (30) of its re-check date, Expired past
  it), then with KYC4U (a request raised on this deal and not answered, or the
  party in review AND KYC4U's own latest status for it, on the company that
  signs or the brand, still reading as with them: `kyc4uInReview`), client
  finished, client checks sent (a request not cancelled), BGP checked (checks
  before asking in the last 30 days), else not started. A bare `in_review`
  is not with KYC4U: on live on 18 November 2026, 552 of the 615 parties
  first shown as With KYC4U had no KYC4U request at all (169 of them
  Landsec's, 65 Hammerson's), their status left by the in-app AML retired in
  October. **HMRC's timing** (`amlDue`, from `KYC_TIMING`): a landlord or
  seller on any live deal, a tenant or buyer from Heads of Terms. **Pills**
  (`amlBucket`): To do (due, not started or only BGP checked), In progress
  (client sent or finished, with KYC4U), Done (approved or rejected), Expiring
  (expiring or expired), Not due yet, and **Closed, not checked**
  (`amlDealClosed`: a completed or invoiced deal whose party was never
  approved or rejected; a party approved at the time stays Done). Closed
  deals were 271 of the 769 parties To do on live on 18 November 2026: a past
  gap for the MLRO, not work on the To do list. **All**, first beside To do
  (Woody, 25 November 2026: "on the to do tab can you put all next to it so
  can search for all"; `?view=all`), lists every transaction whatever its
  state, so a search covers them all; the page still opens on To do, and the
  who pair on the right reads **Everyone** / **Mine**. **Waiting on** (`amlWaitingOn`) and the
  days since anything moved (`daysSince`: the checks, the requests, KYC4U
  drafts, the approval). Mine = the deal's `internal_agent_ids` or names.
- **The page**: the pills with counts, All / Mine, a search (`rowMatches`), a
  table on a computer (its rows scroll inside `ScrollableTable` with a scroll
  bar above and below and the heading row fixed: Woody, 2026-11-20, "can you
  put a scroll bar at the top and fix the heading as scroll down") and cards
  on a phone; the title sits beside the section pills, the policy has its own
  **Policy** pill (since 22 November 2026: the officers, the in-house switch,
  the documents and how the app applies it, on the page), and the
  top folds to the title and pills once the table is scrolled, so the table
  gets the room (Woody, 2026-11-22: "the top of the pages shrink and the table
  is larger when start scrolling but keep the main headings"; the Investment
  Tracker's pattern, desktop only); a row opens the party's trail:
  the deal's own AML card (every button: checks before asking, client checks,
  KYC4U request, Sign off, Add KYC4U result), the documents on the party's
  KYC record and its history (the KYC audit log and the deal's AML lines).
  **The table's columns** (Woody, 23 November 2026: "on this page can we
  have the deal status i.e reporting, marketing, solicitors, completed etc",
  "combined due diligence and red flags same as stage to sit under each",
  "dont let the agents responsible leak off the page they should be
  listed"): Party, Transaction (the property under it), **Transaction
  status** (`amlDealStatusWords`: the status in the Transactions board's
  words and colours, `dealStatusLabel` with the row's `dealType`, so a
  letting's AVA reads Marketing; the search matches it), **AML stage** (Late
  stacked under it), **Due diligence and red flags** (the level with the red
  flags stacked under it, a long flag wrapping in its column), Waiting on,
  Last moved and **Agents** (every agent, one to a line, never cut off; below
  1536px the Party, Transaction and Waiting on columns narrow so the whole
  table fits from a 1440px screen, measured on live data). The
  phone card shows the status beside the transaction.
  The view is kept in the address (`?view=`, `?who=mine`), replaced, so a pill
  is never a Back step. The KYC4U grid is in Subscriptions & APIs → KYC4U.
- **One line per transaction** (Woody, 24 November 2026: "on Transactions
  lets combine the 2 (normally) AML checks into just one transaction board
  or line we can see the individuals in companies. That way doesnt get too
  crowded"; do not re-litigate). The feed still sends a row per party; the
  page groups them with `groupAmlByTransaction` (`shared/aml-dashboard.ts`,
  tested in `server/aml-dashboard.test.ts`): parties in the order landlord,
  tenant, vendor, purchaser. **The pills pick transactions**
  (`transactionBuckets`): To do, In progress, Expiring and Closed, not
  checked when any party is on them (a transaction can be on more than
  one); Not due yet when nothing else is outstanding and a party is not
  due; Done only when every party is done. The counts are transactions
  (`transactionBucketCounts`); Late, Mine and the search pick a
  transaction through any party (`transactionMatches`). The table is one
  `tbody` per transaction (`TransactionRows`): Transaction, Transaction
  status and Agents once (`rowSpan`), then a line per party (Party, AML
  stage, Due diligence and red flags, Waiting on, Last moved). A party's
  line opens that party's trail; the transaction's own cells open the party
  on the pill shown (`leadParty`). Cards and the phone: one card per
  transaction (`AmlTransactionCard`), a line per party (`PartyLine`, the
  shared chips). Order: a late party first, then the most red flags, then
  the longest unmoved. The property page's AML on transactions here groups
  with the same rule.
- **A to Z down the right** (Woody, 25 November 2026: "on the right side can
  you put letters alphabetic so can click and search companies and also
  transactions which should lead with the building or brand depending on if we
  are acting on the building or then acting on the brand"). Transactions and
  Companies each have a letter rail (`LetterRail`, `WithLetterRail` in
  `client/src/components/letter-rail.tsx`; rules `shared/letter-index.ts`: a
  name's first letter, accents aside, a number or no letter under #). A letter
  shows only the names under it, A to Z; pressing it again or All shows them
  all; a letter with nothing under it on the pill is greyed; the pills' counts
  follow the letter. On a computer the rail sits in the page's right margin, so
  the table keeps its width (the Agents column must not run off a 1440px
  screen); on a phone, beside the cards. **A transaction is known by its
  building, or by the brand when BGP acts for the tenant** (`transactionLead`
  in `shared/aml-dashboard.ts`, from `clientRole` on each board row,
  `dealClientRole`; a sale and a purchase lead with the building). Under it:
  for a building, the rest of the transaction's name (`nameWithout`: the unit,
  the tenant), else the other party; for a brand, the building; then the Ref.
  Tests: `server/letter-index.test.ts`, `server/aml-dashboard.test.ts`,
  `qa/regression/aml-one-build.test.mjs`.
- **Start from the AML page** (Woody, 24 November 2026: "what about my add
  new transaction text box and upload files box etc here?", then "and add new
  company AML etc"). At the top of the Transactions and the Companies views
  (folded away with the top when either table scrolls), `AmlStartBar`
  (`client/src/components/aml-start.tsx`):
  **New transaction**, the Describe the transaction box's look (type the
  transaction out and press Fill it in, or drop or choose its heads of terms),
  opens New Transaction (`NewTransactionDialog` in `client/src/pages/deals.tsx`,
  loaded only when used) with the words read by its Describe the transaction
  box (`initialNote`: `initialText` and `autoRead` on its `NoteFill`) or the
  file read by its Add heads of terms (`initialHotsFile`, read once when the
  lists are in); saving is the form's own Create, then its Kick off AML step,
  and closing it reads the board and the Companies view again. **Add a
  company** opens the Companies view's Add a company (`startAdding` on
  `KycCompaniesView`, read again while the view is open), for KYC with no
  transaction. Nothing is saved from the box itself. A party's own KYC
  documents still go in its Documents step (Upload documents).
- **Transactions and Companies share one top** (Woody, 24 November 2026: "make
  the company page the same format as the transactions page on the top so they
  match up in terms of design and obviously have the new box"): the bar above
  both (`startsHere` in `client/src/pages/aml-dashboard.tsx`), then the view's
  pills on the left and its controls on the right in the same order (Companies:
  Select for admins, Table / Cards, the search; Transactions: All, Mine, Late,
  Table / Cards, the search), both searches the same width. The Companies view
  has no Add a company button of its own. Changing view opens a folded top
  again.
- Checked in a browser against a local copy on 18 November 2026 (desktop and
  an iPhone profile). Not built: the stage on the deal page's own card (it
  shows the state, not this chain), and a count of To do on the side bar.

## The AML box: the company, red flags in detail, set aside (Woody, 2026-11-19)

Woody, on deal #4213 (T4 at Brent Cross, Hammerson the landlord), both parties
red-flagged for KYC4U: "we havent got the actual company info? We must have
the company taking the lease or who owns the property to be able to do a
check. in this box we need to see the company info. We also need to see the
detail of the redflag and have the option to ignore with a comment as comply
advantage is picking up things that are not really a massive problem. Also
API a problem on companies house?", then "On the deals page the landlord and
tenant have numbers but its not clear if there is a billing company? The
brand is different normally to the billing or contracting entity which is
critical for the AML", and "clean up the design". Do not re-litigate.
Guards: `qa/regression/aml-box-company-and-flags.test.mjs`; unit tests in
`server/kyc-red-flags.test.ts`, `server/kyc-prechecks.test.ts`,
`server/companies-house-gate.test.ts` and `server/deal-parties.test.ts`.

- **No check without the company that signs.** A company party's checks
  before asking, client checks and KYC4U request wait until the deal names
  the company taking the lease (tenant), the one that owns the property
  (landlord), selling or buying (`SIGNING_COMPANY_WORDS` in
  `shared/deal-parties.ts`). The brand's own Companies House record never
  stands in for it (it did until this day: Hammerson's checks ran on
  HAMMERSON PLC, T4's on T4 UK FRANCHISE LTD). `dealPrechecks` gives such a
  party the state `needs_company` and starts nothing; Run again answers
  `needs_company`; `createClientCheck` and `kyc4uPrefill` refuse with 409;
  `loadDealRedFlags` and the AML dashboard read no brand-level check's
  findings for it (the brand's KYC record flags still show). An individual
  needs no company. The brand's own registered company is offered as one
  choice (`brandOwn` on the party view, when no company filed under the
  brand carries its number), saved under the brand from Companies House with
  no Xero contact (`xero: false` on `POST /api/billing-entities`; "Bill to …
  in Xero" makes one), alongside the company on the lease, the brand's main
  company and Find it at Companies House.
- **The Parties card** (`DealPartiesCard` in `deal-detail.tsx`,
  `DealPartyLines` in `deal-parties.tsx`): BGP acts for, then one box per
  party: the brand picker, then **Company that signs**, **Billed to (Xero)**
  and **Who to ask** as labelled rows, a missing one in amber with Use it for
  a suggestion. The deal-level Xero contact shows only when one is held. The
  Overview's dates and terms are one card in the page's type scale, labels in
  sentence case ("Last contact", not "Last Interaction").
- **Company checked** (`PartyCompanyFacts` in `deal-aml-status.tsx`, from
  `precheckCompany` in `shared/kyc-prechecks.ts`): the company the checks
  were about, as the register gives it: name and number with the register
  link, type, status, incorporation, registered office, business (common SIC
  codes in words), listed and what it means (reg 28(5), simplified due
  diligence under reg 37), directors, owners, the chain above it, latest
  accounts and the documents on the KYC record.
- **Companies House's limit.** It allows a key 600 requests in five minutes
  and answered 429 to the first call of both checks: one check makes about 50
  calls and nothing paced them. Every `chFetch` now waits its turn in one
  queue (`server/companies-house-gate.ts`): a burst of 60 then 1.8 a second,
  Companies House's own count (`X-Ratelimit-Remain` / `-Reset`, which counts
  every process on the key) with 25 kept in reserve, and a hold after a 429
  until the window ends, then one more try. A caller waits up to 30 seconds
  for a turn, then gets "BGP's allowance of 600 requests in five minutes is
  used up; try again in about N minutes"; the checks before asking read the
  register inside `withChPatience` (five minutes), and their document
  downloads wait in the same queue. A check that could not read Companies
  House for a passing reason (`precheckUnfinished`: a 429, a 5xx, a time-out;
  a 404 is an answer) is not finished: the box says so, and the next view
  runs it again after `PRECHECK_RETRY_MINUTES` (10), at most
  `PRECHECK_AUTO_RUNS_A_DAY` (4) runs a day for one party.
- **Each flag has a key and its evidence** (`KycRedFlag.key`, `evidence`,
  `facts`): what it is about, the same from one run to the next (the subject
  and the kind of finding: `ca:<name>`, `web:adverse_media:<name>`,
  `record:high_risk`, `deal:edd` …), and what is behind it (a list entry, a
  web address, a ComplyAdvantage profile, a status). **Detail** shows the
  facts: the ComplyAdvantage profiles matched with their source and match
  score and any article (kept on a check since this day; an older check says
  it kept only the kinds), the web page, the register entry, or for a flag
  read from the brand's KYC record its history lines (who wrote it, when:
  T4's three were the retired in-app screening's of 23 and 24 September).
  **A flag the old in-app screening set by itself** (Woody, 23 November 2026,
  on Inception T2: "this has picked up a red flag but its not clear why?"):
  the brand's KYC record says a screening matched, or enhanced due diligence
  is needed, and its history line was written by the automatic screening
  before 1 November 2026 (`oldAutomaticScreening` in `shared/kyc-red-flags.ts`).
  That screening was switched off in October and did not record which name
  or list matched, so the flag says so in its detail, with what BGP's own
  checks found since (their sanctions result), names its source "The old
  in-app screening", and offers the officer the words to set it aside
  (`suggestion`, filled into the set-aside box). **Superseded on 24 November
  2026** (Woody, on Beltane Asset Management: "these red flags are still
  coming is it historic stuff or comply advantage still not working
  properly? can we fix!!?"): such a flag (the old screening's PEP status, its
  automatic enhanced due diligence, and a "Possible match on the UK Sanctions
  List" from a screening dated before 1 November 2026) is set aside by the
  app (`supersededBy`, `oldScreeningCleared` in `shared/kyc-red-flags.ts`)
  once BGP's own latest check of that party read the sanctions lists, matched
  no one, and raised no sanctions, ComplyAdvantage or public role red flag.
  `applyFlagReviews` lists it under set aside with "Set aside by BGP's checks
  before asking" and the reason (review id 0: no Put back; a new match brings
  it back), so the box, the board, the sign-off and the AML file all read the
  same. A party with no check of its own (a company party with no company
  that signs) keeps the flags. The record history behind a flag
  (`loadRecordHistory`) leaves out set-aside and put-back lines: Woody's four
  presses on Beltane had pushed out the line that explains the flag.
  **Every mark the old screening wrote, said plainly** (Woody, the same day,
  on Coq d'Argent #3492: "what do we do here? not cleare why its been
  flagged and by what and how to get the right info what we need etc?"). The
  retired screening (`server/kyc-orchestrator.ts`, `evaluateAutoEdd` in
  `server/aml-ai.ts`) wrote, in September and October 2026: enhanced due
  diligence with a reason and an `edd_triggered` line by "automatic" (on live
  on 24 November: an ownership chain three to five companies deep, an AI
  web search's "adverse media", a sanctions match, a risk score, a
  high-risk country up the chain, a value over £1m; 59 parties); the PEP
  status `review_required` (only it ever wrote that: a loose name match on a
  sanctions or PEP list; 44); a risk rating from Clouseau's score (11); and
  sanctions matches (84). `oldScreeningMarks` recognises each (a field whose
  latest history line is by a person, such as the MLRO form's `risk=` or
  `edd=`, is theirs and stays as it was), and `oldEddWhy` words each reason
  ("the ownership chain is 3 companies deep. Depth on its own is not a risk
  factor in BGP's AML policy ..."). The flag's label ends "(old screening)",
  its detail says when, why and what BGP's checks found since, and it
  carries `oldScreening`. The AML box lists such flags apart, in amber,
  headed "A flag from the old screening, switched off in October", with what
  to do from where BGP's checks stand (`oldFlagStep`: set the company that
  signs; checks running; run them; or "did not clear them"), and the
  Screening step reads "1 flag from the old screening · checked once the
  company that signs is set". They still count (the party stays enhanced)
  until BGP's checks clear them. **They clear only when BGP's latest checks
  are the party's latest screening, read the sanctions lists with no match,
  were not cut short (`precheckUnfinished`) and raised no red flag of their
  own** (`oldScreeningCleared`, stricter than the first rule of the day).
  The AML board now reads the same history (`loadRecordHistory` was a
  200-line limit across all companies, so most board rows had none; it is six
  lines per company, with each line's `action`). The sign-off with no company
  that signs says "Set the company that signs first (step 1)" (`needsCompany`
  on `SignOffFacts`), not "Press Run again". Tests:
  `server/kyc-prechecks.test.ts`, `server/kyc-red-flags.test.ts`,
  `server/party-kyc.test.ts`.
  **Superseded later the same day: only a sign-off counts** (Woody: "Yes
  build Only sign off counts remove the old bit / The result are in the
  app"; see the section of that name). The old screening's marks are no red
  flags at all: the "(old screening)" label, the amber box, the clearing
  rule and the set-aside words (`oldAutomaticScreening`, `supersededBy`,
  `oldScreeningCleared`, `oldEddWhy`, `oldFlagStep`, the flag's
  `suggestion`) are gone. `oldScreeningMarks`, the six history lines per
  company and the sign-off's "Set the company that signs first (step 1)"
  stay.
- **Set aside with a comment** (the MLRO's, as the sign-off is: `decider` in
  `server/deal-party-aml.ts`; admins until an MLRO is appointed).
  `POST /api/deals/:id/red-flags/set-aside { role?, key, comment }` reads the
  flags again and acts only on one the party has now, with the app's own
  words (`setFlagAside`); `POST …/put-back { reviewId }` only for the deal's
  own parties or record. Stored in `kyc_flag_reviews` (boot migration in
  `server/index.ts`: company, company that signs, deal, the flag's key,
  label, source and evidence, the comment, who and when, and who put it
  back), with a `kyc_audit_log` line (`red_flag_set_aside`,
  `red_flag_put_back`) and an `aml_red_flag` line on the deal's history. A
  review covers a flag with the same key whose evidence it saw
  (`applyFlagReviews`): new evidence raises it again. A flag from the brand's
  KYC record is set aside for the brand whoever signs; any other for the
  company that signs at the time. A set-aside flag counts nowhere (the deal
  card, KYC4U's note, Kick off AML, the sign-off, the AML dashboard), and a
  set-aside record field (risk, enhanced due diligence, PEP status) no longer
  makes the file higher risk for the sign-off. The comment needs at least 10
  characters (`FLAG_REVIEW_COMMENT_MIN`).
- **The plc question** (Woody, the same day: "are you sure we need to AML a
  PLC company?"): yes, but lightly. A company listed on a regulated market
  (Hammerson plc is on the London Stock Exchange's main market) is
  identified and verified from the register, with no beneficial owners or
  board to identify (MLR 2017 reg 28(5)), and simplified due diligence may
  apply (reg 37). Sanctions screening applies to everyone. The landlord on a
  Hammerson lease is usually a subsidiary or a joint-venture vehicle, not the
  plc: a wholly owned subsidiary is treated as listed through its chain
  (KYC4U to confirm), a joint venture is not.
- Not built, waiting on Woody: media hits on a listed company shown as
  information rather than red flags; anyone but the MLRO setting a flag
  aside. Not run against Companies House or ComplyAdvantage from a build
  machine (no keys here): the queue and the profile detail are first seen on
  live.

## The app drafts why a red flag can be set aside (Woody, 2026-11-24)

Woody, on the Set aside box for adverse media about BERKELEY GROUP PLC(THE):
"can you get the app to review and put a suggestions of why can set aside
these flags in this box?" Do not re-litigate. Rules: `shared/flag-set-aside.ts`;
reader: `server/flag-set-aside.ts`; box: `SetAsideDialog` in
`client/src/components/aml-red-flags.tsx`. Tests: `server/flag-set-aside.test.ts`
(in `npm test`), `qa/regression/flag-set-aside-guards.test.mjs`.

- **When the box opens** it asks `POST /api/deals/:id/red-flags/suggest
  { role?, key }` (or the client file's `.../red-flags/suggest { key }`), the
  officers only (`decider`), and fills the box with the draft unless the
  officer has typed; **Use the app's draft** puts it back. Above the box, the
  app's read: none of these bears on money laundering risk; look closer; or
  this one should stand. **Set aside is still the only save**: the draft is
  never saved by itself.
- **The reader**: the flag is read again on the server by its key (as the
  set-aside does), its findings numbered (`flagFindings`: a web finding's
  words with its source and date, a ComplyAdvantage profile with its
  articles), with what BGP holds on the company (register facts and listing
  from BGP's checks). Anthropic, called directly, one forced-tool call
  (`suggest_set_aside`), capped a day (`FLAG_SET_ASIDE_DAILY_CAP`, default
  100, 0 = off), told what bears on money laundering risk (financial crime,
  sanctions, corruption, tax evasion, charges, a regulator's action for
  financial crime) and what does not (another person of the name, commercial
  disputes, competition or consumer law resolved with no finding of financial
  crime, environmental or planning matters, allegations withdrawn or found
  unfounded), to use only the facts given, and to write plainly in 80 words.
  `checkSetAsideSuggestion` drops findings the flag does not have, takes off
  bullets, cuts a long draft, and turns set_aside into look_closer when the
  reader itself calls a finding relevant.
- **Never drafted** (`setAsideNeedsPerson`, before any call): a possible
  sanctions match (a person compares the list entry; tell the Nominated
  Officer), the client's own public-role answer, a declined identity check,
  the client's dispute of the register's owners, a source of funds mismatch,
  and a mark a person put on the KYC record. The box says what to do instead.
- Not run against Anthropic from a build machine.

## Which screening matches are red flags (Woody, 2026-11-19)

**Warning lists are judged like adverse media since 23 November 2026** (Woody,
on BILLS RESTAURANTS LTD.: "why is it picking up adversea media on buffalow
bills restruants its a waste if time", then "same issue here not the actual
company" on Bill's: "bills" on an Ohio enforcement list and Singapore's
investor alerts at 70%). Only a sanctions match is a red flag whatever its
score (`ALWAYS_FLAG_KIND = /sanction/`); a warning-list match needs the 90% bar
(or an agreeing date of birth), and for a company a warning-list or fitness
and probity profile whose name is not spelt as the company's ("buffalo bill
restaurant", 20%, on Ireland's Revenue Defaulters List) is set aside as a
spelling variant (`providerSpellingVariant`). A person's warning list is never
set aside on spelling. Stored checks are judged again when they are read, so
no re-run is needed. This supersedes "a sanctions or warning-list match
(whatever the score)" below. Test: `server/kyc-prechecks.test.ts` (the Bills
case), `qa/regression/kyc-screening-bars.test.mjs`.

Woody, on deal #4491 (BGP's own two companies, every officer red-flagged):
"why is complyadvantage red flagging everything?". The app sent Mesh a bare
name and turned every hit into a red flag, so common names (Jack Barratt,
Charlotte Roberts, David Bruce) matched namesakes in ComplyAdvantage's PEP
and adverse-media data; the web search added flags for results it marked
"may be someone else", one per source, and worded a company's ownership
question as a "public role". Asked, he chose **"Tighten"**. Do not
re-litigate. Rules: `shared/kyc-prechecks.ts` (`providerMatchFlags`,
`splitProviderMatches`, `precheckNamesakes`, `PROVIDER_FLAG_BARS`); tests
`server/kyc-prechecks.test.ts`, `server/comply-advantage.test.ts` (both in
`npm test`), `qa/regression/kyc-screening-bars.test.mjs`.

- **A ComplyAdvantage match is a red flag** when it is a sanctions or
  warning-list match (whatever the score); when the profile's birth year is
  within a year of the person's; when ComplyAdvantage scores it at least 60%
  for a public role (PEP) or 90% for anything else (adverse media, fitness
  and probity: ComplyAdvantage's own starting points); or when its profiles
  could not be read (`unread`, or an older match with no profile id: nothing
  to judge it by). An older check that kept only the kinds of profile stays
  a flag. **Every other match is a possible namesake to check**: listed on
  the AML card ("Possible namesakes, not red flags: N" since 25 November
  2026, with a green tick, under Show, with the count
  beside the summary) and in KYC4U's note, never a red flag, never in the
  sign-off's red flags or Kick off AML's KYC4U switch. The split is worked
  out when the flags are read, so stored checks change without a re-run.
- **Web results**: one flag per person and kind, with every source inside
  it (evidence is every source's address); a result the search marks "may
  be about someone else of the same name" is a possible namesake, not a
  flag; for a company the public-role question reads "Possibly owned or
  controlled by the state or a public figure" (`webLineIsCompany`: the
  line's `person`, or a corporate word in an older line's name).
- **What goes to Mesh**: a person's birth month and year
  (`date_of_birth: { year, month, day: null }`) and nationality `GB` when
  Companies House records a UK nationality (`meshNationality`; any other is
  left out, never guessed); a company its name alone. Mesh's docs make each
  date part nullable without saying a partial date is accepted, so a 400 or
  422 to a body with them screens the same name again bare, and for the next
  day every screen goes bare (`meshRefusedDetailsRecently`, in memory). Not
  run against Mesh from a build machine: the first screen on live shows
  whether Mesh takes the partial date.
- A flag set aside before this change keeps its review only while its key
  and evidence still match (`applyFlagReviews`); a web flag that now holds
  several sources needs one set-aside covering them.
- **About the person, or only their company** (23 November 2026, St George
  plc: the CMA's housebuilders case, about Berkeley Group, was raised as
  adverse media on a director it never names). The person search answers
  `about` for each finding ("person", or "organisation" when it is about a
  company or group they work for or direct and does not say they were
  involved), stored as `aboutOrganisation`. One about their company only is a
  possible namesake ("about their company or group, not them"), never a red
  flag on them (`webFindingUnsure`, read by the flags, the namesakes and the
  card's count). A run from before then keeps its findings until Run again.
  A rule that a finding must name the person was tried and dropped: genuine
  findings often leave the name out ("Member of the Ruritanian parliament").
- For a person screened with a date of birth, the next section replaces
  these bars.

- **A company's weak sanctions match under another name** (24 November
  2026, Beltane Asset Management: ComplyAdvantage matched "blaydon asset
  management", on its Sanction Related Entities list, at 1%): for a company,
  a sanctions profile whose name is not spelt as the company's (the legal
  form aside, `nameSpeltAsTheirs`) and scored under 50%
  (`COMPANY_SANCTIONS_BAR`, ComplyAdvantage's own starting point) is a
  possible namesake to check (`companySanctionsNamesake`), never a red flag;
  a person's sanctions match stays a red flag however it is spelt, and so
  does one with no score. The run's sanctions result
  (`precheckSanctionsMatch`) reads the same judgement. This supersedes
  "Sanctions ... are never set aside on spelling" for a company's weak
  matches only. The decisions log records it.
  **Another name includes a longer one** (later the same day, Woody: "did
  you get my message about comply advantage and these random red flags?"):
  Bluewater's landlord BLUECO LIMITED was a red flag on "blueco 22 midco" and
  "blueco 22" (Chelsea's owners, Sanction Related, 2%) because "blueco" is in
  both, which `nameSpeltAsTheirs` reads as spelt the same. The weak-match
  test is now `sameCompanyName`: the company's own name, word for word in any
  order, the legal form aside. Anything else under 50% is a namesake. Read on
  stored checks, so no re-run is needed.

## Who is screened, and the date of birth decides (Woody, 2026-11-19)

Woody, the same evening ("AML with jack"): "the company name comes in.. it
checks companies house for the directors and owners which is working. At
that point need to work out who needs to be AML/KYC comply advantage not
picking up DOB which can get from companies house for everyone when running
against #PEP and adverse media currently ashowing red flags for random
people with similar names? whats the fix?" Read on live deal #4491 (BGP's
own two companies, checked at 17:00, after "Tighten"): the red flags were
directors who are not owners (Jack Barratt, Rupert Bentley-Smith, Charlotte
Roberts) and the deal's contact, each on a profile with no date of birth:
"rupert smith" (UK MPs and Lords RCA), "caroline roberts" (a Canadian
historical leadership list), "bruce woody" (a Florida sex offenders list).
ComplyAdvantage's score measures how much of the name matched (70% when
every word of one name is in the other, 20% for a spelling variant), not
whether it is the same person, so the 60% bar flagged every such name. Do
not re-litigate. Rules: `shared/kyc-prechecks.ts` (`chooseScreened`,
`SCREEN_BASIS_WORDS`, `screenedLine`, `providerMatchFlags(m, line)`);
`server/kyc-prechecks.ts` (`runPrecheck`, `screenComplyAdvantage`);
`server/comply-advantage.ts` (`meshNameParts`, `profileDobs`,
`profileDobAgrees`, `meshRefusedDetails`); `server/companies-house.ts` (the
chain walk keeps each owner's date of birth). Tests:
`server/kyc-prechecks.test.ts`, `server/comply-advantage.test.ts` (both in
`npm test`), `qa/regression/kyc-screening-bars.test.mjs`.

- **Who is screened for public roles and adverse media** (ComplyAdvantage
  and the web search; `chooseScreened`): the company (and its trading name)
  and its beneficial owners, the people with significant control of it and
  of each company up its ownership chain (MLR 2017 reg 5). A company listed
  on a regulated market: the company alone (reg 28(5)). No owner who can be
  named: the directors or LLP members stand in (reg 28(6)). A private
  individual: themselves and anyone named alongside them (since 22 November
  2026). Everyone the run lists, directors, the secretary
  and the deal's contact included, is still screened against the UK and US
  sanctions lists. The run stores who was screened (`result.screened`: the
  basis, the people, the sanctions-only names); the AML box shows it
  ("Screened for public roles and adverse media: ...") and KYC4U's note
  carries it.
- **Everyone screened goes with a date of birth**: owners, people up the
  chain (since this day; before, the chain walk dropped it) and directors,
  the month and year Companies House gives. Every person screen carries
  first, middle and last names (`meshNameParts`: the register's "SURNAME,
  Forenames", else the last word; titles dropped), the bare retry too. A
  refusal keeps Mesh's own words (`meshRefusedDetails`), shown by the admin
  connection check (Test ComplyAdvantage on Subscriptions & APIs); still in
  memory, a day, as before.
- **Mesh takes exactly one of `full_name` or `last_name`** (its
  create-and-screen page, read 22 November 2026: "not both, not neither";
  with `full_name`, the first, middle and last names are left out). The
  change of 19 November sent `full_name` AND the parts, so Mesh refused every
  person ("failed semantic checks"), the bare retry too, from then until the
  fix of 22 November (found by Woody's live tests on #4561 and #4562): only
  companies were screened by ComplyAdvantage, while the UK, US and EU
  sanctions lists and the web search still ran for everyone. A person now
  goes by the parts alone. **A screen that did not run is never read as
  clear**: `providerNotScreened` lists the people Mesh refused or failed, the
  card's ComplyAdvantage line says "N not screened" with each name and
  Mesh's words (`failed` on the line, drawn in amber), KYC4U's note names
  them, and the AML box's Screening step reads "ComplyAdvantage didn't
  screen everyone"; ComplyAdvantage refused or not answering is a failure
  too (`caSkipIsFailure`), not set up is not. Press Run again on a party
  checked from 19 to 22 November to screen its people.
- **The date of birth decides** (`providerMatchFlags(m, line)`, the line
  carrying `person` and `dobKnown`): for a person screened with a date of
  birth, a profile whose date of birth differs is set aside before it is
  kept (same year and month when both give a month, else within a year: a
  first of January reads as the year alone, `profileDobAgrees`); a profile
  whose date of birth agrees is a red flag of any kind; a profile with no
  date of birth is a possible namesake ("no date of birth on the profile"),
  never a red flag; a sanctions match stays a red flag unless the dates
  differ. A person with no date of birth keeps the bars, a warning list at
  90% like anything else. A company, and every check from before this
  change, keeps the earlier rule, so its flags stand until **Run again**.
- **A year either side is not enough for adverse media** (24 November 2026,
  Woody's "random red flags"; widened the same day, next bullet): Fortis Green's trustee Ian Macfarlane
  Anderson, born November 1948, was a red flag on the Jethro Tull musician
  Ian Anderson's adverse media profile, whose only birth date is a year one
  either side (`profileDobAgrees` takes a year alone within a year). The
  match now carries `birthYearNear` (`matchesFromRisks`: every agreeing date
  on the profile is a year alone, not the person's own year), and for
  adverse media, a warning list or fitness and probity such a match is a
  possible namesake ("the profile gives only a year, one either side of
  theirs"); a public role or a sanctions list still counts it. Stored checks
  hold no profile years, so it applies from the next run.
- **Nor is a year with no month** (24 November 2026, Fortis Green's run
  again: the same musician's profile now gave 1948, Ian Macfarlane Anderson's
  own year, worked out from his age in a 2026 This is Money article, so the
  rule above did not catch it). The match also carries `birthYearOnly`
  (every agreeing date on the profile is a year with no month, the person's
  own year included), and for adverse media, a warning list or fitness and
  probity such a match is a possible namesake ("the profile gives only a year
  of birth, no month"): a month that agrees ties the person, a year alone
  does not. A public role or a sanctions list still counts the year. From
  the next run, as above.
- **A charity trustee is the director of the same name** (same day): the
  Charity Commission lists "IAN CRITCHLEY" and Companies House "CRITCHLEY,
  Ian Martin", so they were screened as two people, the trustee with no date
  of birth, and a police officer's PEP profile at 70% became a red flag.
  `onePersonNamed` (`shared/kyc-prechecks.ts`) folds a trustee into the one
  director or owner whose name holds every word of the trustee's, the
  surname agreeing; two such people is no answer. A merged person keeps the
  director's date of birth and context (`add` in `runPrecheck`). It applies
  from the next run.
- Not run against Mesh from a build machine (no keys here): the first run on
  live shows whether Mesh now keeps the date of birth (the customer record in
  Mesh, or the connection check's refusal line). Not built: Mesh's own
  year-of-birth exclusion filter (`FILTER_ATTRIBUTE_YEAR_OF_BIRTH`) on the
  "chat bgp" configuration, which Mesh's screens did not offer Woody; its API
  ("Update screening configuration") or ComplyAdvantage can switch it on.

## Adverse media under a name spelt differently (Woody, 2026-11-21)

Woody: "comply advantage keeps hitting miss spells of the names and picking up
adverse media on things not spelt the same but are similar. is there a way of
sorting that?", then "Yes want it". Do not re-litigate. Rules:
`providerSpellingVariant`, `nameSpeltAsTheirs`, `personNameParts`,
`splitProviderMatches` (now `variants` as well) and `precheckSpellingVariants`
in `shared/kyc-prechecks.ts`. Tests: `server/kyc-prechecks.test.ts` (in
`npm test`), `qa/regression/kyc-screening-bars.test.mjs`.

- **The cause** is the Mesh configuration: "chat bgp" screens every risk at
  50, and ComplyAdvantage's own starting points are 50 for sanctions, 60 for
  PEPs and 90 for adverse media, so at 50 adverse media brings back names
  that are only like the person's. Woody was advised to split it into
  collections in Mesh (Settings → Screening configurations; up to four
  collections, each with its own threshold): sanctions 50, PEPs 60, adverse
  media and the rest 90, with Jack agreeing the figures. If that is done as a
  new configuration, its id goes on Railway as
  `COMPLY_ADVANTAGE_SCREENING_CONFIG_ID`.
- **The app's backstop**: an adverse media profile is kept only when its name
  is spelt as theirs. For a person, their surname is all there and every
  other word of the profile's name is one of their names (initials, titles
  and suffixes aside; the register's "SURNAME, Forenames" read either way;
  `nameTokens`, so accents and hyphens do not count). For a company, every
  word of one name is in the other once the legal form is left out. Anything
  else is a **spelling variant**: set aside, never a red flag or a possible
  namesake, whatever ComplyAdvantage scored it. A profile whose date of birth
  agrees with the person's is kept however it is spelt; a profile that could
  not be read stays as the bars say. **Sanctions, public roles, warning lists
  and fitness and probity are never set aside on spelling**: people on those
  lists are recorded under other spellings and transliterations.
- **Set aside, not hidden**: the AML box's BGP's checks line counts them
  ("set aside, spelt differently: N"), the card's **Set aside, spelt
  differently** line lists each (the name screened, the profile's name, its
  source and score), KYC4U's note carries them, and a red flag on the same
  line names how many were set aside. It is worked out when the checks are
  read, so stored checks change without a re-run.

## Whose identity check it was (Woody, 2026-11-19)

Woody: "this is email about jack barrat but its actually after woody bruce
diod the check so its got confused jack hasnt done his yet". On deal #4491
the request to Jack for BGP Ltd (ref 7MJEGT) went out at 16:43 with Woody
copied; Woody opened his copy at 17:11 and passed Veriff himself; the app
said "jack Barrat has finished their checks ... Identity check: passed" and
filed the result as Jack's. Bruce Cap's request (4YTTES) was only sent at
17:22. Veriff reads the name off the document (`verification.person`,
stored as `veriff_sessions.verdict_person`); the app now sets it against the
person the request was for (`verifiedPersonName`, `idCheckIsThePerson` in
`shared/kyc-prechecks.ts`: every word of one name in the other, a letter's
typo allowed in a long word, a first name alone matched within the other).
Nothing is moved between parties (Woody asked for it to land on Bruce Cap,
then withdrew it, then withdrew that: the records show it was done on
Jack's link). Guards: `qa/regression/kyc-id-person.test.mjs`.

- **Someone else's check is not the client's**: `progressOf` counts the
  identity check done only when it is the person's; the deal card's request
  row says "Identity check (passed) was WOODY BRUCE's, not jack Barrat's"
  with an amber note (`idVerifiedName`, `idOtherPerson`); the Finished email
  is "The checks sent to jack Barrat were finished with WOODY BRUCE's
  identity check", lists the client's own check as not sent and says what to
  do; the client's page says whose check it was and lets the right person
  start their own (within the three-session cap).
- **Veriff's approval** is filed as "Veriff verification — <verified name>
  (on the check asked of <name>).json", on the company with no contact, and
  ticks nothing on the checklist, when it is someone else.
- **Photos as thumbnails** (Woody, same evening: "the letters for the photos
  can we show them as thumb nails?"): on the deal card's request rows, a
  JPEG, PNG, WebP or GIF the client sent shows as an 80px thumbnail opening
  the file, with what it was sent as and the date; anything else (HEIC, PDF,
  Word) stays a line with its name.

## People to check: each owner's own link (Woody, 2026-11-19)

Woody, the same evening on deal #4491: "so it looks signed off but doesnt
show all the other directors at this stage that need to get signed off?" and
"i didnt add huseyns details or david bruce just huseynes passprot and
nothing for david so cant be ok": the one "ID for each of those owners" step
ticked itself on the first file. He agreed the proposal: "a list of people
to check for each party: the owners and the person acting, each with their
own Veriff link and a proof-of-address upload; the directors shown with
their sanctions result only". Do not re-litigate. Rules (pure):
`shared/kyc-people.ts`; reads: `server/kyc-people.ts`; requests and routes:
`server/aml-portal.ts`. Tests: `server/kyc-people.test.ts` (in `npm test`),
`qa/regression/kyc-people.test.mjs`.

- **Who** (`partyPeople`): the owners the register names (people with
  significant control and the people found up the ownership chain, MLR 2017
  reg 5) and the person dealing with us for the company (the recipient of a
  request to it, not cancelled; reg 28(10)). One person is one row however
  the register spells them (`personNamesMatch`; the register's spelling wins,
  `personDisplayName`). A listed company has no owners to identify (reg
  28(5)): the person acting only. Directors who are neither are listed with
  their sanctions result only, no ID. A private individual's side lists the
  person asked and anyone added alongside them (below). With no company that signs, or no register read,
  the owners are not known (`not_read`).
- **What each sends**: an identity check (Veriff) and a proof of address from
  the last three months, except the person acting for a company who is not an
  owner, who owes the identity check alone (23 November 2026, "Ask only
  what's left" above) (BGP's AML policy, Issue 2, "Individuals": one proof
  of identity, one of residential address; the policy lists a photocard
  driving licence for identity only, so it never stands for the address).
  The proof of address wording now names this year's council tax bill too
  (the policy's "local authority tax demand").
- **Evidence**: an identity check is a person's when the name Veriff read is
  theirs and, when both are known, the date of birth agrees with the
  register's month and year (`dobAgrees`), on any request on the deal (Woody's
  check on Jack's link counts for Woody, "on the link sent to Jack Barrat
  (7MJEGT)", and not for Jack); one whose name was not read counts for the
  person its link was for. A passed check on a cancelled request still counts;
  a check under way only on a live link of their own. A proof of address
  counts only on the person's own request for this party. Files on the old
  owners' step say nobody's name: listed apart as "whose is not known", and
  that step is never ticked on the deal card when the owners are named.
- **Their own link** (`createPersonCheck`): a request with `request.person`
  (key, name, roles, how they own it), kind individual, asking only what is
  still outstanding for them (`personRequestAsks`); no Veriff session until
  they press the button. BGP staff make it on the deal card's People to
  check (`POST /api/aml/deal/:id/client-checks/people`, on
  `KYC_CLIENT_CHECK_ROUTES`; Send them a link: email it, saving the person to
  the CRM under the brand, or Just make the link). The person acting passes
  an owner theirs from their own page (`POST /api/kyc-upload/:token/people`:
  owners only, never themselves, the request to the person acting only;
  email at most three times a day and not twice in two minutes; nothing a
  client types goes into the CRM). The email and page say why an owner is
  asked ("Companies House lists you as someone who owns or controls …").
- **The request to the person acting**: when the register names the owners
  it no longer asks for "ID for each of those owners" (`precheckAsks` drops
  it and says why); it asks the person acting for their own proof of address
  only when they are one of the owners (`precheckAsks`; until 23 November
  2026 always, through `defaultKycDocs`), and a step "Pass each owner their own link" lists the
  owners who still owe something (`ownLinksFor`), done when each has a link.
  The agents' Finished note lists who still owes what.
- **Finished**: a party's client checks are finished only when the request to
  the person acting is and every person to check has sent what they owe; the
  sign-off asks for a note otherwise and names who
  (`clientChecksOutstanding`), and the AML dashboard keeps the party at
  Client checks sent while a person's own request is open. A public-roles yes
  on a person's own request is a red flag of its own, with their name.
- **With the AML policy** (merged the same evening, next section): on a
  letting under £10,000 a month (sanctions checks only, `amlRegime`) the list
  shows each person's roles and sanctions result and asks no one for
  anything, and the sign-off owes nothing (`outstanding` is empty when
  `sanctionsOnly`); a party marked Not required gets no list.
- Checked in a browser against a local copy shaped like #4491 on
  19 November 2026. Not run against Veriff or Microsoft from a build machine.
  Not built: adding a person by hand (an owner the register does not name),
  and asking each owner the source of funds.
- **A person checked before is not asked again** (Woody, 25 November 2026:
  "if I send someone an email from the app that has had their identity
  allready confimred for something else it wont ask them to do it again?",
  then "yes", and "proof of address should have an expiry flag so cant be
  used but should be iffpossible"). Rules: `priorIdCheckFor`,
  `priorAddressProofFor` in `shared/kyc-people.ts`; read: `priorEvidence` in
  `server/kyc-people.ts` (test requests and the requests in hand left out).
  A Veriff check passed on another transaction or client file in the last
  three years (`ID_CHECK_REUSE_YEARS`) counts for a person when the name
  Veriff read is theirs and the date of birth agrees with the register's, or,
  with no register date, when it was asked at the same email address; the row
  reads "checked on another transaction, <name> (ref), <date>". A proof of
  address sent elsewhere counts when it reads as theirs (the same checks) and
  is tied to them (the same email, or their passed check on that request),
  while in date (`addressProofExpiry`: three months from its date, a year for
  a council tax bill); out of date it shows as "Proof of address out of date
  ... ask for a new one" and is owed again. Their own link then asks only for
  what is left; the request to the person acting (`createClientCheck`) drops
  the identity check for a contact already checked by the same name and email
  (`idCheckNote` says so). Tests in `server/kyc-people.test.ts`.
- **Anyone on the transaction may send a proof of address** (Woody,
  24 November 2026: "Let's allow others to drop proof of address? Is that
  technical? Or legal": technical; the law asks that it is genuine, recent,
  an accepted kind and in the person's name, not who hands it over). A proof
  of address sent on any link on the party counts for the person it names,
  read and checked as on their own link (`others` in `partyPeople`), and
  their row on People to check says where it came in ("sent on Kenneth Tam's
  link", `proof.elsewhere`, beside the link's reference). On the person acting's page
  each owner has **Upload their proof of address** (`kyc-owner-proof-<key>`)
  beside sending their link: `POST /api/kyc-upload/:token/file` with
  `forKey`, taken only for a proof of address, on the person acting's own
  request, naming one of the party's people, and kept as
  `request.addressProofFor[documentId]`. The hint never makes a bill count:
  it shows a bill sent for someone on their row whether or not it passed, so
  an officer can Read again or Accept it for them, and an acceptance counts
  only for the person it was sent for. The page says whether each owner's
  proof is in, being read, or did not pass. They still do their own identity
  check. Tests: `server/kyc-people.test.ts`,
  `qa/regression/kyc-proof-for-others-guards.test.mjs`.
- **More than one private individual on one side** (Jack, 20 November 2026:
  "sometimes it is private individuals who havent set up a company yet ...
  I want to be able to start checks on more that one private indiviaul").
  A private individual's party now has a people list too (`partyPeople`
  with `kind: "individual"`, basis `individual`; no register is read): the
  person the request went to (`acting`) and anyone added alongside them
  (role `joint`, "named on this deal alongside <name>"). **Add another
  person** (`AddPersonButton` in `kyc-client-checks.tsx`: in People on the
  AML card, and in the party box under Who signs, `IndividualSidePeople`)
  posts `name` with the person check (`POST /api/aml/deal/:id/client-checks/people`,
  `createPersonCheck`; BGP staff only, refused for a company party and from
  a client's page): their own request asks the identity check, a proof of
  address (read against them) and the question about public roles, and
  emailing it files them in the CRM under the party. **Change name** on
  their row (`POST /api/aml/deal/:id/client-checks/people/rename`, BGP
  staff; Jack, 20 November 2026: added as "Jonny Miller", passport
  Jonathan) puts right a name BGP typed, never a Companies House one: what
  they sent is read against the new name at once, nothing is resent, and
  the CRM contact is not renamed. Each owes what anyone
  on a people list owes (the sign-off, the AML dashboard, the Finished
  email). There is no table: an added person is their own request. Not
  built: adding a person by hand to a company party (an owner the register
  does not name), and asking each owner the source of funds.
  **Everyone on that side is screened** (found by the live tests of
  22 November 2026: someone added alongside was never screened, and the
  private client's own row on People read "not screened" though BGP's
  checks had screened them). BGP's checks on a private individual now list
  the people on their side from the party's requests (`runPrecheck`): each
  person named alongside them is screened in full like the person (sanctions,
  ComplyAdvantage, the web search; `chooseScreened` takes role "named
  alongside the party"), and whoever the checks went to is screened against
  the sanctions lists. Adding someone, or putting a typed name right, starts
  a fresh run at once (`startPrecheck` with `force` in `createPersonCheck`
  and the rename route), and People reads the private individual's own
  checks (`partyPeopleFor`). Guard: `qa/regression/kyc-people.test.mjs`.
- **The party box names them and asks for their details** (Woody,
  20 November 2026: "where it says who to ask it should really say these
  owners need to AML and prompt for contact details at that stage", and
  "make sure this form is consistant where dealks are added or converted").
  The one party box (`DealPartyEditor` in `client/src/components/deal-parties.tsx`)
  opens with **Who the AML checks need**, above Who to ask: the people to
  check as the deal card reads them (`GET /api/aml/deal/:id/client-checks`,
  `usePartyPeople`), each with their roles, how they own it, what is still
  to do, and the email and mobile the CRM holds, or boxes to give them;
  directors are listed with sanctions only. With the register not read yet
  it offers **Read them now** (BGP's checks before asking, `POST
  /api/kyc/deal/:id/prechecks`), and with no company that signs it says to
  set one first. **Save** is `POST /api/deals/:id/parties/:role/owner { key,
  email?, mobile? }` (BGP staff signed in as themselves): the person is the
  one with that key among the party's people to check (never a typed
  name), saved on the CRM contact under the brand that is them
  (`ownerContactMatch`: the email, else the name the register's way, one
  with an email first; blank fields only, and an email already held is
  kept and named in the reply), else a new contact with a note saying why;
  a `deal_audit_log` line (`aml_person_contact`). It does not change who to
  ask: **Make them who to ask** does, through the party save. One line,
  "<names> need AML checks: no email or mobile held for them yet. Add their
  details" (`peopleToReach`: something owed, no link of their own, no
  contact of that name with an email or mobile), opens the box from the
  three places it is drawn: the deal page's Parties card (`DealPartyLines`),
  the deal's AML box and the Kick off AML step after New Deal, Promote to
  Solicitors and the Heads of Terms convert (`PartyReadyToStart`). Each
  caller passes what the deal's AML status already says
  (`partyAmlFacts` in `shared/deal-parties.ts`; the Parties card reads the
  status the AML box on the same pill reads, one request): approved and in
  date, Not required, or a letting under £10,000 a month draws no line and
  asks for nothing (`partyAmlQuietWords`). Tests:
  `server/deal-parties.test.ts`, `qa/regression/deal-parties-guards.test.mjs`.
- **Each proof of address is read and set against the person** (Woody,
  20 November 2026: "with the proof of address is the app checking its
  actually for that person and acceptable? linking it from a name
  perspective?"; until then a file on someone's own link, on the proof of
  address step, counted as theirs whatever it said). Rules:
  `shared/kyc-address-proof.ts`; reader: `server/kyc-address-proof.ts`.
  Tests: `server/kyc-address-proof.test.ts` (in `npm test`),
  `server/kyc-people.test.ts`, `qa/regression/kyc-address-proof-guards.test.mjs`.
  - **The reading**: when a client files a proof of address
    (`fileClientDocument`, never on a test request, whose uploads are not
    kept), the file alone goes to Anthropic, called directly, one forced
    tool call (`read_address_document`): the kind (`ADDRESS_PROOF_KINDS`:
    utility bill, bank, building society or mortgage statement, council tax
    bill; or driving licence, or other), what it calls itself, the issuer,
    the names it is addressed to, its date (a statement's closing date), the
    address and whether it is a certified copy. A PDF goes as a document, a
    picture (an iPhone HEIC converted first) as a JPEG of at most 2000px, a
    Word file as its text. Capped a day (`ADDRESS_PROOF_READER_DAILY_CAP`,
    default 200, 0 = off); a file it cannot read, the reader off or the
    allowance used is a reading that says why, and nothing is claimed for a
    file it cannot open. The reading is kept on the request it came in on
    (`kyc_upload_tokens.request.addressProofs`, keyed by the KYC document):
    no schema change. A proof filed before the reading existed, or whose read
    was lost to a restart, is read when BGP staff open the deal's client
    checks (`readUnreadAddressProofs`: five at a time, each once; a failed
    read is kept as a reading that says why, and Read again retries it).
  - **The verdict** (`checkAddressProof`): a name on it is the person's
    (`addressNameMatches`: the register's way, or the same surname with each
    forename or initial on it one of theirs, so "MR H MIRHADIYEV" is Huseyn
    Mirhadiyev and a surname alone is not), dated at most 92 days before it
    was sent (a council tax bill, "this year's", 396), not after it, and a
    kind the policy accepts. Each failure is a plain reason.
  - **Counting**: a proof counts for the person only when its verdict passes
    or the Nominated Officer or a Deputy accepted it with a note of at least
    10 characters (`request.addressAccepted`, a `kyc_audit_log` line
    `address_proof_accepted`). Until then the person still owes a proof of
    address, so the sign-off asks for a note and they can be sent a link
    for a new one; a later proof that passes counts over an earlier one.
  - **The deal card** (`AddressProofLine` in `kyc-client-checks.tsx`): what
    it was read as ("British Gas electricity bill, 12 Oct 2026, in the name
    of MR H MIRHADIYEV", opening the file), the address on it, the reasons
    in amber, **Read again** (BGP staff, `POST
    /api/aml/deal/:id/client-checks/address-proof/read`) and **Accept it**
    (offered only to those who decide, `canDecide` from the AML status;
    `…/address-proof/accept`, refused to anyone else on the server). Both
    routes are on `KYC_CLIENT_CHECK_ROUTES` and take only a proof of
    address on that deal's own requests, never a test's.
  - Not built: telling the client on their page that a proof did not pass;
    reading the proof on a private individual's own request (its request
    row shows the file as before); reading identity documents sent as
    files. Not run against Anthropic from a build machine (no key here).

## BGP's AML policy and risk assessment, Issue 2 (Woody, 2026-11-19)

Woody uploaded BGP's Anti-Money Laundering Policy and Firm-Wide Anti-Money
Laundering Risk Assessment (both Issue 2, November 2026): "can you consider
these and add into the AML as required", then "can we have that as a
download". Asked, he chose (do not re-litigate): a standard-risk party is
signed off by the deal's agents and an enhanced one by the Nominated Officer
or the Deputy; restaurants and bars are a factor to weigh, not enhanced; a
deal that exchanges or completes with checks outstanding still moves and the
officers are emailed; the other side of a deal can be marked Not required, by
the officers only. Rules: `shared/aml-policy.ts`; routes:
`server/aml-policy.ts`. Tests: `server/aml-policy.test.ts` (in `npm test`),
`qa/regression/aml-policy-guards.test.mjs`.

- **The officers** (policy C.b): Jack Barratt is the Nominated Officer
  (MLRO) and **Layla O'Driscoll the Deputy** (Woody, 2026-11-20: "Layla is
  correct not Victoria"; the Issue 2 document names Victoria Broadhead as
  Deputy Nominated Officer and Deputy Compliance Officer, and a corrected
  issue is BGP's to publish, as a new entry and file). `POLICY_OFFICER_NAMES`
  is what **Use the policy's officers** looks for: since Issue 3 (Jack,
  2026-11-23) the policy names Jack Barratt, with Layla O'Driscoll and
  Woody Bruce as Deputy Nominated Officers, and the button sets all three.
  **Since the same day
  there can be more than one Deputy** (Woody: "can you add woody bruce as
  deputy AML too please", then "jack as officer and then layla and i as
  depituties"): the officers in the app are Jack Barratt, with Layla
  O'Driscoll and Woody Bruce as Deputies. The Nominated Officer is on
  `aml_settings` as before; the Deputies are
  `system_settings.aml_deputy_officer`, stored as `{ deputies: [...] }`
  (`readDeputies` in `shared/aml-policy.ts` also reads the single officer
  stored before; at most `MAX_AML_DEPUTIES`, 3). Each decides
  (`amlOfficerRole`, `amlActor().officerRole`), each is emailed the
  escalations (`amlOfficerEmails`); admins act only while no Nominated
  Officer is set. An admin sets them on the AML dashboard's policy panel
  (**Change**: the Nominated Officer and a list of Deputies, Add a Deputy
  and a cross to remove one; `PUT /api/aml-policy/officers { nominatedId,
  deputyIds }`, which still takes `deputyId` from a screen loaded before).
  **Use the policy's officers** (`POST …/officers/from-policy`) is first
  set-up only: with a Nominated Officer set the panel does not offer it and
  the server answers 409, because it would overwrite the Deputies an admin
  chose since. **KYC4U is BGP's
  outsourced KYC provider, not its MLRO**: this supersedes "KYC4U is BGP's
  MLRO" (Woody, 2026-10-05) and "the MLRO's ... admins until then" wherever
  either appears in this file; the screens and ChatBGP say so.
- **The documents as downloads**: `server/assets/aml-policy/` (copied by the
  build), listed in `AML_POLICY_DOCUMENTS`, served to BGP staff signed in as
  themselves at `GET /api/aml-policy/documents/:key` (outside the retired
  `/api/aml/`, on no client list), the buttons on the policy panel (Deals →
  AML). A new issue is a new entry and a new file: never overwrite an old one
  (policy M keeps older versions for five years). The panel shows the latest
  issue of each as a button and an earlier one on a quiet line under them
  (`amlPolicyDocumentReplaced`). **Issue 3 of the policy** (Jack, 2026-11-23,
  `bgp-aml-policy-issue-3.docx`) is Issue 2 with the four changes he signed
  off: a company, partnership, LLP or listed company is evidenced by its
  Companies House record (or its home register) with BGP's screening in
  ChatBGP, an aggregator report allowed instead (4.1, 4.2, 4.4, 4.6); an
  identity check through a certified service on the UK DVS register
  (currently Veriff) counts as meeting the person, so certified copies are
  not needed (4.10, 4.11); a newly formed company with no accounts gives its
  parent's latest accounts or a record of how the deal is funded (4.4); and the
  Deputy Nominated Officers (C.b). The risk assessment is still Issue 2
  (`POLICY_SOURCE` names both). Training confirms the latest issue: each
  person confirms Issue 3 afresh on My BGP → AML training. **Superseded the
  same day by Issue 4 of the policy and Issue 3 of the risk assessment**: see
  "AML policy Issue 4 is the source of truth".
- **Levels** (policy F.a): each party is Simplified, Standard or Enhanced
  (`dueDiligenceLevel`): enhanced on any red flag or higher-risk factor that
  counts (set aside with a comment, it does not); simplified on a basis
  (`simplifiedBasis`: listed on a regulated market, an FCA-authorised ICVC, a
  UK public body by its name with no Companies House record; a company owned
  through a listed one was simplified until Issue 4 of the policy made it
  standard, `standardBasis`); otherwise standard. Worked out in `loadDealRedFlags` (`levels`) and
  the AML dashboard (`level`, `levelWhy`); shown on the deal card
  (`PartyLevel`) and the dashboard's **Due diligence** column.
- **Higher-risk factors** (`policyFactorFlags`, flags with `factor: true`):
  a trust in the ownership (PSC natures of control "as trust", or a trustee
  owner); an unlisted limited partnership; the registered office or an owner
  in a FATF-listed country (call for action or increased monitoring: the UK's
  high-risk third countries since SI 2024/69, so enhanced due diligence by
  law) or in the risk assessment's Eurasia and Africa list; an owner who is a
  national of a country selling citizenship; a sector the risk assessment
  names (SIC code or BGP's type: gambling, nightclubs, hairdressers, barbers,
  nail, tanning and beauty salons, car washes, vape shops, American candy
  shops, convenience stores, mining and oil and gas, dual-use manufacturing);
  and on the deal a super-prime sale (`superPrimeFlag`: an investment deal's
  price £5m or more in London and the South East by postcode, over £1m
  elsewhere; since Issue 3 of the risk assessment, 23 November 2026, it is a
  factor to weigh on each party, `superPrimeWeigh`, not a flag). They count as red flags do (KYC4U, then the officers), can be
  set aside with a comment where they do not apply, and are listed apart, in
  amber, on the card and in KYC4U's note. Restaurants, bars, pubs, gaming
  venues and car parks are only "to weigh" (`policyFactorsToWeigh`). FATF's
  lists are those of 30 October 2026 (`FATF_LISTS_AS_OF`; FATF's site refused
  automated reads, so they were read from four agreeing reports): **update
  them after each plenary** (February, June, October). An owner's country of
  residence is read since this day (`RegisterOwner.residence`).
- **Sign-off** (`signOffActor`): the officers, or an agent on the deal
  (`isDealAgent`: `internal_agent_ids` or the name), only on a standard or
  simplified party (`signOffDenial` still refuses any flag or factor). KYC4U's
  result, red flags set aside and Not required stay with the officers
  (`decider`).
- **Re-checks** (policy H.a, `RECHECK_YEARS`): 3 years simplified or
  standard, 1 year enhanced. A sign-off writes 3 years; KYC4U's result added
  in the app writes the party's level at the time ("Re-check years" on its
  request row); a result synced from KYC4U's own list carries no level and
  gets 1 year (`kyc4uRecheckYears`). `approveEntityKyc` takes `recheckYears`;
  `recheck_interval_days` applies only to callers that give none.
- **Lettings under £10,000 a month** (policy A, `amlRegime`): sanctions
  checks only; the card says so and a sign-off needs no client checks or note
  (`SignOffFacts.sanctionsOnly`). Rent not recorded reads as full checks.
  Rent review, dilapidations and service charge deals read as advisory (a
  card line only; the dashboard still lists them).
- **Not required** (policy G and F.f): `kyc_party_exemptions` (boot
  migration), one live row per deal and role, for the party it was set for;
  reason `joint_agent` or `no_deal` and a comment (`notRequiredInput`).
  `POST /api/deals/:id/parties/:role/not-required` and `…/undo`, officers
  only. The gate (`checkCounterpartyAml` with the deal's id;
  `recordAmlGateWarning` filters again), the deal's `kyc_approved`
  (`recomputeDeals` passes the id), the status feed (`allApproved`, `missing`,
  `notRequired`) and the dashboard (stage `not_required`, bucket Done) read
  it. A rejected party is never exempt. Since 22 November 2026 the
  `joint_agent` reason follows HMRC (see "The joint agent's checks, and
  HMRC's joint agent rules" below). **Since Issue 4 of the policy (23
  November 2026) the only reason taken is `no_deal`**: the counterparty on a
  joint instruction is always checked.
- **Escalations**: a move to Exchanged or Completed with a party not
  approved records the warning as before and emails the officers once per
  deal and stage (`alertOfficersOfOutstandingChecks`, `deal_events`
  `aml_officer_alert`, `amlOutstandingAtCompletionEmail` through
  `sendKycEmail`). No block was added: the 17 November "gating remain as is"
  stands. The red-flag alert copies the officers (never on a test). A
  sanctions flag on the card says to tell the Nominated Officer: an OFSI
  report and legal advice follow (policy J and 3.10).
- **Wording**: BGP's standard heads of terms gained clause 38,
  Anti-money laundering (`AML_HOTS_CLAUSE`; `STANDARD_HOTS_TEMPLATE_37` is
  kept so a property's copied 37-clause text still reads as BGP's standard).
  The info sheet, the Share with a brand PDF and bgp.uk.com's particulars
  print `AML_MARKETING_NOTICE` (the marketing site needs its own redeploy).
  Landsec's four scheme forms carry the clause too since 20 November 2026
  (Woody: "yes on AML"; see "Scheme forms"). The client checks ask for the
  documents the policy lists (firearms or shotgun certificate, council tax
  bill, an address dated in the last three months, the certification words of
  policy 3.9, a structure chart).
- Not built, each Woody's call: a record of an OFSI report; checking a joint
  or sub-agent's HMRC registration (policy B and C); training records (policy
  L); internal suspicion reports (the old `aml_internal_reports` routes are
  retired); a Register of Overseas Entities check; EU sanctions list
  screening; the FCA register for simplified due diligence; deleting records
  five years on.

## Running without KYC4U, and the AML box as rows (Woody, 2026-11-22)

Woody: "I dont actually think KYC4U is doing anything we cant unless you
disagree? in which case we need the structure to work very well", and Jack
found the AML screens "very overwhelming lots of continous text and lots of
AI style commentry"; the boards "should be the same in AML and the deal
boards". Do not re-litigate.

- **The officers' in-house switch is "no KYC4U"** (Deals → AML → Policy and
  settings; still off until an officer turns it on). With it on:
  - an open or submitted KYC4U request no longer holds a party: the sign-off
    (`signOffDenial`: `withKyc4u && !inHouseEdd`), the Next line (no KYC4U
    form or "With KYC4U" step) and the AML board (`amlStage` takes
    `inHouse`; never With KYC4U);
  - who a flagged party waits on is the officers (`amlWaitingOn(stage,
    flags, inHouse)`);
  - the red-flag emails, the risk assessment and the AML file name the
    officers, not KYC4U, and count an officer's in-house sign-off as the
    approval;
  - Kick off AML sends a flagged party the client checks;
  - the WIP report's "Not raised with KYC4U" list is empty;
  - the AML box shows no KYC4U line unless a request or KYC4U's own record
    exists.
  Tried end to end on a local copy on 22 November 2026: a trust landlord with
  a submitted KYC4U request was held (off), then signed off by the Nominated
  Officer with a note for one year (on); a short note is refused.
- **The deal's AML box** was one row per party with ten check lines; later
  the same day it became four steps per party (see "The AML redesign: four
  steps per party" below). Keep new words short: a status, not an
  explanation.
- `useAmlInHouse()` (`aml-policy-panel.tsx`) reads the switch where a
  screen's words depend on it.
- **In-house is the default, and a red flag goes to the AML Officer**
  (Jack, 23 November 2026: "should say raise with AML Officer (Jack) ...
  any reference to KYC4U across all of AML should now say 'AML Officer
  (Jack)' as we are breaking away from them unless super complex situations
  which ill make call on"). `readInHouseEdd` reads ON unless an officer has
  switched it off (no stored row was on live, so it went on). The red flag
  and higher-risk boxes say "Red flag: raise with AML Officer (Jack)"
  (`amlOfficerLabel` in `shared/aml-policy.ts`: the Nominated Officer's first
  name; `useAmlOfficerLabel` on the screens), a KYC4U request prepared but
  not submitted no longer flags the Documents step, and KYC4U stays only as
  **KYC4U (complex case)** under Other ways. Switched off, the KYC4U words
  come back as before. **Merged the same day with "KYC4U is no longer used"
  (Woody: "We are no longer using KYC 4U update the app accross
  everyhting")**: there is no switch (`readInHouseEdd` always answers on) and
  no KYC4U (complex case) button, because every route that would send a
  request to KYC4U answers 410. The "raise with AML Officer (Jack)" words
  stay. For a complex case Jack still chooses to send to KYC4U, BGP
  commissions KYC4U directly, drops their report on the party's Upload
  documents, and the Nominated Officer or a Deputy signs the party off.

## AML rules in short, checked against HMRC every 3 months (Woody, 2026-11-22)

Woody: "a summary of the rules and put an auto refresh in there for any hmrc
updates every 3 months. Make it simplistic and to the point try and stop AI
slang". Rules: `shared/aml-rules.ts`; check: `server/aml-rules.ts`; page:
`client/src/components/aml-rules.tsx`, the **Rules** pill on Deals → AML
(every BGP person). Tests: `server/aml-rules.test.ts` (in `npm test`),
`qa/regression/aml-rules-guards.test.mjs`.

- **The rules** are about 25 short lines in eight groups (who we check and
  when, joint agents, what we check, higher risk, if the checks can't be
  finished, suspicion, relying on another firm, records), each naming the HMRC
  page it comes from (AMLG2200, AMLG2300, AMLG3200, AMLG11100 to AMLG11700),
  MLR 2017 reg 5, OFSI or BGP policy. Written from HMRC's pages on 22 November
  2026 (`AML_RULES_WRITTEN_ON`). The test refuses a line over 30 words or
  padding words ("ensure", "robust", "leverage" and the like). Change a rule
  there, never on the page.
- **Joint agents** (Woody asked the same day whether a registered joint
  agent's checks can be relied on): HMRC's "ask the other agent for their
  checks on the buyer, and record it if they don't send them" is in the sales
  guidance only (AMLG2200 s21; MLR 2017 reg 4(3) treats an estate agent as in
  a business relationship with the buyer once the offer is accepted). The
  letting guidance (AMLG2300 s17 to s19, s23) has no joint agent exception:
  every party to the lease is verified, so a tenant the other agent found is
  checked, or relied on under a reliance agreement (reg 39, AMLG11410). HMRC
  registration is a condition of working with an agent and of a reliance
  agreement, never a reason to skip a check. The rules name BGP's policy
  (Issue 2, and Jack's joint agency file note) as going further: no checks on
  a party the joint agent found and negotiated with, sales or lettings.
- **The quarterly check** (job `aml-rules-hmrc`, the 2nd of January, April,
  July and October, 06:40; `HMRC_RULES_CHECK=off` stops it) reads each cited
  page's update date and the manual's change notes from GOV.UK's content API
  (no key, no AI), keeps them in `system_settings.aml_rules_hmrc_check`, and
  emails the Nominated Officer and the Deputies once for the same changes
  (`aml_rules_hmrc_emailed`) when HMRC changed a page after the last review
  (or after the day the rules were written). A page that cannot be read keeps
  its last date. **It never rewrites the rules**: the Nominated Officer
  approves the wording.
- **The officers** have **Check HMRC now** (`POST /api/aml-rules/check`),
  **Approve these rules** the first time and **Rules still right** after a
  change (`POST /api/aml-rules/reviewed`, kept in `aml_rules_review`).
- Read against GOV.UK for real from a build machine on 22 November 2026: 11
  pages, no change since the rules were written.

## The joint agent's checks, and HMRC's joint agent rules (Woody, 2026-11-22)

Woody, asked whether BGP can rely on a registered joint agent's AML: "We have
to do what HMRC say so what's that?", then "Let's get the app to follow HMRC
rules and also send them an email so they can load everything up or email the
aml? If they email or upload it can we then upload it and check it in the
app?". Do not re-litigate. HMRC's guidance, read on GOV.UK on 22 November
2026: a sale (AMLG2200 s21): "The EAB who did not identify the buyer should
request the CDD documentation from the other EAB. If the CDD documentation is
not provided by the other EAB, the EAB should document in writing that it has
been requested and not provided"; a letting at £10,000 a month or more
(AMLG2300 s17): "LABs must verify that all parties to the rental agreement are
who they say they are", with no joint agent exception (s23 lists the only
cases needing no checks), so a joint agent's checks count only under a
reliance agreement (MLR 2017 reg 39, AMLG11410). Joint agents check each other
(AMLG2200, AMLG2300) and work only with registered agents (AMLG11300). Rules:
`shared/aml-policy.ts` (`jointAgentRule`, `notRequiredInput`,
`notRequiredLapse`), `shared/joint-agent-checks.ts`; server:
`server/joint-agent-checks.ts`, with the page and mailbox in
`server/aml-portal.ts`; screens: `client/src/components/joint-agent-checks.tsx`,
the joint agent mode of `client/src/pages/kyc-upload.tsx`. Tests:
`server/joint-agent-checks.test.ts` (in `npm test`),
`qa/regression/joint-agent-checks-guards.test.mjs`.

- **The other side's own agent** (Woody, the same day: "we also need to AML
  the Landlord if we are acting for a tenant.. which might be via their agent
  in this way"). **Superseded on 23 November 2026**: the party's own agent
  is sent the party's standard client checks to pass on (see "The other
  side's agent passes on the standard checks" in "KYC4U is no longer
  used"); the joint agent's request below is offered for the joint agent
  only. What follows describes requests made before then, which still read.
  The same request goes to the party's own agent as the
  transaction records it (`PARTY_AGENT_COLUMNS` in
  `server/joint-agent-checks.ts`: the landlord's leasing agent, the tenant's
  acquiring agent, the seller's and the buyer's agents), stored as
  `request.jointAgent.relation = "own"` with `clientRole` (a request with no
  relation is the joint agent's, as every request before). Who is asked: what
  BGP chose in the dialog, else the firm named, else the party's own agent
  when no joint agent is recorded (`jointRelationFor`). Its email, page and
  AML box say "We act for the tenant on <transaction>, and you act for <the
  landlord>, the landlord" and call them the landlord's agent
  (`agentWords`); on a sale "We check every party to a transaction", never
  HMRC's joint agent line. Everything else is the joint agent's route: the
  rule for the deal, the upload page and reliance terms, the reading and what
  it covers, chasing, Not required and recording the reliance. The AML box
  offers it under Other ways for any party BGP does not act for, named after
  the agent the transaction records (Landlord's agent, Joint agent, else
  Their agent); with both recorded the dialog chooses. The board's waiting
  word is "Waiting on the other agent". Tests in
  `server/joint-agent-checks.test.ts`.
- **HMRC's route for the deal** (`jointAgentRule`): `sale` (an investment
  deal), `letting` (a letting at £10,000 a month or more, or no rent
  recorded), `letting_under` (sanctions only), `advisory`, `other` (treated as
  a letting: checked, or relied on). Shown in words on each party's Joint
  agent line (`JOINT_AGENT_RULE_WORDS`) and on the AML status
  (`jointRule`, BGP staff only).
- **Not required, joint agent reason** (**superseded by Issue 4 of the
  policy, 23 November 2026: refused on every transaction, the record of
  asking below no longer taken; old marks lapse**): refused on `letting` and `other`
  (`jointAgentNotRequiredRefusal`); on a sale it needs the record of asking
  and what came back (`kyc_party_exemptions.asked_on`, `asked_how`,
  `asked_whom`, `asked_outcome`, `joint_ref`, boot migrations): a request made
  in the app (`jointRef`, which must have reached them: sent, opened, or files
  added from their email; "they sent their checks" needs files on it), or how,
  when and whom BGP asked otherwise; `jointAskWords` writes it into the
  reason. A mark made before the rule that no longer meets it
  (`notRequiredLapse`) is no longer honoured anywhere `loadNotRequired` is
  read (the gate, the deal's approval, the board, the AML file) and shows in
  amber on the party (`notRequiredLapsed`, BGP staff). Live had no Not
  required marks on 22 November 2026, so no deal moved.
- **Every joint agent's HMRC registration** is required on the deal's
  Agents line (`agentAmlState`), not only one BGP shares the fee with.
- **Jack's joint agency note** (`server/joint-agency-aml.ts`) words a letting
  at £10,000 a month or more by HMRC: BGP relies on the co-agent's checks
  under a reliance agreement, or checks the tenant itself; under that, the
  letting is outside CDD and sanctions screening still applies. Notes saved
  before keep their own words. **Retired on 23 November 2026** (Woody: "this joint
  agent thing isnt allowed anymore we are sending them an email instead?"):
  under Issue 4 the other side of a joint instruction is always checked, so
  New Transaction and Edit no longer offer the Joint Agency Lead Transaction
  switch, the transaction page no longer offers to add a note, and `POST
  /api/crm/deals/:id/joint-agency-note` answers 410. A note saved before still
  shows on its transaction, marked as saved before Issue 4, and every old note
  stays in the AML Register. Ask the joint agent for their documents instead
  (the party's Documents step, Other ways, Joint agent). Guard in
  `qa/regression/joint-agent-checks-guards.test.mjs`.
- **The request** is a client checks request (`kyc_upload_tokens`) with
  `request.audience = "joint_agent"` and `request.jointAgent` (firm, CRM ids,
  the rule, the reliance agreed, the readings). It is never the party's own
  client checks: the people to check (`dealPeopleRequests`), the sign-off
  (`mainFinished`), the red flags, the client checks list and the AML board's
  client stages leave it out (`NOT_JOINT_SQL`, `isJointRequest`), and its page
  cannot hand out the owners' links. **Ask** (`POST
  /api/deals/:id/joint-agent-checks`, BGP staff signed in as themselves, while
  the client checks are on): not about BGP's own client (`dealClientRole`) or
  on `letting_under` / `advisory` (`jointAskRefusal`), one open request per
  party (one whose email never went is replaced), never a BGP address. The
  email (`jointAgentRequestEmail`) is from the KYC mailbox, copied to the
  deal's agents, with the reference in the subject; chased for what is
  missing (below). **Their page**: one upload for everything (a zip is opened
  and each file filed), and on a letting the reliance terms
  (`jointRelianceTerms`: reg 39(1) and (2), five years, their supervisor)
  agreed with a tick, a full name and their supervisor (`POST
  /api/kyc-upload/:token/reliance`, saved on that key alone), then Finish,
  which emails the deal's agents what came and what it does not cover.
  **By email**: a reply with the reference is filed from the address asked or
  a colleague at the same firm (`sameFirmDomain`, never a free mail service),
  a zip opened. **Files emailed to someone at BGP**: **Add files they emailed
  you** (`POST …/joint-agent-checks/upload`, files or a zip) files them on the
  open request, or on a request of their own marked `manual` (no email goes;
  the record says "by email").
- **Reading and coverage**: each file is read once by Anthropic, called
  directly, one forced tool call (`read_aml_document`), sent the file alone,
  capped a day (`JOINT_AGENT_READER_DAILY_CAP`, default 200, 0 = off), kept
  only in its own shape (`checkJointReading`) on `request.jointAgent.readings`
  (jsonb_set on that key; the page's other saves touch only their own keys).
  A file not read (a restart, the allowance) is read when BGP opens the deal
  (`readUnreadJointFiles`); **Read again** per file. `jointCoverage` sets them
  against the people to check (owners, the person acting, someone named
  alongside; directors only screened), by name and date of birth: identity (a
  photo ID in date, an electronic check that passed, or their CDD summary or
  risk assessment saying it was verified), address (a proof naming them, an
  electronic check that verified it, or their CDD summary saying so: HMRC wants
  the information for reliance, not copies of every document), the company's
  register entry and ownership, the screening; an expired ID, a failed or
  referred check, a screening match, the same name with another date of birth
  and, when BGP would rely on them, simplified due diligence (HMRC AMLG11410:
  never relied on) are flags (`flagItems`, by kind). With no people read by
  BGP, the owners their own register or chart names are the people. It lists;
  it decides nothing. **Their CDD summary counts for more than its people**
  (found by playing the agent on live on 23 November 2026: a summary saying
  the owner's address was not verified asked for nothing about her, and a
  complete one was asked for the owners and the screening again): the owners
  a summary or risk assessment names are the people when BGP read no
  register, naming them answers who owns the company, and the screening it
  reports answers their screening (clear) or is a flag (match); the reader
  records that as the summary's `result`, and a summary that says nothing of
  screening leaves it asked for. What BGP's own checks already read from the
  company's register is not asked of them again (`registerHeld`, from the
  people-to-check basis): the register entry of a company read at Companies
  House or on the charity register, and who owns it when the register names
  the owners, it is listed, or a charity's trustees control it.
- **What is missing, and chasing it** (Woody, 22 November 2026: "we need to
  explain whats missing and keep emailing do as suggested"). `jointGapLines`
  words each gap once, for the joint agent ("Daniel North: a proof of
  address...", "...had expired: please send one in date", "Your agreement to
  the reliance terms") or for BGP. **A file not read yet is never theirs to
  send**: while one waits (the reader off, its allowance used, a read that
  failed), they are asked for nothing it may hold (`coverage.unread`; BGP's
  list opens with "1 file from them not read yet: press Read again, or check
  it by eye", the box's Next line says to read it first, Ask for what's
  missing is not offered and the server refuses it with the reason, and their
  page says "We're reading what you've sent"); the daily job reads such a
  file again first, once a day (`readPendingFiles`). A file that could not be
  opened at all (empty, too large, a picture or Word file with nothing to
  read: `unreadable` on the reading, `coverage.unopened`) is asked for again.
  Their page shows **What we still need**; the deal's Joint agent line
  shows **Still missing** with **Ask for what's missing** (or **Remind them**
  when nothing has come; `POST /api/deals/:id/joint-agent-checks/:ref/chase`,
  BGP staff, takes an email address for files they emailed to BGP). Each chase
  emails the list from the KYC mailbox (`jointAgentMissingEmail`), keeps the
  link open another 14 days, opens a finished request again, and is kept on
  the request (`request.jointAgent.chases`). **The app chases by itself**
  (`chaseJointAgents`, in the client checks reminder job, 10:00): three London
  calendar days after the last email (`londonDayNumber`: sent on a Sunday
  afternoon, chased on Wednesday morning, the date the deal shows,
  `jointNextChaseDay`), on working days only (no weekend or England bank
  holiday, `jointWorkingDay` with `ENGLAND_BANK_HOLIDAYS`), live deals only, while anything is
  missing and the party is not decided (approved, Not required, or the
  reliance recorded) and the request is not cancelled (`jointChaseDue`). After
  `JOINT_CHASE_MAX` (10) of its own chases since the last one a person sent it
  stops, emails the deal's agents once (`jointAgentChaseStoppedEmail`) and
  shows it; a person asking again starts it again.
- **The officers decide** (the Joint agent line's buttons; **Not required
  with this record is gone since Issue 4: a sale's party is signed off on
  the joint agent's documents as a letting's is**): **Not required,
  with this record** on a sale, answering what came back: their checks, **part
  of them** (`partly`: what did not come is written into the record,
  `asked_missing`, prefilled from what their files do not cover) or nothing.
  "They sent their checks" while their files leave gaps needs a note on how
  they were checked by hand, and anything their files flag needs a note on
  what was done about it (`asked_note`); both are kept with the record.
  **Record the reliance** on a letting once they agreed the terms: the
  reliance route (`jointRef`) files their agreement as a PDF
  (`relianceConfirmationPdf`) as the firm's agreement in writing and fills the
  form from it; the officer still ticks each condition. While their files
  leave gaps (MLR 2017 reg 39(2)(a): BGP must have all the information on the
  customer, its beneficial owners and anyone acting for it) the route answers
  409 with the list unless the officer says how they checked them by hand
  (`checkedByHand`, 20 characters; the button then reads **Record the
  reliance anyway**), kept with the reliance. The terms they agree include
  that their checks were not simplified due diligence.
- **Where it shows**: the AML box's **Joint agent** line and its Next step
  (`amlNextStep`: after red flags and KYC4U, before BGP's own step of setting
  the company that signs while their route runs); the AML board's stages
  `joint_asked` and `joint_in` (in progress); the deal's timeline; the AML
  file's "The joint agent's checks" per party.
- Checked in a browser against a local copy on 22 November 2026 (a sale and a
  letting with a joint agent, the joint agent's page on a phone, Not
  required, the reliance, the board, the AML file). The email and the reader
  were not run from a build machine (no Microsoft or Anthropic keys): the
  readings on the local copy were written in the reader's shape.
- Not built: a joint agent's screening match as a red flag on the party (it
  is listed on the Joint agent line); reading a reliance letter's own words.

## The AML redesign: four steps per party (Woody, 2026-11-22)

Woody, on the AML box: "there is a large amount of text some of which is very
AI and its very croded generally without much thought for the simplicity iof
designn and userbility", and "i want you conmsider the whole AML apporach";
shown a drawn mock of four steps per party, with the Parties card merged into
the AML box, he answered "yes go ahead". Do not re-litigate. Rules (pure):
`shared/aml-box.ts`; screens: `client/src/components/deal-aml-status.tsx`
(`PartyAmlBox`, `StepRow`, `AmlBoxMenu`, `UnsetPartyRow`) and
`StaffPartiesAml` in `client/src/components/deal-detail.tsx`. Tests:
`server/aml-box.test.ts` (in `npm test`), `qa/regression/aml-box-sections.test.mjs`.

- **Each party is one card**: its kind chip, name, "BGP's client" where it is,
  a pencil (the party box), the status chip, then the **Next** line and four
  steps. The Next line is a bold lead and a few words with at most one button
  (`amlNextStep` returns `{ tone, who, lead, words, action }`): "To do · Set
  the company that signs [Fill in]", "Waiting on Savills · 2 documents missing
  [Remind now]", "Not yet with KYC4U · 2 red flags [Request KYC4U check]",
  "Ready to sign off · add a note [Sign off]", "Cleared · until 20 Nov 2029".
  Twelve words or fewer and no regulation numbers (the test holds both).
  `firmShort` drops a firm's legal form ("Savills (UK) Limited" is Savills),
  `shortReason` keeps a reason's first clause.
- **The four steps** (`aml-step-<role>-signs|screening|documents|decision`),
  each a tick or a number and a few words, opening on press:
  - **Who signs**: the company that signs, billed to and who to ask
    (`DealPartyLines` with `fullBilling`), the trust line, Owners abroad and
    **Company details** (the register facts).
  - **Screening**: BGP's checks before asking, the red flags and the due
    diligence level with the policy's factors.
  - **Documents**: the route the documents come by, the client checks, the
    joint agent (`JointAgentPanel`: a grid of what their files cover, what is
    missing, the chase), another firm (reliance) or KYC4U, with the people to
    check and the requests; the routes not taken sit under **Other ways** as
    quiet buttons.
  - **Sign-off**: the decision buttons, the second read, the risk assessment
    and the AML file. A step not reached yet says what it waits on ("After
    screening", "After the documents").
  A party still being checked opens on its steps; a settled one (cleared, not
  required) is folded to its line. Nothing the old sections showed was
  dropped: a new piece goes into a step's detail.
- **The deal's own lines** stay under the parties: Deal record (red flags),
  Agents and Solicitors.
- **More** (`aml-box-menu`) holds what was spread across the box: Show all
  detail, The rules in short (`/deals/aml?section=rules`), Report a concern to
  the Nominated Officer, and for the officers Stop acting on this deal. The
  **AML file** button stays beside it for the officers.
- **The Parties card is in the box for BGP staff** (`StaffPartiesAml`): one
  card per party slot (landlord and tenant, or vendor and purchaser, by deal
  type, `partySlotDefs`), **BGP acts for** in the box's heading on a letting,
  the BGP team card above it and the deal's own Xero contact under it when
  one is held. A slot with no party shows its picker (`UnsetPartyRow`); a
  party change refreshes the box (`refreshDealAml`). Client logins keep the
  read-only Parties card (`DealPartiesCard`). The pencil beside a party's
  name opens the company search in one press (Woody, 23 November 2026: "two
  edit buttons to change the Landlord? we only need one?"): the slot's
  `change`, `InlineLinkSelect` with `nameless` (the pencil alone,
  `aml-party-relink-<role>`); there is no second picker row.
- **One set of status words** for the box and the AML board
  (`AML_STAGE_LABEL`: Screened, Documents in, Joint agent's files in,
  Cleared). The AML board's policy is its own **Policy** pill, and its button
  reads **Report a concern**.
- **Shorter words everywhere else**: every AML dialog leads with one line; the
  client's page, the joint agent's page and every AML email were cut to plain
  sentences; regulation numbers came off screens, emails and refusals (the
  Rules page, the AML file's risk assessment, the reliance terms and KYC4U's
  note keep them). The regulation-41 data statement (`KYC_DATA_USE`) keeps its
  words: "only to prevent money laundering and terrorist financing" and "five
  years after our work with you ends".
- Checked in a browser against a local copy on 22 November 2026 (a sale with
  a joint agent, a letting, the board and its Policy pill, the client's page
  and the joint agent's page on an iPhone profile, three emails).
- **Superseded in its look on 24 November 2026** (next section): the card's
  heading leads with the company being checked, step 1 is **The company**,
  the steps are the shared ones and the kind chip and status pill are gone.
  The four steps, their test ids and the Next rule are unchanged.

## One build for AML screens (Woody, 2026-11-24)

Woody, on the client KYC window: "this is great it looks different to the
transactions part though can we use this as the template and make them
match?", then, shown a mock, "yes build and push", and while it was built:
"make sure this is pushed across the app we dont want loads of things looking
differently or built separately one build for AML" and "can we have a cards
view of the AML checks? like we do with CRM". Do not re-litigate. Pieces:
`client/src/components/aml-frame.tsx`; step rule: `shared/aml-steps.ts`; red
flags: `client/src/components/aml-red-flags.tsx`. Tests:
`server/aml-steps.test.ts` (in `npm test`), `qa/regression/aml-one-build.test.mjs`.

- **One set of pieces** (`aml-frame.tsx`), used by every AML and KYC screen:
  the Next box (`AmlNextBox`: bordered, the lead in bold, one button on the
  right; it takes either rule's tones, `amlNextTone`), the step line
  (`AmlStep`, `AmlStepIcon`: a green tick when done, red only for a red flag
  or a rejection, otherwise the step's number; the name, then the line in
  grey), the label and value list (`AmlFactList`, `AmlFact`), the company as
  the register gives it (`CompanyFactsList`), the screening lines
  (`AmlCheckLines`, `AmlScreeningHead`: Run again with the level of due
  diligence beside it), the chips (`AmlStageChip`, `AmlLateChip`,
  `KycStatusChip`, `DealStatusChip`, `AmlLevelChip`, `RedFlagChip`, one size,
  `AML_CHIP_BASE`; one set of colours, `AML_STAGE_TONE`, `KYC_CHIP_TONE`) and
  the card (`AmlCard`, `AmlCardGrid`). A new AML look goes there, never a
  second copy on a screen.
- **Only an issue looks like one** (Woody, 25 November 2026, on the grey "!"
  circles in Screening: "it looks like they are a problem ... better just to
  be a green tick ... all we care about is a issue"). A screening line that
  only says what was done or found (state `info`: GLEIF, who was screened,
  identity verification at Companies House, possible namesakes, names spelt
  differently) is a green tick, as a clear check is (`AmlCheckLine`). A
  finding to review (`attention`) is the amber flag, a screen that should have
  run and did not (`failed`) the amber circle, and a check not run the grey
  clock. Issues sort first; the rest keep the checks' own order. Guard:
  `qa/regression/aml-one-build.test.mjs`.
- **One rule for each step's line** (`shared/aml-steps.ts`):
  `companyStepLine`, `screeningStepLine`, `sanctionsStepLine`,
  `documentsStepLine`, `signOffStepLine`, each giving a state (done, todo,
  flag) and plain words, and `pending` for a step not reached yet (the
  sign-off waits for it: "After screening", "After the documents"). The
  transaction's box and the client KYC window both feed it, so the same
  company reads the same on both (the client window's Sign-off read "Ready"
  before its documents were in; it now reads "After the documents"). Step
  names are `AML_STEP_LABEL`: **The company** (or **The person**; it was Who
  signs on transactions), Screening (Sanctions on a small letting),
  Documents, Sign-off. Expired is to do again, not red.
- **The transaction's party card** (`PartyAmlBox`): the heading is the
  company being checked (`cp.kycName`: the company that signs, else the
  brand), with the role, the brand (a link), BGP's client and its register
  in grey under it; the pencil, the red flag count and a level that is not
  standard stay beside it. The Next box always shows, "Cleared · until …"
  included (the green status pill is gone). The steps sit under it with no
  box round them. Inside The company the party lines (`DealPartyLines`'
  `PartyRow`, also on a client's read-only Parties card) and the company's
  facts are the shared label and value list, shown, not folded. The
  transaction's own lines (red flags on the transaction, Agents, Solicitors)
  are the shared steps in a card of their own.
- **The client KYC window** (`client-kyc-dialog.tsx`) is the template and
  uses the same pieces, the same red flag lists (`RedFlagLists`, with the
  client file's set-aside and put-back addresses from `AmlUrls.redFlags`),
  and the transaction's company facts. The server sends it the client
  checks request and what is still owed (`documents.request`,
  `documents.owing`) for its Documents line.
- **Cards** (Woody's "like we do with CRM"): Transactions and Companies on
  the AML page have **Table** and **Cards** on a computer (`ViewToggle`,
  remembered per browser as `bgp_aml_view_checks` and
  `bgp_aml_view_companies`, read in try/catch; the table stays the first
  choice). A phone always has the cards, and the phone and the Cards view
  draw the same card (`AmlPartyCard`, `KycCompanyCard`) in the CRM lists'
  grid, 90 at a time with Show more. The AML page's party is named by the
  company being checked too (`PartyCell`).
- **Every card one height on a computer** (Woody, 24 November 2026: "can you
  sort the cards so they all the same size and add scroll within as
  required"): `AmlCard` is `md:h-72` (288px, which fitted about three live
  cards in four: transactions measured 145 to 378px, companies 187 to 315px);
  the title and the footer stay put, the rows scroll inside, and a fade shows
  while more is below (worked out after each render, on scroll and on
  resize). A phone keeps each card's own height: one column, and no scroll box
  inside the page's. Guard in `qa/regression/aml-one-build.test.mjs`.
- **The same chips elsewhere**: the CRM lists' KYC chip, the Companies and
  KYC card's chips, the Companies view, the property page's AML on
  transactions here, and the AML page's stage, Late and transaction status.
- Checked in a browser against a local copy on 24 November 2026 (desktop and
  an iPhone profile: the transaction's box, the client window, both Cards
  views). Not changed: the Kick off AML step after New Deal (its "Before the
  checks can start" box) and the AML file's printed report.

## The AML register, training, agents, EU list, overseas entities and five-year deletion (Woody, 2026-11-19)

Woody answered "Go ahead and build" to the list left out of the AML policy
build: a record of OFSI reports, joint agents' HMRC registration, training
records, internal suspicion reports, the Register of Overseas Entities, EU
sanctions screening and deleting records after five years. Each follows the
policy's own words (Issue 2: C.b, I.b, I.c, J, L, M, 3.10, "Working with
joint agents"; the risk assessment's sanctions and "overseas company
registrations"). Rules: `shared/aml-register.ts`, `shared/aml-training.ts`,
`shared/agent-aml.ts`, `shared/aml-retention.ts`, and the overseas entity and
EU parts of `shared/kyc-prechecks.ts`. Tests: `server/aml-records.test.ts` (in
`npm test`), `qa/regression/aml-records-guards.test.mjs`.

- **The AML register** (`server/aml-register.ts`; the old
  `aml_internal_reports` table with additive columns: `party_role`,
  `trading_entity_id`, `details`, `reported_at`, `updated_at`, `updated_by`;
  the old routes under `/api/aml/` stay retired). Kinds: suspicion (to the
  NCA, a SAR), sanctions (OFSI), PSC or overseas entities register
  discrepancy (Companies House), trust register discrepancy (HMRC),
  unregistered agent (HMRC). BGP staff raise a suspicion, a sanctions concern
  or an unregistered agent (`POST /api/aml-register`); only the Nominated
  Officer and the Deputy (admins while no Nominated Officer is set) read the
  register and record the outcome (`GET`, `PATCH /api/aml-register/:id`):
  reported or not and why, the authority's reference and date, for a
  suspicion the further information asked, senior management, the consent
  (DAML) request and the NCA's answer (`damlDates`: seven working days from
  the first working day after the request, England and Wales bank holidays
  to 2028 in `ENGLAND_BANK_HOLIDAYS`, add the next year's from GOV.UK; a
  refusal's 31-day moratorium), for sanctions the funds held, legal advice
  (needed before "continued") and what BGP did. The person who raised an
  entry sees only that it reached the officers (`reporterView`). Tipping
  off: no `kyc_audit_log` line is written for an entry (every BGP login reads
  the KYC history), and the officers' email (`amlRegisterNoticeEmail`) says
  only that a report is waiting. Screens (`client/src/components/aml-register.tsx`):
  **Report to the Nominated Officer** on the AML dashboard and at the foot of
  every deal's AML box; **Tell the Nominated Officer** / **Record an OFSI
  report** beside a sanctions red flag; the **Reports** pill of the AML
  dashboard for the officers.
- **No hold on a deal while the NCA decides** (Woody, 2026-11-20: "no dont
  hold a deal"; do not build one). Every status door skips the AML gate
  when the officer's "AML check: YES" is on the deal, so a hold would have
  meant changing about eight doors. The officers tell the team.
- **Training** (`server/aml-training.ts`; the old `aml_training_records` table
  with `title`, `provider`, `recorded_by`, `batch_id`). Each person confirms
  **I have read it** for the current policy on My BGP → **AML training**
  (once per issue, `CURRENT_POLICY_READ_TITLE`); the officers and admins see
  everyone on the AML dashboard's **Training** pill (nothing in a year, policy
  not confirmed) and **Record training** for one or many people (title,
  formal or informal, date, the policy's five topics). The old online modules
  and quiz (`aml_training_modules`) are not brought back: they teach rules
  Issue 2 replaced.
- **Agents and HMRC's register** (`server/agent-aml.ts`, table
  `agent_aml_supervision`; `server/hmrc-register.ts`). HMRC publishes the
  Supervised Business Register as one ODS file on GOV.UK whose address
  changes: the GOV.UK content API names it; it is read as a stream (about 3
  seconds, 24,500 estate and letting agency rows kept of 68,000; reading it
  whole took 1.2 GB) on the first check after a start and kept seven days.
  **Check** on an agent firm's Overview (**AML supervision**) or in a deal's
  AML box (**Agents on this deal**: the joint, seller's, buyer's, letting and
  acquiring agents) searches it by name (`registerMatches`) and records the
  entry, Not on the register (how it was checked), or a professional body,
  and whether an agreement says who does the client due diligence. Required
  (amber until done) for every joint agent since 22 November 2026 (HMRC:
  agents who work together check each other; until then only one BGP shares
  the fee with, `joint_agent_fee_pct`); for the other agents it is the
  policy's counterparty question. HMRC's Expired status reads as not registered, and a
  check is due again after a year. An unregistered agent offers **Tell the
  Nominated Officer** (the register's unregistered agent kind).
- **The EU consolidated list** (`server/sanctions-screening.ts`,
  `parseEuSanctionsCsv`, `EU_SANCTIONS_CSV_URL` moves it): the EU's Financial
  Sanctions Files CSV, about 6,300 entities and 24,600 names, screened beside
  the UK and US lists in BGP's checks before asking and named as itself
  (`sanctionsListName`, never the UK/US two-way label).
  **A list that fails to download** keeps the copy held before, and all
  three are tried again within 15 minutes, not a day (`retrySoon` in
  `server/sanctions-screening.ts`; found on 22 November 2026, when the US
  list failed after a restart and a run screened the UK and EU lists only).
  A run without the UK list is not a clear screen: its Sanctions line is
  amber ("The UK Sanctions List could not be downloaded: run the checks
  again") and the AML box's Screening step reads "Sanctions lists not read:
  run again", as it does when no list could be read ("Sanctions: not
  screened", which until then read as Clear). Tests: `server/aml-records.test.ts`,
  `server/kyc-prechecks.test.ts`.
- **The Register of Overseas Entities** (in `runPrecheck`): a company party
  with no UK number is searched by name (`searchOverseasEntities`: the
  advanced search filtered to the register's type, else the ordinary
  search); exactly one entity of that exact name (`pickOverseasEntity`,
  `overseasNameKey`) is read as the company, so its managing officers and
  registered beneficial owners are screened. A beneficial owner the entity
  declared sanctioned (`is_sanctioned`) is a sanctions red flag; a company
  whose name has a foreign legal form and no entity found is the factor
  `overseas_entity_missing` (set aside where the deal needs none). An overseas
  entity still owes its home register's extract (`askInputFrom`). A busy
  Companies House leaves the check unfinished.
- **Five-year deletion** (`server/aml-records-retention.ts`, log table
  `aml_deletion_log`): the officers only, never at boot or on a timer.
  **Preview what is due** (the Records pill) lists: a party whose latest AML
  record is over five years old and every deal it was on ended over five
  years ago (none live, no open register entry: `partyRetention`); a closed
  deal's AML fields five years after it ended; expired rows of
  `aml_retention_archive`; training records and closed register entries over
  five years old. Apply takes the ticked ids of the same officer's preview
  within the hour, with DELETE typed; each item is checked again and deleted
  in its own transaction: a party's documents and their stored files, checks,
  client check requests and uploads, Veriff sessions, KYC4U rows and drafts,
  flags set aside, Not required marks, KYC history, company-that-signs
  records and re-check reminders, with the company's and its companies'
  AML fields set back to their defaults (the company record stays); a deal's
  AML fields and its AML history lines (the deal stays). The log holds
  counts, never names. KYC4U keeps its own records: its next sync may copy
  back what it still holds. Tried end to end against a copy of the app's
  schema on 19 November 2026; on live nothing is five years old yet.
- Also: the deal save's AML gate now passes the deal id, so a party marked
  Not required is honoured there too.
- Not built: a deal hold (not wanted, above); deleting the KYC4U list's own rows at
  KYC4U; the FCA register for simplified due diligence; trusts' own TRS
  check.

## Company checks joined to the AML, and asset managers on a property (Woody, 2026-11-23)

Woody, on TPG Angelo Gordon's People & checks: "can we add some links to
these ie in review takes to that AML.. Are these all linked to the AML? ...
im not sure what this Platforms wealth thing is? and the Review account
entity? ... why hasnt it picked up Anegleo Gordon europe LLP? ... a biut
messy and different fonts"; then on Millennium Bridge House: "beltane is the
assset manager and TPG are the actual owners / freeholders".

- **Group entities link to the AML.** `getAccountEntities`
  (`server/account-entities.ts`) gives each entity `registeredName` (a
  company's Companies House name) and `transactions`: the transactions it is
  checked on (a trading entity where it is the company that signs, a company
  where it is the party with no company that signs set; not withdrawn or
  archived; at most 8; a failed read leaves them out). The panel
  (`client/src/components/account-entities-panel.tsx`) shows **AML on …**
  under each row (`EntityTransactions`, each opening the transaction's
  Parties & AML) and the window lists them with **Open its AML**, with "In
  review since …" or "Not checked yet". The account's own row reads its
  Companies House name with "this account" (it read "Review account entity").
  The statuses were always the same records the transaction's AML box writes;
  the panel's own Approve and Reject only show while the retired in-app AML
  is on.
- **A registered entity read from a website menu.** The scraper
  (`scrapeUkEntityFromWebsite` in `server/companies-house.ts`) took tpg.com's
  menu ("Platforms Wealth Solutions News & Insights About LP") as a company,
  and the boot backfill in `server/index.ts` copies every brand's
  `uk_entity_name` into its trading entities. `looksLikeSiteMenu` in
  `shared/brand-compliance-status.ts` (three or more menu words, at least
  half the name) now refuses such a name in the scraper's patterns, its
  fallback and its AI read. `brandComplianceStatus` says the name was read
  from a website menu and gives `useRegistered`: the Legal entity needs
  review note offers **Use <Companies House name>** (the entity save). A
  trading entity with no number whose name reads as a menu says so in Group
  entities and has **Remove** (`DELETE /api/crm/trading-entities/:id`, which
  refuses while anything points at it). Fixing TPG Angelo Gordon on live is
  those two presses: changing live records directly from a build machine was
  refused.
- **The card's order and headings.** On the landlord card, Show more is:
  registered entity, company records, the review note, covenant, Billing,
  then KYC4U's past checks at the foot (the separate link at its top is
  gone; `BrandComplianceCard` leaves the strip to the landlord card). Billing
  takes the other sections' heading style. Group entities sat between the
  covenant and Billing until 24 November 2026, when they became their own
  Companies and KYC card under it (see "Client KYC with no transaction").
- **Asset manager on a property.** The property's ownership pills had an
  Asset manager role (`crm_properties.asset_manager_id`) behind "+ Owner or
  lender"; the button now reads **Owner, lender or asset manager** while that
  role is empty, and a role pointing at a company since deleted reads as
  empty (Millennium Bridge House showed "Freeholder + Add" for one). On live,
  Millennium Bridge House was set as Woody asked: Owner and Freeholder TPG
  Angelo Gordon, Asset manager Beltane Asset Management.
- Tests: `qa/regression/brand-compliance-status.test.mjs`,
  `landlord-company-checks.test.mjs`, `brand-compliance-ui.test.mjs`,
  `server/account-entities.test.ts`. Checked in a browser against a local copy
  shaped like TPG Angelo Gordon on 23 November 2026.

## Client KYC with no transaction, and every company under a client (Woody, 2026-11-24)

Woody asked whether a client can be KYC'd when no transaction exists (a leasing
or sale instruction, advice on a purchase, a tenant BGP acts for to find
sites), then: "Yes build it within companies and show in the CRM boards and we
will want to be able to aml all the sub companies within each company, tenants
have lots of spv when taking leases as example and some landlords have lots of
spvs to own buildings so we need to be able to aml as many sub companies as we
can and use those for xero invoicing too". Do not re-litigate. Rules:
`shared/client-kyc.ts`; server: `server/client-kyc.ts`; box:
`client/src/components/client-kyc/client-kyc-dialog.tsx`; addresses:
`client/src/lib/aml-scope.tsx`. Tests: `server/client-kyc.test.ts` (in
`npm test`), `qa/regression/client-kyc-guards.test.mjs`.

- **A client file** is one subject: a company filed under an account
  (`crm_trading_entities`, an SPV), or the account's own record when it is a
  private individual, trust or UK public body (`recordIsOwnSubject`). An
  ordinary company's checks are always about a company filed under it, as on a
  transaction. Kept in `kyc_client_files` (boot migration: the company, the sub
  company, what BGP is instructed on (`CLIENT_INSTRUCTIONS`: letting, sale,
  purchase, tenant_rep, other), who to ask, who opened it, closed when signed
  off). One open file per company and sub company.
- **The same steps and code as a transaction party**, with no transaction
  (`dealId` null, role "client", `AmlSubject` in `server/deal-party-aml.ts`):
  BGP's checks before asking (`startPrecheck`), the client checks and people to
  check (the requests in `kyc_upload_tokens` with `deal_id` NULL for that
  company and sub company; `deal_id` and `kyc_upload_files.deal_id` became
  nullable), upload documents, translation, owners abroad, verified from public
  sources and certified documents, red flags and set-aside
  (`loadDealRedFlags(null, ...)`), and the sign-off rules (`signOffFacts`,
  `signOffDenial`). The routes are the transaction ones registered on a second
  path, `/api/client-kyc/:companyId/subjects/:entity/...` (`:entity` a sub
  company's id or `self`), outside the retired `/api/kyc/` and `/api/aml/`
  prefixes; BGP staff signed in as themselves. In the emails and on the
  client's page the work reads "our instruction from <account>"
  (`clientFileName`), the agents copied are the account's BGP people
  (`bgp_contact_user_ids`), the email's link opens the company page at People &
  checks, and reminders chase it as they chase a live transaction.
- **The sign-off** (`POST /api/client-kyc/:companyId/subjects/:entity/sign-off`):
  the officers, or one of the account's own BGP people on a standard or
  simplified file (as an agent on a transaction). It writes the approval every
  transaction reads (`approveEntityKyc` for a sub company, `approveBrand` for
  the record itself) for the policy's period (3 years, 1 if enhanced), always
  as the full checks (`regime: "full"`), re-derives the transactions that carry
  it, and closes the file. So a transaction with that company is cleared until
  its re-check date.
- **Many sub companies at once**: `POST /api/client-kyc/:companyId/checks
  { entityIds }` queues BGP's checks on up to 60 (`CLIENT_KYC_BULK_MAX`), run
  one at a time within the day's allowance (`KYC_PRECHECK_DAILY_CAP`); those
  left when it is used say so and are run again by a person. The queue is in
  memory (`GET .../checks` reads it): a restart loses the waiting ones.
- **Xero**: `POST /api/billing-entities/:entityId/xero` (BGP staff) finds or
  makes the sub company's Xero contact and keeps it on the company
  (`xero_contact_id`), so a transaction it signs bills it (the existing
  invoice rule).
- **Screens**: the Group entities panel is now **Companies and KYC**
  (`account-entities-panel.tsx`, BGP staff only), its own card: under the
  contacts and company checks on a landlord's People & checks (it was behind
  the company checks card's Show more; that embedded copy is gone), in the
  people column on a brand's page, and on the phone under a landlord's
  Compliance pill and a brand's company checks (`mobile-brand-view.tsx`).
  A company filed under the account reads **Sub company** (a person: Person;
  one registered abroad: Registered abroad). Each company's
  client KYC in one line (`ClientKycLine`: checks run, client checks, what BGP
  is instructed on, Xero), **KYC** opens the box, **Select** then **Run BGP's
  checks** or **Link to Xero** on the ticked ones, **Add a company** (the billing
  entity dialog, no Xero contact), and **Add to check** on the account's own
  registered company when it is not yet filed as one. A brand with no company
  filed shows one line with Add a company. The box
  (`ClientKycDialog`) has the transaction box's four steps (the company,
  screening, documents, sign-off) and a Next line (`clientKycNextStep`); the
  client checks, people and documents are the transaction components, pointed
  at the client file through `AmlUrlsProvider`.
- **Owners abroad on a client file** (Woody, 25 November 2026, on Federated
  Hermes Limited, owned through Federated Hermes, Inc. in the United States:
  "suggesting find them on owners abroad but there isnt anywhere to do it on
  this form"). The client window's first step (The company) now has the
  transaction box's **Owners abroad** section (`ClientFileAbroad`, `AbroadTrace`
  from `aml-abroad.tsx`): what was traced, and Add its register page, Add a
  register extract, Record a person behind it, Add a note, Add a structure
  chart. It is drawn inside the client file's `AmlUrlsProvider`, and the
  section's reads and saves take their address from it (`urls.party`), so they
  reach the client file's routes in `server/kyc-abroad.ts`, which already
  answered on `/api/client-kyc/:companyId/subjects/:entity/abroad`. The hint
  under People reads "Record them under Owners abroad, in The company (step
  1)", and the basis words say BGP's officers find the people behind a company
  abroad (they still named KYC4U). Still to find no longer offers "a Creditsafe
  report" (`abroadStatus`): BGP has no Creditsafe.
- **CRM boards**: each Landlords, Brands, Agents and Lenders row carries
  `kyc` (`server/crm-hub.ts`, `clientKycSummary`, `clientKycWords`): a chip
  (KYC cleared, KYC due soon, KYC 2 of 5, KYC in progress, KYC expired, KYC
  rejected) drawn in the company cell, left out when no company is filed or
  started; the **KYC to do** filter lists rows with a company not yet cleared.
  A sanctions-only approval does not count as cleared for a client.
- Not built: client files on the AML board (Transactions → AML lists
  transactions only), the AML file for a client file, a check of the daily
  allowance before queuing, and persisting the bulk queue.

## The Companies view on Transactions → AML (Woody, 2026-11-24)

Woody: "We need a dashboard so it's easy to search and add a company ...
Should auto populate with all the companies we have in the transactions list
both brands and landlords ... we then should be able to add transactions
within companies that link the 2", "if we put the top company in ... a
suggestion of sub companies or linked companies? Not exhaustive but helpful
prompts", "We don't want to do full aml though on smaller tenants ... Maybe
just needs a switch to turn on sanctions only or off?", then, shown a mock-up,
"Can we delete too select and delete / We also want the deals / transactions
to also be in there so we can aml the transactions too as we currently do /
Ok go ahead". Do not re-litigate. Rules: `shared/kyc-companies.ts`,
`shared/kyc-suggestions.ts`; reads: `server/kyc-companies.ts`,
`server/kyc-suggestions.ts`; screens:
`client/src/components/kyc-companies/companies-view.tsx`,
`client/src/components/kyc-companies/suggested-companies.tsx`. Tests:
`server/kyc-companies.test.ts` (in `npm test`),
`qa/regression/kyc-companies-guards.test.mjs`.

- **The page**: the AML page's first pill is now **Transactions** (key
  `checks`, it read Checks), and **Companies** (`?section=companies`) is
  beside it. `GET /api/aml-dashboard/companies` (`loadKycCompanies`, BGP staff
  signed in as themselves): one row per company, every party company on the
  AML board's own rows (`loadAmlDashboard`, so the same transactions) plus any
  company added there (`crm_companies.kyc_listed_at`, boot migration) or with
  a client file open; merged and hidden companies left out. Each row: the
  contracting entities (the CRM chip's own read: sub companies and the record
  itself when a person, trust or public body), the KYC chip
  (`kycCompanyChip`: "Not started" with no entity, else the CRM chip's words),
  its transactions (each with the board's AML stage), people (private
  mailbox left out) and agents (current tenant reps, the agent on an open
  requirement, each transaction's side agent), the sanctions-only switch, the
  Next line (`kycCompanyNext`) and KYC4U's past checks (folder count and the
  latest date). Filters `KYC_COMPANY_FILTERS` with counts, one search
  (`kycCompanyMatchesSearch`: company, website, entities and numbers,
  transactions and Refs, agents, people).
- **A company opens** (`CompanyKycWindow`): the company page's own
  **Companies and KYC** card (`AccountEntitiesPanel`: never a second copy),
  the checks setting, its transactions (each **AML** opens `DealAmlDialog`,
  the transaction's own box) with **Add a transaction** (`/deals?new=1&
  landlordId=` or `tenantId=`: New Transaction starts with it filled in,
  `prefill` on `DealFormDialog`, cleared on close), people and agents, and
  `Kyc4uStatusStrip` (KYC4U's past checks; admins record a past sign-off
  there).
- **Add a company**: `GET /api/aml-dashboard/companies/search` (the CRM by
  name or website), `POST …/companies/list { companyId }`; not in the CRM,
  it is made there first (`POST /api/crm/companies` as Landlord or Tenant):
  the one way a company is added.
- **Sanctions only on a company** (`crm_companies.kyc_sanctions_only`, boot
  migration; `PUT /api/aml-dashboard/companies/:id/sanctions-only { on: true
  | false | null }`, a KYC history line): null is worked out
  (`kycSanctionsOnly`: every board transaction a letting under £10,000 a
  month, by `amlRegime`); a trust never. A client file reads it
  (`companySanctionsOnly`, `regime` on the subject): three steps, no client
  checks, and a sign-off recorded as sanctions-only, so it clears small
  lettings only. A transaction still decides its own checks from its rent.
- **Suggested companies** (Companies and KYC card → **Suggest the group's
  companies**; `GET /api/client-kyc/:companyId/suggestions`, BGP staff, read
  only when pressed, kept six hours per company and read again when a
  company is filed): Companies House (the top company's current officers'
  other appointments, corporate officers first; a search by the start of its
  name, `nameStems`, a stem of at least five letters; each strong
  candidate's persons with significant control, owned by the company, one
  filed under it, or one level down another candidate so owned), Land
  Registry's lists in the app (titles under a name that starts the same way,
  a range on the name index then the exact prefix) and GLEIF (the LEI's
  direct children). `rankSuggestions` merges them by number, leaves out the
  company, what is filed and dissolved companies, and keeps only what has a
  tie (a name alone, or one shared director alone, is never suggested); each
  has its reasons ("Owned or controlled by …", "Shares a director, …", "Owns
  N titles in England and Wales", "Its name starts like the company's").
  Ticked ones are filed through `POST /api/billing-entities` (`xero: false`;
  abroad by name and country). Nothing is checked until someone presses KYC.
- **The account's own legal company** (24 November 2026, from screenshots:
  Land Securities Group PLC offered "Add to check" though it was filed under
  Landsec, and its sub companies read "No KYC" beside "Checked 24 Nov"). A
  sub company with the account's own Companies House number is folded into
  the account's row on the card (`tradingEntityId` on `GroupEntity`), which
  then carries its client KYC, its KYC button and the transactions it signs.
  Its KYC is its own record; with none, the account's decision (approved or
  rejected, with a sanctions-only approval said so), never a bare "in review"
  the retired screening left: one reading for the card, the Companies view
  and the CRM chip (`subCompanyKycSql`, `subCompanyScope` in
  `shared/client-kyc.ts`), as a transaction reads it. A sub company with
  checks, a file or a request under way reads "In progress", not "No KYC".
  The add search counts an open client file as on the view.
- **Select and delete**: admins on the view (`CrmSelectBar kind="kyc"`, the
  CRM lists' bulk delete and its rules); on the Companies and KYC card,
  **Select** then **Delete** for sub companies (`DELETE
  /api/crm/trading-entities/:id`, which now also refuses one that signs, pays
  or guarantees a transaction or has AML records: its old guard read the
  Xero contact columns, which never hold an entity id).
- **One word**: a KYC that is done reads **Cleared** on the card as on the
  CRM chip and the view (it read "KYC approved").
- **KYC4U's past checks** (Woody, the same day: "the closed deals not checked
  have they been scanned and looked at being linked to all the KYC4U AMLS we
  have?"). Read on live on 24 November 2026: 284 parties (165 companies)
  were Closed, not checked; the app held KYC4U's 482 request folders but no
  verdicts (the folder import read no status table) and no files (the kept
  store was empty); 41 of those companies had a folder linked, 16 a folder
  that looked like theirs but unlinked (Hammerson PLC, Canary Wharf Retail),
  3 sat on duplicate CRM records (Sephora T1, Starbucks Hays, Sushi Tachi
  T2), 105 had none (BGP's landlord clients: Landsec, The Crown Estate, The
  Portman Estate). So a company with KYC4U folders and no result reads "KYC4U
  checked it · record their result" first (`kycCompanyNext` with `kyc4u`),
  and the KYC4U grid (Subscriptions & APIs → KYC4U) has **Not matched** and
  **Match** on each request (`MatchToCompany`, the existing hand-set PATCH).
  KYC4U's verdicts come in only through the bookmark on their status page or
  an admin's **Record a past KYC4U sign-off**: nothing guesses them.
- **A KYC4U check shows on every company it names** (Woody, 25 November 2026,
  on Sheet Anchor Evolve (London) Ltd: "these guys should have been KYC4U but
  saying there isn't one"). KYC4U's REQ103894, "SHEET ANCHOR EVOLVE LONDON
  LIMITED", was read in on 21 November, before that record was added
  (24 November), so the matcher took the short name "Sheet Anchor" and filed
  it on the parent's record; the company's window said KYC4U held no check.
  It was moved by hand on live (Match, 25 November). The strip (`GET
  /api/kyc4u/company/:id`) and the Companies view's count now also take every
  request that names one of the record's registered companies (its own
  registered name, its Companies House name, the companies filed under it),
  wherever it was filed: the request's entity, or a folder inside it named
  for a company with a legal form (KYC4U files each company up the chain in
  its own folder). Every word is kept and only the legal form is set aside
  (`legalNameKey`): never a display name, never a shortened name. A request
  filed elsewhere reads "Names this company; filed on <record>". Rules
  `shared/kyc4u-names.ts`, read `server/kyc4u-named.ts`; tests
  `server/kyc4u-names.test.ts`, `qa/regression/kyc4u-named-and-client-abroad.test.mjs`.
  Nothing re-runs the matcher when a company is added; Match on the KYC4U grid
  moves a request by hand. The strip's chip shows a folder's file count only
  (its folder names ran off the window's edge and hid the request), and the
  company window draws the heading once (`Kyc4uStatusStrip bare`).
- Not built: a lender's or agent's own KYC row; the CRM duplicate records
  merged by themselves (Sephora T1 and the like: the CRM merge is a person's).

## Ownership & KYC on the property page, and the full checks on a small letting (Woody, 2026-11-23)

Woody: "on the property boards details news should be folded into news and
social. delete property intelligence. the investment board tab lets sit that
next to BGP take. then rename details to ownership and KYC that should be
linked to Landreg and flow up to the tabs at the top ... and then als linked
to our AML stuff", then "the landreg search should really feed the inital KYC.
We dont need to KYC every building but have the option to from there? then we
can set a builidng up and AML / KUYC the client from there when we get an
instruction", and on AG Hondo Brixton Village BV: "is approved KYC for deals
under £10k sanction only needs to be clear here and option to start full KYC".
Do not re-litigate. Rules: `shared/property-ownership.ts`; reads and actions:
`server/property-ownership.ts`; card:
`client/src/components/property-page/ownership-card.tsx`. Tests:
`server/property-ownership.test.ts` (in `npm test`), cases in
`server/deal-parties.test.ts`, `qa/regression/property-ownership-guards.test.mjs`.

- **The plan-led page's tabs**: Details is **Ownership & KYC** (still admins
  only, as Details was; test id `property-tab-details`). Its news card is gone
  (the news is under **News & social** in the intro row); **Investment** is a
  pill beside **BGP take** in the intro row's left card when the property has
  investment work (`hasInvestment`), and is off the tab. **Property
  intelligence** is deleted from the property page, both layouts (its Land
  Registry and planning tools stay on Property Intelligence's own page; the
  **Land Registry search** link on the card opens it with the postcode). The
  classic page's KYC section leads with the same Ownership card.
- **Who owns the building** (`GET /api/properties/:id/ownership`, BGP staff
  signed in as themselves): Land Registry's company ownership lists loaded in
  the app (`hmlr_proprietors`, CCOD and OCOD; never PropertyData, which charges
  per title) for the building's postcode, each title kept when its address
  holds the building's number on its street, or its name (`titleFit`,
  `addressNumberAndStreet`), with the title on the property's record first; with
  none, the postcode's other titles fold under a Show line. Each registered
  owner is matched to the CRM (`sameRegisteredCompany`: the number, else the
  registered name): filed under the property's Owner, the Owner itself, another
  CRM company, or filed under another account. The card says when the lists
  were loaded and when the monthly update last failed (live: 4.55 million rows;
  the June 2026 refresh failed because the Land Registry licence was not signed).
  A building owned by a person is not in those lists.
- **The lists update by themselves** (Woody, 24 November 2026, once both
  licences were agreed on use-land-property-data.service.gov.uk and the
  `HMLR_API_KEY` on Railway checked: "we dont need a button just auto").
  Rules `shared/hmlr-update.ts`, run `autoUpdateHmlrDatasets` in
  `server/hmlr-fetch.ts`, job `hmlr-datasets` (00:20 London, production
  only), tests `server/hmlr-update.test.ts` (in `npm test`). Each night, for
  OCOD then CCOD, one request for the newest full file; a load only when no
  finished load (`hmlr_ingest_runs`, status ok) took that file, so about once
  a month per list, when HM Land Registry publishes. After a load that read
  the whole list (a full file, and at least nine in ten of the titles held
  before), the owner rows that load did not touch are deleted
  (`ingest_run_id`), so a title sold on to a person or a second owner taken
  off stops showing; the count goes in the run's notes. A load left
  "running" over six hours by a restart is closed as interrupted, so the next
  night tries again, and one list loads at a time (the admin
  `POST /api/admin/hmlr/sync` included). `HMLR_AUTO_UPDATE=off` stops it.
  There is no button. The May 2026 loads read every row and then stopped at
  the file's closing "Row Count" line (fixed in September:
  `relax_column_count_less`, and a row with no owner is skipped), so live had
  no finished load and the card read "has not loaded since 22 Jun 2026".
  **Each night's outcome is kept** (25 November 2026: the first night, 24 to
  25 November, left no run and no trace, because a failure before a load
  writes no run row and went only to the log): `autoUpdateHmlrDatasets` saves
  every outcome, a list switched off or no API key included, in
  `system_settings` `hmlr-datasets:last` (`{ at, results }`: per list loaded,
  up to date, busy, failed with HM Land Registry's own words, or off), and
  `GET /api/admin/hmlr/runs` (admins) returns it as `lastAuto` beside the runs
  and each run's notes. Read that first when the lists look stale.
- **Use this owner** (`POST …/ownership/use { titleNumber, dataset, position }`):
  the owner is read again from the lists on the server, never from the request
  (`titleUsePlan`): the title goes on the property (`title_number`,
  `proprietor_*`, `title_search_date`); an empty Owner is set to the CRM company
  that is it, else a new one (type Landlord); an empty Freeholder (freehold
  title) or Long leaseholder (leasehold title) is set to the Owner; and the
  company is filed under the Owner (`insertTradingEntity`, Companies House's
  name when it answers; a company Companies House shows closed is refused). The
  pills at the top follow. A role a person set is never changed. One line in
  `investment_comp_migration_log` (batch `property-ownership`).
- **KYC only when asked** (superseded on 24 November 2026: the checks start
  by themselves once Use files a company, see the Touchwood bullets below):
  **Run checks** (`POST …/ownership/check { entityId, again }`) ran BGP's
  checks before asking on a company filed under the building's Owner
  (`startPrecheck(owner, { entityId })`), the same record a transaction's AML
  box reads. Nothing checks a building that nobody set up.
- **Feeding the AML box**: on a transaction at the building, the landlord's or
  seller's party offers the building's registered owner (`landRegistryOwnerOf`
  in `server/deal-parties.ts`, from the property's stored title): a company
  filed under the brand with that number or name is the first offer (`why:
  "land_registry"`, `registeredOwnerAmong`, `companyOffer`), else
  **titleOwner** ("Use it": added under the brand from Companies House, no
  Xero), and the brand's own registered company is marked when it is the
  owner. Always a press, never set by itself.
- **AML on transactions here**: the AML board's own rows for the building
  (`GET /api/aml-dashboard?propertyId=`, `loadAmlDashboard` with
  `propertyId`), each transaction's parties with their stage, Late and red
  flags, and **Open AML** (the property's AML window).
- **A sanctions-only approval says so**: Group entities reads the sign-off's
  regime (`entitySignOffScope` in `server/account-entities.ts`, `kyc.scope`)
  and shows **Sanctions only · under £10k a month** instead of KYC approved,
  with **Start full KYC** on the row and in its window
  (`/deals/<id>?section=parties&full=<role>`).
- **The full checks on a small letting**: **Show the full checks** (or the
  `full` address parameter) now runs the full steps on a letting under £10,000
  a month (client checks, owners, `sanctionsOnly` off in the box), and a
  sanctions-only approval there is not taken as the full checks. **Sign off the
  full checks** posts `full: true`; `loadAmlParty(…, { full: true })` reads the
  party as needing the full checks (`fullOnSmall`), the ordinary sign-off rules
  apply, and the approval is recorded as full, so it covers a sale or a bigger
  letting for three years. The status sends `decisions.parties[id].full` and
  `approvalScope` for it.
- Also the same day: a People row's role pill ("Agent at a viewing") gives
  way before the name does (`people-board.tsx`).
- **Touchwood (Woody, 24 November 2026)**: "picked up the long leasehold
  interest but not the freehold for some reason but I think this KYC board is
  old? it hasnt auto started the check on the long leaseholder?". Do not
  re-litigate.
  - **Why the freehold was missed**: the card read only the building's
    postcode (B91 3GJ) and its title on record (WM757813, the head lease held
    by the two ASF UK Touchwood trustees, registered abroad). A big site's
    freehold is often registered at another address or with no postcode
    (Solihull Council's 2015 compulsory purchase papers say the Council holds
    the freehold of much of Touchwood), and the Land Registry boundary map
    that would pin it by location (INSPIRE) is not loaded for Solihull (an
    attempt on four councils in June 2026 never finished). So, with no
    freehold among the building's titles, the feed now also reads freeholds
    naming the building (its own words, `buildingSearchTerm`: "touchwood")
    in its town or postcode district, and freeholds on its street
    (`unnumberedStreet`: "Homer Road"), each by the trigram index on the
    address (`titlesBeyondPostcode`), listed for a person to pick
    (`freeholds`, fits "elsewhere" and "street"); and `GET
    /api/properties/:id/ownership?title=WM123456` looks up a title number a
    person typed (`typed`), from the long lease's register. Nothing is set by
    itself.
  - **Leases of units are tenants'** (`isUnitLease`: a unit, shop, kiosk,
    suite, flat or floor): listed apart under Show N leases of units here, no
    actions, never offered as the building's Long leaseholder (until then
    Touchwood's shops were offered Set as long leaseholder). The building's
    titles list freeholds first.
  - **A freehold on a building held on a long lease is the Freeholder's**
    (found in the local check of the fix): with a Long leaseholder set, Use on
    a freehold title not on the record is **Set as freeholder** (`kind:
    "freeholder"`): it sets the empty Freeholder pill and files the company
    under it, keeps the head lease on the record and leaves the Owner alone.
    Before, it would have recorded the council's freehold in place of the head
    lease and made the council the Owner.
  - **The Long leaseholder's KYC**: a head lease's owner is filed under the
    Long leaseholder for the AML, as a freehold's is under the Owner
    (`accountFor`, `fileUnder`: a UK number, or the overseas list's country,
    so BGP's checks look for it abroad). Set as long leaseholder sets the
    empty pill and files the company; File it for the AML files a co-owner or
    one already set. A filed company shows its KYC and a **KYC** button that
    opens the shared client KYC window (one build); the card's own checks
    line and `POST .../ownership/check` were removed.
  - **BGP's checks start by themselves** when Use files a company for the AML
    (Woody, 24 November 2026: yes to "should checks start by themselves when
    you set a building's owner, rather than when someone presses KYC?";
    supersedes his "only when someone presses" of 23 November): after the
    transaction commits, `useLandRegistryOwner` calls `startPrecheck(account,
    { entityId })` on the company it filed, within the day's allowance
    (`KYC_PRECHECK_DAILY_CAP`), and the toast says what happened
    (`ownershipChecksWords`: started, already running, checked in the last 30
    days, waiting for tomorrow's allowance). The button's words say so ("...
    for the AML and starts BGP's checks"). A company filed before then starts
    its checks when its KYC window opens, as before.
  - **A street named after the building is not the building**
    (`addressNamesBuilding`, 24 November 2026: live Touchwood listed
    "garages at Touchwood Hall Close"): the building's name counts only where
    the part of the address it is in does not go on, within three words, to a
    street's name (Close, Road, Street, Lane, Avenue and the like). On live
    the wider search found the council's freehold the same day: WM937485,
    "Land on the north side of Poplar Arcade, Touchwood Centre", the
    Metropolitan Borough of Solihull, listed for a person to pick.
  - **The old KYC card**: BGP staff get the shared Companies and KYC card
    (`AccountEntitiesPanel`, with `label`) for the Owner, Freeholder and Long
    leaseholder (`PropertyOwnersKyc`) in place of the older company checks
    card (`PropertyComplianceBoardWrapper`: UK trading entity, downstream
    checks parked, the property's billing entity), which stays for client
    logins only. The property's billing entity field invoices nothing (a
    transaction bills its party's billing entity) and is no longer shown to
    staff here.
  - Tests: `server/property-ownership.test.ts`,
    `qa/regression/property-ownership-guards.test.mjs`. Not run against the
    live Land Registry lists from a build machine: whether Touchwood's
    freehold names Touchwood is first seen on live.
- Not built: a building-level sign-off with no transaction; reading the
  freeholder chain (`findFreeholderChain`) on the card; loading the Land
  Registry boundary map (INSPIRE, about 5.4 GB) for every council.

## Setting up a new property (Woody, 2026-11-23)

Woody: "when we set up a new property should ask before its set up some basic
questions I think? correct address? then documents where do we want the files
options are existing folder with a pop out to the BGP share drive and ability
to go in and pick a folder. or create new folder tree. Add joint agent and
tenancy schedule or areas schedule for marketing and add brochure and add
plans". Rules: `shared/property-setup.ts`; dialog:
`client/src/components/property-page/property-setup.tsx`. Tests:
`server/property-setup.test.ts` (in `npm test`),
`qa/regression/property-setup-guards.test.mjs`. **Since 24 November 2026 the
Files step uses the folder engine** ("Folders: one engine" below:
`record-folder-picker.tsx`, `/api/folders/`); the folder tree route
(`server/property-setup.ts`) and `sharepoint-folder-picker.tsx` are deleted, so
the Files bullet below is how it worked before.

- **When it opens**: after **Add property** on the Properties page saves a new
  property (or merges into one the address found), the property opens at
  `?setup=1` (taken off the address when the dialog closes); and from the
  property page's More menu, **Set up this property**. BGP staff only (the
  dialog is not mounted for a client login). A name read as a unit of an
  estate makes no new property, so nothing opens.
- **Seven steps, in Woody's order, each skippable** (`SETUP_STEPS`), each
  saving through the route the page already uses: **Address** (Correct, or
  Change it with the address search: the property save); **Owner** (the
  Ownership card from Ownership & KYC, without its AML list); **Files**;
  **Joint agent** (the facts pill's editor); **Schedule** (a tenancy or areas
  schedule in Excel, read by the tenancy schedule import); **Brochure** (the
  brochures panel); **Plans** (Upload plan, cropped then scanned).
- **Files**: **Pick an existing folder** opens the BGP Share Drive
  (`ShareDriveFolderPicker`: the BGP site's documents, stepping into
  "BGP - Share Drive", folders only, on the person's own Microsoft 365
  connection, `GET /api/microsoft/files`) and links the folder picked
  (`sharepoint_folder_url`, which the Folders button opens). **Create a new
  folder tree**: choose the folders to make (the team templates of Set Up
  Folders, `GET /api/microsoft/folder-templates`), pick where, and `POST
  /api/properties/:id/folders/tree { driveId, parentId, structure }` (BGP
  staff signed in as themselves, their own Microsoft token) makes a folder
  named after the property inside the folder picked, then the template's
  folders inside it (a folder already there is reused), and links the
  property to it when the address is on BGP's own SharePoint
  (`bgpSharePointUrl`). The template is checked first (`folderTreePaths`: at
  most 80 folders, four deep, names SharePoint takes). The older Set Up
  Folders (a fixed place under the team's folder) is unchanged.
- Also fixed: Add property's merge into an existing property sent a PATCH,
  which the server has no route for, so it failed; it sends a PUT.
- Not built: templates under the current team names (they are the old
  ones: London F&B, London Retail, National Leasing and others); a client
  login's own set-up.

## Companies registered abroad, all in the app (Woody, 2026-11-23)

Woody, asked how overseas companies are checked: "Credit safe said no so we are
on our own! Need to do everything in the app?", then of Dun & Bradstreet "No
don't have that either" and "No external [providers] to all happen in the app
including translation". Do not re-litigate. HMRC (AMLG11400 14.6, read on
23 November 2026): "For a non-UK based company, you must obtain an excerpt of
the register kept under the law to which that business is subject", and "if
you, or your relevant employees do not understand the language the document is
in, a certified translation should be obtained. HMRC can require ...
certified translations when inspecting your CDD records". Rules:
`shared/foreign-company.ts`; translation: `server/kyc-translation.ts`. Tests:
`server/foreign-company.test.ts` (in `npm test`),
`qa/regression/foreign-company-guards.test.mjs`.

- **A company registered abroad as the company that signs.** Until now the
  party box offered only Find it at Companies House or A person signs, so BGP's
  checks never started for a company with no UK record. **Registered abroad**
  (the party box, and a third tab of the Who signs / billing entity dialog):
  its name as its register shows it, the country, its registration number and
  a link to its entry. `POST /api/billing-entities { brandId, abroad }`
  (`abroadCompanyInput`, `saveAbroadEntity`; a UK country is refused, a name
  already filed with a Companies House number is a UK company) files it under
  the party in `crm_trading_entities` with `country`, `registration_number`
  and `register_url` (boot migrations). BGP's checks then look it up in GLEIF
  by its number and country and follow it as a company abroad. The party box
  shows "registered in <country> · <number>" (`companyRegisterWords`).
- **Its register extract is read in the app, in any language.** The Upload
  documents reader (`read_kyc_document`) now records the language, and for a
  company document the company (name, number, legal form, country, register,
  address, status in English, incorporated, the date issued), its board and its
  owners. Extracts reach it from Upload documents, from the client checks
  (`company_documents`, now worded "an extract from its official company
  register, issued in the last three months, showing its registration number,
  its directors and its shareholders. It can be in any language: we translate
  it"), and from Owners abroad's Add a register extract (`about` on
  `kyc_document_readings`: the company abroad it was uploaded for).
  `checkRegisterExtract`: the same company by its name with the legal form
  aside (`overseasNameKey`) or its number (`registrationNumberKey`; a
  different number is never the same company), issued within 92 days of being
  uploaded, and not shown as dissolved, in liquidation or the like. The board
  is screened against the sanctions lists and person owners in full
  (`partyExtractPeople` in BGP's checks); each owner who is a person has **Add
  as owner** (Owners abroad's own person route), and then does their own check.
- **No sign-off without it** (`registerExtractFact`, `registerExtractDenial`
  in `shared/party-kyc.ts`): a company registered abroad (typed with a country
  abroad, an overseas entity number, or read by BGP's checks as a company
  abroad with no UK record) is not signed off on the full checks until an
  extract about it passes, or the Nominated Officer or a Deputy accepts one on
  Documents. Not for a sanctions-only letting, a person, a trust or a public
  body. The Next line reads "Not ready to sign off" with the reason, and the
  AML file lists it under Still needed.
- **Translation in the app** (`translateKycDocument`, table
  `kyc_document_translations`, boot migration): a document read as not in
  English is translated once in the background; any document on a party can be
  translated on a press (the English button in the file pop-out, on Files on
  record and on each upload). Anthropic, called directly, one forced-tool call
  a document, capped a day (`KYC_TRANSLATION_DAILY_CAP`, default 60, 0 = off).
  Every translation shows `TRANSLATION_NOTE`: translated in ChatBGP, not a
  certified translation, HMRC can ask for one (MLR 2017 reg 66). The AML file
  puts it beside the original ("(English translation).txt"). Five-year
  deletion and company merges cover the table.
- **The policy: Issue 5, and risk assessment Issue 4** (Woody, the same day:
  "Ok crack on and change the d and b policy on the app jack has signed off";
  and again "No d and b"). Issue 4 said a Dun & Bradstreet report is required
  for a company owned from overseas (section D, and the limited company
  evidence). Issue 5 of the policy (`bgp-aml-policy-issue-5.docx`, key
  `policy-issue-5`) and Issue 4 of the risk assessment
  (`bgp-firm-wide-aml-risk-assessment-issue-4.docx`) replace it with the
  register extracts read and translated in the app, and say a translation made
  in the app is not certified. Both are in `server/assets/aml-policy/` and
  `AML_POLICY_DOCUMENTS`, with "Approved by: Jack Barratt" in the footer;
  `POLICY_SOURCE` names them; everyone confirms Issue 5 afresh on My BGP → AML
  training (`CURRENT_POLICY_READ_TITLE` takes the latest issue); the Rules page
  has a line for a company registered abroad; the Dun & Bradstreet card is off
  Subscriptions & APIs (BGP has none). Never bring D&B back into the words.
- **Foreign companies on Companies House** (Woody, the same day: "I think a
  lot of companies that own property in the uk are on companies house but are
  also foreign?"). Three kinds: an overseas entity on the Register of Overseas
  Entities (an OE number: every overseas company that owns UK land must
  register), the UK establishment of an overseas company (an FC, SF or NF
  number), and a UK company owned from abroad (an ordinary number, traced
  through GLEIF and the accounts as before). For the first two
  (`foreignOnCompaniesHouse` in `shared/kyc-prechecks.ts`), BGP's checks read
  Companies House's "company details in the place of incorporation"
  (`foreign_company_details`: country, register, number, legal form,
  governing law) into `companiesHouse.home` (`homeRegisterFrom`; Home register
  in the AML box and the AML file), look the company up in GLEIF by its home
  number in that country (`by: "home_number"`), and need the home register's
  extract before sign-off (`needsRegisterExtract` with `homeAbroad`). The
  extract is checked against the home number (`extractSubjectFor`), never the
  OE or FC number, and the hold names the register ("an extract from
  Netherlands Chamber Of Commerce (number 71168974)"). A check made before
  this has no home details until Run again.
- **GLEIF by number abroad needs the name too** (found in the browser check on
  23 November 2026: HRB 123456 in Germany was HVP Hanse Vertriebspartner AG,
  not the company asked about; German HRB numbers repeat between local
  courts). `pickGleifRecord` takes a number match with no register named only
  when the names agree (`gleifNamesAgree`); otherwise the trace says the
  number is another company's (`numberOther`). A Companies House number (the
  UK look-up names its registers) is still taken by number.
- **OpenCorporates** (Woody asked the same day: "Would open corporates help
  here or not really?"): not really. It is an aggregator's copy of selected
  fields from about 140 registers, not the register's own excerpt HMRC asks
  for, it rarely has owners, and commercial use of its API needs a paid
  licence. Companies House (with the Register of Overseas Entities), GLEIF and
  the extract read in the app cover the same ground. Not built.
- Not built: country registers read by API; ordering a certified
  translation. Not run against Anthropic from a build machine: checked in a
  browser on a local copy with readings written in the reader's shape.

## AML emails: the AML Officer is the contact, the note is the sender's (Jack, 2026-11-23)

Jack, on the trust request to Adam Harvey, which read "A note from Charlotte"
over a note he typed and named Charlotte Roberts first under Questions?: "For
every deal across the whole business I need to be the only person referenced
under 'Questions?' please as the AML officer", and "It's from me, im the
person who typed that message so fix that bug". Do not re-litigate.

- **The contact** on every AML email and upload page (client checks, a
  person's own link, reminders, pass-on, the joint agent's request and
  chases, a closed link) is the Nominated Officer alone: `amlContact(fallback)`
  in `server/aml-portal.ts`, read by `primeAmlContact` (the officer's login
  for the phone; kept five minutes; `sendKycEmail` and `portalView` prime
  it). With no Nominated Officer set, or unread, the request's own people
  are used. The transaction's agents are still copied (`request.cc`) and
  still stored on the request. An admin's test request names the admin. A
  new AML email passes `agents: amlContact(...)`.
- **The note** is headed with `noteFrom`, the first name of
  `request.sentBy` (it was the first name on the contact list); with nobody
  named, "Bruce Gillingham Pollard". The page reads `view.noteFrom`.
- **The AML officers are copied on every AML email** (Woody, 24 November
  2026: "can you have layla, jack and I copied in on all emails sent out for
  AML"). `sendKycEmail`, the one door for AML emails, adds the Nominated
  Officer and the Deputies (`amlOfficerEmails`, so today Jack, Layla and
  Woody) to the copy list (`kycCopyList` in `shared/kyc-request.ts`: each
  once, never someone the email is sent to, BGP addresses only): client
  checks, a person's own link, reminders, pass-on, the joint agent's request
  and chases, the Finished and red-flag notes, the trust documents note.
  `test: true` (an admin's test, or an email about a test request,
  `!!row.is_test`) copies nobody else. The send confirmation and the KYC
  history line name everyone copied (`sent.cc`). A new AML email goes
  through `sendKycEmail` and says whether it is a test.
- Tests in `server/kyc-request.test.ts`, guards in
  `qa/regression/kyc-client-checks.test.mjs`.

## What a client checks request says: our client, the other side (Woody, 2026-11-25)

Woody, on the request to Jack Sullivan (CBRE) for Wirral Metropolitan Borough
Council on Tunsgate Quarter: "wording here for clients is a bit weird",
"By law to act on your behalf in an estate agency capacity we need to", then
"the our client one is good. we should add the town Tunsgate Quarter,
Guildford", and of the other side "Before it can go ahead ... we need to spell
out the transaction". Do not re-litigate. Rules: `shared/kyc-work-words.ts`
(`kycWorkFor`, `kycPlace`, `kycWorkOpening`, `kycWorkReminder`); tests
`server/kyc-work-words.test.ts` (in `npm test`).

- **Kept on the request** (`request.work`, made in `createClientCheck` by
  `workFor` from the transaction's type, property, town and unit, read by
  `dealParties`): whether we act for the party (`client`: its role is the
  transaction's client role, or a client file), the place ("Tunsgate Quarter,
  Guildford": the property and the town from its address, `townFromAddress`),
  the transaction spelt out ("the letting of 98-100 High Street, Tunsgate
  Quarter, Guildford, to Rodd & Gunn"; a sale "to", a purchase "from", a lease
  renewal "with") and its one word ("letting", "sale" ...). The email, the
  reminders, the client's page and the send window's preview all read it; a
  request made before has none and keeps the old wording.
- **Our client**: "By law, before we can act for you as estate agents, we have
  to confirm who we are dealing with. We act for <party> on <place>, so we need
  a few things from you." and "We only ask once: it then covers our future work
  for <party>, until our next review." (a sign-off counts on every transaction
  until its re-check date).
- **The other side**: "We act for <client>, the <role>, on <the transaction>.
  Before the <letting> can go ahead, the law requires us to confirm who is on
  each side. That's you, for <party>, and the people who own or control it"
  (the owners only when the request asks about them). The email to the other
  side's agent says the same.
- **The title and subject** name the place ("Identity checks for Tunsgate
  Quarter, Guildford"), not the transaction's internal name.
- **A UK public body** (`work.publicBody`): no owners or directors anywhere.
  The authority step is "Confirmation you can act for the council" (or "the
  organisation"): an email or letter from someone authorised at it
  (`kycDocWords`); the public roles question and the certified copies are about
  the person only; no "Companies House record" line.

## Only a sign-off counts (Woody, 2026-11-24)

Woody, once the old screening's flag on Coq d'Argent #3492 was explained:
"Yes build Only sign off counts remove the old bit / The result are in the
app". Do not re-litigate. Rules: `shared/kyc-status.ts` (`signedOffStatus`,
`shownKycStatus`) and `oldScreeningMarks` in `shared/kyc-red-flags.ts`.
Tests: `server/party-kyc.test.ts`, `server/kyc-red-flags.test.ts`,
`server/kyc-prechecks.test.ts`, `server/client-kyc.test.ts`,
`server/property-ownership.test.ts` (in `npm test`) and
`server/account-entities.test.ts`.

- **A KYC status is a sign-off or nothing.** `signedOffStatus` gives
  approved, rejected or expired; anything else on a record ("in_review",
  "pending": the in-app AML retired in October, the KYC4U mirror's "with
  KYC4U", the old CDD form's bump, the property proprietor check) reads as
  no checks run, with no approver or dates. Every reader goes through it:
  `partyKycState` (the transaction's gate, AML box, AML board, AML file and
  sign-off; on the brand's own legal company the brand's sign-off stands
  over the company's old "in review"); the Companies and KYC card
  (`getAccountEntities`: a record with no sign-off is read as none, so the
  account's own approval stands over a stale `crm_entity_kyc` row); the CRM
  chip and the Companies view (`subCompanyKycSql`); `clientKycBucket` ("in
  review" is Not checked unless a check, file or request has started); the
  property's Ownership & KYC words, the unit panel, the brand page's KYC
  chip, the Transactions list's KYC mark and the property's proprietor
  badge (`shownKycStatus`). The legacy trading entities list on the
  company page no longer offers a hand-picked KYC flag (Pending, In
  review, Passed ...): KYC is the sign-off on the Companies and KYC card.
- **What the old in-app screening marked by itself is no red flag.**
  `oldScreeningMarks` reads each mark's latest history line: written by the
  old screening (`edd_triggered`, or a line by "automatic" or "system"
  before 1 November 2026), or with no line at all a mark only it wrote (a
  reason in its words, `oldScreeningEddReason`; a PEP status of
  `review_required`; a risk rating), it is no flag; a mark whose latest line
  is by a person (the MLRO form's `risk=`, `pep=`, `edd=` notes) still is.
  A sanctions match from a screening dated before 1 November 2026 that was
  not BGP's checks before asking is no flag. On live on 24 November 2026
  that took 59 enhanced due diligence marks, 44 PEP reviews, 11 risk
  ratings and 84 sanctions matches off the red flags, the enhanced level
  and the AML board. The transaction's sign-off reads those fields as blank
  (`oldMarks` on `DealRedFlags`, `server/deal-party-aml.ts`), so the file
  is not higher risk for them.
- **The results stay in the app**: no stored value was rewritten, and the
  KYC history keeps every line (`loadRecordHistory` reads six lines per
  company, with each line's action, to tell the two apart).

## A private individual's date of birth on a small letting (Woody, 2026-11-24)

Woody: "on the sanctions only for a private are you sure we dont need adderess
or DOB?" Answered: the law asks for neither on a letting under £10,000 a month
(only the sanctions checks apply), but a date of birth is what tells a person
from a namesake on the lists; he said yes to recording it, typed in, with no
documents. Do not re-litigate. Rules: `shared/kyc-person-details.ts`; store:
`server/kyc-person-details.ts` (boot table `kyc_person_details`, one row per
party record: the brand, with the person who signs when there is one); route
in `server/deal-party-aml.ts`; line: `client/src/components/aml-person-details.tsx`.
Tests: `server/kyc-person-details.test.ts` (in `npm test`),
`qa/regression/kyc-person-details-guards.test.mjs`.

- **Where**: step 1 ("The person") of a private individual's AML, on the
  transaction's AML box and in the client KYC window: **Date of birth** with
  Add or Change (a date box and Nationality, if known). `PUT
  /api/deals/:id/parties/:role/person-details` and
  `/api/client-kyc/:companyId/subjects/:entity/person-details`: any BGP person
  signed in as themselves, a private individual only (`partyKindOf`, else
  409), checked by `personDetailsInput` (a real date, 16 to 110 years ago; a
  nationality in words). The date goes on the KYC history only; the
  transaction's history says only that it was recorded.
- **Screening**: BGP's checks run again on saving (`startPrecheck`, `force`),
  and `runPrecheck` screens the party with its year and month of birth and
  nationality (`dobParts`, `meshNationality`): the lists set aside an entry
  whose date of birth disagrees, ComplyAdvantage goes by the date-of-birth
  rules ("Who is screened, and the date of birth decides").
- **Sign-off**: a private individual on sanctions checks only
  (`personDobNeeded`) is not signed off until the date is recorded
  (`PERSON_DOB_NEEDED`, ahead of a possible sanctions match, which the date
  helps settle), nor while the latest run of the checks is older than the date
  (`PERSON_DOB_AFTER_RUN`). The Next line reads "To do · Add their date of
  birth" (`person_details`), on the box and the client window. The full checks
  do not ask for it (the identity check gives it).
- Five-year deletion covers the table; a company merge leaves the row on the
  merged-away record (the table holds one row per record).
- Not built: a date of birth for someone named alongside a private individual;
  showing it on the AML file.

## Fable's view of a party's AML file (Woody, 2026-11-24)

Woody, on the risk assessment of Vodafone #4664: "we allready have all this
info highlioghted in the parts above? shouldnt this be more an AI led
commentry with fable 5 giving a proper view on whats been found and given to
date and the risk profile given the rules?". Do not re-litigate. Rules and the
checks on the answer: `shared/aml-commentary.ts`; the call, the saved views
and the routes: `server/aml-commentary.ts`; the screen:
`client/src/components/aml-commentary.tsx`. Tests:
`server/aml-commentary.test.ts` (in `npm test`),
`qa/regression/aml-commentary-guards.test.mjs`.

- **What it reads**: every line of the party's risk assessment, numbered F1,
  F2 and so on (`commentaryFacts`: the job, the level, the four risk
  headings, the due diligence checklist, the structure and its evidence, the
  owners, red flags, mitigating factors, the record's own conclusion, the
  counterparty and the approvals), and BGP's AML rules in short, numbered
  R1, R2 and so on (`commentaryRules`, from `shared/aml-rules.ts`). Nothing
  else: no web, no CRM.
- **What it writes** (`COMMENTARY_SCHEMA`, structured output): a headline,
  a risk profile (lower, standard, higher or unclear: its reading under the
  rules), one short paragraph for each of What has been found and given,
  What is still needed, Risk profile under BGP's rules and Next steps, each
  citing the facts and rules it rests on, and **Worth a look**: anything in
  the facts that does not add up. `checkCommentary` keeps only the sections,
  facts and rules given, drops a paragraph that cites no fact, and returns
  nothing without a headline and a paragraph. It decides nothing and never
  says a party is cleared unless a fact does.
- **The call**: Fable 5.2 (`claude-fable-5-2`), called directly on the beta
  endpoint with the API's refusal fallback (`fallbacks: "default"`), effort
  high, the answer as JSON in the schema (Fable takes no forced tool), one
  call a view, capped a day (`AML_COMMENTARY_DAILY_CAP`, default 60, 0 =
  off), logged as `aml-commentary`. BGP staff signed in as themselves:
  `GET /api/deals/:id/aml-commentary?role=` (the latest view and whether the
  file has changed since) and `POST` the same `{ role, again? }` (write one).
- **Kept** in `aml_risk_commentaries` (boot migration) with the facts and
  rules it was written from and their fingerprint (`commentaryHash`): the
  same view is shown until the file changes; then it says "The file has
  changed since this view was written" with **Write again**. It is written by
  itself only the first time the Risk assessment section is opened with no
  view at all.
- **Where**: the party's Risk assessment section (Sign-off step) leads with
  it, the full record folded under **Show the full record**; the AML file
  prints a current view first, then the record (`writeCommentary` in
  `server/aml-file.ts`). Each cited fact shows its words on hover and under
  **Sources**.
- **The record's own wording was fixed the same day**: a company owned
  through a listed one (`listedViaParent` on the company facts) is no longer
  called listed, its structure chart reads "owned through one company at each
  level by a listed company", and simplified due diligence is offered only
  for a company listed itself; the conclusion no longer says "the checks
  asked for are in" when no one has been asked anything (no one named: name
  who acts for the company; named but not sent: the client checks have not
  been sent); a letting under £10,000 a month concludes on the sanctions
  checks; an empty owners list draws no empty line.
- Not run against Anthropic from a build machine (no key here).

## Everyone on a transaction: the People card (Woody, 2026-11-24)

Woody, on #4664's Parties & AML, which listed only the BGP team: "add up there
all the other contacts on the deal with email and phone number? should be
client/s and the details of the other side plus advisors agents and solcitors
and ability to add a contact to the deal". Then, on its party box: Kenneth Tam
"shown twice", "if a company or person has been chosen then those tabs for
other choices should disappear", and Lee Chung Chan (the landlord's owner, no
email held) "unclear if the email for Lee has been added for Kenneth to send
on?". Do not re-litigate. Rules: `shared/deal-people.ts`; reads and routes:
`server/deal-people.ts`; card: `client/src/components/deal-people.tsx`. Tests:
`server/deal-people.test.ts` (in `npm test`), `qa/regression/deal-people-guards.test.mjs`.

- **The People card** leads the Parties & AML pill for BGP staff (it replaced
  the BGP-team-only card and, for staff, the Linked contacts card): the BGP
  team (`BgpTeamGroup` with `details`: email and phone written out; **Change
  the team** opens Fees & invoicing, where the agents and the fee split are
  set), then **Our client**, **The other side** (each heading names the
  parties), **Agents**, **Solicitors** and **Advisers and others**, every
  person with their email and phone as links. A person met in more than one
  place is one row with every role, in the first group any role gives
  (`mergePeople`).
- **Where each comes from** (`loadDealPeople`, read only): each party's person
  to ask (`<role>_contact_id`), the client contact, the joint agent and each
  party's agent (a firm with nobody named is a firm line with the firm's own
  phone), our client's solicitors (`solicitor_firm`, and `solicitor_contact`
  as the heads of terms save it, "Name · email · phone",
  `parseSolicitorContact`), every firm checked at the SRA on the transaction
  (its head office, from the SRA, when nobody there is named; someone at the
  firm carries the side instead), and the contacts linked to the transaction
  (`crm_contact_deals`, boot columns `deal_group`, `deal_label`, `added_by`,
  `added_by_name`, `added_at`; an older link with no group is placed by the
  party it is filed under, else its firm's kind, `groupForLinked`). A party
  with nobody named reads "Nobody named yet" with **Add someone**.
- **Routes** (BGP staff signed in as themselves, checked first): `GET
  /api/deals/:id/people`, `GET …/people/search?q=` (CRM contacts by name,
  email or firm; BGP's own people left out), `POST …/people` (a CRM contact,
  or someone new: found by email first, else made, filed under a CRM company
  only when exactly one has the firm's name; `newDealContact`), `DELETE
  …/people/:contactId` (only a contact linked on the card), `POST
  …/people/:contactId/details` (a blank email or phone only; the contact page
  changes the rest). Each change is a `deal_audit_log` line, field
  `deal_people`, which client logins never see (`CLIENT_HIDDEN_AUDIT_FIELDS`).
- **The party box shows a choice once it is made**: a company that signs is
  one line with **Change** and **Clear** (the list, Find it at Companies
  House, Registered abroad and A person signs come back on Change; the brand's
  other companies are offered as guarantor in the Guarantor section); who to
  ask is one line with **Change** (the picker and Add someone come back on
  Change), and when they are listed under Who the AML checks need it reads
  "details above" rather than repeating them.
- **An owner with no email is passed their link by the person dealing with
  us**, from that person's own page (it lists the owners live). The Next line
  reads "Waiting on <person> · to pass <owner> their link" while their request
  is open (still offering Add details), and "To do · Add contact details" once
  they have finished; the party box and the AML box's line say so. Their
  reminders list the pass-on step for owners read since the request went out
  (`ownersToLink` in `server/aml-portal.ts`, `KycProgress.ownersToLink`).
- **Who to ask is offered by the client checks wherever they are filed**
  (`dealParties` and `clientFileParties`: `company_id = $1 OR id = $2`). On
  One Clapham (#4578, 24 November 2026) the vendor became a new record after
  Gavin Hubrich (filed under Mount Anvil) was set as who to ask, and Send
  client checks had nobody to send to although the party box named him.
- **Heads of terms party names are offered without what the document says
  about the company** (`hotsPartyName` in `client/src/lib/deal-note.ts`, used
  by `hotsParties`): "(Company No. …)", "(c/o …)", "(registered in …)", a bare
  number in brackets and a trailing "Company No. …" or "c/o …" come off;
  "(UK)", "(No. 2)" and "(Holdings)" stay. One Clapham's heads of terms had
  made CRM records named "St John's Hill PH03 LLP (Company No. OC443074)" and
  "SCPI Eden (c/o Advenis Real Estate Investment Management (ADVENIS REIM);
  Company No. 833 409 899)".
- Not built: two companies signing for one party (joint landlords on one
  title). A party has one company that signs, with guarantors and a third
  party that pays beside it.

## Proof of address as HMRC asks, and signed terms of engagement (Woody, 2026-11-25)

Woody asked whether HMRC needs the person instructing us for a plc confirmed
and identified (yes: HMRC AMLG11400 14.7, "Where a person purports to act on
behalf of the customer you must: Identify and verify the individual's
identity; Obtain evidence that they have authority to act"; MLR 2017 reg
28(5) lifts only the ownership, board and beneficial owner steps for a listed
company, never reg 28(10)), then: "yes make them count and change policy so
we mirror hmrc about proof of address we dont want to request more than we
need". Do not re-litigate. Read on GOV.UK on 25 November 2026: AMLG11400
(updated 10 July 2026) 14.1 and 14.2, a customer who is an individual has
their full name, photo, date of birth and residential address verified "by
ID evidence. This may require you to obtain more than one form of ID
evidence"; 14.7, the beneficial owners need "reasonable measures to verify
the identity", with no proof of address.

- **Who sends a proof of address** is one rule, `owesProofOfAddress` in
  `shared/kyc-request.ts` (re-exported by `shared/kyc-people.ts`): a private
  individual party and anyone named alongside them, and a person who signs
  or guarantees in their own name (another signer or a guarantor, never a
  director signing for a company). A company's owners (on the register, up
  the chain, behind a company abroad, of a company that signs or
  guarantees), a trust's people and
  the person acting for a company or a trust do an identity check only
  (`address.notNeeded`, "No address needed"; `NO_ADDRESS_WORDS`). This
  supersedes "the person acting gives one only as an owner" (23 November
  2026) and every rule above that asks an owner or a trust's person for a
  proof of address. `precheckAsks` no longer adds one for an owner who is the
  person acting; `defaultKycDocs` asks none for a trust's representative; the
  owners' IDs step, the joint agent's list (`jointAgentAsks`: a company's
  people their identity only), the owners' link wording, the certified
  copies (List B only where a proof of address is owed:
  `requestOwesProofOfAddress`, `certifiedListB` on the client's page), the
  trust and enhanced checklists, the rules in short, the AML file and the risk
  assessment follow.
- **A request already sent** keeps its stored steps, but a proof of address
  asked of someone who no longer owes one is no longer asked, shown, chased or
  waited on (`docsStillAsked`, and `progressOf` counts it done). The owner's
  Upload their proof of address on the person acting's page goes with it.
- **A photocard driving licence showing the address covers both** (HMRC: ID
  evidence, one document or more): the proof of address reader reads a
  licence's address and photocard expiry (`expires`), and `checkAddressProof`
  takes one in date with the address on it (no three-month rule); a licence
  BGP uploads counts for identity and address (`uploadCountsFor` now returns
  every use); and a passed online check on a UK licence counts when Veriff's
  decision carries the address (`verifiedLicenceAddress`: document type
  DRIVERS_LICENSE from GB and `person.addresses`; Veriff may not send it, in
  which case nothing changes). The proof of address step says so. A licence
  holds good until its photocard expires (`addressProofExpiry`), also when it
  is reused from another transaction; an earlier proof is looked for only for
  someone who owes one.
- **Signed terms of engagement are the authority to act** (HMRC: "Legal or
  contractual documentation"). Uploaded on the party's **Upload documents**,
  the reader records them as `terms_of_engagement` (filed under that type) and
  whether they are signed (`signed`, handwritten or electronic); signed ones
  count (`checkKycDocument` use `authority`, `authorityFromTerms`,
  `termsOfEngagementFor` in `server/kyc-documents.ts`), unsigned ones wait for
  an officer's Accept it. With them on file `precheckAsks` drops the
  authority step (and a trust's or a public body's), `progressOf` counts it
  done on a request already sent, and the sign-off note, the risk assessment
  and the AML file say authority comes from our signed terms. The identity
  check is still asked. The client's authority step also says our terms
  signed for the company will do.
- **A trust's people send a proof of address** (Jack, Nominated Officer,
  25 November 2026, overruling the line above for trusts: "A trust isn't a
  legal person, so when you act for one, the trustees are in practice your
  customer ... One rule for every trust individual"; trusts are enhanced due
  diligence, so asking more than HMRC's minimum is deliberate). Do not
  re-litigate. `owesProofOfAddress` is true for any of `TRUST_PERSON_ROLES`
  (a beneficiary only where the trust rules verify them at all), and
  `requestOwesProofOfAddress` for a trust's documents request, so its email
  and page list List B again and say each person's link asks for an identity
  check and a proof of address. The person acting for a trust who is not one
  of its people still sends none. `TRUST_PERSON_EVIDENCE` and the rules in
  short say so. **Issue 7 of the policy and Issue 3 of the trust checklist**
  (Jack, the same day: "Ok on issue 6 and 2 of checklist. Please update")
  say the same and are on the Policy pill (`policy-issue-7`,
  `checklist-trusts-issue-3`; Issue 6 and checklist Issue 2 kept on the
  quiet line): the Individuals section's proof of address paragraph, a
  change record row for Issue 7, and the checklist's "For each individual"
  line. `POLICY_SOURCE`, the rules in short, ChatBGP's prompt and the app
  map name Issue 7; everyone confirms Issue 7 afresh in AML training.
- **Everyone whose identity is checked sends a proof of address, except a
  listed company's contact** (Jack, Nominated Officer, 26 November 2026:
  "Reasonable measures to verify identity in my view includes proof of
  address ... it needs to be applied back to all checks, including List B to
  emails ... The only time we need ID only by itself is Listed Businesses").
  Do not re-litigate. This SUPERSEDES Woody's rule at the top of this
  section and "the person acting gives one only as an owner" (23 November).
  `owesProofOfAddress(kind, roles, idOnly)` is true for everyone but the
  person acting (no other role) where `idOnly`: a listed company, one owned
  through a listed one, or a UK public body. `defaultKycDocs` asks a
  company's and a trust's contact for one; `precheckAsks` drops it for a
  listed company (`LISTED_ID_ONLY`); `requestIsIdOnly` reads that from a
  request's `notAsked`; every other request email and page lists List B
  (`certifiedWords`: "one document from List A, certified, and one from
  List B"); the owners' ID step and the joint agent's list ask for it too.
  The licence-for-both and terms-of-engagement rules stand. A request sent
  23 to 25 November keeps its steps; its people show the proof as owed on
  People to check. Told to Jack at the time: HMRC's AMLG11400 14.7 asks only
  "reasonable measures to verify the identity" of beneficial owners, so this
  goes further than HMRC on purpose. **Issue 8 of the policy** (Jack, the same day: "publish issue 8") says
  the same and is on the Policy pill (`policy-issue-8`, Issue 7 kept on the
  quiet line): the Individuals section's proof of address paragraph, a change
  record row and the footer. `POLICY_SOURCE`, the rules in short, ChatBGP's
  prompt and the app map name Issue 8; everyone confirms Issue 8 afresh in AML
  training. The trust checklist stays at Issue 3.
- **Never a proof of address from an agent or representative** (Jack, later
  on 26 November 2026: "We dont check agents or representatives for ID and
  proof or address ... we only check ID and proof of address for the
  Ultimate Beneficial Owners"). `owesProofOfAddress` is false for someone
  whose only roles are the person acting or a director, for any company or
  trust, listed or not (a private individual is the party in person and
  still owes one). `defaultKycDocs` asks a company's or trust's contact for
  none; `precheckAsks` adds it only when the person asked is one of the
  owners, and otherwise lists it as not asked (`REPRESENTATIVE_NO_ADDRESS`).
  Owners, a trust's people, signers and guarantors still send one, and
  request emails still list List B for them. The recipient of a trust's
  documents request was never a person to check (`trustDocs`). **Their
  identity check is still asked** (HMRC AMLG11400 14.7 and MLR 2017 reg
  28(10): identify the person acting and their authority): whether to stop
  Jack answered "Keep it" the same day. **Issue 9 of the policy** (Jack,
  26 November 2026: "publish") says all of this and is on the Policy pill
  (`policy-issue-9`, `bgp-aml-policy-issue-9.docx`; Issue 8 kept on the quiet
  line): the Individuals proof of address paragraph, Authority to Instruct
  (who the person acting is, the role recorded before sending, advisers not
  identified individually: the firm's HMRC or SRA registration), a change
  record row and the footer. `POLICY_SOURCE`, the rules in short, ChatBGP's
  prompt and the app map name Issue 9; everyone confirms Issue 9 afresh in
  AML training.
- **The role question** (Jack, 26 November 2026, on a draft "Rules for
  Persons Acting on Behalf of a Party": "add Role Question for every contact
  before we hit send. A drop down list ... add choice of adding 'other' ...
  a warning box, not a block"). Send client checks, for a company party not
  sent through its agent, asks **What does <person> do for <party>?**
  (`CONTACT_ROLES` in `shared/kyc-request.ts`: director or LLP member, owner,
  senior employee, asset manager, family office staff, attorney, trustee,
  professional adviser, information only, Other with a box). No role, an
  adviser, information only or a blank Other shows an amber warning
  (`contactRoleWarning`) and Send stays enabled. Kept on the request
  (`request.contactRole`) and shown on its row. It changes nothing asked.
  From the same draft Jack decided, and nothing was built: authority stays
  as it is (a director's email or letter, or signed terms; no email domain
  check); trustees keep full ID and proof of address; advisers and agents
  are not checked beyond the firm's HMRC or SRA registration; an owner who
  acts is checked as an owner. The draft's data-only ID check was not taken
  up: the person acting keeps the Veriff check ("Keep it").
- Tests: `server/kyc-people.test.ts`, `server/kyc-request.test.ts`,
  `server/kyc-documents.test.ts`, `server/kyc-address-proof.test.ts`,
  `server/kyc-prechecks.test.ts`, `server/sign-off-note.test.ts` (all in
  `npm test`); guards `qa/regression/kyc-people.test.mjs`,
  `kyc-address-proof-guards.test.mjs`, `kyc-documents-guards.test.mjs`.
- **BGP's policy: Issue 6 is agreed and in the app** (Woody, 25 November
  2026: "push aml policy 6 is agreed"). Issue 6 of the policy (proof of
  address as HMRC asks, a licence for both, terms of engagement as
  authority) and Issue 2 of the trust checklist (the trust's people give
  identity only; signed terms as authority; its section numbers put right to
  the policy's) are on the Policy pill: `policy-issue-6` and
  `checklist-trusts-issue-2` in `AML_POLICY_DOCUMENTS`, with Issue 5 and
  checklist Issue 1 kept on the quiet line. `POLICY_SOURCE`, the rules in
  short, ChatBGP's prompt and app map name Issue 6; everyone confirms Issue 6
  afresh on My BGP → AML training; `TRUST_CHECKLIST` carries the corrected
  section numbers. The footer names Jack Barratt, Nominated Officer, as
  approver, as on every issue.

## The AML decisions log (Jack, 2026-11-23) — KEEP CURRENT

Jack: "We probably need to keep an up to date document of all these updates
and rules we (Wood, Jack, Layla) are making to AML section." It is
`shared/aml-decisions.ts` (`AML_DECISIONS`: date, who decided, topic, title,
the rule in plain words), shown to BGP staff on Transactions → AML →
**Updates** (`client/src/components/aml-decisions.tsx`: by day, filters for
person and topic, Current rules only, search, Print or save as PDF), served
by `GET /api/aml-decisions` in `server/aml-rules.ts` (BGP staff only; the
client imports the type only, so the entries are not in the bundle).

- **Every change to an AML rule adds an entry in the same commit**, at the
  top (newest first), naming who decided it (Woody, Jack or Layla) in plain
  words of 70 or fewer, saying "transaction". A build with no decision
  behind it (a bug fix, a layout change) needs no entry.
- **Never delete an entry.** When a rule replaces an earlier one, add the new
  entry and set `changed` on the old one ("23 November 2026: ...").
- Test: `server/aml-decisions.test.ts` (in `npm test`).

## Trusts checked by BGP from their structure, never KYC4U (Jack, 2026-11-23)

Jack: "Remove KYC4u on trusts. We need you to build the trust structuring",
after asking why BGP could not check a trust itself (it can: a trust is on
no public register, so what the deed says comes from the client and BGP
records it). This SUPERSEDES "send trusts to KYC4U in full" in the next
section; the second read, the trust checklist download and Record as a trust
stand. Do not re-litigate. Rules: `shared/trust-structure.ts`; store and
routes: `server/trust-structure.ts`; panel: `client/src/components/trust-structure.tsx`.
Tests: `server/trust-structure.test.ts` (in `npm test`),
`qa/regression/trust-structure-guards.test.mjs`.

- **A trust is in-house whatever the officers' switch says.** `amlNextStep`
  and `signOffDenial` read `trust` as `inHouseEdd` (`signOffInHouse` in
  `shared/party-kyc.ts`; `signOffEnhanced` counts a trust as enhanced): no
  "Not yet with KYC4U" line or red box, an open KYC4U request holds nothing
  up, the AML board never puts it at With KYC4U and shows no red mark
  (`trust` on `AmlDashboardRow`, `partyInHouse`), Kick off AML sends it the
  client checks, and the AML box offers no KYC4U under Other ways. Only the
  Nominated Officer or a Deputy signs it off, with the in-house note, for a
  year. (Merged on 23 November 2026 with "KYC4U is no longer used" above:
  nothing goes to KYC4U for any party now, and the routes that would send a
  request to KYC4U answer 410.)
- **The structure** (`kyc_trust_structures`, boot MIGRATIONS: one row per
  trust record, `company_id` the crm_companies id, shared by its deals):
  kind (discretionary, fixed, bare, charitable, other, not known), when
  settled, governing law, HMRC's Trust Registration Service (registered, not
  required, not registered, not known) and its URN or UTR, a discretionary
  trust's class of beneficiaries, where the settlor's money came from, and
  its people (`TrustPerson`: name, roles settlor / trustee / protector /
  beneficiary / controller, a company or not, company number, country, born
  month and year, a beneficiary's share). `checkTrustStructure` is the one
  door (full names, a role each, one person once). `GET` / `PUT
  /api/trust-structure/:companyId`, BGP staff signed in as themselves; a PUT
  is refused unless the record is a trust, writes a `trust_structure` line on
  the KYC history and starts a fresh run of BGP's checks.
- **Who is verified** (`trustPersonOwesChecks`, BGP's trust checklist items
  4 to 7): the settlor, every trustee, a protector and anyone else with
  control; a beneficiary only when the trust is not discretionary or
  charitable; a company on the trust never (screened as a company). They are
  People to check (`partyPeople` with `trust`, basis `trust`, or
  `trust_unrecorded` with no structure; the roles join `KycPersonRole`), each
  with Send them a link (`createPersonCheck` finds them by key) and owing an
  identity check and a proof of address; the rest are `trustNamed`, screened
  only. The person acting may pass them their links from their own page, as
  an owner's.
- **Screening**: `runPrecheck` adds everyone on the structure
  (`trustPerson`, with the date of birth recorded); `chooseScreened` gives
  basis `trust` (MLR 2017 reg 6): the trust, any company on it, and its
  people in full; the deal's contact sanctions only.
- **The client checks for a trust** (`defaultKycDocs(..., trust)`,
  `precheckAsks` with `trust`): proof of address, `trust_deed`,
  `trs_excerpt`, `trust_authority` (unless the person asked is a recorded
  trustee) and `trust_wealth`, and source of funds for a buyer or tenant;
  the deed or HMRC's proof already on the KYC record, or a structure saying
  registration is not required, is not asked. The dialog offers the trust's
  documents first (`trustAsk` on each party).
- **What the file still needs** (`trustStructureGaps`): recorded gaps
  (structure, kind, settlor, trustees, beneficiaries or their class, TRS
  status, TRS not registered, the settlor's wealth) are the Next line's
  "To do" with **Trust structure** (action `trust`), ahead of the client
  checks; document gaps (the deed, HMRC's proof: `kyc_documents` types
  `trust_deed`, `trs_excerpt`) come with the client checks or **Add it** on
  the panel (`/api/kyc/documents/upload`). The sign-off refuses while any gap
  stands, and while any person on the trust still owes their checks
  (`trustGaps`, `clientChecksOutstanding` read for a trust even before the
  request to the person acting finishes).
- **Shown**: the panel in the AML box's Who signs step (`TrustStructurePanel`,
  edit in `TrustStructureDialog`, no form element), the step's summary ("a
  trust: discretionary, 4 people · 1 to do"), the second read's record
  (`partyRecordText`), the AML file's report ("Trust structure (recorded by
  BGP)") and the risk assessment's in-house wording.
- **Read the trust deed** (Jack, the same day: "Yes build"; rules
  `shared/trust-deed-read.ts`, reader `readTrustDeed` in
  `server/trust-structure.ts`): the panel's button reads the deed on file,
  or one chosen then (filed on the trust's KYC record as `trust_deed`), via
  `POST /api/trust-structure/:companyId/read-deed` (BGP staff, checked
  before the file is taken; 20MB; PDF, pictures, Word, text). Anthropic,
  called directly, one forced-tool call (`read_trust_deed`), capped a day
  (`TRUST_DEED_READER_DAILY_CAP`, default 40, 0 = off), sent the deed alone.
  It proposes the kind, when settled, governing law, class of beneficiaries
  and the people with their roles, each with the deed's words;
  `checkTrustDeedRead` drops any value whose quote is not in the deed's text
  or whose name is not in its quote (a scan is kept "check by eye").
  `mergeDeedReading` fills only what is blank and adds people or roles,
  never overwriting what a person recorded; registration and the settlor's
  wealth are never read from a deed. The form opens on the proposal with the
  read-back (`DeedReadBack`); its Save is the only save. A
  `trust_deed_read` line goes on the KYC history.
- **Request trust structure** (Jack, the same day: "My colleagues wont do
  this. So the 'Trust Structure' button needs to be 'Add Trust Structure
  Yourself' ... Or 'Request Trust Structure' and it then emails the trust's
  representative, or whoever's email you then add in ... Once they upload, we
  need the documents to go somewhere and then be notified that are ready to
  undertake due diligence on"). With no structure recorded the panel offers
  **Request trust structure** first and **Add trust structure yourself** (Read
  the trust deed, or Fill it in by hand). `POST
  /api/trust-structure/:companyId/request` (BGP staff, the client checks
  switched on, a trust record) is `createClientCheck` with `{ purpose:
  "trust_structure" }`: a client checks request marked `request.purpose`, no
  identity check, no public roles question, no owners to confirm or links to
  pass, asking `TRUST_REQUEST_DOCS` (the deed, `trust_people` "Who is who in
  the trust", HMRC's proof, the trust's wealth, the trustees' confirmation;
  what is on file is unticked). Its email and page say "Documents about
  <trust>" (`trustDocsRequestEmail`, `trustDocs` on the page), and reminders
  follow. Its recipient (often the trust's solicitor) is never a person to
  check and the request is never anyone's own link (`trustDocs` on
  `PeopleRequest`). Each upload is filed on the trust's KYC record as any
  client check file is; a deed filed this way (any client check upload as the
  trust deed) is read once (`readDeedDocument`, kept in
  `kyc_trust_deed_readings`, a boot table) and the panel shows **Check and
  save** on the draft until a structure is saved after it (`deedDraftFor`).
  When everything asked for is in, the request finishes itself (or on the
  page's Finish; claimed once with `RETURNING`), and `trustDocsReadyEmail`
  ("Ready for due diligence: ...") goes to the transaction's agents, the
  sender and the AML officers (`amlOfficerEmails`). A KYC history line
  `trust_documents_requested`, then `trust_documents_in`. Tests in
  `server/trust-structure.test.ts` and the guards file. Not run against
  Microsoft or Anthropic from a build machine.
- **The words are "trust information"** (Jack, the same day: "it needs to
  be simple English like 'Add trust information'"): the Next line's button
  is **Add trust information**, the panel is **Trust information** with
  **Ask for trust information** and **Add trust information yourself**, and
  the gap reads "Add the trust's information: what kind of trust, who set
  it up, the trustees and who benefits". Code names (`trust-structure`,
  `TrustStructure`) are unchanged. No screen says "trust structure".
- **Certified copies on every request** (Jack, 23 November 2026: "I would
  also like them to have the ability to upload certified documents (ID and
  proof of address)", then "these need to be sent on all AML request emails.
  As long as we have a way to accept the documents sent in"). Every client
  check email and page (not the joint agent's) has **Or send certified
  copies** (a trust request: **What happens next**, which also says each
  trustee and the settlor get their own link) with Jack's lists
  (`CERTIFIED_LIST_A`: passport, photocard driving licence, Home Office
  residence permit, certified by a solicitor; `CERTIFIED_LIST_B`: a utility
  or council tax bill under 3 months old; `certifiedWords` says who for) and
  an optional upload card, doc key `certified_ids` (filed as
  `certified_id`). It is never one of a request's own documents
  (`TRUST_OPTIONAL_DOCS`, sent as `optionalDocs`), so it never holds a
  request open or shows in a reminder. **Accepting them** is the officers':
  **Certified documents** on a person's row in People to check
  (`CertifiedDocsDialog`: tick the person's files, or add them, and say who
  certified them) posts to `POST /api/deals/:id/parties/:role/certified-documents`
  (the officers; Verified from public sources is admins only, and the two
  share one handler that takes the method from the route)
  (`kyc_public_figure_checks.method`, a boot column; document ids must be on
  that party's KYC record). It counts for that person's identity check and
  proof of address exactly as Verified from public sources does, can be
  withdrawn, and their own request then reads as done (`accepted` in
  `progressOf`), so they are not chased. **The app reads each one** (Jack,
  the same day: "As long as the documents are certified then yes they can
  accept. But how can the app Audit that?"): a `certified_ids` upload is
  queued and read exactly as a document BGP uploads is
  (`kyc_document_readings`, `readUpload`, `checkKycDocument`; see "Upload
  documents on a party"), never as seen in the original. One that names a
  person to check, is in date and carries the certifier's name, profession
  or firm and date counts for that person by itself, with the reading kept
  as the record; anything else shows its reasons in the party's Upload
  documents box and waits for an officer (Accept it there with a note, or
  Certified documents on the person's row). Nobody accepts a certified copy
  on trust. **Who may certify, and what the certification must carry**
  (Jack, the same day: "we will accept - Solicitors, lawyers, or notaries
  public, Chartered accountants, Bank or building society officials", and
  "Require the full HMRC details on the certification"; do not re-litigate):
  `certifierGroup` in `shared/kyc-documents.ts` reads the occupation the
  certifier wrote, then their firm (a plain "accountant" is not a chartered
  one); `certifierRefusal` holds anyone else back with the reason.
  `certificationGaps` asks for HMRC's list (AMLG11400): the words that it is
  a true copy of the original, the signature, the date, the certifier's
  name, occupation, address and telephone number (`address`, `phone`,
  `signed` on the reading; a reading made before this has none, so Read
  again). Both rules apply to a copy BGP uploads too. Every request email and
  page says who can certify and how (`CERTIFIED_WHO`, `CERTIFIED_HOW`). The
  app does not check the certifier exists: not built.
- **A trust stays a trust when a company signs for it** (found on Fortis
  Green the same day: URC Thames North Trust has its company, 00075432, set
  as the company that signs, and the people reader, the sign-off, the AML
  board and the client checks each read `!entityId`, so the trust's people
  would not have been listed). Those four and the screening of the
  structure's people now read the record alone; BGP's checks still run on
  the company that signs.
- Not built: the client naming the trust's people on their page; Scotland's
  and Northern Ireland's registers. Not run against live data or Anthropic:
  checked by tests only, not in a browser.

## Trusts to KYC4U in full, and the officers' second read (Jack, 2026-11-20; trusts superseded 2026-11-23, see above)

Jack, on Fortis Green (vendor URC Thames North Trust, a 1902 company limited
by guarantee that the app read as an ordinary company: no PSC, so its
directors stood in under reg 28(6), standard due diligence), with BGP's
trust checklist attached: "send trusts to KYC4U in full, and use AI only as a
second reader when signing off as Nominated Officer"; then "Build for any
enhanced party", and a big red mark until the agent has submitted the request
on KYC4U's portal ("KYC4U will want it uploaded in the portal"). Do not
re-litigate. Rules: `shared/deal-parties.ts` (`isTrustRecord`,
`trustMarkInName`), `shared/aml-policy.ts` (`TRUST_CHECKLIST`,
`ENHANCED_CHECKLIST`, `trustChecklistNote`), `shared/aml-box.ts` (`trust`),
`shared/aml-dashboard.ts` (`amlNeedsKyc4u`), `shared/aml-second-read.ts`.
Tests: `server/aml-second-read.test.ts` (in `npm test`),
`qa/regression/aml-trust-second-read.test.mjs`.

- **Record as a trust** (`PUT /api/deals/:id/parties/:role/trust { trust }`,
  BGP staff as themselves): `crm_companies.aml_subject_type = 'trust'`, a
  deal history and KYC history line; Undo clears only what it set; the
  record is shared, so every deal with it follows. The policy factor
  `policy_trust` already read that value, so the party is enhanced and only
  the officers sign it off. A trust needs no company that signs (its
  trustees sign: `partyGaps` `trust`, the red flags', dashboard's and KYC4U
  prefill's company rule); a corporate trustee can be set as one, so BGP's
  free checks run on it. A name that reads like a trust (`trustMarkInName`:
  Trust, Trustees, Settlement; never Trustpilot) is a suggestion in the
  party box and the AML box (`TrustLine`), never applied by itself. Not
  read: a company limited by guarantee with no PSC is not flagged by
  itself.
- **The trust's next step** is Request KYC4U check, ahead of the client
  checks, and its KYC4U note leads with BGP's trust checklist (items 1 to
  10 and the evidence line). The checklist is a download on the AML policy
  panel (`checklist-trusts`, `server/assets/aml-policy/bgp-aml-checklist-trusts.docx`).
- **The red mark**: while an enhanced or red-flagged party's next step is
  Request KYC4U check or KYC4U's form, the AML box shows a red **Not yet
  with KYC4U** box (`aml-kyc4u-needed-<role>`), and the AML dashboard a red
  Not with KYC4U mark beside Enhanced (`amlNeedsKyc4u`: enhanced and at Not
  started, BGP checked, Client checks sent or Client finished). KYC4U takes
  requests only on its portal (next bullet). The app sends KYC4U no email.
- **KYC4U's portal, not the bookmark** (Jack, same day: "build 1 and 2",
  and a downloadable pack "they can then manually put into the KYC4U
  portal"). On live every KYC4U request prepared since October still sat at
  "queued": the Send to ChatBGP bookmark had never filled a form, and the
  sync is waiting on KYC4U's IT approval. Rules: `shared/kyc4u-portal.ts`
  (`KYC4U_FORM_FIELDS`, `kyc4uDraftState`, `kyc4uSubmittedInput`); pack:
  `server/kyc4u-pack.ts`; tests `server/kyc4u-portal.test.ts` (in `npm
  test`), `qa/regression/kyc4u-portal.test.mjs`.
  - **Only a request submitted on KYC4U's portal is with KYC4U**
    (`kyc4u_drafts.status` filled or submitted): the sign-off's "raised with
    KYC4U" (`raisedWithKyc4u`) and the AML dashboard's With KYC4U no longer
    count one only prepared (queued). A request prepared and not submitted
    for 30 days (`KYC4U_PREPARED_STALE_DAYS`) is stale: it no longer reads as
    ready, and the request line offers to cancel it.
  - **Request KYC4U check**: every document on the party is ticked to start
    with, and the orange **Download for KYC4U** prepares the request and
    downloads the pack at once (Jack, same day: "when you click the orange
    button ... it literally downloads a zip file"), then shows the steps:
    Download it again, Open KYC4U's portal, Submitted on KYC4U's portal.
  - **The pack** (`GET /api/kyc4u/drafts/:id/pack`, BGP staff): a ZIP with
    01 the request sheet (KYC4U's form field by field, in its order, with
    the note: the deal, the company that signs, red flags, BGP's checks, the
    trust checklist), 02 BGP's AML report on the party (the AML file's report,
    on a deal) and the documents (those ticked, else every one on the party's
    KYC record). A `kyc_audit_log` line (`kyc4u_pack`).
  - **Submitted on KYC4U's portal** (`POST /api/kyc4u/submitted { dealId?,
    companyId, role?, reference?, date }`, BGP staff): marks the party's
    latest prepared request submitted, or records one when it was raised on
    the portal by hand; columns `submitted_at`, `submitted_ref`,
    `submitted_by`, `submitted_by_name` (boot MIGRATIONS). Lines on the KYC
    history and the deal's history (`kyc4u_submitted`). KYC4U's document
    sync matches a REQ folder to the deal by that reference too. The button
    is in the AML box's Next line, the red box and the KYC4U section.
  - The bookmark routes stay for anyone who uses it.
- **Second read** (`POST /api/deals/:id/parties/:role/second-read`, the
  officers only, `decider`; an enhanced party only, 409 otherwise;
  `server/aml-second-read.ts`, `client/src/components/aml-second-read.tsx`
  in the Sign-off section): the party's KYC documents (up to 12, 18 MB, KYC4U
  and trust papers first; PDFs whole, pictures, Word as text) and BGP's
  record of the checks (`partyRecordText`, source R) go to Anthropic,
  called directly, one forced-tool call (`AML_SECOND_READ_DAILY_CAP`,
  default 40, 0 = off). Each checklist item (the trust list for a trust, the
  enhanced list otherwise; never the officer's own sign-off) comes back
  found, partly or not found with its source and words; `checkSecondRead`
  sets each quote against the document's own text (a quote not found makes
  the item "partly", a picture is "check it by eye", no source makes it not
  found). It never decides (discretionary, credible, acceptable, approve):
  the prompt forbids it and nothing it returns is stored or acts. A KYC
  history line (`aml_second_read`) says a read was made. Not run against
  Anthropic from a build machine.
- Not built: screening the names a trust's deed gives (settlor, protector,
  beneficiaries) against the sanctions lists; a trust with individual
  trustees and no company has no BGP checks before asking.

## The AML box, shortened, and the officers' AML file (Woody, 2026-11-20)

Woody, on the AML checks page's trail: "on this page can you build to
minimise each section with the detail to pop out so people can clearly see
whats happening and whats needed its pretty overwhelming for them but clearly
we need that info displayed for the AML officers", then "an option for the AML
officers to generate a report to include all the documents etc which we can
then send to HMRC if asked? Also we can send to KYC4U if we get stuck and need
them so they can move quicker". Do not re-litigate. Rules: `shared/aml-box.ts`
(the Next line) and `shared/aml-file.ts`; the box:
`client/src/components/deal-aml-status.tsx`; the file: `server/aml-file.ts`.
Tests: `server/aml-box.test.ts`, `server/aml-file.test.ts` (both in
`npm test`), `qa/regression/aml-box-sections.test.mjs`,
`qa/regression/aml-file-guards.test.mjs`.

- **One party box for every layout** (`PartyAmlBox`): the stage chip, the
  **Next** line and one line per section. The stage is the AML dashboard's own
  (`GET /api/aml-dashboard?dealId=`, the dashboard's loader for one deal,
  whatever its status; `fallbackStage` from the AML status when that row is not
  read), so the box and the AML checks page agree. The Next line is
  `amlNextStep` (what happens next, who it waits on, and one action: Fill in,
  Add their details, Send client checks, Open People, Request KYC4U check,
  Open KYC4U's form, Add KYC4U result, Sign off), read from the facts the box
  already holds: the AML status, the parties, the client checks, KYC4U's
  drafts. Change the order of steps there, with a test, never in the box.
- **The sections** (superseded on 22 November 2026 by four steps per party:
  see "The AML redesign: four steps per party"; what each section held is now
  inside a step): Company, BGP's checks, Due diligence, People, Client
  checks, Red flags, KYC4U, Sign-off (`BoxSection`). Each is one line with a
  tone and a summary; pressing it opens what the box showed before
  (`PartyCompanyFacts`, `PartyPrechecks`, `PartyLevel` with the policy's
  factors, `ClientChecksForParty part="people"` / `part="requests"`,
  `PartyRedFlags only="flags"`, the KYC4U request, `PartyDecisions`). Nothing
  was dropped: a new piece goes into a section's detail, and a section's line
  says in a few words where it stands. A person and a request are one line
  each too (`PersonRow`, `ClientCheckRow`), with any warning (someone else's
  identity check, a public role, the register's owners disputed, a possible
  sanctions match, a proof of address to check) kept on the line.
- **Show all detail** (since 22 November 2026 in the box's **More** menu)
  opens every step of every party, remembered per
  browser (`bgp:aml-box:open-all`, read and written in try/catch; never
  relied on). The deal-level rows (Deal record red flags, Agents) fold the same
  way. On the AML checks page the trail opens on its own party
  (`focusCompanyId`), the deal's other parties folded to their Next line, and
  the documents and history each on one line until pressed.
- **The AML file** (the Nominated Officer and the Deputies only, admins until a
  Nominated Officer is set: `decider` in `server/deal-party-aml.ts`).
  `GET /api/deals/:id/aml-file?role=&format=zip|pdf`: one party or every party;
  the ZIP holds, per party, `00 AML report - <party>.pdf` and every document on
  its KYC record as stored (`documents/NN <type> - <name>`; a Veriff result is
  written out from its session; a file not in the store, or past the 200 MB
  cap, is listed in the report and left out). The report is read by the same
  functions as the box (`loadPartyKyc`, `dealPrechecks` with `autoStart:
  false`, so making it never starts a paid check, `loadDealRedFlags`,
  `partyPeopleFor`, `clientChecksForDeal`, `loadNotRequired`, `dealAgentsAml`):
  the deal, the company at Companies House, every check line, the red flags
  and the ones set aside with the comment, the people to check, each client
  check request and what came back, KYC4U, the history and the document index.
  `POST /api/deals/:id/aml-file/kyc4u { role }` files the report as a KYC
  document of type `aml_file` on the party (the company that signs when set), so
  Request KYC4U check offers it and the bookmark attaches it. Each file made is
  a `kyc_audit_log` line (`aml_file`) and a deal history line (`aml_file`) with
  who made it. **The AML register is never in it** (internal reports and SARs:
  the file may leave BGP, and tipping off is an offence). The button
  (`client/src/components/aml-file-button.tsx`) is drawn for the officers only:
  the box's header (every party), each party's Sign-off section, and the top of
  the trail on the AML checks page (`isOfficer`).
- Checked in a browser against a local copy on 20 November 2026. The file has
  not been made on live: the first is an officer's.

## Owners behind a company abroad, and Monaco (Woody, 2026-11-20)

Woody, on Tureddi Group Limited (15210693), owned more than 75% by Scp Aaa
Invest, a Monaco société civile: "the app hasn't flagged this as an issue but
the holding company for this business is in Monaco..? What do you think?" The
box read Standard due diligence and "No one to verify": a company with no
person on the UK register was treated as having no owners, so the directors
stood in for them (MLR 2017 reg 28(6), which applies only once every means of
finding the owners is exhausted), the client checks dropped the structure
chart and the owners' IDs, and Monaco was on no list. Rules:
`shared/kyc-prechecks.ts` (`ownerRegister`, `ownersAbroadOf`,
`offshoreOwnersOf`, `offshoreNote`), `shared/kyc-people.ts`,
`shared/kyc-request.ts` (`kycDocDetail`); the walk: `discoverUltimateParent`
in `server/companies-house.ts`. Tests: `server/kyc-prechecks.test.ts`,
`server/kyc-people.test.ts`.

- **A corporate owner registered outside the UK** (its register's country or
  place names somewhere other than the UK; `ownerRegister`), on the register
  or up the chain, is a dead end for Companies House. The chain walk records
  it (`abroad`) and stops there: until then it looked a foreign registration
  number up as a UK one, which could read a stranger's company. Stored as
  `companiesHouse.ownersAbroad` on a run; an older check reads them from its
  owners on read, so no re-run is needed.
- **The people behind it are asked for, not stood in for** (reg 28(4)(c);
  BGP's policy: "Every organisation will have UBOs"). The client checks keep
  the structure chart and the owners' IDs, and the chart's step names the
  company abroad and asks for its register extract (`request.ownersAbroad`).
  People to check reads `owners_abroad` and lists them; the party owes "the
  people behind X: a structure chart and their IDs" until a chart arrives, so
  the sign-off asks for a note meanwhile. The company abroad is screened as a
  company (ComplyAdvantage, the web search, the sanctions lists); the
  directors are screened meanwhile, under the `owners_abroad` basis, not
  reg 28(6).
- **Monaco is on the secrecy and higher-risk list** (`OFFSHORE`, the
  `offshore_owner` red flag): a tax haven (BGP's AML policy: "Non-resident
  customers, especially companies in tax havens"), on FATF's grey list from
  June 2024 until 30 October 2026, and on the EU's list of high-risk third
  countries since August 2025 (Delegated Regulation (EU) 2025/1184; not a UK
  high-risk third country since FATF removed it). The flag now reads the
  owners on read and up the chain, with the reason and what to ask for.
  Jersey, Guernsey, the Isle of Man and other places a UK property owner is
  often held from are abroad (the client is asked) but not red flags.
- Not built: a person the client names behind the company abroad is added to
  People to check by hand (still "Not built: adding a person by hand"); a
  minority corporate owner the walk does not follow.

## What KYC4U do, brought into the app (Woody, 2026-11-21)

Woody sent KYC4U's whole pack for a counterparty (LEGO, REQ112444: their AML
Risk Assessment Report, the heads of terms, Creditsafe reports, screening
reports, the Danish register extract, public sources on the owner) and asked
"this is all the stuff KYC4U do. are we missing anything in the app?". Of the
gaps listed he chose "yes lets do 1 to 4", then "do 7", "and 8", and
"foreign companies I think we will send to KYC4U". A credit report (item 6)
was not chosen: BGP's AML policy (Issue 2) lists "Report from an aggregator
database (e.g., Creditsafe/SmartSearch/D&B/Dow Jones etc)" among the evidence
for a limited company, and the app has a Creditsafe stub waiting for an
account (`server/aml-market.ts`). Do not re-litigate. Tests:
`server/kyc4u-result-pack.test.ts`, `server/web-page-copy.test.ts`,
`server/aml-risk-assessment.test.ts` (all in `npm test`), with cases added to
`server/kyc-prechecks.test.ts`, `server/kyc-people.test.ts`,
`server/aml-box.test.ts`, `server/party-kyc.test.ts`,
`server/aml-dashboard.test.ts`; guard `qa/regression/kyc4u-gaps-guards.test.mjs`.

- **KYC4U's pack in one go (1).** Add KYC4U result takes KYC4U's zip as they
  send it (up to 100MB, opened on the server: at most 120 files inside, 25MB
  each, 250MB unpacked, documents and pictures only; junk, programs and zips
  inside a zip are listed as not filed), or up to 40 files. Rules:
  `shared/kyc4u-result-pack.ts`; unpacking and reading:
  `server/kyc4u-result-pack.ts`. Each file is filed on the party's KYC record
  under its folder's heading in the note (`kyc4uPackPlace`: "1.0 HOTs" is
  Heads of terms, "2.0 <company>" the company, "3.0 Holding Cos/1.0 <co>"
  Holding companies, "4.0 UBOs/1.0 <person>" Owners) with a type read from
  the name (`heads_of_terms`, `credit_report`, `screening_report`,
  `register_extract`, `public_source`, `kyc4u_report`); a file already on the
  record (the same name and size) is not filed twice. KYC4U's AML Risk
  Assessment Report is read by rules, never AI (`readKyc4uRiskReport`: the
  job, the level of risk, the four risk headings, the due diligence answers,
  each company and owner with the evidence, the conclusion, the counterparty
  answers, the approvals with their dates). Choosing the files posts them to
  `POST /api/deals/:id/parties/:role/kyc4u-result/read` (the officers only;
  saves nothing), and the dialog shows where each file goes and fills the
  result (`kyc4uResultPrefill`: Approved only when KYC4U's own internal
  approval is dated in the report; the date of that approval; the job ID as
  the reference; the level of risk and conclusion as the note) for the
  officer to check before Add result. The reading is kept on the result's
  `kyc4u_requests.fields` ("KYC4U assessment", "Level of risk"). KYC4U rating
  a party high risk makes the approval last 1 year, as enhanced due diligence
  does.
- **Verified from public sources (2).** KYC4U's "Public figure" method. On a
  person's line in People to check, the Nominated Officer or a Deputy presses
  **Verified from public sources**: a note of at least a sentence and the
  pages (up to 6 links, each copied to PDF on the KYC record after the reply)
  or files. Stored in `kyc_public_figure_checks` (boot migration in
  `server/index.ts`), read for the party (the brand and the company that
  signs) by `publicFiguresFor` in `server/kyc-people.ts`, so it holds on every
  deal with that party. It counts for that person's identity check and proof
  of address (`publicFigure` on the person in `shared/kyc-people.ts`; nothing
  is asked of them after). `POST /api/deals/:id/parties/:role/public-figure`
  and `…/public-figure/:checkId/withdraw` (`decider`, in
  `server/deal-party-aml.ts`); lines on the KYC and deal histories.
- **PDF copies of web sources (3).** `server/web-page-copy.ts`
  (`fileWebCopies`) with `renderPagePdf` in `server/render-page.ts`: the app's
  own headless browser, every request the page makes checked against the
  private-address guard (`assertPublicHost`, `isPrivateIp`, now exported from
  `server/safe-fetch.ts`), downloads refused, "Copy of <address> · taken
  <date> for BGP's AML checks" at the top of every page. Filed as
  `web_source` on the party's record, once per page per party, one copy at a
  time across the app, at most 8 a run. After every run of BGP's checks
  before asking, the source of each web finding is copied (red flags before
  possible namesakes, `precheckPagesToCopy`), never holding the run up; and
  the public-figure links. `KYC_WEB_COPIES=off` stops them. Tried from a
  build machine on 21 November 2026: a public page (example.org) copied to a
  75 KB PDF, a missing page refused with the site's 404, and this machine,
  private addresses, the cloud metadata address and file: links refused
  before any browser started.
- **The risk assessment in KYC4U's shape, and the HOTs (4).**
  `shared/aml-risk-assessment.ts` (`buildRiskAssessment`): the job (deal,
  property, party, client or counterparty, work type, BGP's agents, the
  checks needed, the level of risk), the four risk headings (each live flag
  under one, `riskHeadingOf`; owners abroad and factors to weigh as details),
  the due diligence checklist (structure chart, authority to instruct,
  adverse media, financial statements, joint agency, certified documents,
  source of funds, a trading company, non-trading risk), the structure with
  its evidence, the owners with nationality, residence and how each was
  verified, certified documents from KYC4U's reading, risk identified,
  mitigating factors (flags set aside with their comments, a listing, public
  figures, KYC4U's rating) and the conclusion, the other side's agents and
  solicitors and the lender question from BGP's policy, and the approvals.
  Built by `riskAssessmentFor` in `server/aml-file.ts` from what the AML file
  already gathers; printed first in each party's section of the AML report,
  and shown on request in the AML box's **Assessment** section
  (`GET /api/deals/:id/aml-risk-assessment?role=`, BGP staff, reads only).
  The AML file now carries the deal's heads of terms: the tracker unit's
  final agreed file (`unit_marketing_files`, read from
  `/uploads/marketing-files/`), else the text drawn up in the app as a text
  file, at the top of the ZIP and named in the report's deal section.
- **The other side's solicitors (7).** `shared/solicitor-aml.ts`,
  `server/solicitor-aml.ts`, `client/src/components/solicitor-aml.tsx`: the
  AML box's **Solicitors** line (BGP staff) takes the firm's name (the deal's
  own `solicitor_firm` is offered) and **Check** runs two Perplexity
  searches: the SRA register, read only from sra.org.uk and the Law Society's
  Find a Solicitor and believed only when the register page is among the
  pages read (`checkRegisterAnswer`); and the web for SRA interventions,
  fines, Solicitors Disciplinary Tribunal findings, fraud or misconduct, kept
  only where the source was read (`checkMediaAnswer`). Each check is a
  `kyc_solicitor_checks` row (boot migration); the risk assessment and the
  AML file read the latest per firm. Since the same evening the register is
  the SRA's own data (next section); the web search of the register is the
  fallback without the key.
- **Trading status and identity verification at Companies House (8).**
  `tradingState` in `shared/kyc-prechecks.ts`: accounts filed as dormant or
  business code 99999 (dormant), 74990 (non-trading), or incorporated in the
  last year with no accounts filed: a warning on the company and a factor to
  weigh (`policyFactorsToWeigh`), never a red flag (BGP's policy does not
  list it). Identity verification (ECCTA, from 18 November 2025): the free
  API's `identity_verification_details` on officers and PSCs is now read
  (`idvOf`, `idvState`, `precheckIdentity`): verified when
  `identity_verified_on` is set or a verification statement was supplied and
  not removed (most verified appointments carry no `identity_verified_on`,
  per Companies House's developer forum), due, overdue (a warning on the
  company), or not shown. Information for the file, never BGP's own identity
  check. A check from before this reads as nothing shown until Run again.
- **Foreign holding companies go to KYC4U (Woody's answer to 5).** A party
  owned through a corporate owner registered abroad (on the register or up
  the chain, `ownersAbroadOf`) gets Request KYC4U check as its Next step
  (`ownersAbroad` in `shared/aml-box.ts`), the red Not yet with KYC4U box and
  the dashboard's Not with KYC4U mark (`amlNeedsKyc4u(level, stage,
  ownedAbroad)`), and BGP's own sign-off refused until KYC4U's result
  (`ownersAbroad` in `signOffDenial`). KYC4U's note asks them to identify
  the owners from the home register. This supersedes "the client is asked
  for a structure chart" as the next step in the section above; the client
  checks still ask for the chart when they are sent. A foreign owner is not
  by itself higher risk: Monaco and the other secrecy places stay red flags.
- **Five-year deletion** covers the two new tables (`kyc_public_figure_checks`
  with the party, `kyc_solicitor_checks` with the deal's AML fields).
- **KYC4U's approvals read "Approved by KYC4U"** (found on the box the same
  day): the mirror stored "KYC4U (MLRO)" as the approver (`KYC4U_APPROVER` in
  `server/kyc4u.ts`), against the policy's "not its MLRO". New approvals store
  "KYC4U", and a stored "KYC4U (MLRO)" reads as "KYC4U" (`approverWords` in
  `shared/party-kyc.ts`, in `partyKycState` and on the group entities panel);
  no row was rewritten, and the KYC history keeps what it said. A party owned
  through a company abroad says so on its People and KYC4U lines too.
- Not built: Creditsafe (a contract and keys are Woody's); reading a foreign
  register in the app (KYC4U do it); the SRA's data API (needs a key); a
  lender on the deal and its checks.

## The SRA's data on law firms (Woody, 2026-11-21)

Woody took out a key on the SRA's developer portal (product "Data Sharing",
subscription "Chat BGP"; "ive done the solcitors api btw") and put it on
Railway as `SRA_API_KEY` ("i used you suggestion yes"). The SRA's data share
has one operation, `GET https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll`
(header `Ocp-Apim-Subscription-Key`): every organisation on the SRA's register
in one answer, 25,310 entries and 24 MB on 21 November 2026, refreshed by the
SRA every 24 hours. Rules: `shared/sra-register.ts`; read and kept:
`server/sra-register.ts`; the check: `shared/solicitor-aml.ts`,
`server/solicitor-aml.ts`, `client/src/components/solicitor-aml.tsx`. Tests:
`server/sra-register.test.ts` (in `npm test`),
`qa/regression/sra-register-guards.test.mjs`.

- **The SRA's terms** (Firm data web service, 1 July 2020): free; the data may
  be combined and shown; where it is used the app must link to the SRA's
  attribution statement ("ChatBGP includes data supplied by the Solicitors
  Regulation Authority", `SRA_ATTRIBUTION_WORDS` / `SRA_ATTRIBUTION_URL`: at
  the foot of the Solicitors panel and as a row of the risk assessment in the
  AML file); nothing may suggest the SRA endorses BGP; the key stays
  confidential (sent only to the SRA's host, never logged). The terms cap
  reads a day, so the app reads the data at most once a day, on the first
  check or connection test after that, keeps it in memory (about 35 MB),
  waits ten minutes after a failed read, and uses the copy it holds
  meanwhile. Never at boot or on a timer.
- **Which firm a name means** (`findSraFirm`): an SRA number or a web or
  email address finds the entry; a name is read without case, punctuation,
  "&" or the legal form, and loosely without the words every law firm uses
  ("Solicitors", "Law", "& Co", "UK", "International"). A firm stands out when
  it is the one regulated firm under exactly that name; else the one SRA firm
  of that exact name that has closed, is closing or was closed down; else,
  when the exact name holds only entries not regulated for legal services (a
  big firm's international partnership or offices abroad), the one regulated
  firm under the looser name (Eversheds Sutherland is Eversheds Sutherland
  (International) LLP), or that entry itself with no regulated firm near; else
  the one firm trading or formerly trading under the name. Anything else is
  the person's choice: the check answers `{ choose, candidates }` before it
  runs anything (regulated firms first, then by size), with **This one** and
  **None of these**; a firm the check settled on offers **Not them?** with
  the other entries. Some firms are not in the SRA's data under the name
  people use (Taylor Wessing's firm in England and Wales was not, on
  21 November 2026), so not found and not regulated read as "needs a look",
  never as a red flag by themselves.
- **The words are the SRA register's own** (`sraStatus`, read from its
  organisation pages): SRA-regulated firm (ok); SRA-regulated freelance;
  Regulated by an approved regulator for legal services (the CLC and others,
  ok); Firm is closing (a look); Not regulated by an approved regulator for
  legal services, and Not an SRA-regulated firm (a look: they cannot provide
  reserved legal activities such as conveyancing); SRA-regulated firm,
  conditions apply, Firm has closed, and Closed down by the SRA (an
  intervention) are red. The panel shows the head office, phone, email and
  website with "check the email address and phone number you have for them
  match the SRA's: fraudsters pose as real law firms", other names, the work
  the firm lists, its Companies House number and its SRA page.
- The web search for regulatory action or misconduct (Perplexity) still runs,
  under the SRA's name for the firm. Without the key, or when the SRA's data
  cannot be read, the register is searched on the web as before and the
  check says why.
- The connection test on Subscriptions & APIs (**Test Apollo / Xero / CH /
  ComplyAdvantage / SRA**) says how many entries the app holds and when it
  read them; `SRA_API_KEY` is on the KYC group of the integrations list.
- Tried end to end on 21 November 2026 against the SRA's real data on a local
  copy (Forsters, DLA Piper's 36 entries, Glen Solicitors closed down by the
  SRA, a firm not in the data), with the key the session's proxy added. In
  that sandbox Node's fetch needed the proxy set as its dispatcher; on
  Railway the app calls the SRA directly. Not run on live yet.
- **Our client's solicitors too** (Woody, 23 November 2026: "we need our
  clients solicitors checked at SRA too I think"). Each check records whose
  solicitors the firm is (`side`: "client" or "other", `solicitorSideOf` in
  `shared/solicitor-aml.ts`; a check from before is our client's when it is
  the firm the transaction records as its `solicitor_firm`). The Solicitors
  line in the AML box has **Our client's solicitors** (the transaction's
  firm offered with **Check them**) and **The other side's solicitors**,
  each with its own box; checking our client's solicitors on a transaction
  that records none records them (`solicitor_firm`, a history line). The
  heads of terms' **Save and check at the SRA** saves our client's
  solicitors and checks them in the same press. The risk assessment lists
  both sides, each "Not checked yet" until checked. Tests in
  `server/sra-register.test.ts`, `server/aml-risk-assessment.test.ts`.
- **Our client's solicitors: the SRA check only** (Woody, the same evening:
  "with the solcitors dont we just need to check they are an SRA firm? do
  we need this other info for HMRC?"). HMRC asks for no check on
  solicitors; BGP's policy (Issue 4, counterparties) asks "Is there any
  negative media around the agent and / or solicitor?" and the size and
  reputation of the law firm, of the counterparty's only. So
  `runSolicitorCheck` runs the web search for the other side's solicitors
  only (`wantMedia`), and `solicitorCheckWords` leaves a web search an
  earlier check ran on our client's solicitors out of their words and tone
  (`solicitorMediaCounts`); the panel hides those results. The web search
  leaves out an allegation that was dismissed or found no case to answer
  (Simmons & Simmons read red for a dismissed tribunal application).


## KYC4U's files kept in the app, and KYC4U in Subscriptions & APIs (Woody, 2026-11-21)

Woody, on KYC4U's site holding every file of BGP's requests (10,813 items
on 21 November 2026): "can we get everything kept on our server from
them?", then "yes build it so we keep all documents in the app", and "Move
KYC4U into subscriptions and APIS when done as we shouldn't need it again
really". Do not re-litigate. Rules: `shared/kyc4u-archive.ts`; server:
`server/kyc4u-archive.ts`; the bookmark's window:
`client/src/pages/kyc4u-import.tsx`; the card:
`client/src/components/kyc4u-archive-card.tsx`. Tests:
`server/kyc4u-archive.test.ts` (in `npm test`),
`qa/regression/kyc4u-archive-guards.test.mjs`.

- **The copy runs in the Send to ChatBGP bookmark** (version 2, `v:2` on its
  message; the October bookmark has to be dragged again). After it sends the
  requests, its window asks it to list every file in KYC4U's document
  libraries (`$select` with `UniqueId` and `File_x0020_Size`, read again
  without them if SharePoint refuses), sends the list to `POST
  /api/kyc4u/archive/plan`, and for each file the app does not hold asks the
  bookmark for its bytes (`GetFileByServerRelativePath(...)/$value`, then
  `?download=1`) and hands them to `POST /api/kyc4u/archive/file`, three at a
  time. Reads only on KYC4U's side, with the user's own login; the bookmark
  answers only the app's window (`e.source===w`) and the window only KYC4U's
  tab. Stop, a closed tab or a closed window lose nothing: a second click
  copies only what is missing, and retries files that failed.
- **What is kept** (`kyc4u_archive_files`, boot migration): one row per file
  version (`archiveKey`: SharePoint's UniqueId, else the path, with the time
  it changed: a changed file is kept as well as the earlier one), its place,
  REQ reference and entity (`archiveFileFacts`: the request folder at any
  depth, a folder named just the REQ number skipped), heading and document
  type (`kyc4uPackPlace`, the zip's rules), status (listed, copied, too_large
  over 25 MB, failed), and the stored copy (`chat-media/kyc4u-arc-…`, in the
  app's database). Only paths on KYC4U's own site are listed
  (`listedFileProblem`).
- **Filing**: a copied file in a request folder goes on the KYC record
  (`kyc_documents`) of the company its KYC4U request is matched to
  (`REQUEST_COMPANY_SQL`: the request row with that REQ, or a KYC4U result
  recorded in the app with that reference; a hand-set match first), with the
  deal when a request was raised from one. A document the company already
  has (same name and size, e.g. from KYC4U's zip) is linked, not filed twice.
  `refileKyc4uArchive` files and moves them when a request is matched or
  re-matched: after every bookmark import, after Rematch, after a hand match
  (`PATCH /api/kyc4u/requests/…`). Unmatched folders are listed on the card
  with **Match to a company** (that PATCH); files outside a request folder and
  files not copied are listed too. Files open through
  `GET /api/kyc4u/archive/files/:id` (nosniff, a download unless an image).
  Every archive route is admins only.
- **Five-year deletion and merges** cover the table (`PARTY_TABLES`,
  `deleteParty` deleting the stored copies; `COMPANY_REFS`). Unmatched files
  are not on the five-year list until they are matched.
- **KYC4U in Subscriptions & APIs**: the KYC4U section of `/subscriptions`
  (folded; **Open KYC4U**, or `?section=kyc4u`, opens `Kyc4uPanel`); the KYC4U
  card in the list links to it. `/kyc-clouseau` and its aliases
  (`client/src/pages/kyc-hub.tsx`) and `/hr?section=kyc4u` forward there with
  what the address carried; Microsoft's return after Connect lands there. The
  **client check emails** card (`KycEmailsAdmin`, BGP's own client checks, not
  KYC4U) moved to the AML dashboard's **Client check emails** pill (admins).
- **The status table**: a bookmark run on 21 November 2026 brought 482
  request folders and no verdicts. KYC4U's verdicts come only from the table
  on their View Requests Status page; the import now saves which page the
  bookmark ran on and how many status rows it read (`diag.page`).
- Tried end to end on 21 November 2026 against a stand-in KYC4U site in a
  browser (the real bookmark code, the window and a local copy): 8 files
  listed, 6 copied, 3 filed on the company a recorded result named, 1 over
  25 MB and 1 refused listed, a second run copying nothing again, a hand
  match filing its folder's files, and no request to KYC4U but reads. Not
  run against KYC4U's real site from a build machine.

## KYC4U's packs checked against BGP's own checks (Woody, 2026-11-21)

Woody uploaded seven of KYC4U's packs (REQ112444 LEGO, REQ101253 Otherworld
Piccadilly, REQ114157 Brasserie Bordelaise, REQ114299 Sushidog (Bluewater),
REQ113998 LTMM Group (Piece of Velvet), REQ113922 Addington, REQ113570 The
Abigail Scheuer Trading Company (Choux)): "can you check these all and make
sure we are covering everyhting in these", "that if we didnt use KYC4U we
would be fine and where the gaos are", and "can you run all those checks via
our system and check along side what KYC4U did to see if we get the same".

- **BGP's checks were run on live** on the four that are on deals, as Woody
  (the QA token), on 21 November 2026. On three, the deal named no company
  that signs, so KYC4U's entity was added under the brand from Companies House
  with no Xero contact (`POST /api/billing-entities`, `xero: false`) and set as
  the tenant's company that signs: SUSHIDOG (BLUEWATER) LIMITED (17434171) on
  d4fbec63 (Bluewater EVL02), BRASSERIE BORDELAISE LIMITED (17510452) on
  15e9db11 (89 Charterhouse Street; db755474 is a second live SOL deal for the
  same letting, a duplicate left as it was), THE ABIGAIL SCHEUER TRADING
  COMPANY LIMITED (09275764) on 2201c032 (Portman Estate - Choux T2, whose
  brand also has T2 TEA (UK) LIMITED filed under it, probably wrongly). LEGO
  (79f1333a) already signed as LEGO COMPANY LIMITED. LTMM, Addington and
  Otherworld are on no deal in the app, so they were not run.
- **What matched**: the company, its owners (Claude Bosi; Abigail Scheuer;
  Sushidog Limited and, behind it, Nicholas Goldstein and Gregory Ilsen, whom
  the app screened as the directors standing in under reg 28(6) and KYC4U as
  the largest shareholders who are directors), nationality and date of birth,
  no sanctions match, no adverse media, and the cash-intensive restaurant risk.
  The app also warns of a newly formed company with no accounts (KYC4U did
  not) and showed both Sushidog directors' Companies House identity
  verification.
- **What did not, and was fixed**: (1) the web search returned "found no
  source establishing that the company is ... state-owned ..., or that its
  director is a politically exposed person" as a public-role finding on
  Brasserie Bordelaise, and the app raised it as a red flag and made the party
  enhanced. A finding whose every sentence says nothing was found, or only
  restates the register, is now no finding (`webFindingSaysNothing`,
  `webFindingsOf` in `shared/kyc-prechecks.ts`), at run time and when stored
  checks are read; a sentence with "but" and something found keeps it, and
  anything else keeps it, so a real finding is never dropped. Both web prompts
  say a finding never states that nothing was found. The company flag reads
  "Possibly owned or controlled by the state or a politically exposed person"
  (it read "a public figure", which is not the question asked; the flag's key
  is unchanged, so set-asides stand). LEGO carried the same kind of flag; its
  words were not read (that would have started a paid check on the landlord).
  They were read on 24 November 2026 and slipped through: "No public-role
  information identified" (a word between "no" and what was not found),
  "Confirms company number ... matching the queried company" (the register
  restated) and a last sentence cut at 300 characters ("No qualifying
  publi"). `webFindingSaysNothing` now takes up to three words between "no"
  and the thing ("no longer" is never nothing), reads "confirms company
  number / registered office" and "matching the queried company" as the
  register, and reads a cut last sentence of 40 characters or fewer that
  opens with "No", "Nothing", "None" or "There is no" as saying nothing; any
  other cut sentence keeps the finding. St George plc's run of the same day
  raised "Companies House identifies The Berkeley Group plc as holding 75% or
  more of ST GEORGE PLC's shares ... provide no indication that this parent is
  government- or state-owned": "identifies" now reads as the register
  restated, like lists, shows, names and records.
  (2) Companies House writes 9999-12-31 for a date not set: the app read it
  as "identity verification statement removed on 31 Dec 9999" (Choux). It is
  no date now (`idvOf`, `idvState`).
- **The pack reader, run over the seven real packs** (`shared/kyc4u-result-pack.ts`,
  `server/kyc4u-result-pack.ts`): a pack downloaded from KYC4U's site is
  wrapped twice (`REQ113570  Name/REQ113570/…`), and every shared wrapper now
  comes off (`unwrapPackPaths`; before, only one did, so headings read
  "REQ114157 · HOTs"). KYC4U's assessment comes in three layouts
  (`readKyc4uAssessment`): RISK IDENTIFIED / MITIGATING FACTORS / OVERALL
  CONCLUSION one under another; a "Risk Identified | Mitigation" table and an
  "Overall Conclusion", whose columns plain text runs together, read by
  position on the server (`kyc4uRiskTable`, pdf.js: each piece of text goes to
  the column it sits under, divided halfway between the two headings' centres,
  across a page break); and on a sanctions-only check one paragraph, which is
  the conclusion. A heading counts only on a line of its own ("Considering the
  mitigating factors" in a conclusion was read as one). New document types:
  `id_check_report` (ComplyCube's Document Check), `electronic_id_check`
  (Multi-Bureau Check), `agent_confirmation`, `adviser_check` (an Advisors
  folder, Law Society or SRA proof), `regulator_register` (FCA register),
  and accounts, confirmation statements and incorporation certificates by
  name. A loose file is filed by its name (KYC4U's 2023 packs keep every file
  loose); only an email is KYC4U's report by default. Tests:
  `server/kyc4u-result-pack.test.ts`.
- **KYC4U's own tools, read from the packs**:
  - **Creditsafe**, for every company and parent: a credit report whose
    Compliance Alerts screen at 90%, and an "AML Screen" report (Acuris data,
    threshold 95). The parent's Creditsafe report was used on 1, 3 and 6.
  - **ComplyCube**, for each person on packs 6 and 922: Document Check,
    Multi-Bureau Check, Proof of Address Check, Extensive Screening at 90%.
    KYC4U's analyst uploaded copies of the documents, so no face match or
    liveness check was run on the person, unlike Veriff. The Multi-Bureau
    check matches name, date of birth and address at a credit agency.
  - **Famous owners** were verified as a "Public figure" from press pages, with
    no ID documents (LEGO, Otherworld, Brasserie Bordelaise).
  - **What no pack did**: no source of funds or structure chart was asked
    ("Not required - simple structure", Sushidog's holding company included),
    and no pack records the Nominated Officer's approval.
  - **Errors in KYC4U's packs**:
    - Sushidog's risk text names "Sushidog (Victoria) Limited".
    - Its ComplyCube checks were run under another request (REQ113960).
    - Its address proofs about 15 months old were accepted.
    - Choux's report gives "3 Loxton Walk" where the heads of terms are 20 New
      Quebec Street.
    - LTMM Group Ltd was checked where the heads of terms name "Michael Morgan
      t/a Piece of Velvet", after an agent's email that could not be read.
- **Where the app falls short of KYC4U** (told to Woody; none built yet):
  - **Foreign parents** (LEGO's Kirkbi A/S, from the Danish register). The app
    reads no foreign register. Where the UK register says no one has
    significant control, it does not know a foreign parent exists: it asks the
    client for a structure chart. Woody's rule sends foreign-owned parties to
    KYC4U. A build could read the "ultimate parent" note in the accounts the app
    already downloads.
  - **Rent not recorded on a deal**, so the app cannot tell a sanctions-only
    letting (under £10,000 a month) from a full one (Choux, Brasserie
    Bordelaise).
  - **Smaller gaps**: none is required by the Money Laundering Regulations or
    HMRC's guidance, and that is the test Woody applies (2026-11-21: "It's not
    really our policy it's HMRC that's all we care about"; do not re-litigate).
    Two are required by BGP's own AML policy (Issue 2) as written, and one in
    some cases. HMRC checks that a firm follows its own written procedures (MLR
    reg 19), so the policy's wording should follow what the app does: that is a
    new issue for Jack to sign, not a build.
    - **A report from an aggregator database** ("Creditsafe/SmartSearch/D&B/Dow
      Jones etc"). The policy lists it under Evidence Required for a limited
      company, a partnership or LLP, a listed company and a regulated
      institution. The app has none. Either take a Creditsafe (or similar)
      account, or a new issue of the policy accepts the app's Companies House
      reading and screening in its place.
    - **Whether the person was met face to face.** The policy ("Compliance
      Report for all Individuals (Non-face to face)") says that, if we have not
      met them, all documents must be certified, or a video call can stand in
      "provided the individual can be identified and validated against the
      document supplied". The app records neither the meeting nor that Veriff
      stands in for it. The fix is the agent's note (KYC4U's "Client
      Background"), or a new issue of the policy naming Veriff's face match.
    - **The FCA register**, only when a party is itself an FCA-regulated firm.
      The policy's "Regulated Credit or Financial Institutions" asks for a copy
      of the regulator's web page. It is not needed for minority investors like
      Otherworld's.
    - **Not needed**:
      - an electronic multi-bureau check (the policy's "electronic ID
        verification service" is met by Veriff);
      - an owner's other directorships;
      - an individual solicitor at the SRA.
    - **Advisable only for a newly formed subsidiary with no accounts**: the
      parent's accounts and confirmation statement. The policy asks for
      "Annual accounts" and "Share registers"; KYC4U used Sushidog's parent.
    - **Small, by the policy's evidence lists**: a copy of the listing page for
      a listed company, and of the SRA page in the file.

## Companies owned from abroad, traced in the app (Woody, 2026-11-21)

Woody asked how BGP could research companies owned from abroad, then how
KYC4U do it. Their LEGO pack (REQ112444) showed four steps: Creditsafe's group
structure for the UK company, the parent's Danish register page printed by
hand (legal owners public; the beneficial owners section locked behind an
access request), the family foundation's register page, and the owner
verified as a public figure. His answer: "Ok so let's make sure all of that is
built and then need to work out if a credit safe report international is
required." **The rule that sends a party owned from abroad to KYC4U is
unchanged** (the Next step, the red box, BGP's sign-off refused until
KYC4U's result): the trace gathers, it does not decide. Letting the officers
sign off a fully traced chain without KYC4U waits on Woody's Creditsafe
decision. Rules: `shared/foreign-owners.ts` (and its display words,
`shared/foreign-owner-words.ts`, apart so `shared/kyc-prechecks.ts` can use
them without a loop); server: `server/kyc-abroad.ts`, `server/gleif.ts`,
`server/kyc-structure-chart.ts`; screen: `client/src/components/aml-abroad.tsx`.
Tests: `server/foreign-owners.test.ts`, `server/kyc-abroad.test.ts` (both in
`npm test`), `qa/regression/foreign-owners-guards.test.mjs`.

- **The parent note in the accounts** (Companies Act 2006 s.409 and the
  accounts regulations): the ultimate parent, the parents of the largest and
  smallest groups that consolidate it, the ultimate controlling party, or none.
  BGP's checks before asking read it from the accounts they already file: a
  filing with text by rules (`readParentNote`), a scanned filing (LEGO's 2025
  accounts are 41 pages of image) only when the register names no owner,
  from its pages 2 to 6 and last four, by the reader (Anthropic, called
  directly, forced tool `read_parent_note`, `ACCOUNTS_PARENT_READER_DAILY_CAP`
  a day, default 40, 0 = off), each name kept only when its own words hold it
  (`checkParentNoteAnswer`). The same filing is not read twice.
- **When the register names no owner**, the top foreign parent the accounts
  name (the ultimate parent or controlling party, else the parent named)
  joins the owners abroad (`via: "accounts"`), so the party reads as owned
  from abroad. On live on 21 November 2026 only one of 801 parties was flagged
  owned from abroad (35 Dover St, owned through Scp Aaa Invest, Monaco): LEGO
  Company Limited (00368236) tells Companies House no one has significant
  control, and its accounts name KIRKBI A/S, Denmark. When the register names
  owners, a foreign parent in the accounts is traced and shown, not added.
- **GLEIF** (`server/gleif.ts`): the free worldwide register of legal entity
  identifiers, no key, open data. Each company abroad (at most four a run) is
  found by its registration number, else exactly its name in its country
  (`pickGleifRecord`: two of one name is no pick), then each direct parent in
  turn up to six, and the reason at the top (`gleifTop`: owned by individuals,
  no known person, not consolidated, not disclosed). Requests are paced one a
  second, each time-limited, never throw; `GLEIF=off` stops them. Run live from
  a build machine on 21 November 2026: KIRKBI A/S, LEI 5493005XXPWUMR2E5305,
  owned by individuals; LEGO A/S has no LEI; Scp Aaa Invest, LEI
  2549002JBQR12CTXAH84, owned by individuals.
- The trace is stored on the run (`result.abroad`: the accounts' reading and
  each company traced), screened like the chain (the companies abroad and
  their GLEIF parents against the sanctions lists, the web and
  ComplyAdvantage), and shown as lines in the company facts
  (`abroadTraceLines`), KYC4U's note and the AML file's risk assessment.
- **What BGP records against a company abroad** (`kyc_abroad_records`, boot
  migration; BGP staff signed in as themselves): its register page (a link
  copied to PDF through the web-page copier, filed as `web_source`), a
  register extract or a structure chart (filed as `register_extract` or
  `structure_chart`), a note, or **a person behind it** (name, how they own or
  control it, nationality, month and year of birth). A person recorded joins
  People to check as an owner ("behind KIRKBI A/S (Denmark): …"), is screened
  as a beneficial owner on a fresh run started at once, and answers the
  company abroad's "the people behind …" line (also when recorded behind a
  parent GLEIF found above it); they then need their identity check (their own
  link) or verifying from public sources. Records can be taken off; five-year
  deletion and company merges cover the table.
- **The client's structure chart** (the client checks' ownership step, or one
  BGP adds) is read once (`server/kyc-structure-chart.ts`, Anthropic,
  `STRUCTURE_CHART_READER_DAILY_CAP`, default 40) and compared with what the
  app found (`compareChart`: matches, on the chart only, found by the app only;
  company names compared with their legal form, `sameCompany`, so "LEGO A/S"
  is not "LEGO Company Limited"). It lists; it never decides.
- **The screen**: an **Owners abroad** section in each party's AML box, after
  Company, when the party is owned from abroad or its accounts name a parent:
  each company abroad with what was found, who is recorded behind it, what is
  still to find, and **Add its register page**, **Add a register extract**,
  **Record a person behind it**, **Add a note**, **Add a structure chart**; then
  what the app traced (the accounts' words, each GLEIF line with a link to its
  record) and the structure charts with their comparison. With no owner
  abroad (the accounts name UK parents only) the section is titled
  **Parent companies** (23 November 2026).
- **Free registers abroad** (checked 21 November 2026): Denmark's CVR shows a
  company's legal owners (shares and votes) to anyone; its beneficial owners
  are behind an access request. Most EU beneficial ownership registers closed
  to the public after the EU court's ruling of 22 November 2022; under the EU's
  new rules (Directive 2024/1640, Article 12, due by 10 July 2026) a firm in a
  non-EU country under AML rules, such as BGP, may apply for access for its
  customer due diligence. Monaco's register is by request. Scripted reads of
  CVR are blocked (a browser check), so a person saves the page.
- Not run against Anthropic from a build machine (the scan and chart
  readers). Not built: Creditsafe (Woody's decision), the officers signing off
  a traced chain without KYC4U, reading foreign registers by API, applying for
  EU access.

## The deal page (Woody, 2026-11-18) — docs/deal-page-review-2026-11-18.md

Woody, on the deal page: "Needs a chat box too no and how the negotiations
have evolved etc then the tasks list for the deal? Responsibility etc?",
"need full time line of deal tracking from marketing to completion", "bring
up to the same level as Landsec". He answered "Yep go ahead" to steps 3, 4,
5 and 7 of the review with its two suggestions: the chat box is the
property's shared conversation cut to the deal, and the clock is on every
letting with waiting-on settable by BGP staff on any letting. Do not
re-litigate. Rules (pure): `shared/deal-page.ts`; reads:
`server/deal-page.ts`; page: `client/src/components/deal-detail.tsx` with
its parts in `client/src/components/deal-page/`. Tests:
`server/deal-page.test.ts` (in `npm test`),
`qa/regression/deal-page-guards.test.mjs`.

- **The frame**: `CompanyKindPage` (the landlord and brand pages' frame),
  one section at a time in `?section=`, the same page for every login and
  cut on the server. Its two new options (`sectionTestPrefix`,
  `scrollOnPhone`: the pills in one scrolling row on a phone) leave the
  company pages as they were. The right rail and the phone's own pills are
  gone: every card they held is in a pill. **Header line**: Deal, type and
  Ref #, the name, the stage chip, days at stage (settable), **Waiting on**,
  property, counterparty, target date, "<unit> on the Letting Tracker"
  (`trackerUnitHref`), the tenancy chip, then **Edit** and one **More** menu
  (Image Studio, Document, Delete). A joint agent has no Edit, Image Studio
  or Delete. Then the **stage strip**, then the **Conversation** line.
- **The stage strip** (`buildStageStrip`): Marketing → Negotiating → HOTs →
  Solicitors → Exchanged → Completed → Invoiced (an investment deal from
  Solicitors, Jack's rule), each step's day reached, days there and who
  moved it, from the deal's status moves in `deal_audit_log` (refused moves
  left out by `statusLineIsMoveSql`; a bulk-stamped move is unconfirmed, the
  days-at-stage rule) and its own dates (instructed, exchanged, completed;
  invoiced for BGP staff). The stage it is at takes `resolveStageSince`'s
  date, so the strip and days at stage never disagree. A deal on the Letting
  Tracker reads as a letting whatever it is typed (Marketing, not Available).
- **The reads**, keyed by the deal and writing nothing:
  `GET /api/crm/deals/:id/page` (names, stage, strip, clock, the letting,
  the checklist, tasks) and `GET /api/crm/deals/:id/timeline`. Who may read
  is who may open the deal (`viewerFor`, as `GET /api/crm/deals/:id`); the
  letting's pieces only for a caller who may open the unit's brief
  (`briefAccess`). The tracker unit is the row that points at the deal,
  else (a letting) the row on its unit, which a deal keeps after the unit is
  re-marketed: then `current` is false, its own checklist and recommendation
  show read only, its offers and the unit's events are the ones in its
  window (`lettingWindow`: from the deal, when an earlier letting on the unit
  came before it, to the deal that replaced it), and the unit's own dialogs
  are not offered. The page sends the names it draws with (`namesFor`), so
  it no longer downloads the whole company, contact, property and property
  unit lists on every open: the party pickers, linked contacts and the edit
  dialogs load them when opened. A joint agent is sent company names with
  no ids, a contact's name on an offer only on its own offer, and no folder
  links or unit record; it reaches the two reads through
  `JOINT_AGENT_DEAL_PAGE` (GET only).
- **The clock for every letting**: `clockWriterFor` in
  `server/landsec-unit.ts` is the one rule for who writes a deal's clock
  (the waiting-on, and the date a deal reached its stage): a Landsec login,
  or BGP staff, at the deal's scheme as before (`unitAccess`), and BGP staff
  signed in as themselves (`contactViewer`) on any letting (`isLettingType`,
  or a deal with a Letting Tracker row). The clock route
  (`PUT /api/landsec/deal/:id/clock`), its waiting-options and the
  checklist's "Deal is waiting on this" (`mayWriteClock`, `clockOpenAt`) all
  ask it; "depends on" names any deal for BGP staff (`dependsOnFor` with
  `visible` null: only a deal that has gone is hidden). `clockForDeal` reads
  one deal's clock by the feed's own rules; a closed deal waits on no one.
  The old Landsec-only `DealClockCard` is gone.
- **The pills** (`dealPageSections`): Overview (the deal clock, **Owed now**
  (`owedItems`), the dates and terms cards, a client's BGP fee, the activity
  feed), Timeline, Negotiation (a deal with a tracker unit: offers with every
  position, Heads of Terms, the recommendation, the brief, viewings),
  Checklist & tasks ("Tasks" without a unit: waiting on, the checklist by
  stage with who is responsible, and every task linked to the deal:
  `user_tasks.linked_deal_id` less the checklist's own; BGP staff read every
  one, anyone else its own; **Add a task**), Parties & AML ("Parties" for a
  client login; the AML card is read only here, so BGP's paid checks before
  asking start only when this pill is opened), Fees & invoicing (BGP staff),
  Files (the unit's files; the property folder for BGP staff) and History
  (the change log; not a joint agent). The letting's dialogs
  (`letting-dialogs.tsx`) open only when asked, and the unit's own ones only
  on its current letting.
- **The timeline** (`buildDealTimeline`): added, instructed, stage moves,
  the brief agreed, viewings, each offer position and terms agreed, the
  Heads of Terms steps (`unit_hots_events`), the recommendation, checklist
  items done, exchange and completion, and for BGP staff only
  (`STAFF_ONLY_EVENTS`) the AML lines (`aml_sign_off`, `kyc4u_result`, the
  KYC approval and AML check changes, client checks sent and finished, KYC4U
  requests) and invoices. A client check's token is never selected. Each
  event opens what is behind it. It replaces `GET /api/deals/:dealId/timeline`
  and the old `DealTimeline` (both deleted).
- **The conversation** (`deal-conversation.tsx`): the property's one shared
  thread (`server/record-conversation.ts`), cut to the messages that tag the
  deal or its tracker unit; a message written there is tagged with both, so
  it shows in the property's conversation and as the unit's Letting Tracker
  comment. Opening the box joins the thread (as on the property page); the
  closed line reads only `GET /api/chat/threads/record/deal-comments`
  (`propertyReadBlocked`, never joins; a joint agent's gateway does not open
  it, so its line shows no count). A joint agent tags the deal only while it
  is live. The old Comments box (`crm_deals.comments`) is read only as
  **Earlier notes on the deal**; its POST route stays for other callers.
- **The activity feed on a deal** leaves out the deal's own moves (they are
  on the Timeline) and never links back to the deal it is on; its filter
  pills show only when they would change something.
- Also fixed: the unit editor on the heading opened with blank address
  fields (the unit list route does not send them), so Save blanked the
  unit's address; it now starts from the unit record (`names.unit`).
- Checked in a browser against a local copy on 18 November 2026 (staff on
  desktop and an iPhone profile, the Landsec client login). Not built: the
  deal clock columns on the Deals list for every letting (they are still the
  Landsec view's); a client login adds a task to its own list only from the
  deal page; brand profiles have no pill of their own (they are folded under
  Parties, as the old Brand tab's cards).

## Emails come from chatbgp.app (Woody, 2026-11-17)

**Superseded on 23 November 2026** (Woody: "emails still coming from
chatbgp.app", after AML emails moved to kyc@brucegillinghampollard.com the
same day): every email now goes from BGP's own domain first. `senderOrder` in
`server/shared-mailbox.ts` puts BGP's shared mailbox
(chatbgp@brucegillinghampollard.com) before the app's chatbgp1@chatbgp.app,
which is tried only when Microsoft refuses the shared mailbox; AML emails
never use it. A workspace's own mailbox still goes first, so emails about a
Landsec property still come from landsec2@chatbgp.app (Woody's choice of
12 November): whether those move too is Woody's call. Read the rest of this
section as history.

Woody: "just use chatbgp.app for all emails now". Every email the app sends
goes through `sendFromFirstMailbox` in `server/shared-mailbox.ts` (the old
`sendFromSharedMailbox`, `sendSharedMailboxEmail`, `sendWorkspaceEmail` and
the KYC sender all call it): the first address Microsoft takes, in the order
`senderOrder` gives: a workspace's own (landsec2@chatbgp.app) or the KYC
mailbox (kyc@chatbgp.app) where there is one, then `APP_MAILBOX`
(chatbgp1@chatbgp.app unless set), then the shared mailbox
(chatbgp@brucegillinghampollard.com). An address refused while the next one
took the same email is skipped for an hour. From the app's address, replies
go to the shared mailbox (`replyTo`), which the app reads; the KYC and
Landsec addresses take their own replies. Replies to an email in the shared
mailbox stay in its thread, from there; staff sending as themselves
(`/me/sendMail`) are unchanged. Tests: `server/app-mailbox.test.ts`.

- **The app's own addresses are never a person or a firm**
  (`isAppAddress` in `shared/app-mailbox.ts`; `INTERNAL_DOMAIN_RE` in
  `server/tracker-correspondence.ts` now matches chatbgp.app): the hourly
  contact auto-adding, the suggested contacts and the shared inbox reader
  skip them. A new reader of staff mail must too.
- **DNS** (set through Porkbun on 17 November 2026, checked live): MX
  `0 chatbgp-app.mail.protection.outlook.com`, SPF
  `v=spf1 include:spf.protection.outlook.com -all`, `autodiscover` CNAME to
  `autodiscover.outlook.com`, DMARC `p=none`.
- **Microsoft 365, done by Woody on 17 November 2026**: chatbgp.app added
  and verified (the TXT record `MS=ms36600512` was added at Porkbun through
  its API; Microsoft found the MX, SPF and autodiscover records already in
  place), and three shared mailboxes made: `chatbgp1@chatbgp.app`,
  `kyc@chatbgp.app` and `landsec2@chatbgp.app`. Microsoft numbered the two
  whose names BGP's Microsoft 365 already uses (the shared mailbox is
  chatbgp@brucegillinghampollard.com), so the defaults in
  `server/shared-mailbox.ts` are those three addresses. A display name can be
  changed in the admin centre without touching the address or the app.
- **DKIM is not set up** (Woody, 2026-11-17, at the Defender portal: "is
  there another solution I have to set up a account and everything"): it is
  optional at BGP's volumes, because SPF passes and aligns for mail sent
  through Microsoft 365 from chatbgp.app. If emails start landing in spam,
  turn it on in the Defender portal (security.microsoft.com → Email
  authentication settings → DKIM → chatbgp.app) and add its two CNAMEs at
  Porkbun. Nothing has been sent from chatbgp.app from a build machine.
- **The live KYC sender is kyc@brucegillinghampollard.com** (read from the
  live admin card on 17 November 2026, when the test request to Jack went
  from it first time): a Railway variable (`KYC_MAILBOX` or the older
  `BGP_AML_MAILBOX`) holds that address and wins over the code's default
  kyc@chatbgp.app. The app's own address on live is chatbgp1@chatbgp.app and
  the shared mailbox follows it, as in the code. **The KYC sender stays
  kyc@brucegillinghampollard.com** (Woody, 2026-11-20: "that emails fine
  working well"). Woody had deleted `KYC_MAILBOX` on Railway the evening
  before and live still sent from this address after two fresh deploys, so
  either the deletion is waiting to be applied in Railway (then discard it)
  or `BGP_AML_MAILBOX` holds the address. Leave it unless Woody asks.
- **AML emails come from kyc@brucegillinghampollard.com, whatever Railway
  holds** (Woody, 2026-11-23: "the email should come from
  KYC@brucegillinghampollard.com? its changed to the app version?"; live's
  admin card read that address and every request of 22 and 23 November went
  from it). `KYC_MAILBOX` now defaults to it (it was kyc@chatbgp.app), and
  `sendKycEmail` never falls back to the app's own address: after the KYC
  mailbox an AML email goes from BGP's shared mailbox
  (`sendFromFirstMailbox`'s `appMailbox: false`, `senderOrder`'s third
  argument). This supersedes "the first address Microsoft takes ... then
  APP_MAILBOX" for AML emails; every other email is unchanged. Tests:
  `server/app-mailbox.test.ts`, `qa/regression/kyc-client-checks.test.mjs`.

## Super Brands are BGP's VIP brands (Woody, 2026-11-17)

Woody, on the Brands overview's Super Brands card: "super brand lets have
those as VIP CRM brands have we got a star or something for those? then we
know they are prime targets for expansion via our choice ... they get the CRM
VIP treatment and massive focus?", then "superbrands just has beaverbrooks
which I know for sure isn't a super brand so its not doing anything". The
card had listed every brand typed Luxury, Flagship Fashion or Luxury
Accessories; nobody chose them.

- **The star is the brand's `hunter_flag`**, the hand-set "Hunter pick"
  until then (described in the schema as "manually flagged as a hot
  expansion target"). Asked whether Super Brand should be that flag or a new
  one, Woody sent no answer, so it is the one star (no database change);
  today's Hunter picks became Super Brands. Splitting them later needs a new
  column.
- **Who sets it**: BGP staff signed in as themselves (`contactViewer`), with
  `POST /api/brands/:id/super-brand { on }` (the state wanted, so a double
  press holds) or the older toggle `POST /api/brands/:id/hunter-flag`, now
  staff only too. A client login's brand save (`PATCH /api/brand/:companyId`)
  has the flag taken out, as "On hold" is. A client login still sees the
  badge on a brand's page (the brand page's cut kept the Hunter pick).
- **Screens**: the brand page's header has **Make Super Brand** / **Super
  Brand** (`SuperBrandStar` in
  `client/src/components/brand-page/super-brand-star.tsx`, staff only;
  everyone else `SuperBrandBadge`). Starring a brand on no running CRM
  strategy opens Start strategy (the kick-off dialog, nothing saved until
  ticked), and a starred brand with no strategy keeps a Start strategy button
  beside the star. Brand Hunter's bookmark is the star (and its stat tile and
  flag filter say Super Brand); Brand Explorer's filter pill is **Super
  Brands** (`?rel=super` opens on it); the edit form's tick box names it.
  The Overview's **Super Brands** card lists the starred brands
  (`superRows` in `server/crm.ts`), each saying No strategy yet until one
  starts.
- **The CRM's VIP treatment**: the CRM page's Brands list puts Super Brands
  first with a star (`superBrand` on `CrmHubRow`, reason "Super Brand"); the
  Overview's **Watch list** holds every Super Brand, owing "No strategy yet"
  with a Start strategy button until one starts (`server/crm-watch-list.ts`);
  the Brand CRM Targets board lists them for BGP staff before they have a
  line, first, starred (`brandGrid`); and the nightly store count, planning
  and jobs check, accounts read and signal tidy take them first and
  re-check them weekly (`watchedSql` in `server/crm-watch.ts`, a running
  strategy or the star). The Monday brand digest tags them "★ Super Brand".
- Brand Hunter's own ordering score still adds 25 for the flag (it did as
  Hunter pick); the Expansion score is untouched.
- Tests: `qa/regression/super-brand.test.mjs`, `server/super-brand.test.ts`
  (in `npm test`), `server/crm-hub.test.ts`, `server/brand-scheme-plan.test.ts`
  (not in `npm test`; its two stale assertions, from the scheme limit of
  14 November and the category of 16 November, were brought up to date).
- Not built: ChatBGP setting the star; a separate Super Brand flag beside
  the Hunter pick.

## Notes into forms (Woody, 2026-11-13)

Woody: "drop in the basic info and that populate the form". His example:
"Offered: 15 year lease. Rent £120kpax and 9% t/o. 6 MRF". A plain note is
read into the boxes of an offer, a negotiation round, a viewing, a viewing
outcome or an interest line. The reader only suggests: the person checks
what was read, fills the form, and saves through the form's own route.

- **The contract** is `shared/letting-note.ts` (the five kinds, the field
  list, `LettingNoteReading`: fields, the words each value came from,
  `unplaced`, `dropped` with a reason, `saidBy`, `usedAi`, and for a note
  that is not tight `unsure` and `reason`). A key that is absent was not
  stated in the note, or was not sure enough to fill. Change the shape there
  first.
- **The rules reader fills tight shorthand only** (13 November 2026, after
  four review rounds each found free prose put a wrong value in a box).
  `shared/letting-note-parse.ts` reads letting shorthand (pax, t/o, MRF,
  "15 yr", TBO, CC, deposit, premium, reviews, dates, times) and refuses
  rather than guesses. `tightNote` is a POSITIVE test: a note is tight only
  when every word is a term in one of its usual shapes (including "5 yr RR"),
  an opening word (Offer, Offered, Proposed, Terms, HOTs, Rent, Term, Lease;
  Counter, Revised and Now only on a round; Viewing and Viewed on a viewing or
  an outcome; Enquiry, Enquired and Interested on interest; never "We"), a
  known author's stamp (the author, the caller or a staff name, then a date),
  one date, one time (not a slot such as "2-3pm"), a brand already on the
  unit, or a separator; the rules found no rival and refused nothing; they
  read every term exactly as the tight shapes do; and it is about 200
  characters or fewer. It is NOT tight when its date is more than a year
  before the day it is read from (today, or the day a comment was written:
  the terms may be an earlier letting's), when it has a turnover percentage and
  a sum of £500,000 or more, whatever joins them ("£2m pa 9% t/o" is sales), when the
  rent is over £1,500,000 a year, when "10/5" could be a lease and its break, or
  when a weekday, a term (0 or over 50 years), a turnover (over 25%) or a rent
  free (the whole term) does not make sense. On a viewing the author stamp's
  date is never the viewing's date. Only a tight note's rules reading fills the
  form (the owner's example is the model, with no provider call). **Do not add patterns to read free prose**:
  patching patterns one note at a time does not converge, and a wrong value
  in a form is the worst outcome. A note that is not tight goes to
  `guardReading`. A new tight shape comes with its note as a test in
  `server/letting-note.test.ts` (in `npm test`).
- **A note written out in full** (anything that is not tight) fills, with or
  without a provider, ONLY a sure date, a sure time and a brand on the unit
  that the rules found alone (`guardReading`). A sure date is the note's one
  date, not more than a year old, at its head (a known stamp, or nothing
  before it but a brand on the unit and a few plain words) AND with every word
  after it plain too (`sureWhen`: a positive walk; "cancelled", "withdrew",
  "postponed", a question mark or any other word leaves it to check). A sure
  time is the one time, beside a sure date. Everything else the rules or
  Claude read goes into `unsure` (field, value, the words it came from) with a
  plain `reason`: the same value for a box once, two different values as two
  lines, each further brand as its own line. **Claude's reading never fills a
  box by itself, and agreement between Claude and the rules is not proof**
  (review five, 13 November 2026: agreeing readings still filled rejected
  offers, quoting terms and comparables). Do not add "fill when both agree"
  back. Claude's values still pass every literal check first (the quote is in
  the note, the figure is in the quote, the box's own words, no colleague as a
  contact, a brand that is on the unit or one the caller may pick and never
  the unit, the scheme or an agent's firm); a value that fails goes to
  `dropped` with its reason, not to `unsure`. Such a note never fills the
  notes box: `fields.note` is absent, and `unplaced` is shown in the read-back
  only.
- **The route** is `POST /api/unit-offers/unit/:unitId/read-note` in
  `server/unit-note-reader.ts`: `briefAccess()` first, every time. (As built on
  13 November an asset manager was refused here, because that login could
  not save these forms. Superseded the same day: an asset manager is a full
  Landsec login with the Letting Tracker and its forms, and reads a note as
  one does.) A note that is not tight
  goes to Anthropic only, called directly (never the switchable provider
  helpers, because the note can be about a Landsec unit), with
  `CHATBGP_MODEL`, about 1,000 tokens, a 25 second timeout, one call per read
  and a forced tool that quotes every value. It is sent the note, the form
  kind, today's date, the unit and scheme names and the brands already on the
  unit and nothing else, with `<` and `>` taken out. Every value that comes
  back is checked against the note (the quote is in the note, the figure is in
  the quote, no months-to-years conversion) and then by `guardReading`.
  Nothing is stored: no note, no reading, only the day's count and the spend
  line. Daily caps across the app and per login
  (`LETTING_NOTE_READER_DAILY_CAP`, default 1000;
  `LETTING_NOTE_READER_USER_DAILY_CAP`, default 100).
- **The shared box** is `client/src/components/letting-note/note-fill.tsx`
  ("Paste a note": Read note, the read-back, Fill the form). It posts only
  to the read route and never saves. It shows `reason`, then the `unsure`
  values under "Not filled, check these", each with the words it came from
  and a **Use** button: Use hands the form a reading of that ONE key
  (`oneValueReading` in `components/letting-note/note-apply.ts`: no note, no
  unplaced, nothing dropped) and turns into a quiet "Used"; the other lines
  stay. There is no "use all". Fill the form applies only `fields`
  (`readingToFill`, which for a note that is not tight hands over no
  `unplaced` text, because the forms add it to their notes box), and when
  nothing was filled it says so instead of offering the button. **A form applies only the keys present
  in a reading** and keeps what it has for the rest; on a negotiation round
  an absent term carries over from the last position. A value the form has
  no box for goes into its Note or Comments box as labelled words
  ("Contact: ...", "Agent: ...", "Next: ...", "Follow up by ..."), once
  (`addNoteLines` on the staff tracker and on the joint agent's forms).
  A joint agent's forms take typed names: never a contact id or an agent
  firm id from a reading, and a brand id only for a brand already named on
  the unit.
- **The form's own Comments or Notes box is the note** (Woody, 2026-11-14:
  "combine that with paste a note so can actually type in the comments box
  and it then populate the deal and keep the comments shown").
  `FillFromNotes` in `note-fill.tsx` wraps the form's own box on every
  letting form (staff and joint agent offer, viewing and interest forms, the
  round's Note, Record offer, the viewing calendar's Notes for a viewing or
  an outcome). Leaving the box with three or more new words, or pressing
  "Fill the form from these comments", reads it through the same route and
  applies `readingToFill` at once; the read-back (with Use per value) shows
  under the box. The person's words are put back in the box after every fill
  (`keepText`), so the labelled lines the forms add for values with no box
  never land there. Words already in the box when the form opened are not
  read by themselves, and a read that returns after the form closed fills
  nothing. The separate "Paste a note" box stays only where there is no
  comments box (a joint agent editing an offer someone else logged) and for
  "Log as offer / Log as viewing", which read a stored comment.
- **A note with more than one rent lists each to choose from** (Woody,
  2026-11-15: "list both rent"). The rules still fill none (the offer and a
  previous tenant's, a stepped rent, a rent that was turned down). The
  shorthand reading carries `rentOptions` (each figure with the words that
  lead up to it; never a net effective rent), and `guardReading` lists them
  as `unsure` lines for `rentPa`, each with its own Use. The read-back then
  has no "Left out: rent". A range ("£100k-£120k") is still left out.
- **The email behind an offer is read by the same reader** (Woody,
  2026-11-15: email bodies are read). The email pop-out on an offer the
  inbox sweep found (`tracker-source.tsx`, `POST
  /api/tracker/offer/:offerId/extract`, BGP staff only) reads the newest
  outside message that states the offer, without the messages quoted under
  it (`offerMessageWords` in `server/email-contact-reader.ts`), through
  `readLettingNote`. Each value comes back with the words it came from and a
  tick box; a box with two values (two rents) is left for the person to
  choose; **Apply to offer** fills the edit form with the ticked lines and
  saves nothing. It replaced a looser reader that converted rents per
  square foot and checked no quote.
- **Log as offer / Log as viewing** on a target's comments (staff Letting
  Tracker) is BGP staff only, because the comments are BGP's notes. The
  server fetches the comment by target id and timestamp
  (`source: { type: "target_comment" }`); the client never sends its words,
  and every other login gets the same refusal whether or not the comment
  exists. It opens the Add form filled from the comment; the comment is not
  changed.
- **Never make the reader save**, and never route "drop a note in" through
  ChatBGP's `log_offer`, which saves at once with no form to check.
- Woody said yes to reading team chat and email bodies on 15 November 2026.
  Built: Letting Tracker comments as a source of comments not yet logged
  (below), and the offer email read above. NOT built: reading private chat
  threads or ChatBGP conversations, and raising a suggestion from an email
  (the inbox sweep already makes an unconfirmed offer or interest row).
- **Comments not yet logged** (Woody, 2026-11-13: "yes to table"). A comment
  that reads as an offer or a viewing, with none logged for that unit and
  brand, is a SUGGESTION in `letting_suggestions` (migration 0060, on
  `IDEMPOTENT_SQL_MIGRATIONS`, `lettingSuggestions` in `shared/schema.ts`).
  The contract and the pure rule are `shared/letting-suggestions.ts`
  (`detectInText`, `candidatesForUnit`, `alreadyLogged`,
  `suggestionVisibleTo`; tests in `server/letting-suggestions.test.ts`, in
  `npm test`); the store, the scan and the routes are
  `server/letting-suggestions.ts`.
  - **Detection is the rules reader only**: no AI call, nothing sent
    anywhere. It uses the loose rules reading (`buildReading` with no
    candidate), not the tight test, because it only suggests: the person
    then opens the form, which reads the words through the route. An offer needs a money or lease term AND a word of an offer
    (or two terms); a viewing needs words of a viewing with a date or an
    outcome. Words that only repeat the quoting rent, or that the reader
    refused, raise nothing. Change the rule there, with a test.
  - **Five sources, nothing else**: a target's comment log (BGP's notes),
    a viewing whose outcome is Offer Expected or Offer Received or whose
    note reads as an offer, an interest note a person typed, a Targeting
    Brief comment that names one brand on the unit, and since 15 November
    2026 a **Letting Tracker comment**: a person's message in the property's
    shared conversation that tags the unit (`chat_comment`). Its brand is
    the one brand the message tags, or the one brand on the unit its words
    name; two tagged brands, or none found, raise nothing. Never a private
    thread, ChatBGP's answers, inbox-swept rows, a diary invitation's
    subject, emails, deal comments or CRM interactions.
  - **Already logged** = an offer (or viewing) for the same unit and brand
    within 14 days either side. A viewing that expects an offer looks
    forward: any offer from that brand since. The dedupe key is the source,
    the kind and a hash of the words, so a dismissed or logged suggestion
    never comes back and an edited comment is raised once more.
  - **It runs when a source is saved** (`queueSuggestionScan`, one fire and
    forget line in the handlers that write a target comment, a viewing, an
    interest line, a brief comment and a message in a property's
    conversation that tags a unit, edited and deleted ones included; it
    never fails or slows the save)
    and from the admin Preview then Apply
    (`/api/admin/letting-suggestions/preview|apply`; Settings → Letting
    integrity → Backfills). Never at boot, never on a timer.
  - **Who sees what**: rows from target comments and from Tracker comments
    (BGP's own work list, though a joint agent now reads the conversation itself) are
    `visibility = 'bgp'`, BGP staff only (`isStaff && seesBgpNotes`). The rest are `'brief'`: BGP
    staff and the scheme's joint agent. An asset manager, a Landsec leasing
    manager and every other client login are listed nothing, counted
    nothing and get the same 404 for any id. Every route goes through
    `briefAccess()`; the joint agent's gateway rule is the list, the count,
    confirm and dismiss only.
  - **The reader never writes an offer or a viewing.** "Log as offer / Log
    as viewing" opens the unit's own Add form filled in (a target comment
    through NoteFill's `source`, the others through `initialText`); the
    screen calls `POST /api/letting-suggestions/:id/confirm` only after
    that form saved, and the server checks the record is on that unit. The
    pill and the list are `client/src/components/letting-note/suggestions-dialog.tsx`,
    on the staff Letting Tracker and the joint agent's tracker.

## Requirements centre (Woody, 2026-11-12) — docs/requirements-review-2026-11-12.md

(Since 17 November 2026 the page is the **Requirements** pill on Brands,
`/brands?tab=requirements`, for every login; `/requirements` forwards there
with its parameters. See "The BGP side bar".)

**The board's shape and its links were reviewed on 19 November 2026**
(`docs/requirements-board-review-2026-11-19.md`; Woody: "it's old and I think
isn't that well set up or linked to the rest of the app"). It covers the live
figures, the nine fit rules, the about 70 places that show a requirement and
where each one links, a build plan and seven decisions. Woody answered "carry
on" the same day, taken as yes to the review's recommendation on each
decision (one row per brand; size AND use-or-place; open on the open
requirements; market listings unseen for six months under Older; group owners (answered
again on 20 November 2026: none, below);
In the news loaded only when opened; market listings on the brand page with
Confirm). Read it before changing the board, the fit rules or a requirement
link.

**The board, rebuilt (19 November 2026; decisions 1, 3, 4 and 6).**
- **One feed**: `GET /api/crm/requirements-board` (`loadRequirementsBoard` in
  `server/requirements-board.ts`, a fixed handful of queries; rules and types
  in `shared/requirements-board.ts`; tests `server/requirements-board.test.ts`,
  in `npm test`). **One row per brand** (`groupByBrand`): the brand's strongest
  requirement by `compareCandidates` (BGP's own before market listings before
  older, live before to confirm, newest date) with the rest under `others`; a
  requirement with no brand is a row of its own. Each row carries the wants
  line (`wantsLine`), its list, the state and date line (staff), the fits
  (count and best, `requirementFit` over the units on the market), the
  linked deal (name and stage in words), the agent
  named on the requirement (`agent_contact_id`; never a private-mailbox
  address), the BGP owners and last contact (staff, the CRM lists' private
  mailbox rule), and the brand's Expansion score and band
  (`boardExpansionBand`, the Hunter board's bands, read through
  `splitSubScores`). `GET /api/crm/requirements-board/:id/fits` lists every
  fit for the panel. A client login's rows are open or closed (`clientList`),
  worded by `requirementReason().clientText` with the requirement's own date,
  with no state, source, listing link, confirmation, owner or contact, and
  fits on its own units only (scheme limit included). A joint agent is
  refused (403; `jointAgentApiDenied` covers the path); a login tied to no
  company gets an empty reply.
- **Lists** (`boardListOf`, `onPill`, `countPills`): **Open** (where the page
  opens: BGP's own, then market listings), **BGP's own** (live, to confirm,
  drafts), **Market listings** (import-only, listed within `MARKET_UNSEEN_DAYS`,
  183), **Older** (BGP's own background rows, and market listings with no
  date or unseen for six months: read, never written), **Closed**;
  **Suggestions** (the tray, with "N of BGP's own requirements need
  confirming · Show them" under it) and **In the news** are pills of the page,
  not lists. A client: Open and Closed. `?list=` goes through `LIST_ALIASES`:
  live and stale open BGP's own (stale with Going stale on), `to_confirm`
  opens BGP's own with **Needs confirming** on. The digest and the phone
  alert link to Suggestions while suggestions wait, else `?list=to_confirm`
  (`requirementsToConfirmPath` in `server/requirement-overlaps.ts`).
- **Filters** is one popover (`requirements-filters`): Fit your units, Last
  90 days, Going stale, Needs confirming, Recently viewing, Group, Source,
  Sort, Clear.
- **Rows** (`client/src/components/requirements-board/board-rows.tsx`): Brand,
  Wants, State (Still live / Confirm and the evidence clipboard, behind
  `canUseCentre`), Fits, Agent, BGP, Expansion, Contact; a client: Brand,
  Wants, Listed, Fits, Agent, Expansion. Phone: cards, 30 at a time.
- **The panel** (`client/src/components/requirements-board/requirement-panel.tsx`,
  loaded lazily): a row or `?requirementId=` opens it (written with
  replaceState and taken off on close, so every link in the app that carries
  the id opens it). What it wants (with the deal the requirement is linked
  to, name and stage only; a client is sent only a deal it may open,
  `isDealInScope`), Who, Where it fits (Add as target through
  the unit's Targeting Brief routes; Want at this scheme, staff, through
  `POST /api/brand-crm/targets`), The brand (Expansion, `EstatePipelineCards`,
  `SchemePlanCard` for staff or the Landsec view), Conversation and CRM plan
  (staff), Other requirements. Edit opens the existing form over the panel;
  Delete asks first.
- **Loaded only when needed** (decision 6): the brand, contact and deal lists
  only for the form or Suggestions; In the news only on its pill; recent
  viewings only for that filter or the Filters box; a requirement's fits only
  in its panel. The board no longer calls `GET /api/crm/requirements-leasing/matches`
  or `GET /api/requirements/matches/:id`: both stay for a cached client and
  keep the one fit rule.
- Checked in a browser against a local copy on 19 November 2026 (staff on a
  computer and an iPhone profile, the Landsec client login).
- **Links in (step 5; findings 16 to 19).** Every place that holds a
  requirement's id opens its panel (`/requirements?requirementId=<id>`): a
  viewing's Linked requirement, the Brand CRM card's requirement lines (not
  for a joint agent or a hidden requirement), the Brands overview's radar
  (it linked to a `?tab=` the company page ignores), the dashboard's Live
  requirement alert and its phone twin, the dashboard widget's rows,
  Suggest targets' requirement line, Brand Gap's target (`requirement_id`,
  never for a joint agent; read from every requirement that fits a unit
  here, the More list still showing 30), ChatBGP's receipts (`pageUrl` in
  `server/chatbgp-requirements.ts`), and each row of the brand page,
  desktop and phone. A brand page's requirement count opens the board
  filtered to the brand. Guard: `qa/regression/requirement-panel-links.test.mjs`.
  Text with no structured id (the target engine's saved evidence, Start
  strategy's facts, Explorer's chip inside a brand card) is not linked.
- **The brand page shows market listings (decision 7).** BGP staff get the
  brand's PIPnet and Requirement List listings nobody at BGP has confirmed
  (`marketListings` on the brand profile, empty for a client login), each
  labelled with its listing date ("Older" past six months), opening its
  panel, with **Confirm** (`client/src/components/brand-page/market-listings.tsx`),
  which asks How do you know? through the board's own dialog
  (`client/src/components/requirements-board/confirm-how-dialog.tsx`) and
  the intake's still-live route. "No BGP requirement recorded · Add a
  requirement" shows only when there is neither. BGP staff also read each
  requirement row's state and dated line.
- **The deal page names the requirement it answers** (finding 18):
  `requirements` on `GET /api/crm/deals/:id/page` (`requirementsFor` in
  `server/deal-page.ts`, `crm_requirements_leasing.deal_id`), drawn as
  **Answers the requirement** on the Overview, opening its panel; the state
  for BGP staff, a client by what it is and its own date, a joint agent none.
- **One meaning of live (step 6; finding 20).** These read the one rule now:
  the old Fits route; the Expansion score's count of BGP's own requirements
  (`SCORE_VERSION` 6: a draft or a row with no status counts as to confirm);
  the BGP take's places; the brand preparation queue's order; ChatBGP's
  brand profile; the agent firm page (open requirements only, live first,
  each opening its panel); and a contact's Records (closed last; a client
  reads Open or Closed only). Both name the state in the board's words
  (`boardStateWords`: Live, To confirm, Market listing, Older, Closed; never
  "Background"). Five places pick an agent or a
  brand through a requirement and still read status Active or blank: the
  client Agents directory, the contact review, ChatBGP's offer logging, the
  diary's viewing match and the intake's brand match. The requirements
  Health report (Sync tools → Health report, admins) lists the agent links
  each would gain or lose on the rule ("Agent links that would change on
  the live rule"); they move once Woody has seen it.
  `qa/regression/requirement-one-live.test.mjs` fails on any other
  hand-written reading. Windows over newness (Who's hot, the market
  commentary, the dashboard widget, the brand tidy, HR points) are not
  liveness and stay as they are.
- **No group owners** (decision 5; Woody, 2026-11-20: "anyone can see the
  requirements"): a market listing stays unowned until someone confirms it,
  and Mine stays the BGP owner a person set. Do not build named owners per
  group.

**One fit rule (Woody, 2026-11-19, decision 2: "size and use or place").**
`requirementFit` in `shared/requirement-fit.ts` is the only judge of whether
a leasing requirement fits a unit: the unit's size in the requirement's
(tolerance-widened) range AND its use lining up (`requirementUseLinesUp`: a
use on both sides, by the class-to-use map, `USE_HINTS` on the class and the
unit's name, or the same words) or a place the requirement names in the
property's name or address (`requirementPlaceIn`: London, Greater London,
Central London, UK, England, national and nationwide place nothing); with no
size to compare (the unit's or the requirement's), the use AND the place.
Each answer carries `why` ("Size and use fit", "Size fits, at Bluewater",
"Use fits, at Kent; no size to compare"). Lists of fits sort by `fitScore`
then the smaller unit. Do not write a second fit test on a screen.
- **Where it decides**: the board's Fits column
  (`/api/crm/requirements-leasing/matches`) and its Match dialog
  (`/api/requirements/matches/:id`), both over the units on the market
  (`FIT_POOL_STATUSES`: AVA and NEG, in SQL) in the same order; the Letting
  Tracker's Find matching requirements and AI targets' requirement
  candidates; Brand Gap's list under More and Targets' Fits here; a
  landlord's space fits (`server/account-teams.ts`); the target engine; a
  brand's suggested pitches (a unit is pitched on a requirement only when it
  fits; "Fits", "Size fits" and "Close to" keep their wording); and the Brand
  CRM chip (`chipFor` in `shared/brand-stage.ts`, fed the tracker row's use
  class and name through `UnitInfo`). The chip's wording stayed; "Fits their
  requirement" now means the rule fits, and the one new key,
  `size_fits_area_only` ("Size fits, in their area, use not matched"), is a
  size and a region with no use that lines up (it read "Fits" before).
  The chip's `why` is cleared with its requirement id for a joint agent.
  The investment Match dialog keeps `requirementUseFits` (the lenient form).
- **Each fit opens the unit and says why**: the Fits cell links each unit to
  its schedule row on the property page (`propertyUnitHref` with the
  `scheduleRowId` the route reads by stored ties), else its tracker row
  (`trackerUnitHref`), with the reason under it. Since the board was rebuilt
  the cell shows the best fit, its reason and how many fit, and the
  requirement's panel lists every fit with Add as target (above). The
  Letting Tracker's Find matching requirements shows each requirement's
  reason, opens its panel, and says why nothing fits.
- **The property chips under Map Locations are gone** (finding 9: every CRM
  property whose name or address held a typed place), and with them the
  board's download of the whole property list.
- **Units to fill in** (`UnitFitGapsCard` in
  `client/src/components/requirement-centre.tsx`; `unitFitGaps`;
  `GET /api/requirement-centre/unit-gaps`, `unitGapsList` in
  `server/requirement-intake-routes.ts`, behind `staffActor`): BGP staff see
  "Of N units on the market, N have no use class and N no size" on the board
  with Show the units, each opening its Letting Tracker row. It reads only.
- Tests: `qa/regression/requirement-fit.test.mjs` (the rule and a guard on
  every caller), `requirement-match-dialogs.test.mjs`,
  `scheme-positioning.test.mjs`, `brand-gap-board.test.mjs`,
  `shared/brand-stage.test.ts`. Not changed by it: ChatBGP never had a fit
  test of its own; the Fits column still reads requirements with
  `status = 'Active'` (one meaning of live is step 4 of the review).

The PIPnet import saw no listing from 15 to 19 November 2026. The login
worked, but every PIPnet search goes through ScraperAPI, and that account was
out of credits (100,073 of 100,000). Woody topped it up on 19 November, giving
a new limit of 1,000,000 (`GET /api/app-costs` shows the count). Eight other
features also go through ScraperAPI (`server/utils/scraperapi.ts`). Any 401 or
403 pauses every ScraperAPI call in the app for 10 minutes, in memory. The
PIPnet routes have the default 45-second request limit, so the menu crawl
(`pipnet-inspect-property-search`) cannot finish through them.

**PIPnet from inside** (19 November 2026, BGP's own login, read only; the
review has the detail). There are two services, Retail property details and
Retail requirements. Every search stops at 50 pages (about 1,000 rows).

**PIPnet limits how many people can be logged in at once** ("Maximum number of
licensed users for your company exceeded"). Until 19 November 2026 the app
never logged off, so each import held a licence until PIPnet timed the session
out. Now every operation `server/pipnet.ts` exports runs inside
`withPipnetSession`: runs that overlap share one session, and the last one to
finish presses Logoff (`logoff.jsp`) for every session they used, including
one dropped after a 403 or when the credentials change
(`qa/regression/pipnet-logoff.test.mjs`). A new PIPnet operation is exported
the same way. Any script that logs in must press Logoff before it ends. Never
close the browser on an open session.

Woody's sourcing brief of the same day is the last section of the review:
- 12 months of PIPnet flyers, each original kept;
- every agent on a flyer into the tenant rep CRM;
- requirements also from the chats, email and news.

Its four decisions were answered with the same "carry on": the 12-month
catch-up runs the first 100 to measure the cost, then the rest (A); a
listing that names no client adds only its agent (B); what the import makes
says "From PIPnet" (C); listings stay market listings until BGP confirms (D).

**Each flyer's agent is the brand's tenant rep** (19 November 2026; Woody:
"All agents who put up a flyer should be added to our tenant rep agent CRM").
In `server/pipnet.ts`, the promote step finds the agent firm and the named
agent through `upsertPipnetAgent`, then, once the listing's transaction has
committed, `recordPipnetTenantRep` makes the brand-to-firm link through
`createBrandRepresentation` (agent type `tenant_rep`, the agent as its
contact, a note naming the listing). So the brand page, the CRM's Agents
list and the client Agents directory show it. It makes one link per brand and
firm. A link already there, current or ended by a person, is left alone. Each
listing asks once (`_tenantRepAt` on the listing's `raw_data`, carried over
when the import reads it again), so a link a person deletes is not put back
by the same flyer; a new flyer naming the agent adds it again. A brand
listing for itself (the firm's name is the brand's) has its agent filed under
the brand and gets no link.
- **Firms are matched on a tidied name** (`shared/pipnet-agents.ts`:
  `agentFirmKey` drops case, punctuation, a bracketed part, a leading "The"
  and a legal ending, and reads "&" as "and"). So "CBRE Ltd" is the CRM's
  CBRE, where the exact-name match made a second company. `pickAgentFirm`
  takes a company recorded as an agent firm, else one recorded as nothing
  (which it records as an agent firm, as before), never a merged one, never a
  brand, landlord or other kind of company that shares the name, never the
  listing's own brand. The agent is found at the firm by email, then by name.
  An existing record only gains blank fields.
- **What it makes says so**: a new firm or contact has enrichment source
  `pipnet`, which the contact page's Source reads as "From PIPnet"
  (`sourceWords`). A new contact's first note line is "Added from PIPnet —
  the agent on <brand>'s requirement, listed <date>".
- **A listing that names no client** ("[No Client Quoted]") is no
  requirement and makes no link. Its agent firm and contact still go into the
  CRM. Its detail page is read for the agent's email and mobile, and its
  flyer is neither downloaded nor read.
- Tests: `server/pipnet-agents.test.ts` (in `npm test`) and
  `qa/regression/pipnet-tenant-rep.test.mjs`, which runs the real promote
  step. `qa/regression/requirement-import-matching.test.mjs` runs it too, so
  a new binding in either function goes into both. Not run against PIPnet
  from a build machine: the first links come from the 05:30 import, and the
  older listings get theirs when the 12-month catch-up reads them again.

**PIPnet, last 12 months** (19 November 2026; Woody: "We want the last 12
months", each flyer kept as uploaded). PIPnet's requirements search takes ONE
"listed since" date (`documentDate`, dd/mm/yyyy), sorts newest first and
stops at 50 pages, so date windows cannot get past the cap: the newest rows
always come first. (The review said "shorter date windows"; that was wrong.)
The search form also takes a trade type (`tradeTypeListBox`, 122 on
19 November 2026), use class tick boxes, "named clients only" and agent and
client lists, read from the form that day. So the catch-up searches one trade
type at a time, listed since a year ago (`catchupSince`, London's date), then
once with no trade type for listings that carry none.
- **Rules** `shared/pipnet-catchup.ts`; **run** `server/pipnet-catchup.ts`
  (state in `system_settings.pipnet-catchup`), admin only:
  `GET`/`POST /api/admin/pipnet-catchup` (`start`, `carry_on`, `stop`). The
  screen is **PIPnet, last 12 months** in the requirements board's Sync tools
  (`client/src/components/pipnet-catchup.tsx`). Nothing starts it at boot or
  on a timer. A run an admin started carries on after a deploy
  (`resumePipnetCatchup`, 90 seconds after boot).
- **Each search is one PIPnet session**, logged off when it finishes
  (`importPipnetCatchupStep`, `listPipnetTradeTypes`), so the run never holds a
  licence for long. The imports take turns (`oneAtATime` in
  `server/pipnet.ts`): a second search in the same session wipes the first
  one's result set, so the 05:30 import waits for the search in hand to finish.
  A refused or failed search stops the run at that search, and Carry on tries
  it again. Stop keeps the place; the search in flight is done again.
- **Each listing goes through the daily import's own step** (`importPipnetRow`,
  shared by both): the detail page, the flyer kept as a PDF, the stored
  listing, the requirement as a market listing (decision D), the agent and
  the tenant rep link. A search that reached PIPnet's cap is listed as cut
  short on the card.
- **Each flyer is read by AI once** (`flyerAlreadyRead`): a stored listing
  with the same document date, a kept pack and a sure reading keeps both. A
  new listing, a re-issued one (new date) or one never read is downloaded and
  read. This holds for the 05:30 import too, which before re-read every flyer
  of the last three months each morning.
- **The pause for the cost** (decision A): after the first 100 flyers read
  (`CATCHUP_FIRST_FLYERS`), the run pauses and the card says what they cost,
  read back from App costs: each read is now logged with `logAiUsage` as
  `pipnet-flyer` (`parseRequirementBrochure`'s `feature`; the other callers log
  `requirement-flyer`). Carry on reads the rest without pausing again.
- Tests: `server/pipnet-catchup.test.ts` (in `npm test`) and
  `qa/regression/pipnet-catchup-guards.test.mjs`. Not run against PIPnet
  from a build machine (it writes to the live CRM and spends on AI): the first
  run is an admin's Start.

Woody: "the requirements page is just picking up historic requirements
dragged from a couple of data bases. We need it to be the live requirements
centre for brands that are expanding to include and pick up on all chats and
discussions emails etc it needs to be much more integrated. There should also
be news reports etc which drive requirements as example industry news like
propel ... consider this is app wide". The review, the design paragraph and
the dated **Build status** (what is built, what is not and why) are in
`docs/requirements-review-2026-11-12.md`. Leasing requirements only
(`crm_requirements_leasing`); investment requirements are out of scope.

Two rules everything else follows (do not re-litigate):

1. **No machine-made live requirements.** Anything a machine detects (an
   import, a news story, a chat post, a transcript, a viewing or deal rule)
   is a SUGGESTION. Only a named person makes a requirement live, by
   confirming it: BGP staff, and since 20 November 2026 a client login too
   (Woody: "Clients should be able to do what we can do really"; a client
   is never made a requirement's BGP owner). A person telling ChatBGP to
   log one counts as that person's confirmation. A press story a person
   confirms is labelled press-reported until someone records speaking to
   the brand.
2. **No scheduled ageing writes.** The state is DERIVED on read from the
   confirmation date. Nothing, at boot or on a timer, moves a row between
   states or back-fills; back-fills are admin Preview then Apply.

**Every requirement is open to client logins, to read, add and amend**
(Woody, 2026-11-17: "keep all requirements open for clients and access to
amend and add"; do not re-litigate). This SUPERSEDES the "One client rule"
as first written (PIPnet listings only, below) and "Client logins were given
nothing new" under NOT built.

- **Reading.** Every client login reads every leasing requirement, BGP's own
  included. `requirementClientVisible()` and `requirementClientVisibleSql()`
  pass every row (kept so the callers keep one name). Every row sent to a
  client still goes through `requirementClientCopy`, and every line a client
  reads is `requirementReason(row).clientText`: what it is and its own date
  ("PIPnet listing from Sep", "requirement dated 4 Aug", "requirement added
  12 Nov"), never the state, the BGP owner, or whether, when or by whom BGP
  confirmed it. So a confirmation writes no requirement date onto any row
  (`confirmationPatch` in `server/requirement-intake.ts`), and the brand
  page and the Brand Pack list a client's rows by listed or added date,
  never live first. One exception, as asked: the BGP take
  (`openRequirements` in `server/brand-ai-take.ts`, one cached text for
  staff and clients) words each open requirement with
  `requirementReason(r).text`, so it may say when one was confirmed, never
  who (cache policy `:market-listings-1` kept).
- **Joint agents stay out.** `jointAgentApiDenied` (`shared/landsec.ts`)
  refuses a joint agent the requirements list, one row, add and edit, the
  centre routes, the unit Match dialog, the tracker's matching requirements,
  brand suggestions and the client Agents directory (test in
  `server/landsec-gateway.test.ts`). Where it still meets requirements,
  Brand Gap and the target engine at its schemes, it reads PIPnet listings
  only (`requirementJointAgentVisible[Sql]`, `RequirementReason.listingText`),
  and Brand Gap's cached commentary, which every login reads, cites PIPnet
  listings only. `requirementViewer(req)` in `server/landsec-access.ts`
  answers "staff", "client" or "joint_agent" (a failed read is
  "joint_agent").
- **Writing.** A client login adds a leasing requirement and amends any
  (`POST /api/crm/requirements-leasing` and `PUT …/:id`, opened on the CRM
  write guard in `server/crm.ts` and on `CLIENT_ALLOWED_WRITES` in
  `server/index.ts`); `DELETE` stays BGP staff only (403 to any client
  scope), as do the landlord pack and the agent sweep. One door,
  `clientRequirementWrite` in `server/crm.ts`: only
  `CLIENT_REQUIREMENT_FIELDS` (`shared/requirement-live.ts`: name, brand,
  group, status Active / Past / Archived, contacts, deal, use, type, size,
  places, comments), and the brand must be a tenant brand the login may see
  (`isClientVisibleBrand`); never provenance, an owner or a confirmation
  from the body. A new row is stamped by `clientCreatedStamp`:
  `origin = 'client'`, the client company's name in `sources` (Source
  "Client" on BGP's screens), no BGP owner, and since 20 November 2026
  confirmed by the person who added it at creation (`confirmedHow`
  "created"), as BGP's own are (Woody: "Clients should be able to do what we
  can do really"); until then it read To confirm ("client requirement added
  17 Nov, not confirmed") until a BGP person confirmed it. A client's edit
  is never a confirmation, as a BGP person's is not. Imports never label or fold into
  a client's row (`importMayLabel`, `listingTarget`). A login not tied to a
  client company (`NO_ACCESS_SCOPE`) reads and writes nothing. ChatBGP's
  `create_requirement` and `update_requirement` were BGP staff only until
  20 November 2026; a client login now uses them through these same routes
  (see "ChatBGP adds requirements for client logins" below).
- **The page.** A client login, and BGP staff viewing as one, get Add
  requirement and Edit on the client shape (`LeasingFormDialog` with
  `clientForm`: the brand picked from the brands it may see, no BGP owner;
  the form opens only once the login is known, `!!reqUser`), and no Delete
  or centre tools. Brand Gap's Add requirement is open to every login with
  brand pages (`noBrandPages` keeps it from a joint agent).
- **Opened with it**: Brand Gap, the target engine (the requirement line is
  shareable; whether and when BGP confirmed it is `internal`), suggested
  pitches, brand suggestions, Who's hot, the market commentary, a contact's
  requirements, the Expansion score's client view ("N requirements on BGP's
  books"), the brand page and its Tenant rep agents, the Brand Pack (every
  open requirement), the viewing form (`agentRequirementSql`: any open
  requirement for a client), the client Agents directory and the Brand CRM's
  requirement detail (a joint agent still reads only "Requirement held").
- **Still BGP's**: the whole centre (suggestions and the tray, the evidence
  drawer and `requirement_evidence`, Still live and Confirm, the owner, Sync
  tools, the Health report, In the news; every `/api/requirement-suggestions*`
  and `/api/requirement-centre/*` route) and the unit Match dialog
  (`/api/requirements/matches/:id`).
- **Left for Woody**: ChatBGP writes a staff member's note into a
  requirement's Comments, which a client now reads; only a PIPnet-labelled
  row is kept free of them (`clientsCanSee` in
  `server/chatbgp-requirements.ts`). A client also sees each row's
  `sources` chips (BGP, ChatBGP, News, Viewing, PIPnet). Tests:
  `qa/regression/client-requirement-access.test.mjs`, with the requirement
  guards and `qa/two-bot-round.mjs` brought up to the rule.

- **The states**: LIVE = a named person (BGP staff, or a client login since
  20 November 2026) confirmed it within 90 days
  (`REQUIREMENT_LIVE_DAYS`). TO CONFIRM = confirmed 90 days to 12 months ago
  (`REQUIREMENT_TO_CONFIRM_DAYS`, 365), a Draft, BGP's own row nobody has
  confirmed yet, or a suggestion waiting for a person. BACKGROUND = older, on
  hold, or an import-only market listing (PIPnet, The Requirement List)
  nobody at BGP has confirmed. CLOSED = past / archived / satisfied.
- **One live rule**: `shared/requirement-live.ts`, which EVERY consumer must
  use; never write a second meaning of live ("status = Active" is not it).
  `requirementLive(row, today)` for code holding a row,
  `requirementStateSql(alias)` for queries, `requirementReason(row)` for the
  wording on other screens; keep the function, the SQL and the tests in step.
- Never say "confirmed" without `last_confirmed_at` AND a person. The
  requirement date, created date and last edit read as "listed", "dated",
  "last edited". Imports never set a confirmation; they set `origin`,
  `external_requirement_id` and `last_listed_at` (forward only) through
  `requirementListingUpdates`. A hand-made row is stamped `origin = 'bgp'`
  and confirmed by its creator (`bgpCreatedStamp`); one a client login makes
  is `origin = 'client'` and unconfirmed (`clientCreatedStamp`, above).
  Request bodies never set these columns (`stripRequirementProvenance`).
- Anything a machine detects is a suggestion in `requirement_evidence`
  (status open), never a live requirement. Staff only: no evidence,
  suggestion, owner or health data goes to a client login.
- **Migration** `migrations/0056_requirements_centre.sql` (idempotent, on
  `IDEMPOTENT_SQL_MIGRATIONS`, declared in `shared/schema.ts`; additive
  only): on `crm_requirements_leasing` the columns `last_confirmed_at`,
  `last_confirmed_by`, `last_confirmed_by_name`, `confirmed_how`, `origin`
  ('bgp' | 'pipnet' | 'trl', and 'client' since 17 November 2026; NULL =
  made before the build),
  `external_requirement_id`, `last_listed_at`, `last_listed_source`; and the
  one new table `requirement_evidence` (evidence lines and suggestions).
  Existing rows were not back-filled: they have no confirmation, so none of
  them reads Live until a person presses Confirm.
- **One intake**: `server/requirement-intake.ts` is the one door for
  SUGGESTIONS and CONFIRMATIONS; never write an evidence line or a
  confirmation beside it. Six older paths still insert their own stamped
  requirement rows directly, with no evidence line: the two imports
  (`server/pipnet.ts`, `server/trl.ts`), the Add requirement form
  (`POST /api/crm/requirements-leasing`, a client login's through
  `clientRequirementWrite`), the convert route, the two bulk
  imports, and Import Anything. Do not add a seventh. Sources
  wired in: PIPnet and The Requirement List imports (market listings,
  stamped, never confirmed), Add requirement on the page, ChatBGP, team chat
  and Gossip posts, Teams transcript summaries, viewings, deals reaching
  Solicitors, the Propel email reader and the nightly brand news pass, and
  the old chat `requirements` table (admin preview then apply). Every source calls
  `suggest` (a suggestion, never a requirement); a named person answers with
  `confirm` (new requirement, or stamp an existing one), `attach` or
  `dismiss`; `stillLive` and `setOwner` act on a requirement. One open
  suggestion per brand and source kind (`suggestion_id` joins later lines);
  a brand is never invented (unmatched names and ties wait for the
  reviewer); a dismissed press suggestion quietens that brand's news for 30
  days. Routes are staff only, in `server/requirement-intake-routes.ts`
  (`/api/requirement-suggestions*`, `/api/requirement-centre/requirements/:id/*`),
  outside `/api/crm/` on purpose. Do not write the provenance columns or
  `requirement_evidence` anywhere else: storage, the generic PATCH, Import
  Anything and `sql_write` all refuse or strip them.
- **ChatBGP adds requirements for client logins** (Woody, 2026-11-20, on a
  Landsec login's chat that said the action "isn't available in this chat":
  "Needs to be able to add a requirement"). `create_requirement` and
  `update_requirement` are off `CLIENT_BLOCKED_TOOLS`. For a client login,
  or BGP staff viewing as one (`resolveCompanyScope`, read before
  `staffActor` in `runChatRequirementTool`), they run
  `clientLogRequirementFromChat` / `clientUpdateRequirementFromChat`, which
  write only through the page's own routes as that login (`POST` / `PUT
  /api/crm/requirements-leasing` by `callOwnRoute`, passed in from
  `executeCrmToolRaw`): the client's fields, the brand checked as a tenant
  brand on its list, a new row saved as the client's own, confirmed by that
  person (`clientCreatedStamp` with the creator). Then the same day: "Clients
  should be able to do what we can do really". So a client's word confirms
  as a BGP person's does: "still live", or the same brand and area logged
  again, runs the intake's `stillLive` with a client `Actor` (`client:
  true`, through `markStillLive` in `runClientRequirementTool`, in a
  transaction), recorded by name, and `confirmationPatch` never makes a
  client the BGP owner. Fields are never written through the intake (no
  `confirm`, suggestion or direct update). The brand is the companyId given
  or the one brand the name matches; none matched saves nothing and offers
  `create_company`; two of the same name are asked about. The same brand
  and area is added to (blank size, area and use filled, the note added to
  the comments as "[date, name via ChatBGP]") and confirmed, never a second
  row; another area asks first, listing the open ones by
  `requirementReason().clientText`. A refused confirmation (a closed
  requirement) is said, and what was saved stays saved. What it is told
  never names a state or who at BGP confirmed. The page gives a client no
  Still live button yet. A joint agent is refused (`requirementViewer`), as its
  own ChatBGP never has the tools. The client prompt says it may add and
  amend requirements, and the client's `search_crm`
  (`clientScopedCrmSearch`) now returns leasing requirements as the client
  reads them, with their ids. Tests:
  `qa/regression/chatbgp-client-requirements.test.mjs`.
- **ChatBGP** (`server/chatbgp-requirements.ts`): `create_requirement` and
  `update_requirement` are leasing only; for BGP staff the handler needs a
  named staff member who is not viewing as a client (a client login goes
  the way the bullet above says). Both are also refused on a server-originated
  run (`isInternalStaffRequest`: the Friday report, the activity curator,
  property sweeps), because nobody is asking: `runChatRequirementTool`
  checks that first. A staff member asking ChatBGP to log a
  requirement IS the confirmation: it goes through the intake's `confirm`.
  Same brand and area = the existing requirement is confirmed and added to,
  never a second row; unclear which = nothing saved, the user is asked; an
  unmatched brand = a suggestion only. Chat text is never copied onto a
  PIPnet-labelled row (`clientsCanSee`, written when client logins read only
  those; since 17 November 2026 they read every row, so a note ChatBGP adds
  to any other row's comments reaches them too: Woody's call). An edit is
  not a confirmation. ChatBGP's search, context and the MCP search read
  `crm_requirements_leasing` with the live rule. The old `requirements`
  table is no longer written or read by chat; its rows reach the centre only
  through `GET /api/admin/requirements-legacy` (preview) then
  `POST /api/admin/requirements-legacy/apply { ids }`, as suggestions.
- **Feeds** (`server/requirement-feeds.ts`): each runs when its record is
  written, never on a timer or at boot, and only ever calls `suggest`.
  Viewings: two completed, confirmed viewings in 90 days by a brand with no
  open requirement (`viewingsToSuggest`); a brand's confirmed viewings and
  offers are read live as evidence, never copied. Deals: a letting or
  tenant-rep acquisition reaching Solicitors asks "mark as satisfied?"
  (`dealSatisfiedQuestion`, hooked after the write in `updateDeal`,
  `mirrorDealStatus` and the bulk deal update); only a person closes it
  (`markSatisfied`, `POST /api/requirement-suggestions/:id/satisfied`), and
  `confirm` refuses that kind of suggestion. Chat: a staff post that tags a
  tenant brand in a thread where the creator and every member is BGP staff
  (`threadIsStaffOnly`; never a ChatBGP thread, never a poster viewing as a
  client). Meetings: the summary of a Teams transcript note. The one reader,
  `readStatedRequirements`, calls Anthropic directly (not `callClaude`), is
  capped per day (`REQUIREMENT_READER_DAILY_CAP`, default 200, 0 = off; the
  count is in `system_settings`), logs spend as `requirement-intake`, drops
  any result whose quote is not in the text, and does nothing with no key.
  "Create requirement" on a viewing goes through the intake: pressed by BGP
  staff it attaches to the brand's one open requirement or makes one
  confirmed by that person; pressed by a client login it only raises a
  suggestion and the reply never says whether a requirement exists.
- **News** (`server/requirement-news.ts`): news only ever suggests. Both news
  readers (the Propel email reader `extractBrandSignalsFromNewsletter` in
  `server/news-brand-linking.ts`, and the nightly brand pass
  `normaliseBrandFacts` in `server/expansion-intel.ts`) answer one more
  question per story ("does it state what space the brand wants or an
  expansion target?": sites, size, places, timing). **The story keeps its
  signal type**: never add a 'requirement' type to the newsletter reader or
  relabel a story, because scores and maps read the type; the stated figures
  go in the signal's detail text ("Stated: ...") and are kept only where the
  text itself has them (`checkStoryRead`). The newsletter reader calls
  Anthropic directly and reads a long edition in sections
  (`splitIntoSections`); sections after the first are capped per day
  (`REQUIREMENT_NEWS_READER_DAILY_CAP`, default 150). **Only a pure
  publisher's newsletter** (`isPublisherSender` in `server/insights-feed.ts`:
  the `scope: "any"` senders such as Propel and Property Week) is read whole
  and handed to `newsStoriesRead` (`publisher: true`); an email from an agent
  or data firm in the shared inbox (`scope: "shared"`: Knight Frank, Savills,
  CBRE, CoStar, Green Street) never reaches the requirements centre. Besides
  this, the only email text read for requirements is the email feed below.
  Woody asked for Propel to drive requirements but has not confirmed this
  path in so many words. After writing signals
  the readers call `newsStoriesRead`: a strong story (`strongStory`: a brand
  already in the CRM with a stated number of UK sites, or a stated size or
  places) raises a press suggestion; a closure, CVA or administration story
  about a brand with a LIVE requirement confirmed before the story raises a
  "still live?" question (`details.proposal = 'still_live'`; yes = `confirm`,
  no = `markNotLive`, `POST /api/requirement-suggestions/:id/not-live`).
  Only stories dated in the last 30 days are raised, keyed on brand plus
  story (never the signal id: the nightly pass deletes and re-creates
  signals). `GET /api/requirement-centre/expanding` is the "Expanding now,
  nothing on our books" list (`expandingBrands`); `POST
  /api/requirement-centre/expanding/add` saves a requirement from it through
  the intake as press-reported (`confirmed_how = 'press'`, source label
  "News"), which the expansion score does not count as BGP's own. The press
  headline classifier (`classifySignal`) does not ask the extra question.
- **The page** (`client/src/pages/requirements.tsx`, Leasing view; the board
  was rebuilt on 19 November 2026, see "The board, rebuilt" above, which
  supersedes the lists named here). Every row is on exactly one list, from
  `boardListOf` (`requirementListKey` in the live rule is the per-requirement
  reading it builds on). Going stale is the part of Live within 14 days of
  lapsing (`requirementGoingStale`); In the news is the Expanding list;
  Everyone / Mine filters on the BGP owner. The
  owner is the LIST column `bgp_contact_user_ids` (the single id follows it:
  `requirementOwnerColumns` in the live rule, `setOwner` in the intake). Still
  live / Confirm call the intake's `stillLive`: one tap on a row a person has
  confirmed before; the FIRST confirmation asks "How do you know?" and sends
  it as `how`. The "how sure" label says "by conversation" only when
  `confirmed_how` is call, meeting, email or chat (`howSure`); a bare still
  live keeps an earlier conversation or press basis (`nextHow`). A person
  confirming an ownerless row becomes its owner. Dismissals (tray, In the
  news, a draft) show Undo. A client login, and staff
  viewing as one, get the client shape (`clientShape`): Open / Closed, no
  state, owner or date line, no Delete and none of the centre's tools; since
  17 November 2026 it has Add requirement and Edit (`clientForm`, above).
  Never show a client the state or who confirmed.
- **Tray, evidence drawer, news Dismiss** (`client/src/components/requirement-centre.tsx`,
  mounted only when `canUseCentre`): `SuggestionTray` is the Suggestions pill
  (since 19 November 2026; it was the top of To confirm) and is the ONE place
  suggestions are answered (do not add a second list elsewhere). Its answers
  are the intake routes: confirm (the detected fields are checked in a form
  first; one requirement on file = one tap), attach, brand, dismiss,
  satisfied, not-live. With none waiting it says so. The search narrows the
  tray and the other filters hide it. `RequirementEvidenceDrawer` reads
  `GET /api/requirement-centre/requirements/:id/evidence`, which now also
  returns the market listing as a line (read from the row the import stamps;
  added after `howSure` is worked out, so it never changes the label).
  "Add evidence" is `POST` on the same path: what a person types (note, call,
  meeting, email), through the intake's `attach`; `confirms: true` also runs
  `stillLive` with that way of knowing. It never fetches an email. "Dismiss"
  on In the news is `POST /api/requirement-centre/expanding/dismiss`
  (`dismissFromNews`): a person's dismissed press line, which is what takes
  the brand off the Expanding list and quietens its news for 30 days.
- **Honest use on other screens**: no screen says "live requirement" unless
  the state is live. Use `requirementReason(row)` from the live rule for the
  wording ("requirement confirmed 3 Nov", "PIPnet listing from Sep, not
  confirmed"; it never names who confirmed) and `REQUIREMENT_STATE_WEIGHT`
  for scoring (live 1, to confirm 0.5, background 0.2). **One client rule**
  (rewritten on 17 November 2026, see the top of this section; until then a
  client login was given only rows labelled PIPnet and its own company's): a
  client login is given every leasing requirement, by what it is and its own
  date (`reason.clientText`), never the state and never whether, when or by
  whom BGP confirmed it. Any row sent to a client goes through
  `requirementClientCopy` (no provenance, no BGP owner, no last-edit time),
  and a confirmation writes no requirement date onto any row: a client must
  not learn who at BGP owns a requirement or when BGP confirmed it (the BGP
  take is the one exception, above). The same rule covers the hub's "Who's
  hot" query (`hotReqJoin`), the market commentary's activity count, the
  requirement name on a viewing, and the Expansion score's why-lines and
  flags (`clientScoreView` / `clientScoreLabel` in `server/hunter-score.ts`).
  That holds in the target engine (`server/target-tenant-engine.ts`: the
  requirement line is shareable evidence, whether and when BGP confirmed it
  is `internal`, because saved rationales are read by the landlord), tracker
  targets and suggested pitches (`server/crm.ts`), space fits
  (`server/account-teams.ts`), Brand Gap (its cached commentary is read by
  every login, joint agents included, so it cites PIPnet listings only), the
  brand page feed, the Brand Pack and the Brands hub. For BGP staff the
  brand page, pack, Brand Explorer flag and hub tile mean live or to confirm;
  a client's brand page and pack list every requirement that is not closed.
  The expansion score counts an unconfirmed PIPnet or Requirement List import
  as a market listing, never BGP's own (`gatherBgpEvidence`); raise
  `SCORE_VERSION` in `server/brand-triggers.ts` whenever score weighting
  changes (crossings only compare like with like, which stops an alert
  burst). News meets requirements in code, by brand id:
  `server/requirement-overlaps.ts` feeds the Friday report, the leads prompt
  and the digest's "N suggestions to answer and N requirements need
  reconfirming" (`openSuggestionCount`).
- `GET /api/admin/requirements-health` (`server/requirements-health.ts`;
  on the page: Sync tools → Health report, admins) reports; nothing repairs
  at boot. Back-fills are admin Preview then Apply.
- **Emails feed suggestions** (Woody, 2026-11-15: yes to reading BGP's own
  emails for what brands say they want). `server/requirement-email-feed.ts`
  is the ONE file that takes mail text into the centre. The hourly mailbox
  sync hands it an email it has just filed against a contact, only when the
  contact wrote it (never BGP's own outgoing mail), the writer's company is
  a tenant brand or an agent firm, and the subject or opening lines read
  like a requirement (a rule, no AI). The email is fetched, refused if it
  is on the private side of the mail boundary, and only the writer's own
  words are read (the thread quoted under them and the footer are cut off)
  by `readStatedRequirements` under its own allowance
  (`REQUIREMENT_EMAIL_READER_DAILY_CAP`, default 60, 0 = off; 8 a mailbox
  a run). It only ever calls `suggest` (kind `email`, "From the email" in
  the tray): a brand's own email is that brand's; an agent's email names
  the brand, which may need picking. The email is not stored, only the
  quote. "Add evidence → email" is still a line a person types. It has not
  been run against Microsoft from a build machine. Guards:
  `qa/regression/requirements-centre-guards.test.mjs`,
  `server/requirement-email-feed.test.ts`.
- **NOT built** (each waits on Woody; do not build without his answer):
  - **Reading private chat threads and ChatBGP conversations** for
    requirements, and working back through emails already filed (the email
    feed reads new mail only).
  - **The Landsec view.** Answered on 17 November 2026: every requirement
    is open to client logins, to read, add and amend (the top of this
    section). Until then client logins were given nothing new here, and
    slice-limited listings and a share marker (review, Across the app 4)
    waited on him; neither is needed now.
  - **The single fit rule.** Answered on 19 November 2026 ("size and use
    or place"): built, see "One fit rule" above.
  - **Brand-first cards**, more than one imported search per brand and
    numeric size fields (a schema change that was not in the approval).
  - Also not built: owners handed out from the brand's BGP team, the Monday
    line in the morning briefing, a feed status panel, back-fills of old
    viewings / deals / signals, the brand tidy and Agents list windows, a
    "raise as requirement" action on a news signal, a staff phone tile for
    Requirements. The Build status section of the review lists them all,
    with the consumers that still read any Active row as live.
- **Tests** (none is in the `npm test` script yet, to keep the merge easy;
  add them there after it): `shared/requirement-live.test.ts`,
  `server/requirement-intake.test.ts`, `server/chatbgp-requirements.test.ts`,
  `server/requirement-feeds.test.ts`, `server/requirement-news.test.ts`,
  `server/requirement-honest-use.test.ts`,
  `qa/regression/requirements-centre-guards.test.mjs` (the source-level
  guards: no email reading, Anthropic only, staff-only routes, no timer);
  the three `server/requirement-*-postgres.test.ts` files start a throwaway
  cluster and need `RUN_DISPOSABLE_REQ_POSTGRES=1` and a non-root user.
  Several `qa/regression` tests load one function with a fixed list of
  bindings (sql-tools, brand pack, Brand Gap, target engine, nightly brand
  pass, insights report leg): a new import in those functions needs the
  binding added to the test. Run that suite with `--import tsx`.
- **Checked across the app (17 November 2026**; Woody: "check that the
  requirments function speaks properly to the whole app and it works
  properly"). An audit of every link in and every reader. Fixed:
  - The leasing page now reads `?requirementId=` (BGP staff get its form, a
    client login a search for it); ChatBGP receipts, landlord chat and a
    contact's Requirements list link with it (the contact page used
    `?highlight=`, which nothing read, and sent investment requirements to
    the leasing page). "Add a requirement" on the brand pages carries
    `&new=1`, so the form opens with the brand chosen. A client login was
    never shown the create form (`createOpen && !clientShape`), and Brand
    Gap offered "Add requirement" to BGP staff only: both superseded the
    same day, when clients were given Add and Edit (`createOpen && !!reqUser`
    with the client form; Brand Gap's button for every login with brand
    pages). The phone's suggestions alert keeps its `?list=`.
  - Off the live rule, now on it: the brand plan's requirements (the
    Schemes and units card, Requirement held), Start strategy's
    "Requirement on file" (with its state), and the brand page's Tenant rep
    agents. A client is never told a market listing is a "BGP" or "Live"
    requirement (brand page headings; the phone list shows the rule's state
    label to staff only). ChatBGP's investment directions point at
    Investment → Requirements.
  - **Client leaks closed.** The BGP take is one cached text that staff
    and clients read, so it then cited shareable market listings only
    ("PIPnet listing from Sep", `marketListings` in `server/brand-ai-take.ts`),
    never BGP's own requirements; takes saved before this stopped being
    served (cache policy `:market-listings-1`) until the weekly brief or
    Refresh. (Superseded the same day: the take reads every open
    requirement, `openRequirements`, the policy unchanged.) The viewing
    form's agents, represented brands and save check share one rule
    (`agentRequirementSql` in `server/leasing-viewings.ts`: live or to
    confirm for staff; any requirement that is not closed for a client,
    since 17 November 2026). The Brand Pack orders a client's requirements
    by listing or added date, not live-first.
  - **Matching by use.** Units hold planning classes (E(b), A3) and
    requirements hold categories (Restaurant), so Brand Gap, the Match
    dialog and the tracker's Find matching requirements came back empty for
    any requirement with a use. They read `requirementUseFits` in
    `shared/requirement-fit.ts` (the class-to-use map PIPnet's import
    uses; bare Class E fits every use; a side with no use fits on size
    alone). The Match dialog offers only units live on the tracker. The
    Fits column, account space fits and the target engine still match use
    by words (OR a place): part of the single fit rule, Woody's call.
    (Superseded on 19 November 2026 by the one fit rule, above: every one of
    them asks `requirementFit`, which needs a use on both sides.)
  - **Imports fold into open rows only** (`listingTarget` in
    `shared/requirement-live.ts`): by the listing's own link first, then
    the brand, newest first, never a closed row. A listing whose own row a
    person closed stays closed. `importMayLabel` never labels BGP's rows,
    nor a row made before `origin` existed unless it already carries that
    import's label. PIPnet rows imported before 12 November and since
    closed may come back once as Market listings.
  - Guards: `qa/regression/requirements-app-links.test.mjs`,
    `requirement-client-leaks.test.mjs`, `requirement-match-dialogs.test.mjs`,
    `requirement-import-matching.test.mjs`.
  - Left for Woody: what a full Landsec login reads on
    a brand (the take still carries BGP's deal history, and the activity
    take BGP's investment requirements and board lots); ChatBGP's
    `sql_write` can still insert a requirement row with any sources (every
    row is client-visible since 17 November 2026); the Brand CRM's
    "Requirement held" for joint agents is still read from all of BGP's
    rows (decision 11; for Landsec logins that is now the rule).

## ChatBGP sets tasks for colleagues from either tool path (2026-11-16)

Woody pasted a ChatBGP conversation (making the agent firm Matta "VIP"
and planning how leasing engages with it) that ended "the task-assignment
tool returned Unknown tool: create_task, so tasks have not landed on" the
two colleagues' lists. ChatBGP has two tool paths in `server/chatbgp.ts`:
`handleCrmToolCall` (one step) and `executeCrmToolRaw` (a multi-step
answer). Only the first knew `create_task`. Both now call one rule,
`createTaskFromChat` (the asker's own list or a named colleague's; a client
login only within the people on its account). Guard:
`qa/regression/chatbgp-create-task-paths.test.mjs`. A tool added to one path
is added to the other.

**ChatBGP starts a CRM strategy** (Woody, 2026-11-16, asked whether "make
them VIP" should put a company on one: "yes chat should be able to"). In the
CRM a company is turned on by a strategy. Since 17 November 2026 a brand can
also carry the Super Brand star (below); ChatBGP's tools do not set it, and
its tool description sends a user to the star on the brand's page.
`server/chatbgp-crm-strategy.ts`, two tools, BGP staff signed in as
themselves only (both on `CLIENT_BLOCKED_TOOLS`, never a joint agent's):

- `start_crm_strategy`: a new strategy (name and objective), or the running
  one named, or with no name the one strategy the company is already on
  (`chooseStrategy`); the company's people (only contacts filed under it);
  and up to 8 first actions, each for a named BGP colleague, on that
  colleague's My Tasks. Refused on an automated run: a strategy is a
  person's decision. A name that means two records, an unknown colleague or
  a new strategy with no objective is a question back and nothing is saved
  (`pickByName`).
- `get_crm_plan`: whether a company is on a strategy, its strategies, open
  actions and events.
- **It has no save of its own.** The strategy goes through `applyKickoff`
  (the save behind the Start strategy button) and each action through
  `createEngagementAction`, so what chat starts is what the page would have
  started and it shows on the Overview, the Watch list and the Diary. It
  sends nothing and books nothing. Tests:
  `server/chatbgp-crm-strategy.test.ts` (in `npm test`) and
  `qa/regression/chatbgp-crm-strategy-guards.test.mjs`.
- **The rest of the plan** (Woody, 2026-11-16, on the three things listed
  as not built: "build it"). Three more tools in the same file, by the same
  rules (BGP staff as themselves, both on `CLIENT_BLOCKED_TOOLS`, no write
  on an automated run, no save of their own):
  - `add_crm_event`: an event for one or more companies (up to 6), through
    `saveEngagementEvent` in the joined view after the form's own checks
    (`eventInputSchema`). Date and time are London time (`londonIso`; a
    date with no time goes in at 09:00 and the reply says so; the hour the
    clocks skip is refused). No date = a draft under Dates to confirm.
    Linked to the strategy named, else the ONE running strategy each
    company is on. Guests are contacts filed under a company on the event,
    saved as `suggested` only. The same title on the same day is a question,
    never a second event. **It is a plan: no invitation, nothing in Outlook.**
  - `update_crm_strategy`: rename, objective, owner, dates, and status
    (paused, completed, active again), through `saveEngagementStrategy` with
    every company and person on it kept (`planStrategyChange`) and the
    version that was read (`expectedUpdatedAt`). The strategy is the one
    named (a completed one can be named, to reopen it) or the one the
    company is on (`findStrategy`). It does not add or remove a company.
  - `update_crm_action`: the STATUS of a CRM action only (done, in progress,
    to do), through `setEngagementActionStatus` in
    `server/crm-engagement.ts`, the one door the CRM page's own save now
    uses too (`PATCH /actions/:id`): the action's owner or the person who
    set it, nobody else. The action is found by its id (`get_crm_plan`
    sends each open action's id and `youCanTick`) or the words of its title
    (`pickAction`).
  - The five names are one list in each file (`CRM_PLAN_TOOL_NAMES` in
    `server/chatbgp.ts`, `CRM_PLAN_TOOLS` in the tool file): a new CRM plan
    tool goes on both, and both tool paths pick it up.
- Not built: ChatBGP editing or cancelling an event, taking a company off a
  strategy, or changing an action's title, owner or due date (the engine
  has no door for the last). None of the five has been asked a real
  question against a model from a build machine: each was run directly
  against a local database.

## CRM week: meetings on the events calendar, and Monday's two emails (Woody, 2026-11-16)

Woody: "can you merge CRM meetings with the events calendar in CRM, the CRM
meeting is great just need to overlay for the week. The directors then want
a summary of those meetings emailed to them on a monday morning." Asked who
and what, he answered: the directors' address; no look back at last week;
and "just landlords at this stage but should also do for brands and agents
separately and send to" the leasing address. Do not re-litigate.

- **Two books of meetings from the same diaries** (`server/landlord-meetings.ts`,
  `DiaryBook`): `landlord`, the one CRM Meetings always read, and `leasing`,
  agent firms and the brands BGP is working (`loadLeasingCatalogue`:
  `workedBrandIds` in `server/crm-hub.ts`, the Brands list's own rule; never
  the whole brand directory, never BGP's own record or people). Each has its
  own store (`landlord_diary_v1:` / `leasing_diary_v1:`), so neither adds to
  the other, and every privacy rule in that file applies to both (private
  mailboxes and entries, absences, revocations). The hourly mailbox sync
  and Check diaries fill both from one read, each failing on its own.
- **Matching** (`server/landlord-meeting-matching.ts`): a person's email
  address or their firm's domain matches in both books. The leasing book
  (`LEASING_MATCHER`) trusts a name in the invitation only when it is two
  words or more: "Next steps" is not Next. Do not loosen that.
  **A name alone needs an outside business guest** (Woody, 2026-11-23: his
  personal invites were on the CRM calendar, which "should just be meetings
  with recognised brands and or Landlords or agents"). In both diary books
  (`LANDLORD_DIARY_MATCHER`, `LEASING_MATCHER`: `nameNeedsOutsider`) a
  company named in the title counts only when someone outside BGP on a
  business address is on the invitation (`isOutsideBusinessAddress`: not
  BGP, not Gmail and the like, not a booking or no-reply sender). A contact's
  own address and the firm's domain still count on their own. Every diary
  read goes through `bookMatcher`; interview transcripts, which have no guest
  list, keep `matchLandlordMeeting`'s plain name test.
  **A BGP address is never a company's contact for matching** (found on live
  the same day: Jack Barratt was filed as a contact of barrette estates under
  his BGP address, so 161 of his diary entries, the dentist and his
  children's clubs included, read as barrette estates meetings): the matcher
  skips any contact email on BGP's own domains (`INTERNAL_DOMAIN_RE`).
  **Personal entries are not filed against contacts either** (Woody, the same
  day: "yes fix it", of a child's rugby and a gymnastics class showing as
  contacts' next meetings): the hourly calendar sync files a diary entry as
  a meeting only when it is not marked private, personal or confidential and
  someone outside BGP is on it at a business address, or is a contact filed
  under a company (`diaryEntryIsBusiness` in `server/interactions.ts`); one
  filed before is taken back on the next sync of its dates. A family member
  who works at a firm in the CRM still reads as a business guest: no rule
  can tell those apart. Tests in
  `server/landlord-meetings.test.ts`.
- **Feeds**, BGP staff only: `GET /api/crm/landlords/meetings/calendar` and
  `GET /api/crm/leasing-meetings/calendar` (each the whole digest, 30 days
  back and 90 ahead). A meeting carries `companyKind`.
- **The calendar** (`client/src/components/crm-engagement/overview.tsx`,
  the Events calendar on the CRM Overview) opens on a **Week** view and
  draws those meetings over the CRM's confirmed events, in Week, Month and
  List: an event is a filled chip, a meeting an outlined one (`MeetingChip`,
  `MeetingRow`, `MeetingDetail`). The **Meetings** pill switches them off.
  A meeting follows the company, kind (Landlords / Brands / Agents) and BGP
  owner filters and steps aside while a strategy or Lenders is picked. It is
  not a CRM event and is never saved as one. Not on a company page's compact
  panel.
- **One set of rules**, `shared/crm-week-ahead.ts` (tests
  `server/crm-week-ahead.test.ts`, in `npm test`): `groupWeekMeetings` (a
  diary entry that names two companies is ONE meeting with both names),
  `leasingSections` (a meeting with a brand and its agent is under Brands;
  Agents holds the rest), the London day and time, the Monday-to-Sunday
  week, and each email's subject and body. The calendar and the emails all
  use it: change a rule there.
- **Monday's emails** (`server/crm-week-ahead.ts`, job `crm-week-ahead`,
  Monday 07:30, both editions, one failing never stops the other):
  **directors** = the week's landlord meetings and the CRM's confirmed
  events, to the directors' address; **leasing** = the week's meetings with
  brands and with agents, no CRM events, to the leasing address. Week ahead
  only. `CRM_WEEK_AHEAD_TO` / `LEASING_WEEK_AHEAD_TO` (a comma list) move
  one and `off` stops it; an address outside BGP's own domain is dropped
  whatever a setting holds. Every word from a diary is escaped and the only
  links are to the app. **A request never names a recipient**: admins have
  `GET /api/admin/crm-week-ahead` (both emails as they stand, and who gets
  them) and `POST …/:edition/send-me` (a copy to the admin who pressed it),
  from "See this week's emails" on CRM Meetings. Guards:
  `qa/regression/crm-week-ahead-guards.test.mjs`. Neither has been sent
  through Microsoft from a build machine, and the leasing book holds nothing
  until the first hourly sync after it goes live.
- Not built: lender meetings; a list of brand and agent meetings on the CRM
  Meetings tab (they are on the calendar and in the email).

## Investment Tracker: the top folds away (Woody, 2026-11-16)

Woody, presenting the tracker in a meeting: "everything stays at the top
when scrolling can you think about how we solve that", then "ok go ahead".
The title, search, status pills, class pills, two drop-downs and the charts
line were all fixed above the table, which was left about a third of the
screen. On a computer (`client/src/pages/investment-tracker.tsx`; a phone
is unchanged, its whole page scrolls):

- **The top is two lines.** The title line (Purchases / Sales, the count,
  Activity charts, Present, Add Asset), then the search, the status pills on
  ONE line (`PillLine`: an arrow at either end and the mouse wheel reach the
  rest; never let them wrap again) and **Filters**: Class, Tenure and Agent
  in one popover, with a count on the button and a chip per filter in use
  (`filterChips`). Class and Tenure are also on their column headings.
- **Scrolling the table folds the top to one line** (`folded`, drawn as
  `foldedTop`; `data-folded` on `tracker-top`): title, board, search, the
  chips, Filters, Show all, Add Asset. It folds past 48px and opens when the
  table is scrolled back to its top, on a wheel-up at the top, or from Show
  all. Folding makes the table taller, which can pull a short list back to
  its top, so a return to the top within 400ms of folding is ignored
  (`foldedAtRef`); a sideways scroll at the top is not a return to the top
  (`lastTopRef`). Keep both or the top flickers.
- **The Present window is the table alone** (Jack, 2026-11-16, built by
  another session the same morning and kept as it was in the merge): the
  title, Purchases / Sales, the count and a search box, no pills, filters,
  charts or Add Asset, with the size buttons and Full screen floating bottom
  right. Nothing there folds (`foldedTop` is never true when `present`). Its
  board is pinned to the four edges of the window (`absolute inset-0` with
  the zoom, in `investment-tracker-present.tsx`): the percentage height it
  had left the board short of the bottom at every size but 100%.
  `ScrollableTable` takes `fill` there: no measured cap, because one
  measured in window pixels is the wrong size inside a zoom.
- Guards: `qa/regression/investment-tracker-top.test.mjs`. The Letting
  Tracker and the Deals table have the same fixed top and have NOT been
  changed: waiting on Woody.

## Investment Comps (Jack, 2026-11-16)

`/investment/comps` (`client/src/pages/investment-comps.tsx`, table
`investment_comps`) holds **completed investment sales only**. Jack's rules:
lettings are not comps; refinancings are deleted; a live deal (pending,
under offer, quoting, on the market) belongs on the Investment Tracker until
it sells. **Subtype is the tracker class** (Retail - London, Office London,
Retail Parks ... `TRACKER_CLASSES`); Type is not used and has no column. The
one class rule is `compTrackerClass` in `shared/tracker-class.ts` (the
tracker's `trackerClass` moved there; `client/src/lib/tracker-class.ts`
re-exports it). The page lists by class, newest sale first.
- Sale evidence is written by ONE door, `fileSaleEvidence` in
  `server/investment-sale-evidence.ts` (find-first, so RCA, the tracker and
  ChatBGP do not duplicate a sale). A tracker row moves to Comps through
  Sold - Comp (row or bulk Change status). Buyers come from Green Street and
  public web sources, never Land Registry (each check costs money).
- ChatBGP's `file_investment_comps` refuses under offer / quoting and sends
  them to the tracker. The RCA import skips refinancings and pending deals
  and sets Subtype to the class.
- The clean-up of 16 November (`server/investment-comp-cleanup.ts`, admin
  `POST /api/admin/investment-comp-cleanup/preview|apply|undo`): lettings and
  refinancings deleted, live deals back to the tracker (a Sold - Comp row
  restored, a building already on the tracker filled, else a new Purchases
  row at U/O - Not BGP or Available), duplicates merged (same building and
  deal; the newest record kept, blanks filled from the older), Subtype set
  to the class. Logged in `investment_comp_migration_log` (batch
  `comp-cleanup-<time>`); Undo puts every row back. Terminated, withdrawn and
  blank-status comps are left for Jack.

## Investment Research (Jack, 2026-11-17)

`/investment/research` (`client/src/pages/investment-research.tsx`,
`server/investment-research.ts`): the investment team's research library,
filed by sector (General or a tracker class). Files are `knowledge_base` rows
(source `investment-research`, category = sector), so ChatBGP's knowledge
search reads their text (PDF, Word, PowerPoint, Excel, text; OCR for a
scanned PDF where set up). BGP staff only on every route.
- **Choose for me** (the upload default) files each document by its name,
  then its text (`shared/research-sector.ts`, rules only); mixed or unclear
  goes to General.
- **Order**: the first batch (added before 10:59 UTC on 17 November 2026)
  is listed flipped, as Jack added it in reverse; files added since sit on
  top, newest upload first. Jack asked for exactly this: not by
  publication date.
- **Key points** (`server/investment-research-intel.ts`, checks
  `shared/research-read.ts`, tests `server/research-read.test.ts`): each
  paper is read once by Anthropic (called directly, cap
  `RESEARCH_READER_DAILY_CAP`, default 100, 0 = off) on upload, or in the
  background when the tab is opened (never on a timer): publisher, month,
  headline, summary, outlook and up to 12 figures, each kept only when its
  quote is in the paper and the figure in the quote. A scanned PDF with no
  text is read from its pages and the words read become its text. Kept in
  `investment_research_reads` (made by the module if missing). Read again
  per row.
- **ChatBGP** `get_market_research` (on `CLIENT_BLOCKED_TOOLS`, both tool
  paths): the read papers by sector or word, newest publication first.
- **Insights feed**: a paper published in the last 12 months (or a new
  upload with no date) is posted once as a staff-only card (audience
  `staff`, source_kind `research`, "BGP research"); clients never see it.

## The BGP side bar (Woody, 2026-11-16)

Woody tidied the BGP staff side bar. His words, in order: "folder business
card and Expenses / my card into each persons individual HR panel and call
it my BGP", "not people and HR", "Website goes to admin", "brand CRM is
already folded into Brand intelligence? can it be the same as Landsec and
just be brands", "move investment requirements out of requirements and put
into investment side panel", "hide lease advisory and investment from all
leasing teams shopping centre london estates high street city and tenant
rep". Do not re-litigate. Guards: `qa/regression/staff-menu.test.mjs`.

- **Brands** is one entry (`/brands`), as on the Landsec menu; the Brand CRM
  is its pill (`/brands?tab=crm`) and has no side bar link. The page's title
  reads Brands. Brand CRM's three views stay as they are.
- **My BGP** (`/my-bgp`, `MyBgpPage` in `client/src/pages/hr.tsx`) is the
  person's own HR profile (`StaffProfile` with `myBgp`): Personal, My stuff,
  Reviews, Career, **Card & expenses** (`MyCardAndExpenses embedded` from
  `my-expenses.tsx`, then the year's analysis without its ledger link) and
  **Business card** (`BusinessCardPanel embedded` from `business-card.tsx`),
  then CV. The same two pills show on your own profile from People & HR.
  People & HR stays the team directory. `/my-expenses` and `/business-card`
  still open on their own (expense notifications, the public card's back
  link and old links) and light My BGP (`MY_BGP_PATHS`). The phone home's
  Boards have My BGP and no Business card tile, and the Business card row
  on the phone's My Profile opens `/my-bgp?tab=business-card` (Woody, same
  day: "Fold into my BGP", superseding the one-tap tile of 2026-09-28).
  Staff only: not on `CLIENT_ALLOWED_ROUTES`.
- **People & HR is renamed My BGP, and is the one entry** (Woody,
  2026-11-17: "put MY BGP above this when coming via the people and HR page
  and remove the my BGP link from the side bar and rename People and HR to
  my BGP"). The side bar and the phone list have one **My BGP** entry, to
  `/hr` (the people page, now titled My BGP), lit on `/hr`, `/my-bgp`,
  `/my-expenses` and `/business-card`; the separate `/my-bgp` entry and the
  phone's People & HR tile are gone (`/my-bgp` still opens your own page,
  for the phone's My Profile row and old links). Your own profile carries
  the My BGP heading whether opened from the people page (with Back) or at
  `/my-bgp` (`myBgp || isOwn` in `StaffProfile`).
- **KYC4U was a pill on My BGP for admins** (Woody, same day: "KYC4U put in
  the People and HR page"), off the More group and the phone list. Since
  21 November 2026 it is a section of Subscriptions & APIs (see "KYC4U's
  files kept in the app"); `/hr?section=kyc4u`, `/kyc-clouseau` and its old
  aliases open it there, so the bookmark install and old links work.
- **Website** is in the Admin group (`adminNavBase`; admin only on the phone
  list). Its routes are unchanged (`requireAuth`): the page still opens by
  its address.
- **Requirements is a pill on Brands for every login** (Woody, 2026-11-17:
  "put requirements in the brands section for everyone"):
  `/brands?tab=requirements`, after Brand Explorer, on a computer and on a
  phone, for BGP staff, Landsec and every other client login (the page still
  decides what a client sees: its read-only Open / Closed list). It is off
  the staff side bar and the phone list. `/requirements` forwards there with
  every parameter it carried (`RequirementsToBrands` in `App.tsx`), so the
  links the app writes keep working; the page draws `embedded` there, under
  the Brands title. A joint agent has no Brands, as before.
- **Reporting and Board Report are Finance → Fees & pipeline** (see "Finance:
  one money page" below): off the More group and the phone list;
  `/reporting` and `/board-report` open `/finance?tab=pipeline`.
- **Investment requirements live only under Investment**
  (`/investment/requirements`, which honours `?requirementId=` and
  `?team=`). The Requirements page is leasing only, with a line pointing to
  Investment; an old `/requirements?type=investment` link is sent on by
  `investmentRequirementsHref` with its requirement, team and "new". Links
  the app writes (landlord pages, landlord chat receipts, the dashboard
  widget, the agent relationship card) point straight at Investment.
- **The leasing teams and Tenant Rep have no Lease Advisory or Investment**
  on the side bar, the phone list or the Deals tabs: `leasingSideOnly` in
  `shared/teams.ts` (every one of the login's BGP teams, `team` plus
  `additionalTeams`, is Shopping Centre, London Estate, High Street, City or
  Tenant Rep; "Landsec" on a login is the client view it may switch to and
  does not count). Anyone also in Investment or Lease Advisory (Pete Wood) and
  anyone with no team (the board, support, consultants) keeps both. Entries
  only: the pages still open by their address.
- **Picking a team shows that team's view** (Woody, 2026-11-17: "its my
  view when I click on a team i should see what they see but I dont"). In
  `app-sidebar.tsx`: the two entries are also hidden while the team switcher
  is on a leasing-side team (`leasingSideOnly([activeTeam])`); while it is on
  a BGP team that is not one of the login's own (`viewingAsTeam`), an
  admin's More and Admin groups step aside for one line, "More and Admin are
  under All Teams"; and a leasing-side login's switcher does not list
  Investment or Lease Advisory. Pages are not cut by the switcher beyond what
  they already filter by team (an admin still sees admin buttons on a page,
  such as Add staff on People & HR).
- **People & HR overview: both columns end level** (Woody, same day: "fix
  this so they line up at the bottom"). `hr-overview.tsx`: the Brucey Bonus
  and Hunger Games boards are `lg:flex-auto` (their own height, sharing only
  spare height; `lg:flex-1` made them equal, so Hunger Games stretched to
  the long Brucey Bonus board and the column ran past the Teams card), and
  the Teams card is `lg:flex-1` in a flex column, so it reaches the foot of
  the row when the left side is taller. Guard:
  `qa/regression/hr-overview-columns.test.mjs`.
- **Brand CRM is Targets only for BGP staff** (Woody, same day: "1 and 2
  yes"): its Diary and Strategies and events were the CRM page's own views
  narrowed to brands. See the Brand CRM section.
- **My Tasks matches the Landsec Tasks page** (the "2" of the same answer):
  a Waiting on you card first (the longest wait first, each task once, not
  repeated in Overdue or the list), numbers on the status pills and the
  summary, a checklist task's property and unit, Deal checklist, stage and
  Required chips and Open the checklist, a tick shown at once and put back
  if the save fails (then the checklist and deal clock are read again), a
  40px tap area round the tick, and "could not be loaded" with Try again in
  place of "All clear!". Everything My Tasks had stays.
- **Approvals is in Admin** (Woody, 2026-11-17: "move approvals into
  admin"). For an admin the entry (`approvalsEntry`, shown only while
  something waits for that person's approval) sits in the Admin group beside
  Expenses, and its count shows beside the word Admin while the group is
  closed (`closedBadge` on `NavSection`); Expenses is not lit beside it on
  the approvals page. Every approver today (Wendy's Accounts login, Layla,
  the directors) is on `ADMIN_EMAILS` and gets it there; an approver who is
  not an admin has no Admin group, so theirs would stay in Core. The phone home's "N expenses to approve"
  card is unchanged.
- **The Investment team has no Brands** (Woody, 2026-11-17: "move brands
  out of investment side panel"): `investmentSideOnly` in `shared/teams.ts`
  (every one of the login's BGP teams is Investment: Jack Barratt, Nick
  Halley, Jonny Palmer), `INVESTMENT_SIDE_HIDDEN_URLS`. On the side bar the
  team on the switcher decides when it is a BGP team (viewing as Investment
  hides Brands; an Investment login viewing a leasing team sees that team's
  menu), else the login's own teams; the phone list reads the login's teams,
  as the leasing rule does. Entries only: `/brands` still opens.

**The People & HR staff list masks personal fields** (16 November 2026,
found while building My BGP): `GET /api/hr/staff` sent every login each
colleague's salary, emergency contact, holiday allowance and days, pension
and contract / passport links (the screens hid them). It now masks exactly
what `GET /api/hr/staff/:userId` masks, for anyone but an admin or the
person. `qa/regression/hr-staff-masking.test.mjs` holds the two lists in
step: a new personal field is masked on both.

## Finance: one money page (Woody, 2026-11-17)

Woody: "can you fold reporting and board report in to finance trya nd make
it sync and to the point there is so much going on its overhwelming and it
defo double counts". Asked, he chose "Neg & HOTs 50%, SOL+ 100%" for every
pipeline figure, "Xero invoices, May–April" for fees billed and "Keep money
only". Do not re-litigate. Guards: `qa/regression/finance-one-rule.test.mjs`.

- **One pipeline rule**, `shared/finance-pipeline.ts` (`PIPELINE_WEIGHTS`,
  `pipelineStage`): Negotiating and HOTs 50%; Solicitors, Exchanged and
  Completed-not-yet-invoiced 100%; an invoiced deal (a Xero invoice raised
  against it at any stage, or INV) is Xero income only, never the book;
  withdrawn, archived,
  Marketing and earlier never count; an investment deal counts from
  Solicitors (`isProvisionalFee`). Before this there were four sets of
  weights (the outlook NEG 50/SOL+ 100, the dashboard's projection NEG 50 /
  SOL 75 / EXC 90, forward commission NEG 50 / SOL 75, Reporting and Board
  Report every deal's full fee by calendar year) and HOTs dropped out of all
  of them. The cash flow projection (`buildDealProjection`), the Xero WIP
  forecast (`buildWipForecast`), forward commission (`FORWARD_WEIGHTS` from
  `FORWARD_COMMISSION_STAGES`: NEG, HOT, SOL; EXC, COM and INV are in the
  statements), the outlook's stage list and Fees & pipeline all read it.
  Never write a weight anywhere else.
- **One book**: `loadBookDeals` in `server/finance-board.ts` is the query
  behind both the cash flow projection and Fees & pipeline.
- **The page is six pills** (`FINANCE_TABS` in `client/src/pages/finance.tsx`,
  `?tab=`, a pill change replaces the address): **Overview** (the four Xero
  headline stats and the Company outlook, whose deal book is now one line
  with a Fees & pipeline link), **Fees & pipeline**
  (`client/src/components/finance-board.tsx`, `GET /api/finance/board`):
  the deal book weighted and at full fee, expected this year (with no date
  and after 30 April named, so the parts add up), invoiced this year, the
  stage rows with their deals, by team (a deal on several teams is shared
  equally, `teamShares`, so the teams add up to the book), by deal type, the
  ten largest deals, fees by agent (invoiced this year and the weighted
  book, each shared by the deal's fee split; BGP House's slice is its own
  line, never an agent; invoices with no deal or no split are named) and
  **Download Excel** (`GET /api/finance/board.xlsx`, the board pack: Summary,
  By stage, By team, By deal type, Deals, Fees by agent, Invoiced by month);
  **Cash flow**; **Commission** (statements and Equity partners);
  **History** (Historical billings); **Spend** (card spend, app costs). Both
  routes are `requireEquityOrAdmin`, like the rest of Finance.
- **Fees billed** = Xero sales invoices (AUTHORISED or PAID) dated in the
  financial year, ex VAT: `fyInvoices` from `buildFinancials`, kept on the
  server (`forReply` strips it from `/api/xero/financials` and the saved
  last-good copy). Deals never add to fees billed.
- **Dropped on purpose** (Woody: "keep money only"): record counts
  (contacts, properties, deals), the leasing activity trend, conversion
  rate, average deal size, time-to-close charts and the news panel. The old
  `/api/board-report` and its Excel export (all deals, any status, a deal
  counted once per team) are deleted; `client/src/pages/reporting.tsx` and
  `board-report.tsx` too.
- **The dashboard and phone match Finance**: the Equity Finance widget and
  the phone's Company tile take the deal book and the projected year from
  the Company outlook itself (`useCompanyOutlook` in
  `client/src/lib/use-company-outlook.ts`: the same queries, builder and Xero
  fallback as the page). The server's old `projection` (income + weighted
  book − a Xero cost run rate) is retired: it disagreed with the outlook.
  The widget's "Cost run rate" tile went with it.
- Not changed: the WIP report and `/api/wip/agent-summary` (the WIP
  schedule's own view, every WIP status at full fee), and the commission
  statements' billings (fee due at exchange or completion, Woody's scheme).

## Foreign companies, foundations, reliance and stopping acting (Woody, 2026-11-21)

Woody asked "Does the app manage all the overseas questions and process",
then answered "Yes go ahead" to four builds: a foreign company with no UK
record looked up in GLEIF; foundations treated like trusts; relying on
another firm's checks (MLR 2017 reg 39); and a Stop acting (AML) button.
Do not re-litigate. Tests: `server/aml-reliance.test.ts`,
`server/aml-stop.test.ts` (both in `npm test`), cases in
`server/kyc-abroad.test.ts` and `server/aml-second-read.test.ts`; guards
`qa/regression/aml-reliance-stop-guards.test.mjs`.

- **A company with no UK record** (no Companies House number and no entity on
  the Register of Overseas Entities) that reads as registered abroad (a
  foreign legal form in its name, `looksOverseasName`, or a country outside
  the UK on the CRM): BGP's checks before asking look it up in GLEIF by its
  name, narrowed by that country, and follow its parents as for a company
  abroad. A UK-looking company with no number is not followed as one abroad
  (Woody, 21 November 2026: "This is just international? Don't want to
  break what we've built"); since later that evening GLEIF is asked about it
  too, as a line, and a UK match is read at Companies House (next section).
  The run stores it as `result.abroad` with `party:
  true`, and it shows in the company facts and KYC4U's note. Its people to
  check read `abroad_company`: the people behind it are recorded under Owners
  abroad. It is screened as a company. The rule that sends a party owned from
  abroad to KYC4U is unchanged.
- **Foundations** (MLR 2017 reg 6: a foundation has no shareholders, so the
  people who control it and the people it benefits are its beneficial
  owners):
  - The name rule is `foundationMarkInName` in `shared/deal-parties.ts`:
    fondation, fonden, stichting, fundación, fondazione, fundação, fundacja,
    nadace, nadácia, Stiftung, stiftelse. The English word "Foundation"
    counts only for one registered abroad (Jersey, Guernsey, Liechtenstein,
    Panama ...): English law has no foundation, and a UK "… Foundation" is a
    charity company or a charitable trust, read as it always was. The caller
    says where it is registered (the owner's register, the CRM country).
  - It never reads a name ending in a company form (Ltd, Limited, A/S, GmbH
    …), and never a tenant brand's own name, which is a trading name
    ("Foundation Coffee House").
  - The party box and the AML box suggest **Record as a foundation**, which
    sets the trust record (`aml_subject_type = 'trust'`). It is never
    applied by itself.
  - A foundation in the ownership is the policy's trust factor
    (`policy_trust`: enhanced, KYC4U). That covers one on the register, one
    owning from abroad, and a GLEIF parent above a company abroad. The
    factor asks for the charter and by-laws, the founder, the board or
    council, any protector and who benefits.
- **Relying on another firm's checks** (MLR 2017 reg 39). Rules:
  `shared/aml-reliance.ts`; routes in `server/deal-party-aml.ts`; table
  `kyc_reliance` (a boot migration).
  - **Who and for what**: the Nominated Officer or a Deputy records it for a
    party on ONE deal. Reliance is agreed per transaction, so it is never
    carried to the party's other deals.
  - **What is recorded**: the firm (its kind, the UK or abroad and its
    country, its AML supervisor and number, a contact, the day it agreed),
    and what it checked.
  - **Each condition is ticked**:
    - the firm agreed in writing;
    - BGP holds from it who the customer is, its beneficial owners and
      anyone acting for it (reg 39(2)(a));
    - the firm gives copies of its documents immediately on request and
      keeps them five years (reg 39(2)(b));
    - abroad, the firm is under equivalent rules and supervision (reg
      39(3)).
  - A firm in a FATF call-for-action country is refused (reg 39(4)).
  - The firm's letter or email is required, filed as `reliance_letter`.
  - **While it stands**:
    - every person to check owes nothing ("Covered by reliance");
    - the Client checks line reads "Not needed: relying on …";
    - the sign-off needs no note, and its line names the firm;
    - the AML dashboard stage is **Relying on another firm** (in progress,
      waiting on BGP's sign-off);
    - the risk assessment and KYC4U's note carry it.
  - **It does not cover enhanced due diligence** (HMRC). The KYC4U, trust,
    owners-abroad and red flag steps come first, and BGP stays responsible
    (reg 39(1)).
  - Withdraw puts the client checks back; a new reliance replaces the last.
    Five-year deletion and company merges cover the table.
- **Stop acting (AML)** (MLR 2017 reg 31). Rules: `shared/aml-stop.ts`;
  server: `server/aml-stop.ts`; columns `crm_deals.aml_stopped_*` (boot
  migrations, not in `shared/schema.ts`).
  - **The button**: **Stop acting** in the AML box header, for the officers.
    They give a reason (the checks cannot be completed, or another AML
    reason) and a note only the officers read. They may also move the deal
    to Withdrawn (WIT, through the letting service, mirrored to the
    tracker).
  - **While stopped, the deal**:
    - moves only to Withdrawn, through every status door
      (`amlStopDenial`, asked by `dealStatusTransitionDenial`, the deal save
      and the bulk update);
    - cannot be invoiced (`POST /api/xero/invoices` answers 409);
    - cannot be deleted (single and bulk delete answer 409);
    - keeps its AML file.
  - **What people are told**: refusals use neutral words
    (`AML_STOP_REFUSAL`, "on hold by BGP's compliance team"), safe for a
    client login. The deal's agents and the officers are emailed without the
    reason (`amlStoppedEmail`): telling anyone why risks tipping off.
  - **The banner**: BGP staff see a red banner on every pill of the deal
    page. The officers also see why, and **Release**, which puts back the
    status the stop withdrew it from, through the ordinary gates.
  - It is the officers' own decision, never set by a report or a consent
    request. It is not the hold while the NCA decides, which Woody declined
    on 20 November 2026.
- **A client login's deal History leaves out every AML and KYC line**
  (`aml…`, `kyc…`, `client_checks…`), not only the old fixed list. The
  sign-off, red flags set aside and the AML file lines had reached Landsec's
  History before (found 21 November 2026).
- Not built: stopped deals as a list on the AML dashboard (a stopped deal
  that is withdrawn leaves it); ChatBGP saying a deal is stopped; reliance
  while the client checks are switched off.

## UK screening without KYC4U: GLEIF, the charity register, in-house enhanced due diligence (Woody, 2026-11-21)

Woody: "We need screening on GLEIF and foundations in the uk as I'm trying
to set this up without using kyc4u". Do not re-litigate. Rules:
`shared/charity-register.ts`, `gleifOwnerAbroad` and `gleifPartyLine` in
`shared/kyc-prechecks.ts`, `GLEIF_UK_REGISTERS` in
`shared/foreign-owner-words.ts`, `signOffEnhanced` and `IN_HOUSE_EDD_NOTE_MIN`
in `shared/party-kyc.ts`; the register: `server/charity-register.ts`; the run:
`runPrecheck` in `server/kyc-prechecks.ts`. Tests: `server/uk-screening.test.ts`
(in `npm test`), `qa/regression/uk-screening-guards.test.mjs`.

- **GLEIF for UK parties.** GLEIF records each entity's register
  (`GleifEntity.registeredAt`: RA000585/6/7 are Companies House, RA000589 the
  Charity Commission, RA000590 the Scottish Charity Register; read from
  GLEIF's list that day). A UK company is looked up by its Companies House
  number on Companies House's registers only (`authorities`, so a charity
  with the same number is never taken), and its LEI and parents are kept on
  the run (`result.gleif`) and shown as a GLEIF line in the company facts,
  the card, KYC4U's note and the risk assessment, apart from the Owners
  abroad trace (`gleifPartyLine`), so a UK company opens no Owners abroad
  section. Each GLEIF parent is screened: a UK one against the sanctions
  lists, one abroad in full. The top parent abroad joins the owners abroad
  only when the register names no person who owns the company and no owner
  abroad is known (`gleifOwnerAbroad`, `via: "gleif"`: the accounts' rule).
  A company with no UK number and none on the Register of Overseas Entities
  is looked up by name in any country: a Companies House match is read there
  (`gleif.foundNumber`, worded "check it is the same company"), a
  Charity Commission match goes to the register by its number, and a match
  abroad is the abroad path only when the name reads as foreign or the CRM
  country is abroad (else it is a line).
- **The Charity Commission's register** (England and Wales). Its API needs a
  subscription key; its public download does not and holds the trustees: three
  zipped JSON files (charity, trustee, other names; about 86 MB) published
  daily, one object a line. `server/charity-register.ts` downloads them on the
  first look-up of a day (kept in the machine's temp directory; a copy up to
  a week old is used if the day's download fails; ten minutes' pause after a
  failure), never at boot or on a timer, and reads them as streams (about ten
  seconds a run, little memory). `CHARITY_REGISTER=off` stops it,
  `CHARITY_REGISTER_URL` and `CHARITY_REGISTER_DIR` move it. It never throws.
  - **Which charity** (`pickCharity`): its charity number, else its Companies
    House number (a charitable company), else exactly its name or a working
    or previous name (accents, case, punctuation and a leading "The" aside);
    a registered charity wins over a removed one; two of a name are
    ambiguous and none is taken. **A corporate trustee**: a company the
    register lists as a charity's trustee (THE WELLCOME TRUST LIMITED for the
    WELLCOME TRUST, 210183) is read as acting for that charity (`via:
    "trustee"`); trustee of several, the charity number is needed.
  - **When it is read**: a party recorded as a trust or foundation; a
    charity GLEIF names; a UK company that may be a charitable company or a
    trustee (a company limited by guarantee, a CIO type, a name with
    "Trustees"); a party with no UK record whose name reads as a charity
    (`readsLikeCharity`). A charitable company found by name gets its
    Companies House record read by the register's number.
  - **Screened**: the charity (and the one it acts for) in full; its
    trustees (`trusteePersonName` drops titles and letters such as OBE, never
    a surname) as its controllers, the chair first, in full up to the web
    search's ten (basis `trustees`: MLR 2017 reg 6 for a charitable trust,
    reg 5 and 28(6) for a charitable company or CIO); an organisation trustee
    in full. No date of birth is published, so ComplyAdvantage keeps its
    bars for them.
  - **Red flags** (`charity_status`): removed from the register, insolvent,
    in administration, a dissolved CIO. Accounts or returns overdue and
    "double default" are warnings.
  - **Shown**: the Company section's charity block (number, kind, status,
    accounts, address, trustees, other names, the register's link by its
    organisation number, the attribution line), a Charity Commission card
    line, KYC4U's note, the risk assessment's structure; People to check
    lists the trustees with their sanctions result (basis `charity`; a
    director who is a trustee once), and only the person dealing with us is
    asked for ID.
  - **A trust or foundation needs no company that signs**: its own record is
    checked (the deal's AML status, the AML file and Run again treat
    `aml_subject_type = 'trust'` as they treat a private individual), and its
    client checks can be sent. The party box suggests **Record as a charity
    or foundation** for a UK party with no Companies House number, no
    company that signs and a charity-like name (`charityHint`), never
    applied by itself.
- **In-house enhanced due diligence** (the officers' setting,
  `system_settings.aml_in_house_edd`, OFF by default; `PUT
  /api/aml-policy/in-house-edd { on }`, the Nominated Officer or a Deputy,
  admins while none is set; **Do it in-house** on the AML policy panel, Deals
  → AML). While on, an enhanced party (a red flag or factor, the party's or
  the deal's, a higher-risk file, a trust or foundation, owners abroad) is
  not sent to KYC4U: its client checks run as any party's, the Next line
  ends at the officers, the red Not yet with KYC4U box and the dashboard's
  mark are not shown, and `signOffDenial` lets the Nominated Officer or a
  Deputy sign it off with a note of at least 40 characters saying what was
  checked and why the risk is acceptable (an agent is refused, 403). A
  possible sanctions match (`isSanctionsFlag`) must be resolved first. The
  approval lasts a year (enhanced), and the sign-off line says "enhanced due
  diligence; done by BGP's officers, not KYC4U". Tried end to end on a local
  copy on 22 November 2026: a deal whose landlord was recorded as a
  foundation ran the real checks (GLEIF found the Esmée Fairbairn
  Foundation's LEI on the Charity Commission's register; the register gave
  its 11 trustees; all 12 names screened clear), went to KYC4U with the
  setting off, and with it on was signed off by the Nominated Officer for a
  year. A request already submitted to KYC4U
  still waits for its result. KYC4U stays available for any party. Switched
  off, everything is as it was (Jack, 20 November: trusts to KYC4U in full;
  Woody, 21 November: foreign companies to KYC4U).
- Not built: Scotland's and Northern Ireland's charity registers (a Scottish
  charity GLEIF names is a line only); a trust's own documents in the client
  checks (the trust deed, a Trust Registration Service excerpt); reading a
  charity's governing document. Not run against GLEIF's live API or the
  register's live download from the app (tried on a build machine against
  the real download of 21 November 2026: Esmée Fairbairn Foundation by name
  with 11 trustees, the Wellcome Trust by number and through its corporate
  trustee, in about 11 seconds).

## The app says "transaction", not "deal" (Woody, 2026-11-22)

Woody, on the client's checks page: "Can we call the deal the transaction",
then "Everywhere", and asked whether that meant BGP's own screens too, "The
whole app". Do not re-litigate. Every word a person reads says transaction:
the side bar and phone tabs (Transactions, on the Landsec and joint agent
menus too), New Transaction, the transaction page and its pills, the
Transactions board and WIP report columns, toasts, error messages, emails to
the team and to clients, Excel sheets and PDFs, and ChatBGP's app map. The
words were changed by reading the code, not by search and replace: only text
on screen, in a message or in a document.

- **What keeps "deal", on purpose**: page addresses (`/deals`, `/deals/:id`),
  API routes and fields (`dealId`, `crm_deals`, `deal_ref`), codes and stored
  values, history lines already written, test ids (the menu's are built from
  its labels, so they read `nav-transactions` and `bottom-nav-transactions`
  and the smoke suites follow), SQL, logs, and the model's own instructions
  and tool definitions. Also, because each is read back or names something
  outside the app: Landsec's own heads of terms forms
  (`shared/hots-standards.ts`), BGP's AML clause in heads of terms
  (`AML_HOTS_CLAUSE`, compared with copies stored on properties), the letting
  note reader's word list (`shared/letting-note-parse.ts`: people still write
  "deal"), Xero's tracking category "Property / Deal"
  (`server/expense-xero-poster.ts`, `server/xero-chart-setup.ts`), the WIP
  import's "Deal ID" header and its error message, and ChatBGP's memory
  categories ("Deals").
- **A label used as a value changes on both sides**: "From deals" (a BGP
  person from the account's deals) is now "From transactions" in the SQL
  that writes it (`server/brand-profile.ts`) and the screen that reads it
  (`client/src/components/company-bgp-team.tsx`); the sidebar's retitle
  compares "Untitled Transaction", as `client/src/lib/format.ts` writes it.
- **ChatBGP** is told the word in its staff and client instructions and the
  app map (`**Words**` line): it says transaction and understands deal.
- **A new screen, message or email says transaction.** A new string read
  back as a value, or naming something outside the app, keeps its own word.

## Folders: one engine (Woody, 2026-11-24) — docs/folders-review-2026-11-20.md

Woody, on the folders review: "go ahead with the folder suggestion", which
approved every recommendation in its section 5, then "push and finish the
build". Do not re-litigate: links by Microsoft's ids in a new table (decision
1); the picker opens at the top of `BGP - Share Drive` and the person chooses
where (2); "New folder" is empty and "New property folder" makes the client
tree's five property folders, and the templates keyed by retired team names are
retired (3); a transaction shows its own folders, then its property's, and Add
folder on a transaction links to it with a tick to put it on the property
instead (4); six muted app colours on the chip, seen in the app only (5, a
deliberate exception in `docs/DESIGN.md` §1); BGP staff share chosen folders
with a client (6); folder actions run as the person, with their own Microsoft
365, never a colleague's (7); the app's own picker, not Microsoft's (8); no
client uploads yet (9). **Read the review before touching folders.** Steps 0
to 5 of its 4.9 and decision 6 are built (24 November 2026). Decisions 10 (the
app's own Microsoft permissions) and 11 (the server-disk team folders) wait on
Woody and BGP's Microsoft admin. **Nothing new is ever made in the old `BGP
share drive` tree** (the client tree job still fills in a client's existing data room there: decision 6).

- **The tables** (boot MIGRATIONS in `server/index.ts`, not in
  `shared/schema.ts`): `record_folders` (record type and id, Microsoft's drive
  and item ids, label, colour, position, the name, path and address SharePoint
  last gave, status, source `picked` / `created` / `pasted` /
  `migrated:<column>`, who linked it, `removed_at` for an unlink: rows are never
  deleted; `shared_with_company_id`, `shared_by`, `shared_at` for a share with a
  client) with one live link per folder per record (the partial unique index
  `record_folders_live_uq`), and `folder_actions` (every action, failed ones
  too: who, the Microsoft account Graph saw (`app` for the app's own filing),
  the action, the record, the item, names and parents before and after,
  detail). A property merge moves its links (`server/property-merge.ts`); a
  company merge moves the merged company's links and shares to the keeper
  (`server/folders/merge.ts`, called in `mergeCompanyInto` once the references
  are repointed; a folder the keeper already links is unlinked on the merged
  one, its share carried over). Undoing a merge leaves the folders on the
  keeper.
- **Records**: property, deal (a transaction), company, scheme, pla_matter
  and pathway_run (`FOLDER_RECORD_TYPES`, `folderRecord` in
  `server/folders/access.ts`).
- **The one door to Microsoft** is `server/folders/graph.ts` (`graph()`,
  stood in for by tests with `setGraphTransport`): graph.microsoft.com with a
  token the caller hands in; an upload session's or a copy monitor's address on
  BGP's own SharePoint (`brucegillinghampollardlimited(-my).sharepoint.com`),
  which Microsoft signs, with NO token and redirects not followed; anything
  else is refused. Busy answers (429, 503) are waited out twice. Nothing else
  in `server/folders/` calls fetch or names Graph, and nothing in
  `server/folders/` takes the app's token itself: the app's own work hands it
  in from outside (`server/document-filing.ts`).
- **Who**: BGP staff signed in as themselves (`folderStaff`: `contactViewer`;
  staff viewing as a client are refused). The client gateway refuses the whole
  of `/api/folders/` to client logins and joint agents (only
  `/api/folders/client/` could ever be listed); their data room stays on
  `/api/client/sharepoint/` (`ClientPropertyFoldersPanel`, test id
  `client-property-folders-panel`, which the smoke suite waits for). Each route
  goes through `handle("staff" | "maybe" | "microsoft")`: the staff check comes
  before any token is asked for, and a person with no Microsoft 365 of their
  own gets 428 with `connect: true` ("Connect your own Microsoft 365 first, on
  the SharePoint page"). `getOwnMsAccess` in `server/microsoft.ts` gives their
  own token and account, never a colleague's.
- **No colleague's token anywhere a person acts on files** (decision 7): the
  SharePoint page, the dashboard widget and the Excel add-in
  (`/api/microsoft/files`, `files/folder`, `files/item`, `files/upload`,
  `files/content`, `files/thumbnail`, through `ownFileToken`) and Image
  Studio's PDF capture use the person's own Microsoft 365 or answer 428 with
  `connect: true`, and the screens say to connect it on the SharePoint page.
  Folder listings no longer ask Graph for thumbnails. The SharePoint page's
  Team Folders list and its Set up are gone (retired team names, `BGP share
  drive`), with `/api/microsoft/team-folders`, `team-folders/setup`,
  `company-folder-templates`, `shared-folder-probe`, `sharepoint/debug`,
  `sharepoint/sites`, `files/share-link`, `files/invite`, `startImageSync`,
  `TEAM_FOLDERS`, `TEAM_FOLDER_TREES` and `COMPANY_FOLDER_TREES`.
- **Routes** (`server/folders/routes.ts`): places, browse, search; a record's
  folders (`GET /api/folders/:recordType/:recordId`, its own then its
  property's, refreshed from SharePoint after ten minutes, with who each is
  shared with); link (ids or a pasted address), create (`empty`, `property` or
  `lease_advisory` template) then link; label, colour, order, unlink
  (`/api/folders/links/:id`); share with a client (`GET`/`POST
  /api/folders/links/:id/share`). Inside a folder
  (`/api/folders/items/:driveId/:itemId/...`): new folder, rename, move (the
  same library only), copy (to any folder; followed through
  `GET /api/folders/copies/:jobId`, kept in memory), delete (to the library's
  recycle bin), upload (up to 10 MB in one go; larger through
  `upload-session` and `PUT /api/folders/uploads/:sessionId` pieces of whole
  320 KB blocks, in order, relayed by the server so Microsoft's signed address
  never reaches the browser), share (a link for anyone, falling back to people
  at BGP and saying so; or an invitation by email), preview, and follow /
  unfollow (Graph's own, so the picker's Followed list shows it). The top of a
  library and `BGP - Share Drive` itself are never renamed, moved or deleted
  from the app, nor linked to a record or shared with a client
  (`linkTopProblem`: the top of a library or a OneDrive, or the whole of `BGP -
  Share Drive`; the server refuses it and the pickers do not offer it, so one
  press cannot link the whole drive to a transaction), a folder linked to a
  record is unlinked before it can be deleted, and a name already there is
  never replaced (new folders fail; uploads, copies and the app's own filing
  get a number). Rules: `shared/folders.ts`.
- **Templates** (`FOLDER_TEMPLATES`): `empty`, `property` (the client tree's
  five property folders) and `lease_advisory` (Lease Documents, Rent Review,
  Lease Renewal, Dilapidations, Service Charge, Correspondence and Legal, with
  the folders within them: 20 paths). A new folder on a Lease Advisory matter
  starts as `lease_advisory`, on a property as `property`, anything else
  empty (`defaultFolderTemplate`); the picker lists the record's own first,
  with what is inside it.
- **Screens** (`client/src/components/folders/`): `RecordFolders` (the strip
  of chips, Add folder, the open folder; a chip's menu has Open in SharePoint,
  Rename the label, Colour, Move up / down, Share with <client> / Stop sharing,
  Follow / Stop following, Unlink and Also linked to; a shared chip has a
  people mark and a "Shared with" line; `compact` draws the chips only and
  opens a folder in a window), `FolderPicker` (Search, Browse from `BGP -
  Share Drive`, My OneDrive or Followed, New folder here, tick several, Paste a
  link instead), `FolderBrowser` (filter, sort, list or grid, a menu on every
  row that can always be seen, ticks for Move / Copy to / Delete together, New
  folder, Upload and drop with progress, Follow on a folder's row),
  `folder-actions.tsx` (the dialogs), `folder-share.tsx` (the share menu items,
  dialog and marks), `record-folder-links.tsx` (a read-only list) and
  `client-shared-folders.tsx` (the client's shared folders). `FolderDialog` is
  a dialog on a computer and a sheet from the bottom on a phone; no browser
  prompt or confirm anywhere. A client login gets its data room through the
  same `RecordFolders` (`client`), before any engine read.
- **Where** (every page that showed folders, step 5): the transaction page's
  Files pill (a joint agent still reads "Documents are managed by the BGP
  team."); the plan-led property page's **Folders** button
  (`button-property-folders`, with its brochures) and the page as it was (its
  **Folders** card); **New property folder** in place of Set Up Folders (More
  menu, and the classic header); the property set-up dialog's Files step and
  the Properties list's **Folders** column (`InlineFolderTree`); a landlord's
  **Files** pill (the company's Folders for BGP staff, its data room for a
  client login, nothing until the sign-in is known; the **<company> property
  tree** button stays, Set Up Folders and the team tabs are gone); a brand's,
  agent firm's and lender's **Documents & gallery** (compact Folders, staff
  only, in place of "Open <brand> folder on SharePoint"); each scheme on the
  property's schemes panel (compact, record type `scheme`; the schemes routes
  no longer read or write `property_schemes.sharepoint_folder_url`); a Lease
  Advisory matter's **Folders** card (its header's folder buttons are gone);
  a Pathway run's CRM & Folders card (stage 1 keeps a stored folder and no
  longer searches `Investment/<address>`); and the ChatBGP page (a property
  thread's Folders, read only, each opening in SharePoint, staff only). The
  brochure, schedule and plan finders (`server/sharepoint-property-files.ts`)
  also walk folders linked in Folders. Deleted with the move:
  `PropertyFoldersPanel`, `SetUpFoldersDialog`, `PropertySharepointLink`, the
  dead copies in `instructions.tsx` and `companies.tsx`,
  `sharepoint-folder-picker.tsx`, `server/pla-folder-template.ts` and the
  matter's apply-folder-template route, the property folder tree route
  (`server/property-setup.ts`), `GET/PUT /api/crm/properties/:id/sharepoint-folders`,
  and `/api/microsoft/property-folders` (both), `/company-folders` (both),
  `/folders` and `/folder-templates`.
- **Documents the app files** (`server/folders/filing.ts`, rules in
  `shared/folders-filing.ts`): the Targeting Brief, Document Briefs, Lease
  Advisory workbooks, the Pathway model and Why Buy go into their record's
  first linked folder by position (a transaction, matter, scheme or run with
  none: its property's first), inside their own sub-folder (Targeting Briefs,
  Rent Review/Valuation, Rent Review/Comparable Evidence, Models, Why Buy Deck
  and so on), made where missing, on the app's token
  (`server/document-filing.ts`: `fileAppDocument`, `appFilingNote`). With no
  folder linked the document stays in the app and the person sees "Not filed
  in SharePoint: link a folder to <property> first." (the note on the
  Targeting Brief goes to BGP staff only; Save HTML is refused before drawing).
  A document made from an email to ChatBGP is attached to the reply and never
  filed (it names no record). Each folder made and each upload is a
  `folder_actions` row with `ms_account` `app`.
- **Document Studio's File to SharePoint and Legal & DD's Create Project**
  choose the place in `FolderPicker` and act as the person, on their own
  Microsoft 365 (428 to connect). Create Project makes the analysis's folders
  with `createFolderTree`, lists what was made and what was not, and links the
  new folder to the analysis's transaction when it has one (`crm_deal_id`).
  `GET /api/documents/sp-folders` is gone.
- **Shared with a client** (decision 6; `shared/folder-share.ts`,
  `server/folders/share.ts`): BGP staff share a folder linked to a property, a
  transaction (through its property) or a company (with itself) with one
  client company whose logins can open that record (the property's landlord or
  a company linked to it, not merged away, with an active client login; never
  any other company). Sharing re-reads the folder on the person's own
  Microsoft 365: it must be a folder in BGP's library, never a drive's top or
  `BGP - Share Drive`. Stopping needs no connection. Logged as `share_client` /
  `unshare_client`. Scheme, Lease Advisory and Pathway folders are not
  shareable. **The client reads it** on `/api/client/sharepoint/shared`,
  `…/shared/:linkId/list?path=` and `…/shared/:linkId/content?path=`, with the
  app's token, by the link id and names below it, never a drive or item id:
  the link must be shared with the caller's company on a record it can open
  (`isPropertyInScope`, `isDealInScope`, `schemeLimitedPropertyIdsOrNone`;
  fails closed), the folder is read by its stored ids and an item counts only
  when it lies below it (`insideSharedFolder`). A company's own folder never
  shows to a login held to schemes; a joint agent's transaction page shows
  none. Shared folders show in the client's property data room and on its
  Files page, read only.
- **Code that works by path, and ChatBGP's folder tools** (`server/folders/by-path.ts`):
  a path a person gives starts inside `BGP - Share Drive` (`shareDrivePath`)
  and the old `BGP share drive` is refused; a missing folder is made only
  below one that must already exist (`keep`), and in the old tree only below
  a record's own folder (an old Pathway run's). ChatBGP's folder tools are one
  file, `server/chatbgp-folder-tools.ts`, which both tool paths run
  (`FOLDER_TOOL_NAMES`): look in a folder, read a file, make a folder, move,
  upload a chat file, copy from Dropbox, save an email attachment, and
  `get_record_folders` / `link_record_folder` (a property's, transaction's or
  company's folders, and linking one by a path or a pasted address). BGP staff
  only (on `CLIENT_BLOCKED_TOOLS`), on their own Microsoft 365, never on an
  automated run (reading a record's folders asks Microsoft nothing, so that
  one runs there too); every change is logged with `via`. Email attachments,
  the MLRO report (`<team>/AML/MLRO Reports/<transaction>`, kept out of record
  folders, which can be shared with a client) and Model Studio's template
  upload save through `saveToShareDrive`. Model Studio's assistant and Embed
  Excel (its live copy in `Models/Live`), Pathway's file look-ups and the
  design tools use the person's own token (428 to connect); the MCP server's
  SharePoint tools and the news comps reader keep the app's token. The client
  tree build and the folder inventory report use the person's own Microsoft
  365 (428 to connect). The SharePoint page's upload with no folder open is
  refused, never put in the old tree. Everything goes through `graph()`;
  `server/utils/sharepoint-operations.ts` and `uploadFileToSharePoint` are
  deleted.
- **Model Studio's Save version** files the version under `Models` in the
  run's property's folder by the filing rule above, on the person's own
  Microsoft 365 (`fileRecordDocument` with their token and account); with no
  property or no folder linked it stays in the app and the reply carries the
  words (`sharepointNote`). No folder is made by name.
- **Never into a folder shared with a client** (24 November 2026): the app's
  own filing (`filingPlace`) skips a linked folder shared with a client, and
  any folder inside one (`filingBlockedByShare` in `shared/folders-filing.ts`,
  by drive and the stored path; a folder with no path on a drive that holds a
  shared folder is skipped too), because a client sees everything below a
  shared folder. When every linked folder is shared the words say "Not filed
  in SharePoint: the folders linked to <property> are shared with a client.
  Link a folder only BGP uses first."
- **Old links** (a property's `sharepoint_folder_url` and
  `sharepoint_team_folders`, a transaction's `sharepoint_link`, and the one
  stored address of a company, scheme, Lease Advisory matter or Pathway run,
  `LEGACY_RECORD_FOLDER`) show as chips marked "old link", read only, until
  moved over (`legacyFolders` in `server/folders/links.ts`); one a migration
  run moved is hidden until the run is undone, and one that opens to a folder
  the record already links shows as the link only.
- **The migration** (`server/folders/migration.ts`, Settings → **Folders:
  moving the old links over**, admins; `GET /api/admin/folders/migration`,
  `POST …/apply`, `POST …/undo`, `GET …/runs`): Preview opens every stored
  address and old team-folder path (`BGP share drive/<team>/<name>`) as the
  admin, on their own Microsoft 365, with a status (opens, not in SharePoint,
  a file, not BGP's SharePoint, no access, already in Folders, could not be
  read), lists `BGP share drive/Companies` once and offers each folder to the
  company of exactly that name (`companiesPlaceRows`, merged companies left
  out), and, for records with nothing that opens, folders of the same name in
  `BGP - Share Drive` as suggestions only. Apply takes the rows the same admin
  ticked on that preview within the hour (`migrationApplyRefusal`), as links
  with source `migrated:<column>` in one logged batch
  (`system_settings.folders_migration:runs`); Undo unlinks a batch. Never at
  boot or on a timer. The old columns are never written by the engine, and
  they are still read where the app read them until Woody agrees to stop: the
  list is `OLD_FOLDER_READERS` in `shared/folders.ts`, shown on the report.
- **Tests** (in `npm test`): `server/folders.test.ts`,
  `server/folders-postgres.test.ts` (the SQL in a throwaway schema; needs
  `FOLDERS_DATABASE_URL` naming a local database), `server/folders-filing.test.ts`,
  `server/folders-share.test.ts` and `server/folders-pages.test.ts` (their SQL
  parts need the same variable) and `server/folders-tools.test.ts`; guards (in `npm run qa:regression`):
  `qa/regression/folders-engine-guards.test.mjs` (the gateway, the staff gate,
  own tokens only, the one door, the client fence, bodies read after the staff
  check, the migration's admin gate), `folders-filing-guards`,
  `folders-share-guards`, `folders-pages-guards`, `folders-tools-guards` and
  `property-setup-guards`. Not run against Microsoft from a build machine:
  checked in a browser on a local copy with the folder routes answered by
  stand-ins.
- **Not built**: client uploads (decision 9); decisions 10 (narrowing the
  app's own Microsoft permissions) and 11 (the team folders on the server's
  disk), both waiting on Woody and BGP's Microsoft admin; a screen saying why
  a Net Effective, ITZA or Devaluation workbook, the Pathway model or the Why
  Buy deck was not filed; Legal & DD analyses carry no transaction yet, so
  Create Project links none; Pathway stage 1 still writes the run's old
  columns from SharePoint matches; `brand-profile.ts` still sends and saves
  `folder_teams` and `sharepoint_folder_url`; ChatBGP's knowledge-folder
  indexing, `import_wip_excel` by a share link and image import by SharePoint
  ids still call Graph themselves; mail, calendar and HR documents still use
  the older sign-in, which can fall back to a colleague's (decision 7 covers
  folders, all of which are on the person's own).

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

## ChatBGP runs on Claude Opus 5.5 (Woody, 2026-11-20)

Woody: "change chat bGP to actually use opus 5.5 rather than open ai". Do
not re-litigate. From 30 September 2026 the chat had run on OpenAI through
the provider switches on Railway (`CHATBGP_PROVIDER` / `AI_PROVIDER`): on
20 November 2026 live's `GET /api/chatbgp/status` read `openai` and
`gpt-6-astra`, Astra had cost about $762 in 30 days, and the chat error log
held OpenAI's "no credits remaining" (29 October, 9 November) and
"overloaded" refusals.

- **The rule**: `chatProvider()` in `server/utils/ai-provider.ts` never
  answers `openai`, whatever either switch says (`CHATBGP_PROVIDER=kimi` can
  still move the chat loop to Kimi). Every chat call then takes the Claude
  path in `server/chatbgp.ts` (`callClaude`, `callClaudeStreaming`, the
  image reader), and the router (`server/chatbgp-model-router.ts`) gives
  Opus 5.5: the chat on desktop and phone, chat with files, the Word,
  PowerPoint and Outlook add-ins, team chats, a joint agent's chat and
  WhatsApp. `/sonnet` and `/fable` still switch a thread; a `/sol`, `/luna`
  or `/astra` choice saved while on OpenAI reads as Opus 5.5.
- **The Excel pane runs on Fable 5.2** (Woody, the same day: "Fable still
  for excel 5.2"; it ran on Fable 5 from 2 October): the router's `FABLE`
  is `claude-fable-5-2`, so every `/fable` thread is too, and the Excel
  handler passes `fable` unless the message itself says `/opus` or
  `/sonnet`. Footer "Claude Fable 5.2 · BGP CRM"; priced on the cost board
  at $8 / $40 a million tokens (cache reads $0.20, writes $10). Fable 5.2
  takes the same request as Fable 5 (adaptive thinking, the array refusal
  fallback to Opus 4.8, the beta endpoint), and it enforces the
  history-editing check on every account: a thinking block sent back after
  an edit to the system prompt, the tools or an earlier message is a 400.
  The Excel loop keeps its system prompt and tools fixed and only appends
  (moving `cache_control` is not an edit), except the 100th step, which
  drops the tools: keep it that way.
- **What a request carries** (unchanged code, checked against Opus 5.5 on
  20 November 2026): adaptive thinking, effort `medium` from
  `chatQualitySettings` (Woody's speed decision of 28 August 2026; it is
  Opus 5.5's own default), `tool_choice` auto, no temperature, no thinking
  budget, no prefill, and the server-side refusal fallback (`betas:
  server-side-fallback-2026-07-01`, `fallbacks: "default"`, the beta
  endpoint); a 400 or 404 retries once on Opus 4.8 (`downgradeFromSonnet5`).
  Background callers of the chat engine that name no model get
  `CHATBGP_MODEL` (Sonnet 4.6).
- **The shared helpers are not moved**: `callClaude` in
  `server/utils/anthropic-client.ts` (most background features) still
  follows `AI_PROVIDER`, which on live sends them to OpenAI's Luna and
  Sol. Moving them is a Railway change (`AI_PROVIDER` empty) or a code
  change, and Woody's call.
- The chat's OpenAI branches stay in the code, unused; the tests that stub
  `chatProvider` to `openai` keep them working. Tests:
  `qa/regression/chatbgp-on-claude.test.mjs` (an openai switch leaves the
  chat, the status and the router on Opus 5.5; the Excel pane; the app
  map) and `server/ai-provider.test.ts`. Check live with
  `GET /api/chatbgp/status` (provider, default model, effort);
  `GET /api/admin/ai-keys` reports `provider` (the chat) and
  `helpersProvider` (the shared helpers), and probes each key with a tiny
  paid request.

## ChatBGP's app map (KEEP CURRENT)

`server/chatbgp-app-map.ts` is ChatBGP's description of the app itself —
every screen and how to reach it on desktop vs the phone shell. ChatBGP
gives users in-app directions from this file, so **whenever you change
navigation, add/remove a page, or move a control, update the relevant
lines there in the same commit**. Stale lines become confident wrong
answers to the team (that's how this file came to exist — ChatBGP sent
Woody to a Settings page the phone app can't reach, 2026-08-23).

## ChatBGP reads units and waiting-on from the same feeds as the pages (15 November 2026)

Woody: "do you need to fix some more stuff", after ChatBGP told a Landsec
login that Burger King was not at Bluewater and that nothing recorded what
its unit's letting was waiting on. It had read the older leasing schedule
board (`query_leasing_schedule`). Two read tools now answer such questions,
for BGP staff and client logins, in `server/chatbgp-unit-tools.ts`:

- `get_property_units` (a property, and a unit, tenant or brand to narrow
  it): the property page's unit feed, `loadPropertyUnits` /
  `loadPropertyUnitDetail` behind `propertyReadBlocked`, cut by
  `unitsForViewer` / `unitViewerFor`.
- `get_deal_waiting_on` (a Ref, a property with a search word, a search word,
  or who it waits on): the deal clock feed, `landsecDealsFeed` in
  `server/landsec-unit.ts` (the body of `GET /api/landsec/deals`, lifted out
  so the route and the tool call one function), and the open checklist items
  from `waitingOptionsForDeal`. For one or two deals it adds the unit as the
  property page shows it. A deal off the Landsec schemes has no clock: its
  stage comes from the unit feed and it says so.

**The rule: the same feeds as the pages.** The file has no query of its own
over the schedule, the tracker, the clock or the checklist, so a login is
told what its pages show it and a property outside its company or schemes is
simply not found. What goes to the model is built field by field (`unitLine`,
`unitDetailLines`, `waitingLine`): a new field reaches it only when named
there, and a fee, BGP's notes on a target or an email never is. Neither tool
is on `CLIENT_BLOCKED_TOOLS`; a joint agent is refused both by its own gate
(do not add them to `JOINT_AGENT_TOOLS`). Both prompts send "who is in unit
X", "when does X's lease end" and "what is this deal waiting on" to these
tools first. Tests: `server/chatbgp-unit-tools.test.ts` (in `npm test`) and
`qa/regression/chatbgp-unit-tools-guards.test.mjs`. The group chat's tool
list (`GROUP_CHAT_TOOLS` in `server/routes.ts`) does not have them.

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
pages and don't trigger paid refreshes or send anything (unless Woody asks
for that one thing, as he did on 17 November 2026 for the KYC test to Jack).

**Use the Railway address, not chatbgp.app** (found 17 November 2026). The
web session's proxy has a stored credential for chatbgp.app and writes it
into the `Authorization` header of every request there, over any token sent;
that stored credential is stale, so every call to chatbgp.app answers 401
(`/mcp` with no header answering "Invalid API key" rather than "Missing
Authorization header" is how this was proved). The same live app answers at
`https://bgp-wip-app-production-efac.up.railway.app`, where nothing is
injected and `BGP_QA_TOKEN` signs in as Woody. Use that address for API
calls and Playwright checks. Replacing or removing the chatbgp.app entry in
the environment's Network secrets would fix the main address; that is
Woody's, in the environment settings.

**If chatbgp.app answers 401 to a token that should work** (found
16 November 2026): look at the reply's headers. `X-Proxy-Error: upstream
auth failed: connection "chatbgp.app"` means the cloud environment holds a
stored credential for chatbgp.app (Network secrets / API credentials in the
environment's settings) and the session's proxy sends THAT in place of
whatever the request carries. When the stored one has expired or been
revoked, every token fails, a fresh one included. The fix is Woody's: put a
live token in that stored credential, or remove it. Until then the app's
Railway address (`bgp-wip-app-production-efac.up.railway.app`, the same app
and database) takes the request's own token.

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

## The rules specification build (Jack, 2026-11-27)

Jack sent "BGP AML App: Rules Specification" as guidance, agreed a list of 14
amendments and five decisions, and said of K1: "I dont want to reverse the
rule I dont want agent being able to choose 'within reason'". Do not
re-litigate. Tests: `server/rules-spec.test.ts`, cases in
`server/kyc-red-flags.test.ts`, `server/aml-policy.test.ts`,
`server/joint-agent-checks.test.ts` (all in `npm test`).

- **Risk factors are assessed by an officer, never enhanced automatically
  and never chosen by an agent.** `ASSESSED_KINDS` in
  `shared/kyc-red-flags.ts` (a limited partnership, a FATF increased
  monitoring or other listed country, a higher-risk sector, an offshore
  owner, an overseas entity not found, owners the client disputes, a name on
  the US or EU sanctions list only). `factorToAssess` is true until the
  Nominated Officer or a Deputy presses **High risk** (the flag is confirmed
  and counts: enhanced) or **Standard, with reason** (set aside with a
  comment), through the red flags' own confirm and set-aside routes
  (`decider`). Until then the party stays at its level, and it is not signed
  off by anyone (`toAssess` on `SignOffFacts`, `riskFactorsDenial`: "Risk
  factor to assess first: …"); a sanctions-only letting is not held. Still
  enhanced with no assessment: a call for action country (evidence
  `MANDATORY_EVIDENCE`), a PEP, a trust (`policy_trust`) and any red flag
  that is not a factor. Citizenship by investment is only weighed
  (`policyFactorsToWeigh`).
- **Only the UK Sanctions List is a sanctions match.** A name found on the US
  or EU list alone is the factor `foreign_sanctions`
  (`sanctionsLineIsUk`, `precheckSanctionsMatch` counts UK lines): the UK list
  is the one that binds UK persons (OFSI), the others are a real risk signal
  an officer assesses.
- **A declined identity check** is a red flag only when Veriff's reason reads
  as fraud (`idDeclineIsSuspect`); any other is tried again.
- **Owners the client disputes** (`owners_differ`) is an assessed factor: the
  officer judges whether the difference is material; only a material one is
  reported to Companies House.
- **A joint agent's CDD summary** saying identity was verified no longer
  counts for identity (`shared/joint-agent-checks.ts`); it still counts for
  the address. BGP does not rely on another firm.
- **SIPPs, SSASs and pension schemes** read as trusts by name
  (`pensionSchemeMarkInName`, in `trustMarkInName`): a suggestion, as any
  trust's.
- **No invoice until the checks are complete** (Jack: "Our internal blocks
  need to be at invoice stage"). `shared/aml-invoice.ts`,
  `server/aml-invoice-block.ts` (`amlInvoiceDenial`): while the officers'
  switch is on (`system_settings.aml_invoice_block`, **off until an officer
  switches it on** on the Policy pill, `PUT /api/aml-policy/invoice-block`),
  `POST /api/xero/invoices` and the invoice approval answer 409
  `AML_NOT_COMPLETE` naming each party not cleared (the gate's own reading,
  `checkCounterpartyAml`; Not required counts as done; on advisory work only
  BGP's client). A transaction whose officer set "AML check: YES" passes.
  Moves to Exchanged or Completed are still never blocked.
- **Limited partnerships** (`isLimitedPartnership` in
  `shared/kyc-prechecks.ts`: Companies House types limited-partnership,
  scottish-limited-partnership, scottish-partnership). People to check reads
  `partnership`; the party owes "add its general partner under Also signs, or
  record who holds more than 25% or controls it" until a signer is added or a
  person is recorded against the partnership. The company step shows
  **Partners** (the Owners abroad section, `server/kyc-abroad.ts`: the
  partnership itself is a block there, so Record a person behind it, Add a
  note and Add a structure chart work for it). The `policy_pooled` factor is
  the officer's to assess (an FCA-authorised manager is the usual reason for
  standard).
- **The register excerpt** (`server/kyc-register-excerpt.ts`): each run of
  BGP's checks that read Companies House files a PDF on the party's KYC
  record (doc type `ch_register_excerpt`, once a London day per company): the
  company, its people with significant control (or an overseas entity's
  registered beneficial owners), statements, officers, the chain and when it
  was read. It goes into the AML file with the other documents.
- **Principal place of business** (MLR 2017 reg 28(3)(a)): the client checks
  page asks the person acting for a company "Is the company's main place of
  business the same as its registered office?" (`KYC_PLACE_QUESTION`,
  `POST /api/kyc-upload/:token/place-of-business`, kept as
  `request.placeOfBusiness`, shown on the request's row; a KYC history line).
  Never for a person's own link, a trust's documents, a joint agent or a
  public body, and it never holds a request open or is chased.
- **Policy wording**: `docs/aml-policy-issue-10-proposed-wording.md` lists
  the changes for Issue 10 of the policy and Issue 5 of the risk assessment.
  They are NOT published: Issue 9 and risk assessment Issue 4 stay the source
  until Jack says publish.
- Not built: a client file's Partners section in the client KYC window; the
  partnership agreement as its own client-check document; the place of
  business on the AML file's report; the invoice hold on an invoice edited
  directly in Xero. Not checked in a browser.

## A party's documents sent on to another agent (Jack, 2026-11-27)

Jack: "How can I make it so that I can send it on to the vendors agent for
their checks? We use Veriff but a lot of people use old School PDF uploads
and normally I send on email as attachments", then "Yes" to the pack as
proposed. HMRC asks the agent who did not identify the buyer to request the
CDD documentation from the other agent (AMLG2200 s21): the documents, not a
letter (a letter alone is reliance, which BGP does not agree). Rules:
`shared/aml-share.ts`; server: `server/aml-share.ts`; dialog:
`client/src/components/aml-share-button.tsx`. Tests:
`server/aml-share.test.ts` (in `npm test`).

- **Send to their agent**, beside the AML file button in a party's Sign-off
  step. The Nominated Officer and the Deputies only (`decider`): `GET` /
  `POST /api/deals/:id/parties/:role/share-pack`. The recipient is one of the
  agents the transaction records (a press fills the boxes) or typed.
- **What may go**: documents on the party's KYC record, read again on the
  server; ticked to start with are identity, proof of address and the
  register (`shareTicked`). Never offered (`SHARE_NEVER_TYPES`): the AML
  file, screening reports, web copies, credit reports, KYC4U's reports,
  reliance letters, heads of terms, terms of engagement, source of funds.
  A Veriff check goes as its PDF page, once.
- **The cover sheet** (`shareCoverLines`, the pack's first file) says how BGP
  holds each document (`shareStatement`: verified electronically by Veriff;
  from Companies House; original seen by a named BGP agent; certified copy,
  with the certifier; else "Copy supplied to BGP and checked by BGP. BGP has
  not seen the original"), that BGP is not agreeing reliance, and the
  regulation 41 data line. Never say more than BGP can.
- **Sent** from the KYC mailbox (`sendKycEmail` with `files`), the
  transaction's agents, the sender and the officers copied: the files
  attached when the pack is 2.5 MB or less (`SHARE_ATTACH_MAX_BYTES`:
  Microsoft's send limit is about 4 MB), and always a download link
  (`GET /api/kyc-upload/pack/:token`, the token the only key, 14 days,
  downloads counted). The ZIP is kept in the file store (`kyc-share/`).
- **Recorded**: `kyc_share_packs` (boot migration), a KYC history line
  (`kyc_documents_shared`) and a transaction history line
  (`aml_documents_shared`, hidden from client logins with the other AML
  lines). Five-year deletion and company merges cover the table.
- Not built: Veriff's own document and selfie images (the app holds the
  result, not the pictures); a pack from a client file with no transaction;
  larger attachments through Microsoft's upload sessions. Not run against
  Microsoft and not checked in a browser.

## Complete on a transaction's AML (Jack, 2026-11-26)

Jack: "Once checks are all complete on this page, id like a big button at the
bottom that says Complete. Its grey and unable to click if check not complete
but turns orange and clickable if done". `AmlCompleteButton` at the foot of
the transaction's AML box (`deal-aml-status.tsx`, BGP staff, not the view-only
copy): greyed while `allApproved` is false, with who is still to clear under
it; pressed, `POST /api/deals/:id/aml-complete` (BGP staff as themselves)
reads the parties again by the gate's rule (`checkCounterpartyAml`: cleared,
or Not required) and writes a `deal_audit_log` line, field `aml_complete`
(hidden from client logins with the other AML lines); the button then reads
"Completed by <name> · <date>" (`GET` the same address). A party that stops
being cleared greys it again. It records; it decides nothing and gates
nothing. Guard: `qa/regression/aml-complete-button.test.mjs`. Not checked in
a browser.

## Heads of terms before HOTs or Solicitors on the Letting Tracker (Jack, 2026-11-26)

Jack: "On the letting tracker, like the investment rules when people move
deal status to 'solicitors' or 'HOTs' a box needs to pop up saying adding
HOTs", then "I want to make it a block, people cant bypass not adding HOTs.
By adding the Heads of Terms the app should auto add the Landlord and Tenant
(for leasing it should say Landlord and Tenant not vendor purchaser)". Box:
`client/src/components/tracker-hots-gate.tsx`. Guard:
`qa/regression/tracker-hots-gate.test.mjs`.

- **The box** (`TrackerHotsGate`, BGP staff on the staff Letting Tracker): a
  move to HOTs or Solicitors in the status menu (`inlineUpdate` in
  `available-units.tsx`) opens **Add the heads of terms**: drop or choose a
  PDF or Word file, or Cancel, which leaves the status as it was. Nothing
  else. A unit whose heads of terms are already on it (the final agreed
  file, or issued in the app: `GET /api/unit-hots/:unitId`) goes straight on.
- **What adding does**: the unit's transaction is made if it has none
  (`ensure-deal`); the file is kept as the unit's final agreed heads of terms
  (`POST /api/unit-hots/:unitId/final`); the transaction's own reader reads
  it (`POST /api/deals/:id/heads-of-terms/read`); and a landlord or tenant
  the transaction lacks is set (`addParties`): the one CRM record of that
  name, else for the landlord the property's landlord, else a new CRM record
  (type Landlord or Tenant). Two CRM records of the name are left for a
  person. A reading that fails leaves the file saved and says so.
- **Then**: at HOTs the status moves and the AML window opens
  (`DealAmlDialog`, reason `hots`: "At heads of terms: start the AML
  checks"); at Solicitors the one transaction form opens as before (Woody's
  form of 17 November is unchanged). A letting's window reads Landlord and
  Tenant (`partySlotDefs`: Vendor and Purchaser only on a Sale or Purchase).
- **The server refuses the move too** (`PATCH /api/available-units/:id`, 409
  `HOTS_REQUIRED`): BGP staff moving a unit to HOTs or Solicitors with no
  final file and no issued heads of terms. That covers the bulk Change
  Status. Client logins and joint agents are not held by it.
- **Every transaction, the same day** (Jack: "Lets add this block to these as
  well, as AML checks should start earlier in the deal but absolutely minimum
  once the deal is at HOTs stage"; button "Add HOTs or Proforma"). One rule,
  `hotsGateApplies` in `shared/deal-hots-gate.ts`: a move to HOTs or
  Solicitors from an earlier stage (never a move back from Solicitors or
  later; never a Rent Review, Dilapidations or Service Charge).
  `server/deal-hots-gate.ts` (`hotsRequiredDenial`, `dealHotsOnFile`): heads
  of terms are on a transaction when its tracker unit holds them, or a file
  was added to the transaction itself (`deal_hots_files`, a boot table, for a
  sale, a purchase or a tenant-side letting; `POST
  /api/deals/:id/heads-of-terms/file`, `GET …/on-file`, BGP staff as
  themselves). The transaction save (`PUT /api/crm/deals/:id`: the
  Transactions table, the Edit form, ChatBGP's update_deal, the Solicitors
  form) and the bulk status change refuse the move for BGP staff with 409
  `HOTS_REQUIRED`. Client logins are not held. Screens: `DealHotsGate` in
  `tracker-hots-gate.tsx` (one box, `HotsGateBox`, shared with the tracker's)
  on the Transactions table's status cell (then the HOTs checklist reading
  the file just added, or at Solicitors the save; the AML window opens after
  either) and on the Edit form's Save (`setParties={false}`: the form saves
  its own parties). A sale or purchase sets Vendor and Purchaser.
  Guard: `qa/regression/deal-hots-gate.test.mjs`.
- **New Transaction, ChatBGP and the Investment Tracker too** (Jack,
  27 November 2026: "yep block"). `POST /api/crm/deals` from BGP staff at
  HOTs or Solicitors answers 409 `HOTS_REQUIRED` (imports call `createDeal`
  directly and are not held). New Transaction needs the file read by its Add
  heads of terms (`hotsReadFile`); it makes the transaction at Negotiating,
  files the heads of terms on it (`/api/deals/:id/heads-of-terms/file`) and
  then moves it to the stage chosen. The Investment Tracker
  (`updateTrackerAsset`) refuses the move, and its screen opens
  `DealHotsGate` first (`saveUpdate`); its bulk status change shows the
  refusal.
- **Not held**: joint agents' and clients' trackers. The AML file does not
  yet carry a file added to the transaction itself. Not checked in a browser.
- **Identity check results in the AML file** (Jack, the same day): a Veriff
  result is written as a PDF (`veriffResultLines`, `veriffResultPdf` in
  `server/aml-file.ts`), not JSON, and one check filed twice is included
  once.

## Simplified due diligence said out loud, and UK public bodies (Layla, 2026-11-23)

Layla, on transaction #3965 (The Crown Estate, BGP's client and the
landlord): "we need it to state that its a simplified due diligance check",
"We need the app to highlight when a company only needs a simplified (SDD)
check so that employees dont go down a rabbit hole. we will need the
reasoning of the SDD saved against this deal", "is there a way of the app
flagging and drafting this wording for SDD checks?", and of the party box
asking for a company at Companies House: "this is too intense for the crown
estate". Rules and the draft: `shared/aml-sdd.ts`; box:
`client/src/components/aml-sdd.tsx`. Tests: `server/aml-sdd.test.ts` (in
`npm test`).

- **A UK public body is recorded on the party** (`crm_companies.aml_subject_type
  = 'public_body'`, `PUT /api/deals/:id/parties/:role/public-body
  { publicBody }`, BGP staff as themselves, in `server/deal-parties.ts`),
  as a trust or a private individual is. A name that reads like one
  (`publicBodyMarkInName`: The Crown Estate by its exact name,
  `knownPublicBody`; a council, a government department, TfL; never a name
  with Limited, LLP, LP or Partnership in it) is a suggestion a person
  presses (`PublicBodyLine` in the party box), never applied by itself: a
  joint venture or company the body has an interest in is not the body and
  needs standard checks. A record with a Companies House number, or one
  already a trust or an individual, is refused. The record is shared, so
  every transaction with it follows.
- **Recorded, it signs itself** (`SIGNS_ITSELF_SUBJECTS`: every list that
  read `('individual', 'trust')` now takes `public_body`): no company that
  signs, no "Set the company that signs" gap. BGP's checks before asking
  look nothing up by its name (no Companies House, overseas entities, GLEIF
  or charity look-up: `isPublicBody` in `runPrecheck`) and screen it by
  name. People to check reads `public_body`: nobody owes an identity check
  or a proof of address (`publicBody` on `partyPeople`). The client checks
  ask only for authority to act (`defaultKycDocs`, `precheckAsks` with
  `publicBody`), with the identity check unticked.
- **The level carries its case** (`simplifiedCase` in `shared/aml-policy.ts`,
  `sdd` on `PartyDueDiligence`): a public body (recorded: confirmed; by its
  name alone: to confirm), a listed company, a market abroad, an FCA fund.
  Each has its basis, what the file should hold and when it does not carry
  across. A red flag or factor still makes the party enhanced.
- **The box** (`SddBox`, under the party's Next line on Parties & AML, BGP
  staff): green, "Simplified due diligence (SDD)", the basis, the file
  list, the caveat, and **Draft the SDD note**: `sddNoteDraft` writes the
  note from the rules (who, the statutory basis, why SDD, no beneficial
  owner, authority, the joint venture check), with [square brackets] for
  what a person fills in; it cannot be saved with one left (`sddNoteProblem`).
  The chip reads **Simplified (SDD)**. No AI.
- **Saved on the transaction**: `POST /api/deals/:id/parties/:role/sdd-note`
  (an agent on the transaction, the Nominated Officer or a Deputy; only
  while the party reads simplified) writes a `deal_audit_log` line (field
  `aml_sdd_note`, the role in `old_value`, the note in `new_value`) and a
  KYC history line (`sdd_note`); `GET /api/deals/:id/sdd-notes` (BGP staff)
  reads the latest per party. The AML file's history and the AML page's
  trail list it. A simplified party's sign-off line carries the basis, and
  the saved note stands as its note.
- Not built: the SDD note as its own page of the AML file; ChatBGP drafting
  it; other public bodies' statutes (only The Crown Estate's is known).
  Checked in a browser on a local copy on 23 November 2026 (a landlord
  named The Crown Estate: the suggestion, recording it, the draft, saving
  it). Not run on live: #3965's landlord still has to be recorded as a
  public body by a person.
- **Not a red flag for being the state** (Woody, 25 November 2026, on Wirral
  Metropolitan Borough Council for Merseyside Pension Fund, which showed
  Enhanced): for a party recorded as a UK public body, the web search's "Possibly
  owned or controlled by the state" finding on the body itself is not a red flag
  (`precheckRedFlags(..., { publicBody })`, passed by `partyRedFlags` from
  `aml_subject_type`), so it stays on simplified due diligence. Adverse media
  about it, and a person's public role, still count. Read on stored checks, so
  no re-run is needed. Test in `server/kyc-prechecks.test.ts`. The screening
  line does the same (`precheckCardLines(result, { publicBody })`, from
  `dealPrechecks` and the client KYC window): that finding is not one to
  review, and the line says "Owned by the state, as a UK public body is: not a
  finding".
- **It signs for itself, everywhere** (Woody, 25 November 2026: Send client
  checks to Wirral Council at Tunsgate Quarter was refused "Set the company
  that owns the property on the transaction first"). `createClientCheck`
  excuses a recorded public body as it does a trust; the party lines read
  "Signs as: Itself · a UK public body, no company needed" with no Choose the
  company and no billing line (as the party box); a recorded trust reads "None
  needed: checked as a trust"; the AML file prints "Signs as" and does not ask
  for a company that signs. Guard: `qa/regression/deal-parties-guards.test.mjs`.
- **The City of London Corporation, and a wrong Companies House number**
  (Woody, 25 November 2026, on #4600: "its a public body this and cant be
  found on companies house but its suggesting a random company name and not
  picking up the actual mayor"). The landlord's record, "The Mayor and
  Commonalty and Citizens of the City of London" (type Billing, so not in the
  CRM search), held ALAXIA LIMITED's number (07932290, a restaurant company
  dissolved in 2021), written by the old in-app screening on 30 September;
  the startup copy of `uk_entity_name` (`server/index.ts`) then filed ALAXIA
  under it as its main company, and the hint and the record route both
  stopped at any number on the record. Now (`shared/aml-sdd.ts`): the City is
  a known body ("City of London", "City of London Corporation", "Corporation
  of London" and its legal name), councils' corporate names read as public
  bodies ("The Mayor and Burgesses of ...", "The Lord Mayor and Citizens of
  ...", "The Mayor, Aldermen and Burgesses of ...", "Secretary of State"),
  and "... as Trustees of ..." never does (the trust is the party).
  `wrongCompaniesHouseLink` reads a number on a public body's record whose
  registered name is not the body's own as a mistake: the party box and the
  AML box show the hint with a line naming it, neither it nor a company filed
  from it (`filedFromWrongLink`) is offered or listed, and **Yes, record as a
  public body** takes it off the record (number, Companies House data and
  stored name, guarded on the number read, in one transaction) and takes the
  company filed from it off too, unless a transaction, guarantee, lease,
  bill, sign-off or request sent ties it (then it stays, no longer the main
  company); checks already run on it stay on the record, and an open client
  file on it is closed. `performAutoKyc` and the nightly refresh never look a
  recorded public body up at Companies House. On live the same mistake sits
  on London Borough of Hackney (Ideal Technology Services Limited) and
  Westminster City Council (CityWest Homes Limited): each is put right by
  recording it as a public body on a transaction. Tests:
  `server/aml-sdd.test.ts`, `qa/regression/deal-parties-guards.test.mjs`.

## The sign-off note for a listed company (Woody, 2026-11-24)

Woody asked whether a plc needs someone to sign it off or is automatic
(answer: a BGP person always presses Sign off; the law makes the risk
decision BGP's, with its reasons kept), then: "Yes do the sign off note".
Do not re-litigate. Rules: `shared/sign-off-note.ts` (`listedSignOffNote`);
server: `fileNoteFor` in `server/deal-party-aml.ts`. Tests:
`server/sign-off-note.test.ts` (in `npm test`),
`qa/regression/sign-off-note-guards.test.mjs`.

- **When**: a company listed on a UK or EU regulated market (`listingSettled`),
  or owned through one company at each level by one (`viaParent`), on the full
  checks, with no red flag on the party or the transaction and every flag
  record read. A market abroad (the officers weigh it), a red flag (enhanced:
  the officers' own note), a sanctions-only letting (no note needed), a person,
  a trust or a public body get none.
- **What it says**, from BGP's latest checks and the people to check: the
  listing and PSC exemption date, simplified (listed itself) or standard
  (through a listed parent) due diligence, the ownership chain read at
  Companies House, the status, the latest accounts, which screens ran with no
  red flags (and any that did not run, never read as clear), the person
  instructing us (their identity check, and their authority: a director at
  Companies House, sent with the client checks, or not yet), whether the
  client checks are finished, and what is still to come.
- **Where**: `fileNote` on each party's sign-off view (`signOffView`, so the
  transaction's AML status and the client KYC window both carry it), shown as
  **Written from the file** in the transaction's Sign off box
  (`aml-sign-off-file-note-<role>`, from the Sign-off step and the Next line)
  and the client KYC window (`client-kyc-sign-off-file-note`).
- **It never stands in for the person**: the server writes it again at
  sign-off, never from the request, and keeps it in the approval's history
  line ("Written from the file: ...") and its evidence (`bgpSignOff.fileNote`).
  The sign-off rule is checked against the typed note only, so while the
  client checks are unfinished the person signing still says why (the box
  asks for it); once nothing is outstanding the sign-off needs no typing.
- Checked in a browser on a local copy; not run on live.
