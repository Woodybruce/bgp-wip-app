-- Test rows for the "<client> Contacts" tab. Fixed ids, add-only.
INSERT INTO crm_contacts (id, name, role, email, phone, phone_mobile, company_id, company_name) VALUES
 -- Landsec: on the team sheet (Leasing)
 ('c0a7ac75-0000-4000-8000-000000000101','Mark Warne','Leasing Director (test)','mark.warne@landsec.example','020 7946 0101',NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000102','Victoria Gould','Leasing Manager (test)','victoria.gould@landsec.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000103','George',NULL,'george.ohara@landsec.example',NULL,'+44 (0)7700 900103','d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 -- Landsec: on the team sheet (Asset management)
 ('c0a7ac75-0000-4000-8000-000000000104','Gemma Casey','Asset Manager (test)','gemma.casey@landsec.example','020 7946 0104',NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000105','Rob Hardie','Senior Asset Manager (test)','rob.hardie@landsec.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000106','rob.hardie',NULL,'rob.hardie@landsec.example','020 7946 0106',NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000107','Amy de Groot',NULL,NULL,NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 -- Landsec: everyone else
 ('c0a7ac75-0000-4000-8000-000000000108','Abigail Kirkham','Marketing Manager (test)','abigail.kirkham@landsec.example','020 7946 0108',NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000109','Adam',NULL,'adam.sawyer@landsec.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000110','Adam Sawyer','Head of Guest Experience (test)','Adam.Sawyer@landsec.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000111','Priya Nair','Sustainability Lead (test)','priya.nair@landsec.example',NULL,'07700 900111','d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000112','Tom Whitfield',NULL,NULL,'020 7946 0112',NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000113','Zoe Marsh','Centre Director (test)','zoe.marsh@landsec.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 -- Landsec: shared mailboxes and system addresses
 ('c0a7ac75-0000-4000-8000-000000000114','Accountspayable',NULL,'accountspayable@landsec.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000115','Accountsreceivable Paymentrun',NULL,NULL,NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000116','Landsec Notifications',NULL,'no-reply@landsec.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 -- Elsewhere: must NOT appear in the Landsec tab
 ('c0a7ac75-0000-4000-8000-000000000117','Bella Brandside','Property Director (test)','bella@jerseymikes.example',NULL,NULL,'bc000000-0000-4000-8000-000000000001','Jersey Mike''s'),
 ('c0a7ac75-0000-4000-8000-000000000118','Locations',NULL,'locations@flatiron.example',NULL,NULL,'bc000000-0000-4000-8000-000000000003','Flat Iron'),
 ('c0a7ac75-0000-4000-8000-000000000119','Aaron Agentside','Agent (test)','aaron@barkerproudlove.example',NULL,NULL,'a9e17000-0000-4000-8000-000000000001','Barker Proudlove'),
 ('c0a7ac75-0000-4000-8000-000000000120','Helen Groupside','Company Secretary (test)','helen@landsecgroup.example',NULL,NULL,'bbbbbbbb-0000-0000-0000-000000000001','Land Securities Group PLC'),
 -- Hammerson: the other client's own people
 ('c0a7ac75-0000-4000-8000-000000000121','Sam Cole','Leasing Manager (test)','sam.cole@hammerson.example','020 7946 0121',NULL,'99999999-1111-1111-1111-111111111111','Hammerson'),
 ('c0a7ac75-0000-4000-8000-000000000122','Nadia Okoro','Asset Manager (test)','nadia.okoro@hammerson.example',NULL,NULL,'99999999-1111-1111-1111-111111111111','Hammerson'),
 ('c0a7ac75-0000-4000-8000-000000000123','Info',NULL,'info@hammerson.example',NULL,NULL,'99999999-1111-1111-1111-111111111111','Hammerson')
ON CONFLICT (id) DO NOTHING;

-- Added for the review fixes: recorded on the Landsec row with another organisation's address.
INSERT INTO crm_contacts (id, name, role, email, phone, phone_mobile, company_id, company_name) VALUES
 ('c0a7ac75-0000-4000-8000-000000000124','Olive Outsider','Solicitor (test)','olive.outsider@lawfirm.example','020 7946 0124',NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec'),
 ('c0a7ac75-0000-4000-8000-000000000125','Viv Lim','Agent (test)','viv.lim@agentfirm.example',NULL,NULL,'d25ec158-82df-4f50-8188-cae113af5f9f','Landsec')
ON CONFLICT (id) DO NOTHING;
