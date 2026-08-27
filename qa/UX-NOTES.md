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

(Woody 2026-08-18, on confirming 50-64: "ignore 46 and 32" — the two entries
below stay parked, not built. Rounds shouldn't re-log them.)

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

95. 2026-08-25 · Landsec client / mobile 390px (QA r377) · "look up Starbucks
    from the phone Brands search and see who they are / who to call" · The
    brand profile opens on the CHAT pill ("Ask anything about Starbucks — @
    tags properties…"), which reads as an internal BGP tool; the client had
    to notice and tap Contacts/Intel to get what they came for · Land client
    logins on Contacts (or Intel) instead of Chat on the phone brand
    profile — staff can keep Chat-first.

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

91. 2026-08-24 · Landsec client / desktop 1440px (QA r367) · "catch up on
    news about my tenants" · The Brand News list shows the same story twice
    when the raw feed headline and the normalised signal differ slightly —
    e.g. "Musician sues Starbucks for £2m after 'career-ending' incident in
    London branch - London Evening Standard" and "Musician sues Starbucks
    for £2m over incident at London branch" render as two entries a few rows
    apart. Brand-profile Signals already dedupe by normalised headline (UX
    #12); suggest applying the same near-duplicate collapse to the News tab
    list so clients don't read the same lawsuit twice.

90. 2026-08-24 · Landsec client / desktop 1440px (QA r367) · "open the
    tenancy schedule" · Typing/bookmarking /tenancy-schedule silently lands
    on the Properties list with no explanation (the redirect is intended —
    the schedule is per-property) — the user asked for a schedule and gets
    a different page with no hint they should pick a property. Suggest a
    one-line toast or banner after the redirect: "Pick a property to open
    its tenancy schedule."

89. 2026-08-24 · Landsec client / desktop 1440px (QA r366) · "see which of
    my brands are active right now" · On Brand Intelligence → Overview, the
    Who's Hot rows use "d" for two different things side by side: a filled
    badge "1d" means 1 DEAL while the timestamp directly under it reads
    "21d" meaning 21 DAYS ago — a client can easily read the deal badge as
    another age. Suggest distinct labels (e.g. "1 deal" / badge tooltip, or
    "21d ago" for the timestamp) so the two "d"s can't be confused.

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

86. 2026-08-24 · BGP staff / desktop 1440px (QA r364) · "see who's earning
    what on the WIP report" · The Agent Summary tab on a book where no deal
    has an agent/BGP-contact assigned shows an "Agent Fee Breakdown" panel
    that is simply blank (header + empty body) and a 0-row table whose
    footer reads "Total £0 · £0 · £0 · 100%" — 100% of nothing. No hint
    of WHY it's empty. Suggest an empty state ("No fees are attributed to
    agents yet — assign a BGP contact on a deal to see the split") and
    suppressing the 100% when the total is zero.

85. 2026-08-24 · BGP staff / mobile 390px (QA r363) · "look up a brand's
    contact from my phone" · On the brand profile's Contacts pill, the Key
    Contacts panel opened with "No property-tier contacts. Click Show all
    below." + "1 in CRM · no new contacts found" — the one contact the user
    wanted is behind an extra "Show all 1 contacts" tap. When there are no
    property-tier contacts but only a handful of CRM contacts, suggest just
    listing them straight away (keep the Show all gate for long lists).

84. 2026-08-24 · BGP staff / mobile 390px (QA r363) · "open a deal from the
    Deals tab" · On the phone deal page the header back-arrow button wraps
    onto its own line below the deal title, landing next to the status chip
    (title takes the full 390px row, the ghost icon button drops under it) —
    it reads as a mystery "←" control mid-page rather than page chrome; the
    breadcrumb above already provides the way back. Suggest hiding the
    ghost back button below md (breadcrumb + bottom nav cover navigation)
    or pinning it into the top bar row.

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

75. 2026-08-20 · Landsec client / mobile 390px (QA r345) · "look up Honi
    Poke on my phone before a meeting" · The brand profile's Chat card
    fills the entire first screen after the hero photo — Key Contacts,
    compliance and the actual brand facts all sit below the fold, so on a
    phone the profile reads as a chat app before it reads as a profile. ·
    Suggested: on mobile, render Chat collapsed (a "Chat" bar that expands
    on tap) or move it below Key Contacts, so facts come first.

76. 2026-08-20 · Landsec client / mobile 390px (QA r345) · "check the old
    leasing strategy board" · The retired /leasing-schedule/:id board
    (banner says "This board is retired") still shows editing affordances
    to a client login — "Set band" / "Set positioning" buttons on every
    unit and an "Enable" button for Strategic Principles — BGP strategy
    controls that mean little to Mark and invite edits on a board nobody
    maintains. · Suggested: for client logins render the archived board
    read-only (keep the banner + reference data, drop the edit buttons).

74. 2026-08-20 · BGP staff / desktop 1440px (QA r344) · "carry on working
    with a pending invoice verdict" · The new red verdict banner (fixed,
    top-0) overlays the app header instead of pushing it down, so the
    global search box and header controls sit hidden behind it for as long
    as a verdict is pending — annoying is the brief, but hiding search
    costs real workflows. · Suggested: give the authenticated shell a
    top offset when the banner is mounted (like iOS in-call bars) so the
    header stays usable; keep the banner un-dismissable.

70. 2026-08-19 · BGP staff / Letting Tracker mobile 390px (QA r339) ·
    "find unit L112 to log a viewing" · Every mobile unit card's headline
    is the PROPERTY name (`prop?.name || u.unitName`, available-units.tsx
    ~1687), so a Bluewater-filtered list shows 150 identical "Bluewater
    Shopping Centre" headlines with the actual unit ("L112 Bluewater")
    relegated to the small grey subtitle — scanning for a unit means
    reading subtitles. Same class as the r229 search-labelling fix. ·
    Suggested: lead with the unit name, property as the subtitle (or
    property once as a group header when filtered to one centre).

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
