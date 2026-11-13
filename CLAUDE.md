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
  what Back does needs their checks changed with it.

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
A joint agent has no deal page and no property record page (an asset
manager has both, as a full Landsec login), so the shared pieces never hand
a joint agent a link to either: the deal a deal
depends on is plain text (`linkDeals`, from `useLandsecRestricted` /
`isRestrictedLandsecRole` in the same file), a unit's deal is a link only
where the page passes `dealHref`, and the stage pills are plain counts where
`hrefFor` gives null (`LandsecStagePills`). A new screen that draws these
pieces passes the role the same way.

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
greyed with a question mark ("17d?") and still counts as stuck: never hide a
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
`useIsLandsecView()` (the brand), never `activeTeam === "Landsec"`. Joint
agents still use the Landsec home and the scheme page.

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
- `/` and `/home` go to Properties (`Home` in `App.tsx`; on a phone, real
  Landsec client logins only). `/landsec/deals` goes to `/deals`, and
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

**The only difference between the Landsec roles** (Woody, 2026-11-13: "its
just joint agents don't see our brand pages thats it"): a joint agent does
not see BGP's brand pages. A Landsec login with no role, a leasing manager
and an asset manager are the same for access. BGP's own records stay private
to BGP whatever the role: its brand contacts, its notes on target brands, its
email history, its fee and its internal split.

**A joint agent, for now**, stays on its instructed schemes and on its own
pages. Its first two menu entries read Properties (`/`, the scheme-limited
Landsec home) and Deals (`/landsec/deals`, the scheme-limited deal clock),
then Tracker, Viewings, Tasks and Brand CRM, as built on 12 November (the
"menu Portfolio / Lettings / Tracker / Viewings / Tasks" wording further down
this file now reads Properties / Deals / Tracker / Viewings / Tasks). It has
no Ask and is not redirected (`/deals` is not on its route list, so a
redirect would loop). Its route jail, the gateway
(`restrictedLandsecApiRule`) and its pages were not touched by the asset
manager change. **Chat for joint agents is built** (13 November 2026: the
Chat rail, the Chat tab and `/landsec/chat`; the section "Chat for a joint
agent" below has the rules). Moving joint agents onto the real
Properties, Deals and Letting Tracker pages (plan steps 5 to 8 of
`docs/landsec-menu-plan-2026-11-12.md`) is not built.

Decided (do not re-litigate): leasing managers and asset managers see all
schemes and are the same for access; joint agents see their own schemes
only; joint agents never see BGP's brand pages, brand contacts, email
history or fees; a joint agent gets a separate front door of workspace
routes rather than scheme checks retrofitted into the existing client view.
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
`/landsec/viewings` and `/landsec/tasks` (menu Portfolio / Lettings /
Tracker / Viewings / Tasks); the staff tracker page is not opened to them.

- **Stays closed to a joint agent**: brand pages and BGP's CRM (a brand's id
  and name in a picker is the limit); BGP's brand contacts; BGP's notes on
  target brands and the generated Targeting Brief document; BGP's email
  history, including a diary invitation's subject, body and guest list;
  BGP's fee and internal split, the BGP deal page, the staff and client
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
  it is its own small chat, never the staff chat panel. The lock is on the
  server, in four files:
  `shared/chat-joint-agent.ts` (what a tag may show; the two kinds of
  conversation), `server/chat-joint-agent.ts` (who it may talk to, who may
  be put in a conversation with it, what it is sent), the guard in
  `storage.addChatThreadMember`, and `server/chatbgp-joint-agent.ts` (its
  ChatBGP). Every read of the role in them fails closed.
  - **Messaging.** A joint agent holds two kinds of conversation and no
    other (`jointAgentThreadKind`): a conversation between people, with no
    ChatBGP in it and **never linked to a record** (no property, deal, brand
    or channel), and its own ChatBGP chat with nobody else in it. Anything
    else is not listed, read as 404, and cannot be posted to. It starts a
    conversation only with the people `chatPeopleFor` gives
    (`GET /api/landsec/chat/people`, names only): the BGP people on the
    Landsec account and the Landsec logins at its schemes. Never another
    joint agent, another landlord's login or the staff directory. Members
    after a conversation is made, renaming, linking, search, the media
    drawer and group pictures stay closed at the gateway.
  - **Who may put it in a conversation** is one rule for every caller,
    `chatMemberDenial`, run inside `storage.addChatThreadMember` (the one
    door for a member row; do not write `chat_thread_members` beside it for
    a login you were handed) and before a conversation is made
    (`chatCreateDenial`, 409). With a joint agent in it a conversation holds
    only BGP staff and the Landsec people at that joint agent's schemes;
    two joint agents share one only when they are the same firm; and **a
    joint agent joins only before the first message** (the test is part of
    the insert). BGP staff who want a joint agent in a property's
    conversation start a plain one.
  - **ChatBGP never answers in a conversation with a joint agent in it**,
    whoever asks: adding it is refused (409), the `@chatbgp` auto-join is
    skipped, and `triggerAiGroupResponse` returns at its first line. The
    automatic "Task done" line (`PATCH /api/tasks/:id`) is not written into
    one either (`NO_JOINT_AGENT_THREAD_SQL`). A new automatic line or reader
    over chat threads must skip them the same way.
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
    never reaches the model, so never a brand contact's name, a fee, BGP's
    notes, an email or a company id). Every other tool name is refused in
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
  - **Not built**: ChatBGP in a conversation with a joint agent in it;
    any ChatBGP write tool, file, web search or model choice for a joint
    agent; chat search, renaming, adding or removing people after a
    conversation is made, group pictures, the media drawer; live message,
    typing and seen events (the screen polls); a joint agent messaging
    another joint agent or a BGP login off the Landsec account. The unread
    count can include a conversation since hidden from it (a count only).
    ChatBGP has not been asked a real question as a joint agent against
    Anthropic: the lock is proved at the executor and the prompt builder.
  - Waiting on Woody: whether ChatBGP may name a brand's contact at a
    viewing to a joint agent (its Viewings page shows it; ChatBGP leaves it
    out); whether a joint agent may message any BGP login or only those on
    the Landsec account (built: only those; BGP staff can start one with
    it); whether an old login's conversations should be removed so it can
    be re-roled. Also: a Landsec login on a computer does not list
    its conversations with people in the chat rail (`chatIsClient` in
    `chat-panel.tsx`; the phone Messages tab does), so a joint agent's
    message to it is seen on a phone only. Opening that list to client
    logins is his call.

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
    Close to). One stage pill across the page (`stageChipClass`).
  - Waiting on Woody: what a full Landsec login reads on a brand (the BGP
    take in full, live tenancies and rent at other landlords' schemes, the
    expansion score, Tracker updates).

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
  timed job allowed to read staff email text for contact details; reading
  it for requirements is still not approved. It has not been run against
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

## Brand CRM (Woody, 2026-11-12) — docs/brand-crm-spec-2026-11-12.md

The brands' own CRM: which schemes BGP wants each brand in, whether there is
a unit for it there, how far it has got, and what happens next. Built from
`docs/brand-crm-spec-2026-11-12.md`; **its "Decisions" section at the top
overrides the spec body.** Staff: `/brands?tab=crm` (the Brand CRM pill in
Brand Intelligence, and a sidebar link). Landsec logins: the same pill under
Brands. A joint agent has no Brands entry, so it has `/landsec/brand-crm`.
Three views: Targets (brands against the Landsec schemes), Diary, and
Strategies and events (BGP staff only). The same plan is the **Schemes and
units** card on every brand page.

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
  brand page shows only the requirements the Requirements page lets it read
  (PIPnet listings and its own).
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
the owner is tied to the property. A client login always gets the page as it was, whatever
the address says (`planLayout` in `property-detail.tsx`): opening it to
Landsec logins is roll-out, which waits on Woody. The page as it was is
untouched when it is off, and
`PropertySection` and the tab mapping (`tab(full, simple, plan)` in
`property-detail.tsx`) are how each existing card finds its tab.

- **One feed**: `GET /api/properties/:id/units` and `…/units/:unitId`
  (`server/property-units.ts`), a fixed number of queries per property. The
  list, the plan colours and the pills all read it. `propertyReadBlocked`
  is the read check (a client login on its own properties; BGP staff viewing
  as a client are held to that client's properties). No fee, internal agent
  or BGP note on a target is in either reply. A joint agent cannot reach it
  (the gateway has no rule for it, on purpose); an asset manager is a full
  Landsec login since 13 November 2026 and reads it as one. An archived
  schedule row is history, not a unit, unless a live letting still hangs off
  it: a letting is never hidden because its row was archived.
- **Matching**: `shared/property-plan-match.ts`,
  `server/property-plan-match.ts` (`GET /api/plans/:id/match`, `POST
  …/match/accept`, `…/accept-suggested`, `…/dismiss`). A scan stays open and
  is worked through one outline at a time; the unit number printed on the
  plan decides before the tenant's name; one schedule row has at most one
  outline per floor (also enforced on the older save routes in
  `server/property-plans.ts`). The older one-shot review
  (`applyPropertyPlanScan`) and the Plans card still work and are reached
  from the **Plans** button.
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
  - Before the plan-led page opens to client logins, `KeyContactRow`'s job
    title editor must be made staff only (the client CRM guard would let a
    client save it).
- **Approved by Woody on 2026-11-13** ("yes do it all"): pushing step 1
  live behind the button; loading the May 2022 Bluewater plan; the link from
  a schedule row to the tenant's legal entity (`tenant_entity_id`); the
  shared contacts board, with the property page first.
- **Still waiting on Woody** (the note lists them): unit links on comps and
  lease events, retiring the Layout choice, narrowing the schedule's Status
  box, the brochure card and the documents root, one store for target
  brands, joint agents on the real pages (asset managers were on this list
  until Woody answered on 13 November 2026: they are full Landsec logins
  and use the real pages).

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
  the Landsec Tasks page). A new task screen uses that file. **Waiting on
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
- **Log as offer / Log as viewing** on a target's comments (staff Letting
  Tracker) is BGP staff only, because the comments are BGP's notes. The
  server fetches the comment by target id and timestamp
  (`source: { type: "target_comment" }`); the client never sends its words,
  and every other login gets the same refusal whether or not the comment
  exists. It opens the Add form filled from the comment; the comment is not
  changed.
- **Never make the reader save**, and never route "drop a note in" through
  ChatBGP's `log_offer`, which saves at once with no form to check.
- **NOT built, each waits on Woody** (do not build without his answer):
  reading team chat; reading email bodies.
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
  - **Four sources, nothing else**: a target's comment log (BGP's notes),
    a viewing whose outcome is Offer Expected or Offer Received or whose
    note reads as an offer, an interest note a person typed, a Targeting
    Brief comment that names one brand on the unit. Never inbox-swept rows,
    a diary invitation's subject, emails, chat, deal comments or CRM
    interactions.
  - **Already logged** = an offer (or viewing) for the same unit and brand
    within 14 days either side. A viewing that expects an offer looks
    forward: any offer from that brand since. The dedupe key is the source,
    the kind and a hash of the words, so a dismissed or logged suggestion
    never comes back and an edited comment is raised once more.
  - **It runs when a source is saved** (`queueSuggestionScan`, one fire and
    forget line in the handlers that write a target comment, a viewing, an
    interest line and a brief comment; it never fails or slows the save)
    and from the admin Preview then Apply
    (`/api/admin/letting-suggestions/preview|apply`; Settings → Letting
    integrity → Backfills). Never at boot, never on a timer.
  - **Who sees what**: rows from target comments are `visibility = 'bgp'`,
    BGP staff only (`isStaff && seesBgpNotes`). The rest are `'brief'`: BGP
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
  and confirmed by its creator (`bgpCreatedStamp`). Request bodies never set
  these columns (`stripRequirementProvenance`).
- Anything a machine detects is a suggestion in `requirement_evidence`
  (status open), never a live requirement. Staff only: no evidence,
  suggestion, owner or health data goes to a client login.
- **Migration** `migrations/0056_requirements_centre.sql` (idempotent, on
  `IDEMPOTENT_SQL_MIGRATIONS`, declared in `shared/schema.ts`; additive
  only): on `crm_requirements_leasing` the columns `last_confirmed_at`,
  `last_confirmed_by`, `last_confirmed_by_name`, `confirmed_how`, `origin`
  ('bgp' | 'pipnet' | 'trl'; NULL = made before the build),
  `external_requirement_id`, `last_listed_at`, `last_listed_source`; and the
  one new table `requirement_evidence` (evidence lines and suggestions).
  Existing rows were not back-filled: they have no confirmation, so none of
  them reads Live until a person presses Confirm.
- **One intake**: `server/requirement-intake.ts` is the one door for
  SUGGESTIONS and CONFIRMATIONS; never write an evidence line or a
  confirmation beside it. Six older paths still insert their own stamped
  requirement rows directly, with no evidence line: the two imports
  (`server/pipnet.ts`, `server/trl.ts`), the Add requirement form
  (`POST /api/crm/requirements-leasing`), the convert route, the two bulk
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
  PIPnet-labelled row (client logins see those). An edit is not a
  confirmation. ChatBGP's search, context and the MCP search read
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
  CBRE, CoStar, Green Street) never reaches the requirements centre. This is
  the ONLY email text read for requirements; Woody asked for Propel to drive
  requirements but has not confirmed this path in so many words. After writing signals
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
  viewing as one, get the read-only shape (`clientShape`): Open / Closed, no
  state, owner, date line, edit or delete. Never show a client the state or
  who confirmed.
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
  for scoring (live 1, to confirm 0.5, background 0.2). **One client rule**:
  a client login is only ever given rows labelled PIPnet
  (`requirementClientVisibleSql` / `requirementClientVisible`), by source and
  month (`reason.clientText`), never the state, never BGP's hand-entered
  rows. The one addition, on the Requirements list, the single GET and a
  contact's requirements, is a requirement on the client's OWN company. Any
  row sent to a client goes through `requirementClientCopy` (no provenance,
  no BGP owner, no last-edit time), and a confirmation writes no date onto a
  PIPnet-labelled row: a client must not learn who at BGP owns a listing or
  when BGP confirmed it. The same rule covers the hub's "Who's hot" query
  (`hotReqJoin`), the market commentary's activity count, the requirement
  name on a viewing, and the Expansion score's why-lines and flags
  (`clientScoreView` / `clientScoreLabel` in `server/hunter-score.ts`). That holds in the target engine (`server/target-tenant-engine.ts`:
  a PIPnet listing is shareable evidence, everything else about a
  requirement is `internal`, because saved rationales are read by the
  landlord), tracker targets and suggested pitches (`server/crm.ts`), space
  fits (`server/account-teams.ts`), Brand Gap (its cached commentary is read
  by staff and clients alike, so it carries shareable lines only), the unit
  Match dialog, the brand page feed, the Brand Pack and the Brands hub. The
  brand page, pack, Brand Explorer flag and hub tile mean live or to confirm.
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
- **NOT built** (each waits on Woody; do not build without his answer):
  - **The email reader.** Reading staff email text for requirements needs
    his explicit yes. No code fetches or reads a staff email body for
    requirements; "Add evidence → email" is a line a person types. The one
    exception is the publisher newsletter path above (Propel and the like,
    never an agent firm's mail), which he should confirm.
  - **The Landsec view.** Client logins were given nothing new; only leaks
    of BGP's hand-entered requirements were closed. Slice-limited listings
    and a share marker need his decision (review, Across the app 4).
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
