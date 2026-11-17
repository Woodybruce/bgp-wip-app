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
  page from More → Back to the current page. To run it locally: `bash
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
phone cards, the deal page and the Letting Tracker join that feed by deal id
(`docs/landsec-menu-plan-2026-11-12.md`, part 4); the unit page and the older
Lettings page use the same components. Stuck is Negotiating, HOTs or
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
  available units card. The deal page (`jointAgent` in `deal-detail.tsx`)
  leaves out Image Studio, Edit, the Brand tab and profiles, files,
  comments and history. Deals has no New Deal, and an inline change says
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
    `SCORE_VERSION` is 5. A client login is sent Expansion only
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
      night): PlanIt is searched by brand name; a record counts only when
      the description names the brand (not as a former, existing or
      neighbouring occupier), is about works a new occupier applies for
      (shopfront, signage, change of use, fit-out, extraction) and is under
      12 months old. A name too common to search (Next, Boots, any single
      word of four letters or fewer but Pret and Itsu) is skipped and says
      so. Job adverts come from Adzuna and are OFF until `ADZUNA_APP_ID` and
      `ADZUNA_APP_KEY` are set; that half has never been run against
      Adzuna. Licensing registers are council by council and are not read.
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
    and only BGP staff can ask for a fresh count or check.
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
    Hunter pick, the analysis without its advice and two saved AI keys.
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
  action, a live deal, a live or to-confirm requirement, or a Hunter pick
  (`brandWhy`). Every row carries the BGP owner (`bgp_contact_user_ids`,
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
- A requirement fits a marketing unit on size AND use: the unit's use class
  is one the requirement lists, or lines up by `USE_HINTS`; a side with no
  use stated fits on size alone.
- "Requirements whose use fits a unit" (under More) lists only brands the
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
- **Still parked for Woody:** the one-live-letting index (schema change)
  and wiring `actingForFromType` (Lease Disposal / Sub-Letting → tenant
  side) — both wait on his review of the integrity report's lists.

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
investment) is shown to admins only (Woody, 2026-11-14). People's tenants
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

## Offer to Solicitors on the Letting Tracker (Woody, 2026-11-12)

The older **Promote to Solicitors** box on the staff tracker (picking
Solicitors in the status column, `POST /api/available-units/:id/create-deal`)
is BGP staff only since 2026-11-13: no client screen offers it and a client
login is refused. It refuses a move to Solicitors when a party the deal is
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

**The Promote box fills itself (Woody, 2026-11-17).** His words: "use the AI
notes to fill in the form function we have for other forms", "allow for add
HOTs which should also then file and populate", and "if cant find a billing
entity for tenant then should be able to create one and search companies
house? Its saying not on xero but is connected to Xero just new billing
entity for the brand". The route, its staff-only rule, the AML gate and the
sign-off handling are unchanged. Tests:
`qa/regression/promote-to-solicitors.test.mjs`.

- **Notes**: the box's Notes is `FillFromNotes` read as an `offer` (the
  rules in "Notes into forms" below), with `newWordsOnly`: only words typed
  after the ones the box opened with (the deal's earlier notes or the
  "Property — Unit" line) are read. `applyPromoteNote` in
  `available-units.tsx` maps a reading: rent to Headline Rent, term to Lease
  Length, rent free to Rent Free; the tenant brand only when it is a brand on
  the unit's offers, viewings or interest (otherwise a "Brand read as" line);
  anything else, an offer's date included, is a labelled line in the Notes.
  **The target completion date is never filled from a note**: an offer's date
  is not it, and the reader refuses a future date and a completion date by
  design. Total area is not read (the contract has no area).
- **Add HOTs**: files the document through the HOTs flow's own upload
  (`POST /api/unit-hots/:unitId/final`: `hots_final`, never public, moves no
  status), then reads it through the note reader's new source
  `{ type: "hots_final" }` (`shared/letting-note.ts`,
  `server/unit-note-reader.ts`): agentControl only, the server takes the text
  from the unit's own final file with `readDocumentForAI`
  (`server/document-reader.ts`) and cuts it to `NOTE_MAX`, and the read-back
  says so. A document is prose: nothing fills but a brand on the unit, and
  each term is a Use line with its words. A final HOTs already on the unit
  has **Read them**.
- **Create billing entity** (`server/billing-entity.ts`,
  `POST /api/billing-entities { brandId, companyNumber }`, BGP staff signed
  in as themselves; `client/src/components/billing-entity-create.tsx`). The
  Xero picker (`xero-contact-picker.tsx`) says "not in Xero yet" when the
  firm's link answered with contacts and the search found none, and keeps the
  reconnect line for a real connection problem; with `createFor` (only the
  Promote box's tenant picker passes it) it offers Create billing entity. The
  company is read from Companies House on the server (never a name or address
  from the request; a closed company is refused), saved under the brand with
  `insertTradingEntity` (never a brand; a company of that name already there
  is reused unless its number differs) and logged (batch `billing-entity`),
  then made a contact in the firm's Xero through `withSystemXero` after a
  search by name (the invoice routes' POST /Contacts), and selected: the deal
  stores its ContactID as the tenant's billing entity. `rememberXeroContact`
  puts it on the picker's cached list. A Xero refusal leaves the company
  saved and says why. It has not been run against Xero or Companies House
  from a build machine.

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
  solicitors), BGP's 37 clauses otherwise. These mark blanks with `[ ]` or `XXXX`, not `{TOKENS}`:
  `fillSchemeHots` fills only what it can place with certainty, never deletes
  an OR alternative, and names what it could not place in the HOTs history.
  A new scheme form is one more entry in `SCHEME_HOTS_STANDARDS` plus a test.
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
- **Landsec emails come from `landsec@chatbgp.app`** (Woody, 2026-11-12;
  `LANDSEC_MAILBOX` overrides): `sendWorkspaceEmail` in
  `server/shared-mailbox.ts` sends checklist and recommendation emails about
  a Landsec property as that mailbox, and falls back to the shared mailbox,
  with a log line, if Microsoft will not send as it. Use it for any new
  email about a letting; do not call the shared mailbox sender directly.
- **Landsec team sheet** (`shared/landsec-personnel.ts`, from BGP's
  personnel model of 2 February 2026): only SUGGESTS people on a brief at a
  Landsec scheme. Names are confirmed by the person adding them and matched
  to a real login where there is one. It will go stale: update it from the
  team's current sheet, never treat it as who has access.
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
   is a SUGGESTION. Only a named BGP person makes a requirement live, by
   confirming it. A staff member telling ChatBGP to log one counts as that
   person's confirmation. A press story a person confirms is labelled
   press-reported until someone records speaking to the brand.
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
  (`isClientVisibleBrand`); never provenance, an owner or a confirmation. A
  new row is stamped by `clientCreatedStamp`: `origin = 'client'`, the
  client company's name in `sources` (Source "Client" on BGP's screens), no
  confirmation and no owner, so it reads To confirm for BGP until a named
  BGP person confirms it ("client requirement added 17 Nov, not confirmed").
  A client's edit is never a confirmation. Imports never label or fold into
  a client's row (`importMayLabel`, `listingTarget`). A login not tied to a
  client company (`NO_ACCESS_SCOPE`) reads and writes nothing. ChatBGP's
  `create_requirement` and `update_requirement` stay BGP staff only.
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

- **The states**: LIVE = a named BGP person confirmed it within 90 days
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
- **ChatBGP** (`server/chatbgp-requirements.ts`): `create_requirement` and
  `update_requirement` are leasing only and BGP staff only (both are in
  `CLIENT_BLOCKED_TOOLS`, and the handler needs a named staff member who is
  not viewing as a client). Both are also refused on a server-originated
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
- **The page** (`client/src/pages/requirements.tsx`, Leasing view): one pill
  row of lists in place of the Active / Past / Archived tables. Every row is
  on exactly one list, from `requirementListKey` in the live rule: To confirm
  (the suggestions tray, then drafts), Live, Market listings (unconfirmed imports), Older (BGP's
  own background rows; shown when there are some), Closed. Going stale is the
  part of Live within 14 days of lapsing (`requirementGoingStale`); In the
  news is the Expanding list; Everyone / Mine filters on the BGP owner. The
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
  mounted only when `canUseCentre`): `SuggestionTray` sits at the top of To
  confirm and is the ONE place suggestions are answered (do not add a second
  list elsewhere). Its answers are the intake routes: confirm (the detected
  fields are checked in a form first; one requirement on file = one tap),
  attach, brand, dismiss, satisfied, not-live. The To confirm pill counts
  requirement rows plus suggestions; the search narrows the tray and the
  other filters hide it. `RequirementEvidenceDrawer` reads
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
  - **The single fit rule.** The six matchers still disagree (Fits column,
    Match dialog, Brand Gap, AI matching, ChatBGP, target engine); he has to
    choose the rule (size alone, or size plus use or place).
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
  - Left for Woody: the single fit rule; what a full Landsec login reads on
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
them VIP" should put a company on one: "yes chat should be able to"). There
is no VIP field in the app: in the CRM a company is turned on by a strategy.
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
- **KYC4U is a pill on My BGP for admins** (Woody, same day: "KYC4U put in
  the People and HR page"): `Kyc4uPanel` in the people page's tabs
  (`?section=kyc4u` opens it), off the More group and the phone list.
  `/kyc-clouseau` and its old aliases still open the KYC4U page, so the
  bookmark install and old links work.
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
