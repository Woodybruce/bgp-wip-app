-- Migration 0008 — backfill retail_leasing_comps into crm_comps
--
-- Pathway Stage 1 used to write retail comps to retail_leasing_comps
-- (an orphan table that no UI or API read from). The extractor now writes
-- to crm_comps instead, tagged with source_evidence='Pathway'. The dedupe
-- key (address|tenant|YYYY-MM) lives in comments as `[pathway-key:XYZ]`
-- so re-runs don't duplicate AND the original email subject is preserved
-- in source_title.
--
-- This migration copies any existing retail_leasing_comps rows into
-- crm_comps so historical Pathway extractions surface in the comps page.
-- Idempotent: dedupes by the [pathway-key:...] marker in comments.

INSERT INTO crm_comps (
  name, address, postcode, area_location,
  tenant, landlord, use_class, comp_type,
  headline_rent, rent_psf_overall, rent_psf_nia, rent_psf_gia,
  area_sqft, rent_free_months, fitout_contribution,
  completion_date, term, break_clause,
  source_evidence, source_url, source_title, comments,
  created_by
)
SELECT
  COALESCE(rlc.address, rlc.tenant, 'Pathway-extracted comp')        AS name,
  jsonb_build_object('formatted', rlc.address, 'line1', rlc.address) AS address,
  rlc.postcode                                                       AS postcode,
  rlc.submarket                                                      AS area_location,
  rlc.tenant                                                         AS tenant,
  rlc.landlord                                                       AS landlord,
  rlc.use_class                                                      AS use_class,
  COALESCE(rlc.sector, 'retail')                                     AS comp_type,
  rlc.rent_pa::text                                                  AS headline_rent,
  rlc.rent_psf::text                                                 AS rent_psf_overall,
  rlc.rent_psf::text                                                 AS rent_psf_nia,
  rlc.rent_psf::text                                                 AS rent_psf_gia,
  rlc.area_sqft::text                                                AS area_sqft,
  rlc.rent_free_months::text                                         AS rent_free_months,
  CASE WHEN rlc.premium IS NOT NULL THEN '£' || rlc.premium::text ELSE NULL END AS fitout_contribution,
  rlc.lease_date                                                     AS completion_date,
  CASE WHEN rlc.term_years IS NOT NULL THEN rlc.term_years::text || ' years' ELSE NULL END AS term,
  CASE WHEN rlc.break_years IS NOT NULL THEN rlc.break_years::text || ' years' ELSE NULL END AS break_clause,
  'Pathway'                                                          AS source_evidence,
  rlc.source_id                                                      AS source_url,
  rlc.source_ref                                                     AS source_title,    -- preserve email subject
  CONCAT_WS(' · ',
    '[pathway-key:' || rlc.dedupe_key || ']',
    rlc.notes,
    CASE WHEN rlc.sector IS NOT NULL THEN 'Sector: ' || rlc.sector ELSE NULL END,
    CASE WHEN rlc.submarket IS NOT NULL THEN 'Submarket: ' || rlc.submarket ELSE NULL END,
    CASE WHEN rlc.confidence IS NOT NULL THEN 'Confidence: ' || rlc.confidence::text ELSE NULL END
  )                                                                  AS comments,
  rlc.created_by                                                     AS created_by
FROM retail_leasing_comps rlc
LEFT JOIN crm_comps cc
  ON cc.source_evidence = 'Pathway'
 AND cc.comments LIKE '%[pathway-key:' || rlc.dedupe_key || ']%'
WHERE cc.id IS NULL;  -- only insert rows we haven't already migrated

-- We deliberately do NOT drop retail_leasing_comps yet — keep it as an
-- archive in case we need to re-derive any field. Drop in a follow-up
-- migration once the team has signed off on the merged data.
