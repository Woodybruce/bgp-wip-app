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

64. 2026-08-18 · BGP staff / desktop (client Full Board shows the same
    figure) · "after a rent review, check the Bluewater board's WAULT" ·
    the WAULT KPI trusts placeholder lease expiries from the Landsec feed
    — the fixture (and the live feed it snapshots) carries 2154-12-30/31
    expiry dates on some units, and once such a unit has passing rent the
    rent-weighted WAULT reads as 100+ yrs (seen: 128.4 yrs). The code
    already rent-weights to blunt peppercorn ground leases, but a
    placeholder date on a RENTED unit still poisons the figure. Suggested:
    exclude (or cap) terms beyond ~60 yrs from WAULT and badge the stat
    "n units excluded — placeholder expiry" so asset managers don't quote
    a nonsense figure to the client.

63. 2026-08-17 · BGP staff / mobile 390px (desktop chips behave the same
    on search) · "find my Bluewater deals on the phone" · typing in the
    deals-board search narrows the card list and the header count
    ("2 deals — National Leasing") but the stage filter chips keep their
    unfiltered totals ("All 3 · SOL 2 · EXC 1"), so the header says 2
    while the chip row says 3 — same numbers-vs-cards disagreement class
    as UX #61. Suggested: recount the stage chips against the searched
    set (or visually mute them while a search is active).

62. 2026-08-17 · Landsec client / mobile 390px (staff mobile has the same
    board) · "which of my Bluewater leases expire soonest?" · the tenancy
    Full Board on a phone is the full 34-column desktop sheet in a
    horizontal-scroll container: only Unit is pinned, so reaching the
    Expiry / Unexp columns means swiping through Tenant, Lease, GIA, NIA,
    Rental, MLA, Occupational-cost bands one screen at a time — and the
    column headers offer filters but no sort, so "soonest expiry" can't
    be surfaced at all without reading every row. The KPI cards (WAULT,
    occupied/vacant) render mobile-friendly, so the page LOOKS adapted
    until you hit the table. Suggested: a mobile card view (unit / tenant
    / expiry / rent per card, like the tracker's card layout) or at least
    tap-to-sort on date columns so lease-event questions are answerable
    from a phone.

61. 2026-08-17 · Landsec client / desktop 1440px (staff see it too) ·
    "browse my imagery in Image Studio" · the section tabs count
    non-Brands images ("Library (1)") and the Categories rail's "All"
    badge matches, but the grid under Library → All renders EVERY
    image including the 5 Brand Library ones — 6 cards under a header
    saying 1. The numbers and the pictures disagree at first glance;
    the user can't tell which count is "right". Suggested: exclude
    category='Brands' from the Library grid's "All" view (they have
    their own tab), or include them in the count — either way make
    the number match the cards.

60. 2026-08-17 · BGP staff / mobile 390px (applies to desktop too) · "a
    new person joined a tenant brand — add them to the CRM by hand" ·
    there is no manual New Contact path anywhere in the live app: staff
    contacts arrive only via discovery (Rescan / promote-from-inbox /
    RocketReach "Add") on the company profile board, and the old
    contacts page that carried the full New Contact dialog
    (client/src/pages/contacts.tsx ContactList — button-create-contact,
    name/email/role/company form, plus the "Interaction Archive" view)
    is unrouted dead code — /contacts now renders the PeopleHub CRM
    (people.tsx) which has no create button; only CLIENT logins get an
    "Add contact" affordance in their hub. If BGP staff meet someone at
    a viewing whose email isn't in any BGP inbox, they can't record
    them. Suggested: either add a New Contact button to the PeopleHub
    header reusing the existing (working) ContactFormDialog from
    contacts.tsx, or delete the dead code if discovery-only is the
    intent. Needs Woody's numbered confirmation — not built.

59. 2026-08-16 · Landsec client / mobile 390px · "BGP are coming to
    Bluewater — put it in my calendar, then find my BGP contact to
    confirm" · the calendar + task legs work, but the find-my-BGP-
    contact leg dead-ends on the phone: the ClientTeamOrgChart (the
    "your BGP team" card) renders only on the desktop client dashboard
    and company profiles — the mobile Portfolio home replaces the
    dashboard and has no team card, /contacts' "Landsec Contacts" tab
    lists only the client's OWN people with no BGP staff and no search
    (the "Search brands or people…" box exists only on the Brand
    Directory tab). A client on a phone has no way to look up who to
    chase at BGP. Suggested: surface the BGP account team on mobile —
    e.g. a compact "Your BGP team" row on the Portfolio home or a
    third group in Landsec Contacts. Needs Woody's numbered
    confirmation — not built.

58. 2026-08-16 · Landsec client / desktop 1440px · "a prospect viewed my
    unit — log it quickly" · the Viewings/Offers dialog cards headline
    the COMPANY name with a "No company" fallback, but the quick way to
    log a viewing is date + attendees (Company/Contact pickers are
    optional and easy to skip), so most hand-logged rows read "No
    company" in bold with the actually-useful attendees line beneath.
    Suggested: extend the headline fallback chain to attendees
    (companyName || contactName || attendees || "No company") in the
    viewings + offers cards (available-units.tsx ~2636/~2757). Needs
    Woody's numbered confirmation — not built.

57. 2026-08-16 · BGP staff / desktop 1440px · "terms agreed — create the
    new letting deal, then carry on working it" · after Create Deal the
    dialog closes with a "Deal created" toast, but nothing points at the
    deal just made: the toast has no link, the table's default 10/44
    columns don't include the deal NAME, and the new row is only
    findable by knowing its ref # or scanning Property/Unit cells (three
    near-identical "Bluewater Shopping Centre" rows in the fixture).
    Suggested: add a "View deal →" action on the Deal-created toast
    (and/or highlight the new row briefly). Needs Woody's numbered
    confirmation — not built.

56. 2026-08-16 · BGP staff / mobile 390px · "on the phone: put a Bluewater
    lease-review call on the calendar" · staff /calendar has NO in-app
    Add-event — the button is isClientViewer-gated (clients write a
    team_events row; staff events come from Outlook sync). Locally/on
    the move that means a staff user on the phone can't jot a CRM
    meeting at all: the page is view-only and the only write path is
    switching to the Outlook app, losing the CRM linkage (company/
    property tags) that client-created events get. Suggested: offer
    staff the same lightweight Add-event dialog writing a team_events
    row (kept separate from Outlook sync), or at least a deep link into
    Outlook new-event. Needs Woody's numbered confirmation — not built.

55. 2026-08-16 · BGP staff / mobile 390px · "open the Bluewater property
    page" · the property page stacks THREE navigation rows before any
    content at 390px: the mobile top bar ("← Property"), a breadcrumb
    row ("Properties › Bluewater Shopping Centre"), and a second
    back-link row ("← Properties /") — ~200px of a phone screen spent
    on three ways to say the same thing before the property name
    appears. Suggested: collapse to the top bar + one breadcrumb (drop
    the duplicate back-link row on mobile). Needs Woody's numbered
    confirmation — not built.

54. 2026-08-16 · Landsec client / mobile 390px · "over breakfast: catch up
    on tenant news for the board and save an article for later" · the
    mobile /news feed (MobileNewsFeed in client/src/pages/news.tsx) is a
    read-only card list — no Save button, no Saved tab, no search, no tag
    filters — while client desktop has the full save/Saved workflow
    (r295/r296 even fixed bugs in it). An article spotted on the phone
    can't be saved for later, and articles saved on desktop can't be
    found on the phone; the user's only option is an external open in the
    browser tab. Renders fine (0 overflow), so it works as designed —
    just missing what this user wanted · Suggested: add a save/bookmark
    affordance to the mobile news card and a way to reach the Saved list
    (chip row or tab), reusing the existing /api/news-feed/engage +
    /saved endpoints. Needs Woody's numbered confirmation — not built.

53. 2026-08-15 · Landsec client / desktop 1440px · "took a brand back off my
    CRM watchlist after checking it out" · after removing a self-added brand
    via the Add-brand dialog (working as designed), the sidebar's Quick
    Access section still lists the removed brand from recent history —
    clicking it dead-ends on "Company not found — it may have been merged
    or removed", which reads like data loss rather than "you removed this
    from your list" · Suggested: filter Quick Access to brands the viewer
    can still access, or give the not-found state client-aware copy with a
    "re-add from the directory" pointer. Needs Woody's numbered
    confirmation — not built.

52. 2026-08-15 · BGP staff / desktop · "a brand wants space — log the new
    leasing requirement" · the Add Requirement dialog has no date field and
    the server stores requirementDate NULL, so a requirement created seconds
    ago shows Date "—", gets no Fresh badge, and the "active in the last 90
    days" KPI reads 0 right after creating one — the board looks stale the
    moment you add fresh demand; the user must know to inline-edit the Date
    column afterwards · Suggested: default requirementDate to the creation
    day for hand-added requirements (imports keep their own dates), or add
    a pre-filled date field to the dialog. Needs Woody's numbered
    confirmation — not built.

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
