# BGP App Design Guidelines — v1 DRAFT

Status: **draft for the equity team to agree** (Woody requested a uniform
standard, 2026-08-23: "everything has been built ad hoc and mismatches").
Once agreed: every screen a session touches must be brought to this standard
in the same commit ("convert on touch"), and new screens conform from birth.
No big-bang restyle — the app converges.

The reference screens (what "right" looks like): the phone home, the finance
tile, the Finance page, the 2026 WIP report, Comps' header, the chat list.

## 1. Colour

- **Tokens only.** `bg-background`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border`, `primary` (terracotta) — never
  hardcoded navy / green / gold / blue accents. Hardcoded colours are why
  pages drifted. (Legacy greens/blues in old pages get replaced on touch.)
- Page ground is warm stone (`#FAF9F7` phone, `bg-background` desktop);
  content sits on white/`bg-card` with `border-border` hairlines.
- **One primary accent per view**: terracotta (`primary`) marks THE main
  action and active states. Everything else is ink/muted.
- Phone dark chrome (headers, hero tiles) = `hsl(var(--mobile-chrome))` —
  never `#1C1917`/black literals (it's colour-scheme aware).
- Status colours are semantic only (deal stages, alerts), from the existing
  status maps — not decoration.
- The Bordeaux/Nectar/Stone rebrand palette is for **documents** (PDFs,
  decks, emails), not app chrome, until decided otherwise.

## 2. Typography

- Page title: `text-2xl font-bold tracking-tight` (serif comes free from the
  app font) + one-line `text-sm text-muted-foreground` subtitle carrying the
  counts ("293 units").
- Section labels: `text-xs font-semibold uppercase tracking-wider
  text-muted-foreground`.
- Body `text-sm`; metadata `text-[11px] text-muted-foreground`.
- **Money and counts are always `font-mono tabular-nums`.**
- No novel font sizes without reason — stick to 11 / xs / sm / base / 2xl.

## 3. Pills & chips — `client/src/components/ui/pill.tsx`

- ONE chip look app-wide: slim capsule, 11px semibold uppercase,
  `leading-none`, `px-2.5 py-[5px]`, `whitespace-nowrap`. Active = filled
  `foreground`; inactive = quiet outline. Counts inside in mono.
- Use the `Pill` component wherever theme tokens work; on dark custom chrome
  match `pillMetrics` with local colours.
- Chips never wrap to two lines (`whitespace-nowrap`) and never exceed ~26px
  tall. `rounded-full` buttons are exempt from the mobile 44px tap-target
  rule (index.css) — that rule was the historic cause of "massive pills".
- Pills are for **filters, tabs and states**. Real actions are Buttons, not
  pills.

## 4. Tabs — one pattern

- In-page tabs are a **pill row** (see WIP report). Retire underline tabs
  and one-off segmented boxes on touch.
- The only sanctioned segmented control is the top-level section switcher
  (Deals hub: WIP Report / Properties / Deals / Letting Tracker /
  Investment).

## 5. Page header anatomy (in order)

1. Title + subtitle-with-counts (see Typography)
2. Actions, right-aligned: at most ONE filled primary Button; the rest
   `variant="outline" size="sm"`
3. Pill row (stage/status/team filters — tappable, they ARE the stats;
   don't render a separate stat-card strip that duplicates them)
4. Search input (full-width on phone)
5. Filter dropdowns as pill triggers (see wip-filter-dropdown)
6. Content

## 6. Content surfaces

- Desktop data = table (sticky header, sortable). Phone = **card list**,
  one card per row, amount top-right in mono, links inside the card (WIP
  report is the reference). Never ship a >700px-wide table to the phone.
- Cards: `rounded-2xl` on phone tiles, `rounded-lg`/Card component on
  desktop; soft shadow only on phone tiles.
- Stat tiles (when genuinely informational, not filters): label
  11px muted, value big mono — like the Finance page StatCards.
- Empty states: centred icon + one sentence + one primary action (Comps is
  the reference).

## 7. Phone shell rules

- No horizontal page scroll, ever (wide things scroll inside their own
  container).
- 44px tap targets stand for buttons/rows — pills/chips are the deliberate
  exception.
- Respect the bottom-nav clearance (`3.5rem + safe-area`) and the
  keyboard-open behaviours (nav hides, composer drops padding).
- Screens reachable on phone must be designed for phone (or card-listed) —
  "desktop page squeezed to 390px" fails review.

## 8. Known deviations (the hit-list, from the 2026-08-23 full-app sweep)

Screenshots: design sweep harness (`design-sweep` — see git history) —
153 screens captured; automated audit found no h-overflow and no blank pages.

- **Contacts/CRM**: bespoke header ("CRM" + separate title row), underline
  tabs, navy/gold/brown icon stat tiles (off-palette) → header anatomy +
  pill tabs + token colours.
- **Calendar/Diary**: green "CRM" toggle chip (off-palette), grey segmented
  Day/Week box, team chips were wrapping (fixed 2026-08-23) → pill row.
- **Map / Map-BGP**: floating Map/Satellite/Street View segmented control —
  acceptable as a map overlay, revisit for pill styling only.
- Various older pages: underline tabs (convert on touch).

## 9. Process

- This file is the law once agreed; `CLAUDE.md` points here.
- Convert-on-touch: any commit touching a screen brings its chips, tabs,
  header and colours to standard in the same commit.
- Re-run the design sweep after major UI work; it should stay at zero
  h-overflow / zero blank pages / zero chip-bloat.
