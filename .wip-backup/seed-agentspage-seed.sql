-- Agents page test rows (additive, fixed ids, idempotent).
INSERT INTO crm_companies (id, name, company_type, domain) VALUES
 ('a9e17000-0000-4000-8000-000000000001','Barker Proudlove','Agent','barkerproudlove.example'),
 ('a9e17000-0000-4000-8000-000000000002','Brasier Freeth','Agent','brasierfreeth.example'),
 ('a9e17000-0000-4000-8000-000000000003','CBRE','Agent','cbre-test.example'),
 ('a9e17000-0000-4000-8000-000000000004','CD Bevan','Agent',NULL),
 ('a9e17000-0000-4000-8000-000000000005','Davis Coffer Lyons','Agent','dcl.example'),
 ('a9e17000-0000-4000-8000-000000000006','Shelley Sandzer','Agent','shelleysandzer.example'),
 ('a9e17000-0000-4000-8000-000000000007','Bruce Gillingham Pollard','Agent','brucegillinghampollard.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_contacts (id, name, role, company_id, email, phone, phone_mobile, agent_specialty) VALUES
 ('a9e17000-0000-4000-8000-000000000101','Hannah Whitlock','Director','a9e17000-0000-4000-8000-000000000001','hannah.whitlock@barkerproudlove.example','0161 555 0101','07700 900101','Leisure'),
 ('a9e17000-0000-4000-8000-000000000102','Marcus Oyelaran','Associate','a9e17000-0000-4000-8000-000000000001','marcus.oyelaran@barkerproudlove.example',NULL,'07700 900102',NULL),
 ('a9e17000-0000-4000-8000-000000000103','Priya Raman','Partner','a9e17000-0000-4000-8000-000000000002','priya.raman@brasierfreeth.example','01923 555 0103',NULL,'Restaurants'),
 ('a9e17000-0000-4000-8000-000000000104','Oliver Stanhope-Reid','Senior Director, Retail Agency','a9e17000-0000-4000-8000-000000000003','oliver.stanhope-reid@cbre-test.example','020 7946 0104','07700 900104',NULL),
 ('a9e17000-0000-4000-8000-000000000105','Jess Lindqvist','Surveyor','a9e17000-0000-4000-8000-000000000003','jess.lindqvist@cbre-test.example',NULL,NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000106','Tom Dracup',NULL,'a9e17000-0000-4000-8000-000000000003','tom.dracup@cbre-test.example','020 7946 0106',NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000107','Nigel Costain','Executive Director','a9e17000-0000-4000-8000-000000000003','nigel.costain@cbre-test.example','020 7946 0107','07700 900107',NULL),
 ('a9e17000-0000-4000-8000-000000000108','Ceri Bevan','Director','a9e17000-0000-4000-8000-000000000004',NULL,'029 2055 0108',NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000109','Dominic Farrant','Director','a9e17000-0000-4000-8000-000000000005','dominic.farrant@dcl.example','020 7946 0109','07700 900109','Restaurants & bars'),
 ('a9e17000-0000-4000-8000-000000000110','Amelia Okafor','Associate Director','a9e17000-0000-4000-8000-000000000005','amelia.okafor@dcl.example',NULL,'07700 900110',NULL),
 ('a9e17000-0000-4000-8000-000000000111','Rory Castellan','Surveyor','a9e17000-0000-4000-8000-000000000005','rory.castellan@dcl.example',NULL,NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000112','Imogen Hale','Graduate','a9e17000-0000-4000-8000-000000000005','imogen.hale@dcl.example',NULL,NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000113','Nick Weir-Test','Managing Director','a9e17000-0000-4000-8000-000000000006','nick.weir@shelleysandzer.example','020 7946 0113',NULL,'Restaurants'),
 ('a9e17000-0000-4000-8000-000000000114','Freya Dunmore','Independent agent',NULL,'freya@dunmore-property.example',NULL,'07700 900114',NULL),
 ('a9e17000-0000-4000-8000-000000000115','Lucy Gardiner','Director','a9e17000-0000-4000-8000-000000000007','lucyg@brucegillinghampollard.com',NULL,NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000116','Harry Elliott','Director','a9e17000-0000-4000-8000-000000000007','harrye@brucegillinghampollard.com',NULL,'07568 367 777','Tenant rep'),
 ('a9e17000-0000-4000-8000-000000000117','Sammy Jones','Head of Marketing',NULL,'sammy.jones@a-brand.example',NULL,NULL,NULL)
ON CONFLICT (id) DO NOTHING;

-- Recorded tenant-rep representations (brands in the Landsec slice).
INSERT INTO brand_agent_representations (id, brand_company_id, agent_company_id, agent_type, region, primary_contact_id) VALUES
 ('a9e17000-0000-4000-8000-000000000201','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004','a9e17000-0000-4000-8000-000000000001','tenant_rep','North','a9e17000-0000-4000-8000-000000000101'),
 ('a9e17000-0000-4000-8000-000000000202','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003','a9e17000-0000-4000-8000-000000000001','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000101'),
 ('a9e17000-0000-4000-8000-000000000203','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006','a9e17000-0000-4000-8000-000000000001','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000102'),
 ('a9e17000-0000-4000-8000-000000000204','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005','a9e17000-0000-4000-8000-000000000002','tenant_rep','London','a9e17000-0000-4000-8000-000000000103'),
 ('a9e17000-0000-4000-8000-000000000205','f20b8a35-80e1-4140-8d59-4966873944a1','a9e17000-0000-4000-8000-000000000003','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000104'),
 ('a9e17000-0000-4000-8000-000000000206','11110000-0000-0000-0000-000000000201','a9e17000-0000-4000-8000-000000000003','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000105'),
 ('a9e17000-0000-4000-8000-000000000207','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001','a9e17000-0000-4000-8000-000000000003','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000106'),
 ('a9e17000-0000-4000-8000-000000000208','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001','a9e17000-0000-4000-8000-000000000004','tenant_rep','Wales','a9e17000-0000-4000-8000-000000000108'),
 ('a9e17000-0000-4000-8000-000000000209','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004','a9e17000-0000-4000-8000-000000000005','tenant_rep','London','a9e17000-0000-4000-8000-000000000109'),
 ('a9e17000-0000-4000-8000-000000000210','f20b8a35-80e1-4140-8d59-4966873944a1','a9e17000-0000-4000-8000-000000000005','tenant_rep','London','a9e17000-0000-4000-8000-000000000109'),
 ('a9e17000-0000-4000-8000-000000000211','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005','a9e17000-0000-4000-8000-000000000005','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000110'),
 ('a9e17000-0000-4000-8000-000000000212','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006','a9e17000-0000-4000-8000-000000000005','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000111'),
 ('a9e17000-0000-4000-8000-000000000213','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003','a9e17000-0000-4000-8000-000000000005','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000112'),
 ('a9e17000-0000-4000-8000-000000000214','11110000-0000-0000-0000-000000000201','a9e17000-0000-4000-8000-000000000006','tenant_rep',NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000215','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003','a9e17000-0000-4000-8000-000000000007','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000115'),
 ('a9e17000-0000-4000-8000-000000000216','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006','a9e17000-0000-4000-8000-000000000007','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000116'),
 ('a9e17000-0000-4000-8000-000000000217','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004','a9e17000-0000-4000-8000-000000000006','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000113')
ON CONFLICT (id) DO NOTHING;

-- Current requirements with an agent contact (PIPnet = visible to clients).
INSERT INTO crm_requirements_leasing (id, name, status, company_id, agent_contact_id, sources) VALUES
 ('a9e17000-0000-4000-8000-000000000301','Testco Coffee — UK roll-out','Active','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005','a9e17000-0000-4000-8000-000000000103','{PIPnet}'),
 ('a9e17000-0000-4000-8000-000000000302','Amorino — regional centres','Active','f20b8a35-80e1-4140-8d59-4966873944a1','a9e17000-0000-4000-8000-000000000114','{PIPnet}'),
 ('a9e17000-0000-4000-8000-000000000303','Testco Gym — 15,000 sq ft boxes','Active','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003','a9e17000-0000-4000-8000-000000000101','{PIPnet}'),
 ('a9e17000-0000-4000-8000-000000000304','Testco Ramen — flagship','Active','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004','a9e17000-0000-4000-8000-000000000113','{PIPnet}')
ON CONFLICT (id) DO NOTHING;
