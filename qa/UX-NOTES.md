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
1. 2026-08-08 · staff desktop (Victoria) · Letting Tracker → unit Viewings/Offers
   dialogs · Logged a viewing with the wrong company and wanted to correct it —
   the row only offers delete, so fixing one field means delete + re-type the
   whole entry (offers are the same: create/delete only, no edit route).
   Suggest: an edit (pencil) on viewing/offer rows, or inline-editable fields.
2. 2026-08-08 · staff desktop (Victoria) · Add Viewing dialog · The Date field
   starts empty even though most viewings are logged the day they happen, so
   every entry needs a manual date pick before Save. Suggest: default the date
   to today (keep it editable).
3. 2026-08-08 · staff · Deals board stage moves · A deal already sitting in
   SOL/EXC/COM/INV whose counterparties aren't KYC-approved (e.g. legacy deals
   with no counterparty linked) can be dragged OUT of that stage freely, but
   the AML gate then blocks dragging it back — an accidental drag is
   irreversible without the MLRO override, even though the deal held that
   stage seconds earlier. Suggest: allow reverting to the stage the deal held
   immediately before the current session's move (or warn before letting a
   gated-stage deal leave the stage it can't re-enter).

## Confirmed / done
