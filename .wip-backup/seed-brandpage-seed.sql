-- Brand page re-layout: LOCAL TEST DATA ONLY (database bgpsmoke on 127.0.0.1).
-- Makes the Starbucks test brand a full brand; Testco Bakery is left untouched.
--
-- Rules followed: rows are only ADDED, every row has a fixed id (prefix
-- b9a6e000-0000-4000-8000-...), every insert is ON CONFLICT DO NOTHING (or
-- WHERE NOT EXISTS), so the file can be run again safely. The only UPDATE is
-- on the Starbucks test brand row and only fills fields that are NULL
-- (COALESCE), plus one ADDED key inside its ai_generated_fields JSON
-- (official_profile), which is what lets the stored BGP take be shown while
-- "Core facts need review" stays on. To take that key off again:
--   UPDATE crm_companies SET ai_generated_fields = ai_generated_fields - 'official_profile'
--    WHERE id = '11110000-0000-0000-0000-000000000201';
--
-- Not in this file: the brand_social_stats table did not exist in this
-- database. It was created by the app's own route (POST
-- /api/brand/:id/social-scrape runs CREATE TABLE IF NOT EXISTS and then stops
-- because ScraperAPI is not configured). The follower rows below are skipped
-- when the table is missing.
--
-- Run: PGPASSWORD=qa-local-pg psql -h 127.0.0.1 -U postgres -d bgpsmoke -v ON_ERROR_STOP=1 -f seed.sql

BEGIN;

-- ── 1. The Starbucks brand row: NULL fields filled ───────────────────────
UPDATE crm_companies SET
  concept_pitch          = COALESCE(concept_pitch, 'Third-place coffeehouse: espresso drinks, cold coffee and food to go, in kiosk, in-line, Reserve and drive-thru formats.'),
  x_handle               = COALESCE(x_handle, '@StarbucksUK'),
  head_office_address    = COALESCE(head_office_address, '{"street":"Building 4, Chiswick Park, 566 Chiswick High Road","city":"London","postcode":"W4 5YE","country":"United Kingdom"}'::jsonb),
  employee_count         = COALESCE(employee_count, '381000'),
  annual_revenue         = COALESCE(annual_revenue, '36200000000'),
  companies_house_number = COALESCE(companies_house_number, '02959325'),
  companies_house_data   = COALESCE(companies_house_data, jsonb_build_object(
    'checkedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'note', 'Local test data',
    'profile', jsonb_build_object(
      'companyName', 'STARBUCKS COFFEE COMPANY (UK) LIMITED',
      'companyNumber', '02959325',
      'companyStatus', 'active',
      'dateOfCreation', '1994-08-17',
      'lastAccountsMadeUpTo', '2025-09-28',
      'accountsOverdue', false,
      'confirmationStatementOverdue', false,
      'hasInsolvencyHistory', false,
      'hasCharges', false,
      'registered_office_address', jsonb_build_object(
        'address_line_1', 'Building 4 Chiswick Park', 'address_line_2', '566 Chiswick High Road',
        'locality', 'London', 'postal_code', 'W4 5YE')),
    'officers', jsonb_build_array(
      jsonb_build_object('name', 'WHITCOMBE, Sarah Jane', 'officerRole', 'director', 'appointedOn', '2022-03-01', 'nationality', 'British', 'occupation', 'Property Director'),
      jsonb_build_object('name', 'HARGREAVES, Daniel Robert', 'officerRole', 'director', 'appointedOn', '2020-10-12', 'nationality', 'British', 'occupation', 'Finance Director'),
      jsonb_build_object('name', 'LINDQVIST, Anna', 'officerRole', 'secretary', 'appointedOn', '2019-06-03', 'nationality', 'Swedish', 'occupation', 'Company Secretary')),
    'pscs', jsonb_build_array(
      jsonb_build_object('name', 'Starbucks Coffee Holdings (UK) Limited', 'kind', 'corporate-entity-person-with-significant-control', 'naturesOfControl', jsonb_build_array('ownership-of-shares-75-to-100-percent'))))),
  kyc_status             = COALESCE(kyc_status, 'approved'),
  kyc_expires_at         = COALESCE(kyc_expires_at, TIMESTAMP '2027-05-31 00:00:00'),
  bgp_contact_user_ids   = COALESCE(bgp_contact_user_ids, ARRAY['72715f6f-905d-40f4-bded-5275175f3e2b', '498e3ede-c9d8-4d8d-bfd5-1afa09cd6219']),
  brand_analysis         = COALESCE(brand_analysis, E'**Where they are growing.** Starbucks UK has said it will open 500 coffee shops by 2031, weighted to drive-thru, roadside and travel sites, with a second strand of smaller kiosks in strong shopping centres. Franchise partners (23.5 Degrees, Euro Garages, Soul Coffee House) take most roadside sites; the company keeps prime high street, Reserve and shopping centre stores.\n\n**What they take.** Kiosks of 250 to 400 sq ft on busy malls, in-line units of 1,200 to 2,200 sq ft with external seating, and drive-thru pods of about 1,800 sq ft on 0.4 acres. Ten-year leases with a break at year five are usual; they resist turnover rent.\n\n**Recommendation** Lead with Bluewater KL11 and the Westgate RU9 unit, and keep Brent Cross moving through solicitors before the January rent review.'),
  brand_analysis_at      = COALESCE(brand_analysis_at, now() - interval '21 days'),
  ai_competitors         = COALESCE(ai_competitors, '[
    {"name":"Costa Coffee","segment":"Coffee chain","reason":"Largest UK coffee chain; same kiosk, in-line and drive-thru formats."},
    {"name":"Caffè Nero","segment":"Coffee chain","reason":"High street and shopping centre coffee at a similar price point."},
    {"name":"Pret A Manger","segment":"Coffee and food to go","reason":"Competes for the same commuter and mall pitches."},
    {"name":"Blank Street","segment":"Small-format coffee","reason":"Fast-growing kiosk operator taking the smallest units."},
    {"name":"Gail''s Bakery","segment":"Bakery café","reason":"Premium café taking in-line units in affluent centres."},
    {"name":"Black Sheep Coffee","segment":"Coffee chain","reason":"Expanding through franchise into shopping centres and travel hubs."}
  ]'::jsonb),
  ai_competitors_at      = COALESCE(ai_competitors_at, now() - interval '21 days')
WHERE id = '11110000-0000-0000-0000-000000000201';

-- One added key in ai_generated_fields (nothing existing is changed). The
-- fingerprint is this brand's identity fingerprint as the app reports it.
UPDATE crm_companies
   SET ai_generated_fields = jsonb_set(ai_generated_fields, '{official_profile}', jsonb_build_object(
         'fingerprint', 'f64db034f421e82a1616f4d45280399d1c05ff12b88c3a045c753178fa624554',
         'description', 'Starbucks is a coffeehouse chain selling espresso drinks, cold coffee, teas, bakery and food from company-owned and franchised stores.',
         'industry', 'Coffee shops',
         'url', 'https://www.starbucks.com/',
         'quote', 'Starbucks Coffee Company',
         'checkedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'note', 'Local test data'), true)
 WHERE id = '11110000-0000-0000-0000-000000000201'
   AND ai_generated_fields IS NOT NULL
   AND NOT (ai_generated_fields ? 'official_profile');

-- ── 2. The stored BGP take (no AI call) ──────────────────────────────────
INSERT INTO system_settings (key, value, updated_at) VALUES (
  'brand-prepared-take:11110000-0000-0000-0000-000000000201:brand',
  jsonb_build_object(
    'text', E'**Get the Bluewater kiosk to heads of terms before the Christmas trading break.**\n- **Evidence:** Starbucks has an active requirement for shopping centre kiosks and in-line units of 800 to 1,800 sq ft in London, Kent and the South East. Their property team viewed KL11 at Bluewater on 4 Nov 2026 and a second viewing is booked for 18 Nov 2026. A closure at Holborn Kingsway and a new drive-thru at Cribbs Causeway were both logged this week.\n- **BGP angle:** Two live lettings are with Landsec (Bluewater KL11, Westgate RU9) and one with Hammerson at Brent Cross, which is with solicitors. Inference: kiosks and drive-thrus are where they are moving fastest, because both recorded requirements name them.\n- **Next step:** Victoria Broadhead to send the KL11 terms to Sarah Whitcombe and confirm the Westgate viewing with CBRE.',
    'policyVersion', '2026-09-27-plain-english-5:equity-private-20261027-v1',
    'fingerprint', 'f64db034f421e82a1616f4d45280399d1c05ff12b88c3a045c753178fa624554',
    'dataHash', 'local-test-seed',
    'generatedAt', (extract(epoch FROM now()) * 1000)::bigint,
    'expiresAt', (extract(epoch FROM now() + interval '5 years') * 1000)::bigint),
  now())
ON CONFLICT (key) DO NOTHING;

-- ── 3. Contacts (Tom Barista already exists: these three make four) ──────
INSERT INTO crm_contacts (id, name, role, company_id, company_name, email, phone, phone_mobile, linkedin_url, notes, created_at, updated_at) VALUES
  ('b9a6e000-0000-4000-8000-000000000101', 'Sarah Whitcombe', 'UK Property Director', '11110000-0000-0000-0000-000000000201', 'Starbucks', 'sarah.whitcombe@starbucks.example', '020 7946 0321', '07700 900321', 'https://www.linkedin.com/in/sarah-whitcombe-example/', 'Local test data.', now() - interval '120 days', now()),
  ('b9a6e000-0000-4000-8000-000000000102', 'James Okafor', 'Acquisitions Manager, South', '11110000-0000-0000-0000-000000000201', 'Starbucks', 'james.okafor@starbucks.example', NULL, '07700 900412', NULL, 'Local test data.', now() - interval '90 days', now()),
  ('b9a6e000-0000-4000-8000-000000000103', 'Priya Nair', 'Head of Franchise Development', '11110000-0000-0000-0000-000000000201', 'Starbucks', 'priya.nair@starbucks.example', '020 7946 0388', NULL, NULL, 'Local test data.', now() - interval '60 days', now())
ON CONFLICT (id) DO NOTHING;

-- ── 4. Stores: twelve UK stores with towns and coordinates ───────────────
-- source_type 'manual' is what the app writes for a store added by hand, and
-- is shown whatever the identity state (the 257 existing rows are held back
-- as identity_review and are not touched).
INSERT INTO brand_stores (id, brand_company_id, name, address, lat, lng, status, store_type, notes, source_type, researched_at, country, crm_property_id) VALUES
  ('b9a6e000-0000-4000-8000-000000000201', '11110000-0000-0000-0000-000000000201', 'Starbucks Bluewater, Upper Thames Walk', 'Upper Thames Walk, Bluewater, Greenhithe DA9 9ST', 51.4393, 0.2722, 'open', 'Shopping centre', 'Local test data.', 'manual', now(), 'GB', 'cccccccc-0000-0000-0000-000000000001'),
  ('b9a6e000-0000-4000-8000-000000000202', '11110000-0000-0000-0000-000000000201', 'Starbucks Brent Cross', 'Brent Cross Shopping Centre, London NW4 3FP', 51.5764, -0.2238, 'open', 'Shopping centre', 'Local test data.', 'manual', now(), 'GB', '99999999-2222-2222-2222-222222222222'),
  ('b9a6e000-0000-4000-8000-000000000203', '11110000-0000-0000-0000-000000000201', 'Starbucks Covent Garden, Long Acre', '99 Long Acre, London WC2E 9NR', 51.5127, -0.1247, 'open', 'High street', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000204', '11110000-0000-0000-0000-000000000201', 'Starbucks Manchester, Market Street', '55 Market Street, Manchester M1 1WA', 53.4826, -2.2404, 'open', 'High street', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000205', '11110000-0000-0000-0000-000000000201', 'Starbucks Birmingham, Bullring', 'Bullring, Birmingham B5 4BU', 52.4777, -1.8943, 'open', 'Shopping centre', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000206', '11110000-0000-0000-0000-000000000201', 'Starbucks Leeds, Trinity', 'Trinity Leeds, Albion Street, Leeds LS1 5AT', 53.7965, -1.5440, 'open', 'Shopping centre', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000207', '11110000-0000-0000-0000-000000000201', 'Starbucks Bristol, Cribbs Causeway drive-thru', 'Cribbs Causeway Retail Park, Bristol BS34 5TT', 51.5252, -2.5957, 'open', 'Drive-thru', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000208', '11110000-0000-0000-0000-000000000201', 'Starbucks Edinburgh, Princes Street', '120 Princes Street, Edinburgh EH2 4AD', 55.9520, -3.1970, 'open', 'High street', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000209', '11110000-0000-0000-0000-000000000201', 'Starbucks Cardiff, St David''s', 'St David''s Dewi Sant, Cardiff CF10 2EF', 51.4797, -3.1744, 'open', 'Shopping centre', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000210', '11110000-0000-0000-0000-000000000201', 'Starbucks Newcastle, Eldon Square', 'Eldon Square, Newcastle upon Tyne NE1 7JB', 54.9750, -1.6150, 'open', 'Shopping centre', 'Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000211', '11110000-0000-0000-0000-000000000201', 'Starbucks Milton Keynes drive-thru', 'Grafton Gate, Milton Keynes MK9 1AL', 52.0345, -0.7740, 'coming_soon', 'Drive-thru', 'Opening spring 2027. Local test data.', 'manual', now(), 'GB', NULL),
  ('b9a6e000-0000-4000-8000-000000000212', '11110000-0000-0000-0000-000000000201', 'Starbucks Holborn, Kingsway', '10 Kingsway, London WC2B 6LH', 51.5153, -0.1190, 'closed', 'High street', 'Closed at lease expiry. Local test data.', 'manual', now(), 'GB', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── 5. Deals: six, across stages and roles, on the existing test properties ─
-- Inserted directly (test data, not the app's write path). WHERE NOT EXISTS
-- rather than ON CONFLICT so a second run does not use up Ref numbers.
-- Landsec is the landlord on 0301 to 0303, so a Landsec login may see those
-- three and no others. Fee 54321 is a marker: it must never reach a client.
INSERT INTO crm_deals (id, name, deal_type, status, property_id, unit_id, tenancy_unit_id, landlord_id, tenant_id, team, internal_agent, fee, rent_pa, total_area_sqft, lease_length, bgp_acting_for, comments, created_at, updated_at, exchanged_at, completed_at)
SELECT v.id, v.name, v.deal_type, v.status, v.property_id, v.unit_id, v.tenancy_unit_id, v.landlord_id, v.tenant_id, v.team, v.internal_agent, v.fee, v.rent_pa, v.area, v.lease_length, v.acting, v.comments, v.created_at, v.updated_at, v.exchanged_at, v.completed_at
  FROM (VALUES
    ('b9a6e000-0000-4000-8000-000000000301', 'KL11 Bluewater — Starbucks kiosk', 'New Letting', 'NEG',
      'cccccccc-0000-0000-0000-000000000001', 'fc556170-4457-4206-8f34-e596717f016e', NULL::varchar,
      'd25ec158-82df-4f50-8188-cae113af5f9f', '11110000-0000-0000-0000-000000000201',
      ARRAY['Shopping Centre'], ARRAY['Victoria Broadhead'], 54321::real, 68000::real, 249::real, 10::real, 'landlord',
      'Second viewing booked. Local test data.', now() - interval '30 days', now() - interval '2 days', NULL::timestamp, NULL::timestamp),
    ('b9a6e000-0000-4000-8000-000000000302', '304 Queen Street (RU9), Westgate — Starbucks', 'New Letting', 'HOT',
      'de222c86-d59c-42b5-842a-a545d0e7fa44', 'f51deb8d-44dc-4b8d-a1dd-772deca0aebc', NULL,
      'd25ec158-82df-4f50-8188-cae113af5f9f', '11110000-0000-0000-0000-000000000201',
      ARRAY['Shopping Centre'], ARRAY['Victoria Broadhead', 'Lucy Cox'], 54321, 142000, 1683, 10, 'landlord',
      'Heads of terms out for comment. Local test data.', now() - interval '55 days', now() - interval '5 days', NULL, NULL),
    ('b9a6e000-0000-4000-8000-000000000303', 'U127 Bluewater — Starbucks lease renewal', 'Lease Renewal', 'COM',
      'cccccccc-0000-0000-0000-000000000001', NULL, 'f019aa95-7900-4539-b4c4-22bb9b0c8827',
      'd25ec158-82df-4f50-8188-cae113af5f9f', '11110000-0000-0000-0000-000000000201',
      ARRAY['Shopping Centre'], ARRAY['Victoria Broadhead'], 54321, 210000, 2245, 10, 'landlord',
      'Renewed for ten years from September 2025. Local test data.', TIMESTAMP '2025-05-12 10:00:00', TIMESTAMP '2025-10-02 15:30:00', TIMESTAMP '2025-09-01 12:00:00', TIMESTAMP '2025-09-23 12:00:00'),
    ('b9a6e000-0000-4000-8000-000000000304', 'Unit BX10 Brent Cross — Starbucks', 'New Letting', 'SOL',
      '99999999-2222-2222-2222-222222222222', '0ef33a38-06c5-429a-99b8-f4f31d7cc3c7', NULL,
      '99999999-1111-1111-1111-111111111111', '11110000-0000-0000-0000-000000000201',
      ARRAY['Shopping Centre'], ARRAY['Lucy Cox'], 54321, 195000, 1850, 10, 'landlord',
      'Draft lease with their solicitors. Local test data.', now() - interval '80 days', now() - interval '9 days', NULL, NULL),
    ('b9a6e000-0000-4000-8000-000000000305', 'Rival Unit A, Broadgate — Starbucks', 'New Letting', 'WIT',
      '22222222-2222-2222-2222-222222222222', 'f0d5d53c-a16a-4e89-8cb8-2f7e64aee709', NULL,
      '11111111-1111-1111-1111-111111111111', '11110000-0000-0000-0000-000000000201',
      ARRAY['London Estates'], ARRAY['Victoria Broadhead'], 54321, 120000, 1400, 10, 'landlord',
      'Withdrawn: Starbucks took the unit opposite. Local test data.', now() - interval '150 days', now() - interval '70 days', NULL, NULL),
    ('b9a6e000-0000-4000-8000-000000000306', 'Brent Cross — Starbucks sublet of first floor', 'Sub-Letting', 'EXC',
      '99999999-2222-2222-2222-222222222222', NULL, NULL,
      '11110000-0000-0000-0000-000000000201', NULL,
      ARRAY['Shopping Centre'], ARRAY['Lucy Cox'], 54321, 45000, 900, 5, 'tenant',
      'Starbucks is the head tenant granting the sub-lease. Local test data.', now() - interval '95 days', now() - interval '20 days', now() - interval '20 days', NULL)
  ) AS v(id, name, deal_type, status, property_id, unit_id, tenancy_unit_id, landlord_id, tenant_id, team, internal_agent, fee, rent_pa, area, lease_length, acting, comments, created_at, updated_at, exchanged_at, completed_at)
 WHERE NOT EXISTS (SELECT 1 FROM crm_deals d WHERE d.id = v.id);

-- ── 6. Space they hold: one more tenancy, and its lease event ────────────
-- The two Bluewater tenancies already existed and are not touched. This one
-- is at Brent Cross (Hammerson), with a rent and an expiry inside 18 months.
INSERT INTO tenancy_schedule_units (id, property_id, unit_number, permitted_use, status, tenant_name, trading_name, lease_start, lease_expiry, term_years, nia_sqft, passing_rent_pa, rent_psf, comments, tenant_company_id, occupancy_status, created_at, updated_at) VALUES
  ('b9a6e000-0000-4000-8000-000000001301', '99999999-2222-2222-2222-222222222222', 'Unit BX4', 'E(b) Food and drink', 'Occupied', 'Starbucks Coffee Company (UK) Limited', 'Starbucks', DATE '2017-09-29', DATE '2027-09-28', 10, 1850, 185000, 100, 'Local test data.', '11110000-0000-0000-0000-000000000201', 'Occupied', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO leasing_schedule_units (id, property_id, unit_name, tenant_name, lease_expiry, rent_review, rent_pa, sqft, status, updates, tenancy_unit_id, tenant_company_id, created_at, updated_at) VALUES
  ('b9a6e000-0000-4000-8000-000000001201', '99999999-2222-2222-2222-222222222222', 'Unit BX4', 'Starbucks', TIMESTAMP '2027-09-28 00:00:00', TIMESTAMP '2027-01-15 00:00:00', 185000, 1850, 'Occupied', 'Local test data.', 'b9a6e000-0000-4000-8000-000000001301', '11110000-0000-0000-0000-000000000201', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ── 7. A second requirement, fully filled (the existing one has no terms) ─
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, requirement_type, size, requirement_locations, principal_contact_id, bgp_contact_user_ids, comments, requirement_date, origin, last_confirmed_at, last_confirmed_by, last_confirmed_by_name, confirmed_how, created_at, updated_at) VALUES
  ('b9a6e000-0000-4000-8000-000000000401', 'Starbucks — shopping centre kiosks and in-line units', 'Active', '11110000-0000-0000-0000-000000000201',
   ARRAY['Café'], ARRAY['Shopping Centre'], ARRAY['800 - 1,800 sq ft'], ARRAY['London', 'Kent', 'South East'],
   'b9a6e000-0000-4000-8000-000000000101', ARRAY['72715f6f-905d-40f4-bded-5275175f3e2b'],
   'Twenty shopping centre sites wanted in 2027: kiosks of 250 to 400 sq ft and in-line units up to 1,800 sq ft with outside seating. Local test data.',
   '2026-10-28', 'bgp', now() - interval '9 days', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', 'Call', now() - interval '15 days', now() - interval '9 days')
ON CONFLICT (id) DO NOTHING;

-- ── 8. Viewings on existing Letting Tracker units ────────────────────────
-- Two attended in the last 90 days, two upcoming. The Brent Cross one is at
-- a Hammerson property, so a Landsec login must not see it.
INSERT INTO unit_viewings (id, unit_id, company_id, company_name, contact_id, contact_name, owner_user_id, requirement_id, viewing_date, viewing_time, attendees, notes, outcome, status, details_confirmed_at, outcome_recorded_at, outcome_by_user_id, next_action, follow_up_date, source, created_at, updated_at) VALUES
  ('b9a6e000-0000-4000-8000-000000000501', 'cd97d434-9eb5-4d77-a98a-54862dc437c7', '11110000-0000-0000-0000-000000000201', 'Starbucks', 'b9a6e000-0000-4000-8000-000000000101', 'Sarah Whitcombe', '72715f6f-905d-40f4-bded-5275175f3e2b', 'b9a6e000-0000-4000-8000-000000000401',
   '2026-11-04', '10:30', 'Sarah Whitcombe, James Okafor, Victoria Broadhead', 'Liked the footfall on the lower mall; wants the extraction route confirmed. Local test data.', 'Second Viewing', 'completed', now() - interval '8 days', now() - interval '8 days', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Send the M&E pack and proposed terms', '2026-11-10', 'manual', now() - interval '12 days', now() - interval '8 days'),
  ('b9a6e000-0000-4000-8000-000000000502', '561a8f7e-c6ab-4db5-87fa-906370afe6f7', '11110000-0000-0000-0000-000000000201', 'Starbucks', 'b9a6e000-0000-4000-8000-000000000102', 'James Okafor', '498e3ede-c9d8-4d8d-bfd5-1afa09cd6219', 'b9a6e000-0000-4000-8000-000000000401',
   '2026-10-15', '14:00', 'James Okafor, Lucy Cox', 'Right size for an in-line store with seating outside. Local test data.', 'Offer Expected', 'completed', now() - interval '28 days', now() - interval '28 days', '498e3ede-c9d8-4d8d-bfd5-1afa09cd6219', 'Chase the written offer', '2026-11-20', 'manual', now() - interval '35 days', now() - interval '28 days'),
  ('b9a6e000-0000-4000-8000-000000000503', 'cd97d434-9eb5-4d77-a98a-54862dc437c7', '11110000-0000-0000-0000-000000000201', 'Starbucks', 'b9a6e000-0000-4000-8000-000000000101', 'Sarah Whitcombe', '72715f6f-905d-40f4-bded-5275175f3e2b', 'b9a6e000-0000-4000-8000-000000000401',
   '2026-11-18', '11:00', 'Sarah Whitcombe, Starbucks design team, Victoria Broadhead', 'Second viewing with their design team. Local test data.', NULL, 'scheduled', now() - interval '3 days', NULL, NULL, NULL, NULL, 'manual', now() - interval '3 days', now() - interval '3 days'),
  ('b9a6e000-0000-4000-8000-000000000504', '99999999-3333-3333-3333-333333333333', '11110000-0000-0000-0000-000000000201', 'Starbucks', 'b9a6e000-0000-4000-8000-000000000102', 'James Okafor', '498e3ede-c9d8-4d8d-bfd5-1afa09cd6219', NULL,
   '2026-11-26', '09:30', 'James Okafor, Lucy Cox', 'Pre-completion walk round. Local test data.', NULL, 'scheduled', now() - interval '2 days', NULL, NULL, NULL, NULL, 'manual', now() - interval '2 days', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

-- ── 9. One target row on the existing Westgate RU9 Targeting Brief ───────
-- Gives the Targeted line and the phone's Tracker updates card something.
INSERT INTO unit_target_operators (id, brief_id, operator_name, company_id, category, priority, rationale, existing_relationship, status, sort_order, agent_user_ids, comments, created_at, updated_at) VALUES
  ('b9a6e000-0000-4000-8000-000000001101', '101f22eb-048d-4ad8-95e3-7481c7ea3359', 'Starbucks', '11110000-0000-0000-0000-000000000201', 'Coffee', 'A',
   'Wants an in-line store with outside seating on this pitch.', 'Live requirement; BGP let them U127 at Bluewater.', 'Inspection Done', 10,
   ARRAY['72715f6f-905d-40f4-bded-5275175f3e2b'],
   jsonb_build_array(
     jsonb_build_object('text', 'Viewed with James Okafor. Offer expected once their board has signed off the fit-out budget.', 'userName', 'Lucy Cox', 'at', to_char((now() - interval '27 days') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
     jsonb_build_object('text', 'Chased. Written offer due by 20 November.', 'userName', 'Victoria Broadhead', 'at', to_char((now() - interval '4 days') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
   now() - interval '40 days', now() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

-- ── 10. Signals: typed ones, logged by hand (the existing 44 are news) ───
-- Dated in the last two days so they sit inside the newest twenty the page loads.
INSERT INTO brand_signals (id, brand_company_id, signal_type, headline, detail, source, signal_date, sentiment, ai_generated, geography, created_at) VALUES
  ('b9a6e000-0000-4000-8000-000000000601', '11110000-0000-0000-0000-000000000201', 'requirement', 'Starbucks briefing agents on twenty shopping centre kiosks for 2027', 'CBRE confirmed the brief on a call: kiosks of 250 to 400 sq ft on the busiest malls. Local test data.', 'Call with CBRE (tenant rep)', now() - interval '5 hours', 'positive', false, 'uk', now() - interval '5 hours'),
  ('b9a6e000-0000-4000-8000-000000000602', '11110000-0000-0000-0000-000000000201', 'opening', 'Starbucks opens drive-thru at Cribbs Causeway, Bristol', 'Franchise partner 23.5 Degrees; 1,800 sq ft pod. Local test data.', 'Agent call', now() - interval '11 hours', 'positive', false, 'uk', now() - interval '11 hours'),
  ('b9a6e000-0000-4000-8000-000000000603', '11110000-0000-0000-0000-000000000201', 'closure', 'Starbucks to close Holborn Kingsway store at lease expiry', 'Not renewing; rent review was the sticking point. Local test data.', 'Landlord agent', now() - interval '18 hours', 'negative', false, 'uk', now() - interval '18 hours'),
  ('b9a6e000-0000-4000-8000-000000000604', '11110000-0000-0000-0000-000000000201', 'hiring', 'Starbucks UK hiring two acquisitions surveyors for the South', 'Both roles report to Sarah Whitcombe. Local test data.', 'Their careers page', now() - interval '25 hours', 'positive', false, 'uk', now() - interval '25 hours'),
  ('b9a6e000-0000-4000-8000-000000000605', '11110000-0000-0000-0000-000000000201', 'exec_change', 'Sarah Whitcombe promoted to UK Property Director', 'Previously Head of Estates, North. Local test data.', 'Email from Sarah Whitcombe', now() - interval '31 hours', 'neutral', false, 'uk', now() - interval '31 hours')
ON CONFLICT (id) DO NOTHING;

-- ── 11. Correspondence (staff-only figures: last touch, email threads) ───
INSERT INTO crm_interactions (id, contact_id, company_id, type, direction, subject, preview, participants, interaction_date, bgp_user, deal_id, created_at) VALUES
  ('b9a6e000-0000-4000-8000-000000000701', 'b9a6e000-0000-4000-8000-000000000101', '11110000-0000-0000-0000-000000000201', 'email', 'inbound', 'Bluewater KL11: second viewing', 'Thanks Victoria. The 18th works for our design team. Can you send the M&E pack before then?', '["sarah.whitcombe@starbucks.example","victoria@brucegillinghampollard.com"]'::jsonb, now() - interval '3 days', 'victoria@brucegillinghampollard.com', 'b9a6e000-0000-4000-8000-000000000301', now() - interval '3 days'),
  ('b9a6e000-0000-4000-8000-000000000702', 'b9a6e000-0000-4000-8000-000000000101', '11110000-0000-0000-0000-000000000201', 'email', 'outbound', 'Bluewater KL11: proposed terms', 'Sarah, proposed terms attached for the kiosk as discussed on site.', '["sarah.whitcombe@starbucks.example","victoria@brucegillinghampollard.com","m.duffield@starbucks.com"]'::jsonb, now() - interval '7 days', 'victoria@brucegillinghampollard.com', 'b9a6e000-0000-4000-8000-000000000301', now() - interval '7 days'),
  ('b9a6e000-0000-4000-8000-000000000703', 'b9a6e000-0000-4000-8000-000000000102', '11110000-0000-0000-0000-000000000201', 'email', 'inbound', 'Westgate RU9: offer timing', 'Lucy, the board paper goes in next week. I expect to have a written offer to you by the 20th.', '["james.okafor@starbucks.example","lucy@brucegillinghampollard.com"]'::jsonb, now() - interval '14 days', 'lucy@brucegillinghampollard.com', 'b9a6e000-0000-4000-8000-000000000302', now() - interval '14 days'),
  ('b9a6e000-0000-4000-8000-000000000704', 'b9a6e000-0000-4000-8000-000000000102', '11110000-0000-0000-0000-000000000201', 'meeting', NULL, 'Brent Cross: lease comments', 'Went through the landlord''s comments on the draft lease with James and their solicitor.', '["james.okafor@starbucks.example","lucy@brucegillinghampollard.com","m.duffield@starbucks.com"]'::jsonb, now() - interval '26 days', 'lucy@brucegillinghampollard.com', 'b9a6e000-0000-4000-8000-000000000304', now() - interval '26 days'),
  ('b9a6e000-0000-4000-8000-000000000705', 'b9a6e000-0000-4000-8000-000000000103', '11110000-0000-0000-0000-000000000201', 'email', 'inbound', 'Franchise partners: South East sites', 'Victoria, 23.5 Degrees are looking for roadside sites in Kent. Happy to introduce you.', '["priya.nair@starbucks.example","victoria@brucegillinghampollard.com"]'::jsonb, now() - interval '45 days', 'victoria@brucegillinghampollard.com', NULL, now() - interval '45 days'),
  ('b9a6e000-0000-4000-8000-000000000706', 'b9a6e000-0000-4000-8000-000000000101', '11110000-0000-0000-0000-000000000201', 'call', 'outbound', '2027 requirement', 'Sarah confirmed twenty shopping centre sites for 2027 and asked for a list of available kiosks.', '["sarah.whitcombe@starbucks.example","victoria@brucegillinghampollard.com"]'::jsonb, now() - interval '9 days', 'victoria@brucegillinghampollard.com', NULL, now() - interval '9 days')
ON CONFLICT (id) DO NOTHING;

-- ── 12. CRM plan: four actions (one raised by the Landsec login) ─────────
INSERT INTO user_tasks (id, user_id, title, description, due_date, priority, status, category, linked_deal_id, created_at, completed_at, updated_at, assigned_by_user_id, assigned_by_name) VALUES
  ('b9a6e000-0000-4000-8000-000000001001', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Send the KL11 kiosk terms and M&E pack to Sarah Whitcombe', 'Before the second viewing on 18 November. Local test data.', now() + interval '3 days', 'high', 'todo', 'crm', 'b9a6e000-0000-4000-8000-000000000301', now() - interval '6 days', NULL, now() - interval '6 days', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead'),
  ('b9a6e000-0000-4000-8000-000000001002', '498e3ede-c9d8-4d8d-bfd5-1afa09cd6219', 'Chase the written offer on Westgate RU9', 'James Okafor said it would follow their board. Local test data.', now() - interval '2 days', 'medium', 'todo', 'crm', 'b9a6e000-0000-4000-8000-000000000302', now() - interval '12 days', NULL, now() - interval '12 days', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead'),
  ('b9a6e000-0000-4000-8000-000000001003', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Can BGP ask Starbucks about a second Bluewater kiosk on the lower mall?', 'Raised by Landsec. Local test data.', now() + interval '10 days', 'medium', 'todo', 'crm', NULL, now() - interval '4 days', NULL, now() - interval '4 days', '35a456f4-1a01-4a70-b59f-3aa2fc94055f', 'Mark Warne'),
  ('b9a6e000-0000-4000-8000-000000001004', '498e3ede-c9d8-4d8d-bfd5-1afa09cd6219', 'Return Brent Cross draft lease comments', 'Local test data.', now() - interval '8 days', 'medium', 'done', 'crm', 'b9a6e000-0000-4000-8000-000000000304', now() - interval '20 days', now() - interval '9 days', now() - interval '9 days', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_engagement_actions (task_id, company_id, property_id) VALUES
  ('b9a6e000-0000-4000-8000-000000001001', '11110000-0000-0000-0000-000000000201', 'cccccccc-0000-0000-0000-000000000001'),
  ('b9a6e000-0000-4000-8000-000000001002', '11110000-0000-0000-0000-000000000201', 'de222c86-d59c-42b5-842a-a545d0e7fa44'),
  ('b9a6e000-0000-4000-8000-000000001003', '11110000-0000-0000-0000-000000000201', 'cccccccc-0000-0000-0000-000000000001'),
  ('b9a6e000-0000-4000-8000-000000001004', '11110000-0000-0000-0000-000000000201', '99999999-2222-2222-2222-222222222222')
ON CONFLICT (task_id) DO NOTHING;

-- ── 13. Rent comps (space preferences are worked out from these) ─────────
INSERT INTO crm_comps (id, name, deal_type, tenant, landlord, area_sqft, headline_rent, rent_psf_overall, use_class, postcode, completion_date, comments, tenant_company_id, rent_review_pattern, created_at, updated_at) VALUES
  ('b9a6e000-0000-4000-8000-000000001401', 'Westfield Stratford City, The Street', 'New Letting', 'Starbucks', 'Unibail-Rodamco-Westfield', '1650', '165000', '100', 'E(b) Food and drink', 'E20 1EJ', '2026-03-14', 'Local test data.', '11110000-0000-0000-0000-000000000201', '5 yearly', now(), now()),
  ('b9a6e000-0000-4000-8000-000000001402', 'Canary Wharf, Jubilee Place', 'New Letting', 'Starbucks', 'Canary Wharf Group', '1200', '138000', '115', 'E(b) Food and drink', 'E14 5NY', '2025-11-03', 'Local test data.', '11110000-0000-0000-0000-000000000201', '5 yearly', now(), now()),
  ('b9a6e000-0000-4000-8000-000000001403', 'The Oracle, Reading', 'Lease Renewal', 'Starbucks', 'Hammerson', '2100', '147000', '70', 'E(b) Food and drink', 'RG1 2AG', '2025-06-20', 'Local test data.', '11110000-0000-0000-0000-000000000201', '5 yearly', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ── 14. News: four stories that are not under Signals ────────────────────
INSERT INTO news_articles (id, source_name, title, summary, url, published_at, fetched_at, category, processed, og_image_tried) VALUES
  ('b9a6e000-0000-4000-8000-000000000821', 'Retail Property Wire', 'Starbucks signs for drive-thru at Milton Keynes retail park', 'Starbucks has exchanged on a 1,800 sq ft drive-thru pod at Grafton Gate, Milton Keynes, due to open in spring 2027.', 'https://news.example/starbucks-milton-keynes-drive-thru', now() - interval '4 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000822', 'Shopping Centre Review', 'Starbucks UK trials smaller kiosk format in shopping centres', 'Starbucks UK is testing a 300 sq ft kiosk on busy malls, starting in Kent and Essex, ahead of a wider roll-out.', 'https://news.example/starbucks-uk-kiosk-trial', now() - interval '13 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000823', 'High Street Journal', 'Starbucks to refurbish forty UK high street stores in 2027', 'Starbucks UK will refit forty high street coffee shops next year, with London, Manchester and Edinburgh first.', 'https://news.example/starbucks-uk-refurbishment-2027', now() - interval '24 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000824', 'Franchise Business UK', 'Starbucks franchise partner 23.5 Degrees plans ten South West openings', 'Starbucks UK franchisee 23.5 Degrees says it will open ten drive-thru coffee shops across Bristol, Devon and Cornwall.', 'https://news.example/starbucks-23-5-degrees-south-west', now() - interval '38 days', now(), 'general', true, true)
ON CONFLICT (id) DO NOTHING;

-- ── 15. Social tabs: two connected channels with items ───────────────────
-- No feed_url, so the news fetcher skips these sources (nothing is fetched).
INSERT INTO news_sources (id, name, url, feed_url, type, category, active, last_fetched_at) VALUES
  ('b9a6e000-0000-4000-8000-000000000801', 'Starbucks (Website news)', 'https://stories.starbucks.com/emea/', NULL, 'rssapp_web_news', 'brand:11110000-0000-0000-0000-000000000201', true, now()),
  ('b9a6e000-0000-4000-8000-000000000802', 'Starbucks (LinkedIn)', 'https://www.linkedin.com/company/starbucks/', NULL, 'rssapp_linkedin', 'brand:11110000-0000-0000-0000-000000000201', true, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO news_articles (id, source_id, source_name, title, summary, url, published_at, fetched_at, category, processed, og_image_tried) VALUES
  ('b9a6e000-0000-4000-8000-000000000811', 'b9a6e000-0000-4000-8000-000000000801', 'Starbucks (Website news)', 'Winter menu arrives in UK stores with a new Gingerbread Oat Latte', 'The winter range is in all UK stores from this week.', 'https://news.example/starbucks/stories/winter-menu-2026', now() - interval '6 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000812', 'b9a6e000-0000-4000-8000-000000000801', 'Starbucks (Website news)', 'Our plan to open 500 UK coffee shops by 2031', 'Drive-thru, roadside and travel sites lead the plan, with new kiosks in shopping centres.', 'https://news.example/starbucks/stories/uk-growth-plan', now() - interval '3 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000813', 'b9a6e000-0000-4000-8000-000000000801', 'Starbucks (Website news)', 'Starbucks Reserve opens at Battersea Power Station', 'The third Reserve store in London opened in Turbine Hall A.', 'https://news.example/starbucks/stories/reserve-battersea', now() - interval '33 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000814', 'b9a6e000-0000-4000-8000-000000000802', 'Starbucks (LinkedIn)', 'We are hiring: Acquisitions Surveyor, South of England', 'Join the UK property team finding our next hundred sites.', 'https://news.example/starbucks/linkedin/acquisitions-surveyor', now() - interval '2 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000815', 'b9a6e000-0000-4000-8000-000000000802', 'Starbucks (LinkedIn)', 'Congratulations to Sarah Whitcombe, our new UK Property Director', 'Sarah has led our northern estate since 2022.', 'https://news.example/starbucks/linkedin/uk-property-director', now() - interval '10 days', now(), 'general', true, true),
  ('b9a6e000-0000-4000-8000-000000000816', 'b9a6e000-0000-4000-8000-000000000802', 'Starbucks (LinkedIn)', 'Meet our franchise partners at the Completely Retail Marketplace', 'Find us on stand 42 to talk about roadside and retail park sites.', 'https://news.example/starbucks/linkedin/crmp-2026', now() - interval '29 days', now(), 'general', true, true)
ON CONFLICT (id) DO NOTHING;

-- ── 16. Covenant grade (a stored report; nothing is fetched) ─────────────
INSERT INTO covenant_reports (company_number, company_name, score, grade, report, computed_at) VALUES (
  '02959325', 'STARBUCKS COFFEE COMPANY (UK) LIMITED', 74, 'B',
  jsonb_build_object(
    'companyNumber', '02959325',
    'companyName', 'STARBUCKS COFFEE COMPANY (UK) LIMITED',
    'status', 'active',
    'score', 74,
    'grade', 'B',
    'flags', jsonb_build_array(
      jsonb_build_object('label', 'Subsidiary of a listed parent', 'level', 'info', 'detail', 'Ultimate parent Starbucks Corporation, Nasdaq: SBUX'),
      jsonb_build_object('label', 'Loss-making in the latest filed year', 'level', 'amber', 'detail', 'Operating loss reported for the year to September 2025'),
      jsonb_build_object('label', 'No outstanding charges', 'level', 'info', 'detail', 'Companies House charges register')),
    'signals', jsonb_build_object(
      'status', 'active', 'market', NULL, 'accounts', NULL, 'ageYears', 32,
      'directorRisk', jsonb_build_object('historyChecked', 2, 'activeDirectors', 2, 'possibleDisqualified', jsonb_build_array(), 'directorsWithInsolventCompanies', jsonb_build_array()),
      'newCharges12m', 0, 'gazetteChecked', true, 'gazetteNotices', jsonb_build_array(), 'accountsOverdue', false,
      'insolvencyCases', 0, 'nextAccountsDue', '2027-06-30', 'resignations12m', 0, 'paymentPractices', NULL,
      'auditorDepartures', 0, 'outstandingCharges', 0),
    'verdict', 'Starbucks Coffee Company (UK) Limited is a sound covenant on the strength of its parent: it is the UK operating subsidiary of a Nasdaq-listed group, has traded for more than thirty years, files on time and has no charges, insolvency history or Gazette notices. Against that, the UK company itself reported an operating loss in its latest filed year, so a landlord relying on this entity alone should ask for a parent company guarantee on larger commitments. Local test data, not a real assessment.',
    'missing', jsonb_build_array(),
    'ccjCheckUrl', 'https://www.trustonline.org.uk/search-yourself/',
    'computedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  now())
ON CONFLICT (company_number) DO NOTHING;

-- ── 17. Follower counts (only when the app has created its table) ────────
DO $$
BEGIN
  IF to_regclass('public.brand_social_stats') IS NOT NULL THEN
    INSERT INTO brand_social_stats (id, brand_company_id, platform, handle, followers, following, posts, fetched_at) VALUES
      ('b9a6e000-0000-4000-8000-000000000901', '11110000-0000-0000-0000-000000000201', 'instagram', 'starbucksuk', 512000, 310, 3890, now()),
      ('b9a6e000-0000-4000-8000-000000000902', '11110000-0000-0000-0000-000000000201', 'tiktok', 'starbucksuk', 318000, 42, 640, now())
    ON CONFLICT (id) DO NOTHING;
  ELSE
    RAISE NOTICE 'brand_social_stats does not exist: follower counts skipped';
  END IF;
END $$;

COMMIT;
