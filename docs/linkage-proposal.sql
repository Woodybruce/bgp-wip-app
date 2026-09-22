-- ============================================================================
-- LINKAGE PROPOSAL — sizes the manual burden of "everything on the spine".
-- Read-only. For each pile of unlinked rows, buckets them into:
--   auto_unique  → exactly one name match on the same property (auto-linkable)
--   ambiguous    → multiple candidates (needs a human to pick)
--   no_match     → no candidate (needs creating or manual)
-- Normalisation: lowercase, trim, strip non-alphanumerics.
-- ============================================================================

-- A · available_units orphans (tenancy_unit_id IS NULL) → tenancy candidates
WITH a AS (
  SELECT av.id,
    (SELECT count(*) FROM tenancy_schedule_units t
      WHERE t.property_id = av.property_id
        AND regexp_replace(lower(trim(t.unit_number)),'[^a-z0-9]+','','g')
          = regexp_replace(lower(trim(av.unit_name)),'[^a-z0-9]+','','g')
        AND regexp_replace(lower(trim(av.unit_name)),'[^a-z0-9]+','','g') <> ''
    ) AS cands
  FROM available_units av WHERE av.tenancy_unit_id IS NULL)
SELECT 'A available_units orphans' AS category,
  count(*) FILTER (WHERE cands = 1) AS auto_unique,
  count(*) FILTER (WHERE cands > 1) AS ambiguous,
  count(*) FILTER (WHERE cands = 0) AS no_match,
  count(*) AS total
FROM a;

-- B · leasing_schedule orphans → tenancy candidates
WITH b AS (
  SELECT l.id,
    (SELECT count(*) FROM tenancy_schedule_units t
      WHERE t.property_id = l.property_id
        AND regexp_replace(lower(trim(t.unit_number)),'[^a-z0-9]+','','g')
          = regexp_replace(lower(trim(l.unit_name)),'[^a-z0-9]+','','g')
        AND regexp_replace(lower(trim(l.unit_name)),'[^a-z0-9]+','','g') <> ''
    ) AS cands
  FROM leasing_schedule_units l WHERE l.tenancy_unit_id IS NULL)
SELECT 'B leasing_schedule orphans' AS category,
  count(*) FILTER (WHERE cands = 1) AS auto_unique,
  count(*) FILTER (WHERE cands > 1) AS ambiguous,
  count(*) FILTER (WHERE cands = 0) AS no_match,
  count(*) AS total
FROM b;

-- C · crm_deals unlinked — split unit-scoped (has unit_id) from building-level
SELECT 'C crm_deals unlinked' AS category,
  count(*) FILTER (WHERE unit_id IS NOT NULL) AS has_unit_id_bridgeable,
  count(*) FILTER (WHERE unit_id IS NULL)     AS no_unit_building_level,
  count(*) AS total
FROM crm_deals WHERE tenancy_unit_id IS NULL;

-- C2 · deal_type breakdown of the unlinked deals (which are genuinely unit-less?)
SELECT 'C2 deal_type' AS category, coalesce(deal_type,'(null)') AS deal_type, count(*) AS n
FROM crm_deals WHERE tenancy_unit_id IS NULL
GROUP BY deal_type ORDER BY n DESC;

-- D · tenancy rows with no physical master → property_units candidates
WITH d AS (
  SELECT t.id,
    (SELECT count(*) FROM property_units p
      WHERE p.property_id = t.property_id
        AND regexp_replace(lower(trim(p.unit_name)),'[^a-z0-9]+','','g')
          = regexp_replace(lower(trim(t.unit_number)),'[^a-z0-9]+','','g')
        AND regexp_replace(lower(trim(t.unit_number)),'[^a-z0-9]+','','g') <> ''
    ) AS cands
  FROM tenancy_schedule_units t
  WHERE NOT EXISTS (SELECT 1 FROM property_units p
      WHERE p.property_id = t.property_id
        AND lower(trim(p.unit_name)) = lower(trim(t.unit_number))))
SELECT 'D tenancy without physical' AS category,
  count(*) FILTER (WHERE cands = 1) AS auto_unique_normalised,
  count(*) FILTER (WHERE cands > 1) AS ambiguous,
  count(*) FILTER (WHERE cands = 0) AS must_create,
  count(*) AS total
FROM d;
