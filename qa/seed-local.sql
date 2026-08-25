-- QA seed data for local BGP database.
-- Idempotent: every row has an explicit qa- id and ON CONFLICT DO NOTHING.
-- Names carry a "(QA)" suffix so fixtures are obvious in the UI.
-- Existing fixtures (qa-deal-1, qa-prop-1, qa-brand-1, qa-landlord-1,
-- qa-exp-1..3) are left untouched; this file extends around them.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. crm_companies — 12 tracked tenant brands, 2 landlords, 2 agents, 1 lender
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO crm_companies (id, name, company_type, is_tracked_brand, store_count, instagram_handle, domain, description) VALUES
  ('qa-brand-2',  'Franco''s Coffee (QA)',        'Tenant - Café',           true, 14, 'francoscoffee.qa', 'francoscoffee.example', 'Independent speciality coffee roaster expanding across the South East.'),
  ('qa-brand-3',  'Butter & Crumb (QA)',          'Tenant - Bakery',         true, 6,  NULL, NULL, 'Artisan bakery and patisserie, strong weekend trade.'),
  ('qa-brand-4',  'Sakura Ramen Kitchen (QA)',    'Tenant - Restaurant',     true, 8,  'sakuraramen.qa', 'sakuraramen.example', 'Fast-casual ramen concept, targeting shopping centre food courts.'),
  ('qa-brand-5',  'The Copper Grill (QA)',        'Tenant - Casual Dining',  true, NULL, NULL, NULL, 'Premium casual steakhouse, 3,500-5,000 sq ft requirement.'),
  ('qa-brand-6',  'Velo Athletic (QA)',           'Tenant - Athleisure',     true, 11, NULL, 'veloathletic.example', 'Cycling-inspired athleisure brand, flagship-led rollout.'),
  ('qa-brand-7',  'Harlow & Finch (QA)',          'Tenant - Fashion',        true, NULL, NULL, NULL, 'Contemporary womenswear, department store concessions plus solus stores.'),
  ('qa-brand-8',  'Marlow Grocer (QA)',           'Tenant - Grocery',        true, 22, NULL, NULL, 'Premium convenience grocer, 2,000-4,000 sq ft high street units.'),
  ('qa-brand-9',  'Pulse Fitness Studios (QA)',   'Tenant - Gym',            true, 9,  'pulsefitness.qa', NULL, 'Boutique HIIT studio operator, basement and first-floor space.'),
  ('qa-brand-10', 'Zenith Climbing (QA)',         'Tenant - Leisure',        true, 4,  NULL, NULL, 'Bouldering and climbing centres, 15,000+ sq ft big-box leisure.'),
  ('qa-brand-11', 'Orbit Mini Golf (QA)',         'Tenant - Experiential',   true, 5,  NULL, NULL, 'Competitive socialising mini golf with F&B, city centre units.'),
  ('qa-brand-12', 'Bloom Beauty Rooms (QA)',      'Tenant - Beauty',         true, NULL, NULL, NULL, 'Beauty services and retail hybrid, 1,000-1,500 sq ft.'),
  ('qa-brand-13', 'Quill & Marble (QA)',          'Tenant - Books & Stationery', true, 7, NULL, NULL, 'Design-led stationery and gifting, strong Christmas trade.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_companies (id, name, company_type, description) VALUES
  ('qa-landlord-2', 'Westgate Centre Estates (QA)',  'Landlord', 'Institutional landlord — owns Westgate Centre (QA).'),
  ('qa-landlord-3', 'Northbank Property Group (QA)', 'Landlord', 'Private prop co — owns Northbank Quarter (QA).'),
  ('qa-agent-1',    'Corbett & Vale (QA)',           'Agent',    'Retail leasing agency, national coverage.'),
  ('qa-agent-2',    'Ashworth Retail Advisors (QA)', 'Agent',    'Boutique retail and leisure advisory.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_companies (id, name, company_type, description, lending_active, lender_type,
  typical_loan_size_min_m, typical_loan_size_max_m, typical_ltv_max, typical_margin_bps,
  typical_loan_term, preferred_asset_classes, preferred_geographies) VALUES
  ('qa-lender-1', 'Albion Clearing Bank (QA)', 'Clearing Bank', 'UK clearing bank, active senior lender on retail and mixed use.',
   true, 'Senior', 5, 75, 60, 250, '5 years', ARRAY['Retail','Mixed Use','Office'], ARRAY['UK'])
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2. crm_contacts — 2 per company across 9 companies
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO crm_contacts (id, name, role, company_id, company_name, email, phone, contact_type) VALUES
  ('qa-contact-1',  'Franco Delgado (QA)',   'Founder',                'qa-brand-2',    'Franco''s Coffee (QA)',        'franco@francoscoffee.example',   '+44 20 7946 0101', 'Restaurant'),
  ('qa-contact-2',  'Maya Osei (QA)',        'Head of Property',       'qa-brand-2',    'Franco''s Coffee (QA)',        'maya@francoscoffee.example',     '+44 20 7946 0102', 'Restaurant'),
  ('qa-contact-3',  'Tom Whitcombe (QA)',    'Acquisitions Manager',   'qa-brand-4',    'Sakura Ramen Kitchen (QA)',    'tom@sakuraramen.example',        '+44 20 7946 0103', 'Restaurant'),
  ('qa-contact-4',  'Aiko Tanaka (QA)',      'Managing Director',      'qa-brand-4',    'Sakura Ramen Kitchen (QA)',    'aiko@sakuraramen.example',       '+44 20 7946 0104', 'Restaurant'),
  ('qa-contact-5',  'Priya Nair (QA)',       'Property Director',      'qa-brand-6',    'Velo Athletic (QA)',           'priya@veloathletic.example',     '+44 20 7946 0105', 'Retailer'),
  ('qa-contact-6',  'Josh Templar (QA)',     'Retail Director',        'qa-brand-6',    'Velo Athletic (QA)',           'josh@veloathletic.example',      '+44 20 7946 0106', 'Retailer'),
  ('qa-contact-7',  'Elena Marchetti (QA)',  'Head of Estates',        'qa-brand-8',    'Marlow Grocer (QA)',           'elena@marlowgrocer.example',     '+44 20 7946 0107', 'Retailer'),
  ('qa-contact-8',  'Dougie Freeman (QA)',   'Acquisitions Surveyor',  'qa-brand-8',    'Marlow Grocer (QA)',           'dougie@marlowgrocer.example',    '+44 20 7946 0108', 'Retailer'),
  ('qa-contact-9',  'Sam Kowalski (QA)',     'Founder & CEO',          'qa-brand-9',    'Pulse Fitness Studios (QA)',   'sam@pulsefitness.example',       '+44 20 7946 0109', 'Retail'),
  ('qa-contact-10', 'Nina Barrett (QA)',     'Expansion Lead',         'qa-brand-9',    'Pulse Fitness Studios (QA)',   'nina@pulsefitness.example',      '+44 20 7946 0110', 'Retail'),
  ('qa-contact-11', 'Gareth Llewellyn (QA)', 'Asset Manager',          'qa-landlord-2', 'Westgate Centre Estates (QA)', 'gareth@westgateestates.example', '+44 20 7946 0111', 'Investor'),
  ('qa-contact-12', 'Sophie Danvers (QA)',   'Fund Manager',           'qa-landlord-2', 'Westgate Centre Estates (QA)', 'sophie@westgateestates.example', '+44 20 7946 0112', 'Investor'),
  ('qa-contact-13', 'Rupert Northbank (QA)', 'Managing Director',      'qa-landlord-3', 'Northbank Property Group (QA)','rupert@northbankpg.example',     '+44 20 7946 0113', 'Investor'),
  ('qa-contact-14', 'Carys Hughes (QA)',     'Asset Manager',          'qa-landlord-3', 'Northbank Property Group (QA)','carys@northbankpg.example',      '+44 20 7946 0114', 'Investor'),
  ('qa-contact-15', 'Ollie Corbett (QA)',    'Partner',                'qa-agent-1',    'Corbett & Vale (QA)',          'ollie@corbettvale.example',      '+44 20 7946 0115', 'Agent'),
  ('qa-contact-16', 'Jess Vale (QA)',        'Associate Director',     'qa-agent-1',    'Corbett & Vale (QA)',          'jess@corbettvale.example',       '+44 20 7946 0116', 'Agent'),
  ('qa-contact-17', 'Hattie Ashworth (QA)',  'Director',               'qa-agent-2',    'Ashworth Retail Advisors (QA)','hattie@ashworthra.example',      '+44 20 7946 0117', 'Agent'),
  ('qa-contact-18', 'Marcus Bly (QA)',       'Relationship Director',  'qa-lender-1',   'Albion Clearing Bank (QA)',    'marcus@albionbank.example',      '+44 20 7946 0118', 'Investor')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3. crm_properties — 4 more properties with addresses
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO crm_properties (id, name, landlord_id, status, address, postcode, asset_class, tenure, sqft, senior_lender_id) VALUES
  ('qa-prop-2', 'Westgate Centre (QA)',      'qa-landlord-2', 'Leasing Instruction',
   '{"street": "12-16 Westgate Street", "city": "Oxford", "postcode": "OX1 1PD"}', 'OX1 1PD', 'Retail',    'Freehold', 185000, 'qa-lender-1'),
  ('qa-prop-3', 'Northbank Quarter (QA)',    'qa-landlord-3', 'Leasing Instruction',
   '{"street": "1 Northbank Wharf", "city": "Leeds", "postcode": "LS1 4AP"}',      'LS1 4AP', 'Mixed Use', 'Freehold', 92000,  NULL),
  ('qa-prop-4', 'The Old Brewery Yard (QA)', 'qa-landlord-1', 'BGP Active',
   '{"street": "44 Brewery Lane", "city": "Bristol", "postcode": "BS1 6QF"}',      'BS1 6QF', 'Leisure',   'Leasehold', 38000, NULL),
  ('qa-prop-5', 'St Aldgate''s Parade (QA)', 'qa-landlord-2', 'Sales Instruction',
   '{"street": "88-102 St Aldgate''s", "city": "Guildford", "postcode": "GU1 3AJ"}', 'GU1 3AJ', 'Retail',  'Freehold', 27500,  NULL)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 4. crm_deals — 10 deals across statuses and teams
--    Status codes from shared/deal-status.ts; teams from CRM_OPTIONS.dealTeam.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO crm_deals (id, name, status, deal_type, team, property_id, landlord_id, tenant_id,
  leasing_agent_id, vendor_id, purchaser_id, vendor_agent_id, fee, fee_agreement, rent_pa, pricing,
  yield_percent, total_area_sqft, target_date, exchanged_at, completed_at, bgp_acting_for, comments) VALUES
  ('qa-deal-2',  'Westgate Unit 12 - Franco''s Coffee (QA)',   'AVA', 'New Letting', ARRAY['National Leasing'], 'qa-prop-2', 'qa-landlord-2', 'qa-brand-2',
   NULL, NULL, NULL, NULL, 12500, 'YES', 85000, NULL, NULL, 1450, '2027-02-26', NULL, NULL, 'landlord', 'Marketing launched, two viewings booked.'),
  ('qa-deal-3',  'Northbank Kiosk 3 - Butter & Crumb (QA)',    'AVA', 'New Letting', ARRAY['National Leasing'], 'qa-prop-3', 'qa-landlord-3', 'qa-brand-3',
   NULL, NULL, NULL, NULL, 2000, 'YES', 24000, NULL, NULL, 420, '2027-03-31', NULL, NULL, 'landlord', 'Kiosk letting, small fee but quick turnaround.'),
  ('qa-deal-4',  'Westgate Unit 4 - Sakura Ramen (QA)',        'NEG', 'New Letting', ARRAY['London F&B'], 'qa-prop-2', 'qa-landlord-2', 'qa-brand-4',
   'qa-agent-1', NULL, NULL, NULL, 18000, 'YES', 120000, NULL, NULL, 2800, '2026-11-30', NULL, NULL, 'landlord', 'Terms out, negotiating rent free.'),
  ('qa-deal-5',  'Old Brewery Yard - Zenith Climbing (QA)',    'NEG', 'New Letting', ARRAY['London F&B'], 'qa-prop-4', 'qa-landlord-1', 'qa-brand-10',
   NULL, NULL, NULL, NULL, 32000, 'YES', 210000, NULL, NULL, 16500, '2026-12-18', NULL, NULL, 'landlord', 'Big-box leisure letting, planning condition outstanding.'),
  ('qa-deal-6',  'Northbank Unit 8 - Pulse Fitness (QA)',      'HOT', 'New Letting', ARRAY['National Leasing'], 'qa-prop-3', 'qa-landlord-3', 'qa-brand-9',
   'qa-agent-2', NULL, NULL, NULL, 15500, 'YES', 95000, NULL, NULL, 5200, '2026-10-30', NULL, NULL, 'landlord', 'HOTs agreed, awaiting board sign-off.'),
  ('qa-deal-7',  'Westgate Unit 22 - Velo Athletic (QA)',      'SOL', 'New Letting', ARRAY['London Retail'], 'qa-prop-2', 'qa-landlord-2', 'qa-brand-6',
   NULL, NULL, NULL, NULL, 27500, 'YES', 165000, NULL, NULL, 3900, '2026-10-15', NULL, NULL, 'landlord', 'With solicitors, draft lease returned with comments.'),
  ('qa-deal-8',  'Marlow Grocer - Northbank Unit 1 (QA)',      'SOL', 'New Letting', ARRAY['National Leasing'], 'qa-prop-3', 'qa-landlord-3', 'qa-brand-8',
   NULL, NULL, NULL, NULL, 21000, 'YES', 140000, NULL, NULL, 3600, '2026-09-30', NULL, NULL, 'landlord', 'Engrossments circulating.'),
  ('qa-deal-9',  'St Aldgate''s Parade - Investment Sale (QA)','EXC', 'Sale', ARRAY['Investment'], 'qa-prop-5', NULL, NULL,
   NULL, 'qa-landlord-2', 'qa-landlord-3', 'qa-agent-1', 150000, 'YES', NULL, 12500000, 6.25, 27500, '2026-09-26', '2026-08-14', NULL, 'landlord', 'Exchanged, completion 6 weeks.'),
  ('qa-deal-10', 'Westgate Unit 9 - Quill & Marble (QA)',      'COM', 'New Letting', ARRAY['London Retail'], 'qa-prop-2', 'qa-landlord-2', 'qa-brand-13',
   NULL, NULL, NULL, NULL, 9800, 'YES', 62000, NULL, NULL, 1100, '2026-07-31', '2026-07-02', '2026-07-28', 'landlord', 'Completed, invoice raised.'),
  ('qa-deal-11', 'Old Brewery Yard - Orbit Mini Golf (QA)',    'WIT', 'New Letting', ARRAY['London F&B'], 'qa-prop-4', 'qa-landlord-1', 'qa-brand-11',
   NULL, NULL, NULL, NULL, 24000, 'NO', 155000, NULL, NULL, 12800, NULL, NULL, NULL, 'landlord', 'Withdrawn — covenant weak, landlord passed.')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 5. tenancy_schedule_units — 8 units across Westgate (QA) and Northbank (QA)
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO tenancy_schedule_units (id, property_id, unit_number, premises, status, tenant_name, trading_name,
  lease_start, lease_expiry, break_date, next_review_date, passing_rent_pa, erv_pa, gia_sqft, itza_sqft, rent_psf, sort_order) VALUES
  ('qa-tsu-1', 'qa-prop-2', 'Unit 1',  'Unit 1, Westgate Centre',  'Occupied', 'Harlow & Finch (QA)',        'Harlow & Finch',   '2019-03-25', '2029-03-24', '2026-03-25', '2027-03-25', 145000, 152000, 3200, 1850, 45.31, 1),
  ('qa-tsu-2', 'qa-prop-2', 'Unit 2',  'Unit 2, Westgate Centre',  'Occupied', 'Marlow Grocer (QA)',         'Marlow Grocer',    '2021-06-24', '2031-06-23', NULL,         '2026-06-24', 118000, 125000, 2900, 1600, 40.69, 2),
  ('qa-tsu-3', 'qa-prop-2', 'Unit 5',  'Unit 5, Westgate Centre',  'Occupied', 'Bloom Beauty Rooms (QA)',    'Bloom Beauty',     '2023-09-29', '2033-09-28', '2028-09-29', '2028-09-29', 52000,  55000,  1250, 780,  41.60, 3),
  ('qa-tsu-4', 'qa-prop-2', 'Unit 9',  'Unit 9, Westgate Centre',  'Occupied', 'Quill & Marble (QA)',        'Quill & Marble',   '2026-07-28', '2036-07-27', '2031-07-28', '2031-07-28', 62000,  62000,  1100, 690,  56.36, 4),
  ('qa-tsu-5', 'qa-prop-2', 'Unit 12', 'Unit 12, Westgate Centre', 'Vacant',   NULL,                          NULL,               NULL,         NULL,         NULL,         NULL,         NULL,   85000,  1450, 900,  NULL,  5),
  ('qa-tsu-6', 'qa-prop-3', 'Unit 1',  'Unit 1, Northbank Quarter','Occupied', 'The Copper Grill (QA)',      'The Copper Grill', '2020-12-25', '2035-12-24', '2030-12-25', '2025-12-25', 185000, 195000, 4800, NULL, 38.54, 1),
  ('qa-tsu-7', 'qa-prop-3', 'Unit 4',  'Unit 4, Northbank Quarter','Occupied', 'Franco''s Coffee (QA)',      'Franco''s Coffee', '2022-03-25', '2032-03-24', '2027-03-25', '2027-03-25', 46500,  49000,  980,  610,  47.45, 2),
  ('qa-tsu-8', 'qa-prop-3', 'Unit 8',  'Unit 8, Northbank Quarter','Vacant',   NULL,                          NULL,               NULL,         NULL,         NULL,         NULL,         NULL,   95000,  5200, NULL, NULL,  3)
ON CONFLICT (id) DO NOTHING;

-- Leasing/available units (separate table backing the leasing schedule)
INSERT INTO available_units (id, property_id, unit_name, floor, sqft, asking_rent, use_class,
  marketing_status, available_date, deal_id, tenancy_unit_id, notes) VALUES
  ('qa-avail-1', 'qa-prop-2', 'Unit 12', 'Ground', 1450, 85000, 'E',
   'Available', 'Immediate', 'qa-deal-2', 'qa-tsu-5', 'Former fashion unit, shopfitted.'),
  ('qa-avail-2', 'qa-prop-3', 'Unit 8',  'Ground & First', 5200, 95000, 'E',
   'Under Offer', 'Q4 2026',  'qa-deal-6', 'qa-tsu-8', 'Under offer to Pulse Fitness (QA).'),
  ('qa-avail-3', 'qa-prop-4', 'The Vaults', 'Basement', 16500, 210000, 'E',
   'Available', 'Immediate', 'qa-deal-5', NULL, 'Big-box leisure space, 6m clear height.')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 6. lease_events — 5 across urgency buckets (relative to Aug 2026):
--    one overdue, two due <3 months, two watching (<18 months)
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO lease_events (id, property_id, address, tenant, tenant_company_id, unit_ref, event_type,
  event_date, notice_date, current_rent, estimated_erv, sqft, status, landlord, source_evidence, notes) VALUES
  ('qa-lev-1', 'qa-prop-3', 'Unit 1, Northbank Quarter, Leeds (QA)',   'The Copper Grill (QA)',  'qa-brand-5',  'Unit 1',  'Rent Review',
   '2026-06-24', '2026-03-24', '£185,000', '£195,000', '4,800', 'Monitoring', 'Northbank Property Group (QA)', 'Manual', 'Review date passed — chase landlord for instruction.'),
  ('qa-lev-2', 'qa-prop-2', 'Unit 2, Westgate Centre, Oxford (QA)',    'Marlow Grocer (QA)',     'qa-brand-8',  'Unit 2',  'Rent Review',
   '2026-09-29', '2026-06-29', '£118,000', '£125,000', '2,900', 'Contacted',  'Westgate Centre Estates (QA)',  'Manual', 'Landlord keen to instruct, proposal sent.'),
  ('qa-lev-3', 'qa-prop-2', 'Unit 1, Westgate Centre, Oxford (QA)',    'Harlow & Finch (QA)',    'qa-brand-7',  'Unit 1',  'Break Option',
   '2026-11-10', '2026-05-10', '£145,000', '£152,000', '3,200', 'Monitoring', 'Westgate Centre Estates (QA)',  'Manual', 'Tenant trading well — break unlikely to be exercised.'),
  ('qa-lev-4', 'qa-prop-3', 'Unit 4, Northbank Quarter, Leeds (QA)',   'Franco''s Coffee (QA)',  'qa-brand-2',  'Unit 4',  'Break Option',
   '2027-03-25', '2026-09-25', '£46,500',  '£49,000',  '980',   'Monitoring', 'Northbank Property Group (QA)', 'Manual', 'Watching — tenant expanding elsewhere in scheme.'),
  ('qa-lev-5', 'qa-prop-2', 'Unit 5, Westgate Centre, Oxford (QA)',    'Bloom Beauty Rooms (QA)','qa-brand-12', 'Unit 5',  'Lease Expiry',
   '2027-09-28', '2027-03-28', '£52,000',  '£55,000',  '1,250', 'Monitoring', 'Westgate Centre Estates (QA)',  'Manual', 'Renewal conversation to start Q1 2027.')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 7. pla_matters — 3 lease advisory instructions
--    Types/statuses from client/src/pages/pla-matters.tsx (shared deal codes).
--    lead_user_id: victoria@ (2713c214-…)
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO pla_matters (id, property_id, unit_id, matter_type, acting_for, lead_user_id,
  client_company_id, current_rent, current_rent_review_date, expiry_date, break_date,
  quoting_rent, counter_quoting_rent, status, opened_at, notes) VALUES
  ('qa-pla-1', 'qa-prop-3', 'qa-tsu-6', 'rent_review',   'landlord', '2713c214-640f-40a2-9bf6-857a94239103',
   'qa-landlord-3', 185000, '2025-12-25', '2035-12-24', '2030-12-25', 205000, 188000, 'NEG', '2026-05-12', 'Rent review instructed by Northbank (QA); quoting £205k vs counter £188k.'),
  ('qa-pla-2', 'qa-prop-2', 'qa-tsu-2', 'rent_review',   'landlord', '2713c214-640f-40a2-9bf6-857a94239103',
   'qa-landlord-2', 118000, '2026-06-24', '2031-06-23', NULL,        128000, NULL,    'REP', '2026-07-01', 'Just instructed — gathering comps.'),
  ('qa-pla-3', 'qa-prop-2', 'qa-tsu-1', 'lease_renewal', 'tenant',   '2713c214-640f-40a2-9bf6-857a94239103',
   'qa-brand-7',    145000, NULL,        '2029-03-24', '2026-03-25', 138000, 149000,  'SOL', '2026-03-02', 'Acting for Harlow & Finch (QA) on renewal; terms agreed, with solicitors.')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Expenses — 2 cardholders + 6 expenses across states.
--    Submitters: victoria@ (2713c214-…) and nick@ (b4e36f9f-…) so
--    approvals shows two groups. Statuses from expenses-admin.tsx.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO stripe_cardholders (id, user_id, user_name, email, monthly_limit, daily_limit, single_tx_limit, status) VALUES
  ('qa-card-1', '2713c214-640f-40a2-9bf6-857a94239103', 'Victoria (QA card)', 'victoria@brucegillinghampollard.com', 150000, 30000, 30000, 'active'),
  ('qa-card-2', 'b4e36f9f-f72c-4b61-867b-3f37ea255c4c', 'Nick (QA card)',     'nick@brucegillinghampollard.com',     200000, 50000, 50000, 'active')
ON CONFLICT DO NOTHING;

INSERT INTO expenses (id, cardholder_id, type, status, merchant, amount_pence, vat_pence, net_pence, vat_rate,
  currency, transaction_date, category, business_purpose, submitter_user_id, submitted_for_approval_at,
  approved_at, approved_by_user_id, created_by) VALUES
  ('qa-exp-4', 'qa-card-1', 'card', 'approved',        'Franco''s Coffee (QA)',       1840,  307,  1533, 20, 'gbp', '2026-08-03', 'Subsistence',
   'Coffee with Gareth Llewellyn (QA) re Westgate leasing', '2713c214-640f-40a2-9bf6-857a94239103', '2026-08-04', '2026-08-05', 'b4e36f9f-f72c-4b61-867b-3f37ea255c4c', 'qa-seed'),
  ('qa-exp-5', 'qa-card-2', 'card', 'approved',        'GWR Trains',                  8650,  0,    8650, 0,  'gbp', '2026-08-06', 'Travel - Train',
   'Return to Oxford — Westgate Centre (QA) inspection',    'b4e36f9f-f72c-4b61-867b-3f37ea255c4c', '2026-08-07', '2026-08-08', '2713c214-640f-40a2-9bf6-857a94239103', 'qa-seed'),
  ('qa-exp-6', 'qa-card-1', 'card', 'pending_receipt', 'Addison Lee',                 2380,  397,  1983, 20, 'gbp', '2026-08-18', 'Travel - Taxi',
   'Taxi to Northbank Quarter (QA) viewing',                '2713c214-640f-40a2-9bf6-857a94239103', NULL, NULL, NULL, 'qa-seed'),
  ('qa-exp-7', 'qa-card-2', 'card', 'pending_receipt', 'Ryman Stationery',            4299,  717,  3582, 20, 'gbp', '2026-08-19', 'Office Supplies / Stationery',
   'Pitch document supplies',                               'b4e36f9f-f72c-4b61-867b-3f37ea255c4c', NULL, NULL, NULL, 'qa-seed'),
  ('qa-exp-8', 'qa-card-1', 'card', 'pending_approval','The Copper Grill (QA)',       16400, 2733, 13667, 20, 'gbp', '2026-08-20', 'Client Entertainment',
   'Dinner with Northbank Property Group (QA) team',        '2713c214-640f-40a2-9bf6-857a94239103', '2026-08-21', NULL, NULL, 'qa-seed'),
  ('qa-exp-9', 'qa-card-2', 'card', 'pending_approval','Malmaison Leeds',             21250, 3542, 17708, 20, 'gbp', '2026-08-21', 'Travel - Hotels',
   'Overnight for Northbank Quarter (QA) tenant tour',      'b4e36f9f-f72c-4b61-867b-3f37ea255c4c', '2026-08-22', NULL, NULL, 'qa-seed')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 9. Pathway portfolio — 3 pathway runs with Stage 6 business plans
--    (price / NIY / IRR / MOIC read by /api/property-pathway/portfolio)
--    plus one portfolio grouping them.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO property_pathway_runs (id, property_id, address, postcode, current_stage, stage_status, stage_results,
  started_by, started_at, updated_at, completed_at) VALUES
  ('qa-run-1', 'qa-prop-5', '88-102 St Aldgate''s, Guildford (QA)', 'GU1 3AJ', 8,
   '{"stage6": "complete", "stage7": "complete"}',
   '{"stage6": {"agreed": {"targetPurchasePrice": 12500000, "targetNIY": 6.25, "targetIRR": 14.2, "targetMOIC": 1.82, "strategy": "Re-gear and hold", "holdPeriodYrs": 5, "exitPrice": 15400000, "exitYield": 5.9, "capex": {"amount": 450000}}}, "stage7": {"agreed": true}, "_disposition": {"status": "offer_made", "reason": "Bid submitted at £12.35m", "setBy": "qa-seed", "setAt": "2026-08-10T09:00:00Z"}}',
   '2713c214-640f-40a2-9bf6-857a94239103', '2026-06-02', '2026-08-10', '2026-08-10'),
  ('qa-run-2', NULL, '7-9 Corn Exchange, Bath (QA)', 'BA1 1UF', 7,
   '{"stage6": "complete"}',
   '{"stage6": {"agreed": {"targetPurchasePrice": 4750000, "targetNIY": 7.1, "targetIRR": 16.8, "targetMOIC": 2.05, "strategy": "Refurb & re-let", "holdPeriodYrs": 4, "exitPrice": 6300000, "exitYield": 6.4, "capex": {"amount": 820000}}}, "stage7": {}}',
   '2713c214-640f-40a2-9bf6-857a94239103', '2026-07-01', '2026-08-15', NULL),
  ('qa-run-3', NULL, '210 Deansgate, Manchester (QA)', 'M3 3NW', 6,
   '{"stage6": "draft"}',
   '{"stage6": {"draft": {"targetPurchasePrice": 8900000, "targetNIY": 6.6, "targetIRR": 12.9, "targetMOIC": 1.65, "strategy": "Income hold", "holdPeriodYrs": 7, "exitPrice": 10200000, "exitYield": 6.2, "capex": {"amount": 150000}}}}',
   '2713c214-640f-40a2-9bf6-857a94239103', '2026-07-20', '2026-08-20', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO portfolios (id, name, notes, created_by) VALUES
  ('qa-portfolio-1', 'QA South East Retail Portfolio (QA)', 'Fixture portfolio grouping the three QA pathway runs.', '2713c214-640f-40a2-9bf6-857a94239103')
ON CONFLICT (id) DO NOTHING;

INSERT INTO portfolio_runs (id, portfolio_id, run_id, enabled, sort_order) VALUES
  ('qa-prun-1', 'qa-portfolio-1', 'qa-run-1', true, 1),
  ('qa-prun-2', 'qa-portfolio-1', 'qa-run-2', true, 2),
  ('qa-prun-3', 'qa-portfolio-1', 'qa-run-3', true, 3)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 10. Comps leads — unverified AI-extracted comps (comps.tsx Leads tab:
--     !verified AND source_evidence IN ('News Feed','Team Email','SharePoint File')
--     or created_by = 'AI Auto-Extract')
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO crm_comps (id, name, deal_type, comp_type, tenant, landlord, area_sqft, headline_rent,
  rent_free_months, term, completion_date, address, postcode, area_location, transaction_type,
  verified, source_evidence, created_by, comments) VALUES
  ('qa-lead-1', '31 High Street, Winchester — café letting (QA)', 'Leasing', 'Open Market Letting',
   'Grind House Coffee (QA)', 'Hampshire Estates (QA)', '1,150', '£48,500', '6', '10 years', 'Jul 2026',
   '{"street": "31 High Street", "city": "Winchester", "postcode": "SO23 9BL"}', 'SO23 9BL', 'Winchester', 'Letting',
   false, 'News Feed', 'AI Auto-Extract', 'Extracted from Retail Week article — needs verifying.'),
  ('qa-lead-2', 'Unit 3 Victoria Walk, Leeds — gym letting (QA)', 'Leasing', 'Open Market Letting',
   'IronWorks Gyms (QA)', 'Victoria Walk LP (QA)', '8,400', '£126,000', '9', '15 years', 'Jun 2026',
   '{"street": "Unit 3 Victoria Walk", "city": "Leeds", "postcode": "LS1 6HZ"}', 'LS1 6HZ', 'Leeds', 'Letting',
   false, 'Team Email', 'AI Auto-Extract', 'From Jonny''s email thread with Corbett & Vale (QA).'),
  ('qa-lead-3', '14 Market Square, Cambridge — restaurant letting (QA)', 'Leasing', 'Open Market Letting',
   'Casa Piccola (QA)', 'Market Square Holdings (QA)', '2,650', '£92,000', '12', '20 years', 'Aug 2026',
   '{"street": "14 Market Square", "city": "Cambridge", "postcode": "CB2 3QJ"}', 'CB2 3QJ', 'Cambridge', 'Letting',
   false, 'SharePoint File', 'AI Auto-Extract', 'Parsed from marketing PDF in SharePoint.')
ON CONFLICT (id) DO NOTHING;

COMMIT;
