-- More tenant rep rows so the list is long enough to fold (additive, idempotent).
INSERT INTO crm_companies (id, name, company_type, domain) VALUES
 ('a9e17000-0000-4000-8000-000000000008','Fawley Watson Booth','Agent','fwb.example'),
 ('a9e17000-0000-4000-8000-000000000009','Lunson Mitchenall','Agent','lunsonmitchenall.example'),
 ('a9e17000-0000-4000-8000-000000000010','Restaurant Property','Agent','restaurantproperty.example')
ON CONFLICT (id) DO NOTHING;
INSERT INTO crm_contacts (id, name, role, company_id, email, phone, phone_mobile) VALUES
 ('a9e17000-0000-4000-8000-000000000118','Callum Ashby','Director','a9e17000-0000-4000-8000-000000000008','callum.ashby@fwb.example','0113 555 0118',NULL),
 ('a9e17000-0000-4000-8000-000000000119','Sophie Marchetti','Associate','a9e17000-0000-4000-8000-000000000008','sophie.marchetti@fwb.example',NULL,'07700 900119'),
 ('a9e17000-0000-4000-8000-000000000120','Jonty Albright','Partner','a9e17000-0000-4000-8000-000000000009','jonty.albright@lunsonmitchenall.example','020 7946 0120',NULL),
 ('a9e17000-0000-4000-8000-000000000121','Ellie Brackenbury','Surveyor','a9e17000-0000-4000-8000-000000000009','ellie.brackenbury@lunsonmitchenall.example',NULL,NULL),
 ('a9e17000-0000-4000-8000-000000000122','Kwame Mensah','Senior Surveyor','a9e17000-0000-4000-8000-000000000009','kwame.mensah@lunsonmitchenall.example',NULL,'07700 900122'),
 ('a9e17000-0000-4000-8000-000000000123','Tilly Rosewarne','Director','a9e17000-0000-4000-8000-000000000010','tilly@restaurantproperty.example','020 7946 0123','07700 900123'),
 ('a9e17000-0000-4000-8000-000000000124','Ben Harcastle','Associate Director','a9e17000-0000-4000-8000-000000000010','ben@restaurantproperty.example',NULL,NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO brand_agent_representations (id, brand_company_id, agent_company_id, agent_type, region, primary_contact_id) VALUES
 ('a9e17000-0000-4000-8000-000000000218','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003','a9e17000-0000-4000-8000-000000000008','tenant_rep','North','a9e17000-0000-4000-8000-000000000118'),
 ('a9e17000-0000-4000-8000-000000000219','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0006','a9e17000-0000-4000-8000-000000000008','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000119'),
 ('a9e17000-0000-4000-8000-000000000220','11110000-0000-0000-0000-000000000201','a9e17000-0000-4000-8000-000000000009','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000120'),
 ('a9e17000-0000-4000-8000-000000000221','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005','a9e17000-0000-4000-8000-000000000009','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000121'),
 ('a9e17000-0000-4000-8000-000000000222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001','a9e17000-0000-4000-8000-000000000009','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000122'),
 ('a9e17000-0000-4000-8000-000000000223','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0004','a9e17000-0000-4000-8000-000000000010','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000123'),
 ('a9e17000-0000-4000-8000-000000000224','f20b8a35-80e1-4140-8d59-4966873944a1','a9e17000-0000-4000-8000-000000000010','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000124'),
 ('a9e17000-0000-4000-8000-000000000225','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001','a9e17000-0000-4000-8000-000000000010','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000123'),
 ('a9e17000-0000-4000-8000-000000000226','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0005','a9e17000-0000-4000-8000-000000000010','tenant_rep',NULL,'a9e17000-0000-4000-8000-000000000123')
ON CONFLICT (id) DO NOTHING;
