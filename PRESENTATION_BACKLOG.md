# Presentation backlog — features hidden for the Monday business demo

Hidden behind a comment / config flag so the firm sees a tight, working
app on Monday. Each item lists what was disabled, where, and what's
needed to bring it back.

## Hidden 2026-05-29 (Monday demo prep)

### Property Decks panel
- **Where:** `client/src/components/property-detail.tsx` — the
  `PropertyDecksPanel` inside the two-column "brochures / decks / brand
  gap" grid (search for `Property Decks panel hidden for the Monday
  demo`).
- **Why:** Feature isn't ready — generation pipeline + house style still
  in flux.
- **To bring back:** Uncomment the `<ErrorBoundary compact …
  PropertyDecksPanel …>` block. No other code changes needed; the
  import at the top of the file is still in place.

## To add when hiding more

When something else gets disabled for the demo, append it here with the
same shape:
- the precise file + landmark
- the reason
- the exact uncomment / flip step to restore
