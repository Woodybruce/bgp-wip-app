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

### Deal detail — Pathway Intel + Planning + Local Market Tone
- **Where:** `client/src/components/deal-detail.tsx` — three panels
  hidden behind comment blocks. Search for the comment landmarks:
  - `Pathway Intel + Planning hidden on deal-detail` (around line 897)
  - `Local Market Tone hidden` (in the sidebar, around line 1182)
- **Why:** All three are property-level data identical to what the
  Property page already shows. They made the deal page feel like a
  copy of the property page. The deal is for *this transaction*, not
  the property's whole research dossier.
- **To bring back:** Uncomment the JSX blocks; imports
  (`PathwayIntelStrip`, `PropertyPlanningCard`, market-tone state)
  are still in place so it's a one-line uncomment each.

## To add when hiding more

When something else gets disabled for the demo, append it here with the
same shape:
- the precise file + landmark
- the reason
- the exact uncomment / flip step to restore
