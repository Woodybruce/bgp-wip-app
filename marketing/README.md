# BGP marketing website

Public marketing site for Bruce Gillingham Pollard, built from the December
2025 wireframe deck (v13/v14b) and the Option 1 brand (burgundy `#6c1325`,
blush `#f39d8e`, stone `#c9baa5`).

Self-contained Vite + React + Tailwind app — separate build and deployment
from the dashboard in the repo root.

## Run locally

```bash
cd marketing
npm install
npm run dev
```

## Live leasing feed

The Leasing page pulls availability from the dashboard's public API
(`/api/public/leasing-listings` — units in the Available Units tracker with
marketing status **Available** or **Under Offer**, skipping properties with
leasing privacy enabled; only marketing-safe fields are exposed).

Set the dashboard origin at build time:

```bash
VITE_BGP_API_URL=https://<dashboard-host> npm run build
```

Without it the site renders clearly-marked `[Sample]` listings.

## Deploy (Railway)

Create a new Railway service with root directory `marketing/`. The included
`railway.toml` builds with `npm ci && npm run build` and serves `dist/` via
`npm run start`. Set `VITE_BGP_API_URL` as a build-time variable.

## Before launch

- Replace the traced logo SVGs in `public/brand/` with the designer's original
  vector exports (the current ones are traced from a JPEG — accurate but worth
  swapping for the source files).
- Everything marked `[Sample]` or `TBC` in `src/lib/content.ts` needs real
  copy: stats, service intros, team job titles/emails, case studies, articles.
- Photography: all image placeholders (`Placeholder` component).
- Typeface is Archivo (Google Fonts) as a stand-in — confirm the brand
  typeface with the designer.
- Newsletter signup and social links are visual only — no backend yet.
