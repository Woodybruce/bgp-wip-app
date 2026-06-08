-- ============================================================================
-- UNIT SPINE — INTEGRITY GATE (ONE-SHOT)
-- Read-only. Returns ONE table: each row is a check + its count.
-- Paste the whole thing into Railway → Postgres → Query, or
--   railway connect Postgres   then paste.
-- Read the numbers: big "no link" / "dangling" / ">1 live deal" / "drift"
-- counts mean data-cleanup-first; small means we can refactor straight away.
-- NOTE: adjust the terminal-status list in check 11 to your real codes.
-- ============================================================================
SELECT check, value FROM (

  -- ---- baseline ----
  SELECT 1 AS ord, '0 · property_units rows'                        AS check, (SELECT count(*) FROM property_units)::text AS value
  UNION ALL SELECT 2,  '0 · tenancy_schedule_units rows',           (SELECT count(*) FROM tenancy_schedule_units)::text
  UNION ALL SELECT 3,  '0 · available_units rows',                  (SELECT count(*) FROM available_units)::text
  UNION ALL SELECT 4,  '0 · leasing_schedule_units rows',           (SELECT count(*) FROM leasing_schedule_units)::text
  UNION ALL SELECT 5,  '0 · crm_deals rows',                        (SELECT count(*) FROM crm_deals)::text

  -- ---- available_units → tenancy spine ----
  UNION ALL SELECT 10, '1 · available_units · NO spine link',       (SELECT count(*) FROM available_units WHERE tenancy_unit_id IS NULL)::text
  UNION ALL SELECT 11, '1 · available_units · DANGLING spine link', (SELECT count(*) FROM available_units a WHERE a.tenancy_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenancy_schedule_units t WHERE t.id = a.tenancy_unit_id))::text

  -- ---- available_units → physical master (property_units) ----
  UNION ALL SELECT 20, '2 · available_units · NO physical link',    (SELECT count(*) FROM available_units WHERE unit_id IS NULL)::text
  UNION ALL SELECT 21, '2 · available_units · DANGLING physical link', (SELECT count(*) FROM available_units a WHERE a.unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM property_units p WHERE p.id = a.unit_id))::text

  -- ---- leasing_schedule_units → tenancy spine ----
  UNION ALL SELECT 30, '3 · leasing_schedule · NO spine link',      (SELECT count(*) FROM leasing_schedule_units WHERE tenancy_unit_id IS NULL)::text
  UNION ALL SELECT 31, '3 · leasing_schedule · DANGLING spine link',(SELECT count(*) FROM leasing_schedule_units l WHERE l.tenancy_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenancy_schedule_units t WHERE t.id = l.tenancy_unit_id))::text

  -- ---- crm_deals → tenancy spine ----
  UNION ALL SELECT 40, '4 · crm_deals · NO spine link',             (SELECT count(*) FROM crm_deals WHERE tenancy_unit_id IS NULL)::text
  UNION ALL SELECT 41, '4 · crm_deals · DANGLING spine link',       (SELECT count(*) FROM crm_deals d WHERE d.tenancy_unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenancy_schedule_units t WHERE t.id = d.tenancy_unit_id))::text

  -- ---- missing physical FK (tenancy has no property_unit_id yet) ----
  UNION ALL SELECT 50, '5 · tenancy rows matchable to a physical master', (SELECT count(*) FROM tenancy_schedule_units t WHERE EXISTS (SELECT 1 FROM property_units p WHERE p.property_id = t.property_id AND lower(trim(p.unit_name)) = lower(trim(t.unit_number))))::text
  UNION ALL SELECT 51, '5 · tenancy rows with NO physical match',    (SELECT count(*) FROM tenancy_schedule_units t WHERE NOT EXISTS (SELECT 1 FROM property_units p WHERE p.property_id = t.property_id AND lower(trim(p.unit_name)) = lower(trim(t.unit_number))))::text

  -- ---- back-pointer + deal-link drift (columns we plan to delete) ----
  UNION ALL SELECT 60, '6 · back-pointer mismatch (avail ⇄ tenancy)', (SELECT count(*) FROM available_units a JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id WHERE t.letting_tracker_unit_id IS DISTINCT FROM a.id)::text
  UNION ALL SELECT 61, '6 · deal_id mismatch (avail vs tenancy)',    (SELECT count(*) FROM available_units a JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id WHERE t.deal_id IS DISTINCT FROM a.deal_id)::text

  -- ---- one-live-deal-per-unit violations ----
  UNION ALL SELECT 70, '7 · units with >1 LIVE deal',               (SELECT count(*) FROM (SELECT tenancy_unit_id FROM crm_deals WHERE tenancy_unit_id IS NOT NULL AND status NOT IN ('Completed','Invoiced','Withdrawn','COM','INV','WIT') GROUP BY tenancy_unit_id HAVING count(*) > 1) x)::text

  -- ---- duplicated-field drift (the mirror problem, quantified) ----
  UNION ALL SELECT 80, '8 · EPC drift: available vs tenancy',       (SELECT count(*) FROM available_units a JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id WHERE a.epc_rating IS DISTINCT FROM t.epc_rating)::text
  UNION ALL SELECT 81, '8 · sqft drift: available vs tenancy NIA',  (SELECT count(*) FROM available_units a JOIN tenancy_schedule_units t ON t.id = a.tenancy_unit_id WHERE a.sqft IS DISTINCT FROM t.nia_sqft)::text

  -- ---- target-brand duplication (to retire on tenancy) ----
  UNION ALL SELECT 90, '9 · tenancy rows still holding target brands', (SELECT count(*) FROM tenancy_schedule_units WHERE (target_tenants IS NOT NULL AND target_tenants <> '') OR array_length(target_company_ids, 1) > 0)::text

) q ORDER BY ord;
