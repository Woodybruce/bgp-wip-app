# Property page rebuild: the plan and the tenancy schedule first

13 November 2026. Woody asked for the Properties page to be rebuilt so that
everything revolves around the leasing plan and the tenancy schedule, with
Bluewater as the working example. This note records what he asked for, what
was decided, what was found, what is built and what is still waiting on him.

## In one paragraph

The tenancy schedule is the list of a property's units and stays the spine.
The leasing plan is a picture of those units. The new page opens on the plan,
with every unit coloured by its state and one list of units beside it. Click a
unit, on the plan or in the list, and one panel shows everything about it:
tenant, lease, letting, deal, brief, viewings and offers. Everything else is a
tab: Tenancy schedule, Risk register, Activity, Brand gap, Documents, People
and Details. The page shapes itself to the building, so a single shop is not
laid out like a shopping centre.

## What Woody asked for

- "I want to use that structure instead for the properties page so everything
  revolves around the leasing plan and the tenancy schedule … so it's all
  visually on the plan. We can then have tabs for risk register and activity.
  The tenancy schedule can also be a tab … I want to be able to click on a
  unit and have it all there."
- "Loading up the plan and linkage to tenancy schedule to start off with is
  absolutely critical with tenancy schedule remaining the spine."
- "Put brand gap as a tab too." "Units and lettings page is great."
- "Just a very confusing page at the moment. Use Bluewater as the working
  example."
- Documents: "one folder for each property with everything in there linked to
  SharePoint", "delete the brochure page and just make sure the brochure is in
  the folders".
- After the approach was put to him: "agree with all the decisions". Units and
  lettings is "basically just a shorter version of the tenancy schedule; we
  need to make sure there is only one". "Happy to completely rebuild the
  properties page as one synced system." The link to tenants in the schedule
  matters; the schedule "is just a bit big" and "can be reduced in areas".
  Trading names "should be linked to brands but their actual AML contracted
  company name is often different and should be a sub company within the
  brands for covenant checking and AML". "A shopping centre is very different
  to a much more basic single unit so we do need to have a structure that
  works for smaller buildings." On contacts: "I feel like we need all boards
  to use the same Contacts approach."

## Decided (do not re-litigate)

1. **The plan never writes to the schedule.** An outline that matches no
   schedule row is kept as grey context. Only a person adds a schedule row.
2. **One page for every property.** It replaces the Building, Multi-let and
   Centre views. The page decides its own shape from what the property has.
3. **Documents live in the team's real folder**: `BGP - Share Drive /
   National / National / Landsec / <scheme>` for Landsec, not the app's
   separate `BGP share drive`.
4. **Bluewater's plan.** Ask Landsec for the current leasing plan PDF. Until
   it arrives, load `Bluewater Leasing Plan - May 2022.pdf`, which is already
   in SharePoint under `BGP - Share Drive / National / National / Bluewater`
   and has readable unit numbers.
5. **One list of units.** Units and lettings and the tenancy schedule are the
   same rows. The short list on the Plan tab is the default view of the
   schedule; the Tenancy schedule tab is the full grid of the same rows.
6. **Two facts about a unit, kept apart** (as `docs/unit-status-cleanup-plan.md`
   already decided). Occupancy (occupied, vacant, not recorded) comes from the
   schedule. The letting stage (Opportunity, Marketing, Negotiating, HOTs,
   Solicitors) comes only from the Letting Tracker row and its deal, never
   from a word typed on the schedule. The words are the Letting Tracker's own.

## What we found (live data, 13 November)

**Bluewater.** 188 schedule rows and 5 units that are on the Letting Tracker
only. The plan loaded on 27 September is a two-page slide with a low
resolution picture per floor, so the unit numbers cannot be read. The scan
found 221 outlines (102 upper level, 119 lower level) and suggested a schedule
row for 34 of them. Nobody has saved a single outline: the review was a
221-item pop-up at the bottom of a 20-card page. 105 of the 188 rows have no
tenant name; 183 carry a unit number, which is why the unit number has to
decide the match. 15 of 23 live deals are tied to a schedule row. The page is
about 4,600 pixels long and makes 144 requests when it opens.

**Across the app.** No property has a saved outline. Of 92 properties
sampled, 44 have no schedule and 14 have one unit. About 25 schedule fields
are empty on every row and another 25 are used on one to three properties.
526 rows have a tenant name and a trading name that differ; 30% of rows are
linked to a company.

**Tenant names.** The table for a brand's legal entities already exists
(`crm_trading_entities`, with KYC per entity). Covenant and AML checks run at
brand level today, and the schedule row has no link to an entity. The tenant
cell has four defects: the brand picker saves only the name; every name edit
re-works the company link by name and can wipe a link made by hand; the
look-up takes the first match in no fixed order; and an empty trading name
hides the tenant name.

**Contacts.** The property's Contacts card is its own system
(`/api/properties/:id/linked-contacts`). It is not linked to the CRM
strategies, events or actions, and it is not the board used on landlord and
brand pages. The shared contacts design of 12 November
(`docs/contact-intelligence-plan-2026-11-12.md`) is written and not built.
`crm_property_clients` already stores a role per person per property. A
client login is sent each contact's last interaction, which it should not be.

**Brand gap.** The list of brands "on the scheme" comes from store locations,
not from the schedule, so it shows 31 where Bluewater has about 60 food and
leisure operators, and it calls brands absent that are on the plan (Pret at
L003). Four of the five "missing sectors" are wrong. The commentary has lines
nothing supports. Nothing leads to a unit or an action. The AI target list
has 344 rows with 25 duplicates, 64 on units under 300 sq ft and none on the
main live restaurant units. Team shortlists and live deals are ignored. The
weekly expansion read sends the scheme name, postcode, competing centres and
brand names to Perplexity, Landsec schemes included. Woody, 13 November:
"there is no anthropic only rule", so this stays as it is.

**Documents.** The app writes to a drive called `BGP share drive`; the team's
real drive is `BGP - Share Drive`. A hand-made Landsec tree exists at
`National / National / Landsec` with a folder for most schemes. The app's
standard client folder tree has never been run for Landsec. "Set Up Folders"
has no template for a shopping centre. Brochures, plans, heads of terms and
briefs are stored in the app's database, not in SharePoint, and seven other
features read the brochure store.

## The page

Tabs, in this order: **Plan** (called Units when no plan is loaded, Unit for a
single-unit building), **Tenancy schedule**, **Risk register**, **Activity**,
**Brand gap**, **Documents**, **People**, **Details**.

How the Plan tab shapes itself:

| The property has | The Plan tab shows |
|---|---|
| No units | A short card: add the units on the tenancy schedule first, then load a plan |
| One unit, no plan | That unit's panel as the whole tab |
| Several units, no plan | The list of units; a unit's panel opens beside it |
| A plan | The plan, coloured by state, with the list beside it |

On the plan-led page the old Available units and Units and lettings cards are
gone: what they showed is in the list, the pills and the unit panel. The Deals
card stays, under Details, because it also lists deals that are closed or not
tied to a unit. The older Plans card (upload, rename, delete, draw by hand)
opens from the **Plans** button. "Edit on the tenancy schedule" in a unit's
panel opens the Tenancy schedule tab; it does not yet jump to the unit's row.

**Matching a plan to the schedule.** The Match screen sits beside the plan.
The scan's proposals are dashed outlines. For each one the person accepts the
suggested unit, chooses another, keeps it as context, or marks it "not a
unit". "Accept suggested matches" takes every proposal whose unit number or
tenant name points at exactly one schedule row with nothing that disagrees.
"Find on plan" works the other way round: pick a schedule unit, click inside
it on the plan, and the app takes the proposal under the click or traces the
walls. The work is saved as it goes and can be done over several sittings.

How a row is suggested for an outline:
- The unit number printed on the plan decides first, without the tenant, since
  a plan is often older than the schedule. A different tenant is reported, not
  treated as a different unit.
- A tenant's name suggests a row only when the plan prints no number.
- A number that matches nothing is never overridden by a name.
- More than one possible row is never a suggestion, unless exactly one is on
  the plan's floor, and that one is never taken by the bulk button.
- Two outlines that point at one row are both left for a person.

## Build order and where it stands

1. **Plan and schedule** (live since 13 November 2026, behind an opt-in switch).
   The unit feed, the plan-led layout, the one list, the unit panel, and the
   Match screen. BGP staff see "Try the plan-led page" on a property; the
   choice is remembered in that browser; `?layout=plan` or `?layout=classic`
   in the address sets it. A client login always gets the current page,
   whatever the address says. The current page is unchanged when it is off.
2. **Lettings and deals on the plan.** Stage colours are in. Still to do:
   brief targets and CRM strategy on the unit, and letting actions (viewing,
   offer, brief) started from the unit panel.
3. **Lease advisory on the plan.** Leasing comps, lease events and rent
   review matters on the unit, and one plan instead of a separate evidence
   plan. Needs unit links on comps and lease events (a database change).
4. **Risk register, Activity and Brand gap made unit-aware.** Brand gap
   improvements are listed below.
5. **Roll-out.** Landsec logins, phone polish, retiring the old cards and the
   Layout choice, and the default switched over.
6. **Documents.** One SharePoint folder per property, brochures as files in
   it, and the brochure card removed.

## Live, 13 November

Step 1 went live on 13 November. Checked on the live app with real Bluewater
data, reading only: 193 units (188 on the schedule, 5 on the tracker only),
130 occupied and 63 vacant, 24 live lettings, 221 outlines waiting to be
matched, 3 open deals not tied to a unit. The page makes 28 requests when it
opens, where the page as it was made 144. The unit list answers in about 0.6
seconds, after the brand match was changed to run once for the whole schedule
(it took 2 seconds at first, as the tenancy schedule's own read still does).

The May 2022 leasing plan is not loaded yet. The test login used for checks
may only read the live app, and the app's own "Add from SharePoint" finder
does not find the file for Bluewater (no folder is linked to the property; the
search takes 90 seconds and offers one unrelated PDF). The file is `Bluewater
Leasing Plan - May 2022.pdf` in `BGP - Share Drive / National / National /
Bluewater`; it goes in through Plans, Upload plan.

## Known gaps in step 1

- The plan loaded for Bluewater is still the low-resolution slide. The match
  works on it, but the May 2022 leasing plan (or Landsec's current one) will
  give far more unit numbers to match on.
- "Edit on the tenancy schedule" opens the tab, not the unit's row.
- The older one-shot scan review (Plans button) does not offer a proposal
  again after its saved outline is removed; the Match screen does.
- The Tenancy schedule tab is the existing compact schedule. Cutting its
  never-used columns and fixing the tenant cell are step 2 work.
- A fresh scan cannot be started from the Match screen once a scan's queue
  is empty; it is started from the Plans button.
- Two neighbouring outlines traced a hair over each other count as
  overlapping, so the second is refused. Outlines from one scan never do
  this; a hand-drawn one beside a scanned one can.
- Nothing on the plan-led page has been tried by the team yet, and it has
  only been run against a local copy of Bluewater, not the live data.

## Brand gap: suggested improvements

1. Count who is on the scheme from the tenancy schedule and the plan, not from
   store locations.
2. Lead with the units to fill and the brands that fit each one, and let a
   brand be put on a unit's target list from the tab.
3. One merged target list per unit: the team's shortlist, the brief's targets
   and the AI suggestions together, with live deals taken out.
4. Write the commentary only from the data, and say where each line comes
   from.
5. Cut the news to the scheme's own sector and remove duplicates.
6. A shorter, honest comparison with peer schemes.

## Decided on 13 November ("yes do it all")

1. Push step 1 live behind the button.
2. Load `Bluewater Leasing Plan - May 2022.pdf` from SharePoint.
3. Add the link from a schedule row to the tenant's legal entity
   (`tenant_entity_id`), so covenant and AML run on the contracting company
   while the trading name stays linked to the brand.
4. Perplexity stays on for Landsec schemes: "there is no anthropic only
   rule".
5. Build the shared contacts board, with the property page as the first
   board converted, and close the last-interaction leak to client logins.

The build plans for decisions 3 and 5, each reviewed by two critics and
revised, are `docs/tenant-entity-plan-2026-11-13.md` (the company on the
lease) and `docs/contacts-board-plan-2026-11-13.md` (the shared contacts
board, property page first). Each ends with the points that need Woody's
word; both are being built in packages, with the plan's cautious default
wherever he has not yet said.

## Waiting on Woody

Do not build any of these either way without his answer.

1. Unit links on comps and lease events, and folding evidence plans into the
   one plan (step 3).
2. Retiring the Layout choice and the size rules above as the only layout
   (this reverses the September line that a tracker-only schedule does not
   make a single-building page).
3. Narrowing the schedule's Status box to occupancy only.
4. Removing the brochure card and moving the documents root (step 6).
5. One store for target brands.
6. Joint agents on the real pages (his open question of 12 November). Until
   he answers a joint agent cannot reach the plan-led page's data: the
   restricted gateway refuses it. (This item read "Asset managers and joint
   agents". Woody answered it for asset managers later on 13 November 2026:
   "asset managers and leasing landsec should be the same". An asset manager
   is a full Landsec login and reaches the unit feed as one does.)

## For whoever builds next

- **One feed.** `GET /api/properties/:id/units` (`server/property-units.ts`)
  returns every unit with occupancy, stage, deal, brief, counts, outlines and
  flags, in a fixed number of queries. `GET …/units/:unitId` adds the rest of
  one unit. The rule for occupancy, stage, flags, filters, state words and
  colours is `shared/property-units.ts`, with tests in
  `shared/property-units.test.ts`. Change a rule there, never on a screen.
- **Matching.** `shared/property-plan-match.ts` and
  `server/property-plan-match.ts`: `GET /api/plans/:id/match` (saved outlines,
  open proposals, schedule rows), `POST …/match/accept`,
  `…/match/accept-suggested`, `…/match/dismiss`. A scan stays open: an
  accepted proposal is marked on the scan with the outline it became, and a
  removed outline puts its proposal back. Nothing in that file writes to
  `tenancy_schedule_units`. One schedule row has at most one outline per
  floor, on these routes and on the older save routes in
  `server/property-plans.ts`.
- **Who may read.** `propertyReadBlocked` in `server/property-units.ts`: a
  client login on its own properties only, and BGP staff viewing as a client
  are held to that client's properties too. The replies carry no fee, no
  internal agent and no BGP note on a target; a viewing's contact name goes to
  BGP staff only.
- **Client.** `client/src/components/property-page/`: `use-property-page.ts`
  (reads, actions, the opt-in switch), `unit-state.tsx`, `plan-canvas.tsx`,
  `unit-list.tsx`, `unit-panel.tsx`, `match-panel.tsx`, `plan-workspace.tsx`.
  `property-detail.tsx` maps each existing card to a tab with `tab(full,
  simple, plan)`; `PropertySection` is unchanged.
- **Tests.** `shared/property-units.test.ts`, `server/property-page.test.ts`
  (the SQL part needs `PROPERTY_PAGE_DATABASE_URL` naming a local database
  with the app's tables), `qa/regression/property-units-guards.test.mjs`.
- **Old links** still work: `#tenancy-unit-<row id>`, `#plan-tenancy-<row id>`
  and `#plan-unit-<name>` open the unit on the Plan tab; `?section=units`
  opens the Plan tab.
