-- Image Studio cleanup — one-off, manual run.
--
-- Intent: shrink image_studio_images so the page loads quickly and the
-- library is curatable. The list endpoint no longer ships thumbnails
-- inline (see commit), but row count itself is a separate problem —
-- thousands of auto-fetched stock photos that nobody uses.
--
-- The `category != 'Brands'` carve-out is preserved on every DELETE so
-- the curated Brand Library is never touched.
--
-- Run order: Tier 0 (preview) → Tier 1 → Tier 2 → re-check counts.
-- All DELETEs are wrapped in BEGIN/COMMIT so you can ROLLBACK if a
-- count looks wrong.

-- ─── Tier 0: Preview — no rows changed ───────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE source = 'pexels')                              AS pexels_total,
  COUNT(*) FILTER (WHERE source = 'pexels' AND category <> 'Brands')     AS pexels_non_brand,
  COUNT(*) FILTER (WHERE source = 'unsplash')                            AS unsplash_total,
  COUNT(*) FILTER (WHERE source = 'unsplash' AND category <> 'Brands')   AS unsplash_non_brand,
  COUNT(*) FILTER (WHERE 'brand-auto' = ANY(tags) AND category <> 'Brands') AS brand_auto_orphans,
  COUNT(*) FILTER (WHERE category = 'Brand'  AND category <> 'Brands')   AS singular_brand_typo,
  COUNT(*)                                                               AS grand_total
FROM image_studio_images;

-- ─── Tier 1: Stock-photo dross from Pexels ───────────────────────────────
-- Removes Pexels auto-fetches that haven't been curated into the Brand
-- Library. These are the prime suspects for the bloat — generic
-- "store exterior" stock that almost never matches the actual brand.
BEGIN;

DELETE FROM image_studio_images
 WHERE source = 'pexels'
   AND category <> 'Brands';

-- review the row count before COMMIT — if it's way more than you
-- expected, run ROLLBACK instead.
-- COMMIT;
-- ROLLBACK;


-- ─── Tier 2: Orphan brand-auto fetches ───────────────────────────────────
-- The brand-enrichment cron tags every auto-fetch with 'brand-auto'
-- and a category of 'Brand' (singular — typo in the original code).
-- The Brand Library UI filters on category='Brands' (plural) so these
-- rows are invisible orphans. Drop them.
BEGIN;

DELETE FROM image_studio_images
 WHERE 'brand-auto' = ANY(tags)
   AND category = 'Brand'      -- the typoed singular
   AND category <> 'Brands';   -- belt + braces — never touch curated brand library

-- review then COMMIT or ROLLBACK.
-- COMMIT;
-- ROLLBACK;


-- ─── Optional Tier 3: Unsplash auto-fetches that nobody curated ──────────
-- Aggressive — comment back in only if Tiers 1+2 didn't reduce enough.
-- Same logic as Tier 1 but for Unsplash. Unsplash results were
-- generally better than Pexels, so think twice.
-- BEGIN;
-- DELETE FROM image_studio_images
--  WHERE source = 'unsplash'
--    AND category <> 'Brands'
--    AND uploaded_by IS NULL;   -- only auto-imported, not user-uploaded
-- -- COMMIT;


-- ─── After deletion: orphan property_imagery_assets rows ─────────────────
-- The property_imagery_assets curation table references image_studio_id.
-- Migration 0010 added ON DELETE SET NULL on that FK, so any references
-- to a deleted image are now image_studio_id = NULL. They still exist as
-- "discovery candidates" with the original source_url. If you want to
-- prune those too:
-- DELETE FROM property_imagery_assets
--  WHERE image_studio_id IS NULL
--    AND source IN ('pexels', 'unsplash')
--    AND pinned = false;


-- ─── Final check ─────────────────────────────────────────────────────────
SELECT category, source, COUNT(*) AS rows
  FROM image_studio_images
 GROUP BY category, source
 ORDER BY rows DESC;
