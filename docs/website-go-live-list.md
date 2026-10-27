# bgp.uk.com — running list

Woody's "list" for the website and the app around it. Read this out when he
asks for the list; add to it when he says "put it on the list".

## To consider

- **ChatBGP fixing itself** (Woody, 2026-10-15). ChatBGP works over the data,
  not the code, so it cannot repair bugs like the inverted brochure photos.
  Realistic shape: (1) a bug-report tool in ChatBGP that files evidence,
  (2) that report starts a Claude Code session on the repo which pushes a
  branch, (3) a person approves the pull request before it deploys. Small
  first piece, about a day for the second. Needs a decision on who approves.

## To do before / at go-live

- **Railway breach, 2026-10-21: rotate every secret** in the BGP
  dashboard, marketing and Pave Railway projects, then redeploy. Full
  checklist in order: `docs/railway-incident-2026-10-21.md`. Do the money,
  mail and database group first.
- Email: switch to bgp.uk.com addresses (aliases via PowerShell, DKIM
  CNAMEs, make primary, update site, dashboard and signatures). Not before
  Woody says. Signatures page offered, awaiting yes/no.
- Delete the Porkbun API keys Woody pasted in chat (Porkbun → API access).
- Adobe Fonts: add Century Gothic Pro (Bold) to the web project behind
  `use.typekit.net/nan4etq.css` so the site headlines render in the real
  brand typeface. Until then Jost (Google Fonts) stands in. Lato Medium is
  also only on Adobe Fonts; Lato Regular stands in from Google.
- Decide whether Associate Directors appear in key contacts.
- Harriette's photo: a headshot exists in the share drive
  (Marketing / Team CVs & Photos / Team Photos / 2026 NEW IMAGES); add it to
  the site, HR and card.
- Bios for everyone on the site (Charlotte). HR `bio` field can feed it.
- Lease Advisory case study summaries: the three tiles (Hammerson, Landsec,
  The Royal Exchange) carry the same placeholder sentence (Peter).
- Case studies for The City and High Streets sector pages.
- Client quotes for the investment case studies (Jack).
- Team group photo for the Team page hero (office photo stands in).

## Awaiting from the team

- Frankie Shop, Davies Street photo (Harry).
- Larger Our House / Parkhall images.
- Capital Real Estate Partners logo.
- Cat Jenkins' real quote (Consultancy page has placeholder text).
- Tracey's project notes.
- Leasing team to check the draft copy on St Christopher's Place, South
  Molton Triangle and Canary Wharf.
- Hong Kong portfolio tile for Investment.
- Addresses for the Investment deals that have none (Royal Exchange,
  Conduit Street, Biggin Hill, Old Picture House, Parkhall, Oxam House,
  Filmworks, Grants Leisure).

## Nice to have

- Gunwharf Quays hero on the home rotation (photos are in
  `marketing/public/images/case-studies/landsec/gunwharf-quays`).
- Lucent and Nova photos from the Landsec transfer are stored but unused.
- Original full-size Landsec photos (447 MB) to the share drive:
  Marketing / BGP Rebrand / Images for website / Landsec.

## Done (keep for the record)

- Every empty slot on the site now shows something the team can judge
  (Woody, 2026-10-16): a stock photo tagged "Stock image, to be replaced"
  where a picture is missing, and draft copy in italics where words are
  missing or unconfirmed (client quotes on Consultancy, Investment and the
  investment case studies; the three Lease Advisory summaries; the St
  Christopher's Place, South Molton Triangle and Canary Wharf leasing
  copy; a draft case study each for The City and High Streets). Replace
  the words and the italics go. Brand Representation rebuilt to slide 35
  exactly, with the site boxed at 1440px so it stops stretching on wide
  screens. Sheets in `docs/wireframe-review/`.
- Same day, night: the site rescaled to the wireframe frame after Woody's
  "exact" review. The slides are drawn at a 340px frame; measured against
  it the type is 1.7% of the width (24px on desktop), the hero is 63% of
  the width tall with the nav bar inside it, section labels are 2.3%
  bold, titles 5.4% light, logo circles 9.6% across, contact tiles 16%.
  All of that is now in `index.css` (root 24px from 1024px), `Nav.tsx`
  (transparent over a hero until scrolled), `Wire.tsx` and the
  components. Slide quantities everywhere: fourteen logo circles, three
  or five contacts, seven services on Lease Advisory and three on
  Consultancy, three Brand Rep case studies, seven investment deals in
  the slide's wide/small pattern, eight listings a page, six small news
  cards; gaps are padded with italic placeholders, extras trimmed. Home
  lost "We are bgp" and the testimonial and gained the Talk to us bar;
  Leasing lost the intro copy and team tiles; Investment lost its intro
  copy; the article body runs full width with a second photo set in; the
  listing page lost thumbnails, plans and the button stack. Frame-scale
  sheets in `docs/wireframe-review/`.
- Same day, evening: full visual audit of every page beside its slide
  (sheets in `docs/wireframe-review/`). Section headings site-wide are
  now small bold text over a rule and page titles large light type, as
  every slide draws them; Leasing and Investment lost the quote blocks
  the slides do not have; Leasing shows "+ More listings" instead of page
  numbers; Investment is three across with the first deal wide; the
  investment case study puts the quote photo at the left and drops "More
  case studies"; estate pages have a regular first paragraph; listings
  show an italic draft description. Investment hero is now the Royal
  Exchange interior from the TRE marketing folder (Woody). Kept on
  purpose: "We are bgp" and the Landsec quote on Home, the Leasing teams
  tiles, grouped Team.
- Same day, later: Lease Advisory and Consultancy rebuilt to slides 38 and
  41 (small ruled "A snapshot of clients", light "What we offer" with the
  detail box and arrow, grey "Additional services" box on Consultancy,
  case study on white under the grey key contacts band, no quote on Lease
  Advisory); text fills its column everywhere and case-study blocks show
  the full paragraph; every shopping centre tile carries a photo; the
  Leasing rollover is the four teams then Available properties; "Where we
  act" is now "Leasing teams"; home service blocks carry two paragraphs.

- Website layouts rebuilt to the December 2025 wireframes after Woody's
  side-by-side review (2026-10-16): statement over the hero, left-aligned
  headings over rules, grey bands for key contacts and case studies, stats
  row and alternating service bands on Home, wireframe listing cards and
  listing page, A to Z headshot grid on Team. Shared primitives in
  `marketing/src/components/Wire.tsx`. Second pass the same day, checked
  slide by slide in the browser: Leasing rollover menu, stats row, listing
  page actions, sector page map, Brand Rep with no hero, Consultancy
  services list, News feature blocks. Kept on purpose: We are bgp +
  testimonial, Where we act tiles, page numbers, What we offer on Brand
  Rep, sector pages not estate pages, grouped Team. Review note for Emmy
  and Charlotte: `docs/bgp-website-wireframe-review.pdf`.

- Site brought in line with the BGP Brand Guidelines v1.0 (August 2026,
  `docs/BGP-Brand-Guidelines-v1-2026-08.pdf`): four-colour palette only
  (red accent retired, Feather page ground, Stone bands), Century Gothic Pro
  Bold upper-case headlines, Lato body at 120%, block/frame logo lockups at
  50px minimum, rounded Bordeaux buttons (2026-10-15). The guidelines still
  quote bgp.co.uk and @bgppropertyconsultancy; the site uses bgp.uk.com.

- bgp.uk.com apex: Railway never issued the certificate; the apex now 301s to
  www at Porkbun with its own certificate (2026-10-13).
- HR is the single source of truth for names, titles, phones and photos on
  the site and cards (2026-10-13).
- Brochure-extracted listing photos: CMYK negatives fixed, em-dash file
  names fixed (2026-10-15).
- Site prerendered to static HTML per route so crawlers and Semrush read
  the content; Dan's re-audit should come back clean. Still to do at
  go-live: submit the sitemap in Google Search Console and Bing
  (2026-10-15). Pre-call note for Dan: `docs/note-to-dan-benchmark.md`.
- Figma file of the live site for Dan to redesign in: "bgp.uk.com — site
  pages (for redesign)" in the Bruce Gillingham Pollard Figma team,
  https://www.figma.com/design/sBdWkCvqSisuuymOskDX8o. Six desktop pages,
  components, brand page. Lora stands in for FreightText Pro (not in
  Figma). Woody to invite Dan as an editor (2026-10-15).

- Old site (brucegillinghampollard.com) kept current while we wait
  (2026-10-27): header menu across the top instead of the hamburger;
  home story blocks swapped for the new case studies (Lucent, Royal
  Exchange, Westgate, 20 Hanover Square, Canary Wharf, Landsec, Percival,
  South Molton Triangle, City of London study), Mark Warne quote, counters
  7m / 244 / 66 / 15 years; eleven Recent Projects refreshed or added;
  fourteen projects had contact links to former staff repointed to the
  current team lead; Contact page team list rewritten from HR; two untitled
  journal posts titled; meta description updated. Listings now follow the
  leasing tracker hourly through the BGP Tracker Bridge plugin and
  `server/wp-listings-sync.ts` (needs `BGP_WP_APP_PASSWORD` on Railway).
  Left alone: Terms and FAQs pages still read "Content"; the ~100 hand-made
  listings stay published until Woody says retire them.
