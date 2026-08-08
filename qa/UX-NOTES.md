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
