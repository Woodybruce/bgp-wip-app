# Double Bill — brand system (v2, 21 Oct 2026)

The platform brand for cinema-anchored leisure parks. Tokens and marks live
in `server/leisure-platform-brand.ts` (public page) and
`client/src/components/double-bill-brand.tsx` (app). This file is the
written standard.

## Name

**Double Bill.** Descriptor: *Leisure parks*. Tagline: *Twice the night out.*

Why: a double bill is two films for one ticket. A Double Bill park is the
film and the rest of the night (bowling, dinner, golf, a drink) on one site.
It says what the parks are for without the words "leisure destination".

Clearance: no Companies House name contains "Double Bill" (checked 21 Oct
2026). "Encore Leisure" (Ltd, Holdco, Propco; 2019-23) and "Foyer Leisure
Ltd" (2019) are taken, so those candidates were dropped. Still to do: IPO
trade-mark search in classes 36 (property) and 41 (entertainment), and the
`doublebill.co.uk` / `.parks` domains.

Park names stay (Valley Centertainment, BH2, Coliseum). Double Bill signs
the landlord line: "A Double Bill park".

## Marks

- **Badge**: a marquee. Midnight-velvet ground (radial, velvet at the top
  left), a 1.5px champagne-gold border with an inner hairline, twenty
  bulbs around the edge (gold with an ivory hot-spot), and the two ticket
  stubs fanned inside: ivory behind, gold in front, perforation notches in
  midnight. Minimum height 28px.
- **Wordmark**: badge + DOUBLE BILL in Bodoni Moda 700, tracked +1.6,
  filled with the gold sheen; a gold hairline with a centre diamond; LEISURE
  PARKS tracked +3.6 beneath in muted ivory (or muted grey on ivory paper).
  Minimum height 40px.
- Clear space: one bulb-row (6px at 56px) on all sides.
- Gold is always the three-stop sheen (#F6E6B2 → #D4B165 → #C19A45 →
  #8F6E2A). On print it becomes a metallic spot colour or foil; never a
  flat yellow.

## Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| Midnight | #0B0F1F | #070A16 | Header band, badge, active pills |
| Velvet | #4A1024 | #3A0C1C | Wash behind the band, hover states |
| Champagne gold | #C9A24E | #D9B86A | The one accent: marks, rules, links, underlines |
| Gold highlight | #F3DFA0 | #F6E6B2 | Top of the sheen |
| Gold shadow | #8F6E2A | #A6823A | Bottom of the sheen; link colour on ivory |
| Ivory | #F6F1E6 | #121626 | Page background |
| Card | #FFFDF8 | #1A1F32 | Surfaces |
| Ink | #171A26 | #F1ECE1 | Text |
| Muted | #6E6A62 | #A9A396 | Secondary text |
| Line | #E4DCCB | #2C3147 | Hairlines |
| Good | #2C7D5B | #6FCB9B | Confirmed, sound covenants |
| Warn | #9A6B12 | #E0B45A | Likely, watch list |
| Usher red | #B5383A | #F08A86 | Critical and voids only |

Rule: gold is the only accent and always carries the sheen. Semantic
colours carry meaning, never decoration. Midnight and velvet are grounds,
never type colours on ivory. The bulb strip (7px, gold dots on midnight)
closes every dark band.

## Type

- Display: **Bodoni Moda** 700, capitals tracked slightly open. Titles,
  section heads, big numbers; italic 600 for the tagline.
- Body / UI: **Instrument Sans** 400-600, 14px running text.
- Data: **JetBrains Mono** 400-500, tabular numerals for money, yields,
  title numbers and dates.

Google Fonts link in `BRAND.googleFontsHref`.

## Voice

- Short sentences. Plain words. British spelling.
- Nights out, not footfall; occupiers by name, never "tenants" on anything a
  visitor sees.
- One number per sentence. The mark does the shouting; the copy stays calm.
- Never "destination", "experiential" or "curated".

## Where it is applied

- Public page `/public/leisure-platform/<token>`, the static copy at `/share/double-bill-<token>/` and the claude.ai copy.
- Dashboard `/leisure-platform` header and nav entry.
- The deep-dive paper's Platform and brand section.
- Investor material: the holding company, the tender letter and the
  dashboard all carry the wordmark; BGP appears as adviser in the footer.
