# UX notes — improvement suggestions from rolling QA

Things that WORK but didn't serve the user well during a tested journey:
unclear, clunky, too many steps, or missing something the user obviously
wanted. Collected by the rolling QA routine for Woody's review.

Rules (Woody, 2026-08-01): suggestions are NOT implemented until he confirms
them by number. Bugs (broken vs intended behaviour) don't belong here — those
get fixed directly.

Format per entry: date · persona/surface · what the user was trying to do ·
what happened · concrete suggested improvement.

## Open suggestions

377. 2026-09-09 · Mark Warne (Landsec client) / desktop 1440px · QA r629 ·
   **The "re-add it from the Brand Directory" empty state sends the client to
   a page with no way to add a brand.** Opening a brand that is not in his CRM
   gives a clean "Brand not in your list — you can re-add it from the Brand
   Directory at any time" card whose button navigates to `/contacts`
   (`companies.tsx:1269`). That page is the client CRM Brand Directory — and
   the only "Add brand" control in the app lives on Brand Intelligence
   (`ClientAddBrandButton`, `brands-hub.tsx:1617`). So the recovery path the
   app names is a dead end: Mark has to work out on his own that the add
   control is on a different page. **Suggestion:** mount the same
   `ClientAddBrandButton` on the client CRM Brand Directory header (it is
   already a self-contained component), or point the empty-state button at
   `/brands` instead.

378. 2026-09-09 · Mark Warne (Landsec client) / desktop 1440px · QA r629 ·
   **The Brand Intelligence header button says "All Brands" and lands the
   client on a page titled "CRM".** For staff the label is honest — it opens
   the whole tenant directory. For a client it opens his own 10-brand slice
   under a heading that says nothing about brands, so the one button that
   promises "all brands" is both an overclaim and a non-sequitur
   (`brands-hub.tsx:1613`, unconditional). **Suggestion:** for client logins
   label it "Brand Directory" (matching the tab it lands on and the wording
   the empty state above already uses).

379. 2026-09-09 · Mark Warne (Landsec client) / desktop 1440px · QA r629 ·
   **The client Turnover Board shows BGP's internal AI working notes in its
   Notes column.** The board is correctly sliced to his brands, but each row
   carries the estimate's reasoning verbatim — "Testco Fashion appears to be a
   fictional or very small/niche brand with no available public financial
   data", "Starbucks UK revenue not separately disclosed. Parent company
   reports global revenue only" — beside a Source of "AI Estimate" and a
   Confidence of "Low". Nothing is secret, but it reads as BGP's scratchpad
   rather than intelligence prepared for a landlord. **Suggestion:** for
   client logins either hide the Notes column on AI-Estimate rows (keep it for
   Conversation/accounts-sourced rows, which are real evidence) or print a
   single honest line — "No public turnover disclosed" — in its place.

375. 2026-09-09 · Victoria (BGP staff) / `/comps` desktop · QA r628 ·
   **The comps board's "Export" button is called Export next to "Export PDF",
   and it silently hands you a .csv — not the .xlsx the board's own Import
   accepts.** The function is even named `exportToExcel`. So the obvious
   round-trip (export the board, tidy it in Excel, re-import) fails at the
   import step, which only takes `.xlsx`. **Suggestion:** label the two
   buttons "Export CSV" / "Export PDF", or ship a real .xlsx through the
   `export_to_excel` builder now that it carries typed cells and formulas —
   which would also let the Net Effective columns arrive as live
   `=headline−incentive÷term` formulas rather than flat numbers.

376. 2026-09-09 · Investment team / `/investment-comps` desktop · QA r628 ·
   **Four columns the table can show are absent from its CSV export.** The
   board's column picker offers `features`, `priceQualifier`,
   `capRateQualifier` and `partialInterest`; the export's 27 headers do not
   include them, so a user who turned them on and exported loses exactly the
   qualifiers that say whether a price or a cap rate is comparable at all.
   **Suggestion:** export what the picker offers — ideally the user's OWN
   visible column selection, which is what "Export" reads as.

374. 2026-09-09 · Victoria (BGP staff, Head of National) / ChatBGP export ·
   QA r627 · **A spreadsheet cell's number format is still guessed from its
   COLUMN HEADER, which is meaningless on a label/value sheet.** r627/r628 fixed
   the damage the guess was doing (an exit yield of 0.068 under a header
   reading "Value" was rendering as "£0") and gave the tool a typed-cell path
   so the model can pass `{value, numFmt}` per cell — but the fallback
   heuristic is untouched, so on an Assumptions sheet headed
   Metric / Value / Notes a term of `10` years still comes out as "£10" and a
   unit count of `4` as "£4", because "value" is on the currency keyword list
   (`chatbgp.ts`, the header keyword test inside `export_to_excel`). Formats are a per-cell property; guessing
   them per column only ever worked because the tool started life as a comps
   dumper where every column was homogeneous. **Suggestion:** once ChatBGP is
   reliably passing `numFmt` on the cells that need it, drop the header
   heuristic to currency-only-when-the-header-is-unambiguous (`£`, `rent`,
   `price`, `cost`, `income` — not the generic `value`), and let everything
   else render as the plain number the user typed. Needs Woody's call because
   it changes how every existing comps export looks.

372. 2026-09-09 · Mark Warne (Landsec client) / ChatBGP · QA r626 · **The
   new out-of-portfolio refusal is a dead end.** Ask ChatBGP to change a
   record that isn't yours and the reply is "That deal isn't part of your
   portfolio, so it can't be changed from this account. Contact your BGP team
   if it should be." — but it names nobody, so the client has to go find who
   that is. The server already knows: `getClientVisibleUserIds`
   (`company-scope.ts:100`) resolves the exact BGP agents on that client's
   stock, and the tracker's Agent column renders them. Suggestion: name the
   client's lead BGP contact in the refusal ("…contact Victoria Hartley, your
   BGP contact on this scheme"), or offer to raise a task for them in the same
   reply — `create_task` is already a client-allowed tool.

373. 2026-09-09 · any persona / ChatBGP · QA r626 · **`create_requirement`
   and `update_requirement` write to a table the app never displays.** Both
   tools, in both dispatchers, INSERT/UPDATE the legacy `requirements` table
   (`chatbgp.ts:6850` / `6978` and the mobile twins) — 11 columns, no owner
   key, and **0 rows in the QA fixture**. Every requirements board in the app
   reads `crm_requirements_leasing` / `crm_requirements_investment` instead.
   So "log that requirement for me" appears to succeed in chat and then shows
   up nowhere, for staff as much as for clients. Suggestion: point both tools
   at the CRM tables the boards actually read (which also gives the
   requirement an owner column, so the r626 gate can scope it properly
   instead of failing closed), or retire the two tools.

371. 2026-09-09 · Victoria (BGP staff, Head of National) / **phone 390px** ·
   QA r625 · **A BGP agent's internal deal comment goes straight to the
   landlord's screen, and nothing on the staff phone says so.** Victoria
   opened her Bluewater Gail's letting on the phone, ACTIVITY → Comments,
   and posted a note; it saved stamped "9 Sept 2026, 09:13 · Victoria
   Broadhead" (good). But `comments` is not in `stripDealFees`
   (`crm.ts:1130`), and the client deal detail renders the same
   `deal-comments` block with its own `input-deal-comment` — PROVED: Mark's
   `GET /api/crm/deals/:id` came back with Victoria's note verbatim. That may
   well be the intent (a shared thread the landlord can answer in), but the
   staff side is captioned only "Comments", next to a KYC panel whose notes
   were deliberately stripped from clients in r561. **Suggestion:** caption
   it for what it is on both surfaces — "Comments · visible to the client"
   on the staff phone/desktop, "Shared with your BGP team" on the client
   side — or, if it is meant to be internal, strip `comments` for clients
   and give them a separate thread. One word of caption either way.

370. 2026-09-09 · Victoria (BGP staff, Head of National) / **phone 390px** ·
   QA r625 · **The staff phone has no Tasks tab, so tasks are one scroll
   deep on the home screen.** Staff bottom nav is Dashboard · Messages ·
   Deals · News; the CLIENT phone nav carries Tasks as a fifth tab. On the
   staff phone `/tasks` exists and works (add-task from the phone saved
   first time, priority Medium, appears under TO DO), but it is only
   reachable from the "My tasks · View all" link below the finance tiles,
   the boards grid and the AI briefing card. For the "log the follow-up
   before you put the phone down" moment this is the wrong depth.
   **Suggestion:** either give staff the same Tasks tab the client has, or
   put an "Add task" affordance in the phone header — the page's own
   `input-add-task` is a single text field, so it would inline cleanly.

369. 2026-09-09 · Victoria (BGP staff, Head of National) / **phone 390px** ·
   QA r625 · **`stripDealFees` contradicts the decision recorded directly
   above it.** The comment at `crm.ts:1110` records Woody, 2026-07 ("client
   should see fees anywhere") and states: "Clients now see the fee they're
   paying us — total fee, agency %, and the fee-agreement label. Still
   stripped: the internal fee NOTES, the signed FA document link, and the
   raw commission field." The function immediately below nulls `fee`,
   `feePercentage` **and** `feeAgreement` along with the three it says it
   keeps stripping. Not observable on the fixture (the Bluewater deal's fee
   is null for staff too), so this is a code-vs-decision divergence, not a
   proven user-facing bug — but it is the kind that gets "fixed" the wrong
   way in a merge. **Suggestion:** Woody to say which is current, then make
   the comment and the field list agree in one commit. Not touched
   unilaterally — client fee visibility is a DECIDED question.

368. 2026-09-09 · Mark Warne (Landsec client) / ChatBGP · QA r624 ·
   **ChatBGP's client tool gate is a DENY-list, so every new tool ships
   client-allowed by default.** `CLIENT_BLOCKED_TOOLS`
   (`server/chatbgp.ts:2015`) names the ~45 tools a client must NOT have;
   `isToolAllowedForClient` returns true for everything else. That is why
   `add_property_imagery`, `update_property`, `upsert_tenancy_schedule` and
   `create_available_unit` were all reachable from a client session with no
   property-scope check at either dispatcher (fixed this round) — nobody
   forgot to block them, the default handed them over. Each new tool is
   another chance to hand a client something by omission.
   **Suggestion:** invert it — an explicit `CLIENT_ALLOWED_TOOLS` allow-list
   (the client surface is small: portfolio reads, their own tracker, their own
   tasks/comments), so a new tool is invisible to clients until someone
   deliberately adds it. Cheap safety net if the inversion is too big a
   change: a startup assertion that every tool in the schema list appears in
   exactly one of the two sets, so adding a tool fails loudly until it is
   classified.

366. 2026-09-09 · Mark Warne (Landsec client) / **phone 390px** · QA r623 ·
   **the same page counts his letting deals three different ways in two
   taps.** Journey: on the phone, checking where his Bluewater lettings
   stand. `/deals` header reads "2 deals — Landsec · **+2 letting deals on
   the Letting Tracker**"; one tap to the Properties tab of the same page
   reads "**73** LIVE LETTINGS · **2** LIVE DEALS"; and his portfolio home
   tile reads "**72** Available · **1** Under offer · 73 On tracker". Every
   number is defensible on its own (deals vs tracker units vs live lettings)
   but nothing on screen says which is which, and "+2 letting deals on the
   Letting Tracker" sits inches from a tracker that says 73. Suggestion: pick
   one noun per thing and use it everywhere on this page — "deals" for CRM
   deals, "units on the tracker" for listings — and drop the "+2 letting
   deals" fragment from the header, or qualify it ("2 of the 73 tracker units
   have a live letting deal").

367. 2026-09-09 · Mark Warne (Landsec client) / **phone 390px** · QA r623 ·
   **the two deal cards phrase "how long has this been sitting" two
   different ways, and one of them reads as a date.** Journey: same phone
   visit to `/deals`. Card 1 (U124 Bluewater — Gail's letting, Solicitors)
   shows "In status · **today**"; card 2 (MSU3 Bluewater — Starbucks regear,
   Exchanged) shows "In status · **36d in Exchanged**". Same field, same
   card layout, one value is a date-ish word and the other a duration with
   the status repeated. Suggestion: one form for both — "0d in Solicitors" /
   "36d in Exchanged", or "today" / "36 days", not a mix.

365. 2026-09-09 · Mark Warne (Landsec client) / desktop 1440px · QA r622 ·
   **the client's Deals table invites him to type the deal terms, and the
   invitation reads like a BGP-side editing affordance sitting on a client
   screen.** Journey: preparing for tomorrow's Landsec leasing meeting, Mark
   opens `/deals` (2 deals — #1003 Solicitors, #1004 Exchanged). The Lease
   Terms column on both rows renders **"+ Add terms"**
   (`deals.tsx:991` → `NumericStackedCell`, `emptyLabel="Add terms"`). It
   opens a "Lease terms" popover of six click-to-edit rows (Rent PA, Capital
   Contribution, Rent Free, Lease Length, Break Option, Rent Analysis), all
   "—". Typing 185000 into Rent PA and pressing Enter **saved** — `200 PUT
   /api/crm/deals/:id` — and the cell then read £185,000. Nothing tells Mark
   whether he is recording an agreed figure for his own record or overwriting
   the number BGP is negotiating from; there is no "who entered this" trace on
   the cell and no confirmation step. Note the same table's staff view renders
   **0** "Add terms" cells on these rows, so the client is the only persona
   being offered this. **Suggestion:** decide the intent explicitly and make
   the UI say it. If clients are meant to record their own view of terms,
   label it as theirs ("Your terms note" / show BGP's figure alongside) and
   stamp the author; if terms are BGP's to record (which the read-only shape
   of the rest of the client deals surface implies), render the empty cell as
   a plain "—" with a tooltip "your BGP team records the terms here" rather
   than a "+ Add terms" call to action. See also the deferred bug-shaped
   write-up in ROLLING-LOG r622 — if the write is NOT intended, this is a
   client-scope hole in the same family as r601's "client could reassign the
   BGP team on their own deal", not a suggestion.

360. 2026-09-08 · Victoria (BGP staff, non-admin "Head of National") /
   desktop 1440px · QA r620 · **she can read the firm's money list but has no
   door to the audit that says whether to trust it.** Month-end journey: she
   opens `/deals` (WIP Report is the desktop landing tab) and sees 7
   transactions · £250,000. Six of those seven deals have no target, exchange
   or completion date at all — after this round's fix the chart says so
   honestly (£250K in an untappable "TBC" bar), but the two tabs that would
   NAME the offending deals, **Fee Check and Needs Attention, are both hidden
   from her** (`canSeeAll`, wip-report.tsx:1453/1456) and `GET
   /api/wip/health` returns "Not authorised" to her token. So the Head of
   National can see that essentially all her WIP is undated and has no way in
   the app to find out which deals or fix them in a batch. **Suggestion:**
   keep the leadership gate on Fee Check (it exposes restricted-director fee
   numbers) but let anyone who can see the WIP Report see the *link* audit —
   either open Needs Attention to all WIP viewers scoped to their own teams,
   or put a one-line banner on the WIP Report tab ("6 deals worth £250,000
   have no billing month — set a Target Month") that deep-links the affected
   rows into the existing Deal Detail table filter.

361. 2026-09-08 · Victoria (BGP staff) / desktop 1440px · QA r620 · **"Net
   fees by month" is drawn as a bar chart but its x-axis is not a timeline.**
   `monthlyFees` (wip-report.tsx:1138-1151) plots only the months that
   actually have deals, equally spaced. Before this round's fix her chart read
   Jul-26 · Aug-26 · Sep-26 · Dec-26 — four evenly spaced bars with the
   Sep→Dec gap invisible, so the shape of the year (a quiet autumn) simply
   isn't there to read. **Suggestion:** render a continuous month axis across
   the selected fiscal year with £0 columns for the empty months, keeping TBC
   pinned on the right as the one off-axis bucket.

362. 2026-09-08 · Victoria (BGP staff) / desktop 1440px · QA r620 · **the TBC
   bar is now where the money is, and it is the one bar you cannot click.**
   Every other bar and every board row on the WIP Report filters the table
   below; TBC is `disabled` (wip-report.tsx:1730/1736) with no tooltip saying
   why. After this round's fix that is the bar carrying £250,000 of the
   fixture's £250,000, and "show me the deals with no billing month" is
   *exactly* the query a Head of National wants at month-end. **Suggestion:**
   make TBC tappable as a normal month filter (`entryMatches` already has the
   null-month branch this round added — selecting TBC would just invert it),
   or at minimum give the disabled bar a title explaining that these deals
   have no date and pointing at the Target Month column.

358. 2026-09-08 · Victoria (BGP staff, non-admin "Head of National") /
   desktop + phone · QA r619 · **Settings is admin-only in the nav, but it is
   the sole home of four all-staff panels.** `/settings` sits in
   `adminNavBase` (app-sidebar.tsx:154-162) and again as `adminOnly: true` in
   the phone list (:680), and the whole Admin NavSection renders only
   `{user?.isAdmin && …}` (:479) — so a non-admin staff member has **no link
   to Settings anywhere, on either shell** (#355 found the phone has no link
   even for an admin). Yet the page carries **Team Folders**, **ChatBGP
   Learnings**, **App Feedback** and **Change Requests**, whose endpoints are
   all `requireAuth`, not `requireAdmin` — deliberately open to every staff
   member. Team Folders in particular is a shared per-team file area with
   upload / download / delete (`routes.ts:8321-8404`) whose only UI is on
   this page. Suggestion: decide the page's audience — either put Settings in
   the core staff nav (every admin-only section inside it is already
   `{isAdmin && …}` gated, and r619 gated the last un-gated admin actions, so
   this is safe), or move Team Folders somewhere staff can reach. Today the
   nav and the server disagree about who this page is for.

359. 2026-09-08 · Victoria (BGP staff) / staff PHONE 390px · QA r619 · **the
   Diary's team filter is nine pills on a strip that shows two.** Even after
   this round made the strip scroll (it was clipped dead before — seven of
   nine teams simply unreachable), a phone user still sees "Development" and
   "London F&B" and has to drag sideways, with no affordance saying there is
   anything to drag to: no fade, no chevron, no count. `showTeam` defaults
   TRUE, so this bar is the first thing under the Diary header on every phone
   visit, and picking a colleague's team is the main reason to open the Diary
   on a phone at all. Suggestion: on phone, collapse the team filter to a
   single dropdown pill showing the active team ("Team: London F&B ▾") — the
   pattern the WIP filters already use — or at minimum add the standard
   edge-fade so the strip reads as scrollable.

355. 2026-09-08 · Victoria (BGP staff) / staff PHONE 390px · QA r618 · **the
   phone has no route to Settings at all.** Asked to tidy a duplicate
   property from her phone between viewings, Victoria could only get there by
   typing `/settings` from memory: there is not one `<a href="/settings">`
   anywhere in the phone shell — not on the home grid, not in the boards row,
   not on the bottom nav, not on `/m/profile`. The page itself is
   phone-adapted and works fine once you land on it (back arrow, native
   header, cards stack), and it holds the CRM data-hygiene tools, team
   structure, team folders and ChatBGP memory. This is the same hole that
   produced `server/chatbgp-app-map.ts` in the first place (ChatBGP sent
   Woody to a Settings page the phone can't reach, 2026-08-23) — the app map
   now describes the phone home honestly, but the route is still missing.
   Suggestion: a Settings tile on the phone home (or a gear on `/m/profile`,
   which is the natural place a phone user looks).

356. 2026-09-08 · Victoria (BGP staff) / staff PHONE 390px · QA r618 · **Data
   Health is six identical shields with no idea what any of them does.** All
   six actions ("Backfill Tracker Deals", "Rename Legacy Teams", "Sync
   Tracker → Leasing Schedule", "Renumber Units (test)", "Sort Teams", "Scan
   for Duplicates") carry the same ShieldCheck icon, sit in one undifferentiated
   row, and say nothing about what they touch, how many rows they will
   rewrite, or whether they can be undone. Only "Scan for Duplicates" is
   obviously safe. "Renumber Units (test)" ships to production with "(test)"
   in its label sitting next to bulk rewrites. Judged as Victoria: she would
   not press any of the other five without ringing someone first — which
   makes five bulk maintenance tools effectively unusable. Suggestion: one
   line of description per action, a confirm dialog naming the row count for
   the four that write, and either finish or hide the "(test)" one.


352. 2026-09-08 · Victoria (BGP staff) / desktop · QA r617 · Settings ->
   CRM data hygiene -> merging duplicate properties · **a merge that failed
   looked exactly like a merge that worked.** The property branch of
   `POST /api/crm/duplicates/merge` 500'd on every call (r617 bug 1). The
   only feedback was a red "Merge failed" toast carrying the raw Postgres
   string `column "agent_id" does not exist`, and "Merge All" reports
   `N merged, M failed` with no indication of WHICH groups failed — the list
   simply re-scans and the un-merged groups are still sitting there, looking
   identical to the ones that went through. Woody would have read that as
   "the scan is picking up things it can't merge", not "the endpoint is
   broken". **Suggestion:** on merge failure keep the failed group in the
   list with an inline error badge on that row (and drop the raw SQL text in
   favour of "couldn't merge — the BGP team has been notified"); log the
   server error so a broken branch surfaces without a person reading a toast.

353. 2026-09-08 · Victoria (BGP staff) / desktop · QA r617 · the two merge
   tools · **there are two dedupe tools and they behave differently in a way
   nothing on screen explains.** Settings -> CRM data hygiene HARD-deletes
   the loser (`crm.ts:1690` — `tx.delete(crmProperties/crmCompanies)`, no
   undo, no record). `/admin-dedupe` -> Brand duplicates SOFT-deletes it
   (`brand-dedupe.ts` — sets `merged_into_id`, writes a `dedupe_merges` row,
   and offers an Undo button for the last N merges). Same word, "Merge", on
   both screens; one is reversible and one is not. **Suggestion:** say so on
   the Settings buttons ("Merge (permanent — no undo)") or, better, route the
   Settings company merges through the brand-dedupe path so every merge is
   undoable. Related: see r617's deferred #354 — the Settings company branch
   also re-points far fewer references than the brand-dedupe path does.

350. 2026-09-08 · Mark Warne (Landsec) / client PHONE 390px · QA r616 ·
   opening his own property from the phone · **the phone's landing page is the
   one page with no search, and the phone has no other route to a property.**
   The Portfolio home (`App.tsx:566` — `location === "/"` renders `MobileHome`
   with its own chrome) sits OUTSIDE the generic phone shell that carries
   `<GlobalSearch compact />` + `<NotificationCenter />` (`App.tsx:656`, added
   for UX #156). So the bell and the search icon are on every page EXCEPT the
   one the user lands on. The home tile grid has Tracker / Requirements /
   Brands / Deals / Images / CRM / Calendar / News and no Properties tile, and
   the tracker's unit cards print "Bluewater Shopping Centre" as plain text
   with no link — so to reach his own property page Mark had to open some
   other page first, just to get a header with a search icon. His dashboard
   task "Review Bluewater Q3 leasing plan" isn't tappable either.
   **Suggestion:** put the search icon + bell on the phone home too (a compact
   row next to the greeting, or reuse the shell header there), and/or make the
   tracker card's property name a link to the property page. Either one gives
   the phone a first-class route to a property.

351. 2026-09-08 · Mark Warne (Landsec) / client PHONE 390px · QA r616 ·
   reading a property page on a 390px screen · **the page prints its own name
   twice and "Properties" twice before any content.** Top of every property
   page on the phone: "Property" (shell title) / "Properties" (breadcrumb) /
   "Bluewater Shopping Centre" (breadcrumb) / "PROPERTY" (eyebrow) /
   "Bluewater Shopping Centre" (h1) / "Properties" (back button) — six lines
   of chrome, ~90px of a 844px viewport, before the section pills. Desktop can
   carry it; the phone can't. **Suggestion:** on the phone collapse to one
   identity line — let the shell header hold the property NAME (it already
   special-cases detail routes to a generic "Property" label,
   `App.tsx:636`) and drop the in-page breadcrumb + eyebrow there.

348. 2026-09-08 · Woody / equity group · staff desktop · QA r615 ·
   Finance → commission statements · **the "missing fee split" alarm covers
   the PROJECTION but not the money already earned.** `buildCommissionOutlook`
   computes `missingSplits` (count + fee of deals with no non-house
   fee-allocation rows) and the Company outlook shows it as a warning — but
   the loop skips any deal whose status has no forward weight
   (`server/commission-engine.ts` ~330, `FORWARD_WEIGHTS` = NEG/HOT/SOL only).
   So a deal at EXCHANGED / COMPLETED / INVOICED with no split entered is
   credited to nobody in the FYTD statements (the query INNER JOINs
   `deal_fee_allocations`) **and raises no warning anywhere** — exactly the
   deals whose fees decide commission owed now. **Suggestion:** count fee-due
   deals with no split in the same warning (or a second line next to the
   statements), so an agent's billings can't silently understate. Cheap: the
   `missingRes` query already returns every unsplit fee-bearing deal; only
   the status filter excludes them.

349. 2026-09-08 · maintenance / all money screens · QA r615 ·
   **the firm's pipeline stage weights live in three separate files.**
   `PROJ_WEIGHTS` (`server/cashflow-board.ts:72`, NEG .5 / HOT .6 / SOL .75 /
   EXC .9 / COM 1), `STAGE_WEIGHTS` (`server/xero-financials.ts:501`, same
   minus COM) and `FORWARD_WEIGHTS` (`server/commission-engine.ts:282`, same
   minus EXC/COM) — and the commission one's comment claims it uses "the same
   weights as the income projection", which is true today only by hand. The
   COM/EXC differences are deliberate and documented; the shared NEG/HOT/SOL
   numbers are not shared, just duplicated. Nothing is wrong right now — this
   is the r580 HOT-enum failure waiting to happen again. **Suggestion:** one
   exported weight table (plus each door's own documented inclusion rule), so
   a re-weighting can't leave the WIP report, the cashflow board and the
   commission outlook disagreeing about the same deal book.

345. 2026-09-08 · Mark Warne (Landsec) · client desktop 1440px · QA r614 ·
   Brand Intelligence hub · **"Who's Hot — last 90 days" ranks brands by
   RECORD EDITS, not by anything that happened.** Mark's hub put Honi Poke and
   Amorino at the top as active "today"; opening Honi Poke, its own BGP
   RELATIONSHIP panel read *Last touch —* and *Active (90d) 0*. Both are
   right: the hub's hot query (`server/crm.ts` ~8417) takes
   `MAX(GREATEST(deal.updated_at, requirement.updated_at, contact.updated_at))`
   — so a brand goes hot the moment anyone saves a row on it, including a
   backfill or an AI enrichment write, with no human contact at all. Two
   surfaces on the same brand tell the landlord opposite stories.
   **Suggestion:** either rank on actual touches (the same source the
   relationship panel's "last touch" uses) and keep the "last 90 days" label
   honest, or relabel the tile "Recently updated" and drop the implication of
   momentum. (Also: the code comment above the query still says "last 60 days"
   while the SQL and the UI both say 90 — worth aligning while in there.)

346. 2026-09-08 · Mark Warne (Landsec) · client desktop 1440px · QA r614 ·
   brand profile → Compliance & KYC · **the client is invited to do BGP's job
   on a panel that otherwise tells him to wait.** On Honi Poke the UK TRADING
   ENTITY block correctly hides the staff edit pencil and the re-scrape button
   from a client (`brand-profile-panel.tsx` ~4081/~4090) and shows the client
   wording *"Not confirmed yet — BGP is identifying the UK trading entity."* —
   but the link immediately below it, *Search Companies House for "Honi Poke"*
   (~4147), is NOT client-gated. So the panel says "leave it with us" and then
   hands the landlord a search box to go and find it himself, with nowhere to
   put the answer (the save affordance is hidden). **Suggestion:** gate that
   link on `!bcIsClient` like the two controls above it, or — if Woody would
   rather clients could help — show it *with* a way to submit what they find.

347. 2026-09-08 · Mark Warne (Landsec) · client desktop 1440px · QA r614 ·
   brand profile first paint · **the profile renders empty for roughly the
   first two seconds after the click, with no skeleton.** Clicking a brand tile
   in Brand Explorer navigated to `/companies/<id>`; at networkidle + 1.6s the
   page body was 218 characters — sidebar chrome and nothing else, no heading,
   no spinner, no skeleton. Eight seconds later the full profile (relationship,
   portfolio activity, compliance, news) was there. Nothing is broken, but the
   first thing a client sees after clicking a brand is a blank page, which
   reads as "this brand has nothing in it". **Suggestion:** give the profile
   the same skeleton treatment the hub already has (`brands-hub.tsx` ~219
   renders `<Skeleton>` blocks while loading) so the click has an immediate
   answer.

343. 2026-09-08 · SCOPE-MODEL WRITE-UP, not a suggestion (QA r613; deferred
   since r608 — parked four rounds as "if time remains", written up here so
   Woody can decide). **ChatBGP's `add_property_imagery` has no scope check at
   all.** Schema at `server/chatbgp.ts` ~5081 (`required: ["propertyId",
   "images"]`); TWO handlers implement it — ~6851 and ~12375 — and NEITHER
   consults the caller's company scope. Both do the same three steps: look the
   property up by id, confirm it exists, then INSERT into
   `property_imagery_assets` stamping `generatedBy` with the caller. So a
   CLIENT login (Mark at Landsec) that gets any `crm_properties.id` into the
   conversation can attach imagery to a property outside their portfolio — a
   rival landlord's building — and it is written under their user id. Nothing
   in the tool description bounds it to the caller's own estate.
   **Correct fix** (same shape the neighbouring tool already uses at
   `chatbgp.ts:6558`, which does `isPropertyInScope(briefScope, ...)`): resolve
   the scope once and refuse before the insert, in BOTH handlers —
   `if (await clientBlockedForProperty(req, propertyId)) return { data: {
   success: false, error: "That property isn't in your portfolio." } };`
   `clientBlockedForProperty` (`server/company-scope.ts:244`) is the canonical
   guard for property-keyed doors opened to clients (plans / brochures /
   tasks): it no-ops for staff, and for a client returns true unless the
   property is theirs. Two edits, no schema change.
   **Why it isn't landed:** it changes what a client login may write, which is
   a scope-model decision, and the r609 lesson says the damage is always in the
   door nobody checked — so the write-up goes to Woody rather than the branch.
   Needs his numbered say-so. Worth pairing with #344.

344. 2026-09-08 · SCOPE-MODEL WRITE-UP, not a suggestion (QA r613; deferred
   since r608 alongside #343). **`POST /api/favorite-instructions/:propertyId`
   (`server/crm.ts:8048`) takes any property id and writes it, with no scope
   check.** The route is `requireAuth` only: it reads the session user, then
   `INSERT INTO favorite_instructions (user_id, property_id) … ON CONFLICT DO
   NOTHING`. The `propertyId` path param is never validated — not against
   `crm_properties` (so a favourite can point at nothing), and not against the
   caller's scope (so a client can favourite a rival landlord's building).
   Lower blast radius than #343 — the row is keyed to the user and the GET at
   `:8040` only ever returns that user's own ids, so nothing leaks TO the
   client from this table today. But it is a client-writable row referencing an
   out-of-scope property, and any future surface that joins favourites to
   property data inherits the hole.
   **Correct fix:** the same guard, plus the existence check the route is
   missing — reject with 404 when no such property, and
   `clientBlockedForProperty(req, propertyId)` → 403 otherwise. One edit.
   **Why it isn't landed:** same reason as #343 — Woody's call on what a client
   login may write.

342. 2026-09-08 · BGP staff / desktop (QA r613) · the Lease Events board's
   nightly auto-assignment is invisible to the user · `runLeaseEventMonitoring`
   (`server/lease-events.ts`) silently reassigns every unassigned Monitoring
   event inside the 18-month watch window to the lease advisory team's first
   address, and the only trace is a server console line. On the board the Owner
   cell just changes from "Unassigned" to a name some time overnight, with no
   note of who or what did it and no way to see the rule. (Found while fixing
   r613's day-overdue bug — the same job had been skipping events dated TODAY
   entirely, so nobody would have noticed those never arriving either.)
   **Suggestion:** stamp the auto-assignment — either a `source`/`assigned_by`
   note on the row rendered as a small "auto" chip beside the owner, or a line
   in the event's notes ("auto-assigned to lease advisory, <date>"), so an
   agent can tell a deliberate hand-off from a nightly sweep.

341. 2026-09-08 · BGP staff / desktop (QA r612) · Victoria does quarterly AML
   housekeeping and wants her list of re-checks due · the MLRO's ongoing-
   monitoring list (Re-check Reminders, MLR 2017 Reg 28(11)) lives at the
   BOTTOM of the AML hub's "Firm Settings" tab, and the only place an overdue
   re-check is ever announced is a small red badge in that same page's own
   header — so you only learn a CDD re-check is late once you have already
   navigated to the page that would tell you. Nothing appears in the
   notifications bell, on the dashboard, or on the Compliance Board.
   Suggestion: surface the overdue re-check count where the team actually
   looks — a bell notification per overdue re-check (like the KYC-not-approved
   alert already does for deals) and/or a tile on the Compliance Board, both
   deep-linking to the reminder.

340. 2026-09-08 · BGP staff / desktop (QA r612) · Victoria adds a re-check
   reminder for a brand she has just approved · the Add Reminder form takes
   the entity as FREE TEXT, so the row it writes has `company_id = NULL`. Two
   consequences the MLRO can't see: the reminder can't be opened from (or
   shown on) the brand it is about, and the nightly AML re-screen sweep joins
   `aml_recheck_reminders` on `company_id`, so a hand-typed reminder can
   never trigger the automatic re-screen it is asking for — only reminders
   the app auto-created on KYC approval can.
   Suggestion: make the Entity field the shared CRM brand picker (free text
   still allowed for non-CRM individuals) and store `company_id` when a brand
   is chosen, so hand-made reminders behave like auto-made ones.

339. 2026-09-08 · BGP staff / desktop (QA r612) · Victoria opens the
   Compliance Board to see "AML status for every counterparty on a live deal"
   · the Counterparties tab header counts the counterparties it found (3 in
   the fixture) while the sibling tab says 5 Live deals, and only 2 of those
   5 deals are reachable from any counterparty card — the other 3 are live
   deals with NO counterparty recorded, which is precisely the case an MLRO
   most needs to see. They are listed on the Live deals tab, so nothing is
   lost, but the counterparty view gives no hint that it is showing a
   subset.
   Suggestion: on the Counterparties view, add a plain line or amber card —
   "N live deals have no counterparty recorded" — linking to those deals, so
   the two tabs visibly account for the same deal book.

338. 2026-09-08 · BGP staff / desktop (QA r611) · Victoria looks at the
   Leasing Schedule Board to see which properties need attention · the board
   gives each property one amber "N expiring" badge and one board-wide
   "Expiring Soon" tile, and nothing at all for leases that have ALREADY
   lapsed — but open the property and its own header splits the same units
   into "Expiring <12m" AND "Expired" tiles. So a landlord with four dead
   leases and none expiring looks completely quiet from the board.
   Suggestion: give the board an "Expired" column/badge next to "Expiring",
   fed by the same per-property query, so the board and the property page
   count the same two things. (The board is flagged ARCHIVED/retired, so this
   may be worth doing only if it stays reachable.)

337. 2026-09-08 · BGP staff / ChatBGP (QA r611) · Victoria asks ChatBGP for
   leasing-schedule units by lease expiry · the `search_leasing_schedule`
   tool's only date filter is `expiringWithinMonths` — "within this many
   months from now", now correctly forward-only — so there is no way to ask
   it the other obvious question, "which leases have already lapsed?". Before
   r611 that question accidentally worked (the filter had no lower bound) but
   silently mixed live and dead leases into one answer.
   Suggestion: add an `expiredWithinMonths` (or an `includeExpired` boolean)
   to the same tool schema so the lapsed set is askable on purpose rather
   than by accident, and say in the description which side of today each
   filter covers.

336. 2026-09-08 · BGP staff / phone 390px (QA r610) · Victoria opens the diary
   on her phone to see today · above the day column sit the Day/Work week/Week
   switch, a CRM toggle, TEN team pills wrapping to three rows, and a full
   month grid — so the actual schedule for today starts roughly a screen and
   a half down, and on a day with a 09:00 meeting she scrolls to find it.
   Suggestion: on the phone shell collapse the team pills and the month grid
   behind one "Filters" / "Jump to date" disclosure (closed by default) and
   open on the day column. Same family as #17 (the tenancy header's eight
   stacked controls).

335. 2026-09-08 · BGP staff / phone 390px (QA r610) · Victoria glances at MY
   TASKS on the phone home to see what's landed on her · the card shows the
   title, a High chip and the linked deal/property/contact, but not WHO put
   the task on her — the /tasks page says "from Woody Bruce" and the home card
   does not. On a phone the home card is the one she actually reads.
   Suggestion: add the assigner as a sub-line on the mobile-home task card
   when `assigned_by_name` is set (it is already on the API payload), so a
   colleague's ask is distinguishable from her own to-do at a glance.

334. 2026-09-08 · BGP staff / phone 390px (QA r610) · Victoria adds a bakery's
   requirement from her phone and reads the summary tiles · the "most-wanted
   size" tile reported "1,000–3,000 sq ft most-wanted size (1 requirements)"
   for a requirement saved in the "2,000 - 3,500 sq ft" band — the tile's own
   buckets are not the bands the form offers, so the number it quotes back
   matches nothing the user chose. Plus "1 requirements".
   Suggestion: bucket the tile on the form's own size bands (so it can quote
   the band the user picked), and pluralise the count.

333. 2026-09-08 · BGP staff / phone 390px (QA r610) · Victoria checks the
   requirement she just saved on the requirements board · the card prints the
   brand name twice on consecutive lines ("Testco Bakery / Testco Bakery") —
   the requirement's own name and the linked company's name are both rendered
   and for a brand requirement they are the same string, which on a 390px
   card spends two of about eight visible lines saying one thing.
   Suggestion: render the second line only when it differs from the first
   (fall back to the company's category, which is what a reader actually
   wants there).

329. 2026-09-08 · Landsec client / phone 390px (QA r608) · Mark scans live
   deal activity on the Deals tab · the two deal cards label the same row
   "In status" but fill it two different ways — "today" on one and "35d in
   Exchanged" on the other, which repeats the status the chip beside the
   title already shows. On a 390px card that repetition costs the width that
   is truncating the deal names themselves ("U124 Bluewater — Gail's let…",
   "MSU3 Bluewater — Starbu…"). Suggestion: make the value the duration only
   ("today" / "35d"), and give the freed width back to the deal name so it
   wraps to two lines instead of truncating.

330. 2026-09-08 · Landsec client / phone 390px (QA r608) · Mark wants to drop
   a brand he self-added to his Brand CRM · there is no way to do it from
   anywhere he can see the brand. The hub tile has no remove control and
   neither does the brand profile; the only `DELETE /api/client/crm/add-brand`
   caller is the "Remove" button inside the **Add a brand** dialog
   (brands-hub.tsx:1592), which only appears once you type at least two
   characters of the brand's name into a search box labelled "Search all
   brands…". So removing is hidden inside adding. Suggestion: surface the
   same Remove on the hub tile (or the brand profile) for brands the client
   self-added — the endpoint and the `added` flag the dialog already reads
   are enough to render it.

331. 2026-09-08 · BGP staff / compliance (QA r609) · Layla runs the auto-KYC
   on a brand profile and it comes back clean · the brand's `kyc_status` goes
   to `approved`, but the notification bell keeps shouting "KYC not approved:
   <deal>" at *urgent* severity for every deal that brand is a counterparty
   on. The alert reads `crm_deals.kyc_approved`, and only the two manual MLRO
   endpoints (`aml-compliance.ts:820`/`:845`) call `recomputeDealKycApproved`
   — the auto-KYC writer (`companies-house.ts:952`) does not, so the flag
   stays false until somebody happens to save that deal (`crm.ts:3644`
   re-derives it on any PUT). Suggestion: call `recomputeDealKycApproved`
   from the auto-KYC path too, the same way approve/reject do — it is the
   contract the function's own comment states. Written up rather than landed
   this round because it changes when a compliance flag flips.

332. 2026-09-08 · BGP staff / compliance (QA r609) · a deal with a brand whose
   `kyc_status` reads `verified` will never pass the AML gate · the gate
   (`deal-gates.ts:54`) treats anything but `approved` as not ready, and
   reports the reason as the raw value, so the team is told "AML not
   complete: <brand> (verified)" — a sentence that reads like a
   contradiction. Nothing in the codebase writes `verified` any more (a
   reader was already fixed 2026-08-18), but the fixture still carries one
   row (Hammerson SubCo Ltd), so production data of the same vintage will
   too. Suggestion: a one-off normalise of the legacy values into the
   canonical set `pending | in_review | approved | rejected | expired`
   (+ `not_found`), and a CHECK constraint so a sixth value can't appear
   again. Not touched this round — it is a data migration, and the
   `verified` → `approved` mapping is a compliance judgement, not a QA one.

328. 2026-09-08 · BGP staff / ChatBGP (QA r607, target-2 schema sweep) · a
   user asks ChatBGP "which deals are under offer?" · the `query_wip` tool
   (server/chatbgp.ts:4448) advertises `status` as "Filter by status/stage
   e.g. Under Offer, Exchanged, Completed, New Instructions" but the handler
   (:8441 desktop, :12768 mobile) applies it to `group_name ILIKE`, a
   different column — and then buckets its own summary by the RAW code
   (`byStage[d.status]`), so the reply speaks in AVA/NEG/SOL. Two mismatches
   in one tool: the filter names one column and searches another, and the
   answer names the codes rather than the labels the team uses. Not fixed
   this round because it needs a decision, not a patch: on THIS tool, should
   `status` mean the deal status code (crm_deals.status) or the pipeline
   stage (group_name)? Suggestion: pick one, rename the other parameter
   (`stage`), and pass the summary through `dealStatusLabel` so ChatBGP says
   "Solicitors", not "SOL".

325. 2026-09-08 · Landsec client / desktop (QA r606) · Mark Warne prepping a
   Thursday asset-management meeting · his "Portfolio activity — BGP team"
   panel on My Tasks — headed "What the BGP team is working on across the
   portfolio — and what's been done" — reads "IN PROGRESS 0 · Nothing open
   right now" while the same login's dashboard shows 4 active deals and 73
   live lettings on his two centres. It is counting BGP *tasks* assigned
   against his portfolio, and BGP works those deals off the boards, not off
   task rows. To the landlord paying the fee the panel says his agents are
   idle. Suggestion: either feed it the live deals/lettings activity it
   promises, or retitle it to what it actually counts ("Tasks your BGP team
   has logged") and give the empty state a line that doesn't imply nothing
   is happening.

326. 2026-09-08 · Landsec client / desktop (QA r606) · same journey · the
   EXPIRING (6M) tile is the best thing on the client dashboard — 7 leases,
   soonest 15 Sept 26, one week out — and every row deep-links to the right
   centre's tenancy schedule. But it lands on the full 200-row board with no
   filter, so Mark arrives at the schedule and has to find Future 62 Ltd
   himself; the property name in the popover is truncated to
   "Bluewater Shopping Cen…" on a 1440px screen with room to spare.
   Suggestion: carry the unit through in the link (a search/filter param the
   board already supports) and let the popover row wrap or widen.

327. 2026-09-08 · Landsec client / desktop (QA r606) · same journey · the
   tenancy board's own header count (200 units) is one more than the
   dashboard's total for the same centre (199 of the portfolio's 201),
   because the board projects Letting Tracker units with no tenancy row onto
   the spine and the dashboard counts tenancy rows only. r606 made the board
   internally consistent (its tiles now account for all 200), but the two
   surfaces still disagree by the projections. Related to the open
   vacancy-basis question (#290/#286/#295) — same root: which table is "the
   units" on this property. Suggestion: settle one basis and label it on
   both surfaces, as was done for the occupancy tiles.
   · r607 pinned the two queries so the decision is a one-liner. **199** =
   `GET /api/company-portfolio/:companyId` (server/routes.ts:8069) —
   `SELECT COUNT(*) FROM tenancy_schedule_units WHERE property_id = ANY($1)`,
   the spine and nothing else. **200** = `GET /api/tenancy-schedule/:id`
   (server/tenancy-schedule.ts:118) — the same spine rows PLUS one row per
   Letting Tracker unit whose unit_name matches no spine row
   (`available_units … NOT EXISTS (tenancy_schedule_units …)`), de-duped on
   the normalised name. Measured on the fixture today: Bluewater spine 199,
   projections 1, board 200. So the choice is exactly: does an unmatched
   Letting Tracker unit count as a unit of the property (200) or not (199)?
   Whichever Woody picks, the OTHER surface is the one-line change.

324. 2026-09-08 · BGP staff / ChatBGP (QA r605, triage of #304) · Woody tells
   ChatBGP "put the Croydon purchase on hold" · the tracker's own tool schema
   (server/chatbgp.ts, create_ and update_investment_tracker) advertised
   "On Hold" as an example status and wrote it to the column verbatim — but
   "On Hold" is not one of the ten investment codes and `legacyToCode` has no
   mapping for it, so the row rendered as "Reporting" and counted in the
   Reporting tile while sitting in a stage nobody can see. r605 fixed the
   filter half (the tile that counts a row now shows it) and pointed the two
   tool descriptions at the canonical ten. What is NOT fixed: there is no
   "On Hold" stage at all, and the team clearly wants one — it was written
   into the AI's own vocabulary. Suggestion: decide whether "On Hold" earns a
   real code (paused, still live, excluded from WIP) or whether the answer is
   Withdrawn plus a note; today the phrase is accepted and quietly loses the
   asset's real position.

321. 2026-09-08 · BGP staff / desktop 1440px (QA r604, Victoria) · a new
   requirement comes in and she opens New Deal to get it on the board · the
   form asks for Property, Deal Type, Landlord, Tenant, Deal Name, BGP
   Contact, Headline Rent, % Agency fee, Total fee, BGP fee split, Timing for
   completion, Invoicing email, PO number and Comments — and the ONLY
   required field that lives below the fold is "Timing for completion". Press
   Create Deal with everything else filled and nothing visible happens: the
   button does nothing, the page scrolls, and the only explanation is the
   browser's own native "Please fill out this field" bubble, which looks
   nothing like the app's own red toasts (every other missing field — no
   landlord, no tenant, no unit — gets a proper destructive toast).
   Suggestion: validate targetDate in the same submit guard as the others and
   toast "Timing for completion required — it drives the WIP report bucket",
   so all the create-deal failures speak with one voice.

322. 2026-09-08 · BGP staff / desktop 1440px (QA r604, Victoria) · she opens
   the Targeting Brief on a Letting Tracker unit to write the client's
   instruction · the dialog opens completely empty with only "Draft with AI"
   and "Upload client brief (AI extract)" offered; there is no Save button at
   all until you have typed something, and no "Generate brief document"
   button until the brief has been saved once. Both are correct, but a
   first-time user reads the empty toolbar as "this screen is broken / I have
   to use AI". Suggestion: show "Create brief" disabled from the start with a
   hint ("type a title to start"), and show "Generate brief document" greyed
   with "save the brief first" rather than hiding both.

323. 2026-09-08 · BGP staff / desktop 1440px (QA r604, Victoria) · she picks
   the tenant on a new deal and wants to see the counterparty on the board ·
   the deal lands correctly, but the list row reads "#1038 Bluewater Shopping
   Centre / British Land Rival / No Xero contact / Lease Acquisition /
   Solicitors / Honi Poke" — the deal's own NAME ("Honi Poke – Bluewater
   Shopping Centre"), which the dialog auto-composed and which is the only
   thing she typed nothing into, is not a column on the schedule at all. She
   has to reconstruct the deal from four separate cells. Suggestion: lead the
   row with the deal name (property + counterparty are already its parts),
   the way the global-search fix at r229 did for search results.

318. 2026-09-07 · BGP staff / phone 390px (QA r602, Victoria) · a tenant rep
   rings about a unit; she opens the Letting Tracker on her phone and scans
   for it · each unit card carries ONLY the unit name, the scheme and the
   status chip, then five action words (Files / Viewing / Offer / Interest /
   Edit). No size, no quoting rent, no available date, no agent, no tenant in
   negotiation — 76 cards that differ by name alone, so finding the right one
   means searching for a name she has to already know. The card body is also
   inert: only the five action words respond to a tap (same family as #311).
   Suggestion: put one facts line on the card (sq ft · quoting rent ·
   available date, or the tenant name once a deal is on it), and make the
   card body open the unit's Edit sheet so the whole card is the target.

319. 2026-09-07 · BGP staff / phone 390px (QA r602) · reaching the Letting
   Tracker at all · staff get there by Deals tab → "Letting Tracker" toggle,
   which works — but the phone HOME's quick links are Deals / Expenses /
   Images / CRM and its board grid is Brand Intelligence / Comps / SharePoint
   / Property Intelligence, so the tracker is nowhere on the home screen. The
   CLIENT (Landsec) phone home, by contrast, leads with a "My portfolio —
   letting tracker" roll-up tile (Available / Under offer / Let counts) AND a
   Tracker quick link (`mobile-home.tsx:174`). For a leasing agency the
   tracker is the daily board; the landlord gets a better door to it than the
   agent does. Suggestion: add Tracker to the staff QUICK_LINKS (Expenses is
   already one tap away via the Boards row / My Card), or give staff the same
   roll-up tile counting their own team's units.

320. 2026-09-07 · BGP staff / phone 390px (QA r602, code read during the
   journey) · `client/src/components/mobile-app.tsx` contains a whole phone
   "More" tab — Letting/Investment tracker (with My Invoiced / My WIP tiles,
   status filter dropdown, per-unit viewings + offers sheets), Reqs, News and
   Docs sub-tabs, roughly a thousand lines gated on `tab === "menu"` — that
   NOTHING can reach: `setTab` is only ever called with "chats" or "ai", and
   no route mounts `MobileApp initialTab="menu"` (App.tsx mounts "ai" and
   "chats" only). It is a SECOND tracker implementation, invisible and
   un-QA'd, that will silently drift from `/available`. Suggestion: decide
   and act — either wire the tab back into the chat shell, or delete the
   dead branch and its queries so there is one phone tracker to maintain.
   **r603 PROVED IT UNREACHABLE, and found it already rotten.** Reachability:
   `App.tsx` mounts `MobileApp` at exactly two places (`:554` initialTab="ai",
   `:562` initialTab="chats"); `setTab` has four call sites and can only
   produce "chats", "ai" or `returnTabRef.current`, and `returnTabRef` is
   *typed* `useRef<"chats" | "ai">` (`:3961`) — so no code path exists that
   sets "menu". `mobile-bottom-nav.tsx` has no More/menu item on either the
   staff or the client nav. Dead surface: **863 lines of JSX** (the More tab
   `:4523-4981`, the deal drawer `:5090-5308`, the unit drawer `:5311-5493` —
   the drawers only ever open from `setSelectedDealId`/`setSelectedUnitId` at
   `:4748`/`:4783`, both inside the dead tab), plus ~10 queries and a news
   DELETE mutation gated on `tab === "menu"`, plus its own state and colour
   maps: ~1000 lines all told. Nothing leaks: every data query is gated too,
   so no wasted requests. **The drift has already happened.** Its two status
   maps (`:3725` `investmentStatusColors`, `:3735` `lettingStatusColors`) are
   keyed by LABELS — "Available", "Under Offer", "Let", "Let Agreed" — but the
   rows they colour carry CODES (`item.marketingStatus`, `LETTING_STATUSES` =
   OPP/AVA/NEG/HOT/SOL/EXC/COM/WIT/INV), so every chip would fall through to
   the grey default and print the raw code, and the status-filter chips and
   dropdown would list codes. That is exactly the bug r602 fixed everywhere a
   user can see — this copy never got it, because nobody can see it. The live
   `/available` tracker normalises through `legacyToCode` +
   `DEAL_STATUS_LABELS`/`DEAL_PIPELINE_LABELS` (available-units.tsx:62-70).
   Deleting ~1000 lines is Woody's call, so r603 changed nothing here.

316. 2026-09-07 · BGP staff / any PDF the app emails out (QA r601) · Woody
   opens a Heads of Terms or a weekly update to check it before it goes ·
   Every generator writes the SAME footer through its own hand-rolled
   `bufferedPageRange` loop, at its own hardcoded y (810 / 776 /
   `height - 46`), with its own margin-zeroing workaround — and r601 found
   FIVE of the seven loops missing that workaround, so five document types
   shipped a spurious blank page for years while `deal-report.ts` alone was
   correct. Suggestion: one `stampPageFooters(doc, textFor)` helper in a
   shared module that does the margin dance once and takes the footer text
   as a callback; every generator calls it and no future generator can get
   the y or the margin wrong. (Fixing all seven doors was r601's work; this
   is the de-duplication that stops the eighth.)

317. 2026-09-07 · BGP staff / deal audit trail (QA r601) · a BGP agent asks
   "who changed the owner of this deal?" · r601 closed the door that let a
   CLIENT write `team` / `internalAgent` on their own deal, and the strip is
   silent — the client's PUT still returns 200 and the field simply doesn't
   move. That is the right behaviour for the fee fields it sits beside (a
   client should not learn that fees exist by being refused), but ownership
   is different: if a client's Deals table still SHOWS those two chips as
   editable-looking, they will keep trying and keep seeing nothing happen.
   Suggestion: render BGP Team and Internal Agent as plain read-only text
   (no chip affordance) in the client shell's deal drawer, the same way
   r534 did the party pickers. Woody's remaining #171 question stands
   separately: should DEAL STATUS and DEAL TYPE be the client's to set at
   all, or BGP's alone?

310. 2026-09-07 · Landsec client / phone 390px (QA r600, Mark Warne) · the
   Messages tab carried an unread badge ("1", later "2"); tapping it landed on
   the ALL chip, which read **"No conversations yet"**. ALL is people-only by
   decision (Woody 2026-08-20), but the badge counts every unseen thread
   membership including AI/ChatBGP threads, so the number and the screen
   disagreed. The Unread chip now carries those threads (fixed this round),
   but the badge still lands on ALL. Suggestion: when ALL would be empty and
   the unread count is non-zero, open Messages on the **Unread** chip — or
   show a one-line "2 unread in ChatBGP chats" row above the pinned ChatBGP
   entry so the number always has somewhere to go.

311. 2026-09-07 · Landsec client / phone 390px (QA r600) · in the CRM hub's
   Brand Directory, tapping a brand CARD does nothing — only the brand-name
   text (a ~16px-tall line) is a link (`people.tsx:1290`). On a phone, "I
   tapped Amorino and nothing happened" reads as the app being broken.
   Suggestion: make the whole card navigate to `/companies/:id`, with
   `stopPropagation` on the inner contact link, edit pencil and "Add contact"
   controls so those keep working.

312. 2026-09-07 · Landsec client / phone 390px (QA r600) · the primary write
   control on `/tasks` — the inline "Add a task… press Enter" input — measures
   **32px tall** at 390px, under docs/DESIGN.md's 44px phone tap-target
   minimum (it is an input, so the `rounded-full` button exemption doesn't
   apply). The task write itself worked (1 open → 2 open, "Task created"
   toast). Suggestion: bring it to h-11 on phone widths when that screen is
   next touched.

313. 2026-09-07 · Landsec client / phone 390px (QA r600) · on `/deals` the
   deal cards read "In status" over "35d in Exchanged" — label and value both
   say "in status", and the sibling card reads "In status / today". Suggestion:
   keep the label and make the value bare ("35d", "today").

314. 2026-09-07 · Landsec client / phone 390px (QA r600) · "Portfolio
   activity" — the tier panel a landlord would use to ask "what is this brand
   doing across my centres" — sits ONLY under the **Intel** pill on the phone
   brand profile (`mobile-brand-view.tsx:391`, inside `sec("intel")`). Intel
   is where the expansion score and requirements live; a landlord hunting for
   tenancies/targets/pitches would not guess it. Suggestion: either rename the
   pill (Intel → "Activity & intel") or put the three tier counts (Tenant at /
   Targeted / Pitched) as a one-line strip under the header so the panel
   advertises itself.

315. 2026-09-07 · Landsec client / phone 390px (QA r600) · corroborates
   **#308 from the client's own screen**: Testco Ramen's Portfolio activity
   shows "TENANT AT 1 · Westgate Test Centre" with the green tenant badge
   reading **"New Letting"** — i.e. a live DEAL, not a tenancy, presented to
   the landlord as a sitting tenant. Same judgement call as #308; noting it
   is visible to clients, not just staff.

308. 2026-09-07 · BGP staff (QA r599, code read — the label-kind sweep) ·
   the brand profile's "Portfolio activity" panel promises three HONEST
   tiers, and its top tier "Tenant at" (green badge) is fed by the leasing
   schedule UNIONED with every crm_deals row for that brand that is not
   withdrawn (server/crm.ts:4677). So a deal at AVA, NEG, HOT, SOL or EXC —
   i.e. a brand BGP is still negotiating with — renders under "Tenant at"
   with a green tenant badge and the deal type as its label. That reads as
   "they already trade here" on the exact panel a pitch is built from.
   (The withdrawn ones were a straight bug and are fixed; the in-flight ones
   are a judgement call.) Suggestion: keep only COM/INV deals in "Tenant at"
   and move the live stages into the "Pitched — with evidence" tier they
   already have, each carrying its status ("Solicitors", "HOTs") as the
   evidence line. Needs Woody's call — "tenant at" may be deliberate shorthand
   for "we have something going here".

309. 2026-09-07 · BGP staff / desktop (QA r599, code read) · the per-requirement
   "Matching Available Units" dialog badges every row with a two-value
   ternary — `marketingStatus === "NEG" ? "Under offer" : "Available"`
   (client/src/pages/requirements.tsx:1352). It is CORRECT today only because
   the endpoint behind it hardcodes `marketing_status IN ('AVA','NEG')`
   (server/crm.ts:4950 and :4993). The moment anyone widens that pool — the
   obvious next ask is showing HOT units so the team can see what is nearly
   gone — every non-NEG unit silently reads "Available", including one at
   HOTs or solicitors. This is the r597 `|| "Available"` shape waiting to
   happen, one edit away in a different file from the one that would be
   edited. Suggestion: render the badge from the shared vocabulary
   (`DEAL_STATUS_LABELS[legacyToCode(unit.marketingStatus)]`) so the dialog
   tracks whatever the pool holds, and drop the coupling entirely.

306. 2026-09-07 · Landsec client / desktop 1440px (QA r598) · Mark Warne
   prepping for Monday's leasing meeting opened Requirements from his own
   nav, expecting "who is looking for space in my centres" · the page loads
   clean and says "0 active requirements / No active requirements found".
   That is CORRECT for the fixture and by design: a client sees only
   requirements scoped to their own company plus ones sourced from PIPnet
   (server/crm.ts:5013) — manually-entered BGP requirements stay hidden. But
   the fixture holds one requirement and neither condition can ever match it,
   so for a landlord client this nav item is a permanently empty screen with
   no explanation of WHY it is empty. Suggestion: give the client's empty
   state a sentence that says what would appear here ("Occupier requirements
   BGP imports from PIPnet, plus anything logged against Landsec — ask your
   BGP team to share a requirement"), the way /api/client/sharepoint/root's
   404 already degrades to "ask your BGP team". Same treatment for Brand
   Intelligence's "Active Requirements Radar — 0 brands searching", which
   reads as a data gap rather than a scoping rule.

307. 2026-09-07 · Landsec client / desktop 1440px (QA r598) · after adding
   Priya Raman to his own CRM (the round's write — worked end to end, card
   drew instantly, survived a reload, landed on Landsec) Mark had no way to
   tell BGP she is now the leasing contact · the client CRM hub's Add/Edit
   contact dialog saves silently: no toast, and nothing on the BGP side is
   notified, so a contact the client adds sits in the CRM until a BGP person
   happens to open that company. Suggestion: (a) a success toast on the
   client contact save — the same gap as UX #291 on the property focus-task
   write, so worth doing as one change; (b) consider a light notification to
   the client's BGP team lead when a client adds or amends a contact at their
   own company, since a new named leasing contact is exactly the thing the
   team wants to know about before the next meeting.

304. 2026-09-07 · BGP staff / desktop (QA r597, triage) · Woody or Nick
   adding an investment asset, then clicking a stage pill on
   /investment-tracker to see what is in that stage · the page bridges the
   column's legacy free-text values through `legacyToCode(x) || "REP"` at
   six call sites — tiles, sort, cards, table, edit form, board mapping — but
   the FILTER at investment-tracker.tsx:1198 is the one that drops the
   fallback: `list.filter(u => legacyToCode(u.status) === statusFilter)`.
   Today no row diverges (the column holds Live 56 · AVA 49 · COM 7 ·
   SPEC 6 · SOL 1, and all five resolve), so nothing is visibly wrong. But
   the day a row carries a status `legacyToCode` does not know — or NULL,
   which the column permits — the REP tile will COUNT it and clicking that
   tile will HIDE it: the r556 tiles-vs-filter drift, pre-loaded. Suggestion:
   give :1198 the same `|| "REP"` its six siblings have, so the pill that
   counts a row is the pill that shows it. One-line change, no behaviour
   change today.

305. 2026-09-07 · (QA r597, sweep) · the schema default
   `investment_tracker.status = "Reporting"` is a free-text LABEL on a column
   whose other values are codes — a fourth vocabulary member that exists only
   because a default supplies it (lesson 13). It is bridged on read
   everywhere on the tracker page, so it is NOT a bug today, and two ChatBGP
   creators deliberately pass the same string. But it means an asset created
   with no status is the only row on the board whose stored value is not
   what the UI would write back if you edited it (the edit form posts REP).
   Suggestion: change the default to `"REP"` in the same migration that
   fixes `available_units.marketing_status` (the deferred `'Available'::text`
   default), so the two codes-ish columns stop defaulting to labels together.

302. 2026-09-07 · BGP staff / desktop 1440px (QA r596, journey) · Victoria
   logging a comparable at Bluewater to support a quote, then opening the
   Bluewater property page to see the evidence in context · the comp she just
   created carries `propertyId` = Bluewater (the create dialog's typeahead
   links it, and shows "Linked to BGP property" in green), but the property
   page has **no comparable-evidence section at all** — 74,748 characters of
   page and not one comp. To read her own evidence back she has to leave the
   scheme, go to /comps and search for it. The link is stored and never used.
   → SUGGESTION: a small "Comparable evidence" card on the property page
   listing comps where `propertyId` matches (name · tenant · date · headline
   rent · net effective), each row deep-linking to /comps/:id. Same data the
   comps board already returns; no new endpoint beyond a `propertyId` filter.

303. 2026-09-07 · BGP staff / desktop 1440px (QA r596, journey) · Victoria
   creating a comp from an agent's confirmation · the create dialog collects
   Property, Tenant, Area, Use Class, Transaction Type, Headline Rent, Zone A
   and Date — and **nothing about the lease**: no term, no rent-free, no floor
   area. But the server devalues every comp on read, so the row came straight
   back carrying `devaluation: { netEffectiveRentPa: 92500, termCertainYears:
   5, rentFreeMonths: 0, note: "5 yr term certain · term assumed 5 yrs" }`.
   The note is honest, but the board then shows that assumed-term net
   effective in the same column as comps devalued from real terms, and the
   "Net Effective Rent" column is what goes into the client export. She was
   never asked for the numbers that would have made it real.
   → SUGGESTION: add Term (yrs), Rent free (mths) and Floor area (sq ft) to
   the create dialog — three inputs beside the two rent fields — and, where
   the term really is assumed, mark that cell on the board and in the CSV
   ("£92,500 pa *assumed 5yr") rather than only in the devaluation note.

300. 2026-09-07 · BGP staff / desktop (QA r595, triage) · Victoria opening
   /comps to find rent-review evidence · the board reads **"0 comps · 0
   verified · 0 areas"** and the empty state says **"No matching comps — Try
   adjusting your filters"**, while the strip immediately above it says "11 AI
   leads awaiting review". Nothing is wrong with her filters: every comp the
   firm holds is an unconfirmed AI extraction sitting on the Leads tab, and
   the empty state sends her to fiddle with filters instead. (The CLIENT
   version of the same screen gets this right — "No comparable evidence
   recorded for your schemes yet. Your BGP team adds comps as deals
   complete.") Suggestion: when `confirmedComps` is empty but `leadComps`
   is not, swap the empty state for "Nothing confirmed yet — 11 AI leads are
   waiting for review" with the existing Leads-tab button, and stop offering
   the filter advice. One conditional in comps.tsx.

301. 2026-09-07 · BGP admin / desktop (QA r595, triage) · running Letting
   Tracker → Focus (`POST /api/admin/letting-tracker-focus`) · on the QA
   fixture the dry run reports `scanned 76 · keep 6 · prune 70 · pullIn 2`
   and hands back a **12-name `pruneSample`** for 70 deletions. Sixty-four of
   the units about to be deleted are never named anywhere before the run
   commits. Same family as #297: a destructive admin action that will not
   itemise what it removes. Suggestion: return the FULL prune list (it is
   only unit + scheme names) and put it behind a scrollable confirm with a
   "download list" — or at minimum say "…and 58 more" so the operator knows
   the sample is a sample.

298. 2026-09-07 · BGP staff / mobile 390px (QA r594) · Victoria logging a
   verbal offer on a Bluewater unit from her phone, thumb-typing the tenant's
   name into the Company picker · she typed "Honi" and the panel put
   **Create company "Honi"** in the FIRST row, with the actual match
   "Honi Poke" second. The obvious thumb action created a DUPLICATE company
   record — which is exactly what happened in this round's journey, and only
   the DB read caught it (the offer then hung off a brand-new empty "Honi"
   instead of Honi Poke). `EntityCombobox` suppresses the create row only on
   an EXACT label match, so any partial-but-unambiguous type-ahead ranks
   "create a new one" above the record you were looking for. Suggestion: move
   the create row BELOW the matching items (it keeps its green pill, so it is
   still findable), or hide it entirely while at least one item matches the
   search and only offer it from the empty state. Highest value on the phone,
   where the list is one thumb-width from the keyboard.

299. 2026-09-07 · BGP staff / mobile 390px (QA r594) · Victoria took an offer
   at the unit — £62,500 p.a., 10 years, Year 5 break, 9 months rent free —
   then opened the deal behind that unit to move it on · the deal
   ("Bluewater MSU9 letting", NEG) shows **"Tenant not set"** and a
   "Link tenant" prompt, and nothing of the offer anywhere on it: no rent, no
   term, no offeror, no hint that an offer exists. The two records live one
   tap apart on the tracker card and neither knows about the other, so the
   figures she just typed have to be re-typed onto the deal by hand.
   Suggestion: a "Latest offer" line on the deal Overview (offeror · rent ·
   term · date, linking back to the unit's Offers dialog) with a one-tap
   "make this the tenant" that fills the tenant from the offer's company.
   Cheap, and it closes the loop the phone journey walks every time.

296. 2026-09-07 · BGP staff / API-level (QA r593) · an agent deletes a unit
   from the Letting Tracker and later re-lists it · the listing comes back at
   the next restart under a name no one typed — "Bluewater Shopping Centre –
   MSU9" — because the boot auto-seed (routes.ts ~7676) names a resurrected
   listing after its backing DEAL, and the deal was named "<Scheme> – <Unit>"
   when the unit was first added. On a board where every other card reads
   "MSU9", that row reads as a different unit, and the scheme name is repeated
   in a column that is already inside that scheme's page. (r593 fixed the
   DEDUPE hole this opened — the unit is no longer listed twice — but the odd
   name is still what the agent sees.) · SUGGESTION: have the auto-seed name
   the listing from the unit rather than the deal — strip the scheme prefix
   the same way `unitNameKey` (server/unit-mirror.ts) already does — so a
   resurrected row looks like every other row on the board. Cheap, and it
   retires one of the three name conventions in UX #293.

297. 2026-09-07 · BGP staff / API-level (QA r593) · staff deletes a scheme
   from Properties · the delete cascade (`storage.deleteCrmProperty`) clears
   the rent roll and both projections, but says nothing about what else goes,
   and it leaves the scheme's INVESTMENT position behind entirely — the
   Investment Tracker card, its viewings, offers and distributions survive
   with a property_id pointing at a row that no longer exists (see the r593
   log entry: all 119 fixture tracker rows are already in that state) · 
   SUGGESTION: make the confirm dialog itemise what the delete will remove
   ("3 units on the Letting Tracker, 12 tenancy rows, 1 investment position
   with 4 viewings and 2 offers") and let staff see the investment side
   before they commit. Whether the investment position should be deleted,
   kept, or block the delete is Woody's call — but silently stranding it is
   the one option nobody would choose.

294. 2026-09-07 · Landsec client / mobile 390px (QA r592) · an operator
   stopped Mark in the mall at Bluewater; on his phone he typed their name
   into the search box at the top of /brands to see what BGP already knew ·
   the quick-search only looks inside his own CRM, so it answered "No matches
   for 'Jewel' — try a shorter name". The brand DOES exist — it's just outside
   his hospitality/leisure/fitness slice — and the advice is wrong: no shorter
   name would ever find it. Nothing in that empty state points at the "Add
   brand" button that searches the wider directory, so the only way through is
   to already know the two-step dance. Once added, the same search finds it
   instantly · SUGGESTION: when the quick-search returns nothing from the
   client's own CRM, run the same term against /api/client/crm/global-brands
   and render the hits under a second heading ("Not in your CRM — tap to add"),
   each with the inline Add button from the dialog. Same two endpoints, one
   step instead of three, and the "try a shorter name" line only shows when
   the directory is genuinely empty too.

295. 2026-09-07 · Landsec client / mobile 390px (QA r592) · Mark wanted the
   occupancy position on one scheme and opened both boards Bluewater offers ·
   /leasing-schedule/:id reports "165 Total Units · 88 Occupied · 76 Vacant"
   while /tenancy-schedule/:id reports "199 units · Occupied 124 · Vacant 75"
   for the same centre on the same day. Both are internally consistent (the
   leasing board is a strategy board over a 165-row subset), but nothing on
   either says so — and the leasing board's own strapline reads "Unit facts
   (tenant, rent, dates) pull live from the Tenancy Schedule", which the
   route only does for tenant name and the three lease dates, not rent or
   status. On a phone the two boards can't be put side by side, so a landlord
   reads them as a contradiction · SUGGESTION: the leasing board is already
   badged ARCHIVED — either drop its Occupied/Vacant tiles altogether (the
   Tenancy Schedule is the occupancy source of record) or label them with
   their basis ("88 of the 165 strategy rows"), and trim the strapline to the
   fields it actually joins live.

292. 2026-09-07 · BGP staff / desktop (QA r591) · an agent removing a unit
   from the Letting Tracker · `DELETE /api/available-units/:id` takes the
   tracker card away, but the two rows the CREATE spawned on its behalf stay:
   the property's leasing-schedule row and the auto-created backing CRM deal
   (named "<Scheme> – <Unit>"). The deal is the worse half — a boot hook
   re-materialises a tracker listing from any deal with no listing, so the
   unit the agent deleted REAPPEARS on the Letting Tracker after the next
   restart, with a new id and an en-dash scheme prefix in its name. This is
   the "something re-creates the row at boot" r590 was chasing.
   Suggestion: make the delete dialog say what else is attached ("this unit
   also has a leasing-schedule row and a linked deal") and offer to remove
   them, or at minimum stop the boot hook resurrecting a listing for a deal
   whose only listing was deliberately deleted. Not blind-fixed: whether a
   deal should outlive its listing is a data-model call for Woody.

293. 2026-09-07 · BGP staff / desktop (QA r591) · same unit, two names ·
   the app writes a unit's name three different ways depending on the door:
   bare ("U062"), comma-joined with the scheme ("MSU9, Bluewater,
   Bluewater"), and en-dash-prefixed ("Bluewater Shopping Centre – U062")
   when the boot hook derives it from a deal name. Every guard, dedupe and
   count that matches units BY NAME then has to guess which convention it
   is looking at — UX #289's one-live-listing guard compares COMMA segments
   and sails straight past the en-dash form, and r590's duplicate collapse
   needed its own normaliser. Suggestion: normalise unit names at one write
   boundary (scheme stored as a field, never inside `unit_name`) so the
   name-matching guards have a single shape to match. Structural, so filed
   rather than fixed.

290. 2026-09-07 · Landsec client / desktop (QA r590) · Mark Warne pulling
   Bluewater's vacancy together for a board paper · three surfaces in one
   sitting gave him three different vacancy numbers, none of them labelled
   with its basis. Client dashboard: "TOTAL UNITS 201 / 124 occupied · 77
   vacant · full rent roll" (self-consistent, 124+77=201). Tenancy Schedule
   for the same property: "201 units", "OCCUPIED 124", "VACANT 76" — which
   is 200, one short of its own header. Property page risk register: "76
   units vacant with no active deal". The dashboard looks to be deriving
   vacant as total-minus-occupied while the schedule counts vacant rows
   directly, so any row that is neither lands in the dashboard's vacant
   figure and nowhere in the schedule's. SUGGESTION: make one of them the
   source (count both states directly and show the remainder explicitly —
   "201 units · 124 occupied · 76 vacant · 1 unclassified"), and label the
   basis on each tile as r571 did for the leasing/tenancy denominators
   (see #286). A board paper cannot quote a figure whose own page does not
   add up.

291. 2026-09-07 · Landsec client / desktop (QA r590) · Mark adding a focus
   task on the Bluewater property page ("Board paper: confirm U062 marketing
   status with BGP") · the write worked — POST /api/tasks 200, the row
   appeared under THIS WEEK'S FOCUS, survived a reload and turned up on My
   Tasks — but nothing confirmed it: no toast, and the input clears the
   instant the row draws, so on a slow render the two are momentarily
   indistinguishable from the text having been dropped. Every other write in
   the client shell toasts. SUGGESTION: toast "Task added to Bluewater
   Shopping Centre" on success (and, per lesson 8, toast the failure loudly
   if the POST does not return 2xx — right now a failed task write would
   look identical to a successful one that has not re-rendered yet).

288. 2026-09-07 · BGP staff / any surface (QA r589) · Victoria clicking
   "Send to Letting Tracker" on a vacant tenancy row that is ALREADY on the
   tracker · she gets the toast "On the Letting Tracker — Listing created and
   linked back to this tenancy row", which is not what happened: the server's
   one-live-listing-per-unit guard returned the EXISTING listing and created
   nothing. Unlike the Add-Unit dialog (fixed this round), this caller
   (`sendToTrackerMutation`, client/src/components/PropertyTenancySchedule.tsx:774)
   does not read the response at all, so it cannot tell the two cases apart.
   SUGGESTION: read `alreadyListed` off the response here too and say
   "Already on the tracker" instead — same wording as the Add-Unit dialog, so
   the two paths agree. Cheap, and it stops her hunting for a second listing
   she believes she just made.

289. 2026-09-07 · BGP staff / desktop (QA r589) · re-adding a unit to the
   tracker under a name the tracker already stores in a longer form · the
   "one live listing per unit" guard (Woody, 2026-08-04 — "sort the double
   counting") compares the FIRST COMMA SEGMENT of the posted name against the
   first comma segment of the STORED `unit_name`. But some add paths store
   the name PREFIXED with the scheme ("Bluewater Shopping Centre – QA-…",
   observed live this round), and the prefix is joined with an en dash, not a
   comma — so the segments never match and the guard sails past. The unit can
   then be double-listed, which is the exact thing the guard exists to stop.
   SUGGESTION: normalise both sides before comparing — strip a leading
   "<property name> –/-/:" prefix as well as splitting on the comma — or stop
   prefixing the scheme name into `unit_name` on write and let the UI compose
   the display label (the phone card already strips it back off).

286. 2026-09-07 · BGP staff / desktop 1440px (QA r588) · Victoria reading a
   property page to tell a landlord where his scheme stands · the SAME page
   prints two different vacancy rates from two different unit boards, one
   above the other. The PIPELINE & PERFORMANCE card says "VACANCY 46.3% ·
   76 of 164 units" (leasing_schedule_units, status='Occupied' exactly — a
   denominator r571 chose deliberately so the client brief agrees with the
   leasing board's own pills). The Tenancy Schedule card immediately below
   says "200 units · OCCUPIED 124 · VACANT 76" — the same 76 vacant over a
   200-unit denominator, i.e. 38%. Both are internally right; the page never
   says which board each is counting, and the app's own Data linkage panel
   calls the tenancy schedule "TENANCY SCHEDULE (SPINE)", so a reader would
   assume 200 is the authoritative unit count and 46.3% is wrong.
   Suggestion: label the basis on the funnel card the way the 2026-08-08
   occupancy fix labelled the dashboard tiles ("board units only" vs "full
   rent roll") — the numbers can stay as they are, the ambiguity is the bug.
   NOT a blind fix: choosing one denominator is a vocabulary decision for
   Woody, and r571 already made a deliberate call on the client-facing side.

287. 2026-09-07 · BGP staff / desktop 1440px (QA r588) · adding a released
   unit to the Letting Tracker and setting the fee split in the same dialog ·
   the fee editor auto-inserts a locked "BGP House 15%" row, so the split it
   posts totals 15% until an agent row is given a percentage — and the
   server (correctly) refuses any percentage split that does not sum to 100%.
   The dialog shows "Equal split (each 85.0%)" as a helper but nothing warns
   that the split as it stands will be rejected, and Save is not blocked.
   r588 fixed the silent part (the failure toast was being evicted — see the
   round log), so she is now TOLD; but she is told after the unit is already
   created, and has to reopen the deal to fix it. Suggestion: surface the
   editor's own `staffPctIsBalanced` state in the dialog (an inline
   "85% still unallocated" line) and either disable Save or skip the doomed
   PUT while the split is unbalanced. Not implemented — needs Woody's call on
   whether Save should be blocked or just warned.

284. 2026-09-07 · Landsec client + BGP staff / desktop (QA r587) · reading the
   PIPELINE & PERFORMANCE funnel on a property, drilling into the HOTS
   lozenge to see what is about to sign · the drilldown lists un-dealed
   letting units with the RAW STATUS CODE as the sub-line — the row reads
   "BWREST Portakabin Bluewater / HOT" where every other surface in the app
   says "HOTs" (DEAL_STATUS_LABELS already has HOT -> "HOTs"). Rows that came
   from a crm_deals row show a tenant name and stage label instead, so the
   two kinds of row in one list are formatted differently and the unit rows
   look like a data leak. Same raw-code habit as the deferred
   chatbgp.ts:2101 / property-asset-brief.ts:607 pair, but this one is on a
   RENDERED, client-visible surface, which is why it is worth a number.
   Suggestion: run the sub-line through DEAL_STATUS_LABELS, and prefix the
   unit rows ("Unit · MSU9") so a landlord can tell an un-dealed tracker unit
   from a live deal at a glance.

285. 2026-09-07 · BGP staff / any surface (QA r587) · trusting the asset-brief
   funnel as the count of what is transacting · the funnel silently folds
   only SOME of a unit's possible statuses into buckets: this round found HOT
   in neither arm (fixed), and OPP is still in neither — an OPP unit with no
   deal row is counted in no bucket, exactly as HOT was. That is not itself a
   bug (an opportunity arguably pre-dates the funnel) but the failure MODE is
   the problem: a status that nobody maps just vanishes from the total, with
   no "N units not in a stage" remainder to notice it by. The bug survived
   from 2026-08-04 to now for precisely that reason. Suggestion: derive the
   fold from LETTING_STATUSES so every code must be assigned a bucket or
   explicitly excluded, and render an "N units not in a stage" footnote under
   the funnel so an unmapped status is visible instead of invisible.

281. 2026-09-07 · BGP staff / mobile 390px (QA r586) · Victoria just out of a
    viewing at Bluewater, logging it from the unit card's "Viewing" action ·
    the manual viewing form accepted a byte-identical second viewing on the
    same unit — same date, same time, same attendees, same notes, same
    outcome — with no warning and no merge, and the card counter went to
    "(2)". The diary sync path dedupes properly (on iCalUId, covered by the
    smoke suite); only the hand-typed path has no guard. On a phone, where a
    save that looks like it didn't land is the normal reason to tap again,
    this is the easy mistake to make · Suggested: when the form is submitted
    with the same unit + date + time (or the same attendees) as an existing
    viewing, ask "you already logged a viewing at 14:30 today — add another,
    or edit that one?" rather than silently creating a twin.

282. 2026-09-07 · BGP staff / mobile 390px (QA r586) · same journey, chasing
    the next step: Victoria types the follow-up into the Tasks quick-add box
    ("send MSU9 Bluewater floor plans + rent quote by Friday") · it saves
    fine and survives a reload, but the quick-add captures the text only —
    no due date, no property/unit link, no assignee. So "by Friday" stays as
    prose the app can't chase, and the task does not appear under the
    property's own "THIS WEEK'S FOCUS" (still "0 / No open tasks on this
    property") even though it names the unit. The full New Task dialog has
    the fields; the quick-add is what you actually use one-handed ·
    Suggested: parse an obvious date phrase out of the quick-add text into
    the due date (and offer the property when the text matches a scheme
    name), or put a single "due" chip next to the quick-add box.

283. 2026-09-07 · BGP staff / mobile 390px (QA r586) · Victoria reopening the
    unit's Viewings dialog to check what she logged · the dialog opens with
    the blank "Add Viewing" form expanded underneath the list of existing
    viewings, so on a 390px screen the Save button sits below every viewing
    already recorded and she scrolls past her own history to reach it — and
    on the way back up it is not obvious which block is the new entry and
    which is the record · Suggested: collapse the add form behind its "Add
    Viewing" header on the phone (the Files dialog's Info-sheet panel
    already uses exactly that pattern), so the dialog opens on the history
    and expands to write.

279. 2026-09-07 · BGP staff / desktop 1440px (QA r585) · Victoria trying to
    put the "My Portfolio" widget on her dashboard · the widget picker's
    PATCH /api/auth/me/dashboard-widgets accepted `["my-portfolio"]` and
    echoed it back, but after a full reload the dashboard still rendered
    only the always-on set (widget-kpi-overview) — the My Portfolio widget
    never appeared. Not chased to a root cause inside this round's budget,
    so it is a SUGGESTION not a filed bug, but it means a staff member who
    picks a widget may get no feedback that the pick did not stick ·
    Suggested: worth a targeted look at how dashboard.tsx reconciles the
    saved widget list against the always-on/default set, and either render
    the picked widget or tell the user why it was dropped.

280. 2026-09-07 · BGP staff / any surface (QA r585) · the same round found
    /api/dashboard/my-portfolio 500ing on a column that does not exist, and
    the failure was completely silent to the user — the widget simply never
    drew. Nothing on the dashboard says "this panel failed to load" ·
    Suggested: give dashboard widgets a small shared error state ("couldn't
    load — retry") rather than rendering nothing, so a broken endpoint
    surfaces as a visible fault instead of a missing tile. A dead tile is
    indistinguishable from a tile the user never added, which is exactly how
    this one survived unnoticed.

277. 2026-09-07 · Landsec client / mobile 390px (QA r584) · Mark Warne on
    the train, opening his phone home to see where his empty units stand ·
    the "MY PORTFOLIO — LETTING TRACKER" tile reads
    `77 Available · 1 Under offer · 0 Let · 78 On tracker`, and it is right —
    it counts tracker units (mobile-home.tsx:293). One tap down, the Deals
    tab reads "2 deals — Landsec · +2 letting deals on the Letting Tracker"
    and lists them at SOLICITORS and EXCHANGED. Both are stages PAST "under
    offer", yet the home tile says one unit is under offer and none are let.
    Nothing is broken: the tracker holds pre-solicitors lettings, crm_deals
    holds SOL+ (the "Deals CRM is SOL+ ONLY" rule), so a unit LEAVES the
    tracker's under-offer bucket exactly when it enters the Deals tab. But a
    landlord reads the two screens as one pipeline and cannot see where the
    boundary is — his most advanced deals are invisible on the home tile
    that claims to summarise his portfolio. SUGGESTION: give the phone home
    tile a fifth figure sourced from crm_deals ("2 in legals"), or a footer
    line "+2 deals with solicitors — see Deals", so the tile accounts for
    every unit rather than only the pre-legals ones. Same shape as #250 on
    the desktop (ACTIVE DEALS 4 vs a 2-row deals array), and worth solving
    once for both shells.

278. 2026-09-07 · Landsec client / mobile 390px (QA r584) · Mark adding a
    task from his phone ("chase BGP on the MSU9 offer"), typing into every
    field the dialog offers and setting a due date of Friday 17:00 · the
    write is clean and PERSISTS perfectly — title, description, priority,
    category and due date all survive a reload and re-read identically from
    the edit dialog (verified this round). But the `datetime-local` value
    `2026-09-11T17:00` is stored as `2026-09-11T17:00:00.000Z`: the wall
    clock the user typed is banked as UTC. In September the UK is on BST, so
    a 17:00 task is really due 18:00 local, and anything that compares the
    column to `now()` — reminder windows, "due today", the digest's overdue
    bucket — is an hour out for half the year. It reads back correct because
    the render is the same naive slice, so the error is invisible until
    something else consumes the timestamp. SUGGESTION: decide one convention
    for `tasks.due_date` (store as UTC with an explicit local→UTC conversion
    on save, or keep it a naive local timestamp and stop appending Z) and
    apply it in both directions. Flagging rather than fixing — it touches
    every task consumer, so it is Woody's call.

275. 2026-09-07 · BGP staff / desktop (QA r583) · Victoria opening the WIP
    report's Agent Summary and clicking her own row to see which deals make
    up her WIP total · the drilldown's STAGE column is the panel's only
    explanation of why a deal counts, and it renders three ways — a green
    "Invoiced" badge, a yellow "WIP" badge, or, for anything else, the bare
    lowercase word `pipeline` as plain grey text (wip-report.tsx:667 and
    :742, the `<span className="text-muted-foreground">{d.stage}</span>`
    fallback). A raw enum value leaking into a table an agent reads about
    their own money looks like a rendering fault even when it's correct.
    SUGGESTION: give pipeline its own chip (e.g. amber "Pipeline", matching
    the badge the WIP report already uses at wip-report.tsx:1929) so all
    three stages read as deliberate labels rather than two badges and a
    lowercase word.

276. 2026-09-07 · BGP staff / phone (QA r583) · the phone home screen
    (mobile-home.tsx:263) fetches `/api/daily-digest` on every mount and
    binds it to an `alerts` array that is never rendered anywhere in the
    component — the only surface that renders the digest is the desktop
    dashboard's "Activity Feed" widget. So the firm's proactive alerts
    (stuck deals, unmatched requirements, cooling contacts, and the critical
    "KYC not approved" alert this round revived) are invisible to anyone
    working from the phone, while the phone still pays for the query on
    every home visit. SUGGESTION: either render the digest on the phone home
    (a compact alert strip above Tasks, tapping through to the record) or
    drop the dead query — but the alerts are the kind of thing an agent most
    wants on a phone, so rendering is probably the right half.

273. 2026-09-07 · Landsec client / desktop 1440px (QA r582) · Mark Warne on
    his portfolio dashboard, asking "is BGP actually working my empty units?"
    · the VACANCY PIPELINE card reads "Bluewater Shopping Centre — 75 vacant
    units · 1 active deal · Vacancy 38% · Pipeline 1%" with the Pipeline bar
    drawn ROSE (the card's own <40% colour), and its footer reads "77 total
    vacant units across 2 properties · 2 letting deals working the voids".
    Sitting immediately beside it on the SAME dashboard, the Letting Tracker
    card reads "78 live lettings · 160,382.5 sq ft · 77 Available · 1
    Negotiating". The two panels are counting different tables: the Vacancy
    Pipeline's numerator is `portfolioData.deals` (crm_deals), while every
    pre-solicitors LETTING in this app lives on the Letting Tracker
    (available_units) by design — so the coverage bar can only ever see the
    handful of lettings that reached crm_deals, and a landlord reads a red
    1% as "BGP has 75 of my units empty and is working one of them".
    Suggested: either count the client's live tracker units (NEG/HOT/SOL/EXC
    — the ones genuinely under negotiation) into the Pipeline numerator
    alongside crm_deals, or relabel the bar so it plainly says what it
    measures ("deals past solicitors") instead of "the active deals working
    to fill them". Needs Woody's numbered confirmation — not built.

274. 2026-09-07 · Landsec client / desktop 1440px (QA r582) · same dashboard ·
    the LEASE EXPIRY TIMELINE badge says "N expiring within 5 yrs across M
    properties", but its window is `new Date(now.getFullYear() + 5, 11, 31)`
    — 31 December of the fifth year out — so in September 2026 it is actually
    reporting everything expiring up to 31 Dec 2031, six years and four
    months away, and the quarter axis runs to Q4 2031 to match. A landlord
    reconciling the badge against his own five-year expiry profile will be
    over by up to five quarters. Suggested: either move the ceiling to
    `now + 5 years` to the day, or say "to end 2031" on the badge. One-line
    either way. Needs Woody's numbered confirmation — not built.

271. 2026-09-07 · BGP staff / any surface reading a unit's marketing state
    (QA r581) · the app answers "is this unit under offer?" from two hardcoded
    maps that disagree about heads of terms. `PUBLIC_CODE_MAP`
    (server/routes.ts ~3781, the public leasing feed for the marketing site)
    publishes NEG, HOT and SOL alike as "Under Offer". But
    `mapMarketingToTenancyStatus` (server/unit-mirror.ts ~233) and
    `dealStatusToTenancyStatus` (client/src/pages/deals.tsx ~703) both draw
    the line at SOL, so a unit at heads of terms creates/reads a tenancy-spine
    row saying "Marketing". Same unit, same day: "Under Offer" on the public
    website, "Marketing" on the spine. The public map is the newer decision
    (Woody, Sep 2026) and reads right; the other two predate HOT. Suggestion:
    Woody picks ONE boundary for "under offer" and the three maps share it —
    ideally a single helper in shared/deal-status.ts so the next status added
    to the enum lands in all three at once.

272. 2026-09-07 · BGP staff / Deals → new deal dialog (QA r581) · Victoria
    creates a deal she has just agreed heads of terms on · every
    pre-Solicitors status in the picker is disabled with "— use Letting
    Tracker", which is right for a leasing deal but the tip and the rule are
    leasing-shaped: an INVESTMENT deal (Sale / Purchase) has no Letting
    Tracker to go to, so an investment deal at Negotiating or HOTs cannot be
    created at its real stage from this dialog at all — the user has to
    create it at Solicitors and correct it afterwards. Suggestion: gate the
    pre-Solicitors disable on `dealType === "Leasing"`, the same condition the
    tip below the Type field already uses.

268. 2026-09-07 · BGP staff / Deals → Board view (QA r580) · Victoria
    switches the Deals board to the kanban to see where her deals sit · the
    board has five columns — Negotiating, Solicitors, Exchanged, Completed,
    Invoiced — but the Deals list it renders is SOL+ ONLY by the 2026-08-25
    rule (storage.getCrmDeals excludeTrackerDeals strips OPP/REP/SPEC/LIVE/
    AVA/NEG/HOT), so the Negotiating column can never hold anything. It reads
    as "no deals in negotiation" rather than "negotiation lives elsewhere",
    and there is no HOTs column at all. Suggestion: drop the NEG column and
    replace it with a link to the Letting Tracker / WIP report where the
    pre-Solicitors pipeline actually lives — or, if the board is meant to
    show the whole book, stop stripping NEG/HOT and add the HOTs column.

269. 2026-09-07 · BGP staff / HR → a person → Commission (QA r580) · reading
    the "Awaiting payment" chase list · the badge is computed as
    `status === "INV" ? "Invoiced" : "Completed"`, and the commission engine
    feeds this list EXC, COM and INV deals — so a deal that has only
    EXCHANGED is badged "Completed". The sub-line is worse: the server maps
    `invoicedAt: null` unconditionally, so every row falls through to
    "Completed {feeDue date}" — including the rows badged "Invoiced", which
    then say Invoiced and Completed at once. Suggestion: badge the real
    status (Exchanged / Completed / Invoiced) and either carry the real
    invoice date or drop the "Completed" wording from the sub-line.

270. 2026-09-07 · BGP staff / HR → a review → Record compensation (QA r580)
    · an admin records a bonus twice (double-click, or re-opening the form
    after a refresh) · the bonus INSERT is `ON CONFLICT (user_id,
    effective_date, amount_pence, kind) DO NOTHING`, so the second write is
    a silent no-op and `inserted.bonus` comes back null — but the endpoint
    still returns ok and still creates Wendy's high-priority "Push to Xero:
    {name} — Bonus £X" payroll task. Payroll is then chasing a bonus that
    was not recorded on the second submit (and the salary_history insert has
    no conflict guard at all, so that one genuinely duplicates). Suggestion:
    when nothing was inserted, say "already recorded" and skip the payroll
    task; give salary_history the same dedupe key as bonus_history.

265. 2026-09-07 · BGP staff / HR → a person → Reviews (QA r579) · Victoria
    presses "Sync from WIP" on her own annual review to pull her fee figures
    off the WIP report · the toast reads "Synced from WIP (0 allocations)"
    and every money field lands on £0 whenever nothing matches — and "0
    allocations" is the SAME message whether the agent genuinely has no
    fee-allocated deals or the Sage agent-name spelling missed the name
    variants the matcher tries. The reviewer has no way to tell an empty
    pipeline from a broken name match, on the form that sets the agent's
    target for the year. Suggestion: when the match count is 0, say so
    loudly ("No fee allocations found for 'Victoria Broadhead' — check the
    agent-name spelling on the WIP report") and, when it is not, name the
    deals counted so the numbers can be checked against the report.

266. 2026-09-07 · BGP staff / HR → a person → Reviews (QA r579) · same form,
    reading the pipeline · the review carries exactly two pipeline columns,
    under offer and negotiating, while the /hr commission card and the WIP
    report on the same profile now both break the pipeline into three (Neg /
    HOTs / Sol) since r578. r579 folded HOTs into "under offer" so no fee
    goes missing, but the review and the card beside it now state the same
    agent's pipeline in different shapes. Suggestion: either show the split
    as a sub-line under the under-offer field ("of which HOTs £x"), or add a
    third pipeline column — the latter needs a `staff_reviews` column, so
    it is Woody's call, not a tidy-up.

267. 2026-09-07 · BGP staff / HR → a person → Reviews (QA r579) · same sync ·
    the sync buckets fee allocations as INV → achieved, HOT+SOL → under
    offer, NEG → negotiating. A deal sitting at EXC (exchanged) or COM
    (completed) but not yet invoiced therefore counts as NEITHER achieved
    NOR pipeline — the agent's review shows a hole for exactly the deals
    that are done bar the invoice, and the money reappears only when the
    invoice is raised. Woody's 14 May 2026 spec says achieved = INV, so
    this is a policy question rather than a defect. Suggestion: count EXC
    and COM in the under-offer pipeline (the safe reading), or add them to
    achieved if the firm treats a completed deal as banked.

262. 2026-09-06 · BGP staff / phone home (QA r578) · Victoria opens the app on
    her phone and reads her money · the finance card headlines "MY BILLING —
    2026/27 · £0 Billed · £0 Commission · £0 Potential", and the very next
    card, in the same scroll, reads "TOTAL BILLING £330,000". That second
    figure is the FIRM's WIP roll-up (/api/wip, taps through to the WIP
    report) — nothing on it says so, and it sits directly under a card that
    has just said her own billing is zero. Suggestion: label it for what it
    is ("Firm WIP" / "Total billing — all teams", or the team name when the
    user is scoped to one), so the two numbers can't be read as hers.

263. 2026-09-06 · BGP staff / phone /hr (QA r578) · Victoria checks her
    commission on the move · her card reads "COMMISSION · 2026/27 target £0 /
    £0 billed + £80k WIP / Forecast £80k → est. commission £0". The target is
    £0 because no salary is recorded, so every derived figure on the card is
    honestly meaningless, but the card presents them as real numbers and the
    progress bar reads 100%. Suggestion: when the scheme target is zero,
    replace the target/commission line with "No commission target set — ask
    HR" and keep only the billed + WIP figures, which are real.

264. 2026-09-06 · BGP staff / phone, any unrouted path (QA r578) · a stale or
    mistyped link (the round hit /letting-tracker; the real route is
    /deals/letting) · the phone chrome prints a confident page title in the
    header — "Letting Tracker" — above the app's "Page not found" body, so
    the screen reads as if a real page failed to load rather than as a dead
    link. Suggestion: derive the mobile header title from the matched route,
    not the URL slug, so a 404 says "Not found" in the header too.

259. 2026-09-06 · BGP staff / HR overview → Hunger Games "Top team" (QA r577)
    · Woody reads a team's pipeline off the strip · /api/hr/team-summary
    aggregates every deal `NOT IN ('INV','ARCH','WIT')` — the exclusion form,
    written before REP was deleted from WIP (2026-08-31). So a team's total
    still counts OPP / REP / SPEC / LIVE deals, while the ski-target hero
    above it and (since r577) each individual's pipeline board count
    WIP_STATUSES minus INV. On real data a team's number can therefore exceed
    the sum of its own members' pipelines. Suggestion: point team-summary at
    the same WIP_STATUSES set so all three figures on the page are the same
    arithmetic, and drop the third hardcoded list.

260. 2026-09-06 · BGP staff / HR overview (QA r577) · the same page shows two
    numbers both labelled "billed" · the ski-target hero's billed is `status
    = 'INV'` only (Xero-set), while the Hunger Games "Top biller" board sums
    `INV or COM` per person — and the same COM deal is also counted in that
    person's pipeline, so it is in two of the three boards at once. The
    popover already describes the hero's rule ("deals invoiced this scheme
    year, pulled from Xero"), not the one the code runs. Suggestion: decide
    whether COM is billed or WIP (the hero says WIP) and make the leaderboard
    agree, rather than counting it twice.

261. 2026-09-06 · BGP staff / WIP data-quality report (QA r577) · the report
    whose whole job is to surface money that will never be billed · its
    "live pipeline deals with NO fee at all" bucket (server/crm.ts ~10146)
    filters the already-WIP set down to ('NEG','SOL','EXC','COM','INV'),
    dropping AVA and HOT. A letting sitting at Available or a deal at heads
    of terms with no fee on it is exactly the invisible money the bucket
    exists to catch, and it is the one thing the bucket cannot see.
    Suggestion: drop the second filter entirely — the set is already
    WIP_STATUSES, so `(r.fee || 0) > 0` is the only test it needs.

252. 2026-09-06 · BGP staff / Deals board + deal dialog (QA r575) · Alex
    moves a deal back from Solicitors to heads of terms · `CRM_OPTIONS.dealStatus`
    (client/src/lib/crm-options.ts) is still the pre-HOT ten codes under a
    comment calling it "the canonical 10-code set — see shared/deal-status.ts",
    while shared/ has exported DEAL_PAGE_STATUSES (all twelve, HOT and OPP
    included) for exactly this purpose since 2026-08-12. The WIP Report's
    inline status select reads DEAL_PAGE_STATUSES and offers HOTs; the deal
    create/edit dialog (deals.tsx ~2646) reads CRM_OPTIONS.dealStatus and does
    not. Not confirmed in the browser this round — the dialog wouldn't open
    from /deals/list in the probe, so the visible symptom is unproven.
    Suggestion: `dealStatus: [...DEAL_PAGE_STATUSES]` and add "OPP","HOT" to
    the dialog's PRE_SOL list so both stay disabled at CREATE time (the
    existing "use Letting Tracker" rule) but selectable when editing.

253. 2026-09-06 · BGP staff / ChatBGP + MCP clients (QA r575) · Someone asks
    for the WIP pipeline · server/mcp-server.ts:447 backs the tool described
    as "the WIP (Work In Progress) pipeline report showing active deals with
    fee allocations" with `inArray(status, ["NEG","SOL","EXC","Active",
    "Under Offer","Exchanged"])` — against WIP_STATUSES (AVA, NEG, HOT, SOL,
    EXC, COM, INV) that drops AVA, HOT, and every COMPLETED and INVOICED
    deal, i.e. most of what WIP means. Suggestion: `inArray(status, [
    ...WIP_STATUSES, ...legacy strings])`, or route the rows through
    legacyToCode() and filter on WIP_STATUSES.

254. 2026-09-06 · BGP staff / staff reviews (QA r575) ·
    server/review-wip-sync.ts:79 and :93 total an agent's fee allocations
    with `WHERE d.status IN ('INV','SOL','NEG')` into a fixed three-bucket
    {inv, sol, neg} shape. A deal at HOTs sits between NEG and SOL and lands
    in neither bucket; EXC and COM allocations are dropped too, so an
    agent's review understates work that is exchanged but not yet invoiced.
    Deferred rather than fixed because the fix needs a decision about the
    bucket shape, not just the vocabulary. Suggestion (Woody's call): fold
    HOT into the sol bucket and EXC/COM into inv, or widen the shape.

255. 2026-09-06 · BGP staff / property pages + dashboard (QA r575) ·
    DealsSummary renders a chip per WIP_STATUS, each deep-linking to
    /deals/list?status=<code>, but its feed is
    /api/crm/deals?excludeTrackerDeals=true — which by design (Woody
    2026-08-25, "the Deals CRM is SOL+ ONLY") excludes OPP/REP/SPEC/LIVE/AVA/
    NEG/HOT. So the Available, Negotiating and HOTs chips are structurally
    always 0 on every property, in both the strip and card variants, and
    click through to a board that can never show them. Its LIVE_CODES
    constant has the same shape problem in reverse: it lists REP (excluded
    server-side) and omits HOT (also excluded), so both halves are dead.
    No visible wrong number — left alone deliberately this round.
    Suggestion: render only the codes the feed can contain (SOL, EXC, COM,
    INV) and derive LIVE_CODES from the shared sets rather than retyping.

256. 2026-09-06 · Landsec client / phone 390px, Letting Tracker + Portfolio
    home (QA r576) · Mark checks his units on the train · The same unit
    status is spelled three ways in one session: the phone home tile calls
    the 77 AVA units "Available", the tracker's pill row and every card badge
    call them "MARKETING" (DEAL_PIPELINE_LABELS), and the unit Edit dialog's
    Unit Status select calls them "Available" again (DEAL_STATUS_LABELS).
    Nothing is wrong, but a landlord reading "77 Available" then landing on a
    board headed "MARKETING 77" has to work out they are the same number.
    Suggestion: pick one client-facing word per code and let the pipeline
    labels differ only where they genuinely carry more meaning.

257. 2026-09-06 · Landsec client / phone 390px, /properties (QA r576) · Mark
    opens his portfolio list · The phone property card (MobileCardView from
    properties.tsx ~5927) headlines title + subtitle + five fields — Asset
    Class, Team, Tenure, BGP Contacts, Sq Ft — every one of which is null on
    a client's property rows (address, assetClass, tenure, sqft and status
    are all blank on both Landsec properties, and property-agents/users are
    staff data). The result is a card carrying nothing but the name the map
    pin above it already shows. The figures the client dashboard renders for
    the same property — units, occupancy, NIA, live lettings — are all
    reachable. Suggestion: for client viewers, field the card from the
    portfolio roll-up rather than the CRM columns BGP fills in for itself.

258. 2026-09-06 · Landsec client / phone 390px, /deals (QA r576) · Mark
    counts his deals · /api/crm/deals?excludeTrackerDeals=true ships the
    client three rows; the board's ALL pill counts two and renders two. The
    third is "QA-R1 FeeVisibility" — a leftover QA probe row with status
    null and no property, left in the fixture by an early round and still
    scoped to Landsec. Two things worth separating: the fixture row should
    be cleaned out, and a status-less deal silently vanishing from every
    pill while still riding the payload is the shape that has cost several
    rounds. Suggestion: delete the fixture row; and count the ALL pill from
    the same rows the list renders so payload and pill can never disagree.

250. 2026-09-06 · Landsec client / dashboard desktop 1440px (QA r574) ·
    Mark reads "ACTIVE DEALS 4" and looks for the four · The tile counts
    every deal on a property he owns (landlord_id OR the property's
    landlord_id OR a matching group name — the union the comment above the
    query says was needed because "landlord_id alone missed nearly
    everything"), but the `deals` array the same payload ships is still the
    landlord_id-only list: 4 counted, 2 sent. Only the property-less ones
    surface today (the "Other Deals" strip), so nothing visibly contradicts
    the tile yet — but any client-side board that starts reading
    portfolioData.deals inherits the older, narrower portfolio.
    Suggestion: give the list query the same WHERE clause as the count in
    /api/company-portfolio/:companyId (server/routes.ts ~8060).

251. 2026-09-06 · Landsec client / dashboard desktop 1440px (QA r574) ·
    Mark counts his own units off the tenancy Excel BGP gives him · The
    downloaded rent roll totals every money column except the one a landlord
    reads first: Rent (pa) is blank in the TOTAL row because
    `passing_rent_pa` is null across the whole Landsec feed (#240), while
    ERV, Rates, Service Charge and Insurance all total. A client cannot tell
    "no data" from "sums to zero". Suggestion: print "not recorded" (or the
    coverage note the dashboard tile already uses) in a totals cell whose
    column has no values at all, rather than an empty cell.

247. 2026-09-06 · Landsec client / emailed weekly update PDF (QA r573) ·
    Mark's colleague opens the weekly update BGP emails them · Every copy of
    the PDF carries a spurious blank second page. The per-page footer is
    written at y=810 on an A4 page whose bottom margin is 60pt, so pdfkit
    pushes it onto a fresh page — page 1 ends with no footer at all and the
    client gets a two-page document with one page of content. Suggestion:
    write the footer with the bottom margin temporarily zeroed
    (`doc.page.margins.bottom = 0` around the footer loop) so it lands at the
    foot of each real page and the document is one page long.

248. 2026-09-06 · Landsec client / emailed weekly update PDF (QA r573) ·
    the client reads their deal list in the weekly update · The list carries
    no money at all — the report reads `rent_pa` then `pricing`, and both are
    null on every deal in the Landsec feed (the same gap as #240), so a
    client's weekly update is deal name, property and status only. The fee
    and rent the app does hold for these deals live on the letting tracker
    and the tenancy schedule. Suggestion: fall back to the tracker/schedule
    figure (labelled with its source) before printing nothing.

249. 2026-09-06 · BGP staff / Letting Hunter desktop (QA r573) · Victoria
    scans "Landlords ranked by leasing opportunity" for targets · The page's
    own subtitle says "Top scores have VOIDS, upcoming lease events, stale
    competitor agents, or fresh acquisitions", but the Hunter Score
    (server/landlord-hunter.ts) has no void term: it is upcomingSqft*0.001 +
    upcomingEvents*5 + staleAgentCount*30 + recentAcq*15 + flag*50. A
    landlord with 75 vacant units on the letting tracker scores exactly the
    same as one with none. The void data is live and already sliced per
    landlord (available_units / the leasing board's occupancy). Suggestion:
    either add a void term to the score or drop "voids" from the subtitle.
    Related, in the same query: `totalSqft` is summed from
    `crm_properties.sqft`, which is null on every property in the fixture,
    and the column is never rendered — a dead select behind a dead source.

246. 2026-09-06 · BGP staff / desktop 1440px (QA r572) · Victoria reads the
    four KPI tiles at the top of her dashboard before a client update · Each
    tile pairs its headline with a coloured percentage badge and the words
    "6mo trend" — but the badge is not a six-month trend. It is
    `calcChange()`, LAST MONTH vs THE MONTH BEFORE (kpi-trends in
    server/routes.ts); only the sparkline beside it spans six months. On the
    fixture that reads "PROPERTIES 4 · ▼100% · 6mo trend" because two
    properties were added in July, two in August and none yet in September —
    a tile that looks like the portfolio halved over half a year when
    nothing was lost at all. The headline is also all-time while the badge
    is month-on-month, so the two halves of one tile measure different
    windows. · Either label the badge for what it measures ("vs last month")
    and leave "6mo" on the sparkline, or make the badge the six-month change
    the label promises. Cheap either way; the current pairing is the only
    thing on the dashboard that can read as a loss that never happened.

245. 2026-09-06 · BGP staff / desktop 1440px (QA r572) · Victoria opens
    Westgate Test Centre to see where the asset stands · The PIPELINE &
    PERFORMANCE scorecard says "VACANCY 100.0% · 3 of 3 units". Immediately
    below it, the stored BGP Commentary says "the asset is running at 0.0%
    vacancy, which is a strong position and means there are no immediate
    income risks to flag". The commentary is generated prose, dated 3 Aug,
    and nothing invalidates it when the figures it quotes move — r571
    changed how the scorecard counts occupancy, and the paragraph beneath it
    still argues the opposite case in full sentences. A landlord-facing
    narrative that contradicts the tile above it is worse than no narrative.
    · Stamp each commentary with the figures it was generated from and show
    a "written when vacancy was X% — refresh" chip once the live scorecard
    disagrees, or regenerate on read when the inputs have changed.

244. 2026-09-06 · BGP staff / desktop 1440px (QA r572) · Victoria works down
    Landsec's company profile to prep the monthly update · The Properties
    card lists Landsec's two assets and ends with an "Open leasing board"
    button — but it links to a bare `/leasing-schedule`, the all-landlords
    board, which opens on Landsec's 168 units AND Hammerson's Brent Cross.
    Every other link on that card is property-scoped; this one silently
    widens to the whole firm, and from a client's own record it is the one
    control that shows another landlord's scheme. · Point it at the
    landlord-scoped board (the page already groups by landlord, so a
    `?landlordId=` or an anchor to that group is enough), or relabel it
    "Open the leasing board (all clients)" so the destination is honest.

242. 2026-09-06 · Landsec client / property page desktop (QA r571) · Mark
    reads the Vacancy tile on his own Bluewater asset brief · The tile now
    says "46.7% — 77 of 165 units" (r571 made it agree with the leasing
    board it counts). One tab across, the property's tenancy board — the
    master rent roll, and the board his own dashboard card counts — says
    75 vacant of 199. Both figures are correct for the set they count, but
    neither says which set that is, so the landlord's property page offers
    him two vacancy rates nine points apart with no way to tell them
    apart. · Put the basis on the tile the way the r569 ERV tile now does:
    sub-line "of the 165 units on the leasing board" (and make it tap
    through to that board), or move the tile onto the tenancy master so the
    property page has one vacancy figure. The scorecard's WAULT already
    reads the master, so the card currently mixes the two sources.

243. 2026-09-06 · both personas / letting tracker + asset brief (QA r571) ·
    Reading how recently a marketed unit was actually shown · The unit
    payload carries `lastViewingDate` and the asset brief carries
    `last_viewing_date`, and `available_units.last_viewing_date` has three
    readers and NO writer anywhere in the app — the exact sibling of the
    `viewings_count` column r570 fixed, in the same two queries. It is null
    on every unit, so nothing renders it and no screen shows viewing
    RECENCY: the tracker card says "Viewing (2)" and never says when. ·
    Either drop the dead column and the three selects, or make it live —
    MAX(viewing_date) FROM unit_viewings, the same substitution r570 made
    for the count — and show it under the viewing chip ("last shown 12
    Aug"), which is the figure an agent chasing a void actually wants.

241. 2026-09-06 · BGP staff / phone home 390px (QA r570) · Victoria opens
    her phone and reads her billing position off the home screen · The first
    card is "MY BILLING — 2026/27" and every figure in it is £0 (Billed,
    Commission, Potential, Negotiating, Solicitors — her own scheme-year
    numbers). Directly beneath it sits a second money card labelled only
    "TOTAL BILLING £250,000". That second figure is the FIRM's roll-up —
    Σ (amtWip + amtInvoice) over every entry /api/wip returns, with no
    person and no year filter (7 deals, agent null on all of them) — but
    nothing on the card says whose or when, so stacked under a card that
    names its owner and its scheme year it reads as the total OF the card
    above. · Label it for what it is ("Firm billing — all open WIP" or
    "Team total") and state the basis, the way the r569 ERV tile now does.
    The two cards are not comparable and only one of them says so.

239. 2026-09-06 · both personas / tenancy board desktop + phone (QA r569) ·
    A landlord (or an agent pricing a void) wants the per-unit rate behind
    the board's "Avg ERV £psf" headline · The board's payload carries
    `rent_psf` on 107 of Bluewater's 199 rows — and it is exactly
    erv_pa ÷ nia_sqft on every one of them (ANC1 £10.04, MSU4 £27.99, MSU6
    £33.00, SVU02 £49.97) — but `rent_psf` is not in COLUMNS at all, so the
    board never shows it. The user can see a total ERV per unit and a whole-
    board average rate, and nothing in between; comparing two units on rate
    means dividing by hand. · Add `rent_psf` to the Rental Income band as a
    "num" column at 2 dp, labelled ERV £psf (not "Rent £psf" — the field
    holds the ERV rate, not a passing-rent rate), sitting next to ERV (pa).
    It needs no new data and it is the column the r569 tile averages.

240. 2026-09-06 · both personas / tenancy board (QA r569) · Reading the
    income position off the rent-roll board · `passing_rent_pa` is null on
    100% of the Landsec feed (0 of 199 rows), and so are marketing_rent_pa,
    the four rent_review amounts and turnover_rent_payable. The board's
    "PASSING RENT" tile and its Passing Rent column therefore read "—" for
    every user on every row — the same em-dash a unit with a genuinely £0
    rent would show, so the board cannot distinguish "this feed carries no
    passing rents" from "this unit is rent-free". · Where a money column is
    empty on EVERY row of a property, say so once rather than 199 times:
    tile sub-line "not in this feed" (the WAULT tile's existing amber sub
    mechanism), and drop the column from the default column set for that
    property instead of printing a dash 199 times. Cheaper alternative:
    headline the tile on ERV with an "ERV" label, as r568 did for the phone
    card headline.

238. 2026-09-06 · Landsec client / phone 390px (QA r568) · Mark opens the
    phone app to get his Bluewater position before an asset review · The
    client phone landing's one portfolio block is "MY PORTFOLIO — LETTING
    TRACKER: 77 Available · 1 Under offer · 0 Let · 78 On tracker". There is
    no money and no occupancy on it — a landlord's phone home screen tells
    him only how many units his agent is marketing. The figures he came for
    (623,653 sq ft, £11.37m service charge, 124 occupied / 75 vacant) are
    three taps away on the property's Boards tab. Suggestion: put one
    portfolio row above the tracker block — units, occupancy %, and the
    best money figure available (passing rent, else total ERV) — each
    tapping through to the tenancy board it counts.

237. 2026-09-06 · Landsec client / phone + desktop (QA r568) · Mark reads the
    tenancy board's KPI strip · The "AVG ERV £PSF" tile reads "—" on all
    199 Bluewater rows because it averages `blended_erv`, which is null on
    every row, while `erv_pa` is populated on 131 and `nia_sqft` on 137 —
    so a genuine £psf is computable from data already in the payload. The
    label also says £psf while the source field it falls back to is a
    per-annum figure, so if blended_erv were ever populated the tile could
    print an annual rent under a psf heading. Suggestion: compute the tile
    as Σ erv_pa ÷ Σ nia_sqft over rows that have both (that IS £psf),
    badge how many rows contributed the way WAULT badges its exclusions,
    and keep blended_erv only as an override.

236. 2026-09-06 · Landsec client / phone 390px (QA r568) · Mark taps the "LT"
    badge on a vacant Bluewater card to see how the letting is going · The
    badge lands on /deals/letting — the whole 78-unit tracker, unfiltered,
    at the top — not the unit he tapped it on. Same shape as #231 (a row
    link that drops the row). Suggestion: carry the unit through
    (/deals/letting?unit=<id> or ?q=<unit_name>) and seed the tracker's own
    search from it, so the badge lands on the unit whose card carried it.

235. 2026-09-06 · Landsec client / phone 390px (QA r568) · Mark checks the
    size of the scheme on his own property page · The Bluewater OVERVIEW
    panel says "Area —" (crm_properties.sqft is null) while the property's
    own tenancy board, one tab across, totals "TOTAL NIA 623,653 sq ft"
    from its 199 rows. The landlord's property page therefore claims not to
    know the size of a property it can measure. Suggestion: when sqft is
    unset, show the tenancy board's Total NIA with a "from the tenancy
    schedule" hint rather than an em-dash — and let staff accept it as the
    property's area in one click.

234. 2026-09-06 · Landsec client / desktop + phone card list (QA r567) · Mark
    reads a Bluewater unit on the tenancy card list · The phone card leads
    with Passing Rent as its one headline money figure (top-right, bold,
    tabular) — and passing_rent_pa is null on all 199 Bluewater rows, so
    every card's headline reads "—" while the same rows carry a populated
    ERV (£405,273), Service Charge (142 of 199) and Rates Payable (159 of
    199). The desktop sheet at least shows the neighbouring columns; the
    phone card shows the one empty field and nothing else numeric. The
    dashboard already handles this case ("no passing rent recorded yet",
    note #4). Suggestion: fall back on the card headline — passing rent if
    set, else ERV labelled "ERV" (the vacant-card branch already does
    exactly this with "£405,273 asking"), so a phone card is never headed
    by a dash when the row has money on it. Worth confirming on the phone
    shell in the next 390px round.

231. 2026-09-06 · Landsec client / desktop 1440px (QA r566) · Mark clicked the
    dashboard's "Expiring (6m) · 7 · leases expiring soon · click to list"
    tile, saw "Nando's Chickenland Limited · Bluewater · 28 Sept 26" in the
    popover, and clicked it to read the tenancy · The row links to
    /tenancy-schedule/<propertyId> — the whole 200-row sheet, opened at the
    top, with no filter, highlight or scroll to the tenant he clicked. He
    then has to type the name into the schedule's own search to get back to
    the row the popover already had. Suggestion: carry the unit through
    (/tenancy-schedule/:propId?unit=<unit_number> or ?q=<tenant>), seed the
    schedule's existing search box from it and scroll that row into view —
    the same deep-link-filter pattern the tracker status pills and the
    r564 ?noFee=1 deals link already use.

233. 2026-09-06 · Landsec client / desktop 1440px (QA r566) · Mark worked the
    expiring-leases list: Nando's SVL02 expires 28 Sept 2026, three weeks
    out — is BGP marketing it? · The Tenancy Schedule can't tell him. Staff
    rows carry an "LT" badge on the unit cell when the unit is on the
    Letting Tracker (and a "+ Tracker" button when it isn't), but the
    read-only branch drops both, so the client's row shows the expiry and
    nothing about what is being done with it. He has to open the Letting
    Tracker separately and search 78 listings to learn that SVL02 is not on
    it at all. Suggestion: keep the read-only "LT" badge (link only, no
    "+ Tracker" write control) and show a muted "not marketed" hint on
    occupied rows expiring within 6 months — the landlord's whole reason for
    reading the expiry column is to find the ones nobody has picked up.

229. 2026-09-06 · Landsec client / desktop 1440px (QA r565) · Mark opened his
    portfolio dashboard to see how full Bluewater is · The unit-schedule board
    states "199 units · 124 occ · 7 exp" per property, but the two numbers a
    landlord actually asks about — how many units are empty, and what that
    vacancy is costing — aren't there. Vacancy has to be worked out by
    subtraction (199 − 124), and the board's own destination shows VACANT 75
    and a service charge figure it never surfaces here. Suggestion: put the
    vacant count next to the occupied one on the card row (green "124 occ" /
    amber "75 vac"), same as the schedule's own tiles, so the headline the
    landlord came for is on the dashboard rather than one click away.

230. 2026-09-06 · Landsec client / desktop 1440px (QA r565) · Mark clicked
    through from the dashboard board to the Bluewater Tenancy Schedule · The
    card counts 199 units and the schedule header reads 200. Both are honest
    — the schedule merges in Letting Tracker units that have no tenancy row
    yet (one, here), and the dashboard reads the stored table — but neither
    screen says so, and a landlord reconciling two counts of his own centre
    has no way to tell which is which. Suggestion: on the schedule header,
    footnote the merged rows the way the WAULT tile already footnotes its
    exclusions ("200 units · 1 from the Letting Tracker"), so the two figures
    explain their own difference.

227. 2026-09-06 · BGP staff / desktop 1440px (QA r564) · Victoria linked a
    follow-up task ("chase Landsec on the Bluewater HOTs") to the Bluewater
    MSU9 deal from My Tasks · The link is one-way. The task row gets a blue
    deal chip that opens the deal correctly, but the deal page itself shows
    no sign of the task anywhere — not in Deal Activity, not in Comments, not
    in History & activity. Anyone else opening that deal has no idea a
    chase is booked, and Victoria can't see her own commitment from the
    record she's working in. Suggestion: a small "Tasks" line on the deal
    page listing linked tasks (title, owner, due, done state) with an add
    control, so the deal record shows the work booked against it.

228. 2026-09-06 · BGP staff / desktop 1440px (QA r564) · Victoria opened CRM
    to look at BGP's client landlords · The pill row reads "Total Landlords 5
    · BGP Clients 0 · Non-Clients 5", and no landlord carries the client
    crown — including Landsec, which has its own portal logins, 2 properties
    and 3 deals with BGP. Clicking "BGP Clients" empties the list. The pill
    tests companyType = 'Client' / 'Landlord / Client' or is_portfolio_account
    (client/src/pages/people.tsx:139), but client access is actually granted
    by a user's team name resolving to a company
    (getCompanyIdForClientTeam) — nothing writes that flag back. Suggestion:
    derive "BGP client" from the thing that decides it (a company with client
    logins), or surface the flag on the company edit form so someone can set
    it; either way the pill should not tell staff the firm has no clients.

226. 2026-09-06 · Landsec client / desktop (QA r563) · Reading the Letting
    Tracker's Ref column · The red compliance dot beside a deal ref is the
    only compliance signal a client gets on that board, and its tooltip is
    the only place the reason lives — you have to hover a 6px dot to learn
    that AML is outstanding on your own instruction. There is no dot legend,
    no column header hint, and nothing on the phone card at all. Suggested:
    give the client tracker a one-line legend under the chip row ("● AML
    outstanding on this deal — your BGP contact is chasing it") and carry the
    same flag onto the phone card, so the signal is readable without a mouse.
    Needs Woody's numbered confirmation — not built.

225. 2026-09-06 · BGP staff / mobile 390px (QA r562) · Journey "log a viewing
    on the tracker" · The Add Viewing dialog's Contact picker lists EVERY
    contact in the CRM even after a Company has been chosen — 15 names on a
    390px screen, Hammerson's Head of Leasing and a rival landlord's contact
    among them, with no company shown beside any of them. Straight after a
    viewing, on a phone, you have to know which "Sam" is which. Suggested:
    once a company is picked, filter the contact list to that company (with a
    "show all" escape), and show the company as a sub-line on each name.
    Needs Woody's numbered confirmation — not built.

224. 2026-09-06 · BGP staff / mobile 390px (QA r562) · Journey "log a viewing
    on the tracker" · The unit card's Viewing/Offer buttons carry a count —
    "Viewing (2)", "Offer (1)" — but nothing on the card says what the latest
    one was. The viewing I had just logged as "Offer Expected" looked
    identical on the board to one logged six months ago as "Not Interested".
    Suggested: put the most recent viewing's outcome and date on the card as
    a sub-line, so the tracker reads as a pipeline rather than a counter.
    Needs Woody's numbered confirmation — not built.

223. 2026-09-06 · Landsec client / desktop (QA r561) · Payload audit of the
    client shell · A client deal row ships ~120 columns straight off
    crm_deals; the client shell renders perhaps fifteen of them. Everything
    else is protected by a hand-written null-list (stripDealFees) that has to
    be extended by hand every time a staff feature adds a column — which is
    exactly how the MLRO working notes and the Xero billing record ended up
    on a landlord's payload (fixed this round), and how the property sub-read
    drifted a whole fee family behind the canonical list. Suggested: invert
    it — give scoped callers an explicit client deal DTO (allow-list of the
    fields the client shell actually reads) instead of a deny-list, so a new
    staff column is private by default. Needs Woody's numbered confirmation —
    not built.

221. 2026-09-06 · Landsec client / mobile 390px (QA r560) · Journey "what has
    BGP got outstanding on my portfolio" · The Calendar screen's insight strip
    is the only place a landlord gets portfolio intelligence on the phone
    (hottest property, viewing momentum, needs attention, deals, portfolio),
    but it sits BELOW the day grid — Mark had to scroll past sixteen empty
    hour rows (06:00–21:00, no events) to reach it, on a day with one viewing.
    Suggested: on the phone, put the insight strip ABOVE the grid for client
    viewers, or collapse an empty day to a single "Nothing in the diary today"
    row. Needs Woody's numbered confirmation — not built.

222. 2026-09-06 · Landsec client / mobile 390px (QA r560) · Same strip · It
    labels Landsec — the viewer's OWN landlord company — as "MOST ACTIVE
    TENANT ... Landsec — 1 viewing booked". The insight buckets viewings by
    team_events.company_name, which for a client is nearly always their own
    company, so a landlord is told his most active tenant is himself.
    Suggested: for client viewers either drop the insight when the top
    company IS the viewer's own company, or re-key it on the BRAND being
    shown round (the tenant side of a viewing) rather than the event's
    company_name. Needs Woody's numbered confirmation — not built.


219. 2026-09-05 · BGP staff / desktop (QA r559) · Two links still carry the
   dead `?highlight=<id>` convention after r559 fixed the four company ones:
   the Contacts page links a contact's requirements as
   `/requirements?highlight=<reqId>` and their investment items as
   `/investment-tracker?highlight=<id>`. Neither page reads the param (the
   fix used for companies — route straight to the record — isn't available
   because neither has a per-record route), so both land the user on the
   whole grid to hunt for the row they just clicked. Suggestion: give
   Requirements and the Investment Tracker a `?highlight=` reader that
   scrolls the row into view and rings it for a couple of seconds — the same
   affordance the Letting Tracker's pitchBrand deep link already has.

220. 2026-09-05 · BGP staff / desktop (QA r559) · The brand profile's "Add to
   deal" button now lands correctly on the Deals list with the brand in the
   search box (r559), but for a brand with no deals — the normal case for a
   button called "Add to deal" — the result is "No deals found / Create a
   deal or adjust your filters" and a New Deal button that opens an empty
   form. The agent has to retype the brand they just came from. Suggestion:
   carry the brand through to the create dialog (`?search=<name>&new=1` with
   the tenant prefilled), so "Add to deal" actually starts the deal.

217. 2026-09-05 · Landsec client / desktop 1440px (QA r558) · Mark's
   Requirements page renders the full leasing-requirements table — Name, Use,
   Size Req., Locations, Fits, Agent Contact, Landlord Pack — over the words
   "0 active requirements / No active requirements found", and that is all a
   client ever sees there (requirements are BGP-owned; nothing in the fixture
   is shared out). A landlord with 77 vacant units at Bluewater arrives at this
   screen precisely to ask "who is looking for space like mine", and gets an
   empty grid with no explanation. Suggestion: for client logins either say
   what the screen is for and why it is empty ("Requirements your BGP team has
   shared with you — nothing shared yet; ask us to publish one"), or drop the
   nav item until there is something in it.

218. 2026-09-05 · Landsec client / desktop 1440px (QA r558) · The dashboard's
   Letting Tracker card lists all 78 live lettings as individual rows, but
   every row links to the same place — trackerHref(u.propertyId), i.e. the
   whole tracker for that property — so clicking "L090 · 6,414 sqft" does not
   take you to L090. The list also shows genuine repeats from the data (four
   separate "U062 · Bluewater – Upper Level · 1,408 sqft" rows, two "L090"),
   which is impossible to reason about when none of them opens. Suggestion:
   deep-link each row to its own unit (the tracker already accepts a filter in
   the URL — r558 fixed those params being ignored), and cap the card at the
   top handful with an "and N more →".

215. 2026-09-05 · BGP staff / desktop + phone (QA r557) · Every inline board
   picker (Lease Events Status and Owner, and the same pattern elsewhere)
   saves silently: the control repaints the moment you choose, and whether the
   write reached the server is invisible. When it doesn't, the only signal is
   a destructive toast that can be missed on a long board — which is why the
   stale-reload bug fixed this round read as "my change went back" rather than
   as an obvious failure. Suggestion: give inline saves a visible lifecycle —
   the control dims while the PATCH is in flight and shows a brief tick (or
   reverts to the previous value with the row highlighted) when it lands or
   fails, the way a save button already tells you.

216. 2026-09-05 · BGP staff / desktop + phone (QA r557) · The Lease Events
   board's four urgency tiles (OVERDUE, DUE < 3 MONTHS, DUE < 6 MONTHS,
   WATCHING 18 MO) are read-only numbers — they carry no click handler at all,
   and the board's only filters are status, type and free text. So the tile
   that says the pipeline's most useful thing ("DUE < 3 MONTHS: 4") cannot
   produce those four rows; the user has to eyeball the date column. r556 has
   just established the opposite convention next door on the tenancy board,
   where each KPI tile filters to exactly what it counts. Suggestion: make the
   urgency tiles filter the board (and toggle off on a second click), matching
   the tenancy board.

213. 2026-09-05 · BGP staff / desktop (QA r556) · Victoria's task was "what's
   coming up at Bluewater in the next six months". The tenancy board holds the
   answer — 72 of the 200 rows carry a lease expiry, two of them already
   lapsed (23 Jun 2026, still "Occupied") and one expiring the next day — but
   the Lease Events board, the screen built to work that pipeline, is empty
   and can only be filled by retyping each one into the Log-event dialog. The
   tenancy board even has a "Lease Event" status and a KPI tile for it, and
   the two never meet. Suggestion: on the tenancy board, a row-level "Track as
   lease event" action (and/or a bulk "add all expiries in the next 18 months")
   that pre-fills tenant, unit, address, expiry date and passing rent/ERV from
   the row, so the lease-advisory pipeline starts from the schedule the firm
   already holds instead of from an empty board.

214. 2026-09-05 · BGP staff / desktop (QA r556) · On the Lease Events board
   the Owner column is a proper person picker (it renders a coloured "Victoria"
   pill), but opening the same row's Edit dialog shows "Assigned to =
   72715f6f-905d-40f4-bded-5275175f3e2b" — a raw user UUID in a free-text box,
   under a placeholder that suggests an email ("peter@..."). Anyone editing
   another field is one keystroke away from replacing a valid owner id with a
   name the pill can't resolve. Suggestion: make the dialog's Assigned-to the
   same team picker the board row uses (or at minimum show the person's name
   and keep the id behind it).

211. 2026-09-05 · BGP staff / desktop (QA r555) · Following one fee through
   every surface that shows it, the Board Report's headline card now correctly
   reads "FEES BILLED YTD £0" — but the board pack's whole point at month end
   is "what have we earned and what's coming", and the only other number on
   the card is an unrelated "7 total deals in pipeline". The WIP book (£250,000
   unbilled in the fixture) is on a different screen entirely. Suggestion: put
   the WIP figure beside the billed one on that card — "Billed YTD £0 · WIP
   (unbilled) £250,000" — sourced from the same INV/WIP split the WIP report
   uses, so the board sees revenue and forecast in one line instead of one
   number that looks like the business did nothing this year.

212. 2026-09-05 · BGP staff / desktop (QA r555) · Same pass, on the Board
   Report's KPI strip: "AVG DEAL SIZE £353K — Across all deals with fees" is
   computed over the two deals that carry a fee, while the five deals sitting
   at £0 (most of the fixture's real letting deals) are excluded silently, and
   the card next to it counts all seven. So the same strip mixes two different
   denominators without saying so, and the average reads far higher than the
   book. Suggestion: say the denominator on the card — "£353K · avg of 2
   priced deals (5 deals have no fee recorded)" — so nobody quotes an average
   that only two deals contributed to.

209. 2026-09-05 · BGP staff / mobile 390px (QA r554) · Victoria opened the
   phone home screen at month end to see where her billing stood. The finance
   tile reads "MY BILLING — 2026/27  £0 Billed · £0 Commission · £0 Potential
   · £0 Negotiating · £0 Solicitors", and the very next tile, same column, is
   "TOTAL BILLING  £250,000". Two different scopes (her personal commission
   vs the whole firm's WIP book) with near-identical names and nothing on the
   second saying whose money it is — and in the fixture the £250,000 isn't
   hers, her team's, or even her client's. Suggestion: name the scope on the
   roll-up tile ("Firm WIP" or "Total billing — firm") and give it a sub-line
   like "whole firm · tap for the WIP report", so the two tiles can't be read
   as one number and its total.

210. 2026-09-05 · BGP staff / mobile 390px (QA r554) · Same journey, on the
   WIP report itself: the question Victoria actually has on the train is
   "what's on MY book this month", and the phone report only answers it for
   the whole firm. The slice exists — NET FEES BY BGP CONTACT and the BGP
   Contact filter — but it's a filter sheet several taps down, and the money
   tiles at the top (WIP / INVOICED / NET FEES BY MONTH) never move until you
   find it. Suggestion: a "Mine" / "My team" / "All" pill row directly under
   the header on the phone, defaulting to Mine, driving the same filter the
   sheet sets — so the first number on the screen is the one she came for.

207. 2026-09-05 · Landsec client / desktop (QA r553) · Sweeping Mark's own
   forms for staff-only content, the Letting Tracker's Interest dialog
   describes BGP's mailbox to him: "Brands and agents who've expressed
   interest — mostly auto-detected from the team's inbox." A landlord reading
   that learns his agent's email is being mined, and still isn't told where
   any given row came from. Suggestion: for a client, say "logged by your BGP
   team" (or, per row, "picked up by BGP" vs "logged by you") and keep the
   inbox mechanics on the staff copy.

208. 2026-09-05 · Landsec client / desktop (QA r553) · With BGP's fee
   subtotals removed from his Deals tiles (this round's fix), the client's
   status tiles now carry a count and nothing else — the whole value row is
   gone, where staff still get a £ figure. A landlord's equivalent summary
   isn't fees, it's rent: suggestion is to put total headline rent p.a. (or
   passing rent) across the filtered deals in that slot for client accounts,
   so the tiles stay as informative as staff's rather than just shorter.

205. 2026-09-05 · Landsec client / mobile 390px (QA r552) · Mark was at
   Bluewater when an agent offered on U124 and wanted to record the offer and
   move the unit on. Logging the offer from the phone worked (Offer (1) on
   the card, every figure echoed back correctly), but there the trail stops:
   the tracker's own filter chips right above read OPPORTUNITY / MARKETING /
   NEGOTIATING / HOTS / SOLICITORS, and the Unit Status select in his Edit
   dialog offers only Opportunity and Available — past marketing the unit is
   "driven by the deal" (intended, 2026-09-01), and the phone card carries no
   deal action. So the offer he just logged sits at "Pending" forever from his
   side and the unit stays "Marketing" with an offer on it. Suggestion: put a
   "Create deal from this offer" action on the offer row (client-safe — the
   deal POST already forces their own company and strips fees), so the offer
   drives the pipeline the board is built around.

206. 2026-09-05 · Landsec client / mobile 390px (QA r552) · same journey —
   after saving the offer Mark has no signal that BGP has it. The dialog shows
   the row as "Pending" with no company on it (he had no CRM company to pick
   on the phone), no "BGP notified" confirmation, and nothing appears on his
   Tasks or Messages. A landlord who has just typed a £250,000 offer into his
   phone at a shopping centre wants to know it reached someone. Suggestion:
   on a client-authored offer or viewing, echo "Sent to your BGP team" in the
   toast and raise it on the BGP side (deal/unit activity feed or the team's
   notifications), and default the offer's company to free text so the row
   isn't headed "No company".

203. 2026-09-05 · BGP staff / desktop (QA r551) · Victoria uploaded a rent roll
   through Import. The toast reported "200 units imported · Unrecognised
   columns (not imported): #, Break Details, Basement (GIA), ... ITZA / ITGF"
   — a one-line success message with a comma list of dropped columns buried at
   the end of it, gone as soon as the toast faded. Fourteen columns of a
   200-row sheet were discarded and nothing on the board afterwards said so.
   Suggestion: make the import result a small dismissible panel above the
   board rather than a toast — "200 rows imported · 13 columns not recognised"
   with the list expandable, and keep it until dismissed. Anything that drops
   data is worth a second look, and a toast is the one UI element a user
   cannot go back to.

204. 2026-09-05 · BGP staff / desktop (QA r551) · Import silently chooses
   between adding to the schedule and replacing it: the client sends
   clearExisting=true whenever the board already has rows, so uploading a
   partial sheet (one zone, a handful of corrected units) deletes the other
   199 rows with no warning and no undo. Nothing in the UI says "Import"
   means "replace everything". Suggestion: ask on upload — "Replace all 200
   rows, or add these to the schedule?" — defaulting to replace so today's
   behaviour is one click away, and name the row count in the confirm.

201. 2026-09-05 · Landsec client / desktop 1440px (QA r550) · Mark clicked the
   dashboard's "Expiring (6m) · 8" tile, picked a tenant off the popover and
   landed on the Bluewater tenancy schedule — all 200 rows, unfiltered, with
   no way to ask the board the question the tile just answered. To rebuild the
   list he has to read the Expiry column down 200 rows, or sort by it and
   count. SUGGESTION: an "Expiring ≤ 6m" lozenge in the schedule's stat strip
   alongside Occupied / Vacant (the strip already filters on click), and carry
   the tile's intent through the link — /tenancy-schedule/:id?expiring=6m —
   so the click that started the question lands on its answer.

202. 2026-09-05 · Landsec client / desktop 1440px (QA r550) · the tenancy
   schedule's Excel export drops the one row the board shows that isn't a
   tenancy record: the Letting Tracker's projected vacancy. The screen header
   says "200 units", the file Mark forwards says "199 units" and is one unit
   short, with nothing to say which. SUGGESTION: either export the projected
   vacancies too (flagged in a Status/Source column so a rent roll isn't
   inflated by them) or state the basis in the footer — "199 tenancy records ·
   1 tracker vacancy not exported" — so the two counts explain themselves.

199. 2026-09-05 · BGP staff / desktop (QA r549) · Victoria recorded a new
   letting comp, then opened Rent Analysis on it and worked the NER through
   properly — term, break, rent free, fit-out, NIA, ITZA. The calculator gets
   it right, and then there is nowhere for the answer to go: the only exits
   are "Download Excel" and "Close". The comp's own Net Effective / Overall
   (psf) / £ psf (NIA) fields sit empty on the row behind unless she closes
   the dialog and retypes each figure by hand into the schedule. SUGGESTION:
   a "Save to comp" button in the calculator footer that writes back
   netEffectiveRent, overallRate, effectiveRatePsf, niaSqft, itzaSqft, term,
   breakClause, rentFreeMonths and fitoutContribution — the Excel export
   already carries exactly that writeback map (appendBgpMeta's writeback
   refs), so the fields are already identified; only the in-app path is
   missing.

200. 2026-09-05 · BGP staff / desktop (QA r549) · the Add Leasing Comp dialog
   asks for the six fields that identify a comp (property, tenant, area, use
   class, transaction type, headline rent, Zone A, date) but none of the ones
   the schedule needs to devalue it — no area, no term, no break, no rent
   free, no incentive. So every comp created in-app lands on the board with
   "—" in Overall (psf), Net Effective and £ psf, and only fills in later if
   someone remembers to open the detail panel. SUGGESTION: add a collapsed
   "Lease terms (optional)" section to the create dialog carrying NIA, term,
   break, rent free (mths) and tenant incentive — the same five inputs the
   NER calculator asks for — so a comp is analysable the moment it is saved.

197. 2026-09-05 · BGP staff / desktop (QA r548) · Victoria captured a real
   operator brief on Requirements — "1,200-1,800 sq ft, prime pitch". The
   only size input is a chip row of fixed bands (Under 500 / 500-1,000 /
   1,000-2,000 …), so the actual range she was given has to go in the
   free-text Comments box, where the matcher never sees it. She picked the
   nearest band instead, and the Fits column then matched on THAT band, not
   on the brief. SUGGESTION: keep the bands as quick-pick, but add an
   optional numeric min/max pair beside them that overrides the band when
   filled — parseReqSize already parses a "1200-1800" string, so the
   matching engine needs no change, only the honest number.

198. 2026-09-05 · BGP staff / desktop (QA r548) · the "Matching Available
   Units" dialog is a dead end. The Fits cell in the same row gives every
   unit a "+ brief" button that puts it straight onto the unit brief; open
   the fuller list through the Match button and the identical units become
   plain read-only rows — no brief, no link to the unit, no way to log
   interest. So the moment Victoria wants more than the top few fits, she
   loses the action. SUGGESTION: give each dialog row the same "+ brief"
   control (and make the unit name a link to the tracker unit), so the
   dialog is the long version of the cell rather than a weaker one.

196. 2026-09-05 · BGP staff / desktop (QA r547) · the notification bell is a
   nag counter, not an inbox. Victoria's bell carries a red "10" that never
   moves: every item is derived live from deal state (5 × "KYC not approved",
   4 × "stuck in <status>", 1 × "N deals with no fee"), so there is no read
   state, no dismiss, no snooze and no "mark all". Clicking a row does
   navigate to the deal — correctly — but the row keeps its unread dot and
   the badge still says 10 when you come back, so the bell teaches the team
   to ignore it. SUGGESTION: give the derived notifications a per-user
   dismissed/snoozed-until record (dismiss ⟶ hidden until that deal's
   underlying condition changes, snooze ⟶ hidden for N days), show the badge
   as undismissed-only, and add a "Mark all seen". Secondary: the rows are
   plain <div onClick> in notification-center.tsx — no role, no tabIndex —
   so the panel cannot be worked from the keyboard at all.

195. 2026-09-05 · BGP staff / desktop (QA r547) · WIP report → nothing tells
   you the Target Month cell is editable. On /wip-report the Deal Detail
   table renders a bare native <input type="month"> per row, so an empty
   target reads as the browser's "--------- ----" placeholder sitting in the
   middle of an otherwise read-only-looking table — it looks like a broken
   cell rather than "click here to forecast this fee". The rest of the row
   uses styled inline editors (the Deal Status pill via InlineLabelSelect).
   SUGGESTION: render the empty state as an "— Set month" affordance in the
   table's own type scale that swaps to the month input on click, matching
   the Deal Status cell, so the fee forecast reads as data with an edit
   action rather than as a form field wedged into a report.

194. 2026-09-05 · BGP staff / mobile 390px (QA r546) · "the Letting Tracker
   has no way in from the phone home screen". Victoria's phone home has an
   Ask-ChatBGP row, My Billing, Total billing, Team Expenses, four tiles
   (Deals / Expenses / Images / CRM) and a BOARDS row (Brand Intelligence /
   Comps / SharePoint / Property Intelligence) — but nothing for /available,
   which is the screen she actually works from standing in a unit. The only
   routes to it on the phone are the global-search palette in the header or
   a deep link. SUGGESTION: add a "Letting Tracker" tile to the phone home
   tile grid (next to Deals), or a tracker card like the Team Expenses row
   showing live counts (e.g. "12 available · 3 under offer").

193. 2026-09-05 · BGP staff / mobile 390px (QA r546) · "file the travel
   expense from the train". /m/expenses is receipt-photo-only: one "Add a
   receipt" button feeding a file input, captioned "AI fills the rest".
   Two gaps. (a) There is NO manual claim path — mileage, a train fare paid
   by contactless with no paper receipt, or a lost receipt cannot be claimed
   from the phone at all; she has to wait until she is at a desk. (b) When
   the AI parse fails the WHOLE submission is rejected (400) and the photo
   is discarded — the toast says "Upload failed" and RECENT still reads "No
   expenses yet", so the claim is simply lost and she must re-shoot the
   receipt. Verified locally with no AI key, but a Claude outage or an
   unreadable receipt does the same thing in production. SUGGESTION: keep
   the uploaded receipt whatever the AI does — save the expense as a draft
   with the photo attached and let her fill merchant / amount / date by hand
   (the desktop form already has those fields and an aiError fallback), and
   add an "Enter manually" link under "Add a receipt" for no-receipt claims.

192. 2026-09-05 · BGP staff (MLRO) + the CUSTOMER / desktop (QA r545) ·
   walked the tokenised KYC upload portal end to end for the first time:
   Victoria issues a link on a deal (POST /api/aml/deal/:id/upload-link),
   the customer opens /kyc-upload/<token> with no BGP login and drops a
   proof-of-address. The customer's side is genuinely good — branded page,
   the three doc types spelled out, one click to browse, the file comes back
   ticked with its classification, no login, no overflow. What happens next
   is the problem. processInboundKycFile (server/aml-portal.ts:265) runs the
   AI analysis, writes ONE metadata row to kyc_upload_files (filename,
   content type, size, ai_classification) and lets the temp file be
   unlinked; the bytes are never stored anywhere. And NOTHING in the app
   reads kyc_upload_files — grep finds only the CREATE TABLE and that INSERT.
   So the MLRO's only evidence that a passport arrived is the "used · 1
   upload" count on the link chip in the deal AML panel: no filename, no
   classification, no way to open what the customer sent — and the two
   panels sit inches apart on the deal page disagreeing with each other,
   "AI SOURCE-OF-FUNDS 0 docs" directly above "CLIENT UPLOAD LINKS ·
   Used · 1 upload" (qa/smoke-shots/r545-aml-upload-links.png). The portal
   meanwhile tells the customer in writing that "Documents are stored
   securely in BGP's UK SharePoint, accessible only to the deal team and our
   MLRO", which is not currently true.
   **r603 re-read the byte path — unchanged — plus two facts that sharpen the
   decision.** (1) `kyc_upload_files` still has exactly one writer and ZERO
   readers app-wide: one CREATE TABLE (server/index.ts:1986), one INSERT
   (aml-portal.ts:306), nothing else in server/, shared/, client/ or
   migrations/. The bytes go to `os.tmpdir()`, are read once by the text
   extractor, and are `fs.unlinkSync`-ed in a `finally`
   (aml-portal.ts:280-301) — nothing is retained. (2) **"BGP's UK SharePoint"
   would still be untrue after the obvious fix**: the app's own document store
   is a Postgres `bytea` table — `saveFile()` INSERTs into `file_storage` and
   serves it back at `/api/chat-media/<key>` (file-storage.ts:7) — and that is
   where every staff-uploaded KYC document already lands
   (`POST /api/kyc/documents/upload`, aml-compliance.ts:650-680). So r603
   corrected only the customer-facing sentence to what is true today
   (kyc-upload.tsx) and left retention alone. **The decision that actually
   blocks the fix is not "where" but "whose":** `KycPanel` lists documents from
   `GET /api/kyc/company/:id`, which filters `kyc_documents WHERE
   company_id = $1` (aml-compliance.ts:739), while the portal link is issued
   per DEAL and per contact email — so persisting a portal upload where the
   MLRO can see it means choosing which counterparty company on the deal it
   hangs off (landlord? tenant? both?), or teaching the panel to read
   deal-scoped rows. Suggestion (needs Woody's call on
   WHERE the bytes land — SharePoint via Graph like the deal Files panel, or
   the existing kyc document store used by POST /api/kyc/documents/upload):
   (a) persist the uploaded file, (b) put an "Documents received" list on
   the deal AML panel reading kyc_upload_files — name · classification ·
   size · when · open — so the sign-off has something to look at, and
   (c) until (a) exists, soften the portal's storage promise. Verified live
   this round: upload returns 200 and classifies even with no AI key (the
   analyser fails soft), so this is about retention and visibility, not the
   upload path itself. Shots qa/smoke-shots/r545-kyc-portal-*.png.

191. 2026-09-05 · Landsec client / mobile 390px (QA r544) · "the agent asked
   about U124 — which unit is that?" from the Letting Tracker search · the
   filtered card list came back as "U124/U125/U126" twice and "U124" once,
   and the unit Files dialog titled itself "U124/U125/U126, Bluewater,
   Bluewater · Bluewater Shopping Centre". The repetition is in the DATA —
   available_units.unit_name carries the imported label verbatim, and the
   phone then prints unit + property + address on one truncating line, so the
   only part that identifies the unit is what gets cut. Suggestion: normalise
   the unit label on display — strip a trailing repetition of the property or
   town from unit_name (and/or de-duplicate it at tenancy-import time), so a
   card reads "U124/U125/U126 · Bluewater Shopping Centre" once. Two rows for
   the same unit numbers (one with 9,307 sq ft, one with nothing) is the same
   import-hygiene family as the carried Bluewater SPINE duplicates.

190. 2026-09-05 · Landsec client / mobile 390px (QA r544) · opening his own
   deal ("U124 Bluewater — Gail's letting", at Solicitors) from the phone
   Deals tab · the whole Overview is Team / Parties / "Last updated" — 381
   characters. Fees are stripped from clients by design, but rent p.a., lease
   length and target completion date are not, and the page renders no row for
   them at all when they are unset, so a landlord at Solicitors stage cannot
   tell whether the terms are unknown to him or simply not recorded yet.
   Suggestion: give the client deal Overview a commercial line — Rent p.a. /
   Lease length / Target completion — with the same explicit "—" the
   Properties table now uses (r542), so an empty deal reads as "BGP hasn't
   filled this in" rather than as a broken page.

189. 2026-09-05 · BGP staff / desktop 1440px (QA r543) · reading the Board
   Report before a partners' meeting · the top-left KPI is labelled "FEES
   BILLED YTD £707K" with the sub-line "7 total deals in pipeline" — but the
   figure is the sum of fees across the whole PIPELINE (the fixture's £707K
   is two un-invoiced negotiating deals), not fees actually billed. On a
   board deliverable that is the one number nobody should have to
   double-check. Suggestion: either rename the tile to "PIPELINE FEES YTD",
   or keep the name and total only deals in an invoiced/completed status
   (isInvoicedStatus already exists in @shared/deal-status) and show the
   pipeline figure as a second tile.

187. 2026-09-05 · Landsec client / desktop 1440px (QA r542) · "who is my BGP
   contact for Bluewater?" from the Properties table · the BGP CONTACTS
   column is empty for every client property, because it is fed by
   `/api/crm/property-agents` (per-property staff links, which nobody fills
   in) — while the client's own dashboard DOES name their BGP team from
   `bgp_contact_user_ids` on the company row, and the Portfolio "Your BGP
   Team" card renders a whole org chart from it. So the one place a landlord
   looks per-building says nothing. Suggestion: when a property has no
   property-agent links, fall back to the landlord company's
   `bgp_contact_user_ids` for the client view (labelled "account team" so
   it doesn't imply a per-building assignment). r542 fixed the cell rendering
   as literal blank space; this is the data behind it.

188. 2026-09-05 · Landsec client / desktop 1440px (QA r542) · checking rent
   evidence on /comps before a regear conversation · the filter strip offers
   seventeen hardcoded LONDON area chips (Mayfair, City, Covent Garden,
   Marylebone, Chelsea, Fitzrovia, Farringdon, Islington, Kings Cross, Soho,
   Midtown, Paddington, Richmond, East London, SE1 / London Bridge, Camden,
   Other) directly under a stat reading "0 areas", to a landlord whose
   portfolio is Bluewater (Kent) and Westgate. Every chip filters to nothing.
   Suggestion: drive the area chips off the areas actually present in the
   viewer's visible comps (that is what the "N areas" stat already counts),
   and hide the strip entirely when that set is empty — the London list is
   BGP's own patch, not a client's.

185. 2026-09-05 · BGP staff / phone 390px (QA r541) · opening a group chat
   just created from Messages -> New Group · the member sub-line under the
   group name reads "Victoria, Alex, Cara, Victoria · Tap to edit" — the
   creator is printed once from `creatorName` and again from the members
   list, so whoever made the group sees their own name twice, and the
   duplicate eats one of the three name slots before the "+N" overflow.
   Suggestion: drop the creator from the members slice before joining (or
   drop the separate `creatorName` prefix and let the members list speak),
   so three DISTINCT people show before the "+N".

186. 2026-09-05 · BGP staff / desktop (QA r541) · asking the Letting
   Tracker's AI "who should we pitch this unit to" · the suggestion rows
   sourced from live requirements are titled with the REQUIREMENT's name,
   not the operator's — a requirement recorded as "Unit 12 relocation" or
   "2026 expansion" shows up in the pitch list under that name, and the
   target it writes onto the unit's brief carries it too, so the brief ends
   up naming a requirement instead of a brand. Suggestion: title live-
   requirement suggestions with the requirement's company name where it has
   one (`company_id` is already selected), keeping the requirement name as
   the reason sub-line.

183. 2026-09-05 · BGP staff / desktop (QA r540) · logging a new leasing
   requirement and expecting the Fits column to find space · the Add-
   requirement dialog's location input is a row of REGION chips (South East,
   Midlands, National, Scotland …), but the fits engine only counts a
   location when the chip text appears literally inside the property name or
   address (`propText.includes(l)` in the matches handler). "South East"
   never appears in "Bluewater Shopping Centre, DA9 9ST", so a region-level
   requirement gets zero location credit and rides on its size band alone —
   and a national requirement scores the same at every property. Suggestion:
   map each region chip to its postcode areas (or a region column on the
   property) so regional demand actually scores, and let "National" match
   everything rather than nothing.

184. 2026-09-05 · BGP staff / desktop (QA r540) · a requirement saved with no
   size band · the fits engine bails on any requirement it can't parse a
   size out of (`parseReqSize` returns null → `continue`), so the row sits
   at "—" fits forever with "Set use / Set type / Set size" placeholders and
   never counts towards the "N / M fit your available units" KPI. Nothing on
   the board says why. Suggestion: the size band is the one field fits
   cannot work without — either make it required in the create dialog, or
   render the Fits cell as "Add a size to match units" (clickable into the
   inline size picker) instead of a bare dash.

181. 2026-09-04 · BGP staff / desktop (QA r539) · looking at the Bluewater
   Letting Tracker · three units show as two, three or four byte-identical
   cards ('U062 Bluewater - Upper Level' ×4, 'L090 Bluewater' ×2, 'L130
   Bluewater - Lower Level' ×2) because the tenancy schedule genuinely
   carries the unit that many times. The projection now refuses to ADD a
   twin (r539 fix), but nothing surfaces the ones already there — an agent
   can't tell which card carries the viewings. Suggestion: flag same-name
   cards on a property with a small "2 rows on the schedule" chip that opens
   the existing tenancy merge tool, so a dirty imported schedule is visible
   and fixable from where it hurts rather than only from the spine screen.

182. 2026-09-04 · BGP staff / desktop (QA r539) · deleting a row from a
   tenancy schedule · the delete cascade nulls the projection's
   tenancy_unit_id but leaves the Letting Tracker card standing, now
   attached to nothing. It is defensible (the card may own viewings), but it
   is silent: the agent thinks they removed a unit and it stays on the
   board. Suggestion: on tenancy-row delete, either say so in the toast
   ("the tracker card stays — remove it separately") or offer to remove the
   orphaned card when it has no viewings, offers or deal attached.

180. 2026-09-04 · BGP staff / mobile 390px (QA r538) · standing in the mall
   logging a keen operator against unit L112 from the phone tracker · the
   Interest dialog's company picker is a popover anchored under its trigger,
   so on a 390×844 screen it opens straight over the rest of the form — Note
   and "Log interest" are both underneath it — and the list runs off the
   bottom edge (17 brands, 9 visible). It works (there is a search box), but
   you pick blind to what you are filling in. The logged row then prints its
   date as the raw "2026-09-04" while every other surface on the phone says
   "4 Sep"/"4 September". SUGGESTION: on phones render the picker as a
   bottom sheet (the pattern the Files and Add-unit dialogs already use)
   rather than an anchored popover, and format the interest row's date the
   same way the viewing/offer rows do.

179. 2026-09-04 · BGP staff / mobile 390px (QA r538) · ticking off a task on
   My Tasks between viewings · the done-toggle is a 20×20px circle at the
   left of the row — the most-tapped control on the page and the smallest
   thing on it, well under the 44px in docs/DESIGN.md, and it sits directly
   beside the wrapping title so a near-miss opens nothing at all.
   SUGGESTION: keep the 20px circle as the visual but give it a 44px
   hit area (padding on the button, negative margin on the row) — no
   layout change, and the row stops feeling like a target you have to aim
   at one-handed.

178. 2026-09-04 · BGP staff / mobile 390px (QA r538) · same task row · the
   row's action cluster is pin / pencil / + / trash, each 28px wide and
   ~6px apart on a 390px screen, and the trash deletes the task on the
   first tap — no confirm, no undo toast (tasks.tsx:280 →
   deleteMutation.mutate). The phone Messages list already does this
   properly: swipe-delete a conversation and you get "Delete this
   conversation? This cannot be undone." SUGGESTION: match it — confirm
   (or an undo toast) before a task disappears, and move the trash out of
   the inline cluster on phones into the edit sheet so it isn't a
   thumb-width from the pencil.

177. 2026-09-04 · BGP staff / desktop 1440px (QA r537) · checking the /map
   annotation-layer sidebar while gating it for clients · a layer shared with
   the team shows as "Brent Cross deck  3  SHARED" — name, item count and a
   SHARED tag, but never WHOSE it is, and the delete × only renders on your
   own rows. So on a team with several shared layers a staff user can see the
   set and not tell who to ask about one, or which of two similarly-named
   layers is theirs. The handler already returns ownerId on every row, so
   nothing new needs fetching. SUGGESTION: on shared rows that aren't yours,
   print the owner's first name where the SHARED tag sits (resolve ownerId
   through the staff directory, "· Victoria"), and keep SHARED only for your
   own shared layers where the owner is implied.

176. 2026-09-04 · BGP staff / desktop 1440px (QA r537) · same sidebar · the
   Annotate panel's footnote reads "Tap any annotation on the map to delete
   it. Saved per user." — but the panel immediately above it puts every new
   annotation into the ACTIVE LAYER, which can be a team-shared one, and
   /api/map-annotations returns the whole firm's annotations to any staff
   login rather than just the caller's. "Saved per user" is therefore wrong
   in both directions: colleagues see what you draw, and the × deletes rows
   that may not be yours. SUGGESTION: replace the line with what actually
   happens — "Saved to the active layer. Team-shared layers are visible to
   everyone at BGP." — and, if delete really should be owner-only, enforce it
   in the handler rather than implying it in the copy.

175. 2026-09-04 · Landsec client / mobile 390px (QA r536) · "what's BGP got
   on this week" — opened Calendar on the phone · the CRM intelligence strip
   along the bottom shows Mark a tile reading "BUSIEST AGENT
   victoria@brucegillinghampollard.com — 2 events in 30 days". Two things
   read wrong to a landlord: the person is identified by her raw work EMAIL
   rather than her name (everywhere else in the client shell — "YOUR BGP
   TEAM", portfolio contacts — she is "Victoria, Head of National"), and
   "busiest agent" is a BGP-internal activity ranking framed as if the
   client should care who at BGP is busiest. The handler already company-
   jails the numbers, so the data is his own; it's the framing and the
   identifier that jar. SUGGESTION: resolve the agent to a display name (fall
   back to the email only if no user row matches), and for client viewers
   relabel the tile to something portfolio-facing — "YOUR BGP CONTACT ·
   Victoria — 2 events in 30 days" — or drop that one tile from the client
   strip and keep the five portfolio tiles.

174. 2026-09-04 · Landsec client / mobile 390px (QA r536) · "check the comps
   evidence before the rent review" — opened Comps on the phone · the phone
   card list gives each comp ONE line: the comp name truncated
   ("QA-COMP R536, Bluewater Shopping …") plus an AI button. No rent, no
   £/sq ft, no size, no date, no unit. For rent-review evidence the number
   IS the content, so the list is unreadable at a glance and every comp
   needs a tap to be worth anything — while the strip directly above it
   already prints "1 comp · 0 verified · 0 areas". Desktop shows the columns.
   SUGGESTION: give the phone card the same three facts the desktop row
   leads with — rent (£/sq ft), size, and date — as a sub-line under the
   name, and let the name wrap to two lines instead of truncating, per the
   desktop-table / phone-card-list rule in docs/DESIGN.md.

173. 2026-09-04 · BGP staff / desktop 1440px (QA r535) · while gating the CRM
   leads pipeline, opened /leads as Victoria · the page is a working board
   (search, "Add lead", a proper empty state) but it sits in the sidebar
   BELOW the fold under "Core" with nothing linking it to the rest of the
   prospecting flow — Brand Intelligence's AI leads (/api/leads), the
   news-intel BD leads and Comps' "11 AI leads awaiting review" are three
   OTHER lead pools, each on its own screen, none of them cross-referenced.
   A new starter asked "where are our leads?" would find one of the four and
   assume it was the list. SUGGESTION: not a new feature — one line of copy
   on each of the four boards naming the other three and what each is for
   ("manually-entered prospects", "AI-generated from brand signals",
   "mined from news", "unreviewed comp evidence"), so the pools stop reading
   as the same thing.

172. 2026-09-04 · Landsec client / desktop 1440px (QA r534) · "quarterly
   leasing catch-up — whose buildings are these?" · on /properties the
   OWNERSHIP column truncates every chip to three characters ("Client /
   Landlord · Lan…", "Freeholder · Landsec"), while STATUS, CLASS and TEAM
   are all "—" and roughly 500px of the row sits empty. The one piece of
   information the chip exists to carry — WHO — is the part that gets cut.
   SUGGESTION: let the ownership cell take the slack from the empty columns
   (or drop the "Client / Landlord ·" prefix to a tooltip and show the name),
   so the landlord reads at a glance.

171. 2026-09-04 · Landsec client / desktop 1440px (QA r534) · "tidy up my
   own deal row on the Deals table" · r534 made the party pickers read-only
   for clients (UX #155, list-wide). What is left is a QUESTION for Woody
   rather than a defect: on their own deals a client can still inline-edit
   DEAL STATUS, DEAL TYPE, LEASE TERMS, the property/unit link, and — the
   part that looks wrong from BGP's side — the BGP TEAM and INTERNAL AGENT
   chips. Probed against the running server: PUT /api/crm/deals/:id accepts
   all of them from a client login (dealType, team, leaseLength, landlordId
   all persisted; only fee fields are stripped and the AML gate blocks a
   status jump to EXC). So a client can silently reassign which BGP team and
   which BGP agent owns their deal. SUGGESTION: strip team/internalAgent (and
   any other BGP-internal assignment field) from client PUTs server-side and
   render those two chips read-only, and decide whether deal status/type
   should be the client's to set at all or BGP's alone.

170. 2026-09-04 · BGP staff / desktop 1440px (QA r533) · followed a
   "Messages" link/bookmark on desktop to pick up a team conversation · the
   route redirects to /chatbgp (by design — /messages is the mobile chat
   tab), but with no AI key configured ChatBGP renders a FULL-PAGE dead end:
   "Not Connected — AI service is not configured. Please contact your
   administrator to enable ChatBGP." There is no nav, no thread list and no
   way back to team chat from that screen — person-to-person messaging needs
   no AI at all, so an AI outage (or a key rotation) reads as "messaging is
   down". SUGGESTION: keep the ChatBGP composer disabled with that notice,
   but still render the page shell + thread list, so team conversations stay
   readable and openable when the AI service is unavailable.

169. 2026-09-04 · BGP staff / desktop 1440px (QA r532) · opened Requirements
   to check what leasing briefs were live · the page renders the table HEADER
   ROW (Name / Date / Status / Use / Requirement Type / Size / Req. Locations)
   over a ~130px tall empty grey slab with NO empty state at all — no icon, no
   copy, no call to action, just "0 active requirements" in the strip above.
   Comps, Evidence Plans and the tracker all have a proper icon + sentence +
   action empty state; Requirements is the odd one out, and a first-time user
   can't tell whether it's empty or still loading. SUGGESTION: give both
   Requirements tabs (LEASING and INVESTMENT) the house empty state — icon,
   "No leasing requirements yet", one line of guidance, and an "Add
   requirement" button that opens the same dialog as the header button.

   (r534 addendum: identical on the LANDSEC CLIENT at 1440px — Mark's
   Requirements page is headers over an empty grey block with no line
   explaining what a requirement is or that BGP fills them in. Same fix,
   both personas.)

168. 2026-09-04 · BGP staff / desktop 1440px (QA r532) · went to Comps for
   rent-review evidence on a Bluewater unit · the strip reads "0 comps · 0
   verified · 11 AI leads awaiting review · 0 areas" and the body says "No
   matching comps — Try adjusting your filters". The advice is wrong: no
   filter change can help, because every one of the 11 comps in the system is
   an unreviewed AI lead and the table only ever shows CONFIRMED comps. The
   answer sits in the strip one line above, but nothing connects them, so the
   user clears filters, re-searches, and concludes the comps database is
   empty. SUGGESTION: when there are 0 confirmed comps but N leads, swap the
   empty state for "All N comps are AI leads awaiting review" plus a button
   that opens the leads panel; keep "Try adjusting your filters" for the case
   where confirmed comps exist but the filters exclude them.

167. 2026-09-04 · Landsec client / desktop 1440px (QA r531) · looked at
   "Your BGP Team" on the dashboard while auditing the client-teams routes ·
   the board renders SEVEN empty kanban columns (Office / Corporate,
   Investment, Lease Advisory, National Leasing, Development, Tenant Rep,
   London Leasing) each saying "drop here", with both of Landsec's actual
   people — Victoria Broadhead and Woody Bruce — parked in an eighth
   "UNASSIGNED" column, then ~300px of empty board below. A landlord reading
   it cold sees a mostly-blank board and no answer to "who do I call".
   Suggestion: collapse (or hide) columns with zero members for client
   viewers and render UNASSIGNED first, so a 2-person team reads as two
   cards rather than seven vacancies; keep the full column set on the staff
   side, where the columns are the editing surface.

166. 2026-09-04 · BGP staff / mobile 390px (QA r530) · between viewings,
   wanted her own numbers · the phone home screen leads with "MY BILLING —
   2026/27" showing £0 Billed / £0 Commission / £0 Potential / £0
   Negotiating / £0 Solicitors, and immediately under it "TOTAL BILLING
   £250,000". Read cold on a phone that looks like the app has lost her
   figures, when the truth is the firm's six live deals simply have no BGP
   contact set to her. Suggestion: when a staff user's own billing is all
   zero, say why on the tile — "No deals with you as BGP contact yet" —
   instead of five £0s, and label the tile below "TOTAL BILLING (firm)" so
   the two numbers can't read as the same figure.

165. 2026-09-04 · BGP staff / mobile 390px (QA r530) · wanted the Letting
   Tracker on her phone · nothing on the phone shell points at it: the four
   bottom tabs are Dashboard / Messages / Deals / News, and the home
   screen's tiles are Deals, Expenses, Images, CRM + Brand Intelligence,
   Comps, SharePoint, Property Intelligence. The tracker is reachable only
   by typing the URL, by global search, or two hops via the billing tile →
   WIP Report → its "Letting Tracker" pill. It is the board leasing staff
   live in day to day, and the client shell shows a Tasks tab for less.
   Suggestion: add a "Letting Tracker" tile to the phone home screen's
   first tile row (it already renders a proper phone card list, verified
   this round at 390px), or swap it in for one of the BOARDS tiles.

164. 2026-09-04 · Landsec client / phone 390px + desktop (QA r529) · logged
   a viewing from the Letting Tracker and typed a brand the CRM doesn't
   hold yet · since r528 the client's company picker correctly no longer
   offers the staff-only "Create company" row, but what replaces it is a
   bare "No matches." — a dead end that doesn't say the name can still be
   typed into the notes, or that BGP add companies. Staff, one login over,
   get "Create company '<name>'". Suggestion: give the client picker its
   own empty state — "No match — type the brand in the notes and your BGP
   team will add it" — so the removed control leaves guidance behind
   rather than a full stop.

163. 2026-09-04 · Landsec client / mobile 390px (QA r528) · logged an offer
   from a Letting Tracker unit card on the phone · "Save Offer" is enabled
   with the form untouched, so a stray tap creates an offer row with no
   company, no rent and no date content behind it — the exact shape #154
   was confirmed to block for viewings, on the sibling dialog two buttons
   away (the viewing Save correctly stays disabled until company/contact/
   attendees/notes is set). Suggestion: apply #154's guard to the offer
   dialog — require at least one of company/contact/rent before Save
   enables (and the same for the Interest dialog).

162. 2026-09-04 · Landsec client / mobile 390px (QA r528) · opened the app on
   the phone, wanted to search for a unit and check notifications from the
   home tab · #156's phone-shell header search + bell are there on every
   normal route (/available, /deals, /news…) but NOT on the Dashboard tab —
   "/" renders the mobile dashboard shell, which has its own header with no
   search icon and no bell, so the first screen of the app is the one place
   the client can't search or see notifications from. Suggestion: put the
   same GlobalSearch + NotificationCenter pair in the mobile dashboard
   header so the entry points don't disappear on the home tab.

161. 2026-09-04 · BGP staff / desktop 1440px (QA r527) · opened a bookmarked
   /subscriptions link as a non-admin (Victoria, Head of National) · the
   page loads, but its "API Keys & Environment" panel reads "Status
   unavailable" and still offers the admin controls: pressing "Test Apollo /
   Xero / CH" paints three red XCircle tiles — "Apollo.io Request failed",
   "Companies House Request failed", "Xero Request failed" plus a
   "Connect / Reconnect Xero" prompt — because /api/integrations/status and
   /api/integrations/ping are requireAdmin. It reads as "the firm's
   integrations are down", not "this bit is admin-only". The page is out of
   her sidebar (adminNavBase renders only when user.isAdmin), so this is the
   pasted-URL/bookmark path — but /finance and /expenses route-gate
   (EquityRoute/AdminRoute) while /subscriptions, /whatsapp, /addins and
   /settings don't. Suggestion: either wrap /subscriptions in AdminRoute
   like /expenses, or hide the keys panel for non-admins and label the
   failure "Admin only" instead of a red request-failed state.

160. 2026-09-04 · Landsec client / desktop 1440px (QA r526) · read Brand News
   for stories on their own brands · each card's footer prints the raw
   signal_type token from the database — "Starbucks · sector_move · 3 Aug
   2026", also "portfolio_change", "leadership" — machine field names in a
   client-facing feed. Suggestion: map the tokens to sentence-case labels
   ("Sector move", "News", "Opening") on the client feed, same as the deal
   status labels do.

159. 2026-09-04 · Landsec client / desktop 1440px (QA r526) · scanned the
   portfolio dashboard KPI strip · two tiles end in a dangling fragment:
   Total Units reads "124 occupied · 77 vacant · full rent roll" and
   Occupancy "38.3% vacancy · of full rent roll", which next to a Passing
   Rent tile showing "—  no passing rent recorded yet" reads as if a figure
   failed to load rather than as a note about the denominator. Suggestion:
   fold the qualifier into the tile's own sentence ("across the full rent
   roll") or drop it — the strip already says which units are counted.

158. 2026-09-04 · Landsec client / desktop 1440px (QA r526) · opened their
   own deals from the Deals hub · #155 shipped read-only party slots on the
   deal DETAIL page ("Not set yet — your BGP team will link parties"), but
   the Deals TABLE one click earlier still shows the staff pickers for the
   same two fields — the Client column's "+ Link landlord" (the open #129
   complaint) and a Tenant column "+ Link tenant" that opens the full
   company directory (Amorino, Honi Poke, Starbucks, Testco…) and writes
   the deal. Same deal, two behaviours, one of them the one #155 was
   confirmed to remove. Suggestion: decide #129 with #155's answer — client
   party cells read-only in the table too (Client defaulting to their own
   company), leaving the Edit dialog as the one place a client sets parties.

157. 2026-09-04 · BGP staff / desktop 1440px (QA r524) · searched the Letting
   Tracker for a unit, then clicked the FY "Viewings 2" strip chip to see
   which units had viewings — the chip is a global toggle that intersects
   with the search, so the list dropped to 0 rows while the strip still said
   "Viewings 2", and the only explanation ("showing units with viewings —
   click again to clear") sits far right in small text. Suggest the strip
   counters reflect the active search/filters (or the chip clears the search),
   so the numbers users see match the rows below.

150. 2026-09-03 · Landsec client / desktop 1440px (QA r500) · tried to open
    an account/profile menu from the sidebar footer · clicking "Mark Warne"
    (or the MW avatar) does nothing — the only affordance there is the
    small logout arrow, and there is no client-facing account surface at
    all (change password, notification prefs, email). Clients who want to
    change their password have to ask BGP. Suggestion: make the name/avatar
    open a small menu (Account, Log out) even if Account only offers a
    change-password form for now.

129. 2026-09-02 · Landsec client / desktop 1440px (QA r452) · reviewing
    their own deals on the Deals board · both Landsec deals show an empty
    "Client" column with a staff-worded "+ Link landlord" affordance — as
    the client, "who the client is" is themselves, and the empty cell +
    staff jargon reads like something is broken or unassigned · for client
    users, default the deal's client cell to their own company name (or at
    least relabel the empty state "Link client" and pre-select their
    company in the picker, which now only offers Landsec anyway).

128. 2026-09-01 · BGP staff / desktop 1440px (QA r450) · using the WIP
    report's TEAM cross-filter board to see how the teams are tracking ·
    the board opened showing "National £0" and "National Leasing £0" while
    the headline right above says "Total net fees: £250,000" — the only
    fee-bearing deal has no team set, so both team rows read £0 and the
    board looks broken even though the filter itself works · either bucket
    fee-bearing deals with no team into a visible "No team" row on the
    board (like the Client board's "—" handling), or show the deal count
    next to each row so £0 with 2 deals reads as "fees not filled in",
    not "nothing happening".

(Woody 2026-08-18, on confirming 50-64: "ignore 46 and 32" — the two entries
below stay parked, not built. Rounds shouldn't re-log them.)

127. 2026-09-01 · BGP staff / mobile 390px (QA r448) · searching landlords in
    CRM (Contacts → landlord search) · a query with no hits ("sa") empties
    the list to a bare blank area — only the small "0 results" counter next
    to the search box says anything, and on the phone it's easy to miss ·
    show a proper empty state in the list area ("No landlords match — clear
    search"), like the contacts card list already has.

126. 2026-09-01 · Landsec client / mobile 390px (QA r446) · opening the full
    Bluewater tenancy schedule on the phone · the page shows two stacked
    headers (the shell's "Tenancy Schedule" bar, then the page's own
    "Back to property / Tenancy Schedule" block) and the two-line page
    title leaves "· Bluewater Shopping Centre" hanging awkwardly in the
    right gutter · on the phone shell, collapse to the shell header alone
    (or one compact "Tenancy Schedule · Bluewater" line) so the schedule
    starts a screen-height sooner.

125. 2026-09-01 · Landsec client / desktop 1440px (QA r444) · reading the
    Bluewater tenancy schedule stat strip during quarterly-review prep ·
    "PASSING RENT" shows "—" when no rent is recorded but the neighbouring
    "AVG ERV £PSF" shows "0" for the same kind of missing data — a client
    could read that as a genuine £0 ERV · use the same dash-when-unset rule
    for ERV (and any other stat tiles) as passing rent.

124. 2026-09-01 · BGP staff / desktop 1440px (QA r442) · scanning Image
    Studio's LIBRARY tab · the sidebar category "Uncategorised" said 1 while
    the albums view showed an "Uncategorised" folder with 2 photos beside an
    "All 2" count — the sidebar counts images whose CATEGORY is
    Uncategorised, the album groups images with NO ADDRESS, two different
    meanings sharing one label on the same screen · rename the album folder
    (e.g. "No address") or count both by the same rule.

123. 2026-09-01 · staff + client / unit Files dialog (QA r438) · generated an
    info sheet on a unit whose particulars fields are all empty · the PDF
    prints the "PARTICULARS" heading + rule with nothing under it — a
    visibly empty page-1 body that an agent could accidentally issue ·
    suppress the heading when no particulars rows exist, or warn "this unit
    has no area/rent/EPC recorded" before generating.

122. 2026-09-01 · Landsec client / mobile 390px (QA r438) · tapped "Files"
    on a tracker unit card wanting the brochure · the dialog's second
    action is "Create in Doc Studio", which opens the staff Document Studio
    in a new tab — on the phone shell that's a dead end for a client ·
    hide the Doc Studio button for client logins (staff keep it).

121. 2026-09-01 · Landsec client / desktop 1440px (QA r436) · "see how my
    Bluewater lettings are progressing" · property page header metadata
    (Status, Asset Class, BGP Team, Website, Area) all rendered as bare
    em-dashes on the fixture — five "—" fields at the very top make the page
    look unfinished to a client · hide unset header fields (or collapse the
    block) instead of printing dash placeholders.

120. 2026-09-01 · Landsec client / desktop 1440px (QA r436) · scanning the
    Letting Tracker for progress · every Available row shows two adjacent
    pills that both read "Available" (Unit Status + Deal Status) — across 75
    rows the duplication is noise and hides the rows where the two actually
    differ · collapse to one pill when the values match, or visually
    de-emphasise the duplicate.

119. 2026-09-01 · Landsec client / desktop 1440px (QA r436) · followed a
    /turnover link while logged in as a client · the client shell doesn't
    register the route, so the app silently bounced to the dashboard — no
    message, looks like a broken link (the /api/turnover data itself is
    correctly slice-scoped) · show a "not available for client accounts"
    notice (or a client turnover slice page) instead of a silent redirect.

118. 2026-08-29 · Landsec client / ChatBGP (QA r426, code review — no browser
    this round) · "ask ChatBGP how my F&B tenants at Bluewater are trading" ·
    query_turnover was reachable from client chat but read the WHOLE turnover
    table (any landlord's schemes), so r426 blocked it for clients along with
    the other money tools — meaning a client now gets no turnover answer at
    all from chat · Suggest: a portfolio-scoped turnover path for client
    ChatBGP (filter to the caller's own properties, same slice as their Comps
    board), so the legit "how are MY tenants trading" ask works again.

117. 2026-08-29 · BGP staff / desktop 1440px (QA r422) · "message a colleague
    from the desktop chat panel" · Picking one person in New Message shows a
    button labelled "Create Group (1 member)" — the user is starting a 1:1,
    not a group; mobile already says "Start Chat" for a single pick ·
    Suggest: mirror mobile's label on desktop — "Start Chat" when exactly one
    member is selected, "Create Group (N members)" otherwise.

116. 2026-08-28 · BGP staff / desktop 1440px (QA r413) · "log yesterday's
    viewing with the brand, then record the offer they made" · Both steps
    work, but they are two fully separate dialogs: after saving a viewing
    with outcome "Offer Expected", recording the actual offer means closing
    the Viewings dialog, opening the Offers dialog on the same row and
    re-picking the same company/contact/date from scratch — double data
    entry for what the user experiences as one event ("they viewed, then
    offered") · Suggest: a "Record offer" shortcut on the viewing card (or
    shown after saving with outcome "Offer Expected") that opens the offer
    form pre-filled with the viewing's company, contact and date.

115. 2026-08-28 · Landsec client / mobile 390px (QA r409) · "a colleague
    mentioned a brand — look it up" · Brand Intelligence search for a brand
    that isn't in the client's slice (e.g. "Gail") says only "No matches for
    'Gail' — try a shorter name." Two issues: (a) "try a shorter name" is
    odd advice for a 4-letter query, and (b) the empty state never points at
    the "Add brand" button sitting directly above it, which searches the
    WIDER global directory and is exactly what the user needs next (the
    self-add flow itself works cleanly at 390px — verified this round).
    Suggest: zero-hit copy becomes "No matches in your brands — search the
    wider directory via Add brand" (mirrors the confirmed #13 pattern on
    Contacts).

114. 2026-08-28 · Landsec client / desktop 1440px (QA r407) · "see how my
    Bluewater lettings are progressing" · On the client Properties table
    (/properties, TABLE view) only the property NAME text is clickable —
    clicking anywhere else in the row (ownership chips aside, the row is
    mostly empty cells: Status/Class/Team all "—") does nothing, with no
    hover cue about where the click target is. Users treat list rows as
    click targets; a whole-row click (like the Letting Tracker rows) or at
    least a cursor-pointer row hover would remove the dead-click. Suggest:
    make the row itself open the property, keeping inner links working.

113. 2026-08-28 · BGP staff / mobile 390px (QA r403) · "on the train: check
    my diary for today" · The calendar page itself is genuinely phone-ready
    (day view, UPCOMING list, event bottom-sheet with attendees all render
    clean at 390px) but a staff phone user has NO tap path to it: bottom
    nav is Dashboard/Messages/Deals/News, the staff mobile-home QUICK_LINKS
    are Deals/Expenses/Images/CRM, and the only in-app links to /calendar
    live on the desktop dashboard widget and inside a deals-page meetings
    card that is M365-gated. Clients DO get a Calendar tile
    (PORTFOLIO_LINKS). Victoria has to type the URL or ask ChatBGP.
    Suggest: add a Calendar tile to QUICK_LINKS in mobile-home.tsx
    (mirroring the client grid), or surface a "today" diary strip on the
    staff mobile home that links through.

112. 2026-08-27 · Landsec client / mobile 390px (QA r401) · "check a tenant's
    covenant standing" · On a client's brand Compliance panel, when no UK
    trading entity is set the copy says "Not confirmed yet — BGP is
    identifying the UK trading entity." but immediately below it offers the
    client a "Search Companies House for ‘X’" link (external CH search).
    Mixed message: the client is told BGP is handling it, then handed the
    tool to do it themselves (and they can't save a match anyway — edit is
    staff-only). Suggest: hide the CH search link for client viewers
    (brand-profile-panel.tsx ~line 4130, gate on bcIsClient like the
    edit/rescrape buttons beside it).

111. 2026-08-27 · Landsec client / mobile 390px (QA r401) · "a colleague says
    Wagamama's lease is expiring — find their contact" · Wagamama Limited is
    on Mark's own tenancy schedule, but has no brand row in the directory,
    so Brand Intelligence search says "No matches for ‘wagamama’ — try a
    shorter name" and the Add-brand dialog (global directory search) also
    dead-ends at "No brands match." — there is NO path for a client to get
    their own tenant tracked from here (partly a fixture data gap, but the
    dead end is real whenever a tenancy tenant is missing from the
    directory). Suggest: when a client search misses, check the tenant
    names on their own tenancy schedules and offer "Wagamama is one of your
    tenants — ask BGP to add it" (request lands with staff), or auto-seed
    directory stubs from tenancy-schedule tenant names.

110. 2026-08-27 · Landsec client / desktop 1440px (QA r399) · "which leases
    expire soon — show me Wagamama's" · The dashboard EXPIRING (6M) KPI
    opens a tidy popover of 8 expiring tenants, but clicking a tenant lands
    on the full 200-unit Tenancy Schedule with no filter or highlight — the
    user has to re-type the tenant name into the schedule search to find the
    row they just clicked. Suggest: carry the tenant through (prefill the
    schedule search with the clicked tenant, or scroll-to + flash-highlight
    the matching row).

109. 2026-08-27 · BGP staff (non-admin) / desktop 1440px (QA r397) · "check
    my numbers on the WIP report" · For a non-admin agent the WIP REPORT
    tab lists deals (header said "6 transactions · £250,000") but the AGENT
    SUMMARY tab on the same screen came back empty — the summary endpoint
    only counts deals whose team exactly equals the user's team string
    (fixture deals carry team "National" vs Victoria's "National Leasing",
    and team-less deals are skipped entirely for non-admins), while the
    deal table clearly uses a looser rule · Align the two tabs' scoping
    (same team-matching rule, and decide whether team-less deals belong in
    a non-admin's summary) so the two tabs on one screen never disagree.
    Flagging as UX not bug: may be a fixture-data artifact — prod team
    strings may match exactly.

108. 2026-08-27 · BGP staff / desktop 1440px (QA r397) · "remove a fee split
    I added on the wrong deal" · Once a fee split is saved it cannot be
    cleared: the editor's BGP House row is locked and auto-re-added, saving
    with only BGP House trips "Percentages total 15% — must equal 100%",
    and the API rejects an empty allocations array by design (must include
    the BGP House row) · Add an explicit "Clear split" action on the Fee
    Allocation card (staff-only, confirm dialog) that removes all rows and
    returns the deal to "No split yet".

107. 2026-08-27 · BGP staff (equity) / mobile 390px (QA r395) · "check the
    cashflow forecast on my phone" · On the Finance page's cashflow stat
    tiles, big negative amounts render as "£" alone on one line with
    "(4,244,249)" wrapped underneath (LOW POINT / CLOSE tiles at 390px) —
    legible but scruffy · Keep the currency symbol glued to the number
    (non-breaking, e.g. £(4.24m) or whitespace-nowrap + smaller type on
    the phone tiles).

106. ~~2026-08-27 · BGP staff (equity) / mobile 390px (QA r394) · /cashflow
    phone double header~~ · OBSOLETE r395: cashflow v3 removed the
    standalone /cashflow page (it now redirects to /finance, which has no
    double header at 390px — verified r395). Nothing to build.

105. 2026-08-27 · Landsec client / mobile 390px (QA r393) · "look at the
    Bluewater floor plan on my phone" · The Plans viewer opens at 100% zoom
    showing one giant colour block, and its only usage hint reads "drag to
    pan · wheel to zoom" — there is no wheel on a phone, and no pinch-zoom
    hint or fit-to-screen start state · Start the plan fitted to the
    viewport and switch the hint to touch wording ("pinch to zoom") when
    the device is touch.

104. 2026-08-27 · Landsec client / mobile 390px (QA r393) · "open my
    Bluewater property page" · The Overview card leads with Status, Asset
    Class, BGP Team, Website and Area — all showing "—" dashes for the
    client's own flagship property, pushing the real content (ownership,
    tasks, risk register) below a card of empty placeholders · Hide
    unfilled fields for client viewers (or fill these fields for Landsec
    properties — Bluewater has no asset class or website set).

103. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "check a unit's
    rateable value" · The Business Rates entry-detail sheet slides up as a
    full-width bottom sheet at 1440px — each label sits at the far left and
    its value ~1,350px away at the far right, so the eye has to track the
    whole screen per row · Cap the sheet at ~640px (centred, or a right-hand
    side sheet on desktop); mobile behaviour is fine as is.

102. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "make a folder /
    delete a file in SharePoint" · New folder uses the native browser
    prompt() and delete uses confirm() — both work, but they're unstyled
    browser chrome in an app where every other action uses the design-system
    dialog, and the prompt offers no inline duplicate-name feedback (409
    only surfaces as a toast after submit) · Swap to the app Dialog with an
    input + validation message.

101. 2026-08-27 · Landsec client / desktop 1440px (QA r391) · "add a note-to-
    self on my Bluewater property page" · The This Week's Focus quick-add
    placeholder reads "Add a task — e.g. Pizza Express HOTs to legal" — BGP
    staff jargon (HOTs, a rival-agent-style example) shown to a landlord
    client · Give client viewers a client-flavoured example ("e.g. Chase
    Q3 leasing update") or a neutral "Add a task…".

100. 2026-08-26 · BGP staff / desktop 1440px (QA r389) · "log a viewing on
    a Bluewater unit from the Letting Tracker" · The per-unit Viewings /
    Offers count buttons live in the activity column, which sits off-screen
    to the right at 1440px — the visible Actions column only offers
    AI/comment/edit/delete, so logging a viewing means discovering a
    horizontal scroll first (the FY strip up top shows viewing counts,
    which makes the missing per-row affordance more surprising) · Surface
    a Viewing/Offer action in the always-visible Actions cluster (or its
    ⋯ menu), or pin the activity column so it stays on-screen.

99. 2026-08-26 · BGP staff / mobile 390px (QA r387) · "review the photos I
    took on a site visit in /m/images" · Tapping a photo in Recent Captures
    opens the Edit-with-AI sheet, where the photo itself is a small
    thumbnail strip at the top ("Tap to zoom" for the real view) — a user
    who just wants to LOOK at their capture gets an editing prompt and
    suggestion pills first, and the actual photo needs a second tap ·
    Open a full-screen viewer on tap (swipe between captures), with Edit
    with AI as an action on that viewer; keeps the one-tap edit path but
    makes the common "just look at it" case first-class.

98. 2026-08-26 · BGP staff / mobile 390px (QA r386) · "open the Planning
    documents dialog on a pathway run from a phone" · The dialog opens and
    is legible, but each application header keeps its desktop columns
    (date w-20 + LPA badge + PDF-count badge all shrink-0), leaving ~110px
    for the reference and description — refs like PP/25/06454 break
    mid-token onto two lines and descriptions wrap 2-3 words per line ·
    On <sm stack the header: date + badges on one small top line, ref +
    description full-width below (doc rows could do the same with their
    category pill).

97. 2026-08-26 · Landsec client / desktop (QA r383) · "scan my Letting
    Tracker to see how lettings are progressing" · Every row's Property/Unit
    headline is the truncated property name ("Bluewater Sho...") repeated
    153 times, while the distinguishing unit name sits in the small grey
    sub-line — for a client whose whole tracker is one property the primary
    line carries zero information and the eye has to read the sub-line on
    every row · Flip the emphasis (unit name as the headline, property as
    the sub-line), or at least stop truncating when the column is wide
    enough — staff multi-property boards can keep property-first.

96. 2026-08-25 · BGP staff / mobile 390px (QA r379) · "open a brand's Stores
    pill on the phone" · On a 0-store brand the auto-fired store scan's
    failure surfaces as a raw config string in a red toast ("Store search
    failed / GOOGLE_API_KEY not configured") that covers a third of the
    phone screen and outlives two pill switches · Map server-side config
    errors to a friendly "Store research isn't available right now" and
    keep the toast short — the raw error can go to the console/log instead.

94. 2026-08-25 · BGP staff / desktop (QA r373) · "log a £25m offer on The
    Royal Exchange from the Investment Tracker offers dialog" · When the
    save failed (pre-fix date 400), NOTHING happened — the add form just sat
    there: the viewing/offer/distribution dialog mutations in
    investment-tracker.tsx have no onError toast (the page-level mutations
    all do). The user can't tell a failed save from a slow one and may close
    the dialog believing the offer was logged · Add the standard onError
    destructive toast to the add/update/delete mutations inside
    ViewingsDialog, OffersDialog and DistributionsDialog.

93. 2026-08-25 · BGP staff / mobile 390px (QA r371) · "log an offer on a
    tracker unit" · When server validation rejects a form, the toast shows
    the raw zod text — e.g. 'Validation error: Number must be less than or
    equal to 8388607 at "rentPa"' (seen before the r371 cap fix; other
    forms still surface messages in this shape, field names in code-speak) ·
    Map validation failures to friendly wording using the form's field
    labels ("Rent p.a. is too large") before tossing them into the toast.

92. 2026-08-25 · Landsec client / mobile 390px (QA r369) · "search Brand
    Intelligence for a brand I'm scouting (Amorino)" · The search-result
    tile shows a blank white square where the logo should be when a brand
    has no logo image — looks broken next to the name · Fall back to the
    lettered avatar the brand profile header already uses (an "A" chip for
    Amorino) instead of an empty square.

83. 2026-08-21 · Landsec client / mobile 390px (QA r361) · "check my
    property on the PI map from my phone" · On the Map tool at 390px the
    map canvas runs underneath the fixed bottom nav: the Google Maps zoom
    "+/-" control sits half-hidden behind the Portfolio/…/News bar
    (bottom-right corner), and the search row's Resolve button touches the
    right edge. Everything still works, but zoom is a fiddly tap. Suggest
    giving the map container bottom padding equal to the bottom-nav height
    on mobile (and a little right inset on the search row).

82. 2026-08-21 · Landsec client / desktop 1440px (QA r360) · "review my
    saved Land Registry searches" · The Recent Searches cards show a status
    dropdown (New/Investigating/…) and a link-to-property button, but both
    write via PATCH /api/land-registry/searches/* which is staff-only — a
    client picking a status just gets a silent 403. Suggest rendering the
    status as a plain badge and hiding the link button for client logins
    (the statuses are acquisition-pipeline labels aimed at staff anyway).

81. 2026-08-21 · Landsec client / desktop 1440px (QA r359) · "look up my
    property on the Property Intelligence map" · The intelligence panel's
    header strip offers a "No Pathway run yet — Run Pathway" button, but
    Pathway is a hidden staff-only tool for clients (every
    /api/property-pathway route 403s), so the button can only dead-end;
    the panel also fires a 403'd pathway/latest fetch on every resolve.
    Suggest hiding the Pathway strip (and skipping the pathway/latest
    fetch) for client logins, as the Pathway/Investigator tabs already are.

80. 2026-08-20 · Landsec client / mobile 390px (QA r353) · "ask ChatBGP a
    question from my phone" · The empty-chat suggestion chips are one static
    list shared by every persona (AI_SUGGESTIONS in mobile-app.tsx), so a
    Landsec client is offered "Draft HOTs for a property" and "Search CRM
    contacts" — staff jobs they'd never phrase that way. Suggest a
    client-flavoured set when user.role is client, e.g. "What's happening
    across my portfolio?", "Which of my units are available?", "What's my
    passing rent at Bluewater?".

79. 2026-08-20 · Landsec client / desktop 1440px (QA r351) · "check what
    leasing requirements BGP is tracking for us" · The desktop Requirements
    table's empty state says the generic "No active requirements found" —
    the client-aware line from UX #38 ("No live requirements for your
    portfolio yet — BGP logs these on your behalf") was only wired into the
    mobile card view. A client at a desk gets no hint that this list is
    BGP-maintained rather than self-serve. Suggest reusing the same
    isClientView copy in the desktop table's empty row.

78. 2026-08-20 · BGP staff / desktop (QA r349) · "a new brand just rang about
    a unit — log the interest" · The Letting Tracker's Interest dialog only
    lets you pick a company that already exists in CRM (the combobox has no
    inline-create, unlike the investment tracker's picker which has an
    onCreate row). For a brand-new caller the user has to abandon the dialog,
    create the company in CRM, come back and reopen it. Suggest adding the
    same inline "create brand" row to the Interest (and Viewing/Offer)
    company pickers.

77. 2026-08-20 · BGP staff / mobile 390px (QA r347) · "check who's in Unit
    BX10 on the Bluewater tenancy board from my phone" · The full tenancy
    board's sticky Unit column is so narrow at 390px that unit names truncate
    to ~3 characters ("QA-…", "GLO…") — once you scroll the columns you can't
    tell which row is which. Suggest widening the sticky column a touch on
    mobile, or wrapping the unit name to two lines inside it.

46. 2026-08-14 · Landsec client / desktop 1440px (logged by QA r294 on the
    staging branch) · "check my property before a lease-expiry chat with
    BGP" · the property page's Compliance & KYC sidebar (deliberately
    client-visible per the 2026-08-01 decision) also exposes the BILLING
    ENTITY row as an EDITABLE control to clients — "+ Set billing entity"
    opens the full company-search dropdown and the PUT succeeds, letting a
    client change the SPV that BGP invoices its own fees to · Suggested:
    render the billing entity read-only (name badge only) for client
    viewers, same pattern as the brand-profile KYC staff-action gating.
    Needs Woody's numbered confirmation — not built.

32. 2026-08-11 · Landsec client / mobile 390px · "a colleague asked who our
    contact at Starbucks is — find them on my phone" · the brand profile at
    390px leads with the full-height Chat panel, so the KEY CONTACTS card
    (and everything else) starts more than one screen down; the contact
    lookup meant scrolling past a mostly-empty chat box every visit ·
    Suggested: on mobile, collapse the brand-profile chat to a compact
    "Ask about this brand" bar (expanding on tap) so contacts/covenant/
    signals are visible on the first screen.
    (r259 addendum: same layout confirmed on STAFF mobile 390px — Victoria's
    pre-meeting brand review also starts a full screen below the chat panel,
    so the fix should cover /companies/:id for both personas.)

## Confirmed / done

232. 2026-09-06 · Landsec client / desktop 1440px (QA r566) · Mark read the
    Occupational Costs and Covenant bands across a Bluewater row · Adjacent
    money columns disagree about being money: Service Charge and Insurance
    render "£90,552" / "£3,575", while Rates Payable, Rateable Value, Capex,
    Topped Up NOI, NOI (pa), Deposit Held and Arrears render "128,760" /
    "-26,176" with no £ at all — same row, same units, same sheet. The cause
    is that the number formatter decides currency from the FIELD NAME
    (rent/income/charge/insurance/erv/shortfall) rather than from the
    column's own declared type: those columns are all type "currency" in the
    column table and simply don't match the name test. Affects staff and
    client identically. Suggestion: format from the declared column type, so
    every column the schedule calls currency prints a £.
   → FIXED as a defect, not built as a suggestion — QA r567. The
    currency decision now comes from the declared column type (with the
    field-name test kept only as a fallback for money columns typed "num"),
    and the staff cell shares that one authority instead of repeating the
    rule, so Rates Payable / Deposit Held / Arrears read "£190,088" /
    "£72,000" / "£164,147" for both personas.

103. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "check a unit's
    rateable value" · The Business Rates entry-detail sheet slides up as a
    full-width bottom sheet at 1440px — each label sits at the far left and
    its value ~1,350px away at the far right, so the eye has to track the
    whole screen per row · Cap the sheet at ~640px (centred, or a right-hand
    side sheet on desktop); mobile behaviour is fine as is.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

102. 2026-08-27 · BGP staff / desktop 1440px (QA r392) · "make a folder /
    delete a file in SharePoint" · New folder uses the native browser
    prompt() and delete uses confirm() — both work, but they're unstyled
    browser chrome in an app where every other action uses the design-system
    dialog, and the prompt offers no inline duplicate-name feedback (409
    only surfaces as a toast after submit) · Swap to the app Dialog with an
    input + validation message.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

101. 2026-08-27 · Landsec client / desktop 1440px (QA r391) · "add a note-to-
    self on my Bluewater property page" · The This Week's Focus quick-add
    placeholder reads "Add a task — e.g. Pizza Express HOTs to legal" — BGP
    staff jargon (HOTs, a rival-agent-style example) shown to a landlord
    client · Give client viewers a client-flavoured example ("e.g. Chase
    Q3 leasing update") or a neutral "Add a task…".
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

100. 2026-08-26 · BGP staff / desktop 1440px (QA r389) · "log a viewing on
    a Bluewater unit from the Letting Tracker" · The per-unit Viewings /
    Offers count buttons live in the activity column, which sits off-screen
    to the right at 1440px — the visible Actions column only offers
    AI/comment/edit/delete, so logging a viewing means discovering a
    horizontal scroll first (the FY strip up top shows viewing counts,
    which makes the missing per-row affordance more surprising) · Surface
    a Viewing/Offer action in the always-visible Actions cluster (or its
    ⋯ menu), or pin the activity column so it stays on-screen.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

99. 2026-08-26 · BGP staff / mobile 390px (QA r387) · "review the photos I
    took on a site visit in /m/images" · Tapping a photo in Recent Captures
    opens the Edit-with-AI sheet, where the photo itself is a small
    thumbnail strip at the top ("Tap to zoom" for the real view) — a user
    who just wants to LOOK at their capture gets an editing prompt and
    suggestion pills first, and the actual photo needs a second tap ·
    Open a full-screen viewer on tap (swipe between captures), with Edit
    with AI as an action on that viewer; keeps the one-tap edit path but
    makes the common "just look at it" case first-class.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

98. 2026-08-26 · BGP staff / mobile 390px (QA r386) · "open the Planning
    documents dialog on a pathway run from a phone" · The dialog opens and
    is legible, but each application header keeps its desktop columns
    (date w-20 + LPA badge + PDF-count badge all shrink-0), leaving ~110px
    for the reference and description — refs like PP/25/06454 break
    mid-token onto two lines and descriptions wrap 2-3 words per line ·
    On <sm stack the header: date + badges on one small top line, ref +
    description full-width below (doc rows could do the same with their
    category pill).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

97. 2026-08-26 · Landsec client / desktop (QA r383) · "scan my Letting
    Tracker to see how lettings are progressing" · Every row's Property/Unit
    headline is the truncated property name ("Bluewater Sho...") repeated
    153 times, while the distinguishing unit name sits in the small grey
    sub-line — for a client whose whole tracker is one property the primary
    line carries zero information and the eye has to read the sub-line on
    every row · Flip the emphasis (unit name as the headline, property as
    the sub-line), or at least stop truncating when the column is wide
    enough — staff multi-property boards can keep property-first.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

95. 2026-08-25 · Landsec client / mobile 390px (QA r377) · "look up Starbucks
    from the phone Brands search and see who they are / who to call" · The
    brand profile opens on the CHAT pill ("Ask anything about Starbucks — @
    tags properties…"), which reads as an internal BGP tool; the client had
    to notice and tap Contacts/Intel to get what they came for · Land client
    logins on Contacts (or Intel) instead of Chat on the phone brand
    profile — staff can keep Chat-first.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

91. 2026-08-24 · Landsec client / desktop 1440px (QA r367) · "catch up on
    news about my tenants" · The Brand News list shows the same story twice
    when the raw feed headline and the normalised signal differ slightly —
    e.g. "Musician sues Starbucks for £2m after 'career-ending' incident in
    London branch - London Evening Standard" and "Musician sues Starbucks
    for £2m over incident at London branch" render as two entries a few rows
    apart. Brand-profile Signals already dedupe by normalised headline (UX
    #12); suggest applying the same near-duplicate collapse to the News tab
    list so clients don't read the same lawsuit twice.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

90. 2026-08-24 · Landsec client / desktop 1440px (QA r367) · "open the
    tenancy schedule" · Typing/bookmarking /tenancy-schedule silently lands
    on the Properties list with no explanation (the redirect is intended —
    the schedule is per-property) — the user asked for a schedule and gets
    a different page with no hint they should pick a property. Suggest a
    one-line toast or banner after the redirect: "Pick a property to open
    its tenancy schedule."
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

89. 2026-08-24 · Landsec client / desktop 1440px (QA r366) · "see which of
    my brands are active right now" · On Brand Intelligence → Overview, the
    Who's Hot rows use "d" for two different things side by side: a filled
    badge "1d" means 1 DEAL while the timestamp directly under it reads
    "21d" meaning 21 DAYS ago — a client can easily read the deal badge as
    another age. Suggest distinct labels (e.g. "1 deal" / badge tooltip, or
    "21d ago" for the timestamp) so the two "d"s can't be confused.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

88. 2026-08-24 · BGP staff / desktop 1440px (QA r365) · "pull turnover
    entries in from CRM comps" · Clicking From CRM Comps when no comp tenant
    matches a brand name just toasts "Created 0 draft entries from CRM comps
    (0 skipped)" and the board doesn't change — the user gets no hint WHY
    nothing matched (matching is exact name-equality between crm_comps.tenant
    and the brand book) or what to do next. Suggest the 0-created toast
    explain the match rule and point at the gap, e.g. "No comp tenants
    matched a brand name — check tenant spellings on the Comps board", and
    ideally list the top unmatched tenant names so staff can fix or add the
    brands.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

87. 2026-08-24 · BGP staff / desktop 1440px (QA r364) · "log a turnover
    figure for a brand" · Add Turnover Entry works cleanly, but a row added
    for Amorino (a Restaurant brand) lands with Category "—" because the
    dialog's Category select starts empty and nothing pre-fills it from the
    selected brand's companyType — the same brand's AI-estimate rows show
    "Restaurant", so the board's category filter now misses the hand-added
    row. Suggest defaulting the dialog's Category from the selected
    company's type (still editable). (Also noted in passing: the Brand
    dropdown renders only the first 100 companies with no search — fine on
    the fixture's 17, but on prod's full brand book most brands would be
    unreachable except via the free-text name fallback, which skips the
    company link. A searchable combobox would fix both.)
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

86. 2026-08-24 · BGP staff / desktop 1440px (QA r364) · "see who's earning
    what on the WIP report" · The Agent Summary tab on a book where no deal
    has an agent/BGP-contact assigned shows an "Agent Fee Breakdown" panel
    that is simply blank (header + empty body) and a 0-row table whose
    footer reads "Total £0 · £0 · £0 · 100%" — 100% of nothing. No hint
    of WHY it's empty. Suggest an empty state ("No fees are attributed to
    agents yet — assign a BGP contact on a deal to see the split") and
    suppressing the 100% when the total is zero.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

85. 2026-08-24 · BGP staff / mobile 390px (QA r363) · "look up a brand's
    contact from my phone" · On the brand profile's Contacts pill, the Key
    Contacts panel opened with "No property-tier contacts. Click Show all
    below." + "1 in CRM · no new contacts found" — the one contact the user
    wanted is behind an extra "Show all 1 contacts" tap. When there are no
    property-tier contacts but only a handful of CRM contacts, suggest just
    listing them straight away (keep the Show all gate for long lists).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

84. 2026-08-24 · BGP staff / mobile 390px (QA r363) · "open a deal from the
    Deals tab" · On the phone deal page the header back-arrow button wraps
    onto its own line below the deal title, landing next to the status chip
    (title takes the full 390px row, the ghost icon button drops under it) —
    it reads as a mystery "←" control mid-page rather than page chrome; the
    breadcrumb above already provides the way back. Suggest hiding the
    ghost back button below md (breadcrumb + bottom nav cover navigation)
    or pinning it into the top bar row.
   → DONE — already fixed by the 26 Aug deal-page redesign (back button hidden below md)

75. 2026-08-20 · Landsec client / mobile 390px (QA r345) · "look up Honi
    Poke on my phone before a meeting" · The brand profile's Chat card
    fills the entire first screen after the hero photo — Key Contacts,
    compliance and the actual brand facts all sit below the fold, so on a
    phone the profile reads as a chat app before it reads as a profile. ·
    Suggested: on mobile, render Chat collapsed (a "Chat" bar that expands
    on tap) or move it below Key Contacts, so facts come first.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

76. 2026-08-20 · Landsec client / mobile 390px (QA r345) · "check the old
    leasing strategy board" · The retired /leasing-schedule/:id board
    (banner says "This board is retired") still shows editing affordances
    to a client login — "Set band" / "Set positioning" buttons on every
    unit and an "Enable" button for Strategic Principles — BGP strategy
    controls that mean little to Mark and invite edits on a board nobody
    maintains. · Suggested: for client logins render the archived board
    read-only (keep the banner + reference data, drop the edit buttons).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

74. 2026-08-20 · BGP staff / desktop 1440px (QA r344) · "carry on working
    with a pending invoice verdict" · The new red verdict banner (fixed,
    top-0) overlays the app header instead of pushing it down, so the
    global search box and header controls sit hidden behind it for as long
    as a verdict is pending — annoying is the brief, but hiding search
    costs real workflows. · Suggested: give the authenticated shell a
    top offset when the banner is mounted (like iOS in-call bars) so the
    header stays usable; keep the banner un-dismissable.
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

70. 2026-08-19 · BGP staff / Letting Tracker mobile 390px (QA r339) ·
    "find unit L112 to log a viewing" · Every mobile unit card's headline
    is the PROPERTY name (`prop?.name || u.unitName`, available-units.tsx
    ~1687), so a Bluewater-filtered list shows 150 identical "Bluewater
    Shopping Centre" headlines with the actual unit ("L112 Bluewater")
    relegated to the small grey subtitle — scanning for a unit means
    reading subtitles. Same class as the r229 search-labelling fix. ·
    Suggested: lead with the unit name, property as the subtitle (or
    property once as a group header when filtered to one centre).
   → DONE — built 2026-08-27 (UX batch I, Woody: "Do them all")

Confirmed by Woody 2026-09-04 ("everything but 150" — #150 explicitly NOT
confirmed, remains open above); built same day by the parent session
(deployed with the r482-r522 bug-fix merge follow-up). #144 and #149 are
one fix (bottom-anchored phone toasts); #135 supersedes #42's "—" rows on
the phone tracker cards. Not yet browser-verified — QA rounds to judge the
new behaviour as intended:
156. 2026-09-04 · BGP staff / mobile 390px (QA r522) · tried to look
    something up quickly and check notifications between viewings · the
    staff phone shell has NO global-search or notifications entry point —
    desktop's header has both (⌘K search box + bell with a badge showing
    10 unread), but on the phone Victoria can only search within
    individual pages (tracker, brands, contacts) and never sees her
    notifications at all. Suggestion: add a search icon and a bell (badge
    count) to the phone-shell header, opening the same ⌘K palette and
    notifications popover the desktop uses.

155. 2026-09-04 · Landsec client / mobile 390px (QA r520) · opened their own
    deal's detail page · the Overview "Parties" card shows empty Landlord/
    Tenant slots with staff-worded "+ Link landlord" / "+ Link tenant"
    affordances — to the landlord viewing their own deal the empty Landlord
    slot plus staff jargon reads like the deal is set up wrong (same
    complaint as #129 on the deals board's Client column). Suggestion:
    for client users default the Landlord party to their own company and
    show parties read-only-ish ("Not set yet — your BGP team will link
    parties") rather than staff link-pickers.

154. 2026-09-04 · Landsec client / mobile 390px (QA r520) · logged a viewing
    from the tracker's Viewings dialog · tapping "Save Viewing" with the
    form untouched (only the defaulted date) succeeds and creates a
    "No company — 2026-09-04" row in the shared viewing log; on a phone the
    button sits right under the keyboard so an accidental empty save is
    easy, and the row flows into FY counts and staff reports. Company-less
    viewings are intended (2026-08-09 #9), but a fully empty one carries no
    information. Suggestion: disable Save until at least one of company/
    contact/attendees/notes is set.

153. 2026-09-04 · Landsec client / desktop 1440px (QA r518) · scanned the
    Bluewater Tenancy Schedule KPI strip on the property page · the Service
    Charge tile wraps its £11,370,076 total mid-digit ("£11,370,07 / 6") in
    the embedded 7-column strip — the figure misreads at a glance (the Full
    Board page fits it on one line). break-words was chosen deliberately over
    clipping, so suggest compact formatting for 7-figure sums in the embedded
    strip (e.g. "£11.37m", full figure on hover/title), matching the
    dashboard's compact-KPI style.

152. 2026-09-03 · BGP staff / mobile 390px (QA r504) · reviewed a brand
    profile then moved on to the calendar · the profile's auto-fired store
    scan failed a few seconds later (keyless env) and its red "Store search
    failed / GOOGLE_API_KEY not configured" toast popped mid-screen over the
    calendar — a raw config error on a page that had nothing to do with it.
    Suggestion: don't toast failures of background auto-fired scans at all
    (log to the stores diagnostic strip instead); keep toasts for
    user-initiated scans. Related: #96 (friendly wording), 149 (mid-screen
    placement).

151. 2026-09-03 · Landsec client / mobile 390px (QA r502) · opened the Files
    dialog on a Letting Tracker unit · the generator row reads "Info sheet —
    branded PDF for agents/tenants", which is BGP-side language: to a
    landlord client "for agents/tenants" reads like it's not for them, and
    it's unclear what they'd get. Suggestion: client-facing copy for the
    same control, e.g. "Unit info sheet — branded PDF" (keep the current
    wording for staff).

149. 2026-09-03 · BGP staff / mobile 390px (QA r496) · logged a phone-call
    interest on U124 from the tracker's Interest dialog · the "Interest
    logged" toast pops mid-screen and sits exactly over the row that was
    just added, so for a few seconds you can't see the thing you just
    created (same for the viewing/offer dialogs' toasts at 390px).
    Suggestion: bottom-anchor toasts on the phone shell so the
    confirmation stays out of the content's way.

148. 2026-09-03 · Landsec client / mobile 390px (QA r494) · tapped the Tasks
    tab to check open tasks on the phone · the AI Daily Briefing card fills
    the entire first viewport (title, spinner/Generate button, skeleton
    lines) before the "Tasks" list — the thing the tab is named for starts
    a full screen below the fold, and the one open task needs a scroll to
    see. Suggestion: on the phone Tasks tab, start the briefing card
    collapsed to its header row (like the property page's "Cost plan &
    inputs" pattern, remembered per device) or move it below the task
    list — tasks first on a tab called Tasks.

147. 2026-09-03 · Landsec client / desktop 1440px (QA r492) · logging this
    morning's offer on L112 from a brand not yet in the CRM · typed the
    company name into the offer form's Company picker, got "No matches.",
    saved anyway — the offer persisted as "No company" with the typed name
    silently discarded (the field visibly resets to "Select company", but a
    user focused on rent/terms will miss it). The API and the email-sync
    path both accept free-text companyName, and the Investment Tracker's
    CrmPicker already has an inline green "Create company '<name>'" row —
    the Letting Tracker's CrmPicker (offers + viewings dialogs,
    available-units.tsx:148) is the only picker without it. Suggestion:
    port the investment-tracker onCreate affordance (or accept the typed
    text as free-text companyName) so an unmatched company isn't lost.
    Affects staff and clients alike; clients can POST companies
    (allowlisted), so parity holds.

146. 2026-09-03 · BGP staff / desktop 1440px (QA r490) · reviewing U124 on the
    Letting Tracker before a client call · searched "U124" (3 of 81 units),
    the header still read "Viewings 2 · Offers 1", but U124's own dialogs
    said "No viewings recorded yet" / "No offers recorded yet" — the FY
    header counts are tracker-wide and ignore the active search/filters, so
    it reads like the data failed to load · Suggest: scope the header KPI
    counts to the filtered rows (or label them "all units") when a search or
    filter is active.

145. 2026-09-03 · BGP staff / mobile 390px (QA r488) · glancing at the Today
    page's Recent Deals list between viewings · a deal with no status renders
    an empty grey stage chip (a blank pill next to the deal name) — it reads
    as a rendering glitch rather than "no stage yet" · Suggest: hide the
    stage chip when the deal has no status, or show a muted "No stage" label
    instead of an empty pill.

144. 2026-09-03 · Landsec client / mobile 390px (QA r486) · logging a viewing
    then an offer from the Letting Tracker unit card · after Save, the
    success toast ("Viewing added" / "Offer added") renders as a large card
    centred over the middle of the dialog, exactly covering the just-added
    row for ~4s — the user can't see the thing they just created until the
    toast fades, and it also sits mid-form when the offer form is open ·
    Suggest: anchor toasts to the bottom edge (above the bottom nav) on the
    phone shell so dialog content stays visible.

143. 2026-09-03 · Landsec client / desktop 1440px (QA r484) · skimming Brand
    News for signals across the tenant slice · every article card shows a
    summary line that is a verbatim copy of the headline (title and
    description are identical for all wire rows), so each card says the same
    thing twice and the list reads as noise · Suggest: hide the description
    line when it equals (or startsWith) the headline, so cards collapse to
    one line unless the summary genuinely adds information — pairs with the
    existing near-duplicate-collapse suggestion for the News tab.

142. 2026-09-03 · BGP staff / desktop 1440px (QA r482) · a non-admin staff
    member following a link to /expenses (e.g. from my-expenses' "ask Woody
    or Layla… on the Expenses admin page" hint) · since r482 the admin-only
    /expenses and /expenses/revolut pages bounce non-admins back to the
    Dashboard (previously they rendered the full admin chrome over silently
    403'd data — "No spend yet this month" with dead admin buttons); the
    bounce is the house AdminRoute pattern but happens with no explanation ·
    Suggest: a one-line toast on the AdminRoute bounce ("That page needs
    admin access") so the redirect doesn't read as a broken link.

141. 2026-09-03 · BGP staff / mobile 390px (QA r480) · skimming the WIP
    report on the phone before a team call · the "Net fees by team" chart
    shows £0 for both teams (National, National Leasing) while the header
    says £250,000 total — the £250K deal has no team attributed, and fees
    without a team simply vanish from the by-team split, so the chart
    contradicts the total with no explanation (the Agent Summary tab
    handles the same case with a clear "no fees attributed yet — assign a
    BGP contact" empty state) · Suggest: add an "Unassigned" bar to the
    by-team (and by-client/by-property, if applicable) breakdowns when
    attributed fees don't sum to the total, or reuse the Agent Summary
    empty-state hint.

140. 2026-09-03 · Landsec client / mobile 390px (QA r478) · checking which
    brands are trading on the phone · the Brand Intelligence hub on mobile
    shows only Brand Explorer — the Turnover Board tab the client uses on
    desktop is deliberately hidden (brands-hub.tsx: other boards "still
    being built" on mobile) with no hint it exists or that it's
    desktop-only, so a client looking for turnover data on the phone finds
    nothing · Suggest: when the mobile turnover board ships, expose the tab;
    until then a small "Turnover Board is available on desktop" line (or a
    read-only card-list variant) would stop the dead-end.

139. 2026-09-03 · Landsec client / desktop 1440px (QA r476) · scanning the
    Brand Explorer for hospitality brand intel · the "Brand News" panel under
    the client's brand grid is a generic fashion-wire feed (WWD: Nike, Tom
    Ford, PVH, Sydney Sweeney…) — the panel filters articles to the Retail
    + Hospitality categories (brands-hub.tsx), and "Retail" is mostly
    fashion wire copy, so nothing relates to the client's hospitality/
    leisure/fitness slice or the 9 brands shown above it · for client
    logins, narrow Brand News to the slice categories (or match article
    text against visible brand names), with a "no relevant stories" empty
    state.

138. 2026-09-03 · BGP staff / desktop 1440px (QA r474) · picking a hero image
    in Image Studio · the word "Uncategorised" means two different things on
    the same screen: the CATEGORIES sidebar counts images whose category is
    "Uncategorised" (1 here), while the albums grid's "Uncategorised" folder
    counts images with no ADDRESS (2 here) — the mismatched numbers next to
    the same label read like a bug · rename the album folder to something
    address-flavoured ("No property / address") or unify the two counts.

137. 2026-09-03 · BGP staff / desktop 1440px (QA r472) · outlining units on
    a new Evidence Plan · after double-clicking to close an outline, the
    unit reference is asked for via a raw browser prompt() window — the
    only browser-chrome prompt in the app, it can't be styled, shows no
    context, and a stray Esc silently throws the just-drawn outline away ·
    replace with the app's own small dialog (unit ref field + Save/Cancel),
    keeping the drawn polygon on Cancel so it can be re-named rather than
    redrawn.

136. 2026-09-02 · Landsec client / mobile 390px (QA r470) · reviewing
    Bluewater's Boards section on the phone · the empty Brochures panel
    reads "No brochures yet — drop a PDF here or use Add." — drag-and-drop
    doesn't exist on a touch phone, so half the instruction is impossible
    and reads desktop-first (same panel/copy also serves staff mobile) ·
    on touch/mobile render the empty state as "No brochures yet — use Add"
    (keep the drop-zone copy for pointer devices).

135. 2026-09-02 · BGP staff / mobile 390px (QA r464) · working the Bluewater
    letting tracker on the phone (75 units in Marketing) · every unit card
    unconditionally reserves two label rows for Area and Rent p.a., and on
    this fixture most render as "Area —" / "Rent p.a. —", so scanning the
    list is mostly em-dash rows between unit names (the Tenant row already
    hides itself when empty) · hide the Area/Rent rows on the phone card
    when there's no value, matching the Tenant row's behaviour, so each
    card shrinks to what's actually known and more units fit per screen.

134. 2026-09-02 · Landsec client / mobile 390px (QA r462) · opening Bluewater's
    property page to review the asset · the Overview tab's first card stacks
    Status / Asset Class / BGP Team / Website — all four rendered as "—" on
    the fixture — so the first phone viewport after the header is mostly
    em-dashes before any real content (ownership, tasks, boards) appears ·
    on the client's phone view, collapse fields with no value (or float the
    populated Ownership rows to the top of the card) so the first screen
    shows information, not placeholders.

133. 2026-09-02 · Landsec client / desktop 1440px (QA r460) · reading the
    full tenancy schedule board during a portfolio review · the KPI strip
    mixes empty-state treatments: PASSING RENT shows "—" when no rent data
    exists, but the tile next to it reads "AVG ERV £PSF 0" — a literal
    zero that reads as "the ERV is £0" rather than "no ERV data" · show
    "—" (like passing rent) when no units carry an ERV.

132. 2026-09-02 · BGP staff / desktop 1440px (QA r458) · Requirements page
    while prepping a pitch · the toolbar mixes everyday actions (search,
    Add requirement, New Brand) with five maintenance/debug controls
    ("Refresh PIPnet", "Wipe & resync", "Inspect PIPnet", "Inspect Detail",
    "Refresh TRL", "Wipe & resync TRL") at equal visual weight — two of
    them start with "Wipe", one click from the search box, and nothing
    signals they're admin plumbing · move the inspect/wipe/resync controls
    behind a single "Sync tools" dropdown (or admin-only visibility) so the
    everyday row is Add requirement + search + New Brand.

131. 2026-09-02 · BGP staff / mobile 390px (QA r456) · opening a brand
    profile to prep a pitch on the phone · the 260px hero pane sits as a
    bare grey block for the first several seconds while the flagship
    street-view image loads (no spinner, no skeleton — on first visit it
    reads as a broken/empty panel filling half the viewport; it only
    collapses if the fetch errors) · give the hero pane a loading shimmer
    or fade the image in, so slow mobile networks see "loading" rather
    than "blank".

130. 2026-09-02 · Landsec client / mobile 390px (QA r454) · scanning the
    Letting Tracker cards on the phone · card titles read "L112 Bluewater,
    Bluewater" / "U124/U125/U126, Bluewater, B…" with "Bluewater Shopping
    Centre" repeated again on the subtitle line — the property name appears
    up to three times per card because unit_name embeds it and the title
    truncates at 390px before the distinguishing part · when the unit name
    ends with (or contains) the property name the card title could strip
    that suffix and let the subtitle carry the property, so the ~28 visible
    title chars go to the unit reference the user is actually scanning for.

Confirmed by Woody 2026-08-22 ("83"); built + visually verified same day
by the parent session (390px iPhone UA):
83. Mobile PI map no longer runs under the bottom nav: the Property
   Intelligence page drops its min-h-screen below md (the mobile shell
   already sizes the page to the space above the fixed nav), so the map's
   zoom +/- controls sit fully above the Portfolio/…/News bar; the map
   search row also gets a wider right inset at 390px (w-[calc(100%-32px)])
   so the Resolve button clears the screen edge. (Logged by QA r361 on
   staging; entry recorded here on the working branch.)

Confirmed by Woody 2026-08-20 ("71 should be automated too fro diaries?
72 65 68 73 67 66 69"); built same day by the parent session. Not yet
browser-verified unless a round has since covered them:
71. Interest is now writable: POST /api/available-units/:id/interest + a
   "Log interest" form in the unit's Interest dialog (company picker,
   date, note — mirrors add-viewing), AND a diary leg (syncDiaryInterest
   in viewing-sync.ts): non-viewing calls/meetings that name a tracker
   unit and involve a known external contact land as interest rows
   (source 'diary', cal_<iCalUId> dedupe, 90-day already-engaged check).
72. Teams + Agents tracker filters are hidden for client logins.
65. Deal-header BGP contact is always contactable for clients: agents on
   the account-team board keep their mailto; when none resolve to an
   email the account lead is appended so there's never an inert name.
68. Tracker header recounts under active search/filters ("n of m units").
73. Property page card retitled "Tenancy Schedule" to match the pop-out
   and the client nav.
67. Viewing cards no longer repeat the attendees line when it already
   headlines the card.
66. 390px tenancy Full Board: sticky Unit column capped at 120px
   (truncated) and the sticky actions column un-pins below md, freeing
   most of the viewport for the scrolling sheet.
69. Client PI hub gets a "My properties" quick-pick bar (client-scoped
   /api/crm/properties): one tap resolves the property page-wide —
   seeds the Map and prefills Land Registry + Business Rates via
   PropertyContext.

Confirmed by Woody 2026-08-18 ("do 64 63 62 61 60 59 58 57 56 55 54 53 52 51
50 … ignore 46 and 32"); built same day. None browser-verified yet unless
noted:
64. WAULT excludes terms over 60 yrs (placeholder 2154 expiries); the KPI
   tile shows an amber "n excluded — placeholder expiry" sub-line.
63. Deals-board stage chips recount against the active search (mobile chips
   and desktop status cards both use the searched set).
62. Tenancy Full Board headers are tap-to-sort (asc → desc → off, ▲/▼
   indicator; date/number/text aware, empty values sink) — "soonest expiry"
   answerable on a phone.
61. Image Studio Library "All" grid excludes Brands images, so the grid
   matches the "Library (n)" tab and rail counts.
60. Already existed (built with #39 in batch B): PeopleHub header has an
   "Add contact" button reusing ContactFormDialog.
59. Client Portfolio home (mobile) gets a compact "Your BGP team" row —
   avatars/name/role from the client-teams board, tap to email.
58. Viewings dialog headline falls back companyName → contactName →
   attendees → "No company" (offers have no attendees field).
57. "Deal created" toast carries a "View deal →" action navigating to the
   new deal (create returns the id through the mutation).
56. Staff get the same lightweight Add-event dialog as clients (team_events
   row, separate from Outlook sync); server now stamps created_by for staff
   creates so authors can delete their own events.
55. Mobile property page drops the duplicate "← Properties /" back-link row
   (top bar + breadcrumb remain).
54. Mobile news feed: Latest/Saved chip tabs + bookmark toggle per card,
   reusing /api/news-feed/engage + /saved (desktop saves show on phone).
53. Quick Access self-heals: opening a dead company link drops it from the
   recents list, and the not-found card gives clients "Brand not in your
   list" copy with a Brand Directory pointer.
52. Hand-added leasing requirements default requirementDate to today
   server-side (imports keep their own dates) — Fresh badge + 90-day KPI
   work immediately.
51. Mobile deal cards show Target (month/year) and "n d in <status>"
   (time-in-status from the deal audit log, overlaid server-side as
   statusChangedAt; falls back to created_at). Card field cap raised 4→5.
50. "Off tenancy spine" chip hidden from client viewers, and a nightly
   04:00 sweep (relinkOffSpineDeals) auto-stamps tenancy_unit_id where the
   confident (property, unit name) match now succeeds; staff tooltip
   mentions the auto-link.

Confirmed by Woody 2026-08-15 ("45 48 49"); built same day (suggestions 45,
48, 49 were logged by QA rounds r292-r295 on the staging branch — recorded
here since JOGQK is the canonical copy):
45. Tenancy schedule search feedback: the header clear-badge now covers
   search + status filters ("N of M · clear", clears all three), and on
   phones a match count renders directly under the Search box so typing
   gives visible feedback without scrolling past the KPI tiles.
48. Deal Comments card is append-only: comments POST to
   /api/crm/deals/:id/comments, which stamps author + time into the
   existing comments blob ("[15 Aug 2026, 10:47 · Name]" blocks) — a later
   comment can never overwrite an earlier one; each append is also written
   to the deal audit log. The card renders entries as a list with
   author/date lines; pre-existing free text shows as "Earlier note".
   API-verified both directions; not yet browser-verified.
49. News tag chips show per-tag match counts from the loaded feed and grey
   out / disable zero-match tags ("No matching articles in this feed"
   tooltip) — a sparse feed slice reads as a data gap, not a broken filter.
   Not yet browser-verified.

Confirmed by Woody 2026-08-13 ("image studio for non admin just needs to be
the same as it is for admin. 44 yes go ahead"); built + browser-verified
same day:
43. Full /image-studio is open to ALL staff — StudioRoute no longer bounces
   non-admins to /m/images and the sidebar entry points straight at
   /image-studio. Destructive maintenance endpoints (bulk/permanent delete,
   dedupe, bulk AI-tag) stay admin-only server-side. Two-bot scenario
   staff-image-studio-redirect replaced by staff-image-studio-full-access.
44. Client deal detail header shows "BGP contact: {name}" (mailto link)
   next to the tenant slot — the deal's internalAgent names when set, else
   the account team's flagged lead, else the first account-team member.
   Tracker unit rows left as-is for now (suggestion's "consider" clause).

Confirmed by Woody 2026-08-12 ("do all apart from 32" — #32 explicitly NOT
confirmed, remains open above); built 2026-08-12:
14. /m/images: desktop-aware copy ("Use") + non-admin staff hint that the
   full Image Studio is admin-only.
15. Brand profile "Pitch property" carries the brand to /available
   (?pitchBrand= banner + one-tap "+ brand" target add on any unit);
   "Add to deal" pre-fills the deals search with the brand name.
16. Dashboard Expiring (6m) tile opens a popover listing the expiring
   leases (sorted by expiry), each row linking to the tenancy schedule.
17. Tenancy header: Import / Excel / Re-sync / Columns collapse behind a
   "⋯ More" menu below `sm:` so unit rows start on the first screen.
18. Calendar opens in Week view when today is a weekend (work-week grid
   otherwise unchanged).
19. Deal Parties slots follow deal type — Landlord + Tenant on leasing,
   Vendor + Purchaser on Sale/Purchase; linked slots always shown.
20. Map at 390px: search bar full-width, Download Plan / Map-Satellite
   pills stack below it instead of covering it.
21. New client-scoped /api/client/map/pins (own portfolio only) — client
   map now shows their estates as pins; staff /api/map/pins stays 403.
22. Add Offer date defaults to today (matches Add Viewing).
23. Property Pathway board has its own "Start investigation" form
   (address + postcode → same run ChatBGP would start).
24. Letting Tracker unit-name click now opens the unit's targeting brief;
   inline rename moved behind a hover pencil icon.
25. Deal detail shows a client-visible "Your BGP contact(s)" line from the
   deal's internal agent (no fees).
26. Comps "AI leads" stat: admins get a button to the Leads tab,
   non-admins a tooltip ("an admin reviews these").
27. Add-brand dialog rows link to the brand profile once the brand is in
   the client's CRM; the added toast hints tap-to-open.
28. Tenancy schedule key-columns preset (Unit / Status / Tenant / Quoting
   Rent / Expiry): first-visit default on phones + one-tap "Key columns"
   / "All columns" toggle in ⋯ More and the Columns popover.
29. Mobile requirement cards get a Match button opening the existing
   RequirementMatchesDialog.
30. Targeting Brief dialog always renders the Target operators section;
   the brief auto-creates on first save/target add (no invisible gate).
31. FY Viewings / Offers chips on the tracker are now toggle filters —
   click to show only units with viewings/offers, click again to clear.
33. Client view disables Edit on agent contacts with a "Managed by BGP"
   tooltip (write gate already 403'd; affordance now matches).
34. Contact page "Log activity" (call / meeting / note + date + summary)
   posting into the same activity feed as synced items.
35. Client News feed: /news for client viewers lists brand signals scoped
   to their slice via new /api/client/news-signals + a News nav entry.
36. Deal audit log resolves company/property UUIDs to names (raw id kept
   in the tooltip).
37. Mobile calendar gets an "Upcoming" agenda block (next 5 events) above
   the day grid; tapping an entry opens the event.
38. Requirements empty state is filter-aware; unfiltered client copy says
   BGP logs requirements on their behalf.
39. Staff "Add contact" entry points: brand/company profile contacts board
   + CRM hub header, reusing the existing ContactFormDialog.
40. Client-visible brand expansion commentary strips the internal
   "Recommendation" (pitch strategy) section.
41. Instagram card empty state uses client-safe copy ("Instagram feed
   unavailable for this brand.").
42. Mobile tracker cards keep Area / Rent rows with an explicit "—" when
   unset (Tenant row only when present).

Confirmed by Woody 2026-08-09 ("go ahead with them all"); built + visually
verified same day (commit dbade8e0):
6.+8. Mobile landing is now the Dashboard (staff) / Portfolio (client) at "/";
   the unified Messages list moved to /messages (supersedes the 2026-08-05
   Messages-home decision — landing on an empty chat list read as a blank app).
7. Client Deals board subtitle now notes "+N letting deals on the Letting
   Tracker" when tracker-linked deals are excluded from the CRM list.
9. Viewing/offer row edit/delete controls: aria-labels + titles, larger tap
   targets, and "No company" instead of "Unknown".
10. Comps stats strip counts only table-visible comps; the AI stat now reads
   "N AI leads awaiting review".
11. Suggested Pitches rows show the reason as a sub-line (hover title kept).
12. Brand Signals dedupe near-identical headlines (first/newest wins).
13. Contacts zero-hit searches that match a company name show "Looking for a
   brand? Search Brand Intelligence →".

363. 2026-09-08 · Victoria (BGP staff) / desktop 1440px · QA r621 · **the
   Board Report's "Fees Billed YTD" now drops undated invoices silently — the
   board has no way to see what is missing from its headline number.** After
   this round's fix an INV deal carrying no invoice/completion/exchange date
   is excluded from `totalFeesYTD` and from the billed-by-month series
   (`crm.ts:6912`, `:9665`), which is correct — `updated_at` was never a
   billing date — but the KPI card just reads a smaller number, and the
   `/reporting` card's own subtitle still promises "Invoiced since 1 January"
   with nothing to say some invoices could not be dated. The WIP Report at
   least parks its undated money in a visible TBC bar. **Suggestion:** put the
   same footnote on both KPI cards — "£X of invoiced fees have no invoice
   date and are not counted" — and deep-link it to the Deal Detail rows so
   somebody can stamp the dates. The number to show already exists: it is the
   fee sum of `isInvoicedStatus` deals failing `hasDate`
   (`computeWipHealth`, `crm.ts:10154`).

364. 2026-09-08 · Victoria (BGP staff) / desktop 1440px · QA r621 ·
   **"Average Time to Close" is an average over an unstated subset.** The
   Board Report KPI and the time-to-close histogram only count EXC/COM/INV
   deals that carry a completion or exchange date AND close in 1-999 days
   (`crm.ts:6924-6931`); everything else is dropped without a denominator
   anywhere on the card. In the fixture that means one deal decides the
   number. **Suggestion:** show the denominator on the card ("381 days ·
   over 1 of 2 completed deals"), the way the Fees Billed card shows its
   "total deals in pipeline" sub.

Confirmed by Woody 2026-08-08 ("Do all 5"); built + visually verified same day:
1. 2026-08-08 · Letting Tracker viewing/offer rows now have an edit pencil —
   PATCH routes added for unit viewings + offers, form switches to edit mode.
2. 2026-08-08 · Add Viewing date defaults to today (still editable).
3. 2026-08-08 · Deals board: re-entering a gated stage (SOL/EXC/COM/INV) is
   allowed when it reverts the deal's most recent move (24h window) — the AML
   gate still blocks all other entries; reverts are audit-logged with
   revert: true in deal_events.
4. 2026-08-08 · Client dashboard passing-rent KPI shows "—" + "no passing
   rent recorded yet" instead of £0.0m when no rent data exists.
5. 2026-08-08 · Occupancy bases labelled: dashboard tiles say "full rent
   roll", leasing schedule says "Units on this board" / "board units only".
