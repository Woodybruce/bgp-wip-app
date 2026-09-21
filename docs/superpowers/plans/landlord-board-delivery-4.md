# Landlord/client boards — Delivery 4: preparation pipeline, logo, media, signatures, social states

Source: "BGP landlord and client boards — implementation plan" (2026-09-20), Delivery 4 only.
Codebase: bgp-wip-app @ 7dbe62c4 (branch `claude/landlord-delivery-4-JOGQK`, cut from `origin/claude/terminal-coding-interface-JOGQK`), post Delivery 1 + 2 + 3 (resolver, reconciliation, account deals/workspace live).

Delivery 4 scope (from the brief): the account preparation pipeline and its visible per-stage states; official-logo fallback and header refresh; one account media view over company + property assets; signature-driven completion of existing CRM people; social feed states including verified landlord handles.

Acceptance gates (from the brief):
- A cold account prepares without repeated clicks, survives reload/restart (durable job state, not in-memory), preserves manual edits, and reports individual stage failures.
- Repeated email/photo ingestion creates no duplicates (idempotency keys / dedupe by stable IDs).
- Official-logo fallback: when logo.dev fails but the website scraper found an official logo, the header shows the official one; a manually chosen logo is never replaced.
- Gallery groups: Corporate / Properties / BGP-approved, with property filtering by property ID; public images are NOT auto-marked cleared for marketing reuse.
- All existing tests keep passing.

## Global Constraints

- **No new migrations.** Every piece of state this delivery needs already has a home: preparation stage state lives in `system_settings` (`server/brand-preparation-jobs.ts` — durable, advisory-locked, survives restart), signatures in `email_signatures`, feed failures in `rssapp_feed_failures`, images in `image_studio_images` (which already has `company_id` + `property_id`). Nothing here needs a column that doesn't exist. (The brief's migration-mirroring rule is noted and not triggered.)
- Permissions never widen. `resolveCompanyScope(req)` flows into the new account-media endpoint exactly as it flows into the Delivery 2/3 endpoints; scoped viewers see only the resolver's scoped portfolio. The media endpoint is a READ assembler; the signature sync writes only to `crm_contacts` rows that already exist.
- Manual edits are sacred. Logo preparation returns `ready` without touching anything when any publishable logo already exists (today's behaviour, kept); the signature sync only fills NULL/empty fields and never creates people.
- Disconnected ≠ empty. Feed/social states must distinguish "service not configured" / "feed creation failed (provider error)" / "not connected" from "connected, zero posts".
- Match existing code style: TypeScript, raw SQL via `pool.query`, lazy pool + `deps.pool` injection for tests, node:test via tsx (`node --import tsx --test <file>`). Typecheck: `npm run check`. No new npm dependencies. One commit per task; the implementer commits its own work. Do NOT push, deploy, or touch any database.
- `client/src/components/brand-profile-panel.tsx` is 5000+ lines — surgical edits only; landlord-only branches, tenant pages byte-identical in behaviour.

## What already exists (do not rebuild)

- **Durable stage machinery** — `server/brand-preparation-jobs.ts`: `BRAND_PREPARATION_STAGES` (`identity, profile, apollo, rocketreach, stores, images, logo, brief, contacts`), `runPreparationStage` (system_settings rows + `pg_try_advisory_lock` + lease + per-stage daily budget + cooldown/backoff), `readPreparationStates`, `summarizeBrandPreparation`. This is the "durable job state, not in-memory" the gate asks for — it already survives restart; Delivery 4 extends it, never replaces it.
- **Stage workers** — `prepareBrandStage` (`server/brand-enrichment.ts:274`) dispatches identity/profile/apollo/rocketreach/stores/images/logo/brief/contacts; `enqueueBrandPreparation` marks a company for the nightly batch (`runBrandPreparationBatch`); `startBrandCoreRefresh`/`readBrandCoreRefresh` (`server/brand-core-refresh.ts`) run identity→profile→brief with a durable claim row.
- **Logo route + preparer** — `GET /api/brand-logo/:name` (`server/image-studio.ts:1885`): exact-identity company resolution, serves the first `isPublishableBrandLogo` image, and on a miss fires `prepareBrandStage(company.id, "logo")` in the background before 404ing. `prepareBrandLogo` (`server/image-studio.ts:746`): existing-logo short-circuit → logo.dev download → store. `scrapeLogoFromWebsite(domain)` (`server/website-logo-scraper.ts:35`) — checked official-site logo (schema.org/og/apple-touch/header-img, ≥800-byte floor). Landlord findings carry `logo_url` (`landlord_website_findings`, read at `server/brand-profile.ts:438-443`).
- **Image gallery** — `imagesQ` (`server/brand-profile.ts:242-256`): `company_id = $1 OR lower(brand_name) = company name`, LIMIT 60, already selects `property_id`. Property→image attribution by URL-slug matcher (`server/brand-images.ts:608-649`, sets `property_id` on import).
- **Signature extraction** — `server/email-signature-enrich.ts`: Graph fetch of latest inbound → `isolateSignatureText` → Haiku extract → `email_signatures` upsert keyed by lowercased email (30-day cache, in-flight dedupe). `contacts-discovery.ts:349-399` reads the cache for display only — CRM rows are never completed from it.
- **Feed provisioning** — `previewBrandSocialFeeds` (`server/news-brand-linking.ts:510`) and `previewCuratedInstagramFeeds` (`:697`) both select `companyType ILIKE 'tenant%'` only; failure ledger `rssapp_feed_failures` (`:616-627`); RSS.app client with explicit not-configured error (`server/rssapp.ts`).
- **Instagram card** — `GET /api/brand/:companyId/instagram` (`server/instagram.ts:402`) returning `no_handle` / `handle_only` / `feed`; `BrandInstagramCard` (`client/src/components/brand-profile-panel.tsx:5190`).
- **Landlord detection** — the single isLandlord SQL rule (`server/brand-profile.ts:886-895`): typed landlord/investor/reit/developer/fund, or landlord on a non-archived deal, or freeholder/long-leaseholder — never a tenant type.
- **Stock snapshot with honest states** — `getStockSnapshotState(ticker)` (`server/stock-price.ts:660`) returning `{ status: "ok" | "invalid-symbol" | "provider-error" }` with 60s negative caching (Delivery 1).
- **Account scope assembly** — `resolveAccountView(companyId, { scopeCompanyId }, { pool })` (`server/account-resolver.ts`, Delivery 2): entity set + portfolio with dedupe, cycle-safe. Router mount pattern: `app.use(accountXRouter)` (`server/index.ts:4152-4154`).
- **Weekly landlord scrape** — `runWeeklyLandlordScrape` (`server/landlord-scraper.ts:672`) with its own 14-day freshness and 30s throttle.

## Task 1: Official-logo fallback + header refresh (symptom 1)

**Problem.** `prepareBrandLogo` uses logo.dev only; a 404/204 (common while logo.dev has no asset, and the initial request can 404 while preparation runs) leaves the company header showing initials indefinitely, even when the website scraper already found the official logo (`landlord_website_findings.logo_url`, or scrapeable from the verified domain).

**Changes.**

1. New pure module `server/brand-logo-sources.ts`:
   - `planLogoSources(args: { hasExistingPublishable: boolean; findingsLogoUrl: string | null; logoDevConfigured: boolean; domain: string }): LogoSourceStep[]` — the ordered candidate plan: `existing` short-circuit first (manual choices preserved — the existing-logo scan stays the very first step), then `findings` (landlord scraper's official logo), then `logo_dev`, then `website_scrape`. Steps with no input are omitted. Pure, unit-tested.
   - `isCheckedLogoDownload(input: { status: number; mime: string | null; bytes: number }): { ok: boolean; reason?: string }` — the "checked" contract: HTTP 200, `image/*`, ≥800 bytes, ≤2MB.
2. `prepareBrandLogo` (`server/image-studio.ts`) rewritten to walk that plan:
   - Existing publishable logo → `ready` (unchanged; a manually chosen logo is never replaced).
   - **Landlord findings logo**: read `logo_url` from `landlord_website_findings` (runtime table — wrapped in `.catch(() => null)` like the existing reader at `brand-profile.ts:443`). Download, run the checked contract, re-verify the identity fingerprint (existing pattern at `:769-770`, `:777-781`), store with `tags: ["brand-logo", "brand-auto", "official-website", identityTag]`, `source: "official-website"` → `ready`.
   - **logo.dev** (today's path, unchanged semantics).
   - On logo.dev 404/204/no-image → **`scrapeLogoFromWebsite(identity.domain)`** (already checked: ≥800 bytes, image only), same identity re-check, same tags → `ready`.
   - Only when all steps fail: `no_match` with a reason naming what was tried.
3. **Header refresh** — `CompanyLogoImg` (`client/src/pages/companies.tsx:113`): the 404 already triggers server-side preparation via `/api/brand-logo/:name`. On `<img>` error, retry the same URL up to 2 times with a cache-busting query param (`&retry=N`) after 6s/15s before falling back to initials; reset retry state when `name`/`domain` changes. Genuine 404s settle to initials after ~21s instead of never updating; prepared logos appear without a page reload.

**Verification.** `server/brand-logo-sources.test.ts`: plan ordering (manual existing always first; findings preferred over logo.dev; website scrape is the tail; steps dropped when inputs absent); checked-contract accept/reject matrix. `npm run check`.

## Task 2: Account media view — company + property assets (symptom 2)

**Problem.** The gallery query excludes photos attached only to properties (`company_id` NULL, `brand_name` NULL, `property_id` set), and automatic property association depends on the property name appearing in the image URL slug.

**Changes.**

1. New module `server/account-media.ts` + router (mounted beside the Delivery 3 routers):
   `GET /api/accounts/:id/media?propertyId=<id>` → `resolveAccountView(companyId, { scopeCompanyId }, { pool })`, then one read over `image_studio_images`:
   ```sql
   WHERE company_id = ANY(entity ids)
      OR property_id = ANY(portfolio property ids)
      OR (company_id IS NULL AND property_id IS NULL
          AND lower(trim(brand_name)) = ANY(entity names lowercased))
   ```
   Legacy name-matched rows stay reachable (parity with today's `imagesQ`), but the property link is **by `property_id` only** — never by filename/URL. Dedupe by image id (a row can match both company and property clauses). Per row: `id, file_name, thumbnail_data, mime_type, tags, category, source, description, width, height, created_at, company_id, property_id, property_name, group` where `group` is computed by a pure, exported function:
   - `classifyMediaRow(row)` → `"approved"` when `'brand-hero' = ANY(tags)` (the existing staff-only "Saved choice" pin — the only human-driven approval signal that exists; see Non-goals for why no new clearance flag), else `"properties"` when `property_id` is set, else `"corporate"`.
   - Public auto-imported images (`brand-auto`) are **never** in `approved` — the pin is set only by an explicit staff toggle (`CompanyImageCoverChoice`); nothing in this delivery sets it automatically. Response: `{ groups: { corporate: Row[], properties: Row[], approved: Row[] }, properties: [{ propertyId, name }], total }`; `?propertyId=` filters the properties group by exact property id.
2. **Page-context attribution** — `refreshBrandImages` (`server/brand-images.ts:692`): the URL→property matcher currently inspects only the image URL. Also try `candidate.pageUrl` (the asset page the image was found on) when the image URL doesn't match — page context, still never a bare filename substring free-for-all (same whole-token matcher, same ≥4-char key floor).
3. **Panel gallery (landlord branch only)** — the sidebar Gallery card (`brand-profile-panel.tsx:5005-5180`): when `isLandlord`, fetch the new endpoint and render three labelled groups (BGP-approved / Corporate / Properties) with a property filter `<select>` (options from the response). Tenant/brand pages keep the existing flat grid untouched. Landlord hero/cover selection, lightbox, delete, hero-pin flows reuse the same row shape (`thumbnail_data`, `tags`, `id`) so existing handlers keep working.

**Verification.** `server/account-media.test.ts` (mock pool + injected fake AccountView via `deps.resolveView`): property-only images surface in `properties`; brand-hero rows land in `approved`; auto public images never in `approved`; legacy brand_name-only rows still included; dedupe by id across clauses; `propertyId` filter; scoped view carries only the resolver's scoped portfolio; pool spy — zero mutating statements.

## Task 3: Signature → CRM people completion (symptom 3)

**Problem.** Signature extraction fills `email_signatures`, but CRM people are never completed from it — the data stops at a display cache.

**Changes.**

1. New module `server/signature-contact-sync.ts`:
   - Pure `decideContactFill(contact, signature)` → the field updates to apply:
     - `role`, `phone`, `phone_mobile`, `linkedin_url`: fill only when the CRM value is NULL/empty/whitespace. **Filling a blank never overwrites anyone — manual or automatic.**
     - `name`: replace only when (a) the current name equals the deterministic local-part placeholder the auto-creators generate (`guessNameFromEmail` shape — `nick.smith@` → "Nick Smith"), AND (b) `enrichment_source` marks an automatic creation (`'promoted-from-email'`, `'chatbgp_email'`, `'rocketreach'`, `'apollo'`) — a human-set name, or a name on a manually created contact (`enrichment_source` NULL/'manual'), is never touched.
     - LinkedIn normalised the same way as promote-sender (`linkedin.com/in/<slug>`); anything failing that parse is dropped, not stored.
     - Generic mailbox guard (the promote-sender local-part list: info/contact/hello/enquiries/office/admin/sales/support/leasing/marketing/accounts/careers/noreply…) — a signature on a shared mailbox fills nothing.
   - `applySignatureToCrmContact(email, deps: { pool? })`: read the freshest `email_signatures` row, find `crm_contacts` by `lower(email)` (identity key, not name — never matched on company-name mentions), apply `decideContactFill` per row, one `UPDATE … WHERE id=$n AND <each filled field still blank>` so a concurrent human edit between read and write still wins. Returns `{ matched, updated, fields }`. **Creates nothing.** Idempotent: a second run computes zero updates.
   - `syncSignaturesToCrmContacts(opts: { limit? })` — batch over recently-enriched signature rows, for the hook below and manual backfill.
2. **Hook** — `enrichSignaturesForDomain` (`server/email-signature-enrich.ts`): after each successful upsert, `applySignatureToCrmContact(email)` (awaited, errors logged not thrown). Signature ingestion now completes existing CRM people as a side effect of the path that already runs.
3. Route: `POST /api/admin/sync-signature-contacts { limit? }` (staff-only: `resolveCompanyScope(req)` → 403, same guard as promote-sender) — manual backfill of the existing signature cache.
4. Non-goals honoured: no people created from marketing recipients / generic mailboxes / company-name mentions — this path creates nobody at all; the existing bounded CC auto-create (`email-processor.ts:1081`) is untouched.

**Verification.** `server/signature-contact-sync.test.ts`: fill-missing matrix per field; never-overwrite (manual name, manual phone survive); placeholder-name replacement only for auto sources; generic mailbox skipped; LinkedIn normalisation + garbage dropped; no-match email → no writes; idempotency (second run zero updates); the UPDATE's still-blank guard; pool spy asserts the sync never INSERTs.

## Task 4: Social feed states + verified landlord handles (symptom 4)

**Problem.** Both provisioning paths select tenant companies only, so landlord Instagram is empty; and the card can't distinguish "no feed slot", "feed creation failed", or "service not configured" from "no posts".

**Changes.**

1. **Include verified landlord handles** — `previewBrandSocialFeeds` and `previewCuratedInstagramFeeds` (`server/news-brand-linking.ts:525,705`): widen the company predicate from `tenant%` to tenant% OR landlord-shaped (`landlord`, `landlord/freeholder`, `investor`, `reit`, `developer`, `fund` — the same vocabulary as the isLandlord rule). For landlord-typed rows additionally require a verified identity (`ai_generated_fields->'brand_identity'->>'status' = 'verified'`) — "verified landlord handles" means the handle hangs off a confirmed official identity; tenants keep today's behaviour exactly. Ranking: the deal-activity bonus currently checks `crm_deals.tenant_id`; extend it to also credit `landlord_id` so active landlord accounts rank fairly against tenant brands for the shared RSS.app quota. Factor the predicate as an exported pure helper `isFeedEligibleCompany(companyType, identityVerified)` and unit-test it.
2. **Explicit card states** — `GET /api/brand/:companyId/instagram` (`server/instagram.ts:402`) response gains:
   - `status: "not_configured"` — RSS.app credentials absent (export `isRssAppConfigured()` from `server/rssapp.ts`). The UI says the feed service isn't configured; it never pretends the account is quiet.
   - `status: "feed_error"` — a `rssapp_feed_failures` row exists for this profile URL and no live feed source: `{ error: last_error, attempts }` — the specific provider error, not a generic shrug.
   - `handle_only` → also returned as `status: "not_connected"` alias? No — keep `handle_only` (existing consumers) but add `externalUrl` and `lastSyncedAt: null`; the UI labels it "Not connected".
   - `feed` → `lastSyncedAt` = `MAX(published_at)` over the source's articles; `feed` with zero articles stays `feed` + `posts: []` + `lastSyncedAt: null` (connected-but-empty, distinct from unavailable).
   - Every non-`no_handle` response carries `externalUrl: https://instagram.com/<handle>` — a working external account link when no feed is available.
   - State computation factored into an exported pure `instagramCardState(args)` (in `server/instagram-card-state.ts`) so the matrix is unit-tested without Graph/RSS.app.
3. **Client** — `BrandInstagramCard` (`brand-profile-panel.tsx:5190`): render the new states — "Instagram feed service isn't configured" / "Feed error: <reason>" / "Not connected — view on Instagram ↗" / "Last synced <date>" under the handle; connected-but-empty shows "Feed connected — no posts synced yet", never an outage message.

**Verification.** `server/instagram-card-state.test.ts`: full state matrix (not_configured > feed_error > not_connected > feed-empty > feed), lastSyncedAt passthrough, externalUrl always present with a handle. `isFeedEligibleCompany` tests: tenant unchanged, landlord requires verified identity, tenant-typed rows never treated as landlords.

## Task 5: Preparation pipeline — portfolio & financials stages, honest refresh states, page-open enqueue (symptom 5)

**Problem.** "Profile refreshed" reports success while photos/market data actually failed (the core refresh returns `done` after the brief and silently queues the rest); the stage list has no portfolio or financials visibility; and nothing on page open nudges stale/missing sections — so cold accounts need repeated manual clicks.

**Changes.**

1. **Two new stages** — `BRAND_PREPARATION_STAGES` gains `"portfolio"` and `"financials"` (`server/brand-preparation-jobs.ts`; appended, so existing system_settings keys are untouched). Workers in `prepareBrandStage` (`server/brand-enrichment.ts`):
   - `portfolio`: landlord-shaped companies only (isLandlord vocabulary, pure `isPortfolioStageApplicable(company)` helper). Non-landlords short-circuit **before** `runPreparationStage` with `{ ran: false, status: "not_applicable" }` — nothing persisted, nothing charged. Work: if `landlord_website_findings.scraped_at` is fresh (<14 days, the weekly scrape's own cadence) → `ready` (source: "landlord website scrape"); otherwise call `scrapeLandlordWebsite(companyId)` and map ok/error with its real reason. Daily limit 5 (ScraperAPI budget) — far below other stages on purpose.
   - `financials`: companies with a non-empty `stock_ticker` only (pure `isFinancialsStageApplicable`), same not_applicable short-circuit otherwise. Work: `getStockSnapshotState(ticker)` → `ready` on `ok` (source: the provider that answered); `no_match` on `invalid-symbol`; `error` with the provider reason on `provider-error`. Zero cost when unlisted — no guessed tickers.
   - `summarizeBrandPreparation` totals include the new stages; `totalSections` count adjusts automatically (it derives from the array).
2. **Source + freshness per stage** — `PreparationOutcome` gains optional `source`; `nextPreparationState` carries it into the persisted state (`source` cleared on error, kept on ready/no_match/needs_review). Each worker sets it: identity "official website", profile "official website + AI research", logo "logo.dev" | "official website", images "official site / photo providers", portfolio "landlord website scrape", financials "Yahoo Finance / stooq", brief "BGP brief (Claude)", stores "Google Places", apollo/rocketreach their names. `readPreparationStates` passes it through — the UI shows "what, when, from where, or why not".
3. **Honest refresh status** — `readBrandCoreRefresh` (`server/brand-core-refresh.ts`) response gains `sections`: the compact per-stage summary (stage, status, lastSuccessAt, source, reason) from `readPreparationStates` — so a finished core refresh can show "Profile + brief ready · photos failed: <reason> · market data pending" instead of an unconditional success. `profileRefreshMessage` (`client/src/hooks/use-brand-profile-refresh.ts`): on `done`, append "Some sections need attention — see preparation details" when any section is in `error`/`needs_review`/`unavailable`; the toast no longer claims full success. (No `done`-with-failure on the core path: core stage failures already return `error`/`needs_review` today — preserved.)
4. **Page-open enqueue ONCE** — `GET /api/brand/:companyId/preparation` (read on every profile open by `BrandPreparationStatus`): after computing states, if any stage is `pending`, or `nextAttemptAt <= now`, AND no stage is `running`, AND no `brand-preparation-request:<id>` key exists → `enqueueBrandPreparation(companyId)` (guarded by `BRAND_PREPARATION_ENABLED !== "false"` and `!company.ai_disabled`). The nightly batch consumes the marker; every stage's own cooldown/cooldown-after-success (`nextAttemptAt`) means a page open never re-runs fresh AI — it only nudges genuinely stale/missing work, once, into the durable queue. Reads stay reads: this is one idempotent marker write, no provider calls.
5. **Client** — `BrandPreparationStatus` (`client/src/components/brand-profile-overview.tsx:45`): stageLabels gain `portfolio: "Portfolio discovery"`, `financials: "Market data"`; per-stage row shows source when present; a stage in `not_applicable` (never persisted — absent from states) simply doesn't render, as today.

**Verification.** Extend/add `server/brand-preparation-stages.test.ts`: applicability helpers (portfolio landlord-only, financials ticker-only); `nextPreparationState` source propagation (kept on ready, cleared on error); the page-open enqueue decision as a pure function `shouldEnqueueOnPageOpen(states, requestMarkerExists)` — pending-or-stale + nothing running + no marker ⇒ true; anything fresh/cooldown ⇒ false; marker present ⇒ false (enqueue once). Full existing gate must stay green.

## Phased task breakdown and acceptance checks

| Phase | Tasks | Acceptance check |
|---|---|---|
| 1 | Task 1 logo fallback + header retry | Plan order unit-tested; logo.dev-miss + findings-logo fixture yields the official asset; manual logo never replaced; header retries then settles. **Gate: official-logo fallback; manual choice preserved.** |
| 2 | Task 2 account media | Property-only photos surface; groups Corporate/Properties/BGP-approved; property-id filter; public images never auto-approved. **Gate: gallery groups + no auto-clearance.** |
| 3 | Task 3 signature sync | Fill-missing works; manual edits survive; placeholder names heal only on auto-created contacts; nobody created; re-run is a no-op. **Gate: idempotent ingestion, no duplicates.** |
| 4 | Task 4 social states | Landlord with verified identity + handle enters the feed plan; card shows not_configured / feed_error / not_connected / last-synced distinctly. |
| 5 | Task 5 pipeline | New stages durable in system_settings (survive restart); per-stage source/freshness/failure visible; page open enqueues once; refresh message honest. **Gate: cold account prepares without repeated clicks; individual stage failures reported.** |
| 6 | Full verification | `npm run check` clean; the Delivery 1–3 test files + all new test files green under `node --import tsx --test`. **Gate: all existing tests keep passing.** |

## Out of scope for Delivery 4 (do not implement)

- SharePoint folder tree migration (Delivery 5) and entity-level KYC (Delivery 5/7).
- A real "marketing clearance" workflow with its own column/workflow. The BGP-approved group reuses the existing staff-only `brand-hero` pin — the only human approval signal that exists today. Introducing a formal clearance flag is a schema + UX decision for a later delivery; what matters for this gate is that public auto-imports are NOT auto-marked, which this design guarantees by construction.
- Creating CRM people from signatures, marketing recipients, or company-name mentions (forbidden by the brief; this delivery only completes existing rows).
- Replacing the in-memory progress endpoints (`brand-jobs`, landlord-scrape progress) — they are transient progress readouts; the authoritative stage state is the durable `system_settings` rows this delivery extends.
- TikTok/X feed provisioning changes, RSS.app quota management UI, contact discovery cascade changes.
- Any write to permission tables, any change to `isPropertyInScope` / `dealsClientScope`, any migration.

## Explicit uncertainties (verified against the tree at 7dbe62c4)

- `landlord_website_findings` is a runtime-created table (not in `shared/schema.ts`); the logo fallback reads only `logo_url`, already selected at `brand-profile.ts:439`, with the same `.catch(() => …)` guard. `email_signatures` / `rssapp_feed_failures` / `brand_instagram_cache` are likewise runtime-DDL; all are read defensively.
- `crm_contacts.enrichment_source` vocabulary observed in code: `'promoted-from-email'` (routes.ts:3122), `'rocketreach'`/`'apollo'` (discovery), NULL for manual rows. The name-heal rule keys off this; if other writers stamp other values they default to "manual — never touched", which is the safe direction.
- The landlord isLandlord rule lives as SQL in `brand-profile.ts:886-895`; the feed-eligibility helper reuses its type vocabulary (`landlord, landlord/freeholder, investor, reit, developer, fund`) as the closest pure-function equivalent — deal/freeholder evidence can't be evaluated in the drizzle predicate, so landlord-typed-but-inactive companies may enter the feed *preview* list; the curated ranking's deal bonus (now checking `landlord_id` too) is what allocates actual paid slots, keeping the behaviour honest without a second scope language.
- Adding two stages changes `summarizeBrandPreparation.totalSections` (9 → 11 of the array minus contacts). `BrandPreparationStatus` renders counts from the API, so no client constant drift; `selectPreparationCompanies`' `< 9` heuristic counts existing keys and simply admits companies with missing stages more readily — same direction as intended (prepare the unprepared).
- The page-open enqueue writes a `system_settings` marker from a GET handler. It is idempotent (ON CONFLICT), gated on actual staleness, and does no provider work inline; the alternative (client-fired POST on mount) would double-fire under React StrictMode — the server-side check is the single writer.
