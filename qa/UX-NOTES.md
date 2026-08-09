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
