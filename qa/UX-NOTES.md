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

6. 2026-08-08 · Landsec client · mobile (iPhone shell) · Mark logs in to check
   his lettings — the app lands on the **Messages** tab, which for him is an
   empty "No conversations yet" screen. His portfolio is one tap away, but the
   first impression is a blank page. Suggest: client logins land on the
   Portfolio tab (or remember the last-used tab); Messages stays the default
   for staff if that's where their day starts.

7. 2026-08-08 · Landsec client · mobile Deals tab · Dashboard KPI says
   "Active Deals 4", but the Deals board shows "2 deals — Landsec" (the other
   two are tracker-linked deals, deliberately shown on the Letting Tracker
   sub-tab instead). Both numbers are right, but the mismatch reads as data
   loss on a phone. Suggest: a one-line hint on the Deals board when tracker
   deals are excluded (e.g. "+2 letting deals on the Tracker tab"), or include
   a linked chip.

8. 2026-08-08 · BGP staff · mobile (iPhone shell) · Victoria logs in on her
   phone to check her day — same as #6, the app lands on the empty Messages
   tab ("No conversations yet"); her dashboard (billing, boards, My Tasks) is
   one tap away. If #6 is built, apply the same landing logic to staff
   (Dashboard tab feels like the natural staff home).

9. 2026-08-08 · BGP staff · mobile Letting Tracker viewing dialog · Victoria
   edits a viewing row — the new edit/delete controls are bare pencil/trash
   icons with no aria-label or tooltip, small tap targets at 390px, and a
   viewing saved without picking a company lists as "Unknown". Works fine,
   but suggest: aria-labels + slightly larger touch targets on the row icons,
   and "No company" (or prompt to pick one) instead of "Unknown".

10. 2026-08-09 · BGP staff · desktop Comps page · Victoria opens Comps to pull
   rent evidence — the stats strip says "12 comps · 0 verified · 11 AI ·
   5 areas" but the table below shows only 1 row with all filters at
   defaults. The other 11 are unverified AI-extracted leads that live on the
   parked, admin-only Leads tab, so a non-admin sees a count they can never
   reach. Works as designed, but suggest: either count only table-visible
   comps in the strip, or make the "11 AI" stat a link/hint ("11 leads
   awaiting review — ask an admin").

## Confirmed / done
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
