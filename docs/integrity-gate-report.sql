-- ============================================================================
-- UNIT SPINE — LINK-INTEGRITY RECONCILIATION (READ-ONLY GO/NO-GO GATE)
-- ----------------------------------------------------------------------------
-- Run this against PRODUCTION before designing the column-ownership migration.
-- Every statement is a SELECT. Nothing is mutated.
--
-- The target architecture (two-layer spine):
--     property_units            (physical master — address, area, EPC, condition)
--        ▲
--        │ unit_id
--   tenancy_schedule_units       (lease / income spine)
--        ▲
--        │ tenancy_unit_id
--   available_units / leasing_schedule_units / crm_deals  (read-through)
--
-- The read-through model only works if those links are populated and valid.
-- These queries quantify how far reality is from that. Read the COUNTS:
-- if the "orphan"/"dangling" numbers are large, this is a data-cleanup-first
-- job, not a pure refactor.
--
-- NOTE ON STATUS CODES: the "one live deal per unit" check filters out
-- terminal statuses. Adjust the IN (...) list at the bottom to match your
-- real status vocabulary (Completed / Invoiced / Withdrawn, or COM/INV/WIT).
-- ============================================================================


-- 0. BASELINE ROW COUNTS ------------------------------------------------------
SELECT 'property_units'          AS tbl, count(*) AS rows FROM property_units
UNION ALL SELECT 'tenancy_schedule_units', count(*) FROM tenancy_schedule_units
UNION ALL SELECT 'available_units',        count(*) FROM available_units
UNION ALL SELECT 'leasing_schedule_units', count(*) FROM leasing_schedule_units
UNION ALL SELECT 'crm_deals',              count(*) FROM crm_deals;


-- 1. AVAILABLE_UNITS → tenancy spine -----------------------------------------
-- Orphans (no spine link at all) + dangling (link points nowhere).
SELECT
  count(*) FILTER (WHERE tenancy_unit_id IS NULL)                       AS no_spine_link,
  count(*) FILTER (WHERE tenancy_unit_id IS NOT NULL AND t.id IS NULL)  AS dangling_spine_link,
  count(*)                                                              AS total
FROM available_units a
LEFT JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id;

-- AVAILABLE_UNITS → physical master (property_units)
SELECT
  count(*) FILTER (WHERE unit_id IS NULL)                       AS no_physical_link,
  count(*) FILTER (WHERE unit_id IS NOT NULL AND p.id IS NULL)  AS dangling_physical_link,
  count(*)                                                      AS total
FROM available_units a
LEFT JOIN property_units p ON p.id = a.unit_id;


-- 2. LEASING_SCHEDULE_UNITS → tenancy spine ----------------------------------
SELECT
  count(*) FILTER (WHERE tenancy_unit_id IS NULL)                       AS no_spine_link,
  count(*) FILTER (WHERE tenancy_unit_id IS NOT NULL AND t.id IS NULL)  AS dangling_spine_link,
  count(*)                                                              AS total
FROM leasing_schedule_units l
LEFT JOIN tenancy_schedule_units t ON t.id = l.tenancy_unit_id;


-- 3. CRM_DEALS → tenancy spine -----------------------------------------------
-- Deals not anchored to the spine can't be read through onto any schedule.
SELECT
  count(*) FILTER (WHERE tenancy_unit_id IS NULL)                       AS no_spine_link,
  count(*) FILTER (WHERE tenancy_unit_id IS NOT NULL AND t.id IS NULL)  AS dangling_spine_link,
  count(*)                                                              AS total
FROM crm_deals d
LEFT JOIN tenancy_schedule_units t ON t.id = d.tenancy_unit_id;


-- 4. MISSING PHYSICAL LAYER --------------------------------------------------
-- FINDING: tenancy_schedule_units has NO FK to property_units today (only
-- property_id). So the "tenancy reads physical facts through property_units"
-- link does not yet exist — it has to be added and back-filled. This query
-- estimates how many tenancy rows could be matched to a property_units row
-- by (property_id, unit number/name) so we can gauge back-fill feasibility.
SELECT
  count(*)                                                   AS tenancy_rows,
  count(*) FILTER (WHERE pu.id IS NOT NULL)                  AS matchable_to_physical,
  count(*) FILTER (WHERE pu.id IS NULL)                      AS no_physical_match
FROM tenancy_schedule_units t
LEFT JOIN property_units pu
  ON pu.property_id = t.property_id
 AND lower(trim(pu.unit_name)) = lower(trim(t.unit_number));


-- 5. BIDIRECTIONAL BACK-POINTER DRIFT ----------------------------------------
-- available_units.tenancy_unit_id  ⇄  tenancy_schedule_units.letting_tracker_unit_id
-- These two point at each other; count where they DISAGREE (the back-pointer
-- is the column we plan to delete, so this measures how stale it already is).
SELECT
  count(*) FILTER (WHERE t.letting_tracker_unit_id IS DISTINCT FROM a.id) AS back_pointer_mismatch,
  count(*)                                                                AS linked_pairs
FROM available_units a
JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id;


-- 6. DEAL-LINK DRIFT ---------------------------------------------------------
-- Three places store the deal link: available_units.deal_id,
-- tenancy_schedule_units.deal_id, and crm_deals.tenancy_unit_id.
-- Count tenancy rows where its deal_id disagrees with the available_units it
-- is paired with.
SELECT
  count(*) FILTER (WHERE t.deal_id IS DISTINCT FROM a.deal_id) AS deal_id_mismatch,
  count(*)                                                     AS linked_pairs
FROM available_units a
JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id;


-- 7. MULTIPLE LIVE DEALS PER UNIT --------------------------------------------
-- The agreed model is ONE live deal per unit (competitors live as unit_offers).
-- This finds spine units that currently carry more than one non-terminal deal.
-- >>> ADJUST the terminal-status list to your real vocabulary. <<<
SELECT
  d.tenancy_unit_id,
  count(*) AS live_deals
FROM crm_deals d
WHERE d.tenancy_unit_id IS NOT NULL
  AND d.status NOT IN ('Completed','Invoiced','Withdrawn','COM','INV','WIT')
GROUP BY d.tenancy_unit_id
HAVING count(*) > 1
ORDER BY live_deals DESC;


-- 8. DUPLICATED-FIELD DRIFT (quantifies the mirror problem) ------------------
-- epc_rating is stored on property_units AND available_units AND tenancy.
-- For linked rows, how often do the copies already disagree?
SELECT
  count(*) FILTER (WHERE a.epc_rating IS DISTINCT FROM t.epc_rating) AS epc_avail_vs_tenancy_mismatch,
  count(*) FILTER (WHERE p.epc_rating IS DISTINCT FROM t.epc_rating) AS epc_physical_vs_tenancy_mismatch,
  count(*)                                                           AS comparable_rows
FROM available_units a
JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id
LEFT JOIN property_units p    ON p.id = a.unit_id;

-- sqft drift: property_units.sqft vs available_units.sqft vs tenancy.nia_sqft
SELECT
  count(*) FILTER (WHERE a.sqft IS DISTINCT FROM p.sqft)      AS sqft_avail_vs_physical_mismatch,
  count(*) FILTER (WHERE a.sqft IS DISTINCT FROM t.nia_sqft)  AS sqft_avail_vs_tenancy_nia_mismatch,
  count(*)                                                    AS comparable_rows
FROM available_units a
JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id
LEFT JOIN property_units p    ON p.id = a.unit_id;


-- 9. TARGET-BRAND DUPLICATION ------------------------------------------------
-- target_company_ids lives on BOTH tenancy_schedule_units and
-- leasing_schedule_units. Count tenancy rows that still carry target data we
-- plan to retire (move ownership to leasing_schedule_units).
SELECT
  count(*) FILTER (WHERE target_tenants IS NOT NULL AND target_tenants <> '') AS tenancy_with_target_tenants,
  count(*) FILTER (WHERE array_length(target_company_ids, 1) > 0)             AS tenancy_with_target_company_ids,
  count(*)                                                                    AS total
FROM tenancy_schedule_units;
