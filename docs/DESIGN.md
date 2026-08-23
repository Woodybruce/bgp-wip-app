# BGP App Design Guidelines — v2 DRAFT

Status: **draft for the equity team to agree** (Woody requested a uniform
standard, 2026-08-23: "everything has been built ad hoc and mismatches";
v2 adds tables, phone cards, detail-page/brand anatomy, widgets, forms and
empty states after "tables other layouts like the brand pages etc should be
a much bigger consideration").
Once agreed: every screen a session touches must be brought to this standard
in the same commit ("convert on touch"), and new screens conform from birth.
No big-bang restyle — the app converges.

Visual companion (every rule rendered as a specimen): the "BGP Design
Standard" artifact shared with Woody 2026-08-23.

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
  status maps — not decoration. Red means genuinely negative, not emphasis.
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
  `foreground`; inactive = quiet outline. Counts/money inside in mono.
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

## 6. Tables (desktop only)

- Sticky header row; header cells `text-[11px] font-semibold uppercase
  tracking-wider text-muted-foreground` (mono for numeric columns);
  sortable where the data warrants it.
- Money right-aligned, `font-mono tabular-nums`. Row text is body size
  (`text-sm`) — never smaller than 12px.
- Stage/status inside rows = small semantic row-pills from the status maps,
  not free text and not full filter pills.
- A totals row where a column sums (WIP report is the reference).
- Wide tables scroll inside their own `overflow-x-auto` container — the
  page itself never scrolls sideways.
- **Never ship a table to the phone.** Phones get the card list (§7).

## 7. Phone card lists (the table's mobile twin)

- One card per table row: name top-left, amount top-right in mono, one
  `text-[11px] text-muted-foreground` context line (client · property),
  then a chip row (stage row-pill + metadata). Tap opens the record.
- `rounded-2xl bg-card border border-border`, soft shadow only on phone
  tiles; desktop cards use the Card component / `rounded-lg`.
- Links to related records (client, property) live inside the card.
- WIP report's phone view is the reference implementation.

## 8. Stat tiles — information, not filters

- For purely informational numbers (Finance headlines, HR counts): label
  `text-[11px] uppercase text-muted-foreground`, value big `font-mono`,
  optional one-line context underneath ("live from Xero").
- Red/alert styling only when the number is genuinely negative (overdue
  debtors), never for emphasis.
- If tapping the number should filter the list below, it's a Pill (§3),
  not a tile — don't render both for the same figure.

## 9. Detail pages — brand, property, deal

- **Identity header**: logo/photo square (brands: white square with
  `object-contain` logo; properties: hero photo where one exists), name,
  ONE metadata line (`Tenant · F&B · 142 stores · tracked`), actions
  right-aligned per §5. Deals put their stage row-pill beside the name.
- **Pill row** for the page's boards/tabs (Overview / News 37 / Instagram /
  Compliance …) — counts inside the pills in mono.
- **Boards as labelled cards**: each board is a card with a mono uppercase
  section label + count, answering ONE question, linking deeper. No board
  taller than a screen without its own "view all".
- Two-column board grid on desktop, one column on phone.
- Same anatomy across brand, property and deal pages — they are the same
  page type with different identity headers.

## 10. Dashboard widgets

- A widget is a card with a plain-words title, an optional jump-off link
  ("Full view →") right-aligned in the header, and content that summarises
  before it details (tiles/rows inside, per §8/§7).
- No widget invents its own header style, fonts or colours — same tokens
  as everything else. The Equity Finance widget is the reference.

## 11. Forms & dialogs

- Desktop = Dialog; phone = bottom sheet. Never a full navigated page for
  a two-field form.
- Uppercase micro-labels (`text-[11px] font-semibold uppercase
  tracking-wider text-muted-foreground`) above inputs; comfortable input
  height (44px on phone); money inputs mono.
- Actions bottom-right: exactly one filled primary, the rest
  outline/ghost.

## 12. Empty states & loading

- Empty: centred icon + one plain sentence + one primary action ("No comps
  yet → Add First Comp"). Comps is the reference.
- Loading: skeleton blocks in the shape of the coming content — not a bare
  spinner, never a blank white void or raw error string.

## 13. Phone shell rules

- No horizontal page scroll, ever (wide things scroll inside their own
  container).
- 44px tap targets stand for buttons/rows — pills/chips are the deliberate
  exception.
- Respect the bottom-nav clearance (`3.5rem + safe-area`) and the
  keyboard-open behaviours (nav hides, composer drops padding).
- Screens reachable on phone must be designed for phone (or card-listed) —
  "desktop page squeezed to 390px" fails review.

## 14. Known deviations (the hit-list)

2026-08-23 evening: the full-app conversion sweep CLEARED the original
hit-list — Contacts/CRM, Calendar/Diary, brands hub, every underline/boxed
tab bar (→ pill rows, incl. the shared PageLayout), decorative off-palette
colours (→ tokens; semantic status maps kept), grey-family literals
(→ theme tokens), icon-square page headers (→ title+subtitle), the legacy
green focus ring / bare-link / selection colours (→ token-driven), and
phone card lists for Instructions and Leads.

Still deliberately outstanding:

- **Board Report** (`/board-report`): purpose-built fixed-dark deck with
  print CSS — retheming is its own job, needs a decision.
- **Office add-in pages** (`/addin-*`): render inside Outlook/Excel/etc.,
  not the app shell; product-brand card tints kept.
- **Map / Map-BGP**: floating Map/Satellite/Street View segmented control —
  acceptable as a map overlay; tool buttons keep the colour of the shape
  they draw.
- **Leasing Schedule / Turnover Board on phone**: still desktop tables in
  scroll containers — card-list treatment on touch if phone usage warrants.
- Chat entity-tag chips, file-type icon colours, per-person/team identity
  palettes, chart series: kept as deliberate encodings, not drift.

## 15. Process

- This file is the law once agreed; `CLAUDE.md` points here.
- Convert-on-touch: any commit touching a screen brings its chips, tabs,
  header, surfaces and colours to standard in the same commit.
- Re-run the design sweep after major UI work; it should stay at zero
  h-overflow / zero blank pages / zero chip-bloat.

Open taste calls awaiting Woody: ① app palette stays warm stone +
terracotta vs moving app chrome to Bordeaux; ② pill tabs everywhere vs
underline tabs allowed on desktop; ③ agree §9's detail-board anatomy
before converting the brand pages.
