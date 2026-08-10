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

29. 2026-08-10 · BGP staff / mobile 390px · logged a new operator
    requirement from a phone, then wanted to see which available units fit
    it · the requirements KPI tile advertises "0 / 1 fit your available
    units", but the mobile card view only offers Edit / Delete — the
    desktop rows' Match action (RequirementMatchesDialog), fit chips,
    Discuss and Send-to-brief are all desktop-only, so a phone user can
    see that fits exist but has no way to open them · Suggested: add a
    "Matches" action to the mobile requirement card (opens the existing
    RequirementMatchesDialog, which is a plain Dialog and should render
    fine at 390px), and make the fits KPI tile tappable to the same end.

28. 2026-08-10 · Landsec client / mobile 390px · opened the Bluewater
    tenancy schedule on a phone to find the asking (quoting) rent for a
    vacant unit · the board renders all ~50 columns in a 6,700px-wide
    table, so Quoting Rent sits ~3,400px of horizontal swiping to the
    right (sticky Unit column helps, but every rent lookup repeats the
    swipe); the Columns dialog works but means hand-unticking dozens of
    boxes on a phone · Suggested: a compact mobile preset (e.g. Unit /
    Status / Tenant / Quoting Rent / Expiry) applied by default below
    `sm:`, or a one-tap "Key columns" toggle next to Columns.
    (Companion to #17, which covers the stacked header controls.)

27. 2026-08-10 · Landsec client / desktop 1440px · added a brand from the
    global directory ("Add brand" → search → Add) to start tracking it ·
    the "Brand added to your CRM" toast has no link, the dialog rows aren't
    clickable, and the hub stays on the Overview tab (which never lists
    individual brands) — so the user must close the dialog, click the Brand
    Explorer tab and re-find the brand to actually look at it · Suggested:
    make the toast (or the row's "Added" badge) link straight to the brand
    profile, or switch the hub to Brand Explorer filtered to the new brand
    after an add.

26. 2026-08-10 · BGP staff / desktop 1440px · saw "11 AI leads awaiting
    review" in the Comps header and tried to review them · the stat is plain
    text — clicking does nothing, the All Comps filter only offers
    Verified/Unverified, and the Leads tab is deliberately parked admin-only
    (reachable via /admin/comps-leads → /comps?tab=leads), so non-admin
    staff see a count they can never act on · Suggested: either hide the
    stat for non-admins, or make it a link (admins → the Leads tab,
    non-admins → a tooltip saying an admin reviews these).

25. 2026-08-10 · Landsec client / mobile 390px · opened a Bluewater letting
    deal to find WHO at BGP to chase about progress · the deal page names no
    BGP person anywhere for a client — the agent/fee-allocation card is
    staff-only (rightly), Parties only holds landlord/tenant slots, and the
    fixture deal had no linked contacts — so "who do I chase?" ends in the
    generic Messages tab · Suggested: a small client-visible "Your BGP
    contact" line on deal detail (name + role from the deal's internal
    agent or the company's bgp_contact_user_ids, no fees), so the natural
    next step from a stalled deal is a person, not a blank.

24. 2026-08-10 · Landsec client / desktop 1440px · clicked a unit's name on
    the Letting Tracker board expecting to open/expand the unit · the name
    turned into an inline rename input right away (clients can edit units on
    their own property, so this fires for them too) — a click on a row title
    is the universal "open" gesture, and here it invites accidental renames
    with no drill-in anywhere on the row · Suggested: reserve inline rename
    for the pencil icon (which already exists next to the property name) and
    make the name click expand the row / open unit details.

23. 2026-08-10 · BGP staff / desktop 1440px · opened the Property Pathway
    board to prep a Bluewater pitch · the board can only START a run via
    ChatBGP ("ask it to start a pathway for 12 Haymarket") — an empty board
    offers no direct "New investigation" button, so the natural next step
    is a context switch to a chat window and a typed sentence · Suggested:
    a "Start investigation" button on the Pathway board itself (address
    picker → kicks the same run ChatBGP would).

22. 2026-08-09 · BGP staff / mobile 390px · logged a verbal offer on a
    Bluewater unit from the Letting Tracker's Interest button · the Add Offer
    form's Date field starts empty (mm/dd/yyyy placeholder) while the Add
    Viewing dialog right next to it defaults to today (confirmed UX #2) — on
    a phone, picking today's date in the native picker is the fiddliest part
    of an otherwise 30-second flow · Suggested: default the offer Date to
    today (still editable), matching the viewing dialog.

21. 2026-08-09 · Landsec client / mobile 390px · opened Property Intelligence
    → Map to look at their own estate · after the r233 fix the map loads
    without errors, but a client sees NO property pins at all — not even
    their own estates — because /api/map/pins is (rightly) staff-only: it
    returns the whole BGP property book unscoped · Suggested: a client-scoped
    pins read (own portfolio only) so the client map shows their estates;
    needs a scoping decision on the pins payload first.

20. 2026-08-09 · Landsec client / mobile 390px · tried to search an address
    on the Property Intelligence map · at 390px the floating "Download Plan"
    pill and Map/Satellite toggle sit ON TOP of the search field — only
    "Search a…" is visible and the tap target is half-covered · Suggested:
    stack the map toolbar controls below the search bar (or collapse them
    behind a ⋯ menu) at narrow widths.

19. 2026-08-09 · Landsec client / desktop 1440px · opened a New Letting deal's
    detail page to see who the parties are · the Parties card shows all four
    slots — Landlord, Tenant, Vendor, Purchaser — with "+ Link vendor" /
    "+ Link purchaser" affordances even though vendor/purchaser only apply to
    investment (Sale/Purchase) deals; on a letting deal they're clutter and
    invite mis-linking · Suggested: show Landlord + Tenant on leasing deals
    and Vendor + Purchaser on investment deals (mirroring the counterparty
    logic the page header already uses).

18. 2026-08-09 · BGP staff / desktop 1440px · opened Calendar on a Sunday to
    check the day's viewings · the diary defaults to Work week (Mon–Fri), so
    on a weekend "today" isn't in the grid at all — today's events only
    appear in the small Today's Schedule sidebar list · Suggested: when
    today falls outside the default work-week range, open in Week (or Day)
    view instead so the current day is always visible on landing.

17. 2026-08-09 · BGP staff / mobile 390px · opened the Bluewater tenancy
    schedule on a phone to glance at the board · the header controls stack
    vertically at 390px (Letting Tracker link, units count, Search, Import,
    Excel, Add, Re-sync (all), Columns — 8 controls) and together with the
    KPI tiles push the first unit row ~2 screens down; Import/Re-sync are
    rarely phone tasks · Suggested: collapse the rarer actions (Import,
    Re-sync, Columns, Excel) into a "⋯ More" menu below `sm:`, keeping
    Search + Add inline, so rows appear on the first screen.

16. 2026-08-09 · Landsec client / desktop 1440px · reviewing portfolio health,
    saw "EXPIRING (6M): 8 leases expiring soon" on the dashboard and wanted to
    know WHICH leases · the KPI tile is not clickable (nothing happens) and no
    client surface lists the expiring leases — the tenancy full board has no
    expiry filter/sort preset, so the user must eyeball 200 rows of lease
    dates · Suggested: make the tile click through to the tenancy schedule
    pre-filtered/sorted to leases expiring within 6 months (or a small
    "expiring soon" list popover on the tile).

14. 2026-08-09 · BGP staff (non-admin) / desktop 1440px · wanted to prep
    marketing imagery for a Bluewater pitch · sidebar "Image Studio" lands
    (by design — 2026-08-04 gate: full studio is admins + clients only) on
    the lightweight /m/images page, which at 1440px is headed "Images" with
    phone copy ("No photos uploaded from your phone yet — Tap Add photos")
    and shows none of the org's existing studio images · Suggested: desktop-
    aware copy ("Click Add photos"), rename the sidebar entry for non-admin
    staff (e.g. "My Photos"), or a hint line "Full Image Studio is
    admin-only — ask an admin for property imagery".

15. 2026-08-09 · BGP staff / desktop · from the Honi Poke brand profile,
    clicked "Pitch property" (and "Add to deal") to act on the brand · both
    are bare navigations to /available and /deals — the brand context is
    dropped, so the user lands on the full 156-unit Letting Tracker and must
    re-find/re-type Honi Poke in a Target Operator picker themselves ·
    Suggested: carry the brand through (e.g. /available?pitchBrand=<id>
    pre-filling the target-operator picker, and /deals opening the new-deal
    dialog with the brand preselected).

## Confirmed / done
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
