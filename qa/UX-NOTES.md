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

74. 2026-08-20 · BGP staff / desktop 1440px (QA r344) · "carry on working
    with a pending invoice verdict" · The new red verdict banner (fixed,
    top-0) overlays the app header instead of pushing it down, so the
    global search box and header controls sit hidden behind it for as long
    as a verdict is pending — annoying is the brief, but hiding search
    costs real workflows. · Suggested: give the authenticated shell a
    top offset when the banner is mounted (like iOS in-call bars) so the
    header stays usable; keep the banner un-dismissable.

72. 2026-08-19 · Landsec client / Letting Tracker desktop (QA r343) ·
    "narrow the tracker to my Bluewater units" · The filter row shows
    "All Teams" and "All Agents" dropdowns to a client login — BGP-internal
    concepts (client work is one team; agents mean nothing to Mark), so two
    of five filters are dead weight on his screen. · Suggested: hide the
    Teams + Agents filters for client logins (keep property / location /
    status), like the staff-only panels elsewhere.

73. 2026-08-19 · Landsec client / property page desktop (QA r343) · "open
    Bluewater's tenancy schedule" · On the property page the tenancy rent
    roll lives behind a collapsed card titled just "Schedule", while the
    pop-out it opens is titled "Tenancy Schedule" and the client nav says
    "Tenancy" — a user scanning the page for "tenancy" finds nothing and
    the word only appears after they guess the right card. · Suggested:
    retitle the card "Tenancy Schedule" (or "Schedule — tenancy rent
    roll") so page and pop-out use the same name.

71. 2026-08-19 · BGP staff / Letting Tracker desktop (QA r341) · "a brand
    rang me about unit L015 — log the interest" · The new Interest signal
    is read-only for staff: rows only appear via the M365 inbox sweep
    (viewing-sync syncInterestEmails), and the dialog only lists + deletes
    — there is no "log interest" button and no POST endpoint, even though
    the schema comment anticipates manual rows (source null). A phone-call
    or in-person expression of interest can't be recorded; on this
    keyless/local setup the whole feature is permanently empty. ·
    Suggested: small add-interest form in the unit's Interest dialog
    (company picker + date + note), mirroring the add-viewing pattern.

69. 2026-08-19 · Landsec client / Property Intelligence desktop (QA r335) ·
    "pull title and rates info for my Bluewater asset" · Every tool on the
    hub starts empty for a client — Map opens on a default London view,
    Land Registry shows "No searches yet", Business Rates "0 properties" —
    so the client must re-type their own property's address into each tab
    even though the app knows their portfolio. · Suggested: seed the
    resolver/search with the client's scoped properties (e.g. a "My
    properties" quick-pick like the tracker has), so one click lands
    Bluewater in Map/Land Registry/Business Rates.

70. 2026-08-19 · BGP staff / Letting Tracker mobile 390px (QA r339) ·
    "find unit L112 to log a viewing" · Every mobile unit card's headline
    is the PROPERTY name (`prop?.name || u.unitName`, available-units.tsx
    ~1687), so a Bluewater-filtered list shows 150 identical "Bluewater
    Shopping Centre" headlines with the actual unit ("L112 Bluewater")
    relegated to the small grey subtitle — scanning for a unit means
    reading subtitles. Same class as the r229 search-labelling fix. ·
    Suggested: lead with the unit name, property as the subtitle (or
    property once as a group header when filtered to one centre).

68. 2026-08-19 · both personas / Letting Tracker desktop (QA r333) ·
    "work my Bluewater units" · Typing in the tracker search recounts the
    status chips (156→151) and the table, but the page header keeps the
    unfiltered total ("156 units" staff / "153 units" client) — the same
    numbers-disagree class Woody had fixed on the deals board "All" chip
    (UX #63, r329). · Suggested: recount the header with the active
    search/filters, or label it "151 of 156 units".

67. 2026-08-18 · both personas / mobile 390px (QA r331) · "log this
    morning's viewing from my phone" · When a viewing is saved with no
    Company (common quick-log path — the dialog's required field is only
    the date), the viewing card's HEADLINE is the attendees string (per
    UX #58) and the "Attendees:" line directly beneath repeats the exact
    same text — every company-less viewing reads twice. · Suggested: hide
    the "Attendees:" sub-line when it already headlines the card (or
    headline "Viewing — 18 Aug" and keep the attendees line).

66. 2026-08-18 · Landsec client / mobile 390px (QA r329) · "which Bluewater
    leases expire soonest — from my phone" · Tap-to-sort (UX #62) WORKS, but
    on a 390px phone the tenancy Full Board's sticky Unit column (~225px)
    plus the sticky select/delete column (~90px) leave only a ~74px strip of
    the scrolling sheet actually visible/tappable — column headers spend
    most of a swipe hidden underneath the sticky edges, so the sort/filter
    targets are fiddly to hit and only ~one column shows at a time. ·
    Suggested: on phones, narrow the sticky Unit column (truncate label,
    ~120px cap) and/or drop the sticky right column behind a row-tap menu so
    the sheet gets most of the viewport back.

65. 2026-08-18 · Landsec client / desktop 1440px (QA r327) · "my Bluewater
    letting is stuck at Solicitors — chase whoever's handling it" · Deal
    detail shows "BGP contact: Test Staff" as inert text — no email, phone,
    or message link, so the client has to leave the deal and hunt the
    property page's Linked Contacts (which DO show roles + a contact card)
    or Messages. · Make the deal-header BGP contact clickable — open the
    contact card or a mailto/Messages thread, same affordance the property
    page contacts already have.

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
