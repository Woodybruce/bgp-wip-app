# bgp.uk.com — source handover

This folder is the complete source of the public website at www.bgp.uk.com.
It is a Vite + React 18 + Tailwind site with Wouter for routing. Node 22 or
newer is required.

## Run it

```bash
npm install
npm run dev          # local dev server with hot reload
npm run build        # production build into dist/ (static HTML per route)
npm start            # serve dist/ the way Railway does
```

Set `VITE_BGP_API_URL=https://chatbgp.app` before `npm run build` to pull live
content. Without it the site uses the snapshot in `public/site.json` and
clearly marked sample listings.

## Where things are

| What | Where |
|------|-------|
| Pages | `src/pages/` (Home, Leasing, ListingDetail, LeasingSector, Team, CaseStudyPage, News, Article, service pages) |
| Shared components | `src/components/` (Nav, Footer, ListingCard, ContactCard, KeyContacts, CaseStudyStrip, ListingMap) |
| Copy, case studies, sectors, deal lists | `src/lib/content.ts` |
| Colours, fonts | `tailwind.config.ts` and `src/index.css` |
| Images | `public/images/` (hero, sectors, case studies, team) and `public/brand/` (logos) |
| Routes and page titles | `src/App.tsx` |
| Build-time prerender | `scripts/prerender.ts` (renders every sitemap route to static HTML) |
| Static server | `scripts/serve.mjs` |

## Content that is data, not design

Team, case studies, news and current opportunities are fetched at runtime
from the BGP dashboard (chatbgp.app) through its public API, and a snapshot
is baked into the HTML at build time. Names, titles, phones and photos come
from the HR records there. Do not hardcode people or listings in the site;
restyle the components that render them.

## Brand

The site follows the BGP Brand Guidelines v1.0 (August 2026): Bordeaux,
Nectar, Stone and Feather only; headlines in Century Gothic Pro Bold, upper
case, -30 tracking, 100% leading; body and labels in Lato at 120% leading;
block or frame logo lockups never below 50px tall (`public/brand/bgp-block-*`
and `bgp-frame-*`). Century Gothic Pro comes from the Adobe Fonts kit in
`index.html`; Jost from Google Fonts stands in until the family is added to
that kit. The tokens live in `tailwind.config.ts`, the type classes
(`.display`, `.label-caps`, `.subhead`, `.btn`) in `src/index.css`.

## Deploy

Railway builds with `npm run build` and starts with `npm start` from this
folder. The apex domain redirects to www.
