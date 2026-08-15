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

51. 2026-08-15 · BGP staff / mobile 390px · "on the train: how's the letting
    pipeline moving and who do I chase?" · the /deals/list mobile cards
    show name, property, status chip and deal type — but no target date and
    no time-in-status, even though Target Date is required on every deal
    ("drives the WIP report bucket") and is exactly what a phone triage
    needs to pick which deal to chase; the user must open each deal
    one-by-one to see dates · Suggested: surface the target date (or a
    "n days in Solicitors" age) on the mobile deal card. Needs Woody's
    numbered confirmation — not built.

50. 2026-08-15 · Landsec client / mobile 390px · "check how my Bluewater
    lettings are progressing: open the live deal" · the deal header shows
    an amber "Off tenancy spine" chip to the client, whose tooltip reads
    "This deal isn't yet linked to a tenancy schedule row. Use Resolve on
    the property page to fix." — BGP-internal jargon plus an instruction
    to use a staff-side tool Mark doesn't have. To a landlord it reads
    like something is wrong with their deal that they're expected to fix ·
    Suggested: hide the chip for client viewers (it's an internal
    data-hygiene flag), or swap in client-facing copy without the staff
    instruction.

49. 2026-08-15 · Landsec client / desktop 1440px · "board asked for a
    tenant-news roundup: filter the News feed by topic" · the tag chip row
    (New openings / Flagships / DTC / …) is global, but the client's
    "For You" feed slice often has ZERO articles for a given tag — most
    chips Mark clicks just empty the feed (now with a correct "No matching
    articles" state, r295), which makes the chips feel broken. Staff feeds
    have matches, so staff never see this. Suggested: hide (or grey out)
    tag chips with no matches in the currently loaded feed, or show a
    per-chip match count so a zero-tag is visibly a data gap rather than
    a broken filter.

48. 2026-08-14 · BGP staff / desktop 1440px · "Monday pipeline review: leave
    a note on a live deal for the team" · the deal page's Comments card
    (right rail, "Click to add a comment…") reads like a team thread but is
    a single shared text blob (crm_deals.comments) — the posted note shows
    NO author and NO timestamp, and the next person who comments overwrites
    the previous note entirely (same surface on mobile via the md:hidden
    duplicate card). A user leaving "chase solicitors Monday" can't tell
    who wrote it or when, and a colleague's later note silently deletes
    theirs · Suggested: either relabel the card "Notes" with a visible
    last-edited-by/when line, or make it a real append-only comment list
    with author + date per entry. Needs Woody's numbered confirmation —
    not built.

47. 2026-08-14 · BGP staff / mobile 390px · "pull up comps evidence on the
    train before a rent-review call" · the /comps stats strip shows
    "11 AI leads awaiting review" to every staff viewer, but the Leads tab
    is deliberately parked admin-only (reached via /admin/comps-leads →
    /comps?tab=leads; the tab trigger only renders once you're already on
    it) — so a non-admin sees 11 items "awaiting review" with NO route to
    review them, on desktop or mobile; the count reads like a to-do the
    app won't let them do · Suggested: hide the AI-leads stat for viewers
    without access to the Leads tab, or make it a link for those with
    access (admin), so the count and the path to act on it always travel
    together. Needs Woody's numbered confirmation — not built.

46. 2026-08-14 · Landsec client / desktop 1440px · "check my property before
    a lease-expiry chat with BGP" · the property page's Compliance & KYC
    sidebar (deliberately client-visible per the 2026-08-01 decision) also
    exposes the BILLING ENTITY row as an EDITABLE control to clients —
    "+ Set billing entity" opens the full company-search dropdown and the
    PUT succeeds (own-portfolio property writes are open), letting a client
    change the SPV that BGP invoices its own fees to; the copy ("The
    corporate entity invoiced for fees") is BGP-internal plumbing a
    landlord viewer shouldn't be steering · Suggested: render the billing
    entity read-only (name badge only, no dropdown/clear button) for client
    viewers, same pattern as the brand-profile KYC staff-action gating.
    Needs Woody's numbered confirmation — not built.

45. 2026-08-13 · BGP staff / mobile 390px · "find a unit's tenant on the
    Bluewater tenancy schedule" · after typing in the schedule's Search
    box, the filtered rows give no visible feedback — the KPI stack
    (NIA / rent / WAULT / occupied / vacant / service charge, 7 stacked
    cards at phone width) pushes the table ~1.5 screens below the search
    box, and the status-count chips above it don't change with the search
    either, so the page looks inert until the user scrolls a long way ·
    Suggested: on phones collapse the KPI cards into a 2-col grid or a
    swipeable strip (or move Search directly above the table), so search
    results are visible near the input. Needs Woody's numbered
    confirmation — not built.

44. 2026-08-13 · Landsec client / desktop 1440px · "the Gail's letting is
    at Solicitors — who at BGP do I chase?" · the client deal page names
    no BGP owner: Parties is landlord/tenant/vendor/purchaser only (all
    empty here), the header shows just "Team: National", and there's no
    deal lead or contact anywhere on the page. The answer (Lead: Victoria
    Broadhead) only exists on the client's own company profile under the
    BGP Team card — two hops away and not where a user chasing a deal
    would look. The Letting Tracker rows equally name no BGP person ·
    Suggested: surface the deal owner / BGP lead (name + email link) on
    the client deal detail header or sidebar, and consider the same on
    tracker unit rows. Needs Woody's numbered confirmation — not built.

43. 2026-08-12 · BGP staff (non-admin) / desktop 1440px · "a brand asked for
    photos of a Bluewater unit — find them in Image Studio" · the sidebar's
    "Image Studio" entry sends non-admin staff to /m/images, which is
    deliberately scoped to the user's OWN phone uploads — so Victoria lands
    on "No photos uploaded from your phone yet · Tap Add photos to take one
    or pick several" and has NO route to the team's central image library
    at all (the full /image-studio power page is admin-only, and pasting
    its URL just bounces her back). The task is impossible for non-admin
    staff, and the phone-phrased empty state ("Tap", "camera roll") reads
    odd on a desktop. The upload-and-AI-edit flow itself is excellent
    (instant toast, edit sheet, prompt chips) · Suggested: give staff a
    read path into the shared library (e.g. a "Team library" tab/toggle on
    /m/images, or open the full studio read-only for staff), and vary the
    empty-state copy on desktop. Needs Woody's call on scope — not built.

42. 2026-08-12 · Landsec client / mobile 390px · checking a vacant unit's
    asking rent on the Letting Tracker · the mobile unit card silently
    drops its Rent p.a. / Area rows when the values are unset — the user
    can't tell "no rent recorded" from "rent hidden on mobile" (desktop at
    least shows the empty Rent column cell; MSU3 Bluewater has no asking
    rent in the fixture and the card just shows name + status) · Suggested:
    keep the rows with an explicit "not set" / "—" value, mirroring the
    confirmed #4 pattern (client KPI shows "—" + "no passing rent recorded
    yet" instead of vanishing).

41. 2026-08-12 · Landsec client / desktop 1440px · reviewing a tenant brand
    profile · the Instagram card's empty state reads "Meta Graph API
    credentials not set on server" — server-config copy shown to a client
    (the AI panels' equivalent states use house copy like "AI take
    unavailable — AI service is not configured") · Suggested: user-facing
    copy, e.g. "Instagram feed unavailable", keeping the config detail to
    server logs.

40. 2026-08-12 · Landsec client / desktop 1440px · board asked about a
    tenant brand's standing — read the Starbucks profile · the "Brand
    expansion" AI commentary shown to the client ends with BGP-internal
    pitch strategy: "**Recommendation: Do not pitch until BGP completes KYC
    due diligence and obtains baseline data…**" — advice addressed to BGP,
    not the landlord, and commercially awkward for a client to read ·
    Suggested: either strip/skip the Recommendation section of expansion
    commentary for client viewers, or prompt the generator to write the
    client-visible variant without internal pitch guidance.

39. 2026-08-12 · BGP staff / desktop 1440px · after an intro call, tried to
    add the new Starbucks contact to the CRM by hand · there is NO manual
    "add contact" entry point anywhere for staff: the CRM hub (Landlords/
    Agents/Lenders tabs) has none, and a brand/company profile offers only
    inbox-scan "Add" rows (needs M365 + an email from that person) and
    RocketReach "Refresh contacts" (needs an API key). A complete "New
    Contact" dialog exists in pages/contacts.tsx (name/status/type/email/
    phone/title/company + save to POST /api/crm/contacts, which staff-201s)
    but became unreachable when /contacts was re-routed to the People hub —
    the client Brand Directory kept its own Add contact button, staff lost
    theirs. Someone met at a viewing or event can't be logged at all ·
    Suggested: an "Add contact" button on the company/brand profile
    contacts board (and/or the CRM hub header) reusing the existing orphaned
    dialog. Needs a decision on where it should live — not built.

37. 2026-08-11 · Landsec client / mobile 390px · "when's our next meeting
    with BGP?" — the calendar opens on Day view of today; with no meeting
    today the grid is just empty, and finding the next one means paging
    forward day by day (Week view helps only within the current week; the
    Month/mini-cal sidebar is desktop-only, hidden lg:block) · Suggested:
    a compact "Upcoming" agenda list (next 5 events) at the top of the
    mobile calendar, or defaulting mobile to a week/agenda view — "next
    meeting" is the phone calendar's number-one question.

38. 2026-08-11 · Landsec client / mobile 390px · empty Requirements board ·
    the empty state says "No requirements — Try adjusting your filters"
    even when no search/filter is active, which sends the user hunting for
    filters that aren't set; for a client it also gives no hint that BGP
    logs requirements on their behalf · Suggested: filter-aware empty copy
    ("No live requirements for your portfolio yet" when unfiltered; keep
    the filter hint only when a filter/search is active).

36. 2026-08-11 · Landsec client / desktop · reviewed the deal Audit log
    after amending the tenant on his own deal · the Change Log renders raw
    values — "changed tenant from 11110000-0000-0000-0000-000000000201 to
    empty" — company-id fields show naked UUIDs a user can't read (staff
    see the same on their audit views) · Suggested: resolve
    tenant/landlord/vendor/purchaser id values to company names in the
    audit renderer (keep the id in a title/tooltip).

35. 2026-08-11 · Landsec client / desktop · "scan what's happening with my
    tenants" — staff have a News page (feed, source chips, Landsec sort)
    but the client nav has no news surface at all; the only route to
    headlines is opening each brand profile one at a time for its Signals
    card · Suggested: a client-facing news/signals feed scoped to the
    client's brand slice + self-added brands (read-only version of /news).

34. 2026-08-11 · BGP staff / desktop 1440px · back at her desk after a phone
    call with a brand contact, Victoria wanted to note the call on the
    contact's record · the contact page's activity board is inbox/calendar-
    synced only — there is no "log a call/note" action anywhere on the page;
    the only free-text home is the Notes field buried inside the Edit
    Contact dialog (unstructured, no timestamp, invisible on the activity
    timeline) · Suggested: a lightweight "Log activity" button on the
    contact detail page (call/meeting/note + date + one-line summary) that
    renders in the same activity feed alongside synced emails/meetings.

33. 2026-08-11 · Landsec client / desktop · opened an agent's contact page
    from the CRM list (agent contacts are deliberately client-readable —
    they're named on the tracker/requirements boards) · the page shows the
    same Edit button as on own-company/brand contacts, but saving an edit
    to an AGENT contact 403s ("Access denied") — the write gate is
    own-company + brand-slice only, so the affordance is misleading ·
    Suggested: hide (or disable with a "managed by BGP" tooltip) the Edit
    button when the contact's company is outside the client's writable
    set, mirroring how Delete is already hidden.

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

31. 2026-08-11 · Landsec client / desktop 1440px · asked "which of my
    vacant units have live interest?" on the Letting Tracker · the
    Activity column (viewing/offer counts + dialog buttons) sits ~15
    columns right, off-screen at 1440px, so every unit means a long
    horizontal scroll; the FY "Viewings / Offers" chips at the top show
    portfolio totals but aren't clickable and there's no "has activity"
    filter, so the only route is scroll-and-scan per row · Suggested:
    make the FY Viewings/Offers chips filter the table to units with
    activity (like the status chips below them do), and/or surface small
    viewing/offer count badges in the always-visible Property/Unit cell.

30. 2026-08-11 · BGP staff / desktop 1440px · opened a vacant unit's
    Targeting Brief to add a target operator · the dialog opens as a blank
    instruction form with no Target operators section at all — the targets
    table (and its add row) only mounts after the brief row is saved, and
    the "Create brief" button itself only appears once a field is edited,
    so "just add a target" means discovering an invisible two-step gate ·
    Suggested: always render the Target operators section, with a one-line
    empty state ("Save the brief to start adding targets" — or better,
    auto-create the brief on first target add, like the tracker's inline
    add already does via ensureBriefFor).

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
