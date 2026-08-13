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
