-- Brand CRM demo data for the LOCAL test database (bgpsmoke) only.
-- Safe to run again: every insert has a fixed id and ON CONFLICT DO NOTHING,
-- and the one UPDATE only fills a column that is NULL.
-- Every row it makes has an id starting bc000000-0000-4000-8000-.
-- To remove it all: run unseed.sql in this folder.
--
-- Fixture ids used (looked up, not created here):
--   Landsec                         d25ec158-82df-4f50-8188-cae113af5f9f
--   Starbucks                       11110000-0000-0000-0000-000000000201
--   Bluewater Shopping Centre       cccccccc-0000-0000-0000-000000000001
--   Westgate Test Centre            de222c86-d59c-42b5-842a-a545d0e7fa44
--   Brent Cross (Hammerson)         99999999-2222-2222-2222-222222222222
--   Victoria Broadhead (staff)      72715f6f-905d-40f4-bded-5275175f3e2b
--   Alex Todd (staff)               5e65e570-da43-43f2-b610-b8f52c20c4d3
--   Mark Warne (full Landsec login) 35a456f4-1a01-4a70-b59f-3aa2fc94055f
BEGIN;

-- 1. The demo brands, each in a category inside the Landsec client slice.
INSERT INTO crm_companies (id, name, company_type, domain, domain_url, website, description, bgp_contact_user_ids) VALUES
  ('bc000000-0000-4000-8000-000000000001', 'Jersey Mike''s',    'Tenant - Quick Service', 'jerseymikes.co.uk',  'https://jerseymikes.co.uk',  'https://jerseymikes.co.uk',  'US sub sandwich chain opening its first UK shops. Demo brand (local test data).', ARRAY['72715f6f-905d-40f4-bded-5275175f3e2b']),
  ('bc000000-0000-4000-8000-000000000002', 'Wingstop',          'Tenant - Quick Service', 'wingstop.co.uk',     'https://wingstop.co.uk',     'https://wingstop.co.uk',     'Chicken wing restaurants, UK roll-out. Demo brand (local test data).',            ARRAY['72715f6f-905d-40f4-bded-5275175f3e2b']),
  ('bc000000-0000-4000-8000-000000000003', 'Flat Iron',         'Tenant - Casual Dining', 'flatironsteak.co.uk','https://flatironsteak.co.uk','https://flatironsteak.co.uk','Steak restaurants. Demo brand (local test data).',                                ARRAY['5e65e570-da43-43f2-b610-b8f52c20c4d3']),
  ('bc000000-0000-4000-8000-000000000004', 'Yo Chi',            'Tenant - Café',          'yochi.co.uk',        'https://yochi.co.uk',        'https://yochi.co.uk',        'Self-serve frozen yoghurt. Demo brand (local test data).',                        NULL),
  ('bc000000-0000-4000-8000-000000000005', 'Blank Street',      'Tenant - Café',          'blankstreet.com',    'https://blankstreet.com',    'https://blankstreet.com',    'Coffee shops in small footprints. Demo brand (local test data).',                 NULL),
  ('bc000000-0000-4000-8000-000000000006', 'The Light Cinema',  'Tenant - Cinema',        'thelight.co.uk',     'https://thelight.co.uk',     'https://thelight.co.uk',     'Cinema and leisure venues. Demo brand (local test data).',                        NULL)
ON CONFLICT DO NOTHING;

-- 2. Leasing requirements: a fit, a size miss, a place miss, and one BGP holds itself.
INSERT INTO crm_requirements_leasing (id, name, status, company_id, use, requirement_type, size, requirement_locations, sources, comments, created_at, updated_at) VALUES
  -- Wingstop: fits L022 Bluewater (2,264 sq ft) and RU9 Westgate (1,683 sq ft). PIPnet, so Landsec may read the detail.
  ('bc000000-0000-4000-8000-000000000601', 'Wingstop — UK roll-out', 'Active', 'bc000000-0000-4000-8000-000000000002',
     ARRAY['Restaurant'], ARRAY['Shopping Centre'], ARRAY['2,000 - 3,500 sq ft'], ARRAY['South East', 'London'], ARRAY['PIPnet'], 'Demo requirement (local test data).', now() - interval '20 days', now() - interval '20 days'),
  -- Jersey Mike's: held by BGP (no source), so a Landsec login gets the chip but not the detail.
  ('bc000000-0000-4000-8000-000000000602', 'Jersey Mike''s — first UK shopping centre sites', 'Active', 'bc000000-0000-4000-8000-000000000001',
     ARRAY['Restaurant'], ARRAY['Shopping Centre'], ARRAY['1,000 - 2,000 sq ft'], ARRAY['National'], NULL, 'Demo requirement (local test data).', now() - interval '9 days', now() - interval '9 days'),
  -- Yo Chi: the place fits but KL13 Bluewater (276 sq ft) is under the range: a size miss.
  ('bc000000-0000-4000-8000-000000000603', 'Yo Chi — mall units', 'Active', 'bc000000-0000-4000-8000-000000000004',
     ARRAY['A1 Food'], ARRAY['Shopping Centre'], ARRAY['500 - 1,000 sq ft'], ARRAY['South East', 'London'], ARRAY['PIPnet'], 'Demo requirement (local test data).', now() - interval '40 days', now() - interval '40 days'),
  -- Flat Iron: London only, so Bluewater is not on their list: a place miss.
  ('bc000000-0000-4000-8000-000000000604', 'Flat Iron — central London', 'Active', 'bc000000-0000-4000-8000-000000000003',
     ARRAY['Restaurant'], ARRAY['High street'], ARRAY['3,500 - 5,000 sq ft'], ARRAY['London'], ARRAY['PIPnet'], 'Demo requirement (local test data).', now() - interval '60 days', now() - interval '60 days')
ON CONFLICT DO NOTHING;

-- 3. Wanted lines (brand_scheme_targets). Never a deal.
INSERT INTO brand_scheme_targets (id, company_id, property_id, tenancy_unit_id, unit_label, note, requirement_id, visible_to_client, ruled_out_at, ruled_out_reason, created_by, created_by_name, created_at, updated_at) VALUES
  -- Jersey Mike's, Westgate, no unit yet, shown to Landsec, pinned to their requirement  -> Wanted
  ('bc000000-0000-4000-8000-000000000101', 'bc000000-0000-4000-8000-000000000001', 'de222c86-d59c-42b5-842a-a545d0e7fa44', NULL, NULL,
     'BGP note: they want to see one shop trading before a second centre.', 'bc000000-0000-4000-8000-000000000602', true, NULL, NULL,
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '6 days', now() - interval '6 days'),
  -- Jersey Mike's, Bluewater, the Leon unit (L012A/L012B, 1,732 sq ft), shown to Landsec  -> Unit identified
  ('bc000000-0000-4000-8000-000000000102', 'bc000000-0000-4000-8000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2722204d-db69-49d3-9563-b012bb96a7c3', NULL,
     'BGP note: Leon is in administration, unit likely back early 2027.', NULL, true, NULL, NULL,
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '4 days', now() - interval '4 days'),
  -- Jersey Mike's, Bluewater, a unit named in words, NOT shown to Landsec  -> staff only
  ('bc000000-0000-4000-8000-000000000103', 'bc000000-0000-4000-8000-000000000001', 'cccccccc-0000-0000-0000-000000000001', NULL, 'Plaza kiosk (not on the schedule)',
     'BGP note: fallback only, not raised with Landsec.', NULL, false, NULL, NULL,
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '3 days', now() - interval '3 days'),
  -- Starbucks, Westgate, no unit, NOT shown to Landsec  -> Wanted, staff only
  ('bc000000-0000-4000-8000-000000000104', '11110000-0000-0000-0000-000000000201', 'de222c86-d59c-42b5-842a-a545d0e7fa44', NULL, NULL,
     'BGP note: second store idea, not raised with Landsec yet.', NULL, false, NULL, NULL,
     '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Alex Todd', now() - interval '12 days', now() - interval '12 days'),
  -- Blank Street, Westgate, no unit, shown to Landsec  -> Wanted
  ('bc000000-0000-4000-8000-000000000105', 'bc000000-0000-4000-8000-000000000005', 'de222c86-d59c-42b5-842a-a545d0e7fa44', NULL, NULL,
     NULL, NULL, true, NULL, NULL,
     '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Alex Todd', now() - interval '8 days', now() - interval '8 days'),
  -- Yo Chi, Westgate, ruled out with a reason, shown to Landsec  -> Not proceeding
  ('bc000000-0000-4000-8000-000000000106', 'bc000000-0000-4000-8000-000000000004', 'de222c86-d59c-42b5-842a-a545d0e7fa44', NULL, NULL,
     NULL, NULL, true, now() - interval '9 days', 'Centre already has two dessert kiosks',
     '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Alex Todd', now() - interval '30 days', now() - interval '9 days'),
  -- ANOTHER LANDLORD: Wingstop at Brent Cross (Hammerson). Ticked "show to client" on purpose: it must still never reach Landsec.
  ('bc000000-0000-4000-8000-000000000107', 'bc000000-0000-4000-8000-000000000002', '99999999-2222-2222-2222-222222222222', NULL, 'Unit BX10',
     'BGP note: Hammerson target, nothing to do with Landsec.', NULL, true, NULL, NULL,
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '5 days', now() - interval '5 days')
ON CONFLICT DO NOTHING;

-- 4. Targeting Briefs on three Bluewater tracker units (none had one), then targets on them.
INSERT INTO unit_briefs (id, unit_id, property_id, client_company, client_company_id, title, objective, status, created_by_user_id, created_by_name, created_at, updated_at, version) VALUES
  ('bc000000-0000-4000-8000-000000000201', 'cc17514a-a1e3-43e7-8875-f8e1cc89d7b3', 'cccccccc-0000-0000-0000-000000000001', 'Landsec', 'd25ec158-82df-4f50-8188-cae113af5f9f',
     'WVL15 & External Seating Area, Bluewater', 'Demo brief (local test data): a destination restaurant for the lower west village.', 'Active', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '50 days', now() - interval '50 days', 1),
  ('bc000000-0000-4000-8000-000000000202', 'c4452aca-fa22-42b6-8c00-43a604ab46f6', 'cccccccc-0000-0000-0000-000000000001', 'Landsec', 'd25ec158-82df-4f50-8188-cae113af5f9f',
     'KL13, Bluewater', 'Demo brief (local test data): a dessert or drinks kiosk.', 'Active', '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Alex Todd', now() - interval '70 days', now() - interval '70 days', 1),
  ('bc000000-0000-4000-8000-000000000203', '531067d9-50e1-4f22-9343-298e66b02f11', 'cccccccc-0000-0000-0000-000000000001', 'Landsec', 'd25ec158-82df-4f50-8188-cae113af5f9f',
     'MSU6, Bluewater', 'Demo brief (local test data): a leisure anchor for the whole demise.', 'Active', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '120 days', now() - interval '120 days', 1)
ON CONFLICT DO NOTHING;

INSERT INTO unit_target_operators (id, brief_id, operator_name, company_id, category, priority, rationale, existing_relationship, status, sort_order, agent_user_ids, created_at, updated_at) VALUES
  -- Flat Iron, WVL15 Bluewater  -> HOTs
  ('bc000000-0000-4000-8000-000000000211', 'bc000000-0000-4000-8000-000000000201', 'Flat Iron', 'bc000000-0000-4000-8000-000000000003', 'Casual Dining', 'A',
     'BGP rationale: strongest covenant of the three bidders.', 'BGP relationship: Alex knows the property director.', 'Heads of Terms', 0, ARRAY['5e65e570-da43-43f2-b610-b8f52c20c4d3'], now() - interval '45 days', now() - interval '6 days'),
  -- Yo Chi, KL13 Bluewater  -> Solicitors
  ('bc000000-0000-4000-8000-000000000212', 'bc000000-0000-4000-8000-000000000202', 'Yo Chi', 'bc000000-0000-4000-8000-000000000004', 'Café', 'A',
     'BGP rationale: kiosk trade suits the footfall line.', NULL, 'In Sols', 0, ARRAY['5e65e570-da43-43f2-b610-b8f52c20c4d3'], now() - interval '65 days', now() - interval '14 days'),
  -- The Light Cinema, MSU6 Bluewater  -> Let
  ('bc000000-0000-4000-8000-000000000213', 'bc000000-0000-4000-8000-000000000203', 'The Light Cinema', 'bc000000-0000-4000-8000-000000000006', 'Cinema', 'A',
     'BGP rationale: only leisure operator able to take the whole demise.', NULL, 'Let', 0, ARRAY['72715f6f-905d-40f4-bded-5275175f3e2b'], now() - interval '110 days', now() - interval '21 days'),
  -- Jersey Mike's on the EXISTING Westgate RU9 brief (101f22eb...)  -> Unit identified. An early target, not a deal.
  ('bc000000-0000-4000-8000-000000000214', '101f22eb-048d-4ad8-95e3-7481c7ea3359', 'Jersey Mike''s', 'bc000000-0000-4000-8000-000000000001', 'Quick Service', 'A',
     'BGP rationale: just starting to show interest; first conversation only.', 'BGP relationship: introduced through their UK franchise partner.', 'Identified', 5, ARRAY['72715f6f-905d-40f4-bded-5275175f3e2b'], now() - interval '2 days', now() - interval '2 days')
ON CONFLICT DO NOTHING;

-- 5. Viewings: one booked, two completed (one with a follow-up due this week).
INSERT INTO unit_viewings (id, unit_id, company_name, contact_name, company_id, viewing_date, viewing_time, notes, outcome, source, owner_user_id, requirement_id, status, next_action, follow_up_date, created_at, updated_at) VALUES
  -- Wingstop, Westgate RU9, booked  -> Approached. The contact name must never reach a joint agent.
  ('bc000000-0000-4000-8000-000000000301', '561a8f7e-c6ab-4db5-87fa-906370afe6f7', 'Wingstop', 'QA Contact (Wingstop property team)', 'bc000000-0000-4000-8000-000000000002',
     to_char(current_date + 5, 'YYYY-MM-DD'), '11:00', 'BGP note: bring the extraction drawings.', NULL, 'manual', '72715f6f-905d-40f4-bded-5275175f3e2b', 'bc000000-0000-4000-8000-000000000601',
     'scheduled', NULL, NULL, now() - interval '2 days', now() - interval '2 days'),
  -- Wingstop, Bluewater L022, completed three weeks ago (an offer followed)
  ('bc000000-0000-4000-8000-000000000302', '6341f12a-3887-445e-9a90-85208a78ecad', 'Wingstop', 'QA Contact (Wingstop property team)', 'bc000000-0000-4000-8000-000000000002',
     to_char(current_date - 22, 'YYYY-MM-DD'), '10:00', NULL, 'Liked the frontage; offer to follow.', 'manual', '72715f6f-905d-40f4-bded-5275175f3e2b', NULL,
     'completed', NULL, NULL, now() - interval '25 days', now() - interval '22 days'),
  -- Flat Iron, Bluewater U014, completed last week, follow-up due tomorrow  -> Viewed
  ('bc000000-0000-4000-8000-000000000303', '9d10bf9d-8053-47a1-b75a-983746d72dbb', 'Flat Iron', 'QA Contact (Flat Iron property team)', 'bc000000-0000-4000-8000-000000000003',
     to_char(current_date - 6, 'YYYY-MM-DD'), '14:30', NULL, 'Second choice behind WVL15.', 'manual', '5e65e570-da43-43f2-b610-b8f52c20c4d3', NULL,
     'completed', 'BGP next action: send the service charge budget', to_char(current_date + 1, 'YYYY-MM-DD'), now() - interval '9 days', now() - interval '6 days'),
  -- Flat Iron, Westgate RU9, completed four days ago, nothing since  -> Viewed is the furthest stage in that grid cell
  ('bc000000-0000-4000-8000-000000000304', '561a8f7e-c6ab-4db5-87fa-906370afe6f7', 'Flat Iron', 'QA Contact (Flat Iron property team)', 'bc000000-0000-4000-8000-000000000003',
     to_char(current_date - 4, 'YYYY-MM-DD'), '09:30', NULL, 'Too small for the full format; would look again with the mezzanine.', 'manual', '5e65e570-da43-43f2-b610-b8f52c20c4d3', NULL,
     'completed', NULL, NULL, now() - interval '7 days', now() - interval '4 days')
ON CONFLICT DO NOTHING;

-- 6. Offers and their rounds. The newest round equals the offer row.
INSERT INTO unit_offers (id, unit_id, company_name, contact_name, company_id, offer_date, rent_pa, rent_free_months, term_years, break_option, status, comments, created_at, updated_at, agreed_at, agreed_by_user_id, agreed_by_name) VALUES
  -- Wingstop, Bluewater L022, two rounds, landlord countered  -> Negotiating
  ('bc000000-0000-4000-8000-000000000401', '6341f12a-3887-445e-9a90-85208a78ecad', 'Wingstop', 'QA Contact (Wingstop property team)', 'bc000000-0000-4000-8000-000000000002',
     to_char(current_date - 15, 'YYYY-MM-DD'), 95000, 6, 10, 'Tenant break at year 5', 'Negotiating', 'BGP comment: agent says they can go to £90k.', now() - interval '15 days', now() - interval '8 days', NULL, NULL, NULL),
  -- Flat Iron, Bluewater WVL15, agreed
  ('bc000000-0000-4000-8000-000000000402', 'cc17514a-a1e3-43e7-8875-f8e1cc89d7b3', 'Flat Iron', 'QA Contact (Flat Iron property team)', 'bc000000-0000-4000-8000-000000000003',
     to_char(current_date - 12, 'YYYY-MM-DD'), 210000, 9, 15, 'Tenant break at year 10', 'Agreed', NULL, now() - interval '12 days', now() - interval '6 days', now() - interval '6 days', '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Alex Todd'),
  -- Blank Street, Bluewater U069, rejected  -> Not proceeding (Landlord declined)
  ('bc000000-0000-4000-8000-000000000403', '06c2d8b7-9d2b-4ffc-ba05-cb44dc4a3139', 'Blank Street', NULL, 'bc000000-0000-4000-8000-000000000005',
     to_char(current_date - 33, 'YYYY-MM-DD'), 38000, 12, 5, NULL, 'Rejected', 'BGP comment: rent well under the floor.', now() - interval '33 days', now() - interval '28 days', NULL, NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO unit_offer_rounds (id, offer_id, unit_id, round_no, party, round_date, rent_pa, rent_free_months, term_years, break_option, note, created_by_user_id, created_by_name, created_at) VALUES
  ('bc000000-0000-4000-8000-000000000411', 'bc000000-0000-4000-8000-000000000401', '6341f12a-3887-445e-9a90-85208a78ecad', 1, 'tenant',   to_char(current_date - 15, 'YYYY-MM-DD'), 82000, 9, 10, 'Tenant break at year 5', 'Opening offer', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '15 days'),
  ('bc000000-0000-4000-8000-000000000412', 'bc000000-0000-4000-8000-000000000401', '6341f12a-3887-445e-9a90-85208a78ecad', 2, 'landlord', to_char(current_date - 8,  'YYYY-MM-DD'), 95000, 6, 10, 'Tenant break at year 5', 'Landlord counter', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '8 days'),
  ('bc000000-0000-4000-8000-000000000413', 'bc000000-0000-4000-8000-000000000402', 'cc17514a-a1e3-43e7-8875-f8e1cc89d7b3', 1, 'tenant',   to_char(current_date - 12, 'YYYY-MM-DD'), 210000, 9, 15, 'Tenant break at year 10', 'Offer as agreed', '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Alex Todd', now() - interval '12 days'),
  ('bc000000-0000-4000-8000-000000000414', 'bc000000-0000-4000-8000-000000000403', '06c2d8b7-9d2b-4ffc-ba05-cb44dc4a3139', 1, 'tenant',   to_char(current_date - 33, 'YYYY-MM-DD'), 38000, 12, 5, NULL, 'Opening offer', '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Alex Todd', now() - interval '33 days')
ON CONFLICT DO NOTHING;

-- 7. Interest logged: Blank Street, Bluewater U052B  -> Approached
INSERT INTO unit_interest (id, unit_id, company_name, company_id, interest_date, notes, source, created_at) VALUES
  ('bc000000-0000-4000-8000-000000000501', '13f4d35e-5679-4376-bcb3-ffc784b773d2', 'Blank Street', 'bc000000-0000-4000-8000-000000000005',
     to_char(current_date - 10, 'YYYY-MM-DD'), 'BGP note: asked for the kiosk pack after the U069 offer was turned down.', 'manual', now() - interval '10 days')
ON CONFLICT DO NOTHING;

-- 8. Trading: the two Bluewater tenancy rows already named "Starbucks Coffee Company (UK) Ltd"
--    are linked to the Starbucks brand record. The only UPDATE here; it fills a NULL and nothing else.
UPDATE tenancy_schedule_units SET tenant_company_id = '11110000-0000-0000-0000-000000000201'
 WHERE id IN ('f019aa95-7900-4539-b4c4-22bb9b0c8827', '9d8a2789-f21e-459b-9e9a-9e0ca860a48f') AND tenant_company_id IS NULL;

-- 9. Brand CRM actions: a task plus its link, as server/crm-engagement.ts writes them (category 'crm').
INSERT INTO user_tasks (id, user_id, title, description, due_date, status, category, assigned_by_user_id, assigned_by_name, created_at, updated_at) VALUES
  -- Overdue; pinned to Bluewater and unit L022; not shared
  ('bc000000-0000-4000-8000-000000000701', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Chase Wingstop''s agent on the counter-offer for L022',
     'BGP NOTE (must never reach a client): landlord countered at £95k, agent hinted at £90k.', (current_date - 3) + time '12:00', 'todo', 'crm',
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '8 days', now() - interval '8 days'),
  -- Due this week (Friday, or today at a weekend); no place; not shared
  ('bc000000-0000-4000-8000-000000000702', '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Send Flat Iron the Bluewater dining turnover figures',
     'BGP NOTE (must never reach a client): use the 2025 figures only.', GREATEST(current_date, date_trunc('week', current_date)::date + 4) + time '12:00', 'todo', 'crm',
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '2 days', now() - interval '2 days'),
  -- SHARED with Landsec; pinned to Bluewater (scheme only)
  ('bc000000-0000-4000-8000-000000000703', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Walk Jersey Mike''s round the Bluewater food court units',
     'BGP NOTE (must never reach a client): they are also looking at Lakeside.', (current_date + 6) + time '12:00', 'todo', 'crm',
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '3 days', now() - interval '3 days'),
  -- WAITING ON Landsec asset manager; pinned to Bluewater and unit KL13; not shared
  ('bc000000-0000-4000-8000-000000000704', '5e65e570-da43-43f2-b610-b8f52c20c4d3', 'Kiosk fit-out spec for Yo Chi at KL13',
     'BGP NOTE (must never reach a client): chase if nothing by the 20th.', (current_date + 8) + time '12:00', 'in_progress', 'crm',
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '7 days', now() - interval '7 days'),
  -- SHARED with Landsec; pinned to Westgate and unit RU9 (the joint agent's scheme)
  ('bc000000-0000-4000-8000-000000000705', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Send Jersey Mike''s the RU9 plans and service charge budget',
     'BGP NOTE (must never reach a client): early days, do not oversell.', (current_date + 5) + time '12:00', 'todo', 'crm',
     '72715f6f-905d-40f4-bded-5275175f3e2b', 'Victoria Broadhead', now() - interval '2 days', now() - interval '2 days'),
  -- RAISED BY THE LANDSEC LOGIN (Mark Warne) for a BGP owner
  ('bc000000-0000-4000-8000-000000000706', '72715f6f-905d-40f4-bded-5275175f3e2b', 'Can BGP sound out Blank Street for the Bluewater upper mall kiosks?',
     'From Mark Warne: we would back a short lease to get them in.', (current_date + 7) + time '12:00', 'todo', 'crm',
     '35a456f4-1a01-4a70-b59f-3aa2fc94055f', 'Mark Warne', now() - interval '1 day', now() - interval '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO crm_engagement_actions (task_id, company_id, property_id, tenancy_unit_id, shared_with_company_id, waiting_on_party, waiting_since) VALUES
  ('bc000000-0000-4000-8000-000000000701', 'bc000000-0000-4000-8000-000000000002', 'cccccccc-0000-0000-0000-000000000001', '73f6b76f-0f33-4cb4-be71-1020217ad5a8', NULL, NULL, NULL),
  ('bc000000-0000-4000-8000-000000000702', 'bc000000-0000-4000-8000-000000000003', NULL, NULL, NULL, NULL, NULL),
  ('bc000000-0000-4000-8000-000000000703', 'bc000000-0000-4000-8000-000000000001', 'cccccccc-0000-0000-0000-000000000001', NULL, 'd25ec158-82df-4f50-8188-cae113af5f9f', NULL, NULL),
  ('bc000000-0000-4000-8000-000000000704', 'bc000000-0000-4000-8000-000000000004', 'cccccccc-0000-0000-0000-000000000001', '065c2a65-d375-4c1d-8b19-b4f742f7d245', NULL, 'Landsec asset manager', now() - interval '7 days'),
  ('bc000000-0000-4000-8000-000000000705', 'bc000000-0000-4000-8000-000000000001', 'de222c86-d59c-42b5-842a-a545d0e7fa44', '55da4bbc-2788-4bec-a73b-1c15f7216831', 'd25ec158-82df-4f50-8188-cae113af5f9f', NULL, NULL),
  ('bc000000-0000-4000-8000-000000000706', 'bc000000-0000-4000-8000-000000000005', NULL, NULL, NULL, NULL, NULL)
ON CONFLICT DO NOTHING;

COMMIT;
