-- A third batch of tenant rep rows so the fold can be seen (additive, idempotent).
INSERT INTO crm_companies (id, name, company_type, domain) VALUES
 ('a9e17000-0000-4000-8000-000000000011','Belcor','Agent','belcor.example'),
 ('a9e17000-0000-4000-8000-000000000012','Brecker Grossmith','Agent','breckergrossmith.example'),
 ('a9e17000-0000-4000-8000-000000000013','Metis Real Estate','Agent','metisrealestate.example')
ON CONFLICT (id) DO NOTHING;
INSERT INTO crm_contacts (id, name, role, company_id, email, phone, phone_mobile) VALUES
 ('a9e17000-0000-4000-8000-000000000125','Isla Petherick','Director','a9e17000-0000-4000-8000-000000000011','isla.petherick@belcor.example','020 7946 0125',NULL),
 ('a9e17000-0000-4000-8000-000000000126','Gareth Nwosu','Surveyor','a9e17000-0000-4000-8000-000000000011','gareth.nwosu@belcor.example',NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000127','Rosa Lindholm','Partner','a9e17000-0000-4000-8000-000000000012','rosa.lindholm@breckergrossmith.example','020 7946 0127','07700 900127'),
 ('a9e17000-0000-4000-8000-000000000128','Dev Kapoor','Associate','a9e17000-0000-4000-8000-000000000012','dev.kapoor@breckergrossmith.example',NULL,'07700 900128'),
 ('a9e17000-0000-4000-8000-000000000129','Maisie Thornbury','Graduate Surveyor','a9e17000-0000-4000-8000-000000000012','maisie.thornbury@breckergrossmith.example',NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000130','Fergus Adeyemi','Director','a9e17000-0000-4000-8000-000000000013','fergus.adeyemi@metisrealestate.example','0161 555 0130',NULL),
 ('a9e17000-0000-4000-8000-000000000131','Nell Castleton','Senior Surveyor','a9e17000-0000-4000-8000-000000000013','nell.castleton@metisrealestate.example',NULL,'07700 900131'),
 ('a9e17000-0000-4000-8000-000000000132','Ola Bergstrom','Surveyor','a9e17000-0000-4000-8000-000000000013','ola.bergstrom@metisrealestate.example',NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000133','Piers Hawksworth','Consultant',NULL,NULL,NULL,'07700 900133'),
 ('a9e17000-0000-4000-8000-000000000134','Anya Whitcombe','Associate Director','a9e17000-0000-4000-8000-000000000013','anya.whitcombe@metisrealestate.example','0161 555 0134',NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_agent_representations (id, brand_company_id, agent_company_id, agent_type, region, primary_contact_id) VALUES
 ('a9e17000-0000-4000-8000-000000000227','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001','a9e17000-0000-4000-8000-000000000011','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000125'),
 ('a9e17000-0000-4000-8000-000000000228','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005','a9e17000-0000-4000-8000-000000000011','tenant_rep','South East','a9e17000-0000-4000-8000-000000000126'),
 ('a9e17000-0000-4000-8000-000000000229','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004','a9e17000-0000-4000-8000-000000000012','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000127'),
 ('a9e17000-0000-4000-8000-000000000230','11110000-0000-0000-0000-000000000201','a9e17000-0000-4000-8000-000000000012','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000128'),
 ('a9e17000-0000-4000-8000-000000000231','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006','a9e17000-0000-4000-8000-000000000012','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000129'),
 ('a9e17000-0000-4000-8000-000000000232','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003','a9e17000-0000-4000-8000-000000000013','tenant_rep','North West','a9e17000-0000-4000-8000-000000000130'),
 ('a9e17000-0000-4000-8000-000000000233','f20b8a35-80e1-4140-8d59-4966873944a1','a9e17000-0000-4000-8000-000000000013','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000131'),
 ('a9e17000-0000-4000-8000-000000000234','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001','a9e17000-0000-4000-8000-000000000013','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000132'),
 ('a9e17000-0000-4000-8000-000000000235','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006','a9e17000-0000-4000-8000-000000000013','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000134')
ON CONFLICT (id) DO NOTHING;
INSERT INTO crm_requirements_leasing (id, name, status, company_id, agent_contact_id, sources) VALUES
 ('a9e17000-0000-4000-8000-000000000305','Starbucks — drive-to sites','Active','11110000-0000-0000-0000-000000000201','a9e17000-0000-4000-8000-000000000133','{PIPnet}')
ON CONFLICT (id) DO NOTHING;
