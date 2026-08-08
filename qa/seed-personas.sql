-- Idempotent fixture for the multi-persona QA harness.
-- Adds a SECOND client (Hammerson) so client-vs-client isolation is tested
-- with two real logins, not just "Landsec can't see a synthetic row".
-- Sam Cole's password is copied from Mark Warne's hash (same QA password).

INSERT INTO crm_companies (id, name, company_type)
VALUES ('99999999-1111-1111-1111-111111111111', 'Hammerson', 'Landlord')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_properties (id, name, landlord_id, latitude, longitude)
VALUES ('99999999-2222-2222-2222-222222222222', 'Brent Cross Shopping Centre',
        '99999999-1111-1111-1111-111111111111', 51.5766, -0.2235)
ON CONFLICT (id) DO NOTHING;

INSERT INTO available_units (id, property_id, unit_name, marketing_status)
VALUES ('99999999-3333-3333-3333-333333333333', '99999999-2222-2222-2222-222222222222',
        'Unit BX10', 'AVA')
ON CONFLICT (id) DO NOTHING;

-- Rival tenancy-schedule row: the foreign-unit guard proves a Landsec login
-- cannot write another landlord's leasing schedule.
INSERT INTO leasing_schedule_units (id, property_id, unit_name, tenant_name)
VALUES ('99999999-4444-4444-4444-444444444444', '99999999-2222-2222-2222-222222222222',
        'BX10', 'Rival Tenant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, username, password, name, email, role, team, is_active)
SELECT '99999999-4444-4444-4444-444444444444', 'sam.cole@hammerson.com', u.password,
       'Sam Cole', 'sam.cole@hammerson.com', 'Client', 'Hammerson', true
FROM users u WHERE u.email = 'mark.warne@landsec.com'
ON CONFLICT (id) DO NOTHING;

-- Dedicated throwaway for the admin password-reset scenario: its password
-- is rotated every round, so nothing else may ever log in as it.
INSERT INTO users (id, username, password, name, email, role, team, is_active)
SELECT 'aaaaaaaa-5555-5555-5555-555555555555', 'qa.resettable@bgp.test', u.password,
       'QA Resettable', 'qa.resettable@bgp.test', 'Agency', 'National', true
FROM users u WHERE u.email = 'mark.warne@landsec.com'
ON CONFLICT (id) DO NOTHING;

-- The in-slice hospitality brand the brand-profile scenarios pivot on. The
-- old dev fixture shipped it; the smoke fixture doesn't — create it where
-- absent so the harness's name resolution finds it in either DB.
INSERT INTO crm_companies (id, name, company_type)
VALUES ('77777777-7777-7777-7777-777777777777', 'Honi Poke', 'Tenant - Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Pitch activity for Honi on BOTH clients' estates, so per-tenant
-- brand-profile scoping (each client sees their own schemes' pitches,
-- never the rival's) stays assertable.
INSERT INTO leasing_schedule_units (id, property_id, unit_name, target_brands)
SELECT 'aaaaaaaa-7777-7777-7777-777777777773', p.id, 'QA Honi pitch (Landsec)', 'Honi Poke'
FROM crm_properties p WHERE p.name ILIKE '%bluewater%'
LIMIT 1
ON CONFLICT (id) DO NOTHING;
INSERT INTO leasing_schedule_units (id, property_id, unit_name, target_brands)
VALUES ('aaaaaaaa-7777-7777-7777-777777777774', '99999999-2222-2222-2222-222222222222',
        'QA Honi pitch (Hammerson)', 'Honi Poke')
ON CONFLICT (id) DO NOTHING;

-- Turnover fixtures: one in-slice brand row (client-visible) and one
-- out-of-slice row (must be filtered by clientBrandSliceSql for clients).
INSERT INTO turnover_data (id, company_id, company_name, period, source, confidence)
VALUES ('aaaaaaaa-7777-7777-7777-777777777771', '77777777-7777-7777-7777-777777777777', 'Honi Poke', 'FY2025', 'qa-fixture', 'high'),
       ('aaaaaaaa-7777-7777-7777-777777777772', '88888888-1111-1111-1111-111111111111', 'QA Retail Brand', 'FY2025', 'qa-fixture', 'high')
ON CONFLICT (id) DO NOTHING;

-- A Hammerson sub-entity so the sub-companies cross-tenant read guard is
-- actually testable (carries AML/KYC data a rival client must never see).
INSERT INTO crm_companies (id, name, company_type, parent_company_id, kyc_status, aml_risk_level)
VALUES ('99999999-5555-5555-5555-555555555555', 'Hammerson SubCo Ltd', 'Landlord',
        '99999999-1111-1111-1111-111111111111', 'verified', 'high')
ON CONFLICT (id) DO NOTHING;

-- A Hammerson contact linked to Hammerson's property, so the contact
-- sub-resource read guard (contacts/:id/properties|deals|requirements) is
-- testable: a Landsec client must not read a foreign contact's links.
INSERT INTO crm_contacts (id, name, company_id, role)
VALUES ('99999999-6666-6666-6666-666666666666', 'Hammerson Head of Leasing',
        '99999999-1111-1111-1111-111111111111', 'Leasing')
ON CONFLICT (id) DO NOTHING;
INSERT INTO crm_contact_properties (contact_id, property_id)
VALUES ('99999999-6666-6666-6666-666666666666', '99999999-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

-- A NON-hospitality tenant brand (Retail), OUTSIDE the client CRM category
-- slice — used to test that a Landsec login gets 403 by default, can pull
-- the brand in from the global directory (add-brand), and loses access
-- again once it's removed.
INSERT INTO crm_companies (id, name, company_type)
VALUES ('88888888-1111-1111-1111-111111111111', 'QA Retail Brand', 'Tenant - Retail')
ON CONFLICT (id) DO NOTHING;
