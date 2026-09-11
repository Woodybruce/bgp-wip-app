-- Image Studio — categorise-and-prune the uncategorised backlog.
-- One-off, manual run. Companion to image-studio-cleanup.sql.
--
-- Intent: image_studio_images has accumulated a pile of rows with no
-- category (category IS NULL or '' — and historically a literal 'Stock'
-- that the UI's category list never had, so it shows as junk). Almost all
-- of it is auto-fetched stock dross from the old Unsplash/Pexels brand-image
-- fetcher (now disabled — see brand-enrichment.ts fetchBrandImages) plus the
-- manual import-stock endpoint. Nobody curated it; it just bloats the page.
--
-- The UI's real category set (client/src/pages/image-studio.tsx CATEGORIES)
-- is exactly: Brands, Properties, Marketing, Events, Headshots,
-- Floor Plans, Interiors, Shop Fronts, Street Views, Generated, plus
-- 'Uncategorised' (the null/empty bucket). Anything else (Stock, Places,
-- Brochures, Areas, Exteriors, Generated Charts, …) is an off-list value
-- that only shows under "Uncategorised"/All — but those off-list values are
-- mostly *curated* (brochure exteriors, pathway Places shots, charts) so we
-- do NOT touch them here. We only prune genuinely-uncategorised stock junk.
--
-- WHAT THIS DOES NOT TOUCH — the protected, curated rows:
--   • category = 'Brands'                  → the curated Brand Library
--   • 'brand-auto' = ANY(tags)             → brand-enrichment images (incl.
--                                            the 'Brand' singular-typo ones —
--                                            those are image-studio-cleanup.sql's
--                                            job, not this script's)
--   • property_id set                      → property-linked imagery
--   • company_id set                       → brand/landlord-linked imagery
--   • source IN ('ai-generated','ai-edited','ai') → AI-kept images
--   • referenced by property_imagery_assets (esp. pinned = true)
--   • referenced by entity_images          → wired onto a property/unit/deal
--   • referenced by image_studio_collection_images → in a collection
--   • any 'logo' / 'Brand Hero' / 'pinned' / 'trashed'-excluded tag of value
--
-- NB image_studio_images has NO 'pinned' column of its own — the pin lives on
-- the curation row (property_imagery_assets.pinned). So "not pinned" is
-- enforced via the property_imagery_assets NOT-EXISTS guard below.
--
-- Run order: Tier 0 (preview) → Tier 1 → re-check counts.
-- Every DELETE is wrapped in BEGIN/…/COMMIT so you can ROLLBACK if a count
-- looks wrong. COMMIT/ROLLBACK lines are left commented — uncomment after
-- you've eyeballed the row count.

-- ─── Tier 0: Preview — no rows changed ───────────────────────────────────
-- How big is the uncategorised pile, and where did it come from?
SELECT
  COUNT(*) FILTER (WHERE category IS NULL OR category = '')                                AS uncategorised_total,
  COUNT(*) FILTER (WHERE category = 'Stock')                                               AS stock_category_total,
  COUNT(*) FILTER (WHERE (category IS NULL OR category = '' OR category = 'Stock')
                      AND source = 'pexels')                                               AS uncat_pexels,
  COUNT(*) FILTER (WHERE (category IS NULL OR category = '' OR category = 'Stock')
                      AND source = 'pixabay')                                              AS uncat_pixabay,
  COUNT(*) FILTER (WHERE (category IS NULL OR category = '' OR category = 'Stock')
                      AND source = 'unsplash')                                             AS uncat_unsplash,
  COUNT(*) FILTER (WHERE (category IS NULL OR category = '' OR category = 'Stock')
                      AND source = 'stock')                                                AS uncat_stock_source,
  COUNT(*)                                                                                 AS grand_total
FROM image_studio_images;

-- Source breakdown of the uncategorised pile (sanity-check before deleting).
SELECT COALESCE(NULLIF(category, ''), '(null)') AS category, source, COUNT(*) AS rows
  FROM image_studio_images
 WHERE category IS NULL OR category = '' OR category = 'Stock'
 GROUP BY 1, source
 ORDER BY rows DESC;

-- Exact count of what Tier 1 will delete — run this and remember the number,
-- then check the DELETE row count matches before you COMMIT.
SELECT COUNT(*) AS will_delete
FROM image_studio_images i
WHERE (i.category IS NULL OR i.category = '' OR i.category = 'Stock')
  AND i.source IN ('pexels', 'pixabay', 'unsplash', 'stock')
  -- never curated as a brand asset
  AND i.category <> 'Brands'
  AND NOT ('brand-auto'  = ANY(COALESCE(i.tags, '{}')))
  AND NOT ('logo'        = ANY(COALESCE(i.tags, '{}')))
  AND NOT ('Brand Hero'  = ANY(COALESCE(i.tags, '{}')))
  AND NOT ('pinned'      = ANY(COALESCE(i.tags, '{}')))
  -- not linked to any CRM record
  AND i.property_id IS NULL
  AND i.company_id  IS NULL
  AND (i.brand_name IS NULL OR i.brand_name = '')
  -- not an AI-kept image
  AND i.source NOT IN ('ai-generated', 'ai-edited', 'ai')
  -- not referenced by the property-imagery curation layer (covers pinned heroes)
  AND NOT EXISTS (SELECT 1 FROM property_imagery_assets p WHERE p.image_studio_id = i.id)
  -- not wired onto a property / unit / deal via the entity-images panel
  AND NOT EXISTS (SELECT 1 FROM entity_images e WHERE e.image_studio_id = i.id)
  -- not filed into any collection
  AND NOT EXISTS (SELECT 1 FROM image_studio_collection_images ci WHERE ci.image_id = i.id);

-- ─── Tier 1: Prune orphaned uncategorised stock junk ─────────────────────
-- Deletes ONLY rows that are simultaneously:
--   (a) uncategorised — category NULL / '' / 'Stock' (off-list, UI-invisible)
--   (b) stock-sourced — pexels / pixabay / unsplash / stock
--   (c) not pinned and not referenced anywhere (FK + curation guards)
--   (d) not a curated brand / property / AI asset
-- Belt-and-braces: every protective condition is repeated even where one
-- implies another, so a future data quirk can't slip a curated row through.
BEGIN;

DELETE FROM image_studio_images i
WHERE (i.category IS NULL OR i.category = '' OR i.category = 'Stock')
  AND i.source IN ('pexels', 'pixabay', 'unsplash', 'stock')
  -- ── curated-brand guards ──
  AND i.category <> 'Brands'                                    -- never the Brand Library
  AND NOT ('brand-auto'  = ANY(COALESCE(i.tags, '{}')))         -- never brand-enrichment fetches
  AND NOT ('logo'        = ANY(COALESCE(i.tags, '{}')))         -- never a logo
  AND NOT ('Brand Hero'  = ANY(COALESCE(i.tags, '{}')))         -- never a scraped brand hero
  AND NOT ('pinned'      = ANY(COALESCE(i.tags, '{}')))         -- never a tag-pinned keeper
  -- ── CRM-link guards ──
  AND i.property_id IS NULL                                     -- never property-linked
  AND i.company_id  IS NULL                                     -- never brand/landlord-linked
  AND (i.brand_name IS NULL OR i.brand_name = '')               -- never brand-attributed
  -- ── AI-kept guard ──
  AND i.source NOT IN ('ai-generated', 'ai-edited', 'ai')       -- never an AI keep
  -- ── reference guards (this is the "not pinned / not referenced" belt) ──
  AND NOT EXISTS (SELECT 1 FROM property_imagery_assets p WHERE p.image_studio_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM entity_images e           WHERE e.image_studio_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM image_studio_collection_images ci WHERE ci.image_id = i.id);

-- Review the DELETE row count against Tier 0's `will_delete`. If they match
-- and the number looks sane, COMMIT. Otherwise ROLLBACK and investigate.
-- COMMIT;
-- ROLLBACK;


-- ─── Optional Tier 2: orphaned property_imagery_assets discovery rows ─────
-- After Tier 1, any property_imagery_assets row whose image was deleted is
-- left with image_studio_id = NULL (migration 0010 set ON DELETE SET NULL).
-- These linger as "discovery candidates" with only a source_url. Same shape
-- as the existing cleanup script — prune the stock ones that were never
-- pinned. Aggressive; only run if you want them gone.
-- BEGIN;
-- DELETE FROM property_imagery_assets
--  WHERE image_studio_id IS NULL
--    AND source IN ('pexels', 'unsplash', 'google_static')
--    AND pinned = false;
-- -- COMMIT;
-- -- ROLLBACK;


-- ─── Final check ─────────────────────────────────────────────────────────
-- Recount the uncategorised pile + the full category distribution so you can
-- confirm the curated rows (Brands, Properties, Generated, …) are intact.
SELECT
  COUNT(*) FILTER (WHERE category IS NULL OR category = '' OR category = 'Stock') AS uncategorised_remaining,
  COUNT(*)                                                                        AS grand_total
FROM image_studio_images;

SELECT COALESCE(NULLIF(category, ''), '(null)') AS category, COUNT(*) AS rows
  FROM image_studio_images
 GROUP BY 1
 ORDER BY rows DESC;
