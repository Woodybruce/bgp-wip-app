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

INSERT INTO users (id, username, password, name, email, role, team, is_active)
SELECT '99999999-4444-4444-4444-444444444444', 'sam.cole@hammerson.com', u.password,
       'Sam Cole', 'sam.cole@hammerson.com', 'Client', 'Hammerson', true
FROM users u WHERE u.email = 'mark.warne@landsec.com'
ON CONFLICT (id) DO NOTHING;
