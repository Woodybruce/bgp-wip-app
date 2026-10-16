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
