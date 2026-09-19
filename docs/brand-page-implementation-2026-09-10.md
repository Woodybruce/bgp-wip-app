# Brand page implementation and QA — 10 September 2026

Implemented on `claude/terminal-coding-interface-JOGQK`, based on `9e3c17b2`.
This records local implementation and verification, not a production deployment.

## What changed

- A confirmed official website and approved trading/legal names anchor provider matching. Apollo and RocketReach results must match that identity; stale or conflicting cached results are withheld. Zero employees is treated as unknown, while a genuine zero headcount-change percentage remains valid.
- Correcting a website synchronises all website columns. A transaction archives the previous record and its automatic dependencies, retires old automatic stores/images/signals and clears attributed automatic facts and narratives. Human-entered fields, selected images, contacts and relationship links are retained. Unattributed older facts are marked for review.
- Automatic store results require an official-domain website match. The verified mapped subset no longer replaces the reported store total. Image preparation uses official-site or verified-store sources; name-only storefront matches and obsolete logo caches cannot publish as the brand.
- Logo lookup uses an exact known company or approved alias, with no first-word or guessed-domain lookup. Manual logos remain available, including agent firms and client companies. Ambiguous company matches remain unresolved unless the client's own company provides the exact identity.
- The overview uses consistent action buttons, one factual introduction and one BGP action brief. Chat and supporting company/market data expand when needed. Stores have search and pagination, with saved, mapped and reported counts shown separately.
- Profile, image, provider, brief and Pipnet reads use saved results. Brand Activity has a cached read and an explicit Analyse activity action. Phone overview components use the same identity, preparation and store controls.

## Background preparation

Durable per-brand, per-section records use the existing `system_settings` table. There is no schema migration. Stages cover identity, profile, Apollo, RocketReach, stores, images, logo, brief and contacts. They retain attempts, successes, reasons, failures and the next eligible attempt across restarts. Concurrent workers share claims and daily reservations.

Default daily background-stage limits: identity 40, core profile 30, Apollo 30, RocketReach 20, stores 20, images 20, logos 40 and briefs 30. These are run limits, not a guaranteed monetary spending cap. A profile run can make a web-research request and up to three model attempts. Existing explicit store/image/provider refresh endpoints retain their separate refresh handling and Google spending guard; not every explicit refresh uses the durable queue.

The worker prioritises explicitly requested brands, active requirements/deals and client-visible brands. Existing scheduled calls gradually work through the directory. No-match results wait seven days; errors retry with backoff. `BRAND_PREPARATION_ENABLED=false` disables the background batch and on-demand logo preparation for local QA.

Existing coherent legal records can be corroborated against a website's visible registered number and legal name. Ambiguous records need manual confirmation. This is not a new legal-entity resolver. Contacts remain usable, but their preparation status requires review of the current property contact; automated contact discovery/approval is not implemented by this queue.

## COOK correction prepared, not applied

`qa/correct-cook-brand.mjs` defaults to an offline preview. It does not load `.env` or contact a database. An explicit database preview and matching state fingerprint are required before apply; a changed record aborts. Apply uses a transaction, checks the exact company ID, archives the old automatic data and advances `updated_at` so a pre-correction enrichment job cannot overwrite it.

The reviewed record uses `cook.com`, a kitchenware description, Construction - General and London. The prepared correction uses `cookfood.net`, a frozen ready-meal description, Food retail and Sittingbourne. It retires 60 unverified automatic store results and one old logo cache, without deleting rows.

The official website identifies COOK TRADING LIMITED, 04611064. The existing 02884870 record is the related dormant COOK FOOD LIMITED. The script preserves the existing Companies House and KYC records; it only repairs the unrelated Digimedia label when the cached legal record corroborates COOK FOOD LIMITED. Choosing the legal entity for trading/covenant/KYC purposes remains a separate review.

Sources checked: [COOK](https://www.cookfood.net/about), [COOK TRADING LIMITED](https://find-and-update.company-information.service.gov.uk/company/04611064), [COOK FOOD LIMITED](https://find-and-update.company-information.service.gov.uk/company/02884870).

## Brent Cross follow-up included

Unconfirmed older AI rectangles no longer display labels or intercept clicks as if they were confirmed units. Their records appear under Needs placement, retain editing/evidence access and show a dashed inspection outline when selected. Current scan-supported and manual outlines remain visible. Editing facts no longer certifies an AI rectangle as a manual boundary. A small JPEG fringe repair also removes K28's lettering notch without merging neighbouring units.

Offline replay of the latest lower-level snapshot shows 38 supported saved outlines and 32 records needing placement. The latest scan has 41 candidates awaiting decisions. This does not certify the upper or restaurant levels, and it does not claim that all Brent Cross boundaries are now correct. No production scan or plan mutation was performed in this implementation turn.

## Verification

- `npm run check`: passed.
- `npm run build`: passed. Existing large-bundle/Browserslist/PostCSS warnings remain.
- `npm run qa:regression`: 329 passed, zero failures.
- PostgreSQL: 9 queue/concurrency checks, 9 identity/quarantine transaction checks, 40 evidence data checks and 23 scan-review transaction checks passed in isolated local schemas.
- COOK correction tests include stale-state rejection, rollback, legal-field preservation and a real CLI preview with networking deliberately disabled.
- Local browser: confirmed store search/paging, separate 19 saved / 17 mapped / 100 reported counts, a matched source hiding unknown zero employees while retaining 0% growth, and an unconfirmed source withholding Beijing data.
- Local browser identity correction: old automatic image retired, selected image loaded, all 19 manual stores and reported facts retained, review note visible.
- Local browser plan: edited notes on a unit awaiting placement, applied one reviewed boundary, reloaded, verified notes and £220 Zone A evidence retained, and checked manual M1 remains directly clickable. Source image and boundaries visually align in the synthetic fixture; the old broad box is absent.
- Production-compiled local HTTP initially could not load cookie-authenticated images because production cookies require HTTPS. Visual image checks were completed with the app's local development session settings. No production authentication was used.
- Desktop layout was inspected visually. A 390px desktop-browser viewport retains the desktop sidebar because the app requires a touch/mobile device to enter the phone shell; it is not a valid phone test. Actual phone-shell/touch interaction remains unverified.

Other existing sections, such as covenant cache revalidation, retain their own refresh behaviour. Charlotte's last-seen/entertained CRM work is separate and has not been implemented here. Live COOK data correction, production deployment and provider-backed verification remain outstanding.
