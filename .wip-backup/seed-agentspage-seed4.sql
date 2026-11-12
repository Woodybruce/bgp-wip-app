-- A BGP team for the Hammerson test client (additive, idempotent).
INSERT INTO crm_client_team_members (id, client_company_id, user_id, team_group, role, sort_order, is_lead) VALUES
 ('a9e17000-0000-4000-8000-000000000401','99999999-1111-1111-1111-111111111111','9303cf67-d482-4d48-a000-828071a2a89d','Leasing','Lead',0,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO crm_property_agents (id, property_id, user_id, role) VALUES
 ('a9e17000-0000-4000-8000-000000000402','99999999-2222-2222-2222-222222222222','5e65e570-da43-43f2-b610-b8f52c20c4d3','Support')
ON CONFLICT (id) DO NOTHING;
